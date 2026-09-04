# TODO

What's left after the assignment-board work, roughly in the order it's
worth doing. Nothing here is blocking: the site is complete and tested as
it stands. Items are written so they can be picked up cold.

Things that were considered and deliberately *not* done are at the bottom,
with the reasoning, so they don't get re-proposed every few months.

---

## Next

*(The three items that were here — progression rules, per-student notes and
export — are all done. See the Teacher dashboard section of the README.)*

Nothing outstanding. The next thing worth building is whatever the class
turns out to need after a term of using it.

## Smaller

- **`red-words-game.html` / `red-words-match-game.html` redirects.** Six
  lines each, kept so bookmarks and anything written on paper keep
  working. Delete them once a school year has gone by and nothing links
  there.
- **Publish `firestore.rules` after the notes change.** The file now has
  a `notes/{uid}` block, and editing the file deploys nothing — GitHub
  Pages doesn't ship Firestore rules. Until it's pasted into the Firebase
  console, the notes box will save into a collection with no rule and the
  write will be refused. Everything else on the site is unaffected.
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
