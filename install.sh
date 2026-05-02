#!/bin/sh
# drenv install script
# Usage:
#   macOS / Linux:
#     curl -fsSL drenv.org/install.sh | bash
#
#   Windows (PowerShell):
#     irm https://drenv.org/install.ps1 | iex
#
#   or directly from GitHub (raw):
#     curl -fsSL https://raw.githubusercontent.com/Nitemaeric/drenv/main/install.sh | bash
#
# This script downloads the latest drenv release for your platform,
# installs it to ~/.drenv/bin, and prints instructions to add it to your PATH.

set -e

REPO="Nitemaeric/drenv"
INSTALL_DIR="$HOME/.drenv/bin"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64|aarch64) ASSET="aarch64-apple-darwin.drenv" ;;
      x86_64)        ASSET="x86_64-apple-darwin.drenv" ;;
      *) echo "Unsupported architecture: $ARCH on macOS" >&2; exit 1 ;;
    esac
    BIN_NAME="drenv"
    ;;
  Linux)
    case "$ARCH" in
      x86_64)        ASSET="x86_64-unknown-linux-gnu.drenv" ;;
      aarch64|arm64) ASSET="aarch64-unknown-linux-gnu.drenv" ;;
      *) echo "Unsupported architecture: $ARCH on Linux" >&2; exit 1 ;;
    esac
    BIN_NAME="drenv"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    case "$ARCH" in
      x86_64) ASSET="x86_64-pc-windows-msvc.drenv.exe" ;;
      *) echo "Unsupported architecture: $ARCH on Windows" >&2; exit 1 ;;
    esac
    BIN_NAME="drenv.exe"
    ;;
  *)
    echo "Unsupported operating system: $OS" >&2
    echo "Please download the binary manually from https://github.com/Nitemaeric/drenv/releases" >&2
    exit 1
    ;;
esac

URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

echo "==> Installing drenv for ${OS} ${ARCH}..."
echo "    Downloading ${ASSET} from GitHub Releases..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Download (follow redirects, fail on HTTP errors, show progress)
curl -fL --progress-bar -o "$BIN_NAME" "$URL"

# Make executable (no-op on Windows .exe in most environments)
chmod +x "$BIN_NAME" 2>/dev/null || true

echo ""
echo "==> drenv installed to $INSTALL_DIR/$BIN_NAME"
echo ""

# Print PATH instructions
if [ -n "${BIN_NAME##*.exe}" ]; then
  # Unix-like
  SHELL_NAME="$(basename "${SHELL:-sh}")"
  case "$SHELL_NAME" in
    zsh)  PROFILE="$HOME/.zshrc" ;;
    bash) PROFILE="$HOME/.bashrc" ;;
    fish) PROFILE="$HOME/.config/fish/config.fish" ;;
    *)    PROFILE="$HOME/.profile" ;;
  esac

  echo "Add the following line to your shell profile ($PROFILE):"
  echo ""
  echo "    export PATH=\"\$HOME/.drenv/bin:\$PATH\""
  echo ""
  echo "Then restart your shell or run:"
  echo "    source $PROFILE"
  echo ""
  echo "After that, run 'drenv --help' to get started."
else
  # Windows (Git Bash / MSYS)
  echo "Add the following to your PATH environment variable:"
  echo "    $INSTALL_DIR"
  echo ""
  echo "You can do this via System Properties > Environment Variables,"
  echo "or in PowerShell: [Environment]::SetEnvironmentVariable('Path', \$env:Path + ';$INSTALL_DIR', 'User')"
  echo ""
  echo "Then open a new terminal and run 'drenv --help'."
fi

echo ""
echo "==> Installation complete. Enjoy drenv!"
