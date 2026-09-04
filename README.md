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

## Accounts

Every page is behind a Google sign-in wall (`auth.js`), restricted to
**@seq.org** accounts. Sign-in is what makes per-student tracking and
per-student list assignment possible, so there is no guest mode.

Set the project up once with **`SETUP-FIREBASE.md`** — until
`firebase-config.js` has real values in it, every page shows a
"sign-in isn't set up yet" panel instead of the games.

The @seq.org restriction, the teacher-account check and the wall itself
are all client-side and all bypassable from DevTools. `firestore.rules`
is the half that actually enforces any of it — see the header of that
file, and re-publish it in the Firebase console whenever it changes.
Nothing else deploys it.

## Word lists

`word-lists.js` is the single source of truth for what a practice list
**is**. Three things have to agree about them (the game page that plays
one, the home page that advertises it, the dashboard that assigns it), so
they are defined once.

### Families and modes

Every list belongs to a **family**, and every family declares the
**modes** it can be played in. A mode is an engine plus the habits that
come with it:

| | mode | engine | what it asks |
|---|---|---|---|
| 🎤 | `say` | `blend-game.js` | read it out loud, the computer listens |
| ⌨️ | `spell` | `spell-game.js` | the computer says it, you type it |
| 🃏 | `cards` | `card-game.js` | read it, flip it, rate yourself |
| 🎯 | `match` | `match-game.js` | hear it, find it among look-alikes |

The red words worked this way first: the same "List 3" as flash cards
*or* as Match It, because knowing *would* on sight and picking it out of
six look-alikes are different skills and a student can have one without
the other. That is true of every list here, not only the red ones —
reading *moist* cold, spelling it, and finding it in a row of look-alikes
are three separate things to be good at. So the registry generates **one
entry per (family, list, mode)**, each with its own id and therefore its
own stats.

The six families:

| family | lists | modes |
|---|---|---|
| Starting Blends | 1 | 🎤 🃏 🎯 |
| Blend Words | 1 | 🎤 🃏 🎯 |
| Nonsense Words | 1 | 🎤 🃏 |
| oi / oy | 1 | 🎤 ⌨️ 🃏 🎯 |
| Multisyllable | 1 | 🎤 🃏 🎯 |
| Red Words | 10 | 🃏 🎯 |

Two families are deliberately short of the full set. **Nonsense words**
have no Match It: that game works by *saying* a word and asking the
student to find it, and a synthesiser handed "vab" doesn't say "vab", it
guesses — often enough as "verb" that the answer key would be wrong. A
list with no meanings can only be read, not heard. Their cards mode runs
with `speak: false` for the same reason, so the flip shows the word
without pronouncing it. And the **red words** have no say-it mode: they
are irregular by definition, so there is nothing for a phoneme matcher to
check them against.

### Ids are permanent

An id is half of every Firestore stat key (`"<id>|<word>"`) and it is
what an assignment stores, so renaming one orphans a class's history.
Generated ids are `<family>-<n>-<mode>` — `red-3-cards`,
`multi-1-match`. A family's `ids` map overrides that per mode, and every
id that predates families is pinned there, unchanged:

```js
lists: [{ n:1, ids:{ say:"oi-oy-read", spell:"oi-oy-spell" }, words: OI_OY_WORDS }]
```

`final-blends`, `initial-blends`, `nonsense`, `oi-oy-read`,
`oi-oy-spell` and `multisyllable` all still resolve to exactly the engine
and page they always did; `tests.html` pins each one by hand, because
that is the single check standing between a refactor and a year of
practice detached from the list it belongs to. `title` is the display
name and can change freely.

### Adding to the library

- **another red list** — one array in `RED_LISTS`. Nothing else.
- **another mode on an existing list** — one key in that family's
  `modes`.
- **a whole new family** — one entry in `LIST_FAMILIES`. Its `cards` and
  `match` modes need no new page: they share `cards-game.html` and
  `match-game.html`, which take the list from `?list=`. A `say` or
  `spell` mode does need its own page, named in `pages`, because its copy
  is list-specific (the oi/oy rule box, the mic setup).

`config` is what every mode of the family passes to its engine;
`modeConfig[mode]` is what only that mode passes, and it wins on a clash.
The home page and the dashboard pick all of it up with no further edits.

Helpers on `WordLists`: `families()`, `familyOf()`, `modesOf(family)`,
`listNumsOf(family)`, `idFor(family, n, mode)`, `idsOfList(family, n)`,
`idsOfFamily(family)`, `hrefOf(id)`, and the pure `describeAssignment(ids)`
/ `describeFamily(family, ids)` that turn a set of ids into the one line
the roster, the picker and the board all show: *"Starting Blends: 🎤🃏 ·
Red Words: 1–3 🃏 · 1 🎯"*. A family with one list has nothing useful to
say about *which* list, so it prints only the modes; a family with ten
prints the list numbers per mode, as ranges, so ten ticked boxes read as
"1–10" rather than as ten numbers.

### Syllable dots

The multisyllable list writes its words with middle dots marking the
syllable breaks — `fan·tas·tic`. The dots are a display aid and nothing
else: `GameCore.parseEntry` splits an entry into the plain word and its
chunks, and the plain word is the only form that reaches phoneme
matching, TTS, the comeback deck or a stat key. This used to live in
`blend-game.js`, which was the only engine playing that list; now that
every list can be played as cards or Match It it belongs in the core,
where the things three engines must agree about live. The cards engine
shows the chunked form on the **back** of the card — after the student
has read it cold off the front — and Match It strips the dots entirely,
since a tile with a dot down the middle would both give the split away
and mark that tile out from its distractors.

### Pages

`cards-game.html` and `match-game.html` each serve every family, and take
the list from the query string: `cards-game.html?list=red-3-cards`. They
call `EIPractice.play()` with no id. The say-it and spell-it pages name
their one list outright, and `hrefOf` gives them a clean address with no
`?list=` at all, because a page that serves one list already knows which.

`red-words-game.html` and `red-words-match-game.html` are now six-line
redirects that carry the `?list=` across to the generic pages. They stay
because students bookmark game pages and copy them off the board, and a
dead link mid-class costs more than the file does.

## Home page

`index.html` builds its tile grid from `word-lists.js`, filtered to the
lists the signed-in student is assigned (`EIStore.myLists()`), so two
students in different periods see different games.

The registry's (list × mode) entries fold back into **one tile per
list** — "Red Words · List 3", or just "Blend Words" for a family with a
single list — with a Play row per mode that student has, each carrying
its own progress. A student assigned both modes of three red lists sees
three tiles, not six. Every row links to its page with the list named:
`cards-game.html?list=red-3-cards`.

The two shelves are **🔤 Sounding It Out** and **🃏 Red Words**. They used
to be one shelf per modality — speaking games, typing games — which
stopped meaning anything the day every list could be played four ways.
What actually divides this library is the reading: words you can build
out of their sounds, and words that refuse to be built and have to be
known. Each mode's row carries a small `mic` or `headphones` tag, so a
student on a Chromebook with neither finds that out before they open the
game.

A shared page with no `?list=`, or a stale one, isn't an error: it shows
a chooser of every list that has that mode, the student's own first and
the rest under "More", so a bookmarked or hand-typed address still lands
somewhere useful. A list id belonging to a different page redirects there.

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
ranking, the syllable-chunk parser (`parseEntry`, `chunkMarkup` — three
engines now play the dotted multisyllable list and all three need the same
answer to "what word is this really?"), the start screen's read-aloud
(`directionParts`, below), and the word-list helpers (`shuffled`,
`dedupeWords`, `sampleWords`, `escapeHtml`).

### Directions, and reading them aloud

The intro line and numbered steps on every start screen are written short
and plain. This is a phonics class, not a reading test: the *how to play*
copy should not itself be a decoding challenge. Each intro is one or two
short sentences separated by a `<br>`, and that break is load-bearing —
see below.

Every game has a **🔊 Read directions aloud** button, which speaks that
same text in the same best-picked voice as the words themselves
(`Core.voice()` prefers Chrome's network-backed "Google US English" over
the flatter local default). It reads off the live DOM rather than a second
copy of the strings, so the spoken directions cannot drift from the
visible ones, and it's disabled outright where `speechSynthesis` is
missing.

`Core.directionParts(startScreen)` does the walk and returns the fragments
to speak, in screen order: the intro, then the rule box or "good to know"
note if there is one, then the numbered steps. Boxed sections lead with
their own on-screen `.tag` — "The rule", "Good to know" — so a listening
student gets the same heading a sighted one reads before the paragraph
under it.

It lives in the core because all four engines had grown their own copy of
this walk, and all four copies had the same two bugs. The first: reading
the intro with `.textContent`, which drops the `<br>` silently, welding
two sentences into a run-on with no pause exactly where the pause was
written. The second: joining the fragments with `". "` — every fragment
already ends in its own full stop, so the glue doubled it, and the lot
went to the synthesiser as **one** utterance. Each engine now speaks the
fragments as separate queued utterances, which gives a truer pause than
any punctuation would; the speaking itself stays per-engine, because the
blend game has to stand its microphone down first and the quiet three
don't.

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

## Blend games

`blend-game.js` + `blend-game.css` are a shared engine for the "say the word
out loud" phonics games. A game page is now one line —

```html
<script>EIPractice.play("initial-blends");</script>
```

— and the list it names lives in `word-lists.js`, where the family's
`modeConfig.say` is exactly what `BlendGame.start()` takes minus the
words:

```js
{
  key:"blends-start", title:"Starting Blends", modes:["say","cards","match"],
  pages: { say: "initial-blends-game.html" },
  modeConfig: {
    say: {
      blend: "start",   // "start", "end", or "sound" — see below
      theme: "maze"     // "race" (default) or "maze" — the progress graphic
    }
  },
  lists: [{ n:1, ids:{ say:"initial-blends" }, words:["blip","crop","clam"] }]
}
```

`title` and `intro` are generated from the family and the mode unless the
family sets them, so the same words played three ways get three headings
that read as one game asking different questions.

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

> Still here, still per-device, and now the *inner* of two loops: the
> comeback deck is a within-page warm-up in `localStorage`, while the
> adaptive scheduler below is the cross-session, cross-device one in
> Firestore. They don't conflict — one picks a warm-up out of the last few
> rounds on this machine, the other picks the round itself.

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

> On this site the flash cards run through `practice.js` like every other
> game — one list per round, drawn by the adaptive scheduler, results
> reported to the student's record. The `decks` picker described below is
> the engine's own start screen, used when a page calls `CardGame.start()`
> directly; `cards-game.html` doesn't, it plays whichever list `?list=`
> names.

`card-game.js` is the third engine, and the only one that doesn't judge the
answer itself. It drills **sight recognition** — knowing a word without
working for it. That began as a red-word game, for the words the decoding
rules lie about, where there's no rule to apply, no blend to isolate and
nothing to sound out; every list can be played this way now, because
reading a word you *can* decode without stopping to decode it is the
skill that makes reading fluent. Whether the student knew the word on
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

`cards-game.html` serves every family's cards mode, taking the list from
`?list=`. Two config keys are worth knowing:

- `speak: false` — the flip shows the word without pronouncing it. The
  nonsense-word list needs this: a synthesiser handed "vab" guesses, and
  it guesses wrong often enough to teach the wrong answer. Directions are
  still read aloud; only the word itself goes quiet, and the "Hear it
  again" button goes with it.
- Syllable-dotted entries (`fan·tas·tic`) show plain on the front — the
  student has to read it cold — and chunked on the back, which is where
  the split earns its keep. The plain word is what gets spoken, rated and
  stored.

The ten red-word lists live in `data/red-words.md` as the source of
record; the arrays in `word-lists.js` are that file transcribed, so
corrections belong in both.

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

> Same arrangement as the flash cards: `match-game.html` plays the one
> list `?list=` names, through `practice.js`, and reports first-try picks
> to the student's record. Its comeback deck is separate from the cards'
> on purpose — they're different skills.

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

`match-game.html` serves every family's Match It mode except the nonsense
words, which have none — the game works by *saying* the word, and there is
no reliable way to say a word that isn't one. Syllable dots are stripped
on the way in: a tile with a dot down its middle would both give the
split away and mark that tile out from its distractors.

Cards and Match It on the same list keep **separate** ids, stats and
comeback decks, on purpose: knowing a word on sight and picking it out of
five look-alikes are different days' work.

## Adaptive practice

A round is no longer the whole word list. `EIPractice.play()` draws
**18 words** out of the list, weighted by how that student is actually
doing — the scheduling rules are in `adaptive.js`, which is pure (no DOM,
no storage, no clock or randomness of its own) and covered end to end by
`tests.html`.

Two independent pulls decide how often a word comes up:

- **How badly it's going.** Accuracy 0 % → weight 6.0, 50 % → 3.5,
  100 % → 1.0. A word missed most of the time is about six times as likely
  to be drawn as one that's solid. Accuracy is Laplace-smoothed
  (`(r+1)/(n+2)`) so a single lucky guess isn't mastery and a single slip
  isn't a crisis.
- **Whether it's had its rest.** Each word sits in a Leitner box 0–5,
  earning breaks of 0/1/2/4/8/16 days. Inside its break a word is damped
  rather than banned, so short sessions don't loop the same handful and a
  long gap doesn't dump everything at once.

Only **first-try** answers count as right. Getting a word after being told
it isn't knowing it — the same rule the comeback deck already used. A miss
drops a word one box rather than resetting it to zero: resetting is the
textbook Leitner move and it turns one fumble into a week of seeing that
word every session.

Never-practiced words sit at a flat weight of 3.0, between "solid" and
"shaky", so new material keeps flowing without crowding out what's
failing. "Play again" redraws — the words missed a minute ago are now the
likeliest picks.

Stats are stored per **list and word** (`"<listId>|<word>"`), not per
word: "coin" in the reading game and "coin" in the spelling game are
different skills, and a student can be fluent at one while failing the
other.

## Per-student tracking

`store.js` keeps one document per student at `students/{uid}` — the
per-word stats, lifetime totals, and a short tail of finished rounds. Two
rules in that file are worth knowing before touching it:

- **A failed read is not an empty record.** If the load fails (blocked
  network, offline Chromebook) every local map is empty, which is
  indistinguishable from a brand-new student. Writing then would overwrite
  a term of practice with nothing, so a failed load latches and holds back
  every write until a reload succeeds.
- **Writes are debounced and must be flushed before sign-out.** The round
  that ends with a student clicking "Sign out" is exactly the round most
  likely to be lost.

There's also a per-device mirror in `localStorage`, scoped by uid so a
shared Chromebook can't leak one student's deck into the next student's
session. It keeps word selection sensible if the network drops mid-round;
it is never merged back up.

## Teacher dashboard

`teacher.html` — visible to `TEACHER_EMAILS` only, with a link on the home
page for that account. Four tabs:

- **Students** — roster with accuracy, words solid, words shaky, last
  activity, and a **Lists** column that says in words what each student
  currently gets and where it comes from — *"Red Words: 1–3 🃏 (period
  3)"*. Click through for a student's hardest words (worst first, with
  which list each came from), their per-list breakdown, their assignment
  picker and their **note**. Two CSV exports live here too.
- **Assign** — every assignment in the class as one grid. This is the
  section below.
- **Periods & Lists** — the same picker for the class default and for
  each period, plus the table that drops students into periods.
- **Trouble spots** — the same words aggregated across the class, sorted
  by *how many students* are struggling with each rather than by raw
  accuracy, so one student's bad day doesn't top the list. Filterable by
  period. This is the "what do I reteach tomorrow" view.

### The picker: one scope at a time

Every place a set of lists is chosen one scope at a time — a student's
own, a period's, the class default, the board's bulk dialog — uses one
component, `pickerHtml()` in `teacher.js`. It is one section per family,
because that is the only kind of entry the registry has:

- **a family with one list** — a line of mode checkboxes, with *all* /
  *none*: "Blend Words: 🎤 Say it · 🃏 Cards · 🎯 Match It", each labelled
  with its word count and whether it needs a mic or headphones.
- **a family with several** — a grid: one row per list (with four of its
  words as a reminder — *you, should, could, said…*), one column per
  mode, an **all** toggle on each row and each column. "Lists 1–4 as
  flash cards" is four clicks; "everything as Match It" is one.

A live line under the picker — *"This gives them: Starting Blends: 🎤🃏 ·
Red Words: 1–3 🃏 · 1 🎯"* — says in words what the ticks add up to, and
it is the same line the roster shows, so what a student *has* and what
you're *setting* read the same way.

### The Assign board: the whole class at once

The picker answers "what should *this* student get?", which is the right
shape for a conversation about one student and the wrong shape for the
ten minutes at the start of a unit when you are moving a class onto List
4. The **Assign** tab is that: students down the side, lists across the
top, every assignment in the class visible and editable in place.

Rows are grouped by period, with a period row above each group and the
class default above everything — the same chain the precedence walks, in
the order it walks it. Columns are one per list, grouped under a family
header that can be folded (▾/▸) into a single summary column, which is
how ten red-word columns get out of the way when you're working on
blends. Both the first column and the two header rows are sticky, so a
name and a list stay on screen however far you scroll.

Three things make it work rather than just look busy:

- **Inheritance is visible.** A dashed grey cell is inherited — the
  student is following their period, the period is following the class
  default, or the class default itself has never been set and everyone is
  getting every list. A gold cell is a set of that scope's own. Who has
  been pulled out of their group is the question a differentiated roster
  actually raises, and it is now answerable at a glance.
- **Editing is copy-on-write, and says so.** Change any cell on someone
  who is inheriting and they get their own copy of what they already
  had — exactly what saving the picker on their page has always done —
  and the row grows an **own ↺** button that hands them back.
- **Nothing is written until Save.** Every edit lands in a draft, the bar
  at the bottom counts what's pending, and Save commits the lot in one
  `db.batch()`: one `assignments/{uid}` merge per changed student, and at
  most one `config/class` merge however many periods and the default were
  touched. A teacher reassigning six students should not be able to end
  up with three of them moved. Discard throws the draft away; leaving the
  tab with changes pending asks first.

A cell click opens the modes for that one list, ticked live. A column's
**all** toggle sets every mode of that list for every *visible* student —
the period filter and the name search are what bound it, and that is the
only thing standing between a mis-click and a class's worth of undone
assignment. Ticking several students turns on **Set lists for N
selected…**, which opens the same picker once, seeded from the first
selected student's effective set, and applies it to all of them.

The board's rules — the precedence walk, copy-on-write, how far a column
toggle reaches, and the shape of the two documents Save writes — are pure
functions of a class's state and are pinned in `tests.html`, along with a
check that the grid itself renders the rows and cells it claims to.

### Ready to move up

A student who has finished Red List 3 should be on List 4, and the only
thing between those two facts is somebody noticing. For a class moving
together that's fine; for the three students who are ahead it is exactly
the kind of thing that doesn't get done, and they spend a fortnight
re-practising words they already know.

So the board works it out. Above the grid, when there is anything to say:
*"Marcos · Red Words 🃏 · finished List 2 (18 of 20 solid) → add List 3"*,
with a button that drops it into the same draft as every other edit and
waits for the same Save.

It does not act on its own, on two counts. Auto-advancing would move a
student on the strength of a scoring heuristic with nobody who has met
them in the loop — and "solid" here means solid on a screen, which is not
always solid on paper. And the arithmetic runs on the **teacher's** page,
which is where the decision belongs; `firestore.rules` is what actually
holds that line (a student can read `assignments/{uid}` and never write
it), but there is no reason to ship the policy to their browser either.

The bar is **four words in five solid** (`SOLID_ENOUGH`), not all of them:
one stubborn word — a name, a word whose synthesised reading is poor —
should not hold a student on a list for a term. Each mode advances on its
own, because a student can be solid on List 3 as flash cards and still be
finding it in Match It. And the suggestion is **additive**: it doesn't
take the finished list away, since each list is its own tile with its own
adaptive deck, so keeping List 3 alongside List 4 costs nothing and keeps
those words in rotation. Dropping one stays a judgement call.

### Notes

A short note per student, on their detail page, for the things the
numbers can't say — *"reads well, freezes when timed"*, *"sounds it out
under his breath and gets there"*. The first line shows under their name
on the roster and as a ✎ on the board, because a note you have to open a
student to discover is a note nobody reads.

It lives in its own `notes/{uid}` collection, and that is the whole design
decision. A student can read their own `assignments/{uid}` row, so a note
stored there would be a note its subject can read — and a teacher writing
for that audience will either write nothing useful or keep the real notes
somewhere else. `notes/{uid}` is **teacher read and teacher write, with no
student clause at all**. It is the one path on the site a student may not
read about themselves.

### Export

Two CSVs from the Students tab, built from what the dashboard already has
in memory — no new reads, no backend:

- **Roster** — a row per student: period, the same list sentence the
  screen shows, where it came from, accuracy, words solid and shaky, last
  active, and their note.
- **Every word** — a row per (student, list, word) they have attempted:
  attempts, correct, accuracy, whether it's solid, when it was last
  practised. The long file, and the only export that can answer a
  question nobody thought to build a screen for.

The builders are pure functions and the escaping is tested, which matters
more than it looks: a student called O'Brien, a note with a comma, a list
title with a quotation mark — a naive join breaks on any of them, and it
breaks silently, in a file somebody has already emailed to a meeting.
Cells beginning `=`, `+`, `-` or `@` are prefixed with an apostrophe so a
spreadsheet doesn't read a name as a formula, and the file carries a BOM
so Excel doesn't mangle accented names.

### Keyboard and screen readers

Board cells are focusable: **arrows** move between them, **Home**/**End**
jump to the ends of a row, **Enter** or **Space** opens a cell's modes and
**Esc** closes it. Fifteen columns is further than anyone wants to press
Tab.

Every cell also carries its answer in words — *"Ana, Red Words List 2:
Cards, Match It (inherited)"* — because two emoji and an em dash are not
something to hand a screen reader.

### What actually gets stored

Unchanged, and this is the point: a flat array of list ids in
`assignments/{uid}` (a student's own set) or `config/class` (a period's,
or the default). The families, the modes, the grid and the board are all
presentation — `store.js`, the precedence and `firestore.rules` never see
any of it, so **turning every list into a family needed no rules change
and no migration**. `null` rather than a missing field is how "inherit"
is stored, which is what the **own ↺** button writes.

Two things worth knowing: a student can still open a list they haven't
been assigned (the chooser lists them under "More", and the game shows an
"extra practice" note rather than a lock — a hard block would turn every
mis-assignment into a support request mid-class). And the picker's
pre-ticked state is the student's *effective* set, so opening a student
who follows their period and pressing Save copies the period's set onto
them as their own — use "Use my period's lists", or the board's **own
↺**, to hand them back.

Assignment precedence, resolved in `EIStore.effectiveLists` (and pinned by
`tests.html`): **the student's own list → their period's list → the class
default → everything**. A student with nothing set anywhere sees the whole
site, so day one isn't an empty page. Setting an explicit empty list at
any level is a real answer and stops the walk — that's how you park a
student.

Every level therefore has two distinct "off" states, and the board draws
the difference: **nothing set** (dashed, falls through to the level below)
and **set to nothing** (gold, empty, stops the walk). The class default is
included in that — an unset default reads *"nothing set — everyone gets
every list"* rather than pretending to be a configured one, and its
**own ↺** clears it back to that rather than parking the school.

The teacher has **read** on `students/{uid}` and no write. Everything the
teacher sets lives in `assignments/{uid}` instead, so a compromised
teacher session can't erase anyone's work.
