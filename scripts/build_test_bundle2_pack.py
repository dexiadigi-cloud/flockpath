#!/usr/bin/env python3
"""Build the bundle-rebuild-2 test pack (not a shipped pack).

Same pattern as scripts/build_test_topics_pack.py, but the topicsNote
is built from the bundle produced against the REBUILT data/phos.db
(/tmp/bundle-rebuilt2-topics.json) instead of the live-DB bundle.
Verifies topics render from the rebuilt shipped bundle itself.
Pack: 5 days MAT 6:25, 6:26, 6:27, 6:33, 6:34, topic "anxiety".
placesNote/namesNote are dropped so the topics rendering is isolated.
"""
import json
import textwrap
from pathlib import Path

ROOT = Path("/home/hatch/workspace/flockpath")
pack = json.loads((ROOT / "data/test-places-pack-20261119.json").read_text())
bundle = json.loads(Path("/tmp/bundle-rebuilt2-topics.json").read_text())

pack["id"] = "test-bundle2-topics-20261119"
pack["title"] = "TEST PACK - Bundle rebuild 2 topics rendering check"
pack["passage"] = "Matthew 6:25, 6:26, 6:27, 6:33, 6:34"
pack["memoryVerse"] = {"reference": "Philippians 4:6-7"}

days = [
    ("Monday", "Do Not Worry", "MAT 6:25",
     "Jesus tells us not to worry about our life, what we will eat or drink.",
     "Jesus says: do not worry about your life.",
     "Draw a bird and write: God feeds the birds."),
    ("Tuesday", "Birds of the Air", "MAT 6:26",
     "Our heavenly Father feeds the birds of the air, and we matter more to Him.",
     "God feeds the birds, and He cares for you.",
     "Draw a bird in the sky."),
    ("Wednesday", "Worry Adds Nothing", "MAT 6:27",
     "Worrying cannot add a single hour to our life.",
     "Worrying does not help; trusting God does.",
     "Draw a clock and write: trust God."),
    ("Thursday", "Seek First", "MAT 6:33",
     "Seek first the kingdom of God and His righteousness.",
     "Put God first, and He provides.",
     "Draw a crown and write: God first."),
    ("Friday", "Enough for Today", "MAT 6:34",
     "Do not worry about tomorrow; today has enough trouble of its own.",
     "Today is enough; God is with us today.",
     "Draw a sun and write: today."),
]
pack["adultDevotionals"] = [{
    "day": day, "title": title,
    "scripture": {"reference": ref},
    "body": body,
    "prayer": "Thank you, God, for caring for us. Amen.",
} for day, title, ref, body, _ret, _act in days]
pack["kidDevotionals"] = [{
    "day": day, "title": title,
    "retelling": ret, "activity": act,
} for day, title, _ref, _body, ret, act in days]
pack["leaderQuestions"] = [
    {"question": "What does Jesus say about worry in this week's passage?",
     "leaderNote": "Use the Background - topics note on the leader page."},
    {"question": "Which supporting verse speaks most to your family this week?",
     "leaderNote": "Pick one verse from the Background - topics note."},
]
pack.pop("placesNote", None)
pack.pop("namesNote", None)

# Execute the exact topicsNote block from generate_sections.py
# (not a copy of it) against the real bundle.
src = (ROOT / "scripts/generate_sections.py").read_text().splitlines()
start = next(i for i, line in enumerate(src)
             if line.strip() == "if phos_topics:")
end = start + 1
while src[end] != "        }":
    end += 1
block = textwrap.dedent("\n".join(src[start:end + 1]))
assert "topicsNote" in block and "Topical data: OpenBible.info" in block, block
ns = {"phos_topics": bundle.get("topics", [])[:3],
      "phos_topic": bundle.get("topics_topic", ""),
      "draft": {}}
exec(compile(block, "generate_sections.py topicsNote block", "exec"), ns)
pack.update(ns["draft"])

out = ROOT / "data/test-bundle2-topics-pack-20261119.json"
out.write_text(json.dumps(pack, ensure_ascii=False, indent=1),
               encoding="utf-8")
print(f"wrote {out}")
print("topicsNote:", json.dumps(pack["topicsNote"], indent=1,
                                ensure_ascii=False))
