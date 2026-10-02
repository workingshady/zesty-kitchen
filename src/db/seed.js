// Example dishes so the menu isn't empty on first run. Edit or delete them in the admin page.
// Keep in sync with the INSERT at the bottom of supabase/migrations/*_init.sql.
const SEED_DISHES = [
  {
    name_ar: "مندي أحمد",
    name_en: "Ahmed Mandi",
    description: "Slow-cooked since the 9am standup. يسطا ده aura +1000. Comes with rice and unsolicited opinions.",
    price: 189,
    category: "mandi",
    badges: ["popular", "chefs_pick"],
  },
  {
    name_ar: "كفتة الـ HR",
    name_en: "HR Kofta",
    description: "Grilled in every 1:1. No cap, it's giving… performance review.",
    price: 145,
    category: "grills",
    badges: ["spicy"],
  },
  {
    name_ar: "شاورما الدراما",
    name_en: "Drama Shawarma",
    description: "Wrapped in gossip, extra garlic, zero chill. fr fr.",
    price: 99,
    category: "shawarma",
    badges: ["new"],
  },
  {
    name_ar: "صينية التيم كله",
    name_en: "The Whole Team Tray",
    description: "The entire team on one tray. Serves 10, argues with 12.",
    price: 1350,
    category: "trays",
    badges: [],
  },
  {
    name_ar: "الإنترن المقرمش",
    name_en: "Crispy Intern",
    description: "Fresh, eager, slightly undercooked. Will make you coffee.",
    price: 35,
    category: "appetizers",
    badges: ["new"],
  },
  {
    name_ar: "الزميل اللي سافر",
    name_en: "The One Who Left",
    description: "Expired. Still in the group chat though.",
    price: 0,
    category: "expired",
    badges: ["sold_out"],
  },
];

module.exports = { SEED_DISHES };
