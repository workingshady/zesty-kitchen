// Covers the logic where a bug would actually hurt: pricing, the filter, and admin security.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { createMemoryStore } = require("../src/db/memory");
const { cleanText } = require("../src/filter");
const auth = require("../src/auth");

const env = { ADMIN_PATH: "secret-kitchen", ADMIN_PASSWORD: "pw123", SESSION_SECRET: "s3cret" };

function setup() {
  const db = createMemoryStore();
  return { db, app: createApp({ db, env }) };
}

test("filter swaps rude words in English and Arabic but keeps normal words", () => {
  assert.equal(cleanText("this is fuuucking good"), "this is 🌶️🌶️🌶️ good");
  assert.equal(cleanText("يا متناك"), "يا 🌶️🌶️🌶️");
  assert.equal(cleanText("والشرموطة"), "🌶️🌶️🌶️");
  assert.equal(cleanText("class assessment كسب كسلان"), "class assessment كسب كسلان");
});

test("orders are priced on the server, ignoring client prices", async () => {
  const { app, db } = setup();
  const [mandi] = await db.listDishes(); // 189 EGP
  const res = await request(app)
    .post("/api/orders")
    .send({
      customer_name: "Sara",
      payment_method: "vibes",
      items: [{ dish_id: mandi.id, size: "whole", addons: ["tahini", "aura"], qty: 2, unit_price: 0.01 }],
    });
  assert.equal(res.status, 201);
  const unit = 189 * 1.8 + 10 + 67; // 417.2
  assert.equal(res.body.items[0].unit_price, 417.2);
  assert.equal(res.body.subtotal, 834.4);
  const fees = 49.99 + Math.round(834.4 * 0.14 * 100) / 100 + 120 + 0 + 0.01;
  assert.equal(res.body.total, Math.round((834.4 + fees) * 100) / 100);
  assert.ok(unit > 0);
});

test("orders reject unavailable add-ons, hidden dishes and bad quantities", async () => {
  const { app, db } = setup();
  const [dish] = await db.listDishes();
  const base = { customer_name: "X", payment_method: "vibes" };
  const send = (item) => request(app).post("/api/orders").send({ ...base, items: [{ dish_id: dish.id, size: "half", addons: [], qty: 1, ...item }] });

  assert.equal((await send({ addons: ["no_drama"] })).status, 400);
  assert.equal((await send({ qty: 0 })).status, 400);
  assert.equal((await send({ size: "xl" })).status, 400);
  await db.updateDish(dish.id, { is_visible: false });
  assert.equal((await send({})).status, 400);
});

test("leaderboard counts quantities and resets", async () => {
  const { app, db } = setup();
  const [a, b] = await db.listDishes();
  await request(app).post("/api/orders").send({ customer_name: "X", payment_method: "vibes", items: [{ dish_id: b.id, size: "half", addons: [], qty: 3 }] });
  let board = (await request(app).get("/api/leaderboard")).body;
  assert.equal(board.top[0].id, b.id);
  assert.equal(board.top[0].orders, 3);
  assert.notEqual(board.worst.id, b.id);

  await db.setSetting("leaderboard_since", new Date(Date.now() + 1000).toISOString());
  board = (await request(app).get("/api/leaderboard")).body;
  assert.equal(board.top.length, 0);
  assert.ok(a);
});

test("admin API needs the password cookie and rejects tampered cookies", async () => {
  const { app } = setup();
  assert.equal((await request(app).get("/api/admin/dishes")).status, 401);
  assert.equal((await request(app).post("/api/admin/login").send({ password: "nope" })).status, 401);

  const forged = `${Date.now() + 1e9}.${"x".repeat(43)}`;
  assert.equal((await request(app).get("/api/admin/dishes").set("Cookie", `${auth.COOKIE_NAME}=${forged}`)).status, 401);

  const agent = request.agent(app);
  assert.equal((await agent.post("/api/admin/login").send({ password: "pw123" })).status, 200);
  const created = await agent.post("/api/admin/dishes").send({ name_ar: "فتة", name_en: "Fatta", price: 50, category: "fatta" });
  assert.equal(created.status, 201);
  assert.equal((await agent.delete(`/api/admin/dishes/${created.body.id}`)).status, 200);
});

test("expired tokens are rejected", () => {
  const token = auth.createToken("s", Date.now() - 8 * 24 * 60 * 60 * 1000);
  assert.equal(auth.isValidToken(token, "s"), false);
  assert.equal(auth.isValidToken(auth.createToken("s"), "s"), true);
});

test("admin page only exists at the secret path", async () => {
  const { app } = setup();
  assert.equal((await request(app).get("/secret-kitchen")).status, 200);
  assert.equal((await request(app).get("/admin")).status, 404);
  assert.equal((await request(app).get("/admin.html")).status, 404);
  assert.equal((await request(app).get("/nope")).status, 404);
});

test("admin photo upload rejects non-images", async () => {
  const { app, db } = setup();
  const [dish] = await db.listDishes();
  const agent = request.agent(app);
  await agent.post("/api/admin/login").send({ password: "pw123" });
  const res = await agent.post(`/api/admin/dishes/${dish.id}/photo`).attach("photo", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
  assert.equal(res.status, 400);
});

test("replacing a photo keeps the new one and removes the old one", async () => {
  const { app, db } = setup();
  const [dish] = await db.listDishes();
  const agent = request.agent(app);
  await agent.post("/api/admin/login").send({ password: "pw123" });
  const png = await require("sharp")({ create: { width: 10, height: 10, channels: 3, background: "#f00" } }).png().toBuffer();
  const first = await agent.post(`/api/admin/dishes/${dish.id}/photo`).attach("photo", png, { filename: "a.png", contentType: "image/png" });
  const second = await agent.post(`/api/admin/dishes/${dish.id}/photo`).attach("photo", png, { filename: "b.png", contentType: "image/png" });
  assert.equal((await request(app).get(second.body.photo_url)).status, 200);
  assert.equal((await request(app).get(first.body.photo_url)).status, 404);
});

// Signs the cookie directly: the login route is rate limited (5 per 15 min) across the whole test run
function adminAgent(app) {
  return request.agent(app).set("Cookie", `${auth.COOKIE_NAME}=${auth.createToken(env.SESSION_SECRET)}`);
}

test("admin can delete a single order; unknown ids give 404", async () => {
  const { app, db } = setup();
  const [dish] = await db.listDishes();
  const order = await db.createOrder({ customer_name: "A", items: [{ dish_id: dish.id, qty: 1 }], subtotal: 1, fees: [], total: 1, payment_method: "vibes" });
  const keep = await db.createOrder({ customer_name: "B", items: [], subtotal: 1, fees: [], total: 1, payment_method: "vibes" });
  assert.equal((await request(app).delete(`/api/admin/orders/${order.id}`)).status, 401);
  const agent = adminAgent(app);
  assert.equal((await agent.delete(`/api/admin/orders/${order.id}`)).status, 200);
  assert.equal((await agent.delete(`/api/admin/orders/${order.id}`)).status, 404);
  const left = await db.listOrders();
  assert.deepEqual(left.map((o) => o.id), [keep.id]);
});

test("duplicating a dish makes a hidden copy without touching the original or its photo", async () => {
  const { app, db } = setup();
  const [dish] = await db.listDishes();
  await db.updateDish(dish.id, { photo_path: "x/y.webp", name_en: "A".repeat(60) });
  const agent = adminAgent(app);
  const res = await agent.post(`/api/admin/dishes/${dish.id}/duplicate`);
  assert.equal(res.status, 201);
  assert.notEqual(res.body.id, dish.id);
  assert.equal(res.body.is_visible, false);
  assert.equal(res.body.photo_path, null);
  assert.ok(res.body.name_en.endsWith(" (copy)") && res.body.name_en.length <= 60);
  assert.equal(res.body.price, Number(dish.price));
  const original = await db.getDish(dish.id);
  assert.equal(original.is_visible, true);
  assert.equal(original.photo_path, "x/y.webp");
  assert.equal((await agent.post("/api/admin/dishes/nope/duplicate")).status, 404);
});

test("admin stats count orders, revenue, top dishes and the 14-day chart", async () => {
  const { app, db } = setup();
  const [a, b] = await db.listDishes();
  const send = (dish, qty, payment_method) =>
    request(app).post("/api/orders").send({ customer_name: "X", payment_method, items: [{ dish_id: dish.id, size: "half", addons: [], qty }] });
  const totals = [];
  for (const [dish, qty, pay] of [[a, 1, "vibes"], [b, 3, "insults"], [b, 1, "insults"]]) totals.push((await send(dish, qty, pay)).body.total);
  await db.createReview({ dish_id: a.id, author_name: "R", chili_rating: 4, awkward_rating: 1, body: "ok" });
  await db.createReview({ dish_id: a.id, author_name: "S", chili_rating: 1, awkward_rating: 1, body: "meh" });
  await db.updateDish(b.id, { is_visible: false });

  const agent = adminAgent(app);
  assert.equal((await request(app).get("/api/admin/stats")).status, 401);
  const res = await agent.get("/api/admin/stats").query({ tz: "Not/AZone" });
  assert.equal(res.status, 200);
  const s = res.body;
  assert.equal(s.total_orders, 3);
  assert.equal(s.orders_today, 3);
  assert.equal(s.revenue, Math.round(totals.reduce((x, y) => x + y, 0) * 100) / 100);
  assert.equal(s.avg_order_value, Math.round((s.revenue / 3) * 100) / 100);
  assert.equal(s.top_dishes[0].id, b.id);
  assert.equal(s.top_dishes[0].qty, 4);
  assert.equal(s.top_payment_method.method, "insults");
  assert.equal(s.reviews_count, 2);
  assert.equal(s.avg_chili, 2.5);
  assert.equal(s.dishes_hidden, 1);
  assert.equal(s.orders_per_day.length, 14);
  assert.equal(s.orders_per_day.at(-1).count, 3);
  assert.ok(s.needs_attention.some((d) => d.id === b.id && d.issues.includes("hidden")));
});

test("admin dish list includes review and order counts", async () => {
  const { app, db } = setup();
  const [a] = await db.listDishes();
  await request(app).post("/api/orders").send({ customer_name: "X", payment_method: "vibes", items: [{ dish_id: a.id, size: "half", addons: [], qty: 2 }] });
  await db.createReview({ dish_id: a.id, author_name: "R", chili_rating: 4, awkward_rating: 1, body: "ok" });
  const agent = adminAgent(app);
  const row = (await agent.get("/api/admin/dishes")).body.find((d) => d.id === a.id);
  assert.equal(row.order_qty, 2);
  assert.equal(row.review_count, 1);
});

test("AI features fall back cleanly when no key is set, and pass provider text through unfiltered", async () => {
  const db = createMemoryStore();
  const [dish] = await db.listDishes();
  const off = createApp({ db, env, ai: { enabled: false, generate: async () => null } });
  assert.deepEqual((await request(off).get("/api/ai/status")).body, { enabled: false });
  const r1 = await request(off).post("/api/ai/roast").send({ dish_id: dish.id });
  assert.equal(r1.status, 503);
  assert.equal(r1.body.fallback, true);

  const prompts = [];
  const fake = { enabled: true, generate: async ({ prompt }) => (prompts.push(prompt), "it's giving fucking overtime 💀") };
  const on = createApp({ db, env, ai: fake });
  const r2 = await request(on).post("/api/ai/roast").send({ dish_id: dish.id });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.text, "it's giving fucking overtime 💀"); // AI output is not word-filtered (by request)
  assert.ok(prompts[0].includes(dish.name_ar));
  assert.equal((await request(on).post("/api/ai/translate").send({ text: "" })).status, 400);
  assert.equal((await request(on).post("/api/admin/ai/bio").send({ name_ar: "x" })).status, 401);
});
