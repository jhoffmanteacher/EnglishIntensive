/* Shared engine for the matching games — hear a word, pick it out of a set.
 *
 * This is the auto-scored counterpart to card-game.js. The flash cards ask
 * the student to judge themselves, which is honest about what a sight word
 * is but means the score is only as good as the honesty. Here the computer
 * says a word and the student picks the printed word that matches, so the
 * game knows whether they were right — same skill, checked instead of
 * self-reported. Mic-free like the flash cards, so it still works in a loud
 * room.
 *
 *   MatchGame.start({
 *     title: "Red Words: Match It 🎯",
 *     intro: "…",
 *     note:  "<p>…</p>",                          // optional micro-lesson
 *     choices: 6,                                 // tiles per word (default 6)
 *     decks: [{ name:"List 1", words:["you","should", …] }, …],
 *     homophones: [["to","two"], …],              // never shown together
 *     sentences: { to: "I want to go home." }     // disambiguating read
 *   });
 *
 * The whole difficulty of the game lives in WHICH WRONG WORDS it shows. Six
 * random words off the list is a game you can win without reading — one
 * glance at the first letter is enough. So the distractors are chosen as the
 * most confusable words available (`nearestWords`), which for red words means
 * exactly the ones students actually mix up: would/could/should,
 * though/thought/through, where/were/there. Getting it right means reading
 * the whole word.
 *
 * Pushed all the way, though, that same idea breaks the game: the most
 * confusable word of all is a homophone, and no amount of listening
 * distinguishes "to" from "two". Two guards handle that — a `homophones`
 * group whose members are never shown together, and a `sentences` entry that
 * makes the read unambiguous ("two — I have two hands"). Any word list with
 * a homophone pair in it needs both.
 *
 * Screens, scoring and the end-of-round summary match the other engines, so
 * a student moving between games sees one scoring system.
 */
window.MatchGame = (function(){
  "use strict";

  // What this engine takes from game-core.js. Aliased once here rather than
  // reached through GameCore at every call site, so the code below reads the
  // same as it did when these lived in this file — and so the list of what's
  // shared is in one visible place.
  var Core = window.GameCore;
  var dedupeWords     = Core.dedupeWords,
      sampleWords     = Core.sampleWords,
      shuffled        = Core.shuffled,
      escapeHtml      = Core.escapeHtml,
      comboMultiplier = Core.comboMultiplier,
      pointsFor       = Core.pointsFor;

  var NORMAL_RATE = 0.95, SLOW_RATE = 0.75;
  var CHOICES = 6;          // tiles per word, unless the page says otherwise
  var MIX_SIZE = 20;        // words in the engine's "Mixed" deck

  /* ---------------- words and distractors (pure, testable) ---------------- */

  // Compared for confusability on letters alone: case, the period in "Mrs."
  // and the accent in "resumé" are not what a student is choosing between.
  // Apostrophes stay — "were" vs "we're" is a real distinction on the page.
  function normalizeWord(s){
    var t = String(s === null || s === undefined ? "" : s)
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc]/g, "'");     // smart quotes -> plain
    // Strip accents, so "resum\u00e9" and "resume" compare as the same letters.
    // That's deliberate: to a student scanning a row of tiles they ARE the
    // same letters, which is exactly why one must never be the other's wrong
    // answer — and normalizing here is what makes nearestWords drop it.
    if(t.normalize) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return t.replace(/[^a-z']/g, "");
  }

  // Plain Levenshtein. Small words, small lists — the naive DP is nowhere
  // near hot enough to be worth optimising, and it stays readable.
  function editDistance(a, b){
    a = normalizeWord(a); b = normalizeWord(b);
    if(a === b) return 0;
    if(!a.length) return b.length;
    if(!b.length) return a.length;
    var prev = [], cur = [], i, j;
    for(j=0;j<=b.length;j++) prev[j] = j;
    for(i=1;i<=a.length;i++){
      cur[0] = i;
      for(j=1;j<=b.length;j++){
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j-1] + 1,
          prev[j-1] + (a.charAt(i-1) === b.charAt(j-1) ? 0 : 1)
        );
      }
      for(j=0;j<=b.length;j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }

  function sharedPrefix(a, b){
    a = normalizeWord(a); b = normalizeWord(b);
    var n = Math.min(a.length, b.length), i = 0;
    while(i < n && a.charAt(i) === b.charAt(i)) i++;
    return i;
  }

  // The k words in `pool` most likely to be confused with `target`, best
  // first. Edit distance decides it; ties go to the word sharing more of the
  // opening letters (which is what the eye grabs first), then to the word
  // closest in length, then alphabetically so the ranking is stable rather
  // than dependent on the pool's order.
  function nearestWords(target, pool, k){
    var t = normalizeWord(target);
    var cands = dedupeWords(pool).filter(function(w){ return normalizeWord(w) !== t; });
    cands = cands.map(function(w){
      return { w: w, d: editDistance(target, w), p: sharedPrefix(target, w),
               l: Math.abs(normalizeWord(w).length - t.length) };
    });
    cands.sort(function(a, b){
      if(a.d !== b.d) return a.d - b.d;
      if(a.p !== b.p) return b.p - a.p;
      if(a.l !== b.l) return a.l - b.l;
      return a.w < b.w ? -1 : (a.w > b.w ? 1 : 0);
    });
    if(typeof k !== "number" || !isFinite(k) || k < 0) k = 0;
    return cands.slice(0, Math.floor(k)).map(function(c){ return c.w; });
  }

  // Everything a word sounds like, including itself — "to" pulls in "two".
  // Groups are compared normalized, so a page can write them however the
  // word list spells them.
  function soundAlikes(target, groups){
    var t = normalizeWord(target), out = [t];
    if(!groups) return out;
    for(var i=0;i<groups.length;i++){
      var g = groups[i] || [], hit = false, j;
      for(j=0;j<g.length;j++){ if(normalizeWord(g[j]) === t){ hit = true; break; } }
      if(!hit) continue;
      for(j=0;j<g.length;j++){
        var n = normalizeWord(g[j]);
        if(n && out.indexOf(n) === -1) out.push(n);
      }
    }
    return out;
  }

  // The wrong answers for one word: drawn from the most confusable words
  // available, minus anything that sounds like the target, because no amount
  // of listening tells "there" from "their".
  //
  // The ban is applied as the set is built, not just against the target,
  // because a tile set holding both "to" and "two" is muddled even when the
  // answer is neither of them. Every word picked takes its whole sound group
  // off the table, which also stops "resumé" and "resume" — the same letters
  // once the accent is stripped — from turning up as two separate tiles.
  //
  // Candidates are drawn from twice as many as it needs, so the same word
  // doesn't come with the same five wrong answers every single round while
  // still never reaching for a word that isn't genuinely confusable. If that
  // shortlist can't fill the set, it widens to the whole pool rather than
  // handing back a short one. `rnd` is a parameter so tests can make the
  // draw predictable.
  function distractorsFor(target, pool, n, groups, rnd){
    if(typeof n !== "number" || !isFinite(n) || n < 0) n = 0;
    n = Math.floor(n);
    var taken = soundAlikes(target, groups);
    var usable = dedupeWords(pool).filter(function(w){
      return taken.indexOf(normalizeWord(w)) === -1;
    });

    var out = [];
    function drawFrom(candidates){
      for(var i=0; i<candidates.length && out.length < n; i++){
        var w = candidates[i];
        var alikes = soundAlikes(w, groups);
        var clash = false;
        for(var j=0;j<alikes.length;j++){ if(taken.indexOf(alikes[j]) !== -1){ clash = true; break; } }
        if(clash) continue;
        out.push(w);
        taken = taken.concat(alikes);
      }
    }
    // The shortlist, in random order; then, only if it came up short, the
    // rest of the pool ranked the same way.
    var near = nearestWords(target, usable, n * 2);
    drawFrom(sampleWords(near, near.length, rnd));
    if(out.length < n) drawFrom(nearestWords(target, usable, usable.length));
    return out;
  }

  /* ---------------- styles ----------------
     Everything beyond blend-game.css: the tile grid, the listen panel and the
     deck picker. They ship inside the engine (like the other two engines'
     styles) so a game page stays two stylesheets and one script, and so the
     engine can never be loaded without them. */
  var STYLE_ID = "match-game-style";
  var STYLE = `
  /* the optional micro-lesson panel on the start screen */
  .note{background:var(--panel2);border:1px solid var(--line);border-left:5px solid var(--accent);
    border-radius:16px;padding:16px 20px;margin:0 0 22px;font-size:17px;line-height:1.65}
  .note .tag{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--accent);font-weight:800;margin-bottom:8px}
  .note b{color:var(--accent)}
  .note p{margin:0}
  .note p + p{margin-top:8px}

  /* deck picker — shared look with card-game.js's, since it's the same
     control doing the same job on a sibling game. */
  .decks{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 6px}
  .deckbtn{
    background:var(--panel2);color:var(--ink);border:2px solid var(--line);
    font-family:inherit;font-size:16px;font-weight:700;
    padding:10px 16px;border-radius:12px;
    transition:border-color .15s ease, transform .12s ease;
  }
  .deckbtn:hover{border-color:var(--accent)}
  .deckbtn:active{transform:translateY(2px)}
  .deckbtn.on{background:var(--accent);color:#1a1206;border-color:var(--accent)}
  .deckbtn .n{opacity:.7;font-weight:700;font-size:14px;margin-left:6px}
  .decklbl{color:var(--muted);font-size:15px;margin:0 0 10px}

  /* ---- the listen panel ----
     Deliberately not a .wordcard: there is no word to show here, and a big
     empty card where every other game puts the word reads as something
     failed to load. */
  /* The maze SVG stands 70px tall inside a 54px .track, and the games that
     use it park it above a .wordcard whose padding swallows the overflow.
     There's no card here, so the panel makes the room itself. */
  .listen{position:relative;text-align:center;margin:30px 0 20px}
  .speakbtn{
    background:var(--accent);color:#1a1206;font-family:inherit;font-weight:800;
    font-size:clamp(19px,3.4vw,24px);padding:18px 34px;border-radius:20px;
    box-shadow:0 14px 34px rgba(0,0,0,.4);
    transition:transform .12s, filter .12s;
  }
  .speakbtn:hover{filter:brightness(1.08)}
  .speakbtn:active{transform:translateY(2px)}
  .speakbtn.talking{animation:speakpulse 1s ease-in-out infinite}
  @keyframes speakpulse{
    0%,100%{transform:scale(1)}
    50%{transform:scale(1.05)}
  }

  /* ---- the answer tiles ----
     A fixed column count, not auto-fit: six choices have to come out as two
     rows of three, and auto-fit sizes columns off the container instead,
     which lands five on one row and orphans the sixth. --cols is set from
     the page's choices setting when the engine starts. */
  .tiles{display:grid;grid-template-columns:repeat(var(--cols,3),1fr);gap:12px}
  @media (max-width:620px){
    .tiles{grid-template-columns:repeat(2,1fr)}
  }
  .tile{
    position:relative;
    background:var(--panel);color:var(--ink);
    border:2px solid var(--line);border-radius:18px;
    font-family:inherit;font-weight:800;font-size:clamp(24px,4.4vw,36px);
    letter-spacing:.5px;padding:22px 14px;
    box-shadow:0 14px 34px rgba(0,0,0,.35);
    transition:border-color .15s ease, transform .12s ease, opacity .2s ease;
    word-break:break-word;
  }
  .tile:hover:not(:disabled){border-color:var(--accent);transform:translateY(-3px)}
  .tile:disabled{cursor:default}
  /* The number is the keyboard shortcut, not a rank — small and out of the
     way so it never competes with the word for attention. */
  .tile .k{
    position:absolute;top:7px;left:11px;
    font-size:13px;font-weight:700;color:var(--muted);letter-spacing:1px;
  }
  .tile.right{border-color:var(--good);background:rgba(61,220,151,.16);
    box-shadow:0 0 0 4px rgba(61,220,151,.18),0 14px 34px rgba(0,0,0,.35)}
  .tile.wrong{border-color:var(--bad);background:rgba(255,107,107,.14);animation:shake .4s}
  /* A wrong tile stays on screen but greys out, so the second try is a real
     narrowing of the field rather than a chance to click the same word again. */
  .tile.gone{opacity:.3}
  .tile.gone .k{opacity:.5}
  /* Gold, not green: after two misses this is the word to LOOK at, and green
     would read as "you got it". */
  .tile.reveal{border-color:var(--accent);background:rgba(255,201,77,.16);
    box-shadow:0 0 0 4px rgba(255,201,77,.2),0 14px 34px rgba(0,0,0,.35)}

  @media (prefers-reduced-motion: reduce){
    .tile.wrong,.speakbtn.talking{animation:none}
    .tile:hover:not(:disabled){transform:none}
  }
  `;
  // One template literal rather than a hundred lines of string concatenation —
  // this is markup, and it should still read like markup.
  function shell(cfg){
    return `
  <section id="s-start" class="screen on">
    <div class="card">
      <h1>${cfg.title}</h1>
      <p class="sub">${cfg.intro}</p>
      <div id="compatWarn" class="warn" style="display:none"></div>
      ${cfg.note ? `<div class="note"><div class="tag">Good to know</div>${cfg.note}</div>` : ""}
      <button class="btn ghost" id="btnDirections" type="button" style="margin-bottom:16px">🔊 Read directions aloud</button>
      <ol class="steps">
        <li>Put your <b>headphones</b> on. This game listens to nothing, so a loud room is fine.</li>
        <li>The computer <b>says a word</b>. <b>🔊 Hear it again</b> repeats it, slower the second time.</li>
        <li><b>Click the word you heard</b> — or press its number. The wrong ones look close on purpose, so read all the way to the end.</li>
        <li>Two tries each. Every 5 right in a row is bonus points.</li>
      </ol>
      ${cfg.hasPicker ? `
      <p class="decklbl" style="margin-top:22px">Pick a list:</p>
      <div class="decks" id="deckPicker"></div>` : ""}
      ${window.GameCore.readingViewButton()}
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start Game</button>
        <button class="btn ghost" id="btnShuffle">Shuffle: <span id="shufLbl">On</span></button>
        <button class="btn ghost" id="btnComeback" style="display:none">🔁 Comeback words (<span id="cbCount">0</span>)</button>
      </div>
    </div>
  </section>

  <section id="s-play" class="screen">
    <div class="hud">
      <div class="stat"><div class="lbl">Score</div><div class="val" id="uiScore">0</div></div>
      <div class="stat"><div class="lbl">Streak</div><div class="val flame" id="uiStreak">0</div><div class="combo" id="uiCombo"></div></div>
      <div class="stat"><div class="lbl">Word</div><div class="val" id="uiCount">1/1</div></div>
    </div>
    ${cfg.progress}

    <div class="listen">
      <div class="popup" id="popup"></div>
      <div class="hint">Which word did you hear?</div>
      <button class="speakbtn" id="btnHear" type="button">🔊 Hear it again</button>
      <div class="miclabel" id="uiMsg" aria-live="polite">Listen, then click the word.</div>
    </div>

    <div class="tiles" id="uiTiles"></div>
    <div class="keyhint" style="margin-top:16px">Press a word's <kbd>number</kbd> to pick it, or <kbd>H</kbd> to hear the word again.</div>

    <div class="toolbar">
      <button class="btn ghost" id="btnSkip" type="button">Skip ▸</button>
      <button class="btn ghost" id="btnQuit" type="button">End game</button>
    </div>
  </section>

  <section id="s-end" class="screen">
    <div class="card">
      <div class="stars" id="uiStars" aria-hidden="true"></div>
      <h2 id="uiTitle">Nice work! 🎉</h2>
      <p class="sub" id="uiSummary"></p>
      <div class="hud" style="margin-bottom:0">
        <div class="stat"><div class="lbl">Score</div><div class="val" id="uiFScore">0</div></div>
        <div class="stat"><div class="lbl">Correct</div><div class="val" id="uiFRight">0</div></div>
        <div class="stat"><div class="lbl">Best streak</div><div class="val flame" id="uiFStreak">0</div></div>
      </div>
      <div id="missBlock" style="display:none">
        <h3>Words to practice again</h3>
        <div class="grid" id="uiMissed"></div>
      </div>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnAgain">Play Again</button>
        <button class="btn ghost" id="btnRetryMissed">Practice missed words</button>
        <button class="btn ghost" id="btnPick">Pick another list</button>
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    /* Syllable-dotted entries ("fan·tas·tic") lose their dots on the way
       in and never get them back. Match It is a reading check: the tiles
       have to show the word the way a book would, and a dot down the
       middle of one tile would both give the split away and mark that
       tile out from its distractors. The plain word is also the form
       every stat key uses, so this keeps one list's stats in step across
       all four engines. */
    function plain(list){
      return (list || []).map(function(e){ return Core.parseEntry(e).word; });
    }
    var DECKS = ((cfg.decks && cfg.decks.length)
      ? cfg.decks.slice()
      : [{ name: cfg.deckName || "All words", words: cfg.words || [] }]
    ).map(function(d){ return { name: d.name, words: plain(d.words) }; });

    var ALL = dedupeWords(DECKS.reduce(function(acc, d){
      return acc.concat(d.words || []);
    }, []));

    var GROUPS = cfg.homophones || [];
    var SENTENCES = cfg.sentences || {};
    var TILES = (typeof cfg.choices === "number" && cfg.choices >= 2) ? Math.floor(cfg.choices) : CHOICES;

    var PICKS = DECKS.map(function(d){
      return { name: d.name, count: dedupeWords(d.words).length, build: (function(words){
        return function(){ return dedupeWords(words); };
      })(d.words) };
    });
    if(DECKS.length > 1){
      PICKS.push({ name: "🎲 Mixed", count: Math.min(MIX_SIZE, ALL.length),
                   build: function(){ return sampleWords(ALL, MIX_SIZE); } });
      PICKS.push({ name: "All words", count: ALL.length,
                   build: function(){ return ALL.slice(); } });
    }

    // A vault run: a ninja threading a laser corridor toward the diamonds.
    var prog = Core.progress("maze", { goal: "💎", runner: "🥷" });

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "The computer says a word — click the one that matches.",
      note: cfg.note || "",
      hasPicker: PICKS.length > 1,
      progress: prog.markup()
    });
    // The Reading view panel is markup the core supplied; the core wires it.
    Core.mountReadingView();

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], mastered = [], tries = 0, busy = false;
    var repeats = 0;       // how many times this word has been replayed
    var mazeLen = null;    // cached path length for the progress runner
    var pending = null;    // the timer that moves on to the next word
    var pendingList = null;   // a one-off list (comeback / missed words) to run instead of the deck
    var deckIdx = 0;
    // The pool distractors are drawn from. Normally the round's own list, so
    // the wrong answers are words the student is actually working on — but a
    // short round (a comeback deck of three words) can't fill six tiles from
    // itself, so it falls back to the whole word list.
    var pool = [];

    var $ = function(id){ return document.getElementById(id); };

    /* Outcome reporting — the same optional contract as the other three
       engines, so one scheduler (practice.js) can drive all four. Reported
       once per word, when it's finished with: found first try, found on
       the retry, missed twice, or skipped. */
    var onResult  = typeof cfg.onResult === "function" ? cfg.onResult : null;
    var onFinish  = typeof cfg.onFinish === "function" ? cfg.onFinish : null;
    var nextRound = typeof cfg.nextRound === "function" ? cfg.nextRound : null;
    function report(word, correct, tryCount){
      if(!onResult) return;
      try{ onResult(word, !!correct, tryCount|0); }catch(e){}
    }

    var shuffleOn = true;
    try{
      var savedShuffle = localStorage.getItem("matchShuffle");
      if(savedShuffle !== null) shuffleOn = savedShuffle === "1";
    }catch(e){}
    var deckKey = "matchDeck:" + location.pathname;
    try{
      var savedDeck = parseInt(localStorage.getItem(deckKey), 10);
      if(isFinite(savedDeck) && savedDeck >= 0 && savedDeck < PICKS.length) deckIdx = savedDeck;
    }catch(e){}

    /* ---------------- audio blips ---------------- */
    var snd = Core.sounds();

    /* ---------------- speech ----------------
       The voice itself is picked once for the whole site in game-core.js;
       what happens around an utterance is the engine's own business, which
       is why say() lives here. */
    // Each part is [text, rate]. Separate utterances rather than one long
    // string because the synthesiser's gap between them is the pause that
    // makes a word / sentence / word read parse as three things.
    function sayParts(parts){
      if(!window.speechSynthesis) return;
      try{
        // Cancel first: a student hammering "Hear it again" should hear the
        // newest read immediately, not a queue of stacked-up ones.
        window.speechSynthesis.cancel();
        var btn = $("btnHear");
        parts.forEach(function(p, i){
          var u = new SpeechSynthesisUtterance(p[0]);
          u.lang = "en-US";
          u.rate = p[1] || NORMAL_RATE;
          var v = Core.voice();
          if(v) u.voice = v;
          if(i === 0 && btn) u.onstart = function(){ btn.classList.add("talking"); };
          if(i === parts.length - 1 && btn){
            u.onend = u.onerror = function(){ btn.classList.remove("talking"); };
          }
          window.speechSynthesis.speak(u);
        });
      }catch(e){}
    }
    function say(text, rate){ sayParts([[text, rate]]); }

    // The word is never printed before it's answered — the tiles are the only
    // place it appears, which is the whole game. Words with a sentence get the
    // spelling-bee read (word, sentence, word); for a homophone that sentence
    // is not a nicety, it's the only thing that makes the item answerable.
    function speakWord(slow){
      var w = queue[idx];
      var rate = slow ? SLOW_RATE : NORMAL_RATE;
      var s = SENTENCES[w];
      // The sentence always stays at natural rate — slowing a whole sentence
      // drones, and it's carrying the meaning, not the sounds.
      if(s) sayParts([[w, rate], [s, NORMAL_RATE], [w, rate]]);
      else say(w, rate);
    }

    /* ---------------- screens ---------------- */
    function show(id){
      ["s-start","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
      if(id === "s-start") renderComeback();
    }
    function playing(){ return $("s-play").classList.contains("on"); }

    // Without speech there is no question being asked — unlike the flash
    // cards, this game genuinely cannot run silently, so Start is disabled.
    if(!window.speechSynthesis){
      var warn = $("compatWarn");
      warn.style.display = "block";
      warn.innerHTML = "<b>This browser can't talk.</b> Open this page in <b>Google Chrome</b> on the Chromebook — " +
                       "this game works by saying a word out loud for you to find.";
      $("btnStart").disabled = true;
    }

    /* ---------------- the persistent comeback deck ----------------
       Keyed by pathname so each game page keeps its own deck, and so a deck
       can never be read by a game with a different word list. */
    var comebackKey = "matchComeback:" + location.pathname;
    var comebackList = [];    // the deck the button will play, built at render time

    var comeback = Core.comebackStore(comebackKey);
    // Mastered words are cleared BEFORE the round's misses are merged in, so
    // a word got right and then missed again later in the same round ends up
    // correctly still in the deck.
    function persistComeback(){
      var store = comeback.read();
      mastered.forEach(function(w){ store = Core.comebackMastered(store, w); });
      comeback.write(Core.comebackMerge(store, missed, Date.now()));
    }

    /* ---------------- render ---------------- */
    function renderCombo(){
      var m = comboMultiplier(streak);
      $("uiCombo").textContent = m > 1 ? "×" + m + " combo!" : "";
    }

    function renderTiles(){
      var target = queue[idx];
      var wrong = distractorsFor(target, pool, TILES - 1, GROUPS);
      var options = shuffled([target].concat(wrong));
      var box = $("uiTiles");
      box.innerHTML = "";
      // Two rows of three for the default six; a smaller set gets two
      // columns rather than one long thin row.
      box.style.setProperty("--cols", String(Math.min(3, Math.ceil(TILES/2))));
      options.forEach(function(word, i){
        var b = document.createElement("button");
        b.type = "button";
        // "Mrs." must not lowercase itself under the Reading view's
        // lowercase switch — that would be a different word.
        b.className = "tile" + (Core.wordCaseClass(word) ? " has-cap" : "");
        b.dataset.word = word;
        var k = document.createElement("span");
        k.className = "k";
        k.textContent = String(i + 1);
        b.appendChild(k);
        // textContent, not innerHTML — these lists carry apostrophes and
        // periods (they'd, Mrs.) and nothing here needs markup.
        b.appendChild(document.createTextNode(word));
        b.addEventListener("click", function(){ choose(word, b); });
        box.appendChild(b);
      });
    }

    function render(){
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      prog.update(idx/queue.length*100);
      $("uiMsg").innerHTML = "Listen, then click the word.";
      tries = 0;
      repeats = 0;
      renderTiles();
      speakWord(false);
    }

    function tileFor(word){
      var found = null;
      $("uiTiles").querySelectorAll(".tile").forEach(function(el){
        if(el.dataset.word === word) found = el;
      });
      return found;
    }
    function lockTiles(){
      $("uiTiles").querySelectorAll(".tile").forEach(function(el){ el.disabled = true; });
    }

    /* ---------------- game flow ---------------- */
    function startGame(list){
      list = dedupeWords(plain(list));
      queue = shuffleOn ? shuffled(list) : list.slice();
      // A round has to be able to fill its own tiles. Below that, the wrong
      // answers come from the whole word list instead — still the most
      // confusable ones available, just drawn from a bigger bag.
      pool = queue.length >= TILES ? queue : ALL;
      idx = 0; score = 0; streak = 0; best = 0; right = 0;
      missed = []; mastered = []; tries = 0; busy = false;
      prog.reset();
      show("s-play");
      render();
    }

    function scheduleNext(ms){
      if(pending) clearTimeout(pending);
      pending = setTimeout(function(){ pending = null; busy = false; next(); }, ms);
    }

    function next(){
      tries = 0;
      idx++;
      if(idx >= queue.length){ finish(); return; }
      render();
    }

    function choose(word, tile){
      if(busy || !tile || tile.disabled) return;
      var target = queue[idx];
      if(word === target) handleCorrect(tile);
      else handleWrong(tile);
    }

    function handleCorrect(tile){
      busy = true;
      right++;
      streak++;
      report(queue[idx], tries === 0, tries);
      if(streak > best) best = streak;
      var pts = pointsFor(streak);
      var mult = comboMultiplier(streak);
      var milestone = streak % 5 === 0;
      score += pts;
      // Only a first-try pick clears the comeback deck — finding it after a
      // wrong guess is still the stumble the deck exists to catch.
      if(tries === 0 && mastered.indexOf(queue[idx]) === -1) mastered.push(queue[idx]);
      lockTiles();
      tile.classList.add("right");
      tile.classList.remove("gone");
      $("uiMsg").innerHTML = "<b>Correct!</b> +" + pts + " points" +
        (mult > 1 ? " <b>(×" + mult + " combo)</b>" : "");
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      if(milestone){
        prog.celebrate();
        Core.popup($("popup"), "🔥 " + streak + " in a row!", "#ffc94d", true);
        Core.confettiBurst($("s-play"), 18);
        snd.combo();
      } else {
        Core.popup($("popup"), "✓ +" + pts, "#3ddc97");
        snd.good();
      }
      scheduleNext(1000);
    }

    function handleWrong(tile){
      var target = queue[idx];
      streak = 0;
      $("uiStreak").textContent = 0;
      renderCombo();
      tries++;
      Core.popup($("popup"), "✗", "#ff6b6b");
      snd.bad();
      tile.classList.add("wrong");
      tile.disabled = true;

      if(tries < 2){
        // Nothing is revealed yet — the wrong tile greys out and the word
        // comes back slower, so the retry is listen-again plus one fewer
        // choice rather than a coin flip.
        $("uiMsg").innerHTML = "Not that one — listen again.";
        repeats = 2;                 // every replay from here on is the slow one
        setTimeout(function(){
          tile.classList.remove("wrong");
          tile.classList.add("gone");
        }, 420);
        // A beat of silence first, so the replay doesn't collide with the
        // wrong-answer beep the student is still hearing.
        setTimeout(function(){ speakWord(true); }, 500);
        return;
      }

      // Second miss: show which one it was and say it, slowly.
      busy = true;
      if(missed.indexOf(target) === -1) missed.push(target);
      report(target, false, tries);
      lockTiles();
      setTimeout(function(){ tile.classList.remove("wrong"); tile.classList.add("gone"); }, 420);
      var t = tileFor(target);
      if(t){ t.classList.add("reveal"); t.classList.remove("gone"); }
      $("uiMsg").innerHTML = "The word was <b>" + escapeHtml(target) + "</b> — the gold one.";
      setTimeout(function(){ say(target, SLOW_RATE); }, 500);
      scheduleNext(2800);
    }

    function finish(){
      if(pending){ clearTimeout(pending); pending = null; }
      busy = false;
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
      persistComeback();
      if(onFinish){ try{ onFinish({ right: right, total: queue.length }); }catch(e){} }
      show("s-end");
      $("uiFScore").textContent = score;
      $("uiFRight").textContent = right + "/" + queue.length;
      $("uiFStreak").textContent = best;
      var pct = queue.length ? Math.round(right/queue.length*100) : 0;
      var perfect = queue.length > 0 && right === queue.length;
      $("uiTitle").textContent = perfect ? "Perfect round! 🏆"
                               : pct >= 90 ? "Sharp eyes! 🏆"
                               : pct >= 70 ? "Nice work! 🎉"
                               : "Good practice! 💪";
      $("uiSummary").textContent = "You matched " + right + " of " + queue.length + " words (" + pct + "%).";

      Core.renderStars($("uiStars"), pct);
      var block = $("missBlock"), grid = $("uiMissed");
      grid.innerHTML = "";
      if(missed.length){
        block.style.display = "block";
        missed.forEach(function(word){
          var d = document.createElement("div");
          d.className = "chip";
          d.textContent = word;
          grid.appendChild(d);
        });
        $("btnRetryMissed").style.display = "";
      } else {
        block.style.display = "none";
        $("btnRetryMissed").style.display = "none";
      }
      $("btnPick").style.display = PICKS.length > 1 ? "" : "none";
      if(pct >= 70) Core.confettiBurst($("s-end").querySelector(".card"), pct >= 90 ? 26 : 16);
      snd.win();
      $("btnAgain").focus();
    }

    // Reads the intro line, the note box and every step on the start screen,
    // in order — pulled live from the DOM (textContent strips the <b>/<kbd>
    // markup for us) so this never drifts out of sync with the visible
    // directions.
    /* One utterance per fragment rather than one glued string. Reading
       the intro with .textContent used to swallow its <br>, welding two
       sentences into a run-on, and joining fragments that already end in
       full stops doubled the punctuation up. Core.directionParts does the
       walk for all four engines now, so a fix lands in one place. */
    function sayParts(parts){
      if(!window.speechSynthesis) return;
      parts = (parts || []).filter(function(p){ return p; });
      if(!parts.length) return;
      try{
        window.speechSynthesis.cancel();
        parts.forEach(function(text){
          var u = new SpeechSynthesisUtterance(text);
          u.lang = "en-US";
          u.rate = NORMAL_RATE;
          var v = Core.voice();
          if(v) u.voice = v;
          window.speechSynthesis.speak(u);
        });
      }catch(e){}
    }
    function readDirections(){
      sayParts(Core.directionParts($("s-start")));
    }

    /* ---------------- events ---------------- */
    // Greyed out rather than silently dead on a browser that can't speak.
    if(!window.speechSynthesis) $("btnDirections").disabled = true;
    else $("btnDirections").addEventListener("click", readDirections);

    function renderPicker(){
      var picker = $("deckPicker");
      if(!picker) return;
      picker.innerHTML = "";
      PICKS.forEach(function(choice, i){
        var b = document.createElement("button");
        b.type = "button";
        b.className = "deckbtn" + (i === deckIdx ? " on" : "");
        b.textContent = choice.name;
        var n = document.createElement("span");
        n.className = "n";
        n.textContent = choice.count;
        b.appendChild(n);
        b.addEventListener("click", function(){
          deckIdx = i;
          try{ localStorage.setItem(deckKey, String(i)); }catch(e){}
          renderPicker();
          snd.click();
        });
        picker.appendChild(b);
      });
    }
    renderPicker();

    function renderShuffle(){
      $("shufLbl").textContent = shuffleOn ? "On" : "Off";
    }
    $("btnShuffle").addEventListener("click", function(){
      shuffleOn = !shuffleOn;
      try{ localStorage.setItem("matchShuffle", shuffleOn ? "1" : "0"); }catch(e){}
      renderShuffle();
    });
    renderShuffle();

    // The deck is rebuilt at Start rather than at pick time, so the Mixed
    // deck is a fresh draw every round.
    function currentDeck(){
      var choice = PICKS[deckIdx] || PICKS[0];
      return choice ? choice.build() : [];
    }
    function playPending(){
      var list = pendingList;
      pendingList = null;
      startGame(list && list.length ? list : currentDeck());
    }

    $("btnStart").addEventListener("click", function(){
      snd.click();
      var list = currentDeck();
      if(list.length) startGame(list);
    });

    function renderComeback(){
      comebackList = Core.comebackDeck(comeback.read(), Core.comebackCap);
      $("btnComeback").style.display = comebackList.length ? "" : "none";
      $("cbCount").textContent = comebackList.length;
    }
    $("btnComeback").addEventListener("click", function(){
      if(!comebackList.length) return;
      pendingList = comebackList.slice();
      playPending();
    });
    renderComeback();

    $("btnHear").addEventListener("click", function(){
      if(busy) return;
      repeats++;
      speakWord(repeats >= 2);   // second read onward is the slow one
    });
    // A skipped word counts as missed: the student didn't know it, whatever
    // the reason, so it belongs in the comeback deck.
    $("btnSkip").addEventListener("click", function(){
      if(busy) return;
      var t = queue[idx];
      if(missed.indexOf(t) === -1) missed.push(t);
      report(t, false, tries);
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      // Only the words actually seen count toward the round's total, so
      // ending early doesn't score as a pile of misses.
      queue = queue.slice(0, idx);
      finish();
    });
    // With a scheduler attached, "Play again" asks it for a fresh set;
    // a queued comeback/missed list still takes precedence via playPending.
    $("btnAgain").addEventListener("click", function(){
      var list = null;
      if(nextRound && !pendingList){ try{ list = nextRound(); }catch(e){ list = null; } }
      if(list && list.length) startGame(list); else playPending();
    });
    $("btnRetryMissed").addEventListener("click", function(){
      var list = missed.slice();
      if(list.length) startGame(list);
    });
    $("btnPick").addEventListener("click", function(){ show("s-start"); $("btnStart").focus(); });

    document.addEventListener("keydown", function(e){
      if(!playing()) return;
      // A focused button handles Enter and Space natively — stepping in
      // there would fire the same action twice.
      if(e.target && e.target.tagName === "BUTTON") return;
      if(e.key === "h" || e.key === "H"){
        e.preventDefault();
        if(busy) return;
        repeats++;
        speakWord(repeats >= 2);
        return;
      }
      if(!/^[1-9]$/.test(e.key)) return;
      var tiles = $("uiTiles").querySelectorAll(".tile");
      var el = tiles[parseInt(e.key, 10) - 1];
      if(!el) return;
      e.preventDefault();
      choose(el.dataset.word, el);
    });

    window.addEventListener("beforeunload", function(){
      // speechSynthesis is window-global — a word mid-utterance would
      // otherwise keep talking over the next page for a beat.
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    });

    $("btnStart").focus();
  }

  // _internals exposes the pure, state-free helpers for tests.html.
  // Not part of the public game API — don't build games against it.
  return {
    start: start,
    _internals: {
      normalizeWord: normalizeWord,
      dedupeWords: dedupeWords,
      editDistance: editDistance,
      sharedPrefix: sharedPrefix,
      nearestWords: nearestWords,
      soundAlikes: soundAlikes,
      distractorsFor: distractorsFor,
      sampleWords: sampleWords,
      comboMultiplier: comboMultiplier,
      pointsFor: pointsFor,
      sanitizeComeback: Core.sanitizeComeback,
      comebackMerge: Core.comebackMerge,
      comebackMastered: Core.comebackMastered,
      comebackDeck: Core.comebackDeck,
      comebackCap: Core.comebackCap,
      choices: CHOICES
    }
  };
})();
