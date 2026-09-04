/* ══════════════════════════════════════════════════════════════════════
   passages.js — connected text, for the one thing word lists can't ask.

   A student can be solid on every word of a list and still read a
   paragraph one halting word at a time. Reading a line of prose is its
   own skill: the eye has to run ahead, the voice has to keep going past
   a word it half-recognises, and nothing on this site asked for either
   until these.

   ── The vocabulary rule ────────────────────────────────────────────────
   Every single word in every passage is one of:

     (a) on that passage's own family list;
     (b) on any other family's list (the phonics families and oi/oy — the
         nonsense words are excluded, being made up);
     (c) on Red Lists 1–3, the highest-frequency irregular words;
     (d) in FUNCTION_WORDS below, a closed set that is never added to.

   About two hundred words in total, and `tests.html` walks every passage
   against it. The rule is the point: a student who stalls here has
   stalled on reading connected text, not on a word nobody taught them.
   It also bites hard — there is no "them", no "him", no past tense the
   lists don't carry — which is why these read the way they do. A draft
   that fails the test gets edited; the rule doesn't.

   ── What a passage is ──────────────────────────────────────────────────
     { n, family, title, text, targets }

   `family` says which list it belongs to (two per family) and `targets`
   names the family words it actually uses — those are the words a read
   reports back to the scheduler, so a passage feeds the same per-word
   stats every other mode does. word-lists.js turns each of these into a
   list in the "passages" family; nothing here knows about the registry.
   ══════════════════════════════════════════════════════════════════════ */

/* The closed set. Deliberately small and deliberately dull: these are the
   words that hold English sentences together, and a reader who can't get
   past them can't get past anything. Adding to it is how the vocabulary
   rule stops meaning something, so don't. */
window.PASSAGE_FUNCTION_WORDS = ("a an the and but or so in on at is it he she we they i my his her " +
  "our their was were had has have not with for to of up out off by as be do did got get").split(" ");

window.PASSAGES = [

  {
    n: 1, family: "blends-start",
    title: "The sled and the glen",
    text:
      "My brother has a sled. It is not great, but he is loyal to it. We get " +
      "up at dusk and drag it out to the glen. The crop by the pond is damp, " +
      "and our vest and kilt get soft with it. He has a grin. There is a frog " +
      "on a stem and a crab in the sand. He put a plum and some bran in a " +
      "napkin. On the trip up I skip a spot where the soil is not right. My " +
      "brother did not skip it. He sank. He is damp to the joint, and he is " +
      "upset. But at dusk we drag the sled up on the crop, and he did grin " +
      "again.",
    targets: [
      "bran","crab","crop","drag","frog","glen","grin","plum","skip",
      "sled","spot","stem","trip"
    ]
  },

  {
    n: 2, family: "blends-start",
    title: "The drum that would not spin",
    text:
      "The drum my friend got is a scam. He did not spot it. He got it for " +
      "two coin and he thought it was great. He is glad until the onset of " +
      "the noise. It is a blip, and it is done. He is upset, but he would not " +
      "submit to it. So we prop the drum up on a crop of sand, snip the damp " +
      "fabric off, and drag a subset of the silk into the joint. It is a " +
      "toil. We panic once. But by dusk the drum did spin and honk again, and " +
      "my friend has a grin he did not have at the onset.",
    targets: [
      "blip","crop","drag","drum","glad","grin","prop","scam","snip",
      "spin","spot"
    ]
  },

  {
    n: 3, family: "blends-end",
    title: "The tent by the pond",
    text:
      "The tent is damp at dusk and the noise did honk against it until we " +
      "were up. My brother has the helm. I have the raft. We put the lump of " +
      "kelp off the sand and drag the raft to the pond. It is a risk. The " +
      "cost of a soft raft is a damp vest and a damp kilt, and there is not a " +
      "link of silk in our tent by dusk. But we do it. A mink is in the nest " +
      "by the elk spot. It did gasp. We pant. We sank once. At dusk we sift " +
      "the sand out of our vest and we are glad.",
    targets: [
      "cost","damp","dusk","elk","gasp","helm","honk","kelp","kilt",
      "link","lump","mink","nest","pant","pond","raft","risk","sand",
      "sank","sift","silk","soft","tent","vest"
    ]
  },

  {
    n: 4, family: "blends-end",
    title: "A soft shift at the pond",
    text:
      "The toil at the pond is soft until dusk. We sift the sand, link two " +
      "raft, and put the helm on. It is not great, but the cost is right. My " +
      "friend has a lisp and he did honk at a mink in the kelp. The mink did " +
      "gasp and it fled into a nest. We pant. There is a lump of silk in our " +
      "vest and a wisp of milk on the tent, and by dusk our kilt is damp to " +
      "the joint. It is a risk. But we are not unfit, and we did not panic " +
      "once. My father would give a golf kilt for it.",
    targets: [
      "cost","damp","dusk","gasp","golf","helm","honk","kelp","kilt",
      "link","lisp","lump","milk","mink","nest","pant","pond","raft",
      "risk","sand","sift","silk","soft","tent","vest","wisp"
    ]
  },

  {
    n: 5, family: "oi-oy",
    title: "The soy cabin",
    text:
      "My friend has a public toil at the royal soy cabin. He has to broil " +
      "the soy, put foil on it, avoid the noise by the joint, and submit an " +
      "index of it until dusk. The moist soil in one crop did spoil. He was " +
      "devoid of a choice: he did hoist it out and put it in a void by the " +
      "crop. His boyish grin is not there. It did annoy my friend. But he is " +
      "loyal and he would not destroy it. He would join a convoy of droid for " +
      "one coin. At dusk he did enjoy a plum and some milk with a comic.",
    targets: [
      "annoy","avoid","boyish","broil","choice","coin","convoy",
      "destroy","devoid","droid","enjoy","foil","hoist","join","joint",
      "loyal","moist","noise","royal","soil","soy","spoil","toil",
      "void"
    ]
  },

  {
    n: 6, family: "oi-oy",
    title: "The convoy is a ploy",
    text:
      "The convoy is a ploy. My brother did appoint one droid to hoist a coin " +
      "into a joint by the moist soil and one to broil the soy. It is a " +
      "decoy. There is not a coin in it. He is coy, and it did annoy our " +
      "mother, who would avoid the noise and the toil of it. But he is loyal " +
      "to the ploy and he would not spoil it. At the onset of dusk the royal " +
      "convoy did join the crop, and my boyish brother did enjoy it until the " +
      "noise was void. He got a foil coin for it, and he would not employ it.",
    targets: [
      "annoy","appoint","avoid","boyish","broil","coin","convoy","coy",
      "decoy","droid","employ","enjoy","foil","hoist","join","joint",
      "loyal","moist","noise","ploy","royal","soil","soy","spoil",
      "toil","void"
    ]
  },

  {
    n: 7, family: "multi",
    title: "The robin in the attic",
    text:
      "The attic of our cabin is hectic. A robin did inhabit it until the " +
      "picnic, and it would not submit to my father. He is unfit for an " +
      "attic. He got a magnetic index, a bobbin of silk fabric, a napkin, and " +
      "a hubcap up there, and he did panic once. The onset was comic. My " +
      "mother would avoid it. She is not disgusted, but she has a habit: the " +
      "maximum is two and the minimum is one, and gossip is not on the index. " +
      "By dusk the robin was our mascot, and my father did put a sunlit spot " +
      "in the attic for it.",
    targets: [
      "attic","bobbin","cabin","comic","disgusted","fabric","gossip",
      "habit","hectic","hubcap","index","inhabit","magnetic","mascot",
      "maximum","minimum","napkin","onset","panic","picnic","robin",
      "submit","sunlit","unfit","until"
    ]
  },

  {
    n: 8, family: "multi",
    title: "The exam at dusk",
    text:
      "The exam is at dusk. It is hectic, and my habit is to panic. My friend " +
      "has a muffin in a napkin and a comic in his index, and he would not " +
      "submit until the maximum. He did inhabit the public attic of the cabin " +
      "until the onset, so he is not unfit for it. The index has a volcanic " +
      "subset and a magnetic subset. I did not enjoy the onset. But the antic " +
      "of it is comic: our mascot, a robin, got into the attic, and my friend " +
      "did panic. He was disgusted. We were upset. But we did submit, and it " +
      "is done.",
    targets: [
      "antic","attic","cabin","comic","disgusted","exam","habit",
      "hectic","index","inhabit","magnetic","mascot","maximum","muffin",
      "napkin","onset","panic","public","robin","submit","subset",
      "unfit","until","upset","volcanic"
    ]
  }
];
