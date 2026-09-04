#!/usr/bin/env bash
# Generates one short audio clip per phoneme token that game-core.js's
# phonemes() can emit, using espeak-ng's phoneme input ([[...]] Kirshenbaum
# notation) so the sound is spoken in ISOLATION — something no ordinary
# text-to-speech voice will do. Output: audio/ph/<TOKEN>.mp3 + manifest.json.
#
# Build-time tool only. The site itself stays dependency-free; these files
# are committed. Re-run only if the token set in phonemes() changes.
#
#   brew install espeak-ng ffmpeg     (mac)      apt-get install espeak-ng ffmpeg (linux)
#   bash tools/make-phonemes.sh
#
# Stops (b d g k p t) have no sound without a release, so they get a tiny
# schwa that is then trimmed to the burst — the closest a synthesiser gets
# to a "pure" /b/ without saying "buh".
set -euo pipefail
OUT="${1:-audio/ph}"
mkdir -p "$OUT"

# token  espeak-phonemes  is_stop
CLIPS="
B     b@     1
D     d@     1
G     g@     1
K     k@     1
P     p@     1
T     t@     1
C     tS     0
J     dZ     0
F     f      0
H     h@     1
L     l      0
M     m      0
N     n      0
NG    N      0
R     r      0
S     s      0
SH    S      0
TH    T      0
V     v      0
W     w      0
Y     j      0
Z     z      0
AE    a      0
EH    E      0
IH    I      0
AO    0      0
UH    V      0
EY    eI     0
IY    i:     0
AY    aI     0
OW    oU     0
UW    u:     0
AW    aU     0
OY    OI     0
AR    A:r    0
OR    O:r    0
ER    3:r    0
"

manifest="["
first=1
while read -r tok ph stop; do
  [ -z "$tok" ] && continue
  wav="$OUT/$tok.wav"
  # -v en-us voice, -s speed (slow), -p pitch, -a amplitude, -g word gap
  espeak-ng -v en-us -s 110 -a 180 -w "$wav" "[[$ph]]" </dev/null >/dev/null
  if [ "$stop" = "1" ]; then
    # Keep only the burst + a whisper of release.
    ffmpeg -nostdin -loglevel error -y -i "$wav" -t 0.16 -af "afade=t=out:st=0.10:d=0.06" "$OUT/$tok.tmp.wav"
    mv "$OUT/$tok.tmp.wav" "$wav"
  fi
  ffmpeg -nostdin -loglevel error -y -i "$wav" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.05" -codec:a libmp3lame -q:a 4 "$OUT/$tok.mp3"
  rm -f "$wav"
  [ $first = 1 ] || manifest="$manifest,"
  first=0
  manifest="$manifest\"$tok\""
done <<< "$CLIPS"
manifest="$manifest]"
printf '{ "version": 1, "format": "mp3", "tokens": %s }\n' "$manifest" > "$OUT/manifest.json"
echo "wrote $(ls "$OUT"/*.mp3 | wc -l) clips to $OUT"
