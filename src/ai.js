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

async function gemini(env, { system, prompt, maxTokens, temperature, json, images = [] }) {
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await withTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      // images: [{ mime, data(base64) }] so Gemini can "see" e.g. the dish photo
      contents: [{ role: "user", parts: [...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: prompt }] }],
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

// OpenAI-compatible chat completions with tool calling. Groq speaks it natively and Gemini has
// a compatibility endpoint, so the chatbot agent uses one format for both.
const CHAT_ENDPOINTS = {
  groq: (env) => ({ url: "https://api.groq.com/openai/v1/chat/completions", key: env.GROQ_API_KEY, model: env.GROQ_AGENT_MODEL || "openai/gpt-oss-120b" }),
  gemini: (env) => ({ url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", key: env.GEMINI_API_KEY, model: env.GEMINI_AGENT_MODEL || env.GEMINI_MODEL || "gemini-flash-latest" }),
};

async function chatCompletion(env, name, { messages, tools, maxTokens, temperature }) {
  const { url, key, model } = CHAT_ENDPOINTS[name](env);
  const res = await withTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
      temperature,
      max_tokens: maxTokens * 10,
      ...(name === "groq" ? { reasoning_effort: "low" } : {}),
    }),
  });
  if (!res.ok) throw new Error(`${name} chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message || null;
}

function createAi(env = process.env) {
  const providers = [];
  if (env.GEMINI_API_KEY) providers.push(["gemini", gemini]);
  if (env.GROQ_API_KEY) providers.push(["groq", groq]);

  return {
    enabled: providers.length > 0,
    providers: providers.map(([name]) => name),
    /**
     * One chat turn with optional tools. Returns the assistant message
     * ({ content, tool_calls }) or null. Groq first for the agent: it is faster at tool use.
     */
    async chat({ messages, tools = [], maxTokens = 400, temperature = 0.9 }) {
      if (!providers.length || !underCap()) return null;
      usage.count++;
      const order = ["groq", "gemini"].filter((n) => providers.some(([p]) => p === n));
      for (const name of order) {
        try {
          const msg = await chatCompletion(env, name, { messages, tools, maxTokens, temperature });
          if (msg) return msg;
        } catch (err) {
          console.warn(`AI chat provider ${name} failed: ${err.message}`);
        }
      }
      return null;
    },
    /** Returns the model's text, or null if AI is off, over the daily cap, or every provider failed. */
    async generate({ system, prompt, maxTokens = 300, temperature = 1, json = false, images = [] }) {
      if (!providers.length || !underCap()) return null;
      usage.count++;
      // Only Gemini reads images here; Groq gets the text-only version
      for (const [name, call] of providers) {
        try {
          const text = await call(env, { system, prompt, maxTokens, temperature, json, images: name === "gemini" ? images : [] });
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
