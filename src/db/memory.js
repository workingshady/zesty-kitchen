// In-memory store with the same interface as the Supabase store. Used for local dev and tests.
const crypto = require("crypto");
const { SEED_DISHES } = require("./seed");

function createMemoryStore({ seed = true } = {}) {
  const now = () => new Date().toISOString();
  let dishes = seed ? SEED_DISHES.map((d, i) => ({ ...d, id: crypto.randomUUID(), photo_path: null, is_visible: true, sort_order: i, created_at: now() })) : [];
  let reviews = [];
  let orders = [];
  const players = [];
  const scores = [];
  const settings = new Map();
  const photos = new Map();
  let orderCounter = 1000;

  const sortDishes = (list) => [...list].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  const newestFirst = (list) => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    kind: "memory",
    async listDishes() {
      return sortDishes(dishes);
    },
    async getDish(id) {
      return dishes.find((d) => d.id === id) || null;
    },
    async createDish(fields) {
      const dish = { badges: [], description: "", photo_path: null, is_visible: true, sort_order: dishes.length, ...fields, id: crypto.randomUUID(), created_at: now() };
      dishes.push(dish);
      return dish;
    },
    async updateDish(id, fields) {
      const dish = dishes.find((d) => d.id === id);
      if (!dish) return null;
      Object.assign(dish, fields);
      return dish;
    },
    async deleteDish(id) {
      const before = dishes.length;
      dishes = dishes.filter((d) => d.id !== id);
      reviews = reviews.filter((r) => r.dish_id !== id);
      return dishes.length < before;
    },
    async reorderDishes(ids) {
      ids.forEach((id, i) => {
        const dish = dishes.find((d) => d.id === id);
        if (dish) dish.sort_order = i;
      });
    },
    async listReviews(dishId) {
      return newestFirst(dishId ? reviews.filter((r) => r.dish_id === dishId) : reviews);
    },
    async createReview(fields) {
      const review = { ...fields, id: crypto.randomUUID(), reactions: {}, created_at: now() };
      reviews.push(review);
      return review;
    },
    async deleteReview(id) {
      const before = reviews.length;
      reviews = reviews.filter((r) => r.id !== id);
      return reviews.length < before;
    },
    async reactToReview(id, emoji) {
      const review = reviews.find((r) => r.id === id);
      if (!review) return null;
      review.reactions[emoji] = (review.reactions[emoji] || 0) + 1;
      return review;
    },
    async createOrder(fields) {
      const order = { ...fields, id: crypto.randomUUID(), order_number: ++orderCounter, created_at: now() };
      orders.push(order);
      return order;
    },
    async listOrders(since) {
      return newestFirst(since ? orders.filter((o) => o.created_at >= since) : orders);
    },
    async deleteOrder(id) {
      const before = orders.length;
      orders = orders.filter((o) => o.id !== id);
      return orders.length < before;
    },
    // ---- arcade: players (nickname + hashed PIN) and scores ----
    async getPlayer(nicknameKey) {
      return players.find((p) => p.nickname_key === nicknameKey) || null;
    },
    async createPlayer(fields) {
      const player = { ...fields, id: crypto.randomUUID(), created_at: now() };
      players.push(player);
      return player;
    },
    async addScore(fields) {
      const row = { ...fields, id: crypto.randomUUID(), created_at: now() };
      scores.push(row);
      return row;
    },
    async topScores(game, limit = 300) {
      return scores
        .filter((s) => s.game === game)
        .sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
        .slice(0, limit)
        .map((s) => ({ ...s, nickname: players.find((p) => p.id === s.player_id)?.nickname || "?" }));
    },
    async getSetting(key) {
      return settings.has(key) ? settings.get(key) : null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },
    async uploadPhoto(path, buffer, contentType) {
      photos.set(path, { buffer, contentType });
    },
    async deletePhoto(path) {
      photos.delete(path);
    },
    photoUrl(path) {
      return path ? `/dev-photos/${path}` : null;
    },
    getDevPhoto(path) {
      return photos.get(path) || null;
    },
  };
}

module.exports = { createMemoryStore };
