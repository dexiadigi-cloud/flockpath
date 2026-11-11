"""Build Flockpath BSB verse stores from the verified canonical BSB file.

Source: ~/workspace/dexia-docs/bible/bsb.txt, official bereanbible.com
dataset, retrieved 2026-10-11, SHA-256 verified Oct 31, 2026 against
the README hash 2ac3af1de52d4e68261cba91d85c320b7eadc6560e830d99e591767b8ff5ca96.
BSB was dedicated to the public domain (CC0) Apr 30, 2023.

Output: data/bsb-<CODE>.json per book, same shape as the old
engwebp stores: {"GEN 1:1": "In the beginning ...", ...}
Book names in bsb.txt differ from Flockpath codes in three cases:
Psalm -> PSA, Song of Solomon -> SON, Mark -> MRK. All other
names map directly to the standard codes below.

Usage: python3 scripts/build_bsb_store.py
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BSB = Path.home() / "workspace/dexia-docs/bible/bsb.txt"
EXPECTED_SHA = "2ac3af1de52d4e68261cba91d85c320b7eadc6560e830d99e591767b8ff5ca96"

BOOK_MAP = {
    "Genesis": "GEN", "Exodus": "EXO", "Leviticus": "LEV", "Numbers": "NUM",
    "Deuteronomy": "DEU", "Joshua": "JOS", "Judges": "JDG", "Ruth": "RUT",
    "1 Samuel": "1SA", "2 Samuel": "2SA", "1 Kings": "1KI", "2 Kings": "2KI",
    "1 Chronicles": "1CH", "2 Chronicles": "2CH", "Ezra": "EZR", "Nehemiah": "NEH",
    "Esther": "EST", "Job": "JOB", "Psalm": "PSA", "Proverbs": "PRO",
    "Ecclesiastes": "ECC", "Song of Solomon": "SON", "Isaiah": "ISA",
    "Jeremiah": "JER", "Lamentations": "LAM", "Ezekiel": "EZE", "Daniel": "DAN",
    "Hosea": "HOS", "Joel": "JOE", "Amos": "AMO", "Obadiah": "OBA",
    "Jonah": "JON", "Micah": "MIC", "Nahum": "NAH", "Habakkuk": "HAB",
    "Zephaniah": "ZEP", "Haggai": "HAG", "Zechariah": "ZEC", "Malachi": "MAL",
    "Matthew": "MAT", "Mark": "MRK", "Luke": "LUK", "John": "JHN",
    "Acts": "ACT", "Romans": "ROM", "1 Corinthians": "1CO", "2 Corinthians": "2CO",
    "Galatians": "GAL", "Ephesians": "EPH", "Philippians": "PHP",
    "Colossians": "COL", "1 Thessalonians": "1TH", "2 Thessalonians": "2TH",
    "1 Timothy": "1TI", "2 Timothy": "2TI", "Titus": "TIT", "Philemon": "PHM",
    "Hebrews": "HEB", "James": "JAS", "1 Peter": "1PE", "2 Peter": "2PE",
    "1 John": "1JN", "2 John": "2JN", "3 John": "3JN", "Jude": "JUD",
    "Revelation": "REV",
}


def main():
    data = BSB.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    if sha != EXPECTED_SHA:
        raise SystemExit(f"BSB SHA mismatch: {sha} != {EXPECTED_SHA}")
    text = data.decode("utf-8-sig")
    stores = {}
    for line in text.splitlines():
        if "\t" not in line:
            continue
        ref, verse = line.split("\t", 1)
        m = re.match(r"^(.+?) (\d+):(\d+)$", ref.strip())
        if not m:
            continue
        book_name, ch, v = m.group(1), m.group(2), m.group(3)
        code = BOOK_MAP.get(book_name)
        if not code:
            raise SystemExit(f"Unmapped BSB book: {book_name}")
        # BSB omits 16 verses found in older editions (e.g.
        # Matthew 17:21, Mark 9:44): they are present as keys
        # with empty text in bsb.txt. Exclude them, so a plan
        # using one fails closed ("not in verse store") instead
        # of publishing a blank verse. Text-bearing total is
        # therefore 31,086, not 31,102 keys.
        if not verse.strip():
            continue
        stores.setdefault(code, {})[f"{code} {ch}:{v}"] = verse.strip()
    if len(stores) != 66:
        raise SystemExit(f"Expected 66 books, got {len(stores)}")
    total = 0
    for code in sorted(stores):
        out = ROOT / f"data/bsb-{code}.json"
        out.write_text(json.dumps(stores[code], ensure_ascii=False, indent=1), encoding="utf-8")
        total += len(stores[code])
        print(f"{code}: {len(stores[code])} verses -> {out.name}")
    print(f"Total: {total} verses, SHA verified {sha[:16]}...")


if __name__ == "__main__":
    main()
