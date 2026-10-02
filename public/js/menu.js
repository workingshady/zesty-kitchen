import {
  $, $$, api, esc, egp, toast, play, say, calm, isTouch, pick, getConfig, getDishes, initCommon, chefHtml, toggleUnc,
  getCart, saveCart, addToCart, cartCount, linePrice, totalsHtml, avatarHtml,
} from "./common.js";

const REVIEWER_BADGES = ["Verified Eater ✅", "Top 1% Complainer", "Ate Here Once In 2019", "Certified Hater", "Aura Farmer 🌾", "NPC Reviewer 🤖", "Delulu Foodie", "Sigma Snacker", "Unc 👴", "Glazer 🍩"];
const STICKERS = ["عاش", "chopped", "6 7", "NPC", "W", "L", "slay 💅", "اتقل", "cooked 🔥", "مود", "+1000 aura", "red flag 🚩"];
const PLATE_EMOJI = { mandi: "🍚", grills: "🍢", shawarma: "🌯", seafood: "🦐", fatta: "🥣", sandwiches: "🥪", appetizers: "🥗", trays: "🫕", soups: "🍲", desserts: "🍰", expired: "🦴", picks: "🍽️", ful: "🫘", koshary: "🍝", taameya: "🧆", mahshi: "🫑", molokhia: "🥬", basbousa: "🍯", bread: "🥖", asab: "🧃", torshi: "🌶️" };

let config;
let dishes = [];
let board = { top: [], worst: null, total_orders: 0 };
const state = { cat: "all", q: "", sort: "default" };

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const aura = (chili) => Math.round(chili * 200 - 67);
const catOf = (slug) => config.categories.find((c) => c.slug === slug);
const badgeLabel = (b) => config.badges?.[b] || b;
const orderCount = (id) => board.top.find((t) => t.id === id)?.orders || 0;
const fakeKcal = (d) => d.calories || 900 + (hash(d.id) % 4100);
const photoOrEmoji = (d, alt = "") =>
  d.photo_url ? `<img src="${esc(d.photo_url)}" alt="${esc(alt)}" loading="lazy">` : `<span class="emoji-plate" aria-hidden="true">${PLATE_EMOJI[d.category] || "🍽️"}</span>`;

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
        <span class="card__eye">👀 ${d.viewers}</span>
        ${c ? `<span class="card__cat">${c.emoji} ${esc(c.ar)}</span>` : ""}
      </span>
      <span class="card__body">
        <span class="card__name" dir="auto">${esc(d.name_ar)}</span>
        ${d.name_en ? `<span class="card__name-en">${esc(d.name_en)}</span>` : ""}
        ${d.job_title ? `<span class="card__job" dir="auto">💼 ${esc(d.job_title)}</span>` : ""}
        <span class="card__desc" dir="auto">${esc(d.description)}</span>
        <span class="card__meta"><span>${"🌶️".repeat(d.spice_level)}</span>${d.avg_chili ? `<span>⭐ ${d.avg_chili} (${d.review_count})</span>` : "<span>unrated rizz</span>"}</span>
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
  const lines = dishes.slice(0, 8).map((d) => `🚨 ${esc(d.name_ar)} اتطلب ${orderCount(d.id) || 67} مرة النهاردة 🚨`);
  lines.push("🍋 no cap ده أحسن مندي في الشركة", "💅 slay or get grilled", "6️⃣7️⃣ 6️⃣7️⃣ 6️⃣7️⃣", "⚠️ brainrot level: critical", "بيقولك الـ HR بيطلب سري 🤫", "🧃 رايق? no. hungry? yes.");
  const html = lines.map((l) => `<span>${l}</span>`).join("");
  $("#marquee").innerHTML = html + html; // doubled for a seamless loop
}

function renderBoard() {
  const medals = ["🥇", "🥈", "🥉", "4", "5"];
  const max = Math.max(1, ...board.top.map((t) => t.orders));
  $("#board-stats").innerHTML = `<span class="pill">🧾 ${board.total_orders || 0} orders total</span><span class="pill">🍽️ ${dishes.length} coworkers on the menu</span>`;
  $("#board-top").innerHTML = board.top.length
    ? board.top
        .map(
          (d, i) => `<li><span class="rank">${medals[i]}</span>${avatarHtml(d)}<span dir="auto"><b>${esc(d.name_ar)}</b>${d.name_en ? `<br><small>${esc(d.name_en)}</small>` : ""}</span><span class="count">${d.orders}×</span>
          <span class="bar" aria-hidden="true"><span style="width:${(d.orders / max) * 100}%"></span></span></li>`,
        )
        .join("")
    : `<li class="board__empty"><b>No orders yet. The throne is empty 👑</b><span>Be the first W. Order someone and put them on the board.</span><a class="btn red" href="#menu-top">Start ordering 🍽️</a></li>`;
  $("#board-worst").innerHTML = board.worst
    ? `<div class="worst__face">${avatarHtml(board.worst)}<b dir="auto">${esc(board.worst.name_ar)}</b><span>${board.worst.orders} orders. L + ratio 💀</span><small>Nobody wants them. Be nice and order one? 🥺</small></div>`
    : "<p>Nobody's losing yet. Give it time 😈</p>";
  const top = board.top[0];
  const champ = top || dishes.find((d) => d.photo_url && !d.badges.includes("sold_out"));
  $("#hero-top").innerHTML = champ
    ? `<button class="champ" type="button" data-id="${champ.id}" aria-label="Open ${esc(champ.name_ar)}">
        <span class="champ__photo">${champ.photo_url ? `<img src="${esc(champ.photo_url)}" alt="">` : `<span class="emoji-plate">🍽️</span>`}
          <span class="champ__crown" aria-hidden="true">👑</span>
          <span class="champ__count">${top ? `🔥 ${top.orders}× ordered` : "👀 up for grabs"}</span>
        </span>
        <span class="champ__name" dir="auto">${esc(champ.name_ar)}</span>
        <span class="champ__sub">${top ? "Main character energy 🎬" : "The throne is empty. Order to crown someone 👑"}</span>
      </button>`
    : "<p>Nobody yet. The throne is empty 👑<br>Your order decides who's #1.</p>";
  $(".champ")?.addEventListener("click", (e) => openDish(e.currentTarget.dataset.id));
}

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
          <button class="btn pink" type="button" id="slap">🫵 Slap a sticker</button>
        </div>
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
          <div class="stat"><b id="kcal">0</b><small>kcal of drama</small></div>
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
    <div class="stepper"><button type="button" data-q="-1" aria-label="Less">−</button><output id="qty" aria-live="polite">1</output><button type="button" data-q="1" aria-label="More">+</button></div>
    <button class="btn big red runaway" id="add-btn" type="button" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out 💀" : `<span class="t">Add to cart · ضيف</span>&nbsp;<span id="line-total"></span>`}</button>`;

  countUp($("#kcal"), fakeKcal(d));
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
      qty = Math.min(9, Math.max(1, qty + Number(b.dataset.q)));
      $("#qty").textContent = qty;
      update();
    }),
  );
  update();
  const addBtn = $("#add-btn");
  setupRunaway(addBtn);
  addBtn.addEventListener("click", () => {
    if (addBtn.disabled) return;
    if (!calm() && isTouch() && dodges < 3) return dodge(addBtn);
    const size = form.size.value;
    const addons = $$("[name=addon]:checked", form).map((x) => x.value);
    addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size, addons, qty, unit_price: linePrice(config, d.price, size, addons) });
    play("ashta");
    toast(`${d.name_ar} اتضاف. اشطا يا باشا 🫡`);
    $("#open-cart").classList.remove("bump");
    void $("#open-cart").offsetWidth;
    $("#open-cart").classList.add("bump");
    $("#dish-modal").close();
  });

  $("#scan-aura").addEventListener("click", scanAura);
  $("#slap").addEventListener("click", slapSticker);
  $$(".rating", $("#review-form")).forEach((group) =>
    group.addEventListener("change", () => {
      const v = Number(group.querySelector("input:checked").value);
      $$("label", group).forEach((l, i) => l.classList.toggle("on", i < v));
    }),
  );
  $("#review-form").addEventListener("submit", (e) => postReview(e, d.id));
  $("#review-list").addEventListener("click", onReviewClick);
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

function scanAura() {
  const photo = $("#dish-photo");
  $$(".scanline, .aura-result", photo).forEach((x) => x.remove());
  photo.insertAdjacentHTML("beforeend", `<span class="scanline"></span>`);
  play("sheesh");
  setTimeout(() => {
    $(".scanline", photo)?.remove();
    const score = pick([6700, 1000, 420, -67, -1000, 9001, 67]);
    const verdict = score > 500 ? "aura farming detected 🌾" : score > 0 ? "mid but valid" : "chopped 💀";
    photo.insertAdjacentHTML("beforeend", `<span class="aura-result">${score > 0 ? "+" : ""}${score.toLocaleString()} aura · ${verdict}</span>`);
    play(score > 0 ? "boom" : "faah");
  }, calm() ? 0 : 1800);
}

function slapSticker() {
  const s = document.createElement("span");
  s.className = "sticker";
  const r = Math.round((Math.random() - 0.5) * 40);
  s.style.setProperty("--r", `${r}deg`);
  s.style.transform = `rotate(${r}deg)`;
  s.style.left = `${5 + Math.random() * 55}%`;
  s.style.top = `${5 + Math.random() * 65}%`;
  s.style.background = pick(["#ffc700", "#ff69b4", "#8ace00", "#7fd3ff", "#fff"]);
  s.textContent = pick(STICKERS);
  $("#dish-photo").append(s);
  play("pipe");
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
      <div class="review__foot">${reacts}<button class="voice" type="button" data-say="${esc(r.body)}">▶️ voice note</button></div>
    </article>`;
}

async function postReview(e, dishId) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  // Lie detector: max stars = glazing
  if (Number(f.chili_rating.value) === 5 && !calm()) toast("🚨 Lie detector: glazing detected. Posting anyway 🍩");
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
    play("boom");
  } catch (err) {
    toast(err.message, { error: true });
    play("faah");
  } finally {
    btn.disabled = false;
  }
}

async function onReviewClick(e) {
  const voice = e.target.closest(".voice");
  if (voice) return say(voice.dataset.say, { pitch: pick([0.1, 2]), rate: pick([0.7, 1.4]), arabic: /[؀-ۿ]/.test(voice.dataset.say), force: true });
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
  play(dodges < 3 ? "bruh" : "faah");
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

// ---------- Spin wheel ----------
let wheelAngle = 0;
let spinning = false;
const TAU = Math.PI * 2;

function drawWheel(list) {
  const g = $("#wheel").getContext("2d");
  const n = list.length;
  const colors = ["#ffc700", "#ff69b4", "#8ace00", "#7fd3ff", "#fa4b13", "#ffffff"];
  g.clearRect(0, 0, 600, 600);
  g.save();
  g.translate(300, 300);
  g.rotate(wheelAngle);
  list.forEach((d, i) => {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 1) / n) * TAU;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 295, a0, a1);
    g.closePath();
    g.fillStyle = colors[i % colors.length];
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = "#111";
    g.stroke();
    g.save();
    g.rotate((a0 + a1) / 2);
    g.textAlign = "right";
    g.fillStyle = "#111";
    g.font = "bold 28px Lalezar, sans-serif";
    g.fillText(d.name_ar.slice(0, 16), 270, 10);
    g.restore();
  });
  g.restore();
}

function setupWheel() {
  const list = () => dishes.filter((d) => !d.badges.includes("sold_out"));
  $("#open-wheel").addEventListener("click", () => {
    if (!list().length) return toast("The menu is empty 🦗");
    $("#wheel-result").textContent = "";
    drawWheel(list());
    $("#wheel-modal").showModal();
  });
  $("#close-wheel").addEventListener("click", () => $("#wheel-modal").close());
  $("#spin").addEventListener("click", () => {
    if (spinning) return;
    const items = list();
    const n = items.length;
    const winner = Math.floor(Math.random() * n);
    spinning = true;
    // The pointer sits at the top (angle −90°). Rotate so the winner's slice centre ends there, after several full turns.
    const start = wheelAngle;
    const landing = -Math.PI / 2 - ((winner + 0.5) / n) * TAU;
    const turns = 5 + Math.floor(Math.random() * 3);
    let end = landing - turns * TAU;
    while (end > start - 4 * TAU) end -= TAU;
    const duration = calm() ? 10 : 4200;
    const t0 = performance.now();
    let lastTick = Math.floor(start / (TAU / n));
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      wheelAngle = start + (end - start) * (1 - Math.pow(1 - p, 4));
      drawWheel(items);
      const tick = Math.floor(wheelAngle / (TAU / n));
      if (tick !== lastTick) {
        lastTick = tick;
        play("pop");
      }
      if (p < 1) return requestAnimationFrame(step);
      spinning = false;
      const d = items[winner];
      $("#wheel-result").innerHTML = `🎉 The wheel chose: <b dir="auto">${esc(d.name_ar)}</b>`;
      play("airhorn");
      setTimeout(() => {
        $("#wheel-modal").close();
        openDish(d.id);
      }, calm() ? 300 : 1400);
    };
    requestAnimationFrame(step);
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
          <div class="stepper"><button type="button" data-line="${i}" data-q="-1" aria-label="Less">−</button><output>${l.qty}</output><button type="button" data-line="${i}" data-q="1" aria-label="More">+</button></div>
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
    line.qty = Math.min(9, Math.max(1, line.qty + Number(q)));
    saveCart(cart);
    play("pop");
  }
  const rm = e.target.dataset.remove;
  if (rm !== undefined) {
    const step = Number(e.target.dataset.step || 0);
    if (!calm() && step < 2) {
      e.target.dataset.step = step + 1;
      e.target.textContent = removeSteps[step];
      play("bruh");
      return;
    }
    cart.splice(Number(rm), 1);
    saveCart(cart);
    play("sad");
    if (!calm()) toast(removeSteps[2]);
  }
}

function toggleCart(open) {
  $("#drawer").classList.toggle("open", open);
  $("#drawer").setAttribute("aria-hidden", String(!open));
  $("#scrim").hidden = !open;
  if (open) $("#close-cart").focus();
}

// ---------- Boot ----------
async function boot() {
  $("#chef-slot").innerHTML = chefHtml;
  initCommon();
  try {
    [config, dishes, board] = await Promise.all([getConfig(), getDishes(), api("/api/leaderboard")]);
  } catch (err) {
    $("#menu").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
    return;
  }
  renderTabs();
  renderGrid();
  renderHype();
  renderBoard();
  renderCart();
  setupWheel();

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
    if (state.sort === "chaos") play("boom");
  });
  document.addEventListener("cart:change", renderCart);
  $("#cart-items").addEventListener("click", onCartClick);
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
      play("bruh");
    }
  });
  $("#unc-btn").addEventListener("click", toggleUnc);
  $("#tung-btn").addEventListener("click", () => play("tung"));
  $("#faah-btn").addEventListener("click", () => play("faah"));
  let logoTaps = 0;
  $("#logo").addEventListener("click", (e) => {
    e.preventDefault();
    if (++logoTaps < 5) return scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    logoTaps = 0;
    document.body.style.transition = "transform .6s";
    document.body.style.transform = "rotate(180deg)";
    toast("🙃 upside-down cake mode");
    play("ohno");
    setTimeout(() => (document.body.style.transform = ""), 2000);
  });
}

boot();
