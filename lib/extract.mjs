// Step 7.5 Phase D, step 2: JS port of scripts/extract_refs.py,
// for the app's input front door. Same rules, same book map,
// so the app and the script agree on what was found:
// regex extraction only, a range is one passage unit (never
// expanded), chapter-only is a chapter note not a day verse,
// dedupe in first-seen order, topic alone returns no refs
// and says so, a plan under 5 refs is incomplete and asks
// for more verses, never padded.
const BOOKS = {
  GEN: ["genesis", "gen", "gn"], EXO: ["exodus", "exod", "ex"],
  LEV: ["leviticus", "lev", "lv"], NUM: ["numbers", "num", "nm"],
  DEU: ["deuteronomy", "deut", "dt"], JOS: ["joshua", "josh", "jo"],
  JDG: ["judges", "judg", "jdg"], RUT: ["ruth", "ru"],
  "1SA": ["1 samuel", "1 sam", "1sa"], "2SA": ["2 samuel", "2 sam", "2sa"],
  "1KI": ["1 kings", "1 kgs", "1ki"], "2KI": ["2 kings", "2 kgs", "2ki"],
  "1CH": ["1 chronicles", "1 chron", "1ch"], "2CH": ["2 chronicles", "2 chron", "2ch"],
  EZR: ["ezra", "ezr"], NEH: ["nehemiah", "neh"], EST: ["esther", "esth", "est"],
  JOB: ["job", "jb"], PRO: ["proverbs", "prov", "pro"],
  ECC: ["ecclesiastes", "eccl", "ecc"], SON: ["song of songs", "song", "sos"],
  PSA: ["psalms", "psalm", "ps", "psa"], ISA: ["isaiah", "isa", "is"],
  JER: ["jeremiah", "jer", "je"], EZE: ["ezekiel", "ezek", "ez"],
  DAN: ["daniel", "dan", "dn"], HOS: ["hosea", "hos"], JOE: ["joel", "jl"],
  AMO: ["amos", "am"], OBA: ["obadiah", "ob"], JON: ["jonah", "jon"],
  MIC: ["micah", "mic"], NAH: ["nahum", "nah"], HAB: ["habakkuk", "hab"],
  ZEP: ["zephaniah", "zeph", "zep"], HAG: ["haggai", "hag"],
  ZEC: ["zechariah", "zech", "zec"], MAL: ["malachi", "mal"],
  LAM: ["lamentations", "lam"],
  MAT: ["matthew", "matt", "mt"], MRK: ["mark", "mk"],
  LUK: ["luke", "lk"], JHN: ["john", "jn"], ACT: ["acts", "ac"],
  ROM: ["romans", "rom", "ro"], "1CO": ["1 corinthians", "1 cor", "1co"],
  "2CO": ["2 corinthians", "2 cor", "2co"], GAL: ["galatians", "gal", "ga"],
  EPH: ["ephesians", "eph", "ep"], PHP: ["philippians", "phil", "php"],
  COL: ["colossians", "col"], "1TH": ["1 thessalonians", "1 thess", "1th"],
  "2TH": ["2 thessalonians", "2 thess", "2th"], "1TI": ["1 timothy", "1 tim", "1ti"],
  "2TI": ["2 timothy", "2 tim", "2ti"], TIT: ["titus", "ti"],
  PHM: ["philemon", "phlm", "phm"],
  HEB: ["hebrews", "heb"], JAS: ["james", "jas"],
  "1PE": ["1 peter", "1 pet", "1pe"], "2PE": ["2 peter", "2 pet", "2pe"],
  "1JN": ["1 john", "1 jn", "1jn"], "2JN": ["2 john", "2 jn", "2jn"],
  "3JN": ["3 john", "3 jn", "3jn"], JUD: ["jude", "jud"],
  REV: ["revelation", "rev", "rv"],
};
const NAME_TO_CODE = {};
for (const [code, names] of Object.entries(BOOKS)) {
  for (const n of names) NAME_TO_CODE[n] = code;
  NAME_TO_CODE[code.toLowerCase()] = code;
}
const BOOK_PATTERN = Object.keys(NAME_TO_CODE).sort((a, b) => b.length - a.length).join("|");

export function extractRefs(text) {
  const refs = [];
  const seen = new Set();
  const spans = [];
  const verseRe = new RegExp(`\\b(${BOOK_PATTERN})\\s+(\\d+):(\\d+)(?:-(\\d+))?\\b`, "gi");
  let m;
  while ((m = verseRe.exec(text)) !== null) {
    const code = NAME_TO_CODE[m[1].toLowerCase()];
    const ch = parseInt(m[2], 10), v1 = parseInt(m[3], 10);
    spans.push([m.index, m.index + m[0].length]);
    if (m[4]) {
      // v28, Nov 5, 2026: a range is ONE passage unit,
      // never expanded. A range over 10 verses is still one
      // unit, and carries a note saying so.
      const end = parseInt(m[4], 10);
      const ref = `${code} ${ch}:${v1}-${end}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        const entry = { reference: ref, kind: "range" };
        if (end - v1 + 1 > 10) entry.note = "Passage over 10 verses, kept as one unit.";
        refs.push(entry);
      }
    } else {
      const ref = `${code} ${ch}:${v1}`;
      if (!seen.has(ref)) { seen.add(ref); refs.push({ reference: ref, kind: "verse" }); }
    }
  }
  const chapterRe = new RegExp(`\\b(${BOOK_PATTERN})\\s+(\\d+)\\b(?!\\s*:)`, "gi");
  while ((m = chapterRe.exec(text)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    if (spans.some(([ss, es]) => s < es && e > ss)) continue;
    const code = NAME_TO_CODE[m[1].toLowerCase()];
    const ref = `${code} ${parseInt(m[2], 10)}`;
    if (!seen.has(ref)) { seen.add(ref); refs.push({ reference: ref, kind: "chapter" }); }
  }
  // v28, Nov 5, 2026: a range counts as one day in the
  // plan, same as a single verse.
  const verses = refs.filter((r) => r.kind === "verse" || r.kind === "range");
  const plan = verses.slice(0, 5).map((r) => r.reference);
  return {
    refs,
    verseRefs: verses.map((r) => r.reference),
    proposedDayPlan: plan,
    planComplete: plan.length === 5,
    status: plan.length ? "ok" : "no_refs_found",
    message: plan.length === 5
      ? "Proposed 5-day plan from your refs, in order."
      : plan.length
        ? "Not enough verse refs for a 5-day plan. Add verses, do not let the tool invent them."
        : "No verse references found. A topic alone is not enough yet. Paste a sermon, a verse list, or a passage.",
  };
}
