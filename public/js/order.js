// Fake live tracker: a misbehaving ETA, a timeline that goes backwards, a courier lost in the office,
// a chat with the courier, and finally the dish itself calls you. calm() skips straight to "delivered".
import { $, api, esc, egp, toast, play, say, calm, pick, sleep, getDishes, fitImg, feesFor, initCommon, chefHtml } from "./common.js";

const params = new URLSearchParams(location.search);
const orderNumber = (params.get("n") || "").replace(/\D/g, "").slice(0, 8) || "6767";
const dishId = params.get("dish");
// ?fast speeds the whole show up (handy for testing)
const SPEED = params.has("fast") ? 0.25 : 1;

const COURIER = "كابتن حمادة";
const FALLBACK_DISH = { name_ar: "طبق غامض", name_en: "Mystery coworker", price: 99, photo_url: "", job_title: "", catchphrase: "" };

const STEPS = [
  ["🧾", "Order received", "الطلب وصل"],
  ["👨‍🍳", "Chef is cooking your coworker", "الشيف بيطبخ زميلك"],
  ["🛍️", "Picked up", "الطيار استلم"],
  ["🛵", "On the way", "في الطريق"],
  ["✅", "Delivered", "وصل"],
];

// Map points in SVG units (viewBox 400 x 300). The corridor runs along y = 150.
const P = {
  kitchen: [70, 60], kitchenDoor: [70, 150],
  coffee: [195, 62], coffeeDoor: [195, 150],
  meeting: [372, 80], meetingDoor: [325, 150],
  hr: [65, 262], hrDoor: [65, 150],
  bath: [150, 250], bathDoor: [185, 150],
  desk: [355, 262], deskDoor: [320, 150],
};

const state = {
  dish: FALLBACK_DISH,
  step: 0,
  stamps: [], // time each step was reached (or null)
  undone: new Set(), // steps that got reverted, shown struck through
  eta: 25 * 60, // seconds, may go negative
  etaLabel: null, // text override like "6–7 min"
  pos: [...P.kitchen],
  trail: [[...P.kitchen]],
  delivered: false,
};

// ---------- small helpers ----------
class Skip extends Error {}
// Waits, but bails out of the chaos as soon as chill mode is switched on.
async function wait(ms) {
  if (calm()) throw new Skip();
  await sleep(ms * SPEED);
  if (calm()) throw new Skip();
}
const clock = (d = new Date()) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const mmss = (s) => {
  const a = Math.abs(Math.round(s));
  return `${s < 0 ? "−" : ""}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
};
function setStatus(text) {
  $("#status-text").textContent = text;
}

// ---------- ETA that misbehaves ----------
function renderEta() {
  const box = $("#eta-box");
  box.classList.toggle("late", state.eta < 0 && !state.etaLabel);
  $("#eta-time").textContent = state.delivered ? "0:00" : state.etaLabel || mmss(state.eta);
}
function setEta(seconds, note, label = null) {
  state.eta = seconds;
  state.etaLabel = label;
  if (note) $("#eta-note").textContent = note;
  const box = $("#eta-box");
  box.classList.remove("jolt");
  void box.offsetWidth; // restart the jolt animation
  box.classList.add("jolt");
  renderEta();
}
let etaTimer = 0;
function startEtaClock() {
  etaTimer = setInterval(() => {
    if (state.delivered) return clearInterval(etaTimer);
    state.eta -= 1 / SPEED;
    renderEta();
  }, 1000);
}

// ---------- timeline + progress bar ----------
function renderSteps() {
  $("#steps").innerHTML = STEPS.map(([icon, en, ar], i) => {
    const cls = i < state.step || state.delivered ? "done" : i === state.step ? "active" : "";
    const undone = state.undone.has(i) && i > state.step;
    const time = undone ? `<s>${state.stamps[i] || ""}</s> <span class="ot-undo">reverted</span>` : state.stamps[i] && i <= state.step ? state.stamps[i] : "—";
    return `<li class="ot-step ${cls}" ${i === state.step ? 'aria-current="step"' : ""}>
      <span class="ot-step__dot" aria-hidden="true">${icon}</span>
      <span class="ot-step__text"><b>${en}</b><small dir="rtl">${ar}</small></span>
      <span class="ot-step__time">${time}</span>
    </li>`;
  }).join("");
  $("#progress-bar").innerHTML = STEPS.map((_, i) => `<li class="${i < state.step || state.delivered ? "done" : i === state.step ? "active" : ""}"></li>`).join("");
}
function setStep(i) {
  if (i < state.step) {
    for (let k = i + 1; k <= state.step; k++) state.undone.add(k);
  } else {
    for (let k = state.step + 1; k <= i; k++) {
      state.stamps[k] = clock();
      state.undone.delete(k);
    }
  }
  state.step = i;
  renderSteps();
}

// ---------- courier on the map ----------
const courierEl = () => $("#courier");
function placeCourier([x, y]) {
  state.pos = [x, y];
  const el = courierEl();
  el.style.left = `${(x / 400) * 100}%`;
  el.style.top = `${(y / 300) * 100}%`;
  // keep the speech bubble inside the map
  el.dataset.side = x < 110 ? "left" : x > 290 ? "right" : "mid";
}
function drawTrail(extra) {
  const pts = extra ? state.trail.concat([extra]) : state.trail;
  $("#trail").setAttribute("points", pts.map((p) => p.join(",")).join(" "));
}
// Moves smoothly through a list of points at `speed` SVG units per second.
async function walk(points, speed = 85) {
  for (const target of points) {
    if (calm()) throw new Skip();
    const from = [...state.pos];
    const dist = Math.hypot(target[0] - from[0], target[1] - from[1]);
    const ms = (dist / speed) * 1000 * SPEED;
    if (target[0] !== from[0]) $("#courier-emoji").classList.toggle("flip", target[0] > from[0]);
    await new Promise((done) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / (ms || 1));
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
        const p = [from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e];
        placeCourier(p);
        drawTrail(p);
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
    state.trail.push([...target]);
    drawTrail();
  }
}
let bubbleTimer = 0;
function bubble(text, ms = 3200) {
  const b = $("#bubble");
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => (b.hidden = true), ms * Math.max(SPEED, 0.6));
}

// ---------- chat ----------
const REPLIES = [
  "حاضر يا باشا 🫡",
  "أنا تحت",
  "انت فين؟ 😭",
  "the coworker is being difficult ngl",
  "دقيقة واحدة بس (it's never one minute)",
  "ممكن تنزل؟ الأسانسير بيكرهني",
  "no cap I'm literally at the door (which door? all of them)",
  "بشرب الشاي وجاي ☕",
  "fr fr 2 min",
  "انا مش فاهم انت قولت ايه بس ماشي 👍",
  "HR stopped me again 💀",
  "ok but have you tried being less hungry",
  "😶",
];
const QUICK = ["فينك؟ 😤", "يلا بسرعة 🏃", "I'm literally starving", "bro you passed my desk 3 times"];

function chatMsg(html, who = "them", { sound = true } = {}) {
  const log = $("#chat-log");
  const m = document.createElement("div");
  m.className = `ot-msg ot-msg--${who}`;
  m.innerHTML = `<div class="ot-msg__bubble" dir="auto">${html}</div><span class="ot-msg__time">${clock()}${who === "me" ? " ✓✓" : ""}</span>`;
  log.append(m);
  log.scrollTop = log.scrollHeight;
  if (who === "them" && sound) play("pop");
  return m;
}
function voiceNote(text, secs = 7) {
  const m = chatMsg(
    `<button class="ot-voice" type="button" aria-label="Play voice note from the courier (${secs} seconds)">
       <span class="ot-voice__play" aria-hidden="true">▶️</span>
       <span class="ot-voice__wave" aria-hidden="true">${"<i></i>".repeat(14)}</span>
       <span class="ot-voice__len">0:${String(secs).padStart(2, "0")}</span>
     </button><span class="ot-voice__cap">🎤 sent a voice note</span>`,
  );
  const btn = $(".ot-voice", m);
  btn.addEventListener("click", () => {
    btn.classList.add("playing");
    say(text, { arabic: true, rate: 1.05 });
    setTimeout(() => btn.classList.remove("playing"), secs * 1000);
    toast(`🎤 "${text}"`);
  });
}
async function courierTyping(ms = 1400) {
  $("#typing").hidden = false;
  await sleep(ms * SPEED);
  $("#typing").hidden = true;
}
let replyBusy = false;
async function userSays(text) {
  chatMsg(esc(text), "me");
  if (replyBusy) return;
  replyBusy = true;
  await sleep(500);
  await courierTyping(900 + Math.random() * 1600);
  chatMsg(esc(state.delivered ? pick(["وصلتلك خلاص يا باشا 🫡", "rate me 5 chilies pls 🥺", "bye habibi 👋"]) : pick(REPLIES)));
  replyBusy = false;
}
function initChat() {
  $("#quick").innerHTML = QUICK.map((q) => `<button class="ot-chip" type="button" dir="auto">${esc(q)}</button>`).join("");
  $("#quick").addEventListener("click", (e) => {
    const b = e.target.closest(".ot-chip");
    if (b) userSays(b.textContent);
  });
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    userSays(text);
  });
  $("#open-chat").addEventListener("click", () => {
    $(".ot-chat").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
    $("#chat-input").focus({ preventScroll: true });
  });
  $("#call-courier").addEventListener("click", () => {
    play("no");
    toast(pick(["📵 الطيار مشغول… he's on a call with your food", "📞 The number you are calling is in the coffee corner", "📵 Declined. He saw it was you."]));
  });
}

// ---------- dish card ----------
async function loadDish() {
  let dish = null;
  if (dishId) dish = await api(`/api/dishes/${encodeURIComponent(dishId)}`).catch(() => null);
  if (!dish) dish = pick(await getDishes()) || null;
  state.dish = { ...FALLBACK_DISH, ...(dish || {}) };
  const d = state.dish;
  $("#dish-photo").innerHTML = d.photo_url ? fitImg(d.photo_url, d.name_en || d.name_ar) : `<span class="ot-dish__ph" aria-hidden="true">🍽️</span>`;
  $("#dish-name").innerHTML = `${esc(d.name_ar)}${d.name_en ? `<small dir="ltr">${esc(d.name_en)}</small>` : ""}`;
  $("#dish-meta").textContent = [`1 × ${egp(d.price || 0)}`, d.job_title].filter(Boolean).join(" · ");
  $("#dish-quote").textContent = d.catchphrase ? `“${d.catchphrase}”` : "“no comment.”";
}

// ---------- the phone call ----------
const TRANSCRIPT = (d) => [
  ["ألو؟ أيوه يا باشا، معاك " + d.name_ar, "Hello? It's me, your food."],
  ["بص، أنا وصلت مكتب ٤ بس انت مش موجود", "I'm at Desk 4. You're not. Where are you?"],
  ["والطيار سابني ونزل يشرب شاي", "The courier left me here and went for tea."],
  ["وأنا حاسس إني اتاكلت كتير النهارده", "Also I've been eaten a lot today. Emotionally."],
  ["خلاص، أنا سايب نفسي على الكيبورد بتاعك. باي 🙏", "I'm leaving myself on your keyboard. Bye."],
];

function callScreen(attempt) {
  const d = state.dish;
  const el = document.createElement("div");
  el.className = "ot-call";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "call-name");
  el.setAttribute("aria-describedby", "call-sub");
  el.innerHTML = `
    <div class="ot-call__bg" aria-hidden="true">${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : ""}</div>
    <div class="ot-call__top">
      ${attempt > 1 ? `<p class="ot-call__missed">📵 missed call ×${attempt - 1} · they're calling AGAIN</p>` : ""}
      <p class="ot-call__label" id="call-sub">Zesty Kitchen mobile · <span id="call-state">incoming call…</span></p>
      <h2 class="ot-call__name" id="call-name" dir="auto">${esc(d.name_ar)}</h2>
      <p class="ot-call__en">${esc(d.name_en || "")}</p>
      <div class="ot-call__face">${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="${esc(d.name_en || d.name_ar)}">` : "🍗"}</div>
      <p class="ot-call__timer" id="call-timer" hidden>00:00</p>
      <div class="ot-call__transcript" id="call-transcript" aria-live="polite"></div>
    </div>
    <div class="ot-call__extras" aria-hidden="true"><span>⏰<br>Remind me</span><span>💬<br>Message</span></div>
    <div class="ot-call__actions">
      <div class="ot-call__act"><button class="ot-round ot-round--no" type="button" id="call-decline" aria-label="Decline call">📵</button><span>Decline</span></div>
      <div class="ot-call__act" id="accept-wrap"><button class="ot-round ot-round--yes" type="button" id="call-accept" aria-label="Accept call">📞</button><span>Accept</span></div>
    </div>`;
  return el;
}

// Shows one call. Resolves "accepted" (after the conversation ends) or "declined" (also on timeout / Escape).
function incomingCall(attempt) {
  return new Promise((resolve) => {
    const lastFocus = document.activeElement;
    const el = callScreen(attempt);
    document.body.append(el);
    document.body.classList.add("ot-no-scroll");
    const ring = play("ring", { loop: true });
    const buzz = () => { try { navigator.vibrate?.([500, 250, 500]); } catch { /* not supported */ } };
    buzz();
    const buzzTimer = setInterval(buzz, 1600);
    const missTimer = setTimeout(() => decline(true), 18000 * Math.max(SPEED, 0.5));
    let timerTick = 0;
    let ended = false;

    const stopRinging = () => {
      ring?.pause();
      clearInterval(buzzTimer);
      clearTimeout(missTimer);
      try { navigator.vibrate?.(0); } catch { /* ignore */ }
    };
    const finish = (result) => {
      if (ended) return;
      ended = true;
      stopRinging();
      clearInterval(timerTick);
      window.speechSynthesis?.cancel();
      document.removeEventListener("keydown", onKey);
      el.classList.add("ot-call--out");
      setTimeout(() => {
        el.remove();
        document.body.classList.remove("ot-no-scroll");
        lastFocus?.focus?.({ preventScroll: true });
      }, 250);
      resolve(result);
    };
    function decline(missed = false) {
      if (el.classList.contains("in-call")) return finish("accepted");
      play("getout");
      toast(missed ? "📵 Missed call. Your food is now worried." : pick(["You declined your own food. Bold. 💀", "رفضت المكالمة؟ الأكل زعل 😤", "Declined. The coworker felt that."]));
      finish("declined");
    }
    async function accept() {
      stopRinging();
      el.classList.add("in-call");
      $("#call-state", el).textContent = "connected";
      $("#accept-wrap", el).remove();
      const hang = $("#call-decline", el);
      hang.setAttribute("aria-label", "Hang up");
      hang.nextElementSibling.textContent = "End";
      hang.focus();
      const t0 = Date.now();
      const timer = $("#call-timer", el);
      timer.hidden = false;
      timerTick = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        timer.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }, 500);
      const box = $("#call-transcript", el);
      for (const [ar, en] of TRANSCRIPT(state.dish)) {
        if (ended) return;
        const line = document.createElement("p");
        line.innerHTML = `<span dir="rtl">${esc(ar)}</span><small>${esc(en)}</small>`;
        box.append(line);
        box.scrollTop = box.scrollHeight;
        say(ar, { arabic: true });
        await sleep(2600 * Math.max(SPEED, 0.5));
      }
      if (!ended) {
        play("sad");
        $("#call-state", el).textContent = "call ended 💔";
        await sleep(1200);
        finish("accepted");
      }
    }
    function onKey(e) {
      if (e.key === "Escape") decline();
      if (e.key === "Tab") {
        // keep focus inside the call screen
        const btns = [...el.querySelectorAll("button")];
        const i = btns.indexOf(document.activeElement);
        e.preventDefault();
        btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
      }
    }
    document.addEventListener("keydown", onKey);
    $("#call-decline", el).addEventListener("click", () => decline());
    $("#call-accept", el).addEventListener("click", accept);
    $("#call-accept", el).focus();
  });
}

// ---------- the show ----------
async function chaos() {
  setStep(0);
  bubble("بسخّن الطاسة 🍳");
  await wait(3000);

  setStep(1);
  setStatus("The chef is seasoning your coworker 🧂 (they did not consent)");
  bubble("مستني الأكل 😴");
  await wait(2500);
  await courierTyping(1200);
  chatMsg(`السلام عليكم، معاك ${esc(COURIER)} 🛵 الطلب جاهز تقريباً`);
  await wait(2500);

  setStep(2);
  setStatus("Picked up! Courier is leaving the kitchen on his office chair.");
  setEta(6 * 60 + 7, "Faster than expected?? 🤨");
  await walk([P.kitchenDoor, [150, 150]]);
  bubble("ثانية واحدة…");
  await walk([P.coffeeDoor, P.coffee], 60);
  bubble("استنى بشرب شاي ☕", 4500);
  setStatus("Courier stopped at the coffee corner. Priorities.");
  setEta(state.eta + 15 * 60, "+15 min · traffic in the corridor 🚧");
  play("bruh");
  await wait(2000);
  chatMsg("دقيقة واحدة بس 🙏 الشاي سخن");
  await wait(2500);

  setStep(3);
  setStatus("On the way! …the wrong way.");
  await walk([P.coffeeDoor, P.hrDoor, P.hr]);
  bubble("مين؟ HR؟ 😳");
  setStatus("Wrong turn into HR. They're asking him about ‘culture fit’.");
  await wait(2500);

  // progress goes backwards
  setStep(1);
  play("what");
  setStatus("⏪ Back to cooking: the coworker escaped from the bag 🏃 Chef is re-seasoning.");
  bubble("هرب!! 😱");
  chatMsg("the coworker escaped 💀");
  setEta(state.eta, "Recalculating… (it's giving 6–7)", "6–7 min");
  await walk([P.hrDoor, P.kitchenDoor, P.kitchen], 140);
  await wait(1500);
  voiceNote("يا باشا متقلقش، مسكته تاني. أنا جاي حالاً");
  await wait(2000);

  setStep(2);
  setStatus("Picked up (again). This time with a seatbelt.");
  await walk([P.kitchenDoor]);
  setStep(3);
  await walk([P.meetingDoor, P.meeting], 90);
  bubble("this could've been an email 📧", 4000);
  setStatus("Stuck in the meeting room. Someone said “quick sync”.");
  setEta(-95, "Late. It's a feature, not a bug 🐛");
  await wait(3500);

  await walk([P.meetingDoor, P.bathDoor, P.bath], 90);
  bubble("في طابور الحمام 🚽");
  setStatus("Courier joined the bathroom queue. Position: 5th.");
  chatMsg("أنا تحت");
  await wait(2200);
  chatMsg("انت فين؟ 😭");
  await wait(2000);

  await walk([P.bathDoor, P.deskDoor, P.desk], 90);
  bubble("أنا عند مكتب ٤… فين انت؟", 5000);
  setStatus("Courier is at your desk. You are not at your desk. Classic.");
  await wait(2000);

  // the dish calls you. Decline once and they call again.
  setStatus("📞 Your food is calling you…");
  let result = await incomingCall(1);
  if (result === "declined") {
    await wait(2500);
    result = await incomingCall(2);
  }
  if (result === "declined") {
    toast("OK fine. They left it on your keyboard. 🫠", { ms: 4500 });
    chatMsg("سبتهولك على الكيبورد. متكلمنيش تاني 😤");
  }
}

function deliver({ quiet = false } = {}) {
  if (state.delivered) return;
  // jump everything to the final state
  state.delivered = true;
  for (let k = state.step + 1; k < STEPS.length; k++) state.stamps[k] = clock();
  state.step = STEPS.length - 1;
  state.undone.clear();
  renderSteps();
  setEta(0, "وصل خلاص · Delivered", "0:00");
  $("#eta-box").classList.add("arrived");
  placeCourier(P.desk);
  state.trail.push([...P.desk]);
  drawTrail();
  bubble("وصلت يا باشا 🫡", 0);
  $("#chat-presence").textContent = "⚪ offline (on break)";
  setStatus(quiet ? "Delivered. Chill mode skipped the drama 🫡" : "Delivered (emotionally). Look behind you. 👀");
  if (quiet && !$("#chat-log").children.length) chatMsg("سبتهولك على المكتب 🫡", "them", { sound: false });
  $("#done-text").innerHTML = `<b dir="auto">${esc(state.dish.name_ar)}</b> has arrived at Desk #4. Please do not make eye contact.`;
  renderReceipt();
  const done = $("#done");
  done.hidden = false;
  if (!quiet) {
    play("ka");
    done.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ---------- the end: rating + receipt ----------
function renderChilis() {
  const LINES = ["1🌶️ … HR has been notified.", "2🌶️ mid. The coworker saw that.", "3🌶️ respectable. Like a Tuesday.", "4🌶️ sheesh, almost aura.", "5🌶️ FULL AURA. Promote this coworker 🚀"];
  $("#chilis").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="ot-chili" type="button" data-n="${n}" aria-pressed="false" aria-label="${n} chil${n > 1 ? "ies" : "i"}">🌶️</button>`).join("");
  $("#chilis").addEventListener("click", (e) => {
    const b = e.target.closest(".ot-chili");
    if (!b) return;
    const n = Number(b.dataset.n);
    for (const c of $("#chilis").children) {
      c.classList.toggle("on", Number(c.dataset.n) <= n);
      c.setAttribute("aria-pressed", String(Number(c.dataset.n) === n));
    }
    play(n >= 4 ? "airhorn" : n <= 2 ? "sideeye" : "pop");
    toast(LINES[n - 1]);
  });
}
function renderReceipt() {
  const d = state.dish;
  const subtotal = Number(d.price) || 0;
  const { fees, total } = feesFor(subtotal);
  const row = (label, amount) => `<div class="ot-receipt__row"><span>${label}</span><span>${amount}</span></div>`;
  $("#receipt").innerHTML = `
    <p class="ot-receipt__head">ZESTY KITCHEN<br><small>Desk #4 · ${new Date().toLocaleDateString("en-GB")} ${clock()}</small></p>
    <p class="ot-receipt__num">ORDER #${esc(orderNumber)}</p>
    ${row(`1 × <span dir="auto">${esc(d.name_ar)}</span>`, egp(subtotal))}
    ${fees.map(([ar, en, amt]) => row(`${esc(en)}`, amt === 0 ? "−67 aura" : egp(amt))).join("")}
    ${row("Courier tip (he took it himself)", egp(6.7))}
    <div class="ot-receipt__row ot-receipt__total"><span>TOTAL</span><span>${egp(total + 6.7)}</span></div>
    <p class="ot-receipt__foot">Paid with: vibes 💳<br>No refunds. No eye contact. شكراً ❤️</p>`;
}
function initTrackForm() {
  $("#track-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = $("#track-input").value.replace(/\D/g, "").slice(0, 8);
    if (!n) return toast("Type an order number, not your feelings 🙂");
    const other = pick(await getDishes());
    location.href = `/order?n=${n}${other?.id ? `&dish=${encodeURIComponent(other.id)}` : ""}`;
  });
}

// ---------- boot ----------
async function run() {
  $("#order-num").textContent = orderNumber;
  document.title = `Order #${orderNumber} · Zesty Kitchen`;
  state.stamps[0] = clock();
  renderSteps();
  placeCourier(P.kitchen);
  drawTrail();
  renderEta();
  renderChilis();
  initChat();
  initTrackForm();
  await loadDish();

  if (calm()) return deliver({ quiet: true });
  startEtaClock();
  try {
    await chaos();
    deliver();
  } catch (err) {
    if (!(err instanceof Skip)) throw err;
    deliver({ quiet: true }); // chill mode was switched on mid-show
  }
}

$("#chef-slot").innerHTML = chefHtml;
initCommon();
run();
