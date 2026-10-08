// The chatbot waiter-agent "الجرسون الحقود": a server-orchestrated tool loop.
// The model calls tools; the server runs them (menu, cart, orders, reviews, tracking) against a
// server-side copy of the client's cart and hands back the new cart + UI actions. The browser just
// applies them. Slash commands ({ command: { name, args } }) run one tool directly, no AI needed.
const express = require("express");
const rateLimit = require("express-rate-limit");
const menu = require("../menu");
const persona = require("../persona");
const v = require("../validate");
const { cleanText } = require("../filter");
const orderLib = require("../orders");
const { createOrder, priceItem } = orderLib;
const { leaderboard, publicDish } = require("./public");

const MAX_HISTORY = 12;
const MAX_CHARS = 600;
const MAX_ROUNDS = 6;
// Order limits (shared with POST /api/orders when orders.js exports them): 30 lines, qty 1–99
const MAX_LINES = orderLib.MAX_LINES || 30;
const MAX_QTY = orderLib.MAX_QTY || 99;
const SIZE_KEYS = Object.keys(menu.SIZES);
const ADDON_KEYS = Object.keys(menu.ADDONS).filter((k) => menu.ADDONS[k].available);

const makeLimiter = () => rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many messages. The waiter needs a minute.", fallback: true, reply: "اهدى شوية.\nI'm one waiter, not a call center. Try again in a minute." },
});

const FALLBACKS = [
  "الجرسون في بريك شاي.\nThe AI is off, but the menu buttons and the / commands still work.",
  "The waiter is on a tea break and pretending not to see you. Try a / command meanwhile, those work.",
  "الجرسون نزل يجيب عيش ومرجعش. اكتب / وهتلاقي أوامر شغالة من غيره.",
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const lineKey = (dishId, size, addons) => `${dishId}|${size}|${[...addons].sort().join(",")}`;
const isOrderable = (d) => d.is_visible && d.category !== "expired" && !(d.badges || []).includes("sold_out");
const clampInt = (n, min, max, fallback) => {
  const x = Number(n);
  return Number.isInteger(x) ? Math.min(max, Math.max(min, x)) : fallback;
};
const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

// ---------- tool schemas (OpenAI format, kept terse: Groq's free tier is ~8k tokens/min) ----------
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const S = { type: "string" };
const I = { type: "integer" };
const ids = { type: "array", items: S };
const sizeProp = { type: "string", enum: SIZE_KEYS, description: "quarter 0.6x, half 1x (default), whole 1.8x, family 3x" };
const addonsProp = { type: "array", items: { type: "string", enum: ADDON_KEYS }, description: ADDON_KEYS.map((k) => `${k} +${menu.ADDONS[k].price}`).join(", ") };
const qtyProp = { type: "integer", minimum: 1, maximum: MAX_QTY };

const TOOLS = [
  fn("search_menu", "Search dishes (they're coworkers). Empty query lists all. Prices are half size.", {
    query: S,
    category: { type: "string", enum: menu.CATEGORIES.map((c) => c.slug) },
    sort: { type: "string", enum: ["price_asc", "price_desc", "spicy"] },
  }),
  fn("get_dish", "One dish: description, warnings, rating.", { id: S }, ["id"]),
  fn("recommend", "Pick dishes from real prices, order counts and ratings. budget = food EGP (joke fees extra).", { budget: { type: "number" }, mood: { type: "string", description: "e.g. spicy, sweet, light, hungry, cheap, popular, adventurous" }, people: I }),
  fn("view_cart", "Current cart and totals."),
  fn("add_to_cart", "Add a dish.", { dish_id: S, size: sizeProp, qty: qtyProp, addons: addonsProp }, ["dish_id"]),
  fn("update_cart_item", "Change a cart line's size/qty/add-ons. add_addons appends; addons replaces. current_size picks the line.", { dish_id: S, current_size: sizeProp, size: sizeProp, qty: qtyProp, addons: addonsProp, add_addons: addonsProp }, ["dish_id"]),
  fn("remove_from_cart", "Remove a dish (all sizes unless size given).", { dish_id: S, size: sizeProp }, ["dish_id"]),
  fn("clear_cart", "Empty the cart."),
  fn("show_dish_photos", "Show dish cards with photos.", { dish_ids: { ...ids, maxItems: 6 } }, ["dish_ids"]),
  fn("compare_dishes", "Side-by-side comparison table (2-4 dishes).", { dish_ids: { ...ids, maxItems: 4 } }, ["dish_ids"]),
  fn("surprise_me", "Add one random dish to the cart."),
  fn("place_order", "Place a REAL order with the cart. Only after the user confirmed.", { customer_name: S, payment_method: { type: "string", enum: menu.PAYMENT_METHODS }, note: S }, ["payment_method"]),
  fn("open_checkout", "Send the user to the checkout page."),
  fn("my_orders", "The user's previous orders on this device."),
  fn("reorder_last", "Put the items of a previous order (default: latest) back in the cart.", { order_number: I }),
  fn("track_order", "Order status + tracker link.", { order_number: I }, ["order_number"]),
  fn("open_tracker", "Open the tracker page of an order (default: latest).", { order_number: I }),
  fn("return_order", "Return/refund/cancel request (always refused).", { order_number: I }),
  fn("split_bill", "Split an order's or the cart's total between people.", { people: I, order_number: I, tip_percent: I }, ["people"]),
  fn("get_reviews", "Recent reviews of a dish.", { dish_id: S }, ["dish_id"]),
  fn("post_review", "Post a REAL review with the user's own words and ratings (1-5).", { dish_id: S, author_name: S, chili: I, awkward: I, body: S }, ["dish_id", "chili", "awkward", "body"]),
  fn("set_customer_name", "Remember the user's name.", { name: S }, ["name"]),
  fn("get_leaderboard", "Most ordered coworkers and the least wanted."),
];
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.function.name, t]));

// Only send the tools a message could plausibly need: every schema costs tokens on every round
const CORE = ["search_menu", "get_dish", "recommend", "view_cart", "add_to_cart", "update_cart_item", "remove_from_cart", "show_dish_photos", "place_order"];
const EXTRA = [
  [/clear|empty|فضي|فاضي|امسح|شيل كل/i, ["clear_cart"]],
  [/compar|\bvs\b|versus|differ|better|which|قارن|مقارن|فرق|أحسن|احسن|ولا ايه/i, ["compare_dishes"]],
  [/surpris|random|anything|whatever|فاجئ|فاجأ|عشوائي|أي حاجة|اي حاجة/i, ["surprise_me"]],
  [/check ?out|pay|دفع|ادفع|الحساب|كمل/i, ["open_checkout"]],
  [/order|again|last|same|usual|track|where|refund|return|cancel|اوردر|أوردر|طلب|تاني|زي المرة|فين|تتبع|رجع|استرجاع|الغي|إلغاء/i, ["my_orders", "reorder_last", "track_order", "open_tracker", "return_order"]],
  [/split|share|divid|each|people|friends|قسم|نقسم|كل واحد|علينا|صحاب/i, ["split_bill"]],
  [/review|rate|rating|star|ريفيو|تقييم|قيم|رأي|راي|كومنت/i, ["get_reviews", "post_review"]],
  [/name|call me|i'm|i am|اسمي|ناديني|انا /i, ["set_customer_name"]],
  [/top|popular|best|leader|most|famous|trend|الأكثر|اكتر|أشهر|اشهر|ترند|مين/i, ["get_leaderboard"]],
];
function toolsFor(text) {
  const names = new Set(CORE);
  for (const [re, list] of EXTRA) if (re.test(text)) list.forEach((n) => names.add(n));
  return TOOLS.filter((t) => names.has(t.function.name));
}

// ---------- prompt ----------
// Match the user when they clearly write in one language; otherwise vary it per reply
function languageInstruction(lastUserText) {
  const arabic = /[؀-ۿ]/.test(lastUserText);
  const latin = /[a-z]{2,}/i.test(lastUserText);
  if (arabic && !latin) return "LANGUAGE: the user wrote in Arabic, so reply in Egyptian colloquial Arabic.";
  if (latin && !arabic && lastUserText.trim().split(/\s+/).length >= 3) return "LANGUAGE: the user wrote in English, so reply in plain dry English.";
  try {
    const s = persona.languageMode();
    if (typeof s === "string" && s.trim()) return s;
  } catch {
    /* fall through */
  }
  return "LANGUAGE: Egyptian Arabic with a little English.";
}

function systemPrompt({ cart, orders, name, lastUserText }) {
  const cartLine = cart.length ? cart.map((l) => `${l.qty}x ${l.name_en} (${l.size}${l.addons.length ? ` + ${l.addons.join(",")}` : ""})`).join("; ") : "empty";
  const orderLine = orders.length ? `${orders.join(", ")} (latest ${orders[orders.length - 1]})` : "none";
  return `${persona.PERSONA_LITE || persona.PERSONA}

ROLE: you are "الجرسون الحقود", the chat waiter of Zesty Kitchen. You browse the menu, recommend, compare, edit the cart, reorder, split bills, post reviews, place and track orders, and keep a straight face about it.
RULES:
- ALWAYS use tools to do things; never claim you did something without a tool call. Tool error? Say it plainly.
- Never invent dishes, prices, ids or order numbers. Get ids from search_menu/recommend.
- Suggestions, budget, mood or group size → recommend. "Same as last time" → reorder_last. Photos → show_dish_photos.
- Before place_order confirm the cart, name and payment (vibes, insults, owe_lunch; default vibes) unless they clearly asked and gave it.
- post_review only with the user's own words and ratings; ask for what's missing. Never write a review for them.
- If they tell you their name, call set_customer_name. Returns always go through return_order.
- Limits: qty 1-${MAX_QTY} per line, ${MAX_LINES} lines. Prices in EGP.
- Max 3 short sentences. No markdown tables or id lists; the UI shows cards.
- ${languageInstruction(lastUserText)}
CONTEXT: cart: ${cartLine}. Their order numbers: ${orderLine}. Their name: ${name || "unknown"}.`;
}

// ---------- request validation ----------
function bad(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

const COMMANDS = ["recommend", "surprise_me", "view_cart", "clear_cart", "reorder_last", "my_orders", "split_bill", "open_checkout", "open_tracker", "track_order", "get_leaderboard", "compare_dishes", "search_menu", "set_customer_name"];

function parseBody(body) {
  const b = body || {};
  let command = null;
  if (b.command != null) {
    const name = b.command?.name;
    if (!COMMANDS.includes(name)) throw bad("skill issue: unknown command");
    const args = b.command.args && typeof b.command.args === "object" && !Array.isArray(b.command.args) ? b.command.args : {};
    command = { name, args };
  }
  let messages = [];
  if (!command) {
    if (!Array.isArray(b.messages) || !b.messages.length) throw bad("skill issue: say something first");
    if (b.messages.length > 60) throw bad("skill issue: conversation is too long");
    messages = b.messages
      .slice(-MAX_HISTORY)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
    while (messages.length && messages[0].role !== "user") messages.shift(); // some providers want user first
    if (!messages.length || messages[messages.length - 1].role !== "user") throw bad("skill issue: the last message must be yours");
  }
  if (b.cart != null && !Array.isArray(b.cart)) throw bad("skill issue: cart must be a list");
  const cart = (b.cart || []).slice(0, MAX_LINES);
  const orders = (Array.isArray(b.orders) ? b.orders : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(-10);
  const name = typeof b.name === "string" ? cleanText(b.name.trim().slice(0, 40)) : "";
  return { messages, cart, orders, name, command };
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const val = JSON.parse(raw || "{}");
    return val && typeof val === "object" ? val : {};
  } catch {
    return {};
  }
}

// ---------- tool runtime ----------
const trackerUrl = (order) => `/order?n=${encodeURIComponent(order.order_number)}&dish=${encodeURIComponent(order.items?.[0]?.dish_id || "")}`;

function createSession(db, { dishes, cart, orders = [], name = "" }) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const actions = [];
  const shown = new Map();
  const placed = [];
  const state = { name, reviews: 0 };

  const card = (d) => ({
    id: d.id,
    name_ar: d.name_ar,
    name_en: d.name_en,
    price: Number(d.price),
    category: d.category,
    job_title: d.job_title || "",
    photo_url: db.photoUrl(d.photo_path),
    sold_out: !isOrderable(d),
  });
  const totals = () => {
    const subtotal = menu.round2(cart.reduce((s, l) => s + l.unit_price * l.qty, 0));
    return { subtotal, total: cart.length ? menu.computeFees(subtotal).total : 0 };
  };
  const cartView = () => ({ items: cart.map(({ name_ar, name_en, size, addons, qty, unit_price, dish_id }) => ({ dish_id, name_ar, name_en, size, addons, qty, unit_price })), ...totals() });
  const changed = (what) => actions.push({ type: "cart_updated", what });

  // Lazily loaded real stats (order counts since the leaderboard reset, review averages)
  let statsPromise = null;
  const stats = () =>
    (statsPromise ||= (async () => {
      const since = await db.getSetting("leaderboard_since").catch(() => null);
      const [all, reviews] = await Promise.all([db.listOrders(since).catch(() => []), db.listReviews().catch(() => [])]);
      const counts = new Map();
      for (const o of all) for (const i of o.items || []) counts.set(i.dish_id, (counts.get(i.dish_id) || 0) + (i.qty || 1));
      const ratings = new Map();
      for (const r of reviews) {
        if (!ratings.has(r.dish_id)) ratings.set(r.dish_id, []);
        ratings.get(r.dish_id).push(Number(r.chili_rating) || 0);
      }
      return { orders: (id) => counts.get(id) || 0, rating: (id) => avg(ratings.get(id) || []), reviews: (id) => (ratings.get(id) || []).length };
    })());

  const findDish = (id) => {
    const d = byId.get(String(id ?? ""));
    if (!d || !d.is_visible) return { error: `No dish with id "${id}". Call search_menu to get real ids.` };
    return { dish: d };
  };
  const makeLine = (d, size, addons, qty) => {
    const unit_price = menu.linePrice(d.price, size, addons);
    return { key: lineKey(d.id, size, addons), dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: db.photoUrl(d.photo_path), size, addons, qty, unit_price };
  };
  const checkOptions = (size, addons) => {
    if (!SIZE_KEYS.includes(size)) return `Invalid size "${size}". Use one of ${SIZE_KEYS.join(", ")}.`;
    if (!Array.isArray(addons)) return "addons must be a list";
    const badAddon = addons.find((a) => !ADDON_KEYS.includes(a));
    if (badAddon) return badAddon === "no_drama" ? "no_drama is not available. It never was." : `Invalid add-on "${badAddon}". Options: ${ADDON_KEYS.join(", ")}.`;
    return null;
  };
  const clampQty = (q, fallback = 1) => clampInt(q ?? fallback, 1, MAX_QTY, fallback);
  const merge = (line) => {
    const existing = cart.find((l) => l.key === line.key);
    if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + line.qty);
    else {
      if (cart.length >= MAX_LINES) return false;
      cart.push(line);
    }
    return true;
  };
  const latestOrder = (n) => (n ?? orders[orders.length - 1]);
  const navigate = (url, label, auto = true) => actions.push({ type: "navigate", url, label, auto });

  const tools = {
    search_menu({ query, category, sort }) {
      const q = String(query || "").trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      let list = dishes.filter((d) => d.is_visible && (!category || d.category === category));
      if (words.length) {
        const scored = list
          .map((d) => {
            const hay = [d.name_ar, d.name_en, d.job_title, d.description, d.catchphrase, d.category].join(" ").toLowerCase();
            return { d, score: words.filter((w) => hay.includes(w)).length };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        // Vague queries ("something good") match nothing: show the menu instead of an empty list
        if (scored.length) list = scored.map((x) => x.d);
      }
      if (sort === "price_asc") list = [...list].sort((a, b) => a.price - b.price);
      if (sort === "price_desc") list = [...list].sort((a, b) => b.price - a.price);
      if (sort === "spicy") list = [...list].sort((a, b) => (b.spice_level ?? 3) - (a.spice_level ?? 3));
      return { count: list.length, dishes: list.slice(0, 15).map(card) };
    },
    async get_dish({ id }) {
      const { dish, error } = findDish(id);
      if (error) return { error };
      const reviews = await db.listReviews(dish.id);
      const pub = publicDish(db, dish, reviews);
      delete pub.viewers;
      return { ...pub, sold_out: !isOrderable(dish), recent_reviews: reviews.slice(0, 3).map((r) => ({ by: r.author_name, chili: r.chili_rating, text: String(r.body).slice(0, 160) })) };
    },

    // Budget / mood / group-size picks from real data: order counts, review averages, prices
    async recommend({ budget, mood, people } = {}) {
      const st = await stats();
      const n = clampInt(people, 1, 30, 1);
      const size = n === 1 ? "half" : n === 2 ? "whole" : "family";
      const qty = n >= 3 ? Math.ceil(n / 3) : 1;
      const cap = Number(budget) > 0 ? Number(budget) : null;
      const m = String(mood || "").toLowerCase();
      const MOODS = [
        [/spic|hot|حار|حراق|شطة/, (d) => (d.spice_level ?? 3) >= 4 || (d.badges || []).includes("spicy") || d.category === "torshi"],
        [/sweet|dessert|حلو|سكر/, (d) => ["desserts", "basbousa", "asab"].includes(d.category)],
        [/light|small|snack|خفيف|صغير/, (d) => ["appetizers", "sandwiches", "soups", "taameya", "ful", "bread", "asab"].includes(d.category)],
        [/hungry|starv|heavy|big|جعان|تقيل|واقع/, (d) => ["mandi", "trays", "grills", "fatta", "koshary", "seafood"].includes(d.category)],
        [/popular|best|famous|مشهور|أشهر/, (d) => st.orders(d.id) > 0],
        [/advent|new|weird|different|جديد|غريب/, (d) => st.orders(d.id) <= 1],
      ];
      let pool = dishes.filter(isOrderable);
      const rule = MOODS.find(([re]) => re.test(m));
      if (rule) {
        const filtered = pool.filter(rule[1]);
        if (filtered.length) pool = filtered;
      }
      const price = (d, s = size) => menu.round2(menu.linePrice(d.price, s, []) * qty);
      const fitSize = (d) => {
        if (!cap) return size;
        return [size, "half", "quarter"].find((s) => price(d, s) <= cap) || null;
      };
      const scored = pool
        .map((d) => {
          const s = fitSize(d);
          if (!s) return null;
          const orders = st.orders(d.id);
          const rating = st.rating(d.id);
          const badges = d.badges || [];
          const score = Math.log2(1 + orders) * 2 + (rating ?? 2.5) + (badges.includes("popular") ? 1 : 0) + (badges.includes("chefs_pick") ? 1 : 0) + Math.random() * 1.5;
          return { d, s, orders, rating, reviews: st.reviews(d.id), score, line: price(d, s) };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
      if (!scored.length) {
        const cheapest = dishes.filter(isOrderable).sort((a, b) => a.price - b.price)[0];
        return { error: cheapest ? `Nothing fits ${cap} EGP. Cheapest is ${cheapest.name_en}: ${menu.linePrice(cheapest.price, "quarter", [])} EGP for a quarter.` : "Nothing is orderable right now." };
      }
      const picks = [];
      const take = (x, tag) => x && !picks.some((p) => p.d.id === x.d.id) && picks.push({ ...x, tag });
      take(scored[0], "top");
      take([...scored].sort((a, b) => b.score / b.line - a.score / a.line)[0], "value");
      take([...scored].filter((x) => !picks.some((p) => p.d.id === x.d.id)).sort((a, b) => a.orders - b.orders || b.score - a.score)[0], "wildcard");
      const reason = (x) =>
        [x.orders ? `ordered ${x.orders}x` : "nobody ordered yet", x.rating != null ? `${x.rating}/5 from ${x.reviews} review${x.reviews === 1 ? "" : "s"}` : null, cap ? `${x.line} of ${cap} EGP` : `${x.line} EGP`, x.s !== size ? `${x.s} size to fit the budget` : null]
          .filter(Boolean)
          .join(" · ");
      const out = picks.map((x) => ({ ...card(x.d), tag: x.tag, size: x.s, qty, line_total: x.line, orders: x.orders, rating: x.rating, reason: reason(x), est_total_with_fees: menu.computeFees(x.line).total }));
      actions.push({ type: "recommend", budget: cap, people: n, mood: m || null, picks: out });
      return { picks: out.map(({ id, name_en, tag, size: sz, qty: q, line_total, reason: r }) => ({ id, name_en, tag, size: sz, qty: q, line_total, reason: r })), note: "joke fees (~170 EGP + 14%) are extra" };
    },

    async compare_dishes({ dish_ids }) {
      const list = (Array.isArray(dish_ids) ? dish_ids : []).map((id) => byId.get(String(id))).filter((d) => d && d.is_visible);
      const uniq = [...new Map(list.map((d) => [d.id, d])).values()].slice(0, 4);
      if (uniq.length < 2) return { error: "Need at least 2 real dish ids. Call search_menu first." };
      const st = await stats();
      const rows = uniq.map((d) => ({ ...card(d), from: menu.linePrice(d.price, "quarter", []), spice: d.spice_level ?? 3, rating: st.rating(d.id), reviews: st.reviews(d.id), orders: st.orders(d.id), calories: d.calories ?? 0, badges: d.badges || [], catchphrase: d.catchphrase || "" }));
      const best = (fnScore) => [...rows].sort((a, b) => fnScore(b) - fnScore(a))[0].id;
      const winners = { cheapest: best((r) => -r.price), most_ordered: best((r) => r.orders), spiciest: best((r) => r.spice), best_rated: best((r) => r.rating ?? 0) };
      actions.push({ type: "compare", dishes: rows, winners });
      return { dishes: rows.map(({ id, name_en, price, spice, rating, orders, sold_out }) => ({ id, name_en, price, spice, rating, orders, sold_out })), winners };
    },

    view_cart() {
      return cartView();
    },
    add_to_cart({ dish_id, size = "half", qty, addons = [] }) {
      const { dish, error } = findDish(dish_id);
      if (error) return { error };
      if (!isOrderable(dish)) return { error: `${dish.name_en} is sold out / left the company. Can't be ordered.` };
      const err = checkOptions(size, addons);
      if (err) return { error: err };
      const line = makeLine(dish, size, [...new Set(addons)], clampQty(qty));
      if (!merge(line)) return { error: `Cart is full (max ${MAX_LINES} different items).` };
      changed("add");
      return { ok: true, added: { name_en: dish.name_en, size, qty: line.qty, addons: line.addons, unit_price: line.unit_price }, cart: cartView() };
    },
    remove_from_cart({ dish_id, size }) {
      const before = cart.length;
      for (let i = cart.length - 1; i >= 0; i--) {
        if (cart[i].dish_id === String(dish_id) && (!size || cart[i].size === size)) cart.splice(i, 1);
      }
      if (cart.length === before) return { error: "That dish is not in the cart." };
      changed("remove");
      return { ok: true, removed: before - cart.length, cart: cartView() };
    },
    update_cart_item({ dish_id, current_size, size, qty, addons, add_addons }) {
      const idx = cart.findIndex((l) => l.dish_id === String(dish_id) && (!current_size || l.size === current_size));
      if (idx < 0) return { error: "That dish is not in the cart. Use add_to_cart." };
      const old = cart[idx];
      const dish = byId.get(old.dish_id);
      if (!dish) return { error: "That dish doesn't exist anymore." };
      const nextSize = size || old.size;
      let nextAddons = Array.isArray(addons) ? addons : old.addons;
      if (Array.isArray(add_addons)) nextAddons = [...nextAddons, ...add_addons];
      nextAddons = [...new Set(nextAddons)];
      const err = checkOptions(nextSize, nextAddons);
      if (err) return { error: err };
      cart.splice(idx, 1);
      merge(makeLine(dish, nextSize, nextAddons, clampQty(qty, old.qty)));
      changed("update");
      return { ok: true, cart: cartView() };
    },
    clear_cart() {
      const had = cart.length;
      cart.length = 0;
      if (had) changed("clear");
      return { ok: true, cart: cartView() };
    },
    show_dish_photos({ dish_ids }) {
      const list = Array.isArray(dish_ids) ? dish_ids.slice(0, 6) : [];
      const found = list.map((id) => byId.get(String(id))).filter((d) => d && d.is_visible);
      if (!found.length) return { error: "None of those ids exist. Call search_menu first." };
      const cards = found.map(card);
      cards.forEach((c) => shown.set(c.id, c));
      actions.push({ type: "show_dishes", ids: cards.map((c) => c.id) });
      return { ok: true, shown: cards.map((c) => c.name_en) };
    },
    surprise_me() {
      const pool = dishes.filter(isOrderable);
      if (!pool.length) return { error: "Nothing is orderable right now." };
      const fresh = pool.filter((d) => !cart.some((l) => l.dish_id === d.id));
      const dish = pick(fresh.length ? fresh : pool);
      const size = pick(["quarter", "half", "half", "whole"]);
      const addons = Math.random() < 0.4 ? [pick(ADDON_KEYS)] : [];
      const line = makeLine(dish, size, addons, 1);
      if (!merge(line)) return { error: `Cart is full (max ${MAX_LINES} different items).` };
      changed("add");
      shown.set(dish.id, card(dish));
      actions.push({ type: "show_dishes", ids: [dish.id] });
      return { ok: true, added: { id: dish.id, name_en: dish.name_en, name_ar: dish.name_ar, size, addons, unit_price: line.unit_price }, cart: cartView() };
    },
    async place_order({ customer_name, payment_method = "vibes", note }) {
      if (!cart.length) return { error: "The cart is empty. Add something first." };
      const who = String(customer_name || state.name || "").trim();
      if (!who) return { error: "Need the customer's name first. Ask for it." };
      if (!menu.PAYMENT_METHODS.includes(payment_method)) payment_method = "vibes";
      try {
        const result = await createOrder(db, {
          customer_name: who.slice(0, 40),
          payment_method,
          note: note ? String(note).slice(0, 200) : undefined,
          items: cart.map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
        });
        const url = trackerUrl(result);
        cart.length = 0;
        changed("order");
        const info = { order_number: result.order_number, total: result.total, url, items: result.items.map((i) => `${i.qty}x ${i.name_en}`) };
        placed.push(info);
        orders.push(result.order_number);
        actions.push({ type: "order_placed", ...info });
        return { ok: true, ...info, tracker_url: url };
      } catch (err) {
        if (err.status === 400) return { error: err.message };
        throw err;
      }
    },
    open_checkout() {
      if (!cart.length) return { error: "The cart is empty, there's nothing to check out." };
      navigate("/checkout", "Checkout");
      return { ok: true, opening: "/checkout", ...totals() };
    },
    async my_orders() {
      if (!orders.length) return { orders: [], note: "No orders from this device yet." };
      const set = new Set(orders);
      const found = (await db.listOrders()).filter((o) => set.has(Number(o.order_number))).slice(0, 10);
      const list = found.map((o) => ({ order_number: o.order_number, total: o.total, items: (o.items || []).map((i) => `${i.qty}x ${i.name_en}`), status: trackStatus(o).status, minutes_ago: trackStatus(o).minutes_ago, url: trackerUrl(o) }));
      actions.push({ type: "orders", orders: list });
      return { orders: list.map(({ order_number, total, items, minutes_ago }) => ({ order_number, total, items, minutes_ago })) };
    },
    async reorder_last({ order_number } = {}) {
      const n = latestOrder(order_number);
      if (!n) return { error: "No previous orders on this device. Order something first." };
      const order = await findOrder(db, n);
      if (!order) return { error: `No order #${n}.` };
      const added = [];
      const skipped = [];
      for (const it of order.items || []) {
        const dish = byId.get(it.dish_id);
        const addons = (it.addons || []).filter((a) => ADDON_KEYS.includes(a));
        if (!dish || !isOrderable(dish)) skipped.push(`${it.name_en || it.dish_id} (not available anymore)`);
        else if (!SIZE_KEYS.includes(it.size)) skipped.push(`${dish.name_en} (old size)`);
        else if (!merge(makeLine(dish, it.size, addons, clampQty(it.qty)))) skipped.push(`${dish.name_en} (cart full)`);
        else added.push(`${clampQty(it.qty)}x ${dish.name_en} (${it.size})`);
      }
      if (added.length) changed("reorder");
      return { ok: added.length > 0, order_number: order.order_number, added, skipped, cart: cartView() };
    },
    async track_order({ order_number }) {
      const order = await findOrder(db, order_number);
      if (!order) return { error: `No order #${order_number}. Maybe it was a dream.` };
      const url = trackerUrl(order);
      navigate(url, `Track #${order.order_number}`, false);
      return { order_number: order.order_number, ...trackStatus(order), items: order.items.map((i) => `${i.qty}x ${i.name_en}`), total: order.total, tracker_url: url };
    },
    async open_tracker({ order_number } = {}) {
      const n = latestOrder(order_number);
      if (!n) return { error: "No order number. Which order?" };
      const order = await findOrder(db, n);
      if (!order) return { error: `No order #${n}.` };
      navigate(trackerUrl(order), `Track #${order.order_number}`);
      return { ok: true, order_number: order.order_number, ...trackStatus(order) };
    },
    async return_order({ order_number }) {
      const order = order_number ? await findOrder(db, order_number) : null;
      return {
        refused: true,
        order_number: order?.order_number ?? order_number ?? null,
        reason: pick([
          "No refunds: the kitchen already ate the order. Returning it now would be a medical procedure.",
          "Returns policy: the coworker refuses to come back. They got used to your place.",
          "Refund request received, read, and placed gently in the bin.",
          "Can't return it. The delivery guy already told his mom about it.",
        ]),
      };
    },
    // Math only: splits the order (or cart) total, rounded up to the piastre
    async split_bill({ people, order_number, tip_percent } = {}) {
      const n = clampInt(people, 1, 50, null);
      if (!n || n < 2) return { error: "Need at least 2 people to split. Splitting with yourself is just paying." };
      let base;
      let source;
      if (order_number) {
        const order = await findOrder(db, order_number);
        if (!order) return { error: `No order #${order_number}.` };
        base = Number(order.total);
        source = `order #${order.order_number}`;
      } else if (cart.length) {
        base = totals().total;
        source = "cart";
      } else {
        const last = orders.length ? await findOrder(db, orders[orders.length - 1]) : null;
        if (!last) return { error: "Nothing to split: the cart is empty and there's no order." };
        base = Number(last.total);
        source = `order #${last.order_number}`;
      }
      const tip = clampInt(tip_percent ?? 0, 0, 30, 0);
      const total = menu.round2(base * (1 + tip / 100));
      const each = Math.ceil((total / n) * 100) / 100;
      const extra = menu.round2(each * n - total);
      const info = { source, people: n, base: menu.round2(base), tip_percent: tip, total, each, rounding_extra: extra };
      actions.push({ type: "split", ...info });
      return info;
    },
    async get_reviews({ dish_id }) {
      const { dish, error } = findDish(dish_id);
      if (error) return { error };
      const reviews = await db.listReviews(dish.id);
      return { dish: dish.name_en, count: reviews.length, avg_chili: avg(reviews.map((r) => r.chili_rating)), reviews: reviews.slice(0, 5).map((r) => ({ by: r.author_name, chili: r.chili_rating, awkward: r.awkward_rating, text: String(r.body).slice(0, 160) })) };
    },
    // Same validation + word filter as POST /api/dishes/:id/reviews; one per request
    async post_review({ dish_id, author_name, chili, awkward, body }) {
      const { dish, error } = findDish(dish_id);
      if (error) return { error };
      if (state.reviews >= 1) return { error: "One review per message. Relax." };
      try {
        const review = await db.createReview({
          dish_id: dish.id,
          author_name: cleanText(v.text(String(author_name || state.name || ""), "name", { max: 40 })),
          chili_rating: v.int(chili, "chili rating", 1, 5),
          awkward_rating: v.int(awkward, "awkward rating", 1, 5),
          body: cleanText(v.text(String(body ?? ""), "review", { max: 500 })),
        });
        state.reviews++;
        const posted = { id: review.id, author_name: review.author_name, chili: review.chili_rating, awkward: review.awkward_rating, body: review.body };
        actions.push({ type: "review_posted", dish: card(dish), review: posted });
        return { ok: true, posted };
      } catch (err) {
        if (err.status === 400) return { error: err.message };
        throw err;
      }
    },
    set_customer_name({ name }) {
      try {
        state.name = cleanText(v.text(String(name ?? ""), "name", { max: 40 }));
      } catch (err) {
        return { error: err.message };
      }
      actions.push({ type: "set_name", name: state.name });
      return { ok: true, name: state.name };
    },
    async get_leaderboard() {
      const board = await leaderboard(db);
      return { top: board.top.map((d) => ({ id: d.id, name_en: d.name_en, name_ar: d.name_ar, orders: d.orders })), least_wanted: board.worst && { id: board.worst.id, name_en: board.worst.name_en }, total_orders: board.total_orders };
    },
  };

  async function run(name, args) {
    const tool = tools[name];
    if (!tool) return { error: `Unknown tool ${name}` };
    try {
      return await tool(args || {});
    } catch (err) {
      console.warn(`agent tool ${name} failed: ${err.message}`);
      return { error: "That broke in the kitchen. Try something else." };
    }
  }

  return { run, actions, shown, placed, cartView, state };
}

async function findOrder(db, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return null;
  const orders = await db.listOrders();
  return orders.find((o) => Number(o.order_number) === n) || null;
}

// Fake but consistent: the stage only depends on how long ago the order was placed
const STAGES = [
  [2, "📝 Order received. The chef read it twice and sighed."],
  [6, "🔪 Being prepared. Two people are arguing about the salt."],
  [12, "🔥 On the grill. Honestly, it smells fine."],
  [20, "🛵 Out for delivery. The driver stopped at the ahwa \"for one minute\"."],
  [35, "📍 Arriving. He's calling you to describe your own building to you."],
  [Infinity, "✅ Delivered (allegedly). If you didn't get it, that's between you and the doorman."],
];
function trackStatus(order) {
  const mins = Math.max(0, (Date.now() - new Date(order.created_at).getTime()) / 60000);
  const idx = STAGES.findIndex(([limit]) => mins < limit);
  return { minutes_ago: Math.round(mins), stage: idx + 1, of: STAGES.length, status: STAGES[idx][1] };
}

function normalizeCart(db, rawCart) {
  return Promise.all(
    rawCart.map(async (raw) => {
      try {
        const qty = clampInt(raw?.qty, 1, MAX_QTY, 1);
        const { dish, item } = await priceItem(db, { ...raw, qty });
        return { key: lineKey(item.dish_id, item.size, item.addons), ...item, photo_url: db.photoUrl(dish.photo_path) };
      } catch {
        return null; // stale/invalid lines (dish deleted, bad size) silently drop out
      }
    }),
  ).then((lines) => {
    const cart = [];
    for (const l of lines.filter(Boolean)) {
      const existing = cart.find((c) => c.key === l.key);
      if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + l.qty);
      else cart.push(l);
    }
    return cart;
  });
}

function cleanReply(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .trim()
    .slice(0, 1200);
}

// Canned replies for slash commands (no AI involved)
function commandReply(name, r) {
  if (r?.error) return `${r.error}`;
  switch (name) {
    case "recommend": return pick(["دول اللي يستاهلوا. الأول اللي الناس كلها بتطلبه، والأخير للي بيحب المخاطرة.", "Three picks. The first is what everyone orders, the last one is for the brave."]);
    case "surprise_me": return `${r.added.name_ar} (${r.added.size}) في السلة.\nYou asked for a surprise, so no complaints.`;
    case "view_cart": return r.items.length ? `${r.items.reduce((n, l) => n + l.qty, 0)} items, ${r.total} EGP with the joke fees.` : "السلة فاضية.\nBold strategy.";
    case "clear_cart": return "السلة اتفضت.\nFresh start, same person.";
    case "reorder_last": return r.added.length ? `Same as order #${r.order_number}. Some people find comfort in routine.${r.skipped.length ? ` Skipped: ${r.skipped.join(", ")}.` : ""}` : `Nothing from #${r.order_number} can be ordered anymore.`;
    case "my_orders": return r.orders.length ? `${r.orders.length} order${r.orders.length === 1 ? "" : "s"} on this device. The waiter remembers everything.` : "No orders from this device yet.";
    case "split_bill": return `${r.each} EGP each (${r.people} people, ${r.source}). Someone will still forget their wallet.`;
    case "open_checkout": return "Taking you to checkout.";
    case "open_tracker": return `Opening the tracker for #${r.order_number}.`;
    case "track_order": return `#${r.order_number}: ${r.status}`;
    case "get_leaderboard": return r.top.length ? `Most ordered: ${r.top.map((d) => `${d.name_en} (${d.orders})`).join(", ")}.` : "Nobody ordered anything yet. Be the first, it's a lot of pressure.";
    case "compare_dishes": return "Side by side. Choose wisely, or don't.";
    case "search_menu": return r.count ? `${r.count} match${r.count === 1 ? "" : "es"}.` : "Nothing matches that.";
    case "set_customer_name": return `تمام يا ${r.name}.\nI'll remember that.`;
    default: return "Done.";
  }
}

function agentRouter(db, ai) {
  const router = express.Router();

  router.post("/", makeLimiter(), async (req, res) => {
    const { messages, cart: rawCart, orders, name, command } = parseBody(req.body);
    const [dishes, cart] = await Promise.all([db.listDishes(), normalizeCart(db, rawCart)]);
    const session = createSession(db, { dishes, cart, orders: [...orders], name });

    const respond = (status, reply, extra = {}) =>
      res.status(status).json({
        reply,
        cart,
        actions: session.actions,
        dishes: [...session.shown.values()],
        ...extra,
      });

    // Slash command: run one whitelisted tool directly (works with the AI off)
    if (command) {
      const result = await session.run(command.name, command.args);
      if (command.name === "search_menu" && result.dishes?.length) {
        result.dishes.slice(0, 6).forEach((c) => session.shown.set(c.id, c));
        session.actions.push({ type: "show_dishes", ids: [...session.shown.keys()] });
      }
      return respond(200, commandReply(command.name, result), { command: command.name, ok: !result?.error });
    }

    if (!ai?.enabled) return respond(503, pick(FALLBACKS), { fallback: true });

    const lastUserText = messages[messages.length - 1].content;
    const prevBot = [...messages].reverse().find((m) => m.role === "assistant")?.content || "";
    const tools = toolsFor(`${lastUserText}\n${prevBot}`);
    const convo = [{ role: "system", content: systemPrompt({ cart, orders, name, lastUserText }) }, ...messages];

    let reply = null;
    let provider = null; // pinned after the first answer so the whole tool loop uses one model
    for (let round = 0; round < MAX_ROUNDS && reply === null; round++) {
      const msg = await ai.chat({ messages: convo, tools, maxTokens: 300, temperature: 0.8, provider }).catch(() => null);
      provider ||= msg?.provider || null;
      if (!msg) {
        if (round === 0) return respond(503, pick(FALLBACKS), { fallback: true });
        break;
      }
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c) => c?.function?.name) : [];
      if (!calls.length) {
        reply = cleanReply(msg.content);
        break;
      }
      // Keep the provider's tool_call objects as-is (Gemini attaches thought signatures it wants back)
      calls.forEach((c, i) => (c.id ||= `call_${round}_${i}`));
      convo.push({ role: "assistant", content: msg.content || null, tool_calls: calls });
      for (const call of calls) {
        const name = call.function.name;
        // A tool the model knows about but wasn't offered this turn: offer it next round
        if (!tools.some((t) => t.function.name === name) && TOOL_BY_NAME.has(name)) tools.push(TOOL_BY_NAME.get(name));
        const result = await session.run(name, parseArgs(call.function.arguments));
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
    }

    if (!reply) {
      // Ran out of rounds (or the model went quiet after tools): one last text-only turn
      const msg = await ai.chat({ messages: convo, tools: [], maxTokens: 200, temperature: 0.8, provider }).catch(() => null);
      reply = cleanReply(msg?.content);
    }
    if (!reply) {
      const p = session.placed[session.placed.length - 1];
      reply = p ? `Order #${p.order_number} placed. ${p.total} EGP. Track it if you dare.` : session.actions.length ? "Done. Don't make me do that again." : pick(FALLBACKS);
    }
    respond(200, reply);
  });

  return router;
}

module.exports = { agentRouter, TOOLS, toolsFor, COMMANDS };
