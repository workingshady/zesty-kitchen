const express = require("express");
const rateLimit = require("express-rate-limit");
const menu = require("../menu");
const { cleanText } = require("../filter");
const v = require("../validate");
const { createOrder, ORDER_RATE } = require("../orders");
const { getStats } = require("../stats");

const limiter = (windowMin, limit) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "اهدى habibi 😤 too many requests, try again in a bit" },
  });

const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

/** Top 5 + worst seller (shape used by the agent and GET /api/leaderboard), from the cached stats. */
async function leaderboard(db) {
  const stats = await getStats(db);
  const slim = (r) => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en, photo_url: r.photo_url, orders: r.orders_qty });
  return {
    top: stats.ranking.filter((r) => r.orders_qty > 0).slice(0, 5).map(slim),
    worst: stats.worst ? slim(stats.worst) : null,
    total_orders: stats.board_orders,
  };
}

function publicDish(db, dish, reviews) {
  const mine = reviews.filter((r) => r.dish_id === dish.id);
  return {
    id: dish.id,
    name_ar: dish.name_ar,
    name_en: dish.name_en,
    description: dish.description,
    price: Number(dish.price),
    category: dish.category,
    badges: dish.badges,
    job_title: dish.job_title || "",
    catchphrase: dish.catchphrase || "",
    warnings: dish.warnings || "",
    spice_level: dish.spice_level ?? 3,
    calories: dish.calories ?? 0,
    photo_url: db.photoUrl(dish.photo_path),
    review_count: mine.length,
    avg_chili: avg(mine.map((r) => r.chili_rating)),
  };
}

function publicRouter(db) {
  const router = express.Router();

  router.get("/config", (req, res) => {
    const { CATEGORIES, SIZES, ADDONS, PAYMENT_METHODS, REACTIONS, BADGE_LABELS } = menu;
    res.json({ categories: CATEGORIES, badges: BADGE_LABELS, sizes: SIZES, addons: ADDONS, payment_methods: PAYMENT_METHODS, reactions: REACTIONS, fees: menu.computeFees(0).fees });
  });

  router.get("/dishes", async (req, res) => {
    const [dishes, reviews, stats] = await Promise.all([db.listDishes(), db.listReviews(), getStats(db)]);
    const top = stats.ranking[0];
    const topId = top?.orders_qty > 0 ? top.id : null;
    res.json(
      dishes
        .filter((d) => d.is_visible)
        .map((d) => ({ ...publicDish(db, d, reviews), orders_qty: stats.dishes[d.id]?.orders_qty_all_time || 0, most_ordered: d.id === topId })),
    );
  });

  router.get("/dishes/:id", async (req, res) => {
    const dish = await db.getDish(req.params.id).catch(() => null);
    if (!dish || !dish.is_visible) return res.status(404).json({ error: "Dish not found. Maybe they quit? 💀" });
    const reviews = await db.listReviews(dish.id);
    res.json({ ...publicDish(db, dish, reviews), reviews });
  });

  router.post("/dishes/:id/reviews", limiter(10, 5), async (req, res) => {
    const dish = await db.getDish(req.params.id).catch(() => null);
    if (!dish || !dish.is_visible) return res.status(404).json({ error: "Dish not found" });
    const b = req.body || {};
    const review = await db.createReview({
      dish_id: dish.id,
      author_name: cleanText(v.text(b.author_name, "name", { max: 40 })),
      chili_rating: v.int(b.chili_rating, "chili rating", 1, 5),
      awkward_rating: v.int(b.awkward_rating, "awkward rating", 1, 5),
      body: cleanText(v.text(b.body, "review", { max: 500 })),
    });
    res.status(201).json(review);
  });

  router.post("/reviews/:id/react", limiter(1, 30), async (req, res) => {
    const emoji = v.oneOf(req.body?.emoji, "emoji", menu.REACTIONS);
    const review = await db.reactToReview(req.params.id, emoji).catch(() => null);
    if (!review) return res.status(404).json({ error: "Review not found" });
    res.json({ reactions: review.reactions });
  });

  router.post("/orders", limiter(ORDER_RATE.windowMin, ORDER_RATE.limit), async (req, res) => {
    res.status(201).json(await createOrder(db, req.body || {}));
  });

  router.get("/leaderboard", async (req, res) => {
    res.json(await leaderboard(db));
  });

  // Real aggregates only (no notes / phones / full names). Cached ~30s, refreshed on new orders.
  router.get("/stats", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await getStats(db));
  });

  return router;
}

module.exports = { publicRouter, leaderboard, publicDish };
