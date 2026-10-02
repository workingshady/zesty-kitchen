import {
  $, $$, api, esc, egp, toast, sfx, calm, isTouch, getConfig, initCommon, chefHtml,
  getCart, saveCart, addToCart, cartCount, linePrice, totalsHtml,
} from "./common.js";

const BADGE_LABELS = { spicy: "🌶️ Spicy", popular: "🔥 Popular", new: "✨ New", sold_out: "SOLD OUT", chefs_pick: "👨‍🍳 Chef's pick" };
const REVIEWER_BADGES = ["Verified Eater ✅", "Top 1% Complainer", "Ate Here Once In 2019", "Certified Hater", "Aura Farmer 🌾", "NPC Reviewer 🤖", "Delulu Foodie", "Sigma Snacker"];
const PLATE_EMOJI = { mandi: "🍚", grills: "🍢", shawarma: "🌯", seafood: "🦐", fatta: "🥣", sandwiches: "🥪", appetizers: "🥗", trays: "🫕", soups: "🍲", desserts: "🍰", expired: "🦴", picks: "🍽️" };

let config;
let dishes = [];
let board = { top: [], worst: null };

const plate = (d, size = "") => `
  <span class="card__plate ${size}">
    ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="${esc(d.name_en)}, served hot" loading="lazy">` : `<span class="emoji-plate" aria-hidden="true">${PLATE_EMOJI[d.category] || "🍽️"}</span>`}
  </span>`;

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const aura = (chili) => Math.round(chili * 200 - 67);

// ---------- Menu ----------
function renderMenu() {
  const used = config.categories.filter((c) => dishes.some((d) => d.category === c.slug));
  $("#cat-tabs").innerHTML = used
    .map((c, i) => `<button class="cat" role="tab" aria-selected="${i === 0}" data-target="cat-${c.slug}">${c.emoji} ${esc(c.ar)} / ${esc(c.en)}</button>`)
    .join("");

  $("#menu").innerHTML =
    used
      .map(
        (c) => `
    <section class="section" id="cat-${c.slug}" aria-labelledby="h-${c.slug}">
      <div class="section__head"><h2 id="h-${c.slug}">${c.emoji} ${esc(c.ar)} <span class="wordart">${esc(c.en)}</span></h2><span class="section__twist">${esc(c.twist)}</span></div>
      <div class="grid">${dishes.filter((d) => d.category === c.slug).map(cardHtml).join("")}</div>
    </section>`,
      )
      .join("") || `<p class="panel">The kitchen is empty. Everyone's on vacation 🏖️</p>`;

  $$(".cat").forEach((tab) =>
    tab.addEventListener("click", () => document.getElementById(tab.dataset.target).scrollIntoView({ behavior: calm() ? "auto" : "smooth" })),
  );
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        $$(".cat").forEach((t) => t.setAttribute("aria-selected", t.dataset.target === e.target.id));
        $(`.cat[data-target="${e.target.id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
      }
    },
    { rootMargin: "-40% 0px -55% 0px" },
  );
  $$("#menu .section").forEach((s) => io.observe(s));

  $$(".card").forEach((card) => card.addEventListener("click", () => openDish(card.dataset.id)));
  decorate();
}

function cardHtml(d) {
  const from = linePrice(config, d.price, "quarter", []);
  const badges = [...d.badges.map((b) => `<span class="badge ${b}">${BADGE_LABELS[b] || b}</span>`)];
  if (d.most_ordered) badges.unshift(`<span class="badge most">🏆 Most ordered</span>`);
  return `
    <button class="card ${d.badges.includes("sold_out") ? "is-sold-out" : ""}" type="button" data-id="${d.id}" aria-label="${esc(d.name_en)}, from ${egp(from)}">
      <span class="badges">${badges.join("")}</span>
      ${plate(d)}
      <span class="card__body">
        <span class="card__name" dir="auto" ${d.badges.includes("sold_out") ? "data-strike" : ""}>${esc(d.name_ar)}</span>
        <span class="card__name-en">${esc(d.name_en)}</span>
        <span class="card__desc" dir="auto">${esc(d.description)}</span>
        <span class="viewers">🔥 ${d.viewers} coworkers are eyeing this dish</span>
        <span class="card__foot">
          <span class="price"><small>Starting from</small> ${egp(from)}</span>
          <span class="btn add-mini" aria-hidden="true">+</span>
        </span>
      </span>
    </button>`;
}

function decorate() {
  if (calm()) return;
  if (window.VanillaTilt && !isTouch()) VanillaTilt.init($$(".card"), { max: 10, speed: 400, scale: 1.02, glare: true, "max-glare": 0.25 });
  if (window.RoughNotation) {
    const { annotate } = window.RoughNotation;
    $$("[data-strike]").forEach((el) => annotate(el, { type: "strike-through", color: "#ff3b30", strokeWidth: 3, multiline: true }).show());
    $$(".badge.chefs_pick").forEach((el) => annotate(el, { type: "circle", color: "#fa4b13", padding: 6 }).show());
  }
}

// ---------- Marquee + leaderboard ----------
function renderHype() {
  const counts = new Map(board.top.map((t) => [t.id, t.orders]));
  const lines = dishes.slice(0, 8).map((d) => `🚨 ${esc(d.name_ar)} اتطلب ${counts.get(d.id) || 67} مرة النهاردة 🚨`);
  lines.push("🍋 no cap ده أحسن مندي في الشركة", "💅 slay or get grilled", "6️⃣7️⃣ 6️⃣7️⃣ 6️⃣7️⃣", "⚠️ brainrot level: critical");
  const html = lines.map((l) => `<span>${l}</span>`).join("");
  $("#marquee").innerHTML = html + html; // doubled for a seamless loop
}

function renderBoard() {
  const avatar = (d) => (d.photo_url ? `<img class="avatar" src="${esc(d.photo_url)}" alt="">` : `<span class="avatar">🍽️</span>`);
  const medals = ["🥇", "🥈", "🥉", "4", "5"];
  $("#board-top").innerHTML =
    board.top.map((d, i) => `<li><span class="rank">${medals[i]}</span>${avatar(d)}<span dir="auto">${esc(d.name_ar)}<br><small>${esc(d.name_en)}</small></span><span class="count">${d.orders}× ordered</span></li>`).join("") ||
    `<li>No orders yet. Be the first W 🫡</li>`;
  $("#board-worst").innerHTML = board.worst
    ? `<p>${avatar(board.worst)}</p><p dir="auto"><strong>${esc(board.worst.name_ar)}</strong> — ${board.worst.orders} orders. L + ratio 💀</p>`
    : "<p>Nobody's losing yet.</p>";
  const top = board.top[0];
  $("#hero-top").innerHTML = top
    ? `<p style="display:flex;gap:10px;align-items:center">${avatar(top)} <span dir="auto"><strong>${esc(top.name_ar)}</strong><br>${top.orders} orders. Main character energy.</span></p>`
    : "<p>Nobody yet. The throne is empty 👑</p>";
}

// ---------- Dish modal ----------
let dodges = 0;

async function openDish(id) {
  const modal = $("#dish-modal");
  $("#dish-body").innerHTML = "<p>Plating… 🍽️</p>";
  modal.showModal();
  let d;
  try {
    d = await api(`/api/dishes/${id}`);
  } catch (err) {
    $("#dish-body").innerHTML = `<p>${esc(err.message)}</p>`;
    return;
  }
  const soldOut = d.badges.includes("sold_out");
  const sizeChips = Object.entries(config.sizes)
    .map(([key, s]) => `<label class="chip"><input type="radio" name="size" value="${key}" ${key === "half" ? "checked" : ""}><span>${esc(s.ar)} / ${esc(s.en)}<small>${esc(s.note)} · ${egp(linePrice(config, d.price, key, []))}</small></span></label>`)
    .join("");
  const addonChips = Object.entries(config.addons)
    .map(([key, a]) => `<label class="chip"><input type="checkbox" name="addon" value="${key}" ${a.available ? "" : "disabled"}><span>${esc(a.ar)} / ${esc(a.en)}<small>${a.available ? `+${egp(a.price)}` : "not available. never was."}</small></span></label>`)
    .join("");

  $("#dish-body").innerHTML = `
    <div class="dish-hero">
      ${plate(d)}
      <div>
        <div class="badges" style="position:static">${d.badges.map((b) => `<span class="badge ${b}">${BADGE_LABELS[b] || b}</span>`).join("")}</div>
        <h2 id="dish-title" dir="auto" style="font-size:2.2rem;margin-top:8px">${esc(d.name_ar)}</h2>
        <p class="card__name-en">${esc(d.name_en)}</p>
        <p dir="auto">${esc(d.description)}</p>
        <p>${d.avg_chili ? `${"🌶️".repeat(Math.round(d.avg_chili))} ${d.avg_chili}/5 · <span class="aura">aura ${aura(d.avg_chili)}</span>` : "No reviews yet. Unrated rizz."} · ${d.review_count} reviews</p>
      </div>
    </div>
    <form id="add-form">
      <fieldset class="opt-group"><legend>Size / الحجم</legend><div class="chips">${sizeChips}</div></fieldset>
      <fieldset class="opt-group"><legend>Extras / إضافات</legend><div class="chips">${addonChips}</div></fieldset>
      <div class="add-row">
        <div class="stepper"><button type="button" data-q="-1" aria-label="Less">−</button><output id="qty" aria-live="polite">1</output><button type="button" data-q="1" aria-label="More">+</button></div>
        <button class="btn big red runaway" id="add-btn" type="submit" ${soldOut ? "disabled" : ""}>${soldOut ? "Sold out 💀" : `Add to cart · <span id="line-total"></span>`}</button>
      </div>
    </form>
    <section class="reviews" aria-labelledby="rev-title">
      <h3 id="rev-title">💬 Reviews / الآراء</h3>
      <div id="review-list">${d.reviews.map(reviewHtml).join("") || "<p>No reviews yet. Be the first hater.</p>"}</div>
      <form class="review-form" id="review-form">
        <h3>Write a review / اكتب رأيك</h3>
        <label class="field">Your name <input name="author_name" required maxlength="40" dir="auto" autocomplete="nickname"></label>
        ${ratingHtml("chili_rating", "🌶️ Spice level", "🌶️")}
        ${ratingHtml("awkward_rating", "😬 How awkward was eye contact?", "😬")}
        <label class="field">Review <textarea name="body" required maxlength="500" rows="3" dir="auto" placeholder="It's giving… overtime"></textarea></label>
        <button class="btn" type="submit">Post review 📨</button>
      </form>
    </section>`;

  const form = $("#add-form");
  let qty = 1;
  const update = () => {
    const size = form.size.value;
    const addons = $$("[name=addon]:checked", form).map((c) => c.value);
    const lt = $("#line-total");
    if (lt) lt.textContent = egp(linePrice(config, d.price, size, addons) * qty);
  };
  form.addEventListener("change", update);
  $$("[data-q]", form).forEach((b) =>
    b.addEventListener("click", () => {
      qty = Math.min(9, Math.max(1, qty + Number(b.dataset.q)));
      $("#qty").textContent = qty;
      update();
    }),
  );
  update();
  setupRunaway($("#add-btn"));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!calm() && isTouch() && dodges < 3) return dodge($("#add-btn"));
    const size = form.size.value;
    const addons = $$("[name=addon]:checked", form).map((c) => c.value);
    addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size, addons, qty, unit_price: linePrice(config, d.price, size, addons) });
    sfx.add();
    toast(`${d.name_ar} added. W choice 🫡`);
    $("#dish-modal").close();
  });

  $$(".rating", $("#review-form")).forEach((group) =>
    group.addEventListener("change", () => {
      const v = Number(group.querySelector("input:checked").value);
      $$("label", group).forEach((l, i) => l.classList.toggle("on", i < v));
    }),
  );
  $("#review-form").addEventListener("submit", (e) => postReview(e, d.id));
  $("#review-list").addEventListener("click", react);
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
      <div class="reacts">${reacts}</div>
    </article>`;
}

async function postReview(e, dishId) {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector("[type=submit]");
  btn.disabled = true;
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
    toast("Review posted. Slander delivered 📨");
    sfx.add();
  } catch (err) {
    toast(err.message, { error: true });
    sfx.error();
  } finally {
    btn.disabled = false;
  }
}

async function react(e) {
  const btn = e.target.closest(".react");
  if (!btn) return;
  btn.disabled = true;
  try {
    const { reactions } = await api(`/api/reviews/${btn.dataset.review}/react`, { method: "POST", body: JSON.stringify({ emoji: btn.dataset.emoji }) });
    btn.textContent = `${btn.dataset.emoji} ${reactions[btn.dataset.emoji] || 0}`;
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    btn.disabled = false;
  }
}

// The "Add to cart" button runs away a few times, then gives up.
function dodge(btn) {
  dodges++;
  const row = btn.parentElement.getBoundingClientRect();
  const maxX = Math.max(40, row.width - btn.offsetWidth - 20);
  const x = (Math.random() * maxX - maxX / 2) | 0;
  const y = ((Math.random() - 0.5) * 60) | 0;
  btn.style.transform = `translate(${x}px, ${y}px) rotate(${(Math.random() - 0.5) * 20}deg)`;
  const taunts = ["nope 🏃", "too slow 😹", "skill issue"];
  toast(taunts[dodges - 1] || "fine.");
  if (dodges >= 3) {
    setTimeout(() => {
      btn.style.transform = "";
      btn.firstChild.textContent = "fine 🙄 Add to cart · ";
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
  $("#go-checkout").toggleAttribute("aria-disabled", count === 0);
  $("#cart-items").innerHTML =
    cart
      .map(
        (l, i) => `
      <div class="line">
        <div><strong dir="auto">${esc(l.name_ar)}</strong> <small>${esc(config.sizes[l.size]?.ar || l.size)}${l.addons.length ? ` + ${l.addons.map((a) => esc(config.addons[a]?.en || a)).join(", ")}` : ""}</small></div>
        <strong>${egp(l.unit_price * l.qty)}</strong>
        <div class="stepper"><button type="button" data-line="${i}" data-q="-1" aria-label="Less">−</button><output>${l.qty}</output><button type="button" data-line="${i}" data-q="1" aria-label="More">+</button></div>
        <button class="tiny-link" type="button" data-remove="${i}" data-scary>Remove</button>
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
  }
  const rm = e.target.dataset.remove;
  if (rm !== undefined) {
    const step = Number(e.target.dataset.step || 0);
    if (!calm() && step < 2) {
      e.target.dataset.step = step + 1;
      e.target.textContent = removeSteps[step];
      return;
    }
    cart.splice(Number(rm), 1);
    saveCart(cart);
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
    [config, dishes, board] = await Promise.all([getConfig(), api("/api/dishes"), api("/api/leaderboard")]);
  } catch (err) {
    $("#menu").innerHTML = `<p class="panel">${esc(err.message)}</p>`;
    return;
  }
  renderMenu();
  renderHype();
  renderBoard();
  renderCart();

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
    }
  });
  let logoTaps = 0;
  $("#logo").addEventListener("click", (e) => {
    e.preventDefault();
    if (++logoTaps < 5) return scrollTo({ top: 0, behavior: calm() ? "auto" : "smooth" });
    logoTaps = 0;
    document.body.style.transition = "transform .6s";
    document.body.style.transform = "rotate(180deg)";
    toast("🙃 upside-down cake mode");
    setTimeout(() => (document.body.style.transform = ""), 2000);
  });
}

boot();
