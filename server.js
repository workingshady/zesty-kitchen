const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
let isShuttingDown = false;

// Render sits behind a proxy; trust it so req.ip and req.protocol are correct
app.set("trust proxy", 1);

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/api/health", (req, res) => {
  if (isShuttingDown) return res.status(503).json({ status: "shutting down" });
  res.json({ status: "ok" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Something went wrong" });
});

const server = app.listen(PORT, () => {
  console.log(`Zesty Kitchen running on http://localhost:${PORT}`);
});

// Render sends SIGTERM on every deploy; finish in-flight requests before exiting
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  isShuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
