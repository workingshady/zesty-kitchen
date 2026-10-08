const express = require("express");
const rateLimit = require("express-rate-limit");
const v = require("../validate");
const { CATEGORIES } = require("../menu");
const { PERSONA, systemFor, angleFor, languageMode } = require("../persona");

const makeLimiter = () =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "اهدى habibi 😤 the AI needs a break. Try again in a minute" },
  });
// Shared one for other AI routers (admin); each public AI router gets its own (one per app)
const limiter = makeLimiter();

// Same answer for the same input on the same day saves free-tier quota
const cache = new Map();
const cached = async (key, make) => {
  if (cache.has(key)) return cache.get(key);
  const value = await make();
  if (value) {
    if (cache.size > 500) cache.clear();
    cache.set(key, value);
  }
  return value;
};

// No word filter on AI output (by request); just tidy whitespace and cap the length
const oneLine = (text, max) => String(text).replace(/\s+/g, " ").trim().slice(0, max);
// Models like to wrap the answer in quotes or label it ("Roast: ..."); peel that off
const QUOTES = /^["'“”«»„`]+|["'“”«»„`]+$/g;
function tidy(text, max) {
  let s = oneLine(text, 2000);
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/^\*+|\*+$/g, "")
      .replace(QUOTES, "")
      .replace(/^(roast|reply|answer|excuse|horoscope|verdict|translation|vibe check|الرد|الروست)\s*[:：]\s*/i, "")
      .trim();
  }
  return s.slice(0, max);
}
const today = () => new Date().toISOString().slice(0, 10);
const TEMP = 0.85; // higher made the Arabic ramble

const catOf = (slug) => CATEGORIES.find((c) => c.slug === slug);

// Order counts for "this coworker was ordered N times" facts; one scan per minute is plenty
let countsMemo = { at: 0, map: new Map() };
async function orderCounts(db) {
  if (Date.now() - countsMemo.at < 60_000) return countsMemo.map;
  const map = new Map();
  try {
    const since = await db.getSetting("leaderboard_since");
    for (const o of await db.listOrders(since)) for (const i of o.items || []) map.set(i.dish_id, (map.get(i.dish_id) || 0) + (i.qty || 1));
  } catch {
    /* counts are a nice-to-have */
  }
  countsMemo = { at: Date.now(), map };
  return map;
}

async function dishFacts(db, d, { reviews = true } = {}) {
  const c = catOf(d.category);
  const counts = await orderCounts(db);
  const recent = reviews ? await db.listReviews(d.id).catch(() => []) : [];
  return [
    `Name (the food pun): ${d.name_ar}${d.name_en ? ` / ${d.name_en}` : ""}`,
    c && `Menu section: ${c.en} (${c.ar}), section joke: "${c.twist}"`,
    d.job_title && `Job title: ${d.job_title}`,
    d.catchphrase && `Catchphrase they always say: "${d.catchphrase}"`,
    d.warnings && `Warnings on the menu card: ${d.warnings}`,
    d.description && `Menu description: ${d.description}`,
    d.spice_level != null && `Spice level: ${d.spice_level}/5`,
    d.badges?.length && `Badges: ${d.badges.join(", ")}`,
    `Times ordered: ${counts.get(d.id) || 0}`,
    recent.length && `What reviewers said: ${recent.slice(0, 2).map((r) => `"${String(r.body).slice(0, 90)}"`).join(" · ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const SIGNS = {
  aries: "الحمل / Aries", taurus: "الثور / Taurus", gemini: "الجوزاء / Gemini", cancer: "السرطان / Cancer",
  leo: "الأسد / Leo", virgo: "العذراء / Virgo", libra: "الميزان / Libra", scorpio: "العقرب / Scorpio",
  sagittarius: "القوس / Sagittarius", capricorn: "الجدي / Capricorn", aquarius: "الدلو / Aquarius", pisces: "الحوت / Pisces",
};
// Keys belong to the frontend; the wording keeps work out of it unless the person adds that detail
const EXCUSES = {
  late: "being late (to plans, a lunch, wherever they were expected)",
  task: "not doing the thing they promised to do today",
  meeting: "missing a plan or meeting they agreed to",
  reply: "not replying to messages for 3 days",
  leave: "leaving early",
  camera: "oversleeping and missing whatever they had planned",
};
const MAX_PHOTO = 4 * 1024 * 1024;

async function loadPhoto(db, dish) {
  if (!dish.photo_path) return null;
  const dev = db.getDevPhoto?.(dish.photo_path);
  if (dev) return dev.buffer.length <= MAX_PHOTO ? { mime: dev.contentType, data: dev.buffer.toString("base64") } : null;
  const url = db.photoUrl(dish.photo_path);
  if (!/^https?:\/\//.test(url || "")) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const mime = (res.headers.get("content-type") || "").split(";")[0];
    if (!res.ok || !mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= MAX_PHOTO ? { mime, data: buf.toString("base64") } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function aiRouter(db, ai) {
  const router = express.Router();
  const limiter = makeLimiter();

  // Lets the frontend decide whether to show AI buttons or fall back to canned jokes
  router.get("/status", (req, res) => res.json({ enabled: ai.enabled }));

  const off = (res) => res.status(503).json({ error: "AI is off right now", fallback: true });
  const visibleDish = async (id) => {
    const dish = await db.getDish(String(id ?? "")).catch(() => null);
    return dish && dish.is_visible ? dish : null;
  };
  const send = (res, text, max = 320) => (text ? res.json({ text: tidy(text, max) }) : off(res));

  router.post("/roast", limiter, async (req, res) => {
    const dish = await visibleDish(req.body?.dish_id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    const variant = v.int(req.body?.variant ?? 0, "variant", 0, 9);
    const text = await cached(`roast:${dish.id}:${today()}:${variant}`, async () =>
      ai.generate({
        system: systemFor("roast"),
        prompt: `Roast this coworker. They are a dish on the menu.\n\n${await dishFacts(db, dish)}\n\nANGLE for this one: ${angleFor(variant)}.\nPick ONE fact above and build one observation on it. Max 28 words, 1–2 short sentences, punchline last, no emoji unless it really lands. Reply with the roast only.`,
        maxTokens: 120,
        temperature: TEMP,
      }),
    );
    send(res, text, 300);
  });

  router.post("/courier", limiter, async (req, res) => {
    const message = v.text(req.body?.message, "message", { max: 200 });
    const dish = req.body?.dish_id ? await visibleDish(req.body.dish_id) : null;
    const text = await ai.generate({
      system: `${PERSONA}

Right now you play كابتن حمادة, the delivery guy: a scooter older than him, a cracked phone at 3% battery, completely at peace with being late. He is delivering ${dish ? `the coworker "${dish.name_ar}"${dish.catchphrase ? ` (who keeps saying "${dish.catchphrase}")` : ""}` : "a coworker"} to the customer and is very late. Every reply has a new, specific, believable-but-absurd excuse (stopped at the ahwa "for one minute", the building has no number, the doorman sent him to the wrong tower, the coworker in the bag asked to stop for koshary, a wedding procession on the bridge). Never say he's an AI.
${languageMode()}
Reply to the customer's WhatsApp message in 1–2 short sentences, calm and lazy, no emoji. Reply only with his message.`,
      prompt: message,
      maxTokens: 90,
      temperature: TEMP,
    });
    send(res, text, 240);
  });

  router.post("/judge", limiter, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
    if (!items.length) throw v.bad("skill issue: your cart is empty");
    const list = items.map((i) => `${v.int(i.qty ?? 1, "qty", 1, 99)}× ${v.text(String(i.name ?? ""), "name", { max: 60 })} (${v.text(String(i.size ?? "half"), "size", { max: 20 })})`).join(", ");
    const totalQty = items.reduce((n, i) => n + Number(i.qty ?? 1), 0);
    const text = await ai.generate({
      system: systemFor("judge"),
      prompt: `Cart (${totalQty} coworkers total): ${list}.\nJudge it in max 2 short sentences: a verdict (W or L) and ONE specific, dry observation that uses an actual name, quantity or size from the cart (3 of the same person, a "family" size of someone, a weird combo, what this order says about their evening). Reply with the verdict only.`,
      maxTokens: 110,
      temperature: TEMP,
    });
    send(res, text, 300);
  });

  router.post("/translate", limiter, async (req, res) => {
    const input = v.text(req.body?.text, "text", { max: 200 });
    const text = await ai.generate({
      system: systemFor("translate"),
      prompt: `Rewrite this the way a funny Cairo Gen-Z friend would text it: same meaning, a couple of natural slang words (not a slang pile), one unexpected twist at the end, max 1 emoji. One sentence. Reply with the rewrite only.\n\nText: ${input}`,
      maxTokens: 120,
      temperature: TEMP,
    });
    send(res, text, 300);
  });

  // 💬 The coworker answers a review about them, in character
  router.post("/review-reply", limiter, async (req, res) => {
    const dish = await visibleDish(req.body?.dish_id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    const reviewId = v.text(String(req.body?.review_id ?? ""), "review_id", { max: 64 });
    const review = (await db.listReviews(dish.id)).find((r) => r.id === reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });
    const text = await cached(`reply:${review.id}`, async () =>
      ai.generate({
        system: systemFor("reply"),
        prompt: `You are now the coworker "${dish.name_ar}" (not the chef). Facts about you:\n${await dishFacts(db, dish, { reviews: false })}\n\nA customer named "${review.author_name}" gave you ${review.chili_rating}/5 chilis and wrote:\n"${review.body}"\n\nReply like an unbothered person answering a comment: calm, dry, clap back at something specific they wrote; use your catchphrase only if it fits. Max 25 words, no emoji. Reply with the comment only.`,
        maxTokens: 100,
        temperature: TEMP,
      }),
    );
    send(res, text, 260);
  });

  // 🔮 Daily horoscope (برجك النهارده): one per sign per day, about ordinary life, not the office
  router.post("/horoscope", limiter, async (req, res) => {
    const sign = v.oneOf(String(req.body?.sign ?? ""), "sign", Object.keys(SIGNS));
    const lang = languageMode();
    const text = await cached(`horoscope:${sign}:${today()}`, () =>
      ai.generate({
        system: systemFor("horoscope", { lang }),
        prompt: `Today's horoscope (${today()}) for ${SIGNS[sign]}. برجك النهارده: a fake, oddly specific prediction about an ordinary day: a food decision they'll regret, a message they'll leave on seen, a relative calling at the wrong time, traffic, one small win. End with a lucky something (number, snack, color). Not about work. Deadpan, max 35 words, 2 sentences. Reply with the horoscope only.`,
        maxTokens: 130,
        temperature: TEMP,
      }),
    );
    send(res, text, 320);
  });

  // 🥩 Beef or besties: the dynamic between two coworkers
  router.post("/duo", limiter, async (req, res) => {
    const [a, b] = await Promise.all([visibleDish(req.body?.a), visibleDish(req.body?.b)]);
    if (!a || !b) return res.status(404).json({ error: "Dish not found" });
    if (a.id === b.id) throw v.bad("skill issue: pick two different coworkers");
    const variant = v.int(req.body?.variant ?? 0, "variant", 0, 4);
    const pair = [a.id, b.id].sort().join("+");
    const text = await cached(`duo:${pair}:${today()}:${variant}`, async () =>
      ai.generate({
        system: systemFor("duo"),
        prompt: `Coworker A:\n${await dishFacts(db, a, { reviews: false })}\n\nCoworker B:\n${await dishFacts(db, b, { reviews: false })}\n\nDecide: are they BEEF (petty rivals) or BESTIES (chaotic duo)? Start with "🥩 BEEF" or "🤝 BESTIES", then describe their dynamic in max 35 words using one specific fact from each (catchphrase vs catchphrase, food vs food), like a scene from a family lunch or a road trip. Friendship or rivalry only, nothing romantic. Reply with that only.`,
        maxTokens: 130,
        temperature: TEMP,
      }),
    );
    send(res, text, 340);
  });

  // 🙏 Excuse generator
  router.post("/excuse", limiter, async (req, res) => {
    const situation = v.oneOf(String(req.body?.situation ?? ""), "situation", Object.keys(EXCUSES));
    const detail = req.body?.detail ? v.text(String(req.body.detail), "detail", { max: 100 }) : "";
    const text = await ai.generate({
      system: systemFor("excuse"),
      prompt: `Write the excuse message someone will send to whoever was waiting on them, for ${EXCUSES[situation]}${detail ? ` (extra context from them: ${detail})` : ""}. First person, ready to send, confident, oddly specific and believable for one second (the microbus, the building's elevator, the neighbor's wedding, the cat, a power cut, their mom), max 30 words, no emoji. Reply with the message only.`,
      maxTokens: 110,
      temperature: TEMP,
    });
    send(res, text, 300);
  });

  // 📸 Vibe check of the dish photo (Gemini vision; text-only providers get told there is no image)
  router.post("/vibe-check", limiter, async (req, res) => {
    const dish = await visibleDish(req.body?.dish_id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    if (!dish.photo_path) return res.status(400).json({ error: "No photo to vibe check 📸", fallback: true });
    if (!ai.enabled) return off(res);
    const text = await cached(`vibe:${dish.id}:${dish.photo_path}:${today()}`, async () => {
      const image = await loadPhoto(db, dish);
      if (!image) return null;
      return ai.generate({
        system: systemFor("vibe"),
        prompt: `The attached photo is the coworker "${dish.name_ar}"${dish.catchphrase ? ` (catchphrase: "${dish.catchphrase}")` : ""}. Do a vibe check: one specific thing you see about the expression, pose, background, props or lighting, and what it says about their energy, then a short dry verdict of a few words. NEVER comment on body, weight, face features, skin, hair or attractiveness. If no image is actually attached, roast them for not showing up to their own photo shoot. Max 30 words. Reply with the vibe check only.`,
        maxTokens: 120,
        temperature: TEMP,
        images: [image],
      });
    });
    send(res, text, 300);
  });

  return router;
}

module.exports = { aiRouter, limiter, oneLine, tidy, SIGNS, EXCUSES };
