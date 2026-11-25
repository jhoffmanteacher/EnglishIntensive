/* ════════════════════════════════════════════════════════════════════
   wrong-readings.js — the wrong reading to say on purpose, per word.

   Shared by two tools and nothing else on the site:
     · mic-takes.html, the teacher's recorder: its `wrong` script shows,
       for each word, one specific misreading to say aloud;
     · tools/listen-loop.mjs, the closed loop: its virtual reader makes
       the same misreadings (loaded into a Node vm beside game-core.js and
       word-lists.js).
   One generator, so a take recorded on the page and a virtual read in the
   loop mean the same thing by "wrong".

   The wrong readings are the errors each list exists to catch, made BY
   RULE from the lists' own data wherever a rule gives a sensible one:

     Starting Blends  a blend sound dropped or swapped: crab -> cab (the
                      second letter of the blend dropped), rab (the first
                      dropped), clab (l and r swapped).
     Blend Words      the final blend cut short: gasp -> gas (last sound
                      dropped — README "Which part went wrong"), gap (the
                      blend's first sound dropped).
     Nonsense Words   the twin on the list: the other list word nearest in
                      sound (sug -> sig, by GameCore.phoneticDistance); a
                      vowel turned if a word has no twin.
     oi / oy          the wrong vowel: the oi/oy read as a plain o (coin ->
                      con, moist -> most), or as "ay" (boy -> bay).
     Multisyllable    a syllable dropped, from the list's own syllable dots:
                      fan·tas·tic -> fantic, nap·kin -> nap.
     Red Words        a small hand-written table of the classic misreadings
                      (said -> "sayed", island -> "is land" — the README's
                      own examples), then, by rule, a single-vowel heart
                      read as a short vowel (wh{a}t -> "wat", a as in cat),
                      then a look-alike red word with the same first two
                      letters (your -> you). A word none of these reaches
                      has no wrong reading, and the recorder says so.

   Every reading carries `how` — a short line telling the reader what to
   say — and `src`: "rule" or "table", so a report can say which is which.
   ════════════════════════════════════════════════════════════════════ */
(function(root){
  "use strict";

  function core(){ return root.GameCore; }
  function lists(){ return root.WordLists; }

  /* The classic misreadings of red words a rule can't produce. `say` is
     what the reader says; `heard` is the spelling a recogniser would most
     plausibly write for it (the loop's recogniser model uses it; the
     recorder only shows `say`). Kept small on purpose: a row belongs here
     only when it is a misreading teachers actually hear. */
  var RED_TABLE = {
    said:    { say: "sayed",   how: "rhymes with played",          heard: "sayed" },
    says:    { say: "sayz",    how: "rhymes with days",            heard: "sayz" },
    island:  { say: "is land", how: "two words: is, land",         heard: "is land" },
    father:  { say: "fat her", how: "two words: fat, her",         heard: "fat her" },
    nothing: { say: "no thing",how: "two words: no, thing",        heard: "no thing" },
    one:     { say: "own",     how: "rhymes with bone",            heard: "own" },
    was:     { say: "saw",     how: "the letters backwards",       heard: "saw" },
    of:      { say: "off",     how: "rhymes with cough",           heard: "off" },
    have:    { say: "hayv",    how: "rhymes with gave",            heard: "halve" },
    give:    { say: "gyve",    how: "rhymes with five",            heard: "guy" },
    done:    { say: "dohn",    how: "rhymes with bone",            heard: "doan" },
    gone:    { say: "gohn",    how: "rhymes with bone",            heard: "goan" },
    come:    { say: "comb",    how: "rhymes with home",            heard: "comb" },
    some:    { say: "sohm",    how: "rhymes with home",            heard: "psalm" },
    love:    { say: "lohv",    how: "rhymes with stove",           heard: "loaf" },
    move:    { say: "mohv",    how: "rhymes with stove",           heard: "mauve" },
    great:   { say: "greet",   how: "rhymes with feet",            heard: "greet" },
    break:   { say: "breek",   how: "rhymes with week",            heard: "brick" },
    steak:   { say: "steek",   how: "rhymes with week",            heard: "stick" },
    friend:  { say: "fried",   how: "rhymes with tried",           heard: "fried" },
    been:    { say: "bean",    how: "rhymes with seen",            heard: "bean" },
    could:   { say: "cold",    how: "rhymes with old",             heard: "cold" },
    would:   { say: "wold",    how: "rhymes with old",             heard: "world" },
    should:  { say: "shold",   how: "rhymes with old",             heard: "shoaled" },
    you:     { say: "yo",      how: "rhymes with go",              heard: "yo" },
    do:      { say: "doe",     how: "rhymes with go",              heard: "doe" },
    to:      { say: "toe",     how: "rhymes with go",              heard: "toe" },
    who:     { say: "how",     how: "rhymes with cow",             heard: "how" },
    put:     { say: "putt",    how: "rhymes with but",             heard: "putt" },
    are:     { say: "air",     how: "rhymes with care",            heard: "air" },
    here:    { say: "her",     how: "rhymes with fur",             heard: "her" },
    know:    { say: "now",     how: "rhymes with cow",             heard: "now" },
    heart:   { say: "hurt",    how: "rhymes with shirt",           heard: "hurt" },
    eye:     { say: "eh",      how: "e as in bet",                 heard: "eh" },
    enough:  { say: "en-ow",   how: "the end rhymes with cow",     heard: "and now" },
    ocean:   { say: "oh-kee-an", how: "c as in cat",               heard: "okie and" },
    national:{ say: "nay-shun-al", how: "a as in name",            heard: "nation al" },
    unique:  { say: "un-ick",  how: "rhymes with sick at the end", heard: "unick" },
    technique:{ say: "tech-nick", how: "rhymes with sick at the end", heard: "tech nick" },
    view:    { say: "vee-ew",  how: "two parts: vee, ew",          heard: "v you" },
    right:   { say: "rig-ht",  how: "say the g",                   heard: "rigged" },
    iron:    { say: "eye-ron", how: "say the r where it is written", heard: "i ron" },
    sew:     { say: "soo",     how: "rhymes with new",             heard: "sue" },
    blood:   { say: "blued",   how: "rhymes with food",            heard: "blued" },
    debt:    { say: "deb-t",   how: "say the b",                   heard: "debit" },
    spirit:  { say: "spy-rit", how: "i as in five",                heard: "spy right" },
    what:    { say: "wat",     how: "rhymes with cat",             heard: "watt" },
    there:   { say: "three",   how: "a look-alike word",           heard: "three" },
    were:    { say: "where",   how: "a look-alike word",           heard: "where" },
    where:   { say: "were",    how: "a look-alike word",           heard: "were" },
    though:  { say: "through", how: "a look-alike word",           heard: "through" },
    through: { say: "though",  how: "a look-alike word",           heard: "though" },
    thought: { say: "though",  how: "a look-alike word",           heard: "though" },
    from:    { say: "form",    how: "a look-alike word",           heard: "form" },
    lose:    { say: "loose",   how: "rhymes with goose",           heard: "loose" },
    sugar:   { say: "sugger",  how: "s as in sun, u as in cup",    heard: "sucker" },
    sure:    { say: "sir",     how: "s as in sun",                 heard: "sir" },
    pretty:  { say: "pretty with e as in bet", how: "e as in bet", heard: "pre tee" },
    busy:    { say: "bussy",   how: "u as in bus",                 heard: "bussy" },
    pint:    { say: "pint with i as in pin", how: "i as in pin",   heard: "pinned" },
    ninth:   { say: "nineth with i as in pin", how: "i as in pin", heard: "nith" },
    wolf:    { say: "wolf with o as in hot", how: "o as in hot",   heard: "walf" }
  };

  var SHORT_AS = { a: "cat", e: "bet", i: "pin", o: "hot", u: "cup" };

  function familyOf(listId){
    var l = lists() && lists().byId(listId);
    return l ? l.family : "";
  }

  // The marked-up entry for a plain word on a list ("s{ai}d", "fan·tas·tic").
  function entryOf(listId, word){
    var m = lists().entryMap(listId);
    return Object.prototype.hasOwnProperty.call(m, word) ? m[word] : word;
  }

  function uniq(arr, not){
    var seen = {}, out = [];
    arr.forEach(function(o){
      if(!o || !o.say || o.say === not || seen[o.say]) return;
      seen[o.say] = 1; out.push(o);
    });
    return out;
  }

  function sounds(w){ return core().expandPhonemes(core().phonemes(w)); }

  /* Every sensible wrong reading of `word` on `listId`, best first. Each is
     { say, how, heard, kind, src }. `heard` is what the loop's recogniser
     model starts from; for a rule-made reading it is the reading itself,
     and "" where no spelling can be guessed (a red word's vowel read
     short sounds different but is spelled the same). */
  function options(listId, word){
    var fam = familyOf(listId), w = String(word || "").toLowerCase(), out = [];
    function add(say, how, kind, src, heard){ out.push({ say: say, how: how, kind: kind, src: src || "rule", heard: heard === undefined ? say : heard }); }

    if(fam === "blends-start"){
      add(w[0] + w.slice(2), "drop the " + w[1] + " in the blend", "blend-drop");
      add(w.slice(1), "drop the " + w[0] + " at the start", "blend-drop");
      if(w[1] === "l") add(w[0] + "r" + w.slice(2), "say r instead of l", "blend-swap");
      if(w[1] === "r") add(w[0] + "l" + w.slice(2), "say l instead of r", "blend-swap");
    } else if(fam === "blends-end"){
      add(w.slice(0, -1), "drop the last sound, " + w.slice(-1), "blend-drop");
      add(w.slice(0, -2) + w.slice(-1), "drop the " + w.slice(-2, -1) + " in the blend", "blend-drop");
    } else if(fam === "nonsense"){
      var mine = sounds(w);
      var twins = lists().wordsOf(listId).filter(function(x){ return x !== w; }).map(function(x){
        return { x: x, d: core().phoneticDistance(sounds(x), mine) };
      }).filter(function(o){ return o.d <= 1; }).sort(function(a, b){ return a.d - b.d || (a.x < b.x ? -1 : 1); });
      twins.forEach(function(t){ add(t.x, "its twin on the list", "twin"); });
      var vow = "aeiou", at = w.search(/[aeiou]/);
      if(at >= 0){
        var v = vow[(vow.indexOf(w[at]) + 1) % 5];
        add(w.slice(0, at) + v + w.slice(at + 1), v + " as in " + SHORT_AS[v] + " instead of " + w[at], "vowel");
      }
    } else if(fam === "oi-oy"){
      add(w.replace(/oi|oy/, "o"), "read the " + (/oi/.test(w) ? "oi" : "oy") + " as o, as in hot", "vowel");
      add(w.replace(/oi|oy/, "ay"), "read the " + (/oi/.test(w) ? "oi" : "oy") + " as ay, as in day", "vowel");
    } else if(fam === "multi"){
      var parts = String(entryOf(listId, w)).split("·");
      if(parts.length >= 3){
        add(parts[0] + parts[parts.length - 1], "drop the middle part, " + parts.slice(1, -1).join("·"), "syllable");
        add(parts.slice(0, -1).join(""), "drop the last part, " + parts[parts.length - 1], "syllable");
      } else if(parts.length === 2){
        add(parts[0], "say only the first part, " + parts[0], "syllable");
        add(parts[1], "say only the last part, " + parts[1], "syllable");
      }
    } else if(fam === "red"){
      var t = RED_TABLE[w];
      if(t) add(t.say, t.how, "classic", "table", t.heard);
      var entry = String(entryOf(listId, w));
      var heart = /\{([^}]*)\}/.exec(entry);
      if(heart && /^[aeiou]$/.test(heart[1])){
        add(w + " (" + heart[1] + " as in " + SHORT_AS[heart[1]] + ")", "read the " + heart[1] + " as in " + SHORT_AS[heart[1]],
            "sounded-out", "rule", "");
      }
      /* A look-alike: another red word with the same first two letters,
         from this list first and then from any red list; failing that,
         the same first letter on this list. Never a word that sounds the
         same as this one — that is a right answer, not a misreading. */
      var cfg = (lists().byId(listId) || {}).config || {};
      function sameSound(x){
        return (cfg.homophones && core().sameHomophone(x, w, cfg.homophones)) ||
               (cfg.soundalikes && core().soundsLike(x, w, cfg.soundalikes));
      }
      var mineL = lists().wordsOf(listId), allRed = [];
      lists().all.forEach(function(l){ if(l.family === "red" && l.mode === "say") allRed = allRed.concat(lists().wordsOf(l.id)); });
      function pickFrom(pool, n){
        return pool.filter(function(x, i){ return x !== w && pool.indexOf(x) === i && !sameSound(x) && x.slice(0, n) === w.slice(0, n); });
      }
      var look = pickFrom(mineL, 2);
      if(!look.length) look = pickFrom(allRed, 2);
      look.slice(0, 2).forEach(function(x){ add(x, "a look-alike word", "look-alike"); });
    }
    return uniq(out, w);
  }

  // The one reading the recorder's `wrong` script asks for: the first
  // option, so the script is the same every time it is made.
  function pick(listId, word){
    var o = options(listId, word);
    return o.length ? o[0] : null;
  }

  /* Noise items: not a reading at all. `heard` is what a recogniser would
     write, or "" for nothing; the loop's model and the recorder share it. */
  var NOISE = [
    { key: "silence", say: "", how: "Say nothing. Wait for the next item.", heard: "" },
    { key: "cough",   say: "(cough)", how: "Cough once, away from the mic if you like.", heard: "uh" },
    { key: "um",      say: "um", how: "Say \"um\" and nothing else.", heard: "um" },
    { key: "idk",     say: "I don't know", how: "Say \"I don't know\".", heard: "I don't know" }
  ];

  var api = { options: options, pick: pick, NOISE: NOISE, RED_TABLE: RED_TABLE, entryOf: entryOf };
  root.WrongReadings = api;
})(typeof window !== "undefined" ? window : this);
