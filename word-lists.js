/* ════════════════════════════════════════════════════════════════════
   word-lists.js — the list library. One entry per practice list.

   This file is the single source of truth for what a list IS. Before
   sign-in existed, each game page carried its own word list inline; now
   three separate things need to agree about them —

     · the game page, which plays one list
     · the home page, which shows the tiles a student has been assigned
     · the teacher dashboard, which assigns lists by name and reports
       per-word accuracy inside them

   — so the lists moved here and the pages became two lines each. A game
   page is now just `EIPractice.play("<id>")`.

   ── Adding a list ─────────────────────────────────────────────────────
   1. Add an entry below. The `id` is permanent: it is half of every
      Firestore stat key ("<id>|<word>", see adaptive.js) and it is what
      an assignment stores, so renaming one orphans a class's history.
      Change `title` freely — that's the display name.
   2. Copy any existing game page, change the id in its one line of
      script, and point `page` at the new filename.
   The home page and the dashboard pick it up with no further edits.

   `engine` picks which of the four engines plays it — "blend" is the
   say-it-out-loud engine (blend-game.js), "spell" the type-what-you-hear
   one (spell-game.js), "card" the flash cards (card-game.js) and "match"
   the hear-it-find-it game (match-game.js). `config` is everything that
   engine's start() takes except `words`, which lives alongside it so the
   two can't drift.

   Entries that share a page (the red-word lists) carry `family`,
   `listNum` and `game`; the page then reads WHICH list to play from its
   query string — `EIPractice.play()` with no id — and the home page and
   dashboard show the family as a lists × games grid. See the red-word
   block below.
   ════════════════════════════════════════════════════════════════════ */

/* ── Red words ─────────────────────────────────────────────────────────
   The ten high-frequency irregular-word lists from the SUHSD "red word"
   screener, twenty words each, in printed order. data/red-words.md is
   the source of record (where they came from, how the paper screener
   scores them, why four words repeat across lists); these arrays are
   that file transcribed, so a correction belongs in both places.

   Unlike every other list here, a red-word list is playable by TWO
   engines — flash cards (card-game.js) and Match It (match-game.js) —
   and those are different skills: a student can know "would" on sight
   and still pick "could" out of six look-alikes. So each list becomes
   two registry entries below, "red-N-cards" and "red-N-match", with
   separate stat keys, exactly as oi-oy-read / oi-oy-spell already are.
   The `family` / `listNum` / `game` fields are what let the home page
   and the dashboard fold those twenty entries back into one grid. */
var RED_LISTS = [
  ["you","should","could","said","they","have","of","are","what","put",
   "would","to","your","was","the","once","do","from","into","two"],
  ["give","were","many","whose","any","here","live","some","Mrs.","Mr.",
   "where","other","one","whom","right","there","done","great","does","their"],
  ["thought","who","come","very","again","aren't","weren't","mother","father","brother",
   "watch","haven't","they'd","you'd","against","friend","they'll","we're","they're","you're"],
  ["beautiful","been","blood","none","only","says","sure","both","bought","buy",
   "prove","straight","worn","push","today","pull","most","change","child","clothes"],
  ["flood","floor","often","door","gone","laugh","break","steak","above","they've",
   "you","lose","tough","view","rough","front","love","among","anyone","answer"],
  ["nothing","cousins","cover","courage","toward","enough","through","sugar","busy","almost",
   "ninth","although","always","another","onion","though","people","build","piano","pint"],
  ["shoved","butcher","post","pretty","canoe","promise","carrot","cough","roll","danger",
   "debt","sew","shoe","heart","forward","son","four","spirit","swan","bouquet"],
  ["honest","toll","honor","touch","hour","Tuesday","Wednesday","imagine","iron","wind",
   "wolf","won","wore","move","minute","mirror","young","success","already","idea"],
  ["music","sure","garage","system","figure","friend","national","ready","island","unique",
   "ocean","radio","feature","continue","condition","caution","enough","guarantee","technique","anxious"],
  ["cologne","resumé","resume","boutique","fair","pair","fought","eye","show","small",
   "about","call","fall","mall","air","know","large","barge","house","mouse"]
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

var RED_NOTE_MATCH = `
    <p><b>Red words</b> break the rules, so you can't sound them out — you
    have to know them by sight. This game checks that: the words on screen
    are picked to look like each other, so <b>would</b>, <b>could</b> and
    <b>should</b> turn up together.</p>
    <p>Read all the way to the <b>end</b> of each word. The first letter
    won't be enough.</p>`;

window.WORD_LISTS = [

  /* ── Speaking (blend-game.js) ─────────────────────────────────────── */

  {
    id: "final-blends",
    title: "Blend Words",
    icon: "🎤",
    engine: "blend",
    section: "speak",
    page: "blend-words-game.html",
    description: "Read a word that ends with a consonant blend out loud. The computer listens and tells you if you said it right. Build a streak for bonus points!",
    config: { title: "Blend Words 🎤", blend: "end", theme: "race" },
    words: ["soft","golf","honk","cost","pond","vest","nest","tent","kelp","helm",
            "elk","sect","tusk","dusk","lump","hunk","damp","sand","pant","sank",
            "gasp","raft","wisp","lisp","risk","mink","link","kilt","silk","milk","sift"]
  },

  {
    id: "initial-blends",
    title: "Starting Blends",
    icon: "🗣️",
    engine: "blend",
    section: "speak",
    page: "initial-blends-game.html",
    description: "Words that begin with a consonant blend — bl, cr, sl, tr. Say each one out loud and the computer checks you.",
    config: { title: "Starting Blends 🎤", blend: "start", theme: "maze" },
    // From the classroom flashcard set.
    words: ["blip","crop","clam","grab","flub","grin","glad","prop","plop","trip",
            "plum","trot","sled","bled","slug","fled","scam","glen","skip","spin",
            "snip","spot","stem","drum","bran","drag","crab","frog"]
  },

  {
    id: "nonsense",
    title: "Nonsense Words",
    icon: "🤖",
    engine: "blend",
    section: "speak",
    page: "nonsense-words-game.html",
    description: "Made-up CVC words with no meaning to lean on — pure sounding-out practice. Say each one out loud and the computer checks you.",
    config: {
      title: "Nonsense Words 🤖",
      intro: "These aren't real words — sound out the letters and say it out loud. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!",
      blend: "start", blendLength: 0, theme: "race"
    },
    words: ["jag","baz","wat","gan","vab","sab","raz","taf",
            "sem","ted","ret","heg","peb","yed","leb","ren",
            "lif","vip","pid","tix","rit","sig","lim","din",
            "bop","pon","com","fod","hom","rof","jom","loz",
            "fug","tup","sug","lun","sud","hux","gud","muv"]
  },

  {
    id: "oi-oy-read",
    title: "oi/oy Words",
    icon: "🪙",
    engine: "blend",
    section: "speak",
    page: "oi-oy-words-game.html",
    description: "Words with the oi/oy sound — coin, join, annoy, royal. Say each one out loud and the computer checks you.",
    config: { title: "oi/oy Words 🪙", blend: "sound", sound: "OY", highlight: /oi|oy/i, theme: "maze" },
    words: ["annoy","appoint","avoid","boyish","broil","choice","cloying","coil","coin",
            "convoy","coy","decoy","deploy","destroy","devoid","droid","employ","enjoy",
            "foil","hoist","join","joint","loyal","moist","noise","poison","ploy","royal",
            "soil","soy","spoil","toil","void"]
  },

  {
    id: "multisyllable",
    title: "Multisyllable Words",
    icon: "🏗️",
    engine: "blend",
    section: "speak",
    page: "multisyllable-words-game.html",
    description: "Two- and three-syllable words like napkin, picnic and fantastic. Say each one out loud and the computer checks you.",
    config: {
      title: "Multisyllable Words 🏗️",
      intro: "Read the whole word out loud, one syllable at a time. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!",
      blend: "start", blendLength: 0, theme: "race"
    },
    // Middle dots mark syllable boundaries — the engine strips them
    // everywhere that matters and uses them only to scaffold the reveal.
    words: ["soft","pub·lic","gob·lin","fab·ric","gos·sip","nap·kin","sun·lit","sub·mit","an·tic",
            "on·set","sub·set","hub·cap","pic·nic","at·tic","un·til","cab·in","in·dex","mas·cot",
            "un·fit","hab·it","pan·ic","ex·am","hec·tic","com·ic","vic·tim","rob·in","muf·fin",
            "bob·bin","up·set","fan·tas·tic","vol·can·ic","in·hib·it","mag·net·ic","in·hab·it",
            "dis·gust·ed","max·i·mum","min·i·mum"]
  },

  /* ── Typing (spell-game.js) ───────────────────────────────────────── */

  {
    id: "oi-oy-spell",
    title: "Spell It: oi/oy",
    icon: "⌨️",
    engine: "spell",
    section: "type",
    page: "spelling-oi-oy-game.html",
    description: "No mic — headphones only. The computer says a word and you type it. Learn when the /oy/ sound is spelled oi and when it's oy.",
    /* Deliberately the same word list as oi-oy-read, run the other
       direction: there the student reads the word, here the computer says
       it and the student spells it. They are separate ids, and therefore
       separate stat keys, because they are separate skills — a student can
       read "moist" cold and still spell it "moyst". */
    config: {
      title: "Spell It: oi / oy ⌨️",
      intro: "No microphone — headphones only. The computer says a word, you type it.<br>Two tries each. Every 5 right in a row is bonus points!",
      highlight: /oi|oy/i,
      rule:
        '<p style="margin:0">Both spellings say <b>/oy/</b>. What decides between them is <b>where the sound sits</b>.</p>' +
        "<ul>" +
        "<li><b>oy</b> ends the word — enj<b>oy</b>, dec<b>oy</b>, s<b>oy</b> — or comes right before a vowel: r<b>oy</b>al, b<b>oy</b>ish.</li>" +
        "<li><b>oi</b> sits inside the word, before a consonant — c<b>oi</b>n, m<b>oi</b>st, av<b>oi</b>d.</li>" +
        "</ul>" +
        '<p class="tip">Stuck? Ask what comes after the sound. Nothing or a vowel → <b>oy</b>. A consonant → <b>oi</b>.</p>',
      // Spoken between the two reads of the word, spelling-bee style. A
      // lone synthesised word is easy to mishear; the sentence is what
      // makes it unmistakable. Each sentence uses the word exactly once
      // and never contains another word from the list.
      sentences: {
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
      }
    },
    words: ["annoy","appoint","avoid","boyish","broil","choice","cloying","coil","coin",
            "convoy","coy","decoy","deploy","destroy","devoid","droid","employ","enjoy",
            "foil","hoist","join","joint","loyal","moist","noise","poison","ploy","royal",
            "soil","soy","spoil","toil","void"]
  }

];

/* The twenty red-word entries, generated so the ten arrays above stay the
   only copy of the words. One entry per (list, game). */
RED_LISTS.forEach(function(words, i){
  var n = i + 1;
  window.WORD_LISTS.push({
    id: "red-" + n + "-cards",
    title: "Red Words · List " + n,
    short: "List " + n,
    icon: "🃏",
    engine: "card",
    section: "cards",
    page: "red-words-game.html",
    family: "red", listNum: n, game: "cards",
    description: "Read the card out loud, flip it to hear the word, and tell the game if you got it. Words that break the rules — said, would, Wednesday.",
    config: {
      title: "Red Words · List " + n + " 🃏",
      intro: "No mic, no typing. A word shows — read it out loud, flip the card, and see if you were right.<br>Build a streak: every 5 in a row is bonus points!",
      note: RED_NOTE_CARDS
    },
    words: words
  });
  window.WORD_LISTS.push({
    id: "red-" + n + "-match",
    title: "Red Words · List " + n + ": Match It",
    short: "List " + n,
    icon: "🎯",
    engine: "match",
    section: "cards",
    page: "red-words-match-game.html",
    family: "red", listNum: n, game: "match",
    description: "Headphones only. The computer says a red word and you find it — next to would, could and should. The wrong answers look close on purpose, so read to the end.",
    config: {
      title: "Red Words · List " + n + ": Match It 🎯",
      intro: "No mic — headphones only. The computer says a word and you find it.<br>The wrong answers look close on purpose. Every 5 right in a row is bonus points!",
      note: RED_NOTE_MATCH,
      choices: 6,
      homophones: RED_HOMOPHONES,
      sentences: RED_SENTENCES
    },
    words: words
  });
});

/* The families the dashboard and home page show as a grid rather than a
   flat list of entries: one row per list number, one column per game. A
   registry entry belongs to a family when it carries `family`; entries
   without one are standalone games and show as plain tiles/checkboxes. */
window.LIST_FAMILIES = [
  {
    key: "red",
    title: "Red Words",
    icon: "🃏",
    note: "Ten screener lists of twenty sight words. Each list can be assigned as flash cards, Match It, or both.",
    games: [
      { key: "cards", title: "Cards",    icon: "🃏", blurb: "read it, flip it, rate yourself" },
      { key: "match", title: "Match It", icon: "🎯", blurb: "hear it, find it — checked by the computer" }
    ]
  }
];

window.WordLists = (function(){
  "use strict";
  var all = window.WORD_LISTS;
  var index = {};
  all.forEach(function(l){ index[l.id] = l; });

  var CHUNK_SEP = "·";
  // The plain word, with any syllable dots removed — the form every stat
  // key, every match and every bit of stored data uses. The dotted form
  // never leaves the engine's display code.
  function plain(entry){ return String(entry || "").split(CHUNK_SEP).join(""); }

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
    sectionsOf: function(){
      return [
        { key:"speak", title:"🎤 Speaking Games", note:"Put on a mic and say each word out loud." },
        { key:"type",  title:"⌨️ Typing Games",   note:"No mic — just headphones. The computer says a word and you type it." },
        { key:"cards", title:"🃏 Red Words",      note:"No mic and no typing — read a word on sight, or find the one you hear." }
      ];
    },

    /* Where a tile should link. A family entry shares one page with its
       siblings and tells the page which list to play through the query
       string; a standalone game has its own page and needs nothing. */
    hrefOf: function(id){
      var l = index[id];
      if(!l) return "#";
      return l.family ? l.page + "?list=" + encodeURIComponent(l.id) : l.page;
    },

    /* ── families ───────────────────────────────────────────────────── */
    families: function(){ return window.LIST_FAMILIES.slice(); },
    familyOf: function(key){
      for(var i=0;i<window.LIST_FAMILIES.length;i++) if(window.LIST_FAMILIES[i].key === key) return window.LIST_FAMILIES[i];
      return null;
    },
    // The entries that aren't in any family — the plain, one-tile games.
    standalone: function(){ return all.filter(function(l){ return !l.family; }); },
    // Every list number a family has, ascending.
    listNumsOf: function(familyKey){
      var seen = {};
      all.forEach(function(l){ if(l.family === familyKey) seen[l.listNum] = true; });
      return Object.keys(seen).map(Number).sort(function(a,b){ return a-b; });
    },
    idFor: function(familyKey, listNum, gameKey){
      var id = familyKey + "-" + listNum + "-" + gameKey;
      return index[id] ? id : null;
    },

    /* ── describing an assignment ─────────────────────────────────────
       Pure. Turns a list of ids into the one line the roster shows:
         "everything" / "nothing" /
         "3 games · Red Words: lists 1–3, 5 (cards) · 1–3 (match)"
       Ranges so ten ticked boxes read as "1–10", not ten numbers. */
    rangeText: rangeText,
    describeAssignment: function(ids){
      ids = Array.isArray(ids) ? ids.filter(function(id){ return !!index[id]; }) : [];
      if(!ids.length) return "nothing";
      if(ids.length === all.length) return "everything";
      var have = {}; ids.forEach(function(id){ have[id] = true; });
      var parts = [];
      var games = all.filter(function(l){ return !l.family && have[l.id]; }).length;
      if(games) parts.push(games + (games === 1 ? " game" : " games"));
      window.LIST_FAMILIES.forEach(function(fam){
        var bits = fam.games.map(function(g){
          var nums = all.filter(function(l){ return l.family === fam.key && l.game === g.key && have[l.id]; })
                        .map(function(l){ return l.listNum; });
          return nums.length ? rangeText(nums) + " (" + g.title.toLowerCase() + ")" : "";
        }).filter(Boolean);
        if(bits.length) parts.push(fam.title + ": lists " + bits.join(" · "));
      });
      return parts.join(" · ");
    }
  };

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
