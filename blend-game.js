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

  var LEVELS = ["Strict","Normal","Forgiving"];
  var LEVEL_NOTES = [
    "Strict — the word has to come back exactly right. Fewest false credits, but the recogniser will sometimes mishear a correct answer.",
    "Normal — the blend must be right, and the rest of the word can be off by one sound. Best for most students.",
    "Forgiving — the blend must still be right, but the rest of the word can be off by two. Use when a student is getting marked wrong on words they said correctly."
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
  // as any other kind of change.
  function phoneticDistance(a, b){
    var m=a.length, n=b.length, i, j, prev=[], cur=[];
    for(j=0;j<=n;j++) prev[j]=j;
    for(i=1;i<=m;i++){
      cur[0]=i;
      for(j=1;j<=n;j++){
        var subCost = a[i-1]===b[j-1] ? 0 : (isVowelPhone(a[i-1]) && isVowelPhone(b[j-1]) ? 0.5 : 1);
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

  // Known-good transcripts the recogniser returns for specific target words,
  // seeded from mishearings actually observed in class — not a guess at
  // every possible mishearing. Accepted at Normal/Forgiving, never Strict.
  // Add more here as they turn up; keep it short and commented.
  var ACCEPT = {
    gasp: ["gas"],     // final consonant dropped
    tent: ["tenth"]    // recogniser adds a trailing "th" sound
  };

  function wordMatchesCore(heard, target, level, atStart, blendLength){
    if(heard === target) return true;
    if(level === 0) return false;                              // Strict: exact only

    if(ACCEPT[target] && ACCEPT[target].indexOf(heard) !== -1) return true;

    // The blend must match exactly in phoneme space — stricter and fairer
    // than a letter check: "krab" now passes for "crab" (K-R = K-R), but
    // "bled" still never passes for "bred" (B-L vs B-R).
    var hBlend = phonemes(blendPart(heard, atStart, blendLength));
    var tBlend = phonemes(blendPart(target, atStart, blendLength));
    if(hBlend.join(" ") !== tBlend.join(" ")) return false;

    // Slice the *whole word's* phonemes rather than re-encoding the
    // leftover letters on their own — otherwise a remainder that happens to
    // end in "e" (e.g. "vest" minus the "st" blend leaves "ve") gets misread
    // as a silent word-final e that was never actually there.
    var hFull = phonemes(heard), tFull = phonemes(target);
    var hRest = atStart ? hFull.slice(hBlend.length) : hFull.slice(0, hFull.length - hBlend.length);
    var tRest = atStart ? tFull.slice(tBlend.length) : tFull.slice(0, tFull.length - tBlend.length);
    var maxDist = level === 1 ? 1 : 2;
    if(phoneticDistance(hRest, tRest) <= maxDist) return true;

    // Forgiving also takes the word with an ending stuck on it ("cropped"
    // for "crop") — but only for initial blends, since a suffix on a final
    // blend destroys the blend itself ("lisped" never passes for "lisp").
    if(atStart && level === 2 && hFull.length >= tFull.length &&
       hFull.slice(0, tFull.length).join(" ") === tFull.join(" ")) return true;

    return false;
  }

  function isMatchCore(heardText, target, level, atStart, blendLength){
    var parts = normalize(heardText).split(" ");
    for(var i=0;i<parts.length;i++){
      if(parts[i] && wordMatchesCore(parts[i], target, level, atStart, blendLength)) return true;
    }
    return false;
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
        <button class="btn ghost" id="btnShuffle">Shuffle: <span id="shufLbl">On</span></button>
        <button class="btn ghost" id="btnLevel">Listening: <span id="lvlLbl">Normal</span></button>
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
      <div class="stat"><div class="lbl">Streak</div><div class="val flame" id="uiStreak">0</div></div>
      <div class="stat"><div class="lbl">Word</div><div class="val" id="uiCount">1/${cfg.words.length}</div></div>
    </div>
    <div class="bar"><i id="uiBar"></i></div>

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
    var WORDS = cfg.words;
    // Whether the blend sits at the front of the word or the back.
    var atStart = cfg.blend !== "end";
    // Number of letters in the blend — 2 for today's games ("bl", "nk"), but
    // kept configurable so a future str/spl/scr game can pass 3 without
    // touching this file.
    var blendLength = cfg.blendLength || 2;

    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read the word out loud. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!",
      words: WORDS
    });

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], tries = 0, busy = false;

    var shuffleOn = true;
    try{
      var savedShuffle = localStorage.getItem("blendShuffle");
      if(savedShuffle !== null) shuffleOn = savedShuffle === "1";
    }catch(e){}

    var voiceOn = true;
    try{
      var savedVoice = localStorage.getItem("blendVoice");
      if(savedVoice !== null) voiceOn = savedVoice !== "0";
    }catch(e){}

    /* mic state: micOn is the session-wide switch (mic stays on once the game
       starts); listening is whether recognition is actually running now. */
    var micOn = false, listening = false, restartOnEnd = false;
    var rec = null, restartTimer = null, tickTimer = null;

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
      holdMic(((freqs.length - 1) * dur * 0.7 + dur) * 1000 + 180);
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
    var sndStart = function(){ beep([520],0.09); };
    var sndWin   = function(){ beep([660,880,1180,1560],0.18); };

    /* ---------------- screens ---------------- */
    function show(id){
      ["s-start","s-check","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
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
    var level = 1;                                   // Normal by default
    try{
      var saved = localStorage.getItem("blendLevel");
      if(saved !== null) level = Math.min(2, Math.max(0, parseInt(saved,10) || 0));
    }catch(e){}

    function blendOf(word){ return atStart ? word.slice(0,blendLength) : word.slice(-blendLength); }

    function markup(word){
      return atStart
        ? '<span class="blend">' + word.slice(0,blendLength) + '</span>' + word.slice(blendLength)
        : word.slice(0, word.length-blendLength) + '<span class="blend">' + word.slice(-blendLength) + '</span>';
    }

    function wordMatches(heard, target){
      return wordMatchesCore(heard, target, level, atStart, blendLength);
    }

    function isMatch(heardText, target){
      return isMatchCore(heardText, target, level, atStart, blendLength);
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
    function render(){
      var w = queue[idx];
      $("uiWord").innerHTML = markup(w);
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      $("uiBar").style.width = ((idx)/queue.length*100) + "%";
      $("wordCard").className = "wordcard";
      $("uiMic").innerHTML = "Say the word out loud";
      $("btnSkip").textContent = "Skip ▸";
      sndStart();
    }
    function popup(txt, color){
      var p = $("popup");
      p.textContent = txt; p.style.color = color;
      p.classList.remove("go"); void p.offsetWidth; p.classList.add("go");
    }

    /* ---------------- game flow ---------------- */
    function startGame(list){
      queue = shuffleOn ? shuffled(list) : list.slice();
      idx = 0; score = 0; streak = 0; best = 0; right = 0; missed = []; tries = 0; busy = false;
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
      show("s-end");
      $("uiFScore").textContent = score;
      $("uiFRight").textContent = right + "/" + queue.length;
      $("uiFStreak").textContent = best;
      var pct = queue.length ? Math.round(right/queue.length*100) : 0;
      $("uiTitle").textContent = pct >= 90 ? "Blend master! 🏆" : pct >= 70 ? "Nice work! 🎉" : "Good practice! 💪";
      $("uiSummary").textContent = "You said " + right + " of " + queue.length + " words correctly (" + pct + "%).";
      var block = $("missBlock"), grid = $("uiMissed");
      grid.innerHTML = "";
      if(missed.length){
        block.style.display = "block";
        missed.forEach(function(w){
          var d = document.createElement("div");
          d.className = "chip";
          d.innerHTML = markup(w).replace(/class="blend"/g,'class="b"');
          grid.appendChild(d);
        });
        $("btnRetryMissed").style.display = "";
      } else {
        block.style.display = "none";
        $("btnRetryMissed").style.display = "none";
      }
      sndWin();
    }

    function handleCorrect(){
      busy = true;
      right++;
      streak++;
      if(streak > best) best = streak;
      var pts = 10 + (streak >= 5 ? 10 : 0);
      var milestone = streak > 0 && streak % 5 === 0;
      if(milestone) pts += 25;
      score += pts;
      $("wordCard").className = "wordcard correct";
      $("uiMic").innerHTML = "<b>Correct!</b> +" + pts + " points";
      popup("+" + pts, "#3ddc97");
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      sndGood();
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
      tries++;
      $("wordCard").className = "wordcard wrong";
      sndBad();
      var target = queue[idx];
      var heardTxt = normalize(heard);
      var msg = tries < 2
        ? "Not quite — try once more."
        : "Let's move on. The word was <b>" + target + "</b>.";
      $("uiMic").innerHTML = msg + (heardTxt ? '<br><span class="heard">I heard: ' + heardTxt + "</span>" : '<br><span class="heard">I didn\'t catch that</span>');
      if(tries >= 2){
        if(missed.indexOf(target) === -1) missed.push(target);
        // Never on the first miss — that stays fast so the retry isn't slowed down.
        if(voiceOn) say("The word was, " + target + ".", { rate: 0.85 });
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

    function holdMic(ms){
      var until = now() + ms;
      if(until > holdUntil) holdUntil = until;
      stopListening();
      updateMicUI();
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
      rec.maxAlternatives = 10;
      rec.continuous = true;

      listening = true;
      restartOnEnd = true;

      rec.onresult = function(ev){
        if(busy) return;
        var target = queue[idx], lastFinal = null;
        for(var r = ev.resultIndex; r < ev.results.length; r++){
          var res = ev.results[r];
          for(var i=0;i<res.length;i++){
            var alt = res[i];
            if(!isMatch(alt.transcript, target)) continue;
            // Confidence only ever vetoes a match, and only at Strict —
            // Chrome frequently reports 0/undefined for interim results,
            // which means "no signal", not "low confidence", so it never
            // blocks a match on its own.
            if(level === 0 && alt.confidence > 0 && alt.confidence < 0.35) continue;
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
      tickTimer = setInterval(function(){
        if(micOn && !listening) armMic();
        updateMicUI();
      }, 400);
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
    // one of them so it doesn't always feel canned.
    function praisePhrase(word){
      var options = ["Nice!", "Got it!", "You said it!", "Great reading!", "Yes — " + word + "!", "Perfect!"];
      return options[Math.floor(Math.random() * options.length)];
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
      say(queue[idx], { rate: 0.75 });
    }

    /* ---------------- events ---------------- */
    $("btnStart").addEventListener("click", function(){ beep([440],0.06); startMicCheck(); });
    $("btnPlay").addEventListener("click", function(){ stopMicCheck(); startGame(WORDS); });
    $("btnBack").addEventListener("click", function(){ stopMicCheck(); show("s-start"); });
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
    });
  }

  // _internals exposes the pure, state-free matching helpers for tests.html.
  // Not part of the public game API — don't build games against it.
  return {
    start: start,
    _internals: {
      normalize: normalize,
      phonemes: phonemes,
      isVowelPhone: isVowelPhone,
      phoneticDistance: phoneticDistance,
      wordMatches: wordMatchesCore,
      isMatch: isMatchCore
    }
  };
})();
