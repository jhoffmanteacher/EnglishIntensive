#!/usr/bin/env bash
# Runs tests.html in headless Chrome and prints the summary line.
# Build-time helper; the site itself needs no tooling.
set -uo pipefail
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in chromium google-chrome chrome /opt/pw-browsers/chromium-1194/chrome-linux/chrome; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
PORT="${PORT:-8000}"
"$CHROME" --headless=new --disable-gpu --no-sandbox --enable-logging=stderr \
  --dump-dom "http://localhost:$PORT/tests.html" 2>/tmp/ei-test-console.txt \
  | grep -o '[0-9]*/[0-9]* passing'
grep -c 'Uncaught' /tmp/ei-test-console.txt | sed 's/^/uncaught: /'
grep -o 'FAIL[^<]*' /tmp/ei-test-console.txt | head -20
exit 0
