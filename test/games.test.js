const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/create-app");
const { createMemoryStore } = require("../src/db/memory");

const env = { ADMIN_PATH: "secret-kitchen", ADMIN_PASSWORD: "pw123", SESSION_SECRET: "s3cret" };

test("arcade: nickname + PIN claims a name, best score per player ranks", async () => {
  const app = createApp({ db: createMemoryStore(), env, ai: { enabled: false } });
  const post = (body) => request(app).post("/api/games/scores").send(body);

  let r = await post({ game: "flappy", nickname: "Shady", pin: "1234", score: 12, character: "chef" });
  assert.equal(r.status, 200);
  assert.equal(r.body.rank, 1);

  assert.equal((await post({ game: "flappy", nickname: " shady ", pin: "9999", score: 50 })).status, 403); // name is taken
  assert.equal((await post({ game: "flappy", nickname: "Shady", pin: "1234", score: 30 })).body.best, 30);
  await post({ game: "flappy", nickname: "Mona", pin: "0000", score: 20 });

  const board = (await request(app).get("/api/games/leaderboard?game=flappy")).body.leaderboard;
  assert.deepEqual(board.map((x) => [x.nickname, x.score]), [["Shady", 30], ["Mona", 20]]);

  assert.equal((await post({ game: "flappy", nickname: "x", pin: "1234", score: 1 })).status, 400); // too short
  assert.equal((await post({ game: "flappy", nickname: "Zed", pin: "12", score: 1 })).status, 400); // bad PIN
  assert.equal((await post({ game: "flappy", nickname: "Zed", pin: "1234", score: 999999 })).status, 400); // over cap
  assert.equal((await post({ game: "chess", nickname: "Zed", pin: "1234", score: 1 })).status, 400); // unknown game
});

test("sitemaps: public one never leaks the admin link, admin one needs the cookie", async () => {
  const auth = require("../src/auth");
  const db = createMemoryStore();
  const app = createApp({ db, env, ai: { enabled: false } });
  const xml = await request(app).get("/sitemap.xml");
  assert.equal(xml.status, 200);
  assert.match(xml.text, /<urlset/);
  assert.match(xml.text, /\/arcade/);
  assert.ok(!xml.text.includes("secret-kitchen"));
  assert.ok(!(await request(app).get("/robots.txt")).text.includes("secret-kitchen"));

  const anon = await request(app).get("/secret-kitchen/sitemap");
  assert.equal(anon.status, 302);
  const cookie = `${auth.COOKIE_NAME}=${auth.createToken(env.SESSION_SECRET)}`;
  const full = await request(app).get("/secret-kitchen/sitemap").set("Cookie", cookie);
  assert.equal(full.status, 200);
  assert.ok(full.text.includes("/secret-kitchen"));
  assert.ok(full.text.includes("/api/admin/agent"));
});
