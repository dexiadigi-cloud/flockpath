#!/usr/bin/env python3
"""Build the Viz.Bible bundle-rebuild test pack (not a shipped pack).

Copies data/test-names-pack-20261119.json (which already carries the
5-day structure EXO 4:14, MAT 2:1, LUK 2:4, JHN 11:1, ACT 2:5) and
replaces its placesNote/namesNote with the notes from a bundle built
against the REBUILT data/phos.db (no FLOCKPATH_PHOS_DB override).
The notes are built in the exact generate_sections.py shape
(Hitchcock meaning first, one TIPNR family link, verse).
"""
import json
from pathlib import Path

ROOT = Path("/home/hatch/workspace/flockpath")
pack = json.loads((ROOT / "data/test-names-pack-20261119.json").read_text())
bundle = json.loads(Path("/tmp/bundle-rebuilt.json").read_text())

pack["id"] = "test-bundle-20261119"
pack["title"] = "TEST PACK - Bundle rebuild check"

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

out = ROOT / "data/test-bundle-pack-20261119.json"
out.write_text(json.dumps(pack, ensure_ascii=False, indent=1),
               encoding="utf-8")
print(f"wrote {out}")
print("places:", [p["name"] for p in pack["placesNote"]["places"]])
print("names:", [n["name"] for n in pack["namesNote"]["names"]])
