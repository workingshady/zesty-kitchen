// 404 Arcade: four tiny canvas games starring your coworkers' faces.
// Flappy-Face · Catch the Mandi · Whack-a-Coworker · Shawarma Snake
import { $, esc, play, getDishes, store, calm } from "/js/common.js";

// ---------- constants + helpers ----------
const W = 360;
const H = 480;
const INK = "#111111";
const CREAM = "#fff4e0";
const MUSTARD = "#ffc700";
const PINK = "#ff69b4";
const SLIME = "#8ace00";
const SKY = "#7fd3ff";
const KETCHUP = "#ff3b30";
const PAL = [MUSTARD, PINK, SLIME, SKY, KETCHUP];
const DISPLAY = '"Lalezar", "Baloo Bhaijaan 2", system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randi = (n) => Math.floor(Math.random() * n);
const pickOne = (list) => list[randi(list.length)];
const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const hitRect = (cx, cy, r, x, y, w, h) => {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
};

// ---------- canvas (high-DPI, fixed 360x480 logical space) ----------
const canvas = $("#game");
const ctx = canvas.getContext("2d");
const frameEl = $("#frame");
let scale = 1;
function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.width * (H / W) * dpr);
  scale = canvas.width / W;
}
new ResizeObserver(resize).observe(canvas);
resize();

function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
function label(text, x, y, size, fill = MUSTARD, align = "center", stroke = INK) {
  ctx.font = `${size}px ${DISPLAY}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  if (stroke) {
    ctx.lineWidth = size < 20 ? 3 : size / 6;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// ---------- sprites (emoji + round coworker faces, pre-rendered once) ----------
const emojiCache = new Map();
function emojiSprite(ch) {
  if (emojiCache.has(ch)) return emojiCache.get(ch);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.font = `96px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(ch, 64, 70);
  emojiCache.set(ch, c);
  return c;
}
function faceSprite(img) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(64, 64, 64, 0, Math.PI * 2);
  g.clip();
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  // faces usually sit in the upper-middle of a portrait photo
  const sy = img.naturalHeight > img.naturalWidth ? (img.naturalHeight - s) * 0.3 : (img.naturalHeight - s) / 2;
  g.drawImage(img, (img.naturalWidth - s) / 2, sy, s, s, 0, 0, 128, 128);
  return c;
}
function drawEmoji(ch, x, y, size, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.drawImage(emojiSprite(ch), -size / 2, -size / 2, size, size);
  ctx.restore();
}
// A character's round face: photo if loaded, emoji on a colored disc otherwise.
function drawFace(who, x, y, r, { rot = 0, ring = INK, sx = 1, sy = 1, lw = 3 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(sx, sy);
  if (who.sprite) {
    ctx.drawImage(who.sprite, -r, -r, r * 2, r * 2);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = who.bg || MUSTARD;
    ctx.fill();
    ctx.drawImage(emojiSprite(who.emoji), -r * 0.92, -r * 0.92, r * 1.84, r * 1.84);
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
}

// ---------- juice: particles, floating text, shake, hit-stop, flash ----------
const fx = { parts: [], texts: [], trauma: 0, stop: 0, flash: 0 };
function burst(x, y, { n = 14, colors = PAL, speed = 200, size = 5, grav = 500, life = 0.7, emoji = null } = {}) {
  const count = calm() ? Math.ceil(n * 0.3) : n;
  for (let i = 0; i < count && fx.parts.length < 320; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(0.35, 1) * speed;
    fx.parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.25, grav,
      life: rand(0.6, 1) * life, max: life, size: rand(0.6, 1.3) * size,
      color: pickOne(colors), rot: rand(0, 6), vr: rand(-8, 8), emoji,
    });
  }
}
function popText(x, y, text, color = MUSTARD, size = 22) {
  fx.texts.push({ x, y, text, color, size, t: 0 });
}
function shake(amount) {
  if (!calm()) fx.trauma = Math.min(1, fx.trauma + amount);
}
function hitstop(ms) {
  fx.stop = Math.max(fx.stop, ms / 1000);
}
function flash(a = 0.6) {
  if (!calm()) fx.flash = a;
}
function clearFx() {
  fx.parts.length = 0;
  fx.texts.length = 0;
  fx.trauma = fx.stop = fx.flash = 0;
}
function updateFx(dt) {
  for (const p of fx.parts) {
    p.vy += p.grav * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    p.life -= dt;
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);
  for (const t of fx.texts) {
    t.t += dt;
    t.y -= 42 * dt;
  }
  fx.texts = fx.texts.filter((t) => t.t < 0.9);
  fx.trauma = Math.max(0, fx.trauma - dt * 1.8);
  fx.flash = Math.max(0, fx.flash - dt * 3);
}
function drawFx() {
  for (const p of fx.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    if (p.emoji) {
      drawEmoji(p.emoji, p.x, p.y, p.size * 3, p.rot);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = INK;
      ctx.strokeRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  for (const t of fx.texts) {
    const k = t.t < 0.12 ? easeOutBack(t.t / 0.12) : 1;
    ctx.globalAlpha = clamp(1.6 - t.t * 1.8, 0, 1);
    label(t.text, t.x, t.y, t.size * k, t.color);
  }
  ctx.globalAlpha = 1;
}

// ---------- characters ----------
const BUILTINS = [
  { id: "chef", label: "Chef", ar: "الشيف", emoji: "👨‍🍳", bg: "#ffffff" },
  { id: "courier", label: "Courier", ar: "الطيار", emoji: "🛵", bg: SKY },
  { id: "chicken", label: "Fried chicken", ar: "فرخة", emoji: "🍗", bg: MUSTARD },
  { id: "falafel", label: "Ta'meya", ar: "طعمية", emoji: "🧆", bg: SLIME },
];
const FOODS = ["🍔", "🌯", "🍕", "🥙", "🍗", "🧆", "🥘", "🍝", "🫓", "🍟"];
let coworkers = [];
let player = BUILTINS[0];

function loadSprite(who) {
  if (!who.photo) return;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    try {
      who.sprite = faceSprite(img);
    } catch {
      /* broken image: keep emoji */
    }
  };
  img.src = who.photo;
}
// Food the games throw around: coworkers if we have any, otherwise plain emoji dishes.
function randomDish() {
  const pool = coworkers.filter((c) => c.id !== player.id);
  if (pool.length) return pickOne(pool);
  const e = pickOne(FOODS);
  return { id: "food-" + e, label: e, emoji: e, bg: pickOne(PAL) };
}

// ---------- persistence ----------
const KEY = { game: "zk_arcade_game", char: "zk_arcade_char", best: "zk_arcade_best", lb: "zk_arcade_lb", ach: "zk_arcade_ach", stats: "zk_arcade_stats", ini: "zk_arcade_initials", nick: "zk_arcade_nick", pin: "zk_arcade_pin", skip: "zk_arcade_nick_skip" };
const bests = store.get(KEY.best, {});
const boards = store.get(KEY.lb, {});
const unlocked = new Set(store.get(KEY.ach, []));
const stats = Object.assign({ coins: 0, played: {} }, store.get(KEY.stats, {}));
const saveStats = () => store.set(KEY.stats, stats);

const ACH = {
  firstL: ["💀", "First L", "أول خسارة. مبروك"],
  flyer: ["🪽", "Frequent flyer: 15 in Flappy", "طيار محترف"],
  rich: ["🪙", "Bag secured: 30 coins total", "لميت الفلوس"],
  combo: ["🔥", "Combo chef: x15 in Catch", "شيف كومبو"],
  hr: ["🥄", "HR wants a word: 25 whacks", "الـHR عايزك"],
  selfown: ["🤡", "Self-own: whacked yourself", "ضربت نفسك يا فنان"],
  mega: ["🌯", "Mega shawarma: length 20", "شاورما سوبر لوكس"],
  rat: ["🕹️", "Arcade rat: played all 4", "مدمن أركيد"],
  owl: ["🦉", "Should be asleep (12–5am)", "نام يا حبيبي"],
};
function unlock(id) {
  if (unlocked.has(id) || !ACH[id]) return;
  unlocked.add(id);
  store.set(KEY.ach, [...unlocked]);
  const [icon, en, ar] = ACH[id];
  toast(icon, `Achievement: ${en}`, ar);
  play("ding");
  renderAch();
}

// ---------- runtime state ----------
const run = { score: 0, reason: "" };
let state = "ready"; // ready | play | paused | over
let game = null;

// =====================================================================
// 1) FLAPPY-FACE
// =====================================================================
const GROUND = 440;
const PW = 58;
const flappy = {
  id: "flappy", icon: "🪽", name: "Flappy-Face", ar: "الوش الطاير",
  blurb: "Fly between plate towers and kofta skewers. Grab the coins.",
  help: "Tap · click · Space / ↑ to flap",
  quips: ["Plates 1 · You 0", "Gravity said no · الجاذبية قالت لأ", "Flew like a brick · طرت زي الطوبة", "The kofta won · الكفتة كسبت"],
  reset() {
    this.b = { x: 96, y: 220, vy: 0, r: 19, rot: 0 };
    this.pipes = [];
    this.coins = [];
    this.t = 0;
    this.scroll = this.scroll || 0;
    this.spawn = 0.3;
    this.started = false;
    this.dead = false;
    this.deadT = 0;
    this.passed = 0;
    this.got = 0;
    run.score = 0;
  },
  speed() {
    return Math.min(235, 145 + Math.floor(this.passed / 5) * 12);
  },
  gap() {
    return Math.max(122, 172 - this.passed * 2);
  },
  flap() {
    if (this.dead) return;
    this.started = true;
    this.b.vy = -365;
    play("tick");
    burst(this.b.x - 14, this.b.y + 10, { n: 5, colors: ["#ffffff", CREAM], speed: 70, grav: 0, life: 0.35, size: 5 });
  },
  press() {
    this.flap();
  },
  key(code, down) {
    if (down && (code === "Space" || code === "ArrowUp" || code === "KeyW")) this.flap();
  },
  idle(dt) {
    this.t += dt;
    if (this.dead) return;
    this.scroll += 40 * dt;
    this.b.y = 220 + Math.sin(this.t * 4) * 8;
  },
  die(why) {
    if (this.dead) return;
    this.dead = true;
    run.reason = why;
    this.b.vy = -260;
    shake(0.75);
    hitstop(120);
    flash(0.7);
    burst(this.b.x, this.b.y, { n: 28, speed: 280 });
    play("fail");
  },
  update(dt) {
    const b = this.b;
    this.t += dt;
    const sp = this.dead ? 0 : this.started ? this.speed() : 70;
    this.scroll += sp * dt;
    if (!this.started) {
      b.y = 220 + Math.sin(this.t * 4) * 8;
      b.rot = 0;
      return;
    }
    b.vy = Math.min(b.vy + 1250 * dt, 640);
    b.y += b.vy * dt;
    const target = clamp(b.vy / 520, -0.45, 1.3);
    b.rot += (target - b.rot) * Math.min(1, dt * 12);
    if (this.dead) {
      this.deadT += dt;
      if (b.y > GROUND - b.r) {
        b.y = GROUND - b.r;
        b.vy = 0;
      }
      if (this.deadT > 0.85) finish();
      return;
    }
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const gap = this.gap();
      const top = 46 + Math.random() * (GROUND - gap - 96);
      this.pipes.push({ x: W + 10, top, gap, kind: Math.random() < 0.5 ? "plates" : "kofta", scored: false });
      if (Math.random() < 0.65) this.coins.push({ x: W + 10 + PW / 2 + 108, y: clamp(top + gap / 2 + rand(-40, 40), 40, GROUND - 40), got: false });
      this.spawn = 218 / sp;
    }
    for (const p of this.pipes) {
      p.x -= sp * dt;
      if (!p.scored && p.x + PW < b.x - b.r) {
        p.scored = true;
        this.passed++;
        run.score++;
        play("pop");
        if (this.passed % 10 === 0) {
          popText(W / 2, 120, "Speed up · أسرع", PINK, 24);
          play("whoosh");
        }
        if (this.passed >= 15) unlock("flyer");
      }
      const r = b.r * 0.82; // a little forgiveness feels fair
      if (hitRect(b.x, b.y, r, p.x, -300, PW, p.top + 300) || hitRect(b.x, b.y, r, p.x, p.top + p.gap, PW, GROUND)) {
        this.die(p.kind === "kofta" ? "Skewered by kofta · اتشكيت في سيخ كفتة" : "Plates 1 · You 0 · الأطباق كسبت");
        return;
      }
    }
    for (const c of this.coins) {
      c.x -= sp * dt;
      if (!c.got && (c.x - b.x) ** 2 + (c.y - b.y) ** 2 < (b.r + 13) ** 2) {
        c.got = true;
        this.got++;
        run.score++;
        stats.coins++;
        saveStats();
        if (stats.coins >= 30) unlock("rich");
        popText(c.x, c.y - 10, "+1", MUSTARD, 20);
        burst(c.x, c.y, { n: 10, colors: [MUSTARD, "#fff2a8"], speed: 160, size: 4 });
        play("pop");
      }
    }
    this.pipes = this.pipes.filter((p) => p.x > -PW - 10);
    this.coins = this.coins.filter((c) => !c.got && c.x > -20);
    if (b.y > GROUND - b.r) this.die("Gravity said no · الجاذبية قالت لأ");
  },
  drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, SKY);
    g.addColorStop(1, "#d6f1ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // sun
    ctx.beginPath();
    ctx.arc(296, 74, 30, 0, Math.PI * 2);
    ctx.fillStyle = MUSTARD;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // clouds
    let o = (this.scroll * 0.18 + this.t * 6) % 300;
    for (let x = -o; x < W + 300; x += 300) {
      cloud(x + 40, 110, 1);
      cloud(x + 200, 60, 0.7);
    }
    // pyramids (far)
    o = (this.scroll * 0.12) % 280;
    for (let x = -o - 280; x < W + 280; x += 280) {
      pyramid(x + 60, GROUND - 46, 130);
      pyramid(x + 170, GROUND - 46, 80);
    }
    // skyline + minaret (mid)
    o = (this.scroll * 0.4) % 240;
    const blocks = [[0, 40, 96, PINK], [44, 30, 140, "#ffffff"], [78, 50, 74, MUSTARD], [134, 34, 116, SKY], [172, 62, 88, SLIME]];
    for (let x = -o - 240; x < W + 240; x += 240) {
      for (const [bx, bw, bh, col] of blocks) {
        const yy = GROUND - bh;
        ctx.fillStyle = col;
        ctx.fillRect(x + bx, yy, bw, bh);
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.strokeRect(x + bx, yy, bw, bh);
        ctx.fillStyle = INK;
        for (let wy = yy + 10; wy < GROUND - 14; wy += 18) for (let wx = x + bx + 7; wx < x + bx + bw - 8; wx += 12) ctx.fillRect(wx, wy, 5, 7);
      }
      // minaret
      const mx = x + 118;
      ctx.fillStyle = CREAM;
      ctx.fillRect(mx, GROUND - 170, 12, 170);
      ctx.strokeRect(mx, GROUND - 170, 12, 170);
      ctx.beginPath();
      ctx.arc(mx + 6, GROUND - 170, 9, Math.PI, 0);
      ctx.fill();
      ctx.stroke();
    }
  },
  drawGround() {
    ctx.fillStyle = "#e7b25a";
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = SLIME;
    ctx.fillRect(0, GROUND, W, 10);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    ctx.lineTo(W, GROUND);
    ctx.moveTo(0, GROUND + 10);
    ctx.lineTo(W, GROUND + 10);
    ctx.stroke();
    ctx.lineWidth = 2;
    const o = this.scroll % 24;
    ctx.beginPath();
    for (let x = -o; x < W + 24; x += 24) {
      ctx.moveTo(x, GROUND + 10);
      ctx.lineTo(x - 12, H);
    }
    ctx.stroke();
  },
  draw() {
    this.drawBg();
    for (const p of this.pipes) {
      if (p.kind === "plates") {
        plates(p.x, -10, p.top, true);
        plates(p.x, p.top + p.gap, GROUND, false);
      } else {
        skewer(p.x, -10, p.top, true);
        skewer(p.x, p.top + p.gap, GROUND, false);
      }
    }
    for (const c of this.coins) coin(c.x, c.y, this.t);
    this.drawGround();
    const b = this.b;
    drawFace(player, b.x, b.y, b.r, { rot: b.rot, sx: 1 + Math.max(0, -b.vy) / 4000, sy: 1 - Math.max(0, -b.vy) / 4000 });
    if (state === "play" && !this.started) {
      const k = 1 + Math.sin(this.t * 6) * 0.06;
      label("Tap to flap", W / 2, 300, 30 * k, "#ffffff");
      label("دوس عشان تطير", W / 2, 336, 20, PINK);
    }
  },
};
function cloud(x, y, s) {
  ctx.beginPath();
  ctx.ellipse(x, y, 34 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22 * s, y - 8 * s, 22 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
function pyramid(cx, base, w) {
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, base);
  ctx.lineTo(cx, base - w * 0.62);
  ctx.lineTo(cx + w / 2, base);
  ctx.closePath();
  ctx.fillStyle = "#f2c879";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, base - w * 0.62);
  ctx.lineTo(cx + w * 0.12, base);
  ctx.lineWidth = 2;
  ctx.stroke();
}
function plates(x, y0, y1, capBottom) {
  if (y1 <= y0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8, y0, PW + 16, y1 - y0);
  ctx.clip();
  const ph = 13;
  let i = 0;
  const one = (y) => {
    rr(x - 4, y, PW + 8, ph, 6);
    ctx.fillStyle = i++ % 3 === 2 ? "#ffd1e8" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 6, y + ph * 0.5);
    ctx.lineTo(x + PW - 6, y + ph * 0.5);
    ctx.lineWidth = 2;
    ctx.strokeStyle = SKY;
    ctx.stroke();
  };
  if (capBottom) for (let y = y1 - ph; y > y0 - ph; y -= ph) one(y);
  else for (let y = y0; y < y1; y += ph) one(y);
  ctx.restore();
}
function skewer(x, y0, y1, tipBottom) {
  if (y1 <= y0) return;
  const cx = x + PW / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8, y0, PW + 16, y1 - y0);
  ctx.clip();
  ctx.fillStyle = "#c9ced6";
  ctx.fillRect(cx - 3, y0, 6, y1 - y0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeRect(cx - 3, y0, 6, y1 - y0);
  const step = 32;
  let i = 0;
  const piece = (y) => {
    const kind = i++ % 3;
    ctx.beginPath();
    if (kind === 1) ctx.ellipse(cx, y, PW / 2 - 6, 8, 0, 0, Math.PI * 2);
    else if (kind === 2) ctx.arc(cx, y, 12, 0, Math.PI * 2);
    else ctx.ellipse(cx, y, PW / 2 + 2, 14, 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === 1 ? "#f7f0ff" : kind === 2 ? KETCHUP : "#8a4b24";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (kind === 0) {
      ctx.strokeStyle = "#5a2d12";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 12, y - 4);
      ctx.lineTo(cx - 4, y + 6);
      ctx.moveTo(cx + 4, y - 6);
      ctx.lineTo(cx + 12, y + 4);
      ctx.stroke();
    }
  };
  if (tipBottom) for (let y = y1 - 34; y > y0 - step; y -= step) piece(y);
  else for (let y = y0 + 34; y < y1 + step; y += step) piece(y);
  // pointy metal tip facing the gap
  const ty = tipBottom ? y1 : y0;
  const dir = tipBottom ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(cx - 5, ty + dir * 14);
  ctx.lineTo(cx, ty);
  ctx.lineTo(cx + 5, ty + dir * 14);
  ctx.closePath();
  ctx.fillStyle = "#e9edf2";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}
function coin(x, y, t) {
  const sx = Math.max(0.15, Math.abs(Math.cos(t * 4 + x * 0.02)));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = MUSTARD;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = `16px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.fillText("ج", 0, 1);
  ctx.restore();
}

// =====================================================================
// 2) CATCH THE MANDI
// =====================================================================
const PLATE_Y = 432;
const PLATE_W = 96;
const catcher = {
  id: "catch", icon: "🍽️", name: "Catch the Mandi", ar: "الحق المندي",
  blurb: "Catch falling coworkers on your plate. Dodge 🌶️ and bills. Chain catches for combos.",
  help: "Drag · move mouse · ← → / A D",
  quips: ["Butterfingers · إيدك سايبة", "Too spicy to handle · حراق أوي"],
  reset() {
    this.x = this.tx = W / 2;
    this.items = [];
    this.spawn = 0.6;
    this.t = 0;
    this.lives = 3;
    this.combo = 0;
    this.squash = 0;
    this.hurt = 0;
    this.left = this.right = false;
    this.drag = false;
    this.dead = false;
    this.deadT = 0;
    run.score = 0;
  },
  press(x) {
    this.drag = true;
    this.tx = x;
  },
  move(x, y, type) {
    if (this.drag || type === "mouse") this.tx = x;
  },
  release() {
    this.drag = false;
  },
  key(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;
  },
  idle(dt) {
    this.t += dt;
  },
  mult() {
    return Math.min(5, 1 + Math.floor(this.combo / 5));
  },
  update(dt) {
    this.t += dt;
    this.squash = Math.max(0, this.squash - dt * 5);
    this.hurt = Math.max(0, this.hurt - dt);
    if (this.left || this.right) this.tx = this.x + ((this.right ? 1 : 0) - (this.left ? 1 : 0)) * 60;
    this.tx = clamp(this.tx, PLATE_W / 2, W - PLATE_W / 2);
    this.x += (this.tx - this.x) * Math.min(1, dt * (this.left || this.right ? 9 : 16));
    if (this.dead) {
      this.deadT += dt;
      for (const it of this.items) it.y += it.vy * dt * 0.3;
      if (this.deadT > 0.7) finish();
      return;
    }
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const badChance = Math.min(0.4, 0.14 + this.t * 0.005);
      const r = Math.random();
      const kind = r < 0.045 ? "gold" : r < 0.045 + badChance ? (Math.random() < 0.55 ? "chili" : "bill") : "dish";
      this.items.push({
        kind, x: rand(24, W - 24), y: -30, vy: Math.min(430, 150 + this.t * 4.5 + rand(0, 70)),
        rot: rand(-0.4, 0.4), vr: rand(-2, 2), r: kind === "gold" ? 22 : 20, who: randomDish(), sway: rand(0, 6),
      });
      this.spawn = Math.max(0.3, 0.85 - this.t * 0.012) * rand(0.75, 1.2);
    }
    for (const it of this.items) {
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
      if (it.kind === "bill") it.x += Math.sin(this.t * 3 + it.sway) * 40 * dt;
      if (!it.done && it.y + it.r >= PLATE_Y - 8 && it.y < PLATE_Y + 12 && Math.abs(it.x - this.x) < PLATE_W / 2 + 8) {
        it.done = true;
        this.catchIt(it);
      } else if (!it.done && it.y > H + 30) {
        it.done = true;
        if (it.kind === "dish" || it.kind === "gold") {
          if (this.combo >= 5) popText(clamp(it.x, 40, W - 40), H - 70, "combo dropped", "#ffffff", 16);
          this.combo = 0;
        }
      }
    }
    this.items = this.items.filter((it) => !it.done);
  },
  catchIt(it) {
    if (it.kind === "chili" || it.kind === "bill") {
      this.lives--;
      this.combo = 0;
      this.hurt = 0.5;
      shake(0.5);
      hitstop(80);
      flash(0.4);
      burst(it.x, PLATE_Y - 10, { n: 14, colors: [KETCHUP, "#ff8a00", INK], speed: 220 });
      popText(this.x, PLATE_Y - 60, it.kind === "chili" ? "SPICY · حراق" : "THE BILL 💸", KETCHUP, 22);
      if (this.lives <= 0) {
        this.dead = true;
        run.reason = it.kind === "chili" ? "Too spicy to handle · حراق أوي" : "The bill caught YOU · الفاتورة مسكتك";
        play("fail");
      } else play("oof");
      return;
    }
    this.combo++;
    const pts = (it.kind === "gold" ? 5 : 1) * this.mult();
    run.score += pts;
    this.squash = 1;
    burst(it.x, PLATE_Y - 12, { n: it.kind === "gold" ? 20 : 10, colors: it.kind === "gold" ? [MUSTARD, "#fff2a8"] : PAL, speed: 190 });
    popText(it.x, PLATE_Y - 50, `+${pts}${this.mult() > 1 ? ` x${this.mult()}` : ""}`, it.kind === "gold" ? MUSTARD : SLIME, 22);
    play("pop");
    if (it.kind === "gold") play("coin");
    if (this.combo > 0 && this.combo % 10 === 0) {
      play("hype");
      popText(W / 2, 170, `COMBO ${this.combo} · عاش`, PINK, 28);
    }
    if (this.combo >= 15) unlock("combo");
  },
  draw() {
    // tiled kitchen wall
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#ecd7b6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 40) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PLATE_Y + 8);
    }
    for (let y = 0; y <= PLATE_Y; y += 40) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    // bunting
    for (let i = 0; i < 9; i++) {
      const x = i * 45 - 4;
      ctx.beginPath();
      ctx.moveTo(x, 34);
      ctx.lineTo(x + 40, 34);
      ctx.lineTo(x + 20, 62 + Math.sin(this.t * 2 + i) * 3);
      ctx.closePath();
      ctx.fillStyle = PAL[i % PAL.length];
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    // counter
    ctx.fillStyle = PINK;
    ctx.fillRect(0, PLATE_Y + 8, W, H - PLATE_Y);
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.strokeRect(-3, PLATE_Y + 8, W + 6, H);
    for (let x = 0; x < W; x += 30) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, PLATE_Y + 8, 15, H);
    }
    ctx.strokeRect(-3, PLATE_Y + 8, W + 6, H);
    for (const it of this.items) this.drawItem(it);
    // player face peeking over the plate
    const sq = this.squash;
    const sx = 1 + sq * 0.18;
    const sy = 1 - sq * 0.18;
    const hurtShake = this.hurt > 0 ? Math.sin(this.t * 60) * 4 * this.hurt : 0;
    drawFace(player, this.x + hurtShake, PLATE_Y - 20 + sq * 4, 24, { sx, sy, ring: this.hurt > 0 ? KETCHUP : INK });
    ctx.save();
    ctx.translate(this.x, PLATE_Y);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.ellipse(0, 0, PLATE_W / 2, 12, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -1, PLATE_W / 2 - 14, 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = SKY;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  },
  drawItem(it) {
    if (it.kind === "chili") return drawEmoji("🌶️", it.x, it.y, 46, it.rot);
    if (it.kind === "bill") {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rot);
      ctx.beginPath();
      ctx.moveTo(-15, -20);
      ctx.lineTo(15, -20);
      ctx.lineTo(15, 18);
      for (let i = 0; i < 5; i++) ctx.lineTo(15 - (i + 0.5) * 6, i % 2 ? 18 : 23);
      ctx.lineTo(-15, 18);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(-9, -12, 18, 3);
      ctx.fillRect(-9, -5, 12, 3);
      ctx.font = `12px ${DISPLAY}`;
      ctx.textAlign = "center";
      ctx.fillStyle = KETCHUP;
      ctx.fillText("999", 0, 10);
      ctx.restore();
      return;
    }
    if (it.kind === "gold") {
      drawFace(it.who, it.x, it.y, it.r, { rot: it.rot, ring: MUSTARD, lw: 5 });
      drawEmoji("👑", it.x, it.y - it.r - 6, 26, it.rot * 0.5);
      return;
    }
    drawFace(it.who, it.x, it.y, it.r, { rot: it.rot });
  },
  hud() {
    for (let i = 0; i < 3; i++) drawEmoji(i < this.lives ? "❤️" : "🖤", 22 + i * 26, 66, 24);
    if (this.combo >= 2) label(`x${this.mult()} · ${this.combo} combo`, W - 12, 66, 18, this.mult() > 1 ? PINK : "#ffffff", "right");
  },
};

// =====================================================================
// 3) WHACK-A-COWORKER
// =====================================================================
const HOLES = [];
for (const y of [214, 324, 434]) for (const x of [64, 180, 296]) HOLES.push({ x, y });
const ROUND = 30;
const whack = {
  id: "whack", icon: "🥄", name: "Whack-a-Coworker", ar: "اضرب زميلك",
  blurb: "Coworkers pop out of the pots. Bonk them. Don't bonk yourself. 30 seconds.",
  help: "Tap · click · keys 1–9 for the pots",
  quips: ["Performance review: done · التقييم خلص", "Time! HR is typing… · الوقت خلص"],
  reset() {
    this.time = ROUND;
    this.t = 0;
    this.moles = HOLES.map(() => ({ s: "down", t: 0, h: 0 }));
    this.spawn = 0.35;
    this.combo = 0;
    this.whacks = 0;
    this.spoon = { x: W / 2, y: 300, swing: 0, show: false };
    this.lastTick = ROUND;
    run.score = 0;
    run.reason = "";
  },
  idle(dt) {
    this.t += dt;
    this.spoon.swing = Math.max(0, this.spoon.swing - dt * 6);
  },
  move(x, y, type) {
    this.spoon.x = x;
    this.spoon.y = y;
    this.spoon.show = type === "mouse";
  },
  press(x, y, type) {
    this.spoon.x = x;
    this.spoon.y = y;
    this.spoon.show = type === "mouse" || this.spoon.show;
    this.swing(x, y);
  },
  key(code, down) {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (down && m) {
      const h = HOLES[+m[1] - 1];
      this.spoon.x = h.x + 24;
      this.spoon.y = h.y - 40;
      this.swing(h.x, h.y - 40, +m[1] - 1);
    }
  },
  swing(x, y, hole = -1) {
    this.spoon.swing = 1;
    let target = -1;
    let bestD = 46 ** 2;
    this.moles.forEach((m, i) => {
      if (m.s === "down" || m.s === "bonked" || m.h < 0.35) return;
      if (hole >= 0) {
        if (i === hole) target = i;
        return;
      }
      const h = HOLES[i];
      const d = (x - h.x) ** 2 + (y - (h.y + 34 - m.h * 62)) ** 2;
      if (d < bestD) (bestD = d), (target = i);
    });
    if (target < 0) {
      this.combo = 0;
      burst(x, y, { n: 6, colors: ["#d9c7a6", "#ffffff"], speed: 90, grav: 200, life: 0.4, size: 4 });
      play("tick");
      return;
    }
    const m = this.moles[target];
    const h = HOLES[target];
    m.s = "bonked";
    m.t = 0;
    const fy = h.y + 34 - m.h * 62;
    if (m.kind === "self") {
      run.score = Math.max(0, run.score - 3);
      this.combo = 0;
      shake(0.55);
      flash(0.45);
      popText(h.x, fy - 40, "That's you · ده انت", KETCHUP, 20);
      play("bruh");
      unlock("selfown");
      return;
    }
    this.combo++;
    this.whacks++;
    const pts = (m.kind === "gold" ? 5 : 1) * Math.min(4, 1 + Math.floor(this.combo / 5));
    run.score += pts;
    shake(0.18);
    hitstop(45);
    burst(h.x, fy, { n: 8, speed: 170, emoji: "⭐", size: 5, grav: 380 });
    burst(h.x, fy, { n: 8, speed: 220 });
    popText(h.x, fy - 40, `+${pts}`, m.kind === "gold" ? MUSTARD : SLIME, 24);
    play("bonk");
    if (this.whacks >= 25) unlock("hr");
  },
  update(dt) {
    this.t += dt;
    this.time -= dt;
    this.spoon.swing = Math.max(0, this.spoon.swing - dt * 6);
    const sec = Math.ceil(this.time);
    if (sec < this.lastTick && sec <= 5 && sec > 0) play("tick");
    this.lastTick = sec;
    if (this.time <= 0) {
      this.time = 0;
      run.reason = pickOne(this.quips);
      finish();
      return;
    }
    const prog = 1 - this.time / ROUND;
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const free = this.moles.map((m, i) => (m.s === "down" ? i : -1)).filter((i) => i >= 0);
      if (free.length) {
        const m = this.moles[pickOne(free)];
        const r = Math.random();
        m.kind = r < 0.1 + prog * 0.08 && prog > 0.1 ? "self" : r < 0.26 ? "gold" : "coworker";
        if (m.kind === "gold" && Math.random() < 0.6) m.kind = "coworker";
        m.who = m.kind === "self" ? player : randomDish();
        m.s = "rise";
        m.t = 0;
        m.stay = lerp(1.15, 0.6, prog) * rand(0.85, 1.15);
      }
      this.spawn = lerp(0.7, 0.32, prog) * rand(0.7, 1.2);
    }
    for (const m of this.moles) {
      m.t += dt;
      if (m.s === "rise") {
        m.h = easeOutBack(clamp(m.t / 0.16, 0, 1));
        if (m.t >= 0.16) (m.s = "up"), (m.t = 0);
      } else if (m.s === "up") {
        m.h = 1;
        if (m.t >= m.stay) {
          if (m.kind !== "self") this.combo = 0;
          (m.s = "sink"), (m.t = 0);
        }
      } else if (m.s === "bonked") {
        if (m.t >= 0.32) (m.s = "sink"), (m.t = 0);
      } else if (m.s === "sink") {
        m.h = 1 - easeOutCubic(clamp(m.t / 0.16, 0, 1));
        if (m.t >= 0.16) (m.s = "down"), (m.h = 0);
      }
    }
  },
  draw() {
    // striped tablecloth
    ctx.fillStyle = SLIME;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#a6e23a";
    for (let x = -H; x < W; x += 36) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 18, H);
      ctx.lineTo(x + 18 + H, 0);
      ctx.lineTo(x + H, 0);
      ctx.fill();
    }
    HOLES.forEach((h, i) => this.drawPot(h, this.moles[i], i));
    // wooden spoon "hammer"
    const sp = this.spoon;
    if (sp.show || sp.swing > 0) {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(-0.9 + sp.swing * 0.9);
      ctx.fillStyle = "#c98b4b";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      rr(-5, -6, 10, 64, 5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -18, 16, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  },
  drawPot(h, m, i) {
    const col = PAL[i % PAL.length];
    // inside of the pot
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, 46, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#2b2b2b";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // face rising out (clipped above the rim)
    if (m.h > 0.01) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(h.x - 60, h.y - 130, 120, 130);
      ctx.clip();
      const fy = h.y + 34 - m.h * 62;
      const bonk = m.s === "bonked";
      drawFace(m.who, h.x, fy, 30, { sx: bonk ? 1.15 : 1, sy: bonk ? 0.82 : 1, ring: m.kind === "gold" ? MUSTARD : m.kind === "self" ? KETCHUP : INK, lw: m.kind === "gold" ? 5 : 3 });
      if (m.kind === "gold") drawEmoji("👑", h.x, fy - 36, 26);
      if (m.kind === "self" && m.s !== "bonked") label("YOU", h.x, fy - 38, 16, KETCHUP, "center", "#ffffff");
      if (bonk) drawEmoji("💫", h.x + 18, fy - 30, 26, this.t * 6);
      ctx.restore();
    }
    // pot body + front rim
    ctx.beginPath();
    ctx.moveTo(h.x - 46, h.y);
    ctx.ellipse(h.x, h.y, 46, 13, 0, Math.PI, 0, true);
    ctx.lineTo(h.x + 42, h.y + 30);
    ctx.quadraticCurveTo(h.x + 40, h.y + 42, h.x + 26, h.y + 42);
    ctx.lineTo(h.x - 26, h.y + 42);
    ctx.quadraticCurveTo(h.x - 40, h.y + 42, h.x - 42, h.y + 30);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // handles
    for (const s of [-1, 1]) {
      rr(h.x + s * 46 - (s > 0 ? 0 : 12), h.y + 6, 12, 8, 4);
      ctx.fillStyle = "#444";
      ctx.fill();
      ctx.stroke();
    }
    // key hint
    ctx.font = `14px ${DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = INK;
    ctx.fillText(String(i + 1), h.x, h.y + 28);
  },
  hud() {
    const p = this.time / ROUND;
    rr(14, 58, W - 28, 14, 7);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (p > 0) {
      rr(14, 58, (W - 28) * p, 14, 7);
      ctx.fillStyle = this.time <= 5 ? KETCHUP : MUSTARD;
      ctx.fill();
      ctx.stroke();
    }
    label(`${Math.ceil(this.time)}s`, W - 18, 90, 18, this.time <= 5 ? KETCHUP : "#ffffff", "right");
    if (this.combo >= 3) label(`combo ${this.combo}`, 18, 90, 18, PINK, "left");
  },
};

// =====================================================================
// 4) SHAWARMA SNAKE
// =====================================================================
const CELL = 24;
const COLS = W / CELL; // 15
const ROWS = H / CELL; // 20
const snake = {
  id: "snake", icon: "🌯", name: "Shawarma Snake", ar: "لفة الشاورما",
  blurb: "You're a shawarma roll. Eat coworkers, grow longer, don't bite yourself.",
  help: "Swipe · tap a side · arrows / WASD",
  quips: ["Shawarma bit itself · الشاورما عضت نفسها", "Wall 1 · Shawarma 0 · خبطت في الحيطة"],
  reset() {
    this.body = [{ x: 7, y: 12 }, { x: 7, y: 13 }, { x: 7, y: 14 }];
    this.prev = this.body.map((s) => ({ ...s }));
    this.dir = { x: 0, y: -1 };
    this.queue = [];
    this.acc = 0;
    this.step = 0.17;
    this.grow = 0;
    this.eaten = 0;
    this.t = 0;
    this.dead = false;
    this.deadT = 0;
    this.toum = null;
    this.food = this.place(true);
    run.score = 0;
  },
  place(dish) {
    for (let tries = 0; tries < 300; tries++) {
      const c = { x: randi(COLS), y: 2 + randi(ROWS - 2) };
      const busy = this.body.some((s) => s.x === c.x && s.y === c.y) || (this.food && this.food.x === c.x && this.food.y === c.y) || (this.toum && this.toum.x === c.x && this.toum.y === c.y);
      if (!busy) return dish ? { ...c, who: randomDish(), t: 0 } : { ...c, life: 6 };
    }
    return { x: 0, y: 2, who: randomDish(), life: 6, t: 0 };
  },
  turn(dx, dy) {
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if ((dx === -last.x && dy === -last.y) || (dx === last.x && dy === last.y)) return;
    if (this.queue.length < 3) this.queue.push({ x: dx, y: dy });
  },
  key(code, down) {
    if (!down) return;
    if (code === "ArrowUp" || code === "KeyW") this.turn(0, -1);
    if (code === "ArrowDown" || code === "KeyS") this.turn(0, 1);
    if (code === "ArrowLeft" || code === "KeyA") this.turn(-1, 0);
    if (code === "ArrowRight" || code === "KeyD") this.turn(1, 0);
  },
  press(x, y) {
    this.touch = { x, y };
  },
  release(x, y) {
    if (!this.touch) return;
    const dx = x - this.touch.x;
    const dy = y - this.touch.y;
    this.touch = null;
    if (Math.hypot(dx, dy) > 22) {
      if (Math.abs(dx) > Math.abs(dy)) this.turn(Math.sign(dx), 0);
      else this.turn(0, Math.sign(dy));
      return;
    }
    // tap: turn toward the tapped side of the head
    const head = this.body[0];
    const hx = (head.x + 0.5) * CELL;
    const hy = (head.y + 0.5) * CELL;
    const d = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (d.y !== 0) this.turn(Math.sign(x - hx) || 1, 0);
    else this.turn(0, Math.sign(y - hy) || 1);
  },
  idle(dt) {
    this.t += dt;
  },
  die(why) {
    this.dead = true;
    run.reason = why;
    const h = this.body[0];
    shake(0.7);
    hitstop(110);
    flash(0.6);
    burst((h.x + 0.5) * CELL, (h.y + 0.5) * CELL, { n: 26, colors: ["#e9b872", "#8a4b24", "#ffffff", SLIME], speed: 250 });
    play("fail");
  },
  tick() {
    this.prev = this.body.map((s) => ({ ...s }));
    if (this.queue.length) this.dir = this.queue.shift();
    const h = this.body[0];
    const nh = { x: h.x + this.dir.x, y: h.y + this.dir.y };
    if (nh.x < 0 || nh.y < 0 || nh.x >= COLS || nh.y >= ROWS) return this.die("Wall 1 · Shawarma 0 · خبطت في الحيطة");
    const bodyToCheck = this.grow > 0 ? this.body : this.body.slice(0, -1);
    if (bodyToCheck.some((s) => s.x === nh.x && s.y === nh.y)) return this.die("Shawarma bit itself · الشاورما عضت نفسها");
    this.body.unshift(nh);
    if (this.grow > 0) this.grow--;
    else this.body.pop();
    const px = (nh.x + 0.5) * CELL;
    const py = (nh.y + 0.5) * CELL;
    if (nh.x === this.food.x && nh.y === this.food.y) {
      this.grow += 1;
      this.eaten++;
      run.score += 1;
      this.step = Math.max(0.075, this.step * 0.965);
      burst(px, py, { n: 12, speed: 170 });
      popText(px, py - 16, "+1", SLIME, 20);
      play(this.eaten % 5 === 0 ? "eat" : "pop");
      this.food = this.place(true);
      if (!this.toum && this.eaten % 4 === 0) this.toum = this.place(false);
    }
    if (this.toum && nh.x === this.toum.x && nh.y === this.toum.y) {
      this.grow += 2;
      run.score += 3;
      burst(px, py, { n: 16, colors: ["#ffffff", CREAM, MUSTARD], speed: 200 });
      popText(px, py - 16, "+3 toum · توم", "#ffffff", 20);
      play("coin");
      this.toum = null;
    }
    if (this.body.length >= 20) unlock("mega");
  },
  update(dt) {
    this.t += dt;
    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 0.8) finish();
      return;
    }
    if (this.toum) {
      this.toum.life -= dt;
      if (this.toum.life <= 0) this.toum = null;
    }
    this.acc += dt;
    while (this.acc >= this.step && !this.dead) {
      this.acc -= this.step;
      this.tick();
    }
  },
  pos(i, f) {
    const cur = this.body[i];
    const pr = this.prev[i] || this.prev[this.prev.length - 1];
    return { x: (lerp(pr.x, cur.x, f) + 0.5) * CELL, y: (lerp(pr.y, cur.y, f) + 0.5) * CELL };
  },
  draw() {
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#ffe7bf" : CREAM;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
    // food
    const bob = Math.sin(this.t * 5) * 1.5;
    drawFace(this.food.who, (this.food.x + 0.5) * CELL, (this.food.y + 0.5) * CELL + bob, 11, { lw: 2.5 });
    if (this.toum) {
      ctx.globalAlpha = this.toum.life < 1.5 ? 0.5 + 0.5 * Math.sin(this.t * 20) : 1;
      drawEmoji("🧄", (this.toum.x + 0.5) * CELL, (this.toum.y + 0.5) * CELL, 26);
      ctx.globalAlpha = 1;
    }
    // shawarma body: one fat rounded stroke = bread, dashed stripes = meat
    const f = this.dead ? 1 : clamp(this.acc / this.step, 0, 1);
    const pts = this.body.map((_, i) => this.pos(i, f));
    const path = () => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    path();
    ctx.lineWidth = 24;
    ctx.strokeStyle = INK;
    ctx.stroke();
    path();
    ctx.lineWidth = 18;
    ctx.strokeStyle = "#ecbd78";
    ctx.stroke();
    path();
    ctx.setLineDash([5, 7]);
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#8a4b24";
    ctx.stroke();
    ctx.setLineDash([]);
    // foil tail
    const tail = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(tail.x, tail.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#d9dee5";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // head = you
    drawFace(player, pts[0].x, pts[0].y, 14, { ring: this.dead ? KETCHUP : INK });
    if (state === "play" && this.eaten === 0 && this.t < 3) label("Eat the coworkers · كُل زمايلك", W / 2, 130, 18, "#ffffff");
  },
  hud() {
    label(`length ${this.body.length}`, 14, 66, 16, "#ffffff", "left");
  },
};

const GAMES = [flappy, catcher, whack, snake];
const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));

// ---------- HUD ----------
function drawHud() {
  label(String(run.score), W / 2, 34, 40, "#ffffff");
  label(`BEST ${bests[game.id] || 0}`, 14, 26, 16, "#ffffff", "left");
  game.hud?.();
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (state === "play") {
    if (fx.stop > 0) fx.stop -= dt;
    else game.update(dt);
  } else if (state !== "paused") game.idle?.(dt);
  if (state !== "paused") updateFx(dt);
  render();
  requestAnimationFrame(frame);
}
function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  const s = calm() ? 0 : fx.trauma * fx.trauma * 14;
  if (s) {
    ctx.translate(rand(-s, s), rand(-s, s));
    ctx.rotate(rand(-s, s) * 0.002);
  }
  game.draw();
  drawFx();
  ctx.restore();
  if (fx.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${fx.flash * 0.7})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (state === "play" || state === "paused") drawHud();
}

// ---------- states ----------
const overlay = $("#overlay");
const live = $("#live");
function setState(s) {
  state = s;
  frameEl.dataset.state = s;
  frameEl.dataset.game = game.id;
  canvas.setAttribute("aria-label", `${game.name} mini game. ${s === "play" ? "Playing" : s === "paused" ? "Paused" : s === "over" ? `Game over, score ${run.score}` : "Ready"}.`);
}
function start() {
  clearFx();
  game.reset();
  setState("play");
  overlay.innerHTML = "";
  canvas.focus({ preventScroll: true });
  play("whoosh");
  stats.played[game.id] = true;
  saveStats();
  if (GAMES.every((g) => stats.played[g.id])) unlock("rat");
  const hr = new Date().getHours();
  if (hr < 5) unlock("owl");
}
function pause() {
  if (state !== "play") return;
  setState("paused");
  overlay.innerHTML = `<div class="ar-card" role="dialog" aria-label="Paused">
    <div class="ar-card__icon">☕</div>
    <h2>Paused</h2><p class="ar-ar" lang="ar" dir="rtl">استراحة شاي</p>
    <p class="ar-help">${esc(game.help)}</p>
    <div class="ar-row">
      <button class="ar-btn" data-act="resume">Resume (P)</button>
      <button class="ar-btn ar-btn--ghost" data-act="restart">Restart (R)</button>
    </div></div>`;
  overlay.querySelector("[data-act=resume]").focus({ preventScroll: true });
}
function resume() {
  if (state !== "paused") return;
  overlay.innerHTML = "";
  last = performance.now();
  setState("play");
  canvas.focus({ preventScroll: true });
}
function showReady() {
  clearFx();
  game.reset();
  setState("ready");
  const best = bests[game.id] || 0;
  overlay.innerHTML = `<div class="ar-card" role="dialog" aria-label="${esc(game.name)}">
    <div class="ar-card__icon" aria-hidden="true">${game.icon}</div>
    <h2>${esc(game.name)}</h2><p class="ar-ar" lang="ar" dir="rtl">${esc(game.ar)}</p>
    <p>${esc(game.blurb)}</p>
    <p class="ar-help">${esc(game.help)} · P pause · R restart</p>
    ${best ? `<p>Your best: <b>${best}</b></p>` : ""}
    <div class="ar-row"><button class="ar-btn" data-act="start">▶ Play (Space)</button></div></div>`;
  $("#keys").textContent = `${game.help} · P / Esc pause · R restart`;
}
function finish() {
  if (state !== "play") return;
  const score = run.score;
  const prevBest = bests[game.id] || 0;
  const newBest = score > prevBest;
  if (newBest) {
    bests[game.id] = score;
    store.set(KEY.best, bests);
  }
  setState("over");
  unlock("firstL");
  const list = boards[game.id] || [];
  const qualifies = score > 0 && (list.length < 5 || score > list[list.length - 1].s);
  const quip = run.reason || pickOne(game.quips);
  const ini = store.get(KEY.ini, "");
  const nick = getNick();
  const askNick = !nick && score > 0 && !store.get(KEY.skip, false);
  const gameId = game.id;
  if (newBest && score > 0) {
    play("celebrate");
    burst(W / 2, 140, { n: 40, speed: 320 });
  } else if (game.id === "whack") play("drumroll");
  overlay.innerHTML = `<div class="ar-card" role="dialog" aria-label="Game over">
    <p><b>${esc(quip)}</b></p>
    <div class="ar-big">${score}</div>
    ${newBest && score > 0 ? `<span class="ar-newbest">NEW BEST · رقم قياسي</span>` : `<p>Best: <b>${Math.max(prevBest, score)}</b></p>`}
    ${nick && score > 0 ? `<p class="ar-online" id="onlineMsg">Posting as <b>${esc(nick.nickname)}</b>…</p>` : ""}
    ${askNick ? nickFormHtml("over") : ""}
    ${!nick && !askNick && qualifies ? `<form class="ar-ini" id="iniForm">
      <label for="ini">Top 5! Your initials · اكتب اسمك</label>
      <input id="ini" name="ini" maxlength="3" autocomplete="off" spellcheck="false" value="${esc(ini)}" aria-label="Initials, up to 3 letters">
      <button class="ar-btn ar-btn--pink" type="submit">Save</button></form>` : ""}
    <div class="ar-row">
      <button class="ar-btn" data-act="restart">↻ Again (R)</button>
      <button class="ar-btn ar-btn--ghost" data-act="next">Next game →</button>
    </div></div>`;
  live.textContent = `Game over. ${quip}. Score ${score}.${newBest && score > 0 ? " New best!" : ""}`;
  if (nick && score > 0) {
    if (qualifies) saveScore(nick.nickname.slice(0, 12), score);
    postScore(gameId, score).then((msg) => {
      const el = $("#onlineMsg");
      if (el && state === "over" && game.id === gameId) el.innerHTML = msg;
    });
  }
  const nf = $("#nickForm-over");
  if (nf) {
    bindNickForm(nf, async () => {
      if (qualifies) saveScore(getNick().nickname.slice(0, 12), score);
      return postScore(gameId, score);
    });
    overlay.querySelector("[data-act=restart]").focus({ preventScroll: true });
  }
  const form = $("#iniForm");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (form.ini.value || "").trim().toUpperCase().slice(0, 3) || "???";
      store.set(KEY.ini, name);
      saveScore(name, score);
      form.outerHTML = `<p><b>Saved · اتسجل</b> ✔</p>`;
      overlay.querySelector("[data-act=restart]").focus({ preventScroll: true });
      play("pop");
    });
    // initials input is the obvious next step on desktop; on touch don't pop the keyboard
    if (!matchMedia("(hover: none)").matches) form.ini.focus({ preventScroll: true });
    else overlay.querySelector("[data-act=restart]").focus({ preventScroll: true });
  } else if (!nf) overlay.querySelector("[data-act=restart]").focus({ preventScroll: true });
  renderPicker();
}

// ---------- leaderboard: global (API) with local top-5 fallback ----------
let lastSaved = null;
function saveScore(name, score) {
  const list = boards[game.id] || [];
  const entry = { n: name, s: score, c: player.label, t: Date.now() };
  list.push(entry);
  list.sort((a, b) => b.s - a.s || a.t - b.t);
  boards[game.id] = list.slice(0, 5);
  store.set(KEY.lb, boards);
  lastSaved = entry.t;
  renderBoard();
}
const globalCache = {}; // game id -> { at, rows } | { at, failed }
function getNick() {
  const nickname = store.get(KEY.nick, "");
  const pin = store.get(KEY.pin, "");
  return nickname && pin ? { nickname, pin } : null;
}
const sameNick = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
async function fetchGlobal(id, force = false) {
  const c = globalCache[id];
  if (!force && c && Date.now() - c.at < 30000) return c;
  try {
    const r = await fetch(`/api/games/leaderboard?game=${encodeURIComponent(id)}&limit=10`);
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    if (!Array.isArray(d.leaderboard)) throw new Error("bad shape");
    globalCache[id] = { at: Date.now(), rows: d.leaderboard };
  } catch {
    globalCache[id] = { at: Date.now(), failed: true };
  }
  return globalCache[id];
}
// Posts a score for the saved nickname; returns a short HTML status line for the game-over card.
async function postScore(id, score) {
  const nick = getNick();
  if (!nick) return "";
  try {
    const r = await fetch("/api/games/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game: id, nickname: nick.nickname, pin: nick.pin, score, character: player.label }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 403) {
      renderMe(`“${nick.nickname}” is taken (or wrong PIN) · الاسم محجوز`);
      return `Nickname taken / wrong PIN · الاسم محجوز. <button type="button" class="ar-link" data-act="fixnick">Change it</button>`;
    }
    if (!r.ok) throw new Error(d.error || String(r.status));
    if (Array.isArray(d.leaderboard)) globalCache[id] = { at: Date.now(), rows: d.leaderboard };
    else delete globalCache[id];
    if (game.id === id) renderBoard();
    return `🌍 Global rank <b>#${esc(d.rank ?? "?")}</b> · your best <b>${esc(d.best ?? score)}</b>`;
  } catch {
    return "Offline: saved on this device only · محفوظ عندك بس";
  }
}
function renderLocal(id) {
  const list = boards[id] || [];
  $("#lbSrc").textContent = "📱 This device (offline)";
  $("#lb").innerHTML = list.length
    ? list.map((e) => `<li class="${e.t === lastSaved ? "ar-me" : ""}"><span><b>${esc(e.n)}</b><small>as ${esc(e.c)}</small></span><span class="ar-score">${e.s}</span></li>`).join("")
    : `<li class="ar-empty">No scores yet. Be the first L · مفيش حد لسه</li>`;
}
async function renderBoard() {
  const id = game.id;
  $("#lbGame").textContent = `· ${game.name}`;
  if (!globalCache[id] || globalCache[id].failed) renderLocal(id); // instant paint, upgrade to global below
  const g = await fetchGlobal(id);
  if (game.id !== id) return;
  if (g.failed) return renderLocal(id);
  const me = getNick()?.nickname;
  $("#lbSrc").textContent = "🌍 Global top 10";
  $("#lb").innerHTML = g.rows.length
    ? g.rows
        .slice(0, 10)
        .map((e) => {
          const you = me && sameNick(e.nickname, me);
          return `<li class="${you ? "ar-me" : ""}"><span><b class="ar-nick">${esc(e.nickname)}</b>${you ? ' <em class="ar-you">you</em>' : ""}<small>${e.character ? `as ${esc(e.character)}` : ""}</small></span><span class="ar-score">${esc(e.score)}</span></li>`;
        })
        .join("")
    : `<li class="ar-empty">Nobody online yet. Go first · ابدأ انت</li>`;
}

// ---------- nickname + PIN (no login; the PIN guards the nickname) ----------
function nickFormHtml(where) {
  const n = store.get(KEY.nick, "");
  const over = where === "over";
  return `<form class="ar-nick-form" id="nickForm-${where}" novalidate>
    ${over ? `<p class="ar-nick-ask"><b>Join the global board?</b> · <span lang="ar" dir="rtl">ادخل الترتيب العالمي</span></p>` : ""}
    <div class="ar-nick-fields">
      <label>Nickname <input name="nickname" maxlength="20" autocomplete="nickname" spellcheck="false" value="${esc(n)}" required></label>
      <label>4-digit PIN <input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></label>
    </div>
    <p class="ar-nick-err" role="alert"></p>
    <div class="ar-row">
      <button class="ar-btn ar-btn--pink" type="submit">${over ? "Save &amp; post" : "Save"}</button>
      <button class="ar-btn ar-btn--ghost" type="button" ${over ? "data-skip" : "data-cancel"}>${over ? "Skip" : "Cancel"}</button>
    </div>
    <p class="ar-nick-note">The PIN keeps your nickname yours, on any device.</p></form>`;
}
function bindNickForm(form, after) {
  const err = form.querySelector(".ar-nick-err");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nickname = form.nickname.value.trim().replace(/\s+/g, " ");
    const pin = form.pin.value.trim();
    if (nickname.length < 2 || nickname.length > 20) return void (err.textContent = "Nickname: 2–20 characters · من 2 لـ 20 حرف");
    if (!/^\d{4}$/.test(pin)) return void (err.textContent = "PIN must be exactly 4 digits · 4 أرقام بس");
    store.set(KEY.nick, nickname);
    store.set(KEY.pin, pin);
    store.set(KEY.skip, false);
    renderMe();
    play("pop");
    const msg = after ? await after() : "";
    if (/taken/i.test(msg)) {
      err.textContent = "That nickname is taken (or wrong PIN) · الاسم محجوز";
      return;
    }
    if (form.isConnected) form.outerHTML = msg ? `<p class="ar-online">${msg}</p>` : "";
    renderBoard();
  });
  form.querySelector("[data-skip]")?.addEventListener("click", () => {
    store.set(KEY.skip, true);
    form.outerHTML = `<p class="ar-nick-note">No worries. Set one anytime in the side panel.</p>`;
  });
  form.querySelector("[data-cancel]")?.addEventListener("click", () => renderMe());
}
function renderMe(error = "") {
  const box = $("#me");
  if (!box) return;
  const nick = getNick();
  box.innerHTML = nick
    ? `<p>Posting as <b>${esc(nick.nickname)}</b> 🌍</p>${error ? `<p class="ar-nick-err" role="alert">${esc(error)}</p>` : ""}<button type="button" class="ar-btn ar-btn--ghost ar-btn--sm" data-edit-nick>Change nickname</button>`
    : `<p>Set a nickname to post scores globally. <span lang="ar" dir="rtl">اختار اسم عشان تدخل الترتيب.</span></p><button type="button" class="ar-btn ar-btn--sm" data-edit-nick>Set nickname</button>`;
}
document.addEventListener("click", (e) => {
  const fix = e.target.closest("[data-act=fixnick]");
  if (!fix && !e.target.closest("[data-edit-nick]")) return;
  const box = $("#me");
  box.innerHTML = nickFormHtml("side");
  const f = $("#nickForm-side");
  bindNickForm(f, null);
  if (fix) box.scrollIntoView({ block: "center", behavior: calm() ? "auto" : "smooth" });
  f.nickname.focus({ preventScroll: true });
});
function renderAch() {
  $("#achCount").textContent = `· ${unlocked.size}/${Object.keys(ACH).length}`;
  $("#ach").innerHTML = Object.entries(ACH)
    .map(([id, [icon, en, ar]]) => {
      const on = unlocked.has(id);
      const text = on ? `${en} · ${ar}` : `Locked: ${en}`;
      return `<li class="${on ? "on" : ""}" title="${esc(text)}" aria-label="${esc(text)}">${icon}</li>`;
    })
    .join("");
}
function toast(icon, title, sub) {
  const el = document.createElement("div");
  el.className = "ar-toast";
  el.innerHTML = `<span aria-hidden="true">${icon}</span><span>${esc(title)}<small lang="ar" dir="rtl">${esc(sub)}</small></span>`;
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 2950);
}

// ---------- picker + characters ----------
function renderPicker() {
  $("#picker").innerHTML = GAMES.map(
    (g) => `<button type="button" class="ar-game" data-game="${g.id}" aria-pressed="${g === game}">
      <span class="ar-game__icon" aria-hidden="true">${g.icon}</span>
      <span class="ar-game__name">${esc(g.name)}</span>
      <span class="ar-game__meta"><bdi class="ar-game__ar" lang="ar" dir="rtl">${esc(g.ar)}</bdi><span class="ar-game__ar"> · </span><span>best ${bests[g.id] || 0}</span></span></button>`
  ).join("");
}
function selectGame(id) {
  game = byId[id] || flappy;
  store.set(KEY.game, game.id);
  renderPicker();
  renderBoard();
  showReady();
}
function renderChars() {
  const all = [...BUILTINS, ...coworkers];
  $("#chars").innerHTML = all
    .map(
      (c) => `<button type="button" class="ar-char" data-char="${esc(c.id)}" aria-pressed="${c.id === player.id}" aria-label="Play as ${esc(c.label)}" title="${esc(c.label)}" style="background:${c.bg || CREAM}">
      ${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy">` : `<span aria-hidden="true">${c.emoji}</span>`}</button>`
    )
    .join("");
  $("#playing").innerHTML = `Playing as <b>${esc(player.label)}</b>${player.ar ? ` · <span lang="ar" dir="rtl">${esc(player.ar)}</span>` : ""}`;
}
function selectChar(id, { sound = true } = {}) {
  const c = [...BUILTINS, ...coworkers].find((x) => x.id === id);
  if (!c) return;
  player = c;
  store.set(KEY.char, c.id);
  renderChars();
  if (sound) play("pop");
}

// ---------- input ----------
function pt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const p = pt(e);
  canvas.setPointerCapture?.(e.pointerId);
  if (state === "play") game.press?.(p.x, p.y, e.pointerType);
});
canvas.addEventListener("pointermove", (e) => {
  const p = pt(e);
  if (state === "play" || game.id === "whack") game.move?.(p.x, p.y, e.pointerType);
});
for (const ev of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(ev, (e) => {
    const p = pt(e);
    if (state === "play") game.release?.(p.x, p.y);
  });
}
canvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "mouse" && game.id === "whack") whack.spoon.show = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

overlay.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "start" || act === "restart") start();
  else if (act === "resume") resume();
  else if (act === "next") selectGame(GAMES[(GAMES.indexOf(game) + 1) % GAMES.length].id);
  else if (state === "ready" && !e.target.closest("button, input, a")) start(); // tap anywhere to begin
});
$("#pauseBtn").addEventListener("click", () => (state === "play" ? pause() : resume()));
$("#picker").addEventListener("click", (e) => {
  const id = e.target.closest("[data-game]")?.dataset.game;
  if (id) {
    play("tick");
    selectGame(id);
  }
});
$("#chars").addEventListener("click", (e) => {
  const id = e.target.closest("[data-char]")?.dataset.char;
  if (id) selectChar(id);
});

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`Digit${n}`, `Numpad${n}`])]);
addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.code;
  if (state === "play") {
    if (k === "KeyP" || k === "Escape") {
      e.preventDefault();
      return pause();
    }
    if (k === "KeyR") return start();
    if (GAME_KEYS.has(k)) {
      e.preventDefault();
      if (!e.repeat) game.key?.(k, true);
    }
    return;
  }
  const onControl = (tag === "BUTTON" || tag === "A") && (k === "Space" || k === "Enter");
  if (onControl) return; // let the focused button do its own thing
  if (state === "paused") {
    if (k === "KeyP" || k === "Escape" || k === "Space") {
      e.preventDefault();
      resume();
    } else if (k === "KeyR") start();
  } else if (state === "ready" && (k === "Space" || k === "Enter")) {
    e.preventDefault();
    start();
  } else if (state === "over" && (k === "Space" || k === "KeyR" || k === "Enter")) {
    e.preventDefault();
    start();
  }
});
addEventListener("keyup", (e) => {
  if (state === "play") game.key?.(e.code, false);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
  else last = performance.now();
});
addEventListener("blur", () => pause());

// ---------- boot ----------
if (calm()) $("#arcade").classList.add("ar-calm");
game = byId[store.get(KEY.game, "flappy")] || flappy;
renderPicker();
renderBoard();
renderAch();
renderChars();
renderMe();
showReady();
requestAnimationFrame((t) => {
  last = t;
  frame(t);
});

getDishes()
  .then((dishes) => {
    coworkers = (Array.isArray(dishes) ? dishes : []).slice(0, 40).map((d, i) => ({
      id: `d${d.id}`,
      label: d.name_en || d.name_ar || "Mystery coworker",
      ar: d.name_en && d.name_ar ? d.name_ar : "",
      emoji: FOODS[i % FOODS.length],
      bg: PAL[i % PAL.length],
      photo: d.photo_url || null,
      sprite: null,
    }));
    coworkers.forEach(loadSprite);
    const saved = store.get(KEY.char, "chef");
    player = [...BUILTINS, ...coworkers].find((c) => c.id === saved) || BUILTINS[0];
    renderChars();
  })
  .catch(() => {});
const savedBuiltin = BUILTINS.find((c) => c.id === store.get(KEY.char, "chef"));
if (savedBuiltin) {
  player = savedBuiltin;
  renderChars();
}
