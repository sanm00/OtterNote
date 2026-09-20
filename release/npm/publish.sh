#!/bin/sh
# Build and publish the generated npm installer package to npm, in the order
# that is actually safe.
#
# The npm package downloads a GitHub release during installation, so publishing
# it before the release exists would hand users a broken install. This script
# refuses to do that. It also re-runs the consistency gate and the full quality
# checks, so a publish cannot happen on top of a red tree.
#
# Version numbers are never rewritten here: src-tauri/tauri.conf.json is the
# source of truth and is bumped as part of normal development, then tagged.
#
# Usage: sh release/npm/publish.sh [--dry-run] [--yes] [--skip-gates] [--help]

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
DRY_RUN=0
ASSUME_YES=0
SKIP_GATES=0

info() { printf '  %s\n' "$1"; }
step() { printf '\n==> %s\n' "$1"; }
die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Publish the OtterNote npm installer package.

  sh release/npm/publish.sh [options]

Options:
  --dry-run      run every check and show the tarball, but do not publish
  --yes          skip the confirmation prompt
  --skip-gates   skip the quality checks (docs-only changes; use with care)
  -h, --help     show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    --skip-gates) SKIP_GATES=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

for tool in node npm git curl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required but not on PATH"
done

confirm() {
  if [ "$ASSUME_YES" = 1 ]; then
    return 0
  fi
  if [ -r /dev/tty ]; then
    printf '%s [y/N] ' "$1"
    read -r answer </dev/tty || answer=""
    case "$answer" in
      y | Y | yes | YES) return 0 ;;
      *) die "aborted" ;;
    esac
  fi
  die "$1 (re-run with --yes to confirm non-interactively)"
}

run_gate() {
  label=$1
  shift
  step "$label"
  ( cd "$ROOT" && "$@" )
}

# --- 1. workspace state ------------------------------------------------------

step "Workspace"
branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
info "branch: $branch"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  info "working tree: dirty"
  [ "$branch" = main ] || die "publish from a clean tree on main (current: $branch)"
  confirm "The working tree has uncommitted changes. Publish anyway?"
else
  info "working tree: clean"
fi
[ "$branch" = main ] || info "warning: not on main; the release tag and this package may disagree"

VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/src-tauri/tauri.conf.json','utf8')).version")
REPO=$(sed -n 's/^REPO="\(.*\)"/\1/p' "$ROOT/release/install/install.sh" | head -1)
[ -n "$VERSION" ] || die "could not read the version from src-tauri/tauri.conf.json"
[ -n "$REPO" ] || die "could not read the repository slug from release/install/install.sh"
info "version: $VERSION (from src-tauri/tauri.conf.json)"
info "repository: $REPO"

# --- 2. consistency gate ----------------------------------------------------

run_gate "Consistency (versions, asset names, install dirs, package contents)" \
  node release/npm/verify.mjs

# --- 3. quality gates -------------------------------------------------------

if [ "$SKIP_GATES" = 1 ]; then
  step "Quality gates skipped (--skip-gates)"
else
  run_gate "Type check" npm run typecheck
  run_gate "Lint" npm run lint
  run_gate "Formatting" npm run format:check
  run_gate "Frontend tests" npm test
  run_gate "Rust formatting" cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
  run_gate "Rust lints" cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
  run_gate "Rust tests" cargo test --manifest-path src-tauri/Cargo.toml
  run_gate "Frontend build" npm run build
fi

# --- 4. the release it installs must already exist ---------------------------

step "GitHub release"
auth=""
[ -n "${GITHUB_TOKEN:-}" ] && auth="Bearer $GITHUB_TOKEN"
if [ -n "$auth" ]; then
  status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: $auth" \
    "https://api.github.com/repos/$REPO/releases/tags/v$VERSION")
else
  status=$(curl -sS -o /dev/null -w '%{http_code}' \
    "https://api.github.com/repos/$REPO/releases/tags/v$VERSION")
fi

case "$status" in
  200)
    info "v$VERSION exists on $REPO"
    ;;
  404)
    if [ "$DRY_RUN" = 1 ]; then
      info "release v$VERSION not found (a real publish would stop here)"
    else
      die "release v$VERSION does not exist yet. npm installs download it during
       postinstall, so publishing now would break them. Push the v$VERSION tag
       first and let the release workflow publish the artifacts."
    fi
    ;;
  *)
    info "could not confirm the release (HTTP $status). Check network or
           GITHUB_TOKEN; a missing release breaks the package for every user."
    if [ "$DRY_RUN" = 1 ]; then
      info "continuing because of --dry-run"
    else
      confirm "Continue without a confirmed release?"
    fi
    ;;
esac

# --- 5. assemble the npm package ---------------------------------------------

step "Assemble npm package"
node "$ROOT/release/npm/assemble.mjs" "$ROOT/.npm-pkg"
info "package ready in $ROOT/.npm-pkg"

# --- 6. what would be published ----------------------------------------------

step "Tarball contents"
(cd "$ROOT/.npm-pkg" && npm pack --dry-run) 2>&1 |
  sed -n '/Tarball Contents/,$p' |
  sed 's/^/  /'

if [ "$DRY_RUN" = 1 ]; then
  step "Dry run: nothing was published"
  info "publish with: sh release/npm/publish.sh"
  exit 0
fi

# --- 7. publish ---------------------------------------------------------------

step "Publish"
confirm "Publish $REPO's npm package otter-note@$VERSION to registry.npmjs.org?"
(cd "$ROOT/.npm-pkg" && npm publish)

step "Published"
info "verify with: npm view otter-note version"
info "installation downloads the GitHub release, so users get v$VERSION assets"
