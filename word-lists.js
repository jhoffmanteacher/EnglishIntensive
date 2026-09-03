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

   `engine` picks which of the two engines plays it — "blend" is the
   say-it-out-loud engine (blend-game.js), "spell" is the type-what-you-
   hear one (spell-game.js). `config` is everything that engine's start()
   takes except `words`, which lives alongside it so the two can't drift.
   ════════════════════════════════════════════════════════════════════ */

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
        { key:"type",  title:"⌨️ Typing Games",   note:"No mic — just headphones. The computer says a word and you type it." }
      ];
    }
  };
})();
