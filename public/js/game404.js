// Flappy-Face: a coworker's face flaps between stacks of plates.
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const GAP = 140;

let face = null;
fetch("/api/dishes")
  .then((r) => r.json())
  .then((dishes) => {
    const withPhoto = dishes.filter((d) => d.photo_url);
    if (!withPhoto.length) return;
    const img = new Image();
    img.onload = () => (face = img);
    img.src = withPhoto[Math.floor(Math.random() * withPhoto.length)].photo_url;
  })
  .catch(() => {});

let bird, pipes, score, best = 0, running, frame;

function reset() {
  bird = { x: 80, y: H / 2, vy: 0, r: 20 };
  pipes = [];
  score = 0;
  running = false;
  frame = 0;
}

function flap() {
  if (!running) running = true;
  bird.vy = -6.5;
}

function update() {
  if (!running) return;
  frame++;
  bird.vy += 0.35;
  bird.y += bird.vy;
  if (frame % 95 === 0) pipes.push({ x: W, top: 60 + Math.random() * (H - GAP - 120), scored: false });
  for (const p of pipes) {
    p.x -= 2.4;
    if (!p.scored && p.x + 50 < bird.x) {
      p.scored = true;
      score++;
      document.getElementById("score").textContent = `Score: ${score} · Best: ${Math.max(best, score)}`;
    }
    const hitX = bird.x + bird.r > p.x && bird.x - bird.r < p.x + 50;
    const hitY = bird.y - bird.r < p.top || bird.y + bird.r > p.top + GAP;
    if (hitX && hitY) return gameOver();
  }
  pipes = pipes.filter((p) => p.x > -60);
  if (bird.y > H - bird.r || bird.y < bird.r) gameOver();
}

function gameOver() {
  best = Math.max(best, score);
  document.getElementById("score").textContent = `💀 L. Score: ${score} · Best: ${best} · tap to retry`;
  reset();
}

function draw() {
  ctx.fillStyle = "#bde7ff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffc700";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  for (const p of pipes) {
    ctx.fillRect(p.x, 0, 50, p.top);
    ctx.strokeRect(p.x, -3, 50, p.top + 3);
    ctx.fillRect(p.x, p.top + GAP, 50, H);
    ctx.strokeRect(p.x, p.top + GAP, 50, H);
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
  ctx.closePath();
  if (face) {
    ctx.clip();
    ctx.drawImage(face, bird.x - bird.r, bird.y - bird.r, bird.r * 2, bird.r * 2);
  } else {
    ctx.font = "36px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🍗", bird.x, bird.y);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(bird.x, bird.y, bird.r, 0, Math.PI * 2);
  ctx.stroke();
  if (!running) {
    ctx.fillStyle = "#111";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tap to flap 🪽", W / 2, H / 2 + 60);
  }
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

canvas.addEventListener("pointerdown", flap);
addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    flap();
  }
});
reset();
loop();
