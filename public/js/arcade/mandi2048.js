// 🍖 2048 Mandi: merge dishes up the Egyptian food chain. Score = value of every merge (classic 2048 rules).
export default function mandi2048(k) {
  const { W, ctx, INK, MUSTARD, PINK, SLIME, SKY, KETCHUP, run, play, burst, popText, shake, unlock, finish, rr, label, drawEmoji, clamp, lerp, easeOutBack } = k;
  const N = 4;
  const BX = 20;
  const BY = 118;
  const BS = 320;
  const CELL = BS / N;
  // level 1 = 2, level 2 = 4, … level 11 = 2048
  const CHAIN = [
    null,
    ["🫓", "عيش", "#fff4e0"],
    ["🫘", "فول", "#ffe7b3"],
    ["🧆", "طعمية", SLIME],
    ["🍝", "كشري", "#ffb36b"],
    ["🫑", "محشي", "#b8f07a"],
    ["🍖", "مندي", MUSTARD],
    ["🌯", "شاورما", PINK],
    ["🥙", "حواوشي", SKY],
    ["🍲", "فتة", "#ff9f80"],
    ["🥘", "صينية", "#c9a7ff"],
    ["🐑", "خروف", KETCHUP],
    ["👑", "عزومة", "#ffd700"],
    ["🏆", "أسطورة", "#ffffff"],
  ];
  const info = (lv) => CHAIN[Math.min(lv, CHAIN.length - 1)];
  const at = (r, c) => ({ x: BX + c * CELL + CELL / 2, y: BY + r * CELL + CELL / 2 });
  let uid = 0;

  return {
    quips: ["Kitchen's full · المطبخ اتملى", "No more room on the tray · الصينية فولت"],
    reset() {
      this.tiles = [];
      this.ghosts = [];
      this.anim = 1;
      this.top = 1;
      this.over = 0;
      this.drag = null;
      this.t = 0;
      run.score = 0;
      run.reason = "";
      this.spawn();
      this.spawn();
    },
    idle(dt) {
      this.t += dt;
      this.anim = 1;
    },
    grid() {
      const g = Array.from({ length: N }, () => Array(N).fill(null));
      for (const t of this.tiles) g[t.r][t.c] = t;
      return g;
    },
    spawn() {
      const g = this.grid();
      const free = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!g[r][c]) free.push([r, c]);
      if (!free.length) return;
      const [r, c] = free[Math.floor(Math.random() * free.length)];
      this.tiles.push({ id: ++uid, lv: Math.random() < 0.9 ? 1 : 2, r, c, pr: r, pc: c, born: 0, pop: 0 });
    },
    canMove() {
      const g = this.grid();
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const t = g[r][c];
          if (!t) return true;
          if (c < N - 1 && g[r][c + 1] && g[r][c + 1].lv === t.lv) return true;
          if (r < N - 1 && g[r + 1][c] && g[r + 1][c].lv === t.lv) return true;
        }
      return false;
    },
    move(dr, dc) {
      if (this.over) return;
      if (this.anim < 1) this.finishAnim();
      const g = this.grid();
      for (const t of this.tiles) (t.pr = t.r), (t.pc = t.c), (t.pop = 0);
      this.ghosts = [];
      let moved = false;
      let gained = 0;
      let topMerge = 0;
      for (let line = 0; line < N; line++) {
        // cells along the line, starting from the wall we're pushing towards
        const cells = [];
        for (let i = 0; i < N; i++) {
          const step = dr + dc > 0 ? N - 1 - i : i;
          cells.push(dr ? [step, line] : [line, step]);
        }
        const row = cells.map(([r, c]) => g[r][c]).filter(Boolean);
        const out = [];
        for (let i = 0; i < row.length; i++) {
          const t = row[i];
          const n = row[i + 1];
          if (n && n.lv === t.lv) {
            t.lv++;
            t.pop = 1;
            gained += 2 ** t.lv;
            topMerge = Math.max(topMerge, t.lv);
            this.ghosts.push(n);
            n.dead = true;
            out.push({ t, mergedFrom: n });
            i++;
          } else out.push({ t });
        }
        out.forEach(({ t, mergedFrom }, i) => {
          const [r, c] = cells[i];
          if (t.r !== r || t.c !== c || mergedFrom) moved = true;
          t.r = r;
          t.c = c;
          if (mergedFrom) (mergedFrom.r = r), (mergedFrom.c = c);
        });
      }
      if (!moved) {
        play("tick");
        return;
      }
      this.tiles = this.tiles.filter((t) => !t.dead);
      this.anim = 0;
      run.score += gained;
      if (gained) {
        play(topMerge >= 6 ? "wow" : "pop");
        if (topMerge > this.top) {
          this.top = topMerge;
          const [e, name] = info(topMerge);
          popText(W / 2, 96, `${e} ${name}!`, MUSTARD, 26);
          if (topMerge >= 6) unlock("mandi");
          if (topMerge >= 9) unlock("feast");
          if (topMerge >= 11) play("celebrate");
          shake(0.15);
        }
      } else play("whoosh");
      this.spawn();
      if (!this.canMove()) {
        this.over = 0.9;
        run.reason = `Kitchen's full · المطبخ اتملى — top dish ${info(this.top)[0]} ${info(this.top)[1]}`;
        play("ohno");
      }
    },
    finishAnim() {
      this.anim = 1;
      this.ghosts = [];
    },
    key(code, down) {
      if (!down) return;
      const d = { ArrowLeft: [0, -1], KeyA: [0, -1], ArrowRight: [0, 1], KeyD: [0, 1], ArrowUp: [-1, 0], KeyW: [-1, 0], ArrowDown: [1, 0], KeyS: [1, 0] }[code];
      if (d) this.move(d[0], d[1]);
    },
    press(x, y) {
      this.drag = { x, y };
    },
    release(x, y) {
      if (!this.drag) return;
      const dx = x - this.drag.x;
      const dy = y - this.drag.y;
      this.drag = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) this.move(0, dx > 0 ? 1 : -1);
      else this.move(dy > 0 ? 1 : -1, 0);
    },
    update(dt) {
      this.t += dt;
      if (this.anim < 1) {
        this.anim = Math.min(1, this.anim + dt / (k.calm() ? 0.06 : 0.11));
        if (this.anim >= 1) {
          for (const t of this.tiles) if (t.pop) {
            const p = at(t.r, t.c);
            burst(p.x, p.y, { n: 6, speed: 120, size: 4 });
          }
          this.ghosts = [];
        }
      }
      for (const t of this.tiles) {
        t.born = Math.min(1, t.born + dt * 7);
        if (this.anim >= 1) t.pop = Math.max(0, t.pop - dt * 5);
      }
      if (this.over > 0) {
        this.over -= dt;
        if (this.over <= 0) finish();
      }
    },
    drawTile(t, a) {
      const p0 = at(t.pr, t.pc);
      const p1 = at(t.r, t.c);
      const e = clamp(a, 0, 1);
      const x = lerp(p0.x, p1.x, e);
      const y = lerp(p0.y, p1.y, e);
      const born = t.born < 1 ? easeOutBack(t.born) : 1;
      const pop = this.anim >= 1 ? 1 + Math.sin(t.pop * Math.PI) * 0.12 : 1;
      const s = (CELL - 10) * born * pop;
      const [emoji, name, col] = info(t.lv);
      ctx.save();
      ctx.translate(x, y);
      rr(-s / 2, -s / 2, s, s, 12);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      drawEmoji(emoji, 0, -8 * born, s * 0.5);
      ctx.font = `bold ${Math.round(12 * born)}px "Cairo", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.fillText(name, 0, s * 0.3);
      ctx.font = `bold ${Math.round(9 * born)}px system-ui, sans-serif`;
      ctx.fillText(String(2 ** t.lv), s * 0.32, -s * 0.36);
      ctx.restore();
    },
    draw() {
      ctx.fillStyle = "#ffe9c7";
      ctx.fillRect(0, 0, W, 480);
      // tray
      rr(BX - 8, BY - 8, BS + 16, BS + 16, 18);
      ctx.fillStyle = "#c98b4b";
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const p = at(r, c);
          rr(p.x - CELL / 2 + 5, p.y - CELL / 2 + 5, CELL - 10, CELL - 10, 12);
          ctx.fillStyle = "rgba(255,244,224,.35)";
          ctx.fill();
        }
      const a = k.calm() ? 1 : this.anim ?? 1;
      for (const gh of this.ghosts || []) this.drawTile({ ...gh, lv: gh.lv, born: 1, pop: 0 }, a);
      for (const t of this.tiles || []) this.drawTile(t, a);
      // chain legend
      ctx.font = `12px "Cairo", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = INK;
      ctx.fillText("عيش ← فول ← طعمية ← كشري ← محشي ← مندي ← …", W / 2, BY + BS + 26);
    },
    hud() {
      const [e, name] = info(this.top);
      label(`top: ${e} ${name}`, 14, 52, 15, "#ffffff", "left");
    },
  };
}
