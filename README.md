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

### Heart letters

A red word is irregular, but it is rarely irregular all the way through.
"said" is s + d with one impossible middle; "could" is c + d with one. The
lists mark that middle with braces — `"s{ai}d"`, `"c{oul}d"` — and the
flash cards show it in red on the **back** of the card, under "In red: the
part to remember by heart". The front stays plain: the card has to be read
cold first.

The point is the size of the thing being memorised. "Learn s-a-i-d" is four
letters with no pattern. "Learn that *said* has an **ai** in the middle" is
one chunk, and the s and the d are just reading.

Marks are display only and stack with the syllable dots (`"al{th}·ough"` is
legal). `GameCore.parseEntry` returns `{ word, chunks, heart }` — the heart
ranges index the **plain** word, apostrophes and periods included — and
`WordLists.plain()` strips braces as well as dots. Everything that stores or
matches a word sees the plain form, so adding the marks changed no stat key;
`tests.html` pins all ten red lists' `wordsOf()` byte for byte against what
they produced before, because those strings have a term of practice behind
them.

Marking is by hand, deliberately. `phonemes()` could flag the vowel team in
every word, including the regular ones — "which part can't be sounded out"
is a teaching judgement, not something the encoder knows. The unmarked words
in those lists are unmarked on purpose: *carrot*, *spirit*, *radio* and
*about* are regular enough to sound out, and *Mrs.*, *Mr.* and *wind* are an
abbreviation and a heteronym, which is a different problem.

On **Not yet**, a word with heart letters is spelled rather than just
re-read: "s. a. i. d. said", as one utterance, because four utterances come
out as four separate thoughts.

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

## Reading view

Four switches on every game's start screen, under **👁 Reading view**:

| | |
|---|---|
| **Font** | Site default · **Lexend** · **Atkinson Hyperlegible** |
| **Letter spacing** | Normal · Wide |
| **Word case** | As written · lowercase |
| **Card colour** | Dark · Cream |

None of these is decoration. A reader who loses their place between b and d,
or who can't hold a word together when the letters sit tight, is describing
the thing that is actually hard. Lexend was drawn against reading-speed
research; Atkinson Hyperlegible was drawn by the Braille Institute for low
vision, and its b/d/p/q and I/l/1 are made to be told apart at a glance.

Both fonts are **self-hosted** (`fonts/`, latin subset, 400 and 700, OFL
licences included). Linking them from Google would mean a school network
that blocks `fonts.gstatic.com` silently falls back to the default face —
for exactly the student the setting exists for.

The settings live in `localStorage` under `eiView`, per device, like Shuffle
and Voice: a shared Chromebook cart means the setting belongs to the seat.
They are applied as classes on `<html>` (`view-lexend`, `view-wide`,
`view-lower`, `view-cream`), so a setting reaches every page and every
engine without any of them knowing about it. `game-core.js` owns the object,
the panel and the sanitizer — an unrecognised stored value is the default,
not an error.

`view-boot.js` runs in each page's `<head>`, before any stylesheet, and does
one thing: copy a cached class string out of `localStorage` onto `<html>`.
Without it a student with Lexend on watches every page render in the default
face and then jump. It reads only the derived cache and scrubs it to
`[a-z- ]` before it touches `className`, because localStorage is
hand-editable; the cache is disposable, and `game-core.js` re-derives it from
the real object as soon as it loads.

**lowercase** is the one switch that isn't blanket. Lowercasing "Mrs." makes
a different word and lowercasing "Wednesday" makes a spelling error, so the
engines mark any word carrying a capital and CSS leaves those alone. The
four such words in the whole library — *Mr.*, *Mrs.*, *Tuesday*,
*Wednesday* — are pinned by a test, so a new one can't slip in unnoticed.

**Cream** reaches the card faces and the word and nothing else. A student who
wants paper-coloured words is not asking for a beige teacher dashboard.

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

### Say It for the red words

The red words got a say-it mode late, after the reason they didn't have one
turned out to be wrong. "A phoneme matcher has nothing to check an irregular
word against" is true and beside the point: Say It takes an **exact
transcript** first and only falls back to phonemes, and a red word is an
ordinary dictionary word that Chrome returns reliably. What actually blocked
it was two things, both now fixed where they belong.

**Homophones.** No amount of listening separates *to* from *two*, and a
student who read the card correctly must not be marked wrong because the
recogniser guessed the other spelling. A list may carry `homophones` groups
(the red words pass the same `RED_HOMOPHONES` Match It already used), and
any member of the target's group is accepted — checked *before* the level
rules, including at Challenge, because a homophone is not a near miss the
game is being generous about. The phonics lists deliberately have no groups:
their near-misses are minimal pairs (*sled* / *bled*), and telling those
apart is the exercise.

**Contractions.** "they'd" said out loud *is* "they would", and the
recogniser writes down whichever it likes. `GameCore.normalize` folds the
expansion to the contraction so both are the same string — but only when
the transcript is exactly that phrase. Folding inside a longer transcript
would destroy tokens the matcher needs: "they have" is the expansion of
"they've" and also a student reading the word *have* with a run-up.

The mode runs on a generic `say-game.html?list=red-3-say`, the way
`cards-game.html` already works. The four phonics families keep their own
pages, because each carries a rule box or a mic note that only makes sense
for that list.

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
is the whole point. A more forgiving phonetic matcher lives in
`game-core.js` (`phonemes()`, `phoneticDistance()`, the `ACCEPT` table of
known recogniser mishearings); it compares **sounds** rather than letters,
so "krab" would pass for "crab". The games don't expose it as a level any
more, but it is not dead code: the encoder underneath it is what tells a
student which part of a word went wrong (below), what the phoneme clips in
`audio/ph/` are named after, and what the flash cards use to judge a spoken
answer.

Run `tests.html` (served the same way as the games) to check the matcher
itself, along with everything shared in `game-core.js` (scoring, stars, the
comeback deck, the progress graphics, the sound contract the mic games rely
on), the syllable parser, the spelling checker, the flash-card deck builders
and the matching game's distractor picker — it renders a pass/fail table
with a summary line.

If a student's correct answers keep getting marked wrong, check the meter on
the mic-check screen first: a quiet input is an OS-level microphone setting
(ChromeOS → Settings → Device → Audio → Input), not something the page can fix.

### Which part went wrong

A red ✗ tells a student they were wrong. It doesn't tell them *which part*,
and for a reader who is guessing at blends or sliding off vowels that is the
only part worth knowing. `GameCore.diagnose()` lines up what the mic heard
against the word that was on screen, sound by sound, and names one thing:

| kind | what it means | what the student sees |
|---|---|---|
| `blend` | the blend being practised came back wrong | Look at the blend: **bl** |
| `sound` | the sound the list exists for is missing | The **oi** sound is the key |
| `vowel` | one vowel swapped for another | Check the vowel: **e** |
| `consonant` | one consonant swapped for another | Listen to the **s** sound |
| `missing` | a sound was dropped | You dropped a sound: **st** |
| `extra` | a sound was added | That's one sound too many |
| `other` | right sounds, wrong word | Read it slowly, left to right |

One answer, never a list. A wrong reading usually has one cause, and three
guesses at once is how a hint becomes noise. The rules are tried in the
order a teacher would look — the blend on the page first, then the target
sound, then the vowel, then the rest — so on the Blend Words list "gasp"
read as "gas" points at the blend, and everywhere else it points at the
dropped **p**.

It is built on `phonemeSpans()`, which is `phonemes()` with the letters kept:
each sound carries the slice of the word that spells it, so the reveal can
light up **cr** rather than saying "the second phoneme". Silent letters fold
into the sound before them, so every letter belongs to something.

The first miss doesn't get any of this — just "I heard: *bred*", because the
student is about to try again and a hint they haven't asked for slows the
retry down. The reveal is where it lands: the letters turn gold, the message
appears under the word, and with **Voice** on it is read out as one sentence
after the word ("The word was, crab. Look at the blend, cr."). That costs
700 ms of extra reveal time, spent only when there is a voice saying it.

The end screen's missed-word chips carry the kind of error too, so a round
that went wrong in four different ways looks different from one that went
wrong the same way four times.

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

### Words in context

Once a word is solid on its own, the next thing worth asking is whether it
survives a sentence — which is where a word actually gets read, and where a
student who has memorised a shape rather than a word comes unstuck. On lists
that carry sentences (the red words and oi/oy), **one card in three** shows a
mastered word inside its sentence on the front, the word in full weight and
the rest muted. The back is the word alone: the sentence was the question.

Three gates, all deliberate. The word has to be one the scheduler already
counts as solid, so this reads as a step up rather than the game getting
harder; the counter only advances on cards that *could* have shown a
sentence, so "one in three" means one in three of those; and the speed round
is exempt, because that round is about reading one word fast and a sentence
in it is just a slower card.

The bold lands on the word and nowhere else — a word-boundary match, so
"one" doesn't light up inside "money", and case-insensitive, so a
sentence-initial "The" still matches "the". A test walks every sentence a
card can show and checks the word is actually in it.

### Listen (optional)

Off by default and remembered per device, like Shuffle and Voice. With it
on, the mic keeps whatever the student said while the card was face up; on
the flip the back shows "I heard: *could*" and **pulses** the rating button
it thinks is right. The student still presses one — that self-rating is
still the score, and a suggestion that pre-pressed it would quietly take
the game over. No transcript means no line and no pulse: an empty mic looks
exactly like the game with Listen off.

Turning it on is where Chrome asks for the microphone, so the prompt
happens on the start screen and not in the middle of a card. A blocked mic
snaps the toggle back to Off with the same message Say It gives, and the
cards carry on.

`judgeHeard()` (pure, in `tests.html`) accepts four things, in order of how
sure they are: the word; a homophone of it (the red lists pass their
`RED_HOMOPHONES` groups — no recogniser separates *to* from *two*, and
neither does a listener); a mishearing already recorded for it in `ACCEPT`;
and, **on the nonsense list only**, anything within one sound of it. That
last one is off for real words on purpose: "bread" for "bred" is exactly
the error worth catching, while "vab" has no dictionary entry to come back
as and a letter-perfect match would be a bar no student could clear.

The listening itself is `listen.js` (`EIListen`) — a small wrapper over
`SpeechRecognition` with `start`/`stop`/`hold`/`onTranscript`. It is
deliberately **not** a refactor of Say It's loop. That one is the whole
game: it holds the mic open for a round, mutes around every beep and
utterance, and its hold lengths were tuned by ear against a room of
Chromebooks. The cards want something much smaller, and touching a tuned
thing to serve a second caller is how it stops being tuned. Both exist; the
mic is stopped before the card speaks, so the recogniser can never
transcribe the computer's own read back as the student's answer.

## Fluency games

Every other mode asks whether a student knows a word. These two ask how
fast, which is a different question and the one that goes on being worth
asking long after accuracy has stopped moving. A student can be right
about *would* every single time and still take three seconds to get there,
and a reader who takes three seconds a word cannot read a paragraph — by
the end of the sentence the beginning is gone.

`fluency-game.js` + `fluency-game.html` are one engine in two shapes,
chosen by whether the list carries a `text`:

- **One minute** (`fluency`) — the word list in rows of five, sixty
  seconds, the deck cycling so a fast reader never runs out. Space skips.
  Score: **correct words per minute**. On the starting blends, the final
  blends and the nonsense words.
- **Read it** (`read`) — a passage of connected text; words light up as the
  student passes them, and tapping one reads it aloud. Score: **words
  correct per minute**, plus the delta since last time, which is the reason
  to do it twice.

The clock starts on the **first word actually read**, not on the button: a
student fumbling with headphones for four seconds has not been reading for
four seconds.

### Following a reader

`consume()` (pure, in `tests.html`) walks a transcript's tokens against the
words still to be read. Its `lookahead` is the whole difference between the
two games:

- **0** — the one-minute list. Every token answers the current word, right
  or wrong, and the pointer moves either way, so the run never stalls on a
  word the student has given up on.
- **3** — a passage. A token that doesn't match the current word is tried
  against the next three, so a reader who skips a word carries on from
  where they actually are and the skipped words go red behind them. A token
  matching nothing at all is *ignored*: in connected text the recogniser
  returns plenty that isn't on the page, and scoring that would be scoring
  the microphone.

Interim results drive the pointer, not just finals — a reader at sixty
words a minute is four words past whatever the recogniser is still thinking
about, and waiting would leave the highlight hopelessly behind.

Stars are the usual three tiers against a target rate: **60 CWPM** for real
words, **40** for the nonsense list, with two stars at 70 % of that and one
at 50 %.

### Passages

`passages.js` holds eight — two each for starting blends, final blends,
oi/oy and multisyllable — of 80–120 words. Every single word in every
passage is on that family's list, on another family's list, on Red Lists
1–3, or in a closed set of function words at the top of the file. About two
hundred words in total, and a test walks every passage against it.

The rule is the point: a student who stalls here has stalled on reading
connected text, not on a word nobody taught them. It also bites hard —
there is no *them*, no *him*, no past tense the lists don't carry — which
is why these read the way they do. A draft that fails the test gets edited;
the rule doesn't.

Only a passage's `targets` — the family words it actually uses — are
reported to the scheduler. *the* going past tells nobody anything about
anybody's reading.

### What gets stored

`students/{uid}.fluency[listId]` is a list of `{at, cwpm, errors, n}`,
oldest first, capped at **30** — a term of weekly reads, and a few
kilobytes. It is not a stat: a rate belongs to a run, not to a word, and
nothing in the scheduler reads it. The tail is what makes the dashboard's
sparkline; a single latest number would say nothing about whether anything
is changing.

The student page draws one inline-SVG sparkline per fluency list (no
library, no axes, no labels — the question is "is this going up", and the
latest and best are printed beside it), and the roster CSV gains a
*latest*/*best* pair of columns for each fluency list somebody has actually
read.

## Phoneme clips

A synthesiser will not say an isolated /b/. Asked for one it says **"buh"**
— and a word sounded out as "buh-a-tuh" does not blend into "bat". That is
the single most common thing a struggling reader has been taught wrong, and
the student who does it has been doing it faithfully for years.

So the sounds come from files. `audio/ph/<TOKEN>.mp3`, one per token
`phonemes()` can emit (37 of them), made by `tools/make-phonemes.sh` out of
espeak-ng's phoneme input — the one way to get a synthesiser to say a sound
in isolation. Stops (b d g k p t) have no sound at all without a release, so
they get a tiny schwa that is then trimmed back to the burst: the closest a
machine gets to a pure /b/ without saying "buh". The script is a build-time
tool; the clips are committed, and nothing on the site needs it.

`GameCore.phonemeAudio()` fetches `audio/ph/manifest.json` once per page and
resolves to a player — `play(tokens, gapMs)`, `has()`, `estimate()`,
`cancel()` — or to **null**. Null is the feature switch: if the folder isn't
there, everything built on it hides itself rather than playing silence at a
student. `x` and `qu` stay single tokens everywhere else (the distance
arithmetic depends on it) and are expanded to two clips only here.

Playing goes through the same microphone hold the spoken coach uses, so the
recogniser never transcribes the computer's own sounds back as the
student's.

### Blend It

A mode that starts from **sound** rather than from letters, and the only one
that can. The student hears /k/ /r/ /a/ /b/ spread 700 ms apart, then the
same sounds 250 ms apart, then says the word. The word itself is not on
screen until they have had their go — that is phonological blending with
nothing to read off, which is the sub-skill every printed list has to
assume.

Dots under the prompt show how many sounds are coming, which is itself worth
knowing before trying to blend them. On the second miss the sounds play once
more and **the letters light up with them**, in order, using `phonemeSpans`
— *that* sound is spelled by *those* letters, which is the join the whole
game exists to make. Then the whole word, spoken; nothing for the nonsense
list, where a synthesiser handed "vab" says "verb".

On the starting blends, the final blends and the nonsense words.
`blend-it-game.js` + `blend-it-game.html`.

### Tap to hear

The back of a flash card and Say It's reveal are pressable where the clips
exist: each syllable on a dotted word, each sound on a one-syllable one.
Press one and it plays itself, then the whole word — a part is only useful
next to the thing it is part of.

A student who has been told a word twice and still can't read it usually
can't hear *which part* they are getting wrong. Pressing "tas" and hearing
/t/ /a/ /s/ answers that without anybody having to explain it.

Press-only on purpose (`tabindex="-1"`): these sit inside games where 1 and
2 are the answer keys, and a tab stop on every syllable would put a dozen
new stops between the student and the button they need.

## Sound boxes, splitting and hearing yourself

Three smaller things, each aimed at a sub-skill the other modes step over.

### Sound boxes (oi/oy spelling)

One input per **sound**, not one for the word. "coin" is three sounds and
four letters, and a student who puts one letter in each box has already
found the thing they were going to get wrong. Typing auto-advances when a
box is as long as the sound it holds — that length is the scaffold, exactly
as the width of a drawn box is on paper — and Backspace out of an empty box
goes back.

The first miss marks the wrong boxes red and says how many; the student
types over them. The second fills those boxes in gold and leaves the right
ones alone, so what they see is their own spelling with the missing piece
dropped in rather than the answer handed over whole. When exactly **one**
box is wrong there is a single thing to point at, so `diagnose()` says what
it is and the voice reads it after the word; two or more and it says nothing
rather than guessing.

Stats are unchanged: correct means every box right first try.

### Split it (multisyllable)

A variant inside the flash-card engine — same deck, same scoring, same
screens — where the word shows with a clickable gap between every pair of
letters. The student marks where it comes apart and presses Enter. Their
extra splits go red where they put them; the ones they missed slide in gold.

The answer key is the list itself: the entry's own syllable dots. Splits are
compared as **sets of positions**, which is what lets a one-syllable word
have the perfectly good answer "no splits at all".

### Hear yourself

A student who has just read a word wrong twice usually has no idea what they
actually said — they heard the word correctly in their own head the whole
time. "🎙 Hear yourself" plays the last few seconds back and then reads the
word properly, which is the comparison the button exists for. There is no
arguing with the recording.

**In memory only.** The clip lives as a blob URL for exactly as long as its
card is on screen and is revoked when the next one arrives. Nothing is
stored and nothing is uploaded: a recording of a fifteen-year-old struggling
to read is not a thing to keep, and the moment it is kept somebody has to
decide who may hear it.

Feature-detected (`MediaRecorder`), and only ever enabled where the
microphone prompt has already been answered — after Say It's mic check, or
when the cards' Listen toggle is switched on. It never causes a prompt of
its own, and where there is no permission the button simply never appears.

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

### Speed

A word decoded in three seconds is not a sight word, however reliably it
comes back right. The flash cards time the flip (`performance.now()` when
the card lands, again when it turns) and pass the milliseconds along with
the rating; the other three engines can't measure anything meaningful — a
mic answer's clock includes the recogniser and a typed one includes the
typing — and simply don't pass it.

The stat gains `lat`, a running average of how long a **correct** answer
took. Wrong answers aren't timed: that clock is measuring how long a
student stared at a word they didn't know. Over `SLOW_MS` (2.5 s) a word
counts as slow and the scheduler weights it up by ×1.5, so it keeps coming
round after its accuracy has stopped moving.

What slow does **not** do is change `isMastered`. The student's own tile
says "12 of 20 solid", and that number must not drop the day the cards
learn to use a stopwatch — nothing about their reading changed. Speed is
the scheduler's business and the teacher's: the dashboard's per-list
breakdown reads "12 / 20 (4 slow)", and **Ready to move up** counts a word
only when it is solid *and* at pace, so nobody gets advanced on the
strength of thirty words they can decode but not read.

On the card itself, a flip under 1.5 s earns a "⚡ fast" pill and the end
screen counts them. There is deliberately no slow pill: "you were quick" is
worth saying out loud, and "you were slow" is a thing the scheduler acts on
quietly, because being told would make the next card slower, not faster.

A list with at least eight solid words also offers a **⚡ Speed round** on
the start screen — a deck of nothing but words the student already owns,
with the cards flipping themselves after two seconds so there is no waiting
the clock out. Useless as practice; the only thing on the site that asks
whether a word can be read without thinking about it.

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

The document also carries a `heard` map: for each word Say It marked wrong,
the last **five** transcripts the recogniser returned, cleaned (lowercase,
letters/digits/apostrophe/space, 40 characters) and deduplicated. It is
evidence, not a score — nothing in the scheduler reads it. It is there
because a word that keeps coming back as "bread" is a reading error worth a
lesson, and a word that comes back as three spellings of itself is the
recogniser failing and wants a line in `ACCEPT` instead. The shape lives in
`adaptive.js` (`cleanHeard`, `pushHeard`, `sanitizeHeard`) beside
`sanitizeStats`, because both the student's store and the teacher's
dashboard have to agree about it. Both places sanitize on the way in: the
document is hand-editable and outlives any change to this repo.

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

The `heard` map added with the sound-level feedback needed no rules change
either: `students/{uid}` is write-your-own-document, not a whitelist of
fields.
