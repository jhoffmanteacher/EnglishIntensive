/* Engine for "Blend it" — hear the sounds, say the word.
 *
 * Every other mode on this site starts from letters. This one starts from
 * SOUND, and it is the only one that can: a synthesiser asked for an
 * isolated /b/ says "buh", and a word sounded out as "buh-a-tuh" does not
 * blend into "bat". A student who has been taught that way has been doing
 * it faithfully for years and getting a different word every time. The
 * clips in audio/ph/ are the fix — real isolated sounds — and this is the
 * game built on them.
 *
 * The shape is deliberately narrow. The word is never on screen until the
 * student has had their go: they hear /k/ /r/ /a/ /b/ spread out, then the
 * same sounds close together, then they say the word. That is phonological
 * blending with nothing to read off, which is exactly the sub-skill the
 * printed lists cannot ask about.
 *
 *   BlendItGame.start({
 *     title: "Nonsense Words 🔊",
 *     words: ["jag","baz", …],
 *     phonetic: true      // made-up words: judge by sound, not spelling
 *   });
 *
 * Without audio/ph/manifest.json there is no game here at all, and the
 * start screen says so rather than playing silence at a student.
 */
window.BlendItGame = (function(){
  "use strict";

  var Core = window.GameCore;
  var shuffled        = Core.shuffled,
      comboMultiplier = Core.comboMultiplier,
      pointsFor       = Core.pointsFor;

  var SLOW_GAP = 700;    // sounds apart: this is a /k/, this is a /r/
  var FAST_GAP = 250;    // sounds together: now hear the word
  var MIC_SETTLE = 350;  // let the speakers stop before listening again

  var MIC_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/>' +
      '<path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z"/>' +
    '</svg>';

  var STYLE_ID = "blend-it-style";
  var STYLE = `
  .note{background:var(--panel2);border:1px solid var(--line);border-left:5px solid var(--accent);
    border-radius:16px;padding:16px 20px;margin:0 0 22px;font-size:17px;line-height:1.65}
  .note .tag{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--accent);font-weight:800;margin-bottom:8px}
  .note b{color:var(--accent)}
  .note p{margin:0}
  .note p + p{margin-top:8px}

  /* ---- the sound dots ----
     One dot per sound, lighting up as it plays. The student can't see the
     word, so this is the only thing telling them how many sounds are
     coming — and "four sounds" is itself a useful thing to know before
     you try to blend them. */
  .dots{display:flex;justify-content:center;gap:14px;margin:10px 0 26px;min-height:26px}
  .dot{
    width:20px;height:20px;border-radius:50%;
    background:var(--panel2);border:2px solid var(--line);
    transition:transform .12s ease, background .12s ease, border-color .12s ease;
  }
  .dot.on{background:var(--accent);border-color:var(--accent);transform:scale(1.35)}
  .dot.done{background:var(--line);border-color:var(--line)}

  /* The word, hidden until the reveal. The letters light in the order the
     sounds play, so the student sees WHICH letters made the sound they
     just heard — the join between the two halves of decoding. */
  .revealword{
    font-size:clamp(46px,12vw,110px);font-weight:800;letter-spacing:3px;
    line-height:1.05;margin:6px 0 4px;min-height:1.1em;color:var(--muted);
  }
  .revealword .ph{transition:color .12s ease}
  .revealword .ph.lit{color:var(--accent)}
  .revealword.shown{color:var(--ink)}
  `;

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
        <li>Put on <b>headphones with a mic</b>.</li>
        <li>Click <b>Allow</b> so Chrome can use your microphone.</li>
        <li>You hear the sounds <b>one at a time</b>, then <b>run together</b>.</li>
        <li>Say the <b>whole word</b> out loud. The word itself stays hidden until you've tried.</li>
      </ol>
      ${window.GameCore.readingViewButton()}
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start</button>
      </div>
    </div>
  </section>

  <!-- Copied from blend-game.js. What is worth having twice is the
       ordering: the permission prompt happens before the first word. -->
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
      <div class="stat"><div class="lbl">Word</div><div class="val" id="uiCount">1/1</div></div>
    </div>
    ${cfg.progress}

    <div class="wordcard" id="wordCard">
      <div class="popup" id="popup"></div>
      <div class="hint" id="uiHint">Listen</div>
      <div class="dots" id="uiDots"></div>
      <div class="revealword" id="uiWord"></div>
      <div class="micwrap">
        <button class="mic" id="btnMic" aria-label="Mute or unmute the microphone">${MIC_SVG}</button>
        <div class="keyhint" id="uiMicState" role="status">Listening…</div>
      </div>
      <div class="miclabel" id="uiMic" aria-live="polite">Wait for the sounds.</div>
    </div>

    <div class="toolbar">
      <button class="btn ghost" id="btnHear">🔊 Sounds again <span class="kbd">H</span></button>
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
        <div class="stat"><div class="lbl">Blended</div><div class="val" id="uiFRight">0</div></div>
        <div class="stat"><div class="lbl">Best streak</div><div class="val flame" id="uiFStreak">0</div></div>
      </div>
      <div id="missBlock" style="display:none">
        <h3>Words to blend again</h3>
        <div class="grid" id="uiMissed"></div>
      </div>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnAgain">Play Again</button>
        <a class="btn ghost" href="index.html">Home</a>
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    var WORDS = (cfg.words || []).map(function(e){ return Core.parseEntry(e).word; });
    var MATCH_OPTS = { homophones: cfg.homophones || null, phonetic: !!cfg.phonetic };
    var SPEAK = cfg.speak !== false;   // nonsense words are never said aloud
    var prog = Core.progress(cfg.theme || "race");

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Hear the sounds, then say the word.",
      note: cfg.note || "",
      progress: prog.markup()
    });
    // The Reading view panel is markup the core supplied; the core wires it.
    Core.mountReadingView();

    var $ = function(id){ return document.getElementById(id); };

    var onResult = typeof cfg.onResult === "function" ? cfg.onResult : null;
    var onHeard  = typeof cfg.onHeard  === "function" ? cfg.onHeard  : null;
    var onFinish = typeof cfg.onFinish === "function" ? cfg.onFinish : null;
    var nextRound = typeof cfg.nextRound === "function" ? cfg.nextRound : null;
    function report(word, correct, tries){
      if(!onResult) return;
      try{ onResult(word, !!correct, tries|0); }catch(e){}
    }
    function reportHeard(word, text){
      if(!onHeard || !text) return;
      try{ onHeard(word, text); }catch(e){}
    }

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], tries = 0, busy = true, playing = false;
    var audio = null;                 // the clip player, or null
    var snd = Core.sounds({ onPlay: function(ms){ holdMic(ms + 120); } });

    /* ---------------- the sounds ---------------- */
    function spansOf(word){ return Core.phonemeSpans(word); }

    function renderDots(n){
      var box = $("uiDots");
      box.innerHTML = "";
      for(var i=0;i<n;i++){
        var d = document.createElement("span");
        d.className = "dot";
        d.id = "dot" + i;
        box.appendChild(d);
      }
    }

    function litDot(i, state){
      for(var k=0;k<40;k++){
        var d = $("dot" + k);
        if(!d) break;
        d.classList.remove("on");
        if(state === "reset") d.classList.remove("done");
      }
      if(i >= 0){
        var el = $("dot" + i);
        if(el) el.classList.add("on");
        for(var j=0;j<i;j++){ var p = $("dot" + j); if(p) p.classList.add("done"); }
      }
    }

    /* Play one word's sounds, lighting a dot (and, on the reveal, a run
       of letters) as each one goes. The timing is open-loop — the player
       resolves only when the whole run is done — so the highlight is
       driven by the same gap the audio is using rather than by trying to
       observe it. Close enough at these speeds, and it cannot desync
       badly because both are restarted for every word. */
    function playSounds(word, gap, showLetters){
      if(!audio) return Promise.resolve(false);
      var spans = spansOf(word);
      var tokens = spans.map(function(s){ return s.ph; });
      litDot(-1, "reset");
      var step = 0;
      var timer = setInterval(function(){
        if(step >= spans.length){ clearInterval(timer); litDot(-1); return; }
        litDot(step);
        if(showLetters) litLetters(word, spans, step);
        step++;
      }, 260 + gap);
      litDot(0);
      if(showLetters) litLetters(word, spans, 0);
      step = 1;
      holdMic(audio.estimate(tokens, gap));
      return audio.play(tokens, gap).then(function(ok){
        clearInterval(timer);
        litDot(-1);
        if(showLetters) litLetters(word, spans, -1);
        holdMic(MIC_SETTLE);
        return ok;
      });
    }

    // The letters behind the sound currently playing. phonemeSpans is what
    // makes this possible: every sound knows which letters spell it.
    function litLetters(word, spans, at){
      var html = "", i;
      for(i=0;i<spans.length;i++){
        var text = word.slice(spans[i].start, spans[i].end);
        html += '<span class="ph' + (i === at ? " lit" : "") + '">' + Core.escapeHtml(text) + "</span>";
      }
      $("uiWord").innerHTML = html;
    }

    /* The whole prompt: sounds apart, then sounds together, then over to
       the student. Two passes because they are two different questions —
       "what are these sounds" and "what word do they make". */
    function promptWord(){
      busy = true;
      $("uiHint").textContent = "Listen";
      $("uiMic").textContent = "Sounds, one at a time…";
      $("uiWord").innerHTML = "";
      var word = queue[idx];
      renderDots(spansOf(word).length);
      return playSounds(word, SLOW_GAP, false).then(function(){
        if(!playingNow()) return false;
        $("uiMic").textContent = "…and again, together.";
        return playSounds(word, FAST_GAP, false);
      }).then(function(){
        if(!playingNow()) return false;
        $("uiHint").textContent = "Say the word";
        $("uiMic").textContent = "Say the whole word out loud.";
        busy = false;
        armMic();
        return true;
      });
    }

    function playingNow(){ return $("s-play").classList.contains("on"); }

    /* ---------------- game flow ---------------- */
    function render(){
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      prog.update(idx / queue.length * 100);
      $("wordCard").className = "wordcard";
      $("uiWord").className = "revealword";
      promptWord();
    }

    function renderCombo(){
      var m = comboMultiplier(streak);
      $("uiCombo").textContent = m > 1 ? "×" + m + " combo!" : "";
    }

    function startGame(list){
      queue = shuffled(list.map(function(e){ return Core.parseEntry(e).word; }));
      idx = 0; score = 0; streak = 0; best = 0; right = 0; missed = []; tries = 0;
      prog.reset();
      micOn = !!SR;
      show("s-play");
      render();
      startMicLoop();
    }

    function next(){
      tries = 0;
      idx++;
      if(idx >= queue.length){ finish(); return; }
      render();
    }

    function handleRight(){
      busy = true;
      right++;
      streak++;
      if(streak > best) best = streak;
      var pts = pointsFor(streak);
      var mult = comboMultiplier(streak);
      var milestone = streak % 5 === 0;
      score += pts;
      if(tries === 0) report(queue[idx], true, 0);
      else report(queue[idx], false, tries);
      $("wordCard").className = "wordcard correct";
      $("uiWord").className = "revealword shown";
      $("uiWord").textContent = queue[idx];
      $("uiMic").innerHTML = "<b>Yes — " + Core.escapeHtml(queue[idx]) + "</b>";
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      if(milestone){
        prog.celebrate();
        Core.popup($("popup"), "🔥 " + streak + " in a row!", "#ffc94d", true);
        Core.confettiBurst($("wordCard"), 18);
        snd.combo();
      } else {
        Core.popup($("popup"), "✓ +" + pts, "#3ddc97");
        snd.good();
      }
      setTimeout(function(){ busy = false; next(); }, 1200);
    }

    function handleWrong(heardText){
      busy = true;
      streak = 0;
      $("uiStreak").textContent = 0;
      renderCombo();
      tries++;
      var word = queue[idx];
      var said = Core.normalize(heardText);
      reportHeard(word, said);
      $("wordCard").className = "wordcard wrong";
      Core.popup($("popup"), "✗", "#ff6b6b");
      snd.bad();

      if(tries < 2){
        $("uiMic").innerHTML = "Not that one — listen again." +
          (said ? '<br><span class="heard">I heard: ' + Core.escapeHtml(said) + "</span>" : "");
        setTimeout(function(){
          if(!playingNow()) return;
          $("wordCard").className = "wordcard";
          promptWord();
        }, 1100);
        return;
      }

      /* The reveal. The sounds one more time, and this time the letters
         light with them — which is the join the whole game exists to
         make: THAT sound is spelled by THOSE letters. */
      if(missed.indexOf(word) === -1) missed.push(word);
      report(word, false, tries);
      $("uiHint").textContent = "The word was";
      $("uiMic").innerHTML = (said ? '<span class="heard">I heard: ' + Core.escapeHtml(said) + "</span>" : "") ;
      $("uiWord").className = "revealword shown";
      playSounds(word, SLOW_GAP, true).then(function(){
        if(!playingNow()) return;
        $("uiWord").textContent = word;
        // Nothing to say for a made-up word: a synthesiser handed "vab"
        // guesses, and it guesses "verb".
        if(SPEAK) say(word, 0.85);
        setTimeout(function(){ busy = false; next(); }, SPEAK ? 1500 : 900);
      });
    }

    function finish(){
      micOn = false;
      stopMicLoop();
      stopListening();
      show("s-end");
      $("uiFScore").textContent = score;
      $("uiFRight").textContent = right + "/" + queue.length;
      $("uiFStreak").textContent = best;
      var pctv = queue.length ? Math.round(right/queue.length*100) : 0;
      $("uiTitle").textContent = pctv >= 90 ? "You can hear it! 🏆"
                               : pctv >= 70 ? "Nice work! 🎉"
                               : "Good practice! 💪";
      $("uiSummary").textContent = "You blended " + right + " of " + queue.length + " words (" + pctv + "%).";
      Core.renderStars($("uiStars"), pctv);
      var block = $("missBlock"), grid = $("uiMissed");
      grid.innerHTML = "";
      if(missed.length){
        block.style.display = "block";
        missed.forEach(function(w){
          var b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.textContent = w;
          Core.markWordCase(b, w);
          // The chips are playable: the point of the takeaway list is the
          // sounds, not the spelling.
          b.addEventListener("click", function(){ if(audio) audio.play(Core.phonemes(w), SLOW_GAP); });
          grid.appendChild(b);
        });
      } else {
        block.style.display = "none";
      }
      if(pctv >= 70) Core.confettiBurst($("s-end").querySelector(".card"), pctv >= 90 ? 26 : 16);
      snd.win();
      if(onFinish){ try{ onFinish({ right: right, total: queue.length }); }catch(e){} }
      $("btnAgain").focus();
    }

    /* ---------------- the microphone ----------------
       Copied from blend-game.js and cut down. Same principle — the mic is
       always on and only goes quiet while the page is making sound — but
       here the page makes sound on every single word, so the hold is the
       normal state rather than the exception. */
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = null, listening = false, micOn = false, restartOnEnd = false;
    var holdUntil = 0, loopTimer = null, restartTimer = null, rearmTimer = null;
    var speaking = false;

    function now(){ return Date.now(); }
    function audioBusy(){ return speaking || now() < holdUntil; }

    function holdMic(ms){
      var until = now() + (ms || 0);
      if(until > holdUntil) holdUntil = until;
      stopListening();
      updateMicUI();
      if(rearmTimer) clearTimeout(rearmTimer);
      rearmTimer = setTimeout(function(){ rearmTimer = null; armMic(); }, (ms || 0) + 20);
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
        s.textContent = "Listening — say the word";
      } else {
        b.classList.add("paused");
        s.textContent = audioBusy() ? "Mic paused while the sounds play…" : "Mic is on";
      }
    }

    function stopListening(){
      restartOnEnd = false;
      if(restartTimer){ clearTimeout(restartTimer); restartTimer = null; }
      if(rearmTimer){ clearTimeout(rearmTimer); rearmTimer = null; }
      if(rec){ try{ rec.onresult = rec.onerror = rec.onend = null; rec.abort(); }catch(e){} rec = null; }
      listening = false;
    }

    function armMic(){
      if(!SR || !micOn || listening || busy) return;
      if(!playingNow() || audioBusy()) return;
      try{ rec = new SR(); }
      catch(e){ micOn = false; updateMicUI(); return; }
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      restartOnEnd = true;

      rec.onresult = function(ev){
        if(busy) return;
        var lastFinal = null, i, j, r;
        for(i = ev.resultIndex; i < ev.results.length; i++){
          r = ev.results[i];
          for(j = 0; j < r.length; j++){
            if(Core.spokenMatch(r[j].transcript, queue[idx], MATCH_OPTS)){
              stopListening();
              handleRight();
              return;
            }
          }
          if(r.isFinal) lastFinal = r[0].transcript;
        }
        // Only a FINAL result that matched nothing is a miss. Silence
        // never costs a try; the mic is open the whole time.
        if(lastFinal !== null && Core.normalize(lastFinal)){
          stopListening();
          handleWrong(lastFinal);
        }
      };

      rec.onerror = function(ev){
        var err = ev && ev.error;
        if(err === "not-allowed" || err === "service-not-allowed"){
          micOn = false; stopListening();
          $("uiMic").innerHTML = "<b>Microphone blocked.</b> Click the 🎤 or 🔒 icon in the address bar and allow the mic, then reload.";
        } else if(err === "network"){
          micOn = false; stopListening();
          $("uiMic").innerHTML = "<b>No connection.</b> Speech needs the internet. Check wifi and reload.";
        }
        updateMicUI();
      };

      rec.onend = function(){
        listening = false; rec = null;
        updateMicUI();
        if(restartOnEnd && micOn){
          restartTimer = setTimeout(function(){ restartTimer = null; armMic(); }, 200);
        }
      };

      try{ rec.start(); listening = true; }
      catch(e){ listening = false; rec = null; }
      updateMicUI();
    }

    function startMicLoop(){
      if(loopTimer) return;
      loopTimer = setInterval(function(){
        if(!micOn || busy) return;
        if(!listening && !audioBusy() && playingNow()) armMic();
        updateMicUI();
      }, 700);
    }
    function stopMicLoop(){ if(loopTimer){ clearInterval(loopTimer); loopTimer = null; } }

    function say(text, rate){
      if(!window.speechSynthesis) return;
      try{
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = rate || 0.9;
        var v = Core.voice();
        if(v) u.voice = v;
        speaking = true;
        stopListening();
        updateMicUI();
        var release = function(){ speaking = false; holdMic(MIC_SETTLE); };
        u.onend = release;
        u.onerror = release;
        setTimeout(function(){ if(speaking) release(); }, 1200 + 90 * text.length);
        window.speechSynthesis.speak(u);
      }catch(e){ speaking = false; }
    }

    function sayParts(parts){
      if(!window.speechSynthesis) return;
      parts = (parts || []).filter(function(p){ return p; });
      if(!parts.length) return;
      try{
        window.speechSynthesis.cancel();
        var v = Core.voice();
        parts.forEach(function(text){
          var u = new SpeechSynthesisUtterance(text);
          u.lang = "en-US";
          if(v) u.voice = v;
          window.speechSynthesis.speak(u);
        });
      }catch(e){}
    }

    /* ---------------- mic check + level meter ----------------
       Copied from blend-game.js; see the note there. */
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
      var pctv = Math.min(100, Math.pow(Math.min(rms,0.35)/0.35, 0.6) * 100);
      meterPeak = Math.max(pctv, meterPeak - 1.6);
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
        meterSrc.connect(analyser);
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
        $("btnPlay").disabled = false;
      });
    }

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

    /* ---------------- screens and events ---------------- */
    function show(id){
      ["s-start","s-check","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
    }

    if(!SR){
      var warn = $("compatWarn");
      warn.style.display = "block";
      warn.innerHTML = "<b>This browser can't listen.</b> Open this page in <b>Google Chrome</b> on the Chromebook. " +
                       "Speech recognition needs Chrome and an internet connection.";
      $("btnStart").disabled = true;
    }

    /* No clips, no game. Saying so is the only honest option: the
       alternative is a start button that leads to a screen of silent
       dots, which a student would read as their own headphones failing. */
    $("btnStart").disabled = true;
    Core.phonemeAudio().then(function(player){
      audio = player;
      if(!player){
        var w = $("compatWarn");
        w.style.display = "block";
        w.innerHTML = "<b>The sound files are missing.</b> This game plays real recorded sounds " +
                      "(audio/ph/), and they aren't on the server. Every other game still works.";
        return;
      }
      if(SR) $("btnStart").disabled = false;
    });

    if(!window.speechSynthesis) $("btnDirections").disabled = true;
    else $("btnDirections").addEventListener("click", function(){ sayParts(Core.directionParts($("s-start"))); });

    $("btnStart").addEventListener("click", function(){ snd.click(); startMicCheck(); });
    $("btnBack").addEventListener("click", function(){ stopMicCheck(); show("s-start"); });
    $("btnPlay").addEventListener("click", function(){ stopMicCheck(); startGame(WORDS); });
    $("btnHear").addEventListener("click", function(){
      if(!playingNow()) return;
      playSounds(queue[idx], SLOW_GAP, false);
    });
    $("btnSkip").addEventListener("click", function(){
      if(busy || !playingNow()) return;
      var w = queue[idx];
      if(missed.indexOf(w) === -1) missed.push(w);
      report(w, false, tries);
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      queue = queue.slice(0, idx);
      finish();
    });
    $("btnMic").addEventListener("click", function(){
      micOn = !micOn;
      if(!micOn) stopListening(); else armMic();
      updateMicUI();
    });
    $("btnAgain").addEventListener("click", function(){
      var list = null;
      if(nextRound){ try{ list = nextRound(); }catch(e){ list = null; } }
      startGame(list && list.length ? list : WORDS);
    });

    document.addEventListener("keydown", function(e){
      if(!playingNow()) return;
      if(e.target && e.target.tagName === "BUTTON") return;
      if(e.key === "h" || e.key === "H"){ e.preventDefault(); playSounds(queue[idx], SLOW_GAP, false); }
      else if(e.key === " "){ e.preventDefault(); micOn = !micOn; if(!micOn) stopListening(); else armMic(); updateMicUI(); }
    });

    window.addEventListener("beforeunload", function(){
      micOn = false;
      stopMicLoop(); stopListening(); stopMicCheck();
      if(audio) audio.cancel();
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    });
  }

  return { start: start };
})();
