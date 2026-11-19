// Step 7.5 Phase D, step 2: JS port of scripts/extract_refs.py,
// for the app's input front door. Same rules, same book map,
// so the app and the script agree on what was found:
// regex extraction only, a range is one passage unit (never
// expanded), chapter-only is a chapter note not a day verse,
// dedupe in first-seen order, topic alone returns no refs
// and says so, a plan under dayCount refs is incomplete and asks
// for more verses, never padded.
// Nov 11, 2026, v53: Spanish aliases too, in folded
// (unaccented) form, matched against folded input, so
// "Génesis 1:1", "Genesis 1:1", "San Mateo 6:14", and
// "Mateo 6:14" all extract. Bare "juan" means the Gospel
// of John (the epistles always carry their number);
// bare "pedro" and "timoteo" are ambiguous and are not
// mapped. "San Mateo/Marcos/Lucas/Juan" keep the San;
// the bare gospel names map to the same codes.
const BOOKS = {
  GEN: ["genesis", "gen", "gn"], EXO: ["exodus", "exod", "ex", "exodo"],
  LEV: ["leviticus", "lev", "lv", "levitico"], NUM: ["numbers", "num", "nm", "numeros"],
  DEU: ["deuteronomy", "deut", "dt", "deuteronomio"], JOS: ["joshua", "josh", "jo", "josue"],
  JDG: ["judges", "judg", "jdg", "jueces"], RUT: ["ruth", "ru", "rut"],
  "1SA": ["1 samuel", "1 sam", "1sa"], "2SA": ["2 samuel", "2 sam", "2sa"],
  "1KI": ["1 kings", "1 kgs", "1ki", "1 reyes"], "2KI": ["2 kings", "2 kgs", "2ki", "2 reyes"],
  "1CH": ["1 chronicles", "1 chron", "1ch", "1 cronicas", "1 cron"], "2CH": ["2 chronicles", "2 chron", "2ch", "2 cronicas", "2 cron"],
  EZR: ["ezra", "ezr", "esdras"], NEH: ["nehemiah", "neh", "nehemias"], EST: ["esther", "esth", "est", "ester"],
  JOB: ["job", "jb"], PRO: ["proverbs", "prov", "pro", "proverbios"],
  ECC: ["ecclesiastes", "eccl", "ecc", "eclesiastes", "ecles"], SON: ["song of songs", "song", "sos", "cantares", "cant"],
  PSA: ["psalms", "psalm", "ps", "psa", "salmos", "salmo", "sal"], ISA: ["isaiah", "isa", "is", "isaias"],
  JER: ["jeremiah", "jer", "je", "jeremias"], EZE: ["ezekiel", "ezek", "ez", "ezequiel", "ezeq"],
  DAN: ["daniel", "dan", "dn"], HOS: ["hosea", "hos", "oseas"], JOE: ["joel", "jl"],
  AMO: ["amos", "am"], OBA: ["obadiah", "ob", "abdias"], JON: ["jonah", "jon", "jonas"],
  MIC: ["micah", "mic", "miqueas", "miq"], NAH: ["nahum", "nah"], HAB: ["habakkuk", "hab", "habacuc"],
  ZEP: ["zephaniah", "zeph", "zep", "sofonias", "sof"], HAG: ["haggai", "hag", "hageo"],
  ZEC: ["zechariah", "zech", "zec", "zacarias", "zac"], MAL: ["malachi", "mal", "malaquias"],
  LAM: ["lamentations", "lam", "lamentaciones"],
  MAT: ["matthew", "matt", "mt", "san mateo", "mateo"], MRK: ["mark", "mk", "san marcos", "marcos", "mr"],
  LUK: ["luke", "lk", "san lucas", "lucas", "lc"], JHN: ["john", "jn", "san juan", "juan"], ACT: ["acts", "ac", "hechos", "hch"],
  ROM: ["romans", "rom", "ro", "romanos"], "1CO": ["1 corinthians", "1 cor", "1co", "1 corintios"],
  "2CO": ["2 corinthians", "2 cor", "2co", "2 corintios"], GAL: ["galatians", "gal", "ga", "galatas"],
  EPH: ["ephesians", "eph", "ep", "efesios", "efe"], PHP: ["philippians", "phil", "php", "filipenses", "filip"],
  COL: ["colossians", "col", "colosenses"], "1TH": ["1 thessalonians", "1 thess", "1th", "1 tesalonicenses", "1 tes"],
  "2TH": ["2 thessalonians", "2 thess", "2th", "2 tesalonicenses", "2 tes"], "1TI": ["1 timothy", "1 tim", "1ti", "1 timoteo"],
  "2TI": ["2 timothy", "2 tim", "2ti", "2 timoteo"], TIT: ["titus", "ti", "tito"],
  PHM: ["philemon", "phlm", "phm", "filemon", "flm"],
  HEB: ["hebrews", "heb", "hebreos"], JAS: ["james", "jas", "santiago", "sant", "stg"],
  "1PE": ["1 peter", "1 pet", "1pe", "1 pedro"], "2PE": ["2 peter", "2 pet", "2pe", "2 pedro"],
  "1JN": ["1 john", "1 jn", "1jn", "1 juan"], "2JN": ["2 john", "2 jn", "2jn", "2 juan"],
  "3JN": ["3 john", "3 jn", "3jn", "3 juan"], JUD: ["jude", "jud", "judas"],
  REV: ["revelation", "rev", "rv", "apocalipsis", "apoc"],
};
const NAME_TO_CODE = {};
for (const [code, names] of Object.entries(BOOKS)) {
  for (const n of names) NAME_TO_CODE[n] = code;
  NAME_TO_CODE[code.toLowerCase()] = code;
}
const BOOK_PATTERN = Object.keys(NAME_TO_CODE).sort((a, b) => b.length - a.length).join("|");

export function extractRefs(text, dayCount = 5) {
  // Nov 11, 2026, v54, Phase 4 flexible length: the proposed
  // plan is dayCount verses long (3, 5, or 7). Any other
  // count falls back to 5, the default, so an old caller
  // keeps working. verseRefs still lists every verse found.
  const n = [3, 5, 7].includes(dayCount) ? dayCount : 5;
  const refs = [];
  const seen = new Set();
  const spans = [];
  // v53: fold accents before matching, so "Génesis 1:1"
  // matches the folded alias "genesis". Folding is
  // length-preserving in code points (each accented letter
  // becomes its base letter), so match indices still point
  // at the right place in the original text.
  const folded = String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const verseRe = new RegExp(`\\b(${BOOK_PATTERN})\\s+(\\d+):(\\d+)(?:-(\\d+))?\\b`, "gi");
  let m;
  while ((m = verseRe.exec(folded)) !== null) {
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
  while ((m = chapterRe.exec(folded)) !== null) {
    const s = m.index, e = m.index + m[0].length;
    if (spans.some(([ss, es]) => s < es && e > ss)) continue;
    const code = NAME_TO_CODE[m[1].toLowerCase()];
    const ref = `${code} ${parseInt(m[2], 10)}`;
    if (!seen.has(ref)) { seen.add(ref); refs.push({ reference: ref, kind: "chapter" }); }
  }
  // v28, Nov 5, 2026: a range counts as one day in the
  // plan, same as a single verse.
  const verses = refs.filter((r) => r.kind === "verse" || r.kind === "range");
  const plan = verses.slice(0, n).map((r) => r.reference);
  return {
    refs,
    verseRefs: verses.map((r) => r.reference),
    proposedDayPlan: plan,
    planComplete: plan.length === n,
    status: plan.length ? "ok" : "no_refs_found",
    message: plan.length === n
      ? `Proposed ${n}-day plan from your refs, in order.`
      : plan.length
        ? `Not enough verse refs for a ${n}-day plan. Add verses, do not let the tool invent them.`
        : "No verse references found. A topic alone is not enough yet. Paste a sermon, a verse list, or a passage.",
  };
}
