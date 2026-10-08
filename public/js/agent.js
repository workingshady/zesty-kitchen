// "الجرسون الحقود" chat widget: a floating waiter that talks to POST /api/agent.
// The server runs the tools; this file renders replies, dish carousels, cart/order cards and applies the returned cart.
import { $, $$, esc, egp, store, toast, play, getCart, saveCart, addToCart, linePrice, feesFor, getConfig, fitImg, pick, calm } from "./common.js";

const CHAT_KEY = "zk_agent_chat";
const ORDERS_KEY = "zk_orders";
const PENDING_DISH_KEY = "zk_agent_open_dish";
const PEEK_KEY = "zk_agent_peeked";
const MAX_SAVED = 30;
const MAX_LEN = 600;
const GROUP_GAP = 5 * 60 * 1000; // same sender within 5 min = one group

const GREETINGS = [
  "أهلاً يا باشا 🫡 I'm الجرسون الحقود. Tell me what you want and I'll judge you while I get it.",
  "Welcome back habibi. Ask me anything: menu, cart, orders. I'll do it, but I'll roast you 💅",
  "يا أهلاً. I'm the waiter. I add stuff to your cart, place orders, and silently judge. Mostly not silently.",
];
// Fallback size table (the real one comes from /api/config)
const SIZES = {
  quarter: { ar: "ربع", en: "Quarter", mult: 0.6 },
  half: { ar: "نص", en: "Half", mult: 1 },
  whole: { ar: "كامل", en: "Whole", mult: 1.8 },
  family: { ar: "عيلة", en: "Family", mult: 3 },
};
const STARTERS = [
  { label: "رشحلي حاجة 🔥", sub: "recommend me something" },
  { label: "show me photos 📸", sub: "وريني صور" },
  { label: "add the cheapest coworker 💸", sub: "ضيف أرخص واحد" },
  { label: "track my last order 🛵", sub: "الأوردر فين؟" },
];
const CHIPS = {
  base: ["رشحلي حاجة 🔥", "add the cheapest coworker", "show me photos 📸", "what's in my cart? 🛒", "اطلب الأوردر بتاعي / place my order", "track my last order 🛵", "return my order 💀"],
  dishes: ["add the first one ➕", "cheaper? 💸", "show photos 📸", "something else 🔄", "what's in my cart? 🛒"],
  cart: [{ label: "checkout 💳", href: "/checkout" }, "remove the last one ❌", "make it family size 👨‍👩‍👧", "place my order / اطلب 🧾", "what's in my cart? 🛒"],
  order: ["track my order 🛵", "return my order 💀", "رشحلي حلو 🍰", "رشحلي حاجة 🔥"],
};

let chat = store.get(CHAT_KEY, []);
if (!Array.isArray(chat)) chat = [];
chat = chat.filter((m) => m && typeof m.content === "string" && !m.error);
let busy = false;
let cfg = null;
let unreadClosed = 0; // replies that arrived while the panel was closed
let unreadBelow = 0; // replies that arrived while scrolled up
let lastFocus = null;
const greeting = pick(GREETINGS);
let el = {};

const save = () => store.set(CHAT_KEY, chat.filter((m) => !m.error).slice(-MAX_SAVED));
const recentOrders = () => {
  const list = store.get(ORDERS_KEY, []);
  return Array.isArray(list) ? list.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(-10) : [];
};
function rememberOrder(n) {
  const list = recentOrders().filter((x) => x !== Number(n));
  list.push(Number(n));
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
const sizeInfo = (key) => cfg?.sizes?.[key] || SIZES[key];
const priceFor = (d, size) => (cfg ? linePrice(cfg, d.price, size, []) : Math.round(d.price * SIZES[size].mult * 100) / 100);
const catEmoji = (slug) => cfg?.categories?.find((c) => c.slug === slug)?.emoji || "🍽️";

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

function dishCardHtml(d, single) {
  const photo = d.photo_url
    ? `<button type="button" class="zka-card__img" data-photo="${esc(d.photo_url)}" data-cap="${esc(`${d.name_ar} · ${d.name_en}`)}" aria-label="View photo of ${esc(d.name_en)}">${fitImg(d.photo_url, d.name_en)}</button>`
    : `<div class="zka-card__img zka-card__img--empty" aria-hidden="true">${catEmoji(d.category)}</div>`;
  const sizes = Object.keys(SIZES)
    .map((k) => `<button type="button" class="zka-size" data-add="${esc(d.id)}" data-size="${k}"><b>${esc(sizeInfo(k).ar)}</b><span>${esc(sizeInfo(k).en)}</span><em>${egp(priceFor(d, k))}</em></button>`)
    .join("");
  return `<article class="zka-card${single ? " zka-card--big" : ""}${d.sold_out ? " is-sold" : ""}" data-id="${esc(d.id)}">
    <div class="zka-card__media">${photo}<span class="zka-card__cat" aria-hidden="true">${catEmoji(d.category)}</span>${d.sold_out ? `<span class="zka-card__sold">💀 Sold out</span>` : ""}</div>
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

function cartCardHtml(c) {
  if (!c.items.length) return `<div class="zka-cart zka-cart--empty"><strong>🛒 Cart: empty / فاضية</strong><span>Like your promises 💀</span></div>`;
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

function rowHtml(m, i, prev, next) {
  const w = who(m);
  const first = !sameGroup(prev, m);
  const last = !sameGroup(m, next);
  let rich = "";
  if (m.dishes?.length) {
    const single = m.dishes.length === 1;
    rich += `<div class="zka-rail${single ? " zka-rail--single" : ""}" role="list" aria-label="${m.dishes.length} dishes">${m.dishes.map((d) => `<div role="listitem">${dishCardHtml(d, single)}</div>`).join("")}</div>`;
  }
  if (m.cart) rich += cartCardHtml(m.cart);
  if (m.order) rich += orderCardHtml(m.order);
  if (m.links?.length) rich += `<div class="zka-links">${m.links.map((l) => `<a class="zka-mini zka-mini--ghost" href="${esc(l.url)}">➡️ ${esc(l.label)}</a>`).join("")}</div>`;
  const retry = m.retry && i === chat.length - 1 ? `<button type="button" class="zka-mini zka-retry" data-retry>🔁 Retry / تاني</button>` : "";
  const meta = m.ts ? `<span class="zka-meta">${timeLabel(m.ts)}${w === "user" ? ` <span aria-hidden="true">✓✓</span><span class="zka-meta__seen"> seen (ignored)</span>` : ""}</span>` : "";
  const cls = ["zka-row", `zka-row--${w}`, first && "is-first", last && "is-last", rich && "zka-row--rich", m.fallback && "zka-row--fallback", m.error && "zka-row--error"].filter(Boolean).join(" ");
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
    <p class="zka-empty__s">Orders food. Judges you. Both, for free.</p>
  </div>
  ${rowHtml({ role: "assistant", content: greeting }, -1, null, null)}
  <div class="zka-starters">${STARTERS.map((s) => `<button type="button" class="zka-starter" data-say="${esc(s.label)}"><b dir="auto">${esc(s.label)}</b><span dir="auto">${esc(s.sub)}</span></button>`).join("")}</div>`;
}

// ---------- render ----------
function render() {
  el.log.setAttribute("aria-busy", "true");
  if (!chat.length) el.log.innerHTML = emptyHtml();
  else el.log.innerHTML = chat.map((m, i) => dividerHtml(m, chat[i - 1]) + rowHtml(m, i, chat[i - 1], chat[i + 1])).join("");
  el.log.removeAttribute("aria-busy");
  paintChrome();
  scrollToEnd(false);
}

// Append the newest message without re-rendering (keeps screen readers + scroll sane)
function appendLast() {
  if (chat.length === 1 || !el.log.querySelector(".zka-row[data-i]:not([data-i='-1'])")) return render();
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

function paintChrome() {
  // header status
  const last = chat[chat.length - 1];
  let status = ["online (lying)", "أونلاين وبيكدب", "on"];
  if (busy) status = ["typing…", "بيكتب ✍️", "busy"];
  else if (!navigator.onLine || last?.fallback || last?.error) status = ["on a tea break ☕", "في البريك", "off"];
  el.status.innerHTML = `<i class="zka-dot zka-dot--${status[2]}" aria-hidden="true"></i>${status[0]} · <bdi dir="rtl">${status[1]}</bdi>`;
  el.typing.hidden = !busy;
  el.send.disabled = busy || !el.input.value.trim();
  el.form.setAttribute("aria-busy", String(busy));
  // contextual chips
  let set = CHIPS.base;
  const bot = [...chat].reverse().find((m) => m.role !== "user");
  if (bot && bot === last) {
    if (bot.order) set = CHIPS.order;
    else if (bot.dishes?.length) set = CHIPS.dishes;
    else if (bot.cart) set = CHIPS.cart;
  }
  el.chips.hidden = busy || !chat.length || !!last?.retry;
  const html = set.map((c) => (typeof c === "string" ? `<button type="button" class="zka-chip" dir="auto" data-say="${esc(c)}">${esc(c)}</button>` : `<a class="zka-chip zka-chip--go" href="${esc(c.href)}" dir="auto">${esc(c.label)}</a>`)).join("");
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
async function send(text) {
  text = String(text || "").trim().slice(0, MAX_LEN);
  if (!text || busy) return;
  if (!chat.length) chat.push({ role: "assistant", content: greeting, greet: true, ts: Date.now() });
  const last = chat[chat.length - 1];
  if (last?.error) chat.pop(); // a fresh message replaces the failed reply
  chat.push({ role: "user", content: text, ts: Date.now() });
  el.input.value = "";
  growInput();
  save();
  if (chat.length <= 2) render();
  else appendLast();
  play("click");
  await request();
}

async function request() {
  busy = true;
  paintChrome();
  scrollToEnd(); // the user just acted, so follow the conversation
  let data;
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chat.filter((m) => !m.greet && !m.local && !m.error).slice(-12).map(({ role, content }) => ({ role, content })),
        cart: getCart().map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
        orders: recentOrders(),
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok && !data.reply) data = { reply: data.error || "The waiter tripped on the tray 🍽️💥", error: true };
    else if (!res.ok) data.fallback = true;
  } catch {
    data = { reply: navigator.onLine ? "Couldn't reach the waiter. He's hiding in the kitchen 📵" : "You're offline. The waiter can't reach you, and honestly? Relatable 📵", error: true };
  }
  busy = false;
  apply(data);
}

function apply(data) {
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const msg = { role: "assistant", content: String(data.reply || "…"), ts: Date.now() };
  if (data.error) Object.assign(msg, { error: true, retry: true });
  else if (data.fallback) Object.assign(msg, { fallback: true, retry: true });
  if (Array.isArray(data.dishes) && data.dishes.length) msg.dishes = data.dishes.slice(0, 12);
  const placed = actions.find((a) => a.type === "order_placed");
  if (placed) {
    msg.order = { order_number: placed.order_number, total: placed.total, url: placed.url, items: placed.items };
    rememberOrder(placed.order_number);
  }
  const links = actions.filter((a) => a.type === "navigate" && typeof a.url === "string" && a.url.startsWith("/"));
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

  const what = cartAction.map((a) => a.what);
  if (placed) {
    play("cash");
    setTimeout(() => play("celebrate"), 600);
  } else if (what.includes("add") || what.includes("update")) play("add");
  else if (what.includes("remove") || what.includes("clear")) play("remove");
  else if (data.fallback || data.error) play("fail");
  else play("notify");
  if (!isOpen()) {
    unreadClosed++;
    paintFab();
  }
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

function addDish(id, size = "half") {
  const d = chat.flatMap((x) => x.dishes || []).find((x) => x.id === id);
  if (!d) return;
  closeSizes();
  addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size, addons: [], qty: 1, unit_price: priceFor(d, size) });
  play("add");
  const s = sizeInfo(size);
  chat.push({
    role: "assistant",
    local: true,
    ts: Date.now(),
    content: pick([`✅ ${d.name_ar} (${s.ar}) اتضاف. The waiter approves (barely) 🫡`, `✅ Added ${d.name_en}, ${s.en.toLowerCase()} size. Bold choice ngl 💅`, `✅ ${d.name_ar} ${s.ar} في السلة. Your manager would be proud. Or not 💀`]),
    cart: cartSnapshot(getCart()),
  });
  save();
  appendLast();
}

function openDish(id) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    if (isMobile()) close(false);
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

// ---------- composer ----------
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
  toast("Chat deleted. The waiter forgot you already 🫥");
  el.input.focus();
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
  fitViewport();
  render();
  requestAnimationFrame(() => el.panel.classList.add("is-in"));
  // phones: don't pop the keyboard over the conversation right away
  setTimeout(() => (isMobile() ? el.closeBtn : el.input).focus({ preventScroll: true }), 40);
}
function close(refocus = true) {
  if (!isOpen()) return;
  closeSizes();
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
      <button type="button" class="zka-peek__msg" data-peek-open><span dir="rtl">محتاج مساعدة؟</span> / need help? 😏</button>
      <button type="button" class="zka-peek__x" data-peek-x aria-label="Dismiss">✕</button>
    </div>
    <button class="zka-fab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="zka-panel" aria-label="Ask the waiter / الجرسون">
      <span class="zka-fab__av" aria-hidden="true">🤵</span>
      <span class="zka-fab__txt" aria-hidden="true">الجرسون <span class="zka-fab__en">/ Ask the waiter</span></span>
      <span class="zka-fab__badge" hidden></span>
    </button>
    <section class="zka-panel" id="zka-panel" role="dialog" aria-modal="true" aria-labelledby="zka-title" aria-describedby="zka-status" hidden>
      <header class="zka-head">
        <span class="zka-head__av" aria-hidden="true">🤵</span>
        <div class="zka-head__txt">
          <h2 id="zka-title"><span dir="rtl">الجرسون الحقود</span> <span class="zka-head__en">The Petty Waiter</span></h2>
          <span class="zka-status" id="zka-status" aria-live="off"></span>
        </div>
        <button type="button" class="zka-icon" data-new aria-label="Clear chat / امسح الشات" title="Clear chat / امسح الشات">🗑️</button>
        <button type="button" class="zka-icon zka-icon--close" data-close aria-label="Close chat / اقفل" title="Close (Esc)">✕</button>
      </header>
      <div class="zka-confirm" role="alertdialog" aria-label="Clear chat?" hidden>
        <span dir="auto">Delete the whole chat? / نمسح كل حاجة؟ 😬</span>
        <button type="button" class="zka-mini zka-mini--hot" data-clear-yes>Delete 🗑️</button>
        <button type="button" class="zka-mini zka-mini--ghost" data-clear-no>No</button>
      </div>
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
        <label class="zka-sr" for="zka-input">Message the waiter / اكتب للجرسون</label>
        <div class="zka-field">
          <textarea id="zka-input" class="zka-input" rows="1" maxlength="${MAX_LEN}" autocomplete="off" dir="auto" enterkeyhint="send" placeholder="Type here… / اكتب هنا" aria-describedby="zka-hint"></textarea>
          <span class="zka-count" aria-live="polite" hidden></span>
        </div>
        <button type="submit" class="zka-send" aria-label="Send / ابعت" disabled>${ICON_SEND}</button>
        <span class="zka-sr" id="zka-hint">Enter to send, Shift+Enter for a new line</span>
      </form>
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
    status: $(".zka-status", root),
    closeBtn: $("[data-close]", root),
    clear: $("[data-new]", root),
    confirm: $(".zka-confirm", root),
    scroll: $(".zka-scroll", root),
    log: $(".zka-log", root),
    typing: $(".zka-typing-row", root),
    jump: $(".zka-jump", root),
    jumpCount: $(".zka-jump__n", root),
    chips: $(".zka-chips", root),
    form: $(".zka-form", root),
    input: $(".zka-input", root),
    count: $(".zka-count", root),
    send: $(".zka-send", root),
    lb: $(".zka-lb", root),
    lbImg: $(".zka-lb__img", root),
    lbCap: $(".zka-lb__cap", root),
  };

  el.fab.addEventListener("click", () => (isOpen() ? close() : open()));
  el.closeBtn.addEventListener("click", () => close());
  el.clear.addEventListener("click", askClear);
  $("[data-clear-yes]", root).addEventListener("click", doClear);
  $("[data-clear-no]", root).addEventListener("click", () => {
    el.confirm.hidden = true;
    el.clear.focus();
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(el.input.value);
  });
  el.input.addEventListener("input", growInput);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!busy) send(el.input.value);
    }
  });
  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-say]");
    if (chip) send(chip.dataset.say);
  });
  el.log.addEventListener("click", (e) => {
    const t = e.target;
    const say = t.closest("[data-say]");
    if (say) return send(say.dataset.say);
    const size = t.closest("[data-size]");
    if (size) return addDish(size.dataset.add, size.dataset.size);
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

  paintFab();
  openPendingDish();
}
