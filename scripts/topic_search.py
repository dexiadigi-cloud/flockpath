"""Step 7.5 Phase D, step 4: topic-to-passage search via Phos.

A topic alone does not generate a pack. This script is what
happens before generation when the pastor gives only a topic:
search Phos study material for that word, and return
passages that Phos itself anchors to, for the pastor to pick.
The model never invents a passage, and the tool never
pretends a keyword match is a theological match.

Sources, in order:
1. Devotionals with an anchor_ref. A devotional whose title
   or body contains the topic word, anchored to a verse,
   is a passage suggestion. Ranked by how many devotionals
   anchor to that verse, then by source (Spurgeon and
   My Utmost first, as the most-used devotional sources).
2. Dictionaries (Easton, ISBE, Nave, Torrey). A term match
   gives a definition excerpt, not a passage, so it is
   returned as supporting reading only, never as a day verse.

If no devotional anchors to the topic word, the script
says so, with the exact word searched. It does not fall
back to a generic passage, and it does not broaden the
search silently to synonyms the pastor did not give.

Usage:
  python3 scripts/topic_search.py grace
  python3 scripts/topic_search.py shepherd
  python3 scripts/topic_search.py creation
"""
import re
import sqlite3

# Nov 3, 2026, permanent cut-off fix: dictionary snippets use the
# same clean_excerpt as the pack bundle, so no snippet shown to
# a pastor can end mid-word. phos_context is import-safe: its
# work runs under its __main__ guard.
# Nov 3, 2026, Mac test package: the database path also comes
# from phos_context now, so topic search follows the same
# resolution (pointer, app phos.db, legacy VM path) as the
# bundle builder instead of hardcoding the VM path.
from phos_context import clean_excerpt, PHOS_DB, require_phos_db
import sys
from collections import Counter
from pathlib import Path

# Curated topical lists (Torrey, Nave) are better than keyword
# matches: they list verses FOR a topic, not verses that merely
# mention the word. The first version of this script ranked
# devotional keyword matches only, and it was noisy: "grace"
# topped out at 2 Peter 1:4, "creation" gave Acts 2:4 and
# 1 Chronicles 9:33. This version ranks dictionary topical
# refs first, devotional anchors second, and says which is which.
from extract_refs import extract as extract_refs

def main():
    # Overnight Oct 31, 2026: --json added for the /input API route.
    # Default text output is unchanged, so existing callers keep working.
    args = [a for a in sys.argv[1:] if a != "--json"]
    as_json = "--json" in sys.argv[1:]
    if len(args) != 1:
        print("usage: topic_search.py [--json] <topic-word>", file=sys.stderr)
        return 2
    topic = args[0].lower()
    con = sqlite3.connect(require_phos_db())
    # 0. Curated topical lists first: dictionary entries whose
    # term matches the topic, with verse refs extracted from
    # their text. Torrey and Nave list verses by topic.
    # Nov 4, 2026, topic-search recall (Mac test item 11):
    # the old term match was LIKE %topic%, a substring, so
    # a search for "love" matched CLOVEN, GLOVE, FOXGLOVE,
    # and BELOVED, 63 entries, most of them noise, while
    # the real love entries' refs were then cut to the top
    # 10 by count. Now a term counts only when the topic
    # appears as a whole word in it (a trailing plural s
    # allowed, so "blessings" still answers "blessing"),
    # and both result lists show the top 25, not 10.
    def term_matches(term):
        words = re.split(r"[^a-z0-9]+", term.lower())
        return topic in words or (topic + "s") in words
    dict_rows = con.execute(
        "SELECT source_id, term, text FROM dictionaries WHERE lower(term) LIKE ?",
        (f"%{topic}%",)).fetchall()
    dict_rows = [r for r in dict_rows if term_matches(r[1])]
    topical = Counter()
    for source, term, text in dict_rows:
        for ref in extract_refs(text)["verse_refs"]:
            topical[ref] += 1
    if as_json:
        import json as _json
        rows = con.execute(
            "SELECT source_id, title, anchor_ref FROM devotionals "
            "WHERE (lower(title) LIKE ? OR lower(body) LIKE ?) AND anchor_ref IS NOT NULL AND anchor_ref != ''",
            (f"%{topic}%", f"%{topic}%")).fetchall()
        counts = Counter(r[2] for r in rows)
        examples = {}
        for source, title, anchor in rows:
            examples.setdefault(anchor, (source, title))
        print(_json.dumps({
            "topic": topic,
            "topical": [{"reference": r, "count": n} for r, n in topical.most_common(25)],
            "devotionalAnchors": [{"reference": a, "count": n, "example": f"{examples[a][0]}: {examples[a][1]}"} for a, n in counts.most_common(25)],
            "message": "Curated topical refs first, devotional anchors second. A topic alone never generates a pack, the pastor picks refs.",
        }, ensure_ascii=False))
        return 0
    print(f"Topic: {topic}")
    print(f"Topical list passages (from dictionary texts, curated, not keyword count): {len(topical)}")
    for ref, n in topical.most_common(25):
        print(f"  {ref} - in {n} dictionary entr{'y' if n == 1 else 'ies'}")
    if not topical:
        print("  (none - no dictionary entry lists verses for this word)")
    # Devotionals: title or body contains topic, with anchor
    rows = con.execute(
        "SELECT source_id, title, anchor_ref FROM devotionals "
        "WHERE (lower(title) LIKE ? OR lower(body) LIKE ?) AND anchor_ref IS NOT NULL AND anchor_ref != ''",
        (f"%{topic}%", f"%{topic}%")).fetchall()
    counts = Counter(r[2] for r in rows)
    examples = {}
    for source, title, anchor in rows:
        examples.setdefault(anchor, (source, title))
    print(f"Devotional keyword matches (secondary, noisy): {len(rows)}, distinct anchor passages: {len(counts)}")
    if not counts:
        print("No passage found for this topic in Phos devotionals. Give a verse list or sermon paste instead.")
        return 0
    for anchor, n in counts.most_common(25):
        source, title = examples[anchor]
        print(f"  {anchor} - {n} devotional(s), e.g. {source}: {title}")
    # Dictionary terms, supporting only, same whole-word
    # filter as the topical list, so the supporting terms
    # shown are the ones that actually answered the topic.
    dicts = [r for r in con.execute(
        "SELECT source_id, term, text FROM dictionaries WHERE lower(term) LIKE ?",
        (f"%{topic}%",)).fetchall() if term_matches(r[1])][:5]
    print(f"Dictionary terms: {len(dicts)}")
    for source, term, text in dicts:
        print(f"  {source}: {term} - {clean_excerpt(text, 200)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
