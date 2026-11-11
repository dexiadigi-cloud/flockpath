"""Flockpath verse store, Step 2.

Build-time ingestion only. The Next.js app reads the clean JSON this
produces; it never parses USFM at runtime.

Cleaning rules, in order:
  1. Drop footnotes (\\f ... \\f*) and cross-references (\\x ... \\x*)
     entirely, including anything nested inside them.
  2. Replace word markers (\\w word|attrs\\w*, \\+w word|attrs\\+w*)
     with just the word.
  3. Strip every remaining USFM marker token, keeping the text it
     wrapped (so \\add, \\nd, \\it content survives).
  4. Collapse whitespace.

The verifier is deliberately dumb: exact string equality against the
cleaned store text. No fuzzy matching, no LLM judgement. A verse that
does not match character for character does not publish.
"""
import json
import re
import zipfile
from pathlib import Path

FOOTNOTE_RE = re.compile(r"\\f\b.*?\\f\*", re.S)
XREF_RE = re.compile(r"\\x\b.*?\\x\*", re.S)
WORD_RE = re.compile(r"\\\+?w\s+([^|\\]+)(?:\|[^\\]*)?\\\+?w\*")
MARKER_RE = re.compile(r"\\[a-zA-Z]+\d*\*?")
# Note: the \d* matters. Poetry markers like \q1 and \q2 are line
# numbers, not verse text. Without it, Psalm 23:1 came out as
# "The LORD is my shepherd; 2 I shall lack nothing. 1" - caught by
# the Step 2 spot-check, fixed here.
VERSE_RE = re.compile(r"\\v\s+(\d+[a-z]?)\s+(.*?)(?=\n\\v\s|\n\\c\s|\Z)", re.S)


def clean_verse(raw: str) -> str:
    text = FOOTNOTE_RE.sub("", raw)
    text = XREF_RE.sub("", text)
    text = WORD_RE.sub(r"\1", text)
    text = MARKER_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_usfm(text: str, book: str) -> dict:
    verses = {}
    chapter = None
    for m in re.finditer(r"\\c\s+(\d+)", text):
        chapter = m.group(1)
    # Walk chapter by chapter so verse keys carry the right chapter.
    verses = {}
    chapter = None
    pos = 0
    # Simpler robust walk: split on chapter markers, then verses inside.
    chunks = re.split(r"(\\c\s+\d+)", text)
    for i in range(1, len(chunks), 2):
        chapter = re.search(r"\d+", chunks[i]).group(0)
        body = chunks[i + 1] if i + 1 < len(chunks) else ""
        for vm in VERSE_RE.finditer(body):
            num, raw = vm.group(1), vm.group(2)
            cleaned = clean_verse(raw)
            if cleaned:
                verses[f"{book} {chapter}:{num}"] = cleaned
    return verses


def load_book_from_zip(zip_path: Path, filename: str, book: str) -> dict:
    with zipfile.ZipFile(zip_path) as z:
        text = z.read(filename).decode("utf-8")
    return parse_usfm(text, book)


def verify(verses: dict, reference: str, quoted: str) -> bool:
    """Exact match only. Unknown reference also fails closed."""
    return verses.get(reference) == quoted


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    pack = Path.home() / "workspace/sunday-table-bible-packs/usfm/engwebp_usfm.zip"
    out = root / "data"
    out.mkdir(exist_ok=True)
    genesis = load_book_from_zip(pack, "02-GENengwebp.usfm", "GEN")
    (out / "engwebp-GEN.json").write_text(
        json.dumps(genesis, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"GEN verses: {len(genesis)}")
    print(f"GEN 1:1 = {genesis.get('GEN 1:1')}")
    print(f"Wrote {out / 'engwebp-GEN.json'}")
