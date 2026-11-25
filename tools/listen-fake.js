/* ════════════════════════════════════════════════════════════════════
   listen-fake.js — the fake world for ONE case of tools/listen-loop.mjs.
   Runs inside tools/listen-case.html, in an iframe of tools/listen-loop.html.
   Build-time only; nothing on the site loads it.

   WHAT IS FAKE, in this frame only, installed before any site script runs:
     · the clock. setTimeout/setInterval/clear*, requestAnimationFrame,
       Date.now() and performance.now() run on a virtual clock that moves
       only when the case runner says so: it fires the earliest timer
       (ties in the order they were set), then lets every promise settle
       (one real macrotask) before the next. Same case, same seed = same
       order of everything, byte for byte.
     · SpeechRecognition (and webkitSpeechRecognition). A recogniser that
       replays a recorded or modelled event stream — see FakeSR below for
       exactly what it does and does not do.
     · speechSynthesis (an utterance "plays" for 200 ms + 60 ms a letter
       and fires its events), Audio (a phoneme clip plays for 260 ms),
       AudioContext (absent: the beeps still call their mic-hold callback
       first, which is all the engines need from them), getUserMedia
       (never answers: the mic check's meter never starts, so the runner
       enables Start Playing itself, as tools/boot-check.html does).
     · Math.random, seeded per case (mulberry32).
   WHAT IS REAL: word-lists.js, game-core.js, listen.js and the engine,
   unmodified (or, under --rule=, the engine's source with the rule's few
   lines rewritten in memory — the edit must match exactly once or the
   case stops). The engine is started with the cfg practice.js builds and
   driven through its own buttons.
   ════════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";
  var W = window;
  var REAL = { MessageChannel: W.MessageChannel, fetch: W.fetch.bind(W) };
  var params = {};
  String(location.search || "").replace(/^\?/, "").split("&").forEach(function(kv){
    if(!kv) return; var i = kv.indexOf("=");
    params[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1));
  });
  var FAULT = params.fault || "";
  var EPOCH = 1767225600000;            // 2026-01-01, any fixed number will do

  /* ---------------- the clock ---------------- */
  var clock = { now: 0, seq: 0, nextId: 1, timers: [] };
  function addTimer(fn, ms, every, internal){
    var t = { id: clock.nextId++, at: clock.now + Math.max(0, Math.floor(Number(ms) || 0)), seq: clock.seq++,
              fn: fn, every: every ? Math.max(1, Math.floor(Number(ms) || 0)) : 0, internal: !!internal };
    clock.timers.push(t);
    return t.id;
  }
  function clearTimer(id){
    for(var i = 0; i < clock.timers.length; i++){
      if(clock.timers[i].id === id && !clock.timers[i].internal){ clock.timers.splice(i, 1); return; }
    }
  }
  function nextTimer(){
    var best = null;
    for(var i = 0; i < clock.timers.length; i++){
      var t = clock.timers[i];
      if(!best || t.at < best.at || (t.at === best.at && t.seq < best.seq)) best = t;
    }
    return best;
  }
  function fire(t){
    var i = clock.timers.indexOf(t);
    if(i !== -1) clock.timers.splice(i, 1);
    if(t.at > clock.now) clock.now = t.at;
    if(t.every){ t.at += t.every; t.seq = clock.seq++; clock.timers.push(t); }
    try{ t.fn(); }catch(e){ reportError(e); }
  }
  W.setTimeout = function(fn, ms){ var a = [].slice.call(arguments, 2); return addTimer(function(){ fn.apply(W, a); }, ms, false); };
  W.setInterval = function(fn, ms){ var a = [].slice.call(arguments, 2); return addTimer(function(){ fn.apply(W, a); }, ms, true); };
  W.clearTimeout = W.clearInterval = function(id){ clearTimer(id); };
  W.requestAnimationFrame = function(fn){ return addTimer(function(){ fn(clock.now); }, 16, false); };
  W.cancelAnimationFrame = function(id){ clearTimer(id); };
  Date.now = function(){ return EPOCH + clock.now; };
  if(W.performance) W.performance.now = function(){ return clock.now; };

  // One real macrotask: every promise the last timer started settles first.
  function drain(){
    return new Promise(function(r){ var ch = new REAL.MessageChannel(); ch.port1.onmessage = function(){ r(); }; ch.port2.postMessage(0); });
  }

  /* ---------------- seeded Math.random ---------------- */
  var rngState = 1;
  Math.random = function(){
    rngState = (rngState + 0x6D2B79F5) | 0;
    var t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------------- sound and the microphone ---------------- */
  var synthStub = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: function(){ return []; },
    speak: function(u){
      var len = String(u && u.text || "").length;
      addTimer(function(){ if(u.onstart) u.onstart({}); }, 0);
      addTimer(function(){ if(u.onend) u.onend({}); }, 200 + 60 * len);
    },
    cancel: function(){}, pause: function(){}, resume: function(){},
    addEventListener: function(){}, removeEventListener: function(){}
  };
  try{ Object.defineProperty(W, "speechSynthesis", { value: synthStub, configurable: true, writable: true }); }catch(e){}
  W.Audio = function(src){ this.src = src; this.currentTime = 0; this.preload = ""; this.onended = null; this.onerror = null; };
  W.Audio.prototype.play = function(){ var a = this; addTimer(function(){ if(a.onended) a.onended(); }, 260); return Promise.resolve(); };
  W.Audio.prototype.pause = function(){};
  W.Audio.prototype.load = function(){};
  W.AudioContext = undefined; W.webkitAudioContext = undefined;
  if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia = function(){ return new Promise(function(){}); };

  /* ---------------- the fake recogniser ----------------
     What it does (and the loop's self-test pins each of these):
       · one session per start(); start() on a live session throws, as Chrome's does.
       · a stream event is delivered to the session live at its time; with none
         live it is DROPPED (the mic was closed — audio nobody heard).
       · results keep their slots for the whole session, as Chrome numbers them:
         ev.results is every result so far, ev.resultIndex the lowest slot this
         event changed. A stream's own slot 0 lands at the session's next free
         slot the first time that stream reaches the session.
       · a final is frozen: a later event for its slot is ignored.
       · a result carries at most maxAlternatives alternatives (default 1), so
         an n-best stream replayed into an engine that never asked for n-best
         shows it the top guess only — what Chrome would have sent.
       · interimResults false: interims are not delivered.
       · continuous false: the session ends after its first final (onend
         follows), as Chrome's does; continuous true: it runs until stopped.
       · an error event fires onerror, then ends the session.
       · abort()/stop() end the session; onend follows on the next tick.
     What it does NOT do: invent anything. No result, timing, confidence or
     error that is not in the stream. A real session also ends by itself after
     a stretch of silence; the stream's own "end" events are not replayed (the
     engines restart on end and the loop would only be testing the restart). */
  var SR = { live: null, nextId: 0, log: [], onStart: null };
  function FakeSR(){
    this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
    this.processLocally = false;
    this.onresult = this.onerror = this.onend = this.onstart = null;
    this._live = false;
  }
  FakeSR.prototype.start = function(){
    if(this._live){ var e = new Error("recognition has already started"); e.name = "InvalidStateError"; throw e; }
    this._live = true; this._id = ++SR.nextId; this._results = []; this._map = {}; this._startAt = clock.now;
    SR.live = this;
    SR.log.push({ t: clock.now, s: this._id, what: "start", cfg: { lang: this.lang, continuous: !!this.continuous,
                  interimResults: !!this.interimResults, maxAlternatives: this.maxAlternatives } });
    if(SR.onStart) SR.onStart(this);
  };
  function endSession(s, why){
    if(!s._live) return;
    s._live = false;
    if(SR.live === s) SR.live = null;
    SR.log.push({ t: clock.now, s: s._id, what: "end:" + why });
    addTimer(function(){ if(s.onend) s.onend({}); }, 0, false, true);
  }
  FakeSR.prototype.stop = function(){ endSession(this, "stop"); };
  FakeSR.prototype.abort = function(){ endSession(this, "abort"); };
  FakeSR.prototype.addEventListener = function(){};

  function mkResult(r, max){
    var alts = r.alts || [];
    var keep = FAULT === "no-trunc" ? alts.length : Math.max(1, Math.min(alts.length, Number(max) || 1));
    var arr = alts.slice(0, keep).map(function(a){ return { transcript: String(a.transcript), confidence: Number(a.confidence) || 0 }; });
    arr.isFinal = !!r.isFinal;
    arr.item = function(i){ return arr[i]; };
    return arr;
  }
  function listOf(results){
    var a = results.slice();
    a.item = function(i){ return a[i]; };
    return a;
  }

  // One stream event for stream `key`, now. Returns what happened, for the trace.
  function deliver(key, e){
    var s = SR.live;
    if(!s) return { dropped: true };
    if(e.type === "error"){
      if(s.onerror){ try{ s.onerror({ error: e.error, message: "" }); }catch(x){ reportError(x); } }
      endSession(s, "error");
      return { s: s._id, error: e.error };
    }
    if(e.type !== "result") return { ignored: true };
    var ri = e.resultIndex | 0;
    if(!(key in s._map)) s._map[key] = s._results.length - ri;
    var off = s._map[key], first = Infinity, touched = [];
    (e.results || []).forEach(function(r, j){
      if(j < ri) return;
      var slot = j + off;
      if(slot < 0) return;
      var cur = s._results[slot];
      if(cur && cur.isFinal) return;
      if(!s.interimResults && !r.isFinal) return;
      if(FAULT === "drop-finals" && r.isFinal) return;
      s._results[slot] = mkResult(r, s.maxAlternatives);
      if(slot < first) first = slot;
      touched.push(slot);
    });
    if(first === Infinity) return { s: s._id, nothing: true };
    for(var h = 0; h < s._results.length; h++) if(!s._results[h]) s._results[h] = mkResult({ alts: [{ transcript: "" }] }, 1);
    var ev = { resultIndex: FAULT === "renumber" ? 0 : first, results: listOf(s._results) };
    if(s.onresult){ try{ s.onresult(ev); }catch(x){ reportError(x); } }
    var anyFinal = touched.some(function(sl){ return s._results[sl].isFinal; });
    if(!s.continuous && anyFinal) endSession(s, "final");
    return { s: s._id, slots: touched };
  }

  W.SpeechRecognition = FakeSR;
  W.webkitSpeechRecognition = FakeSR;

  /* ---------------- errors ---------------- */
  var errors = [];
  function reportError(e){ errors.push(String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
  W.addEventListener("error", function(ev){ reportError(ev.error || ev.message); });
  W.addEventListener("unhandledrejection", function(ev){ reportError("unhandled rejection: " + (ev.reason && ev.reason.message || ev.reason)); });

  /* ---------------- loading the site ---------------- */
  var ENGINE = { say: ["blend-game.js", "BlendGame"], cards: ["card-game.js", "CardGame"],
                 fluency: ["fluency-game.js", "FluencyGame"], blendit: ["blend-it-game.js", "BlendItGame"] };
  var mode = params.mode || "say";
  var files = ["word-lists.js", "game-core.js", "listen.js", ENGINE[mode] ? ENGINE[mode][0] : "blend-game.js"];
  var rule = null;
  try{ rule = W.parent && W.parent.__listenRule || null; }catch(e){ rule = null; }

  function loadSrc(src){
    return new Promise(function(res, rej){
      var s = document.createElement("script");
      s.src = src; s.onload = function(){ res(); }; s.onerror = function(){ rej(new Error("could not load " + src)); };
      document.body.appendChild(s);
    });
  }
  function patch(text, file, edits){
    edits.forEach(function(ed){
      var n = text.split(ed[0]).length - 1;
      if(n !== 1) throw new Error("rule " + rule.name + ": in " + file + " the line to rewrite was found " + n + " times, not once: " + JSON.stringify(ed[0].slice(0, 70)));
      text = text.replace(ed[0], function(){ return ed[1]; });
    });
    return text;
  }
  function loadOne(file){
    var edits = rule && rule.edits && rule.edits[file];
    if(!edits || !edits.length) return loadSrc(file);
    return REAL.fetch(file).then(function(r){ return r.text(); }).then(function(text){
      var s = document.createElement("script");
      s.textContent = patch(text, file, edits) + "\n//# sourceURL=" + file + "?rule=" + rule.name;
      document.body.appendChild(s);
    });
  }
  var ready = files.reduce(function(p, f){ return p.then(function(){ return loadOne(f); }); }, Promise.resolve());

  /* ---------------- self-test of the fake ----------------
     Run once per loop run, in a frame of its own. Each check is one thing the
     recogniser above promises; a --fake-fault breaks at least one. */
  function selfTest(){
    var fails = [];
    function must(c, m){ if(!c) fails.push(m); }
    var got = [], ends = 0;
    var r = new FakeSR(); r.continuous = true; r.interimResults = true;
    r.onresult = function(ev){ got.push(ev); }; r.onend = function(){ ends++; };
    r.start();
    var R = function(t, fin, alts){ return { isFinal: fin, alts: alts || [{ transcript: t, confidence: fin ? 0.9 : 0 }] }; };
    deliver("a", { type: "result", resultIndex: 0, results: [R("cr", false)] });
    deliver("a", { type: "result", resultIndex: 0, results: [R("crab", true, [{ transcript: "crab", confidence: 0.9 }, { transcript: "grab", confidence: 0.4 }])] });
    must(got.length === 2, "F1 an interim and a final make two events (got " + got.length + ")");
    var last = got[got.length - 1];
    must(last && last.results.length === 1 && last.resultIndex === 0, "F1 a final of slot 0: results.length 1, resultIndex 0");
    must(last && last.results[0].isFinal === true && last.results[0][0].transcript === "crab", "F1 the final is delivered as final");
    must(last && last.results[0].length === 1, "F2 maxAlternatives 1: one alternative, not " + (last && last.results[0].length));
    deliver("a", { type: "result", resultIndex: 0, results: [R("crib", false)] });
    must(got.length === 2, "F3 a final is frozen: a later update to its slot is ignored");
    deliver("b", { type: "result", resultIndex: 0, results: [R("grin", true)] });
    last = got[got.length - 1];
    must(last && last.resultIndex === 1 && last.results.length === 2, "F4 a second stream's slot 0 is the session's next slot (resultIndex 1)");
    r.abort();
    var d = deliver("c", { type: "result", resultIndex: 0, results: [R("x", true)] });
    must(d.dropped === true, "F5 with no live session an event is dropped");
    var r2 = new FakeSR(); r2.continuous = false; r2.interimResults = true; r2.maxAlternatives = 3;
    var g2 = []; r2.onresult = function(ev){ g2.push(ev); };
    r2.start();
    deliver("d", { type: "result", resultIndex: 0, results: [R("vab", true, [{ transcript: "verb", confidence: 0.8 }, { transcript: "vab", confidence: 0.3 }, { transcript: "bab", confidence: 0.2 }, { transcript: "dab", confidence: 0.1 }])] });
    must(g2.length === 1 && g2[0].results[0].length === 3, "F6 maxAlternatives 3: three alternatives");
    must(!r2._live && SR.live === null, "F7 continuous false: the session ends after its first final");
    // abort() and the end of r2 queued their onend at +0
    while(nextTimer() && nextTimer().at <= clock.now) fire(nextTimer());
    must(ends === 1, "F8 abort() fires onend once (got " + ends + ")");
    var order = [], t0 = clock.now;
    addTimer(function(){ order.push(2); }, 20); addTimer(function(){ order.push(1); }, 10); addTimer(function(){ order.push(3); }, 20);
    for(var k = 0; k < 3; k++) fire(nextTimer());
    must(order.join() === "1,2,3", "F9 timers fire by time, ties in the order set (" + order.join() + ")");
    must(clock.now === t0 + 20 && Date.now() === EPOCH + t0 + 20, "F10 Date.now follows the virtual clock");
    SR.log = []; SR.live = null; clock.timers = [];
    return fails;
  }

  /* ---------------- one case ----------------
     c = { id, mode, listId, seed, items: [{ key, target, entry, events: [{t, type, resultIndex, results, error}] }] }
     Every item's events are timed from the moment its word appears: in Say It
     when the word is drawn on the card, on the cards when the card is drawn,
     in One minute when the grid is drawn, in Blend it when the mic opens after
     the sounds (the student cannot read anything there: the word appears only
     in the sounds). */
  var SETTLE = { say: 2500, cards: 1500, fluency: 1500, blendit: 2000 };
  var CAP_MS = 180000;

  function $(id){ return document.getElementById(id); }
  function on(id){ var e = $(id); return !!(e && e.classList.contains("on")); }
  function click(id){ var e = $(id); if(e) e.click(); }

  function runCase(c){
    var L = W.WordLists.byId(c.listId);
    if(!L) return Promise.resolve({ id: c.id, error: "no list " + c.listId });
    rngState = (c.seed | 0) || 1;
    try{
      localStorage.clear();
      localStorage.setItem("blendShuffle", "0"); localStorage.setItem("blendVoice", "0");
      localStorage.setItem("cardShuffle", "0"); localStorage.setItem("cardListen", "1");
    }catch(e){}

    var items = c.items, N = items.length;
    var st = items.map(function(){ return { appear: -1, over: -1, verdict: null, again: false, actions: [], heard: null, ended: false }; });
    var trace = [];
    var current = -1;             // the item on screen
    var fluencyResult = null;

    var cfg = { mount: "app", listId: L.id, title: L.title, intro: L.config.intro || "x" };
    for(var k in L.config) if(Object.prototype.hasOwnProperty.call(L.config, k)) cfg[k] = L.config[k];
    cfg.words = items.map(function(it){ return it.entry || it.target; });
    cfg.allWords = L.words.slice();
    cfg.mastered = [];
    cfg.onResult = function(word, ok){
      if(c.mode === "fluency" && fluencyResult === null){ fluencyResult = !!ok; act(0, ok ? "accept" : "reject", ""); }
    };

    function act(i, v, heard){
      if(i < 0 || i >= N) return;
      var s = st[i];
      s.actions.push({ t: clock.now, v: v, heard: heard || "" });
      trace.push({ t: clock.now, i: i, act: v, heard: heard || "" });
      if(v === "again"){ s.again = true; return; }
      if(!s.verdict) s.verdict = v;
    }

    function appear(i){
      if(i < 0 || i >= N || st[i].appear >= 0) return;
      current = i;
      st[i].appear = clock.now;
      trace.push({ t: clock.now, i: i, act: "shown" });
      var evs = items[i].events || [], last = 0;
      evs.forEach(function(e, n){
        last = Math.max(last, e.t | 0);
        addTimer(function(){
          var d = deliver("item" + i + (e.stream != null ? "s" + e.stream : ""), e);
          var row = { t: clock.now, i: i, n: n };
          if(d.dropped) row.dropped = 1;
          if(d.error) row.error = d.error;
          if(d.s) row.s = d.s;
          if(d.nothing) row.nothing = 1;
          trace.push(row);
        }, e.t | 0, false, true);
      });
      st[i].over = clock.now + Math.max(last, evs.length ? 0 : 3000) + SETTLE[c.mode];
    }

    // What the engine did, read off its own screen.
    var obs = null;
    function watchCard(idxOf){
      var card = $("wordCard"), mic = $("uiMic"), lastCls = card ? card.className : "";
      obs = new MutationObserver(function(){
        var cls = card.className, i = idxOf();
        if(cls !== lastCls){
          if(/\bcorrect\b/.test(cls) && !/\bcorrect\b/.test(lastCls)) act(i, "accept", "");
          if(/\bwrong\b/.test(cls) && !/\bwrong\b/.test(lastCls)){
            var h = mic && mic.querySelector(".heard");
            act(i, "reject", h ? h.textContent.replace(/^I heard:\s*/, "") : "");
          }
          lastCls = cls;
        }
        if(mic && /louder/.test(mic.textContent) && !st[i].again) act(i, "again", "");
      });
      if(card) obs.observe(card, { attributes: true, attributeFilter: ["class"] });
      if(mic) obs.observe(mic, { childList: true, subtree: true, characterData: true });
    }
    function sayIndex(){
      var m = /^(\d+)\//.exec(($("uiCount") || {}).textContent || "");
      return m ? (+m[1]) - 1 : -1;
    }

    var engine = ENGINE[c.mode] ? W[ENGINE[c.mode][1]] : null;
    var done = false, flipped = false;

    SR.onStart = function(s){
      trace.push({ t: clock.now, act: "mic-open", s: s._id });
      if(c.mode === "blendit" && on("s-play")) appear(0);
    };

    function step(){
      if(c.mode === "say"){
        if(on("s-play")){ var i = sayIndex(); if(i >= 0 && st[i].appear < 0) appear(i); }
        if(current >= 0 && st[current].over >= 0 && clock.now >= st[current].over && sayIndex() === current && on("s-play")){
          if(!st[current].skipped){ st[current].skipped = true; trace.push({ t: clock.now, i: current, act: "skip" }); }
          click("btnSkip");
        }
        if(on("s-end")) done = true;
      } else if(c.mode === "cards"){
        if(on("s-play") && st[0].appear < 0) appear(0);
        if(st[0].over >= 0 && clock.now >= st[0].over && !flipped){
          flipped = true;
          click("btnFlip");
          var got = $("btnGot").classList.contains("suggest"), miss = $("btnMiss").classList.contains("suggest");
          var line = $("uiHeard");
          var heard = line && !line.hidden ? line.textContent.replace(/^I heard:\s*/, "") : "";
          trace.push({ t: clock.now, i: 0, act: "flip" });
          if(got) act(0, "accept", heard); else if(miss) act(0, "reject", heard);
          done = true;
        }
      } else if(c.mode === "fluency"){
        if(on("s-play") && st[0].appear < 0) appear(0);
        if(st[0].over >= 0 && clock.now >= st[0].over){ click("btnDone"); done = true; }
      } else if(c.mode === "blendit"){
        if(st[0].appear >= 0 && clock.now >= st[0].over) done = true;
        if(on("s-end")) done = true;
      }
    }

    return Promise.resolve().then(function(){
      if(!engine) throw new Error("engine for " + c.mode + " did not load");
      return W.GameCore.phonemeAudio();
    }).then(function(){
      engine.start(cfg);
      if(c.mode === "say" || c.mode === "blendit") watchCard(c.mode === "say" ? sayIndex : function(){ return 0; });
      return drain();
    }).then(function(){
      if(c.mode === "say" || c.mode === "fluency" || c.mode === "blendit"){
        click("btnStart");
        var p = $("btnPlay"); if(p) p.disabled = false;
        click("btnPlay");
      } else {
        click("btnStart");
      }
      // The driver's own tick, so the runner looks at the screen at least
      // every 50 ms even when the engine has no timer of its own running.
      addTimer(function(){}, 50, true, true);
      return (function loop(){
        step();
        if(done || clock.now > CAP_MS) return null;
        var t = nextTimer();
        if(!t) return null;
        fire(t);
        return drain().then(loop);
      })();
    }).then(function(){
      if(obs) obs.disconnect();
      clock.timers = [];
      var out = { id: c.id, items: st.map(function(s){ return { verdict: s.verdict || (s.again ? "again" : "none"), again: s.again,
        shown: s.appear, actions: s.actions }; }), trace: trace, sr: SR.log.slice(0, 40), errors: errors.slice() };
      if(clock.now > CAP_MS) out.error = "case ran past " + CAP_MS + " ms of virtual time";
      return out;
    }).catch(function(e){
      reportError(e);
      return { id: c.id, error: String(e && e.message || e), errors: errors.slice(), trace: trace };
    });
  }

  W.__case = {
    ready: ready.then(function(){ return true; }, function(e){ reportError(e); return String(e && e.message || e); }),
    run: runCase,
    selfTest: selfTest,
    errors: function(){ return errors.slice(); }
  };
})();
