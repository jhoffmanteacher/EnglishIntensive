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

## Shared core

`game-core.js` holds the parts that **must** agree between games, and every
page loads it before its engine:

```html
<script src="game-core.js"></script>
<script src="blend-game.js"></script>
```

There are four engines — blend (say it), spell (type it), card (flip it),
match (find it) — and they deliberately share a look, a scoring system and a
set of habits, so a student moving between them sees one game asking
different questions. That agreement used to be kept by copying code between
engines with "keep this in step" written on top of each copy. At two copies
that was the right trade against a no-build site; by four it wasn't. The
scoring was in four places, the comeback deck in three, the vault-run SVG in
three more, and each copy was a chance for two games to quietly start
behaving differently.

In the core: combo scoring and the star thresholds, the comeback deck (and
the one function that touches `localStorage`), the race/vault progress
graphics, the confetti, the score pop-up, the feedback blips, the voice
ranking, and the word-list helpers (`shuffled`, `dedupeWords`,
`sampleWords`, `escapeHtml`).

Still in each engine: how it asks its question, how it judges the answer,
its own screens and styles, and anything to do with the microphone.
`blend-game.js` keeps its own `say()` because it has to stop a live
recognizer first so the game never transcribes itself, and it passes its
mic-hold in to the core's sounds as a callback rather than pushing
microphone bookkeeping into shared code:

```js
var snd = Core.sounds({ onPlay: function(ms){ holdMic(ms + 180, true); } });
```

Each engine aliases what it takes at the top of its file, so the list of
what's shared is visible in one place and the code below reads unchanged.
`tests.html` asserts that every engine points at the *same function object*
as the core — if a local copy is ever reintroduced, that check fails
immediately.

## Home page

`index.html` shows a grid of game tiles, split into sections by what the
game asks of the student — speaking, typing, or neither — so someone in a
loud room or without a working mic can go straight to what'll work for them.
Add a new game by dropping an entry in the right section's `games` array in
its inline `<script>` — `icon`, `title`, `description`, `url`.

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
`localStorage` (`"blendComeback:" + pathname`, and `"cardComeback:"` /
`"matchComeback:"` for the two sight-word games): a word joins the
deck when it's missed twice or skipped in a round, and **leaves the deck the
moment it's read correctly on the first try** in any later round. When the deck has
words, the start screen grows a "🔁 Comeback words (N)" button that runs just
those words — most-missed first, capped at 15 so it stays a warm-up. The
storage layer treats localStorage as untrusted (versioned, sanitized on
read, silently absent if storage is unavailable), and the pure deck logic
(`comebackMerge` / `comebackMastered` / `comebackDeck`) lives in
`game-core.js` and is covered by `tests.html`. The session-level "Practice missed words" button on the end
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

The word has to come back exactly right to be marked correct — there's no
forgiving near-misses, since the student actually saying the word correctly
is the whole point. `blend-game.js` also carries a more forgiving phonetic
matcher (`phonemes()`, `phoneticDistance()`, the `ACCEPT` table of known
recogniser mishearings) that compares **sounds** rather than letters — e.g.
"krab" would pass for "crab" — but the games no longer expose it; it only
runs today through the `_internals` seam that `tests.html` exercises
directly, in case a more forgiving mode is wanted again later.

Run `tests.html` (served the same way as the games) to check the matcher
itself, along with everything shared in `game-core.js` (scoring, stars, the
comeback deck, the progress graphics, the sound contract the mic games rely
on), the syllable parser, the spelling checker, the flash-card deck builders
and the matching game's distractor picker — it renders a pass/fail table
with a summary line.

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

## Flash-card game

`card-game.js` is the third engine, and the only one that doesn't judge the
answer itself. It drills **sight recognition** of irregular ("red") words —
words the decoding rules lie about, where there's no rule to apply, no blend
to isolate and nothing to sound out. Whether the student knew the word on
sight is a question only the student can answer, so the game asks them:

1. The word shows on a card. The student reads it out loud.
2. They flip it (Space, or click the card). **Only now** is the word spoken —
   hearing it first would hand over the answer and turn the drill into
   repeat-after-me.
3. They rate themselves: **Got it** (`1`) or **Not yet** (`2`).

No mic and no typing, so it works in a loud room and on a Chromebook with a
dead microphone. It's also the only engine that doesn't need
`speechSynthesis` to function — without it the cards still work, minus the
read-aloud check, so the start screen warns instead of disabling Start.

A page passes decks rather than one word list:

```html
<script src="card-game.js"></script>
<script>
CardGame.start({
  title: "Red Words 🃏",
  intro: "…",
  note: "<p>What a red word is…</p>",      // optional micro-lesson, HTML ok
  decks: [{ name: "List 1", words: ["you","should", …] }, …]
});
</script>
```

With more than one deck the start screen grows a picker and the engine adds
two decks of its own: a random **Mixed** 20 drawn from everything (re-drawn
every round, so it's never the same 20 twice) and one **All words** deck.
The last-picked list is remembered per device. A single `words:` array works
too — the picker then never appears. Deck word lists are deduplicated per
round, which matters because printed word lists repeat words across lists on
purpose.

Current games:

- `red-words-game.html` — the ten SUHSD red-word screener lists, 20 words
  each. The lists live in `data/red-words.md` as the source of record; the
  page's word arrays are that file transcribed, so corrections belong in
  both.

Scoring, streaks, stars, the missed-word list and the comeback deck all match
the other two engines exactly, so a student moving between games sees one
scoring system. A skipped card counts as missed, and ending a round early
scores only the cards actually seen.

One thing to know as a teacher: the score is a **self-rating**, so it
measures honesty as much as reading. That's the trade the format makes —
nothing can listen to a student read "Wednesday" and tell you they knew it on
sight rather than worked it out. The start screen asks for honesty directly,
and the payoff is framed as the deck shrinking rather than the score going
up.

## Matching game

`match-game.js` is the checked counterpart to the flash cards: the computer
says a word and the student picks the printed word that matches, out of six.
Same skill, but the game knows whether they were right instead of taking
their word for it. Mic-free, so it still works in a loud room.

```html
<script src="match-game.js"></script>
<script>
MatchGame.start({
  title: "Red Words: Match It 🎯",
  intro: "…",
  note: "<p>…</p>",                      // optional micro-lesson, HTML ok
  choices: 6,                            // tiles per word (default 6)
  decks: [{ name: "List 1", words: [ … ] }, …],
  homophones: [["to","two"], …],         // never shown together
  sentences: { to: "I need to finish my homework." }
});
</script>
```

Decks, the picker, Mixed/All words, the comeback deck and the scoring all
work exactly as they do in `card-game.js` — both reach the same code in
`game-core.js`. Two tries per word: a wrong tile
greys out and stays on screen (so the retry narrows the field instead of
being a coin flip), and a second miss gilds the right one and says it slowly.
Only a first-try pick clears a word from the comeback deck.

### Picking the wrong answers

The whole difficulty of the game is in **which wrong words it shows**. Six
random words off the list is a game you can win without reading — the first
letter is enough. So `nearestWords()` ranks the list by how confusable each
word is with the target (edit distance, then shared opening letters, then
length), and the tiles are drawn from the top of that ranking. For red words
that produces exactly the sets students really mix up: `should` comes with
could/would/said, `through` with though/although/enough, `there` with
where/here/were. Getting it right means reading to the end of the word.

Pushed all the way, though, the same idea breaks the game: the most
confusable word of all is a **homophone**, and no amount of listening
separates "to" from "two". Both guards below matter, and any word list with a
homophone pair in it needs both:

- `homophones` groups words that sound alike. No two members of a group ever
  appear on screen together — enforced as the set is built, so it also stops
  two *distractors* pairing up (`to` and `two` as wrong answers under some
  third word), and it catches "resumé"/"resume", which are the same letters
  once the accent is stripped.
- `sentences` gives a word a spelling-bee read — word, sentence, word — so
  the student hears *which* word it is rather than inferring it from what
  isn't on screen. Every homophone-group member needs one. They also fix
  heteronyms, where the synthesiser has to guess a pronunciation: "does" as
  the female deer, "live" as in live television, "minute" as in tiny.

This is not hypothetical for the red-word lists: `to`/`two` are both on List 1
and `there`/`their` both on List 2, so without the guards the very first list
deals unanswerable items. `tests.html` draws every word of those two lists 40
times over and fails if any tile set holds two words that sound alike.

Distractors normally come from the round's own list, so the wrong answers are
words the student is working on. A round too short to fill its own tiles (a
three-word comeback deck) widens to the whole word list instead.

Current games:

- `red-words-match-game.html` — the same ten screener lists as the flash-card
  game, same source of record in `data/red-words.md`. The two games keep
  **separate** comeback decks, on purpose: knowing a word on sight and
  picking it out of five look-alikes are different days' work.
