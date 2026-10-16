// 🧠 Face Memory: flip cards, match coworker pairs. Score = 100 per pair + speed/efficiency bonus.
export default function memory(k) {
  const { W, ctx, INK, CREAM, MUSTARD, PINK, SLIME, KETCHUP, PAL, run, play, burst, popText, shake, unlock, finish, rr, label, drawFace, drawEmoji, clamp } = k;
  const COLS = 4;
  const ROWS = 4;
  const PAIRS = (COLS * ROWS) / 2;
  const TOP = 96;
  const GAP = 8;
  const CW = (W - 28 - GAP * (COLS - 1)) / COLS;
  const CH = (480 - TOP - 12 - GAP * (ROWS - 1)) / ROWS;
  const cardXY = (i) => ({ x: 14 + (i % COLS) * (CW + GAP), y: TOP + Math.floor(i / COLS) * (CH + GAP) });

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Prefer coworkers (photos), top up with food emoji so there are always 8 pairs
  function faces() {
    const pool = shuffle([...k.coworkers]).slice(0, PAIRS);
    const foods = shuffle([...k.FOODS]);
    while (pool.length < PAIRS) {
      const e = foods.pop() || "🍽️";
      pool.push({ id: "f" + e, label: e, emoji: e, bg: PAL[pool.length % PAL.length] });
    }
    return pool;
  }

  return {
    quips: ["Brain.exe stopped · المخ هنج", "Goldfish energy · ذاكرة سمكة", "Not bad for a Monday · حلو لـيوم اتنين"],
    reset() {
      const f = faces();
      this.cards = shuffle([...f, ...f].map((who, i) => ({ who, pair: who.id, up: false, done: false, flip: 0, wob: 0, i })));
      this.open = [];
      this.moves = 0;
      this.matched = 0;
      this.time = 0;
      this.timing = false;
      this.hideAt = 0;
      this.cursor = 0;
      this.kb = false;
      this.ending = 0;
      this.t = 0;
      run.score = 0;
      run.reason = "";
    },
    idle(dt) {
      this.t += dt;
    },
    pick(i) {
      if (this.ending) return;
      const c = this.cards[i];
      if (!c || c.up || c.done) return;
      if (this.open.length === 2) this.settle(); // impatient third tap: resolve right away
      c.up = true;
      this.open.push(c);
      this.timing = true;
      play("tick");
      if (this.open.length === 2) {
        this.moves++;
        const [a, b] = this.open;
        if (a.pair === b.pair) {
          a.done = b.done = true;
          this.open = [];
          this.matched++;
          run.score += 100;
          const p = cardXY(b.i);
          burst(p.x + CW / 2, p.y + CH / 2, { n: 14, speed: 200 });
          popText(p.x + CW / 2, p.y + 10, "+100", SLIME, 22);
          play(this.matched === PAIRS ? "celebrate" : "coin");
          if (this.matched === PAIRS) this.win();
        } else {
          this.hideAt = 0.75;
          a.wob = b.wob = 1;
          play("bonk");
        }
      }
    },
    settle() {
      for (const c of this.open) c.up = false;
      this.open = [];
      this.hideAt = 0;
    },
    win() {
      this.timing = false;
      const bonus = Math.max(0, 600 - (this.moves - PAIRS) * 25 - Math.floor(this.time) * 5);
      run.score += bonus;
      run.reason = this.moves <= 10 ? "Photographic memory · ذاكرة كاميرا" : this.moves <= 14 ? "Solid recall · حافظ الوشوش" : "Got there eventually · وصلت والسلام";
      popText(W / 2, 260, `Bonus +${bonus}`, MUSTARD, 30);
      if (this.moves <= 12) unlock("elephant");
      shake(0.2);
      this.ending = 1.1;
    },
    hit(x, y) {
      for (let i = 0; i < this.cards.length; i++) {
        const p = cardXY(i);
        if (x >= p.x && x <= p.x + CW && y >= p.y && y <= p.y + CH) return i;
      }
      return -1;
    },
    press(x, y) {
      this.kb = false;
      const i = this.hit(x, y);
      if (i >= 0) this.pick(i);
    },
    key(code, down) {
      if (!down) return;
      const d = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: -COLS, KeyW: -COLS, ArrowDown: COLS, KeyS: COLS }[code];
      if (d) {
        this.kb = true;
        this.cursor = clamp(this.cursor + d, 0, this.cards.length - 1);
        play("tick");
      } else if (code === "Space" || code === "Enter") {
        this.kb = true;
        this.pick(this.cursor);
      }
    },
    update(dt) {
      this.t += dt;
      if (this.timing) this.time += dt;
      if (this.hideAt > 0) {
        this.hideAt -= dt;
        if (this.hideAt <= 0) this.settle();
      }
      for (const c of this.cards) {
        c.flip = clamp(c.flip + (c.up || c.done ? dt : -dt) * 6, 0, 1);
        c.wob = Math.max(0, c.wob - dt * 2.5);
      }
      if (this.ending > 0) {
        this.ending -= dt;
        if (this.ending <= 0) finish();
      }
    },
    draw() {
      ctx.fillStyle = "#ffd6ec";
      ctx.fillRect(0, 0, W, 480);
      ctx.fillStyle = "#ffc2e2";
      for (let y = 0; y < 480; y += 24) for (let x = (y / 24) % 2 ? 12 : 0; x < W; x += 24) ctx.fillRect(x, y, 12, 12);
      (this.cards || []).forEach((c, i) => {
        const p = cardXY(i);
        const f = c.flip;
        const sx = Math.abs(Math.cos(f * Math.PI)) || 0.02;
        const showFront = f > 0.5;
        const wob = Math.sin(c.wob * 20) * c.wob * 4;
        ctx.save();
        ctx.translate(p.x + CW / 2 + wob, p.y + CH / 2);
        ctx.scale(sx, c.done ? 1 + Math.sin(this.t * 6 + i) * 0.015 : 1);
        rr(-CW / 2, -CH / 2, CW, CH, 10);
        ctx.fillStyle = showFront ? (c.done ? "#e8ffc2" : CREAM) : PAL[i % PAL.length];
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.stroke();
        if (showFront) {
          drawFace(c.who, 0, -6, Math.min(CW, CH) * 0.36, { ring: c.done ? SLIME : INK });
          ctx.font = `11px system-ui, sans-serif`;
          ctx.fillStyle = INK;
          ctx.textAlign = "center";
          const name = String(c.who.label || "").slice(0, 12);
          ctx.fillText(name, 0, CH / 2 - 10);
        } else {
          drawEmoji("🍽️", 0, 0, 34);
          ctx.globalAlpha = 0.25;
          label("?", 0, 26, 18, "#ffffff");
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        if (this.kb && i === this.cursor && k.isPlaying()) {
          ctx.setLineDash([6, 4]);
          rr(p.x - 3, p.y - 3, CW + 6, CH + 6, 12);
          ctx.strokeStyle = KETCHUP;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      });
    },
    hud() {
      label(`${this.moves} moves`, 14, 50, 15, "#ffffff", "left");
      label(`${Math.floor(this.time)}s · ${this.matched}/${PAIRS}`, W - 60, 50, 15, PINK, "right");
      if (!this.timing && !this.matched) label("Tap any card · اقلب كارت", W / 2, 76, 15, "#ffffff");
    },
  };
}
