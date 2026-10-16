// ⌨️ Type the Order / اكتب الأوردر: order tickets cool down; type the dish (Franco-Arab / English) to serve it hot.
// Score per order = 10 per letter + up to 50 for heat, ×2 on a streak of 5+. Three cold orders = game over.
export default function typing(k) {
  const { W, ctx, INK, CREAM, MUSTARD, PINK, SLIME, SKY, KETCHUP, run, play, burst, popText, shake, unlock, finish, rr, label, drawEmoji, clamp, pickOne, esc } = k;
  const MAX = 4;
  const TY = 84;
  const TH = 80;
  const TG = 9;
  const MONO = 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
  const EASY = [["foul", "🫘"], ["mandi", "🍖"], ["kofta", "🍢"], ["pepsi", "🥤"], ["fatta", "🍲"], ["shai", "🍵"], ["kebda", "🥩"], ["3eish", "🫓"], ["batates", "🍟"], ["koshary", "🍝"]];
  const MID = [["ta3meya", "🧆"], ["shawarma", "🌯"], ["mahshy", "🫑"], ["hawawshi", "🥙"], ["molokhia", "🥬"], ["konafa", "🍯"], ["basbousa", "🍰"], ["feteer", "🥞"], ["sogo2", "🌭"], ["om ali", "🥧"]];
  const HARD = [["extra toom", "🧄"], ["no onions pls", "🧅"], ["shai bel na3na3", "🍵"], ["roz be laban", "🍚"], ["fool w ta3meya", "🧆"], ["koshary extra da2a", "🌶️"], ["mandi family tray", "🍖"], ["bel hana w el shefa", "🤲"]];

  let input = null;
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trimStart();

  return {
    quips: ["Customer left a 1-star · نجمة واحدة", "Food's cold, you're fired · الأكل برد، انت مرفود"],
    ready() {
      const t = k.tools;
      if (!t) return;
      t.hidden = false;
      t.innerHTML = `<label class="ty-wrap"><span class="ty-label">Type here · <span lang="ar" dir="rtl">اكتب هنا</span></span>
        <input id="typeIn" class="ty-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="40" placeholder="${esc("e.g. koshary")}" aria-label="Type the order"></label>`;
      input = t.querySelector("#typeIn");
      input.addEventListener("input", () => this.onType());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this.submit();
        } else if (e.key === "Escape") input.blur();
      });
      input.addEventListener("focus", () => {
        if (!k.isPlaying() && k.$("#frame").dataset.state !== "over") k.$("#overlay [data-act=start]")?.click();
      });
    },
    leave() {
      input = null;
    },
    onStart() {
      if (input) {
        input.value = "";
        input.focus({ preventScroll: true });
      }
    },
    reset() {
      this.tickets = [];
      this.spawnT = 0.4;
      this.lives = 3;
      this.served = 0;
      this.streak = 0;
      this.t = 0;
      this.dead = 0;
      this.shakeT = 0;
      this.typed = "";
      run.score = 0;
      run.reason = "";
      if (input) input.value = "";
    },
    idle(dt) {
      this.t += dt;
    },
    pool() {
      if (this.served < 6) return EASY;
      if (this.served < 16) return Math.random() < 0.6 ? MID : EASY;
      return Math.random() < 0.45 ? HARD : MID;
    },
    spawn() {
      if (this.tickets.length >= MAX) return;
      const used = new Set(this.tickets.map((t) => t.word));
      let pick;
      for (let i = 0; i < 8; i++) {
        pick = pickOne(this.pool());
        if (!used.has(pick[0])) break;
      }
      const life = Math.max(6, 13 - this.served * 0.25) + pick[0].length * 0.25;
      this.tickets.push({ word: pick[0], emoji: pick[1], heat: 1, life, born: 0, who: k.randomDish() });
      play("ding");
    },
    target() {
      const v = norm(this.typed);
      if (!v) return null;
      return this.tickets.find((t) => t.word.startsWith(v)) || null;
    },
    onType() {
      if (!input) return;
      this.typed = input.value;
      if (!k.isPlaying()) return;
      const v = norm(this.typed).trimEnd();
      const hit = this.tickets.find((t) => t.word === v);
      if (hit) this.serve(hit);
      else if (v && !this.target()) {
        this.shakeT = 0.25;
        play("tick");
      }
    },
    submit() {
      if (!k.isPlaying()) return;
      const v = norm(this.typed).trimEnd();
      const hit = this.tickets.find((t) => t.word === v);
      if (hit) return this.serve(hit);
      if (v) {
        popText(W / 2, 440, "Typo · غلط إملائي", KETCHUP, 20);
        this.streak = 0;
        play("bonk");
        shake(0.15);
        this.clear();
      }
    },
    clear() {
      this.typed = "";
      if (input) input.value = "";
    },
    serve(t) {
      const i = this.tickets.indexOf(t);
      const y = TY + i * (TH + TG) + TH / 2;
      this.streak++;
      this.served++;
      const mult = this.streak >= 5 ? 2 : 1;
      const pts = (t.word.replace(/\s/g, "").length * 10 + Math.round(t.heat * 50)) * mult;
      run.score += pts;
      popText(W / 2, y, `+${pts}${mult > 1 ? " 🔥" : ""}`, SLIME, 24);
      burst(W - 50, y, { n: 12, speed: 200, emoji: t.heat > 0.5 ? "♨️" : null, size: 5 });
      play(t.heat > 0.7 ? "cash" : "coin");
      this.tickets.splice(i, 1);
      this.clear();
      if (this.served >= 10) unlock("fingers");
      if (this.served % 10 === 0) {
        popText(W / 2, 70, "Rush hour! · زحمة", PINK, 24);
        play("hype");
      }
      if (!this.tickets.length) this.spawnT = Math.min(this.spawnT, 0.3);
    },
    press() {
      input?.focus({ preventScroll: true });
    },
    update(dt) {
      this.t += dt;
      this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.dead > 0) {
        this.dead -= dt;
        if (this.dead <= 0) finish();
        return;
      }
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawn();
        this.spawnT = Math.max(1.5, 3.4 - this.served * 0.07);
      }
      for (const t of [...this.tickets]) {
        t.born = Math.min(1, t.born + dt * 5);
        t.heat -= dt / t.life;
        if (t.heat <= 0) {
          this.tickets.splice(this.tickets.indexOf(t), 1);
          this.lives--;
          this.streak = 0;
          popText(W / 2, 200, "Cold order! · الأوردر برد 🥶", SKY, 22);
          shake(0.35);
          play(this.lives <= 0 ? "bigfail" : "fail");
          if (this.lives <= 0) {
            run.reason = pickOne(this.quips);
            this.dead = 0.9;
          }
        }
      }
    },
    draw() {
      // kitchen tiles
      ctx.fillStyle = "#fff4e0";
      ctx.fillRect(0, 0, W, 480);
      ctx.strokeStyle = "#f0dcc0";
      ctx.lineWidth = 2;
      for (let y = 0; y < 480; y += 30) for (let x = 0; x < W; x += 30) ctx.strokeRect(x, y, 30, 30);
      const tgt = this.target();
      const v = norm(this.typed);
      (this.tickets || []).forEach((t, i) => {
        const y = TY + i * (TH + TG);
        const off = (1 - t.born) * W;
        const jig = tgt === t && this.shakeT > 0 ? Math.sin(this.t * 80) * 3 : 0;
        ctx.save();
        ctx.translate(off + jig, 0);
        rr(14, y, W - 28, TH, 12);
        ctx.fillStyle = tgt === t ? "#fff8d6" : "#ffffff";
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.stroke();
        drawEmoji(t.emoji, 46, y + 32, 36);
        if (t.heat > 0.55) drawEmoji("♨️", 46 + Math.sin(this.t * 5 + i) * 3, y + 6, 18);
        else if (t.heat < 0.25) drawEmoji("🥶", 46, y + 8, 18);
        // word with typed prefix highlighted
        ctx.font = `bold 21px ${MONO}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const done = tgt === t ? v.length : 0;
        ctx.fillStyle = "#1a8f2e";
        ctx.fillText(t.word.slice(0, done), 80, y + 30);
        const w0 = ctx.measureText(t.word.slice(0, done)).width;
        ctx.fillStyle = INK;
        ctx.fillText(t.word.slice(done), 80 + w0, y + 30);
        // heat bar
        const hb = W - 28 - 80;
        rr(80, y + 54, hb, 10, 5);
        ctx.fillStyle = "#e8e8e8";
        ctx.fill();
        rr(80, y + 54, hb * clamp(t.heat, 0, 1), 10, 5);
        ctx.fillStyle = t.heat > 0.55 ? KETCHUP : t.heat > 0.25 ? MUSTARD : SKY;
        ctx.fill();
        ctx.restore();
      });
      if (k.isPlaying() && !(this.tickets || []).length) label("Orders incoming… · الأوردرات جاية", W / 2, 240, 18, PINK);
      // what you're typing
      rr(14, 438, W - 28, 32, 10);
      ctx.fillStyle = CREAM;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.typed && !tgt ? KETCHUP : INK;
      ctx.stroke();
      ctx.font = `bold 17px ${MONO}`;
      ctx.textAlign = "left";
      ctx.fillStyle = INK;
      const caret = Math.floor(this.t * 2) % 2 ? "▌" : "";
      ctx.fillText(`> ${this.typed || ""}${k.isPlaying() ? caret : ""}`, 24, 455);
    },
    hud() {
      label(`${"❤".repeat(Math.max(0, this.lives))}`, 14, 52, 16, KETCHUP, "left");
      label(`${this.served} served${this.streak >= 5 ? " · x2" : ""}`, W - 60, 52, 15, "#ffffff", "right");
    },
  };
}
