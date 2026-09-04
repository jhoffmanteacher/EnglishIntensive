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
     roster/{email}      the imported class list, keyed by the address
                         this student signs in with. Teacher-written; a
                         student may read exactly one document, their
                         own. It is how a student who has never been
                         touched by the dashboard still lands in the
                         right period on their first sign-in.

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
  var fluency = {};             // listId → [{at, cwpm, errors, n}] oldest first
  var totals = { n:0, r:0 };
  var recent = [];              // [{list, at, right, total}] newest last
  var assignment = null;        // { period, lists } or null
  var rosterRow = null;         // roster/{email} — the imported class list
  var classCfg = null;          // { periodLists, defaultLists, periods }
  var loadFailed = false;
  var dirty = {};               // stat keys changed since the last write
  var dirtyHeard = {};          // heard keys changed since the last write
  var dirtyFluency = {};        // fluency lists changed since the last write
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
     then the roster row the teacher imported them on, then their period's,
     then the class default, then — if the teacher has set nothing at all —
     everything, because a student who signs in on day one should find the
     site full rather than empty. An explicit EMPTY list at any level is a
     real answer and stops the walk; that's how you park a student.

     A missing roster (nothing imported, or the rules not published yet)
     makes the walk exactly what it was before the roster existed, which
     is the property that lets this ship ahead of the rules. */
  function effectiveLists(assignment, classCfg, allIds, roster, seqIds){
    var cfg = classCfg || {};
    if(assignment && Array.isArray(assignment.lists)) return assignment.lists.slice();
    // The roster's own lists come next: a student the teacher placed on
    // the import, before anybody had a uid to assign against. An
    // assignment written later outranks it, which is the whole order.
    if(roster && Array.isArray(roster.lists)) return roster.lists.slice();
    // Then the sequence, where the period has one switched on. It is
    // computed from the student's own practice (adaptive.js explains
    // why), and it replaces the period's flat list rather than adding to
    // it — a period with a course is a period whose list IS the course.
    if(Array.isArray(seqIds)) return seqIds.slice();
    // A period from either place. The assignment's wins where there is
    // one, so a student moved on the dashboard stays moved.
    var period = (assignment && assignment.period) || (roster && roster.period) || null;
    if(period === "") period = null;
    var byPeriod = cfg.periodLists || {};
    if(period != null && Array.isArray(byPeriod[period])) return byPeriod[period].slice();
    if(Array.isArray(cfg.defaultLists)) return cfg.defaultLists.slice();
    return (allIds || []).slice();
  }

  /* ── sequences ─────────────────────────────────────────────────────
     A period may run an ordered course instead of a flat list of lists.
     Where it does, a student's position in it is worked out from their
     own stats every time this runs — nothing is stored, nothing is
     written, and the dashboard computes the identical answer from the
     same function. See Adaptive.unlocked.

     A period with no stored sequence has no course and keeps its flat
     list, which is every period until a teacher builds one. `sequenceOn`
     only ever turns one OFF: a sequence that exists is on unless somebody
     says otherwise. */
  function sequenceStepsFor(period, classCfg){
    var cfg = classCfg || {};
    if(period == null || period === "") return null;
    var all = cfg.sequences || {};
    var steps = all[period];
    if(!Array.isArray(steps) || !steps.length) return null;
    var on = cfg.sequenceOn || {};
    if(has(on, period) && on[period] === false) return null;
    return steps;
  }

  /* Where this student is in their period's course, or null when there
     isn't one. `startAt` comes from the roster row: a student the
     screener placed on Red 3 starts there rather than working up to it. */
  function sequenceState(assignment, classCfg, roster, stats, totalOf, stepOf){
    var period = (assignment && assignment.period) || (roster && roster.period) || null;
    var steps = sequenceStepsFor(period, classCfg);
    if(!steps) return null;
    var startAt = 0;
    var startId = roster && roster.startAt;
    if(startId && typeof stepOf === "function"){
      var at = stepOf(steps, startId);
      if(at >= 0) startAt = at;
    }
    var res = Adaptive.unlocked(steps, stats || {}, startAt, totalOf);
    res.period = period;
    res.steps = steps.length;
    return res;
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
      /* The student's own document is the only read whose failure is a
         failure. The other three are optional by design: a student with
         no assignment, no class config and no roster row is a student on
         day one, and the walk below has an answer for that. The roster
         read in particular fails outright until the rules for it are
         published — see firestore.rules — and that must look exactly
         like "not imported yet", never like a broken account. */
      var email = String((u && u.email) || "").toLowerCase();
      return Promise.all([
        mine.get(),
        db.collection("assignments").doc(uid).get().catch(function(){ return null; }),
        db.collection("config").doc("class").get().catch(function(){ return null; }),
        email ? db.collection("roster").doc(email).get().catch(function(){ return null; })
              : Promise.resolve(null)
      ]).then(function(snaps){
        var d = snaps[0] && snaps[0].exists ? snaps[0].data() : null;
        if(d){
          stats  = Adaptive.sanitizeStats(d.words);
          heard  = Adaptive.sanitizeHeard(d.heard);
          fluency = Adaptive.sanitizeFluency(d.fluency);
          totals = { n: Math.max(0, d.totals && d.totals.n || 0), r: Math.max(0, d.totals && d.totals.r || 0) };
          recent = Array.isArray(d.recent) ? d.recent.slice(-RECENT_CAP) : [];
        }
        assignment = snaps[1] && snaps[1].exists ? snaps[1].data() : null;
        classCfg   = snaps[2] && snaps[2].exists ? snaps[2].data() : null;
        rosterRow  = snaps[3] && snaps[3].exists ? snaps[3].data() : null;
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
    var flOut = {}, anyFl = false;
    for(k in dirtyFluency){ if(has(dirtyFluency, k) && has(fluency, k)){ flOut[k] = fluency[k]; anyFl = true; } }
    var p = {};
    if(any) p.words = words;
    if(anyHeard) p.heard = heardOut;
    if(anyFl) p.fluency = flOut;
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
    if(!Object.keys(dirty).length && !Object.keys(dirtyHeard).length &&
       !Object.keys(dirtyFluency).length && !dirtyMeta) return inFlight || Promise.resolve();
    var sending = dirty, sendingHeard = dirtyHeard, sendingFluency = dirtyFluency, sendingMeta = dirtyMeta;
    var body = payload();
    dirty = {}; dirtyHeard = {}; dirtyFluency = {}; dirtyMeta = false;
    inFlight = EIAuth.db().then(function(db){
      if(!db) throw new Error("no db");
      return db.collection("students").doc(uid).set(body, { merge:true });
    }).catch(function(){
      // Put the unsent keys back so the next save retries them rather than
      // dropping a round of practice on one bad request.
      for(var k in sending){ if(has(sending, k)) dirty[k] = true; }
      for(k in sendingHeard){ if(has(sendingHeard, k)) dirtyHeard[k] = true; }
      for(k in sendingFluency){ if(has(sendingFluency, k)) dirtyFluency[k] = true; }
      if(sendingMeta) dirtyMeta = true;
    }).then(function(){ inFlight = null; });
    return inFlight;
  }

  /* ── the two things a game calls ──────────────────────────────────── */

  /* One answer. `correct` means right on the FIRST try — the engines pass
     tries===0, and adaptive.js explains why nothing else counts. `ms` is
     how long it took, where the mode can tell (the flash cards time the
     flip); everything else omits it and the timing stays 0. `kind` is
     what sort of wrong it was, which only Say It can say. */
  function record(listId, word, correct, ms, kind){
    if(!uid) return;
    var key = Adaptive.keyFor(listId, WordLists.plain(word));
    stats[key] = Adaptive.updateStat(stats[key], !!correct, Date.now(), ms, kind);
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

  /* One finished timed read. Kept per list, oldest first, capped — the
     tail is what makes the dashboard's sparkline, and a single latest
     number would say nothing about whether anything is changing. */
  function recordFluency(listId, run){
    if(!uid) return;
    var key = String(listId);
    var r = { at: Date.now(), cwpm: run && run.cwpm, errors: run && run.errors, n: run && run.n };
    var next = Adaptive.pushRun(fluency[key], r, Adaptive.fluencyCap);
    if(!next.length) return;
    fluency[key] = next;
    dirtyFluency[key] = true;
    scheduleSave();
    return flush();     // end of a run is a natural, cheap moment to commit
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
  // The student's course position, recomputed from live stats — so a
  // list unlocked mid-round shows up as soon as the home page redraws.
  function mySequence(){
    return sequenceState(assignment, classCfg, rosterRow, stats,
      function(id){ return WordLists.wordsOf(id).length; },
      function(steps, id){ return WordLists.stepOf(steps, id); });
  }

  function myLists(){
    var seq = mySequence();
    var ids = effectiveLists(assignment, classCfg, WordLists.ids, rosterRow, seq && seq.ids);
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
    recordFluency: recordFluency,
    fluencyFor: function(listId){
      return Adaptive.fluencySummary(fluency[String(listId)]);
    },
    finishRound: finishRound,
    flush: flush,
    statsFor: statsFor,
    allStats: function(){ return stats; },
    totals: function(){ return { n: totals.n, r: totals.r }; },
    recent: function(){ return recent.slice(); },
    myLists: myLists,
    // The assignment's period, or the roster's where the teacher hasn't
    // set one — which on day one is the only one there is.
    period: function(){
      return (assignment && assignment.period) || (rosterRow && rosterRow.period) || null;
    },
    roster: function(){ return rosterRow; },
    sequence: mySequence,
    failed: function(){ return loadFailed; },
    _internals: {
      effectiveLists: effectiveLists,
      sequenceStepsFor: sequenceStepsFor,
      sequenceState: sequenceState,
      // The write body, for a test that can assert its shape without a
      // Firestore. Reads the module's live state, so a test drives it
      // through the same recordHeard() a game calls.
      payload: payload,
      _feed: function(st){
        uid = st.uid || "test"; user = { _dev:true };
        stats = st.stats || {}; heard = st.heard || {}; fluency = st.fluency || {};
        dirty = st.dirty || {}; dirtyHeard = st.dirtyHeard || {};
        dirtyFluency = st.dirtyFluency || {}; dirtyMeta = !!st.dirtyMeta;
        totals = st.totals || { n:0, r:0 }; recent = st.recent || [];
      }
    }
  };
})();
