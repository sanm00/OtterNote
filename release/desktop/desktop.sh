#!/bin/sh
# Package the OtterNote desktop bundles for the current host.
#
#   sh release/desktop/desktop.sh                     # all bundles (dmg / deb)
#   sh release/desktop/desktop.sh --bundles app       # just the .app (fast)
#   sh release/desktop/desktop.sh --target aarch64-apple-darwin
#
# Bundles land in src-tauri/target/<target>/release/bundle/. CI=true skips the
# macOS dmg Finder AppleScript, which fails with -1743 on machines without
# automation permission for Finder. Any arguments are passed straight through
# to `tauri build`.
set -eu

CDPATH= cd -- "$(dirname -- "$0")/../.." || exit 1
export CI=true

if [ $# -gt 0 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  echo "Usage: sh release/desktop/desktop.sh [tauri build args...]"
  echo "Examples:"
  echo "  sh release/desktop/desktop.sh --bundles app"
  echo "  sh release/desktop/desktop.sh --target aarch64-apple-darwin"
  exit 0
fi

exec npm run tauri -- build "$@"