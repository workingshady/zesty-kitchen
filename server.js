const { createApp } = require("./src/app");
const { createStore } = require("./src/db");

const PORT = process.env.PORT || 3000;
const app = createApp({ db: createStore() });

const server = app.listen(PORT, () => {
  console.log(`Zesty Kitchen running on http://localhost:${PORT}`);
});

// Render sends SIGTERM on every deploy; finish in-flight requests before exiting
function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  app.locals.state.shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
