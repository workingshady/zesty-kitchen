// 👨‍🍳 Chef assistant: an admin-only AI agent with full kitchen access (dishes, orders, reviews, leaderboard).
// Same server-orchestrated tool loop as the waiter (routes/agent.js), but every write goes through the
// admin validation (dishFields) and destructive tools need an explicit confirmation:
//   - the model calls e.g. delete_dish without confirm -> nothing happens, the UI gets a signed "confirm" action;
//   - the admin clicks "Yes" -> POST { confirm_token } runs exactly that action (no AI involved), or
//   - the admin types "yes" and the model re-calls the tool with confirm: true (only honored right after a yes).
// Tools also emit "cards" (tables, stats, dish lists) so the model can keep its replies short.
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

const FALLBACK = "الـ AI نايم دلوقتي 😴 (AI is off or out of quota). The quick buttons still work: try “what needs fixing?” or “today's stats”.";

// ---------- tool schemas (OpenAI format, kept terse for token budget) ----------
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const str = (description) => ({ type: "string", ...(description ? { description } : {}) });
const ids = { type: "array", items: { type: "string" }, maxItems: 50 };
const confirm = { type: "boolean", description: "only after the user said yes" };
const range = { type: "string", enum: RANGE_KEYS };
// Category/badge lists live once in the system prompt instead of in every schema (token budget)
const fields = { type: "object", description: "name_ar, name_en, price, category, description, job_title, catchphrase, warnings, spice_level 1-5, calories, badges[], is_visible" };
const badge = str("badge key");
const badges = { type: "array", items: { type: "string" } };
const DESTRUCTIVE_NOTE = "Destructive: see confirm rule.";

const TOOLS = [
  fn("list_dishes", "List/search dishes incl. hidden ones.", {
    query: str("words in names/job/description"),
    category: str("category slug"),
    visibility: { type: "string", enum: ["all", "visible", "hidden"] },
    badge,
    sort: { type: "string", enum: ["menu", "price_asc", "price_desc", "most_ordered", "least_ordered", "newest"] },
    limit: { type: "integer", minimum: 1, maximum: 30 },
  }),
  fn("get_dish", "Full details of one dish.", { id: str() }, ["id"]),
  fn("create_dish", "Create a dish. Needs name_ar, price, category.", { fields }, ["fields"]),
  fn("update_dish", "Change some fields of a dish.", { id: str(), fields }, ["id", "fields"]),
  fn("set_visibility", "Show/hide dishes by ids, or all dishes with a badge (e.g. sold_out).", { ids, badge, visible: { type: "boolean" } }, ["visible"]),
  fn("delete_dish", `Delete a dish + its reviews. ${DESTRUCTIVE_NOTE}`, { id: str(), confirm }, ["id"]),
  fn("duplicate_dish", "Copy a dish (copy starts hidden, no photo).", { id: str() }, ["id"]),
  fn("list_orders", "List orders.", { range, search: str("customer, dish or #number"), limit: { type: "integer", minimum: 1, maximum: 30 } }),
  fn("order_stats", "Real numbers: orders, revenue, top dishes, top customers, busiest hour.", { range }),
  fn("delete_order", `Delete an order. ${DESTRUCTIVE_NOTE}`, { order_number: { type: "integer" }, confirm }, ["order_number"]),
  fn("list_reviews", "List reviews.", { dish_id: str(), min_chili: { type: "integer" }, max_chili: { type: "integer" }, search: str(), limit: { type: "integer", minimum: 1, maximum: 30 } }),
  fn("delete_review", `Delete a review. ${DESTRUCTIVE_NOTE}`, { id: str(), confirm }, ["id"]),
  fn("reset_leaderboard", `Restart the public leaderboard count from now (orders stay). ${DESTRUCTIVE_NOTE}`, { confirm }),
  fn("suggest_menu_ideas", "AI-brainstorm funny new dish ideas. NOT saved (use create_dish only if asked).", { count: { type: "integer", minimum: 1, maximum: 5 }, theme: str() }),
  fn("write_dish_copy", "AI-write and SAVE funny text into EMPTY fields (description, job_title, catchphrase, warnings) of up to 5 dishes.", { ids: { ...ids, maxItems: 5 }, overwrite: { type: "boolean" } }, ["ids"]),
  fn("bulk_update_badges", "Add/remove badges on many dishes.", { ids, add: badges, remove: badges }, ["ids"]),
  fn("find_issues", "What needs fixing: no photo, no description, hidden, duplicate names, zero price."),
];
const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));

function systemPrompt(lastUserText) {
  const arabic = /[؀-ۿ]/.test(lastUserText);
  return `You are "الشيف المساعد" (Chef assistant), the admin's AI sous-chef for Zesty Kitchen, a joke Egyptian food-ordering site where the dishes are coworkers. The admin is the owner.
STYLE: professional but funny, short. Egyptian Arabic + English mix (Cairo Gen-Z texting)${arabic ? ", leaning Arabic since they wrote Arabic" : ""}. Max 3 short sentences. No markdown tables (the UI shows tool results as cards already), no raw ids.
RULES:
- Always use tools to read or change data; never invent numbers, dishes or ids. Call list_dishes/find_issues first when you need ids.
- Destructive tools (delete_dish, delete_order, delete_review, reset_leaderboard): call them without confirm and tell the user to press Confirm or say yes. Pass confirm=true only if their LAST message clearly says yes to that action.
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

const YES = /^\s*(yes|yep|yeah|ya|y|ok(ay)?|sure|confirm(ed)?|do it|go( ahead)?|delete it|اه|آه|ايوه|أيوه|ايوة|أيوة|تمام|اكيد|أكيد|موافق|يلا|ماشي|امسح|احذف|امسحه|امسحها)\b/i;
const saidYes = (messages) => messages.length > 1 && messages[messages.length - 2].role === "assistant" && YES.test(messages[messages.length - 1].content);

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

// ---------- tool runtime ----------
function createSession(db, ai, { secret, tz, messages }) {
  const cards = [];
  const actions = [];
  const refresh = new Set();
  const label = admin.dishLabel;
  let dishCache = null;
  const allDishes = async () => (dishCache ||= await db.listDishes());
  const dirty = (...tabs) => {
    dishCache = null;
    tabs.forEach((t) => refresh.add(t));
  };
  const card = (c) => cards.push(c);
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

  // Destructive tools: check() validates and describes, run() does it
  const destructive = {
    delete_dish: {
      async check({ id }) {
        const d = await findDish(id);
        if (!d) return noDish(id);
        const reviews = (await db.listReviews(d.id)).length;
        return { args: { id: d.id }, summary: `Delete “${label(d)}”${reviews ? ` + ${reviews} review${reviews > 1 ? "s" : ""}` : ""}${d.photo_path ? " + photo" : ""}. Can't be undone.` };
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
        return { args: { order_number: n }, summary: `Delete order #${n} by ${firstName(o.customer_name)} (${Number(o.total)} EGP). It also stops counting on the leaderboard.` };
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
  };

  const tools = {
    async list_dishes({ query, category, visibility = "all", badge, sort = "menu", limit = 15 }) {
      const [dishes, orders] = await Promise.all([allDishes(), sort.includes("ordered") ? db.listOrders() : []]);
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
      card({ kind: "dishes", title: `🍽️ ${list.length} dish${list.length === 1 ? "" : "es"}${list.length > n ? ` (first ${n})` : ""}`, items: shown.map(dishRow) });
      return { count: list.length, dishes: shown.map((d) => (sort.includes("ordered") ? { ...brief(d), ordered: qty.get(d.id) || 0 } : brief(d))) };
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
      dirty("dishes", "overview");
      card({ kind: "dishes", title: "✨ Hired a new coworker", items: [dishRow(d)] });
      return { ok: true, dish: brief(d) };
    },
    async update_dish({ id, fields: f }) {
      const d = await findDish(id);
      if (!d) return noDish(id);
      const { value, error } = validated(() => admin.dishFields(f || {}, { partial: true }));
      if (error) return { error };
      if (!Object.keys(value).length) return { error: "Nothing to update: pass fields like price, description, badges." };
      const updated = await db.updateDish(d.id, value);
      dirty("dishes", "overview");
      card({ kind: "dishes", title: `✏️ Updated: ${Object.keys(value).join(", ")}`, items: [dishRow(updated)] });
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
      for (const d of change) await db.updateDish(d.id, { is_visible: visible });
      if (change.length) dirty("dishes", "overview");
      const verb = visible ? "👁 Shown" : "🙈 Hidden";
      card({ kind: "summary", tone: "ok", text: `${verb}: ${change.length} dish${change.length === 1 ? "" : "es"}${targets.length > change.length ? ` (${targets.length - change.length} already ${visible ? "visible" : "hidden"})` : ""}.` });
      if (change.length) card({ kind: "dishes", title: verb, items: change.map((d) => dishRow({ ...d, is_visible: visible })) });
      return { ok: true, changed: change.map((d) => label(d)), already: targets.length - change.length, matched: targets.length };
    },
    async duplicate_dish({ id }) {
      const copy = await admin.duplicateDish(db, String(id ?? ""));
      if (!copy) return noDish(id);
      dirty("dishes");
      card({ kind: "dishes", title: "📄 Copy created (hidden, no photo)", items: [dishRow(copy)] });
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
        title: `🧾 ${list.length} order${list.length === 1 ? "" : "s"} · ${rk} · ${menu.round2(total)} EGP`,
        columns: ["#", "Customer", "Items", "Total", "When"],
        rows: shown.map((o) => [`#${o.order_number}`, firstName(o.customer_name), items(o), `${Number(o.total)} EGP`, o.created_at]),
        time_col: 4,
      });
      return { count: list.length, total_egp: menu.round2(total), orders: shown.map((o) => ({ n: o.order_number, by: firstName(o.customer_name), items: items(o), total: Number(o.total), at: o.created_at })) };
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
      return { range: rk, orders: s.count, revenue: s.revenue, avg: s.avg_order_value, busiest_hour: hour, top_dishes: s.top_dishes.map((d) => `${d.name} ×${d.qty}`), top_customers: s.top_customers.map((c) => `${c.name} (${c.orders})`), payments: s.payments };
    },
    async list_reviews({ dish_id, min_chili, max_chili, search, limit = 15 }) {
      const [reviews, dishes] = await Promise.all([db.listReviews(dish_id ? String(dish_id) : undefined), allDishes()]);
      const byId = new Map(dishes.map((d) => [d.id, d]));
      const q = String(search || "").toLowerCase().trim();
      const lo = clampInt(min_chili, 1, 5, 1);
      const hi = clampInt(max_chili, 1, 5, 5);
      const list = reviews.filter((r) => r.chili_rating >= lo && r.chili_rating <= hi && (!q || `${r.author_name} ${r.body}`.toLowerCase().includes(q)));
      const n = clampInt(limit, 1, 30, 15);
      const shown = list.slice(0, n);
      const dn = (r) => (byId.has(r.dish_id) ? label(byId.get(r.dish_id)) : "?");
      card({ kind: "table", title: `💬 ${list.length} review${list.length === 1 ? "" : "s"}`, columns: ["Dish", "By", "🌶️", "Review"], rows: shown.map((r) => [dn(r), r.author_name, r.chili_rating, clip(r.body, 120)]) });
      return { count: list.length, reviews: shown.map((r) => ({ id: r.id, dish: dn(r), by: r.author_name, chili: r.chili_rating, text: clip(r.body, 100) })) };
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
      if (!targets.length) return { error: "Those dishes already have all their text (pass overwrite: true to rewrite)." };
      const raw = await ai.generate({
        system: "You write funny menu copy for a joke Egyptian restaurant where every dish is an office coworker. Egyptian Arabic + English Gen-Z mix, never fusha. Office humor only: never about bodies, religion or looks.",
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
      const done = [];
      for (const [i, t] of targets.entries()) {
        const got = out.find((x) => Number(x?.i) === i) || out[i];
        if (!got) continue;
        const patch = {};
        for (const k of t.empty) if (clip(got[k], COPY[k])) patch[k] = clip(got[k], COPY[k]);
        if (!Object.keys(patch).length) continue;
        const { value, error } = validated(() => admin.dishFields(patch, { partial: true }));
        if (error) continue;
        await db.updateDish(t.d.id, value);
        done.push({ id: t.d.id, name: label(t.d), ...value });
      }
      if (!done.length) return { error: "The AI wrote nonsense, nothing was saved. Try again." };
      dirty("dishes", "overview");
      card({ kind: "table", title: `✍️ Wrote copy for ${done.length} dish${done.length === 1 ? "" : "es"} (saved)`, columns: ["Dish", "Job title", "Description"], rows: done.map((d) => [d.name, d.job_title || "–", d.description || "–"]) });
      return { ok: true, saved: done.map((d) => ({ name: d.name, fields: Object.keys(d).filter((k) => k in COPY) })) };
    },
    async bulk_update_badges({ ids: list, add = [], remove = [] }) {
      const addB = (Array.isArray(add) ? add : []).map(String);
      const remB = (Array.isArray(remove) ? remove : []).map(String);
      if (!addB.length && !remB.length) return { error: "Pass badges to add or remove." };
      let result;
      try {
        result = await admin.bulkUpdateDishes(db, Array.isArray(list) ? list.map(String) : list, { addBadges: addB, removeBadges: remB });
      } catch (err) {
        if (err.status === 400) return { error: err.message };
        throw err;
      }
      dirty("dishes");
      card({ kind: "dishes", title: `🏷️ Badges updated${addB.length ? ` +${addB.join(", +")}` : ""}${remB.length ? ` −${remB.join(", −")}` : ""}`, items: result.updated.map(dishRow) });
      return { ok: true, updated: result.updated.map(label), missing: result.missing.length };
    },
    async find_issues() {
      const dishes = await allDishes();
      const groups = new Map();
      for (const d of dishes) {
        for (const key of [normName(d.name_ar), normName(d.name_en)].filter(Boolean)) {
          if (!groups.has(key)) groups.set(key, new Set());
          groups.get(key).add(d.id);
        }
      }
      const dupes = new Set([...groups.values()].filter((s) => s.size > 1).flatMap((s) => [...s]));
      const rows = [];
      const counts = { no_photo: 0, no_description: 0, hidden: 0, duplicate: 0, zero_price: 0 };
      for (const d of dishes) {
        const issues = [];
        if (!d.photo_path) issues.push("no_photo");
        if (!String(d.description || "").trim()) issues.push("no_description");
        if (!d.is_visible) issues.push("hidden");
        if (dupes.has(d.id)) issues.push("duplicate");
        if (!Number(d.price)) issues.push("zero_price");
        issues.forEach((i) => counts[i]++);
        if (issues.length) rows.push({ d, issues });
      }
      const LABELS = { no_photo: "📸 no photo", no_description: "📝 no description", hidden: "🙈 hidden", duplicate: "👯 duplicate", zero_price: "🆓 0 EGP" };
      card({
        kind: "issues",
        title: rows.length ? `⚠️ ${rows.length} of ${dishes.length} dishes need love` : "✅ Nothing to fix. Chef's kiss 🤌",
        items: rows.slice(0, 40).map(({ d, issues }) => ({ ...dishRow(d), issues: issues.map((i) => LABELS[i]) })),
      });
      return { total_dishes: dishes.length, counts, dishes: rows.slice(0, 20).map(({ d, issues }) => ({ id: d.id, name: label(d), issues })) };
    },
  };

  async function run(name, args, { confirmed = false } = {}) {
    try {
      if (destructive[name]) {
        const plan = await destructive[name].check(args);
        if (plan.error) return plan;
        if (confirmed) {
          const result = await destructive[name].run(plan.args);
          card({ kind: "summary", tone: result.error ? "error" : "done", text: result.summary || result.error });
          return result;
        }
        const token = signAction(secret, name, plan.args);
        actions.push({ type: "confirm", tool: name, summary: plan.summary, token });
        card({ kind: "confirm", tone: "danger", text: plan.summary, token, tool: name });
        return { needs_confirmation: true, summary: plan.summary, note: "NOT done yet. Ask the user to press Confirm (or say yes)." };
      }
      const tool = tools[name];
      if (!tool) return { error: `Unknown tool ${name}` };
      return await tool(args || {});
    } catch (err) {
      if (err.status === 400) return { error: err.message };
      console.warn(`chef tool ${name} failed: ${err.message}`);
      return { error: "That broke in the kitchen. Try again or do it by hand." };
    }
  }

  const finish = () => {
    if (refresh.size) actions.push({ type: "refresh", tabs: [...refresh] });
    return { cards: cards.slice(-6), actions };
  };
  return { run, finish, cards, saidYes: saidYes(messages) };
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "?";
const cleanReply = (text) =>
  String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .slice(0, 1500);

// Deterministic replies for direct tool runs (quick chips, AI off)
const CANNED = {
  find_issues: "Here's what needs fixing 👇 دي الحاجات اللي محتاجة شوية حب.",
  order_stats: "The numbers, no cap 📊",
  list_orders: "Orders 👇",
  list_reviews: "Reviews 👇 brace yourself.",
  list_dishes: "The team 👇",
  set_visibility: "Done ✅",
  write_dish_copy: "Copy written and saved ✍️",
  suggest_menu_ideas: "Fresh ideas 💡 (not saved until you add them)",
};
// When the AI is off, simple read-only questions still get an answer
function offlineRoute(text) {
  const t = text.toLowerCase();
  if (/fix|issue|problem|missing|مشاكل|ناقص|اصلح|محتاج/.test(t)) return ["find_issues", {}];
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

    // 1) Confirm button: run exactly the signed action, no AI involved
    if (b.confirm_token !== undefined) {
      const p = verifyAction(secret, b.confirm_token);
      if (!p || !TOOL_NAMES.has(p.tool)) return res.status(400).json({ error: "That confirmation expired or is invalid. Ask again 🙏" });
      const session = createSession(db, ai, { secret, tz, messages: [] });
      const result = await session.run(p.tool, p.args, { confirmed: true });
      return res.status(result.error ? 409 : 200).json({ reply: result.summary || result.error, done: !result.error, ...session.finish() });
    }

    // 2) Direct tool run (quick chips, AI off): destructive tools still only get a confirm card
    if (b.run !== undefined) {
      const name = String(b.run?.tool || "");
      if (!TOOL_NAMES.has(name)) throw v.bad("skill issue: unknown tool");
      const args = b.run?.args && typeof b.run.args === "object" ? { ...b.run.args } : {};
      delete args.confirm;
      const session = createSession(db, ai, { secret, tz, messages: [] });
      const result = await session.run(name, args);
      const reply = result.error ? `😬 ${result.error}` : result.needs_confirmation ? "Sure? Press Confirm 👇" : CANNED[name] || "Done ✅";
      return res.json({ reply, ...session.finish() });
    }

    // 3) Chat with the AI tool loop
    const messages = parseMessages(b.messages);
    const lastUserText = messages[messages.length - 1].content;
    const session = createSession(db, ai, { secret, tz, messages });

    const offline = async () => {
      const route = offlineRoute(lastUserText);
      if (!route) return res.json({ reply: FALLBACK, fallback: true, ...session.finish() });
      await session.run(...route);
      return res.json({ reply: `${FALLBACK.split("(")[0].trim()} Meanwhile, ${CANNED[route[0]] || "here you go 👇"}`, fallback: true, ...session.finish() });
    };
    if (!ai?.enabled || typeof ai.chat !== "function") return offline();

    const convo = [{ role: "system", content: systemPrompt(lastUserText) }, ...messages];
    let reply = null;
    let provider = null; // one provider for the whole loop (Gemini rejects Groq's tool calls)
    for (let round = 0; round < MAX_ROUNDS && reply === null; round++) {
      const msg = await ai.chat({ messages: convo, tools: TOOLS, maxTokens: 260, temperature: 0.6, provider }).catch(() => null);
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
        // confirm=true is only honored right after the user said yes
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

module.exports = { chefAgentRouter, TOOLS, signAction, verifyAction, offlineRoute };
