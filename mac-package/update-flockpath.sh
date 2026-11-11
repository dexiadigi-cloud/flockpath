#!/bin/bash
# Flockpath updater, Mac and Linux.
#
# Applies a Flockpath update zip OVER the existing install.
# Code and shipped data are replaced; the pastor's own data
# is never touched: accounts, library, drafts, jobs, models,
# church logos, pack PDFs, and logs. The app is rebuilt, and
# if it was running before the update, it is started again
# after. A backup of the replaced code is kept next to the
# app, so a bad update can be rolled back.
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
#     data/drafts, data/generate-jobs, data/logs, models/,
#     node_modules (reinstalled only when package.json
#     changed), public/church-logos (except sample-* files),
#     public/pack-*.pdf (except the demo PDF), output/.
# A failed update restores the backup automatically.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${FLOCKPATH_PACKAGE_DIR:-$SCRIPT_DIR}"
APP_ROOT="$PACKAGE_DIR/flockpath"
PORT="${PORT:-3000}"

fail() { echo "Flockpath update: $1" >&2; exit 1; }

[ -d "$APP_ROOT" ] || fail "No flockpath folder next to this script. Run it from the flockpath-mac-test folder."

# Logs: the updater's own output goes to the update log and
# the terminal. Logs older than 7 days are pruned here too,
# so the folder never grows without bound.
mkdir -p "$APP_ROOT/data/logs"
find "$APP_ROOT/data/logs" -type f -name "*.log" -mtime +7 -delete 2>/dev/null || true
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
    --exclude '/models/'
    --exclude '/node_modules/'
    --exclude '/.next/'
    --exclude '/output/'
    --exclude '/.venv/'
  )
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
if ! cmp -s "$BACKUP/package.json" "$APP_ROOT/package.json" 2>/dev/null || ! cmp -s "$BACKUP/package-lock.json" "$APP_ROOT/package-lock.json" 2>/dev/null; then
  echo "Flockpath update: app packages changed, reinstalling..."
  npm ci || npm install || { restore_backup "$BACKUP"; fail "App package install failed. The previous version was restored."; }
fi
echo "Flockpath update: rebuilding the app..."
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
echo "Flockpath update: kept your accounts, library, drafts, jobs, models, church logos, pack PDFs, and logs. Backup at $BACKUP."
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
