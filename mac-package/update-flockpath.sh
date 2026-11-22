#!/bin/bash
# Flockpath updater, Mac and Linux.
#
# Applies a Flockpath update zip OVER the existing install.
# Code and shipped data are replaced; the pastor's own data
# is never touched: accounts, library, drafts, jobs, models
# (except the shipped narration voice files in
# models/tts-kokoro, installed only when the installed bundle
# is missing or fails its hash check), church logos, pack
# PDFs, and logs. The app is rebuilt, and if it was running
# before the update, it is started again after. A backup of
# the replaced code is kept next to the app, so a bad update
# can be rolled back.
#
# Usage: double-click update-flockpath.command, or:
#   bash update-flockpath.sh [update-zip-path] [--force] [--rollback]
# With no zip path, the newest flockpath-update-*.zip in this
# folder, then ~/Downloads, is used. Updates arrive in the
# Drive loading dock, which syncs to the Mac on its own.
#
# What an update replaces, and what it never touches:
#   Replaced: app code, scripts, tools, shipped data
#     (BSB stores, the demo pack, the demo draft, phos.db
#     when the update carries one), sample church logos,
#     the demo PDF, and this updater itself.
#   Never touched: data/auth.db, data/packs-library.json,
#     data/drafts, data/generate-jobs, data/logs, models/
#     (except models/tts-kokoro, installed from the package
#     only when the installed bundle is missing or fails its
#     hash check; anything else under models/ is never
#     touched), node_modules (reinstalled only when
#     package.json changed), public/church-logos (except
#     sample-* files), public/pack-*.pdf (except the demo PDF),
#     output/.
# A failed update restores the backup automatically.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${FLOCKPATH_PACKAGE_DIR:-$SCRIPT_DIR}"
APP_ROOT="$PACKAGE_DIR/flockpath"
PORT="${PORT:-3000}"

fail() { echo "Flockpath update: $1" >&2; exit 1; }

[ -d "$APP_ROOT" ] || fail "No flockpath folder next to this script. Run it from the flockpath-mac-test folder."

# Nov 20, 2026, v61: ship the Kokoro narration bundle
# (models/tts-kokoro, about 345 MB in v62) in the update
# package so a Mac that never narrated before does not need
# the Hugging Face download. Only the five pinned files are
# ever copied, nothing else from the package's models/ (an
# espeak-ng-data folder, for example, is GPL and must never
# be installed). An existing bundle that already verifies is
# left alone; a package without the bundle leaves an
# existing bundle alone too. Every installed file is
# verified against the sha256 pins in
# scripts/narrate-pack.mjs; a file that fails its hash
# check is removed, never left in place, and narration
# falls back to downloading it on first use.
# This block lives up here, before the log setup and the
# self-update copy below, so the --install-tts-bundle mode
# can run it without touching logs or re-execing: a live
# updater calls the PACKAGE's updater in that mode (see
# install_package_tts_bundle), so the bundle install runs
# with the package's own file list and pins, never with a
# stale updater's.
TTS_FILES="model.onnx voices.bin tokens.txt lexicon-us-en.txt LICENSE"
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}
tts_pin() {
  grep -oE "\"$1\", sha256: \"[0-9a-f]{64}\"" "$APP_ROOT/scripts/narrate-pack.mjs" 2>/dev/null | grep -oE "[0-9a-f]{64}" | head -1
}
install_tts_bundle() {
  local src="$1" f pin ok
  [ -d "$src/models/tts-kokoro" ] || return 0
  ok=1
  for f in $TTS_FILES; do
    [ -f "$APP_ROOT/models/tts-kokoro/$f" ] || { ok=0; break; }
    pin="$(tts_pin "$f")"
    [ -n "$pin" ] || { ok=0; break; }
    [ "$(sha256_of "$APP_ROOT/models/tts-kokoro/$f")" = "$pin" ] || { ok=0; break; }
  done
  if [ "$ok" = "1" ]; then
    echo "Flockpath update: narration voice files already installed and verified, leaving them alone."
    return 0
  fi
  echo "Flockpath update: installing the narration voice files from the update package..."
  mkdir -p "$APP_ROOT/models/tts-kokoro"
  for f in $TTS_FILES; do
    if [ ! -f "$src/models/tts-kokoro/$f" ]; then
      echo "Flockpath update: WARNING, update package is missing models/tts-kokoro/$f. Narration will download the voice files on first use."
      return 0
    fi
    cp "$src/models/tts-kokoro/$f" "$APP_ROOT/models/tts-kokoro/$f" || {
      echo "Flockpath update: WARNING, could not copy models/tts-kokoro/$f. Narration will download the voice files on first use."
      return 0
    }
  done
  for f in $TTS_FILES; do
    pin="$(tts_pin "$f")"
    if [ -z "$pin" ] || [ "$(sha256_of "$APP_ROOT/models/tts-kokoro/$f")" != "$pin" ]; then
      echo "Flockpath update: WARNING, installed models/tts-kokoro/$f failed its hash check, removing it. Narration will download the voice files on first use."
      rm -f "$APP_ROOT/models/tts-kokoro/$f"
    fi
  done
  # Nov 21, 2026, v62: the int8 model is retired. A stale
  # model.int8.onnx left by an older install is dead weight
  # (114 MB) that nothing reads any more; drop it so the
  # folder holds the fp32 set only.
  rm -f "$APP_ROOT/models/tts-kokoro/model.int8.onnx"
  echo "Flockpath update: narration voice files installed and verified."
}

# Nov 21, 2026, v62, item 3: bundle-only mode. Usage:
#   bash update-flockpath.sh --install-tts-bundle <app-root> <package-app-folder>
# Installs the narration voice files from the package into
# the live app and exits. The live updater runs the
# PACKAGE's updater in this mode right after it applies the
# package, so the install uses the package's own TTS_FILES
# and the new code's pins - a stale updater on the Mac
# cannot skip it (in the v60->v61 update the v60 updater
# ran, install_tts_bundle never ran, and the bundle stayed
# partial). The pins are read from the live app's
# scripts/narrate-pack.mjs, so the package must already be
# applied when this runs; that file missing is a hard stop,
# not a silent install of unverified files.
if [ "${1:-}" = "--install-tts-bundle" ]; then
  [ -n "${2:-}" ] && [ -n "${3:-}" ] || fail "--install-tts-bundle needs an app root and a package app folder."
  [ -f "$2/scripts/narrate-pack.mjs" ] || fail "No scripts/narrate-pack.mjs in $2. Apply the update package first, then run the bundle install."
  APP_ROOT="$2"
  install_tts_bundle "$3"
  exit 0
fi

# Logs: the updater's own output goes to the update log and
# the terminal. Logs older than 7 days are pruned here too,
# so the folder never grows without bound.
mkdir -p "$APP_ROOT/data/logs"
find "$APP_ROOT/data/logs" -type f -name "*.log" -mtime +7 -delete 2>/dev/null || true
# Nov 20, 2026, v61: the prune above can delete the dated log
# data/worker.log points to, leaving a dangling symlink that
# breaks the next npm run build (Turbopack resolves data/ at
# build time; the v60 install failed on exactly this). Drop
# the link itself when its target is gone; rm on a symlink
# removes the link only, never the target, and the starter
# recreates the link on the next start.
if [ -L "$APP_ROOT/data/worker.log" ] && [ ! -e "$APP_ROOT/data/worker.log" ]; then
  rm -f "$APP_ROOT/data/worker.log"
fi
TODAY="$(date +%F)"
UPDATE_LOG="$APP_ROOT/data/logs/update-$TODAY.log"

# Self-update safety: copy this script to /tmp and run the
# copy, so the update can replace the script in this folder
# without overwriting the file bash is reading.
if [ -z "${FLOCKPATH_UPDATING:-}" ]; then
  export FLOCKPATH_UPDATING=1 FLOCKPATH_PACKAGE_DIR="$PACKAGE_DIR"
  TMPD="$(mktemp -d /tmp/flockpath-update.XXXXXX)"
  export FLOCKPATH_UPDATER_TMPD="$TMPD"
  cp "$SCRIPT_DIR/update-flockpath.sh" "$TMPD/update.sh"
  exec "$TMPD/update.sh" "$@" > >(tee -a "$UPDATE_LOG") 2>&1
fi

command -v rsync >/dev/null 2>&1 || fail "rsync is not installed. macOS includes it; install it, then run this script again."
command -v unzip >/dev/null 2>&1 || fail "unzip is not installed."
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 20 or newer, then run this script again."
command -v npm >/dev/null 2>&1 || fail "npm is not installed."

# Nov 20, 2026, v61: Turbopack resolves data/ at build time
# and fails the whole build on a dangling symlink (the v60
# install failed on data/worker.log, left dangling by the log
# prune after a Mac idle 7+ days). Delete dangling symlinks
# under data/ before every build. A link is dangling only
# when its target is gone, so a valid symlink survives and a
# real file is never touched; rm on a symlink removes the
# link only. Portable on purpose: macOS find has no -xtype,
# so the target test is a plain [ -e ] instead.
clear_dangling_data_symlinks() {
  [ -d "$APP_ROOT/data" ] || return 0
  find "$APP_ROOT/data" -type l -print0 2>/dev/null | while IFS= read -r -d '' link; do
    if [ ! -e "$link" ]; then
      echo "Flockpath update: removing dangling symlink $link."
      rm -f "$link"
    fi
  done
}

# rsync filters for the flockpath tree, built from the source
# being copied. First match wins, so the shipped data files
# are included before data/* excludes everything else in
# data/, and the demo PDF and sample logos are included
# before their wider excludes. Excluded files are never
# copied and never deleted by --delete.
# Nov 3, 2026, --delete trap: an allowlisted file that is
# ABSENT from the source must be protected, not deleted.
# A routine update carries no phos.db, and without a
# protection exclude, --delete would erase the installed
# database. So any allowlisted file missing from the source
# gets an exclude first, ahead of its include.
FILTERS=()
build_filters() {
  local src="$1"
  FILTERS=()
  [ -f "$src/data/phos.db" ] || FILTERS+=(--exclude '/data/phos.db')
  [ -f "$src/data/locked-pack.json" ] || FILTERS+=(--exclude '/data/locked-pack.json')
  [ -f "$src/data/generated-pack-draft-v2.json" ] || FILTERS+=(--exclude '/data/generated-pack-draft-v2.json')
  if ! ls "$src"/data/bsb-*.json >/dev/null 2>&1; then FILTERS+=(--exclude '/data/bsb-*.json'); fi
  FILTERS+=(
    --include '/data/bsb-*.json'
    --include '/data/locked-pack.json'
    --include '/data/generated-pack-draft-v2.json'
    --include '/data/phos.db'
    --include '/data/'
    --exclude '/data/*'
    --include '/public/pack-generated-genesis-1.pdf'
    --exclude '/public/pack-*.pdf'
    --include '/public/church-logos/sample-*.png'
    --include '/public/church-logos/'
    --exclude '/public/church-logos/*'
    # models/ stays excluded here on purpose: the narration
    # bundle is installed by install_tts_bundle below, never
    # by rsync, so --delete can never wipe a pastor's other
    # models or an existing voice bundle.
    --exclude '/models/'
    --exclude '/node_modules/'
    --exclude '/.next/'
    --exclude '/output/'
    --exclude '/.venv/'
  )
}

# Nov 21, 2026, v62, item 3: run the PACKAGE's bundle
# install, not just this updater's. The live updater that
# applies a package can be an older version than the
# package (the v60 updater applied v61 and never ran the
# bundle install at all, because it predated it). After
# the new code is rsynced in, the package's own updater -
# which knows its own bundle file list - installs the
# narration voice files into the live app in bundle-only
# mode. A package whose updater predates that mode is
# skipped here, and this updater's own install_tts_bundle
# still runs afterwards as the fallback. Either way the
# install is verified against the new code's pins.
install_package_tts_bundle() {
  local src="$1" root="$2"
  local pkg_updater="$root/update-flockpath.sh"
  if [ ! -f "$pkg_updater" ] || ! grep -q -- "--install-tts-bundle" "$pkg_updater"; then
    echo "Flockpath update: update package has no bundle-only updater, using this updater's bundle install."
    return 0
  fi
  echo "Flockpath update: installing the narration voice files with the update package's own updater..."
  if bash "$pkg_updater" --install-tts-bundle "$APP_ROOT" "$src"; then
    echo "Flockpath update: package updater installed the narration voice files."
  else
    echo "Flockpath update: WARNING, package updater's bundle install failed, falling back to this updater's bundle install."
  fi
}

# Kill a process and all of its descendants, bottom up. Needed
# because npm run start spawns sh, which spawns next-server:
# killing npm alone orphans next-server on the port.
kill_tree() {
  local pid="$1"
  local child
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null); do
      kill_tree "$child"
    done
  else
    pkill -P "$pid" 2>/dev/null || true
  fi
  kill "$pid" 2>/dev/null || true
}

# Stop the app and worker for THIS install only, never by
# guessing from a port alone. Primary source: the pidfile the
# starter writes (data/running.pid), with each PID verified
# against its command line first, so a reused PID is never
# killed blind. Secondary sweep: if the port still answers
# as Flockpath after that, kill its listeners, fingerprinted
# first, so a different app on the port is never touched.
# If the port still answers as Flockpath after both, stop
# here instead of updating under a running app.
WAS_RUNNING=0
stop_running() {
  local pidfile="$APP_ROOT/data/running.pid"
  local killed_any=0
  local wpid apid pid
  if [ -f "$pidfile" ]; then
    wpid="$(grep '^WORKER_PID=' "$pidfile" 2>/dev/null | cut -d= -f2)"
    apid="$(grep '^APP_PID=' "$pidfile" 2>/dev/null | cut -d= -f2)"
    if [ -n "${wpid:-}" ] && ps -p "$wpid" -o command= 2>/dev/null | grep -q "generate_worker.py"; then
      kill "$wpid" 2>/dev/null || true
      killed_any=1
    fi
    if [ -n "${apid:-}" ] && ps -p "$apid" -o command= 2>/dev/null | grep -qE "npm|next"; then
      kill_tree "$apid"
      killed_any=1
    fi
  fi
  if command -v curl >/dev/null 2>&1 && curl -fs --max-time 3 "http://localhost:$PORT/signin" 2>/dev/null | grep -q "Flockpath"; then
    if command -v lsof >/dev/null 2>&1; then
      for pid in $(lsof -ti ":$PORT" 2>/dev/null); do
        kill "$pid" 2>/dev/null || true
        killed_any=1
      done
    fi
  fi
  if [ "$killed_any" = "1" ]; then
    WAS_RUNNING=1
    echo "Flockpath update: stopped the running app and worker."
    local waited=0
    while [ "$waited" -lt 15 ] && curl -fs --max-time 2 "http://localhost:$PORT/signin" 2>/dev/null | grep -q "Flockpath"; do
      sleep 1
      waited=$((waited + 1))
    done
    if curl -fs --max-time 2 "http://localhost:$PORT/signin" 2>/dev/null | grep -q "Flockpath"; then
      fail "Could not stop the running app. Stop Flockpath with Ctrl+C first, then run this script again. Nothing was changed."
    fi
  fi
  rm -f "$pidfile"
}

restore_backup() {
  local backup="$1"
  echo "Flockpath update: restoring the backup at $backup."
  build_filters "$backup"
  rsync -a --delete "${FILTERS[@]}" "$backup/" "$APP_ROOT/" || echo "Flockpath update: WARNING, restore copy had errors. The backup is still at $backup."
  if ! cmp -s "$backup/package.json" "$APP_ROOT/package.json" 2>/dev/null || ! cmp -s "$backup/package-lock.json" "$APP_ROOT/package-lock.json" 2>/dev/null; then
    echo "Flockpath update: package files changed, reinstalling app packages for the restored version..."
    (cd "$APP_ROOT" && npm ci) || echo "Flockpath update: WARNING, npm ci failed on restore. Run it by hand in $APP_ROOT."
  fi
  echo "Flockpath update: rebuilding the restored version..."
  clear_dangling_data_symlinks
  (cd "$APP_ROOT" && rm -rf .next && npm run build) || echo "Flockpath update: WARNING, rebuild failed on restore. The backup is still at $backup."
}

find_update_zip() {
  local dir cand
  for dir in "$PACKAGE_DIR" "$HOME/Downloads"; do
    [ -d "$dir" ] || continue
    cand="$(ls -t "$dir"/flockpath-update-*.zip 2>/dev/null | head -1)"
    [ -n "$cand" ] && { echo "$cand"; return 0; }
  done
  return 1
}

# --- Arguments ---
ZIP=""
FORCE=0
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --rollback) ROLLBACK=1 ;;
    *) ZIP="$arg" ;;
  esac
done

# --- Rollback: restore the newest backup, rebuild, done ---
if [ "$ROLLBACK" = "1" ]; then
  BACKUP="$(ls -dt "$PACKAGE_DIR"/flockpath-backup-*/ 2>/dev/null | head -1)"
  [ -n "$BACKUP" ] || fail "No backup folder found next to the app. Nothing to roll back to."
  echo "Flockpath update: rolling back to $BACKUP."
  stop_running
  restore_backup "$BACKUP"
  echo "Flockpath update: rolled back. Start the app with start-flockpath.command inside flockpath/local-run."
  exit 0
fi

# --- Find and validate the update zip ---
if [ -z "$ZIP" ]; then
  ZIP="$(find_update_zip)" || fail "No flockpath-update-*.zip found next to this script or in ~/Downloads. Download the update zip from the loading dock, put it next to this script, and run this script again."
fi
[ -f "$ZIP" ] || fail "Update zip not found: $ZIP"
TMPD="$(mktemp -d /tmp/flockpath-update.XXXXXX)"
unzip -q -o "$ZIP" -d "$TMPD/unzipped" || fail "Could not unzip $ZIP. Re-download it and try again."
if [ -d "$TMPD/unzipped/flockpath-mac-test/flockpath" ]; then
  SRC_ROOT="$TMPD/unzipped/flockpath-mac-test"
elif [ -d "$TMPD/unzipped/flockpath" ]; then
  SRC_ROOT="$TMPD/unzipped"
else
  fail "That zip is not a Flockpath update (no flockpath folder inside). Use a flockpath-update-*.zip."
fi
SRC_APP="$SRC_ROOT/flockpath"
[ -f "$SRC_APP/VERSION" ] || fail "That zip has no flockpath/VERSION, so it is not a valid update."
NEW_VERSION="$(tr -d '[:space:]' < "$SRC_APP/VERSION")"
[ -n "$NEW_VERSION" ] || fail "That zip has an empty flockpath/VERSION."
CURRENT_VERSION="$(tr -d '[:space:]' < "$APP_ROOT/VERSION" 2>/dev/null || true)"
if [ -n "$CURRENT_VERSION" ] && [ "$FORCE" = "0" ]; then
  if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
    fail "Already on $CURRENT_VERSION. Nothing to update."
  fi
  if [[ "$NEW_VERSION" < "$CURRENT_VERSION" ]]; then
    fail "That update ($NEW_VERSION) is older than the installed $CURRENT_VERSION. Run with --force only if you mean to go back."
  fi
fi
echo "Flockpath update: $CURRENT_VERSION -> $NEW_VERSION."

# --- Stop, back up, apply, rebuild ---
stop_running
BACKUP="$PACKAGE_DIR/flockpath-backup-${CURRENT_VERSION:-unknown}-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
build_filters "$SRC_APP"
rsync -a --delete "${FILTERS[@]}" "$APP_ROOT/" "$BACKUP/" || fail "Backup failed. Nothing was changed."
echo "Flockpath update: backup at $BACKUP."
rsync -a --delete "${FILTERS[@]}" "$SRC_APP/" "$APP_ROOT/" || { restore_backup "$BACKUP"; fail "Update copy failed. The previous version was restored."; }
if [ -d "$SRC_ROOT/hymn-desk" ]; then
  rsync -a --delete "$SRC_ROOT/hymn-desk/" "$PACKAGE_DIR/hymn-desk/" || { restore_backup "$BACKUP"; fail "Hymn update failed. The previous version was restored."; }
fi
# The update carries its own updater and log bundler. Copy
# them last, after the build succeeds below, so a failed
# update never leaves a newer updater behind.
cd "$APP_ROOT" || fail "App folder vanished mid-update."
# Nov 21, 2026, v62, item 3: the package's own updater
# installs the bundle first (its file list and the new
# code's pins), so a stale live updater cannot skip it;
# this updater's own install then runs as the fallback
# and is a no-op when the package install verified.
install_package_tts_bundle "$SRC_APP" "$SRC_ROOT"
install_tts_bundle "$SRC_APP"
if ! cmp -s "$BACKUP/package.json" "$APP_ROOT/package.json" 2>/dev/null || ! cmp -s "$BACKUP/package-lock.json" "$APP_ROOT/package-lock.json" 2>/dev/null; then
  echo "Flockpath update: app packages changed, reinstalling..."
  npm ci || npm install || { restore_backup "$BACKUP"; fail "App package install failed. The previous version was restored."; }
fi
echo "Flockpath update: rebuilding the app..."
clear_dangling_data_symlinks
rm -rf .next
npm run build || { restore_backup "$BACKUP"; fail "App build failed. The previous version was restored."; }
for f in update-flockpath.sh update-flockpath.command collect-logs.sh collect-logs.command; do
  if [ -f "$SRC_ROOT/$f" ]; then
    cp "$SRC_ROOT/$f" "$PACKAGE_DIR/$f"
    chmod +x "$PACKAGE_DIR/$f"
  fi
done
rm -rf "$TMPD"
[ -n "${FLOCKPATH_UPDATER_TMPD:-}" ] && rm -rf "$FLOCKPATH_UPDATER_TMPD"
echo "Flockpath update: done, now on $NEW_VERSION."
echo "Flockpath update: kept your accounts, library, drafts, jobs, other models, church logos, pack PDFs, and logs. Backup at $BACKUP."
if [ "$WAS_RUNNING" = "1" ]; then
  echo "Flockpath update: restarting the app..."
  # The updater's own output is tee'd to the update log, so
  # hand the starter the terminal directly when one can be
  # opened (double-clicked Terminal). When there is no
  # controlling terminal, the starter inherits the pipe and
  # its own logs still capture its output. A failed /dev/tty
  # open must fall through to the plain exec, never exit.
  if (exec 9>/dev/tty) 2>/dev/null; then
    exec "$APP_ROOT/local-run/start-flockpath.sh" > /dev/tty 2>&1
  else
    exec "$APP_ROOT/local-run/start-flockpath.sh"
  fi
else
  echo "Flockpath update: start the app with start-flockpath.command inside flockpath/local-run."
fi
