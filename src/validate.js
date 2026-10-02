// Tiny validation helpers. Errors carry status 400 and a Gen-Z flavoured message.

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function text(value, field, { min = 1, max }) {
  if (typeof value !== "string") throw bad(`skill issue: ${field} is missing`);
  const v = value.trim();
  if (v.length < min) throw bad(`skill issue: ${field} is too short`);
  if (v.length > max) throw bad(`skill issue: ${field} is too long (max ${max})`);
  return v;
}

function int(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`skill issue: ${field} must be ${min}–${max}`);
  return n;
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw bad(`skill issue: ${field} is not a real option`);
  return value;
}

function price(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw bad(`skill issue: ${field} must be a price`);
  return Math.round(n * 100) / 100;
}

module.exports = { bad, text, int, oneOf, price };
