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

  function dedupeWords(list){
    var out = [], seen = {};
    if(!list) return out;
    for(var i=0;i<list.length;i++){
      var w = list[i];
      if(typeof w !== "string" || !w) continue;
      if(Object.prototype.hasOwnProperty.call(seen, w)) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
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

  // Random sample without replacement. `rnd` is a parameter rather than a
  // direct Math.random() call so tests can feed it a predictable sequence.
  function sampleWords(list, n, rnd){
    var pool = dedupeWords(list);
    var random = typeof rnd === "function" ? rnd : Math.random;
    if(typeof n !== "number" || !isFinite(n) || n < 0) n = 0;
    n = Math.min(Math.floor(n), pool.length);
    // Partial Fisher-Yates: shuffle only the n slots actually being taken.
    for(var i=0;i<n;i++){
      var j = i + Math.floor(random() * (pool.length - i));
      if(j >= pool.length) j = pool.length - 1;   // guards rnd() returning 1
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n);
  }

  /* ---------------- scoring (pure, testable) ----------------
     Copied verbatim from blend-game.js, the same way spell-game.js and
     card-game.js carry their own copies, so every engine stays one file: 10
     points × a streak-driven multiplier (×1, ×2 from a streak of 5, ×3 from
     10 up), plus a +25 milestone on every 5th in a row. `streak` INCLUDES
     the answer being scored, so streak 5 pays 10×2+25 = 45. If this ever
     changes, change it everywhere — tests.html checks them against each
     other. */
  function comboMultiplier(streak){
    return Math.min(3, 1 + Math.floor(streak/5));
  }
  function pointsFor(streak){
    return 10 * comboMultiplier(streak) + (streak > 0 && streak % 5 === 0 ? 25 : 0);
  }

  /* ---------------- comeback deck (pure, testable) ----------------
     Same deck, same store shape and same pedagogy as blend-game.js and
     card-game.js: a word joins when it's missed or skipped in a round and
     leaves the moment it's picked right on the FIRST try in a later one.

     Store shape:  { v:1, words: { said: {n:3, t:1717000000000}, … } }

     Third copy of this logic, carried for the same single-file reason as the
     scoring — keep the copies in step; tests.html runs the same lifecycle
     against all of them and checks they agree. */
  var COMEBACK_VERSION = 1;
  var COMEBACK_CAP = 15;    // a warm-up, not a second full round

  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }

  function sanitizeComeback(raw){
    var out = { v: COMEBACK_VERSION, words: {} };
    if(!raw || typeof raw !== "object" || !raw.words || typeof raw.words !== "object") return out;
    for(var w in raw.words){
      if(!has(raw.words, w) || !w) continue;
      var e = raw.words[w];
      if(!e || typeof e !== "object") continue;
      var n = Math.floor(Number(e.n)), t = Number(e.t);
      if(!isFinite(n) || n < 1) continue;
      out.words[w] = { n: n, t: (isFinite(t) && t > 0) ? t : 0 };
    }
    return out;
  }

  function comebackMerge(store, words, at){
    var out = sanitizeComeback(store), seen = {};
    if(!words) return out;
    for(var i=0;i<words.length;i++){
      var w = words[i];
      if(typeof w !== "string" || !w || has(seen, w)) continue;
      seen[w] = 1;
      out.words[w] = { n: (has(out.words, w) ? out.words[w].n : 0) + 1, t: at };
    }
    return out;
  }

  function comebackMastered(store, word){
    var out = sanitizeComeback(store);
    if(typeof word === "string" && has(out.words, word)) delete out.words[word];
    return out;
  }

  function comebackDeck(store, cap){
    var s = sanitizeComeback(store), list = [], w;
    for(w in s.words){ if(has(s.words, w)) list.push(w); }
    list.sort(function(a, b){
      if(s.words[b].n !== s.words[a].n) return s.words[b].n - s.words[a].n;
      if(s.words[b].t !== s.words[a].t) return s.words[b].t - s.words[a].t;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    if(typeof cap !== "number" || !isFinite(cap) || cap < 0) cap = COMEBACK_CAP;
    return list.slice(0, cap);
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
  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  /* The vault-run progress graphic, lifted from blend-game.js's "maze" theme —
     same markup, same CSS in blend-game.css, same idx/queue.length percentage
     driving it. Duplicated for the same no-build reason as the scoring. */
  var MAZE_PATH = "M20,85 L150,85 L150,15 L300,15 L300,85 L450,85 L450,15 L580,15";
  function progressMarkup(){
    return `
    <div class="track track-maze">
      <svg viewBox="0 0 600 100" preserveAspectRatio="xMidYMid meet" class="maze-svg" aria-hidden="true">
        <path class="maze-wall" d="${MAZE_PATH}"></path>
        <path class="maze-path" d="${MAZE_PATH}"></path>
        <path id="mazeTrail" class="maze-trail" d="${MAZE_PATH}"></path>
        <text class="maze-goal" x="580" y="15">💎</text>
        <text id="mazeRunner" class="maze-runner" x="20" y="85">🥷</text>
      </svg>
    </div>`;
  }

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
    ${progressMarkup()}

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
    var DECKS = (cfg.decks && cfg.decks.length)
      ? cfg.decks.slice()
      : [{ name: cfg.deckName || "All words", words: cfg.words || [] }];

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

    injectStyle();
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "The computer says a word — click the one that matches.",
      note: cfg.note || "",
      hasPicker: PICKS.length > 1
    });

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
    var actx = null;
    function beep(freqs, dur){
      try{
        if(!actx){ var C = window.AudioContext || window.webkitAudioContext; if(!C) return; actx = new C(); }
        if(actx.state === "suspended") actx.resume();
        freqs.forEach(function(f,i){
          var o = actx.createOscillator(), g = actx.createGain();
          o.type = "triangle"; o.frequency.value = f;
          var t = actx.currentTime + i * (dur*0.7);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g); g.connect(actx.destination);
          o.start(t); o.stop(t + dur + 0.02);
        });
      }catch(e){}
    }
    var sndGood  = function(){ beep([660,880,1180],0.16); };
    var sndBad   = function(){ beep([300,200],0.20); };
    var sndWin   = function(){ beep([660,880,1180,1560],0.18); };
    var sndCombo = function(){ beep([660,990,1320,1760],0.14); };

    /* ---------------- speech ----------------
       pickVoice() and say() are lifted from blend-game.js almost verbatim,
       for the same single-file reason as the scoring functions. Keep the
       voice ranking in sync if it ever changes there. */
    var voice = null;

    // macOS/iOS ship joke voices (Albert croaks, Zarvox is a robot, Bahh is a
    // sheep) in the same en-US list as the real ones. Never pick these, even
    // as a last resort — a word-only fallback beats an unintelligible voice.
    var NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred/;

    function pickVoice(){
      if(!window.speechSynthesis) return;
      var all = window.speechSynthesis.getVoices() || [];
      var en = all.filter(function(v){
        return /^en/i.test(v.lang) && !NOVELTY.test(v.name);
      });
      if(!en.length) return;   // list not loaded yet; voiceschanged will retry
      function find(test){
        for(var i=0;i<en.length;i++){ if(test(en[i])) return en[i]; }
        return null;
      }
      voice =
        find(function(v){ return v.lang === "en-US" && /Google/.test(v.name); }) ||
        find(function(v){ return /Natural|Online/.test(v.name); }) ||
        find(function(v){ return /Samantha|Ava|Allison|Alex/.test(v.name); }) ||
        find(function(v){ return v.lang === "en-US" && v.localService; }) ||
        find(function(v){ return v.lang === "en-US"; }) ||
        en[0];
    }
    pickVoice();
    if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pickVoice;

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
          if(voice) u.voice = voice;
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

    /* ---------------- helpers ---------------- */
    function shuffled(a){
      var b = a.slice();
      for(var i=b.length-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)); var t=b[i]; b[i]=b[j]; b[j]=t; }
      return b;
    }

    /* ---------------- the persistent comeback deck ----------------
       Keyed by pathname so each game page keeps its own deck, and so a deck
       can never be read by a game with a different word list. */
    var comebackKey = "matchComeback:" + location.pathname;
    var comebackList = [];    // the deck the button will play, built at render time

    function readComeback(){
      try{ return sanitizeComeback(JSON.parse(localStorage.getItem(comebackKey))); }
      catch(e){ return sanitizeComeback(null); }
    }
    function writeComeback(store){
      try{ localStorage.setItem(comebackKey, JSON.stringify(store)); }catch(e){}
    }
    // Mastered words are cleared BEFORE the round's misses are merged in, so
    // a word got right and then missed again later in the same round ends up
    // correctly still in the deck.
    function persistComeback(){
      var store = readComeback();
      mastered.forEach(function(w){ store = comebackMastered(store, w); });
      writeComeback(comebackMerge(store, missed, Date.now()));
    }

    /* ---------------- render ---------------- */
    function updateProgress(pct){
      // mazeTrail shares the maze-path's "d", so its length doubles as the
      // guide path's length — one <path> query covers both.
      var path = $("mazeTrail"), runner = $("mazeRunner");
      if(!path || !runner) return;
      if(mazeLen === null){ mazeLen = path.getTotalLength(); path.style.strokeDasharray = mazeLen; }
      var covered = pct/100 * mazeLen;
      var pt = path.getPointAtLength(covered);
      runner.setAttribute("x", pt.x);
      runner.setAttribute("y", pt.y);
      path.style.strokeDashoffset = mazeLen - covered;
    }
    function celebrateProgress(){
      var el = $("mazeRunner");
      if(!el) return;
      el.classList.remove("boost");
      void el.getBoundingClientRect();   // restart the animation
      el.classList.add("boost");
      setTimeout(function(){ el.classList.remove("boost"); }, 550);
    }
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
        b.className = "tile";
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
      updateProgress(idx/queue.length*100);
      $("uiMsg").innerHTML = "Listen, then click the word.";
      tries = 0;
      repeats = 0;
      renderTiles();
      speakWord(false);
    }

    function popup(txt, color, big){
      var p = $("popup");
      p.textContent = txt; p.style.color = color;
      p.classList.toggle("big", !!big);
      p.classList.remove("go"); void p.offsetWidth; p.classList.add("go");
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
      queue = shuffleOn ? shuffled(list) : list.slice();
      // A round has to be able to fill its own tiles. Below that, the wrong
      // answers come from the whole word list instead — still the most
      // confusable ones available, just drawn from a bigger bag.
      pool = queue.length >= TILES ? queue : ALL;
      idx = 0; score = 0; streak = 0; best = 0; right = 0;
      missed = []; mastered = []; tries = 0; busy = false;
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
        celebrateProgress();
        popup("🔥 " + streak + " in a row!", "#ffc94d", true);
        confettiBurst($("s-play"), 18);
        sndCombo();
      } else {
        popup("✓ +" + pts, "#3ddc97");
        sndGood();
      }
      scheduleNext(1000);
    }

    function handleWrong(tile){
      var target = queue[idx];
      streak = 0;
      $("uiStreak").textContent = 0;
      renderCombo();
      tries++;
      popup("✗", "#ff6b6b");
      sndBad();
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
      lockTiles();
      setTimeout(function(){ tile.classList.remove("wrong"); tile.classList.add("gone"); }, 420);
      var t = tileFor(target);
      if(t){ t.classList.add("reveal"); t.classList.remove("gone"); }
      $("uiMsg").innerHTML = "The word was <b>" + escapeHtml(target) + "</b> — the gold one.";
      setTimeout(function(){ say(target, SLOW_RATE); }, 500);
      scheduleNext(2800);
    }

    function escapeHtml(s){
      return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function finish(){
      if(pending){ clearTimeout(pending); pending = null; }
      busy = false;
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
      persistComeback();
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

      // 0–3 stars: 3 at 90%+, 2 at 70%+, 1 at 50%+ — same thresholds as the
      // other games. Unearned slots still render as dim outlines so a 2-star
      // finish visibly has room to grow.
      var starCount = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
      var stars = $("uiStars");
      stars.innerHTML = "";
      for(var si=0; si<3; si++){
        var st = document.createElement("span");
        st.className = "star" + (si < starCount ? " lit" : "");
        st.style.animationDelay = (0.25 + si*0.3) + "s";
        st.textContent = "★";
        stars.appendChild(st);
      }
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
      if(pct >= 70) confettiBurst($("s-end").querySelector(".card"), pct >= 90 ? 26 : 16);
      sndWin();
      $("btnAgain").focus();
    }

    var CONFETTI_COLORS = ["#ffc94d","#3ddc97","#ff6b6b","#7dd3fc","#c084fc"];
    function confettiBurst(container, count){
      if(!container) return;
      for(var i=0;i<count;i++){
        var s = document.createElement("span");
        s.className = "confetti-piece";
        s.style.left = Math.random()*100 + "%";
        s.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        s.style.animationDelay = (Math.random()*0.3) + "s";
        s.style.setProperty("--r", Math.floor(Math.random()*360) + "deg");
        container.appendChild(s);
        (function(el){ setTimeout(function(){ el.remove(); }, 1700); })(s);
      }
    }

    // Reads the intro line, the note box and every step on the start screen,
    // in order — pulled live from the DOM (textContent strips the <b>/<kbd>
    // markup for us) so this never drifts out of sync with the visible
    // directions.
    function spokenText(el){
      return el.textContent.replace(/\s+/g, " ").replace(/→/g, "leads to").trim();
    }
    function readDirections(){
      if(!window.speechSynthesis) return;
      var startScreen = $("s-start");
      var parts = [];
      var intro = startScreen.querySelector(".sub");
      if(intro) parts.push(spokenText(intro));
      var note = startScreen.querySelector(".note");
      if(note){
        note.querySelectorAll(":scope > *:not(.tag)").forEach(function(el){
          parts.push(spokenText(el));
        });
      }
      startScreen.querySelectorAll(".steps li").forEach(function(li){
        parts.push(spokenText(li));
      });
      say(parts.join(". "), NORMAL_RATE);
    }

    /* ---------------- events ---------------- */
    $("btnDirections").addEventListener("click", readDirections);

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
          beep([440],0.06);
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
      beep([440],0.06);
      var list = currentDeck();
      if(list.length) startGame(list);
    });

    function renderComeback(){
      comebackList = comebackDeck(readComeback(), COMEBACK_CAP);
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
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      // Only the words actually seen count toward the round's total, so
      // ending early doesn't score as a pile of misses.
      queue = queue.slice(0, idx);
      finish();
    });
    $("btnAgain").addEventListener("click", function(){ playPending(); });
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
      sanitizeComeback: sanitizeComeback,
      comebackMerge: comebackMerge,
      comebackMastered: comebackMastered,
      comebackDeck: comebackDeck,
      comebackCap: COMEBACK_CAP,
      choices: CHOICES
    }
  };
})();
