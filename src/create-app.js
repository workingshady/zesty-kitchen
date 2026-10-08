const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const { publicRouter } = require("./routes/public");
const { adminRouter } = require("./routes/admin");
const { aiRouter } = require("./routes/ai");
const { gamesRouter } = require("./routes/games");
const { sitemapRouter } = require("./routes/sitemap");
const { agentRouter } = require("./routes/agent");
const { createAi } = require("./ai");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const VIEWS_DIR = path.join(__dirname, "..", "views");

function createApp({ db, env = process.env, ai = createAi(env) }) {
  const app = express();
  const isProd = env.NODE_ENV === "production";
  const adminPath = (env.ADMIN_PATH || "").replace(/^\/+|\/+$/g, "");
  const adminEnabled = Boolean(adminPath && env.ADMIN_PASSWORD);
  const state = { shuttingDown: false };
  app.locals.state = state;

  // Render sits behind a proxy; trust it so req.ip (rate limits) and secure cookies work
  app.set("trust proxy", 1);

  const imgSrc = ["'self'", "data:", "blob:"];
  if (env.SUPABASE_URL) imgSrc.push(new URL(env.SUPABASE_URL).origin);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc,
          connectSrc: ["'self'"],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (req, res) => {
    if (state.shuttingDown) return res.status(503).json({ status: "shutting down" });
    res.json({ status: "ok", store: db.kind });
  });

  app.use("/api/ai", aiRouter(db, ai));
  app.use("/api/games", gamesRouter(db));
  app.use(sitemapRouter({ db, adminPath: adminEnabled ? adminPath : "", sessionSecret: env.SESSION_SECRET || env.ADMIN_PASSWORD }));
  app.use("/api/agent", agentRouter(db, ai));
  app.use("/api", publicRouter(db));

  if (adminEnabled) {
    app.use(
      "/api/admin",
      adminRouter(db, {
        password: env.ADMIN_PASSWORD,
        sessionSecret: env.SESSION_SECRET || env.ADMIN_PASSWORD,
        secureCookies: isProd,
        ai,
      }),
    );
    const adminHtml = fs.readFileSync(path.join(VIEWS_DIR, "admin.html"), "utf8").replace("__ADMIN_PATH__", adminPath);
    app.get(`/${adminPath}`, (req, res) => res.set("X-Robots-Tag", "noindex").type("html").send(adminHtml));
    const adminJs = fs.readFileSync(path.join(VIEWS_DIR, "admin.js"), "utf8");
    app.get(`/${adminPath}/admin.js`, (req, res) => res.type("js").send(adminJs));
  } else {
    console.warn("ADMIN_PATH / ADMIN_PASSWORD not set: admin page disabled");
  }

  if (db.getDevPhoto) {
    app.get("/dev-photos/:dir/:file", (req, res) => {
      const photo = db.getDevPhoto(`${req.params.dir}/${req.params.file}`);
      if (!photo) return res.status(404).end();
      res.type(photo.contentType).send(photo.buffer);
    });
  }

  // On Vercel the CDN serves public/ and this is a no-op; locally it serves the pages
  app.use(express.static(PUBLIC_DIR, { maxAge: isProd ? "1h" : 0, extensions: ["html"] }));

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
  // public/ lives on the CDN in Vercel (not inside the function), so send a tiny page that hops to /404
  app.use((req, res) =>
    res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/404"><title>Dish not found</title><a href="/404">Dish not found 💀</a>`),
  );

  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Photo is too big (max 4 MB)" });
    if (status >= 500) console.error(err);
    const message = status === 503 ? "The chef dropped the plate 🍽️💥 try again" : status < 500 ? err.message : "Something went wrong";
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
