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
// The model bundle lives in models/tts-kokoro/ (model.onnx,
// voices.bin, tokens.txt, lexicon-us-en.txt, LICENSE). If it is
// missing, this script first looks for a bundle already on the
// machine (the Hugging Face cache and other likely locations)
// and reuses it after verifying every file, and only then
// downloads it once from Hugging Face
// (csukuangfj/kokoro-multi-lang-v1_0), about 345 MB total
// (~311 MB model), verifying every file against its pinned
// sha256, the same pattern the start script uses for the 4B
// model. A failed download retries and reports a plain
// message, never a raw timeout, and progress lines print
// while it downloads. The espeak-ng-data folder some Kokoro
// bundles ship is GPL and is never downloaded here.
// Nov 21, 2026, v62: the int8 model is gone - Jeremiah heard
// it as terrible, and the full-precision fp32 model ships
// instead. The old int8 repo (kokoro-int8-multi-lang-v1_0)
// and model.int8.onnx are retired; nothing here recognises
// them any more. A PyTorch .pth checkpoint or MLX weights
// (e.g. the mlx-community Kokoro bf16 safetensors in the
// Hugging Face cache) cannot be used by sherpa-onnx-node
// as-is; only an ONNX file counts, so the search below
// recognises a full-precision model.onnx by its fp32 hash,
// never a .pth or .safetensors file.
// English only in v1: sherpa-onnx 2.0 removed espeak-ng, and
// the bundle ships English lexicons only, so Spanish words
// would be read with English sounds and some words dropped
// entirely (verified Nov 11, 2026). A Spanish pack is refused
// with a plain message, not narrated wrong. A Spanish lexicon
// is future work, not a v54 item.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sherpa = require("sherpa-onnx-node");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODEL_DIR = path.join(ROOT, "models", "tts-kokoro");
const HF_BASE = "https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_0/resolve/main";

// Pinned files, sha256 measured Nov 21, 2026 from the
// Hugging Face repo (fp32) and the shipped bundle. A hash
// mismatch is a hard stop, not a silent use: a different
// file is a different model. The voices.bin pin is the
// v62 file: slot 24 holds the Liam+Echo blend (see VOICES),
// every other row byte-identical to the stock voices.bin.
const MODEL_FILES = [
  { name: "model.onnx", sha256: "b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11" },
  { name: "voices.bin", sha256: "d8209d71f8e446917d52b9c731d55d0f1291dcaac648ae601accee72abf7de14" },
  { name: "tokens.txt", sha256: "6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425" },
  { name: "lexicon-us-en.txt", sha256: "7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14" },
  { name: "LICENSE", sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30" },
];

// Voice names to speaker ids, read from the model's own
// speaker2id metadata (strings on model.onnx, Nov 11,
// 2026, extended Nov 21, 2026): af_heart 3, af_bella 2,
// am_adam 11, am_echo 12, am_eric 13, am_fenrir 14, am_liam 15,
// am_michael 16, am_onyx 17, am_puck 18. am_santa exists in
// the model too but is deliberately NOT offered. Nov 21,
// 2026, v62: am_liam_echo is sid 24, the 50/50 element-wise
// mean of Liam (15) and Echo (12), verified Nov 20, 2026
// against the scratch blended-voices.bin slot 20 (max abs
// diff 0.0). sherpa-onnx hardcodes the voice count at 54
// and refuses appended rows, so the blend lives in slot 24
// of the shipped voices.bin - the stock bm_daniel row, a
// British male voice the app never offers, replaced by the
// blend; every other row is byte-identical to stock. The
// default is am_liam_echo (decided Nov 20, 2026, from the
// Kokoro preview tests: test set 3 #2, the winning recipe).
// An unknown name falls back to the default.
const VOICES = { af_heart: 3, af_bella: 2, am_adam: 11, am_echo: 12, am_eric: 13, am_fenrir: 14, am_liam: 15, am_michael: 16, am_onyx: 17, am_puck: 18, am_liam_echo: 24 };
export const NARRATION_VOICES = Object.keys(VOICES);
export const DEFAULT_VOICE = "am_liam_echo";

// Nov 21, 2026, v62: the winning narration recipe (test
// set 3 #2). Speed 0.95 - the 1.0 take sounded rushed and
// the 0.85 take sounded worse, so speed is fixed here, not
// a per-voice setting. See splitIntoChunks below for the
// pause pattern.
export const NARRATION_SPEED = 0.95;
const GAP_SENTENCE_S = 0.45;
const GAP_PARAGRAPH_S = 0.85;
const GAP_CLOSING_S = 0.85;

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// Plain message for a failed voice-model download (Nov 20,
// 2026, v61): the pastor sees this, never a raw ETIMEDOUT or
// stack. The route returns the script's last stderr line, so
// this exact line is what reaches the review page (the catch
// in main prints it with no "Narration failed:" prefix, since
// the route adds its own).
const PLAIN_DOWNLOAD_ERROR = "couldn't download the narration voice files, check your internet and try again";
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_WAIT_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function download(url, dest) {
  const name = path.basename(dest);
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
      const total = Number(res.headers["content-length"]) || 0;
      let received = 0;
      let nextMark = 0;
      const chunks = [];
      res.on("data", (c) => {
        chunks.push(c);
        received += c.length;
        // Progress while downloading, so a slow first-use
        // download is visibly moving, not silent (Nov 20,
        // 2026, v61): a line at each 10% when the server
        // reports a size, else every 20 MB.
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= nextMark) {
            console.log(`Narration: downloading ${name}: ${received} / ${total} bytes (${pct}%)`);
            nextMark = Math.floor(pct / 10) * 10 + 10;
          }
        } else if (received >= nextMark) {
          console.log(`Narration: downloading ${name}: ${received} bytes received`);
          nextMark = received + 20 * 1024 * 1024;
        }
      });
      res.on("end", () => {
        writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function downloadWithRetry(url, dest) {
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      await download(url, dest);
      return;
    } catch (e) {
      // A partial file must not survive a failed attempt:
      // the next attempt re-downloads it whole, and a stale
      // partial would only fail its hash check later.
      try { if (existsSync(dest)) unlinkSync(dest); } catch {}
      if (attempt === DOWNLOAD_ATTEMPTS) throw new Error(PLAIN_DOWNLOAD_ERROR);
      console.log(`Narration: download attempt ${attempt} failed (${e.message}), retrying...`);
      await sleep(DOWNLOAD_RETRY_WAIT_MS);
    }
  }
}

function bundleIsValid(dir) {
  try {
    return MODEL_FILES.every((f) => {
      const p = path.join(dir, f.name);
      return existsSync(p) && sha256File(p) === f.sha256;
    });
  } catch {
    return false;
  }
}

function listSubdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

// Nov 20, 2026, v61, updated Nov 21, 2026, v62: before
// downloading, look for a Kokoro bundle already on the
// machine and reuse it: the app's own models/tts-kokoro is
// checked first by ensureModel, then the Hugging Face
// cache, then other likely Mac locations
// (~/Library/Caches/huggingface, /tmp, a models/tts-kokoro
// under a sibling Flockpath install or in ~/Downloads). A
// found bundle is used only after every file verifies
// against the pinned sha256; a partial or mismatched bundle
// is skipped, never half-used. v62: the search recognises
// the full-precision model (model.onnx with the fp32 pin)
// in the kokoro-multi-lang-v1_0 cache, not the retired
// int8 files. A lone model.onnx with the fp32 hash is
// recognised too (see findExistingModelFile): the model is
// the ~311 MB part, and the small files download after it.
function findExistingBundle() {
  const home = os.homedir();
  const candidates = [];
  const add = (d) => { if (d && path.resolve(d) !== path.resolve(MODEL_DIR)) candidates.push(d); };
  const hfRoots = [
    path.join(home, ".cache", "huggingface"),
    path.join(home, "Library", "Caches", "huggingface"),
  ];
  for (const cacheRoot of hfRoots) {
    const hub = path.join(cacheRoot, "hub", "models--csukuangfj--kokoro-multi-lang-v1_0");
    // Snapshot dirs hold the files by name.
    for (const s of listSubdirs(path.join(hub, "snapshots"))) add(s);
    // Blob store: files are named by their sha256, so a blob
    // whose name is a pinned hash is that file. Assemble the
    // bundle in a temp dir and verify it by hash before use,
    // exactly like any other candidate.
    const blobs = path.join(hub, "blobs");
    if (MODEL_FILES.every((f) => existsSync(path.join(blobs, f.sha256)))) {
      const tmp = path.join(os.tmpdir(), "flockpath-kokoro-found");
      try {
        mkdirSync(tmp, { recursive: true });
        for (const f of MODEL_FILES) copyFileSync(path.join(blobs, f.sha256), path.join(tmp, f.name));
        add(tmp);
      } catch {}
    }
  }
  // /tmp: a bundle unpacked or staged there, including an
  // unpacked kokoro-multi-lang-v1_0 release tarball.
  add(path.join(os.tmpdir(), "models", "tts-kokoro"));
  add(path.join(os.tmpdir(), "kokoro-multi-lang-v1_0"));
  for (const d of listSubdirs(os.tmpdir())) {
    add(path.join(d, "models", "tts-kokoro"));
    add(path.join(d, "kokoro-multi-lang-v1_0"));
  }
  // Sibling Flockpath installs next to this one.
  const parent = path.resolve(ROOT, "..");
  add(path.join(parent, "models", "tts-kokoro"));
  for (const d of listSubdirs(parent)) {
    add(path.join(d, "models", "tts-kokoro"));
    add(path.join(d, "flockpath", "models", "tts-kokoro"));
  }
  // ~/Downloads: an unpacked install or update zip staging,
  // or an unpacked kokoro-multi-lang-v1_0 release tarball.
  const downloads = path.join(home, "Downloads");
  for (const d of listSubdirs(downloads)) {
    add(path.join(d, "models", "tts-kokoro"));
    add(path.join(d, "flockpath", "models", "tts-kokoro"));
    add(path.join(d, "flockpath-mac-test", "flockpath", "models", "tts-kokoro"));
    add(path.join(d, "kokoro-multi-lang-v1_0"));
    add(d);
  }
  for (const dir of candidates) {
    if (bundleIsValid(dir)) return dir;
  }
  return null;
}

// Nov 21, 2026, v62: a lone full-precision model.onnx with
// the fp32 hash, without the rest of the bundle - the case
// of a Mac that already holds the fp32 model somewhere
// (Hugging Face cache blob, an unpacked release tarball,
// a Downloads copy). Only an ONNX file with the exact fp32
// hash counts: a .pth checkpoint or MLX .safetensors
// weights with a similar name are never used here, because
// sherpa-onnx cannot load them. Returns the file path, or
// null. The caller copies it in and lets the normal
// download loop fetch the remaining small files.
function findExistingModelFile() {
  const modelPin = MODEL_FILES.find((f) => f.name === "model.onnx")?.sha256;
  if (!modelPin) return null;
  const home = os.homedir();
  const candidates = [];
  const addFile = (p) => { if (p) candidates.push(p); };
  for (const cacheRoot of [path.join(home, ".cache", "huggingface"), path.join(home, "Library", "Caches", "huggingface")]) {
    const hub = path.join(cacheRoot, "hub", "models--csukuangfj--kokoro-multi-lang-v1_0");
    for (const s of listSubdirs(path.join(hub, "snapshots"))) addFile(path.join(s, "model.onnx"));
    // In the blob store the file's name IS its sha256.
    addFile(path.join(hub, "blobs", modelPin));
  }
  addFile(path.join(os.tmpdir(), "kokoro-multi-lang-v1_0", "model.onnx"));
  for (const d of listSubdirs(os.tmpdir())) addFile(path.join(d, "kokoro-multi-lang-v1_0", "model.onnx"));
  const downloads = path.join(home, "Downloads");
  for (const d of listSubdirs(downloads)) {
    addFile(path.join(d, "model.onnx"));
    addFile(path.join(d, "kokoro-multi-lang-v1_0", "model.onnx"));
  }
  for (const p of candidates) {
    try {
      if (existsSync(p) && sha256File(p) === modelPin) return p;
    } catch {}
  }
  return null;
}

async function ensureModel() {
  mkdirSync(MODEL_DIR, { recursive: true });
  const installed = MODEL_FILES.filter((f) => {
    const dest = path.join(MODEL_DIR, f.name);
    return existsSync(dest) && sha256File(dest) === f.sha256;
  });
  if (installed.length === MODEL_FILES.length) return;
  const found = findExistingBundle();
  if (found) {
    console.log(`Narration: found an existing Kokoro bundle at ${found}, reusing it...`);
    for (const f of MODEL_FILES) copyFileSync(path.join(found, f.name), path.join(MODEL_DIR, f.name));
    for (const f of MODEL_FILES) {
      if (sha256File(path.join(MODEL_DIR, f.name)) !== f.sha256) {
        throw new Error(`Narration model file ${f.name} failed its hash check. Delete ${path.join(MODEL_DIR, f.name)} and try again.`);
      }
    }
    return;
  }
  // Nov 21, 2026, v62: a lone fp32 model.onnx already on
  // disk is worth ~311 MB of download. Copy it in now; the
  // download loop below fetches only the small files that
  // are still missing, skipping this one on its hash check.
  const foundModel = findExistingModelFile();
  if (foundModel) {
    console.log(`Narration: found the full-precision voice model at ${foundModel}, reusing it...`);
    copyFileSync(foundModel, path.join(MODEL_DIR, "model.onnx"));
  }
  console.log("Narration: downloading the Kokoro voice model (one time only, about 345 MB total, ~311 MB model)...");
  for (const f of MODEL_FILES) {
    const dest = path.join(MODEL_DIR, f.name);
    if (existsSync(dest) && sha256File(dest) === f.sha256) continue;
    console.log(`Narration: downloading ${f.name}...`);
    await downloadWithRetry(`${HF_BASE}/${f.name}`, dest);
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

// Nov 21, 2026, v62: sentence chunking, the winning
// recipe (test set 3 #2). The app used to hand Kokoro a
// whole 1-3 minute section in one generate() call, and
// Kokoro goes rushed past ~400 tokens and sounds best at
// 100-200 - that is the rushed/robotic thing Jeremiah
// heard. Now each section renders one sentence per
// generate() call at speed 0.95, and the pieces are joined
// with digital silence: 0.45s between sentences, 0.85s
// between paragraphs and before the closing beats. (The
// preview scripts used 0.35s mid-paragraph gaps in test
// set 2 #3; the v62 build uses 0.45s between sentences,
// the set 1 gap, with 0.85s closing beats from set 2 #3.)
// Very short sentences (under 5 words) merge into a
// neighbour, because Kokoro is weak on very short text - a
// 4-word clip rendered alone rises instead of landing a
// declarative cadence ("Rest in that today." rides on the
// previous chunk). EXCEPT the closing lines: the last
// sentence of a section, when it is a parallel-clause
// closer ("You are loved, you are forgiven, and you are
// His."), splits at its last ", and " into two chunks that
// stay split with 0.85s beats, exactly the test set 2 #3
// pattern. Chunks never split at commas anywhere else.
// Paragraphs are split before cleanText runs, because
// cleanText collapses blank lines: the caller passes the
// section as an array of paragraph strings.
function splitSentences(text) {
  const matches = String(text).match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g);
  return (matches ?? []).map((s) => s.trim()).filter(Boolean);
}

function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function splitClosingSentence(sentence) {
  // "You are loved, you are forgiven, and you are His." ->
  // ["You are loved, you are forgiven.", "And you are His."]
  // Only when the tail after the last ", and " is a short
  // parallel clause (2-6 words) and the head has at least
  // 3 words; anything else stays one chunk.
  const idx = sentence.lastIndexOf(", and ");
  if (idx < 0) return null;
  const head = sentence.slice(0, idx).trim();
  const tail = sentence.slice(idx + 6).trim();
  if (wordCount(head) < 3 || wordCount(tail) < 2 || wordCount(tail) > 6) return null;
  const headText = /[.!?]$/.test(head) ? head : head + ".";
  const tailText = /^And\b/i.test(tail) ? tail : "And " + tail;
  return [headText, tailText];
}

function splitIntoChunks(paragraphs) {
  // Returns [{ text, gapBefore }] in reading order.
  // gapBefore is the silence in seconds before this chunk:
  // 0.45s between sentences, 0.85s between paragraphs and
  // before the closing beats.
  const chunks = [];
  const cleanParas = paragraphs.map((p) => cleanText(p)).filter(Boolean);
  cleanParas.forEach((para, pi) => {
    const sentences = splitSentences(para);
    if (!sentences.length) return;
    // Closing split: the last sentence of the whole
    // section, if it is a parallel-clause closer.
    const isLastPara = pi === cleanParas.length - 1;
    let closing = null;
    if (isLastPara) {
      const split = splitClosingSentence(sentences[sentences.length - 1]);
      if (split) {
        closing = split;
        sentences.pop();
      }
    }
    // Very short sentences (under 5 words) merge into a
    // neighbour in the SAME paragraph, never across one:
    // into the previous chunk, or into the next sentence
    // when there is no previous chunk yet. A paragraph of
    // a single short sentence (a title) stays its own
    // chunk, with a paragraph beat after it.
    const merged = [];
    for (let si = 0; si < sentences.length; si++) {
      const sentence = sentences[si];
      if (wordCount(sentence) < 5 && merged.length > 0) {
        merged[merged.length - 1] += " " + sentence;
      } else if (wordCount(sentence) < 5 && si + 1 < sentences.length) {
        sentences[si + 1] = sentence + " " + sentences[si + 1];
      } else {
        merged.push(sentence);
      }
    }
    merged.forEach((text, mi) => {
      chunks.push({ text, gapBefore: 0, _newPara: mi === 0 && pi > 0, _closing: false });
    });
    if (closing) {
      // The closing pair stays split, each with an 0.85s
      // beat before it, even though the tail is short.
      chunks.push({ text: closing[0], gapBefore: 0, _newPara: false, _closing: true });
      chunks.push({ text: closing[1], gapBefore: 0, _newPara: false, _closing: true });
    }
  });
  chunks.forEach((c, i) => {
    // Paragraph beats and closing beats are both 0.85s;
    // the two constants name the reason, not a difference.
    c.gapBefore = i === 0 ? 0 : (c._closing || c._newPara ? GAP_PARAGRAPH_S : GAP_SENTENCE_S);
    delete c._newPara;
    delete c._closing;
  });
  return chunks;
}

function renderChunked(tts, sid, paragraphs) {
  // One generate() per sentence, spliced with digital
  // silence. Returns { samples, sampleRate }.
  const chunks = splitIntoChunks(paragraphs);
  const pieces = [];
  let total = 0;
  let sampleRate = 24000;
  chunks.forEach((chunk, i) => {
    const audio = tts.generate({ text: normalizeForSpeech(chunk.text), sid, speed: NARRATION_SPEED });
    sampleRate = audio.sampleRate;
    if (i > 0 && chunk.gapBefore > 0) {
      const gap = new Float32Array(Math.round(sampleRate * chunk.gapBefore));
      pieces.push(gap);
      total += gap.length;
    }
    pieces.push(audio.samples);
    total += audio.samples.length;
  });
  const joined = new Float32Array(total);
  let offset = 0;
  for (const p of pieces) {
    joined.set(p, offset);
    offset += p.length;
  }
  return { samples: joined, sampleRate };
}

// Nov 21, 2026, v62: the manifest and the progress file
// are written INCREMENTALLY, after each file lands - not
// only at the end - so a partial run leaves real progress
// behind (item 16 contract): a poller, a reload, or a
// re-run sees finished files instead of nothing. The
// manifest lists the files done so far; progress.json
// carries { status, done, total, current, startedAt,
// error } with current "<day> <kind>" (e.g. "monday adult").
function writeManifest(outDir, voice, sampleRate, files) {
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ voice, speed: NARRATION_SPEED, sampleRate, files }, null, 1));
}

function writeProgress(outDir, progress) {
  try {
    writeFileSync(path.join(outDir, "progress.json"), JSON.stringify(progress, null, 1));
  } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("--list-voices")) {
    console.log(`Voices: ${Object.entries(VOICES).map(([n, id]) => `${n} (${id})`).join(", ")}`);
    console.log(`Default voice: ${DEFAULT_VOICE}`);
    return 0;
  }
  if (args.length < 2) {
    console.error("usage: node scripts/narrate-pack.mjs <pack.json> <out-dir> [--voice am_liam_echo] [--lang en] [--section <day>-<kind>]");
    return 2;
  }
  const packPath = args[0];
  const outDir = args[1];
  let voiceName = DEFAULT_VOICE;
  let lang = "en";
  let sectionArg = null;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--voice" && args[i + 1]) voiceName = args[++i];
    else if (args[i] === "--lang" && args[i + 1]) lang = args[++i];
    else if (args[i] === "--section" && args[i + 1]) sectionArg = args[++i];
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
  // Nov 21, 2026, v62: the sections to narrate, in file
  // order (adult then kid per day). --section <day>-<kind>
  // (e.g. monday-adult, friday-kid) renders ONE section
  // only, so a pastor narrates a single day's reading
  // instead of the whole week; without it, the whole week
  // renders as before. Paragraphs stay split here, because
  // splitIntoChunks needs the paragraph breaks (cleanText
  // collapses them) for its 0.85s paragraph beats.
  const sections = [];
  for (let i = 0; i < adults.length; i++) {
    const a = adults[i];
    const day = String(a.day ?? `day-${i + 1}`).toLowerCase();
    const adultParas = [a.title, ...String(a.body ?? "").split(/\n\s*\n/), a.prayer].filter((p) => String(p ?? "").trim());
    sections.push({ day: a.day ?? day, dayLower: day, kind: "adult", file: `${day}-adult.wav`, paragraphs: adultParas });
    const k = kids[i];
    if (k) {
      const kidParas = [k.title, ...String(k.retelling ?? "").split(/\n\s*\n/)].filter((p) => String(p ?? "").trim());
      sections.push({ day: k.day ?? a.day ?? day, dayLower: day, kind: "kid", file: `${day}-kid.wav`, paragraphs: kidParas });
    }
  }
  let todo = sections;
  if (sectionArg) {
    const dash = String(sectionArg).lastIndexOf("-");
    const wantDay = String(sectionArg).slice(0, dash).toLowerCase();
    const wantKind = String(sectionArg).slice(dash + 1).toLowerCase();
    todo = sections.filter((s) => s.dayLower === wantDay && s.kind === wantKind);
    if (!todo.length) {
      console.error(`Unknown section "${sectionArg}". Available: ${sections.map((s) => `${s.dayLower}-${s.kind}`).join(", ")}`);
      return 2;
    }
  }
  const startedAt = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });
  const files = [];
  const progress = (status, done, current, error) => ({ status, done, total: todo.length, current, startedAt, error: error ?? null });
  // An initial progress file, so a poller sees the run
  // while the model downloads or the first file renders.
  writeProgress(outDir, progress("running", 0, `${todo[0].dayLower} ${todo[0].kind}`));

  try {
    await ensureModel();
    const tts = new sherpa.OfflineTts({
      model: {
        kokoro: {
          model: path.join(MODEL_DIR, "model.onnx"),
          voices: path.join(MODEL_DIR, "voices.bin"),
          tokens: path.join(MODEL_DIR, "tokens.txt"),
          lexicon: mergedLexiconPath(),
        },
        numThreads: 2,
        debug: 0,
      },
    });
    for (const section of todo) {
      const raw = section.paragraphs.map((p) => cleanText(p)).filter(Boolean).join(" ");
      const audio = renderChunked(tts, sid, section.paragraphs);
      sherpa.writeWave(path.join(outDir, section.file), { samples: audio.samples, sampleRate: audio.sampleRate });
      const entry = { day: section.day, kind: section.kind, file: section.file, words: wordCount(raw), seconds: +(audio.samples.length / audio.sampleRate).toFixed(1) };
      files.push(entry);
      console.log(`Narrated ${section.file}: ${entry.seconds}s`);
      // Incremental: the manifest and progress land after
      // EACH file, not only at the end (item 16 contract).
      writeManifest(outDir, voiceName, audio.sampleRate, files);
      writeProgress(outDir, progress("running", files.length, `${section.dayLower} ${section.kind}`));
    }
    writeProgress(outDir, progress("done", files.length, `${todo[todo.length - 1].dayLower} ${todo[todo.length - 1].kind}`));
    console.log(`Done. ${files.length} files in ${outDir}`);
    return 0;
  } catch (e) {
    // A failed run still leaves its progress behind, with
    // the plain reason, so the UI can say which step
    // failed instead of showing a stuck spinner.
    const failedAt = todo[Math.min(files.length, todo.length - 1)];
    writeProgress(outDir, progress("error", files.length, failedAt ? `${failedAt.dayLower} ${failedAt.kind}` : "", e?.message ?? String(e)));
    if (e && e.message === PLAIN_DOWNLOAD_ERROR) {
      // Plain line only, no "Narration failed:" prefix: the
      // route adds its own, so the review page shows the plain
      // message once, never a raw timeout or stack.
      console.error(PLAIN_DOWNLOAD_ERROR);
    } else {
      console.error(`Narration failed: ${e.message}`);
    }
    return 1;
  }
}

const code = await main();
process.exit(code ?? 0);
