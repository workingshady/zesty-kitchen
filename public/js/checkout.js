// Chaos checkout: one annoyance per step, each gives up after a few tries. رايق (chill) mode skips them.
import { $, $$, api, esc, egp, toast, play, say, calm, pick, sleep, getConfig, getDishes, initCommon, chefHtml, getCart, saveCart, totalsHtml, avatarHtml } from "./common.js";

const STEPS = ["🛒 Cart", "👤 You", "⏰ Time", "🤖 Captcha", "💸 Tip", "💳 Pay", "🚀 Order"];
const order = { customer_name: "", note: "", payment_method: "" };
let config;
let current = 0;

function renderSteps() {
  $("#steps").innerHTML = STEPS.map((s, i) => `<li class="${i < current ? "done" : i === current ? "now" : ""}" ${i === current ? 'aria-current="step"' : ""}>${s}</li>`).join("");
}

function renderSummary() {
  const cart = getCart();
  $("#summary").innerHTML = cart.length
    ? `<div style="display:grid;gap:8px;margin-bottom:10px">${cart
        .map((l) => `<div style="display:flex;gap:8px;align-items:center">${avatarHtml(l)}<span dir="auto" style="flex:1"><b>${l.qty}× ${esc(l.name_ar)}</b><br><small>${esc(config.sizes[l.size]?.ar || "")}</small></span><b>${egp(l.unit_price * l.qty)}</b></div>`)
        .join("")}</div><div class="totals">${totalsHtml(cart)}</div>`
    : "<p>Empty. Like the fridge on Thursday. 🦗</p>";
}

function go(i) {
  current = i;
  renderSteps();
  renderSummary();
  [stepCart, stepYou, stepTime, stepCaptcha, stepTip, stepPay, stepPlace][i]();
  $("#step h2")?.focus();
  scrollTo({ top: 0 });
  play("pop");
}

const panel = (title, body, actions = "") => {
  $("#step").innerHTML = `<section class="panel"><h2 tabindex="-1">${title}</h2>${body}<div class="panel__actions">${actions}</div></section>`;
};
const backBtn = () => (current > 0 ? `<button class="btn white" type="button" id="back">← Back</button>` : `<a class="btn white" href="/">← Menu</a>`);
const bindBack = () => $("#back")?.addEventListener("click", () => go(current - 1));
const nextBtn = (label = "Continue →") => `<button class="btn red big" type="button" id="next">${label}</button>`;

// 1. Cart: "+" counts DOWN the first time.
let plusTrolled = false;
function stepCart() {
  const cart = getCart();
  if (!cart.length) {
    panel("Your cart is empty 🦗", "<p>Delulu checkout. Go order a coworker first.</p>", `<a class="btn red" href="/">Back to menu</a>`);
    return;
  }
  panel(
    "🛒 راجع طلبك / Check your order",
    `<div style="display:grid;gap:10px">${cart
      .map(
        (l, i) => `<div class="line">${avatarHtml(l)}<div><strong dir="auto">${esc(l.name_ar)}</strong><br><small>${esc(config.sizes[l.size]?.ar || "")}</small></div><strong>${egp(l.unit_price * l.qty)}</strong>
        <div class="line__actions"><div class="stepper"><button type="button" data-i="${i}" data-q="-1" aria-label="Less">−</button><output>${l.qty}</output><button type="button" data-i="${i}" data-q="1" aria-label="More">+</button></div></div></div>`,
      )
      .join("")}</div>`,
    `${backBtn()}${nextBtn()}`,
  );
  $(".panel").addEventListener("click", onQty);
  $("#next").addEventListener("click", () => go(1));
}

function onQty(e) {
  const q = Number(e.target.dataset.q);
  if (!q) return;
  const cart = getCart();
  const line = cart[Number(e.target.dataset.i)];
  let delta = q;
  if (q > 0 && !plusTrolled && !calm()) {
    plusTrolled = true;
    delta = -1;
    toast("Oops, the + button is left-handed. Try again 🙃");
    play("bruh");
  }
  line.qty = Math.min(9, Math.max(1, line.qty + delta));
  saveCart(cart);
  stepCart();
  renderSummary();
}

// 2. You: name + note + phone by slider (phone never sent anywhere).
function stepYou() {
  let drags = 0;
  panel(
    "👤 مين هياكل؟ / Who's eating?",
    `<label class="field">Your name / اسمك <input id="name" maxlength="40" dir="auto" value="${esc(order.customer_name)}" autocomplete="nickname" placeholder="e.g. Unc Hossam"></label>
     <label class="field" style="margin-top:10px">Note for the kitchen (optional) <textarea id="note" maxlength="200" rows="2" dir="auto" placeholder="no onions, no drama, no HR">${esc(order.note)}</textarea></label>
     <h3 style="margin-top:16px">📱 رقم الموبايل / Phone</h3>
     <p>Slide to your number. Totally normal UX. (We don't save it 🤫)</p>
     <div class="phone-display" id="phone">01000000000</div>
     <input type="range" id="slider" min="0" max="9999999999" step="1" value="1000000000" aria-label="Phone number slider">
     <div id="fine" ${calm() ? "" : "hidden"} style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px">
       <button class="btn white" type="button" data-d="-1">−1</button><button class="btn white" type="button" data-d="1">+1</button>
       <button class="btn white" type="button" data-d="-1000">−1000</button><button class="btn white" type="button" data-d="1000">+1000</button>
     </div>`,
    `${backBtn()}${nextBtn()}`,
  );
  bindBack();
  const slider = $("#slider");
  const show = () => ($("#phone").textContent = `0${String(slider.value).padStart(10, "0")}`);
  slider.addEventListener("input", show);
  slider.addEventListener("change", () => {
    if (++drags === 3) {
      $("#fine").hidden = false;
      toast("Fine, here are some buttons. Weak 🙄");
    }
  });
  $("#fine").addEventListener("click", (e) => {
    const d = Number(e.target.dataset.d);
    if (!d) return;
    slider.value = Math.min(9999999999, Math.max(0, Number(slider.value) + d));
    show();
  });
  $("#next").addEventListener("click", () => {
    const name = $("#name").value.trim();
    if (!name) {
      play("faah");
      return toast("skill issue: we need a name 😤", { error: true });
    }
    order.customer_name = name;
    order.note = $("#note").value.trim();
    go(2);
  });
}

// 3. Delivery time: higher or lower. Accepts after 4 guesses.
function stepTime() {
  const target = 5 + Math.floor(Math.random() * 115);
  let guess = 60;
  let tries = 0;
  panel(
    "⏰ ميعاد التوصيل / Delivery time",
    `<p>We already picked your delivery time. Guess it 🎯 (minutes)</p>
     <div class="guess" id="guess" aria-live="polite">${guess}</div>
     <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
       <button class="btn white" type="button" data-g="-10">−10</button><button class="btn white" type="button" data-g="-1">−1</button>
       <button class="btn white" type="button" data-g="1">+1</button><button class="btn white" type="button" data-g="10">+10</button>
     </div>
     <p id="hint" aria-live="polite" style="text-align:center;font-weight:700"></p>`,
    `${backBtn()}${nextBtn("Lock it in 🔒")}`,
  );
  bindBack();
  $(".panel").addEventListener("click", (e) => {
    const g = Number(e.target.dataset.g);
    if (!g) return;
    guess = Math.min(180, Math.max(1, guess + g));
    $("#guess").textContent = guess;
  });
  $("#next").addEventListener("click", () => {
    tries++;
    if (calm() || guess === target || tries >= 4) {
      toast(guess === target ? "NO WAY. Correct. Aura +1000 🔥" : `Close enough. It was ${target} min. Delulu delivery time it is.`);
      play(guess === target ? "airhorn" : "boom");
      return go(3);
    }
    $("#hint").textContent = guess < target ? "⬆️ أعلى. Think bigger. Think HR." : "⬇️ أقل. We're not THAT slow.";
    play("error");
  });
}

// 4. Captcha: "Select all images with X". Every tile is X.
async function stepCaptcha() {
  let fails = 0;
  const dishes = (await getDishes()).filter((d) => !d.badges.includes("sold_out"));
  const star = dishes.find((d) => d.photo_url) || dishes[0];
  panel(
    "🤖 إنت بني آدم؟ / Are you human?",
    `<p><strong>Select ALL squares with <span dir="auto">${esc(star?.name_ar || "the coworker who microwaves fish 🐟")}</span></strong></p>
     <div class="captcha-grid">${Array.from({ length: 9 }, (_, i) => `<button type="button" aria-pressed="false" aria-label="Tile ${i + 1}">${star?.photo_url ? `<img src="${esc(star.photo_url)}" alt="" style="transform:rotate(${(i % 3) * 90}deg) scale(${1 + (i % 2) * 0.3})">` : ["🐟", "🍗", "🥙", "🍚", "🌯", "🦐", "🧆", "🍲", "🫕"][i]}</button>`).join("")}</div>
     <p id="cap-msg" aria-live="polite" style="font-weight:700"></p>`,
    `${backBtn()}${nextBtn("Verify ✅")}`,
  );
  bindBack();
  $(".captcha-grid").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  });
  $("#next").addEventListener("click", () => {
    const picked = $$(".captcha-grid [aria-pressed=true]").length;
    if (calm() || fails >= 1 || picked === 9) {
      toast(picked === 9 ? "Correct. It was them ALL ALONG 😱" : "Verified. You're human enough 🫡");
      play("boom");
      return go(4);
    }
    fails++;
    $("#cap-msg").textContent = picked ? `Wrong. They're in ALL 9 squares. Look again 👀` : "Pick at least one. We know you know who it is 👀";
    $(".captcha-grid").classList.remove("shake");
    void $(".captcha-grid").offsetWidth;
    $(".captcha-grid").classList.add("shake");
    play("faah");
  });
}

// 5. Tip slider with absurd stops + split with HR (can't uncheck) + scratch coupon.
function stepTip() {
  const stops = ["0% 💀", "15%", "67% 6️⃣7️⃣", "420%", "كليتك 🫘 (your kidney)"];
  panel(
    "💸 البقشيش / Tip the chef",
    `<div class="tip-value" id="tip" aria-live="polite">${stops[2]}</div>
     <input type="range" id="tip-slider" min="0" max="4" step="1" value="2" aria-label="Tip">
     <p style="text-align:center"><small>Tips are not charged. The chef just wants to feel something.</small></p>
     <label class="check-row"><input type="checkbox" id="hr" checked> <span><b>Split the bill with HR / خصمها من المرتب</b><br><small>Recommended by HR</small></span></label>
     <h3 style="margin-top:18px">🎟️ Scratch your coupon / اكشط الكوبون</h3>
     <div class="scratch" id="scratch"><span>كوبون: فكّك<br><small style="font-size:.9rem">0% off. Better luck never.</small></span><canvas id="scratch-canvas" width="320" height="160"></canvas></div>`,
    `${backBtn()}${nextBtn()}`,
  );
  bindBack();
  const slider = $("#tip-slider");
  slider.addEventListener("input", () => ($("#tip").textContent = stops[slider.value]));
  slider.addEventListener("change", () => {
    if (calm() || slider.value === "2") return;
    setTimeout(() => {
      slider.value = 2;
      $("#tip").textContent = stops[2];
      toast("Tip snapped back to 67%. The algorithm has spoken 6️⃣7️⃣");
      play("boom");
    }, 600);
  });
  $("#hr").addEventListener("change", (e) => {
    if (calm()) return;
    e.target.checked = true;
    toast("HR said no. HR always says no 🙅");
    play("bruh");
  });
  setupScratch();
  $("#next").addEventListener("click", () => go(5));
}

function setupScratch() {
  const cv = $("#scratch-canvas");
  const g = cv.getContext("2d");
  g.fillStyle = "#b8b8b8";
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#555";
  g.font = "bold 22px sans-serif";
  g.textAlign = "center";
  g.fillText("اكشط هنا · SCRATCH ME 🪙", cv.width / 2, cv.height / 2 + 8);
  g.globalCompositeOperation = "destination-out";
  let down = false;
  let revealed = false;
  const scratch = (e) => {
    if (!down) return;
    const r = cv.getBoundingClientRect();
    g.beginPath();
    g.arc(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height, 18, 0, Math.PI * 2);
    g.fill();
    if (!revealed && Math.random() < 0.04) {
      revealed = true;
      setTimeout(() => {
        play("sad");
        toast("كوبون: فكّك. 0% off. Skill issue 💀");
      }, 600);
    }
  };
  cv.addEventListener("pointerdown", (e) => {
    down = true;
    cv.setPointerCapture(e.pointerId);
    scratch(e);
  });
  cv.addEventListener("pointermove", scratch);
  cv.addEventListener("pointerup", () => (down = false));
}

// 6. Payment: fake methods only. No card fields, ever.
function stepPay() {
  const labels = { vibes: ["✨ Pay with vibes", "الدفع بالفيبز"], insults: ["🗯️ Cash (of insults)", "كاش… شتايم"], owe_lunch: ["🍔 Owe them lunch", "عليا غدا"] };
  panel(
    "💳 الدفع / Payment",
    `<div class="pay-options" role="radiogroup">${config.payment_methods
      .map((m) => `<label class="chip"><input type="radio" name="pay" value="${m}" ${order.payment_method === m ? "checked" : ""}><span><b>${labels[m][0]}</b><small>${labels[m][1]}</small></span></label>`)
      .join("")}</div>`,
    `${backBtn()}${calm() ? "" : `<button class="btn slime big" type="button" id="no-btn">NO</button>`}<button class="tiny-link" type="button" id="next">continue</button>`,
  );
  bindBack();
  $("#no-btn")?.addEventListener("click", () => {
    toast("You clicked NO. Respect. But you still have to pay 💅");
    play("bruh");
  });
  $("#next").addEventListener("click", () => {
    const m = $("[name=pay]:checked");
    if (!m) {
      play("faah");
      return toast("skill issue: pick a payment method", { error: true });
    }
    order.payment_method = m.value;
    go(6);
  });
}

// 7. Hold-to-confirm (resets once at 99%), fake progress, then the real order.
function stepPlace() {
  panel(
    "🚀 بنبعت الطلب / Place your order",
    `<p>Hold the button for 3 seconds to confirm. اتقل. Don't let go.</p>
     <button class="btn big red hold" type="button" id="hold"><span class="hold__fill" id="hold-fill"></span><span id="hold-text">اضغط مطوّل / HOLD to order 🍽️</span></button>
     <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden id="progress"><div class="progress__bar" id="bar"></div></div>
     <p id="status" aria-live="polite" style="font-weight:700"></p>`,
    backBtn(),
  );
  bindBack();
  const btn = $("#hold");
  let raf = 0;
  let t0 = 0;
  let trolled = calm();
  const fill = (p) => ($("#hold-fill").style.width = `${p * 100}%`);
  const release = () => {
    cancelAnimationFrame(raf);
    if (btn.disabled) return;
    fill(0);
  };
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / (calm() ? 300 : 3000));
    fill(p);
    if (!trolled && p > 0.99) {
      trolled = true;
      fill(0);
      t0 = t;
      $("#hold-text").textContent = "اتقل 😏 again from the start";
      play("faah");
    } else if (p >= 1) {
      btn.disabled = true;
      return place();
    }
    raf = requestAnimationFrame(tick);
  };
  btn.addEventListener("pointerdown", () => {
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, release));
  btn.addEventListener("keydown", (e) => {
    // Keyboard users: Enter places the order directly
    if (e.key === "Enter" && !btn.disabled) {
      btn.disabled = true;
      place();
    }
  });
}

async function place() {
  $("#back").disabled = true;
  $("#progress").hidden = false;
  const bar = $("#bar");
  const set = async (pct, text, ms) => {
    bar.style.width = `${pct}%`;
    $("#progress").setAttribute("aria-valuenow", pct);
    $("#status").textContent = text;
    await sleep(ms);
  };
  const request = api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ ...order, items: getCart().map(({ dish_id, size, addons, qty }) => ({ dish_id, size, addons, qty })) }),
  });
  try {
    if (!calm()) {
      await set(35, "Calculating your regret…", 700);
      await set(72, "Asking HR for permission…", 700);
      await set(99, "Almost there… 99%…", 1200);
      play("ohno");
      await set(12, "Oops. Starting over. Skill issue (ours) 😭", 1100);
      await set(67, "6️⃣7️⃣…", 600);
    }
    const result = await request;
    await set(100, `Order #${result.order_number} placed. عاش يا وحش 🫡`, 300);
    saveCart([]);
    play("airhorn");
    say("عاش يا وحش، الأوردر وصل", { arabic: true });
    if (!calm() && window.JSConfetti) {
      await new JSConfetti().addConfetti({ emojis: ["🍗", "🌯", "🍚", "🌶️", "🍋", "💅", "🫘"], emojiSize: 60, confettiNumber: 90 });
    }
    location.href = `/order?n=${result.order_number}&dish=${encodeURIComponent(result.items[0].dish_id)}`;
  } catch (err) {
    await set(0, err.message, 0);
    toast(err.message, { error: true });
    play("faah");
    $("#hold").disabled = false;
    $("#back").disabled = false;
  }
}

(async function boot() {
  $("#chef-slot").innerHTML = chefHtml;
  initCommon();
  try {
    config = await getConfig();
  } catch (err) {
    $("#step").innerHTML = `<p class="panel">${esc(err.message)}</p>`;
    return;
  }
  document.addEventListener("cart:change", renderSummary);
  go(0);
})();
