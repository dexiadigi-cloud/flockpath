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

export function formatRef(ref) {
  const m = String(ref ?? "").trim().match(/^([A-Z0-9]+)\s+(.+)$/);
  if (!m) return String(ref ?? "");
  const name = BOOK_NAMES[m[1].toUpperCase()];
  return name ? `${name} ${m[2]}` : String(ref);
}

// Nov 5, 2026, round-3: same mapping, inside prose.
// Replaces code references (JAS 1:4, 1JN 4:19) with full
// book names wherever they appear in display text: leader
// notes, questions, kid titles. Plain prose passes through
// unchanged, unknown codes pass through unchanged, and
// full names are already full, so this is idempotent.
export function formatRefsInText(s) {
  return String(s ?? "").replace(/\b([A-Z0-9]+) (\d+:\d+(?:-\d+)?)\b/g, (m, code, rest) =>
    BOOK_NAMES[code] ? `${BOOK_NAMES[code]} ${rest}` : m);
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
const NAME_TO_CODE = Object.fromEntries(
  Object.entries(BOOK_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);
export function parseRef(input) {
  const m = String(input ?? "").trim().match(/^(.+?)\s+(\d+:\d+(?:-\d+)?)$/);
  if (!m) return null;
  const book = m[1].trim();
  const code = NAME_TO_CODE[book.toLowerCase()] ?? (BOOK_NAMES[book.toUpperCase()] ? book.toUpperCase() : null);
  if (!code || !BOOK_NAMES[code]) return null;
  return `${code} ${m[2]}`;
}
