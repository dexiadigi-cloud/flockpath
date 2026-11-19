// Nov 11, 2026, v54, Phase 4 audio narration: local text to
// speech for a pack, Kokoro-82M via sherpa-onnx-node.
// Free for commercial use: sherpa-onnx-node is Apache-2.0,
// the Kokoro model and lexicons are Apache-2.0, the bundled
// ONNX Runtime is MIT. No API key, no network at narration
// time once the model files are on disk, no voice cloning:
// one fixed voice per pack, picked by the pastor.
//
// Usage:
//   node scripts/narrate-pack.mjs <pack.json> <out-dir> [--voice af_heart] [--lang en]
//
// The pack is an expanded draft or a locked pack: adult
// devotionals (title, body, prayer) and kid retellings
// (title, retelling) are narrated per day, one WAV each:
// monday-adult.wav, monday-kid.wav, and so on. Verse text is
// never narrated: bodies and prayers are the model's own
// prose, and the verse itself is already in the pack for
// reading. A manifest.json lists the files with their day,
// kind, words, and seconds.
//
// The model bundle lives in models/tts-kokoro/ (model.int8.onnx,
// voices.bin, tokens.txt, lexicon-us-en.txt, LICENSE). If it is
// missing, this script downloads it once from Hugging Face
// (csukuangfj/kokoro-int8-multi-lang-v1_0) and verifies every
// file against its pinned sha256, the same pattern the start
// script uses for the 4B model. The espeak-ng-data folder some
// Kokoro bundles ship is GPL and is never downloaded here.
// English only in v1: sherpa-onnx 2.0 removed espeak-ng, and
// the bundle ships English lexicons only, so Spanish words
// would be read with English sounds and some words dropped
// entirely (verified Nov 11, 2026). A Spanish pack is refused
// with a plain message, not narrated wrong. A Spanish lexicon
// is future work, not a v54 item.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = path.join(ROOT, "models", "tts-kokoro");
const HF_BASE = "https://huggingface.co/csukuangfj/kokoro-int8-multi-lang-v1_0/resolve/main";

// Pinned files, sha256 measured Nov 11, 2026 from the
// Hugging Face repo. A hash mismatch is a hard stop, not a
// silent use: a different file is a different model.
const MODEL_FILES = [
  { name: "model.int8.onnx", sha256: "75635ea3b85a32d00094dcdd61a258aba87c160f7c264c304a7b3ae9d734195e" },
  { name: "voices.bin", sha256: "1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29" },
  { name: "tokens.txt", sha256: "6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425" },
  { name: "lexicon-us-en.txt", sha256: "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14" },
  { name: "LICENSE", sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" },
];

// Voice names to speaker ids, read from the model's own
// speaker2id metadata (strings on model.int8.onnx, Nov 11,
// 2026): af_heart 3, af_bella 2, am_adam 11, am_michael 16.
// The setting offers these four English voices; the default
// is af_heart. An unknown name falls back to the default.
const VOICES = { af_heart: 3, af_bella: 2, am_adam: 11, am_michael: 16 };
export const NARRATION_VOICES = Object.keys(VOICES);
export const DEFAULT_VOICE = "af_heart";

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Flockpath/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: ${url} -> HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function ensureModel() {
  mkdirSync(MODEL_DIR, { recursive: true });
  for (const f of MODEL_FILES) {
    const dest = path.join(MODEL_DIR, f.name);
    if (existsSync(dest) && sha256File(dest) === f.sha256) continue;
    console.log(`Narration: downloading ${f.name} (one time only)...`);
    await download(`${HF_BASE}/${f.name}`, dest);
    if (sha256File(dest) !== f.sha256) {
      throw new Error(`Narration model file ${f.name} failed its hash check. Delete ${dest} and try again.`);
    }
  }
}

function cleanText(text) {
  // Plain prose only: collapse blank lines, drop any
  // parenthetical read directive the review page appends
  // to leader notes (not narrated here, but a draft may
  // carry one in a body the pastor pasted).
  return String(text ?? "").replace(/\s*\((?:Read|Lee) [^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

// Nov 11, 2026, v54: the Kokoro lexicon lists base forms
// only (178,401 entries). A word it does not hold is
// silently skipped by the engine, so "God's love" came out
// as "love", "baptized" and "mistakes" vanished, and a quote
// mark glued to a word ("I) dropped the word with it. This
// normalization runs only on the spoken text, never on the
// pack: it separates punctuation from words so each word is
// looked up alone, and it bends an out-of-lexicon word back
// to a form the lexicon holds (possessive to plural, past
// tense to base, plural to singular). A word that still has
// no form is left as-is and the engine skips it, as before;
// nothing here can make a word worse, only heard.
let lexiconWords = null;
function loadLexicon() {
  if (lexiconWords) return lexiconWords;
  lexiconWords = new Set();
  for (const line of readFileSync(path.join(MODEL_DIR, "lexicon-us-en.txt"), "utf-8").split("\n")) {
    const w = line.split(" ")[0]?.toLowerCase();
    if (w) lexiconWords.add(w);
  }
  for (const line of SUPPLEMENT_LEXICON) lexiconWords.add(line.split(" ")[0]);
  return lexiconWords;
}

function spokenForm(core) {
  const lower = core.toLowerCase();
  const set = loadLexicon();
  if (set.has(lower)) return core;
  const tries = [];
  if (lower.endsWith("'s")) tries.push(lower.slice(0, -2) + "s", lower.slice(0, -2) + "es", lower.slice(0, -2));
  if (lower.endsWith("'")) tries.push(lower.slice(0, -1));
  if (lower.endsWith("ies")) tries.push(lower.slice(0, -3) + "y");
  if (lower.endsWith("es")) tries.push(lower.slice(0, -2));
  if (lower.endsWith("s")) tries.push(lower.slice(0, -1));
  if (lower.endsWith("ed")) tries.push(lower.slice(0, -2), lower.slice(0, -2) + "e", lower.slice(0, -1));
  if (lower.endsWith("ing")) tries.push(lower.slice(0, -3), lower.slice(0, -3) + "e");
  for (const t of tries) {
    if (set.has(t)) {
      return core[0] === core[0].toUpperCase() ? t[0].toUpperCase() + t.slice(1) : t;
    }
  }
  return core;
}

function numberToWords() {
  // 0-9999 as words the lexicon holds (all checked by grep).
  // Verse references are the live case: "Leviticus 4:13-21"
  // arrives here as separate digit tokens after the
  // punctuation split, and reads "four thirteen twenty-one".
  const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const ORD = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth" };
  const ordinal = (n) => {
    if (ORD[n]) return ORD[n];
    if (n < 20) return ONES[n] + "th";
    if (n % 10 === 0) return TENS[n / 10] + "ieth";
    return TENS[Math.floor(n / 10)] + " " + ordinal(n % 10);
  };
  const under1000 = (n) => {
    if (n < 20) return ONES[n];
    if (n < 100) return n % 10 === 0 ? TENS[n / 10] : TENS[Math.floor(n / 10)] + "-" + ONES[n % 10];
    const rest = n % 100;
    return ONES[Math.floor(n / 100)] + " hundred" + (rest ? " " + under1000(rest) : "");
  };
  const cardinal = (n) => {
    if (n < 1000) return under1000(n);
    const rest = n % 1000;
    return ONES[Math.floor(n / 1000)] + " thousand" + (rest ? " " + under1000(rest) : "");
  };
  return { cardinal, ordinal };
}

function normalizeForSpeech(text) {
  // Em and en dashes glue two words into one token the
  // engine drops whole ("table—we"); split them first.
  // Bare numbers are not in the lexicon either, so a verse
  // reference in the prose ("Leviticus 4:13-21") would lose
  // its numbers; expand digit runs to words first.
  const { cardinal, ordinal } = numberToWords();
  const numbered = text.replace(/[—–]/g, " ").replace(/\b(\d{1,4})(st|nd|rd|th)\b/g, (_, d, s) => ordinal(+d)).replace(/\b\d{1,4}\b/g, (d) => cardinal(+d));
  return numbered.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    // A leading apostrophe is a quote mark, not part of the
    // word ("'I" is the word I in quotes); an apostrophe
    // between letters is part of the word (don't, God's).
    const m = tok.match(/^([^A-Za-z]*)([A-Za-z]+(?:'[A-Za-z]+)*)([^A-Za-z]*)$/);
    if (!m) return tok;
    const [, lead, core, trail] = m;
    const spoken = spokenForm(core);
    return (lead ? lead + " " : "") + spoken + (trail ? " " + trail : "");
  }).join("");
}

// Nov 11, 2026, v54: four common Bible names the shipped
// lexicon does not hold (verified by grep): Paul, Luke,
// Matthew, Barnabas. Their sounds are taken from entries
// the lexicon does hold (pall p ˈ ɔ l, duke d ˈ u k,
// lukewarm l ˈ u k, math m ˈ æ θ, barnaby b ˈ ɑ ɹ n ə b i),
// so these are the lexicon's own sounds, not guesses. The
// script merges them with the shipped lexicon into a
// temporary file at run time; the pinned lexicon file itself
// is never modified. Add a name here only with the same
// analogy check.
const SUPPLEMENT_LEXICON = [
  "paul p ˈ ɔ l",
  "luke l ˈ u k",
  "matthew m ˈ æ θ j u",
  "barnabas b ˈ ɑ ɹ n ə b ə s",
];

let mergedLexicon = null;
function mergedLexiconPath() {
  if (mergedLexicon) return mergedLexicon;
  const os = require("node:os");
  const crypto = require("node:crypto");
  const key = crypto.createHash("sha256").update(SUPPLEMENT_LEXICON.join("\n")).digest("hex").slice(0, 12);
  const dest = path.join(os.tmpdir(), `flockpath-kokoro-lexicon-${key}.txt`);
  if (!existsSync(dest)) {
    const base = readFileSync(path.join(MODEL_DIR, "lexicon-us-en.txt"), "utf-8");
    writeFileSync(dest, base + "\n" + SUPPLEMENT_LEXICON.join("\n") + "\n");
  }
  mergedLexicon = dest;
  return dest;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("usage: node scripts/narrate-pack.mjs <pack.json> <out-dir> [--voice af_heart] [--lang en]");
    return 2;
  }
  const packPath = args[0];
  const outDir = args[1];
  let voiceName = DEFAULT_VOICE;
  let lang = "en";
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--voice" && args[i + 1]) voiceName = args[++i];
    else if (args[i] === "--lang" && args[i + 1]) lang = args[++i];
  }
  const pack = JSON.parse(readFileSync(packPath, "utf-8"));
  const packLang = String(pack.language ?? lang ?? "en").toLowerCase();
  if (packLang === "es") {
    console.error("Spanish narration is not available yet: the voice model has no Spanish pronunciation guide, so Spanish words would come out wrong. English packs narrate today.");
    return 3;
  }
  const sid = VOICES[voiceName] ?? VOICES[DEFAULT_VOICE];
  const adults = pack.adultDevotionals ?? [];
  const kids = pack.kidDevotionals ?? [];
  if (!adults.length) {
    console.error("No adult devotionals in this pack, nothing to narrate.");
    return 2;
  }

  return ensureModel().then(() => {
    const tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: path.join(MODEL_DIR, "model.int8.onnx"),
          voices: path.join(MODEL_DIR, "voices.bin"),
          tokens: path.join(MODEL_DIR, "tokens.txt"),
          lexicon: mergedLexiconPath(),
        },
        numThreads: 2,
        debug: 0,
      },
    });
    mkdirSync(outDir, { recursive: true });
    const files = [];
    for (let i = 0; i < adults.length; i++) {
      const a = adults[i];
      const day = String(a.day ?? `day-${i + 1}`).toLowerCase();
      const adultRaw = cleanText([a.title, a.body, a.prayer].filter(Boolean).join("\n\n"));
      const adultText = normalizeForSpeech(adultRaw);
      const adultFile = `${day}-adult.wav`;
      const adultAudio = tts.generate({ text: adultText, sid, speed: 1.0 });
      sherpa.writeWave(path.join(outDir, adultFile), { samples: adultAudio.samples, sampleRate: adultAudio.sampleRate });
      files.push({ day: a.day, kind: "adult", file: adultFile, words: adultRaw.split(/\s+/).filter(Boolean).length, seconds: +(adultAudio.samples.length / adultAudio.sampleRate).toFixed(1) });
      console.log(`Narrated ${adultFile}: ${files[files.length - 1].seconds}s`);
      const k = kids[i];
      if (k) {
        const kidRaw = cleanText([k.title, k.retelling].filter(Boolean).join("\n\n"));
        const kidText = normalizeForSpeech(kidRaw);
        const kidFile = `${day}-kid.wav`;
        const kidAudio = tts.generate({ text: kidText, sid, speed: 1.0 });
        sherpa.writeWave(path.join(outDir, kidFile), { samples: kidAudio.samples, sampleRate: kidAudio.sampleRate });
        files.push({ day: k.day, kind: "kid", file: kidFile, words: kidRaw.split(/\s+/).filter(Boolean).length, seconds: +(kidAudio.samples.length / kidAudio.sampleRate).toFixed(1) });
        console.log(`Narrated ${kidFile}: ${files[files.length - 1].seconds}s`);
      }
    }
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ voice: voiceName, sampleRate: tts.sampleRate, files }, null, 1));
    console.log(`Done. ${files.length} files in ${outDir}`);
    return 0;
  }).catch((e) => {
    console.error(`Narration failed: ${e.message}`);
    return 1;
  });
}

const code = await main();
process.exit(code ?? 0);
