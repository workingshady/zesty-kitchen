const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const sharp = require("sharp");
const menu = require("../menu");
const v = require("../validate");
const auth = require("../auth");
const { aiAdminRouter } = require("./ai-admin");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : v.bad("Photo must be JPG, PNG, WebP or GIF"), ok);
  },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait 15 minutes." },
});

const round2 = (n) => Math.round(n * 100) / 100;
const dishLabel = (d) => d.name_en || d.name_ar;

// "YYYY-MM-DD" in the admin's time zone, so "today" matches their wall clock
function dayKeyer(tz) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return (date) => fmt.format(new Date(date));
}

function hourKeyer(tz) {
  const opts = { hour: "2-digit", hourCycle: "h23" };
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz || "Africa/Cairo" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "Africa/Cairo" });
  }
  return (date) => Number(fmt.format(new Date(date))) % 24;
}

const firstName = (name) => {
  const first = String(name || "").trim().split(/\s+/)[0] || "?";
  return first.charAt(0).toLocaleUpperCase() + first.slice(1);
};

/** Order numbers for any slice of orders: revenue, top dishes, top customers (first names only), busiest hour. */
function orderSummary(orders, { tz, dishes = [], photoUrl = () => null } = {}) {
  const hourOf = hourKeyer(tz);
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const qty = new Map();
  const itemNames = new Map();
  const payments = {};
  const customers = new Map();
  const perHour = Array(24).fill(0);
  let revenue = 0;
  for (const o of orders) {
    const total = Number(o.total) || 0;
    revenue += total;
    payments[o.payment_method] = (payments[o.payment_method] || 0) + 1;
    perHour[hourOf(o.created_at)]++;
    const first = firstName(o.customer_name);
    const key = first.toLowerCase();
    const c = customers.get(key) || { name: first, orders: 0, total: 0 };
    c.orders++;
    c.total += total;
    customers.set(key, c);
    for (const item of o.items || []) {
      qty.set(item.dish_id, (qty.get(item.dish_id) || 0) + (Number(item.qty) || 0));
      if (!itemNames.has(item.dish_id)) itemNames.set(item.dish_id, item.name_en || item.name_ar);
    }
  }
  const topPayment = Object.entries(payments).sort((a, b) => b[1] - a[1])[0];
  const peak = perHour.reduce((best, n, h) => (n > best.count ? { hour: h, count: n } : best), { hour: null, count: 0 });
  return {
    count: orders.length,
    revenue: round2(revenue),
    avg_order_value: orders.length ? round2(revenue / orders.length) : 0,
    payments,
    top_payment_method: topPayment ? { method: topPayment[0], count: topPayment[1] } : null,
    top_dishes: [...qty.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => {
        const d = byId.get(id);
        return { id, name: d ? dishLabel(d) : itemNames.get(id) || "?", deleted: !d, photo_url: d ? photoUrl(d.photo_path) : null, qty: n };
      }),
    top_customers: [...customers.values()]
      .sort((a, b) => b.orders - a.orders || b.total - a.total)
      .slice(0, 5)
      .map((c) => ({ ...c, total: round2(c.total) })),
    busiest_hour: peak.count ? peak : null,
    orders_per_hour: perHour,
  };
}

/** Last `n` day keys (oldest first) in the admin's time zone. */
function lastDays(n, tz, now = Date.now()) {
  const dayOf = dayKeyer(tz);
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(dayOf(now - i * 24 * 60 * 60 * 1000));
  return days;
}

const RANGES = { today: 1, "7d": 7, "30d": 30, all: Infinity };
/** Orders inside a named range ("today", "7d", "30d", "all"), by calendar day in `tz`. */
function ordersInRange(orders, range, tz, now = Date.now()) {
  const n = RANGES[range] ?? Infinity;
  if (n === Infinity) return orders;
  const keep = new Set(lastDays(n, tz, now));
  const dayOf = dayKeyer(tz);
  return orders.filter((o) => keep.has(dayOf(o.created_at)));
}

// Dashboard numbers in one pass over orders and one over reviews
function computeStats({ dishes, reviews, orders, tz, now = Date.now(), photoUrl }) {
  const dayOf = dayKeyer(tz);
  const days = lastDays(14, tz, now);
  const today = days[days.length - 1];
  const week = new Set(days.slice(-7));
  const perDay = new Map(days.map((d) => [d, { count: 0, revenue: 0 }]));
  let ordersToday = 0;
  let orders7d = 0;
  let revenueToday = 0;
  let revenue7d = 0;
  for (const o of orders) {
    const day = dayOf(o.created_at);
    const total = Number(o.total) || 0;
    if (day === today) (ordersToday++, (revenueToday += total));
    if (week.has(day)) (orders7d++, (revenue7d += total));
    const slot = perDay.get(day);
    if (slot) (slot.count++, (slot.revenue += total));
  }
  const summary = orderSummary(orders, { tz, dishes, photoUrl });

  const byId = new Map(dishes.map((d) => [d.id, d]));
  let chiliSum = 0;
  const chili = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const perDish = new Map();
  for (const r of reviews) {
    const c = Number(r.chili_rating) || 0;
    chiliSum += c;
    if (chili[c] !== undefined) chili[c]++;
    const p = perDish.get(r.dish_id) || { sum: 0, n: 0 };
    p.sum += c;
    p.n++;
    perDish.set(r.dish_id, p);
  }
  const rated = [...perDish.entries()]
    .filter(([id]) => byId.has(id))
    .map(([id, p]) => ({ id, name: dishLabel(byId.get(id)), avg: Math.round((p.sum / p.n) * 10) / 10, reviews: p.n }));
  const byAvg = (a, b) => b.avg - a.avg || b.reviews - a.reviews;

  const visible = dishes.filter((d) => d.is_visible).length;
  const attention = [];
  for (const d of dishes) {
    const issues = [];
    if (!d.photo_path) issues.push("no_photo");
    if (!String(d.description || "").trim()) issues.push("no_description");
    if (!d.is_visible) issues.push("hidden");
    if (issues.length) attention.push({ id: d.id, name_ar: d.name_ar, name_en: d.name_en || "", issues });
  }

  return {
    total_orders: orders.length,
    orders_today: ordersToday,
    orders_7d: orders7d,
    revenue: summary.revenue,
    revenue_today: round2(revenueToday),
    revenue_7d: round2(revenue7d),
    avg_order_value: summary.avg_order_value,
    reviews_count: reviews.length,
    avg_chili: reviews.length ? Math.round((chiliSum / reviews.length) * 10) / 10 : null,
    chili_distribution: chili,
    best_rated: [...rated].sort(byAvg).slice(0, 3),
    // Worst never repeats a dish already listed as best (matters when only a few dishes have reviews)
    worst_rated: [...rated].sort((a, b) => byAvg(b, a)).filter((d) => ![...rated].sort(byAvg).slice(0, 3).some((x) => x.id === d.id)).slice(0, 3),
    dishes_total: dishes.length,
    dishes_visible: visible,
    dishes_hidden: dishes.length - visible,
    dishes_without_photo: dishes.filter((d) => !d.photo_path).length,
    top_dishes: summary.top_dishes,
    top_customers: summary.top_customers,
    busiest_hour: summary.busiest_hour,
    orders_per_hour: summary.orders_per_hour,
    orders_per_day: days.map((day) => ({ day, count: perDay.get(day).count, revenue: round2(perDay.get(day).revenue) })),
    payment_methods: summary.payments,
    top_payment_method: summary.top_payment_method,
    latest_reviews: reviews.slice(0, 5).map((r) => ({ ...r, dish_name: byId.has(r.dish_id) ? dishLabel(byId.get(r.dish_id)) : "?" })),
    needs_attention: attention,
  };
}

function dishFields(body, { partial }) {
  const b = body || {};
  const out = {};
  const has = (k) => b[k] !== undefined;
  if (!partial || has("name_ar")) out.name_ar = v.text(b.name_ar, "Arabic name", { max: 60 });
  if (!partial || has("name_en")) out.name_en = v.text(b.name_en ?? "", "English name", { min: 0, max: 60 });
  if (!partial || has("job_title")) out.job_title = v.text(b.job_title ?? "", "job title", { min: 0, max: 80 });
  if (!partial || has("catchphrase")) out.catchphrase = v.text(b.catchphrase ?? "", "catchphrase", { min: 0, max: 140 });
  if (!partial || has("warnings")) out.warnings = v.text(b.warnings ?? "", "warnings", { min: 0, max: 200 });
  if (!partial || has("spice_level")) out.spice_level = v.int(b.spice_level ?? 3, "spice level", 1, 5);
  if (!partial || has("calories")) out.calories = v.int(b.calories ?? 0, "calories", 0, 999999);
  if (!partial || has("description")) out.description = v.text(b.description ?? "", "description", { min: 0, max: 500 });
  if (!partial || has("price")) out.price = v.price(b.price, "price");
  if (!partial || has("category")) out.category = v.oneOf(b.category, "category", menu.CATEGORIES.map((c) => c.slug));
  if (!partial || has("badges")) {
    const badges = Array.isArray(b.badges) ? [...new Set(b.badges)] : [];
    badges.forEach((x) => v.oneOf(x, "badge", menu.BADGES));
    out.badges = badges;
  }
  if (has("is_visible")) out.is_visible = Boolean(b.is_visible);
  return out;
}

const withPhoto = (db, d) => ({ ...d, price: Number(d.price), photo_url: db.photoUrl(d.photo_path) });

// Copy without the photo (two dishes sharing one file would break when either is deleted). Starts hidden.
async function duplicateDish(db, id) {
  const src = await db.getDish(id);
  if (!src) return null;
  const dishes = await db.listDishes();
  const copy = (name, max) => (name ? `${name.slice(0, max - 7).trim()} (copy)` : "");
  const fields = {
    ...dishFields({ ...src, price: Number(src.price) }, { partial: false }),
    name_ar: copy(src.name_ar, 60),
    name_en: copy(src.name_en, 60),
    is_visible: false,
    sort_order: dishes.length,
  };
  const dish = await db.createDish(fields);
  return { ...dish, price: Number(dish.price), photo_url: null };
}

/** Deletes the dish, its reviews (store-level cascade) and its photo. Returns the deleted dish or null. */
async function deleteDishFully(db, id) {
  const dish = await db.getDish(id);
  if (!dish) return null;
  await db.deleteDish(dish.id);
  if (dish.photo_path) await db.deletePhoto(dish.photo_path);
  return dish;
}

/** Applies one partial update (validated like PUT /dishes/:id) plus badge add/remove to many dishes. */
async function bulkUpdateDishes(db, ids, { fields = {}, addBadges = [], removeBadges = [] } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some((id) => typeof id !== "string")) throw v.bad("ids must be a list (1–200)");
  const base = dishFields(fields, { partial: true });
  [...addBadges, ...removeBadges].forEach((b) => v.oneOf(b, "badge", menu.BADGES));
  const updated = [];
  const missing = [];
  for (const id of ids) {
    const dish = await db.getDish(id);
    if (!dish) {
      missing.push(id);
      continue;
    }
    const patch = { ...base };
    if (addBadges.length || removeBadges.length) {
      const set = new Set(patch.badges || dish.badges || []);
      addBadges.forEach((b) => set.add(b));
      removeBadges.forEach((b) => set.delete(b));
      patch.badges = [...set];
    }
    if (!Object.keys(patch).length) throw v.bad("skill issue: nothing to change");
    updated.push(await db.updateDish(id, patch));
  }
  return { updated, missing };
}

const HIGHLIGHT_KEY = "highlighted_reviews";
async function highlightedReviews(db) {
  const list = await db.getSetting(HIGHLIGHT_KEY).catch(() => null);
  return Array.isArray(list) ? list.map(String) : [];
}

// Imports and backups can be bigger than the app-wide 100 KB JSON limit
const IMPORT_TYPE = "application/vnd.zk-import+json";
const importJson = express.json({ type: IMPORT_TYPE, limit: "2mb" });

function adminRouter(db, { password, sessionSecret, secureCookies, ai }) {
  const router = express.Router();

  router.post("/login", loginLimiter, (req, res) => {
    if (!auth.checkPassword(req.body?.password ?? "", password)) {
      return res.status(401).json({ error: "Wrong password. NPC behavior 🤖" });
    }
    res.cookie(auth.COOKIE_NAME, auth.createToken(sessionSecret), {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "strict",
      maxAge: auth.MAX_AGE_MS,
      path: "/",
    });
    res.json({ ok: true });
  });

  router.use((req, res, next) => {
    if (auth.isValidToken(req.cookies?.[auth.COOKIE_NAME], sessionSecret)) return next();
    res.status(401).json({ error: "Not logged in" });
  });

  if (ai) router.use("/ai", aiAdminRouter(ai));
  // Required here (not at the top) because chef-agent.js reuses this file's helpers
  const { chefAgentRouter } = require("./chef-agent");
  router.use("/agent", chefAgentRouter(db, ai, { secret: sessionSecret }));

  router.post("/logout", (req, res) => {
    res.clearCookie(auth.COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/stats", async (req, res) => {
    const [dishes, reviews, orders] = await Promise.all([db.listDishes(), db.listReviews(), db.listOrders()]);
    const tz = typeof req.query.tz === "string" ? req.query.tz.slice(0, 64) : undefined;
    res.json(computeStats({ dishes, reviews, orders, tz, photoUrl: (p) => db.photoUrl(p) }));
  });

  router.get("/dishes", async (req, res) => {
    const [dishes, reviews, orders] = await Promise.all([db.listDishes(), db.listReviews(), db.listOrders()]);
    const reviewCount = new Map();
    for (const r of reviews) reviewCount.set(r.dish_id, (reviewCount.get(r.dish_id) || 0) + 1);
    const orderQty = new Map();
    for (const o of orders) for (const i of o.items || []) orderQty.set(i.dish_id, (orderQty.get(i.dish_id) || 0) + (Number(i.qty) || 0));
    res.json(
      dishes.map((d) => ({
        ...d,
        price: Number(d.price),
        photo_url: db.photoUrl(d.photo_path),
        review_count: reviewCount.get(d.id) || 0,
        order_qty: orderQty.get(d.id) || 0,
      })),
    );
  });

  router.post("/dishes", async (req, res) => {
    const dishes = await db.listDishes();
    const dish = await db.createDish({ ...dishFields(req.body, { partial: false }), sort_order: dishes.length });
    res.status(201).json(dish);
  });

  // Must come before /dishes/:id so "order" isn't treated as an id
  router.put("/dishes/order", async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw v.bad("ids must be a list");
    await db.reorderDishes(ids);
    res.json({ ok: true });
  });

  router.put("/dishes/:id", async (req, res) => {
    const dish = await db.updateDish(req.params.id, dishFields(req.body, { partial: true }));
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    res.json(dish);
  });

  // Same partial update for many dishes: bulk category change, badge add/remove, visibility
  router.post("/dishes/bulk", async (req, res) => {
    const b = req.body || {};
    const list = (x) => (Array.isArray(x) ? x.map(String) : []);
    const { updated, missing } = await bulkUpdateDishes(db, b.ids, { fields: b.fields || {}, addBadges: list(b.add_badges), removeBadges: list(b.remove_badges) });
    res.json({ ok: true, updated: updated.length, missing });
  });

  // Import dishes from a JSON backup (or a hand-written list). Validates everything before writing anything.
  router.post("/dishes/import", importJson, async (req, res) => {
    const b = req.body || {};
    const list = Array.isArray(b) ? b : Array.isArray(b.dishes) ? b.dishes : null;
    if (!list || !list.length) throw v.bad("skill issue: send { dishes: [...] }");
    if (list.length > 300) throw v.bad("skill issue: max 300 dishes per import");
    const clean = list.map((d, i) => {
      try {
        return dishFields({ ...d, price: d?.price === undefined ? d?.price : Number(d.price) }, { partial: false });
      } catch (err) {
        throw v.bad(`Dish #${i + 1} (${String(d?.name_ar || d?.name_en || "no name").slice(0, 40)}): ${err.message}`);
      }
    });
    const existing = await db.listDishes();
    const skip = b.skip_existing !== false;
    const names = new Set(existing.map((d) => String(d.name_ar).trim().toLowerCase()));
    let created = 0;
    let skipped = 0;
    for (const fields of clean) {
      const key = fields.name_ar.toLowerCase();
      if (skip && names.has(key)) {
        skipped++;
        continue;
      }
      names.add(key);
      await db.createDish({ ...fields, sort_order: existing.length + created });
      created++;
    }
    res.json({ ok: true, created, skipped });
  });

  router.post("/dishes/:id/duplicate", async (req, res) => {
    const dish = await duplicateDish(db, req.params.id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    res.status(201).json(dish);
  });

  router.delete("/dishes/:id", async (req, res) => {
    const dish = await deleteDishFully(db, req.params.id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    res.json({ ok: true });
  });

  router.post("/dishes/:id/photo", upload.single("photo"), async (req, res) => {
    const dish = await db.getDish(req.params.id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    if (!req.file) throw v.bad("No photo uploaded");
    let webp;
    try {
      webp = await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw v.bad("That file isn't a readable image");
    }
    const oldPath = dish.photo_path;
    const path = `${dish.id}/${crypto.randomUUID()}.webp`;
    await db.uploadPhoto(path, webp, "image/webp");
    await db.updateDish(dish.id, { photo_path: path });
    if (oldPath) await db.deletePhoto(oldPath);
    res.json({ photo_url: db.photoUrl(path) });
  });

  router.get("/reviews", async (req, res) => {
    const [reviews, dishes, starred] = await Promise.all([db.listReviews(), db.listDishes(), highlightedReviews(db)]);
    const byId = new Map(dishes.map((d) => [d.id, d]));
    const hl = new Set(starred);
    res.json(
      reviews.map((r) => {
        const d = byId.get(r.dish_id);
        return { ...r, dish_name: d ? dishLabel(d) : "?", dish_visible: Boolean(d?.is_visible), highlighted: hl.has(r.id) };
      }),
    );
  });

  // ⭐ Highlight a review (admin bookmark, stored as a setting so no schema change is needed)
  router.post("/reviews/:id/highlight", async (req, res) => {
    const id = String(req.params.id);
    const on = req.body?.on !== false;
    const exists = (await db.listReviews()).some((r) => r.id === id);
    if (!exists) return res.status(404).json({ error: "Review not found" });
    const set = new Set(await highlightedReviews(db));
    on ? set.add(id) : set.delete(id);
    await db.setSetting(HIGHLIGHT_KEY, [...set].slice(-500));
    res.json({ ok: true, highlighted: on });
  });

  router.delete("/reviews/:id", async (req, res) => {
    const ok = await db.deleteReview(req.params.id);
    if (!ok) return res.status(404).json({ error: "Review not found" });
    res.json({ ok: true });
  });

  router.get("/orders", async (req, res) => {
    res.json(await db.listOrders());
  });

  router.delete("/orders/:id", async (req, res) => {
    const ok = await db.deleteOrder(req.params.id);
    if (!ok) return res.status(404).json({ error: "Order not found" });
    res.json({ ok: true });
  });

  // Optional { since }: count the leaderboard from a past date instead of "now"
  router.post("/leaderboard/reset", async (req, res) => {
    const raw = req.body?.since;
    let since = new Date().toISOString();
    if (raw !== undefined && raw !== null && raw !== "") {
      const t = new Date(String(raw)).getTime();
      if (!Number.isFinite(t) || t > Date.now() + 60_000 || t < Date.parse("2020-01-01")) throw v.bad("skill issue: since must be a real date, not in the future");
      since = new Date(t).toISOString();
    }
    await db.setSetting("leaderboard_since", since);
    res.json({ ok: true, since });
  });

  router.get("/settings", async (req, res) => {
    const [since, starred] = await Promise.all([db.getSetting("leaderboard_since"), highlightedReviews(db)]);
    const diag = ai?.diagnostics ? ai.diagnostics() : null;
    res.json({
      leaderboard_since: since || null,
      highlighted_reviews: starred.length,
      store: db.kind,
      ai: { enabled: Boolean(ai?.enabled), cap: diag?.cap ?? null, used_today: diag?.usage?.count ?? 0 },
    });
  });

  // Full JSON backup: dishes (photo paths, not bytes), reviews, orders, settings
  router.get("/export", async (req, res) => {
    const [dishes, reviews, orders, since, starred] = await Promise.all([db.listDishes(), db.listReviews(), db.listOrders(), db.getSetting("leaderboard_since"), highlightedReviews(db)]);
    const day = new Date().toISOString().slice(0, 10);
    res.set("Content-Disposition", `attachment; filename="zesty-backup-${day}.json"`);
    res.json({
      app: "zesty-kitchen",
      version: 1,
      exported_at: new Date().toISOString(),
      dishes: dishes.map((d) => withPhoto(db, d)),
      reviews,
      orders,
      settings: { leaderboard_since: since || null, highlighted_reviews: starred },
    });
  });

  return router;
}

module.exports = {
  adminRouter,
  computeStats,
  orderSummary,
  ordersInRange,
  dayKeyer,
  dishFields,
  dishLabel,
  duplicateDish,
  deleteDishFully,
  bulkUpdateDishes,
  withPhoto,
  RANGES,
  IMPORT_TYPE,
};
