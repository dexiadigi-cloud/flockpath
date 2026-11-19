#!/usr/bin/env python3
"""YouTube sermon import for Flockpath, v54, Phase 4.

Fetches the words of a YouTube sermon so the pastor can build
a pack from it, the same as pasting the sermon text by hand.

Path, in order:
  1. Captions first (fast, kilobytes): yt-dlp with the android
     player client, which is the path that works from a cloud
     network. The pastor's language first, English as the
     fallback. Auto-captions are lossy and verse references are
     exactly the failure mode, so the pastor still reviews the
     text and the extract step still finds the verses.
  2. Fallback: yt-dlp downloads the audio, and faster-whisper
     (small, int8, CPU) transcribes it locally. No ffmpeg
     binary is needed: yt-dlp downloads the file directly and
     faster-whisper decodes it with PyAV.

Licenses, all free for commercial use (verified Nov 11, 2026):
  yt-dlp Unlicense (PyPI wheel only, never the official GPL
  PyInstaller binary), faster-whisper MIT, ctranslate2 MIT,
  PyAV BSD-3-Clause, tokenizers Apache-2.0, Whisper small
  weights Apache-2.0 (Hugging Face API record for
  openai/whisper-small). The pastor installs them once with:
    .venv/bin/python -m pip install yt-dlp faster-whisper
  If they are missing, this script says so plainly instead of
  failing with an import traceback. The av pin matters: av 19
  removed an argument faster-whisper 1.2.1 calls, so a fresh
  install without "av<19" breaks transcription at the first
  file (caught Nov 11, 2026).

Bot wall: YouTube sometimes answers "Sign in to confirm you're
not a bot", or blocks a cloud IP outright. That is reported as
bot_wall=true with a plain message and the captions fallback;
the import page then offers the paste-text path instead. The
cleanest case is the pastor's own sermon.

Usage:
  python scripts/youtube_import.py <youtube-url> [--lang en|es]
Prints one JSON object to stdout and exits 0 on success, 1 on
failure (the JSON is still printed, so the caller can read the
plain reason). Nothing is kept: the audio file is deleted after
transcription, and the transcript is returned, not stored.
"""

import json
import os
import re
import sys
import tempfile

INSTALL_LINE = '.venv/bin/python -m pip install yt-dlp faster-whisper "av<19"'
# av 19 removed the metadata_errors argument faster-whisper
# 1.2.1 calls, so a fresh install without the pin breaks
# transcription at the first file. Pin av below 19.


def fail(message, bot_wall=False):
    print(json.dumps({"ok": False, "error": message, "bot_wall": bot_wall}, ensure_ascii=False))
    return 1


def video_id(url):
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/live/|/embed/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else None


def dedupe_cues(cues):
    """Join rolling-window caption cues without repeating the
    overlap. Each cue repeats the tail of the previous one, so
    only the words after the longest suffix-prefix overlap
    (up to 12 words) are appended."""
    words = []
    for cue in cues:
        cue_words = cue.split()
        if not cue_words:
            continue
        overlap = 0
        for n in range(min(12, len(words), len(cue_words)), 0, -1):
            if words[-n:] == cue_words[:n]:
                overlap = n
                break
        words.extend(cue_words[overlap:])
    return " ".join(words)


def parse_vtt(path):
    cues = []
    current = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("WEBVTT") or line.startswith("Kind:") or line.startswith("Language:"):
                continue
            if "-->" in line:
                if current:
                    cues.append(" ".join(current))
                    current = []
                continue
            if re.match(r"^\d+$", line.strip()):
                continue
            if not line.strip():
                if current:
                    cues.append(" ".join(current))
                    current = []
                continue
            # Drop alignment/position tags and <c> spans.
            line = re.sub(r"<[^>]+>", "", line)
            line = re.sub(r"align:[^ ]+|position:[^ ]+", "", line).strip()
            if line:
                current.append(line)
    if current:
        cues.append(" ".join(current))
    return dedupe_cues(cues)


def fetch_captions(ydl_opts, url, tmpdir, lang):
    """Returns (text, lang_used, title) or (None, None, title).
    Raises on a hard failure so the caller can tell a bot wall
    from a video with no captions."""
    import yt_dlp

    langs = [lang] if lang == "en" else [lang, "en"]
    outtmpl = os.path.join(tmpdir, "subs", "%(id)s")
    opts = dict(ydl_opts)
    opts.update({
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": langs,
        "subtitlesformat": "vtt/best",
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    title = (info or {}).get("title", "")
    subdir = os.path.join(tmpdir, "subs")
    if not os.path.isdir(subdir):
        return None, None, title
    for name in sorted(os.listdir(subdir)):
        if not name.endswith(".vtt"):
            continue
        # Prefer the requested language, then English.
        if f".{lang}." in name or name.endswith(f".{lang}.vtt"):
            text = parse_vtt(os.path.join(subdir, name))
            if text.strip():
                return text, lang, title
    for name in sorted(os.listdir(subdir)):
        if name.endswith(".vtt"):
            text = parse_vtt(os.path.join(subdir, name))
            if text.strip():
                return text, "en", title
    return None, None, title


def find_cached_model():
    """The faster-whisper small snapshot, if this machine
    already has it. Pointing at the local path avoids a hub
    lookup, which can fail on a proxied network (the VM's
    no_proxy value breaks huggingface_hub's URL parsing)."""
    base = os.path.expanduser("~/.cache/huggingface/hub/models--Systran--faster-whisper-small/snapshots")
    if not os.path.isdir(base):
        return None
    for snap in sorted(os.listdir(base)):
        model_bin = os.path.join(base, snap, "model.bin")
        if os.path.exists(model_bin):
            return os.path.join(base, snap)
    return None


def transcribe_audio(audio_path, lang):
    from faster_whisper import WhisperModel

    model_path = find_cached_model() or "small"
    # A proxied network can break the hub client while it parses
    # no_proxy; drop the bracketed values before loading.
    for key in ("no_proxy", "NO_PROXY"):
        if "[" in os.environ.get(key, ""):
            os.environ.pop(key, None)
    model = WhisperModel(model_path, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio_path, beam_size=5, language=lang if lang in ("en", "es") else None)
    texts = [s.text.strip() for s in segments if s.text and s.text.strip()]
    return " ".join(texts), info.duration


def main():
    args = sys.argv[1:]
    if not args:
        return fail("Give a YouTube link, for example https://www.youtube.com/watch?v=VIDEO_ID")
    url = args[0]
    lang = "en"
    for i, a in enumerate(args[1:], start=1):
        if a == "--lang" and i + 1 < len(args):
            lang = args[i + 1]
    vid = video_id(url)
    if not vid:
        return fail("That does not look like a YouTube link. Use a watch link (youtube.com/watch?v=...) or a short link (youtu.be/...).")
    if lang not in ("en", "es"):
        lang = "en"

    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return fail("YouTube import is not installed yet. On this computer, run: " + INSTALL_LINE)
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return fail("YouTube import is not installed yet. On this computer, run: " + INSTALL_LINE)

    # The android player client is the path that works from a
    # cloud network (verified Nov 11, 2026: the default web
    # client stalls, the android API answers). On a home Mac
    # the web client may work too, but the android path works
    # there as well, so it is the only path shipped.
    ydl_opts = {"extractor_args": {"youtube": {"player_client": ["android"]}}}
    # VM egress only: the proxy MITMs TLS, and yt-dlp defaults
    # to certifi's bundle, which lacks the proxy CA. When the
    # proxy CA file is set, let Python's ssl honor it. On a
    # Mac this branch never fires.
    if os.environ.get("SSL_CERT_FILE"):
        ydl_opts["compat_opts"] = ["no-certifi"]

    tmpdir = tempfile.mkdtemp(prefix="flockpath-yt-")
    try:
        try:
            text, used_lang, title = fetch_captions(ydl_opts, url, tmpdir, lang)
        except Exception as e:
            msg = str(e)
            if "Sign in to confirm" in msg or "bot" in msg.lower() or "blocked" in msg.lower() or "IpBlocked" in type(e).__name__:
                return fail("YouTube asked for a sign-in, or blocked this network. Paste the sermon text instead, or try again on a different network.", bot_wall=True)
            text, used_lang, title = None, None, ""
        if text and text.strip():
            return _emit(url, vid, text, used_lang, "captions", None, title)

        # No captions: download the audio and transcribe it
        # locally. No ffmpeg: yt-dlp downloads the file
        # directly, faster-whisper decodes it with PyAV.
        import yt_dlp

        audio_path = os.path.join(tmpdir, "audio.%(ext)s")
        opts = dict(ydl_opts)
        opts.update({
            "format": "bestaudio/best",
            "outtmpl": audio_path,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
        })
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get("title", "")
        except Exception as e:
            msg = str(e)
            if "Sign in to confirm" in msg or "bot" in msg.lower() or "blocked" in msg.lower():
                return fail("YouTube asked for a sign-in, or blocked this network. Paste the sermon text instead, or try again on a different network.", bot_wall=True)
            return fail("Could not download this video's audio: " + msg[:300])
        audio_file = None
        for name in os.listdir(tmpdir):
            if name.startswith("audio."):
                audio_file = os.path.join(tmpdir, name)
                break
        if not audio_file:
            return fail("The audio download finished but left no file. Paste the sermon text instead.")
        try:
            text, duration = transcribe_audio(audio_file, lang)
        except Exception as e:
            return fail("Transcription failed: " + str(e)[:300])
        if not text.strip():
            return fail("Transcription finished but found no words. Paste the sermon text instead.")
        return _emit(url, vid, text, lang, "transcription", duration, title)
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)


def _emit(url, vid, text, lang, source, duration, title=""):
    print(json.dumps({
        "ok": True,
        "source": source,
        "video_id": vid,
        "url": url,
        "title": title,
        "language": lang,
        "text": text,
        "chars": len(text),
        "duration_s": duration,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
