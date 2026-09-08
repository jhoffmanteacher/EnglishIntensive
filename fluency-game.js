/* Shared engine for the two fluency games — how FAST, not whether.
 *
 * Every other mode on this site asks whether a student knows a word. This
 * one asks how quickly, which is a different question and the one that
 * goes on being worth asking long after accuracy has stopped moving. A
 * student can be right about "would" every single time and still take
 * three seconds to get there, and a reader who takes three seconds a word
 * cannot read a paragraph — by the end of the sentence the beginning is
 * gone.
 *
 * ONE MINUTE (mode "fluency"): the word list in rows of five, sixty
 * seconds, the deck cycling so a fast reader never runs out. Score:
 * correct words per minute.
 *
 *   FluencyGame.start({
 *     title: "Blend Words ⏱",
 *     words: ["soft","golf", …],
 *     phonetic: true,                  // made-up words only — see spokenMatch
 *     target: 60                       // CWPM worth three stars
 *   });
 *
 * The mic loop here is NOT Say It's. That one is tuned to hold the mic
 * around every beep and utterance in a game that talks back; this one
 * never interrupts, so it can simply listen for the whole run. Copying it
 * was the right call over extracting it: the two have different jobs and
 * the shared part is four lines.
 */
window.FluencyGame = (function(){
  "use strict";

  var Core = window.GameCore;
  var shuffled = Core.shuffled;

  var RUN_MS = 60000;          // the "one minute"
  var ROW = 5;                 // words per row in the one-minute grid
  var DEFAULT_TARGET = 60;     // CWPM worth three stars on real words

  /* ---------------- pure: tokens, alignment, arithmetic ----------------
     Everything in this block is testable without a microphone, which is
     the only way any of it could be tested at all. */

  function tokenize(text){
    return String(text == null ? "" : text).toLowerCase()
      .replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  }

  /* Walk a transcript's tokens against the words still to be read.

     The naive rule — every token answers the current word, right or
     wrong — is wrong in a way that took a while to see. It never stalls,
     which is what it was chosen for, but a single EXTRA token knocks the
     alignment out for the rest of the run: say "um" at word three and
     "um" eats `golf`, then "golf" is judged against `honk`, and every
     word after it reads as wrong. The student never resyncs, because
     they are reading straight down a fixed list. A reader who hesitated
     once ends the minute at nought. Struggling readers hesitate and
     self-correct constantly, which is to say the bug fired hardest on
     exactly the students the measure is for.

     So a token that doesn't match the current word is not automatically
     a misread. Three rules decide, in order:

       1. It matches the word JUST READ — a repeat. Saying a word twice
          is not an error and must never cost the next word.
       2. Joined to the next token it matches the word we are on — the
          recogniser split one word into two ("hubcap" comes back as
          "hub cap"), which is its mistake and not the student's.
       3. One of the next couple of tokens matches the word we are on —
          so this token was noise (a filler, half a self-correction, or a
          compound the recogniser split) and the real read is coming.
          Drop the token, hold the pointer.
       4. Otherwise the student genuinely misread it: mark it wrong and
          move on, exactly as before.

     Rule 3 needs to see NOISE_LOOKAHEAD tokens after this one before it
     can rule the possibility out. Until those arrive the decision is
     held — `pending` — and the caller comes back with a longer
     transcript. `flush` forces a verdict when no more is coming (the
     recogniser finalised): undecided tokens resolve as misreads, so the
     pointer stays honest across the gap between utterances.

     Pure: `matches(token, word)` is injected, and nothing here touches
     the clock or the DOM. */
  var NOISE_LOOKAHEAD = 2;

  function consume(pointer, tokens, words, matches, flush){
    var p = pointer, marks = [], i = 0, pending = null, k, hit, avail;
    while(i < tokens.length && p < words.length){
      var tok = tokens[i];

      if(matches(tok, words[p])){
        marks.push({ index: p, ok: true });
        p++; i++;
        continue;
      }

      // 1. the word they just read, said again
      if(p > 0 && matches(tok, words[p-1])){ i++; continue; }

      // 2. one word the recogniser broke in half
      if(i + 1 < tokens.length && matches(tok + tokens[i+1], words[p])){
        marks.push({ index: p, ok: true });
        p++; i += 2;
        continue;
      }

      // 3. noise, if the real read is within sight
      avail = tokens.length - (i + 1);
      hit = false;
      for(k = 1; k <= Math.min(NOISE_LOOKAHEAD, avail); k++){
        if(matches(tokens[i+k], words[p])){ hit = true; break; }
      }
      if(hit){ i++; continue; }

      // Not enough of the transcript yet to tell noise from a misread.
      if(avail < NOISE_LOOKAHEAD && !flush){ pending = tok; break; }

      // 4. a misread
      marks.push({ index: p, ok: false });
      p++; i++;
    }
    return { pointer: p, marks: marks, pending: pending };
  }

  // Correct words per minute. Rounded, never negative, and 0 rather than
  // Infinity when no time has passed at all.
  function wordsPerMinute(correct, ms){
    var n = Math.max(0, Math.floor(Number(correct) || 0));
    var t = Number(ms) || 0;
    if(t <= 0) return 0;
    return Math.round(n * 60000 / t);
  }

  /* Three stars at the target rate, two at 70 % of it, one at 50 %. The
     same shape as every other end screen's stars, with a rate in place of
     a percentage — a student moving between games sees one scoring
     system, which is the whole reason starsFor exists in the core. */
  function starsForRate(rate, target){
    var t = Number(target) || DEFAULT_TARGET;
    if(rate >= t) return 3;
    if(rate >= t * 0.7) return 2;
    if(rate >= t * 0.5) return 1;
    return 0;
  }

  /* ---------------- styles ----------------
     Ships inside the engine like every other one's, so a game page stays
     two stylesheets and one script. blend-game.css supplies the screens,
     the card, the buttons and the mic meter; only what is new is here. */
  var STYLE_ID = "fluency-game-style";
  var STYLE = `
  .note{background:var(--panel2);border:1px solid var(--line);border-left:5px solid var(--accent);
    border-radius:16px;padding:16px 20px;margin:0 0 22px;font-size:17px;line-height:1.65}
  .note .tag{font-size:12px;letter-spacing:1.5px;text-transform:uppercase;
    color:var(--accent);font-weight:800;margin-bottom:8px}
  .note b{color:var(--accent)}
  .note p{margin:0}
  .note p + p{margin-top:8px}

  /* ---- the clock ----
     A bar, not a number counting down. A number tells a struggling
     reader exactly how long they have left to fail in; a bar tells them
     the same thing without putting it into words. */
  .clock{height:12px;border-radius:99px;background:var(--panel2);border:1px solid var(--line);overflow:hidden;margin:0 0 18px}
  .clock i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--good),var(--accent));
    transition:width .25s linear}
  .clock.low i{background:var(--bad)}

  /* ---- the one-minute grid ----
     Rows of five, because a wall of words is where a struggling reader
     loses their place. The row being read sits still; the ones above it
     scroll away. */
  .wordgrid{
    background:var(--panel);border:1px solid var(--line);border-radius:22px;
    padding:22px 18px;max-height:52vh;overflow:hidden;position:relative;
  }
  .wgrows{transition:transform .3s ease}
  .wgrow{display:grid;grid-template-columns:repeat(5,1fr);gap:6px 10px}
  .wgw{
    font-size:clamp(20px,3.4vw,34px);font-weight:800;letter-spacing:1px;
    padding:8px 4px;border-radius:12px;color:var(--muted);
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  .wgw.now{color:var(--ink);background:var(--panel2);box-shadow:inset 0 0 0 2px var(--accent)}
  .wgw.ok{color:var(--good)}
  .wgw.no{color:var(--bad)}

  .bignum{font-size:clamp(44px,9vw,78px);font-weight:800;line-height:1;letter-spacing:-2px}
  .bignum small{display:block;font-size:15px;font-weight:700;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;margin-top:8px}
  .delta{font-size:19px;font-weight:800;margin-top:10px}
  .delta.up{color:var(--good)}
  .delta.down{color:var(--muted)}
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
        <li>Check the <b>mic meter</b>, then start.</li>
        <li>Read down the rows <b>out loud</b>. You have <b>one minute</b>.</li>
        <li>Don't rush a word you're unsure of. A word read wrong doesn't count.</li>
      </ol>
      ${window.GameCore.readingViewButton()}
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnStart">Start</button>
      </div>
    </div>
  </section>

  <!-- Copied from blend-game.js rather than extracted. The meter is four
       lines of arithmetic over an AnalyserNode; the reason to have it here
       is that the permission prompt happens BEFORE the clock starts, and
       that ordering is the thing worth duplicating. -->
  <section id="s-check" class="screen">
    <div class="card">
      <h1>Mic check 🎙️</h1>
      <p class="sub">Say your name out loud. The bar should jump past the line and turn green.</p>
      <div id="checkWarn" class="warn" style="display:none"></div>
      <div class="meter"><i id="meterFill"></i><span class="mark"></span></div>
      <div class="marklbl"><span class="lo">Quiet</span><span class="at">↑ Loud enough</span><span class="hi">Too loud</span></div>
      <p class="meterMsg" id="meterMsg" aria-live="polite">Waiting for the microphone…</p>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnPlay" disabled>Start Reading</button>
        <button class="btn ghost" id="btnBack">Back</button>
      </div>
    </div>
  </section>

  <section id="s-play" class="screen">
    <div class="hud">
      <div class="stat"><div class="lbl">Read</div><div class="val" id="uiRight">0</div></div>
      <div class="stat"><div class="lbl">Missed</div><div class="val" id="uiWrong">0</div></div>
      <div class="stat"><div class="lbl">Time</div><div class="val" id="uiLeft">—</div></div>
    </div>
    <div class="clock" id="uiClock"><i id="uiClockFill"></i></div>

    <div class="wordgrid" id="uiGrid"><div class="wgrows" id="uiRows"></div></div>

    <div class="keyhint" id="uiState" role="status" style="margin-top:14px">Getting the microphone ready…</div>

    <div class="toolbar">
      <button class="btn ghost" id="btnSkip" type="button">Skip ▸ <span class="kbd">Space</span></button>
      <button class="btn ghost" id="btnDone" type="button">Done</button>
    </div>
  </section>

  <section id="s-end" class="screen">
    <div class="card">
      <div class="stars" id="uiStars" aria-hidden="true"></div>
      <h2 id="uiTitle">Nice work! 🎉</h2>
      <div class="bignum" id="uiRate">0<small>correct words per minute</small></div>
      <div class="delta" id="uiDelta" hidden></div>
      <p class="sub" id="uiSummary" style="margin-top:14px"></p>
      <div class="hud" style="margin-bottom:0">
        <div class="stat"><div class="lbl">Read right</div><div class="val" id="uiFRight">0</div></div>
        <div class="stat"><div class="lbl">Missed</div><div class="val" id="uiFWrong">0</div></div>
        <div class="stat"><div class="lbl">Your best</div><div class="val" id="uiFBest">—</div></div>
      </div>
      <div id="missBlock" style="display:none">
        <h3>Words to look at again</h3>
        <p class="sub" style="font-size:15px;margin:0 0 10px">Click one to hear it.</p>
        <div class="grid" id="uiMissed"></div>
      </div>
      <div class="row" style="margin-top:26px">
        <button class="btn" id="btnAgain">Go again</button>
        <a class="btn ghost" href="index.html" id="btnHome">Home</a>
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    var WORDS = (cfg.words || []).map(function(e){ return Core.parseEntry(e).word; });
    var MATCH_OPTS = { homophones: cfg.homophones || null, phonetic: !!cfg.phonetic };
    var RATE_TARGET = cfg.target || DEFAULT_TARGET;

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read out loud. The computer follows along.",
      note: cfg.note || ""
    });
    // The Reading view panel is markup the core supplied; the core wires it.
    Core.mountReadingView();

    var $ = function(id){ return document.getElementById(id); };

    /* Outcome reporting — the same optional contract the other engines
       have, plus one of this engine's own. onFluency carries the run
       itself (a rate is not a per-word fact and has nowhere else to go);
       onResult still fires per word, so a fluency round teaches the
       scheduler exactly what any other round would. */
    var onResult  = typeof cfg.onResult  === "function" ? cfg.onResult  : null;
    var onFluency = typeof cfg.onFluency === "function" ? cfg.onFluency : null;
    var onFinish  = typeof cfg.onFinish  === "function" ? cfg.onFinish  : null;
    var bestBefore = Number(cfg.best) || 0;
    var lastBefore = Number(cfg.last) || 0;

    function report(word, correct){
      if(!onResult) return;
      try{ onResult(word, !!correct, correct ? 0 : 1); }catch(e){}
    }

    /* ---------------- state ---------------- */
    var queue = [];            // the words on screen, in order
    var pointer = 0;           // how far the reader has got
    var okCount = 0, noCount = 0;
    var missed = [];
    var startedAt = 0, endsAt = 0, running = false;
    var tickTimer = null, seen = {};
    /* Where the run stood before the recogniser's current result was
       first scored, so a revision of it can be undone. See heardResult. */
    var snap = null;

    var snd = Core.sounds({ onPlay: function(){} });

    /* ---------------- the words on screen ---------------- */
    function buildGrid(){
      var rows = $("uiRows");
      rows.innerHTML = "";
      for(var i=0;i<queue.length;i+=ROW){
        var r = document.createElement("div");
        r.className = "wgrow";
        for(var j=i;j<Math.min(i+ROW, queue.length);j++){
          var w = document.createElement("div");
          w.className = "wgw";
          w.id = "wg" + j;
          w.textContent = queue[j];
          Core.markWordCase(w, queue[j]);
          r.appendChild(w);
        }
        rows.appendChild(r);
      }
    }

    function cellOf(i){ return $("wg" + i); }

    function paint(i, cls){
      var el = cellOf(i);
      if(!el) return;
      el.classList.remove("now","ok","no");
      if(cls) el.classList.add(cls);
    }

    function paintPointer(){
      var el = cellOf(pointer);
      if(el) el.classList.add("now");
      scrollTo(pointer);
    }

    // The row being read stays put; the ones above it slide away.
    function scrollTo(i){
      var rowH = 0, rows = $("uiRows");
      if(!rows || !rows.firstChild) return;
      rowH = rows.firstChild.getBoundingClientRect().height;
      var row = Math.floor(i / ROW);
      var keep = Math.max(0, row - 1);
      rows.style.transform = "translateY(" + (-keep * rowH) + "px)";
    }

    /* ---------------- the run ---------------- */
    function begin(){
      queue = deckFor();
      pointer = 0; okCount = 0; noCount = 0; missed = []; seen = {}; snap = null;
      startedAt = 0; endsAt = 0; running = true;
      show("s-play");
      buildGrid();
      paintPointer();
      updateHud();
      $("uiState").textContent = "Listening — start reading.";
      startListening();
      tickTimer = setInterval(tick, 200);
    }

    /* One minute of words, cycling. The deck is the whole list shuffled
       and then repeated: a fast reader must never run out, and a list
       that ran out would score the list's length instead of the student. */
    function deckFor(){
      var base = Core.dedupeWords(WORDS);
      if(!base.length) return [];
      var out = shuffled(base);
      while(out.length < 200) out = out.concat(shuffled(base));
      return out;
    }

    /* The clock starts on the first word actually read, not on the button.
       A student fumbling with headphones for four seconds has not been
       reading for four seconds. */
    function startClock(){
      if(startedAt) return;
      startedAt = Date.now();
      endsAt = startedAt + RUN_MS;
    }

    function elapsed(){ return startedAt ? Date.now() - startedAt : 0; }

    function tick(){
      if(!running) return;
      var left = startedAt ? Math.max(0, endsAt - Date.now()) : RUN_MS;
      $("uiLeft").textContent = Math.ceil(left / 1000) + "s";
      $("uiClockFill").style.width = (left / RUN_MS * 100) + "%";
      $("uiClock").classList.toggle("low", left < 10000);
      if(startedAt && left <= 0) finish();
    }

    function updateHud(){
      $("uiRight").textContent = okCount;
      $("uiWrong").textContent = noCount;
    }

    /* One result from the recogniser, scored.

       The awkward part is that a result is not a fact — it is a guess
       that Chrome keeps revising. "cost" becomes "cast" a beat later,
       and a word already marked wrong on the discarded guess would
       otherwise stand. So every result is scored from a SNAPSHOT of the
       run taken before it was first seen: a revision rolls the run back
       to that snapshot and scores the new transcript from scratch.

       Interims are for the screen and the counters only. Nothing reaches
       the scheduler until the result goes final, because a stat write
       cannot be rolled back and reporting a word wrong on a guess Chrome
       is about to withdraw is worse than reporting it a second late. */
    function heardResult(index, text, isFinal){
      if(!running) return;

      if(!snap || snap.index !== index){
        snap = { index: index, pointer: pointer, ok: okCount, no: noCount, missed: missed.slice() };
      } else {
        // A revision. Undo everything this result did, including the
        // colours it put on the grid, then score it again.
        for(var i = snap.pointer; i <= pointer; i++) paint(i, null);
        pointer = snap.pointer;
        okCount = snap.ok;
        noCount = snap.no;
        missed = snap.missed.slice();
      }

      var res = consume(pointer, tokenize(text), queue, function(tok, word){
        return Core.spokenMatch(tok, word, MATCH_OPTS);
      }, !!isFinal);

      if(res.marks.length) startClock();
      paint(pointer, null);
      res.marks.forEach(function(m){
        var word = queue[m.index];
        paint(m.index, m.ok ? "ok" : "no");
        if(m.ok) okCount++;
        else {
          noCount++;
          if(missed.indexOf(word) === -1) missed.push(word);
        }
        /* Final only, and once per word. A cycling deck can show the same
           word twice; the second reading is the same word inside the same
           minute, and counting it twice would let one lucky re-read undo
           one bad one. */
        if(isFinal && !Object.prototype.hasOwnProperty.call(seen, word)){
          seen[word] = true;
          report(word, m.ok);
        }
      });
      pointer = res.pointer;
      if(isFinal) snap = null;

      paintPointer();
      updateHud();
      if(pointer >= queue.length) finish();
    }

    function skip(){
      if(!running || pointer >= queue.length) return;
      // The pointer just moved for a reason no revision should undo, so
      // the result in flight loses its right to be rolled back.
      snap = null;
      startClock();
      var word = queue[pointer];
      paint(pointer, "no");
      noCount++;
      if(missed.indexOf(word) === -1) missed.push(word);
      if(!Object.prototype.hasOwnProperty.call(seen, word)){ seen[word] = true; report(word, false); }
      pointer++;
      paintPointer();
      updateHud();
      if(pointer >= queue.length) finish();
    }

    function finish(){
      if(!running) return;
      running = false;
      if(tickTimer){ clearInterval(tickTimer); tickTimer = null; }
      stopListening();

      // Scored over the minute it was given, even if the student pressed
      // Done early: the number means "words in a minute", and a
      // forty-second run that stopped early is not a faster reader.
      var ms = Math.min(RUN_MS, elapsed() || RUN_MS);
      var rate = wordsPerMinute(okCount, ms);
      var stars = starsForRate(rate, RATE_TARGET);
      var total = okCount + noCount;
      var acc = total ? Math.round(okCount / total * 100) : 0;

      show("s-end");
      Core.renderStars($("uiStars"), stars >= 3 ? 95 : stars === 2 ? 75 : stars === 1 ? 55 : 10);
      $("uiTitle").textContent = stars >= 3 ? "That's a reader! 🏆"
                               : stars === 2 ? "Getting quicker! 🎉"
                               : stars === 1 ? "Good run! 💪"
                               : "Take it steady 🙂";
      $("uiRate").firstChild.nodeValue = String(rate);
      $("uiFRight").textContent = okCount;
      $("uiFWrong").textContent = noCount;
      $("uiFBest").textContent = bestBefore ? Math.max(bestBefore, rate) : rate;
      $("uiSummary").textContent =
        "You read " + okCount + " words right out of " + total + " (" + acc + "%).";

      /* The delta is the reason to do this twice. A rate on its own is a
         number a student has no way to judge; "+9" is progress they can
         see without anybody explaining it. */
      var d = $("uiDelta");
      if(lastBefore){
        var diff = rate - lastBefore;
        d.hidden = false;
        d.className = "delta " + (diff >= 0 ? "up" : "down");
        d.textContent = (diff >= 0 ? "+" : "") + diff + " since last time";
      } else {
        d.hidden = true;
      }

      var block = $("missBlock"), grid = $("uiMissed");
      grid.innerHTML = "";
      if(missed.length){
        block.style.display = "block";
        missed.slice(0, 24).forEach(function(w){
          var b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.textContent = w;
          Core.markWordCase(b, w);
          b.addEventListener("click", function(){ say(w, 0.8); });
          grid.appendChild(b);
        });
      } else {
        block.style.display = "none";
      }

      if(stars >= 2) Core.confettiBurst($("s-end").querySelector(".card"), stars >= 3 ? 26 : 16);
      snd.win();
      if(onFluency){ try{ onFluency({ cwpm: rate, errors: noCount, n: total, ms: ms }); }catch(e){} }
      if(onFinish){ try{ onFinish({ right: okCount, total: total || 1 }); }catch(e){} }
      $("btnAgain").focus();
    }

    /* ---------------- speech ----------------
       Nothing here interrupts the reader, so this is much simpler than
       Say It's loop: open the recogniser at the start of the run and
       leave it open. The only reason it restarts at all is that Chrome
       ends a continuous session on its own after a stretch of silence. */
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec = null, listening = false, wantMic = false, restartTimer = null;

    function startListening(){
      wantMic = true;
      armMic();
    }

    function stopListening(){
      wantMic = false;
      if(restartTimer){ clearTimeout(restartTimer); restartTimer = null; }
      if(rec){ try{ rec.onresult = rec.onerror = rec.onend = null; rec.abort(); }catch(e){} rec = null; }
      listening = false;
    }

    function armMic(){
      if(!SR || !wantMic || listening) return;
      try{ rec = new SR(); }
      catch(e){ rec = null; return; }
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;

      /* Interim results matter more here than anywhere else on the site.
         A reader going at sixty words a minute is four words past the one
         the recogniser is still thinking about, and waiting for finals
         would leave the highlight hopelessly behind. So interims drive
         the screen — and heardResult() scores each result from a snapshot
         so that when Chrome revises one, the revision wins. */
      rec.onresult = function(ev){
        for(var i = ev.resultIndex; i < ev.results.length; i++){
          heardResult(i, ev.results[i][0].transcript, ev.results[i].isFinal);
        }
      };

      rec.onerror = function(ev){
        var err = ev && ev.error;
        if(err === "not-allowed" || err === "service-not-allowed"){
          wantMic = false;
          stopListening();
          $("uiState").innerHTML = "<b>Microphone blocked.</b> Click the 🎤 or 🔒 icon in the address bar and allow the mic, then reload.";
        } else if(err === "network"){
          wantMic = false;
          stopListening();
          $("uiState").innerHTML = "<b>No connection.</b> Speech needs the internet. Check wifi and reload.";
        }
      };

      rec.onend = function(){
        listening = false; rec = null;
        if(wantMic){
          if(restartTimer) clearTimeout(restartTimer);
          restartTimer = setTimeout(function(){ restartTimer = null; armMic(); }, 150);
        }
      };

      try{ rec.start(); listening = true; $("uiState").textContent = "Listening — keep going."; }
      catch(e){ listening = false; rec = null; }
    }

    // Reading a word back is the only thing this game ever says, and it
    // only ever says it when asked — never during a run.
    function say(text, rate){
      if(!window.speechSynthesis) return;
      try{
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = rate || 0.9;
        var v = Core.voice();
        if(v) u.voice = v;
        window.speechSynthesis.speak(u);
      }catch(e){}
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
       Copied from blend-game.js. What is worth having twice is the
       ORDERING: the permission prompt happens here, before a clock that
       cannot be paused starts running. */
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
      var pct = Math.min(100, Math.pow(Math.min(rms,0.35)/0.35, 0.6) * 100);
      meterPeak = Math.max(pct, meterPeak - 1.6);
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
        $("checkWarn").innerHTML = "<b>This browser can't show the meter,</b> but you can still read.";
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
        $("btnPlay").disabled = false;
      });
    }

    // Release the mic before the run starts — speech recognition opens its own.
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

    if(!window.speechSynthesis) $("btnDirections").disabled = true;
    else $("btnDirections").addEventListener("click", function(){ sayParts(Core.directionParts($("s-start"))); });

    $("btnStart").addEventListener("click", function(){ snd.click(); startMicCheck(); });
    $("btnBack").addEventListener("click", function(){ stopMicCheck(); show("s-start"); });
    $("btnPlay").addEventListener("click", function(){ stopMicCheck(); begin(); });
    $("btnDone").addEventListener("click", function(){ finish(); });
    $("btnSkip").addEventListener("click", skip);
    $("btnAgain").addEventListener("click", function(){ show("s-start"); $("btnStart").focus(); });

    document.addEventListener("keydown", function(e){
      if(!$("s-play").classList.contains("on")) return;
      if(e.target && e.target.tagName === "BUTTON") return;
      if(e.key === " "){ e.preventDefault(); skip(); }
    });

    window.addEventListener("beforeunload", function(){
      stopListening();
      stopMicCheck();
      if(window.speechSynthesis){ try{ window.speechSynthesis.cancel(); }catch(e){} }
    });
  }

  // _internals exposes the pure parts for tests.html — the alignment, the
  // arithmetic and the tokeniser. Not part of the public game API.
  return {
    start: start,
    _internals: {
      tokenize: tokenize,
      consume: consume,
      wordsPerMinute: wordsPerMinute,
      starsForRate: starsForRate,
      noiseLookahead: NOISE_LOOKAHEAD,
      runMs: RUN_MS
    }
  };
})();
