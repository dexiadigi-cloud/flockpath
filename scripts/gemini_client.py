"""Gemini API client for Flockpath, Nov 5, 2026 (v33, Google API first);
v35 pacing and honest rate-limit errors, Nov 6, 2026.

The pastor can choose Google Gemini instead of the local 4B model. This
module is the only place that talks to Google. It uses Python's standard
library only (urllib), so no new package is needed in .venv or on the Mac.

Rules:
1. The API key is never printed, logged, or included in any error message.
   Error messages name the problem (bad key, daily limit, pace limit,
   Google busy), never the key or the full request URL (which carries
   the key).
2. Pace calls: at most one request every 5 seconds, so a pack never
   fires faster than the free tier's 15 requests/minute cap. Nov 6,
   2026 finding: the client had no pacing, fired 18 requests in a
   minute, and the build stopped. One call every 5 seconds is 12 a
   minute, safely under the cap, and a 40-call pack still finishes in
   about 4 minutes.
3. Read the 429 response body before naming the limit. Google returns
   429 for a per-minute limit AND for a per-day limit, and the body
   names which one in the quotaId (PerMinute vs PerDay). The v33 code
   called every 429 a daily limit, which was wrong: on Nov 6, 2026 the
   pastor's AI Studio page showed RPM 18/15 (over) but RPD 91/500
   (409 requests left), and the app had told him the day was used up.
   A per-day 429 fails fast, no retries: waiting will not help until
   midnight Pacific. A per-minute 429 retries with backoff, preferring
   Google's own retry delay when it is short. A 429 whose body names
   neither limit is retried, and if it never clears it is reported as
   a pace problem, never as a used-up day. A 400 means a bad key: fail
   fast, do not retry.
4. The model is gemini-3.5-flash-lite by default (500 requests/day free,
   about 11 packs). Plain Gemini Flash is 20 requests/day and breaks
   mid-pack, so it must never be the default. The model name is an env
   var so a churned model ID is a one-line change.
5. Generation settings match the local call_model settings: temperature
   0.3, topP 0.85, topK 20.

Pacing is module-level and single-threaded: the worker runs one
generation at a time, one section at a time, so one timestamp is
enough. A fresh worker subprocess starts with no recent calls.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = "gemini-3.5-flash-lite"

# Free tier allows 15 requests a minute. One call every 5 seconds is
# 12 a minute, safely under the cap.
MIN_CALL_INTERVAL = 5.0

# Monotonic time the last request started. Starts at 0 so the first
# call of a fresh process never waits.
_last_call_start = 0.0

# Plain-language errors the pastor sees. No API codes, no key, no URL.
ERR_BAD_KEY = "That Google key didn't work. Check the key you pasted, or get a new one from AI Studio."
ERR_DAILY_LIMIT = "You've used today's Google allowance. Try again tomorrow, or switch to Grok or the local model for this pack."
ERR_PACE_LIMIT = "Google is limiting how fast this pack can be built right now. Wait a minute, then tap Continue to pick up where it left off."
ERR_GOOGLE_BUSY = "Google didn't answer. Try again in a little while."
ERR_BLOCKED = "Google declined to write this section. Try again, or switch back to the local model."


class _EmptyResponse(Exception):
    """Google returned a response with no usable text, but the finish
    reason was not a safety filter, so it is a transient provider
    glitch and the call should be retried, not surfaced as a
    refusal. Same fix as openrouter_client.py, Nov 9, 2026."""


def gemini_model():
    return os.environ.get("FLOCKPATH_GEMINI_MODEL", DEFAULT_MODEL)


def _pace():
    """Wait until MIN_CALL_INTERVAL seconds have passed since the last
    request started. Keeps the pack under the 15 requests/minute cap."""
    global _last_call_start
    now = time.monotonic()
    wait = MIN_CALL_INTERVAL - (now - _last_call_start)
    if wait > 0:
        time.sleep(wait)
    _last_call_start = time.monotonic()


def _read_error_body(err):
    """The body of an HTTPError as text, or "" if it cannot be read.
    A body can only be read once, so callers read it once and pass the
    text around."""
    try:
        return err.read().decode("utf-8", "replace")
    except Exception:
        return ""


def _classify_429_body(body):
    """Name which limit a 429 body reports: 'daily', 'minute', or
    'unknown'. Google's 429 body carries a quotaId like
    GenerateRequestsPerDayPerProjectPerModel-FreeTier or
    GenerateRequestsPerMinutePerProjectPerModel-FreeTier. A body that
    says 'limit: 0' means this model has no quota on the tier at all,
    which is terminal like a daily limit."""
    if "PerDay" in body or "limit: 0" in body:
        return "daily"
    if "PerMinute" in body:
        return "minute"
    return "unknown"


def _retry_delay_seconds(body):
    """Seconds Google says to wait, from the RetryInfo detail
    ("retryDelay": "34.074824224s"), or None. Only trusted when it is
    under 2 minutes: a daily limit's delay runs to midnight, and
    waiting that long is never the right move."""
    m = re.search(r'"retryDelay"\s*:\s*"([0-9.]+)s"', body)
    if not m:
        return None
    try:
        secs = float(m.group(1))
    except ValueError:
        return None
    if secs <= 0 or secs > 120:
        return None
    return secs


def gemini_generate(prompt, api_key, max_tokens, timeout=120):
    """One Gemini call. Returns the response text. Raises RuntimeError
    with a plain-language message on failure."""
    if not api_key:
        raise RuntimeError(ERR_BAD_KEY)
    model = gemini_model()
    url = f"{GEMINI_API_BASE}/{model}:generateContent"
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "topP": 0.85,
            "topK": 20,
            "maxOutputTokens": max_tokens,
        },
    }).encode("utf-8")
    # The key travels as a query param; it is never logged. Any error
    # below reports the problem, never the URL.
    last_kind = None
    for attempt in range(5):
        _pace()
        req = urllib.request.Request(
            url + "?key=" + api_key,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return _extract_text(data)
        except urllib.error.HTTPError as e:
            code = e.code
            if code == 400:
                raise RuntimeError(ERR_BAD_KEY)
            if code == 429:
                err_body = _read_error_body(e)
                kind = _classify_429_body(err_body)
                last_kind = kind
                if kind == "daily":
                    # The daily allowance is used. Waiting will not
                    # help until midnight Pacific, so fail at once
                    # instead of burning retries on a closed door.
                    raise RuntimeError(ERR_DAILY_LIMIT)
                if kind == "minute":
                    # Per-minute: wait Google's own delay when it is
                    # short, else the exponential backoff.
                    delay = _retry_delay_seconds(err_body)
                    if delay is None:
                        delay = 2 ** (attempt + 1)
                    time.sleep(delay)
                else:
                    # Unknown: back off and retry. Never claim the
                    # day is used up on evidence this thin.
                    time.sleep(2 ** (attempt + 1))
                continue
            if code == 503:
                last_kind = "busy"
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(ERR_GOOGLE_BUSY)
        except (urllib.error.URLError, TimeoutError):
            last_kind = "busy"
            time.sleep(2 ** (attempt + 1))
            continue
        except _EmptyResponse:
            # No text back, but no safety filter either, so this is
            # a transient provider glitch. Retry the call the same
            # way a 429/503 is retried. Nov 9, 2026.
            last_kind = "busy"
            time.sleep(2 ** (attempt + 1))
            continue
    # All 5 attempts failed. A per-minute limit clears in a minute,
    # and a daily limit would already have failed fast above, so this
    # is a pace problem, not a used-up day.
    if last_kind in ("minute", "unknown"):
        raise RuntimeError(ERR_PACE_LIMIT)
    raise RuntimeError(ERR_GOOGLE_BUSY)


def _extract_text(data):
    """Pull the text out of a generateContent response. Raises a
    plain-language error if Google returned no usable text."""
    candidates = data.get("candidates") or []
    if not candidates:
        raise _EmptyResponse("no candidates")
    first = candidates[0] or {}
    parts = (first.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if text:
        return text
    # Empty text. A safety filter is a real refusal, so surface it
    # as ERR_BLOCKED and do not retry. Anything else is a transient
    # provider glitch, so raise _EmptyResponse and let the caller
    # retry the call.
    if (first.get("finishReason") or "") == "SAFETY":
        raise RuntimeError(ERR_BLOCKED)
    raise _EmptyResponse(f"empty text, finishReason={first.get('finishReason')!r}")
