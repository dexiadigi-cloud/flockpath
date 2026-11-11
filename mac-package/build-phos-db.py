#!/usr/bin/env python3
"""Build the trimmed Phos database for the Mac test package.

Copies only the tables the Flockpath app actually queries
(sources, crossrefs, commentaries, interlinear_words, lexicon,
devotionals, dictionaries) from the full study.db, with their
schema and indexes, then vacuums. The app reads this file as
data/phos.db, so the Mac package never needs the full Phos
database or the VM's workspace path.

Usage: python3 mac-package/build-phos-db.py [output-path]
Default output: output/mac-packages/phos.db
Re-measuring note (Nov 3, 2026): the trimmed file must be
rebuilt whenever Phos gains tables the app queries, and the
bundle outputs must be diffed against the full database
before any package ships with it.
"""
import sqlite3
import sys
from pathlib import Path

TABLES = ["sources", "crossrefs", "commentaries",
          "interlinear_words", "lexicon", "devotionals", "dictionaries"]
SRC = Path.home() / "workspace" / "scripture-desk" / "data" / "study.db"
DST = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/mac-packages/phos.db")

if not SRC.is_file():
    raise SystemExit(f"Source database not found: {SRC}")
DST.parent.mkdir(parents=True, exist_ok=True)
if DST.exists():
    DST.unlink()

src = sqlite3.connect(f"file:{SRC}?mode=ro", uri=True)
schema = src.execute(
    "SELECT type, name, sql FROM sqlite_master "
    "WHERE sql NOT NULL AND name NOT LIKE 'sqlite_%' "
    "ORDER BY CASE WHEN type = 'table' THEN 0 ELSE 1 END, name").fetchall()
dst = sqlite3.connect(DST)
dst.execute(f"ATTACH '{SRC}' AS src")
kept = []
for typ, name, sql in schema:
    if typ == "table" and name in TABLES:
        dst.execute(sql)
        kept.append(name)
    elif typ == "index":
        owner = src.execute(
            "SELECT tbl_name FROM sqlite_master WHERE type='index' AND name=?",
            (name,)).fetchone()
        if owner and owner[0] in TABLES:
            dst.execute(sql)
for table in TABLES:
    dst.execute(f"INSERT INTO {table} SELECT * FROM src.{table}")
dst.commit()
dst.execute("VACUUM")
dst.commit()
print("tables:", ", ".join(kept))
for table in TABLES:
    full = src.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    trim = dst.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    status = "OK" if full == trim else "MISMATCH"
    print(f"{table}: full={full} trimmed={trim} {status}")
    assert full == trim, f"row count mismatch on {table}"
integrity = dst.execute("PRAGMA integrity_check").fetchone()[0]
print("integrity:", integrity)
assert integrity == "ok"
print(f"wrote {DST} ({DST.stat().st_size:,} bytes)")
