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
