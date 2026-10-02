// Shared helpers + global chaos (googly eyes, crumbs, rage clicks, idle DVD, easter eggs).

// ---------- storage (can throw in private mode) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode: just don't persist */
    }
  },
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const egp = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- modes ----------
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isChill = () => store.get("zk_chill", false);
export const calm = () => isChill() || reducedMotion;
const isTouch = () => window.matchMedia("(hover: none)").matches;
export { isTouch };

// ---------- API ----------
let wakeTimer = null;
let firstCall = true;

export async function api(path, options = {}) {
  if (firstCall) {
    firstCall = false;
    wakeTimer = setTimeout(showWaking, 1200);
  }
  try {
    const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "The chef dropped the plate 🍽️💥 try again"), { status: res.status });
    return data;
  } catch (err) {
    if (!err.status) err.message = "The chef dropped the plate 🍽️💥 check your internet and try again";
    throw err;
  } finally {
    clearTimeout(wakeTimer);
    $(".waking")?.remove();
  }
}

function showWaking() {
  if ($(".waking")) return;
  const el = document.createElement("div");
  el.className = "waking";
  el.setAttribute("role", "status");
  el.innerHTML = `<div><div class="waking__chef">👨‍🍳</div><h2>Chef is waking up… <br>الشيف لسه صاحي</h2><p>Free servers nap. Give it ~30 seconds, no cap.</p></div>`;
  document.body.append(el);
}

let configPromise = null;
export const getConfig = () => (configPromise ||= api("/api/config"));

// ---------- toasts ----------
export function toast(message, { error = false, ms = 3200 } = {}) {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.className = `toast${error ? " err" : ""}`;
  t.textContent = message;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- sound (Web Audio, no files; off by default) ----------
let audioCtx = null;
export const soundOn = () => store.get("zk_sound", false) && !isChill();
export function beep(notes = [[660, 0.08]], type = "square") {
  if (!soundOn()) return;
  audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
  let t = audioCtx.currentTime;
  for (const [freq, dur] of notes) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
  }
}
export const sfx = {
  add: () => beep([[523, 0.07], [784, 0.1]]),
  error: () => beep([[392, 0.18], [370, 0.18], [349, 0.18], [330, 0.4]], "sawtooth"), // sad trombone-ish
  win: () => beep([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]]),
};

// ---------- cart ----------
const CART_KEY = "zk_cart";
export const getCart = () => store.get(CART_KEY, []);
export function saveCart(items) {
  store.set(CART_KEY, items);
  document.dispatchEvent(new CustomEvent("cart:change", { detail: items }));
}
export const lineKey = (dishId, size, addons) => `${dishId}|${size}|${[...addons].sort().join(",")}`;
export function addToCart(item) {
  const cart = getCart();
  const key = lineKey(item.dish_id, item.size, item.addons);
  const existing = cart.find((l) => l.key === key);
  if (existing) existing.qty = Math.min(9, existing.qty + item.qty);
  else cart.push({ ...item, key });
  saveCart(cart.slice(0, 10));
}
export const cartCount = () => getCart().reduce((n, l) => n + l.qty, 0);

// Mirrors server pricing for display only; the server recomputes everything.
export function linePrice(config, base, size, addons) {
  const extras = addons.reduce((s, a) => s + (config.addons[a]?.price || 0), 0);
  return Math.round((base * config.sizes[size].mult + extras) * 100) / 100;
}
export function feesFor(subtotal) {
  const fees = [
    ["رسوم التواصل البصري", "Eye-contact fee", 49.99],
    ["ضريبة السكوت المحرج", "Awkward silence tax (14%)", Math.round(subtotal * 14) / 100],
    ["توصيل عن طريق HR", "Delivery by HR", 120],
    ["ضريبة الأورا", "Aura tax (−67 aura)", 0],
    ["دعم نفسي", "Emotional support fee", 0.01],
  ];
  const total = Math.round((subtotal + fees.reduce((s, f) => s + f[2], 0)) * 100) / 100;
  return { fees, total };
}
export function totalsHtml(cart) {
  const subtotal = Math.round(cart.reduce((s, l) => s + l.unit_price * l.qty, 0) * 100) / 100;
  const { fees, total } = feesFor(subtotal);
  return `<div><span>Subtotal / المجموع</span><span>${egp(subtotal)}</span></div>
    ${fees.map(([ar, en, amt]) => `<div><span>${en} / ${ar}</span><span>${amt === 0 ? "-67 aura" : egp(amt)}</span></div>`).join("")}
    <div class="grand"><span>Total / الإجمالي</span><span>${egp(total)}</span></div>`;
}

// ---------- floating controls ----------
function mountFloaters() {
  const box = document.createElement("div");
  box.className = "floaters";
  box.innerHTML = `
    <button class="btn white chill-btn" type="button" aria-pressed="${isChill()}">😩 <span>${isChill() ? "Chill mode ON" : "I give up"}</span></button>
    <button class="btn white icon-btn sound-btn" type="button" aria-label="Toggle sound">${store.get("zk_sound", false) ? "🔊" : "🔇"}</button>`;
  document.body.append(box);
  $(".chill-btn", box).addEventListener("click", (e) => {
    const next = !isChill();
    store.set("zk_chill", next);
    e.currentTarget.setAttribute("aria-pressed", next);
    $("span", e.currentTarget).textContent = next ? "Chill mode ON" : "I give up";
    document.documentElement.classList.toggle("chill-on", next);
    toast(next ? "Chill mode: no more chaos. Weak, but valid 🫡" : "Chaos is back. Good luck habibi 😈");
  });
  $(".sound-btn", box).addEventListener("click", (e) => {
    const next = !store.get("zk_sound", false);
    store.set("zk_sound", next);
    e.currentTarget.textContent = next ? "🔊" : "🔇";
    if (next) sfx.add();
  });
}

// ---------- googly-eyed chef ----------
function googlyEyes() {
  const pupils = $$(".pupil");
  if (!pupils.length) return;
  document.addEventListener("pointermove", (e) => {
    for (const p of pupils) {
      const r = p.parentElement.getBoundingClientRect();
      const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
      p.style.transform = `translate(${Math.cos(a) * 4}px, ${Math.sin(a) * 4}px)`;
    }
    const scary = e.target.closest?.("[data-scary]");
    $(".chef")?.classList.toggle("angry", Boolean(scary));
  });
}

// ---------- food crumb cursor trail ----------
function crumbTrail() {
  if (isTouch()) return;
  const crumbs = ["🍗", "🌶️", "🧆", "🍚", "🌯", "🥙"];
  let last = 0;
  document.addEventListener("pointermove", (e) => {
    if (calm() || Date.now() - last < 70) return;
    last = Date.now();
    const s = document.createElement("span");
    s.className = "trail";
    s.textContent = crumbs[Math.floor(Math.random() * crumbs.length)];
    s.style.left = `${e.clientX + 8}px`;
    s.style.top = `${e.clientY + 8}px`;
    document.body.append(s);
    setTimeout(() => s.remove(), 900);
  });
}

// ---------- tab title guilt trip ----------
function guiltyTitle() {
  const original = document.title;
  document.addEventListener("visibilitychange", () => {
    document.title = document.hidden ? "😭 طلبك بيبرد / Your food is getting cold" : original;
  });
}

// ---------- rage click ----------
function rageClicks() {
  let clicks = [];
  document.addEventListener("click", () => {
    if (calm()) return;
    const now = Date.now();
    clicks = clicks.filter((t) => now - t < 600).concat(now);
    if (clicks.length >= 4) {
      clicks = [];
      document.body.classList.remove("shake");
      void document.body.offsetWidth;
      document.body.classList.add("shake");
      toast("اهدى habibi 😤 the clicks won't make it faster");
      sfx.error();
    }
  });
}

// ---------- faces for effects ----------
let faces = null;
async function getFaces() {
  if (faces) return faces;
  try {
    const dishes = await api("/api/dishes");
    faces = dishes.map((d) => d.photo_url).filter(Boolean);
  } catch {
    faces = [];
  }
  return faces;
}

function faceEl(url, fallback = "🍗") {
  return url ? `<img src="${esc(url)}" alt="">` : fallback;
}

// ---------- idle DVD bounce ----------
function idleDvd() {
  let timer;
  let dvd = null;
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    dvd?.remove();
    dvd = null;
    clearTimeout(timer);
    timer = setTimeout(start, 60_000);
  };
  async function start() {
    if (calm() || document.hidden) return stop();
    const list = await getFaces();
    dvd = document.createElement("div");
    dvd.className = "dvd";
    dvd.setAttribute("aria-hidden", "true");
    dvd.innerHTML = faceEl(list[Math.floor(Math.random() * list.length)], "👨‍🍳");
    document.body.append(dvd);
    let x = 40, y = 40, vx = 2.2, vy = 1.8;
    const colors = ["#ffc700", "#ff69b4", "#8ace00", "#fa4b13", "#ff3b30"];
    const step = () => {
      const maxX = innerWidth - 90, maxY = innerHeight - 90;
      x += vx;
      y += vy;
      if (x <= 0 || x >= maxX) { vx *= -1; dvd.style.background = colors[Math.floor(Math.random() * colors.length)]; }
      if (y <= 0 || y >= maxY) { vy *= -1; dvd.style.background = colors[Math.floor(Math.random() * colors.length)]; }
      dvd.style.transform = `translate(${x}px, ${y}px)`;
      raf = requestAnimationFrame(step);
    };
    step();
    toast("Still deciding? The chef is judging you 👀");
  }
  ["pointermove", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, () => (dvd || timer) && stop(), { passive: true }));
  stop();
}

// ---------- easter eggs: Konami code or typing يلا ----------
export async function rainFaces(count = 24) {
  if (calm()) return toast("يلا بينا 🏃 (chill mode is on, so no rain)");
  const list = await getFaces();
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i++) {
    const d = document.createElement("div");
    d.className = "rain";
    d.style.left = `${Math.random() * 95}vw`;
    d.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    d.style.animationDelay = `${Math.random() * 1.5}s`;
    d.innerHTML = faceEl(list[i % (list.length || 1)], ["🍗", "🌯", "🍚", "🫕"][i % 4]);
    layer.append(d);
  }
  document.body.append(layer);
  sfx.win();
  setTimeout(() => layer.remove(), 6000);
}

function easterEggs() {
  const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let keys = [];
  let typed = "";
  addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, textarea")) return;
    keys = keys.concat(e.key).slice(-konami.length);
    typed = (typed + (e.key.length === 1 ? e.key : "")).slice(-3);
    if (keys.join() === konami.join() || typed === "يلا") {
      keys = [];
      typed = "";
      toast("🚨 SECRET MENU UNLOCKED 🚨 brainrot level: critical");
      rainFaces();
    }
  });
}

// ---------- boot ----------
export function initCommon() {
  document.documentElement.classList.toggle("chill-on", isChill());
  mountFloaters();
  googlyEyes();
  crumbTrail();
  guiltyTitle();
  rageClicks();
  idleDvd();
  easterEggs();
}

export const chefHtml = `
  <span class="chef" aria-hidden="true">
    <span class="chef__hat"></span>
    <span class="chef__eyes"><span class="eye"><span class="pupil"></span></span><span class="eye"><span class="pupil"></span></span></span>
    <span class="chef__mouth"></span>
  </span>`;
