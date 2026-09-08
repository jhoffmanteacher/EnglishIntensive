# Plan: finish the review fixes

A review of everything committed between Sept 3 and Sept 8 (the shared
core, the dashboard, the roster and sequences, the fluency run) turned up
about twenty-five real bugs. The engine-side ones are already fixed on
this branch (see `git log` — "Fix what the review of the week's engines
turned up"). What is left is the dashboard, the roster, and the tests
that pin all of it. Every item below was verified against the code, with
the failing scenario written down, so this can be worked cold.

Work it top to bottom. Each item is one small, local change. Run the
three checks (bottom of this file) before committing, and commit in
sensible groups — one commit per section is about right.

Conventions: no build step, no dependencies, ES5 style (`var`, no arrow
functions), comments that say *why*. Ids are permanent. Nothing here
changes a stat key or a list id.

---

## 1. `teacher.html` — the roster import can't run

`teacher.js:308` calls `GameCore.parseRoster(...)`, but `teacher.html`
never loads `game-core.js` (lines 48–54 load firebase, auth, adaptive,
word-lists, teacher). Pasting a roster throws `ReferenceError: GameCore
is not defined` in the `input` handler; the preview never renders.
`tests.html` loads the core first, which is why the tests pass.

**Fix:** add `<script src="game-core.js"></script>` before
`word-lists.js` in `teacher.html`. Then run
`tools/check-pages.sh teacher.html` to confirm the page still boots
clean (the core applies reading-view classes to `<html>` on load; that
is harmless on the dashboard).

## 2. `teacher.js` — roster field name

`importBody` (≈ line 393) writes the roster document's starting list as
`startAt`, `store.js:144` reads `roster.startAt`, and `tests.html:1885`
pins the field name. But `loadAll` (≈ line 169) maps the row as
`start: d.start || ""`, so on the dashboard the start is always empty:
the student's home page unlocks from the placed step while the board
cell, "Ready to move up" and the next-steps panel reason from step 0.

**Fix:** `start: d.startAt || ""` at line 169. Leave the in-memory
field named `start` (it is used at ≈ 283 and ≈ 2169).

## 3. `word-lists.js` + `store.js` + `teacher.js` — a start that isn't in the course

`resolveListRef("Red 3")` returns the family's FIRST mode, `red-3-say`
(word-lists.js ≈ 632–640; TODO.md records this as deliberate). But
`defaultSequence` (≈ 706–724) builds the red ladder from `cards` and
`match` only, so `stepOf(defaultSequence(), "red-3-say") === -1`, and
both `store.js:146` and `teacher.js:2170` read -1 as "start at the
beginning". The exact shorthand the import dialog advertises places
every such student at step 0, silently.

**Fix:** add to the `WordLists` object, next to `stepOf`:

```js
    /* Where a roster row's "starts on" lands in a course. The id itself
       if the course has it; otherwise the earliest step holding any mode
       of the same list — "Red 3" resolves to red-3-say, and a course
       built from cards and match still has a place for List 3. -1 only
       when no mode of that list is a rung. */
    startStepOf: function(sequence, listId){
      var at = this.stepOf(sequence, listId);
      if(at !== -1) return at;
      var l = index[listId];
      if(!l) return -1;
      var best = -1;
      this.idsOfList(l.family, l.listNum).forEach(function(id){
        var s = this.stepOf(sequence, id);
        if(s !== -1 && (best === -1 || s < best)) best = s;
      }, this);
      return best;
    },
```

Check that `index` and `idsOfList` are the names actually in scope
there (they are used elsewhere in that object). Then:

- `store.js:331`: pass `WordLists.startStepOf` instead of `stepOf`.
- `teacher.js:2170`: `WordLists.startStepOf(steps, r.start)`.

## 4. `teacher.js` — "Use my period's lists" is a no-op after a roster placement

A pending student assigned lists on the board gets them on
`roster/{email}.lists` (saveBody ≈ 2647). After sign-in, "Use my period's
lists" / own ↺ write `assignments/{uid}.lists = null` (≈ 1301 and
saveBody ≈ 2650), but the precedence walk (`store.js:88`,
`teacher.js:487`) then falls through to `roster.lists`, which is still an
array. Nothing the teacher can press changes that student's lists except
"Remove from roster".

**Fix:** when clearing a signed-in student's lists, also null the roster
row's lists in the same write:

- `saveStudentAssignment` non-pending path: if `clearLists` and
  `rosterFor(studentByUid(uid))` has an array `lists`, chain a
  `db.collection("roster").doc(email).set({ lists: null, updatedAt: now }, { merge:true })`
  after the assignment write, and update the local `roster[email].lists`
  (roll it back in the `.catch`).
- `saveBody`: in the signed-in branch, when `val === null` and the
  student's roster row has `lists`, add
  `out.roster[email] = { lists: null, updatedAt: now }` alongside the
  `out.students` entry. `saveBoard` already writes every `out.roster`
  entry as a merge, so nothing else changes.

## 5. `teacher.js` — a student's period is read two different ways

`studentPeriod(uid)` (≈ 1822) reads only `assignments[uid].period`.
Everything else — `effectiveLists` (≈ 492), the Students tab (≈ 859),
`liveStudent` (≈ 1782), `nextStepRows` (≈ 997), `rosterCsv` (≈ 769),
`store.js:106` — uses `assignment.period || roster.period`. Since
`importBody` only writes an assignment for students who were *already*
signed in, a student imported with period 3 who signs in later has
no assignment period: the Students tab says "Period 3", the Assign board
lists them under "No period yet" (and the Period 3 filter hides them),
`renderTrouble` (≈ 2807) and `wordsCsv` (≈ 790) drop them from the period.

**Fix:** make `studentPeriod` do the same walk:

```js
  function studentPeriod(uid){
    var a = assignments[uid] || {};
    var r = rosterFor(studentByUid(uid));
    var p = a.period || (r && r.period);
    return p == null || p === "" ? null : p;
  }
```

and use `studentPeriod(s.uid)` at ≈ 790 (`wordsCsv`), ≈ 2807
(`renderTrouble`), and in the Periods-tab select (≈ 1560, where
`a.period === p` picks the selected option).

## 6. `teacher.js` — the Periods tab writes a bogus doc for pending students

`setStudentPeriod(uid, period)` (≈ 1646) has no pending branch, so
choosing a period for a not-yet-signed-in row (uid `roster:<email>`)
writes `assignments/roster:<email>`. The dashboard shows it applied, but
on sign-in `store.js` reads `assignments/{realUid}` and lands them on the
roster's old period; the orphan doc lives on and keeps feeding
`allPeriods()`.

**Fix:** mirror `saveStudentAssignment` (≈ 1274): if `isPending(uid)`,
write `roster/{emailOfPending(uid)}` with `{ period: period || "", updatedAt }`
(merge) and update `roster[email].period` locally, rolling back on
failure. Otherwise unchanged.

## 7. `teacher.js` — notes on pending students are orphaned

`renderDetail` shows the note panel (≈ 1252) for pending rows and
`saveNote(s.uid)` writes `notes/roster:<email>`. At sign-in
`addPendingStudents` drops that pseudo-uid and the note is never seen
again.

**Fix:** in `renderDetail`, render the note panel only when
`!s.pending`; for a pending student show one muted line instead:
"Notes open once they have signed in." Guard the `tNoteSave` listener
binding (≈ 1199) with the same condition so it doesn't throw on a
missing element.

## 8. `teacher.js` — small ones

- **≈ 1557, `renderGroups`:** `var roster = students.map(...).join("")`
  shadows the module-level `roster` map, so line ≈ 1581's
  `Object.keys(roster).length` reports the HTML string's length ("4812 on
  the roster now"). Rename the local to `rosterRows` (declaration and the
  `"<tbody>" + roster + "</tbody>"` use at ≈ 1598).
- **≈ 663, `renderSub`:** `students.length` counts pending rows, so "30
  students have signed in" with nobody signed in. Count
  `students.filter(function(s){ return !s.pending; })`.
- **Selectors:** `scopeId.replace(/"/g,'')` at ≈ 573, 579, 585, 1622 and
  `p.replace(/"/g, '\\"')` at ≈ 1382, 1495 build attribute selectors by
  hand. A period named with a `"` makes `scopeSelection` return `[]` and
  Save writes an empty list (parking every student in it); a backslash
  makes `querySelector` throw. Add one helper near `esc`:

  ```js
  // For attribute selectors built from a period name or scope id.
  function cssq(s){
    s = String(s == null ? "" : s);
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }
  ```

  and use `'[data-scope="' + cssq(scopeId) + '"]'` etc. at all six sites.
- **≈ 984, `nextStepInfo`:** `sequenceOn: !!seq` is true even when the
  student's own `lists` override the sequence, so the "Coasting → turn
  the sequence on" line is suppressed for overridden students. Use
  `sequenceOn: !!eff.seq` (`eff` is the `effectiveLists` result already
  in scope; it carries `seq` only when the sequence rung won).
- **≈ 474–481:** two comment blocks are stacked above `effectiveLists`;
  the first ("Same precedence as EIStore.effectiveLists, restated here…")
  is the stale one. Delete it, keep the second.

## 9. `store.js` — comment

Lines ≈ 78–83 describe the walk as "own assignment, then their period's,
then the roster row, then their period's". The code (and README ≈ 1489)
is own → roster lists → sequence → period → class default → everything.
Rewrite the sentence to match the code.

## 10. `game-core.js` — `mapColumns` lets "Class" steal the period column

`ROSTER_HEADERS.period` (≈ 1236) lists `class`, `section`, `block`
alongside `period`, `per`, `pd`, and `mapColumns` (≈ 1290) claims the
first header that matches anything. An SIS export
`Student ID,Name,Class,Period` with `Class = "English 9 Intensive"` maps
`Class` as the period, `normalizePeriod` turns it into "9", and the real
`Period` column is ignored — with a plausible-looking preview.

**Fix:** keep the aliases but rank them. Add
`var WEAK_PERIOD = { section:1, "class":1, block:1 };` and in
`mapColumns`, when a header is a strong period alias and `period` was
claimed by a weak one, let it take the column over. Simplest shape:
record `weak[k] = true` when the claim came from a weak alias; on a later
header, allow the claim if `!has(out, k) || (weak[k] && !WEAK[h])`. Only
`period` has weak aliases today; write it generally but don't over-build.

## 11. `practice.js` — the unlock banner is remembered per device, not per student

`unlockBanner` (≈ 316–325) keys the remembered step as
`"eiStep:" + period`. On a shared Chromebook, two students in the same
period at different steps overwrite each other: one never sees a banner,
the other is re-told "New:" every time. `store.js:41` already scopes its
local mirror by uid.

**Fix:** `var key = STEP_KEY + (EIAuth.uid() || "") + ":" + (seq.period || "");`
(`EIAuth.uid()` exists — `auth.js:385`).

## 12. Docs

- `SETUP-FIREBASE.md` ≈ 79: `--project english-intensive` is the display
  name; the id in `firebase-config.js:19` is `english-intensive-98d00`.
  Use the real id in the command.
- `README.md` ≈ 615 and ≈ 629 say `pointsFor()` and `pickVoice()` live in
  `blend-game.js`; both are in `game-core.js` now (`Core.pointsFor`,
  `Core.voice`). Fix the two references.
- `PLAN-roster-and-sequences.md` Phase 3 says the reconcile turns roster
  `lists` "into the real thing at first sign-in"; `importBody` only
  copies `period`, and README describes that correctly. Add one line to
  the plan saying the lists stay on the row and the assignment outranks
  them (which is what item 4 above depends on).
- `TODO.md`: under "Decided during the roster build", the "Red 3 resolves
  to the family's FIRST mode" bullet should gain a sentence: the course
  may not hold that mode, so `startStepOf` lands on the earliest step
  holding any mode of that list.

## 13. `tests.html` — pin all of it

Add these next to the existing tests for each area (the file is
organised by section; `eq(name, got, want)` is the assertion). Every one
of these should FAIL on the code before its fix and pass after — check
that for at least the first three by stashing the fix.

**Say It matcher** (near the existing `isMatch` tests; the hook is the
`_test`-style object at the bottom of `blend-game.js` ≈ 1240 exposing
`isMatch` / `wordMatches`):
- `isMatch("wednesday", "Wednesday", 0, true, 0, [], null, null)` is `true`
- `isMatch("mrs", "Mrs.", 0, true, 0, [], null, null)` is `true`
- `isMatch("mr", "Mrs.", 0, true, 0, [], null, null)` is `false`

**Fluency alignment** (the `read()` helper block ≈ 925–1000; `F` is the
fluency test hook):
- `read("soft honk cost")` → `"soft✓ golf✗ honk✓ cost✓"` (a skipped word
  no longer desyncs the run)
- `read("soft honk")` with `flush` off still decides: pointer 3, marks
  `soft✓ golf✗ honk✓`
- `F.consume(0, ["soft","um"], LIST, exact, false).consumed` is `1`
- every word of every list is a real answer:
  `WordLists.ids.every(id => WordLists.wordsOf(id).every(w => !GameCore.isNonAnswer(w)))`
  (write it ES5) — the fluency run now drops non-answers before
  aligning, so no list word may be one.

**Course placement** (the "generated course" block ≈ 2033):
- `W.startStepOf(seq, "red-3-say") === W.stepOf(seq, "red-3-cards")`
- `W.startStepOf(seq, "red-3-cards") === W.stepOf(seq, "red-3-cards")`
- `W.startStepOf(seq, "oi-oy-spell") === W.stepOf(seq, "oi-oy-read")`
- `W.startStepOf(seq, "zz")` is `-1`
- `S.sequenceState({ period:"3" }, cfg, { startAt:"red-3-say" }, {}, TOT, W.startStepOf).stepIndex`
  equals the cards step (mirror of the existing `startAt:"d"` test at
  ≈ 2080; build `cfg` with the default course).

**Roster parser** (≈ 1224, `P(text)`):
- `P("Student ID,Name,Class,Period\n1,Ana Ruiz,English 9 Intensive,3").rows[0].period` is `"3"`
- `P("Student ID,Name,Class\n1,Ana Ruiz,English 9 Intensive").rows[0].period` is `"9"`
  (a lone Class column is still the fallback)

**Dashboard** (the `T2` blocks ≈ 1853–1957; `feed(aClass())` loads a
fake class):
- feed a class whose roster row for a signed-in student has
  `startAt: "red-3-cards"` and whose period runs the default course
  (`config.sequences` or however `aClass()` shapes it — read
  `sequenceOf` to see which field); assert
  `T2.effectiveLists(uid).seq.stepIndex === W.stepOf(W.defaultSequence(), "red-3-cards")`.
- saveBody: roster row `{ lists:["nonsense"] }` for signed-in `u2`,
  `T2.setScope("s:u2", ...)` then `T2.releaseScope("s:u2")`,
  `T2.saveBody(["s:u2"], 500)` → `b.students.u2.lists === null` AND
  `b.roster["2@seq.org"].lists === null`.
- `studentPeriod`: expose it on `_internals` if it isn't, feed a class
  where `u2` has no assignment but a roster row with `period:"3"`, assert
  `T2.studentPeriod("u2") === "3"`.

**Boot check** (`tools/boot-check.html`, next to `fluency-revision`):
add `"fluency-skip"` — same setup, then: interim `w[0] + " " + w[1]`
(index 0, not final); press Space (`document.dispatchEvent(new KeyboardEvent("keydown", { key:" " }))`
or click whatever `#btnSkip`-equivalent the run screen has — read
`fluency-game.js` for the binding); then final `w[0] + " " + w[1]`
(index 0). Expect `#uiRight` = 2 and `#uiWrong` = 1. Before the fix this
read 2 right and 3 wrong. Add `fluency-skip` to `GAMES` in
`tools/boot-check.sh`.

## Validation

```bash
python3 -m http.server 8000 &
export CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # or whatever is installed
bash tools/run-tests.sh          # expect N/N passing, uncaught: 0
bash tools/boot-check.sh         # expect "engines ok: …"
bash tools/check-pages.sh index.html teacher.html say-game.html cards-game.html \
  match-game.html fluency-game.html blend-it-game.html initial-blends-game.html \
  blend-words-game.html nonsense-words-game.html oi-oy-words-game.html \
  multisyllable-words-game.html spelling-oi-oy-game.html red-words-game.html \
  red-words-match-game.html      # expect "pages clean: …"
```

The test count was 1617 before this plan; it should go up by roughly
twenty. Then commit on `claude/review-changes-improvements-tpzx7x` and
push with `git push -u origin claude/review-changes-improvements-tpzx7x`.
Delete this file in the last commit — it is a work order, not
documentation.

## Already done on this branch (don't redo)

- README "Families and modes" table, "Adding to the library", "Pages";
  `word-lists.js` "seven modes" banner and the red family's note.
- `blend-game.js`: `NUM_WORDS` export/alias, normalised-target match,
  comeback key by list id, advance timer cleared in `finish()`,
  `sayChunked` voice, `say(…, { rate })`.
- `card-game.js`: comeback key, Hear-yourself card guard.
- `match-game.js`: comeback key, first-miss replay timer.
- `blend-it-game.js`: `next()` bails after End game.
- `practice.js`: `cfg.listId`.
- `fluency-game.js`: skipped-word rule, `consumed`, skip replay inside a
  revised result, filler filter, Done-early rate, `snap = null` on
  `onend`.
- `game-core.js`: `numberWords` export.
