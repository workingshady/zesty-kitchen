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

// Dashboard numbers in one pass over orders and one over reviews
function computeStats({ dishes, reviews, orders, tz, now = Date.now(), photoUrl }) {
  const dayOf = dayKeyer(tz);
  const today = dayOf(now);
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(dayOf(now - i * 24 * 60 * 60 * 1000));
  const perDay = new Map(days.map((d) => [d, 0]));

  const qty = new Map();
  const itemNames = new Map();
  const payments = {};
  let revenue = 0;
  let ordersToday = 0;
  for (const o of orders) {
    const day = dayOf(o.created_at);
    if (day === today) ordersToday++;
    if (perDay.has(day)) perDay.set(day, perDay.get(day) + 1);
    revenue += Number(o.total) || 0;
    payments[o.payment_method] = (payments[o.payment_method] || 0) + 1;
    for (const item of o.items || []) {
      qty.set(item.dish_id, (qty.get(item.dish_id) || 0) + (Number(item.qty) || 0));
      if (!itemNames.has(item.dish_id)) itemNames.set(item.dish_id, item.name_en || item.name_ar);
    }
  }

  const byId = new Map(dishes.map((d) => [d.id, d]));
  let chiliSum = 0;
  for (const r of reviews) chiliSum += Number(r.chili_rating) || 0;

  const visible = dishes.filter((d) => d.is_visible).length;
  const attention = [];
  for (const d of dishes) {
    const issues = [];
    if (!d.photo_path) issues.push("no_photo");
    if (!String(d.description || "").trim()) issues.push("no_description");
    if (!d.is_visible) issues.push("hidden");
    if (issues.length) attention.push({ id: d.id, name_ar: d.name_ar, name_en: d.name_en || "", issues });
  }

  const topPayment = Object.entries(payments).sort((a, b) => b[1] - a[1])[0];
  return {
    total_orders: orders.length,
    orders_today: ordersToday,
    revenue: round2(revenue),
    avg_order_value: orders.length ? round2(revenue / orders.length) : 0,
    reviews_count: reviews.length,
    avg_chili: reviews.length ? Math.round((chiliSum / reviews.length) * 10) / 10 : null,
    dishes_total: dishes.length,
    dishes_visible: visible,
    dishes_hidden: dishes.length - visible,
    dishes_without_photo: dishes.filter((d) => !d.photo_path).length,
    top_dishes: [...qty.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => {
        const d = byId.get(id);
        return { id, name: d ? dishLabel(d) : itemNames.get(id) || "?", deleted: !d, photo_url: d ? photoUrl(d.photo_path) : null, qty: n };
      }),
    orders_per_day: days.map((day) => ({ day, count: perDay.get(day) })),
    payment_methods: payments,
    top_payment_method: topPayment ? { method: topPayment[0], count: topPayment[1] } : null,
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

  // Copy without the photo (two dishes sharing one file would break when either is deleted). Starts hidden.
  router.post("/dishes/:id/duplicate", async (req, res) => {
    const src = await db.getDish(req.params.id);
    if (!src) return res.status(404).json({ error: "Dish not found" });
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
    res.status(201).json({ ...dish, price: Number(dish.price), photo_url: null });
  });

  router.delete("/dishes/:id", async (req, res) => {
    const dish = await db.getDish(req.params.id);
    if (!dish) return res.status(404).json({ error: "Dish not found" });
    await db.deleteDish(dish.id);
    if (dish.photo_path) await db.deletePhoto(dish.photo_path);
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
    const [reviews, dishes] = await Promise.all([db.listReviews(), db.listDishes()]);
    const names = new Map(dishes.map((d) => [d.id, d.name_en]));
    res.json(reviews.map((r) => ({ ...r, dish_name: names.get(r.dish_id) || "?" })));
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

  router.post("/leaderboard/reset", async (req, res) => {
    const since = new Date().toISOString();
    await db.setSetting("leaderboard_since", since);
    res.json({ ok: true, since });
  });

  return router;
}

module.exports = { adminRouter, computeStats };
