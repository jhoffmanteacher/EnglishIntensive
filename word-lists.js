/* ════════════════════════════════════════════════════════════════════
   word-lists.js — the list library. One entry per (list × mode).

   This file is the single source of truth for what a list IS. Before
   sign-in existed, each game page carried its own word list inline; now
   three separate things need to agree about them —

     · the game page, which plays one list in one mode
     · the home page, which shows the tiles a student has been assigned
     · the teacher dashboard, which assigns lists by name and reports
       per-word accuracy inside them

   — so the lists moved here and the pages became two lines each.

   ── Families and modes ────────────────────────────────────────────────
   Every list belongs to a FAMILY, and every family declares the MODES it
   can be played in. A mode is an engine plus the habits that go with it:

     🎤 say it     blend-game.js   read it aloud, the computer listens
     ⌨️ spell it   spell-game.js   the computer says it, you type it
     🃏 cards      card-game.js    read it, flip it, rate yourself
     🎯 Match It   match-game.js   hear it, find it among look-alikes

   The red words worked this way first — the same "List 3" as flash cards
   OR as Match It, because knowing `would` on sight and picking it out of
   six look-alikes are different skills, and a student can have one
   without the other. That is true of every list here, not just the red
   ones: reading `moist` off a card, spelling it, and picking it out of a
   row of look-alikes are three different things to be good at. So the
   registry generates one entry per (family, list, mode), each with its
   own id and therefore its own stats.

   ── Ids are permanent ─────────────────────────────────────────────────
   An id is half of every Firestore stat key ("<id>|<word>", see
   adaptive.js) and it is what an assignment stores, so renaming one
   orphans a class's history. Generated ids are "<family>-<n>-<mode>";
   a family's `ids` map overrides that per mode, and every id that
   existed before families did is pinned there — `final-blends`,
   `initial-blends`, `nonsense`, `oi-oy-read`, `oi-oy-spell`,
   `multisyllable`. `title` is the display name and can change freely.

   ── Adding to the library ─────────────────────────────────────────────
   · another red list        one array in RED_LISTS. Nothing else.
   · another mode on a list  one key in that family's `modes`.
   · a whole new family      one entry in LIST_FAMILIES. Its cards and
                             Match It modes need no new page — they share
                             cards-game.html and match-game.html. A `say`
                             or `spell` mode needs its own page, named in
                             `pages`, because its copy is list-specific.
   ════════════════════════════════════════════════════════════════════ */

/* ── The four modes ────────────────────────────────────────────────────
   A word on the `intro` copy, which is deliberately short and plain: this
   is a phonics class, and the "how to play" text should not itself be a
   decoding challenge. Each intro is one or two short sentences, split on
   <br> — the split is load-bearing, because the Hear-directions button
   speaks each sentence as its own utterance and reads the break as a
   pause.
   `engine` picks which engine plays it. `page` is where cards and Match
   It live — one page each, serving every family, told which list to play
   by the address. Say-it now has a generic page too: the four phonics
   families still name their own in `pages`, because those carry
   list-specific coaching, but a family that doesn't need any (the red
   words) gets say-game.html and no new file. Spell-it has no default —
   the only list with a spelling mode carries the oi/oy rule box. */
var MODES = {
  say: {
    key: "say", engine: "blend", icon: "🎤", title: "Say it", needs: "mic", page: "say-game.html",
    intro: "Say each word out loud. The computer listens and tells you if you're right.<br>Every 5 in a row earns bonus points."
  },
  spell: {
    key: "spell", engine: "spell", icon: "⌨️", title: "Spell it", needs: "headphones",
    intro: "Put on headphones. Listen to the word, then type what you hear.<br>You get two tries for each word."
  },
  cards: {
    key: "cards", engine: "card", icon: "🃏", title: "Cards", needs: "", page: "cards-game.html",
    intro: "No mic, no typing. A word shows — read it out loud, flip the card, and see if you were right.<br>Build a streak: every 5 in a row is bonus points!"
  },
  match: {
    key: "match", engine: "match", icon: "🎯", title: "Match It", needs: "headphones", page: "match-game.html",
    intro: "No mic — headphones only. The computer says a word and you find it.<br>The wrong answers look close on purpose. Every 5 right in a row is bonus points!"
  },
  /* The two fluency modes. Everything above asks whether a student knows
     a word; these ask how fast, which is a different question and the
     one that stops being answered by accuracy long before a student
     reads comfortably. Same engine, two shapes: a minute against a word
     list, and a paragraph of connected text. */
  fluency: {
    key: "fluency", engine: "fluency", icon: "⏱", title: "One minute", needs: "mic", page: "fluency-game.html",
    intro: "Read as many words out loud as you can in one minute.<br>Don't rush a word you're not sure of — a word read wrong doesn't count."
  },
  read: {
    key: "read", engine: "fluency", icon: "📖", title: "Read it", needs: "mic", page: "fluency-game.html",
    intro: "Read the whole thing out loud, at a pace you can hear yourself at.<br>The words light up as you pass them. Keep going if you slip."
  },
  /* The one mode that starts from SOUND rather than from letters. It can
     only exist because the phoneme clips do: a synthesiser asked for an
     isolated /b/ says "buh", and "buh-a-tuh" does not blend into "bat". */
  blendit: {
    key: "blendit", engine: "blendit", icon: "🔊", title: "Blend it", needs: "mic", page: "blend-it-game.html",
    intro: "Listen to the sounds one at a time, then run them together and say the word.<br>The word stays hidden until you've had your go."
  },
  /* A variant inside the cards engine rather than an engine of its own:
     the screens, the scoring and the deck are the flash cards', and only
     what happens on the card is different. */
  split: {
    key: "split", engine: "card", icon: "✂️", title: "Split it", needs: "", page: "cards-game.html",
    intro: "Long words come apart. Click where the word splits into syllables, then press Enter.<br>Get the split right first time and it counts."
  }
};

/* ── Red words ─────────────────────────────────────────────────────────
   The ten high-frequency irregular-word lists from the SUHSD "red word"
   screener, twenty words each, in printed order. data/red-words.md is
   the source of record (where they came from, how the paper screener
   scores them, why four words repeat across lists); these arrays are
   that file transcribed, so a correction belongs in both places.

   A red list is 20 words and a round is 18, so one round is nearly the
   whole list, weighted — over two or three rounds every word comes up,
   the missed ones most.

   The braces mark the HEART of each word — the part the phonics rules get
   wrong, and therefore the only part that has to be learned by heart.
   "s{ai}d" is s + d with one impossible middle. They are display only
   (GameCore.parseEntry strips them, WordLists.plain strips them), and the
   flash cards show them on the BACK of the card, after the student has
   already had their go at reading it cold. A word left unmarked is left
   unmarked on purpose: "carrot", "spirit", "radio", "about" and the rest
   are regular enough to sound out, and "Mrs.", "Mr." and "wind" are an
   abbreviation and a heteronym, which is a different problem. */
var RED_LISTS = [
  ["y{ou}","sh{oul}d","c{oul}d","s{ai}d","th{ey}","ha{ve}","{of}","{are}","wh{a}t","p{u}t",
   "w{oul}d","t{o}","y{our}","w{a}s","th{e}","{o}nce","d{o}","fr{o}m","int{o}","t{wo}"],
  ["gi{ve}","w{ere}","m{a}ny","wh{ose}","{a}ny","h{ere}","li{ve}","s{o}me","Mrs.","Mr.",
   "wh{ere}","{o}ther","{one}","wh{o}m","right","th{ere}","d{o}ne","gr{ea}t","d{oe}s","th{eir}"],
  ["th{ough}t","wh{o}","c{o}me","very","ag{ai}n","aren't","w{ere}n't","m{o}ther","f{a}ther","br{o}ther",
   "w{a}tch","ha{ve}n't","th{ey}'d","y{ou}'d","ag{ai}nst","fr{ie}nd","th{ey}'ll","we're","th{ey}'re","y{ou}'re"],
  ["b{eau}tiful","b{ee}n","bl{oo}d","n{o}ne","{o}nly","s{ay}s","{su}re","b{o}th","b{ough}t","b{uy}",
   "pr{o}ve","str{aigh}t","w{or}n","p{u}sh","t{o}day","p{u}ll","m{o}st","ch{a}nge","ch{i}ld","cl{o}th{es}"],
  ["fl{oo}d","fl{oor}","of{te}n","d{oor}","g{o}ne","l{augh}","br{ea}k","st{ea}k","{a}b{o}ve","th{ey}'ve",
   "y{ou}","l{o}se","t{ough}","v{iew}","r{ough}","fr{o}nt","l{o}ve","am{o}ng","{a}ny{one}","ans{w}er"],
  ["n{o}thing","c{ou}sins","c{o}ver","c{ou}rage","t{owa}rd","en{ough}","thr{ough}","{su}gar","b{u}sy","{a}lmost",
   "n{i}nth","{al}th{ough}","{al}ways","an{o}ther","{o}nion","th{ough}","pe{o}ple","b{ui}ld","pi{a}no","p{i}nt"],
  ["sh{o}ved","b{u}tcher","p{o}st","pr{e}tty","can{oe}","promi{se}","carrot","c{ough}","r{o}ll","d{a}nger",
   "de{b}t","s{ew}","sh{oe}","h{ear}t","forward","s{o}n","f{our}","spirit","sw{a}n","b{ou}qu{et}"],
  ["{h}onest","t{o}ll","{h}on{or}","t{ou}ch","{hou}r","T{ue}sday","We{d}nesday","imagi{ne}","{iro}n","wind",
   "w{o}lf","w{o}n","w{ore}","m{o}ve","min{u}te","mirror","y{ou}ng","su{cc}ess","{al}ready","idea"],
  ["m{u}sic","{su}re","gara{ge}","s{y}stem","fig{u}re","fr{ie}nd","na{ti}onal","r{ea}dy","i{s}land","un{ique}",
   "o{ce}an","radio","f{ea}t{u}re","contin{ue}","condi{ti}on","cau{ti}on","en{ough}","g{ua}rant{ee}","te{ch}n{ique}","an{xi}ous"],
  ["col{ogne}","res{u}m{é}","resume","b{ou}t{ique}","f{air}","p{air}","f{ough}t","{eye}","show","sm{a}ll",
   "about","c{a}ll","f{a}ll","m{a}ll","{air}","know","large","barge","house","mouse"]
];

// Words that sound alike are never put on screen together in Match It —
// no amount of listening separates "to" from "two". Every pair is one
// both of whose members are somewhere in the ten lists.
var RED_HOMOPHONES = [
  ["to", "two"],
  ["there", "their", "they're"],
  ["your", "you're"],
  ["we're", "were"],
  ["one", "won"],
  ["resumé", "resume"]
];

// Spoken between two reads of the word in Match It, spelling-bee style,
// only for the words that genuinely need it: every member of a homophone
// group, and heteronyms the synthesiser could read the wrong way cold.
var RED_SENTENCES = {
  "to":      "I need to finish my homework.",
  "two":     "She has two brothers.",
  "there":   "Put the box over there by the wall.",
  "their":   "The team missed their bus.",
  "they're": "Call the twins — they're late again.",
  "your":    "Is this your jacket?",
  "you're":  "I think you're right about that.",
  "we're":   "Hurry up, we're late.",
  "were":    "The cookies were still warm.",
  "one":     "I only need one more.",
  "won":     "Our team won the game.",
  "resumé":  "She emailed her resumé for the job.",
  "resume":  "We will resume the game after lunch.",
  "does":    "How much does it cost?",
  "live":    "Fish live in water.",
  "minute":  "The bus leaves in a minute.",
  "wind":    "The wind blew my hat off."
};

var RED_NOTE_CARDS = `
    <p><b>Red words</b> are the words that break the rules. Sounding out
    <b>said</b> gives you "sayed". Sounding out <b>would</b> gives you
    "wold". They don't play fair — so you learn them <b>by sight</b>,
    the way you know a friend's face.</p>
    <p>Be honest when you rate yourself. A word you mark <b>Not yet</b> comes
    back next time; a word you mark <b>Got it</b> leaves the list for good.</p>`;

var RED_NOTE_SAY = `
    <p><b>Red words</b> break the rules. Sounding out <b>said</b> gives you
    "sayed"; sounding out <b>would</b> gives you "wold". There is nothing
    to work out here — either you know the word or you don't, and saying it
    out loud is how you find out which.</p>
    <p>Some of these <b>sound exactly like another word</b> — to and two,
    there and their, one and won. The computer can't tell those apart, and
    neither can anyone listening, so any of them counts as right.</p>`;

var RED_NOTE_MATCH = `
    <p><b>Red words</b> break the rules, so you can't sound them out — you
    have to know them by sight. This game checks that: the words on screen
    are picked to look like each other, so <b>would</b>, <b>could</b> and
    <b>should</b> turn up together.</p>
    <p>Read all the way to the <b>end</b> of each word. The first letter
    won't be enough.</p>`;

/* ── oi / oy ───────────────────────────────────────────────────────────
   One word list, four ways to be asked about it. The sentences are
   spoken between the two reads of the word, spelling-bee style: a lone
   synthesised word is easy to mishear, and the sentence is what makes it
   unmistakable. Each uses the word exactly once and never contains
   another word from the list, so it can't answer the question for you.
   Shared by Spell It and Match It — both play the word and ask which one
   it was. */
var OI_OY_WORDS = [
  "annoy","appoint","avoid","boyish","broil","choice","cloying","coil","coin",
  "convoy","coy","decoy","deploy","destroy","devoid","droid","employ","enjoy",
  "foil","hoist","join","joint","loyal","moist","noise","poison","ploy","royal",
  "soil","soy","spoil","toil","void"
];

var OI_OY_SENTENCES = {
  annoy:   "Loud chewing can really annoy people.",
  appoint: "The coach will appoint a new team captain.",
  avoid:   "She left early to avoid the traffic.",
  boyish:  "He flashed a boyish grin.",
  broil:   "You can broil the fish for five minutes.",
  choice:  "Pizza or tacos — it's your choice.",
  cloying: "The candy was so sweet it was cloying.",
  coil:    "The snake wound itself into a tight coil.",
  coin:    "He flipped a coin to decide.",
  convoy:  "A convoy of trucks rolled down the highway.",
  coy:     "She gave a coy smile and said nothing.",
  decoy:   "The hunters set out a wooden duck decoy.",
  deploy:  "The army will deploy more troops overseas.",
  destroy: "One bad storm can destroy the whole crop.",
  devoid:  "The desert was devoid of water.",
  droid:   "The droid beeped and rolled across the floor.",
  employ:  "The new factory will employ two hundred workers.",
  enjoy:   "I hope you enjoy the show.",
  foil:    "Wrap the sandwich in foil.",
  hoist:   "They worked together to hoist the flag.",
  join:    "Come join us at our table.",
  joint:   "Your elbow is a joint.",
  loyal:   "A dog is a loyal friend.",
  moist:   "The cake was rich and moist.",
  noise:   "What was that noise upstairs?",
  poison:  "The bottle was marked with a poison warning.",
  ploy:    "The fake fight was just a ploy to distract the guard.",
  royal:   "The royal family lives in a palace.",
  soil:    "Plant the seeds in fresh soil.",
  soy:     "This milk is made from soy.",
  spoil:   "Milk will spoil if you leave it out.",
  toil:    "The workers toil in the sun all day.",
  void:    "The rocket drifted into the void of space."
};

var OI_OY_RULE =
  '<p style="margin:0">Both spellings say <b>/oy/</b>. What decides between them is <b>where the sound sits</b>.</p>' +
  "<ul>" +
  "<li><b>oy</b> ends the word — enj<b>oy</b>, dec<b>oy</b>, s<b>oy</b> — or comes right before a vowel: r<b>oy</b>al, b<b>oy</b>ish.</li>" +
  "<li><b>oi</b> sits inside the word, before a consonant — c<b>oi</b>n, m<b>oi</b>st, av<b>oi</b>d.</li>" +
  "</ul>" +
  '<p class="tip">Stuck? Ask what comes after the sound. Nothing or a vowel → <b>oy</b>. A consonant → <b>oi</b>.</p>';

/* ══════════════════════════════════════════════════════════════════════
   The families.

   Order matters: it is the order of the home page's tiles, the picker's
   sections and the Assign board's columns, and the order
   describeAssignment lists them in. The five one-list families come
   first because they are the everyday games; the red words come last
   because they are ten lists wide and would otherwise push everything
   else off the right of the board.

   `pattern` is what the family is TEACHING, in the words a teacher would
   use about it — the dashboard groups trouble spots by it, so that a
   report reads "final blends: seven students shaky" rather than naming
   thirty words one at a time. One family, one pattern; if a family ever
   needs two, it is two families.

   `config` is what every mode of the family passes to its engine;
   `modeConfig[mode]` is what only that mode passes, and it wins on a
   clash. Everything the engine's start() takes except `words`, which
   lives on the list so the two can't drift.
   ══════════════════════════════════════════════════════════════════════ */
/* A passage as a list of words. Punctuation goes, case goes, everything
   else stays in order — the same tokenising the fluency engine does to a
   transcript, so a passage's words and a student's reading of them are
   comparable by construction. */
window.passageTokens = function(text){
  return String(text || "").toLowerCase()
    .replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
};

window.LIST_FAMILIES = [

  {
    key: "blends-start",
    title: "Starting Blends",
    pattern: "initial blend",
    icon: "🗣️",
    section: "decode",
    note: "Words that begin with a consonant blend — bl, cr, sl, tr.",
    description: "Words that begin with a consonant blend — bl, cr, sl, tr.",
    modes: ["say", "cards", "match", "fluency", "blendit"],
    pages: { say: "initial-blends-game.html" },
    modeConfig: {
      say: { blend: "start", theme: "maze" }
    },
    // From the classroom flashcard set.
    lists: [{ n: 1, ids: { say: "initial-blends" },
      words: ["blip","crop","clam","grab","flub","grin","glad","prop","plop","trip",
              "plum","trot","sled","bled","slug","fled","scam","glen","skip","spin",
              "snip","spot","stem","drum","bran","drag","crab","frog"] }]
  },

  {
    key: "blends-end",
    title: "Blend Words",
    pattern: "final blend",
    icon: "🎤",
    section: "decode",
    note: "Words that end with a consonant blend — the hard half of a blend, because the sounds run together on the way out.",
    description: "Words that end with a consonant blend — soft, pond, risk, milk.",
    modes: ["say", "cards", "match", "fluency", "blendit"],
    pages: { say: "blend-words-game.html" },
    modeConfig: {
      say: { blend: "end", theme: "race" }
    },
    lists: [{ n: 1, ids: { say: "final-blends" },
      words: ["soft","golf","honk","cost","pond","vest","nest","tent","kelp","helm",
              "elk","sect","tusk","dusk","lump","hunk","damp","sand","pant","sank",
              "gasp","raft","wisp","lisp","risk","mink","link","kilt","silk","milk","sift"] }]
  },

  {
    key: "nonsense",
    title: "Nonsense Words",
    pattern: "nonsense CVC",
    icon: "🤖",
    section: "decode",
    note: "Made-up CVC words with no meaning to lean on — pure sounding-out practice.",
    description: "Made-up CVC words with no meaning to lean on — pure sounding-out practice.",
    /* No Match It, deliberately. That game works by SAYING the word and
       asking the student to find it, and a synthesiser handed "vab" does
       not say "vab" — it guesses, and it guesses "verb" often enough that
       the answer key would be wrong. A list with no meanings can only be
       read, not heard. */
    modes: ["say", "cards", "fluency", "blendit"],
    pages: { say: "nonsense-words-game.html" },
    modeConfig: {
      say: {
        blend: "start", blendLength: 0, theme: "race",
        intro: "These are made-up words. Sound out the letters, then say the word out loud.<br>The computer listens and tells you if you're right."
      },
      // Same reason again: the reveal plays the sounds, and then has
      // nothing to say — a synthesiser handed "vab" guesses "verb".
      blendit: { speak: false, phonetic: true, theme: "race" },
      // Same reason as above: the flip shows the word, it doesn't say it.
      cards: {
        speak: false,
        intro: "These aren't real words. Sound out the letters and say it out loud, then flip the card to see if you read it right.<br>Build a streak: every 5 in a row is bonus points!",
        note: `
    <p>The computer <b>won't say these out loud</b> — it can't. They aren't
    real words, so a talking computer just guesses at them. The card shows
    you the letters and that's it: <b>you</b> are the one who decides what
    they say.</p>
    <p>That's the whole point. Nothing to remember, nothing to guess from —
    only the sounds the letters make.</p>`
      }
    },
    lists: [{ n: 1, ids: { say: "nonsense" },
      words: ["jag","baz","wat","gan","vab","sab","raz","taf",
              "sem","ted","ret","heg","peb","yed","leb","ren",
              "lif","vip","pid","tix","rit","sig","lim","din",
              "bop","pon","com","fod","hom","rof","jom","loz",
              "fug","tup","sug","lun","sud","hux","gud","muv"] }]
  },

  {
    key: "oi-oy",
    title: "oi / oy",
    pattern: "vowel team oi/oy",
    icon: "🪙",
    section: "decode",
    note: "One sound, two spellings. Read them, spell them, know them on sight, pick them out of a row.",
    description: "Words with the oi/oy sound — coin, join, annoy, royal.",
    /* The list every mode was invented for. Reading "moist" cold,
       spelling it, knowing it on sight and picking it out of a line of
       look-alikes are four separate skills on one set of words, and a
       student can have any of them without the others. */
    modes: ["say", "spell", "cards", "match"],
    pages: { say: "oi-oy-words-game.html", spell: "spelling-oi-oy-game.html" },
    config: { highlight: /oi|oy/i },
    modeConfig: {
      say:   { blend: "sound", sound: "OY", theme: "maze" },
      // Sound boxes: one input per SOUND. This is the list they were
      // invented for — a vowel team is exactly where the number of
      // sounds and the number of letters come apart.
      spell: { rule: OI_OY_RULE, sentences: OI_OY_SENTENCES, boxes: true },
      // The cards use them for something different from Match It: once a
      // word is solid, one card in three shows it inside its sentence
      // instead of alone. See card-game.js.
      cards: { sentences: OI_OY_SENTENCES },
      match: { choices: 6, sentences: OI_OY_SENTENCES }
    },
    lists: [{ n: 1, ids: { say: "oi-oy-read", spell: "oi-oy-spell" }, words: OI_OY_WORDS }]
  },

  {
    key: "multi",
    title: "Multisyllable",
    pattern: "multisyllable",
    icon: "🏗️",
    section: "decode",
    note: "Two- and three-syllable words. The trick is taking them one chunk at a time.",
    description: "Two- and three-syllable words like napkin, picnic and fantastic.",
    modes: ["say", "cards", "match", "split"],
    pages: { say: "multisyllable-words-game.html" },
    modeConfig: {
      say: {
        blend: "start", blendLength: 0, theme: "race",
        intro: "Break the word into syllables. Say each part, then say the whole word.<br>The computer listens and tells you if you're right."
      },
      split: {
        split: true,
        note: `
    <p>A long word is short words in a row. <b>fan·tas·tic</b> is three of
    them, and each one is easy — the length is the only hard part.</p>
    <p>Click <b>between</b> the letters to put a split in, click a split
    again to take it out, then press <kbd>Enter</kbd>. Get it right the
    first time and it counts.</p>`
      },
      cards: {
        note: `
    <p>Long words come apart. <b>fan·tas·tic</b> is three short words in a
    row, and each one is easy — the length is the only hard part.</p>
    <p>Read the card in chunks. When you flip it, the back shows you where
    the chunks were.</p>`
      }
    },
    /* Middle dots mark syllable boundaries. They are display only: every
       engine strips them (GameCore.parseEntry) before the word is spoken,
       matched or stored, so "fan·tas·tic" and "fantastic" are the same
       word to everything that counts. The cards engine shows the dotted
       form on the BACK of the card, after the student has read it cold. */
    lists: [{ n: 1, ids: { say: "multisyllable" },
      words: ["soft","pub·lic","gob·lin","fab·ric","gos·sip","nap·kin","sun·lit","sub·mit","an·tic",
              "on·set","sub·set","hub·cap","pic·nic","at·tic","un·til","cab·in","in·dex","mas·cot",
              "un·fit","hab·it","pan·ic","ex·am","hec·tic","com·ic","vic·tim","rob·in","muf·fin",
              "bob·bin","up·set","fan·tas·tic","vol·can·ic","in·hib·it","mag·net·ic","in·hab·it",
              "dis·gust·ed","max·i·mum","min·i·mum"] }]
  },

  {
    key: "red",
    title: "Red Words",
    pattern: "irregular",
    icon: "🃏",
    section: "sight",
    note: "Ten screener lists of twenty sight words. Each list can be assigned as flash cards, Match It, or both.",
    description: "Words that break the rules — said, would, Wednesday. You learn these by sight.",
    /* Say It was left off these for a long time, on the grounds that a
       phoneme matcher has nothing to check an irregular word against.
       That reason didn't hold: Say It takes an EXACT transcript first and
       only falls back to phonemes, and a red word is an ordinary
       dictionary word that Chrome returns reliably. The two things that
       genuinely were problems — homophones and contractions — are fixed
       where they belong (RED_HOMOPHONES below, and the contraction fold
       in GameCore.normalize), not by leaving the mode out. */
    modes: ["say", "cards", "match"],
    modeConfig: {
      say: {
        blend: "start", blendLength: 0, theme: "race",
        note: RED_NOTE_SAY, homophones: RED_HOMOPHONES,
        intro: "Read each word out loud. The computer listens and tells you if you're right.<br>No sounding out — you either know these or you don't."
      },
      // The homophone groups are here for the same reason Match It has
      // them: with the Listen toggle on, the cards judge a spoken answer,
      // and no recogniser separates "to" from "two".
      cards: { note: RED_NOTE_CARDS, homophones: RED_HOMOPHONES, sentences: RED_SENTENCES },
      match: { note: RED_NOTE_MATCH, choices: 6, homophones: RED_HOMOPHONES, sentences: RED_SENTENCES }
    },
    lists: RED_LISTS.map(function(words, i){ return { n: i + 1, words: words }; })
  },

  {
    key: "passages",
    title: "Passages",
    pattern: "connected text",
    icon: "📖",
    section: "decode",
    note: "Short pieces of connected text. Every word comes off the lists above — the only new thing is that they are in sentences.",
    description: "Read a whole paragraph out loud, not one word at a time.",
    /* One mode, and it could not be any of the others: a passage isn't a
       deck. A student who is solid on every word of a list can still read
       a paragraph one halting word at a time, and that gap is the only
       thing this family exists to find. passages.js explains the
       vocabulary rule that keeps it honest. */
    modes: ["read"],
    // One passage IS the round — there is nothing to draw from.
    lists: (window.PASSAGES || []).map(function(p){
      return {
        n: p.n,
        title: p.title,
        text: p.text,
        targets: p.targets,
        sessionSize: 1,
        // wordsOf() has to return something for a passage or every
        // downstream reader (the scheduler, the dashboard, the export)
        // has to learn about a new shape. Its tokens are the honest
        // answer: they are the words being read.
        words: window.passageTokens(p.text)
      };
    })
  }

];

/* ══════════════════════════════════════════════════════════════════════
   One entry per (family, list, mode), generated. Nothing below this line
   is hand-written, which is the point: a family declares its words once
   and its modes once, and cannot end up with a cards entry whose word
   list has drifted from its Match It entry.
   ══════════════════════════════════════════════════════════════════════ */
window.WORD_LISTS = (function(){
  var out = [];
  window.LIST_FAMILIES.forEach(function(fam){
    var many = fam.lists.length > 1;
    fam.lists.forEach(function(list){
      // "Red Words · List 3" when a family has several lists; just
      // "Starting Blends" when it is the family's only one.
      // A list may name itself (the passages do — "List 3" tells a
      // student nothing about a piece of prose).
      var listTitle = list.title || (fam.title + (many ? " · List " + list.n : ""));
      var short = list.title || (many ? "List " + list.n : fam.title);

      fam.modes.forEach(function(modeKey){
        var mode = MODES[modeKey];
        if(!mode) return;
        var page = (fam.pages && fam.pages[modeKey]) || mode.page;
        var id = (list.ids && list.ids[modeKey]) || (fam.key + "-" + list.n + "-" + modeKey);

        // family config, then mode config, then the generated title —
        // last writer wins, so a family can override anything generic.
        var cfg = {};
        function merge(src){ for(var k in src){ if(Object.prototype.hasOwnProperty.call(src, k)) cfg[k] = src[k]; } }
        merge(fam.config);
        merge(fam.modeConfig && fam.modeConfig[modeKey]);
        if(!cfg.title) cfg.title = listTitle + (fam.modes.length > 1 ? " · " + mode.title : "") + " " + mode.icon;
        if(!cfg.intro) cfg.intro = mode.intro;

        /* Most lists are just words. A passage carries its text, the
           family words it uses, and a round size of one — none of which
           the generator can work out, so they ride along from the list.
           A family that doesn't set them leaves them undefined and every
           reader behaves exactly as it did. */
        out.push({
          id: id,
          family: fam.key,
          listNum: list.n,
          text: list.text,
          targets: list.targets,
          sessionSize: list.sessionSize,
          mode: modeKey,
          engine: mode.engine,
          section: fam.section,
          page: page,
          icon: mode.icon,
          listTitle: listTitle,
          short: short,
          title: listTitle + " · " + mode.title,
          description: fam.description,
          config: cfg,
          words: list.words
        });
      });
    });
  });
  return out;
})();

window.WordLists = (function(){
  "use strict";
  var all = window.WORD_LISTS;
  var index = {};
  all.forEach(function(l){ index[l.id] = l; });

  // How many entries each page serves — one for the say-it and spell-it
  // pages, fifteen for cards-game.html. hrefOf reads it to decide whether
  // a link needs a ?list= at all.
  var pageServes = {};
  all.forEach(function(l){ pageServes[l.page] = (pageServes[l.page] || 0) + 1; });

  var CHUNK_SEP = "·";
  // The plain word, with the two display marks removed — the syllable dots
  // and the braces round a red word's heart letters ("s{ai}d"). This is the
  // form every stat key, every match and every bit of stored data uses;
  // the marked-up forms never leave the engine's display code.
  function plain(entry){
    return String(entry || "").split(CHUNK_SEP).join("").replace(/[{}]/g, "");
  }

  function familyOf(key){
    for(var i=0;i<window.LIST_FAMILIES.length;i++) if(window.LIST_FAMILIES[i].key === key) return window.LIST_FAMILIES[i];
    return null;
  }

  return {
    all: all,
    ids: all.map(function(l){ return l.id; }),
    byId: function(id){ return index[id] || null; },
    exists: function(id){ return !!index[id]; },
    // Plain words for a list, in list order.
    wordsOf: function(id){
      var l = index[id];
      return l ? l.words.map(plain) : [];
    },
    // dotted entry ↔ plain word, so a session picked by plain word can be
    // handed back to the engine with its syllable marks intact.
    entryMap: function(id){
      var l = index[id], m = {};
      if(l) l.words.forEach(function(e){ m[plain(e)] = e; });
      return m;
    },
    plain: plain,

    /* The home page's two shelves. They used to be one per modality —
       speaking games, typing games — which stopped meaning anything the
       day every list could be played four ways. What actually divides
       this library is the reading itself: words you can build out of
       their sounds, and words that refuse to be built and have to be
       known. That distinction is the whole curriculum. */
    sectionsOf: function(){
      return [
        { key:"decode", title:"🔤 Sounding It Out",
          note:"Words you can build out of their sounds. Some of these listen to you, some just check you — the label on each button says which." },
        { key:"sight",  title:"🃏 Red Words",
          note:"The words that break the rules. There's nothing to sound out, so these are about knowing them on sight." }
      ];
    },

    /* ── modes ──────────────────────────────────────────────────────── */
    MODES: MODES,
    modeOf: function(key){ return MODES[key] || null; },
    // A family's modes as full definitions, in the family's own order.
    modesOf: function(familyKey){
      var fam = familyOf(familyKey);
      if(!fam) return [];
      return fam.modes.map(function(k){ return MODES[k]; }).filter(Boolean);
    },

    /* Where a tile should link. cards-game.html and match-game.html serve
       every family, so they have to be told which list to play; a page
       that serves exactly one entry already knows, and gets a clean
       address a student can copy off the board without a query string. */
    hrefOf: function(id){
      var l = index[id];
      if(!l) return "#";
      return pageServes[l.page] > 1 ? l.page + "?list=" + encodeURIComponent(l.id) : l.page;
    },

    /* ── families ───────────────────────────────────────────────────── */
    families: function(){ return window.LIST_FAMILIES.slice(); },
    // What a list is teaching, in a teacher's words. Falls back to the
    // family title so a family added without a tag still reads sensibly.
    patternOf: function(listId){
      var l = index[listId];
      if(!l) return "";
      var fam = familyOf(l.family);
      return (fam && (fam.pattern || fam.title)) || "";
    },
    familyOf: familyOf,
    // Every list number a family has, ascending.
    listNumsOf: function(familyKey){
      var seen = {};
      all.forEach(function(l){ if(l.family === familyKey) seen[l.listNum] = true; });
      return Object.keys(seen).map(Number).sort(function(a,b){ return a-b; });
    },
    idFor: function(familyKey, listNum, modeKey){
      for(var i=0;i<all.length;i++){
        var l = all[i];
        if(l.family === familyKey && l.listNum === listNum && l.mode === modeKey) return l.id;
      }
      return null;
    },
    // Every id in one family — what a column toggle on the board sets.
    idsOfFamily: function(familyKey){
      return all.filter(function(l){ return l.family === familyKey; }).map(function(l){ return l.id; });
    },
    // Every id for one list of one family, across its modes.
    idsOfList: function(familyKey, listNum){
      return all.filter(function(l){ return l.family === familyKey && l.listNum === listNum; })
                .map(function(l){ return l.id; });
    },

    /* ── describing an assignment ─────────────────────────────────────
       Pure. Turns a list of ids into the one line the roster, the picker
       and the board all show:
         "everything" / "nothing" /
         "Starting Blends: 🎤🃏 · Red Words: 1–3, 5 🃏 · 1–3 🎯"
       A family with one list has nothing useful to say about WHICH list,
       so it shows only the modes; a family with ten says the list
       numbers per mode, as ranges, so ten ticked boxes read as "1–10"
       rather than as ten numbers. */
    rangeText: rangeText,

    /* One family's share of an assignment, without its title — "1–3, 5 🃏 ·
       1–3 🎯" for the red words, "🎤🃏" for a family with a single list.
       Empty string when the family has nothing in `ids`. The Assign board
       shows this on its own in a collapsed family's summary column; the
       line below builds the whole sentence out of these. */
    describeFamily: function(familyKey, ids){
      return familyPart(familyOf(familyKey), haveSet(ids));
    },

    describeAssignment: function(ids){
      var have = haveSet(ids);
      if(!have.n) return "nothing";
      if(have.n === all.length) return "everything";
      var parts = [];
      window.LIST_FAMILIES.forEach(function(fam){
        var part = familyPart(fam, have);
        if(part) parts.push(fam.title + ": " + part);
      });
      return parts.join(" · ");
    }
  };

  /* The ids a caller handed us as a lookup: unknown ids dropped, repeats
     collapsed, and `n` the count of what actually survived — which is
     what "everything" has to be measured against. */
  function haveSet(ids){
    var have = { n: 0 };
    (Array.isArray(ids) ? ids : []).forEach(function(id){
      if(index[id] && !have[id]){ have[id] = true; have.n++; }
    });
    return have;
  }

  /* What one family contributes to the summary line. A family with ten
     lists has to say WHICH ones, per mode, as ranges — "1–3, 5 🃏" — so
     ten ticked boxes don't read as ten numbers. A family with one list
     has nothing to say about which, so it says only how: "🎤🃏". */
  function familyPart(fam, have){
    if(!fam) return "";
    var modes = fam.modes.map(function(k){ return MODES[k]; }).filter(Boolean);
    if(fam.lists.length > 1){
      return modes.map(function(m){
        var nums = all.filter(function(l){ return l.family === fam.key && l.mode === m.key && have[l.id]; })
                      .map(function(l){ return l.listNum; });
        return nums.length ? rangeText(nums) + " " + m.icon : "";
      }).filter(Boolean).join(" · ");
    }
    return modes.filter(function(m){
      return all.some(function(l){ return l.family === fam.key && l.mode === m.key && have[l.id]; });
    }).map(function(m){ return m.icon; }).join("");
  }

  // "1–3, 5, 8–10" from [1,2,3,5,8,9,10]; order-insensitive, dedupes.
  function rangeText(nums){
    var u = {}; (nums || []).forEach(function(n){ u[n] = true; });
    var a = Object.keys(u).map(Number).sort(function(x,y){ return x-y; });
    var out = [], i = 0;
    while(i < a.length){
      var j = i;
      while(j + 1 < a.length && a[j+1] === a[j] + 1) j++;
      out.push(j - i >= 1 ? a[i] + "–" + a[j] : String(a[i]));
      i = j + 1;
    }
    return out.join(", ");
  }
})();
