// The chatbot agent's tool loop, driven by a scripted fake AI (no network).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { createMemoryStore } = require("../src/db/memory");

// script: list of functions (messages) => assistant message; one per ai.chat call
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
  };
}
const toolCall = (name, args, id = `c_${name}`) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
const lastTool = (messages) => JSON.parse(messages.filter((m) => m.role === "tool").at(-1).content);

async function setup(script) {
  const db = createMemoryStore();
  const ai = fakeAi(script);
  const app = createApp({ db, env: {}, ai });
  const dishes = await db.listDishes();
  return { db, ai, app, dishes };
}
const say = (text, extra = {}) => ({ messages: [{ role: "user", content: text }], cart: [], orders: [], ...extra });

test("agent add_to_cart returns the new cart priced on the server", async () => {
  const db = createMemoryStore();
  const mandi = (await db.listDishes()).find((d) => d.price === 189);
  const ai = fakeAi([
    () => toolCall("add_to_cart", { dish_id: mandi.id, size: "whole", qty: 2, addons: ["aura", "tahini"] }),
    (messages) => ({ content: `added ${lastTool(messages).added.name_en} يا وحش` }),
  ]);
  const app = createApp({ db, env: {}, ai });
  const res = await request(app).post("/api/agent").send(say("add 2 whole mandi with aura and tahini"));
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /added Ahmed Mandi/);
  assert.equal(res.body.cart.length, 1);
  const line = res.body.cart[0];
  assert.equal(line.unit_price, 189 * 1.8 + 10 + 67);
  assert.equal(line.qty, 2);
  assert.equal(line.key, `${mandi.id}|whole|aura,tahini`);
  assert.ok(line.name_en && "photo_url" in line);
  assert.ok(res.body.actions.some((a) => a.type === "cart_updated"));
});

test("agent place_order creates a real order from the current cart", async () => {
  const { app, db, dishes } = await setup([
    () => toolCall("place_order", { customer_name: "Sara", payment_method: "insults" }),
    (messages) => ({ content: `order #${lastTool(messages).order_number}` }),
  ]);
  const intern = dishes.find((d) => d.price === 35);
  const res = await request(app)
    .post("/api/agent")
    .send(say("place my order, name Sara", { cart: [{ dish_id: intern.id, size: "half", addons: [], qty: 3, unit_price: 0.01 }] }));
  assert.equal(res.status, 200);
  const placed = res.body.actions.find((a) => a.type === "order_placed");
  assert.ok(placed);
  assert.equal(res.body.reply, `order #${placed.order_number}`);
  assert.ok(placed.url.startsWith(`/order?n=${placed.order_number}&dish=`));
  assert.deepEqual(res.body.cart, []);
  const [order] = await db.listOrders();
  assert.equal(order.order_number, placed.order_number);
  assert.equal(order.items[0].unit_price, 35);
  assert.equal(order.payment_method, "insults");
});

test("agent rejects invalid and sold-out dishes gracefully", async () => {
  const db = createMemoryStore();
  const sold = (await db.listDishes()).find((d) => d.badges.includes("sold_out"));
  const ai = fakeAi([
    () => toolCall("add_to_cart", { dish_id: "nope-not-real" }),
    () => toolCall("add_to_cart", { dish_id: sold.id }),
    () => ({ tool_calls: [{ id: "x", type: "function", function: { name: "add_to_cart", arguments: "{not json" } }] }),
    () => ({ content: "can't do that habibi" }),
  ]);
  const app = createApp({ db, env: {}, ai });
  const res = await request(app).post("/api/agent").send(say("add the ghost dish"));
  assert.equal(res.status, 200);
  assert.equal(res.body.reply, "can't do that habibi");
  assert.deepEqual(res.body.cart, []);
  const tools = ai.calls[3].messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
  assert.match(tools[0].error, /No dish/);
  assert.match(tools[1].error, /sold out/);
  assert.ok(tools[2].error);
});

test("agent track_order and return_order are real tool calls", async () => {
  const { app } = await setup([
    () => toolCall("track_order", { order_number: 999 }),
    (m) => ({ content: lastTool(m).error }),
  ]);
  const res = await request(app).post("/api/agent").send(say("track 999", { orders: [999] }));
  assert.equal(res.status, 200);
  assert.match(res.body.reply, /No order #999/);

  const { app: app2 } = await setup([() => toolCall("return_order", { order_number: 1 }), (m) => ({ content: String(lastTool(m).refused) })]);
  const r2 = await request(app2).post("/api/agent").send(say("refund me"));
  assert.equal(r2.body.reply, "true");
});

test("agent falls back with 503 when AI is off, and validates input", async () => {
  const db = createMemoryStore();
  const app = createApp({ db, env: {}, ai: { enabled: false, chat: async () => null } });
  const res = await request(app).post("/api/agent").send(say("hi"));
  assert.equal(res.status, 503);
  assert.equal(res.body.fallback, true);
  assert.ok(res.body.reply.length > 5);

  const off = createApp({ db, env: {}, ai: { enabled: true, chat: async () => null } });
  assert.equal((await request(off).post("/api/agent").send(say("hi"))).status, 503);

  assert.equal((await request(app).post("/api/agent").send({ messages: [] })).status, 400);
  assert.equal((await request(app).post("/api/agent").send({ messages: [{ role: "assistant", content: "x" }] })).status, 400);
});

test("agent recommend uses real prices, order counts and fits the budget", async () => {
  const { app, db, dishes } = await setup([
    () => toolCall("recommend", { budget: 200, people: 2 }),
    (m) => ({ content: `picked ${lastTool(m).picks.length}` }),
  ]);
  const cheap = dishes.find((d) => d.price === 35);
  await db.createOrder({ customer_name: "X", items: [{ dish_id: cheap.id, name_en: cheap.name_en, size: "half", addons: [], qty: 5, unit_price: 35 }], subtotal: 175, fees: [], total: 175, payment_method: "vibes" });
  const res = await request(app).post("/api/agent").send(say("رشحلي حاجة لاتنين بـ 200"));
  assert.equal(res.status, 200);
  const rec = res.body.actions.find((a) => a.type === "recommend");
  assert.ok(rec && rec.picks.length >= 1 && rec.picks.length <= 3);
  assert.equal(rec.people, 2);
  for (const p of rec.picks) {
    assert.ok(p.line_total <= 200, `${p.name_en} ${p.line_total}`);
    assert.ok(p.reason && p.photo_url !== undefined && p.tag);
  }
  assert.equal(new Set(rec.picks.map((p) => p.id)).size, rec.picks.length);
  const counted = rec.picks.find((p) => p.id === cheap.id);
  if (counted) assert.equal(counted.orders, 5);
  assert.deepEqual(res.body.cart, []); // recommending never touches the cart
});

test("agent reorder_last re-adds a previous order's items into the cart", async () => {
  const { app, db, dishes } = await setup([
    () => toolCall("reorder_last", {}),
    (m) => ({ content: `added ${lastTool(m).added.length}` }),
  ]);
  const [a, b] = dishes.filter((d) => d.is_visible && d.category !== "expired" && !d.badges.includes("sold_out"));
  const sold = dishes.find((d) => d.badges.includes("sold_out"));
  const order = await db.createOrder({
    customer_name: "Sara",
    items: [
      { dish_id: a.id, name_en: a.name_en, size: "whole", addons: ["tahini"], qty: 2 },
      { dish_id: b.id, name_en: b.name_en, size: "half", addons: [], qty: 1 },
      { dish_id: sold.id, name_en: sold.name_en, size: "half", addons: [], qty: 1 },
    ],
    subtotal: 1, fees: [], total: 1, payment_method: "vibes",
  });
  const res = await request(app).post("/api/agent").send(say("same as last time", { orders: [order.order_number] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.reply, "added 2");
  assert.equal(res.body.cart.length, 2);
  assert.equal(res.body.cart[0].key, `${a.id}|whole|tahini`);
  assert.equal(res.body.cart[0].qty, 2);
  assert.ok(res.body.actions.some((x) => x.type === "cart_updated" && x.what === "reorder"));
});

test("agent post_review creates a real, filtered review and validates ratings", async () => {
  const { app, db, dishes } = await setup([
    () => toolCall("post_review", { dish_id: dishes[0].id, chili: 9, awkward: 2, body: "x" }),
    () => toolCall("post_review", { dish_id: dishes[0].id, chili: 4, awkward: 2, body: "too much shit tahini" }),
    () => toolCall("post_review", { dish_id: dishes[0].id, chili: 5, awkward: 1, body: "again" }),
    (m) => ({ content: m.filter((x) => x.role === "tool").map((x) => (JSON.parse(x.content).error ? "E" : "OK")).join(",") }),
  ]);
  const res = await request(app).post("/api/agent").send(say("rate the first one 4 chilis 2 awkward: too much shit tahini", { name: "Mona" }));
  assert.equal(res.status, 200);
  assert.equal(res.body.reply, "E,OK,E"); // bad rating, then posted, then one-per-message cap
  const reviews = await db.listReviews(dishes[0].id);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].author_name, "Mona");
  assert.equal(reviews[0].chili_rating, 4);
  assert.ok(!reviews[0].body.includes("shit"));
  const posted = res.body.actions.find((a) => a.type === "review_posted");
  assert.equal(posted.dish.id, dishes[0].id);
  assert.equal(posted.review.chili, 4);
});

test("agent split_bill does the math on the cart or an order", async () => {
  const { app, dishes } = await setup([
    () => toolCall("split_bill", { people: 3 }),
    (m) => ({ content: String(lastTool(m).each) }),
  ]);
  const intern = dishes.find((d) => d.price === 35);
  const res = await request(app).post("/api/agent").send(say("split it between 3", { cart: [{ dish_id: intern.id, size: "half", addons: [], qty: 2 }] }));
  const split = res.body.actions.find((a) => a.type === "split");
  const total = 70 + 49.99 + 70 * 0.14 + 120 + 0.01;
  assert.equal(split.total, Math.round(total * 100) / 100);
  assert.equal(split.people, 3);
  assert.equal(split.each, Math.ceil((split.total / 3) * 100) / 100);
  assert.ok(split.each * 3 >= split.total);
  assert.equal(res.body.reply, String(split.each));

  const { app: app2 } = await setup([() => toolCall("split_bill", { people: 1 }), (m) => ({ content: lastTool(m).error })]);
  assert.match((await request(app2).post("/api/agent").send(say("split"))).body.reply, /at least 2/);
});

test("agent slash commands run one tool without the AI, and tools are picked per message", async () => {
  const db = createMemoryStore();
  const app = createApp({ db, env: {}, ai: { enabled: false, chat: async () => null } });
  const cmd = (name, args, extra = {}) => request(app).post("/api/agent").send({ command: { name, args }, cart: [], orders: [], ...extra });

  const surprise = await cmd("surprise_me");
  assert.equal(surprise.status, 200);
  assert.equal(surprise.body.cart.length, 1);
  assert.equal(surprise.body.dishes.length, 1);

  const checkout = await cmd("open_checkout", {}, { cart: surprise.body.cart });
  const nav = checkout.body.actions.find((a) => a.type === "navigate");
  assert.equal(nav.url, "/checkout");
  assert.equal(nav.auto, true);
  assert.equal((await cmd("open_checkout")).body.ok, false);

  const named = await cmd("set_customer_name", { name: "Hoda" });
  assert.deepEqual(named.body.actions, [{ type: "set_name", name: "Hoda" }]);
  const rec = await cmd("recommend", { mood: "sweet" });
  assert.ok(rec.body.actions[0].picks.length >= 1);

  assert.equal((await cmd("place_order", {})).status, 400); // not a slash command
  assert.equal((await request(app).post("/api/agent").send({ command: { name: "nope" } })).status, 400);

  const { toolsFor } = require("../src/routes/agent");
  const names = (t) => toolsFor(t).map((x) => x.function.name);
  assert.ok(!names("hi").includes("split_bill"));
  assert.ok(names("split it between 4 friends").includes("split_bill"));
  assert.ok(names("اطلب زي المرة اللي فاتت").includes("reorder_last"));
  assert.ok(names("compare mandi vs kofta").includes("compare_dishes"));
});
