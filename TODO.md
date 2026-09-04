# TODO

What's left after the assignment-board work, roughly in the order it's
worth doing. Nothing here is blocking: the site is complete and tested as
it stands. Items are written so they can be picked up cold.

Things that were considered and deliberately *not* done are at the bottom,
with the reasoning, so they don't get re-proposed every few months.

---

## Next

### Progression rules

Auto-advance a student when they've finished something: when Red List *n*
is solid, put List *n+1* on them. Today every move is a manual tick, which
is fine for a class of 30 moving together and tedious for the three
students who are ahead.

The pieces already exist — `Adaptive.summarize(statsFor(id))` gives
`mastered` / `total` per list, and the board already knows how to write an
assignment. What's missing is the policy and, more importantly, where it
runs. A rule that fires in the student's browser would let a student
advance themselves; it belongs on the teacher's side, either as a
"3 students are ready to move up" prompt on the board (cheap, honest,
keeps the teacher in the loop) or as a real scheduled job (needs a
backend this site doesn't have). **Start with the prompt.**

### Per-student notes

A free-text field on `assignments/{uid}` for "reads well, freezes when
timed" — the kind of thing that currently lives in a teacher's head or a
separate doc. Shows on the student detail page and as a hover on the
board's name column.

Rules-wise this is the one field on `assignments/{uid}` a student should
*not* be able to read about themselves, and right now they can read their
whole row (`allow read: if isSchool() && request.auth.uid == userId`). So
this needs either a separate `notes/{uid}` collection that only the
teacher can read, or a rules change. **Separate collection is simpler and
harder to get wrong.**

### Export

CSV of the roster — name, period, effective lists, accuracy, words solid,
words shaky — for report cards, IEP meetings and anyone who wants the data
in a spreadsheet. All of it is already in memory on the dashboard; this is
a string builder and a `Blob` download, an afternoon at most.

Worth adding a second export of the per-word stats (student × list × word ×
attempts × correct), which is the shape you'd want for looking at a
question the dashboard doesn't answer.

---

## Smaller

- **Arrow-key navigation on the board.** Cells are already
  `tabindex="0"` and Enter/Space opens a cell's modes, so the board is
  usable from the keyboard; arrow keys between cells would make it fast.
  Was explicitly a nice-to-have, not phase 1.
- **Screen-reader labels on board cells.** A cell currently reads as its
  emoji, or as an em dash. It wants an `aria-label` along the lines of
  "Ana, Red Words List 2: Cards, Match It". Cheap, but `paintCells` runs
  over every cell on every edit, so build the label from parts rather
  than re-deriving it.
- **`red-words-game.html` / `red-words-match-game.html` redirects.** Six
  lines each, kept so bookmarks and anything written on paper keep
  working. Delete them once a school year has gone by and nothing links
  there.
- **The board on a phone.** It works — the name column is narrowed at
  640px and the grid scrolls — but 15 columns on a handset is a lot of
  scrolling. The family fold (▾) is the existing escape hatch. Only worth
  more if someone actually assigns lists from a phone.

---

## Considered and not doing

- **Homophone groups and read-aloud sentences for the new Match It
  lists.** The red words need `RED_HOMOPHONES` because no amount of
  listening separates *to* from *two*, and `RED_SENTENCES` because a
  synthesiser reads *does*, *live*, *minute* and *wind* wrong cold. The
  other families have neither problem: their near-misses (*sled* / *bled*,
  *inhibit* / *inhabit*, *maximum* / *minimum*) are minimal pairs that a
  clear read does separate — and telling them apart by ear is the skill
  those lists are for, not an obstacle to it. Adding groups there would
  remove the exercise.
- **Match It for the nonsense words.** The game works by *saying* a word
  and asking the student to find it. A synthesiser handed "vab" guesses,
  and it guesses "verb" often enough that the answer key would be wrong. A
  list with no meanings can only be read, not heard. Same reason their
  cards mode runs with `speak: false`.
- **A say-it mode for the red words.** They are irregular by definition,
  so a phoneme matcher has nothing to check them against — which is the
  whole reason they're taught by sight.
- **Making "everything" a stored sentinel.** Editing an unset class
  default pins the 35 lists it was handing down, so a family added later
  wouldn't reach students who were on the old "everything". Tempting to
  store a marker instead — but that would put a value in
  `config/class.defaultLists` that `store.js`, `firestore.rules` and every
  existing document would have to learn about, to fix a case the board now
  makes visible (an unset default reads *"nothing set"*, and **own ↺**
  puts it back). Not worth the model change.
- **Splitting `word-lists.js`.** It's ~500 lines, most of it word arrays
  and the prose explaining where they came from. Splitting the families
  into their own files would mean six files to open to answer "what is
  this student practising", which is the question the file exists to
  answer in one place.
