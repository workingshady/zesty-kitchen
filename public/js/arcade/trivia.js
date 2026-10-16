// 🗣️ Who said it? / مين قالها: a catchphrase, job title, menu description or face, pick the coworker.
// 10 questions, 10s each, 3 lives. Points = (100 + 10/sec left) × streak multiplier. Canned office/food
// trivia fills in when the menu doesn't have enough coworker data.
export default function trivia(k) {
  const { W, ctx, INK, CREAM, MUSTARD, PINK, SLIME, KETCHUP, run, play, burst, popText, shake, unlock, finish, rr, label, drawFace, clamp, pickOne } = k;
  const ROUNDS = 10;
  const SECS = 10;
  const OY = 238;
  const OH = 54;
  const OG = 6;
  const BODY = '"Cairo", "Baloo Bhaijaan 2", system-ui, sans-serif';

  // [question en, question ar, [answers], correct index]
  const CANNED = [
    ["Which one is NOT in koshary?", "إيه اللي مش في الكشري؟", ["Pasta · مكرونة", "Lentils · عدس", "Rice · رز", "Chicken · فراخ"], 3],
    ["In Alexandria, ta'meya is called…", "الطعمية في إسكندرية اسمها…", ["Falafel · فلافل", "Bessara · بصارة", "Kofta · كفتة", "Hawawshi · حواوشي"], 0],
    ["“I'm 5 minutes away” in Egyptian means…", "«أنا على بعد ٥ دقايق» يعني…", ["5 minutes", "Still in the shower · لسه في الحمام", "Already there", "Lost · تايه"], 1],
    ["Foul medames is traditionally cooked in a…", "الفول المدمس بيتعمل في…", ["Qedra · قدرة", "Microwave · ميكروويف", "Air fryer", "Kettle · كاتل"], 0],
    ["Who drinks the most tea in the office?", "مين بيشرب شاي أكتر في المكتب؟", ["The manager · المدير", "IT", "HR", "All of us, wallahi · كلنا والله"], 3],
    ["What does “يسطا” mean?", "يعني إيه «يسطا»؟", ["Bro / boss", "Street", "Stop", "Tomorrow"], 0],
    ["Hawawshi is basically…", "الحواوشي ببساطة…", ["Meat baked in baladi bread · لحمة في عيش", "Sushi", "A salad · سلطة", "A dessert · حلويات"], 0],
    ["“Half-hour lunch break” actually lasts…", "«نص ساعة بريك» بتطول قد إيه؟", ["30 min", "5 min", "An hour and a half · ساعة ونص", "Lunch? at work? 💀"], 2],
    ["Molokhia is usually eaten with…", "الملوخية بتتاكل مع…", ["Rice or bread · رز أو عيش", "Cornflakes", "Ice cream · آيس كريم", "Only Pepsi · بيبسي بس"], 0],
    ["“ثانية واحدة” from a coworker lasts…", "«ثانية واحدة» من زميلك بتاخد…", ["1 second", "1 minute", "Until Ramadan · لحد رمضان", "Exactly 1.0s"], 2],
    ["Om Ali is a…", "أم علي تبقى…", ["Dessert · حلو", "Coworker · زميلة", "Soup · شوربة", "Street · شارع"], 0],
    ["The meeting “could have been an…”", "الاجتماع ده كان ممكن يبقى…", ["Email · إيميل", "Album", "Ending", "Excuse"], 0],
    ["Sobia is a…", "السوبيا تبقى…", ["Ramadan drink · مشروب رمضان", "Car · عربية", "Bread · عيش", "Dance · رقصة"], 0],
    ["What do you say when the food arrives?", "بتقول إيه لما الأكل يوصل؟", ["Bel hana · بالهنا", "Goodbye", "Who ordered? · مين طالب؟", "Both 1 and 3"], 3],
  ];

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  // hide the coworker's own name inside their description so it isn't a giveaway
  function redact(text, who) {
    let t = String(text || "");
    for (const n of [who.dish?.name_en, who.dish?.name_ar])
      for (const w of String(n || "").split(/\s+/).filter((x) => x.length > 2)) t = t.split(w).join("___");
    return t;
  }

  function coworkerQuestions() {
    const pool = k.coworkers.filter((c) => c.dish);
    if (pool.length < 4) return [];
    const qs = [];
    for (const who of pool) {
      const d = who.dish;
      if (d.catchphrase) qs.push({ who, en: "Who always says:", ar: "مين اللي دايمًا بيقول؟", quote: d.catchphrase });
      if (d.job_title) qs.push({ who, en: "Whose job is this?", ar: "مين شغلته كده؟", quote: d.job_title });
      if (d.description && d.description.length > 12) qs.push({ who, en: "The menu says:", ar: "المنيو بيقول:", quote: redact(d.description, who) });
      if (who.sprite || who.photo) qs.push({ who, en: "Who's this?", ar: "مين ده؟", face: true });
    }
    return shuffle(qs).map((q) => {
      const others = shuffle(pool.filter((c) => c !== q.who && c.label !== q.who.label)).slice(0, 3);
      const opts = shuffle([q.who, ...others]);
      return { ...q, opts: opts.map((c) => ({ text: c.label, who: c })), answer: opts.indexOf(q.who) };
    });
  }
  function cannedQuestions() {
    return shuffle(CANNED.map(([en, ar, answers, ok]) => {
      const opts = answers.map((text, i) => ({ text, ok: i === ok }));
      // keep "Both 1 and 3"-style answers in place, shuffle the rest
      const order = answers.some((a) => /^Both /.test(a)) ? opts : shuffle(opts);
      return { en, ar, opts: order, answer: order.findIndex((o) => o.ok) };
    }));
  }
  function wrap(text, maxW, font) {
    ctx.font = font;
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  return {
    quips: ["Gossip license revoked · رخصة النميمة اتسحبت", "You don't know your coworkers fr · انت مش عارف زمايلك"],
    reset() {
      const own = coworkerQuestions().slice(0, 8);
      this.qs = [...own, ...cannedQuestions()].slice(0, ROUNDS);
      if (own.length >= 2) this.qs = shuffle(this.qs);
      this.i = 0;
      this.lives = 3;
      this.streak = 0;
      this.right = 0;
      this.time = SECS;
      this.chosen = -1;
      this.fb = 0;
      this.hover = -1;
      this.t = 0;
      this.lastSec = SECS;
      run.score = 0;
      run.reason = "";
    },
    idle(dt) {
      this.t += dt;
    },
    cur() {
      return this.qs?.[this.i];
    },
    answer(n) {
      const q = this.cur();
      if (!q || this.chosen !== -1 || n < 0 || n >= q.opts.length) return;
      this.chosen = n;
      this.fb = 1.05;
      const y = OY + n * (OH + OG) + OH / 2;
      if (n === q.answer) {
        this.streak++;
        this.right++;
        const mult = Math.min(3, 1 + Math.floor(this.streak / 3));
        const pts = (100 + Math.ceil(this.time) * 10) * mult;
        run.score += pts;
        popText(W / 2, y - 30, `+${pts}${mult > 1 ? ` x${mult}` : ""}`, SLIME, 24);
        burst(W - 40, y, { n: 14, speed: 200 });
        play(this.streak >= 3 ? "wow" : "success");
        if (this.streak >= 5) unlock("gossip");
      } else {
        this.miss(n < 0 ? "Too slow · بطيء" : pickOne(["Wrong! · غلط", "Nope · لأ يا حبيبي", "Cap · كدب"]), y);
      }
    },
    miss(text, y) {
      this.streak = 0;
      this.lives--;
      popText(W / 2, y - 30, text, KETCHUP, 22);
      shake(0.3);
      play(this.lives <= 0 ? "bigfail" : "fail");
    },
    next() {
      this.i++;
      this.chosen = -1;
      this.time = SECS;
      this.lastSec = SECS;
      if (this.lives <= 0 || this.i >= this.qs.length) {
        run.reason =
          this.lives <= 0 ? "Out of lives · الأرواح خلصت" : this.right >= 9 ? "Certified office gossip · نميمة معتمدة" : this.right >= 6 ? "You know the team · عارف التيم" : pickOne(this.quips);
        if (this.lives > 0) play("celebrate");
        finish();
      } else play("whoosh");
    },
    press(x, y) {
      const n = this.optAt(x, y);
      if (n >= 0) this.answer(n);
    },
    move(x, y) {
      this.hover = this.optAt(x, y);
    },
    optAt(x, y) {
      if (x < 14 || x > W - 14) return -1;
      for (let n = 0; n < 4; n++) {
        const oy = OY + n * (OH + OG);
        if (y >= oy && y <= oy + OH) return n;
      }
      return -1;
    },
    key(code, down) {
      const m = /^(?:Digit|Numpad)([1-4])$/.exec(code);
      if (down && m) this.answer(+m[1] - 1);
    },
    update(dt) {
      this.t += dt;
      if (!this.cur()) return;
      if (this.chosen >= 0 || this.chosen === -2) {
        this.fb -= dt;
        if (this.fb <= 0) this.next();
        return;
      }
      this.time -= dt;
      const sec = Math.ceil(this.time);
      if (sec < this.lastSec && sec <= 3 && sec > 0) play("tick");
      this.lastSec = sec;
      if (this.time <= 0) {
        this.time = 0;
        this.chosen = -2;
        this.fb = 1.1;
        this.miss("Time! · الوقت خلص", OY);
      }
    },
    draw() {
      ctx.fillStyle = "#c9f0ff";
      ctx.fillRect(0, 0, W, 480);
      ctx.fillStyle = "#b3e6fb";
      for (let i = 0; i < 12; i++) {
        ctx.beginPath();
        ctx.arc((i * 71) % W, (i * 137) % 480, 22 + (i % 3) * 10, 0, Math.PI * 2);
        ctx.fill();
      }
      const q = this.cur();
      if (!q) return;
      // question card (a speech bubble)
      rr(14, 70, W - 28, 158, 16);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.font = `bold 15px ${BODY}`;
      ctx.fillText(`${q.en}  ·  ${q.ar}`, W / 2, 90);
      if (q.face) {
        drawFace(q.who, W / 2, 152, 46, { lw: 4 });
      } else {
        const text = q.quote ? `“${clip(q.quote, 120)}”` : "";
        const font = `bold 17px ${BODY}`;
        const lines = text ? wrap(text, W - 64, font).slice(0, 4) : [];
        ctx.font = font;
        const y0 = 150 - ((lines.length - 1) * 22) / 2;
        lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * 22));
      }
      // timer
      const frac = clamp(this.time / SECS, 0, 1);
      rr(30, 210, W - 60, 8, 4);
      ctx.fillStyle = "#eeeeee";
      ctx.fill();
      if (frac > 0) {
        rr(30, 210, (W - 60) * frac, 8, 4);
        ctx.fillStyle = this.time <= 3 ? KETCHUP : MUSTARD;
        ctx.fill();
      }
      // answers
      q.opts.forEach((o, n) => {
        const y = OY + n * (OH + OG);
        const reveal = this.chosen !== -1;
        let fill = n === this.hover && !reveal ? "#fff8d6" : CREAM;
        if (reveal && n === q.answer) fill = SLIME;
        else if (reveal && n === this.chosen) fill = KETCHUP;
        rr(14, y, W - 28, OH, 12);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // key badge
        rr(22, y + 14, 24, 26, 6);
        ctx.fillStyle = PINK;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.font = `bold 15px ${BODY}`;
        ctx.textAlign = "center";
        ctx.fillText(String(n + 1), 34, y + OH / 2 + 1);
        let tx = 56;
        if (o.who && !q.face) {
          drawFace(o.who, 76, y + OH / 2, 18, { lw: 2 });
          tx = 102;
        }
        ctx.textAlign = "left";
        ctx.fillStyle = INK;
        ctx.font = `bold 15px ${BODY}`;
        let t = o.text;
        while (ctx.measureText(t).width > W - tx - 26 && t.length > 4) t = t.slice(0, -2);
        ctx.fillText(t === o.text ? t : t + "…", tx, y + OH / 2 + 1);
      });
    },
    hud() {
      label(`${"❤".repeat(Math.max(0, this.lives))}`, 14, 52, 16, KETCHUP, "left");
      label(`Q ${Math.min(this.i + 1, ROUNDS)}/${this.qs.length}${this.streak >= 2 ? ` · 🔥${this.streak}` : ""}`, W - 60, 52, 15, "#ffffff", "right");
    },
  };
}
