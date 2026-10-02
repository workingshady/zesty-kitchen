// Supabase-backed store. Only the server holds the secret key; the browser never talks to Supabase.
const { createClient } = require("@supabase/supabase-js");

const BUCKET = "dishes";
const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));

const EXTRA_COLUMNS = ["job_title", "catchphrase", "warnings", "spice_level", "calories"];
const withoutExtras = (fields) => Object.fromEntries(Object.entries(fields).filter(([k]) => !EXTRA_COLUMNS.includes(k)));
const missingColumn = (res) => res.error?.code === "42703" || res.error?.code === "PGRST204";

function createSupabaseStore({ url, secretKey }) {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const unwrap = ({ data, error }) => {
    if (error) {
      const err = new Error(`Database error: ${error.message}`);
      err.status = 503;
      throw err;
    }
    return data;
  };

  return {
    kind: "supabase",
    async listDishes() {
      return unwrap(await sb.from("dishes").select("*").order("sort_order").order("created_at"));
    },
    async getDish(id) {
      if (!isUuid(id)) return null;
      return unwrap(await sb.from("dishes").select("*").eq("id", id).maybeSingle());
    },
    async createDish(fields) {
      let res = await sb.from("dishes").insert(fields).select().single();
      if (missingColumn(res)) res = await sb.from("dishes").insert(withoutExtras(fields)).select().single();
      return unwrap(res);
    },
    async updateDish(id, fields) {
      if (!isUuid(id)) return null;
      let res = await sb.from("dishes").update(fields).eq("id", id).select().maybeSingle();
      if (missingColumn(res)) res = await sb.from("dishes").update(withoutExtras(fields)).eq("id", id).select().maybeSingle();
      return unwrap(res);
    },
    async deleteDish(id) {
      if (!isUuid(id)) return false;
      return unwrap(await sb.from("dishes").delete().eq("id", id).select("id")).length > 0;
    },
    async reorderDishes(ids) {
      await Promise.all(ids.filter(isUuid).map((id, i) => sb.from("dishes").update({ sort_order: i }).eq("id", id).then(unwrap)));
    },
    async listReviews(dishId) {
      let q = sb.from("reviews").select("*").order("created_at", { ascending: false });
      if (dishId) q = q.eq("dish_id", dishId);
      return unwrap(await q);
    },
    async createReview(fields) {
      return unwrap(await sb.from("reviews").insert(fields).select().single());
    },
    async deleteReview(id) {
      if (!isUuid(id)) return false;
      return unwrap(await sb.from("reviews").delete().eq("id", id).select("id")).length > 0;
    },
    async reactToReview(id, emoji) {
      if (!isUuid(id)) return null;
      return unwrap(await sb.rpc("react_to_review", { review_id: id, emoji })) || null;
    },
    async createOrder(fields) {
      return unwrap(await sb.from("orders").insert(fields).select().single());
    },
    async listOrders(since) {
      let q = sb.from("orders").select("*").order("created_at", { ascending: false }).limit(1000);
      if (since) q = q.gte("created_at", since);
      return unwrap(await q);
    },
    async getSetting(key) {
      const row = unwrap(await sb.from("settings").select("value").eq("key", key).maybeSingle());
      return row ? row.value : null;
    },
    async setSetting(key, value) {
      unwrap(await sb.from("settings").upsert({ key, value }));
    },
    async uploadPhoto(path, buffer, contentType) {
      unwrap(await sb.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true, cacheControl: "31536000" }));
    },
    async deletePhoto(path) {
      await sb.storage.from(BUCKET).remove([path]);
    },
    photoUrl(path) {
      return path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
    },
  };
}

module.exports = { createSupabaseStore };
