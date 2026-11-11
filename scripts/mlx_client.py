"""mlx-serve client for Flockpath, Nov 9, 2026 (27B test, v42).

Lets a Flockpath pack be built with the pastor's own Mac model,
Qwen3.8-27B via mlx-serve, instead of the local 4B or Google
Gemini. Wired in for the v42 27B test run (a data point for the
hackathon submission), at Jeremiah's Nov 9, 2026 go-ahead ("Lets
do v42 with the adapter"). Test-only: lib/auth.mjs coerces any
non-gemini backend to "local", so the web UI cannot store "mlx"
yet; the test bypasses the worker/UI with FLOCKPATH_BACKEND=mlx.
A pastor-facing mlx backend would need the worker, auth, and
model-settings changes, plus a Jeremiah-approved decision.

It mirrors gemini_client.py's interface on purpose, so
generate_sections.py can call it the same way: mlx_model() like
gemini_model(), mlx_generate(prompt, api_key, max_tokens,
timeout) like gemini_generate(). The api_key argument is
accepted and ignored: mlx-serve on localhost needs no key.
The same prompt, the same 3-attempt JSON-repair loop in
call_model, the same save_raw audit trail. Only the model
behind the call changes.

Rules:
1. No key, no URL, and no server internals in any error
   message. Errors name the problem (server not running,
   model not loaded, server busy), never the request.
2. No pacing. mlx-serve is localhost with no per-minute
   cap; its --max-concurrent 1 serializes calls server-side.
   The worker already runs one generation at a time.
3. The 27B is a thinking model. call_model already prefixes
   every prompt with "Do not show any thinking or reasoning.
   Output JSON immediately.", and repair_json strips
   <think> blocks, so this client returns the raw content
   and lets that machinery work, exactly like the Gemini
   path. But the model still spends tokens reasoning, and a
   max_tokens tuned for Gemini or the 4B can run out during
   the thinking and leave content empty. Nov 9, 2026: the
   Monday kid call (max_tokens 1100) returned empty content
   twice in a row on the Mac, while the prayer calls worked.
   So this client floors max_tokens at 3000 (room to think
   AND answer) and retries an empty answer once with a
   doubled budget before failing. Check the first raw outputs
   (data/test-raw-<tag>-*.txt) before a full pack: if
   thinking dominates, the budget or the prompt prefix
   needs work before the pack is worth running.
4. Generation settings match the other backends: temperature
   0.3, topP 0.85. topK is NOT sent: it is not part of the
   OpenAI chat-completions shape, and this client sends only
   standard fields until the Mac verifies mlx-serve accepts
   an extra top_k. (Gemini sends topK 20; the local 4B
   sends top_k 20. If the 27B test shows looser output,
   top_k is the first knob to check.)
5. Standard library only (urllib), same as gemini_client.py,
   so no new package is needed in .venv or on the Mac.
6. Retries are for a busy server, not for a dead one. A
   connection-refused means mlx-serve is not running at
   all: fail at once with a plain message, do not retry.
   A 429 or 503 means the server is busy (another request
   is running, e.g. Goose using the same model under
   --max-concurrent 1, or the model is still loading):
   back off and retry. Five attempts, then a plain
   "server busy" error, never a stack trace.
"""
import json
import os
import time
import urllib.error
import urllib.request

MLX_BASE_URL = "http://127.0.0.1:11234"
DEFAULT_MODEL = "Qwen3.8-27B-3bit-mtp-mlx"

# The 27B is slower than Gemini. A 600-token field can take a
# while on the Mac; 300 seconds per call is a starting value,
# not a measured one. Time the smoke test, then adjust.
DEFAULT_TIMEOUT = 300

# The 27B is a thinking model. It spends tokens reasoning
# before it answers, so a max_tokens tuned for Gemini or the
# 4B can run out during the thinking and leave content empty.
# Nov 9, 2026: the Monday kid call (max_tokens 1100) returned
# empty content twice in a row on the Mac. The floor gives the
# model room to think AND answer; the cap bounds the retry.
MLX_MIN_MAX_TOKENS = 3000
MLX_MAX_MAX_TOKENS = 6000

# Plain-language errors the pastor sees. No API codes, no URL.
ERR_NOT_RUNNING = "The Mac model server (mlx-serve) is not running. Start it, then tap Continue to pick up where the pack left off."
ERR_NO_MODEL = "The 27B model is not loaded in mlx-serve. Check that the model is ready, then try again."
ERR_SERVER_BUSY = "The Mac model is busy right now (another request is using it). Wait a minute, then tap Continue to pick up where the pack left off."
ERR_NO_TEXT = "The Mac model answered but gave no usable text. Try again."


def mlx_model():
    return os.environ.get("FLOCKPATH_MLX_MODEL", DEFAULT_MODEL)


def mlx_base_url():
    return os.environ.get("FLOCKPATH_MLX_BASE_URL", MLX_BASE_URL).rstrip("/")


def mlx_status(timeout=10):
    """List the models mlx-serve reports, as (id, state) pairs.
    Used by the smoke test before a pack runs. Raises
    RuntimeError(ERR_NOT_RUNNING) when the server cannot be
    reached at all."""
    url = mlx_base_url() + "/v1/models"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as e:
        raise RuntimeError(ERR_NOT_RUNNING) from e
    out = []
    for m in data.get("data") or []:
        out.append((m.get("id", ""), m.get("state", "")))
    return out


def mlx_generate(prompt, api_key, max_tokens, timeout=DEFAULT_TIMEOUT):
    """One mlx-serve call. Returns the response text. Raises
    RuntimeError with a plain-language message on failure.
    api_key is accepted for interface parity with
    gemini_generate and ignored: localhost needs no key.
    The token budget is floored at MLX_MIN_MAX_TOKENS: the
    27B thinks before it answers, so a budget tuned for
    Gemini or the 4B can run out during the thinking and
    leave content empty. An empty answer is retried with a
    doubled budget (up to MLX_MAX_MAX_TOKENS) before it
    fails, because a single empty sample is not proof the
    prompt is bad.
    Nov 9, 2026: the 27B is a reasoning model. call_model
    prefixes every prompt with "Do not show any thinking or
    reasoning. Output JSON immediately.", which works for
    Gemini and the 4B, but the 27B stopped dead on the Monday
    kid call with 0 tokens generated (diagnostic file
    mlx-empty-response.json: content "", completion_tokens 0,
    finish_reason "stop"). The model cannot answer a complex
    prompt without thinking, so suppressing thinking leaves
    it with nothing to say. This client strips that prefix
    for the mlx backend and lets the model think; repair_json
    strips <think> blocks from the output, so the JSON answer
    still comes through clean."""
    model = mlx_model()
    url = mlx_base_url() + "/v1/chat/completions"
    # Let the reasoning model think. Strip the "do not think"
    # prefix call_model adds; repair_json strips the think
    # blocks from the output.
    prompt = prompt.replace(
        "Do not show any thinking or reasoning. Output JSON immediately.",
        "",
    ).strip()
    budget = max(max_tokens, MLX_MIN_MAX_TOKENS)
    last_kind = None
    empty_retries = 0
    for attempt in range(5):
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "top_p": 0.85,
            "max_tokens": budget,
        }).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            try:
                return _extract_text(data)
            except RuntimeError as e:
                if str(e) != ERR_NO_TEXT:
                    raise
                # Empty content: save the raw response first,
                # so the empty answer can be diagnosed from
                # what the model actually returned (content vs
                # reasoning_content, finish_reason) instead of
                # guessed at. Saved on every empty answer, so
                # the file always holds the latest one.
                _save_empty_diagnostic(data)
                if empty_retries >= 2:
                    raise
                # The thinking model may have spent the budget
                # reasoning. Retry with a larger budget before
                # giving up.
                empty_retries += 1
                budget = min(budget * 2, MLX_MAX_MAX_TOKENS)
                last_kind = "empty"
                time.sleep(2)
                continue
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 404:
                # Unknown model id: the server is up, but the
                # model name is wrong or the model is not
                # registered. Do not burn retries on it.
                raise RuntimeError(ERR_NO_MODEL)
            if code in (429, 503):
                # Busy: another request holds the single slot,
                # or the model is still loading. Back off and
                # retry; a busy server clears, a dead one does
                # not get here (that is URLError below).
                last_kind = "busy"
                time.sleep(2 ** (attempt + 1))
                continue
            last_kind = "busy"
            time.sleep(2 ** (attempt + 1))
            continue
        except urllib.error.URLError as e:
            # Connection refused (or reset) means the server
            # is not listening at all. Waiting will not help,
            # so fail at once instead of burning retries.
            raise RuntimeError(ERR_NOT_RUNNING) from e
        except TimeoutError:
            last_kind = "busy"
            time.sleep(2 ** (attempt + 1))
            continue
    if last_kind == "empty":
        raise RuntimeError(ERR_NO_TEXT)
    raise RuntimeError(ERR_SERVER_BUSY)


def _save_empty_diagnostic(data):
    """Save a raw response that had no usable text, so the empty
    answer can be diagnosed instead of guessed at. Written to
    mlx-empty-response.json in the current directory (the app
    folder when a pack runs). Overwritten on each empty answer,
    so it always holds the latest one. Never raises: a
    diagnostic that crashes the run is worse than none."""
    try:
        summary = dict(data) if isinstance(data, dict) else {"raw": data}
        # Keep it small and readable: the choices block is what
        # matters (content, reasoning_content, finish_reason).
        with open("mlx-empty-response.json", "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=1, ensure_ascii=False)
    except Exception:
        pass


def _extract_text(data):
    """Pull the text out of a chat-completions response. The
    answer is choices[0].message.content; a separate
    reasoning_content field, when present, is the model's
    thinking, not the answer, and is ignored. Raises a
    plain-language error when the server returned no usable
    text."""
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(ERR_NO_TEXT)
    message = (choices[0].get("message") or {})
    text = (message.get("content") or "").strip()
    if not text:
        # Completions-shaped fallback, never expected from
        # the chat endpoint, but harmless to accept.
        text = (choices[0].get("text") or "").strip()
    if not text:
        raise RuntimeError(ERR_NO_TEXT)
    return text
