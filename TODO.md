# TODO

What's left after the assignment-board work, roughly in the order it's worth
doing. Nothing here is blocking: the site is complete and tested as it
stands. Items are written so they can be picked up cold.

Things considered and deliberately *not* done are at the bottom, with the
reasoning, so they don't get re-proposed every few months.

---

## Next

*(The three items that were here — progression rules, per-student notes and
export — are done. See the Teacher dashboard section of the README.)*

Nothing is outstanding from the assignment-board work. The reading-feedback
build (sound-level feedback, fluency, phoneme clips, sound boxes, patterns)
is done and described in the README; it now wants a term of use.

Two things worth watching once it has had one:

- **`ACCEPT` is still hand-edited.** The dashboard's "most often heard as"
  line shows which mishearings are common across the class, which is the
  signal for adding one. An entry now counts in Say It too (it didn't
  before, which made this item impossible to act on). The rule for adding
  one is in the comment above the table in `game-core.js`: only when the
  word was read right and the mic wrote something else, never a dropped or
  swapped sound. It holds one entry (*tent* ← "tenth").

- **Say it coaching for the four pattern lists.** sh / ch / th, Silent e,
  ar / or / er and Vowel Teams use the plain coaching (`blend: "start",
  blendLength: 0`) because `sound` takes one phoneme token and each list
  has several target sounds. Letting `sound` take a set (`["SH","C","TH"]`,
  any one of them) would let Say it's reveal name the pattern sound the
  way oi / oy does. It is a matcher change (`findPhonemeSeq`), so it needs
  the listen-loop before/after.
- **Sound-alikes on the pattern lists.** A correct reading of *herd* can
  come back as "heard", *which* as "witch", *plane* as "plain", *wait* as
  "weight", *road* as "rode", *rain* as "reign", *beach* as "beech". Say it
  would mark those wrong. The fix is a `soundalikes` map on those families,
  as the red words have, added only when the dashboard's "most often heard
  as" shows it, with the listen-loop before/after. (Spell it already says
  these words with a sentence.)
- **Consider one 59-word blends list** (Starting Blends and Blend Words
  merged) so One minute has enough words. It is a new list id and a new
  family decision, so it needs its own plan.

## Smaller

- **`red-words-game.html` / `red-words-match-game.html` redirects.** Six
  lines each, kept so bookmarks and anything written on paper keep working.
  Delete them once a school year has gone by and nothing links there.

---

## Reversed

- **Period lists, the class default, and sequences** — removed on
  2026-10-08, before anyone had used the site. A student now sees exactly
  the lists the teacher gave them, and nothing when nothing is given; the
  teacher asked for the dashboard to control what each student sees, one
  student at a time. The layered walk (own → roster → period course →
  period list → class default → everything) was correct but needed a
  paragraph of explanation on every screen that showed it. Bulk changes
  (tick a period, add / take away / replace) cover what the period levels
  were for. The roster's *start* column went with the courses it placed
  students in. If auto-advancing courses come back, they should be a
  per-student setting, not a period one.
- **A say-it mode for the red words** — previously "not doing", on the
  grounds that a phoneme matcher has nothing to check an irregular word
  against. The reason didn't survive a second look: Say It accepts an
  **exact transcript first** and only falls back to phonemes, and a red word
  is an ordinary dictionary word that Chrome returns reliably. The two real
  blockers were homophones (*to* / *two*) and contractions (*they'd* heard
  as "they would"), and both are now fixed where they belong:
  `RED_HOMOPHONES` reaches the say matcher, and `GameCore.normalize` folds a
  contraction and its expansion to the same string. Ten new ids
  (`red-N-say`) on the generic `say-game.html`.

- **Sequences, per student: Red Words and Other lists** (2026-11-26). The
  2026-10-08 note above said auto-advancing should return as "a per-student
  setting, not a period one"; this is that. A student has at most two
  sequences, in fixed fields of their assignment (or roster row before they
  sign in): **Red Words** in `plan` (red lists only, mark `students/{uid}.seq`)
  and **Other lists** in `plan2` (every other family, mark `seq2`). Either
  stands alone; each moves on by itself, in the student's own browser, at a
  percent the teacher sets per student. One document is the source of both
  (the assignment when it has `lists` or either plan, else the roster row),
  and every dashboard write carries both fields, so a write about one never
  loses the other. Both sides read through `Adaptive.plansOf`, which drops an
  id of the wrong kind. The **Assign board** and **Ready to move up** went
  when sequences came (24 November): with lists in order, "who is ready for
  List 4?" answers itself. See the README, *Sequences*, *A student's page* and
  *The class page*.

  Two standing rules:
  - **K1: nothing the teacher does moves a student backwards, except Go back
    to this list and raising the percent.** A plan's `at` may equal the
    number of steps (past the end), so a re-save keeps a finished student
    finished.
  - **Say it is in every step of every sequence** (the teacher). Cards is a
    self-rating, so a step without Say it could be finished without anything
    hearing the student read. Every step the dashboard makes has Say it,
    locked in the choosers with one line saying why.

  Removed on 2026-11-26, because no student had ever used the site and the
  teacher asked to simplify as much as possible: everything that existed only
  for documents saved on 24–25 November — a sequence of either kind in either
  field, deciding the kind by what a sequence held, promoting `plan2` to
  `plan` on Stop, splitting or merging older documents into the two sections
  (and the Students row's *Mixed* label and the Give dialog's split / merged
  sentences), and the load-time upkeep that wrote Say it into stored plans and
  saved sequences (and its note). There is no migration: a document in an
  older shape at worst shows no sequence, and the teacher gives it again.

## Shipped 2026-11-25: saves on shared Chromebooks, and small fixes

Not a plan that was left open — a record of what changed in one day, so the
next person does not have to reconstruct it from `git log 4d4b834..HEAD`. The
README has the mechanics (the per-student tracking note and the save-loop
section); the reasons are here.

- **Sign-out waits at most 4 s for the last save.** `signOut` in `auth.js`
  waited on `EIStore.flush()` with no limit. On a stalled network the write
  never answered, the button never finished, and the next student on a shared
  Chromebook was left in the previous student's account. It now gives the save
  4 s (`settleWithin`, on `EIAuth._internals`), reads "Signing out…" and is
  disabled while it waits, and ignores repeat clicks. The order is unchanged:
  flush, `sessionStorage.clear()`, `auth.signOut()`, reload.
- **Saves on `pagehide` and `visibilitychange`.** Answers inside the 1.2 s
  debounce were lost when a tab was closed or a lid shut. `store.js` now
  flushes when the page is hidden (`flushOnHide`, on `EIStore._internals`);
  `flush()`'s own guards still decide whether anything is written.
- **A 5 s ceiling on the save debounce** (`SAVE_MAX_WAIT_MS`). The debounce
  was a trailing 1200 ms timer re-armed on every answer, so a student
  answering faster than that (Match it clicks, "Got it" on the cards) put the
  save off until the round ended, and a stalled network or a sign-out before
  then lost the run. A save now goes no later than 5 s after the oldest unsent
  change; the 1.2 s pause is unchanged. A failed write puts its keys back
  *without* the old time, so the retry timer is not pre-empted into a tight
  loop.
- **Each write is handed to the SDK at once**, not chained behind the last
  one's acknowledgement. The chain was there to stop two overlapping writes
  landing out of order, but the Firestore SDK already sends one client's
  writes in `set()` order, so the chain bought nothing and cost the save on
  `pagehide`: it waited for the earlier write's reply, and a tab that closed
  first never issued the second. Only the hand-over is ordered now. If a first
  write is refused while a later one lands, re-sending its keys is safe:
  `payload()` always sends current whole values.
- **Tall pages scroll from the top at every width.** `html,body{height:100%}`
  on a flex-centred body made content taller than the window overflow
  *upward*, above y = 0, where it cannot be scrolled to. The list chooser's
  heading and first tiles were unreachable at 1366 x 768 (the cards, match and
  say chooser started at -290 px). The body now has `min-height:100%`: short
  content still centres, tall content grows the page. Below 560 px the Home
  button and user chip also scroll with the page instead of sitting over it.
- **Same-title chooser tiles carry their mode.** Tiles that share a title now
  add the mode name (*Multisyllable · Cards* / *· Split it*). Ids are
  untouched.
- **A favicon** (`favicon.svg`, linked on every page except `tests.html`),
  which ends the `/favicon.ico` 404 on every load.
- **The two finished plan files are gone** (`PLAN-retire-modes.md`,
  `PLAN-roster-and-sequences.md`). Both were done and nothing referenced them.
- **`tools/save-loop.mjs` and the GitHub checks workflow.** A Node tool, no
  dependencies, that plays seeded schedules of students answering, hiding and
  closing tabs, losing the network, and signing out on shared Chromebooks
  against a fake Firebase, then checks each stored `students/{uid}` document
  against its own ledger. The sign-out, `pagehide`, debounce and
  write-chain fixes above were checked against it. `.github/workflows/checks.yml` runs `tests.html`,
  `check-pages.sh`, `boot-check.sh` and the loop on every push and pull
  request. CLAUDE.md says when to run the loop by hand.

### Decided during the save-loop build

- **Sign-out gives up on the save rather than wait for it.** The cost of a
  stalled network was the next student in the previous account, so the wait
  has a limit (4 s).
- **The loop is the test for anything that writes `students/{uid}`.** Change
  `store.js`, sign-in or sign-out, or a per-student `localStorage` /
  `sessionStorage` key, and run it before committing (CLAUDE.md).
- **The chooser fix is in `site.css`**: `min-height:100%` on the body in place
  of `height:100%`, which still centres short content.

- **`tools/sequence-loop.mjs`, the second closed loop.** It opens the real
  dashboard and each student's real home page side by side in headless Chrome,
  with one fake database between them. It plays seeded schedules of a teacher
  giving, editing and stopping sequences (one or two per student, singly or in
  bulk, before or after the student first signs in) while students practise.
  After every step it checks that the dashboard, the student's page and the
  README's rules all say the same thing about where each student is. It runs
  on every push after save-loop. The day it was built it found K1 (see
  *Sequences*, under *Reversed*).

### Decided 2026-11-25: the microphone

- **The microphone: measure first** (2026-11-25). The teacher wants the
  listening "as accurate as possible", and it is always one voice in a quiet
  room. No scoring rule changed. Every listening rule trades a false reject
  (read right, marked wrong) against a false accept, and neither rate had ever
  been measured, so the day built the instruments: `mic-takes.html`, a
  teacher-only recorder that saves what Chrome's recogniser returned for a
  scripted read (right, and wrong on purpose), and `tools/listen-loop.mjs`,
  which replays reads through the real engines, counts both errors, scores a
  candidate rule against today's, and pins the baseline on GitHub.

  **Next: record the first takes.** Open `mic-takes.html` on a school
  Chromebook with the class headset in the quiet room. Read Starting Blends,
  Nonsense, Red List 1 and Multisyllable, each once "Right" and once "Wrong"
  (about 25 minutes). Put the downloaded files in `tools/mic-takes/` and run
  `node tools/listen-loop.mjs --source=takes`. Then use the numbers to decide,
  in order: scoring on interims vs finals, top guess vs n-best, and the 0.35
  quiet-read threshold. Separately, the loop shows that the cards' Listen, One
  minute and Blend It lack Say It's nonsense-word and "up set" fences; bringing
  them in line is a scoring change and needs its own before/after.

## Decided during the retire-modes build

- **No default-modes shortcut exists**, so nothing needed changing for red
  words to prefer Say it + Cards. Sequences and period defaults were removed
  on 2026-10-08.
- **"Everything" ignores retired ids.** A student with every offered id
  still reads as "everything" in descriptions.
- **A teacher can open a retired game page** even though their preview home
  page no longer lists it, so a retired tile on a student's page is still
  checkable.

## Decided during the roster build

Choices the roster plan left open, recorded so the reasoning survives.

- **"Stuck on cards for two weeks" is measured in attempts, not days.** A
  stat carries the time a word was LAST practised and nothing about when it
  was first seen, so "for two weeks" has nothing to compute against. Thirty
  answers on one list at under 40 % solid is the same student by any other
  route (at eighteen words a round, a fortnight of it), and it is a number
  the data actually has.

## Decided during the reading-feedback build

Choices the plan left to whoever built it, recorded so the reasoning
survives the commit that made them.

- **The dashboard's "most often heard as" is a line on each chip, not a
  column.** Trouble spots renders word chips, not a table, so the mode
  transcript goes under the word the way the counts already do. A column
  would have meant rebuilding the panel as a table for one field.
- **A dropped final consonant on a final-blend list reads as a blend error,
  not a dropped sound.** `diagnose()` tries the blend being practised before
  anything else, so "gasp" read as "gas" says *Look at the blend: sp* on the
  Blend Words list and *You dropped a sound: p* everywhere else. Both are
  true; on that list the blend is the skill, so it is the thing to point at.

---

## Reversed, again

- **Connected-text passages.** Built as part of the reading-feedback plan (a
  "Read it" mode, eight hand-written passages, a pointer that followed a
  reader through prose with a three-word lookahead) and removed a day later.
  Two reasons. The site is word practice; a paragraph is a different
  exercise with a different teaching purpose. And the vocabulary rule that
  made the passages honest — every word off a list the student had been
  taught, about two hundred of them, no *them*, no *him*, no past tense the
  lists don't carry — made them read like nothing anybody would write, a
  poor advertisement for reading.

  If it comes back it wants real prose and a different answer to "which
  words are allowed". The engine's pointer walk kept only the branch the
  word runs use; the lookahead went with the passages.

## Considered and not doing

- **Homophone groups and read-aloud sentences for the new Match It lists.**
  The red words need `RED_HOMOPHONES` because no amount of listening
  separates *to* from *two*, and `RED_SENTENCES` because a synthesiser reads
  *does*, *live*, *minute* and *wind* wrong cold. The other families have
  neither problem: their near-misses (*sled* / *bled*, *inhibit* /
  *inhabit*, *maximum* / *minimum*) are minimal pairs that a clear read does
  separate, and telling them apart by ear is the skill those lists are for.
  Adding groups there would remove the exercise.
- **Match It for the nonsense words.** The game *says* a word and asks the
  student to find it. A synthesiser handed "vab" guesses, and often enough
  guesses "verb" that the answer key would be wrong. A list with no meanings
  can only be read, not heard. Same reason their cards mode runs with
  `speak: false`.
- **Splitting `word-lists.js`.** It's ~500 lines, mostly word arrays and the
  prose explaining where they came from. Splitting the families into their
  own files would mean six files to open to answer "what is this student
  practising", the question the file exists to answer in one place.
- **Splitting `teacher.js`.** Re-evaluated 2026-11-25 and left alone: none of
  the day's work touched it, and four branches merged into main without a
  conflict in it. Revisit before a stretch
  of dashboard work, and only with a dashboard test in place first, so a split
  can be checked.
- **Making `totals` exact across two tabs of one student.** Known: it is `K1`
  in `tools/save-loop.mjs`, and the loop prints it as a known line, not a
  failure. With two tabs of one student open, `totals` is last-writer-wins.
  The per-word stats are unaffected. It affects 2-5 students a day.
- **A Firebase SDK bump.** No visible benefit.
- **Tightening what a student may write to their own document.** It needs a
  re-publish of `firestore.rules` (the console paste), and the site is
  practice-only.
