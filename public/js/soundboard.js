// Footer soundboard: real meme clips only, with category tabs, search, random, stop-all,
// a now-playing equalizer and 1–9 keyboard shortcuts. Loaded lazily by menu.js.
import { $, $$, esc, toast, play, pick, store, soundOn, stopAllClips, clipPlaying, CLIPS, SOUND_CATEGORIES } from "./common.js";

const TAB_KEY = "zk_sb_tab";
const splitLabel = (label) => {
  const i = label.indexOf(" ");
  return i > 0 ? [label.slice(0, i), label.slice(i + 1)] : ["🔊", label];
};

export function mountSoundboard() {
  const board = $("#soundboard");
  if (!board || board.dataset.ready) return;
  board.dataset.ready = "1";

  const tabs = $("#sb-tabs");
  const search = $("#sb-search");
  const now = $("#sb-now");
  const all = Object.entries(CLIPS);
  const valid = new Set(["all", ...SOUND_CATEGORIES.map(([id]) => id)]);
  let cat = valid.has(store.get(TAB_KEY, "all")) ? store.get(TAB_KEY, "all") : "all";
  let query = "";
  let inView = false;

  // ---- tabs ----
  if (tabs) {
    const count = (id) => all.filter(([, v]) => v[2] === id).length;
    tabs.innerHTML = [["all", `🔊 All`, all.length], ...SOUND_CATEGORIES.map(([id, label]) => [id, label, count(id)])]
      .filter(([, , n]) => n > 0)
      .map(([id, label, n]) => `<button class="sb-tab" type="button" role="tab" data-cat="${id}" aria-selected="${id === cat}">${esc(label)} <span class="sb-count">${n}</span></button>`)
      .join("");
    tabs.addEventListener("click", (e) => {
      const t = e.target.closest("[data-cat]");
      if (!t) return;
      cat = t.dataset.cat;
      store.set(TAB_KEY, cat);
      $$("[data-cat]", tabs).forEach((b) => b.setAttribute("aria-selected", String(b === t)));
      render();
    });
  }

  // ---- grid ----
  const visible = () => $$("[data-sound]", board);
  function render() {
    const q = query.trim().toLowerCase();
    const list = all.filter(([k, v]) => (cat === "all" || v[2] === cat) && (!q || `${k} ${v[1]} ${v[2]}`.toLowerCase().includes(q)));
    board.innerHTML = list.length
      ? list
          .map(([k, v], i) => {
            const [emoji, text] = splitLabel(v[1]);
            return `<button class="sb-btn sb-${v[2]}" type="button" data-sound="${k}" title="${esc(v[1])}${i < 9 ? ` (key ${i + 1})` : ""}">
              ${i < 9 ? `<kbd class="sb-key" aria-hidden="true">${i + 1}</kbd>` : ""}
              <span class="sb-emoji" aria-hidden="true">${emoji}</span>
              <span class="sb-label">${esc(text)}</span>
              <span class="sb-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            </button>`;
          })
          .join("")
      : `<p class="sb-empty">No sound called “${esc(query)}”. Skill issue 💀</p>`;
    visible().forEach((b) => b.classList.toggle("playing", clipPlaying(b.dataset.sound)));
  }

  function fire(btn) {
    if (!btn) return;
    if (!soundOn()) return toast("🔇 Sounds are OFF. Turn them on with the 🔊 button (bottom left)");
    play(btn.dataset.sound, { exact: true });
    btn.classList.remove("bump");
    void btn.offsetWidth;
    btn.classList.add("bump");
  }

  board.addEventListener("click", (e) => fire(e.target.closest("[data-sound]")));
  search?.addEventListener("input", () => {
    query = search.value;
    render();
  });
  $("#sb-random")?.addEventListener("click", () => {
    const list = visible();
    if (!list.length) return toast("Nothing to randomize. Clear the search 🙃");
    fire(pick(list));
  });
  $("#sb-stop")?.addEventListener("click", () => {
    stopAllClips();
    toast("🤫 Silence. The office thanks you.", { ms: 1800 });
  });

  // ---- now playing ----
  const playingNames = new Map(); // name -> count of live copies
  function updateNow() {
    visible().forEach((b) => b.classList.toggle("playing", playingNames.has(b.dataset.sound)));
    if (!now) return;
    const names = [...playingNames.keys()].filter((n) => CLIPS[n]);
    now.classList.toggle("on", names.length > 0);
    now.innerHTML = names.length
      ? `<span class="sb-eq on" aria-hidden="true"><i></i><i></i><i></i><i></i></span> Now playing: <b>${names.map((n) => esc(CLIPS[n][1])).join(" + ")}</b>`
      : "🎧 Nothing playing. Peace. For now.";
  }
  document.addEventListener("clip:start", (e) => {
    const n = e.detail.name;
    playingNames.set(n, (playingNames.get(n) || 0) + 1);
    updateNow();
  });
  document.addEventListener("clip:end", (e) => {
    const n = e.detail.name;
    const left = (playingNames.get(n) || 1) - 1;
    if (left > 0) playingNames.set(n, left);
    else playingNames.delete(n);
    updateNow();
  });

  // ---- keyboard: 1–9 play the first nine visible, Esc stops (only while the board is on screen) ----
  const wrap = board.closest(".soundboard-wrap") || board;
  if ("IntersectionObserver" in window) new IntersectionObserver(([en]) => (inView = en.isIntersecting)).observe(wrap);
  else inView = true;
  document.addEventListener("keydown", (e) => {
    if (!inView || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    if (/^[1-9]$/.test(e.key)) fire(visible()[Number(e.key) - 1]);
    else if (e.key === "Escape" && playingNames.size) stopAllClips();
  });

  render();
  updateNow();
}
