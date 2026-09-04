/* Shared core for the game engines.
 *
 * There are four engines on this site — blend-game.js (say it), spell-game.js
 * (type it), card-game.js (flip it), match-game.js (find it) — and they
 * deliberately share a look, a scoring system and a set of habits, so a
 * student moving between them sees one game with different questions. That
 * agreement used to be maintained by copying code between the engines and
 * writing "keep this in step" on top of each copy. At two copies that was
 * the right trade against a no-build site. By four it wasn't: the scoring
 * was in four places, the comeback deck in three, the vault-run SVG in three
 * more, and every one of them was a chance for two games to quietly start
 * behaving differently.
 *
 * So the parts that MUST agree live here, once, and the engines load this
 * file first:
 *
 *   <script src="game-core.js"></script>
 *   <script src="blend-game.js"></script>
 *
 * What belongs here is what would be a bug if it differed between games:
 * scoring, the comeback deck, the progress graphic, the stars, the confetti,
 * the voice ranking. What stays in an engine is what SHOULD differ — how it
 * asks its question, how it judges the answer, and what it does with the
 * microphone. blend-game.js speaks and beeps around a live recognizer, so it
 * keeps its own say() and passes its mic-hold in as a callback here rather
 * than pushing microphone bookkeeping into shared code.
 *
 * Still no build step: this is one more plain <script> on a page that
 * already had two.
 */
window.GameCore = (function(){
  "use strict";

  /* ---------------- scoring (pure, testable) ----------------
     10 points × a streak-driven multiplier (×1, ×2 from a streak of 5, ×3
     from 10 up, capped there), plus a +25 milestone on every 5th in a row.
     `streak` INCLUDES the answer being scored, so streak 5 pays
     10×2+25 = 45. */
  function comboMultiplier(streak){
    return Math.min(3, 1 + Math.floor(streak/5));
  }
  function pointsFor(streak){
    return 10 * comboMultiplier(streak) + (streak > 0 && streak % 5 === 0 ? 25 : 0);
  }

  // 0–3 stars: 3 at 90%+, 2 at 70%+, 1 at 50%+. Unearned slots still render
  // as dim outlines, so a 2-star finish visibly has room to grow.
  function starsFor(pct){
    return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
  }
  function renderStars(el, pct){
    if(!el) return;
    var lit = starsFor(pct);
    el.innerHTML = "";
    for(var i=0; i<3; i++){
      var st = document.createElement("span");
      st.className = "star" + (i < lit ? " lit" : "");
      st.style.animationDelay = (0.25 + i*0.3) + "s";
      st.textContent = "★";
      el.appendChild(st);
    }
  }

  /* ---------------- word lists (pure, testable) ---------------- */
  function shuffled(a){
    var b = a.slice();
    for(var i=b.length-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)); var t=b[i]; b[i]=b[j]; b[j]=t; }
    return b;
  }

  // Printed word lists repeat words across lists on purpose (the red-word
  // screener re-tests "you", "friend", "sure" and "enough" at a harder
  // point). Across rounds that's intended; inside one round the same card
  // coming round twice just reads as a bug. First occurrence wins, so a deck
  // keeps its printed order.
  function dedupeWords(list){
    var out = [], seen = {};
    if(!list) return out;
    for(var i=0;i<list.length;i++){
      var w = list[i];
      if(typeof w !== "string" || !w) continue;
      if(has(seen, w)) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }

  /* ---------------- syllable chunks (pure, testable) ----------------
     A word list may write a word with middle dots marking its syllable
     boundaries — "fan·tas·tic". The dots are a teaching aid for the
     display only: the plain word is the ONLY form that reaches phoneme
     matching, TTS, or a stored stat key, so a dotted entry and an
     undotted one are the same word everywhere it counts.

     This used to live in blend-game.js alone, because it was the only
     engine playing the multisyllable list. Now that every list can be
     played as cards or Match It, all three need the same answer to
     "what word is this really?" — so it lives here, with the rest of
     what the engines must agree about. */
  var CHUNK_SEP = "\u00b7";   // middle dot (·)

  function parseEntry(entry){
    var s = String(entry == null ? "" : entry);
    if(s.indexOf(CHUNK_SEP) === -1) return { word: s, chunks: null };
    return { word: s.split(CHUNK_SEP).join(""), chunks: s.split(CHUNK_SEP) };
  }

  // The dotted word as markup: alternating syllable colours with the dot
  // between (echoing the "·" the word list itself is written with).
  function chunkMarkup(chunks){
    return '<span class="chunkword">' + chunks.map(function(c, i){
      return (i > 0 ? '<span class="chunk-sep">' + CHUNK_SEP + '</span>' : '') +
             '<span class="chunk ' + (i % 2 === 0 ? "chunk-a" : "chunk-b") + '">' + escapeHtml(c) + '</span>';
    }).join("") + '</span>';
  }

  // Random sample without replacement. `rnd` is a parameter rather than a
  // direct Math.random() call so tests can feed it a predictable sequence;
  // games never pass it.
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

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------- comeback deck (pure, testable) ----------------
     Missed words don't vanish when the round ends — they're kept per game
     page so the next session can start with the words that are actually
     hard for this student. A word leaves the deck the moment it comes back
     right on the FIRST try, which is the whole pedagogy: the deck holds only
     what isn't mastered yet, so it shrinks as the student improves instead
     of growing into a punishment list.

     Store shape:  { v:1, words: { soft: {n:3, t:1717000000000}, … } }
       n — how many rounds the word has been missed in (drives priority)
       t — when it was last missed (breaks ties toward fresher trouble)

     Everything here is pure — a store goes in, a new store comes out — so
     localStorage only ever appears inside comebackStore() below. */
  var COMEBACK_VERSION = 1;
  var COMEBACK_CAP = 15;    // a warm-up, not a second full round

  // localStorage is shared, hand-editable and outlives any change to this
  // file, so whatever comes back out is treated as untrusted input: anything
  // that isn't an entry with a real positive miss count is dropped. A
  // corrupted deck should cost a student their review list, never the game.
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
  // than read from Date.now() in here so the tie-breaking is testable. A
  // word repeated in one round's misses still only counts once — n counts
  // rounds gone wrong, not individual wrong tries.
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

  // A word earns its way out by coming back right on the first try. Getting
  // it on the second try doesn't count — that's still the stumble the deck
  // exists to catch.
  function comebackMastered(store, word){
    var out = sanitizeComeback(store);
    if(typeof word === "string" && has(out.words, word)) delete out.words[word];
    return out;
  }

  // Most-missed first, so a capped deck keeps the words that keep going
  // wrong rather than an arbitrary slice. Ties go to the most recently
  // missed word, then alphabetically — the last step is arbitrary but makes
  // the deck stable instead of following whatever order the object's keys
  // happen to come back in. The sort decides *which* words make the cap;
  // Shuffle may still reorder them within the round, which is fine.
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

  // The one place localStorage is touched. Keyed per game page, so each game
  // keeps its own deck and a deck can never be read by a game with a
  // different word list. Storage being unavailable (a locked-down profile,
  // private browsing) costs the review list and nothing else.
  function comebackStore(key){
    return {
      read: function(){
        try{ return sanitizeComeback(JSON.parse(localStorage.getItem(key))); }
        catch(e){ return sanitizeComeback(null); }
      },
      write: function(store){
        try{ localStorage.setItem(key, JSON.stringify(store)); }catch(e){}
      }
    };
  }

  /* ---------------- voice ----------------
     Which voice the site speaks with, picked once and re-picked when Chrome
     finishes loading its list. Every engine reads this; each one keeps its
     own say(), because what has to happen AROUND an utterance differs —
     blend-game.js has to stop a live recognizer first so it doesn't
     transcribe the computer. */
  var voice = null;

  // macOS/iOS ship joke voices (Albert croaks, Zarvox is a robot, Bahh is a
  // sheep) in the same en-US list as the real ones. "First local en-US voice"
  // used to be the fallback, and alphabetically that's Albert — so on Safari
  // a game could sound like a frog. Never pick these, even as a last resort;
  // a word-only fallback beats an unintelligible voice.
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

  function currentVoice(){ return voice; }

  /* ---------------- sounds ----------------
     The four feedback blips, identical across the games so right and wrong
     sound the same wherever a student hears them. `onPlay` is called with
     how long the sound will run, in ms, before it plays: blend-game.js uses
     it to hold the microphone open so the game never transcribes its own
     beep. Nothing else needs it. */
  function sounds(opts){
    opts = opts || {};
    var onPlay = typeof opts.onPlay === "function" ? opts.onPlay : null;
    var actx = null;
    function beep(freqs, dur){
      if(onPlay) onPlay(((freqs.length - 1) * dur * 0.7 + dur) * 1000);
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
    return {
      beep:  beep,
      good:  function(){ beep([660,880,1180],0.16); },
      bad:   function(){ beep([300,200],0.20); },
      win:   function(){ beep([660,880,1180,1560],0.18); },
      combo: function(){ beep([660,990,1320,1760],0.14); },   // milestone fanfare
      click: function(){ beep([440],0.06); }
    };
  }

  /* ---------------- confetti ---------------- */
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

  /* ---------------- the score pop-up ---------------- */
  function popup(el, txt, color, big){
    if(!el) return;
    el.textContent = txt;
    el.style.color = color;
    el.classList.toggle("big", !!big);
    el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
  }

  /* ---------------- progress graphic ----------------
     Themed per game instead of a plain fill bar — same word-index percentage
     drives both, just rendered differently. "race" slides a car along a
     track toward a checkered flag; "maze" is a vault run, a runner threading
     a neon laser corridor toward the prize. Every look lives in
     blend-game.css; this only supplies the markup and the arithmetic, so a
     change there reaches all four games for free.

     progress("maze", {goal:"🏆", runner:"✏️"}) — the two emoji are the only
     thing a game may vary, so the spelling game can run a pencil at a trophy
     while the matching game runs a ninja at a diamond. */
  var MAZE_PATH = "M20,85 L150,85 L150,15 L300,15 L300,85 L450,85 L450,15 L580,15";

  function progress(theme, opts){
    opts = opts || {};
    var isMaze = theme === "maze";
    var goal = opts.goal || (isMaze ? "💎" : "🏁");
    var runner = opts.runner || "🥷";
    var mazeLen = null;    // cached path length, measured on first update
    var lastPct = null;    // last % drawn, so the race can drop dust behind it

    function markup(){
      if(isMaze){
        return `
    <div class="track track-maze">
      <svg viewBox="0 0 600 100" preserveAspectRatio="xMidYMid meet" class="maze-svg" aria-hidden="true">
        <path class="maze-wall" d="${MAZE_PATH}"></path>
        <path class="maze-path" d="${MAZE_PATH}"></path>
        <path id="mazeTrail" class="maze-trail" d="${MAZE_PATH}"></path>
        <text class="maze-goal" x="580" y="15">${goal}</text>
        <text id="mazeRunner" class="maze-runner" x="20" y="85">${runner}</text>
      </svg>
    </div>`;
      }
      // A hand-drawn car instead of the 🚗 emoji — emoji "automobile" glyphs
      // face left in every major vendor set, and mirroring one with CSS looks
      // slightly off (reversed shading/details). Drawing it ourselves means
      // it's simply built facing right, with spinning wheels for extra life.
      return `
    <div class="track track-race">
      <div class="track-road"><i class="track-fill" id="uiTrackFill"></i></div>
      <div class="track-goal">${goal}</div>
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

    // Dust puffs the car drops behind it on every step forward.
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

    function update(pct){
      if(isMaze){
        // mazeTrail shares the maze-path's "d", so its length doubles as the
        // guide path's length — one <path> query covers both.
        var path = document.getElementById("mazeTrail"),
            mover = document.getElementById("mazeRunner");
        if(!path || !mover) return;
        if(mazeLen === null){ mazeLen = path.getTotalLength(); path.style.strokeDasharray = mazeLen; }
        var covered = pct/100 * mazeLen;
        var pt = path.getPointAtLength(covered);
        mover.setAttribute("x", pt.x);
        mover.setAttribute("y", pt.y);
        path.style.strokeDashoffset = mazeLen - covered;
      } else {
        var r = document.getElementById("uiRunner"), fill = document.getElementById("uiTrackFill");
        // The car stops short of the flag until the round is actually over,
        // so it never looks finished while there are words left.
        var shown = Math.min(pct, 94);
        if(lastPct !== null && pct > lastPct) spawnDust(Math.min(lastPct, 94));
        if(r) r.style.left = shown + "%";
        if(fill) fill.style.width = Math.min(pct, 100) + "%";
      }
      lastPct = pct;
    }

    // A little flourish on every 5-streak milestone — the same "boost" class
    // works for both themes, since each one's CSS defines its own keyframes.
    function celebrate(){
      var el;
      if(isMaze) el = document.getElementById("mazeRunner");
      else {
        var wrap = document.getElementById("uiRunner");
        el = wrap && wrap.querySelector(".runner-icon");
      }
      if(!el) return;
      el.classList.remove("boost");
      void el.getBoundingClientRect();   // restart the animation
      el.classList.add("boost");
      setTimeout(function(){ el.classList.remove("boost"); }, 550);
    }

    // Back to the start line, so a replayed round doesn't inherit the last
    // one's dust trail.
    function reset(){ lastPct = null; }

    return { markup: markup, update: update, celebrate: celebrate, reset: reset };
  }

  /* ---------------- style injection ----------------
     An engine's own CSS ships inside it rather than as another stylesheet,
     so a game page stays two <link>s however many engines exist, and so an
     engine can never be loaded without its styles. */
  function injectStyle(id, css){
    if(document.getElementById(id)) return;
    var el = document.createElement("style");
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }

  return {
    comboMultiplier: comboMultiplier,
    pointsFor: pointsFor,
    starsFor: starsFor,
    renderStars: renderStars,

    shuffled: shuffled,
    dedupeWords: dedupeWords,
    sampleWords: sampleWords,
    escapeHtml: escapeHtml,

    chunkSep: CHUNK_SEP,
    parseEntry: parseEntry,
    chunkMarkup: chunkMarkup,

    comebackCap: COMEBACK_CAP,
    sanitizeComeback: sanitizeComeback,
    comebackMerge: comebackMerge,
    comebackMastered: comebackMastered,
    comebackDeck: comebackDeck,
    comebackStore: comebackStore,

    voice: currentVoice,
    sounds: sounds,
    confettiBurst: confettiBurst,
    popup: popup,
    progress: progress,
    injectStyle: injectStyle
  };
})();
