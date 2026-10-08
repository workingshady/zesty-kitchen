const express = require("express");
const v = require("../validate");
const persona = require("../persona");
const menu = require("../menu");
const { limiter, oneLine } = require("./ai");

const { PERSONA } = persona;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_B64 = 600 * 1024; // ~450 KB of image; the client shrinks to ~350 KB
// The app-wide JSON parser stops at 100 KB, so the photo request uses its own content type
const BIO_TYPE = "application/vnd.zk-bio+json";
const bigJson = express.json({ type: BIO_TYPE, limit: "800kb" });

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const LANG_STYLES = {
  ar: "pure Egyptian colloquial Arabic (Arabic script, the way Cairo texts, not fusha)",
  en: "English with Gen-Z internet slang",
  mix: "a natural Egyptian Arabic + English mix (Gen-Z code-switching)",
  franco: "Franco-Arab (Egyptian Arabic in Latin letters, like '3ayez', 'mesh', 'ya3ni')",
};
// Shared weights (~40% mix, 30% Arabic, 30% English) when persona.js has them
const randomStyle = () => {
  const key = typeof persona.pickMode === "function" ? persona.pickMode()?.key : pick(["mix", "mix", "ar", "en"]);
  return LANG_STYLES[key] || LANG_STYLES.mix;
};

// Random language per field, so fills do not all sound the same
function languagePlan() {
  const job = Math.random() < 0.2 ? LANG_STYLES.franco : randomStyle();
  return `LANGUAGE per field (follow it exactly): job_title in ${job}; description in ${randomStyle()}; catchphrase in ${randomStyle()}; warnings in ${randomStyle()}. Never fusha.`;
}

function parseImage(img) {
  if (img == null || img === "") return null;
  if (typeof img !== "object") throw v.bad("skill issue: image must be { mime, data }");
  const mime = String(img.mime || "").toLowerCase();
  if (!IMAGE_MIMES.includes(mime)) throw v.bad("skill issue: photo must be JPG, PNG or WebP");
  const data = String(img.data || "").replace(/^data:[^,]*,/, "");
  if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw v.bad("skill issue: photo data is not base64");
  if (data.length > MAX_IMAGE_B64) throw v.bad("skill issue: photo is too big for the AI (max ~450 KB)");
  return { mime, data: data.replace(/\s+/g, "") };
}

const clampInt = (n, min, max, fallback) => {
  const x = Number.parseInt(n, 10);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
};

// Admin-only helper: write the funny fields for a dish, optionally "looking" at its photo
function aiAdminRouter(ai) {
  const router = express.Router();
  // Admin-only: which providers are configured and the last provider errors
  router.get("/diag", (req, res) => res.json(ai.diagnostics ? ai.diagnostics() : {}));
  router.post("/bio", limiter, bigJson, async (req, res) => {
    const b = req.body || {};
    const nameAr = v.text(String(b.name_ar ?? ""), "name_ar", { min: 0, max: 60 });
    const nameEn = v.text(String(b.name_en ?? ""), "name_en", { min: 0, max: 60 });
    if (!nameAr && !nameEn) throw v.bad("skill issue: name is missing");
    const notes = v.text(String(b.notes ?? ""), "notes", { min: 0, max: 600 });
    const slugs = menu.CATEGORIES.map((c) => c.slug);
    const category = slugs.includes(b.category) ? b.category : "";
    const image = parseImage(b.image);

    const prompt = `Create funny menu fields for the coworker "${nameAr || nameEn}"${nameAr && nameEn ? ` (English name: ${nameEn})` : ""} on the joke menu.
${notes ? `What the admin already wrote about them (facts, keep and build on these): ${notes}\n` : ""}${category ? `Current category: ${category}\n` : ""}${
      image
        ? `A photo of them is attached. Use it ONLY for vibe, expression, setting, props, clothing style and what they are holding. NEVER mention or joke about their body, weight, face features, skin, age or attractiveness.\n`
        : ""
    }${languagePlan()}
Return JSON with keys:
- job_title (max 6 words, funny)
- description (max 25 words, food pun)
- catchphrase (max 8 words)
- warnings (max 8 words, comma list of funny "contains")
- spice_level (integer 1-5)
- category (one of: ${slugs.join(", ")})
- badges (array, max 2, subset of: ${menu.BADGES.join(", ")})
- calories (integer 0-9999, "kcal of drama")
- name_en (${nameEn ? `"${nameEn}"` : "a funny English dish-name pun for them"})`;

    const raw = await ai.generate({ system: PERSONA, prompt, maxTokens: 400, json: true, images: image ? [image] : [] });
    if (!raw) return res.status(503).json({ error: "AI is off right now. Add GEMINI_API_KEY or GROQ_API_KEY in Vercel." });
    let data;
    try {
      data = JSON.parse(String(raw).replace(/^```(json)?|```$/g, "").trim());
    } catch {
      return res.status(502).json({ error: "The AI got delulu. Try again 🙃" });
    }
    if (!data || typeof data !== "object") return res.status(502).json({ error: "The AI got delulu. Try again 🙃" });

    const badges = [...new Set((Array.isArray(data.badges) ? data.badges : []).map(String))].filter((x) => menu.BADGES.includes(x)).slice(0, 2);
    res.json({
      job_title: oneLine(data.job_title ?? "", 80),
      description: oneLine(data.description ?? "", 500),
      catchphrase: oneLine(data.catchphrase ?? "", 140),
      warnings: oneLine(data.warnings ?? "", 200),
      spice_level: clampInt(data.spice_level, 1, 5, 3),
      category: slugs.includes(data.category) ? data.category : category || slugs[0],
      badges,
      calories: clampInt(data.calories, 0, 999999, 0),
      name_en: nameEn || oneLine(data.name_en ?? "", 60),
      used_photo: Boolean(image),
    });
  });
  return router;
}

module.exports = { aiAdminRouter };
