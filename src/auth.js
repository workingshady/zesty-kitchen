const crypto = require("crypto");

const COOKIE_NAME = "zk_admin";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function createToken(secret, now = Date.now()) {
  const expires = String(now + MAX_AGE_MS);
  return `${expires}.${sign(expires, secret)}`;
}

function isValidToken(token, secret, now = Date.now()) {
  if (typeof token !== "string") return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  return safeEqual(signature, sign(expires, secret)) && Number(expires) > now;
}

function checkPassword(given, expected) {
  // Hash both sides so length differences don't leak through timingSafeEqual
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

module.exports = { COOKIE_NAME, MAX_AGE_MS, createToken, isValidToken, checkPassword };
