#!/bin/bash
# Builds the Mac test package from the repo.
# Usage: bash mac-package/build-mac-package.sh <version> [install|update] [--with-phos]
#   install: full first-install zip (always carries phos.db).
#   update:  update zip (carries phos.db only with --with-phos,
#            so routine code updates stay small).
# Output: output/mac-packages/flockpath-mac-test-<version>.zip
#         or output/mac-packages/flockpath-update-<version>.zip
# The zip root is flockpath-mac-test/, holding flockpath/ (the
# app), hymn-desk/ (matcher + hymns), and the updater and log
# bundler. It never carries models, accounts, libraries,
# drafts, jobs, node_modules, .next, or test artifacts.
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
KIND="${2:-install}"
WITH_PHOS=0
[ "${3:-}" = "--with-phos" ] && WITH_PHOS=1
[ -n "$VERSION" ] || { echo "Usage: bash mac-package/build-mac-package.sh <version> [install|update] [--with-phos]" >&2; exit 1; }
[ "$KIND" = "install" ] || [ "$KIND" = "update" ] || { echo "Kind must be install or update." >&2; exit 1; }
[ "$(tr -d '[:space:]' < "$REPO/VERSION")" = "$VERSION" ] || { echo "VERSION file says $(tr -d '[:space:]' < "$REPO/VERSION"), not $VERSION. Bump lib/version.mjs and VERSION first." >&2; exit 1; }

OUT_DIR="$REPO/output/mac-packages"
STAGE="$OUT_DIR/.stage-$KIND-$VERSION"
ROOT="$STAGE/flockpath-mac-test"
APP="$ROOT/flockpath"
PHOS_DB="$OUT_DIR/phos.db"
if [ "$KIND" = "install" ] || [ "$WITH_PHOS" = "1" ]; then
  [ -f "$PHOS_DB" ] || { echo "Trimmed phos.db not found at $PHOS_DB. Build it first." >&2; exit 1; }
fi
[ -f "$REPO/../hymn-desk/data/hymns.json" ] || { echo "hymn-desk data/hymns.json not found." >&2; exit 1; }
[ -f "$REPO/../hymn-desk/scripts/match_hymn.py" ] || { echo "hymn-desk scripts/match_hymn.py not found." >&2; exit 1; }

rm -rf "$STAGE"
mkdir -p "$APP/data" "$ROOT/hymn-desk/scripts" "$ROOT/hymn-desk/data"
# App tree, minus everything that is not shipped.
rsync -a \
  --exclude '/node_modules/' --exclude '/.next/' --exclude '/.venv/' \
  --exclude '/models/' --exclude '/output/' --exclude '/data/' \
  --exclude '/mac-package/' --exclude '/tools/typst-x86_64-unknown-linux-musl/' \
  --exclude '/tools/typst.tar.xz' --exclude '/*.log' \
  --exclude '/.env' \
  --exclude '/flockpath-mac-4b-test-john3.py' \
  --include '/OPEN-SOURCE.md' --exclude '/*.md' \
  "$REPO/" "$APP/"
# Shipped data only: BSB stores, the demo pack, the demo draft,
# and (install, or update with --with-phos) the trimmed Phos DB.
for f in "$REPO"/data/bsb-*.json; do
  # Merged stores are per-run test artifacts, not shipped data.
  case "$f" in *-merged.json) continue ;; esac
  cp "$f" "$APP/data/"
done
cp "$REPO/data/locked-pack.json" "$REPO/data/generated-pack-draft-v2.json" "$APP/data/"
if [ "$KIND" = "install" ] || [ "$WITH_PHOS" = "1" ]; then
  cp "$PHOS_DB" "$APP/data/phos.db"
fi
# Hymn Desk sibling: matcher + index only, nothing else.
cp "$REPO/../hymn-desk/scripts/match_hymn.py" "$ROOT/hymn-desk/scripts/"
cp "$REPO/../hymn-desk/data/hymns.json" "$ROOT/hymn-desk/data/"
# Updater + log bundler at the package root.
for f in update-flockpath.sh update-flockpath.command collect-logs.sh collect-logs.command; do
  cp "$REPO/mac-package/$f" "$ROOT/$f"
  chmod +x "$ROOT/$f"
done
# Public dir: keep the demo PDF, drop test and generated PDFs.
rm -f "$APP"/public/pack-job-*.pdf "$APP"/public/pack-john3-mac-4b-full.pdf

if [ "$KIND" = "install" ]; then
  # The version already starts with mac-test, so do not double it.
  case "$VERSION" in
    mac-test-*) ZIP="$OUT_DIR/flockpath-$VERSION.zip" ;;
    *) ZIP="$OUT_DIR/flockpath-mac-test-$VERSION.zip" ;;
  esac
else
  ZIP="$OUT_DIR/flockpath-update-$VERSION.zip"
fi
rm -f "$ZIP"
(cd "$STAGE" && zip -r -q "$ZIP" flockpath-mac-test)
# Verify the zip: version present, shipped data complete
# (all 66 BSB stores, demo pack, demo draft), no user data,
# no build dirs. Completeness matters because the updater
# uses --delete: a partial data set would erase installed
# files the update did not carry.
CHECK="$(unzip -l "$ZIP")"
echo "$CHECK" | grep -q "flockpath-mac-test/flockpath/VERSION" || { echo "Zip missing flockpath/VERSION." >&2; exit 1; }
BSB_COUNT="$(echo "$CHECK" | grep "flockpath-mac-test/flockpath/data/bsb-.*\.json" | grep -vc "merged")"
[ "$BSB_COUNT" -eq 66 ] || { echo "Zip has $BSB_COUNT BSB stores, expected 66." >&2; exit 1; }
echo "$CHECK" | grep -q "flockpath-mac-test/flockpath/data/locked-pack.json" || { echo "Zip missing demo locked-pack.json." >&2; exit 1; }
echo "$CHECK" | grep -q "flockpath-mac-test/flockpath/data/generated-pack-draft-v2.json" || { echo "Zip missing demo draft." >&2; exit 1; }
for bad in "models/" "auth.db" "packs-library.json" "node_modules/" ".next/" "pack-job-" "pack-john3"; do
  echo "$CHECK" | grep -q "$bad" && { echo "Zip wrongly contains $bad." >&2; exit 1; }
done
if [ "$KIND" = "install" ]; then
  echo "$CHECK" | grep -q "flockpath-mac-test/flockpath/data/phos.db" || { echo "Install zip missing data/phos.db." >&2; exit 1; }
fi
echo "Built $ZIP ($(du -h "$ZIP" | cut -f1), $(echo "$CHECK" | tail -n +4 | grep -c '^ ') files)"
echo "Stage kept at $STAGE for inspection."
