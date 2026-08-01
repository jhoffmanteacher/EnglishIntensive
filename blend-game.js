/* Shared engine for the "say the word" blend games.
 *
 * A game page supplies a word list and which end of the word the blend is
 * on; everything else — screens, scoring, the mic check meter, the
 * always-on microphone, speech matching — lives here.
 *
 *   BlendGame.start({
 *     title: "Starting Blends 🎤",
 *     blend: "start",              // "start" or "end"
 *     words: ["blip","crop", ...]
 *   });
 */
window.BlendGame = (function(){
  "use strict";

  var LEVELS = ["Spicy","Regular"];
  var LEVEL_NOTES = [
    "Spicy — the word has to come back exactly right. Fewest false credits, but the recogniser will sometimes mishear a correct answer.",
    "Regular — the blend must be right, and the rest of the word can be off by one sound. Best for most students."
  ];

  var MIC_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
      '<path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z"/>' +
    '</svg>';

  /* ---------------- phonetic matching (pure, testable) ----------------
     Everything below compares SOUNDS, not letters, so "krab" can match
     "crab" (same sounds, different spelling) while "bled" still never
     matches "bred" (different sounds, similar spelling). None of this is
     full text-to-speech phoneme conversion (G2P) — it's a small rule-based
     encoder good enough for the 1–2 syllable classroom words used here.

     phonemes(word) walks the string left to right, matching the longest
     applicable rule at each position first: digraphs/trigraphs (ch, th,
     igh, dge…), then vowel teams (ai, ee, oo…) and r-controlled vowels
     (ar, er…), then magic-e (silent final e that lengthens the vowel
     before it), then plain letters. Examples:
       phonemes("crab")  -> ["K","R","AE","B"]
       phonemes("krab")  -> ["K","R","AE","B"]   (same — passes)
       phonemes("plum")  -> ["P","L","UH","M"]
       phonemes("plumb") -> ["P","L","UH","M"]   (silent b after m — same)
       phonemes("sled")  -> ["S","L","EH","D"]
       phonemes("slade") -> ["S","L","EY","D"]   (differ only in the vowel) */

  var SHORT_VOWEL = { a:"AE", e:"EH", i:"IH", o:"AO", u:"UH" };
  var LONG_VOWEL  = { a:"EY", e:"IY", i:"AY", o:"OW", u:"UW" };
  var VOWEL_PHONES = { AE:1,EH:1,IH:1,AO:1,UH:1,EY:1,IY:1,AY:1,OW:1,UW:1,AW:1,OY:1,AR:1,OR:1,ER:1 };

  function isVowelPhone(p){ return !!VOWEL_PHONES[p]; }
  function isVowelLetter(ch){ return ch==="a"||ch==="e"||ch==="i"||ch==="o"||ch==="u"; }
  function isConsonantLetter(ch){ return /[a-z]/.test(ch) && !isVowelLetter(ch); }

  // c/g are "soft" before e, i or y (cent, gem); x and everything else is
  // a fixed letter-to-sound mapping.
  function consonantToken(ch, next){
    if(ch === "c") return (next==="e"||next==="i"||next==="y") ? "S" : "K";
    if(ch === "g") return (next==="e"||next==="i"||next==="y") ? "J" : "G";
    if(ch === "x") return "KS";
    return ch.toUpperCase();
  }

  function phonemes(word){
    word = String(word||"").toLowerCase().replace(/[^a-z]/g,"");
    var out = [], i = 0, n = word.length;
    function at(s){ return word.substr(i, s.length) === s; }
    while(i < n){
      var c = word.charAt(i);

      // Trigraphs/tetragraphs first, longest match wins.
      if(at("eigh")){ out.push("EY"); i+=4; continue; }
      if(at("igh")){ out.push("AY"); i+=3; continue; }
      if(at("tch")){ out.push("C"); i+=3; continue; }
      if(at("dge")){ out.push("J"); i+=3; continue; }
      if(at("mb") && i+2===n){ out.push("M"); i+=2; continue; }   // silent b, end only

      // Digraphs.
      if(at("ch")){ out.push("C"); i+=2; continue; }
      if(at("sh")){ out.push("S"); i+=2; continue; }
      if(at("th")){ out.push("TH"); i+=2; continue; }
      if(at("ph")){ out.push("F"); i+=2; continue; }
      if(at("wh")){ out.push("W"); i+=2; continue; }
      if(at("ck")){ out.push("K"); i+=2; continue; }
      if(at("ng")){ out.push("NG"); i+=2; continue; }
      if(at("qu")){ out.push("KW"); i+=2; continue; }
      if(i===0 && at("wr")){ out.push("R"); i+=2; continue; }
      if(i===0 && at("kn")){ out.push("N"); i+=2; continue; }
      if(i===0 && at("gn")){ out.push("N"); i+=2; continue; }

      // Vowel teams and r-controlled vowels.
      if(at("ai")||at("ay")){ out.push("EY"); i+=2; continue; }
      if(at("ee")||at("ea")){ out.push("IY"); i+=2; continue; }
      if(at("oa")||at("ow")){ out.push("OW"); i+=2; continue; }
      if(at("oo")){ out.push("UW"); i+=2; continue; }
      if(at("ou")){ out.push("AW"); i+=2; continue; }
      if(at("oi")||at("oy")){ out.push("OY"); i+=2; continue; }
      if(at("ar")){ out.push("AR"); i+=2; continue; }
      if(at("or")){ out.push("OR"); i+=2; continue; }
      if(at("er")||at("ir")||at("ur")){ out.push("ER"); i+=2; continue; }

      // Magic e: vowel + single consonant + silent final e lengthens the vowel.
      if(isVowelLetter(c) && (i+2)===(n-1) && word.charAt(i+2)==="e" && isConsonantLetter(word.charAt(i+1))){
        out.push(LONG_VOWEL[c]); i+=1; continue;
      }
      // A word-final e that wasn't just consumed above is silent.
      if(c==="e" && i===n-1 && n>1){ i+=1; continue; }

      // Doubled consonants collapse to one sound ("ll" -> L, "ss" -> S…).
      if(isConsonantLetter(c) && word.charAt(i+1)===c){
        out.push(consonantToken(c, word.charAt(i+2))); i+=2; continue;
      }

      if(c==="y"){
        out.push(i===0 ? "Y" : (i===n-1 ? "IY" : "IH"));
        i+=1; continue;
      }
      if(isVowelLetter(c)){ out.push(SHORT_VOWEL[c]); i+=1; continue; }
      out.push(consonantToken(c, word.charAt(i+1)));
      i+=1;
    }
    return out;
  }

  // Phoneme-level edit distance. Recognisers mangle vowels far more than
  // consonants, so swapping one vowel sound for another costs half as much
  // as any other kind of change. A plain consonant-for-consonant swap costs
  // *more* than a full point (not exactly 1) so it never fits inside
  // Regular's budget of 1 — a wrong consonant almost always means a
  // different word entirely (e.g. "vest" heard as "nest"), not a mishearing,
  // so Regular shouldn't forgive it the same way it forgives vowel drift.
  function phoneticDistance(a, b){
    var m=a.length, n=b.length, i, j, prev=[], cur=[];
    for(j=0;j<=n;j++) prev[j]=j;
    for(i=1;i<=m;i++){
      cur[0]=i;
      for(j=1;j<=n;j++){
        var subCost = a[i-1]===b[j-1] ? 0 : (isVowelPhone(a[i-1]) && isVowelPhone(b[j-1]) ? 0.5 : 1.5);
        cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+subCost);
      }
      for(j=0;j<=n;j++) prev[j]=cur[j];
    }
    return prev[n];
  }

  var NUM_WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
                    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
                    "eighteen","nineteen","twenty"];

  function normalize(s){
    s = String(s||"");
    // The recogniser sometimes returns a number instead of a short word
    // ("tent" -> "10"); spell 0-20 back out before stripping non-letters,
    // since that stripping would otherwise just delete the digits.
    s = s.replace(/\b\d{1,2}\b/g, function(d){
      var v = parseInt(d,10);
      return NUM_WORDS[v] !== undefined ? NUM_WORDS[v] : d;
    });
    return s.toLowerCase().replace(/[^a-z' ]/g," ").replace(/\s+/g," ").trim();
  }

  function blendPart(word, atStart, blendLength){
    return atStart ? word.slice(0, blendLength) : word.slice(-blendLength);
  }

  // Locate a phoneme subsequence (e.g. ["OY"]) anywhere in a phoneme array —
  // used by "sound" mode, where the target sound isn't pinned to the start
  // or end of the word (the oi/oy diphthong can land anywhere: "coin",
  // "boyish", "annoy"). Returns the index it starts at, or -1.
  function findPhonemeSeq(arr, seq){
    for(var i=0;i+seq.length<=arr.length;i++){
      var ok = true;
      for(var j=0;j<seq.length;j++){ if(arr[i+j]!==seq[j]){ ok=false; break; } }
      if(ok) return i;
    }
    return -1;
  }

  // Known-good transcripts the recogniser returns for specific target words,
  // seeded from mishearings actually observed in class — not a guess at
  // every possible mishearing. Accepted at Regular, never Spicy.
  // Add more here as they turn up; keep it short and commented.
  var ACCEPT = {
    gasp: ["gas"],     // final consonant dropped
    tent: ["tenth"]    // recogniser adds a trailing "th" sound
  };

  // True if `heard` sounds more like some OTHER word in the same list than
  // it sounds like `target` — i.e. the distance budget below only forgives
  // an error when the target is still the best explanation for what was
  // heard. Without this, "honk" (heard) passes for "hunk" (target) at
  // Regular purely because the vowel swap fits the budget, even though
  // "honk" is sitting right there in the list as its own word.
  function closerToAnotherWord(hRest, hBlend, target, distToTarget, wordList, atStart, blendLength){
    for(var i=0;i<wordList.length;i++){
      var w = wordList[i];
      if(w === target) continue;
      var wBlend = phonemes(blendPart(w, atStart, blendLength));
      if(wBlend.join(" ") !== hBlend.join(" ")) continue;
      var wFull = phonemes(w);
      var wRest = atStart ? wFull.slice(wBlend.length) : wFull.slice(0, wFull.length - wBlend.length);
      if(phoneticDistance(hRest, wRest) < distToTarget) return true;
    }
    return false;
  }

  function wordMatchesCore(heard, target, level, atStart, blendLength, wordList, soundSeq){
    if(heard === target) return true;
    if(level === 0) return false;                              // Spicy: exact only

    if(ACCEPT[target] && ACCEPT[target].indexOf(heard) !== -1) return true;

    var hFull = phonemes(heard), tFull = phonemes(target);
    var hBlend, hRest, tRest;

    if(soundSeq){
      // "sound" mode: the target sound (e.g. the oi/oy diphthong) can land
      // anywhere in the word, not just the start or end, so it's located by
      // searching the phoneme array rather than slicing fixed letter
      // positions. It still must be exactly right, same principle as a
      // start/end blend — that's the skill being practiced.
      var tIdx = findPhonemeSeq(tFull, soundSeq);
      if(tIdx === -1) return false;
      tRest = tFull.slice(0, tIdx).concat(tFull.slice(tIdx + soundSeq.length));
      var hIdx = findPhonemeSeq(hFull, soundSeq);
      if(hIdx === -1) return false;
      hBlend = soundSeq;
      hRest = hFull.slice(0, hIdx).concat(hFull.slice(hIdx + soundSeq.length));
    } else {
      // The blend must match exactly in phoneme space — stricter and fairer
      // than a letter check: "krab" now passes for "crab" (K-R = K-R), but
      // "bled" still never passes for "bred" (B-L vs B-R).
      hBlend = phonemes(blendPart(heard, atStart, blendLength));
      var tBlend = phonemes(blendPart(target, atStart, blendLength));
      if(hBlend.join(" ") !== tBlend.join(" ")) return false;

      // Slice the *whole word's* phonemes rather than re-encoding the
      // leftover letters on their own — otherwise a remainder that happens to
      // end in "e" (e.g. "vest" minus the "st" blend leaves "ve") gets misread
      // as a silent word-final e that was never actually there.
      hRest = atStart ? hFull.slice(hBlend.length) : hFull.slice(0, hFull.length - hBlend.length);
      tRest = atStart ? tFull.slice(hBlend.length) : tFull.slice(0, tFull.length - hBlend.length);
    }

    var distToTarget = phoneticDistance(hRest, tRest);
    if(distToTarget <= 1){
      if(!soundSeq && wordList && closerToAnotherWord(hRest, hBlend, target, distToTarget, wordList, atStart, blendLength)) return false;
      return true;
    }

    return false;
  }

  function isMatchCore(heardText, target, level, atStart, blendLength, wordList, soundSeq){
    var parts = normalize(heardText).split(" ");
    for(var i=0;i<parts.length;i++){
      if(parts[i] && wordMatchesCore(parts[i], target, level, atStart, blendLength, wordList, soundSeq)) return true;
    }
    return false;
  }

  /* ---------------- syllable chunk parsing (pure, testable) ----------------
     Entries in cfg.words may mark syllable boundaries with a middle dot
     ("fan·tas·tic") so the engine can scaffold the reveal on a second miss
     into its syllables instead of just re-showing the whole word.
     parseWordEntry splits an entry into the plain word — the only form
     anything outside the chunk display ever sees: phoneme matching, TTS,
     the recogniser comparison, the comeback deck, localStorage — and a
     chunks array. Entries with no dot get chunks:null and behave exactly
     as before; nothing downstream has to know the difference. */
  var CHUNK_SEP = "·";   // middle dot (·)

  function parseWordEntry(entry){
    var s = String(entry || "");
    if(s.indexOf(CHUNK_SEP) === -1) return { word: s, chunks: null };
    return { word: s.split(CHUNK_SEP).join(""), chunks: s.split(CHUNK_SEP) };
  }

  // Markup for the scaffolded reveal — each syllable its own span, alternating
  // accent/ink color so the eye tracks the split, with a small separator dot
  // between (echoing the "·" the word list itself is written with).
  function chunkMarkup(chunks){
    return '<span class="chunkword">' + chunks.map(function(c, i){
      return (i > 0 ? '<span class="chunk-sep">' + CHUNK_SEP + '</span>' : '') +
             '<span class="chunk ' + (i % 2 === 0 ? "chunk-a" : "chunk-b") + '">' + c + '</span>';
    }).join('') + '</span>';
  }

  /* ---------------- combo scoring (pure, testable) ----------------
     A streak drives a points multiplier instead of the old flat +10:
     ×1 to start, ×2 from a streak of 5, ×3 from 10 up (capped there — a
     runaway multiplier stops meaning anything). Every 5th in a row is
     still a +25 milestone on top. `streak` is the streak INCLUDING the
     answer being scored, so streak 5 pays 10×2+25 = 45. */
  function comboMultiplier(streak){
    return Math.min(3, 1 + Math.floor(streak/5));
  }
  function pointsFor(streak){
    return 10 * comboMultiplier(streak) + (streak > 0 && streak % 5 === 0 ? 25 : 0);
  }

  /* ---------------- comeback deck (pure, testable) ----------------
     Missed words don't vanish when the round ends — they're kept per game
     page so the next session can start with the words that are actually
     hard for this student. A word leaves the deck the moment it comes back
     right on the FIRST try, which is the whole pedagogy: the deck holds
     only what isn't mastered yet, so it shrinks as the student improves
     instead of growing into a punishment list.

     Store shape:  { v:1, words: { soft: {n:3, t:1717000000000}, … } }
       n — how many rounds the word has been missed in (drives priority)
       t — when it was last missed (breaks ties toward fresher trouble)

     Everything here is pure — a store goes in, a new store comes out —
     so localStorage only ever appears at the two functions in start()
     that read and write it. */

  var COMEBACK_VERSION = 1;
  var COMEBACK_CAP = 15;    // a warm-up, not a second full round

  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }

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

  // The progress bar is themed per game (race track or maze) instead of a
  // plain fill bar — same idx/queue.length percentage drives both, just
  // rendered differently. Race is a straight left:pct% move; maze walks an
  // SVG path with getPointAtLength so any word-list length still reaches
  // the same start/end points.
  function progressMarkup(theme){
    if(theme === "maze"){
      // "maze" is a vault run now, not a mouse-and-cheese maze — a ninja
      // threading a laser corridor toward a vault of diamonds. Same path,
      // same getPointAtLength walk, same class names (spell-game.js draws
      // an identical SVG with its own icons and shares every rule below),
      // just a fiction a 9th/10th grader won't feel talked down to by.
      var d = "M20,85 L150,85 L150,15 L300,15 L300,85 L450,85 L450,15 L580,15";
      return `
    <div class="track track-maze">
      <svg viewBox="0 0 600 100" preserveAspectRatio="xMidYMid meet" class="maze-svg" aria-hidden="true">
        <path class="maze-wall" d="${d}"></path>
        <path class="maze-path" d="${d}"></path>
        <path id="mazeTrail" class="maze-trail" d="${d}"></path>
        <text class="maze-goal" x="580" y="15">💎</text>
        <text id="mazeRunner" class="maze-runner" x="20" y="85">🥷</text>
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
      <ol class="steps">
        <li>Put on your <b>headphones with a mic</b> (or use the built-in mic).</li>
        <li>Click <b>Allow</b> when Chrome asks to use your microphone.</li>
        <li>Check the <b>mic meter</b> on the next screen before you play.</li>
        <li>The mic <b>stays on</b> the whole game — just say each word clearly.</li>
      </ol>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start Game</button>
        <!-- Only rendered once there's actually a deck to practise — see
             renderComeback(). Sits next to Start Game because it's another
             way to start a round, not a setting. -->
        <button class="btn ghost" id="btnComeback" style="display:none">🔁 Comeback words (<span id="cbCount">0</span>)</button>
        <button class="btn ghost" id="btnShuffle">Shuffle: <span id="shufLbl">On</span></button>
        <button class="btn ghost" id="btnLevel">Listening: <span id="lvlLbl">Regular</span></button>
        <button class="btn ghost" id="btnVoice">Voice: <span id="voiceLbl">On</span></button>
      </div>
      <p class="sub" id="lvlNote" style="margin:14px 0 0;font-size:15px"></p>
    </div>
  </section>

  <section id="s-check" class="screen">
    <div class="card">
      <h1>Mic check 🎙️</h1>
      <p class="sub">Say your name out loud. The bar should jump past the line and turn green.</p>
      <div id="checkWarn" class="warn" style="display:none"></div>
      <div class="meter"><i id="meterFill"></i><span class="mark"></span></div>
      <div class="marklbl"><span class="lo">Quiet</span><span class="at">↑ Loud enough</span><span class="hi">Too loud</span></div>
      <p class="meterMsg" id="meterMsg" aria-live="polite">Waiting for the microphone…</p>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnPlay" disabled>Start Playing</button>
        <button class="btn ghost" id="btnBack">Back</button>
      </div>
    </div>
  </section>

  <section id="s-play" class="screen">
    <div class="hud">
      <div class="stat"><div class="lbl">Score</div><div class="val" id="uiScore">0</div></div>
      <div class="stat"><div class="lbl">Streak</div><div class="val flame" id="uiStreak">0</div><div class="combo" id="uiCombo"></div></div>
      <div class="stat"><div class="lbl">Word</div><div class="val" id="uiCount">1/${cfg.words.length}</div></div>
    </div>
    ${progressMarkup(cfg.theme)}

    <div class="wordcard" id="wordCard">
      <div class="popup" id="popup"></div>
      <div class="hint">Say this word</div>
      <div class="word" id="uiWord"></div>
      <div class="micwrap">
        <button class="mic" id="btnMic" aria-label="Mute or unmute the microphone">${MIC_SVG}</button>
        <div class="keyhint" id="uiMicState" role="status">Mic is on — just say the word</div>
      </div>
      <div class="miclabel" id="uiMic" aria-live="polite">Say the word out loud</div>
    </div>

    <div class="toolbar">
      <button class="btn ghost" id="btnHear">🔊 Hear it</button>
      <button class="btn ghost" id="btnSkip">Skip ▸</button>
      <button class="btn ghost" id="btnQuit">End game</button>
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
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    // cfg.words entries may be dotted ("fan·tas·tic") to carry syllable-chunk
    // data for the scaffolded reveal. Parse once here so every other line in
    // this file — matching, TTS, the comeback deck, localStorage — only ever
    // sees the plain word; no dot leaks past this point.
    var parsedWords = (cfg.words || []).map(parseWordEntry);
    var WORDS = parsedWords.map(function(p){ return p.word; });
    var CHUNKS = {};
    parsedWords.forEach(function(p){ if(p.chunks) CHUNKS[p.word] = p.chunks; });
    function chunksFor(word){ return has(CHUNKS, word) ? CHUNKS[word] : null; }
    // Whether the blend sits at the front of the word or the back.
    var atStart = cfg.blend !== "end";
    // Number of letters in the blend — 2 for today's games ("bl", "nk"), but
    // kept configurable so a future str/spl/scr game can pass 3 without
    // touching this file.
    var blendLength = cfg.blendLength === undefined ? 2 : cfg.blendLength;
    var theme = cfg.theme === "maze" ? "maze" : "race";
    // "sound" mode (cfg.blend === "sound"): the target phoneme (e.g. "OY"
    // for oi/oy) can land anywhere in the word instead of a fixed start/end
    // position — see findPhonemeSeq. cfg.highlight is the regex used to show
    // the matching letters on the word card.
    var soundSeq = cfg.sound ? [cfg.sound] : null;
    var highlightRe = cfg.highlight || null;

    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read the word out loud. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!",
      words: WORDS,
      theme: theme
    });

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], tries = 0, busy = false;
    var mazeLen = null;    // cached path length for the maze theme's runner
    var lastPct = null;    // last progress % drawn, so the race can drop a dust puff behind it

    var shuffleOn = true;
    try{
      var savedShuffle = localStorage.getItem("blendShuffle");
      if(savedShuffle !== null) shuffleOn = savedShuffle === "1";
    }catch(e){}

    // Off by default — correctness is shown visually (checkmark/cross + glow),
    // voice is an opt-in extra for students who want spoken praise/coaching.
    var voiceOn = false;
    try{
      var savedVoice = localStorage.getItem("blendVoice");
      if(savedVoice !== null) voiceOn = savedVoice === "1";
    }catch(e){}

    /* ---------------- the persistent comeback deck ----------------
       Keyed by page path so every game keeps its own deck — trouble with
       final blends has nothing to do with the oi/oy list, and a shared key
       would mix them. Both accessors swallow their errors: with storage
       unavailable (private mode, quota, a locked-down profile) the deck is
       simply always empty and the button never appears. */
    var comebackKey = "blendComeback:" + location.pathname;
    var comebackList = [];    // the deck the button will play, built at render time
    var mastered = [];        // this round's first-try-correct words, written at finish()
    // Which list "Start Playing" on the mic-check screen will use — the full
    // word list or the comeback deck, depending on which button got us here.
    var pendingList = WORDS;

    function readComeback(){
      try{ return sanitizeComeback(JSON.parse(localStorage.getItem(comebackKey))); }
      catch(e){ return sanitizeComeback(null); }
    }
    function writeComeback(store){
      try{ localStorage.setItem(comebackKey, JSON.stringify(store)); }catch(e){}
    }
    // One read/write per round rather than one per word — a round is the
    // natural unit here (n counts rounds missed), and it keeps the storage
    // touch off the answer-handling path.
    function persistComeback(){
      if(!mastered.length && !missed.length) return;
      var store = readComeback();
      // Removals first, then misses. A word can't be both in one round today
      // (a first-try correct answer never reaches `missed`), but if that ever
      // changed the miss is the one that should stick.
      mastered.forEach(function(w){ store = comebackMastered(store, w); });
      writeComeback(comebackMerge(store, missed, Date.now()));
    }

    /* mic state: micOn is the session-wide switch (mic stays on once the game
       starts); listening is whether recognition is actually running now. */
    var micOn = false, listening = false, restartOnEnd = false;
    var rec = null, restartTimer = null, tickTimer = null, rearmTimer = null;

    /* audio-output gate: the mic is held off while the computer makes sound so
       it never hears its own beeps or the "Hear it" voice. */
    var holdUntil = 0, speaking = false;

    var $ = function(id){ return document.getElementById(id); };
    var now = function(){ return Date.now(); };

    /* ---------------- audio blips ---------------- */
    var actx = null;
    function beep(freqs, dur){
      // Hold the mic for however long this sound will actually play, plus a
      // little slack for the speakers/room, so we never transcribe ourselves.
      // keepAlive=true: a beep is just a tone, never mistaken for a word, so
      // there's no need to tear down an already-running recognizer for it —
      // doing that anyway was the main cause of the "say it twice" lag, since
      // every restart pays the recognition engine's connect delay again.
      holdMic(((freqs.length - 1) * dur * 0.7 + dur) * 1000 + 180, true);
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
    var sndCombo = function(){ beep([660,990,1320,1760],0.14); };   // milestone fanfare

    /* ---------------- screens ---------------- */
    function show(id){
      ["s-start","s-check","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
      // The deck changes every round, so the button and its count are rebuilt
      // whenever the start screen comes back into view — hooking it here
      // rather than on each caller means no path can leave a stale count.
      if(id === "s-start") renderComeback();
    }
    function playing(){ return $("s-play").classList.contains("on"); }

    /* ---------------- speech support ---------------- */
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){
      var w = $("compatWarn");
      w.style.display = "block";
      w.innerHTML = "<b>This browser can't listen.</b> Open this page in <b>Google Chrome</b> on the Chromebook. " +
                    "Speech recognition needs Chrome and an internet connection.";
      $("btnStart").disabled = true;
    }

    /* ---------------- helpers ---------------- */
    function shuffled(a){
      var b = a.slice();
      for(var i=b.length-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)); var t=b[i]; b[i]=b[j]; b[j]=t; }
      return b;
    }

    /* ---------------- how forgiving the listening is ----------------
       There is no microphone-gain setting in the Web Speech API, so being
       "more sensitive" means accepting near-misses from the recogniser —
       it mangles vowels constantly on short isolated words. But the blend
       is the thing being practised, so it is never forgiven: "bred" can
       never pass for "bled". Only the rest of the word gets slack. */
    var level = 1;                                   // Regular by default
    try{
      var saved = localStorage.getItem("blendLevel");
      if(saved !== null) level = Math.min(1, Math.max(0, parseInt(saved,10) || 0));
    }catch(e){}

    function blendOf(word){ return atStart ? word.slice(0,blendLength) : word.slice(-blendLength); }

    function markup(word){
      if(highlightRe){
        var m = highlightRe.exec(word);
        if(!m) return word;
        return word.slice(0, m.index) + '<span class="blend">' + m[0] + '</span>' + word.slice(m.index + m[0].length);
      }
      return atStart
        ? '<span class="blend">' + word.slice(0,blendLength) + '</span>' + word.slice(blendLength)
        : word.slice(0, word.length-blendLength) + '<span class="blend">' + word.slice(-blendLength) + '</span>';
    }

    function wordMatches(heard, target){
      return wordMatchesCore(heard, target, level, atStart, blendLength, WORDS, soundSeq);
    }

    function isMatch(heardText, target){
      return isMatchCore(heardText, target, level, atStart, blendLength, WORDS, soundSeq);
    }

    /* ---------------- mic check + level meter ----------------
       Runs before the game so the student can see the mic is actually picking
       them up, and so the permission prompt happens here rather than in the
       middle of play. The analyser is never connected to the destination, so
       there is no chance of feedback howl. */
    var micStream = null, meterCtx = null, meterSrc = null, analyser = null;
    var meterRAF = null, meterData = null, meterPeak = 0, meterState = "";

    function meterSay(state, html){
      if(meterState === state) return;
      meterState = state;
      $("meterMsg").innerHTML = html;
    }

    function tickMeter(){
      meterRAF = requestAnimationFrame(tickMeter);
      if(!analyser) return;
      analyser.getByteTimeDomainData(meterData);
      var sum = 0;
      for(var i=0;i<meterData.length;i++){ var v = (meterData[i]-128)/128; sum += v*v; }
      var rms = Math.sqrt(sum/meterData.length);
      // Speech sits well below full scale, so curve it to make the bar lively.
      var pct = Math.min(100, Math.pow(Math.min(rms,0.35)/0.35, 0.6) * 100);
      meterPeak = Math.max(pct, meterPeak - 1.6);   // fall back slowly
      var fill = $("meterFill");
      fill.style.width = meterPeak.toFixed(1) + "%";
      if(meterPeak < 14){
        fill.style.background = "#4a5b7a";
        meterSay("quiet", "Too quiet — talk louder, or move the mic closer to your mouth.");
      } else if(meterPeak < 88){
        fill.style.background = "var(--good)";
        meterSay("good", "<b>That's the level 👍</b> You're ready.");
      } else {
        fill.style.background = "var(--bad)";
        meterSay("loud", "A little too loud — move the mic away from your mouth a bit.");
      }
    }

    function startMicCheck(){
      show("s-check");
      meterPeak = 0; meterState = "";
      $("btnPlay").disabled = true;
      $("checkWarn").style.display = "none";
      $("meterMsg").textContent = "Waiting for the microphone…";

      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        $("checkWarn").style.display = "block";
        $("checkWarn").innerHTML = "<b>This browser can't show the meter,</b> but you can still play.";
        $("btnPlay").disabled = false;
        return;
      }

      navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
        micStream = stream;
        var C = window.AudioContext || window.webkitAudioContext;
        if(!C){ $("btnPlay").disabled = false; return; }
        meterCtx = new C();
        if(meterCtx.state === "suspended") meterCtx.resume();
        meterSrc = meterCtx.createMediaStreamSource(stream);
        analyser = meterCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;
        meterData = new Uint8Array(analyser.fftSize);
        meterSrc.connect(analyser);          // deliberately not to destination
        $("btnPlay").disabled = false;
        meterSay("quiet", "Too quiet — talk louder, or move the mic closer to your mouth.");
        tickMeter();
      }).catch(function(err){
        var name = err && err.name;
        $("checkWarn").style.display = "block";
        $("checkWarn").innerHTML = (name === "NotAllowedError" || name === "SecurityError")
          ? "<b>Microphone blocked.</b> Click the 🎤 or 🔒 icon in the address bar, choose Allow, then reload this page."
          : "<b>No microphone found.</b> Plug in the headset, then reload this page.";
        $("meterMsg").textContent = "";
        // Don't dead-end the student — the game shows its own mic message too.
        $("btnPlay").disabled = false;
      });
    }

    // Release the mic before the game starts — speech recognition opens its own.
    function stopMicCheck(){
      if(meterRAF){ cancelAnimationFrame(meterRAF); meterRAF = null; }
      if(meterSrc){ try{ meterSrc.disconnect(); }catch(e){} meterSrc = null; }
      analyser = null;
      if(meterCtx){ try{ meterCtx.close(); }catch(e){} meterCtx = null; }
      if(micStream){
        try{ micStream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){}
        micStream = null;
      }
      $("meterFill").style.width = "0";
    }

    /* ---------------- render ---------------- */
    // Same idx/queue.length percentage as the old plain bar — just handed to
    // whichever theme is running instead of a fill width.
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
      if(theme === "maze"){
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
      } else {
        var r = $("uiRunner"), fill = $("uiTrackFill");
        var shown = Math.min(pct, 94);
        if(lastPct !== null && pct > lastPct) spawnDust(Math.min(lastPct, 94));
        if(r) r.style.left = shown + "%";
        if(fill) fill.style.width = Math.min(pct, 100) + "%";
      }
      lastPct = pct;
    }
    // A little flourish on every 5-streak milestone — same "boost" class name
    // works for both themes since each one's CSS defines its own keyframes.
    function celebrateProgress(){
      var wrap = theme === "maze" ? null : $("uiRunner");
      var el = theme === "maze" ? $("mazeRunner") : (wrap && wrap.querySelector(".runner-icon"));
      if(!el) return;
      el.classList.remove("boost");
      void el.getBoundingClientRect();   // restart the animation
      el.classList.add("boost");
      setTimeout(function(){ el.classList.remove("boost"); }, 550);
    }
    // The badge under the streak number — only visible once the multiplier
    // is actually doing something, so ×1 shows nothing.
    function renderCombo(){
      var m = comboMultiplier(streak);
      $("uiCombo").textContent = m > 1 ? "×" + m + " combo!" : "";
    }
    function render(){
      var w = queue[idx];
      $("uiWord").innerHTML = markup(w);
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      updateProgress((idx)/queue.length*100);
      $("wordCard").className = "wordcard";
      $("uiMic").innerHTML = "Say the word out loud";
      $("btnSkip").textContent = "Skip ▸";
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
      idx = 0; score = 0; streak = 0; best = 0; right = 0; missed = []; mastered = []; tries = 0; busy = false;
      lastPct = null;
      show("s-play");
      micOn = !!SR;           // mic is on for the whole game from here
      render();
      startMicLoop();
    }

    function next(){
      tries = 0;
      idx++;
      if(idx >= queue.length){ finish(); return; }
      render();
    }

    function finish(){
      micOn = false;
      stopMicLoop();
      stopListening();
      persistComeback();
      show("s-end");
      $("uiFScore").textContent = score;
      $("uiFRight").textContent = right + "/" + queue.length;
      $("uiFStreak").textContent = best;
      var pct = queue.length ? Math.round(right/queue.length*100) : 0;
      var perfect = queue.length > 0 && right === queue.length;
      $("uiTitle").textContent = perfect ? "Perfect round! 🏆"
                               : pct >= 90 ? "Blend master! 🏆"
                               : pct >= 70 ? "Nice work! 🎉"
                               : "Good practice! 💪";
      $("uiSummary").textContent = "You said " + right + " of " + queue.length + " words correctly (" + pct + "%).";

      // 0–3 stars, popping in one after another. Same thresholds a game
      // would use: 3 at 90%+, 2 at 70%+, 1 at 50%+ — unearned slots still
      // render as dim outlines so a 2-star finish visibly has room to grow.
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
        missed.forEach(function(w){
          var d = document.createElement("div");
          d.className = "chip";
          var wChunks = chunksFor(w);
          // Chunked words show their dotted form (fan·tas·tic) on the
          // takeaway list itself, so the practice list teaches the split —
          // words without chunk data keep the plain highlighted markup.
          if(wChunks) d.textContent = wChunks.join(CHUNK_SEP);
          else d.innerHTML = markup(w).replace(/class="blend"/g,'class="b"');
          grid.appendChild(d);
        });
        $("btnRetryMissed").style.display = "";
      } else {
        block.style.display = "none";
        $("btnRetryMissed").style.display = "none";
      }
      if(pct >= 70) confettiBurst($("s-end").querySelector(".card"), pct >= 90 ? 26 : 16);
      sndWin();
    }

    // A one-shot burst of falling confetti pieces on a good finish — pure CSS
    // animation, each piece removes itself once its fall finishes.
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

    function handleCorrect(){
      busy = true;
      right++;
      streak++;
      // First try, no stumble: the word has earned its way out of the
      // comeback deck. Getting it on the retry (tries > 0) doesn't count.
      if(tries === 0 && mastered.indexOf(queue[idx]) === -1) mastered.push(queue[idx]);
      if(streak > best) best = streak;
      var pts = pointsFor(streak);
      var mult = comboMultiplier(streak);
      var milestone = streak > 0 && streak % 5 === 0;
      score += pts;
      $("wordCard").className = "wordcard correct";
      $("uiMic").innerHTML = "<b>Correct!</b> +" + pts + " points" +
        (mult > 1 ? " <b>(×" + mult + " combo)</b>" : "");
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      if(milestone){
        // The full celebration: runner boost, big banner, confetti in the
        // word card (it's already position:relative + overflow:hidden), and
        // a fanfare instead of the ordinary correct-beep.
        celebrateProgress();
        popup("🔥 " + streak + " in a row!", "#ffc94d", true);
        confettiBurst($("wordCard"), 18);
        sndCombo();
      } else {
        popup("✓ +" + pts, "#3ddc97");
        sndGood();
      }
      if(voiceOn){
        var phrase = milestone ? (numberWord(streak) + " in a row!") : praisePhrase(queue[idx]);
        say(phrase, { rate: 1.0, pitch: 1.05 });
      }
      // Give the praise room to finish before the next word's beep cuts it off.
      setTimeout(function(){ busy = false; next(); }, voiceOn ? 1600 : 1150);
    }

    function handleWrong(heard){
      busy = true;
      streak = 0;
      $("uiStreak").textContent = 0;
      renderCombo();
      tries++;
      $("wordCard").className = "wordcard wrong";
      popup("✗", "#ff6b6b");
      sndBad();
      var target = queue[idx];
      var targetChunks = tries >= 2 ? chunksFor(target) : null;
      var heardTxt = normalize(heard);
      var msg;
      if(tries < 2){
        msg = "Not quite — try once more.";
      } else if(targetChunks){
        // Scaffold the reveal into syllables instead of just re-showing the
        // whole word — the whole point of the chunk data is to teach the
        // split, not just hand back the answer.
        msg = "Let's move on. The word was " + chunkMarkup(targetChunks) + ".";
      } else {
        msg = "Let's move on. The word was <b>" + target + "</b>.";
      }
      $("uiMic").innerHTML = msg + (heardTxt ? '<br><span class="heard">I heard: ' + heardTxt + "</span>" : '<br><span class="heard">I didn\'t catch that</span>');
      if(tries >= 2){
        if(missed.indexOf(target) === -1) missed.push(target);
        // Never on the first miss — that stays fast so the retry isn't slowed down.
        if(voiceOn){
          if(targetChunks) sayChunked(targetChunks, target);
          else say("The word was, " + target + ".", { rate: 0.9 });
        }
        setTimeout(function(){ busy = false; next(); }, voiceOn ? 2600 : 1900);
      } else {
        setTimeout(function(){ busy = false; $("wordCard").className = "wordcard"; }, 900);
      }
    }

    /* ---------------- mic: always on while playing ----------------
       The mic is not push-to-talk. Once the game starts it listens
       continuously and only goes quiet while the computer is making sound
       (beeps or the "Hear it" voice), then comes back by itself. */

    function audioBusy(){ return speaking || now() < holdUntil; }

    // keepAlive: leave an already-running recognizer alone (used for the
    // short UI beeps) instead of aborting it — abort only for real speech
    // (the TTS coach), which the mic must never be allowed to overhear.
    // Either way, schedule a re-arm attempt right as the hold ends, instead
    // of waiting on the polling loop, so listening resumes as fast as
    // possible.
    function holdMic(ms, keepAlive){
      var until = now() + ms;
      if(until > holdUntil) holdUntil = until;
      if(!keepAlive) stopListening();
      updateMicUI();
      if(rearmTimer) clearTimeout(rearmTimer);
      rearmTimer = setTimeout(function(){ rearmTimer = null; armMic(); }, ms + 20);
    }

    function updateMicUI(){
      var b = $("btnMic"), s = $("uiMicState");
      if(!b || !s) return;
      b.classList.remove("listening","paused","off");
      if(!micOn){
        b.classList.add("off");
        s.textContent = "Mic is off — click it (or press Space) to turn it back on";
      } else if(listening){
        b.classList.add("listening");
        s.textContent = "Listening — say the word (press H to hear it)";
      } else if(audioBusy()){
        b.classList.add("paused");
        s.textContent = "Mic paused while the computer talks…";
      } else {
        b.classList.add("paused");
        s.textContent = "Mic is on — just say the word (press H to hear it)";
      }
    }

    function stopListening(){
      restartOnEnd = false;
      if(restartTimer){ clearTimeout(restartTimer); restartTimer = null; }
      if(rearmTimer){ clearTimeout(rearmTimer); rearmTimer = null; }
      if(rec){ try{ rec.onresult = rec.onerror = rec.onend = null; rec.abort(); }catch(e){} rec = null; }
      listening = false;
    }

    // Called on a timer; starts recognition whenever the conditions are right.
    function armMic(){
      if(!SR || !micOn || listening || busy) return;
      if(!playing() || audioBusy()) return;

      try{ rec = new SR(); }
      catch(e){ micOn = false; $("uiMic").textContent = "Microphone not available."; updateMicUI(); return; }

      rec.lang = "en-US";
      rec.interimResults = true;   // catch the guess early, don't wait for final
      rec.continuous = true;

      listening = true;
      restartOnEnd = true;

      rec.onresult = function(ev){
        if(busy) return;
        var target = queue[idx], lastFinal = null;
        for(var r = ev.resultIndex; r < ev.results.length; r++){
          var res = ev.results[r];
          // Only the recogniser's own top-ranked guess counts. Chrome's
          // language model is biased toward common dictionary words, so a
          // lower-ranked alternative frequently contains the target word
          // even when it wasn't actually said (e.g. "mill" said, but
          // "milk" shows up further down the list) — checking every
          // alternative defeats the pronunciation check entirely. The
          // phonetic engine already supplies the intended tolerance.
          var alt = res[0];
          if(isMatch(alt.transcript, target) &&
             !(level === 0 && alt.confidence > 0 && alt.confidence < 0.35)){
            handleCorrect();
            return;
          }
          if(res.isFinal) lastFinal = res[0].transcript;
        }
        // Only a *final* result we couldn't match counts as a miss — interim
        // guesses are just the recogniser thinking out loud. Silence never
        // costs a try, since the mic is always on.
        if(lastFinal !== null && normalize(lastFinal)) handleWrong(lastFinal);
      };

      rec.onerror = function(ev){
        var err = ev.error;
        if(err === "not-allowed" || err === "service-not-allowed"){
          micOn = false;
          stopListening();
          $("uiMic").innerHTML = "<b>Microphone blocked.</b> Click the 🎤 or 🔒 icon in the address bar and allow the mic, then reload.";
        } else if(err === "network"){
          micOn = false;
          stopListening();
          $("uiMic").innerHTML = "<b>No connection.</b> Speech needs the internet. Check wifi and reload.";
        }
        // "no-speech" and "aborted" are normal here — onend restarts the mic.
        updateMicUI();
      };

      rec.onend = function(){
        listening = false; rec = null;
        updateMicUI();
        if(restartOnEnd && micOn){
          restartTimer = setTimeout(function(){ restartTimer = null; armMic(); }, 200);
        }
      };

      try{ rec.start(); }
      catch(e){ listening = false; rec = null; }
      updateMicUI();
    }

    function startMicLoop(){
      if(tickTimer) return;
      // Safety-net poll — the real re-arm trigger is the timer holdMic()
      // schedules for the exact moment each hold ends. This just catches
      // anything that falls through (e.g. an error path that didn't).
      tickTimer = setInterval(function(){
        if(micOn && !listening) armMic();
        updateMicUI();
      }, 150);
      armMic();
      updateMicUI();
    }
    function stopMicLoop(){
      if(tickTimer){ clearInterval(tickTimer); tickTimer = null; }
    }

    /* ---------------- speak: voice pick + the word + the coach ----------------
       Chrome loads its voice list asynchronously, so the first pick often
       runs before the good voices exist — pickVoice() re-runs on
       voiceschanged to fix that. Ranked so a natural Chrome/ChromeOS voice
       always wins over the flat default. */
    var voice = null;

    function pickVoice(){
      if(!window.speechSynthesis) return;
      var all = window.speechSynthesis.getVoices() || [];
      var en = all.filter(function(v){ return /^en/i.test(v.lang); });
      if(!en.length) return;   // list not loaded yet; voiceschanged will retry
      function find(test){
        for(var i=0;i<en.length;i++){ if(test(en[i])) return en[i]; }
        return null;
      }
      voice =
        find(function(v){ return v.lang === "en-US" && /Google/.test(v.name); }) ||
        find(function(v){ return /Natural|Online/.test(v.name); }) ||
        find(function(v){ return v.lang === "en-US" && v.localService; }) ||
        find(function(v){ return v.lang === "en-US"; }) ||
        en[0];
    }
    pickVoice();
    if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pickVoice;

    // Rotate through short praise phrases; substitute the actual word into
    // one of them so it doesn't always feel canned. Never the same phrase
    // twice in a row — with only six options, back-to-back repeats happen
    // often enough by chance to sound broken.
    var lastPraise = -1;
    function praisePhrase(word){
      var options = ["Nice!", "Got it!", "You said it!", "Nailed it!", "Yes — " + word + "!", "Perfect!"];
      var i;
      do { i = Math.floor(Math.random() * options.length); } while(i === lastPraise);
      lastPraise = i;
      return options[i];
    }
    function numberWord(n){
      var w = NUM_WORDS[n];
      return w ? (w.charAt(0).toUpperCase() + w.slice(1)) : String(n);
    }

    // currentUtterance guards against a stale utterance's onend firing after
    // a newer say() has already cancelled and replaced it — that would
    // release the mic hold early while the new utterance is still talking.
    var currentUtterance = null;

    function say(text, opts){
      if(!window.speechSynthesis) return;
      opts = opts || {};
      try{
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = opts.rate || 1;
        if(opts.pitch) u.pitch = opts.pitch;
        if(voice) u.voice = voice;
        currentUtterance = u;
        speaking = true;
        stopListening();
        updateMicUI();
        var release = function(){
          if(currentUtterance !== u) return;   // superseded by a newer say()
          currentUtterance = null;
          speaking = false;
          holdMic(350);   // let the speakers settle before listening again
        };
        u.onend = release;
        u.onerror = release;
        // Safety net in case onend never fires (Chrome does this sometimes).
        setTimeout(function(){ if(currentUtterance === u) release(); }, 1200 + 90 * text.length);
        window.speechSynthesis.speak(u);
      }catch(e){ speaking = false; }
    }

    function hearIt(){
      // 0.75 sounded noticeably more robotic/stretched than a lighter
      // slowdown — 0.85 still gives a struggling reader a clear, unhurried
      // word without pushing the synthesis into its worst-sounding range.
      say(queue[idx], { rate: 0.85 });
    }

    // Speaks a chunked word syllable-by-syllable ("fan, tas, tic" — the
    // commas give the pauses), then the whole word. Two native utterances
    // queued back-to-back rather than two say() calls, since say() cancels
    // whatever's already talking — calling it twice in a row would just
    // clip the first utterance instead of letting both play in sequence.
    function sayChunked(chunks, word){
      if(!window.speechSynthesis) return;
      try{
        window.speechSynthesis.cancel();
        var u1 = new SpeechSynthesisUtterance(chunks.join(", "));
        var u2 = new SpeechSynthesisUtterance(word);
        [u1, u2].forEach(function(u){ u.lang = "en-US"; if(voice) u.voice = voice; });
        u1.rate = 0.7;
        u2.rate = 0.9;
        currentUtterance = u2;
        speaking = true;
        stopListening();
        updateMicUI();
        var release = function(){
          if(currentUtterance !== u2) return;   // superseded by a newer say()/sayChunked()
          currentUtterance = null;
          speaking = false;
          holdMic(350);   // let the speakers settle before listening again
        };
        u2.onend = release;
        u2.onerror = release;
        // Safety net in case onend never fires (Chrome does this sometimes).
        var totalChars = chunks.join(", ").length + word.length;
        setTimeout(function(){ if(currentUtterance === u2) release(); }, 1200 + 90 * totalChars);
        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
      }catch(e){ speaking = false; }
    }

    /* ---------------- events ---------------- */
    $("btnStart").addEventListener("click", function(){
      pendingList = WORDS;
      beep([440],0.06); startMicCheck();
    });
    $("btnPlay").addEventListener("click", function(){ stopMicCheck(); startGame(pendingList); });
    $("btnBack").addEventListener("click", function(){ stopMicCheck(); show("s-start"); });

    // The count has to be right at the moment the student looks at it, so
    // the deck is rebuilt from storage here rather than cached at load —
    // finish() has usually rewritten the store since the last render.
    function renderComeback(){
      comebackList = comebackDeck(readComeback(), COMEBACK_CAP);
      $("btnComeback").style.display = comebackList.length ? "" : "none";
      $("cbCount").textContent = comebackList.length;
    }
    $("btnComeback").addEventListener("click", function(){
      if(!comebackList.length) return;
      pendingList = comebackList.slice();
      beep([440],0.06); startMicCheck();
    });
    renderComeback();

    function renderShuffle(){
      $("shufLbl").textContent = shuffleOn ? "On" : "Off";
    }
    $("btnShuffle").addEventListener("click", function(){
      shuffleOn = !shuffleOn;
      try{ localStorage.setItem("blendShuffle", shuffleOn ? "1" : "0"); }catch(e){}
      renderShuffle();
    });
    renderShuffle();

    function renderLevel(){
      $("lvlLbl").textContent = LEVELS[level];
      $("lvlNote").textContent = LEVEL_NOTES[level];
    }
    $("btnLevel").addEventListener("click", function(){
      level = (level + 1) % LEVELS.length;
      try{ localStorage.setItem("blendLevel", String(level)); }catch(e){}
      renderLevel();
    });
    renderLevel();

    function renderVoice(){
      $("voiceLbl").textContent = voiceOn ? "On" : "Off";
    }
    $("btnVoice").addEventListener("click", function(){
      voiceOn = !voiceOn;
      try{ localStorage.setItem("blendVoice", voiceOn ? "1" : "0"); }catch(e){}
      renderVoice();
    });
    renderVoice();

    // The mic button is a mute switch, not push-to-talk.
    $("btnMic").addEventListener("click", function(){
      micOn = !micOn;
      if(!micOn) stopListening(); else armMic();
      updateMicUI();
    });
    $("btnHear").addEventListener("click", hearIt);
    $("btnSkip").addEventListener("click", function(){
      if(busy) return;
      var t = queue[idx];
      if(missed.indexOf(t) === -1) missed.push(t);
      streak = 0; next();
    });
    $("btnQuit").addEventListener("click", function(){
      queue = queue.slice(0, idx);
      finish();
    });
    $("btnAgain").addEventListener("click", function(){ startGame(WORDS); });
    $("btnRetryMissed").addEventListener("click", function(){
      var list = missed.slice();
      if(list.length) startGame(list);
    });

    document.addEventListener("keydown", function(e){
      if(e.code === "Space" && playing()){
        e.preventDefault();
        micOn = !micOn;
        if(!micOn) stopListening(); else armMic();
        updateMicUI();
      } else if(e.code === "KeyH" && playing() && !busy){
        e.preventDefault();
        hearIt();
      }
    });

    window.addEventListener("beforeunload", function(){
      micOn = false; stopMicLoop(); stopListening(); stopMicCheck();
      // A coach utterance mid-sentence would otherwise keep talking over
      // the next page for a beat — speechSynthesis is window-global.
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    });
  }

  // _internals exposes the pure, state-free matching, scoring,
  // comeback-deck and word-list-parsing helpers for tests.html.
  // Not part of the public game API — don't build games against it.
  return {
    start: start,
    _internals: {
      normalize: normalize,
      phonemes: phonemes,
      isVowelPhone: isVowelPhone,
      phoneticDistance: phoneticDistance,
      wordMatches: wordMatchesCore,
      isMatch: isMatchCore,
      findPhonemeSeq: findPhonemeSeq,
      comboMultiplier: comboMultiplier,
      pointsFor: pointsFor,
      sanitizeComeback: sanitizeComeback,
      comebackMerge: comebackMerge,
      comebackMastered: comebackMastered,
      comebackDeck: comebackDeck,
      comebackCap: COMEBACK_CAP,
      parseWordEntry: parseWordEntry
    }
  };
})();
