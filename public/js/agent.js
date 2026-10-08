// "الجرسون الحقود" chat widget: a floating waiter that talks to POST /api/agent.
// The server runs the tools; this file renders replies, dish carousels, recommendation/compare/
// split/review/order cards, a live side cart on wide screens, "/" commands, and applies the cart.
import { $, $$, esc, egp, store, toast, play, getCart, saveCart, addToCart, lineKey, linePrice, feesFor, getConfig, fitImg, pick, calm } from "./common.js";

const CHAT_KEY = "zk_agent_chat";
const ORDERS_KEY = "zk_orders";
const NAME_KEY = "zk_agent_name";
const SIZE_KEY = "zk_agent_size";
const MAX_KEY = "zk_agent_max";
const SIDE_KEY = "zk_agent_side";
const PENDING_DISH_KEY = "zk_agent_open_dish";
const PEEK_KEY = "zk_agent_peeked";
const MAX_SAVED = 30;
const MAX_LEN = 600;
const MAX_QTY = 99;
const GO_DELAY = 2600; // ms before a navigate action opens the page
const GROUP_GAP = 5 * 60 * 1000; // same sender within 5 min = one group

const GREETINGS = [
  "أهلاً، أنا الجرسون.\nI recommend, fill the cart, place orders, and keep my opinions to myself. Mostly.",
  "Welcome. Tell me a budget, a mood, or how many people, and I'll handle it. Judging is included.",
  "يا أهلاً. قولي جعان قد إيه ومعاك كام، والباقي عليا.",
];
// Fallback size table (the real one comes from /api/config)
const SIZES = {
  quarter: { ar: "ربع", en: "Quarter", mult: 0.6 },
  half: { ar: "نص", en: "Half", mult: 1 },
  whole: { ar: "كامل", en: "Whole", mult: 1.8 },
  family: { ar: "عيلة", en: "Family", mult: 3 },
};
// What the waiter can do: onboarding grid + /help card
const SKILLS = [
  { icon: "🔥", en: "Recommend", ar: "رشحلي", sub: "budget, mood, people", say: "رشحلي حاجة بـ 300 جنيه" },
  { icon: "🛒", en: "Edit the cart", ar: "عدّل السلة", sub: "sizes, add-ons, qty", say: "what's in my cart?" },
  { icon: "⚖️", en: "Compare", ar: "قارن", sub: "side by side", say: "compare the two most ordered dishes" },
  { icon: "🔁", en: "Reorder", ar: "زي المرة اللي فاتت", sub: "your last order", cmd: "/reorder" },
  { icon: "🧮", en: "Split the bill", ar: "قسّم الحساب", sub: "cart or order", cmd: "/split 3" },
  { icon: "⭐", en: "Post a review", ar: "اكتب ريفيو", sub: "your words, real review", say: "I want to review a dish" },
  { icon: "🛵", en: "Order & track", ar: "اطلب وتابع", sub: "checkout, tracker", say: "track my last order" },
  { icon: "🎲", en: "Surprise me", ar: "فاجئني", sub: "random dish", cmd: "/surprise" },
];
const CHIPS = {
  base: ["رشحلي حاجة 🔥", "surprise me 🎲", "same as last time 🔁", "what's in my cart?", "split it between 3 🧮", "track my last order 🛵"],
  dishes: ["add the first one ➕", "compare them ⚖️", "cheaper?", "show reviews ⭐", "something else 🔄"],
  recs: ["add the top pick ➕", "compare them ⚖️", "cheaper?", "for 4 people", "something spicy 🌶️"],
  cart: [{ label: "checkout 💳", cmd: "/checkout" }, "split it between 3 🧮", "make it family size", "place my order / اطلب 🧾", "remove the last one ❌"],
  order: ["track my order 🛵", { label: "split the bill 🧮", cmd: "/split 2" }, "rate it ⭐", "رشحلي حلو 🍰"],
};
const TAGS = {
  top: ["🔥", "Crowd favorite", "الأكتر طلبًا"],
  value: ["💸", "Best value", "الأوفر"],
  wildcard: ["🎲", "Wildcard", "مغامرة"],
};

// "/" commands: run one server tool directly (works even when the AI is off)
const num = (s) => {
  const m = String(s || "").match(/\d+/);
  return m ? Number(m[0]) : undefined;
};
const COMMANDS = [
  { cmd: "/recommend", args: "[budget] [people] [mood]", en: "picks by budget, mood, people", ar: "رشحلي", run: (r) => {
    const nums = (r.match(/\d+/g) || []).map(Number);
    const mood = r.replace(/\d+/g, "").trim();
    return ["recommend", { budget: nums[0], people: nums[1], mood: mood || undefined }];
  } },
  { cmd: "/surprise", en: "random dish into the cart", ar: "فاجئني", run: () => ["surprise_me", {}] },
  { cmd: "/menu", args: "[search]", en: "search the menu", ar: "المنيو", run: (r) => ["search_menu", { query: r }] },
  { cmd: "/cart", en: "show the cart", ar: "السلة", run: () => ["view_cart", {}] },
  { cmd: "/reorder", args: "[#]", en: "repeat your last order", ar: "زي المرة اللي فاتت", run: (r) => ["reorder_last", num(r) ? { order_number: num(r) } : {}] },
  { cmd: "/orders", en: "your past orders", ar: "طلباتي", run: () => ["my_orders", {}] },
  { cmd: "/split", args: "<people>", en: "split the cart or last order", ar: "قسّم الحساب", run: (r) => ["split_bill", { people: num(r) || 2 }] },
  { cmd: "/track", args: "[#]", en: "open the order tracker", ar: "تابع الأوردر", run: (r) => ["open_tracker", num(r) ? { order_number: num(r) } : {}] },
  { cmd: "/checkout", en: "go to checkout", ar: "الدفع", run: () => ["open_checkout", {}] },
  { cmd: "/top", en: "most ordered coworkers", ar: "الأكثر طلبًا", run: () => ["get_leaderboard", {}] },
  { cmd: "/name", args: "<your name>", en: "remember your name", ar: "اسمي", run: (r) => (r ? ["set_customer_name", { name: r }] : null) },
  { cmd: "/empty", en: "empty the cart", ar: "فضّي السلة", run: () => ["clear_cart", {}] },
  { cmd: "/help", en: "what the waiter can do", ar: "بيعمل إيه", run: () => "help" },
];

let chat = store.get(CHAT_KEY, []);
if (!Array.isArray(chat)) chat = [];
chat = chat.filter((m) => m && typeof m.content === "string" && !m.error);
let busy = false;
let cfg = null;
let unreadClosed = 0; // replies that arrived while the panel was closed
let unreadBelow = 0; // replies that arrived while scrolled up
let lastFocus = null;
let goTimer = null;
let slashIdx = 0;
const greeting = pick(GREETINGS);
let el = {};

const save = () => store.set(CHAT_KEY, chat.filter((m) => !m.error).slice(-MAX_SAVED));
const recentOrders = () => {
  const list = store.get(ORDERS_KEY, []);
  return Array.isArray(list) ? list.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(-10) : [];
};
function rememberOrder(n) {
  n = Number(n);
  if (!Number.isInteger(n) || n < 1) return;
  const list = recentOrders().filter((x) => x !== n);
  list.push(n);
  store.set(ORDERS_KEY, list.slice(-10));
}
const session = {
  get(k) {
    try { return sessionStorage.getItem(k); } catch { return "1"; }
  },
  set(k) {
    try { sessionStorage.setItem(k, "1"); } catch { /* ignore */ }
  },
};
const isMobile = () => window.matchMedia("(max-width: 520px)").matches;
const sizeInfo = (key) => cfg?.sizes?.[key] || SIZES[key] || { ar: key, en: key };
const priceFor = (d, size) => (cfg ? linePrice(cfg, d.price, size, []) : Math.round(d.price * (SIZES[size]?.mult || 1) * 100) / 100);
const catEmoji = (slug) => cfg?.categories?.find((c) => c.slug === slug)?.emoji || "🍽️";
const chilis = (n, icon = "🌶️") => (n ? icon.repeat(Math.max(0, Math.min(5, Math.round(n)))) : "–");

// ---------- time helpers ----------
const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today · النهارده";
  if (d.toDateString() === yest.toDateString()) return "Yesterday · امبارح";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
const who = (m) => (m.role === "user" ? "user" : "bot");
const sameGroup = (a, b) => a && b && who(a) === who(b) && (!a.ts || !b.ts || b.ts - a.ts < GROUP_GAP) && !a.error && !b.error;

// ---------- cart snapshot ----------
function cartSnapshot(lines) {
  const items = (lines || []).map((l) => ({ name_ar: l.name_ar, name_en: l.name_en, photo_url: l.photo_url || null, size: l.size, qty: l.qty, unit_price: l.unit_price }));
  const subtotal = Math.round(items.reduce((s, l) => s + (Number(l.unit_price) || 0) * l.qty, 0) * 100) / 100;
  return { items, total: items.length ? feesFor(subtotal).total : 0 };
}

// ---------- rich content ----------
const ICON_SEND = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill="currentColor"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const ICON_SHRINK = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

const thumb = (d, cls = "zka-thumb") => (d?.photo_url ? `<img class="${cls}" src="${esc(d.photo_url)}" alt="" loading="lazy">` : `<span class="${cls}" aria-hidden="true">${catEmoji(d?.category)}</span>`);

function photoHtml(d) {
  return d.photo_url
    ? `<button type="button" class="zka-card__img" data-photo="${esc(d.photo_url)}" data-cap="${esc(`${d.name_ar} · ${d.name_en}`)}" aria-label="View photo of ${esc(d.name_en)}">${fitImg(d.photo_url, d.name_en)}</button>`
    : `<div class="zka-card__img zka-card__img--empty" aria-hidden="true">${catEmoji(d.category)}</div>`;
}

function dishCardHtml(d, single) {
  const sizes = Object.keys(SIZES)
    .map((k) => `<button type="button" class="zka-size" data-add="${esc(d.id)}" data-size="${k}"><b>${esc(sizeInfo(k).ar)}</b><span>${esc(sizeInfo(k).en)}</span><em>${egp(priceFor(d, k))}</em></button>`)
    .join("");
  return `<article class="zka-card${single ? " zka-card--big" : ""}${d.sold_out ? " is-sold" : ""}" data-id="${esc(d.id)}">
    <div class="zka-card__media">${photoHtml(d)}<span class="zka-card__cat" aria-hidden="true">${catEmoji(d.category)}</span>${d.sold_out ? `<span class="zka-card__sold">💀 Sold out</span>` : ""}</div>
    <div class="zka-card__body">
      <strong class="zka-card__ar" dir="auto">${esc(d.name_ar)}</strong>
      <span class="zka-card__en" dir="auto">${esc(d.name_en)}</span>
      ${d.job_title ? `<span class="zka-card__job" dir="auto">${esc(d.job_title)}</span>` : ""}
      <span class="zka-card__price"><small>من / from</small> ${egp(priceFor(d, "quarter"))}</span>
      <span class="zka-card__btns">
        ${d.sold_out ? "" : `<button type="button" class="zka-mini" data-pick="${esc(d.id)}" aria-haspopup="true" aria-expanded="false">➕ Add</button>`}
        <a class="zka-mini zka-mini--ghost" href="/" data-open="${esc(d.id)}" aria-label="Open ${esc(d.name_en)}">👀 Open</a>
      </span>
    </div>
    ${d.sold_out ? "" : `<div class="zka-sizes" role="group" aria-label="Pick a size for ${esc(d.name_en)} / اختار الحجم" hidden>
      <span class="zka-sizes__t">الحجم؟ / size?</span>${sizes}
      <button type="button" class="zka-sizes__x" data-unpick aria-label="Cancel">✕</button>
    </div>`}
  </article>`;
}

function recCardHtml(p) {
  const [icon, en, ar] = TAGS[p.tag] || TAGS.top;
  const s = sizeInfo(p.size);
  return `<article class="zka-card zka-rec zka-rec--${esc(p.tag)}" data-id="${esc(p.id)}">
    <div class="zka-card__media">${photoHtml(p)}<span class="zka-rec__tag"><span aria-hidden="true">${icon}</span> ${esc(en)} · <bdi>${esc(ar)}</bdi></span></div>
    <div class="zka-card__body">
      <strong class="zka-card__ar" dir="auto">${esc(p.name_ar)}</strong>
      <span class="zka-card__en" dir="auto">${esc(p.name_en)}</span>
      <span class="zka-rec__why" dir="auto">${esc(p.reason || "")}</span>
      <span class="zka-card__price">${p.qty > 1 ? `${p.qty}× ` : ""}${esc(s.ar)} <small>${esc(s.en)}</small> · ${egp(p.line_total)}</span>
      <span class="zka-card__btns">
        <button type="button" class="zka-mini" data-add="${esc(p.id)}" data-size="${esc(p.size)}" data-qty="${Number(p.qty) || 1}">➕ Add</button>
        <a class="zka-mini zka-mini--ghost" href="/" data-open="${esc(p.id)}" aria-label="Open ${esc(p.name_en)}">👀</a>
      </span>
    </div>
  </article>`;
}

function recsHtml(r) {
  const meta = [r.budget ? `≤ ${egp(r.budget)}` : null, r.people > 1 ? `${r.people} people · ${r.people} أشخاص` : null, r.mood ? r.mood : null].filter(Boolean).join(" · ");
  return `<div class="zka-recs">
    <div class="zka-recs__head"><strong>Picks for you · ترشيحات</strong>${meta ? `<span dir="auto">${esc(meta)}</span>` : ""}</div>
    <div class="zka-rail" role="list" aria-label="${r.picks.length} recommendations">${r.picks.map((p) => `<div role="listitem">${recCardHtml(p)}</div>`).join("")}</div>
    <small class="zka-recs__note">Real order counts and ratings. Joke fees not included · الرسوم مش محسوبة</small>
  </div>`;
}

function compareHtml(c) {
  const ds = c.dishes || [];
  const w = c.winners || {};
  const win = (key, id) => (w[key] === id ? ` class="is-win"` : "");
  const row = (label, key, val) => `<tr><th scope="row">${label}</th>${ds.map((d) => `<td${key ? win(key, d.id) : ""}>${val(d)}</td>`).join("")}</tr>`;
  return `<div class="zka-compare">
    <strong class="zka-compare__t">⚖️ Side by side · مقارنة</strong>
    <div class="zka-compare__wrap"><table>
      <thead><tr><td></td>${ds.map((d) => `<th scope="col"><button type="button" class="zka-compare__dish" data-photo="${esc(d.photo_url || "")}" data-cap="${esc(`${d.name_ar} · ${d.name_en}`)}" ${d.photo_url ? "" : "disabled"}>${thumb(d)}</button><span dir="auto">${esc(d.name_ar)}</span><small dir="auto">${esc(d.name_en)}</small></th>`).join("")}</tr></thead>
      <tbody>
        ${row("Half · نص", "cheapest", (d) => egp(d.price))}
        ${row("From · من", null, (d) => egp(d.from))}
        ${row("Spice · شطة", "spiciest", (d) => `<span aria-label="${d.spice} of 5">${chilis(d.spice)}</span>`)}
        ${row("Rating · تقييم", "best_rated", (d) => (d.rating != null ? `${d.rating}/5 <small>(${d.reviews})</small>` : "–"))}
        ${row("Ordered · اتطلب", "most_ordered", (d) => `${d.orders}×`)}
        ${row("", null, (d) => (d.sold_out ? `<small>💀 Sold out</small>` : `<button type="button" class="zka-mini" data-add="${esc(d.id)}" data-size="half">➕ Add</button>`))}
      </tbody>
    </table></div>
    <small class="zka-compare__key"><span class="zka-compare__swatch" aria-hidden="true"></span> = winner in that row · الأحسن</small>
  </div>`;
}

function splitHtml(s) {
  return `<div class="zka-split">
    <span class="zka-split__k">🧮 Split · كل واحد عليه</span>
    <strong class="zka-split__each">${egp(s.each)}</strong>
    <span class="zka-split__meta">${s.people} people · ${esc(s.source)} · total ${egp(s.total)}${s.tip_percent ? ` (incl. ${s.tip_percent}% tip)` : ""}</span>
    ${s.rounding_extra > 0 ? `<small>+${egp(s.rounding_extra)} from rounding goes to the waiter. Obviously.</small>` : ""}
  </div>`;
}

function reviewHtml(r) {
  const d = r.dish || {};
  const rv = r.review || {};
  return `<div class="zka-review">
    <div class="zka-review__top">${thumb(d)}<span><strong dir="auto">${esc(d.name_ar || "")}</strong><small dir="auto">${esc(d.name_en || "")}</small></span><span class="zka-review__ok">⭐ Posted · اتنشر</span></div>
    <span class="zka-review__rates"><span aria-label="${rv.chili} of 5 chilis">${chilis(rv.chili)}</span> <span aria-label="awkward ${rv.awkward} of 5">${chilis(rv.awkward, "😬")}</span></span>
    <p dir="auto">“${esc(rv.body || "")}”</p>
    <small dir="auto">— ${esc(rv.author_name || "")}</small>
  </div>`;
}

function ordersHtml(list) {
  if (!list.length) return `<div class="zka-cart zka-cart--empty"><strong>🧾 No orders yet · مفيش طلبات</strong><span>From this device, anyway.</span></div>`;
  return `<div class="zka-orders"><strong>🧾 Your orders · طلباتك</strong><ul>${list
    .map((o) => `<li>
      <span class="zka-orders__n">#${esc(o.order_number)}</span>
      <span class="zka-orders__body"><span dir="auto">${esc((o.items || []).join(" · "))}</span><small>${esc(o.status || "")}</small></span>
      <b>${egp(o.total)}</b>
      <span class="zka-orders__btns"><button type="button" class="zka-mini" data-cmd="/reorder ${esc(o.order_number)}">🔁 Again</button><a class="zka-mini zka-mini--ghost" href="${esc(o.url || "/order")}">📍</a></span>
    </li>`)
    .join("")}</ul></div>`;
}

function goHtml(g, live) {
  return `<div class="zka-go${live ? " is-live" : ""}" data-go-card>
    <strong>➡️ ${esc(g.label || "Opening")}</strong>
    ${live ? `<span class="zka-go__bar" aria-hidden="true"><i style="animation-duration:${GO_DELAY}ms"></i></span><span class="zka-go__t">Opening in a sec · هنفتحها حالًا</span>` : ""}
    <span class="zka-go__btns"><a class="zka-mini zka-mini--hot" href="${esc(g.url)}" data-go-now>${live ? "Go now · يلا" : "Open · افتح"}</a>${live ? `<button type="button" class="zka-mini zka-mini--ghost" data-go-cancel>Stay · خليني هنا</button>` : ""}</span>
  </div>`;
}

function cartCardHtml(c) {
  if (!c.items.length) return `<div class="zka-cart zka-cart--empty"><strong>🛒 Cart: empty / فاضية</strong><span>Like your weekend plans.</span></div>`;
  const qty = c.items.reduce((n, l) => n + l.qty, 0);
  const thumbs = c.items.slice(0, 4).map((l) => (l.photo_url ? `<img src="${esc(l.photo_url)}" alt="">` : `<span>🍽️</span>`)).join("") + (c.items.length > 4 ? `<span>+${c.items.length - 4}</span>` : "");
  return `<div class="zka-cart">
    <div class="zka-cart__top"><span class="zka-cart__thumbs" aria-hidden="true">${thumbs}</span><strong>🛒 ${qty} in cart / في السلة</strong></div>
    <ul class="zka-cart__list">${c.items
      .slice(0, 6)
      .map((l) => `<li><span dir="auto">${l.qty}× ${esc(l.name_ar || l.name_en)} <small>${esc(sizeInfo(l.size)?.ar || l.size || "")}</small></span><b>${egp(l.unit_price * l.qty)}</b></li>`)
      .join("")}${c.items.length > 6 ? `<li><span>+${c.items.length - 6} more…</span></li>` : ""}</ul>
    <div class="zka-cart__foot"><span>Total w/ joke fees <b>${egp(c.total)}</b></span><a class="zka-mini zka-mini--hot" href="/checkout">Checkout 💳</a></div>
  </div>`;
}

function orderCardHtml(o) {
  return `<div class="zka-order">
    <span class="zka-order__stamp" aria-hidden="true">PAID*</span>
    <strong>🧾 Order #${esc(o.order_number)} <bdi>اتبعت</bdi>!</strong>
    ${o.items?.length ? `<span class="zka-order__items" dir="auto">${esc(o.items.join(" · "))}</span>` : ""}
    <span class="zka-order__total">${egp(o.total)}</span>
    <a class="zka-mini" href="${esc(o.url || "/order")}">📍 Track / تابع</a>
    <small>*with vibes, legally</small>
  </div>`;
}

function skillsHtml() {
  return `<div class="zka-skills">${SKILLS.map((s) => `<button type="button" class="zka-skill" ${s.cmd ? `data-cmd="${esc(s.cmd)}"` : `data-say="${esc(s.say)}"`}>
      <span class="zka-skill__i" aria-hidden="true">${s.icon}</span><b>${esc(s.en)}</b><bdi dir="rtl">${esc(s.ar)}</bdi><small>${esc(s.sub)}</small>
    </button>`).join("")}</div>
    <p class="zka-skills__hint">Type <kbd>/</kbd> for shortcuts · اكتب <kbd>/</kbd> للأوامر السريعة</p>`;
}

function rowHtml(m, i, prev, next) {
  const w = who(m);
  const first = !sameGroup(prev, m);
  const last = !sameGroup(m, next);
  let rich = "";
  if (m.help) rich += skillsHtml();
  if (m.recs?.picks?.length) rich += recsHtml(m.recs);
  if (m.dishes?.length) {
    const single = m.dishes.length === 1;
    rich += `<div class="zka-rail${single ? " zka-rail--single" : ""}" role="list" aria-label="${m.dishes.length} dishes">${m.dishes.map((d) => `<div role="listitem">${dishCardHtml(d, single)}</div>`).join("")}</div>`;
  }
  if (m.compare?.dishes?.length) rich += compareHtml(m.compare);
  if (m.review) rich += reviewHtml(m.review);
  if (m.split) rich += splitHtml(m.split);
  if (m.orders) rich += ordersHtml(m.orders);
  if (m.cart) rich += cartCardHtml(m.cart);
  if (m.order) rich += orderCardHtml(m.order);
  if (m.go) rich += goHtml(m.go, false);
  if (m.links?.length) rich += `<div class="zka-links">${m.links.map((l) => `<a class="zka-mini zka-mini--ghost" href="${esc(l.url)}">➡️ ${esc(l.label)}</a>`).join("")}</div>`;
  const retry = m.retry && i === chat.length - 1 ? `<button type="button" class="zka-mini zka-retry" data-retry>🔁 Retry / تاني</button>` : "";
  const meta = m.ts ? `<span class="zka-meta">${timeLabel(m.ts)}${w === "user" ? ` <span aria-hidden="true">✓✓</span><span class="zka-meta__seen"> seen</span>` : ""}</span>` : "";
  const cls = ["zka-row", `zka-row--${w}`, first && "is-first", last && "is-last", rich && "zka-row--rich", m.fallback && "zka-row--fallback", m.error && "zka-row--error", m.cmd && w === "user" && "zka-row--cmd"].filter(Boolean).join(" ");
  return `<div class="${cls}" data-i="${i}">
    ${w === "bot" ? `<span class="zka-row__av" aria-hidden="true">🤵</span>` : ""}
    <div class="zka-row__col">
      <div class="zka-bubble" dir="auto"><span class="zka-sr">${w === "user" ? "You" : "Waiter"}: </span>${m.error ? "⚠️ " : ""}${esc(m.content)}</div>
      ${rich}${retry}${meta}
    </div>
  </div>`;
}

function dividerHtml(m, prev) {
  if (!m.ts || (prev?.ts && dayKey(prev.ts) === dayKey(m.ts))) return "";
  if (!prev?.ts && prev) return ""; // legacy messages without timestamps: no divider in the middle
  return `<div class="zka-day" role="separator"><span>${dayLabel(m.ts)}</span></div>`;
}

function emptyHtml() {
  return `<div class="zka-empty">
    <div class="zka-empty__av" aria-hidden="true">🤵</div>
    <p class="zka-empty__t">الجرسون الحقود</p>
    <p class="zka-empty__s">Your waiter for the whole order: picks, cart, bill, tracking.<br><bdi dir="rtl">بيرشح، بيملا السلة، بيقسم الحساب، وبيتابع الأوردر.</bdi></p>
  </div>
  ${rowHtml({ role: "assistant", content: greeting }, -1, null, null)}
  ${skillsHtml()}`;
}

// ---------- side cart (wide panels) ----------
const cartLines = () => getCart().map((l) => ({ ...l, key: l.key || lineKey(l.dish_id, l.size, l.addons || []) }));
function sideHtml() {
  const lines = cartLines();
  const qty = lines.reduce((n, l) => n + l.qty, 0);
  if (!lines.length) {
    return `<div class="zka-side__head"><h3>🛒 <span>Cart · السلة</span></h3></div>
      <div class="zka-side__empty"><span aria-hidden="true">🍽️</span><p>Empty. Ask for a pick, or say how hungry you are.<br><bdi dir="rtl">فاضية. قولي معاك كام.</bdi></p>
      <button type="button" class="zka-mini" data-cmd="/recommend">🔥 Recommend</button><button type="button" class="zka-mini zka-mini--ghost" data-cmd="/surprise">🎲 Surprise</button></div>`;
  }
  const subtotal = Math.round(lines.reduce((s, l) => s + l.unit_price * l.qty, 0) * 100) / 100;
  const { total } = feesFor(subtotal);
  return `<div class="zka-side__head"><h3>🛒 <span>Cart · السلة</span></h3><small>${qty} item${qty === 1 ? "" : "s"}</small></div>
    <ul class="zka-side__list">${lines
      .map((l) => `<li data-key="${esc(l.key)}">
        ${thumb(l, "zka-side__img")}
        <span class="zka-side__name"><b dir="auto">${esc(l.name_ar || l.name_en)}</b><small dir="auto">${esc(sizeInfo(l.size).ar)} · ${esc(sizeInfo(l.size).en)}${l.addons?.length ? ` + ${l.addons.length} add-on${l.addons.length > 1 ? "s" : ""}` : ""}</small><em>${egp(l.unit_price * l.qty)}</em></span>
        <span class="zka-step" role="group" aria-label="Quantity of ${esc(l.name_en)}">
          <button type="button" data-step="-1" aria-label="${l.qty > 1 ? "One less" : `Remove ${esc(l.name_en)}`}">${l.qty > 1 ? "−" : "🗑"}</button>
          <output aria-live="polite">${l.qty}</output>
          <button type="button" data-step="1" aria-label="One more" ${l.qty >= MAX_QTY ? "disabled" : ""}>+</button>
        </span>
      </li>`)
      .join("")}</ul>
    <div class="zka-side__foot">
      <div><span>Subtotal</span><b>${egp(subtotal)}</b></div>
      <div><span>Joke fees · الرسوم</span><b>${egp(Math.round((total - subtotal) * 100) / 100)}</b></div>
      <div class="zka-side__total"><span>Total · الإجمالي</span><b>${egp(total)}</b></div>
      <a class="zka-mini zka-mini--hot zka-side__go" href="/checkout">Checkout 💳</a>
      <button type="button" class="zka-mini zka-mini--ghost" data-cmd="/split 2">🧮 Split</button>
    </div>`;
}
function paintSide() {
  if (!el.side || !isOpen()) return;
  el.side.innerHTML = sideHtml();
}
function stepLine(key, delta) {
  const cart = cartLines();
  const i = cart.findIndex((l) => l.key === key);
  if (i < 0) return;
  const next = cart[i].qty + delta;
  if (next < 1) {
    cart.splice(i, 1);
    play("remove");
  } else {
    cart[i].qty = Math.min(MAX_QTY, next);
    play(delta > 0 ? "add" : "remove");
  }
  saveCart(cart);
  const btn = el.side.querySelector(`li[data-key="${CSS.escape(key)}"] [data-step="${delta}"]`);
  btn?.focus();
}

// ---------- render ----------
function render() {
  el.log.setAttribute("aria-busy", "true");
  if (!chat.length) el.log.innerHTML = emptyHtml();
  else el.log.innerHTML = chat.map((m, i) => dividerHtml(m, chat[i - 1]) + rowHtml(m, i, chat[i - 1], chat[i + 1])).join("");
  el.log.removeAttribute("aria-busy");
  paintChrome();
  paintSide();
  scrollToEnd(false);
}

// Append the newest message without re-rendering (keeps screen readers + scroll sane)
function appendLast() {
  if (chat.length === 1 || !el.log.querySelector(".zka-row[data-i]:not([data-i='-1'])")) {
    render();
    return el.log.lastElementChild;
  }
  const i = chat.length - 1;
  const m = chat[i];
  const prev = chat[i - 1];
  const nearBottom = isNearBottom();
  if (sameGroup(prev, m)) el.log.querySelector(`.zka-row[data-i="${i - 1}"]`)?.classList.remove("is-last");
  $$("[data-retry]", el.log).forEach((b) => b.remove());
  el.log.insertAdjacentHTML("beforeend", dividerHtml(m, prev) + rowHtml(m, i, prev, null));
  const row = el.log.lastElementChild;
  paintChrome();
  if (m.role === "user" || nearBottom) scrollToRow(row);
  else {
    unreadBelow++;
    paintJump();
  }
  return row;
}

function chipHtml(c) {
  if (typeof c === "string") return `<button type="button" class="zka-chip" dir="auto" data-say="${esc(c)}">${esc(c)}</button>`;
  return `<button type="button" class="zka-chip zka-chip--go" dir="auto" data-cmd="${esc(c.cmd)}">${esc(c.label)}</button>`;
}

function paintChrome() {
  // header status
  const last = chat[chat.length - 1];
  let status = ["online", "أونلاين", "on"];
  if (busy) status = ["typing…", "بيكتب", "busy"];
  else if (!navigator.onLine || last?.fallback || last?.error) status = ["on a tea break", "في البريك", "off"];
  el.status.innerHTML = `<i class="zka-dot zka-dot--${status[2]}" aria-hidden="true"></i>${status[0]} · <bdi dir="rtl">${status[1]}</bdi>`;
  el.typing.hidden = !busy;
  el.send.disabled = busy || !el.input.value.trim();
  el.form.setAttribute("aria-busy", String(busy));
  // contextual chips
  let set = CHIPS.base;
  const bot = [...chat].reverse().find((m) => m.role !== "user");
  if (bot && bot === last) {
    if (bot.order) set = CHIPS.order;
    else if (bot.recs) set = CHIPS.recs;
    else if (bot.dishes?.length) set = CHIPS.dishes;
    else if (bot.cart) set = CHIPS.cart;
  }
  el.chips.hidden = busy || !chat.length || !!last?.retry;
  const html = set.map(chipHtml).join("");
  if (el.chips.dataset.set !== html) {
    el.chips.innerHTML = html;
    el.chips.dataset.set = html;
    el.chips.scrollLeft = 0;
  }
  el.clear.disabled = !chat.length || busy;
}

// ---------- scrolling ----------
const isNearBottom = () => el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 90;
function scrollToEnd(smooth = true) {
  el.scroll.scrollTo({ top: el.scroll.scrollHeight, behavior: smooth && !calm() ? "smooth" : "auto" });
  unreadBelow = 0;
  paintJump();
}
function scrollToRow(row) {
  // Tall replies (carousels): show their top instead of jumping past them
  const top = row.offsetTop - 12;
  const toEnd = el.scroll.scrollHeight - el.scroll.clientHeight;
  const target = row.offsetHeight > el.scroll.clientHeight * 0.8 ? top : toEnd;
  el.scroll.scrollTo({ top: target, behavior: calm() ? "auto" : "smooth" });
  unreadBelow = 0;
  paintJump();
}
function paintJump() {
  const show = !isNearBottom() || unreadBelow > 0;
  el.jump.hidden = !show;
  el.jumpCount.hidden = !unreadBelow;
  el.jumpCount.textContent = unreadBelow > 9 ? "9+" : String(unreadBelow);
  el.jump.setAttribute("aria-label", unreadBelow ? `${unreadBelow} new messages, jump to latest` : "Jump to latest message");
}

// ---------- talking to the server ----------
function pushUser(text, extra = {}) {
  if (!chat.length) chat.push({ role: "assistant", content: greeting, greet: true, ts: Date.now() });
  const last = chat[chat.length - 1];
  if (last?.error) chat.pop(); // a fresh message replaces the failed reply
  chat.push({ role: "user", content: text, ts: Date.now(), ...extra });
  el.input.value = "";
  growInput();
  paintSlash();
  save();
  if (chat.length <= 2) render();
  else appendLast();
  play("click");
}

async function send(text) {
  text = String(text || "").trim().slice(0, MAX_LEN);
  if (!text || busy) return;
  if (text.startsWith("/")) return runCommand(text);
  pushUser(text);
  await request();
}

// "/split 3" → one tool on the server, no AI. "/help" stays local.
async function runCommand(text) {
  const [head, ...restParts] = text.split(/\s+/);
  const rest = restParts.join(" ").trim();
  const def = COMMANDS.find((c) => c.cmd === head.toLowerCase()) || COMMANDS.find((c) => c.cmd.startsWith(head.toLowerCase()) && head.length > 1);
  if (!def) {
    toast("Unknown command. Type / to see them · مفيش أمر كده");
    return;
  }
  const job = def.run(rest);
  pushUser(text, { cmd: true });
  if (job === "help") {
    chat.push({ role: "assistant", local: true, cmd: true, help: true, ts: Date.now(), content: "Here's what I do. Tap one, or just tell me in your own words.\nقولي عايز إيه وخلاص." });
    save();
    appendLast();
    return;
  }
  if (!job) {
    chat.push({ role: "assistant", local: true, cmd: true, ts: Date.now(), content: `Usage: ${def.cmd} ${def.args || ""}` });
    save();
    appendLast();
    return;
  }
  await request({ command: { name: job[0], args: job[1] } }, { cmd: true });
}

async function request(extra = {}, msgExtra = {}) {
  busy = true;
  paintChrome();
  scrollToEnd(); // the user just acted, so follow the conversation
  let data;
  try {
    const body = {
      cart: getCart().map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
      orders: recentOrders(),
      name: store.get(NAME_KEY, "") || undefined,
      ...extra,
    };
    if (!body.command) body.messages = chat.filter((m) => !m.greet && !m.local && !m.error && !m.cmd).slice(-12).map(({ role, content }) => ({ role, content }));
    const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    data = await res.json().catch(() => ({}));
    if (!res.ok && !data.reply) data = { reply: data.error || "The waiter tripped on the tray.", error: true };
    else if (!res.ok) data.fallback = true;
  } catch {
    data = { reply: navigator.onLine ? "Couldn't reach the waiter. He's hiding in the kitchen." : "You're offline. The waiter can't reach you, and honestly, relatable.", error: true };
  }
  busy = false;
  apply(data, msgExtra);
}

function apply(data, msgExtra = {}) {
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const msg = { role: "assistant", content: String(data.reply || "…"), ts: Date.now(), ...msgExtra };
  if (data.error) Object.assign(msg, { error: true, retry: !msgExtra.cmd });
  else if (data.fallback) Object.assign(msg, { fallback: true, retry: !msgExtra.cmd });

  const rec = actions.find((a) => a.type === "recommend" && Array.isArray(a.picks));
  if (rec) msg.recs = { budget: rec.budget, people: rec.people, mood: rec.mood, picks: rec.picks.slice(0, 3) };
  const recIds = new Set(rec ? rec.picks.map((p) => p.id) : []);
  if (Array.isArray(data.dishes) && data.dishes.length) {
    const rest = data.dishes.filter((d) => !recIds.has(d.id)).slice(0, 12);
    if (rest.length) msg.dishes = rest;
  }
  const cmp = actions.find((a) => a.type === "compare");
  if (cmp) msg.compare = { dishes: cmp.dishes, winners: cmp.winners };
  const review = actions.find((a) => a.type === "review_posted");
  if (review) msg.review = { dish: review.dish, review: review.review };
  const split = actions.find((a) => a.type === "split");
  if (split) msg.split = split;
  const mine = actions.find((a) => a.type === "orders");
  if (mine) msg.orders = mine.orders || [];
  const named = actions.find((a) => a.type === "set_name" && a.name);
  if (named) store.set(NAME_KEY, String(named.name).slice(0, 40));

  const placed = actions.find((a) => a.type === "order_placed");
  if (placed) {
    msg.order = { order_number: placed.order_number, total: placed.total, url: placed.url, items: placed.items };
    rememberOrder(placed.order_number);
  }
  const navs = actions.filter((a) => a.type === "navigate" && typeof a.url === "string" && a.url.startsWith("/") && !a.url.startsWith("//"));
  const go = navs.find((a) => a.auto);
  if (go) msg.go = { url: go.url, label: go.label || "Open" };
  const links = navs.filter((a) => !a.auto);
  if (links.length) msg.links = links.map((a) => ({ url: a.url, label: a.label || "Open" }));

  const cartAction = actions.filter((a) => a.type === "cart_updated");
  if (cartAction.length && Array.isArray(data.cart)) {
    saveCart(data.cart);
    if (!placed) msg.cart = cartSnapshot(data.cart);
  }

  chat.push(msg);
  save();
  const row = appendLast();
  if (placed && row && !calm()) celebrate($(".zka-order", row));
  if (go && row) startGo(row, msg.go);

  const what = cartAction.map((a) => a.what);
  if (placed) {
    play("cash");
    setTimeout(() => play("celebrate"), 600);
  } else if (what.includes("add") || what.includes("update") || what.includes("reorder")) play("add");
  else if (what.includes("remove") || what.includes("clear")) play("remove");
  else if (data.fallback || data.error) play("fail");
  else play("notify");
  if (!isOpen()) {
    unreadClosed++;
    paintFab();
  }
}

// Navigate actions: a short confirm card, then the page opens unless the user stays
function startGo(row, g) {
  const box = $("[data-go-card]", row);
  if (!box) return;
  box.outerHTML = goHtml(g, true);
  scrollToRow(row);
  clearTimeout(goTimer);
  if (!isOpen()) return stopGo(row);
  goTimer = setTimeout(() => {
    goTimer = null;
    location.href = g.url;
  }, calm() ? GO_DELAY + 1400 : GO_DELAY);
}
function stopGo(scope = el.log) {
  clearTimeout(goTimer);
  goTimer = null;
  $$(".zka-go.is-live", scope).forEach((box) => {
    const a = $("[data-go-now]", box);
    box.outerHTML = goHtml({ url: a?.getAttribute("href") || "/", label: $("strong", box)?.textContent.replace(/^➡️\s*/, "") }, false);
  });
}

function retry() {
  if (busy) return;
  const last = chat[chat.length - 1];
  if (!last?.retry) return;
  chat.pop();
  save();
  render();
  request();
}

function celebrate(card) {
  if (!card) return;
  const bits = ["🎉", "✨", "🧾", "💸", "🛵", "🔥", "💅", "🫡"];
  const box = document.createElement("span");
  box.className = "zka-confetti";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = Array.from({ length: 16 }, (_, i) => `<i style="--x:${Math.round(Math.random() * 220 - 110)}px;--y:${Math.round(-60 - Math.random() * 90)}px;--r:${Math.round(Math.random() * 360)}deg;--d:${(i % 5) * 40}ms">${bits[i % bits.length]}</i>`).join("");
  card.append(box);
  setTimeout(() => box.remove(), 1600);
}

// ---------- dish card buttons ----------
function closeSizes(except) {
  $$(".zka-sizes:not([hidden])", el.log).forEach((s) => {
    if (s === except) return;
    s.hidden = true;
    s.closest(".zka-card")?.querySelector("[data-pick]")?.setAttribute("aria-expanded", "false");
  });
}
function toggleSizes(btn) {
  const pop = btn.closest(".zka-card")?.querySelector(".zka-sizes");
  if (!pop) return;
  closeSizes(pop);
  pop.hidden = !pop.hidden;
  btn.setAttribute("aria-expanded", String(!pop.hidden));
  if (!pop.hidden) $(".zka-size[data-size='half']", pop)?.focus();
}

// Any dish the chat has shown: carousels, picks, comparisons, reviews
const knownDish = (id) => chat.flatMap((x) => [...(x.dishes || []), ...(x.recs?.picks || []), ...(x.compare?.dishes || []), ...(x.review?.dish ? [x.review.dish] : [])]).find((x) => x.id === id);

function addDish(id, size = "half", qty = 1) {
  const d = knownDish(id);
  if (!d) return;
  closeSizes();
  qty = Math.max(1, Math.min(MAX_QTY, Number(qty) || 1));
  addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size, addons: [], qty, unit_price: priceFor(d, size) });
  play("add");
  const s = sizeInfo(size);
  const n = qty > 1 ? `${qty}× ` : "";
  chat.push({
    role: "assistant",
    local: true,
    ts: Date.now(),
    content: pick([`✅ ${n}${d.name_ar} (${s.ar}) اتضاف.`, `✅ Added ${n}${d.name_en}, ${s.en.toLowerCase()}. Noted.`, `✅ ${n}${d.name_ar} ${s.ar} في السلة. Good call, probably.`]),
    cart: cartSnapshot(getCart()),
  });
  save();
  appendLast();
}

function openDish(id) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    if (isMobile() || el.panel.classList.contains("is-max")) close(false);
    card.click();
    return true;
  }
  store.set(PENDING_DISH_KEY, id);
  return false;
}

// Coming from another page: open the dish once the menu cards render
function openPendingDish() {
  const id = store.get(PENDING_DISH_KEY, null);
  if (!id) return;
  store.set(PENDING_DISH_KEY, null);
  let tries = 0;
  const timer = setInterval(() => {
    const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (card || ++tries > 25) {
      clearInterval(timer);
      card?.click();
    }
  }, 200);
}

// ---------- lightbox ----------
function openLightbox(src, cap) {
  if (!src) return;
  lastFocus = document.activeElement;
  el.lbImg.src = src;
  el.lbImg.alt = cap || "";
  el.lbCap.textContent = cap || "";
  el.lb.hidden = false;
  requestAnimationFrame(() => el.lb.classList.add("is-in"));
  $(".zka-lb__x", el.lb).focus();
}
function closeLightbox() {
  el.lb.classList.remove("is-in");
  el.lb.hidden = true;
  el.lbImg.removeAttribute("src");
  lastFocus?.focus?.();
}

// ---------- composer + "/" hint ----------
function growInput() {
  const t = el.input;
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  const n = t.value.length;
  el.count.hidden = n < MAX_LEN - 120;
  el.count.textContent = `${n}/${MAX_LEN}`;
  el.count.classList.toggle("is-max", n >= MAX_LEN);
  el.send.disabled = busy || !t.value.trim();
}
const slashMatches = () => {
  const v = el.input.value;
  if (!v.startsWith("/") || /\s/.test(v)) return [];
  return COMMANDS.filter((c) => c.cmd.startsWith(v.toLowerCase()));
};
function paintSlash() {
  const list = slashMatches();
  const exact = list.length === 1 && list[0].cmd === el.input.value.toLowerCase() && !list[0].args;
  if (!list.length || exact) {
    el.slash.hidden = true;
    el.input.removeAttribute("aria-activedescendant");
    el.input.setAttribute("aria-expanded", "false");
    return;
  }
  slashIdx = Math.min(slashIdx, list.length - 1);
  el.slash.innerHTML = `<div class="zka-slash__t">Shortcuts · أوامر سريعة <small>↑↓ · Tab</small></div>${list
    .map((c, i) => `<button type="button" role="option" id="zka-slash-${i}" class="zka-slash__i${i === slashIdx ? " is-on" : ""}" aria-selected="${i === slashIdx}" data-fill="${esc(c.cmd)}" data-hasargs="${c.args ? 1 : 0}"><code>${esc(c.cmd)}</code>${c.args ? `<i>${esc(c.args)}</i>` : ""}<span>${esc(c.en)} · <bdi dir="rtl">${esc(c.ar)}</bdi></span></button>`)
    .join("")}`;
  el.slash.hidden = false;
  el.input.setAttribute("aria-expanded", "true");
  el.input.setAttribute("aria-activedescendant", `zka-slash-${slashIdx}`);
}
function fillSlash(cmd, hasArgs) {
  el.slash.hidden = true;
  if (!hasArgs) return send(cmd);
  el.input.value = `${cmd} `;
  growInput();
  el.input.focus();
  paintSlash();
}

// ---------- clear chat ----------
function askClear() {
  el.confirm.hidden = false;
  $("[data-clear-no]", el.confirm).focus();
}
function doClear() {
  chat = [];
  save();
  el.confirm.hidden = true;
  render();
  play("remove");
  toast("Chat deleted. The waiter forgot you already.");
  el.input.focus();
}

// ---------- size: expand, resize grip, side cart toggle ----------
function paintSize() {
  const max = !!store.get(MAX_KEY, false) && !isMobile();
  el.panel.classList.toggle("is-max", max);
  el.expand.innerHTML = max ? ICON_SHRINK : ICON_EXPAND;
  el.expand.setAttribute("aria-label", max ? "Smaller window / صغّر" : "Bigger window / كبّر");
  el.expand.title = max ? "Smaller / صغّر" : "Full screen / كبّر";
  el.expand.setAttribute("aria-pressed", String(max));
  const s = store.get(SIZE_KEY, null);
  if (s && !max && !isMobile()) {
    el.panel.style.setProperty("--zka-w", `${s.w}px`);
    el.panel.style.setProperty("--zka-h", `${s.h}px`);
  } else {
    el.panel.style.removeProperty("--zka-w");
    el.panel.style.removeProperty("--zka-h");
  }
  const sideOff = store.get(SIDE_KEY, false);
  el.panel.classList.toggle("side-off", !!sideOff);
  el.sideBtn.setAttribute("aria-pressed", String(!sideOff));
  el.sideBtn.setAttribute("aria-label", sideOff ? "Show cart panel / وريني السلة" : "Hide cart panel / خبي السلة");
}
function toggleMax() {
  store.set(MAX_KEY, !store.get(MAX_KEY, false));
  paintSize();
  scrollToEnd(false);
}
function resizeBy(dw, dh) {
  const w = Math.round(Math.min(window.innerWidth - 24, Math.max(360, el.panel.offsetWidth + dw)));
  const h = Math.round(Math.min(window.innerHeight - 90, Math.max(420, el.panel.offsetHeight + dh)));
  store.set(SIZE_KEY, { w, h });
  paintSize();
}
function startGrip(e) {
  if (isMobile() || el.panel.classList.contains("is-max")) return;
  e.preventDefault();
  const start = { x: e.clientX, y: e.clientY, w: el.panel.offsetWidth, h: el.panel.offsetHeight };
  el.grip.setPointerCapture?.(e.pointerId);
  el.panel.classList.add("is-resizing");
  const move = (ev) => {
    const w = Math.min(window.innerWidth - 24, Math.max(360, start.w + (start.x - ev.clientX)));
    const h = Math.min(window.innerHeight - 90, Math.max(420, start.h + (start.y - ev.clientY)));
    el.panel.style.setProperty("--zka-w", `${Math.round(w)}px`);
    el.panel.style.setProperty("--zka-h", `${Math.round(h)}px`);
  };
  const up = () => {
    el.grip.removeEventListener("pointermove", move);
    el.grip.removeEventListener("pointerup", up);
    el.grip.removeEventListener("pointercancel", up);
    el.panel.classList.remove("is-resizing");
    store.set(SIZE_KEY, { w: el.panel.offsetWidth, h: el.panel.offsetHeight });
  };
  el.grip.addEventListener("pointermove", move);
  el.grip.addEventListener("pointerup", up);
  el.grip.addEventListener("pointercancel", up);
}

// ---------- open / close ----------
const isOpen = () => !el.panel.hidden;
function paintFab() {
  el.badge.hidden = !unreadClosed;
  el.badge.textContent = unreadClosed > 9 ? "9+" : String(unreadClosed);
  el.fab.setAttribute("aria-label", unreadClosed ? `Ask the waiter, ${unreadClosed} new` : "Ask the waiter / الجرسون");
}
function hidePeek() {
  if (el.peek) el.peek.hidden = true;
}
function open() {
  hidePeek();
  session.set(PEEK_KEY);
  el.panel.hidden = false;
  el.fab.setAttribute("aria-expanded", "true");
  unreadClosed = 0;
  paintFab();
  document.documentElement.classList.add("zka-open");
  paintSize();
  fitViewport();
  render();
  requestAnimationFrame(() => el.panel.classList.add("is-in"));
  // phones: don't pop the keyboard over the conversation right away
  setTimeout(() => (isMobile() ? el.closeBtn : el.input).focus({ preventScroll: true }), 40);
}
function close(refocus = true) {
  if (!isOpen()) return;
  closeSizes();
  stopGo();
  el.slash.hidden = true;
  el.confirm.hidden = true;
  el.panel.classList.remove("is-in");
  el.fab.setAttribute("aria-expanded", "false");
  document.documentElement.classList.remove("zka-open");
  const done = () => {
    if (!el.panel.classList.contains("is-in")) el.panel.hidden = true;
  };
  if (calm()) done();
  else setTimeout(done, 180);
  if (refocus) el.fab.focus();
}
// Keyboard-aware height on phones (100dvh ignores the on-screen keyboard on iOS)
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv || !isMobile() || !isOpen()) return el.panel.style.removeProperty("--zka-vh");
  el.panel.style.setProperty("--zka-vh", `${Math.round(vv.height)}px`);
}

function trapFocus(e) {
  const scope = !el.lb.hidden ? el.lb : el.panel;
  const items = $$("button:not([disabled]), a[href], textarea, [tabindex]:not([tabindex='-1'])", scope).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function mountAgent() {
  if (document.querySelector(".zka-fab")) return;
  if (!document.querySelector('link[href="/css/agent.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/agent.css";
    document.head.append(link);
  }
  // Orders placed through checkout land on the tracker: remember them for /orders and /reorder
  if (location.pathname.replace(/\.html$/, "") === "/order") rememberOrder(new URLSearchParams(location.search).get("n"));
  getConfig()
    .then((c) => {
      cfg = c;
      if (isOpen()) render();
    })
    .catch(() => {});

  const root = document.createElement("div");
  root.className = "zka";
  root.innerHTML = `
    <div class="zka-peek" hidden>
      <button type="button" class="zka-peek__msg" data-peek-open><span dir="rtl">محتاج مساعدة؟</span> / need help?</button>
      <button type="button" class="zka-peek__x" data-peek-x aria-label="Dismiss">✕</button>
    </div>
    <button class="zka-fab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="zka-panel" aria-label="Ask the waiter / الجرسون">
      <span class="zka-fab__av" aria-hidden="true">🤵</span>
      <span class="zka-fab__txt" aria-hidden="true">الجرسون <span class="zka-fab__en">/ Ask the waiter</span></span>
      <span class="zka-fab__badge" hidden></span>
    </button>
    <section class="zka-panel" id="zka-panel" role="dialog" aria-modal="true" aria-labelledby="zka-title" aria-describedby="zka-status" hidden>
      <button type="button" class="zka-grip" aria-label="Resize chat (arrow keys) / غيّر الحجم" title="Drag to resize · double-click to reset"></button>
      <header class="zka-head">
        <span class="zka-head__av" aria-hidden="true">🤵</span>
        <div class="zka-head__txt">
          <h2 id="zka-title"><span dir="rtl">الجرسون الحقود</span> <span class="zka-head__en">The Petty Waiter</span></h2>
          <span class="zka-status" id="zka-status" aria-live="off"></span>
        </div>
        <button type="button" class="zka-icon zka-icon--side" data-side aria-pressed="true" title="Cart panel / السلة">🛒</button>
        <button type="button" class="zka-icon zka-icon--max" data-max aria-pressed="false"></button>
        <button type="button" class="zka-icon" data-new aria-label="Clear chat / امسح الشات" title="Clear chat / امسح الشات">🗑️</button>
        <button type="button" class="zka-icon zka-icon--close" data-close aria-label="Close chat / اقفل" title="Close (Esc)">✕</button>
      </header>
      <div class="zka-confirm" role="alertdialog" aria-label="Clear chat?" hidden>
        <span dir="auto">Delete the whole chat? / نمسح كل حاجة؟</span>
        <button type="button" class="zka-mini zka-mini--hot" data-clear-yes>Delete 🗑️</button>
        <button type="button" class="zka-mini zka-mini--ghost" data-clear-no>No</button>
      </div>
      <div class="zka-body">
        <div class="zka-main">
          <div class="zka-scroll">
            <div class="zka-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat with the waiter"></div>
            <div class="zka-row zka-row--bot is-first is-last zka-typing-row" aria-hidden="true" hidden>
              <span class="zka-row__av">🤵</span>
              <div class="zka-row__col"><div class="zka-bubble zka-typing"><i></i><i></i><i></i></div></div>
            </div>
          </div>
          <button type="button" class="zka-jump" hidden aria-label="Jump to latest message"><span aria-hidden="true">↓</span><span class="zka-jump__n" hidden></span></button>
          <div class="zka-chips" role="group" aria-label="Quick replies / ردود سريعة"></div>
          <form class="zka-form">
            <div class="zka-slash" id="zka-slash" role="listbox" aria-label="Shortcuts" hidden></div>
            <label class="zka-sr" for="zka-input">Message the waiter / اكتب للجرسون</label>
            <div class="zka-field">
              <textarea id="zka-input" class="zka-input" rows="1" maxlength="${MAX_LEN}" autocomplete="off" dir="auto" enterkeyhint="send" placeholder="Type here, or / for shortcuts · اكتب هنا" aria-describedby="zka-hint" aria-controls="zka-slash" aria-autocomplete="list" aria-expanded="false"></textarea>
              <span class="zka-count" aria-live="polite" hidden></span>
            </div>
            <button type="submit" class="zka-send" aria-label="Send / ابعت" disabled>${ICON_SEND}</button>
            <span class="zka-sr" id="zka-hint">Enter to send, Shift+Enter for a new line, slash for shortcuts</span>
          </form>
        </div>
        <aside class="zka-side" aria-label="Your cart / السلة"></aside>
      </div>
    </section>
    <div class="zka-lb" role="dialog" aria-modal="true" aria-label="Photo" hidden>
      <figure class="zka-lb__fig"><img class="zka-lb__img" alt=""><figcaption class="zka-lb__cap" dir="auto"></figcaption></figure>
      <button type="button" class="zka-lb__x" aria-label="Close photo / اقفل">✕</button>
    </div>`;
  document.body.append(root);

  el = {
    root,
    fab: $(".zka-fab", root),
    badge: $(".zka-fab__badge", root),
    peek: $(".zka-peek", root),
    panel: $(".zka-panel", root),
    grip: $(".zka-grip", root),
    status: $(".zka-status", root),
    closeBtn: $("[data-close]", root),
    clear: $("[data-new]", root),
    expand: $("[data-max]", root),
    sideBtn: $("[data-side]", root),
    confirm: $(".zka-confirm", root),
    scroll: $(".zka-scroll", root),
    log: $(".zka-log", root),
    typing: $(".zka-typing-row", root),
    jump: $(".zka-jump", root),
    jumpCount: $(".zka-jump__n", root),
    chips: $(".zka-chips", root),
    form: $(".zka-form", root),
    slash: $(".zka-slash", root),
    input: $(".zka-input", root),
    count: $(".zka-count", root),
    send: $(".zka-send", root),
    side: $(".zka-side", root),
    lb: $(".zka-lb", root),
    lbImg: $(".zka-lb__img", root),
    lbCap: $(".zka-lb__cap", root),
  };

  el.fab.addEventListener("click", () => (isOpen() ? close() : open()));
  el.closeBtn.addEventListener("click", () => close());
  el.clear.addEventListener("click", askClear);
  el.expand.addEventListener("click", toggleMax);
  el.sideBtn.addEventListener("click", () => {
    store.set(SIDE_KEY, !store.get(SIDE_KEY, false));
    paintSize();
    paintSide();
  });
  el.grip.addEventListener("pointerdown", startGrip);
  el.grip.addEventListener("dblclick", () => {
    store.set(SIZE_KEY, null);
    paintSize();
  });
  el.grip.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 80 : 24;
    const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (!map[e.key]) return;
    e.preventDefault();
    resizeBy(...map[e.key]);
  });
  $("[data-clear-yes]", root).addEventListener("click", doClear);
  $("[data-clear-no]", root).addEventListener("click", () => {
    el.confirm.hidden = true;
    el.clear.focus();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(el.input.value);
  });
  el.input.addEventListener("input", () => {
    growInput();
    slashIdx = 0;
    paintSlash();
  });
  el.input.addEventListener("keydown", (e) => {
    if (!el.slash.hidden) {
      const items = $$(".zka-slash__i", el.slash);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        slashIdx = (slashIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        return paintSlash();
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && items[slashIdx] && items[slashIdx].dataset.fill !== el.input.value.toLowerCase())) {
        e.preventDefault();
        const it = items[slashIdx];
        return it && fillSlash(it.dataset.fill, it.dataset.hasargs === "1");
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        el.slash.hidden = true;
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) send(el.input.value);
    }
  });
  el.slash.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the textarea
  el.slash.addEventListener("click", (e) => {
    const it = e.target.closest("[data-fill]");
    if (it) fillSlash(it.dataset.fill, it.dataset.hasargs === "1");
  });
  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-say], [data-cmd]");
    if (chip) send(chip.dataset.cmd || chip.dataset.say);
  });
  el.side.addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) return stepLine(step.closest("li")?.dataset.key, Number(step.dataset.step));
    const cmd = e.target.closest("[data-cmd]");
    if (cmd) send(cmd.dataset.cmd);
  });
  document.addEventListener("cart:change", paintSide);
  el.log.addEventListener("click", (e) => {
    const t = e.target;
    const cmd = t.closest("[data-cmd]");
    if (cmd) return send(cmd.dataset.cmd);
    const say = t.closest("[data-say]");
    if (say) return send(say.dataset.say);
    if (t.closest("[data-go-cancel]")) {
      stopGo();
      return el.input.focus({ preventScroll: true });
    }
    if (t.closest("[data-go-now]")) return clearTimeout(goTimer);
    const size = t.closest("[data-size]");
    if (size) return addDish(size.dataset.add, size.dataset.size, size.dataset.qty);
    const pickBtn = t.closest("[data-pick]");
    if (pickBtn) return toggleSizes(pickBtn);
    if (t.closest("[data-unpick]")) return closeSizes();
    const photo = t.closest("[data-photo]");
    if (photo) return openLightbox(photo.dataset.photo, photo.dataset.cap);
    if (t.closest("[data-retry]")) return retry();
    const openBtn = t.closest("[data-open]");
    if (openBtn && openDish(openBtn.dataset.open)) e.preventDefault();
    if (!t.closest(".zka-sizes")) closeSizes();
  });
  el.scroll.addEventListener("scroll", () => {
    if (isNearBottom()) unreadBelow = 0;
    paintJump();
  }, { passive: true });
  el.jump.addEventListener("click", () => {
    scrollToEnd();
    el.input.focus({ preventScroll: true }); // the button hides itself, so don't strand focus on <body>
  });
  // Esc still closes when focus fell back to <body> (but not while a site modal has focus)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen() && el.lb.hidden && (document.activeElement === document.body || !document.activeElement)) close();
  });
  el.panel.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return trapFocus(e);
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (goTimer) return stopGo();
    if ($(".zka-sizes:not([hidden])", el.log)) return closeSizes();
    if (!el.confirm.hidden) {
      el.confirm.hidden = true;
      return el.clear.focus();
    }
    close();
  });
  el.lb.addEventListener("click", (e) => {
    if (!e.target.closest(".zka-lb__img")) closeLightbox();
  });
  el.lb.addEventListener("keydown", (e) => {
    if (e.key === "Tab") return trapFocus(e);
    if (e.key === "Escape") {
      e.stopPropagation();
      closeLightbox();
    }
  });
  window.visualViewport?.addEventListener("resize", fitViewport);
  window.addEventListener("resize", () => isOpen() && paintSize());
  window.addEventListener("online", () => isOpen() && paintChrome());
  window.addEventListener("offline", () => isOpen() && paintChrome());

  // One peek per session: "need help?"
  $("[data-peek-open]", root).addEventListener("click", open);
  $("[data-peek-x]", root).addEventListener("click", () => {
    hidePeek();
    session.set(PEEK_KEY);
  });
  if (!session.get(PEEK_KEY)) {
    setTimeout(() => {
      if (isOpen() || session.get(PEEK_KEY)) return;
      session.set(PEEK_KEY);
      el.peek.hidden = false;
      setTimeout(hidePeek, 9000);
    }, 4500);
  }

  paintSize();
  paintFab();
  openPendingDish();
}
