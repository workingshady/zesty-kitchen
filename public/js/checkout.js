// Chaos checkout: one annoyance per step, each gives up after 2–3 tries. رايق (chill) mode makes everything trivial.
// Server contract: POST /api/orders { customer_name, items:[{dish_id,size,addons,qty}], payment_method: vibes|insults|owe_lunch, note }
// The phone number never leaves this page.
import {
  $, $$, api, esc, egp, toast, play, calm, pick, sleep, getConfig, getDishes, initCommon, chefHtml,
  getCart, saveCart, feesFor, avatarHtml, fitImg, linePrice, lineKey, addToCart,
} from "./common.js";

const STEPS = [
  ["🛒", "Cart", "السلة"], ["👤", "You", "إنت"], ["⏰", "Time", "الميعاد"], ["🤖", "Captcha", "روبوت؟"],
  ["💸", "Tip", "البقشيش"], ["💳", "Pay", "الدفع"], ["🚀", "Order", "يلا"],
];
const order = { customer_name: "", note: "", payment_method: "" };
// Everything else the user picks. Only a short text version of it goes into the note.
const extra = {
  chips: [], floor: "2nd floor", spot: "💻 My desk", desk: "", phone: "", cutlery: false, noDrama: false,
  eta: null, tip: "67% 6️⃣7️⃣", splits: ["HR"], fancy: null, compliment: "", promo: null, prize: null,
};
let config;
let dishes = [];
const dishMap = new Map();
let current = 0;
let hrPrank = false;

// ---------- small helpers ----------
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const subtotalOf = (cart) => Math.round(cart.reduce((s, l) => s + l.unit_price * l.qty, 0) * 100) / 100;
const catEmoji = (d) => config.categories?.find((c) => c.slug === d?.category)?.emoji || "🍽️";
const photoOf = (l) => dishMap.get(l.dish_id)?.photo_url ?? l.photo_url ?? null;
const vibrate = (p) => {
  try {
    if (!calm()) navigator.vibrate?.(p);
  } catch {
    /* not supported */
  }
};
const orderable = () => dishes.filter((d) => !d.badges?.includes("sold_out") && d.category !== "expired");

function announce(text) {
  const el = $("#live");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = text));
}

function shakeEl(el) {
  if (!el || calm()) return;
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

// Lightweight emoji burst: ~36 spans, transform/opacity only, one rAF loop, removed when done.
// Replaces js-confetti's full-screen canvas, which redrew 90 emoji glyphs per frame and stuttered.
function emojiBurst(origin, emojis = ["🍗", "🌯", "🍚", "🌶️", "🍋", "💅", "🫘"], count = 36) {
  if (calm()) return;
  const r = origin?.getBoundingClientRect?.();
  const layer = document.createElement("div");
  layer.className = "burst";
  layer.setAttribute("aria-hidden", "true");
  layer.style.left = `${r ? r.left + r.width / 2 : innerWidth / 2}px`;
  layer.style.top = `${r ? r.top + r.height / 2 : innerHeight / 2}px`;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.textContent = emojis[i % emojis.length];
    layer.append(el);
    const a = Math.random() * Math.PI * 2;
    const v = 5 + Math.random() * 9;
    parts.push({ el, x: 0, y: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, rot: Math.random() * 360, vr: (Math.random() - 0.5) * 18, s: 0.7 + Math.random() * 0.7 });
  }
  document.body.append(layer);
  const t0 = performance.now();
  const D = 1500;
  let last = t0;
  const frame = (t) => {
    const dt = Math.min(3, (t - last) / 16.67);
    last = t;
    const k = (t - t0) / D;
    const fade = k > 0.6 ? Math.max(0, 1 - (k - 0.6) / 0.4) : 1;
    for (const p of parts) {
      p.vy += 0.42 * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0) rotate(${p.rot.toFixed(0)}deg) scale(${p.s})`;
      p.el.style.opacity = fade;
    }
    if (k < 1) requestAnimationFrame(frame);
    else layer.remove();
  };
  requestAnimationFrame(frame);
}

// ---------- progress + summary ----------
function renderSteps() {
  $("#steps").innerHTML = STEPS.map(([emoji, en, ar], i) => {
    const state = i < current ? "done" : i === current ? "now" : "";
    const inner = `<span class="st__dot" aria-hidden="true">${i < current ? "✅" : emoji}</span><span class="st__label">${en}<small>${ar}</small></span><span class="cap-sr">Step ${i + 1}: ${en}${i < current ? " (done)" : i === current ? " (current)" : ""}</span>`;
    return `<li class="${state}" ${i === current ? 'aria-current="step"' : ""}>${i < current ? `<button type="button" data-go="${i}">${inner}</button>` : `<span>${inner}</span>`}</li>`;
  }).join("");
  $("#steps").style.setProperty("--pct", `${(current / (STEPS.length - 1)) * 100}%`);
  $("#step-now").textContent = `Step ${current + 1}/${STEPS.length} · ${STEPS[current][0]} ${STEPS[current][1]} / ${STEPS[current][2]}`;
}

const FEE_WHY = [
  "Charged in case the delivery guy makes eye contact. Avoiding eye contact would cost extra, we waived that. You're welcome.",
  "14% for the silent elevator ride with the delivery guy. It felt like 14 minutes.",
  "HR delivers it personally and adds a little note to your file. 📁",
  "You lose 67 aura for eating your coworkers. Paid in aura, not money.",
  "0.01 EGP so the chef can afford therapy. Every piaster counts 🥲",
];

function renderSummary() {
  const cart = getCart();
  const box = $("#summary");
  const count = cart.reduce((n, l) => n + l.qty, 0);
  if (!cart.length) {
    box.innerHTML = "<p>Empty. Like the fridge on Thursday. 🦗</p>";
    $("#sum-head").textContent = "🧾 Your order · empty";
    return;
  }
  const sub = subtotalOf(cart);
  const { fees, total } = feesFor(sub);
  const shown = hrPrank ? total * 2 : total;
  const promo = extra.promo
    ? `<div class="sum-promo"><span>🎟️ ${esc(extra.promo.code)}</span><span>${esc(extra.promo.label)}</span></div>`
    : "";
  const info = [
    extra.eta && ["⏰", `~${extra.eta} min (allegedly)`],
    order.customer_name && ["👤", order.customer_name],
    current >= 2 && ["📍", `${extra.floor} · ${extra.spot}`],
    current >= 5 && ["💸", `Tip ${extra.tip} (not charged)`],
    extra.fancy && ["💳", extra.fancy],
  ].filter(Boolean);
  box.innerHTML = `<ul class="sum-lines">${cart
    .map((l) => {
      const addons = l.addons.map((a) => config.addons[a]?.ar || a).join("، ");
      return `<li>${avatarHtml({ photo_url: photoOf(l) }, "avatar sum-thumb")}<span dir="auto"><b>${l.qty}× ${esc(l.name_ar)}</b><small>${esc(config.sizes[l.size]?.ar || l.size)}${addons ? ` + ${esc(addons)}` : ""}</small></span><b class="sum-price">${egp(l.unit_price * l.qty)}</b></li>`;
    })
    .join("")}</ul>
    <div class="totals sum-totals">
      <div><span>Subtotal / المجموع</span><span>${egp(sub)}</span></div>
      ${fees
        .map(([ar, en, amt], i) => `<details class="fee"><summary><span>${esc(en)} <span class="fee__q" aria-hidden="true">ⓘ</span><small dir="auto">${esc(ar)}</small></span><span>${amt === 0 ? "−67 aura" : egp(amt)}</span></summary><p>${FEE_WHY[i] || "Don't ask. HR said so."}</p></details>`)
        .join("")}
      ${promo}
      <div class="grand ${hrPrank ? "sum-hr" : ""}"><span>Total / الإجمالي${hrPrank ? " 📈 HR rate" : ""}</span><span>${egp(Math.round(shown * 100) / 100)}</span></div>
    </div>
    ${info.length ? `<ul class="sum-info">${info.map(([e, t]) => `<li><span aria-hidden="true">${e}</span><span dir="auto">${esc(t)}</span></li>`).join("")}</ul>` : ""}
    <p class="sum-foot">🧾 No real money. Ever. Fees are jokes, tap ⓘ to see why.</p>`;
  $("#sum-head").innerHTML = `🧾 طلبك · ${count} item${count === 1 ? "" : "s"} · <b>${egp(Math.round(shown * 100) / 100)}</b>`;
}

function go(i) {
  current = i;
  renderSteps();
  renderSummary();
  STEP_FNS[i]();
  $("#step h2")?.focus({ preventScroll: true });
  scrollTo({ top: 0 });
  announce(`Step ${i + 1} of ${STEPS.length}: ${STEPS[i][1]}`);
  play("pop");
}

const panel = (title, body, actions = "") => {
  $("#step").innerHTML = `<section class="panel co-panel"><h2 tabindex="-1">${title}</h2>${body}<div class="panel__actions">${actions}</div></section>`;
};
const backBtn = () => (current > 0 ? `<button class="btn white" type="button" id="back">← Back</button>` : `<a class="btn white" href="/">← Menu</a>`);
const bindBack = () => $("#back")?.addEventListener("click", () => go(current - 1));
const nextBtn = (label = "Continue →") => `<button class="btn red big" type="button" id="next">${label}<kbd class="co-kbd" aria-hidden="true">↵</kbd></button>`;

// ---------- 1. Cart ----------
let plusTrolled = false;
let dramaTries = 0;
const regretKcal = (cart) =>
  cart.reduce((s, l) => s + l.qty * Math.round((config.sizes[l.size]?.mult || 1) * (380 + (hash(l.dish_id) % 420)) + l.addons.length * 67), 0);

function picHtml(d, l) {
  const url = d?.photo_url ?? l?.photo_url;
  const name = d?.name_ar || l?.name_ar || "";
  return url ? fitImg(url, name) : `<span class="co-emoji" aria-hidden="true">${catEmoji(d)}</span>`;
}

function upsellHtml(cart) {
  const inCart = new Set(cart.map((l) => l.dish_id));
  const pool = orderable().filter((d) => !inCart.has(d.id));
  if (!pool.length) return "";
  const first = cart[0] && dishMap.get(cart[0].dish_id);
  const sameCat = first ? pool.filter((d) => d.category === first.category) : [];
  const picks = shuffle(sameCat).concat(shuffle(pool.filter((d) => !sameCat.includes(d)))).slice(0, 4);
  const who = cart[0] ? `<span dir="auto">${esc(cart[0].name_ar)}</span>` : "nothing";
  return `<section class="upsell" aria-label="Suggestions">
    <h3>👀 People who ordered ${who} also ordered…</h3>
    <div class="upsell__row">${picks
      .map(
        (d) => `<div class="upsell__card"><span class="upsell__pic">${picHtml(d)}</span><b dir="auto">${esc(d.name_ar)}</b><small>${rand(51, 97)}% of coworkers · ${egp(d.price)}</small>
        <button class="btn slime" type="button" data-up="${esc(d.id)}" aria-label="Add ${esc(d.name_ar)} to the order">+ Add</button></div>`,
      )
      .join("")}</div></section>`;
}

const PROMOS = {
  "67": { label: "−6.7% (emotionally, not financially)", toast: "6️⃣7️⃣ code accepted! 6.7% off… your feelings. Prices unchanged 💅", sound: "chaching" },
  "فكك": { label: "0% off. فكّك منه", toast: "كود فكّك: 0% off. It's the thought that counts 🫠", sound: "care" },
  "HR": { label: "HR rate applied (temporarily) 📈", toast: "HR code detected. Prices DOUBLED 📈😱", sound: "ohno" },
};

function stepCart() {
  const cart = getCart();
  if (!cart.length) {
    panel("Your cart is empty 🦗", `<p>Delulu checkout. Go order a coworker first.</p>${upsellHtml([])}`, `<a class="btn red" href="/">← Back to menu</a>`);
    bindCart();
    return;
  }
  const kcal = regretKcal(cart);
  panel(
    "🛒 راجع طلبك / Check your order",
    `<div class="co-lines">${cart
      .map((l, i) => {
        const d = dishMap.get(l.dish_id);
        const addons = Object.entries(config.addons)
          .map(([k, a]) => `<label class="mini-chip"><input type="checkbox" data-addon="${esc(k)}" data-i="${i}" ${l.addons.includes(k) ? "checked" : ""} ${a.available ? "" : "disabled"}><span dir="auto">${esc(a.ar)} <small>${a.available ? (a.price ? `+${a.price}` : "free") : "sold out forever 💀"}</small></span></label>`)
          .join("");
        return `<article class="co-line">
          <span class="co-line__pic">${picHtml(d, l)}</span>
          <div class="co-line__body">
            <div class="co-line__top"><span><strong dir="auto">${esc(l.name_ar)}</strong>${l.name_en ? `<small>${esc(l.name_en)}</small>` : ""}</span><b class="co-line__price">${egp(l.unit_price * l.qty)}</b></div>
            <div class="co-line__ctl">
              <label><span class="cap-sr">Size for ${esc(l.name_ar)}</span><select class="co-select" data-size data-i="${i}">${Object.entries(config.sizes)
                .map(([k, s]) => `<option value="${esc(k)}" ${k === l.size ? "selected" : ""}>${esc(s.ar)} · ${esc(s.en)}</option>`)
                .join("")}</select></label>
              <div class="stepper"><button type="button" data-i="${i}" data-q="-1" aria-label="One less ${esc(l.name_ar)}">−</button><output aria-live="polite">${l.qty}</output><button type="button" data-i="${i}" data-q="1" aria-label="One more ${esc(l.name_ar)}">+</button></div>
              <button class="tiny-link" type="button" data-del="${i}">🗑️ remove</button>
            </div>
            <details class="co-addons" ${l.addons.length ? "open" : ""}><summary>➕ Add-ons${l.addons.length ? ` (${l.addons.length})` : ""}</summary><div class="mini-chips">${addons}</div></details>
          </div>
        </article>`;
      })
      .join("")}</div>
    <p class="regret">🔥 <b>${kcal.toLocaleString("en-US")} kcal of regret</b> · ≈ ${Math.max(1, Math.round(kcal / 150))} flights of stairs to the HR office</p>
    <div class="co-toggles">
      <label class="check-row"><input type="checkbox" id="cutlery" ${extra.cutlery ? "checked" : ""}><span><b>🍴 Send cutlery / معالق</b><br><small>Or eat with your hands like a real one</small></span></label>
      <label class="check-row"><input type="checkbox" id="nodrama" ${extra.noDrama ? "checked" : ""}><span><b>🧘 No drama / بدون دراما</b><br><small>Subject to availability (it's never available)</small></span></label>
    </div>
    <form class="promo" id="promo" autocomplete="off">
      <label for="promo-in">🎟️ Promo code / كود خصم</label>
      <div class="promo__row"><input id="promo-in" maxlength="20" dir="auto" placeholder="try 67, فكك or HR" data-no-enter><button class="btn white" type="submit">Apply</button></div>
      <p class="co-hint" id="promo-msg" aria-live="polite">${extra.promo ? `Applied: ${esc(extra.promo.code)} → ${esc(extra.promo.label)}` : ""}</p>
    </form>
    ${upsellHtml(cart)}`,
    `${backBtn()}${nextBtn()}`,
  );
  bindCart();
}

function rerenderCart(focusSel) {
  stepCart();
  if (focusSel) $(focusSel)?.focus();
}

function updateLine(i, patch) {
  const cart = getCart();
  const l = cart[i];
  if (!l) return;
  Object.assign(l, patch);
  const d = dishMap.get(l.dish_id);
  if (d) l.unit_price = linePrice(config, d.price, l.size, l.addons);
  l.key = lineKey(l.dish_id, l.size, l.addons);
  const dup = cart.findIndex((o, j) => j !== i && o.key === l.key);
  if (dup >= 0) {
    cart[dup].qty = Math.min(9, cart[dup].qty + l.qty);
    cart.splice(i, 1);
    toast("Merged with the identical line. Efficiency 📈");
  }
  saveCart(cart);
}

function bindCart() {
  const p = $(".panel");
  p.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.q) {
      const i = Number(t.dataset.i);
      const cart = getCart();
      const line = cart[i];
      let delta = Number(t.dataset.q);
      if (delta > 0 && !plusTrolled && !calm()) {
        plusTrolled = true;
        delta = -1;
        toast("Oops, the + button is left-handed. Try again 🙃");
        play("what");
      }
      line.qty = Math.min(9, Math.max(1, line.qty + delta));
      saveCart(cart);
      rerenderCart(`[data-i="${i}"][data-q="${t.dataset.q}"]`);
    } else if (t.dataset.del) {
      const cart = getCart();
      const [gone] = cart.splice(Number(t.dataset.del), 1);
      saveCart(cart);
      toast(`${gone?.name_ar || "They"} removed. They'll remember this 😶`);
      play("remove");
      rerenderCart("#next");
    } else if (t.dataset.up) {
      const d = dishMap.get(t.dataset.up);
      if (!d) return;
      addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size: "half", addons: [], qty: 1, unit_price: linePrice(config, d.price, "half", []) });
      toast(`${d.name_ar} joined the order. Peer pressure works 🫡`);
      play("add");
      emojiBurst(t, ["➕", "🍗", "✨"], 10);
      rerenderCart("#next");
    }
  });
  p.addEventListener("change", (e) => {
    const t = e.target;
    const i = Number(t.dataset.i);
    if (t.matches("[data-size]")) {
      updateLine(i, { size: t.value });
      rerenderCart(`[data-size][data-i="${i}"]`);
    } else if (t.matches("[data-addon]")) {
      const cart = getCart();
      const set = new Set(cart[i].addons);
      t.checked ? set.add(t.dataset.addon) : set.delete(t.dataset.addon);
      updateLine(i, { addons: [...set] });
      rerenderCart(`[data-addon="${t.dataset.addon}"][data-i="${i}"]`);
    } else if (t.id === "cutlery") {
      extra.cutlery = t.checked;
      if (t.checked) toast("Cutlery added. Plastic. Like the office friendships 🍴");
    } else if (t.id === "nodrama") {
      if (t.checked && !calm() && ++dramaTries < 3) {
        t.checked = false;
        toast(dramaTries === 1 ? "بدون دراما is sold out. It always is 💀" : "Still no. The drama is load-bearing 🏗️ (one more try…)");
        play(dramaTries === 1 ? "no" : "sideeye");
        return;
      }
      extra.noDrama = t.checked;
      if (t.checked) toast("Fine. We'll TRY. No promises 🧘");
    }
  });
  $("#promo")?.addEventListener("submit", (e) => {
    e.preventDefault();
    applyPromo($("#promo-in").value);
  });
  $("#next")?.addEventListener("click", () => go(1));
}

function applyPromo(raw) {
  const code = norm(raw).toUpperCase().replace(/\s/g, "");
  const msg = $("#promo-msg");
  if (!code) return (msg.textContent = "Type a code first. Even a fake one 🙄");
  const p = PROMOS[code];
  if (!p) {
    msg.textContent = /FREE|ZESTY|100/.test(code) ? "Nice try 🧢 free food is not a thing here." : `"${raw.trim()}" is not a code. Skill issue 💀 (psst: 67, فكك, HR)`;
    play(/FREE|ZESTY|100/.test(code) ? "cap" : "nope");
    return;
  }
  extra.promo = { code, label: p.label };
  msg.textContent = `Applied: ${code} → ${p.label}`;
  toast(p.toast);
  play(p.sound);
  if (code === "HR") {
    hrPrank = true;
    renderSummary();
    setTimeout(() => {
      hrPrank = false;
      extra.promo = { code, label: "Reverted. HR can't do that. Yet." };
      renderSummary();
      toast("jk 😅 HR can't double prices. Yet. Reverted.");
      if ($("#promo-msg")) $("#promo-msg").textContent = "HR code reverted. You're safe… for now.";
    }, calm() ? 600 : 2500);
  } else {
    if (code === "67") emojiBurst($("#promo-in"), ["6️⃣", "7️⃣"], 14);
    renderSummary();
  }
}

// ---------- 2. You ----------
const NOTE_CHIPS = ["🧅 no onions", "🧘 no drama", "🙄 extra sarcasm", "📁 leave at HR", "🤫 don't tell my manager", "🌶️ spicy (emotionally)"];
const FLOORS = ["Ground", "1st floor", "2nd floor", "3rd floor", "🏚️ Roof"];
const SPOTS = ["💻 My desk", "🗣️ Meeting room 2", "☕ The kitchen", "🪑 Under the boss's desk", "📁 HR office", "🛗 Throw it in the elevator"];

function radioChips(name, list, chosen, label) {
  return `<div class="qchips" role="radiogroup" aria-label="${label}">${list
    .map((v) => `<label class="qchip"><input type="radio" name="${name}" value="${esc(v)}" ${v === chosen ? "checked" : ""}><span>${esc(v)}</span></label>`)
    .join("")}</div>`;
}

function stepYou() {
  let shuffles = 0;
  let presses = 0;
  let digits = extra.phone;
  const MAX_SHUFFLES = 4;
  panel(
    "👤 مين هياكل؟ / Who's eating?",
    `<label class="field">Your name / اسمك <input id="name" maxlength="40" dir="auto" value="${esc(order.customer_name)}" autocomplete="nickname" placeholder="e.g. Unc Hossam" required></label>
     <fieldset class="co-fs"><legend>📝 Note for the kitchen <small>(tap chips, optional)</small></legend>
       <div class="qchips">${NOTE_CHIPS.map((c) => `<button type="button" class="qchip qchip--btn" aria-pressed="${extra.chips.includes(c)}" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>
       <label class="field"><span class="cap-sr">Extra note</span><textarea id="note" maxlength="120" rows="2" dir="auto" placeholder="anything else? (max 120)">${esc(order.note)}</textarea></label>
     </fieldset>
     <fieldset class="co-fs"><legend>📍 Deliver to / التوصيل لفين</legend>
       ${radioChips("floor", FLOORS, extra.floor, "Floor")}
       ${radioChips("spot", SPOTS, extra.spot, "Spot")}
       <label class="field">Landmark (optional) <input id="desk" maxlength="40" dir="auto" value="${esc(extra.desk)}" placeholder="next to the printer that never works"></label>
     </fieldset>
     <fieldset class="co-fs"><legend>📱 Phone <small>(optional · never saved, never sent 🤫)</small></legend>
       <div class="phone-display" id="phone" tabindex="0" role="textbox" aria-label="Phone number. Type digits or use the keypad" aria-live="polite" data-no-enter></div>
       <p class="co-hint" id="kp-hint">${calm() ? "Normal keypad. رايق mode 🫶" : "Our keypad is… creative. It reshuffles after every tap 🔀"}</p>
       <div class="keypad" id="keypad"></div>
     </fieldset>`,
    `${backBtn()}${nextBtn()}`,
  );
  bindBack();
  const phone = $("#phone");
  const show = () => {
    const shown = `01${digits}`.padEnd(11, "_");
    phone.textContent = `${shown.slice(0, 3)} ${shown.slice(3, 7)} ${shown.slice(7)}`;
    phone.setAttribute("aria-label", `Phone number: ${digits ? `01${digits}` : "empty"}. Type digits or use the keypad`);
  };
  const drawPad = () => {
    const order10 = calm() || shuffles >= MAX_SHUFFLES ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] : shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    $("#keypad").innerHTML =
      order10.map((n) => `<button type="button" class="kp" data-k="${n}" aria-label="${n}">${n}<small aria-hidden="true">${"٠١٢٣٤٥٦٧٨٩"[n]}</small></button>`).join("") +
      `<button type="button" class="kp kp--x" data-k="back" aria-label="Delete last digit">⌫</button><button type="button" class="kp kp--x" data-k="clear" aria-label="Clear phone">🧹</button>`;
  };
  const press = (k, fromPad) => {
    if (k === "back") digits = digits.slice(0, -1);
    else if (k === "clear") digits = "";
    else if (digits.length < 9) digits += k;
    else return toast("That's 11 digits already. Egypt only has so many 🇪🇬");
    extra.phone = digits;
    show();
    if (!fromPad || calm()) return;
    presses++;
    if (shuffles < MAX_SHUFFLES) {
      shuffles++;
      drawPad();
      if (shuffles === MAX_SHUFFLES) {
        $("#kp-hint").textContent = "The keypad got dizzy 😵 It's normal now. You win.";
        toast("Keypad gave up. Normal order restored 🫡");
        play("goofy");
      }
    }
    const k2 = $(`#keypad [data-k="${k}"]`);
    (k2 || $("#keypad .kp"))?.focus();
  };
  drawPad();
  show();
  $("#keypad").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (b) press(b.dataset.k, true);
  });
  phone.addEventListener("keydown", (e) => {
    const k = e.key.replace(/[٠-٩]/, (c) => c.charCodeAt(0) - 0x0660);
    if (/^\d$/.test(k)) press(k, false);
    else if (e.key === "Backspace") press("back", false);
    else return;
    e.preventDefault();
  });
  $(".panel").addEventListener("click", (e) => {
    const c = e.target.closest("[data-chip]");
    if (!c) return;
    const on = c.getAttribute("aria-pressed") !== "true";
    c.setAttribute("aria-pressed", String(on));
    extra.chips = on ? [...extra.chips, c.dataset.chip] : extra.chips.filter((x) => x !== c.dataset.chip);
    if (on && c.dataset.chip.includes("HR")) play("sideeye");
  });
  $(".panel").addEventListener("change", (e) => {
    if (e.target.name === "floor") extra.floor = e.target.value;
    if (e.target.name === "spot") {
      extra.spot = e.target.value;
      if (/boss/.test(extra.spot)) {
        toast("Under the boss's desk. Bold. Respect 🫡");
        play("sideeye");
      } else if (/elevator/.test(extra.spot)) toast("It'll arrive on a random floor. Like your career 🛗");
    }
  });
  $("#next").addEventListener("click", () => {
    const name = $("#name").value.trim();
    if (!name) {
      play("faah");
      $("#name").focus();
      shakeEl($("#name"));
      return toast("skill issue: we need a name 😤", { error: true });
    }
    if (digits && digits.length < 9) toast(`Half a phone number? We'll call half of you 📵 (${9 - digits.length} digits missing, we don't need it anyway)`);
    order.customer_name = name;
    order.note = $("#note").value.trim();
    extra.desk = $("#desk").value.trim();
    go(2);
  });
}

// ---------- 3. Time: higher/lower, 4 guesses max ----------
const HEAT = [
  [0, "🎯", "BULLSEYE"],
  [5, "🌋", "Burning! Basically there"],
  [15, "🔥", "Hot hot hot"],
  [30, "🌤️", "Warm-ish"],
  [60, "❄️", "Cold"],
  [999, "🥶", "Freezing. Antarctica called"],
];
function stepTime() {
  const target = rand(5, 120);
  const MAX = 4;
  let guess = 60;
  let tries = 0;
  const history = [];
  const QUICK = [
    ["⚡ ASAP", 10, "ASAP? In this economy? Set to 10."],
    ["🍽️ After lunch", 90, "After lunch it is (90). Food coma pending."],
    ["6️⃣7️⃣ 6–7 min", 7, "6… 7… we'll take 7 🤷"],
    ["💀 Never", 180, "'Never' isn't an option. 180 is the max delulu."],
  ];
  panel(
    "⏰ ميعاد التوصيل / Delivery time",
    `<p>We already picked your delivery time. Guess it 🎯 <b>Minutes, 1–180.</b> You get ${MAX} tries, then we just tell you.</p>
     <div class="qchips" aria-label="Quick picks">${QUICK.map(([l, v], i) => `<button type="button" class="qchip qchip--btn" data-quick="${i}">${l}</button>`).join("")}</div>
     <div class="time-game">
       <div class="guess-row">
         <button class="btn white" type="button" data-g="-10" aria-label="Minus 10 minutes">−10</button><button class="btn white" type="button" data-g="-1" aria-label="Minus 1 minute">−1</button>
         <output class="guess" id="guess">${guess}<small>min</small></output>
         <button class="btn white" type="button" data-g="1" aria-label="Plus 1 minute">+1</button><button class="btn white" type="button" data-g="10" aria-label="Plus 10 minutes">+10</button>
       </div>
       <div class="thermo" aria-hidden="true"><span class="thermo__fill" id="thermo"></span><span class="thermo__bulb" id="bulb">🌡️</span></div>
       <p id="heat" class="heat" aria-live="polite">Lock in a guess to see how hot you are</p>
       <p class="tries">Attempts left: <b id="left">${MAX}</b> <span id="hearts" aria-hidden="true">${"❤️".repeat(MAX)}</span></p>
       <ol class="ghist" id="ghist" aria-label="Your guesses"></ol>
     </div>`,
    `${backBtn()}${nextBtn("Lock it in 🔒")}`,
  );
  bindBack();
  const setGuess = (v) => {
    guess = Math.min(180, Math.max(1, v));
    $("#guess").innerHTML = `${guess}<small>min</small>`;
  };
  $(".panel").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.g) setGuess(guess + Number(b.dataset.g));
    if (b.dataset.quick) {
      const [, v, line] = QUICK[Number(b.dataset.quick)];
      setGuess(v);
      toast(line);
    }
  });
  $("#next").addEventListener("click", () => {
    tries++;
    const dist = Math.abs(guess - target);
    const [, icon, label] = HEAT.find(([max]) => dist <= max);
    const dir = guess < target ? "⬆️ higher" : guess > target ? "⬇️ lower" : "🎯";
    history.push(guess);
    $("#ghist").insertAdjacentHTML("beforeend", `<li><b>${guess}</b> ${icon} <small>${dir}</small></li>`);
    $("#thermo").style.transform = `scaleX(${Math.max(0.05, 1 - dist / 120).toFixed(2)})`;
    $("#bulb").textContent = icon;
    $("#left").textContent = Math.max(0, MAX - tries);
    $("#hearts").textContent = "❤️".repeat(Math.max(0, MAX - tries)) + "🖤".repeat(Math.min(MAX, tries));
    if (calm() || dist === 0 || tries >= MAX) {
      extra.eta = target;
      $("#next").disabled = true;
      if (dist === 0) {
        $("#heat").textContent = `🎯 NO WAY. ${target} min exactly. Aura +1000 🔥`;
        play("airhorn");
        emojiBurst($("#guess"), ["🎯", "🔥", "⏰"], 16);
      } else {
        $("#heat").textContent = calm() ? `رايق mode: it's ${target} min. Locked 🫡` : `Out of tries. It was ${target} min. Close enough 🫠`;
        play("boom");
      }
      toast(`Delivery in ~${target} min (allegedly) ⏰`);
      return setTimeout(() => current === 2 && go(3), calm() ? 300 : 1100);
    }
    $("#heat").textContent = `${icon} ${label}. Go ${dir}! ${MAX - tries} ${MAX - tries === 1 ? "try" : "tries"} left.`;
    play(dist <= 15 ? "pop" : "error");
  });
}

// ---------- 4. Captcha: funny but correct. Wrong → new challenge; 2 misses and we let you in ----------
const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0);
// Forgiving compare: case, spaces, tashkeel/tatweel, أ/إ/آ→ا, ى→ي, ة→ه, Arabic digits→Latin
const norm = (s) =>
  toLatinDigits(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
const radios = (opts) =>
  `<div class="cap-choices" role="radiogroup" aria-label="Answers">${opts
    .map((o, i) => `<label class="cap-choice"><input type="radio" name="cap-pick" value="${i}"><span dir="auto">${o}</span></label>`)
    .join("")}</div>`;
const pickedRadio = (box) => {
  const r = $("[name=cap-pick]:checked", box);
  return r ? Number(r.value) : null;
};
// Toggle-able tile grid. single=true makes it behave like a radio group.
function bindGrid(box, single = false) {
  $(".captcha-grid", box).addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    if (single) $$(".captcha-grid button", box).forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", String(on));
  });
}
const pressedTiles = (box) => $$(".captcha-grid [aria-pressed=true]", box).map((b) => Number(b.dataset.i));
const img = (url, style = "") => `<img src="${esc(url)}" alt="" draggable="false" ${style ? `style="${style}"` : ""}>`;

const FOOD_EMOJI = [
  ["🍗", "فراخ", "chicken"], ["🧆", "طعمية", "falafel"], ["🥙", "شاورما", "shawarma"], ["🍚", "رز", "rice"], ["🌯", "راب", "wrap"],
  ["🦐", "جمبري", "shrimp"], ["🍲", "ملوخية", "molokhia"], ["🫘", "فول", "foul"], ["🐟", "سمك", "fish"], ["🥖", "عيش", "bread"],
];
const NON_FOOD_EMOJI = [["📎", "paperclip"], ["🖨️", "printer"], ["💼", "briefcase"], ["📊", "chart"], ["🪑", "chair"], ["⌨️", "keyboard"], ["📅", "calendar"], ["🔌", "plug"], ["🧾", "invoice"]];
const FOOD_WORDS = ["كشري 🍝 Koshary", "فول 🫘 Foul", "طعمية 🧆 Ta'meya", "ملوخية 🍲 Molokhia", "محشي 🫑 Mahshi", "حواوشي 🥙 Hawawshi", "بسبوسة 🍰 Basbousa", "فطير مشلتت 🥞 Feteer"];
const NOT_FOOD = ["📊 The Q3 Excel sheet", "🖨️ The office printer", "📅 The 9am standup", "📧 A reply-all email", "🔌 The HDMI cable nobody has", "💼 Your KPIs", "🪑 Your manager's chair"];
const CAPTCHA_WORDS = ["اشطا", "يسطا", "فكك", "قشطة", "عاش", "skibidi", "aura", "rizz", "sheesh", "habibi"];
const CROWD = ["🧑‍💼", "👩‍💼", "👨‍💼", "🧑‍💻", "👩‍💻", "👨‍💻"];
const UPRIGHT_EMOJI = [["🧍", "person"], ["🍦", "ice cream"], ["🏠", "house"], ["🌲", "tree"], ["🍾", "bottle"], ["☕", "coffee"]];
const ODD_PAIRS = [["🍗", "🍖"], ["🥙", "🌯"], ["🍋", "🍊"], ["🫘", "🥜"], ["🍚", "🍙"], ["🧆", "🥔"], ["☕", "🍵"]];
const TRIVIA = [
  { q: "What is NOT in koshary? 🍝", a: "🍍 Pineapple", wrong: ["🍚 Rice", "🫘 Lentils", "🍝 Pasta", "🧅 Crispy onions"] },
  { q: "Which one is NOT Egyptian? 🇪🇬", a: "🍣 Sushi", wrong: ["🫘 Ful medames", "🍲 Molokhia", "🥙 Hawawshi", "🥞 Feteer meshaltet"] },
  { q: "Egyptian ta'meya is made from… 🧆", a: "🫘 Fava beans", wrong: ["🥔 Potatoes", "📊 Excel sheets", "🍫 Chocolate"] },
  { q: "The famous gasp you do while cooking molokhia is called… 🍲", a: "😮‍💨 The شهقة (shahqa)", wrong: ["💃 The TikTok", "🧘 The meditation", "📞 The HR call"] },
  { q: "What do you pour on fatta? 🥣", a: "🧄 Garlic-vinegar tomato sauce", wrong: ["🍯 Honey", "🥛 Milk", "☕ Turkish coffee"] },
  { q: "Hawawshi is… 🥙", a: "🥩 Spiced meat baked inside bread", wrong: ["🍰 A dessert", "🐟 A fish", "💼 A job title"] },
];
const PRAISE = ["Verified. 100% human, 0% robot, 67% brainrot ✅", "Correct. Aura +1000 🔥", "عاش يا وحش 🫡 human confirmed", "Sheesh. Not a robot. Probably. 🤖❌"];

const withPhotos = (ds) => {
  const seen = new Set();
  return ds.filter((d) => d.photo_url && !seen.has(d.photo_url) && seen.add(d.photo_url));
};

// Each challenge: { id, ok(dishes) -> usable?, render(box, dishes, msg) -> { check() -> true | "praise" | false | null (not answered), hint, empty } }
const CHALLENGES = [
  {
    id: "faces",
    ok: () => true,
    render(box, ds) {
      const photos = withPhotos(ds);
      const star = pick(photos);
      const others = photos.filter((d) => d !== star);
      const tiles = [];
      const hits = new Set(shuffle([...Array(9).keys()]).slice(0, rand(2, 4)));
      const spin = () => `transform:rotate(${pick([0, 0, 90, 180, -12, 15, 270])}deg) scale(${(1 + Math.random() * 0.4).toFixed(2)})`;
      const emojiTile = (f) => ({ html: `<span style="${spin()}">${f[0]}</span>`, name: f[2] });
      let label;
      let want;
      if (others.length) {
        want = star.name_ar;
        label = `<span dir="auto">${esc(star.name_ar)}</span>`;
        const face = (d) => ({ html: img(d.photo_url, spin()), name: d.name_ar });
        for (let i = 0; i < 9; i++) tiles.push(hits.has(i) ? face(star) : Math.random() < 0.65 ? face(pick(others)) : emojiTile(pick(FOOD_EMOJI)));
      } else {
        const food = pick(FOOD_EMOJI);
        const decoys = FOOD_EMOJI.filter((f) => f !== food);
        want = food[2];
        label = `${food[0]} <span dir="auto">${food[1]}</span> / ${food[2]}`;
        for (let i = 0; i < 9; i++) tiles.push(emojiTile(hits.has(i) ? food : pick(decoys)));
      }
      box.innerHTML = `<p class="cap__prompt"><strong>Select ALL squares with <bdi data-want="${esc(want)}">${label}</bdi></strong><br><small>Tap every square they're in, then Verify. Yes, even the rotated ones 👀</small></p>
        <div class="captcha-grid">${tiles.map((t, i) => `<button type="button" aria-pressed="false" aria-label="Tile ${i + 1}: ${esc(t.name)}" data-i="${i}">${t.html}</button>`).join("")}</div>`;
      bindGrid(box);
      return {
        empty: "Pick at least one square. We KNOW you know who it is 👀",
        hint: `Wrong 💀 They were in tiles ${[...hits].sort((a, b) => a - b).map((i) => i + 1).join(", ")}.`,
        check() {
          const sel = pressedTiles(box);
          if (!sel.length) return null;
          return sel.length === hits.size && sel.every((i) => hits.has(i));
        },
      };
    },
  },
  {
    id: "math",
    ok: () => true,
    render(box) {
      let question;
      let answer;
      let meme = false;
      if (Math.random() < 0.35) {
        question = "6 + 7 = ?";
        answer = 13;
        meme = true;
      } else {
        const values = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        const items = shuffle(["🧆", "🫘", "🥖", "🧅", "🌶️"]).slice(0, 3).map((e, i) => [e, values[i]]);
        const terms = Array.from({ length: rand(3, 4) }, () => pick(items));
        answer = terms.reduce((s, t) => s + t[1], 0);
        question = `<span class="cap-legend">${items.map(([e, v]) => `${e} = ${v}`).join(" · ")}</span>${terms.map((t) => t[0]).join(" + ")} = ?`;
      }
      box.innerHTML = `<p class="cap__prompt"><strong>حل المسألة / Solve this</strong><br><small>Egyptian food math 🧮 No calculator, the chef is watching.</small></p>
        <div class="cap-math" dir="ltr">${question}</div>
        <label class="field cap-input">Your answer / إجابتك <input id="cap-answer" type="text" inputmode="numeric" autocomplete="off" maxlength="6"></label>`;
      return {
        empty: "Type a number first. Any number. Please 🙏",
        hint: `It was ${answer}. Math is hard, we get it 🧮💀`,
        check() {
          const v = norm($("#cap-answer", box).value);
          if (!v) return null;
          if (meme && v === "67") return "6️⃣7️⃣ Wrong math, correct aura. Allowed.";
          return Number(v) === answer;
        },
      };
    },
  },
  {
    id: "word",
    ok: () => true,
    render(box) {
      const word = pick(CAPTCHA_WORDS);
      // Arabic letters must stay joined, so Arabic is warped as one piece; Latin gets per-letter chaos.
      const art = /[؀-ۿ]/.test(word)
        ? `<span class="cap-word__ar" style="transform:rotate(${rand(-10, 10)}deg) skewX(${rand(-20, 20)}deg)">${esc(word)}</span>`
        : [...word].map((c) => `<span style="transform:translateY(${rand(-8, 8)}px) rotate(${rand(-30, 30)}deg);font-size:${rand(90, 140)}%">${esc(c)}</span>`).join("");
      box.innerHTML = `<p class="cap__prompt"><strong>اكتب الكلمة / Type the word you see</strong><br><small>Not case-sensitive. أ or ا, we don't judge.</small></p>
        <div class="cap-word" aria-hidden="true" dir="auto">${art}</div>
        <span class="cap-sr">The word is: ${esc(word)}</span>
        <label class="field cap-input">The word / الكلمة <input id="cap-answer" type="text" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20"></label>`;
      return {
        empty: "Type something. Even 'idk' is a vibe 🤷",
        hint: `It said "${word}". Glasses check 👓`,
        check() {
          const v = norm($("#cap-answer", box).value);
          if (!v) return null;
          return v === norm(word);
        },
      };
    },
  },
  {
    id: "notfood",
    ok: () => true,
    render(box, ds) {
      const foods = shuffle(FOOD_WORDS).slice(0, 3);
      if (ds.length && Math.random() < 0.6) foods[0] = `${esc(pick(ds).name_ar)} (on the menu, so… food 💀)`;
      const titled = ds.filter((d) => d.job_title);
      const odd = titled.length && Math.random() < 0.5 ? `💼 ${esc(pick(titled).job_title)}` : pick(NOT_FOOD);
      const opts = shuffle([...foods, odd]);
      const right = opts.indexOf(odd);
      box.innerHTML = `<p class="cap__prompt"><strong>أنهي واحدة مش أكل؟ / Which one is NOT food?</strong></p>${radios(opts)}`;
      return {
        empty: "Pick one. It's multiple choice, not a personality test 🙄",
        hint: `"${opts[right].replace(/&#39;/g, "'").replace(/&[a-z]+;/g, "")}" is not food. Unless you're HR.`,
        check: () => {
          const p = pickedRadio(box);
          return p === null ? null : p === right;
        },
      };
    },
  },
  {
    id: "robot",
    ok: () => true,
    render(box, _ds, msg) {
      let dodges = 0;
      box.innerHTML = `<p class="cap__prompt"><strong>Just tick the box.</strong> Easy. Trust 🙂</p>
        <div class="cap-robot"><label class="cap-robot__box"><input type="checkbox" id="robot-cb"><span>I'm not a robot<br><small>مش روبوت والله</small></span><span class="cap-robot__logo" aria-hidden="true">🤖🚫</span></label></div>`;
      const lab = $(".cap-robot__box", box);
      const cb = $("#robot-cb", box);
      const dodge = () => {
        dodges++;
        lab.style.left = `calc((100% - var(--robot-w)) * ${Math.random().toFixed(2)})`;
        lab.style.top = `calc((100% - var(--robot-h)) * ${Math.random().toFixed(2)})`;
        msg(dodges === 1 ? "Nope 🏃💨 too slow" : "Almost 😏 one more time…");
        play(dodges === 1 ? "what" : "goofy");
      };
      lab.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && dodges < 2 && dodge());
      // Covers clicks, taps and Space: the first 2 attempts dodge, then it behaves.
      cb.addEventListener("click", (e) => {
        if (dodges < 2) {
          e.preventDefault();
          dodge();
        } else if (cb.checked) msg("OK fine. It's checked. Now press Verify ✅");
      });
      return {
        empty: "Tick the box first 🙄 (it stops running eventually, promise)",
        hint: "",
        check: () => (cb.checked ? "Checkbox caught. Human behaviour detected 🧍✅" : null),
      };
    },
  },
  {
    id: "plate",
    ok: () => true,
    render(box) {
      const target = rand(25, 90);
      box.innerHTML = `<p class="cap__prompt"><strong>حط الفرخة في الطبق / Slide the 🍗 onto the 🍽️ plate</strong><br><small>Precision. Aura. Don't drop it.</small></p>
        <div class="cap-plate" aria-hidden="true"><span class="cap-plate__plate" style="left:${target}%">🍽️</span><span class="cap-plate__food" style="left:0%">🍗</span></div>
        <input type="range" id="cap-range" min="0" max="100" value="0" aria-label="Chicken position. The plate is at ${target} percent">`;
      const range = $("#cap-range", box);
      range.addEventListener("input", () => {
        $(".cap-plate__food", box).style.left = `${range.value}%`;
        range.setAttribute("aria-valuetext", `${range.value} percent`);
      });
      return {
        empty: "The chicken hasn't moved. Slide it 👉",
        hint: `Chicken on the floor 💀 the plate was at ${target}%.`,
        check() {
          const v = Number(range.value);
          if (v === 0) return null;
          return Math.abs(v - target) <= 6;
        },
      };
    },
  },
  {
    id: "salary",
    ok: (ds) => new Set(ds.filter((d) => d.price > 0).map((d) => d.price)).size >= 2,
    render(box, ds) {
      const seen = new Set();
      const opts = shuffle(ds.filter((d) => d.price > 0))
        .filter((d) => !seen.has(d.price) && seen.add(d.price)) // unique prices, so exactly one right answer
        .slice(0, 4);
      const rich = Math.random() < 0.5;
      const best = opts.reduce((a, d) => ((rich ? d.price > a.price : d.price < a.price) ? d : a));
      box.innerHTML = `<p class="cap__prompt"><strong data-rich="${rich}">${rich ? "Select the coworker with the BIGGEST salary 💸" : "Select the most UNDERPAID coworker 😭"}</strong><br><small>Salary = menu price. HR leaked it. Robots can't read prices (trust).</small></p>
        ${radios(opts.map((d) => `${avatarHtml(d)} <b>${esc(d.name_ar)}</b> <small dir="ltr">${egp(d.price)}</small>`))}`;
      return {
        empty: "Pick a coworker. Bas the right one 👀",
        hint: `It was ${best.name_ar} (${egp(best.price)}). Read the price habibi.`,
        check: () => {
          const p = pickedRadio(box);
          return p === null ? null : opts[p] === best;
        },
      };
    },
  },
  // ----- image captchas -----
  {
    id: "rotate",
    ok: () => true,
    render(box, ds, msg) {
      const photo = pick(withPhotos(ds));
      const [emoji, what] = pick(UPRIGHT_EMOJI);
      let turns = rand(1, 3); // quarter turns away from upright
      const subject = photo ? `<bdi>${esc(photo.name_ar)}</bdi>` : `the ${what}`;
      box.innerHTML = `<p class="cap__prompt"><strong>Rotate ${subject} upright</strong> <span class="cap-ar" dir="rtl" lang="ar">لف الصورة لحد ما تبقى معدولة</span><br><small>Tap the picture (or ↻) to turn it 90°. Then Verify.</small></p>
        <div class="cap-rotate"><button type="button" class="cap-rotate__pic" id="rot-pic"><span class="cap-rotate__inner" id="rot-inner">${photo ? img(photo.photo_url) : `<span class="cap-rotate__emoji">${emoji}</span>`}</span></button>
        <button type="button" class="btn white" id="rot-btn">↻ Rotate 90°</button></div>`;
      let deg = turns * 90;
      const paint = () => {
        $("#rot-inner", box).style.transform = `rotate(${deg}deg)`;
        const label = ["upright", "turned right", "upside down", "turned left"][turns % 4];
        $("#rot-pic", box).setAttribute("aria-label", `Picture, currently ${label}. Press to rotate 90 degrees`);
      };
      let touched = false;
      const turn = () => {
        touched = true;
        turns++;
        deg += 90; // always clockwise, keeps the animation going one way
        paint();
        if (turns % 4 === 0) msg("Looks upright to us 👀 press Verify");
        else msg("");
      };
      paint();
      $("#rot-pic", box).addEventListener("click", turn);
      $("#rot-btn", box).addEventListener("click", turn);
      return {
        empty: "Rotate it first ↻ it's clearly not upright",
        hint: "Still crooked 💀 like the office Wi-Fi.",
        check: () => (touched ? turns % 4 === 0 : null),
      };
    },
  },
  {
    id: "crowd",
    ok: () => true,
    render(box, ds) {
      const photo = pick(withPhotos(ds));
      const spot = rand(0, 15);
      const chef = "🧑‍🍳";
      const tiles = Array.from({ length: 16 }, (_, i) => {
        if (i !== spot) {
          const e = pick(CROWD);
          return `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}: random office person"><span style="transform:rotate(${rand(-15, 15)}deg)">${e}</span></button>`;
        }
        return `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}: ${photo ? esc(photo.name_ar) : "the chef"}">${photo ? img(photo.photo_url) : `<span>${chef}</span>`}</button>`;
      });
      box.innerHTML = `<p class="cap__prompt"><strong>Find ${photo ? `<bdi>${esc(photo.name_ar)}</bdi>` : `the chef ${chef}`} in the crowd</strong> <span class="cap-ar" dir="rtl" lang="ar">لاقيه في الزحمة</span><br><small>It's the all-hands meeting. Tap them, then Verify. Waldo could never.</small></p>
        <div class="captcha-grid cap-grid4">${tiles.join("")}</div>`;
      bindGrid(box, true);
      return {
        empty: "Tap someone. Anyone. Ideally the right one 👀",
        hint: `They were in tile ${spot + 1}, hiding behind a laptop 💻`,
        check() {
          const sel = pressedTiles(box);
          if (!sel.length) return null;
          return sel[0] === spot;
        },
      };
    },
  },
  {
    id: "upside",
    ok: () => true,
    render(box, ds) {
      const photos = withPhotos(ds);
      const right = rand(0, 3);
      const pics = Array.from({ length: 4 }, (_, i) => {
        const tilt = i === right ? 0 : pick([180, 180, 170, 190]);
        const inner = photos.length ? img(pick(photos).photo_url, `transform:rotate(${tilt}deg)`) : `<span style="transform:rotate(${tilt}deg)">${pick(UPRIGHT_EMOJI)[0]}</span>`;
        return `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Picture ${i + 1}, ${i === right ? "upright" : "upside down"}">${inner}</button>`;
      });
      box.innerHTML = `<p class="cap__prompt"><strong>Which picture is NOT upside down?</strong> <span class="cap-ar" dir="rtl" lang="ar">أنهي صورة مش مقلوبة؟</span><br><small>Someone hung the office photos after a long Thursday. Pick the upright one.</small></p>
        <div class="captcha-grid cap-grid2">${pics.join("")}</div>`;
      bindGrid(box, true);
      return {
        empty: "Pick one picture 🖼️",
        hint: `It was picture ${right + 1}. Tilt your head next time 🙃`,
        check() {
          const sel = pressedTiles(box);
          if (!sel.length) return null;
          return sel[0] === right;
        },
      };
    },
  },
  {
    id: "dragface",
    ok: () => true,
    render(box, ds, msg) {
      const photo = pick(withPhotos(ds));
      box.innerHTML = `<p class="cap__prompt"><strong>Drag ${photo ? `<bdi>${esc(photo.name_ar)}</bdi>` : "the 🍗"} onto the plate</strong> <span class="cap-ar" dir="rtl" lang="ar">حطه في الطبق</span><br><small>Drag with mouse/finger. Keyboard: focus it and use the arrow keys.</small></p>
        <div class="cap-drag" id="drag-zone"><span class="cap-drag__plate" id="drag-plate" aria-hidden="true">🍽️</span>
        <button type="button" class="cap-drag__face" id="drag-face" aria-label="Draggable ${photo ? esc(photo.name_ar) : "chicken"}. Use arrow keys to move it onto the plate">${photo ? img(photo.photo_url) : "🍗"}</button></div>`;
      const zone = $("#drag-zone", box);
      const face = $("#drag-face", box);
      const plate = $("#drag-plate", box);
      const px = rand(55, 85);
      const py = rand(25, 70);
      plate.style.left = `${px}%`;
      plate.style.top = `${py}%`;
      let fx = 12;
      let fy = 50;
      let moved = false;
      const place = () => {
        face.style.left = `${fx}%`;
        face.style.top = `${fy}%`;
      };
      const onPlate = () => {
        const a = face.getBoundingClientRect();
        const b = plate.getBoundingClientRect();
        return Math.hypot(a.left + a.width / 2 - (b.left + b.width / 2), a.top + a.height / 2 - (b.top + b.height / 2)) < Math.max(36, b.width * 0.55);
      };
      const settle = () => {
        if (onPlate()) {
          face.classList.add("is-on");
          msg("On the plate 🍽️ press Verify");
        } else face.classList.remove("is-on");
      };
      place();
      let dragging = null;
      face.addEventListener("pointerdown", (e) => {
        dragging = { id: e.pointerId };
        face.setPointerCapture(e.pointerId);
        face.classList.add("is-drag");
        e.preventDefault();
      });
      face.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const r = zone.getBoundingClientRect();
        fx = Math.min(95, Math.max(5, ((e.clientX - r.left) / r.width) * 100));
        fy = Math.min(90, Math.max(10, ((e.clientY - r.top) / r.height) * 100));
        moved = true;
        place();
      });
      const drop = () => {
        if (!dragging) return;
        dragging = null;
        face.classList.remove("is-drag");
        settle();
      };
      face.addEventListener("pointerup", drop);
      face.addEventListener("pointercancel", drop);
      face.addEventListener("keydown", (e) => {
        const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[e.key];
        if (!step) return;
        e.preventDefault();
        fx = Math.min(95, Math.max(5, fx + step[0]));
        fy = Math.min(90, Math.max(10, fy + step[1]));
        moved = true;
        place();
        settle();
      });
      return {
        empty: "It hasn't moved. Drag it onto the 🍽️",
        hint: "Missed the plate. The floor is NOT a plate 💀",
        check: () => (moved ? onPlate() : null),
      };
    },
  },
  {
    id: "foodpics",
    ok: () => true,
    render(box, ds) {
      const photos = withPhotos(ds);
      const kinds = shuffle([...Array(9).keys()]);
      const foodCount = rand(3, 5);
      const tiles = [];
      const hits = new Set();
      kinds.forEach((k, i) => {
        if (i < foodCount) {
          hits.add(k);
          const usePhoto = photos.length && Math.random() < 0.35;
          const d = usePhoto && pick(photos);
          tiles[k] = d ? { html: img(d.photo_url), name: `${d.name_ar} (coworker, on the menu)` } : (([e, , en]) => ({ html: `<span>${e}</span>`, name: en }))(pick(FOOD_EMOJI));
        } else {
          const [e, en] = pick(NON_FOOD_EMOJI);
          tiles[k] = { html: `<span>${e}</span>`, name: en };
        }
      });
      box.innerHTML = `<p class="cap__prompt"><strong>Select all images with FOOD 🍽️</strong><br><small>Coworkers count as food here (they're literally on the menu). Office supplies do not. Yet.</small></p>
        <div class="captcha-grid">${tiles.map((t, i) => `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}: ${esc(t.name)}">${t.html}</button>`).join("")}</div>`;
      bindGrid(box);
      return {
        empty: "Select the food. You've been staring at a menu for 5 minutes 🍗",
        hint: `Food was in tiles ${[...hits].sort((a, b) => a - b).map((i) => i + 1).join(", ")}. The 📎 is not a snack.`,
        check() {
          const sel = pressedTiles(box);
          if (!sel.length) return null;
          return sel.length === hits.size && sel.every((i) => hits.has(i));
        },
      };
    },
  },
  {
    id: "oddone",
    ok: () => true,
    render(box) {
      const [same, odd] = shuffle(pick(ODD_PAIRS));
      const spot = rand(0, 8);
      box.innerHTML = `<p class="cap__prompt"><strong>Spot the impostor ඞ / Tap the odd one out</strong><br><small>One of these is not like the others. Like you at the team outing.</small></p>
        <div class="captcha-grid">${Array.from({ length: 9 }, (_, i) => `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}: ${i === spot ? odd : same}"><span>${i === spot ? odd : same}</span></button>`).join("")}</div>`;
      bindGrid(box, true);
      return {
        empty: "Tap the impostor 🔪",
        hint: `The impostor ${odd} was in tile ${spot + 1}. Emergency meeting 🚨`,
        check() {
          const sel = pressedTiles(box);
          if (!sel.length) return null;
          return sel[0] === spot;
        },
      };
    },
  },
  {
    id: "trivia",
    ok: () => true,
    render(box) {
      const t = pick(TRIVIA);
      const opts = shuffle([t.a, ...shuffle(t.wrong).slice(0, 3)]);
      const right = opts.indexOf(t.a);
      box.innerHTML = `<p class="cap__prompt"><strong>🇪🇬 Egyptian food check: ${t.q}</strong><br><small>Robots don't know this. Your teta does.</small></p>${radios(opts.map(esc))}`;
      return {
        empty: "Pick an answer. Your teta is watching 👵",
        hint: `It's "${t.a}". Your teta is disappointed 👵💔`,
        check: () => {
          const p = pickedRadio(box);
          return p === null ? null : p === right;
        },
      };
    },
  },
  {
    id: "price",
    ok: (ds) => ds.filter((d) => d.price > 0).length >= 2,
    render(box, ds) {
      const rows = shuffle(ds.filter((d) => d.price > 0)).slice(0, 4);
      const ask = pick(rows);
      box.innerHTML = `<p class="cap__prompt"><strong>Type the price of <bdi data-ask="${esc(ask.name_ar)}">${esc(ask.name_ar)}</bdi></strong> <span class="cap-ar" dir="rtl" lang="ar">اكتب السعر</span><br><small>Here's the leaked price list. Reading = human 📖</small></p>
        <ul class="cap-receipt">${rows.map((d) => `<li><span dir="auto">${esc(d.name_ar)}</span><b dir="ltr">${egp(d.price)}</b></li>`).join("")}</ul>
        <label class="field cap-input">Price in EGP <input id="cap-answer" type="text" inputmode="decimal" autocomplete="off" maxlength="10"></label>`;
      return {
        empty: "Type the number. Just the number 🔢",
        hint: `It was ${egp(ask.price)}. It was RIGHT THERE 💀`,
        check() {
          const v = norm($("#cap-answer", box).value).replace(/[^\d.]/g, "");
          if (!v) return null;
          return Math.abs(Number(v) - ask.price) < 1;
        },
      };
    },
  },
  {
    id: "lights",
    ok: () => true,
    render(box, _ds, msg) {
      let skipped = false;
      const foods = shuffle(FOOD_EMOJI).slice(0, 9);
      box.innerHTML = `<p class="cap__prompt"><strong>Select all squares with 🚦 traffic lights</strong><br><small>Then Verify. If there are none, press Skip.</small></p>
        <div class="captcha-grid">${foods.map((f, i) => `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}: ${f[2]}"><span>${f[0]}</span></button>`).join("")}</div>
        <button type="button" class="btn white" id="cap-skip">🤷 There are none · Skip</button>`;
      bindGrid(box);
      $("#cap-skip", box).addEventListener("click", () => {
        skipped = true;
        msg(pressedTiles(box).length ? "You skipped… but some squares are still selected 🤨" : "Correct, it's a kitchen, not Tahrir Square 🚦 press Verify");
        if (!pressedTiles(box).length) $("#next")?.click();
      });
      return {
        empty: "Select the traffic lights… or admit there are none 👀",
        hint: "There were no traffic lights. It's a kitchen 🍳",
        check() {
          const sel = pressedTiles(box);
          if (sel.length) return false;
          return skipped ? "No traffic lights. Big brain energy 🧠🚦" : "Selected nothing. Correct. Galaxy brain 🧠";
        },
      };
    },
  },
];
const CHILL_CAPTCHA = {
  id: "chill",
  render(box) {
    box.innerHTML = `<p class="cap__prompt">رايق mode: no puzzle. Just press <b>Verify</b>. You're human, we believe you 🫶</p>`;
    return { check: () => "رايق verified 🫡 human enough" };
  },
};
let lastCaptcha = null;

function stepCaptcha() {
  const ds = dishes.filter((d) => !d.badges?.includes("sold_out"));
  let fails = 0;
  let active;
  panel(
    "🤖 إنت بني آدم؟ / Are you human?",
    `<div class="cap-meta"><span class="pill" id="cap-fails">❤️❤️ 2 misses and we let you in anyway</span>${calm() ? "" : `<button class="tiny-link" type="button" id="cap-new">🔄 غيّرها / different challenge</button>`}</div>
     <div class="cap" id="cap"></div>
     <p id="cap-msg" class="cap__msg" aria-live="polite"></p>`,
    `${backBtn()}${nextBtn("Verify ✅")}`,
  );
  bindBack();
  const box = $("#cap");
  const msg = (text) => {
    const el = $("#cap-msg");
    if (el) el.textContent = text;
  };
  const load = (note = "") => {
    const pool = calm() ? [CHILL_CAPTCHA] : CHALLENGES.filter((c) => c.ok(ds));
    const ch = pick(pool.length > 1 ? pool.filter((c) => c.id !== lastCaptcha) : pool);
    lastCaptcha = ch.id;
    box.dataset.type = ch.id;
    active = ch.render(box, ds, msg);
    msg(note);
  };
  load();
  // Drop the "answer first" nag as soon as they start answering
  ["input", "change", "click"].forEach((ev) => box.addEventListener(ev, () => active.empty && $("#cap-msg")?.textContent === active.empty && msg("")));
  $("#cap-new")?.addEventListener("click", () => {
    load("New challenge. Same vibes 🔄");
    $("input, button", box)?.focus();
  });
  $("#next").addEventListener("click", () => {
    if ($("#next").disabled) return;
    const result = active.check();
    if (result === null) {
      play("bruh");
      return msg(active.empty);
    }
    if (result) {
      play("success");
      toast(typeof result === "string" ? result : pick(PRAISE));
      emojiBurst($("#next"), ["✅", "🧍", "🤖❌"], 12);
      return go(4);
    }
    fails++;
    play("wrong");
    shakeEl(box);
    $("#cap-fails").textContent = fails >= 2 ? "🖤🖤 out of misses" : "❤️🖤 1 miss left, then we give up on you";
    if (fails >= 2) {
      $("#next").disabled = true;
      msg(`${active.hint} …whatever, close enough.`);
      toast("Close enough, you're 67% human 🤖➡️🧍 بس متتعودش");
      return setTimeout(() => current === 3 && go(4), 1200);
    }
    load(`❌ ${active.hint} Here's a new one.`);
  });
}

// ---------- 5. Tip ----------
const TIPS = [
  ["0% 💀", 0], ["15%", 15], ["67% 6️⃣7️⃣", 67], ["420% 🔥", 420], ["كليتك 🫘 (your kidney)", null],
];
const SPLITS = [
  ["HR", "🏢 Split with HR / خصمها من المرتب", "Recommended by HR. Mandatory, actually."],
  ["manager", "👔 Split with your manager", "They'll 'circle back' on it"],
  ["intern", "🧑‍🎓 Split with the intern", "Paid in exposure ✨"],
  ["later", "⏳ Pay later in 6–7 business years", "Interest: 67% APR 6️⃣7️⃣"],
];
const PRIZES = [
  ["0% off 💀", "0% خصم. Better luck never.", 30, "crickets"],
  ["فكّك 🫠", "Coupon: فكّك. Literally nothing.", 30, "crickets"],
  ["اتقل 😏", "اتقل… the coupon is playing hard to get.", 25, "sideeye"],
  ["6.7% off*", "*on vibes only. Not on prices.", 10, "boom"],
  ["FREE HUG 🫂", "Redeemable at HR. They'll say no.", 5, "win"],
];
const pickPrize = () => {
  let r = Math.random() * PRIZES.reduce((s, p) => s + p[2], 0);
  return PRIZES.find((p) => (r -= p[2]) < 0) || PRIZES[0];
};

function stepTip() {
  let snaps = 0;
  const sub = subtotalOf(getCart());
  const prize = pickPrize();
  panel(
    "💸 البقشيش / Tip the chef",
    `<div class="tip-top">
       <div class="jar" aria-hidden="true"><div class="jar__glass"><span class="jar__fill" id="jar-fill"></span><span class="jar__coins" id="jar-coins"></span></div><span class="jar__label">TIPS 🫙</span></div>
       <div><div class="tip-value" id="tip" aria-live="polite"></div><p class="co-hint" id="tip-amt"></p></div>
     </div>
     <div class="qchips tip-chips" role="radiogroup" aria-label="Tip">${TIPS.map(([l], i) => `<label class="qchip"><input type="radio" name="tip" value="${i}" ${l === extra.tip ? "checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
     <p class="co-hint">Tips are NOT charged. The chef just wants to feel something.</p>
     <fieldset class="co-fs"><legend>🧾 Split the bill</legend>
       ${SPLITS.map(([k, l, s]) => `<label class="check-row"><input type="checkbox" data-split="${k}" ${extra.splits.includes(k) ? "checked" : ""}><span><b>${l}</b><br><small>${s}</small></span></label>`).join("")}
     </fieldset>
     <h3 class="co-h3">🎟️ Scratch your coupon / اكشط الكوبون</h3>
     <div class="scratch" id="scratch"><span class="scratch__prize" id="prize" aria-live="polite"><b>${esc(prize[0])}</b><small>${esc(prize[1])}</small></span><canvas id="scratch-canvas" width="320" height="160" aria-hidden="true"></canvas></div>
     <p class="center"><button class="tiny-link" type="button" id="scratch-auto">🪙 Scratch it for me (keyboard / lazy mode)</button></p>`,
    `${backBtn()}${nextBtn()}`,
  );
  bindBack();
  const tipIdx = () => Number($("[name=tip]:checked")?.value ?? 2);
  const paint = (drop = true) => {
    const [label, pct] = TIPS[tipIdx()];
    $("#tip").textContent = label;
    $("#tip-amt").textContent = pct === null ? "≈ 1 kidney (market value: priceless 🫘)" : `≈ ${egp(Math.round(sub * pct) / 100)} of pure gratitude (not charged)`;
    const lvl = pct === null ? 1 : Math.min(1, 0.06 + pct / 450);
    $("#jar-fill").style.transform = `scaleY(${lvl.toFixed(2)})`;
    if (drop && !calm()) {
      const coins = $("#jar-coins");
      for (let i = 0; i < 3; i++) {
        const c = document.createElement("span");
        c.textContent = pct === null ? "🫘" : pct === 0 ? "🦗" : "🪙";
        c.style.left = `${20 + i * 25}%`;
        c.style.animationDelay = `${i * 90}ms`;
        c.addEventListener("animationend", () => c.remove());
        coins.append(c);
      }
    }
  };
  if (!$("[name=tip]:checked")) $$("[name=tip]")[2].checked = true;
  paint(false);
  $(".tip-chips").addEventListener("change", (e) => {
    const i = Number(e.target.value);
    extra.tip = TIPS[i][0];
    paint();
    play(TIPS[i][1] === 0 ? "sad" : "ka");
    if (calm() || i === 2) return;
    if (snaps >= 2) {
      toast(`OK fine, ${TIPS[i][0]} it is. The algorithm respects persistence 🫡`);
      return;
    }
    snaps++;
    setTimeout(() => {
      if (current !== 4) return;
      $$("[name=tip]")[2].checked = true;
      extra.tip = TIPS[2][0];
      paint();
      toast(snaps === 1 ? "Tip snapped back to 67%. The algorithm has spoken 6️⃣7️⃣" : "Snapped back AGAIN 🙃 (one more try and we give up)");
      play("boing");
    }, 650);
  });
  let hrTries = 0;
  $(".panel").addEventListener("change", (e) => {
    const k = e.target.dataset.split;
    if (!k) return;
    if (k === "HR" && !e.target.checked && !calm()) {
      e.target.checked = true;
      toast(["HR said no. HR always says no 🙅", "This checkbox is HR property 📁", "You can't quit HR. Nobody can 💀"][hrTries++ % 3]);
      play("nope");
      return;
    }
    extra.splits = $$("[data-split]:checked").map((x) => x.dataset.split);
    if (!e.target.checked) return;
    if (k === "manager") toast("Your manager wants to 'take this offline' 👔");
    if (k === "intern") toast("The intern paid in exposure ✨ and a LinkedIn post");
    if (k === "later") toast("Approved. See you in 6–7 business years ⏳ 6️⃣7️⃣");
    play("pop");
  });
  setupScratch(prize);
  $("#next").addEventListener("click", () => go(5));
}

function setupScratch(prize) {
  const cv = $("#scratch-canvas");
  let revealed = false;
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    extra.prize = prize[0];
    cv.classList.add("gone");
    $("#scratch-auto").hidden = true;
    play(prize[3]);
    toast(`🎟️ ${prize[0]} — ${prize[1]}`);
    if (prize[3] === "win") emojiBurst($("#scratch"), ["🫂", "💖", "✨"], 16);
    announce(`Coupon revealed: ${prize[0]}. ${prize[1]}`);
  };
  $("#scratch-auto").addEventListener("click", reveal);
  if (calm()) {
    cv.remove();
    revealed = true;
    extra.prize = prize[0];
    $("#scratch-auto").hidden = true;
    return;
  }
  const g = cv.getContext("2d", { willReadFrequently: true });
  const grad = g.createLinearGradient(0, 0, cv.width, cv.height);
  grad.addColorStop(0, "#c9c9c9");
  grad.addColorStop(0.5, "#9e9e9e");
  grad.addColorStop(1, "#d6d6d6");
  g.fillStyle = grad;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#444";
  g.font = "bold 22px sans-serif";
  g.textAlign = "center";
  g.fillText("اكشط هنا · SCRATCH ME 🪙", cv.width / 2, cv.height / 2 + 8);
  g.globalCompositeOperation = "destination-out";
  let down = false;
  let moves = 0;
  // Share of the foil already scratched off (sampled every 8th pixel for speed)
  const cleared = () => {
    const data = g.getImageData(0, 0, cv.width, cv.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 32) {
      total++;
      if (data[i] < 40) clear++;
    }
    return clear / total;
  };
  const scratch = (e) => {
    if (!down || revealed) return;
    const r = cv.getBoundingClientRect();
    g.beginPath();
    g.arc(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height, 22, 0, Math.PI * 2);
    g.fill();
    if (++moves % 6 === 0 && cleared() >= 0.5) reveal();
  };
  cv.addEventListener("pointerdown", (e) => {
    down = true;
    cv.setPointerCapture(e.pointerId);
    scratch(e);
  });
  cv.addEventListener("pointermove", scratch);
  const up = () => {
    down = false;
    if (!revealed && cleared() >= 0.5) reveal();
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
}

// ---------- 6. Payment: fake methods only. No card fields, ever ----------
// `server` must be one of config.payment_methods; the fancy name goes into the note.
const METHODS = [
  { id: "vibes", server: "vibes", icon: "✨", en: "Pay with vibes", ar: "الدفع بالفيبز", sub: "Accepted everywhere except banks" },
  { id: "insults", server: "insults", icon: "🗯️", en: "Cash (of insults)", ar: "كاش… شتايم", sub: "Exact change please" },
  { id: "owe_lunch", server: "owe_lunch", icon: "🍔", en: "Owe them lunch", ar: "عليا غدا", sub: "Interest: one dessert" },
  { id: "aura", server: "vibes", icon: "💫", en: "Aura points", ar: "نقط أورا", sub: "−670 aura. Can you afford it?" },
  { id: "compliment", server: "vibes", icon: "🥹", en: "Pay with a compliment", ar: "ادفع بمجاملة", sub: "Must be sincere-ish" },
  { id: "instapay", server: "vibes", icon: "📲", en: "InstaPay to Samir's mom", ar: "إنستاباي لمامة سمير", sub: "She'll know it's from you" },
  { id: "salary", server: "owe_lunch", icon: "🏦", en: "Salary advance", ar: "سلفة على المرتب", sub: "HR approval pending since 2019" },
];
let payPick = null;

function stepPay() {
  const allowed = config.payment_methods || ["vibes", "insults", "owe_lunch"];
  const methods = METHODS.map((m) => (allowed.includes(m.server) ? m : { ...m, server: allowed[0] }));
  let noClicks = 0;
  panel(
    "💳 الدفع / Payment",
    `<p>Pick how you'll (not) pay. <b>No card details. Ever.</b> We wouldn't know what to do with them.</p>
     <div class="pay-cards" role="radiogroup" aria-label="Payment method">${methods
       .map((m) => `<label class="pay-card"><input type="radio" name="pay" value="${m.id}" ${payPick === m.id ? "checked" : ""}><span class="pay-card__icon" aria-hidden="true">${m.icon}</span><span class="pay-card__txt"><b>${esc(m.en)}</b><span dir="auto">${esc(m.ar)}</span><small>${esc(m.sub)}</small></span></label>`)
       .join("")}</div>
     <div id="compl-wrap" ${payPick === "compliment" ? "" : "hidden"}>
       <label class="field">🥹 Your compliment for the chef <input id="compliment" maxlength="60" dir="auto" value="${esc(extra.compliment)}" placeholder="e.g. your mandi has main character energy"></label>
     </div>
     <dialog class="modal co-modal" id="no-modal" aria-labelledby="no-title">
       <div class="co-modal__body"><div class="co-modal__big" aria-hidden="true">🙅‍♂️</div><h3 id="no-title">You said NO to paying. Bold. 💅</h3>
       <p>The chef has been informed. He's crying in the walk-in freezer 🥶 HR has opened a ticket.</p>
       <div class="co-modal__actions"><button class="btn red" type="button" id="no-ok">OK fine, I'll pay 😔</button><button class="btn white" type="button" id="no-still">Still NO 😤</button></div></div>
     </dialog>`,
    `${backBtn()}<span class="pay-actions">${calm() ? "" : `<button class="btn slime big no-btn" type="button" id="no-btn">NO</button>`}<button class="tiny-link pay-continue" type="button" id="next">continue →</button></span>`,
  );
  bindBack();
  $(".pay-cards").addEventListener("change", (e) => {
    payPick = e.target.value;
    $("#compl-wrap").hidden = payPick !== "compliment";
    if (payPick === "compliment") $("#compliment").focus();
    const m = METHODS.find((x) => x.id === payPick);
    play({ insults: "goofy", aura: "boom", instapay: "ring", salary: "sad" }[payPick] || "ka");
    if (payPick === "instapay") toast("Samir's mom says thank you habibi 🧕💚");
    announce(`${m.en} selected`);
  });
  const no = $("#no-btn");
  const dodge = () => {
    noClicks++;
    no.style.transform = `translate(${-rand(40, 120)}px, ${-rand(10, 40)}px) rotate(${rand(-12, 12)}deg)`;
    toast("NO ran away 🏃💨 even NO doesn't want to deal with this");
    play("what");
  };
  no?.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && noClicks === 0 && dodge());
  no?.addEventListener("click", () => {
    if (noClicks === 0) return dodge();
    no.style.transform = "";
    play("nope");
    const dlg = $("#no-modal");
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute("open", "");
  });
  const closeNo = () => {
    const dlg = $("#no-modal");
    dlg.close ? dlg.close() : dlg.removeAttribute("open");
  };
  $("#no-ok").addEventListener("click", () => {
    closeNo();
    ($("[name=pay]:checked") || $("[name=pay]")).focus();
  });
  $("#no-still").addEventListener("click", () => {
    closeNo();
    play("bruh");
    toast("Respect. But you still have to pay 💅 Pick a method.");
  });
  $("#next").addEventListener("click", () => {
    const picked = $("[name=pay]:checked");
    if (!picked) {
      play("faah");
      shakeEl($(".pay-cards"));
      return toast("skill issue: pick a payment method", { error: true });
    }
    const m = methods.find((x) => x.id === picked.value);
    if (m.id === "compliment") {
      const c = $("#compliment").value.trim();
      if (c.length < 2) {
        play("bruh");
        $("#compliment").focus();
        return toast("That's not a compliment, that's silence 😶 type something nice", { error: true });
      }
      if (/^(mid|no|meh|bad|ok|وحش|مش بطال)$/i.test(c)) {
        play("cap");
        return toast("That's not a compliment, that's a review 💀 try again", { error: true });
      }
      extra.compliment = c;
    }
    order.payment_method = m.server;
    extra.fancy = m.en;
    go(6);
  });
}

// ---------- 7. Place: hold-to-confirm ring (resets once at 99%), fake progress, then the real order ----------
function buildNote() {
  const extras = [
    `📍 ${extra.floor}, ${extra.spot}${extra.desk ? ` (${extra.desk})` : ""}`,
    extra.chips.length && extra.chips.join(", "),
    extra.cutlery && "🍴 cutlery",
    extra.noDrama && "🧘 no drama (requested)",
    extra.fancy && `💳 ${extra.fancy}${extra.compliment ? `: "${extra.compliment}"` : ""}`,
  ].filter(Boolean).join(" · ");
  const user = order.note.trim();
  if (!user) return extras.slice(0, 200);
  const room = 200 - extras.length - 3;
  return room > 10 ? `${user.slice(0, room)} · ${extras}` : `${user.slice(0, 120)} · ${extras}`.slice(0, 200);
}

let placing = false;
function stepPlace() {
  const DUR = calm() ? 400 : 3000;
  panel(
    "🚀 بنبعت الطلب / Place your order",
    `<p>Hold the button for <b>${(DUR / 1000).toFixed(calm() ? 1 : 0)} seconds</b> to confirm. اتقل. Don't let go.</p>
     <div class="holdwrap">
       <button class="hold-ring" type="button" id="hold" aria-describedby="hold-help">
         <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="hold-ring__bg" cx="60" cy="60" r="52"/><circle class="hold-ring__fg" id="ring" cx="60" cy="60" r="52" pathLength="100"/></svg>
         <span class="hold-ring__face"><span class="hold-ring__emoji" aria-hidden="true">🍽️</span><span id="hold-text">HOLD</span><span class="hold-ring__count" id="hold-count">${(DUR / 1000).toFixed(1)}s</span></span>
       </button>
       <p id="hold-help" class="co-hint">Press &amp; hold (mouse / finger / Space) · or just press Enter</p>
     </div>
     <div class="progress" role="progressbar" aria-label="Sending your order" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden id="progress"><div class="progress__bar" id="bar"></div></div>
     <p id="status" aria-live="polite" class="co-status"></p>
     <ul class="recap">
       <li>👤 <span dir="auto">${esc(order.customer_name)}</span></li>
       <li>📍 ${esc(extra.floor)} · ${esc(extra.spot)}</li>
       <li>⏰ ~${extra.eta ?? "?"} min</li>
       <li>💳 ${esc(extra.fancy || "")}</li>
     </ul>`,
    backBtn(),
  );
  bindBack();
  placing = false;
  const btn = $("#hold");
  const ring = $("#ring");
  let raf = 0;
  let t0 = 0;
  let holding = false;
  let trolled = calm();
  const fill = (p) => {
    ring.style.strokeDashoffset = String(100 - p * 100);
    $("#hold-count").textContent = `${Math.max(0, ((1 - p) * DUR) / 1000).toFixed(1)}s`;
  };
  const start = () => {
    if (holding || placing) return;
    holding = true;
    t0 = performance.now();
    btn.classList.add("is-holding");
    $("#hold-text").textContent = "HOLDING…";
    vibrate(15);
    raf = requestAnimationFrame(tick);
  };
  const release = () => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    btn.classList.remove("is-holding");
    if (placing) return;
    fill(0);
    $("#hold-text").textContent = trolled && !calm() ? "AGAIN 😏" : "HOLD";
  };
  let lastSec = 3;
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / DUR);
    fill(p);
    const sec = Math.ceil(((1 - p) * DUR) / 1000);
    if (sec < lastSec) vibrate(10);
    lastSec = sec;
    if (!trolled && p > 0.99) {
      trolled = true;
      t0 = t;
      fill(0);
      lastSec = 3;
      $("#hold-text").textContent = "اتقل 😏 from the start";
      $("#status").textContent = "99%… lol no. Again from the start. Keep holding!";
      vibrate([80, 40, 80]);
      play("damage");
    } else if (p >= 1) {
      holding = false;
      vibrate(120);
      return place();
    }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    btn.setPointerCapture?.(e.pointerId);
    start();
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => btn.addEventListener(ev, release));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Keyboard users: Enter places the order directly
      e.preventDefault();
      if (!placing) place();
    } else if (e.key === " " && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      e.preventDefault();
      release();
    }
  });
}

async function place() {
  if (placing) return;
  placing = true;
  const btn = $("#hold");
  btn.disabled = true;
  btn.classList.add("is-done");
  $("#hold-text").textContent = "SENT 🚀";
  $("#ring").style.strokeDashoffset = "0";
  $("#back").disabled = true;
  $("#progress").hidden = false;
  const bar = $("#bar");
  const set = async (pct, text, ms) => {
    bar.style.transform = `scaleX(${pct / 100})`;
    $("#progress").setAttribute("aria-valuenow", pct);
    $("#status").textContent = text;
    await sleep(ms);
  };
  const request = api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: order.customer_name,
      payment_method: order.payment_method,
      note: buildNote(),
      items: getCart().map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })),
    }),
  });
  request.catch(() => {}); // handled below; avoid an unhandled rejection while the fake progress runs
  try {
    if (!calm()) {
      await set(35, "Calculating your regret…", 650);
      await set(72, "Asking HR for permission…", 650);
      await set(99, "Almost there… 99%…", 1000);
      play("what");
      await set(12, "Oops. 99% → 12%. Starting over. Skill issue (ours) 😭", 1000);
      await set(67, "6️⃣7️⃣…", 500);
    }
    const result = await request;
    await set(100, `Order #${result.order_number} placed. عاش يا وحش 🫡`, 150);
    saveCart([]);
    play("cash");
    setTimeout(() => play("celebrate"), 700);
    const url = `/order?n=${encodeURIComponent(result.order_number)}&dish=${encodeURIComponent(result.items[0].dish_id)}`;
    $("#step").innerHTML = `<section class="panel co-panel co-success" aria-labelledby="ok-title">
      <div class="co-success__big" aria-hidden="true">🍽️✅</div>
      <h2 id="ok-title" tabindex="-1">Order #${esc(result.order_number)} placed!</h2>
      <p>عاش يا وحش 🫡 Your coworker is being prepared. Taking you to the tracker…</p>
      <a class="btn red big" href="${url}">Track my order →</a></section>`;
    $("#ok-title").focus();
    announce(`Order number ${result.order_number} placed. Redirecting to the tracker.`);
    renderSummary();
    emojiBurst($(".co-success__big"));
    setTimeout(() => (location.href = url), calm() ? 700 : 1700);
  } catch (err) {
    await set(0, err.message, 0);
    toast(err.message, { error: true });
    play("faah");
    placing = false;
    btn.disabled = false;
    btn.classList.remove("is-done");
    $("#hold-text").textContent = "HOLD (retry)";
    $("#ring").style.strokeDashoffset = "100";
    $("#back").disabled = false;
  }
}

const STEP_FNS = [stepCart, stepYou, stepTime, stepCaptcha, stepTip, stepPay, stepPlace];

// Enter = next, except where Enter already means something (buttons, links, textareas, promo field, dialogs)
function enterIsNext(e) {
  if (e.key !== "Enter" || e.isComposing || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
  const t = e.target;
  if (!(t === document.body || t.closest?.("#step"))) return;
  if (t.closest?.("textarea, button, a, summary, select, dialog, [data-no-enter]")) return;
  if (current === 6 && $("#hold") && !$("#hold").disabled) {
    e.preventDefault();
    return place();
  }
  const next = $("#next");
  if (next && !next.disabled) {
    e.preventDefault();
    next.click();
  }
}

(async function boot() {
  $("#chef-slot").innerHTML = chefHtml;
  initCommon();
  try {
    [config, dishes] = await Promise.all([getConfig(), getDishes()]);
  } catch (err) {
    $("#step").innerHTML = `<p class="panel">${esc(err.message)}</p>`;
    return;
  }
  dishes = Array.isArray(dishes) ? dishes : [];
  dishes.forEach((d) => dishMap.set(d.id, d));
  const details = $("#sum-details");
  if (details && matchMedia("(min-width: 861px)").matches) details.open = true;
  document.addEventListener("cart:change", renderSummary);
  document.addEventListener("keydown", enterIsNext);
  $("#steps").addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b && Number(b.dataset.go) < current && !placing) go(Number(b.dataset.go));
  });
  go(0);
})();
