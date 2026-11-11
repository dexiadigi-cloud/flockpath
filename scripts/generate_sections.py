"""Step 7.5 Phase A: section-by-section generation.

Replaces the one-shot whole-pack JSON that failed John 3 with a
missing comma. Each section is generated, parsed with repair,
retried, and validated on its own, so one bad section cannot lose
the whole pack.

Key Phase A changes vs generate_local.py / generate_test.py:
- The model SEES the verse text as context for writing. It still
  never writes the quote into the pack: the final pack is built
  from references only, and quotes are filled from the verse store
  and verified. Seeing text fixes verse-body mismatch; quoting
  from the store keeps Scripture exact.
- Raw output is saved for every section, every time, before parsing.
- JSON repair: missing comma between fields (the John 3 failure),
  trailing commas, and <think> blocks are handled before retrying.
- Kid sections are given the adult body and told explicitly not
  to copy it, in plain words for ages 6-10, with a different title.
- Leader questions: at most one question may start with the same
  four words.
- Chorus: lyrics are required, not just chords. At least two lines
  with real words after stripping [chords].

Usage:
  .venv/bin/python scripts/generate_sections.py JHN3 data/engwebp-JHN.json "John 3" \
    "JHN 3:3,JHN 3:5,JHN 3:16,JHN 3:17,JHN 3:36" \
    "Born anew,Water and Spirit,God so loved,Not to judge,Believe and live" \
    data/test-jhn3-sections-draft.json

Nov 1, 2026, resume requirement: a 10-minute pack must not
restart from scratch when it is interrupted halfway. Every
finished section is saved immediately to a checkpoint file
next to the draft (<tag>-checkpoint.json), with passage, refs,
and angles recorded. A later run with the same tag, refs, and
angles reuses finished sections and generates only the missing
ones, in order. Kid sections reuse the stored adult body for
their day, so a resumed kid section is identical in context
to the original run. The checkpoint is deleted only after the
full draft is written, so a stale checkpoint can never be
reused for a different pack.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
import os
MODEL = Path(os.environ.get("FLOCKPATH_MODEL", str(ROOT / "models/Qwen3.5-4B-S-TS-Q4_K_S.gguf")))
# Proof model, adopted 2026-10-30 after head-to-head wins over
# Qwen3-1.7B and Qwen3.5-2B on Romans, John, and Psalm 23.
# Qwen3.5-4B needs no-think mode; see call_model.

# Nov 5, 2026, v33 (Google API first): the pastor may choose Google
# Gemini instead of the local model. The backend is an env var set by
# the worker from the pastor's stored setting (data/auth.db). 'local'
# is the default and behaves exactly as before; 'gemini' routes every
# call_model call through scripts/gemini_client.py instead of llama-cpp.
# No prompt, temperature, band, or gate changes: only the model behind
# the call changes.
def is_gemini_backend():
    return os.environ.get("FLOCKPATH_BACKEND", "local").strip().lower() == "gemini"

# Nov 9, 2026, v42 (27B test only): the Mac 27B (Qwen3.8-27B via
# mlx-serve) as a test backend. Same pattern as Gemini: the backend
# is an env var ('mlx'), call_model routes through
# scripts/mlx_client.py instead of llama-cpp, no prompt,
# temperature, band, or gate changes. Test-only: lib/auth.mjs
# coerces any non-gemini backend to "local", so the web UI cannot
# store "mlx" yet; the test bypasses the worker/UI with the env
# var. A pastor-facing mlx backend would need the worker, auth,
# and model-settings changes, plus a Jeremiah-approved decision.
def is_mlx_backend():
    return os.environ.get("FLOCKPATH_BACKEND", "local").strip().lower() == "mlx"

# Nov 9, 2026, v43 (Grok API first): the pastor may choose Grok
# (xAI) instead of the local model or Google Gemini. Same pattern
# as Gemini: the backend is an env var ('grok'), call_model routes
# through scripts/grok_client.py instead of llama-cpp, no prompt,
# temperature, band, or gate changes. Grok is the API going
# forward because Google's Gemini free tier stopped working
# (403, free tier not available, even for a fresh key). The
# pastor brings their own Grok key (console.x.ai, paid, about
# $0.03 a pack on grok-4.1-fast). Gemini stays as a paid option.
def is_grok_backend():
    return os.environ.get("FLOCKPATH_BACKEND", "local").strip().lower() == "grok"

# Nov 9, 2026, v47 (OpenRouter first): the pastor may choose
# OpenRouter instead of the local model, Google Gemini, or Grok
# (xAI). Same pattern as Grok: the backend is an env var
# ('openrouter'), call_model routes through
# scripts/openrouter_client.py instead of llama-cpp, no prompt,
# temperature, band, or gate changes. OpenRouter serves GLM 5.3
# Flash (z-ai/glm-5.3-flash, about $0.01 a pack (measured Nov 9)), the cheapest
# capable model found and the best hallucination record in
# testing (invented 0 of 5 fake entities). The pastor brings
# their own OpenRouter key (openrouter.ai, $5 of credits covers
# hundreds of packs). GLM is a reasoning model, so the client
# sets reasoning effort to "low" and retries a dropped
# connection, the two fixes proven in the Nov 9 GLM test packs.
def is_openrouter_backend():
    return os.environ.get("FLOCKPATH_BACKEND", "local").strip().lower() == "openrouter"

# v39, Nov 6, 2026: voice block. The v38 topic pack (Forgiveness, no
# sermon, Phos-grounded) read like a commentary, not a devotional: the
# model copied 19th-century commentary diction ("countenance, language,
# and manners", "rough, crabbed, or sour", "fault found, blame, censure,
# or complaint"), dropped a bare Greek word ("charizomenoi") into a
# devotional, opened paragraphs with day labels ("Thursday:", "Thursday
# devotional:"), and used lowercase "he" for God. The sermon path does
# not have this problem, because a sermon is plain pastoral language and
# the model mirrors the register of whatever source is in front of it.
# This block goes into every adult-field prompt and every leader prompt,
# so the model writes in plain pastoral language from any source.
# LOCKED principles behind it (Jeremiah, Nov 6, 2026): everything is
# anchored to a verse AND a resource; a Greek or Hebrew word is fine
# when its plain English meaning sits right beside it, never bare.
# Nov 9, 2026, v44 (Jeremiah-approved identity frame): the first line
# now names who the model writes as — "a Bible-believing Christian
# pastor who trusts Scripture as God's true Word." Research Jeremiah
# shared Nov 9 found that appending explicit "as a Bible-believing
# Christian" context spiked theological accuracy and orthodox alignment
# by an average of 28 points across American, European, and Chinese
# foundational models. The frame is meant to improve the output and
# to make it more trustworthy (less off the rails), especially for the
# new Grok backend, which is unproven on a full pack. One line, at the
# top of the block, so it reaches every adult, leader, notes, and
# repair prompt that uses VOICE_BLOCK.
VOICE_BLOCK = (
    "Write as a Bible-believing Christian pastor who trusts Scripture as "
    "God's true Word. Write in plain, warm, everyday language, the way a "
    "pastor speaks to a family at the kitchen table. Use your own words. Do "
    "not copy the study material's phrasing, and do not use its old-fashioned "
    "or formal words (for example: countenance, crabbed, censure, remitting, "
    "supposes). If a word would sound strange spoken aloud to a family, do "
    "not use it. A Greek or Hebrew word is fine when you give its plain "
    "English meaning right beside it the first time (for example: "
    "\"charizomenoi, which means to graciously forgive\"); never drop an "
    "untranslated foreign word into a sentence. Do not start a paragraph with "
    "a day name, a label, or a heading (never \"Thursday:\", never \"Thursday "
    "devotional:\"). Write plain paragraphs only. When you refer to God, "
    "always capitalize He, His, and Him."
)

def save_raw(tag, text):
    (ROOT / f"data/test-raw-{tag}.txt").write_text(text, encoding="utf-8")

def match_hymns(refs, topics):
    # Nov 1, 2026, hymn hookup: deterministic Hymn Desk match,
    # same matcher generate_from_plan.py uses, but inside
    # generate_sections so a draft built by this script alone
    # (not just through generate_from_plan) still carries a
    # hymn and candidates for the review-page swap. Topics
    # here are the day angles, lowercased; refs do the heavy
    # work for exact scripture matches. Returns (hymn, list)
    # or (None, []) on no match or on a missing Hymn Desk
    # (e.g. a Mac test copy without hymn-desk alongside it).
    # Never crashes generation: no hymn means no song
    # section, not a generated chorus (removed Nov 2).
    import subprocess
    hymn_desk = ROOT.parent / "hymn-desk"
    if not hymn_desk.is_dir():
        hymn_desk = Path.home() / "workspace" / "hymn-desk"
    script = hymn_desk / "scripts" / "match_hymn.py"
    data = hymn_desk / "data" / "hymns.json"
    if not script.exists() or not data.exists():
        print("Hymn Desk not found, no song section.")
        return None, []
    try:
        out = subprocess.run(
            ["python3", str(script), ",".join(refs), ",".join(topics), "--json"],
            capture_output=True, text=True, timeout=30)
        candidates = json.loads(out.stdout)
    except Exception as e:
        print(f"Hymn match failed ({e}), no song section.")
        return None, []
    if not candidates:
        print("No hymn match, no song section.")
        return None, []
    hymns = json.loads(data.read_text(encoding="utf-8"))["hymns"]
    by_id = {h["id"]: h for h in hymns}
    full = [by_id[c["id"]] for c in candidates if c["id"] in by_id]
    if not full:
        return None, []
    print(f"Attached hymn: {full[0]['title']} ({full[0]['tune']}), "
          f"candidates: {[h['title'] for h in full]}")
    return full[0], full

def repair_json(text):
    # Strip think blocks, extract first { to last }
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("No JSON object in output")
    s = text[start:end + 1]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # Missing comma between fields: "value"\n  "nextKey":
    s2 = re.sub(r'"\s*\n(\s*")', r'",\n\1', s)
    # Trailing commas before } or ]
    s2 = re.sub(r",\s*([}\]])", r"\1", s2)
    try:
        return json.loads(s2)
    except json.JSONDecodeError:
        pass
    # Overnight Oct 31, 2026: same missing comma, but on one
    # line, "value" "nextKey": . Only insert before a token
    # that looks like a JSON key, to avoid splitting a string
    # value that happens to contain a quote.
    s3 = re.sub(r'"\s+("[A-Za-z_][A-Za-z0-9_]*"\s*:)', r'", \1', s2)
    try:
        return json.loads(s3)
    except json.JSONDecodeError:
        pass
    # Nov 1, 2026, v6 leader raw files: the 4B drops the
    # OPENING quote on a string value, but keeps the closing
    # quote, e.g. "goodAnswer": The passage states ... .",
    # which fails at the value start, line 5 col 21 in all
    # three v6 attempts. A quoted value starts with " after
    # the colon, so this pattern only matches bare values,
    # never a valid quoted value. The value class excludes
    # ", so a greedy match runs to the closing quote, even
    # if the value itself contains commas. A lazy match
    # would stop at the first comma inside the value and
    # break it, so do not use lazy here.
    s4 = re.sub(r'(:\s*)([A-Za-z][^"\n\r]+)"(?=\s*[,}\]])', r'\1"\2"', s3)
    try:
        return json.loads(s4)
    except json.JSONDecodeError:
        pass
    # Last resort, missing both quotes: value ends at the
    # next comma or closing brace. Only runs after the
    # closing-quote repair already failed.
    s5 = re.sub(r'(:\s*)([A-Za-z][^"\n\r]+?)(?=\s*[,}\]])', r'\1"\2"', s4)
    return json.loads(s5)

def call_model(llm, prompt, tag, max_tokens=None, repeat_penalty=1.0):
    # Qwen3.5-4B S-tier, 2026-10-30 finding: with thinking on by
    # default, the model spent its whole 900-token section budget
    # on a "Thinking Process" and never reached the JSON. The
    # prompt must say no thinking, and the budget must be larger
    # for the 4B test, or the section cannot pass at all.
    if max_tokens is None:
        max_tokens = int(os.environ.get("FLOCKPATH_MAX_TOKENS", "900"))
    prompt = "Do not show any thinking or reasoning. Output JSON immediately.\n" + prompt
    if is_gemini_backend():
        # v33: Gemini path. The same prompt, the same 3-attempt
        # JSON-repair loop, the same save_raw audit trail. The
        # Gemini client already retries 429/503 with backoff
        # inside gemini_generate, so an API error here is final
        # (bad key or daily limit) and is raised at once, not
        # retried as a JSON error.
        from gemini_client import gemini_generate
        api_key = os.environ.get("FLOCKPATH_GEMINI_API_KEY", "")
        for attempt in range(3):
            text = gemini_generate(prompt, api_key, max_tokens)
            save_raw(f"{tag}-a{attempt}", text)
            try:
                return repair_json(text)
            except Exception as e:
                if attempt == 2:
                    raise RuntimeError(f"Section {tag} failed JSON after 3 attempts: {e}")
                prompt = prompt + f"\n\nPrevious output had a JSON error: {e}. Output JSON ONLY, with commas between every field, no markdown, no explanation."
        raise RuntimeError(f"Section {tag} failed")
    if is_mlx_backend():
        # v42, Nov 9, 2026: 27B test path. Same prompt, same
        # 3-attempt JSON-repair loop, same save_raw audit trail
        # as the Gemini path. The mlx client retries 429/503
        # (busy server, e.g. Goose holding the single slot)
        # inside mlx_generate; a connection-refused (server not
        # running) fails at once and is raised here, not retried
        # as a JSON error.
        from mlx_client import mlx_generate
        for attempt in range(3):
            text = mlx_generate(prompt, None, max_tokens)
            save_raw(f"{tag}-a{attempt}", text)
            try:
                return repair_json(text)
            except Exception as e:
                if attempt == 2:
                    raise RuntimeError(f"Section {tag} failed JSON after 3 attempts: {e}")
                prompt = prompt + f"\n\nPrevious output had a JSON error: {e}. Output JSON ONLY, with commas between every field, no markdown, no explanation."
        raise RuntimeError(f"Section {tag} failed")
    if is_grok_backend():
        # v43, Nov 9, 2026: Grok path. Same prompt, same
        # 3-attempt JSON-repair loop, same save_raw audit trail
        # as the Gemini path. The Grok client retries 429/503
        # with backoff inside grok_generate; a bad key fails
        # at once and is raised here, not retried as a JSON
        # error. The key comes from FLOCKPATH_GROK_API_KEY,
        # set by the worker from the pastor's stored setting.
        from grok_client import grok_generate
        api_key = os.environ.get("FLOCKPATH_GROK_API_KEY", "")
        for attempt in range(3):
            text = grok_generate(prompt, api_key, max_tokens)
            save_raw(f"{tag}-a{attempt}", text)
            try:
                return repair_json(text)
            except Exception as e:
                if attempt == 2:
                    raise RuntimeError(f"Section {tag} failed JSON after 3 attempts: {e}")
                prompt = prompt + f"\n\nPrevious output had a JSON error: {e}. Output JSON ONLY, with commas between every field, no markdown, no explanation."
        raise RuntimeError(f"Section {tag} failed")
    if is_openrouter_backend():
        # v47, Nov 9, 2026: OpenRouter path. Same prompt, same
        # 3-attempt JSON-repair loop, same save_raw audit trail
        # as the Grok path. The OpenRouter client retries 429/503
        # and dropped connections with backoff inside
        # openrouter_generate; a bad key or an empty account fails
        # at once and is raised here, not retried as a JSON
        # error. The key comes from FLOCKPATH_OPENROUTER_API_KEY,
        # set by the worker from the pastor's stored setting.
        from openrouter_client import openrouter_generate
        api_key = os.environ.get("FLOCKPATH_OPENROUTER_API_KEY", "")
        for attempt in range(3):
            text = openrouter_generate(prompt, api_key, max_tokens)
            save_raw(f"{tag}-a{attempt}", text)
            try:
                return repair_json(text)
            except Exception as e:
                if attempt == 2:
                    raise RuntimeError(f"Section {tag} failed JSON after 3 attempts: {e}")
                prompt = prompt + f"\n\nPrevious output had a JSON error: {e}. Output JSON ONLY, with commas between every field, no markdown, no explanation."
        raise RuntimeError(f"Section {tag} failed")
    for attempt in range(3):
        no_think = os.environ.get("FLOCKPATH_NO_THINK")
        if no_think is None:
            no_think = "1" if "4B" in str(MODEL) else "0"
        if no_think == "1":
            # Qwen3.5 thinking is on by default and, in chat
            # completion, its "Thinking process" lands in the
            # message content, pollutes the first-{ extraction,
            # and eats the token budget. An empty think block
            # in a raw ChatML prompt forces non-thinking mode,
            # proven 2026-10-30 on the 4B S-tier Monday adult.
            raw = (f"<|im_start|>user\n{prompt}<|im_end|>\n"
                   "<|im_start|>assistant\n<think>\n</think>\n\n")
            # v17 settings test, card values for faithful
            # fields: top_p 0.85, top_k 20, temperature 0.3.
            out = llm(raw, max_tokens=max_tokens, temperature=0.3,
                      top_p=0.85, top_k=20,
                      repeat_penalty=repeat_penalty, stop=["<|im_end|>"])
            text = out["choices"][0]["text"]
        else:
            out = llm.create_chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3, top_p=0.85, top_k=20, max_tokens=max_tokens, repeat_penalty=repeat_penalty,
            )
            text = out["choices"][0]["message"]["content"]
        save_raw(f"{tag}-a{attempt}", text)
        try:
            return repair_json(text)
        except Exception as e:
            if attempt == 2:
                raise RuntimeError(f"Section {tag} failed JSON after 3 attempts: {e}")
            prompt = prompt + f"\n\nPrevious output had a JSON error: {e}. Output JSON ONLY, with commas between every field, no markdown, no explanation."
    raise RuntimeError(f"Section {tag} failed")

# Nov 5, 2026, v24 (round-3 cover note): the sermon snapshot
# is the first generation change since v23 locked, approved
# by Jeremiah as a version step. v23 prompts, temps, bands,
# and gates are UNTOUCHED: this is one additive call after
# the leader questions, using the same call_model settings
# (temp 0.3, no-think for the 4B). It runs only when a
# sermon-length text was pasted or uploaded; otherwise the
# pack has no snapshot and the review page shows the empty
# pastor-note box instead. Any failure here is a soft fail:
# the pack builds without a snapshot, never a failed
# generation. Quotes are verified verbatim against the full
# sermon text in code, never trusted from the model alone.
SERMON_MIN_WORDS = 150
SERMON_SNAPSHOT_MAX_WORDS = 2500
SNAPSHOT_SUMMARY_MAX_WORDS = 45
SNAPSHOT_QUOTE_MAX_WORDS = 30

def _match_words(s):
    # Lowercased, punctuation-stripped words, for matching
    # only. A quote that drops a trailing period ("do not
    # quit one day early" vs the sermon's "early.") is still
    # the same words, and must verify; the returned span
    # below keeps the sermon's own punctuation.
    return [w2 for w2 in (re.sub(r"[^\w']", "", w).lower()
            for w in re.sub(r"\s+", " ", str(s or "")).strip().split(" ")) if w2]

def find_verbatim(quote, text):
    # Find the quote as a contiguous run of words in the
    # sermon, ignoring case, punctuation, and extra
    # whitespace, and return the sermon's own span (its
    # exact words, casing, and punctuation), or None when
    # the quote is not in the sermon. The printed quote is
    # always the sermon's words, never the model's.
    qwords = _match_words(quote)
    if not qwords:
        return None
    twords = re.sub(r"\s+", " ", str(text or "")).strip().split(" ")
    tmatch = _match_words(text)
    n = len(qwords)
    for i in range(len(tmatch) - n + 1):
        if tmatch[i:i + n] == qwords:
            return " ".join(twords[i:i + n])
    return None

_TERM_RE = re.compile(r"[.!?][\"'”’)\]]*$")
_ABBR = {"mr", "mrs", "ms", "dr", "st", "sr", "jr", "vs", "etc", "eg", "ie"}

def _starts_upper(w):
    m = re.search(r"[A-Za-z]", str(w or ""))
    return bool(m) and m.group(0).isupper()

def _is_sentence_end(w, next_w):
    # A word ends a sentence when it carries terminal
    # punctuation and the next word starts a new sentence
    # (capitalized, or the text ends). Known abbreviations
    # ("Mr.", "St.", "e.g.") never end a sentence, or a
    # quote would stop at "St." in "St. Paul said...".
    if not _TERM_RE.search(str(w or "")):
        return False
    clean = re.sub(r"[^a-z]", "", str(w or "").lower())
    if clean in _ABBR:
        return False
    if next_w is None:
        return True
    return _starts_upper(next_w)

def _snap_to_sentences(span, text):
    # Snap a verified quote span to the full sentence(s) that
    # contain it, so the cover never prints a fragment like
    # "to say, \"Because the Bible" (Nov 5, 2026, round-5:
    # Jeremiah's call, a quote must be at least one full
    # sentence). Returns the sermon's own sentence(s), or
    # None when the enclosing sentence runs over the 30-word
    # cap or has no sentence end in the text. The span match
    # is punctuation-aware via _match_words; the returned
    # span keeps the sermon's own words and punctuation.
    span_words = _match_words(span)
    if not span_words:
        return None
    twords = re.sub(r"\s+", " ", str(text or "")).strip().split(" ")
    tmatch = _match_words(text)
    n = len(span_words)
    start = None
    for i in range(len(tmatch) - n + 1):
        if tmatch[i:i + n] == span_words:
            start = i
            break
    if start is None:
        return None
    s = start
    while s > 0 and not _is_sentence_end(twords[s - 1], twords[s]):
        s -= 1
    e = start + n - 1
    while e < len(twords) and not _is_sentence_end(twords[e], twords[e + 1] if e + 1 < len(twords) else None):
        e += 1
    if e >= len(twords):
        return None
    sentence = " ".join(twords[s:e + 1])
    if len(sentence.split()) > SNAPSHOT_QUOTE_MAX_WORDS:
        return None
    return sentence

def _trim_summary(summary, max_words=SNAPSHOT_SUMMARY_MAX_WORDS):
    # Backstop for a model summary over the cover cap: keep
    # whole sentences up to the cap. A first sentence over
    # the cap alone is cut at the cap, which is rare.
    words = str(summary or "").split()
    if len(words) <= max_words:
        return str(summary or "").strip()
    sentences = re.split(r"(?<=[.!?])\s+", str(summary or "").strip())
    kept, count = [], 0
    for s in sentences:
        n = len(s.split())
        if count + n > max_words and kept:
            break
        kept.append(s)
        count += n
        if count >= max_words:
            break
    out = " ".join(kept).strip()
    return out if out else " ".join(words[:max_words])

def build_sermon_snapshot(llm, sermon_text, tag):
    # One model call: a short summary plus one verbatim
    # quote. The prompt gets the first 2500 words only, so
    # a long sermon fits the 8192-token context with room
    # for the answer; verification below uses the FULL text.
    words = str(sermon_text or "").split()
    head = " ".join(words[:SERMON_SNAPSHOT_MAX_WORDS])
    prompt = (
        "You are helping a pastor turn a sermon into a short cover note for a family discipleship pack.\n"
        "Output JSON ONLY, no markdown, no explanation.\n"
        "Read the sermon below and write:\n"
        "- \"summary\": 2-3 sentences, at most 45 words, in plain words, saying what the sermon was about and what it asks of us.\n"
        "- \"quote\": ONE short quote from the sermon, at most 30 words, copied EXACTLY as the preacher said it, word for word. The quote must be one or more COMPLETE sentences: start at the beginning of a sentence and end with a period, exclamation mark, or question mark. Never start in the middle of a sentence and never cut a sentence off. Do not paraphrase the quote. Do not invent words. If no short quotable line stands out, use null.\n"
        "The quote must be the preacher's own words from the sermon text, never your own words.\n"
        "Sermon:\n" + head + "\n"
        "JSON shape: {\"summary\": \"...\", \"quote\": \"...\" or null}"
    )
    out = call_model(llm, prompt, f"{tag}-sermon-snapshot", max_tokens=300)
    summary = str(out.get("summary") or "").strip()
    if not summary:
        return None
    summary = _trim_summary(summary)
    quote = out.get("quote")
    exact = None
    if isinstance(quote, str) and quote.strip():
        if len(quote.split()) <= SNAPSHOT_QUOTE_MAX_WORDS:
            # Nov 5, 2026, round-5: the model may still return
            # a fragment, so the code, not the model, enforces
            # the full-sentence rule: snap the verified span to
            # its enclosing sentence(s), and drop the quote when
            # that sentence runs over the cap.
            exact = find_verbatim(quote, sermon_text)
            if exact:
                exact = _snap_to_sentences(exact, sermon_text)
    if not exact:
        # v26, Nov 5, 2026: a missing quote is a real gap,
        # not a soft fail. Jeremiah's Nov 5 salvation pack
        # came back with a summary and no quote, and the
        # cover printed summary-only. Retry once for a
        # quote only (the summary is never regenerated),
        # then fall back to the first short complete
        # sentence in the sermon, verified by
        # construction. Only a sermon with no short
        # complete sentence at all returns quote None.
        exact = _quote_retry(llm, sermon_text, tag)
    if not exact:
        exact = _first_short_sentence(head)
        if exact:
            print(f"Sermon snapshot: quote from code fallback, first short sentence.")
    return {"summary": summary, "quote": exact}

def build_sermon_snapshot_with_retry(llm, sermon_text, tag):
    # v36, Nov 6, 2026: the snapshot is the cover block, so
    # a failure must not ship silently. The Power of Cross
    # G2 pack (full sermon pasted, v33, no pacing) shipped
    # without a snapshot because the snapshot call hit the
    # per-minute rate limit and the except swallowed it.
    # Retry on transient errors up to 3 times (a per-minute
    # limit clears in seconds), then FAIL with a clear
    # message instead of returning nothing. The caller does
    # not catch this: the build stops, the draft is not
    # written, and the checkpoint already holds the finished
    # sections, so a Continue retries only the snapshot.
    # A None return (the model could not produce a usable
    # summary) also fails loudly; it already tried 3 times
    # inside the helper above.
    last_err = None
    snapshot = None
    for attempt in range(1, 4):
        try:
            snapshot = build_sermon_snapshot(llm, sermon_text, tag)
            break
        except Exception as e:
            last_err = e
            print(f"Sermon snapshot attempt {attempt} failed: {e}", flush=True)
            if attempt < 3:
                time.sleep(10)
    if snapshot:
        print(f"Sermon snapshot: summary {len(snapshot['summary'].split())} words, quote {'yes' if snapshot.get('quote') else 'none verified'}", flush=True)
        return snapshot
    if last_err is not None:
        raise RuntimeError(f"Sermon snapshot failed after 3 attempts: {last_err}. The pack was NOT built. Tap Continue to retry the snapshot.")
    raise RuntimeError("Sermon snapshot: the model could not produce a usable summary. The pack was NOT built. Tap Continue to retry the snapshot.")

# v37, Nov 6, 2026: source-grounded generation. The model must
# never do a 100% full take; it always summarizes a provided
# source (the sermon when present, Phos when not). This helper
# picks the relevant sermon section for one verse. Deterministic,
# no model call: the tool does the heavy lifting, the model only
# summarizes. Module level so the proof can import and test it.
# The stopword set matches main()'s ANCHOR_STOPWORDS: generic
# words like "all", "one", "then", "not" must not count as
# overlap, or every paragraph matches every verse.
_SERMON_STOPWORDS = set(
    "a an the and or of to in on for with by is are was were be been it its this that from as at "
    "they their them we us our you your he she his her it its this that these those who whom whose what when where why how than then just also now here there down up out over under again once into about after before between through during above below from with without within upon all any some no not only own same so too very can could will would shall should may might must do does did have has had am".split()
)

def _src_content_words(text):
    s = (text or "").lower().replace("'s", "").replace("’s", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return [w for w in s.split() if w and w not in _SERMON_STOPWORDS]

def sermon_excerpt_for_ref(sermon_text, verse_text, angle, lexicon_terms, max_words=300):
    # v37: the relevant sermon section for one verse, up to
    # max_words. Never the full sermon in a prompt. Scores
    # each paragraph by overlap with the verse words (x2),
    # the Phos angle words (x2, the theme in commentary
    # language, so a chunk about the theme matches even
    # when it does not cite the verse), and the lexicon
    # terms (x1). Takes the top scorers at least a quarter
    # as strong as the best match, up to the budget, then
    # restores document order so the excerpt reads in the
    # sermon's own flow. Returns "" when no paragraph
    # overlaps (the caller then grounds that verse in Phos
    # only, and says so plainly).
    text = sermon_text or ""
    if not text.strip():
        return ""
    # Paragraphs on blank lines; a sermon pasted as one
    # block falls back to ~100-word sentence chunks.
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if len(paras) <= 1:
        sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
        paras = []
        cur = []
        cur_words = 0
        for s in sents:
            w = len(s.split())
            if cur and cur_words + w > 100:
                paras.append(" ".join(cur))
                cur, cur_words = [], 0
            cur.append(s)
            cur_words += w
        if cur:
            paras.append(" ".join(cur))
    verse_words = set(_src_content_words(verse_text))
    angle_words = set(_src_content_words(angle))
    lex_words = set()
    for t in (lexicon_terms or []):
        lex_words.update(_src_content_words(t))
    scored = []
    for idx, p in enumerate(paras):
        pw = set(_src_content_words(p))
        score = 2 * len(pw & verse_words) + 2 * len(pw & angle_words) + 1 * len(pw & lex_words)
        scored.append((score, idx, p))
    scored.sort(key=lambda t: (-t[0], t[1]))
    # v37 fix: a relative threshold. Generic words ("sin",
    # "god") give a weakly related paragraph a small positive
    # score, so a >0 cutoff alone lets a Leviticus paragraph
    # into a Romans excerpt. Keep only paragraphs scoring at
    # least a quarter of the best match: the primary section
    # for the verse, not every paragraph that mentions sin.
    top = scored[0][0] if scored else 0
    threshold = max(1, top // 4)
    chosen = []
    used = 0
    for score, idx, p in scored:
        if score < threshold:
            break
        w = len(p.split())
        if used + w > max_words:
            if not chosen:
                # One paragraph alone exceeds the budget (a
                # pasted sermon with no breaks). Truncate it
                # to the budget rather than blowing the prompt.
                chosen.append((idx, " ".join(p.split()[:max_words])))
                used = max_words
            # Else skip this paragraph; a later shorter one
            # may still fit.
            if used >= max_words:
                break
            continue
        chosen.append((idx, p))
        used += w
        if used >= max_words:
            break
    chosen.sort(key=lambda t: t[0])
    return "\n\n".join(p for _, p in chosen)

def _quote_retry(llm, sermon_text, tag):
    # v26: one quote-only retry after a failed first
    # quote (null, unverified, or snapped to nothing).
    # Same verification and full-sentence snap as the
    # first try, so a retry quote is held to the same
    # standard. Returns the sermon's own sentence(s),
    # or None when the retry also fails.
    words = str(sermon_text or "").split()
    head = " ".join(words[:SERMON_SNAPSHOT_MAX_WORDS])
    prompt = (
        "You are helping a pastor turn a sermon into a short cover note for a family discipleship pack.\n"
        "Output JSON ONLY, no markdown, no explanation.\n"
        "The first try at a quote could not be verified as the preacher's exact words. Give ONE short quote from the sermon below, at most 30 words, copied EXACTLY as the preacher said it, word for word. The quote must be one or more COMPLETE sentences: start at the beginning of a sentence and end with a period, exclamation mark, or question mark. Never start in the middle of a sentence and never cut a sentence off. Do not paraphrase. Do not invent words.\n"
        "Sermon:\n" + head + "\n"
        "JSON shape: {\"quote\": \"...\"}"
    )
    try:
        out = call_model(llm, prompt, f"{tag}-sermon-snapshot-quote-retry", max_tokens=200)
    except Exception as e:
        print(f"Sermon snapshot quote retry failed: {e}")
        return None
    quote = out.get("quote")
    if not isinstance(quote, str) or not quote.strip():
        return None
    if len(quote.split()) > SNAPSHOT_QUOTE_MAX_WORDS:
        return None
    exact = find_verbatim(quote, sermon_text)
    if exact:
        exact = _snap_to_sentences(exact, sermon_text)
    return exact

def _first_short_sentence(text, min_words=8, max_words=SNAPSHOT_QUOTE_MAX_WORDS):
    # v26: code fallback for the sermon quote. The first
    # complete sentence in the sermon that fits the
    # 30-word cap, 8 words or more so it says something.
    # Verbatim by construction, it is the sermon's own
    # words, with the sermon's own punctuation. Only
    # used when the model cannot return a verified quote
    # twice, so the cover never prints summary-only for
    # a sermon that has a short sentence in it.
    twords = re.sub(r"\s+", " ", str(text or "")).strip().split(" ")
    start = 0
    for i, w in enumerate(twords):
        nxt = twords[i + 1] if i + 1 < len(twords) else None
        if _is_sentence_end(w, nxt):
            sentence = " ".join(twords[start:i + 1])
            n = len(sentence.split())
            if min_words <= n <= max_words:
                return sentence
            start = i + 1
    return None

def fix_draw_god_activity(activity):
    # v26, Nov 5, 2026, Jeremiah's rule: never ask
    # children to draw God the Father; drawing Jesus
    # is fine. When the model still writes a draw-God
    # activity, the app swaps the drawn object to Jesus
    # in place, using the same narrow pattern as the
    # flag, so "draw God's face" becomes "draw Jesus'
    # face" and "draw God and yourself" becomes "draw
    # Jesus and yourself". Only the drawn God is
    # swapped; any other mention of God in the activity
    # is left alone. The possessive case runs first, so
    # God's never falls through to God. Module-level so
    # the proof can import it directly, like the v25
    # negation helpers.
    _a = str(activity or "")
    _a = re.sub(r"(\b(?:draw|drawing|sketch|sketching)\b\s+(?:(?:a|the|an)\s+)?(?:picture\s+)?(?:of\s+)?)God's\b", r"\1Jesus'", _a, flags=re.IGNORECASE)
    _a = re.sub(r"(\b(?:draw|drawing|sketch|sketching)\b\s+(?:(?:a|the|an)\s+)?(?:picture\s+)?(?:of\s+)?)God\b", r"\1Jesus", _a, flags=re.IGNORECASE)
    return _a


def resolve_verse_text(ref, store):
    # v28, Nov 5, 2026, Jeremiah's verse ranges: a range
    # reference resolves to the joined text of its verses,
    # so a range is one passage unit for the devotional,
    # the kid retelling, and the gates. A single verse
    # returns its own text. A range with a verse missing
    # from the store raises KeyError, the same hard failure
    # as a missing single verse, never a silent partial.
    _m = re.match(r"^([A-Z0-9]+) (\d+):(\d+)(?:-(\d+))?$", str(ref or "").strip())
    if not _m:
        return store[ref]
    _code, _ch, _v1, _v2 = _m.group(1), _m.group(2), int(_m.group(3)), _m.group(4)
    if not _v2:
        return store[f"{_code} {_ch}:{_v1}"]
    return " ".join(store[f"{_code} {_ch}:{v}"] for v in range(_v1, int(_v2) + 1))


def drop_note_fragment(part):
    # v27, Nov 5, 2026, Enemies pack review: the model's
    # textPoint sometimes comes back as a fragment
    # ("verse 39.", "leave your gift there before the
    # altar.") instead of a complete pointing sentence,
    # and the fragment prints between the leader note
    # and the follow-up question. A fragment is a part
    # that starts with a lowercase letter (a copied verse
    # fragment or a bare reference) or has fewer than 5
    # words (a bare reference). Dropping it keeps the
    # note coherent; the goodAnswer and followUp still
    # carry the note. Module-level so the proof can
    # import it directly.
    _p = str(part or "").strip()
    if not _p:
        return True
    if len(_p.split()) < 5:
        return True
    return not _p[0].isupper()

# v25 (Nov 5, 2026, Jeremiah-approved round-6 fix): the
# negation self-check and the shared verbatim helper. The
# Nov 5 Powers of God pack proved two gaps: an adult body
# can flip a verse's meaning (JER 23:29, "not like fire"
# for a rhetorical question that affirms both images) and
# pass every lexical check, and a kid retelling can quote
# its verse nearly word for word (ROM 1:19, HEB 11:6)
# because the prompt told the model to use the verse's own
# words. These helpers are module-level so the scratch
# proof can import them directly.
RHETORICAL_RULE = (
    "Rhetorical question: this verse asks a question whose answer is yes. "
    "It affirms what follows, it does not deny it. Never move the 'not' onto "
    "the thing the verse affirms."
)

NEGATION_RE = re.compile(r"\b(didn'?t|doesn'?t|not|never|no one|nothing)\b", re.I)

def verse_turns_on_negation(verse_text):
    # Same trigger as the review warning in lib/quality.mjs
    # (section 7), so the self-check runs on exactly the
    # verses the pastor used to have to read by hand.
    return bool(NEGATION_RE.search(verse_text or ""))

def is_rhetorical_question(verse_text):
    # A question whose answer is yes: the verse ends with a
    # question mark (allowing a closing quote) and opens with
    # an auxiliary + not. JER 23:29 is the proving case.
    t = (verse_text or "").strip()
    if not re.search(r"\?\s*[”\"'’)\]]*\s*$", t):
        return False
    return bool(re.search(r"\b(is|are|was|were|did|do|does|shall|will|has|have|can|could)\s+not\b", t, re.I))

def quotes_verse_verbatim(text, verse_text):
    # The adult 8-word verbatim check, as a shared helper.
    # Same normalization as the adult inline check in
    # call_adult_field and the review warning in
    # lib/quality.mjs (section 7b): any 8 consecutive verse
    # words, in order, in the text; a verse shorter than 8
    # words counts when the whole verse appears.
    def _nw(s):
        return [w for w in (re.sub(r"[^a-z0-9]", "", x.lower()) for x in (s or "").split()) if w]
    vw = _nw(verse_text)
    tw = _nw(text)
    if not vw or not tw:
        return False
    if len(vw) < 8:
        return " ".join(vw) in " ".join(tw)
    chunks = [vw[i:i + 8] for i in range(len(vw) - 7)]
    return any(tw[j:j + 8] in chunks for j in range(len(tw) - 7))

def check_negation_flip(llm, verse_text, paragraph, tag):
    # One short meaning check, bodySays only. Returns
    # (verdict, sentence): SAME, FLIP, or UNKNOWN (call
    # failure or unparsable answer). The narrowed question
    # plus examples is what steadied the 4B in the Nov 5
    # scratch tests: the broad version caught the real JER
    # 23:29 flip but also flagged a correct paragraph. Two
    # example pairs (JER 23:29 rhetorical question, ROM 8:32
    # plain negation) teach the distinction in both shapes,
    # and the proof run gives the right verdict on all four
    # cases (JER flip, JER same, ROM flip, ROM same).
    # NOTE: a deterministic guard was tried and REMOVED the
    # same day: "a FLIP only stands when the named sentence
    # carries a negation word" discarded a TRUE flip, because
    # "God held back His Son" expresses the opposite action
    # with no "not" in it. Do not re-add a negation-word
    # filter on the verdict; the examples are the guard.
    try:
        result = call_model(llm, "\n".join([
            "Read the verse and the paragraph below. The paragraph is supposed to say the same thing as the verse, in different words.",
            f"Verse: {verse_text}",
            f"Paragraph: {paragraph}",
            "A flip means the paragraph DENIES something the verse affirms, or AFFIRMS something the verse denies. Adding an example or explaining an image is not a flip. Only a denial or affirmation that goes against the verse counts.",
            'Example of a flip: verse "Is not My word like fire?" Paragraph "His word is not like fire." That is a FLIP, because the verse affirms the word is like fire and the paragraph denies it.',
            'Example of SAME: verse "Is not My word like fire?" Paragraph "God\'s word burns like fire and breaks hard hearts." That is SAME, because it keeps what the verse affirms.',
            'Example of a flip: verse "He who did not spare His own Son, but gave Him up for us all." Paragraph "God held back His Son and kept Him safe." That is a FLIP, because the verse says God gave His Son up and the paragraph says He held Him back.',
            'Example of SAME: verse "He who did not spare His own Son, but gave Him up for us all." Paragraph "God gave up His own Son for us." That is SAME, because it keeps what the verse affirms.',
            "Does the paragraph flip the verse? Output JSON ONLY, no markdown, no explanation.",
            'JSON shape: {"verdict": "SAME" or "FLIP", "sentence": "the one sentence that flips the meaning, or empty string if SAME"}',
        ]), tag, max_tokens=300)
        verdict = str(result.get("verdict", "")).upper()
        if verdict not in ("SAME", "FLIP"):
            return "UNKNOWN", ""
        return verdict, (result.get("sentence", "") or "")
    except Exception as e:
        print(f"Negation check failed: {e}")
        return "UNKNOWN", ""

def repair_negation_flip(llm, verse_text, paragraph, flipping_sentence, tag):
    # One repair call for a flipped bodySays. The verse IS
    # in this prompt (unlike the v23 paraphrase): the model
    # needs it to know what the verse actually affirms.
    # Returns the rewritten paragraph, or "" on failure.
    try:
        result = call_model(llm, "\n".join([
            "Rewrite ONE paragraph so it says the same thing as the verse below. Output JSON ONLY, no markdown, no explanation.",
            f"Verse: {verse_text}",
            f"Original paragraph: {paragraph}",
            f"The problem: this sentence flips the verse's meaning: \"{flipping_sentence}\" It denies something the verse affirms, or affirms something the verse denies.",
            "Rewrite the paragraph with the same meaning as the verse, in your own plain words, in about 50 words, keeping at least 2 sentences. Do NOT quote the verse in the paragraph.",
            'JSON shape: {"bodySays": "..."}',
        ]), tag, max_tokens=600)
        return result.get("bodySays", "") or ""
    except Exception as e:
        print(f"Negation repair failed: {e}")
        return ""

def main():
    args = sys.argv[1:]
    if len(args) < 6:
        print("usage: generate_sections.py <tag> <store.json> <passage> <refs_csv> <angles_csv> <out.json> [phos_bundle.json] [--progress-file <path> --progress-base <n> --progress-total <n>] [--sermon-file <path>]", file=sys.stderr)
        return 2
    tag, store_path, passage, refs_csv, angles_csv, out_path = args[:6]
    phos_path = None
    progress_file = None
    progress_base = 0
    progress_total = 0
    sermon_file = None
    rest = args[6:]
    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg == "--progress-file" and i + 1 < len(rest):
            progress_file = rest[i + 1]
            i += 2
        elif arg == "--progress-base" and i + 1 < len(rest):
            progress_base = int(rest[i + 1])
            i += 2
        elif arg == "--progress-total" and i + 1 < len(rest):
            progress_total = int(rest[i + 1])
            i += 2
        elif arg == "--sermon-file" and i + 1 < len(rest):
            sermon_file = rest[i + 1]
            i += 2
        elif arg.startswith("--"):
            print(f"unknown option: {arg}", file=sys.stderr)
            return 2
        elif phos_path is None:
            phos_path = arg
            i += 1
        else:
            print(f"unexpected argument: {arg}", file=sys.stderr)
            return 2

    def report(section_index, label):
        # Nov 3, 2026, generation step display: observability
        # only, no prompt, temp, or gate changes. Section
        # order is adult Mon, kid Mon, adult Tue, kid Tue,
        # and so on through Fri, then leader questions, so
        # section 0 is adult Monday and section 10 is leader.
        # A failed write never fails a section.
        if not progress_file or not progress_total:
            return
        try:
            from progress import write_progress
            write_progress(progress_file, progress_base + 1 + section_index, progress_total, label)
        except Exception:
            pass

    refs = refs_csv.split(",")
    angles = angles_csv.split(",")
    assert len(refs) == 5 and len(angles) == 5
    store = json.loads(Path(store_path).read_text(encoding="utf-8"))
    verse_text = {r: resolve_verse_text(r, store) for r in refs}
    # Step 7.5 Phase B: Phos context bundle, if given. Map ref -> bundle entry.
    phos = {}
    phos_devotionals = []
    if phos_path:
        bundle = json.loads(Path(phos_path).read_text(encoding="utf-8"))
        phos = {v["reference"]: v for v in bundle.get("verses", [])}
        phos_devotionals = bundle.get("devotionals", [])

    # Oct 31, 2026, meat expansion: use the FULL Phos bundle,
    # not the shallow first-only pass. Before this, only
    # commentary[0] was used, lexicon definitions were
    # discarded, and only the first 4 crossrefs were listed.
    # Now: both commentaries, lexicon definitions, and all
    # 8 crossrefs, as discussion pointers by reference only.
    # v18: Phos loaded-verb filter, in code, not prompt.
    # Drop commentary sentences containing a human-work
    # verb, survey, inspect, check, review, assess, test,
    # grade, fix, correct, examine, arrange, or Son,
    # Jesus, Christ when the verse does not name them.
    # GEN 1:31 Gill "took a survey", GEN 1:27 Gill
    # "body prepared for the Son of God", GEN 1:31
    # Clarke "properly arranged" are the v17 sources.
    # Lexicon and crossrefs are kept as-is.
    import re as _re
    LOADED_FORMS = set("survey surveyed surveying surveys inspect inspected inspecting inspects check checked checking checks review reviewed reviewing reviews assess assessed assessing assess test tested testing tests grade graded grading grades fix fixed fixing fixes correct corrected correcting corrects examine examined examining examines arrange arranged arranging arranges".split())
    _phos_filter_logged = set()

    def _filter_commentary(excerpt, verse_text):
        verse_low = (verse_text or "").lower()
        names_son = ("son of god" in verse_low or "jesus" in verse_low or "christ" in verse_low)
        sentences = _re.split(r"(?<=[.!?])\s+", excerpt or "")
        kept = []
        dropped = 0
        for s in sentences:
            low = s.lower()
            words = set(_re.findall(r"[a-z]+", low))
            if words & LOADED_FORMS:
                dropped += 1
                continue
            if not names_son and ("son of god" in low or _re.search(r"\bjesus\b", low) or _re.search(r"\bchrist\b", low)):
                dropped += 1
                continue
            kept.append(s)
        return " ".join(kept), dropped

    def phos_lines(ref):
        entry = phos.get(ref)
        if not entry:
            return ""
        lines = []
        total_dropped = 0
        for c in entry.get("commentary", []):
            filtered, dropped = _filter_commentary(c["excerpt"], verse_text.get(ref, ""))
            total_dropped += dropped
            if filtered:
                lines.append(f"Commentary context, public domain, {c['title']}: {filtered}")
        if total_dropped and ref not in _phos_filter_logged:
            print(f"Phos filter {ref}: dropped {total_dropped} loaded sentences.")
            _phos_filter_logged.add(ref)
        if entry.get("lexicon"):
            parts = []
            for w in entry["lexicon"]:
                d = (w.get("definition") or "").strip()
                parts.append(f"{w['transliteration']} means {w['gloss']} ({w['strongs']})" + (f": {d}" if d else ""))
            lines.append("Key words: " + "; ".join(parts))
        if entry.get("crossrefs"):
            lines.append("Related verses for discussion, cite by reference only, do not quote them: " + ", ".join(entry["crossrefs"]))
        return "\n".join(lines)

    def build_study_notes(ref, angle):
        # v40, Nov 7, 2026: study-notes stage (topic path only).
        # The root flaw in the topic path is the SHAPE of the source,
        # not the wording of the instruction. A sermon is already a
        # devotional: one voice, plain pastoral language, a narrative
        # arc, concrete examples built in. The model summarizes it.
        # The Phos source for a verse is a patchwork of 19th-century
        # commentary notes in several voices, with lexicon entries and
        # no arc and (usually) one idea. The model copies its register
        # and repeats its one idea. v39 proved this: the voice block
        # fixed the diction and the defects, the anti-repetition pass
        # stopped verbatim copying, the leader anchor fixed the
        # questions, and the pack is much better, but Friday still
        # circles one idea and the Greek words are still showy, because
        # the source still has one idea and still carries the lexicon.
        # So this stage rewrites the Phos lines into plain study notes
        # BEFORE the devotional prompts run. One model call per verse.
        # It returns four fields: says (the fact), means (the truth,
        # a different angle from says), today (how a family lives it,
        # with ONE concrete family example tied to the verse's image),
        # and gloss (the plain English meaning of any key word a family
        # might not know; "" when there is none). The devotional fields
        # then use the notes as their source, never the raw Phos lines.
        # The Greek and Hebrew words stay in THIS call only; they never
        # reach a devotional, kid, or leader prompt. The notes carry
        # the English meaning, never the foreign word.
        # A notes failure FAILS the day loudly (raises). It never
        # silently falls back to raw Phos lines, because a silent
        # fallback would reintroduce the flaws v40 is fixing and the
        # pastor would not know.
        _phos = phos_lines(ref)
        _notes_lines = [
            "Write study notes for one Bible verse, for a family devotional. Output JSON ONLY, no markdown, no explanation.",
            f"Passage: {passage}. Verse: <VERSE>{ref} - {verse_text[ref]}</VERSE>",
            f"Angle: {angle}.",
            "Study material (public-domain commentary and word notes):",
            _phos if _phos else "(No study material for this verse. Use the verse only.)",
        ]
        _notes_lines.append(VOICE_BLOCK)
        _notes_lines.append(
            "Write four fields. Each is a plain-language summary of the study material above. Do not add interpretations or applications that are not in the material. Do not use old-fashioned or formal words. If the material gives a Greek or Hebrew word, give ONLY its plain English meaning in the gloss field; never write a Greek or Hebrew word, or a word in another language, anywhere in your output."
            " \"says\": what this verse says, in 1-2 plain sentences. The fact."
            # v42, Nov 7, 2026: "means" is redefined as "why God tells
            # us this." The v41 tightening ("State the truth the verse
            # teaches... Do not turn it into a rule about things to
            # avoid doing") did NOT work: the v41 Wednesday COL 3:13
            # "means" note still said "He wants us to avoid doing
            # things that irritate each other." The reason is that the
            # drift is a SOURCE issue, not a model error: the Adam
            # Clarke commentary for COL 3:13 literally says
            # "Forbearing one another - Avoid all occasions of
            # irritating or provoking each other," and the model
            # faithfully summarized it. A prohibition cannot fix a
            # faithful summary. So "means" is redefined, not just
            # tightened: it now asks WHY God tells us this (the reason
            # / the motive / what it reveals about God, about us, or
            # about the grace He has shown us), which forces the model
            # to state the theological truth behind the command, not a
            # behavioral rule. For COL 3:13, "why" gives "because He
            # forgave us freely, so we should forgive freely" (the
            # teaching), not "avoid doing things that irritate" (a
            # rule). The same redefinition should also help Monday
            # P1/P2 be more distinct: for MAT 6:14-15, "why" gives the
            # motive ("because forgiveness is how God relates to us"),
            # which is more distinct from "says" (the conditional)
            # than the old "means" was. If the test run shows it does
            # not work, revert to the v41 wording and accept the drift
            # as a small edit.
            " \"means\": why God tells us this, in 1-2 plain sentences. State the reason behind the verse: what it reveals about God, about us, or about the grace He has shown us. A different angle from \"says\", not a restatement of it. Do not turn it into a rule about things to avoid doing."
            " \"today\": how a family lives this today, in 1-2 plain sentences, with ONE concrete family example tied to the verse's image (not a generic activity)."
            " \"gloss\": the plain English meaning, in a few words, of any key word in the verse that a family might not know (for example a word like \"trespasses\" or \"complaint\"). If there is no such word, write \"\"."
            ' JSON shape: {"says": "...", "means": "...", "today": "...", "gloss": "..."}'
        )
        _notes_prompt = "\n".join(_notes_lines)
        _n_problem = ""
        for _n_attempt in range(2):
            _use = _notes_prompt if _n_attempt == 0 else _notes_prompt + f"\n\nPrevious output had a problem: {_n_problem} Rewrite the same notes, fixing that problem, with the same verse and study material, keeping the same JSON shape. Output JSON ONLY."
            _raw = call_model(llm, _use, f"{tag}-notes-{ref}", 900)
            _notes = _raw if isinstance(_raw, dict) else {}
            _n_problem = _validate_notes(_notes)
            if _n_problem is None:
                return _notes
        raise RuntimeError(f"Study notes for {ref} failed validation after 2 attempts: {_n_problem}")

    def _validate_notes(notes):
        # Returns None when the notes are usable, else a short
        # problem description (never naming a forbidden word, so a
        # repair prompt does not prime the failure - the v19 rule).
        for _k in ("says", "means", "today", "gloss"):
            if _k not in notes or not isinstance(notes[_k], str):
                return f"missing field {_k}"
        for _k in ("says", "means", "today"):
            if len(notes[_k].split()) < 15:
                return f"{_k} is too short"
        for _k in ("says", "means", "today", "gloss"):
            if any(ord(_c) > 127 for _c in notes[_k]):
                return "a field contains a word in another language"
        # Distinctness: the three angles must not share a run of 8
        # or more consecutive words. If they do, the notes call
        # produced three restatements of one idea, and the
        # devotional paragraphs built from them would circle it.
        _fields = [notes["says"], notes["means"], notes["today"]]
        for _i in range(len(_fields)):
            for _j in range(_i + 1, len(_fields)):
                if _max_shared_run(_fields[_i], _fields[_j]) >= 8:
                    return "the three angles repeat each other"
        return None

    def _max_shared_run(a, b):
        _aw = re.sub(r"\s+", " ", (a or "")).strip().lower().split()
        _bw = re.sub(r"\s+", " ", (b or "")).strip().lower().split()
        _idx = {}
        for _j, _w in enumerate(_bw):
            _idx.setdefault(_w, []).append(_j)
        _best = 0
        for _i, _w in enumerate(_aw):
            for _j in _idx.get(_w, []):
                _k = 0
                while _i + _k < len(_aw) and _j + _k < len(_bw) and _aw[_i + _k] == _bw[_j + _k]:
                    _k += 1
                _best = max(_best, _k)
        return _best

    # v33: Gemini backend. No local model is loaded at all; the
    # Gemini client in call_model makes the calls, and the key
    # arrives in FLOCKPATH_GEMINI_API_KEY from the worker. The
    # local path below is untouched.
    # v42, Nov 9, 2026: the mlx (27B test) backend also loads no
    # local model; the mlx client in call_model talks to
    # mlx-serve on the Mac instead.
    # v43, Nov 9, 2026: the grok backend also loads no local
    # model; the grok client in call_model talks to xAI instead.
    # v47, Nov 9, 2026: the openrouter backend also loads no
    # local model; the openrouter client talks to OpenRouter.
    if is_gemini_backend() or is_mlx_backend() or is_grok_backend() or is_openrouter_backend():
        llm = None
        print(f"Backend: {'Google Gemini' if is_gemini_backend() else 'OpenRouter (GLM 5.3 Flash)' if is_openrouter_backend() else 'Grok (xAI)' if is_grok_backend() else 'Mac 27B via mlx-serve'} (no local model loaded).", flush=True)
    else:
        from llama_cpp import Llama
        # Nov 5, 2026, round-2 speed fix: the app used to load
        # the model CPU-only, while the fast November 1 Mac run
        # used llama-server, which uses the Mac GPU by default.
        # That is the prime suspect for the 5x gap. GPU layers
        # are now requested first, with a CPU fallback if the
        # load fails, so machines without a GPU backend still
        # run. No prompt, temperature, band, or gate changes:
        # speed only, quality untouched.
        try:
            llm = Llama(model_path=str(MODEL), n_ctx=8192, n_threads=4, n_gpu_layers=-1, verbose=False)
        except Exception as e:
            print(f"GPU model load failed ({e}), falling back to CPU-only.")
            llm = Llama(model_path=str(MODEL), n_ctx=8192, n_threads=4, verbose=False)

    # Resume checkpoint: load only if it matches this exact run.
    checkpoint_path = Path(out_path).with_name(f"{tag}-checkpoint.json")
    checkpoint = {"adult": {}, "kid": {}, "questions": None, "chorus": None}
    if checkpoint_path.exists():
        try:
            saved = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            if (saved.get("passage") == passage and saved.get("refs") == refs
                    and saved.get("angles") == angles):
                checkpoint = saved
                print(f"Resuming from checkpoint: "
                      f"{len(checkpoint.get('adult', {}))} adult, "
                      f"{len(checkpoint.get('kid', {}))} kid, "
                      f"questions={'yes' if checkpoint.get('questions') else 'no'}, "
                      f"chorus={'yes' if checkpoint.get('chorus') else 'no'}.")
            else:
                print("Checkpoint does not match this run, starting fresh.")
        except Exception as e:
            print(f"Checkpoint unreadable, starting fresh: {e}")

    def save_checkpoint():
        checkpoint["passage"] = passage
        checkpoint["refs"] = refs
        checkpoint["angles"] = angles
        checkpoint_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=1), encoding="utf-8")

    # v17: attempt log, for first-pass, repair, and
    # escalation rates per field, written alongside
    # the draft at the end of main.
    attempts_log = []

    # Nov 1, 2026, length retry + split fields, for the 4B pastor
    # model. Prompt wording alone did not fix short sections:
    # kid 38-56 words instead of 80-120, leader notes about 20
    # words instead of 40-70, adult swinging 138-205 words.
    # Split fields make a long field into small completable
    # fields, and code joins them back into the exact shape
    # downstream code, quality gates, and PDF expect, so no
    # downstream change is needed. Length retry is separate
    # from JSON repair: a section that parses but is short is
    # retried up to 2 more times with its exact shortfall
    # named, and the best valid attempt is kept, never a
    # failed or shorter one. Only shortfalls retry, never
    # overshoots, because the 4B undershoots and overshoot is
    # not a quality-gate failure.
    def wc(s):
        return len((s or "").split())

    # v15, research plan, Nov 1, 2026: enforcement moves to
    # code, not the prompt. These helpers are the code checks
    # for punctuation, forbidden words, kid titles, and
    # application questions. Prompts must NOT quote the
    # forbidden terms, or they prime the model to emit them.
    FORBIDDEN_KID_WORDS = ["magic", "magical", "spell", "witch", "fairy"]
    STOPWORDS = set("a an the and or of to in on for with by is are was were be been it its this that from as at".split())
    ACTION_WORDS = set("do plan practice choose start stop share pray rest honor help give listen speak forgive thank celebrate remember follow obey serve".split())

    def norm_text(s):
        # v15 fix, found in testing: God's must map to god,
        # not god + s, or a verse-word whitelist fails on
        # every possessive title. Strip possessive first.
        s = (s or "").lower().replace("'s", "").replace("’s", "")
        return re.sub(r"[^a-z0-9 ]+", " ", s).strip()

    def check_forbidden(text):
        low = (text or "").lower()
        for w in FORBIDDEN_KID_WORDS:
            if re.search(rf"\b{re.escape(w)}\b", low):
                return w
        return None

    def strip_literal_period(s):
        # v14 bug: model literally wrote the word Period.
        # after textPoint, all 5 leader notes. Strip that
        # literal, plus a literal Question mark, before
        # punctuation is added in code.
        s = (s or "").strip()
        s = re.sub(r"\s+Period\.?\s*$", "", s, flags=re.I)
        s = re.sub(r"\s+Question mark\.?\s*$", "", s, flags=re.I)
        return s

    # v16: kid title check, fixed from v15. V15 required
    # EVERY content word to be in the verse, so ALL 5
    # v15 titles fell back to verse references, because
    # natural titles like God's Amazing Start use words
    # like Amazing and Start that are not verse words.
    # V16 requires at least one verse-word overlap, plus
    # a banned-topic block in code, not all-words.
    # v26, Nov 5, 2026: "jesus" and "christ" are OUT of
    # the banned list. They were in it since v16 with no
    # recorded reason, and they were costing titles on
    # Jesus verses: the model's first instinct is a Jesus
    # title, which failed banned-word, and its second
    # instinct is a retelling word, which fails
    # no-verse-word, so both attempts died and the title
    # fell back to the verse reference. Jeremiah's own
    # fixed titles use Jesus freely ("Jesus Came To Find
    # Us"). The no-verse-word rule already grounds a
    # title in the verse, so the name ban was redundant.
    # Magic and fantasy words stay banned.
    BANNED_TITLE_WORDS = set(["magic", "magical", "spell", "witch", "fairy"])
    WEEKDAYS = set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    GOD_WORK_VERBS = set(["smiled", "laughed", "cried", "checked", "inspected", "surveyed", "fixed", "corrected", "tested", "graded", "worried", "forgot", "rested", "slept"])

    def kid_title_issue(title, verse_text, adult_title):
        # v20: distinguish title failure reasons, so a
        # Tue style adult-duplicate is not reported as
        # a verse-word failure. Returns "" if ok, else
        # adult-duplicate, banned-word, no-verse-word,
        # or empty. Banned-word does not name the word.
        if not title:
            return "empty"
        if adult_title and norm_text(title) == norm_text(adult_title):
            return "adult-duplicate"
        title_words = norm_text(title).split()
        if any(w in BANNED_TITLE_WORDS for w in title_words):
            return "banned-word"
        verse_words = set(norm_text(verse_text).split())
        content = [w for w in title_words if w not in STOPWORDS]
        if not content:
            return "no-verse-word"
        if not any(w in verse_words for w in content):
            return "no-verse-word"
        return ""

    def kid_title_ok(title, verse_text, adult_title):
        return kid_title_issue(title, verse_text, adult_title) == ""

    def verse_overlap_fraction(text, verse_text):
        verse_words = set(norm_text(verse_text).split())
        content = [w for w in norm_text(text).split() if w not in STOPWORDS]
        if not content:
            return 0.0
        return sum(1 for w in set(content) if w in verse_words) / len(set(content))

    # v29, Nov 5, 2026: the anchor stopwords. The base
    # STOPWORDS leave pronouns and function words in
    # (they, their, them, down, than, when), and those
    # appear in almost any verse and any paragraph by
    # chance, so a plain content-word count scored the
    # off-rails Thursday and Friday applications at 3,
    # barely below Monday at 4. With pronouns and
    # function words excluded, Thursday and Friday score
    # 0 and Monday, Tuesday, Wednesday score 2, 5, 6.
    # This set is ONLY for the anchor check and the anchor
    # repair word list; the kid overlap check keeps the
    # base STOPWORDS, unchanged.
    ANCHOR_STOPWORDS = STOPWORDS | set("they their them we us our you your he she his her it its this that these those who whom whose what when where why how than then just also now here there down up out over under again once into about after before between through during above below from with without within upon all any some no not only own same so too very can could will would shall should may might must do does did have has had am".split())

    def verse_word_overlap_count(text, verse_text):
        # v29, Nov 5, 2026: the application anchor check.
        # Counts how many of the paragraph's content words
        # (pronouns and function words excluded) also
        # appear in the verse. Zero means the paragraph
        # does not use any word from its verse, so it cannot
        # be applying that verse. The Golden Thread 3
        # Thursday application (woodworking) and Friday
        # application (weekend planning) both score zero;
        # Monday, Tuesday, Wednesday score 2 or more.
        verse_words = set(norm_text(verse_text).split())
        content = set(w for w in norm_text(text).split() if w not in ANCHOR_STOPWORDS)
        return sum(1 for w in content if w in verse_words)

    def source_word_overlap_count(text, source_text, verse_text):
        # v37, Nov 6, 2026: the grounding check. Counts how
        # many of the paragraph's content words appear in
        # the SOURCE (sermon excerpt + study material) but
        # NOT in the verse. Verse words are the topic;
        # sharing only those is writing about the verse,
        # not using the source. Sharing a source-only word
        # is the signal the model summarized the source.
        # Zero means a full take. A faithful paraphrase
        # shares at least a few words with its source, so
        # the zero threshold keeps false positives rare.
        verse_words = set(norm_text(verse_text).split())
        source_words = set(norm_text(source_text).split())
        content = set(w for w in norm_text(text).split() if w not in ANCHOR_STOPWORDS)
        return sum(1 for w in content if w in source_words and w not in verse_words)

    def verse_key_words(verse_text):
        # The usable content words of a verse, for the
        # anchor repair prompt. Same word list as the kid
        # title prompt, minus the banned title words, and
        # minus pronouns and function words, so the repair
        # names distinctive verse words, not "they".
        return sorted(set(w for w in norm_text(verse_text).split() if w not in ANCHOR_STOPWORDS and w not in BANNED_TITLE_WORDS))

    def weekday_in_text(text):
        words = norm_text(text).split()
        for w in words:
            if w in WEEKDAYS:
                return w
        return None

    def god_work_verb_flag(text, verse_text):
        verse_words = set(norm_text(verse_text).split())
        for sentence in re.split(r"[.!?]+", text or ""):
            low = norm_text(sentence)
            if "god" in low.split():
                for verb in GOD_WORK_VERBS:
                    if verb in low.split() and verb not in verse_words:
                        return verb
        return None

    def draw_god_activity_flag(activity):
        # v22, corrected same day: activity only, not
        # retelling, and God must be the DRAWN object,
        # not just a word anywhere in the activity.
        # Whole-activity draw plus god falsely flagged
        # v21 Mon, draw sky and earth, write what God
        # made first, where God is not drawn. Pattern:
        # draw verb, then optional article, picture,
        # of, then god, God's normalizes to god. Sketch
        # counts, paint does not, narrow scope. Misses
        # draw yourself and God, second object, noted.
        _t = norm_text(activity or "")
        return bool(re.search(r"\b(draw|drawing|sketch|sketching)\b\s+((a|the|an)\s+)?(picture\s+)?(of\s+)?god\b", _t))

    def is_application_question(q):
        low = norm_text(q or "")
        return ("this week" in low) or bool(set(low.split()) & ACTION_WORDS)

    def normalize(parsed):
        if isinstance(parsed, dict):
            parts = [parsed.get(k) for k in ("bodySays", "bodyMeans", "bodyToday", "bodyClosing")]
            if any(parts):
                parsed["body"] = "\n\n".join(p for p in parts if p)
                for k in ("bodySays", "bodyMeans", "bodyToday", "bodyClosing"):
                    parsed.pop(k, None)
            for q in parsed.get("leaderQuestions", []) or []:
                if isinstance(q, dict) and any(q.get(k) for k in ("goodAnswer", "textPoint", "followUp")):
                    # Nov 1, 2026, v14: punctuation fix, so the
                    # joined leaderNote does not run on in the
                    # PDF, e.g. earth How do you feel, when the
                    # model omits a period after textPoint.
                    # This is code, not a prompt, so it holds
                    # even if the model ignores the period rule.
                    def _punct(s, end):
                        s = strip_literal_period(s)
                        if not s:
                            return s
                        if s[-1] not in ".?!":
                            s += end
                        return s
                    q["leaderNote"] = " ".join(p for p in (_punct(q.get("goodAnswer"), "."), _punct(q.get("textPoint"), "."), _punct(q.get("followUp"), "?")) if p and not drop_note_fragment(p))
                    for k in ("goodAnswer", "textPoint", "followUp"):
                        q.pop(k, None)
        return parsed

    # v30, Nov 5, 2026: the prayer address check. A prayer
    # must ADDRESS God, not just mention Him. A bare "Jesus"
    # or "Lord" in third person ("We trust that Jesus lives
    # forever", "We lift our eyes as we wait for Jesus")
    # talks about God, it does not pray to Him, and the old
    # v27 list passed it because it matched the bare noun.
    # An address is a vocative (Lord, / Father, / Jesus, /
    # God, / O Lord / O God / Dear Lord / Heavenly Father)
    # or a second-person petition (we pray, we ask, help us,
    # give us, grant, lead us, bless, fill us, guide us,
    # teach us, show us, thank you, thank thee, hear us, be
    # with us, may you, may we). A real prayer also closes
    # with Amen. Both are checked here (generation, so the
    # model retries) and in lib/quality.mjs (review).
    PRAYER_VOCATIVE = ("lord,", "father,", "jesus,", "god,", "o lord", "o god", "dear lord", "dear father", "heavenly father", "lord jesus", "dear god")
    PRAYER_PETITION = ("we pray", "we ask", "help us", "give us", "grant us", "lead us", "bless us", "bless", "fill us", "guide us", "teach us", "show us", "thank you", "thank thee", "thank god", "praise you", "praise god", "praise jesus", "hear us", "be with us", "may you", "may we")
    def prayer_addresses_god(text):
        # Word-boundary matching, not substring. A bare
        # substring "grant" matches "granting" ("granting
        # us a permanent priesthood" talks about Jesus,
        # it does not ask Him), and "bless" matches
        # "blessed", and "we pray" matches "we prayed".
        # The trailing check is a negative lookahead for a
        # lowercase letter, not \b, because a phrase ending
        # in a comma ("Lord,") has no word boundary after
        # the comma. "Thank God" and "praise Jesus" are
        # addresses (thanking and praising Him directly),
        # so they are listed, not just "thank you".
        low = (text or "").lower()
        for phrase in PRAYER_VOCATIVE + PRAYER_PETITION:
            if re.search(r"\b" + re.escape(phrase) + r"(?![a-z])", low):
                return True
        return False
    def prayer_ends_amen(text):
        return (text or "").strip().rstrip(".!?").rstrip().lower().endswith("amen")

    # v31, Nov 5, 2026: the P.A.T.H. parts. Each letter is
    # checked with word-boundary matching, the same
    # negative-lookahead rule as prayer_addresses_god, so
    # "grant" does not match "granting" and "thank" in
    # "thankful" still counts (it starts the word).
    PRAYER_PRAISE_WORDS = ("holy", "praise", "glory", "majesty", "worthy", "almighty", "great", "hallowed", "magnificent", "wonderful", "righteous", "faithful")
    PRAYER_HELP = ("help us", "give us", "lead us", "guide us", "strengthen", "protect", "grant us", "show us", "teach us", "fill us", "bless us", "keep us", "deliver us", "be with us", "hear us")
    def _has_word(low, word):
        return re.search(r"\b" + re.escape(word) + r"(?![a-z])", low) is not None
    def prayer_path_parts(text):
        # Returns the P.A.T.H. parts present in a prayer.
        # P: a vocative address (Lord, / Father, / Jesus,)
        # or a praise word. A: asking God to forgive US
        # ("forgive us", "forgive me", "forgive our sins")
        # or admitting our failure ("sorry", "we have
        # failed", "we sinned", "we turned away"). A bare
        # "forgive" or "forgiveness" does not count: "the
        # path of forgiveness" is a noun about the verse,
        # and "help us forgive our hurtful members" is
        # forgiving others, not apologizing for ourselves.
        # T: "thank you" / "thank thee" / "thank god" /
        # "thankful" / "thanksgiving". A bare "thanks"
        # does NOT count: "Thanks for the Cross" is the
        # label echo (v32, Cross of Jesus 2), terse and
        # list-like, not a natural prayer. The prompt
        # tells the model to say "Thank You for...".
        # H: a help petition.
        low = (text or "").lower()
        parts = []
        if any(re.search(r"\b" + re.escape(v) + r"(?![a-z])", low) for v in PRAYER_VOCATIVE) or any(_has_word(low, w) for w in PRAYER_PRAISE_WORDS):
            parts.append("Praise")
        _apologize = ("forgive us", "forgive me", "forgive our sins", "forgive our failures", "forgive our doubts", "sorry", "we have failed", "we fail", "we sinned", "we have sinned", "we turned away", "we have turned away")
        if any(re.search(r"\b" + re.escape(a) + r"(?![a-z])", low) for a in _apologize):
            parts.append("Apologize")
        _thanks = ("thank you", "thank thee", "thank god", "thankful", "thanksgiving")
        if any(re.search(r"\b" + re.escape(t) + r"(?![a-z])", low) for t in _thanks):
            parts.append("Thanks")
        if any(re.search(r"\b" + re.escape(h) + r"(?![a-z])", low) for h in PRAYER_HELP):
            parts.append("Help")
        return parts

    def length_issues(kind, parsed, adult_title=None):
        if kind == "prayer":
            # v16: prayer over 40 is now an issue too.
            # V15 counted over as 0 issues, so a 56-word
            # prayer beat a 25-word prayer on total words.
            issues = []
            pw = wc(parsed.get("prayer"))
            if pw < 30 or pw > 40:
                issues.append(f"prayer {pw} words, outside 30-40")
            # v30: a prayer that does not address God, or
            # does not close with Amen, is an issue and the
            # model retries it. A statement about God is
            # not a prayer.
            _pr = parsed.get("prayer") or ""
            if _pr and not prayer_addresses_god(_pr):
                issues.append("prayer does not address God")
            if _pr and not prayer_ends_amen(_pr):
                issues.append("prayer does not end with Amen")
            # v31: each missing P.A.T.H. part is an issue,
            # so the model retries a prayer that praises but
            # never confesses, or thanks but never asks.
            # The retry prompt names the missing parts.
            if _pr:
                _missing = [p for p in ("Praise", "Apologize", "Thanks", "Help") if p not in prayer_path_parts(_pr)]
                for _m in _missing:
                    issues.append(f"prayer is missing {_m}")
                # v32: the word "Apologize" itself is never
                # natural prayer language (Cross of Jesus 2:
                # "Apologize, we fail..." echoed the label
                # even though "we fail" is in the part list,
                # so the part check passed it). A person says
                # "Forgive us", not "Apologize".
                if re.search(r"\bapologize\b", _pr.lower()):
                    issues.append("prayer uses the label 'Apologize' instead of asking forgiveness")
            return issues
        if kind == "adult":
            # v16: prompt aims 50/50/50/30, code accepts
            # 40/40/40/24, total 160-250. Prompt target is
            # higher than code floor by design, as margin,
            # so a 40-49 field is accepted, not retried forever.
            # Overshoot over 250 is now an issue too, so
            # best selection prefers a band attempt.
            issues = []
            bw = wc(parsed.get("body"))
            if bw < 160:
                issues.append(f"body {bw} words, need at least 160")
            if bw > 250:
                issues.append(f"body {bw} words, over 250")
            return issues
        if kind == "leader_question":
            issues = []
            q = parsed
            nw = wc(q.get("leaderNote"))
            if nw < 40 or nw > 70:
                issues.append(f"note {nw} words, outside 40-70")
            return issues
        if kind == "kid":
            issues = []
            if wc(parsed.get("retelling")) < 80:
                issues.append(f"retelling {wc(parsed.get('retelling'))} words, need at least 80")
            # Nov 9, 2026, v48: upper bound. The check used to
            # be minimum-only, so a retelling could run 122-137
            # words (GLM topic pack) and pass with no issue. The
            # band is 80-120, so over 120 is an issue too, and
            # the retry prompt tells the model to shorten it.
            # Best selection already prefers closest to 100, so
            # a pack whose every attempt runs long still keeps
            # the shortest one.
            if wc(parsed.get("retelling")) > 120:
                issues.append(f"retelling {wc(parsed.get('retelling'))} words, over 120")
            # v19: kid within-retelling repetition check.
            # Wed v18 repeated the image sentence 4 times
            # verbatim to reach length. Same sentence more
            # than once, 4 words or more, counts as an issue.
            _sent, _seen, _dup = [], set(), False
            for _s in re.split(r"[.!?]", parsed.get("retelling", "") or ""):
                _n = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", _s.lower().strip()))
                if len(_n.split()) >= 4:
                    if _n in _seen:
                        _dup = True
                        break
                    _seen.add(_n)
            if _dup:
                issues.append("retelling repeats a sentence")
            # v15: forbidden check is any occurrence, including
            # negation, e.g. without magic tricks. The retry
            # prompt must use a rule ID, never the term, or
            # it primes the model to emit it again.
            if check_forbidden((parsed.get("title") or "") + " " + (parsed.get("retelling") or "")):
                issues.append("rule: kid-word-list violated, rewrite using only simple everyday words from the verse")
            # Nov 1, 2026, v4 failure: kid title duplicated the
            # adult title exactly, which blocks lock in the
            # quality gate. Check same-day adult title here;
            # cross-pack duplicates are still caught by the
            # quality gate at review, because future adult
            # titles are not known yet when a kid day is made.
            if adult_title and (parsed.get("title") or "").lower().strip() == adult_title.lower().strip():
                # v21: do NOT name the adult title in
                # the issue string, because issue strings
                # go into retry prompts, and naming it
                # primes the model to copy it, as in v20.
                issues.append("kid title duplicates the adult title, give a different kid title")
            return issues
        if kind == "leader":
            issues = []
            qs = parsed.get("leaderQuestions", []) or []
            if len(qs) != 5:
                issues.append(f"{len(qs)} questions, need 5")
            for i, q in enumerate(qs, 1):
                if wc(q.get("leaderNote")) < 40:
                    issues.append(f"note Q{i} {wc(q.get('leaderNote'))} words, need at least 40")
            return issues
        return []

    def length_score(kind, parsed, adult_title=None):
        # v16: best selection is fewest issues first, then
        # closest to the target band, not most words.
        # Most-words rewarded overlong prayers and bodies,
        # e.g. v15 Thursday prayer 56 words beating 25 words.
        if kind == "prayer":
            return -abs(wc(parsed.get("prayer")) - 35)
        if kind == "adult":
            return -abs(wc(parsed.get("body")) - 200)
        if kind == "kid":
            score = -abs(wc(parsed.get("retelling")) - 100)
            if adult_title and (parsed.get("title") or "").lower().strip() == adult_title.lower().strip():
                score -= 1000
            return score
        if kind == "leader_question":
            return -abs(wc(parsed.get("leaderNote")) - 55)
        if kind == "leader":
            qs = parsed.get("leaderQuestions", []) or []
            score = sum(-abs(wc(q.get("leaderNote")) - 55) for q in qs)
            if len(qs) < 5:
                score -= 1000 * (5 - len(qs))
            return score
        return 0

    def call_with_length_retry(prompt, tag, max_tokens, kind, adult_title=None, repeat_penalty=1.0):
        # Nov 1, 2026, v5 failure: best was chosen by total
        # words, so adult attempt 3, body 148 + prayer 0 = 148
        # words, beat attempt 2, body 114 + prayer 35 = 149
        # words in theory, and in practice a body-heavy
        # attempt with no prayer beat a complete attempt with
        # a shorter body. A missing prayer is a missing field,
        # not a word-count tradeoff. Best is now fewest
        # issues first, then most words. An attempt with 1
        # issue beats an attempt with 2 issues, even if the
        # 2-issue attempt has more total words.
        best, best_issue_count, best_score = None, 999, -1
        for attempt in range(3):
            if attempt == 0:
                use_prompt = prompt
            else:
                # Generic wording, not just "too short", so a
                # title duplicate retry does not say "same
                # title" ambiguously. v21: for kid, the
                # retry note does NOT name the adult title
                # to avoid, because naming it primes the
                # model to copy it, as in v20 Thu.
                use_prompt = prompt + f"\n\nPrevious output had these problems: {'; '.join(prev_issues)}. Rewrite the same section, fixing those problems, with the same verse and angle, keeping the same JSON shape. Output JSON ONLY."
                if kind == "kid" and adult_title:
                    use_prompt += " Do NOT reuse the adult title for the kid title."
            raw = call_model(llm, use_prompt, f"{tag}-len{attempt}", max_tokens=max_tokens, repeat_penalty=repeat_penalty)
            # Nov 1, 2026, v9: per-field shortfall detail, corrected
            # Nov 1, 2026, v10: per-field minimums sum to 180:
            # 50+50+50+30, not v9 45+45+45+30=165, which could
            # never reach total 180 even if all fields hit minimums.
            # v8 adult raw files proved the model writes 1
            # sentence per field, about 20-30 words, in every
            # field, so total body lands at 88-118, not 180.
            # Telling it only total body shortfall does not
            # say which field to expand. Capture split-field
            # counts BEFORE normalize joins and pops them,
            # then add short fields to the retry prompt.
            # Best selection still uses total issues only,
            # so per-field detail does not inflate issue count.
            split_detail = []
            if kind == "leader" and isinstance(raw, dict):
                # Nov 1, 2026, v13: per-field note detail,
                # like adult per-field detail in v9. v11 len0
                # proved goodAnswer 11-12 words, under target,
                # while textPoint and followUp hit, so total
                # note landed at 35-39, not 40. Reporting only
                # total note shortfall does not say which
                # field to expand. Capture before normalize
                # joins and pops the split fields. Best
                # selection still uses total issues only.
                for qi, q in enumerate(raw.get("leaderQuestions", []) or [], 1):
                    if isinstance(q, dict):
                        for k, target in (("goodAnswer", 20), ("textPoint", 10), ("followUp", 10)):
                            if wc(q.get(k)) < target:
                                split_detail.append(f"Q{qi} {k} {wc(q.get(k))} words, need at least {target} words")
            if kind == "leader_question" and isinstance(raw, dict):
                for k, target in (("goodAnswer", 20), ("textPoint", 10), ("followUp", 10)):
                    if wc(raw.get(k)) < target:
                        split_detail.append(f"{k} {wc(raw.get(k))} words, need at least {target} words")
            if kind == "adult" and isinstance(raw, dict):
                for k, target in (("bodySays", 40), ("bodyMeans", 40), ("bodyToday", 40), ("bodyClosing", 24)):
                    if wc(raw.get(k)) < target:
                        # wc(None) is 0, so a missing field is
                        # reported as 0 words, not omitted.
                        # v10 bug: missing Closing was omitted.
                        # v16: retry names the code floor, not
                        # the prompt aim, so a 40-49 field is
                        # accepted, not retried forever.
                        split_detail.append(f"{k} {wc(raw.get(k))} words, need at least {target} words and at least 2 sentences")
            parsed = normalize(raw)
            score = length_score(kind, parsed, adult_title)
            issues = length_issues(kind, parsed, adult_title)
            # v17: attempt log, for first-pass, repair,
            # and escalation rates per field, written
            # alongside the draft at the end of main.
            _wc_map = {"prayer": wc(parsed.get("prayer")), "adult": wc(parsed.get("body")), "kid": wc(parsed.get("retelling")), "leader_question": wc(parsed.get("leaderNote")), "leader": len(parsed.get("leaderQuestions", []) or [])}
            attempts_log.append({"section": tag, "kind": kind, "attempt": attempt + 1, "words": _wc_map.get(kind, 0), "issues": len(issues), "issue_text": "; ".join(issues)})
            # Nov 1, 2026, v12: leader question count is a
            # primary sort key, not just one issue. A
            # 3-question attempt with 2 note issues must NOT
            # beat a 5-question attempt with 4 note issues,
            # as v11 did. A non-5 attempt gets +100 issues,
            # so a complete 5-question attempt always wins.
            effective_issues = len(issues)
            if kind == "leader" and len(parsed.get("leaderQuestions", []) or []) != 5:
                effective_issues += 100
            # v20: kid content issues outrank length
            # issues, same principle as leader count.
            if kind == "kid" and any("repeats a sentence" in i or "kid-word-list" in i or "duplicates the adult title" in i for i in issues):
                effective_issues += 100
            if effective_issues < best_issue_count or (effective_issues == best_issue_count and score > best_score):
                best, best_issue_count, best_score = parsed, effective_issues, score
            if not issues:
                return parsed
            prev_issues = issues + split_detail
            print(f"Length retry {tag}: attempt {attempt + 1} problems ({'; '.join(prev_issues)}), retrying.")
        print(f"Length retry {tag}: still has problems after 3 attempts, keeping best attempt.")
        return best

    def expand_field(field_text, field_name, shortfall_words):
        # v15: generate, measure in code, then expand in a
        # dedicated call. The expansion call's only job is
        # adding words, using only facts already in the
        # paragraph, no new events, names, or verses.
        # One expansion attempt, then code re-counts.
        # If it still falls short, the best attempt is kept
        # and flagged, not retried forever.
        try:
            result = call_model(llm, "\n".join([
            "Expand ONE paragraph. Output JSON ONLY, no markdown, no explanation.",
            f"Field: {field_name}.",
            f"Original paragraph: {field_text}",
            f"Add about {shortfall_words} words, using only facts already in this paragraph, no new events, names, or verses, keeping at least 2 sentences.",
            f'JSON shape: {{"{field_name}": "..."}}',
            ]), f"{tag}-expand-{field_name}", max_tokens=800)
            return result.get(field_name, "") or field_text
        except Exception as e:
            print(f"Expansion failed for {field_name}: {e}")
            return field_text

    def paraphrase_field(field_text, field_name, target, ref):
        # v23: one dedicated paraphrase call, verse NOT
        # in prompt, only field name and flagged
        # paragraph, so the model cannot quote the verse
        # again from prompt. Caller checks verbatim in
        # code, against the verse, and decides accept.
        # Returns the paraphrase text, or "" on failure.
        try:
            result = call_model(llm, "\n".join([
            "Rewrite ONE paragraph in your own words. Output JSON ONLY, no markdown, no explanation.",
            f"Field: {field_name}.",
            f"Original paragraph: {field_text}",
            f"Rewrite it with the same meaning, in your own plain words, in about {target} words, keeping at least 2 sentences. Change the wording and sentence structure, do NOT quote the original paragraph word for word, keep the same facts, no new events, names, or verses.",
            f'JSON shape: {{"{field_name}": "..."}}',
            ]), f"{tag}-paraphrase-{field_name}", max_tokens=800)
            return result.get(field_name, "") or ""
        except Exception as e:
            print(f"Paraphrase failed for {field_name}: {e}")
            return ""

    # v17: adult per-paragraph calls, replacing the
    # 4-field adult call. Each field gets its own call,
    # its own length-anchored example, and minimal
    # context: Says gets verse only, Means gets verse
    # plus Phos, Today gets verse only, Closing gets
    # verse plus the three fields already written.
    # Examples are generic, not about this passage,
    # for length only. 50-word example is 49 words,
    # 30-word example is 32 words, stated as about.
    # v18: examples are unrelated topics, not family
    # breakfast, which Tue and Fri Today copied verbatim
    # in v17. Autumn gardener is exactly 30 words, counted
    # in code, not about family or devotion.
    # v29, Nov 5, 2026: the 50-word example WAS a carpenter
    # building a bookshelf (measuring, cutting, sanding,
    # glue, paint, level, neat rows). The comment said
    # copying it into Today would be obviously off-topic,
    # but the model did not copy it verbatim, it
    # PARAPHRASED it, and the Golden Thread 3 Thursday
    # application came out as a woodworking metaphor
    # (measuring time, cutting distractions, sanding
    # worries, love and glue, warm gray days, neat rows)
    # that has nothing to do with Revelation 22:1-5. A
    # vivid craft metaphor is the wrong length model for
    # an application paragraph, because the model borrows
    # the metaphor, not just the length. The replacement
    # is a plain family routine with no craft metaphor,
    # so there is nothing to borrow except the length.
    # v30, Nov 5, 2026: that replacement was ALSO copied.
    # The Golden Thread 4 Tuesday application (built on
    # v29) paraphrased the dinner-table example and copied
    # its last sentence verbatim ("This simple routine gives
    # everyone a chance to listen, share, and end the day
    # together in peace."), and Thursday borrowed "the same
    # table each night". The model copies ANY concrete
    # example, whatever its topic, because the application
    # field asks for a concrete example and the prompt hands
    # it one. The topic was never the problem; the example
    # itself is. So bodyToday gets NO example at all now:
    # the target word count is stated in the prompt, and
    # the model must build its example from the verse, not
    # from a paragraph handed to it. bodySays and bodyMeans
    # keep the example (they restate and explain the verse,
    # so they are anchored by the verse text and do not
    # reach for a concrete example), and a sentence-level
    # check below catches a partial copy there too.
    EXAMPLE_50 = "A family can eat dinner together at the same table each night, talk about one thing they are thankful for, and help clear the dishes before bed. This simple routine gives everyone a chance to listen, share, and end the day together in peace."
    EXAMPLE_30 = "In autumn, a gardener can rake fallen leaves into neat piles, spread compost over the soil, and plant bulbs for spring, before watering the beds and storing tools for winter."
    # v38, Nov 6, 2026: prompt audit. The v37 source block
    # says "Base this paragraph ONLY on the source material
    # below", but the field_defs still named the OLD sources
    # and cancelled it. bodySays said "using verse only, no
    # commentary" (the opposite of the source block, which
    # IS commentary and sermon). bodyMeans said "using the
    # commentary and key words above" (Phos only, not the
    # sermon excerpt). bodyToday said "using the verse's own
    # images and words" (the verse, not the source). Each
    # field_def now names the source material, so the field
    # instruction and the source block agree. The bodyToday
    # anchor (at least one key word from the verse) stays:
    # it is a vocabulary requirement, not a source.
    ADULT_FIELDS = [
        ("bodySays", "what this verse says, in your own words, using the source material above", 50, 40, 60, EXAMPLE_50),
        ("bodyMeans", "what it means, using the source material above, in your own words, do not copy it verbatim", 50, 40, 60, EXAMPLE_50),
        # v34, Nov 6, 2026: "central image or main idea".
        # The first Gemini pack forced an image onto a
        # doctrinal passage (Monday: "a universal standard
        # of righteousness" as the central image of ROM
        # 3:9-12). The anchor check below still enforces
        # the verse words, so the grounding stays; this
        # only stops forcing an image where there is none.
        ("bodyToday", "what it means for a family today. Name the central image or main idea from the source material above, then give one concrete family example built around it. The paragraph must use at least one key word from the verse, not a generic family activity", 50, 40, 60, ""),
        ("bodyClosing", "a closing encouragement, following the body so far below", 30, 24, 36, EXAMPLE_30),
    ]

    def call_adult_field(day, ref, angle, field_name, field_def, target, low, high, example, previous_text, include_title, source_block=""):
        best_text, best_issues, best_score, title_out = "", 999, -1, ""
        # v19: prompt-safe issues from the previous
        # attempt, rule IDs only for content, never the
        # forbidden term or the quoted phrase, so the
        # repair prompt does not prime the failure.
        prompt_issues = []
        for attempt in range(3):
            lines = [
                "Write ONE adult devotional paragraph. Output JSON ONLY, no markdown, no explanation.",
                f"Day: {day}. Passage: {passage}. Angle: {angle}.",
                f"<VERSE>{ref} - {verse_text[ref]}</VERSE>",
            ]
            # v25: a rhetorical question affirms, it does
            # not deny. JER 23:29 proved the model reads
            # "Is not My word like fire?" as "not like fire".
            # bodySays only: it sets the meaning the other
            # fields build on.
            if field_name == "bodySays" and is_rhetorical_question(verse_text[ref]):
                lines.append(RHETORICAL_RULE)
            # v37, Nov 6, 2026: source-grounded generation.
            # Every adult field gets the same source block
            # (the sermon excerpt for this verse, if any,
            # plus the Phos study material). bodyMeans used
            # to be the only field with Phos context; now
            # all four fields ground in the source, so the
            # model summarizes instead of originating a
            # take. The leader questions ground in the
            # source too. The kid retelling grounds in the
            # ADULT body instead (v38): the adult body is
            # already source-grounded, and the kid retells
            # it for a child, so the source block is not
            # passed to the kid prompt separately.
            if source_block:
                lines.append(source_block)
            # v39, Nov 6, 2026: voice block (item 1). See VOICE_BLOCK
            # at module level. It goes into every adult-field prompt so
            # the model writes in plain pastoral language from any
            # source, sermon or Phos commentary.
            lines.append(VOICE_BLOCK)
            # v39, Nov 6, 2026: anti-repetition (item 2). The v38
            # topic pack repeated the same commentary sentence across
            # a day's paragraphs (Tuesday P1/P2/P3, Wednesday P1/P2,
            # Friday's three "On this Friday" openings), because each
            # field call could not see what the earlier fields said.
            # Every field after bodySays now gets the paragraphs
            # already written for this day, so it can add something
            # new instead of repeating them. NOTE: v19 reverted this
            # for Means/Today because v18 Means copied Says verbatim
            # on the local 4B, and "do-not-repeat was ignored like
            # other negative instructions". We are re-trying it on
            # Gemini with the v39 voice block ("use your own words")
            # in the same prompt; the v39 test pack will show whether
            # verbatim copying returns, and if it does, this is
            # reverted to bodyClosing only.
            if field_name != "bodySays" and previous_text:
                lines.append("Paragraphs already written for this day, for context only. Do not repeat what they say. Add something new, in your own words:")
                lines.append(previous_text)
            lines.append(f"Write this paragraph only: {field_name}: {field_def}.")
            # v30: bodyToday has no example (empty string).
            # A concrete example in this field gets copied,
            # whatever its topic, so the target word count is
            # stated and the model builds its example from
            # the verse. Fields with an example keep the
            # length-model line.
            if example:
                lines.append(f"Target: at least {target} words and at least 2 sentences, in the band {low}-{high} words. Example paragraph, about {target} words, generic, not about this passage, for length only, do not copy its content:")
                lines.append(example)
            else:
                # v38: the example comes from the source
                # material, not the verse alone. The v37
                # source block says "Base this paragraph
                # ONLY on the source material", but this
                # line said "Build your example from the
                # verse above", which cancelled it for
                # bodyToday's example. Now they agree.
                lines.append(f"Target: at least {target} words and at least 2 sentences, in the band {low}-{high} words. Build your example from the source material above, not from any example paragraph.")
            lines.append("Do not quote the verse in the paragraph.")
            if include_title:
                lines.append("Also give a short title for this day, 2-6 words, about this verse.")
                lines.append(f'JSON shape: {{"day": "{day}", "title": "...", "scripture": {{"reference": "{ref}"}}, "{field_name}": "..."}}')
            else:
                lines.append(f'JSON shape: {{"{field_name}": "..."}}')
            if attempt > 0:
                _pi = f"{field_name} {wc(best_text)} words, need {low}-{high} words and at least 2 sentences"
                if prompt_issues:
                    _pi += ", problems: " + "; ".join(prompt_issues)
                lines.append(f"\nPrevious output had these problems: {_pi}. Rewrite the same paragraph, fixing those problems, keeping the same JSON shape. Output JSON ONLY.")
                # v29: the anchor repair needs the verse's
                # words named, not just a rule ID. A rule ID
                # alone does not tell the model what to anchor
                # on, and the verse above is long. List the
                # usable content words so the rewrite can use
                # at least one of them.
                if "rule: adult-today-anchor" in prompt_issues:
                    _kw = verse_key_words(verse_text[ref])
                    _kw_line = f"Anchor this paragraph in the verse: use at least one of these words from the verse: {', '.join(_kw)}." if _kw else "Anchor this paragraph in the verse: use at least one key word from the verse above."
                    lines.append(_kw_line)
            try:
                parsed = call_model(llm, "\n".join(lines), f"{tag}-{day}-{field_name}-len{attempt}", max_tokens=600)
            except Exception as e:
                attempts_log.append({"section": f"{tag}-{day}-{field_name}", "kind": "adult_field", "attempt": attempt + 1, "words": 0, "issues": 1, "issue_text": f"JSON failed: {e}"})
                prompt_issues = ["rule: json-output"]
                continue
            text = parsed.get(field_name, "") or ""
            if include_title and parsed.get("title"):
                title_out = parsed.get("title")
            w = wc(text)
            issues = []
            if w < low or w > high:
                issues.append(f"{field_name} {w} words, outside {low}-{high}")
            # v18: verbatim example copy counts as an
            # issue and retries, not a pass. Tue and
            # Fri Today in v17 were the example verbatim.
            # Whitespace-normalized exact match only.
            if text and example and " ".join(text.split()) == " ".join(example.split()):
                issues.append(f"{field_name} copies the length example verbatim, write your own paragraph")
            # v30, Nov 5, 2026: the whole-paragraph check
            # misses a PARTIAL copy. The Golden Thread 4
            # Tuesday application (built on v29) kept its
            # own first sentence but copied the example's
            # last sentence verbatim ("This simple routine
            # gives everyone a chance to listen, share, and
            # end the day together in peace."), and Thursday
            # borrowed "the same table each night". So a
            # sentence from the example appearing in the
            # output is an issue too, even when the paragraph
            # as a whole is not identical. Sentences under
            # 4 words are ignored, so a short shared phrase
            # does not false-positive.
            if text and example:
                _ex_sents = set()
                for _s in re.split(r"[.!?]", example):
                    _n = " ".join(re.sub(r"[^a-z0-9 ]", "", _s.lower()).split())
                    if len(_n.split()) >= 4:
                        _ex_sents.add(_n)
                for _s in re.split(r"[.!?]", text):
                    _n = " ".join(re.sub(r"[^a-z0-9 ]", "", _s.lower()).split())
                    if len(_n.split()) >= 4 and _n in _ex_sents:
                        issues.append(f"{field_name} copies a sentence from the length example, write your own paragraph")
                        break
            # v19: adult field content checks in code,
            # after each field call, before joining fields,
            # so a bad Says does not contaminate Means
            # and prayer. Survey origin in v18 was Says,
            # not Means Phos, and Friday verbatim origin
            # was also Says. Verbatim is any 8 consecutive
            # verse words in order, same as the quality
            # gate. God-plus-work-verb uses the same list
            # as the kid flag, verb not in verse.
            prompt_issues = []
            if text:
                _vn = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in verse_text[ref].split()]
                _tn = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in text.split()]
                _vn = [x for x in _vn if x]
                _tn = [x for x in _tn if x]
                _vn_chunks = [_vn[_i:_i + 8] for _i in range(max(0, len(_vn) - 7))]
                _verbatim = any(_tn[_j:_j + 8] in _vn_chunks for _j in range(max(0, len(_tn) - 7)))
                if _verbatim:
                    issues.append(f"{field_name} quotes its verse verbatim")
                    prompt_issues.append("rule: adult-verbatim")
                _gv = god_work_verb_flag(text, verse_text[ref])
                if _gv:
                    issues.append(f"{field_name} God-plus-work-verb, '{_gv}' not in verse")
                    prompt_issues.append("rule: adult-work-verb")
                # v29, Nov 5, 2026: the application anchor
                # check, bodyToday only. A paragraph that
                # shares zero content words with its verse
                # is not applying that verse. The Golden
                # Thread 3 Thursday application (a
                # woodworking metaphor for Revelation
                # 22:1-5) and Friday application (weekend
                # planning for Acts 1:9-11) both score
                # zero; Monday, Tuesday, Wednesday score 2
                # or more. Zero overlap is a content issue
                # (+100), so a clean attempt beats it, and
                # the retry names the verse's words.
                if field_name == "bodyToday" and verse_word_overlap_count(text, verse_text[ref]) == 0:
                    issues.append(f"{field_name} does not use any word from its verse")
                    prompt_issues.append("rule: adult-today-anchor")
                # v37, Nov 6, 2026: the grounding check. A
                # paragraph that shares zero content words
                # with the SOURCE (sermon excerpt + study
                # material, verse words excluded) is a full
                # take: it wrote about the verse without
                # using the source. Zero is a content issue
                # (+100), so a grounded attempt beats it and
                # the retry names the source. Applies to all
                # four fields, not just bodyToday. If the
                # source is empty (no sermon excerpt and no
                # Phos for this verse), the check is skipped:
                # there is nothing to ground in.
                if source_block and source_word_overlap_count(text, source_block, verse_text[ref]) == 0:
                    issues.append(f"{field_name} does not use any word from the source material")
                    prompt_issues.append("rule: adult-source-grounding")
            attempts_log.append({"section": f"{tag}-{day}-{field_name}", "kind": "adult_field", "attempt": attempt + 1, "words": w, "issues": len(issues), "issue_text": "; ".join(issues)})
            score = -abs(w - target)
            # v20: content issues get +100 effective
            # issues, so a clean attempt beats a content
            # bad attempt even if farther from target.
            # V19 Fri Says: 29 words length only versus
            # 47 words verbatim only, both 1 issue,
            # distance favored the verbatim attempt, so
            # a BLOCK shipped. If all attempts have
            # content issues, +100 applies to all, tie
            # still breaks on distance, as before.
            _content = any("quotes its verse verbatim" in i or "God-plus-work-verb" in i or "copies the length example verbatim" in i or "copies a sentence from the length example" in i or "does not use any word from its verse" in i or "does not use any word from the source material" in i for i in issues)
            _effective = len(issues) + (100 if _content else 0)
            if _effective < best_issues or (_effective == best_issues and score > best_score):
                best_text, best_issues, best_score = text, _effective, score
            if not issues:
                return text, title_out
        # v23: one verbatim paraphrase call, before
        # expansion, if best text is still verbatim.
        # Best verbatim implies no clean attempt existed,
        # because v20 selection gives a clean attempt
        # effective 1 versus verbatim effective 101.
        # Accept if NOT verbatim, even if short or
        # work-verb, because verbatim is a BLOCK and
        # work-verb is a warning, and expansion below
        # can lengthen a clean short paraphrase.
        if best_text:
            _vn_p = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in verse_text[ref].split()]
            _tn_p = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in best_text.split()]
            _vn_p = [x for x in _vn_p if x]
            _tn_p = [x for x in _tn_p if x]
            _vn_chunks_p = [_vn_p[_i:_i + 8] for _i in range(max(0, len(_vn_p) - 7))]
            _best_verbatim = any(_tn_p[_j:_j + 8] in _vn_chunks_p for _j in range(max(0, len(_tn_p) - 7)))
            if _best_verbatim:
                _para_text = paraphrase_field(best_text, field_name, target, ref)
                if _para_text:
                    _vn_q = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in verse_text[ref].split()]
                    _tn_q = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in _para_text.split()]
                    _vn_q = [x for x in _vn_q if x]
                    _tn_q = [x for x in _tn_q if x]
                    _vn_chunks_q = [_vn_q[_i:_i + 8] for _i in range(max(0, len(_vn_q) - 7))]
                    _para_verbatim = any(_tn_q[_j:_j + 8] in _vn_chunks_q for _j in range(max(0, len(_tn_q) - 7)))
                    _para_gv = god_work_verb_flag(_para_text, verse_text[ref])
                    _para_issues = []
                    if _para_verbatim:
                        _para_issues.append(f"{field_name} quotes its verse verbatim")
                    if _para_gv:
                        _para_issues.append(f"{field_name} God-plus-work-verb, '{_para_gv}' not in verse")
                    if wc(_para_text) < low or wc(_para_text) > high:
                        _para_issues.append(f"{field_name} {wc(_para_text)} words, outside {low}-{high}")
                    attempts_log.append({"section": f"{tag}-{day}-{field_name}-paraphrase", "kind": "adult_field", "attempt": 1, "words": wc(_para_text), "issues": len(_para_issues), "issue_text": "; ".join(_para_issues)})
                    if not _para_verbatim:
                        print(f"Adult {day} {field_name} paraphrase: verbatim removed, {wc(best_text)} -> {wc(_para_text)} words, keeping paraphrase.")
                        best_text = _para_text
                    else:
                        print(f"Adult {day} {field_name} paraphrase still verbatim, keeping original, needs pastor edit.")
                else:
                    print(f"Adult {day} {field_name} paraphrase returned empty, keeping original verbatim text, needs pastor edit.")
        if best_text and wc(best_text) < low:
            expanded = expand_field(best_text, field_name, target - wc(best_text))
            if wc(expanded) > wc(best_text):
                # v20: expansion guard, do not let
                # expansion undo the selection fix. If
                # the original was clean and the expanded
                # text is verbatim or work-verb, keep it.
                _orig_content = god_work_verb_flag(best_text, verse_text[ref]) is not None
                _exp_content = god_work_verb_flag(expanded, verse_text[ref]) is not None
                _vn2 = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in verse_text[ref].split()]
                _tn2 = [re.sub(r"[^a-z0-9]", "", x.lower()) for x in expanded.split()]
                _vn2 = [x for x in _vn2 if x]
                _tn2 = [x for x in _tn2 if x]
                _vn_chunks = [_vn2[_i:_i + 8] for _i in range(max(0, len(_vn2) - 7))]
                _exp_verbatim = any(_tn2[_j:_j + 8] in _vn_chunks for _j in range(max(0, len(_tn2) - 7)))
                if not _orig_content and (_exp_content or _exp_verbatim):
                    print(f"Adult {day} {field_name} expansion introduced a content issue, keeping original {wc(best_text)} words.")
                else:
                    print(f"Adult {day} {field_name} expansion: {wc(best_text)} -> {wc(expanded)} words.")
                    best_text = expanded
            else:
                print(f"Adult {day} {field_name} expansion did not increase words, keeping original {wc(best_text)} words.")
        return best_text, title_out

    adult, kid = [], []
    # v37, Nov 6, 2026: read the sermon ONCE, before the day
    # loop, so the per-verse excerpts can ground every prompt
    # (not just the cover snapshot). The snapshot block below
    # reuses this text; it does not re-read the file. The
    # excerpts map each verse to the sermon section about it
    # (max 300 words, never the full sermon in a prompt).
    # When there is no sermon, every excerpt is "" and the
    # source is Phos only.
    sermon_text_full = None
    if sermon_file:
        try:
            sermon_text_full = Path(sermon_file).read_text(encoding="utf-8")
        except Exception as e:
            print(f"Sermon file unreadable, no snapshot: {e}")
    sermon_excerpts = {}
    if sermon_text_full and sermon_text_full.strip():
        for _r, _a in zip(refs, angles):
            _entry = phos.get(_r, {})
            _lex_terms = []
            for _w in _entry.get("lexicon", []):
                _lex_terms.append(f"{_w.get('transliteration', '')} {_w.get('gloss', '')} {_w.get('definition', '')}")
            sermon_excerpts[_r] = sermon_excerpt_for_ref(sermon_text_full, verse_text.get(_r, ""), _a, _lex_terms)
            if sermon_excerpts[_r]:
                print(f"Sermon excerpt {_r}: {len(sermon_excerpts[_r].split())} words.", flush=True)
    for day_index, (day, ref, angle) in enumerate(zip(DAYS, refs, angles)):
        report(day_index * 2, f"Building {day}")
        # v40, Nov 7, 2026: the day's source. Built for EVERY day,
        # whether the adult section is rebuilt or reused from
        # checkpoint, because the leader questions (built after the
        # day loop) need the study notes too, and a resume must not
        # lose them. The notes are cached in the checkpoint, so each
        # ref costs one notes call per job, not one per resume.
        # v37, Nov 6, 2026: the source block for this day. The
        # sermon excerpt for this verse (if any) plus the Phos study
        # material. The model summarizes this source; it never writes
        # from the verse alone.
        _day_phos = phos_lines(ref)
        _day_sermon = sermon_excerpts.get(ref, "")
        if _day_sermon:
            # Sermon path (UNCHANGED). One shared source block for
            # all four fields, the sermon excerpt plus the Phos
            # study material. The sermon is already devotional-shaped,
            # so no notes stage is needed here.
            _source_block = (
                "Source material. Base this paragraph ONLY on the source material below (the sermon excerpt and the study material). Summarize what the sermon says about this verse and apply it for a family. You may add one concrete family example, but do not introduce an interpretation, application, or teaching that is not in the source. If the sermon excerpt does not address this verse, use the study material.\n"
                f"Sermon excerpt:\n{_day_sermon}\n"
                f"Study material:\n{_day_phos}"
            )
            _field_sources = {fn: _source_block for fn, _, _, _, _, _ in ADULT_FIELDS}
            _topic_notes = None
            _gloss_line = ""
            _gloss_word = ""
        elif _day_phos:
            # v40: topic path. Study notes, per-field. The notes
            # are built once per verse (or reused from the
            # checkpoint on resume) and each field gets ONLY its own
            # note, so the fields cannot repeat each other: bodySays
            # sees the "says" note, bodyMeans the "means" note,
            # bodyToday the "today" note, and bodyClosing all three
            # (it wraps up the day). The Greek and Hebrew words never
            # reach a devotional prompt; the notes carry only the
            # plain English meaning (the gloss).
            # v41, Nov 7, 2026: the gloss (key word + plain meaning)
            # NO LONGER goes in every field's source block. The v40
            # test run proved why: Tuesday defined "tenderhearted"
            # three times (P1, P2, P3), because the gloss was in
            # every field's source and each field that used the word
            # defined it. The gloss now goes to the FIRST field that
            # uses the key word, and to no later field. The key word
            # is extracted from the gloss ("trespasses means ..." ->
            # "trespasses"). The field loop below tracks whether the
            # word has appeared in a paragraph built so far this day
            # (_word_defined); a field gets the gloss line only if
            # the word has not appeared yet. Once a paragraph uses
            # (and defines) the word, later fields do not get the
            # gloss, so they cannot define it again. If no paragraph
            # uses the word, the gloss is never used, and the word
            # stays in the verse (which is in every field's prompt)
            # without a definition in the devotional, which is
            # acceptable. The per-field note text is kept in
            # _topic_notes (without the gloss line); the source block
            # is assembled per-field inside the loop below.
            _notes = (checkpoint.get("notes") or {}).get(ref)
            if not _notes:
                _notes = build_study_notes(ref, angle)
                checkpoint.setdefault("notes", {})[ref] = _notes
                save_checkpoint()
            _gloss = (_notes.get("gloss") or "").strip()
            _gloss_line = f"\nKey word, plain English meaning: {_gloss}" if _gloss else ""
            _m = re.match(r"^(?:to\s+)?([A-Za-z'-]+)\s+means\b", _gloss) if _gloss else None
            _gloss_word = _m.group(1).lower() if _m else (_gloss.split()[0].lower() if _gloss else "")
            _topic_notes = {
                "bodySays": f"Notes on what the verse says:\n{_notes['says']}",
                "bodyMeans": f"Notes on what the verse means:\n{_notes['means']}",
                "bodyToday": f"Notes on how a family lives this today:\n{_notes['today']}",
                "bodyClosing": f"What the verse says: {_notes['says']}\nWhat it means: {_notes['means']}\nHow a family lives it: {_notes['today']}",
            }
            _field_sources = None
        else:
            _field_sources = {fn: "" for fn, _, _, _, _, _ in ADULT_FIELDS}
            _topic_notes = None
            _gloss_line = ""
            _gloss_word = ""
        if day in checkpoint.get("adult", {}) and checkpoint["adult"][day].get("scripture", {}).get("reference") == ref:
            a = checkpoint["adult"][day]
            print(f"Reusing finished adult section: {day}")
        else:
            # v17: adult per-paragraph calls, replacing
            # the 4-field adult call. Each field gets its
            # own call, its own length-anchored example,
            # and minimal context, so the model counts
            # one field at a time, not 4 at once.
            fields = {}
            title = ""
            previous = ""
            # v41, Nov 7, 2026: gloss used-tracking. _word_defined is
            # True once the gloss key word has appeared in a paragraph
            # built so far this day. It starts False for every day.
            _word_defined = False
            for field_name, field_def, target, low, high, example in ADULT_FIELDS:
                include_title = (field_name == "bodySays")
                if _topic_notes is not None:
                    # v41 topic path: assemble this field's source
                    # block here, not before the loop. The field gets
                    # its own note, plus the gloss line ONLY if the
                    # key word has not appeared in any paragraph built
                    # so far this day. Once a paragraph uses (and
                    # defines) the word, later fields do not get the
                    # gloss, so they cannot define it again. The
                    # sermon path and the no-source path use the
                    # pre-built _field_sources dict, unchanged.
                    _src = (
                        "Study notes for this verse. Base this paragraph ONLY on the notes below. Summarize them in your own words. Do not add interpretations or applications that are not in the notes.\n"
                        f"{_topic_notes[field_name]}"
                        f"{_gloss_line if (_gloss_line and not _word_defined) else ''}"
                    )
                else:
                    _src = _field_sources[field_name]
                text, ftitle = call_adult_field(day, ref, angle, field_name, field_def, target, low, high, example, previous, include_title, _src)
                if include_title and ftitle:
                    title = ftitle
                fields[field_name] = text
                # v41: after building this field, check if the gloss
                # key word appeared in it. If so, the word is now
                # introduced (and, because the gloss was in this
                # field's source, defined), and later fields will not
                # get the gloss line.
                if _gloss_word and _gloss_word in re.findall(r"[a-z']+", (text or "").lower()):
                    _word_defined = True
                # v25: negation self-check, bodySays only, before
                # Means/Today/Closing build on it. A meaning flip
                # passes every lexical check, and the Nov 5 JER
                # 23:29 pack proved it. One short model call runs
                # only when the verse turns on a negation; on FLIP,
                # one repair call names the flipping sentence, and
                # the repair is accepted only if the re-check says
                # SAME and it is not verbatim. Otherwise the
                # original stands and the review warning stays.
                # Verdicts land in attempts_log, so the
                # false-positive rate is measurable on real packs.
                if field_name == "bodySays" and text and verse_turns_on_negation(verse_text[ref]):
                    try:
                        _n_verdict, _n_sentence = check_negation_flip(llm, verse_text[ref], text, f"{tag}-{day}-negcheck")
                        attempts_log.append({"section": f"{tag}-{day}-bodySays-negcheck", "kind": "negation_check", "attempt": 1, "words": wc(text), "issues": 0 if _n_verdict == "SAME" else 1, "issue_text": f"negation check: {_n_verdict}" + (f", flipping sentence: {_n_sentence}" if _n_sentence else "")})
                        print(f"Adult {day} negation check: {_n_verdict}" + (f" - {_n_sentence}" if _n_sentence else ""))
                        if _n_verdict == "FLIP":
                            _n_repaired = repair_negation_flip(llm, verse_text[ref], text, _n_sentence, f"{tag}-{day}-negrepair")
                            if _n_repaired:
                                _n_verdict2, _n_sentence2 = check_negation_flip(llm, verse_text[ref], _n_repaired, f"{tag}-{day}-negcheck2")
                                _n_repaired_verbatim = quotes_verse_verbatim(_n_repaired, verse_text[ref])
                                attempts_log.append({"section": f"{tag}-{day}-bodySays-negrepair", "kind": "negation_check", "attempt": 1, "words": wc(_n_repaired), "issues": 0 if _n_verdict2 == "SAME" and not _n_repaired_verbatim else 1, "issue_text": f"negation repair re-check: {_n_verdict2}" + ("; repair quotes its verse verbatim" if _n_repaired_verbatim else "") + (f", flipping sentence: {_n_sentence2}" if _n_sentence2 else "")})
                                if _n_verdict2 == "SAME" and not _n_repaired_verbatim:
                                    text = _n_repaired
                                    fields[field_name] = text
                                    print(f"Adult {day} negation flip repaired.")
                                else:
                                    print(f"Adult {day} negation repair did not clear the flip, keeping original.")
                    except Exception as _n_e:
                        print(f"Adult {day} negation check failed ({_n_e}), keeping original body.")
                if text:
                    previous = previous + ("\n\n" if previous else "") + text
            if not title:
                title = ref
                print(f"Adult {day} title fallback to verse reference {ref}, needs pastor title edit.")
            body = "\n\n".join(fields[k] for k in ("bodySays", "bodyMeans", "bodyToday", "bodyClosing") if fields.get(k))
            a = {"day": day, "title": title, "scripture": {"reference": ref}, "body": body}
                        # Nov 1, 2026, v11, user-approved: prayer is a
            # separate call, not the last field of the body
            # call. Prayer was dropped or shortened in most
            # combined calls, v10 full pack 2/5 hit, 2/5 short,
            # 1/5 missing. A single-field prayer call, with
            # the finished body as context, gets its own 3
            # length tries, so it cannot be crowded out by
            # the 4 body fields. Body prompt above has no
            # prayer key, JSON shape below is body only.
            prayer_result = call_with_length_retry("\n".join([
            "Write ONE prayer. Output JSON ONLY, no markdown, no explanation.",
            f"Day: {day}. Passage: {passage}. Angle: {angle}.",
            f"Scripture for context: {ref} - {verse_text[ref]}",
            f"Adult devotional body for this day, pray about what it says: {a['body']}",
            # v30, Nov 5, 2026: the prayers were not prayers.
            # The old prompt said only "pray about the verse",
            # so the model wrote devotional statements ABOUT
            # God ("We trust that Jesus lives forever...",
            # "We lift our eyes to the sky as we wait for
            # Jesus to return...") that never address Him.
            # A short prayer to God has a shape: address Him
            # directly by name, thank Him for what the verse
            # shows, ask Him to help us live it out, and
            # close in Jesus' name. The prompt now names
            # that shape, so the model writes a prayer TO
            # God, not a statement about Him.
            # v31, Nov 5, 2026: Jeremiah's P.A.T.H. method,
            # which mirrors the Lord's Prayer and fits the
            # app's name (Flockpath). One short clause for
            # each letter, in order: Praise, Apologize,
            # Thanks, Help, then close in Jesus' name. The
            # v30 four-part shape (address, thank, ask,
            # close) is replaced by P.A.T.H., because the
            # v30 prayers were still awkward: they restated
            # the verse in prayer form ("thank you for
            # revealing that we are all under sin", "the
            # path of forgiveness shown in this verse") instead
            # of actually praying. P.A.T.H. forces a real
            # prayer: praise Him, confess to Him, thank Him,
            # ask Him, in His name.
            "Prayer: 30-40 words, at least 2 sentences, in your own words, about this verse and angle and the body above. Use plural voice throughout, us, we, our. Pray about the verse, not the weekday.",
            "This must be a prayer TO God, not a statement about Him. Use the P.A.T.H. shape, one short clause for each part, in this order: (P) Praise - address God by name and praise His greatness and holiness. (A) Apologize - admit where we fail in light of this verse and ask His forgiveness. (T) Thanks - thank Him for what this verse shows us He has done or provided. (H) Help - ask Him for practical help to live this verse out today. Close with 'In Jesus' name, Amen.' Write it in natural prayer words, not as a labeled list: say 'Forgive us for...', not 'Apologize for...'; say 'Thank You for...', not 'Thanks for...'; say 'Help us...', not 'Help, ...'. Do not write a third-person statement such as 'We trust that Jesus lives forever' or 'We lift our eyes as we wait for Jesus'; those talk about God, they do not pray to Him.",
            "CRITICAL JSON RULE: prayer must be ONE string, with exactly ONE 'prayer' key. Never repeat the 'prayer' key.",
            f"JSON shape: {{\"prayer\": \"...\"}}",
        ]), f"{tag}-{day}-prayer", 300, "prayer")
            a = {**a, "prayer": prayer_result.get("prayer", "")}
            checkpoint.setdefault("adult", {})[day] = a
            save_checkpoint()
        adult.append(a)
        report(day_index * 2 + 1, f"Building {day} for kids")
        if day in checkpoint.get("kid", {}):
            k = checkpoint["kid"][day]
            print(f"Reusing finished kid section: {day}")
        else:
            # v38, Nov 6, 2026: kid retelling redesign (Jeremiah).
            # The kid section is now a kid-RELEVANT version of
            # the ADULT devotional for this day, not a simplified
            # version of the verse. Simplified language is not
            # relevance: a child can understand every word of a
            # ritual description and still not care. The adult
            # body already sums up the sermon's take (including
            # its connection to Jesus when the sermon makes one),
            # so the kid retelling inherits that grounding and
            # makes it matter to a child's life, with a concrete
            # example from a child's world. The v37 source block
            # is gone from the kid prompt: the adult body IS the
            # source now, and the sermon excerpt and Phos are
            # already baked into it. The "Retell ONLY the verse"
            # rule is gone too: it blocked the Jesus connection
            # (Jesus is not named in Leviticus 4:13-21, so the
            # model left him out even though the sermon excerpt
            # had him). The new rule names the adult devotional
            # as the source and explicitly keeps its Jesus
            # connection. NOTE on v15: passing the adult body
            # was the "contamination path" in v13/v14 because
            # the kid was supposed to retell ONLY the verse and
            # the adult body leaked Jesus and commentary topics
            # into it with no instruction. v38 reverses that
            # design on purpose: the adult body is the source
            # BY DESIGN now, with an explicit instruction to
            # retell it. Do not "fix" this back to v15 without
            # Jeremiah's approval; the v13/v14 contamination
            # was a missing instruction, not a missing guard.
            _kid_lines = [
            "Write ONE kid devotional for ages 6-10. Output JSON ONLY, no markdown, no explanation.",
            f"Passage: {passage}. Angle: {angle}.",
            f"<VERSE>{ref} - {verse_text[ref]}</VERSE>",
            f"Adult devotional for this day, retell this for a child: {a['body']}",
            ]
            if is_rhetorical_question(verse_text[ref]):
                _kid_lines.append(RHETORICAL_RULE)
            _kid_lines += [
            "Retell the adult devotional above for a child ages 6-10. Keep its meaning, including its connection to Jesus if it has one. Use your own plain simple words, and give one concrete example from a child's life (school, home, friends, playing) so a child understands why it matters to them. Tell it as one short story, in the order that makes sense for a child.",
            # Nov 9, 2026, v48: talk TO the child, not AS the child.
            # The model used to tell the example in first person
            # ("Once I hid a broken lamp..."), which reads as the
            # writer's own memory, not a story for a child. Address
            # the child directly with "you", and use a child in the
            # example ("Imagine you...") instead of "I".
            "Talk directly to the child, using 'you'. Do NOT tell the example as if it happened to you: never start with 'Once I...' or 'I remember...' or 'I hid...'. Use a child in the example instead, like 'Imagine you broke a lamp and hid it because you were scared.'",
            "Write a retelling in about 80-120 words, in your own plain simple words for ages 6-10. Activity: one simple activity a family can do at home in a few minutes.",
            # v26, Nov 5, 2026, Jeremiah's rule: never ask
            # children to draw God the Father. Drawing
            # Jesus is fine. The rule is in the prompt so
            # the model rarely writes it, and the code
            # repair below swaps it to Jesus when it does.
            "Never ask children to draw God the Father. Drawing Jesus is fine.",
            # v34, Nov 6, 2026: keep it gentle for ages 6-10.
            # The retelling is about the adult devotional now,
            # not the verse's ritual steps, so the model does
            # not dwell on horns and burning fat the way the
            # v37 Leviticus retelling did. The gentle rule stays
            # as a guardrail, not as the shaping instruction.
            "Keep it gentle for ages 6-10: say what happened simply, without graphic detail about blood, killing, or sacrifice.",
            "Never copy the verse word for word: do not repeat 5 or more words in a row from the verse.",
            "CRITICAL JSON RULE: retelling must be ONE string, with exactly ONE 'retelling' key. Never repeat the 'retelling' key.",
            f"JSON shape: {{\"day\": \"{day}\", \"retelling\": \"...\", \"activity\": \"...\"}}",
            ]
            k_ret = call_with_length_retry("\n".join(_kid_lines), f"{tag}-{day}-kid", 1100, "kid", a['title'], repeat_penalty=1.0)
            # v25: kid retelling verbatim repair. Same 8-word
            # window as the adult check and the review warning,
            # across the WHOLE retelling, not just the opening
            # sentences. One repair via paraphrase_field (the
            # verse is NOT in its prompt, so the model cannot
            # quote it again); the repair is accepted only when
            # it no longer quotes the verse. Otherwise the
            # original stands and the review warning stays.
            _kid_ret = k_ret.get("retelling", "")
            if _kid_ret and quotes_verse_verbatim(_kid_ret, verse_text[ref]):
                print(f"Kid {day} retelling quotes its verse, paraphrasing.")
                _kid_para = paraphrase_field(_kid_ret, "retelling", 100, ref)
                if _kid_para and not quotes_verse_verbatim(_kid_para, verse_text[ref]):
                    # The paraphrase compresses (proof runs came
                    # back 42-50 words against an 80-120 band), so
                    # lengthen a short clean paraphrase with the
                    # proven expansion call, using only facts
                    # already in it. Re-check verbatim after
                    # expanding; if the expansion reintroduces a
                    # quote, keep the short clean paraphrase and
                    # let the review length note stand.
                    if wc(_kid_para) < 80:
                        _kid_expanded = expand_field(_kid_para, "retelling", 80 - wc(_kid_para))
                        if _kid_expanded and not quotes_verse_verbatim(_kid_expanded, verse_text[ref]):
                            _kid_para = _kid_expanded
                            print(f"Kid {day} retelling paraphrase expanded to {wc(_kid_para)} words.")
                    k_ret["retelling"] = _kid_para
                    attempts_log.append({"section": f"{tag}-{day}-kid", "kind": "kid", "attempt": 1, "words": wc(_kid_para), "issues": 0, "issue_text": "retelling quoted its verse verbatim, paraphrased clean"})
                    print(f"Kid {day} retelling paraphrased clean.")
                else:
                    attempts_log.append({"section": f"{tag}-{day}-kid", "kind": "kid", "attempt": 1, "words": wc(_kid_ret), "issues": 1, "issue_text": "retelling quotes its verse verbatim, paraphrase did not clear it, needs pastor review"})
                    print(f"Kid {day} retelling still quotes its verse after paraphrase, needs pastor review.")
            # v16: kid quality flags, printed, not retried.
            # Weekday names, low verse overlap, and God
            # plus a human-work verb not in the verse are
            # pastor-review flags, because a retry on these
            # judgement issues is not reliable in a 4B model.
            _wd = weekday_in_text(k_ret.get("retelling", ""))
            if _wd:
                print(f"Kid {day} weekday flag: retelling contains '{_wd}', needs pastor review.")
            _ov = verse_overlap_fraction(k_ret.get("retelling", ""), verse_text[ref])
            if _ov < 0.25:
                print(f"Kid {day} verse overlap low {_ov:.2f}, needs pastor review.")
            _gv = god_work_verb_flag(k_ret.get("retelling", ""), verse_text[ref])
            if _gv:
                print(f"Kid {day} God-plus-work-verb flag: '{_gv}' not in verse, needs pastor review.")
            # v26: draw-God activity repair, Nov 5, 2026,
            # Jeremiah's rule. The prompt now says never
            # to draw God, but when the model still does,
            # the app swaps the drawn object to Jesus in
            # place (fix_draw_god_activity), instead of
            # leaving it for the pastor to catch. No model
            # retry: a retry prompt naming it would prime
            # repetition, same reason as overlap. Logged
            # in attempts, so a swap is measurable. If
            # the swap changes nothing, the original
            # stands and the review warning stays.
            if draw_god_activity_flag(k_ret.get("activity", "")):
                _fixed_act = fix_draw_god_activity(k_ret.get("activity", ""))
                if _fixed_act != k_ret.get("activity", ""):
                    k_ret["activity"] = _fixed_act
                    attempts_log.append({"section": f"{tag}-{day}-kid-activity", "kind": "kid_activity", "attempt": 1, "words": len(_fixed_act.split()), "issues": 0, "issue_text": "draw-God swapped to Jesus"})
                    print(f"Kid {day} draw-God activity swapped to Jesus.")
                else:
                    print(f"Kid {day} draw-God activity flag: activity asks children to draw God, needs pastor review.")
            # v15: title after body. Prompt never names a
            # banned topic, code checks the title against
            # verse words only. Fallback is the verse
            # reference itself, boring and correct, which
            # beats an invented wrong title. A fallback
            # title is a pastor-edit flag, not a silent pass.
            kid_title = None
            prev_title_issue = "title-rule"
            # v26, Nov 5, 2026: the title must use a word
            # from the verse, but the prompt buried the
            # short verse under a long retelling, so the
            # model picked retelling words and failed
            # no-verse-word (Psalm 23: 3 of 10 attempts,
            # Wed failed both and fell back to the verse
            # reference). List the usable verse words
            # outright, so the model selects instead of
            # recalling, and repeat the list on retry.
            _verse_words = sorted(set(w for w in norm_text(verse_text[ref]).split() if w not in STOPWORDS and w not in BANNED_TITLE_WORDS))
            _verse_word_line = f"using at least one of these words from the verse: {', '.join(_verse_words)}." if _verse_words else "using at least one word from the verse above."
            for title_attempt in range(3):
                title_prompt = "\n".join([
                "Write ONE kid title for ages 6-10. Output JSON ONLY, no markdown, no explanation.",
                f"<VERSE>{ref} - {verse_text[ref]}</VERSE>",
                f"Kid retelling for this verse: {k_ret.get('retelling', '')}",
                # v21: do NOT name the adult title text
                # here, because naming it primes the model
                # to copy it, as in v20 Thu. Code still
                # checks duplicate after, with a['title'].
                "Give a title different from the adult title for this day, do not reuse it.",
                f"Title: 2-6 words, simple words a child knows, about the verse above, {_verse_word_line}",
                'JSON shape: {"title": "..."}',
                ])
                if title_attempt > 0:
                    # v21: name the actual issue, not
                    # generic title-rule, and never name
                    # the adult title text or banned word.
                    title_prompt += f"\n\nPrevious title failed rule: {prev_title_issue}. Write a different title, {_verse_word_line}"
                try:
                    title_result = call_model(llm, title_prompt, f"{tag}-{day}-kid-title-a{title_attempt}", max_tokens=200)
                except Exception as e:
                    print(f"Kid title call failed: {e}")
                    # v19: log kid title failures in attempts,
                    # so a Thu style fallback is measurable.
                    attempts_log.append({"section": f"{tag}-{day}-kid-title", "kind": "kid_title", "attempt": title_attempt + 1, "words": 0, "issues": 1, "issue_text": f"JSON failed: {e}"})
                    break
                cand = (title_result.get("title") or "").strip()
                # v19: log every kid title attempt, same
                # reason as the Mac change, Thu v18 title
                # failed twice with no record of what was tried.
                # v20: distinguish the reason, so a Tue
                # style adult-duplicate is not reported
                # as a verse-word failure.
                _tissue = kid_title_issue(cand, verse_text[ref], a['title'])
                _tok = _tissue == ""
                attempts_log.append({"section": f"{tag}-{day}-kid-title", "kind": "kid_title", "attempt": title_attempt + 1, "words": len(cand.split()), "issues": 0 if _tok else 1, "issue_text": "" if _tok else _tissue})
                if not _tok:
                    prev_title_issue = _tissue
                if _tok:
                    kid_title = cand
                    break
                print(f"Kid title failed {_tissue}, retrying with rule ID only.")
            if not kid_title:
                kid_title = ref
                print(f"Kid title fallback to verse reference {ref}, needs pastor title edit.")
            k = {"day": day, "title": kid_title, "retelling": k_ret.get("retelling", ""), "activity": k_ret.get("activity", "")}
            checkpoint.setdefault("kid", {})[day] = k
            save_checkpoint()
        kid.append(k)

    report(10, "Writing leader questions")
    if checkpoint.get("questions"):
        questions = checkpoint["questions"]
        print("Reusing finished questions section.")
    else:
        # Oct 31, 2026, meat expansion: leader questions get
        # Phos context too, which they never had before, and
        # a structure, not just "5 questions". Notes are
        # 40-70 words, with what a good answer sounds like,
        # where to point in the text, and a follow-up.
        # v15: one call per leader question. A single call
        # for 5 questions drifts to all interpretation, the
        # model's default, and one failure poisons all 5.
        # Each call gets ONE type, ONE verse, ONE starter,
        # and a generic example, never other questions'
        # drafts. Type is baked into the call, not just
        # labelled in a list. Application questions are
        # checked in code for an action word or this week,
        # and regenerated once if they lack one.
        question_specs = [
            ("observation", "What the verse says, answerable by pointing at the verse", "What does", "What does the verse say happened?"),
            ("interpretation", "What the verse means, explaining meaning, not just restating it", "What does it mean when", "What does this show about God's character?"),
            ("interpretation", "What the verse means, a second angle", "How does", "How does this change how we see God?"),
            ("application", "What the group will DO this week, with a concrete action", "What will you do this week to", "What will you do this week to rest?"),
            ("application", "What the group will DO this week, a second concrete action", "How can you plan", "How can you plan time this week to help someone?"),
        ]
        # Nov 5, 2026, demo-pack rebuild: step 13 is the
        # longest section (5 questions x up to 3 length
        # retries), and the old code checkpointed only after
        # all 5 were done, so a timeout restarted the whole
        # section from scratch. Each finished question is now
        # checkpointed as it lands (keyed by question number,
        # so a skipped question cannot shift the mapping),
        # and a resume picks up mid-section. The partial key
        # is cleared once the section completes.
        done = dict(checkpoint.get("questions_partial") or {})
        if done:
            print(f"Reusing {len(done)} finished leader questions.")
        for qi, (qtype, qdef, starter, example) in enumerate(question_specs, 1):
            if str(qi) in done:
                continue
            qref = refs[qi - 1]
            def _leader_prompt():
                # v39, Nov 6, 2026: the question is anchored to the
                # verse AND the resource (Jeremiah, Nov 6, 2026:
                # everything is anchored to a verse and a resource).
                # Before v39 the instruction was "Base this question
                # ONLY on the source material below", so a topic pack
                # built its questions from the commentary's phrasing
                # ("Christianity produces true courteousness... in our
                # countenance, language, and manners") and from the
                # lexicon ("the original meaning of the word for
                # complaint"), not from the verse. Now the verse's own
                # words carry the question's language, and the source
                # material gives the depth.
                _q_sermon = sermon_excerpts.get(qref, "")
                _q_notes = (checkpoint.get("notes") or {}).get(qref)
                _q_phos = phos_lines(qref)
                if _q_sermon:
                    _q_source = (
                        "Source material. This question must be anchored to the verse above AND to the source material below (the sermon excerpt and the study material). Use the verse's own words for the question's language, and use the source material to understand what the verse means and to go deeper. Do not introduce a topic or application that is not in the verse and the source. If the sermon excerpt does not address this verse, use the study material.\n"
                        f"Sermon excerpt:\n{_q_sermon}\n"
                        f"Study material:\n{_q_phos}"
                    )
                elif _q_notes:
                    # v40, Nov 7, 2026: topic path. The leader
                    # question uses the study notes (plain,
                    # verse-anchored, three distinct angles) rather
                    # than the raw Phos lines, so it is even more
                    # verse-centered. The notes were built in the day
                    # loop and cached in the checkpoint; a resume of
                    # an older checkpoint without notes falls through
                    # to the raw Phos block below.
                    # v42, Nov 7, 2026: the gloss line is NOT passed
                    # to the leader prompt. The v41 leader questions
                    # carried the definition inside the question
                    # itself ("trespasses, which means the wrongs and
                    # offenses done against someone"), which made them
                    # wordy. The family already read the definition
                    # in the devotional, so the question does not need
                    # to define the word again. The notes (says/means/
                    # today) already use plain language, so the
                    # definition is not needed here. The devotional
                    # fields still get the gloss (via the v41
                    # used-tracking), so the definition is still in
                    # the pack, just not in the leader questions.
                    _q_source = (
                        "Study notes for this verse. This question must be anchored to the verse above AND to the study notes below. Use the verse's own words for the question's language, and use the study notes to understand what the verse means and to go deeper. Do not introduce a topic or application that is not in the verse and the notes.\n"
                        f"Study notes:\nWhat the verse says: {_q_notes['says']}\nWhat it means: {_q_notes['means']}\nHow a family lives it: {_q_notes['today']}"
                    )
                elif _q_phos:
                    _q_source = (
                        "Source material. This question must be anchored to the verse above AND to the study material below. Use the verse's own words for the question's language, and use the study material to understand what the verse means and to go deeper. Do not introduce a topic or application that is not in the verse and the material.\n"
                        f"Study material:\n{_q_phos}"
                    )
                else:
                    _q_source = ""
                _lp = [
                "Write ONE small-group question. Output JSON ONLY, no markdown, no explanation.",
                f"Passage: {passage}. Verse for this question: <VERSE>{qref} - {verse_text[qref]}</VERSE>",
                "Other verses in the passage, by reference only, do not quote them: " + ", ".join(refs),
                ]
                if _q_source:
                    _lp.append(_q_source)
                # v39, Nov 6, 2026: voice block (item 1), and the
                # no-word-study rule. A Greek or Hebrew word is fine
                # in a question only if its plain English meaning is
                # given right beside it; a question must never be a
                # word study for its own sake.
                _lp.append(VOICE_BLOCK)
                _lp.append("Do not ask about the original language as an end in itself; ask a question a family can discuss or act on together.")
                _lp += [
                f"Question type: {qtype}. Definition: {qdef}.",
                f"Start your question with: {starter}",
                f"Example of this type, generic, not about this passage: {example}",
                "Note fields, each ONE string, exactly ONE key each: goodAnswer (2 sentences, roughly 20-30 words, what a good answer sounds like, in third person, describing what a good answer would say. Do NOT answer the question yourself in first person, starting with 'I will...' or 'I can...'), textPoint (1 complete sentence, roughly 10-20 words, telling the leader exactly where to point in the verse, starting with 'Point to' or 'Look at'. Never copy a verse fragment and never write just a reference such as 'verse 39.'), followUp (1 question, roughly 10-20 words, a follow-up to ask if the group goes quiet).",
                'JSON shape: {"question": "...", "goodAnswer": "...", "textPoint": "...", "followUp": "..."}',
                ]
                return chr(10).join(_lp)
            try:
                qraw = call_with_length_retry(_leader_prompt(), f"{tag}-questions-q{qi}", 1200, "leader_question")
                qnorm = normalize({"leaderQuestions": [qraw]})["leaderQuestions"][0]
            except Exception as e:
                print(f"Leader Q{qi} failed, will try repair later: {e}")
                continue
            if qtype == "application" and not is_application_question(qnorm.get("question", "")):
                print(f"Leader Q{qi} application check failed, regenerating once with action starter.")
                try:
                    qraw2 = call_with_length_retry(_leader_prompt() + " This must be an application question, with a concrete action the group will do this week.", f"{tag}-questions-q{qi}-app", 1200, "leader_question")
                    qnorm2 = normalize({"leaderQuestions": [qraw2]})["leaderQuestions"][0]
                    if is_application_question(qnorm2.get("question", "")):
                        qnorm = qnorm2
                    else:
                        print(f"Leader Q{qi} still lacks action wording, keeping for pastor review.")
                except Exception as e:
                    print(f"Leader Q{qi} application regeneration failed: {e}")
            done[str(qi)] = qnorm
            checkpoint["questions_partial"] = done
            save_checkpoint()
        questions = {"leaderQuestions": [done[str(i)] for i in range(1, 6) if str(i) in done]}

    # Overnight Oct 31, 2026, Step 3: auto-repair for leader
    # questions. The final 4B model returns 3 to 5 questions
    # when asked for 5 (Genesis gave 3 twice). One targeted
    # repair call asks for exactly the missing count, about
    # the passage verses, with existing questions listed as
    # do-not-repeat. On parse failure it logs and keeps the
    # original questions, it never crashes the pack, and the
    # quality gate will still flag a short leader page for a
    # human rather than silently locking it.
    if len(questions.get("leaderQuestions", [])) < 5:
        missing = 5 - len(questions["leaderQuestions"])
        existing_qs = [q["question"] for q in questions["leaderQuestions"]]
        try:
            # v38, Nov 6, 2026: the repair prompt carries the
            # Phos study material for each verse, so the repair
            # questions are source-grounded like the main
            # leader questions (v37). Before v38 it listed only
            # the verses, so a repair was a full take with no
            # source. The sermon excerpts are per-verse and the
            # repair covers several verses at once, so Phos is
            # the source here; the main questions still get the
            # sermon excerpt when there is one.
            # v40, Nov 7, 2026: on the topic path the repair
            # uses the study notes (plain, verse-anchored)
            # instead of the raw Phos lines, the same as the
            # main leader prompt. A ref with a sermon excerpt
            # still uses Phos here (the repair covers several
            # verses at once, and the sermon excerpts are
            # per-verse); the main questions still get the
            # sermon excerpt when there is one.
            _repair_parts = []
            for r in refs:
                _rn = (checkpoint.get("notes") or {}).get(r)
                if _rn:
                    # v42, Nov 7, 2026: the gloss line is NOT passed
                    # to the leader repair prompt either, for the same
                    # reason as the main leader prompt (the v41
                    # questions carried the definition inside the
                    # question, which made them wordy).
                    _repair_parts.append(f"Study notes for {r}:\nWhat the verse says: {_rn['says']}\nWhat it means: {_rn['means']}\nHow a family lives it: {_rn['today']}")
                elif phos_lines(r):
                    _repair_parts.append(f"Study material for {r}:\n{phos_lines(r)}")
            _repair_source = "\n".join(_repair_parts)
            _repair_lines = [
                f"Write exactly {missing} MORE small-group questions, no more, no fewer. Output JSON ONLY, no markdown, no explanation.",
                f"Passage: {passage}. Verses: {', '.join(f'{r} - {verse_text[r]}' for r in refs)}",
            ]
            if _repair_source:
                # v39, Nov 6, 2026: same verse-and-resource anchor as
                # the main leader prompt, plus the voice block, so a
                # repair question is not a word study or a commentary
                # paraphrase either. v40, Nov 7, 2026: the resource
                # is the study notes on the topic path (or the study
                # material where there are no notes).
                _repair_lines.append("Anchor each question to its verse AND to the study notes or study material below for that verse. Use the verse's own words for the question's language, and use the study notes or study material to understand what the verse means and to go deeper. Do not add interpretations or applications that are not in the verse and the notes or material.")
                _repair_lines.append(VOICE_BLOCK)
                _repair_lines.append("Do not ask about the original language as an end in itself; ask a question a family can discuss or act on together.")
                _repair_lines.append(_repair_source)
            _repair_lines += [
                "Do NOT repeat any of these existing questions, and do NOT repeat each other:",
                *[f"- {q}" for q in existing_qs],
                "Each new question must start differently from the existing questions and from each other.",
                "Each leaderNote must be 40-70 words: what a good answer sounds like, where to point in the text, and one follow-up question.",
                '{"leaderQuestions": [{"question": "...", "leaderNote": "..."}]}',
            ]
            extra = call_model(llm, "\n".join(_repair_lines), f"{tag}-questions-repair", max_tokens=1800)
            seen = set(existing_qs)
            for q in extra.get("leaderQuestions", []):
                if q.get("question") and q["question"] not in seen:
                    questions["leaderQuestions"].append(q)
                    seen.add(q["question"])
            print(f"Leader-question repair: asked for {missing}, now have {len(questions['leaderQuestions'])}.")
        except Exception as e:
            print(f"Leader-question repair failed, keeping {len(questions['leaderQuestions'])} questions for quality-gate review: {e}")

    # Nov 2, 2026, pastor decision: every leader note ends
    # with a verse to read, so the group opens their Bibles.
    # Deterministic, in code, not model-written: Q1 reads the
    # Monday verse, Q2 the Tuesday verse, and so on, in
    # order. Only verses already in the pack are used, never
    # a new citation, and the pastor can edit or remove it
    # in review. The quality gate strips this trailing
    # sentence before counting note words, so it does not
    # push a 40-70 word note out of band.
    for _i, _q in enumerate(questions.get("leaderQuestions", [])):
        if _i < len(adult):
            _ref = adult[_i]["scripture"]["reference"]
            _note = (_q.get("leaderNote") or "").rstrip()
            # Nov 2, 2026: the Read directive sits in
            # parentheses, so it reads as an instruction
            # apart from the note prose, not as another
            # sentence of the answer. Brackets were not
            # used: in study material they read as an
            # editorial insertion, not a direction.
            if _note and not _note.endswith(f"(Read {_ref}.)"):
                _q["leaderNote"] = f"{_note} (Read {_ref}.)"
    checkpoint["questions"] = questions
    checkpoint.pop("questions_partial", None)
    save_checkpoint()

    # Nov 5, 2026, v24 sermon snapshot (see helpers above):
    # runs after the leader questions, before the draft is
    # written, inside this same model process, so no second
    # model load. The full sermon text rides in the draft
    # only alongside a successful snapshot, so the quote can
    # be re-verified at lock time; the model itself only
    # ever sees the trimmed head.
    # v37: sermon_text_full was read before the day loop
    # (for the per-verse excerpts); reuse it here, do not
    # re-read the file.
    sermon_snapshot = None
    if sermon_file:
        if sermon_text_full and len(sermon_text_full.split()) >= SERMON_MIN_WORDS:
            # v36: retry + fail loudly, see the helper above.
            # A failure here raises out of main(), so no draft
            # is written without a snapshot.
            sermon_snapshot = build_sermon_snapshot_with_retry(llm, sermon_text_full, tag)
        elif sermon_text_full:
            print(f"Sermon text too short for a snapshot ({len(sermon_text_full.split())} words, needs {SERMON_MIN_WORDS}); no snapshot.", flush=True)

    # Nov 2, 2026, pastor decision: original choruses are
    # REMOVED. The model-built choruses were not good enough
    # to sing, and a bad song hurts trust more than no song.
    # Song page is now hymn-only: if the hymn matcher below
    # finds a verified public-domain hymn, that is the song;
    # if it finds none, the pack has no song section at all.
    # No model chorus call, no chorus checkpoint, no chorus
    # key in the draft. Legacy locked packs that already
    # carry a chorus still render in the PDF builder, so
    # old packs do not break.
    draft = {
        "id": tag.lower(),
        "title": f"{passage} Family Pack",
        "passage": passage,
        "pastorName": "Sample Pastor",
        "church": "Sample Church",
        "memoryVerse": {"reference": refs[0]},
        "adultDevotionals": adult,
        "kidDevotionals": kid,
        "leaderQuestions": questions["leaderQuestions"],
        "coloring": {
            "title": f"{passage} Coloring",
            "description": f"A coloring page for {passage}.",
            # Nov 1, 2026: PNG library id, not the old SVG id.
            # The PDF builder and review page fall back to
            # matchColoring() if this id is ever stale.
            "svgTemplateId": "creation-sky-sea",
        },
    }
    if sermon_snapshot:
        draft["sermonSnapshot"] = sermon_snapshot
        draft["sermonText"] = sermon_text_full
    if phos_devotionals:
        draft["classicDevotional"] = phos_devotionals[0]
    # Nov 2, 2026, denomination labels: carry the bundle's voices
    # as metadata so review can show them labeled and the PDF
    # leader page can list them. Metadata only: no generated
    # text, no prompt change, no gate change. The classic
    # devotional above already carries its labels; this list
    # adds the commentary voices and the full devotional rotation.
    comm_seen, comm_voices = set(), []
    for v in phos.values():
        for c in v.get("commentary", []):
            if c["source"] in comm_seen:
                continue
            comm_seen.add(c["source"])
            comm_voices.append({
                "source": c["source"], "title": c.get("title", c["source"]),
                "tradition": c.get("tradition"),
                "tradition_label": c.get("tradition_label"),
                "sensitivity": c.get("sensitivity"),
            })
    draft["phosVoices"] = {
        "commentary": comm_voices,
        "devotionals": [{
            "source": d["source"],
            "title": d.get("workTitle") or d["title"],
            "tradition": d.get("tradition"),
            "tradition_label": d.get("tradition_label"),
            "sensitivity": d.get("sensitivity"),
        } for d in phos_devotionals],
    }
    # Nov 1, 2026: hymn hookup, deterministic, no model cost.
    # generate_from_plan.py still re-runs the same matcher
    # with plan topics afterwards and overwrites these
    # fields when it finds candidates, so plan topics win
    # there; here, angles are the topics, which is strictly
    # better than no hymn at all for a direct sections run.
    hymn, hymn_candidates = match_hymns(
        [d["scripture"]["reference"] for d in adult],
        sorted({a.strip().lower() for a in angles if a.strip()}))
    if hymn:
        draft["hymn"] = hymn
        draft["hymnCandidates"] = hymn_candidates
    Path(out_path).write_text(json.dumps(draft, ensure_ascii=False, indent=1), encoding="utf-8")
    # v17: attempt log, alongside the draft, for
    # first-pass, repair, and escalation measurement.
    attempts_path = Path(out_path).with_name(Path(out_path).stem + "-attempts.jsonl")
    # v26, Nov 5, 2026: a continued job overwrote the
    # earlier runs' attempts, so a resumed pack lost the
    # record of what the first runs tried (the kid-title
    # "why" question, Nov 5, could only be answered from
    # an older pack's file). Keep the earlier lines and
    # add the new ones, so the file is the whole job's
    # history, not just the last run's.
    _prev = attempts_path.read_text(encoding="utf-8") if attempts_path.exists() else ""
    attempts_path.write_text(_prev + "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in attempts_log), encoding="utf-8")
    checkpoint_path.unlink(missing_ok=True)
    print(f"Wrote {out_path}")
    print(f"Wrote {attempts_path}")
    print("Adult refs:", [d["scripture"]["reference"] for d in adult])
    print("Adult titles:", [d["title"] for d in adult])
    print("Kid titles:", [d["title"] for d in kid])
    print("Song:", draft.get("hymn", {}).get("title") if draft.get("hymn") else "none, no hymn match, no generated chorus")
    print("Questions:", [q["question"] for q in questions["leaderQuestions"]])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
