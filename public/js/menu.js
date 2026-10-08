import {
  $, $$, api, esc, egp, toast, play, say, calm, isTouch, pick, getConfig, getDishes, initCommon, chefHtml, toggleUnc, fitImg, CLIPS, soundOn,
  getCart, saveCart, addToCart, cartCount, linePrice, totalsHtml, avatarHtml, getStats,
} from "./common.js";
import { initHome, dishTools, replyToReview } from "./home.js";

const REVIEWER_BADGES = ["Verified Eater ✅", "Top 1% Complainer", "Ate Here Once In 2019", "Certified Hater", "Aura Farmer 🌾", "NPC Reviewer 🤖", "Delulu Foodie", "Sigma Snacker", "Unc 👴", "Glazer 🍩"];
const PLATE_EMOJI = { mandi: "🍚", grills: "🍢", shawarma: "🌯", seafood: "🦐", fatta: "🥣", sandwiches: "🥪", appetizers: "🥗", trays: "🫕", soups: "🍲", desserts: "🍰", expired: "🦴", picks: "🍽️", ful: "🫘", koshary: "🍝", taameya: "🧆", mahshi: "🫑", molokhia: "🥬", basbousa: "🍯", bread: "🥖", asab: "🧃", torshi: "🌶️" };

let config;
let dishes = [];
let stats = { ranking: [], dishes: {}, rating: {}, recent_orders: [], total_orders: 0, orders_today: 0 };
const MAX_QTY = 99; // per line, same as the server (src/orders.js)
const clampQty = (n) => Math.min(MAX_QTY, Math.max(1, Math.round(Number(n)) || 1));
const state = { cat: "all", q: "", sort: "default" };

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const aura = (chili) => Math.round(chili * 200 - 67);
const catOf = (slug) => config.categories.find((c) => c.slug === slug);
const badgeLabel = (b) => config.badges?.[b] || b;
const orderCount = (id) => stats.dishes[id]?.orders_qty_all_time || 0; // real, all time
const photoOrEmoji = (d, alt = "") =>
  d.photo_url ? fitImg(d.photo_url, alt) : `<span class="emoji-plate" aria-hidden="true">${PLATE_EMOJI[d.category] || "🍽️"}</span>`;

// ---------- Filter bar + grid ----------
function renderTabs() {
  const used = config.categories.filter((c) => dishes.some((d) => d.category === c.slug));
  const tab = (slug, label, n) => `<button class="cat" type="button" aria-pressed="${state.cat === slug}" data-cat="${slug}">${label} <span class="n">${n}</span></button>`;
  $("#cat-tabs").innerHTML = tab("all", "🍽️ الكل / All", dishes.length) + used.map((c) => tab(c.slug, `${c.emoji} ${esc(c.ar)}`, dishes.filter((d) => d.category === c.slug).length)).join("");
}

function visibleDishes() {
  const q = state.q.trim().toLowerCase();
  let list = dishes.filter((d) => (state.cat === "all" || d.category === state.cat) && (!q || `${d.name_ar} ${d.name_en} ${d.job_title} ${d.description}`.toLowerCase().includes(q)));
  const by = {
    popular: (a, b) => orderCount(b.id) - orderCount(a.id),
    cheap: (a, b) => a.price - b.price,
    expensive: (a, b) => b.price - a.price,
    spicy: (a, b) => b.spice_level - a.spice_level,
    chaos: () => Math.random() - 0.5,
  }[state.sort];
  if (by) list = [...list].sort(by);
  return list;
}

function renderGrid() {
  const c = state.cat === "all" ? null : catOf(state.cat);
  $("#cat-intro").innerHTML = c
    ? `<h2>${c.emoji} ${esc(c.ar)} <span class="wordart">${esc(c.en)}</span></h2><span class="twist">${esc(c.twist)}</span>`
    : `<h2>🍽️ المنيو كله <span class="wordart">Full menu</span></h2><span class="twist">${dishes.length} coworkers, freshly cooked. اختار ضحيتك.</span>`;
  const list = visibleDishes();
  $("#menu").innerHTML = list.map(cardHtml).join("") || `<div class="empty"><h3>مفيش حد بالاسم ده 🦗</h3><p>No coworker found. Maybe they quit? Try another name.</p></div>`;
  $$(".card").forEach((card) => card.addEventListener("click", () => openDish(card.dataset.id)));
  decorate();
}

function cardHtml(d) {
  const from = linePrice(config, d.price, "quarter", []);
  const c = catOf(d.category);
  const soldOut = d.badges.includes("sold_out");
  const badges = d.badges.filter((b) => b !== "sold_out").slice(0, 2).map((b) => `<span class="badge ${b}">${badgeLabel(b)}</span>`);
  if (d.most_ordered) badges.unshift(`<span class="badge most">🏆 #1</span>`);
  return `
    <button class="card ${soldOut ? "is-sold-out" : ""}" type="button" data-id="${d.id}" aria-label="${esc(d.name_ar)} ${esc(d.name_en)}, from ${egp(from)}">
      <span class="badges">${badges.join("")}</span>
      <span class="card__media">
        ${photoOrEmoji(d)}
        ${orderCount(d.id) ? `<span class="card__eye" title="Real orders, all time">🧾 ${orderCount(d.id)}× ordered</span>` : ""}
        ${c ? `<span class="card__cat">${c.emoji} ${esc(c.ar)}</span>` : ""}
      </span>
      <span class="card__body">
        <span class="card__name" dir="auto">${esc(d.name_ar)}</span>
        ${d.name_en ? `<span class="card__name-en">${esc(d.name_en)}</span>` : ""}
        ${d.job_title ? `<span class="card__job" dir="auto">💼 ${esc(d.job_title)}</span>` : ""}
        <span class="card__desc" dir="auto">${esc(d.description)}</span>
        <span class="card__meta"><span>${"🌶️".repeat(d.spice_level)}</span>${d.avg_chili ? `<span title="Average spice rating from real reviews">⭐ ${d.avg_chili} (${d.review_count})</span>` : "<span>no reviews yet</span>"}</span>
        <span class="card__foot">
          <span class="price"><small>يبدأ من / from</small>${egp(from)}</span>
          <span class="btn add-mini" aria-hidden="true">${soldOut ? "💀" : "+"}</span>
        </span>
      </span>
    </button>`;
}

function decorate() {
  if (calm() || !window.RoughNotation) return;
  $$(".card .badge.chefs_pick").forEach((el) => window.RoughNotation.annotate(el, { type: "circle", color: "#fa4b13", padding: 6 }).show());
}

// ---------- Marquee + leaderboard ----------
function renderHype() {
  // Real counts only: today's orders first, then all-time; dishes with zero orders are skipped
  const real = stats.ranking.filter((r) => r.orders_today > 0).slice(0, 6).map((r) => `🚨 ${esc(r.name_ar)} اتطلب ${r.orders_today} مرة النهاردة 🚨`);
  if (real.length < 3) real.push(...stats.ranking.filter((r) => !r.orders_today && r.orders_qty_all_time > 0).slice(0, 6 - real.length).map((r) => `🧾 ${esc(r.name_ar)}: ${r.orders_qty_all_time}× لحد دلوقتي`));
  const lines = real.length ? real : ["🦗 zero orders so far. be the first W"];
  lines.push("🍋 no cap ده أحسن مندي في الشركة", "💅 slay or get grilled", "6️⃣7️⃣ 6️⃣7️⃣ 6️⃣7️⃣", "⚠️ brainrot level: critical", "بيقولك الـ HR بيطلب سري 🤫", "🧃 رايق? no. hungry? yes.");
  const html = lines.map((l) => `<span>${l}</span>`).join("");
  $("#marquee").innerHTML = html + html; // doubled for a seamless loop
}

// Hero champion, leaderboard, worst seller, side quests and the wheel live in home.js

// ---------- Dish modal ----------
let dodges = 0;

async function openDish(id) {
  const modal = $("#dish-modal");
  $("#dish-body").innerHTML = "<p>Plating… 🍽️</p>";
  $("#dish-foot").innerHTML = "";
  modal.showModal();
  let d;
  try {
    d = await api(`/api/dishes/${id}`);
  } catch (err) {
    $("#dish-body").innerHTML = `<p>${esc(err.message)}</p>`;
    return;
  }
  const c = catOf(d.category);
  const soldOut = d.badges.includes("sold_out");
  const sizeChips = Object.entries(config.sizes)
    .map(([key, s]) => `<label class="chip"><input type="radio" name="size" value="${key}" ${key === "half" ? "checked" : ""}><span><b>${esc(s.ar)} / ${esc(s.en)}</b><small>${esc(s.note)} · ${egp(linePrice(config, d.price, key, []))}</small></span></label>`)
    .join("");
  const addonChips = Object.entries(config.addons)
    .map(([key, a]) => `<label class="chip"><input type="checkbox" name="addon" value="${key}" ${a.available ? "" : "disabled"}><span><b>${esc(a.ar)}</b><small>${esc(a.en)} · ${a.available ? `+${egp(a.price)}` : "not available. never was."}</small></span></label>`)
    .join("");

  $("#dish-body").innerHTML = `
    <div class="dish-hero">
      <div>
        <div class="dish-photo" id="dish-photo">${photoOrEmoji(d, d.name_ar)}</div>
        <div class="photo-tools">
          <button class="btn sky" type="button" id="scan-aura">📸 Scan aura</button>
          <button class="btn pink" type="button" id="slap" aria-expanded="false">🫵 Stickers</button>
          <button class="btn white" type="button" id="roast">🎤 Roast</button>
          ${d.photo_url ? `<button class="btn" type="button" id="vibe-check">🔍 Vibe check</button>` : ""}
        </div>
        <div class="photo-extras" id="photo-extras" aria-live="polite"></div>
      </div>
      <div class="dish-info">
        <div class="badges">${c ? `<span class="badge">${c.emoji} ${esc(c.ar)} / ${esc(c.en)}</span>` : ""}${d.badges.map((b) => `<span class="badge ${b}">${badgeLabel(b)}</span>`).join("")}</div>
        <h2 id="dish-title" dir="auto">${esc(d.name_ar)}</h2>
        ${d.name_en ? `<div class="card__name-en">${esc(d.name_en)}</div>` : ""}
        ${d.job_title ? `<span class="card__job" dir="auto">💼 ${esc(d.job_title)}</span>` : ""}
        <p dir="auto">${esc(d.description)}</p>
        ${d.catchphrase ? `<div class="quote" dir="auto">💬 "${esc(d.catchphrase)}"</div>` : ""}
        <div class="stats">
          <div class="stat"><b>${"🌶️".repeat(d.spice_level)}</b><small>Spice / حرارة</small></div>
          <div class="stat"><b id="dish-orders">${orderCount(d.id)}×</b><small>real orders</small></div>
          ${d.calories ? `<div class="stat"><b id="kcal">0</b><small>kcal of drama</small></div>` : ""}
          <div class="stat"><b>${d.avg_chili ? `${d.avg_chili}⭐` : "—"}</b><small>${d.review_count} reviews</small></div>
        </div>
        ${d.warnings ? `<div class="warning" dir="auto">⚠️ <b>Contains / يحتوي على:</b> ${esc(d.warnings)}</div>` : ""}
      </div>
    </div>
    <form id="add-form">
      <fieldset class="opt-group"><legend>📏 اختار الحجم / Pick a size</legend><div class="chips">${sizeChips}</div></fieldset>
      <fieldset class="opt-group"><legend>➕ إضافات / Extras</legend><div class="chips">${addonChips}</div></fieldset>
    </form>
    <section class="reviews" aria-labelledby="rev-title">
      <div class="reviews__head"><h3 id="rev-title">💬 الآراء / Reviews (${d.review_count})</h3>${d.avg_chili ? `<span class="aura">aura ${aura(d.avg_chili)}</span>` : ""}</div>
      <div id="review-list">${d.reviews.map(reviewHtml).join("") || "<p>No reviews yet. Be the first hater 😈</p>"}</div>
      <form class="review-form" id="review-form">
        <h3>✍️ اكتب رأيك / Write a review</h3>
        <label class="field">Your name / اسمك <input name="author_name" required maxlength="40" dir="auto" autocomplete="nickname"></label>
        ${ratingHtml("chili_rating", "🌶️ Spice level", "🌶️")}
        ${ratingHtml("awkward_rating", "😬 How awkward was eye contact?", "😬")}
        <label class="field">Review <textarea name="body" required maxlength="500" rows="3" dir="auto" placeholder="It's giving… overtime"></textarea></label>
        <button class="btn" type="submit">Post review 📨</button>
      </form>
    </section>`;

  $("#dish-foot").innerHTML = `
    <div class="stepper"><button type="button" data-q="-1" aria-label="Less">−</button><input class="qty-in" id="qty" type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="1" aria-label="Quantity (1–${MAX_QTY})"><button type="button" data-q="1" aria-label="More">+</button></div>
    <button class="btn big red runaway" id="add-btn" type="button" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out 💀" : `<span class="t">Add to cart<span class="add-ar"> · ضيف</span></span>&nbsp;<span id="line-total"></span>`}</button>`;

  if (d.calories) countUp($("#kcal"), d.calories);
  const form = $("#add-form");
  let qty = 1;
  const update = () => {
    const lt = $("#line-total");
    if (lt) lt.textContent = egp(linePrice(config, d.price, form.size.value, $$("[name=addon]:checked", form).map((x) => x.value)) * qty);
  };
  form.addEventListener("change", () => {
    update();
    play("pop");
  });
  $$("[data-q]", $("#dish-foot")).forEach((b) =>
    b.addEventListener("click", () => {
      qty = clampQty(qty + Number(b.dataset.q));
      $("#qty").value = qty;
      update();
    }),
  );
  $("#qty").addEventListener("change", (e) => {
    qty = clampQty(e.target.value);
    e.target.value = qty;
    update();
  });
  update();
  const addBtn = $("#add-btn");
  setupRunaway(addBtn);
  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    if (!calm() && isTouch() && dodges < 3) return dodge(addBtn);
    const size = form.size.value;
    const addons = $$("[name=addon]:checked", form).map((x) => x.value);
    qty = clampQty($("#qty").value);
    addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size, addons, qty, unit_price: linePrice(config, d.price, size, addons) });
    play("add");
    setTimeout(() => play("ashta"), 700);
    toast(`${d.name_ar} اتضاف. اشطا يا باشا 🫡`);
    $("#open-cart").classList.remove("bump");
    void $("#open-cart").offsetWidth;
    $("#open-cart").classList.add("bump");
    $("#dish-modal").close();
  });

  dishTools(d);
  $$(".rating", $("#review-form")).forEach((group) =>
    group.addEventListener("change", () => {
      const v = Number(group.querySelector("input:checked").value);
      $$("label", group).forEach((l, i) => l.classList.toggle("on", i < v));
    }),
  );
  $("#review-form").addEventListener("submit", (e) => postReview(e, d.id));
  $("#review-list").addEventListener("click", onReviewClick);
  $("#review-list").addEventListener("click", (e) => replyToReview(e, d));
}

function countUp(el, target) {
  if (calm()) return (el.textContent = target.toLocaleString());
  const start = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - start) / 1200);
    el.textContent = Math.round(target * p * p).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function ratingHtml(name, label, icon) {
  return `<fieldset class="field" style="border:0;padding:0;margin:0"><legend>${label}</legend><div class="rating">${[1, 2, 3, 4, 5]
    .map((n) => `<label><input type="radio" name="${name}" value="${n}" required><span aria-label="${n}">${icon}</span></label>`)
    .join("")}</div></fieldset>`;
}

function reviewHtml(r) {
  const reacts = config.reactions.map((e) => `<button class="react" type="button" data-review="${r.id}" data-emoji="${e}">${e} ${r.reactions?.[e] || 0}</button>`).join("");
  return `
    <article class="review">
      <div class="review__head"><strong dir="auto">${esc(r.author_name)}</strong><span class="review__badge">${REVIEWER_BADGES[hash(r.author_name) % REVIEWER_BADGES.length]}</span>
        <span>${"🌶️".repeat(r.chili_rating)}</span><span class="aura">aura ${aura(r.chili_rating)}</span><small>😬 ${r.awkward_rating}/5</small></div>
      <p dir="auto">${esc(r.body)}</p>
      <div class="review__foot">${reacts}<button class="voice" type="button" data-say="${esc(r.body)}">▶️ voice note</button><button class="voice" type="button" data-reply="${esc(r.id)}">💬 Let them reply</button></div>
    </article>`;
}

async function postReview(e, dishId) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  // Lie detector: max stars = glazing
  if (Number(f.chili_rating.value) === 5 && !calm()) {
    toast("🚨 Lie detector: glazing detected. Posting anyway 🍩");
    play("cap");
  }
  try {
    const review = await api(`/api/dishes/${dishId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ author_name: f.author_name.value, chili_rating: f.chili_rating.value, awkward_rating: f.awkward_rating.value, body: f.body.value }),
    });
    const list = $("#review-list");
    if (!list.querySelector(".review")) list.innerHTML = "";
    list.insertAdjacentHTML("afterbegin", reviewHtml(review));
    f.reset();
    $$(".rating label", f).forEach((l) => l.classList.remove("on"));
    toast("Review posted. Slander delivered 📨 عاش");
    play("success");
  } catch (err) {
    toast(err.message, { error: true });
    play("faah");
  } finally {
    btn.disabled = false;
  }
}

async function onReviewClick(e) {
  const voice = e.target.closest(".voice");
  if (voice) {
    voice.textContent = "🔊 playing…";
    return say(voice.dataset.say, { force: true, interrupt: true }).then(() => (voice.textContent = "▶️ voice note"));
  }
  const btn = e.target.closest(".react");
  if (!btn) return;
  btn.disabled = true;
  try {
    const { reactions } = await api(`/api/reviews/${btn.dataset.review}/react`, { method: "POST", body: JSON.stringify({ emoji: btn.dataset.emoji }) });
    btn.textContent = `${btn.dataset.emoji} ${reactions[btn.dataset.emoji] || 0}`;
    play(btn.dataset.emoji === "💀" ? "boom" : "pop");
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    btn.disabled = false;
  }
}

// The "Add to cart" button runs away a few times, then gives up.
function dodge(btn) {
  dodges++;
  const x = Math.round((Math.random() - 0.5) * 160);
  const y = Math.round(-20 - Math.random() * 60);
  btn.style.transform = `translate(${x}px, ${y}px) rotate(${(Math.random() - 0.5) * 20}deg)`;
  toast(["اتقل يسطا 🏃", "too slow 😹", "skill issue"][dodges - 1] || "fine.");
  play(["huh", "run", "goofy"][dodges - 1] || "bonk");
  if (dodges >= 3) {
    setTimeout(() => {
      btn.style.transform = "";
      const t = btn.querySelector(".t");
      if (t) t.textContent = "fine 🙄 ضيف";
    }, 700);
  }
}

function setupRunaway(btn) {
  if (!btn || btn.disabled) return;
  btn.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse" && !calm() && dodges < 3) dodge(btn);
  });
}

// ---------- Cart drawer ----------
function renderCart() {
  const cart = getCart();
  const count = cartCount();
  $("#cart-count").textContent = count;
  $("#cart-bar").hidden = count === 0;
  document.body.classList.toggle("has-cart", count > 0);
  $("#cart-bar-text").textContent = `View cart · ${count} item${count === 1 ? "" : "s"}`;
  $("#cart-items").innerHTML =
    cart
      .map(
        (l, i) => `
      <div class="line">
        ${avatarHtml(l)}
        <div><strong dir="auto">${esc(l.name_ar)}</strong><br><small>${esc(config.sizes[l.size]?.ar || l.size)}${l.addons.length ? ` + ${l.addons.map((a) => esc(config.addons[a]?.ar || a)).join("، ")}` : ""}</small></div>
        <strong>${egp(l.unit_price * l.qty)}</strong>
        <div class="line__actions">
          <div class="stepper"><button type="button" data-line="${i}" data-q="-1" aria-label="Less">−</button><input class="qty-in" type="number" inputmode="numeric" min="1" max="${MAX_QTY}" value="${l.qty}" data-line-qty="${i}" aria-label="Quantity for ${esc(l.name_ar)}"><button type="button" data-line="${i}" data-q="1" aria-label="More">+</button></div>
          <button class="tiny-link" type="button" data-remove="${i}" data-scary>Remove</button>
        </div>
      </div>`,
      )
      .join("") || "<p>Your cart is emptier than the office on a Friday. 🦗</p>";
  $("#cart-totals").innerHTML = cart.length ? totalsHtml(cart) : "";
}

const removeSteps = ["Are you sure? 🥺", "Are you SURE sure? They'll be sad 😢", "Fine. Removed. Hope you're happy 💔"];
function onCartClick(e) {
  const cart = getCart();
  const q = e.target.dataset.q;
  const lineIdx = e.target.dataset.line;
  if (q && lineIdx !== undefined) {
    const line = cart[Number(lineIdx)];
    line.qty = clampQty(line.qty + Number(q));
    saveCart(cart);
    play("pop");
  }
  const rm = e.target.dataset.remove;
  if (rm !== undefined) {
    const step = Number(e.target.dataset.step || 0);
    if (!calm() && step < 2) {
      e.target.dataset.step = step + 1;
      e.target.textContent = removeSteps[step];
      play(step === 0 ? "sure" : "no");
      return;
    }
    cart.splice(Number(rm), 1);
    saveCart(cart);
    play("getout");
    if (!calm()) toast(removeSteps[2]);
  }
}

function toggleCart(open) {
  $("#drawer").classList.toggle("open", open);
  $("#drawer").setAttribute("aria-hidden", String(!open));
  $("#scrim").hidden = !open;
  if (open) $("#close-cart").focus();
}

// ---------- Soundboard (footer) ----------
// Real clips only (tabs, search, random, stop all, 1–9 keys) — lives in soundboard.js, loaded lazily.
function setupSoundboard() {
  if (!$("#soundboard")) return;
  import("./soundboard.js")
    .then((m) => m.mountSoundboard())
    .catch(() => {
      $("#soundboard").innerHTML = Object.entries(CLIPS).map(([k, v]) => `<button class="sb-btn" type="button" data-sound="${k}">${esc(v[1])}</button>`).join("");
      $("#soundboard").addEventListener("click", (e) => {
        const b = e.target.closest("[data-sound]");
        if (!b) return;
        if (!soundOn()) return toast("🔇 Sounds are OFF. Turn them on with the 🔊 button (bottom left)");
        play(b.dataset.sound, { exact: true });
      });
    });
}

// ---------- Header pills: fake delivery-app info that does dumb things ----------
function setupHeaderJokes() {
  const desks = ["📍 Desk #4 🪑", "📍 Meeting room 3 📊", "📍 HR office 💀", "📍 The roof 🪂", "📍 Under the boss's desk 🫣", "📍 الكافيتريا ☕", "📍 Parking lot 🚗"];
  const etas = ["⏱️ 25–35 years", "⏱️ 6–7 min", "⏱️ after the meeting", "⏱️ بعد الفطار", "⏱️ 3–5 business days", "⏱️ never 💀", "⏱️ when HR approves"];
  let desk = 0;
  let eta = 0;
  $("#pill-desk").addEventListener("click", (e) => {
    desk = (desk + 1) % desks.length;
    e.currentTarget.textContent = desks[desk];
    toast("Delivery address updated. HR has been notified 📨");
    play(desk === 2 ? "sideeye" : "pop");
  });
  $("#pill-eta").addEventListener("click", (e) => {
    eta = (eta + 1) % etas.length;
    e.currentTarget.textContent = etas[eta];
    toast("ETA recalculated by a very smart AI (a coin) 🪙");
    play(eta === 5 ? "sad" : "what");
  });
  $("#pill-rating").addEventListener("click", () => {
    const r = stats.rating || {};
    toast(r.review_count ? `⭐ ${r.avg_chili}/5 is the real average spice rating from ${r.review_count} review${r.review_count === 1 ? "" : "s"}. Open a dish to add yours 🌶️` : "No reviews yet. Open a dish and be the first hater 😈");
    play("pop");
  });
}
function renderRatingPill() {
  const r = stats.rating || {};
  const pill = $("#pill-rating");
  if (pill) pill.textContent = r.review_count ? `⭐ ${r.avg_chili} (${r.review_count})` : "⭐ new";
}

// ---------- Boot ----------
async function boot() {
  $("#chef-slot").innerHTML = chefHtml;
  initCommon();
  try {
    [config, dishes, stats] = await Promise.all([getConfig(), getDishes(), getStats().then((s) => s || stats)]);
  } catch (err) {
    $("#menu").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  renderTabs();
  renderGrid();
  // /?dish=<id> opens that dish straight away (admin "Site" links, shared links)
  const linked = new URLSearchParams(location.search).get("dish");
  if (linked && dishes.some((d) => d.id === linked)) openDish(linked);
  renderHype();
  renderCart();
  renderRatingPill();
  initHome({
    config,
    dishes,
    stats,
    openDish,
    onStats: (next) => {
      stats = next;
      renderGrid();
      renderHype();
      renderRatingPill();
    },
  });
  // Hero search jumps into the menu with the same query
  $("#hero-search")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#hero-q").value;
    $("#search").value = q;
    state.q = q;
    state.cat = "all";
    renderTabs();
    renderGrid();
    $("#menu-section").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "start" });
  });

  $("#cat-tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (!b) return;
    state.cat = b.dataset.cat;
    renderTabs();
    renderGrid();
    play("pop");
  });
  $("#search").addEventListener("input", (e) => {
    state.q = e.target.value;
    renderGrid();
  });
  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderGrid();
    if (state.sort === "chaos") play("drama");
  });
  document.addEventListener("cart:change", renderCart);
  $("#cart-items").addEventListener("click", onCartClick);
  $("#cart-items").addEventListener("change", (e) => {
    const i = e.target.dataset.lineQty;
    if (i === undefined) return;
    const cart = getCart();
    if (!cart[Number(i)]) return;
    cart[Number(i)].qty = clampQty(e.target.value);
    saveCart(cart);
  });
  $("#open-cart").addEventListener("click", () => toggleCart(true));
  $("#cart-bar").addEventListener("click", () => toggleCart(true));
  $("#close-cart").addEventListener("click", () => toggleCart(false));
  $("#scrim").addEventListener("click", () => toggleCart(false));
  addEventListener("keydown", (e) => e.key === "Escape" && toggleCart(false));
  $("#close-dish").addEventListener("click", () => $("#dish-modal").close());
  $("#dish-modal").addEventListener("click", (e) => e.target === e.currentTarget && e.currentTarget.close());
  $("#go-checkout").addEventListener("click", (e) => {
    if (!cartCount()) {
      e.preventDefault();
      toast("Your cart is empty. Delulu checkout 🙃", { error: true });
      play("crickets");
    }
  });
  $("#unc-btn").addEventListener("click", toggleUnc);
  setupSoundboard();
  setupHeaderJokes();
  let logoTaps = 0;
  $("#logo").addEventListener("click", (e) => {
    e.preventDefault();
    if (++logoTaps < 5) return scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    logoTaps = 0;
    document.body.style.transition = "transform .6s";
    document.body.style.transform = "rotate(180deg)";
    toast("🙃 upside-down cake mode");
    play("ahhh");
    setTimeout(() => (document.body.style.transform = ""), 2000);
  });
}

boot();
