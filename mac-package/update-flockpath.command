#!/bin/bash
# macOS double-click updater. It just runs update-flockpath.sh
# from the same folder. If Terminal asks, allow it to run.
cd "$(dirname "$0")" || exit 1
exec bash update-flockpath.sh
