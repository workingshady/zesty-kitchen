// Entry point for Vercel (exports the app). Locally, `npm start` runs server.js instead.
const express = require("express");

let app;
try {
  const { createApp } = require("./src/create-app");
  const { createStore } = require("./src/db");
  app = createApp({ db: createStore() });
} catch (err) {
  // Surface startup errors instead of an opaque FUNCTION_INVOCATION_FAILED
  console.error("Startup failed:", err);
  app = express();
  app.use((req, res) => res.status(500).json({ error: "Startup failed", detail: err.message }));
}

module.exports = app;
