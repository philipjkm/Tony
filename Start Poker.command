#!/bin/bash
# Double-click this file on your Mac to start the poker tournament app.
# First time only: right-click it → Open → Open (macOS asks because it was downloaded).

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-3000}"
# Players, photos and settings live outside this folder, so downloading a new version never loses them.
export DATA_DIR="${DATA_DIR:-$HOME/Poker Tournament Data}"

pause_and_exit() { echo; read -r -p "Press Enter to close this window..."; exit "${1:-1}"; }

echo
echo "  ♠ ♥  Poker Tournament  ♦ ♣"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed. Download it from https://nodejs.org (LTS), install it, then double-click this file again."
  open "https://nodejs.org" 2>/dev/null
  pause_and_exit 1
fi

# Already running? Just open it.
if curl -s -o /dev/null "http://localhost:$PORT/api/info"; then
  echo "  Already running — opening it in your browser."
  open "http://localhost:$PORT" 2>/dev/null
  sleep 2
  exit 0
fi

# First run (or after an update): install the app's building blocks.
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  First start: installing (takes about a minute)..."
  if ! npm install --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false; then
    echo "  Install failed. Check your internet connection and try again."
    pause_and_exit 1
  fi
  touch node_modules
fi

echo "  Data folder: $DATA_DIR"
echo "  Keep this window open while you play. Close it (or press Ctrl+C) to stop."
echo

# Open the browser once the server is up.
( for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:$PORT/api/info"; then open "http://localhost:$PORT" 2>/dev/null; exit 0; fi
    sleep 0.5
  done ) &

# caffeinate keeps the Mac (and the TV picture) from going to sleep during the game.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dims node server.js
else
  node server.js
fi
pause_and_exit $?
