// 👨‍🍳 Chef assistant: an admin-only AI agent with full kitchen access (dishes, orders, reviews, leaderboard).
// Same server-orchestrated tool loop as the waiter (routes/agent.js), but every write goes through the
// admin validation (dishFields) and destructive/bulk tools need an explicit confirmation:
//   - the model calls e.g. delete_dish without confirm -> nothing happens, the UI gets a signed "confirm" action
//     (bulk tools also get a before/after preview table);
//   - the admin clicks "Yes" -> POST { confirm_token } runs exactly that action (no AI involved), or
//   - the admin types "yes" and the model re-calls the tool with confirm: true (only honored right after a yes;
//     AI-written plans reuse the exact previewed text, kept per chat).
// Every dish change made here is recorded on a small per-chat undo stack (in memory) so "undo" can restore it.
// Tools also emit "cards" (tables, stats, charts, dish lists, markdown) so the model can keep its replies short.
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const menu = require("../menu");
const v = require("../validate");
const admin = require("./admin");

const MAX_HISTORY = 10;
const MAX_CHARS = 800;
const MAX_ROUNDS = 4;
const TOOL_RESULT_CHARS = 2500; // Groq free tier is ~8k tokens/min: keep each round small
const CONFIRM_TTL_MS = 10 * 60 * 1000;
const CAT_SLUGS = menu.CATEGORIES.map((c) => c.slug);
const RANGE_KEYS = Object.keys(admin.RANGES);
const UNDO_MAX = 15;
const CHAT_TTL_MS = 6 * 60 * 60 * 1000;
const COPY_FIELDS = { job_title: 80, description: 500, catchphrase: 140, warnings: 200, name_en: 60, name_ar: 60 };
const SNAPSHOT_FIELDS = ["name_ar", "name_en", "job_title", "catchphrase", "warnings", "spice_level", "calories", "description", "price", "category", "badges", "is_visible"];

const FALLBACK = "الـ AI نايم دلوقتي 😴 (AI is off or out of quota). The quick buttons still work: try “what needs fixing?” or “weekly report”.";

// ---------- tool schemas (OpenAI format, kept terse for token budget) ----------
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description) => ({ type: "string", ...(description ? { description } : {}) });
const int = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const ids = { type: "array", items: { type: "string" }, maxItems: 50 };
const confirm = { type: "boolean", description: "only after the user said yes" };
const range = { type: "string", enum: RANGE_KEYS };
const lang = { type: "string", enum: ["ar", "en", "mix"] };
// Category/badge lists live once in the system prompt instead of in every schema (token budget)
const fields = { type: "object", description: "name_ar, name_en, price, category, description, job_title, catchphrase, warnings, spice_level 1-5, calories, badges[], is_visible" };
const badge = str("badge key");
const badges = { type: "array", items: { type: "string" } };
const D = "Needs confirm (see rule).";

const TOOLS = [
  fn("list_dishes", "List/search dishes incl. hidden ones.", {
    query: str("words in names/job/description"),
    category: str("category slug"),
    visibility: { type: "string", enum: ["all", "visible", "hidden"] },
    badge,
    sort: { type: "string", enum: ["menu", "price_asc", "price_desc", "most_ordered", "least_ordered", "newest"] },
    limit: int(1, 30),
  }),
  fn("get_dish", "Full details of one dish.", { id: str() }, ["id"]),
  fn("create_dish", "Create a dish. Needs name_ar, price, category.", { fields }, ["fields"]),
  fn("update_dish", "Change some fields of ONE dish (also rename).", { id: str(), fields }, ["id", "fields"]),
  fn("set_visibility", "Show/hide dishes by ids, or all dishes with a badge (e.g. sold_out).", { ids, badge, visible: { type: "boolean" } }, ["visible"]),
  fn("delete_dish", `Delete a dish + its reviews. ${D}`, { id: str(), confirm }, ["id"]),
  fn("duplicate_dish", "Copy a dish (copy starts hidden, no photo).", { id: str() }, ["id"]),
  fn("list_orders", "List orders.", { range, search: str("customer, dish or #number"), limit: int(1, 30) }),
  fn("order_stats", "Orders, revenue, avg, top dishes, top customers (first names), busiest hour.", { range }),
  fn("compare_periods", "This period vs the one before (today vs yesterday, 7d vs previous 7d...).", { range: { type: "string", enum: ["today", "7d", "30d"] } }),
  fn("sales_by_time", "Orders/items/revenue per weekday or hour + best dish per bucket. Optional one dish.", { by: { type: "string", enum: ["weekday", "hour"] }, range, dish_id: str() }, ["by"]),
  fn("delete_order", `Delete an order. ${D}`, { order_number: { type: "integer" }, confirm }, ["order_number"]),
  fn("list_reviews", "List reviews.", { dish_id: str(), min_chili: int(1, 5), max_chili: int(1, 5), search: str(), older_than_days: int(1, 3650), limit: int(1, 30) }),
  fn("delete_review", `Delete a review. ${D}`, { id: str(), confirm }, ["id"]),
  fn("draft_review_replies", "AI drafts replies in the dish's voice. Not posted.", { ids, dish_id: str(), max_chili: int(1, 5), limit: int(1, 5) }),
  fn("reset_leaderboard", `Restart the public leaderboard count from now (orders stay). ${D}`, { confirm }),
  fn("suggest_menu_ideas", "AI-brainstorm funny new dish ideas. NOT saved.", { count: int(1, 5), theme: str() }),
  fn("write_dish_copy", "AI-write and SAVE text into EMPTY fields (description, job_title, catchphrase, warnings) of up to 5 dishes.", { ids: { ...ids, maxItems: 5 } }, ["ids"]),
  fn("rewrite_copy", `AI rewrite/translate text fields of up to 5 dishes (description, catchphrase, job_title, warnings, name_en, name_ar). Preview first. ${D}`, { ids: { ...ids, maxItems: 5 }, fields: { type: "array", items: { type: "string" } }, lang, style: str("e.g. shorter, funnier"), confirm }, ["ids", "fields"]),
  fn("bulk_update_badges", "Add/remove badges on dishes by ids.", { ids, add: badges, remove: badges }, ["ids"]),
  fn("set_badges_by_rule", `Give a badge to the N dishes matching a rule (e.g. top 3 ordered -> popular). exclusive removes it from the rest. ${D}`, { badge, rule: { type: "string", enum: ["top_ordered", "least_ordered", "best_rated", "worst_rated", "newest"] }, count: int(1, 10), range, exclusive: { type: "boolean" }, confirm }, ["badge", "rule"]),
  fn("bulk_price", `Change prices by percent (+10 / -15) for ids, a category, or all dishes. Preview first. ${D}`, { percent: { type: "number" }, ids, category: str(), round_to: { type: "integer", enum: [1, 5, 10] }, confirm }, ["percent"]),
  fn("move_category", `Move dishes to a category. ${D}`, { ids, category: str(), confirm }, ["ids", "category"]),
  fn("sort_menu", `Reorder the whole menu. ${D}`, { by: { type: "string", enum: ["popularity", "rating", "price_asc", "price_desc", "name"] }, confirm }, ["by"]),
  fn("find_issues", "Maintenance: no photo/description, hidden, duplicates, 0 price, hidden never ordered, stale reviews."),
  fn("export_orders", "Link to download orders as CSV.", { range }),
  fn("weekly_report", "Markdown summary of the last 7 days vs the 7 before."),
  fn("undo_last", "Undo the last dish change made in this chat."),
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.function.name, t]));
const TOOL_NAMES = new Set(TOOL_BY_NAME.keys());

// Only send the tools a message could plausibly need: every schema costs tokens on every round (Groq ~8k TPM)
const CORE = ["list_dishes", "get_dish", "update_dish", "order_stats", "find_issues", "undo_last"];
const EXTRA = [
  [/creat|new dish|add|hire|duplicat|clone|copy of|ضيف|اضاف|إضاف|جديد|نسخ/i, ["create_dish", "duplicate_dish"]],
  [/hide|show|visib|sold.?out|unhide|خبي|اخفي|إخفاء|اظهر|أظهر|خلص/i, ["set_visibility"]],
  [/delet|remov|trash|مسح|امسح|احذف|شيل/i, ["delete_dish", "delete_order", "delete_review"]],
  [/order|customer|bought|طلب|اوردر|أوردر|زبون|زباين|عملا/i, ["list_orders", "delete_order"]],
  [/review|repl|rating|hater|comment|ريفيو|تقييم|رد|كومنت/i, ["list_reviews", "delete_review", "draft_review_replies"]],
  [/leader|board|reset|ليدر|تصفير/i, ["reset_leaderboard"]],
  [/idea|brainstorm|suggest|invent|فكر|افكار|أفكار|اقترح/i, ["suggest_menu_ideas"]],
  [/writ|descri|copy|catch|phrase|transl|renam|arabic|english|rewrit|funn|text|bio|وصف|اكتب|ترجم|عربي|انجليزي|اسم/i, ["write_dish_copy", "rewrite_copy"]],
  [/badge|popular|mark|tag|label|chef.?s.?pick|spicy|بادج|علامة|مشهور/i, ["bulk_update_badges", "set_badges_by_rule"]],
  [/price|%|percent|discount|cheap|expens|raise|increas|decreas|inflat|سعر|اسعار|أسعار|خصم|غلي|رخص|زود|قلل/i, ["bulk_price"]],
  [/categor|move|section|قسم|انقل|نقل/i, ["move_category"]],
  [/sort|reorder|rank|arrange|رتب|ترتيب/i, ["sort_menu"]],
  [/weekday|day|friday|saturday|sunday|monday|tuesday|wednesday|thursday|hour|when|time|peak|busiest|يوم|ايام|أيام|جمعة|ساعة|امتى|إمتى|وقت/i, ["sales_by_time"]],
  [/\bvs\b|versus|compar|last week|previous|growth|trend|than|before|مقارن|قارن|الأسبوع اللي فات|اللي فات/i, ["compare_periods"]],
  [/export|csv|download|excel|sheet|نزل|تحميل|اكسل/i, ["export_orders"]],
  [/report|summary|recap|week|تقرير|ملخص|اسبوع|أسبوع/i, ["weekly_report", "compare_periods"]],
];
function toolsFor(text) {
  const names = new Set(CORE);
  for (const [re, list] of EXTRA) if (re.test(text)) list.forEach((n) => names.add(n));
  return TOOLS.filter((t) => names.has(t.function.name));
}

function systemPrompt(lastUserText) {
  const arabic = /[؀-ۿ]/.test(lastUserText);
  return `You are "الشيف المساعد" (Chef assistant), the admin's AI sous-chef for Zesty Kitchen, a joke Egyptian food-ordering site where the dishes are coworkers. The admin is the owner.
STYLE: professional but funny, short. Egyptian Arabic + English mix (Cairo Gen-Z texting)${arabic ? ", leaning Arabic since they wrote Arabic" : ""}. Max 3 short sentences or a few bullets. The UI already shows tool results as cards/tables, so don't repeat them; give the takeaway. No raw ids.
RULES:
- Always use tools to read or change data; never invent numbers, dishes or ids. Call list_dishes/find_issues first when you need ids.
- Tools marked "Needs confirm" (deletes, bulk_price, set_badges_by_rule, move_category, sort_menu, rewrite_copy, reset_leaderboard): call without confirm, then tell the user to press Confirm or say yes. Pass confirm=true only if their LAST message clearly says yes to that action.
- Every dish change can be undone with undo_last. Deletes can't.
- Customers: first names only.
- If a tool returns an error, say it plainly with a light joke and suggest a fix.
- Categories: ${CAT_SLUGS.join(", ")}. Badges: ${menu.BADGES.join(", ")}. Prices in EGP (half size). Today is ${new Date().toISOString().slice(0, 10)}.`;
}

// ---------- confirmation tokens (stateless, so they work across serverless instances) ----------
function signAction(secret, tool, args) {
  const body = Buffer.from(JSON.stringify({ tool, args, exp: Date.now() + CONFIRM_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", String(secret)).update(`chef:${body}`).digest("base64url");
  return `${body}.${sig}`;
}
function verifyAction(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", String(secret)).update(`chef:${body}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || typeof p.tool !== "string" || Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

const YES = /^\s*(yes|yep|yeah|ya|y|ok(ay)?|sure|confirm(ed)?|do it|go( ahead)?|delete it|apply( it)?|اه|آه|ايوه|أيوه|ايوة|أيوة|تمام|اكيد|أكيد|موافق|يلا|ماشي|امسح|احذف|امسحه|امسحها|نفذ)\b/i;
const saidYes = (messages) => messages.length > 1 && messages[messages.length - 2].role === "assistant" && YES.test(messages[messages.length - 1].content);

// ---------- per-chat memory: undo stack + the last previewed plan per tool ----------
// In memory on purpose: it lives as long as the server instance, keyed by the chat id the admin page sends
// (a random id per browser tab; the admin cookie is already required to get here).
const chats = new Map();
function chatState(key) {
  const now = Date.now();
  if (chats.size > 200) for (const [k, c] of chats) if (now - c.at > CHAT_TTL_MS || chats.size > 200) chats.delete(k);
  let c = chats.get(key);
  if (!c || now - c.at > CHAT_TTL_MS) chats.set(key, (c = { at: now, undo: [], pending: {} }));
  c.at = now;
  return c;
}
const chatKey = (chatId) => String(chatId || "default").slice(0, 64);

// ---------- request parsing ----------
function parseMessages(raw) {
  if (!Array.isArray(raw) || !raw.length) throw v.bad("skill issue: say something first 💀");
  if (raw.length > 60) throw v.bad("skill issue: conversation is too long");
  const messages = raw
    .slice(-MAX_HISTORY)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw v.bad("skill issue: the last message must be yours");
  return messages;
}
function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const x = JSON.parse(raw || "{}");
    return x && typeof x === "object" ? x : {};
  } catch {
    return {};
  }
}
const clip = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const clampInt = (n, min, max, fallback) => {
  const x = Number.parseInt(n, 10);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback;
};
const parseJson = (raw) => {
  try {
    return JSON.parse(String(raw).replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return null;
  }
};
const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(copy\)/g, "")
    .replace(/[ً-ْـ]/g, "") // Arabic diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "");
const plural = (n, word, many = `${word}es`) => `${n} ${n === 1 ? word : many}`;
const dishes_ = (n) => plural(n, "dish");
const signed = (n) => (n == null ? "–" : `${n > 0 ? "+" : ""}${n}%`);
const LANG_STYLE = { ar: "Egyptian colloquial Arabic (Arabic script, not fusha)", en: "English with light Gen-Z slang", mix: "a natural Egyptian Arabic + English mix" };
const COPY_SYSTEM = "You write funny menu copy for a joke Egyptian restaurant where every dish is an office coworker. Never fusha. Office humor only: never about bodies, religion or looks.";

// ---------- tool runtime ----------
function createSession(db, ai, { secret, tz, messages, chat }) {
  const cards = [];
  const actions = [];
  const ran = [];
  const refresh = new Set();
  const label = admin.dishLabel;
  let dishCache = null;
  const allDishes = async () => (dishCache ||= await db.listDishes());
  const dirty = (...tabs) => {
    dishCache = null;
    tabs.forEach((t) => refresh.add(t));
  };
  const card = (c) => cards.push(c);
  const note = (text) => ran.length && (ran[ran.length - 1].text = text);
  const dishRow = (d) => ({ id: d.id, name: label(d), name_ar: d.name_ar, price: Number(d.price), category: d.category, visible: Boolean(d.is_visible), badges: d.badges || [], photo_url: db.photoUrl(d.photo_path) });
  const brief = (d) => ({ id: d.id, name: label(d), price: Number(d.price), cat: d.category, visible: Boolean(d.is_visible), badges: d.badges || [] });
  const findDish = async (id) => {
    const d = await db.getDish(String(id ?? "")).catch(() => null);
    return d || null;
  };
  const noDish = (id) => ({ error: `No dish with id "${id}". Call list_dishes to get real ids.` });
  const validated = (fn) => {
    try {
      return { value: fn() };
    } catch (err) {
      if (err.status === 400) return { error: err.message };
      throw err;
    }
  };
  const orderQty = async (rk = "all") => {
    const qty = new Map();
    for (const o of admin.ordersInRange(await db.listOrders(), rk, tz)) for (const i of o.items || []) qty.set(i.dish_id, (qty.get(i.dish_id) || 0) + (Number(i.qty) || 0));
    return qty;
  };

  // ----- undo -----
  const snapshot = (d, keys) => Object.fromEntries(keys.filter((k) => SNAPSHOT_FIELDS.includes(k)).map((k) => [k, k === "price" ? Number(d[k]) : k === "badges" ? [...(d.badges || [])] : d[k]]));
  const remember = (entry) => {
    if (!chat) return;
    chat.undo.push({ ...entry, at: new Date().toISOString() });
    if (chat.undo.length > UNDO_MAX) chat.undo.shift();
  };
  /** Validates and applies [{ id, fields }] to dishes, records one undo entry. */
  async function applyPatches(undoLabel, patches) {
    const before = [];
    const updated = [];
    for (const p of patches) {
      const d = await findDish(p.id);
      if (!d) continue;
      const { value, error } = validated(() => admin.dishFields(p.fields || {}, { partial: true }));
      if (error) return { error: `${label(d)}: ${error}` };
      if (!Object.keys(value).length) continue;
      before.push({ id: d.id, fields: snapshot(d, Object.keys(value)) });
      updated.push(await db.updateDish(d.id, value));
    }
    if (updated.length) {
      remember({ label: undoLabel, dishes: before });
      dirty("dishes", "overview");
    }
    return { updated };
  }

  // ----- plans for confirm-first bulk tools: check() builds { patches } + a preview, run() applies -----
  const pendingPlan = (tool, args) => (args?.patches ? args : chat?.pending?.[tool] || null);
  const patchPlan = (tool, undoLabel, summary, patches, preview) => {
    const args = { patches, label: undoLabel };
    if (chat) chat.pending[tool] = args;
    return { args, summary, preview };
  };
  const runPatches = async (args, verb) => {
    const r = await applyPatches(args.label || verb, (args.patches || []).slice(0, 200));
    if (r.error) return r;
    if (!r.updated.length) return { error: "Nothing changed (those dishes are gone or already like that)." };
    return { ok: true, updated: r.updated.length, summary: `✅ ${verb}: ${dishes_(r.updated.length)}. Say “undo” to roll back.` };
  };
  const targetDishes = async ({ ids: list, category }) => {
    const dishes = await allDishes();
    if (Array.isArray(list) && list.length) {
      const want = new Set(list.map(String));
      return dishes.filter((d) => want.has(d.id));
    }
    if (category) return dishes.filter((d) => d.category === category);
    return dishes;
  };

  // Destructive / bulk tools: check() validates and describes (with a preview), run() does it
  const destructive = {
    delete_dish: {
      async check({ id }) {
        const d = await findDish(id);
        if (!d) return noDish(id);
        const reviews = (await db.listReviews(d.id)).length;
        return { args: { id: d.id }, summary: `Delete “${label(d)}”${reviews ? ` + ${plural(reviews, "review", "reviews")}` : ""}${d.photo_path ? " + photo" : ""}. Can't be undone.` };
      },
      async run({ id }) {
        const d = await admin.deleteDishFully(db, id);
        if (!d) return noDish(id);
        dirty("dishes", "reviews", "overview");
        return { ok: true, summary: `🗑️ Deleted “${label(d)}”.` };
      },
    },
    delete_order: {
      async check({ order_number }) {
        const n = Number(order_number);
        const o = (await db.listOrders()).find((x) => Number(x.order_number) === n);
        if (!o) return { error: `No order #${order_number}.` };
        return { args: { order_number: n }, summary: `Delete order #${n} by ${admin.firstName(o.customer_name)} (${Number(o.total)} EGP). It also stops counting on the leaderboard.` };
      },
      async run({ order_number }) {
        const o = (await db.listOrders()).find((x) => Number(x.order_number) === Number(order_number));
        if (!o || !(await db.deleteOrder(o.id))) return { error: `No order #${order_number}.` };
        dirty("orders", "overview");
        return { ok: true, summary: `🗑️ Deleted order #${order_number}.` };
      },
    },
    delete_review: {
      async check({ id }) {
        const r = (await db.listReviews()).find((x) => x.id === String(id ?? ""));
        if (!r) return { error: `No review with id "${id}". Call list_reviews first.` };
        const d = await findDish(r.dish_id);
        return { args: { id: r.id }, summary: `Delete ${r.author_name}'s ${r.chili_rating}🌶️ review on “${d ? label(d) : "?"}”: “${clip(r.body, 80)}”.` };
      },
      async run({ id }) {
        if (!(await db.deleteReview(String(id)))) return { error: "That review is already gone." };
        dirty("reviews", "overview");
        return { ok: true, summary: "🗑️ Review deleted." };
      },
    },
    reset_leaderboard: {
      async check() {
        return { args: {}, summary: "Reset the public leaderboard: counting restarts from now. Orders stay in the admin." };
      },
      async run() {
        const since = new Date().toISOString();
        await db.setSetting("leaderboard_since", since);
        dirty("settings", "overview");
        return { ok: true, since, summary: "🏆 Leaderboard reset. Everyone starts from zero, like Monday morning." };
      },
    },
    bulk_price: {
      async check(args) {
        if (args.patches) return { args, summary: args.label };
        const pct = Number(args.percent);
        if (!Number.isFinite(pct) || pct === 0 || pct < -90 || pct > 300) return { error: "percent must be a number between -90 and +300 (not 0)." };
        if (args.category && !CAT_SLUGS.includes(args.category)) return { error: `Unknown category "${args.category}".` };
        const step = [1, 5, 10].includes(Number(args.round_to)) ? Number(args.round_to) : 1;
        const targets = await targetDishes(args);
        if (!targets.length) return { error: "No dishes matched. Pass ids or a category slug." };
        const rows = targets
          .map((d) => {
            const old = Number(d.price);
            const next = Math.max(0, Math.min(999999, Math.round((old * (1 + pct / 100)) / step) * step));
            return { d, old, next };
          })
          .filter((x) => x.next !== x.old);
        if (!rows.length) return { error: "Those prices wouldn't change after rounding." };
        const scope = args.ids?.length ? dishes_(rows.length) : args.category ? `${dishes_(rows.length)} in ${args.category}` : `all ${dishes_(rows.length)}`;
        const verb = `Price ${signed(pct)} on ${scope}`;
        return patchPlan(
          "bulk_price",
          verb,
          `${verb}${step > 1 ? ` (rounded to ${step})` : ""}.`,
          rows.map((x) => ({ id: x.d.id, fields: { price: x.next } })),
          { columns: ["Dish", "Now", "New"], rows: rows.slice(0, 30).map((x) => [label(x.d), `${x.old} EGP`, `${x.next} EGP`]), more: Math.max(0, rows.length - 30) },
        );
      },
      run: (args) => runPatches(args, "Prices updated"),
    },
    set_badges_by_rule: {
      async check(args) {
        if (args.patches) return { args, summary: args.label };
        const b = String(args.badge || "");
        if (!menu.BADGES.includes(b)) return { error: `Unknown badge "${b}". Badges: ${menu.BADGES.join(", ")}.` };
        const n = clampInt(args.count, 1, 10, 3);
        const rk = RANGE_KEYS.includes(args.range) ? args.range : "all";
        const dishes = (await allDishes()).filter((d) => d.is_visible);
        const qty = await orderQty(rk);
        const rating = new Map();
        if (/rated/.test(args.rule)) {
          const sums = new Map();
          for (const r of await db.listReviews()) {
            const s = sums.get(r.dish_id) || [0, 0];
            sums.set(r.dish_id, [s[0] + (Number(r.chili_rating) || 0), s[1] + 1]);
          }
          for (const [id, [sum, cnt]] of sums) rating.set(id, sum / cnt);
        }
        const q = (d) => qty.get(d.id) || 0;
        const sorters = {
          top_ordered: (a, b) => q(b) - q(a),
          least_ordered: (a, b) => q(a) - q(b),
          best_rated: (a, b) => (rating.get(b.id) ?? -1) - (rating.get(a.id) ?? -1),
          worst_rated: (a, b) => (rating.get(a.id) ?? 99) - (rating.get(b.id) ?? 99),
          newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
        };
        if (!sorters[args.rule]) return { error: "rule must be top_ordered, least_ordered, best_rated, worst_rated or newest." };
        let pool = [...dishes];
        if (args.rule === "top_ordered") pool = pool.filter((d) => q(d) > 0);
        if (/rated/.test(args.rule)) pool = pool.filter((d) => rating.has(d.id));
        const chosen = pool.sort(sorters[args.rule]).slice(0, n);
        if (!chosen.length) return { error: "No dishes match that rule yet (no orders/reviews)." };
        const pick = new Set(chosen.map((d) => d.id));
        const exclusive = args.exclusive !== false;
        const patches = [];
        const rows = [];
        for (const d of await allDishes()) {
          const has = (d.badges || []).includes(b);
          if (pick.has(d.id) && !has) {
            patches.push({ id: d.id, fields: { badges: [...(d.badges || []), b] } });
            rows.push([label(d), `+ ${b}`, args.rule.includes("ordered") ? `${q(d)} sold` : args.rule.includes("rated") ? `${Math.round(rating.get(d.id) * 10) / 10} 🌶️` : ""]);
          } else if (exclusive && !pick.has(d.id) && has) {
            patches.push({ id: d.id, fields: { badges: (d.badges || []).filter((x) => x !== b) } });
            rows.push([label(d), `− ${b}`, ""]);
          }
        }
        if (!patches.length) return { error: `Already right: those dishes have “${b}” and nobody else does.` };
        const verb = `“${b}” → ${args.rule.replace("_", " ")} ${n}`;
        return patchPlan("set_badges_by_rule", verb, `Badge ${verb}${exclusive ? " (removed from the rest)" : ""}.`, patches, { columns: ["Dish", "Change", "Why"], rows });
      },
      run: (args) => runPatches(args, "Badges updated"),
    },
    move_category: {
      async check(args) {
        if (args.patches) return { args, summary: args.label };
        if (!CAT_SLUGS.includes(args.category)) return { error: `Unknown category "${args.category}". Categories: ${CAT_SLUGS.join(", ")}.` };
        if (!Array.isArray(args.ids) || !args.ids.length) return { error: "Pass the dish ids to move." };
        const targets = (await targetDishes({ ids: args.ids })).filter((d) => d.category !== args.category);
        if (!targets.length) return { error: `Those dishes are already in ${args.category}.` };
        const verb = `Move ${dishes_(targets.length)} to ${args.category}`;
        return patchPlan("move_category", verb, `${verb}.`, targets.map((d) => ({ id: d.id, fields: { category: args.category } })), { columns: ["Dish", "From", "To"], rows: targets.map((d) => [label(d), d.category, args.category]) });
      },
      run: (args) => runPatches(args, "Moved"),
    },
    rewrite_copy: {
      async check(args) {
        const plan = args.patches ? args : null;
        if (plan) return { args: plan, summary: plan.label };
        if (!ai?.enabled) return { error: "AI is off, so I can't write copy. Use 🎲 Predefined in the dish editor." };
        const want = (Array.isArray(args.fields) ? args.fields : []).map(String).filter((f) => f in COPY_FIELDS);
        if (!want.length) return { error: `fields must be some of: ${Object.keys(COPY_FIELDS).join(", ")}.` };
        const targets = (await targetDishes({ ids: (args.ids || []).slice(0, 5) })).slice(0, 5);
        if (!targets.length || !args.ids?.length) return { error: "Pass up to 5 dish ids." };
        const style = LANG_STYLE[args.lang] || LANG_STYLE.mix;
        const raw = await ai.generate({
          system: COPY_SYSTEM,
          prompt: `Rewrite these fields: ${want.join(", ")}. Language: ${style}.${args.style ? ` Style: ${clip(args.style, 80)}.` : ""} Limits: job_title 6 words, description 25 words with a food pun, catchphrase 8 words, warnings 8-word comma list, names max 4 words (name_ar in Arabic script, name_en in English).
Dishes:
${targets.map((d, i) => `${i}: ${JSON.stringify(Object.fromEntries([["name", d.name_ar], ...want.map((f) => [f, clip(d[f], 160)])]))}`).join("\n")}
Return JSON {"dishes":[{"i":0,${want.map((f) => `"${f}":"..."`).join(",")}}]}`,
          maxTokens: 120 + targets.length * 80,
          temperature: 0.9,
          json: true,
        });
        const data = raw && parseJson(raw);
        const out = Array.isArray(data?.dishes) ? data.dishes : [];
        const patches = [];
        const rows = [];
        for (const [i, d] of targets.entries()) {
          const got = out.find((x) => Number(x?.i) === i) || out[i];
          if (!got) continue;
          const f = {};
          for (const k of want) {
            const val = clip(got[k], COPY_FIELDS[k]);
            if (val && val !== String(d[k] || "")) {
              f[k] = val;
              rows.push([label(d), k, clip(d[k], 120) || "–", val]);
            }
          }
          if (Object.keys(f).length) patches.push({ id: d.id, fields: f });
        }
        if (!patches.length) return { error: "The AI wrote nonsense, nothing to apply. Try again." };
        return patchPlan("rewrite_copy", `Rewrite ${want.join(", ")} for ${dishes_(patches.length)}`, `Save the new ${want.join(", ")} for ${dishes_(patches.length)}?`, patches, { columns: ["Dish", "Field", "Now", "New"], rows });
      },
      run: (args) => runPatches(args, "Copy saved"),
    },
    sort_menu: {
      async check(args) {
        if (args.order) return { args, summary: args.label };
        const dishes = await allDishes();
        const by = args.by;
        const qty = by === "popularity" ? await orderQty("all") : new Map();
        const rating = new Map();
        if (by === "rating") {
          const sums = new Map();
          for (const r of await db.listReviews()) {
            const s = sums.get(r.dish_id) || [0, 0];
            sums.set(r.dish_id, [s[0] + (Number(r.chili_rating) || 0), s[1] + 1]);
          }
          for (const [id, [sum, n]] of sums) rating.set(id, sum / n);
        }
        const sorters = {
          popularity: (a, b) => (qty.get(b.id) || 0) - (qty.get(a.id) || 0),
          rating: (a, b) => (rating.get(b.id) ?? -1) - (rating.get(a.id) ?? -1),
          price_asc: (a, b) => Number(a.price) - Number(b.price),
          price_desc: (a, b) => Number(b.price) - Number(a.price),
          name: (a, b) => label(a).localeCompare(label(b)),
        };
        if (!sorters[by]) return { error: "by must be popularity, rating, price_asc, price_desc or name." };
        const next = [...dishes].sort(sorters[by]);
        if (next.every((d, i) => d.id === dishes[i].id)) return { error: "The menu is already in that order." };
        const verb = `Sort the menu by ${by.replace("_", " ")}`;
        const order = next.map((d) => d.id);
        if (chat) chat.pending.sort_menu = { order, label: verb };
        return {
          args: { order, label: verb },
          summary: `${verb} (${dishes_(dishes.length)}).`,
          preview: { columns: ["#", "Dish", by === "popularity" ? "Sold" : by === "rating" ? "🌶️" : by.startsWith("price") ? "Price" : ""], rows: next.slice(0, 10).map((d, i) => [i + 1, label(d), by === "popularity" ? qty.get(d.id) || 0 : by === "rating" ? (rating.has(d.id) ? Math.round(rating.get(d.id) * 10) / 10 : "–") : by.startsWith("price") ? `${Number(d.price)} EGP` : ""]), more: Math.max(0, next.length - 10) },
        };
      },
      async run({ order, label: verb }) {
        const before = (await db.listDishes()).map((d) => d.id);
        const known = new Set(before);
        const ids = (order || []).filter((id) => known.has(id));
        before.forEach((id) => ids.includes(id) || ids.push(id)); // dishes added since the preview go last
        await db.reorderDishes(ids);
        remember({ label: verb || "Sort menu", order: before });
        dirty("dishes", "overview");
        return { ok: true, summary: `↕️ ${verb || "Menu sorted"}. Say “undo” to put it back.` };
      },
    },
  };
  const DESTRUCTIVE_PLAN_TOOLS = new Set(["bulk_price", "set_badges_by_rule", "move_category", "rewrite_copy", "sort_menu"]);

  const tools = {
    async list_dishes({ query, category, visibility = "all", badge, sort = "menu", limit = 15 }) {
      const [dishes, orders] = await Promise.all([allDishes(), String(sort).includes("ordered") ? db.listOrders() : []]);
      const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
      let list = dishes.filter(
        (d) =>
          (!category || d.category === category) &&
          (visibility === "all" || (visibility === "visible") === Boolean(d.is_visible)) &&
          (!badge || (d.badges || []).includes(badge)) &&
          (!words.length || words.some((w) => [d.name_ar, d.name_en, d.job_title, d.description, d.catchphrase].join(" ").toLowerCase().includes(w))),
      );
      const qty = new Map();
      for (const o of orders) for (const i of o.items || []) qty.set(i.dish_id, (qty.get(i.dish_id) || 0) + (Number(i.qty) || 0));
      const sorters = {
        price_asc: (a, b) => a.price - b.price,
        price_desc: (a, b) => b.price - a.price,
        most_ordered: (a, b) => (qty.get(b.id) || 0) - (qty.get(a.id) || 0),
        least_ordered: (a, b) => (qty.get(a.id) || 0) - (qty.get(b.id) || 0),
        newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
      };
      if (sorters[sort]) list = [...list].sort(sorters[sort]);
      const n = clampInt(limit, 1, 30, 15);
      const shown = list.slice(0, n);
      card({ kind: "dishes", title: `🍽️ ${dishes_(list.length)}${list.length > n ? ` (first ${n})` : ""}`, items: shown.map(dishRow) });
      note(`read ${dishes_(list.length)}`);
      return { count: list.length, dishes: shown.map((d) => (String(sort).includes("ordered") ? { ...brief(d), ordered: qty.get(d.id) || 0 } : brief(d))) };
    },
    async get_dish({ id }) {
      const d = await findDish(id);
      if (!d) return noDish(id);
      const [reviews, orders] = await Promise.all([db.listReviews(d.id), db.listOrders()]);
      let ordered = 0;
      for (const o of orders) for (const i of o.items || []) if (i.dish_id === d.id) ordered += Number(i.qty) || 0;
      const avg = reviews.length ? Math.round((reviews.reduce((s, r) => s + (Number(r.chili_rating) || 0), 0) / reviews.length) * 10) / 10 : null;
      card({ kind: "dishes", title: "🍽️ Dish", items: [{ ...dishRow(d), detail: clip(d.description, 140) }] });
      const pick = ({ name_ar, name_en, job_title, description, catchphrase, warnings, spice_level, calories }) => ({ name_ar, name_en, job_title, description, catchphrase, warnings, spice_level, calories });
      return { ...brief(d), ...pick(d), has_photo: Boolean(d.photo_path), reviews: reviews.length, avg_chili: avg, ordered };
    },
    async create_dish({ fields: f }) {
      const { value, error } = validated(() => admin.dishFields(f || {}, { partial: false }));
      if (error) return { error };
      const dishes = await allDishes();
      const d = await db.createDish({ ...value, sort_order: dishes.length });
      remember({ label: `Create “${label(d)}”`, created: [d.id] });
      dirty("dishes", "overview");
      card({ kind: "dishes", title: "✨ Hired a new coworker", items: [dishRow(d)] });
      note(`created ${label(d)}`);
      return { ok: true, dish: brief(d) };
    },
    async update_dish({ id, fields: f }) {
      const d = await findDish(id);
      if (!d) return noDish(id);
      const { value, error } = validated(() => admin.dishFields(f || {}, { partial: true }));
      if (error) return { error };
      if (!Object.keys(value).length) return { error: "Nothing to update: pass fields like price, description, badges." };
      const r = await applyPatches(`Edit ${label(d)} (${Object.keys(value).join(", ")})`, [{ id: d.id, fields: value }]);
      if (r.error) return r;
      const updated = r.updated[0];
      card({ kind: "dishes", title: `✏️ Updated: ${Object.keys(value).join(", ")}`, items: [dishRow(updated)] });
      note(`updated ${label(updated)}`);
      return { ok: true, changed: Object.keys(value), dish: brief(updated) };
    },
    async set_visibility({ ids: list, badge, visible }) {
      if (typeof visible !== "boolean") return { error: "visible must be true or false" };
      const dishes = await allDishes();
      let targets = [];
      if (Array.isArray(list) && list.length) targets = dishes.filter((d) => list.map(String).includes(d.id));
      else if (badge) targets = dishes.filter((d) => (d.badges || []).includes(badge));
      else return { error: "Pass ids or a badge." };
      const change = targets.filter((d) => Boolean(d.is_visible) !== visible);
      if (change.length) await applyPatches(`${visible ? "Show" : "Hide"} ${dishes_(change.length)}`, change.map((d) => ({ id: d.id, fields: { is_visible: visible } })));
      const verb = visible ? "👁 Shown" : "🙈 Hidden";
      card({ kind: "summary", tone: "ok", text: `${verb}: ${dishes_(change.length)}${targets.length > change.length ? ` (${targets.length - change.length} already ${visible ? "visible" : "hidden"})` : ""}.` });
      if (change.length) card({ kind: "dishes", title: verb, items: change.map((d) => dishRow({ ...d, is_visible: visible })) });
      note(`${visible ? "showed" : "hid"} ${dishes_(change.length)}`);
      return { ok: true, changed: change.map((d) => label(d)), already: targets.length - change.length, matched: targets.length };
    },
    async duplicate_dish({ id }) {
      const copy = await admin.duplicateDish(db, String(id ?? ""));
      if (!copy) return noDish(id);
      remember({ label: `Duplicate “${label(copy)}”`, created: [copy.id] });
      dirty("dishes");
      card({ kind: "dishes", title: "📄 Copy created (hidden, no photo)", items: [dishRow(copy)] });
      note("duplicated 1 dish");
      return { ok: true, dish: brief(copy) };
    },
    async list_orders({ range: r = "7d", search, limit = 15 }) {
      const rk = RANGE_KEYS.includes(r) ? r : "7d";
      const q = String(search || "").toLowerCase().replace(/^#/, "").trim();
      let list = admin.ordersInRange(await db.listOrders(), rk, tz);
      if (q)
        list = list.filter(
          (o) => String(o.order_number).includes(q) || String(o.customer_name || "").toLowerCase().includes(q) || (o.items || []).some((i) => `${i.name_ar} ${i.name_en || ""}`.toLowerCase().includes(q)),
        );
      const n = clampInt(limit, 1, 30, 15);
      const shown = list.slice(0, n);
      const total = list.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const items = (o) => (o.items || []).map((i) => `${i.qty}× ${i.name_en || i.name_ar}`).join(", ");
      card({
        kind: "table",
        title: `🧾 ${plural(list.length, "order", "orders")} · ${rk} · ${menu.round2(total)} EGP`,
        columns: ["#", "Customer", "Items", "Total", "When"],
        rows: shown.map((o) => [`#${o.order_number}`, admin.firstName(o.customer_name), items(o), `${Number(o.total)} EGP`, o.created_at]),
        time_col: 4,
      });
      note(`read ${plural(list.length, "order", "orders")}`);
      return { count: list.length, total_egp: menu.round2(total), orders: shown.map((o) => ({ n: o.order_number, by: admin.firstName(o.customer_name), items: items(o), total: Number(o.total), at: o.created_at })) };
    },
    async order_stats({ range: r = "today" }) {
      const rk = RANGE_KEYS.includes(r) ? r : "today";
      const [orders, dishes] = await Promise.all([db.listOrders(), allDishes()]);
      const list = admin.ordersInRange(orders, rk, tz);
      const s = admin.orderSummary(list, { tz, dishes, photoUrl: (p) => db.photoUrl(p) });
      const hour = s.busiest_hour ? `${String(s.busiest_hour.hour).padStart(2, "0")}:00` : "–";
      card({
        kind: "stats",
        title: `📊 Stats · ${rk}`,
        kpis: [
          { label: "Orders", value: s.count },
          { label: "Revenue", value: `${s.revenue} EGP` },
          { label: "Avg order", value: `${s.avg_order_value} EGP` },
          { label: "Busiest hour", value: hour },
        ],
      });
      if (s.top_dishes.length) card({ kind: "table", title: "🏆 Top dishes", columns: ["Dish", "Qty"], rows: s.top_dishes.map((d) => [d.name, d.qty]) });
      if (s.top_customers.length) card({ kind: "table", title: "👑 Top customers", columns: ["Name", "Orders", "Spent"], rows: s.top_customers.map((c) => [c.name, c.orders, `${c.total} EGP`]) });
      note(`crunched ${plural(s.count, "order", "orders")}`);
      return { range: rk, orders: s.count, revenue: s.revenue, avg: s.avg_order_value, busiest_hour: hour, top_dishes: s.top_dishes.map((d) => `${d.name} ×${d.qty}`), top_customers: s.top_customers.map((c) => `${c.name} (${c.orders})`), payments: s.payments };
    },
    async compare_periods({ range: r = "7d" }) {
      const rk = ["today", "7d", "30d"].includes(r) ? r : "7d";
      const [dishes, reviews, orders] = await Promise.all([allDishes(), db.listReviews(), db.listOrders()]);
      const p = admin.periodStats({ dishes, reviews, orders, range: rk, tz });
      const k = (lbl, key, unit = "") => ({ label: lbl, value: `${p.current[key] ?? "–"}${unit}`, delta: p.change?.[key] ?? null, prev: `${p.previous?.[key] ?? "–"}${unit}` });
      card({
        kind: "stats",
        title: `📈 ${rk === "today" ? "Today vs yesterday" : `Last ${rk.replace("d", "")} days vs the ${rk.replace("d", "")} before`}`,
        kpis: [k("Revenue", "revenue", " EGP"), k("Orders", "orders"), k("Avg order", "avg_order_value", " EGP"), k("Customers", "customers"), k("Items", "items"), k("Reviews", "reviews")],
      });
      note(`compared ${rk} vs ${p.compare}`);
      return { range: rk, vs: p.compare, now: p.current, before: p.previous, change_pct: p.change, top_now: p.top_dishes.slice(0, 3).map((d) => `${d.name} ×${d.qty}`) };
    },
    async sales_by_time({ by = "weekday", range: r = "all", dish_id }) {
      const rk = RANGE_KEYS.includes(r) ? r : "all";
      const mode = by === "hour" ? "hour" : "weekday";
      let dish = null;
      if (dish_id) {
        dish = await findDish(dish_id);
        if (!dish) return noDish(dish_id);
      }
      const list = admin.ordersInRange(await db.listOrders(), rk, tz);
      const rows = admin.salesBy(list, mode, { tz, dishId: dish?.id || null });
      const shown = mode === "hour" ? rows.filter((b) => b.orders || (b.key >= 8 && b.key <= 23)) : rows;
      const lbl = (b) => (mode === "hour" ? `${String(b.key).padStart(2, "0")}:00` : b.key);
      const best = [...rows].sort((a, b) => b.items - a.items || b.revenue - a.revenue)[0];
      card({
        kind: "chart",
        title: `${mode === "hour" ? "⏰ By hour" : "📅 By weekday"}${dish ? ` · ${label(dish)}` : ""} · ${rk}`,
        unit: dish ? "sold" : "orders",
        bars: shown.map((b) => ({ label: lbl(b), value: dish ? b.items : b.orders, sub: `${b.revenue} EGP${b.top_dish && !dish ? ` · top: ${b.top_dish}` : ""}` })),
      });
      card({ kind: "table", title: "Details", columns: [mode === "hour" ? "Hour" : "Day", "Orders", "Items", "Revenue", ...(dish ? [] : ["Best seller"])], rows: shown.filter((b) => b.orders).map((b) => [lbl(b), b.orders, b.items, `${b.revenue} EGP`, ...(dish ? [] : [b.top_dish || "–"])]) });
      note(`grouped ${plural(list.length, "order", "orders")} by ${mode}`);
      return { by: mode, range: rk, dish: dish ? label(dish) : null, best: best?.items ? `${lbl(best)} (${best.items} items)` : null, buckets: rows.filter((b) => b.orders).map((b) => `${lbl(b)}: ${b.orders} orders, ${b.items} items, ${b.revenue} EGP${b.top_dish ? `, top ${b.top_dish}` : ""}`) };
    },
    async list_reviews({ dish_id, min_chili, max_chili, search, older_than_days, limit = 15 }) {
      const [reviews, dishes] = await Promise.all([db.listReviews(dish_id ? String(dish_id) : undefined), allDishes()]);
      const byId = new Map(dishes.map((d) => [d.id, d]));
      const q = String(search || "").toLowerCase().trim();
      const lo = clampInt(min_chili, 1, 5, 1);
      const hi = clampInt(max_chili, 1, 5, 5);
      const cutoff = older_than_days ? Date.now() - clampInt(older_than_days, 1, 3650, 90) * 864e5 : null;
      const list = reviews.filter((r) => r.chili_rating >= lo && r.chili_rating <= hi && (!q || `${r.author_name} ${r.body}`.toLowerCase().includes(q)) && (!cutoff || Date.parse(r.created_at) < cutoff));
      const n = clampInt(limit, 1, 30, 15);
      const shown = list.slice(0, n);
      const dn = (r) => (byId.has(r.dish_id) ? label(byId.get(r.dish_id)) : "?");
      card({ kind: "table", title: `💬 ${plural(list.length, "review", "reviews")}`, columns: ["Dish", "By", "🌶️", "Review", "When"], rows: shown.map((r) => [dn(r), r.author_name, r.chili_rating, clip(r.body, 120), r.created_at]), time_col: 4 });
      note(`read ${plural(list.length, "review", "reviews")}`);
      return { count: list.length, reviews: shown.map((r) => ({ id: r.id, dish: dn(r), by: r.author_name, chili: r.chili_rating, text: clip(r.body, 100) })) };
    },
    async draft_review_replies({ ids: list, dish_id, max_chili, limit = 3 }) {
      if (!ai?.enabled) return { error: "AI is off, so no reply drafts. The ✨ Reply button in Reviews also needs AI." };
      const [reviews, dishes] = await Promise.all([db.listReviews(dish_id ? String(dish_id) : undefined), allDishes()]);
      const byId = new Map(dishes.map((d) => [d.id, d]));
      const want = Array.isArray(list) && list.length ? new Set(list.map(String)) : null;
      const hi = clampInt(max_chili, 1, 5, 5);
      const pick = reviews.filter((r) => byId.has(r.dish_id) && (!want || want.has(r.id)) && r.chili_rating <= hi).slice(0, clampInt(limit, 1, 5, 3));
      if (!pick.length) return { error: "No matching reviews to reply to." };
      const raw = await ai.generate({
        system: COPY_SYSTEM,
        prompt: `Each dish is a coworker replying to a review of itself: calm, dry, unbothered clap-back at something specific, max 22 words, no emoji, Egyptian Arabic + English mix.
${pick.map((r, i) => `${i}: dish "${byId.get(r.dish_id).name_ar}"${byId.get(r.dish_id).catchphrase ? ` (catchphrase: ${clip(byId.get(r.dish_id).catchphrase, 60)})` : ""}; ${r.author_name} gave ${r.chili_rating}/5: "${clip(r.body, 200)}"`).join("\n")}
Return JSON {"replies":[{"i":0,"reply":"..."}]}`,
        maxTokens: 60 + pick.length * 60,
        temperature: 0.95,
        json: true,
      });
      const data = raw && parseJson(raw);
      const out = Array.isArray(data?.replies) ? data.replies : [];
      const items = pick.map((r, i) => ({ dish: label(byId.get(r.dish_id)), by: r.author_name, chili: r.chili_rating, review: clip(r.body, 160), reply: clip((out.find((x) => Number(x?.i) === i) || out[i])?.reply, 260) })).filter((x) => x.reply);
      if (!items.length) return { error: "The AI blanked. Try again." };
      card({ kind: "replies", title: `↩️ ${plural(items.length, "reply draft", "reply drafts")} (not posted)`, items });
      note(`drafted ${plural(items.length, "reply", "replies")}`);
      return { ok: true, posted: false, drafts: items.length };
    },
    async suggest_menu_ideas({ count = 3, theme }) {
      if (!ai?.enabled) return { error: "AI is off, so no brainstorming. Use the 🎲 Predefined fill in the dish editor." };
      const n = clampInt(count, 1, 5, 3);
      const raw = await ai.generate({
        system: "You write funny menu items for a joke Egyptian restaurant where every dish is an office coworker. Egyptian Arabic + English Gen-Z mix. Office humor only: never about bodies, religion or real names.",
        prompt: `Invent ${n} new dish-coworkers${theme ? ` around this theme: "${clip(theme, 120)}"` : ""}. Return JSON {"ideas":[{"name_ar","name_en","job_title","description"(max 20 words, food pun),"catchphrase"(max 8 words),"price"(EGP 20-400),"category"(one of ${CAT_SLUGS.join(",")}),"badges"(max 2 of ${menu.BADGES.join(",")})}]}`,
        maxTokens: 420,
        temperature: 1,
        json: true,
      });
      const data = raw && parseJson(raw);
      const ideas = (Array.isArray(data?.ideas) ? data.ideas : Array.isArray(data) ? data : [])
        .slice(0, n)
        .map((x) => ({
          name_ar: clip(x?.name_ar, 60),
          name_en: clip(x?.name_en, 60),
          job_title: clip(x?.job_title, 80),
          description: clip(x?.description, 500),
          catchphrase: clip(x?.catchphrase, 140),
          price: Math.min(999, Math.max(0, Math.round(Number(x?.price) || 99))),
          category: CAT_SLUGS.includes(x?.category) ? x.category : "picks",
          badges: [...new Set((Array.isArray(x?.badges) ? x.badges : []).map(String))].filter((b) => menu.BADGES.includes(b)).slice(0, 2),
        }))
        .filter((x) => x.name_ar || x.name_en)
        .map((x) => ({ ...x, name_ar: x.name_ar || x.name_en }));
      if (!ideas.length) return { error: "The AI brainstorm came back empty. Try again." };
      card({ kind: "ideas", title: "💡 Menu ideas (not saved)", items: ideas });
      note(`brainstormed ${plural(ideas.length, "idea", "ideas")}`);
      return { ok: true, saved: false, ideas: ideas.map((i) => `${i.name_ar} / ${i.name_en}: ${i.job_title}`) };
    },
    async write_dish_copy({ ids: list, id, overwrite = false }) {
      if (!ai?.enabled) return { error: "AI is off, so I can't write copy. Use 🎲 Predefined in the dish editor." };
      const wanted = [...new Set([...(Array.isArray(list) ? list : []), ...(id ? [id] : [])].map(String))].slice(0, 5);
      if (!wanted.length) return { error: "Pass up to 5 dish ids (find_issues lists dishes without descriptions)." };
      const COPY = { job_title: 80, description: 500, catchphrase: 140, warnings: 200 };
      const targets = [];
      for (const wid of wanted) {
        const d = await findDish(wid);
        if (!d) continue;
        const empty = Object.keys(COPY).filter((k) => overwrite || !String(d[k] || "").trim());
        if (empty.length) targets.push({ d, empty });
      }
      if (!targets.length) return { error: "Those dishes already have all their text (use rewrite_copy to rewrite)." };
      const raw = await ai.generate({
        system: COPY_SYSTEM + " Egyptian Arabic + English Gen-Z mix.",
        prompt: `Write the missing fields. job_title max 6 words, description max 25 words with a food pun, catchphrase max 8 words, warnings = max 8 words comma list of funny "contains".
Dishes:
${targets.map((t, i) => `${i}: "${t.d.name_ar}"${t.d.name_en ? ` (${t.d.name_en})` : ""}, category ${t.d.category}${t.d.job_title && !t.empty.includes("job_title") ? `, job: ${t.d.job_title}` : ""} -> fields: ${t.empty.join(", ")}`).join("\n")}
Return JSON {"dishes":[{"i":0,"job_title":"...","description":"..."}]} with only the requested fields.`,
        maxTokens: 120 + targets.length * 90,
        temperature: 0.95,
        json: true,
      });
      const data = raw && parseJson(raw);
      const out = Array.isArray(data?.dishes) ? data.dishes : Array.isArray(data) ? data : [];
      const patches = [];
      const done = [];
      for (const [i, t] of targets.entries()) {
        const got = out.find((x) => Number(x?.i) === i) || out[i];
        if (!got) continue;
        const patch = {};
        for (const k of t.empty) if (clip(got[k], COPY[k])) patch[k] = clip(got[k], COPY[k]);
        if (!Object.keys(patch).length) continue;
        const { error } = validated(() => admin.dishFields(patch, { partial: true }));
        if (error) continue;
        patches.push({ id: t.d.id, fields: patch });
        done.push({ id: t.d.id, name: label(t.d), ...patch });
      }
      if (!done.length) return { error: "The AI wrote nonsense, nothing was saved. Try again." };
      await applyPatches(`Write copy for ${dishes_(done.length)}`, patches);
      card({ kind: "table", title: `✍️ Wrote copy for ${dishes_(done.length)} (saved)`, columns: ["Dish", "Job title", "Description"], rows: done.map((d) => [d.name, d.job_title || "–", d.description || "–"]) });
      note(`wrote copy for ${dishes_(done.length)}`);
      return { ok: true, saved: done.map((d) => ({ name: d.name, fields: Object.keys(d).filter((k) => k in COPY) })) };
    },
    async bulk_update_badges({ ids: list, add = [], remove = [] }) {
      const addB = (Array.isArray(add) ? add : []).map(String);
      const remB = (Array.isArray(remove) ? remove : []).map(String);
      if (!addB.length && !remB.length) return { error: "Pass badges to add or remove." };
      const bad = [...addB, ...remB].find((b) => !menu.BADGES.includes(b));
      if (bad) return { error: `Unknown badge "${bad}".` };
      if (!Array.isArray(list) || !list.length) return { error: "ids must be a list (1–200)" };
      const targets = await targetDishes({ ids: list });
      const patches = targets.map((d) => {
        const set = new Set(d.badges || []);
        addB.forEach((b) => set.add(b));
        remB.forEach((b) => set.delete(b));
        return { id: d.id, fields: { badges: [...set] } };
      });
      const r = await applyPatches(`Badges ${addB.map((b) => `+${b}`).join(" ")} ${remB.map((b) => `−${b}`).join(" ")}`.trim(), patches);
      if (r.error) return r;
      card({ kind: "dishes", title: `🏷️ Badges updated${addB.length ? ` +${addB.join(", +")}` : ""}${remB.length ? ` −${remB.join(", −")}` : ""}`, items: r.updated.map(dishRow) });
      note(`updated badges on ${dishes_(r.updated.length)}`);
      return { ok: true, updated: r.updated.map(label), missing: list.length - targets.length };
    },
    async find_issues() {
      const [dishes, orders, reviews] = await Promise.all([allDishes(), db.listOrders(), db.listReviews()]);
      const ordered = new Set();
      for (const o of orders) for (const i of o.items || []) ordered.add(i.dish_id);
      const groups = new Map();
      for (const d of dishes) {
        for (const key of [normName(d.name_ar), normName(d.name_en)].filter(Boolean)) {
          if (!groups.has(key)) groups.set(key, new Set());
          groups.get(key).add(d.id);
        }
      }
      const dupes = new Set([...groups.values()].filter((s) => s.size > 1).flatMap((s) => [...s]));
      const rows = [];
      const counts = { no_photo: 0, no_description: 0, hidden: 0, duplicate: 0, zero_price: 0, hidden_never_ordered: 0 };
      for (const d of dishes) {
        const issues = [];
        if (!d.photo_path) issues.push("no_photo");
        if (!String(d.description || "").trim()) issues.push("no_description");
        if (!d.is_visible) issues.push(ordered.has(d.id) ? "hidden" : "hidden_never_ordered");
        if (dupes.has(d.id)) issues.push("duplicate");
        if (!Number(d.price)) issues.push("zero_price");
        issues.forEach((i) => counts[i]++);
        if (issues.length) rows.push({ d, issues });
      }
      // Stale reviews: on hidden/deleted dishes, or older than 90 days
      const byId = new Map(dishes.map((d) => [d.id, d]));
      const old = Date.now() - 90 * 864e5;
      const stale = reviews.filter((r) => !byId.get(r.dish_id)?.is_visible || Date.parse(r.created_at) < old);
      const LABELS = { no_photo: "📸 no photo", no_description: "📝 no description", hidden: "🙈 hidden", hidden_never_ordered: "👻 hidden, never ordered", duplicate: "👯 duplicate", zero_price: "🆓 0 EGP" };
      const summary = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => ({ label: LABELS[k], value: n }));
      if (stale.length) summary.push({ label: "🕸️ stale reviews", value: stale.length });
      if (summary.length) card({ kind: "stats", title: "🧹 Maintenance", kpis: summary });
      card({
        kind: "issues",
        title: rows.length ? `⚠️ ${rows.length} of ${dishes_(dishes.length)} need love` : "✅ Nothing to fix. Chef's kiss 🤌",
        items: rows.slice(0, 40).map(({ d, issues }) => ({ ...dishRow(d), issues: issues.map((i) => LABELS[i]) })),
      });
      note(`checked ${dishes_(dishes.length)}`);
      return { total_dishes: dishes.length, counts, stale_reviews: stale.length, dishes: rows.slice(0, 20).map(({ d, issues }) => ({ id: d.id, name: label(d), issues })) };
    },
    async export_orders({ range: r = "all" }) {
      const rk = RANGE_KEYS.includes(r) ? r : "all";
      const list = admin.ordersInRange(await db.listOrders(), rk, tz);
      const href = `/api/admin/orders.csv?range=${encodeURIComponent(rk)}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`;
      card({ kind: "link", title: `⬇️ Orders CSV · ${rk}`, text: `${plural(list.length, "order", "orders")}, Excel-friendly (UTF-8, Arabic OK).`, href, label: "Download CSV" });
      note(`exported ${plural(list.length, "order", "orders")}`);
      return { ok: true, orders: list.length, link_shown: true };
    },
    async weekly_report() {
      const [dishes, reviews, orders] = await Promise.all([allDishes(), db.listReviews(), db.listOrders()]);
      const p = admin.periodStats({ dishes, reviews, orders, range: "7d", tz });
      const week = admin.ordersInRange(orders, "7d", tz);
      const s = admin.orderSummary(week, { tz, dishes });
      const days = admin.salesBy(week, "weekday", { tz });
      const bestDay = [...days].sort((a, b) => b.revenue - a.revenue)[0];
      const c = p.current;
      const ch = (k) => (p.change?.[k] == null ? "" : ` (${signed(p.change[k])} vs last week)`);
      const noPhoto = dishes.filter((d) => !d.photo_path).length;
      const noDesc = dishes.filter((d) => !String(d.description || "").trim()).length;
      const md = [
        `## 🗓️ Week report · ${new Date().toISOString().slice(0, 10)}`,
        "",
        `- **Revenue:** ${c.revenue} EGP${ch("revenue")}`,
        `- **Orders:** ${c.orders}${ch("orders")} · avg ${c.avg_order_value} EGP${ch("avg_order_value")}`,
        `- **Customers:** ${c.customers}${ch("customers")} · items sold ${c.items}`,
        `- **Reviews:** ${c.reviews}${c.avg_chili != null ? ` · avg ${c.avg_chili} 🌶️` : ""}`,
        bestDay?.orders ? `- **Best day:** ${bestDay.key} (${bestDay.revenue} EGP)` : null,
        s.busiest_hour ? `- **Busiest hour:** ${String(s.busiest_hour.hour).padStart(2, "0")}:00` : null,
        "",
        "### 🏆 Top dishes",
        ...(p.top_dishes.length ? p.top_dishes.slice(0, 3).map((d, i) => `${i + 1}. ${d.name} — ${d.qty} sold, ${d.revenue} EGP`) : ["_No orders this week._"]),
        "",
        "### 🧊 Need a push",
        ...(p.worst_dishes.length ? p.worst_dishes.slice(0, 3).map((d) => `- ${d.name} — ${d.qty} sold`) : ["- _Everyone sold something._"]),
        "",
        "### 👑 Top customers",
        ...(s.top_customers.length ? s.top_customers.slice(0, 3).map((x) => `- ${x.name} — ${x.orders} orders`) : ["- _Nobody yet._"]),
        "",
        `### 🧹 To do`,
        `- ${noPhoto} without photo · ${noDesc} without description`,
      ]
        .filter((x) => x !== null)
        .join("\n");
      card({ kind: "markdown", title: "📝 Weekly report", text: md });
      note("wrote the weekly report");
      return { ok: true, shown_in_card: true, revenue: c.revenue, revenue_change_pct: p.change?.revenue ?? null, orders: c.orders, top: p.top_dishes[0]?.name || null };
    },
    async undo_last() {
      const entry = chat?.undo.pop();
      if (!entry) return { error: "Nothing to undo in this chat (deletes can't be undone)." };
      let restored = 0;
      if (entry.order) {
        const known = new Set((await db.listDishes()).map((d) => d.id));
        const ids = entry.order.filter((id) => known.has(id));
        known.forEach((id) => ids.includes(id) || ids.push(id));
        await db.reorderDishes(ids);
        restored = ids.length;
      }
      for (const b of entry.dishes || []) if (await db.updateDish(b.id, b.fields)) restored++;
      for (const id of entry.created || []) if (await admin.deleteDishFully(db, id)) restored++;
      dirty("dishes", "overview");
      card({ kind: "summary", tone: "done", text: `↩️ Undid: ${entry.label} (${dishes_(restored)} restored).` });
      note(`undid “${entry.label}”`);
      return { ok: true, undone: entry.label, restored, left: chat.undo.length };
    },
  };

  async function run(name, args, { confirmed = false } = {}) {
    ran.push({ tool: name, text: null });
    try {
      if (destructive[name]) {
        // A typed "yes" reuses the plan the user saw (AI-written text must not change between preview and save)
        const reuse = confirmed && DESTRUCTIVE_PLAN_TOOLS.has(name) && !args?.patches && !args?.order ? pendingPlan(name, args) : null;
        const plan = reuse ? { args: reuse, summary: reuse.label } : await destructive[name].check(args || {});
        if (plan.error) {
          note("failed");
          return plan;
        }
        if (confirmed) {
          const result = await destructive[name].run(plan.args);
          if (chat) delete chat.pending[name];
          card({ kind: "summary", tone: result.error ? "error" : "done", text: result.summary || result.error });
          note(result.error ? "failed" : result.updated ? `updated ${dishes_(result.updated)}` : "done");
          return result;
        }
        const token = signAction(secret, name, plan.args);
        actions.push({ type: "confirm", tool: name, summary: plan.summary, token });
        card({ kind: "confirm", tone: "danger", text: plan.summary, token, tool: name, ...(plan.preview ? { preview: plan.preview } : {}) });
        note("waiting for your OK");
        return { needs_confirmation: true, summary: plan.summary, changes: plan.preview?.rows?.length, note: "NOT done yet. Ask the user to press Confirm (or say yes)." };
      }
      const tool = tools[name];
      if (!tool) return { error: `Unknown tool ${name}` };
      const result = await tool(args || {});
      if (result?.error) note("failed");
      return result;
    } catch (err) {
      note("failed");
      if (err.status === 400) return { error: err.message };
      console.warn(`chef tool ${name} failed: ${err.message}`);
      return { error: "That broke in the kitchen. Try again or do it by hand." };
    }
  }

  const finish = () => {
    if (refresh.size) actions.push({ type: "refresh", tabs: [...refresh] });
    return { cards: cards.slice(-6), actions, tools_ran: ran.slice(-8).map((r) => ({ tool: r.tool, text: r.text || r.tool.replace(/_/g, " ") })), can_undo: Boolean(chat?.undo.length) };
  };
  return { run, finish, cards, saidYes: saidYes(messages) };
}

const cleanReply = (text) =>
  String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .slice(0, 1500);

// Deterministic replies for direct tool runs (quick chips, AI off)
const CANNED = {
  find_issues: "Here's what needs fixing 👇 دي الحاجات اللي محتاجة شوية حب.",
  order_stats: "The numbers, no cap 📊",
  compare_periods: "Now vs before 📈",
  sales_by_time: "When the hunger hits 👇",
  list_orders: "Orders 👇",
  list_reviews: "Reviews 👇 brace yourself.",
  list_dishes: "The team 👇",
  set_visibility: "Done ✅",
  write_dish_copy: "Copy written and saved ✍️",
  suggest_menu_ideas: "Fresh ideas 💡 (not saved until you add them)",
  draft_review_replies: "Reply drafts 👇 copy what you like, nothing was posted.",
  export_orders: "Here's your CSV 👇",
  weekly_report: "The week in one card 📝",
  undo_last: "Rolled back ↩️",
};
// When the AI is off, simple questions still get an answer
function offlineRoute(text) {
  const t = text.toLowerCase();
  if (/undo|رجع|تراجع/.test(t)) return ["undo_last", {}];
  if (/report|summary|recap|تقرير|ملخص/.test(t)) return ["weekly_report", {}];
  if (/export|csv|download|excel|تحميل|اكسل/.test(t)) return ["export_orders", { range: /week|7|اسبوع|أسبوع/.test(t) ? "7d" : "all" }];
  if (/\bvs\b|compar|last week|مقارن|قارن/.test(t)) return ["compare_periods", { range: /today|النهارده/.test(t) ? "today" : /month|30|شهر/.test(t) ? "30d" : "7d" }];
  if (/weekday|friday|day of|which day|ايام|أيام|يوم ايه|جمعة/.test(t)) return ["sales_by_time", { by: "weekday" }];
  if (/hour|peak|busiest|ساعة|امتى/.test(t)) return ["sales_by_time", { by: "hour" }];
  if (/fix|issue|problem|missing|duplicate|stale|clean|مشاكل|ناقص|اصلح|محتاج/.test(t)) return ["find_issues", {}];
  if (/stat|today|revenue|numbers|احصا|إحصا|النهارده|ارقام|أرقام/.test(t)) return ["order_stats", { range: /week|7|اسبوع|أسبوع/.test(t) ? "7d" : /all|كل/.test(t) ? "all" : "today" }];
  if (/order|طلب|اوردر|أوردر/.test(t)) return ["list_orders", { range: "7d" }];
  if (/review|ريفيو|تقييم|رأي/.test(t)) return ["list_reviews", {}];
  if (/sold.?out|خلص/.test(t)) return ["list_dishes", { badge: "sold_out" }];
  if (/dish|menu|اكل|أكل|منيو/.test(t)) return ["list_dishes", {}];
  return null;
}

function chefAgentRouter(db, ai, { secret }) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Easy chef 😮‍💨 too many messages. Wait a minute.", reply: "اهدى يا شيف 😮‍💨 one minute break, the AI free tier is crying.", fallback: true, cards: [], actions: [] },
  });

  // Quick-chip info for the UI: is the AI on, and which tools can run directly
  router.get("/", (req, res) => res.json({ enabled: Boolean(ai?.enabled), tools: [...TOOL_NAMES] }));

  router.post("/", limiter, async (req, res) => {
    const b = req.body || {};
    const tz = typeof b.tz === "string" ? b.tz.slice(0, 64) : undefined;
    const chat = chatState(chatKey(b.chat_id));
    const newSession = (messages = []) => createSession(db, ai, { secret, tz, messages, chat });

    // 1) Confirm button: run exactly the signed action, no AI involved
    if (b.confirm_token !== undefined) {
      const p = verifyAction(secret, b.confirm_token);
      if (!p || !TOOL_NAMES.has(p.tool)) return res.status(400).json({ error: "That confirmation expired or is invalid. Ask again 🙏" });
      const session = newSession();
      const result = await session.run(p.tool, p.args, { confirmed: true });
      return res.status(result.error ? 409 : 200).json({ reply: result.summary || result.error, done: !result.error, ...session.finish() });
    }

    // 2) Direct tool run (quick chips, AI off): destructive tools still only get a confirm card
    if (b.run !== undefined) {
      const name = String(b.run?.tool || "");
      if (!TOOL_NAMES.has(name)) throw v.bad("skill issue: unknown tool");
      const args = b.run?.args && typeof b.run.args === "object" ? { ...b.run.args } : {};
      delete args.confirm;
      delete args.patches;
      delete args.order;
      const session = newSession();
      const result = await session.run(name, args);
      const reply = result.error ? `😬 ${result.error}` : result.needs_confirmation ? "Sure? Check the preview and press Confirm 👇" : CANNED[name] || "Done ✅";
      return res.json({ reply, ...session.finish() });
    }

    // 3) Chat with the AI tool loop
    const messages = parseMessages(b.messages);
    const lastUserText = messages[messages.length - 1].content;
    const prevBot = messages.length > 1 ? messages[messages.length - 2].content : "";
    const session = newSession(messages);

    const offline = async () => {
      const route = offlineRoute(lastUserText);
      if (!route) return res.json({ reply: FALLBACK, fallback: true, ...session.finish() });
      await session.run(...route);
      return res.json({ reply: `${FALLBACK.split("(")[0].trim()} Meanwhile, ${CANNED[route[0]] || "here you go 👇"}`, fallback: true, ...session.finish() });
    };
    if (!ai?.enabled || typeof ai.chat !== "function") return offline();

    const tools = toolsFor(`${lastUserText}\n${prevBot}`);
    const convo = [{ role: "system", content: systemPrompt(lastUserText) }, ...messages];
    let reply = null;
    let provider = null; // one provider for the whole loop (Gemini rejects Groq's tool calls)
    for (let round = 0; round < MAX_ROUNDS && reply === null; round++) {
      const msg = await ai.chat({ messages: convo, tools, maxTokens: 260, temperature: 0.6, provider }).catch(() => null);
      provider ||= msg?.provider || null;
      if (!msg) {
        if (round === 0) return offline();
        break;
      }
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c) => c?.function?.name) : [];
      if (!calls.length) {
        reply = cleanReply(msg.content);
        break;
      }
      calls.forEach((c, i) => (c.id ||= `call_${round}_${i}`));
      convo.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
      for (const call of calls) {
        const args = parseArgs(call.function.arguments);
        // The model never gets to pass prepared plans; confirm=true is only honored right after the user said yes
        delete args.patches;
        delete args.order;
        const result = await session.run(call.function.name, args, { confirmed: args.confirm === true && session.saidYes });
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, TOOL_RESULT_CHARS) });
      }
    }
    if (!reply) {
      const msg = await ai.chat({ messages: convo, tools: [], maxTokens: 160, temperature: 0.6, provider }).catch(() => null);
      reply = cleanReply(msg?.content);
    }
    const out = session.finish();
    if (!reply) reply = out.actions.some((a) => a.type === "confirm") ? "Sure? Press Confirm 👇" : out.cards.length ? "Done ✅ check the cards 👇" : FALLBACK;
    res.json({ reply, ...out });
  });

  return router;
}

module.exports = { chefAgentRouter, TOOLS, toolsFor, signAction, verifyAction, offlineRoute };
