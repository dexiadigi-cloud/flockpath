"""Generation progress file, Nov 3, 2026.

The pipeline writes one small JSON file while a pack
generates, so the app can show the pastor the current step
("Step 6 of 14: Building Wednesday") instead of a bare
"running". Writes are atomic (temp file + replace), so the
app never reads a half-written file. A failed write never
fails a section: callers swallow errors.
"""
import json
from pathlib import Path


def write_progress(path, step, total, label):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"step": step, "total": total, "label": label}), encoding="utf-8")
    tmp.replace(path)
