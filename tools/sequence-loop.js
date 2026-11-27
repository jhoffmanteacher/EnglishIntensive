/* sequence-loop.js — the in-browser half of tools/sequence-loop.mjs. Build-time check, not part of the
   site. Runs in tools/sequence-loop.html, in headless Chrome under a virtual clock; the runner passes the cases in
   the address and collects each case's result from a POST to /__seq/report.

   THE QUESTION. When a teacher gives, changes and removes sequences on the dashboard, and students practise, do the
   dashboard and the student's own home page agree about which list the student is on, which lists they can play and
   which are finished — one sequence and two at once — and is that what the README's rules say?

   WHAT IS REAL. Each page is the site's own HTML, served by the runner with only its two gstatic Firebase tags
   swapped for tools/sequence-loop-fake.js, in a same-origin iframe of this page:
     teacher   teacher.html — firebase-config.js, auth.js, adaptive.js, game-core.js, word-lists.js, teacher.js.
               Signed in as a teacher (a teachers/{email} doc, not the admin), loaded once per case and then driven
               only by its own controls: the Students rows, a student's row (opens their page), ← All students,
               Refresh, the two sections of a student's page, Red Words and Other lists (Give Red Words, Use a
               saved sequence + Use it, Copy from another student + Copy, Add a list with its chooser and ways,
               ▲ / ▼, Take out, the percent − / +, Move on now, Go back to this list, Put these in order, Save,
               Discard, Stop using this sequence) and Give a sequence to N selected (the ticks, the source, the
               percent, the warning, Give it). window.confirm answers yes; window.open is
               caught so Student view's address can be opened in a frame here.
     student  index.html for each student — firebase-config.js, auth.js, adaptive.js, word-lists.js, store.js,
               practice.js and the page's inline script. Freshly loaded after every step. The student practises by
               calling that page's EIStore.record(listId, word, right) for lists the page shows, and the write goes
               out through store.js's own debounce and pagehide flush. A student set up before they ever signed in
               meets the real sign-in wall and presses its own Sign in with Google button.
     preview  index.html?preview=<id>, the address the student's page's Student view button opens, signed in as the
               teacher.

   WHAT IS FAKE (self-tested before every batch: T1-T10).
     - Firestore: ONE in-memory server per case, shared by every frame. doc().get/set/delete, collection().get,
       where(field, '==' | 'array-contains', v).get, batch().set/delete/commit (all or nothing), doc() with no id
       (a counter), FieldValue.delete() (a sentinel that removes the field, nested too). set(…, {merge:true})
       deep-merges maps and replaces arrays and scalars (an empty map replaces); a set without merge, or onto a
       missing doc, replaces the doc. Bodies are copied when set() is called; snapshots are copied into the
       calling page's own realm.
     - The network: every request lands 8-60 ms later (seeded), and one page's requests land in the order they
       were made. A request from a page that has since been navigated away still lands, but its promise never
       settles (the page is gone).
     - Rules, minimal: a signed-in teacher may read anything, but a list query must carry
       where('teachers', 'array-contains', <their email>) (the admin's needs none); a student may read only
       students/{uid}, assignments/{uid}, roster/{their email} and teachers/{their email}. Only a student writes
       students/{uid}, their own; only a teacher writes anything else. Checked when the request lands, against
       whoever is signed in then.
     - Auth: one session per account (the teacher's is shared by the dashboard and Student view, as tabs of one
       browser share it). onAuthStateChanged answers 5 ms after it is registered; signInWithPopup takes 50 ms.
     - The clock is Chrome's own virtual time (--virtual-time-budget): nothing on any page is replaced.
     - The Firestore SDK script auth.js adds to <head> on first use is not fetched; the fake's firestore() is put in
       place and the tag's onload called 10 ms later.
     - Every page shares this page's localStorage, as they would on one device: the keys are per student
       (eiStats:<uid>, ei.plan.seen:<uid>, ei.plan.seen2:<uid>), and the case clears it before it starts.

   THE ANSWER KEY. Written again here from the README, never by calling adaptive.js, store.js or teacher.js: a ledger
   of every answer (a word is solid when it is in the top box, 5, and right on at least 90 % of first tries; a right
   answer moves it up a box, a miss down one); "finished" a step when every way in it has at least
   ceil(bar × words) solid words; one way at a time (the first way of the step is open, the next when every way
   before it is finished so, or once it has been played) and the teaching order of each family; the walk (start at `at`; if the student's own mark is this plan's and further on,
   start there; if held, stop; else walk on while finished); the high-water mark (written by the student's own page
   when the walk comes out further than what is stored for this plan); and each dashboard control as the README
   words it (Move on now, Go back, the percent, Add a list, ▲▼, Take out, a saved / ready-made / copied sequence
   replacing only the lists still to come, Save writing a changed sequence afresh at the step shown as Now and an
   unchanged one back exactly as stored, Stop, Give putting each kind where it belongs). The key keeps each student's
   two sequences in fixed places: 0 Red Words (`plan`, mark `seq`), 1 Other lists (`plan2`, mark `seq2`). It reads
   only setAt (an identity: the time a save happened) from what was stored, and checks that it is new when it
   should be.

   THE CHECKS — after every step, for every student:
     S1 agree. The dashboard (the Students row: Now on / Place, and the student's page: the editor's rows, Now, the
        held line, the percent, the Now row's "Open: … · Next: …") states for each sequence the list they are on,
        "List N of M", finished, held, which of its ways are open; the student's freshly loaded home page shows the
        open ways of each current list, the "Lists you finished (N)" fold and the notice ("New list: …", "New: Cards
        for …");
        each equals the answer key, and the dashboard's Now / Finished rows name the same lists as the home page's
        tiles and fold. Also: what was stored is the plan the key expects (steps, percent, at, hold).
     S2 only theirs. The home page never shows a list beyond the current step, a way of the current list not open
        yet, one never given, or one the teacher took out (unless the other sequence holds it).
     S3 independent. A step that touches one sequence (a practice batch on its lists; Move on now, Go back, the
        percent or any edit to it) leaves the other's stored plan byte for byte and its stated position unchanged.
     S4 no backwards. Replaying a finished list with misses never moves a student back; Go back to this list does,
        and holds them there through any practice until Move on now; a stored mark (seq.at / seq2.at) never goes
        down for the same plan. And K1 on the HOME PAGE after every Save, Give and Stop, from what is stored
        (homeFromStore / checkK1 — never the dashboard's draft): every finished list stays finished, every current
        list stays current or finished, a held list stays held; exempt only Go back, a raised percent, a list taken
        out, and the sequence Give replaced or Stop removed.
     S5 new plan, fresh start. A sequence saved afresh (an edit, Give) carries a setAt never used before for that
        student and field, and the student lands where the key's walk from its `at`, with no old mark, puts them;
        Give starts each student on the first list they have not already finished.
     S6 each in its place. After every dashboard action, `plan` holds only red lists and `plan2` none, and Add a
        list offers only its section's kind.
     S7 before sign-in. A student set up on the roster before they ever signed in sees, on their first sign-in, what
        the dashboard's page for them (as a roster row) said they would; and once they have signed in, the
        dashboard's writes go to their assignment and take both sequences with them.
     S8 the preview. Student view (index.html?preview=…) shows the same current tiles, fold and finished line as the
        student's own page, and writes nothing.
     S9 Say it in every step. Every step of every stored sequence and of every saved sequence holds its list's Say it
        id; the home page shows each current list's Say it tile once it is open; no step is walked past while its
        Say it is below the bar; Add a list and Change ways show Say it ticked and locked with the line that says
        why, and stay so when the harness tries to untick it.
     S10 one way at a time. Every stored step and every saved sequence is in its family's teaching order (the
        README's table, written again as ORDER below); Add a list and Change ways show their boxes in that order; a
        way the student has played never disappears from the home page while they are on that list (read from the
        pages one load to the next, not from the key's rule — "slip" practice drops an earlier way below the bar to
        try it); and the Now row's "Open: …" names exactly the ways the home page shows of that list.

   THE FAMILIES (round robin): one-sequence, two-sequences, teacher-steps-in, re-plan, bulk, roster-first, stop.
   Each case has 1-3 students, a class with three saved sequences (one of red lists, one of other lists, one of any
   — random lists, ways and percents), some students
   already solid on a list or two, some with games and no order; then 7-10 steps of the family's kind of mix.

   KNOWN — real site faults, printed "~ known" and not failed. See KNOWN below.
*/
(function(){
  "use strict";

  var OUT = document.getElementById("out"), FRAMES = document.getElementById("frames");
  var Q = new URLSearchParams(location.search);
  var FAULT = Q.get("fault") || "", VERBOSE = Q.get("verbose") === "1";
  /* ?shots=1 (by hand only, never from the runner): at a few named moments the page sets its title to
     "shot:<name>" and waits until window.SEQ_SHOT_DONE is that name, so a person (or Playwright) can look at, or
     photograph, the frames. Off, it costs nothing. */
  var SHOTS = Q.get("shots") === "1";
  async function shot(name){
    if(!SHOTS) return;
    document.title = "shot:" + name;
    await until(function(){ return window.SEQ_SHOT_DONE === name; }, 600000);
  }
  var BATCH = Number(Q.get("batch") || 0), SEED = Number(Q.get("seed") || 1);
  var JOBS = String(Q.get("cases") || "").split(",").filter(Boolean).map(function(s){
    var p = s.split(":"); return { i: Number(p[0]), fam: p[1], seed: Number(p[2]) >>> 0 };
  });
  var FAMILIES = ["one-sequence", "two-sequences", "teacher-steps-in", "re-plan", "bulk", "roster-first", "stop"];
  var FAKE_FAULTS = ["merge", "delete", "where"];
  var ADMIN = "jhoffman@seq.org";                 // firebase-config.js's ADMIN_EMAILS; the loop's teacher is not it
  var TEACHER = { uid: "uid-teacher-01", email: "teacher.one@seq.org", displayName: "Teacher One" };
  var CLASS_ID = "c-period-3";
  var W = window.WordLists;
  var FINISHED_ALL = "You finished all your lists. Ask your teacher what comes next.";

  /* ── small things ──────────────────────────────────────────────────── */
  function mulberry32(a){
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function Rng(seed){
    var f = mulberry32(seed);
    var r = { f: f,
      int: function(lo, hi){ return lo + Math.floor(f() * (hi - lo + 1)); },
      pick: function(a){ return a[Math.floor(f() * a.length)]; },
      chance: function(p){ return f() < p; },
      shuffle: function(a){ a = a.slice(); for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(f() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; } };
    return r;
  }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  async function until(cond, ms){
    var end = Date.now() + ms;
    for(;;){
      var v = false;
      try{ v = cond(); }catch(e){ v = false; }
      if(v) return v;
      if(Date.now() >= end) return false;
      await sleep(20);
    }
  }
  function lower(x){ return String(x == null ? "" : x).toLowerCase(); }
  function uniq(a){ var o = []; a.forEach(function(x){ if(o.indexOf(x) === -1) o.push(x); }); return o; }
  function sorted(a){ return a.slice().sort(); }
  function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
  function post(obj){
    return fetch("/__seq/report", { method: "POST", body: JSON.stringify(obj) }).catch(function(){});
  }

  /* ════════════════════════════════════════════════════════════════════
     THE FAKE: one Firestore, one Auth, shared by every frame
     ════════════════════════════════════════════════════════════════════ */
  var DEL = Object.freeze({ seqLoopDelete: true });
  function isMap(v){ return v !== null && typeof v === "object" && !Array.isArray(v) && v !== DEL; }
  function copy(v){
    if(v === DEL) return DEL;
    if(Array.isArray(v)) return v.map(copy);
    if(v !== null && typeof v === "object"){ var o = {}; Object.keys(v).forEach(function(k){ o[k] = copy(v[k]); }); return o; }
    return v;
  }
  function strip(v){
    if(Array.isArray(v)) return v.map(strip);
    if(isMap(v)){ var o = {}; Object.keys(v).forEach(function(k){ if(v[k] !== DEL) o[k] = strip(v[k]); }); return o; }
    return v;
  }

  function Server(){ this.docs = {}; this.writes = []; }
  Server.prototype.read = function(p){ return this.docs[p] === undefined ? undefined : copy(this.docs[p]); };
  Server.prototype.apply = function(p, body, merge){
    if(!merge || !this.docs[p]){ this.docs[p] = strip(body); return; }
    (function into(t, s, top){
      Object.keys(s).forEach(function(k){
        var v = s[k];
        if(v === DEL){ if(FAULT !== "delete") delete t[k]; return; }
        if(isMap(v) && Object.keys(v).length && isMap(t[k]) && !(FAULT === "merge" && top)) into(t[k], v, false);
        else t[k] = strip(v);
      });
    })(this.docs[p], body, true);
  };
  Server.prototype.remove = function(p){ delete this.docs[p]; };
  Server.prototype.list = function(col, where){
    var self = this, out = [];
    Object.keys(this.docs).sort().forEach(function(p){
      var i = p.indexOf("/");
      if(p.slice(0, i) !== col || p.indexOf("/", i + 1) !== -1) return;
      var d = self.docs[p];
      if(where){
        if(FAULT === "where" && where.op === "array-contains") return;
        var v = d[where.field];
        if(where.op === "array-contains" ? !(Array.isArray(v) && v.indexOf(where.value) !== -1) : v !== where.value) return;
      }
      out.push({ id: p.slice(i + 1), data: copy(d) });
    });
    return out;
  };

  var SV = new Server();      // the case's server
  var SESS = {};              // session key → { user, signedIn, listeners }
  var PAGES = {};             // load id → page
  var LOADS = 0, AUTO = 0, INFLIGHT = 0;
  var FRNG = Rng(1);          // the fake's own randomness (latency), reseeded per case
  var HOOK = { write: null, confirm: null, open: null };

  function teacherish(u){ return !!u && (lower(u.email) === ADMIN || SV.docs["teachers/" + lower(u.email)] !== undefined); }
  function mayRead(u, col, id, where){
    if(!u) return false;
    if(teacherish(u)){
      if(id === null && col !== "teachers" && lower(u.email) !== ADMIN)
        return !!(where && where.field === "teachers" && where.op === "array-contains" && where.value === lower(u.email));
      return true;
    }
    if(id === null) return false;
    if(col === "students" || col === "assignments") return id === u.uid;
    if(col === "roster" || col === "teachers") return id === lower(u.email);
    return false;
  }
  function mayWrite(u, col, id){
    if(!u) return false;
    if(col === "students") return id === u.uid;
    return teacherish(u) && col !== "teachers";
  }
  function userOf(sess){ return sess && sess.signedIn ? sess.user : null; }
  function denied(win){ return { code: "permission-denied", message: "Missing or insufficient permissions." }; }

  /* A client: what one page load gets as `firebase`. `page` = { id, role, win, alive(), lastLand, inflight }. */
  function makeClient(page, sess){
    var win = page.win;
    function inRealm(v){ return v === undefined ? undefined : win.JSON.parse(JSON.stringify(v)); }
    function op(fn){
      return new win.Promise(function(res, rej){
        var t = Math.max(Date.now() + FRNG.int(8, 60), page.lastLand + 1);
        page.lastLand = t; page.inflight++; INFLIGHT++;
        setTimeout(function(){
          page.inflight--; INFLIGHT--;
          var r;
          try{ r = { v: fn() }; }catch(e){ r = { e: e }; }
          if(!page.alive()) return;
          if(r.e) rej(inRealm(r.e && r.e.code ? r.e : { code: "internal", message: String(r.e) }));
          else res(r.v);
        }, Math.max(0, t - Date.now()));
      });
    }
    function logWrite(path, body, kind){
      var w = { at: Date.now(), page: page.role + "#" + page.id, role: page.role, load: page.id, path: path, kind: kind, body: body === null ? null : copy(body) };
      SV.writes.push(w);
      if(HOOK.write) try{ HOOK.write(w); }catch(e){}
    }
    function docSnap(col, id, d){
      return { id: id, exists: d !== undefined, data: function(){ return inRealm(d); }, ref: ref(col, id) };
    }
    function ref(col, id){
      var path = col + "/" + id;
      return { id: id, path: path, _col: col,
        get: function(){ return op(function(){ if(!mayRead(userOf(sess), col, id)) throw denied(); return docSnap(col, id, SV.read(path)); }); },
        set: function(data, opts){
          var body = copy(data), merge = !!(opts && opts.merge);
          return op(function(){ if(!mayWrite(userOf(sess), col, id)) throw denied(); SV.apply(path, body, merge); logWrite(path, body, "set"); });
        },
        delete: function(){ return op(function(){ if(!mayWrite(userOf(sess), col, id)) throw denied(); SV.remove(path); logWrite(path, null, "delete"); }); }
      };
    }
    function query(col, where){
      return {
        where: function(f, o, v){ return query(col, { field: f, op: o, value: v }); },
        get: function(){
          return op(function(){
            if(!mayRead(userOf(sess), col, null, where)) throw denied();
            var docs = SV.list(col, where).map(function(r){ return docSnap(col, r.id, r.data); });
            return { docs: docs, size: docs.length, empty: !docs.length, forEach: function(fn){ docs.forEach(function(d){ fn(d); }); } };
          });
        }
      };
    }
    var db = {
      collection: function(col){
        var q = query(col, null);
        return { doc: function(id){ return ref(col, id === undefined ? "auto" + (++AUTO) : String(id)); }, where: q.where, get: q.get };
      },
      batch: function(){
        var ops = [];
        return {
          set: function(r, data, opts){ ops.push({ kind: "set", path: r.path, col: r._col, id: r.id, body: copy(data), merge: !!(opts && opts.merge) }); return this; },
          delete: function(r){ ops.push({ kind: "delete", path: r.path, col: r._col, id: r.id }); return this; },
          commit: function(){
            return op(function(){
              var u = userOf(sess);
              ops.forEach(function(o){ if(!mayWrite(u, o.col, o.id)) throw denied(); });
              ops.forEach(function(o){
                if(o.kind === "delete"){ SV.remove(o.path); logWrite(o.path, null, "delete"); }
                else { SV.apply(o.path, o.body, o.merge); logWrite(o.path, o.body, "batch"); }
              });
            });
          }
        };
      }
    };
    function firestore(){ return db; }
    firestore.FieldValue = { delete: function(){ return DEL; } };

    function userCopy(){ return inRealm(sess.user); }
    function later(ms, fn){ setTimeout(function(){ if(page.alive()) fn(); }, ms); }
    var auth = {
      get currentUser(){ return sess.signedIn ? userCopy() : null; },
      onAuthStateChanged: function(fn){
        var l = { fn: fn, page: page };
        sess.listeners.push(l);
        later(5, function(){ fn(sess.signedIn ? userCopy() : null); });
        return function(){ sess.listeners = sess.listeners.filter(function(x){ return x !== l; }); };
      },
      signInWithPopup: function(){
        return new win.Promise(function(res, rej){
          later(50, function(){
            if(!sess.user){ rej(inRealm({ code: "auth/popup-closed-by-user" })); return; }
            sess.signedIn = true;
            notify(sess);
            res({ user: userCopy() });
          });
        });
      },
      signOut: function(){ sess.signedIn = false; notify(sess); return win.Promise.resolve(); }
    };
    function authFn(){ return auth; }
    authFn.GoogleAuthProvider = function(){ this.setCustomParameters = function(){}; };
    return { fb: { initializeApp: function(){}, auth: authFn, apps: [] }, firestore: firestore, db: db };
  }
  function notify(sess){
    sess.listeners.forEach(function(l){
      if(!l.page.alive()) return;
      setTimeout(function(){ if(l.page.alive()) l.fn(sess.signedIn ? l.page.win.JSON.parse(JSON.stringify(sess.user)) : null); }, 1);
    });
  }

  /* What tools/sequence-loop-fake.js calls from inside a frame, before auth.js runs. */
  function install(win){
    var fe = win.frameElement;
    var role = fe.getAttribute("data-role"), sess = SESS[fe.getAttribute("data-sess")];
    if(!sess){ win.document.title = "sequence-loop: no session"; return; }
    var id = ++LOADS;
    fe.__seqLoad = id;
    var page = { id: id, role: role, win: win, lastLand: 0, inflight: 0, alive: function(){ return fe.__seqLoad === id; } };
    PAGES[id] = page;
    var c = makeClient(page, sess);
    win.firebase = c.fb;
    // auth.js adds the Firestore SDK as a <script> on first use: answer it with the fake instead of the network.
    var head = win.document.head, orig = head.appendChild;
    head.appendChild = function(node){
      if(node && node.tagName === "SCRIPT" && /gstatic\.com/.test(node.src || "")){
        setTimeout(function(){ if(!page.alive()) return; c.fb.firestore = c.firestore; if(typeof node.onload === "function") node.onload(); }, 10);
        return node;
      }
      return orig.call(this, node);
    };
    win.confirm = function(msg){ if(HOOK.confirm) HOOK.confirm(role, String(msg)); return true; };
    win.alert = function(msg){ if(HOOK.confirm) HOOK.confirm(role, "alert: " + String(msg)); };
    win.open = function(url){ if(HOOK.open) HOOK.open(role, String(url), win); return null; };
  }
  window.SEQ_HARNESS = { install: install };

  /* ════════════════════════════════════════════════════════════════════
     THE SELF-TEST OF THE FAKE (T1-T10)
     ════════════════════════════════════════════════════════════════════ */
  async function selfTest(){
    var out = [];
    function t(id, what, ok, got){ out.push({ id: id, what: what, ok: !!ok, got: ok ? "" : (got || "") }); }
    SV = new Server(); SESS = {}; FRNG = Rng(7);
    var s = SV;
    s.apply("x/a", { words: { k1: { n: 1, r: 1 } }, totals: { n: 1 }, recent: [1, 2] }, true);
    s.apply("x/a", { words: { k2: { n: 1, r: 0 }, k1: { n: 2 } }, recent: [3] }, true);
    var a = s.read("x/a");
    t("T1", "merge keeps other words and other fields of a word", a.words.k2 && a.words.k1 && a.words.k1.r === 1 && a.words.k1.n === 2 && a.totals.n === 1, JSON.stringify(a));
    t("T2", "arrays and scalars are replaced whole", JSON.stringify(a.recent) === "[3]", JSON.stringify(a.recent));
    s.apply("x/b", { plan: { at: 1 }, plan2: { at: 2 }, sequences: { k1: { name: "a" }, k2: { name: "b" } } }, true);
    s.apply("x/b", { plan2: DEL, sequences: { k1: DEL } }, true);
    var b = s.read("x/b");
    t("T3", "FieldValue.delete() removes a field, top-level and nested", b.plan && !("plan2" in b) && !("k1" in b.sequences) && b.sequences.k2, JSON.stringify(b));
    // pages without frames, for the client's own rules
    function fakePage(role, sessKey){
      var fe = { __seqLoad: ++LOADS }, id = fe.__seqLoad;
      return { page: { id: id, role: role, win: window, lastLand: 0, inflight: 0, alive: function(){ return fe.__seqLoad === id; } }, fe: fe, sess: SESS[sessKey] };
    }
    SESS.t = { user: { uid: "tu", email: "t@seq.org" }, signedIn: true, listeners: [] };
    SESS.s = { user: { uid: "su", email: "s@seq.org" }, signedIn: true, listeners: [] };
    s.docs["teachers/t@seq.org"] = { name: "T" };
    s.docs["students/su"] = { teachers: ["t@seq.org"], email: "s@seq.org" };
    s.docs["students/sv"] = { teachers: ["other@seq.org"] };
    var T = fakePage("teacher", "t"), Sx = fakePage("student", "s");
    var tdb = makeClient(T.page, T.sess).db, sdb = makeClient(Sx.page, Sx.sess).db;
    var q1 = await tdb.collection("students").where("teachers", "array-contains", "t@seq.org").get();
    var q2 = null; await tdb.collection("students").get().then(function(r){ q2 = "allowed"; }, function(e){ q2 = e.code; });
    t("T4", "where('teachers','array-contains',me) finds exactly the teacher's docs; a teacher's list without it is refused",
      q1.size === 1 && q1.docs[0].id === "su" && q2 === "permission-denied", "size " + q1.size + ", unfiltered " + q2);
    var bad = null;
    await tdb.batch().set(tdb.collection("assignments").doc("su"), { lists: ["x"] }, { merge: true })
      .set(tdb.collection("students").doc("su"), { words: {} }, { merge: true }).commit().catch(function(e){ bad = e.code; });
    t("T5", "a batch is all or nothing (a teacher may not write students/)", bad === "permission-denied" && s.read("assignments/su") === undefined, bad + " " + JSON.stringify(s.read("assignments/su")));
    var w1 = null, r1 = null, r2 = null;
    await sdb.collection("assignments").doc("su").set({ lists: [] }, { merge: true }).catch(function(e){ w1 = e.code; });
    await sdb.collection("students").doc("sv").get().catch(function(e){ r1 = e.code; });
    var own = await sdb.collection("students").doc("su").get().then(function(x){ return x.exists; }, function(e){ return e.code; });
    await sdb.collection("roster").doc("s@seq.org").get().then(function(x){ r2 = x.exists ? "exists" : "read"; }, function(e){ r2 = e.code; });
    t("T6", "a student writes only students/{own} and reads only their own docs",
      w1 === "permission-denied" && r1 === "permission-denied" && own === true && r2 === "read", [w1, r1, own, r2].join(" "));
    var order = [];
    var ps = [];
    for(var k = 0; k < 10; k++) ps.push(sdb.collection("students").doc("su").set({ o: k }, { merge: true }).then((function(kk){ return function(){ order.push(kk); }; })(k)));
    await Promise.all(ps);
    t("T7", "one page's writes land in the order they were made", order.join() === "0,1,2,3,4,5,6,7,8,9" && s.read("students/su").o === 9, order.join());
    var settled = false, D = fakePage("student", "s"), ddb = makeClient(D.page, D.sess).db;
    ddb.collection("students").doc("su").set({ gone: 1 }, { merge: true }).then(function(){ settled = true; });
    D.fe.__seqLoad = 0;               // the page navigates away
    await sleep(200);
    t("T8", "a write from a page that has gone still lands, and its promise never settles", s.read("students/su").gone === 1 && !settled, "landed " + s.read("students/su").gone + ", settled " + settled);
    var sk = null; SESS.s.signedIn = false;
    await sdb.collection("students").doc("su").set({ z: 1 }, { merge: true }).catch(function(e){ sk = e.code; });
    var tu = makeClient(T.page, T.sess).fb.auth().currentUser, su = makeClient(Sx.page, Sx.sess).fb.auth().currentUser;
    t("T9", "auth is per account: a signed-out student is refused, the teacher's session is untouched",
      sk === "permission-denied" && tu && tu.email === "t@seq.org" && su === null, sk + " " + (tu && tu.email) + " " + su);
    // The pages as the runner serves them: the fake where the SDK was, the CSP kept.
    var pagesOk = true, why = "";
    for(var p of ["/index.html", "/teacher.html"]){
      var html = await fetch(p).then(function(r){ return r.text(); });
      if(/firebasejs\/[^"]*firebase-(app|auth)-compat/.test(html)) { pagesOk = false; why += p + " still loads the SDK; "; }
      if(html.indexOf('src="/tools/sequence-loop-fake.js"') === -1) { pagesOk = false; why += p + " has no fake; "; }
      if(html.indexOf("Content-Security-Policy") === -1) { pagesOk = false; why += p + " lost its CSP; "; }
    }
    t("T10", "index.html and teacher.html are served with the fake in place of the SDK, CSP intact", pagesOk, why);
    return out;
  }

  /* ════════════════════════════════════════════════════════════════════
     THE LIBRARY, as the key sees it (data only: word-lists.js)
     ════════════════════════════════════════════════════════════════════ */
  var HREF2ID = {};
  W.all.forEach(function(l){ HREF2ID[W.hrefOf(l.id)] = l.id; });
  function exists(id){ return !!W.byId(id); }
  function words(id){ return exists(id) ? W.wordsOf(id).slice() : []; }
  function total(id){ return words(id).length; }
  function listKey(id){ var l = W.byId(id); return l ? l.family + ":" + l.listNum : "?" + id; }
  function titleOf(id){ var l = W.byId(id); return l ? l.listTitle : String(id); }
  var LIB_ORDER = {}; W.all.forEach(function(l, i){ LIB_ORDER[l.id] = i; });
  function libSort(ids){ return ids.slice().sort(function(a, b){ return (LIB_ORDER[a] || 0) - (LIB_ORDER[b] || 0); }); }
  // Every list (family:number) and the ways it may be given (not retired).
  var LISTS = [];
  W.families().forEach(function(f){
    W.listNumsOf(f.key).forEach(function(n){
      var ids = W.idsOfList(f.key, n).filter(function(id){ return exists(id) && !W.byId(id).retired; });
      if(ids.length) LISTS.push({ key: f.key + ":" + n, fam: f.key, n: n, ids: ids });
    });
  });
  // README "A student's page": the two ready-made sequences, Say it and Cards where the family offers them.
  function readyMade(key){
    var fams = key === "red" ? ["red"] : ["blends-start", "blends-end", "digraphs", "silent-e", "r-vowels", "vowel-teams", "oi-oy", "endings", "multi"], steps = [];
    fams.forEach(function(fk){
      W.listNumsOf(fk).forEach(function(n){
        var offered = W.idsOfList(fk, n);
        var ids = ["say", "cards"].map(function(m){ return W.idFor(fk, n, m); }).filter(function(id){ return id && offered.indexOf(id) !== -1; });
        if(ids.length) steps.push({ ids: keyStep(ids) });
      });
    });
    return steps;
  }

  /* SAY IT IN EVERY STEP, and THE TEACHING ORDER, in the key's own words (README "Families and modes", "Sequences"):
     a step of a sequence holds its list's Say it way, whatever else it holds (a list with no Say it way is left as
     it is), and its ways are in the family's one teaching order — the site sets it, the teacher only ticks. A way
     the table does not name (a retired one) goes after the named ones; an id the library does not know goes last.
     The table is the README's, written again here, never read from word-lists.js. */
  var ORDER = { "blends-start": ["match", "say", "cards", "spell"], "blends-end": ["match", "say", "cards", "spell"],
                "nonsense": ["blendit", "say", "cards", "fluency"], "oi-oy": ["match", "say", "cards", "spell"],
                "digraphs": ["match", "say", "cards", "spell"], "silent-e": ["match", "say", "cards", "spell"],
                "r-vowels": ["match", "say", "cards", "spell"], "vowel-teams": ["match", "say", "cards", "spell"],
                "multi": ["split", "match", "say", "cards", "spell"], "red": ["match", "cards", "say", "spell"] };
  function orderRank(id){
    var l = W.byId(id); if(!l) return 1e6;
    var k = (ORDER[l.family] || []).indexOf(l.mode);
    return k !== -1 ? k : 1000 + ["say", "spell", "cards", "match", "fluency", "blendit", "split"].indexOf(l.mode);
  }
  function keyOrder(ids){
    return ids.map(function(id, i){ return { id: id, i: i }; })
      .sort(function(a, b){ return orderRank(a.id) - orderRank(b.id) || a.i - b.i; }).map(function(x){ return x.id; });
  }
  function keyStep(ids){
    var l = null;
    for(var i = 0; i < ids.length && !l; i++) l = W.byId(ids[i]);
    if(!l) return ids.slice();
    var say = null;
    W.all.forEach(function(x){ if(x.family === l.family && x.listNum === l.listNum && x.mode === "say" && !x.retired) say = x.id; });
    return keyOrder(say && ids.indexOf(say) === -1 ? ids.concat([say]) : ids.slice());
  }
  function saySteps(steps){ return steps.map(function(st){ return { ids: keyStep(st.ids) }; }); }
  function sayIdOf(step){ return keyStep(step.ids).filter(function(id){ var l = W.byId(id); return l && l.mode === "say"; })[0] || null; }
  function lacksSay(step){ var k = sayIdOf(step); return !!k && step.ids.indexOf(k) === -1; }

  /* RED WORDS AND OTHER LISTS, in the key's own words (README "Sequences"): a student has at most one Red Words
     sequence (red lists only, stored as `plan`, mark `seq`) and one Other lists sequence (every other family,
     `plan2`, mark `seq2`). The key keeps both by that place: 0 Red Words, 1 Other lists — the section on the
     student's page, the field and the mark are the same number. A list's kind is its permanent id: red lists'
     ids start "red-". */
  var KINDS = ["red", "other"], SECTION_NAME = ["Red Words", "Other lists"], FIELDS = ["plan", "plan2"], MARKS = ["seq", "seq2"];
  function stepKindOf(ids){ return /^red-/.test(ids[0] || "") ? "red" : "other"; }
  function ofKind(steps, kind){ return steps.filter(function(st){ return stepKindOf(st.ids) === kind; }); }
  function listKind(L){ return L.fam === "red" ? "red" : "other"; }

  /* ════════════════════════════════════════════════════════════════════
     THE ANSWER KEY — the README's rules, written again
     ════════════════════════════════════════════════════════════════════ */
  var TOP_BOX = 5, SOLID_ACC = 0.9;
  function answerStat(st, right){
    st = st || { n: 0, r: 0, box: 0 };
    st = { n: st.n + 1, r: st.r + (right ? 1 : 0), box: right ? Math.min(TOP_BOX, st.box + 1) : Math.max(0, st.box - 1) };
    return st;
  }
  function solid(st){ return !!st && st.box >= TOP_BOX && st.n > 0 && st.r / st.n >= SOLID_ACC; }
  function solidCount(stats, id){ return words(id).filter(function(w){ return solid(stats[id + "|" + w]); }).length; }
  // ceil(bar × total) in whole words; bar is a whole number of percent, so this is exact.
  function needOf(bar, tot){ var pct = Math.round(bar * 100); return Math.floor((pct * tot + 99) / 100); }
  function stepDone(step, bar, stats){
    return step.ids.every(function(id){ var tot = total(id); return tot <= 0 || solidCount(stats, id) >= needOf(bar, tot); });
  }
  /* ONE WAY AT A TIME (README "Sequences"): of the step they are on, the first way is open; each next one opens when
     every way before it has reached the bar (a list the library does not have is skipped); and a way they have
     played (any answer on it) stays open whatever the ones before it say. */
  function played(stats, id){ var p = id + "|"; return Object.keys(stats).some(function(k){ return k.indexOf(p) === 0; }); }
  function keyOpen(step, bar, stats){
    var out = [], reached = true;
    step.ids.forEach(function(id){
      if(reached || played(stats, id)) out.push(id);
      var tot = total(id);
      if(tot > 0 && solidCount(stats, id) < needOf(bar, tot)) reached = false;
    });
    return out;
  }
  // The home page's sentence when ways open on the list they are on: "New: Cards for Blend Words." / "New: Cards and Say it for …".
  function modeTitle(id){ var l = W.byId(id), m = l && W.modeOf(l.mode); return m ? m.title : id; }
  function openedLine(ids){
    var names = ids.map(modeTitle);
    var said = names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    return "New: " + said + " for " + titleOf(ids[0]) + ".";
  }
  // The dashboard's line on the Now row of a step with more than one way: "Open: Match It · Next: Say it, then Cards".
  function openLineOf(step, open){
    var live = step.ids.filter(exists), shut = live.filter(function(id){ return open.indexOf(id) === -1; });
    return "Open: " + live.filter(function(id){ return open.indexOf(id) !== -1; }).map(modeTitle).join(", ") +
      (shut.length ? " · Next: " + shut.map(modeTitle).join(", then ") : "");
  }
  function walk(plan, stats, mark){
    var n = plan.steps.length, start = plan.at;
    if(mark && mark.of === plan.setAt && mark.at > start) start = Math.min(mark.at, n);
    if(plan.hold && start < n) return { index: start, hold: true, finished: false };
    var i = start;
    while(i < n && stepDone(plan.steps[i], plan.bar, stats)) i++;
    return { index: i, hold: false, finished: i >= n };
  }
  function cloneSteps(steps){ return steps.map(function(s){ return { ids: s.ids.slice() }; }); }
  function clonePlan(p){ return p ? { steps: cloneSteps(p.steps), bar: p.bar, at: p.at, hold: p.hold, setAt: p.setAt } : null; }
  function stepKeysOf(steps){ return steps.map(function(s){ return listKey(s.ids[0]); }); }

  function Stu(c, k, opts){
    var r = c.rng, num = 100200 + k * 17 + r.int(0, 15);
    this.k = k;
    this.letter = "ABC"[k];
    this.uid = "uid-" + Math.floor(r.f() * 4294967296).toString(16).padStart(8, "0");
    this.email = num + "@seq.org";
    this.name = "Student " + this.letter + " " + num;
    this.pending = !!opts.pending;      // never signed in: the dashboard knows them by their roster row
    this.stats = {};
    this.plans = [null, null];
    this.plain = null;                  // lists, when there is no plan
    this.marks = [null, null];
    this.seen = [null, null];
    this.setAts = [[], []];             // per slot: a mark is per field (seq / seq2), so a setAt is new per slot
    this.drafts = [null, null];
    this.removed = {};
    this.obsDash = null;                // the last dashboard statement, per sequence
    this.home = null;                   // the last home page read
    this.prediction = null;             // S7: what the dashboard said before their first sign-in
  }
  Stu.prototype.dashUid = function(){ return this.pending ? "roster:" + this.email : this.uid; };
  Stu.prototype.plansList = function(){ return this.plans.filter(Boolean); };
  Stu.prototype.pos = function(k){ var p = this.plans[k]; return p ? walk(p, this.stats, this.marks[k]) : null; };
  Stu.prototype.answer = function(id, w, right){ var key = id + "|" + w; this.stats[key] = answerStat(this.stats[key], right); };
  // The ways of sequence k's current list that are open (none when it is finished).
  Stu.prototype.open = function(k){ var p = this.plans[k], pos = this.pos(k); return p && !pos.finished ? keyOpen(p.steps[pos.index], p.bar, this.stats) : []; };
  // Where sequence k is in the Students row: Red Words first, so Other lists is second only beside Red Words.
  Stu.prototype.disp = function(k){ return k === 1 && this.plans[0] ? 1 : 0; };

  /* What the home page should show. */
  function expectHome(s){
    var ps = s.plansList();
    if(!ps.length){
      var ids = (s.plain || []).filter(exists);
      return { current: sorted(uniq(ids)), fold: null, foldCount: 0, notice: "", empty: !ids.length, plan: false };
    }
    var cur = [], fin = [], count = 0, allFin = true, lines = [], seenNext = [null, null];
    s.plans.forEach(function(p, k){
      if(!p) return;
      var pos = s.pos(k), n = p.steps.length, open = s.open(k).filter(exists);
      open.forEach(function(id){ cur.push(id); });
      if(!pos.finished) allFin = false;
      for(var i = 0; i < Math.min(pos.index, n); i++){
        if(p.steps[i].ids.some(exists)) count++;
        p.steps[i].ids.forEach(function(id){ if(exists(id)) fin.push(id); });
      }
      /* The notice, per sequence: "New list: …" the first load after moving on; "New: Cards for …" the first load
         that shows a way of the same list it had not shown before (the note remembers every way it has shown for
         this list, so one that hid and came back is not said twice); nothing on the first load ever. */
      var prev = s.seen[k], same = !!prev && prev.setAt === p.setAt;
      var seen = same && prev.index === pos.index && prev.open ? prev.open : null;
      if(!pos.finished && same && prev.index < pos.index){ if(open.length) lines.push({ k: k, line: "New list: " + titleOf(open[0]) + "." }); }
      else if(!pos.finished && seen){
        var fresh = open.filter(function(id){ return seen.indexOf(id) === -1; });
        if(fresh.length) lines.push({ k: k, line: openedLine(fresh) });
      }
      seenNext[k] = { setAt: p.setAt, index: pos.index, open: (seen || []).concat(open.filter(function(id){ return !seen || seen.indexOf(id) === -1; })) };
    });
    cur = uniq(cur);
    fin = uniq(fin).filter(function(id){ return cur.indexOf(id) === -1; });
    var notice = allFin ? FINISHED_ALL : lines.map(function(x){ return x.line; }).join(" ");
    return { current: sorted(cur), fold: fin.length ? sorted(fin) : null, foldCount: fin.length ? count : 0, notice: notice,
             empty: false, plan: true, allFinished: allFin, seenNext: seenNext };
  }
  function homeText(h){
    if(!h) return "nothing";
    if(h.failed) return "the page did not load (" + h.failed + ")";
    return "now [" + h.current.join(", ") + "]" + (h.fold ? " · finished (" + h.foldCount + ") [" + h.fold.join(", ") + "]" : "") +
      (h.notice ? ' · notice "' + h.notice + '"' : "") + (h.empty ? " · empty" : "");
  }
  /* What the dashboard should state, per sequence. */
  function expectDash(s){
    var ps = s.plansList();
    if(!ps.length){
      var ids = (s.plain || []).filter(exists);
      return ids.length ? { kind: "plain" } : { kind: "none" };
    }
    // The row and the page: one entry per sequence they have, Red Words first, labelled only when there are two.
    return { kind: ps.length > 1 ? "two" : "one", seqs: [0, 1].filter(function(k){ return !!s.plans[k]; }).map(function(k){
      var p = s.plans[k], pos = s.pos(k), n = p.steps.length, now = pos.finished ? null : p.steps[pos.index];
      return { index: Math.min(pos.index, n), n: n, finished: pos.finished, held: pos.hold && !pos.finished,
               label: ps.length > 1 ? SECTION_NAME[k] : "",
               pct: Math.round(p.bar * 100), titles: p.steps.map(function(st){ return titleOf(st.ids[0]); }),
               // README "A student's page": the Now row of a list with more than one way says which are open.
               openLine: now && now.ids.length > 1 ? openLineOf(now, s.open(k)) : "" };
    }) };
  }
  function seqText(q, withTitles){
    if(!q) return "none";
    if(q.other) return "unreadable: " + q.other;
    var t = q.finished ? "finished all " + q.n : "List " + (q.index + 1) + " of " + q.n + (q.held ? " · held" : "");
    if(withTitles && q.titles) t += " · " + q.pct + "% · [" + q.titles.join(" | ") + "]" + (q.openLine ? " · " + q.openLine : "");
    return t;
  }
  function dashText(d, withTitles){
    if(!d) return "nothing";
    if(d.kind === "missing") return "no row for this student";
    if(d.kind === "pending" || d.kind === "plain" || d.kind === "none") return d.kind;
    return d.seqs.map(function(q){ return (q.label ? q.label + ": " : "") + seqText(q, withTitles); }).join(" ; ");
  }

  /* The editor's drafts, as the README describes them — one per section (0 Red Words, 1 Other lists). */
  function draftShape(d){ return JSON.stringify({ steps: d.steps, bar: d.bar, at: d.at, hold: d.hold }); }
  // A section's stored sequence as the page shows it before any edit — where the student really is — or null.
  function savedDraft(s, sec){
    var p = s.plans[sec]; if(!p) return null;
    var pos = s.pos(sec);
    /* wasN is the end only for a student who WAS past the end when the editor opened (teacher.js draftFromSaved's
       endAt). A student Move on now carries onto a step added in the same edit is not "past the end", and a raised
       percent must not walk them back to the old last list. */
    var d = { kind: KINDS[sec], steps: cloneSteps(p.steps), bar: p.bar, at: pos.index, hold: pos.hold, hasPlan: true,
              wasN: pos.index >= p.steps.length ? p.steps.length : -1, wasBar: p.bar };
    d.base = draftShape(d);
    return d;
  }
  function keyDraft(s, sec){
    if(!s.drafts[sec]) s.drafts[sec] = savedDraft(s, sec) || { kind: KINDS[sec], steps: [], bar: 0.9, at: 0, hold: false, hasPlan: false, base: null };
    return s.drafts[sec];
  }
  function draftDirty(d){ return !!d && (d.hasPlan ? draftShape(d) !== d.base : d.steps.length > 0); }
  /* The step shown as Now: the real position while untouched. Edited, K1: nothing the teacher does moves a student
     backwards except Go back to this list, or raising the percent. So the walk starts where the student is — or
     where Move on now / Go back put them — and only a raised percent measures again the list they were last on: a
     student past the end of the sequence is measured again on its last list, and may be on it again. Lists added
     after the end are walked into from the end. */
  function draftNow(s, sec, d){
    if(d.hasPlan && !draftDirty(d)) return s.pos(sec).index;
    if(!d.steps.length) return 0;
    var start = d.at;
    if(d.hasPlan && !d.hold && d.at === d.wasN && d.bar > d.wasBar) start = d.wasN - 1;
    return walk({ steps: d.steps, bar: d.bar, at: start, hold: d.hold, setAt: -1 }, s.stats, null).index;
  }
  /* "Replaces only the lists still to come": keep up to Now, add what is not already in it — only the steps of the
     section's kind (an order with none of them adds nothing). */
  function replaceLater(d, idx, steps, exclude){
    var keep = d.steps.slice(0, Math.min(d.steps.length, idx + 1));
    var used = stepKeysOf(keep).concat(exclude || []), added = 0;
    steps.forEach(function(st){
      if(stepKindOf(st.ids) !== d.kind) return;
      var kk = listKey(st.ids[0]); if(used.indexOf(kk) === -1){ used.push(kk); keep.push({ ids: keyStep(st.ids) }); added++; }
    });
    return { steps: keep, added: added };
  }
  // One section as Save writes it: afresh at the step shown as Now when it changed, else exactly as stored; null for none.
  function keyEntry(s, sec, d){
    if(!d || !d.steps.length) return null;
    if(!draftDirty(d)) return { plan: s.plans[sec], fresh: false };
    var idx = draftNow(s, sec, d), n = d.steps.length, at = Math.max(0, Math.min(idx, n));
    // Save writes every step through Say it and the teaching order, the ones not edited too.
    return { plan: { steps: saySteps(d.steps), bar: d.bar, at: at, hold: !!d.hold && at === d.at && at < n, setAt: null }, fresh: true };
  }
  // Entries by section → { plans, fresh }.
  function keyBody(entries){
    return { plans: entries.map(function(e){ return e ? e.plan : null; }), fresh: entries.map(function(e){ return !!(e && e.fresh); }) };
  }

  /* ════════════════════════════════════════════════════════════════════
     ONE CASE
     ════════════════════════════════════════════════════════════════════ */
  function Case(job){
    this.i = job.i; this.fam = job.fam; this.seed = job.seed;
    this.rng = Rng(job.seed); this.frng = Rng((job.seed ^ 0x5bd1e995) >>> 0);
    this.failures = []; this.known = []; this.held = 0; this.lines = [];
    this.step = 0; this.stepName = "setup";
    this.students = []; this.saved = [];
    this.n = { steps: 0, teacherActions: 0, answers: 0, homeLoads: 0, previews: 0 };
    this.confirms = []; this.opened = null; this.markHist = {};
  }
  Case.prototype.log = function(s){ if(VERBOSE) this.lines.push("  [case " + this.i + " · step " + this.step + "] " + s); };
  Case.prototype.where = function(){ return this.step + " (" + this.stepName + ")"; };
  Case.prototype.fail = function(check, what, expected, got){
    var f = { check: check, step: this.where() + (what ? " · " + what : ""), expected: expected, got: got };
    for(var i = 0; i < KNOWN.length; i++) if(KNOWN[i].match(f, this)){
      this.known.push({ id: KNOWN[i].id, title: KNOWN[i].title, step: f.step, expected: expected, got: got });
      this.log("~ known " + KNOWN[i].id + " " + check + " " + f.step + ": expected " + expected + ", got " + got);
      return;
    }
    this.failures.push(f);
    this.log("✗ " + check + " " + f.step + ": expected " + expected + ", got " + got);
  };
  Case.prototype.ok = function(check, what){ this.held++; if(VERBOSE) this.log("✓ " + check + " " + what); };
  Case.prototype.check = function(check, what, expected, got){
    if(expected === got) this.ok(check, what + ": " + got);
    else this.fail(check, what, expected, got);
    return expected === got;
  };

  /* ── frames ── */
  function makeFrame(role, sessKey){
    var f = document.createElement("iframe");
    f.setAttribute("data-role", role); f.setAttribute("data-sess", sessKey);
    FRAMES.appendChild(f);
    return f;
  }
  async function navigate(f, url){
    f.__seqLoad = 0;
    if(f.contentWindow && f.contentWindow.location && f.contentWindow.location.href !== "about:blank") f.contentWindow.location.replace(url);
    else f.src = url;
    await until(function(){ return f.__seqLoad > 0 && f.contentDocument && f.contentDocument.readyState === "complete"; }, 20000);
  }
  function pageOf(f){ return PAGES[f.__seqLoad] || null; }
  async function quiet(extra){
    await until(function(){ return INFLIGHT === 0; }, 60000);
    await sleep(extra || 30);
    await until(function(){ return INFLIGHT === 0; }, 60000);
  }

  /* ── the student's side ── */
  function homeReady(f){
    var d = f.contentDocument, m = d && d.getElementById("sections"), wall = d && d.getElementById("ei-auth-wall");
    return !!(m && m.childElementCount > 0 && (!wall || wall.hidden));
  }
  function readHome(f){
    var d = f.contentDocument, m = d.getElementById("sections");
    var fold = m.querySelector("details.finishedFold");
    function idsIn(el, outsideFold){
      return sorted(uniq(Array.prototype.filter.call(el.querySelectorAll("a.gameRow"), function(a){ return !(outsideFold && fold && fold.contains(a)); })
        .map(function(a){ return HREF2ID[a.getAttribute("href")] || "?" + a.getAttribute("href"); })));
    }
    function titlesIn(el, outsideFold){
      return sorted(uniq(Array.prototype.filter.call(el.querySelectorAll(".tileFamily > h2"), function(h){ return !(outsideFold && fold && fold.contains(h)); })
        .map(function(h){ return h.textContent; })));
    }
    var notice = m.querySelector(".planLine"), empty = m.querySelector(".empty"), tv = m.querySelector(".teacherView");
    var sum = fold ? fold.querySelector("summary").textContent : "";
    var mm = /\((\d+)\)/.exec(sum);
    return { current: idsIn(m, true), fold: fold ? idsIn(fold, false) : null, foldCount: mm ? Number(mm[1]) : 0,
             notice: notice ? notice.textContent : "", empty: !!empty, emptyText: empty ? empty.textContent : "",
             teacherView: tv ? tv.textContent : "", currentTitles: titlesIn(m, true), foldTitles: fold ? titlesIn(fold, false) : [] };
  }

  /* ── the teacher's side ── */
  function tdoc(c){ return c.tf.contentDocument; }
  function tq(c, sel){ return tdoc(c).querySelector(sel); }
  function click(el){ el.click(); }
  function change(c, el, value){ el.value = value; el.dispatchEvent(new c.tf.contentWindow.Event("change", { bubbles: true })); }
  async function teacherQuiet(c){
    await quiet(40);
    await until(function(){ var b = tq(c, "#tRefresh"); return b && !b.disabled; }, 30000);
  }
  function goRoster(c){ var b = tq(c, "#tBack"); if(b) click(b); return !!tq(c, ".stTable"); }
  function openStudent(c, s){
    goRoster(c);
    var tr = tq(c, '#tBody tr.clickable[data-uid="' + CSS.escape(s.dashUid()) + '"]');
    if(!tr) return false;
    click(tr);
    return !!tq(c, "#stuPanel-lists");
  }
  // A section's editor: data-which is the SECTION (0 Red Words, 1 Other lists), never the field.
  function editorEl(c, sec){ return tq(c, '#stuPanel-lists .seqEditor[data-which="' + sec + '"]'); }
  async function refresh(c){
    goRoster(c);
    click(tq(c, "#tRefresh"));
    await sleep(5);
    await teacherQuiet(c);
  }
  function parsePart(nowText, placeText, label){
    nowText = nowText.trim();
    var m = /^Finished all (\d+)$/.exec(nowText);
    if(m) return { finished: true, n: Number(m[1]), index: Number(m[1]), held: false, label: label || "" };
    var p = /^List (\d+) of (\d+)( · held)?$/.exec(placeText.trim());
    if(p) return { index: Number(p[1]) - 1, n: Number(p[2]), held: !!p[3], finished: false, title: nowText, label: label || "" };
    return { other: nowText + " | " + placeText };
  }
  function readRow(c, s){
    var tr = tq(c, '#tBody tr.clickable[data-uid="' + CSS.escape(s.dashUid()) + '"]');
    if(!tr) return { kind: "missing" };
    if(tr.classList.contains("pending")) return { kind: "pending" };
    var now = tr.querySelector(".stNow"), place = tr.querySelector(".stPlace");
    var parts = now.querySelectorAll(".stPart");
    if(parts.length){
      var pl = place.querySelectorAll(".stPart");
      // Each part: its label (.stWhich) over the list's name.
      return { kind: "two", seqs: Array.prototype.map.call(parts, function(p, k){
        var lab = p.querySelector(".stWhich"), lt = lab ? lab.textContent : "";
        return parsePart(p.textContent.slice(lt.length), pl[k] ? pl[k].textContent : "", lt);
      }) };
    }
    if(/no order/.test(place.textContent)) return { kind: "plain" };
    if(/No lists yet/.test(now.textContent)) return { kind: "none" };
    return { kind: "one", seqs: [parsePart(now.textContent, place.textContent)] };
  }
  function readDetail(c){
    var panel = tq(c, "#stuPanel-lists");
    if(!panel) return { kind: "missing" };
    if(panel.querySelector(".seqNoOrder")) return { kind: "plain" };
    var eds = Array.prototype.slice.call(panel.querySelectorAll(".seqEditor[data-which]"));
    var seqs = eds.map(function(ed){
      var rows = Array.prototype.slice.call(ed.querySelectorAll("li.seqRow"));
      var kinds = rows.map(function(r){ return r.classList.contains("now") ? "now" : r.classList.contains("fin") ? "fin" : "later"; });
      var n = rows.length, ni = kinds.indexOf("now");
      var idx = ni !== -1 ? ni : (n && kinds.every(function(x){ return x === "fin"; }) ? n : -1);
      var pct = ed.querySelector(".seqPct");
      return { index: idx, n: n, finished: n > 0 && idx === n, held: !!ed.querySelector(".seqHeld"),
               pct: pct ? parseInt(pct.textContent, 10) : null,
               titles: rows.map(function(r){ return r.querySelector(".seqName").textContent; }),
               nowTitles: rows.filter(function(r, i){ return kinds[i] === "now"; }).map(function(r){ return r.querySelector(".seqName").textContent; }),
               openLine: (ed.querySelector(".seqRow.now .seqOpen") || {}).textContent || "",
               finTitles: rows.filter(function(r, i){ return kinds[i] === "fin"; }).map(function(r){ return r.querySelector(".seqName").textContent; }) };
    }).filter(function(q){ return q.n > 0; });
    if(!seqs.length) return { kind: "none" };
    return { kind: seqs.length > 1 ? "two" : "one", seqs: seqs };
  }

  /* ════════════════════════════════════════════════════════════════════
     SETUP
     ════════════════════════════════════════════════════════════════════ */
  function randomSteps(c, m, avoid, kind){
    var r = c.rng, pool = r.shuffle(LISTS.filter(function(L){ return (!avoid || avoid.indexOf(L.key) === -1) && (!kind || listKind(L) === kind); })), out = [];
    for(var i = 0; i < pool.length && out.length < m; i++){
      var L = pool[i], ids = r.shuffle(L.ids).slice(0, r.chance(0.3) ? 2 : 1);
      out.push({ ids: libSort(ids) });
    }
    return out;
  }
  function solidStat(){ return { n: 5, r: 5, w: 0, s: 5, box: 5, last: Date.now() - 86400000 * 3, lat: 0, k: {} }; }

  async function setup(c, spec){
    SV = new Server(); SESS = {}; PAGES = {}; FRNG = c.frng;
    try{ localStorage.clear(); sessionStorage.clear(); }catch(e){}
    FRAMES.innerHTML = "";
    var now = Date.now(), r = c.rng;
    SV.docs["teachers/" + TEACHER.email] = { name: TEACHER.displayName, addedAt: now - 9e8, addedBy: ADMIN };
    // Three saved sequences on the class: random lists, ways and percents, overlapping on purpose — one of red lists,
    // one of other lists, one of any (usually both: an order a section uses only its own kind of).
    var seqs = {};
    ["sA", "sB", "sC"].forEach(function(key, j){
      var steps = saySteps(randomSteps(c, r.int(2, 4), null, j === 0 ? "red" : j === 1 ? "other" : null)), bar = r.pick([0.6, 0.75, 0.9, 0.9, 1]);
      seqs[key] = { name: "Saved " + "ABC"[j], steps: steps, bar: bar, createdAt: now - 86400000 * (j + 2) };
      c.saved.push({ key: "sv:" + CLASS_ID + "/" + key, label: "Saved " + "ABC"[j], steps: cloneSteps(steps), bar: bar, saved: true });
    });
    SV.docs["classes/" + CLASS_ID] = { name: "Period 3", teachers: [TEACHER.email], archived: {}, createdAt: now - 9e8, createdBy: TEACHER.email, sequences: seqs };
    SESS.teacher = { user: { uid: TEACHER.uid, email: TEACHER.email, displayName: TEACHER.displayName, photoURL: null }, signedIn: true, listeners: [] };
    for(var k = 0; k < spec.n; k++){
      var s = new Stu(c, k, { pending: !!(spec.pending && spec.pending[k]) });
      c.students.push(s);
      var stamp = { classId: CLASS_ID, teachers: [TEACHER.email] };
      SV.docs["roster/" + s.email] = Object.assign({ name: s.name, id: s.email.split("@")[0], importedAt: now - 9e8 }, stamp);
      SESS["s:" + s.uid] = { user: { uid: s.uid, email: s.email, displayName: s.name, photoURL: null }, signedIn: !s.pending, listeners: [] };
      if(!s.pending){
        var wordsDoc = {};
        var solidLists = spec.solid ? r.int(0, spec.solid) : 0;
        r.shuffle(LISTS).slice(0, solidLists).forEach(function(L){
          r.shuffle(L.ids).slice(0, r.int(1, L.ids.length)).forEach(function(id){
            words(id).forEach(function(w){ wordsDoc[id + "|" + w] = solidStat(); s.stats[id + "|" + w] = { n: 5, r: 5, box: 5 }; });
          });
        });
        SV.docs["students/" + s.uid] = Object.assign({ name: s.name, email: s.email, photo: null, words: wordsDoc,
          totals: { n: 0, r: 0 }, recent: [], lastSeen: now - 86400000 }, stamp);
        if(spec.plain && r.chance(spec.plain)){
          s.plain = r.shuffle(LISTS).slice(0, r.int(1, 3)).map(function(L){ return r.pick(L.ids); });
          SV.docs["assignments/" + s.uid] = Object.assign({ lists: s.plain.slice(), updatedAt: now - 86400000 }, stamp);
        }
      }
      s.frame = makeFrame("student", "s:" + s.uid);
    }
    c.tf = makeFrame("teacher", "teacher");
    c.pf = makeFrame("preview", "teacher");
    HOOK.confirm = function(role, msg){ c.confirms.push(msg); c.log("confirm (" + role + "): " + msg.replace(/\n+/g, " / ")); };
    HOOK.open = function(role, url, win){ c.opened = new win.URL(url, win.location.href).href; };
    HOOK.write = function(w){ onWrite(c, w); };
    await navigate(c.tf, "/teacher.html");
    var up = await until(function(){ var nav = tq(c, "#tNav"); return nav && !nav.hidden && tq(c, "#tBody").childElementCount > 0; }, 30000);
    if(!up) throw new Error("the dashboard did not load: " + (tq(c, "#tBody") ? tq(c, "#tBody").textContent.slice(0, 120) : "no body"));
    await teacherQuiet(c);
    await until(function(){ return INFLIGHT === 0 && tq(c, "#tBody").childElementCount > 0; }, 30000);
    checkSayStored(c, "after the first load");
  }

  /* S9: every step of every stored sequence, and of every saved sequence on the class, holds its list's Say it.
     S10: and its ways are in the family's teaching order (the order the student will meet them, one at a time). */
  function outOfOrder(st){ return !same(st.ids, keyOrder(st.ids)); }
  function checkSayStored(c, when){
    c.students.forEach(function(s){
      var d = storedSource(s).doc, bad = [], disorder = [];
      FIELDS.forEach(function(f){
        var p = d[f];
        if(!p || !Array.isArray(p.steps)) return;
        p.steps.forEach(function(st, i){
          if(!st || !Array.isArray(st.ids)) return;
          if(lacksSay(st)) bad.push(f + "." + (i + 1) + " " + st.ids.join("+"));
          if(outOfOrder(st)) disorder.push(f + "." + (i + 1) + " " + st.ids.join("+") + " (the order is " + keyOrder(st.ids).join("+") + ")");
        });
      });
      if(bad.length) c.fail("S9", when + ": " + s.letter + "'s stored steps", "Say it in every step", "missing in " + bad.join(", "));
      else if(d.plan || d.plan2) c.ok("S9", when + ": every stored step of " + s.letter + " has Say it");
      if(disorder.length) c.fail("S10", when + ": " + s.letter + "'s stored steps", "every step in its family's teaching order", "out of order: " + disorder.join(", "));
      else if(d.plan || d.plan2) c.ok("S10", when + ": every stored step of " + s.letter + " is in teaching order");
    });
    var cl = SV.read("classes/" + CLASS_ID) || {}, sb = [], so = [];
    Object.keys(cl.sequences || {}).forEach(function(k){ (cl.sequences[k].steps || []).forEach(function(st, i){
      if(lacksSay(st)) sb.push(cl.sequences[k].name + " " + (i + 1));
      if(outOfOrder(st)) so.push(cl.sequences[k].name + " " + (i + 1) + " " + st.ids.join("+"));
    }); });
    if(sb.length) c.fail("S9", when + ": the class's saved sequences", "Say it in every step", "missing in " + sb.join(", "));
    if(so.length) c.fail("S10", when + ": the class's saved sequences", "every step in its family's teaching order", "out of order: " + so.join(", "));
  }

  /* Every write that lands: the marks (S4), and anything written by the preview (S8). */
  function onWrite(c, w){
    if(w.role === "preview") c.fail("S8", "Student view wrote " + w.path, "no write while previewing", w.kind + " " + JSON.stringify(w.body).slice(0, 120));
    if(w.path.indexOf("students/") === 0 && w.body){
      ["seq", "seq2"].forEach(function(f){
        var m = w.body[f]; if(!m || typeof m !== "object") return;
        var h = (c.markHist[w.path + "#" + f] ||= {});
        if(h[m.of] !== undefined && m.at < h[m.of]) c.fail("S4", w.path + " " + f + " written", f + ".at ≥ " + h[m.of] + " for the same plan", f + ".at = " + m.at);
        h[m.of] = Math.max(h[m.of] || 0, m.at);
      });
    }
  }

  /* ════════════════════════════════════════════════════════════════════
     OBSERVING: the student's home page, the dashboard, the preview
     ════════════════════════════════════════════════════════════════════ */
  async function loadHome(c, s){
    await navigate(s.frame, "/index.html");
    c.n.homeLoads++;
    var ok = await until(function(){ return homeReady(s.frame); }, 30000);
    if(!ok){
      var d = s.frame.contentDocument;
      return { failed: d && d.getElementById("ei-auth-wall") && !d.getElementById("ei-auth-wall").hidden ? "stuck at the sign-in wall" : "no tiles" };
    }
    return readHome(s.frame);
  }
  // The key's side effects of a student's own page load: the notice note and the high-water marks.
  function keyAfterHome(s){
    var exp = expectHome(s);
    s.plans.forEach(function(p, k){
      if(!p) return;
      var pos = s.pos(k), mark = s.marks[k];
      var stored = (mark && mark.of === p.setAt && mark.at > p.at) ? mark.at : p.at;
      if(pos.index > stored) s.marks[k] = { at: pos.index, of: p.setAt };
      s.seen[k] = exp.seenNext[k];
    });
  }
  function compareHome(c, s, got, label){
    var exp = expectHome(s);
    var e = homeText(exp), g = homeText(got);
    if(e === g) c.ok("S1", label + " home page of " + s.letter + ": " + g);
    else c.fail("S1", label + " home page of " + s.letter, e, g);
    // S9: the Say it of every current step is on the page once it is open (one way at a time: it need not be first)
    if(!got.failed) s.plans.forEach(function(p, k){
      if(!p) return;
      var pos = s.pos(k); if(pos.finished) return;
      var sid = sayIdOf(p.steps[pos.index]); if(!sid || s.open(k).indexOf(sid) === -1) return;
      c.check("S9", label + " home page of " + s.letter + ": the Say it tile of " + SECTION_NAME[k] + "' current list, open", sid + " shown", got.current.indexOf(sid) !== -1 ? sid + " shown" : sid + " missing");
    });
    // S10: a way they have played never disappears while they are on that list (from the pages, not the key's rule)
    if(!got.failed){
      s.lastOpen = s.lastOpen || [null, null];
      s.plans.forEach(function(p, k){
        if(!p) return;
        var pos = s.pos(k), was = s.lastOpen[k];
        if(pos.finished){ s.lastOpen[k] = null; return; }
        var stepIds = p.steps[pos.index].ids, here = got.current.filter(function(id){ return stepIds.indexOf(id) !== -1; });
        if(was && was.setAt === p.setAt && was.index === pos.index){
          var gone = was.ids.filter(function(id){ return played(s.stats, id) && here.indexOf(id) === -1; });
          if(gone.length) c.fail("S10", label + " home page of " + s.letter + ", " + SECTION_NAME[k] + " step " + (pos.index + 1),
            "every way they played still shown (" + was.ids.join(", ") + ")", "a way they played disappeared: " + gone.join(", "));
          else if(was.ids.some(function(id){ return played(s.stats, id); })) c.ok("S10", s.letter + "'s played ways of " + SECTION_NAME[k] + " are still shown");
        }
        s.lastOpen[k] = { setAt: p.setAt, index: pos.index, ids: here };
      });
    }
    // S2: nothing beyond where they are, nothing never given, nothing taken out
    if(!got.failed){
      var allowed = exp.current.concat(exp.fold || []);
      var shown = got.current.concat(got.fold || []);
      var extra = shown.filter(function(id){ return allowed.indexOf(id) === -1; });
      if(!extra.length) c.ok("S2", s.letter + " shows only their own lists");
      extra.forEach(function(id){
        var why = "never given";
        s.plans.forEach(function(p, k){
          if(!p) return;
          var pos = s.pos(k);
          p.steps.forEach(function(st, i){
            if(st.ids.indexOf(id) === -1) return;
            if(i > pos.index) why = "a later step of " + SECTION_NAME[k] + " (step " + (i + 1) + ", they are on " + (pos.index + 1) + ")";
            else if(i === pos.index) why = "a way of " + SECTION_NAME[k] + "' current list that is not open yet (open: " + s.open(k).join(", ") + ")";
          });
        });
        if(s.removed[id]) why = "taken out of sequence " + s.removed[id];
        c.fail("S2", s.letter + "'s home page shows " + id, "only lists of their current or finished steps", id + " — " + why);
      });
    }
    return exp;
  }
  function compareDash(c, s, row, det, label){
    var exp = expectDash(s);
    if(s.pending){
      c.check("S1", label + " Students row of " + s.letter, "pending", row.kind);
    } else {
      c.check("S1", label + " Students row of " + s.letter, dashText(exp, false), dashText(row, false));
    }
    // The page's editors carry their names as headings, not as labels: compared without them.
    var page = exp.seqs ? { kind: exp.kind, seqs: exp.seqs.map(function(q){ var o = Object.assign({}, q); o.label = ""; return o; }) } : exp;
    c.check("S1", label + " page of " + s.letter, dashText(page, true), dashText(det, true));
  }
  // The dashboard's Now / Finished rows and the home page's tiles and fold name the same lists.
  function compareAgree(c, s, det, home){
    if(!home || home.failed || det.kind === "missing") return;
    var dn = [], df = [];
    if(det.kind === "one" || det.kind === "two") det.seqs.forEach(function(q){ dn = dn.concat(q.nowTitles); df = df.concat(q.finTitles); });
    if(det.kind !== "one" && det.kind !== "two") return;
    dn = sorted(uniq(dn)); df = sorted(uniq(df)).filter(function(t){ return dn.indexOf(t) === -1; });
    var e = "now [" + dn.join(" | ") + "] finished [" + df.join(" | ") + "]";
    var g = "now [" + home.currentTitles.join(" | ") + "] finished [" + home.foldTitles.join(" | ") + "]";
    c.check("S1", "dashboard and home page of " + s.letter + " agree", e, g);
    // S10: the Now row's "Open: …" names exactly the ways the home page shows of that list
    det.seqs.forEach(function(q){
      if(!q.openLine || !q.nowTitles.length) return;
      var m = /^Open: (.*?)(?: · Next: .*)?$/.exec(q.openLine), said = m ? m[1].split(", ").sort() : ["(unreadable: " + q.openLine + ")"];
      var shown = home.current.filter(function(id){ return titleOf(id) === q.nowTitles[0]; }).map(modeTitle).sort();
      c.check("S10", "the dashboard's Open line for " + q.nowTitles[0] + " and " + s.letter + "'s home page agree", shown.join(", "), said.join(", "));
    });
  }
  async function readDash(c, s){
    var row = (goRoster(c), readRow(c, s));
    var det = openStudent(c, s) ? readDetail(c) : { kind: "missing" };
    return { row: row, det: det };
  }
  /* The document a student's sequences come from, by the README's rule: the assignment when it holds `lists` or
     either plan, else the roster row — one document for both. */
  function storedSource(s){
    var a = SV.read("assignments/" + s.uid), r = SV.read("roster/" + s.email);
    function valid(p){ return !!(p && Array.isArray(p.steps) && p.steps.some(function(st){ return st && Array.isArray(st.ids) && st.ids.length; })); }
    if(!s.pending && a && (valid(a.plan) || valid(a.plan2) || Array.isArray(a.lists))) return { doc: a, where: "assignments/" + s.uid };
    return { doc: r || {}, where: "roster/" + s.email };
  }
  function planText(p){ return p ? JSON.stringify({ steps: p.steps.map(function(x){ return x.ids; }), bar: p.bar, at: p.at, hold: !!p.hold }) : "none"; }

  /* After a teacher action: the stored plans against the key (S1), setAt (S5, S3), each field its own kind (S6). */
  function checkStored(c, s, expectNew, before){
    var src = storedSource(s), d = src.doc;
    for(var k = 0; k < 2; k++){
      var kp = s.plans[k], sp = d[FIELDS[k]] || null, name = SECTION_NAME[k] + " (" + FIELDS[k] + ")";
      c.check("S1", "stored " + name + " of " + s.letter + " (" + src.where + ")", planText(kp), planText(sp));
      if(!kp || !sp) continue;
      if(expectNew[k]){
        var hist = s.setAts[k];
        if(hist.indexOf(sp.setAt) !== -1) c.fail("S5", name + " of " + s.letter + " saved afresh", "a setAt never used before for " + FIELDS[k] + " of this student",
          "the setAt of an earlier " + FIELDS[k] + " (" + (hist.length - hist.indexOf(sp.setAt)) + " saves back), so its old mark would count");
        else c.ok("S5", name + " of " + s.letter + " has a new setAt");
        kp.setAt = sp.setAt;
        hist.push(sp.setAt);
      } else if(before && before[k]){
        if(same(before[k], sp)) c.ok("S3", name + " of " + s.letter + " written back exactly as stored");
        else c.fail("S3", name + " of " + s.letter + " was not to change", JSON.stringify(before[k]).slice(0, 200), JSON.stringify(sp).slice(0, 200));
        kp.setAt = sp.setAt;
      }
      // S6: each field holds only its own kind
      var wrong = sp.steps.filter(function(st){ return stepKindOf(st.ids) !== KINDS[k]; }).map(function(st){ return st.ids.join("+"); });
      c.check("S6", FIELDS[k] + " of " + s.letter + " holds only " + (k ? "other" : "red") + " lists", "", wrong.join(", "));
    }
    if(!s.plans[0] && !s.plans[1] && !d.plan && !d.plan2 && Array.isArray(d.lists)) c.check("S1", "stored lists of " + s.letter, sorted(s.plain || []).join(","), sorted(d.lists).join(","));
  }
  function storedPlans(s){ var d = storedSource(s).doc; return FIELDS.map(function(f){ return d[f] ? copy(d[f]) : null; }); }

  /* K1: nothing the teacher does moves a student backwards, except Go back to this list and raising the percent.
     Checked here as a property of the student's HOME PAGE, worked out from what is STORED — the fake server's
     assignment / roster row, and the student's own marks (seq, seq2) on students/{uid} — with the key's walk (README
     "Where the position is worked out"), never from the dashboard's draft, so a key that copied a wrong rule cannot
     hide it. By list id: `fin` the "Lists you finished" fold, `cur` the current tiles (and `held` the held ones). */
  function homeFromStore(s){
    var d = storedSource(s).doc, sd = s.pending ? null : SV.read("students/" + s.uid);
    var out = { fin: {}, cur: {}, held: {} };
    FIELDS.forEach(function(f, k){
      var p = d[f];
      if(!p || !Array.isArray(p.steps)) return;
      // As read: only the field's own kind (a step of the other kind is dropped).
      var steps = p.steps.filter(function(st){ return st && Array.isArray(st.ids) && st.ids.length && stepKindOf(st.ids) === KINDS[k]; });
      if(!steps.length) return;
      var q = { steps: steps, bar: p.bar, at: Math.min(p.at || 0, steps.length), hold: !!p.hold, setAt: p.setAt };
      var w = walk(q, s.stats, (sd && sd[MARKS[k]]) || null);
      q.steps.forEach(function(st, i){
        st.ids.filter(exists).forEach(function(id){
          if(i < w.index) out.fin[id] = KINDS[k];
          else if(i === w.index){ out.cur[id] = KINDS[k]; if(w.hold) out.held[id] = KINDS[k]; }
        });
      });
    });
    Object.keys(out.cur).forEach(function(id){ delete out.fin[id]; });
    return out;
  }
  /* S4 (K1) after a teacher action that wrote this student. `free(kind)`: that kind's lists may move (Go back, a
     raised percent, or the sequence was stopped or replaced); `freeIds`: lists taken out; `holdFree(kind)`: a hold
     there may come off (Move on now / Go back). Every list in the fold before is in the fold after; every list
     current before is current or finished after; a held list stays held and current. */
  function checkK1(c, s, before, label, free, freeIds, holdFree){
    var after = homeFromStore(s), bad = [];
    function where(id){ return after.fin[id] ? "finished" : after.cur[id] ? "current" : "later or gone"; }
    Object.keys(before.fin).forEach(function(id){
      if(free(before.fin[id]) || freeIds[id]) return;
      if(!after.fin[id]) bad.push(id + " was finished, now " + where(id));
    });
    Object.keys(before.cur).forEach(function(id){
      if(free(before.cur[id]) || freeIds[id]) return;
      if(!after.cur[id] && !after.fin[id]) bad.push(id + " was current, now " + where(id));
    });
    Object.keys(before.held).forEach(function(id){
      var kind = before.held[id];
      if(free(kind) || freeIds[id] || holdFree(kind)) return;
      if(!after.held[id]) bad.push(id + " was held, now " + (after.cur[id] ? "current, not held" : where(id)));
    });
    if(bad.length) c.fail("S4", label + ": " + s.letter + "'s home page (K1: nobody moves back)", "every finished list still finished, every current one current or finished", bad.join("; "));
    else c.ok("S4", label + ": nothing on " + s.letter + "'s home page moved back");
  }

  /* The full look after a step: every signed-in student's page, then the dashboard after Refresh. */
  async function observe(c, touched){
    var preRows = {};
    c.students.forEach(function(s){ preRows[s.k] = s.obsDash; });
    for(var s of c.students){
      if(s.pending) continue;
      var h = await loadHome(c, s);
      compareHome(c, s, h, "the");
      if(!h.failed) keyAfterHome(s);
      s.home = h;
    }
    await sleep(2500);         // store.js's debounced write of the sign-in stamp and any new mark
    await quiet(50);
    // the marks the key expects, against what is stored
    c.students.forEach(function(s){
      if(s.pending) return;
      var d = SV.read("students/" + s.uid) || {};
      ["seq", "seq2"].forEach(function(f, k){
        var km = s.marks[k], sm = d[f];
        var e = km ? km.at + "@" + (km.of === (s.plans[k] && s.plans[k].setAt) ? "this plan" : "an old plan") : "none";
        var g = sm ? sm.at + "@" + (s.plans[k] && sm.of === s.plans[k].setAt ? "this plan" : "an old plan") : "none";
        if(km && km.of !== (s.plans[k] && s.plans[k].setAt)) return;     // an old plan's mark: nothing to compare
        c.check("S4", "stored " + f + " of " + s.letter, e, g);
      });
    });
    await refresh(c);
    for(var s2 of c.students){
      var dsh = await readDash(c, s2);
      compareDash(c, s2, dsh.row, dsh.det, "after Refresh, the");
      if(!s2.pending) compareAgree(c, s2, dsh.det, s2.home);
      s2.prevDash = s2.obsDash;
      s2.obsDash = dsh;
      if(s2.pending) s2.prediction = dsh.det;
    }
    checkSayStored(c, "after Refresh");
    // S9: no step was walked past with its Say it below the bar
    c.students.forEach(function(s){
      s.walkObs = s.walkObs || [null, null];
      var seqs = s.obsDash && s.obsDash.row.seqs;
      s.plans.forEach(function(p, k){
        var q = seqs ? seqs[s.disp(k)] : null;      // the row shows them Red Words first, whichever field
        if(!p || !q || q.other) return;
        var p1 = q.index, prev = s.walkObs[k];
        var p0 = prev && prev.setAt === p.setAt ? prev.index : p.at;
        s.walkObs[k] = { setAt: p.setAt, index: p1 };
        if(p.hold) return;
        for(var i = p0; i < Math.min(p1, p.steps.length); i++){
          var sid = sayIdOf(p.steps[i]); if(!sid) continue;
          var have = solidCount(s.stats, sid), need = needOf(p.bar, total(sid));
          if(have >= need) c.ok("S9", s.letter + " moved past step " + (i + 1) + " of " + SECTION_NAME[k] + " with Say it at the bar");
          else c.fail("S9", s.letter + " moved past step " + (i + 1) + " of " + SECTION_NAME[k], "Say it at the bar (" + need + " of " + total(sid) + ")", "Say it at " + have + " of " + total(sid));
        }
      });
    });
    // S3: what this step did not touch did not move (`touched` names rows: Red Words first)
    c.students.forEach(function(s){
      var prev = s.prevDash, cur = s.obsDash;
      if(!prev || !cur || prev.row.kind !== cur.row.kind || !cur.row.seqs || !prev.row.seqs) return;
      cur.row.seqs.forEach(function(q, k){
        if(touched === "all" || (touched[s.k] && touched[s.k].indexOf(k) !== -1)) return;
        if(touched[s.k] === "all") return;
        c.check("S3", "sequence " + (k + 1) + " of " + s.letter + " (this step did not touch it)", seqText(prev.row.seqs[k]), seqText(q));
      });
    });
    // S8: sometimes, Student view for one student
    if(c.rng.chance(0.35)) await preview(c, c.rng.pick(c.students));
  }

  async function preview(c, s){
    if(!openStudent(c, s)) return;
    c.opened = null;
    var b = tq(c, "#tStuView");
    if(!b){ c.fail("S8", "Student view for " + s.letter, "a Student view button", "none"); return; }
    click(b);
    if(!c.opened){ c.fail("S8", "Student view for " + s.letter, "it opens index.html?preview=…", "nothing opened"); return; }
    var url = c.opened, expPv = "/index.html?preview=" + encodeURIComponent(s.dashUid());
    c.check("S8", "Student view's address for " + s.letter, expPv, url.replace(/^https?:\/\/[^/]+/, ""));
    var writes = SV.writes.length;
    await navigate(c.pf, url);
    c.n.previews++;
    var ok = await until(function(){ return homeReady(c.pf); }, 30000);
    if(!ok){ c.fail("S8", "Student view for " + s.letter, "the preview loads", "it did not"); return; }
    await sleep(2500); await quiet(50);
    var pv = readHome(c.pf);
    var exp = expectHome(s);
    var e = homeText({ current: exp.current, fold: exp.fold, foldCount: exp.foldCount, notice: exp.allFinished ? FINISHED_ALL : "", empty: exp.empty });
    var own = s.home && !s.home.failed && !s.pending
      ? homeText({ current: s.home.current, fold: s.home.fold, foldCount: s.home.foldCount, notice: s.home.notice === FINISHED_ALL ? FINISHED_ALL : "", empty: s.home.empty })
      : e;
    var g = homeText({ current: pv.current, fold: pv.fold, foldCount: pv.foldCount, notice: pv.notice, empty: pv.empty });
    c.check("S8", "Student view of " + s.letter + " against their own page", own, g);
    c.check("S8", "Student view of " + s.letter + " against the key", e, g);
    var w = SV.writes.slice(writes).filter(function(x){ return x.role === "preview"; });
    if(!w.length) c.ok("S8", "Student view wrote nothing");
  }

  /* ════════════════════════════════════════════════════════════════════
     THE STUDENT'S HANDS: practice on their own home page
     ════════════════════════════════════════════════════════════════════ */
  function shownIds(s){ return s.home && !s.home.failed ? s.home.current.concat(s.home.fold || []) : []; }
  function record(c, s, id, w, right){
    s.frame.contentWindow.EIStore.record(id, w, right);
    s.answer(id, w, right);
    c.n.answers++;
  }
  async function practise(c, s, kind, k){
    if(s.pending || !s.home || s.home.failed) return "nothing (the page is not up)";
    var p = s.plans[k], pos = p ? s.pos(k) : null, shown = shownIds(s), r = c.rng, said = kind;
    if(kind === "finish" || kind === "edge"){
      if(!p || pos.finished || pos.hold && kind === "finish" && false) return "nothing to finish";
      var step = p.steps[Math.min(pos.index, p.steps.length - 1)];
      step.ids.filter(function(id){ return shown.indexOf(id) !== -1; }).forEach(function(id){
        var tot = total(id), need = needOf(p.bar, tot);
        var target = kind === "finish" ? tot : (r.chance(0.5) ? need : Math.max(0, need - 1));
        var count = solidCount(s.stats, id);
        words(id).forEach(function(w){
          var key = id + "|" + w;
          if(solid(s.stats[key])) return;
          if(count < target){
            var guard = 0;
            while(!solid(s.stats[key]) && guard++ < 60) record(c, s, id, w, true);
            count++;
          } else if(r.chance(0.5)) record(c, s, id, w, r.chance(0.5));
        });
      });
      said = kind + " " + SECTION_NAME[k] + " step " + (pos.index + 1) + " (" + step.ids.join(", ") + ")";
    } else if(kind === "touch"){
      // A few right answers on every open way of the list they are on that is below the bar: played, not finished.
      if(!p || pos.finished) return "nothing to touch";
      var tstep = p.steps[pos.index], touchedIds = [];
      tstep.ids.filter(function(id){ return shown.indexOf(id) !== -1 && total(id) > 0 && solidCount(s.stats, id) < needOf(p.bar, total(id)); }).forEach(function(id){
        r.shuffle(words(id)).slice(0, 3).forEach(function(w){ record(c, s, id, w, true); });
        touchedIds.push(id);
      });
      if(!touchedIds.length) return "nothing to touch";
      said = "touch " + touchedIds.join(", ") + " (" + SECTION_NAME[k] + " step " + (pos.index + 1) + ")";
    } else if(kind === "slip"){
      /* A way at the bar, with a way after it they have played, drops one word below the bar (a miss takes a word out
         of the top box). The played way must stay on the page (S10); a way after it not yet played closes again. */
      if(!p || pos.finished) return "nothing to slip";
      var sstep = p.steps[pos.index], j = -1;
      for(var i = 0; i < sstep.ids.length - 1 && j < 0; i++){
        var sid0 = sstep.ids[i], tot0 = total(sid0);
        if(tot0 > 0 && shown.indexOf(sid0) !== -1 && solidCount(s.stats, sid0) >= needOf(p.bar, tot0) &&
           sstep.ids.slice(i + 1).some(function(x){ return played(s.stats, x) && shown.indexOf(x) !== -1; })) j = i;
      }
      if(j < 0) return "nothing to slip";
      var sid = sstep.ids[j], drop = solidCount(s.stats, sid) - needOf(p.bar, total(sid)) + 1;
      words(sid).filter(function(w){ return solid(s.stats[sid + "|" + w]); }).slice(0, drop).forEach(function(w){ record(c, s, sid, w, false); });
      said = "slip: " + drop + " words of " + sid + " out of the top box (" + SECTION_NAME[k] + " step " + (pos.index + 1) + ")";
    } else if(kind === "replay" || kind === "replay-last"){
      if(!p || pos.index === 0) return "nothing finished to replay";
      var j = kind === "replay-last" ? Math.min(pos.index, p.steps.length) - 1 : r.int(0, Math.min(pos.index, p.steps.length) - 1), ids = p.steps[j].ids.filter(function(id){ return shown.indexOf(id) !== -1; });
      if(!ids.length) return "nothing finished to replay";
      var id = r.pick(ids), ws = r.shuffle(words(id)).slice(0, r.int(2, 6));
      ws.forEach(function(w){ record(c, s, id, w, false); if(r.chance(0.4)) record(c, s, id, w, false); });
      said = "replay " + id + " with " + ws.length + " words missed (" + SECTION_NAME[k] + ", step " + (j + 1) + ")";
    } else {
      if(!shown.length) return "nothing shown";
      var nn = r.int(5, 15);
      for(var x = 0; x < nn; x++){ var id2 = r.pick(shown); record(c, s, id2, r.pick(words(id2)), r.chance(0.65)); }
      said = "noise: " + nn + " answers";
    }
    await sleep(7000);        // store.js's debounce, and the write
    await quiet(50);
    return said;
  }

  /* ════════════════════════════════════════════════════════════════════
     THE TEACHER'S HANDS: one session in the editor, then Save
     ════════════════════════════════════════════════════════════════════ */
  function sourceSteps(c, src){
    if(src.key.indexOf("rm:") === 0) return { steps: readyMade(src.key.slice(3)), bar: null };
    return { steps: saySteps(src.steps), bar: src.saved ? src.bar : null };
  }
  // S9: in a sequence's choosers, Say it is ticked and locked, with the one line that says why.
  var SAY_WHY = "Say it is always part of a sequence. It is the one mode that hears the student read.";
  function sayLocked(c, s, ed, sel, where){
    var cb = ed && ed.querySelector(sel), why = ed && ed.querySelector(".seqSayWhy");
    c.check("S9", where + " for " + s.letter + ": Say it", "ticked, locked, and why: " + SAY_WHY,
      (cb ? (cb.checked ? "ticked" : "unticked") + ", " + (cb.disabled ? "locked" : "can be unticked") : "no Say it box") + ", and why: " + (why ? why.textContent : "(no line)"));
  }

  // S10: a chooser's boxes are in the order the student will meet the ways.
  function boxOrder(c, s, ed, attr, where){
    var ids = Array.prototype.map.call(ed.querySelectorAll("[" + attr + "]"), function(cb){ return cb.getAttribute(attr); });
    c.check("S10", where + " for " + s.letter + ": the boxes in the teaching order", keyOrder(ids).join(","), ids.join(","));
  }

  /* One edit in section k's editor (0 Red Words, 1 Other lists), on the dashboard and in the key together. Returns a
     short description, or null when the dashboard did not offer the control the key says it should (a failure,
     already recorded). */
  async function edit(c, s, k, e){
    var d = keyDraft(s, k), idx = draftNow(s, k, d), n = d.steps.length;
    var ed = editorEl(c, k);
    if(!ed && e.op !== "inorder"){ c.fail("S1", SECTION_NAME[k] + " of " + s.letter, "the section is on the page", "it is not"); return null; }
    function btn(sel){ return ed ? ed.querySelector(sel) : null; }
    function need(el, what){
      if(el && !el.disabled) return true;
      c.fail("S1", what + " in editor " + (k + 1) + " of " + s.letter, "offered", el ? "disabled" : "not on the page");
      return false;
    }
    switch(e.op){
      case "moveon": {
        var offered = idx < n && (idx < n - 1 || (d.hold && d.at === idx));
        var b = btn('[data-seq="moveon"]');
        if(!!b !== offered){ c.fail("S1", "Move on now in editor " + (k + 1) + " of " + s.letter, offered ? "offered" : "not offered", b ? "offered" : "not offered"); return null; }
        if(!offered) return "Move on now (not offered)";
        click(b);
        if(idx >= n - 1){ d.hold = false; } else { d.at = idx + 1; d.hold = false; }
        return "Move on now from step " + (idx + 1);
      }
      case "goback": {
        var i = e.i;
        if(!(i < Math.min(idx, n))) return null;
        if(!need(btn('[data-seq="goback"][data-i="' + i + '"]'), "Go back to step " + (i + 1))) return null;
        click(btn('[data-seq="goback"][data-i="' + i + '"]'));
        d.at = i; d.hold = true;
        return "Go back to step " + (i + 1);
      }
      case "bar": {
        var sel = e.dir > 0 ? '[data-seq="bar+"]' : '[data-seq="bar-"]';
        var can = e.dir > 0 ? d.bar < 1 : d.bar > 0.5;
        var bb = btn(sel);
        if(!bb || bb.disabled !== !can){ c.fail("S1", "the percent " + (e.dir > 0 ? "+" : "−") + " of editor " + (k + 1), can ? "enabled" : "disabled", bb ? (bb.disabled ? "disabled" : "enabled") : "missing"); return null; }
        if(!can) return "percent at its end";
        click(bb);
        d.bar = Math.max(50, Math.min(100, Math.round(d.bar * 100) + e.dir * 5)) / 100;
        return "percent → " + Math.round(d.bar * 100) + "%";
      }
      case "up": case "down": {
        var j = e.i, to = e.op === "up" ? j - 1 : j + 1;
        if(!(j > idx && j < n)) return null;
        var mb = btn('[data-seq="' + e.op + '"][data-i="' + j + '"]'), ok = to > idx && to < n;
        if(!mb || mb.disabled !== !ok){ c.fail("S1", (e.op === "up" ? "▲" : "▼") + " on step " + (j + 1) + " of editor " + (k + 1), ok ? "enabled" : "disabled", mb ? (mb.disabled ? "disabled" : "enabled") : "missing"); return null; }
        if(!ok) return null;
        click(mb);
        var t = d.steps[j]; d.steps[j] = d.steps[to]; d.steps[to] = t;
        return (e.op === "up" ? "▲" : "▼") + " step " + (j + 1);
      }
      case "remove": {
        var ri = e.i;
        if(!(ri > idx && ri < n)) return null;
        if(!need(btn('[data-seq="remove"][data-i="' + ri + '"]'), "Take out on step " + (ri + 1))) return null;
        click(btn('[data-seq="remove"][data-i="' + ri + '"]'));
        d.steps[ri].ids.forEach(function(id){ s.removed[id] = SECTION_NAME[k]; });
        d.steps.splice(ri, 1);
        return "Take out step " + (ri + 1);
      }
      case "ways": {
        var wi = e.i;
        if(!(wi > idx && wi < n)) return null;
        if(!need(btn('[data-seq="ways"][data-i="' + wi + '"]'), "Change ways on step " + (wi + 1))) return null;
        click(btn('[data-seq="ways"][data-i="' + wi + '"]'));
        ed = editorEl(c, k);
        var sayW = sayIdOf(d.steps[wi]);
        if(sayW) sayLocked(c, s, ed, '[data-ways="' + sayW + '"]', "Change ways on step " + (wi + 1));
        boxOrder(c, s, ed, "data-ways", "Change ways on step " + (wi + 1));
        var others = Array.prototype.map.call(ed.querySelectorAll("[data-ways]"), function(cb){ return cb.getAttribute("data-ways"); })
          .filter(function(id){ return id !== sayW && !W.byId(id).retired; });
        var chosen = c.rng.shuffle(others).slice(0, c.rng.int(0, others.length));
        Array.prototype.forEach.call(ed.querySelectorAll("[data-ways]"), function(cb){
          var id = cb.getAttribute("data-ways"), want = chosen.indexOf(id) !== -1;
          if(cb.checked !== want) click(cb);       // for Say it, the harness tries to untick it
        });
        await shot("ways");
        var wd = ed.querySelector('[data-seq="ways-done"][data-i="' + wi + '"]');
        if(!need(wd, "Done (Change ways)")) return null;
        click(wd);
        d.steps[wi] = { ids: keyStep(libSort(chosen.concat(sayW ? [sayW] : []))) };
        return "Change ways on step " + (wi + 1) + " to " + d.steps[wi].ids.join("+");
      }
      case "add": {
        var used = stepKeysOf(d.steps);
        var L = e.list;
        if(used.indexOf(L.key) !== -1 || listKind(L) !== KINDS[k]) return null;
        if(!need(btn('[data-seq="add-open"]'), "Add a list")) return null;
        click(btn('[data-seq="add-open"]'));
        ed = editorEl(c, k);
        var selEl = ed && ed.querySelector(".seqAddSel");
        if(!selEl){ c.fail("S1", "Add a list in " + SECTION_NAME[k], "a list chooser", "none"); return null; }
        // Only the section's own kind is offered.
        var wrong = Array.prototype.filter.call(selEl.options, function(o){ return (o.value.split(":")[0] === "red") !== (k === 0); }).map(function(o){ return o.value; });
        c.check("S6", "Add a list in " + SECTION_NAME[k] + " of " + s.letter + " offers only " + (k ? "other" : "red") + " lists", "", wrong.join(","));
        var has = Array.prototype.some.call(selEl.options, function(o){ return o.value === L.key; });
        if(!has){ c.fail("S1", "Add a list in " + SECTION_NAME[k] + " of " + s.letter, L.key + " offered", "not offered"); click(ed.querySelector('[data-seq="add-cancel"]')); return null; }
        change(c, selEl, L.key);
        ed = editorEl(c, k);
        var sayA = sayIdOf({ ids: L.ids });
        if(sayA) sayLocked(c, s, ed, '[data-addway="' + sayA + '"]', "Add a list (" + L.key + ")");
        boxOrder(c, s, ed, "data-addway", "Add a list (" + L.key + ")");
        Array.prototype.forEach.call(ed.querySelectorAll("[data-addway]"), function(cb){
          var want = e.ids.indexOf(cb.getAttribute("data-addway")) !== -1;
          if(cb.checked !== want) click(cb);       // for Say it, the harness tries to untick it
        });
        if(sayA){ var sb = ed.querySelector('[data-addway="' + sayA + '"]');
          c.check("S9", "Add a list: Say it after trying to untick it", "ticked", sb && sb.checked ? "ticked" : "unticked"); }
        var go = ed.querySelector('[data-seq="add-go"]');
        if(!need(go, "Add to the end")) return null;
        click(go);
        d.steps.push({ ids: keyStep(libSort(e.ids)) });
        return "Add " + e.ids.join(" + ");
      }
      case "use": case "copy": {
        var src = e.src, ss = sourceSteps(c, src);
        var selId = e.op === "use" ? (k ? "#seqReady2" : "#seqReady") : (k ? "#seqCopy2" : "#seqCopy");
        var sel2 = tq(c, selId);
        if(!sel2 || !Array.prototype.some.call(sel2.options, function(o){ return o.value === src.key; })){ c.fail("S1", (e.op === "use" ? "Use a saved sequence" : "Copy from another student") + " in " + SECTION_NAME[k], src.key + " offered", "not offered"); return null; }
        change(c, sel2, src.key);
        var rl = replaceLater(d, idx, ss.steps);
        click(btn(e.op === "use" ? '[data-seq="ready-go"]' : '[data-seq="copy-go"]'));
        if(!rl.added){
          var fl = editorEl(c, k) && editorEl(c, k).querySelector(".saveNote.err");
          c.check("S1", (e.op === "use" ? "Use " : "Copy ") + src.label + " in " + SECTION_NAME[k] + " of " + s.letter + " adds nothing, and says so", "Nothing added", fl ? fl.textContent.slice(0, 13) : "(no line)");
          return (e.op === "use" ? "Use " : "Copy ") + src.label + " (adds nothing)";
        }
        d.steps.slice(idx + 1).forEach(function(st){ st.ids.forEach(function(id){ if(!rl.steps.some(function(x){ return x.ids.indexOf(id) !== -1; })) s.removed[id] = SECTION_NAME[k]; }); });
        d.steps = rl.steps;
        if(d.at > d.steps.length) d.at = d.steps.length;
        if(e.op === "use" && ss.bar !== null) d.bar = ss.bar;
        return (e.op === "use" ? "Use " : "Copy ") + src.label + " (+" + rl.added + ")";
      }
      case "give-red": {
        // Red Words for a student with none: the one button fills it with every red list, in order.
        var gr = btn('[data-seq="give-red"]');
        if(n){ if(gr) c.fail("S1", "Give Red Words for " + s.letter, "not offered (they have Red Words)", "offered"); return null; }
        if(!gr){ c.fail("S1", "Give Red Words for " + s.letter, "offered (no Red Words yet)", "not on the page"); return null; }
        click(gr);
        d.steps = readyMade("red"); d.at = 0; d.hold = false;
        return "Give Red Words";
      }
      case "inorder": {
        var io = tq(c, '#stuPanel-lists [data-seq="inorder"]');
        if(!io){ c.fail("S1", "Put these in order for " + s.letter, "offered", "not on the page"); return null; }
        click(io);
        // Red games to Red Words in list order, the rest to Other lists in the library's order.
        var groups = {}, order = [];
        libSort((s.plain || []).filter(exists)).forEach(function(id){ var kk = listKey(id); if(!groups[kk]){ groups[kk] = []; order.push(kk); } groups[kk].push(id); });
        var all = order.map(function(kk){ return { ids: keyStep(groups[kk]) }; });
        KINDS.forEach(function(kind, sec){
          var mine = ofKind(all, kind);
          s.drafts[sec] = mine.length ? { kind: kind, steps: mine, bar: 0.9, at: 0, hold: false, hasPlan: false, base: null } : null;
        });
        return "Put these in order";
      }
    }
    return null;
  }

  /* Save, as the key sees it: a changed section afresh at the step shown as Now; an unchanged one as stored. */
  function keySave(s){
    return keyBody([0, 1].map(function(sec){ return keyEntry(s, sec, keyDraft(s, sec)); }));
  }

  async function editorSession(c, s, edits, label){
    if(!openStudent(c, s)){ c.fail("S1", label, "the student's page opens", "no row for " + s.dashUid()); return; }
    var before = storedPlans(s), said = [], homeBefore = homeFromStore(s);
    s.drafts = [null, null];
    var d0s = [savedDraft(s, 0), savedDraft(s, 1)];
    var barBefore = d0s.map(function(d){ return d ? d.bar : null; });
    for(var e of edits){
      var r = await edit(c, s, e.k, e);
      if(r) said.push("[" + SECTION_NAME[e.k] + "] " + r);
      await sleep(5);
    }
    var dirty = [0, 1].some(function(sec){ return draftDirty(keyDraft(s, sec)); });
    var bar = tq(c, "#seqSave");
    c.log("teacher: " + label + " — " + (said.join("; ") || "nothing"));
    if(!bar){ c.fail("S1", label + ": the Save bar", "on the page", "missing"); s.drafts = [null, null]; return; }
    if(bar.hidden === dirty){ c.fail("S1", label + ": the Save bar", dirty ? "shown (changes not saved)" : "hidden (no change)", bar.hidden ? "hidden" : "shown"); }
    if(!dirty || bar.hidden){
      var disc = tq(c, '#stuPanel-lists [data-seq="discard"]'); if(disc && !bar.hidden) click(disc);
      s.drafts = [null, null];
      goRoster(c);
      return;
    }
    var ks = keySave(s);
    var prevPos = [s.pos(0), s.pos(1)];
    // For S4 (K1) below: the lists the teacher took out (Take out, or replaced by a saved / copied order), and the
    // percent each section ends at — from the key's drafts, before Save clears them.
    var takenOut = {}, barAfter = [null, null];
    [0, 1].forEach(function(sec){
      var d0 = d0s[sec], d1 = keyDraft(s, sec);
      barAfter[sec] = d1.bar;
      if(!d0) return;
      var kept = {}; d1.steps.forEach(function(st){ st.ids.forEach(function(id){ kept[id] = true; }); });
      d0.steps.forEach(function(st){ st.ids.forEach(function(id){ if(!kept[id]) takenOut[id] = true; }); });
    });
    click(tq(c, '#stuPanel-lists [data-seq="save"]'));
    await sleep(5);
    await teacherQuiet(c);
    c.n.teacherActions++;
    s.plans = ks.plans.map(clonePlan);
    s.plain = null;
    s.drafts = [null, null];
    checkStored(c, s, ks.fresh, before);
    // S5: a fresh plan starts from its `at`, no old mark carried
    ks.fresh.forEach(function(f, k){ if(f) c.log("key: " + SECTION_NAME[k] + " of " + s.letter + " afresh at " + s.plans[k].at + (s.plans[k].hold ? " (held)" : "") + " → " + seqText(expectDash(s).seqs[s.disp(k)])); });
    // S4 (K1): the home page, from what was stored before and after.
    checkK1(c, s, homeBefore, label, function(kind){
      var sec = kind === "red" ? 0 : 1;
      return edits.some(function(e){ return e.k === sec && e.op === "goback"; }) || (barBefore[sec] !== null && barAfter[sec] > barBefore[sec]);
    }, takenOut, function(kind){
      var sec = kind === "red" ? 0 : 1;
      return edits.some(function(e){ return e.k === sec && (e.op === "moveon" || e.op === "goback"); });
    });
    await afterAction(c, s, label);
    s.freshAt = ks.fresh;
    return prevPos;
  }
  // Right after an action, before anyone reloads: the dashboard from its own local copy.
  async function afterAction(c, s, label){
    var d = await readDash(c, s);
    compareDash(c, s, d.row, d.det, "right after " + label + ", the");
    goRoster(c);
  }

  /* Stop section k's sequence (0 Red Words, 1 Other lists). The other is written back exactly as stored; stopping the
     only one leaves the list they were on, all at once. */
  async function stopSeq(c, s, k){
    if(!openStudent(c, s) || !s.plans[k]) return;
    var ed = editorEl(c, k), b = ed && ed.querySelector('[data-seq="stop"]');
    if(!b){ c.fail("S1", "Stop using this sequence (" + SECTION_NAME[k] + ") for " + s.letter, "offered", "not on the page"); return; }
    var before = storedPlans(s), alone = !s.plans[1 - k], pos = s.pos(k), homeBefore = homeFromStore(s);
    s.drafts = [null, null];
    click(b);
    await sleep(5);
    await teacherQuiet(c);
    c.n.teacherActions++;
    var p = s.plans[k], n = p.steps.length;
    if(alone) s.plain = p.steps[pos.finished ? n - 1 : pos.index].ids.slice();
    p.steps.forEach(function(st){ st.ids.forEach(function(id){ if(!alone || s.plain.indexOf(id) === -1) s.removed[id] = SECTION_NAME[k]; }); });
    s.plans[k] = null;
    before[k] = null;
    c.log("teacher: Stop using " + SECTION_NAME[k] + " for " + s.letter + (alone ? " (the only one)" : ""));
    checkStored(c, s, [false, false], before);
    // S4 (K1): the sequence that stays keeps its place (one alone becomes games: nothing to compare)
    if(!alone) checkK1(c, s, homeBefore, "Stop " + SECTION_NAME[k], function(kind){ return kind === KINDS[k]; }, {}, function(){ return false; });
    await afterAction(c, s, "Stop " + SECTION_NAME[k]);
  }

  /* Give a sequence to several students (README "The class page"): the order goes where it belongs — its red lists
     replace each student's Red Words, the rest their Other lists; a kind it does not hold is kept as stored; games in
     no order are replaced. One batch. */
  async function give(c, list, src, barSteps){
    goRoster(c);
    // Ticks outlive a cancelled dialog (as they should): start from none, with the page's own Clear selection.
    var clr = tq(c, "#stClear");
    if(clr && !clr.hidden) click(clr);
    if(tdoc(c).querySelectorAll("#tBody [data-pick]:checked").length){ c.fail("S1", "Clear selection", "no row ticked", "rows still ticked"); return; }
    for(var s of list){
      var cb = tq(c, '#tBody [data-pick="' + CSS.escape(s.dashUid()) + '"]');
      if(!cb){ c.fail("S1", "Give: the tick for " + s.letter, "on the Students page", "missing"); return; }
      if(!cb.checked) click(cb);
    }
    var g = tq(c, "#stGive");
    if(!g || g.disabled){ c.fail("S1", "Give a sequence to " + list.length + " selected", "enabled", g ? "disabled" : "missing"); return; }
    click(g);
    var sel = tq(c, "#giveSrc");
    if(!sel || !Array.prototype.some.call(sel.options, function(o){ return o.value === src.key; })){ c.fail("S1", "Give: the source " + src.label, "offered", "not offered"); return; }
    change(c, sel, src.key);
    c.check("S1", "Give: no choice of where it goes", "none", tdoc(c).querySelector('input[name="giveMode"]') ? "a choice" : "none");
    var ss = src.key.indexOf("rm:") === 0 ? readyMade(src.key.slice(3)) : saySteps(src.steps);
    var bar = src.bar;
    for(var x = 0; x < Math.abs(barSteps); x++){
      var bb = tq(c, barSteps > 0 ? "#giveMore" : "#giveLess");
      if(bb && !bb.disabled){ click(bb); bar = Math.max(0.5, Math.min(1, Math.round(bar * 100 + (barSteps > 0 ? 5 : -5)) / 100)); }
    }
    // the key, per student
    var counts = { red: 0, other: 0, games: 0, keptRed: 0, keptOther: 0 };
    var bodies = list.map(function(s){
      if(!s.plansList().length && (s.plain || []).length) counts.games++;
      var b = keyBody(KINDS.map(function(kind, sec){
        var mine = ofKind(ss, kind), have = s.plans[sec];
        if(have){ if(mine.length) counts[kind]++; else counts[sec ? "keptOther" : "keptRed"]++; }
        if(mine.length) return { plan: { steps: cloneSteps(mine), bar: bar, at: 0, hold: false, setAt: null }, fresh: true };
        return have ? { plan: have, fresh: false } : null;
      }));
      b.s = s;
      return b;
    });
    // The warning says, in counts of students, what this replaces and what it keeps.
    var w = tq(c, "#giveReplace"), n = list.length, said = w && !w.hidden ? w.textContent : "";
    var exp = [];
    function of(k, has, have){ return k + " of these " + n + (n === 1 ? " student " : " students ") + (k === 1 ? has : have); }
    if(counts.red) exp.push(of(counts.red, "already has", "already have") + " a Red Words sequence. This replaces " + (counts.red === 1 ? "it." : "them."));
    if(counts.other) exp.push(of(counts.other, "already has", "already have") + " an Other lists sequence. This replaces " + (counts.other === 1 ? "it." : "them."));
    if(counts.games) exp.push(of(counts.games, "has", "have") + " games in no order. This replaces them.");
    [[counts.keptRed, "Red Words lists", "Red Words"], [counts.keptOther, "other lists", "Other lists"]].forEach(function(w){
      if(w[0]) exp.push("It has no " + w[1] + ": " + w[0] + " of them " + (w[0] === 1 ? "keeps" : "keep") + " their " + w[2] + " sequence as it is.");
    });
    c.check("S1", "Give: the dialog's warning", exp.join(" ") || "(none)", said || "(none)");
    await shot("give");
    var go = tq(c, "#giveGo");
    if(go.disabled){ c.fail("S1", "Give it", "enabled", "disabled"); click(tq(c, "#giveCancel")); return; }
    var before = {}, homeBefore = {};
    list.forEach(function(s){ before[s.k] = storedPlans(s); homeBefore[s.k] = homeFromStore(s); });
    click(go);
    await sleep(5);
    await teacherQuiet(c);
    c.n.teacherActions++;
    c.log("teacher: Give " + src.label + " at " + Math.round(bar * 100) + "% to " + list.map(function(s){ return s.letter; }).join(", "));
    for(var b of bodies){
      var old = b.s.plans;
      old.forEach(function(p, k){
        if(!p) return;
        var kept = b.plans.some(function(q){ return q === p; });
        if(!kept) p.steps.forEach(function(st){ st.ids.forEach(function(id){ b.s.removed[id] = "a sequence replaced by Give"; }); });
      });
      b.s.plans = b.plans.map(clonePlan);
      b.s.plain = null;
      checkStored(c, b.s, b.fresh, before[b.s.k]);
      // S4 (K1): the kind the order does not hold keeps every list where it was; the kind it holds is replaced.
      checkK1(c, b.s, homeBefore[b.s.k], "Give " + src.label, function(kind){ return ofKind(ss, kind).length > 0; }, {}, function(){ return false; });
      b.s.freshAt = b.fresh;
    }
    for(var s2 of list) await afterAction(c, s2, "Give");
  }

  async function signIn(c, s){
    s.frame.__seqLoad = 0;
    await navigate(s.frame, "/index.html");
    var wall = await until(function(){ var d = s.frame.contentDocument, el = d && d.getElementById("ei-wall-signin"); return el && !el.hidden; }, 20000);
    if(!wall){ c.fail("S7", s.letter + "'s first sign-in", "the sign-in wall with its button", "no wall"); return; }
    click(s.frame.contentDocument.getElementById("ei-wall-btn"));
    var ok = await until(function(){ return homeReady(s.frame); }, 30000);
    s.pending = false;
    c.n.homeLoads++;
    var h = ok ? readHome(s.frame) : { failed: "no tiles after signing in" };
    c.log("student " + s.letter + " signs in for the first time: " + homeText(h));
    compareHome(c, s, h, "first sign-in:");
    var pr = s.prediction;
    if(pr && (pr.kind === "one" || pr.kind === "two")){
      var dn = [], df = [];
      pr.seqs.forEach(function(q){ dn = dn.concat(q.nowTitles); df = df.concat(q.finTitles); });
      dn = sorted(uniq(dn)); df = sorted(uniq(df)).filter(function(t){ return dn.indexOf(t) === -1; });
      if(!h.failed) c.check("S7", s.letter + "'s first home page against the dashboard's page for them as a roster row",
        "now [" + dn.join(" | ") + "] finished [" + df.join(" | ") + "]", "now [" + h.currentTitles.join(" | ") + "] finished [" + h.foldTitles.join(" | ") + "]");
    } else if(pr && pr.kind === "none" && !h.failed){
      c.check("S7", s.letter + "'s first home page (the dashboard said: no lists)", "empty", h.empty ? "empty" : homeText(h));
    }
    if(!h.failed) keyAfterHome(s);
    s.home = h;
    await sleep(2500); await quiet(50);
  }

  /* ════════════════════════════════════════════════════════════════════
     THE FAMILIES
     ════════════════════════════════════════════════════════════════════ */
  var SPEC = {
    "one-sequence":     { n: [1, 2], solid: 1 },
    "two-sequences":    { n: [1, 2], solid: 1 },
    "teacher-steps-in": { n: [1, 2], solid: 1 },
    "re-plan":          { n: [1, 2], solid: 2 },
    "bulk":             { n: [2, 3], solid: 2, plain: 0.4 },
    "roster-first":     { n: [1, 2], solid: 0, pending: true },
    "stop":             { n: [1, 2], solid: 1 }
  };
  function pickSaved(c, avoidAll){ return c.rng.pick(c.saved); }
  // What a section's "Use a saved sequence" offers: its own ready-made one, and every saved order.
  function sourcesFor(c, s, sec){
    var out = c.saved.slice();
    if(c.rng.chance(0.15)) out.push(sec === undefined
      ? { key: "rm:" + c.rng.pick(["red", "sounding"]), label: "a ready-made sequence", bar: 0.9 }
      : { key: "rm:" + (sec ? "sounding" : "red"), label: "the ready-made " + SECTION_NAME[sec], bar: 0.9 });
    return out;
  }
  // The sections of a student that hold a sequence now.
  function liveSections(s){ return [0, 1].filter(function(sec){ return !!s.plans[sec]; }); }

  /* A starting sequence (or both) for a student, through the editor or Give. */
  async function startSeqs(c, s, two){
    var r = c.rng;
    if(s.plain && s.plain.length && r.chance(0.5)){
      await editorSession(c, s, [{ k: 0, op: "inorder" }], "Put " + s.letter + "'s games in order, Save");
    } else if(r.chance(0.5) || s.plain){
      await give(c, [s], pickSaved(c), r.int(-2, 2));
    } else {
      // Red Words with none yet is one button; an Other lists editor is there even when empty.
      var sec = r.int(0, 1), hasRed = liveSections(s).indexOf(0) !== -1;
      if(sec === 0 && !hasRed) await editorSession(c, s, [{ k: 0, op: "give-red" }], "Give Red Words to " + s.letter + ", Save");
      else await editorSession(c, s, [{ k: sec, op: "use", src: r.chance(0.5) ? { key: "rm:" + (sec ? "sounding" : "red"), label: "the ready-made " + SECTION_NAME[sec], bar: 0.9 } : pickSaved(c) }],
        "Use an order in " + SECTION_NAME[sec] + " for " + s.letter + ", Save");
    }
    if(two && liveSections(s).length === 1){
      var missing = liveSections(s)[0] ? 0 : 1;
      if(r.chance(0.4)) await give(c, [s], missing ? { key: "rm:sounding", label: "Sounding it out", bar: 0.9 } : { key: "rm:red", label: "Red Words, Lists 1 to 10", bar: 0.9 }, 0);
      else if(missing === 0) await editorSession(c, s, [{ k: 0, op: "give-red" }], "Give Red Words to " + s.letter + " beside Other lists, Save");
      else await editorSession(c, s, [{ k: missing, op: "use", src: r.chance(0.5) ? c.saved[missing] : { key: "rm:" + (missing ? "sounding" : "red"), label: "the ready-made " + SECTION_NAME[missing], bar: 0.9 } }],
        "Start " + SECTION_NAME[missing] + " for " + s.letter + ", Save");
    }
  }

  function practiceAction(c, s){
    var r = c.rng, ks = s.plans.map(function(p, k){ return p ? k : -1; }).filter(function(k){ return k >= 0; });
    var k = ks.length ? r.pick(ks) : 0;
    var kind = r.pick(["finish", "finish", "edge", "replay", "noise", "touch", "slip"]);
    return { kind: "practise", s: s, what: kind, k: k };
  }
  function teacherEditAction(c, s, flavours){
    var r = c.rng, secs = liveSections(s);
    if(!secs.length) return null;
    var k = r.pick(secs), d = savedDraft(s, k), n = d.steps.length, idx = draftNow(s, k, d);
    var f = r.pick(flavours), edits = [];
    if(f === "moveon") edits.push({ k: k, op: "moveon" });
    else if(f === "goback" && idx > 0) edits.push({ k: k, op: "goback", i: r.int(0, Math.min(idx, n) - 1) });
    else if(f === "bar"){ var dir = r.chance(0.5) ? 1 : -1, times = r.int(1, 3); for(var x = 0; x < times; x++) edits.push({ k: k, op: "bar", dir: dir }); }
    else if(f === "later" && idx < n - 1){
      var i = r.int(Math.min(idx + 1, n - 1), n - 1);
      edits.push({ k: k, op: r.pick(["up", "down", "remove"]), i: i });
    }
    else if(f === "ways" && idx < n - 1) edits.push({ k: k, op: "ways", i: r.int(Math.min(idx + 1, n - 1), n - 1) });
    else if(f === "add"){
      // Sometimes the other section, even when it is empty: Add a list there starts it.
      if(r.chance(0.25) && (k === 0 || secs.indexOf(0) !== -1)) k = 1 - k;
      var usedK = s.plans[k] ? stepKeysOf(s.plans[k].steps) : [];
      var free = LISTS.filter(function(L){ return usedK.indexOf(L.key) === -1 && listKind(L) === KINDS[k]; });
      if(free.length){ var L = r.pick(free); edits.push({ k: k, op: "add", list: L, ids: r.shuffle(L.ids).slice(0, r.int(1, 2)) }); }
    }
    else if(f === "use") edits.push({ k: k, op: "use", src: r.pick(sourcesFor(c, s, k)) });
    else if(f === "copy"){
      var others = c.students.filter(function(o){ return o !== s && liveSections(o).indexOf(k) !== -1; });
      if(others.length){ var o = r.pick(others), op = o.plans[k];
        edits.push({ k: k, op: "copy", src: { key: o.dashUid(), label: o.letter + "'s " + SECTION_NAME[k], steps: op.steps, bar: op.bar } }); }
    }
    if(!edits.length) edits.push({ k: k, op: "moveon" });
    // sometimes a second edit in the same session, in either section
    if(r.chance(0.25)){
      var k2 = r.pick(secs);
      edits.push(r.chance(0.5) ? { k: k2, op: "bar", dir: r.chance(0.5) ? 1 : -1 } : { k: k2, op: "moveon" });
    }
    return { kind: "edit", s: s, edits: edits, label: "edit " + s.letter + ": " + edits.map(function(e){ return "[" + SECTION_NAME[e.k] + "] " + e.op; }).join(", ") };
  }

  /* Openings that steer a case to the sharp edges, then the family's random mix takes over: a whole sequence
     finished and its last list replayed with misses, then Stop or an edit; two sequences moving apart. `k` is the
     section: 0 Red Words, 1 Other lists. */
  function scriptFor(c){
    var r = c.rng, s0 = c.students[0], live = function(){ return !s0.pending; };
    var withPlan = function(k){ return function(){ return live() && !!s0.plans[k]; }; };
    /* One way at a time: Red Words (Cards, then Say it) given, the first way finished, the next one opens and is
       played, then the first slips below the bar — the way they played must stay. */
    if(c.fam === "one-sequence" && r.chance(0.7)) return [
      function(){ return live() && !s0.plans[0] ? { kind: "edit", s: s0, edits: [{ k: 0, op: "give-red" }], label: "Give Red Words to " + s0.letter + ", Save" } : null; },
      function(){ return withPlan(0)() ? { kind: "practise", s: s0, what: "finish", k: 0 } : null; },
      function(){ return withPlan(0)() ? { kind: "practise", s: s0, what: "touch", k: 0 } : null; },
      function(){ return withPlan(0)() ? { kind: "practise", s: s0, what: "slip", k: 0 } : null; }
    ];
    if(c.fam === "stop" && r.chance(0.6)) return [
      function(){ return live() ? { kind: "start", s: s0, two: true } : null; },
      function(){ return withPlan(1)() ? { kind: "finish-all", s: s0, k: 1 } : null; },
      function(){ return withPlan(1)() && r.chance(0.7) ? { kind: "practise", s: s0, what: "replay-last", k: 1 } : null; },
      function(){ return withPlan(1)() ? { kind: "stop", s: s0, k: 0 } : null; }
    ];
    if((c.fam === "teacher-steps-in" || c.fam === "re-plan" || c.fam === "one-sequence") && r.chance(0.4)) return [
      function(){ return live() ? { kind: "start", s: s0, two: false } : null; },
      function(){ return withPlan(0)() ? { kind: "finish-all", s: s0, k: 0 } : null; },
      function(){ return withPlan(0)() ? { kind: "practise", s: s0, what: "replay-last", k: 0 } : null; },
      function(){ return withPlan(0)() ? teacherEditAction(c, s0, ["add", "bar", "use", "goback", "moveon"]) : null; }
    ];
    if(c.fam === "two-sequences" && r.chance(0.5)) return [
      function(){ return live() ? { kind: "start", s: s0, two: true } : null; },
      function(){ return withPlan(0)() ? { kind: "practise", s: s0, what: "finish", k: 0 } : null; },
      function(){ return withPlan(1)() ? teacherEditAction(c, s0, ["moveon", "bar", "goback"]) : null; },
      function(){ return withPlan(1)() ? { kind: "finish-all", s: s0, k: 1 } : null; }
    ];
    return [];
  }

  function nextAction(c){
    if(c.script === undefined) c.script = scriptFor(c);
    while(c.script.length){ var sa = c.script.shift()(); if(sa) return sa; }
    var r = c.rng, fam = c.fam, ss = c.students, s = r.pick(ss.filter(function(x){ return !x.pending; }).concat(ss.filter(function(x){ return x.pending; })));
    var live = ss.filter(function(x){ return !x.pending; });
    if(fam === "roster-first"){
      var pend = ss.filter(function(x){ return x.pending; });
      if(pend.length && r.chance(0.35)) return { kind: "signin", s: r.pick(pend) };
      if(pend.length && r.chance(0.5)){
        var ps = r.pick(pend);
        if(!ps.plansList().length) return { kind: "start", s: ps, two: r.chance(0.4) };
        return teacherEditAction(c, ps, ["moveon", "goback", "bar", "later", "add", "use"]) || { kind: "start", s: ps };
      }
    }
    if(!live.length) return { kind: "signin", s: r.pick(ss) };
    s = r.pick(live);
    if(!s.plansList().length && fam !== "bulk") return { kind: "start", s: s, two: fam === "two-sequences" || fam === "stop" };
    switch(fam){
      case "one-sequence":
        return r.chance(0.8) ? practiceAction(c, s) : teacherEditAction(c, s, ["bar", "add", "later", "ways"]);
      case "two-sequences":
        if(liveSections(s).length < 2 && r.chance(0.5)) return { kind: "start", s: s, two: true };
        return r.chance(0.75) ? practiceAction(c, s) : teacherEditAction(c, s, ["bar", "moveon", "add", "use"]);
      case "teacher-steps-in":
        return r.chance(0.5) ? practiceAction(c, s) : teacherEditAction(c, s, ["moveon", "moveon", "goback", "goback", "bar"]);
      case "re-plan":
        if(r.chance(0.45)) return practiceAction(c, s);
        if(r.chance(0.3)) return { kind: "give", list: [s] };
        return teacherEditAction(c, s, ["use", "use", "copy", "later", "add", "ways"]);
      case "bulk":
        if(r.chance(0.45)){
          var list = r.shuffle(ss).slice(0, r.int(1, ss.length));
          return { kind: "give", list: list };
        }
        if(!s.plansList().length) return { kind: "give", list: [s] };
        return practiceAction(c, s);
      case "roster-first":
        if(!s.plansList().length) return { kind: "start", s: s };
        return r.chance(0.6) ? practiceAction(c, s) : teacherEditAction(c, s, ["moveon", "goback", "bar"]);
      case "stop":
        if(s.plansList().length && r.chance(0.3)){
          var kk = r.pick(s.plans.map(function(p, k){ return p ? k : -1; }).filter(function(k){ return k >= 0; }));
          return { kind: "stop", s: s, k: kk };
        }
        if(!s.plansList().length) return { kind: "start", s: s, two: r.chance(0.6) };
        if(liveSections(s).length === 1 && r.chance(0.3)) return { kind: "start", s: s, two: true };
        return practiceAction(c, s);
    }
    return practiceAction(c, s);
  }

  /* Finish every list of one sequence, a page load between lists and between the ways of a list (the student only
     sees the list they are on, and of it only the ways open so far). */
  async function finishAll(c, s, k){
    var said = [];
    for(var guard = 0; guard < 32; guard++){
      var pos = s.pos(k);
      if(!s.plans[k] || pos.finished || pos.hold) break;
      said.push(await practise(c, s, "finish", k));
      var h = await loadHome(c, s);
      compareHome(c, s, h, "between lists, the");
      if(h.failed) break;
      keyAfterHome(s); s.home = h;
      await sleep(2500); await quiet(50);
    }
    return said.length + " rounds of finishing in " + SECTION_NAME[k];
  }

  async function perform(c, a){
    var touched = {};
    c.students.forEach(function(s){ touched[s.k] = []; });
    if(a.kind === "finish-all"){
      var before0 = a.s.obsDash;
      var said0 = await finishAll(c, a.s, a.k);
      c.stepName = "practice: " + a.s.letter + " " + said0;
      c.log("student " + a.s.letter + ": " + said0);
      touched[a.s.k] = [a.s.disp(a.k)];
      return touched;
    }
    if(a.kind === "practise"){
      c.stepName = "practice";
      var before = a.s.obsDash;
      var said = await practise(c, a.s, a.what, a.k);
      c.stepName = "practice: " + a.s.letter + " " + said;
      c.log("student " + a.s.letter + ": " + said);
      touched[a.s.k] = said.indexOf("noise") === 0 ? "all" : [a.s.disp(a.k)];
      a.replayAt = a.s.disp(a.k);
      a.replayFrom = a.what === "replay" && /^replay/.test(said) ? (before && before.row.seqs ? before.row.seqs[a.replayAt] : null) : null;
      return touched;
    }
    if(a.kind === "signin"){ c.stepName = "first sign-in of " + a.s.letter; await signIn(c, a.s); touched[a.s.k] = "all"; return touched; }
    touched = "all";
    if(a.kind === "start"){ c.stepName = "start " + a.s.letter + (a.two ? " (two)" : ""); await startSeqs(c, a.s, a.two); }
    else if(a.kind === "edit"){
      c.stepName = a.label;
      touched = {}; c.students.forEach(function(s){ touched[s.k] = []; });
      // The rows an edit touches: its sections', as the row shows them (Red Words first).
      touched[a.s.k] = uniq(a.edits.map(function(e){ return a.s.plans[e.k] ? a.s.disp(e.k) : -1; }));
      if(touched[a.s.k].indexOf(-1) !== -1 || a.edits.some(function(e){ return e.op === "use" || e.op === "copy" || e.op === "add" || e.op === "give-red"; })) touched[a.s.k] = "all";
      await editorSession(c, a.s, a.edits, a.label);
    }
    else if(a.kind === "give"){
      // A ready-made or saved order, or another student's Red Words ("st:") or Other lists ("st2:").
      var studs = [];
      c.students.forEach(function(o){
        o.plans.forEach(function(p, sec){ if(p && !o.pending) studs.push({ key: (sec ? "st2:" : "st:") + o.dashUid(), label: o.letter + "'s " + SECTION_NAME[sec], steps: p.steps, bar: p.bar }); });
      });
      var src = c.rng.pick(sourcesFor(c, a.list[0]).concat(studs.slice(0, 2)));
      c.stepName = "Give " + src.label + " to " + a.list.map(function(s){ return s.letter; }).join(",");
      await give(c, a.list, src, c.rng.int(-1, 1));
    }
    else if(a.kind === "stop"){ c.stepName = "Stop " + SECTION_NAME[a.k] + " of " + a.s.letter; await stopSeq(c, a.s, a.k); }
    return touched;
  }

  async function runCase(job){
    var c = new Case(job);
    c.log("case " + c.i + " · " + c.fam + " · case seed " + c.seed);
    var sp = SPEC[c.fam];
    var n = c.rng.int(sp.n[0], sp.n[1]);
    var pending = [];
    for(var k = 0; k < n; k++) pending.push(!!sp.pending && (k === 0 || c.rng.chance(0.5)));
    await setup(c, { n: n, solid: sp.solid, plain: sp.plain, pending: pending });
    c.students.forEach(function(s){ c.log("student " + s.letter + ": " + s.uid + " " + s.email + (s.pending ? " (on the roster, never signed in)" : "") +
      (s.plain ? " games " + s.plain.join(",") : "") + (Object.keys(s.stats).length ? " · already solid: " + uniq(Object.keys(s.stats).map(function(x){ return x.split("|")[0]; })).join(",") : "")); });
    c.saved.forEach(function(x){ c.log("saved " + x.label + ": " + x.steps.map(function(st){ return st.ids.join("+"); }).join(" → ") + " at " + Math.round(x.bar * 100) + "%"); });
    c.step = 0; c.stepName = "the start";
    await observe(c, "all");
    var steps = c.rng.int(7, 10);
    for(var st = 1; st <= steps; st++){
      c.step = st; c.n.steps++;
      await sleep(1000);
      var a = nextAction(c);
      if(!a) continue;
      var preDash = {};
      c.students.forEach(function(s){ preDash[s.k] = s.obsDash; s.freshAt = null; });
      var touched = await perform(c, a);
      await observe(c, touched);
      // S4: a replay never moves them back
      if(a.kind === "practise" && a.replayFrom && !a.replayFrom.other){
        var nowQ = a.s.obsDash && a.s.obsDash.row.seqs ? a.s.obsDash.row.seqs[a.s.disp(a.k)] : null;
        if(nowQ && !nowQ.other && a.replayAt === a.s.disp(a.k)){
          if(nowQ.index >= a.replayFrom.index) c.ok("S4", a.s.letter + " replayed a finished list and stayed at " + seqText(nowQ));
          else c.fail("S4", a.s.letter + " replayed a finished list with misses", "at or past " + seqText(a.replayFrom), seqText(nowQ));
        }
      }
      // S4: a teacher's edit other than Go back or a raised percent never moves them back
      if(a.kind === "edit"){
        [0, 1].forEach(function(k){
          var es = a.edits.filter(function(e){ return e.k === k; });
          if(!es.length || es.some(function(e){ return e.op === "goback" || (e.op === "bar" && e.dir > 0) || e.op === "inorder" || e.op === "give-red"; })) return;
          // Section k's row before and after (the row and the page list the same sequences, Red Words first; the
          // page's titles say which is which).
          var rowOf = function(dash){
            if(!dash || !dash.row.seqs || !dash.det.seqs) return -1;
            for(var i = 0; i < dash.det.seqs.length; i++) if(/^Red Words · /.test(dash.det.seqs[i].titles[0] || "") === (k === 0)) return i;
            return -1;
          };
          var ip = rowOf(preDash[a.s.k]), inow = rowOf(a.s.obsDash);
          var pre = ip >= 0 ? preDash[a.s.k].row.seqs[ip] : null;
          var nowQ2 = inow >= 0 ? a.s.obsDash.row.seqs[inow] : null;
          if(!pre || !nowQ2 || pre.other || nowQ2.other) return;
          // A percent that went up, by − / + or with a saved order's own percent, is "raising the percent".
          var pd = preDash[a.s.k].det.seqs && preDash[a.s.k].det.seqs[ip], nd = a.s.obsDash.det.seqs && a.s.obsDash.det.seqs[inow];
          if(pd && nd && nd.pct > pd.pct) return;
          if(nowQ2.index >= pre.index) c.ok("S4", "edit (" + es.map(function(e){ return e.op; }).join(", ") + ") left " + a.s.letter + " at or past where they were");
          else c.fail("S4", "the teacher's edit (" + es.map(function(e){ return e.op + (e.dir ? (e.dir > 0 ? "+" : "−") : ""); }).join(", ") + ") of " + SECTION_NAME[k] + " of " + a.s.letter,
            "at or past " + seqText(pre), seqText(nowQ2));
        });
      }
      // S4: held stays held through practice
      if(a.kind === "practise"){
        var p = a.s.plans[a.k];
        if(p && p.hold){
          var q = a.s.obsDash && a.s.obsDash.row.seqs ? a.s.obsDash.row.seqs[a.s.disp(a.k)] : null;
          c.check("S4", a.s.letter + " is held by Go back and practised", "List " + (p.at + 1) + " of " + p.steps.length + " · held", q ? seqText(q) : "nothing");
        }
      }
      // S5 on what the step saved afresh
      c.students.forEach(function(s){
        var cur = s.obsDash && s.obsDash.row.seqs;
        if(s.freshAt && cur) s.freshAt.forEach(function(f, k){
          if(!f || !s.plans[k] || !cur[s.disp(k)]) return;
          var e = s.pos(k);
          c.check("S5", SECTION_NAME[k] + " of " + s.letter + " saved afresh: where the walk from at " + (s.plans[k].at + 1) + " puts them",
            seqText({ index: e.index, n: s.plans[k].steps.length, finished: e.finished, held: e.hold }), seqText(cur[s.disp(k)]));
        });
      });
    }
    FRAMES.innerHTML = "";
    return c;
  }

  /* ════════════════════════════════════════════════════════════════════
     KNOWN — real site faults, listed so the default run stays green; each was
     reported with its replay command. A failure matching one prints "~ known".
     ════════════════════════════════════════════════════════════════════ */
  var KNOWN = [];      // none

  /* ════════════════════════════════════════════════════════════════════
     THE RUN
     ════════════════════════════════════════════════════════════════════ */
  async function main(){
    var st = await selfTest();
    await post({ kind: "selftest", batch: BATCH, tests: st, families: FAMILIES, fakeFaults: FAKE_FAULTS });
    for(var job of JOBS){
      var c, res;
      try{
        c = await runCase(job);
        res = { kind: "case", case: c.i, family: c.fam, seed: c.seed, held: c.held, failures: c.failures, known: c.known, lines: c.lines,
                steps: c.n.steps, teacherActions: c.n.teacherActions, answers: c.n.answers, homeLoads: c.n.homeLoads, previews: c.n.previews };
      }catch(e){
        res = { kind: "case", case: job.i, family: job.fam, seed: job.seed, held: c ? c.held : 0, known: c ? c.known : [], lines: c ? c.lines : [],
                failures: (c ? c.failures : []).concat([{ check: "crash", step: c ? c.where() : "setup", expected: "the case runs", got: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }]),
                steps: 0, teacherActions: 0, answers: 0, homeLoads: 0, previews: 0 };
      }
      await post(res);
      OUT.textContent += "case " + job.i + " done\n";
    }
    OUT.textContent += "done\n";
    document.title = "done";
  }
  main().catch(function(e){ OUT.textContent += "crashed: " + (e && e.stack || e) + "\n"; post({ kind: "crash", error: String(e && e.stack || e) }); });
})();
