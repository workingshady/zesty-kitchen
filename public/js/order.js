// Fake tracker: goes backwards once, courier wanders the office, then the dish calls you.
import { $, api, esc, toast, sfx, calm, initCommon, chefHtml } from "./common.js";

const STAGES = [
  ["👨‍🍳", "Preparing", "بيتجهز"],
  ["🛍️", "Picked up", "اتاخد"],
  ["🛵", "On the way", "في الطريق"],
  ["✅", "Delivered", "وصل"],
];
// Scripted journey: [stage index, status text, courier x, courier y]
const SCRIPT = [
  [0, "The chef is seasoning your coworker 🧂", 70, 120],
  [1, "Picked up! Courier is leaving the kitchen.", 140, 120],
  [2, "On the way… via the coffee corner ☕", 200, 120],
  [1, "Courier went back for a second coffee. Status: picked up (again) 🙃", 200, 115],
  [2, "Courier got lost near HR. It's giving… onboarding.", 100, 128],
  [2, "Stuck in the meeting room. This could've been an email.", 330, 120],
  [2, "Almost at Desk #4…", 290, 128],
];

const params = new URLSearchParams(location.search);
const orderNumber = params.get("n");
const dishId = params.get("dish");

function renderStage(active) {
  $("#tracker").innerHTML = STAGES.map(([icon, en, ar], i) => `<div class="${i < active ? "done" : i === active ? "active" : ""}">${icon}<br>${en}<br><small>${ar}</small></div>`).join("");
}

function moveCourier(x, y) {
  const c = $("#courier");
  c.setAttribute("x", x);
  c.setAttribute("y", y);
}

async function incomingCall() {
  let dish = null;
  if (dishId) dish = await api(`/api/dishes/${encodeURIComponent(dishId)}`).catch(() => null);
  const name = dish?.name_ar || "مطبخ زيستي";
  const el = document.createElement("div");
  el.className = "call";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Incoming call");
  el.innerHTML = `
    <div class="call__card">
      <div class="call__avatar">${dish?.photo_url ? `<img src="${esc(dish.photo_url)}" alt="">` : "🍗"}</div>
      <h2 dir="auto">${esc(name)}</h2>
      <p>incoming call… 📞</p>
      <p id="call-text" aria-live="polite"></p>
      <div class="call__actions">
        <button class="btn red" type="button" id="decline" aria-label="Decline">📵</button>
        <button class="btn slime" type="button" id="accept" aria-label="Accept">📞</button>
      </div>
    </div>`;
  document.body.append(el);
  sfx.add();
  $("#accept").focus();
  const close = () => el.remove();
  $("#decline").addEventListener("click", () => {
    close();
    toast("You declined your own food. Bold. 💀");
  });
  $("#accept").addEventListener("click", () => {
    $("#call-text").innerHTML = `<span dir="auto">"It's me, ${esc(name)}. I'm not coming. I have a meeting. 🙏"</span>`;
    $("#accept").remove();
    $("#decline").textContent = "😭";
    $("#decline").setAttribute("aria-label", "Hang up");
  });
}

async function run() {
  $("#title").textContent = orderNumber ? `Order #${orderNumber} placed 🎉` : "Order tracker";
  if (calm()) {
    renderStage(3);
    moveCourier(300, 150);
    $("#status-text").textContent = "Delivered. Chill mode skipped the drama 🫡";
    return;
  }
  for (const [stage, text, x, y] of SCRIPT) {
    renderStage(stage);
    moveCourier(x, y);
    $("#status-text").textContent = text;
    await new Promise((r) => setTimeout(r, 2200));
  }
  await incomingCall();
  renderStage(3);
  moveCourier(300, 150);
  $("#eta").textContent = "ETA: they're already at your desk. Look behind you. 👀";
  $("#status-text").textContent = "Delivered (emotionally).";
}

$("#chef-slot").innerHTML = chefHtml;
initCommon();
renderStage(0);
run();
