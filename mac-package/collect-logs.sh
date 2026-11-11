#!/bin/bash
# Bundles the Flockpath logs into one zip to send when
# something goes wrong. Run it from the flockpath-mac-test
# folder, or double-click collect-logs.command.
# Output: flockpath-logs-<date>.zip next to this script,
# holding the app, worker, start, and update logs plus the
# installed version. Logs older than 7 days are already
# deleted automatically on every app start and update.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="${FLOCKPATH_PACKAGE_DIR:-$SCRIPT_DIR}"
APP_ROOT="$PACKAGE_DIR/flockpath"
[ -d "$APP_ROOT/data/logs" ] || { echo "Flockpath logs: no logs folder yet. Start the app once first." >&2; exit 1; }
OUT="$PACKAGE_DIR/flockpath-logs-$(date +%Y%m%d-%H%M%S).zip"
cd "$APP_ROOT" || exit 1
if ! ls data/logs/*.log >/dev/null 2>&1; then
  echo "Flockpath logs: no log files yet. Start the app once first." >&2
  exit 1
fi
zip -j -q "$OUT" data/logs/*.log VERSION || { echo "Flockpath logs: zip failed." >&2; exit 1; }
echo "Flockpath logs: bundled at $OUT"
echo "Flockpath logs: send that file when reporting an issue."
