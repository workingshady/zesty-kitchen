const $ = (sel) => document.querySelector(sel);
let config = null;
let dishes = [];
let editing = null;

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

function showLogin() {
  $("#login").hidden = false;
  $("#panel").hidden = true;
  $("#logout").hidden = true;
}

async function showPanel() {
  $("#login").hidden = true;
  $("#panel").hidden = false;
  $("#logout").hidden = false;
  await loadDishes();
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

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${tab.dataset.tab}`));
    ({ dishes: loadDishes, reviews: loadReviews, orders: loadOrders })[tab.dataset.tab]();
  }),
);

// ---- Dishes ----
async function loadDishes() {
  dishes = await api("/api/admin/dishes");
  const cats = Object.fromEntries(config.categories.map((c) => [c.slug, `${c.emoji} ${c.en}`]));
  $("#dish-list").innerHTML = dishes
    .map(
      (d) => `
      <li draggable="true" data-id="${d.id}" class="${d.is_visible ? "" : "hidden-dish"}">
        <span class="handle" aria-hidden="true">⠿</span>
        ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="">` : `<span class="noimg">🍽️</span>`}
        <div class="grow">
          <strong>${esc(d.name_ar)}</strong>${d.name_en ? ` · ${esc(d.name_en)}` : ""}
          <small>${esc(cats[d.category] || d.category)} · ${d.price} EGP${d.job_title ? ` · 💼 ${esc(d.job_title)}` : ""} ${d.is_visible ? "" : "· 🙈 hidden"}</small>
          <span class="meta">${(d.badges || []).map((b) => `<span class="tag">${esc(config.badges[b] || b)}</span>`).join("")}</span>
        </div>
        <button class="btn small" data-edit="${d.id}">Edit</button>
        <button class="btn small danger" data-delete="${d.id}">Delete</button>
      </li>`,
    )
    .join("");
}

$("#dish-list").addEventListener("click", async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) openDish(dishes.find((d) => d.id === editId));
  if (deleteId) {
    const d = dishes.find((x) => x.id === deleteId);
    if (!confirm(`Delete "${d.name_en}" and all its reviews?`)) return;
    await api(`/api/admin/dishes/${deleteId}`, { method: "DELETE" });
    loadDishes();
  }
});

// Drag to reorder
let dragged = null;
$("#dish-list").addEventListener("dragstart", (e) => {
  dragged = e.target.closest("li");
  dragged.classList.add("dragging");
});
$("#dish-list").addEventListener("dragover", (e) => {
  e.preventDefault();
  const over = e.target.closest("li");
  if (!over || over === dragged) return;
  const rect = over.getBoundingClientRect();
  over.parentNode.insertBefore(dragged, e.clientY > rect.top + rect.height / 2 ? over.nextSibling : over);
});
$("#dish-list").addEventListener("dragend", async () => {
  dragged.classList.remove("dragging");
  dragged = null;
  const ids = [...document.querySelectorAll("#dish-list li")].map((li) => li.dataset.id);
  await api("/api/admin/dishes/order", { method: "PUT", body: JSON.stringify({ ids }) });
});

function openDish(dish) {
  editing = dish || null;
  const f = $("#dish-form");
  f.reset();
  $("#dish-error").textContent = "";
  $("#dish-dialog-title").textContent = dish ? `Edit ${dish.name_en}` : "New dish";
  if (dish) {
    f.name_ar.value = dish.name_ar;
    f.name_en.value = dish.name_en;
    f.description.value = dish.description;
    f.price.value = dish.price;
    f.job_title.value = dish.job_title || "";
    f.catchphrase.value = dish.catchphrase || "";
    f.warnings.value = dish.warnings || "";
    f.spice_level.value = dish.spice_level ?? 3;
    f.calories.value = dish.calories || "";
    f.category.value = dish.category;
    f.is_visible.checked = dish.is_visible;
  }
  f.querySelectorAll("[name=badges]").forEach((cb) => (cb.checked = dish ? dish.badges.includes(cb.value) : false));
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
    loadDishes();
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
  const reviews = await api("/api/admin/reviews");
  $("#review-list").innerHTML =
    reviews
      .map(
        (r) => `
      <li>
        <div class="grow">
          <strong>${esc(r.author_name)}</strong> on <em>${esc(r.dish_name)}</em> · ${"🌶️".repeat(r.chili_rating)}
          <p dir="auto">${esc(r.body)}</p>
          <small>${new Date(r.created_at).toLocaleString()}</small>
        </div>
        <button class="btn small danger" data-delete-review="${r.id}">Delete</button>
      </li>`,
      )
      .join("") || "<li>No reviews yet.</li>";
}

$("#review-list").addEventListener("click", async (e) => {
  const id = e.target.dataset.deleteReview;
  if (!id || !confirm("Delete this review?")) return;
  await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
  loadReviews();
});

// ---- Orders ----
async function loadOrders() {
  const orders = await api("/api/admin/orders");
  $("#order-list").innerHTML =
    orders
      .map(
        (o) => `
      <li>
        <div class="grow">
          <strong>#${o.order_number}</strong> by ${esc(o.customer_name)} · ${o.total} EGP · ${esc(o.payment_method)}
          <p>${o.items.map((i) => `${i.qty}× ${esc(i.name_en)} (${esc(i.size)})`).join(", ")}</p>
          ${o.note ? `<p dir="auto">📝 ${esc(o.note)}</p>` : ""}
          <small>${new Date(o.created_at).toLocaleString()}</small>
        </div>
      </li>`,
      )
      .join("") || "<li>No orders yet.</li>";
}

$("#reset-board").addEventListener("click", async () => {
  if (!confirm("Reset the leaderboard? Old orders stay in this list.")) return;
  await api("/api/admin/leaderboard/reset", { method: "POST" });
  alert("Leaderboard reset 🏆");
});

// ---- Boot ----
(async () => {
  config = await api("/api/config");
  $("#category-select").innerHTML = config.categories.map((c) => `<option value="${c.slug}">${c.emoji} ${c.en} / ${c.ar}</option>`).join("");
  $("#badge-boxes").innerHTML = Object.entries(config.badges).map(([b, label]) => `<label class="inline"><input type="checkbox" name="badges" value="${b}"> ${label}</label>`).join("");
  try {
    await showPanel();
  } catch (err) {
    if (err.status === 401) showLogin();
    else alert(err.message);
  }
})();
