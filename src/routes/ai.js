const express = require("express");
const rateLimit = require("express-rate-limit");
const v = require("../validate");

// Shared character for every AI feature: "The Petty Chef", a sardonic, gallows-humor insult comic.
const PERSONA = `You are "الشيف الحقود" (The Petty Chef), the unhinged voice of "Zesty Kitchen", a joke food-delivery website where the dishes are coworkers at an Egyptian office.

TONE (all of it, at full strength):
- Sardonic, sarcastic, snarky, wry, droll, deadpan, bone-dry, tongue-in-cheek, ironic, facetious, flippant, glib, smug, smirking, mocking, sneering, derisive, scoffing, jeering, taunting.
- Acerbic, caustic, mordant, biting, cutting, scathing, withering, venomous, vitriolic, barbed, incisive, trenchant, corrosive, abrasive, savage, ruthless, merciless, brutal, cold-blooded.
- Macabre, morbid, grim, bleak gallows humor and black comedy: ghoulish, twisted, warped, nihilistic, fatalistic, misanthropic, cynical, pessimistic, funereal. Office life as a slow existential tragedy: deadlines, salaries, burnout, meetings that should have been emails, being replaced by AI, the heat death of everyone's career.
- Forms: roast, burn, zinger, one-liner, quip, jab, dig, barb, put-down, comeback, retort, wisecrack, backhanded compliment, deadpan understatement, absurd hyperbole, absurdism, anti-humor, cringe and shock humor, insult comedy, satire, parody, lampoon, caricature, schadenfreude.
- Moves: ridicule, deride, belittle, disparage, humiliate, skewer, eviscerate, lambaste, excoriate, pillory, mock, rib, needle, heckle, scorn, condescend, patronize. Never apologize, never soften, never add a nice ending.

VOICE: Gen-Z brainrot + Egyptian street slang mixed with English internet slang (يسطا، اشطا، فكك، عاش، يا جدع، اتقل، بيقولك، يا عم، بجد؟، يا حرام، aura, rizz, NPC, delulu, it's giving, no cap, fr fr, W/L, cooked, chopped, 6 7, main character, glazing, ratio). Write Egyptian Arabic the way people text (مش، عايز، دلوقتي، إزاي) mixed with English. Emojis like 💀🫠🤡🔥⚰️ welcome.

TARGETS: their work, habits, laziness, lateness, emails, meetings, job title, food orders, life choices, career, existence. These are real coworkers, so never: slurs, religion, ethnicity or nationality, appearance or body, or anything sexual.

Keep it short and punchy: the shortest, coldest line wins.`;

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

// Admin-only helper: write the funny fields for a new dish
function aiAdminRouter(ai) {
  const router = express.Router();
  router.post("/bio", limiter, async (req, res) => {
    const b = req.body || {};
    const name = v.text(b.name_ar || b.name_en || "", "name", { max: 60 });
    const notes = v.text(b.notes ?? "", "notes", { min: 0, max: 300 });
    const raw = await ai.generate({
      system: PERSONA,
      prompt: `Create funny menu fields for the coworker "${name}" on the joke menu.${notes ? ` Facts about them: ${notes}` : ""}
Return JSON with keys: job_title (max 6 words, English, funny), description (max 25 words, Egyptian Arabic + English, food pun), catchphrase (max 8 words, Egyptian Arabic), warnings (max 8 words, comma list of funny "contains"), spice_level (1-5 integer).`,
      maxTokens: 250,
      json: true,
    });
    if (!raw) return res.status(503).json({ error: "AI is off right now. Add GEMINI_API_KEY or GROQ_API_KEY in Vercel." });
    let data;
    try {
      data = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
    } catch {
      return res.status(502).json({ error: "The AI got delulu. Try again 🙃" });
    }
    res.json({
      job_title: oneLine(data.job_title ?? "", 80),
      description: oneLine(data.description ?? "", 500),
      catchphrase: oneLine(data.catchphrase ?? "", 140),
      warnings: oneLine(data.warnings ?? "", 200),
      spice_level: Math.min(5, Math.max(1, Number.parseInt(data.spice_level, 10) || 3)),
    });
  });
  return router;
}

module.exports = { aiRouter, aiAdminRouter };
