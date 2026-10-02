# Zesty Kitchen — Design Spec

Date: 2026-10-02
Status: Approved in chat (parts 1–3), pending written-spec review

## 1. Purpose

A joke food-ordering website for a group of coworkers and friends. The "dishes" on
the menu are the coworkers themselves (e.g. a friend as **مندي** with their face on a
plate), with funny names, descriptions and prices. Visitors browse, add coworkers to
a cart, go through a deliberately chaotic checkout, place a fake order, and leave
reviews. The owner has a secret admin page to manage dishes, photos, reviews and
orders.

**Success looks like:** coworkers open the link, laugh, order each other, fight over
the leaderboard, and write reviews; the owner can update dishes and photos from a
browser without touching code.

**Non-goals:** real payments, user accounts, multiple languages via toggle, SEO,
high traffic. Audience is a small known group.

## 2. Decisions made with the owner

| Topic | Decision |
|---|---|
| Hosting | Render free web service (Node.js), Frankfurt region |
| Persistence | Supabase free (Postgres + Storage), Europe region |
| Language | Arabic + English mixed on one page, no toggle |
| Orders | Saved; drives a leaderboard |
| Reviews | Posted instantly; server-side bad-word filter; owner can delete |
| Admin | Secret URL path **and** password, both from env vars |
| Payment | Fake only. Never render card-number fields |
| Currency | EGP (جنيه) — prices in Egyptian-restaurant ranges |
| Menu structure | A "mega menu" merging the categories, sizes and add-ons of 4 real Egyptian restaurants (§6.1) |
| Tone | Gen-Z / brainrot: Egyptian Gen-Z slang + English internet slang (§6.2) |

## 3. Architecture

```
Browser (vanilla HTML/CSS/JS)  ──HTTPS──▶  Express on Render  ──▶  Supabase
  menu, cart, checkout,                     public API              Postgres: dishes,
  tracker, reviews, admin UI                admin API (cookie)        reviews, orders, settings
                                            bad-word filter         Storage: bucket "dishes"
                                            rate limits
```

- The browser **never** talks to Supabase directly. Only the server holds the
  Supabase secret key. RLS stays enabled with no public policies, so the publishable
  key grants nothing.
- No build step. Frontend libraries load from jsDelivr/cdnjs; fonts from Google Fonts.
- The data layer is one module (`src/db.js`) with a small interface, so tests swap
  in an in-memory fake.

### Environment variables (set in Render, never committed)

| Name | Purpose |
|---|---|
| `SUPABASE_URL` | `https://ljoxpntcokygmqdcmyvs.supabase.co` |
| `SUPABASE_SECRET_KEY` | Server-only `sb_secret_…` key |
| `ADMIN_PATH` | Secret path segment, e.g. `kitchen-x7q2` → admin at `/kitchen-x7q2` |
| `ADMIN_PASSWORD` | Admin login password |
| `SESSION_SECRET` | Random string used to sign the admin cookie |
| `NODE_ENV` | `production` |

If Supabase vars are missing, the server starts with the in-memory store and logs a
warning (useful for local dev); admin routes are disabled if `ADMIN_PATH` or
`ADMIN_PASSWORD` is missing.

## 4. Data model (Supabase Postgres)

**dishes**
- `id uuid pk default gen_random_uuid()`
- `name_ar text not null`, `name_en text not null`
- `description text not null default ''`
- `price numeric(8,2) not null check (price >= 0)`
- `category text not null` — one of the category slugs in §6.1
- `price` is the **نص / Half** price; other sizes use fixed multipliers (§6.1)
- `badges text[] not null default '{}'` — e.g. `spicy`, `popular`, `new`, `sold_out`, `chefs_pick`
- `photo_path text` — object path in bucket `dishes`; null → emoji plate fallback
- `is_visible boolean not null default true`
- `sort_order int not null default 0`
- `created_at timestamptz not null default now()`

**reviews**
- `id uuid pk`, `dish_id uuid fk → dishes on delete cascade`
- `author_name text not null` (1–40 chars)
- `chili_rating int not null check 1..5`
- `awkward_rating int not null check 1..5` ("How awkward was eye contact?")
- `body text not null` (1–500 chars, filtered)
- `reactions jsonb not null default '{}'` — counts for `🤢 🔥 💀 🫡`
- `created_at timestamptz default now()`

**orders**
- `id uuid pk`, `order_number int generated always as identity`
- `customer_name text not null`
- `items jsonb not null` — `[{dish_id, name_en, name_ar, size, addons, qty, unit_price}]` snapshot
- `subtotal numeric`, `fees jsonb`, `total numeric`
- `payment_method text not null` — `vibes`, `insults`, `owe_lunch`
- `note text` (≤ 200 chars, filtered)
- `created_at timestamptz default now()`

**settings** — `key text pk`, `value jsonb`. Used for `leaderboard_since` (timestamp).

**Storage:** public-read bucket `dishes`. Uploads only via server. Images are
resized server-side with `sharp` to max 800px, converted to WebP; upload limit 5 MB;
accepted types jpeg/png/webp/gif.

The schema lives in `supabase/migrations/<timestamp>_init.sql`, including explicit
`grant ... to service_role` (since "auto-expose new tables" is off) and the bucket
creation. If the GitHub integration does not apply it, the owner pastes it into the
SQL Editor once.

## 5. API

All JSON. Validation errors → 400 with a funny-but-clear message. Rate limits per IP.

**Public**
- `GET /api/dishes` → visible dishes sorted by `sort_order`, each with `photo_url`,
  `review_count`, `avg_chili`, and a fake `viewers` number (random 3–27).
- `GET /api/dishes/:id` → dish + its reviews (newest first).
- `POST /api/dishes/:id/reviews` `{author_name, chili_rating, awkward_rating, body}`
  → filtered review. Limit: 5 per 10 min.
- `POST /api/reviews/:id/react` `{emoji}` → increments one of the 4 allowed emojis.
  Limit: 30 per min.
- `POST /api/orders` `{customer_name, items:[{dish_id, size, addons, qty}], payment_method, note}`
  → server looks up real prices, computes subtotal + joke fees, saves, returns
  `{order_number, total, fees}`. Qty 1–9 per line, ≤ 10 lines, dishes must be visible.
  Limit: 5 per 10 min.
- `GET /api/leaderboard` → top 5 dishes by total qty ordered since
  `leaderboard_since`, plus the visible dish with the fewest orders ("💀 Worst seller").
- `GET /api/health` → existing health check.

**Joke fees** (computed server-side, deterministic from subtotal):
رسوم التواصل البصري / Eye-contact fee 49.99, ضريبة السكوت المحرج / Awkward silence
tax 14% of subtotal, توصيل عن طريق HR / Delivery by HR 120.00, Aura tax −67 aura
(shown, costs 0 EGP), Emotional support fee 0.01. Total = subtotal + fees.

**Line price** = `price × size multiplier + Σ add-on prices`, all from server
constants (§6.1). The client's prices are ignored.

**Admin** (all require valid admin cookie except login)
- `GET /<ADMIN_PATH>` → admin HTML (login form if not signed in).
- `POST /api/admin/login` `{password}` → timing-safe compare; sets signed httpOnly,
  `secure` (prod), `sameSite=strict` cookie valid 7 days. Limit: 5 per 15 min.
- `POST /api/admin/logout`
- `GET/POST /api/admin/dishes`, `PUT/DELETE /api/admin/dishes/:id`
- `POST /api/admin/dishes/:id/photo` (multipart, field `photo`) → resize + upload,
  deletes the old object.
- `PUT /api/admin/dishes/order` `{ids:[...]}` → rewrites `sort_order`.
- `GET /api/admin/reviews`, `DELETE /api/admin/reviews/:id`
- `GET /api/admin/orders`, `POST /api/admin/leaderboard/reset`

The admin path is unguessable in practice but is not the security boundary; the
password + signed cookie is.

## 6. Frontend

Pages (static files in `public/`, served by Express):
- `index.html` — menu, dish modal with reviews, cart drawer, leaderboard
- `checkout.html` — chaos checkout steps
- `order.html?n=<order_number>` — backwards tracker
- `404.html` — "Dish not found" + Flappy-Face mini game
- `admin.html` — served only at `/<ADMIN_PATH>`

Cart lives in `localStorage` (try/catch guarded). Shared helpers in `public/js/`.

### 6.1 Mega menu (merged from 4 Egyptian restaurants)

Researched: El Rayes Ibn Hamido (seafood), Hadramout Antar (Yemeni mandi), El Dahan
(grills), Broccar (Syrian shawarma). Categories are fixed in code; the admin picks
one per dish. Tabs are a horizontally scrolling sticky bar, like the real sites.

| Slug | Tab label | From | Parody twist |
|---|---|---|---|
| `picks` | 💅 Picks for you / مختارات ليك | Broccar | "The algorithm chose violence" |
| `mandi` | 🍚 مندي ومضغوط / Mandi | Hadramout | Coworkers served on rice, "slow-cooked since 9am standup" |
| `grills` | 🔥 مشويات / Grills | El Dahan | Kebab/kofta-style coworkers, "grilled in the 1:1" |
| `shawarma` | 🌯 شاورما / Shawarma | Broccar | "Wrapped up in drama" |
| `seafood` | 🦐 سي فود بالكيلو / By the kilo | El Rayes | Sold by weight: "price per kilo of attitude" |
| `fatta` | 🥣 فتة وطواجن / Fatta & tagines | Hadramout, El Rayes | "Soaked in tea (gossip) ☕" |
| `sandwiches` | 🥪 سندوتشات / Sandwiches | all | "Squished between two meetings" |
| `appetizers` | 🥗 مقبلات وسلطات / Starters | all | Interns and new joiners |
| `trays` | 🫕 صواني وعزائم / Family trays | Hadramout | Whole teams as one combo: "صينية التيم كله" |
| `soups` | 🍲 شوربة / Soups | El Rayes | "Watered-down personalities" |
| `desserts` | 🍰 حلويات / Desserts | — | The sweet ones (rare) |
| `expired` | ⚠️ منتهي الصلاحية / Expired | — | People who left the company |

**Sizes** (the El Dahan / Hadramout ربع-نص-كامل pattern), multipliers on `price`:
| Size | Label | × |
|---|---|---|
| `quarter` | ربع / Quarter ("just the vibes") | 0.6 |
| `half` | نص / Half | 1.0 |
| `whole` | كامل / Whole person | 1.8 |
| `family` | عيلة / Family size ("comes with their mom") | 3.0 |

**Add-ons** (the "sauces & extras" pattern), fixed prices in EGP:
طحينة إضافية / Extra tahini 10 · عيش زيادة / Extra bread 5 · Extra sarcasm 25 ·
بدون دراما / No drama (−0, "not available") · Side of gossip ☕ 15 · Aura boost +1000 aura 67.

Every real menu has these, so the parody has them too: a "🔥 عرض النهاردة / Today's
offer" strip under the header, item cards with "Starting from X EGP", and a
"Most ordered" badge driven by the leaderboard.

### 6.2 Tone: Gen-Z / brainrot

Mixed Egyptian Gen-Z Arabic + English internet slang in all fixed UI copy.
Examples: "يسطا ده aura +1000", "no cap ده أحسن مندي", "It's giving… overtime",
"delulu delivery time", "skill issue" (validation errors), "سيبك ده NPC behavior",
"W order / L order", "slay 💅", "fr fr", "brainrot level: critical", "6️⃣7️⃣".
Reviews show an **Aura meter** next to the 🌶️ rating (aura = avg chili × 200 − 67).
Keep it PG: no slurs, nothing about religion, looks, or family beyond the jokes
listed here.

### Visual style
Neo-brutalism meets Gen-Z "dopamine" / Y2K brainrot: 3px black borders, hard
offset shadows (`6px 6px 0 #111`), buttons that "press" on `:active`, slightly
rotated sticker labels, a few WordArt-style gradient headings, a scrolling marquee
of fake hype ("🚨 أحمد اتطلب 67 مرة النهاردة 🚨"), and a Brat-style slime-green
banner. Palette: cream `#FFF4E0` background, ketchup `#FF3B30`, mustard `#FFC700`,
hot-sauce `#FA4B13`, pink `#FF69B4` (badges), slime `#8ACE00` (Brat banner),
pickle `#39FF14` (accents only), ink `#111`. Text only on cream/white or black for
contrast. Fonts: **Lalezar** (headings, dish names), **Baloo Bhaijaan 2** (buttons,
prices), **Cairo** (body). User text rendered with `dir="auto"`. Mobile-first; 44px
tap targets; bottom cart bar on phones.

### Fun features

Rule: browsing is mostly usable; chaos concentrates in checkout; **one annoyance
per step**; every annoyance gives up after 2–3 tries.

Global
- Googly-eyed chef logo following the cursor (atan2 per pupil).
- Food-emoji cursor trail (`cursor-effects` emojiCursor) on pointer devices.
- Tab title → "😭 طلبك بيبرد / Your food is getting cold" when hidden.
- Rage-click (4+ clicks in 600ms) → page shake + "اهدى habibi 😤" toast.
- Idle 60s → a dish face DVD-bounces; any input stops it.
- Typing `يلا` or the Konami code → faces rain down.
- Floating **"😩 I give up"** switch = Chill mode: disables all annoyances, motion,
  and sound; persisted in localStorage.
- `prefers-reduced-motion: reduce` → Chill-mode motion rules automatically.
- Sound off by default; 🔊 toggle; never autoplays.

Menu
- Fake app header: "Delivery to: Desk #4 🪑", "25–35 years", "4.9★ (2.3k)".
- Sticky scrolling category tabs from §6.1; "🔥 Today's offer" strip; hype marquee.
- Dish cards: face on a plate, AR + EN names, price, badges; 3D tilt on hover
  (`vanilla-tilt`); `rough-notation` strike-through on `sold_out`, circle on
  `chefs_pick`; "🔥 N coworkers are eyeing this dish".
- Leaderboard section (🏆 top 5 + 💀 worst seller).

Dish modal
- Big photo, description, size picker (ربع / نص / كامل / عيلة) and add-on
  checkboxes from §6.1, live line price, quantity stepper.
- Runaway "Add to cart" (dodges 3 times on hover; on touch, jumps after first tap),
  then "fine 🙄" and works.
- Reviews: 🌶️ 1–5 + awkwardness 1–5, emoji reactions, deterministic joke badge per
  author name ("Verified Eater", "Top 1% Complainer", "Ate Here Once In 2019").

Checkout steps
1. Cart review: the quantity "+" counts down on first press (then behaves);
   joke fee breakdown.
2. Name: normal input.
3. Phone by slider (0–9,999,999,999); fine-tune ± buttons appear after 3 drags.
   Phone is **not** sent or stored.
4. Delivery time via "higher or lower?" guessing game; after 4 guesses it accepts.
5. Captcha: "Select the coworker who microwaves fish 🐟" using dish photos; any
   answer accepted after 2 fails.
6. Payment: Pay with vibes ✨ / Cash (of insults) / Owe them lunch. No card fields.
7. Place order: progress bar hits 99%, drops to 12% once, then completes; emoji
   confetti (`js-confetti`); redirect to tracker.

Order tracker
- Steps Preparing → Picked up → On the way → Delivered; goes backwards once.
- Courier dot wanders a fake office floor-plan SVG.
- Fake incoming call modal from the dish ("It's me, مندي أحمد. I'm not coming.").

### CSP
Helmet CSP extended to allow scripts from `cdn.jsdelivr.net` and
`cdnjs.cloudflare.com`, styles/fonts from Google Fonts, images from the Supabase
project origin and `data:`. No inline scripts.

## 7. Error handling

- Supabase/network failures → 503 JSON `{error}`; frontend shows a toast
  "The chef dropped the plate 🍽️💥 try again" and keeps the cart.
- Cold start: frontend shows "👨‍🍳 Chef is waking up…" while the first API call is
  pending (Render free sleeps).
- Missing photo → emoji plate fallback.
- Unknown routes → `404.html` for pages, JSON 404 for `/api/*`.

## 8. Testing

- `node:test` + `supertest` against the Express app with the in-memory store:
  bad-word filter (AR + EN), review/order validation, server-side pricing & fees,
  leaderboard calc + reset, admin auth (wrong password, missing cookie, tampered
  cookie, rate limit), admin CRUD, photo upload rejects bad type/size.
- Manual browser pass: each checkout step completes, Chill mode disables chaos,
  mobile width (375px), reduced motion.
- `npm audit --omit=dev` clean.

## 9. Owner setup steps (after build)

1. Run the migration in Supabase SQL Editor (if not auto-applied).
2. In Render → Environment, add the 5 variables in §3.
3. Open `/<ADMIN_PATH>`, log in, add coworkers and photos.
