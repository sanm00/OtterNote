#!/bin/sh
# OtterNote installer for macOS and Linux.
#
# Downloads a release asset, verifies its SHA256 checksum when the release
# provides one, and installs the app.
# The script never calls sudo and never touches your note data.
#
#   sh install.sh                  # install the latest release
#   sh install.sh --version 0.1.0  # install a specific version
#   sh install.sh --dry-run        # show what would happen
#   sh install.sh --uninstall      # remove the installed app
#
# Options may also be passed through the environment: VERSION, INSTALL_DIR,
# DRY_RUN=1, YES=1, GITHUB_TOKEN, BASE_URL.

set -eu

REPO="sanm00/OtterNote"
APP_NAME="OtterNote"

VERSION="${VERSION:-latest}"
DRY_RUN="${DRY_RUN:-0}"
YES="${YES:-0}"
BASE_URL="${BASE_URL:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

INSTALL_DIR="${INSTALL_DIR:-}"
UNINSTALL=0
OS=""
ARCH=""
ASSET=""
TMP_DIR=""
MOUNT_POINT=""

usage() {
  cat <<'EOF'
Install OtterNote from a GitHub release.

Usage: sh install.sh [options]

Options:
  -v, --version VERSION     Release version to install (default: latest)
  -d, --install-dir DIR     Where to install the app
                            (default: /Applications on macOS, ~/.local/bin on Linux)
      --uninstall           Remove an installed app and exit
      --dry-run             Resolve and print the plan without changing anything
  -y, --yes                 Do not ask for confirmation
  -h, --help                Show this help
      --base-url URL        Download assets from another location (mirrors,
                            self-hosted builds). Requires an explicit version.

Environment: VERSION, INSTALL_DIR, DRY_RUN, YES, GITHUB_TOKEN, BASE_URL.

Your notes live in ~/OtterNote and are never modified by this script.
EOF
}

info() {
  printf '%s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$MOUNT_POINT" ] && [ -d "$MOUNT_POINT" ]; then
    hdiutil detach -quiet "$MOUNT_POINT" 2>/dev/null || true
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

confirm() {
  # confirm <question>
  #
  # The script is often started as "curl ... | sh", where stdin carries the
  # script itself. Ask on the terminal in that case so a reinstall still works.
  if [ "$YES" = "1" ]; then
    return 0
  fi

  printf '%s [y/N] ' "$1" >&2

  if [ -r /dev/tty ] && read -r answer </dev/tty 2>/dev/null; then
    :
  elif [ -t 0 ] && read -r answer; then
    :
  else
    die "$1 (re-run with --yes to confirm non-interactively)"
  fi

  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) die "aborted" ;;
  esac
}

detect_platform() {
  raw_os=$(uname -s)
  case "$raw_os" in
    Darwin) OS="macos" ;;
    Linux) OS="linux" ;;
    *)
      die "unsupported operating system: $raw_os. Download manually from https://github.com/$REPO/releases"
      ;;
  esac

  raw_arch=$(uname -m)
  case "$OS:$raw_arch" in
    macos:arm64) ARCH="aarch64" ;;
    macos:x86_64) ARCH="x64" ;;
    linux:x86_64) ARCH="amd64" ;;
    linux:aarch64 | linux:arm64) ARCH="aarch64" ;;
    *)
      die "unsupported architecture: $raw_arch on $OS. Download manually from https://github.com/$REPO/releases"
      ;;
  esac
}

default_install_dir() {
  case "$OS" in
    macos) printf '/Applications' ;;
    linux) printf '%s' "${XDG_BIN_HOME:-$HOME/.local/bin}" ;;
  esac
}

release_base_url() {
  if [ -n "$BASE_URL" ]; then
    printf '%s' "${BASE_URL%/}"
  else
    printf 'https://github.com/%s/releases/download/v%s' "$REPO" "$VERSION"
  fi
}

asset_url() {
  printf '%s/%s' "$(release_base_url)" "$1"
}

fetch_stdout() {
  if [ -n "$GITHUB_TOKEN" ]; then
    curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "$1"
  else
    curl -fsSL "$1"
  fi
}

resolve_version() {
  if [ "$VERSION" != "latest" ]; then
    VERSION="${VERSION#v}"
    return 0
  fi

  if [ -n "$BASE_URL" ]; then
    die "--base-url requires an explicit --version"
  fi

  info "Resolving the latest release..."
  tag=$(fetch_stdout "https://api.github.com/repos/$REPO/releases/latest" |
    sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
    head -n 1)

  if [ -z "$tag" ]; then
    die "could not resolve the latest release. Pass --version <version> or download from https://github.com/$REPO/releases"
  fi

  VERSION="${tag#v}"
  info "Latest release is $VERSION."
}

asset_candidates() {
  case "$OS" in
    macos)
      printf '%s\n' \
        "OtterNote_${VERSION}_${ARCH}.dmg" \
        "OtterNote_${VERSION}_universal.dmg"
      ;;
    linux)
      printf '%s\n' \
        "otter-note_${VERSION}_${ARCH}.AppImage" \
        "otter-note_${VERSION}_${ARCH}.appimage" \
        "OtterNote_${VERSION}_${ARCH}.AppImage" \
        "OtterNote_${VERSION}_${ARCH}.appimage"
      ;;
  esac
}

resolve_asset() {
  tried=""
  for candidate in $(asset_candidates); do
    url=$(asset_url "$candidate")
    if curl -fsSIL -o /dev/null "$url" 2>/dev/null; then
      ASSET="$candidate"
      return 0
    fi
    tried="$tried $candidate"
  done

  die "no release asset found for $OS/$ARCH (version $VERSION). Tried:$tried
See available downloads at https://github.com/$REPO/releases"
}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

verify_checksum() {
  # verify_checksum <file> <checksum file> <asset name>
  #
  # Returns 0 when the file matches its checksum and 1 when the checksum file
  # says nothing about it. A file that does not match aborts the installation.
  file="$1"
  sums="$2"
  name="$3"

  expected=$(awk -v target="$name" '{ n = $2; sub(/^\*/, "", n); if (n == target) { print $1; exit } }' "$sums")
  if [ -z "$expected" ]; then
    return 1
  fi

  actual=$(hash_file "$file") || die "no sha256 tool found (need sha256sum or shasum)"
  if [ "$actual" != "$expected" ]; then
    die "checksum mismatch for $name
  expected: $expected
  actual:   $actual
The download was corrupted or tampered with. Nothing was installed."
  fi

  info "Checksum verified."
}

download_asset() {
  url="$1"
  target="$2"
  info "Downloading $ASSET..."
  curl -fsSL --retry 3 -o "$target" "$url" || die "download failed: $url"
}

install_macos() {
  app_path="$TMP_DIR/$ASSET"
  MOUNT_POINT="$TMP_DIR/mnt"
  mkdir -p "$MOUNT_POINT"

  hdiutil attach -nobrowse -quiet -mountpoint "$MOUNT_POINT" "$app_path" || die "could not mount $ASSET"

  source_app=""
  for candidate in "$MOUNT_POINT"/*.app; do
    if [ -d "$candidate" ]; then
      source_app="$candidate"
      break
    fi
  done

  if [ -z "$source_app" ]; then
    die "no .app bundle inside $ASSET"
  fi

  target_app="$INSTALL_DIR/$APP_NAME.app"

  if [ -d "$target_app" ]; then
    confirm "$target_app already exists. Replace it?"
    rm -rf "$target_app"
  fi

  mkdir -p "$INSTALL_DIR"
  ditto "$source_app" "$target_app" || die "could not copy the app to $INSTALL_DIR"
  hdiutil detach -quiet "$MOUNT_POINT"
  MOUNT_POINT=""

  info "Installed $target_app"

  if xattr "$target_app" 2>/dev/null | grep -q com.apple.quarantine; then
    info ""
    info "Note: this build is not signed or notarized, so macOS may refuse to open it."
    info "Open it once with right-click > Open, or allow it under"
    info "System Settings > Privacy & Security."
  fi
}

install_linux() {
  target_bin="$INSTALL_DIR/otter-note"

  if [ -e "$target_bin" ]; then
    confirm "$target_bin already exists. Replace it?"
  fi

  mkdir -p "$INSTALL_DIR"
  cp "$TMP_DIR/$ASSET" "$target_bin" || die "could not copy the app to $INSTALL_DIR"
  chmod +x "$target_bin"

  info "Installed $target_bin"

  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      info ""
      info "Note: $INSTALL_DIR is not in your PATH. Add it to your shell profile:"
      info "  export PATH=\"$INSTALL_DIR:\$PATH\""
      ;;
  esac

  info ""
  info "The AppImage needs libfuse2 to run. On systems without it, start the app with:"
  info "  $target_bin --appimage-extract-and-run"
}

uninstall_app() {
  case "$OS" in
    macos) target="$INSTALL_DIR/$APP_NAME.app" ;;
    linux) target="$INSTALL_DIR/otter-note" ;;
  esac

  if [ ! -e "$target" ]; then
    info "Nothing to remove: $target does not exist."
    return 0
  fi

  confirm "Remove $target?"
  rm -rf "$target"
  info "Removed $target"
  info "Your notes in ~/OtterNote were not touched."
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    -v | --version)
      [ $# -ge 2 ] || die "--version needs a value"
      VERSION="$2"
      shift 2
      ;;
    -d | --install-dir)
      [ $# -ge 2 ] || die "--install-dir needs a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --base-url)
      [ $# -ge 2 ] || die "--base-url needs a value"
      BASE_URL="$2"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -y | --yes)
      YES=1
      shift
      ;;
    *)
      die "unknown option: $1 (try --help)"
      ;;
  esac
done

detect_platform
if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR=$(default_install_dir)
fi

if [ "$UNINSTALL" = "1" ]; then
  uninstall_app
  exit 0
fi

resolve_version
resolve_asset

if [ "$DRY_RUN" = "1" ]; then
  info ""
  info "Dry run, nothing will be changed:"
  info "  platform:    $OS/$ARCH"
  info "  version:     $VERSION"
  info "  asset:       $ASSET"
  info "  url:         $(asset_url "$ASSET")"
  info "  checksums:   $(asset_url "SHA256SUMS")"
  info "  install dir: $INSTALL_DIR"
  exit 0
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/otternote-install.XXXXXX") || die "could not create a temporary directory"

download_asset "$(asset_url "$ASSET")" "$TMP_DIR/$ASSET"

checksum_file="$TMP_DIR/SHA256SUMS"
if curl -fsSL --retry 3 -o "$checksum_file" "$(asset_url "SHA256SUMS")"; then
  if ! verify_checksum "$TMP_DIR/$ASSET" "$checksum_file" "$ASSET"; then
    warn "SHA256SUMS does not mention $ASSET; installing without verification"
  fi
else
  warn "release $VERSION has no SHA256SUMS file; installing without verification"
fi

case "$OS" in
  macos) install_macos ;;
  linux) install_linux ;;
esac
