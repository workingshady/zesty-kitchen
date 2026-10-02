const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const sharp = require("sharp");
const menu = require("../menu");
const v = require("../validate");
const auth = require("../auth");

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

function adminRouter(db, { password, sessionSecret, secureCookies }) {
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

  router.post("/logout", (req, res) => {
    res.clearCookie(auth.COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/dishes", async (req, res) => {
    const dishes = await db.listDishes();
    res.json(dishes.map((d) => ({ ...d, price: Number(d.price), photo_url: db.photoUrl(d.photo_path) })));
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

  router.post("/leaderboard/reset", async (req, res) => {
    const since = new Date().toISOString();
    await db.setSetting("leaderboard_since", since);
    res.json({ ok: true, since });
  });

  return router;
}

module.exports = { adminRouter };
