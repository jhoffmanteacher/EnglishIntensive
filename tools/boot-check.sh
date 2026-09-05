#!/usr/bin/env bash
# Starts every engine, one per page load, and drives a few clicks through
# the ones that can be driven. tests.html covers the pure logic; this
# covers what it structurally cannot — that start() builds its screens
# against the real word lists and that clicking through doesn't throw.
#
# One page load per engine on purpose: the engines share element ids
# (each one owns its page) and leave timers running, so two in one
# document would drive each other's screens.
set -uo pipefail
CHROME="${CHROME:-}"
if [ -z "$CHROME" ]; then
  for c in chromium google-chrome chrome /opt/pw-browsers/chromium-1194/chrome-linux/chrome; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME="$c"; break; fi
  done
fi
PORT="${PORT:-8000}"
GAMES="say say-red spell cards cards-nonsense split match fluency blendit"
fail=0
for g in $GAMES; do
  out=$("$CHROME" --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=1 \
        --virtual-time-budget=4000 --dump-dom "http://localhost:$PORT/tools/boot-check.html?g=$g" 2>/tmp/ei-boot-$g.txt)
  title=$(printf '%s' "$out" | grep -o '<title>[^<]*' | sed 's/<title>//')
  bad=$(grep -E 'Uncaught|Refused to' /tmp/ei-boot-$g.txt | grep -v favicon | head -3)
  if [ "${title#ok}" = "$title" ] || [ -n "$bad" ]; then
    echo "--- $g: ${title:-no title}"
    [ -n "$bad" ] && printf '%s\n' "$bad"
    fail=1
  fi
done
[ $fail = 0 ] && echo "engines ok: $GAMES"
exit 0
