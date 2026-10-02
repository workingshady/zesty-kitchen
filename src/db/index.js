const { createMemoryStore } = require("./memory");
const { createSupabaseStore } = require("./supabase");

function createStore(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
    return createSupabaseStore({ url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });
  }
  console.warn("SUPABASE_URL / SUPABASE_SECRET_KEY not set: using in-memory store (data resets on restart)");
  return createMemoryStore();
}

module.exports = { createStore };
