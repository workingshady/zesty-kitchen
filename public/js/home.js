// Home page features: hero champion, leaderboard (podium / rows / tier list), worst seller,
// coworker of the day, would-you-rather duel, hunger streak, spin wheel, and the dish-photo
// toys (aura scan, sticker slap, roast). Everything "random" is seeded per dish per day so it
// stays consistent between reloads.
import { $, $$, esc, egp, toast, play, calm, pick, store, sleep, addToCart, linePrice, avatarHtml, fitImg } from "./common.js";

// ---------- shared state (set by initHome) ----------
let C = null; // config
let D = []; // dishes
let B = { top: [], worst: null, total_orders: 0 }; // leaderboard
let openDish = () => {};

// ---------- seeded randomness ----------
const hash = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const today = () => new Date().toLocaleDateString("en-CA");
const seededPick = (r, list) => list[Math.floor(r() * list.length)];

// ---------- data helpers ----------
const ordersOf = (id) => B.top.find((t) => t.id === id)?.orders || 0;
const dishById = (id) => D.find((d) => d.id === id);
const isOrderable = (d) => !d.badges.includes("sold_out") && d.category !== "expired";
const orderable = () => D.filter(isOrderable);
const fmtAura = (n) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("en-US")}`;
const catOf = (slug) => C.categories.find((c) => c.slug === slug);
const PLATE = { mandi: "🍚", grills: "🍢", shawarma: "🌯", seafood: "🦐", fatta: "🥣", sandwiches: "🥪", appetizers: "🥗", trays: "🫕", soups: "🍲", desserts: "🍰", expired: "🦴", ful: "🫘", koshary: "🍝", taameya: "🧆", mahshi: "🫑", molokhia: "🥬", basbousa: "🍯", bread: "🥖", asab: "🧃", torshi: "🌶️" };
const emojiOf = (d) => PLATE[d?.category] || "🍽️";
const face = (d, cls = "avatar") => (d?.photo_url ? `<img class="${cls}" src="${esc(d.photo_url)}" alt="" loading="lazy" decoding="async">` : `<span class="${cls}" aria-hidden="true">${emojiOf(dishById(d?.id) || d)}</span>`);

/** All-time aura: real orders + reviews, plus a tiny daily wobble so it feels alive. */
function auraAllTime(d) {
  const full = dishById(d.id) || d;
  const wobble = Math.round((rng(`aw${d.id}${today()}`)() - 0.5) * 60);
  return ordersOf(d.id) * 167 + (full.review_count || 0) * 20 + Math.round((full.avg_chili || 0) * 50) - 67 + wobble;
}
/** "Vibes today": pure daily horoscope energy, clearly labelled as fake. */
function auraVibes(d) {
  const r = rng(`vibes${d.id}${today()}`);
  const v = r();
  if (v > 0.93) return 6700;
  if (v < 0.05) return -1000;
  return Math.round(v * 9000 - 1500);
}
/** Deterministic daily rank movement: +n up, -n down, 0 same. */
function movement(id, rank) {
  const r = rng(`mv${id}${today()}`);
  const v = r();
  const n = 1 + Math.floor(r() * 3);
  if (rank === 1) return v < 0.6 ? 0 : n;
  return v < 0.4 ? n : v < 0.7 ? -n : 0;
}
function caption(rank, mv, score, mode) {
  if (rank === 1) return "W rizz 👑";
  if (mode === "all" && score === 0) return "NPC behavior 🤖";
  if (mode === "vibes" && score < 0) return "aura debt 💸";
  if (mv >= 2) return "aura farming 🌾";
  if (mv === 1) return "cooking 🔥";
  if (mv <= -2) return "fell off 📉";
  if (mv === -1) return "lowkey slipping 😬";
  return seededPick(rng(`cap${rank}${today()}`), ["mid but valid 😐", "side character 🎭", "holding it down 🫡", "locked in 🔒"]);
}
const mvHtml = (mv) =>
  mv > 0 ? `<span class="mv up" title="Up ${mv} since yesterday">▲${mv}</span>` : mv < 0 ? `<span class="mv down" title="Down ${-mv} since yesterday">▼${-mv}</span>` : `<span class="mv same" title="Same as yesterday">–</span>`;

// =====================================================================
// Hero: "Most ordered right now"
// =====================================================================
let liveTimer = 0;
function renderHero() {
  const box = $("#hero-top");
  const top = B.top[0] ? { ...B.top[0], ...dishById(B.top[0].id) } : null;
  clearInterval(liveTimer);
  if (!top) {
    const hopeful = orderable().filter((d) => d.photo_url).slice(0, 3);
    box.innerHTML = `
      <div class="champ-empty">
        <span class="champ-empty__throne" aria-hidden="true"><span>👑</span></span>
        <b>The throne is empty</b>
        <span>Zero orders so far. Your next order literally crowns someone. No pressure.</span>
        ${hopeful.length ? `<span class="champ-empty__hopefuls" aria-label="Contenders">${hopeful.map((d) => face(d, "avatar")).join("")}<small>contenders lining up 👀</small></span>` : ""}
        <a class="btn red" href="#menu-top">Be the kingmaker 🍽️</a>
      </div>`;
    return;
  }
  const r = rng(`live${today()}`);
  let todayCount = top.orders + 1 + Math.floor(r() * 9);
  const mini = B.top.slice(0, 3);
  box.innerHTML = `
    <button class="champ" type="button" data-open="${esc(top.id)}" aria-label="Number one: ${esc(top.name_ar)}, ${top.orders} orders. Open dish">
      <span class="champ__frame">
        <span class="champ__photo">${top.photo_url ? fitImg(top.photo_url) : `<span class="emoji-plate">${emojiOf(top)}</span>`}</span>
        <span class="champ__crown" aria-hidden="true">👑</span>
        <span class="champ__count">🔥 ${top.orders}× ordered</span>
      </span>
      <span class="champ__name" dir="auto">${esc(top.name_ar)}</span>
      <span class="champ__sub">${top.name_en ? `<span dir="auto">${esc(top.name_en)}</span> · ` : ""}main character energy 🎬</span>
    </button>
    <div class="champ__live"><span class="live-dot" aria-hidden="true"></span><span>🔥 <b id="live-count">+${todayCount}</b> today</span><small>${B.total_orders} orders all time</small></div>
    ${mini.length > 1 ? `<ol class="mini-podium" aria-label="Top 3">${mini.map((d, i) => `<li class="mp${i + 1}"><button type="button" data-open="${esc(d.id)}" aria-label="#${i + 1} ${esc(d.name_ar)}, ${d.orders} orders"><span class="mp__medal" aria-hidden="true">${["🥇", "🥈", "🥉"][i]}</span>${face(d)}<small>${d.orders}×</small></button></li>`).join("")}</ol>` : ""}`;
  if (!calm()) {
    liveTimer = setInterval(() => {
      if (document.hidden || Math.random() < 0.5) return;
      const el = $("#live-count");
      if (!el) return clearInterval(liveTimer);
      el.textContent = `+${++todayCount}`;
      el.classList.remove("bump");
      void el.offsetWidth;
      el.classList.add("bump");
    }, 9000);
  }
}

// ---------- hunger streak (per browser) ----------
function renderStreak() {
  const day = today();
  const yesterday = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");
  let s = store.get("zk_streak", null);
  if (!s || (s.day !== day && s.day !== yesterday)) s = { day, n: 1 };
  else if (s.day === yesterday) {
    s = { day, n: s.n + 1 };
    setTimeout(() => toast(`🔥 ${s.n}-day hunger streak. W. Don't break it.`), 2200);
  }
  store.set("zk_streak", s);
  const hungry = 3 + Math.floor(rng(`hungry${day}${new Date().getHours()}`)() * 40);
  $("#hero-chips").innerHTML = `
    <span class="chip-pill streak" title="Days in a row you opened Zesty Kitchen">🔥 ${s.n}-day streak</span>
    <span class="chip-pill"><span class="live-dot" aria-hidden="true"></span>${hungry} coworkers hungry rn</span>`;
}

// =====================================================================
// Leaderboard
// =====================================================================
const lb = { tab: store.get("zk_lb_tab", "all"), mode: store.get("zk_lb_mode", "rank") };
const MEDALS = ["🥇", "🥈", "🥉"];

function rankedList(tab) {
  if (tab === "vibes") return orderable().map((d) => ({ ...d, score: auraVibes(d), aura: auraVibes(d) })).sort((a, b) => b.score - a.score);
  return B.top.map((t) => ({ ...dishById(t.id), ...t, score: t.orders, aura: auraAllTime(t) }));
}

function podiumHtml(list, tab) {
  return `<ol class="podium" aria-label="Top 3">${list
    .slice(0, 3)
    .map((d, i) => {
      const rank = i + 1;
      const scoreTxt = tab === "vibes" ? `${fmtAura(d.aura)} aura` : `${d.orders}× · ${fmtAura(d.aura)} aura`;
      return `<li class="podium__slot p${rank}">
        <button type="button" data-open="${esc(d.id)}" aria-label="#${rank} ${esc(d.name_ar)}, ${scoreTxt}">
          <span class="podium__who">
            ${rank === 1 ? `<span class="podium__crown" aria-hidden="true">👑</span>` : ""}
            ${face(d, "avatar podium__face")}
            <b class="podium__name" dir="auto">${esc(d.name_ar)}</b>
            <small class="podium__score">${scoreTxt}</small>
            <span class="podium__cap">${caption(rank, movement(d.id, rank), d.score, tab)}</span>
          </span>
          <span class="podium__block"><span aria-hidden="true">${MEDALS[i]}</span><b>${rank}</b></span>
        </button></li>`;
    })
    .join("")}</ol>`;
}

function rowsHtml(list, tab) {
  if (list.length <= 3) return "";
  const max = Math.max(1, ...list.map((d) => Math.abs(d.score)));
  return `<ol class="lb-rows" start="4">${list
    .slice(3, 10)
    .map((d, j) => {
      const rank = j + 4;
      const mv = movement(d.id, rank);
      const pct = Math.max(4, (Math.max(0, d.score) / max) * 100);
      return `<li><button class="lb-row" type="button" data-open="${esc(d.id)}">
        <span class="lb-rank">${rank}</span>${mvHtml(mv)}${face(d)}
        <span class="lb-name"><b dir="auto">${esc(d.name_ar)}</b><small>${caption(rank, mv, d.score, tab)}</small></span>
        <span class="lb-score">${tab === "vibes" ? "" : `<b>${d.orders}×</b>`}<small class="aura">${fmtAura(d.aura)}</small></span>
        <span class="bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
      </button></li>`;
    })
    .join("")}</ol>`;
}

function tiersHtml(tab) {
  const ranked = rankedList(tab);
  const tiers = { S: [], A: [], B: [], C: [], D: [], F: [] };
  if (tab === "vibes") {
    ranked.forEach((d, i) => {
      const p = i / Math.max(1, ranked.length);
      tiers[i === 0 ? "S" : p < 0.2 ? "A" : p < 0.45 ? "B" : p < 0.7 ? "C" : p < 0.9 ? "D" : "F"].push(d);
    });
  } else {
    const max = ranked[0]?.orders || 0;
    const ranked_ids = new Set(ranked.map((d) => d.id));
    ranked.forEach((d, i) => tiers[i === 0 ? "S" : d.orders >= max * 0.6 ? "A" : d.orders >= max * 0.3 ? "B" : "C"].push(d));
    for (const d of D) {
      if (ranked_ids.has(d.id)) continue;
      if (!isOrderable(d) || d.id === B.worst?.id) tiers.F.push(d);
      else tiers.D.push(d);
    }
  }
  const caps = { S: "main character 🎬", A: "W rizz", B: "cooking 🔥", C: "mid but valid", D: "NPC behavior 🤖", F: "fell off / left the chat 💀" };
  return `<div class="tiers" role="list" aria-label="Tier list">${Object.entries(tiers)
    .map(
      ([t, list]) => `<div class="tier" role="listitem">
      <span class="tier__label t-${t}"><b>${t}</b><small>${caps[t]}</small></span>
      <span class="tier__items">${
        list.length
          ? list.map((d) => `<button type="button" class="tier__chip" data-open="${esc(d.id)}" title="${esc(d.name_ar)}${d.name_en ? ` / ${esc(d.name_en)}` : ""}" aria-label="${esc(d.name_ar)}, tier ${t}">${face(d)}<span dir="auto">${esc(d.name_ar)}</span></button>`).join("")
          : `<span class="tier__none">nobody (yet) 🦗</span>`
      }</span></div>`,
    )
    .join("")}</div>`;
}

function categoryHtml() {
  const rows = C.categories
    .map((c) => {
      const list = orderable().filter((d) => d.category === c.slug);
      if (!list.length) return null;
      const lead = [...list].sort((a, b) => ordersOf(b.id) - ordersOf(a.id))[0];
      return { c, lead, n: ordersOf(lead.id) };
    })
    .filter(Boolean)
    .sort((a, b) => b.n - a.n);
  if (!rows.length) return `<p class="lb-empty">No categories cooking yet 🦗</p>`;
  return `<div class="cat-champs">${rows
    .map(
      ({ c, lead, n }) => `<button type="button" class="cat-champ" data-open="${esc(lead.id)}">
      <span class="cat-champ__cat">${c.emoji} <span dir="auto">${esc(c.ar)}</span></span>
      ${face(lead)}
      <b dir="auto">${esc(lead.name_ar)}</b>
      <small>${n ? `👑 ${n}× ordered` : "no orders yet 🦗"}</small></button>`,
    )
    .join("")}</div>`;
}

function renderLeaderboard() {
  $$("#lb-tabs [role=tab]").forEach((b) => {
    const on = b.dataset.tab === lb.tab;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
  });
  $$("#lb-mode button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === lb.mode));
  $("#lb-mode").hidden = lb.tab === "cat";
  const stats = `<div class="board__stats">
    <span class="pill">🧾 ${B.total_orders || 0} orders total</span>
    <span class="pill">🍽️ ${D.length} coworkers</span>
    ${lb.tab === "vibes" ? `<span class="pill warn">🔮 vibes-based. not real data. resets daily</span>` : `<span class="pill">📅 since the last reset</span>`}
  </div>`;
  let body;
  if (lb.tab === "cat") body = categoryHtml();
  else if (lb.mode === "tier") body = tiersHtml(lb.tab);
  else {
    const list = rankedList(lb.tab);
    if (!list.length) {
      body = `<div class="board__empty"><span class="board__empty-podium" aria-hidden="true"><i></i><i></i><i></i></span><b>No orders yet. The podium is empty 👑</b><span>Be the first W. Order someone and put them on the board.</span><a class="btn red" href="#menu-top">Start ordering 🍽️</a></div>`;
    } else {
      const rankedIds = new Set(list.map((d) => d.id));
      const npcs = lb.tab === "all" ? orderable().filter((d) => !rankedIds.has(d.id)) : [];
      body =
        podiumHtml(list, lb.tab) +
        rowsHtml(list, lb.tab) +
        (npcs.length
          ? `<div class="npc-zone"><b>🤖 NPC zone</b><small>no orders yet (or not top 5). one order = main character arc.</small><span class="npc-zone__faces">${npcs
              .slice(0, 14)
              .map((d) => `<button type="button" data-open="${esc(d.id)}" title="${esc(d.name_ar)}" aria-label="${esc(d.name_ar)}">${face(d)}</button>`)
              .join("")}</span></div>`
          : "");
    }
  }
  $("#lb-main").innerHTML = stats + body;
}

function setupLeaderboard() {
  const tabs = $$("#lb-tabs [role=tab]");
  const select = (tab) => {
    lb.tab = tab;
    store.set("zk_lb_tab", tab);
    renderLeaderboard();
    play("click");
  };
  $("#lb-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[role=tab]");
    if (b) select(b.dataset.tab);
  });
  $("#lb-tabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.dataset.tab === lb.tab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    select(t.dataset.tab);
    t.focus();
  });
  $("#lb-mode").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    lb.mode = b.dataset.mode;
    store.set("zk_lb_mode", lb.mode);
    renderLeaderboard();
    play(lb.mode === "tier" ? "drama" : "click");
  });
  renderLeaderboard();
}

// ---------- Worst seller ----------
const ADOPT_LINES = [
  "📝 Adoption papers sent to HR. Processing time: 3–5 business years.",
  "🐶 Adopted! They now follow you to every meeting. No refunds.",
  "🏠 Foster mode: you have to say good morning to them daily. Deal?",
  "🥺 They saw you click that. They're crying in the pantry (happy tears).",
];
function renderWorst() {
  const w = B.worst ? { ...dishById(B.worst.id), ...B.worst } : null;
  const box = $("#board-worst");
  if (!w) {
    box.innerHTML = `<h3>💀 Worst seller / الأقل طلبًا</h3><p class="worst__none">Nobody's losing yet. Give it time 😈</p>`;
    return;
  }
  const days = w.orders === 0 ? "∞" : String(1 + (hash(`days${w.id}${today()}`) % 13));
  box.innerHTML = `
    <h3>💀 Worst seller / الأقل طلبًا</h3>
    <div class="worst-card">
      <button class="worst__photo" type="button" data-save aria-label="Open ${esc(w.name_ar)}">
        ${w.photo_url ? fitImg(w.photo_url) : `<span class="emoji-plate">${emojiOf(w)}</span>`}
        <span class="stamp" aria-hidden="true">L + ratio</span>
      </button>
      <b class="worst__name" dir="auto">${esc(w.name_ar)}</b>
      ${w.name_en ? `<small class="worst__en" dir="auto">${esc(w.name_en)}</small>` : ""}
      <div class="worst__stats">
        <span><b>${w.orders}</b> orders</span>
        <span><b>${days}</b> days since last order</span>
        <span><b>${fmtAura(auraAllTime(w))}</b> aura</span>
      </div>
      <p>Nobody wants them. Be the main character in their redemption arc 🥺</p>
      <div class="worst__actions">
        <button class="btn red" type="button" data-save>Save them 🥺 order one</button>
        <button class="btn white" type="button" data-adopt>🐶 Adopt a coworker</button>
      </div>
    </div>`;
  let adopt = 0;
  box.onclick = (e) => {
    if (e.target.closest("[data-save]")) {
      play("sad");
      openDish(w.id);
    } else if (e.target.closest("[data-adopt]")) {
      toast(ADOPT_LINES[adopt++ % ADOPT_LINES.length]);
      play(adopt === 1 ? "sad" : "laugh");
    }
  };
}

// =====================================================================
// Side quests: coworker of the day + would-you-rather duel
// =====================================================================
const VIBES = ["locked in 🔒", "lowkey chaotic 🌪️", "on mute all day 🔇", "main character 🎬", "running on 3 coffees ☕", "fake busy 💻", "out of office (mentally) 🏝️", "aura farming 🌾"];
const SNACKS = ["فول بالزيت الحار", "طعمية سخنة", "كشري بالدقة", "بسبوسة المدير", "عصير قصب", "شاي بلبن", "كرواسون الاجتماع", "سندوتش بطاطس"];
const AVOID = ["reply-all emails", "the 4pm meeting", "the printer 🖨️", "HR's DMs", "\"quick question\" calls", "the office group chat", "standing near the boss", "Mondays"];
function renderPotd() {
  const box = $("#potd-section");
  const list = orderable();
  if (!list.length) return (box.innerHTML = `<h3>🌟 Coworker of the day</h3><p>The menu is empty 🦗</p>`);
  const r = rng(`potd${today()}`);
  const d = list[Math.floor(r() * list.length)];
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  box.innerHTML = `
    <div class="quest__head"><h3>🌟 Coworker of the day <small>زميل اليوم</small></h3><span class="quest__date">${esc(date)}</span></div>
    <div class="potd">
      <button class="potd__photo" type="button" data-open="${esc(d.id)}" aria-label="Open ${esc(d.name_ar)}">${d.photo_url ? fitImg(d.photo_url) : `<span class="emoji-plate">${emojiOf(d)}</span>`}<span class="potd__badge">✨ of the day</span></button>
      <div class="potd__info">
        <b class="potd__name" dir="auto">${esc(d.name_ar)}</b>
        ${d.job_title ? `<span class="card__job" dir="auto">💼 ${esc(d.job_title)}</span>` : ""}
        <dl class="potd__facts">
          <div><dt>Today's vibe</dt><dd>${seededPick(r, VIBES)}</dd></div>
          <div><dt>Lucky snack</dt><dd dir="auto">${seededPick(r, SNACKS)}</dd></div>
          <div><dt>Avoid</dt><dd>${seededPick(r, AVOID)}</dd></div>
          <div><dt>Aura forecast</dt><dd><span class="aura">${fmtAura(auraVibes(d))}</span></dd></div>
        </dl>
        <div class="potd__actions"><button class="btn red" type="button" data-open="${esc(d.id)}">Order them 🍽️</button><button class="btn white" type="button" id="potd-reroll">🎲 Reroll</button></div>
      </div>
    </div>`;
  $("#potd-reroll").addEventListener("click", () => {
    toast(pick(["It's DAILY. Come back tomorrow 😤", "no rerolls. this isn't gacha 🎰", "الاختيار نهائي يسطا 🫡"]));
    play("no");
  });
}

const duel = { round: 0 };
function duelPair() {
  const list = orderable();
  if (list.length < 2) return null;
  const r = rng(`duel${today()}${duel.round}`);
  const a = Math.floor(r() * list.length);
  let b = Math.floor(r() * (list.length - 1));
  if (b >= a) b++;
  return [list[a], list[b]];
}
function renderDuel() {
  const box = $("#duel");
  const pair = duelPair();
  if (!pair) return (box.innerHTML = `<h3>⚔️ Would you rather eat?</h3><p>Need at least 2 coworkers on the menu 🦗</p>`);
  const key = `${today()}|${pair[0].id}|${pair[1].id}`;
  const votes = store.get("zk_duels", {});
  const mine = votes[key];
  const r = rng(`dv${key}`);
  const base = [12 + Math.floor(r() * 80), 12 + Math.floor(r() * 80)];
  if (mine !== undefined) base[mine]++;
  const total = base[0] + base[1];
  const pct = base.map((n) => Math.round((n / total) * 100));
  const won = pct[0] === pct[1] ? -1 : pct[0] > pct[1] ? 0 : 1;
  const side = (d, i) => `
    <button class="duel__side ${mine === i ? "picked" : ""}" type="button" data-vote="${i}" ${mine !== undefined ? "disabled" : ""} aria-label="Eat ${esc(d.name_ar)}">
      <span class="duel__photo">${d.photo_url ? fitImg(d.photo_url) : `<span class="emoji-plate">${emojiOf(d)}</span>`}${mine !== undefined ? `<span class="stamp ${won === i ? "w" : "l"}">${won === i ? "W" : won === -1 ? "TIE" : "L"}</span>` : ""}</span>
      <b dir="auto">${esc(d.name_ar)}</b>
      ${mine !== undefined ? `<span class="duel__bar"><span style="width:${pct[i]}%"></span><em>${pct[i]}%</em></span>` : `<small>${egp(linePrice(C, d.price, "half", []))}</small>`}
    </button>`;
  box.innerHTML = `
    <div class="quest__head"><h3>⚔️ Would you rather eat? <small>تاكل مين؟</small></h3><span class="quest__date">duel #${duel.round + 1}</span></div>
    <div class="duel">${side(pair[0], 0)}<span class="duel__vs" aria-hidden="true">VS</span>${side(pair[1], 1)}</div>
    <p class="duel__result" aria-live="polite">${mine !== undefined ? `${total} votes. ${won === mine ? "You're with the majority. NPC-certified 🤖" : won === -1 ? "Dead even. Chaos 🌪️" : "Minority opinion. Main character behavior 🎬"}` : "Pick one. No skipping. HR is watching 👀"}</p>
    <div class="duel__actions">${mine !== undefined ? `<button class="btn sky" type="button" data-next>⏭️ Next duel</button><button class="btn white" type="button" data-open="${esc(pair[mine].id)}">Order your pick 🍽️</button>` : ""}</div>`;
  box.onclick = (e) => {
    const v = e.target.closest("[data-vote]");
    if (v && !v.disabled) {
      votes[key] = Number(v.dataset.vote);
      store.set("zk_duels", votes);
      play("drama");
      return renderDuel();
    }
    if (e.target.closest("[data-next]")) {
      duel.round++;
      play("pop");
      renderDuel();
      $("#duel [data-vote]")?.focus();
    }
  };
}

// =====================================================================
// Spin & Eat wheel
// =====================================================================
const TAU = Math.PI * 2;
const WHEEL_COLORS = ["#ffc700", "#ff69b4", "#8ace00", "#7fd3ff", "#fa4b13", "#ffffff"];
const wheel = { angle: 0, spinning: false, removed: new Set(), sheet: null, items: [], imgs: new Map(), last: null };

const wheelPool = () => orderable().filter((d) => !wheel.removed.has(d.id));
const findBoss = (list) => {
  const i = list.findIndex((d) => /boss|manager|ceo|director|مدير|ممدوح|الأستاذ|الاستاذ|ريس/i.test(`${d.name_ar} ${d.name_en} ${d.job_title}`));
  if (i >= 0) return i;
  return list.length > 2 ? list.reduce((m, d, j) => (d.price > list[m].price ? j : m), 0) : -1;
};
const shortName = (s, max) => ([...s].length > max ? `${[...s].slice(0, max - 1).join("")}…` : s);

function loadWheelImg(d) {
  if (!d.photo_url || wheel.imgs.has(d.id)) return;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    if (wheel.items.some((x) => x.id === d.id) && !wheel.spinning) {
      paintSheet();
      drawWheel();
    }
  };
  img.src = d.photo_url;
  wheel.imgs.set(d.id, img);
}

/** Paints the static wheel once into an offscreen canvas; each frame just rotates it. */
function paintSheet(highlight = -1) {
  const list = wheel.items;
  const n = list.length;
  const sheet = (wheel.sheet ||= document.createElement("canvas"));
  sheet.width = sheet.height = 600;
  const g = sheet.getContext("2d");
  g.clearRect(0, 0, 600, 600);
  g.save();
  g.translate(300, 300);
  const slice = TAU / n;
  const font = n <= 6 ? 32 : n <= 12 ? 26 : n <= 16 ? 21 : 16;
  const photoR = Math.min(38, Math.max(14, Math.sin(slice / 2) * 228 * 0.78));
  list.forEach((d, i) => {
    const a0 = i * slice;
    const a1 = a0 + slice;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 294, a0, a1);
    g.closePath();
    g.fillStyle = WHEEL_COLORS[(n % WHEEL_COLORS.length === 1 && i === n - 1 ? i + 1 : i) % WHEEL_COLORS.length];
    g.fill();
    if (i === highlight) {
      g.fillStyle = "rgba(255,255,255,.55)";
      g.fill();
    }
    g.lineWidth = 4;
    g.strokeStyle = "#111";
    g.stroke();
    g.save();
    g.rotate(a0 + slice / 2);
    // photo (or emoji) near the rim
    const cx = 294 - photoR - 14;
    const img = wheel.imgs.get(d.id);
    g.save();
    g.beginPath();
    g.arc(cx, 0, photoR, 0, TAU);
    g.fillStyle = "#fff4e0";
    g.fill();
    if (img?.complete && img.naturalWidth) {
      g.clip();
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - s) / 2;
      const sy = Math.max(0, (img.naturalHeight - s) * 0.3);
      g.translate(cx, 0);
      g.rotate(Math.PI / 2);
      g.drawImage(img, sx, sy, s, s, -photoR, -photoR, photoR * 2, photoR * 2);
    } else {
      g.translate(cx, 0);
      g.rotate(Math.PI / 2);
      g.font = `${Math.round(photoR * 1.2)}px serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#111";
      g.fillText(emojiOf(d), 0, 2);
    }
    g.restore();
    g.beginPath();
    g.arc(cx, 0, photoR, 0, TAU);
    g.lineWidth = 3;
    g.strokeStyle = "#111";
    g.stroke();
    // name between hub and photo
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillStyle = "#111";
    g.font = `${font}px Lalezar, "Baloo Bhaijaan 2", sans-serif`;
    const room = cx - photoR - 10 - 58;
    let label = shortName(d.name_ar, n <= 8 ? 16 : 12);
    while (label.length > 2 && g.measureText(label).width > room) label = shortName(label.replace(/…$/, ""), [...label].length - 1);
    g.fillText(label, cx - photoR - 10, 1);
    g.restore();
  });
  g.restore();
}

function drawWheel() {
  const cv = $("#wheel");
  if (!cv || !wheel.sheet) return;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, 600, 600);
  g.save();
  g.translate(300, 300);
  g.rotate(wheel.angle);
  g.drawImage(wheel.sheet, -300, -300);
  g.restore();
}

function resetWheelItems() {
  wheel.items = wheelPool();
  wheel.items.forEach(loadWheelImg);
  paintSheet();
  drawWheel();
  const n = wheel.items.length;
  $("#wheel-pool").innerHTML = `🎯 ${n} coworker${n === 1 ? "" : "s"} on the wheel${wheel.removed.size ? ` · <button class="tiny-link" type="button" data-wheel="reset">↺ bring everyone back</button>` : ""}`;
  $("#spin").disabled = n === 0;
}

const indexUnderPointer = (angle, n) => {
  const local = (((-Math.PI / 2 - angle) % TAU) + TAU) % TAU;
  return Math.floor(local / (TAU / n)) % n;
};

function wobblePointer() {
  const p = $("#wheel-pointer");
  if (!p?.animate || calm()) return;
  p.animate([{ transform: "translateX(-50%) rotate(-24deg)" }, { transform: "translateX(-50%) rotate(0deg)" }], { duration: 140, easing: "ease-out" });
}

function spin() {
  if (wheel.spinning) return;
  const items = wheelPool();
  if (!items.length) return;
  wheel.items = items;
  paintSheet();
  const n = items.length;
  const bossIdx = findBoss(items);
  let winner = Math.floor(Math.random() * n);
  let tease = false;
  if (bossIdx >= 0 && n > 2 && !calm() && Math.random() < 0.4) {
    tease = true;
    winner = (bossIdx + 1) % n; // crawl through the boss's slice, then *just* miss it
  }
  wheel.spinning = true;
  $("#spin").disabled = true;
  $("#wheel-result").hidden = true;
  $("#wheel-status").textContent = pick(["🎰 spinning… HR is watching", "🌀 fate is loading…", "🙏 يا رب مش المدير"]);
  play("whoosh");
  const start = wheel.angle;
  const offset = tease ? 0.08 + Math.random() * 0.08 : 0.2 + Math.random() * 0.6; // never land on a line
  const landing = -Math.PI / 2 - (winner + offset) * (TAU / n);
  let end = landing;
  while (end > start - (5 + Math.floor(Math.random() * 2)) * TAU) end -= TAU;
  const duration = calm() ? 10 : tease ? 6800 : 4600;
  const power = tease ? 5 : 4;
  const t0 = performance.now();
  let lastIdx = indexUnderPointer(start, n);
  let lastTick = 0;
  let teased = false;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / duration);
    wheel.angle = start + (end - start) * (1 - Math.pow(1 - p, power));
    drawWheel();
    const idx = indexUnderPointer(wheel.angle, n);
    if (idx !== lastIdx) {
      lastIdx = idx;
      wobblePointer();
      if (t - lastTick > 55) {
        lastTick = t;
        play("tick");
      }
    }
    if (tease && !teased && p > 0.72) {
      teased = true;
      $("#wheel-status").textContent = `🤨 slowing down near ${items[bossIdx].name_ar}… suspicious`;
      play("suspense");
    }
    if (p < 1) return requestAnimationFrame(step);
    finishSpin(items[winner], winner, tease ? items[bossIdx] : null);
  };
  requestAnimationFrame(step);
}

function finishSpin(d, idx, boss) {
  wheel.spinning = false;
  wheel.last = d;
  $("#spin").disabled = false;
  $("#spin").innerHTML = "🔁 Spin again / تاني";
  paintSheet(idx);
  drawWheel();
  const isBoss = findBoss(wheel.items) === idx && /boss|manager|مدير|ممدوح|الأستاذ/i.test(`${d.name_ar} ${d.name_en} ${d.job_title}`);
  $("#wheel-status").textContent = boss ? `😮‍💨 missed ${boss.name_ar} by a pixel. HR rigged it.` : isBoss ? "🚨 The wheel chose the boss. Bold move." : pick(["🎉 the wheel has spoken", "⚖️ fate said so. no appeals.", "🫵 it's giving destiny"]);
  const box = $("#wheel-result");
  box.hidden = false;
  box.innerHTML = `
    <div class="wheel-card">
      ${face(d, "avatar wheel-card__face")}
      <div class="wheel-card__info"><small>The wheel chose</small><b dir="auto">${esc(d.name_ar)}</b>${d.job_title ? `<span dir="auto">💼 ${esc(d.job_title)}</span>` : ""}<span class="price">${egp(linePrice(C, d.price, "half", []))} <small>نص / half</small></span></div>
      <span class="stamp w" aria-hidden="true">W</span>
    </div>
    <div class="wheel-card__actions">
      <button class="btn red" type="button" data-wheel="add">🛒 Add to cart</button>
      <button class="btn white" type="button" data-wheel="view">👀 View dish</button>
      <button class="btn white" type="button" data-wheel="remove">🚫 Remove & respin</button>
    </div>`;
  play(boss ? "lol" : "celebrate");
}

function setupWheel() {
  const modal = $("#wheel-modal");
  $("#open-wheel").addEventListener("click", () => {
    if (!orderable().length) return toast("The menu is empty 🦗");
    $("#wheel-status").textContent = "Can't decide who to eat? Let fate (and HR) decide.";
    $("#wheel-result").hidden = true;
    $("#spin").innerHTML = "Spin / دوّر 🎰";
    modal.showModal();
    resetWheelItems();
  });
  $("#close-wheel").addEventListener("click", () => modal.close());
  modal.addEventListener("click", (e) => e.target === modal && modal.close());
  $("#spin").addEventListener("click", spin);
  modal.addEventListener("click", (e) => {
    const act = e.target.closest("[data-wheel]")?.dataset.wheel;
    if (!act) return;
    const d = wheel.last;
    if (act === "reset") {
      wheel.removed.clear();
      resetWheelItems();
      play("pop");
    } else if (act === "add" && d) {
      addToCart({ dish_id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: d.photo_url, size: "half", addons: [], qty: 1, unit_price: linePrice(C, d.price, "half", []) });
      play("cash");
      toast(`${d.name_ar} اتضاف. The wheel thanks you 🎡`);
      const cart = $("#open-cart");
      cart.classList.remove("bump");
      void cart.offsetWidth;
      cart.classList.add("bump");
      e.target.closest("button").disabled = true;
      e.target.closest("button").textContent = "✅ In your cart";
    } else if (act === "view" && d) {
      modal.close();
      openDish(d.id);
    } else if (act === "remove" && d) {
      wheel.removed.add(d.id);
      play("remove");
      $("#wheel-result").hidden = true;
      resetWheelItems();
      $("#wheel-status").textContent = `${d.name_ar} got kicked off the wheel. Brutal 💀`;
      if (wheel.items.length) spin();
    }
  });
}

// =====================================================================
// Dish modal toys: aura scan, sticker slap, roast
// =====================================================================
let toyToken = 0;
const STICKER_PACKS = {
  "W / L": ["W", "L", "W rizz", "L + ratio", "ratio", "+1000 aura", "aura -1000", "main character", "fell off 📉", "no cap 🧢"],
  brainrot: ["chopped", "6 7", "NPC", "cooked 🔥", "glazing 🍩", "mewing 🤫", "delulu", "slay 💅", "sigma", "skibidi", "rizz", "unc"],
  "مصري": ["عاش", "اتقل", "فكك", "يا جدع", "يسطا", "قشطة", "اشطا", "مود", "فل الفل", "جامد", "ولا يهمك", "نو كومنت"],
  emoji: ["💀", "🔥", "🫵", "👑", "🤡", "😭", "🗿", "👀", "🍋", "🧢", "💅", "🚩"],
};
const STICKER_COLORS = ["#ffc700", "#ff69b4", "#8ace00", "#7fd3ff", "#ffffff", "#ff3b30"];
const ROASTS = [
  (n) => `${n} replies "noted 👍" to every email and notes absolutely nothing.`,
  (n) => `${n} said "quick call" and it was 47 minutes.`,
  (n) => `${n}'s camera has been "broken" since 2021.`,
  (n) => `${n} says "per my last email" with violence.`,
  (n) => `${n} joins every meeting 4 minutes late with "can you hear me?"`,
  (n) => `${n} has 67 open tabs and zero finished tasks.`,
  (n) => `${n} circles back so much they're basically a roundabout.`,
  (n) => `${n} takes the last coffee and never makes a new pot.`,
  (n) => `${n} put "synergy" in a sentence. Unironically.`,
  (n) => `${n} بيقول "خمس دقايق وجاي" من الصبح.`,
  (n) => `${n} بيرد على أي حاجة بـ "تمام" وخلاص.`,
  (n) => `${n} أول واحد في البوفيه وآخر واحد في الشغل.`,
  (n) => `${n} schedules a meeting to plan the next meeting.`,
  (n) => `${n}'s Teams status has been "Away" since onboarding.`,
];

/** Wire the photo toys for the dish currently open in the modal. */
export function dishTools(d) {
  const token = ++toyToken;
  const alive = () => token === toyToken && $("#dish-modal").open;
  const photo = $("#dish-photo");
  const extras = $("#photo-extras");
  const panel = (id, html) => {
    extras.querySelector(`[data-panel]:not([data-panel="${id}"])`)?.remove();
    let el = extras.querySelector(`[data-panel="${id}"]`);
    if (!el) {
      el = document.createElement("div");
      el.dataset.panel = id;
      extras.append(el);
    }
    el.innerHTML = html;
    return el;
  };

  // ---------- 📸 Scan aura ----------
  $("#scan-aura").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const r = rng(`aura${d.id}${today()}`);
    const roll = r();
    const auraScore = roll > 0.92 ? 6700 : roll > 0.86 ? 9001 : roll < 0.06 ? -1000 : roll < 0.1 ? 67 : Math.round(r() * 9000 - 2000);
    const rizz = Math.round(r() * 100);
    const npc = Math.max(0, Math.min(100, 100 - rizz + Math.round((r() - 0.5) * 30)));
    const delulu = 1 + Math.floor(r() * 10);
    const mce = Math.round(r() * 100);
    const verdict = auraScore >= 6700 ? "aura farming detected 🌾" : auraScore > 2500 ? "main character energy 🎬" : auraScore > 500 ? "W rizz, certified 🫵" : auraScore > 0 ? "mid but valid 😐" : "aura debt. cooked 💀";
    $$(".scan-ov", photo).forEach((x) => x.remove());
    const fast = calm();
    if (!fast) {
      photo.insertAdjacentHTML(
        "beforeend",
        `<span class="scan-ov" aria-hidden="true"><span class="scan-box"><i></i><i></i><i></i><i></i><em>DETECTING…</em></span><span class="scan-line"></span><span class="scan-read"></span></span>`,
      );
      const ov = $(".scan-ov", photo);
      const read = $(".scan-read", ov);
      const line = (t) => {
        read.insertAdjacentHTML("beforeend", `<span>&gt; ${t}</span>`);
        while (read.children.length > 3) read.firstChild.remove();
      };
      play("magic");
      line("booting rizz sensors…");
      await sleep(700);
      if (!alive()) return;
      ov.classList.add("locked");
      $("em", ov).textContent = "FACE LOCKED ✓";
      play("what");
      line("measuring side-eye…");
      await sleep(700);
      if (!alive()) return;
      ov.classList.add("scanning");
      play("drumroll");
      line("checking LinkedIn activity…");
      await sleep(800);
      if (!alive()) return;
      line(`aura ≈ ${fmtAura(auraScore)}`);
      await sleep(600);
      if (!alive()) return;
      ov.remove();
    }
    const text = `📸 Zesty Kitchen aura scan (${today()})\n${d.name_ar}${d.name_en ? ` / ${d.name_en}` : ""}: ${fmtAura(auraScore)} aura · ${verdict}\nRizz ${rizz}% · NPC ${npc}% · Delulu ${delulu}/10 · Main character energy ${mce}%`;
    const meter = (label, v, unit = "%", max = 100) => `<div><dt>${label}</dt><dd><span class="meter" aria-hidden="true"><span style="width:${(v / max) * 100}%"></span></span><b>${v}${unit}</b></dd></div>`;
    panel(
      "aura",
      `<div class="aura-card" role="status">
        <div class="aura-card__head"><b>📸 AURA SCAN</b><small>${esc(today())} · same result all day</small></div>
        <div class="aura-card__score ${auraScore < 0 ? "neg" : ""}">${fmtAura(auraScore)} <small>aura</small></div>
        <div class="aura-card__verdict">${verdict}</div>
        <dl class="aura-stats">${meter("Rizz", rizz)}${meter("NPC", npc)}${meter("Delulu", delulu, "/10", 10)}${meter("Main character", mce)}</dl>
        <div class="aura-card__actions"><button class="btn white" type="button" data-copy>📋 Copy result</button><button class="btn white" type="button" data-close>✕</button></div>
      </div>`,
    );
    const card = $('[data-panel="aura"]', extras);
    card.querySelector("[data-copy]").addEventListener("click", async (ev) => {
      try {
        await navigator.clipboard.writeText(text);
        ev.currentTarget.textContent = "✅ Copied. Go flex";
        play("pop");
      } catch {
        toast("Couldn't copy. Screenshot it like it's 2015 📸", { error: true });
      }
    });
    card.querySelector("[data-close]").addEventListener("click", () => card.remove());
    play(auraScore > 2500 ? "hype" : auraScore > 0 ? "success" : "bigfail");
    btn.disabled = false;
    btn.textContent = "📸 Scan again";
  });

  // ---------- 🫵 Sticker slap ----------
  let pack = Object.keys(STICKER_PACKS)[0];
  const trayHtml = () => `
    <div class="sticker-tray">
      <div class="sticker-tray__tabs" role="tablist" aria-label="Sticker packs">${Object.keys(STICKER_PACKS)
        .map((k) => `<button type="button" role="tab" aria-selected="${k === pack}" data-pack="${esc(k)}">${esc(k)}</button>`)
        .join("")}</div>
      <div class="sticker-tray__grid">${STICKER_PACKS[pack].map((s) => `<button type="button" data-stk="${esc(s)}" dir="auto">${esc(s)}</button>`).join("")}</div>
      <div class="sticker-tray__foot"><small>Tap to slap · drag to move · Delete key removes</small><span><button class="btn white" type="button" data-clear>🧽 Clear</button><button class="btn sky" type="button" data-dl>⬇️ Download</button></span></div>
    </div>`;
  $("#slap").addEventListener("click", () => {
    const open = extras.querySelector('[data-panel="tray"]');
    if (open) {
      open.remove();
      $("#slap").setAttribute("aria-expanded", "false");
      return;
    }
    const el = panel("tray", trayHtml());
    $("#slap").setAttribute("aria-expanded", "true");
    el.addEventListener("click", (e) => {
      const p = e.target.closest("[data-pack]");
      if (p) {
        pack = p.dataset.pack;
        el.innerHTML = trayHtml();
        return play("pop");
      }
      const s = e.target.closest("[data-stk]");
      if (s) return slap(s.dataset.stk);
      if (e.target.closest("[data-clear]")) {
        $$(".sticker", photo).forEach((x) => x.remove());
        play("whoosh");
        return;
      }
      if (e.target.closest("[data-dl]")) downloadPhoto(d, photo);
    });
    if (!$$(".sticker", photo).length) slap(pick(STICKER_PACKS[pack]));
  });

  function slap(text) {
    const all = $$(".sticker", photo);
    if (all.length >= 12) all[0].remove();
    const s = document.createElement("span");
    s.className = "sticker";
    s.tabIndex = 0;
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", `Sticker: ${text}. Arrow keys move it, Delete removes it`);
    s.dir = "auto";
    const r = Math.round((Math.random() - 0.5) * 36);
    s.style.setProperty("--r", `${r}deg`);
    s.style.left = `${4 + Math.random() * 56}%`;
    s.style.top = `${4 + Math.random() * 70}%`;
    s.style.background = pick(STICKER_COLORS);
    if (s.style.background.includes("255, 59, 48")) s.style.color = "#fff";
    if (/^\p{Extended_Pictographic}/u.test(text) && [...text].length <= 2) s.classList.add("emoji");
    s.textContent = text;
    photo.append(s);
    if (!calm()) {
      const m = $("#dish-modal");
      m.classList.remove("slap-shake");
      void m.offsetWidth;
      m.classList.add("slap-shake");
    }
    play(pick(["slap", "slap", "bonk", "pipe"]));
  }

  // drag (pointer) + keyboard nudging
  let drag = null;
  photo.onpointerdown = (e) => {
    const s = e.target.closest(".sticker");
    if (!s) return;
    e.preventDefault();
    s.setPointerCapture(e.pointerId);
    const r = photo.getBoundingClientRect();
    const sr = s.getBoundingClientRect();
    drag = { s, r, dx: e.clientX - sr.left, dy: e.clientY - sr.top };
    s.classList.add("dragging");
  };
  photo.onpointermove = (e) => {
    if (!drag) return;
    const { s, r, dx, dy } = drag;
    const x = ((e.clientX - dx - r.left) / r.width) * 100;
    const y = ((e.clientY - dy - r.top) / r.height) * 100;
    s.style.left = `${Math.max(-5, Math.min(92, x))}%`;
    s.style.top = `${Math.max(-5, Math.min(92, y))}%`;
  };
  photo.onpointerup = photo.onpointercancel = () => {
    drag?.s.classList.remove("dragging");
    drag = null;
  };
  photo.onkeydown = (e) => {
    const s = e.target.closest(".sticker");
    if (!s) return;
    const mv = { ArrowLeft: [-3, 0], ArrowRight: [3, 0], ArrowUp: [0, -3], ArrowDown: [0, 3] }[e.key];
    if (mv) {
      e.preventDefault();
      s.style.left = `${Math.max(-5, Math.min(92, parseFloat(s.style.left) + mv[0]))}%`;
      s.style.top = `${Math.max(-5, Math.min(92, parseFloat(s.style.top) + mv[1]))}%`;
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      s.remove();
      play("pop");
    }
  };

  // ---------- 🎤 Roast ----------
  let roastI = hash(d.id + today()) % ROASTS.length;
  $("#roast").addEventListener("click", () => {
    const name = d.name_en || d.name_ar;
    const el = panel("roast", `<div class="roast" role="status"><span class="roast__mic" aria-hidden="true">🎤</span><p dir="auto">${esc(ROASTS[roastI++ % ROASTS.length](name))}</p><small>Workplace roast. Keep it about the job, never the person. 🫡</small><button class="btn white" type="button" data-again>🔁 Another one</button></div>`);
    el.querySelector("[data-again]").addEventListener("click", () => $("#roast").click());
    play("lol");
  });
}

/** Render the photo + stickers into a PNG download (canvas). */
async function downloadPhoto(d, photo) {
  const size = 900;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const pr = photo.getBoundingClientRect();
  const k = size / pr.width;
  g.fillStyle = "#fff4e0";
  g.fillRect(0, 0, size, size);
  try {
    if (d.photo_url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = d.photo_url;
      await img.decode();
      const contain = photo.querySelector(".fit")?.classList.contains("fit--contain");
      const ir = img.naturalWidth / img.naturalHeight;
      if (contain) {
        const w = ir > 1 ? size : size * ir;
        const h = ir > 1 ? size / ir : size;
        g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      } else {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        g.drawImage(img, (img.naturalWidth - s) / 2, Math.max(0, (img.naturalHeight - s) * 0.3), s, s, 0, 0, size, size);
      }
    } else {
      g.font = `${size * 0.5}px serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(emojiOf(d), size / 2, size / 2);
    }
    for (const s of $$(".sticker", photo)) {
      const sr = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      const rot = (parseFloat(s.style.getPropertyValue("--r")) || 0) * (Math.PI / 180);
      const w = s.offsetWidth * k;
      const h = s.offsetHeight * k;
      g.save();
      g.translate((sr.left + sr.width / 2 - pr.left) * k, (sr.top + sr.height / 2 - pr.top) * k);
      g.rotate(rot);
      if (!s.classList.contains("emoji")) {
        g.fillStyle = "#111";
        g.beginPath();
        g.roundRect(-w / 2 + 4 * k, -h / 2 + 4 * k, w, h, 10 * k);
        g.fill();
        g.fillStyle = cs.backgroundColor;
        g.beginPath();
        g.roundRect(-w / 2, -h / 2, w, h, 10 * k);
        g.fill();
        g.lineWidth = 3 * k;
        g.strokeStyle = "#111";
        g.stroke();
      }
      g.fillStyle = cs.color;
      g.font = `${parseFloat(cs.fontSize) * k}px Lalezar, "Baloo Bhaijaan 2", sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(s.textContent, 0, 2 * k);
      g.restore();
    }
    g.font = `bold ${22}px "Baloo Bhaijaan 2", sans-serif`;
    g.textAlign = "right";
    g.fillStyle = "rgba(17,17,17,.75)";
    g.fillText("🍋 zesty kitchen", size - 16, size - 18);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) throw new Error("no blob");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zesty-${(d.name_en || "coworker").replace(/[^\w-]+/g, "-").toLowerCase()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    play("success");
    toast("Saved 📸 send it to the group chat (at your own risk)");
  } catch {
    toast("Couldn't render the photo. Screenshot it instead 📸", { error: true });
  }
}

// =====================================================================
// Boot
// =====================================================================
export function initHome(ctx) {
  ({ config: C, dishes: D, board: B, openDish } = ctx);
  renderHero();
  renderStreak();
  renderPotd();
  renderDuel();
  setupLeaderboard();
  renderWorst();
  setupWheel();
  // One delegated handler for every [data-open] in home sections
  for (const id of ["#hero-top", "#leaderboard", "#side-quests"]) {
    $(id)?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (!b) return;
      play("pop");
      openDish(b.dataset.open);
    });
  }
}
