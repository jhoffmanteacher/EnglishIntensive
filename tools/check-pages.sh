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
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT
# The pages load the real Firebase SDK with the real project's config. The
# SDK itself comes from gstatic; these rules stop the page reaching the
# project, so a check can never touch it.
BLOCK='MAP *.googleapis.com ~NOTFOUND, MAP *.firebaseapp.com ~NOTFOUND, MAP *.firebaseio.com ~NOTFOUND'
# No arguments used to check nothing and still print "pages clean". Default
# to every page of the site.
if [ $# -eq 0 ]; then
  set -- $(cd "$(dirname "$0")/.." && ls *.html | grep -v '^tests.html$')
fi
for f in "$@"; do
  # "Clean" has to mean the page loaded. With no server or no Chrome there
  # are no error lines either, and that used to print "pages clean".
  if ! curl -fsS -o /dev/null "http://localhost:$PORT/$f"; then
    echo "--- $f: the server on port $PORT did not serve it"; fail=1; continue
  fi
  out=$("$CHROME" --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=1 \
        --host-resolver-rules="$BLOCK" \
        --virtual-time-budget=3000 --dump-dom "http://localhost:$PORT/$f" 2>&1 >"$OUT")
  status=$?
  if [ $status -ne 0 ] || ! grep -q '<body' "$OUT"; then
    echo "--- $f: Chrome did not load it (exit $status; CHROME=$CHROME)"; fail=1; continue
  fi
  bad=$(printf '%s\n' "$out" | grep -E 'Uncaught|Refused to (load|execute|apply|connect)|Content Security Policy' | grep -v 'favicon')
  if [ -n "$bad" ]; then
    echo "--- $f"
    printf '%s\n' "$bad" | head -6
    fail=1
  fi
done
[ $fail = 0 ] && echo "pages clean: $*"
exit 0
