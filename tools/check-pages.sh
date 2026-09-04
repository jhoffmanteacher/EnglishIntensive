#!/usr/bin/env bash
# Loads every page in headless Chrome and reports console errors and CSP
# violations. The mic games can't be *played* headlessly; this is the bar
# they can clear — the page builds, and nothing throws on the way.
set -uo pipefail
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in chromium google-chrome chrome /opt/pw-browsers/chromium-1194/chrome-linux/chrome; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
PORT="${PORT:-8000}"
fail=0
for f in "$@"; do
  out=$("$CHROME" --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=1 \
        --virtual-time-budget=3000 --dump-dom "http://localhost:$PORT/$f" 2>&1 >/dev/null)
  bad=$(printf '%s\n' "$out" | grep -E 'Uncaught|Refused to (load|execute|apply|connect)|Content Security Policy' | grep -v 'favicon')
  if [ -n "$bad" ]; then
    echo "--- $f"
    printf '%s\n' "$bad" | head -6
    fail=1
  fi
done
[ $fail = 0 ] && echo "pages clean: $*"
exit 0
