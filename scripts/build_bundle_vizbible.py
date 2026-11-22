#!/usr/bin/env python3
"""Build the Flockpath shipped bundle (data/phos.db) from the live Phos DB.

Viz.Bible bundle rebuild, Nov 19, 2026. Approved by Jeremiah Nov 19,
2026 ("Yes, rebuild the bundle").

Pattern: same as the v58 bundle - a trimmed copy holding exactly the
tables scripts/phos_context.py actually queries, plus the tables the
Viz.Bible phases added for it. No trim script existed for v58, so this
script IS the build record; re-run it for the next rebuild.

Tables copied from the live DB (~/workspace/scripture-desk/data/study.db):
  v58 tables (7): sources, crossrefs, commentaries, interlinear_words,
    lexicon, devotionals, dictionaries.
  Viz.Bible tables (7): places, place_verses, proper_names,
    proper_name_verses, morphology_codes_hebrew, morphology_codes_greek,
    topics_openbible (added in rebuild 2, Nov 19, 2026, Phase 3).

Deliberately NOT copied (v58 pattern): encyclopedias, sermons,
theology, creeds, fathers, liturgy, strongs, synonyms, and the
per-table *_sources companion tables (places_sources, names_sources,
morphology_sources, dictionary_sources, lexicon_sources, etc.).
The bundle builder never queries those; the sources table itself
carries the attribution rows.

Deliberate exclusion, Nov 18 user decision: Rashi on Genesis
(source_id rashi_genesis, 1,027 commentary rows, sensitivity
"context-only") was decided "context-only, NOT in any Flockpath
rotation/bundle". The bundle builder's filter only drops sensitivity
"opt-in", so Rashi rows would pass into packs if copied. They are
excluded from BOTH commentaries and sources in this bundle.
Consequence, stated plainly: bundle commentaries = live 102,133
minus 1,027 Rashi = 101,106; bundle sources = live 100 minus
rashi_genesis = 99 (rebuild 2, Nov 19, 2026: live sources grew
99 -> 100 with Phase 3 openbible_topical). Every other included
table matches the live DB exactly.

Schema and indexes are copied from the live DB (including the
dictionaries greek_term columns added Nov 18 by the Abbott-Smith
merge - the bundle builder selects explicit columns, so the extra
columns are inert there).

Usage: python3 scripts/build_bundle_vizbible.py <staging-out.db>
Exits non-zero if any expected count is wrong.
"""
import sqlite3
import sys
from pathlib import Path

LIVE = Path("/home/hatch/workspace/scripture-desk/data/study.db")
TABLES = [
    "sources", "crossrefs", "commentaries", "interlinear_words",
    "lexicon", "devotionals", "dictionaries",
    "places", "place_verses", "proper_names", "proper_name_verses",
    "morphology_codes_hebrew", "morphology_codes_greek",
    "topics_openbible",
]
# Expected row counts in the NEW bundle (live counts, minus Rashi).
EXPECTED = {
    "sources": 99,
    "crossrefs": 573192,
    "commentaries": 101106,
    "interlinear_words": 447748,
    "lexicon": 55685,
    "devotionals": 2330,
    "dictionaries": 146174,
    "places": 1342,
    "place_verses": 7600,
    "proper_names": 4237,
    # Nov 20, 2026, v62: was 31768, then 31766 after the two
    # false Javan/Judah -> Romans 3:9 rows were deleted from
    # the live DB (item 11). Now 31482: the same-class scan
    # (output/v62-names-scan.py) found 284 more false rows
    # for the same two names -- verses where no form of the
    # name occurs (216) or only a common-noun form occurs
    # ("Jew"/"Jewish"/"Greek"/"Grecian"/"Hebrew", 68) -- and
    # those were deleted too. Javan keeps 4 true rows, Judah
    # 763. Other names' false-class rows (3,244) are NOT
    # deleted in this batch: mixed categories (plurals,
    # divine-name stoplist), and the v61 selection guard
    # already blocks false citations from them.
    "proper_name_verses": 31482,
    "morphology_codes_hebrew": 1013,
    "morphology_codes_greek": 1730,
    "topics_openbible": 1112,
}


def main() -> int:
    out = Path(sys.argv[1])
    if out.exists():
        print(f"refusing to overwrite existing {out}", file=sys.stderr)
        return 2
    live = sqlite3.connect(f"file:{LIVE}?mode=ro", uri=True)
    new = sqlite3.connect(out)
    new.execute("PRAGMA journal_mode=DELETE")
    new.execute("ATTACH DATABASE ? AS live", (str(LIVE),))
    for table in TABLES:
        sql = live.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (table,)).fetchone()[0]
        new.execute(sql)
        if table in ("commentaries", "sources"):
            new.execute(
                f"INSERT INTO {table} SELECT * FROM live.{table} "
                "WHERE source_id != 'rashi_genesis'")
        else:
            new.execute(f"INSERT INTO {table} SELECT * FROM live.{table}")
    # Indexes for the copied tables, exactly as in the live DB
    # (autoindexes from PK/UNIQUE constraints are created by the
    # table definitions themselves and are skipped here).
    for (name, tbl, sql) in live.execute(
            "SELECT name, tbl_name, sql FROM sqlite_master "
            "WHERE type='index' AND sql IS NOT NULL ORDER BY tbl_name, name"):
        if tbl in TABLES:
            new.execute(sql)
    new.commit()
    bad = []
    for table, want in EXPECTED.items():
        got = new.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        print(f"{table}: {got} (expected {want})")
        if got != want:
            bad.append(table)
    new.execute("VACUUM")
    new.commit()
    new.close()
    live.close()
    if bad:
        print(f"COUNT MISMATCH: {bad}", file=sys.stderr)
        return 1
    print(f"built {out} OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
