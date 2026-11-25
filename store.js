/* ════════════════════════════════════════════════════════════════════
   store.js — one student's practice record, in Firestore.

   Three documents matter to a signed-in student:

     students/{uid}      their own. Read/write by them, read-only to the
                         teacher. Holds the per-word stats (adaptive.js
                         owns their shape), lifetime totals, a short
                         tail of finished rounds, and `seq` — how far
                         through a teacher's sequence they have got (see
                         "A sequence" below).
     assignments/{uid}   written by the TEACHER, read-only to the student:
                         which lists they get — a plain set, or a
                         sequence of steps (`plan`) — and which class
                         they're in.
                         Separate from students/{uid} precisely so the
                         teacher never needs write access to a student's
                         work — see firestore.rules.
     roster/{email}      the imported class list, keyed by the address
                         this student signs in with. Teacher-written; a
                         student may read exactly one document, their
                         own. It is how a student the teacher set up
                         before they ever signed in finds their lists
                         waiting on the first sign-in.

   ── Two rules that are easy to get wrong ──────────────────────────────
   1. A FAILED READ IS NOT AN EMPTY RECORD. If the progress read fails —
      blocked network, offline Chromebook — every local map is empty,
      which is indistinguishable from a brand-new student. Writing then
      would overwrite a term of practice with nothing. So `loadFailed`
      latches and every write is held back until a reload succeeds.
   2. Writes are debounced, and the debounce has to be flushed before
      sign-out. A round of practice that ends with the student clicking
      "Sign out" is exactly the round most likely to be lost.

   ── Whose class ───────────────────────────────────────────────────────
   The roster row's `classId` and `teachers` say which class this student
   is in and who teaches it. On every load, if they differ from what is
   on students/{uid}, they are copied across — that is how a student
   imported into a class reaches its teachers' dashboards, since a
   teacher can only list students whose own doc names them.
   firestore.rules allows the student exactly that change and no other.

   ── A sequence ────────────────────────────────────────────────────────
   When the assignment (or roster row) carries a `plan`, the student's
   lists are not a fixed set: they are the current step, plus every step
   before it (finished lists stay playable). Later steps are never shown.
   Where the student IS is worked out here, in their browser, from their
   own stats, by the same Adaptive.planState the dashboard runs.

   Why not on the teacher's page and written down? Because the student
   can never write assignments/{uid} (firestore.rules), and a teacher's
   browser does not have a student's stats until it opens the dashboard.
   So position is a pure function of two documents the student can read
   and one they can write.

   It is worked out ONCE per page load, never in the middle of a round: a
   student who finishes the last word of a list mid-round plays out the
   round on that list and meets the next one on the next page.

   THE HIGH-WATER MARK. A finished list can be replayed, and a word can
   drop out of the top box. So position is never recomputed from nothing:
   when it comes out further on than what was stored for this plan, the
   new index is written to students/{uid}.seq = { at, of, when }, and next
   time the walk starts from there. `of` is the plan's `setAt`, so a mark
   made under an older plan is ignored the moment a teacher saves a new
   one. A student could edit their own `seq` (the rules let them write
   their own document); the worst that does is move themselves along or
   back their own sequence, which the dashboard shows on the student's
   page as where they are.

   ── Preview ───────────────────────────────────────────────────────────
   index.html?preview=<uid | roster:email>, opened by a TEACHER from the
   dashboard's Student view button, loads that student's assignment,
   roster row and progress instead of the teacher's own, so myLists() is
   what the student would see. Nothing is written while previewing — not
   to the student (the rules would refuse it anyway) and not to the
   teacher's own doc either. Ignored for anyone who isn't a teacher.
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
  var assignment = null;        // { lists, classId, teachers } or null
  var rosterRow = null;         // roster/{email} — the imported class list
  var docClass = null;          // { classId, teachers } as stored on students/{uid}
  var seq = null;               // students/{uid}.seq — the high-water mark (sanitized)
  var pos = null;               // this page load's position in a sequence, or null
  var dirtySeq = false;         // the mark moved and hasn't been written
  var dirtyClass = null;        // the roster's, when it needs copying
  var preview = null;           // { id, name, failed } while a teacher previews
  var loadFailed = false;
  var dirty = {};               // stat keys changed since the last write
  var dirtyHeard = {};          // heard keys changed since the last write
  var dirtyFluency = {};        // fluency lists changed since the last write
  var dirtyMeta = false;
  var saveTimer = null, inFlight = null;
  var retryMs = 0;              // 0 = last save worked; else the next retry's wait

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
     Exactly the ones the teacher gave them, and nothing else. Pure, so
     tests.html can pin it.

     Their own assignment first. Then their roster row's lists: a student
     the teacher set up on the dashboard before they had ever signed in
     has no uid to write an assignment against, so those lists wait on the
     row keyed by their email. An assignment written later outranks it.

     Nothing assigned means nothing shown. There is no period list, no
     class default and no "everything" to fall back to — the teacher
     decides what each student sees, one student at a time, and an empty
     home page says "ask your teacher" rather than guessing. */
  function effectiveLists(assignment, roster){
    if(assignment && Array.isArray(assignment.lists)) return assignment.lists.slice();
    if(roster && Array.isArray(roster.lists)) return roster.lists.slice();
    return [];
  }

  /* The student's sequence, or null: the assignment is the source when it
     has a valid `plan` or a `lists` array, otherwise the roster row is.
     From the source, its plan if valid; `lists` (no plan) is null here and
     is handled by effectiveLists, so a student with no plan is exactly
     what they were before. Pure. */
  function planOf(d){ return d ? Adaptive.sanitizePlan(d.plan) : null; }
  function effectivePlan(assignment, roster){
    if(assignment && (planOf(assignment) || Array.isArray(assignment.lists))) return planOf(assignment);
    return planOf(roster);
  }

  /* Everything the home page and the games need to know about one
     student's lists, in one place. With no plan it is effectiveLists and
     nothing else. With one: the current step's ids, the finished steps'
     ids, and where they are. Pure — stats, seq and totalOf come in. */
  function resolve(assignment, roster, st, sq, totalOf){
    var plan = effectivePlan(assignment, roster);
    if(!plan) return { plan: null, ids: effectiveLists(assignment, roster) };
    var state = Adaptive.planState(plan, st, totalOf, sq);
    var current = state.finished ? [] : plan.steps[state.index].ids.slice();
    var done = [], i, j, n = Math.min(state.index, plan.steps.length);
    for(i=0;i<n;i++){
      for(j=0;j<plan.steps[i].ids.length;j++){
        var id = plan.steps[i].ids[j];
        if(current.indexOf(id) === -1 && done.indexOf(id) === -1) done.push(id);
      }
    }
    return { plan: plan, state: state, current: current, finishedIds: done, ids: done.concat(current) };
  }

  function totalOf(id){
    return WordLists.exists(id) ? WordLists.wordsOf(id).length : 0;
  }

  /* Work out this page load's position, once, and move the high-water
     mark if it went forward. Nothing here for the teacher's own page (it
     shows every game and ignores plans) or when the read failed. */
  function settle(){
    pos = null;
    if(loadFailed) return;
    if(!preview && seesEverything()) return;
    var r = resolve(assignment, rosterRow, stats, seq, totalOf);
    if(!r.plan) return;
    pos = r;
    var stored = (seq && seq.of === r.plan.setAt && seq.at > r.plan.at) ? seq.at : r.plan.at;
    if(r.state.index > stored && !preview){
      /* `when` is when they last MOVED ON by finishing a list, and the
         dashboard reads it as news ("Moved to a new list on Tuesday"). The
         first mark under a plan is not that: a teacher who gives a sequence to
         students already solid on its first lists puts them on a later list
         at once, which is where they LAND, not something they did that week.
         So a landing is marked with when 0, and only a later move (a mark for
         this plan already exists) carries the time. */
      var landing = !(seq && seq.of === r.plan.setAt);
      seq = { at: r.state.index, of: r.plan.setAt, when: landing ? 0 : Date.now() };
      dirtySeq = true;
      scheduleSave();
    }
  }

  /* The roster row's class stamp, when it isn't already on the student's
     own doc — the only fields store.js ever copies from the roster. Copied
     exactly as the row has them: the rules compare them for equality. */
  function classToCopy(row, current){
    if(!row || typeof row.classId !== "string" || !row.classId || !Array.isArray(row.teachers)) return null;
    current = current || {};
    if(current.classId === row.classId &&
       JSON.stringify(current.teachers || null) === JSON.stringify(row.teachers)) return null;
    return { classId: row.classId, teachers: row.teachers.slice() };
  }

  // ?preview=<id> from the address, or null. Pure.
  function previewParam(search){
    var m = /[?&]preview=([^&#]*)/.exec(String(search || ""));
    if(!m) return null;
    try{ return decodeURIComponent(m[1].replace(/\+/g, " ")) || null; }catch(e){ return null; }
  }

  /* A teacher looking at one student's home page. Read-only from start
     to finish: `preview` being set is what turns every write below into
     a no-op, and the local mirror is never touched. A read that fails
     leaves the student's lists empty and says so on the banner, rather
     than quietly showing the teacher's own. */
  function loadPreview(id){
    preview = { id: id, name: "", failed: false };
    stats = {}; heard = {}; fluency = {}; totals = { n:0, r:0 }; recent = [];
    return EIAuth.db().then(function(db){
      if(!db) throw new Error("no db");
      if(id.indexOf("roster:") === 0){
        var em = id.slice(7).toLowerCase();
        return db.collection("roster").doc(em).get().then(function(r){
          rosterRow = r.exists ? r.data() : null;
          preview.name = (rosterRow && rosterRow.name) || em;
        });
      }
      return Promise.all([
        db.collection("students").doc(id).get(),
        db.collection("assignments").doc(id).get()
      ]).then(function(snaps){
        var d = snaps[0].exists ? (snaps[0].data() || {}) : {};
        stats  = Adaptive.sanitizeStats(d.words);
        heard  = Adaptive.sanitizeHeard(d.heard);
        fluency = Adaptive.sanitizeFluency(d.fluency);
        assignment = snaps[1].exists ? snaps[1].data() : null;
        seq = Adaptive.sanitizeSeq(d.seq);
        preview.name = d.name || d.email || "this student";
        var em = String(d.email || "").toLowerCase();
        return em ? db.collection("roster").doc(em).get().then(function(r){
          rosterRow = r.exists ? r.data() : null;
        }).catch(function(){}) : null;
      });
    }).catch(function(){
      preview.failed = true;
    }).then(function(){
      settle();
      readyResolve({ preview:true });
      return readyPromise;
    });
  }

  /* ── loading ─────────────────────────────────────────────────────── */
  function load(u){
    uid = u.uid; user = u;
    var pv = previewParam(location.search);
    if(pv && !u._dev && EIAuth.isTeacher()) return loadPreview(pv);
    stats = readLocal();       // something sensible to work with either way

    if(u._dev){                // dev bypass never authenticates — stay local
      readyResolve({ local:true });
      return readyPromise;
    }

    return EIAuth.db().then(function(db){
      if(!db){ loadFailed = true; readyResolve({ offline:true }); return readyPromise; }
      var mine = db.collection("students").doc(uid);
      /* The student's own document and their assignment are the reads
         whose failure is a failure. A missing assignment DOCUMENT comes
         back as exists:false, not as an error, so a rejection here is a
         real one (offline, blocked) — swallowing it would show a student
         "no games yet" for what is really a dead network. The roster is
         the optional one: a student with no roster row is a student
         nobody has imported, and effectiveLists has an answer for that.
         The roster read in particular fails outright until the rules for
         it are published — see firestore.rules — and that must look
         exactly like "not imported yet", never like a broken account. */
      var email = String((u && u.email) || "").toLowerCase();
      return Promise.all([
        mine.get(),
        db.collection("assignments").doc(uid).get(),
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
        rosterRow  = snaps[2] && snaps[2].exists ? snaps[2].data() : null;
        seq = d ? Adaptive.sanitizeSeq(d.seq) : null;
        docClass = d ? { classId: d.classId, teachers: d.teachers } : null;
        dirtyClass = classToCopy(rosterRow, docClass);
        writeLocal();
        settle();
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
    if(loadFailed || preview || !uid || (user && user._dev)) return;
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
    if(dirtyClass){ p.classId = dirtyClass.classId; p.teachers = dirtyClass.teachers; }
    if(dirtySeq && seq) p.seq = { at: seq.at, of: seq.of, when: seq.when };
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
    if(loadFailed || preview || !uid || (user && user._dev)) return Promise.resolve();
    if(!Object.keys(dirty).length && !Object.keys(dirtyHeard).length &&
       !Object.keys(dirtyFluency).length && !dirtyMeta && !dirtyClass && !dirtySeq) return inFlight || Promise.resolve();
    var sending = dirty, sendingHeard = dirtyHeard, sendingFluency = dirtyFluency, sendingMeta = dirtyMeta;
    var sendingClass = dirtyClass, sendingSeq = dirtySeq;
    var body = payload();
    dirty = {}; dirtyHeard = {}; dirtyFluency = {}; dirtyMeta = false; dirtyClass = null; dirtySeq = false;
    /* Chained behind whatever is already on the wire, never alongside it:
       two overlapping writes could land out of order, and the older
       one's cleanup must not make inFlight look empty while this one is
       still pending — signOut waits on inFlight and would reload
       mid-write. */
    var prev = inFlight || Promise.resolve();
    var me = prev.then(function(){
      return EIAuth.db();
    }).then(function(db){
      if(!db) throw new Error("no db");
      return db.collection("students").doc(uid).set(body, { merge:true });
    }).then(function(){
      retryMs = 0;
      if(sendingClass) docClass = sendingClass;
    }, function(err){
      // Put the unsent keys back so the next save retries them rather than
      // dropping a round of practice on one bad request.
      for(var k in sending){ if(has(sending, k)) dirty[k] = true; }
      for(k in sendingHeard){ if(has(sendingHeard, k)) dirtyHeard[k] = true; }
      for(k in sendingFluency){ if(has(sendingFluency, k)) dirtyFluency[k] = true; }
      if(sendingMeta) dirtyMeta = true;
      if(sendingClass && !dirtyClass) dirtyClass = sendingClass;
      if(sendingSeq) dirtySeq = true;
      console.warn("EIStore: save failed", err);
      /* A denied write will be denied again; the next round's own flush
         can still try, but a timer hammering the rules would not help.
         Anything else (a dropped connection) is retried with a modest
         backoff, so a student who never records another answer still
         gets their last round saved once the Wi-Fi is back. */
      if(!(err && err.code === "permission-denied")){
        retryMs = Math.min(retryMs ? retryMs * 2 : 5000, 60000);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(function(){ flush(); }, retryMs);
      }
    }).then(function(){
      if(inFlight === me) inFlight = null;
    });
    inFlight = me;
    return me;
  }

  /* ── the two things a game calls ──────────────────────────────────── */

  /* One answer. `correct` means right on the FIRST try — the engines pass
     tries===0, and adaptive.js explains why nothing else counts. `ms` is
     how long it took, where the mode can tell (the flash cards time the
     flip); everything else omits it and the timing stays 0. `kind` is
     what sort of wrong it was, which only Say It can say. */
  function record(listId, word, correct, ms, kind){
    if(!uid || preview) return;
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
    if(!uid || preview) return;
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
    if(!uid || preview) return;
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
    if(!uid || preview) return;
    recent.push({ list:String(listId), at:Date.now(), right:right|0, total:total|0 });
    if(recent.length > RECENT_CAP) recent = recent.slice(-RECENT_CAP);
    dirtyMeta = true;
    scheduleSave();
    return flush();     // end of a round is a natural, cheap moment to commit
  }

  /* ── reads for the pages ──────────────────────────────────────────── */
  function statsFor(listId){ return Adaptive.statsForList(stats, listId); }
  /* The teacher and the localhost dev bypass see every list: the teacher
     to try a game before assigning it, the bypass so a game can be opened
     locally without an account. Nobody else is handed a list they
     weren't given. */
  function seesEverything(){
    return !!(window.EIAuth && (EIAuth.isTeacher() || EIAuth.isDev()));
  }

  function myLists(){
    /* The teacher's own view shows what is on offer, so a mode the
       library has retired stops appearing on their home page. A STUDENT
       who still holds a retired id keeps it: it is in their assignment,
       so it is in the list below, and it plays. A teacher previewing a
       student gets that student's list, exactly. */
    /* With a sequence, the current step and the ones before it — see "A
       sequence" at the top. `pos` is this page load's, so the answer does
       not change under a student in the middle of a round. */
    var mine = pos ? pos.ids.slice() : effectiveLists(assignment, rosterRow);
    var ids = preview ? mine
            : seesEverything()
      ? WordLists.all.filter(function(l){ return !l.retired; }).map(function(l){ return l.id; })
      : mine;
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
    seesEverything: seesEverything,
    /* null for a student with no sequence (and for the teacher's own
       page); otherwise what the home page draws: the current step's ids,
       the ids of the finished ones, how many finished, whether that is
       all of them, and where they are. Ids the library no longer has are
       left out. */
    plan: function(){
      if(!pos || !pos.plan) return null;
      var alive = function(id){ return WordLists.exists(id); };
      var n = Math.min(pos.state.index, pos.plan.steps.length), fin = 0, i;
      for(i=0;i<n;i++) if(pos.plan.steps[i].ids.some(alive)) fin++;
      return {
        uid: uid, setAt: pos.plan.setAt,
        index: pos.state.index, count: pos.plan.steps.length,
        finished: pos.state.finished, hold: pos.state.hold,
        current: pos.current.filter(alive),
        finishedIds: pos.finishedIds.filter(alive),
        finishedCount: fin
      };
    },
    // The class this student is in, by id, or null. Their roster row is
    // the record of it; their own doc follows it (see classToCopy).
    classId: function(){
      return (rosterRow && rosterRow.classId) || (docClass && docClass.classId) || null;
    },
    roster: function(){ return rosterRow; },
    failed: function(){ return loadFailed; },
    // { id, name, failed } while a teacher previews a student, else null.
    preview: function(){ return preview ? { id: preview.id, name: preview.name, failed: preview.failed } : null; },
    _internals: {
      previewParam: previewParam,
      effectiveLists: effectiveLists,
      effectivePlan: effectivePlan,
      resolve: resolve,
      settle: settle,
      classToCopy: classToCopy,
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
        assignment = st.assignment || null; rosterRow = st.roster || null;
        seq = st.seq ? Adaptive.sanitizeSeq(st.seq) : null; dirtySeq = false;
        preview = st.preview || null; loadFailed = !!st.loadFailed; pos = null;
      },
      seq: function(){ return seq; },
      dirtySeq: function(){ return dirtySeq; }
    }
  };
})();
