# PLAN — Roster import, sequences, and next steps

Status: **approved 2026-09-04 for unattended execution**, as a follow-on to
`PLAN-reading-feedback.md`. Written for an opusplan session; nobody is
watching. Repo: `jhoffmanteacher/EnglishIntensive`.

**Start this only after the reading-feedback branch has merged into
`main`** (it touches `store.js`, `adaptive.js`, `teacher.js` and
`tests.html` too — running both at once means merge conflicts in every one
of those files). If `git log main` doesn't show that merge commit yet,
wait for it; do not start on a branch off an older `main`. The only thing
this plan takes from that one is optional (Phase 5 below uses
`Adaptive.isSlow` if it exists).

## Why

The mechanics of assigning are done (picker, period defaults, the Assign
board, bulk set, *Ready to move up*). What's missing is the workflow around
them: a class exists on the dashboard only after every student has signed
in once, nothing places a new student where the screener put them, and
progression is suggest-only and red-words-only. This plan is **practice
workflow only** — no assessment rounds, no scores that gate anything.

## Autonomy rules

The same rules as `PLAN-reading-feedback.md`, which is in the repo root —
read its *Autonomy rules* section first and apply it verbatim (never ask;
first-listed option is the decision; fallbacks noted in `TODO.md` under
*"Decided during the roster build"*; headless `tests.html` after every
sub-phase; ES5 IIFE style; ids permanent). Differences:

- Branch `roster-and-sequences` from `main`, one commit per phase, then
  `git merge --no-ff` into `main` and push.
- **This plan changes `firestore.rules`** (one new collection). Everything
  is built so the site behaves exactly as today until the rules are
  published; Phase 2 says how to publish without a person, and what to do
  when that isn't possible.

---


The mechanics of assigning are done (picker, period defaults, the Assign
board, bulk set, *Ready to move up*). What's missing is the workflow around
them: a class exists on the dashboard only after every student has signed
in once, nothing places a new student where the screener put them, and
progression is suggest-only and red-words-only. This phase is **practice
workflow only** — no assessment rounds, no scores that gate anything.

## Phase 1 — The match key

Students sign in with Google as **`<student ID number>@seq.org`**. A roster
export carries names and ID numbers, so `email = String(id).trim().toLowerCase() + "@seq.org"`
is the join, and it is known **before** the student ever signs in. Nothing
else identifies a student (uids are minted at first sign-in), so the
roster is stored by email.

## Phase 2 — Data and rules (`firestore.rules`, `SETUP-FIREBASE.md`)

- New collection **`roster/{email}`** (document id = the lowercased email;
  `@` and `.` are legal in a Firestore id): `{ name, id, period, startAt?,
  lists?, importedAt }`. Teacher read/write; a student may read the one
  document whose id equals their own address:

  ```
  match /roster/{email} {
    allow read: if isSchool() && request.auth.token.email.lower() == email;
    allow read, write: if isTeacher();
  }
  ```

  Add the block with a comment in the file's voice (why it's keyed by email,
  why the student may read only their own row, why a student can't write
  it). Append `roster/{email}` to the "four paths" list in the header.
- **Publishing the rules unattended.** Try once: `firebase deploy --only
  firestore:rules --project english-intensive` (or `npx -y firebase-tools
  …`). It works only if the CLI is already logged in on this machine
  (`firebase projects:list` says so); logging in needs a browser, so if it
  isn't, **do not try to log in** — put a boxed line at the top of
  `TODO.md` —
  *"PUBLISH firestore.rules: roster/{email} (Phase 7) and notes/{uid} are
  both waiting. Console → Firestore → Rules → paste the file → Publish."*
  — and make it the first line of the final merge commit message. Until
  then every roster read fails and the site behaves as before (see Phase 4).

## Phase 3 — Import (`teacher.js`, `teacher.css`, `game-core.js`)

- Periods & Lists tab gains **📋 Import roster**: a dialog with a drop
  zone / file input (`.csv`, `.tsv`, `.txt`) and a paste box. Parsing is
  pure and in `game-core.js` (`parseRoster(text)` → `{ rows, errors,
  columns }`) and covered by `tests.html`:
  - Delimiter sniffed (comma, tab, semicolon); quoted fields; BOM stripped;
    Windows line endings.
  - Columns found by header, case-insensitive, first match wins: **ID**
    (`id`, `student id`, `student number`, `perm id`, `local id`,
    `permanent id`, `sis id`, `number`), **name** (`name`, `student`,
    `student name`, or `last name` + `first name` joined "First Last"),
    **period** (`period`, `per`, `pd`, `section`, `class`), optional
    **start** (`start`, `start at`, `starting list`, `list`). No header
    row → treat the first row as data and guess: the column whose values
    are all digits is the ID, the one with letters and spaces is the
    name, a column of 1–2 digit values is the period.
  - Period values normalised to the digit(s) (`"Period 3"`, `"P3"`, `"3rd"`
    → `"3"`); a period the class doesn't have yet is created (appended to
    `config/class.periods`).
  - `start` accepts a list id (`red-3-cards`) or a shorthand the picker's
    summary line already prints (`Red 3`, `Red Words 3`, `oi/oy`,
    `Blends`) → resolved via `WordLists` to a family + list number;
    unresolvable values are listed as warnings, not errors.
  - Errors (missing ID, non-numeric ID, duplicate ID) are shown per row
    with the row kept out; the rest imports.
- Preview table before commit: name, email, period, start, and a status
  column — *new*, *update* (row exists), *already signed in* (a
  `students` doc with that email exists). Import writes one `db.batch()`
  of `roster/{email}` set-merge writes (chunks of 400) and `config/class`
  periods. **Re-import never deletes**: a student missing from the new
  file keeps their row. A *Remove from roster* on the student page deletes
  one row.
- After import, reconcile: for every `students` doc whose email has a
  roster row and **no** `assignments/{uid}` doc, write `assignments/{uid}
  = { period, lists? }` from the row, in the same batch. This is the only
  place the roster writes into assignments, and it only ever fills a
  blank — a manual period move is never overridden by a re-import.
- Students tab: roster rows with no `students` doc yet render greyed as
  "not signed in yet" under their period, so on day one the roster shows
  who is missing. They are excluded from accuracy averages, CSV exports get
  them with blank stats, and the Assign board shows them as rows too
  (assignment edits for them write `roster/{email}.lists`, which Phase 4 and
  the reconcile step turn into the real thing at first sign-in).

## Phase 4 — Match on sign-in (`store.js`)

- `load()` adds a fourth read, `roster/{email.toLowerCase()}`, **with its
  own `.catch(() => null)`** — a permissions failure (rules not yet
  published) or a missing row must never trip the `loadFailed` latch; that
  latch is for the student's own record only.
- `effectiveLists(assignment, classCfg, allIds, roster)`: the walk becomes
  **own assignment → roster row `lists` → period (from assignment, else
  roster row) → class default → everything**. `EIStore.period()` returns
  the roster period when the assignment has none. Tests pin every rung and
  the roster-null case (identical to today).
- Nothing is written by the student: `assignments/{uid}` stays
  teacher-only. The dashboard's reconcile (Phase 3) fills it in the next time
  the teacher opens the dashboard, and nothing changes for the student
  when it does because the precedence gives the same answer.

## Phase 5 — Sequences with auto-advance (`word-lists.js`, `adaptive.js`, `store.js`, `teacher.js`, `index.html`)

Turns *Ready to move up* from a suggestion into something the site does,
without anyone writing to `assignments`: a student's position in a
sequence is a **pure function of their own stats**, which their client
already has, so it is computed in the browser on both sides.

- `config/class.sequences[period]` = ordered array of *steps*, each a list
  id set that unlocks together, e.g. `[["red-1-cards"], ["red-1-match",
  "red-2-cards"], ["red-2-match","red-3-cards"], …]`, plus
  `config/class.sequenceOn[period]` (boolean, default **true** when a
  sequence exists). A default sequence per period is generated on first
  use by `WordLists.defaultSequence()`: Starting Blends → Blend Words →
  oi/oy → Multisyllable (each family: say, then cards, then match, each
  step unlocked by the previous), then Red Lists 1–10 (cards N unlocks
  match N and cards N+1). Nonsense words run alongside step 1 throughout
  (they are warm-up, not a stage).
- `Adaptive.unlocked(sequence, stats, startAt)` (pure): walk the steps from
  `startAt` (index, default 0); a step is *done* when every list in it has
  `mastered / total >= SOLID_ENOUGH` (move `SOLID_ENOUGH` from `teacher.js`
  into `adaptive.js`; teacher aliases it). Returns `{ ids, stepIndex,
  done }` where `ids` is the union of every step up to and including the
  first not-done one — **additive**, as the README argues: finished lists
  stay in rotation. Uses `isMastered && !isSlow` for card lists when `Adaptive.isSlow` exists (it arrives with the reading-feedback plan's Phase 2.1); plain `isMastered` otherwise.
- `store.js`: when the student has **no own `lists`** and their period has
  a sequence switched on, `effectiveLists` returns `unlocked(...)` instead
  of the period's flat list; the flat `periodLists` remains the fallback
  when `sequenceOn` is false. A student's own lists always win (that's the
  teacher override). `startAt` comes from the roster row's `start`
  resolved to a step index, else 0.
- Home page: when `stepIndex` grew since the last visit (remember it in
  `localStorage`), a one-time banner — "🔓 New: Red Words · List 4" —
  above the tiles. No lock icons on anything else; lists not yet reached
  simply aren't shown, exactly as an unassigned list isn't today.
- Teacher: the Periods & Lists tab gets a **Sequence** editor per period —
  the steps as a draggable ordered list of the same picker rows, an
  *on/off* switch, and *Reset to default*. The Assign board shows a
  sequence-driven cell dashed like an inherited one, with a small step
  number; the *Ready to move up* strip only lists students in periods
  with the sequence **off** (for the others the site already did it).
  `readyToAdvance` is refactored to call `unlocked()` so the two agree —
  a test runs both on the same stats.

## Phase 6 — Next steps panel (`teacher.js`, `adaptive.js`)

A short, opinionated "what should change" list at the top of the Students
tab, from data the dashboard already loads. `Adaptive.nextSteps(summaryByList)`
is pure and returns at most one line per student, first rule wins:

1. **Stuck on cards** — a card-mode list with ≥ 30 attempts and
   `mastered/total < 0.4` for two weeks → "back to Say It on this list"
   (if the family has say) else "try Match It first".
2. **Match It before cards solid** — match-mode accuracy < 50 % on a list
   whose cards are < 60 % solid → "cards first".
3. **Coasting** — every assigned list ≥ 90 % solid and sequence off →
   "turn the sequence on, or add the next list".
4. **Quiet** — no round in 7 school days → "hasn't practised since <date>".

Each line has the same one-click *apply* button the *Ready to move up*
strip uses, feeding the board's draft and Save. Filterable by period.
Tests: each rule with a hand-built summary; precedence; empty class.

## Phase 7 — Docs

README gains "Roster import", "Sequences" and "Next steps" sections in
the dashboard chapter, and the precedence line becomes *own → roster →
sequence/period → default → everything*. `SETUP-FIREBASE.md` gets the
rules-publish reminder. `TODO.md`: retire the "progression rules" note.

---

---

## Verification checklist (after every phase)

- `node --check` on every touched `.js`; headless `/tests.html` all passing.
- Every page loads headlessly with no `Uncaught` in the console.
- With the rules **not** published: sign-in path unchanged (the roster read
  fails silently, the student sees what they saw before). Assert by
  stubbing the roster read to reject in a `tests.html` case for
  `effectiveLists`.
- README, `SETUP-FIREBASE.md` and `TODO.md` updated; commit made.

## Files

`firestore.rules`, `SETUP-FIREBASE.md`, `game-core.js` (roster parser),
`store.js`, `adaptive.js`, `word-lists.js`, `teacher.js`, `teacher.css`,
`index.html`, `tests.html`, `README.md`, `TODO.md`.

## Not doing (and why)

- **Assessment rounds** (an unweighted "show me" pass before moving on):
  this is a practice site. Sequences advance on practice data alone.
- **Matching by name**: names collide and get retyped; the ID-derived
  email is the only key. A roster row without an ID is rejected, never
  guessed.
- **Students writing their own `assignments/{uid}`** to self-advance: the
  rules keep that collection teacher-only on purpose; Phase 5 computes
  position client-side instead, so no write is needed.
- **Deleting roster rows on re-import**: a student dropped from an export
  by mistake would lose their period; removal is one explicit click.
