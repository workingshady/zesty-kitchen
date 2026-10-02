// Covers the logic where a bug would actually hurt: pricing, the filter, and admin security.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");
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
