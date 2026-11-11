#!/bin/bash
# Flockpath local run, Mac and Linux.
# Starts the Flockpath web app AND the generation worker together,
# so the Generate button in the app actually generates a draft.
# This is a local web app, not a desktop app: the app opens in
# your browser at http://localhost:3000. No data leaves your
# computer except the one-time model download and hymn links.
# Stop with Ctrl+C. That stops both the app and the worker.
# Mac note: this script is UNTESTED on a Mac as of Nov 2, 2026.
# It was tested on Linux. Run it once on a Mac and report any
# error line before a pastor uses it.
#
# Logs, Nov 3, 2026: three daily logs live in data/logs/ and
# are the files to send when something goes wrong: app (the
# web server), worker (generation), start (this script, the
# install and startup steps). Logs older than 7 days are
# deleted automatically on every start. data/worker.log is a
# link to today's worker log, so older guidance still works.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_ROOT" || exit 1
# Nov 9, 2026, v44 (Grok via a gateway): a .env file in the app root,
# if present, is sourced so the pastor can point the Grok client at a
# third-party OpenAI-compatible gateway without editing this script.
# Lines are KEY=VALUE, one per line, no quotes needed; blank lines and
# lines starting with # are skipped. Used for Clean APIs:
#   FLOCKPATH_GROK_API_BASE=https://<clean-apis-base-url>/v1
#   FLOCKPATH_GROK_MODEL=grok-4.6
# The file is never packaged or uploaded; it lives only on the
# pastor's own computer. A key is never put in .env (keys live in
# the app's own settings, in the local auth database).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PORT="${PORT:-3000}"
MODEL="models/Qwen3.5-4B-S-TS-Q4_K_S.gguf"
MODEL_URL="https://huggingface.co/TheStageAI/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-S-TS-Q4_K_S.gguf"
MODEL_SHA="9f020bfc77a9503a641e3e0511de04b4bfba16b9facfa62c3772b4f8e318ba55"
mkdir -p data/logs
find data/logs -type f -name "*.log" -mtime +7 -delete 2>/dev/null || true
TODAY="$(date +%F)"
APP_LOG="data/logs/app-$TODAY.log"
WORKER_LOG="data/logs/worker-$TODAY.log"
START_LOG="data/logs/start-$TODAY.log"
if [ -z "${FLOCKPATH_LOGGING:-}" ]; then
  export FLOCKPATH_LOGGING=1
  exec "$SCRIPT_DIR/start-flockpath.sh" "$@" > >(tee -a "$START_LOG") 2>&1
fi

fail() { echo "Flockpath: $1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 20 or newer, then run this script again."
command -v npm >/dev/null 2>&1 || fail "npm is not installed. Install Node 20 or newer, then run this script again."
if command -v .venv/bin/python >/dev/null 2>&1; then
  PY=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  fail "Python 3 is not installed. Install Python 3.11 or newer, then run this script again."
fi
"$PY" -c "import llama_cpp" 2>/dev/null || fail "Python package llama-cpp-python is not installed. Run: $PY -m pip install llama-cpp-python, then run this script again."

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo ""
  fi
}

search_model() {
  local dir="$1" depth="$2"
  [ -d "$dir" ] || return 0
  find "$dir" -maxdepth "$depth" -name "Qwen3.5-4B-S-TS-Q4_K_S.gguf" 2>/dev/null | head -1
}

mkdir -p models
# Nov 3, 2026, model reuse: never re-download a model the
# pastor already has. An explicit FLOCKPATH_MODEL pointer
# wins; otherwise the script searches the places a copy
# usually lives (including ~/flockpath-4b, where the Mac 4B
# test put it) and reuses the first file whose hash matches
# the exact model this app runs. Only if nothing verified
# is found does it download. A hash mismatch on an explicit
# pointer is a hard stop, not a silent download: a different
# file is a different model, and downloading over it would
# hide the mistake and waste 1.8 GB.
if [ ! -f "$MODEL" ]; then
  FOUND=""
  if [ -n "${FLOCKPATH_MODEL:-}" ]; then
    if [ ! -f "$FLOCKPATH_MODEL" ]; then
      fail "FLOCKPATH_MODEL is set but the file does not exist: $FLOCKPATH_MODEL"
    fi
    if [ "$(hash_file "$FLOCKPATH_MODEL")" != "$MODEL_SHA" ]; then
      fail "FLOCKPATH_MODEL does not match the model this app runs (hash mismatch). Point it at Qwen3.5-4B-S-TS-Q4_K_S.gguf from TheStageAI, or unset it to let the script search or download."
    fi
    FOUND="$FLOCKPATH_MODEL"
  else
    for spec in "$HOME/flockpath-4b:2" "$HOME/models:2" "$HOME/Downloads:2" "$HOME/.cache/huggingface:5" "$HOME/Library/Caches/huggingface:5"; do
      dir="${spec%%:*}"; depth="${spec##*:}"
      CANDIDATE="$(search_model "$dir" "$depth")"
      [ -n "$CANDIDATE" ] || continue
      if [ "$(hash_file "$CANDIDATE")" = "$MODEL_SHA" ]; then
        FOUND="$CANDIDATE"
        break
      fi
    done
  fi
  if [ -n "$FOUND" ]; then
    echo "Flockpath: found your existing model at $FOUND, using it (no download)."
    if ! ln -sf "$FOUND" "$MODEL" 2>/dev/null; then
      echo "Flockpath: could not link into models/, the worker will use your copy directly."
    fi
    export FLOCKPATH_MODEL="$FOUND"
  else
    echo "Flockpath: model not found, downloading about 1.8 GB (one time only)..."
    curl -L -o "$MODEL" "$MODEL_URL" || fail "Model download failed. Check your connection and run this script again."
  fi
fi
if [ ! -f "$MODEL" ] && [ -n "${FLOCKPATH_MODEL:-}" ]; then
  # The link into models/ failed, but the pointed-to copy was
  # already hash-verified above, and the worker reads it
  # through FLOCKPATH_MODEL. Nothing more to check here.
  echo "Flockpath: using your model at $FLOCKPATH_MODEL directly."
else
  ACTUAL="$(hash_file "$MODEL")"
  if [ -z "$ACTUAL" ]; then
    echo "Flockpath: no sha256 tool found, skipping model hash check."
  elif [ "$ACTUAL" != "$MODEL_SHA" ]; then
    fail "Model hash does not match. Delete $MODEL and run this script again to re-download it."
  fi
fi

if [ ! -d node_modules ]; then
  echo "Flockpath: installing app packages (one time only)..."
  npm ci || npm install || fail "npm install failed."
fi
if [ ! -d .next ]; then
  echo "Flockpath: building the app (one time only, then cached)..."
  npm run build || fail "App build failed. See the error above."
fi

if command -v lsof >/dev/null 2>&1 && lsof -i ":$PORT" >/dev/null 2>&1; then
  fail "Port $PORT is already in use. Stop the other app on port $PORT, or run: PORT=3001 $0"
fi

mkdir -p data
# PYTHONUNBUFFERED=1: the worker and the generation scripts it
# spawns print live progress to the log instead of buffering it.
# Without it the log sits empty for minutes while a pack builds,
# which looks like the worker died. Nov 9, 2026, v47.
PYTHONUNBUFFERED=1 "$PY" scripts/generate_worker.py --loop >> "$WORKER_LOG" 2>&1 &
WORKER_PID=$!
ln -sf "logs/worker-$TODAY.log" data/worker.log
echo "Flockpath: worker started (pid $WORKER_PID, log $WORKER_LOG)."
CLEANED=""

# Kill a process and all of its descendants, bottom up. Needed
# because npm run start spawns sh, which spawns next-server:
# killing npm alone orphans next-server on port 3000.
kill_tree() {
  local pid="$1"
  local child
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null); do
      kill_tree "$child"
    done
  else
    pkill -P "$pid" 2>/dev/null
  fi
  kill "$pid" 2>/dev/null
}

cleanup() {
  [ -n "$CLEANED" ] && return 0
  CLEANED=1
  echo ""
  echo "Flockpath: stopping..."
  kill_tree "$APP_PID"
  kill "$WORKER_PID" 2>/dev/null
  wait "$WORKER_PID" 2>/dev/null
  wait "$APP_PID" 2>/dev/null
  rm -f data/running.pid
  echo "Flockpath: stopped."
}
trap cleanup INT TERM

PORT="$PORT" npm run start >> "$APP_LOG" 2>&1 &
APP_PID=$!
sleep 3
if ! kill -0 "$APP_PID" 2>/dev/null; then
  kill "$WORKER_PID" 2>/dev/null
  fail "App failed to start. See $APP_LOG for the error."
fi
# Nov 3, 2026, updater support: record the exact PIDs, so the
# updater can stop exactly these processes without guessing
# from ports or process lists. Removed on clean stop above.
printf "WORKER_PID=%s\nAPP_PID=%s\nPORT=%s\n" "$WORKER_PID" "$APP_PID" "$PORT" > data/running.pid
URL="http://localhost:$PORT"
echo "Flockpath: open $URL in your browser."
if command -v open >/dev/null 2>&1; then
  open "$URL" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" 2>/dev/null || true
fi
echo "Flockpath: running. Press Ctrl+C to stop."
wait "$APP_PID"
cleanup
