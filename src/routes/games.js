// Arcade leaderboard without accounts: a player claims a nickname with a 4-digit PIN.
// The PIN is stored as a salted scrypt hash; the first person to use a nickname owns it.
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { cleanText } = require("../filter");
const v = require("../validate");

// Sanity caps so a hand-crafted request can't post a billion points
const GAMES = { flappy: 2000, catch: 100000, whack: 5000, snake: 2000 };

const hashPin = (pin, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(pin, salt, 32).toString("hex")}`;

function pinMatches(pin, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const given = crypto.scryptSync(pin, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const nicknameKey = (name) => name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

const limiter = (windowMin, limit, extra = {}) =>
  rateLimit({ windowMs: windowMin * 60 * 1000, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "اهدى شوية 😤 too many tries, wait a bit" }, ...extra });

// Best score per player, highest first
function bestPerPlayer(rows, limit) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.player_id)) continue;
    seen.add(r.player_id);
    out.push({ nickname: r.nickname, score: r.score, character: r.character, created_at: r.created_at });
    if (out.length >= limit) break;
  }
  return out;
}

function gamesRouter(db) {
  const router = express.Router();
  const submitLimiter = limiter(10, 40);
  // Wrong PINs count separately so nobody can brute-force someone's nickname
  const wrongPinLimiter = limiter(15, 10, { skipSuccessfulRequests: true });

  router.get("/leaderboard", async (req, res) => {
    const game = v.oneOf(req.query.game, "game", Object.keys(GAMES));
    const limit = v.int(req.query.limit ?? 10, "limit", 1, 50);
    res.json({ game, leaderboard: bestPerPlayer(await db.topScores(game), limit) });
  });

  router.post("/scores", submitLimiter, wrongPinLimiter, async (req, res) => {
    const b = req.body || {};
    const game = v.oneOf(b.game, "game", Object.keys(GAMES));
    const nickname = cleanText(v.text(b.nickname, "nickname", { min: 2, max: 20 }));
    const pin = String(b.pin ?? "");
    if (!/^\d{4}$/.test(pin)) throw v.bad("skill issue: PIN must be 4 digits");
    const score = v.int(b.score, "score", 0, GAMES[game]);
    const character = cleanText(v.text(String(b.character ?? ""), "character", { min: 0, max: 40 }));

    const key = nicknameKey(nickname);
    let player = await db.getPlayer(key);
    if (player && !pinMatches(pin, player.pin_hash)) {
      return res.status(403).json({ error: "nickname taken (wrong PIN) · الاسم ده محجوز" });
    }
    if (!player) player = await db.createPlayer({ nickname, nickname_key: key, pin_hash: hashPin(pin) });

    await db.addScore({ player_id: player.id, game, score, character });
    const board = bestPerPlayer(await db.topScores(game), 50);
    const mine = board.findIndex((r) => nicknameKey(r.nickname) === key);
    res.json({
      best: mine >= 0 ? board[mine].score : score,
      rank: mine >= 0 ? mine + 1 : null,
      leaderboard: board.slice(0, 10),
    });
  });

  return router;
}

module.exports = { gamesRouter, GAMES };
