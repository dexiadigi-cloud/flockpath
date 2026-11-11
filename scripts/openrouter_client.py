"""OpenRouter API client for Flockpath, Nov 9, 2026 (v47).

The pastor can choose OpenRouter instead of the local model, Google
Gemini, or Grok (xAI). This module is the only place that talks to
OpenRouter. It uses Python's standard library only (urllib), so no
new package is needed in .venv or on the Mac. OpenRouter is
OpenAI-compatible: POST to https://openrouter.ai/api/v1/chat/completions
with a Bearer key.

Why OpenRouter (Nov 9, 2026): the cheapest capable model found is
GLM 5.3 Flash (z-ai/glm-5.3-flash, about $0.01 a pack (measured Nov 9)), served
through OpenRouter. Google's Gemini free tier stopped working (403
"free tier is not available for this project"), Grok via Clean APIs
burned its 500K-token free tier on one failed pack and Grok direct
is about $0.10 a pack. GLM is the cheapest route and it had the
best hallucination record in testing (invented 0 of 5 fake
entities). The pastor brings their own OpenRouter key
(openrouter.ai, $5 of credits covers hundreds of packs).

Rules:
1. The API key is never printed, logged, or included in any error
   message. Error messages name the problem (bad key, rate limit,
   OpenRouter busy), never the key or the full request URL.
2. GLM 5.3 Flash is a reasoning model. With no limit it spends
   most of its token budget thinking (359 of 543 completion
   tokens in one test) and can return no content at all when the
   budget runs out. So every call sets reasoning effort to "low",
   which cuts reasoning to zero and the content still comes back
   good. Nov 9, 2026.
3. A 401 means a bad key: fail fast, do not retry. A 402 means
   the account is out of credits: fail fast with a plain-language
   message. A 429 is retried with backoff. A 503 is retried.
   A dropped connection mid-response (IncompleteRead) is retried
   the same way: some OpenRouter providers cut the stream short,
   and a retry usually lands on a clean response.
4. The model is z-ai/glm-5.3-flash by default (cheapest capable,
   about $0.01 a pack (measured Nov 9)). The model name is an env var so a
   different model is a one-line change. The base URL is also an
   env var (FLOCKPATH_OPENROUTER_API_BASE, default
   https://openrouter.ai/api/v1).
5. Generation settings match the local call_model settings:
   temperature 0.3, top_p 0.85.
6. The "do not think" prefix: call_model prefixes every prompt
   with "Do not show any thinking or reasoning. Output JSON
   immediately." That broke the 27B (a reasoning model that
   stopped dead with 0 tokens when told not to think). This
   client strips that prefix and lets the model think at low
   effort; repair_json strips think blocks from the output, so
   the JSON answer still comes through clean. Same fix as
   mlx_client.py and grok_client.py, Nov 9, 2026.
7. A browser-like User-Agent is sent: some gateways sit behind
   Cloudflare, which blocks the default Python User-Agent with
   a 403 (error code 1010). Nov 9, 2026.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.request

OPENROUTER_API_BASE = os.environ.get("FLOCKPATH_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
DEFAULT_MODEL = "z-ai/glm-5.3-flash"

# Plain-language errors the pastor sees. No API codes, no key, no URL.
ERR_BAD_KEY = "That OpenRouter key didn't work. Check the key you pasted, or get a new one from openrouter.ai."
ERR_NO_CREDITS = "Your OpenRouter account is out of credits. Add credits at openrouter.ai, then try again."
ERR_RATE_LIMIT = "OpenRouter is limiting how fast this pack can be built right now. Wait a minute, then tap Continue to pick up where it left off."
ERR_OPENROUTER_BUSY = "OpenRouter didn't answer. Try again in a little while."
ERR_BLOCKED = "OpenRouter declined to write this section. Try again, or switch back to the local model."


class _EmptyResponse(Exception):
    """OpenRouter returned a response with no usable text, but the
    finish reason was not a content filter, so it is a transient
    provider glitch and the call should be retried, not surfaced
    as a refusal. Nov 9, 2026: the demo-pack build on the Mac hit
    ERR_BLOCKED on a section the same model had already written
    fine on the VM, because an empty response was treated as a
    refusal instead of being retried."""


def openrouter_model():
    return os.environ.get("FLOCKPATH_OPENROUTER_MODEL", DEFAULT_MODEL)


def openrouter_generate(prompt, api_key, max_tokens, timeout=120):
    """One OpenRouter call. Returns the response text. Raises RuntimeError
    with a plain-language message on failure."""
    if not api_key:
        raise RuntimeError(ERR_BAD_KEY)
    model = openrouter_model()
    url = OPENROUTER_API_BASE + "/chat/completions"
    # Let a reasoning model think at low effort. Strip the "do not
    # think" prefix call_model adds; repair_json strips the think
    # blocks.
    prompt = prompt.replace(
        "Do not show any thinking or reasoning. Output JSON immediately.",
        "",
    ).strip()
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "top_p": 0.85,
        "max_tokens": max_tokens,
        "reasoning": {"effort": "low"},
    }).encode("utf-8")
    # The key travels as a Bearer token; it is never logged. Any
    # error below reports the problem, never the key or the URL.
    for attempt in range(5):
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + api_key,
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return _extract_text(data)
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 401:
                raise RuntimeError(ERR_BAD_KEY)
            if code == 402:
                raise RuntimeError(ERR_NO_CREDITS)
            if code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            if code == 503:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(ERR_OPENROUTER_BUSY)
        except (urllib.error.URLError, TimeoutError, http.client.IncompleteRead, http.client.HTTPException, ConnectionError):
            # A dropped connection mid-response (IncompleteRead) is
            # a transport failure, not a model refusal. Some
            # OpenRouter providers cut the stream short; retry the
            # call the same way a 429/503 is retried. Nov 9, 2026.
            time.sleep(2 ** (attempt + 1))
            continue
        except _EmptyResponse:
            # No text back, but no content filter either, so this
            # is a transient provider glitch. Retry the call the
            # same way a 429/503 is retried. Nov 9, 2026.
            time.sleep(2 ** (attempt + 1))
            continue
    raise RuntimeError(ERR_OPENROUTER_BUSY)


def _extract_text(data):
    """Pull the text out of a chat-completions response. Raises a
    plain-language error if OpenRouter returned no usable text."""
    choices = data.get("choices") or []
    if not choices:
        raise _EmptyResponse("no choices")
    first = choices[0] or {}
    content = ((first.get("message") or {}).get("content") or "").strip()
    if content:
        return content
    # Empty text. A content filter is a real refusal, so surface it
    # as ERR_BLOCKED and do not retry. Anything else is a transient
    # provider glitch, so raise _EmptyResponse and let the caller
    # retry the call.
    if (first.get("finish_reason") or "") == "content_filter":
        raise RuntimeError(ERR_BLOCKED)
    raise _EmptyResponse(f"empty content, finish_reason={first.get('finish_reason')!r}")
