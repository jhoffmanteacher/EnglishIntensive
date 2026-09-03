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
**is** — its id, title, engine, tile copy and words. Three things need to
agree about a list (the game page that plays it, the home page that
advertises it, the dashboard that assigns it), so it is defined once.

Adding a game is two steps:

1. Add an entry to `WORD_LISTS` in `word-lists.js`.
2. Copy any existing game page and change the id in its one line of
   script; point the entry's `page` at the new filename.

The home page and the dashboard pick it up with no further edits. A
list's `id` is permanent — it is half of every stored stat key
(`"<listId>|<word>"`) and it is what an assignment stores, so renaming
one orphans a class's history. `title` is the display name and can change
freely. `engine` is one of `blend`, `spell`, `card` or `match`.

### List families: the red words

Most lists are one entry, one tile, one game. The **red words** aren't:
the same "List 3" can be played as flash cards *or* as Match It, and those
are different skills — a student can know *would* on sight and still pick
*could* out of six look-alikes. So the ten screener lists (`RED_LISTS`,
kept once; `data/red-words.md` is the source of record) generate **twenty
entries**, `red-N-cards` and `red-N-match`, with separate stat keys — the
same reasoning that already keeps `oi-oy-read` and `oi-oy-spell` apart.

Twenty tiles and twenty checkboxes would be the wrong way to show that, so
each entry carries `family: "red"`, `listNum` and `game`, and the UI folds
them back into one grid (`LIST_FAMILIES` declares the family's games and
their order). Helpers on `WordLists`: `families()`, `listNumsOf()`,
`idFor(family, n, game)`, `standalone()` (the plain games), `hrefOf(id)`
— a family entry links to its shared page with `?list=<id>` — and a pure
`describeAssignment(ids)` that turns a set of ids into the one line the
roster and the picker show: *"2 games · Red Words: lists 1–3 (cards) ·
1 (match it)"*.

A red list is 20 words and a round is 18, so one round is nearly the
whole list, weighted — over two or three rounds every word comes up, the
missed ones most. Adding an eleventh list is one array in `RED_LISTS`;
no page, no dashboard change.

## Home page

`index.html` builds its tile grid from `word-lists.js`, filtered to the
lists the signed-in student is assigned (`EIStore.myLists()`), so two
students in different periods see different games. Each tile carries that
student's progress through that list — words solid, words still shaky.

Family entries fold into **one tile per list** — "Red Words · List 3" —
with a Play row per assigned game and that game's own progress, so a
student assigned both games for three lists sees three tiles, not six.
Each row links to the family's shared page with `?list=<id>`:
`red-words-game.html?list=red-3-cards`.

Those two pages call `EIPractice.play()` with **no id** and take the list
from the query string. No `?list=`, or a stale one, isn't an error: the
page shows a chooser with the student's assigned lists first and the rest
under "More", so a bookmarked or hand-typed address still lands somewhere
useful. A list id that belongs to the other red-word page redirects there.

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

## Blend games

`blend-game.js` + `blend-game.css` are a shared engine for the "say the word
out loud" phonics games. A game page is now one line —

```html
<script>EIPractice.play("initial-blends");</script>
```

— and the list it names lives in `word-lists.js`, whose `config` block is
exactly what `BlendGame.start()` takes minus the words:

```js
config: {
  title: "Starting Blends 🎤",
  blend: "start",   // "start", "end", or "sound" — see below
  theme: "maze"     // "race" (default) or "maze" — the progress graphic
},
words: ["blip","crop","clam"]
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
> directly; `red-words-game.html` doesn't, it plays whichever list
> `?list=` names.

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

> Same arrangement as the flash cards: `red-words-match-game.html` plays
> the one list `?list=` names, through `practice.js`, and reports first-try
> picks to the student's record. Its comeback deck is separate from the
> cards' on purpose — they're different skills.

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
page for that account. Three tabs:

- **Students** — roster with accuracy, words solid, words shaky, last
  activity, and a **Lists** column that says in words what each student
  currently gets and where it comes from — *"2 games · Red Words: lists
  1–3 (cards) (period 3)"*. Click through for a student's hardest words
  (worst first, with which list each came from), their per-list
  breakdown, and their assignment picker.
- **Periods & Lists** — the same picker for the class default and for
  each period, plus the table that drops students into periods.
- **Trouble spots** — the same words aggregated across the class, sorted
  by *how many students* are struggling with each rather than by raw
  accuracy, so one student's bad day doesn't top the list. Filterable by
  period. This is the "what do I reteach tomorrow" view.

### Assigning games and lists

Every place a set of lists is chosen — a student's own, a period's, the
class default — uses one picker (`pickerHtml()` in `teacher.js`). It has
two parts because the registry has two kinds of entry:

- **Games** — the standalone lists, one checkbox each, with *all* / *none*.
- **Red Words** — a grid: one row per list (with four of its words as a
  reminder — *you, should, could, said…*), one column per game
  (🃏 Cards, 🎯 Match It), a **both** toggle on each row and an **all**
  toggle on each column. "Lists 1–4 as flash cards" is four clicks;
  "everything as Match It" is one.

A live line under the picker — *"This gives them: 2 games · Red Words:
lists 1–3 (cards) · 1 (match it)"* — says in words what the ticks add up
to, and it is the same line the roster shows, so what a student *has* and
what you're *setting* read the same way.

What gets saved is unchanged: a flat array of list ids in
`assignments/{uid}` (a student's own set) or `config/class` (a period's
or the default). The grid is presentation only — `store.js`, the
precedence and `firestore.rules` never see it, so **adding red words
needed no rules change**.

Two things worth knowing: a student can still open a list they haven't
been assigned (the chooser lists them under "More", and the game shows an
"extra practice" note rather than a lock — a hard block would turn every
mis-assignment into a support request mid-class). And the picker's
pre-ticked state is the student's *effective* set, so opening a student
who follows their period and pressing Save copies the period's set onto
them as their own — use "Use my period's lists" to hand them back.

Assignment precedence, resolved in `EIStore.effectiveLists` (and pinned by
`tests.html`): **the student's own list → their period's list → the class
default → everything**. A student with nothing set anywhere sees the whole
site, so day one isn't an empty page. Setting an explicit empty list at
any level is a real answer and stops the walk — that's how you park a
student.

The teacher has **read** on `students/{uid}` and no write. Everything the
teacher sets lives in `assignments/{uid}` instead, so a compromised
teacher session can't erase anyone's work.
