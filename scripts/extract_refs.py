"""Step 7.5 Phase D, step 1: pastor input front door, backend.

One front door for: topic, verse list, sermon paste, .txt/.md
file. It does NOT generate a pack. It only extracts what the
pastor actually gave, shows it back for confirm-or-correct,
and proposes a 5-day plan from it. Generation still happens
only after that confirm step, and only from confirmed refs.

Rules, in order:
1. Verse references are extracted by regex, never guessed
   by the model. Book names and common abbreviations map to
   a canonical code. A range is kept as ONE unit, never
   expanded into separate verses (v28, Nov 5, 2026: the
   pastor cited it together for a reason); a range over 10
   verses carries a note that it is long, not silently
   truncated to a verse the pastor did not pick.
2. Dedupe, preserve first-seen order. A reference inside
   another reference is not counted twice.
3. Chapter-only refs (e.g. "Genesis 1") are accepted only
   when they are not part of a verse ref already found.
   They become a chapter note, not a day verse, until the
   pastor picks verses from that chapter.
4. If no refs are found, the tool says so. It does NOT
   invent a passage from a topic. Topic-to-passage search
   via Phos is a later Phase D step, and until then a topic
   alone is not enough to generate.
5. A proposed day plan is the first 5 distinct verse refs,
   in order. If fewer than 5 are found, the plan is
   incomplete and the pastor is asked to add verses, not
   given a padded plan with invented refs.

Usage:
  python3 scripts/extract_refs.py "John 3:16, Psalm 23:1-3"
  python3 scripts/extract_refs.py --file sermon.txt
  python3 scripts/extract_refs.py --topic "grace"
"""
import re
import sys
from pathlib import Path

BOOKS = {
    # canonical code: [names, abbreviations]
    "GEN": ["genesis", "gen", "gn"],
    "EXO": ["exodus", "exod", "ex"],
    "LEV": ["leviticus", "lev", "lv"],
    "NUM": ["numbers", "num", "nm"],
    "DEU": ["deuteronomy", "deut", "dt"],
    "JOS": ["joshua", "josh", "jo"],
    "JDG": ["judges", "judg", "jdg"],
    "RUT": ["ruth", "ru"],
    "1SA": ["1 samuel", "1 sam", "1sa"],
    "2SA": ["2 samuel", "2 sam", "2sa"],
    "1KI": ["1 kings", "1 kgs", "1ki"],
    "2KI": ["2 kings", "2 kgs", "2ki"],
    "1CH": ["1 chronicles", "1 chron", "1ch"],
    "2CH": ["2 chronicles", "2 chron", "2ch"],
    "EZR": ["ezra", "ezr"],
    "NEH": ["nehemiah", "neh"],
    "EST": ["esther", "esth", "est"],
    "JOB": ["job", "jb"],
    "PRO": ["proverbs", "prov", "pro"],
    "ECC": ["ecclesiastes", "eccl", "ecc"],
    "SON": ["song of songs", "song", "sos"],
    "PSA": ["psalms", "psalm", "ps", "psa"],
    "ISA": ["isaiah", "isa", "is"],
    "JER": ["jeremiah", "jer", "je"],
    "EZE": ["ezekiel", "ezek", "ez"],
    "DAN": ["daniel", "dan", "dn"],
    "HOS": ["hosea", "hos"],
    "JOE": ["joel", "jl"],
    "AMO": ["amos", "am"],
    "OBA": ["obadiah", "ob"],
    "JON": ["jonah", "jon"],
    "MIC": ["micah", "mic"],
    "NAH": ["nahum", "nah"],
    "HAB": ["habakkuk", "hab"],
    "ZEP": ["zephaniah", "zeph", "zep"],
    "HAG": ["haggai", "hag"],
    "ZEC": ["zechariah", "zech", "zec"],
    "MAL": ["malachi", "mal"],
    "LAM": ["lamentations", "lam"],
    "MAT": ["matthew", "matt", "mt"],
    "MRK": ["mark", "mk"],
    "LUK": ["luke", "lk"],
    # Nov 4, 2026, topic-search recall (Mac test item 11):
    # Torrey and ISBE entries cite John as "Jno." and
    # "Joh", which the old alias list missed entirely, so
    # central love verses never surfaced from those entries.
    "JHN": ["john", "jn", "joh", "jno"],
    "ACT": ["acts", "ac"],
    "ROM": ["romans", "rom", "ro"],
    "1CO": ["1 corinthians", "1 cor", "1co"],
    "2CO": ["2 corinthians", "2 cor", "2co"],
    "GAL": ["galatians", "gal", "ga"],
    "EPH": ["ephesians", "eph", "ep"],
    "PHP": ["philippians", "phil", "php"],
    "COL": ["colossians", "col"],
    "1TH": ["1 thessalonians", "1 thess", "1th"],
    "2TH": ["2 thessalonians", "2 thess", "2th"],
    "1TI": ["1 timothy", "1 tim", "1ti"],
    "2TI": ["2 timothy", "2 tim", "2ti"],
    "TIT": ["titus", "ti"],
    "PHM": ["philemon", "phlm", "phm"],
    "HEB": ["hebrews", "heb"],
    "JAS": ["james", "jas"],
    "1PE": ["1 peter", "1 pet", "1pe"],
    "2PE": ["2 peter", "2 pet", "2pe"],
    "1JN": ["1 john", "1 jn", "1jn", "1 joh", "1 jno"],
    "2JN": ["2 john", "2 jn", "2jn", "2 joh", "2 jno"],
    "3JN": ["3 john", "3 jn", "3jn", "3 joh", "3 jno"],
    "JUD": ["jude", "jud"],
    "REV": ["revelation", "rev", "rv"],
}
NAME_TO_CODE = {}
for code, names in BOOKS.items():
    for n in names:
        NAME_TO_CODE[n] = code
    # Pastors and our own test files also type codes: JHN, PSA, ROM.
    # Accept the code itself as an alias, or a verse list in code
    # form silently extracts only the last ref, which is wrong.
    NAME_TO_CODE[code.lower()] = code
# Longest names first, so "1 john" matches before "john".
BOOK_PATTERN = "|".join(sorted(NAME_TO_CODE.keys(), key=len, reverse=True))

# Nov 4, 2026, topic-search recall (Mac test item 11):
# classic reference works abbreviate with a period, "1 Cor.
# 13:4", "Rom. 5:8", and the old pattern required whitespace
# right after the book name, so those citations extracted
# nothing. An optional period is now allowed after the
# book name in both patterns.
VERSE_RE = re.compile(
    rf"\b({BOOK_PATTERN})\.?\s+(\d+):(\d+)(?:-(\d+))?\b", re.IGNORECASE
)
CHAPTER_RE = re.compile(
    rf"\b({BOOK_PATTERN})\.?\s+(\d+)\b(?!\s*:)", re.IGNORECASE
)
# Comma continuations, same chapter: "1 John 4:7, 8" and
# "1 Joh 4:7,19,21" mean 4:7, 4:8, 4:19, 4:21. The number
# must not be followed by a colon (that would be a new
# chapter:verse pair, not a continuation), and must be a
# plausible verse number, so ", 2000" in prose can never
# fabricate a verse. A false positive in sermon prose
# ("John 3:16, 12 people") is possible; the pastor unchecks
# it in review, and recall wins over silence here.
CONT_RE = re.compile(r",\s*(\d+)(?!\s*:)")
MAX_VERSE = 176  # Psalm 119, the longest chapter

# Nov 5, 2026, fresh-eyes test: sermons (especially older
# ones) cite numbered books with Roman numerals, "II Timothy
# 3:16", "I Peter 2:25", "III John 1:2". The old patterns
# only knew Arabic numerals, so "II Timothy" extracted
# nothing, "I Peter" extracted nothing, and "III John 1:2"
# misread as JHN 1:2 (the regex matched "John 1:2" inside
# it). Normalize Roman I/II/III + book name to Arabic before
# any matching runs, so every downstream pattern works
# unchanged. The lookahead limits the rewrite to real book
# names, so prose like "I, John, saw..." is untouched (a
# comma follows the I, not a book name), and a bare "I John"
# with no digits after it extracts nothing either way.
ROMAN_BOOKS = "samuel|sam|kings|kgs|chronicles|chron|corinthians|cor|thessalonians|thess|timothy|tim|peter|pet|john|jn|joh|jno"
_ROMAN_PREFIX_RE = re.compile(rf"\b(I{{1,3}})\s+(?=({ROMAN_BOOKS})\b)", re.IGNORECASE)
_ROMAN_TO_ARABIC = {"I": "1", "II": "2", "III": "3"}

def normalize_roman_numerals(text):
    return _ROMAN_PREFIX_RE.sub(lambda m: _ROMAN_TO_ARABIC[m.group(1).upper()] + " ", text or "")

def extract(text):
    text = normalize_roman_numerals(text)
    refs = []
    seen = set()
    spans = []
    for m in VERSE_RE.finditer(text):
        code = NAME_TO_CODE[m.group(1).lower()]
        ch, v1, v2 = int(m.group(2)), int(m.group(3)), m.group(4)
        spans.append(m.span())
        if v2:
            # v28, Nov 5, 2026, Jeremiah's verse ranges: a
            # range the pastor cites (Matthew 28:18-20) is
            # ONE passage unit, never expanded into separate
            # verses. The pastor cited it together for a
            # reason, and splitting it forces three days
            # where the pastor wanted one. A range over 10
            # verses is still one unit, with a note so the
            # pastor sees it is long.
            end = int(v2)
            ref = f"{code} {ch}:{v1}-{end}"
            if ref not in seen:
                seen.add(ref)
                entry = {"reference": ref, "kind": "range"}
                if end - v1 + 1 > 10:
                    entry["note"] = "Passage over 10 verses, kept as one unit."
                refs.append(entry)
        else:
            ref = f"{code} {ch}:{v1}"
            if ref not in seen:
                seen.add(ref)
                refs.append({"reference": ref, "kind": "verse"})
        # Comma continuations in the same chapter, directly
        # after this match: "4:7, 8" and "4:7,19,21" chains.
        pos = m.end()
        while True:
            cm = CONT_RE.match(text, pos)
            if not cm:
                break
            cv = int(cm.group(1))
            pos = cm.end()
            if cv > MAX_VERSE:
                break
            ref = f"{code} {ch}:{cv}"
            if ref not in seen:
                seen.add(ref)
                refs.append({"reference": ref, "kind": "verse"})
    # Chapter-only, only outside verse-ref spans.
    for m in CHAPTER_RE.finditer(text):
        s, e = m.span()
        if any(s < es and e > ss for ss, es in spans):
            continue
        code = NAME_TO_CODE[m.group(1).lower()]
        ch = int(m.group(2))
        ref = f"{code} {ch}"
        if ref not in seen:
            seen.add(ref)
            refs.append({"reference": ref, "kind": "chapter"})
    # v28, Nov 5, 2026: a range is one passage unit, so it
    # counts as one day in the plan, same as a single verse.
    verses = [r for r in refs if r["kind"] in ("verse", "range")]
    plan = [r["reference"] for r in verses[:5]]
    return {
        "refs": refs,
        "verse_refs": [r["reference"] for r in verses],
        "proposed_day_plan": plan,
        "plan_complete": len(plan) == 5,
        "status": "ok" if plan else "no_refs_found",
        "message": (
            "Proposed 5-day plan from your refs, in order."
            if len(plan) == 5 else
            "Not enough verse refs for a 5-day plan. Add verses, do not let the tool invent them."
            if plan else
            "No verse references found. A topic alone is not enough yet. Paste a sermon, a verse list, or a passage."
        ),
    }

def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--file":
        text = Path(sys.argv[2]).read_text(encoding="utf-8")
    elif len(sys.argv) == 3 and sys.argv[1] == "--topic":
        print(f"Topic: {sys.argv[2]}")
        print("No refs extracted from a topic alone. See rule 4 in the file header.")
        return 0
    elif len(sys.argv) == 2:
        text = sys.argv[1]
    else:
        print("usage: extract_refs.py <text> | --file <path> | --topic <topic>", file=sys.stderr)
        return 2
    import json
    print(json.dumps(extract(text), indent=1))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
