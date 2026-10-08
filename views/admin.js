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
  syncDraftChip();
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
