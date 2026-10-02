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
    play("what");
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

// 4. Captcha: a random funny challenge with REAL right/wrong logic. Two misses and we let you in anyway.
const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x0660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x06f0);
// Forgiving compare: case, spaces, tashkeel/tatweel, أ/إ/آ→ا, ى→ي, ة→ه, Arabic digits→Latin
const norm = (s) =>
  toLatinDigits(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
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

const FOOD_EMOJI = [
  ["🍗", "فراخ", "chicken"], ["🧆", "طعمية", "falafel"], ["🥙", "شاورما", "shawarma"], ["🍚", "رز", "rice"], ["🌯", "راب", "wrap"],
  ["🦐", "جمبري", "shrimp"], ["🍲", "ملوخية", "molokhia"], ["🫘", "فول", "foul"], ["🐟", "سمك", "fish"], ["🥖", "عيش", "bread"],
];
const FOOD_WORDS = ["كشري 🍝 Koshary", "فول 🫘 Foul", "طعمية 🧆 Ta'meya", "ملوخية 🍲 Molokhia", "محشي 🫑 Mahshi", "حواوشي 🥙 Hawawshi", "بسبوسة 🍰 Basbousa", "فطير مشلتت 🥞 Feteer"];
const NOT_FOOD = ["📊 The Q3 Excel sheet", "🖨️ The office printer", "📅 The 9am standup", "📧 A reply-all email", "🔌 The HDMI cable nobody has", "💼 Your KPIs", "🪑 Your manager's chair"];
const CAPTCHA_WORDS = ["اشطا", "يسطا", "فكك", "قشطة", "عاش", "skibidi", "aura", "rizz", "sheesh", "habibi"];
const PRAISE = ["Verified. 100% human, 0% robot, 67% brainrot ✅", "Correct. Aura +1000 🔥", "عاش يا وحش 🫡 human confirmed", "Sheesh. Not a robot. Probably. 🤖❌"];

// Each challenge: { id, ok(dishes) -> available?, render(box, dishes, msg) -> { check() -> true | "praise text" | false | null (nothing answered yet), hint, empty } }
const CHALLENGES = [
  {
    id: "faces",
    ok: () => true,
    render(box, dishes) {
      const withPhoto = dishes.filter((d) => d.photo_url);
      const star = pick(withPhoto);
      const others = withPhoto.filter((d) => d.photo_url !== star?.photo_url); // same photo twice would make it unfair
      const tiles = [];
      const hits = new Set(shuffle([...Array(9).keys()]).slice(0, rand(2, 4)));
      const spin = () => `transform:rotate(${pick([0, 0, 90, 180, -12, 15, 270])}deg) scale(${(1 + Math.random() * 0.6).toFixed(2)})`;
      const emojiTile = (f) => ({ html: `<span style="${spin()}">${f[0]}</span>`, name: f[2] });
      let label;
      if (others.length) {
        label = `<span dir="auto">${esc(star.name_ar)}</span>`;
        const face = (d) => ({ html: `<img src="${esc(d.photo_url)}" alt="" style="${spin()}">`, name: d.name_en || d.name_ar });
        for (let i = 0; i < 9; i++) tiles.push(hits.has(i) ? face(star) : Math.random() < 0.65 ? face(pick(others)) : emojiTile(pick(FOOD_EMOJI)));
      } else {
        // Not enough photos: emoji version
        const food = pick(FOOD_EMOJI);
        const decoys = FOOD_EMOJI.filter((f) => f !== food);
        label = `${food[0]} <span dir="auto">${food[1]}</span> / ${food[2]}`;
        for (let i = 0; i < 9; i++) tiles.push(emojiTile(hits.has(i) ? food : pick(decoys)));
      }
      box.innerHTML = `<p class="cap__prompt"><strong>Select ALL squares with ${label}</strong><br><small>Tap every square they're in, then Verify. Yes, even the rotated ones 👀</small></p>
        <div class="captcha-grid">${tiles
          .map((t, i) => `<button type="button" aria-pressed="false" aria-label="Tile ${i + 1}: ${esc(t.name)}" data-i="${i}">${t.html}</button>`)
          .join("")}</div>`;
      $(".captcha-grid", box).addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      });
      return {
        empty: "Pick at least one square. We KNOW you know who it is 👀",
        hint: `Wrong 💀 They were in tiles ${[...hits].sort((a, b) => a - b).map((i) => i + 1).join(", ")}.`,
        check() {
          const sel = $$("[aria-pressed=true]", box).map((b) => Number(b.dataset.i));
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
    render(box, dishes) {
      const foods = shuffle(FOOD_WORDS).slice(0, 3);
      if (dishes.length && Math.random() < 0.6) foods[0] = `${esc(pick(dishes).name_ar)} (on the menu, so… food 💀)`;
      const titled = dishes.filter((d) => d.job_title);
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
    render(box, _dishes, msg) {
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
    ok: (dishes) => new Set(dishes.filter((d) => d.price > 0).map((d) => d.price)).size >= 2,
    render(box, dishes) {
      const seen = new Set();
      const opts = shuffle(dishes.filter((d) => d.price > 0))
        .filter((d) => !seen.has(d.price) && seen.add(d.price)) // unique prices, so exactly one right answer
        .slice(0, 4);
      const rich = Math.random() < 0.5;
      const best = opts.reduce((a, d) => ((rich ? d.price > a.price : d.price < a.price) ? d : a));
      box.innerHTML = `<p class="cap__prompt"><strong>${rich ? "Select the coworker with the BIGGEST salary 💸" : "Select the most UNDERPAID coworker 😭"}</strong><br><small>Salary = menu price. HR leaked it. Robots can't read prices (trust).</small></p>
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
];
const CHILL_CAPTCHA = {
  id: "chill",
  render(box) {
    box.innerHTML = `<p class="cap__prompt">رايق mode: no puzzle. Just press <b>Verify</b>. You're human, we believe you 🫶</p>`;
    return { check: () => "رايق verified 🫡 human enough" };
  },
};

async function stepCaptcha() {
  const dishes = (await getDishes()).filter((d) => !d.badges?.includes("sold_out"));
  if (current !== 3) return; // user moved on while dishes were loading
  let fails = 0;
  let lastId = null;
  let active;
  panel(
    "🤖 إنت بني آدم؟ / Are you human?",
    `<div class="cap" id="cap"></div>
     <p id="cap-msg" class="cap__msg" aria-live="polite"></p>
     ${calm() ? "" : `<button class="tiny-link" type="button" id="cap-new">🔄 غيّرها / different challenge</button>`}`,
    `${backBtn()}${nextBtn("Verify ✅")}`,
  );
  bindBack();
  const box = $("#cap");
  const msg = (text) => ($("#cap-msg").textContent = text);
  const load = (note = "") => {
    const pool = calm() ? [CHILL_CAPTCHA] : CHALLENGES.filter((c) => c.ok(dishes));
    const ch = pick(pool.length > 1 ? pool.filter((c) => c.id !== lastId) : pool);
    lastId = ch.id;
    box.dataset.type = ch.id;
    active = ch.render(box, dishes, msg);
    msg(note);
  };
  load();
  // Drop the "answer first" nag as soon as they start answering
  ["input", "change"].forEach((ev) => box.addEventListener(ev, () => $("#cap-msg").textContent === active.empty && msg("")));
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("input[type=text]")) {
      e.preventDefault();
      $("#next").click();
    }
  });
  $("#cap-new")?.addEventListener("click", () => {
    load("New challenge. Same vibes 🔄");
    $("input, button", box)?.focus();
  });
  $("#next").addEventListener("click", () => {
    const result = active.check();
    if (result === null) {
      play("bruh");
      return msg(active.empty);
    }
    if (result) {
      play("boom");
      toast(typeof result === "string" ? result : pick(PRAISE));
      return go(4);
    }
    fails++;
    play("buzzer");
    box.classList.remove("shake");
    void box.offsetWidth;
    box.classList.add("shake");
    if (fails >= 2) {
      $("#next").disabled = true;
      msg(`${active.hint} …whatever, close enough.`);
      toast("Close enough, you're 67% human 🤖➡️🧍 بس متتعودش");
      return setTimeout(() => current === 3 && go(4), 1200);
    }
    load(`❌ ${active.hint} Here's a new one.`);
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
      play("what");
    }, 600);
  });
  $("#hr").addEventListener("change", (e) => {
    if (calm()) return;
    e.target.checked = true;
    toast("HR said no. HR always says no 🙅");
    play("no");
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
        play("care");
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
    play("no");
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
      play("what");
      await set(12, "Oops. Starting over. Skill issue (ours) 😭", 1100);
      await set(67, "6️⃣7️⃣…", 600);
    }
    const result = await request;
    await set(100, `Order #${result.order_number} placed. عاش يا وحش 🫡`, 300);
    saveCart([]);
    play("ka");
    setTimeout(() => play("laugh"), 900);
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
