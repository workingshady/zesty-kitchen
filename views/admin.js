const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
let config = null;
let dishes = [];
let reviews = [];
let orders = [];
let editing = null;
let currentTab = "overview";
const selectedDishes = new Set();
const selectedReviews = new Set();
let orderRange = "all";
let aiEnabled = false;
let highlightOnly = false;
const TABS = ["overview", "dishes", "reviews", "orders", "settings"];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? {} : { "Content-Type": options.contentType || "application/json" },
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status });
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const egp = (n) => `${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;
const dishName = (d) => d?.name_en || d?.name_ar || "?";
const nameHtml = (d) => `<strong dir="auto">${esc(d.name_ar)}</strong>${d.name_en ? ` · <span dir="auto">${esc(d.name_en)}</span>` : ""}`;
const when = (iso) => new Date(iso).toLocaleString();
const PAYMENT_LABELS = { vibes: "✨ Vibes", insults: "🗯️ Insults", owe_lunch: "🍱 Owe lunch" };
const ISSUE_LABELS = { no_photo: "📸 no photo", no_description: "📝 no description", hidden: "🙈 hidden" };

// ---- Toasts (instead of alert) ----
function toast(message, { type = "ok", undo, ms = 5000 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span>${esc(message)}</span>${undo ? `<button class="btn small ghost" type="button">Undo</button>` : ""}`;
  const remove = () => el.remove();
  if (undo) {
    el.querySelector("button").addEventListener("click", async () => {
      remove();
      try {
        await undo();
      } catch (err) {
        toast(err.message, { type: "error" });
      }
    });
  }
  $("#toasts").append(el);
  setTimeout(remove, type === "error" ? Math.max(ms, 7000) : ms);
}
const fail = (err) => {
  if (err.status === 401) return showLogin();
  toast(err.message, { type: "error" });
};

const loading = (sel) => ($(sel).innerHTML = `<li class="state">Loading…</li>`);

function showLogin() {
  $("#login").hidden = false;
  $("#panel").hidden = true;
  $("#logout").hidden = true;
  $("#chef-fab").hidden = true;
  $("#shortcuts-open").hidden = true;
  closeChef();
}

async function showPanel() {
  // Probe auth first so a 401 lands on the login screen
  dishes = await api("/api/admin/dishes");
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  const fromHash = location.hash.slice(1);
  $("#chef-fab").hidden = false;
  $("#shortcuts-open").hidden = false;
  switchTab(TABS.includes(fromHash) ? fromHash : "overview");
  chefInit();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: e.target.password.value }) });
    e.target.reset();
    await showPanel();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

function switchTab(name) {
  currentTab = name;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  history.replaceState(null, "", `#${name}`);
  LOADERS[name]().catch(fail);
}
const LOADERS = { overview: () => loadOverview(), dishes: () => loadDishes(), reviews: () => loadReviews(), orders: () => loadOrders(), settings: () => loadSettings() };
$$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

// ---- Theme (light / dark / system), remembered per browser ----
function applyTheme(mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("#theme-toggle").textContent = dark ? "☀️" : "🌙";
  $$("[data-theme-set]").forEach((b) => b.classList.toggle("active", b.dataset.themeSet === mode));
}
const themeMode = () => store.get("zk_admin_theme") || "light";
function setTheme(mode) {
  store.set("zk_admin_theme", mode);
  applyTheme(mode);
}
$("#theme-toggle").addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$$("[data-theme-set]").forEach((b) => b.addEventListener("click", () => setTheme(b.dataset.themeSet)));
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => themeMode() === "system" && applyTheme("system"));

// ---- Overview ----
const kpi = (label, value, sub = "") => `<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
const shortDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;

function vbars(points, { label, fmt = (n) => n, title }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return `<div class="vbars" role="img" aria-label="${esc(label)}">
    ${points
      .map(
        (p) => `<div class="vbar" title="${esc(p.title)}: ${esc(fmt(p.value))}"><span class="vbar-n">${p.value ? esc(p.short ?? fmt(p.value)) : ""}</span><span class="vbar-fill${p.hot ? " hot" : ""}" style="height:${Math.round((p.value / max) * 100)}%"></span><span class="vbar-day">${esc(p.tick)}</span></div>`,
      )
      .join("")}
  </div>${title ? `<p class="hint">${title}</p>` : ""}`;
}
const compact = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)));

async function loadOverview() {
  $("#overview").innerHTML = `<p class="state">Loading…</p>`;
  loadAiStatus();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const s = await api(`/api/admin/stats?tz=${encodeURIComponent(tz)}`);
  const maxTop = Math.max(1, ...s.top_dishes.map((d) => d.qty));
  const pay = s.top_payment_method;
  const peak = s.busiest_hour;
  const dist = s.chili_distribution || {};
  const distMax = Math.max(1, ...Object.values(dist));
  const sentiment = s.avg_chili == null ? "no reviews yet" : s.avg_chili >= 4 ? "they love it 🔥" : s.avg_chili >= 3 ? "mixed feelings 😐" : "haters assembled 🧊";
  const rated = (list) => list.map((d) => `<li class="row-between"><span dir="auto">${esc(d.name)}</span><span><b>${d.avg}</b> 🌶️ <small>(${d.reviews})</small></span></li>`).join("");

  $("#overview").innerHTML = `
    <div class="kpis">
      ${kpi("📅 Orders today", s.orders_today, egp(s.revenue_today))}
      ${kpi("🗓️ Last 7 days", s.orders_7d, egp(s.revenue_7d))}
      ${kpi("🧾 All orders", s.total_orders, egp(s.revenue))}
      ${kpi("🧮 Avg order", egp(s.avg_order_value))}
      ${kpi("⏰ Busiest hour", peak ? hourLabel(peak.hour) : "–", peak ? `${peak.count} order${peak.count === 1 ? "" : "s"}` : "no orders yet")}
      ${kpi("🌶️ Avg chili", s.avg_chili ?? "–", `${s.reviews_count} reviews · ${sentiment}`)}
      ${kpi("👁 Dishes", `${s.dishes_visible} / ${s.dishes_total}`, `${s.dishes_hidden} hidden`)}
      ${kpi("📸 No photo", s.dishes_without_photo, "dishes")}
    </div>
    <div class="ov-grid">
      <section class="card">
        <h3>💸 Revenue, last 14 days</h3>
        ${vbars(
          s.orders_per_day.map((d) => ({ value: d.revenue || 0, title: shortDay(d.day), tick: d.day.slice(8), short: compact(d.revenue || 0) })),
          { label: "Revenue per day for the last 14 days", fmt: egp, title: `📈 ${s.orders_per_day.reduce((n, d) => n + d.count, 0)} orders in 14 days` },
        )}
      </section>
      <section class="card">
        <h3>⏰ Orders by hour</h3>
        ${vbars(
          (s.orders_per_hour || Array(24).fill(0)).map((n, h) => ({ value: n, title: hourLabel(h), tick: h % 3 === 0 ? String(h) : "", hot: peak && h === peak.hour })),
          { label: "Orders per hour of the day", title: `💳 Most used payment: ${pay ? `<strong>${esc(PAYMENT_LABELS[pay.method] || pay.method)}</strong> (${pay.count}×)` : "–"}` },
        )}
      </section>
      <section class="card">
        <h3>🏆 Top 5 dishes</h3>
        ${
          s.top_dishes.length
            ? `<ol class="hbars">${s.top_dishes
                .map(
                  (d) => `<li><span class="hbar-label" dir="auto">${esc(d.name)}${d.deleted ? " <small>(deleted)</small>" : ""}</span>
                  <span class="hbar"><span style="width:${Math.round((d.qty / maxTop) * 100)}%"></span></span><b>${d.qty}</b></li>`,
                )
                .join("")}</ol>`
            : `<p class="state">No orders yet. Share the menu link and wait for the chaos.</p>`
        }
      </section>
      <section class="card">
        <h3>👑 Top customers</h3>
        ${
          (s.top_customers || []).length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th scope="col">Name</th><th scope="col">Orders</th><th scope="col">Spent</th></tr></thead><tbody>${s.top_customers
                .map((c, i) => `<tr><td dir="auto">${["🥇", "🥈", "🥉"][i] || "🍽️"} ${esc(c.name)}</td><td>${c.orders}</td><td>${egp(c.total)}</td></tr>`)
                .join("")}</tbody></table></div><p class="hint">First names only.</p>`
            : `<p class="state">No customers yet.</p>`
        }
      </section>
      <section class="card">
        <h3>🌶️ Review sentiment</h3>
        ${
          s.reviews_count
            ? `<ol class="hbars chili-bars">${[5, 4, 3, 2, 1]
                .map((c) => `<li><span class="hbar-label">${"🌶️".repeat(c)}</span><span class="hbar"><span style="width:${Math.round(((dist[c] || 0) / distMax) * 100)}%"></span></span><b>${dist[c] || 0}</b></li>`)
                .join("")}</ol>
              <div class="rated">
                <div><small class="kpi-label">🔥 Best rated</small><ul class="mini-list">${rated(s.best_rated || [])}</ul></div>
                <div><small class="kpi-label">🧊 Worst rated</small><ul class="mini-list">${rated(s.worst_rated || [])}</ul></div>
              </div>`
            : `<p class="state">No reviews yet.</p>`
        }
      </section>
      <section class="card">
        <h3>💬 Latest reviews</h3>
        ${
          s.latest_reviews.length
            ? `<ul class="mini-list">${s.latest_reviews
                .map(
                  (r) => `<li><strong dir="auto">${esc(r.author_name)}</strong> on <em dir="auto">${esc(r.dish_name)}</em> · ${"🌶️".repeat(r.chili_rating)}
                  <p dir="auto">${esc(r.body)}</p><small>${esc(when(r.created_at))}</small></li>`,
                )
                .join("")}</ul>`
            : `<p class="state">No reviews yet.</p>`
        }
      </section>
      <section class="card wide">
        <div class="row-between"><h3>⚠️ Needs attention</h3>${s.needs_attention.length ? `<button class="btn small ghost" type="button" data-chef-run="find_issues">👨‍🍳 Ask the chef</button>` : ""}</div>
        ${
          s.needs_attention.length
            ? `<ul class="mini-list">${s.needs_attention
                .map(
                  (d) => `<li class="row-between"><span>${nameHtml(d)}<br>${d.issues.map((i) => `<span class="tag">${ISSUE_LABELS[i] || esc(i)}</span>`).join(" ")}</span>
                  <button class="btn small ghost" data-fix="${esc(d.id)}">Fix</button></li>`,
                )
                .join("")}</ul>`
            : `<p class="state">All dishes have a photo and a description. Chef's kiss 🤌</p>`
        }
      </section>
    </div>`;
}

// ---- 🤖 AI status card ----
const ago2 = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
function renderAiStatus(st, test) {
  aiEnabled = Boolean(st.enabled);
  syncChefStatus();
  const pct = st.usage.pct || 0;
  $("#ai-status").innerHTML = `
    <div class="ai-row">
      ${st.providers.map((p) => `<span class="pill ${p.connected ? "on" : "off"}">${p.connected ? "🟢" : "⚪"} ${esc(p.label)} ${p.connected ? "connected" : "not set"}</span>`).join("")}
      <span class="pill ${st.enabled ? "on" : "off"}">${st.enabled ? "✨ AI on" : "😴 AI off (canned jokes)"}</span>
    </div>
    <div class="meter-row">
      <span>Today: <b>${st.usage.used}</b>${st.usage.cap ? ` / ${st.usage.cap}` : ""} AI calls</span>
      <span class="meter" role="meter" aria-label="AI calls used today" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%" class="${pct >= 90 ? "hot" : ""}"></span></span>
      <small>resets at ${esc(st.usage.resets || "midnight UTC")}</small>
    </div>
    ${test ? `<p class="ai-test ${test.ok ? "ok" : "bad"}" role="status">${test.ok ? "✅" : "❌"} ${esc(test.message)}${test.ok ? ` · “${esc(test.text)}” · ${test.ms} ms` : ""}</p>` : ""}
    ${
      st.errors.length
        ? `<details class="ai-errors"><summary>⚠️ Last problems (${st.errors.length})</summary><ul class="mini-list">${st.errors
            .map((e) => `<li><p>${esc(e.text)}</p><small title="${esc(e.raw)}">${esc(ago2(e.at))}</small></li>`)
            .join("")}</ul></details>`
        : `<p class="hint">No AI errors since the last deploy. 🧘</p>`
    }`;
}
async function loadAiStatus() {
  try {
    renderAiStatus(await api("/api/admin/ai/status"));
  } catch (err) {
    if (err.status === 401) return showLogin();
    $("#ai-status").innerHTML = `<p class="hint">Couldn't read the AI status: ${esc(err.message)}</p>`;
  }
}
$("#ai-test").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "⏳ Testing…";
  try {
    const r = await api("/api/admin/ai/test", { method: "POST", body: "{}" });
    renderAiStatus(r.status, r);
  } catch (err) {
    fail(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Test AI";
  }
});
$("#refresh-overview").addEventListener("click", () => loadOverview().catch(fail));
$("#overview").addEventListener("click", async (e) => {
  const id = e.target.closest("[data-fix]")?.dataset.fix;
  if (!id) return;
  dishes = await api("/api/admin/dishes").catch((err) => (fail(err), dishes));
  const dish = dishes.find((d) => d.id === id);
  if (dish) openDish(dish);
});

// ---- Dishes ----
const dishFilters = () => ({ q: $("#dish-search").value.trim().toLowerCase(), cat: $("#dish-cat").value, vis: $("#dish-vis").value, sort: $("#dish-sort").value });
const isFiltering = () => {
  const f = dishFilters();
  return Boolean(f.q || f.cat || f.vis || f.sort !== "menu");
};
// Badges worth one click from the list; the rest live in the editor
const QUICK_BADGES = ["sold_out", "popular", "new", "spicy", "chefs_pick"];
const DISH_SORTS = {
  name: (a, b) => dishName(a).localeCompare(dishName(b)),
  price_asc: (a, b) => a.price - b.price,
  price_desc: (a, b) => b.price - a.price,
  most_ordered: (a, b) => b.order_qty - a.order_qty,
  least_ordered: (a, b) => a.order_qty - b.order_qty,
  reviews: (a, b) => b.review_count - a.review_count,
  newest: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
};
const siteLink = (d) => `/?dish=${encodeURIComponent(d.id)}`;

async function loadDishes() {
  if (!dishes.length) loading("#dish-list");
  dishes = await api("/api/admin/dishes");
  const ids = new Set(dishes.map((d) => d.id));
  [...selectedDishes].forEach((id) => ids.has(id) || selectedDishes.delete(id));
  renderDishes();
}

function visibleDishRows() {
  const { q, cat, vis, sort } = dishFilters();
  const rows = dishes.filter(
    (d) =>
      (!cat || d.category === cat) &&
      (!vis || (vis === "visible") === Boolean(d.is_visible)) &&
      (!q || [d.name_ar, d.name_en, d.job_title, d.catchphrase].some((x) => String(x || "").toLowerCase().includes(q))),
  );
  return DISH_SORTS[sort] ? rows.sort(DISH_SORTS[sort]) : rows;
}

function renderDishes() {
  const cats = Object.fromEntries(config.categories.map((c) => [c.slug, `${c.emoji} ${c.en}`]));
  const rows = visibleDishRows();
  const filtering = isFiltering();
  $("#dish-hint").textContent = filtering
    ? `Showing ${rows.length} of ${dishes.length}. Clear filters and pick “Menu order” to drag-reorder.`
    : "Drag rows to reorder. Drop a photo on a dish's picture to replace it. Prices save on Enter.";
  $("#dish-list").innerHTML =
    rows
      .map(
        (d) => `
      <li draggable="${!filtering}" data-id="${esc(d.id)}" class="${d.is_visible ? "" : "hidden-dish"}">
        <input type="checkbox" class="pick" data-pick="${esc(d.id)}" ${selectedDishes.has(d.id) ? "checked" : ""} aria-label="Select ${esc(dishName(d))}">
        ${filtering ? "" : `<span class="handle" aria-hidden="true">⠿</span>`}
        <label class="photo-drop" data-drop="${esc(d.id)}" title="Drop or pick a photo to replace it">
          ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : `<span class="noimg">🍽️</span>`}
          <input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp,image/gif" data-photo="${esc(d.id)}" aria-label="Replace photo of ${esc(dishName(d))}">
        </label>
        <div class="grow">
          ${nameHtml(d)}
          <small>${esc(cats[d.category] || d.category)}${d.job_title ? ` · 💼 <span dir="auto">${esc(d.job_title)}</span>` : ""}</small>
          <small>💬 ${d.review_count} reviews · 🧾 ${d.order_qty} ordered</small>
          <span class="meta">${(d.badges || []).filter((b) => !QUICK_BADGES.includes(b)).map((b) => `<span class="tag">${esc(config.badges[b] || b)}</span>`).join("")}</span>
          <span class="badge-toggles" role="group" aria-label="Quick badges">${QUICK_BADGES.map((b) => {
            const on = (d.badges || []).includes(b);
            return `<button type="button" class="chip${on ? " on" : ""}" data-badge="${esc(b)}" data-badge-dish="${esc(d.id)}" aria-pressed="${on}">${esc(config.badges[b] || b)}</button>`;
          }).join("")}</span>
        </div>
        <div class="row-actions">
          <label class="price-edit" title="Price (half size). Enter saves">💸 <input type="number" min="0" max="999999" step="0.01" value="${esc(d.price)}" data-price="${esc(d.id)}" aria-label="Price of ${esc(dishName(d))}"> <span>EGP</span></label>
          <label class="switch" title="Visible on menu"><input type="checkbox" data-visible="${esc(d.id)}" ${d.is_visible ? "checked" : ""}> 👁</label>
          <a class="btn small ghost" href="${esc(siteLink(d))}" target="_blank" rel="noopener" title="View on site">↗ Site</a>
          <button class="btn small ghost" data-dup="${esc(d.id)}">Duplicate</button>
          <button class="btn small" data-edit="${esc(d.id)}">Edit</button>
          <button class="btn small danger" data-delete="${esc(d.id)}">Delete</button>
        </div>
      </li>`,
      )
      .join("") ||
    (dishes.length
      ? `<li class="state">No dishes match these filters. <button class="btn small ghost" id="clear-dish-filters">Clear filters</button></li>`
      : `<li class="state">No dishes yet. Press <b>+ New dish</b> to hire your first coworker.</li>`);
  syncDishBulk(rows);
  syncDraftChip();
}

function syncDishBulk(rows = visibleDishRows()) {
  const n = selectedDishes.size;
  $("#dish-count").textContent = `${n} selected`;
  $$("[data-bulk-dish]").forEach((b) => (b.disabled = n === 0));
  $("#bulk-cat").disabled = $("#bulk-badge").disabled = n === 0;
  const all = $("#dish-all");
  all.checked = rows.length > 0 && rows.every((d) => selectedDishes.has(d.id));
  all.indeterminate = !all.checked && rows.some((d) => selectedDishes.has(d.id));
}

["#dish-search", "#dish-cat", "#dish-vis", "#dish-sort"].forEach((sel) => $(sel).addEventListener("input", renderDishes));
$("#dish-all").addEventListener("change", (e) => {
  visibleDishRows().forEach((d) => (e.target.checked ? selectedDishes.add(d.id) : selectedDishes.delete(d.id)));
  renderDishes();
});

async function setVisible(ids, visible) {
  await Promise.all(ids.map((id) => api(`/api/admin/dishes/${id}`, { method: "PUT", body: JSON.stringify({ is_visible: visible }) })));
}

async function savePrice(input) {
  const id = input.dataset.price;
  const d = dishes.find((x) => x.id === id);
  const price = Number(input.value);
  if (!d || input.value === "" || price === Number(d.price)) return;
  if (!Number.isFinite(price) || price < 0) {
    input.value = d.price;
    return toast("Price must be 0 or more", { type: "error" });
  }
  const old = d.price;
  input.disabled = true;
  try {
    await api(`/api/admin/dishes/${id}`, { method: "PUT", body: JSON.stringify({ price }) });
    d.price = Math.round(price * 100) / 100;
    input.classList.add("saved");
    setTimeout(() => input.classList.remove("saved"), 900);
    toast(`${dishName(d)}: ${egp(old)} → ${egp(d.price)}`, {
      undo: async () => {
        await api(`/api/admin/dishes/${id}`, { method: "PUT", body: JSON.stringify({ price: old }) });
        await loadDishes();
      },
    });
  } catch (err) {
    input.value = old;
    fail(err);
  } finally {
    input.disabled = false;
  }
}

async function replacePhoto(id, file) {
  const d = dishes.find((x) => x.id === id);
  if (!d || !file) return;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return toast("That's not a JPG, PNG, WebP or GIF 🙃", { type: "error" });
  const row = $(`#dish-list li[data-id="${CSS.escape(id)}"]`);
  row?.classList.add("uploading");
  try {
    const fd = new FormData();
    fd.append("photo", await shrink(file), "photo.jpg");
    const { photo_url } = await api(`/api/admin/dishes/${id}/photo`, { method: "POST", body: fd });
    d.photo_url = photo_url;
    renderDishes();
    toast(`📸 New photo for ${dishName(d)}`);
  } catch (err) {
    fail(err);
  } finally {
    row?.classList.remove("uploading");
  }
}

$("#dish-list").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset.price) {
    e.preventDefault();
    savePrice(e.target);
  }
});

$("#dish-list").addEventListener("change", async (e) => {
  if (e.target.dataset.price) return savePrice(e.target);
  if (e.target.dataset.photo) return replacePhoto(e.target.dataset.photo, e.target.files[0]);
  const pick = e.target.dataset.pick;
  if (pick) {
    e.target.checked ? selectedDishes.add(pick) : selectedDishes.delete(pick);
    return syncDishBulk();
  }
  const id = e.target.dataset.visible;
  if (!id) return;
  const visible = e.target.checked;
  const d = dishes.find((x) => x.id === id);
  try {
    await setVisible([id], visible);
    d.is_visible = visible;
    renderDishes();
    toast(`${dishName(d)} is now ${visible ? "visible 👁" : "hidden 🙈"}`, {
      undo: async () => {
        await setVisible([id], !visible);
        await loadDishes();
      },
    });
  } catch (err) {
    e.target.checked = !visible;
    fail(err);
  }
});

$("#dish-list").addEventListener("click", async (e) => {
  if (e.target.id === "clear-dish-filters") {
    $("#dish-search").value = $("#dish-cat").value = $("#dish-vis").value = "";
    return renderDishes();
  }
  const chip = e.target.closest("[data-badge-dish]");
  if (chip) return toggleBadge(chip);
  const { edit: editId, delete: deleteId, dup: dupId } = e.target.dataset;
  if (editId) openDish(dishes.find((d) => d.id === editId));
  try {
    if (dupId) {
      e.target.disabled = true;
      const copy = await api(`/api/admin/dishes/${dupId}/duplicate`, { method: "POST" });
      await loadDishes();
      toast(`Created "${dishName(copy)}" (hidden, no photo)`);
    }
    if (deleteId) {
      const d = dishes.find((x) => x.id === deleteId);
      if (!confirm(`Delete "${dishName(d)}" and all its ${d.review_count} reviews? This can't be undone.`)) return;
      await api(`/api/admin/dishes/${deleteId}`, { method: "DELETE" });
      selectedDishes.delete(deleteId);
      await loadDishes();
      toast(`Deleted "${dishName(d)}"`);
    }
  } catch (err) {
    fail(err);
    if (dupId) e.target.disabled = false;
  }
});

async function toggleBadge(chip) {
  const d = dishes.find((x) => x.id === chip.dataset.badgeDish);
  if (!d) return;
  const badge = chip.dataset.badge;
  const before = [...(d.badges || [])];
  const next = before.includes(badge) ? before.filter((b) => b !== badge) : [...before, badge];
  chip.disabled = true;
  try {
    await api(`/api/admin/dishes/${d.id}`, { method: "PUT", body: JSON.stringify({ badges: next }) });
    d.badges = next;
    renderDishes();
    toast(`${dishName(d)} ${next.includes(badge) ? "got" : "lost"} ${config.badges[badge] || badge}`, {
      undo: async () => {
        await api(`/api/admin/dishes/${d.id}`, { method: "PUT", body: JSON.stringify({ badges: before }) });
        await loadDishes();
      },
    });
  } catch (err) {
    chip.disabled = false;
    fail(err);
  }
}

// Drag a photo file onto a dish's picture to replace it
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
$("#dish-list").addEventListener("dragover", (e) => {
  const zone = e.target.closest?.("[data-drop]");
  if (!zone || dragged || !hasFiles(e)) return;
  e.preventDefault();
  zone.classList.add("over");
});
$("#dish-list").addEventListener("dragleave", (e) => e.target.closest?.("[data-drop]")?.classList.remove("over"));
$("#dish-list").addEventListener("drop", (e) => {
  const zone = e.target.closest?.("[data-drop]");
  if (!zone || dragged || !hasFiles(e)) return;
  e.preventDefault();
  zone.classList.remove("over");
  replacePhoto(zone.dataset.drop, e.dataTransfer.files[0]);
});

$$("[data-bulk-dish]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const ids = [...selectedDishes];
    const action = btn.dataset.bulkDish;
    if (!ids.length) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} dish${ids.length > 1 ? "es" : ""} and all their reviews? This can't be undone.`)) return;
    const cat = $("#bulk-cat").value;
    const badge = $("#bulk-badge").value;
    if (action === "category" && !cat) return toast("Pick a category first", { type: "error" });
    if (action.startsWith("badge") && !badge) return toast("Pick a badge first", { type: "error" });
    btn.disabled = true;
    try {
      if (action === "category" || action.startsWith("badge")) {
        const before = ids.map((id) => dishes.find((d) => d.id === id)).filter(Boolean).map((d) => ({ id: d.id, category: d.category, badges: [...(d.badges || [])] }));
        const body = action === "category" ? { ids, fields: { category: cat } } : { ids, [action === "badge-add" ? "add_badges" : "remove_badges"]: [badge] };
        const r = await api("/api/admin/dishes/bulk", { method: "POST", body: JSON.stringify(body) });
        const what = action === "category" ? `moved to ${config.categories.find((c) => c.slug === cat)?.en || cat}` : `${action === "badge-add" ? "+" : "−"} ${config.badges[badge] || badge}`;
        toast(`${r.updated} dish${r.updated === 1 ? "" : "es"} ${what}`, {
          undo: async () => {
            await Promise.all(before.map((b) => api(`/api/admin/dishes/${b.id}`, { method: "PUT", body: JSON.stringify(action === "category" ? { category: b.category } : { badges: b.badges }) })));
            await loadDishes();
          },
        });
      } else if (action === "delete") {
        await Promise.all(ids.map((id) => api(`/api/admin/dishes/${id}`, { method: "DELETE" })));
        selectedDishes.clear();
        toast(`Deleted ${ids.length} dish${ids.length > 1 ? "es" : ""}`);
      } else {
        const visible = action === "show";
        const changed = ids.filter((id) => dishes.find((d) => d.id === id)?.is_visible !== visible);
        await setVisible(changed, visible);
        toast(`${changed.length} dish${changed.length === 1 ? "" : "es"} ${visible ? "shown 👁" : "hidden 🙈"}`, {
          undo: changed.length
            ? async () => {
                await setVisible(changed, !visible);
                await loadDishes();
              }
            : undefined,
        });
      }
    } catch (err) {
      fail(err);
    }
    await loadDishes().catch(fail);
  }),
);

// Drag to reorder (only when the full list is shown, otherwise sort_order would be rewritten for a subset)
let dragged = null;
$("#dish-list").addEventListener("dragstart", (e) => {
  if (isFiltering()) return e.preventDefault();
  dragged = e.target.closest("li");
  dragged?.classList.add("dragging");
});
$("#dish-list").addEventListener("dragover", (e) => {
  if (!dragged) return;
  e.preventDefault();
  const over = e.target.closest("li");
  if (!over || over === dragged) return;
  const rect = over.getBoundingClientRect();
  over.parentNode.insertBefore(dragged, e.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
});
$("#dish-list").addEventListener("dragend", async () => {
  if (!dragged) return;
  dragged.classList.remove("dragging");
  dragged = null;
  const ids = $$("#dish-list li[data-id]").map((li) => li.dataset.id);
  try {
    await api("/api/admin/dishes/order", { method: "PUT", body: JSON.stringify({ ids }) });
    const pos = new Map(ids.map((id, i) => [id, i]));
    dishes.sort((a, b) => pos.get(a.id) - pos.get(b.id));
    toast("Order saved");
  } catch (err) {
    fail(err);
    loadDishes().catch(fail);
  }
});

// ---- Dish editor: form state, drafts, fills ----
const TEXT_FIELDS = ["name_ar", "name_en", "job_title", "category", "description", "catchphrase", "warnings", "price", "spice_level", "calories"];
const FILL_FIELDS = ["name_en", "job_title", "description", "catchphrase", "warnings", "spice_level", "category", "calories", "badges"];
const DRAFT_PREFIX = "zk_admin_draft_";
const DRAFT_PHOTO_MAX = 1.5 * 1024 * 1024; // data URL chars
const AI_PHOTO_MAX = 350 * 1024; // base64 chars

let baseline = ""; // form state when the dialog opened (to detect unsaved changes)
let photo = null; // { upload: Blob|File, small: Blob, dataUrl: string|null } for a newly picked or restored photo
let lastFill = null; // { prev: formState, keys: [] } for "Undo fill"
let saveTimer = null;
let photoJob = Promise.resolve();

const store = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked: nothing to remove */
    }
  },
};
const draftKey = () => `${DRAFT_PREFIX}${editing ? editing.id : "new"}`;

function readForm() {
  const f = $("#dish-form");
  const state = Object.fromEntries(TEXT_FIELDS.map((k) => [k, f[k].value]));
  state.badges = [...f.querySelectorAll("[name=badges]:checked")].map((cb) => cb.value);
  state.is_visible = f.is_visible.checked;
  return state;
}

function writeForm(state) {
  const f = $("#dish-form");
  for (const k of TEXT_FIELDS) if (k in state && f[k]) f[k].value = state[k] ?? "";
  if (Array.isArray(state.badges)) f.querySelectorAll("[name=badges]").forEach((cb) => (cb.checked = state.badges.includes(cb.value)));
  if ("is_visible" in state) f.is_visible.checked = Boolean(state.is_visible);
  updateCounters();
}

const isDirty = () => Boolean(photo) || JSON.stringify(readForm()) !== baseline;

function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function saveDraftNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!$("#dish-dialog").open) return;
  if (!isDirty()) return store.remove(draftKey());
  const draft = { v: 1, saved_at: Date.now(), dish_id: editing?.id || null, form: readForm(), photo: photo?.dataUrl || null };
  if (!store.set(draftKey(), draft) && draft.photo) store.set(draftKey(), { ...draft, photo: null }); // quota: keep the text at least
}
const scheduleDraft = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftNow, 400);
};
const clearDraft = () => {
  clearTimeout(saveTimer);
  saveTimer = null;
  store.remove(draftKey());
};

function dataUrlToBlob(url) {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

function openDish(dish, { skipDraft = false } = {}) {
  editing = dish || null;
  const f = $("#dish-form");
  f.reset();
  photo = null;
  lastFill = null;
  clearTimeout(saveTimer);
  saveTimer = null;
  markFilled([]);
  $("#dish-undo-fill").hidden = true;
  $("#dish-error").textContent = "";
  $("#draft-banner").hidden = true;
  $("#dish-dialog-title").textContent = dish ? `Edit ${dishName(dish)}` : "New dish";
  if (dish) {
    writeForm({
      name_ar: dish.name_ar,
      name_en: dish.name_en || "",
      description: dish.description || "",
      price: dish.price,
      job_title: dish.job_title || "",
      catchphrase: dish.catchphrase || "",
      warnings: dish.warnings || "",
      spice_level: dish.spice_level ?? 3,
      calories: dish.calories || "",
      category: dish.category,
      is_visible: dish.is_visible,
    });
  }
  f.querySelectorAll("[name=badges]").forEach((cb) => (cb.checked = dish ? (dish.badges || []).includes(cb.value) : false));
  updateCounters();
  baseline = JSON.stringify(readForm());
  setPreview(dish?.photo_url || null);

  const draft = skipDraft ? null : store.get(draftKey());
  if (draft?.form) {
    writeForm(draft.form);
    if (draft.photo) {
      try {
        const blob = dataUrlToBlob(draft.photo);
        photo = { upload: blob, small: blob, dataUrl: draft.photo };
        setPreview(draft.photo);
      } catch {
        photo = null;
      }
    }
    $("#draft-banner-text").textContent = `📝 Restored your unsaved draft (saved ${ago(draft.saved_at || Date.now())})`;
    $("#draft-banner").hidden = false;
  }
  if (!$("#dish-dialog").open) $("#dish-dialog").showModal();
}

$("#new-dish").addEventListener("click", () => openDish(null));

function setPreview(url) {
  $("#photo-preview").innerHTML = url ? `<img src="${esc(url)}" alt="">` : "🍽️";
}
$("#dish-form").photo.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setPreview(URL.createObjectURL(file));
  // Small copy for the draft and the AI; the full file is still what gets uploaded
  photoJob = (async () => {
    const small = await shrink(file, 768, 0.82);
    let dataUrl = null;
    try {
      dataUrl = await blobToDataUrl(small);
      if (dataUrl.length > DRAFT_PHOTO_MAX) dataUrl = null;
    } catch {
      dataUrl = null;
    }
    photo = { upload: file, small, dataUrl };
    scheduleDraft();
  })();
});

$("#dish-form").addEventListener("input", (e) => {
  if (e.target.name && e.target.name !== "photo") e.target.closest(".filled")?.classList.remove("filled");
  updateCounters();
  scheduleDraft();
});
$("#dish-form").addEventListener("change", scheduleDraft);

$("#draft-discard").addEventListener("click", () => {
  clearDraft();
  openDish(editing, { skipDraft: true });
  toast("Draft thrown away 🗑️");
});

// ---- Closing with unsaved changes ----
function closeDish() {
  $("#dish-dialog").close();
  syncDraftChip();
}
function requestClose() {
  if ($("#close-dialog").open) return;
  if (!isDirty()) {
    clearDraft();
    return closeDish();
  }
  $("#close-dialog").showModal();
}
$("#dish-cancel").addEventListener("click", requestClose);
$("#dish-dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  requestClose();
});
$("#close-keep").addEventListener("click", () => {
  saveDraftNow();
  $("#close-dialog").close();
  closeDish();
  toast("Draft kept 📝 it'll be here when you come back");
});
$("#close-discard").addEventListener("click", () => {
  clearDraft();
  $("#close-dialog").close();
  closeDish();
});
$("#close-back").addEventListener("click", () => $("#close-dialog").close());
window.addEventListener("pagehide", () => saveTimer && saveDraftNow());

// "You have an unfinished dish" chip on the Dishes tab
function syncDraftChip() {
  const draft = store.get(`${DRAFT_PREFIX}new`);
  const show = Boolean(draft?.form) && !($("#dish-dialog").open && !editing);
  $("#draft-chip").hidden = !show;
  if (show) {
    const name = draft.form.name_ar || draft.form.name_en;
    $("#draft-chip-name").textContent = `${name ? `: "${name}"` : ""} (saved ${ago(draft.saved_at || Date.now())})`;
  }
}
$("#draft-continue").addEventListener("click", () => openDish(null));
$("#draft-chip-discard").addEventListener("click", () => {
  store.remove(`${DRAFT_PREFIX}new`);
  syncDraftChip();
  toast("Draft thrown away 🗑️");
});

// ---- Character counters ----
function updateCounters() {
  $$("#dish-form [data-counter]").forEach((el) => {
    const input = $(`#dish-form [name=${el.dataset.counter}]`);
    const n = input.value.length;
    const max = Number(input.maxLength);
    el.textContent = `${n}/${max}`;
    el.classList.toggle("near", n >= max * 0.9);
  });
}
$$("#dish-form input[maxlength], #dish-form textarea[maxlength]").forEach((input) => {
  const counter = document.createElement("small");
  counter.className = "counter";
  counter.dataset.counter = input.name;
  input.after(counter);
});

// ---- Fills (predefined + AI) ----
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// lang: ar = Egyptian Arabic, en = English, mix = Gen-Z code-switching
const EXAMPLES = [
  { lang: "mix", job_title: "Senior Excel Abuser", catchphrase: "خليها بعد الاجتماع", warnings: "passive aggression, 3 coffees, unread emails", description: "Slow-cooked since the 9am standup. يسطا ده aura +1000.", spice_level: 4, category: "mandi", badges: ["overworked"] },
  { lang: "en", job_title: "Chief Meeting Officer", catchphrase: "let's take this offline", warnings: "calendar invites, no agenda", description: "Could've been an email. Comes with extra slides and zero decisions.", spice_level: 2, category: "koshary", badges: ["main_character"] },
  { lang: "mix", job_title: "Intern (unpaid, vibes only)", catchphrase: "أنا مش فاهم حاجة", warnings: "anxiety, energy drinks", description: "Fresh, eager, slightly undercooked. Will make you coffee بس مش هيعرف يعمله.", spice_level: 1, category: "appetizers", badges: ["new"] },
  { lang: "mix", job_title: "Head of Gossip ☕", catchphrase: "بيقولك…", warnings: "tea, more tea, screenshots", description: "Soaked in gossip. Knows everyone's salary والمرتب بتاعك كمان.", spice_level: 5, category: "fatta", badges: ["toxic", "popular"] },
  { lang: "en", job_title: "IT guy who never answers", catchphrase: "did you try restarting it?", warnings: "cables, silence, one ticket from 2019", description: "Grilled on low heat. Replies in 3–5 business days.", spice_level: 3, category: "grills", badges: ["on_vacation"] },
  { lang: "ar", job_title: "مدير الإيميلات الطويلة", catchphrase: "زي ما اتفقنا في الإيميل اللي فات", warnings: "CC للمدير، ريبلاي أول", description: "محشي بـ ١٤ فقرة وجملة واحدة مفيدة في الآخر. كُل على مهلك.", spice_level: 3, category: "mahshi", badges: ["red_flag"] },
  { lang: "ar", job_title: "أخصائي البريك الطويل", catchphrase: "نازل أجيب شاي وراجع", warnings: "شاي بالنعناع، غياب، أعذار", description: "رايق جدًا. بيتعمل على نار هادية من الصبح ومبيخلصش.", spice_level: 1, category: "asab", badges: ["on_vacation"] },
  { lang: "mix", job_title: "Deadline Survivor", catchphrase: "هخلصها النهارده بالليل والله", warnings: "all-nighters, Red Bull, panic", description: "Slimy under pressure بس بيسلّم في آخر ثانية. Molokhia energy.", spice_level: 4, category: "molokhia", badges: ["overworked", "chefs_pick"] },
  { lang: "en", job_title: "LinkedIn Thought Leader", catchphrase: "Agree? 👇", warnings: "humblebrag, hustle culture, carousel posts", description: "Marinated in motivational quotes. Shares a lesson from every coffee.", spice_level: 2, category: "picks", badges: ["main_character"] },
  { lang: "mix", job_title: "Professional Mute Button", catchphrase: "you're on mute يا باشا", warnings: "lag, frozen camera, 'can you hear me'", description: "Joins every call 7 minutes late. Audio sold separately.", spice_level: 2, category: "soups", badges: ["sold_out"] },
  { lang: "ar", job_title: "مسؤول الهبد الرسمي", catchphrase: "أنا قلتلكم من الأول", warnings: "ثقة زيادة، معلومات غلط", description: "طعمية سخنة من الفريزر. رأي في كل حاجة ومعلومة في ولا حاجة.", spice_level: 4, category: "taameya", badges: ["red_flag", "popular"] },
  { lang: "en", job_title: "Budget Gatekeeper", catchphrase: "we don't have budget for that", warnings: "spreadsheets, denial, invoice anxiety", description: "Cheap, essential and somehow always in the queue at finance.", spice_level: 3, category: "bread", badges: ["hr_approved"] },
  { lang: "mix", job_title: "Glazing Specialist 🍯", catchphrase: "حضرتك عندك حق طبعًا", warnings: "extra sugar, nodding, 'great point'", description: "Overly sweet في الاجتماعات. Glazing the boss since onboarding.", spice_level: 1, category: "basbousa", badges: ["chefs_pick"] },
  { lang: "ar", job_title: "صاحب العزومة اللي محدش طلبها", catchphrase: "يلا كلنا على حسابي… الشهر الجاي", warnings: "وعود، فواتير، كرم مزيف", description: "صينية كبيرة للتيم كله بس الحساب مفتوح من ٢٠٢٢.", spice_level: 2, category: "trays", badges: ["popular"] },
  { lang: "en", job_title: "Reply-All Enthusiast", catchphrase: "Adding the whole company for visibility", warnings: "inbox flood, 400 recipients, 'thanks!'", description: "Served by the kilo. Every message comes with 399 side dishes.", spice_level: 5, category: "seafood", badges: ["toxic"] },
  { lang: "mix", job_title: "Morning Person (fake)", catchphrase: "متكلمنيش قبل القهوة التالتة", warnings: "beans, silence, death stare", description: "Useless before 10am. بعد كده? still useless بس بيضحك.", spice_level: 3, category: "ful", badges: ["overworked"] },
  { lang: "ar", job_title: "خبير الشاورما التنظيمية", catchphrase: "الموضوع ده محتاج اجتماع", warnings: "دراما ملفوفة، تومية زيادة", description: "ملفوف في الدراما ومتشوي على السيخ في كل ون تو ون.", spice_level: 4, category: "shawarma", badges: ["toxic", "main_character"] },
  { lang: "en", job_title: "Professional Overthinker", catchphrase: "quick question (it's not quick)", warnings: "17 follow-ups, 'just checking'", description: "Squished between two meetings and still asking for a third.", spice_level: 2, category: "sandwiches", badges: ["new"] },
  { lang: "mix", job_title: "Ex-Employee, still in the group chat", catchphrase: "أنا مشيت بس لسه بتابع 👀", warnings: "nostalgia, expired badge, unsolicited advice", description: "Left the company. Still reacts to every message. Past the sell-by date.", spice_level: 3, category: "expired", badges: ["red_flag"] },
  { lang: "ar", job_title: "ملك الأعذار", catchphrase: "النت فصل عندي فجأة", warnings: "زحمة، كهربا، نت ضعيف", description: "شوربة خفيفة، مية أكتر من الخضار. بيظهر وقت المرتب بس.", spice_level: 1, category: "soups", badges: ["on_vacation", "sold_out"] },
  { lang: "mix", job_title: "Spicy Feedback Dealer", catchphrase: "with all due respect… لا", warnings: "honesty, side-eye, HR tickets", description: "Small dose only. Heavy dose = إنذار كتابي. Torshi with a performance review.", spice_level: 5, category: "torshi", badges: ["spicy", "toxic"] },
  { lang: "en", job_title: "Vibe Coder (prod is down)", catchphrase: "works on my machine", warnings: "untested code, 3am deploys, AI copium", description: "Hot takes fried daily. Ships fast, breaks faster, blames the cache.", spice_level: 4, category: "taameya", badges: ["spicy", "main_character"] },
  { lang: "mix", job_title: "Team Mom 🫶", catchphrase: "كلتوا ولا لسه؟", warnings: "snacks, birthday cards, guilt trips", description: "The sweet one (rare). Brings cake و بتعرف أعياد ميلاد الكل.", spice_level: 1, category: "desserts", badges: ["hr_approved", "chefs_pick"] },
  { lang: "ar", job_title: "رئيس قسم الكوبيات", catchphrase: "مين أخد المج بتاعي؟", warnings: "كوبيات مش مغسولة، تحقيقات", description: "كشري الاجتماعات: شوية من كله ومفيش نقطة واضحة وساعتين.", spice_level: 3, category: "koshary", badges: ["popular"] },
  { lang: "mix", job_title: "Aura Farmer", catchphrase: "it's giving promotion يا جدعان", warnings: "rizz, CV updates, mirror selfies at the office", description: "Main character energy, NPC output. Grilled to a confident medium-rare.", spice_level: 4, category: "grills", badges: ["main_character", "popular"] },
];
let recentExamples = [];

// Random language style (some Arabic, some English, mostly mixed), a base example and a few swapped lines
function randomExample() {
  const lang = pick(["ar", "en", "mix", "mix"]);
  const pool = EXAMPLES.map((ex, i) => ({ ex, i })).filter(({ ex, i }) => ex.lang === lang && !recentExamples.includes(i));
  const { ex: base, i } = pick(pool.length ? pool : EXAMPLES.map((ex, i) => ({ ex, i })));
  recentExamples = [i, ...recentExamples].slice(0, 8);
  const out = { ...base, badges: [...base.badges] };
  const others = EXAMPLES.filter((e) => e !== base && (Math.random() < 0.5 || e.lang === base.lang));
  if (Math.random() < 0.4) out.catchphrase = pick(others).catchphrase;
  if (Math.random() < 0.4) out.warnings = pick(others).warnings;
  if (Math.random() < 0.3) out.spice_level = Math.min(5, Math.max(1, out.spice_level + pick([-1, 1])));
  out.calories = pick([67, 420, 999, 1337, 2026, 6767, 404, 9000, 0]) || Math.floor(Math.random() * 5000) + 1;
  delete out.lang;
  return out;
}

const overwriteAll = () => $("#fill-overwrite").checked;

// "Empty" = nothing typed (spice/category count as empty while still at the value the dialog opened with)
function isEmptyField(key, state) {
  const start = JSON.parse(baseline || "{}");
  if (key === "badges") return !state.badges.length;
  if (key === "calories") return !state.calories || Number(state.calories) === 0;
  if (key === "spice_level" || key === "category") return !state[key] || (!editing && state[key] === start[key]);
  return !String(state[key] ?? "").trim();
}

function markFilled(keys, prev = {}) {
  const f = $("#dish-form");
  $$("#dish-form .filled").forEach((el) => {
    el.classList.remove("filled");
    el.removeAttribute("title");
  });
  for (const k of keys) {
    const el = k === "badges" ? $("#badge-boxes").closest("fieldset") : f[k]?.closest("label");
    if (!el) continue;
    el.classList.add("filled");
    const was = k === "badges" ? (prev.badges || []).join(", ") : prev[k];
    el.title = `Filled. Was: ${String(was ?? "").trim() || "(empty)"}`;
  }
}

function applyFill(data, source) {
  const prev = readForm();
  const next = {};
  const keys = [];
  for (const k of FILL_FIELDS) {
    const val = data[k];
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && !val.length)) continue;
    if (k === "category" && !config.categories.some((c) => c.slug === val)) continue;
    if (!overwriteAll() && !isEmptyField(k, prev)) continue;
    const same = k === "badges" ? JSON.stringify([...val].sort()) === JSON.stringify([...prev.badges].sort()) : String(prev[k]) === String(val);
    if (same) continue;
    next[k] = k === "badges" ? val.filter((b) => b in config.badges).slice(0, 2) : String(val);
    keys.push(k);
  }
  if (!keys.length) {
    toast(overwriteAll() ? "Nothing new to fill 🤷" : `All fields already have something. Tick "Overwrite everything" to replace them.`);
    return;
  }
  writeForm(next);
  lastFill = { prev, keys };
  markFilled(keys, prev);
  $("#dish-undo-fill").hidden = false;
  scheduleDraft();
  toast(`${source} filled ${keys.length} field${keys.length > 1 ? "s" : ""} (highlighted). Check and Save 🫡`);
}

$("#dish-undo-fill").addEventListener("click", () => {
  if (!lastFill) return;
  writeForm(lastFill.prev);
  markFilled([]);
  lastFill = null;
  $("#dish-undo-fill").hidden = true;
  scheduleDraft();
  toast("Fill undone ↩️");
});

$("#fill-overwrite").addEventListener("change", (e) => {
  $("#fill-hint").textContent = e.target.checked ? "Replaces every field it can, even what you typed. Undo is there if you regret it." : `Fills only empty fields. Tick "Overwrite everything" to replace what you typed.`;
});

$("#dish-example").addEventListener("click", () => applyFill(randomExample(), "🎲 Predefined"));

// The photo the AI should look at: the newly picked one, or the dish's current photo
async function photoForAi() {
  await photoJob;
  let blob = photo?.small || null;
  if (!blob && editing?.photo_url) {
    try {
      const res = await fetch(editing.photo_url, { credentials: "same-origin" });
      if (res.ok) blob = await res.blob();
    } catch {
      blob = null; // other origin (blocked by CSP/CORS): go without the photo
    }
  }
  if (!blob) return null;
  for (const [max, q] of [[768, 0.8], [640, 0.7], [512, 0.6], [384, 0.5]]) {
    const small = await shrink(blob, max, q);
    if (!/^image\/(jpeg|png|webp)$/.test(small.type)) return null;
    const url = await blobToDataUrl(small);
    const data = url.slice(url.indexOf(",") + 1);
    if (data.length <= AI_PHOTO_MAX) return { mime: small.type, data };
  }
  return null;
}

$("#dish-ai").addEventListener("click", async (e) => {
  const f = $("#dish-form");
  const btn = e.currentTarget;
  if (!f.name_ar.value.trim() && !f.name_en.value.trim()) {
    f.name_ar.focus();
    return toast("Type a name first (Arabic or English)", { type: "error" });
  }
  btn.disabled = true;
  btn.textContent = "✨ Cooking…";
  try {
    const image = await photoForAi();
    const notes = [
      f.job_title.value.trim() && `Job: ${f.job_title.value.trim()}`,
      f.description.value.trim() && `About: ${f.description.value.trim()}`,
      f.catchphrase.value.trim() && `Catchphrase: ${f.catchphrase.value.trim()}`,
      f.warnings.value.trim() && `Warnings: ${f.warnings.value.trim()}`,
    ]
      .filter(Boolean)
      .join(". ")
      .slice(0, 600);
    const out = await api("/api/admin/ai/bio", {
      method: "POST",
      contentType: "application/vnd.zk-bio+json",
      body: JSON.stringify({ name_ar: f.name_ar.value, name_en: f.name_en.value, notes, category: f.category.value, image }),
    });
    applyFill(out, out.used_photo ? "✨ AI (looked at the photo)" : "✨ AI");
  } catch (err) {
    if (err.status === 401) return showLogin();
    const msg = err.status === 503 ? "✨ AI is off right now (no API key set). Use 🎲 Predefined instead." : err.message;
    toast(msg, { type: "error" });
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ AI fill (photo + info)";
  }
});

$("#dish-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    name_ar: f.name_ar.value,
    name_en: f.name_en.value,
    description: f.description.value,
    price: Number(f.price.value),
    category: f.category.value,
    badges: [...f.querySelectorAll("[name=badges]:checked")].map((cb) => cb.value),
    job_title: f.job_title.value,
    catchphrase: f.catchphrase.value,
    warnings: f.warnings.value,
    spice_level: Number(f.spice_level.value) || 3,
    calories: Number(f.calories.value) || 0,
    is_visible: f.is_visible.checked,
  };
  $("#dish-save").disabled = true;
  try {
    await photoJob;
    const key = draftKey();
    const saved = editing
      ? await api(`/api/admin/dishes/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await api("/api/admin/dishes", { method: "POST", body: JSON.stringify(body) });
    if (photo) {
      const fd = new FormData();
      fd.append("photo", await shrink(photo.upload), "photo.jpg");
      try {
        await api(`/api/admin/dishes/${saved.id}/photo`, { method: "POST", body: fd });
      } catch (err) {
        // The dish itself is saved: switch to editing it so a retry doesn't create a duplicate
        store.remove(key);
        editing = saved;
        dishes = await api("/api/admin/dishes").catch(() => dishes);
        editing = dishes.find((d) => d.id === saved.id) || saved;
        $("#dish-dialog-title").textContent = `Edit ${dishName(editing)}`;
        baseline = JSON.stringify(readForm());
        saveDraftNow();
        if (currentTab === "dishes") renderDishes();
        throw Object.assign(new Error(`Dish saved, but the photo failed: ${err.message}`), { status: err.status });
      }
    }
    clearTimeout(saveTimer);
    saveTimer = null;
    store.remove(key);
    photo = null;
    $("#dish-dialog").close();
    syncDraftChip();
    toast(editing ? `Saved "${dishName(saved)}"` : `Hired "${dishName(saved)}" 🎉`);
    if (currentTab === "overview") loadOverview().catch(fail);
    else if (currentTab === "dishes") await loadDishes();
    else dishes = await api("/api/admin/dishes");
  } catch (err) {
    $("#dish-error").textContent = err.message;
  } finally {
    $("#dish-save").disabled = false;
  }
});

// Phone photos are often 5+ MB; shrink to 1200px JPEG before upload (server limit is 4 MB)
async function shrink(file, max = 1200, quality = 0.85) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", quality));
  } catch {
    return file; // unsupported format in this browser: let the server try
  }
}

// ---- Reviews ----
async function loadReviews() {
  if (!reviews.length) loading("#review-list");
  [reviews, dishes] = await Promise.all([api("/api/admin/reviews"), api("/api/admin/dishes")]);
  const ids = new Set(reviews.map((r) => r.id));
  [...selectedReviews].forEach((id) => ids.has(id) || selectedReviews.delete(id));
  const current = $("#review-dish").value;
  $("#review-dish").innerHTML =
    `<option value="">All dishes</option>` +
    dishes
      .filter((d) => d.review_count > 0)
      .map((d) => `<option value="${esc(d.id)}">${esc(dishName(d))} (${d.review_count})</option>`)
      .join("");
  $("#review-dish").value = dishes.some((d) => d.id === current && d.review_count > 0) ? current : "";
  renderReviews();
}

function visibleReviewRows() {
  const q = $("#review-search").value.trim().toLowerCase();
  const dish = $("#review-dish").value;
  const sort = $("#review-sort").value;
  const show = $("#review-show").value;
  const SHOW = { starred: (r) => r.highlighted, low: (r) => r.chili_rating <= 2, high: (r) => r.chili_rating >= 4 };
  const rows = reviews.filter(
    (r) => (!dish || r.dish_id === dish) && (!SHOW[show] || SHOW[show](r)) && (!q || [r.author_name, r.body, r.dish_name].some((x) => String(x || "").toLowerCase().includes(q))),
  );
  const byDate = (a, b) => b.created_at.localeCompare(a.created_at);
  const sorters = {
    newest: byDate,
    oldest: (a, b) => byDate(b, a),
    lowest: (a, b) => a.chili_rating - b.chili_rating || byDate(a, b),
    highest: (a, b) => b.chili_rating - a.chili_rating || byDate(a, b),
  };
  return rows.sort(sorters[sort] || byDate);
}

function renderReviews() {
  const rows = visibleReviewRows();
  $("#review-list").innerHTML =
    rows
      .map((r) => {
        const reactions = Object.entries(r.reactions || {})
          .filter(([, n]) => n > 0)
          .map(([emoji, n]) => `${esc(emoji)} ${n}`)
          .join(" ");
        const reply = replies.get(r.id);
        return `
      <li class="${r.highlighted ? "starred" : ""}">
        <input type="checkbox" class="pick" data-pick="${esc(r.id)}" ${selectedReviews.has(r.id) ? "checked" : ""} aria-label="Select review by ${esc(r.author_name)}">
        <div class="grow">
          <strong dir="auto">${esc(r.author_name)}</strong> on <em dir="auto">${esc(r.dish_name)}</em> · ${"🌶️".repeat(r.chili_rating)} · 😬 ${r.awkward_rating}/5
          <p dir="auto">${esc(r.body)}</p>
          <small>${esc(when(r.created_at))}${reactions ? ` · ${reactions}` : ""}</small>
          ${reply ? `<blockquote class="ai-reply" dir="auto"><small>↩️ ${esc(r.dish_name)} replies:</small> ${esc(reply)} <button class="btn small ghost" type="button" data-copy-reply="${esc(r.id)}">📋 Copy</button></blockquote>` : ""}
        </div>
        <div class="row-actions">
          <button class="btn small ghost star-btn" type="button" data-star="${esc(r.id)}" aria-pressed="${Boolean(r.highlighted)}" title="${r.highlighted ? "Remove highlight" : "Highlight"}">${r.highlighted ? "⭐" : "☆"}<span class="sr-only"> Highlight</span></button>
          <button class="btn small ghost" type="button" data-reply="${esc(r.id)}" ${r.dish_visible ? "" : `disabled title="The dish is hidden, so it can't reply"`}>✨ Reply as dish</button>
          <button class="btn small danger" data-delete-review="${esc(r.id)}">Delete</button>
        </div>
      </li>`;
      })
      .join("") || `<li class="state">${reviews.length ? "No reviews match these filters." : "No reviews yet. They'll show up here when people start roasting the dishes."}</li>`;
  const avg = rows.length ? Math.round((rows.reduce((n, r) => n + r.chili_rating, 0) / rows.length) * 10) / 10 : null;
  $("#review-summary").textContent = rows.length ? `${rows.length} review${rows.length === 1 ? "" : "s"} · avg ${avg} 🌶️ · ${reviews.filter((r) => r.highlighted).length} highlighted ⭐` : "";
  $("#review-export").disabled = rows.length === 0;
  syncReviewBulk(rows);
}

function syncReviewBulk(rows = visibleReviewRows()) {
  const n = selectedReviews.size;
  $("#review-count").textContent = `${n} selected`;
  $("#review-bulk-delete").disabled = n === 0;
  const all = $("#review-all");
  all.checked = rows.length > 0 && rows.every((r) => selectedReviews.has(r.id));
  all.indeterminate = !all.checked && rows.some((r) => selectedReviews.has(r.id));
}

["#review-search", "#review-dish", "#review-sort", "#review-show"].forEach((sel) => $(sel).addEventListener("input", renderReviews));
const replies = new Map(); // review id -> AI reply text (this session only, not saved)
$("#review-all").addEventListener("change", (e) => {
  visibleReviewRows().forEach((r) => (e.target.checked ? selectedReviews.add(r.id) : selectedReviews.delete(r.id)));
  renderReviews();
});
$("#review-list").addEventListener("change", (e) => {
  const id = e.target.dataset.pick;
  if (!id) return;
  e.target.checked ? selectedReviews.add(id) : selectedReviews.delete(id);
  syncReviewBulk();
});

$("#review-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.star) return toggleStar(btn);
  if (btn.dataset.reply) return replyAsDish(btn);
  if (btn.dataset.copyReply) {
    try {
      await navigator.clipboard.writeText(replies.get(btn.dataset.copyReply) || "");
      toast("Copied 📋");
    } catch {
      toast("Couldn't copy, select the text instead", { type: "error" });
    }
    return;
  }
  const id = btn.dataset.deleteReview;
  if (!id || !confirm("Delete this review?")) return;
  try {
    await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
    selectedReviews.delete(id);
    toast("Review deleted");
    await loadReviews();
  } catch (err) {
    fail(err);
  }
});

async function toggleStar(btn) {
  const r = reviews.find((x) => x.id === btn.dataset.star);
  if (!r) return;
  btn.disabled = true;
  try {
    await api(`/api/admin/reviews/${r.id}/highlight`, { method: "POST", body: JSON.stringify({ on: !r.highlighted }) });
    r.highlighted = !r.highlighted;
    renderReviews();
    toast(r.highlighted ? "⭐ Highlighted" : "Highlight removed");
  } catch (err) {
    btn.disabled = false;
    fail(err);
  }
}

// Uses the public /api/ai/review-reply (same text the site shows); nothing is posted anywhere
async function replyAsDish(btn) {
  const r = reviews.find((x) => x.id === btn.dataset.reply);
  if (!r) return;
  btn.disabled = true;
  btn.textContent = "✨ Thinking…";
  try {
    const out = await api("/api/ai/review-reply", { method: "POST", body: JSON.stringify({ dish_id: r.dish_id, review_id: r.id }) });
    replies.set(r.id, out.text);
    renderReviews();
  } catch (err) {
    toast(err.status === 503 ? "✨ AI is off right now. Check the 🤖 AI status card." : err.message, { type: "error" });
    btn.disabled = false;
    btn.textContent = "✨ Reply as dish";
  }
}

$("#review-export").addEventListener("click", () => {
  const rows = visibleReviewRows();
  const header = ["created_at", "dish", "author_name", "chili_rating", "awkward_rating", "body", "highlighted", "reactions"];
  const data = rows.map((r) => [r.created_at, r.dish_name, r.author_name, r.chili_rating, r.awkward_rating, r.body, r.highlighted ? "yes" : "", Object.entries(r.reactions || {}).map(([k, n]) => `${k}${n}`).join(" ")]);
  downloadFile(toCsv([header, ...data]), `zesty-reviews-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
  toast(`Exported ${rows.length} reviews`);
});

$("#review-bulk-delete").addEventListener("click", async () => {
  const ids = [...selectedReviews];
  if (!ids.length || !confirm(`Delete ${ids.length} review${ids.length > 1 ? "s" : ""}? This can't be undone.`)) return;
  try {
    await Promise.all(ids.map((id) => api(`/api/admin/reviews/${id}`, { method: "DELETE" })));
    selectedReviews.clear();
    toast(`Deleted ${ids.length} review${ids.length > 1 ? "s" : ""}`);
  } catch (err) {
    fail(err);
  }
  await loadReviews().catch(fail);
});

// ---- Orders ----
const itemLine = (i) => `${i.qty}× ${i.name_en || i.name_ar} (${i.size})${i.addons?.length ? ` + ${i.addons.join(", ")}` : ""}`;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "?";
const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function loadOrders() {
  if (!orders.length) loading("#order-list");
  orders = await api("/api/admin/orders");
  const counts = new Map();
  for (const o of orders) {
    const key = firstName(o.customer_name).toLowerCase();
    const c = counts.get(key) || { name: firstName(o.customer_name), n: 0 };
    c.n++;
    counts.set(key, c);
  }
  const current = $("#order-customer").value;
  $("#order-customer").innerHTML =
    `<option value="">All customers</option>` +
    [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name))
      .map(([key, c]) => `<option value="${esc(key)}">${esc(c.name)} (${c.n})</option>`)
      .join("");
  $("#order-customer").value = counts.has(current) ? current : "";
  renderOrders();
}

function visibleOrderRows() {
  const q = $("#order-search").value.trim().toLowerCase();
  const who = $("#order-customer").value;
  let since = 0;
  if (orderRange === "today") since = new Date().setHours(0, 0, 0, 0);
  if (orderRange === "7d") since = new Date().setHours(0, 0, 0, 0) - 6 * 24 * 60 * 60 * 1000;
  return orders.filter(
    (o) =>
      (!since || new Date(o.created_at).getTime() >= since) &&
      (!who || firstName(o.customer_name).toLowerCase() === who) &&
      (!q ||
        String(o.order_number).includes(q.replace(/^#/, "")) ||
        String(o.customer_name || "").toLowerCase().includes(q) ||
        (o.items || []).some((i) => `${i.name_ar} ${i.name_en || ""}`.toLowerCase().includes(q))),
  );
}

function renderOrders() {
  const rows = visibleOrderRows();
  const sum = rows.reduce((s, o) => s + Number(o.total || 0), 0);
  $("#order-summary").textContent = `${rows.length} order${rows.length === 1 ? "" : "s"} · ${egp(sum)}${rows.length ? ` · avg ${egp(sum / rows.length)}` : ""}`;
  $("#export-csv").disabled = rows.length === 0;

  const perDay = new Map();
  for (const o of rows) {
    const k = dayKey(o.created_at);
    const d = perDay.get(k) || { n: 0, items: 0, total: 0 };
    d.n++;
    d.items += (o.items || []).reduce((n, i) => n + Number(i.qty || 0), 0);
    d.total += Number(o.total || 0);
    perDay.set(k, d);
  }
  $("#day-totals").hidden = rows.length === 0;
  $("#day-table").innerHTML = `<thead><tr><th scope="col">Day</th><th scope="col">Orders</th><th scope="col">Items</th><th scope="col">Total</th></tr></thead><tbody>${[...perDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([k, d]) => `<tr><td>${esc(new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }))}</td><td>${d.n}</td><td>${d.items}</td><td>${egp(d.total)}</td></tr>`)
    .join("")}</tbody><tfoot><tr><th scope="row">Total</th><td>${rows.length}</td><td>${[...perDay.values()].reduce((n, d) => n + d.items, 0)}</td><td>${egp(sum)}</td></tr></tfoot>`;

  $("#order-list").innerHTML =
    rows
      .map(
        (o) => `
      <li>
        <details class="grow">
          <summary>
            <strong>#${esc(o.order_number)}</strong> by <span dir="auto">${esc(o.customer_name)}</span> · ${egp(o.total)} · ${esc(PAYMENT_LABELS[o.payment_method] || o.payment_method)}
            <small>${esc(when(o.created_at))} · ${(o.items || []).reduce((n, i) => n + Number(i.qty || 0), 0)} items</small>
          </summary>
          <ul class="order-items">${(o.items || []).map((i) => `<li dir="auto">${esc(itemLine(i))} · ${egp(i.unit_price * i.qty)}</li>`).join("")}</ul>
          <p>Subtotal ${egp(o.subtotal)}${(o.fees || []).map((f) => ` · ${esc(f.en)} ${egp(f.amount)}`).join("")}</p>
          ${o.note ? `<p dir="auto">📝 ${esc(o.note)}</p>` : ""}
        </details>
        <div class="row-actions">
          <button class="btn small ghost" data-receipt="${esc(o.id)}">🧾 Receipt</button>
          <button class="btn small danger" data-delete-order="${esc(o.id)}" data-number="${esc(o.order_number)}">Delete</button>
        </div>
      </li>`,
      )
      .join("") || `<li class="state">${orders.length ? "No orders match. Try another range, customer or search." : "No orders yet."}</li>`;
}

$("#order-search").addEventListener("input", renderOrders);
$("#order-customer").addEventListener("input", renderOrders);
$$("[data-range]").forEach((btn) =>
  btn.addEventListener("click", () => {
    orderRange = btn.dataset.range;
    $$("[data-range]").forEach((b) => b.classList.toggle("active", b === btn));
    renderOrders();
  }),
);

$("#order-list").addEventListener("click", async (e) => {
  const receiptId = e.target.dataset.receipt;
  if (receiptId) return openReceipt(orders.find((o) => o.id === receiptId));
  const id = e.target.dataset.deleteOrder;
  if (!id || !confirm(`Delete order #${e.target.dataset.number}? It also stops counting on the leaderboard.`)) return;
  try {
    await api(`/api/admin/orders/${id}`, { method: "DELETE" });
    toast(`Order #${e.target.dataset.number} deleted`);
    await loadOrders();
  } catch (err) {
    fail(err);
  }
});

// Printable receipt: the print stylesheet hides everything except #receipt
function openReceipt(o) {
  if (!o) return;
  const line = (label, amount, cls = "") => `<div class="r-line ${cls}"><span dir="auto">${label}</span><span>${egp(amount)}</span></div>`;
  $("#receipt").innerHTML = `
    <div class="r-head">
      <strong>🌶️ ZESTY KITCHEN</strong>
      <small>مطبخ الزملاء · coworkers, freshly roasted</small>
    </div>
    <div class="r-meta">
      <div><span>Order</span><b>#${esc(o.order_number)}</b></div>
      <div><span>Date</span><b>${esc(when(o.created_at))}</b></div>
      <div><span>Customer</span><b dir="auto">${esc(o.customer_name)}</b></div>
      <div><span>Payment</span><b>${esc(PAYMENT_LABELS[o.payment_method] || o.payment_method)}</b></div>
    </div>
    <div class="r-items">${(o.items || []).map((i) => line(esc(itemLine(i)), Number(i.unit_price) * Number(i.qty))).join("")}</div>
    ${line("Subtotal", o.subtotal, "r-sub")}
    ${(o.fees || []).map((f) => line(esc(f.en), f.amount, "r-fee")).join("")}
    ${line("TOTAL", o.total, "r-total")}
    ${o.note ? `<p class="r-note" dir="auto">📝 ${esc(o.note)}</p>` : ""}
    <p class="r-foot">No refunds. The coworker has already been eaten. 🫡<br>شكرًا لاختيارك الدراما</p>`;
  $("#receipt-dialog").showModal();
}
$("#receipt-print").addEventListener("click", () => {
  document.body.classList.add("printing-receipt");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("printing-receipt"));
$("#receipt-close").addEventListener("click", () => $("#receipt-dialog").close());

// Excel needs the BOM to read UTF-8 (Arabic). Prefix formula-like cells so they open as text.
function toCsv(rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#export-csv").addEventListener("click", () => {
  const rows = visibleOrderRows();
  const header = ["order_number", "created_at", "customer_name", "payment_method", "items", "item_count", "subtotal", "fees", "total", "note"];
  const data = rows.map((o) => [
    o.order_number,
    o.created_at,
    o.customer_name,
    o.payment_method,
    (o.items || []).map(itemLine).join(" | "),
    (o.items || []).reduce((n, i) => n + Number(i.qty || 0), 0),
    Number(o.subtotal),
    Math.round((o.fees || []).reduce((s, f) => s + Number(f.amount || 0), 0) * 100) / 100,
    Number(o.total),
    o.note || "",
  ]);
  downloadFile(toCsv([header, ...data]), `zesty-orders-${orderRange}-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
  toast(`Exported ${rows.length} orders`);
});

// ---- Settings ----
const SHORTCUTS = [
  ["1 – 5", "Switch tabs (Overview, Dishes, Reviews, Orders, Settings)"],
  ["n", "New dish"],
  ["/", "Search in the current tab"],
  ["c", "Open / close the 👨‍🍳 chef assistant"],
  ["?", "This help"],
  ["Ctrl/⌘ + S", "Save the dish you're editing"],
  ["Esc", "Close a dialog or the chef chat"],
  ["Enter", "In a price box: save the price"],
];
const shortcutsHtml = () => `<table class="data-table keys"><tbody>${SHORTCUTS.map(([k, d]) => `<tr><td>${k.split(" + ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" + ")}</td><td>${esc(d)}</td></tr>`).join("")}</tbody></table>`;
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function loadSettings() {
  $("#shortcuts-inline").innerHTML = shortcutsHtml();
  applyTheme(themeMode());
  if (!$("#board-date").value) $("#board-date").value = todayInput();
  $("#board-date").max = todayInput();
  const [s, st] = await Promise.all([api("/api/admin/settings"), api("/api/admin/ai/status").catch(() => null)]);
  $("#board-since").innerHTML = s.leaderboard_since ? `Counting since: <strong>${esc(when(s.leaderboard_since))}</strong>` : "Counting since: <strong>the beginning of time</strong> (never reset)";
  const used = st?.usage.used ?? s.ai.used_today;
  const cap = st?.usage.cap ?? s.ai.cap;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  $("#settings-ai").innerHTML = `
    <p><span class="pill ${s.ai.enabled ? "on" : "off"}">${s.ai.enabled ? "✨ AI on" : "😴 AI off"}</span> ${st ? st.providers.filter((p) => p.connected).map((p) => `<span class="pill on">${esc(p.label)}</span>`).join(" ") : ""}</p>
    <div class="meter-row"><span><b>${used}</b> / ${cap ?? "∞"} calls today</span><span class="meter" role="meter" aria-label="AI calls used today" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%" class="${pct >= 90 ? "hot" : ""}"></span></span></div>
    <p class="hint">Every AI button, the waiter chat and each chef-assistant step count as one call. When the cap is hit, the site falls back to canned jokes until midnight UTC.</p>`;
}

async function resetBoard(since) {
  const label = since ? new Date(since).toLocaleDateString() : "now";
  if (!confirm(`Reset the public leaderboard to count from ${label}? Old orders stay in the Orders tab.`)) return;
  try {
    const r = await api("/api/admin/leaderboard/reset", { method: "POST", body: JSON.stringify(since ? { since } : {}) });
    toast(`Leaderboard counts from ${when(r.since)} 🏆`);
    loadSettings().catch(fail);
  } catch (err) {
    fail(err);
  }
}
$("#board-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#board-date").value;
  if (!v) return;
  resetBoard(new Date(`${v}T00:00:00`).toISOString());
});
$("#board-now").addEventListener("click", () => resetBoard(null));

$("#export-json").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await fetch("/api/admin/export", { credentials: "same-origin" });
    if (res.status === 401) return showLogin();
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    downloadFile(blob, `zesty-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast(`Backup downloaded (${Math.max(1, Math.round(blob.size / 1024))} KB) 💾`);
  } catch (err) {
    fail(err);
  } finally {
    btn.disabled = false;
  }
});

let importDishes = null;
async function readImport(file) {
  importDishes = null;
  $("#import-go").disabled = true;
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data?.dishes;
    if (!Array.isArray(list) || !list.length) throw new Error("No dishes in that file (expected a list or { dishes: [...] })");
    importDishes = list;
    $("#import-preview").textContent = `📄 ${file.name}: ${list.length} dish${list.length === 1 ? "" : "es"} found${data?.exported_at ? ` (backup from ${when(data.exported_at)})` : ""}. Photos are not imported.`;
    $("#import-go").disabled = false;
  } catch (err) {
    $("#import-preview").textContent = `❌ ${err.message.startsWith("No dishes") ? err.message : "That's not valid JSON."}`;
  }
}
$("#import-file").addEventListener("change", (e) => readImport(e.target.files[0]));
$("#import-drop").addEventListener("dragover", (e) => {
  e.preventDefault();
  e.currentTarget.classList.add("over");
});
$("#import-drop").addEventListener("dragleave", (e) => e.currentTarget.classList.remove("over"));
$("#import-drop").addEventListener("drop", (e) => {
  e.preventDefault();
  e.currentTarget.classList.remove("over");
  readImport(e.dataTransfer.files[0]);
});
$("#import-go").addEventListener("click", async (e) => {
  if (!importDishes) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const r = await api("/api/admin/dishes/import", { method: "POST", contentType: "application/vnd.zk-import+json", body: JSON.stringify({ dishes: importDishes, skip_existing: $("#import-skip").checked }) });
    $("#import-preview").textContent = `✅ Imported ${r.created} dish${r.created === 1 ? "" : "es"}${r.skipped ? `, skipped ${r.skipped} that already exist` : ""}.`;
    toast(`Imported ${r.created} dishes 📥`);
    importDishes = null;
    $("#import-file").value = "";
    dishes = await api("/api/admin/dishes").catch(() => dishes);
  } catch (err) {
    $("#import-preview").textContent = `❌ ${err.message}`;
    btn.disabled = false;
    if (err.status === 401) showLogin();
  }
});

$("#shortcuts-open").addEventListener("click", () => openShortcuts());
$("#shortcuts-close").addEventListener("click", () => $("#shortcuts-dialog").close());
function openShortcuts() {
  $("#shortcuts-list").innerHTML = shortcutsHtml();
  if (!$("#shortcuts-dialog").open) $("#shortcuts-dialog").showModal();
}

// ---- 👨‍🍳 Chef assistant ----
const CHEF_KEY = "zk_chef_log";
const CHEF_WIDE_KEY = "zk_chef_wide";
let chefLog = []; // [{ role: "user"|"assistant", text, cards?, error? }]
let chefBusy = false;
let chefReady = false;
const session = {
  get() {
    try {
      return JSON.parse(sessionStorage.getItem(CHEF_KEY) || "[]");
    } catch {
      return [];
    }
  },
  set(v) {
    try {
      sessionStorage.setItem(CHEF_KEY, JSON.stringify(v.slice(-40)));
    } catch {
      /* storage full or blocked: the chat just won't survive a reload */
    }
  },
};
const CHIPS = [
  { label: "🔍 What needs fixing?", run: () => ["find_issues", {}] },
  { label: "📊 Today's stats", run: () => ["order_stats", { range: "today" }] },
  { label: "🗓️ This week", run: () => ["order_stats", { range: "7d" }] },
  { label: "🙈 Hide sold-out", run: () => ["set_visibility", { badge: "sold_out", visible: false }] },
  {
    label: "✍️ Write copy for dishes missing descriptions",
    run: () => {
      const ids = dishes.filter((d) => !String(d.description || "").trim()).slice(0, 5).map((d) => d.id);
      return ids.length ? ["write_dish_copy", { ids }] : null;
    },
    empty: "Every dish already has a description. Chef's kiss 🤌",
  },
  { label: "💡 Menu ideas", run: () => ["suggest_menu_ideas", { count: 3 }] },
];

function syncChefStatus() {
  const el = $("#chef-status");
  if (!el) return;
  el.innerHTML = aiEnabled ? `<span class="dot on"></span> AI on · quick actions run instantly` : `<span class="dot"></span> AI off · quick actions still work`;
}

async function chefInit() {
  if (chefReady) return;
  chefReady = true;
  chefLog = session.get();
  $("#chef-chips").innerHTML = CHIPS.map((c, i) => `<button type="button" class="chip" data-chip="${i}">${esc(c.label)}</button>`).join("");
  let wide = false;
  try {
    wide = localStorage.getItem(CHEF_WIDE_KEY) === "1";
  } catch {
    wide = false;
  }
  setChefWide(wide);
  renderChef();
  try {
    aiEnabled = Boolean((await api("/api/admin/agent")).enabled);
  } catch {
    aiEnabled = false;
  }
  syncChefStatus();
}

function setChefWide(on) {
  $("#chef").classList.toggle("wide", on);
  $("#chef-wide").setAttribute("aria-pressed", String(on));
  $("#chef-wide").title = on ? "Shrink" : "Expand";
  $("#chef-wide").textContent = on ? "⤡" : "⤢";
  try {
    localStorage.setItem(CHEF_WIDE_KEY, on ? "1" : "0");
  } catch {
    /* not remembered */
  }
}

function openChef() {
  $("#chef").hidden = false;
  $("#chef-fab").setAttribute("aria-expanded", "true");
  document.body.classList.add("chef-open");
  renderChef();
  setTimeout(() => $("#chef-input").focus(), 30);
}
function closeChef() {
  if ($("#chef").hidden) return;
  $("#chef").hidden = true;
  $("#chef-fab").setAttribute("aria-expanded", "false");
  document.body.classList.remove("chef-open");
  $("#chef-fab").focus();
}
const toggleChef = () => ($("#chef").hidden ? openChef() : closeChef());
$("#chef-fab").addEventListener("click", toggleChef);
$("#chef-close").addEventListener("click", closeChef);
$("#chef-wide").addEventListener("click", () => setChefWide(!$("#chef").classList.contains("wide")));
$("#chef-clear").addEventListener("click", () => {
  chefLog = [];
  session.set(chefLog);
  renderChef();
  $("#chef-input").focus();
});

const cellHtml = (v, isTime) => (isTime ? esc(when(v)) : esc(v));
function chefCard(c, ei, ci) {
  const title = c.title ? `<div class="cc-title">${esc(c.title)}</div>` : "";
  if (c.kind === "table") {
    if (!c.rows?.length) return `<div class="cc">${title}<p class="hint">Nothing here.</p></div>`;
    return `<div class="cc">${title}<div class="table-wrap"><table class="data-table"><thead><tr>${c.columns.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${c.rows
      .map((r) => `<tr>${r.map((v, i) => `<td dir="auto">${cellHtml(v, i === c.time_col)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div></div>`;
  }
  if (c.kind === "stats") return `<div class="cc">${title}<div class="cc-kpis">${c.kpis.map((k) => `<div class="kpi"><span class="kpi-label">${esc(k.label)}</span><strong class="kpi-value">${esc(k.value)}</strong></div>`).join("")}</div></div>`;
  if (c.kind === "dishes" || c.kind === "issues") {
    if (!c.items?.length) return `<div class="cc">${title}</div>`;
    return `<div class="cc">${title}<ul class="cc-dishes">${c.items
      .map(
        (d) => `<li>
          ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : `<span class="noimg">🍽️</span>`}
          <div class="grow"><strong dir="auto">${esc(d.name)}</strong>
            <small>${esc(d.price)} EGP · ${d.visible ? "👁 visible" : "🙈 hidden"}${d.detail ? ` · <span dir="auto">${esc(d.detail)}</span>` : ""}</small>
            ${(d.issues || []).length ? `<span class="meta">${d.issues.map((i) => `<span class="tag">${esc(i)}</span>`).join("")}</span>` : ""}
          </div>
          <button class="btn small ghost" type="button" data-chef-edit="${esc(d.id)}">${c.kind === "issues" ? "Fix" : "Edit"}</button>
        </li>`,
      )
      .join("")}</ul></div>`;
  }
  if (c.kind === "ideas") {
    return `<div class="cc">${title}<ul class="cc-ideas">${c.items
      .map(
        (x, xi) => `<li>
          <div><strong dir="auto">${esc(x.name_ar)}</strong>${x.name_en ? ` · <span dir="auto">${esc(x.name_en)}</span>` : ""}</div>
          <small dir="auto">💼 ${esc(x.job_title)} · ${esc(x.price)} EGP · ${esc(x.category)}</small>
          <p dir="auto">${esc(x.description)}</p>
          ${x.catchphrase ? `<p class="hint" dir="auto">💬 “${esc(x.catchphrase)}”</p>` : ""}
          <button class="btn small" type="button" data-idea="${ei}:${ci}:${xi}" ${x.added ? "disabled" : ""}>${x.added ? "✅ Added (hidden)" : "➕ Add as hidden dish"}</button>
        </li>`,
      )
      .join("")}</ul></div>`;
  }
  if (c.kind === "confirm") {
    const state = c.resolved === "done" ? `<p class="cc-done">✅ Done</p>` : c.resolved === "cancelled" ? `<p class="hint">Cancelled. Nothing changed.</p>` : c.resolved === "failed" ? `<p class="hint">Didn't go through (see below). Ask again if you still want it.</p>` : `<div class="btn-group"><button class="btn small danger" type="button" data-confirm="${ei}:${ci}">✅ Yes, do it</button><button class="btn small ghost" type="button" data-cancel="${ei}:${ci}">Cancel</button></div>`;
    return `<div class="cc cc-confirm"><p><strong>⚠️ Confirm:</strong> ${esc(c.text)}</p>${state}</div>`;
  }
  return `<div class="cc cc-${esc(c.tone || "ok")}"><p>${esc(c.text)}</p></div>`;
}

function renderChef() {
  const log = $("#chef-log");
  if (!log) return;
  const intro = `<div class="msg bot"><div class="bubble">أهلًا يا شيف 👨‍🍳 I can edit dishes, hide/show them, pull real stats, write funny copy and clean up reviews. Deletes always ask you first. Try a quick action below 👇</div></div>`;
  log.innerHTML =
    intro +
    chefLog
      .map(
        (m, ei) => `<div class="msg ${m.role === "user" ? "me" : "bot"}${m.error ? " err" : ""}">
          ${m.text ? `<div class="bubble" dir="auto">${esc(m.text)}</div>` : ""}
          ${(m.cards || []).map((c, ci) => chefCard(c, ei, ci)).join("")}
        </div>`,
      )
      .join("") +
    (chefBusy ? `<div class="msg bot"><div class="bubble typing" aria-label="Chef is thinking"><span></span><span></span><span></span></div></div>` : "");
  log.scrollTop = log.scrollHeight;
  $("#chef-send").disabled = chefBusy;
  $$("#chef-chips .chip").forEach((b) => (b.disabled = chefBusy));
}

function chefHistory() {
  return chefLog
    .filter((m) => m.text && !m.local && (m.role === "user" || m.role === "assistant"))
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.text }));
}

async function chefRequest(body, { userText } = {}) {
  if (chefBusy) return;
  if (userText) chefLog.push({ role: "user", text: userText, local: Boolean(body.run) });
  chefBusy = true;
  renderChef();
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const res = await api("/api/admin/agent", { method: "POST", body: JSON.stringify({ ...body, tz }) });
    chefLog.push({ role: "assistant", text: res.reply, cards: res.cards || [], local: Boolean(body.run || body.confirm_token) });
    applyChefActions(res.actions || []);
    return res;
  } catch (err) {
    if (err.status === 401) return showLogin();
    chefLog.push({ role: "assistant", text: `😬 ${err.message}`, error: true, local: true });
  } finally {
    chefBusy = false;
    session.set(chefLog);
    renderChef();
  }
}

function applyChefActions(actions) {
  const tabs = new Set(actions.filter((a) => a.type === "refresh").flatMap((a) => a.tabs || []));
  if (!tabs.size) return;
  if (tabs.has(currentTab)) LOADERS[currentTab]().catch(fail);
  else if (tabs.has("dishes")) api("/api/admin/dishes").then((d) => (dishes = d)).catch(() => {});
}

function sendChef(text) {
  const t = text.trim();
  if (!t) return;
  chefRequest({ messages: [...chefHistory(), { role: "user", content: t }] }, { userText: t });
}

function runChef(tool, args, label) {
  chefRequest({ run: { tool, args } }, { userText: label });
}

$("#chef-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#chef-input");
  sendChef(input.value);
  input.value = "";
  input.style.height = "";
});
$("#chef-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#chef-form").requestSubmit();
  }
});
$("#chef-input").addEventListener("input", (e) => {
  e.target.style.height = "";
  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
});
$("#chef-chips").addEventListener("click", (e) => {
  const chip = CHIPS[e.target.closest("[data-chip]")?.dataset.chip];
  if (!chip || chefBusy) return;
  const run = chip.run();
  if (!run) {
    chefLog.push({ role: "user", text: chip.label, local: true }, { role: "assistant", text: chip.empty || "Nothing to do 🤷", local: true });
    session.set(chefLog);
    return renderChef();
  }
  runChef(run[0], run[1], chip.label);
});

$("#chef-log").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const ref = (key) => {
    const [ei, ci, xi] = btn.dataset[key].split(":").map(Number);
    return { entry: chefLog[ei], card: chefLog[ei]?.cards?.[ci], xi };
  };
  if (btn.dataset.chefEdit) {
    if (!dishes.some((d) => d.id === btn.dataset.chefEdit)) dishes = await api("/api/admin/dishes").catch(() => dishes);
    const dish = dishes.find((d) => d.id === btn.dataset.chefEdit);
    return dish ? openDish(dish) : toast("That dish doesn't exist anymore", { type: "error" });
  }
  if (btn.dataset.confirm) {
    const { card } = ref("confirm");
    if (!card || card.resolved) return;
    const res = await chefRequest({ confirm_token: card.token }, { userText: "✅ Yes, do it" });
    card.resolved = res?.done ? "done" : "failed";
    session.set(chefLog);
    return renderChef();
  }
  if (btn.dataset.cancel) {
    const { card } = ref("cancel");
    if (!card) return;
    card.resolved = "cancelled";
    chefLog.push({ role: "assistant", text: "Cancelled. Nothing was touched 🫡", local: true });
    session.set(chefLog);
    return renderChef();
  }
  if (btn.dataset.idea) {
    const { card, xi } = ref("idea");
    const idea = card?.items?.[xi];
    if (!idea || idea.added) return;
    btn.disabled = true;
    try {
      const { added, ...fields } = idea;
      const d = await api("/api/admin/dishes", { method: "POST", body: JSON.stringify({ ...fields, is_visible: false }) });
      idea.added = true;
      session.set(chefLog);
      renderChef();
      toast(`Hired “${dishName(d)}” (hidden). Add a photo and show it when ready 🎉`);
      applyChefActions([{ type: "refresh", tabs: ["dishes", "overview"] }]);
    } catch (err) {
      btn.disabled = false;
      fail(err);
    }
  }
});

// "Ask the chef" buttons elsewhere in the admin
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-chef-run]");
  if (!btn) return;
  openChef();
  runChef(btn.dataset.chefRun, {}, btn.textContent.trim());
});

// ---- Keyboard ----
document.addEventListener("keydown", (e) => {
  const dialog = $("#dish-dialog");
  if (dialog.open && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (!$("#close-dialog").open && !$("#dish-save").disabled) $("#dish-form").requestSubmit();
    return;
  }
  if (e.key === "Escape" && $("#close-dialog").open) {
    e.preventDefault();
    return $("#close-dialog").close();
  }
  if (e.key === "Escape" && dialog.open) {
    e.preventDefault();
    return requestClose();
  }
  const anyDialog = $$("dialog").some((d) => d.open);
  if (e.key === "Escape" && !anyDialog && !$("#chef").hidden) {
    e.preventDefault();
    return closeChef();
  }
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (typing || anyDialog || $("#panel").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "n") {
    e.preventDefault();
    openDish(null);
  } else if (e.key === "/") {
    const search = $(`#tab-${currentTab} input[type=search]`);
    if (search) {
      e.preventDefault();
      search.focus();
    }
  } else if (e.key === "c") {
    e.preventDefault();
    toggleChef();
  } else if (e.key === "?") {
    e.preventDefault();
    openShortcuts();
  } else if (/^[1-5]$/.test(e.key)) {
    e.preventDefault();
    switchTab(TABS[Number(e.key) - 1]);
  }
});

// A file dropped outside a drop zone shouldn't navigate away from the admin
["dragover", "drop"].forEach((type) =>
  window.addEventListener(type, (e) => {
    if (hasFiles(e) && !e.defaultPrevented) e.preventDefault();
  }),
);

// ---- Boot ----
applyTheme(themeMode());
(async () => {
  try {
    config = await api("/api/config");
  } catch (err) {
    return toast(err.message, { type: "error", ms: 20000 });
  }
  const catOptions = config.categories.map((c) => `<option value="${esc(c.slug)}">${c.emoji} ${esc(c.en)}</option>`).join("");
  $("#category-select").innerHTML = config.categories.map((c) => `<option value="${esc(c.slug)}">${c.emoji} ${esc(c.en)} / ${esc(c.ar)}</option>`).join("");
  $("#dish-cat").innerHTML += catOptions;
  $("#bulk-cat").innerHTML += catOptions;
  $("#bulk-badge").innerHTML += Object.entries(config.badges).map(([b, label]) => `<option value="${esc(b)}">${esc(label)}</option>`).join("");
  $("#badge-boxes").innerHTML = Object.entries(config.badges).map(([b, label]) => `<label class="inline"><input type="checkbox" name="badges" value="${esc(b)}"> ${esc(label)}</label>`).join("");
  try {
    await showPanel();
  } catch (err) {
    if (err.status === 401) showLogin();
    else toast(err.message, { type: "error", ms: 20000 });
  }
})();
