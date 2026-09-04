/* Shared engine for the "type the word you hear" spelling games.
 *
 * The blend games are DECODING practice (the student reads, the computer
 * listens). This is the mirror image — ENCODING practice: the computer says
 * a word and the student spells it. That flips two things:
 *
 *   1. No microphone anywhere. Nothing to allow, nothing to mute, no mic
 *      check screen — which also means it works in a noisy room with only
 *      headphones, where the speech-recognition games struggle.
 *   2. The page supplies a `rule` — a short spelling generalisation shown on
 *      the start screen. Encoding without the rule is just a memory test, so
 *      the micro-lesson is half the game, not decoration.
 *
 *   SpellGame.start({
 *     title: "Spell it: oi / oy ⌨️",
 *     rule:  "<b>oy</b> at the end… <b>oi</b> in the middle…",   // HTML ok
 *     highlight: /oi|oy/i,        // optional — gilds the pattern in the
 *     words: ["coin","annoy", ...]  //          end screen's missed list
 *   });
 *
 * Screens, scoring and the end-of-round summary match blend-game.js exactly
 * so a student moving between the two games sees one scoring system.
 */
window.SpellGame = (function(){
  "use strict";

  // What this engine takes from game-core.js. Aliased once here rather than
  // reached through GameCore at every call site, so the code below reads the
  // same as it did when these lived in this file — and so the list of what's
  // shared is in one visible place.
  var Core = window.GameCore;
  var shuffled        = Core.shuffled,
      escapeHtml      = Core.escapeHtml,
      comboMultiplier = Core.comboMultiplier,
      pointsFor       = Core.pointsFor;

  // Speaking rates. The first read is close to natural — a distorted word is
  // harder to spell, not easier. The slow read is only for repeats and
  // misses, and stops short of the range where the synthesiser starts
  // smearing the vowel it is trying to demonstrate.
  var NORMAL_RATE = 0.95, SLOW_RATE = 0.75;

  /* ---------------- answer checking (pure, testable) ----------------
     Spelling is the skill being assessed, so the comparison is deliberately
     strict about LETTERS and forgiving about everything else: case, stray
     spaces, a trailing period, and the curly apostrophe a Chromebook
     substitutes are all typing noise rather than spelling errors. */
  function normalizeAnswer(s){
    return String(s === null || s === undefined ? "" : s)
      .toLowerCase()
      .replace(/[‘’ʼ]/g, "'")   // smart quotes -> plain
      .replace(/[^a-z']/g, "");                // spaces, digits, punctuation
  }

  function isCorrect(typed, target){
    var a = normalizeAnswer(typed);
    return a.length > 0 && a === normalizeAnswer(target);
  }

  // Aligns what the student typed against the correct spelling so the reveal
  // can show WHICH letters went wrong instead of just flashing the answer.
  // Plain Levenshtein with a backtrace; the result is one entry per letter of
  // the TARGET, ok:false wherever the student didn't actually produce that
  // letter in that position relative to the rest of the word. Extra letters
  // they typed have no slot in the correct spelling — their raw attempt is
  // echoed underneath the reveal, so nothing is lost.
  //
  // A word can come back all-ok and still have been wrong ("coinn" contains
  // every letter of "coin" in order); the echo covers that case too.
  function diffLetters(typed, target){
    var a = normalizeAnswer(typed), b = normalizeAnswer(target);
    var m = a.length, n = b.length, i, j;
    var d = [];
    for(i=0;i<=m;i++){ d[i] = [i]; }
    for(j=0;j<=n;j++){ d[0][j] = j; }
    for(i=1;i<=m;i++){
      for(j=1;j<=n;j++){
        var cost = a.charAt(i-1) === b.charAt(j-1) ? 0 : 1;
        d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost);
      }
    }
    var out = [];
    i = m; j = n;
    while(j > 0){
      var same = i > 0 && a.charAt(i-1) === b.charAt(j-1);
      if(i > 0 && d[i][j] === d[i-1][j-1] + (same ? 0 : 1)){
        out.unshift({ ch: b.charAt(j-1), ok: same });
        i--; j--;
      } else if(i > 0 && d[i][j] === d[i-1][j] + 1){
        i--;                                             // a letter they added
      } else {
        out.unshift({ ch: b.charAt(j-1), ok: false });   // a letter they dropped
        j--;
      }
    }
    return out;
  }

  /* ---------------- styles ----------------
     Everything this game needs beyond blend-game.css is the answer box, the
     big typed echo and the rule panel — a handful of rules. They ship inside
     the engine instead of a spell-game.css so a game page stays two
     stylesheets and one script, and so the engine can never be loaded
     without them. */
  var STYLE_ID = "spell-game-style";
  var STYLE = `
  /* the micro-lesson panel on the start screen */
  .rule{background:var(--panel2);border:1px solid var(--line);border-left:5px solid var(--accent);
    border-radius:16px;padding:16px 20px;margin:0 0 22px;font-size:17px;line-height:1.65}
  .rule .tag{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--accent);font-weight:800;margin-bottom:8px}
  .rule b{color:var(--accent)}
  .rule ul{margin:8px 0 0;padding-left:20px}
  .rule li{margin:5px 0}
  .rule .tip{margin:10px 0 0;color:var(--muted);font-size:16px}

  /* The big slot on the word card echoes what the student is typing, then
     becomes the reveal after a second miss. Smaller than the blend games'
     .word — this one has to hold a 7-letter word plus letter-spacing. */
  .word.typed{font-size:clamp(38px,10vw,88px);letter-spacing:8px;
    min-height:1.15em;word-break:break-all}
  .word .ghost{color:var(--muted);opacity:.55;letter-spacing:0}
  /* Letters the student missed are gold, not red: they are the CORRECT
     letters to look at, and red would read as "these are wrong". */
  .word .fix{color:var(--accent);text-decoration:underline;
    text-decoration-thickness:5px;text-underline-offset:10px}

  .spellform{display:flex;gap:10px;justify-content:center;align-items:center;
    flex-wrap:wrap;margin-top:10px}
  .spellinput{
    font-family:inherit;font-size:28px;font-weight:700;letter-spacing:3px;text-align:center;
    width:min(340px,78%);padding:14px 18px;border-radius:16px;
    background:var(--bg);color:var(--ink);border:2px solid var(--line);outline:none;
    transition:border-color .15s ease;
  }
  .spellinput:focus{border-color:var(--accent)}
  .spellinput:disabled{opacity:.55}
  .wordcard.wrong .spellinput{border-color:var(--bad)}
  .wordcard.correct .spellinput{border-color:var(--good)}
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
      <div class="rule">
        <div class="tag">The rule</div>
        ${cfg.rule}
      </div>
      <button class="btn ghost" id="btnDirections" type="button" style="margin-bottom:16px">🔊 Read directions aloud</button>
      <ol class="steps">
        <li>Put on your <b>headphones</b>.</li>
        <li>${cfg.hasSentences
          ? "Listen to the word and the sentence. Click <b>🔊 Say it again</b> to hear just the word — click it twice for a slower read."
          : "Listen to the word. Click <b>🔊 Say it again</b> to hear it again — click it twice for a slower read."}</li>
        <li><b>Type</b> the word, then press <kbd>Enter</kbd>.</li>
        <li>Every 5 right in a row is bonus points.</li>
      </ol>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start Game</button>
        <button class="btn ghost" id="btnShuffle">Shuffle: <span id="shufLbl">On</span></button>
      </div>
    </div>
  </section>

  <section id="s-play" class="screen">
    <div class="hud">
      <div class="stat"><div class="lbl">Score</div><div class="val" id="uiScore">0</div></div>
      <div class="stat"><div class="lbl">Streak</div><div class="val flame" id="uiStreak">0</div><div class="combo" id="uiCombo"></div></div>
      <div class="stat"><div class="lbl">Word</div><div class="val" id="uiCount">1/${cfg.count}</div></div>
    </div>
    ${cfg.progress}

    <div class="wordcard" id="wordCard">
      <div class="popup" id="popup"></div>
      <div class="hint" id="uiHint">Type the word you hear</div>
      <div class="word typed" id="uiWord"><span class="ghost">🔊</span></div>
      <form class="spellform" id="spellForm" autocomplete="off">
        <input class="spellinput" id="uiInput" type="text" inputmode="text"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               aria-label="Type the word you hear">
        <button class="btn" id="btnCheck" type="submit">Check</button>
      </form>
      <div class="miclabel" id="uiMsg" aria-live="polite">Listen, then type it.</div>
      <div class="keyhint">Press <kbd>Enter</kbd> to check — or with the box empty, to hear the word again.</div>
    </div>

    <div class="toolbar">
      <button class="btn ghost" id="btnHear" type="button">🔊 Say it again</button>
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
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    var WORDS = cfg.words;
    var highlightRe = cfg.highlight || null;
    // Optional word -> context sentence map for the spelling-bee read.
    // Words without an entry just get the plain word — no error, less help.
    var SENTENCES = cfg.sentences || {};

    /* Outcome reporting — identical contract to blend-game.js, so one
       scheduler can drive both engines. Reported once per word, at the
       point it's finished with: right, missed twice, or skipped. */
    var onResult  = typeof cfg.onResult === "function" ? cfg.onResult : null;
    var onFinish  = typeof cfg.onFinish === "function" ? cfg.onFinish : null;
    var nextRound = typeof cfg.nextRound === "function" ? cfg.nextRound : null;
    function report(word, correct, tryCount){
      if(!onResult) return;
      try{ onResult(word, !!correct, tryCount|0); }catch(e){}
    }

    // A vault run with the spelling game's own icons: a pencil heading for
    // the trophy.
    var prog = Core.progress("maze", { goal: "🏆", runner: "✏️" });

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Listen to the word, then type it.<br>You get two tries. Every 5 right in a row earns bonus points.",
      rule: cfg.rule || "",
      count: WORDS.length,
      hasSentences: Object.keys(SENTENCES).length > 0,
      progress: prog.markup()
    });

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], tries = 0, busy = false;
    var repeats = 0;       // how many times this word has been replayed
    var pending = null;    // the timer that moves on to the next word

    var shuffleOn = true;
    try{
      var savedShuffle = localStorage.getItem("spellShuffle");
      if(savedShuffle !== null) shuffleOn = savedShuffle === "1";
    }catch(e){}

    var $ = function(id){ return document.getElementById(id); };

    /* ---------------- audio blips ---------------- */
    var snd = Core.sounds();

    /* ---------------- speech ----------------
       The voice itself is picked once for the whole site in game-core.js;
       what happens around an utterance is the engine's own business, which
       is why sayParts() lives here. There's no mic-hold bookkeeping in this
       one — nothing is listening. */
    // Each part is [text, rate]. Separate utterances rather than one long
    // string because the synthesiser's gap between utterances is the pause
    // that makes a spelling-bee read parse as word / sentence / word.
    function sayParts(parts){
      if(!window.speechSynthesis) return;
      try{
        // Cancel first: a student hammering "Say it again" should hear the
        // newest read immediately, not a queue of stacked-up ones.
        window.speechSynthesis.cancel();
        parts.forEach(function(p){
          var u = new SpeechSynthesisUtterance(p[0]);
          u.lang = "en-US";
          u.rate = p[1] || NORMAL_RATE;
          var v = Core.voice();
          if(v) u.voice = v;
          window.speechSynthesis.speak(u);
        });
      }catch(e){}
    }
    function say(text, rate){ sayParts([[text, rate]]); }

    // The whole game is this line: the word is only ever spoken, never shown.
    // A lone synthesised word is the hardest possible listening task — no
    // prosody, no context — so the first read runs spelling-bee style:
    // word, the word in a sentence, word again. Replays (withSentence
    // false) are just the word; by then the student has the context and
    // wants the sounds.
    function speakWord(slow, withSentence){
      var w = queue[idx];
      var rate = slow ? SLOW_RATE : NORMAL_RATE;
      var s = withSentence && SENTENCES[w];
      // The sentence always stays at natural rate — slowing a whole
      // sentence drones, and the smearing note on SLOW_RATE applies double.
      if(s) sayParts([[w, rate], [s, NORMAL_RATE], [w, rate]]);
      else say(w, rate);
    }

    /* ---------------- screens ---------------- */
    function show(id){
      ["s-start","s-play","s-end"].forEach(function(s){ $(s).classList.toggle("on", s===id); });
    }
    function playing(){ return $("s-play").classList.contains("on"); }

    // Speech synthesis is in every current Chrome, but a locked-down profile
    // or a stripped browser can still leave it missing — and with no voice
    // there is no game at all, so say so on the start screen rather than
    // letting a student stare at a silent card.
    if(!window.speechSynthesis){
      var w = $("compatWarn");
      w.style.display = "block";
      w.innerHTML = "<b>This browser can't talk.</b> Open this page in <b>Google Chrome</b> on the Chromebook — " +
                    "this game works by reading words out loud.";
      $("btnStart").disabled = true;
    }

    /* ---------------- helpers ---------------- */
    // The end screen's chips can gild the pattern being practised (oi/oy)
    // once the round is over — the same trick the blend games use on the
    // word card, but only ever AFTER the words have been answered.
    function chipMarkup(word){
      if(!highlightRe) return escapeHtml(word);
      var m = highlightRe.exec(word);
      if(!m) return escapeHtml(word);
      return escapeHtml(word.slice(0, m.index)) +
        '<span class="b">' + escapeHtml(m[0]) + '</span>' +
        escapeHtml(word.slice(m.index + m[0].length));
    }

    function focusInput(){
      var el = $("uiInput");
      if(el && !el.disabled) el.focus();
    }

    /* ---------------- render ---------------- */
    function renderCombo(){
      var m = comboMultiplier(streak);
      $("uiCombo").textContent = m > 1 ? "×" + m + " combo!" : "";
    }
    // The big slot mirrors the answer box so the student's spelling is
    // readable from across the room — and so the reveal has somewhere to
    // land that isn't the box they are about to type in again.
    function renderTyped(){
      var v = $("uiInput").value;
      $("uiWord").innerHTML = v ? escapeHtml(v) : '<span class="ghost">🔊</span>';
    }
    function render(){
      var input = $("uiInput");
      input.value = "";
      input.disabled = false;
      $("uiWord").innerHTML = '<span class="ghost">🔊</span>';
      $("uiHint").textContent = "Type the word you hear";
      $("uiScore").textContent = score;
      $("uiStreak").textContent = streak;
      renderCombo();
      $("uiCount").textContent = (idx+1) + "/" + queue.length;
      prog.update(idx/queue.length*100);
      $("wordCard").className = "wordcard";
      $("uiMsg").innerHTML = "Listen, then type it.";
      repeats = 0;
      focusInput();
      speakWord(false, true);
    }
    /* ---------------- game flow ---------------- */
    function startGame(list){
      queue = shuffleOn ? shuffled(list) : list.slice();
      idx = 0; score = 0; streak = 0; best = 0; right = 0; missed = []; tries = 0; busy = false;
      prog.reset();
      show("s-play");
      render();
    }

    // Every "move on" goes through here so an impatient Enter can cut the
    // pause short without ever double-advancing.
    function scheduleNext(ms){
      if(pending) clearTimeout(pending);
      pending = setTimeout(function(){ pending = null; busy = false; next(); }, ms);
    }
    function flushNext(){
      if(!pending) return false;
      clearTimeout(pending); pending = null; busy = false; next();
      return true;
    }

    function next(){
      tries = 0;
      idx++;
      if(idx >= queue.length){ finish(); return; }
      render();
    }

    function finish(){
      if(pending){ clearTimeout(pending); pending = null; }
      busy = false;
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
      show("s-end");
      $("uiFScore").textContent = score;
      $("uiFRight").textContent = right + "/" + queue.length;
      $("uiFStreak").textContent = best;
      var pct = queue.length ? Math.round(right/queue.length*100) : 0;
      var perfect = queue.length > 0 && right === queue.length;
      $("uiTitle").textContent = perfect ? "Perfect round! 🏆"
                               : pct >= 90 ? "Spelling master! 🏆"
                               : pct >= 70 ? "Nice work! 🎉"
                               : "Good practice! 💪";
      $("uiSummary").textContent = "You spelled " + right + " of " + queue.length + " words correctly (" + pct + "%).";

      Core.renderStars($("uiStars"), pct);
      var block = $("missBlock"), grid = $("uiMissed");
      grid.innerHTML = "";
      if(missed.length){
        block.style.display = "block";
        missed.forEach(function(word){
          var d = document.createElement("div");
          d.className = "chip";
          d.innerHTML = chipMarkup(word);
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
      // Enter should keep working without touching the mouse — the round is
      // over, so the obvious next action takes the focus.
      $("btnAgain").focus();
    }

    function handleCorrect(){
      busy = true;
      right++;
      streak++;
      report(queue[idx], tries === 0, tries);
      if(streak > best) best = streak;
      var pts = pointsFor(streak);
      var mult = comboMultiplier(streak);
      var milestone = streak > 0 && streak % 5 === 0;
      score += pts;
      $("uiInput").disabled = true;
      $("wordCard").className = "wordcard correct";
      $("uiHint").textContent = "Spelled it";
      $("uiMsg").innerHTML = "<b>Correct!</b> +" + pts + " points" +
        (mult > 1 ? " <b>(×" + mult + " combo)</b>" : "");
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
      scheduleNext(1100);
    }

    function handleWrong(typedRaw){
      var target = queue[idx];
      streak = 0;
      $("uiStreak").textContent = 0;
      renderCombo();
      tries++;
      $("wordCard").className = "wordcard wrong";
      Core.popup($("popup"), "✗", "#ff6b6b");
      snd.bad();

      if(tries < 2){
        // Nothing is revealed yet — the point of the retry is to listen
        // harder, so the word comes back slower and their attempt stays in
        // the box, selected, ready to be typed over or edited.
        $("uiMsg").innerHTML = "Not quite — listen again.";
        repeats = 2;                // every replay from here on is the slow one
        // A beat of silence first, so the replay doesn't collide with the
        // wrong-answer beep the student is still hearing.
        // The sentence comes back too — a student who misheard the word
        // needs the context again more than anyone.
        setTimeout(function(){ speakWord(true, true); }, 420);
        var input = $("uiInput");
        input.focus();
        input.select();
        setTimeout(function(){
          if($("wordCard").className === "wordcard wrong") $("wordCard").className = "wordcard";
        }, 900);
        return;
      }

      // Second miss: show the spelling, with the letters they didn't produce
      // gilded, and their own attempt underneath so they can see the
      // difference rather than just being handed the answer.
      busy = true;
      $("uiInput").disabled = true;
      if(missed.indexOf(target) === -1) missed.push(target);
      report(target, false, tries);
      var diff = diffLetters(typedRaw, target), gilded = false;
      var parts = diff.map(function(p){
        if(p.ok) return escapeHtml(p.ch);
        gilded = true;
        return '<span class="fix">' + escapeHtml(p.ch) + "</span>";
      });
      $("uiHint").textContent = "The word was";
      $("uiWord").innerHTML = parts.join("");
      var typed = normalizeAnswer(typedRaw);
      // Nothing gets gilded when every correct letter is present in order and
      // the only error was an extra letter ("coinn") — pointing at gold
      // letters that aren't there would just be confusing.
      $("uiMsg").innerHTML = (gilded ? "Watch the gold letters." : "So close — count the letters again.") +
        (typed ? '<br><span class="heard">You typed: ' + escapeHtml(typed) + "</span>" : "");
      say(target, SLOW_RATE);
      scheduleNext(2800);
    }

    function submit(){
      // Mid-feedback, Enter means "get on with it" rather than "check this".
      if(busy){ flushNext(); return; }
      var raw = $("uiInput").value;
      if(!normalizeAnswer(raw)){
        // An empty box is never a wrong answer — it's a student asking to
        // hear the word one more time.
        repeats++;
        speakWord(repeats >= 2);
        return;
      }
      if(isCorrect(raw, queue[idx])) handleCorrect();
      else handleWrong(raw);
    }

    // Reads the intro line, the rule box, and every step on the start
    // screen, in order — pulled live from the DOM (textContent strips the
    // <b>/<kbd> markup for us) so this never drifts out of sync with the
    // visible directions.
    function spokenText(el){
      // Collapse the markup's indentation whitespace to single spaces, and
      // spell out the rule box's "→" arrows — TTS engines either skip the
      // glyph in silence or read it as "right arrow", neither of which
      // parses as "leads to" for a listening student.
      return el.textContent.replace(/\s+/g, " ").replace(/→/g, "leads to").trim();
    }
    // Read from the live DOM (Core.directionParts) rather than a second
    // copy of the strings, and spoken one fragment at a time so the
    // sentence breaks land where they are written.
    function readDirections(){
      sayParts(Core.directionParts($("s-start")).map(function(t){ return [t, NORMAL_RATE]; }));
    }

    /* ---------------- events ---------------- */
    // Greyed out rather than silently dead on a browser that can't speak.
    if(!window.speechSynthesis) $("btnDirections").disabled = true;
    else $("btnDirections").addEventListener("click", readDirections);
    function renderShuffle(){
      $("shufLbl").textContent = shuffleOn ? "On" : "Off";
    }
    $("btnShuffle").addEventListener("click", function(){
      shuffleOn = !shuffleOn;
      try{ localStorage.setItem("spellShuffle", shuffleOn ? "1" : "0"); }catch(e){}
      renderShuffle();
    });
    renderShuffle();

    $("btnStart").addEventListener("click", function(){ snd.click(); startGame(WORDS); });

    $("spellForm").addEventListener("submit", function(e){
      e.preventDefault();
      submit();
    });
    $("uiInput").addEventListener("input", renderTyped);

    // Every toolbar button hands focus straight back to the box, so a
    // student who reaches for the mouse once doesn't have to reach for it
    // again to keep typing.
    $("btnHear").addEventListener("click", function(){
      if(busy) return;
      repeats++;
      speakWord(repeats >= 2);   // second read onward is the slow one
      focusInput();
    });
    $("btnSkip").addEventListener("click", function(){
      if(busy) return;
      var t = queue[idx];
      if(missed.indexOf(t) === -1) missed.push(t);
      report(t, false, tries);
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      queue = queue.slice(0, idx);
      finish();
    });
    // With a scheduler attached, "Play again" asks it for a fresh set.
    $("btnAgain").addEventListener("click", function(){
      var list = null;
      if(nextRound){ try{ list = nextRound(); }catch(e){ list = null; } }
      startGame(list && list.length ? list : WORDS);
    });
    $("btnRetryMissed").addEventListener("click", function(){
      var list = missed.slice();
      if(list.length) startGame(list);
    });

    document.addEventListener("keydown", function(e){
      if(e.key !== "Enter" || !playing()) return;
      // The form already handles Enter in the box, and a focused button
      // handles it natively — stepping in there would submit twice. This
      // only covers focus having drifted somewhere inert (a stray click on
      // the card), where Enter would otherwise do nothing at all.
      if(e.target === $("uiInput")) return;
      if(e.target && e.target.tagName === "BUTTON") return;
      e.preventDefault();
      submit();
      focusInput();
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
      normalizeAnswer: normalizeAnswer,
      isCorrect: isCorrect,
      diffLetters: diffLetters,
      comboMultiplier: Core.comboMultiplier,
      pointsFor: Core.pointsFor
    }
  };
})();
