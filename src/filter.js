// Swaps rude words (English + Egyptian Arabic) for chilies. Not bulletproof, just a speed bump.

const REPLACEMENT = "🌶️🌶️🌶️";

// Matched anywhere inside a word (catches "fucking", "bullshit", stretched "fuuuck")
const STEMS = ["fuck", "shit", "bitch", "cunt", "nigg", "whore", "slut", "motherf"];

// Matched as whole words only (after normalization and stripping Arabic prefixes)
const WORDS = new Set([
  "ass", "asshole", "dick", "bastard", "retard", "fag", "pussy", "wtf", "stfu",
  "كس", "كسمك", "كسم", "زب", "زبر", "طيز", "متناك", "منيوك", "نيك", "ينيك", "شرموط",
  "شرموطه", "عرص", "معرص", "خول", "لبوه", "قحبه", "وسخه",
].map(normalize));

const ARABIC_PREFIXES = ["وال", "يا", "ال", "و", "ب"];

function normalize(word) {
  return word
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // tashkeel + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

const collapseRepeats = (w) => w.replace(/(.)\1+/g, "$1");

function isBad(token) {
  const n = normalize(token);
  if (WORDS.has(n)) return true;
  for (const p of ARABIC_PREFIXES) {
    if (n.startsWith(p) && WORDS.has(n.slice(p.length))) return true;
  }
  const collapsed = collapseRepeats(n);
  return STEMS.some((s) => collapsed.includes(collapseRepeats(s)));
}

function cleanText(text) {
  return String(text).replace(/[\p{L}\p{M}\p{N}_]+/gu, (token) => (isBad(token) ? REPLACEMENT : token));
}

module.exports = { cleanText };
