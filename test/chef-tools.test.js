// New chef assistant tools: bulk price with preview + confirm, undo stack, analytics by weekday,
// badge rules, menu sort, weekly report, CSV export, dashboard period stats, per-message tool selection.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { createMemoryStore } = require("../src/db/memory");
const auth = require("../src/auth");
const menu = require("../src/menu");
const { toolsFor } = require("../src/routes/chef-agent");

const env = { ADMIN_PATH: "secret-kitchen", ADMIN_PASSWORD: "pw123", SESSION_SECRET: "s3cret" };
const CAT0 = menu.CATEGORIES[0].slug;

function fakeAi(script) {
  const calls = [];
  return {
    enabled: true,
    calls,
    async chat({ messages, tools }) {
      calls.push({ messages: structuredClone(messages), tools });
      const step = script[calls.length - 1];
      return step ? step(messages) : { content: "done" };
    },
    generate: async () => null,
  };
}
const toolCall = (name, args, id = `c_${name}`) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const admin = (app) => request.agent(app).set("Cookie", `${auth.COOKIE_NAME}=${auth.createToken(env.SESSION_SECRET)}`);
const say = (...texts) => ({ messages: texts.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content })) });
const placeOrder = (app, dish_id, qty = 1, name = "Sara Ahmed") => request(app).post("/api/orders").send({ customer_name: name, payment_method: "vibes", items: [{ dish_id, size: "half", addons: [], qty }] });
const runTool = (app, tool, args = {}, chat_id = "t1") => admin(app).post("/api/admin/agent").send({ run: { tool, args }, tz: "UTC", chat_id });
function setup(script = []) {
  const db = createMemoryStore();
  const ai = fakeAi(script);
  return { db, ai, app: createApp({ db, env, ai }) };
}

test("bulk_price only previews until confirmed, then applies; undo restores the old prices", async () => {
  const { app, db } = setup();
  const [a, b] = await db.listDishes();
  const [pa, pb] = [Number(a.price), Number(b.price)];

  const res = await runTool(app, "bulk_price", { percent: 10, ids: [a.id, b.id], confirm: true });
  assert.equal(res.status, 200);
  const action = res.body.actions.find((x) => x.type === "confirm");
  assert.ok(action, "needs a confirm");
  assert.equal(Number((await db.getDish(a.id)).price), pa, "nothing changed before confirm");
  const preview = res.body.cards.find((c) => c.kind === "confirm").preview;
  assert.deepEqual(preview.rows.find((r) => r[0] === (a.name_en || a.name_ar)).slice(1), [`${pa} EGP`, `${Math.round(pa * 1.1)} EGP`]);
  assert.ok(res.body.tools_ran.some((t) => t.tool === "bulk_price"));

  // prepared patches can't be smuggled in through a direct run
  await runTool(app, "bulk_price", { percent: 10, patches: [{ id: a.id, fields: { price: 1 } }] });
  assert.equal(Number((await db.getDish(a.id)).price), pa);

  const done = await admin(app).post("/api/admin/agent").send({ confirm_token: action.token, chat_id: "t1" });
  assert.equal(done.status, 200);
  assert.equal(Number((await db.getDish(a.id)).price), Math.round(pa * 1.1));
  assert.equal(Number((await db.getDish(b.id)).price), Math.round(pb * 1.1));
  assert.equal(done.body.can_undo, true);

  // another chat has nothing to undo; this chat restores both prices
  assert.match((await runTool(app, "undo_last", {}, "other-chat")).body.reply, /Nothing to undo/);
  const undo = await runTool(app, "undo_last", {}, "t1");
  assert.equal(undo.status, 200);
  assert.equal(Number((await db.getDish(a.id)).price), pa);
  assert.equal(Number((await db.getDish(b.id)).price), pb);
  assert.match((await runTool(app, "undo_last", {}, "t1")).body.reply, /Nothing to undo/);
});

test("bulk_price via chat: a typed yes applies exactly the previewed plan", async () => {
  const db = createMemoryStore();
  const [a] = await db.listDishes();
  const pa = Number(a.price);
  const ai = fakeAi([() => toolCall("bulk_price", { percent: -20, ids: [a.id] }), () => ({ content: "Sure? Press Confirm" }), () => toolCall("bulk_price", { percent: -20, ids: [a.id], confirm: true }), () => ({ content: "done" })]);
  const app = createApp({ db, env, ai });
  const first = await admin(app).post("/api/admin/agent").send({ ...say("20% off"), chat_id: "y" });
  assert.ok(first.body.actions.some((x) => x.type === "confirm"));
  assert.equal(Number((await db.getDish(a.id)).price), pa);
  await admin(app).post("/api/admin/agent").send({ ...say("20% off", "Sure? Press Confirm", "yes"), chat_id: "y" });
  assert.equal(Number((await db.getDish(a.id)).price), Math.round(pa * 0.8));
});

test("undo restores fields changed by the AI (update_dish) and removes dishes it created", async () => {
  const db = createMemoryStore();
  const [dish] = await db.listDishes();
  const before = { price: Number(dish.price), badges: [...(dish.badges || [])] };
  const ai = fakeAi([() => toolCall("update_dish", { id: dish.id, fields: { price: 5, badges: ["new"] } }), () => ({ content: "done" })]);
  const app = createApp({ db, env, ai });
  await admin(app).post("/api/admin/agent").send({ ...say("make it 5"), chat_id: "c2" });
  assert.equal(Number((await db.getDish(dish.id)).price), 5);
  await runTool(app, "undo_last", {}, "c2");
  const back = await db.getDish(dish.id);
  assert.equal(Number(back.price), before.price);
  assert.deepEqual(back.badges, before.badges);

  const count = (await db.listDishes()).length;
  await runTool(app, "create_dish", { fields: { name_ar: "تجربة", price: 10, category: CAT0 } }, "c3");
  assert.equal((await db.listDishes()).length, count + 1);
  await runTool(app, "undo_last", {}, "c3");
  assert.equal((await db.listDishes()).length, count);
});

test("sales_by_time by weekday counts orders, items and the best dish per day correctly", async () => {
  const { app, db } = setup();
  const [a, b] = await db.listDishes();
  await placeOrder(app, a.id, 2);
  await placeOrder(app, b.id, 1);
  await placeOrder(app, b.id, 3, "Omar");
  const [o3, o2, o1] = await db.listOrders(); // newest first
  const fri = "2026-10-02T10:00:00.000Z";
  const mon = "2026-10-05T10:00:00.000Z";
  assert.equal(new Date(fri).getUTCDay(), 5);
  assert.equal(new Date(mon).getUTCDay(), 1);
  o1.created_at = fri;
  o2.created_at = "2026-10-02T21:30:00.000Z";
  o3.created_at = mon;

  const res = await runTool(app, "sales_by_time", { by: "weekday", range: "all" });
  assert.equal(res.status, 200);
  const chart = res.body.cards.find((c) => c.kind === "chart");
  const bar = (day) => chart.bars.find((x) => x.label === day);
  assert.deepEqual(chart.bars.map((x) => x.label), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(bar("Fri").value, 2);
  assert.equal(bar("Mon").value, 1);
  assert.equal(bar("Sun").value, 0);
  const table = res.body.cards.find((c) => c.kind === "table");
  const friRow = table.rows.find((r) => r[0] === "Fri");
  assert.equal(friRow[1], 2, "orders on Friday");
  assert.equal(friRow[2], 3, "items on Friday");
  assert.equal(friRow[3], `${Math.round((Number(o1.total) + Number(o2.total)) * 100) / 100} EGP`);
  assert.equal(friRow[4], `${a.name_en || a.name_ar} ×2`);
  const monRow = table.rows.find((r) => r[0] === "Mon");
  assert.deepEqual(monRow.slice(1, 4), [1, 3, `${o3.total} EGP`]);

  // one dish only
  const one = await runTool(app, "sales_by_time", { by: "weekday", range: "all", dish_id: b.id });
  const bars = one.body.cards.find((c) => c.kind === "chart").bars;
  assert.equal(bars.find((x) => x.label === "Fri").value, 1);
  assert.equal(bars.find((x) => x.label === "Mon").value, 3);
});

test("set_badges_by_rule marks the top sellers (exclusive) after confirm; sort_menu, weekly report, CSV export", async () => {
  const { app, db } = setup();
  const [a, b, c] = await db.listDishes();
  await db.updateDish(c.id, { badges: ["popular"] });
  await placeOrder(app, b.id, 5);
  await placeOrder(app, a.id, 2);
  const res = await runTool(app, "set_badges_by_rule", { badge: "popular", rule: "top_ordered", count: 2 });
  const action = res.body.actions.find((x) => x.type === "confirm");
  assert.ok(action);
  assert.ok(!(await db.getDish(b.id)).badges.includes("popular"));
  await admin(app).post("/api/admin/agent").send({ confirm_token: action.token, chat_id: "t1" });
  assert.ok((await db.getDish(a.id)).badges.includes("popular"));
  assert.ok((await db.getDish(b.id)).badges.includes("popular"));
  assert.ok(!(await db.getDish(c.id)).badges.includes("popular"), "removed from the rest");

  const sort = await runTool(app, "sort_menu", { by: "popularity" });
  const tok = sort.body.actions.find((x) => x.type === "confirm").token;
  const firstBefore = (await db.listDishes())[0].id;
  await admin(app).post("/api/admin/agent").send({ confirm_token: tok, chat_id: "t1" });
  assert.equal((await db.listDishes())[0].id, b.id);
  await runTool(app, "undo_last", {}, "t1");
  assert.equal((await db.listDishes())[0].id, firstBefore, "undo puts the old order back");

  const rep = await runTool(app, "weekly_report");
  const md = rep.body.cards.find((x) => x.kind === "markdown").text;
  assert.match(md, /Revenue:/);
  assert.match(md, /Top dishes/);
  assert.ok(md.includes(b.name_en || b.name_ar));

  const csv = await runTool(app, "export_orders", { range: "7d" });
  const link = csv.body.cards.find((x) => x.kind === "link");
  const file = await admin(app).get(link.href);
  assert.equal(file.status, 200);
  assert.match(file.headers["content-type"], /text\/csv/);
  assert.equal(file.text.trim().split("\r\n").length, 3, "header + 2 orders");
  assert.equal((await request(app).get(link.href)).status, 401);
});

test("dashboard period stats compare with the previous period; chef tools are picked per message", async () => {
  const { app, db } = setup();
  const [a] = await db.listDishes();
  for (let i = 0; i < 3; i++) await placeOrder(app, a.id, 1);
  const [x] = await db.listOrders();
  x.created_at = new Date(Date.now() - 9 * 864e5).toISOString(); // falls in the previous 7 days
  const s = (await admin(app).get("/api/admin/stats").query({ tz: "UTC", range: "7d" })).body;
  assert.equal(s.period.current.orders, 2);
  assert.equal(s.period.previous.orders, 1);
  assert.equal(s.period.change.orders, 100);
  assert.equal(s.period.series.length, 7);
  assert.equal(s.period.top_dishes[0].id, a.id);
  assert.ok(s.activity.some((e) => e.type === "order"));
  const all = (await admin(app).get("/api/admin/stats").query({ tz: "UTC", range: "all" })).body;
  assert.equal(all.period.current.orders, 3);
  assert.equal(all.period.previous, null);

  const names = (t) => toolsFor(t).map((t2) => t2.function.name);
  assert.ok(names("raise all prices 10%").includes("bulk_price"));
  assert.ok(!names("hi chef").includes("bulk_price"));
  assert.ok(names("which dish sells best on Fridays?").includes("sales_by_time"));
  assert.ok(names("hi chef").length <= 6);
});
