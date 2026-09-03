/* Shared engine for the flash-card games — read the card, flip it, check
 * yourself.
 *
 * The other two engines both judge the answer for the student: blend-game.js
 * listens, spell-game.js compares letters. This one deliberately doesn't,
 * because the skill it drills can't be typed or reliably heard — INSTANT
 * RECOGNITION of irregular ("red") words. A red word is one the sounding-out
 * rules lie about (said, would, Wednesday); the only question worth asking is
 * whether the student knew it on sight, and the student is the only one who
 * can answer that. So:
 *
 *   1. The word shows. The student reads it out loud from the card.
 *   2. They flip it. Only now does the computer say the word — hearing it
 *      first would hand over the answer and turn the drill into a repeat-
 *      after-me exercise.
 *   3. They tell the game whether they got it. That self-rating is the
 *      score, and it's what feeds the comeback deck.
 *
 * No mic and no typing, so it works in a loud room and on a Chromebook with a
 * dead microphone — and words carrying punctuation (Mrs., they'd) need no
 * special handling, since nothing is ever matched against what a student
 * typed or said.
 *
 *   CardGame.start({
 *     title: "Red Words 🃏",
 *     intro: "…",                       // HTML ok
 *     note:  "<p>What a red word is…</p>",       // optional micro-lesson
 *     decks: [{ name:"List 1", words:["you","should", …] }, …]
 *   });
 *
 * With more than one deck the start screen grows a picker, and the engine
 * adds two decks of its own on the end: a random "Mixed 20" drawn from
 * everything (re-drawn every round) and one "All words" deck. Screens,
 * scoring and the end-of-round summary match the other two engines exactly,
 * so a student moving between games sees one scoring system.
 */
window.CardGame = (function(){
  "use strict";

  var NORMAL_RATE = 0.95, SLOW_RATE = 0.75;
  var MIX_SIZE = 20;        // cards in the engine's "Mixed" deck

  /* ---------------- decks (pure, testable) ----------------
     Word lists come in as printed on paper, which means a word can appear on
     two different lists (the red-word screener repeats "you", "sure" and
     "enough" on purpose). Across separate rounds that's fine and intended;
     inside ONE round the same card coming round twice just reads as a bug,
     so every deck the engine hands to a round is deduplicated first. First
     occurrence wins, so a deck keeps its printed order. */
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

  // Random sample without replacement, for the Mixed deck. `rnd` is a
  // parameter rather than a direct Math.random() call so tests can feed it a
  // predictable sequence; games never pass it.
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
     Copied verbatim from blend-game.js, the same way spell-game.js carries
     its own copy, so all three engines stay one file each: 10 points × a
     streak-driven multiplier (×1, ×2 from a streak of 5, ×3 from 10 up),
     plus a +25 milestone on every 5th in a row. `streak` INCLUDES the card
     being scored, so streak 5 pays 10×2+25 = 45. If this ever changes,
     change it in all three files — tests.html checks them against each
     other. */
  function comboMultiplier(streak){
    return Math.min(3, 1 + Math.floor(streak/5));
  }
  function pointsFor(streak){
    return 10 * comboMultiplier(streak) + (streak > 0 && streak % 5 === 0 ? 25 : 0);
  }

  /* ---------------- comeback deck (pure, testable) ----------------
     Same deck, same store shape and same pedagogy as blend-game.js: a word
     joins when it's missed or skipped in a round and leaves the moment it's
     recognised on sight in a later one, so the deck only ever holds what
     isn't mastered yet. It matters more here than anywhere else on the site
     — 200 sight words is far too many to re-read every session, and the
     deck is what turns them into a short, personal list.

     Store shape:  { v:1, words: { said: {n:3, t:1717000000000}, … } }
       n — how many rounds the word has been missed in (drives priority)
       t — when it was last missed (breaks ties toward fresher trouble)

     Carried here rather than shared with blend-game.js for the single-file
     reason above; this is the bigger of the two duplications, so keep the
     two copies in step — tests.html runs the same lifecycle against both. */
  var COMEBACK_VERSION = 1;
  var COMEBACK_CAP = 15;    // a warm-up, not a second full round

  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }

  // localStorage is shared, hand-editable and outlives any change to this
  // file, so whatever comes back out is treated as untrusted input: anything
  // that isn't an entry with a real positive miss count is dropped.
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

  // Fold one round's missed words into the store. `at` is passed in rather
  // than read from Date.now() in here so the tie-breaking is testable.
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

  // Most-missed first, so a capped deck keeps the words that keep going
  // wrong. Ties go to the most recently missed word, then alphabetically —
  // arbitrary, but it makes the deck stable rather than key-order dependent.
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
     Everything beyond blend-game.css: the card itself, the deck picker and
     the note panel. They ship inside the engine (like spell-game.js's) so a
     game page stays two stylesheets and one script, and so the engine can
     never be loaded without them. */
  var STYLE_ID = "card-game-style";
  var STYLE = `
  /* the optional micro-lesson panel on the start screen */
  .note{background:var(--panel2);border:1px solid var(--line);border-left:5px solid var(--accent);
    border-radius:16px;padding:16px 20px;margin:0 0 22px;font-size:17px;line-height:1.65}
  .note .tag{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--accent);font-weight:800;margin-bottom:8px}
  .note b{color:var(--accent)}
  .note p{margin:0}
  .note p + p{margin-top:8px}

  /* ---- deck picker ----
     Ten lists of twenty is the shape of the paper screener, and it's also
     the right shape for a round: a student picks the list they're working
     on rather than being handed 200 cards. */
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

  /* ---- the card ----
     A real flip, because the flip IS the moment of self-checking: the
     student commits to an answer, then turns the card over to see whether
     they were right. Two stacked faces on a rotating parent — the front
     turns away as the back turns in. */
  .flip{perspective:1200px;margin-bottom:4px}
  .flipinner{
    position:relative;transform-style:preserve-3d;
    transition:transform .5s cubic-bezier(.4,.2,.2,1);
  }
  .flip.flipped .flipinner{transform:rotateY(180deg)}
  .flipface{
    background:var(--panel);border:1px solid var(--line);border-radius:24px;
    box-shadow:0 24px 60px rgba(0,0,0,.45);
    padding:34px 26px;text-align:center;
    backface-visibility:hidden;-webkit-backface-visibility:hidden;
  }
  /* The back is laid on top of the front and pre-rotated, so both faces
     occupy the same box and the card's height is the taller of the two —
     no jump when it turns. */
  .flipface.back{position:absolute;inset:0;transform:rotateY(180deg);
    display:flex;flex-direction:column;justify-content:center;
    border-color:var(--accent);box-shadow:0 0 0 4px rgba(255,201,77,.16),0 24px 60px rgba(0,0,0,.45)}
  .flip.rated-yes .flipface.back{border-color:var(--good);box-shadow:0 0 0 4px rgba(61,220,151,.18),0 24px 60px rgba(0,0,0,.45)}
  .flip.rated-no .flipface.back{border-color:var(--bad);box-shadow:0 0 0 4px rgba(255,107,107,.16),0 24px 60px rgba(0,0,0,.45)}

  /* The word is the whole interface — as big as the card allows, and the
     same size on both faces so nothing shifts through the turn. */
  .flipface .word{font-size:clamp(40px,11vw,92px);font-weight:800;letter-spacing:1px;
    line-height:1.15;margin:6px 0;word-break:break-word}
  .flipface .facehint{color:var(--muted);font-size:16px;line-height:1.5;margin-top:14px;min-height:24px}
  .flipface .facehint b{color:var(--ink)}
  /* The card sits on a stage so the score pop-up and the milestone
     confetti have a plain positioned ancestor to hang off. They can't live
     inside .flip itself: that's a 3D perspective container whose children
     get placed in the card's rotating space, and they can't live inside a
     face either, since a face is hidden for half of every turn. Nothing
     clips the stage, so confetti falls on past the card — hence
     pointer-events, or a piece mid-fall would swallow a click on the
     rating buttons underneath it. */
  .cardstage{position:relative}
  /* Both sit ON the card, and the card is opaque and later in the DOM, so
     they need a layer of their own to paint into — .flip makes a stacking
     context of its own the moment it gets a perspective. */
  .cardstage > .popup,
  .cardstage > .confetti-piece{z-index:5}
  /* Higher than the blend games' 80px: their word sits low on a taller card,
     this one is centred, and the word is the one thing on the card that must
     never be obscured. From here the pop-up rises up out of the card. */
  .cardstage > .popup{top:26px}
  .cardstage > .confetti-piece{pointer-events:none}

  .rate{display:flex;justify-content:center;gap:12px;margin-top:22px;flex-wrap:wrap}
  .btn.yes{background:var(--good);color:#08231a}
  .btn.no{background:var(--bad);color:#2a0a0a}
  .rate .key{opacity:.7;font-weight:700;font-size:14px;margin-left:8px}

  @media (prefers-reduced-motion: reduce){
    .flipinner{transition:none}
  }
  `;
  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  /* The race progress graphic, lifted from blend-game.js's "race" theme —
     same markup, same CSS in blend-game.css, same idx/queue.length
     percentage driving it. Duplicated for the same no-build reason as the
     scoring functions. */
  function progressMarkup(){
    return `
    <div class="track track-race">
      <div class="track-road"><i class="track-fill" id="uiTrackFill"></i></div>
      <div class="track-goal">🏁</div>
      <div class="track-runner" id="uiRunner">
        <span class="runner-icon">
          <svg viewBox="0 0 64 34" class="car-svg" aria-hidden="true">
            <ellipse class="car-shadow" cx="34" cy="30" rx="26" ry="3"></ellipse>
            <rect class="speedline" x="-4" y="10" width="9" height="2.5" rx="1.2"></rect>
            <rect class="speedline" x="-8" y="17" width="11" height="2.5" rx="1.2" style="animation-delay:.2s"></rect>
            <rect class="speedline" x="-4" y="24" width="7" height="2.5" rx="1.2" style="animation-delay:.4s"></rect>
            <path class="car-body" d="M6,26 L6,18 Q6,14 10,14 L18,14 L24,5 L38,5 L46,13 L54,13 Q60,13 60,19 L60,26 Z"></path>
            <rect class="car-spoiler" x="3" y="10" width="10" height="3" rx="1"></rect>
            <polygon class="car-glass" points="23,13 27,7 37,7 42,13"></polygon>
            <rect class="car-stripe" x="30" y="5" width="5" height="21"></rect>
            <g class="wheel">
              <circle cx="18" cy="27" r="6"></circle>
              <rect x="17" y="21" width="2" height="4"></rect>
            </g>
            <g class="wheel">
              <circle cx="48" cy="27" r="6"></circle>
              <rect x="47" y="21" width="2" height="4"></rect>
            </g>
          </svg>
        </span>
      </div>
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
        <li>A word shows on the card. <b>Read it out loud.</b></li>
        <li><b>Flip</b> the card — press <kbd>Space</kbd> or click it. Now you hear the word.</li>
        <li>Tell the game the truth: <b>Got it</b> if you read it right, <b>Not yet</b> if you didn't.</li>
        <li>Every 5 you get in a row is bonus points. Words you miss come back next time.</li>
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
      <div class="stat"><div class="lbl">Card</div><div class="val" id="uiCount">1/1</div></div>
    </div>
    ${progressMarkup()}

    <div class="cardstage" id="cardStage">
      <div class="popup" id="popup"></div>
      <div class="flip" id="flipCard">
        <div class="flipinner" id="flipInner">
          <div class="flipface front">
            <div class="hint">Read it out loud</div>
            <div class="word" id="uiWord"></div>
            <div class="facehint">Then flip the card to check yourself.</div>
          </div>
          <div class="flipface back" id="flipBack" aria-hidden="true">
            <div class="hint">The word is</div>
            <div class="word" id="uiWordBack"></div>
            <div class="facehint" id="uiBackHint">Did you read it right?</div>
          </div>
        </div>
      </div>
    </div>

    <div class="rate" id="rateRow">
      <button class="btn" id="btnFlip" type="button">🔄 Flip the card</button>
      <button class="btn yes" id="btnGot" type="button" style="display:none">✓ Got it<span class="key">1</span></button>
      <button class="btn no" id="btnMiss" type="button" style="display:none">✗ Not yet<span class="key">2</span></button>
    </div>
    <div class="keyhint" style="margin-top:14px" id="uiKeyhint">Press <kbd>Space</kbd> to flip the card.</div>

    <div class="toolbar">
      <button class="btn ghost" id="btnHear" type="button" style="display:none">🔊 Hear it again</button>
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
        <div class="stat"><div class="lbl">Got it</div><div class="val" id="uiFRight">0</div></div>
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
    // A game page may pass a single `words` list instead of decks; the picker
    // then never appears and the round is simply that list.
    var DECKS = (cfg.decks && cfg.decks.length)
      ? cfg.decks.slice()
      : [{ name: cfg.deckName || "All words", words: cfg.words || [] }];

    // Everything on every list, in printed order, for the two decks the
    // engine adds itself. Deduplicated once here rather than per round.
    var ALL = dedupeWords(DECKS.reduce(function(acc, d){
      return acc.concat(d.words || []);
    }, []));

    // The engine's own decks only earn their place when there's more than one
    // list to mix. `build` is a function so the Mixed deck is re-drawn on
    // every round rather than being one frozen sample.
    var CHOICES = DECKS.map(function(d){
      return { name: d.name, count: dedupeWords(d.words).length, build: (function(words){
        return function(){ return dedupeWords(words); };
      })(d.words) };
    });
    if(DECKS.length > 1){
      CHOICES.push({ name: "🎲 Mixed", count: Math.min(MIX_SIZE, ALL.length), mixed: true,
                     build: function(){ return sampleWords(ALL, MIX_SIZE); } });
      CHOICES.push({ name: "All words", count: ALL.length,
                     build: function(){ return ALL.slice(); } });
    }

    injectStyle();
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read the word out loud, then flip the card to check yourself.",
      note: cfg.note || "",
      hasPicker: CHOICES.length > 1
    });

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], mastered = [], flipped = false, busy = false;
    var lastPct = null;    // last progress % drawn, so the race can drop a dust puff behind it
    var pending = null;    // the timer that moves on to the next card
    var pendingList = null;   // a one-off list (comeback / missed words) to run instead of the deck
    var deckIdx = 0;

    var $ = function(id){ return document.getElementById(id); };

    var shuffleOn = true;
    try{
      var savedShuffle = localStorage.getItem("cardShuffle");
      if(savedShuffle !== null) shuffleOn = savedShuffle === "1";
    }catch(e){}
    // Which list the student was working on last time. Stored per page so two
    // flash-card games don't fight over one setting.
    var deckKey = "cardDeck:" + location.pathname;
    try{
      var savedDeck = parseInt(localStorage.getItem(deckKey), 10);
      if(isFinite(savedDeck) && savedDeck >= 0 && savedDeck < CHOICES.length) deckIdx = savedDeck;
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
    var sndFlip  = function(){ beep([520,720],0.09); };

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

    function say(text, rate){
      if(!window.speechSynthesis) return;
      try{
        // Cancel first: a student hammering "Hear it again" should hear the
        // newest read immediately, not a queue of stacked-up ones.
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = rate || NORMAL_RATE;
        if(voice) u.voice = voice;
        window.speechSynthesis.speak(u);
      }catch(e){}
    }

    /* ---------------- screens ---------------- */
    function show(id){
      ["s-start","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
      if(id === "s-start") renderComeback();
    }
    function playing(){ return $("s-play").classList.contains("on"); }

    // Unlike the other two engines, a missing speechSynthesis doesn't stop
    // this game: the card still shows the word and the student still reads
    // it. Only the check-yourself read is lost, so this warns and lets them
    // play on rather than disabling Start.
    if(!window.speechSynthesis){
      var warn = $("compatWarn");
      warn.style.display = "block";
      warn.innerHTML = "<b>This browser can't talk.</b> The cards still work — you just won't hear the word when you " +
                       "flip one. For the read-aloud check, open this page in <b>Google Chrome</b>.";
    }

    /* ---------------- helpers ---------------- */
    function shuffled(a){
      var b = a.slice();
      for(var i=b.length-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)); var t=b[i]; b[i]=b[j]; b[j]=t; }
      return b;
    }

    /* ---------------- the persistent comeback deck ----------------
       Keyed by pathname so each flash-card page keeps its own deck, and so a
       deck can never be read by a game with a different word list. */
    var comebackKey = "cardComeback:" + location.pathname;
    var comebackList = [];    // the deck the button will play, built at render time

    function readComeback(){
      try{ return sanitizeComeback(JSON.parse(localStorage.getItem(comebackKey))); }
      catch(e){ return sanitizeComeback(null); }
    }
    function writeComeback(store){
      try{ localStorage.setItem(comebackKey, JSON.stringify(store)); }catch(e){}
    }
    // Mastered words are cleared BEFORE the round's misses are merged in, so
    // a word read right and then missed again later in the same round (only
    // possible in a list that repeats it) ends up correctly still in the deck.
    function persistComeback(){
      var store = readComeback();
      mastered.forEach(function(w){ store = comebackMastered(store, w); });
      writeComeback(comebackMerge(store, missed, Date.now()));
    }

    /* ---------------- render ---------------- */
    function spawnDust(leftPct){
      var track = document.querySelector(".track-race");
      if(!track) return;
      var d = document.createElement("span");
      d.className = "dust";
      d.textContent = "💨";
      d.style.left = leftPct + "%";
      track.appendChild(d);
      setTimeout(function(){ d.remove(); }, 550);
    }
    function updateProgress(pct){
      var r = $("uiRunner"), fill = $("uiTrackFill");
      var shown = Math.min(pct, 94);
      if(lastPct !== null && pct > lastPct) spawnDust(Math.min(lastPct, 94));
      if(r) r.style.left = shown + "%";
      if(fill) fill.style.width = Math.min(pct, 100) + "%";
      lastPct = pct;
    }
    function celebrateProgress(){
      var wrap = $("uiRunner");
      var el = wrap && wrap.querySelector(".runner-icon");
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

    // Before the flip: one button, one key, nothing that gives the word away.
    // After it: the two ratings, and only then the "hear it again" button.
    function renderFace(){
      $("flipCard").className = "flip" + (flipped ? " flipped" : "");
      $("flipBack").setAttribute("aria-hidden", flipped ? "false" : "true");
      $("btnFlip").style.display = flipped ? "none" : "";
      $("btnGot").style.display  = flipped ? "" : "none";
      $("btnMiss").style.display = flipped ? "" : "none";
      $("btnHear").style.display = flipped ? "" : "none";
      $("uiKeyhint").innerHTML = flipped
        ? "Press <kbd>1</kbd> if you got it, <kbd>2</kbd> if you didn't."
        : "Press <kbd>Space</kbd> to flip the card.";
    }

    function render(){
      var w = queue[idx];
      flipped = false;
      // textContent, not innerHTML — these lists carry apostrophes and
      // periods (they'd, Mrs.) and nothing here needs markup.
      $("uiWord").textContent = w;
      $("uiWordBack").textContent = w;
      $("uiBackHint").textContent = "Did you read it right?";
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      updateProgress(idx/queue.length*100);
      renderFace();
      $("btnFlip").focus();
    }

    function popup(txt, color, big){
      var p = $("popup");
      p.textContent = txt; p.style.color = color;
      p.classList.toggle("big", !!big);
      p.classList.remove("go"); void p.offsetWidth; p.classList.add("go");
    }

    /* ---------------- game flow ---------------- */
    function startGame(list){
      queue = shuffleOn ? shuffled(list) : list.slice();
      idx = 0; score = 0; streak = 0; best = 0; right = 0;
      missed = []; mastered = []; busy = false; lastPct = null;
      show("s-play");
      render();
    }

    function scheduleNext(ms){
      if(pending) clearTimeout(pending);
      pending = setTimeout(function(){ pending = null; busy = false; next(); }, ms);
    }

    function next(){
      idx++;
      if(idx >= queue.length){ finish(); return; }
      render();
    }

    function flip(){
      if(busy || flipped) return;
      flipped = true;
      renderFace();
      sndFlip();
      // The word is spoken only now, on the way over — before the flip it
      // would be the answer, after it it's the check.
      say(queue[idx], NORMAL_RATE);
      $("btnGot").focus();
    }

    function rate(gotIt){
      if(busy || !flipped) return;
      busy = true;
      var word = queue[idx];
      if(gotIt){
        right++;
        streak++;
        if(streak > best) best = streak;
        var pts = pointsFor(streak);
        var mult = comboMultiplier(streak);
        var milestone = streak % 5 === 0;
        score += pts;
        if(mastered.indexOf(word) === -1) mastered.push(word);
        $("flipCard").className = "flip flipped rated-yes";
        $("uiBackHint").innerHTML = "<b>+" + pts + " points</b>" + (mult > 1 ? " (×" + mult + " combo)" : "");
        $("uiScore").textContent = score;
        $("uiStreak").textContent = streak;
        renderCombo();
        if(milestone){
          celebrateProgress();
          popup("🔥 " + streak + " in a row!", "#ffc94d", true);
          confettiBurst($("cardStage"), 18);
          sndCombo();
        } else {
          popup("✓ +" + pts, "#3ddc97");
          sndGood();
        }
      } else {
        streak = 0;
        $("uiStreak").textContent = 0;
        renderCombo();
        if(missed.indexOf(word) === -1) missed.push(word);
        $("flipCard").className = "flip flipped rated-no";
        // No scolding, and no "wrong" — a card you didn't know yet is the
        // entire reason to be here, and it's coming back either way.
        $("uiBackHint").textContent = "That one comes back. Say it once more.";
        popup("✗", "#ff6b6b");
        sndBad();
        say(word, SLOW_RATE);
      }
      // Long enough for the slow read on a miss to finish; the same beat
      // either way so the game's rhythm doesn't tell on the student.
      scheduleNext(gotIt ? 900 : 1600);
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
                               : pct >= 90 ? "You know these! 🏆"
                               : pct >= 70 ? "Nice work! 🎉"
                               : "Good practice! 💪";
      $("uiSummary").textContent = "You knew " + right + " of " + queue.length + " words on sight (" + pct + "%).";

      // 0–3 stars: 3 at 90%+, 2 at 70%+, 1 at 50%+ — same thresholds as the
      // other two games. Unearned slots still render as dim outlines so a
      // 2-star finish visibly has room to grow.
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
      $("btnPick").style.display = CHOICES.length > 1 ? "" : "none";
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
      CHOICES.forEach(function(choice, i){
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
      try{ localStorage.setItem("cardShuffle", shuffleOn ? "1" : "0"); }catch(e){}
      renderShuffle();
    });
    renderShuffle();

    // The deck is rebuilt at Start rather than at pick time, so the Mixed
    // deck is a fresh draw every round.
    function currentDeck(){
      var choice = CHOICES[deckIdx] || CHOICES[0];
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

    $("btnFlip").addEventListener("click", flip);
    // The card itself is the biggest target on the screen, so it flips too —
    // but only on the way over. Once it's face-up, clicking it must not
    // count as a rating.
    $("flipCard").addEventListener("click", function(){ if(!flipped) flip(); });
    $("btnGot").addEventListener("click", function(){ rate(true); });
    $("btnMiss").addEventListener("click", function(){ rate(false); });

    $("btnHear").addEventListener("click", function(){
      if(!flipped) return;
      say(queue[idx], SLOW_RATE);
    });
    // A skipped card counts as missed: the student didn't know it, whatever
    // the reason, so it belongs in the comeback deck.
    $("btnSkip").addEventListener("click", function(){
      if(busy) return;
      var t = queue[idx];
      if(missed.indexOf(t) === -1) missed.push(t);
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      // Only the cards actually seen count toward the round's total, so
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
      // A focused button handles Space and Enter natively — stepping in there
      // would fire the same action twice.
      if(e.target && e.target.tagName === "BUTTON") return;
      if(e.key === " " || e.key === "Enter"){
        e.preventDefault();
        if(!flipped) flip();
        return;
      }
      if(!flipped) return;
      if(e.key === "1"){ e.preventDefault(); rate(true); }
      else if(e.key === "2"){ e.preventDefault(); rate(false); }
      else if(e.key === "h" || e.key === "H"){ e.preventDefault(); say(queue[idx], SLOW_RATE); }
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
      dedupeWords: dedupeWords,
      sampleWords: sampleWords,
      comboMultiplier: comboMultiplier,
      pointsFor: pointsFor,
      sanitizeComeback: sanitizeComeback,
      comebackMerge: comebackMerge,
      comebackMastered: comebackMastered,
      comebackDeck: comebackDeck,
      comebackCap: COMEBACK_CAP,
      mixSize: MIX_SIZE
    }
  };
})();
