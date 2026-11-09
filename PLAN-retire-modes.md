# PLAN — Retire the modes that don't earn their place

Status: **done 2026-11-09.** Built as written; the deviations are in
`TODO.md` under *Decided during the retire-modes build*, and the result is
described in the README's *Retired modes*. Kept as the record of what was
planned. Original status: draft, awaiting approval. Written for a
Claude Code session on `jhoffmanteacher/EnglishIntensive`. Read `CLAUDE.md`
first, then the *Families and modes* comment at the top of `word-lists.js`.

## Why

Six families × up to five modes is 25 list×mode combinations on the Assign
board, and a few of them are the same skill wearing a different icon. An
evaluation on 2026-11-09 found three that add a column without adding a
skill:

| Family | Mode | Why it goes |
|---|---|---|
| Starting Blends, Blend Words | **Blend it** 🔊 | Built for CVC blending from sound. On a 28–31 word *real*-word list it is an easier Say it: a student who can read *clam* learns nothing from hearing /k/ /l/ /a/ /m/ first. It stays on Nonsense Words, where blending is the whole point. |
| Starting Blends, Blend Words | **One minute** ⏱ | A rate measure on a 28–31 word list — a decent reader laps it twice in a minute, and the number is mostly noise. It stays on Nonsense (40 words, and rate of *decoding* is the real question there). |
| Red Words | **Match It** 🎯 | Defensible but off-target: red words are about reading on sight, and Match It hands the student the word by ear. Kept as the no-mic option, **not** retired — see Phase 3. |

After this plan: Blends 5 → 3 modes (Say it · Cards · Match It). Nonsense,
oi/oy, Multi and Red unchanged. 25 combinations → 21.

## The one rule that shapes everything below

**List ids are permanent.** An id is half of every stat key and is what an
assignment stores. Deleting `blends-start-1-blendit` from the registry
would orphan every student's history on it and leave dangling ids in
`assignments/{uid}` and `roster/{email}.lists`. So a mode is **retired, not
removed**: the id keeps existing and keeps resolving, it just stops being
offered.

## Autonomy rules

Same as `PLAN-roster-and-sequences.md`: never ask; first-listed option is
the decision; fallbacks noted in `TODO.md` under *"Decided during the
retire-modes build"*; headless `tests.html`, `tools/check-pages.sh` and
`tools/boot-check.sh` after every phase; ES5 IIFE style. Branch
`retire-modes` from `main`, one commit per phase, `git merge --no-ff` into
`main`, push. No Firestore rules change in this plan.

---

## Phase 1 — A `retired` flag on a family's mode (`word-lists.js`)

- Families gain an optional **`retired: ["blendit", "fluency"]`** array
  beside `modes`. Add it to `blends-start` and `blends-end`. The modes stay
  in `modes` so the registry still generates their entries and ids.
- Every generated entry gets a boolean **`retired`**.
- `WordLists.modesOf(familyKey)` keeps returning every mode (the board and
  the detail page need to *show* a retired mode a student still has). Add
  **`WordLists.offeredModesOf(familyKey)`** = `modesOf` minus retired, and
  **`WordLists.isRetired(id)`**.
- Comment in the file's voice, next to the *Families and modes* block: what
  retired means, why the id survives, and that un-retiring is deleting one
  string.
- `tests.html`: ids for the retired modes still exist and resolve;
  `offeredModesOf("blends-start")` is `say, cards, match`; `isRetired` on
  one retired and one live id; a family with no `retired` key is unchanged.

## Phase 2 — Stop offering them (`teacher.js`, `index.html`, `store.js`)

- **Assign board.** Columns come from `offeredModesOf`. A student who
  *already has* a retired id keeps it in their row: render that cell in the
  existing "inherited/dashed" style with a `title` of "Retired — still in
  this student's list", and let the teacher untick it. Bulk "Add to what
  they have" / "Replace" never adds a retired id. `idsOfFamily` /
  `idsOfList`, which column toggles use, exclude retired ids; add
  `…Including` variants only if a caller genuinely needs them (first option:
  nobody does).
- **Student page picker** (`teacher.js` ~540): same — offered modes only,
  retired ones shown ticked-and-dashed if held.
- **Student home** (`index.html` via `store.js` `effectiveLists`): a
  retired id a student still has **keeps working** — the tile shows and the
  game plays. Nothing a student sees changes until the teacher unticks it.
  `seesEverything()` (teacher preview) uses offered ids only.
- **Describe lines** (`describeFamily`, `describeAssignment`): unchanged;
  they describe what a student has, which may include a retired id.
- **Next steps / Ready to move up** (`adaptive.js`, `teacher.js`): any rule
  that *suggests* adding a list must pick from offered ids only. Check
  `nextSteps` rule 1 ("try Match It first" / "back to Say it") and the
  default sequence, if `defaultSequence` exists in this tree — it did not
  on 2026-11-09, so first option is: nothing to do.
- Tests: `effectiveLists` with an assignment holding a retired id still
  returns it; board column count for `blends-start` is 3; a bulk add on a
  blends column never yields a retired id.

## Phase 3 — Red Words · Match It stays, but isn't the default

- No code change to the registry. Two copy changes:
  - Assign board column header tooltip for `red` × `match`: "No-mic option.
    Red words are for reading on sight; Match It gives the word by ear."
  - `overview.html` Red Words row: same sentence, in the teacher's words.
- If there is any "assign the family's default modes" shortcut (period
  defaults, roster `start`), it picks `say` + `cards` for red, not `match`.
  First option if no such shortcut exists: nothing to do.

## Phase 4 — Docs (`overview.html`, `README.md`, `TODO.md`)

- `overview.html`: families table — Starting Blends and Blend Words rows
  become *Say it · Cards · Match It*. Add one line under the modes table:
  "Blend it and One minute are offered on Nonsense Words only. A student
  who was given them on a blends list before November 2026 keeps them
  until the teacher removes them." **Bump the Updated date.**
- `README.md`: a *Retired modes* subsection in the lists chapter — the
  flag, why ids survive, the three decisions above with their reasons, and
  how to un-retire. Update the "seven modes / N combinations" counts
  wherever they appear.
- `TODO.md`: retire any note about adding Blend it or One minute to more
  families; add "consider Spell it for blends" as the one new idea this
  evaluation produced.

---

## Verification checklist (after every phase)

- `node --check` on every touched `.js`; `tools/run-tests.sh` prints
  `N/N passing` and `uncaught: 0`; `check-pages.sh` and `boot-check.sh`
  clean.
- Open `teacher.html` as a teacher preview: blends columns are 3 wide; a
  hand-written assignment with `blends-start-1-blendit` still shows as a
  dashed cell and still appears on that student's home page.
- `overview.html` date moved; README counts match the registry.

## Files

`word-lists.js`, `teacher.js`, `teacher.css` (if the dashed-cell style
needs a variant), `store.js`, `adaptive.js` (read-only unless a rule picks
ids), `tests.html`, `overview.html`, `README.md`, `TODO.md`.

## Not doing (and why)

- **Deleting the retired ids or their pages.** History and stored
  assignments reference them; `blend-it-game.html` and `fluency-game.html`
  are still needed for Nonsense anyway.
- **Migrating existing assignments off the retired ids.** A student who
  has one keeps it until the teacher unticks it. Silent migration would
  change what a student sees without the teacher doing anything.
- **Retiring Red Words · Match It.** It is the only no-mic, no-self-report
  activity red words have. Downgraded to not-default, not removed.
- **Merging the two blend lists into one 59-word fluency list.** Tempting,
  but it is a new list id and a new family decision; park it in `TODO.md`.
- **Adding Spell it to blends.** Good idea, separate plan.
