// Single source of truth for categories, sizes, add-ons and joke fees.
// The frontend reads these from GET /api/config; prices are always recomputed here.

const CATEGORIES = [
  { slug: "picks", emoji: "💅", ar: "مختارات ليك", en: "Picks for you", twist: "The algorithm chose violence" },
  { slug: "mandi", emoji: "🍚", ar: "مندي ومضغوط", en: "Mandi", twist: "Slow-cooked since 9am standup" },
  { slug: "grills", emoji: "🔥", ar: "مشويات", en: "Grills", twist: "Grilled in the 1:1" },
  { slug: "shawarma", emoji: "🌯", ar: "شاورما", en: "Shawarma", twist: "Wrapped up in drama" },
  { slug: "seafood", emoji: "🦐", ar: "سي فود بالكيلو", en: "By the kilo", twist: "Price per kilo of attitude" },
  { slug: "fatta", emoji: "🥣", ar: "فتة وطواجن", en: "Fatta & tagines", twist: "Soaked in tea (gossip) ☕" },
  { slug: "sandwiches", emoji: "🥪", ar: "سندوتشات", en: "Sandwiches", twist: "Squished between two meetings" },
  { slug: "appetizers", emoji: "🥗", ar: "مقبلات وسلطات", en: "Starters", twist: "Interns & new joiners" },
  { slug: "trays", emoji: "🫕", ar: "صواني وعزائم", en: "Family trays", twist: "صينية التيم كله" },
  { slug: "soups", emoji: "🍲", ar: "شوربة", en: "Soups", twist: "Watered-down personalities" },
  { slug: "desserts", emoji: "🍰", ar: "حلويات", en: "Desserts", twist: "The sweet ones (rare)" },
  { slug: "expired", emoji: "⚠️", ar: "منتهي الصلاحية", en: "Expired", twist: "Left the company" },
];

const SIZES = {
  quarter: { ar: "ربع", en: "Quarter", note: "just the vibes", mult: 0.6 },
  half: { ar: "نص", en: "Half", note: "the classic", mult: 1.0 },
  whole: { ar: "كامل", en: "Whole person", note: "all of them", mult: 1.8 },
  family: { ar: "عيلة", en: "Family size", note: "comes with their mom", mult: 3.0 },
};

const ADDONS = {
  tahini: { ar: "طحينة إضافية", en: "Extra tahini", price: 10, available: true },
  bread: { ar: "عيش زيادة", en: "Extra bread", price: 5, available: true },
  sarcasm: { ar: "سخرية زيادة", en: "Extra sarcasm", price: 25, available: true },
  gossip: { ar: "طبق نميمة", en: "Side of gossip ☕", price: 15, available: true },
  aura: { ar: "أورا +1000", en: "Aura boost", price: 67, available: true },
  no_drama: { ar: "بدون دراما", en: "No drama", price: 0, available: false },
};

const BADGES = ["spicy", "popular", "new", "sold_out", "chefs_pick"];
const PAYMENT_METHODS = ["vibes", "insults", "owe_lunch"];
const REACTIONS = ["🤢", "🔥", "💀", "🫡"];

const round2 = (n) => Math.round(n * 100) / 100;

function linePrice(basePrice, size, addons) {
  const s = SIZES[size];
  if (!s) throw new Error(`Unknown size: ${size}`);
  const extras = addons.reduce((sum, key) => {
    const a = ADDONS[key];
    if (!a || !a.available) throw new Error(`Unavailable add-on: ${key}`);
    return sum + a.price;
  }, 0);
  return round2(Number(basePrice) * s.mult + extras);
}

function computeFees(subtotal) {
  const fees = [
    { key: "eye_contact", ar: "رسوم التواصل البصري", en: "Eye-contact fee", amount: 49.99 },
    { key: "silence_tax", ar: "ضريبة السكوت المحرج", en: "Awkward silence tax (14%)", amount: round2(subtotal * 0.14) },
    { key: "hr_delivery", ar: "توصيل عن طريق HR", en: "Delivery by HR", amount: 120 },
    { key: "aura_tax", ar: "ضريبة الأورا", en: "Aura tax (−67 aura)", amount: 0 },
    { key: "emotional", ar: "دعم نفسي", en: "Emotional support fee", amount: 0.01 },
  ];
  const total = round2(subtotal + fees.reduce((s, f) => s + f.amount, 0));
  return { fees, total };
}

module.exports = {
  CATEGORIES,
  SIZES,
  ADDONS,
  BADGES,
  PAYMENT_METHODS,
  REACTIONS,
  round2,
  linePrice,
  computeFees,
};
