"""Grok API client for Flockpath, Nov 9, 2026 (v43, xAI API first).

The pastor can choose Grok (xAI) instead of the local model or Google
Gemini. This module is the only place that talks to xAI. It uses
Python's standard library only (urllib), so no new package is needed
in .venv or on the Mac. The xAI API is OpenAI-compatible: POST to
https://api.x.ai/v1/chat/completions with a Bearer key.

Why Grok (Nov 9, 2026): Google's Gemini free tier stopped working —
the API returns 403 "free tier is not available for this project"
even for a fresh key, so pastors would be blocked too. Grok is paid
(no sustained free tier; a $25 signup credit expires in 30 days),
but it works, and the cheapest model is about $0.03 a pack. The demo
pack was still built with Gemini (when free worked); Grok is the API
going forward. Gemini stays as a paid option.

Rules:
1. The API key is never printed, logged, or included in any error
   message. Error messages name the problem (bad key, rate limit,
   Grok busy), never the key or the full request URL.
2. No pacing: xAI's rate limits are generous (Tier 0 allows far more
   requests per second than a pack ever fires), so a pack does not
   need the 5-second pacing the Gemini client uses. A 429 is still
   retried with backoff.
3. A 401 means a bad key: fail fast, do not retry. A 429 is retried
   with exponential backoff. A 503 is retried. Any other HTTP error
   fails at once as Grok busy.
4. The model is grok-4.1-fast by default (cheapest, $0.20 input /
   $0.50 output per 1M tokens, about $0.03 a pack). The model name
   is an env var so a different model is a one-line change.
   The base URL is also an env var (FLOCKPATH_GROK_API_BASE,
   default https://api.x.ai/v1): a third-party OpenAI-compatible
   gateway (for example Clean APIs, 5M free tokens a month, Grok
   4.6) can be used instead by pointing the base URL at that
   gateway and setting FLOCKPATH_GROK_MODEL to the model ID it
   serves. The client sends the same chat-completions shape
   either way.
5. Generation settings match the local call_model settings:
   temperature 0.3, top_p 0.85.
6. The "do not think" prefix: call_model prefixes every prompt
   with "Do not show any thinking or reasoning. Output JSON
   immediately." That broke the 27B (a reasoning model that
   stopped dead with 0 tokens when told not to think). Grok
   models may reason, so this client strips that prefix and
   lets the model think; repair_json strips think blocks from
   the output, so the JSON answer still comes through clean.
   Same fix as mlx_client.py, Nov 9, 2026.
"""
import http.client
import json
import os
import time
import urllib.error
import urllib.request

GROK_API_BASE = os.environ.get("FLOCKPATH_GROK_API_BASE", "https://api.x.ai/v1")
DEFAULT_MODEL = "grok-4.1-fast"

# Plain-language errors the pastor sees. No API codes, no key, no URL.
ERR_BAD_KEY = "That Grok key didn't work. Check the key you pasted, or get a new one from console.x.ai."
ERR_RATE_LIMIT = "Grok is limiting how fast this pack can be built right now. Wait a minute, then tap Continue to pick up where it left off."
ERR_GROK_BUSY = "Grok didn't answer. Try again in a little while."
ERR_BLOCKED = "Grok declined to write this section. Try again, or switch back to the local model."


class _EmptyResponse(Exception):
    """Grok returned a response with no usable text, but the finish
    reason was not a content filter, so it is a transient provider
    glitch and the call should be retried, not surfaced as a
    refusal. Same fix as openrouter_client.py, Nov 9, 2026."""


def grok_model():
    return os.environ.get("FLOCKPATH_GROK_MODEL", DEFAULT_MODEL)


def grok_generate(prompt, api_key, max_tokens, timeout=120):
    """One Grok call. Returns the response text. Raises RuntimeError
    with a plain-language message on failure."""
    if not api_key:
        raise RuntimeError(ERR_BAD_KEY)
    model = grok_model()
    url = GROK_API_BASE + "/chat/completions"
    # Let a reasoning model think. Strip the "do not think" prefix
    # call_model adds; repair_json strips the think blocks.
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
        **({"reasoning": {"effort": "low"}} if "openrouter" in GROK_API_BASE else {}),
    }).encode("utf-8")
    # The reasoning parameter is OpenRouter-only. GLM 5.3 Flash is a
    # reasoning model: with no limit it spends most of its token
    # budget thinking (359 of 543 completion tokens in one test) and
    # can return no content at all when the budget runs out (the
    # first GLM test pack died on the first notes call this way).
    # effort "low" cuts reasoning to zero and the content still
    # comes back good. Nov 9, 2026. xAI and Clean APIs do not get
    # the parameter, so their calls are unchanged.
    # The key travels as a Bearer token; it is never logged. Any
    # error below reports the problem, never the key or the URL.
    # A browser-like User-Agent is sent: some gateways (Clean APIs)
    # sit behind Cloudflare, which blocks the default Python
    # User-Agent with a 403 (error code 1010). Nov 9, 2026.
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
            if code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            if code == 503:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(ERR_GROK_BUSY)
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
    raise RuntimeError(ERR_GROK_BUSY)


def _extract_text(data):
    """Pull the text out of a chat-completions response. Raises a
    plain-language error if Grok returned no usable text."""
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
