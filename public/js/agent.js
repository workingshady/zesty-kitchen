// "الجرسون الحقود" chat widget: a floating waiter that talks to POST /api/agent.
// The server runs the tools; this file just renders replies, dish cards and applies the returned cart.
import { $, esc, egp, store, toast, play, getCart, saveCart, addToCart, linePrice, getConfig, fitImg, pick } from "./common.js";

const CHAT_KEY = "zk_agent_chat";
const ORDERS_KEY = "zk_orders";
const PENDING_DISH_KEY = "zk_agent_open_dish";
const MAX_SAVED = 30;

const GREETINGS = [
  "أهلاً يا باشا 🫡 I'm الجرسون الحقود. Tell me what you want and I'll judge you while I get it.",
  "Welcome back habibi. Ask me anything: menu, cart, orders. I'll do it, but I'll roast you 💅",
  "يا أهلاً. I'm the waiter. I add stuff to your cart, place orders, and silently judge. Mostly not silently.",
];
const CHIPS = [
  "رشحلي حاجة 🔥",
  "add the cheapest coworker",
  "show me photos 📸",
  "what's in my cart? 🛒",
  "اطلب الأوردر بتاعي / place my order",
  "track my last order 🛵",
  "return my order 💀",
];

let chat = store.get(CHAT_KEY, []);
if (!Array.isArray(chat)) chat = [];
let busy = false;
const greeting = pick(GREETINGS);
let el = {};

const save = () => store.set(CHAT_KEY, chat.slice(-MAX_SAVED));
const recentOrders = () => {
  const list = store.get(ORDERS_KEY, []);
  return Array.isArray(list) ? list.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(-10) : [];
};
function rememberOrder(n) {
  const list = recentOrders().filter((x) => x !== Number(n));
  list.push(Number(n));
  store.set(ORDERS_KEY, list.slice(-10));
}

// ---------- rendering ----------
function dishCardHtml(d) {
  const photo = d.photo_url ? fitImg(d.photo_url, d.name_en) : `<span class="zka-card__emoji" aria-hidden="true">🍽️</span>`;
  return `<div class="zka-card" data-id="${esc(d.id)}">
    <div class="zka-card__img">${photo}</div>
    <div class="zka-card__body">
      <strong dir="auto">${esc(d.name_ar)}</strong>
      <span class="zka-card__en" dir="auto">${esc(d.name_en)}</span>
      ${d.job_title ? `<span class="zka-card__job" dir="auto">${esc(d.job_title)}</span>` : ""}
      <span class="zka-card__price">${egp(d.price)}</span>
      <span class="zka-card__btns">
        ${d.sold_out ? `<span class="zka-sold">💀 Sold out</span>` : `<button type="button" class="zka-mini" data-add="${esc(d.id)}">➕ Add / ضيف</button>`}
        <a class="zka-mini zka-mini--ghost" href="/" data-open="${esc(d.id)}">👀 Open</a>
      </span>
    </div>
  </div>`;
}

function messageHtml(m) {
  const who = m.role === "user" ? "user" : "bot";
  let extra = "";
  if (m.dishes?.length) extra += `<div class="zka-cards">${m.dishes.map(dishCardHtml).join("")}</div>`;
  if (m.order) {
    extra += `<div class="zka-order">
      <strong>🧾 Order #${esc(m.order.order_number)} placed / الأوردر اتبعت</strong>
      <span>${egp(m.order.total)} · ${esc((m.order.items || []).join(", "))}</span>
      <a class="zka-mini" href="${esc(m.order.url)}">🛵 Track it / تابع الأوردر</a>
    </div>`;
  }
  if (m.links?.length) extra += m.links.map((l) => `<a class="zka-mini zka-link" href="${esc(l.url)}">➡️ ${esc(l.label)}</a>`).join("");
  return `<div class="zka-msg zka-msg--${who}${m.fallback ? " zka-msg--fallback" : ""}">
    <div class="zka-bubble" dir="auto">${esc(m.content)}</div>${extra}
  </div>`;
}

function render() {
  const items = chat.length ? chat : [{ role: "assistant", content: greeting }];
  el.log.innerHTML = items.map(messageHtml).join("") + (busy ? `<div class="zka-msg zka-msg--bot"><div class="zka-bubble zka-typing" aria-label="The waiter is typing"><i></i><i></i><i></i></div></div>` : "");
  el.chips.hidden = busy;
  el.log.scrollTop = el.log.scrollHeight;
}

// ---------- talking to the server ----------
async function send(text) {
  text = text.trim().slice(0, 600);
  if (!text || busy) return;
  if (!chat.length) chat.push({ role: "assistant", content: greeting, greet: true });
  chat.push({ role: "user", content: text });
  busy = true;
  el.input.value = "";
  el.send.disabled = true;
  save();
  render();
  play("click");

  let data;
  try {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chat.filter((m) => !m.greet).slice(-12).map(({ role, content }) => ({ role, content })),
        cart: getCart().map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
        orders: recentOrders(),
      }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok && !data.reply) data = { reply: data.error || "The waiter tripped on the tray 🍽️💥 try again", fallback: true };
  } catch {
    data = { reply: "No connection. The waiter can't reach you, and honestly? Relatable 📵", fallback: true };
  }
  busy = false;
  el.send.disabled = false;
  apply(data);
}

function apply(data) {
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const msg = { role: "assistant", content: String(data.reply || "…"), fallback: !!data.fallback };
  if (Array.isArray(data.dishes) && data.dishes.length) msg.dishes = data.dishes;
  const placed = actions.find((a) => a.type === "order_placed");
  if (placed) {
    msg.order = { order_number: placed.order_number, total: placed.total, url: placed.url, items: placed.items };
    rememberOrder(placed.order_number);
  }
  const links = actions.filter((a) => a.type === "navigate" && typeof a.url === "string" && a.url.startsWith("/"));
  if (links.length) msg.links = links.map((a) => ({ url: a.url, label: a.label || "Open" }));

  const cartAction = actions.filter((a) => a.type === "cart_updated");
  if (cartAction.length && Array.isArray(data.cart)) saveCart(data.cart);

  chat.push(msg);
  save();
  render();

  // sounds: the most dramatic thing that happened wins
  const what = cartAction.map((a) => a.what);
  if (placed) {
    play("cash");
    setTimeout(() => play("celebrate"), 600);
  } else if (what.includes("add") || what.includes("update")) play("add");
  else if (what.includes("remove") || what.includes("clear")) play("remove");
  else if (data.fallback) play("fail");
  else play("notify");
  if (!isOpen()) el.fab.classList.add("zka-fab--ping");
}

// ---------- dish card buttons ----------
async function addDish(id) {
  const m = chat.flatMap((x) => x.dishes || []).find((d) => d.id === id);
  if (!m) return;
  const config = await getConfig().catch(() => null);
  const unit_price = config ? linePrice(config, m.price, "half", []) : m.price;
  addToCart({ dish_id: m.id, name_ar: m.name_ar, name_en: m.name_en, photo_url: m.photo_url, size: "half", addons: [], qty: 1, unit_price });
  play("add");
  toast(`${m.name_ar} اتضاف. The waiter approves (barely) 🫡`);
}

function openDish(id) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  if (card) {
    if (window.matchMedia("(max-width: 520px)").matches) close();
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

// ---------- open / close ----------
const isOpen = () => !el.panel.hidden;
function open() {
  el.panel.hidden = false;
  el.fab.setAttribute("aria-expanded", "true");
  el.fab.classList.remove("zka-fab--ping");
  document.documentElement.classList.add("zka-open");
  render();
  setTimeout(() => el.input.focus(), 30);
}
function close() {
  el.panel.hidden = true;
  el.fab.setAttribute("aria-expanded", "false");
  document.documentElement.classList.remove("zka-open");
  el.fab.focus();
}

export function mountAgent() {
  if (document.querySelector(".zka-fab")) return;
  if (!document.querySelector('link[href="/css/agent.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/css/agent.css";
    document.head.append(link);
  }

  const root = document.createElement("div");
  root.className = "zka";
  root.innerHTML = `
    <button class="zka-fab" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="zka-panel">
      💬 <span>الجرسون <span class="zka-fab__en">/ Ask the waiter</span></span>
    </button>
    <section class="zka-panel" id="zka-panel" role="dialog" aria-labelledby="zka-title" hidden>
      <header class="zka-head">
        <span class="zka-avatar" aria-hidden="true">🤵</span>
        <div class="zka-head__txt">
          <h2 id="zka-title">الجرسون الحقود</h2>
          <span>The Petty Waiter · بيخدمك وبيتريق عليك</span>
        </div>
        <button type="button" class="zka-icon" data-new title="New chat / شات جديد" aria-label="New chat">🗑️<span class="zka-icon__txt"> new chat</span></button>
        <button type="button" class="zka-icon" data-close aria-label="Close chat / اقفل">✕</button>
      </header>
      <div class="zka-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="zka-chips">${CHIPS.map((c) => `<button type="button" class="zka-chip" dir="auto">${esc(c)}</button>`).join("")}</div>
      <form class="zka-form">
        <label class="zka-sr" for="zka-input">Message the waiter / اكتب للجرسون</label>
        <input id="zka-input" class="zka-input" type="text" maxlength="600" autocomplete="off" dir="auto" placeholder="اكتب هنا… or type in English">
        <button type="submit" class="zka-send" aria-label="Send / ابعت">➤</button>
      </form>
    </section>`;
  document.body.append(root);

  el = {
    fab: $(".zka-fab", root),
    panel: $(".zka-panel", root),
    log: $(".zka-log", root),
    chips: $(".zka-chips", root),
    input: $(".zka-input", root),
    send: $(".zka-send", root),
  };

  el.fab.addEventListener("click", () => (isOpen() ? close() : open()));
  $("[data-close]", root).addEventListener("click", close);
  $("[data-new]", root).addEventListener("click", () => {
    chat = [];
    save();
    render();
    play("remove");
    el.input.focus();
  });
  $(".zka-form", root).addEventListener("submit", (e) => {
    e.preventDefault();
    send(el.input.value);
  });
  el.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".zka-chip");
    if (chip) send(chip.textContent);
  });
  el.log.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) return addDish(add.dataset.add);
    const openBtn = e.target.closest("[data-open]");
    if (openBtn && openDish(openBtn.dataset.open)) e.preventDefault();
  });
  el.panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });

  openPendingDish();
}
