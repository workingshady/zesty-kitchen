// 👗 Dress-up the Coworker / تلبيس الزميل
// Pick a coworker (their face photo, emoji fallback), layer outfits, hats, glasses, stuff, places,
// stickers and a speech bubble. Tap to wear/remove, drag to move, pinch / wheel / ± to resize.
// Everything is drawn on canvas (shapes + emoji), so "📸 Save" exports a clean PNG. Not scored,
// but you get a deterministic "style rating" + achievements.
export default function dressup(k) {
  const { W, H, ctx, INK, CREAM, MUSTARD, PINK, SLIME, SKY, KETCHUP, EMOJI_FONT, play, burst, unlock, esc, store, clamp } = k;
  const FONT = '"Cairo", "Baloo Bhaijaan 2", system-ui, sans-serif';
  const DISPLAY = k.DISPLAY;
  const SAVE_KEY = "zk_arcade_fit";
  const HEAD = { x: 180, y: 196, r: 76 };
  const BASE = { hat: 150, glasses: 136, acc: 86, sticker: 56, bubble: 1 };
  const MAX = { acc: 4, sticker: 8 };
  const SINGLE = new Set(["hat", "glasses", "bubble"]);
  const ORDER = { glasses: 1, hat: 2, acc: 3, sticker: 4, bubble: 5 };

  // ---------- tiny drawing helpers (take a context so the same code renders screen + export) ----------
  const emojiCache = new Map();
  function emo(ch) {
    if (emojiCache.has(ch)) return emojiCache.get(ch);
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const g = c.getContext("2d");
    g.font = `150px ${EMOJI_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(ch, 100, 110);
    emojiCache.set(ch, c);
    return c;
  }
  const drawEmo = (g, ch, x, y, size) => g.drawImage(emo(ch), x - size / 2, y - size / 2, size, size);
  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }
  function inked(g, fill, lw = 3) {
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = lw;
    g.strokeStyle = INK;
    g.lineJoin = "round";
    g.stroke();
  }
  function text(g, t, x, y, size, fill = INK, { font = FONT, align = "center", stroke = null, weight = "bold" } = {}) {
    g.font = `${weight} ${size}px ${font}`;
    g.textAlign = align;
    g.textBaseline = "middle";
    if (stroke) {
      g.lineWidth = Math.max(3, size / 6);
      g.strokeStyle = stroke;
      g.lineJoin = "round";
      g.strokeText(t, x, y);
    }
    g.fillStyle = fill;
    g.fillText(t, x, y);
  }

  // ---------- backgrounds ----------
  function skyGrad(g, a, b, h = H) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, a);
    gr.addColorStop(1, b);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }
  const BGS = [
    { id: "street", en: "Cairo street", ar: "شارع في القاهرة", draw(g) {
      skyGrad(g, "#ffb36b", "#ffe2b0");
      g.beginPath();
      g.arc(300, 70, 34, 0, Math.PI * 2);
      inked(g, MUSTARD);
      // minaret
      rrect(g, 26, 60, 18, 220, 4);
      inked(g, "#e9d3a8");
      g.beginPath();
      g.moveTo(22, 64);
      g.lineTo(35, 30);
      g.lineTo(48, 64);
      g.closePath();
      inked(g, "#e9d3a8");
      const blds = [[0, 150, 80, "#d9a066"], [70, 120, 70, "#c98b4b"], [136, 170, 90, "#e7c08f"], [222, 110, 70, "#b8794a"], [286, 140, 80, "#dcae7a"]];
      for (const [x, y, w, col] of blds) {
        g.beginPath();
        g.rect(x, y, w, 330 - y);
        inked(g, col);
        for (let wy = y + 14; wy < 300; wy += 34)
          for (let wx = x + 10; wx < x + w - 16; wx += 24) {
            g.beginPath();
            g.rect(wx, wy, 13, 18);
            inked(g, "#7fd3ff", 2);
          }
        g.beginPath();
        g.rect(x + w - 26, y + 40, 18, 12);
        inked(g, "#f5f5f5", 2); // AC unit, obviously
      }
      g.beginPath();
      g.rect(0, 330, W, 150);
      inked(g, "#5b5b5b");
      g.fillStyle = "#ffffff";
      for (let x = 0; x < W; x += 50) g.fillRect(x, 400, 26, 6);
      drawEmo(g, "🛺", 300, 360, 70);
      drawEmo(g, "🌴", 60, 300, 60);
    } },
    { id: "office", en: "Office", ar: "المكتب", draw(g) {
      g.fillStyle = "#dfe8f2";
      g.fillRect(0, 0, W, H);
      g.fillStyle = "#cfdbe8";
      for (let x = 0; x < W; x += 40) g.fillRect(x, 0, 20, H);
      rrect(g, 20, 40, 130, 110, 6);
      inked(g, "#9fd8ff");
      g.fillStyle = "#6aa9d6";
      for (const [x, h] of [[30, 50], [52, 80], [78, 40], [100, 66], [124, 56]]) g.fillRect(x, 150 - h, 18, h);
      g.beginPath();
      g.moveTo(85, 40);
      g.lineTo(85, 150);
      g.moveTo(20, 95);
      g.lineTo(150, 95);
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.stroke();
      rrect(g, 220, 40, 124, 92, 6);
      inked(g, "#ffffff");
      text(g, "Q3 KPIs 📈", 282, 64, 15, INK, { font: DISPLAY, weight: "normal" });
      g.beginPath();
      g.moveTo(236, 118);
      g.lineTo(262, 100);
      g.lineTo(284, 108);
      g.lineTo(326, 78);
      g.strokeStyle = KETCHUP;
      g.lineWidth = 3;
      g.stroke();
      g.beginPath();
      g.arc(190, 52, 22, 0, Math.PI * 2);
      inked(g, "#ffffff");
      g.beginPath();
      g.moveTo(190, 52);
      g.lineTo(190, 38);
      g.moveTo(190, 52);
      g.lineTo(201, 56);
      g.stroke();
      g.beginPath();
      g.rect(0, 390, W, 90);
      inked(g, "#a8763e");
      drawEmo(g, "🪴", 36, 350, 70);
      drawEmo(g, "☕", 320, 372, 40);
      drawEmo(g, "🖨️", 316, 300, 52);
    } },
    { id: "beach", en: "Beach (Sahel)", ar: "الساحل", draw(g) {
      skyGrad(g, "#7fd3ff", "#d6f1ff", 260);
      g.beginPath();
      g.arc(70, 70, 30, 0, Math.PI * 2);
      inked(g, MUSTARD);
      g.beginPath();
      g.rect(0, 230, W, 110);
      inked(g, "#2f9be0");
      g.strokeStyle = "#bfe8ff";
      g.lineWidth = 3;
      for (let y = 250; y < 330; y += 22) {
        g.beginPath();
        for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x / 20) * 4);
        g.stroke();
      }
      g.beginPath();
      g.rect(0, 330, W, 150);
      inked(g, "#ffe08a");
      drawEmo(g, "⛱️", 50, 340, 80);
      drawEmo(g, "🦀", 320, 440, 36);
      drawEmo(g, "🐚", 30, 450, 28);
      drawEmo(g, "🕊️", 260, 60, 32);
    } },
    { id: "wedding", en: "Wedding hall", ar: "قاعة فرح", draw(g) {
      skyGrad(g, "#3a1a5e", "#7a3fa0");
      for (let row = 0; row < 3; row++) {
        g.beginPath();
        g.moveTo(0, 30 + row * 40);
        g.quadraticCurveTo(W / 2, 80 + row * 40, W, 30 + row * 40);
        g.strokeStyle = "rgba(255,255,255,.5)";
        g.lineWidth = 1.5;
        g.stroke();
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          const x = t * W;
          const y = (1 - t) * (1 - t) * (30 + row * 40) + 2 * (1 - t) * t * (80 + row * 40) + t * t * (30 + row * 40);
          g.beginPath();
          g.arc(x, y, 3.5, 0, Math.PI * 2);
          g.fillStyle = [MUSTARD, PINK, "#ffffff"][(i + row) % 3];
          g.fill();
        }
      }
      // kosha arch
      g.beginPath();
      g.arc(180, 330, 160, Math.PI, 0);
      g.lineWidth = 16;
      g.strokeStyle = "#ffd1e8";
      g.stroke();
      for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += Math.PI / 9) drawEmo(g, a % 2 ? "🌸" : "🌹", 180 + Math.cos(a) * 160, 330 + Math.sin(a) * 160, 26);
      drawEmo(g, "🪩", 300, 40, 46);
      text(g, "ألف مبروك", 70, 40, 20, MUSTARD, { stroke: INK });
      g.beginPath();
      g.rect(0, 400, W, 80);
      inked(g, "#d8b4ff");
    } },
    { id: "koshary", en: "Koshary shop", ar: "محل كشري", draw(g) {
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 30)
        for (let x = (y / 30) % 2 ? 0 : 30; x < W; x += 60) {
          g.fillStyle = "#1f9d55";
          g.fillRect(x, y, 30, 30);
        }
      rrect(g, 20, 20, W - 40, 64, 10);
      inked(g, KETCHUP, 4);
      text(g, "كشري الزميل · Koshary", W / 2, 52, 24, "#ffffff", { stroke: INK });
      rrect(g, 236, 104, 108, 120, 8);
      inked(g, "#2b2b2b");
      const menu = [["صغير", "25"], ["وسط", "35"], ["كبير", "50"], ["لوكس", "∞"]];
      menu.forEach(([a, b], i) => {
        text(g, a, 316, 124 + i * 26, 14, "#ffffff", { align: "right" });
        text(g, b, 256, 124 + i * 26, 14, MUSTARD, { align: "left" });
      });
      g.beginPath();
      g.rect(0, 380, W, 100);
      inked(g, "#b0b0b0");
      drawEmo(g, "🍝", 50, 350, 70);
      drawEmo(g, "🧅", 320, 360, 40);
      drawEmo(g, "🌶️", 290, 372, 30);
    } },
    { id: "pyramids", en: "Pyramids", ar: "الأهرامات", draw(g) {
      skyGrad(g, "#8fd8ff", "#fff1c7", 300);
      g.beginPath();
      g.arc(290, 60, 30, 0, Math.PI * 2);
      inked(g, MUSTARD);
      for (const [cx, w, h] of [[80, 170, 150], [230, 220, 190], [330, 120, 90]]) {
        g.beginPath();
        g.moveTo(cx - w / 2, 320);
        g.lineTo(cx, 320 - h);
        g.lineTo(cx + w / 2, 320);
        g.closePath();
        inked(g, "#e3b664");
        g.beginPath();
        g.moveTo(cx, 320 - h);
        g.lineTo(cx + w / 2, 320);
        g.lineTo(cx + w * 0.1, 320);
        g.closePath();
        g.fillStyle = "rgba(0,0,0,.12)";
        g.fill();
      }
      g.beginPath();
      g.rect(0, 316, W, 164);
      inked(g, "#f3cf86");
      drawEmo(g, "🐪", 300, 380, 70);
      drawEmo(g, "🌵", 40, 400, 44);
    } },
    { id: "plain", en: "Studio", ar: "استوديو", draw(g) {
      g.fillStyle = MUSTARD;
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(17,17,17,.12)";
      for (let y = 10; y < H; y += 22) for (let x = (y / 22) % 2 ? 11 : 0; x < W; x += 22) {
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
    } },
  ];

  // ---------- outfits (the body under the head) ----------
  function torso(g) {
    g.beginPath();
    g.moveTo(150, 262);
    g.lineTo(210, 262);
    g.quadraticCurveTo(296, 268, 304, 340);
    g.lineTo(314, 490);
    g.lineTo(46, 490);
    g.lineTo(56, 340);
    g.quadraticCurveTo(64, 268, 150, 262);
    g.closePath();
  }
  const OUTFITS = [
    { id: "tee", en: "T-shirt", ar: "تيشيرت", draw(g) {
      torso(g);
      inked(g, SKY, 4);
      text(g, "ZK", 180, 360, 30, "#ffffff", { font: DISPLAY, weight: "normal", stroke: INK });
    } },
    { id: "galabeya", en: "Galabeya", ar: "جلابية", draw(g) {
      torso(g);
      inked(g, "#f4ecd8", 4);
      g.beginPath();
      g.moveTo(180, 262);
      g.lineTo(180, 340);
      g.lineWidth = 3;
      g.strokeStyle = "#8a6d3b";
      g.stroke();
      g.beginPath();
      g.moveTo(160, 262);
      g.quadraticCurveTo(180, 290, 200, 262);
      g.stroke();
      for (let y = 300; y < 340; y += 14) {
        g.beginPath();
        g.arc(186, y, 2.5, 0, Math.PI * 2);
        g.fillStyle = "#8a6d3b";
        g.fill();
      }
      g.beginPath();
      g.moveTo(240, 380);
      g.lineTo(270, 380);
      g.stroke();
    } },
    { id: "suit", en: "Suit", ar: "بدلة", draw(g) {
      torso(g);
      inked(g, "#26324a", 4);
      g.beginPath();
      g.moveTo(152, 264);
      g.lineTo(180, 380);
      g.lineTo(208, 264);
      g.closePath();
      inked(g, "#ffffff", 3);
      g.beginPath();
      g.moveTo(174, 276);
      g.lineTo(186, 276);
      g.lineTo(190, 360);
      g.lineTo(180, 376);
      g.lineTo(170, 360);
      g.closePath();
      inked(g, KETCHUP, 2.5);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(180 + s * 30, 264);
        g.lineTo(180 + s * 8, 380);
        g.lineWidth = 3;
        g.strokeStyle = "#121a2b";
        g.stroke();
      }
      drawEmo(g, "🌹", 236, 312, 22);
    } },
    { id: "tracksuit", en: "Tracksuit", ar: "ترينج", draw(g) {
      torso(g);
      inked(g, "#d62839", 4);
      g.fillStyle = "#ffffff";
      for (const x of [74, 84, 270, 280]) g.fillRect(x, 300, 5, 190);
      g.beginPath();
      g.moveTo(180, 262);
      g.lineTo(180, 490);
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.stroke();
      rrect(g, 176, 296, 8, 14, 2);
      inked(g, "#c0c0c0", 2);
    } },
    { id: "chef", en: "Chef coat", ar: "جاكيت شيف", draw(g) {
      torso(g);
      inked(g, "#ffffff", 4);
      for (const x of [160, 200]) for (let y = 300; y < 440; y += 36) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        inked(g, "#d9d9d9", 2);
      }
      rrect(g, 150, 262, 60, 14, 4);
      inked(g, "#ffffff", 3);
      text(g, "Chef", 252, 300, 13, KETCHUP, { font: DISPLAY, weight: "normal" });
    } },
    { id: "hoodie", en: "Hoodie", ar: "هودي", draw(g) {
      g.beginPath();
      g.ellipse(180, 270, 74, 24, 0, 0, Math.PI * 2);
      inked(g, "#e85a9c", 4);
      torso(g);
      inked(g, PINK, 4);
      rrect(g, 120, 390, 120, 60, 14);
      inked(g, "#ff8cc6", 3);
      for (const x of [166, 194]) {
        g.beginPath();
        g.moveTo(x, 280);
        g.lineTo(x, 330);
        g.lineWidth = 3;
        g.strokeStyle = "#ffffff";
        g.stroke();
      }
    } },
    { id: "jersey", en: "Egypt jersey", ar: "تيشيرت المنتخب", draw(g) {
      torso(g);
      inked(g, "#ce1126", 4);
      g.beginPath();
      g.moveTo(160, 262);
      g.lineTo(180, 286);
      g.lineTo(200, 262);
      g.lineWidth = 6;
      g.strokeStyle = "#ffffff";
      g.stroke();
      text(g, "10", 180, 380, 64, "#ffffff", { font: DISPLAY, weight: "normal", stroke: INK });
      drawEmo(g, "🇪🇬", 236, 312, 24);
    } },
  ];

  // ---------- wearables (drawn centered at 0,0 with width S) ----------
  const HATS = [
    { id: "tarboosh", en: "Tarboosh", ar: "طربوش", draw(g, S) {
      g.beginPath();
      g.moveTo(-S * 0.33, S * 0.26);
      g.lineTo(-S * 0.26, -S * 0.3);
      g.quadraticCurveTo(0, -S * 0.36, S * 0.26, -S * 0.3);
      g.lineTo(S * 0.33, S * 0.26);
      g.quadraticCurveTo(0, S * 0.34, -S * 0.33, S * 0.26);
      inked(g, "#b5121b", 3);
      g.beginPath();
      g.moveTo(0, -S * 0.33);
      g.quadraticCurveTo(S * 0.3, -S * 0.3, S * 0.3, S * 0.05);
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.moveTo(S * 0.3, S * 0.02);
      g.lineTo(S * 0.26, S * 0.18);
      g.lineTo(S * 0.34, S * 0.18);
      g.closePath();
      inked(g, INK, 2);
    } },
    { id: "chefhat", en: "Chef hat", ar: "طاقية شيف", draw(g, S) {
      for (const [x, y, r] of [[-0.2, -0.12, 0.2], [0.2, -0.12, 0.2], [0, -0.24, 0.24]]) {
        g.beginPath();
        g.arc(x * S, y * S, r * S, 0, Math.PI * 2);
        inked(g, "#ffffff", 3);
      }
      rrect(g, -S * 0.3, -S * 0.08, S * 0.6, S * 0.34, 6);
      inked(g, "#ffffff", 3);
      g.beginPath();
      g.moveTo(-S * 0.3, S * 0.12);
      g.lineTo(S * 0.3, S * 0.12);
      g.lineWidth = 2;
      g.strokeStyle = "#cccccc";
      g.stroke();
    } },
    { id: "cap", en: "Cap", ar: "كاب", draw(g, S) {
      g.beginPath();
      g.ellipse(S * 0.22, S * 0.16, S * 0.3, S * 0.07, 0, 0, Math.PI * 2);
      inked(g, "#1f6fd1", 3);
      g.beginPath();
      g.arc(0, S * 0.16, S * 0.36, Math.PI, 0);
      g.closePath();
      inked(g, "#3a8bff", 3);
      g.beginPath();
      g.arc(0, -S * 0.2, S * 0.04, 0, Math.PI * 2);
      inked(g, "#1f6fd1", 2);
      text(g, "ZK", 0, S * 0.02, S * 0.16, "#ffffff", { font: DISPLAY, weight: "normal" });
    } },
    { id: "crown", en: "Crown", ar: "تاج", emoji: "👑" },
    { id: "helmet", en: "Helmet", ar: "خوذة", emoji: "⛑️" },
    { id: "tophat", en: "Top hat", ar: "برنيطة", emoji: "🎩" },
    { id: "grad", en: "Grad cap", ar: "طاقية تخرج", emoji: "🎓" },
    { id: "party", en: "Party hat", ar: "طرطور", draw(g, S) {
      g.beginPath();
      g.moveTo(-S * 0.24, S * 0.3);
      g.lineTo(0, -S * 0.4);
      g.lineTo(S * 0.24, S * 0.3);
      g.closePath();
      inked(g, PINK, 3);
      g.save();
      g.clip();
      g.fillStyle = MUSTARD;
      for (let i = -3; i < 4; i++) {
        g.beginPath();
        g.moveTo(-S, S * (0.1 + i * 0.16));
        g.lineTo(S, S * (-0.1 + i * 0.16));
        g.lineTo(S, S * (-0.04 + i * 0.16));
        g.lineTo(-S, S * (0.16 + i * 0.16));
        g.fill();
      }
      g.restore();
      g.beginPath();
      g.arc(0, -S * 0.4, S * 0.06, 0, Math.PI * 2);
      inked(g, SLIME, 2);
    } },
  ];
  const GLASSES = [
    { id: "shades", en: "Sunglasses", ar: "نضارة شمس", emoji: "🕶️" },
    { id: "nerd", en: "Glasses", ar: "نضارة نظر", emoji: "👓" },
    { id: "goggles", en: "Goggles", ar: "نضارة غطس", emoji: "🥽" },
    { id: "pixel", en: "Deal with it", ar: "نضارة البيكسل", draw(g, S) {
      const p = S / 16;
      g.fillStyle = INK;
      g.fillRect(-8 * p, -2 * p, 16 * p, p);
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -7 * p : p;
        g.fillRect(x0, -p, 6 * p, 3 * p);
        g.fillRect(x0 + p, 2 * p, 4 * p, p);
        g.fillStyle = "#ffffff";
        g.fillRect(x0 + p, -p, p, p);
        g.fillRect(x0 + 2 * p, 0, p, p);
        g.fillStyle = INK;
      }
    } },
    { id: "hearts", en: "Heart glasses", ar: "نضارة قلوب", draw(g, S) {
      for (const sx of [-1, 1]) {
        g.save();
        g.translate(sx * S * 0.22, 0);
        const r = S * 0.11;
        g.beginPath();
        g.moveTo(0, r * 1.4);
        g.bezierCurveTo(-r * 2.2, -r * 0.2, -r * 0.9, -r * 1.8, 0, -r * 0.5);
        g.bezierCurveTo(r * 0.9, -r * 1.8, r * 2.2, -r * 0.2, 0, r * 1.4);
        inked(g, "#ff3b7f", 3);
        g.restore();
      }
      g.beginPath();
      g.moveTo(-S * 0.08, -S * 0.03);
      g.quadraticCurveTo(0, -S * 0.08, S * 0.08, -S * 0.03);
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.stroke();
    } },
  ];
  const ACCS = [
    { id: "tea", en: "Tea glass", ar: "كوباية شاي", draw(g, S) {
      g.beginPath();
      g.moveTo(-S * 0.2, -S * 0.32);
      g.lineTo(S * 0.2, -S * 0.32);
      g.lineTo(S * 0.15, S * 0.32);
      g.lineTo(-S * 0.15, S * 0.32);
      g.closePath();
      inked(g, "rgba(255,255,255,.6)", 3);
      g.beginPath();
      g.moveTo(-S * 0.18, -S * 0.12);
      g.lineTo(S * 0.18, -S * 0.12);
      g.lineTo(S * 0.15, S * 0.3);
      g.lineTo(-S * 0.15, S * 0.3);
      g.closePath();
      g.fillStyle = "#b5541b";
      g.fill();
      drawEmo(g, "🌿", S * 0.12, -S * 0.34, S * 0.3);
    } },
    { id: "phone", en: "Phone", ar: "موبايل", emoji: "📱" },
    { id: "brief", en: "Briefcase", ar: "شنطة", emoji: "💼" },
    { id: "rose", en: "Rose", ar: "وردة", emoji: "🌹" },
    { id: "laptop", en: "Laptop", ar: "لابتوب", emoji: "💻" },
    { id: "shawarma", en: "Shawarma", ar: "شاورما", emoji: "🌯" },
    { id: "mic", en: "Mic", ar: "مايك", emoji: "🎤" },
    { id: "trophy", en: "Trophy", ar: "كاس", emoji: "🏆" },
    { id: "falafel", en: "Ta'meya", ar: "طعمية", emoji: "🧆" },
    { id: "coffee", en: "Coffee", ar: "قهوة", emoji: "☕" },
    { id: "balloon", en: "Balloon", ar: "بالونة", emoji: "🎈" },
    { id: "umbrella", en: "Umbrella", ar: "شمسية", emoji: "☂️" },
  ];
  const STICKERS = ["🔥", "💯", "✨", "😂", "❤️", "🇪🇬", "💅", "👀", "🫡", "⭐", "🌶️", "💸"].map((e, i) => ({ id: "st" + i, en: e, ar: e, emoji: e }));
  const BUBBLES = ["يسطا 😎", "aura +1000", "الاجتماع ده كان ممكن يبقى إيميل", "slay يا معلم", "أنا مش متأخر، الطريق زحمة", "مين أكل ساندوتشي؟", "W fit, fr", "ده أنا لابس عادي", "OOO till Sunday 🏖️", "بالهنا والشفا"].map((t, i) => ({ id: "b" + i, en: t, ar: t, text: t }));

  const TABS = [
    { id: "who", icon: "👤", en: "Who", ar: "مين" },
    { id: "outfit", icon: "👕", en: "Outfit", ar: "لبس", list: OUTFITS },
    { id: "hat", icon: "🎩", en: "Hats", ar: "طواقي", list: HATS },
    { id: "glasses", icon: "🕶️", en: "Glasses", ar: "نضارات", list: GLASSES },
    { id: "acc", icon: "🌹", en: "Stuff", ar: "حاجات", list: ACCS },
    { id: "bg", icon: "🏙️", en: "Place", ar: "مكان", list: BGS },
    { id: "sticker", icon: "✨", en: "Stickers", ar: "ستيكرز", list: STICKERS },
    { id: "bubble", icon: "💬", en: "Bubble", ar: "كلام", list: BUBBLES },
  ];
  const CATALOG = {};
  for (const t of TABS) for (const it of t.list || []) CATALOG[t.id + ":" + it.id] = it;
  const find = (slot, id) => CATALOG[slot + ":" + id];

  // ---------- state ----------
  const blank = () => ({ outfit: "tee", bg: "street", items: [] });
  let fit = sanitize(store.get(SAVE_KEY, null)) || blank();
  let hist = [];
  let sel = null; // selected item (object inside fit.items)
  let tab = "outfit";
  const ptrs = new Map();
  let drag = null;
  let pinch = null;
  let ui = null;
  let t = 0;

  function sanitize(f) {
    if (!f || typeof f !== "object") return null;
    const out = blank();
    if (find("outfit", f.outfit)) out.outfit = f.outfit;
    if (find("bg", f.bg)) out.bg = f.bg;
    if (Array.isArray(f.items))
      out.items = f.items
        .filter((i) => i && find(i.slot, i.id))
        .slice(0, 16)
        .map((i) => ({ slot: i.slot, id: i.id, x: clamp(+i.x || 180, 0, W), y: clamp(+i.y || 200, 0, H), s: clamp(+i.s || 1, 0.3, 3) }));
    return out;
  }
  const snapshot = () => JSON.stringify(fit);
  function pushHist() {
    hist.push(snapshot());
    if (hist.length > 60) hist.shift();
  }
  function changed() {
    store.set(SAVE_KEY, fit);
    renderItems();
    renderRating();
    checkAch();
  }

  function defaultPos(slot) {
    const n = fit.items.filter((i) => i.slot === slot).length;
    if (slot === "hat") return { x: HEAD.x, y: HEAD.y - HEAD.r - 18 };
    if (slot === "glasses") return { x: HEAD.x, y: HEAD.y - 8 };
    if (slot === "bubble") return { x: 266, y: 62 };
    if (slot === "acc") return [{ x: 74, y: 404 }, { x: 288, y: 404 }, { x: 70, y: 300 }, { x: 292, y: 300 }][n % 4];
    const spots = [[46, 120], [314, 160], [40, 230], [320, 250], [150, 452], [220, 452], [300, 110], [60, 60]];
    const [x, y] = spots[n % spots.length];
    return { x, y };
  }
  function toggle(slot, id) {
    pushHist();
    if (slot === "outfit") {
      fit.outfit = fit.outfit === id && id !== "tee" ? "tee" : id;
      play(fit.outfit === id ? "pop" : "whoosh");
      unlock("stylist");
    } else if (slot === "bg") {
      fit.bg = id;
      play("whoosh");
    } else {
      const same = fit.items.find((i) => i.slot === slot && i.id === id);
      if (same) {
        fit.items.splice(fit.items.indexOf(same), 1);
        if (sel === same) sel = null;
        play("whoosh");
      } else {
        const existing = SINGLE.has(slot) && fit.items.find((i) => i.slot === slot);
        if (existing) {
          existing.id = id;
          sel = existing;
        } else {
          const mine = fit.items.filter((i) => i.slot === slot);
          if (MAX[slot] && mine.length >= MAX[slot]) fit.items.splice(fit.items.indexOf(mine[0]), 1);
          sel = { slot, id, ...defaultPos(slot), s: 1 };
          fit.items.push(sel);
        }
        play("pop");
        burst(sel.x, sel.y, { n: 10, speed: 160, size: 4 });
        unlock("stylist");
      }
    }
    changed();
  }
  function removeSel() {
    if (!sel) return;
    pushHist();
    fit.items.splice(fit.items.indexOf(sel), 1);
    sel = null;
    play("whoosh");
    changed();
  }
  function scaleSel(f) {
    if (!sel) return;
    pushHist();
    sel.s = clamp(sel.s * f, 0.3, 3);
    play("tick");
    changed();
  }
  function undo() {
    const prev = hist.pop();
    if (!prev) return void play("bonk");
    fit = sanitize(JSON.parse(prev)) || blank();
    sel = null;
    play("tick");
    changed();
  }
  function resetFit() {
    pushHist();
    fit = blank();
    sel = null;
    play("whoosh");
    changed();
  }
  const pickR = (list) => list[Math.floor(Math.random() * list.length)];
  function randomize() {
    pushHist();
    fit = blank();
    fit.outfit = pickR(OUTFITS).id;
    fit.bg = pickR(BGS).id;
    const add = (slot, id) => fit.items.push({ slot, id, ...defaultPos(slot), s: 1 });
    if (Math.random() < 0.85) add("hat", pickR(HATS).id);
    if (Math.random() < 0.6) add("glasses", pickR(GLASSES).id);
    const accs = [...ACCS].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
    accs.forEach((a) => add("acc", a.id));
    const sts = [...STICKERS].sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 3));
    sts.forEach((s) => add("sticker", s.id));
    if (Math.random() < 0.5) add("bubble", pickR(BUBBLES).id);
    sel = null;
    play("boing");
    if (!k.calm()) burst(HEAD.x, HEAD.y, { n: 24, speed: 260 });
    unlock("stylist");
    changed();
  }

  // ---------- style rating (deterministic from the chosen items) ----------
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rating() {
    const has = (slot, id) => fit.items.some((i) => i.slot === slot && (!id || i.id === id));
    const filled = [fit.outfit !== "tee", has("hat"), has("glasses"), has("acc"), fit.bg !== "plain", has("sticker"), has("bubble")].filter(Boolean).length;
    const ids = [fit.outfit, fit.bg, ...fit.items.map((i) => i.slot + i.id)].sort().join("|");
    let score = 3 + (hash(ids) % 5) + (filled >= 5 ? 2 : filled >= 3 ? 1 : 0);
    let title = null;
    const combos = [
      [fit.outfit === "galabeya" && has("hat", "tarboosh"), 10, "Pasha mode", "الباشا وصل"],
      [fit.outfit === "chef" && has("hat", "chefhat"), 9, "Literally the chef", "الشيف بنفسه"],
      [fit.outfit === "suit" && fit.bg === "wedding", 9, "Groom's cousin energy", "قريب العريس"],
      [fit.outfit === "suit" && fit.bg === "beach", 8, "Corporate vacation", "إجازة بالبدلة"],
      [fit.outfit === "jersey" && has("acc", "trophy"), 10, "Captain, my captain", "الكابتن"],
      [fit.outfit === "tracksuit" && has("hat", "cap"), 7, "Gym? Next week", "الجيم من الأسبوع الجاي"],
      [fit.bg === "koshary" && (has("acc", "shawarma") || has("acc", "falafel")), 8, "Food court royalty", "ملك الفود كورت"],
      [fit.bg === "office" && has("acc", "laptop") && has("acc", "coffee"), 8, "Peak 9-to-5", "موظف مثالي"],
      [has("hat", "crown"), Math.max(score, 9), "Main character", "البطل"],
    ];
    for (const [ok, s, en, ar] of combos)
      if (ok) {
        score = s;
        title = [en, ar];
        break;
      }
    if (filled === 0 && !title) (score = 2), (title = ["Default skin", "سكين ديفولت"]);
    score = clamp(score, 1, 10);
    if (!title)
      title =
        score >= 10 ? ["Certified drip", "دريب رسمي"] : score >= 8 ? ["Slay", "كده الشغل"] : score >= 6 ? ["Mid but brave", "نص نص بس جريء"] : score >= 4 ? ["Dressed in the dark", "لبس في الضلمة"] : ["HR wants a word", "الـHR عايزك"];
    return { score, en: title[0], ar: title[1], filled };
  }
  function checkAch() {
    const r = rating();
    const has = (slot) => fit.items.some((i) => i.slot === slot);
    if (fit.outfit !== "tee" && has("hat") && has("glasses") && has("acc") && fit.bg !== "plain") unlock("fullfit");
    if (fit.outfit === "galabeya" && fit.items.some((i) => i.slot === "hat" && i.id === "tarboosh")) unlock("pasha");
    return r;
  }

  // ---------- the model's face (CORS-clean copy so the PNG export works) ----------
  const faces = new Map();
  function faceFor(who) {
    if (!who?.photo) return null;
    let e = faces.get(who.id);
    if (e) return e;
    e = { sprite: null, safe: false, failed: false };
    faces.set(who.id, e);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 320;
        const g = c.getContext("2d");
        g.beginPath();
        g.arc(160, 160, 160, 0, Math.PI * 2);
        g.clip();
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const sy = img.naturalHeight > img.naturalWidth ? (img.naturalHeight - s) * 0.3 : (img.naturalHeight - s) / 2;
        g.drawImage(img, (img.naturalWidth - s) / 2, sy, s, s, 0, 0, 320, 320);
        g.getImageData(0, 0, 1, 1); // throws if the photo tainted the canvas
        e.sprite = c;
        e.safe = true;
      } catch {
        e.failed = true;
      }
    };
    img.onerror = () => (e.failed = true);
    img.src = who.photo;
    return e;
  }
  function drawHead(g, who, exporting) {
    const { x, y, r } = HEAD;
    // neck
    rrect(g, x - 24, y + r - 16, 48, 34, 8);
    inked(g, "#c98f62", 3);
    const f = faceFor(who);
    let sprite = f?.sprite || null;
    if (!sprite && !exporting && who?.sprite) sprite = who.sprite; // shared (maybe tainted) copy is fine on screen
    g.save();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    if (sprite) {
      g.save();
      g.clip();
      g.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      g.restore();
    } else {
      g.fillStyle = who?.bg || MUSTARD;
      g.fill();
      drawEmo(g, who?.emoji || "🙂", x, y, r * 1.7);
    }
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
    g.restore();
  }

  // ---------- items ----------
  function bubbleBox(g, it, txt) {
    const font = `bold 15px ${FONT}`;
    g.font = font;
    const words = txt.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (g.measureText(test).width > 150 && line) lines.push(line), (line = w);
      else line = test;
    }
    lines.push(line);
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 24;
    const h = lines.length * 20 + 16;
    return { lines, w: w * it.s, h: h * it.s, font, lw: w, lh: h };
  }
  function drawItem(g, it) {
    const def = find(it.slot, it.id);
    if (!def) return;
    g.save();
    g.translate(it.x, it.y);
    if (it.slot === "bubble") {
      const b = bubbleBox(g, it, def.text);
      g.scale(it.s, it.s);
      rrect(g, -b.lw / 2, -b.lh / 2, b.lw, b.lh, 14);
      inked(g, "#ffffff", 3);
      g.beginPath();
      g.moveTo(-b.lw * 0.15, b.lh / 2 - 2);
      g.lineTo(-b.lw * 0.32, b.lh / 2 + 18);
      g.lineTo(-b.lw * 0.02, b.lh / 2 - 2);
      g.closePath();
      inked(g, "#ffffff", 3);
      g.fillStyle = "#ffffff";
      g.fillRect(-b.lw * 0.15 + 2, b.lh / 2 - 5, b.lw * 0.12, 5);
      g.font = b.font;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = INK;
      b.lines.forEach((l, i) => g.fillText(l, 0, -b.lh / 2 + 18 + i * 20));
    } else {
      const S = BASE[it.slot] * it.s;
      if (def.draw) def.draw(g, S);
      else drawEmo(g, def.emoji, 0, 0, S);
    }
    g.restore();
  }
  function itemRadius(it) {
    if (it.slot === "bubble") {
      const b = bubbleBox(ctx, it, find(it.slot, it.id).text);
      return { w: b.w / 2 + 6, h: b.h / 2 + 6 };
    }
    const r = (BASE[it.slot] * it.s) / 2;
    return { w: r * (it.slot === "glasses" ? 1 : 0.8), h: r * (it.slot === "glasses" ? 0.45 : 0.8) };
  }
  const sorted = () => [...fit.items].sort((a, b) => ORDER[a.slot] - ORDER[b.slot]);
  function hitItem(x, y) {
    const list = sorted().reverse();
    for (const it of list) {
      const r = itemRadius(it);
      if (Math.abs(x - it.x) <= r.w && Math.abs(y - it.y) <= r.h) return it;
    }
    return null;
  }

  function compose(g, { exporting = false } = {}) {
    (find("bg", fit.bg) || BGS[0]).draw(g);
    (find("outfit", fit.outfit) || OUTFITS[0]).draw(g);
    drawHead(g, k.player, exporting);
    for (const it of sorted()) drawItem(g, it);
    if (exporting) {
      const r = rating();
      rrect(g, 10, H - 46, W - 20, 36, 12);
      inked(g, CREAM, 3);
      text(g, `Style ${r.score}/10 · ${r.en} · ${r.ar}`, W / 2, H - 28, 15, INK);
      text(g, "zesty kitchen arcade 🕹️", W - 14, 14, 11, INK, { align: "right", weight: "normal" });
    } else if (sel && fit.items.includes(sel)) {
      const r = itemRadius(sel);
      g.save();
      g.setLineDash([6, 5]);
      g.lineDashOffset = -t * 30;
      g.lineWidth = 2.5;
      g.strokeStyle = KETCHUP;
      rrect(g, sel.x - r.w, sel.y - r.h, r.w * 2, r.h * 2, 10);
      g.stroke();
      g.restore();
    }
  }

  // ---------- export + share ----------
  function renderPng(forceSafe) {
    const c = document.createElement("canvas");
    c.width = W * 2;
    c.height = H * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    if (forceSafe) {
      // the photo tainted the canvas: swap to the emoji face just for the export
      const real = faceFor(k.player);
      const saved = real ? { ...real } : null;
      if (real) (real.sprite = null), (real.safe = false);
      compose(g, { exporting: true });
      if (real && saved) Object.assign(real, saved);
    } else compose(g, { exporting: true });
    return new Promise((resolve, reject) => {
      try {
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png");
      } catch (err) {
        reject(err);
      }
    });
  }
  async function makePng() {
    try {
      return await renderPng(false);
    } catch {
      return renderPng(true);
    }
  }
  const fileName = () => `zesty-fit-${String(k.player?.label || "coworker").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/gi, "-").replace(/^-|-$/g, "") || "coworker"}.png`;
  async function savePng() {
    const blob = await makePng();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    window.__zkLastFit = { size: blob.size, type: blob.type, name: a.download };
    play("cash");
    unlock("selfie");
    k.toast("📸", "Saved! Send it to the group", "اتحفظت، ابعتها على الجروب");
  }
  async function share() {
    const r = rating();
    const textMsg = `My coworker fit: ${r.score}/10 (${r.en} · ${r.ar}) 👗 Zesty Kitchen arcade`;
    try {
      const blob = await makePng();
      const file = new File([blob], fileName(), { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Zesty fit", text: textMsg });
        unlock("selfie");
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: "Zesty fit", text: textMsg, url: location.origin + "/arcade" });
        return;
      }
      await savePng();
    } catch (err) {
      if (err?.name !== "AbortError") k.toast("🤷", "Couldn't share, saved instead", "مقدرناش نشير، حفظناها");
    }
  }

  // ---------- drawer UI ----------
  const previews = new Map();
  function preview(slot, def) {
    const key = slot + ":" + def.id;
    if (previews.has(key)) return previews.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d");
    if (slot === "bg") {
      g.scale(96 / W, 96 / W);
      g.translate(0, -60);
      def.draw(g);
    } else if (slot === "outfit") {
      g.scale(0.36, 0.36);
      g.translate(-47, -250);
      def.draw(g);
    } else {
      g.translate(48, 48);
      def.draw(g, slot === "glasses" ? 86 : 70);
    }
    const url = c.toDataURL();
    previews.set(key, url);
    return url;
  }
  function itemsHtml() {
    if (tab === "who") {
      const all = k.allChars();
      return all
        .map(
          (c) => `<button type="button" class="du-item du-who" data-who="${esc(c.id)}" aria-pressed="${c.id === k.player?.id}" title="${esc(c.label)}" aria-label="Model: ${esc(c.label)}" style="background:${c.bg || CREAM}">
          ${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy">` : `<span aria-hidden="true">${c.emoji}</span>`}</button>`,
        )
        .join("");
    }
    const t = TABS.find((x) => x.id === tab);
    return t.list
      .map((def) => {
        const on = tab === "outfit" ? fit.outfit === def.id : tab === "bg" ? fit.bg === def.id : fit.items.some((i) => i.slot === tab && i.id === def.id);
        const face = def.text
          ? `<span class="du-bubble">${esc(def.text)}</span>`
          : def.draw
            ? `<img src="${preview(tab, def)}" alt="">`
            : `<span aria-hidden="true">${def.emoji}</span>`;
        return `<button type="button" class="du-item${def.text ? " du-item--text" : ""}" data-slot="${tab}" data-id="${esc(def.id)}" aria-pressed="${on}" title="${esc(def.en)} · ${esc(def.ar)}" aria-label="${esc(def.en)}">${face}</button>`;
      })
      .join("");
  }
  function renderItems() {
    if (!ui) return;
    ui.querySelector(".du-items").innerHTML = itemsHtml();
    ui.querySelectorAll(".du-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    const hasSel = !!(sel && fit.items.includes(sel));
    ui.querySelectorAll("[data-needs-sel]").forEach((b) => (b.disabled = !hasSel));
    ui.querySelector("[data-du=undo]").disabled = !hist.length;
  }
  function renderRating() {
    if (!ui) return;
    const r = rating();
    ui.querySelector(".du-rating").innerHTML = `Style rating <b>${r.score}/10</b> · ${esc(r.en)} · <span lang="ar" dir="rtl">${esc(r.ar)}</span>`;
  }
  function mountUi() {
    const box = k.tools;
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="du" aria-label="Wardrobe">
      <div class="du-tabs" role="tablist" aria-label="Wardrobe sections">
        ${TABS.map((x) => `<button type="button" role="tab" class="du-tab" data-tab="${x.id}" aria-selected="${x.id === tab}"><span aria-hidden="true">${x.icon}</span> ${x.en}<small lang="ar" dir="rtl">${x.ar}</small></button>`).join("")}
      </div>
      <div class="du-items" role="group" aria-label="Items: tap to wear or remove"></div>
      <div class="du-actions">
        <button type="button" class="ar-btn ar-btn--sm" data-du="random" title="Randomize (R)">🎲 Random</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--ghost" data-du="undo" title="Undo (Z)">↶ Undo</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--ghost" data-du="reset">🧹 Reset</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--ghost" data-du="smaller" data-needs-sel aria-label="Make selected smaller (-)">➖</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--ghost" data-du="bigger" data-needs-sel aria-label="Make selected bigger (+)">➕</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--ghost" data-du="remove" data-needs-sel aria-label="Remove selected (Delete)">🗑️</button>
        <button type="button" class="ar-btn ar-btn--sm ar-btn--pink" data-du="save">📸 Save PNG</button>
        <button type="button" class="ar-btn ar-btn--sm" data-du="share">📤 Share</button>
      </div>
      <p class="du-rating" aria-live="polite"></p>
    </div>`;
    ui = box.querySelector(".du");
    ui.addEventListener("click", (e) => {
      const tb = e.target.closest("[data-tab]");
      if (tb) {
        tab = tb.dataset.tab;
        play("tick");
        return renderItems();
      }
      const who = e.target.closest("[data-who]");
      if (who) {
        k.selectChar(who.dataset.who);
        play("pop");
        unlock("stylist");
        return renderItems();
      }
      const item = e.target.closest("[data-slot]");
      if (item) {
        if (!k.isPlaying()) k.$("#overlay [data-act=start]")?.click();
        return toggle(item.dataset.slot, item.dataset.id);
      }
      const act = e.target.closest("[data-du]")?.dataset.du;
      if (!act) return;
      if (!k.isPlaying() && act !== "save" && act !== "share") k.$("#overlay [data-act=start]")?.click();
      ({ random: randomize, undo, reset: resetFit, smaller: () => scaleSel(1 / 1.15), bigger: () => scaleSel(1.15), remove: removeSel, save: savePng, share })[act]?.();
    });
    // keyboard: arrows move between tabs
    ui.querySelector(".du-tabs").addEventListener("keydown", (e) => {
      const i = TABS.findIndex((x) => x.id === tab);
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      tab = TABS[(i + d + TABS.length) % TABS.length].id;
      renderItems();
      ui.querySelector(`[data-tab="${tab}"]`)?.focus();
    });
    renderItems();
    renderRating();
  }

  return {
    quips: ["Fit check · فِت تشيك"],
    ready() {
      mountUi();
    },
    leave() {
      ui = null;
      ptrs.clear();
      drag = pinch = null;
    },
    charsChanged() {
      if (tab === "who") renderItems();
    },
    reset() {
      sel = null;
      drag = pinch = null;
      ptrs.clear();
      k.run.score = 0;
    },
    onStart() {
      if (!ui) mountUi();
    },
    idle(dt) {
      t += dt;
    },
    update(dt) {
      t += dt;
    },
    press(x, y, type, id) {
      ptrs.set(id, { x, y });
      if (ptrs.size === 2 && sel) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: sel.s };
        drag = null;
        return;
      }
      const hit = hitItem(x, y);
      sel = hit;
      if (hit) {
        pushHist();
        drag = { id, dx: x - hit.x, dy: y - hit.y, moved: false };
        // bring to front within its layer
        fit.items.splice(fit.items.indexOf(hit), 1);
        fit.items.push(hit);
        play("tick");
      }
      renderItems();
    },
    move(x, y, type, id) {
      if (!ptrs.has(id)) return;
      ptrs.set(id, { x, y });
      if (pinch && sel && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        sel.s = clamp((pinch.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, 0.3, 3);
        return;
      }
      if (drag && sel && drag.id === id) {
        sel.x = clamp(x - drag.dx, 0, W);
        sel.y = clamp(y - drag.dy, 0, H);
        drag.moved = true;
      }
    },
    release(x, y, id) {
      ptrs.delete(id);
      if (pinch && ptrs.size < 2) {
        pinch = null;
        store.set(SAVE_KEY, fit);
      }
      if (drag && drag.id === id) {
        if (!drag.moved) hist.pop(); // a tap that only selected doesn't need an undo step
        drag = null;
        changed();
      }
    },
    wheel(x, y, dy) {
      const it = sel || hitItem(x, y);
      if (!it) return;
      sel = it;
      it.s = clamp(it.s * Math.exp(-dy * 0.0015), 0.3, 3);
      clearTimeout(this._wt);
      this._wt = setTimeout(() => store.set(SAVE_KEY, fit), 300);
    },
    keydown(e) {
      const c = e.code;
      if (c === "KeyZ") return undo(), true;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (c === "KeyR") return randomize(), true;
      if (c === "KeyP" || c === "Escape") {
        sel = null;
        renderItems();
        return true;
      }
      if (c === "Delete" || c === "Backspace") return removeSel(), true;
      if (c === "Equal" || c === "NumpadAdd") return scaleSel(1.15), true;
      if (c === "Minus" || c === "NumpadSubtract") return scaleSel(1 / 1.15), true;
      if (c === "KeyS") return savePng(), true;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[c];
      if (d && sel) {
        const step = e.shiftKey ? 12 : 3;
        sel.x = clamp(sel.x + d[0] * step, 0, W);
        sel.y = clamp(sel.y + d[1] * step, 0, H);
        store.set(SAVE_KEY, fit);
        return true;
      }
      return c === "Space" || !!d;
    },
    draw() {
      compose(ctx);
      if (k.isPlaying() && !fit.items.length && fit.outfit === "tee") {
        rrect(ctx, 40, 428, W - 80, 34, 10);
        inked(ctx, "#ffffff", 3);
        text(ctx, "Pick stuff below 👇 · اختار من تحت", W / 2, 445, 14, INK);
      }
    },
    // exposed for tests / debugging
    _debug: { get fit() { return fit; }, rating, makePng },
  };
}
