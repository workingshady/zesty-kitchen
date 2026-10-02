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
  { slug: "ful", emoji: "🫘", ar: "فول الصبح", en: "Morning Ful", twist: "Useless before 10am and the 3rd coffee" },
  { slug: "koshary", emoji: "🍝", ar: "كشري الاجتماعات", en: "Meeting Koshary", twist: "A bit of everything, no clear point, 2 hours long" },
  { slug: "taameya", emoji: "🧆", ar: "طعمية مقرمشة", en: "Crispy Ta3meya", twist: "Hot takes, fried daily" },
  { slug: "mahshi", emoji: "🫑", ar: "محشي الإيميلات", en: "Stuffed Emails", twist: "One sentence wrapped in 14 paragraphs" },
  { slug: "molokhia", emoji: "🥬", ar: "ملوخية الديدلاين", en: "Deadline Molokhia", twist: "Slimy under pressure but delivers" },
  { slug: "basbousa", emoji: "🍯", ar: "بسبوسة المدير", en: "Boss's Basbousa", twist: "Overly sweet in meetings. Glazing." },
  { slug: "bread", emoji: "🥖", ar: "عيش مدعم", en: "Subsidized Bread", twist: "Cheap, essential, always in the queue" },
  { slug: "asab", emoji: "🧃", ar: "عصير قصب", en: "Sugarcane Juice", twist: "رايق. Sweet. Does nothing all day." },
  { slug: "torshi", emoji: "🌶️", ar: "مخلل حراق", en: "Spicy Torshi", twist: "Small dose only. Heavy dose = warning letter." },
  { slug: "expired", emoji: "⚠️", ar: "منتهي الصلاحية", en: "Expired", twist: "Left the company" },
];

// Friendly labels for the admin page and cards
const BADGE_LABELS = {
  spicy: "🌶️ Spicy",
  popular: "🔥 Popular",
  new: "✨ New",
  sold_out: "💀 Sold out",
  chefs_pick: "👨‍🍳 Chef's pick",
  hr_approved: "✅ HR approved",
  toxic: "☢️ Toxic",
  on_vacation: "🏖️ On vacation",
  overworked: "🥵 Overworked",
  red_flag: "🚩 Red flag",
  main_character: "🎬 Main character",
};

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

const BADGES = Object.keys(BADGE_LABELS);
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
  BADGE_LABELS,
  PAYMENT_METHODS,
  REACTIONS,
  round2,
  linePrice,
  computeFees,
};
