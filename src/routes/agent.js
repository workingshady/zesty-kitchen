// The chatbot waiter-agent "الجرسون الحقود": a server-orchestrated tool loop.
// The model calls tools; the server runs them (menu, orders, tracking) against a server-side copy of the
// client's cart and hands back the new cart + UI actions. The browser just applies them.
const express = require("express");
const rateLimit = require("express-rate-limit");
const menu = require("../menu");
const persona = require("../persona");
const { createOrder, priceItem } = require("../orders");
const { leaderboard, publicDish } = require("./public");

const MAX_HISTORY = 12;
const MAX_CHARS = 600;
const MAX_ROUNDS = 6;
const MAX_LINES = 10;
const SIZE_KEYS = Object.keys(menu.SIZES);
const ADDON_KEYS = Object.keys(menu.ADDONS).filter((k) => menu.ADDONS[k].available);

const makeLimiter = () => rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "اهدى habibi 😤 the waiter needs a minute. Too many messages.", fallback: true, reply: "اهدى شوية يا باشا 😤 I'm one waiter, not a call center. Try again in a minute." },
});

const FALLBACKS = [
  "الجرسون في بريك شاي ☕ The waiter is on a tea break (AI is off). Use the menu like it's 2010 🫠",
  "The waiter is on a tea break and pretending not to see you ☕ back soon. Meanwhile, the buttons still work.",
  "الجرسون نزل يجيب عيش ومرجعش 🥖💀 AI is napping, order manually habibi.",
];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const lineKey = (dishId, size, addons) => `${dishId}|${size}|${[...addons].sort().join(",")}`;
const isOrderable = (d) => d.is_visible && d.category !== "expired" && !(d.badges || []).includes("sold_out");

// ---------- tool schemas (OpenAI format) ----------
const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const sizeProp = { type: "string", enum: SIZE_KEYS, description: "quarter=0.6x, half=1x (default), whole=1.8x, family=3x" };
const addonsProp = { type: "array", items: { type: "string", enum: ADDON_KEYS }, description: `Add-ons: ${ADDON_KEYS.map((k) => `${k} (+${menu.ADDONS[k].price} EGP)`).join(", ")}` };

const TOOLS = [
  fn("search_menu", "Search the menu (the dishes are coworkers). Leave query empty to list everything. Prices are for the half size.", {
    query: { type: "string", description: "Words to match in names, job titles, descriptions" },
    category: { type: "string", enum: menu.CATEGORIES.map((c) => c.slug) },
    sort: { type: "string", enum: ["price_asc", "price_desc", "spicy"] },
  }),
  fn("get_dish", "Full details of one dish incl. description, warnings and reviews summary.", { id: { type: "string" } }, ["id"]),
  fn("view_cart", "Show the user's current cart with prices and totals."),
  fn("add_to_cart", "Add a dish to the cart.", {
    dish_id: { type: "string" },
    size: sizeProp,
    qty: { type: "integer", minimum: 1, maximum: 9 },
    addons: addonsProp,
  }, ["dish_id"]),
  fn("remove_from_cart", "Remove a dish from the cart (all sizes unless size is given).", { dish_id: { type: "string" }, size: sizeProp }, ["dish_id"]),
  fn("update_cart_item", "Change size, quantity or add-ons of a cart line. current_size picks which line if the dish is in the cart more than once.", {
    dish_id: { type: "string" },
    current_size: sizeProp,
    size: sizeProp,
    qty: { type: "integer", minimum: 1, maximum: 9 },
    addons: addonsProp,
  }, ["dish_id"]),
  fn("clear_cart", "Empty the whole cart."),
  fn("show_dish_photos", "Show dish cards with photos in the chat UI.", { dish_ids: { type: "array", items: { type: "string" }, maxItems: 6 } }, ["dish_ids"]),
  fn("place_order", "Place a REAL order with the current cart. Needs the customer's name. Only after the user confirmed (or clearly asked to place it).", {
    customer_name: { type: "string", maxLength: 40 },
    payment_method: { type: "string", enum: menu.PAYMENT_METHODS, description: "vibes | insults | owe_lunch (owe the chef lunch)" },
    note: { type: "string", maxLength: 200 },
  }, ["customer_name", "payment_method"]),
  fn("track_order", "Track an order by its number.", { order_number: { type: "integer" } }, ["order_number"]),
  fn("return_order", "The user wants to return / refund / cancel an order.", { order_number: { type: "integer" } }),
  fn("get_leaderboard", "Most ordered coworkers and the least wanted one."),
];

// ---------- prompt ----------
// Match the user when they clearly write in one language; otherwise vary it per reply
function languageInstruction(lastUserText) {
  const arabic = /[؀-ۿ]/.test(lastUserText);
  const latin = /[a-z]{2,}/i.test(lastUserText);
  if (arabic && !latin) return "LANGUAGE: the user wrote in Arabic, so reply in Egyptian colloquial Arabic (Cairo texting style); a stray English slang word is fine.";
  if (latin && !arabic && lastUserText.trim().split(/\s+/).length >= 3) return "LANGUAGE: the user wrote in English, so reply in English (Gen-Z slang); you may drop one Egyptian word like يا باشا.";
  if (typeof persona.languageMode === "function") {
    try {
      const s = persona.languageMode();
      if (typeof s === "string" && s.trim()) return s;
    } catch {
      /* fall through to the inline rule */
    }
  }
  const modes = ["Egyptian Arabic (عامية مصرية) only", "English only, Gen-Z slang", "a mixed Egyptian Arabic + English code-switch like Gen-Z texting", "a mixed Egyptian Arabic + English code-switch like Gen-Z texting"];
  return `LANGUAGE: reply in ${pick(modes)}.`;
}

function systemPrompt({ cart, orders, lastUserText }) {
  const cartLine = cart.length ? cart.map((l) => `${l.qty}x ${l.name_en} (${l.size}${l.addons.length ? ` + ${l.addons.join(",")}` : ""})`).join("; ") : "empty";
  const orderLine = orders.length ? orders.join(", ") + ` (most recent: ${orders[orders.length - 1]})` : "none";
  return `${persona.PERSONA}

ROLE NOW: You are "الجرسون الحقود" (The Petty Waiter), the chat waiter-agent of Zesty Kitchen. You help the user browse the menu, recommend dishes, add/remove cart items, change sizes and add-ons, show photos, place orders, track orders and handle "returns", and you roast them the whole time.
RULES:
- ALWAYS call tools to actually do things. Never pretend you added, removed, ordered or tracked something without the tool call. If a tool returns an error, say so (with a roast).
- Never invent dishes, prices, ids or order numbers: only use what tools return. Call search_menu first if you need dish ids.
- When the user wants to see a dish or asks for photos, call show_dish_photos.
- Before place_order, confirm the cart and get the customer's name and payment method (vibes, insults or owe_lunch), unless the user clearly asked to place it and gave what you need. Default payment: vibes.
- Refunds/returns/cancellations always go through return_order (it always refuses).
- Keep replies SHORT: at most 3 sentences. No markdown tables, no lists of ids. Prices are in EGP.
- ${languageInstruction(lastUserText)}
CONTEXT: current cart: ${cartLine}. The user's recent order numbers: ${orderLine}.`;
}

// ---------- request validation ----------
function bad(message) {
  return Object.assign(new Error(message), { status: 400, expose: true });
}

function parseBody(body) {
  const b = body || {};
  if (!Array.isArray(b.messages) || !b.messages.length) throw bad("skill issue: say something first 💀");
  if (b.messages.length > 60) throw bad("skill issue: conversation is too long");
  const messages = b.messages
    .slice(-MAX_HISTORY)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
  while (messages.length && messages[0].role !== "user") messages.shift(); // some providers want user first
  if (!messages.length || messages[messages.length - 1].role !== "user") throw bad("skill issue: the last message must be yours");
  if (b.cart != null && !Array.isArray(b.cart)) throw bad("skill issue: cart must be a list");
  const cart = (b.cart || []).slice(0, MAX_LINES);
  const orders = (Array.isArray(b.orders) ? b.orders : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(-10);
  return { messages, cart, orders };
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

// ---------- tool runtime ----------
function createSession(db, { dishes, cart }) {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const actions = [];
  const shown = new Map();
  const placed = [];

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
    if (badAddon) return badAddon === "no_drama" ? "no_drama is not available. It never was 💀" : `Invalid add-on "${badAddon}". Options: ${ADDON_KEYS.join(", ")}.`;
    return null;
  };
  const clampQty = (q, fallback = 1) => {
    const n = Number(q ?? fallback);
    return Number.isInteger(n) ? Math.min(9, Math.max(1, n)) : fallback;
  };
  const merge = (line) => {
    const existing = cart.find((l) => l.key === line.key);
    if (existing) existing.qty = Math.min(9, existing.qty + line.qty);
    else {
      if (cart.length >= MAX_LINES) return false;
      cart.push(line);
    }
    return true;
  };

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
    update_cart_item({ dish_id, current_size, size, qty, addons }) {
      const idx = cart.findIndex((l) => l.dish_id === String(dish_id) && (!current_size || l.size === current_size));
      if (idx < 0) return { error: "That dish is not in the cart. Use add_to_cart." };
      const old = cart[idx];
      const dish = byId.get(old.dish_id);
      if (!dish) return { error: "That dish doesn't exist anymore." };
      const nextSize = size || old.size;
      const nextAddons = Array.isArray(addons) ? [...new Set(addons)] : old.addons;
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
      const ids = Array.isArray(dish_ids) ? dish_ids.slice(0, 6) : [];
      const found = ids.map((id) => byId.get(String(id))).filter((d) => d && d.is_visible);
      if (!found.length) return { error: "None of those ids exist. Call search_menu first." };
      const cards = found.map(card);
      cards.forEach((c) => shown.set(c.id, c));
      actions.push({ type: "show_dishes", ids: cards.map((c) => c.id) });
      return { ok: true, shown: cards.map((c) => c.name_en) };
    },
    async place_order({ customer_name, payment_method = "vibes", note }) {
      if (!cart.length) return { error: "The cart is empty. Add something first." };
      if (!menu.PAYMENT_METHODS.includes(payment_method)) payment_method = "vibes";
      try {
        const result = await createOrder(db, {
          customer_name: String(customer_name || "").slice(0, 40),
          payment_method,
          note: note ? String(note).slice(0, 200) : undefined,
          items: cart.map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
        });
        const url = `/order?n=${encodeURIComponent(result.order_number)}&dish=${encodeURIComponent(result.items[0].dish_id)}`;
        cart.length = 0;
        changed("order");
        const info = { order_number: result.order_number, total: result.total, url, items: result.items.map((i) => `${i.qty}x ${i.name_en}`) };
        placed.push(info);
        actions.push({ type: "order_placed", ...info });
        return { ok: true, ...info, tracker_url: url };
      } catch (err) {
        if (err.status === 400) return { error: err.message };
        throw err;
      }
    },
    async track_order({ order_number }) {
      const order = await findOrder(db, order_number);
      if (!order) return { error: `No order #${order_number}. Maybe it was a dream.` };
      const url = `/order?n=${order.order_number}&dish=${encodeURIComponent(order.items[0]?.dish_id || "")}`;
      actions.push({ type: "navigate", url, label: `Track #${order.order_number}` });
      return { order_number: order.order_number, ...trackStatus(order), items: order.items.map((i) => `${i.qty}x ${i.name_en}`), total: order.total, tracker_url: url };
    },
    async return_order({ order_number }) {
      const order = order_number ? await findOrder(db, order_number) : null;
      return {
        refused: true,
        order_number: order?.order_number ?? order_number ?? null,
        reason: pick([
          "No refunds: the kitchen already ate the order. Returning it now would be… a medical procedure.",
          "Returns policy: the coworker refuses to come back. They said the vibes at your place were mid.",
          "Refund request forwarded to HR. HR forwarded it to the trash. Ticket closed.",
          "We can't return it, it's already been digested by the delivery guy. Emotionally and literally.",
        ]),
      };
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
      return await tool(args);
    } catch (err) {
      console.warn(`agent tool ${name} failed: ${err.message}`);
      return { error: "That broke in the kitchen. Try something else." };
    }
  }

  return { run, actions, shown, placed, cartView };
}

async function findOrder(db, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) return null;
  const orders = await db.listOrders();
  return orders.find((o) => Number(o.order_number) === n) || null;
}

// Fake but consistent: the stage only depends on how long ago the order was placed
const STAGES = [
  [2, "📝 Order received. The chef read it and sighed loudly."],
  [6, "🔪 Being prepared. The coworker is being marinated in their own deadlines."],
  [12, "🔥 On the grill. Smells like burnout."],
  [20, "🛵 Out for delivery by HR. They stopped to schedule a 1:1 with your neighbor."],
  [35, "📍 Arriving. HR is lost in your building's stairwell, crying."],
  [Infinity, "✅ Delivered (allegedly). If you didn't get it, it was a mindset issue."],
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
        const { dish, item } = await priceItem(db, raw);
        return { key: lineKey(item.dish_id, item.size, item.addons), ...item, photo_url: db.photoUrl(dish.photo_path) };
      } catch {
        return null; // stale/invalid lines (dish deleted, bad size) silently drop out
      }
    }),
  ).then((lines) => {
    const cart = [];
    for (const l of lines.filter(Boolean)) {
      const existing = cart.find((c) => c.key === l.key);
      if (existing) existing.qty = Math.min(9, existing.qty + l.qty);
      else cart.push(l);
    }
    return cart;
  });
}

function cleanReply(text) {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .slice(0, 1200);
}

function agentRouter(db, ai) {
  const router = express.Router();

  router.post("/", makeLimiter(), async (req, res) => {
    const { messages, cart: rawCart, orders } = parseBody(req.body);
    const [dishes, cart] = await Promise.all([db.listDishes(), normalizeCart(db, rawCart)]);
    const session = createSession(db, { dishes, cart });
    const lastUserText = messages[messages.length - 1].content;
    const convo = [{ role: "system", content: systemPrompt({ cart, orders, lastUserText }) }, ...messages];

    const respond = (status, reply, extra = {}) =>
      res.status(status).json({
        reply,
        cart,
        actions: session.actions,
        dishes: [...session.shown.values()],
        ...extra,
      });

    if (!ai?.enabled) return respond(503, pick(FALLBACKS), { fallback: true });

    let reply = null;
    for (let round = 0; round < MAX_ROUNDS && reply === null; round++) {
      const msg = await ai.chat({ messages: convo, tools: TOOLS, maxTokens: 300, temperature: 0.8 }).catch(() => null);
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
        const result = await session.run(call.function.name, parseArgs(call.function.arguments));
        convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
      }
    }

    if (!reply) {
      // Ran out of rounds (or the model went quiet after tools): one last text-only turn
      const msg = await ai.chat({ messages: convo, tools: [], maxTokens: 200, temperature: 0.8 }).catch(() => null);
      reply = cleanReply(msg?.content);
    }
    if (!reply) {
      const p = session.placed[session.placed.length - 1];
      reply = p ? `Order #${p.order_number} placed 🫡 ${p.total} EGP. Track it if you dare.` : session.actions.length ? "Done. Don't make me do that again 😮‍💨" : pick(FALLBACKS);
    }
    respond(200, reply);
  });

  return router;
}

module.exports = { agentRouter, TOOLS };
