#!/bin/bash
# macOS double-click log bundler. It just runs collect-logs.sh
# from the same folder. If Terminal asks, allow it to run.
cd "$(dirname "$0")" || exit 1
exec bash collect-logs.sh
