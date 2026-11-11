"""Generic local generation test for Step 7 critique.

Usage: .venv/bin/python scripts/generate_test.py PSA23 data/engwebp-PSA.json "Psalm 23" "PSA 23:1,PSA 23:2,PSA 23:3,PSA 23:4,PSA 23:6" "Shepherd care,Green pastures,Restored soul,Valley with God,Goodness follows" data/test-psa23-draft.json

Same rules as generate_local.py: references only, never verse text.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def main():
    if len(sys.argv) != 7:
        print("usage: generate_test.py <tag> <store.json> <passage> <refs_csv> <angles_csv> <out.json>", file=sys.stderr)
        return 2
    tag, store_path, passage, refs_csv, angles_csv, out = sys.argv[1:7]
    refs = refs_csv.split(",")
    angles = angles_csv.split(",")
    assert len(refs) == 5 and len(angles) == 5
    plan = "\n".join(f"- {d}: reference {r}, angle: {a}" for d, r, a in zip(
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], refs, angles))
    prompt = "\n".join([
        "You are writing a family discipleship pack for a church.",
        "Output JSON ONLY, no markdown, no explanation.",
        "The pack must have exactly 5 adult devotionals (Monday-Friday) and exactly 5 kid versions (ages 6-10).",
        "For Scripture, output ONLY the reference, like {\"reference\": \"" + refs[0] + "\"}.",
        "NEVER write out Scripture text yourself. NEVER invent a verse.",
        f"Use ONLY these references for Scripture citations: {', '.join(refs)}.",
        "Day plan, assigned by the system. Follow it exactly, one distinct verse and angle per day, no repeats:",
        plan,
        "Do NOT choose your own verses. Do NOT reuse a verse on another day.",
        "Kid versions must be retellings in plain words for ages 6-10, not quotes.",
        "The chorus must be original, short, and singable, with chords in ChordPro format.",
        "The coloring entry must use svgTemplateId \"creation-sky-sea\".",
        "Leader questions: 5 questions for a small group, with short leader notes.",
        f"Passage: {passage}",
        "JSON shape: {\"id\": \"" + tag + "\", \"title\": \"...\", \"passage\": \"" + passage + "\", \"pastorName\": \"Sample Pastor\", \"church\": \"Sample Church\", \"memoryVerse\": {\"reference\": \"" + refs[0] + "\"}, \"adultDevotionals\": [{\"day\": \"Monday\", \"title\": \"...\", \"scripture\": {\"reference\": \"" + refs[0] + "\"}, \"body\": \"...\", \"prayer\": \"...\"}], \"kidDevotionals\": [{\"day\": \"Monday\", \"title\": \"...\", \"retelling\": \"...\", \"activity\": \"...\"}], \"leaderQuestions\": [{\"question\": \"...\", \"leaderNote\": \"...\"}], \"chorus\": {\"title\": \"...\", \"original\": true, \"chordPro\": \"...\"}, \"coloring\": {\"title\": \"...\", \"description\": \"...\", \"svgTemplateId\": \"creation-sky-sea\"}}",
    ])
    from llama_cpp import Llama
    llm = Llama(model_path=str(ROOT / "models/Qwen3-1.7B-Q4_K_M.gguf"), n_ctx=8192, n_threads=4, verbose=False)
    out_obj = llm.create_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3, max_tokens=4000, repeat_penalty=1.15,
    )
    text = out_obj["choices"][0]["message"]["content"]
    # Critique fix, applied during testing: always save the raw
    # output before parsing, so a JSON failure can be diagnosed
    # instead of vanishing. The original script lost both failures.
    Path("data/test-raw-last.txt").write_text(text, encoding="utf-8")
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        print("No JSON found in model output", file=sys.stderr)
        print(text[:1000], file=sys.stderr)
        return 1
    draft = json.loads(text[start:end + 1])
    Path(out).write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {out}")
    print("Adult refs:", [d["scripture"]["reference"] for d in draft.get("adultDevotionals", [])])
    print("Adult titles:", [d["title"] for d in draft.get("adultDevotionals", [])])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
