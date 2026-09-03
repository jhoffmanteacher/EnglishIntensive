# Red Words (High-Frequency "Irregular Word" Lists)

Source: SUHSD High-Frequency "Irregular/Red Word" Screener — Teacher Form
(OGI Curriculum by Jarice, © for limited non-profit/student use).

Ten lists of 20 words each, 200 words total, ordered roughly by difficulty
(Lists 1–4 are common sight words; Lists 9–10 lean into multisyllabic and
Tier 2/3 vocabulary). The site plays them from `RED_LISTS` in
`word-lists.js`, which registers each list twice — as flash cards
(`red-N-cards`) and as Match It (`red-N-match`) — so the teacher can assign
either game per list. This file stays the source of record, so a
correction here belongs in that array too.

Each word below is stored exactly as printed on the screener, including
apostrophes and capitalization (e.g. `Mrs.`, `Mr.`, `they'd`, `you're`).

## Red Word List 1

you, should, could, said, they, have, of, are, what, put, would, to, your, was, the, once, do, from, into, two

## Red Word List 2

give, were, many, whose, any, here, live, some, Mrs., Mr., where, other, one, whom, right, there, done, great, does, their

## Red Word List 3

thought, who, come, very, again, aren't, weren't, mother, father, brother, watch, haven't, they'd, you'd, against, friend, they'll, we're, they're, you're

## Red Word List 4

beautiful, been, blood, none, only, says, sure, both, bought, buy, prove, straight, worn, push, today, pull, most, change, child, clothes

## Red Word List 5

flood, floor, often, door, gone, laugh, break, steak, above, they've, you, lose, tough, view, rough, front, love, among, anyone, answer

## Red Word List 6

nothing, cousins, cover, courage, toward, enough, through, sugar, busy, almost, ninth, although, always, another, onion, though, people, build, piano, pint

## Red Word List 7

shoved, butcher, post, pretty, canoe, promise, carrot, cough, roll, danger, debt, sew, shoe, heart, forward, son, four, spirit, swan, bouquet

## Red Word List 8

honest, toll, honor, touch, hour, Tuesday, Wednesday, imagine, iron, wind, wolf, won, wore, move, minute, mirror, young, success, already, idea

## Red Word List 9

music, sure, garage, system, figure, friend, national, ready, island, unique, ocean, radio, feature, continue, condition, caution, enough, guarantee, technique, anxious

## Red Word List 10

cologne, resumé, resume, boutique, fair, pair, fought, eye, show, small, about, call, fall, mall, air, know, large, barge, house, mouse

---

## Notes on the lists

- 10 lists × 20 words = 200 words total.
- Original screener scores students out of 20 per list, out of 80 for lists
  1–4 (page 1), out of 80 for lists 5–8 (page 2), out of 40 for lists 9–10
  (page 3), and out of 200 overall — that scoring rubric maps to approximate
  grade-level benchmarks (K–5) and could inform difficulty tiers if the game
  wants to group words by list number.
- Four words repeat across lists as printed on the original screener:
  `you` (Lists 1 and 5), `friend` (3 and 9), `sure` (4 and 9) and `enough`
  (6 and 9) — so the 200 entries are 196 distinct words. They're kept as-is
  rather than de-duplicated here, since list identity matters: a word can be
  worth re-testing at a harder point in the screener. The game deduplicates
  only within a single round, which is what its "All words" deck (196) and
  its random "Mixed" deck use.
- Words carrying punctuation (`Mrs.`, `Mr.`, contractions like `aren't`,
  `they'd`, `you're`) would need special handling in a typing-based game
  (e.g. accepting the answer with or without the apostrophe/period). The
  flash-card game never compares them against anything a student typed or
  said, so they cost it nothing — it just prints and speaks them as written.
