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

  // What this engine takes from game-core.js. Aliased once here rather than
  // reached through GameCore at every call site, so the code below reads the
  // same as it did when these lived in this file — and so the list of what's
  // shared is in one visible place.
  var Core = window.GameCore;
  var dedupeWords     = Core.dedupeWords,
      sampleWords     = Core.sampleWords,
      shuffled        = Core.shuffled,
      comboMultiplier = Core.comboMultiplier,
      pointsFor       = Core.pointsFor;

  var NORMAL_RATE = 0.95, SLOW_RATE = 0.75;
  var MIX_SIZE = 20;        // cards in the engine's "Mixed" deck

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
    ${cfg.progress}

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

    // A car running a dashed track toward the checkered flag.
    var prog = Core.progress("race");

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read the word out loud, then flip the card to check yourself.",
      note: cfg.note || "",
      hasPicker: CHOICES.length > 1,
      progress: prog.markup()
    });

    /* ---------------- state ---------------- */
    var queue = [], idx = 0, score = 0, streak = 0, best = 0, right = 0;
    var missed = [], mastered = [], flipped = false, busy = false;
    var pending = null;    // the timer that moves on to the next card
    var pendingList = null;   // a one-off list (comeback / missed words) to run instead of the deck
    var deckIdx = 0;

    var $ = function(id){ return document.getElementById(id); };

    /* Outcome reporting — the same optional contract as the other three
       engines, so one scheduler (practice.js) can drive all four. Here
       "correct" is the student's own rating: Got it on the flip. Reported
       once per card, when it's rated or skipped. */
    var onResult  = typeof cfg.onResult === "function" ? cfg.onResult : null;
    var onFinish  = typeof cfg.onFinish === "function" ? cfg.onFinish : null;
    var nextRound = typeof cfg.nextRound === "function" ? cfg.nextRound : null;
    function report(word, correct){
      if(!onResult) return;
      try{ onResult(word, !!correct, 0); }catch(e){}
    }

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
    var snd = Core.sounds();
    var sndFlip = function(){ snd.beep([520,720],0.09); };

    /* ---------------- speech ----------------
       The voice itself is picked once for the whole site in game-core.js;
       what happens around an utterance is the engine's own business, which
       is why say() lives here. */
    function say(text, rate){
      if(!window.speechSynthesis) return;
      try{
        // Cancel first: a student hammering "Hear it again" should hear the
        // newest read immediately, not a queue of stacked-up ones.
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = rate || NORMAL_RATE;
        var v = Core.voice();
        if(v) u.voice = v;
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

    /* ---------------- the persistent comeback deck ----------------
       Keyed by pathname so each flash-card page keeps its own deck, and so a
       deck can never be read by a game with a different word list. */
    var comebackKey = "cardComeback:" + location.pathname;
    var comebackList = [];    // the deck the button will play, built at render time

    var comeback = Core.comebackStore(comebackKey);
    // Mastered words are cleared BEFORE the round's misses are merged in, so
    // a word read right and then missed again later in the same round (only
    // possible in a list that repeats it) ends up correctly still in the deck.
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
      prog.update(idx/queue.length*100);
      renderFace();
      $("btnFlip").focus();
    }

    /* ---------------- game flow ---------------- */
    function startGame(list){
      queue = shuffleOn ? shuffled(list) : list.slice();
      idx = 0; score = 0; streak = 0; best = 0; right = 0;
      missed = []; mastered = []; busy = false;
      prog.reset();
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
      report(word, gotIt);
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
          prog.celebrate();
          Core.popup($("popup"), "🔥 " + streak + " in a row!", "#ffc94d", true);
          Core.confettiBurst($("cardStage"), 18);
          snd.combo();
        } else {
          Core.popup($("popup"), "✓ +" + pts, "#3ddc97");
          snd.good();
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
        Core.popup($("popup"), "✗", "#ff6b6b");
        snd.bad();
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
      if(onFinish){ try{ onFinish({ right: right, total: queue.length }); }catch(e){} }
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
      $("btnPick").style.display = CHOICES.length > 1 ? "" : "none";
      if(pct >= 70) Core.confettiBurst($("s-end").querySelector(".card"), pct >= 90 ? 26 : 16);
      snd.win();
      $("btnAgain").focus();
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
      report(t, false);
      streak = 0;
      next();
    });
    $("btnQuit").addEventListener("click", function(){
      // Only the cards actually seen count toward the round's total, so
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
      dedupeWords: Core.dedupeWords,
      sampleWords: Core.sampleWords,
      comboMultiplier: Core.comboMultiplier,
      pointsFor: Core.pointsFor,
      sanitizeComeback: Core.sanitizeComeback,
      comebackMerge: Core.comebackMerge,
      comebackMastered: Core.comebackMastered,
      comebackDeck: Core.comebackDeck,
      comebackCap: Core.comebackCap,
      mixSize: MIX_SIZE
    }
  };
})();
