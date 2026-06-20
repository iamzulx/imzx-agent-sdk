#!/usr/bin/env bash
# imzx — One-line install script
# Usage: curl -sSL https://raw.githubusercontent.com/iamzulx/imzx-agent-sdk/main/scripts/install.sh | bash

set -euo pipefail

REPO="iamzulx/imzx-agent-sdk"
VERSION="latest"
INSTALL_DIR="${HOME}/.local/bin"

echo "Installing imzx-agent-sdk..."

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH_NAME="x64" ;;
  aarch64|arm64) ARCH_NAME="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY_NAME="imzx-${PLATFORM}-${ARCH_NAME}"
[ "$PLATFORM" = "win" ] && BINARY_NAME="${BINARY_NAME}.exe"

# Try binary install first
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${BINARY_NAME}"

echo "Platform: ${PLATFORM}-${ARCH_NAME}"
echo "Downloading: ${DOWNLOAD_URL}"

mkdir -p "$INSTALL_DIR"

if curl -sSL --fail -o "${INSTALL_DIR}/imzx" "$DOWNLOAD_URL" 2>/dev/null; then
  chmod +x "${INSTALL_DIR}/imzx"
  echo "✓ Binary installed to ${INSTALL_DIR}/imzx"
  echo "  Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
else
  echo "Binary not available. Falling back to npm install..."
  
  # npm fallback
  if command -v npm &>/dev/null; then
    npm install -g @iamzulx/imzx 2>/dev/null && {
      echo "✓ Installed via npm"
      echo "  Run: imzx --help"
    } || {
      echo "npm install failed. Trying from source..."
      TMPDIR=$(mktemp -d)
      cd "$TMPDIR"
      curl -sSL "https://github.com/${REPO}/archive/refs/heads/main.tar.gz" | tar xz
      cd imzx-agent-sdk-main
      npm install --ignore-scripts
      npm link
      cd /
      rm -rf "$TMPDIR"
      echo "✓ Installed from source"
    }
  else
    echo "Error: npm not found. Install Node.js first:"
    echo "  https://nodejs.org/"
    exit 1
  fi
fi

echo ""
echo "Verify: imzx --version"
imzx --version 2>/dev/null || echo "(restart your shell to pick up PATH changes)"
