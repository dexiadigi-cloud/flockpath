#!/usr/bin/env python3
"""Build the Viz.Bible Phase 2 test pack (not a shipped pack).

Copies data/test-places-pack-20261119.json, replaces its placesNote
with the places from output/test-names-bundle-20261119.json, and adds
a namesNote built in the exact generate_sections.py shape (Hitchcock
meaning first, one TIPNR family link, verse). The pack has 5 days:
EXO 4:14, MAT 2:1, LUK 2:4, JHN 11:1, ACT 2:5.
"""
import json
from pathlib import Path

ROOT = Path("/home/hatch/workspace/flockpath")
pack = json.loads((ROOT / "data/test-places-pack-20261119.json").read_text())
bundle = json.loads(
    (ROOT / "output/test-names-bundle-20261119.json").read_text())

pack["id"] = "test-names-20261119"
pack["title"] = "TEST PACK - Names rendering check"

pack["placesNote"] = {
    "places": [{
        "name": p["name"],
        "modern_name": p.get("modern_name"),
        "confidence": p["confidence"],
        "verse": p["verse"],
    } for p in bundle.get("places", [])],
    "source": "Place data courtesy of OpenBible.info, "
              "licensed under CC BY 4.0.",
}


def family_note(name):
    links = name.get("family_links") or {}
    for key, label in (
            ("siblings", "sibling of"),
            ("parents", "child of"),
            ("partners", "partner of"),
            ("offspring", "parent of"),
            ("founder", "founded by")):
        vals = links.get(key) or []
        if vals:
            return f"{label} {str(vals[0]).split('@', 1)[0]}"
    return None


pack["namesNote"] = {
    "names": [{
        "name": n["name"],
        "kind": n["kind"],
        "meaning": n.get("meaning"),
        "family_note": family_note(n),
        "verse": n["verse"],
    } for n in bundle.get("names", [])],
    "source": "Proper names: STEP Bible (www.STEPBible.org), CC BY 4.0.",
}

out = ROOT / "data/test-names-pack-20261119.json"
out.write_text(json.dumps(pack, ensure_ascii=False, indent=1),
               encoding="utf-8")
print(f"wrote {out}")
print("places:", [p["name"] for p in pack["placesNote"]["places"]])
print("names:", json.dumps(pack["namesNote"], indent=1, ensure_ascii=False))
