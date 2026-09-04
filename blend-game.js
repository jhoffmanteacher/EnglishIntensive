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

  // What this engine takes from game-core.js. Aliased once here rather than
  // reached through GameCore at every call site, so the code below reads the
  // same as it did when these lived in this file — and so the list of what's
  // shared is in one visible place. What ISN'T shared is everything to do
  // with the microphone: say() and the beeps have to coordinate with a live
  // recognizer, so they stay here and hand the core a mic-hold callback.
  var Core = window.GameCore;
  var shuffled        = Core.shuffled,
      comboMultiplier = Core.comboMultiplier,
      pointsFor       = Core.pointsFor;

  var MIC_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
      '<path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z"/>' +
    '</svg>';

  /* ---------------- phonetic matching ----------------
     The encoder itself — phonemes(), the spans behind them, the edit
     distance, transcript normalising and the ACCEPT table — lives in
     game-core.js now, because the cards page has to judge a spoken answer
     without loading this engine and the phoneme clips are keyed by the
     same tokens. Aliased here the way dedupeWords is, so the matching code
     below reads exactly as it did when the encoder lived in this file.
     What stays is what only Say It does: slicing the blend out of a word,
     and the level rules for how much drift a match forgives. */
  var phonemes         = Core.phonemes,
      phonemeSpans     = Core.phonemeSpans,
      isVowelPhone     = Core.isVowelPhone,
      phoneticDistance = Core.phoneticDistance,
      normalize        = Core.normalize,
      findPhonemeSeq   = Core.findPhonemeSeq,
      ACCEPT           = Core.ACCEPT;

  function blendPart(word, atStart, blendLength){
    return atStart ? word.slice(0, blendLength) : word.slice(-blendLength);
  }

  // diagnose()'s seven kinds as something that fits on a chip. Deliberately
  // the student's words, not a phonics term: the end screen is read by the
  // student first and the teacher second.
  var KIND_LABEL = {
    blend: "blend", sound: "the sound", vowel: "vowel", consonant: "consonant",
    missing: "dropped a sound", extra: "extra sound", other: "read it slower"
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

  function wordMatchesCore(heard, target, level, atStart, blendLength, wordList, soundSeq, homophones){
    if(heard === target) return true;
    /* Before the level rules, not after: a homophone is not a near miss
       the game is being generous about, it is the same sound. No listener
       separates "to" from "two" either, and a student who reads the card
       correctly must not be marked wrong because the recogniser guessed
       the other spelling. Accepted at Challenge for the same reason. */
    if(homophones && Core.sameHomophone(heard, target, homophones)) return true;
    if(level === 0) return false;                              // Challenge: exact only

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

  function isMatchCore(heardText, target, level, atStart, blendLength, wordList, soundSeq, homophones){
    var said = normalize(heardText);
    // The whole transcript is a candidate before it is split, because
    // normalize folds "they would" into "they'd" and splitting undoes it.
    var parts = [said].concat(said.indexOf(" ") === -1 ? [] : said.split(" "));
    for(var i=0;i<parts.length;i++){
      if(parts[i] && wordMatchesCore(parts[i], target, level, atStart, blendLength, wordList, soundSeq, homophones)) return true;
    }
    return false;
  }

  /* ---------------- syllable chunk parsing ----------------
     Entries in cfg.words may mark syllable boundaries with a middle dot
     ("fan·tas·tic") so the engine can scaffold the reveal on a second miss
     into its syllables instead of just re-showing the whole word.
     parseWordEntry splits an entry into the plain word — the only form
     anything outside the chunk display ever sees: phoneme matching, TTS,
     the recogniser comparison, the comeback deck, localStorage — and a
     chunks array. Entries with no dot get chunks:null and behave exactly
     as before; nothing downstream has to know the difference.

     Both functions moved to game-core.js when the cards and Match It
     engines started playing the same dotted lists: three engines needing
     the same answer to "what word is this really?" is exactly what the
     core is for. They stay exported from _internals here because that is
     where tests.html has always reached for them. */
  var CHUNK_SEP = Core.chunkSep;
  var parseWordEntry = Core.parseEntry;
  var chunkMarkup = Core.chunkMarkup;

  // One template literal rather than a hundred lines of string concatenation —
  // this is markup, and it should still read like markup.
  function shell(cfg){
    return `
  <section id="s-start" class="screen on">
    <div class="card">
      <h1>${cfg.title}</h1>
      <p class="sub">${cfg.intro}</p>
      <div id="compatWarn" class="warn" style="display:none"></div>
      <button class="btn ghost" id="btnDirections" type="button" style="margin-bottom:16px">🔊 Read directions aloud</button>
      <ol class="steps">
        <li>Put on <b>headphones with a mic</b>.</li>
        <li>Click <b>Allow</b> so Chrome can use your microphone.</li>
        <li>Check the <b>mic meter</b>, then start.</li>
        <li>Say each word clearly. The mic <b>stays on</b> the whole time.</li>
      </ol>
      ${window.GameCore.readingViewButton()}
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start Game</button>
        <!-- Only rendered once there's actually a deck to practise — see
             renderComeback(). Sits next to Start Game because it's another
             way to start a round, not a setting. -->
        <button class="btn ghost" id="btnComeback" style="display:none">🔁 Comeback words (<span id="cbCount">0</span>)</button>
        <button class="btn ghost" id="btnShuffle">Shuffle: <span id="shufLbl">On</span></button>
        <button class="btn ghost" id="btnVoice">Voice: <span id="voiceLbl">On</span></button>
      </div>
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
    ${cfg.progress}

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
    function chunksFor(word){
      return Object.prototype.hasOwnProperty.call(CHUNKS, word) ? CHUNKS[word] : null;
    }
    // Whether the blend sits at the front of the word or the back.
    var atStart = cfg.blend !== "end";
    // Number of letters in the blend — 2 for today's games ("bl", "nk"), but
    // kept configurable so a future str/spl/scr game can pass 3 without
    // touching this file.
    var blendLength = cfg.blendLength === undefined ? 2 : cfg.blendLength;
    var theme = cfg.theme === "maze" ? "maze" : "race";
    // "race" is a car on a dashed track; "maze" is a vault run — a ninja
    // threading a laser corridor toward a vault of diamonds.
    var prog = Core.progress(theme);
    // "sound" mode (cfg.blend === "sound"): the target phoneme (e.g. "OY"
    // for oi/oy) can land anywhere in the word instead of a fixed start/end
    // position — see findPhonemeSeq. cfg.highlight is the regex used to show
    // the matching letters on the word card.
    var soundSeq = cfg.sound ? [cfg.sound] : null;
    var highlightRe = cfg.highlight || null;

    /* ---------------- outcome reporting (optional) ----------------
       The engine stays storage-agnostic: it announces what happened and
       has no idea whether anyone is listening. EIPractice passes these in
       to feed the adaptive scheduler; a page that calls start() directly
       passes nothing and behaves exactly as it always did.

         onResult(word, firstTryCorrect, tries)  once per word, per visit
         onHeard(word, transcript)               on every miss, so the
                                                 teacher can see what the
                                                 recogniser actually heard
         onFinish({right, total})                once per round
         nextRound()                             a fresh word list for
                                                 "Play again", so the
                                                 second round re-weights
                                                 instead of replaying the
                                                 first one's picks

       Reported at the three points a word is actually FINISHED with —
       right, missed twice, or skipped — never on the first miss, so the
       retry doesn't get counted as its own answer. */
    var onResult   = typeof cfg.onResult === "function" ? cfg.onResult : null;
    var onHeard    = typeof cfg.onHeard === "function" ? cfg.onHeard : null;
    var onFinish   = typeof cfg.onFinish === "function" ? cfg.onFinish : null;
    var nextRound  = typeof cfg.nextRound === "function" ? cfg.nextRound : null;
    function report(word, correct, tryCount){
      if(!onResult) return;
      try{ onResult(word, !!correct, tryCount|0); }catch(e){}
    }
    // Every miss, not just the reveal: the first wrong transcript is often
    // the honest one, and the retry is where the student has already been
    // told to slow down.
    function reportHeard(word, text){
      if(!onHeard || !text) return;
      try{ onHeard(word, text); }catch(e){}
    }

    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Say each word out loud. The computer listens and tells you if you're right.<br>Every 5 in a row earns bonus points.",
      words: WORDS,
      theme: theme,
      progress: prog.markup()
    });
    // The Reading view panel is markup the core supplied; the core wires it.
    Core.mountReadingView();

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], missKind = {}, tries = 0, busy = false;

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

    var comeback = Core.comebackStore(comebackKey);
    // One read/write per round rather than one per word — a round is the
    // natural unit here (n counts rounds missed), and it keeps the storage
    // touch off the answer-handling path.
    function persistComeback(){
      if(!mastered.length && !missed.length) return;
      var store = comeback.read();
      // Removals first, then misses. A word can't be both in one round today
      // (a first-try correct answer never reaches `missed`), but if that ever
      // changed the miss is the one that should stick.
      mastered.forEach(function(w){ store = Core.comebackMastered(store, w); });
      comeback.write(Core.comebackMerge(store, missed, Date.now()));
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

    /* ---------------- audio blips ----------------
       Held off the mic for however long the sound will actually play, plus a
       little slack for the speakers and the room, so the game never
       transcribes itself. keepAlive=true: a beep is just a tone, never
       mistaken for a word, so there's no need to tear down an already-running
       recognizer for it — doing that anyway was the main cause of the "say it
       twice" lag, since every restart pays the recognition engine's connect
       delay again. */
    var snd = Core.sounds({ onPlay: function(ms){ holdMic(ms + 180, true); } });

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
    // The word has to come back exactly right to be marked correct — no
    // forgiving near-misses. (wordMatchesCore/isMatchCore still support a
    // more forgiving level for the phonetic-matching internals exercised
    // by tests.html; the game itself just never asks for it.)
    var level = 0;

    /* Homophone groups, where the list carries them. Only the red words do
       — and only they need to: their near-misses are words that sound
       identical ("to"/"two"), while the phonics lists' near-misses are
       minimal pairs ("sled"/"bled") whose difference is the whole exercise. */
    var HOMOPHONES = cfg.homophones || null;

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

    /* The reveal's own highlight: the letters diagnose() blamed, in the
       accent colour, over the top of whatever markup() would have drawn.
       markup() colours the blend being practised — the same colour on
       every word, so it fades into the background. This one moves. */
    function dxMarkup(word, span){
      if(!span) return markup(word);
      var a = Math.max(0, span[0]), b = Math.min(word.length, span[1]);
      if(b <= a) return markup(word);
      return Core.escapeHtml(word.slice(0, a)) +
             '<span class="dx">' + Core.escapeHtml(word.slice(a, b)) + '</span>' +
             Core.escapeHtml(word.slice(b));
    }

    // The written hint read aloud: a colon is a pause, not a word.
    function spokenHint(message){
      return String(message || "").replace(/:\s*/, ", ") + ".";
    }

    function wordMatches(heard, target){
      return wordMatchesCore(heard, target, level, atStart, blendLength, WORDS, soundSeq, HOMOPHONES);
    }

    function isMatch(heardText, target){
      return isMatchCore(heardText, target, level, atStart, blendLength, WORDS, soundSeq, HOMOPHONES);
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
    // The badge under the streak number — only visible once the multiplier
    // is actually doing something, so ×1 shows nothing.
    function renderCombo(){
      var m = comboMultiplier(streak);
      $("uiCombo").textContent = m > 1 ? "×" + m + " combo!" : "";
    }
    function render(){
      var w = queue[idx];
      $("uiWord").innerHTML = markup(w);
      Core.markWordCase($("uiWord"), w);
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      prog.update((idx)/queue.length*100);
      $("wordCard").className = "wordcard";
      $("uiMic").innerHTML = "Say the word out loud";
      $("btnSkip").textContent = "Skip ▸";
    }
    /* ---------------- game flow ---------------- */
    function startGame(list){
      queue = shuffleOn ? shuffled(list) : list.slice();
      idx = 0; score = 0; streak = 0; best = 0; right = 0; missed = []; missKind = {}; mastered = []; tries = 0; busy = false;
      prog.reset();
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
      Core.renderStars($("uiStars"), pct);
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
          /* One word tells you nothing; four words all tagged "vowel" tell
             you what to teach tomorrow. The tag is the same word diagnose()
             used, so the chip and the hint the student saw agree. */
          if(missKind[w]) d.innerHTML += '<span class="kind">' + Core.escapeHtml(KIND_LABEL[missKind[w]] || missKind[w]) + "</span>";
          grid.appendChild(d);
        });
        $("btnRetryMissed").style.display = "";
      } else {
        block.style.display = "none";
        $("btnRetryMissed").style.display = "none";
      }
      if(pct >= 70) Core.confettiBurst($("s-end").querySelector(".card"), pct >= 90 ? 26 : 16);
      snd.win();
      if(onFinish){ try{ onFinish({ right: right, total: queue.length }); }catch(e){} }
    }

    // A one-shot burst of falling confetti pieces on a good finish — pure CSS
    // animation, each piece removes itself once its fall finishes.
    function handleCorrect(){
      busy = true;
      right++;
      streak++;
      // First try, no stumble: the word has earned its way out of the
      // comeback deck. Getting it on the retry (tries > 0) doesn't count.
      if(tries === 0 && mastered.indexOf(queue[idx]) === -1) mastered.push(queue[idx]);
      report(queue[idx], tries === 0, tries);
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
        prog.celebrate();
        Core.popup($("popup"), "🔥 " + streak + " in a row!", "#ffc94d", true);
        Core.confettiBurst($("wordCard"), 18);
        snd.combo();
      } else {
        Core.popup($("popup"), "✓ +" + pts, "#3ddc97");
        snd.good();
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
      Core.popup($("popup"), "✗", "#ff6b6b");
      snd.bad();
      var target = queue[idx];
      var targetChunks = tries >= 2 ? chunksFor(target) : null;
      var heardTxt = normalize(heard);
      reportHeard(target, heardTxt);
      /* Which part went wrong — but only on the reveal. On the first miss
         the student gets the transcript and nothing else: they are about
         to try again, and a hint they haven't asked for yet just slows
         the retry down. */
      var dx = tries >= 2 ? Core.diagnose(heard, target, {
        atStart: atStart, blendLength: blendLength,
        soundSeq: soundSeq, highlight: highlightRe
      }) : null;
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
      $("uiMic").innerHTML = msg +
        (heardTxt ? '<br><span class="heard">I heard: ' + Core.escapeHtml(heardTxt) + "</span>"
                  : '<br><span class="heard">I didn\'t catch that</span>') +
        (dx ? '<br><span class="dxmsg">' + Core.escapeHtml(dx.message) + "</span>" : "");
      if(tries >= 2){
        if(dx && !targetChunks) $("uiWord").innerHTML = dxMarkup(target, dx.span);
        if(missed.indexOf(target) === -1) missed.push(target);
        if(dx) missKind[target] = dx.kind;
        report(target, false, tries);
        // Never on the first miss — that stays fast so the retry isn't slowed down.
        if(voiceOn){
          if(targetChunks) sayChunked(targetChunks, target, dx ? spokenHint(dx.message) : null);
          else say("The word was, " + target + ". " + (dx ? spokenHint(dx.message) : ""), { rate: 0.9 });
        }
        // The hint is another sentence to get through, so the reveal holds
        // a little longer — but only when there is a voice saying it.
        setTimeout(function(){ busy = false; next(); }, voiceOn ? (dx ? 3300 : 2600) : 1900);
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

    /* ---------------- speak: the word + the coach ----------------
       The voice itself is picked once for the whole site in game-core.js.
       say() stays here because of what has to happen around an utterance in
       THIS game: the recognizer is stopped first so the computer is never
       transcribed as the student, and the mic is held a beat afterwards to
       let the speakers settle. */
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
        var v = Core.voice();
        if(v) u.voice = v;
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
    function sayChunked(chunks, word, tail){
      if(!window.speechSynthesis) return;
      try{
        window.speechSynthesis.cancel();
        var u1 = new SpeechSynthesisUtterance(chunks.join(", "));
        var u2 = new SpeechSynthesisUtterance(word + (tail ? ". " + tail : ""));
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
        var totalChars = chunks.join(", ").length + word.length + (tail ? tail.length : 0);
        setTimeout(function(){ if(currentUtterance === u2) release(); }, 1200 + 90 * totalChars);
        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
      }catch(e){ speaking = false; }
    }

    /* One native utterance per fragment, queued back to back, rather than
       one string glued together with ". " — each fragment already ends in
       its own punctuation, and separate utterances give a truer pause
       between them than any punctuation would. Generalises sayChunked()
       above; the mic bookkeeping is why this engine can't just use a
       plain say() the way the quiet games do. */
    function sayParts(parts){
      if(!window.speechSynthesis) return;
      parts = (parts || []).filter(function(p){ return p; });
      if(!parts.length) return;
      try{
        window.speechSynthesis.cancel();
        // Core.voice(), not a local `voice`: the branch this came from
        // predates the shared core, and the bare identifier it used no
        // longer exists — which the try/catch below was quietly hiding.
        var v = Core.voice();
        var utterances = parts.map(function(text){
          var u = new SpeechSynthesisUtterance(text);
          u.lang = "en-US";
          if(v) u.voice = v;
          return u;
        });
        var last = utterances[utterances.length - 1];
        currentUtterance = last;
        speaking = true;
        stopListening();
        updateMicUI();
        var release = function(){
          if(currentUtterance !== last) return;   // superseded by a newer say()/sayChunked()/sayParts()
          currentUtterance = null;
          speaking = false;
          holdMic(350);   // let the speakers settle before listening again
        };
        last.onend = release;
        last.onerror = release;
        // Safety net in case onend never fires (Chrome does this sometimes).
        var totalChars = parts.join(" ").length;
        setTimeout(function(){ if(currentUtterance === last) release(); }, 1200 + 90 * totalChars);
        utterances.forEach(function(u){ window.speechSynthesis.speak(u); });
      }catch(e){ speaking = false; }
    }

    // Read from the live DOM (Core.directionParts) rather than a second
    // copy of the strings, so the spoken directions can't drift from the
    // ones on screen.
    function readDirections(){
      sayParts(Core.directionParts($("s-start")));
    }

    /* ---------------- events ---------------- */
    // Greyed out rather than silently dead on a browser that can't speak.
    if(!window.speechSynthesis) $("btnDirections").disabled = true;
    else $("btnDirections").addEventListener("click", readDirections);
    $("btnStart").addEventListener("click", function(){
      pendingList = WORDS;
      snd.click(); startMicCheck();
    });

    $("btnPlay").addEventListener("click", function(){ stopMicCheck(); startGame(pendingList); });
    $("btnBack").addEventListener("click", function(){ stopMicCheck(); show("s-start"); });

    // The count has to be right at the moment the student looks at it, so
    // the deck is rebuilt from storage here rather than cached at load —
    // finish() has usually rewritten the store since the last render.
    function renderComeback(){
      comebackList = Core.comebackDeck(comeback.read(), Core.comebackCap);
      $("btnComeback").style.display = comebackList.length ? "" : "none";
      $("cbCount").textContent = comebackList.length;
    }
    $("btnComeback").addEventListener("click", function(){
      if(!comebackList.length) return;
      pendingList = comebackList.slice();
      snd.click(); startMicCheck();
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
      report(t, false, tries);
      streak = 0; next();
    });
    $("btnQuit").addEventListener("click", function(){
      queue = queue.slice(0, idx);
      finish();
    });
    // With a scheduler attached, "Play again" asks it for a fresh set —
    // the words that were missed a moment ago are now the likeliest picks.
    $("btnAgain").addEventListener("click", function(){
      var list = null;
      if(nextRound){ try{ list = nextRound(); }catch(e){ list = null; } }
      startGame(list && list.length ? list.map(function(e){ return parseWordEntry(e).word; }) : WORDS);
    });
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
      phonemeSpans: phonemeSpans,
      isVowelPhone: isVowelPhone,
      phoneticDistance: phoneticDistance,
      wordMatches: wordMatchesCore,
      isMatch: isMatchCore,
      findPhonemeSeq: findPhonemeSeq,
      comboMultiplier: Core.comboMultiplier,
      pointsFor: Core.pointsFor,
      sanitizeComeback: Core.sanitizeComeback,
      comebackMerge: Core.comebackMerge,
      comebackMastered: Core.comebackMastered,
      comebackDeck: Core.comebackDeck,
      comebackCap: Core.comebackCap,
      parseWordEntry: parseWordEntry
    }
  };
})();
