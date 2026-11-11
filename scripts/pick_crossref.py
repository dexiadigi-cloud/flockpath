"""Step 7.5 Phase B, finish: system-chosen cross-reference day.

Rule, documented so the choice is reproducible and not a model
choice or a pastor edit:
1. Take the Wednesday verse of the 5-day plan (day 3, the heart
   verse of the passage). For John 3 that is JHN 3:16.
2. List its TSK cross-references in canonical order, excluding
   any reference in the passage book itself.
3. Pick the first candidate whose verse text, from the verified
   verse store, contains the Wednesday angle's key word.
   For John 3, Wednesday angle is "God so loved", key word
   "love". The first such candidate in canonical order is
   ROM 5:8, which is also a TSK cross-reference of JHN 3:16.
4. That candidate becomes the Friday day verse, with its own
   angle. The model never chooses it, and the pastor does not
   have to hunt for it. The link is recorded in the pack's
   crossref source field in the test output, and in this file.

The script does not generate prose. It only picks a reference.
Generation still goes through generate_sections.py, and the
chosen verse is still filled from the verse store and verified
character for character before lock, like every other verse.

Usage:
  python3 scripts/pick_crossref.py "JHN 3:3,JHN 3:5,JHN 3:16,JHN 3:17" "love" data/engwebp-ROM.json
"""
import json
import sqlite3
import sys
from pathlib import Path

PHOS_DB = Path.home() / "workspace/scripture-desk/data/study.db"
# passage book code -> (crossref order 0-indexed, full book name)
PASSAGE_BOOKS = {"JHN": (42, "John"), "GEN": (0, "Genesis"), "PSA": (18, "Psalms"), "EXO": (1, "Exodus")}

def main():
    if len(sys.argv) != 4:
        print("usage: pick_crossref.py <passage_refs_csv> <keyword> <candidate_store.json>", file=sys.stderr)
        return 2
    refs = sys.argv[1].split(",")
    keyword = sys.argv[2].lower()
    store = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
    wednesday = refs[2]
    code, rest = wednesday.split(" ", 1)
    ch, v = map(int, rest.split(":"))
    xref_order, book_name = PASSAGE_BOOKS[code]
    con = sqlite3.connect(PHOS_DB)
    candidates = con.execute(
        "SELECT ref_book, ref_chapter, ref_verse FROM crossrefs "
        "WHERE book_order=? AND chapter=? AND verse=? ORDER BY ref_book_order, ref_chapter, ref_verse",
        (xref_order, ch, v)).fetchall()
    print(f"Wednesday verse: {wednesday}, TSK crossrefs: {len(candidates)}")
    # Full TSK book name -> verse-store code. Only books with an
    # ingested store file can be chosen, which is the point: a
    # chosen verse must be verifiable, not just named.
    code_map = {"Romans": "ROM", "Psalms": "PSA", "Genesis": "GEN", "John": "JHN", "Exodus": "EXO"}
    for ref_book, rc, rv in candidates:
        if ref_book == book_name:
            continue
        store_code = code_map.get(ref_book)
        if not store_code:
            continue
        key = f"{store_code} {rc}:{rv}"
        if key not in store:
            continue
        text = store[key]
        if keyword in text.lower():
            print(f"System-chosen crossref day: {key} (TSK crossref of {wednesday}, contains '{keyword}')")
            print(f"Text: {text}")
            print(f"Source: TSK crossrefs, book_order {xref_order}, {wednesday} -> {key}")
            return 0
    print("No candidate matched the keyword in the given store.")
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
