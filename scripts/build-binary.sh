#!/usr/bin/env bash
# imzx — Cross-platform binary build script
# Usage: ./scripts/build-binary.sh [platform]
# Platforms: linux-x64, linux-arm64, macos-arm64, win-x64, all

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PLATFORM="${1:-all}"
VERSION=$(node -p "require('./package.json').version")
DIST_DIR="$PROJECT_ROOT/dist"

echo "Building imzx v${VERSION} binaries..."

# Ensure pkg is available
if ! command -v pkg &>/dev/null; then
  echo "Installing pkg..."
  npm install -g pkg 2>/dev/null || npx --yes pkg --version
fi

mkdir -p "$DIST_DIR"

build_platform() {
  local target="$1"
  local output="$2"
  echo "  Building ${target}..."
  npx pkg \
    --target "$target" \
    --output "$DIST_DIR/$output" \
    --compress GZip \
    --public \
    bin/imzx.mjs 2>/dev/null || {
    echo "  [WARN] pkg build failed for ${target}, trying nexe..."
    npx nexe \
      --target "$target" \
      --output "$DIST_DIR/$output" \
      bin/imzx.mjs 2>/dev/null || {
      echo "  [SKIP] Neither pkg nor nexe available for ${target}"
      return 1
    }
  }
  echo "  ✓ $DIST_DIR/$output"
}

case "$PLATFORM" in
  linux-x64)
    build_platform "node20-linux-x64" "imzx-linux-x64"
    ;;
  linux-arm64)
    build_platform "node20-linux-arm64" "imzx-linux-arm64"
    ;;
  macos-arm64)
    build_platform "node20-macos-arm64" "imzx-macos-arm64"
    ;;
  win-x64)
    build_platform "node20-win-x64" "imzx-win-x64.exe"
    ;;
  all)
    build_platform "node20-linux-x64" "imzx-linux-x64" || true
    build_platform "node20-linux-arm64" "imzx-linux-arm64" || true
    build_platform "node20-macos-arm64" "imzx-macos-arm64" || true
    build_platform "node20-win-x64" "imzx-win-x64.exe" || true
    ;;
  *)
    echo "Unknown platform: $PLATFORM"
    echo "Available: linux-x64, linux-arm64, macos-arm64, win-x64, all"
    exit 1
    ;;
esac

echo ""
echo "Build complete. Binaries in $DIST_DIR/"
ls -lh "$DIST_DIR"/imzx-* 2>/dev/null || echo "(no binaries produced — install pkg or nexe globally)"
