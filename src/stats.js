// Real aggregates for the public site (GET /api/stats) and the leaderboard.
// One pass over orders + reviews, cached ~30s per store; new orders invalidate the cache.

const CACHE_MS = 30_000;
const WEEK_MS = 7 * 864e5;
const cache = new WeakMap(); // db -> { at, since, data, pending }

const cairoDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (iso) => cairoDay.format(new Date(iso)); // "YYYY-MM-DD" in Cairo
const dayNum = (day) => Math.round(Date.parse(`${day}T00:00:00Z`) / 864e5);
const firstName = (name) => String(name || "").trim().split(/\s+/)[0].slice(0, 20) || "someone";
const avg1 = (sum, n) => (n ? Math.round((sum / n) * 10) / 10 : null);

/** Ranks entries by qty desc (ties keep menu order) and returns Map(id -> rank) for qty > 0. */
function rankMap(entries, key) {
  const ranked = entries.filter((e) => e[key] > 0).sort((a, b) => b[key] - a[key] || a.order - b.order);
  return new Map(ranked.map((e, i) => [e.id, i + 1]));
}

async function computeStats(db, since, now = Date.now()) {
  const [orders, dishes, reviews] = await Promise.all([db.listOrders(), db.listDishes(), db.listReviews()]);
  const today = dayOf(now);
  const todayN = dayNum(today);
  const weekAgo = new Date(now - WEEK_MS).toISOString();
  const per = new Map();
  const get = (id) => {
    let p = per.get(id);
    if (!p) per.set(id, (p = { qty: 0, qty_all_time: 0, qty_today: 0, qty_7d: 0, prev_qty: 0, last_ordered_at: null, days: new Set(), review_count: 0, chili_sum: 0 }));
    return p;
  };

  let ordersToday = 0;
  let boardOrders = 0;
  for (const o of orders) {
    const at = o.created_at;
    const day = dayOf(at);
    const inBoard = !since || at >= since;
    if (day === today) ordersToday++;
    if (inBoard) boardOrders++;
    for (const item of o.items || []) {
      const q = Number(item.qty) || 0;
      const p = get(item.dish_id);
      p.qty_all_time += q;
      if (inBoard) {
        p.qty += q;
        if (at < weekAgo) p.prev_qty += q;
      }
      if (at >= weekAgo) p.qty_7d += q;
      if (day === today) p.qty_today += q;
      if (!p.last_ordered_at || at > p.last_ordered_at) p.last_ordered_at = at;
      p.days.add(dayNum(day));
    }
  }
  let ratingSum = 0;
  for (const r of reviews) {
    const p = get(r.dish_id);
    p.review_count++;
    p.chili_sum += Number(r.chili_rating) || 0;
    ratingSum += Number(r.chili_rating) || 0;
  }

  const visible = dishes.filter((d) => d.is_visible);
  const rows = visible.map((d, order) => ({ id: d.id, order, ...get(d.id) }));
  const nowRank = rankMap(rows, "qty");
  const prevRank = rankMap(rows, "prev_qty");

  const ranking = rows
    .slice()
    .sort((a, b) => b.qty - a.qty || b.qty_all_time - a.qty_all_time || a.order - b.order)
    .map((r, i) => {
      const d = visible[r.order];
      // Streak: consecutive Cairo days with an order, ending today or yesterday
      let streak = 0;
      let cursor = r.days.has(todayN) ? todayN : r.days.has(todayN - 1) ? todayN - 1 : null;
      while (cursor !== null && r.days.has(cursor)) {
        streak++;
        cursor--;
      }
      const prev = prevRank.get(r.id) || null;
      const cur = nowRank.get(r.id) || null;
      return {
        id: r.id,
        name_ar: d.name_ar,
        name_en: d.name_en,
        photo_url: db.photoUrl(d.photo_path),
        rank: i + 1,
        orders_qty: r.qty,
        orders_qty_all_time: r.qty_all_time,
        orders_today: r.qty_today,
        orders_7d: r.qty_7d,
        // ▲▼ vs. the board as it stood a week ago; "new" = first orders this week
        prev_rank: prev,
        movement: cur && prev ? prev - cur : cur && !prev ? "new" : null,
        last_ordered_at: r.last_ordered_at,
        days_since_last_order: r.last_ordered_at ? todayN - dayNum(dayOf(r.last_ordered_at)) : null,
        streak_days: streak,
        review_count: r.review_count,
        avg_chili: avg1(r.chili_sum, r.review_count),
        orderable: d.category !== "expired" && !(d.badges || []).includes("sold_out"),
      };
    });

  const eligible = ranking.filter((r) => r.orderable);
  const recent = orders
    .slice()
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 10)
    .map((o) => ({
      name: firstName(o.customer_name),
      items: (o.items || []).map((i) => ({ dish_id: i.dish_id, name_ar: i.name_ar, name_en: i.name_en, size: i.size, qty: i.qty })),
      created_at: o.created_at,
    }));

  return {
    generated_at: new Date(now).toISOString(),
    today,
    leaderboard_since: since || null,
    total_orders: orders.length,
    board_orders: boardOrders,
    orders_today: ordersToday,
    rating: { avg_chili: avg1(ratingSum, reviews.length), review_count: reviews.length },
    dishes: Object.fromEntries(
      ranking.map((r) => [r.id, { orders_qty: r.orders_qty, orders_qty_all_time: r.orders_qty_all_time, orders_today: r.orders_today, last_ordered_at: r.last_ordered_at, review_count: r.review_count, avg_chili: r.avg_chili, rank: r.rank }]),
    ),
    ranking,
    worst: eligible.length > 1 ? eligible[eligible.length - 1] : null,
    recent_orders: recent,
  };
}

/** Cached stats. Re-reads leaderboard_since each call so a board reset shows up at once. */
async function getStats(db) {
  const since = await db.getSetting("leaderboard_since");
  const hit = cache.get(db);
  if (hit && hit.since === since && Date.now() - hit.at < CACHE_MS) return hit.data;
  if (hit?.pending && hit.since === since) return hit.pending;
  const pending = computeStats(db, since);
  cache.set(db, { at: 0, since, pending });
  try {
    const data = await pending;
    // Only keep it if no new order invalidated the cache while we were computing
    if (cache.get(db)?.pending === pending) cache.set(db, { at: Date.now(), since, data });
    return data;
  } catch (err) {
    if (cache.get(db)?.pending === pending) cache.delete(db);
    throw err;
  }
}

const invalidateStats = (db) => cache.delete(db);

module.exports = { getStats, computeStats, invalidateStats, dayOf };
