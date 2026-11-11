"""Overnight Oct 31, 2026, Step 2: derive day angles from Phos, not from a model.

A pastor who gives only refs should not have to invent angles,
and the tool must not invent doctrine either. So an angle here
is a short phrase taken verbatim from the verse text itself,
plus the Phos lexicon words for that verse as evidence, printed
in the output for checking. No model is called. No new wording
is introduced into the angle.

Rule, in order, per verse:
1. Take the verse text from the verified verse store (via the
   Phos bundle when given, otherwise from the bsb store files
   listed in phos_context.BOOKS).
2. Split the text into clauses on , ? ; : and ! .
3. Pick the first clause with at least 3 content words, after
   stripping common lead-ins ("for", "we know that", "what then
   shall we say about", "no", "in all these things we are").
4. Cap the angle at 8 words. If no clause qualifies, fall back
   to the first 4 content words of the verse, and say so.

Usage:
  python3 scripts/derive_angles.py "ROM 8:28,ROM 8:31,ROM 8:32,ROM 8:37,ROM 8:38"
  python3 scripts/derive_angles.py "ROM 8:28,..." data/phos-test-rom8.json
Output: JSON {"refs": [...], "angles": [...], "detail": [{reference, angle, source, lexicon}]}
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

STOP = {"a", "an", "the", "and", "or", "but", "for", "of", "in", "on", "to", "by", "with",
        "we", "you", "he", "she", "it", "they", "his", "her", "its", "their", "our",
        "is", "are", "was", "were", "be", "been", "shall", "will", "would", "can", "could",
        "that", "who", "whom", "which", "what", "then", "no", "not", "nor", "if", "so", "as",
        "i", "am", "say", "said", "know", "us", "me", "him", "them", "these", "things"}
LEADINS = [
    r"^for\s+", r"^we know that\s+", r"^what then shall we say about\s+",
    r"^what shall we then say\s+", r"^no,?\s+", r"^in all these things we are\s+",
    r"^and\s+", r"^but\s+", r"^most certainly i tell you,?\s*",
    r"^i am persuaded that\s+",
]

def clean_clause(text):
    s = text.strip().lower()
    s = re.sub(r"^[^a-z0-9]+", "", s)
    for pat in LEADINS:
        s = re.sub(pat, "", s)
    s = re.sub(r"[^a-z0-9' -]", "", s)
    return " ".join(s.split())

def derive(text, used):
    # Primary candidates: clauses with at least 3 content words.
    # Secondary candidates: any cleaned clause with at least 2
    # words, so a short verse like Romans 8:31 ("If God is for
    # us") still gets a real clause, not a fallback word salad.
    # A duplicate angle is skipped in favour of the next clause,
    # so John 3:3 and 3:5 do not both become "most certainly".
    clauses = re.split(r"[,?;:.!]", text)
    primary, secondary = [], []
    for clause in clauses:
        c = clean_clause(clause)
        words = c.split()
        if not words:
            continue
        content = [w for w in words if w not in STOP]
        entry = (" ".join(words[:8]), f"verse text clause: '{clause.strip()}'")
        if len(content) >= 3:
            primary.append(entry)
        if len(words) >= 2:
            secondary.append(entry)
    # Secondary candidates are ranked by content-word count, so
    # "if god is for us" beats a leftover fragment like
    # "these things", which has no content word at all.
    def content_count(angle):
        return len([w for w in angle.split() if w not in STOP])
    secondary_sorted = sorted(secondary, key=lambda e: -content_count(e[0]))
    for angle, source in primary + secondary_sorted:
        if angle not in used:
            return angle, source
    if primary:
        return primary[0][0], primary[0][1] + " (duplicate angle, next clause did not give a distinct one)"
    words = [w for w in re.sub(r"[^a-z0-9' -]", "", text.lower()).split() if w not in STOP]
    return " ".join(words[:4]), "fallback: first content words of verse text"

def main():
    if len(sys.argv) not in (2, 3):
        print("usage: derive_angles.py <refs_csv> [phos_bundle.json]", file=sys.stderr)
        return 2
    refs = sys.argv[1].split(",")
    bundle = None
    if len(sys.argv) == 3:
        bundle = {v["reference"]: v for v in json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")).get("verses", [])}
    from phos_context import BOOKS
    out = {"refs": refs, "angles": [], "detail": []}
    used = set()
    for ref in refs:
        if bundle and ref in bundle:
            text = bundle[ref]["text"]
            lex = [f"{w['transliteration']} means {w['gloss']}" for w in bundle[ref].get("lexicon", [])]
        else:
            code = ref.split(" ", 1)[0]
            if code in BOOKS:
                store_path = ROOT / BOOKS[code][5]
            else:
                # Fallback, Oct 31, 2026: a book ingested by
                # generate_from_plan may not be in the Phos map
                # yet. Verse text from the verified store is
                # still a verbatim angle source, lexicon is
                # evidence only, so this does not invent doctrine.
                store_path = ROOT / f"data/bsb-{code}.json"
            if not store_path.exists():
                print(f"No verse store for {code}, cannot derive an angle, do not invent one.", file=sys.stderr)
                return 2
            store = json.loads(store_path.read_text(encoding="utf-8"))
            # v28, Nov 5, 2026: a range is one passage unit,
            # so its text is the joined text of its verses.
            # A single verse returns its own text.
            _m = re.match(r"^([A-Z0-9]+) (\d+):(\d+)(?:-(\d+))?$", str(ref or "").strip())
            if _m and _m.group(4):
                _parts = [store.get(f"{_m.group(1)} {_m.group(2)}:{v}", "") for v in range(int(_m.group(3)), int(_m.group(4)) + 1)]
                text = " ".join(_parts) if all(_parts) else ""
            else:
                text = store.get(ref, "")
            lex = []
        if not text:
            print(f"No verse text for {ref}, cannot derive an angle.", file=sys.stderr)
            return 2
        angle, source = derive(text, used)
        used.add(angle)
        out["angles"].append(angle)
        out["detail"].append({"reference": ref, "angle": angle, "source": source, "lexicon": lex})
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
