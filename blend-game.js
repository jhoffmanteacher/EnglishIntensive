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
    function normalize(s){
      return String(s||"").toLowerCase().replace(/[^a-z' ]/g," ").replace(/\s+/g," ").trim();
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

    function editDistance(a,b){
      var m=a.length, n=b.length, prev=[], cur=[], i, j;
      for(j=0;j<=n;j++) prev[j]=j;
      for(i=1;i<=m;i++){
        cur[0]=i;
        for(j=1;j<=n;j++){
          cur[j] = Math.min(prev[j]+1, cur[j-1]+1,
                            prev[j-1] + (a.charAt(i-1)===b.charAt(j-1) ? 0 : 1));
        }
        for(j=0;j<=n;j++) prev[j]=cur[j];
      }
      return prev[n];
    }

    function wordMatches(heard, target){
      if(heard === target) return true;
      if(level === 0) return false;                          // Strict: exact only
      if(blendOf(heard) !== blendOf(target)) return false;   // blend must be right
      if(editDistance(heard, target) <= (level === 1 ? 1 : 2)) return true;
      // Forgiving also takes the word with an ending stuck on it ("cropped") —
      // but only for initial blends, since a suffix destroys a final one.
      if(atStart && level === 2 && heard.indexOf(target) === 0) return true;
      return false;
    }

    function isMatch(heard, target){
      var parts = normalize(heard).split(" ");
      for(var i=0;i<parts.length;i++){
        if(parts[i] && wordMatches(parts[i], target)) return true;
      }
      return false;
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
      if(streak > 0 && streak % 5 === 0) pts += 25;
      score += pts;
      $("wordCard").className = "wordcard correct";
      $("uiMic").innerHTML = "<b>Correct!</b> +" + pts + " points";
      popup("+" + pts, "#3ddc97");
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      sndGood();
      setTimeout(function(){ busy = false; next(); }, 1150);
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
        setTimeout(function(){ busy = false; next(); }, 1900);
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
            if(isMatch(res[i].transcript, target)){ handleCorrect(); return; }
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

    /* ---------------- speak the word ---------------- */
    function hearIt(){
      if(!window.speechSynthesis) return;
      try{
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(queue[idx]);
        u.lang = "en-US"; u.rate = 0.75;
        speaking = true;
        stopListening();
        updateMicUI();
        var release = function(){
          speaking = false;
          holdMic(350);   // let the speakers settle before listening again
        };
        u.onend = release;
        u.onerror = release;
        // Safety net in case onend never fires (Chrome does this sometimes).
        setTimeout(function(){ if(speaking) release(); }, 4000);
        window.speechSynthesis.speak(u);
      }catch(e){ speaking = false; }
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

  return { start: start };
})();
