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

- **Consider Spell it for blends.** Hearing a word and typing it would suit
  the blend lists. Separate plan.
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

- **Sequences came back, per student — and the Assign board went**
  (2026-11-24). The 2026-10-08 note above said auto-advancing should return
  as "a per-student setting, not a period one"; this is that. A teacher gives
  a student their lists **in order** (`plan` on `assignments/{uid}` or the
  roster row) and the student's own browser moves them on at a bar the
  teacher sets per student (90 % by default), with a high-water mark
  (`students/{uid}.seq`) so replaying a list cannot put them back. Four
  things this reverses: the rule that the dashboard "does not act on its own"
  and that the arithmetic runs on the teacher's page (the site now moves a
  student on itself, in the student's browser; a student still cannot write
  `assignments/`); the bar of four words in five (`SOLID_ENOUGH`, now gone);
  the *additive* suggestion (a finished list now leaves the main home page for
  a closed fold, still playable); and "each student has one set of lists, and
  that set is fixed" (it now moves with their progress). The **Assign board**
  and **Ready to move up** were removed in the same change: with lists given in
  order, "who is ready for List 4?" answers itself and "what does each student
  have?" is a row on the Students page, so the grid, its bulk dialog and the
  suggestion strip had nothing left to do. Their two notes here ("the board on
  a phone", "one column per list, not per mode") went with them. Giving the
  same order to several students at once is *Give a sequence to N selected…*
  on the Students page. See the README, *Sequences* and *The class page*.

- **Two sequences at once** (2026-11-25). A student can now have a second
  sequence beside the first — e.g. the Red Words lists in one and *Sounding it
  out* in the other — stored as `plan2` next to `plan` on the same assignment
  or roster row, with its own high-water mark `students/{uid}.seq2` beside
  `seq`. Each moves on by itself and the home page shows the current list of
  each. This reverses "one list per student at a time" from the 2026-11-24
  note: a student in two sequences works on two lists at once. A document with
  no `plan2` behaves exactly as before; a list is in one of the two only; no
  `firestore.rules` change. See the README, *Sequences*.

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
