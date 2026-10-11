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
#
# /r/ and /j/ need the same help, and for a while did not get it: espeak
# renders [[r]] and [[dZ]] on their own as pure SILENCE, so R.mp3 and
# J.mp3 shipped as two identical 331-byte files and Blend it played
# "crab" as /k/ … /a/ /b/. They are now made from [[r@]] and [[dZ@]] and
# trimmed back: /j/ like a stop, /r/ to its first 0.26 s, which is the
# r-glide before the schwa starts.
#
# The third column is that trim, in seconds (0 = keep the whole clip).
# And because a silent clip is invisible until a student hears a word
# with a hole in it, the script now REFUSES to finish if any clip peaks
# below -40 dB.
set -euo pipefail
OUT="${1:-audio/ph}"
mkdir -p "$OUT"

# token  espeak-phonemes  trim (s)
CLIPS="
B     b@     0.16
D     d@     0.16
G     g@     0.16
K     k@     0.16
P     p@     0.16
T     t@     0.16
C     tS     0
J     dZ@    0.16
F     f      0
H     h@     0.16
L     l      0
M     m      0
N     n      0
NG    N      0
R     r@     0.26
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
quiet=""
while read -r tok ph trim; do
  [ -z "$tok" ] && continue
  wav="$OUT/$tok.wav"
  # -v en-us voice, -s speed (slow), -p pitch, -a amplitude, -g word gap
  espeak-ng -v en-us -s 110 -a 180 -w "$wav" "[[$ph]]" </dev/null >/dev/null
  if [ "$trim" != "0" ]; then
    # Keep only the burst (or the glide) + a whisper of release: a 60 ms
    # fade that ends exactly at the cut.
    fade=$(awk -v t="$trim" 'BEGIN{ printf "%.2f", t - 0.06 }')
    ffmpeg -nostdin -loglevel error -y -i "$wav" -t "$trim" -af "afade=t=out:st=$fade:d=0.06" "$OUT/$tok.tmp.wav"
    mv "$OUT/$tok.tmp.wav" "$wav"
  fi
  ffmpeg -nostdin -loglevel error -y -i "$wav" -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.05" -codec:a libmp3lame -q:a 4 "$OUT/$tok.mp3"
  rm -f "$wav"
  # A clip nobody can hear is worse than no clip: phonemeAudio() believes
  # the manifest, so the game plays it and the student hears a gap.
  peak=$(ffmpeg -nostdin -hide_banner -i "$OUT/$tok.mp3" -af volumedetect -f null - 2>&1 \
         | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')
  if [ -z "$peak" ] || awk -v p="$peak" 'BEGIN{ exit !(p < -40) }'; then
    quiet="$quiet $tok(${peak:-?}dB)"
  fi
  [ $first = 1 ] || manifest="$manifest,"
  first=0
  manifest="$manifest\"$tok\""
done <<< "$CLIPS"
manifest="$manifest]"
printf '{ "version": 1, "format": "mp3", "tokens": %s }\n' "$manifest" > "$OUT/manifest.json"
echo "wrote $(ls "$OUT"/*.mp3 | wc -l) clips to $OUT"
if [ -n "$quiet" ]; then
  echo "SILENT OR NEAR-SILENT CLIPS:$quiet" >&2
  echo "espeak rendered these as nothing. Give them a schwa and a trim, like the stops." >&2
  exit 1
fi
