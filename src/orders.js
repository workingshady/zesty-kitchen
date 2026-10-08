// Order creation shared by POST /api/orders and the chatbot agent. Prices are always recomputed here.
const menu = require("./menu");
const { cleanText } = require("./filter");
const v = require("./validate");

/** Validates one cart line against the DB and returns the priced order item (throws 400 on bad input). */
async function priceItem(db, raw) {
  const dish = await db.getDish(String(raw?.dish_id)).catch(() => null);
  if (!dish || !dish.is_visible) throw v.bad("skill issue: one of those dishes doesn't exist (anymore)");
  const size = v.oneOf(raw.size, "size", Object.keys(menu.SIZES));
  const addons = Array.isArray(raw.addons) ? [...new Set(raw.addons)] : [];
  addons.forEach((a) => v.oneOf(a, "add-on", Object.keys(menu.ADDONS)));
  if (addons.some((a) => !menu.ADDONS[a].available)) throw v.bad("بدون دراما is not available. It never was. 💀");
  const qty = v.int(raw.qty, "quantity", 1, 9);
  return { dish, item: { dish_id: dish.id, name_ar: dish.name_ar, name_en: dish.name_en, size, addons, qty, unit_price: menu.linePrice(dish.price, size, addons) } };
}

/** Creates a real order. Returns { order_number, items, subtotal, fees, total }. */
async function createOrder(db, b = {}) {
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 10) {
    throw v.bad("skill issue: cart must have 1–10 items");
  }
  const items = [];
  for (const raw of b.items) items.push((await priceItem(db, raw)).item);
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
  return { order_number: order.order_number, items, subtotal, fees, total };
}

module.exports = { createOrder, priceItem };
