"""Step 4 local generation proof.

Loads a local Qwen3 GGUF with llama-cpp-python, prompts it with the
Flockpath prompt from lib/generate.mjs (references only, never
Scripture text), and writes the raw model draft to
data/generated-pack-draft.json.

The draft is NOT a pack yet. scripts/test-generate.mjs expands it
(fill quotes from the verse store) and runs it through lockPack().
A draft that cites a missing reference, or whose expanded quotes do
not match, cannot lock.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Prompt text is duplicated here in Python on purpose: this script
# runs standalone without a Node runtime. The wording matches
# buildPrompt() in lib/generate.mjs.
ROOT = Path(__file__).resolve().parent.parent
STORE = json.loads((ROOT / "data/engwebp-GEN.json").read_text(encoding="utf-8"))

ALLOWED = ["GEN 1:1", "GEN 1:3", "GEN 1:27", "GEN 1:31", "GEN 2:3"]
PROMPT = "\n".join([
    "You are writing a family discipleship pack for a church.",
    "Output JSON ONLY, no markdown, no explanation.",
    "The pack must have exactly 5 adult devotionals (Monday-Friday) and exactly 5 kid versions (ages 6-10).",
    "For Scripture, output ONLY the reference, like {\"reference\": \"GEN 1:1\"}.",
    "NEVER write out Scripture text yourself. NEVER invent a verse.",
    f"Use ONLY these references for Scripture citations: {', '.join(ALLOWED)}.",
    "Kid versions must be retellings in plain words for ages 6-10, not quotes.",
    "The chorus must be original, short, and singable, with chords in ChordPro format.",
    "The coloring entry must use svgTemplateId \"creation-sky-sea\".",
    "Leader questions: 5 questions for a small group, with short leader notes.",
    "Passage: Genesis 1",
    "JSON shape: {\"id\": \"generated-genesis-1\", \"title\": \"God Made It Good\", \"passage\": \"Genesis 1\", \"pastorName\": \"Sample Pastor\", \"church\": \"Sample Church\", \"memoryVerse\": {\"reference\": \"GEN 1:1\"}, \"adultDevotionals\": [{\"day\": \"Monday\", \"title\": \"...\", \"scripture\": {\"reference\": \"GEN 1:1\"}, \"body\": \"...\", \"prayer\": \"...\"}], \"kidDevotionals\": [{\"day\": \"Monday\", \"title\": \"...\", \"retelling\": \"...\", \"activity\": \"...\"}], \"leaderQuestions\": [{\"question\": \"...\", \"leaderNote\": \"...\"}], \"chorus\": {\"title\": \"...\", \"original\": true, \"chordPro\": \"...\"}, \"coloring\": {\"title\": \"...\", \"description\": \"...\", \"svgTemplateId\": \"creation-sky-sea\"}}",
])

def main():
    from llama_cpp import Llama
    model_path = ROOT / "models/Qwen3-1.7B-Q4_K_M.gguf"
    if not model_path.exists():
        print(f"Model not found: {model_path}", file=sys.stderr)
        return 1
    llm = Llama(model_path=str(model_path), n_ctx=8192, n_threads=4, verbose=False)
    out = llm.create_chat_completion(
        messages=[{"role": "user", "content": PROMPT}],
        temperature=0.3,
        max_tokens=4000,
        # Decoding-level steering, added with the quality gate:
        # a repetition penalty makes the small model less likely
        # to fall back on a phrase it already used. It is a nudge,
        # not the control - the day plan and checkQuality() are.
        repeat_penalty=1.15,
    )
    text = out["choices"][0]["message"]["content"]
    print("Raw model output (first 800 chars):")
    print(text[:800])
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        print("No JSON object found in model output", file=sys.stderr)
        return 1
    draft = json.loads(text[start:end + 1])
    out_path = ROOT / "data/generated-pack-draft.json"
    out_path.write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {out_path}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
