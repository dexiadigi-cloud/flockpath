// Nov 2, 2026, pastor-test fix: pastors see full book names,
// never internal codes. The verse store, Phos, extract, and
// verification all keep codes (GEN, JHN, 1CO), because those
// are the keys. This module is display only: it converts a
// code reference for presentation, in the PDF, the review
// page, and the pack page. Unknown codes pass through
// unchanged, never guessed.
// Book names are the BSB names from scripts/build_bsb_store.py.
export const BOOK_NAMES = {
  GEN: "Genesis", EXO: "Exodus", LEV: "Leviticus", NUM: "Numbers",
  DEU: "Deuteronomy", JOS: "Joshua", JDG: "Judges", RUT: "Ruth",
  "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
  "1CH": "1 Chronicles", "2CH": "2 Chronicles", EZR: "Ezra", NEH: "Nehemiah",
  EST: "Esther", JOB: "Job", PSA: "Psalm", PRO: "Proverbs",
  ECC: "Ecclesiastes", SON: "Song of Solomon", ISA: "Isaiah",
  JER: "Jeremiah", LAM: "Lamentations", EZE: "Ezekiel", DAN: "Daniel",
  HOS: "Hosea", JOE: "Joel", AMO: "Amos", OBA: "Obadiah",
  JON: "Jonah", MIC: "Micah", NAH: "Nahum", HAB: "Habakkuk",
  ZEP: "Zephaniah", HAG: "Haggai", ZEC: "Zechariah", MAL: "Malachi",
  MAT: "Matthew", MRK: "Mark", LUK: "Luke", JHN: "John",
  ACT: "Acts", ROM: "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians",
  GAL: "Galatians", EPH: "Ephesians", PHP: "Philippians",
  COL: "Colossians", "1TH": "1 Thessalonians", "2TH": "2 Thessalonians",
  "1TI": "1 Timothy", "2TI": "2 Timothy", TIT: "Titus", PHM: "Philemon",
  HEB: "Hebrews", JAS: "James", "1PE": "1 Peter", "2PE": "2 Peter",
  "1JN": "1 John", "2JN": "2 John", "3JN": "3 John", JUD: "Jude",
  REV: "Revelation",
};

// Nov 11, 2026, v53, Phase 3 Spanish v1: Spanish book names,
// from Bible.com's RV1909 contents list, in standard accented
// Spanish spelling (Génesis, Éxodo, Levítico). The source list
// itself is unaccented; display uses accents, and parsing folds
// them, so "Genesis", "Génesis", "Exodo", and "Éxodo" all match.
// "San Mateo/Marcos/Lucas/Juan" (not "Mateo" alone), "Cantares"
// for Song of Solomon, "Santiago" for James, "Hechos" for Acts.
export const BOOK_NAMES_ES = {
  GEN: "Génesis", EXO: "Éxodo", LEV: "Levítico", NUM: "Números",
  DEU: "Deuteronomio", JOS: "Josué", JDG: "Jueces", RUT: "Rut",
  "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Reyes", "2KI": "2 Reyes",
  "1CH": "1 Crónicas", "2CH": "2 Crónicas", EZR: "Esdras", NEH: "Nehemías",
  EST: "Ester", JOB: "Job", PSA: "Salmos", PRO: "Proverbios",
  ECC: "Eclesiastés", SON: "Cantares", ISA: "Isaías",
  JER: "Jeremías", LAM: "Lamentaciones", EZE: "Ezequiel", DAN: "Daniel",
  HOS: "Oseas", JOE: "Joel", AMO: "Amós", OBA: "Abdías",
  JON: "Jonás", MIC: "Miqueas", NAH: "Nahúm", HAB: "Habacuc",
  ZEP: "Sofonías", HAG: "Hageo", ZEC: "Zacarías", MAL: "Malaquías",
  MAT: "San Mateo", MRK: "San Marcos", LUK: "San Lucas", JHN: "San Juan",
  ACT: "Hechos", ROM: "Romanos", "1CO": "1 Corintios", "2CO": "2 Corintios",
  GAL: "Gálatas", EPH: "Efesios", PHP: "Filipenses",
  COL: "Colosenses", "1TH": "1 Tesalonicenses", "2TH": "2 Tesalonicenses",
  "1TI": "1 Timoteo", "2TI": "2 Timoteo", TIT: "Tito", PHM: "Filemón",
  HEB: "Hebreos", JAS: "Santiago", "1PE": "1 Pedro", "2PE": "2 Pedro",
  "1JN": "1 Juan", "2JN": "2 Juan", "3JN": "3 Juan", JUD: "Judas",
  REV: "Apocalipsis",
};

// Spanish day names, for the PDF and Spanish review strings.
// The pack schema keeps the English day enum (Monday-Sunday);
// display maps through here, never by guessing.
export const DAY_NAMES_ES = {
  Monday: "lunes", Tuesday: "martes", Wednesday: "miércoles",
  Thursday: "jueves", Friday: "viernes", Saturday: "sábado",
  Sunday: "domingo",
};

// Fold accents for matching: á é í ó ú ü ñ -> a e i o u u n.
// NFD splits a base letter from its combining mark; stripping
// the marks leaves the base letter. Used by parseRef and by
// the Spanish extract aliases, so accented and unaccented
// input match the same book.
export function foldAccents(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function formatRef(ref, language = "en") {
  const m = String(ref ?? "").trim().match(/^([A-Z0-9]+)\s+(.+)$/);
  if (!m) return String(ref ?? "");
  const names = language === "es" ? BOOK_NAMES_ES : BOOK_NAMES;
  const name = names[m[1].toUpperCase()];
  return name ? `${name} ${m[2]}` : String(ref);
}

// Nov 5, 2026, round-3: same mapping, inside prose.
// Replaces code references (JAS 1:4, 1JN 4:19) with full
// book names wherever they appear in display text: leader
// notes, questions, kid titles. Plain prose passes through
// unchanged, unknown codes pass through unchanged, and
// full names are already full, so this is idempotent.
export function formatRefsInText(s, language = "en") {
  const names = language === "es" ? BOOK_NAMES_ES : BOOK_NAMES;
  return String(s ?? "").replace(/\b([A-Z0-9]+) (\d+:\d+(?:-\d+)?)\b/g, (m, code, rest) =>
    names[code] ? `${names[code]} ${rest}` : m);
}

// Nov 5, 2026, v28, Jeremiah's verse ranges: a range the
// pastor cites (Matthew 28:18-20) is ONE passage unit, not
// three separate verses. A range is a code, a chapter, and a
// start-end verse pair, same chapter only. rangeVerses
// expands it to the single-verse refs it covers, so the
// verse store (keyed by single verse) can supply the text.
// A single verse returns itself. resolveRefText joins the
// covered verses with a space, which is the range's text
// for the devotional, the kid retelling, and the lock check.
export function rangeVerses(ref) {
  const m = String(ref ?? "").trim().match(/^([A-Z0-9]+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return [String(ref ?? "").trim()];
  const [, code, ch, v1, v2] = m;
  if (!v2) return [`${code} ${ch}:${v1}`];
  const out = [];
  for (let v = Number(v1); v <= Number(v2); v++) out.push(`${code} ${ch}:${v}`);
  return out;
}

export function resolveRefText(ref, store) {
  const parts = rangeVerses(ref).map((r) => store?.[r]);
  if (parts.some((p) => p === undefined)) return undefined;
  return parts.join(" ");
}

// Nov 5, 2026, round-3 cover note: the pastor types a verse
// in plain words ("James 1:4", "1 John 4:19") or as a code
// ("JAS 1:4"). Parse it back to the code reference the verse
// store keys on, or null when the book cannot be found. Never
// guesses: an unknown book returns null.
// Nov 11, 2026, v53: Spanish names too ("San Mateo 6:14",
// "Salmos 23:1", "Santiago 1:4"), accent-insensitive, so
// "Genesis", "Génesis", "Exodo", and "Éxodo" all parse.
// English and Spanish share one map; a name that exists in
// both languages maps to the same code.
const NAME_TO_CODE_ES = Object.fromEntries(
  Object.entries(BOOK_NAMES_ES).map(([code, name]) => [foldAccents(name.toLowerCase()), code])
);
const NAME_TO_CODE = Object.fromEntries([
  ...Object.entries(BOOK_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
  ...Object.entries(NAME_TO_CODE_ES),
]);
export function parseRef(input, language = null) {
  const m = String(input ?? "").trim().match(/^(.+?)\s+(\d+:\d+(?:-\d+)?)$/);
  if (!m) return null;
  const book = m[1].trim();
  const folded = foldAccents(book.toLowerCase());
  const code = NAME_TO_CODE[folded] ?? NAME_TO_CODE[book.toLowerCase()] ?? (BOOK_NAMES[book.toUpperCase()] ? book.toUpperCase() : null);
  if (!code || !BOOK_NAMES[code]) return null;
  return `${code} ${m[2]}`;
}
