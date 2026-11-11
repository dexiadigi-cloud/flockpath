#!/bin/bash
# macOS double-click starter. It just runs start-flockpath.sh
# from the same folder. If Terminal asks, allow it to run.
cd "$(dirname "$0")" || exit 1
exec bash start-flockpath.sh
