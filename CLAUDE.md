# Working on this repo

Plain static HTML/JS. No build step, no dependencies, no framework. Serve it
with `python3 -m http.server 8000` and open `http://localhost:8000` — never
off a `file://` URL, because the microphone and speech recognition both need
a secure context.

The audience is 9th–10th graders in reading intervention. Every visual and
every line of student-facing copy stays age-respectful: no grade labels, no
elementary-coded imagery, no "Big Words". `README.md` is the long-form
explanation of every part of the site and the reasoning behind it — read the
section covering whatever you are about to touch before you touch it.

## Two documents, and they are not the same document

- **`README.md`** — for whoever is editing the code. Long, opinionated,
  explains why each thing is the way it is.
- **`docs/overview.html`** — for a reading teacher. What the site does, in
  their vocabulary, with none of the implementation. Published as an
  Artifact at
  <https://claude.ai/code/artifact/a711f0ee-9868-4a7d-a7fd-5923c92b2057>,
  and that link is the copy people actually read.

**Change one, consider the other.** Any change a teacher would notice — a
new mode or family, a changed rule about how rounds get drawn or what
unlocks, a claim about what a number means, a renamed thing they see on the
dashboard — updates `docs/overview.html` in the same commit as the code.
Internal refactors, tests and comments do not.

**Bump the date when you change it.** The page carries an "Updated
&lt;date&gt;" stamp in its masthead, which is how a teacher tells whether what
they are reading still describes the site. A change that doesn't move the
date is worse than no change: it makes a stale page look checked.

To republish the overview after editing it, publish `docs/overview.html`
with `url` set to the artifact address above. Publishing it without the
`url` creates a second, unrelated artifact, and the link already handed out
quietly goes stale.

## Before committing

Run the tests. They need a server on port 8000 and a Chrome binary:

```bash
python3 -m http.server 8000 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bash tools/run-tests.sh
```

It should print `N/N passing` and `uncaught: 0`. `tools/check-pages.sh` and
`tools/boot-check.sh` cover the two things `tests.html` can't: console and
CSP errors on a real page load, and each engine actually starting against
its real list.

`firestore.rules` is the only thing enforcing who may read what. It does not
deploy itself — re-publish it in the Firebase console whenever it changes.

## Watch out for

- **List ids are permanent.** An id is half of every stat key and is what an
  assignment stores, so renaming one orphans a class's practice history.
  `title` is the display name and can change freely.
- **Student-facing copy is read by struggling readers.** Short sentences,
  plain words. The directions should not themselves be a decoding challenge.
- **Two sessions in one working tree share a git index**, and one session's
  commit can sweep up the other's uncommitted changes. Use a worktree when
  another session is live here.
