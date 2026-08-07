# English Intensive

Plain static HTML/JS games and activities for English language practice.
No build step and no dependencies. The audience is **9th–10th graders in
reading intervention** — older students practising skills usually taught
younger, so every visual and every line of copy stays age-respectful:
arcade/neon fictions, no grade labels, no elementary-coded imagery or
phrasing ("Multisyllable Words", not "Big Words").

Serve it over HTTPS (GitHub Pages) or `http://localhost` — **not** by opening
the files off disk. Chrome's speech recognition and microphone access both
require a secure context, so the games will not listen from a `file://` URL.

```bash
python3 -m http.server 8000
```

## Home page

`index.html` shows a grid of game tiles. Add a new game by dropping an entry
in the `GAMES` array in its inline `<script>` — `icon`, `title`,
`description`, `url`.

## Blend games

`blend-game.js` + `blend-game.css` are a shared engine for the "say the word
out loud" phonics games. A game page is just a word list:

```html
<link rel="stylesheet" href="blend-game.css">
<div id="app"></div>
<script src="blend-game.js"></script>
<script>
BlendGame.start({
  title: "Starting Blends 🎤",
  blend: "start",              // "start", "end", or "sound" — see below
  theme: "maze",                // "race" (default) or "maze" — the progress graphic
  words: ["blip","crop","clam"]
});
</script>
```

Three matching modes for `blend`, depending on what's being drilled:

- `"start"` / `"end"` — a fixed-length blend at one end of the word
  (`blendLength`, default 2). The blend must come back phonetically exact;
  the rest of the word gets the usual tolerance.
- `"sound"` — a target phoneme that can land anywhere in the word (e.g. the
  oi/oy diphthong: "coin", "boyish", "annoy"). Pass `sound` (one phoneme
  token from `phonemes()`, e.g. `"OY"`) and `highlight` (a regex matching the
  letters to show highlighted, e.g. `/oi|oy/i`) instead of `blendLength`. The
  sound is located by searching the word's phoneme sequence rather than
  slicing fixed letter positions, since its spelling position varies.
- No blend at all (plain word reading — nonsense words, multisyllable
  words): pass `blend: "start"` with `blendLength: 0`. The "blend" is then
  always empty, so nothing is force-matched and nothing is highlighted —
  it's a plain whole-word fuzzy match.

The plain progress bar is themed per game instead: `theme: "race"` slides a car
along a track toward a checkered flag, `theme: "maze"` is a **vault run** — a
ninja threading a neon laser corridor toward a diamond vault. Both use the same
word-index percentage as the old bar, so they work for any word-list length.
`blend-words-game.html` uses the race theme, `initial-blends-game.html` uses
the maze theme — pick either for a new game.

Word-list entries may carry **syllable marks** with a middle dot
(`"fan·tas·tic"`). The engine strips the dots everywhere that matters
(matching, speech, storage) and uses them only to scaffold: after a second
miss the reveal shows the word broken into its chunks (and, with Voice on,
pronounces it syllable by syllable, then whole), and the end screen's
missed-word chips keep the chunked form. Undotted words behave exactly as
before. `multisyllable-words-game.html` uses this throughout.

The engine renders every screen, so adding a game means copying one of the
existing pages and swapping the word list. Chrome only — it uses the Web
Speech API.

Current games:

- `blend-words-game.html` — words **ending** in a consonant blend.
- `initial-blends-game.html` — words **starting** with a consonant blend.
- `nonsense-words-game.html` — made-up CVC words, pure decoding practice.
- `oi-oy-words-game.html` — words with the oi/oy diphthong, anywhere in the word.
- `multisyllable-words-game.html` — two- and three-syllable real words, with
  syllable-chunk scaffolding.
- `spelling-oi-oy-game.html` — the site's first **spelling** game (see below).

### Comeback words (missed-word persistence)

Each game page keeps its own deck of not-yet-mastered words in
`localStorage` (`"blendComeback:" + pathname`): a word joins the deck when
it's missed twice or skipped in a round, and **leaves the deck the moment
it's read correctly on the first try** in any later round. When the deck has
words, the start screen grows a "🔁 Comeback words (N)" button that runs just
those words — most-missed first, capped at 15 so it stays a warm-up. The
storage layer treats localStorage as untrusted (versioned, sanitized on
read, silently absent if storage is unavailable), and the pure deck logic
(`comebackMerge` / `comebackMastered` / `comebackDeck`) is covered by
`tests.html`. The session-level "Practice missed words" button on the end
screen is unchanged and separate.

## Spelling game

`spell-game.js` is a second engine for **encoding** practice — the computer
says the word and the student types it. Deliberately mic-free, so it works
in a noisy room. A page passes `SpellGame.start({title, intro, rule, words})`;
`rule` is a short spelling rule shown on the start screen (the oi/oy page
teaches: *oy* before nothing-or-a-vowel — enjoy, royal; *oi* before a
consonant — coin, moist). The word is spoken (auto, plus "Say it again",
slower after a miss) but never printed before it's answered; second miss
reveals the correct spelling with the letters the student failed to produce
highlighted in gold (a Levenshtein backtrace, `diffLetters()`), then moves
on. Scoring, streaks, stars and the missed-words list match the blend games
exactly, and the pure helpers are covered by `tests.html`.

### How the listening works

The mic is not push-to-talk. Each game opens on a mic-check screen with a live
level meter, then the mic stays on for the whole game, only pausing while the
computer is actually speaking words out loud (the coach's praise, "The word
was...", or "Hear it") — never for the short feedback beeps, so it doesn't
have to reconnect between words. Silence never counts as a wrong answer.

The Web Speech API has no gain or sensitivity setting, so the **Listening**
button on the start screen controls how forgiving the *matching* is instead.
Matching compares **sounds**, not letters — a small rule-based phonetic
encoder in `blend-game.js` (`phonemes()`) — so "krab" now passes for "crab"
even though the recogniser rarely spells it that way, while "bled" still
never passes for "bred":

| Level | Accepts |
| --- | --- |
| Spicy | the exact word only |
| Regular (default) | the rest of the word off by one sound |

"Off by one/two sounds" is now literally true: it's phoneme-level edit
distance, with a swapped vowel sound costing half as much as any other
change (recognisers mangle vowels far more than consonants). At every level
the blend must be exactly right in phoneme space — "bred" never passes for
"bled" — since that is the skill being practised. A small curated table in
`blend-game.js` (`ACCEPT`) also covers a couple of known recogniser
mishearings (e.g. "gasp" heard as "gas"); add more there as you notice them
in class. The Listening setting is remembered per device in `localStorage`,
same as Shuffle.

Run `tests.html` (served the same way as the games) to check the matcher
itself — it renders a pass/fail table with a summary line.

If a student's correct answers keep getting marked wrong, check the meter on
the mic-check screen first: a quiet input is an OS-level microphone setting
(ChromeOS → Settings → Device → Audio → Input), not something the page can fix.

### Scoring

Each correct word is worth 10 points times a **combo multiplier** driven by
the streak: ×1 to start, ×2 from a streak of 5, ×3 from 10 up (capped
there). Every 5th in a row is a milestone — +25 bonus, a "🔥 N in a row!"
banner, confetti over the word, a fanfare, and the runner's boost animation.
A wrong answer or a Skip resets the streak and the multiplier; a "×2 combo!"
badge under the Streak stat shows the current tier. The end screen adds a
**0–3 star rating** (3 at 90 %+, 2 at 70 %+, 1 at 50 %+) and calls out a
"Perfect round!" when every word was said right. The scoring math is a pure
function (`pointsFor()` in `blend-game.js`) covered by `tests.html`.

### Correct/wrong feedback

Right and wrong answers are shown visually — a green "✓ +10" or red "✗"
pop-up over the word, plus a matching glow on the card and colored status
text — so nothing depends on the student hearing anything.

The **Voice** button (default **Off**, remembered per device like the other
settings) turns on a short spoken coach on top of that: quick praise on a
correct answer ("Nice!", "Got it!"…, with a bigger call-out every 5-streak),
and the word spoken aloud after the second miss. Press **H** any time during
play to hear the current word read at a slower pace — same as clicking "Hear
it" — regardless of the Voice setting. All speech picks the best available
`en-US` voice (`pickVoice()` in `blend-game.js`), preferring Chrome/ChromeOS's
natural voice over the flat default, and re-picks once Chrome finishes
loading its voice list.

### Directions

The start screen's intro line and numbered steps are written short and plain
— this is a phonics class, not a reading test, so the *how to play* copy
shouldn't be a decoding challenge in itself. A **🔊 Hear directions** button
next to them reads that same text aloud (`textContent` off the live DOM, so
it can't drift from what's on screen) in the same best-available voice as
the words themselves — `pickVoice()`'s top pick is Chrome's network-backed
"Google US English" voice where it's available, well above the flat local
default. The button is disabled if `speechSynthesis` isn't available at all.
