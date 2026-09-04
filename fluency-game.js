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
 * Two shapes, one engine, chosen by whether the list carries `text`:
 *
 *   ONE MINUTE (mode "fluency")  a word list in rows of five, sixty
 *                                seconds, deck cycling. Score: correct
 *                                words per minute.
 *   READ IT   (mode "read")      a passage of connected text. The words
 *                                light up as the student passes them.
 *                                Score: words correct per minute.
 *
 * The difference between them is not cosmetic. A word list measures how
 * fast single words come; a passage measures whether they survive being
 * next to each other, which is where a student who has memorised shapes
 * comes apart. Both are in here because the machinery — a continuous
 * recogniser, a pointer walking a list of words, a clock — is the same.
 *
 *   FluencyGame.start({
 *     title: "Blend Words ⏱",
 *     words: ["soft","golf", …],       // one-minute mode
 *     text:  "The tent is damp…",      // read mode (wins if present)
 *     targets: ["tent","damp"],        // read mode: which words to report
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
  var LOOKAHEAD = 3;           // how far ahead a passage pointer will jump
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

     `lookahead` is the whole difference between the two games. At 0 —
     the one-minute list — every token answers the current word: right or
     wrong, the pointer moves, and the run never stalls on a word the
     student has given up on. Above 0 — a passage — a token that doesn't
     match the current word is tried against the next few, so a reader who
     skips a word carries on from where they actually are, with the skipped
     words marked red behind them. A token matching nothing at all is
     ignored there: in connected text the recogniser returns plenty that
     isn't a word on the page, and treating that as an error would score
     the microphone rather than the student.

     Pure: `matches(token, word)` is injected, and nothing here touches
     the clock or the DOM. Returns the new pointer and one mark per word
     decided, in order.  */
  function consume(pointer, tokens, words, matches, lookahead){
    var p = pointer, marks = [], i, k, hit;
    lookahead = lookahead || 0;
    for(i=0;i<tokens.length;i++){
      if(p >= words.length) break;
      if(matches(tokens[i], words[p])){
        marks.push({ index: p, ok: true });
        p++;
        continue;
      }
      hit = -1;
      for(k=1;k<=lookahead && p+k<words.length;k++){
        if(matches(tokens[i], words[p+k])){ hit = k; break; }
      }
      if(hit > 0){
        // The words jumped over were on the page and didn't get read.
        for(k=0;k<hit;k++) marks.push({ index: p+k, ok: false });
        marks.push({ index: p+hit, ok: true });
        p = p + hit + 1;
        continue;
      }
      if(!lookahead){
        marks.push({ index: p, ok: false });
        p++;
      }
      // With lookahead, an unmatched token is noise and is dropped.
    }
    return { pointer: p, marks: marks };
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

  /* ---- the passage ----
     Big, loose lines, and every word its own element so the pointer has
     something to colour. Tapping one reads it aloud: a reader who has
     stalled needs the word, not a hint. */
  .passage{
    background:var(--panel);border:1px solid var(--line);border-radius:22px;
    padding:26px 24px;text-align:left;font-size:clamp(21px,3vw,30px);line-height:1.95;
    max-height:56vh;overflow-y:auto;
  }
  .pw{
    display:inline;border:none;background:transparent;color:var(--muted);
    font:inherit;padding:1px 2px;border-radius:6px;cursor:pointer;
  }
  .pw:hover{background:var(--panel2);color:var(--ink)}
  .pw.ok{color:var(--good)}
  .pw.no{color:var(--bad);text-decoration:underline;text-decoration-style:wavy;text-underline-offset:5px}
  .pw.now{color:var(--ink);background:var(--panel2);box-shadow:inset 0 0 0 2px var(--accent)}

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
        ${cfg.passage
          ? `<li>Read the whole thing <b>out loud</b>. Words turn green as you pass them.</li>
             <li>If you slip, <b>keep going</b> — don't stop to fix it.</li>`
          : `<li>Read down the rows <b>out loud</b>. You have <b>one minute</b>.</li>
             <li>Don't rush a word you're unsure of. A word read wrong doesn't count.</li>`}
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
      <div class="stat"><div class="lbl">${cfg.passage ? "Left" : "Time"}</div><div class="val" id="uiLeft">—</div></div>
    </div>
    <div class="clock" id="uiClock"><i id="uiClockFill"></i></div>

    ${cfg.passage
      ? `<div class="passage" id="uiPassage"></div>`
      : `<div class="wordgrid" id="uiGrid"><div class="wgrows" id="uiRows"></div></div>`}

    <div class="keyhint" id="uiState" role="status" style="margin-top:14px">Getting the microphone ready…</div>

    <div class="toolbar">
      ${cfg.passage ? "" : `<button class="btn ghost" id="btnSkip" type="button">Skip ▸ <span class="kbd">Space</span></button>`}
      <button class="btn ghost" id="btnDone" type="button">Done</button>
    </div>
  </section>

  <section id="s-end" class="screen">
    <div class="card">
      <div class="stars" id="uiStars" aria-hidden="true"></div>
      <h2 id="uiTitle">Nice work! 🎉</h2>
      <div class="bignum" id="uiRate">0<small>${cfg.passage ? "words correct per minute" : "correct words per minute"}</small></div>
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
        <button class="btn" id="btnAgain">${cfg.passage ? "Read it again" : "Go again"}</button>
        <a class="btn ghost" href="index.html" id="btnHome">Home</a>
      </div>
    </div>
  </section>
`;
  }

  function start(cfg){
    var PASSAGE = !!cfg.text;
    var WORDS = PASSAGE ? tokenize(cfg.text) : (cfg.words || []).map(function(e){ return Core.parseEntry(e).word; });
    var TARGETS = {};
    (cfg.targets || []).forEach(function(w){ TARGETS[String(w).toLowerCase()] = true; });
    var MATCH_OPTS = { homophones: cfg.homophones || null, phonetic: !!cfg.phonetic };
    var RATE_TARGET = cfg.target || DEFAULT_TARGET;

    Core.injectStyle(STYLE_ID, STYLE);
    var mount = document.getElementById(cfg.mount || "app");
    mount.className = "wrap";
    mount.innerHTML = shell({
      title: cfg.title,
      intro: cfg.intro || "Read out loud. The computer follows along.",
      note: cfg.note || "",
      passage: PASSAGE
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
      // On a passage only the family's own words are reported: "the" going
      // past does not tell anybody anything about anybody's reading.
      if(PASSAGE && !TARGETS[String(word).toLowerCase()]) return;
      try{ onResult(word, !!correct, correct ? 0 : 1); }catch(e){}
    }

    /* ---------------- state ---------------- */
    var queue = [];            // the words on screen, in order
    var pointer = 0;           // how far the reader has got
    var okCount = 0, noCount = 0;
    var missed = [];
    var startedAt = 0, endsAt = 0, running = false;
    var tickTimer = null, seen = {};

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

    function buildPassage(){
      var box = $("uiPassage");
      box.innerHTML = "";
      // The original text supplies the punctuation and the capitals; the
      // token list supplies what is being matched. Walking both at once
      // keeps the page readable and the pointer honest.
      var text = String(cfg.text || ""), i = 0, at = 0, n = text.length;
      while(at < n && i < queue.length){
        var re = /[A-Za-z']+/g;
        re.lastIndex = at;
        var m = re.exec(text);
        if(!m) break;
        if(m.index > at) box.appendChild(document.createTextNode(text.slice(at, m.index)));
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pw";
        b.id = "pw" + i;
        b.dataset.i = String(i);
        b.textContent = m[0];
        Core.markWordCase(b, m[0]);
        box.appendChild(b);
        at = m.index + m[0].length;
        i++;
      }
      if(at < n) box.appendChild(document.createTextNode(text.slice(at)));
      box.addEventListener("click", function(ev){
        var t = ev.target;
        if(!t || !t.dataset || t.dataset.i === undefined) return;
        // Tap to hear. A reader who has stalled needs the word, not a hint.
        say(t.textContent, 0.85);
      });
    }

    function cellOf(i){ return $((PASSAGE ? "pw" : "wg") + i); }

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

    // The row being read stays put; the ones above it slide away. On a
    // passage the browser's own scrolling does the same job.
    function scrollTo(i){
      if(PASSAGE){
        var el = cellOf(i);
        if(el && el.scrollIntoView) el.scrollIntoView({ block:"nearest" });
        return;
      }
      var rowH = 0, rows = $("uiRows");
      if(!rows || !rows.firstChild) return;
      rowH = rows.firstChild.getBoundingClientRect().height;
      var row = Math.floor(i / ROW);
      var keep = Math.max(0, row - 1);
      rows.style.transform = "translateY(" + (-keep * rowH) + "px)";
    }

    /* ---------------- the run ---------------- */
    function begin(){
      queue = PASSAGE ? WORDS.slice() : deckFor();
      pointer = 0; okCount = 0; noCount = 0; missed = []; seen = {};
      startedAt = 0; endsAt = 0; running = true;
      show("s-play");
      if(PASSAGE) buildPassage(); else buildGrid();
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
      if(!PASSAGE){
        var left = startedAt ? Math.max(0, endsAt - Date.now()) : RUN_MS;
        $("uiLeft").textContent = Math.ceil(left / 1000) + "s";
        $("uiClockFill").style.width = (left / RUN_MS * 100) + "%";
        $("uiClock").classList.toggle("low", left < 10000);
        if(startedAt && left <= 0) finish();
      } else {
        var togo = Math.max(0, queue.length - pointer);
        $("uiLeft").textContent = togo;
        $("uiClockFill").style.width = (queue.length ? (pointer / queue.length * 100) : 0) + "%";
      }
    }

    function updateHud(){
      $("uiRight").textContent = okCount;
      $("uiWrong").textContent = noCount;
    }

    /* One transcript, consumed. The pure part is consume(); everything
       here is what to do with its marks. */
    function heard(text){
      if(!running) return;
      var tokens = tokenize(text);
      if(!tokens.length) return;
      var res = consume(pointer, tokens, queue, function(tok, word){
        return Core.spokenMatch(tok, word, MATCH_OPTS);
      }, PASSAGE ? LOOKAHEAD : 0);
      if(!res.marks.length) return;
      startClock();
      paint(pointer, null);
      res.marks.forEach(function(m){
        var word = queue[m.index];
        paint(m.index, m.ok ? "ok" : "no");
        if(m.ok) okCount++;
        else {
          noCount++;
          if(missed.indexOf(word) === -1) missed.push(word);
        }
        /* A cycling deck can show the same word twice. Only the first
           reading of it is reported: the second is the same word inside
           the same minute, and counting it twice would let one lucky
           re-read undo one bad one. */
        if(!Object.prototype.hasOwnProperty.call(seen, word)){
          seen[word] = true;
          report(word, m.ok);
        }
      });
      pointer = res.pointer;
      paintPointer();
      updateHud();
      if(pointer >= queue.length) finish();
    }

    function skip(){
      if(!running || pointer >= queue.length) return;
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

      // A one-minute run is scored over the minute it was given, even if
      // the student pressed Done early; a passage is scored over the time
      // it actually took, which is the whole point of a passage.
      var ms = PASSAGE ? elapsed() : Math.min(RUN_MS, elapsed() || RUN_MS);
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
      $("uiSummary").textContent = PASSAGE
        ? "You read " + okCount + " of " + queue.length + " words right (" + acc + "%)."
        : "You read " + okCount + " words right out of " + total + " (" + acc + "%).";

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
         would make the highlight trail hopelessly. So interims drive the
         pointer, and `consumedTo` remembers how much of the current
         result has already been counted — otherwise every interim would
         re-consume the words before it. */
      var consumedTo = 0, activeIndex = -1;
      rec.onresult = function(ev){
        for(var i = ev.resultIndex; i < ev.results.length; i++){
          var r = ev.results[i], text = r[0].transcript;
          if(i !== activeIndex){ activeIndex = i; consumedTo = 0; }
          var toks = tokenize(text);
          if(toks.length > consumedTo){
            heard(toks.slice(consumedTo).join(" "));
            consumedTo = toks.length;
          }
          if(r.isFinal){ activeIndex = -1; consumedTo = 0; }
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
    if($("btnSkip")) $("btnSkip").addEventListener("click", skip);
    $("btnAgain").addEventListener("click", function(){ show("s-start"); $("btnStart").focus(); });

    document.addEventListener("keydown", function(e){
      if(!$("s-play").classList.contains("on")) return;
      if(e.target && e.target.tagName === "BUTTON") return;
      if(e.key === " " && !PASSAGE){ e.preventDefault(); skip(); }
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
      lookahead: LOOKAHEAD,
      runMs: RUN_MS
    }
  };
})();
