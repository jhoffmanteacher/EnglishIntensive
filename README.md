# English Intensive

Plain static HTML/JS games and activities for English language practice.
No build step, no dependencies. The audience is **9th–10th graders in
reading intervention** — older students practising skills usually taught
younger, so every visual and line of copy stays age-respectful:
arcade/neon fictions, no grade labels, no elementary-coded imagery or
phrasing ("Multisyllable Words", not "Big Words").

Serve it over HTTPS (GitHub Pages) or `http://localhost`, **not** off disk.
Chrome's speech recognition and microphone both require a secure context,
so the games will not listen from a `file://` URL.

```bash
python3 -m http.server 8000
```

## The overview page

`overview.html` is this site described for a **reading teacher** rather than
an editor: what students practise, what each mode asks, what the dashboard
reports, and what the site deliberately does not do. It is served from the
repo like every other page —

    https://jhoffmanteacher.github.io/EnglishIntensive/overview.html

— and that is the link to hand somebody.

Not one of the games: no `auth.js` (the reader has no account and shouldn't
need one) and no JavaScript, which its CSP states outright
(`script-src 'none'`). The body face is the self-hosted Atkinson
Hyperlegible that `site.css` serves.

**The file is the published page.** There is no second copy, so the committed
version and the one a teacher reads are the same by construction. That is
why it lives here: publishing elsewhere and keeping it in step by hand is
what fails.

The masthead carries an **Updated &lt;date&gt;** stamp, and moving it is part
of changing the page: a summary of a moving target is worth only as much as
the reader's ability to tell how old it is.

Anything a teacher would notice — a new mode or family, a changed rule about
how rounds are drawn or what unlocks, a claim about what a number means —
goes in the same commit as the code. `CLAUDE.md` says the same.

The two documents divide by audience only: this one explains why the code
is shaped as it is; that one explains what the site does to a reader who
will never open it.

## Accounts

Every page is behind a Google sign-in wall (`auth.js`), restricted to
**@seq.org** accounts. Sign-in is what makes per-student tracking and
per-student list assignment possible, so there is no guest mode.

Set the project up once with **`SETUP-FIREBASE.md`** — until
`firebase-config.js` has real values, every page shows a "sign-in isn't set
up yet" panel instead of the games.

The @seq.org restriction, the teacher-account check and the wall itself
are client-side and bypassable from DevTools. `firestore.rules` is the half
that actually enforces any of it — see the header of that file, and
re-publish it in the Firebase console whenever it changes. Nothing else
deploys it.

### Classes, teachers and the admin

There is **one admin**, `jhoffman@seq.org`, named twice: `ADMIN_EMAILS` in
`firebase-config.js` (the dashboard's half) and `isAdmin()` in
`firestore.rules` (the half that's enforced). Every other teacher is a
`teachers/{email}` document the admin adds on the dashboard (Manage →
Teachers) — no teacher address is hard-coded anywhere else. `auth.js` reads
that one document at sign-in, before `EIAuth.ready()` resolves, so
`EIAuth.isTeacher()` stays a plain synchronous call; any failure reads as
"not a teacher", which at worst costs a teacher their dashboard for one
load. `EIAuth.isAdmin()` is the config check alone.

**A class replaced the period.** A class (`classes/{classId}`, auto id) is
`{name, teachers: [emails], archived, createdAt, createdBy}` — "P3
Intensive", taught by one or more teachers. Every student is in exactly one
class. Any teacher on a class can rename it, add or remove co-teachers
(picked from the approved `teachers/` list, which any teacher may read for
the names), archive its students, and delete it once it's empty; the rules
refuse a class with zero teachers. Only the admin adds or removes teachers
on the **site**. A teacher sees only the students in classes they teach;
the admin sees every class.

**The copy is the trick.** Every document about a student —
`roster/{email}`, `students/{uid}`, `assignments/{uid}`, `notes/{uid}` —
carries the student's `classId` **and a copy of that class's `teachers`
array**. Firestore rules are not filters: a teacher's list query is allowed
only when the rule can be proven from the query, and `me() in
resource.data.teachers` is provable from `where('teachers',
'array-contains', me)` — the where clause on every teacher-side query in
`teacher.js` (`mine()`). The admin's queries have none. A teacher's write
must stamp a class's *own* teachers array (one `get()` of that class doc —
the same doc for a whole class's batch, which Firestore counts once) with
them in it; an update must also be to a doc that already names them, is
unowned legacy, or belongs to a class they teach. `withStamp()`/`stampFor()`
add the stamp to every write.

When a class's co-teachers change, `setClassTeachers()` writes the class doc
and then rewrites the copy on every member's docs (`restampBody()`, batches
of ≤400). A removed co-teacher loses access as soon as their address is
gone from the copies. If that rewrite is cut off, **self-heal** finishes it:
on every dashboard load `healBody()` compares each visible member doc with
its class and rewrites any whose `classId` or `teachers` differ (a
student's class is read from their roster row first — the record — then
their own doc, then their assignment). A teacher can remove themselves; the
rules let someone who *was* on a doc restamp it to the same class's current
list, never move it elsewhere.

**Membership starts at the roster row.** An import writes each row with the
chosen class's stamp; `store.js` copies the row's `classId`/`teachers` onto
the student's own doc on their next sign-in (`classToCopy()` — the one
change the rules let a student make to those fields), and from then on the
class's list queries find them. The import asks which class: by default it
matches the file's period column to a class name of the teacher's ("3" ↔
*3*, *Period 3*, *P3*, *P3 Intensive*), creating *Period 3* if nothing
matches and *No class yet* for rows with no period; or one chosen class; or
a new one. One student, one class: the import first `get()`s every address
not already on the teacher's roster, and the rules answer a get of a row in
somebody else's class with *permission-denied* — that refusal is the
answer. Those rows are skipped and reported ("already in another class —
ask a teacher on that class or the admin to move them"), never written; a
refusal at write time (a race) re-checks and retries once so one row can't
sink the batch. `importPlan()`, `classifyProbe()` and `importTargets()` are
the pure half.

**Moving** a student is the *Class* box on their page or the *Who's in which
class* table: a teacher can move between classes they teach; the admin,
anywhere. `moveBody()` set-merges the new stamp onto the roster row, the
student's doc (a teacher may change exactly those two fields on it), the
assignment and the note — the last two written even when missing.
**Removing a site teacher** (admin) deletes their `teachers/` doc — that
alone ends their access — then takes them off every class; it is refused
while they are the only teacher on a class.

**The admin's migration** runs on every admin load and is a no-op once done
(`migrationBody()`, pinned in `tests.html`): each distinct old period (the
assignment's, else the roster row's — the old precedence) becomes a class
`{name: <period>, teachers: [admin]}`, reusing a class of that name if one
exists; every doc without a `classId` gets its student's class and its
`period` field deleted; students with no period go to a class called *No
class yet*; and when there are no classes at all, every period named in the
old `config/class` becomes a class too, even an empty one. The admin then
redistributes by adding co-teachers or moving students.

Why the per-student `get()` is only a fallback: Firestore allows about ten
`get()`s per request, and giving a sequence to a class (like the roster import)
saves a whole class in one batch.
Checking each student's own doc on every write failed at the tenth in the
emulator; checking the one class doc does not.

`tools/rules-test.mjs` runs `firestore.rules` in the Firestore emulator
against all of this — co-teachers, removal cutting a teacher off, a student
unable to pick a class their roster row doesn't name, whole-class batches
(see its header for how to run it; it needs Java and two npm packages kept
out of the repo).

## Word lists

`word-lists.js` is the single source of truth for what a practice list
**is**. The game page that plays a list, the home page that advertises it
and the dashboard that assigns it have to agree, so it is defined once.

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
| ⏱ | `fluency` | `fluency-game.js` | read down the list for one minute |
| 🔊 | `blendit` | `blend-it-game.js` | hear the sounds, blend them, say the word |
| ✂️ | `split` | `card-game.js` | mark where a long word comes apart |

The red words worked this way first: the same "List 3" as flash cards
*or* as Match It, because knowing *would* on sight and picking it out of
six look-alikes are different skills and a student can have one without
the other. That holds for every list — reading *moist* cold, spelling it,
and finding it among look-alikes are three separate things. So the
registry generates **one entry per (family, list, mode)**, each with its
own id and therefore its own stats.

The six families:

| family | lists | modes |
|---|---|---|
| Starting Blends | 1 | 🎤 ⌨️ 🃏 🎯 (⏱ 🔊 retired) |
| Blend Words | 1 | 🎤 ⌨️ 🃏 🎯 (⏱ 🔊 retired) |
| Nonsense Words | 1 | 🎤 🃏 ⏱ 🔊 |
| oi / oy | 1 | 🎤 ⌨️ 🃏 🎯 |
| Multisyllable | 1 | 🎤 ⌨️ 🃏 🎯 ✂️ |
| Red Words | 10 | 🎤 ⌨️ 🃏 🎯 |

**The teaching order.** Inside a sequence a student meets a list's ways one at
a time (see *Sequences*), in one fixed order per family — hear it, read it with
help, read it alone and checked, read it fast; spelling after reading (the
teacher, 2026-11-27). The site sets it; the teacher only ticks which ways. It is
the family's `order` in `word-lists.js`:

| family | a student meets its ways in this order |
|---|---|
| Starting Blends | 🎯 Match It → 🎤 Say it → 🃏 Cards → ⌨️ Spell it |
| Blend Words | 🎯 Match It → 🎤 Say it → 🃏 Cards → ⌨️ Spell it |
| Nonsense Words | 🔊 Blend it → 🎤 Say it → 🃏 Cards → ⏱ One minute |
| oi / oy | 🎯 Match It → 🎤 Say it → 🃏 Cards → ⌨️ Spell it |
| Multisyllable | ✂️ Split it → 🎯 Match It → 🎤 Say it → 🃏 Cards → ⌨️ Spell it |
| Red Words | 🎯 Match It → 🃏 Cards → 🎤 Say it → ⌨️ Spell it |

`order` names every mode the family offers, once, and no retired one (a test
pins that). `WordLists.inTeachingOrder(ids)` sorts a list's ids by it — a mode it
does not name (a retired one a student still holds) after the named ones, an id
the library does not know last, nothing added or lost — and `withSay` (*Say it
is in every step*, under *Sequences*) runs it, so every step the dashboard
writes is in this order. `orderOf(family)` gives the mode keys. On the home
page, a sequence's tiles list their Play rows in this order too, so a way that
opens only ever adds a row at the bottom. Lists given without a sequence are
not affected: their rows stay in the family's `modes` order, every way at once.

Some gaps are deliberate. **Nonsense words** have no Match It: that game
*says* a word and asks the student to find it, and a synthesiser handed
"vab" guesses — often "verb", so the answer key would be wrong. A list with
no meanings can only be read, not heard, and for the same reason it has
no Spell it: there is no word to hear and type. Every one of its modes runs with
`speak: false` for the same reason: the cards' flip shows the word without
pronouncing it; Say It has no Hear it button or H key, its reveal shows the
word and says only the hint, and tap-to-hear plays the sounds but not the
word; One minute lists the missed words without reading them back; Blend
It's reveal plays the sounds and stops. The student reads, the computer only
listens. Say It and One minute read the word aloud for a while. The
one-minute run and Blend It are offered only on Nonsense Words (see
*Retired modes*). Split It is only for the multisyllable list, the only list
with syllable dots to check against. The **red words** got a say-it mode
late, after the reason they lacked one proved wrong — see *Say It for the
red words* below.

### Ids are permanent

An id is half of every Firestore stat key (`"<id>|<word>"`) and is what an
assignment stores, so renaming one orphans a class's history. Generated
ids are `<family>-<n>-<mode>` — `red-3-cards`, `multi-1-match`. A family's
`ids` map overrides that per mode, and every id that predates families is
pinned there, unchanged:

```js
lists: [{ n:1, ids:{ say:"oi-oy-read", spell:"oi-oy-spell" }, words: OI_OY_WORDS }]
```

`final-blends`, `initial-blends`, `nonsense`, `oi-oy-read`,
`oi-oy-spell` and `multisyllable` all still resolve to exactly the engine
and page they always did; `tests.html` pins each by hand, the single check
between a refactor and a year of practice detached from its list. `title`
is the display name and can change freely.

### Retired modes

A family can list modes in `retired: [...]`. A retired mode stays in
`modes`, so its entries and ids are still generated and still resolve.
It is just no longer **offered**: `WordLists.offeredModesOf(family)` drops
it, `idsOfList` / `idsOfFamily` leave its ids
out, and `isRetired(id)` says which is which. `modesOf` and `idFor` stay
complete, because the picker has to show a retired mode a student still
holds. Deleting the id instead would orphan their history and leave
dangling ids in every stored assignment.

Today that is **Blend it** and **One minute** on Starting Blends and
Blend Words (25 list × mode combinations became 21). Reasons:

- **Blend it** is for blending sounds into a word. On a 28–31 word list
  of *real* words it is an easier Say it: a student who can read *clam*
  gains nothing from hearing /k/ /l/ /a/ /m/ first. It stays on Nonsense
  Words, where blending is the point.
- **One minute** is a rate measure. A decent reader laps a 28–31 word
  list twice, so the number is mostly noise. Nonsense Words has 40 words,
  and the rate of *decoding* is the real question there.
- **Red Words · Match It** is *not* retired. It is the only red-word
  activity with no microphone and no self-report. It carries a teacher
  tooltip instead (`hints` on the family, shown by `hintOf`): red words
  are for reading on sight, and Match It gives the word by ear.

What happens to a student who already has one:

- Nothing, until the teacher unticks it. It stays in their assignment, on
  their home page, and plays. Silently migrating would change what a
  student sees without the teacher doing anything.
- In the student picker it shows dashed with a "Retired — still in this
  student's list" tooltip, and can be unticked. It is never offered fresh:
  the family's *all* leaves a held one ticked (only *none* clears it), a
  picker whose student does not hold one draws no box for it, and the
  flag line ignores it (a retired list a student still holds is not part of
  the plan). A sequence's ready-made steps never include one.
- The teacher's own preview home page lists offered ids only; a game page
  still opens for a retired id.
- "Everything" in a description means everything on offer.

To un-retire a mode, delete its string from `retired`, and add it to the
family's `order` where a student should meet it in a sequence (until then a
held one sorts after the ordered ways; the test that `order` names every
offered mode goes red as a reminder). Nothing else changes.

### Adding to the library

- **another red list** — one array in `RED_LISTS`. Nothing else.
- **another mode on an existing list** — one key in that family's
  `modes`, and the same key in its `order`, where a sequence should open it
  (the test that `order` names every offered mode fails until it is there).
- **a whole new family** — one entry in `LIST_FAMILIES`, with its teaching
  `order` (every mode it offers, in the order a sequence opens them). Every mode has
  a shared page that takes the list from `?list=` — `cards-game.html`,
  `match-game.html`, `say-game.html`, `spell-game.html`,
  `fluency-game.html`, `blend-it-game.html` — so nothing new is needed
  unless the family wants list-specific coaching on its start screen. The
  five phonics families name their own say-it page in `pages` for that
  reason (the oi/oy rule box, the blend explainer), and oi/oy keeps its
  own spelling page (`spelling-oi-oy-game.html`, id `oi-oy-spell`). A
  family that offers `spell` must give `modeConfig.spell.rule`: the rule
  box is half of that game, and `tests.html` fails on an empty one.

`config` is what every mode of the family passes to its engine;
`modeConfig[mode]` is what only that mode passes, and it wins on a clash.
The home page and the dashboard pick it all up with no further edits.

Helpers on `WordLists`: `families()`, `familyOf()`, `modesOf(family)`,
`listNumsOf(family)`, `idFor(family, n, mode)`, `idsOfList(family, n)`,
`idsOfFamily(family)`, `hrefOf(id)`, `orderOf(family)`, `inTeachingOrder(ids)`,
`withSay(ids)`, and the pure `describeAssignment(ids)`
/ `describeFamily(family, ids)` that turn a set of ids into the one line
the roster, the picker and a student's page all show: *"Starting Blends: 🎤🃏 ·
Red Words: 1–3 🃏 · 1 🎯"*. A family with one list prints only the modes;
a family with ten prints the list numbers per mode, as ranges ("1–10", not
ten numbers).

### Heart letters

A red word is rarely irregular all the way through: "said" is s + d around
one impossible middle. The lists mark that middle with braces — `"s{ai}d"`,
`"c{oul}d"` — and the flash cards show it in red on the **back**, under
"Remember the red letters. They don't sound the way they look." The front
stays plain: the card must be read cold first.

The point is the size of the thing memorised. "Learn s-a-i-d" is four
letters with no pattern; "*said* has an **ai** in the middle" is one chunk,
and the s and the d are just reading.

Marks are display only and stack with the syllable dots (`"al{th}·ough"`).
`GameCore.parseEntry` returns `{ word, chunks, heart }` — the heart ranges
index the **plain** word, apostrophes and periods included — and
`WordLists.plain()` strips braces as well as dots. Everything that stores or
matches a word sees the plain form, so the marks changed no stat key;
`tests.html` pins all ten red lists' `wordsOf()` byte for byte against what
they produced before, because those strings have a term of practice behind
them.

Marking is by hand, deliberately: `phonemes()` could flag the vowel team in
every word, regular ones included, but "which part can't be sounded out" is
a teaching judgement the encoder doesn't know. Unmarked words are unmarked
on purpose: *carrot*, *spirit*, *radio* and *about* are regular enough to
sound out; *Mrs.*, *Mr.* and *wind* are an abbreviation and a heteronym, a
different problem.

On **Not yet**, a word with heart letters is spelled rather than just
re-read: "s. a. i. d. said", as one utterance, because four utterances come
out as four separate thoughts.

### Syllable dots

The multisyllable list writes words with middle dots marking syllable
breaks — `fan·tas·tic`. A display aid only: `GameCore.parseEntry` splits an
entry into the plain word and its chunks, and the plain word is the only
form that reaches phoneme matching, TTS, the comeback deck or a stat key.
This used to live in `blend-game.js`, the only engine playing that list; now
every list can be played as cards or Match It, so it belongs in the core.
Cards shows the chunked form on the **back**, after the cold read of the
front; Match It strips the dots, since a dotted tile would give the split
away and mark itself out from its distractors.

### Pages

`cards-game.html`, `match-game.html`, `say-game.html`,
`fluency-game.html` and `blend-it-game.html` each serve every family that
has the mode, and take the list from the query string:
`cards-game.html?list=red-3-cards`. They call `EIPractice.play()` with no
id. The per-family say-it pages and the spelling page name their one list
outright, and `hrefOf` gives them a clean address with no `?list=`, because
a page that serves one list already knows which.

`red-words-game.html` and `red-words-match-game.html` are now six-line
redirects that carry the `?list=` across to the generic pages. They stay
because students bookmark game pages and copy them off the board, and a
dead link mid-class costs more than the file does.

## Home page

`index.html` builds its tile grid from `word-lists.js`, filtered to the
lists the signed-in student is assigned (`EIStore.myLists()`), so students
with different assignments see different games.

The registry's (list × mode) entries fold back into **one tile per
list** — "Red Words · List 3", or just "Blend Words" for a single-list
family — with a Play row per mode that student has, each carrying its own
progress. A student assigned both modes of three red lists sees three
tiles, not six. Every row links to its page with the list named:
`cards-game.html?list=red-3-cards`.

The two shelves are **🔤 Sounding It Out** and **🃏 Red Words**. They used to
be one shelf per modality (speaking, typing), which stopped meaning anything
once every list could be played four ways. What divides this library is the
reading: words you can build from their sounds, and words that refuse to be
built and have to be known. Each mode's row carries a small `mic` or
`headphones` tag, so a student on a Chromebook with neither finds out before
opening the game.

A shared page with no `?list=`, or a stale one, isn't an error: it shows a
chooser of the student's own lists that have that mode, so a bookmarked or
hand-typed address still lands somewhere useful. Where two lists in the
chooser would carry the same title (Multisyllable has a Cards list and a
Split it list), each tile adds its mode's name. A list id belonging to a
different page redirects there.

A student in a sequence sees, of the list they are on, only the ways open so
far (*One way at a time*, under *Sequences*): a new Play row appears at the
bottom of the tile as each opens (a sequence's tiles list their rows in the
teaching order, `appendSections(…, inOrder)` → `familyTile`; a plain set keeps
the `modes` order), and the finished fold shows every way. "What they were
given" is then what is open: `EIStore.myLists()` holds only the open ways of
the current list, so a way not yet open is exactly an unassigned id to a game
page.

A student only ever plays what they were given. Opening a list they weren't
assigned — an address copied off a neighbour's screen, or a way of their list
that has not opened yet — shows the same chooser, or one line saying the game
isn't on their list. A student with
nothing assigned gets an empty home page saying the teacher will add games,
not the whole library. The teacher's account (and the localhost dev bypass)
sees every list, so a game can be tried before it's handed out; the
teacher's home page says so in one line so it isn't mistaken for what the
class sees. That switch is `EIStore.seesEverything()`.

## Reading view

Four switches on every game's start screen, under **👁 Reading view**:

| | |
|---|---|
| **Font** | Site default · **Lexend** · **Atkinson Hyperlegible** |
| **Letter spacing** | Normal · Wide |
| **Word case** | As written · lowercase |
| **Card colour** | Dark · Cream |

None of these is decoration. A reader who loses their place between b and d,
or can't hold a word together when the letters sit tight, is describing the
thing that is actually hard. Lexend was drawn against reading-speed research;
Atkinson Hyperlegible by the Braille Institute for low vision, its b/d/p/q
and I/l/1 made to be told apart at a glance.

Both fonts are **self-hosted** (`fonts/`, latin subset, 400 and 700, OFL
licences included). Linking them from Google would mean a school network
that blocks `fonts.gstatic.com` silently falls back to the default face —
for exactly the student the setting exists for.

The settings live in `localStorage` under `eiView`, per device, like Shuffle
and Voice: on a shared Chromebook cart the setting belongs to the seat.
They are applied as classes on `<html>` (`view-lexend`, `view-wide`,
`view-lower`, `view-cream`), so a setting reaches every page and engine
without any of them knowing about it. `game-core.js` owns the object, the
panel and the sanitizer — an unrecognised stored value is the default, not
an error.

`view-boot.js` runs in each page's `<head>`, before any stylesheet, and
copies a cached class string out of `localStorage` onto `<html>`. Without it
a student with Lexend on watches every page render in the default face, then
jump. It reads only the derived cache and scrubs it to `[a-z- ]` before it
touches `className`, because localStorage is hand-editable; the cache is
disposable and `game-core.js` re-derives it from the real object on load.

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

There are six engines — blend (say it), spell (type it), card (flip it, and
Split it), match (find it), fluency (one minute) and blend-it (hear the
sounds, blend them) — and they deliberately share a look, scoring and
habits, so moving between them feels like one game asking different
questions. That used to be kept by copying code between engines with "keep
this in step" on each copy: right at two copies against a no-build site,
wrong by four. Scoring was in four places, the comeback deck in three, the
vault-run SVG in three more, and each copy was a chance for two games to
quietly diverge.

In the core: combo scoring and the star thresholds, the comeback deck (and
the one function that touches `localStorage`), the race/vault progress
graphics, the confetti, the score pop-up, the feedback blips, the voice
ranking, the syllable-chunk parser (`parseEntry`, `chunkMarkup` — every
engine handles dotted entries and all need the same answer to
"what word is this really?"), the start screen's read-aloud
(`directionParts`, below), and the word-list helpers (`shuffled`,
`dedupeWords`, `sampleWords`, `escapeHtml`).

### Directions, and reading them aloud

The intro and numbered steps on every start screen are short and plain. This
is a phonics class, not a reading test: the *how to play* copy must not be a
decoding challenge. Each intro is one or two short sentences separated by a
`<br>`, and that break is load-bearing — see below.

Every game has a **🔊 Read directions aloud** button, speaking that text in
the same best-picked voice as the words (`Core.voice()` prefers Chrome's
network-backed "Google US English" over the flatter local default). It reads
the live DOM, not a second copy of the strings, so spoken and visible
directions cannot drift, and it is disabled where `speechSynthesis` is
missing.

`Core.directionParts(startScreen)` does the walk and returns the fragments
to speak, in screen order: the intro, then the rule box or "good to know"
note if there is one, then the numbered steps. Boxed sections lead with
their own on-screen `.tag` — "The rule", "Good to know" — so a listening
student gets the same heading a sighted one reads.

It lives in the core because the engines had each grown their own copy of
this walk, with the same two bugs. First: reading the intro with
`.textContent` drops the `<br>`, welding two sentences into a run-on with no
pause. Second: joining fragments with `". "` doubled the full stop every
fragment already ends in, and sent the lot to the synthesiser as **one**
utterance. Each engine now speaks the fragments as separate queued
utterances, a truer pause than punctuation; the speaking stays per-engine,
because the blend game must stand its microphone down first and the
others don't.

Still in each engine: how it asks its question, how it judges the answer,
its own screens and styles, and anything to do with the microphone.
`blend-game.js` keeps its own `say()` because it has to stop a live
recognizer first so the game never transcribes itself, and it passes its
mic-hold in to the core's sounds as a callback rather than pushing
microphone bookkeeping into shared code:

```js
var snd = Core.sounds({ onPlay: function(ms){ holdMic(ms + 180, true); } });
```

Each engine aliases what it takes at the top of its file, so what's shared
is visible in one place. `tests.html` asserts every engine points at the
*same function object* as the core, so a reintroduced local copy fails
immediately.

## Listening: two things every mic mode shares

Both live in `game-core.js`, are pinned in `tests.html`, and are driven
through the real engines with a fake recogniser in `tools/boot-check.html`.

**A late result stays with its own word** (`resultGate`). Say It's recogniser
runs across many words — only the computer's voice restarts it, not the
beeps — and scores on an interim guess so a right answer lands quickly.
Chrome then sends its *final* version of the same speech, sometimes after
the next word is up. Scored there, it was a wrong answer and a lost try on a
word not yet read. Now everything the session produced before a word
appeared belongs to the word before it. (`say-late`)

**A dropped second of Wi-Fi is waited out** (`netRetry`). Chrome's recogniser
runs on a server, and one "network" error used to switch the mic off for the
round with "check wifi and reload". Now each mode waits 1, 2, then 4 seconds,
retries, shows *Reconnecting…*, and gives up only after four failures in a
row. A result, or a session ending without a network error, resets the
count. Say It, Blend it, One minute and the flash cards' listening all use
it. (`say-net`)

Chrome also offers on-device recognition (`processLocally`, with
`SpeechRecognition.available()` / `install()` for the language pack;
Chrome 138 on desktop, by its intent-to-ship thread) and word boosting
(`phrases`, Chrome 140 desktop); neither is used. Chrome's own ship notes say on-device recognition
is Windows, Mac and Linux, with ChromeOS "to follow" — the Chrome 150 notes
still list ChromeOS as unsupported — so on the class Chromebooks it is not
an option yet; `mic-takes.html` offers it as a variant where the browser has
it. Boosting the target word must never touch scoring — it makes the
recogniser hear the word whether or not it was read. The recorder offers it
only as a variant labelled BIASED, to measure exactly that.

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

The red words got a say-it mode late, after the reason they lacked one
proved wrong. "A phoneme matcher has nothing to check an irregular word
against" is true and beside the point: Say It takes an **exact transcript**
first and falls back to phonemes only after, and a red word is an ordinary
dictionary word Chrome returns reliably. Two things actually blocked it,
both now fixed where they belong.

**Homophones.** No amount of listening separates *to* from *two*, and a
student who read the card correctly must not be marked wrong because the
recogniser guessed the other spelling. A list may carry `homophones` groups
(the red words pass the `RED_HOMOPHONES` Match It already used); any member
of the target's group is accepted, checked *before* the level rules,
including at Challenge, because a homophone is not a near miss the game is
being generous about. The phonics lists deliberately have no groups: their
near-misses are minimal pairs (*sled* / *bled*), and telling those apart is
the exercise.

**Sound-alikes that aren't on a list.** `RED_HOMOPHONES` holds only pairs
with both words on a list, which is what Match It needs. A recogniser has no
such limit: *know* is at least as likely to come back "no"; *eye* as "I",
*buy* as "by", *hour* as "our". Those were misses, and the reveal then told
the student they had dropped a sound. `RED_SOUNDALIKES` in `word-lists.js`
is a second, say-only map — `{ know: ["no"], eye: ["i", "aye"], … }` —
passed to Say It and the cards' Listen as `soundalikes`, never to Match It,
which would need a sentence for every entry. `GameCore.soundsLike` accepts
one **only as the whole transcript** (fillers aside — "um, no" is "no"):
"no", "I", "so" and "for" are in everything a student says, and "I don't
know" must not count as reading *eye*. Tests pin that no entry is itself a
list word and every key is one. It wants one check on a Chromebook: the map
is built from which words sound the same, not from a log of what Chrome
returned.

**Contractions.** "they'd" said aloud *is* "they would", and the recogniser
writes down whichever it likes. `GameCore.normalize` folds the expansion to
the contraction so both are the same string — but only when the transcript is
exactly that phrase. Folding inside a longer transcript would destroy tokens
the matcher needs: "they have" is the expansion of "they've" and also a
student reading *have* with a run-up.

The mode runs on a generic `say-game.html?list=red-3-say`, the way
`cards-game.html` already works. The five phonics families keep their own
pages, because each carries a rule box or mic note that only makes sense
for that list.

Three matching modes for `blend`, depending on what's being drilled:

- `"start"` / `"end"` — a fixed-length blend at one end of the word
  (`blendLength`, default 2). The blend must come back phonetically exact;
  the rest of the word gets the usual tolerance.
- `"sound"` — a target phoneme that can land anywhere in the word (e.g. the
  oi/oy diphthong: "coin", "boyish", "annoy"). Pass `sound` (one phoneme
  token from `phonemes()`, e.g. `"OY"`) and `highlight` (a regex matching the
  letters to show highlighted, e.g. `/oi|oy/i`) instead of `blendLength`. The
  sound is located by searching the word's phoneme sequence, since its
  spelling position varies.
- No blend at all (plain word reading — nonsense words, multisyllable
  words): pass `blend: "start"` with `blendLength: 0`. The "blend" is then
  always empty, so nothing is force-matched or highlighted — a plain
  whole-word fuzzy match.

The plain progress bar is themed per game: `theme: "race"` slides a car along
a track toward a checkered flag, `theme: "maze"` is a **vault run** — a ninja
threading a neon laser corridor toward a diamond vault. Both use the same
word-index percentage as the old bar, so they work for any list length.
`blend-words-game.html` uses the race theme, `initial-blends-game.html` the
maze theme — pick either for a new game.

Word-list entries may carry **syllable marks** with a middle dot
(`"fan·tas·tic"`). The engine strips the dots everywhere that matters
(matching, speech, storage) and uses them only to scaffold: after a second
miss the reveal shows the word broken into its chunks (and, with Voice on,
pronounces it syllable by syllable, then whole), and the end screen's
missed-word chips keep the chunked form. Undotted words behave exactly as
before. `multisyllable-words-game.html` uses this throughout.

The engine renders every screen, so adding a game means copying an existing
page and swapping the word list. Chrome only — it uses the Web Speech API.

Current games:

- `blend-words-game.html` — words **ending** in a consonant blend.
- `initial-blends-game.html` — words **starting** with a consonant blend.
- `nonsense-words-game.html` — made-up CVC words, pure decoding practice.
- `oi-oy-words-game.html` — words with the oi/oy diphthong, anywhere in the word.
- `multisyllable-words-game.html` — two- and three-syllable real words, with
  syllable-chunk scaffolding.
- `spelling-oi-oy-game.html` — the site's first **spelling** game (see below).
- `spell-game.html` — the shared spelling page for every other list with
  Spell it, told which by `?list=`.

### Comeback words (missed-word persistence)

> Still per-device, and now the *inner* of two loops: the comeback deck is a
> within-page warm-up in `localStorage`, while the adaptive scheduler below
> is the cross-session, cross-device one in Firestore. They don't conflict —
> one picks a warm-up out of the last few rounds on this machine, the other
> picks the round itself.

Each game keeps a deck of not-yet-mastered words in `localStorage`, one per
student per list (`GameCore.comebackKey`: `blendComeback:<uid>:<list>`, and
`cardComeback:` / `matchComeback:` for the two sight-word games). The `uid`
matters on a shared Chromebook: without it the next student was offered the
words the last one missed. A word joins the deck
when it's missed twice or skipped in a round, and **leaves the deck the
moment it's read correctly on the first try** in any later round. When the
deck has words, the start screen grows a "🔁 Words you missed (N)" button
that runs just those words — most-missed first, capped at 15 so it stays a
warm-up. The storage layer treats localStorage as untrusted (versioned,
sanitized on read, silently absent if storage is unavailable), and the pure
deck logic (`comebackMerge` / `comebackMastered` / `comebackDeck`) lives in
`game-core.js` and is covered by `tests.html`. The session-level "Practice
missed words" button on the end screen is unchanged and separate.

## Spelling game

`spell-game.js` is a second engine for **encoding** practice: the computer
says the word, the student types it. Deliberately mic-free, so it works in a
noisy room. A page passes `SpellGame.start({title, intro, rule, words})`;
`rule` is a short spelling rule on the start screen (the oi/oy page teaches:
*oy* before nothing-or-a-vowel — enjoy, royal; *oi* before a consonant —
coin, moist). The word is spoken (auto, plus "Say it again", slower after a
miss) but never printed before it's answered; a second miss reveals the
spelling with the letters the student failed to produce in gold (a
Levenshtein backtrace, `diffLetters()`), then moves on. Scoring, streaks,
stars and the missed-words list match the blend games, and the pure helpers
are covered by `tests.html`.

Every list but Nonsense Words can be spelled. oi/oy has its own page and
sound boxes; Starting Blends, Blend Words and Multisyllable play on the
shared `spell-game.html` (`?list=blends-start-1-spell` and so on) with
one box, because every letter in a blend word is its own sound and the
boxes would only say how long the word is. Each family's rule box is its
`modeConfig.spell.rule` in `word-lists.js`. The engine takes library
entries, so a dotted multisyllable word is spoken, checked, boxed and
stored as the plain word (`Core.parseEntry`), and the reveal after a
second miss adds its syllables (`partsLine`). Adding Spell it to a list
adds nothing to any student's assignment or sequence: it is offered on
the Assign board and in the pickers, and a teacher ticks it.

**Red Words** spell on the same page (`red-1-spell` … `red-10-spell`). The
red-word rule that sounding out teaches the wrong thing is about
*reading*; spelling a red word is mostly by sound plus the heart letters,
and that is the rule box (`RED_SPELL_RULE`). Two things are red-only:

- every red word a listener could spell another way is said with a
  sentence — each member of `RED_HOMOPHONES` and each key of
  `RED_SOUNDALIKES`. The map is `RED_SPELL_SENTENCES`: `RED_SENTENCES` plus
  a sentence for each sound-alike that had none. The cards and Match It
  keep `RED_SENTENCES` unchanged. `tests.html` fails on a sound-alike key
  without one.
- the reveal adds the word with its heart letters in red (`partsLine`),
  as on the card back. The cards' front-first rule doesn't apply: the
  student hasn't seen the word until the reveal.

Answers are strict about letters and apostrophes (`aren't` needs its
apostrophe; a curly one is fine) and fold accents (`resumé` takes
`resume`, since a Chromebook has no é key). The start screen's second step
says "Some words come with a sentence" when only some of the list's words
have one.

### How the listening works

The mic is not push-to-talk. Each game opens on a mic-check screen with a
live level meter, then the mic stays on for the whole game, pausing only
while the computer speaks words aloud (the coach's praise, "The word
was...", "Hear it") — never for the short feedback beeps, so it needn't
reconnect between words. Silence never counts as a wrong answer.

Neither does **the right word heard faintly**. Chrome reports how sure it is
of a transcript, and Say It doesn't take an exact match as right under 0.35
confidence — a quiet read is where the recogniser fills in a likely word. But
"not sure it was right" is not "wrong": that result used to fall through to
the miss and tell a student who had read *crab* "Not quite — I heard: crab".
Now it costs no try and asks for the word once more, a little louder; the
same word twice is taken as read. (`say-quiet` in `tools/boot-check.html`.)

A real word has to come back exactly right to be marked correct — no
forgiving near-misses, since the student actually saying the word correctly
is the whole point. A more forgiving phonetic matcher lives in
`game-core.js` (`phonemes()`, `phoneticDistance()`, the `ACCEPT` table of
known recogniser mishearings); it compares **sounds** rather than letters, so
"krab" would pass for "crab". The games no longer expose it as a level, but
it is not dead code: the encoder underneath tells a student which part of a
word went wrong (below), names the phoneme clips in `audio/ph/`, and is what
the flash cards use to judge a spoken answer.

**The nonsense list is the one exception, in every mic mode.** A recogniser
handed "vab" has no dictionary entry to return, so it returns the nearest
real word — "verb" — and a letter-perfect match is a bar no student could
clear. A list that sets `phonetic: true` is judged by sound: within one sound
of the word. Say It, One minute and Blend It set it for the nonsense words
and nothing else (the cards' Listen gets the same rule from `speak: false`).
Say It and One minute went without the switch for a while and marked correct
readings wrong. `x` and `qu` are opened out into two sounds for this
comparison, or "ticks" could never match *tix*.

In Say It, "by sound" is fenced three ways, because one sound is a wide
margin on a three-sound word:

- **Once, on the whole transcript** with its fillers out — not on each word
  of it, the way an exact match is. "it" is one sound from *rit*, "on" from
  *pon*, "hmm" from *hom*; asked of every word, "I give up" was a correct
  reading of *rup*.
- **No pure deletions.** "ed" is one sound from *ted* and is not it.
- **Not closer to another word on the list**, so "sig" never passes for
  *sug*. "The list" is all 40: `practice.js` passes `allWords` beside the
  18-word round, because judged against the round alone the twin was
  usually not there to be seen.

What it still forgives is a wrong short vowel said as a real word — "pin"
for *pon* — because that is also exactly what the recogniser returns for a
correct reading. A transcript can't tell those apart; the cards can.
`say-nonsense` and `say-nonsense-twin` in `tools/boot-check.html` drive
this through the real engine and the list's real config.

**`ACCEPT` is the other exception, and it applies to every list.** It holds
transcripts the recogniser returns for a word that was read right — *tent*
comes back as "tenth" — and every listening mode accepts them: Say It, the
cards' Listen, One minute and Blend It. It used to be checked only at the
forgiving level, which Say It never runs at, so adding an entry did nothing
in the one mode whose transcripts reach the dashboard.

An entry forgives that reading for every student, so the bar is narrow: the
student said the word correctly and the microphone wrote something else. A
transcript that is what a real misreading sounds like does not belong.
*gasp* ← "gas" was taken out for that reason — it is the final blend with its
last sound dropped, the error that list exists to catch (and the example
under *Which part went wrong*, below).

Run `tests.html` (served like the games) to check the matcher and everything
shared in `game-core.js` (scoring, stars, the comeback deck, the progress
graphics, the sound contract the mic games rely on), the syllable parser,
the spelling checker, the flash-card deck builders and the matching game's
distractor picker. It renders a pass/fail table with a summary line.

Three scripts in `tools/` run the checks headlessly, against a plain
`python3 -m http.server`:

| | |
|---|---|
| `tools/run-tests.sh` | `tests.html` in headless Chrome; prints the summary line |
| `tools/check-pages.sh <pages…>` | loads each page and reports console errors and CSP violations |
| `tools/boot-check.sh` | **starts every engine** against its real list and clicks a few steps through it |
| `tools/listen-loop.mjs` | replays recogniser output through the four engines that listen and counts false rejects and false accepts (below) |

The last one exists for the gap the other two leave: `tests.html` covers
pure logic, and page loads stop at the sign-in wall, so an engine's `start()`
never runs on a real page without an account. A listener bound to an element
before the shell exists throws on the first card and passes both other
checks — which happened once.

### The closed loop

`node tools/save-loop.mjs` answers the question the three scripts above
can't, because they never sign in: after students practise on shared
Chromebooks — answers, finished rounds, tabs hidden and closed, the network
dropping and stalling, Sign out and the next student signing in — does each
student's `students/{uid}` hold what that student did, does nobody see or
receive anyone else's work, and does Sign out always finish? Node 22, no
dependencies, no browser, about a second for the default 160 cases (plus
the directed one).

**What is real:** `firebase-config.js`, `auth.js`, `adaptive.js`,
`word-lists.js` and `store.js`, unmodified, loaded into one Node `vm`
context per page. Sign-in is the wall's own button, Sign out the chip's own
button, and the student answers through `EIStore.record` and
`EIStore.finishRound`. **What is fake:** a virtual clock; a stub DOM; a
device with one `localStorage` for every tab and every student and one
`sessionStorage` per tab; one Firebase Auth user per device; and a small
Firestore server with merge writes, minimal rules and a network that can be
`ok`, `offline` or `stalled`. Offline, a write does **not** fail — it waits
for the network, as the real SDK's does, and is lost if its tab closes or
its student signs out first. One page's writes land in the order they were
issued, whatever latency each drew, because the real SDK sends one client's
writes from a single queue in `set()` order — `store.js` relies on that and
hands each write over at once rather than chaining it behind the last. The
fake checks itself at the start of every run, and `--fake-fault=merge`,
`--fake-fault=clock` and `--fake-fault=order` break it on purpose to show
the run goes red. One limit: a write issued at `pagehide` here is on the
wire and lands; a real browser may never send it (no keepalive), so a green
close-fast means the save was handed to the SDK in time, not that it is
certainly stored.

It plays eight families of seeded schedules (`--list`), then one directed
case (`first-fails`: two writes outstanding, the first refused, the second
landing, and the retry must not put anything back), and compares the
stored documents with its own ledger of what each virtual student did:

- **C1 saved** — an answer on a page that loaded, followed by 6 s open with
  the network up or by a hide, close, reload or Sign out with the network
  up, is in `words[key]` with the right `n` and `r`. The 6 s is what the
  store promises (a save within 5 s of the first unsent answer) plus the
  slowest fake write and a margin — `OWED_OPEN_MS` in the tool.
- **C2 no leak** — a student's doc holds only keys they answered, and a
  page's `EIStore.allStats()` only its own student's keys.
- **C3 Sign out finishes** — within 10 s, offline or not, with the user
  signed out before the reload.
- **C4 rule 1** — a page whose first read failed writes nothing.
- **C5 the high-water mark** — `seq.at` (and `seq2.at`) never go down, and a
  reloaded page is at or past the mark and still offers every earlier list.
- **C6 totals** — single-tab cases. Two tabs of one student are known to be
  last-writer-wins on `totals`; that prints as a `~ known` line, not a
  failure.

Every failing line names the seed, the case, the family, the step, what was
expected and what was stored, and ends with its replay command:
`node tools/save-loop.mjs --seed=1 --case=4 --verbose` prints that case's
whole timeline — every write issued, landed, denied or lost, the stored
documents and every compare. `--root=DIR` runs it against another copy of
the five scripts (a fix, or a planted fault). The same seed gives the same
output byte for byte. The header of the file has the flags and the exact
rules of the fake.

Say It has no alignment to lose, unlike the fluency run. One word is on
screen at a time and the matcher **searches** the whole transcript for it
rather than walking a pointer down a list, so a filler, a false start or a
self-correction inside one utterance costs nothing: "um crab", "crab um"
and "cram crab" all match *crab*.

**On the multisyllable list only** (`join: true`), the same search closes up
a word the recogniser wrote as two. Chrome returns *upset* as "up set" and
*hubcap* as "hub cap" when it likes — its split, not the student's — so the
whole transcript with the spaces out, and each neighbouring pair, are
candidates too (the rule the one-minute run already had). It works inside
one result: "nap kin" said in a breath is *napkin*, but a pause long enough
for Chrome to finalise "nap" on its own is still a miss. That is why the
directions changed: they used to say "Say each part, then say the whole
word", with the mic live from the first sound; they now say to break the
word up in your head and say it whole.

It is off everywhere else on purpose. Those words are closed syllables, so
the parts said apart are the same sounds as the word. On the red words they
are not, and closing up would forgive the classic misreadings: "is land"
for *island*, "fat her" for *father*, "no thing" for *nothing*.

What did cost something was a final transcript with no attempt in it — a
filler on its own, a cough rendered as "uh", another student's voice. That
counted as a miss, and two of them showed the answer to a word nobody had
tried to read. `GameCore.isNonAnswer()` now excuses a transcript that is
**entirely** noise, from a closed set of non-lexical sounds (`um`, `uh`,
`er`, `hmm`, `huh`, `ah`…). Say It and Blend It both use it, and the fluency
run filters the same set out of every transcript before aligning it.

Two things keep that from forgiving real misreads. It fires only when every
token is noise — "um bled" is an attempt that got the word wrong, and
counts. And no token in the set is a word on any list, which a test checks;
"what" is deliberately excluded, since a student reading *put* as *what* has
misread it and a transcript cannot tell that from somebody asking a
question.

If a student's correct answers keep getting marked wrong, check the meter on
the mic-check screen first: a quiet input is an OS-level microphone setting
(ChromeOS → Settings → Device → Audio → Input), not something the page can fix.

### The second closed loop: sequences

`node tools/sequence-loop.mjs` answers what the save loop can't reach,
because it never opens the dashboard: when a teacher gives, changes and
removes sequences and students practise, do the dashboard and the student's
own home page **agree** about which list the student is on, which lists (and
which ways of that list, one at a time) they can play and which are finished —
with one sequence and with two — and is
that what *Sequences*, *A student's page*, *The class page* and *Saved
sequences* say? Node 22 and a Chrome (`CHROME=…`, as for the other scripts),
no dependencies, no server of your own: it serves the site itself on a free
port and runs headless Chrome under a virtual clock, so store.js's debounce
costs nothing. About 90 s for the default 56 cases on two cores.

**What is real:** the pages. `teacher.html` and `index.html` are served as
they are on disk except that their two gstatic Firebase tags become one
`tools/sequence-loop-fake.js`; each keeps its own CSP, and each runs in a
same-origin iframe of the harness page `tools/sequence-loop.html` — the
dashboard with `teacher.js`, each student's home page with `store.js` and
`practice.js`, and Student view at the address its button opens. The teacher
acts only through the dashboard's own controls, in both sections of a
student's page — Red Words and Other lists (Give Red Words, Use a saved
sequence, Copy from another student, Add a list, ▲ ▼, Take out, the percent,
Move on now, Go back to this list, Put these in order, Save, Stop using this
sequence) — and Give a sequence to N selected, whose warning it reads; every
write goes through `teacher.js`'s own batch. A student
practises through their own page's `EIStore.record`, and a student set up on
the roster before signing in meets the real sign-in wall and its button.
**What is fake:** one Firestore (merge writes, `FieldValue.delete()`,
`where`, batches, minimal rules) and one Auth, shared by every frame; `confirm`
always says yes; `window.open` is caught so Student view opens in a frame.
The fake checks itself before every batch (T1–T10), and
`--fake-fault=merge|delete|where` breaks it on purpose to show the run goes red.

The **answer key** is the README written again — it never calls
`adaptive.js`: a ledger of every answer (a word is solid in the top box with
90 % right), whole-word bars, the walk, the high-water mark, one way at a time
and the teaching order (the table under *Families and modes*, typed in again),
and each dashboard control as this README words it. After every step, for every
student:

- **S1 agree** — the Students row (Now on, Place, Red Words first, labelled)
  and the student's page (each section's rows, Now, the held line, the
  percent, the Now row's *"Open: … · Next: …"*) state the same place in each
  sequence as the key; the freshly loaded home page shows the key's open ways of
  each current list, *Lists you finished (N)* and the notice (*New list*,
  *New: Cards for …*); the dashboard's Now and Finished rows name the home page's tiles;
  Give's warning says what the key counts; and what was stored in `plan` and
  `plan2` is the plan the key expects.
- **S2 only theirs** — the home page never shows a later list, a way of the
  current list not open yet, one never given, or one taken out (unless the
  other sequence holds it).
- **S3 independent** — a step on one sequence leaves the other's stored plan
  byte for byte and its place unchanged.
- **S4 no backwards** — replaying a finished list with misses never moves a
  student back, nor does any edit but Go back or a raised percent; Go back
  holds them through practice until Move on now; a stored mark never goes down
  for the same plan. And K1 as a property of the **home page**, after every
  Save, Give and Stop: worked out from what is stored (the documents and the
  student's own marks, with the key's walk — never from the dashboard's
  draft), every list in the finished fold before is there after, and every
  current list is current or finished after; a held list stays held. Exempt
  only: Go back, a raised percent, a list taken out, and the sequence Give
  replaced or Stop removed.
- **S5 new plan, fresh start** — a sequence saved afresh has a setAt new for
  that field, and the student lands where the walk from its `at` puts them;
  Give starts each on the first list they haven't finished.
- **S6 each in its place** — `plan` holds only red lists and `plan2` none, and
  Add a list offers only its section's kind.
- **S7 before sign-in** — a roster-only student's first home page is what
  the dashboard's page for their roster row said; after they sign in, the
  dashboard's writes go to their assignment and S1 checks both sequences are
  still there.
- **S8 the preview** — Student view shows what the student's own page shows,
  and writes nothing.
- **S9 Say it in every step** — every stored step and every saved sequence
  holds its list's Say it; the home page shows the Say it tile of each current
  list once it is open (it is no longer always first); no step is walked past
  with its Say it below the bar; Say it is ticked and locked in Add a list and
  Change ways (the harness tries to untick it), with the line that says why.
- **S10 one way at a time** — every stored step and every saved sequence is in
  its family's teaching order; Add a list and Change ways show their boxes in
  it; a way the student has played never disappears from the home page while
  they are on that list (read from one page load to the next, not from the
  key's rule); and the Now row's *"Open: …"* names exactly the ways the home
  page shows of that list. The student's practice includes *touch* (a few right
  answers on each open way below the bar: played, not finished) and *slip* (a
  way at the bar, with a played way after it, drops one word below), and the
  one-sequence family usually opens with Red Words given, its first way
  finished, the next touched, then the first slipping.

Seven families (`--list`) play seeded schedules: one-sequence, two-sequences,
teacher-steps-in, re-plan, bulk, roster-first and stop. A student given Other
lists alone holds `plan2` and no `plan`; that comes about on its own. Every failing line names
the seed, case, step, expected and got, and ends with its replay command:
`node tools/sequence-loop.mjs --seed=1 --case=16 --verbose` prints that case's
whole timeline. `--root=DIR` serves another copy of the site (a fix, or a
planted fault). The same seed gives the same output byte for byte. A real site
fault the loop finds can be listed as **KNOWN** in `tools/sequence-loop.js`,
which prints `~ known` instead of failing; the list is empty. The headers of `tools/sequence-loop.mjs` and
`tools/sequence-loop.js` have the flags, the exact rules of the fake and the
checks.

### The emulator loops

The two loops above run against hand-written stand-ins for Firebase, whose
rules are far looser than `firestore.rules`. `tools/emu-loop.mjs` closes that
gap: the site's own pages, the real Firebase SDK and the real rules, against
the Firebase **emulators**. It does something through the page's own
controls and reads the result back another way.

| file | what goes in | what it is compared with |
|---|---|---|
| `tools/emu/signin.loop.mjs` | school, outside, look-alike and unverified accounts | the sign-in screen, and separately what the rules let each one read and write |
| `tools/emu/progress.loop.mjs` | flash cards rated with the real buttons, counted by the loop | the stored record, after a reload, after sign-out and in, on a second computer; the next student on the same computer |
| `tools/emu/teacher.loop.mjs` | dashboard actions: class, add, games, note, co-teacher, move, remove, archive, sequence, Student view, test student | the student's home page, the stored documents, and who else can read them |
| `tools/emu/downloads.loop.mjs` | known class data | the two spreadsheets and the backup, read back |

**It runs on GitHub only** (`.github/workflows/emulator.yml`, every push), so
nothing is installed on anyone's computer. To try a change before it is on
`main`, push it to a side branch. A failed loop puts its reason in the run's
annotations. Only Google's sign-in popup and the project id are replaced
(`tools/emu/shim.js`, `harness.mjs`); Chrome is blocked from every Firebase
and Google API address, and a loop fails if a page asks for one.

`node tools/plant-faults.mjs` plants one mistake at a time in a scratch copy
and requires the loop that should notice to go red; GitHub runs it beside the
loops. `--list` (no emulator needed) checks that each planted line still
exists. A new loop should come with a planted mistake. Two of them are the
sequence loop's (S10: a played way closing again, and steps written out of
teaching order); they need only a Chrome, so
`node tools/plant-faults.mjs --only=played-way-closes,ways-out-of-order` runs
them anywhere.

`node tools/live-check.mjs` compares every published file with the repo.
`.github/workflows/live.yml` runs it after each push to `main`.

**Never weaken a loop to make it pass.**

### The listening loop, and recording takes

Every rule above is a trade between two errors: a **false reject** (the
student read the word right and was marked wrong) and a **false accept**
(read it wrong, marked right). Until now neither rate had been measured;
each rule was reasoned. Two tools make them measurable.

**`mic-takes.html`** is a teacher-only recorder (the auth wall, then
`EIAuth.isTeacher()`; anyone else gets "This page is for teachers."). It is
linked from nowhere — open it by its address. The teacher picks a list and a
script — `right` (read each word as written) or `wrong` (each word shows a
specific misreading to say on purpose, plus four noise items: nothing, a
cough, "um", "I don't know") — and reads. For each item the page opens a
recogniser **exactly as Say It does** (`lang` en-US, `continuous`,
`interimResults`, no `maxAlternatives`, `start()` with no track) and keeps
everything Chrome sends: every result event with its time from the word
appearing, every alternative with its confidence, errors, starts and ends.
Enter moves on (the session is stopped gently, so a late final is still
caught), A records the item again. **Download takes** saves one JSON file
(`tools/mic-takes/README.md` has the schema). It writes nothing to Firestore,
and nothing leaves the computer except the file the teacher downloads. Other
settings can be recorded as named variants without touching the games:
`nbest5` (five alternatives — the site reads only the top one, so these show
whether the right word was in the list when the top guess was wrong),
`on-device` (where the browser has it) and `biased-phrases`, labelled BIASED
for the reason above. An optional audio copy of each item goes only into a
separate "with audio" download, for replaying the same reads into the
recogniser under other settings later (`start(audioTrack)`, Chrome 135+).

The misreadings come from `tools/wrong-readings.js`, by rule from the
lists' own data where a rule gives a sensible one: a blend sound dropped or
swapped (*crab* → cab, clab), a final blend cut short (*gasp* → gas), the
nonsense word's twin on the list (*sug* → sig), the oi/oy read as another
vowel (*moist* → most), a syllable dropped (*fan·tas·tic* → fantic); for the
red words a small hand table of classic misreadings (*said* → sayed,
*island* → is land), then a short vowel for a one-vowel heart, then a
look-alike red word.

**`node tools/listen-loop.mjs`** is the closed loop. It replays event streams
through the **real** engines — Say It, the cards' Listen, One minute and
Blend It, with `game-core.js`, `word-lists.js` and the lists' real configs —
in headless Chrome, one iframe per case, through a fake recogniser and a
virtual clock (`tools/listen-fake.js`, self-tested on every run). A verdict
is read off what the engine **did** — the card turning green or red, the
"say it one more time" line, the rating button the flip pulses, the
per-word result One minute reports — never by calling a matcher. Two sources:

- **Takes** — every file in `tools/mic-takes/`, replayed with its original
  timing; the script is the answer key. These are measurements.
- **A virtual reader** with a recogniser model, for coverage and for now,
  when there are no takes. Every behaviour of the model is copied from a
  passage of this README or a boot-check case (late finals, revised
  interims, homophone spellings, contractions written out, *upset* as "up
  set", a nonsense word returned as the nearest real word, a quiet read at
  low confidence, an interim that passes through the target on the way to a
  misreading's final), and fifteen **directed** reads pin the cases this
  README names. Its numbers show the engines' **logic** under the model's
  stated assumptions. They are not measurements, and the output says so.

It prints, per mode and family, false rejects and false accepts with their
denominators, then every error with the target, what was said, the stream's
key lines, what the engine did and a replay command (`--case=N --verbose`
prints the whole timeline). For takes it also says, for each false reject,
whether the target was in a lower-ranked alternative or an interim — the
evidence for or against "top guess only" and scoring on interims.

**Judging a candidate rule.** `--rule=NAME` rewrites a few lines of
`blend-game.js` in memory (no file is edited; each rewrite must match exactly
once): `final-only`, `stable-interim`, `nbest`, `conf-low`, `conf-high`,
`no-quiet-rule`, and `same`, which changes nothing and must reproduce the
base run. Run the base with `--json=base.json`, then the rule with
`--against=base.json`: every verdict that moved is ranked better or worse by
the answer key. A listening rule changes only with that before/after — on
takes when there are any.

The default run's virtual counts are pinned in
`tools/listen-loop-pinned.json`, so a change that moves any verdict turns
the check (and CI) red until it is re-pinned on purpose with `--measure`.
About 45 seconds; `--list` names the modes, families, lists, rules and fake
faults; the header of the file has the rest.

### Which part went wrong

A red ✗ tells a student they were wrong, not *which part*, and for a reader
guessing at blends or sliding off vowels that is the only part worth
knowing. `GameCore.diagnose()` lines up what the mic heard against the word
on screen, sound by sound, and names one thing:

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
read as "gas" points at the blend, and everywhere else at the dropped **p**.

It is built on `phonemeSpans()`, which is `phonemes()` with the letters kept:
each sound carries the slice of the word that spells it, so the reveal can
light up **cr** rather than say "the second phoneme". Silent letters fold
into the sound before them, so every letter belongs to something.

The first miss doesn't get any of this — just "I heard: *bred*", because the
student is about to retry and an unasked-for hint slows that down. The
reveal is where it lands: the letters turn gold, the message appears under
the word, and with **Voice** on it is read out as one sentence after the
word ("The word was, crab. Look at the blend, cr."). That costs 700 ms of
extra reveal time, spent only when a voice is saying it.

The end screen's missed-word chips carry the kind of error too, so a round
that went wrong in four different ways looks different from one that went
wrong the same way four times.

### Scoring

Each correct word is worth 10 points times a **combo multiplier** driven by
the streak: ×1 to start, ×2 from a streak of 5, ×3 from 10 up (capped
there). Every 5th in a row is a milestone — +25 bonus, a "🔥 N in a row!"
banner, confetti, a fanfare, and the runner's boost animation. A wrong
answer or a Skip resets the streak and multiplier; a "×2 combo!" badge under
the Streak stat shows the tier. The end screen adds a **0–3 star rating** (3
at 90 %+, 2 at 70 %+, 1 at 50 %+) and a "Perfect round!" when every word was
said right. The scoring math is a pure function (`Core.pointsFor()` in
`game-core.js`) covered by `tests.html`.

### Correct/wrong feedback

Right and wrong answers are shown visually — a green "✓ +10" or red "✗"
pop-up over the word, plus a matching glow on the card and colored status
text — so nothing depends on the student hearing anything.

The **Voice** button (default **Off**, remembered per device like the other
settings) turns on a short spoken coach on top of that: quick praise on a
correct answer ("Nice!", "Got it!"…, with a bigger call-out every 5-streak),
and the word spoken aloud after the second miss. Press **H** any time during
play to hear the current word read slower — same as clicking "Hear it" —
regardless of the Voice setting. All speech picks the best available
`en-US` voice (`Core.voice` in `game-core.js`), preferring Chrome/ChromeOS's
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
working for it. It began as a red-word game, for words the decoding rules lie
about; every list can be played this way now, because reading a decodable
word without stopping to decode it is what makes reading fluent. Whether the
student knew the word on sight only the student can answer, so the game asks
them:

1. The word shows on a card. The student reads it out loud.
2. They flip it (Space, or click the card). **Only now** is the word spoken —
   hearing it first would hand over the answer and turn the drill into
   repeat-after-me.
3. They rate themselves: **Got it** (`1`) or **Not yet** (`2`).

No mic and no typing, so it works in a loud room and on a Chromebook with a
dead microphone. It's also the only engine that doesn't need
`speechSynthesis` — without it the cards still work, minus the read-aloud
check, so the start screen warns instead of disabling Start.

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
two decks of its own: a random **Mixed** 20 from everything (re-drawn every
round) and one **All words** deck. The last-picked list is remembered per
device. A single `words:` array works too — the picker then never appears.
Deck lists are deduplicated per round, because printed word lists repeat
words across lists on purpose.

`cards-game.html` serves every family's cards mode, taking the list from
`?list=`. Two config keys are worth knowing:

- `speak: false` — the flip shows the word without pronouncing it. The
  nonsense-word list needs this: a synthesiser handed "vab" guesses, wrong
  often enough to teach the wrong answer. Directions are still read aloud;
  only the word itself goes quiet, and the "Hear it again" button with it.
- Syllable-dotted entries (`fan·tas·tic`) show plain on the front — the
  student has to read it cold — and chunked on the back, where the split
  earns its keep. The plain word is what gets spoken, rated and stored.

The ten red-word lists live in `data/red-words.md` as the source of
record; the arrays in `word-lists.js` are that file transcribed, so
corrections belong in both.

Scoring, streaks, stars, the missed-word list and the comeback deck all match
the other two engines exactly. A skipped card counts as missed, and ending a
round early scores only the cards actually seen.

One thing to know as a teacher: the score is a **self-rating**, so it
measures honesty as much as reading. That's the trade the format makes —
nothing can listen to a student read "Wednesday" and tell you they knew it
on sight rather than worked it out. The start screen asks for honesty
directly, and the payoff is framed as the deck shrinking, not the score
rising.

## Matching game

> Same arrangement as the flash cards: `match-game.html` plays the one
> list `?list=` names, through `practice.js`, and reports first-try picks
> to the student's record. Its comeback deck is separate from the cards'
> on purpose — they're different skills.

`match-game.js` is the checked counterpart to the flash cards: the computer
says a word and the student picks the printed word that matches, out of six.
Same skill, but the game knows whether they were right instead of taking
their word for it. Mic-free, so it works in a loud room.

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
work exactly as in `card-game.js` — both reach the same code in
`game-core.js`. Two tries per word: a wrong tile greys out and stays on
screen (so the retry narrows the field instead of being a coin flip), and a
second miss gilds the right one and says it slowly. Only a first-try pick
clears a word from the comeback deck.

### Picking the wrong answers

The whole difficulty of the game is in **which wrong words it shows**. Six
random words off the list can be beaten without reading — the first letter
is enough. So `nearestWords()` ranks the list by how confusable each word is
with the target (edit distance, then shared opening letters, then length),
and the tiles come from the top of that ranking. For red words that gives
exactly the sets students really mix up: `should` with could/would/said,
`through` with though/although/enough, `there` with where/here/were. Getting
it right means reading to the end of the word.

Pushed all the way, the same idea breaks the game: the most confusable word
of all is a **homophone**, and no amount of listening separates "to" from
"two". Any word list with a homophone pair needs both guards:

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

This is not hypothetical for the red-word lists: `to`/`two` are both on
List 1 and `there`/`their` both on List 2, so without the guards the very
first list deals unanswerable items. `tests.html` draws every word of those
two lists 40 times over and fails if any tile set holds two words that sound
alike.

Distractors normally come from the round's own list, so the wrong answers are
words the student is working on. A round too short to fill its tiles (a
three-word comeback deck) widens to the whole word list.

`match-game.html` serves every family's Match It mode except the nonsense
words, which have none — the game works by *saying* the word, and there is
no reliable way to say a word that isn't one. Syllable dots are stripped
on the way in: a dotted tile would both give the split away and mark that
tile out from its distractors.

Cards and Match It on the same list keep **separate** ids, stats and
comeback decks, on purpose: knowing a word on sight and picking it out of
five look-alikes are different days' work.

### Words in context

Once a word is solid on its own, the next question is whether it survives a
sentence — where a word actually gets read, and where a student who has
memorised a shape rather than a word comes unstuck. On lists that carry
sentences (the red words and oi/oy), **one card in three** shows a mastered
word inside its sentence on the front, the word in full weight and the rest
muted. The back is the word alone: the sentence was the question.

Three gates, all deliberate. The word must already be solid to the
scheduler, so this reads as a step up, not the game getting harder; the
counter advances only on cards that *could* have shown a sentence, so "one
in three" means one in three of those; and the speed round is exempt, being
about reading one word fast.

The bold lands on the word and nowhere else — a word-boundary match, so
"one" doesn't light up inside "money", and case-insensitive, so a
sentence-initial "The" still matches "the". A test walks every sentence a
card can show and checks the word is actually in it.

### Listen (optional)

Off by default and remembered per device, like Shuffle and Voice. With it
on, the mic keeps whatever the student said while the card was face up; on
the flip the back shows "I heard: *could*" and **pulses** the rating button
it thinks is right. The student still presses one — the self-rating is still
the score, and a pre-pressed suggestion would quietly take the game over. No
transcript means no line and no pulse: an empty mic looks exactly like
Listen off.

Turning it on is where Chrome asks for the microphone, so the prompt
happens on the start screen, not mid-card. A blocked mic snaps the toggle
back to Off with the same message Say It gives, and the cards carry on.

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
deliberately **not** a refactor of Say It's loop. That one is the whole game:
it holds the mic open for a round, mutes around every beep and utterance, and
its hold lengths were tuned by ear against a room of Chromebooks. The cards
want something much smaller, and touching a tuned thing to serve a second
caller is how it stops being tuned. The mic is stopped before the card
speaks, so the recogniser can never transcribe the computer's own read back
as the student's answer.

## One minute (word-list rate)

Every other mode asks whether a student knows a word. This one asks how
fast, which stays worth asking long after accuracy has stopped moving: a
student can be right about *would* every time and still take three seconds.

`fluency-game.js` + `fluency-game.html`: the word list in rows of five,
sixty seconds, the deck cycling so a fast reader never runs out. Space
skips. Score: **correct words per minute**, plus the delta since last time,
which is the reason to do it twice. Offered on the nonsense words only
(retired on the two blends families; see *Retired modes*).

It is called a rate rather than *fluency* on purpose. A list of words
measures **automaticity of word recognition** — whether a word comes back
without effort — a real construct, the one timed word-list tests like TOWRE
assess. It cannot measure prosody, phrasing, or holding meaning across a
sentence, which exist only in connected text. A passage also hands a weak
decoder context to lean on and a list takes that away, which is the point
here and why a good rate on this list is not evidence a paragraph goes well.
Passage reading wants its own probe.

The clock starts on the **first word actually read**, not on the button: a
student fumbling with headphones for four seconds has not been reading for
four seconds. And the run is scored over the minute it was given even if
the student presses Done early — the number means "words in a minute", and
a forty-second run that stopped early is not a faster reader.

### Following a reader

`consume()` (pure, in `tests.html`) walks a transcript's tokens against the
words still to be read. The obvious rule — every token answers the current
word, right or wrong — fails in a way that took a while to see: one **extra**
token knocks the alignment out for the rest of the run. Say "um" at word
three and "um" eats *golf*, then "golf" is judged against *honk*, and every
word after reads as wrong. The student never resyncs, because they're
reading straight down a fixed list. A reader who hesitated once ended the
minute at nought — and hesitating is what the students this measures do.

So a token that doesn't match the current word isn't automatically a
misread. Five rules decide, in order:

1. It matches the word **just read** — a repeat. Saying a word twice is not
   an error and must never cost the next word.
2. **Joined to the next token** it matches the word we're on — the
   recogniser split one word in two ("hubcap" comes back as "hub cap"),
   which is its mistake, not the student's.
3. One of the next couple of tokens matches the word we're on, so this one
   was **noise** — a filler, half a self-correction — and the real read is
   coming. Drop the token, hold the pointer.
4. It matches the **next** word — the student skipped the one we're on.
   Mark that one wrong and judge this token against the next. This is the
   mirror of rule 3: a *missing* token must not knock the run out of step
   any more than an extra one does.
5. Otherwise it's a **misread**: mark it wrong and move on.

Rule 3 needs to see two tokens after this one before it can rule the
possibility out, so until those arrive the decision is *held* rather than
guessed; `flush` forces one when the recogniser finalises, which keeps the
pointer honest across the gap between utterances. The forgiving rules only
fire when a *later* token matches the word we're on — the signature of
noise — so a wrong word followed by the next right word is still a misread
and still counts. Three fillers in a row is past what a two-token window
can tell from a run of misreads; that limit is pinned by a test rather than
chased, because widening the window until nothing desyncs is the same as
forgiving every misread.

Interim results drive the pointer, not just finals — a reader at sixty words
a minute is four words past whatever the recogniser is still thinking about,
and waiting would leave the highlight hopelessly behind. But an interim is a
guess Chrome keeps **revising**: "cost" becomes "cast" a beat later. So each
result is scored from a snapshot of the run taken before it was first seen,
and a revision rolls back to that snapshot and rescores from scratch. Nothing
reaches the scheduler until the result goes final: a stat write can't be
rolled back, and reporting a word wrong on a guess about to be withdrawn is
worse than reporting it a moment late.

That path is the one mic behaviour that *can* be tested headlessly, and
`tools/boot-check.sh` does: a fake recogniser emits a bad interim and then
the corrected final, and the run has to end with three words right and no
errors.

Stars are the usual three tiers against a target rate: **60 CWPM** for real
words, **40** for the nonsense list, with two stars at 70 % of that and one
at 50 %.

> **Connected text is deliberately not here.** An earlier build had a
> second mode, *Read it*, with eight hand-written passages whose every word
> came off a list the student had been taught. It was removed: this is a
> word-practice site, and the vocabulary rule that kept the passages honest
> also made them read like nothing anybody would write. If reading a
> paragraph is wanted later, it wants real prose and a different answer to
> "which words are allowed", not the one that was here.

### What gets stored

`students/{uid}.fluency[listId]` is a list of `{at, cwpm, errors, n}`,
oldest first, capped at **30** — a term of weekly reads, and a few
kilobytes. It is not a stat: a rate belongs to a run, not to a word, and
nothing in the scheduler reads it. The tail makes the dashboard's
sparkline; a single latest number would say nothing about whether anything
is changing.

**A run the mic wasn't there for isn't stored.** If the connection dropped
at any point in the minute, or the recogniser heard nothing at all, the end
screen shows what happened and says the run wasn't saved — no rate, no
round, no "since last time". A dropped connection isn't a slower reader,
and saving it would put a cliff in the trend line. Driven in
`tools/boot-check.html` (`fluency-net`, `fluency-silent`, `fluency-saved`).

The student page draws one inline-SVG sparkline per fluency list (no
library, no axes, no labels — the question is "is this going up", and the
latest and best are printed beside it), and the roster CSV gains a
*latest*/*best* pair of columns for each fluency list somebody has actually
read.

## Phoneme clips

A synthesiser will not say an isolated /b/. Asked for one it says **"buh"** —
and a word sounded out as "buh-a-tuh" does not blend into "bat". That is the
most common thing a struggling reader has been taught wrong, and they have
done it faithfully for years.

So the sounds come from files. `audio/ph/<TOKEN>.mp3`, one per token
`phonemes()` can emit (37 of them), made by `tools/make-phonemes.sh` out of
espeak-ng's phoneme input — the one way to get a synthesiser to say a sound
in isolation. Stops (b d g k p t) have no sound at all without a release, so
they get a tiny schwa trimmed back to the burst: the closest a machine gets
to a pure /b/ without "buh". **/r/ and /j/** get the same treatment for a
different reason: espeak renders either alone as pure silence, and for a
while `R.mp3` and `J.mp3` were two identical empty files — Blend It played
*crab* as /k/ … /a/ /b/. They are built from the sound plus a schwa, trimmed
back to the sound. The script now exits with an error naming any clip that
peaks below −40 dB, and `tools/boot-check.sh` reports a clip too small to
hold a sound. The script is build-time only; the clips are committed, and
nothing on the site needs it.

`GameCore.phonemeAudio()` fetches `audio/ph/manifest.json` once per page and
resolves to a player — `play(tokens, gapMs)`, `has()`, `estimate()`,
`cancel()` — or to **null**. Null is the feature switch: without the folder,
everything built on it hides rather than playing silence at a student. `x`
and `qu` stay single tokens everywhere else (the distance arithmetic depends
on it) and are expanded to two clips only here.

Playing goes through the same microphone hold the spoken coach uses, so the
recogniser never transcribes the computer's own sounds as the student's.

### Blend It

A mode that starts from **sound** rather than letters, and the only one that
can. The student hears /k/ /r/ /a/ /b/ spread 700 ms apart, then 250 ms
apart, then says the word. The word is not on screen until they have had
their go — phonological blending with nothing to read off, the sub-skill
every printed list has to assume.

Dots under the prompt show how many sounds are coming, worth knowing before
trying to blend them. On the second miss the sounds play once more and **the
letters light up with them**, in order, using `phonemeSpans` — *that* sound
is spelled by *those* letters, the join the whole game exists to make. Then
the whole word, spoken; nothing for the nonsense list, where a synthesiser
handed "vab" says "verb".

Offered on the nonsense words only (retired on the two blends families;
see *Retired modes*). `blend-it-game.js` + `blend-it-game.html`.

### Tap to hear

The back of a flash card and Say It's reveal are pressable where the clips
exist: each syllable on a dotted word, each sound on a one-syllable one.
Press one and it plays itself, then the whole word — a part is only useful
next to the thing it is part of.

A student who has been told a word twice and still can't read it usually
can't hear *which part* is going wrong. Pressing "tas" and hearing /t/ /a/
/s/ answers that without anyone explaining.

**Not on the red words.** `tapPieces` and `diagnose()` both stand on
`phonemes()`, a set of regular spelling rules — and the red words are the
ones the rules get wrong. By rule *said* is S·EY·D, so pressing the back of
that card played "sayed", beside the red letters marking exactly the part
that can't be sounded out; *one* played as "own". The red family sets
`config: { irregular: true }`: the cards show the heart letters with nothing
to press and Say It reveals the word without naming a part (so those misses
carry no error kind to the dashboard — an encoder's guess is worse than a
blank). Bringing the taps back means hand-written sounds per word, as the
heart letters are hand-marked.

Press-only on purpose (`tabindex="-1"`): these sit inside games where 1 and 2
are the answer keys, and a tab stop on every syllable would put a dozen new
stops between the student and the button they need.

## Sound boxes, splitting and hearing yourself

Three smaller things, each aimed at a sub-skill the other modes step over.

### Sound boxes (oi/oy spelling)

One input per **sound**, not per word. "coin" is three sounds and four
letters, and a student who puts one letter in each box has already found
what they would get wrong. Typing auto-advances when a box is as long as the
sound it holds — that length is the scaffold, as the width of a drawn box is
on paper — and Backspace out of an empty box goes back.

The first miss marks the wrong boxes red and says how many; the student types
over them. The second fills those boxes in gold and leaves the right ones
alone, so they see their own spelling with the missing piece dropped in, not
the answer handed over whole. When exactly **one** box is wrong there is a
single thing to point at, so `diagnose()` says what it is and the voice reads
it after the word; two or more and it says nothing rather than guess.

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
time. "🎙 Hear yourself" plays the last few seconds back, then reads the word
properly: the comparison the button exists for. There is no arguing with the
recording.

**In memory only.** The clip is a blob URL, alive only while its card is on
screen and revoked when the next arrives. Nothing is stored or uploaded: a
recording of a fifteen-year-old struggling to read is not a thing to keep,
and the moment it is kept somebody has to decide who may hear it.

Feature-detected (`MediaRecorder`), and only enabled where the microphone
prompt has already been answered — after Say It's mic check, or when the
cards' Listen toggle is switched on. It never causes a prompt of its own,
and where there is no permission the button never appears.

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

Only **first-try** answers count as right. Getting a word after being told it
isn't knowing it — the rule the comeback deck already used. A miss drops a
word one box rather than resetting it: resetting is the textbook Leitner
move and turns one fumble into a week of seeing that word every session.

### Speed

A word decoded in three seconds is not a sight word, however reliably it
comes back right. The flash cards time the flip (`performance.now()` when
the card lands, again when it turns) and pass the milliseconds with the
rating; the other engines can't measure anything meaningful per word — a mic
answer's clock includes the recogniser and a typed one the typing — and
don't pass it. (The one-minute run measures speed differently: correct words
per minute across the run, kept in its own `fluency` record, not as a
per-word `lat`.)

The stat gains `lat`, a running average of how long a **correct** answer took.
Wrong answers aren't timed: that clock measures how long a student stared at
a word they didn't know. Over `SLOW_MS` (2.5 s) a word counts as slow and the
scheduler weights it ×1.5, so it keeps coming round after its accuracy has
stopped moving.

What slow does **not** do is change `isMastered`. The student's tile says "12
of 20 solid", and that number must not drop the day the cards learn to use a
stopwatch — nothing about their reading changed. Speed is the scheduler's
business and the teacher's: the dashboard's per-list breakdown reads "12 / 20
(4 slow)", and a sequence counts a word as finished only when it is solid *and*
at pace (`Adaptive.listSolid`), so nobody advances on thirty words they can
decode but not read.

On the card, a flip under 1.5 s earns a "⚡ fast" pill and the end screen
counts them. There is deliberately no slow pill: "you were quick" is worth
saying aloud, while "you were slow" the scheduler acts on quietly, because
being told would make the next card slower.

A list with at least eight solid words also offers a **⚡ Speed round** on the
start screen — only words the student already owns, the cards flipping
themselves after two seconds so there is no waiting the clock out. Useless
as practice; the only thing on the site that asks whether a word can be read
without thinking about it.

Never-practiced words sit at a flat weight of 3.0, between "solid" and
"shaky", so new material keeps flowing without crowding out what's failing.
"Play again" redraws — the words missed a minute ago are now the likeliest
picks.

Stats are stored per **list and word** (`"<listId>|<word>"`), not per word:
"coin" in the reading game and "coin" in the spelling game are different
skills, and a student can be fluent at one while failing the other.

## Per-student tracking

`store.js` keeps one document per student at `students/{uid}` — the
per-word stats, lifetime totals, and a short tail of finished rounds. Two
rules in that file matter before touching it:

- **A failed read is not an empty record.** If the load fails (blocked
  network, offline Chromebook) every local map is empty, which is
  indistinguishable from a brand-new student. Writing then would overwrite
  a term of practice with nothing, so a failed load latches and holds back
  every write until a reload succeeds.
- **Writes are debounced and must be flushed before sign-out.** A save
  goes 1.2 s after the last answer, but never more than 5 s after the first
  unsent one: a student clicking through Match it or the cards faster than
  1.2 s an answer would otherwise put the save off until the round ended,
  and a stalled network or a closed tab before then would take the whole
  run with it. The round that ends with a student clicking "Sign out" is
  exactly the round most likely to be lost. Sign-out waits for that flush,
  but for four seconds at most (the button reads "Signing out…" meanwhile):
  Firestore's write never settles on a stalled network, and a sign-out that
  hangs leaves the next student on the Chromebook in the last one's
  account, which is worse than losing one save. The store also flushes when
  the page is hidden or closed (`pagehide`, or `visibilitychange` to
  hidden), so the answers from the last second before a closed tab or lid
  aren't lost to the debounce. Each write is handed to Firestore the moment
  it is made, even with an earlier one still waiting for its reply: the SDK
  already sends one client's writes in order, and waiting for the reply
  first meant a tab that closed in the meantime never sent its last save.

There's also a per-device mirror in `localStorage`, scoped by uid so a
shared Chromebook can't leak one student's deck into the next student's
session. It keeps word selection sensible if the network drops mid-round;
it is never merged back up.

The document also carries a `seq` — a student's high-water mark through a
teacher's sequence, written by their own browser (see *Sequences*) — and,
for a student with two sequences, `seq2`, the same thing for the one stored
as `plan2`.

The document also carries a `heard` map: for each word Say It marked wrong,
the last **five** transcripts the recogniser returned, cleaned (lowercase,
letters/digits/apostrophe/space, 40 characters) and deduplicated. It is
evidence, not a score — nothing in the scheduler reads it. A word that keeps
coming back as "bread" is a reading error worth a lesson; a word that comes
back as three spellings of itself is the recogniser failing and wants a
line in `ACCEPT` instead. The shape lives in `adaptive.js` (`cleanHeard`,
`pushHeard`, `sanitizeHeard`) beside `sanitizeStats`, because the student's
store and the teacher's dashboard both have to agree about it. Both
sanitize on the way in: the document is hand-editable and outlives any
change to this repo.

## Teacher dashboard

`teacher.html` — for teachers only (see *Classes, teachers and the admin*
above), with a link on the home page for those accounts. Each teacher's
dashboard holds the students in the classes they teach; the admin's holds
every class.

### The console

The layout *and the look* are ported from the guitar-class site's teacher
console: light plum by default, the same palette in dark plum when the
computer is set to dark (`prefers-color-scheme`), Fraunces for titles. It is
deliberately nothing like the student pages (dark navy and gold), so a
teacher can tell at a glance which side of the site they are on.

- **Where the colours live.** In `teacher.css`, as tokens redefined on
  `body.teacher` (light) and in a `prefers-color-scheme: dark` block for the
  same selector — not in `site.css`, which serves every student page and must
  not change. Because the sign-in wall, the user chip and the dialogs are
  children of `<body>`, they take the console's palette too. The tokens
  that have no `site.css` counterpart (`--brand`, `--sel-*`, `--warn`,
  `--info`, `--tint`, `--scrim`) exist because the old single gold did three
  jobs — *selected*, *main button*, *accent text* — and a fourth, *warning*;
  each now has its own colour, so a warning does not turn plum with the
  accent. `site.css` still hard-codes dark text on its gold `.btn`, so
  `teacher.css` restates the button here (the white Google sign-in button on
  the wall is left alone).
- **The type is the console's own.** System sans for text, self-hosted
  Fraunces (`fonts/fraunces.woff2`, `FRAUNCES-OFL.txt`) for the title, panel
  headings and the brand. A student's *Reading view* choice is made on a
  shared computer and `game-core.js` applies it to every page; the dashboard
  sets its own face and puts letter- and word-spacing back, so a student's
  setting never restyles it.
- **A plum bar across the top** holds the brand ("English Intensive", a link
  back to the games) at the left and the signed-in chip at the right.
  `auth.js` fills any element with `id="ei-user-chip"` and does not pin it
  to the corner, so the bar hosts the chip and nothing needs padding to
  avoid it. The sidebar sticks below the bar.
- **A grouped sidebar** (216px, sticky, scrolls on its own): small uppercase
  group headings and icon + label items (16px stroke SVGs, inline, so no
  icon font and no request), the current one on the *selected* colour.
  Below 900px it becomes one strip that scrolls sideways under the bar,
  the group headings dropped. The groups:
  - *Students* — **Students**, **Trouble spots**
  - *Assign* — **Saved sequences**
  - *Set up* — **Classes**, **Manage**
- **A slim top bar**: the view's title and a one-line subtitle on the
  left; on the right the **class filter**, **Refresh** and **Student
  view**.
- **The class filter is the page's, not a view's.** A segmented control
  — *All*, each of my classes somebody is in, and *No class (n)*, which
  disappears at zero — that the Students table, its cards and Trouble
  spots all follow. It is remembered
  in `localStorage` (`ei.class.filter`), and a filter that matches nobody
  — a class since emptied or deleted, a stale key — **falls back to All**
  (`effectiveFilter()`) rather than drawing an empty page under a button
  that claims otherwise. It replaced three per-view period selects.
  Classes and Manage hide it: it means nothing there.
- **Refresh** re-runs `loadAll()` and draws the current view again with no
  page reload, so the open student, the filter and the Manage section all
  hold. With unsaved board edits it asks first, exactly as leaving the
  board does.
- **Student view** opens a small chooser (defaulting to the student whose
  page is open), then `index.html?preview=<uid | roster:email>` in a new
  tab — see *Previewing a student* below.

The views:

- **Students** — one calm row per student (*The class page*, below): the
  list they are on, a bar toward finishing it, their place in their
  sequence, and at most one line saying what needs a teacher. Four **summary
  cards**, all counts of students and all inside the filter. Tick rows and
  **Give a sequence to N selected…** to put several students on one. Two CSV
  exports live here too. On an empty class the view is a three-step *Get
  started*. Under the table, the **Test student** panel (*The test student*,
  below) — a student of the teacher's own to try things on, kept out of every
  count here.
- **Trouble spots** — the same words aggregated across the class, sorted
  by *how many students* are struggling with each rather than by raw
  accuracy, so one student's bad day doesn't top the list. This is the
  "what do I reteach tomorrow" view.
- **Saved sequences** — the sequences kept for each class: rename, delete.
  *Saved sequences*, below.
- **Classes** — roster import (into a class — see above), a card per class
  with its size and teachers (add a co-teacher from the approved list,
  remove one while more than one is left, rename, delete when empty),
  *Create class*, and a *Who's in which class* table that moves a student
  as soon as you pick. A class decides who sees a student, never what the
  student sees.
- **Manage** — one page, one section at a time behind a row of tabs: a
  real `role="tablist"` (arrows, Home and End move between tabs), the open
  one remembered in `localStorage` (`ei.manage.section`).
  - **Archived** — every archived student, with *Unarchive* and *Open*.
  - **Backup** — one JSON file of everything this account can read,
    fetched fresh from the database rather than from the page (which has
    sanitized and folded it): the teacher's roster rows, assignments,
    notes, students' docs and class docs of every class they teach, and
    the teachers list; for the admin, every collection including the old
    `config/class`. Named
    `english-intensive-backup-YYYY-MM-DD.json`. There is no restore, on
    purpose: putting data back is a decision for a person in the console.
  - **Teachers** — admin only, and absent entirely for anyone else: each
    site teacher with their classes and student count, add by @seq.org
    address and name, and remove (refused while they're the only teacher
    on a class; otherwise it deletes their `teachers/` doc and takes them
    off every class — nothing else is deleted).

### Archive

An archived student is **hidden from every view and deleted from
nothing**: the table, the cards, Trouble
spots. They keep practising whatever they were given. The flag is on the
CLASS, shared by its co-teachers: `classes/{id}.archived` as
`{<key>: true}`, keyed by the id the
page uses — the uid, or `roster:<email>` before they've signed in — and
both keys are checked, so a student archived while pending stays archived
once they sign in. Unarchive writes `false` (a set-merge can't delete a
map key without `FieldValue`, and `false` reads the same). In `teacher.js`
`students` is the class with them taken out and `everyone` still has them,
for the lookups a hidden row must not fool: whether an address has signed
in, how big a class is (a class of archived students is not empty), a
co-teacher rewrite.

### Previewing a student

`index.html?preview=<id>` is the home page as one student sees it. Only a
**teacher** gets it (`EIAuth.isTeacher()`; anyone else's `?preview=` is
ignored): `store.js` loads that student's `students/{uid}`, assignment and
roster row — all readable by their teacher — so `myLists()` returns the
student's effective lists and the tiles carry the student's progress. A
one-line banner says *"Previewing Ana's games — nothing you play here is
saved to them."*, and **nothing is written**: while `preview` is set every
save path in `store.js` is a no-op, including the teacher's own doc and the
local mirror. A tile still opens the game page, which has no `?preview` and
so plays as the teacher, saving only to the teacher's own record — which is
what the banner promises.

### The test student

A teacher can try the whole site — give a list, give a sequence, play it,
watch the dashboard follow — without touching a real class. The **Test
student** panel sits under the Students table (and under *Get started* when
a teacher has no students yet): *Add a test student*, then *Open their page*
and *Play as test student*.

**It is the teacher's own account.** Nothing else could work without a
rules change: a student writes only their own `students/{uid}`, so a made-up
uid could never accumulate practice, and a roster-row ("pending") student
can only be previewed, read-only. The teacher's own uid already has a
`students/{uid}` they may write, an `assignments/{uid}` they may write for
anyone, and no new collection is involved — **`firestore.rules` did not
change**, so there is nothing to re-publish.

**What marks it** is `test: true` on the teacher's own `assignments/{uid}`.
That document carries its lists and sequence like anyone's, plus the class
stamp the rules want on every write (`addTestStudent()`: the first class
the teacher teaches by name, or a class called *Test class* made on the
spot for a teacher with none; empty `lists` only when there was no
assignment already, so adding never clobbers one). `buildTestStudent()`
turns that doc and the teacher's own student doc into a student; the
dashboard names it *Test student* whatever the account is called.

**It is in no list.** It is not in `students` or `everyone`, and every
count, table, class filter, Trouble spots, both CSVs and each class's size
are made from those two, so none of them can include it and none had to be
taught to leave it out. `studentByUid()` falls back to it, which is all its
own page (the sequence editor, the numbers, notes) needs: `positionOf`,
`planFor`, `saveSeq` and `notePanelHtml` all reach a student through it. Its
page drops the Class, Roster-row and Archive panels — there is nothing to
move, import or hide — and gains a strip with *Play as*, *Reset practice*
and *Remove*. A class that holds it shows "· your test student" and has no
Delete button (a class counts as empty without it, and deleting one under
it would strand it); `restampBody()` includes its assignment when that
class's teachers change. Self-heal (`healBody`) does not reach it — it
works from `raw.students`, which leaves teachers out. Taking *yourself* off
the class that holds it removes the test student first (`dropTestStudent()`),
because afterwards the rules would no longer let you write it; add one again
when you are on a class. If a *co-teacher* takes you off, or deletes the
class, it is left holding a stamp you can't write with: its page opens but
saving a list is refused, and *Remove* is the way out (it needs only that your
address is still on the document).

**Play as test student** opens `index.html?as=test`. `store.js` turns that,
for a teacher, into a flag in `sessionStorage` (`ei.asTest`) — per tab, so
the teacher's other tabs stay the teacher's and closing the tab ends it, and
it holds across home → game → home, none of which carry the address.
`seesEverything()` is then false, so `myLists()`, `plan()` and `settle()`
are exactly a student's and a sequence moves (and writes its `seq` mark, or
`seq2` for Other lists).
Unlike a preview it **writes**: plays are saved to the teacher's own
`students/{uid}`, which *is* the test student's practice. A thin strip
(`#ei-testbar`, in `practice.js` so every game page gets it) says so and
holds *Back to teacher view*, which flushes the last round before leaving.
It is pinned to the top, the body is padded down by its height
(`site.css` is border-box, so a `height:100%` body shrinks its content
rather than scrolling), and the games' fixed Home link and account chip
move down with it (`--ei-strip-h`). Two other places were tried and failed
on the game pages: a floating pill and a bottom strip both covered Start and
Shuffle, and a strip in the flow became a box beside the game, because those
pages' `<body>` is a centred flex row.

**Reset** (`resetBody()`) deletes `words`, `heard`, `fluency`, `seq` and
`seq2` from the teacher's own student doc, zeroes the totals, and clears the
device's mirror, "new list" notes and missed-word piles (`eiStats:<uid>`,
`ei.plan.seen:<uid>`, `ei.plan.seen2:<uid>`,
`blend|card|matchComeback:<uid>:*`); the lists and sequences stay. **Remove** does that and then deletes the
assignment — and the note only when there is one, because the rules error on
deleting a document that doesn't exist (there is no `resource` to check).
Both write a clear note beside the buttons and leave the panel as it was on
failure.

The admin's load reads every teacher's assignments, so other teachers'
test-student documents are present on the admin's page; only the one for
the admin's own uid is ever looked up.

### One rule: a student sees what they were given

There is no class default, no period list, no course, and no "everything
when nothing is set". Each student has exactly one set of lists — their
own — and that set is what their home page shows. It is still one level
with no inheritance, but the set is no longer always fixed: a student the
teacher gave a **sequence** (see *Sequences*, next) is shown the list they
are on — in each sequence, if they have two — and that moves with their
progress. Without a sequence,
`EIStore.effectiveLists` is the whole rule: the student's `assignments/{uid}`
lists, else the lists on their roster row (set on the dashboard before they
had signed in), else nothing. Sequences come from the same one document
(`Adaptive.plansOf`, *Sequences*): the assignment when it has a `lists` array
or either plan, otherwise the roster row.

This replaced a precedence walk (own → roster → period course → period list →
class default → everything) with inherited cells drawn dashed, copy-on-write
edits and an *own ↺* button to hand a student back to their group. All of it
was correct and all of it needed explaining. With one level there is nothing
to inherit: a student's page and their row on the Students table are what
that student sees, and "who has nothing" — the only question the old default
answered — is asked out loud (the *No lists yet* card and pill).

### Sequences

A teacher can give a student their lists **in order** instead of all at once.
The student works on one list, and meets its ways of playing **one at a time**,
in the family's teaching order (*One way at a time*, below); when they have
finished the list, the next one replaces it on their home page. Finished lists
move to one closed fold, *"Lists you finished (N)"*, where they stay playable,
every way, and keep their stats; lists the student has not reached, and ways
of their list not yet open, are not shown at all — no locks, no "coming soon".
Four strings are the only new words a student sees: that fold's title, *"New
list: Red Words · List 3."* (the first time the home page loads after they
moved on), *"New: Cards for Blend Words."* (the first time it shows a way that
opened on the list they were already on; two at once: *"New: Cards and Say it
for Red Words · List 3."*) and *"You finished all your lists. Ask your teacher
what comes next."*

**Red Words and Other lists.** A student has at most two sequences, named by
what they hold: **Red Words** (the red-word lists, and nothing else) and
**Other lists** (every other family — Starting Blends, Blend Words, oi / oy,
Multisyllable, Nonsense Words, …). The curriculum already decides which list
goes where (the teacher: *"the red lists are themselves a sequence … the other
lists are the ones that can be assigned in an order"*). Either can be there
without the other, and each moves on by itself.

The home page shows the list they are on in each, in the usual sections, and
**one** fold, *"Lists you finished (N)"*, for the finished lists of both; N
counts both. The notice says *"New list: …"* once for each sequence that moved
since the last load (one short sentence each), and *"You finished all your
lists…"* only when **every** sequence they have is finished: one finished
beside one still going says nothing, and the list still going is simply there.
`EIStore.plan()` gives the home page `{ uid, current, finishedIds,
finishedCount, finished, sequences: [...] }`: the first five across both
(`finished` only when all are; `current` is the open ways of each current
list), and one entry per sequence with its `which` (0 Red Words, 1 Other
lists), `setAt`, `index`, `count`, `finished`, `hold`, `current`, `finishedIds`
and `finishedCount`. The notes behind *"New list"* and *"New: …"* are kept per
sequence (`ei.plan.seen:<uid>` for Red Words, `ei.plan.seen2:<uid>` for Other
lists) as `{ setAt, index, open }`: `open` is every way the page has shown on
that list, so a way that was shown, hid again and came back is not announced
twice. A teacher previewing reads and writes neither.

**What is stored.** Each in its own fixed field of `assignments/{uid}` — or of
`roster/{email}` for a student who has not signed in — next to `lists`:

    plan    Red Words     its mark: students/{uid}.seq
    plan2   Other lists   its mark: students/{uid}.seq2

Both have one shape:

    {
      steps: [ { ids: ["red-1-cards", "red-1-say"] }, { ids: ["red-2-cards", "red-2-say"] } ],
      bar:   0.9,    // 0.5 to 1 in steps of 0.05
      at:    0,      // the step the teacher last set as current (0-based);
                     // the number of steps means past the end: finished every list
      hold:  false,  // true: stay on `at` until the teacher moves them
      setAt: 1795563000000   // Date.now() when the teacher saved it
    }

A step is a **map**, not a bare array — Firestore refuses an array directly
inside an array. Every id in one step is a way of playing the same list; one
list per step; the ids in the family's teaching order, the order the student
opens them in. Everything below is true of each sequence on its own.
`firestore.rules` has no list of allowed fields on these documents, so none of
this needed a rules change.

**Reading it: one function, both sides.** `Adaptive.plansOf(assignment,
roster)` returns `[Red Words or null, Other lists or null]`. `store.js`
(`EIStore.effectivePlans`) and `teacher.js` (`plansFor`) both call it, so the
student's browser and the dashboard cannot read a document differently.

- **One document is the source of both:** the assignment when it holds a
  `lists` array or either plan, otherwise the roster row.
- **Nothing read back is trusted** (`Adaptive.sanitizePlan`, per field): wrong
  types are dropped, a bar or a position out of range is pulled in (to the
  end, for `at`), and a plan with no usable step is `null`.
- **Each field holds its own kind.** A red list's ids all start `red-` and no
  other list's does (ids are permanent; `Adaptive.isRedId`). An id of the
  wrong kind — a red one in `plan2`, any other in `plan` — is dropped, and a
  step left with nothing goes. The dashboard never writes one; this only keeps
  a hand-edited document from crashing either side.

**Writing it.** Every dashboard write about sequences — Save, Stop, Give — is
one merge-write of **both** fields (the one that changes, and the other
written back exactly as read, or deleted when there is none), `lists`, the time
and the class stamp (`seqBody` in `teacher.js`). Written back exactly as read,
a sequence keeps its `setAt`, so its mark keeps counting and nobody moves.
`lists` is the union of each sequence's current list (its last list, once
finished): with a plan, the plan decides, but anything that reads only `lists`
still sees what they can play now. Writing both fields is what keeps a write
about one sequence from losing the other: a student set up before they signed
in has their sequences on their roster row; once they have signed in the
dashboard writes their assignment, and from that write on the assignment is
the source — of both.

**What "finished" means.** A step is finished when, for **every** id in it,
the number of words that are solid and at pace (`Adaptive.listSolid`, the
count behind `listShare`) is at least `Adaptive.stepNeed(bar, total)` — `ceil(bar ×
total)`, in whole words. So 20 words at 90 % is 18 and 28 words is 26. Whole
words, never two fractions compared, so the number a teacher is shown ("18 of
20") is the number that was measured, and a float cannot decide it. "Every
way the teacher ticked" means a student ticked for Say it *and* Cards has to
get both to the bar. An id the library no longer has is skipped, not waited on.
This is the same measure the site has always used (`isMastered` and not
`isSlow`); only the bar changed, from four-in-five to 90 % by default and
settable per student.

**Say it is in every step of every sequence** (the teacher: *"say it must be
in every step sequence"*). Cards is a self-rating — the student presses *Got
it*, and a Got it counts as right — and a step finishes when every way of
playing it reaches the bar, so a Cards-only (or Match-only) step would let a
student move on without anything having heard them read. One pure function,
`WordLists.withSay(ids)`, returns a step's ids with that list's Say it id
present, in the family's teaching order (`inTeachingOrder`; until 2026-11-27 it
put Say it **first**, which the teaching order replaced: Say it is in every
step, but on Red Words it is the last way to open). A list that offers no Say
it gets only the ordering. Every step the dashboard makes goes through it:
Give Red Words, Add a list, Change ways, a
ready-made, saved or copied order, Put these in order, Give a sequence to N
selected, and Save this sequence. In Add a list and Change ways the Say it box
is ticked and disabled, with one line under the boxes: *"Say it is always part
of a sequence. It is the one mode that hears the student read."* (and
`draftWays` / `draftAdd` put it back if anything else took it out). The
dashboard is the only writer of a plan, so nothing patches a stored step on
read (nor re-sorts one: a step's stored order is the order its ways open). Lists
given without a sequence are unchanged.

**One way at a time** (the teacher, 2026-11-27: hear it, read it with help, read
it alone and checked, read it fast, spelling after reading; the next activity
opens when the one before it reaches the bar). Only inside a sequence: lists
given without one show every way at once, as before. `Adaptive.openIds(step,
bar, stats, totalOf)` says which of the current step's ids are open, in the
step's order:

- the first is always open;
- each next one opens when **every** one before it has reached the bar — the
  same whole-word measure as *What "finished" means* (`listSolid` against
  `stepNeed`, solid and at pace), so 18 of 20 opens the next and 17 does not;
  an id the library no longer has is skipped, as `stepFinished` skips it;
- an id the student has **already played** (any stat under it) is open whatever
  the ones before it say. A word can drop out of the top box, and a way the
  student has played must never disappear again (no stored field needed: stats
  only grow). A way opened but never played can close again until the ones
  before it are back at the bar.

Without `totalOf`, only the first (and anything played) is open. It is pure and
stores nothing, and the step is still finished exactly when every way reaches
the bar, so `planState` and the walk are unchanged; the last way to open is the
last to finish. `Adaptive.planPosition` returns it as `current` (the open ways:
what the student can play now; `step` is all of the step's ids), so the home
page, `EIStore.myLists()`, a game page's "is this assigned", the dashboard's
`effectiveLists` and the flag line all see the same open ways. Like the
position, it is worked out once per page load: a way that opens mid-round is
there on the next page.

**Where the position is worked out, and why there.** In the *student's*
browser, in `store.js`, by `Adaptive.planState(plan, stats, totalOf, seq)`
(wrapped, with the lists that follow from it, as `Adaptive.planPosition`,
which the dashboard calls too — once per sequence, each with its own mark): start
at `plan.at`; if the student's own mark is this plan's and further on, start
there; if the teacher is holding them, stop; otherwise walk forward while the
step is finished. It is pure and has no clock, so the dashboard runs exactly the same
function on the same stats and the two cannot disagree (`tests.html` runs the
dashboard's code and `store.js`'s on the same inputs and expects the same index). It has to be the
student's browser because a student can never write `assignments/{uid}`
(`firestore.rules`) and a teacher's browser has no student's stats until it
opens the dashboard. It runs **once per page load** — never mid-round: a student
who finishes a list's last word partway through a round plays the round out
on that list and meets the next one on the next page. With no `totalOf`
nothing moves (the safe way to be wrong, as in `listShare`).

**The high-water mark.** A finished list can be replayed, and a word can drop
out of the top box, so position is not recomputed from nothing each time. When
it comes out further on than what was stored for this plan, the student's
browser writes `students/{uid}.seq = { at, of, when }` — `seq2` for Other
lists, so the two marks can never be mistaken for each other whatever their
`setAt`s are — (through the same
debounced save as everything else, under the same guards: no write on a failed
read, in preview, or for the dev user) and the next load starts from there. `of`
is the plan's `setAt`: a mark made under an older save of the plan is ignored
the moment a teacher saves a new one, so re-saving a sequence recomputes from
what the student has actually learned. `at` may equal the number of steps (past
the last one). `when` is when they last *moved on*, and the dashboard reads it as
news (*"Moved to a new list on Tuesday"*, the *Moved to a new list this week*
card). The **first** mark under a plan is a *landing*, not a move — a teacher who
gives a sequence to students already solid on its first lists puts them on a
later list at once, and that is where they land, not something they did that
week — so it is written with `when: 0` and only a later move, once there is a
mark for this plan, carries the time. Without it, replaying List 1 and missing a few words would put a
student back on List 1.

**What a student could do.** `students/{uid}` is write-your-own-document, not a
whitelist, so `seq` (and `seq2`) needed no rules change, and a student *could* edit their own
`seq`. The worst that does is move themselves along or back in a sequence the
teacher set, and the same `planState` on the dashboard's side is how a teacher
sees where each student really is. They can never write the plan itself (`assignments/`
and `roster/` are read-only to them), change the bar, or reach a step the
teacher has not set. A teacher's own home page ignores plans (it shows every
game) and a teacher previewing a student sees that student's position without
anything being written for them.

`tests.html` pins every function (a bar of 18 of 20 finishes and 17 does not,
two ticked ways with one short, a slow word, `hold`, an old `seq`, replaying a
finished list, a deleted id, a wrong-kind id, Other lists alone, and the check
that a student with no plan gets exactly what `effectiveLists` gives them), the
teaching order of each family, and the open rule (first open; the next at
exactly the bar and not one word below; a played way stays open; a slow word
does not count; a deleted id skipped; the dashboard and `store.js` agreeing on
the open ways).

### A student's page

Click a student (in the Students table, in Manage → Archived, or in the narrow
list of the class's students at the left of this page) to open their page. The
list at the left follows the class filter and has the open student marked; a
student reached from Archived who is not in the filter is added to the top of it.
Above the tabs are the student's name, one line — *"Period 3 · practiced
yesterday · 4 rounds this week"*, or *"hasn't signed in yet"* for a roster
row — and a **Student view** button for this student. Three tabs, a real
`role="tablist"` (arrows, Home and End move between them):

- **Word lists** (opens first). Always two sections, one under the other:
  **Red Words**, then **Other lists**, each its own sequence editor; beside
  them a card for the list they are on (in each, named) and one for the lists
  they have finished.
- **All practice data.** The numbers, *What goes wrong*, *Hardest words*,
  *Reading rate* and *By list* — what the page always held.
- **Notes and class.** *Notes*, *Class*, *Roster row* and *Archive*, unchanged.

Below 900px the columns stack.

**The two sections.** Each editor is headed with its name and, in small type
beside it, what it holds — **Red Words** *10 lists*; **Other lists** *Starting
Blends, Blend Words, oi / oy, Multisyllable · 4 lists*. **Red Words, when the student has none,** is one
button, **Give Red Words**, with one line beside it: *"Every Red Words list in
order, List 1 to List 10, with Cards and Say it. Nothing changes until you press
Save."* It fills the section with every red list in list-number order, Cards
and Say it (the ready-made *Red Words, Lists 1 to 10*), at the usual percent, as
a draft: nothing is given to anyone until Save, so *a student sees what they
were given* still holds — no student is ever given Red Words without the
teacher pressing something. After that it is the same editor as Other lists.
**Other lists, when the student has none,** is the editor with no rows (Add a
list, Use a saved sequence, Copy from another student). In Red Words, *Add a
list* offers only red lists; in Other lists, only the rest.

**An editor.** One row per list,
top to bottom, numbered. A **finished** row says which list, the ways it is
played in words (*"Say it · Cards"*), and *"Finished 14 Nov · 19 of 20 solid"*
(the date is `seq.when`, which is only the latest move, so earlier finished rows
show the count alone), with **Go back to this list**. The row they are on is
marked **Now**: when it has more than one way, one line saying which are open to
the student — *"Open: Match It, Say it · Next: Cards"* (*"· Next: Say it, then
Cards"* when two are waiting; just *"Open: …"* once all are), from the same
`Adaptive.openIds` the student's page runs — then a bar for each way of playing,
in the teaching order, with a tick at the percent, and
the count in whole words — *"Say it: 14 of 20 solid. 4 more to finish (18 of
20). 2 more are right but slow."* — with **Move on now** (not on the last list,
which finishes at the bar). Later rows — the first is *Next* — can be moved
earlier or later (buttons, not drag), have their ways of playing changed
(**Change ways**: the boxes in the teaching order, the order the student will
meet them; Say it stays ticked, locked, with the line that says why — *Say it
is in every step*, above), or be taken out. There is no reordering the ways of a
list: the site sets it. Under the rows: **Add a list** (one list not already there, at least
one way ticked, the boxes in the teaching order; Say it is always ticked and
cannot be unticked, and the other ticks start as a copy of the step above when
it is the same family; the chooser opens on the next list of that family),
**Use a saved sequence** (the section's own ready-made one, then each class's
saved ones — *Saved sequences*, below) and **Copy from another student** (each
other student's sequence of the same kind, by name), and **Save this sequence**
to keep that section's sequence for the whole class. Above
the rows: *"A list is finished when [−] 90% [+] of its words are solid."* in
steps of 5 from 50 to 100; changing it redraws the counts at once.

The two ready-made sequences are built from the library when asked for, not
stored, so nothing goes stale when a list is added or retired: *Red Words, Lists
1 to 10* (offered in Red Words) and *Sounding it out* (Starting Blends, Blend
Words, oi / oy, Multisyllable; offered in Other lists), each with Say it and
Cards, in the teaching order (Cards then Say it on Red Words, Say it then Cards
on the rest). Using one — or a saved order, or copying another student's — uses only
the steps of the section's kind and replaces only the lists still to come,
after a confirm that names them; the finished lists and the one they are on
stay, and no list is ever in a sequence twice. A *saved* sequence also brings
its own percent, and the confirm says so. One that would bring nothing changes
nothing, and the line under the heading says why: *"Nothing added: “Red Words 1
and 2” has no other lists."* (or *"… has no Red Words lists."*), or *"Nothing
added: every list in it is already in this sequence."*

**Move on now** sets `at` to the next step and takes `hold` off. **Go back to
this list** sets `at` to that step and puts `hold` on, and the row reads
*"Staying here until you press Move on now."*

**Each section on its own.** Each has its own percent, rows, Move on now, Go
back, Save this sequence and **Stop using this sequence** (when it has a stored
sequence). In `teacher.js` a section is `which`: 0 Red Words, 1 Other lists —
the same number as its field (`plan`, `plan2`) and its mark (`seq`, `seq2`).
Other lists' DOM ids end in `2` (`seqHead2`, `seqPct2`, …) so the page never
has one id twice; buttons find their section through `data-which`, and focus
after an edit stays in the section it happened in. One Save bar serves both.

**Edits go to a draft** (`drafts[0]` for Red Words and `drafts[1]` for Other lists, plain data; every edit is a small pure
function — `draftMove`, `draftRemove`, `draftWays`, `draftAdd`, `draftBar`,
`draftMoveOn`, `draftGoBack`, `draftReplaceLater` — pinned in `tests.html`). A bar
at the bottom says *"Changes not saved yet"* with **Discard** and **Save**.
Save is one merge-write of both fields, `lists`, the time and the class stamp,
to `assignments/{uid}` or to `roster/{email}` for a student who has not signed
in (`saveBody` → `seqBody`, *Writing it*, above). A sequence whose draft changed
is written afresh: `setAt` is now, `at` is the step shown as Now — the number
of steps when that is past the end, so a student who has finished every list
stays finished without their old mark. Because `setAt` changed, the old
high-water mark stops counting, and it does not need to.

**K1: nothing the teacher does moves a student backwards, except Go back to
this list and raising the percent.** An edited draft's Now is walked from
where the student is (`draftStart`): a lowered percent, a saved, ready-made or
copied order, and moving or taking out later lists all leave them where they
were or further on — a finished student stays finished, because `at` can say
"past the end" — and lists added after the end start them on the first added
list they have not already finished. A **raised** percent measures again from
where they are: a finished student is measured again on the last list, and is
on it again if it no longer meets the new bar. A saved sequence used in the
editor that brings a higher percent than the student's is raising the percent
too (its confirm says *"The percent becomes 75%."*). Go back holds them where the
teacher put them. A sequence whose draft did not change is written back
exactly as stored, so editing one never resets the other's mark (or its
*Moved to a new list* news). With no edit there is no Save bar and nothing is written. `lists` is
the current step's ids of each. Switching student, going back to the list, the class
filter, Refresh, a sidebar item and closing the page all ask first when there is
a draft.

**Where "Now" comes from.** `positionOf(uid, which)` in `teacher.js` is
`Adaptive.planPosition` on the student's own stats and `seq` (or `seq2`) —
`store.js`'s code, not a lookalike — so the
editor cannot say Now about a list the student's home page does not show.
`effectiveLists()` uses it too, so the Students table, the CSV and the rest see a
sequence student's real lists (finished, then current).

**A student with games and no sequence** sees, in place of the rows, *"These 3
games, all at once, in no order"*, the sentence the roster shows
(`WordLists.describeAssignment`), **Put these in order** (one step per list from
what they have, as a draft: the red games into Red Words in list-number order,
the others into Other lists in the library's order) and the picker behind a
*Change these games* fold, saved as before with **Save games**. A student with
nothing gets *Give Red Words*, an empty Other lists editor, and the same fold.

**Stop using this sequence** (after a confirm that names it — *"Stop using the
Red Words sequence for Ana Lopez?"* — and says what leaves and that the other
stays) deletes that section's field and writes the other back exactly as
stored, so the student stays where they were in it (`stopBody(uid, now,
which)`). `lists` becomes the other's current list — or, when it was the only
one, the list they were on in it (the last one, if they had finished), all at
once. The lists they had finished leave the home page; their practice record
is kept.

**Keyboard.** Every row in the Students table takes focus (Enter or Space
opens the student). The student list at the left is one tab stop — the open
student — with the arrow keys, Home and End moving along it, so reaching the tabs
does not mean tabbing past a class. After each edit focus returns near where it
was (the same arrow on the moved row, or its twin at the end of the list; *Add a
list* after an add); after Save or Stop it lands on the editor's heading and a
status line says *"Saved."*; a failure says so beside Save, or under the heading
when there is no Save bar. Only one write is on the wire at a time, so an edit
cannot be lost underneath a save. Things that would drop a draft — switching
student, the class filter, a sidebar item, Archive, Remove from roster, moving
them out of your classes, closing the page — ask first; Refresh asks first and
drops the draft only once the new data has arrived.

### The class page

The Students view is one calm row per student, because a sequence moves a
student on by itself and so the question a teacher has is no longer *"who is
ready for List 4?"* but *"who is stuck, and who has nothing?"*. It replaced two
things: the **Assign board** (a grid of every student's games, with a bulk
dialog and a draft saved in one batch) and **Ready to move up** (a strip
suggesting the next list when four words in five were solid). The first answered
"what does each student have?" at a scale nobody needs once lists are given in
order; the second suggested what a sequence now does by itself, at a bar the
teacher chooses per student.

A row is: a tick box; the student (name, class, a ✎ if there is a note) with at
most one **flag line** under it; **Now on**, the list they are on; **Progress**,
a bar with a tick at that student's percent and the count in whole words
(*"14 of 20"*; with more than one way ticked, the way the student is working
toward — the first in the step's order still below the bar, since the later ways
open one at a time — named: *"14 of 20 · Say it"*); and **Place**, *"List 3 of 6"* (plus *· held*). A
finished sequence reads *"Finished all 6"*. A student with games and no order
shows today's sentence and *no order*. A student with nothing shows a
*No lists yet* pill. A student on the roster who has not signed in stays greyed,
*"on the roster — hasn't signed in yet"*. A student with **two sequences** shows
both in the same row, stacked, **Red Words first**, each with a small label
over the list — *Red Words*, *Other lists* — the bar and count, and the place
(`rowFacts` gives `{ kind: "two", seqs: [..] }`, each with its `label`). A student with one shows it as before, with no
label: the list's own name already says which. The row opens the student's page; the
tick box does not. Rows take focus (Enter or Space opens). There is no sideways
scrolling at 1366px.

**The flag line** is the first of `Adaptive.nextSteps`' rules that fires, or
nothing (*The flag line*, below). **The four cards** are *Students*, *Practiced
this week*, *Moved to a new list this week* (the student's own mark, if it is
this plan's and a move forward; `lastMove()`) and *No lists yet*, all counts of
students and `summaryCounts()` pure and tested. The *"N students have no lists
yet"* callout has a **Select them** button that ticks exactly those rows.

**Giving a sequence to several students.** Tick rows (the heading tick takes
everyone shown), press **Give a sequence to N selected…**, choose a ready-made
sequence, a saved one, or another student's Red Words or Other lists, and the
percent (a copied sequence brings its own percent as the starting point). There
is no choice of where it goes: **the order goes where it belongs.** Its red
lists become (replace) each student's Red Words sequence, its other lists
become (replace) their Other lists sequence, and a kind it does not hold is
left exactly as stored; a saved order holding both kinds is split the same
way, and games given with no order are replaced. The
dialog says so in one line (*"Red Words lists go into each student’s Red Words
sequence. Other lists go into their Other lists sequence."*) and then, in counts
of students, what it replaces and what it leaves (`giveCounts`, `giveWarning`):
*"2 of these 5 students already have a Red Words sequence. This replaces
them. 1 of these 5 students has games in no order. This replaces them. It has
no other lists: 3 of them keep their Other lists sequence as it is."* — and
asks again in a confirm when anything is replaced. It is written as **one
batch** (`commitBodies`), so at most 400 students
at a time (past that a batch would no longer be all-or-nothing; the dialog says
so and Give it stays off): every student, or none —
a failure puts every local copy back as it was and the dialog stays open with the
ticks kept. Each student's body is `giveBody`: for each kind the order holds, a
plan with `at: 0` and no hold, saved now — so each student lands on the first
list of it they have not already finished, worked out from their own stats (a
student already solid on the first two lands on the third, one who has never
practiced on the first); a kind it does not hold written back exactly as stored
(same `setAt`, so its mark still counts); both through `seqBody`, with `lists`
the union of the current lists. Replacing a sequence is a deliberate teacher
act, so the replaced one's position is not carried over. A student who has not
signed in is written to their roster row.

### Saved sequences

A teacher can keep a sequence for a class and use it again. On a student's page,
**Save this sequence** asks for a name (inline, not a pop-up) and stores what is
on the screen — every step, and the percent — on the **class document** (each
section has its own button and saves only that section's sequence; a saved
sequence is always **one** sequence):

    classes/{classId}.sequences.<key> = { name, steps: [{ ids: [...] }], bar, createdAt }

Why on the class: every teacher on a class can already read and write its
document, so co-teachers see and can use what is saved and **`firestore.rules`
did not change** (a write is a merge onto the class that leaves `teachers` a
non-empty list, which the class rule already requires; `tools/rules-test.mjs`
pins it). The key is a plain id (no dots: it is a field path). Everything read
back is cleaned (`cleanSaved`: a name that is not a string, or steps that are not
a usable plan, drop that entry), a class holds at most 20 (checked on the page,
not by the rules: two co-teachers saving between refreshes can pass it), and a
name is at most 60 characters. The name box takes Enter to save and Escape to
cancel, and a second press while it saves writes nothing more. Deleting an empty class takes its saved sequences with it, and the
confirm says so.

The **Saved sequences** view (sidebar, *Assign*) lists each class's, under a
heading per class: the name, the class, the steps in words (*"10 lists: Red Words
· List 1, … Red Words · List 10 — Cards · Say it, finished at 90%."*), and
**Rename** (inline) and **Delete** (after a confirm that says deleting changes no
student). A rename writes the whole entry again with its new name (so one a co-teacher
deleted since the page loaded comes back whole, never as a bare name with no
steps); a delete is a field delete under `sequences` (`FieldValue.delete()`), so
nothing else on the class is touched. All three are optimistic and undone if the write fails.

They are offered in two places, beside the ready-made ones and grouped by class
(*"Saved in Period 3"*): each section's **Use a saved sequence** (which uses only
the saved order's steps of that section's kind), and the **Give a sequence to N
selected…** dialog (which puts each kind where it belongs) — for every class the
teacher is on (the admin sees every class). **Using one copies it**: the student
gets their own plan; nothing links back, so renaming or deleting the saved one
later changes nobody.

A student with **no class** cannot be the source of a saved sequence (there is no
class to keep it with), so the button is present but disabled, with the reason
beside it in words, rather than failing when pressed.

### The picker

Every place a set of lists is chosen — a student's own page (for a student
with no sequence, behind *Change these games*) — uses
one component, `pickerHtml()` in `teacher.js`: one
section per family, because that is the only kind of entry the registry
has:

- **a family with one list** — a line of mode checkboxes, with *all* /
  *none*: "Blend Words: 🎤 Say it · 🃏 Cards · 🎯 Match It", each labelled
  with its word count and whether it needs a mic or headphones.
- **a family with several** — a grid: one row per list (with four of its
  words as a reminder — *you, should, could, said…*), one column per
  mode, an **all** toggle on each row and each column. "Lists 1–4 as
  flash cards" is four clicks; "everything as Match It" is one.

A live line under the picker — *"Ticked: Starting Blends: 🎤🃏 · Red
Words: 1–3 🃏 · 1 🎯"* — says in words what the ticks add up to, and it is
the same line the roster shows, so what a student *has* and what you're
*setting* read the same way. The button row under a picker is sticky, so
Save stays on screen however far down the six families you've scrolled.

### Roster import

A class only existed on this dashboard once every student had signed in,
which made the first day of term an empty page and a teacher typing thirty
names into a dropdown. **Classes → 📋 Import roster** takes whatever
the student information system exports and places the whole class before any
of them touches the site.

On the Students page, the **Add by student ID** box is the same import with
a typed source, into the class picked beside it: the IDs go through
`parseRoster` and `importBody` exactly as a file's rows would. It skips any ID already on the roster rather than
updating it, because a typed ID has no name and a set-merge would blank the
one the import stored.

The join is the ID number. Students sign in as `<student id>@seq.org`, so
the address is knowable in August and a uid is not — the roster is
therefore stored at `roster/{email}`, keyed by the thing both sides of a
first sign-in agree about.

`GameCore.parseRoster` reads what it is given rather than a format, because
an SIS export is never the same twice: comma, tab or semicolon (sniffed);
quoted fields with commas inside names; a BOM; Windows line endings; `Perm
ID` or `Local ID` or `Student Number`; one *Name* column or *Last* plus
*First*; `Period 3` or `P3` or `3rd`. With no header row at all it reads the
columns by shape — the all-digits column is the ID, the wordy one is the
name, the one- or two-digit one is the period. The period only ever picks
a class (see above) and is not stored. Any other column is ignored: which
games a student gets is chosen on the dashboard, not in the export.

It will **not** guess an ID. A row without one, or with a non-numeric or
duplicate one, is listed and left out — a guessed ID is a student matched to
somebody else's record.

Nothing is written until the preview has been looked at: name, email, the
period in the file, the class each row will go into, and a status of *new*,
*update*, *already signed in* or *in another class — skipped*. Then any new
classes, then one batch of set-merges (chunks of 400).

Two rules do the rest of the work, both about not destroying anything:

- **A re-import never deletes.** A student dropped from an export by
  mistake keeps their row and their class. Removal is one explicit button
  on their page.
- **An import never touches `assignments`.** It writes roster rows only;
  a signed-in student's other documents follow their row's class through
  `store.js` and self-heal.

A roster row with no account behind it is folded into the class as a
**pending student** — a real row, greyed, clickable and assignable, with
"hasn't signed in yet" where their numbers would be. The design decision
worth knowing: every view shows the class as it actually is, and nothing
had to learn about a second kind of student. Their assignments are written
to their roster row instead of `assignments/{uid}`, because there is no uid
to write against yet; `store.js` picks them up on the first sign-in.

### The flag line

Under each student's name on the Students table: **at most one line**, and
nothing for most students. A dashboard that shows everything shows nothing —
thirty students with four numbers each is a hundred and twenty numbers and no
next action.

`Adaptive.nextSteps` is pure and takes the first rule that fires:

1. **Stuck on cards** — 30+ answers on a card list under 40 % solid. That
   student is being shown a word, saying "not yet", and being shown it
   again; the answer is almost never more cards, so the line says to try Say It
   on the same words (or Match It where the family has no Say It). Not inside a
   sequence: there the ways open one at a time in the site's order, so the line
   says only that they are stuck (*"Stuck on Red Words · List 1 — 20% solid after
   40 answers."*).
2. **The two in the wrong order** — under 50 % on Match It for a list whose
   cards are under 60 % solid. Picking a word out of six look-alikes is
   harder than reading it, not easier. Not for a student in a sequence: there
   the site sets the order, with Match It first on purpose, and the teacher
   cannot change it, so *"Cards first"* would be advice nobody can take.
3. **Finished everything.** For a student in a sequence: the whole sequence is
   done — *"Finished every list. Add the next ones."* For a plain set (no
   sequence) it is the old *coasting*: every list 90 %+ solid. A student part way
   through a sequence is not coasting; they are on the list they are meant to be
   on.
4. **Quiet** — no round in more than 7 **school** days. Counting calendar
   days would say the whole class had gone quiet every weekend.
5. **Moved up** — the one good-news line: *"Moved to a new list on Tuesday."*
   for a student whose own mark (this plan's, a move forward) is under a week
   old. Last, because it needs a teacher least, and gone after a week.

A student in a sequence is judged on the list they are on now, not the ones they
have finished (`nextStepInfo` passes only the current step's open ways of
playing: what the student can play).
A student with two sequences is still one line: the current lists of both are
passed (the first rule that fires, on either, wins), *Finished every list*
fires only when both are finished, and *Moved to a new list* is the more recent
move of the two (`lastMove`, each judged by its own mark).
There is nothing to click: the line is advice, and the student's page is one
click away. (It used to carry a one-click *Add Say it* that fed the board's
draft; with the board gone, and a sequence ignoring `lists`, that button had
nothing to write.) A student who hasn't signed in never gets a line.

### Patterns

Thirty words all going wrong on the same vowel team is **one** problem with
one lesson behind it, and a list of thirty words hides that. So every
family carries a `pattern` — *initial blend*, *final blend*, *vowel team
oi/oy*, *multisyllable*, *irregular*, *nonsense CVC* — in the words a
teacher would use in a plan, and **Trouble spots** has a second table
grouped by it, following the class filter like the first.

"Shaky" in that table counts **students**, not words: a student struggling
with six words of one pattern counts once, because the table answers how
many people to reteach.

It is also a slightly **looser** line than the one on the Students table.
`adaptive.js` calls a word shaky when it is not solid and first-try accuracy
is under 60 %; `patternRows()` in `teacher.js` counts a word as one to
reteach at under 70 %. The two were never unified, so a word at 65 % is
uncounted in a student's "shaky" total and counted in the by-pattern
table. `overview.html` tells teachers the same thing in one sentence; if you
ever move one threshold, move both and update both documents.

The **Most common error** column comes from the seven kinds `diagnose()` can
name, counted per miss on the stat as `k: {blend:3, vowel:1}`. Only Say It
writes them — it is the only mode that hears what the student actually said
— and only on the reveal, so it counts words given up on rather than words
fumbled once. The key set is closed and sanitized on the way in: this goes
from a game engine into a document a teacher reads.

The student page gains a **Slow but right** count (from `lat` — see Speed;
never shown to the student) and a one-line error mix. Both exports grow
columns: *Slow but right* and *Top error* on the roster; *Pattern*, *Slow*
and *Top error* per word.

### Notes

A short note per student, on their detail page, for the things the numbers
can't say — *"reads well, freezes when timed"*, *"sounds it out under his
breath and gets there"*. The first line shows under their name on the
roster and as a ✎ beside their name on the Students table, because a note you have to open a student
to discover is a note nobody reads.

It lives in its own `notes/{uid}` collection, and that is the whole design
decision. A student can read their own `assignments/{uid}` row, so a note
stored there would be readable by its subject — and a teacher writing for
that audience will either write nothing useful or keep the real notes
somewhere else. `notes/{uid}` is **teacher read and teacher write, with no
student clause at all**. It is the one path on the site a student may not
read about themselves.

"Teacher" means every teacher on the student's class, and the admin: a note
is shared by co-teachers. The panel says so (it used to say "Only you can
read this", which was never true on a co-taught class).

### Export

Two CSVs from the Students tab, built from what the dashboard already has
in memory — no new reads, no backend:

- **Roster** — a row per student: class, the same list sentence the
  screen shows, where it came from, accuracy, words solid and shaky, last
  active, and their note.
- **Every word** — a row per (student, list, word) they have attempted:
  attempts, correct, accuracy, whether it's solid, when it was last
  practised. The long file, and the only export that can answer a
  question nobody thought to build a screen for.

The builders are pure functions and the escaping is tested, which matters
more than it looks: a student called O'Brien, a note with a comma, a list
title with a quotation mark — a naive join breaks on any of them, silently,
in a file somebody has already emailed to a meeting. Cells beginning `=`,
`+`, `-` or `@` are prefixed with an apostrophe so a spreadsheet doesn't
read a name as a formula, and the file carries a BOM so Excel doesn't
mangle accented names.

### Keyboard and screen readers

Board cells are focusable: **arrows** move between them, **Home**/**End**
jump to the ends of a row, **Enter** or **Space** opens a cell's modes and
**Esc** closes it. Fifteen columns is further than anyone wants to press
Tab.

Every cell also carries its answer in words — *"Ana, Red Words List 2:
Cards, Match It"* — as its label and its tooltip, because two emoji and an
em dash are not something to hand a screen reader.

### What actually gets stored

A flat array of list ids in `assignments/{uid}` — or, for a student who
hasn't signed in yet, on their `roster/{email}` row — and beside it, for a
student given sequences, `plan` (Red Words) and `plan2` (Other lists), either
or both (see *Sequences*); their places in them are `seq` and `seq2` on their
own `students/{uid}`. The families, the
modes and the picker's grid are all presentation — `store.js` and
`firestore.rules` never see any of it. An empty array and a missing one
mean the same thing now: nothing.

A teacher's test student (see *The test student*) is the same
`assignments/{uid}` with `test: true`, on the teacher's *own* uid; its
practice is the teacher's own `students/{uid}`.

`classes/{classId}` holds one class: its name, its teachers and its
archived students, read and written by its teachers and the admin.
Students never read it: `store.js` resolves a student's lists through
`assignments/{uid}` and `roster/{email}`, and their class through the
roster row. Classes replaced the free-text period and the shared
`config/class`, which is now admin-read-only and read only by the
migration. (Older builds also wrote `periodLists`, `defaultLists`,
`sequences` and `sequenceOn` there. Nothing reads any of them now, and they
can be left or deleted in the console.)

A student reads and writes only their own `students/{uid}` (and may change
its `classId`/`teachers` only to what their roster row says). Their
teachers have **read** on it, and may change those two fields and nothing
else — that is a move between classes or a co-teacher rewrite. Everything the teacher sets lives in
`assignments/{uid}` instead, so a compromised teacher session can't erase
anyone's work. In `firestore.rules` the student's read and their
create/update are **separate statements** on purpose: `request.resource`
is null on a read, so one combined `allow read, write` that mentions
`request.resource.data` errors on every get, and an error is a deny. The
teacher's read clause masked it for a while, because a teacher testing
passes.

The console does not update itself: whenever `firestore.rules` changes,
re-publish it (Firestore Database → Rules → Publish) or the old rules are
still the ones enforcing.

The roster adds a fifth path, `roster/{email}`, the one rules change in all of
this. A student may read **exactly one document** — their own, matched on
their own token's address — and may not write it. They need the read (their
class, and any lists given before they had an account, resolve through it on
first sign-in) and must not have the write (the row decides which lists they
get). Rules in the repo are not rules in the console: until `firestore.rules`
is pasted in and published, every roster read is denied and the site behaves
as it did before the roster existed. That is designed, and it is also why an
unpublished rules change fails quietly rather than loudly.

The `heard` map added with the sound-level feedback needed no rules change
either: `students/{uid}` is write-your-own-document, not a whitelist of
fields. Neither did `seq` (or `seq2`), and neither did `plan` (or `plan2`): `assignments/{uid}` and
`roster/{email}` were already teacher-written and student-read, which is
exactly the access a plan needs. `tools/rules-test.mjs` has the cases that
pin it (a student writes their own `seq` and cannot write a plan).
