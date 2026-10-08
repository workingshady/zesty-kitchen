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

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
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
}

async function showPanel() {
  // Probe auth first so a 401 lands on the login screen
  dishes = await api("/api/admin/dishes");
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  const fromHash = location.hash.slice(1);
  switchTab(["overview", "dishes", "reviews", "orders"].includes(fromHash) ? fromHash : "overview");
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
  ({ overview: loadOverview, dishes: loadDishes, reviews: loadReviews, orders: loadOrders })[name]().catch(fail);
}
$$(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

// ---- Overview ----
async function loadOverview() {
  $("#overview").innerHTML = `<p class="state">Loading…</p>`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const s = await api(`/api/admin/stats?tz=${encodeURIComponent(tz)}`);
  const kpi = (label, value, sub = "") => `<div class="kpi"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const maxTop = Math.max(1, ...s.top_dishes.map((d) => d.qty));
  const maxDay = Math.max(1, ...s.orders_per_day.map((d) => d.count));
  const pay = s.top_payment_method;

  $("#overview").innerHTML = `
    <div class="kpis">
      ${kpi("🧾 Total orders", s.total_orders)}
      ${kpi("📅 Orders today", s.orders_today)}
      ${kpi("💸 Fake revenue", egp(s.revenue))}
      ${kpi("🧮 Avg order", egp(s.avg_order_value))}
      ${kpi("💬 Reviews", s.reviews_count)}
      ${kpi("🌶️ Avg chili", s.avg_chili ?? "–", s.avg_chili ? "out of 5" : "no reviews yet")}
      ${kpi("👁 Dishes", `${s.dishes_visible} / ${s.dishes_total}`, `${s.dishes_hidden} hidden`)}
      ${kpi("📸 No photo", s.dishes_without_photo, "dishes")}
    </div>
    <div class="ov-grid">
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
        <h3>📈 Orders, last 14 days</h3>
        <div class="vbars" role="img" aria-label="Orders per day for the last 14 days">
          ${s.orders_per_day
            .map((d) => {
              const label = new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
              return `<div class="vbar" title="${esc(label)}: ${d.count}"><span class="vbar-n">${d.count || ""}</span><span class="vbar-fill" style="height:${Math.round((d.count / maxDay) * 100)}%"></span><span class="vbar-day">${esc(d.day.slice(8))}</span></div>`;
            })
            .join("")}
        </div>
        <p class="hint">💳 Most used payment: ${pay ? `<strong>${esc(PAYMENT_LABELS[pay.method] || pay.method)}</strong> (${pay.count}×)` : "–"}</p>
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
      <section class="card">
        <h3>⚠️ Needs attention</h3>
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
$("#refresh-overview").addEventListener("click", () => loadOverview().catch(fail));
$("#overview").addEventListener("click", async (e) => {
  const id = e.target.closest("[data-fix]")?.dataset.fix;
  if (!id) return;
  dishes = await api("/api/admin/dishes").catch((err) => (fail(err), dishes));
  const dish = dishes.find((d) => d.id === id);
  if (dish) openDish(dish);
});

// ---- Dishes ----
const dishFilters = () => ({ q: $("#dish-search").value.trim().toLowerCase(), cat: $("#dish-cat").value, vis: $("#dish-vis").value });
const isFiltering = () => {
  const f = dishFilters();
  return Boolean(f.q || f.cat || f.vis);
};

async function loadDishes() {
  if (!dishes.length) loading("#dish-list");
  dishes = await api("/api/admin/dishes");
  const ids = new Set(dishes.map((d) => d.id));
  [...selectedDishes].forEach((id) => ids.has(id) || selectedDishes.delete(id));
  renderDishes();
}

function visibleDishRows() {
  const { q, cat, vis } = dishFilters();
  return dishes.filter(
    (d) =>
      (!cat || d.category === cat) &&
      (!vis || (vis === "visible") === Boolean(d.is_visible)) &&
      (!q || [d.name_ar, d.name_en, d.job_title, d.catchphrase].some((x) => String(x || "").toLowerCase().includes(q))),
  );
}

function renderDishes() {
  const cats = Object.fromEntries(config.categories.map((c) => [c.slug, `${c.emoji} ${c.en}`]));
  const rows = visibleDishRows();
  const filtering = isFiltering();
  $("#dish-hint").textContent = filtering ? `Showing ${rows.length} of ${dishes.length}. Clear filters to drag-reorder.` : "Drag rows to reorder. Shortcut: n = new dish, / = search.";
  $("#dish-list").innerHTML =
    rows
      .map(
        (d) => `
      <li draggable="${!filtering}" data-id="${esc(d.id)}" class="${d.is_visible ? "" : "hidden-dish"}">
        <input type="checkbox" class="pick" data-pick="${esc(d.id)}" ${selectedDishes.has(d.id) ? "checked" : ""} aria-label="Select ${esc(dishName(d))}">
        ${filtering ? "" : `<span class="handle" aria-hidden="true">⠿</span>`}
        ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : `<span class="noimg" title="No photo">🍽️</span>`}
        <div class="grow">
          ${nameHtml(d)}
          <small>${esc(cats[d.category] || d.category)} · ${d.price} EGP${d.job_title ? ` · 💼 <span dir="auto">${esc(d.job_title)}</span>` : ""}</small>
          <small>💬 ${d.review_count} reviews · 🧾 ${d.order_qty} ordered</small>
          <span class="meta">${(d.badges || []).map((b) => `<span class="tag">${esc(config.badges[b] || b)}</span>`).join("")}</span>
        </div>
        <div class="row-actions">
          <label class="switch" title="Visible on menu"><input type="checkbox" data-visible="${esc(d.id)}" ${d.is_visible ? "checked" : ""}> 👁</label>
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
}

function syncDishBulk(rows = visibleDishRows()) {
  const n = selectedDishes.size;
  $("#dish-count").textContent = `${n} selected`;
  $$("[data-bulk-dish]").forEach((b) => (b.disabled = n === 0));
  const all = $("#dish-all");
  all.checked = rows.length > 0 && rows.every((d) => selectedDishes.has(d.id));
  all.indeterminate = !all.checked && rows.some((d) => selectedDishes.has(d.id));
}

["#dish-search", "#dish-cat", "#dish-vis"].forEach((sel) => $(sel).addEventListener("input", renderDishes));
$("#dish-all").addEventListener("change", (e) => {
  visibleDishRows().forEach((d) => (e.target.checked ? selectedDishes.add(d.id) : selectedDishes.delete(d.id)));
  renderDishes();
});

async function setVisible(ids, visible) {
  await Promise.all(ids.map((id) => api(`/api/admin/dishes/${id}`, { method: "PUT", body: JSON.stringify({ is_visible: visible }) })));
}

$("#dish-list").addEventListener("change", async (e) => {
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

$$("[data-bulk-dish]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    const ids = [...selectedDishes];
    const action = btn.dataset.bulkDish;
    if (!ids.length) return;
    if (action === "delete" && !confirm(`Delete ${ids.length} dish${ids.length > 1 ? "es" : ""} and all their reviews? This can't be undone.`)) return;
    btn.disabled = true;
    try {
      if (action === "delete") {
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

function openDish(dish) {
  editing = dish || null;
  const f = $("#dish-form");
  f.reset();
  $("#dish-error").textContent = "";
  $("#dish-dialog-title").textContent = dish ? `Edit ${dishName(dish)}` : "New dish";
  if (dish) {
    f.name_ar.value = dish.name_ar;
    f.name_en.value = dish.name_en || "";
    f.description.value = dish.description || "";
    f.price.value = dish.price;
    f.job_title.value = dish.job_title || "";
    f.catchphrase.value = dish.catchphrase || "";
    f.warnings.value = dish.warnings || "";
    f.spice_level.value = dish.spice_level ?? 3;
    f.calories.value = dish.calories || "";
    f.category.value = dish.category;
    f.is_visible.checked = dish.is_visible;
  }
  f.querySelectorAll("[name=badges]").forEach((cb) => (cb.checked = dish ? (dish.badges || []).includes(cb.value) : false));
  setPreview(dish?.photo_url || null);
  $("#dish-dialog").showModal();
}

$("#new-dish").addEventListener("click", () => openDish(null));

function setPreview(url) {
  $("#photo-preview").innerHTML = url ? `<img src="${esc(url)}" alt="">` : "🍽️";
}
$("#dish-form").photo.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) setPreview(URL.createObjectURL(file));
});

const EXAMPLES = [
  { job_title: "Senior Excel Abuser", catchphrase: "خليها بعد الاجتماع", warnings: "passive aggression, 3 coffees, unread emails", description: "Slow-cooked since the 9am standup. يسطا ده aura +1000.", spice_level: 4 },
  { job_title: "Chief Meeting Officer", catchphrase: "let's take this offline", warnings: "calendar invites, no agenda", description: "Could've been an email. Comes with extra slides.", spice_level: 2 },
  { job_title: "Intern (unpaid, vibes only)", catchphrase: "أنا مش فاهم حاجة", warnings: "anxiety, energy drinks", description: "Fresh, eager, slightly undercooked. Will make you coffee.", spice_level: 1 },
  { job_title: "Head of Gossip ☕", catchphrase: "بيقولك…", warnings: "tea, more tea, screenshots", description: "Soaked in gossip. Knows everyone's salary.", spice_level: 5 },
  { job_title: "IT guy who never answers", catchphrase: "did you try restarting it?", warnings: "cables, silence", description: "Grilled on low heat. Replies in 3–5 business days.", spice_level: 3 },
];
$("#dish-ai").addEventListener("click", async (e) => {
  const f = $("#dish-form");
  const btn = e.currentTarget;
  if (!f.name_ar.value.trim() && !f.name_en.value.trim()) return toast("Type a name first", { type: "error" });
  btn.disabled = true;
  btn.textContent = "✨ Cooking…";
  try {
    const out = await api("/api/admin/ai/bio", { method: "POST", body: JSON.stringify({ name_ar: f.name_ar.value, name_en: f.name_en.value, notes: f.description.value }) });
    for (const k of ["job_title", "description", "catchphrase", "warnings", "spice_level"]) if (out[k]) f[k].value = out[k];
    toast("AI wrote it. Check and Save 🫡");
  } catch (err) {
    toast(err.message, { type: "error" });
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ AI write it";
  }
});

$("#dish-example").addEventListener("click", () => {
  const f = $("#dish-form");
  const ex = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
  for (const [k, v] of Object.entries(ex)) f[k].value = v;
});
$("#dish-cancel").addEventListener("click", () => $("#dish-dialog").close());

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
    const saved = editing
      ? await api(`/api/admin/dishes/${editing.id}`, { method: "PUT", body: JSON.stringify(body) })
      : await api("/api/admin/dishes", { method: "POST", body: JSON.stringify(body) });
    const file = f.photo.files[0];
    if (file) {
      const fd = new FormData();
      fd.append("photo", await shrink(file), "photo.jpg");
      await api(`/api/admin/dishes/${saved.id}/photo`, { method: "POST", body: fd });
    }
    $("#dish-dialog").close();
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
async function shrink(file, max = 1200) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), "image/jpeg", 0.85));
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
  const rows = reviews.filter((r) => (!dish || r.dish_id === dish) && (!q || [r.author_name, r.body, r.dish_name].some((x) => String(x || "").toLowerCase().includes(q))));
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
        return `
      <li>
        <input type="checkbox" class="pick" data-pick="${esc(r.id)}" ${selectedReviews.has(r.id) ? "checked" : ""} aria-label="Select review by ${esc(r.author_name)}">
        <div class="grow">
          <strong dir="auto">${esc(r.author_name)}</strong> on <em dir="auto">${esc(r.dish_name)}</em> · ${"🌶️".repeat(r.chili_rating)} · 😬 ${r.awkward_rating}/5
          <p dir="auto">${esc(r.body)}</p>
          <small>${esc(when(r.created_at))}${reactions ? ` · ${reactions}` : ""}</small>
        </div>
        <button class="btn small danger" data-delete-review="${esc(r.id)}">Delete</button>
      </li>`;
      })
      .join("") || `<li class="state">${reviews.length ? "No reviews match these filters." : "No reviews yet. They'll show up here when people start roasting the dishes."}</li>`;
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

["#review-search", "#review-dish", "#review-sort"].forEach((sel) => $(sel).addEventListener("input", renderReviews));
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
  const id = e.target.dataset.deleteReview;
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

async function loadOrders() {
  if (!orders.length) loading("#order-list");
  orders = await api("/api/admin/orders");
  renderOrders();
}

function visibleOrderRows() {
  const q = $("#order-search").value.trim().toLowerCase();
  let since = 0;
  if (orderRange === "today") since = new Date().setHours(0, 0, 0, 0);
  if (orderRange === "7d") since = new Date().setHours(0, 0, 0, 0) - 6 * 24 * 60 * 60 * 1000;
  return orders.filter(
    (o) =>
      (!since || new Date(o.created_at).getTime() >= since) &&
      (!q ||
        String(o.order_number).includes(q.replace(/^#/, "")) ||
        String(o.customer_name || "").toLowerCase().includes(q) ||
        (o.items || []).some((i) => `${i.name_ar} ${i.name_en || ""}`.toLowerCase().includes(q))),
  );
}

function renderOrders() {
  const rows = visibleOrderRows();
  const sum = rows.reduce((s, o) => s + Number(o.total || 0), 0);
  $("#order-summary").textContent = `${rows.length} order${rows.length === 1 ? "" : "s"} · ${egp(sum)}`;
  $("#export-csv").disabled = rows.length === 0;
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
        <button class="btn small danger" data-delete-order="${esc(o.id)}" data-number="${esc(o.order_number)}">Delete</button>
      </li>`,
      )
      .join("") || `<li class="state">${orders.length ? "No orders match. Try another range or search." : "No orders yet."}</li>`;
}

$("#order-search").addEventListener("input", renderOrders);
$$(".seg-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    orderRange = btn.dataset.range;
    $$(".seg-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderOrders();
  }),
);

$("#order-list").addEventListener("click", async (e) => {
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

// Excel needs the BOM to read UTF-8 (Arabic). Prefix formula-like cells so they open as text.
function toCsv(rows) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
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
  const url = URL.createObjectURL(new Blob([toCsv([header, ...data])], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `zesty-orders-${orderRange}-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${rows.length} orders`);
});

$("#reset-board").addEventListener("click", async () => {
  if (!confirm("Reset the leaderboard? Old orders stay in this list.")) return;
  try {
    await api("/api/admin/leaderboard/reset", { method: "POST" });
    toast("Leaderboard reset 🏆");
  } catch (err) {
    fail(err);
  }
});

// ---- Keyboard ----
document.addEventListener("keydown", (e) => {
  const dialog = $("#dish-dialog");
  if (e.key === "Escape" && dialog.open) return dialog.close();
  const typing = e.target.closest?.("input, textarea, select, [contenteditable]");
  if (typing || dialog.open || $("#panel").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "n") {
    e.preventDefault();
    openDish(null);
  } else if (e.key === "/") {
    const search = $(`#tab-${currentTab} input[type=search]`);
    if (search) {
      e.preventDefault();
      search.focus();
    }
  }
});

// ---- Boot ----
(async () => {
  try {
    config = await api("/api/config");
  } catch (err) {
    return toast(err.message, { type: "error", ms: 20000 });
  }
  $("#category-select").innerHTML = config.categories.map((c) => `<option value="${esc(c.slug)}">${c.emoji} ${esc(c.en)} / ${esc(c.ar)}</option>`).join("");
  $("#dish-cat").innerHTML += config.categories.map((c) => `<option value="${esc(c.slug)}">${c.emoji} ${esc(c.en)}</option>`).join("");
  $("#badge-boxes").innerHTML = Object.entries(config.badges).map(([b, label]) => `<label class="inline"><input type="checkbox" name="badges" value="${esc(b)}"> ${esc(label)}</label>`).join("");
  try {
    await showPanel();
  } catch (err) {
    if (err.status === 401) showLogin();
    else toast(err.message, { type: "error", ms: 20000 });
  }
})();
