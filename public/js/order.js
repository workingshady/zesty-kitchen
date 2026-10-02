// Fake live tracker: a misbehaving ETA, a timeline that goes backwards, a courier lost in the office,
// a chat with the courier, and finally the dish itself calls you. calm() skips straight to "delivered".
import { $, api, esc, egp, toast, play, say, stopSpeaking, calm, pick, sleep, getDishes, fitImg, feesFor, initCommon, chefHtml } from "./common.js";

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
  coffee: [195, 66], coffeeDoor: [195, 150],
  meeting: [305, 80], meetingDoor: [325, 150],
  hr: [65, 262], hrDoor: [65, 150],
  bath: [210, 262], bathIn: [185, 232], bathDoor: [185, 150],
  lift: [23, 150],
  desk: [332, 258], deskIn: [320, 215], deskDoor: [320, 150],
};
// The route the app *promised* (same points as the dotted polyline in order.html)
const PLAN = [P.kitchen, P.kitchenDoor, P.deskDoor, P.deskIn, P.desk];

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

// ---------- live map ----------
// A fake "real" delivery map: constant-speed courier with a heading beam, an ETA chip that follows him,
// a pulsing "you" pin, route-left line, flaky GPS, zoom/follow camera and a few random detours per run.
const DESK = 40; // 1 "desk" = 40 SVG units. Official unit of office distance.
const YOU = [372, 266];
const M = {}; // cached map elements, filled in initMap()
const mapState = {
  stops: 0,
  batt: 23,
  chip: null, // text override for the ETA chip during detours
  lost: false, // GPS signal dropped
  lostFor: 0,
  glitch: false,
  nearby: false,
  said: "",
};
const cam = { z: 1, cx: 200, cy: 150, follow: false };
const ZOOMS = [1, 1.5, 2, 2.6];
let mapTimer = 0;

const setText = (el, text) => {
  if (el && el.textContent !== text) el.textContent = text;
};
const pct = ([x, y]) => [`${x / 4}%`, `${y / 3}%`];
const lengthOf = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
function mapSay(text) {
  // aria-live caption under the map; only for events, never per frame
  if (text === mapState.said) return;
  mapState.said = text;
  M.status.textContent = text;
}
function placeName([x, y]) {
  if (y > 104 && y < 196) return x < 40 ? "the haunted lift" : "the corridor";
  if (y <= 104) return x < 135 ? "the kitchen" : x < 255 ? "the coffee corner" : "the meeting room";
  return x < 125 ? "HR" : x < 245 ? "the bathroom queue" : "Desk #4";
}
// "lost signal near HR" sounds better than "near the corridor"
function nearName([x, y]) {
  const name = placeName([x, y]);
  if (name !== "the corridor") return name;
  return x < 130 ? "HR" : x < 250 ? "the coffee corner" : "the meeting room";
}
// Remaining route to Desk #4 along the corridor (what a real app would draw in blue)
function routeLeft([x, y]) {
  if (x > 248 && y > 196) return [[x, y], P.desk];
  const pts = [[x, y]];
  if (Math.abs(y - 150) > 1) pts.push([x, 150]);
  pts.push(P.deskDoor, P.deskIn, P.desk);
  return pts;
}

// ----- camera: zoom / follow / drag (CSS transform on the stage) -----
function applyCamera({ smooth = false } = {}) {
  const W = M.map.clientWidth;
  const H = M.map.clientHeight;
  if (!W) return;
  const s = W / 400;
  const z = cam.z;
  let tx = W / 2 - cam.cx * s * z;
  let ty = H / 2 - cam.cy * s * z;
  tx = Math.min(0, Math.max(W - W * z, tx));
  ty = Math.min(0, Math.max(H - H * z, ty));
  cam.cx = (W / 2 - tx) / (s * z);
  cam.cy = (H / 2 - ty) / (s * z);
  if (smooth && !calm()) {
    M.stage.classList.add("is-smooth");
    clearTimeout(applyCamera.t);
    applyCamera.t = setTimeout(() => M.stage.classList.remove("is-smooth"), 480);
  }
  M.stage.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${z})`;
  M.stage.style.setProperty("--inv", (1 / Math.sqrt(z)).toFixed(3)); // markers grow slower than the floor plan
  M.map.classList.toggle("is-zoomed", z > 1);
  setText(M.zoomLvl, `${z}×`);
  M.zoomIn.disabled = z >= ZOOMS[ZOOMS.length - 1];
  M.zoomOut.disabled = z <= ZOOMS[0];
}
function centerOn([x, y], smooth = false) {
  cam.cx = x;
  cam.cy = y;
  applyCamera({ smooth });
}
function zoomBy(dir) {
  const i = ZOOMS.indexOf(cam.z);
  cam.z = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))];
  if (cam.follow) centerOn(state.pos, true);
  else applyCamera({ smooth: true });
  mapSay(cam.z === 1 ? "Zoomed out. The whole office, in all its glory." : `Zoom ${cam.z}×. Still can't see your food.`);
}
function setFollow(on) {
  cam.follow = on;
  M.follow.setAttribute("aria-pressed", String(on));
  if (on) {
    if (cam.z < 2) cam.z = 2;
    centerOn(state.pos, true);
    mapSay(`Following the courier. He's in ${placeName(state.pos)}. Probably.`);
  }
}
const WHERE = [
  "He's right there. Stop refreshing. 🙄",
  "قريب… قريب جداً… (مش قريب)",
  "Your food is on a spiritual journey 🧘",
  "He can see your desk. He's choosing not to.",
  "Location: vibes. ETA: also vibes ✨",
  "asking won't make him faster bestie",
];
function whereIsMyFood() {
  play("sideeye");
  if (state.delivered) {
    cam.z = Math.max(cam.z, 2);
    centerOn(state.pos, true);
    bubble("ورايا يا باشا… I mean, behind you 👀", 3500);
    return mapSay("Your food is at Desk 4. Turn around.");
  }
  cam.z = Math.max(cam.z, 2);
  centerOn(state.pos, true);
  M.courier.classList.remove("is-found");
  void M.courier.offsetWidth; // restart the ping animation
  M.courier.classList.add("is-found");
  const line = mapState.lost ? `📡 no idea tbh. last seen near ${nearName(state.pos)}` : pick(WHERE);
  bubble(line, 3500);
  mapSay(`Courier located in ${placeName(state.pos)}. ${line}`);
}
function initCameraControls() {
  M.zoomIn.addEventListener("click", () => zoomBy(1));
  M.zoomOut.addEventListener("click", () => zoomBy(-1));
  M.follow.addEventListener("click", () => setFollow(!cam.follow));
  M.where.addEventListener("click", whereIsMyFood);
  // drag to pan when zoomed in (turns follow off, like every real map app)
  let drag = null;
  M.map.addEventListener("pointerdown", (e) => {
    if (cam.z === 1) return;
    drag = { x: e.clientX, y: e.clientY, cx: cam.cx, cy: cam.cy, moved: false };
    M.map.setPointerCapture(e.pointerId);
  });
  M.map.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const k = (M.map.clientWidth / 400) * cam.z;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved && cam.follow) setFollow(false);
    drag.moved = true;
    cam.cx = drag.cx - dx / k;
    cam.cy = drag.cy - dy / k;
    applyCamera();
  });
  const end = () => (drag = null);
  M.map.addEventListener("pointerup", end);
  M.map.addEventListener("pointercancel", end);
  addEventListener("resize", () => (cam.follow ? centerOn(state.pos) : applyCamera()));
}

// ----- courier marker, trail, ETA chip, stats -----
function placeCourier([x, y]) {
  state.pos = [x, y];
  const el = M.courier;
  [el.style.left, el.style.top] = pct([x, y]);
  // keep the speech bubble + ETA chip inside the map
  el.dataset.side = x < 110 ? "left" : x > 290 ? "right" : "mid";
  el.dataset.v = y < 100 ? "high" : y > 200 ? "low" : "mid";
  if (cam.follow && cam.z > 1) centerOn([x, y]);
  updateMapHud();
}
function drawTrail(extra) {
  const pts = (extra ? state.trail.concat([extra]) : state.trail).map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  M.trail.setAttribute("points", pts);
  M.trailUnder.setAttribute("points", pts);
}
function setChip(text) {
  mapState.chip = text;
  updateMapHud();
}
function updateMapHud() {
  const left = state.delivered ? [] : routeLeft(state.pos);
  M.routeLeft.setAttribute("points", left.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
  const desks = lengthOf(left) / DESK;
  setText(M.dist, state.delivered ? "0 desks · it's here" : desks < 0.6 ? "basically here" : `${desks.toFixed(1)} desks`);
  const near = !state.delivered && desks < 2.5;
  M.map.classList.toggle("is-nearby", near);
  if (near && !mapState.nearby) {
    mapState.nearby = true;
    mapSay("🔥 Courier is nearby. Act natural. Hide the evidence.");
  }
  let chip;
  if (state.delivered) chip = "✅ delivered (emotionally)";
  else if (mapState.chip) chip = mapState.chip;
  else if (mapState.lost) chip = "📡 last seen just now";
  else if (near) chip = "👀 nearby · act natural";
  else {
    const d = Math.max(1, Math.round(desks));
    chip = `${Math.max(1, Math.round(desks * 0.6))} min · ${d} desk${d === 1 ? "" : "s"} away`;
  }
  setText(M.chip, chip);
}
function setSpeed(unitsPerSec, label) {
  let text = label;
  if (!text) {
    if (!unitsPerSec) text = "0 km/h · vibing";
    else if (unitsPerSec >= 120) text = "6.7 km/h · panic 🏃";
    else if (unitsPerSec >= 80) text = "0.3 km/h · office chair 🪑";
    else text = "0.1 km/h · tea-powered ☕";
  }
  setText(M.speed, text);
  M.map.classList.toggle("is-moving", !!unitsPerSec);
}
function addStop() {
  mapState.stops += 1;
  setText(M.stops, `${mapState.stops}${mapState.stops >= 3 ? " (it's a tour now)" : ""}`);
}
function drainBattery() {
  mapState.batt = Math.max(3, mapState.batt - 1 - (Math.random() < 0.25 ? 1 : 0));
  const b = mapState.batt;
  setText(M.batt, b <= 8 ? `🪫 ${b}% · praying 🙏` : b <= 15 ? `${b}% · low power mode` : `${b}%`);
  M.batt.classList.toggle("is-low", b <= 15);
}
function setHeading(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (!dx && !dy) return;
  M.courier.style.setProperty("--hd", `${Math.round((Math.atan2(dy, dx) * 180) / Math.PI)}deg`);
  // the 🛵 emoji faces left, so mirror it when riding east; tilt it on vertical stretches
  if (Math.abs(dx) > 0.5) M.emoji.style.setProperty("--flip", dx > 0 ? "-1" : "1");
  M.emoji.style.setProperty("--tilt", Math.abs(dy) > Math.abs(dx) ? `${dy > 0 ? 12 : -12}deg` : "0deg");
}
// Trapezoid speed profile: short acceleration + braking, constant speed in between (like a real tracker).
const RAMP = 0.12;
const VMAX = 1 / (1 - RAMP);
const ease = (t) =>
  t < RAMP ? (VMAX * t * t) / (2 * RAMP) : t > 1 - RAMP ? 1 - (VMAX * (1 - t) ** 2) / (2 * RAMP) : VMAX * (t - RAMP / 2);

// Rides along a polyline (from the current spot through `points`) at `speed` SVG units per second.
async function walk(points, speed = 85) {
  if (calm()) throw new Skip();
  const path = [[...state.pos], ...points];
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const len = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    segs.push({ a: path[i - 1], b: path[i], len, start: total });
    total += len;
  }
  if (total < 0.5) return;
  const ms = (total / speed) * 1000 * SPEED * VMAX;
  setSpeed(speed);
  try {
    await new Promise((done, fail) => {
      const t0 = performance.now();
      let i = 0;
      const frame = (now) => {
        if (calm()) return fail(new Skip());
        const t = Math.min(1, (now - t0) / ms);
        const d = ease(t) * total;
        while (i < segs.length - 1 && d >= segs[i].start + segs[i].len) {
          state.trail.push([...segs[i].b]);
          i++;
        }
        const s = segs[i];
        const k = s.len ? Math.min(1, (d - s.start) / s.len) : 1;
        const p = [s.a[0] + (s.b[0] - s.a[0]) * k, s.a[1] + (s.b[1] - s.a[1]) * k];
        setHeading(s.a, s.b);
        placeCourier(p);
        drawTrail(p);
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  } finally {
    setSpeed(0);
  }
  state.trail.push([...path[path.length - 1]]);
  placeCourier(path[path.length - 1]);
  drawTrail();
}
let bubbleTimer = 0;
function bubble(text, ms = 3200) {
  const b = $("#bubble");
  b.textContent = text;
  b.hidden = false;
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => (b.hidden = true), ms * Math.max(SPEED, 0.6));
}

// ----- flaky GPS -----
function setSignal(ok) {
  mapState.lost = !ok;
  M.gps.classList.toggle("is-lost", !ok);
  M.courier.classList.toggle("is-ghost", !ok);
  if (ok) {
    M.bars.dataset.level = "3";
    setText(M.gpsText, "GPS: back (allegedly)");
  } else {
    M.bars.dataset.level = "0";
    const where = nearName(state.pos);
    setText(M.gpsText, `lost signal near ${where} 📡`);
    mapSay(`📡 Lost signal near ${where}. Courier is now a ghost 👻`);
  }
  updateMapHud();
}
function startMapTicker() {
  let n = 0;
  let nextDrop = 7 + Math.floor(Math.random() * 4);
  mapTimer = setInterval(() => {
    if (state.delivered || calm()) return clearInterval(mapTimer);
    n++;
    if (n % 6 === 0) drainBattery();
    if (mapState.glitch) return;
    if (mapState.lostFor > 0) {
      mapState.lostFor--;
      if (!mapState.lostFor) setSignal(true);
    } else if (n >= nextDrop) {
      mapState.lostFor = 2 + Math.floor(Math.random() * 2);
      nextDrop = n + 10 + Math.floor(Math.random() * 6);
      setSignal(false);
    } else {
      M.bars.dataset.level = String(1 + Math.floor(Math.random() * 4));
      if (n % 3 === 0) setText(M.gpsText, pick(["GPS: strong-ish", "GPS: vibing", "GPS: 1 bar of hope", "GPS: trust me bro"]));
    }
  }, 1000 * SPEED);
}

// ----- map effects -----
function fx(html, at, cls) {
  const el = document.createElement("div");
  el.className = `ot-fx__item ${cls}`;
  [el.style.left, el.style.top] = pct(at);
  el.innerHTML = html;
  M.fx.append(el);
  return el;
}
let flashTimer = 0;
function flash(text, kind) {
  const f = M.flash;
  f.textContent = text;
  f.className = `ot-mapflash ot-mapflash--${kind}`;
  f.hidden = false;
  M.map.classList.remove("is-alarm");
  if (kind === "alarm") {
    void M.map.offsetWidth;
    M.map.classList.add("is-alarm");
  }
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    f.hidden = true;
    M.map.classList.remove("is-alarm");
  }, 2800 * Math.max(SPEED, 0.6));
}

// Each run picks a few of these. Every detour starts and ends in the corridor.
const DETOURS = {
  async coffee() {
    await walk([P.coffeeDoor, P.coffee], 60);
    addStop();
    setSpeed(0, "0 km/h · sipping ☕");
    const steam = fx(`<span class="ot-steam__cup">☕</span><i></i><i></i><i></i>`, [P.coffee[0] + 18, P.coffee[1] + 6], "ot-steam");
    setChip("☕ tea break · +15 min");
    bubble("استنى بشرب شاي ☕", 4500);
    setStatus("Courier stopped at the coffee corner. Priorities.");
    mapSay("☕ Courier stopped at the coffee corner. Tea is apparently part of the route.");
    setEta(state.eta + 15 * 60, "+15 min · traffic in the corridor 🚧");
    play("bruh");
    try {
      await wait(2200);
      chatMsg("دقيقة واحدة بس 🙏 الشاي سخن");
      await wait(2300);
    } finally {
      steam.remove();
      setChip(null);
    }
    await walk([P.coffeeDoor]);
  },
  async hr() {
    await walk([P.hrDoor, P.hr]);
    addStop();
    setSpeed(0, "0 km/h · detained");
    flash("🚨 HR detected 🚨", "alarm");
    play("buzzer");
    bubble("مين؟ HR؟ 😳");
    setChip("🚨 in HR · culture fit check");
    setStatus("Wrong turn into HR. They're asking him about ‘culture fit’.");
    mapSay("🚨 Wrong turn: the courier entered HR. Pray for him.");
    try {
      await wait(3000);
    } finally {
      setChip(null);
    }
    await walk([P.hrDoor], 120);
  },
  async bathroom() {
    await walk([P.bathDoor, P.bathIn, P.bath]);
    addStop();
    setSpeed(0, "0 km/h · queueing 🚽");
    M.queue.classList.add("is-moving");
    bubble("في طابور الحمام 🚽");
    setChip("🚽 queue position: 5th");
    setStatus("Courier joined the bathroom queue. Position: 5th.");
    mapSay("🚽 Courier joined the bathroom queue. Position: 5th.");
    chatMsg("أنا تحت");
    try {
      for (const pos of ["4th", "3rd", "4th?? someone cut 😤"]) {
        await wait(1300);
        setChip(`🚽 queue position: ${pos}`);
      }
    } finally {
      M.queue.classList.remove("is-moving");
      setChip(null);
    }
    chatMsg("انت فين؟ 😭");
    await walk([P.bathIn, P.bathDoor]);
  },
  async lift() {
    await walk([P.lift]);
    addStop();
    setSpeed(0, "0 km/h · wrong axis (vertical)");
    M.courier.classList.add("is-lift");
    const sign = fx(`🛗 <b>1</b>`, [23, 100], "ot-liftsign");
    setChip("🛗 floor ?? · the map is 2D");
    setStatus("Elevator detour: he pressed every floor. Floor 7 has nothing. He went anyway.");
    mapSay("🛗 Courier took the lift. The map is 2D. He is now somewhere in the third dimension.");
    try {
      for (const f of ["2", "4", "7", "7½", "3", "1"]) {
        await wait(600);
        $("b", sign).textContent = f;
      }
    } finally {
      sign.remove();
      M.courier.classList.remove("is-lift");
      setChip(null);
    }
    bubble("الأسانسير بيكرهني 😤 floor 7 was empty");
    setEta(state.eta + 5 * 60, "+5 min · elevator lore 🛗");
    await wait(1200);
  },
  async meeting() {
    await walk([P.meetingDoor, P.meeting], 90);
    addStop();
    setSpeed(0, "0 km/h · synergizing");
    const invite = fx(`📅 <b>Quick sync</b><small>15 min (lie)</small>`, [390, 12], "ot-invite");
    bubble("this could've been an email 📧", 4000);
    setStatus("Pulled into a meeting. Someone said “quick sync”. 15 min.");
    mapSay("📊 Courier got pulled into a meeting. 15 minutes. Minimum.");
    setEta(-95, "Late. It's a feature, not a bug 🐛");
    try {
      for (const left of ["15:00", "14:59", "14:58", "pls unmute 🎤"]) {
        setChip(`📊 in a meeting · ${left}`);
        await wait(1000);
      }
    } finally {
      invite.remove();
      setChip(null);
    }
    await walk([P.meetingDoor], 110);
  },
  async reroute() {
    const x = Math.min(340, Math.max(60, state.pos[0])); // room for the lap inside the corridor
    flash("🔄 Recalculating… بيلف لفة", "reroute");
    M.map.classList.add("is-rerouting");
    M.courier.classList.add("is-spin");
    setChip("🔄 recalculating…");
    setStatus("Rerouting. The GPS said turn left. There is no left.");
    mapSay("🔄 Recalculating route. He's doing a full lap of the corridor. لفة كاملة.");
    play("run");
    try {
      await wait(900);
      const lap = [[x, 150]];
      for (let i = 1; i <= 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        lap.push([x + Math.sin(a) * 30, 150 - (1 - Math.cos(a)) * 19]);
      }
      await walk(lap, 110);
    } finally {
      M.map.classList.remove("is-rerouting");
      M.courier.classList.remove("is-spin");
      setChip(null);
    }
    bubble("بلف لفة بس 🔄 GPS said so");
    await wait(900);
  },
  async teleport() {
    const home = [...state.pos];
    mapState.glitch = true;
    mapState.lostFor = 0;
    M.courier.classList.add("is-glitch");
    flash("⚠️ GPS glitch · courier.exe stopped responding", "glitch");
    play("error");
    setChip("👻 teleported?? lag");
    setStatus("The courier teleported. Our engineers are calling it a feature.");
    mapSay("⚠️ GPS glitch: the courier teleported across the office. Then came back. Nobody saw anything.");
    try {
      await wait(700);
      placeCourier(pick([[372, 30], [28, 280], [222, 26]]));
      bubble("lag 💀 أنا فين؟", 2000);
      await wait(1700);
      placeCourier([home[0] + 40 > 380 ? home[0] - 40 : home[0] + 40, 150]);
      await wait(500);
    } finally {
      M.courier.classList.remove("is-glitch");
      mapState.glitch = false;
      placeCourier(home);
      setChip(null);
    }
    bubble("محصلش حاجة. nothing happened.");
    await wait(900);
  },
};
function planDetours() {
  const shuffled = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const first = pick(["coffee", "lift"]);
  const wrong = pick(["hr", "bathroom", "meeting"]);
  const rest = shuffled(["coffee", "lift", "hr", "bathroom", "meeting"].filter((d) => d !== first && d !== wrong));
  return { first, wrong, later: [rest[0], pick(["reroute", "teleport"]), rest[1]] };
}
const detour = (name) => DETOURS[name]();

// Final map state (also the whole map in chill mode): parked at Desk #4, nothing moves.
function settleMap() {
  clearInterval(mapTimer);
  M.fx.textContent = "";
  M.flash.hidden = true;
  M.map.classList.remove("is-alarm", "is-rerouting", "is-moving", "is-nearby");
  M.courier.classList.remove("is-ghost", "is-lift", "is-spin", "is-glitch");
  M.queue.classList.remove("is-moving");
  mapState.lost = false;
  mapState.chip = null;
  M.gps.classList.remove("is-lost");
  M.bars.dataset.level = "4";
  setText(M.gpsText, "GPS: connected (finally)");
  if (state.trail.length < 2) state.trail = PLAN.map((p) => [...p]); // chill mode: he took the planned route. Allegedly.
  setHeading(P.deskIn, P.desk);
  placeCourier(P.desk);
  setSpeed(0, "0 km/h · parked at your desk");
  mapSay("Courier parked at Desk #4. Route complete (eventually).");
}
function initMap() {
  for (const [key, sel] of Object.entries({
    map: "#map", stage: "#map-stage", courier: "#courier", emoji: "#courier-emoji", chip: "#eta-chip",
    trail: "#trail", trailUnder: "#trail-under", routeLeft: "#route-left", fx: "#map-fx", flash: "#map-flash",
    queue: "#bath-queue", gps: "#gps", bars: "#gps-bars", gpsText: "#gps-text", status: "#map-status",
    dist: "#stat-dist", speed: "#stat-speed", stops: "#stat-stops", batt: "#stat-batt",
    zoomIn: "#map-zoom-in", zoomOut: "#map-zoom-out", zoomLvl: "#map-zoom-lvl", follow: "#map-follow", where: "#map-where",
  })) M[key] = $(sel);
  const you = $("#you-pin");
  [you.style.left, you.style.top] = pct(YOU);
  initCameraControls();
  applyCamera();
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
  if (who === "them" && sound) play("notify");
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
    say(text, { arabic: true, interrupt: true });
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
  ["ألو؟ أيوه يا باشا، معاك أكلك", `Hello? It's me, ${d.name_ar}. Your food.`],
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
      stopSpeaking();
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
        // Wait for the line to finish (natural pacing); short pause when sound is off
        await Promise.all([say(ar, { arabic: true }), sleep(1600 * Math.max(SPEED, 0.5))]);
        await sleep(350 * Math.max(SPEED, 0.5));
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

  // the map journey: a few random detours from DETOURS each run
  const route = planDetours();
  setStep(2);
  setStatus("Picked up! Courier is leaving the kitchen on his office chair.");
  mapSay("🛵 Courier left the kitchen. Route: straight to Desk 4. (It will not be straight.)");
  setEta(6 * 60 + 7, "Faster than expected?? 🤨");
  await walk([P.kitchenDoor, [150, 150]]);
  bubble("ثانية واحدة…");
  await detour(route.first);

  setStep(3);
  setStatus("On the way! …the wrong way.");
  await detour(route.wrong);

  // progress goes backwards
  setStep(1);
  play("what");
  setStatus("⏪ Back to cooking: the coworker escaped from the bag 🏃 Chef is re-seasoning.");
  mapSay("⏪ U-turn! The coworker escaped from the bag. Courier sprinting back to the kitchen.");
  bubble("هرب!! 😱");
  chatMsg("the coworker escaped 💀");
  setEta(state.eta, "Recalculating… (it's giving 6–7)", "6–7 min");
  await walk([P.kitchenDoor, P.kitchen], 140);
  await wait(1500);
  voiceNote("يا باشا متقلقش، مسكته تاني. أنا جاي حالاً");
  await wait(2000);

  setStep(2);
  setStatus("Picked up (again). This time with a seatbelt.");
  await walk([P.kitchenDoor]);
  setStep(3);
  for (const name of route.later) await detour(name);

  setStatus("Final approach. He can smell your desk.");
  await walk([P.deskDoor, P.deskIn, P.desk], 90);
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
  if (state.trail.length > 1) state.trail.push([...P.desk]);
  settleMap();
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
    play("celebrate");
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
  initMap();
  placeCourier(P.kitchen);
  drawTrail();
  renderEta();
  renderChilis();
  initChat();
  initTrackForm();
  await loadDish();

  if (calm()) return deliver({ quiet: true });
  startEtaClock();
  startMapTicker();
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
