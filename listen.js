/* ════════════════════════════════════════════════════════════════════
   listen.js — a small microphone for a game that isn't about the mic.

   Say It's listening loop (blend-game.js) is not this. That one is the
   whole game: it holds the mic open for a whole round, mutes itself
   around every beep and utterance, re-arms on a timer, and its hold
   lengths were tuned by ear against a room full of Chromebooks. It stays
   exactly where it is and is not refactored into this file. Touching it
   to serve a second caller is how a tuned thing stops being tuned.

   What the flash cards want is much smaller: while a card is face up,
   keep the most recent thing the student said, and hand it over when
   they flip. Nothing scores it, nothing waits on it, and if the mic
   never works the game is unchanged. So this is a wrapper, not a
   refactor — the two coexist on purpose, and the README says so.

     EIListen.available()          is there a recogniser at all
     EIListen.start()              begin (or resume) listening
     EIListen.stop()               stop, and forget the transcript
     EIListen.hold(ms)             go quiet while the page makes noise
     EIListen.onTranscript(fn)     fn(text, isFinal) on every result
     EIListen.onError(fn)          fn(errorName) — "not-allowed" matters
     EIListen.last()               the newest transcript, or ""
     EIListen.clear()              forget it without stopping

   One recogniser per page, because that is all a page can have: Chrome
   will not run two at once.
   ════════════════════════════════════════════════════════════════════ */
window.EIListen = (function(){
  "use strict";

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var rec = null;
  var wanted = false;        // does the caller want the mic on right now
  var listening = false;
  var holdUntil = 0;
  var loopTimer = null, rearmTimer = null;
  var lastText = "";
  var onText = null, onErr = null;

  function now(){ return Date.now(); }
  function quiet(){ return now() < holdUntil; }

  function emit(text, isFinal){
    lastText = text;
    if(onText){ try{ onText(text, isFinal); }catch(e){} }
  }

  function stopRec(){
    if(rec){
      // Null the handlers before aborting: onend would otherwise fire and
      // immediately re-arm the recogniser we are trying to shut down.
      try{ rec.onresult = rec.onerror = rec.onend = null; rec.abort(); }catch(e){}
      rec = null;
    }
    listening = false;
  }

  function arm(){
    if(!SR || !wanted || listening || quiet()) return;
    try{ rec = new SR(); }
    catch(e){ rec = null; return; }

    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;   // catch the guess early, don't wait for final

    rec.onresult = function(ev){
      var interim = "", final = "";
      for(var i = ev.resultIndex; i < ev.results.length; i++){
        var r = ev.results[i];
        if(r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      // A final result is the answer; an interim one is the recogniser
      // thinking out loud, and it is still better than nothing when the
      // student flips before it settles.
      if(final.trim()) emit(final.trim(), true);
      else if(interim.trim()) emit(interim.trim(), false);
    };

    rec.onerror = function(ev){
      var name = ev && ev.error;
      // "no-speech" and "aborted" are ordinary here — the mic is open for
      // a whole card and most cards are read in silence.
      if(name === "not-allowed" || name === "service-not-allowed" || name === "network"){
        wanted = false;
        stopRec();
      }
      if(onErr){ try{ onErr(name); }catch(e){} }
    };

    rec.onend = function(){
      listening = false;
      rec = null;
      // Chrome ends a continuous session on its own after a stretch of
      // silence. Coming straight back is what makes the mic feel always-on.
      if(wanted && !quiet()){
        if(rearmTimer) clearTimeout(rearmTimer);
        rearmTimer = setTimeout(function(){ rearmTimer = null; arm(); }, 200);
      }
    };

    try{ rec.start(); listening = true; }
    catch(e){ listening = false; rec = null; }
  }

  // One slow poll rather than a web of timers: the recogniser can end for
  // reasons nothing here observes, and a tick that just asks "should I be
  // listening?" recovers from all of them the same way.
  function loop(){
    if(loopTimer) return;
    loopTimer = setInterval(function(){
      if(!wanted){ return; }
      if(!listening && !quiet()) arm();
    }, 700);
  }

  return {
    available: function(){ return !!SR; },

    start: function(){
      if(!SR) return false;
      wanted = true;
      loop();
      arm();
      return true;
    },

    stop: function(){
      wanted = false;
      if(rearmTimer){ clearTimeout(rearmTimer); rearmTimer = null; }
      stopRec();
      lastText = "";
    },

    /* Go deaf for a moment. Called around anything the page says out
       loud, so the recogniser never transcribes the computer's own voice
       back as the student's answer — the same reason Say It holds its
       mic, arrived at the same way. */
    hold: function(ms){
      var until = now() + (ms || 0);
      if(until > holdUntil) holdUntil = until;
      stopRec();
      if(rearmTimer) clearTimeout(rearmTimer);
      if(wanted) rearmTimer = setTimeout(function(){ rearmTimer = null; arm(); }, (ms || 0) + 20);
    },

    onTranscript: function(fn){ onText = typeof fn === "function" ? fn : null; },
    onError: function(fn){ onErr = typeof fn === "function" ? fn : null; },
    last: function(){ return lastText; },
    clear: function(){ lastText = ""; }
  };
})();
