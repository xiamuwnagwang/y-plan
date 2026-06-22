#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$PROJECT_ROOT/bin"
DIST_DIR="$PROJECT_ROOT/dist"

VERSION="${1:-$(git -C "$PROJECT_ROOT" describe --tags --abbrev=0 2>/dev/null || echo "dev")}"
PLATFORM="${2:-$(uname -s | tr '[:upper:]' '[:lower:]')}"
ARCH="${3:-$(uname -m)}"

# Normalize arch
case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac

# Normalize platform
case "$PLATFORM" in
  darwin) PLATFORM="darwin" ;;
  linux) PLATFORM="linux" ;;
  mingw*|msys*|cygwin*|windows*) PLATFORM="windows" ;;
esac

SUFFIX=""
[[ "$PLATFORM" == "windows" ]] && SUFFIX=".exe"

echo "Building Y-Plan ${VERSION} for ${PLATFORM}-${ARCH}"

# Check bun
if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required. Install from https://bun.sh" >&2
  exit 1
fi

# Build binaries
mkdir -p "$BIN_DIR"
echo "Compiling y-plan..."
bun build --compile "$PROJECT_ROOT/scripts/y-plan.mjs" --outfile "$BIN_DIR/y-plan${SUFFIX}"
echo "Compiling y-plan-install..."
bun build --compile "$PROJECT_ROOT/scripts/install.mjs" --outfile "$BIN_DIR/y-plan-install${SUFFIX}"

echo "Binaries:"
ls -lh "$BIN_DIR"/y-plan* 2>/dev/null

# Package for release
mkdir -p "$DIST_DIR"
ARCHIVE_NAME="y-plan-${VERSION}-${PLATFORM}-${ARCH}"

echo "Packaging ${ARCHIVE_NAME}..."

STAGING_DIR="$DIST_DIR/.staging-${ARCHIVE_NAME}"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR/y-plan"

# Copy everything except .git, bin, dist, node_modules, config
rsync -a \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'bin' \
  --exclude 'dist' \
  --exclude 'node_modules' \
  --exclude 'y-plan.config.json' \
  "$PROJECT_ROOT/" "$STAGING_DIR/y-plan/"

# Copy binaries into the package
mkdir -p "$STAGING_DIR/y-plan/bin"
cp "$BIN_DIR/y-plan${SUFFIX}" "$STAGING_DIR/y-plan/bin/"
cp "$BIN_DIR/y-plan-install${SUFFIX}" "$STAGING_DIR/y-plan/bin/"

if [[ "$PLATFORM" == "windows" ]]; then
  (cd "$STAGING_DIR" && zip -r "$DIST_DIR/${ARCHIVE_NAME}.zip" y-plan/)
  echo "Created: dist/${ARCHIVE_NAME}.zip"
else
  tar -czf "$DIST_DIR/${ARCHIVE_NAME}.tar.gz" -C "$STAGING_DIR" y-plan/
  echo "Created: dist/${ARCHIVE_NAME}.tar.gz"
fi

rm -rf "$STAGING_DIR"
echo "Done."
