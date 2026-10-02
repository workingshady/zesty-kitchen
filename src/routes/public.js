const express = require("express");
const rateLimit = require("express-rate-limit");
const menu = require("../menu");
const { cleanText } = require("../filter");
const v = require("../validate");

const limiter = (windowMin, limit) =>
  rateLimit({
    windowMs: windowMin * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "اهدى habibi 😤 too many requests, try again in a bit" },
  });

const avg = (nums) => (nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null);

async function leaderboard(db) {
  const since = await db.getSetting("leaderboard_since");
  const [orders, dishes] = await Promise.all([db.listOrders(since), db.listDishes()]);
  const counts = new Map();
  for (const order of orders) {
    for (const item of order.items) counts.set(item.dish_id, (counts.get(item.dish_id) || 0) + item.qty);
  }
  const visible = dishes.filter((d) => d.is_visible);
  const ranked = visible
    .map((d) => ({ id: d.id, name_ar: d.name_ar, name_en: d.name_en, photo_url: db.photoUrl(d.photo_path), orders: counts.get(d.id) || 0 }))
    .sort((a, b) => b.orders - a.orders);
  // Expired / sold-out dishes can't be ordered, so they never count as the worst seller
  const orderable = new Set(visible.filter((d) => d.category !== "expired" && !d.badges.includes("sold_out")).map((d) => d.id));
  const eligible = ranked.filter((d) => orderable.has(d.id));
  return {
    top: ranked.filter((d) => d.orders > 0).slice(0, 5),
    worst: eligible.length > 1 ? eligible[eligible.length - 1] : null,
    total_orders: orders.length,
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
    viewers: 3 + Math.floor(Math.random() * 25),
  };
}

function publicRouter(db) {
  const router = express.Router();

  router.get("/config", (req, res) => {
    const { CATEGORIES, SIZES, ADDONS, PAYMENT_METHODS, REACTIONS, BADGE_LABELS } = menu;
    res.json({ categories: CATEGORIES, badges: BADGE_LABELS, sizes: SIZES, addons: ADDONS, payment_methods: PAYMENT_METHODS, reactions: REACTIONS, fees: menu.computeFees(0).fees });
  });

  router.get("/dishes", async (req, res) => {
    const [dishes, reviews, board] = await Promise.all([db.listDishes(), db.listReviews(), leaderboard(db)]);
    const topId = board.top[0]?.id;
    res.json(
      dishes
        .filter((d) => d.is_visible)
        .map((d) => ({ ...publicDish(db, d, reviews), most_ordered: d.id === topId })),
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

  router.post("/orders", limiter(10, 5), async (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 10) {
      throw v.bad("skill issue: cart must have 1–10 items");
    }
    const items = [];
    for (const raw of b.items) {
      const dish = await db.getDish(String(raw?.dish_id)).catch(() => null);
      if (!dish || !dish.is_visible) throw v.bad("skill issue: one of those dishes doesn't exist (anymore)");
      const size = v.oneOf(raw.size, "size", Object.keys(menu.SIZES));
      const addons = Array.isArray(raw.addons) ? [...new Set(raw.addons)] : [];
      addons.forEach((a) => v.oneOf(a, "add-on", Object.keys(menu.ADDONS)));
      if (addons.some((a) => !menu.ADDONS[a].available)) throw v.bad("بدون دراما is not available. It never was. 💀");
      const qty = v.int(raw.qty, "quantity", 1, 9);
      items.push({ dish_id: dish.id, name_ar: dish.name_ar, name_en: dish.name_en, size, addons, qty, unit_price: menu.linePrice(dish.price, size, addons) });
    }
    const subtotal = menu.round2(items.reduce((s, i) => s + i.unit_price * i.qty, 0));
    const { fees, total } = menu.computeFees(subtotal);
    const order = await db.createOrder({
      customer_name: cleanText(v.text(b.customer_name, "name", { max: 40 })),
      items,
      subtotal,
      fees,
      total,
      payment_method: v.oneOf(b.payment_method, "payment method", menu.PAYMENT_METHODS),
      note: b.note ? cleanText(v.text(b.note, "note", { min: 0, max: 200 })) : null,
    });
    res.status(201).json({ order_number: order.order_number, items, subtotal, fees, total });
  });

  router.get("/leaderboard", async (req, res) => {
    res.json(await leaderboard(db));
  });

  return router;
}

module.exports = { publicRouter };
