"""Repair one day of a draft, without touching the good days.

Reads data/generated-pack-draft.json, finds the day that failed
checkQuality (here: Friday, reused GEN 1:1), asks the local model
for ONLY that day with a new assigned reference and angle, splices
it back in, and writes data/generated-pack-draft-v2.json.

The pastor never sees the broken version. The system fixes it,
then the quality gate runs again before anything is shown.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PROMPT = "\n".join([
    "Rewrite ONE devotional day. Output JSON ONLY, no markdown, no explanation.",
    "Day: Friday. Scripture reference: GEN 2:3. Angle for this day, and only this angle: Blessed rest, God blessed the seventh day and made it holy.",
    "For Scripture, output ONLY the reference, never the verse text.",
    "Problems with the previous version that you must fix: Repeated Scripture reference: GEN 1:1 - each day must use a different verse. Do not use GEN 1:1 again. Do not reuse Monday's title or opening.",
    "The new body must start differently from every other day, and must not repeat another day's ideas.",
    'JSON shape: {"day": "Friday", "title": "...", "scripture": {"reference": "GEN 2:3"}, "body": "...", "prayer": "...", "kid": {"day": "Friday", "title": "...", "retelling": "...", "activity": "..."}}',
])

def main():
    from llama_cpp import Llama
    draft = json.loads((ROOT / "data/generated-pack-draft.json").read_text(encoding="utf-8"))
    llm = Llama(model_path=str(ROOT / "models/Qwen3-1.7B-Q4_K_M.gguf"), n_ctx=4096, n_threads=4, verbose=False)
    out = llm.create_chat_completion(
        messages=[{"role": "user", "content": PROMPT}],
        temperature=0.3, max_tokens=1200, repeat_penalty=1.15,
    )
    text = out["choices"][0]["message"]["content"]
    print("Raw repair output:")
    print(text[:1000])
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        print("No JSON found", file=sys.stderr)
        return 1
    day = json.loads(text[start:end + 1])
    assert day["day"] == "Friday", day.get("day")
    assert day["scripture"]["reference"] == "GEN 2:3", day["scripture"]
    draft["adultDevotionals"] = [d if d["day"] != "Friday" else {
        "day": day["day"], "title": day["title"], "scripture": day["scripture"],
        "body": day["body"], "prayer": day["prayer"],
    } for d in draft["adultDevotionals"]]
    draft["kidDevotionals"] = [d if d["day"] != "Friday" else day["kid"] for d in draft["kidDevotionals"]]
    out_path = ROOT / "data/generated-pack-draft-v2.json"
    out_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"New Friday: {day['title']} / {day['scripture']['reference']}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
