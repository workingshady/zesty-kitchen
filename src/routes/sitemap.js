// Two sitemaps on purpose:
// - /sitemap.xml is public (search engines read it), so it lists only public pages.
// - /<ADMIN_PATH>/sitemap is admin-only and lists everything, including the secret admin
//   link and every API endpoint. Putting the admin link in the public one would publish it.
const express = require("express");
const auth = require("../auth");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const origin = (req) => `${req.protocol}://${req.get("host")}`;

const PUBLIC_PAGES = [
  ["/", "🍽️ Home / menu", "daily", "1.0"],
  ["/checkout", "🛒 Checkout", "monthly", "0.5"],
  ["/arcade", "🕹️ Arcade + game leaderboard", "weekly", "0.7"],
  ["/order", "📍 Order tracker (needs ?n=<order number>)", "monthly", "0.3"],
  ["/404", "💀 404 page (also the arcade)", "yearly", "0.1"],
];

const PUBLIC_API = [
  ["GET", "/api/health", "Server health"],
  ["GET", "/api/config", "Categories, sizes, add-ons, fees"],
  ["GET", "/api/dishes", "Visible dishes"],
  ["GET", "/api/dishes/:id", "One dish + reviews"],
  ["POST", "/api/dishes/:id/reviews", "Post a review"],
  ["POST", "/api/reviews/:id/react", "Emoji reaction"],
  ["POST", "/api/orders", "Place an order"],
  ["GET", "/api/leaderboard", "Top dishes"],
  ["GET", "/api/stats", "Real order/review stats"],
  ["GET", "/api/ai/status", "Is AI on?"],
  ["POST", "/api/ai/roast · courier · judge · translate · review-reply · horoscope · duo · excuse · vibe-check", "AI features"],
  ["POST", "/api/agent", "The waiter chatbot agent"],
  ["GET", "/api/games/leaderboard?game=", "Arcade leaderboard"],
  ["POST", "/api/games/scores", "Post an arcade score (nickname + PIN)"],
];

const ADMIN_API = [
  ["POST", "/api/admin/login · logout", "Admin session"],
  ["GET", "/api/admin/stats · settings · export", "Dashboard data, settings, JSON backup"],
  ["GET/POST/PUT/DELETE", "/api/admin/dishes · /:id · /:id/photo · /:id/duplicate · /order · /bulk · /import", "Manage dishes"],
  ["GET/DELETE/POST", "/api/admin/reviews · /:id · /:id/highlight", "Manage reviews"],
  ["GET/DELETE", "/api/admin/orders · /:id", "Manage orders"],
  ["POST", "/api/admin/leaderboard/reset", "Reset the leaderboard"],
  ["POST", "/api/admin/ai/bio", "AI fill for the dish editor"],
  ["GET/POST", "/api/admin/ai/status · test · diag", "AI status, test, raw diagnostics"],
  ["GET/POST", "/api/admin/agent", "👨‍🍳 Chef AI agent"],
];

function sitemapRouter({ db, adminPath, sessionSecret }) {
  const router = express.Router();

  router.get("/sitemap.xml", async (req, res) => {
    const base = origin(req);
    const dishes = (await db.listDishes().catch(() => [])).filter((d) => d.is_visible);
    const urls = [
      ...PUBLIC_PAGES.filter(([p]) => p !== "/404" && p !== "/order").map(([p, , freq, prio]) => ({ loc: `${base}${p}`, freq, prio })),
      ...dishes.map((d) => ({ loc: `${base}/?dish=${encodeURIComponent(d.id)}`, freq: "weekly", prio: "0.6" })),
    ];
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${esc(u.loc)}</loc><changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`)
        .join("\n")}\n</urlset>\n`,
    );
  });

  router.get("/robots.txt", (req, res) => {
    // The admin link is deliberately NOT listed here: robots.txt is public too
    res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin(req)}/sitemap.xml\n`);
  });

  if (adminPath) {
    router.get(`/${adminPath}/sitemap`, async (req, res) => {
      if (!auth.isValidToken(req.cookies?.[auth.COOKIE_NAME], sessionSecret)) return res.redirect(`/${adminPath}`);
      const base = origin(req);
      const dishes = await db.listDishes().catch(() => []);
      const link = (p) => `<a href="${esc(p)}">${esc(base + p)}</a>`;
      const rows = (list) => list.map(([m, p, what]) => `<tr><td><code>${esc(m)}</code></td><td><code>${esc(p)}</code></td><td>${esc(what)}</td></tr>`).join("");
      res.set("X-Robots-Tag", "noindex").type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Full sitemap · Kitchen Admin</title>
<style>body{font-family:Cairo,system-ui,sans-serif;background:#fff4e0;color:#111;margin:0;padding:24px;line-height:1.5}main{max-width:1000px;margin:0 auto}h1,h2{font-family:Lalezar,system-ui,sans-serif;font-weight:400}section{background:#fff;border:3px solid #111;border-radius:12px;box-shadow:5px 5px 0 #111;padding:16px;margin:0 0 20px;overflow-x:auto}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:6px 8px;vertical-align:top}ul{padding-left:20px}a{color:#111}.warn{background:#ffc700;border:2px solid #111;border-radius:8px;padding:8px 12px}</style></head>
<body><main>
<h1>🗺️ Full sitemap (admin only)</h1>
<p class="warn">🔒 This page is only visible when logged in. Don't share these links: the admin link is secret.</p>
<section><h2>Public pages</h2><ul>${PUBLIC_PAGES.map(([p, what]) => `<li>${link(p)} — ${esc(what)}</li>`).join("")}</ul>
<p>Public sitemap for search engines: ${link("/sitemap.xml")} · ${link("/robots.txt")}</p></section>
<section><h2>Admin / chef (secret)</h2><ul>
<li>${link(`/${adminPath}`)} — Kitchen admin (Overview, Dishes, Reviews, Orders, Settings)</li>
<li>${link(`/${adminPath}#dishes`)} · ${link(`/${adminPath}#reviews`)} · ${link(`/${adminPath}#orders`)} · ${link(`/${adminPath}#settings`)}</li>
<li>${link(`/${adminPath}/sitemap`)} — this page</li>
<li>👨‍🍳 Chef AI agent: the chat button inside the admin page (API below)</li></ul></section>
<section><h2>Dish pages (${dishes.length})</h2><ul>${dishes
        .map((d) => `<li>${link(`/?dish=${encodeURIComponent(d.id)}`)} — <span dir="auto">${esc(d.name_ar)}</span>${d.name_en ? ` · ${esc(d.name_en)}` : ""}${d.is_visible ? "" : " <b>(hidden)</b>"}</li>`)
        .join("")}</ul></section>
<section><h2>Public API</h2><table>${rows(PUBLIC_API)}</table></section>
<section><h2>Admin API (needs the admin cookie)</h2><table>${rows(ADMIN_API)}</table></section>
</main></body></html>`);
    });
  }

  return router;
}

module.exports = { sitemapRouter };
