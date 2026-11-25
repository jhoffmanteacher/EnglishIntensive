/* ════════════════════════════════════════════════════════════════════
   mic-takes.js — the teacher's recorder for the listening check.

   A teacher reads a word list aloud — right, or wrong on purpose — and
   this page keeps everything Chrome's recogniser sends back for each
   word: every result event with its time, every alternative with its
   confidence, every error, start and end. Downloaded as one JSON file
   (tools/mic-takes/README.md has the schema), it goes into
   tools/mic-takes/, and `node tools/listen-loop.mjs` replays it through
   the real game engines and counts what they got wrong.

   Nothing is scored here. Nothing is written to Firestore (auth.js reads
   whether the account is a teacher; this file never touches the
   database). Audio, if kept, goes only into the downloaded file.

   The recogniser is configured EXACTLY as Say It configures it —
   blend-game.js armMic(): lang "en-US", continuous true, interimResults
   true, maxAlternatives left at Chrome's default (1), start() with no
   track. A variant other than "site" changes only what its name says.
   ════════════════════════════════════════════════════════════════════ */
(function(){
  "use strict";

  var $ = function(id){ return document.getElementById(id); };
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var Phrase = window.SpeechRecognitionPhrase || null;
  var SCHEMA = "ei-mic-takes/1";

  // The one place Say It's settings are written down for this page. If
  // blend-game.js armMic() changes, this changes with it.
  var SAY_IT = { lang: "en-US", continuous: true, interimResults: true };

  var VARIANTS = [
    { key: "site", label: "Site — exactly what Say It does today",
      note: "The recogniser exactly as Say It sets it up. Record this first." },
    { key: "nbest5", label: "maxAlternatives = 5 (keep the n-best list)", maxAlternatives: 5,
      note: "Chrome sends up to 5 guesses per result instead of 1. The site only ever reads the top guess; these takes show whether the right word was in the list when the top guess was wrong." },
    { key: "on-device", label: "On-device (processLocally)", processLocally: true,
      needs: function(){ return !!SR && ("processLocally" in SR.prototype); },
      note: "Recognition on this computer instead of Google's server. Chrome's notes say ChromeOS does not have it yet; if this computer can't, the page says so." },
    { key: "biased-phrases", label: "BIASED — boost the word on screen (phrases)", phrases: true,
      needs: function(){ return !!Phrase; },
      note: "BIASED. Tells the recogniser to expect the word on screen. It will hear that word whether or not it was read, so these takes measure how much boosting forgives — never a setting for the games." }
  ];

  var state = null;   // the recording in progress

  /* ---------------- set up ---------------- */
  function variantOf(key){ for(var i = 0; i < VARIANTS.length; i++) if(VARIANTS[i].key === key) return VARIANTS[i]; return VARIANTS[0]; }

  function fillSetup(){
    var sel = $("mtList");
    WordLists.all.forEach(function(l){
      var o = document.createElement("option");
      o.value = l.id;
      o.textContent = l.title + "  (" + l.id + ")";
      sel.appendChild(o);
    });
    var v = $("mtVariant"), missing = [];
    VARIANTS.forEach(function(x){
      if(x.needs && !x.needs()){ missing.push(x.label.split(" (")[0]); return; }
      var o = document.createElement("option");
      o.value = x.key; o.textContent = x.label;
      v.appendChild(o);
    });
    function noteVariant(){
      var x = variantOf(v.value);
      $("mtVariantNote").textContent = x.note + (missing.length ? " (Not offered in this browser: " + missing.join(", ") + ".)" : "");
    }
    v.addEventListener("change", noteVariant);
    noteVariant();
    function noteScript(){
      var s = buildScript($("mtList").value, $("mtScript").value);
      $("mtScriptNote").textContent = s.items.length + " items" +
        ($("mtScript").value === "wrong" ? " (" + (s.items.length - s.noise) + " misreadings, " + s.noise + " noise items)" +
          (s.skipped.length ? ". No misreading for: " + s.skipped.join(", ") + " (left out)" : "") : "") +
        ". About " + Math.max(1, Math.round(s.items.length * 4 / 60)) + " minutes.";
    }
    sel.addEventListener("change", noteScript);
    $("mtScript").addEventListener("change", noteScript);
    noteScript();
    if(!SR){
      $("mtStart").disabled = true;
      $("mtScriptNote").textContent = "This browser has no speech recogniser. Open this page in Google Chrome.";
    }
  }

  /* The script: every word of the list in order. For `wrong`, each word's
     misreading comes from tools/wrong-readings.js (the same generator the
     listening check's virtual reader uses), and the four noise items are
     spread through the list: one after every eighth word, the rest at the
     end. */
  function buildScript(listId, script){
    var words = WordLists.wordsOf(listId), items = [], skipped = [], noise = 0;
    var NOISE = WrongReadings.NOISE, ni = 0;
    words.forEach(function(w, i){
      if(script === "right"){
        items.push({ target: w, entry: WrongReadings.entryOf(listId, w), script: "right", asked: null });
      } else {
        var p = WrongReadings.pick(listId, w);
        if(!p){ skipped.push(w); }
        else items.push({ target: w, entry: WrongReadings.entryOf(listId, w), script: "wrong",
                          asked: { say: p.say, how: p.how, kind: p.kind, src: p.src } });
        if((i + 1) % 8 === 0 && ni < NOISE.length){
          var n = NOISE[ni++];
          items.push({ target: words[(i + 1) % words.length], entry: WrongReadings.entryOf(listId, words[(i + 1) % words.length]),
                       script: "noise", asked: { say: n.say, how: n.how, kind: n.key, src: "noise" } });
          noise++;
        }
      }
    });
    if(script === "wrong") while(ni < NOISE.length){
      var m = NOISE[ni++], w2 = words[ni % words.length];
      items.push({ target: w2, entry: WrongReadings.entryOf(listId, w2), script: "noise", asked: { say: m.say, how: m.how, kind: m.key, src: "noise" } });
      noise++;
    }
    return { items: items, skipped: skipped, noise: noise };
  }

  // The list's switches that change how a mode listens — written into the
  // file so a take says what it was recorded against.
  function listFlags(listId){
    var l = WordLists.byId(listId), out = { list: {}, say: null };
    function pick(cfg){
      cfg = cfg || {};
      return { phonetic: !!cfg.phonetic, join: !!cfg.join, homophones: !!(cfg.homophones && cfg.homophones.length),
               soundalikes: !!cfg.soundalikes, irregular: !!cfg.irregular, blend: cfg.blend || null,
               blendLength: cfg.blendLength === undefined ? null : cfg.blendLength, sound: cfg.sound || null, speak: cfg.speak !== false };
    }
    out.list = pick(l && l.config);
    var sayId = WordLists.all.filter(function(x){ return l && x.family === l.family && x.listNum === l.listNum && x.mode === "say"; })[0];
    if(sayId) out.say = pick(sayId.config);
    return out;
  }

  /* ---------------- recording ---------------- */
  function start(){
    var listId = $("mtList").value, script = $("mtScript").value, variant = variantOf($("mtVariant").value);
    var s = buildScript(listId, script);
    if(!s.items.length) return;
    var l = WordLists.byId(listId);
    state = {
      listId: listId, listTitle: l ? l.title : listId, family: l ? l.family : "", script: script, variant: variant,
      room: $("mtRoom").value.trim(), items: s.items, skipped: s.skipped, taken: [], at: 0, again: 0,
      audioWanted: $("mtAudio").checked, stream: null, startedAt: new Date().toISOString()
    };
    var ready = Promise.resolve();
    if(variant.processLocally) ready = ready.then(checkOnDevice);
    if(state.audioWanted){
      ready = ready.then(function(){
        if(!navigator.mediaDevices || !window.MediaRecorder) throw new Error("This browser can't record audio. Untick the audio box.");
        return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(st){ state.stream = st; });
      });
    }
    ready.then(function(){
      $("mtSetup").hidden = true; $("mtRec").hidden = false; $("mtDone").hidden = true;
      beginItem();
    }).catch(function(e){
      $("mtScriptNote").textContent = String(e && e.message || e);
      state = null;
    });
  }

  // On-device needs the language pack. available() and install() are
  // Chrome's own checks; install() needs this click to have happened.
  function checkOnDevice(){
    if(!SR.available) return Promise.reject(new Error("This browser has no on-device check (SpeechRecognition.available). Use the site settings."));
    return SR.available({ langs: ["en-US"], processLocally: true }).then(function(r){
      if(r === "available") return;
      if(r === "unavailable") throw new Error("This computer can't recognise speech on-device (Chrome says: unavailable).");
      return SR.install({ langs: ["en-US"], processLocally: true }).then(function(ok){
        if(!ok) throw new Error("The on-device language pack didn't install. Try again, or use the site settings.");
      });
    });
  }

  function now(){ return performance.now(); }

  function beginItem(){
    var it = state.items[state.at];
    state.cur = { n: state.at, target: it.target, entry: it.entry, script: it.script, asked: it.asked,
                  shownAt: new Date().toISOString(), again: state.again, sessions: 0, events: [] };
    state.t0 = now();
    state.stopping = false;
    $("mtCount").textContent = (state.at + 1) + " / " + state.items.length + "  ·  " + state.listTitle + "  ·  " +
      (it.script === "right" ? "read it right" : it.script === "wrong" ? "misread it on purpose" : "noise, not a reading");
    // The word as a student would see it: braces and dots out.
    $("mtWord").textContent = it.target;
    $("mtRightLine").hidden = it.script !== "right";
    $("mtAsk").hidden = it.script === "right";
    if(it.asked){
      $("mtAskSay").textContent = it.asked.say || "(nothing)";
      $("mtAskHow").textContent = it.asked.how || "";
    }
    $("mtLive").textContent = "Listening…";
    openSession();
    if(state.stream) startAudio();
  }

  function log(sid, type, extra){
    var e = { t: Math.round((now() - state.t0) * 10) / 10, session: sid, type: type };
    if(extra) for(var k in extra) e[k] = extra[k];
    state.cur.events.push(e);
    return e;
  }

  function openSession(){
    var cur = state.cur, v = state.variant;
    var rec = new SR();
    rec.lang = SAY_IT.lang;
    rec.continuous = SAY_IT.continuous;
    rec.interimResults = SAY_IT.interimResults;
    if(v.maxAlternatives) rec.maxAlternatives = v.maxAlternatives;
    if(v.processLocally) rec.processLocally = true;
    if(v.phrases && Phrase){ try{ rec.phrases = [new Phrase(cur.target, 5.0)]; }catch(e){ log(0, "note", { note: "phrases refused: " + e.message }); } }
    var sid = ++cur.sessions;
    ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"].forEach(function(name){
      rec["on" + name] = function(){ if(state && state.cur === cur) log(sid, name); };
    });
    rec.onresult = function(ev){
      if(!state || state.cur !== cur) return;
      var results = [];
      for(var i = 0; i < ev.results.length; i++){
        var r = ev.results[i], alts = [];
        for(var j = 0; j < r.length; j++) alts.push({ transcript: r[j].transcript, confidence: r[j].confidence });
        results.push({ isFinal: !!r.isFinal, alts: alts });
      }
      log(sid, "result", { resultIndex: ev.resultIndex, results: results });
      var last = results[results.length - 1];
      if(last && last.alts[0]) $("mtLive").textContent = (last.isFinal ? "final: " : "hearing: ") + last.alts[0].transcript +
        (last.isFinal ? "  (" + Math.round(last.alts[0].confidence * 100) / 100 + ")" : "");
    };
    rec.onerror = function(ev){
      if(!state || state.cur !== cur) return;
      log(sid, "error", { error: ev.error, message: ev.message || "" });
      if(ev.error === "not-allowed" || ev.error === "service-not-allowed"){
        $("mtLive").textContent = "The recogniser was refused (" + ev.error + "). Allow the microphone and reload.";
      }
    };
    rec.onend = function(){
      if(!state || state.cur !== cur) return;
      log(sid, "end");
      if(state.rec !== rec) return;
      state.rec = null;
      if(state.stopping){ if(state.onStopped) state.onStopped(); return; }
      // Chrome ends a continuous session by itself after a stretch of
      // silence; Say It starts a new one 200 ms later, and so does this.
      state.restart = setTimeout(function(){ if(state && state.cur === cur && !state.stopping) openSession(); }, 200);
    };
    state.rec = rec;
    try{ rec.start(); log(sid, "start-called"); }
    catch(e){ log(sid, "error", { error: "start-threw", message: String(e && e.message || e) }); }
  }

  // Ends the item's session the gentle way — stop() lets Chrome send the
  // final for anything still being recognised — and waits for its end.
  function closeItem(keep){
    return new Promise(function(resolve){
      state.stopping = true;
      if(state.restart){ clearTimeout(state.restart); state.restart = null; }
      var done = false;
      function fin(){ if(done) return; done = true; state.onStopped = null; resolve(); }
      state.onStopped = fin;
      var rec = state.rec;
      if(!rec){ fin(); }
      else {
        try{ keep ? rec.stop() : rec.abort(); }catch(e){ fin(); }
        setTimeout(function(){ if(!done){ try{ rec.abort(); }catch(e){} state.rec = null; fin(); } }, 4000);
      }
    }).then(function(){ return stopAudio(); });
  }

  function next(){
    if(!state || state.closing) return;
    state.closing = true;
    $("mtLive").textContent = "Saving…";
    closeItem(true).then(function(audio){
      var cur = state.cur;
      if(audio) cur.audio = audio;
      state.taken.push(cur);
      state.at++; state.again = 0; state.closing = false;
      if(state.at >= state.items.length) finish();
      else beginItem();
    });
  }

  function again(){
    if(!state || state.closing) return;
    state.closing = true;
    closeItem(false).then(function(){
      state.again++; state.closing = false;
      beginItem();
    });
  }

  function stopHere(){
    if(!state || state.closing) return;
    state.closing = true;
    closeItem(false).then(function(){ state.closing = false; finish(); });
  }

  /* ---------------- audio (optional) ----------------
     MediaRecorder on a getUserMedia stream, beside the recogniser — the
     same arrangement as the games' "Hear yourself", so the recogniser's
     own input is what Say It's is. One recording per item. */
  function startAudio(){
    try{
      state.media = new MediaRecorder(state.stream);
      state.parts = [];
      state.media.ondataavailable = function(e){ if(e.data && e.data.size) state.parts.push(e.data); };
      state.media.start();
    }catch(e){ state.media = null; }
  }
  function stopAudio(){
    var m = state.media;
    state.media = null;
    if(!m) return Promise.resolve(null);
    return new Promise(function(res){
      m.onstop = function(){
        if(!state.parts.length){ res(null); return; }
        var blob = new Blob(state.parts, { type: state.parts[0].type || "audio/webm" });
        var fr = new FileReader();
        fr.onload = function(){
          var url = String(fr.result), at = url.indexOf(",");
          res({ mime: blob.type, bytes: blob.size, base64: url.slice(at + 1) });
        };
        fr.onerror = function(){ res(null); };
        fr.readAsDataURL(blob);
      };
      try{ m.stop(); }catch(e){ res(null); }
    });
  }

  /* ---------------- done ---------------- */
  function finish(){
    if(state.stream){ try{ state.stream.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} }
    $("mtRec").hidden = true; $("mtDone").hidden = false;
    var withAudio = state.taken.some(function(x){ return !!x.audio; });
    $("mtDownloadAudio").hidden = !withAudio;
    $("mtSummary").textContent = state.taken.length + " of " + state.items.length + " items recorded from " + state.listTitle +
      " (" + state.script + ", " + state.variant.key + "). Nothing has left this computer.";
  }

  function takesJson(withAudio){
    var v = state.variant;
    return {
      schema: SCHEMA,
      tool: "mic-takes.html",
      recordedAt: state.startedAt,
      listId: state.listId,
      listTitle: state.listTitle,
      family: state.family,
      script: state.script,
      variant: v.key,
      biased: !!v.phrases,
      config: { lang: SAY_IT.lang, continuous: SAY_IT.continuous, interimResults: SAY_IT.interimResults,
                maxAlternatives: v.maxAlternatives || null, processLocally: !!v.processLocally,
                phrases: v.phrases ? "the target word, boost 5.0" : null, startTrack: false },
      listFlags: listFlags(state.listId),
      userAgent: navigator.userAgent,
      room: state.room,
      skipped: state.skipped,
      items: state.taken.map(function(x){
        var o = { n: x.n, target: x.target, entry: x.entry, script: x.script, asked: x.asked, shownAt: x.shownAt,
                  again: x.again, sessions: x.sessions, events: x.events };
        if(withAudio && x.audio) o.audio = x.audio;
        return o;
      })
    };
  }

  function download(withAudio){
    var data = JSON.stringify(takesJson(withAudio), null, 1) + "\n";
    var d = new Date(), pad = function(n){ return (n < 10 ? "0" : "") + n; };
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes());
    var name = "mic-takes-" + state.listId + "-" + state.script + "-" + state.variant.key + "-" + stamp + (withAudio ? "-audio" : "") + ".json";
    var url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    var a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    state.saved = true;
  }

  /* ---------------- wiring ---------------- */
  function init(){
    fillSetup();
    $("mtStart").addEventListener("click", start);
    $("mtNext").addEventListener("click", next);
    $("mtAgain").addEventListener("click", again);
    $("mtStop").addEventListener("click", stopHere);
    $("mtDownload").addEventListener("click", function(){ download(false); });
    $("mtDownloadAudio").addEventListener("click", function(){ download(true); });
    $("mtRestart").addEventListener("click", function(){
      state = null;
      $("mtDone").hidden = true; $("mtSetup").hidden = false;
    });
    document.addEventListener("keydown", function(e){
      if(!state || $("mtRec").hidden) return;
      if(e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if(e.key === "Enter" || e.key === "n" || e.key === "N"){ e.preventDefault(); next(); }
      else if(e.key === "a" || e.key === "A"){ e.preventDefault(); again(); }
    });
    window.addEventListener("beforeunload", function(e){
      if(state && state.taken.length && !state.saved){ e.preventDefault(); e.returnValue = ""; }
    });
  }

  EIAuth.ready().then(function(user){
    if(!user) return;
    EIAuth.unlock();
    if(!EIAuth.isTeacher()){ $("mtDenied").hidden = false; return; }
    $("mtApp").hidden = false;
    init();
  });
})();
