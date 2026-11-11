#!/usr/bin/env python3
"""Rewrite the paragraphs of an adult body that quote the verse verbatim, Nov 5, 2026 (v32).

Jeremiah's request: when the review page flags an adult body for quoting its verse verbatim, the pastor should be able to click Rewrite and have the model rewrite just the offending paragraph(s) in its own words, instead of deleting a whole paragraph by hand. Deleting a paragraph is a large edit; it defeats the purpose of the app (the AI should write so the pastor only double-checks, not fixes).

Usage:
  python3 scripts/rewrite_section.py <request-id>
  # Reads data/rewrite-jobs/<id>.json, loads the 4B model, rewrites each paragraph that contains an 8-word verbatim run from the verse, writes data/rewrite-jobs/<id>-result.json.

Rules, in order:
1. The verse is NOT in the model prompt (only the paragraph to rewrite), so the model cannot quote the verse again from the prompt. This is the same rule as the v23 paraphrase_field.
2. The result is verified in code against the verse (8-word verbatim check, the same check as lib/quality.mjs). A paragraph that still quotes after 2 attempts is kept as-is and reported in the result, so the pastor sees exactly what still needs a look.
3. Paragraphs that do not quote the verse are returned unchanged. Only the offending paragraphs are rewritten.
4. The rewritten paragraph keeps the same meaning and roughly the same length (target = the original paragraph's word count, clamped to 40-60 words, the adult field band).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from generate_sections import MODEL, call_model, is_gemini_backend, is_grok_backend, is_mlx_backend, is_openrouter_backend

REWRITE_JOBS = ROOT / "data" / "rewrite-jobs"


def norm_words(s):
    return [re.sub(r"[^a-z0-9]", "", w.lower()) for w in (s or "").split() if re.sub(r"[^a-z0-9]", "", w.lower())]


def has_verbatim_run(paragraph, verse_text):
    """True if any 8 consecutive verse words, in order, appear in the paragraph."""
    verse_words = norm_words(verse_text)
    para_words = norm_words(paragraph)
    if len(verse_words) < 8 or len(para_words) < 8:
        return False
    para_str = " ".join(para_words)
    for i in range(len(verse_words) - 7):
        if " ".join(verse_words[i:i + 8]) in para_str:
            return True
    return False


def rewrite_paragraph(llm, paragraph, target, tag):
    """One paraphrase call, verse NOT in the prompt. Returns the rewritten text, or "" on failure."""
    try:
        result = call_model(llm, "\n".join([
            "Rewrite ONE paragraph in your own words. Output JSON ONLY, no markdown, no explanation.",
            "Field: paragraph.",
            f"Original paragraph: {paragraph}",
            f"Rewrite it with the same meaning, in your own plain words, in about {target} words, keeping at least 2 sentences. Change the wording and sentence structure, do NOT quote the original paragraph word for word, keep the same facts, no new events, names, or verses.",
            'JSON shape: {"paragraph": "..."}',
        ]), f"{tag}-rewrite-paragraph", max_tokens=800)
        return result.get("paragraph", "") or ""
    except Exception as e:
        print(f"Rewrite failed: {e}")
        return ""


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/rewrite_section.py <request-id>")
        return 2
    req_id = sys.argv[1]
    req_path = REWRITE_JOBS / f"{req_id}.json"
    result_path = REWRITE_JOBS / f"{req_id}-result.json"
    if not req_path.exists():
        print(f"No rewrite request {req_id}")
        return 1
    req = json.loads(req_path.read_text(encoding="utf-8"))
    body = req.get("body", "")
    verse_text = req.get("verseText", "")
    verse_ref = req.get("verseRef", "")
    paragraphs = [p.strip() for p in body.split("\n\n") if p.strip()]
    # Find the offending paragraphs (8-word verbatim run from the verse).
    offending = [i for i, p in enumerate(paragraphs) if has_verbatim_run(p, verse_text)]
    if not offending:
        result = {"status": "done", "body": body, "rewritten": [], "stillQuoting": [], "note": "No paragraph quotes the verse verbatim. Nothing to rewrite."}
        result_path.write_text(json.dumps(result, indent=1), encoding="utf-8")
        print(f"No offending paragraph in {req_id}; nothing rewritten.")
        return 0
    # Load the model (same pattern as generate_sections.py: GPU first, CPU fallback).
    # v33: Gemini backend. No local model is loaded; call_model routes
    # to the Gemini client, and the key arrives in
    # FLOCKPATH_GEMINI_API_KEY from the worker.
    # v42, Nov 9, 2026: the mlx (27B test) backend also loads no
    # local model; call_model routes to the mlx client instead.
    # v43, Nov 9, 2026: the grok backend also loads no local
    # model; call_model routes to the grok client instead.
    # v47, Nov 9, 2026: the openrouter backend also loads no
    # local model; call_model routes to the openrouter client.
    if is_gemini_backend() or is_mlx_backend() or is_grok_backend() or is_openrouter_backend():
        llm = None
        print(f"Backend: {'Google Gemini' if is_gemini_backend() else 'OpenRouter (GLM 5.3 Flash)' if is_openrouter_backend() else 'Grok (xAI)' if is_grok_backend() else 'Mac 27B via mlx-serve'} (no local model loaded).", flush=True)
    else:
        from llama_cpp import Llama
        try:
            llm = Llama(model_path=str(MODEL), n_ctx=8192, n_threads=4, n_gpu_layers=-1, verbose=False)
        except Exception as e:
            print(f"GPU model load failed ({e}), falling back to CPU-only.")
            llm = Llama(model_path=str(MODEL), n_ctx=8192, n_threads=4, verbose=False)
    rewritten = []
    still_quoting = []
    for idx in offending:
        original = paragraphs[idx]
        target = max(40, min(60, len(original.split())))
        new_text = ""
        for attempt in range(2):
            candidate = rewrite_paragraph(llm, original, target, f"rewrite-{req_id}")
            if candidate and not has_verbatim_run(candidate, verse_text):
                new_text = candidate
                break
            if candidate:
                new_text = candidate
        if new_text and not has_verbatim_run(new_text, verse_text):
            paragraphs[idx] = new_text
            rewritten.append(idx)
        else:
            # Both attempts still quote (or failed); keep the original and report it.
            still_quoting.append(idx)
    new_body = "\n\n".join(paragraphs)
    result = {
        "status": "done",
        "body": new_body,
        "rewritten": rewritten,
        "stillQuoting": still_quoting,
        "note": f"Rewrote {len(rewritten)} paragraph(s). {len(still_quoting)} still quote(s) the verse and need a pastor edit." if still_quoting else f"Rewrote {len(rewritten)} paragraph(s). No paragraph quotes the verse now.",
    }
    result_path.write_text(json.dumps(result, indent=1), encoding="utf-8")
    req["status"] = "done"
    req_path.write_text(json.dumps(req, indent=1), encoding="utf-8")
    print(f"Rewrite {req_id}: rewrote {rewritten}, still quoting {still_quoting}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
