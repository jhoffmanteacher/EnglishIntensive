/* ════════════════════════════════════════════════════════════════════
   store.js — one student's practice record, in Firestore.

   Three documents matter to a signed-in student:

     students/{uid}      their own. Read/write by them, read-only to the
                         teacher. Holds the per-word stats (adaptive.js
                         owns their shape), lifetime totals, and a short
                         tail of finished rounds.
     assignments/{uid}   written by the TEACHER, read-only to the student:
                         which period they're in and which lists they get.
                         Separate from students/{uid} precisely so the
                         teacher never needs write access to a student's
                         work — see firestore.rules.
     config/class        class-wide: the per-period list assignments and
                         the default. Everyone reads, teacher writes.

   ── Two rules that are easy to get wrong ──────────────────────────────
   1. A FAILED READ IS NOT AN EMPTY RECORD. If the progress read fails —
      blocked network, offline Chromebook — every local map is empty,
      which is indistinguishable from a brand-new student. Writing then
      would overwrite a term of practice with nothing. So `loadFailed`
      latches and every write is held back until a reload succeeds.
   2. Writes are debounced, and the debounce has to be flushed before
      sign-out. A round of practice that ends with the student clicking
      "Sign out" is exactly the round most likely to be lost.
   ════════════════════════════════════════════════════════════════════ */

window.EIStore = (function(){
  "use strict";

  var SAVE_DEBOUNCE_MS = 1200;
  var RECENT_CAP = 40;          // finished rounds kept on the doc
  var LOCAL_KEY = "eiStats:";   // + uid — offline mirror, see below

  var uid = null, user = null;
  var stats = {};               // "<listId>|<word>" → stat (adaptive.js shape)
  var heard = {};               // same keys → the last few mishearings
  var totals = { n:0, r:0 };
  var recent = [];              // [{list, at, right, total}] newest last
  var assignment = null;        // { period, lists } or null
  var classCfg = null;          // { periodLists, defaultLists, periods }
  var loadFailed = false;
  var dirty = {};               // stat keys changed since the last write
  var dirtyHeard = {};          // heard keys changed since the last write
  var dirtyMeta = false;
  var saveTimer = null, inFlight = null;

  var readyResolve = null;
  var readyPromise = new Promise(function(res){ readyResolve = res; });

  function has(o, k){ return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /* ── local mirror ──────────────────────────────────────────────────
     Firestore is the record of truth; this is a same-device copy so a
     student whose network drops mid-period still sees sensible word
     selection for the rest of the round. It is never merged back up (that
     would need conflict resolution nobody asked for) and it is scoped by
     uid so a shared Chromebook can't leak one student's deck into the
     next student's session. */
  function readLocal(){
    try{
      var raw = JSON.parse(localStorage.getItem(LOCAL_KEY + uid));
      return raw && typeof raw === "object" ? Adaptive.sanitizeStats(raw.words) : {};
    }catch(e){ return {}; }
  }
  function writeLocal(){
    try{ localStorage.setItem(LOCAL_KEY + uid, JSON.stringify({ words: stats })); }catch(e){}
  }

  /* ── which lists is this student supposed to be practicing? ────────
     Pure, so tests.html can pin the precedence rather than trusting a
     reading of it: the student's own assignment wins, then their period's,
     then the class default, then — if the teacher has set nothing at all —
     everything, because a student who signs in on day one should find the
     site full rather than empty. An explicit EMPTY list at any level is a
     real answer and stops the walk; that's how you park a student. */
  function effectiveLists(assignment, classCfg, allIds){
    var cfg = classCfg || {};
    if(assignment && Array.isArray(assignment.lists)) return assignment.lists.slice();
    var period = assignment && assignment.period;
    var byPeriod = cfg.periodLists || {};
    if(period != null && Array.isArray(byPeriod[period])) return byPeriod[period].slice();
    if(Array.isArray(cfg.defaultLists)) return cfg.defaultLists.slice();
    return (allIds || []).slice();
  }

  /* ── loading ─────────────────────────────────────────────────────── */
  function load(u){
    uid = u.uid; user = u;
    stats = readLocal();       // something sensible to work with either way

    if(u._dev){                // dev bypass never authenticates — stay local
      readyResolve({ local:true });
      return readyPromise;
    }

    return EIAuth.db().then(function(db){
      if(!db){ loadFailed = true; readyResolve({ offline:true }); return readyPromise; }
      var mine = db.collection("students").doc(uid);
      return Promise.all([
        mine.get(),
        db.collection("assignments").doc(uid).get().catch(function(){ return null; }),
        db.collection("config").doc("class").get().catch(function(){ return null; })
      ]).then(function(snaps){
        var d = snaps[0] && snaps[0].exists ? snaps[0].data() : null;
        if(d){
          stats  = Adaptive.sanitizeStats(d.words);
          heard  = Adaptive.sanitizeHeard(d.heard);
          totals = { n: Math.max(0, d.totals && d.totals.n || 0), r: Math.max(0, d.totals && d.totals.r || 0) };
          recent = Array.isArray(d.recent) ? d.recent.slice(-RECENT_CAP) : [];
        }
        assignment = snaps[1] && snaps[1].exists ? snaps[1].data() : null;
        classCfg   = snaps[2] && snaps[2].exists ? snaps[2].data() : null;
        writeLocal();
        // Stamp identity on every sign-in: it is what turns an opaque uid
        // into a name on the teacher's roster, and it keeps up with a
        // student whose display name changes mid-year.
        dirtyMeta = true;
        scheduleSave();
        readyResolve({ ok:true });
        return readyPromise;
      });
    }).catch(function(){
      // Latches. See rule 1 at the top of the file.
      loadFailed = true;
      readyResolve({ failed:true });
      return readyPromise;
    });
  }

  /* ── saving ──────────────────────────────────────────────────────── */
  function scheduleSave(){
    if(loadFailed || !uid || (user && user._dev)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function(){ flush(); }, SAVE_DEBOUNCE_MS);
  }

  function payload(){
    var words = {}, any = false;
    for(var k in dirty){ if(has(dirty, k) && has(stats, k)){ words[k] = stats[k]; any = true; } }
    var heardOut = {}, anyHeard = false;
    for(k in dirtyHeard){ if(has(dirtyHeard, k) && has(heard, k)){ heardOut[k] = heard[k]; anyHeard = true; } }
    var p = {};
    if(any) p.words = words;
    if(anyHeard) p.heard = heardOut;
    if(dirtyMeta){
      p.name  = (user && user.displayName) || null;
      p.email = (user && user.email) || null;
      p.photo = (user && user.photoURL) || null;
    }
    p.totals = { n: totals.n, r: totals.r };
    p.recent = recent.slice(-RECENT_CAP);
    p.lastSeen = Date.now();
    return p;
  }

  /* Merge-write, not overwrite: `set(..., {merge:true})` deep-merges map
     fields, so sending only the words that changed leaves every other
     word's history untouched. That matters on a shared Chromebook where
     two tabs of the same account can be open at once. */
  function flush(){
    clearTimeout(saveTimer); saveTimer = null;
    if(loadFailed || !uid || (user && user._dev)) return Promise.resolve();
    if(!Object.keys(dirty).length && !Object.keys(dirtyHeard).length && !dirtyMeta) return inFlight || Promise.resolve();
    var sending = dirty, sendingHeard = dirtyHeard, sendingMeta = dirtyMeta;
    var body = payload();
    dirty = {}; dirtyHeard = {}; dirtyMeta = false;
    inFlight = EIAuth.db().then(function(db){
      if(!db) throw new Error("no db");
      return db.collection("students").doc(uid).set(body, { merge:true });
    }).catch(function(){
      // Put the unsent keys back so the next save retries them rather than
      // dropping a round of practice on one bad request.
      for(var k in sending){ if(has(sending, k)) dirty[k] = true; }
      for(k in sendingHeard){ if(has(sendingHeard, k)) dirtyHeard[k] = true; }
      if(sendingMeta) dirtyMeta = true;
    }).then(function(){ inFlight = null; });
    return inFlight;
  }

  /* ── the two things a game calls ──────────────────────────────────── */

  /* One answer. `correct` means right on the FIRST try — the engines pass
     tries===0, and adaptive.js explains why nothing else counts. */
  function record(listId, word, correct){
    if(!uid) return;
    var key = Adaptive.keyFor(listId, WordLists.plain(word));
    stats[key] = Adaptive.updateStat(stats[key], !!correct, Date.now());
    totals.n += 1; if(correct) totals.r += 1;
    dirty[key] = true;
    writeLocal();
    scheduleSave();
  }

  /* What the recogniser thought it heard on a miss. Say It calls this
     with the final transcript, once per wrong answer — never on a right
     one, since there is nothing to learn from a transcript that matched.
     Separate from record() because it is teacher-facing evidence, not a
     score: nothing in the scheduler reads it. */
  function recordHeard(listId, word, text){
    if(!uid) return;
    var key = Adaptive.keyFor(listId, WordLists.plain(word));
    var next = Adaptive.pushHeard(heard[key], text, Adaptive.heardCap);
    if(!next.length) return;
    heard[key] = next;
    dirtyHeard[key] = true;
    scheduleSave();
  }

  // One finished round, for the teacher's "last active" column and the
  // student's own history. Capped — this is a tail, not a log.
  function finishRound(listId, right, total){
    if(!uid) return;
    recent.push({ list:String(listId), at:Date.now(), right:right|0, total:total|0 });
    if(recent.length > RECENT_CAP) recent = recent.slice(-RECENT_CAP);
    dirtyMeta = true;
    scheduleSave();
    return flush();     // end of a round is a natural, cheap moment to commit
  }

  /* ── reads for the pages ──────────────────────────────────────────── */
  function statsFor(listId){ return Adaptive.statsForList(stats, listId); }
  function myLists(){
    var ids = effectiveLists(assignment, classCfg, WordLists.ids);
    // Drop assignments naming a list that no longer exists, so a deleted
    // list doesn't render a broken tile.
    return ids.filter(function(id){ return WordLists.exists(id); });
  }

  EIAuth.ready().then(function(u){
    if(u) load(u);
    // No user (EI_REQUIRE_AUTH === false, e.g. tests.html): stay idle. The
    // ready promise deliberately never resolves there — nothing on such a
    // page waits on it.
  });

  return {
    ready: function(){ return readyPromise; },
    record: record,
    recordHeard: recordHeard,
    finishRound: finishRound,
    flush: flush,
    statsFor: statsFor,
    allStats: function(){ return stats; },
    totals: function(){ return { n: totals.n, r: totals.r }; },
    recent: function(){ return recent.slice(); },
    myLists: myLists,
    period: function(){ return assignment ? assignment.period : null; },
    failed: function(){ return loadFailed; },
    _internals: {
      effectiveLists: effectiveLists,
      // The write body, for a test that can assert its shape without a
      // Firestore. Reads the module's live state, so a test drives it
      // through the same recordHeard() a game calls.
      payload: payload,
      _feed: function(st){
        uid = st.uid || "test"; user = { _dev:true };
        stats = st.stats || {}; heard = st.heard || {};
        dirty = st.dirty || {}; dirtyHeard = st.dirtyHeard || {}; dirtyMeta = !!st.dirtyMeta;
        totals = st.totals || { n:0, r:0 }; recent = st.recent || [];
      }
    }
  };
})();
