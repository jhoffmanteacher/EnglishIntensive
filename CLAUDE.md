# Working on this repo

Plain static HTML/JS: no build step, no dependencies, no framework. Serve with
`python3 -m http.server 8000` and open `http://localhost:8000`, never a
`file://` URL (the mic and speech recognition need a secure context).

## Models and effort

| Job | Model | Effort |
|---|---|---|
| Ordinary build or content change | Opus | medium |
| Most building and fixing | Opus | high |
| Save path, database rules, listening code, unknown-cause bugs, designs with real choices | Opus | xhigh |
| Review | Opus | high (xhigh for risky areas and the Friday check) |
| Mechanical jobs: run a tool and report, searches, copying, screenshots, rebases | Sonnet | low or medium |

- Every agent spawned must name its model and effort.
- Never use max effort.
- If unsure, use Opus.
- A Fable review runs only when you ask for one.

## Audience

9th–10th graders in reading intervention. Every visual and every line of
student copy stays age-respectful: no grade labels, no elementary-coded
imagery, no "Big Words". Student directions use short sentences and plain
words; they must not be a decoding challenge themselves.

Before touching any part of the site, read its section in `README.md`.

## README.md and overview.html

- `README.md` is for whoever edits the code. It explains why things are the way they are.
- `overview.html` is for a reading teacher: what the site does, no
  implementation. The file is the published page
  (<https://jhoffmanteacher.github.io/EnglishIntensive/overview.html>). It has
  no `auth.js` and no JavaScript, and its CSP says so.

Any change a teacher would notice (a new mode or family, a changed rule for
drawing rounds or unlocking, what a number means, a renamed dashboard item)
updates `overview.html` in the same commit. Refactors, tests and comments
don't. Every change to it bumps its "Updated &lt;date&gt;" stamp: a stale
date makes an old page look checked.

## Before committing

Chrome checks need `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

- **Always:** with `python3 -m http.server 8000 &` running,
  `bash tools/run-tests.sh` must print `N/N passing` and `uncaught: 0`. Then
  `tools/check-pages.sh` (console and CSP errors on a real load) and
  `tools/boot-check.sh` (each engine starts on its real list).
- **`node tools/save-loop.mjs`** (~1 s, no server or browser) runs after any
  change to `store.js`, sign-in/out in `auth.js`, anything that writes
  `students/{uid}`, or anything that keeps student data in `localStorage` or
  `sessionStorage`. It must end `failures: none` and exit 0. A failing line
  ends with the command that replays it.
- **`node tools/sequence-loop.mjs`** (~90 s, serves itself) runs after any
  change to the sequence editor or Save/Stop/Give a sequence in `teacher.js`,
  `resolve`/`settle`/`plan()` in `store.js`, the plan functions in
  `adaptive.js`, or the home page in `practice.js`. It must end
  `failures: none` and exit 0. `~ known` lines are already-reported faults,
  not failures.
- **`node tools/listen-loop.mjs`** (~45 s, serves itself on 8051) runs after
  any change to how a game listens: `blend-game.js` onresult and matcher,
  `listen.js`, the cards' `judgeHeard`, One minute's alignment, Blend It's
  onresult, `game-core.js` normalize / phonemes / ACCEPT / isNonAnswer /
  soundsLike / spokenMatch / resultGate, or a list's homophones, soundalikes,
  `phonetic` or `join`. It must exit 0 with `pin: every pinned count held`.
  **A listening rule changes only with a before/after from this loop**
  (`--json`, then `--against`), on the real takes in `tools/mic-takes/` when
  there are any. Then re-pin with `--measure` in the same commit and say why.
  Virtual-reader numbers model the logic. Only the takes are a measurement.

A Stop hook (`.claude/hooks/stop-checks.mjs`) runs `node --check` on every
root `.js` and `tools/*.mjs`, plus `save-loop.mjs`, after any Claude Code turn
that changed a site file. It stays silent unless something fails. It does
**not** run the Chrome checks. `EI_STOP_CHECKS=0` turns it off. GitHub runs
every check on each push (`checks.yml`) and `tools/rules-test.mjs` on pushes
to main (`rules.yml`).

`firestore.rules` is the only thing enforcing who may read what. It doesn't
deploy itself: whenever it changes, re-publish it in the Firebase console.

## Which loop after which change

Run the row for what you changed. GitHub runs everything on every push, so
nothing else has to run here. A row's browser tools count toward the limit
below.

| Changed | Run before committing |
|---|---|
| anything on the site | `run-tests.sh`, `check-pages.sh`, `boot-check.sh` |
| `store.js`, sign-in or sign-out in `auth.js`, anything that writes `students/{uid}`, a student's data in `localStorage` or `sessionStorage` | `save-loop.mjs` |
| the sequence editor, Save, Stop or Give in `teacher.js`; `resolve`, `settle`, `plan()` in `store.js`; the plan functions in `adaptive.js`; the home page in `practice.js` | `sequence-loop.mjs` |
| how a game listens (the paragraph above lists the pieces) | `listen-loop.mjs`, before and after |
| `firestore.rules`, sign-in, what the site saves, a teacher's buttons, the downloads | the emulator loops (GitHub only: push to a side branch and read the result) |

- **Never weaken a loop to make it pass.** A failing loop is a real gap: fix
  the site. If the loop itself is wrong, say so and why before changing it.
- **At most two browser runs at once on this Mac**, helpers included, and
  only one heavy one (`sequence-loop`, `listen-loop`).
- **The emulator runs on GitHub only.** Nothing is installed for it here.
- **No test touches the real Firebase project or real student data.**

## Watch out for

- **List ids are permanent.** An id is half of every stat key and is what an
  assignment stores, so renaming one orphans a class's history. `title` can
  change freely.
- **Two sessions in one working tree share a git index**, so one session's
  commit can sweep up the other's changes. Use a worktree when another session
  is live here.
