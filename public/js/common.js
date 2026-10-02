// Shared helpers + global chaos (meme sounds, googly eyes, crumbs, rage clicks, idle DVD, live order toasts, easter eggs).

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
export { store };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const egp = (n) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- modes ----------
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isChill = () => store.get("zk_chill", false);
export const calm = () => isChill() || reducedMotion;
export const isTouch = () => window.matchMedia("(hover: none)").matches;

// ---------- API ----------
let wakeTimer = null;
let firstCall = true;

export async function api(path, options = {}) {
  if (firstCall) {
    firstCall = false;
    wakeTimer = setTimeout(showWaking, 1500);
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
  el.innerHTML = `<div><div class="waking__chef">👨‍🍳</div><h2>الشيف لسه صاحي… <br>Chef is waking up</h2><p>يسطا اصبر ثانية. No cap.</p></div>`;
  document.body.append(el);
}

let configPromise = null;
export const getConfig = () => (configPromise ||= api("/api/config"));
let dishesPromise = null;
export const getDishes = () => (dishesPromise ||= api("/api/dishes").catch(() => []));

// ---------- toasts ----------
export function toast(message, { error = false, ms = 3200, html = false, cls = "" } = {}) {
  let box = $(".toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.className = `toast${error ? " err" : ""} ${cls}`;
  if (html) t.innerHTML = message;
  else t.textContent = message;
  box.append(t);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

// ---------- meme sounds: real clips in /sounds + a few synthesized ones ----------
// Sound is ON by default and only the 🔊 button turns it off (رايق mode no longer mutes).
// Browsers only allow audio after the first click/tap, so nothing autoplays.
let ac = null;
export const soundOn = () => store.get("zk_sound", true);

// name -> file in public/sounds
export const CLIPS = {
  faah: ["faaah", "😱 FAAAH"],
  boom: ["vine-boom", "💥 Vine boom"],
  bruh: ["bruh", "😐 Bruh"],
  getout: ["get-out", "🚪 Get out!"],
  ka: ["apple-pay", "💳 Apple Pay"],
  ring: ["phone-ringing", "📱 Your phone ringing"],
  back: ["back-in-the-day", "👴 Back in the day"],
  sad: ["sad-violin", "🎻 Sad violin"],
  buzzer: ["wrong-buzzer", "❌ Wrong buzzer"],
  no: ["how-about-no", "🙅 How about no"],
  what: ["wait-what", "🤨 Wait what"],
  goofy: ["goofy-laugh", "🤪 Goofy laugh"],
  laugh: ["sitcom-laugh", "😂 Sitcom laugh"],
  cap: ["stop-the-cap", "🧢 Stop the cap"],
  sideeye: ["side-eye", "👀 Side eye"],
  care: ["we-do-not-care", "🤷 We do not care"],
  ahhh: ["ahhh", "😫 AHHHH"],
};
const clipCache = {};
function playClip(name, { loop = false, volume = 0.8 } = {}) {
  const base = (clipCache[name] ||= new Audio(`/sounds/${CLIPS[name][0]}.mp3`));
  const a = base.paused ? base : base.cloneNode();
  a.loop = loop;
  a.volume = volume;
  a.currentTime = 0;
  a.play().catch(() => {});
  return a;
}
const ctx = () => {
  ac ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === "suspended") ac.resume();
  return ac;
};

function tone({ type = "sine", from, to = from, dur = 0.2, at = 0, gain = 0.2, filter }) {
  const a = ctx();
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let node = osc;
  if (filter) {
    const f = a.createBiquadFilter();
    Object.assign(f, { type: filter.type });
    f.frequency.value = filter.freq;
    f.Q.value = filter.q || 1;
    osc.connect(f);
    node = f;
  }
  node.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise({ dur = 0.05, at = 0, gain = 0.3, highpass = 0 }) {
  const a = ctx();
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.max(1, a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  let node = src;
  if (highpass) {
    const f = a.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = highpass;
    src.connect(f);
    node = f;
  }
  node.connect(g).connect(a.destination);
  src.start(t);
}

// ---------- voice: pre-recorded natural Egyptian clips, else the best browser voice ----------
// Fixed lines live in /voice (generated by scripts/gen-voices.py with Microsoft neural voices).
// Everything else uses speechSynthesis, preferring natural/online ar-EG voices, split into
// sentences and queued so lines never cut each other off.
let voiceManifest = {};
fetch("/voice/manifest.json")
  .then((r) => (r.ok ? r.json() : {}))
  .then((m) => (voiceManifest = m))
  .catch(() => {});

let bestVoices = { ar: null, en: null };
function rankVoices() {
  const voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
  const natural = (v) => /online|natural|neural/i.test(v.name);
  const first = (...tests) => tests.map((t) => voices.find(t)).find(Boolean) || null;
  bestVoices = {
    ar: first(
      (v) => v.lang === "ar-EG" && natural(v),
      (v) => v.lang === "ar-EG",
      (v) => v.lang.startsWith("ar") && natural(v),
      (v) => /google/i.test(v.name) && v.lang.startsWith("ar"),
      (v) => v.lang.startsWith("ar"),
    ),
    en: first((v) => v.lang.startsWith("en") && natural(v), (v) => v.lang === "en-US"),
  };
}
if ("speechSynthesis" in window) {
  rankVoices();
  speechSynthesis.addEventListener?.("voiceschanged", rankVoices);
}

const speechQueue = [];
let speaking = false;
let currentClip = null;
let session = 0;

const sentences = (text) =>
  String(text)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .split(/(?<=[.!؟?،,…\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

function speakBrowser(text, { arabic, rate, pitch }) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const parts = sentences(text);
    if (!parts.length) return resolve();
    let left = parts.length;
    for (const part of parts) {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = arabic ? "ar-EG" : "en-US";
      const voice = arabic ? bestVoices.ar : bestVoices.en;
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      u.onend = u.onerror = () => --left === 0 && resolve();
      speechSynthesis.speak(u);
    }
  });
}

function playRecorded(file) {
  return new Promise((resolve) => {
    currentClip = new Audio(`/voice/${file}`);
    currentClip.onended = currentClip.onerror = () => resolve();
    currentClip.play().catch(() => resolve());
  });
}

async function drainSpeech() {
  if (speaking) return;
  speaking = true;
  while (speechQueue.length) {
    const job = speechQueue.shift();
    if (job.session !== session) continue;
    const file = voiceManifest[job.text];
    if (file) await playRecorded(file);
    else await speakBrowser(job.text, job);
    job.done();
  }
  speaking = false;
}

/** Stop whatever is being said and drop the queue (e.g. on hang-up). */
export function stopSpeaking() {
  session++;
  speechQueue.length = 0;
  currentClip?.pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/**
 * Say a line out loud. Returns a promise that resolves when it has finished.
 * Lines are queued (no interruptions); pass { interrupt: true } to cut in.
 */
export function say(text, { arabic = /[\u0600-\u06FF]/.test(text), rate = 0.92, pitch = 1, force = false, interrupt = false } = {}) {
  if (!soundOn() && !force) return Promise.resolve();
  if (interrupt) stopSpeaking();
  // Keep browser voices in a natural range even if callers ask for silly speeds
  const job = { text: String(text), arabic, rate: Math.min(1.1, Math.max(0.75, rate)), pitch: Math.min(1.4, Math.max(0.6, pitch)), session };
  const done = new Promise((resolve) => (job.done = resolve));
  speechQueue.push(job);
  drainSpeech();
  return done;
}

const SOUNDS = {
  pop: () => tone({ from: 600, to: 1400, dur: 0.08, gain: 0.25 }),
  sheesh: () => say("sheeeeeesh", { pitch: 1.2, rate: 0.5 }),
  ohno: () => [659, 659, 523, 440].forEach((f, i) => tone({ type: "square", from: f, dur: 0.15, at: i * 0.17, gain: 0.08 })),
  airhorn: () => [0, 0.33, 0.66].concat(1).forEach((at, i) =>
    [466, 470, 233].forEach((f) => tone({ type: "sawtooth", from: f, dur: i === 3 ? 0.8 : 0.25, at, gain: 0.07, filter: { type: "highpass", freq: 300 } })),
  ),
  error: () => playClip("buzzer", { volume: 0.5 }),
  pipe: () => { [520, 1347, 2210, 3390].forEach((f) => tone({ from: f, dur: 1.5, gain: 0.08 })); noise({ dur: 0.02, gain: 0.5 }); },
  tung: () => { [0, 0.25, 0.5].forEach((at) => tone({ from: 80, to: 50, dur: 0.3, at, gain: 0.8 })); setTimeout(() => say("tung tung tung sahur", { pitch: 0.3, rate: 0.8 }), 800); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: "square", from: f, dur: 0.12, at: i * 0.11, gain: 0.08 })),
  ashta: () => say(pick(["اشطا يا باشا", "عاش يا وحش", "فل الفل", "قشطة"]), { arabic: true, rate: 1.1 }),
};

export function play(name, opts) {
  if (!soundOn()) return null;
  try {
    if (CLIPS[name]) return playClip(name, opts);
    SOUNDS[name]?.();
  } catch {
    /* audio not available */
  }
  return null;
}
// Back-compat helpers used across pages
export const sfx = { add: () => play("pop"), error: () => play("error"), win: () => play("airhorn") };

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

// Adaptive photo: near-square photos fill the frame; very wide/tall ones show whole on a blurred copy.
export const fitImg = (url, alt = "") =>
  `<span class="fit"><img class="fit__bg" src="${esc(url)}" alt="" aria-hidden="true"><img class="fit__img" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" data-fit></span>`;
function smartFit(img) {
  const r = img.naturalWidth / img.naturalHeight;
  img.closest(".fit")?.classList.toggle("fit--contain", r > 1.3 || r < 0.77);
}
document.addEventListener("load", (e) => e.target.matches?.("img[data-fit]") && smartFit(e.target), true);

export const avatarHtml = (d, cls = "avatar") => (d?.photo_url ? `<img class="${cls}" src="${esc(d.photo_url)}" alt="">` : `<span class="${cls}">🍽️</span>`);

// ---------- floating controls (labeled so people know what they do) ----------
function mountFloaters() {
  const box = document.createElement("div");
  box.className = "floaters";
  box.innerHTML = `
    <button class="btn white chill-btn" type="button" aria-pressed="${isChill()}" title="Turns OFF the annoying stuff: runaway buttons, fake captchas, tip snapping, animations">
      😩 <span class="label"></span>
    </button>
    <button class="btn white sound-btn" type="button" aria-pressed="${soundOn()}" title="Meme sounds (FAAAH, vine boom, airhorn…) when you click stuff">
      <span class="label"></span>
    </button>`;
  document.body.append(box);
  const chillBtn = $(".chill-btn", box);
  const soundBtn = $(".sound-btn", box);
  const paint = () => {
    $(".label", chillBtn).innerHTML = isChill() ? "رايق mode ON <span class='long'>(chaos off)</span>" : "فكّك / I give up <span class='long'>(stop the chaos)</span>";
    $(".label", soundBtn).innerHTML = store.get("zk_sound", true) ? "🔊 <span class='long'>Sounds ON</span>" : "🔇 <span class='long'>Sounds OFF</span>";
    chillBtn.setAttribute("aria-pressed", isChill());
    soundBtn.setAttribute("aria-pressed", store.get("zk_sound", true));
  };
  paint();
  chillBtn.addEventListener("click", () => {
    const next = !isChill();
    store.set("zk_chill", next);
    document.documentElement.classList.toggle("chill-on", next);
    paint();
    toast(next ? "رايق mode: no more chaos. Weak, but valid 🫡 (sounds stay on, use 🔊 to mute)" : "Chaos is back. Good luck habibi 😈");
  });
  soundBtn.addEventListener("click", () => {
    store.set("zk_sound", !store.get("zk_sound", true));
    paint();
    if (soundOn()) play("boom");
  });
  if (!store.get("zk_seen_tip", false)) {
    store.set("zk_seen_tip", true);
    setTimeout(() => toast("💡 Tip: 😩 = stop the chaos · 🔊 = meme sounds. Type يلا for a secret 🤫", { ms: 6000 }), 1500);
  }
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
    $(".chef")?.classList.toggle("angry", Boolean(e.target.closest?.("[data-scary]")));
  });
}

// ---------- food crumb cursor trail ----------
function crumbTrail() {
  if (isTouch()) return;
  const crumbs = ["🍗", "🌶️", "🧆", "🍚", "🌯", "🥙", "🫘"];
  let last = 0;
  document.addEventListener("pointermove", (e) => {
    if (calm() || Date.now() - last < 70) return;
    last = Date.now();
    const s = document.createElement("span");
    s.className = "trail";
    s.textContent = pick(crumbs);
    s.style.left = `${e.clientX + 8}px`;
    s.style.top = `${e.clientY + 8}px`;
    document.body.append(s);
    setTimeout(() => s.remove(), 900);
  });
}

// ---------- tab title guilt trip ----------
function guiltyTitle() {
  const original = document.title;
  const lines = ["😭 طلبك بيبرد / Your food is getting cold", "👀 ارجع يا جدع", "🍗 the mandi misses you", "💀 left on read by a kebab"];
  document.addEventListener("visibilitychange", () => {
    document.title = document.hidden ? pick(lines) : original;
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
      toast(pick(["اهدى habibi 😤 the clicks won't make it faster", "crash out detected 🚨", "يسطا اتقل شوية 🧘"]));
      play("faah");
    }
  });
}

const faceEl = (url, fallback = "🍗") => (url ? `<img src="${esc(url)}" alt="">` : fallback);

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
    timer = setTimeout(start, 15_000);
  };
  async function start() {
    if (calm() || document.hidden) return stop();
    const faces = (await getDishes()).map((d) => d.photo_url).filter(Boolean);
    dvd = document.createElement("div");
    dvd.className = "dvd";
    dvd.setAttribute("aria-hidden", "true");
    dvd.innerHTML = faceEl(faces.length ? pick(faces) : null, "👨‍🍳");
    document.body.append(dvd);
    let x = 40, y = 40, vx = 2.2, vy = 1.8;
    const colors = ["#ffc700", "#ff69b4", "#8ace00", "#fa4b13", "#ff3b30"];
    const step = () => {
      const maxX = innerWidth - 90, maxY = innerHeight - 90;
      x += vx;
      y += vy;
      if (x <= 0 || x >= maxX) { vx *= -1; dvd.style.background = pick(colors); }
      if (y <= 0 || y >= maxY) { vy *= -1; dvd.style.background = pick(colors); }
      dvd.style.transform = `translate(${x}px, ${y}px)`;
      raf = requestAnimationFrame(step);
    };
    step();
    toast("قفلت؟ Still deciding? The chef is judging you 👀");
  }
  ["pointermove", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, () => (dvd || timer) && stop(), { passive: true }));
  stop();
}

// ---------- fake live order notifications ----------
const FAKE_PEOPLE = ["Hossam from Accounting", "Mona from HR", "the intern", "your manager", "Karim (on mute)", "Nour from Sales", "IT guy who never answers", "الأستاذ ممدوح", "unc from Finance", "someone who left 2 years ago"];
function liveOrders() {
  const tick = async () => {
    setTimeout(tick, 25_000 + Math.random() * 25_000);
    if (calm() || document.hidden) return;
    const dishes = (await getDishes()).filter((d) => !d.badges.includes("sold_out"));
    if (!dishes.length) return;
    const d = pick(dishes);
    const size = pick(["ربع", "نص", "عيلة", "كامل"]);
    const line = pick([
      `بيقولك <b>${pick(FAKE_PEOPLE)}</b> just ordered <b dir="auto">${esc(d.name_ar)}</b> (${size})`,
      `🔥 ${3 + Math.floor(Math.random() * 20)} people are looking at <b dir="auto">${esc(d.name_ar)}</b> right now`,
      `<b>${pick(FAKE_PEOPLE)}</b> left a 1🌶️ review on <b dir="auto">${esc(d.name_ar)}</b>. Crash out.`,
    ]);
    toast(`${avatarHtml(d)}<span>${line}</span>`, { html: true, cls: "live", ms: 5000 });
  };
  setTimeout(tick, 12_000);
}

// ---------- easter eggs: Konami code, typing يلا / tung / unc ----------
export async function rainFaces(count = 24) {
  if (calm()) return toast("يلا بينا 🏃 (رايق mode is on, so no rain)");
  const faces = (await getDishes()).map((d) => d.photo_url).filter(Boolean);
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  layer.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i++) {
    const d = document.createElement("div");
    d.className = "rain";
    d.style.left = `${Math.random() * 95}vw`;
    d.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    d.style.animationDelay = `${Math.random() * 1.5}s`;
    d.innerHTML = faceEl(faces.length ? faces[i % faces.length] : null, ["🍗", "🌯", "🍚", "🫕"][i % 4]);
    layer.append(d);
  }
  document.body.append(layer);
  play("airhorn");
  setTimeout(() => layer.remove(), 6000);
}

export function toggleUnc() {
  const next = !document.documentElement.classList.contains("unc-on");
  document.documentElement.classList.toggle("unc-on", next);
  store.set("zk_unc", next);
  if (next) {
    play("back");
    toast("👴 Unc mode: صباح الخير 🌹 Comic Sans activated");
  }
}

function easterEggs() {
  const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let keys = [];
  let typed = "";
  addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, textarea")) return;
    keys = keys.concat(e.key).slice(-konami.length);
    typed = (typed + (e.key.length === 1 ? e.key.toLowerCase() : "")).slice(-6);
    if (keys.join() === konami.join() || typed.endsWith("يلا")) {
      keys = [];
      typed = "";
      toast("🚨 SECRET MENU UNLOCKED 🚨 brainrot level: critical");
      rainFaces();
    } else if (typed.endsWith("tung")) {
      typed = "";
      play("tung");
      toast("🥁 tung tung tung sahur");
    } else if (typed.endsWith("unc")) {
      typed = "";
      toggleUnc();
    } else if (typed.endsWith("67")) {
      typed = "";
      toast("6️⃣7️⃣ 6️⃣7️⃣ 6️⃣7️⃣");
      play("boom");
    }
  });
}

// ---------- boot ----------
export function initCommon() {
  document.documentElement.classList.toggle("chill-on", isChill());
  document.documentElement.classList.toggle("unc-on", store.get("zk_unc", false));
  const unc = document.createElement("div");
  unc.className = "unc";
  unc.textContent = "🌹 صباح الخير · جمعة مباركة · Good Morning 🌹☕ (unc mode: type unc again to exit)";
  document.body.prepend(unc);
  mountFloaters();
  googlyEyes();
  crumbTrail();
  guiltyTitle();
  rageClicks();
  idleDvd();
  liveOrders();
  easterEggs();
}

export const chefHtml = `
  <span class="chef" aria-hidden="true">
    <span class="chef__hat"></span>
    <span class="chef__eyes"><span class="eye"><span class="pupil"></span></span><span class="eye"><span class="pupil"></span></span></span>
    <span class="chef__mouth"></span>
  </span>`;
