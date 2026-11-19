#!/bin/bash
# One-command installer / updater for macOS (run from Terminal).
#   Public repo:  curl -fsSL https://raw.githubusercontent.com/philipjkm/Tony/main/install.sh | bash
#   Private repo: the script asks for a GitHub token if the download is refused.
# Re-run it any time to update. Players, photos and settings are kept in ~/Poker Tournament Data.
set -euo pipefail

REPO="philipjkm/Tony"
DEST="${DEST:-$HOME/Poker Tournament App}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

say() { printf '\n  %s\n' "$*"; }
fail() { printf '\n  ✗ %s\n\n' "$*" >&2; exit 1; }

printf '\n  ♠ ♥  Poker Tournament installer  ♦ ♣\n'

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install the LTS version from https://nodejs.org and run this again."
command -v npm >/dev/null 2>&1 || fail "npm is missing (it comes with Node.js). Reinstall Node.js from https://nodejs.org."
say "Node.js $(node -v) found ✓"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

download() { # $1 = optional token
  local url="${TARBALL_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}"
  if [ -n "${1:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $1" -H "Accept: application/vnd.github+json" \
      "${TARBALL_URL:-https://api.github.com/repos/$REPO/tarball/main}" -o "$TMP/app.tgz"
  else
    curl -fsSL "$url" -o "$TMP/app.tgz"
  fi
}

say "Downloading the app..."
if ! download "${GITHUB_TOKEN:-}" 2>/dev/null; then
  { : < /dev/tty; } 2>/dev/null || fail "Download refused. The repository is private: make it public or set GITHUB_TOKEN."
  say "The repository is private, so GitHub needs a token (see the README for how to make one)."
  printf '  Paste your GitHub token (it stays hidden) and press Enter: '
  read -rs TOKEN < /dev/tty
  echo
  download "$TOKEN" || fail "GitHub refused the token. Check it has access to $REPO (Contents: read) and try again."
fi

mkdir -p "$TMP/src"
tar -xzf "$TMP/app.tgz" -C "$TMP/src" --strip-components=1
[ -f "$TMP/src/server.js" ] || fail "The download looks wrong (no server.js)."

say "Installing to: $DEST"
mkdir -p "$DEST"
# copy new files over the old version (node_modules and data are left alone)
cp -R "$TMP/src/." "$DEST/"
chmod +x "$DEST/Start Poker.command"

say "Installing building blocks (about a minute)..."
( cd "$DEST" && npm install --omit=dev --no-audit --no-fund --loglevel=error --update-notifier=false ) \
  || fail "npm install failed. Check your internet connection and run this again."
touch "$DEST/node_modules"

# Desktop shortcut (created locally, so macOS won't block it)
SHORTCUT="$HOME/Desktop/Start Poker.command"
if [ -d "$HOME/Desktop" ]; then
  printf '#!/bin/bash\nexec "%s/Start Poker.command"\n' "$DEST" > "$SHORTCUT"
  chmod +x "$SHORTCUT"
  say "Added \"Start Poker\" to your Desktop ✓"
fi

say "Done! ✓  Start it any time by double-clicking \"Start Poker\" on your Desktop,"
say "or by typing:   poker-start   (after opening a new Terminal window)"

# handy Terminal command
for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
  if [ -f "$rc" ] || [ "$rc" = "$HOME/.zshrc" ]; then
    grep -q 'alias poker-start=' "$rc" 2>/dev/null || printf '\nalias poker-start='"'"'"%s/Start Poker.command"'"'"'\n' "$DEST" >> "$rc"
  fi
done
echo
