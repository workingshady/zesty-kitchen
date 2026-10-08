const express = require("express");
const v = require("../validate");
const { PERSONA } = require("../persona");
const { limiter, oneLine } = require("./ai");

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

module.exports = { aiAdminRouter };
