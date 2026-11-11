"""Step 2 proof: cleaned Genesis store + exact-match verifier.

Pass criteria, all must hold:
  1. Genesis verse count matches the independent usfm2dict count (1,533).
  2. No cleaned verse contains a leftover USFM marker, strong=, or \\f.
  3. GEN 1:1 verifies exactly as quoted from the cleaned store.
  4. A one-word tamper of GEN 1:1 FAILS verification (publish blocked).
  5. An unknown reference FAILS verification (fails closed).
  6. Spot-checks from other books, cleaned with the same function:
     John 3:16 and Psalm 23:1 from the same engwebp pack.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verse_store import clean_verse, load_book_from_zip, parse_usfm, verify

root = Path(__file__).resolve().parent.parent
pack = Path.home() / "workspace/sunday-table-bible-packs/usfm/engwebp_usfm.zip"
genesis = json.loads((root / "data/engwebp-GEN.json").read_text(encoding="utf-8"))

checks = []
def check(name, ok, detail=""):
    checks.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

check("Genesis count = 1,533", len(genesis) == 1533, f"(got {len(genesis)})")
bad = [k for k, v in genesis.items() if "\\" in v or "strong=" in v or "|strong" in v]
check("No leftover USFM markers in Genesis", not bad, f"(bad: {bad[:3]})")

gen11 = genesis.get("GEN 1:1")
print(f"GEN 1:1 stored: {gen11}")
check("GEN 1:1 exact match verifies", verify(genesis, "GEN 1:1", gen11))
check("GEN 1:1 tampered (earth->world) fails",
      not verify(genesis, "GEN 1:1", gen11.replace("earth", "world")))
check("Unknown reference fails closed",
      not verify(genesis, "GEN 99:99", "anything"))

jhn = load_book_from_zip(pack, "73-JHNengwebp.usfm", "JHN")
print(f"JHN 3:16 stored: {jhn.get('JHN 3:16')}")
check("JHN 3:16 exact match verifies", verify(jhn, "JHN 3:16", jhn.get("JHN 3:16")))
check("JHN 3:16 tampered (loved->liked) fails",
      not verify(jhn, "JHN 3:16", jhn.get("JHN 3:16").replace("loved", "liked")))

psa = load_book_from_zip(pack, "20-PSAengwebp.usfm", "PSA")
print(f"PSA 23:1 stored: {psa.get('PSA 23:1')}")
check("PSA 23:1 exact match verifies", verify(psa, "PSA 23:1", psa.get("PSA 23:1")))
check("PSA 23:1 equals known WEB text",
      psa.get("PSA 23:1") == "The LORD is my shepherd; I shall lack nothing.")

print(f"\n{sum(checks)}/{len(checks)} checks passed")
sys.exit(0 if all(checks) else 1)
