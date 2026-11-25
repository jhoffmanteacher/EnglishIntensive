# tools/mic-takes/ — the listening check's real recordings

Every `*.json` file here is replayed by `node tools/listen-loop.mjs` on every
run, through the real game engines, and its false rejects and false accepts are
counted. These files are the **regression corpus** for the site's listening
rules, and they are committed on purpose.

**What is in them:** what Chrome's speech recogniser returned while **the
teacher** read a word list aloud on `mic-takes.html` — words, timings,
confidence values, the settings, the browser's user-agent string and a
one-line room/mic note. **No student data.** No audio either: the recorder's
plain "Download takes" file has none. (Its "with audio" file holds the
teacher's own voice; keep that one on the computer it was made on unless you
mean to commit it.)

**How to add one:** sign in as a teacher, open `mic-takes.html` (it is linked
from nowhere a student can reach), record, press **Download takes**, and put
the file in this folder. Then run `node tools/listen-loop.mjs --source=takes`
to see what the engines make of it.

## The schema (`ei-mic-takes/1`)

One JSON object per file.

| field | what it is |
|---|---|
| `schema` | `"ei-mic-takes/1"`. The loop refuses any other value. |
| `tool` | `"mic-takes.html"` |
| `recordedAt` | ISO time the recording started |
| `listId`, `listTitle`, `family` | the list read (any list id; the loop replays it into every listening mode of that list's family and number) |
| `script` | `"right"` or `"wrong"` — the script chosen. Each item has its own `script` too (a `wrong` script contains `noise` items). |
| `variant` | the recogniser settings: `site` (exactly Say It's), `nbest5`, `on-device`, `biased-phrases`. The loop reports each variant in its own table. |
| `biased` | `true` for `biased-phrases`: the recogniser was told to expect the word on screen. Never a site setting. |
| `config` | the settings the session used: `lang`, `continuous`, `interimResults`, `maxAlternatives` (null = Chrome's default, 1), `processLocally`, `phrases`, `startTrack` (always false: start() with no track, as Say It) |
| `listFlags` | `{ list, say }`: the switches the chosen list, and the same list's Say It entry, pass to the engines — `phonetic`, `join`, `homophones`, `soundalikes`, `irregular`, `blend`, `blendLength`, `sound`, `speak` |
| `userAgent` | `navigator.userAgent` of the recording machine |
| `room` | the free-text room/mic note |
| `skipped` | words of a `wrong` script with no misreading to ask for |
| `items` | one record per item, in the order read |

Each item:

| field | what it is |
|---|---|
| `n` | position in the script |
| `target` | the word on screen (plain: no syllable dots, no heart braces) |
| `entry` | the list's marked-up entry (`s{ai}d`, `fan·tas·tic`) |
| `script` | the answer key: `right` (read as written), `wrong` (the misreading in `asked`, said on purpose), `noise` (not a reading: `asked.kind` is `silence`, `cough`, `um` or `idk`) |
| `asked` | for `wrong` / `noise`: `{ say, how, kind, src }` — what the reader was asked to say, the hint shown, the kind of error, and whether it came from a rule or the hand table (`tools/wrong-readings.js`) |
| `shownAt` | ISO time the word appeared |
| `again` | how many times this item was re-recorded with **Again** before this take was kept |
| `sessions` | how many recogniser sessions the item used (Chrome ends one after a silence; the recorder starts the next 200 ms later, as Say It does) |
| `events` | everything the recogniser did, in order (below) |
| `audio` | only in a "with audio" file: `{ mime, bytes, base64 }` of a MediaRecorder recording of the item |

Each event: `t` (ms since the word appeared, 0.1 ms resolution), `session`
(1, 2, …), `type`, and by type:

- `result`: `resultIndex` and `results` — **every** result of the session so
  far, as Chrome's `event.results` holds them: `{ isFinal, alts: [{ transcript,
  confidence }] }`. `alts` has one entry unless the variant asked for more.
- `error`: `error` (Chrome's code: `no-speech`, `network`, `not-allowed`,
  `aborted`…) and `message`.
- `start-called`, `start`, `audiostart`, `soundstart`, `speechstart`,
  `speechend`, `soundend`, `audioend`, `nomatch`, `end`: when Chrome fired them.
- `note`: something the recorder itself wants on the record (a refused
  setting).

The loop replays `result` and `error` events, each session as its own stream,
at their own times after the word appears in the engine; the rest are kept
for reading.
