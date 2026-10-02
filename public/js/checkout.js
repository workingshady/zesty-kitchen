// Chaos checkout: one annoyance per step, each gives up after a few tries. Chill mode skips them.
import { $, $$, api, esc, egp, toast, sfx, calm, getConfig, initCommon, chefHtml, getCart, saveCart, totalsHtml } from "./common.js";

const STEPS = ["Cart", "Name", "Phone", "Time", "Captcha", "Pay", "Order"];
const order = { customer_name: "", note: "", payment_method: "" };
let config;
let current = 0;

function renderSteps() {
  $("#steps").innerHTML = STEPS.map((s, i) => `<li class="${i < current ? "done" : i === current ? "now" : ""}" ${i === current ? 'aria-current="step"' : ""}>${i + 1}. ${s}</li>`).join("");
}

function go(i) {
  current = i;
  renderSteps();
  [stepCart, stepName, stepPhone, stepTime, stepCaptcha, stepPay, stepPlace][i]();
  $("#step").querySelector("h2")?.focus();
  scrollTo({ top: 0 });
}

const panel = (title, body, actions = "") => {
  $("#step").innerHTML = `<section class="panel"><h2 tabindex="-1">${title}</h2>${body}<div class="panel__actions">${actions}</div></section>`;
};
const backBtn = () => (current > 0 ? `<button class="btn white" type="button" id="back">← Back</button>` : `<a class="btn white" href="/">← Menu</a>`);
const bindBack = () => $("#back")?.addEventListener("click", () => go(current - 1));

// 1. Cart: "+" counts DOWN the first time.
let plusTrolled = false;
function stepCart() {
  const cart = getCart();
  if (!cart.length) {
    panel("Your cart is empty 🦗", "<p>Delulu checkout. Go order a coworker first.</p>", `<a class="btn red" href="/">Back to menu</a>`);
    return;
  }
  panel(
    "🛒 Your order / طلبك",
    `<div class="drawer__items" style="padding:0">${cart
      .map(
        (l, i) => `<div class="line"><div><strong dir="auto">${esc(l.name_ar)}</strong> <small>${esc(config.sizes[l.size]?.ar || "")}</small></div><strong>${egp(l.unit_price * l.qty)}</strong>
        <div class="stepper"><button type="button" data-i="${i}" data-q="-1" aria-label="Less">−</button><output>${l.qty}</output><button type="button" data-i="${i}" data-q="1" aria-label="More">+</button></div></div>`,
      )
      .join("")}</div>
     <div class="totals" style="margin-top:14px">${totalsHtml(cart)}</div>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">Continue →</button>`,
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
  }
  line.qty = Math.min(9, Math.max(1, line.qty + delta));
  saveCart(cart);
  stepCart();
}

// 2. Name: normal, for once.
function stepName() {
  panel(
    "👤 Who's eating? / مين هياكل؟",
    `<label class="field">Your name <input id="name" maxlength="40" dir="auto" value="${esc(order.customer_name)}" autocomplete="nickname"></label>
     <label class="field">Note for the kitchen (optional) <textarea id="note" maxlength="200" rows="2" dir="auto" placeholder="no onions, no drama">${esc(order.note)}</textarea></label>
     <p><small>This step is normal. Enjoy it while it lasts.</small></p>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">Continue →</button>`,
  );
  bindBack();
  $("#next").addEventListener("click", () => {
    const name = $("#name").value.trim();
    if (!name) return toast("skill issue: we need a name", { error: true });
    order.customer_name = name;
    order.note = $("#note").value.trim();
    go(2);
  });
}

// 3. Phone by slider. Never sent anywhere.
function stepPhone() {
  let drags = 0;
  panel(
    "📱 Phone number / رقم الموبايل",
    `<p>Slide to your number. Totally normal UX. (We don't save it.)</p>
     <div class="phone-display" id="phone">01000000000</div>
     <input type="range" id="slider" min="0" max="9999999999" step="1" value="1000000000" aria-label="Phone number slider">
     <div id="fine" ${calm() ? "" : "hidden"} style="display:flex;gap:8px;justify-content:center;margin-top:10px">
       <button class="btn white" type="button" data-d="-1">−1</button><button class="btn white" type="button" data-d="1">+1</button>
       <button class="btn white" type="button" data-d="-1000">−1000</button><button class="btn white" type="button" data-d="1000">+1000</button>
     </div>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">That's my number →</button>`,
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
  $("#next").addEventListener("click", () => go(3));
}

// 4. Delivery time: higher or lower. Accepts after 4 guesses.
function stepTime() {
  const target = 5 + Math.floor(Math.random() * 115);
  let guess = 60;
  let tries = 0;
  panel(
    "⏰ Delivery time / ميعاد التوصيل",
    `<p>We already picked your delivery time. Guess it. 🎯 (minutes)</p>
     <div class="guess" id="guess" aria-live="polite">${guess}</div>
     <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
       <button class="btn white" type="button" data-g="-10">−10</button><button class="btn white" type="button" data-g="-1">−1</button>
       <button class="btn white" type="button" data-g="1">+1</button><button class="btn white" type="button" data-g="10">+10</button>
     </div>
     <p id="hint" aria-live="polite"></p>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">Lock it in 🔒</button>`,
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
      return go(4);
    }
    $("#hint").textContent = guess < target ? "⬆️ Higher. Think bigger. Think HR." : "⬇️ Lower. We're not THAT slow.";
    sfx.error();
  });
}

// 5. Captcha: pick the coworker who microwaves fish. Any answer after 2 fails.
async function stepCaptcha() {
  let fails = 0;
  let dishes = [];
  try {
    dishes = await api("/api/dishes");
  } catch {
    /* emoji-only captcha */
  }
  const tiles = Array.from({ length: 9 }, (_, i) => dishes[i % (dishes.length || 1)]);
  panel(
    "🤖 Are you human? / إنت بني آدم؟",
    `<p><strong>Select ALL squares with the coworker who microwaves fish 🐟</strong></p>
     <div class="captcha-grid">${tiles
       .map((d, i) => `<button type="button" aria-pressed="false" data-i="${i}" aria-label="Tile ${i + 1}">${d?.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : ["🐟", "🍗", "🥙", "🍚", "🌯", "🦐", "🧆", "🍲", "🫕"][i]}</button>`)
       .join("")}</div>
     <p id="cap-msg" aria-live="polite"></p>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">Verify ✅</button>`,
  );
  bindBack();
  $(".captcha-grid").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
  });
  $("#next").addEventListener("click", () => {
    const picked = $$(".captcha-grid [aria-pressed=true]").length;
    if (calm() || fails >= 2) {
      toast("Verified. You're human enough 🫡");
      return go(5);
    }
    fails++;
    const msgs = [picked ? "Wrong. That person microwaves broccoli. Try again." : "Pick at least one. We know you know who it is 👀", "Still wrong. Are you a robot? 🤖 One more try."];
    $("#cap-msg").textContent = msgs[fails - 1];
    $(".captcha-grid").classList.remove("shake");
    void $(".captcha-grid").offsetWidth;
    $(".captcha-grid").classList.add("shake");
    sfx.error();
  });
}

// 6. Payment: fake methods only. No card fields, ever.
function stepPay() {
  const labels = { vibes: ["✨ Pay with vibes", "الدفع بالفيبز"], insults: ["🗯️ Cash (of insults)", "كاش… شتايم"], owe_lunch: ["🍔 Owe them lunch", "عليا غدا"] };
  panel(
    "💸 Payment / الدفع",
    `<div class="pay-options" role="radiogroup">${config.payment_methods
      .map((m) => `<label class="chip"><input type="radio" name="pay" value="${m}" ${order.payment_method === m ? "checked" : ""}><span style="width:100%">${labels[m][0]} / ${labels[m][1]}</span></label>`)
      .join("")}</div>
     <div class="totals" style="margin-top:14px">${totalsHtml(getCart())}</div>`,
    `${backBtn()}${calm() ? "" : `<button class="btn slime big" type="button" id="no-btn">NO</button>`}<button class="tiny-link" type="button" id="next">continue</button>`,
  );
  bindBack();
  $("#no-btn")?.addEventListener("click", () => toast("You clicked NO. Respect. But you still have to pay 💅"));
  $("#next").addEventListener("click", () => {
    const m = $("[name=pay]:checked");
    if (!m) return toast("skill issue: pick a payment method", { error: true });
    order.payment_method = m.value;
    go(6);
  });
}

// 7. Place order: progress bar to 99%, back to 12%, then done.
function stepPlace() {
  panel(
    "🚀 Placing your order / بنبعت الطلب",
    `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress__bar" id="bar"></div></div>
     <p id="status" aria-live="polite">Waking up the chef…</p>`,
    `${backBtn()}<button class="btn red big" type="button" id="next">Place order 🍽️</button>`,
  );
  bindBack();
  $("#next").addEventListener("click", place);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function place() {
  const btn = $("#next");
  btn.disabled = true;
  $("#back").disabled = true;
  const bar = $("#bar");
  const set = async (pct, text, ms) => {
    bar.style.width = `${pct}%`;
    bar.parentElement.setAttribute("aria-valuenow", pct);
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
      await set(12, "Oops. Starting over. Skill issue (ours) 😭", 1100);
      await set(66, "6️⃣7️⃣…", 600);
    }
    const result = await request;
    await set(100, `Order #${result.order_number} placed. W 🫡`, 400);
    saveCart([]);
    sfx.win();
    if (!calm() && window.JSConfetti) {
      await new JSConfetti().addConfetti({ emojis: ["🍗", "🌯", "🍚", "🌶️", "🍋", "💅"], emojiSize: 60, confettiNumber: 80 });
    }
    location.href = `/order?n=${result.order_number}&dish=${encodeURIComponent(result.items[0].dish_id)}`;
  } catch (err) {
    await set(0, err.message, 0);
    toast(err.message, { error: true });
    sfx.error();
    btn.disabled = false;
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
  go(0);
})();
