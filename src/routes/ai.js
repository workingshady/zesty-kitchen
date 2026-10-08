const express = require("express");
const rateLimit = require("express-rate-limit");
const v = require("../validate");
const { PERSONA } = require("../persona");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "اهدى habibi 😤 the AI needs a break. Try again in a minute" },
});

// Same roast for the same dish on the same day saves free-tier quota
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
const today = () => new Date().toISOString().slice(0, 10);

function dishFacts(d) {
  return [
    `Name: ${d.name_ar}${d.name_en ? ` (${d.name_en})` : ""}`,
    d.job_title && `Job title: ${d.job_title}`,
    d.catchphrase && `Catchphrase: ${d.catchphrase}`,
    d.warnings && `Contains: ${d.warnings}`,
    d.description && `Menu description: ${d.description}`,
    `Menu category: ${d.category}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function aiRouter(db, ai) {
  const router = express.Router();

  // Lets the frontend decide whether to show AI buttons or fall back to canned jokes
  router.get("/status", (req, res) => res.json({ enabled: ai.enabled }));

  const off = (res) => res.status(503).json({ error: "AI is off right now", fallback: true });

  router.post("/roast", limiter, async (req, res) => {
    const dish = await db.getDish(String(req.body?.dish_id)).catch(() => null);
    if (!dish || !dish.is_visible) return res.status(404).json({ error: "Dish not found" });
    const variant = v.int(req.body?.variant ?? 0, "variant", 0, 9);
    const text = await cached(`roast:${dish.id}:${today()}:${variant}`, () =>
      ai.generate({
        system: PERSONA,
        prompt: `Write ONE short roast (max 30 words) of this coworker as if they were a dish on the menu. Go savage and dark: sarcasm, existential office dread, a food pun.\n\n${dishFacts(dish)}\n\nReply with the roast only.`,
        maxTokens: 120,
      }),
    );
    if (!text) return off(res);
    res.json({ text: oneLine(text, 300) });
  });

  router.post("/courier", limiter, async (req, res) => {
    const message = v.text(req.body?.message, "message", { max: 200 });
    const dish = req.body?.dish_id ? await db.getDish(String(req.body.dish_id)).catch(() => null) : null;
    const text = await ai.generate({
      system: `${PERSONA}\nYou are كابتن حمادة, a lazy, sarcastic, dark-humored food-delivery courier who has given up on life, who rides an office chair with wheels.
You are delivering ${dish ? `the coworker "${dish.name_ar}"` : "a coworker"} to Desk #4. You always have an excuse (tea break, lost near HR, stuck in a meeting, the coworker escaped from the bag).
Answer the customer's WhatsApp message in character, 1–2 short sentences, mostly Egyptian Arabic.`,
      prompt: message,
      maxTokens: 90,
    });
    if (!text) return off(res);
    res.json({ text: oneLine(text, 240) });
  });

  router.post("/judge", limiter, async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 10) : [];
    if (!items.length) throw v.bad("skill issue: your cart is empty");
    const list = items.map((i) => `${v.int(i.qty ?? 1, "qty", 1, 9)}× ${v.text(String(i.name ?? ""), "name", { max: 60 })} (${v.text(String(i.size ?? "half"), "size", { max: 20 })})`).join(", ");
    const text = await ai.generate({
      system: PERSONA,
      prompt: `A customer's cart: ${list}.\nJudge this order like a brutally sarcastic, dark-humored TikTok food critic in max 2 short sentences: give it a verdict (W or L), an aura score like "+6700 aura" or "-67 aura", and one funny reason.`,
      maxTokens: 110,
    });
    if (!text) return off(res);
    res.json({ text: oneLine(text, 300) });
  });

  router.post("/translate", limiter, async (req, res) => {
    const input = v.text(req.body?.text, "text", { max: 200 });
    const text = await ai.generate({
      system: PERSONA,
      prompt: `Translate this sentence into maximum Egyptian Gen-Z brainrot (same meaning, way more slang and emojis), one sentence only:\n"${input}"`,
      maxTokens: 120,
    });
    if (!text) return off(res);
    res.json({ text: oneLine(text, 300) });
  });

  return router;
}

module.exports = { aiRouter, limiter, oneLine };
