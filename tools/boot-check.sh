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
GAMES="say say-red say-noise say-late say-net spell cards cards-nonsense cards-keys split match match-say fluency fluency-revision fluency-skip fluency-net fluency-silent fluency-saved blendit"
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
# The phoneme clips are real. phonemeAudio() believes the manifest, so an
# empty file plays as a gap in the word: R.mp3 and J.mp3 once shipped as
# 331 bytes of silence each and Blend it said "crab" as /k/ /a/ /b/. A
# clip with sound in it is over a kilobyte; an empty MP3 frame is not.
# (tools/make-phonemes.sh checks the loudness itself when it builds them.)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$ROOT"/audio/ph/*.mp3; do
  [ -e "$f" ] || { echo "--- clips: none found in audio/ph"; fail=1; break; }
  n=$(wc -c < "$f" | tr -d ' ')
  if [ "$n" -lt 800 ]; then
    echo "--- clips: $(basename "$f") is $n bytes — that is silence, not a sound"
    fail=1
  fi
done
[ $fail = 0 ] && echo "engines ok: $GAMES"
exit 0
