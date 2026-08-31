#!/bin/zsh
set -e

# Finder launches do not load the interactive shell PATH. Include common Node
# locations so the source launcher behaves the same from Terminal or Finder.
export PATH="$HOME/.local/bin:$HOME/.nvm/current/bin:$HOME/.nvm/versions/node/current/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-5200}"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 or later is required."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node.js 24 or later is required. Current: $(node -v)"
  exit 1
fi

run_package_manager() {
  case "$PACKAGE_MANAGER" in
    pnpm) pnpm "$@" ;;
    npm) npm "$@" ;;
    corepack) corepack pnpm "$@" ;;
  esac
}

if command -v pnpm >/dev/null 2>&1; then
  PACKAGE_MANAGER=pnpm
elif command -v npm >/dev/null 2>&1; then
  PACKAGE_MANAGER=npm
elif command -v corepack >/dev/null 2>&1; then
  PACKAGE_MANAGER=corepack
else
  PACKAGE_MANAGER=""
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  if [ -z "$PACKAGE_MANAGER" ]; then
    echo "pnpm or npm is required to install dependencies."
    exit 1
  fi
  run_package_manager install
fi

if [ ! -f "dist/index.html" ]; then
  echo "Building the application..."
  if [ -z "$PACKAGE_MANAGER" ]; then
    echo "pnpm, npm, or corepack is required to build the application."
    exit 1
  fi
  run_package_manager build
fi

URL="http://127.0.0.1:$PORT"
echo "Santu Infinite Canvas is starting at $URL"
echo "Keep this window open while using the app."

PORT="$PORT" node desktop/start-browser.js
