// Admin chef assistant (tool loop with a scripted fake AI) + the admin extras it shares helpers with.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { createMemoryStore } = require("../src/db/memory");
const auth = require("../src/auth");
const { explainError } = require("../src/routes/ai-admin");

const env = { ADMIN_PATH: "secret-kitchen", ADMIN_PASSWORD: "pw123", SESSION_SECRET: "s3cret" };

function fakeAi(script, { generate } = {}) {
  const calls = [];
  return {
    enabled: true,
    calls,
    diagnostics: () => ({ providers: ["groq"], usage: { day: new Date().toISOString().slice(0, 10), count: 3 }, cap: 400, lastErrors: [{ at: new Date().toISOString(), msg: "chat groq: groq chat 429: rate limit" }] }),
    async chat({ messages, tools }) {
      calls.push({ messages: structuredClone(messages), tools });
      const step = script[calls.length - 1];
      return step ? step(messages) : { content: "done" };
    },
    generate: generate || (async () => null),
  };
}
const toolCall = (name, args, id = `c_${name}`) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const lastTool = (messages) => JSON.parse(messages.filter((m) => m.role === "tool").at(-1).content);
const admin = (app) => request.agent(app).set("Cookie", `${auth.COOKIE_NAME}=${auth.createToken(env.SESSION_SECRET)}`);
const say = (...texts) => ({ messages: texts.map((content, i) => ({ role: i % 2 ? "assistant" : "user", content })) });

function setup(script = [], opts) {
  const db = createMemoryStore();
  const ai = fakeAi(script, opts);
  return { db, ai, app: createApp({ db, env, ai }) };
}

test("chef agent needs the admin cookie", async () => {
  const { app, ai } = setup([() => ({ content: "hi" })]);
  assert.equal((await request(app).post("/api/admin/agent").send(say("hi"))).status, 401);
  assert.equal((await request(app).get("/api/admin/agent")).status, 401);
  assert.equal(ai.calls.length, 0);
});

test("chef agent list_dishes returns real dishes (incl. hidden) as a card", async () => {
  const { app, db } = setup([
    () => toolCall("list_dishes", { visibility: "hidden" }),
    (messages) => ({ content: `${lastTool(messages).count} hidden يا شيف` }),
  ]);
  const [a] = await db.listDishes();
  await db.updateDish(a.id, { is_visible: false });
  const res = await admin(app).post("/api/admin/agent").send(say("which dishes are hidden?"));
  assert.equal(res.status, 200);
  assert.equal(res.body.reply, "1 hidden يا شيف");
  const card = res.body.cards.find((c) => c.kind === "dishes");
  assert.deepEqual(card.items.map((d) => d.id), [a.id]);
  assert.equal(card.items[0].visible, false);
});

test("chef agent update_dish uses the admin validation and refreshes the dishes tab", async () => {
  const db = createMemoryStore();
  const [dish] = await db.listDishes();
  const ai = fakeAi([
    () => toolCall("update_dish", { id: dish.id, fields: { price: -5 } }),
    () => toolCall("update_dish", { id: "nope", fields: { price: 10 } }),
    () => toolCall("update_dish", { id: dish.id, fields: { price: 77, badges: ["spicy", "new"] } }),
    () => ({ content: "fixed" }),
  ]);
  const app = createApp({ db, env, ai });
  const res = await admin(app).post("/api/admin/agent").send(say("fix the price"));
  assert.equal(res.status, 200);
  const results = ai.calls.at(-1).messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  assert.match(results[0].error, /price/);
  assert.match(results[1].error, /No dish/);
  assert.equal(results[2].ok, true);
  const saved = await db.getDish(dish.id);
  assert.equal(saved.price, 77);
  assert.deepEqual(saved.badges, ["spicy", "new"]);
  assert.ok(res.body.actions.some((a) => a.type === "refresh" && a.tabs.includes("dishes")));
});

test("chef agent delete needs an explicit confirmation", async () => {
  const script = (id) => [() => toolCall("delete_dish", { id, confirm: true }), () => ({ content: "Sure? press confirm" })];
  const db = createMemoryStore();
  const [dish] = await db.listDishes();
  const app = createApp({ db, env, ai: fakeAi(script(dish.id)) });

  // confirm: true without the user saying yes is ignored -> nothing deleted, a signed confirm action instead
  const res = await admin(app).post("/api/admin/agent").send(say(`delete ${dish.name_en}`));
  assert.equal(res.status, 200);
  assert.ok(await db.getDish(dish.id), "dish must still exist");
  const action = res.body.actions.find((a) => a.type === "confirm");
  assert.equal(action.tool, "delete_dish");
  assert.match(action.summary, /Delete/);

  // a tampered token is rejected, the real one deletes and returns a summary
  assert.equal((await admin(app).post("/api/admin/agent").send({ confirm_token: action.token + "x" })).status, 400);
  assert.ok(await db.getDish(dish.id));
  const done = await admin(app).post("/api/admin/agent").send({ confirm_token: action.token });
  assert.equal(done.status, 200);
  assert.equal(done.body.done, true);
  assert.match(done.body.reply, /Deleted/);
  assert.equal(await db.getDish(dish.id), null);
  assert.ok(done.body.actions.some((a) => a.type === "refresh" && a.tabs.includes("dishes")));

  // replaying the token after the dish is gone fails cleanly
  assert.equal((await admin(app).post("/api/admin/agent").send({ confirm_token: action.token })).status, 409);

  // typed "yes" right after the assistant asked: confirm: true is honored
  const db2 = createMemoryStore();
  const [d2] = await db2.listDishes();
  const app2 = createApp({ db: db2, env, ai: fakeAi(script(d2.id)) });
  const yes = await admin(app2).post("/api/admin/agent").send(say("delete it", "Sure? press confirm", "yes"));
  assert.equal(yes.status, 200);
  assert.equal(await db2.getDish(d2.id), null);
});

test("chef agent direct runs: find_issues, stats, and destructive runs only return a confirm", async () => {
  const { app, db } = setup();
  const [a, b] = await db.listDishes();
  await db.updateDish(b.id, { name_ar: a.name_ar, description: "" });
  await request(app).post("/api/orders").send({ customer_name: "Sara Ahmed", payment_method: "vibes", items: [{ dish_id: a.id, size: "half", addons: [], qty: 2 }] });

  const issues = await admin(app).post("/api/admin/agent").send({ run: { tool: "find_issues" } });
  const card = issues.body.cards.find((c) => c.kind === "issues");
  const row = card.items.find((d) => d.id === b.id);
  assert.ok(row.issues.some((i) => /duplicate/.test(i)) && row.issues.some((i) => /description/.test(i)));

  const stats = await admin(app).post("/api/admin/agent").send({ run: { tool: "order_stats", args: { range: "today" } } });
  const kpis = stats.body.cards.find((c) => c.kind === "stats").kpis;
  assert.equal(kpis.find((k) => k.label === "Orders").value, 1);
  const customers = stats.body.cards.find((c) => c.title.includes("customers"));
  assert.deepEqual(customers.rows[0].slice(0, 2), ["Sara", 1]);

  const del = await admin(app).post("/api/admin/agent").send({ run: { tool: "reset_leaderboard", args: { confirm: true } } });
  assert.ok(del.body.actions.some((x) => x.type === "confirm"));
  assert.equal(await db.getSetting("leaderboard_since"), null);
  assert.equal((await admin(app).post("/api/admin/agent").send({ run: { tool: "rm_rf" } })).status, 400);
});

test("chef agent falls back without AI and still answers simple questions", async () => {
  const db = createMemoryStore();
  const app = createApp({ db, env, ai: { enabled: false, generate: async () => null, chat: async () => null } });
  const res = await admin(app).post("/api/admin/agent").send(say("what needs fixing?"));
  assert.equal(res.status, 200);
  assert.equal(res.body.fallback, true);
  assert.ok(res.body.cards.some((c) => c.kind === "issues"));
  const plain = await admin(app).post("/api/admin/agent").send(say("tell me a joke"));
  assert.equal(plain.body.fallback, true);
  assert.deepEqual(plain.body.cards, []);
});

test("write_dish_copy fills only empty fields; suggest_menu_ideas saves nothing", async () => {
  const gen = [];
  const { app, db } = setup([], {
    generate: async (args) => {
      gen.push(args);
      if (/Invent/.test(args.prompt)) return JSON.stringify({ ideas: [{ name_ar: "فول التيم", name_en: "Team Ful", job_title: "x", description: "d", price: 5000, category: "nope", badges: ["fake", "new"] }] });
      return JSON.stringify({ dishes: [{ i: 0, description: "fresh desc", job_title: "Boss", catchphrase: "yalla", warnings: "drama" }] });
    },
  });
  const [dish] = await db.listDishes();
  await db.updateDish(dish.id, { description: "", job_title: "Keep me" });
  const before = (await db.listDishes()).length;
  const res = await admin(app).post("/api/admin/agent").send({ run: { tool: "write_dish_copy", args: { ids: [dish.id] } } });
  assert.equal(res.status, 200);
  const saved = await db.getDish(dish.id);
  assert.equal(saved.description, "fresh desc");
  assert.equal(saved.job_title, "Keep me");
  assert.equal(saved.catchphrase, "yalla");

  const ideas = await admin(app).post("/api/admin/agent").send({ run: { tool: "suggest_menu_ideas", args: { count: 1 } } });
  const card = ideas.body.cards.find((c) => c.kind === "ideas");
  assert.equal(card.items[0].price, 999);
  assert.equal(card.items[0].category, "picks");
  assert.deepEqual(card.items[0].badges, ["new"]);
  assert.equal((await db.listDishes()).length, before);
});

test("admin extras: bulk update, import, export, highlight, dated leaderboard reset, settings", async () => {
  const { app, db } = setup();
  const agent = admin(app);
  const [a, b] = await db.listDishes();
  assert.equal((await request(app).post("/api/admin/dishes/bulk").send({ ids: [a.id], fields: { category: "fatta" } })).status, 401);
  const bulk = await agent.post("/api/admin/dishes/bulk").send({ ids: [a.id, b.id], fields: { category: "fatta" }, add_badges: ["new"] });
  assert.equal(bulk.body.updated, 2);
  assert.equal((await db.getDish(b.id)).category, "fatta");
  assert.ok((await db.getDish(b.id)).badges.includes("new"));
  assert.equal((await agent.post("/api/admin/dishes/bulk").send({ ids: [a.id], fields: { category: "nope" } })).status, 400);

  const before = (await db.listDishes()).length;
  const bad = await agent.post("/api/admin/dishes/import").send({ dishes: [{ name_ar: "x", price: 1, category: "fatta" }, { name_ar: "y", price: -1, category: "fatta" }] });
  assert.equal(bad.status, 400);
  assert.equal((await db.listDishes()).length, before, "nothing written when one dish is invalid");
  const imp = await agent.post("/api/admin/dishes/import").set("Content-Type", "application/vnd.zk-import+json").send(JSON.stringify({ dishes: [{ name_ar: "جديد", price: "12", category: "fatta" }, { name_ar: a.name_ar, price: 1, category: "fatta" }] }));
  assert.deepEqual([imp.body.created, imp.body.skipped], [1, 1]);

  const review = await db.createReview({ dish_id: a.id, author_name: "R", chili_rating: 2, awkward_rating: 1, body: "meh" });
  assert.equal((await agent.post(`/api/admin/reviews/${review.id}/highlight`).send({ on: true })).status, 200);
  assert.equal((await agent.get("/api/admin/reviews")).body[0].highlighted, true);
  assert.equal((await agent.post("/api/admin/reviews/nope/highlight").send({})).status, 404);

  const exp = await agent.get("/api/admin/export");
  assert.equal(exp.status, 200);
  assert.equal(exp.body.dishes.length, before + 1);
  assert.deepEqual(exp.body.settings.highlighted_reviews, [review.id]);

  assert.equal((await agent.post("/api/admin/leaderboard/reset").send({ since: "2999-01-01" })).status, 400);
  const reset = await agent.post("/api/admin/leaderboard/reset").send({ since: "2026-01-05" });
  assert.equal(reset.body.since, new Date("2026-01-05").toISOString());
  const settings = await agent.get("/api/admin/settings");
  assert.equal(settings.body.leaderboard_since, reset.body.since);
  assert.equal(settings.body.ai.cap, 400);
});

test("AI status explains provider errors in plain language", async () => {
  const { app } = setup();
  const s = await admin(app).get("/api/admin/ai/status");
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.providers.map((p) => [p.name, p.connected]), [["gemini", false], ["groq", true]]);
  assert.equal(s.body.usage.used, 3);
  assert.match(s.body.errors[0].text, /Groq hit its per-minute limit/);
  assert.match(explainError("generate gemini: Gemini 401"), /rejected the API key/);
  assert.match(explainError("chat gemini: The operation was aborted"), /12 seconds/);
});

test("admin stats include 7-day numbers, top customers by first name, busiest hour and chili spread", async () => {
  const { app, db } = setup();
  const [a] = await db.listDishes();
  for (const name of ["Omar Khaled", "omar", "Mona"]) await request(app).post("/api/orders").send({ customer_name: name, payment_method: "vibes", items: [{ dish_id: a.id, size: "half", addons: [], qty: 1 }] });
  await db.createReview({ dish_id: a.id, author_name: "R", chili_rating: 5, awkward_rating: 1, body: "W" });
  const s = (await admin(app).get("/api/admin/stats").query({ tz: "UTC" })).body;
  assert.equal(s.orders_7d, 3);
  assert.equal(s.top_customers[0].name, "Omar");
  assert.equal(s.top_customers[0].orders, 2);
  assert.equal(s.busiest_hour.count, 3);
  assert.equal(s.busiest_hour.hour, new Date().getUTCHours());
  assert.equal(s.chili_distribution[5], 1);
  assert.equal(s.best_rated[0].id, a.id);
  assert.ok(s.orders_per_day.at(-1).revenue > 0);
});
