// Tiny AI client: Google Gemini first (best Egyptian Arabic), Groq as a fast fallback.
// Both have free tiers with no card. Keys live only in env vars; the browser never sees them.
// If no key is set (or the provider fails), callers get null and the site uses its canned jokes.

const TIMEOUT_MS = 12_000;
const DAILY_CAP = Number(process.env.AI_DAILY_CAP || 400); // stay inside free-tier limits

let usage = { day: "", count: 0 };

function underCap() {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) usage = { day, count: 0 };
  return usage.count < DAILY_CAP;
}

async function withTimeout(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function gemini(env, { system, prompt, maxTokens, temperature, json }) {
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // Newer Gemini models "think" before answering and that counts toward the output budget
      generationConfig: { temperature, maxOutputTokens: maxTokens * 10, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  // A reply cut off mid-sentence is worse than none: let the next provider try
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini reply was cut off");
  return candidate?.content?.parts?.map((p) => p.text || "").join("").trim() || null;
}

async function groq(env, { system, prompt, maxTokens, temperature, json }) {
  const res = await withTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: env.GROQ_MODEL || "openai/gpt-oss-20b",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature,
      // gpt-oss reasons before answering; keep it short and leave room for it
      reasoning_effort: "low",
      max_tokens: maxTokens * 10,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("Groq reply was cut off");
  return choice?.message?.content?.trim() || null;
}

function createAi(env = process.env) {
  const providers = [];
  if (env.GEMINI_API_KEY) providers.push(["gemini", gemini]);
  if (env.GROQ_API_KEY) providers.push(["groq", groq]);

  return {
    enabled: providers.length > 0,
    providers: providers.map(([name]) => name),
    /** Returns the model's text, or null if AI is off, over the daily cap, or every provider failed. */
    async generate({ system, prompt, maxTokens = 300, temperature = 1, json = false }) {
      if (!providers.length || !underCap()) return null;
      usage.count++;
      for (const [name, call] of providers) {
        try {
          const text = await call(env, { system, prompt, maxTokens, temperature, json });
          if (text) return text;
        } catch (err) {
          console.warn(`AI provider ${name} failed: ${err.message}`);
        }
      }
      return null;
    },
  };
}

module.exports = { createAi };
