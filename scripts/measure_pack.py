#!/usr/bin/env python3
"""Measure a Flockpath generation run, not judge it anecdotally.

Usage:
  python3 scripts/measure_pack.py <attempts.jsonl|log.json> [draft.json]

Attempts file: one JSON record per length attempt, from
flockpath-mac-4b-test-v17.py or scripts/generate_sections.py,
with fields section, kind, attempt, words, issues, issue_text.
v19: a single log JSON, flockpath-mac-4b-v19-log.json, with
an "attempts" list, is also accepted, same measurement.

Output: per-field first-pass, repair, and escalation rates.
First-pass = attempt 1 had 0 issues.
Repair = attempt 1 had issues, a later attempt had 0.
Escalation = all attempts had issues, best attempt kept.
A field with 1 attempt and 0 issues is first-pass.
A field with 1 attempt and issues is escalation, not repair,
because no repair attempt was recorded.

If draft.json is given, final draft flags are also printed:
adult body and prayer bands, kid retelling band, kid title
fallback, leader note band and count, chorus lines.
This lets a v17 run be compared to v16 final counts,
even though v16 had no attempt log.
"""
import json
import sys
from collections import defaultdict


def main():
    if len(sys.argv) < 2:
        print("usage: measure_pack.py <attempts.jsonl> [draft.json]")
        return 2
    attempts_path = sys.argv[1]
    records = []
    with open(attempts_path, encoding="utf-8") as f:
        content = f.read()
    # v19: single log JSON, with an "attempts" list, or
    # the older JSONL format, one record per line.
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict) and isinstance(parsed.get("attempts"), list):
            records = parsed["attempts"]
        else:
            records = []
    except Exception:
        for line in content.splitlines():
            line = line.strip()
            if line:
                records.append(json.loads(line))
    if not records:
        print("No attempt records found. Dry-run files are empty, by design.")
        return 0
    by_field = defaultdict(list)
    for r in records:
        by_field[r.get("section", "unknown")].append(r)
    total = first = repair = escalation = 0
    print("Per-field rates (first-pass / repair / escalation):")
    for section in sorted(by_field):
        recs = sorted(by_field[section], key=lambda x: x.get("attempt", 0))
        total += 1
        first_ok = recs[0].get("issues", 0) == 0
        any_ok = any(r.get("issues", 0) == 0 for r in recs)
        if first_ok:
            first += 1
            status = "first-pass"
        elif any_ok:
            repair += 1
            status = "repair"
        else:
            escalation += 1
            status = "escalation"
        words = " -> ".join(str(r.get("words", 0)) for r in recs)
        print(f"  {section}: {status}, words {words}, attempts {len(recs)}")
    print(f"Total fields: {total}, first-pass {first} ({first/total:.0%}), repair {repair} ({repair/total:.0%}), escalation {escalation} ({escalation/total:.0%})")
    if escalation and escalation / total > 1 / 3:
        print("Escalation over 1 in 3: per the research, the schema or split for those fields is wrong, not the pastor's patience. Do not prompt harder, fix the split or the band.")
    if len(sys.argv) >= 3:
        draft = json.loads(open(sys.argv[2], encoding="utf-8").read())
        print("\nFinal draft flags:")
        for a in draft.get("adultDevotionals", []):
            bw = len((a.get("body") or "").split())
            pw = len((a.get("prayer") or "").split())
            flags = []
            if bw < 160 or bw > 250:
                flags.append(f"body {bw} outside 160-250")
            if pw < 30 or pw > 40:
                flags.append(f"prayer {pw} outside 30-40")
            if a.get("title") == a.get("scripture", {}).get("reference"):
                flags.append("title fallback")
            print(f"  Adult {a.get('day')}: {'; '.join(flags) if flags else 'ok'}")
        for k in draft.get("kidDevotionals", []):
            rw = len((k.get("retelling") or "").split())
            flags = []
            if rw < 80 or rw > 120:
                flags.append(f"retelling {rw} outside 80-120")
            if k.get("title") in [d.get("scripture", {}).get("reference") for d in draft.get("adultDevotionals", [])]:
                flags.append("title fallback")
            print(f"  Kid {k.get('day')}: {'; '.join(flags) if flags else 'ok'}")
        qs = draft.get("leaderQuestions", [])
        print(f"  Leader: {len(qs)} questions, notes {[len((q.get('leaderNote') or '').split()) for q in qs]}")
        ch = draft.get("chorus", {})
        print(f"  Chorus: {len([l for l in (ch.get('chordPro') or '').splitlines() if l.strip()])} lines, title {ch.get('title')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
