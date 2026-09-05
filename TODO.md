# TODO

> ### ⚠ PUBLISH `firestore.rules`
> One block is new since the rules were last published: **`roster/{email}`**,
> which the roster import needs. Everything else in the file — including
> `notes/{uid}` — is already live and unchanged. Firebase console →
> Firestore Database → Rules → paste the whole file → **Publish**. Two
> minutes, and nothing about the roster works until it is done: the site
> behaves exactly as it did before, silently, which is why this is easy to
> miss.

What's left after the assignment-board work, roughly in the order it's
worth doing. Nothing here is blocking: the site is complete and tested as
it stands. Items are written so they can be picked up cold.

Things that were considered and deliberately *not* done are at the bottom,
with the reasoning, so they don't get re-proposed every few months.

---

## Next

*(The three items that were here — progression rules, per-student notes and
export — are all done, and progression is no longer a suggestion: a period
can run a sequence and the site advances students along it by itself. See
the Teacher dashboard section of the README.)*

Nothing outstanding from the assignment-board work. The reading-feedback
build (sound-level feedback, fluency, phoneme clips, sound boxes, patterns)
is done and described in the README; what it wants now is a term of use.

Two things worth watching once it has had one:

- **`ACCEPT` is still hand-edited.** The dashboard's "most often heard as"
  column now shows which mishearings are common across the class, which is
  the signal for adding one. Nobody has added one yet.

## Smaller

- **`red-words-game.html` / `red-words-match-game.html` redirects.** Six
  lines each, kept so bookmarks and anything written on paper keep
  working. Delete them once a school year has gone by and nothing links
  there.
- **The board on a phone.** It works — the name column is narrowed at
  640px and the grid scrolls — but 15 columns on a handset is a lot of
  scrolling. The family fold (▾) is the existing escape hatch. Only worth
  more if someone actually assigns lists from a phone.

---

## Reversed

- **A say-it mode for the red words** — previously "not doing", on the
  grounds that a phoneme matcher has nothing to check an irregular word
  against. The reason didn't survive a second look: Say It accepts an
  **exact transcript first** and only falls back to phonemes, and a red
  word is an ordinary dictionary word that Chrome returns reliably. The
  two things that genuinely blocked it were homophones (*to* / *two*) and
  contractions (*they'd* heard as "they would"), and both are now fixed
  where they belong — `RED_HOMOPHONES` reaches the say matcher, and
  `GameCore.normalize` folds a contraction and its expansion to the same
  string. Ten new ids (`red-N-say`) on the generic `say-game.html`.

## Decided during the roster build

Choices the roster plan left open, recorded so the reasoning survives.

- **"Stuck on cards for two weeks" is measured in attempts, not days.**
  A stat carries the time a word was LAST practised and nothing about
  when it was first seen, so "for two weeks" has nothing to compute
  against. Thirty answers on one list at under 40 % solid is the same
  student by any other route — at eighteen words a round that is a
  fortnight of it — and it is a number the data actually has.
- **A period with no stored sequence has no sequence.** The plan says a
  default one is "generated on first use"; generating it silently for
  every period would switch auto-advance on across a school without
  anybody asking for it. **Reset to default** in the sequence editor is
  the first use, and it is a button somebody presses.
- **"Red 3" in a roster's start column resolves to the family's FIRST
  mode**, which for the red words is now Say It. Whatever a teacher
  meant, the first mode is where a student starts, and every later mode
  of that list unlocks a step or two behind it.

## Decided during the reading-feedback build

Choices the plan left to whoever built it, recorded here so the reasoning
survives the commit that made them.

- **The dashboard's "most often heard as" is a line on each chip, not a
  column.** Trouble spots renders word chips, not a table, so the mode
  transcript goes under the word the way the counts already do. A column
  would have meant rebuilding the panel as a table for one field.
- **A dropped final consonant on a final-blend list reads as a blend
  error, not a dropped sound.** `diagnose()` tries the blend being
  practised before anything else, so "gasp" read as "gas" says *Look at
  the blend: sp* on the Blend Words list and *You dropped a sound: p*
  everywhere else. Both are true; on that list the blend is the skill, so
  it is the thing to point at.

---

## Reversed, again

- **Connected-text passages.** Built as part of the reading-feedback plan
  (a "Read it" mode, eight hand-written passages, a pointer that followed
  a reader through prose with a three-word lookahead) and removed a day
  later. Two reasons. The site is word practice; a paragraph is a
  different exercise with a different teaching purpose behind it. And the
  vocabulary rule that made the passages honest — every word off a list
  the student had been taught, about two hundred of them, no *them*, no
  *him*, no past tense the lists don't carry — made them read like nothing
  anybody would write, which is a poor advertisement for reading.

  If it comes back it wants real prose and a different answer to "which
  words are allowed". The engine's pointer walk kept only the branch the
  word runs use; the lookahead went with the passages.

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
