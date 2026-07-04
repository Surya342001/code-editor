#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════╗"
echo "║       Local Terminal — AI Code Editor    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies (first run may take a while)…"
  npm install
fi

# Rebuild native modules for Electron (node-pty)
echo "🔨 Rebuilding native modules for Electron…"
./node_modules/.bin/electron-rebuild -f -w node-pty 2>/dev/null || echo "⚠  node-pty rebuild skipped (terminal may have limited functionality)"

echo ""
echo "🚀 Starting Local Terminal…"
echo "   Press Ctrl+C to stop"
echo ""

npm run dev
