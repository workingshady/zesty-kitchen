// Entry point for Vercel (exports the app). Locally / on a VM, `npm start` runs server.js instead.
const { createApp } = require("./src/app");
const { createStore } = require("./src/db");

module.exports = createApp({ db: createStore() });
