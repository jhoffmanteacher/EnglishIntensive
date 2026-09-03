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
freely.

## Home page

`index.html` builds its tile grid from `word-lists.js`, filtered to the
lists the signed-in student is assigned (`EIStore.myLists()`), so two
students in different periods see different games. Each tile carries that
student's progress through that list — words solid, words still shaky.

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

The word has to come back exactly right to be marked correct — there's no
forgiving near-misses, since the student actually saying the word correctly
is the whole point. `blend-game.js` also carries a more forgiving phonetic
matcher (`phonemes()`, `phoneticDistance()`, the `ACCEPT` table of known
recogniser mishearings) that compares **sounds** rather than letters — e.g.
"krab" would pass for "crab" — but the games no longer expose it; it only
runs today through the `_internals` seam that `tests.html` exercises
directly, in case a more forgiving mode is wanted again later.

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

- **Students** — roster with accuracy, words solid, words shaky and last
  activity; click through for a student's hardest words (worst first, with
  which list each came from), their per-list breakdown, and their
  assignment.
- **Periods & Lists** — assign lists to a whole period at once, set the
  class default, and drop students into periods.
- **Trouble spots** — the same words aggregated across the class, sorted
  by *how many students* are struggling with each rather than by raw
  accuracy, so one student's bad day doesn't top the list. Filterable by
  period. This is the "what do I reteach tomorrow" view.

Assignment precedence, resolved in `EIStore.effectiveLists` (and pinned by
`tests.html`): **the student's own list → their period's list → the class
default → everything**. A student with nothing set anywhere sees the whole
site, so day one isn't an empty page. Setting an explicit empty list at
any level is a real answer and stops the walk — that's how you park a
student.

The teacher has **read** on `students/{uid}` and no write. Everything the
teacher sets lives in `assignments/{uid}` instead, so a compromised
teacher session can't erase anyone's work.
