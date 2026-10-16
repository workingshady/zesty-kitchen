// 🗼 Stack the Tray / صينية التيم: a tray slides across, tap to drop it on the stack.
// Overhang gets sliced off; perfect drops (±5px) keep the width and grow it back after a streak.
export default function stack(k) {
  const { W, ctx, INK, MUSTARD, PINK, SKY, PAL, run, play, burst, popText, shake, hitstop, flash, unlock, finish, rr, label, drawEmoji, drawFace, lerp } = k;
  const LH = 22;
  const BASE_Y = 452;
  const BASE_W = 210;
  const PERFECT = 5;
  const FOODS = ["🍗", "🧆", "🍝", "🫓", "🥙", "🍖", "🫑", "🌯"];

  const screenY = (worldTop, cam) => BASE_Y - worldTop + cam;

  return {
    quips: ["The tray has fallen · الصينية وقعت", "Gravity: 1 · Team: 0", "Who's cleaning this up? · مين هينضف؟"],
    reset() {
      this.layers = [{ x: (W - BASE_W) / 2, w: BASE_W, kind: 0, who: null, food: "🍗" }];
      this.cam = 0;
      this.streak = 0;
      this.perfects = 0;
      this.bits = [];
      this.dead = false;
      this.deadT = 0;
      this.t = 0;
      this.flashT = 0;
      this.newBlock();
      run.score = 0;
      run.reason = "";
    },
    newBlock() {
      const top = this.layers[this.layers.length - 1];
      const n = this.layers.length;
      const fromLeft = n % 2 === 1;
      this.cur = {
        w: top.w,
        x: fromLeft ? -top.w * 0.4 : W - top.w * 0.6,
        dir: fromLeft ? 1 : -1,
        speed: Math.min(330, 135 + n * 7),
        kind: n % 2,
        who: n % 2 ? null : k.randomDish(),
        food: FOODS[n % FOODS.length],
      };
    },
    idle(dt) {
      this.t += dt;
      if (this.cur) this.slide(dt * 0.6);
    },
    slide(dt) {
      const c = this.cur;
      c.x += c.dir * c.speed * dt;
      const min = -c.w * 0.45;
      const max = W - c.w * 0.55;
      if (c.x < min) (c.x = min), (c.dir = 1);
      if (c.x > max) (c.x = max), (c.dir = -1);
    },
    drop() {
      if (this.dead || !this.cur) return;
      const c = this.cur;
      const prev = this.layers[this.layers.length - 1];
      const n = this.layers.length;
      const yTop = screenY((n + 1) * LH, this.cam);
      const L = Math.max(c.x, prev.x);
      const R = Math.min(c.x + c.w, prev.x + prev.w);
      const ov = R - L;
      if (ov <= 0) {
        this.bits.push({ ...c, y: yTop, vy: 0, vx: c.dir * 40, rot: 0, vr: c.dir * 2 });
        this.cur = null;
        this.dead = true;
        run.reason = pickReason(n);
        shake(0.7);
        flash(0.5);
        play("bigfail");
        return;
      }
      const diff = c.x - prev.x;
      let x = L;
      let w = ov;
      if (Math.abs(diff) <= PERFECT) {
        x = prev.x;
        w = prev.w;
        this.streak++;
        this.perfects++;
        if (this.streak >= 3) {
          const grow = Math.min(BASE_W - w, 10);
          x -= grow / 2;
          w += grow;
        }
        run.score += 2;
        popText(x + w / 2, yTop - 18, this.streak >= 3 ? `Perfect x${this.streak} · مظبوط` : "Perfect! · مظبوط", MUSTARD, 20);
        burst(x + w / 2, yTop + LH / 2, { n: 16, colors: [MUSTARD, "#ffffff", PINK], speed: 220 });
        this.flashT = 0.25;
        play(this.streak >= 3 ? "wow" : "ding");
        if (this.streak >= 5) unlock("sniper");
      } else {
        this.streak = 0;
        run.score += 1;
        // the sliced overhang falls off
        const cutX = c.x < prev.x ? c.x : R;
        const cutW = c.w - ov;
        this.bits.push({ ...c, x: cutX, w: cutW, y: yTop, vy: -40, vx: c.x < prev.x ? -60 : 60, rot: 0, vr: c.x < prev.x ? -2.5 : 2.5 });
        play("pop");
        shake(0.08);
        hitstop(30);
      }
      this.layers.push({ x, w, kind: c.kind, who: c.who, food: c.food });
      if (this.layers.length - 1 >= 15) unlock("tower");
      if ((this.layers.length - 1) % 10 === 0) {
        popText(W / 2, 150, `${this.layers.length - 1} high! · عالي`, PINK, 26);
        play("hype");
      }
      this.newBlock();
    },
    press() {
      this.drop();
    },
    key(code, down) {
      if (down && (code === "Space" || code === "Enter" || code === "ArrowDown" || code === "KeyS")) this.drop();
    },
    update(dt) {
      this.t += dt;
      this.flashT = Math.max(0, this.flashT - dt);
      if (this.cur && !this.dead) this.slide(dt);
      const target = Math.max(0, this.layers.length * LH - 250);
      this.cam = lerp(this.cam, target, Math.min(1, dt * 6));
      for (const b of this.bits) {
        b.vy += 900 * dt;
        b.y += b.vy * dt;
        b.x += b.vx * dt;
        b.rot += b.vr * dt;
      }
      this.bits = this.bits.filter((b) => b.y < 700);
      if (this.dead) {
        this.deadT += dt;
        if (this.deadT > 1.1) finish();
      }
    },
    drawLayer(l, y, i) {
      ctx.save();
      rr(l.x, y, l.w, LH, 6);
      if (l.kind === 0) {
        const g = ctx.createLinearGradient(0, y, 0, y + LH);
        g.addColorStop(0, "#f2f2f2");
        g.addColorStop(1, "#a9a9a9");
        ctx.fillStyle = g;
      } else ctx.fillStyle = PAL[i % PAL.length];
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.clip();
      const step = 30;
      for (let x = l.x + 15; x < l.x + l.w - 4; x += step) {
        if (l.kind === 0 && l.who) drawFace(l.who, x, y + LH / 2, 8, { lw: 1.5 });
        else drawEmoji(l.food, x, y + LH / 2, 17);
      }
      ctx.restore();
    },
    draw() {
      const h = Math.min(1, (this.layers?.length || 0) / 40);
      const g = ctx.createLinearGradient(0, 0, 0, 480);
      g.addColorStop(0, h > 0.6 ? "#1d1b3a" : h > 0.3 ? "#ff8e6b" : SKY);
      g.addColorStop(1, h > 0.6 ? "#4b3a7a" : h > 0.3 ? "#ffd29e" : "#d6f1ff");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, 480);
      if (h > 0.6) {
        ctx.fillStyle = "#ffffff";
        for (let i = 0; i < 30; i++) ctx.fillRect((i * 97) % W, (i * 53 + this.cam * 0.2) % 480, 2, 2);
      }
      const cam = this.cam || 0;
      // Cairo skyline far below
      const sky = BASE_Y + LH + cam * 0.5;
      ctx.fillStyle = "#e3b664";
      ctx.beginPath();
      ctx.moveTo(40, sky);
      ctx.lineTo(95, sky - 60);
      ctx.lineTo(150, sky);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.fillStyle = "#c9a26b";
      for (const [x, w, hh] of [[170, 40, 50], [215, 30, 80], [250, 50, 40], [305, 40, 66]]) {
        ctx.fillRect(x, sky - hh, w, hh);
        ctx.strokeRect(x, sky - hh, w, hh);
      }
      // table
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(0, BASE_Y + LH + cam, W, 200);
      ctx.fillStyle = INK;
      ctx.fillRect(0, BASE_Y + LH + cam, W, 4);
      (this.layers || []).forEach((l, i) => {
        const y = screenY((i + 1) * LH, cam);
        if (y > -LH && y < 520) this.drawLayer(l, y, i);
      });
      if (this.flashT > 0 && this.layers) {
        const l = this.layers[this.layers.length - 1];
        const y = screenY(this.layers.length * LH, cam);
        ctx.globalAlpha = this.flashT * 3;
        rr(l.x - 4, y - 4, l.w + 8, LH + 8, 8);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (this.cur) {
        const n = this.layers.length;
        const y = screenY((n + 1) * LH, cam);
        // drop guide
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "rgba(17,17,17,.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(this.cur.x + this.cur.w / 2, y + LH);
        ctx.lineTo(this.cur.x + this.cur.w / 2, y + LH + 40);
        ctx.stroke();
        ctx.setLineDash([]);
        this.drawLayer(this.cur, y, n);
      }
      for (const b of this.bits || []) {
        ctx.save();
        ctx.translate(b.x + b.w / 2, b.y + LH / 2);
        ctx.rotate(b.rot);
        this.drawLayer({ ...b, x: -b.w / 2 }, -LH / 2, 3);
        ctx.restore();
      }
      if (!k.isPlaying()) return;
      if ((this.layers?.length || 0) < 3) label("Tap to drop · دوس عشان تنزل", W / 2, 110, 16, "#ffffff");
    },
    hud() {
      label(`${this.layers.length - 1} high`, 14, 52, 15, "#ffffff", "left");
      if (this.streak >= 2) label(`🎯 x${this.streak}`, W - 60, 52, 16, MUSTARD, "right");
    },
  };

  function pickReason(n) {
    if (n <= 3) return "Dropped it on the floor · وقعت من أولها";
    if (n < 15) return "The tray has fallen · الصينية وقعت";
    return "Legendary tower, tragic ending · برج أسطوري ونهاية حزينة";
  }
}
