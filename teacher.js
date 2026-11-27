/* ════════════════════════════════════════════════════════════════════
   teacher.js — the dashboard. Teacher accounts only: the admin
   (ADMIN_EMAILS) and anyone the admin has added (teachers/{email}).

   Adapted from the guitar-class site's teacher.js, and it inherits that
   file's central caveat, worth repeating because it is the thing people
   get wrong about client-side dashboards:

     THE GATE ON THIS PAGE IS COSMETIC. Everything here runs in the
     student's own browser and can be reached from DevTools. What
     actually stops a student reading the class's work is
     firestore.rules — the database simply refuses to answer. This file
     shows a friendly "wrong account" panel so the real teacher knows
     they're signed in as the wrong Google account; it is not security.

   ── Classes ───────────────────────────────────────────────────────────
   A CLASS ("P3 Intensive") is a named group with one or more teachers,
   and every student is in exactly one. A teacher sees only the students
   in classes they teach: every list query below carries
   where('teachers','array-contains',me), because firestore.rules only
   allows a list it can prove from the query, and every document about a
   student carries its class's `classId` and a copy of its `teachers`.
   Any teacher on a class can add or remove co-teachers (from the
   approved teachers); only the admin adds teachers to the site, and the
   admin sees every class. When a class's teachers change, every member
   doc is rewritten, and maintain() repairs any copy still out of step on
   the next load.

   ── The layout ────────────────────────────────────────────────────────
   A console: a grouped sidebar on the left, a slim top bar (title, the
   class filter, Refresh, Student view), and one view at a
   time underneath. The sidebar's groups:
     Students   Students — a row per student: the list they are on, how
                far through it, their place in their sequence, and at
                most one line saying what needs a teacher; tick rows to
                give several students a sequence at once. Click through
                to a student's page: their lists in order, their data,
                their notes.
                Trouble spots — the same words aggregated across the
                class: what to teach tomorrow.
     Set up     Classes — importing the roster, making classes and
                sharing them with co-teachers, and who is in which. A
                class decides who sees a student, never what the student
                sees.
                Manage — Archived, Backup, and (admin only) Teachers, one
                section at a time behind a row of tabs.

   The class filter in the top bar is the page's, not a view's: the
   Students table and Trouble spots both follow it, it is
   remembered in localStorage, and one that matches nobody (a class that
   has since emptied) falls back to All rather than showing a blank page.

   An ARCHIVED student is hidden from every view and deleted from
   nothing: their class's doc (classes/{id}.archived) holds their key. `students` is the
   class with them taken out; `everyone` still has them, for the lookups
   that must not be fooled by a hidden row (whose student is this, has
   this address signed in).

   ── The one rule ──────────────────────────────────────────────────────
   A student sees exactly the lists ticked for them, and nothing else.
   There is no period list, no class default, and no "everything" when
   nothing is set — see EIStore.effectiveLists, which is the one place
   that rule is written down. A student with nothing ticked sees an
   empty home page, so the dashboard says loudly who that is.

   ── The picker ────────────────────────────────────────────────────────
   Where a set of lists is chosen for one student — their own page, for a
   student with no sequence — one component draws it, pickerHtml(). It is one
   section per family, because that is the only kind of entry the
   registry has:
     one list      a line of mode checkboxes — "Blend Words: 🎤 Say it ·
                   🃏 Cards · 🎯 Match It".
     many lists    a grid: one row per list with a few of its words as a
                   reminder, one column per mode, with row and column
                   "all" toggles, because "lists 1–4 as flash cards"
                   should be four clicks, not eight.
   A live summary under the picker (WordLists.describeAssignment) says
   in words what the ticks add up to, and the roster shows that same
   line, so what a student HAS and what you're SETTING read the same way.
   What gets saved is a flat array of list ids — the picker is
   presentation only; store.js and the rules never see the grid.

   ── Why assignments live in their own collection ──────────────────────
   The teacher has READ on students/{uid} and no write, deliberately: the
   dashboard never needs to modify a student's work, and withholding write
   means a compromised teacher session can't erase the class. Everything
   the teacher DOES set — assigned lists — is therefore in
   assignments/{uid}, which the student can only read.
   ════════════════════════════════════════════════════════════════════ */

(function(){
  "use strict";

  var db = null;
  var students = [];          // [{uid, name, email, photo, classId, stats, ...}] — archived taken out
  var assignments = {};       // uid → { lists, classId, teachers }
  var notes = {};             // uid → { text, updatedAt, classId, teachers } — teachers only
  var roster = {};            // email → { name, id, lists, importedAt, classId, teachers }
  var rosterReadable = false; // false until the roster rules are published
  var classes = {};           // classId → { id, name, teachers, archived, createdAt, createdBy }
  var me = "";                // the signed-in address, lowercased
  var admin = false;          // EIAuth.isAdmin(), read once at boot
  var teacherDocs = [];       // teachers/{email}: [{email, name, addedAt, addedBy}]
  var view = "roster";
  var everyone = [];          // `students` plus the archived — see applyArchive
  var manageSection = null;   // Manage's open section; null until read from localStorage
  var detailUid = null;
  var meUid = "";             // the signed-in teacher's uid — which is also their test student's
  var meEmail = "";           // their address exactly as the sign-in token has it (the rules compare it with ==)
  var testStudent = null;     // the teacher's own account as a student, or null: see "The test student"

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  /* For attribute selectors built from a period name or a scope id. A
     period may be named anything a teacher types: stripping quotes made
     the selector match nothing (and Save then wrote an empty list, parking
     every student in that period), and a backslash made querySelector
     throw outright. */
  function cssq(s){
    s = String(s == null ? "" : s);
    return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
  }

  // The admin addresses, lowercased, from the same config auth.js reads.
  function adminEmails(){
    var v = (typeof ADMIN_EMAILS !== "undefined") ? ADMIN_EMAILS : null;
    if(v == null) return [];
    return (typeof v === "string" ? [v] : v).map(function(e){ return String(e).toLowerCase(); });
  }
  function adminEmail(){ return adminEmails()[0] || ""; }
  function low(x){ return String(x == null ? "" : x).toLowerCase(); }
  function sameList(a, b){ return JSON.stringify(a || null) === JSON.stringify(b || null); }

  /* Every address known to be a teacher: the admin, the signed-in
     teacher, and every teachers/ doc (any teacher may read the list).
     Teachers play the games too (store.js writes students/{their uid}),
     so without this filter they show up in the admin's loadAll as
     students with "no games yet". */
  function knownTeachers(){
    var out = {};
    adminEmails().forEach(function(e){ out[e] = true; });
    if(me) out[me] = true;
    teacherDocs.forEach(function(t){ if(t.email) out[low(t.email)] = true; });
    return out;
  }

  // A teacher's display name.
  function teacherName(email){
    email = low(email);
    for(var i=0;i<teacherDocs.length;i++){
      if(teacherDocs[i].email === email) return teacherDocs[i].name || email;
    }
    return email;
  }

  /* ---------------- classes ----------------
     Which class a student is in. Their roster row is the record of it —
     it is what an import writes and what store.js copies onto the
     student's own doc — then their own doc, then their assignment. */
  function classIdOf(s){
    if(!s) return "";
    var r = rosterFor(s), a = assignments[s.uid];
    return (r && r.classId) || s.classId || (a && a.classId) || "";
  }
  function className(id){
    var c = classes[id];
    return c ? (c.name || "Untitled class") : "No class";
  }
  function teachesClass(id){
    var c = classes[id];
    return !!(c && c.teachers.indexOf(me) !== -1);
  }
  // One stored class doc as the page holds it.
  /* Sequences a teacher has kept for a class, on the class document
     (classes/{id}.sequences.<key> = { name, steps, bar, createdAt }), so
     every teacher on the class sees and can use them and firestore.rules
     did not have to change. Nothing read back is trusted: a name that is
     not a string, or steps that are not a usable plan, drops that entry. */
  var SAVED_NAME_MAX = 60, SAVED_MAX = 20;
  function cleanSaved(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach(function(k){
      var v = raw[k];
      if(!k || k.length > 40 || /[.\/]/.test(k) || !v || typeof v !== "object" || typeof v.name !== "string") return;
      var name = v.name.trim().slice(0, SAVED_NAME_MAX);
      var plan = Adaptive.sanitizePlan({ steps: v.steps, bar: v.bar });
      if(!name || !plan) return;
      out[k] = { name: name, steps: plan.steps, bar: plan.bar, createdAt: Math.max(0, Math.floor(Number(v.createdAt) || 0)) };
    });
    return out;
  }
  function classRowOf(id, d){
    d = d || {};
    return {
      id: id,
      name: d.name || "",
      teachers: Array.isArray(d.teachers) ? d.teachers.map(low) : [],
      archived: (d.archived && typeof d.archived === "object") ? d.archived : {},
      sequences: cleanSaved(d.sequences),
      createdAt: d.createdAt || 0,
      createdBy: d.createdBy || ""
    };
  }
  /* The stamp every write about a student carries: the class id and a
     copy of that class's teachers. firestore.rules checks it against the
     class doc itself, and the copy is what a teacher's list query finds. */
  function stampFor(id){
    var c = classes[id];
    return c ? { classId: id, teachers: c.teachers.slice() } : {};
  }
  function stampOf(uid){ return stampFor(classIdOf(studentByUid(uid))); }
  function withStamp(body, uid){
    var st = stampOf(uid);
    for(var k in st) body[k] = st[k];
    return body;
  }
  // Every class on this page, by name — numbers in order ("P2" before "P10").
  function allClasses(){
    return Object.keys(classes).sort(function(a, b){
      return className(a).localeCompare(className(b), undefined, { numeric: true, sensitivity: "base" });
    });
  }
  // The classes this account may put a student in: the ones they teach,
  // or, for the admin, all of them.
  function placeableClasses(){
    return allClasses().filter(function(id){ return admin || teachesClass(id); });
  }
  function classOptions(selected, list, none){
    return (none ? '<option value=""' + (selected ? "" : " selected") + ">" + esc(none) + "</option>" : "") +
      (list || placeableClasses()).map(function(id){
        return '<option value="' + esc(id) + '"' + (id === selected ? " selected" : "") + ">" + esc(className(id)) + "</option>";
      }).join("");
  }

  /* ---------------- boot ---------------- */
  EIAuth.ready().then(function(user){
    if(!user) return;
    if(!EIAuth.isTeacher()){
      EIAuth.unlock();
      $("tSub").textContent = "";
      $("tBody").innerHTML =
        '<div class="panel denied">' +
          "<h2>Not this account</h2>" +
          '<p class="note">You\'re signed in as <b>' + esc(user.email) + "</b>, which isn\'t a teacher account here. " +
          "If you teach this class, ask <b>" + esc(adminEmail() || "the admin") + "</b> to add you.</p>" +
          '<button class="btn ghost" id="tSwitch">Sign out and switch account</button>' +
        "</div>";
      $("tSwitch").addEventListener("click", EIAuth.signOut);
      return;
    }
    me = String(user.email || "").toLowerCase();
    meUid = user.uid || "";
    meEmail = user.email || "";
    admin = !!(EIAuth.isAdmin && EIAuth.isAdmin());
    return loadAll().then(function(){
      EIAuth.unlock();
      $("tNav").hidden = false;
      $("tTools").hidden = false;
      bindChrome();
      render();
    });
  }).catch(function(){
    EIAuth.unlock();
    // Guarded because tests.html loads this file for its pure helpers and
    // has none of the dashboard's markup to write into.
    var body = $("tBody");
    if(body) body.innerHTML = '<div class="panel"><h2>Couldn\'t load the class</h2>' +
      '<p class="note">The database didn\'t answer. Check the network, then reload.</p></div>';
  });

  /* A teacher's view of a collection: only the documents that name them.
     The where clause is not an optimisation — firestore.rules refuses a
     teacher's list query that doesn't carry it. The admin's has none. */
  function mine(col){
    return admin ? db.collection(col) : db.collection(col).where("teachers", "array-contains", me);
  }

  /* `pass` counts the maintenance reloads in one chain (see maintain):
     every outside caller starts at 0, so migration and self-heal run on
     every load and refresh, and stop after two passes whatever happens. */
  function loadAll(pass){
    pass = pass || 0;
    return EIAuth.db().then(function(d){
      db = d;
      if(!db) throw new Error("no db");
      return Promise.all([
        mine("students").get(),
        mine("assignments").get(),
        mine("classes").get(),
        // Teacher-only, by firestore.rules. A student reading this
        // collection gets nothing, which is the point of it existing
        // separately from assignments/{uid} — see the rules file.
        mine("notes").get(),
        /* Its own catch. Every other collection failing means the
           dashboard is broken; this one failing means the roster rules
           have not been published yet, which is a state the site is
           designed to survive — see firestore.rules. */
        mine("roster").get().catch(function(){ return null; }),
        // Any teacher may list these: the co-teacher picker shows names.
        db.collection("teachers").get().catch(function(){ return null; }),
        // The old shared periods doc, read only to migrate it.
        admin ? db.collection("config").doc("class").get().catch(function(){ return null; }) : null,
        // The teacher's own record, which is their test student's practice
        // (see "The test student"). Always readable by its owner; a failure
        // only means the test student shows no practice.
        meUid ? db.collection("students").doc(meUid).get().catch(function(){ return null; }) : null
      ]);
    }).then(function(snaps){
      teacherDocs = [];
      if(snaps[5]) snaps[5].forEach(function(doc){
        var t = doc.data() || {};
        teacherDocs.push({ email: low(doc.id), name: t.name || "", addedAt: t.addedAt || 0, addedBy: t.addedBy || "" });
      });
      teacherDocs.sort(function(a, b){ return low(a.name || a.email) < low(b.name || b.email) ? -1 : 1; });
      classes = {};
      snaps[2].forEach(function(doc){ classes[doc.id] = classRowOf(doc.id, doc.data()); });

      // Everything maintenance needs, as plain data — see migrationBody
      // and healBody.
      var raw = { students: [], assignments: {}, notes: {}, roster: {},
                  configPeriods: (snaps[6] && snaps[6].exists && Array.isArray((snaps[6].data() || {}).periods))
                    ? snaps[6].data().periods : [] };
      function stampData(d){
        var o = { classId: d.classId || "", teachers: Array.isArray(d.teachers) ? d.teachers : null };
        if(Object.prototype.hasOwnProperty.call(d, "period")) o.period = d.period;
        return o;
      }
      students = [];
      var teachers = knownTeachers();
      snaps[0].forEach(function(doc){
        var d = doc.data() || {};
        if(d.email && teachers[low(d.email)]) return;
        var st = stampData(d); st.id = doc.id; st.email = d.email || "";
        raw.students.push(st);
        students.push({
          uid: doc.id,
          name: d.name || "",
          email: d.email || "",
          photo: d.photo || "",
          classId: d.classId || "",
          stats: Adaptive.sanitizeStats(d.words),
          heard: Adaptive.sanitizeHeard(d.heard),
          fluency: Adaptive.sanitizeFluency(d.fluency),
          totals: d.totals || { n:0, r:0 },
          recent: Array.isArray(d.recent) ? d.recent : [],
          lastSeen: d.lastSeen || 0,
          // How far through a sequence they are (their own high-water
          // marks: seq for `plan`, seq2 for `plan2`); planState reads
          // them, nothing else does.
          seq: Adaptive.sanitizeSeq(d.seq),
          seq2: Adaptive.sanitizeSeq(d.seq2)
        });
      });
      assignments = {};
      snaps[1].forEach(function(doc){
        assignments[doc.id] = doc.data() || {};
        raw.assignments[doc.id] = stampData(assignments[doc.id]);
      });
      testStudent = buildTestStudent(meUid, assignments[meUid], snaps[7] && snaps[7].exists ? snaps[7].data() : null);
      notes = {};
      snaps[3].forEach(function(doc){
        notes[doc.id] = doc.data() || {};
        raw.notes[doc.id] = stampData(notes[doc.id]);
      });
      roster = {};
      rosterReadable = !!snaps[4];
      if(snaps[4]) snaps[4].forEach(function(doc){
        roster[low(doc.id)] = rosterRowOf(doc.id, doc.data() || {});
        raw.roster[low(doc.id)] = stampData(doc.data() || {});
      });
      addPendingStudents();
      // Sort by display name, falling back to the email local part — an
      // account with no display name shouldn't sink to the bottom.
      students.sort(function(a,b){
        var an = (a.name || a.email).toLowerCase(), bn = (b.name || b.email).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
      applyArchive(students);
      return raw;
    }).then(function(raw){ return maintain(raw, pass); });
  }

  /* ---------------- maintenance: migration and self-heal ----------------
     Two jobs, both run on load, both pure (data in, a list of writes
     out) so tests.html can pin them, both no-ops once there is nothing
     to do — so neither needs a flag in the database and either is safe
     to interrupt.

     MIGRATION (admin only). Before classes, students had a free-text
     PERIOD (on their assignment, else their roster row) and one shared
     config/class listed the period names. Each distinct period becomes a
     class owned by the admin; every document without a classId gets its
     student's class and the period field is deleted; a student with no
     period goes to a class called "No class yet"; and the first time
     there are no classes at all, every name in config/class becomes a
     class too, even an empty one. The admin then shares classes with
     co-teachers or moves students.

     SELF-HEAL (everyone). Every document about a student carries a copy
     of their class's teachers. When co-teachers change, all of them are
     rewritten; if that is interrupted, this finishes it: any member doc
     this account can see whose classId or teachers differ from its
     class's gets corrected. A student's class is read from their roster
     row first (the record), then their own doc, then their assignment. */
  var DELETE = "\u0000delete";          // → FieldValue.delete() in commitWrites
  var NO_CLASS_NAME = "No class yet";

  function migrationBody(raw, classList, adminAddr, teachersKnown, newId, now){
    adminAddr = low(adminAddr);
    teachersKnown = teachersKnown || {};
    var out = [], byName = {};
    (classList || []).forEach(function(c){ if(!byName[c.name]) byName[c.name] = c; });
    function classFor(name){
      if(byName[name]) return byName[name];
      var c = { id: newId(), name: name, teachers: [adminAddr] };
      byName[name] = c;
      out.push({ col: "classes", id: c.id, data: { name: name, teachers: [adminAddr], archived: {}, createdAt: now, createdBy: adminAddr } });
      return c;
    }
    function stamp(c, doc){
      var d = { classId: c.id, teachers: c.teachers.slice() };
      if(doc && Object.prototype.hasOwnProperty.call(doc, "period")) d.period = DELETE;
      return d;
    }
    function periodFor(a, r){
      // The assignment's word wins, even "" ("no period"); then the roster's.
      if(a && typeof a.period === "string") return a.period;
      return (r && r.period != null) ? String(r.period) : "";
    }
    var done = { roster: {}, students: {} }, classOfUid = {};
    (raw.students || []).forEach(function(st){
      var email = low(st.email);
      if(email && teachersKnown[email]) return;       // a teacher's own record
      var r = (raw.roster || {})[email];
      if(st.classId || (r && r.classId)) return;      // already in a class: self-heal's job
      var c = classFor(periodFor((raw.assignments || {})[st.id], r) || NO_CLASS_NAME);
      classOfUid[st.id] = c;
      out.push({ col: "students", id: st.id, data: stamp(c, null) });
      if(r){ out.push({ col: "roster", id: email, data: stamp(c, r) }); done.roster[email] = true; }
      done.students[st.id] = true;
    });
    Object.keys(raw.roster || {}).forEach(function(email){
      var r = raw.roster[email];
      if(r.classId || done.roster[email]) return;
      out.push({ col: "roster", id: email, data: stamp(classFor(periodFor(null, r) || NO_CLASS_NAME), r) });
    });
    var known = {};
    (raw.students || []).forEach(function(st){ known[st.id] = true; });
    ["assignments", "notes"].forEach(function(col){
      var map = raw[col] || {};
      Object.keys(map).forEach(function(id){
        var doc = map[id];
        if(doc.classId) return;
        var c = classOfUid[id];
        // A student who is already in a class: self-heal stamps it.
        if(!c && known[id]) return;
        // No student doc behind it at all: an orphan, by its own period.
        if(!c) c = classFor(periodFor(col === "assignments" ? doc : null, null) || NO_CLASS_NAME);
        out.push({ col: col, id: id, data: stamp(c, doc) });
      });
    });
    if(!(classList || []).length){
      (raw.configPeriods || []).forEach(function(p){ if(p) classFor(String(p)); });
    }
    return out;
  }

  function healBody(raw, classMap, who, isAdmin){
    who = low(who);
    var out = [];
    function fix(col, id, doc, cid){
      var c = classMap[cid];
      if(!doc || !c) return;
      // A teacher may only stamp a class they teach (firestore.rules).
      if(!isAdmin && c.teachers.indexOf(who) === -1) return;
      if(doc.classId === cid && sameList(doc.teachers, c.teachers)) return;
      out.push({ col: col, id: id, data: { classId: cid, teachers: c.teachers.slice() } });
    }
    var seen = {};
    (raw.students || []).forEach(function(st){
      var email = low(st.email);
      var r = (raw.roster || {})[email];
      var a = (raw.assignments || {})[st.id];
      var cid = (r && r.classId) || st.classId || (a && a.classId) || "";
      if(email) seen[email] = true;
      if(!cid) return;
      if(r) fix("roster", email, r, cid);
      fix("students", st.id, st, cid);
      fix("assignments", st.id, a, cid);
      fix("notes", st.id, (raw.notes || {})[st.id], cid);
    });
    Object.keys(raw.roster || {}).forEach(function(email){
      var r = raw.roster[email];
      if(!seen[email] && r.classId) fix("roster", email, r, r.classId);
    });
    return out;
  }

  /* Firestore caps a batch at 500 writes; 400 leaves headroom. Every
     write here is a set-merge, so a chunk that lands twice is harmless. */
  function commitWrites(writes){
    function prep(data){
      var o = {};
      for(var k in data){
        if(!Object.prototype.hasOwnProperty.call(data, k)) continue;
        o[k] = data[k] === DELETE ? firebase.firestore.FieldValue.delete() : data[k];
      }
      return o;
    }
    var chunks = [], i;
    for(i=0;i<writes.length;i+=400) chunks.push(writes.slice(i, i+400));
    return chunks.reduce(function(chain, chunk){
      return chain.then(function(){
        var batch = db.batch();
        chunk.forEach(function(w){
          batch.set(db.collection(w.col).doc(w.id), prep(w.data), { merge:true });
        });
        return batch.commit();
      });
    }, Promise.resolve());
  }

  function newClassId(){ return db.collection("classes").doc().id; }

  function maintain(raw, pass){
    if(pass >= 2) return;
    var writes = admin
      ? migrationBody(raw, allClasses().map(function(id){ return classes[id]; }), me, knownTeachers(), newClassId, Date.now())
      : [];
    if(!writes.length) writes = healBody(raw, classes, me, admin);
    if(!writes.length) return;
    // A failed pass is not a failed dashboard: the next load tries again.
    return commitWrites(writes).then(function(){
      return loadAll(pass + 1);
    }, function(e){
      if(window.console) console.warn("Class upkeep didn't finish; it will retry next load.", e);
    });
  }

  /* ---------------- the roster ----------------
     A class exists on this dashboard only once every student has signed
     in, which makes the first day of term an empty page. The roster fixes
     that: a row per student, keyed by the address they WILL sign in with,
     imported before any of them has touched the site.

     A roster row with no account behind it is folded into `students` as a
     PENDING student rather than being kept in a list of its own. That is
     the whole design decision here: every view — the table, the detail
     page, both exports — then shows the class as it
     actually is, with the ones who haven't arrived greyed out, and none
     of them had to learn about a second kind of student. What they do
     have to know is that a pending student's assignment is written to
     their roster row instead of to assignments/{uid}; there is no uid to
     write one against yet. */
  // One stored roster document as the dashboard holds it.
  function rosterRowOf(id, d){
    d = d || {};
    var row = {
      email: String(id).toLowerCase(),
      name: d.name || "",
      id: d.id || "",
      lists: Array.isArray(d.lists) ? d.lists : null,
      importedAt: d.importedAt || 0,
      classId: d.classId || "",
      teachers: Array.isArray(d.teachers) ? d.teachers.map(low) : null
    };
    // Sequences set before they had signed in live on the row too, and must
    // survive being read back or the next save would drop them.
    if(d.plan && typeof d.plan === "object") row.plan = d.plan;
    if(d.plan2 && typeof d.plan2 === "object") row.plan2 = d.plan2;
    return row;
  }

  var PENDING_PREFIX = "roster:";
  function isPending(uid){ return String(uid).indexOf(PENDING_PREFIX) === 0; }
  function emailOfPending(uid){ return String(uid).slice(PENDING_PREFIX.length); }

  function addPendingStudents(){
    var signedIn = {};
    students.forEach(function(s){ if(s.email) signedIn[s.email.toLowerCase()] = true; });
    for(var email in roster){
      if(!Object.prototype.hasOwnProperty.call(roster, email)) continue;
      if(signedIn[email]) continue;
      var r = roster[email];
      students.push({
        uid: PENDING_PREFIX + email,
        name: r.name || email,
        email: email,
        photo: "",
        classId: r.classId || "",
        pending: true,
        stats: {}, heard: {}, fluency: {},
        totals: { n:0, r:0 }, recent: [], lastSeen: 0
      });
    }
  }

  function rosterFor(s){
    if(!s || !s.email) return null;
    var r = roster[s.email.toLowerCase()];
    return r || null;
  }

  /* ---------------- importing a roster ----------------
     Paste or drop whatever the student information system produced.
     GameCore.parseRoster does the reading; everything here is about what
     a teacher sees before anything is written, because an import that
     silently did the wrong thing to thirty students is worse than no
     import at all. Nothing is written until the preview has been looked
     at and Import pressed. */
  var importWrap = null;
  var importParsed = null;

  function closeImport(){
    if(importWrap && importWrap.parentNode) importWrap.parentNode.removeChild(importWrap);
    importWrap = null;
    importParsed = null;
  }

  /* ---------------- whose is this row? ----------------
     Each student is in exactly one class, and an import never takes a
     student out of a class the importer doesn't teach. Before anything is
     written, every address that isn't already on this teacher's roster is
     looked up on its own. firestore.rules answers a get of a row in
     somebody else's class with permission-denied — that refusal IS the
     answer — and the admin, who can read every row, is told whose it is.

       new     no row anywhere: write it, into the chosen class
       free    a row in no class, from before classes: claim it
       mine    in a class I teach
       other   in a class I don't teach: skip it, and say so

     Cached per address for the visit, so typing into the paste box
     doesn't re-ask the database on every keystroke. */
  var probe = {};   // email → "new" | "free" | "mine" | "other"

  // Pure: what one lookup says. `res` is {denied:true} or a snapshot-ish
  // {exists, teachers}.
  function classifyProbe(res, who){
    who = low(who);
    if(!res || res.denied) return "other";
    if(!res.exists) return "new";
    if(!Array.isArray(res.teachers)) return "free";
    return res.teachers.map(low).indexOf(who) !== -1 ? "mine" : "other";
  }

  function probeEmails(emails){
    var todo = emails.filter(function(e){
      return e && !roster[e] && !Object.prototype.hasOwnProperty.call(probe, e);
    });
    return Promise.all(todo.map(function(email){
      return db.collection("roster").doc(email).get().then(function(snap){
        probe[email] = classifyProbe({ exists: snap.exists, teachers: snap.exists ? (snap.data() || {}).teachers : null }, me);
      }, function(err){
        // Only a refusal means "someone else's". A network failure is not
        // an answer; leave it unknown and let the write report it.
        if(err && err.code === "permission-denied") probe[email] = "other";
      });
    }));
  }

  /* In a class this account doesn't teach: a row on this page that
     doesn't name me (only the admin can see those), or a lookup that
     said so. */
  function ownedElsewhere(email){
    var r = roster[email];
    if(r) return !!(r.teachers && r.teachers.length && r.teachers.indexOf(me) === -1);
    return probe[email] === "other";
  }

  // Pure: which rows an import may write, and which it must skip.
  function importPlan(rows){
    var take = [], skip = [];
    rows.forEach(function(r){
      if(ownedElsewhere(r.email)) skip.push(r);
      else take.push(r);
    });
    return { take: take, skip: skip };
  }

  function skippedText(skip){
    if(!skip.length) return "";
    var names = skip.map(function(r){ return r.name || r.id || r.email; });
    return skip.length + (skip.length === 1 ? " student is" : " students are") +
      " already in another class (" + names.slice(0, 5).join(", ") +
      (names.length > 5 ? " and " + (names.length - 5) + " more" : "") +
      ") — ask a teacher on that class or the admin to move them.";
  }

  // new · update · already signed in · in another class. The last is not
  // written.
  function rosterStatus(row){
    var signedIn = everyone.filter(function(s){
      return !s.pending && s.email && s.email.toLowerCase() === row.email;
    })[0];
    if(ownedElsewhere(row.email)) return { key: "other", text: "in another class — skipped" };
    if(signedIn) return { key: "signed-in", text: "already signed in", uid: signedIn.uid };
    if(roster[row.email]) return { key: "update", text: "update" };
    if(probe[row.email] === "free") return { key: "update", text: "update" };
    if(!Object.prototype.hasOwnProperty.call(probe, row.email) && db) return { key: "checking", text: "checking…" };
    return { key: "new", text: "new" };
  }

  /* ---------------- which class an import goes into ----------------
     The teacher chooses: "match the file's period column" (the default),
     one of their classes, or a new class. Matching is by name: period 3
     matches a class called "3", "Period 3", "P3" or "P3 Intensive". A
     period that matches nothing becomes a new class ("Period 3"), and a
     row with no period goes to "No class yet". */
  function nameMatchesPeriod(name, p){
    var n = low(name).replace(/\s+/g, " ").trim(), q = low(p).trim();
    if(!q) return false;
    return n === q || n === "period " + q || n === "p" + q ||
           n.indexOf("p" + q + " ") === 0 || n.indexOf("period " + q + " ") === 0;
  }
  function newClassNameFor(p){ return /^\d+$/.test(p) ? "Period " + p : p; }

  /* Pure: where each row goes. `choice` is "" (match the period column),
     a class id, or "+new" (into a new class called `newName`). Returns
     { target: email → class id or "new:<name>", create: [names] }. Only
     the classes in `ids` (the ones this account can place into) count. */
  function importTargets(rows, choice, newName, ids){
    var out = { target: {}, create: [] };
    function fresh(name){
      if(out.create.indexOf(name) === -1) out.create.push(name);
      return "new:" + name;
    }
    rows.forEach(function(r){
      if(choice && choice !== "+new"){ out.target[r.email] = choice; return; }
      if(choice === "+new"){ out.target[r.email] = fresh(String(newName || "").trim() || "New class"); return; }
      var hit = ids.filter(function(id){
        return r.period ? nameMatchesPeriod(className(id), r.period) : low(className(id)) === low(NO_CLASS_NAME);
      })[0];
      out.target[r.email] = hit || fresh(r.period ? newClassNameFor(r.period) : NO_CLASS_NAME);
    });
    return out;
  }
  function targetLabel(key){
    return key.indexOf("new:") === 0 ? key.slice(4) + " (new)" : className(key);
  }

  function importChoice(){
    var sel = document.getElementById("riClass"), box = document.getElementById("riNewClass");
    return { choice: sel ? sel.value : "", newName: box ? box.value : "" };
  }

  function renderImportPreview(){
    var box = document.getElementById("riPreview");
    if(!box) return;
    var p = importParsed;
    if(!p){ box.innerHTML = ""; return; }
    if(!p.rows.length && !p.errors.length){
      box.innerHTML = '<div class="empty">Nothing read out of that yet — paste a roster, or drop a file.</div>';
      document.getElementById("riGo").disabled = true;
      return;
    }
    var plan = importPlan(p.rows);
    var ch = importChoice();
    var targets = importTargets(plan.take, ch.choice, ch.newName, placeableClasses()).target;
    var body = p.rows.map(function(r){
      var st = rosterStatus(r);
      var to = targets[r.email];
      return "<tr><td>" + esc(r.name || "—") + "</td>" +
        '<td class="muted tiny">' + esc(r.email) + "</td>" +
        "<td>" + (r.period ? '<span class="pill">' + esc(r.period) + "</span>" : '<span class="muted tiny">—</span>') + "</td>" +
        "<td>" + (to ? esc(targetLabel(to)) : '<span class="muted tiny">—</span>') + "</td>" +
        '<td><span class="pill ' + (st.key === "new" ? "good" : st.key === "update" ? "warn" : st.key === "other" ? "bad" : "") + '">' + esc(st.text) + "</span></td></tr>";
    }).join("");
    var taking = plan.take.length;

    box.innerHTML =
      "<p class=\"note\"><b>" + taking + (taking === 1 ? " student" : " students") + "</b> ready" +
      (p.errors.length ? ", <b>" + p.errors.length + "</b> " + (p.errors.length === 1 ? "row" : "rows") + " left out" : "") +
      (p.hadHeader ? "" : " · no header row found, so the columns were guessed from their shape") +
      ".</p>" +
      (p.errors.length ? '<div class="empty"><b>Left out:</b><br>' + p.errors.map(function(e){
        return "line " + e.line + (e.name ? " (" + esc(e.name) + ")" : "") + " — " + esc(e.message);
      }).join("<br>") + "</div>" : "") +
      '<div class="tableScroll" style="max-height:46vh"><table class="t"><thead><tr>' +
      "<th>Name</th><th>Signs in as</th><th>Period in file</th><th>Class</th><th>Status</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>" +
      (plan.skip.length ? '<p class="note" style="margin-top:12px">' + esc(skippedText(plan.skip)) + "</p>" : "");
    document.getElementById("riGo").disabled = !taking;
    document.getElementById("riGo").textContent = "Import " + taking +
      (taking === 1 ? " student" : " students");
  }

  function readImport(text){
    importParsed = GameCore.parseRoster(text);
    renderImportPreview();
    var parsed = importParsed;
    // Look up whose each new address is, then redraw the status column —
    // unless the teacher has pasted something else in the meantime.
    probeEmails(parsed.rows.map(function(r){ return r.email; })).then(function(){
      if(importParsed === parsed) renderImportPreview();
    });
  }

  function openImport(){
    closeImport();
    importWrap = document.createElement("div");
    importWrap.className = "abModal";
    importWrap.innerHTML =
      '<div class="abModalBox riBox" role="dialog" aria-modal="true">' +
        "<h2>Import a roster</h2>" +
        '<p class="note">Whatever your student information system exports — comma, tab or semicolon separated. ' +
        "It needs an <b>ID number</b> column and a <b>name</b>; a <b>period</b> column, if there is one, can pick the class. " +
        "Students sign in as <b>&lt;ID number&gt;@seq.org</b>, which is how a row and an account find each other. " +
        "You choose their lists afterwards, on their page.</p>" +
        (rosterReadable ? "" : '<div class="empty" style="border-color:rgba(255,107,107,.45)"><b>The roster rules ' +
          "aren't published yet.</b> This import will fail until somebody pastes <code>firestore.rules</code> into " +
          "Firebase console → Firestore → Rules → Publish.</div>") +
        '<div class="riDrop" id="riDrop">' +
          "<b>Drop a file here</b><br><span class=\"muted tiny\">.csv, .tsv or .txt</span><br>" +
          '<input type="file" id="riFile" accept=".csv,.tsv,.txt,text/plain,text/csv">' +
        "</div>" +
        '<p class="note" style="margin:14px 0 6px">…or paste it:</p>' +
        '<textarea class="riPaste" id="riPaste" spellcheck="false" ' +
          'placeholder="Student ID,Last Name,First Name,Period&#10;102345,Ruiz,Ana,3"></textarea>' +
        '<div class="rowActions" style="margin-top:14px">' +
          '<label class="muted tiny" for="riClass">Put them in</label>' +
          '<select class="sel" id="riClass">' +
            '<option value="">the class matching their period</option>' +
            classOptions("", placeableClasses()) +
            '<option value="+new">a new class…</option>' +
          "</select>" +
          '<input class="txt" id="riNewClass" placeholder="New class name, e.g. P3 Intensive" aria-label="New class name" hidden style="width:240px">' +
        "</div>" +
        '<div id="riPreview"></div>' +
        '<div class="rowActions">' +
          '<button class="btn sm" id="riGo" disabled>Import</button>' +
          '<button class="btn ghost sm" id="riCancel">Cancel</button>' +
          '<span class="saveNote" id="riNote"></span>' +
        "</div>" +
      "</div>";
    document.body.appendChild(importWrap);
    importWrap.addEventListener("click", function(e){ if(e.target === importWrap) closeImport(); });
    document.getElementById("riCancel").addEventListener("click", closeImport);
    var sel = document.getElementById("riClass"), newBox = document.getElementById("riNewClass");
    sel.addEventListener("change", function(){
      newBox.hidden = sel.value !== "+new";
      if(!newBox.hidden) newBox.focus();
      renderImportPreview();
    });
    newBox.addEventListener("input", renderImportPreview);

    var paste = document.getElementById("riPaste");
    paste.addEventListener("input", function(){ readImport(paste.value); });

    var drop = document.getElementById("riDrop");
    var file = document.getElementById("riFile");
    function takeFile(f){
      if(!f) return;
      var fr = new FileReader();
      fr.onload = function(){ paste.value = String(fr.result || ""); readImport(paste.value); };
      fr.readAsText(f);
    }
    file.addEventListener("change", function(){ takeFile(file.files && file.files[0]); });
    ["dragenter","dragover"].forEach(function(ev){
      drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave","drop"].forEach(function(ev){
      drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function(e){
      takeFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    document.getElementById("riGo").addEventListener("click", commitImport);
    renderImportPreview();
  }

  /* What an import writes: one roster/{email} set-merge per row, carrying
     the class stamp, in batches of 400 — plus, first and separately, any
     new class the rows need (the rows' stamps are checked against the
     class doc, so it has to exist before they land).

     Nothing is ever deleted. A student left out of an export by mistake
     keeps their row; removing one is an explicit click on their page. A
     row already in one of the importer's classes is moved to the class
     chosen now; its other documents follow on the next load (self-heal). */
  function importBody(rows, now, classFor){
    var out = { roster: {} };
    rows.forEach(function(r){
      var doc = { name: r.name, id: r.id, importedAt: now };
      var st = stampFor(classFor(r.email));
      for(var k in st) doc[k] = st[k];
      out.roster[r.email] = doc;
    });
    return out;
  }

  // Creates the named classes (skipping any already made in `made`), with
  // the signed-in teacher on each. Resolves to `made`: name → class id.
  function createClasses(names, made){
    var todo = names.filter(function(n){ return !made[n]; });
    if(!todo.length) return Promise.resolve(made);
    var batch = db.batch(), now = Date.now(), rows = {};
    todo.forEach(function(name){
      var id = newClassId();
      var data = { name: name, teachers: [me], archived: {}, createdAt: now, createdBy: me };
      batch.set(db.collection("classes").doc(id), data);
      rows[id] = data;
      made[name] = id;
    });
    return batch.commit().then(function(){
      for(var id in rows) classes[id] = classRowOf(id, rows[id]);
      return made;
    }, function(err){
      todo.forEach(function(n){ delete made[n]; });
      throw err;
    });
  }

  /* Look every address up, leave out the ones in another class, make any
     new class, write the rest. If the write is still refused — a row
     another teacher claimed between the lookup and the click — forget
     what was looked up, look again, and try once more, so one such row
     can't sink the whole class. Resolves to the rows it skipped. */
  function writeImport(rows, choice, newName, retried, made){
    made = made || {};
    return probeEmails(rows.map(function(r){ return r.email; })).then(function(){
      var plan = importPlan(rows);
      if(!plan.take.length) return plan.skip;
      var t = importTargets(plan.take, choice, newName, placeableClasses());
      return createClasses(t.create, made).then(function(){
        var body = importBody(plan.take, Date.now(), function(email){
          var key = t.target[email];
          return key.indexOf("new:") === 0 ? made[key.slice(4)] : key;
        });
        return commitWrites(Object.keys(body.roster).map(function(email){
          return { col: "roster", id: email, data: body.roster[email] };
        }));
      }).then(function(){ return plan.skip; });
    }).catch(function(err){
      if(retried || !(err && err.code === "permission-denied")) throw err;
      rows.forEach(function(r){ if(!roster[r.email]) delete probe[r.email]; });
      // Classes made the first time are reused, not made again.
      return writeImport(rows, choice, newName, true, made);
    });
  }

  function commitImport(){
    var p = importParsed;
    if(!p || !p.rows.length) return;
    var note = document.getElementById("riNote");
    var ch = importChoice();
    if(ch.choice === "+new" && !ch.newName.trim()){
      note.className = "saveNote err"; note.textContent = "Name the new class first.";
      return;
    }
    note.className = "saveNote";
    note.textContent = "Importing…";

    writeImport(p.rows, ch.choice, ch.newName).then(function(skip){
      closeImport();
      return loadAll().then(function(){ return skip; });
    }).then(function(skip){
      view = "roster";
      detailUid = null;
      quickNote = { text: skippedText(skip), err: !!skip.length };
      render();
    }).catch(function(){
      if(note){
        note.className = "saveNote err";
        note.textContent = rosterReadable
          ? "Nothing imported — check the network and try again."
          : "Nothing imported — the roster rules aren't published yet (Firebase console → Firestore → Rules).";
      }
    });
  }

  /* ---------------- shared bits ---------------- */

  /* What this student sees: the same rule store.js applies for the
     student, pinned against it by tests.html. Their own assignment, then
     the lists on their roster row (set here before they had signed in),
     then nothing. `from` is for the export. */
  function effectiveLists(uid){
    // In a sequence (or two): the lists they can play right now — the ones
    // they have finished and the one they are on in each — worked out as
    // store.js does.
    var ps = present(positionsOf(uid));
    if(ps.length) return { ids: Adaptive.playableIds(ps).ids, from: "plan" };
    var a = assignments[uid];
    if(a && Array.isArray(a.lists)) return { ids: a.lists, from: "student" };
    var r = rosterFor(studentByUid(uid));
    if(r && Array.isArray(r.lists)) return { ids: r.lists, from: "roster" };
    return { ids: [], from: "nothing" };
  }

  /* What a student's lists look like in a table cell: the sentence, or a
     warning when there is none — that student's home page is empty. */
  function listsCellHtml(ids){
    return ids.length ? esc(WordLists.describeAssignment(ids))
                      : '<span class="pill warn">nothing yet</span>';
  }

  /* ---------------- the picker ----------------
     One section per family, because that is now the only kind of entry
     there is. A family with several lists (the red words) gets the grid
     it always had — a row per list, a column per mode, with row and
     column toggles, so "lists 1-4 as flash cards" is four clicks rather
     than eight. A family with ONE list has nothing to put in the rows,
     so it collapses to a line of mode checkboxes: "Blend Words:
     🎤 Say it · 🃏 Cards · 🎯 Match It".

     scopeId  "student" — stamped on every input so scopeSelection()
              reads this picker and no other
     selected the ids currently on (array) */
  /* A mode its family has retired, held by a student who was given it
     before it was. Said the same way everywhere it shows. */
  var RETIRED_TIP = "Retired \u2014 still in this student\u2019s list";
  // ' title="…"' for a mode its family has a note on, else nothing.
  function hintAttr(familyKey, modeKey){
    var h = WordLists.hintOf(familyKey, modeKey);
    return h ? ' title="' + esc(h) + '"' : "";
  }
  function retiredMode(familyKey, modeKey){
    return WordLists.isRetired(WordLists.idFor(familyKey, WordLists.listNumsOf(familyKey)[0], modeKey));
  }
  /* A family's modes for a picker or popover: the ones on offer, plus a
     retired one only where `held(mode)` says this scope has it. */
  function modesToShow(famKey, held){
    var offered = WordLists.offeredModesOf(famKey).map(function(m){ return m.key; });
    return WordLists.modesOf(famKey).filter(function(m){
      return offered.indexOf(m.key) !== -1 || held(m);
    });
  }
  function pickerHtml(scopeId, selected){
    var on = function(id){ return (selected || []).indexOf(id) !== -1; };
    var shown = on;
    var sc = esc(scopeId);

    function box(id){
      var ret = WordLists.isRetired(id);
      return '<input type="checkbox" data-scope="' + sc + '" data-list="' + esc(id) + '"' + (on(id) ? " checked" : "") +
        (ret ? ' class="retiredBox" title="' + RETIRED_TIP + '"' : "") + ">";
    }
    function famTools(fam){
      return '<span class="pkTools">' +
        '<button type="button" class="pkMini" data-pk-fam="' + sc + "|" + esc(fam.key) + '|all">all</button>' +
        '<button type="button" class="pkMini" data-pk-fam="' + sc + "|" + esc(fam.key) + '|none">none</button></span>';
    }

    var fams = WordLists.families().map(function(fam){
      /* The modes on offer, plus any retired mode this scope already holds
         (see word-lists.js, "Retired modes"). The held one stays so the
         teacher can see it and untick it; it is never offered fresh, so a
         scope that doesn't hold it gets no box for it at all. */
      var modes = modesToShow(fam.key, function(m){
        return WordLists.listNumsOf(fam.key).some(function(n){ return shown(WordLists.idFor(fam.key, n, m.key)); });
      });
      var body;

      if(fam.lists.length > 1){
        var head = modes.map(function(m){
          // A retired column has no "all": it can be unticked, never filled.
          if(retiredMode(fam.key, m.key)){
            return '<th class="retiredHead" title="' + RETIRED_TIP + '">' + esc(m.icon + " " + m.title) + "</th>";
          }
          return "<th" + hintAttr(fam.key, m.key) + ">" + esc(m.icon + " " + m.title) +
            '<button type="button" class="pkMini" data-pk-col="' + sc + "|" + esc(fam.key) + "|" + esc(m.key) +
            '" title="Tick or untick every list for ' + esc(m.title) + '">all</button></th>';
        }).join("");
        var rows = WordLists.listNumsOf(fam.key).map(function(n){
          var cells = modes.map(function(m){
            var id = WordLists.idFor(fam.key, n, m.key);
            // A retired id gets a box only where it is held.
            return "<td>" + (id && (!WordLists.isRetired(id) || shown(id)) ? box(id) : "") + "</td>";
          }).join("");
          var anyId = WordLists.idsOfList(fam.key, n)[0];
          var preview = anyId ? WordLists.wordsOf(anyId).slice(0, 4).join(", ") + "…" : "";
          return '<tr><td class="pkList"><b>List ' + n + '</b><span class="preview">' + esc(preview) + "</span></td>" + cells +
            '<td><button type="button" class="pkMini" data-pk-row="' + sc + "|" + esc(fam.key) + "|" + n +
            '" title="Tick or untick every mode for this list">all</button></td></tr>';
        }).join("");
        body = '<div class="tableScroll"><table class="redGrid"><thead><tr><th>List</th>' + head + "<th></th></tr></thead>" +
          "<tbody>" + rows + "</tbody></table></div>";
      } else {
        body = '<div class="listGrid">' + modes.map(function(m){
          var id = WordLists.idFor(fam.key, fam.lists[0].n, m.key);
          if(!id) return "";
          var ret = WordLists.isRetired(id);
          return '<label class="check' + (ret ? " retiredBox" : "") + '"' +
            (ret ? ' title="' + RETIRED_TIP + '"' : "") + ">" + box(id) + "<span>" + esc(m.icon + " " + m.title) +
            '<span class="sub2">' + WordLists.wordsOf(id).length + " words" +
            (m.needs ? " · " + esc(m.needs) : "") + "</span></span></label>";
        }).join("") + "</div>";
      }

      return '<div class="pkSection"><div class="pkHead"><h3>' + esc(fam.icon + " " + fam.title) + "</h3>" +
        '<span class="muted tiny">' + esc(fam.note) + "</span>" + famTools(fam) + "</div>" + body + "</div>";
    }).join("");

    return '<div class="picker" data-picker="' + sc + '">' + fams +
      '<div class="pkSummary">Ticked: <b data-pk-summary="' + sc + '"></b></div>' +
    "</div>";
  }

  /* The ids ticked in one picker. Queries the whole document rather than
     #tBody; the scope stamp is what keeps two pickers on one screen apart. */
  function scopeSelection(scopeId){
    var ids = [];
    Array.prototype.forEach.call(document.querySelectorAll('input[data-scope="' + cssq(scopeId) + '"]'), function(cb){
      if(cb.checked) ids.push(cb.dataset.list);
    });
    return ids;
  }
  function pickerInputs(scopeId, filter){
    return Array.prototype.filter.call(document.querySelectorAll('input[data-scope="' + cssq(scopeId) + '"]'), function(cb){
      var l = WordLists.byId(cb.dataset.list);
      return l && (!filter || filter(l));
    });
  }
  function refreshSummary(scopeId){
    var el = document.querySelector('[data-pk-summary="' + cssq(scopeId) + '"]');
    var ids = scopeSelection(scopeId);
    if(el) el.textContent = ids.length ? WordLists.describeAssignment(ids) : "nothing";
  }
  // Tick every input in a group, or untick them all if they're already all on.
  function toggleGroup(inputs){
    // A retired box never counts toward "all on" and is never ticked by
    // this; it only follows when the group is being cleared.
    var live = inputs.filter(function(cb){ return !WordLists.isRetired(cb.dataset.list); });
    var allOn = live.length && live.every(function(cb){ return cb.checked; });
    inputs.forEach(function(cb){
      if(allOn) cb.checked = false;
      else if(!WordLists.isRetired(cb.dataset.list)) cb.checked = true;
    });
  }
  /* One delegated handler for every picker on the page: the mini toggles,
     and a live summary on any change. Bound once per render. */
  function bindPickers(root){
    root = root || $("tBody");
    Array.prototype.forEach.call(root.querySelectorAll("[data-picker]"), function(pk){
      refreshSummary(pk.dataset.picker);
    });
    /* #tBody survives every render — only its contents are replaced — so
       binding on each one stacked another pair of handlers on it. The
       all/none buttons set an absolute state and survived that; the row
       and column toggles FLIP, so two handlers made them a no-op and
       three made them work again. Bind once per element. */
    if(root._eiPickersBound) return;
    root._eiPickersBound = true;
    root.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-pk-fam],[data-pk-col],[data-pk-row]") : null;
      if(!b) return;
      var parts, scope;
      if(b.dataset.pkFam){
        parts = b.dataset.pkFam.split("|"); scope = parts[0];
        pickerInputs(scope, function(l){ return l.family === parts[1]; })
          .forEach(function(cb){
            // "all" ticks what is on offer and leaves a retired box as it
            // is; only "none" clears it.
            if(parts[2] === "all"){ if(!WordLists.isRetired(cb.dataset.list)) cb.checked = true; }
            else cb.checked = false;
          });
      } else if(b.dataset.pkCol){
        parts = b.dataset.pkCol.split("|"); scope = parts[0];
        toggleGroup(pickerInputs(scope, function(l){ return l.family === parts[1] && l.mode === parts[2]; }));
      } else {
        parts = b.dataset.pkRow.split("|"); scope = parts[0];
        toggleGroup(pickerInputs(scope, function(l){ return l.family === parts[1] && String(l.listNum) === parts[2]; }));
      }
      refreshSummary(scope);
    });
    root.addEventListener("change", function(e){
      var cb = e.target;
      if(cb && cb.matches && cb.matches("input[data-scope]")) refreshSummary(cb.dataset.scope);
    });
  }

  /* The photo field is written by the student's own browser, so it can
     hold any URL, and an <img> pointing at a host they control tells them
     when a teacher opens the dashboard. Google account photos are the only
     thing it is meant to hold. */
  function safePhoto(u){
    try{
      var x = new URL(String(u || ""));
      return x.protocol === "https:" &&
             (x.hostname === "googleusercontent.com" || /\.googleusercontent\.com$/.test(x.hostname));
    }catch(e){ return false; }
  }

  function whoHtml(s){
    var av = avatarHtml(s);
    // A note is worth nothing if you have to open a student to find out
    // it exists, so the roster carries the first line of it under the
    // name and the whole thing on hover.
    var n = noteSummary(s.uid);
    return '<div class="who">' + av + "<div style=\"min-width:0\">" +
      '<div class="nm">' + esc(s.name || s.email || s.uid) +
        (n ? ' <span class="noteDot" title="' + esc(noteOf(s.uid)) + '">✎</span>' : "") + "</div>" +
      '<div class="em">' + esc(s.test ? "Your account, as a student" : s.email) + "</div>" +
      (n ? '<div class="noteLine" title="' + esc(noteOf(s.uid)) + '">' + esc(n) + "</div>" : "") +
      "</div></div>";
  }

  function accCell(acc){
    if(acc == null) return '<span class="muted">—</span>';
    var pct = Math.round(acc * 100);
    var cls = pct >= 80 ? "" : pct >= 60 ? "warn" : "bad";
    return '<div class="acc"><span>' + pct + "%</span>" +
      '<span class="bar"><span class="' + cls + '" style="width:' + pct + '%"></span></span></div>';
  }

  function ago(ms){
    if(!ms) return "never";
    var d = Date.now() - ms;
    if(d < 3600000) return Math.max(1, Math.round(d/60000)) + " min ago";
    if(d < 86400000) return Math.round(d/3600000) + " hr ago";
    var days = Math.round(d/86400000);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  function renderSub(){
    // Pending students are folded into `students`, but they have not
    // signed in — this line said "30 students have signed in" with an
    // empty class and a freshly imported roster.
    var n = students.filter(function(s){ return !s.pending; }).length;
    $("tSub").textContent = n
      ? n + (n === 1 ? " student has" : " students have") + " signed in · " + allClasses().length + " class" + (allClasses().length === 1 ? "" : "es") +
        (admin ? " · every class on the site" : "")
      : "No students have signed in yet.";
  }

  /* ---------------- the console's chrome ----------------
     The sidebar, the top bar and the class filter. Painted on every
     render, so nothing in it can disagree with the view underneath. */
  var VIEW_TITLE = {
    roster: "Students", trouble: "Trouble spots", sequences: "Saved sequences",
    groups: "Classes", manage: "Manage"
  };
  // The views the class filter means something on.
  var FILTERED = { roster: true, trouble: true };

  /* Pure: the segmented filter's buttons. All, then each class someone
     (not archived) is in, then "No class (n)" — only while n > 0. */
  function filterSegments(list){
    var counts = {}, loose = 0;
    list.forEach(function(st){
      var c = studentClass(st.uid);
      if(c === null) loose++;
      else counts[c] = (counts[c] || 0) + 1;
    });
    var out = [{ value: "", label: "All" }];
    allClasses().forEach(function(c){
      if(counts[c]) out.push({ value: c, label: className(c), title: className(c) + " \u00b7 " + counts[c] });
    });
    if(loose) out.push({ value: NO_CLASS, label: "No class (" + loose + ")" });
    return out;
  }

  function renderChrome(){
    Array.prototype.forEach.call(document.querySelectorAll("#tNav [data-view]"), function(b){
      if(b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    var title = $("tTitle");
    if(title) title.textContent = VIEW_TITLE[view] || "Teacher Dashboard";
    renderSub();
    var seg = $("tFilter");
    if(!seg) return;
    seg.hidden = !FILTERED[view] || !students.length;
    var cur = classFilter();
    seg.innerHTML = filterSegments(students).map(function(o){
      return '<button type="button" data-filter="' + esc(o.value) + '" aria-pressed="' + (o.value === cur) + '"' +
        (o.title ? ' title="' + esc(o.title) + '"' : "") + ">" + esc(o.label) + "</button>";
    }).join("");
  }

  function bindChrome(){
    Array.prototype.forEach.call(document.querySelectorAll("#tNav [data-view]"), function(b){
      b.addEventListener("click", function(){ switchView(b.dataset.view); });
    });
    $("tFilter").addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-filter]") : null;
      if(!b) return;
      if(!leaveDraftOk("Change the class")) return;
      setClassFilter(b.getAttribute("data-filter"));
      render();
    });
    $("tRefresh").addEventListener("click", refresh);
    $("tPreview").addEventListener("click", togglePreviewPop);
  }

  /* Refresh: the same loadAll() the page booted with, then the current
     view drawn again — no page reload, so the open student, the filter
     and the Manage section all hold. Unsaved edits to a student's lists
     would be thrown away, so it asks first. */
  function refresh(){
    // Ask now, drop the draft only once the new data has arrived: a refresh
    // that fails (the alert below) must not cost anyone their edits.
    if(!confirmLeaveDraft("Refresh")) return;
    var btn = $("tRefresh");
    if(btn){ btn.disabled = true; btn.textContent = "Refreshing\u2026"; }
    loadAll().then(function(){
      dropDraft();
      render();
    }, function(){
      window.alert("Couldn't reach the database. Check the network and try again.");
    }).then(function(){
      if(btn){ btn.disabled = false; btn.textContent = "Refresh"; }
    });
  }

  /* ---------------- student view ----------------
     The home page as one student sees it: index.html?preview=<id> in a
     new tab. store.js does the rest — it loads that student's lists for
     a teacher and writes nothing while it does. Defaults to the student
     whose page is open. */
  var previewPop = null;
  function closePreviewPop(){
    if(previewPop && previewPop.parentNode) previewPop.parentNode.removeChild(previewPop);
    previewPop = null;
  }
  function previewHref(uid){ return "index.html?preview=" + encodeURIComponent(uid); }
  function togglePreviewPop(){
    if(previewPop){ closePreviewPop(); return; }
    var btn = $("tPreview");
    previewPop = document.createElement("div");
    previewPop.className = "abPop tPrevPop";
    previewPop.setAttribute("role", "dialog");
    previewPop.setAttribute("aria-label", "Student view");
    if(!students.length){
      previewPop.innerHTML = '<div class="abPopHead">Student view</div><p class="muted tiny">No students yet.</p>';
    } else {
      var pick = detailUid && students.some(function(x){ return x.uid === detailUid; }) ? detailUid : students[0].uid;
      previewPop.innerHTML =
        '<div class="abPopHead">See the home page as</div>' +
        '<select class="sel" id="tPrevWho" aria-label="Student">' + students.map(function(st){
          return '<option value="' + esc(st.uid) + '"' + (st.uid === pick ? " selected" : "") + ">" +
            esc(st.name || st.email || st.uid) + "</option>";
        }).join("") + "</select>" +
        '<div class="abPopFoot"><span class="muted tiny">Opens a new tab. Nothing is saved.</span>' +
        '<button type="button" class="btn sm" id="tPrevGo">Open</button></div>';
    }
    document.body.appendChild(previewPop);
    var r = btn.getBoundingClientRect();
    var w = previewPop.offsetWidth;
    previewPop.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
    previewPop.style.top = (r.bottom + 6) + "px";
    var go = $("tPrevGo");
    if(go) go.addEventListener("click", function(){
      window.open(previewHref($("tPrevWho").value), "_blank", "noopener");
      closePreviewPop();
    });
    var sel = $("tPrevWho");
    if(sel) sel.focus();
  }
  document.addEventListener("click", function(e){
    if(!previewPop || previewPop.contains(e.target)) return;
    if(e.target.closest && e.target.closest("#tPreview")) return;
    closePreviewPop();
  }, true);

  /* Every way of moving between tabs goes through here — the tab bar and
     the buttons inside a page that say "go and do this over there". */
  function switchView(v){
    if(!leaveDraftOk("Leave this page")) return;
    view = v;
    detailUid = null;
    render();
    window.scrollTo(0, 0);
  }

  function render(){
    // Leaving a student's page (or the Students view) forgets which one was
    // open, so opening the same student again starts fresh on Word lists.
    if(!(view === "roster" && detailUid)) lastDetailUid = null;
    closeGive();
    closePreviewPop();
    renderChrome();
    if(view === "roster") return detailUid ? renderDetail() : renderRoster();
    if(view === "sequences") return renderSequences();
    if(view === "groups") return renderGroups();
    if(view === "manage") return renderManage();
    return renderTrouble();
  }

  /* ---------------- export ----------------
     Everything on this dashboard is already in memory; these two builders
     turn it into the shape somebody can open in a spreadsheet, take to an
     IEP meeting, or paste into a report card. No new reads, no backend.

     Two files rather than one, because they answer different questions:
     the roster is a row per student (where are they, what have they got,
     how are they doing), and the words file is a row per attempted word
     (which is the shape you want when the dashboard doesn't answer your
     question and you'd rather sort it yourself).

     Both builders are pure — a class in, a string out — so the escaping
     below is testable, which matters more here than it looks. A student
     called O'Brien, a note with a comma in it, a word list whose title
     has quotation marks: any of those will break a naive join, and it
     breaks silently, in a file somebody has already emailed on. */

  // RFC 4180: wrap in quotes if the value could confuse a parser, and
  // double any quote inside it. A leading = + - @ is prefixed with a
  // quote as well — Excel and Sheets read those as formulas, and a name
  // that starts with one would otherwise execute on open.
  function csvCell(v){
    var t = (v == null) ? "" : String(v);
    if(/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[",\n\r]/.test(t) ? '"' + t.split('"').join('""') + '"' : t;
  }
  function csvRows(rows){
    // \r\n, because that is what Excel expects and every other reader
    // tolerates.
    return rows.map(function(r){ return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  function pct(x){ return x == null ? "" : Math.round(x * 100); }
  function isoDay(ms){
    if(!ms) return "";
    var d = new Date(ms);
    function two(n){ return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  }

  /* A row per student: who they are, what they've been given and where it
     came from, and how they're doing overall. `lists` is the same sentence
     the roster shows, so a printed copy and the screen agree. */
  /* Which fluency lists get a pair of columns in the roster export. Only
     the ones somebody in the class has actually read — thirteen empty
     column pairs would make the file harder to read, not more complete. */
  function fluencyColumns(){
    var seen = {};
    students.forEach(function(s){
      for(var k in (s.fluency || {})){
        if(Object.prototype.hasOwnProperty.call(s.fluency, k)) seen[k] = true;
      }
    });
    return WordLists.all.filter(function(l){ return l.engine === "fluency" && seen[l.id]; });
  }

  function rosterCsv(){
    var flCols = fluencyColumns();
    var rows = [[
      "Name","Email","Class","Lists",
      "Answers","Accuracy %","Words solid","Words shaky","Slow but right","Top error","Last active","Signed in","Note"
    ].concat(flCols.reduce(function(acc, l){
      return acc.concat([l.listTitle + " latest", l.listTitle + " best"]);
    }, []))];
    students.forEach(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      rows.push([
        s.name, s.email,
        studentClass(s.uid) ? className(studentClass(s.uid)) : "",
        eff.ids.length ? WordLists.describeAssignment(eff.ids) : "nothing yet",
        sum.attempts, pct(sum.accuracy), sum.mastered, sum.struggling,
        sum.slowRight,
        (function(){ var k = Adaptive.topKind(sum.kinds); return k ? kindText(k.kind) : ""; })(),
        isoDay(sum.lastSeen || s.lastSeen), s.pending ? "no" : "yes", noteOf(s.uid)
      ].concat(flCols.reduce(function(acc, l){
        var f = Adaptive.fluencySummary((s.fluency || {})[l.id]);
        return acc.concat(f ? [f.latest, f.best] : ["", ""]);
      }, [])));
    });
    return csvRows(rows);
  }

  /* A row per (student, list, word) they have actually attempted. This is
     the long file — 30 students × 18 words a round adds up — but it is
     the only export that can answer a question nobody thought to build a
     screen for. Words are the plain form, matching the stat key. */
  function wordsCsv(){
    var rows = [["Name","Email","Class","List","Pattern","Mode","Word","Attempts","Correct","Accuracy %","Solid","Slow","Top error","Last practised"]];
    students.forEach(function(s){
      var period = studentClass(s.uid) ? className(studentClass(s.uid)) : "";
      var keys = Object.keys(s.stats).sort();
      keys.forEach(function(key){
        var st = s.stats[key];
        if(!st || !st.n) return;
        var parsed = Adaptive.parseKey(key);
        var l = WordLists.byId(parsed.listId);
        var mode = l && WordLists.modeOf(l.mode);
        var top = Adaptive.topKind(st.k);
        rows.push([
          s.name, s.email, period,
          l ? l.listTitle : parsed.listId,
          WordLists.patternOf(parsed.listId),
          mode ? mode.title : (l ? l.mode : ""),
          parsed.word, st.n, st.r, pct(st.r / st.n),
          Adaptive.isMastered(st) ? "yes" : "no",
          Adaptive.isSlow(st) ? "yes" : "no",
          top ? kindText(top.kind) : "",
          isoDay(st.last)
        ]);
      });
    });
    return csvRows(rows);
  }

  /* Hands the browser a file. A Blob and an object URL rather than a
     data: URI — a words export for a full class runs to hundreds of
     kilobytes, which is past what some browsers will accept in an href. */
  function download(name, text, type){
    try{
      // U+FEFF: without a byte-order mark Excel reads the file as the
      // system's legacy encoding, and every accented name in the class
      // comes out mangled. Every other reader ignores it. A JSON backup
      // gets none: it is read by programs, not by Excel.
      var json = type === "json";
      var blob = new Blob([(json ? "" : "\uFEFF") + text],
        { type: json ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoked on a timer, not immediately: Safari has been known to
      // cancel the download if the URL dies in the same tick as the click.
      setTimeout(function(){ URL.revokeObjectURL(url); }, 5000);
      return true;
    }catch(e){ return false; }
  }

  // "english-intensive-roster-2026-09-04.csv" — dated, because these get
  // saved in a folder and compared to last month's.
  function exportName(kind){
    return "english-intensive-" + kind + "-" + isoDay(Date.now()) + ".csv";
  }

  /* ---------------- students ---------------- */
  /* ---------------- fluency sparkline ----------------
     Inline SVG, no library, no axes, no labels. The question a teacher
     asks of a reading rate is never "what number was week four" — it is
     "is this going up", and a line answers that in less time than it
     takes to read one number. The latest and best are printed beside it
     for the times the number does matter.

     A flat polyline for a single run would read as "no progress"; one
     run is drawn as a dot, which reads as "one run", which is true. */
  function sparkline(runs, w, h){
    var pts = (runs || []).map(function(r){ return r.cwpm; });
    if(!pts.length) return "";
    w = w || 130; h = h || 30;
    var max = Math.max.apply(null, pts), min = Math.min.apply(null, pts);
    if(max === min){ max = min + 1; }
    function x(i){ return pts.length === 1 ? w / 2 : (i / (pts.length - 1)) * (w - 4) + 2; }
    function y(v){ return h - 2 - ((v - min) / (max - min)) * (h - 4); }
    var body = pts.length === 1
      ? '<circle cx="' + x(0).toFixed(1) + '" cy="' + y(pts[0]).toFixed(1) + '" r="3" fill="currentColor"/>'
      : '<polyline points="' + pts.map(function(v, i){ return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ") +
        '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<circle cx="' + x(pts.length-1).toFixed(1) + '" cy="' + y(pts[pts.length-1]).toFixed(1) + '" r="2.5" fill="currentColor"/>';
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h +
           '" role="img" aria-label="' + pts.length + ' timed reads, latest ' + pts[pts.length-1] +
           ' words per minute">' + body + "</svg>";
  }

  // Every list this student has timed reads for, in registry order.
  function fluencyRows(s){
    var out = [];
    WordLists.all.forEach(function(l){
      if(l.engine !== "fluency") return;
      var runs = (s.fluency || {})[l.id];
      var sum = Adaptive.fluencySummary(runs);
      if(!sum) return;
      out.push({ list: l, sum: sum, runs: runs });
    });
    return out;
  }

  // Archived ones too: their page still opens, from Manage → Archived. And
  // the test student, who is in no list — a page of their own opens, though.
  function studentByUid(uid){
    for(var i=0;i<everyone.length;i++) if(everyone[i].uid === uid) return everyone[i];
    if(testStudent && testStudent.uid === uid) return testStudent;
    return null;
  }

  /* ════════════════════════════════════════════════════════════════
     The test student

     A student the teacher can try everything on without touching a real
     class: give them a list or a sequence, play as them, and watch this
     dashboard follow along. It is the teacher's OWN account — their own
     students/{uid} is its practice — made to look like a student. What
     makes it a test student is one flag, `test: true`, on the teacher's
     own assignments/{uid}: that document carries its lists and sequence
     like anyone's, plus the class stamp the rules want on every write.
     Nothing else is new, so firestore.rules did not change.

     It is NOT in `students` or `everyone`. Every count, table, filter,
     Trouble spots, both CSVs and each class's size are made from those two
     lists, so the test student cannot reach any of them and no filter has
     to remember to leave it out. studentByUid() finds it, which is all the
     student's page, the sequence editor and the notes need.

     "Play as" opens index.html?as=test (see store.js): the teacher's tab
     then sees only what the test student was given, and what they play
     is saved to that same record. Reset clears the practice; Remove clears
     it and the flag.
     ════════════════════════════════════════════════════════════════ */
  var TEST_NAME = "Test student";

  /* Pure: the test student as the page holds a student, or null when
     there isn't one. `a` is the teacher's own assignment, `d` their own
     student doc (the practice) — either may be missing. */
  function buildTestStudent(uid, a, d){
    if(!uid || !a || a.test !== true) return null;
    d = d || {};
    return {
      uid: uid, name: TEST_NAME, email: "", photo: "", test: true,
      classId: a.classId || "",
      stats: Adaptive.sanitizeStats(d.words),
      heard: Adaptive.sanitizeHeard(d.heard),
      fluency: Adaptive.sanitizeFluency(d.fluency),
      totals: d.totals || { n:0, r:0 },
      recent: Array.isArray(d.recent) ? d.recent : [],
      lastSeen: d.lastSeen || 0,
      seq: Adaptive.sanitizeSeq(d.seq),
      seq2: Adaptive.sanitizeSeq(d.seq2)
    };
  }

  /* Pure: what clears the test student's practice — words, what the mic
     heard, reading rates, the place in each sequence, the totals. The lists
     and the sequences the teacher gave them stay. */
  function resetBody(uid, email){
    var data = {
      words: DELETE, heard: DELETE, fluency: DELETE, seq: DELETE, seq2: DELETE,
      totals: { n: 0, r: 0 }, recent: [], lastSeen: 0
    };
    /* A merge-write makes the document if it isn't there, and a student doc
       with no email is one the admin's page can't tell from a student (it
       filters teachers out by address). So the address goes with it. */
    if(email) data.email = email;
    return { col: "students", id: uid, data: data };
  }

  // The device's own copies of that practice (store.js's mirror, and the
  // "you moved to a new list" note), so a reset is one all the way down.
  function forgetLocalTest(){
    try{
      localStorage.removeItem("eiStats:" + meUid);
      localStorage.removeItem("ei.plan.seen:" + meUid);
      localStorage.removeItem("ei.plan.seen2:" + meUid);
      // The games' missed-word piles (GameCore.comebackKey).
      for(var i = localStorage.length - 1; i >= 0; i--){
        var k = localStorage.key(i);
        if(/^(blend|card|match)Comeback:/.test(k) && k.indexOf("Comeback:" + meUid + ":") !== -1) localStorage.removeItem(k);
      }
    }catch(e){}
  }

  function testNote(text, err){
    var n = $("tTestNote");
    if(!n) return;
    n.className = "saveNote" + (err ? " err" : "");
    n.textContent = text;
  }

  /* Turn the test student on. It goes in a class the teacher teaches (the
     rules want a class stamp on every write), the first by name; a teacher
     with no class gets one called "Test class". Only the flag and the
     stamp are written, plus empty lists when there is no assignment yet —
     an assignment that already exists keeps its lists. */
  function addTestStudent(){
    if(!meUid || !db) return;
    testNote("Adding…");
    // An assignment that is already there stays in its class, if I still teach it.
    var had = assignments[meUid] && assignments[meUid].classId;
    var home = (had && classes[had] && teachesClass(had)) ? had : allClasses().filter(teachesClass)[0];
    return (home ? Promise.resolve(home) : createClass("Test class")).then(function(cid){
      var body = { test: true, updatedAt: Date.now() };
      if(!assignments[meUid]) body.lists = [];
      var st = stampFor(cid);
      body.classId = st.classId; body.teachers = st.teachers;
      return db.collection("assignments").doc(meUid).set(body, { merge:true });
    }).then(function(){ return loadAll(); }).then(function(){
      render();
      if($("tTestOpen")) $("tTestOpen").focus();
    }, function(){
      testNote("Didn’t add — check the network and try again.", true);
    });
  }

  function resetTestStudent(){
    if(!testStudent) return;
    if(!window.confirm("Reset the test student’s practice?\n\nTheir words, numbers and place in the sequence start over. " +
      "The lists you gave them stay.")) return;
    testNote("Resetting…");
    return commitWrites([resetBody(meUid, meEmail)]).then(function(){
      forgetLocalTest();
      testStudent = buildTestStudent(meUid, assignments[meUid], null);
      render();
      testNote("Reset.");
      if($("tTestReset")) $("tTestReset").focus();
    }, function(){
      testNote("Didn’t reset — check the network and try again.", true);
    });
  }

  /* The writes of Remove, with no questions and no page: practice, then the
     note, then the assignment (the marker) last, each local copy dropped as
     soon as its document is gone, so a failure part-way leaves a test student
     that can be removed again. A missing document can't be deleted under the
     rules (there is no resource to check), so the note only goes if one
     exists. Also what runs before a teacher takes themselves off the class it
     lives in: afterwards the rules would no longer let them write it. */
  function dropTestStudent(){
    return commitWrites([resetBody(meUid, meEmail)]).then(function(){
      return notes[meUid]
        ? db.collection("notes").doc(meUid).delete().then(function(){ delete notes[meUid]; })
        : null;
    }).then(function(){
      return db.collection("assignments").doc(meUid).delete();
    }).then(function(){
      forgetLocalTest();
      delete assignments[meUid];
      testStudent = null;
      if(detailUid === meUid) detailUid = null;
    });
  }

  function removeTestStudent(){
    if(!testStudent) return;
    if(!window.confirm("Remove the test student?\n\nTheir practice and lists are cleared. You can add one again any time.")) return;
    if(!leaveDraftOk("Remove the test student")) return;
    testNote("Removing…");
    return dropTestStudent().then(function(){
      render();
      testNote("Removed. Add one again any time.");
      if($("tTestAdd")) $("tTestAdd").focus();
    }, function(){
      testNote("Didn’t remove — check the network and try again.", true);
    });
  }

  function playTestStudent(){
    window.open("index.html?as=test", "_blank", "noopener");
  }

  // The panel on the Students view: how to get one, or where it is.
  function testPanelHtml(){
    if(!testStudent){
      return '<div class="panel testPanel"><h2>Test student</h2>' +
        '<p class="note">Try the site the way a student does, without touching a real class. ' +
        "It is your own account, set up as a student: give it lists or a sequence, play as it, " +
        "and watch this dashboard follow along. It is never counted in a class.</p>" +
        '<div class="rowActions"><button type="button" class="btn sm" id="tTestAdd">Add a test student</button>' +
        '<span class="saveNote" id="tTestNote" role="status" aria-live="polite"></span></div></div>';
    }
    return '<div class="panel testPanel"><h2>Test student</h2>' +
      '<p class="note">' + esc(stuLine(testStudent)) + ". Your own account, set up as a student, " +
      "so it is never counted in a class.</p>" +
      '<div class="rowActions"><button type="button" class="btn sm" id="tTestOpen">Open their page</button>' +
      '<button type="button" class="btn ghost sm" id="tTestPlay">Play as test student</button>' +
      '<span class="saveNote" id="tTestNote" role="status" aria-live="polite"></span></div></div>';
  }

  // The strip across the top of the test student's own page.
  function testStripHtml(){
    return '<div class="panel testPanel"><p class="note"><b>This is your test student.</b> ' +
      "It is your own account, set up as a student, so nothing here counts toward a class. " +
      "Give it lists below, then play as it to see what a student sees. " +
      "<b>Play as test student</b> saves what you play; <b>Student view</b> only looks.</p>" +
      '<div class="rowActions"><button type="button" class="btn sm" id="tTestPlay">Play as test student</button>' +
      '<button type="button" class="btn ghost sm" id="tTestReset">Reset practice</button>' +
      '<button type="button" class="btn ghost sm" id="tTestRemove">Remove test student</button>' +
      '<span class="saveNote" id="tTestNote" role="status" aria-live="polite"></span></div></div>';
  }

  function wireTestPanel(){
    var on = function(id, fn){ var b = $(id); if(b) b.addEventListener("click", fn); };
    on("tTestAdd", addTestStudent);
    on("tTestOpen", function(){
      if(!leaveDraftOk("Leave this page")) return;
      detailUid = testStudent.uid; render();
    });
    on("tTestPlay", playTestStudent);
    on("tTestReset", resetTestStudent);
    on("tTestRemove", removeTestStudent);
  }

  /* ════════════════════════════════════════════════════════════════
     A student's page: their word lists, in order, and their data

     Three tabs. "Word lists" opens first and holds the sequence editor:
     one row per list, top to bottom, finished ones first, the one they
     are on marked Now, the ones still to come after it. "All practice
     data" and "Notes and class" hold what this page has always held.

     RED WORDS AND OTHER LISTS. A student has at most one of each, and the
     tab always shows both SECTIONS, Red Words first. In this file `which`
     is the section: 0 Red Words (red lists only, stored as `plan`, mark
     `seq`), 1 Other lists (every other list, stored as `plan2`, mark
     `seq2`). Each moves on by itself, with its own heading, percent, Now,
     Move on now, Go back, Stop and Save this sequence.

     WHERE A STUDENT IS is Adaptive.planPosition on their own stats and
     their own high-water mark — the SAME function store.js runs in the
     student's browser, on plans read by the same Adaptive.plansOf, so this
     page can say "Now" and the student's home page cannot disagree.

     EDITS GO TO A DRAFT (drafts[which]), in memory, until Save. The draft
     is plain data and every edit to it is a small pure function
     (draftMove, draftRemove, …) so tests.html can drive it without a page.
     Anything that would throw the drafts away asks first (leaveDraftOk).

     Save is ONE merge-write of both fields, `lists`, the time and the class
     stamp (seqBody). A sequence whose draft changed is written afresh:
     setAt is now, at is the step shown as Now, so the student's old mark
     for it stops counting and it is worked out again from what they have
     learned, starting at `at`. A sequence that did not change is written
     back exactly as it was read, so its mark keeps counting.
     ════════════════════════════════════════════════════════════════ */

  // ---- where a student is ----
  // [Red Words or null, Other lists or null] — read as store.js reads them.
  function plansFor(uid){ return Adaptive.plansOf(assignments[uid], rosterFor(studentByUid(uid))); }
  // One of them: Red Words (0, the default) or Other lists (1), or null.
  function planFor(uid, which){ return plansFor(uid)[which ? 1 : 0]; }
  // The student's own mark for one: seq for Red Words, seq2 for Other lists.
  function markOf(s, which){ return s ? ((which ? s.seq2 : s.seq) || null) : null; }

  /* Everything a screen needs about one of a student's sequences, from
     Adaptive.planPosition: where they are, the current step's ids, the
     finished ones', and every list they can play in it (finished, then
     current). null when there is no such sequence. */
  function positionOf(uid, which){
    var s = studentByUid(uid), plan = planFor(uid, which);
    if(!s || !plan) return null;
    return Adaptive.planPosition(plan, s.stats, listTotal, markOf(s, which));
  }
  // Both: [Red Words' or null, Other lists' or null].
  function positionsOf(uid){ return [positionOf(uid, 0), positionOf(uid, 1)]; }
  function present(xs){ return xs.filter(Boolean); }
  // The ids of the step a sequence is on, or of its last step when it is finished.
  function nowIds(pos){
    var st = pos.plan.steps[Math.min(pos.state.index, pos.plan.steps.length - 1)];
    return st.ids.slice();
  }

  // ---- the drafts ----
  /* Per section: { uid, which, steps, bar, at, hold, hasPlan, base, endAt,
     baseBar } while it is being edited. `hasPlan`: it is the stored
     sequence (`base` is its shape as read, to tell an edit). */
  var drafts = [null, null];
  var KINDS = ["red", "other"];
  var SECTION_NAME = ["Red Words", "Other lists"];
  // "red" for a step of red lists, else "other" — the same test as Adaptive's reader.
  function stepKind(ids){ return Adaptive.isRedId(ids && ids[0]) ? "red" : "other"; }
  function seqUIFresh(){ return { adding: false, addKey: "", addIds: [], changing: -1, naming: false }; }
  // Which little panel is open in each editor: add a list / change the ways of one / name it.
  var seqUIs = [seqUIFresh(), seqUIFresh()];
  function resetSeqUI(){ seqUIs = [seqUIFresh(), seqUIFresh()]; }
  var detailTab = "lists";    // lists | data | notes
  var lastDetailUid = null;

  function cloneSteps(steps){ return steps.map(function(s){ return { ids: s.ids.slice() }; }); }
  function draftShape(d){ return JSON.stringify({ steps: d.steps, bar: d.bar, at: d.at, hold: d.hold }); }

  /* A section's stored sequence as a draft, positioned where the student
     really is — past the end (at = steps.length) for a student who has
     finished every list. `endAt` and `baseBar` remember that, for
     draftStart. null when there is none. */
  function draftFromSaved(uid, which){
    which = which ? 1 : 0;
    var pos = positionOf(uid, which);
    if(!pos) return null;
    var n = pos.plan.steps.length, at = Math.min(pos.state.index, n);
    var d = { uid: uid, which: which, steps: cloneSteps(pos.plan.steps), bar: pos.plan.bar,
              at: at, hold: pos.state.hold, hasPlan: true, endAt: at === n ? n : -1, baseBar: pos.plan.bar };
    d.base = draftShape(d);
    return d;
  }

  /* Where an edited draft's walk starts. K1: no edit but Go back to this
     list, or a RAISED percent, moves a student backwards. So it starts
     where they are (`at`): a finished student stays finished through a
     lowered percent and a saved, ready-made or copied order, and lists
     added after the end start them on the first one they have not already
     finished. A raised percent re-measures from where they are — for a
     finished student, from their last list, so one that no longer meets
     the new bar is theirs again. */
  function draftStart(d){
    if(d.endAt > 0 && d.at === d.endAt && !d.hold && d.bar > d.baseBar) return d.endAt - 1;
    return d.at;
  }
  function emptyDraft(uid, which){
    return { uid: uid, which: which ? 1 : 0, steps: [], bar: Adaptive.defaultBar, at: 0, hold: false, hasPlan: false, base: null };
  }
  // The draft to edit in a section, made if there is none. Both drafts are always one student's.
  function ensureDraft(uid, which){
    which = which ? 1 : 0;
    for(var k=0;k<2;k++) if(drafts[k] && drafts[k].uid !== uid) drafts[k] = null;
    if(!drafts[which]) drafts[which] = draftFromSaved(uid, which) || emptyDraft(uid, which);
    return drafts[which];
  }
  // The draft a section shows: the one being edited, else what is stored (null if neither).
  function draftFor(uid, which){
    which = which ? 1 : 0;
    if(drafts[which] && drafts[which].uid === uid) return drafts[which];
    return draftFromSaved(uid, which);
  }
  // The student the drafts belong to, or null.
  function draftUid(){ return (drafts[0] && drafts[0].uid) || (drafts[1] && drafts[1].uid) || null; }
  function draftDirty(d){
    if(!d) return false;
    return d.hasPlan ? draftShape(d) !== d.base : d.steps.length > 0;
  }
  // The teacher has edited something not yet saved (what leaving asks about, and what Save writes).
  function seqDirty(){ return draftDirty(drafts[0]) || draftDirty(drafts[1]); }

  /* Which step is Now. Untouched, it is the student's real position (their
     mark and all). Edited, it is worked out as it will be once saved: from
     where the walk starts, with the draft's own bar and no old mark,
     because a save starts the plan afresh. */
  function draftIndex(d){
    if(d.hasPlan && draftShape(d) === d.base){
      var pos = positionOf(d.uid, d.which);
      if(pos) return pos.state.index;
    }
    var s = studentByUid(d.uid);
    var st = Adaptive.planState({ steps: d.steps, bar: d.bar, at: draftStart(d), hold: d.hold, setAt: 0 },
                                s ? s.stats : {}, listTotal, null);
    return st ? st.index : 0;
  }

  // ---- the edits: small, pure, and refuse what cannot be done ----
  function listKeyOf(id){
    var l = WordLists.byId(id);
    return l ? l.family + ":" + l.listNum : "?" + id;
  }
  function stepKeys(d){ return d.steps.map(function(st){ return listKeyOf(st.ids[0]); }); }
  var idOrder = null;
  function orderIds(ids){
    if(!idOrder){ idOrder = {}; WordLists.all.forEach(function(l, i){ idOrder[l.id] = i; }); }
    return ids.slice().sort(function(a, b){ return (idOrder[a] || 0) - (idOrder[b] || 0); });
  }
  // One step per list, in the library's order — what "Put these in order"
  // builds from a student's games.
  function stepsFromIds(ids){
    var groups = {}, order = [];
    orderIds(ids.filter(function(id){ return WordLists.exists(id); })).forEach(function(id){
      var k = listKeyOf(id);
      if(!groups[k]){ groups[k] = []; order.push(k); }
      groups[k].push(id);
    });
    return order.map(function(k){ return { ids: WordLists.withSay(groups[k]) }; });
  }
  // Only the steps after Now can move, and only among themselves.
  function draftMove(d, i, delta, idx){
    var j = i + delta;
    if(i <= idx || j <= idx || j >= d.steps.length) return false;
    var t = d.steps[i]; d.steps[i] = d.steps[j]; d.steps[j] = t;
    return true;
  }
  function draftRemove(d, i, idx){
    if(i <= idx || i >= d.steps.length) return false;
    d.steps.splice(i, 1);
    return true;
  }
  // The ways of playing one list: at least one, all of the same list.
  function draftWays(d, i, ids){
    if(i < 0 || i >= d.steps.length || !ids.length) return false;
    var k = listKeyOf(d.steps[i].ids[0]);
    for(var x=0;x<ids.length;x++) if(listKeyOf(ids[x]) !== k) return false;
    d.steps[i] = { ids: WordLists.withSay(ids) };     // Say it stays, whatever was unticked; teaching order
    return true;
  }
  /* One list at the end, once: a list already in the sequence is refused,
     and so is one in `exclude` (keys to leave out), and one of the other
     kind (a red list in Other lists, or another list in Red Words). */
  function draftAdd(d, ids, exclude){
    if(!ids.length) return false;
    var k = listKeyOf(ids[0]);
    for(var x=0;x<ids.length;x++) if(listKeyOf(ids[x]) !== k) return false;
    if(KINDS[d.which] && stepKind(ids) !== KINDS[d.which]) return false;
    if(stepKeys(d).indexOf(k) !== -1) return false;
    if(exclude && exclude.indexOf(k) !== -1) return false;
    d.steps.push({ ids: WordLists.withSay(ids) });
    return true;
  }
  // The percent, in steps of 5 from 50 to 100.
  function draftBar(d, dir){
    var v = Math.max(50, Math.min(100, Math.round(d.bar * 100) + dir * 5));
    if(v / 100 === d.bar) return false;
    d.bar = v / 100;
    return true;
  }
  // Move on now: the next step becomes current and the hold comes off.
  function draftMoveOn(d, idx){
    if(idx >= d.steps.length - 1){
      // On the last list there is nowhere to move to, but a hold put there
      // by Go back has to be liftable: after that the walk decides (past the
      // end, if they have reached the bar).
      if(d.hold && d.at === idx){ d.hold = false; return true; }
      return false;
    }
    d.at = idx + 1; d.hold = false;
    return true;
  }
  // Go back to this list: it becomes current and they stay there.
  function draftGoBack(d, i){
    if(i < 0 || i >= d.steps.length) return false;
    d.at = i; d.hold = true;
    return true;
  }
  /* Replace everything after Now with these steps, leaving out any list
     the student already has before them (a list is in a sequence once), any
     in `exclude`, and every step of the other kind: in Red Words only the
     red lists of an order are used, in Other lists only the rest. Returns
     how many steps it brought in. */
  function draftReplaceLater(d, idx, steps, exclude){
    var keep = d.steps.slice(0, Math.min(d.steps.length, idx + 1));
    var used = keep.map(function(st){ return listKeyOf(st.ids[0]); }).concat(exclude || []);
    var added = 0;
    steps.forEach(function(st){
      if(KINDS[d.which] && stepKind(st.ids) !== KINDS[d.which]) return;
      var k = listKeyOf(st.ids[0]);
      if(used.indexOf(k) === -1){ used.push(k); keep.push({ ids: WordLists.withSay(st.ids) }); added++; }
    });
    d.steps = keep;
    if(d.at > keep.length) d.at = keep.length;
    return added;
  }

  /* Would draftReplaceLater bring in at least one step? Asked on a copy,
     before anything changes, so a sequence that adds nothing leaves the
     draft exactly as it was. */
  function addsAny(d, idx, steps, exclude){
    return draftReplaceLater({ steps: cloneSteps(d.steps), at: d.at, which: d.which }, idx, steps, exclude) > 0;
  }

  /* The ready-made sequences are built from the library when asked for,
     not stored: nothing to go stale when a list is added or retired. Each
     has Say it and Cards ticked, where the family offers them. */
  var READY_MADE = [
    { key: "red", title: "Red Words, Lists 1 to 10", families: ["red"], kind: "red" },
    { key: "sounding", title: "Sounding it out", families: ["blends-start", "blends-end", "digraphs", "silent-e", "r-vowels", "vowel-teams", "oi-oy", "endings", "multi"], kind: "other" }
  ];
  function readyMadeSteps(key){
    var def = READY_MADE.filter(function(r){ return r.key === key; })[0];
    var steps = [];
    if(!def) return steps;
    def.families.forEach(function(fk){
      WordLists.listNumsOf(fk).forEach(function(n){
        var offered = WordLists.idsOfList(fk, n);
        var ids = ["say", "cards"].map(function(m){ return WordLists.idFor(fk, n, m); })
          .filter(function(id){ return id && offered.indexOf(id) !== -1; });
        if(ids.length) steps.push({ ids: WordLists.withSay(ids) });
      });
    });
    return steps;
  }

  /* What Save writes for one draft, as data. The plan starts afresh (setAt
     now) at the step shown as Now — steps.length when that is past the end,
     so a finished student stays finished without their old mark; `lists` is
     that step's ids (the last step's, past the end). */
  function planBody(d, idx, now){
    var n = d.steps.length, at = Math.max(0, Math.min(idx, n));
    return {
      plan: { steps: cloneSteps(d.steps), bar: d.bar, at: at, hold: !!d.hold && at === d.at && at < n, setAt: now },
      lists: d.steps[Math.min(at, n - 1)].ids.slice()
    };
  }
  function unionIds(lists){
    var out = [];
    lists.forEach(function(ids){ ids.forEach(function(id){ if(out.indexOf(id) === -1) out.push(id); }); });
    return out;
  }
  /* The body of every write about a student's sequences, as data: BOTH
     fields — each the plan in `entries` ([Red Words, Other lists], each
     { plan, lists } or null), or deleted when it is null — `lists` (the
     union of each one's current list), the time and the class stamp. Both
     fields always, so the document written holds the student's whole state
     and can never become the source (Adaptive.plansOf) with a sequence
     missing. null when there is neither. */
  function seqBody(uid, entries, now){
    if(!entries[0] && !entries[1]) return null;
    var body = {};
    Adaptive.planFields.forEach(function(f, k){ body[f] = entries[k] ? entries[k].plan : DELETE; });
    body.lists = unionIds(present(entries).map(function(e){ return e.lists; }));
    body.updatedAt = now;
    return withStamp(body, uid);
  }
  // A section's sequence written back exactly as read (same setAt, so its mark keeps counting), or null.
  function storedEntry(uid, which){
    var p = positionOf(uid, which);
    return p ? { plan: p.plan, lists: nowIds(p) } : null;
  }
  // A section as Save writes it: afresh (planBody) when its draft changed, else as stored.
  function sectionEntry(uid, which, now){
    var d = draftFor(uid, which);
    if(!d || !d.steps.length) return null;
    return draftDirty(d) ? planBody(d, draftIndex(d), now) : storedEntry(uid, which);
  }
  // What Save writes for a student: seqBody of both sections.
  function saveBody(uid, now){
    return seqBody(uid, [sectionEntry(uid, 0, now), sectionEntry(uid, 1, now)], now);
  }

  // ---- words for the screen ----
  function stuName(s){ return s.name || s.email || s.uid; }
  function stepTitle(step){ var l = WordLists.byId(step.ids[0]); return l ? l.listTitle : String(step.ids[0]); }
  function modeTitleOf(id){
    var l = WordLists.byId(id), m = l && WordLists.modeOf(l.mode);
    return m ? m.title : String(id);
  }
  function stepWays(step){ return step.ids.map(modeTitleOf).join(" · "); }
  /* The Now row's line about one way at a time: "Open: Match It, Say it ·
     Next: Cards", or "… · Next: Say it, then Cards" when more are waiting;
     just "Open: …" once every way is open. Ids the library no longer has
     are left out. */
  function openText(step, open){
    var live = step.ids.filter(function(id){ return WordLists.exists(id); });
    var shut = live.filter(function(id){ return open.indexOf(id) === -1; });
    var now = live.filter(function(id){ return open.indexOf(id) !== -1; });
    return "Open: " + now.map(modeTitleOf).join(", ") + (shut.length ? " · Next: " + shut.map(modeTitleOf).join(", then ") : "");
  }
  /* What a sequence holds, in a few words, for its heading: the families in
     order and the count — "Red Words · 10 lists", "Starting Blends, Blend
     Words, oi / oy, Multisyllable · 4 lists". */
  function holdsText(steps){
    if(!steps.length) return "no lists yet";
    var fams = [];
    steps.forEach(function(st){
      var l = WordLists.byId(st.ids[0]), f = l && WordLists.familyOf(l.family);
      var t = f ? f.title : stepTitle(st);
      if(fams.indexOf(t) === -1) fams.push(t);
    });
    return (fams.length > 4 ? fams.slice(0, 3).join(", ") + " …" : fams.join(", ")) +
      " · " + steps.length + (steps.length === 1 ? " list" : " lists");
  }

  /* One way of playing a list, against the bar, in whole words:
     "Say it: 14 of 20 solid. 4 more to finish (18 of 20)." */
  function wayLine(stats, id, bar){
    var total = listTotal(id), solid = Adaptive.listSolid(stats, id), need = Adaptive.stepNeed(bar, total);
    var slow = listProgress(stats, id).slow;
    var t = modeTitleOf(id) + ": " + solid + " of " + total + " solid. " +
      (solid >= need ? "Finished (" + need + " of " + total + ")."
                     : (need - solid) + " more to finish (" + need + " of " + total + ").");
    if(slow) t += " " + slow + " more " + (slow === 1 ? "is" : "are") + " right but slow.";
    return { text: t, solid: solid, need: need, total: total };
  }
  function dayText(ms){
    try{ return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" }); }catch(e){ return ""; }
  }

  // "Period 3 · practiced yesterday · 4 rounds this week"
  function stuLine(s, now){
    now = now || Date.now();
    var cls = studentClass(s.uid), parts = [cls ? className(cls) : "No class"];
    if(s.pending){
      parts.push("hasn’t signed in yet");
    } else {
      var last = Adaptive.summarize(s.stats).lastSeen;
      parts.push(last ? "practiced " + ago(last) : "hasn’t practiced yet");
      var rounds = (s.recent || []).filter(function(r){ return r && r.at > now - WEEK_MS; }).length;
      parts.push(rounds + (rounds === 1 ? " round" : " rounds") + " this week");
    }
    return parts.join(" · ");
  }

  // ---- leaving with unsaved edits ----
  // Ask, if there are edits that would be lost. Does not drop anything.
  function confirmLeaveDraft(what){
    if(!seqDirty()) return true;
    var s = studentByUid(draftUid());
    return window.confirm("Changes to " + (s ? stuName(s) + "’s" : "this student’s") +
                          " word lists haven’t been saved yet. " + what + " and lose them?");
  }
  function dropDraft(){ drafts = [null, null]; resetSeqUI(); }
  function leaveDraftOk(what){
    if(!confirmLeaveDraft(what)) return false;
    dropDraft();
    return true;
  }
  window.addEventListener("beforeunload", function(e){
    if(seqDirty()){ e.preventDefault(); e.returnValue = ""; }
  });

  // ---- the editor ----
  /* Ids in an editor: Red Words (section 0) keeps the ids the editor always
     had; Other lists' end in 2, so two editors on one page never share one. */
  function sid(which, base){ return base + (which ? "2" : ""); }
  function seqMeter(w){
    var pct = w.total ? Math.min(100, Math.round(w.solid / w.total * 100)) : 0;
    var mark = w.total ? Math.round(w.need / w.total * 100) : 100;
    return '<div class="seqMeter" role="img" aria-label="' + esc(w.solid + " of " + w.total + " solid; finished at " + w.need) +
      '"><span style="width:' + pct + '%"></span><i style="left:' + mark + '%"></i></div>';
  }
  function waysEditorHtml(d, i, which){
    var step = d.steps[i], l = WordLists.byId(step.ids[0]);
    if(!l) return "";
    var ids = WordLists.idsOfList(l.family, l.listNum);
    // A retired way the student already holds stays shown and stays theirs.
    step.ids.forEach(function(id){ if(ids.indexOf(id) === -1) ids.push(id); });
    // In the teaching order: the order the student will meet them in.
    return '<div class="seqWays" role="group" aria-label="Ways of playing ' + esc(stepTitle(step)) + '">' +
      WordLists.inTeachingOrder(ids).map(function(id){
        return '<label class="check"><input type="checkbox" data-ways="' + esc(id) + '"' +
          (isSayId(id) ? sayLockAttrs(id, which) : step.ids.indexOf(id) !== -1 ? " checked" : "") + ">" + esc(modeTitleOf(id)) + "</label>";
      }).join("") +
      '<p class="muted tiny seqSayWhy" id="' + sid(which, "seqSayWhy") + '">' + esc(SAY_WHY) + "</p>" +
      '<div class="rowActions"><button type="button" class="btn sm" data-seq="ways-done" data-i="' + i + '">Done</button>' +
      '<button type="button" class="btn ghost sm" data-seq="ways-cancel" data-i="' + i + '">Cancel</button>' +
      '<span class="saveNote err" id="' + sid(which, "waysNote") + '" role="status"></span></div></div>';
  }
  function seqRowHtml(s, d, i, idx, saved, which){
    var step = d.steps[i], n = d.steps.length, title = stepTitle(step), t = esc(title);
    var stats = s.stats, kind = i < idx ? "fin" : i === idx ? "now" : "later";
    var tag = kind === "fin" ? "Finished" : kind === "now" ? "Now" : i === idx + 1 ? "Next" : "Later";
    var body = '<div class="seqTop"><b class="seqName">' + t + '</b><span class="seqTag ' + kind + '">' + tag + "</span>" +
      '<span class="muted tiny">' + esc(stepWays(step)) + "</span></div>";
    var btns = "", mark = markOf(s, which);

    if(kind === "fin"){
      var low = null;
      step.ids.forEach(function(id){
        var w = wayLine(stats, id, d.bar);
        if(!low || w.solid < low.solid) low = w;
      });
      var when = 0;
      if(saved && saved.setAt && mark && mark.of === saved.setAt && mark.at === i + 1 &&
         saved.steps[i] && JSON.stringify(saved.steps[i]) === JSON.stringify(step)) when = mark.when;
      body += '<div class="muted seqNote">' + (when ? "Finished " + esc(dayText(when)) + " · " : "") +
        (low ? low.solid + " of " + low.total + " solid" : "") + "</div>";
      btns = '<button type="button" class="btn ghost sm" data-seq="goback" data-i="' + i + '" aria-label="Go back to ' + t + '">Go back to this list</button>';
    } else if(kind === "now"){
      // One way at a time: which are open to the student now (Adaptive.openIds, as their own page works it out).
      if(step.ids.length > 1) body += '<div class="muted tiny seqOpen">' + esc(openText(step, Adaptive.openIds(step, d.bar, stats, listTotal))) + "</div>";
      body += step.ids.map(function(id){
        var w = wayLine(stats, id, d.bar);
        return '<div class="seqWay"><div class="seqLine">' + esc(w.text) + "</div>" + seqMeter(w) + "</div>";
      }).join("");
      if(d.hold && d.at === i) body += '<div class="seqNote seqHeld">Staying here until you press Move on now.</div>';
      if(i < n - 1 || (d.hold && d.at === i)) btns = '<button type="button" class="btn sm" data-seq="moveon" aria-label="Move on now from ' + t + '">Move on now</button>';
    } else {
      if(seqUIs[which].changing === i){
        body += waysEditorHtml(d, i, which);
      } else {
        btns =
          '<button type="button" class="btn ghost sm seqIcon" data-seq="up" data-i="' + i + '" aria-label="Move ' + t + ' earlier" title="Move earlier"' +
            (i <= idx + 1 ? " disabled" : "") + ">▲</button>" +
          '<button type="button" class="btn ghost sm seqIcon" data-seq="down" data-i="' + i + '" aria-label="Move ' + t + ' later" title="Move later"' +
            (i >= n - 1 ? " disabled" : "") + ">▼</button>" +
          '<button type="button" class="btn ghost sm" data-seq="ways" data-i="' + i + '" aria-label="Change the ways of playing ' + t + '">Change ways</button>' +
          '<button type="button" class="btn ghost sm" data-seq="remove" data-i="' + i + '" aria-label="Take ' + t + ' out of the sequence">Take out</button>';
      }
    }
    return '<li class="seqRow ' + kind + '"><span class="seqNum" aria-hidden="true">' + (i + 1) + '</span>' +
      '<div class="seqBody">' + body + "</div>" + (btns ? '<div class="seqBtns">' + btns + "</div>" : "") + "</li>";
  }

  /* The lists a teacher could still add: every one of the section's kind
     (red lists in Red Words, the rest in Other lists) not already in the
     sequence, nor in `exclude`. */
  function addableLists(d, exclude){
    var used = stepKeys(d).concat(exclude || []), out = [];
    WordLists.families().forEach(function(fam){
      WordLists.listNumsOf(fam.key).forEach(function(n){
        var ids = WordLists.idsOfList(fam.key, n);
        if(!ids.length || used.indexOf(fam.key + ":" + n) !== -1) return;
        if(KINDS[d.which] && stepKind(ids) !== KINDS[d.which]) return;
        out.push({ key: fam.key + ":" + n, family: fam, n: n, ids: ids, title: WordLists.byId(ids[0]).listTitle });
      });
    });
    return out;
  }
  // The ways to tick to start with: a copy of the step above when it is the same family.
  function defaultAddIds(d, key){
    var fam = key.split(":")[0], n = Number(key.split(":")[1]);
    var avail = WordLists.idsOfList(fam, n), say = WordLists.idFor(fam, n, "say");
    var withSay = function(ids){ return say && avail.indexOf(say) !== -1 ? WordLists.withSay(ids.length ? ids : [say]) : ids; };
    var last = d.steps[d.steps.length - 1];
    if(!last) return withSay([]);
    var lastL = WordLists.byId(last.ids[0]);
    if(!lastL || lastL.family !== fam) return withSay([]);
    var modes = last.ids.map(function(id){ return WordLists.byId(id).mode; });
    return withSay(modes.map(function(m){ return WordLists.idFor(fam, n, m); }).filter(function(id){ return id && avail.indexOf(id) !== -1; }));
  }
  /* In a sequence, Say it is ticked and cannot be unticked: the one line that says why, and the box itself. */
  var SAY_WHY = "Say it is always part of a sequence. It is the one mode that hears the student read.";
  function isSayId(id){ var l = WordLists.byId(id); return !!(l && l.mode === "say"); }
  function sayLockAttrs(id, which){ return isSayId(id) ? ' checked disabled aria-describedby="' + sid(which, "seqSayWhy") + '"' : ""; }
  function addPanelHtml(d, which, exclude){
    var ui = seqUIs[which];
    var lists = addableLists(d, exclude);
    if(!lists.length) return '<div class="seqAdd"><p class="muted">' +
      (d.which ? "Every other list is already in this sequence." : "Every Red Words list is already in this sequence.") + "</p>" +
      '<div class="rowActions"><button type="button" class="btn ghost sm" data-seq="add-cancel">Close</button></div></div>';
    if(!ui.addKey || !lists.some(function(x){ return x.key === ui.addKey; })){
      // Start on the next list of the family the sequence ends in (after
      // Red List 3, Red List 4), else the first one on offer.
      var last = d.steps[d.steps.length - 1], lastFam = last && WordLists.byId(last.ids[0]) && WordLists.byId(last.ids[0]).family;
      var next = lastFam ? lists.filter(function(x){ return x.family.key === lastFam; })[0] : null;
      ui.addKey = (next || lists[0]).key; ui.addIds = defaultAddIds(d, ui.addKey);
    }
    var cur = lists.filter(function(x){ return x.key === ui.addKey; })[0];
    var byFam = {};
    lists.forEach(function(x){ (byFam[x.family.key] = byFam[x.family.key] || []).push(x); });
    var opts = WordLists.families().filter(function(f){ return byFam[f.key]; }).map(function(f){
      return '<optgroup label="' + esc(f.icon + " " + f.title) + '">' + byFam[f.key].map(function(x){
        return '<option value="' + esc(x.key) + '"' + (x.key === ui.addKey ? " selected" : "") + ">" + esc(x.title) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
    return '<div class="seqAdd"><label class="muted tiny" for="' + sid(which, "seqAddList") + '">List</label>' +
      '<select class="sel seqAddSel" id="' + sid(which, "seqAddList") + '">' + opts + "</select>" +
      '<div class="seqWays" role="group" aria-label="Ways of playing">' + WordLists.inTeachingOrder(cur.ids).map(function(id){
        return '<label class="check"><input type="checkbox" data-addway="' + esc(id) + '"' +
          (isSayId(id) ? sayLockAttrs(id, which) : ui.addIds.indexOf(id) !== -1 ? " checked" : "") + ">" + esc(modeTitleOf(id)) + "</label>";
      }).join("") + "</div>" +
      '<p class="muted tiny seqSayWhy" id="' + sid(which, "seqSayWhy") + '">' + esc(SAY_WHY) + "</p>" +
      '<div class="rowActions"><button type="button" class="btn sm" data-seq="add-go" id="' + sid(which, "seqAddGo") + '"' +
        (ui.addIds.length ? "" : " disabled") + ">Add to the end</button>" +
      '<button type="button" class="btn ghost sm" data-seq="add-cancel">Cancel</button>' +
      '<span class="muted tiny" id="' + sid(which, "seqAddHint") + '"' + (ui.addIds.length ? " hidden" : "") +
        ">Tick at least one way of playing.</span></div></div>";
  }

  /* Another student's sequence of the same kind to copy from — their Red
     Words in the Red Words section, their Other lists in Other lists — one
     entry per student who has one. The value is the student's id. */
  function copyChoices(s, which){
    var out = [];
    which = which ? 1 : 0;
    students.forEach(function(x){
      var p = x.uid === s.uid ? null : planFor(x.uid, which);
      if(p) out.push({ value: x.uid, steps: cloneSteps(p.steps), label: stuName(x) });
    });
    return out;
  }
  function copyChoice(s, value, which){
    return copyChoices(s, which).filter(function(c){ return c.value === value; })[0] || null;
  }

  function seqControlsHtml(s, d, which){
    var others = copyChoices(s, which), ui = seqUIs[which];
    return '<div class="seqControls">' +
      '<button type="button" class="btn ghost sm" data-seq="add-open"' + (ui.adding ? ' aria-expanded="true"' : ' aria-expanded="false"') + ">Add a list</button>" +
      '<span class="seqPick"><label class="muted tiny" for="' + sid(which, "seqReady") + '">Use a saved sequence</label>' +
        '<select class="sel" id="' + sid(which, "seqReady") + '">' + sourceOptionsHtml(sequenceSources(false, KINDS[which])) +
        '</select><button type="button" class="btn ghost sm" data-seq="ready-go">Use it</button></span>' +
      (others.length
        ? '<span class="seqPick"><label class="muted tiny" for="' + sid(which, "seqCopy") + '">Copy from another student</label>' +
          '<select class="sel" id="' + sid(which, "seqCopy") + '">' + others.map(function(c){
            return '<option value="' + esc(c.value) + '">' + esc(c.label) + "</option>";
          }).join("") + '</select><button type="button" class="btn ghost sm" data-seq="copy-go">Copy</button></span>'
        : "") +
      "</div>" + (ui.adding ? addPanelHtml(d, which) : "") + saveSeqHtml(s, d, which);
  }
  /* Keep what is on the screen for the whole class. A student in no class has
     nowhere to keep it, so the button is there but says why it can't be
     used, rather than failing when pressed. */
  function saveSeqHtml(s, d, which){
    var cid = studentClass(s.uid), can = !!cid && d.steps.length > 0, ui = seqUIs[which];
    var why = !cid ? "This student isn’t in a class yet, and sequences are kept with a class. Put them in one first."
            : !d.steps.length ? "Add a list first." : "";
    var full = cid && Object.keys(classes[cid].sequences || {}).length >= SAVED_MAX;
    var whyId = sid(which, "seqSaveWhy");
    return '<div class="seqSaveSeq"><button type="button" class="btn ghost sm" data-seq="savedo-open"' +
        ' aria-expanded="' + (ui.naming && can ? "true" : "false") + '"' +
        (can && !full ? "" : " disabled") + (why ? ' aria-describedby="' + whyId + '"' : "") + ">Save this sequence</button>" +
      (why ? '<span class="muted tiny" id="' + whyId + '">' + esc(why) + "</span>"
           : full ? '<span class="muted tiny" id="' + whyId + '">' + esc(className(cid)) + " already has " + SAVED_MAX + " saved sequences. Delete one first.</span>"
           : '<span class="muted tiny">for ' + esc(className(cid)) + "</span>") +
      (ui.naming && can ? '<div class="seqAdd"><label class="muted tiny" for="' + sid(which, "seqName") + '">Name it</label>' +
        '<input class="txt seqNameBox" id="' + sid(which, "seqName") + '" maxlength="' + SAVED_NAME_MAX + '" placeholder="e.g. Red Words, Lists 1 to 10">' +
        '<div class="rowActions"><button type="button" class="btn sm" data-seq="savedo-go">Save</button>' +
        '<button type="button" class="btn ghost sm" data-seq="savedo-cancel">Cancel</button>' +
        '<span class="saveNote err" id="' + sid(which, "seqSavedNote") + '" role="status"></span></div></div>' : "") +
      "</div>";
  }

  /* One section's editor: "Red Words" or "Other lists", with what it holds
     beside the heading ("Red Words · 10 lists"). `extra` is drawn at its
     foot. Stop is offered when the section has a stored sequence. */
  function editorHtml(s, d, which, extra){
    var uid = s.uid, plan = planFor(uid, which), name = SECTION_NAME[which];
    var idx = d.steps.length ? draftIndex(d) : 0, n = d.steps.length;
    var rows = d.steps.map(function(st, i){ return seqRowHtml(s, d, i, idx, d.hasPlan ? plan : null, which); }).join("");
    var bar = Math.round(d.bar * 100);
    // Beside the name, what it holds: for Red Words just how many; for Other lists the families too.
    var holds = which ? holdsText(d.steps) : n + (n === 1 ? " list" : " lists");
    var head = esc(name) + (n ? ' <span class="seqHolds">' + esc(holds) + "</span>" : "");
    var stop = plan ? '<div class="rowActions"><button type="button" class="btn ghost sm" data-seq="stop">Stop using this sequence</button></div>' : "";
    return '<div class="panel seqEditor" data-which="' + which + '"><h2 id="' + sid(which, "seqHead") + '" tabindex="-1">' + head + "</h2>" +
      '<p class="saveNote ok" id="' + sid(which, "seqFlash") + '" role="status" aria-live="polite"></p>' +
      '<div class="seqBar" aria-live="polite">A list is finished when ' +
        '<button type="button" class="btn ghost sm seqIcon" data-seq="bar-" aria-label="Lower the percent for ' + esc(name) + '"' + (d.bar <= 0.5 ? " disabled" : "") + ">−</button>" +
        '<b class="seqPct" id="' + sid(which, "seqPct") + '">' + bar + '%</b>' +
        '<button type="button" class="btn ghost sm seqIcon" data-seq="bar+" aria-label="Raise the percent for ' + esc(name) + '"' + (d.bar >= 1 ? " disabled" : "") + ">+</button>" +
        " of its words are solid.</div>" +
      (n ? '<ol class="seqRows" id="' + sid(which, "seqRows") + '">' + rows + "</ol>"
         : '<p class="muted">No lists yet. Start from Sounding it out or a saved sequence, copy another student’s, or add a list.</p>') +
      seqControlsHtml(s, d, which) + stop + (extra || "") + "</div>";
  }
  /* Red Words for a student who has none: one button. It fills the section
     with every red list in order, Say it and Cards (the ready-made "Red
     Words, Lists 1 to 10"), at the usual percent, as a draft — nothing is
     given until Save, as with every edit. */
  function redWordsText(){
    var st = readyMadeSteps("red");
    return st.length ? "Every Red Words list in order, " + stepTitle(st[0]).replace(/^Red Words · /, "") + " to " +
      stepTitle(st[st.length - 1]).replace(/^Red Words · /, "") + ", with Say it and Cards. Nothing changes until you press Save." : "";
  }
  function giveRedHtml(){
    return '<div class="panel seqEditor" data-which="0"><h2 id="seqHead" tabindex="-1">Red Words</h2>' +
      '<p class="saveNote ok" id="seqFlash" role="status" aria-live="polite"></p>' +
      '<p class="muted">No Red Words lists yet.</p>' +
      '<div class="rowActions"><button type="button" class="btn sm" data-seq="give-red" aria-describedby="seqGiveRedWhy">Give Red Words</button>' +
      '<span class="muted tiny" id="seqGiveRedWhy">' + esc(redWordsText()) + "</span></div></div>";
  }
  // The "Word lists" tab: Red Words, then Other lists.
  function seqPanelHtml(s){
    var uid = s.uid, eff = effectiveLists(uid), d = draftFor(uid, 0), d2 = draftFor(uid, 1);
    var name = esc(stuName(s)) + "’s word lists";
    var fold = '<details class="seqFold"><summary>Change these games</summary>' +
      '<p class="note">This student sees exactly what is ticked here, and nothing else. ' +
      "Each list can be played several ways — tick each way they should get it.</p>" +
      pickerHtml("student", eff.ids) +
      '<div class="rowActions stickyActions">' +
        '<button class="btn sm" id="tSaveA">Save games</button>' +
        '<span class="saveNote" id="tANote"></span></div></details>';

    // A student with games and no order: say so, and offer to put them in order.
    if(!d && !d2 && eff.ids.length){
      var n = eff.ids.length;
      return '<div class="panel"><h2 id="seqHead" tabindex="-1">' + name + "</h2>" +
        '<p class="saveNote ok" id="seqFlash" role="status" aria-live="polite"></p>' +
        '<p class="seqNoOrder"><b>' + (n === 1 ? "This 1 game" : "These " + n + " games") + ", all at once, in no order</b></p>" +
        '<p class="note">' + esc(WordLists.describeAssignment(eff.ids)) + "</p>" +
        '<div class="rowActions"><button type="button" class="btn sm" data-seq="inorder">Put these in order</button></div>' +
        fold + "</div>";
    }

    var nothing = !d && !d2, dirty = draftUid() === uid && seqDirty();
    var canSave = (d && d.steps.length > 0) || (d2 && d2.steps.length > 0);
    var main = (d ? editorHtml(s, d, 0) : giveRedHtml()) +
      editorHtml(s, d2 || emptyDraft(uid, 1), 1, nothing ? fold : "");
    main += '<div class="seqSave" id="seqSave"' + (dirty ? "" : " hidden") + ' role="status">' +
        '<span class="seqCount">Changes not saved yet</span>' +
        '<span class="saveNote" id="seqNote"></span>' +
        '<button type="button" class="btn ghost sm" data-seq="discard">Discard</button>' +
        '<button type="button" class="btn sm" data-seq="save"' + (canSave ? "" : " disabled") + ">Save</button></div>";

    // Beside it: the list they are on in each, and the ones they have finished.
    var side = "", shown = [d, d2].filter(function(x){ return x && x.steps.length; });
    if(shown.length){
      var nowCards = "", fin = [];
      shown.forEach(function(x){
        var i = draftIndex(x), nx = x.steps.length, cur = i < nx ? x.steps[i] : null;
        nowCards += '<p class="muted tiny seqWhich">' + esc(SECTION_NAME[x.which]) + "</p>" + (cur
          ? "<p><b>" + esc(stepTitle(cur)) + "</b></p><p class=\"muted tiny\">" + esc(stepWays(cur)) + " · list " + (i + 1) + " of " + nx + "</p>"
          : "<p><b>Finished every list</b></p><p class=\"muted tiny\">Add the next ones.</p>");
        fin = fin.concat(x.steps.slice(0, Math.min(i, nx)));
      });
      side = '<aside class="seqSide">' +
        '<div class="panel mini"><h2>On now</h2>' + nowCards + "</div>" +
        '<div class="panel mini"><h2>Finished lists</h2>' + (fin.length
          ? '<ul class="seqFinList">' + fin.map(function(st){ return "<li>" + esc(stepTitle(st)) + "</li>"; }).join("") + "</ul>"
          : '<p class="muted tiny">None yet.</p>') + "</div></aside>";
    }
    return '<div class="seqLayout"><div class="seqMain">' + main + "</div>" + side + "</div>";
  }

  /* Redraw the tab and put focus back near where the person was. `focus`
     is a selector or a list of them, tried in order; the heading is the
     fallback. A repaint replaces every button, so without this focus would
     fall to the top of the page after each edit. */
  function repaintLists(focus, which){
    var s = studentByUid(detailUid), el = $("stuPanel-lists");
    if(!s || !el) return;
    el.innerHTML = seqPanelHtml(s);
    bindPickers();
    var sels = focus ? (Array.isArray(focus) ? focus : [focus]) : [], f = null, k;
    for(k=0;k<sels.length && !f;k++){
      var c = el.querySelector(sels[k]);
      if(c && !c.disabled) f = c;
    }
    if(!f) f = $(sid(which, "seqHead")) || $("seqHead");
    if(f && f.focus) f.focus();
  }
  // After a save or a stop the whole page is drawn again: say so, and
  // land on the editor's heading rather than on nothing.
  function seqSaved(text){
    var flash = $("seqFlash");
    if(flash){ flash.className = "saveNote ok"; flash.textContent = text; }
    var h = $("seqHead");
    if(h && h.focus) h.focus();
  }

  // ---- saving ----
  /* Merge `data` into this student's own copy of their lists document —
     their assignment, or their roster row if they haven't signed in — and
     return what puts it back. A DELETE marker removes a field. */
  function localApply(uid, data){
    var pending = isPending(uid), id = pending ? emailOfPending(uid) : uid;
    var store = pending ? roster : assignments;
    var before = store[id] ? JSON.parse(JSON.stringify(store[id])) : null;
    var row = store[id] || (store[id] = pending ? rosterRowOf(id, {}) : {});
    for(var k in data){
      if(!Object.prototype.hasOwnProperty.call(data, k)) continue;
      if(data[k] === DELETE) delete row[k]; else row[k] = data[k];
    }
    return function(){ if(before) store[id] = before; else delete store[id]; };
  }
  /* One merge-write per student, all in one batch: either every student is
     written or none is, and a failure puts every local copy back exactly as
     it was. `items` is [{ uid, data }]. Optimistic, so the page never waits
     on school Wi-Fi to show what it is about to say. */
  function commitBodies(items){
    var undo = [], writes = items.map(function(it){
      var pending = isPending(it.uid);
      undo.push(localApply(it.uid, it.data));
      return { col: pending ? "roster" : "assignments", id: pending ? emailOfPending(it.uid) : it.uid, data: it.data };
    });
    return commitWrites(writes).then(null, function(err){
      undo.forEach(function(u){ u(); });
      throw err;
    });
  }
  // One student: the editor's Save and Stop.
  function commitStudentBody(uid, data){
    return commitBodies([{ uid: uid, data: data }]);
  }
  function seqFail(uid, which){
    var msg = isPending(uid) && !rosterReadable
      ? "Didn’t save — the roster rules aren’t published yet (Firebase console → Firestore → Rules)."
      : "Didn’t save — check the network and try again.";
    // Beside Save when there is a draft to save; otherwise (a failed Stop)
    // in the status line under that editor's heading, since there is no Save bar.
    var sv = $("seqSave"), note = $("seqNote");
    if(sv && !sv.hidden && note){ note.className = "saveNote err"; note.textContent = msg; return; }
    var flash = $(sid(which, "seqFlash")) || $("seqFlash");
    if(flash){ flash.className = "saveNote err"; flash.textContent = msg; }
  }
  var nameBusy = false;    // a saved sequence is being written: a second press must not write a second copy
  var seqSaving = false;   // a write is on the wire: edits wait, so none can be lost under it
  function saveSeq(){
    var uid = draftUid();
    if(seqSaving || !uid || !seqDirty() || !studentByUid(uid)) return;
    var now = Date.now(), data = saveBody(uid, now);
    if(!data) return;
    var mine = drafts.slice();
    var note = $("seqNote");
    if(note){ note.className = "saveNote"; note.textContent = "Saving…"; }
    seqSaving = true;
    return commitStudentBody(uid, data).then(function(){
      seqSaving = false;
      if(drafts[0] === mine[0] && drafts[1] === mine[1]) dropDraft();
      render();
      if(detailUid === uid) seqSaved("Saved.");
    }, function(){ seqSaving = false; seqFail(uid, 0); });
  }
  /* What Stop writes for one section, as data, or null when it has no
     sequence: its field deleted, the other written back as stored, and
     `lists` the other's current list — or, when it was the only one, the
     list they were on in it (the last one, if they had finished), all at
     once. */
  function stopBody(uid, now, which){
    which = which ? 1 : 0;
    var p = positionOf(uid, which);
    if(!p) return null;
    var entries = [storedEntry(uid, 0), storedEntry(uid, 1)];
    // The stopped one is deleted; its list goes into `lists` only when it was the only one.
    entries[which] = { plan: DELETE, lists: entries[1 - which] ? [] : nowIds(p) };
    return seqBody(uid, entries, now);
  }
  function stopSeq(which){
    which = which ? 1 : 0;
    var uid = detailUid, s = studentByUid(uid), p = s ? positionOf(uid, which) : null;
    if(!p || seqSaving) return;
    var alone = !positionOf(uid, 1 - which);
    var unsaved = seqDirty() && draftUid() === uid
      ? "\n\nChanges you haven’t saved to their lists will be lost." : "";
    var name = SECTION_NAME[which], other = SECTION_NAME[1 - which];
    var msg;
    if(alone){
      var keep = p.state.finished ? p.plan.steps[p.plan.steps.length - 1] : p.plan.steps[p.state.index];
      msg = "Stop using the " + name + " sequence for " + stuName(s) + "?\n\nThey will get just " + stepTitle(keep) +
        ", all at once. The lists they finished leave their home page; their practice record is kept.";
    } else {
      msg = "Stop using the " + name + " sequence for " + stuName(s) + "?\n\nIts lists leave their home page; their practice record is kept. " +
        "Their " + other + " sequence stays as it is, and they stay where they are in it.";
    }
    if(!window.confirm(msg + unsaved)) return;
    var data = stopBody(uid, Date.now(), which);
    seqSaving = true;
    return commitStudentBody(uid, data).then(function(){
      seqSaving = false;
      dropDraft();
      render();
      if(detailUid === uid) seqSaved(alone ? "Stopped. Their lists are all at once again." : "Stopped. They have one sequence now.");
    }, function(){ seqSaving = false; seqFail(uid, which); });
  }

  // ---- what the buttons do ----
  function replaceText(d, idx, what){
    var later = d.steps.slice(idx + 1).map(stepTitle);
    return later.length
      ? "This replaces the lists still to come (" + later.join(", ") + ") with " + what + ". Lists already finished, and the one they are on, stay."
      : "";
  }
  // Which section a button is in: 0 (Red Words) unless it sits inside Other lists.
  function whichOf(el){
    var box = el && el.closest ? el.closest("[data-which]") : null;
    return box && box.getAttribute("data-which") === "1" ? 1 : 0;
  }
  function seqAct(act, el){
    var uid = detailUid, s = studentByUid(uid);
    if(!s || seqSaving) return;
    var which = whichOf(el), ui = seqUIs[which];
    // Selectors for focus, inside this editor.
    var box = '[data-which="' + which + '"] ';
    function F(sel){ return box + sel; }
    // Anything that reshapes the list closes the "change ways" panel: it
    // is addressed by row, and rows have just moved.
    if(act !== "ways" && act !== "ways-done" && act !== "ways-cancel") ui.changing = -1;
    var d, idx, i = el && el.dataset && el.dataset.i != null ? Number(el.dataset.i) : -1, focus = null, ok;
    var editor = document.querySelector("#stuPanel-lists " + box) || document.getElementById("stuPanel-lists") || document;
    switch(act){
      case "inorder":
        // Red games to Red Words (in list order), the rest to Other lists (in the library's order).
        var all = stepsFromIds(effectiveLists(uid).ids);
        [0, 1].forEach(function(k){
          var mine = all.filter(function(st){ return stepKind(st.ids) === KINDS[k]; });
          if(!mine.length) return;
          var dk = ensureDraft(uid, k); dk.steps = mine; dk.at = 0; dk.hold = false;
        });
        break;
      case "give-red":
        d = ensureDraft(uid, 0);
        if(!d.steps.length){ d.steps = readyMadeSteps("red"); d.at = 0; d.hold = false; }
        focus = ["#seqHead", '[data-seq="save"]'];
        break;
      case "bar-": case "bar+":
        d = ensureDraft(uid, which); draftBar(d, act === "bar+" ? 1 : -1);
        // The button just pressed, or its twin when it has hit the end of the range.
        focus = [F('[data-seq="' + act + '"]'), F('[data-seq="' + (act === "bar+" ? "bar-" : "bar+") + '"]')];
        break;
      case "up": case "down":
        d = ensureDraft(uid, which); idx = draftIndex(d);
        ok = draftMove(d, i, act === "up" ? -1 : 1, idx);
        var ni = ok ? i + (act === "up" ? -1 : 1) : i, other = act === "up" ? "down" : "up";
        // The same button on the moved row, so the key can be pressed again;
        // if that end of the list has been reached, the other direction.
        focus = [F('[data-seq="' + act + '"][data-i="' + ni + '"]'), F('[data-seq="' + other + '"][data-i="' + ni + '"]')];
        break;
      case "remove":
        d = ensureDraft(uid, which); draftRemove(d, i, draftIndex(d)); ui.changing = -1;
        focus = [F('[data-seq="remove"][data-i="' + i + '"]'), F('[data-seq="remove"][data-i="' + (i - 1) + '"]'), F('[data-seq="add-open"]')];
        break;
      case "ways": ui.changing = i; ensureDraft(uid, which); focus = F('[data-ways]'); break;
      case "ways-cancel": ui.changing = -1; focus = F('[data-seq="ways"][data-i="' + i + '"]'); break;
      case "ways-done":
        d = ensureDraft(uid, which);
        var ticked = Array.prototype.filter.call(editor.querySelectorAll("[data-ways]"), function(cb){ return cb.checked; })
          .map(function(cb){ return cb.dataset.ways; });
        if(!ticked.length){
          var wn = $(sid(which, "waysNote")); if(wn) wn.textContent = "Tick at least one way of playing.";
          return;
        }
        draftWays(d, i, ticked); ui.changing = -1;
        focus = F('[data-seq="ways"][data-i="' + i + '"]');
        break;
      case "moveon":
        d = ensureDraft(uid, which); draftMoveOn(d, draftIndex(d));
        focus = [F('[data-seq="moveon"]'), '[data-seq="save"]'];
        break;
      case "goback":
        d = ensureDraft(uid, which); draftGoBack(d, i);
        focus = [F('[data-seq="moveon"]'), '[data-seq="save"]'];
        break;
      case "add-open": ui.adding = !ui.adding; ui.addKey = ""; ensureDraft(uid, which); focus = ui.adding ? "#" + sid(which, "seqAddList") : null; break;
      case "add-cancel": ui.adding = false; focus = F('[data-seq="add-open"]'); break;
      case "add-go":
        d = ensureDraft(uid, which);
        if(draftAdd(d, ui.addIds)){ ui.adding = false; ui.addKey = ""; ui.addIds = []; }
        focus = F('[data-seq="add-open"]');
        break;
      case "ready-go":
        d = ensureDraft(uid, which); idx = draftIndex(d);
        var rm = sequenceSources(false, KINDS[which]).filter(function(x){ return x.key === $(sid(which, "seqReady")).value; })[0];
        if(!rm) return;
        // One that would bring nothing changes nothing: no confirm, and the
        // lists still to come stay (cutting them would leave a draft that
        // Save makes permanent, for a sequence that added no list). That
        // includes an order with none of this section's kind.
        if(!addsAny(d, idx, rm.steps)){
          repaintLists(F('[data-seq="ready-go"]'), which); allTaken(which, rm.label, rm.steps); return;
        }
        // A saved sequence brings its own percent; a ready-made one leaves it.
        var takesBar = rm.saved && rm.bar !== d.bar;
        var msg = replaceText(d, idx, rm.label);
        if(msg && takesBar) msg += " The percent becomes " + Math.round(rm.bar * 100) + "%.";
        if(msg && !window.confirm(msg)) return;
        draftReplaceLater(d, idx, rm.steps);
        if(takesBar) d.bar = rm.bar;
        break;
      case "savedo-open": ui.naming = !ui.naming; ensureDraft(uid, which); focus = ui.naming ? "#" + sid(which, "seqName") : null; break;
      case "savedo-cancel": ui.naming = false; focus = F('[data-seq="savedo-open"]'); break;
      case "savedo-go":
        var nmEl = $(sid(which, "seqName")), nm = nmEl ? nmEl.value.trim() : "", sn = $(sid(which, "seqSavedNote"));
        if(nameBusy) return;
        if(!nm){ if(sn) sn.textContent = "Give it a name."; if(nmEl) nmEl.focus(); return; }
        nameBusy = true;
        var goBtn = document.querySelector("#stuPanel-lists " + box + '[data-seq="savedo-go"]');
        if(goBtn) goBtn.disabled = true;
        return saveSequenceFor(uid, nm, which).then(function(r){
          nameBusy = false;
          // The teacher may have moved to another student while it saved:
          // the write stands, but this page is not theirs to repaint.
          if(detailUid !== uid) return;
          ui.naming = false;
          repaintLists(F('[data-seq="savedo-open"]'), which);
          var flash = $(sid(which, "seqFlash"));
          if(flash){ flash.className = "saveNote ok"; flash.textContent = "Saved “" + nm + "” for " + className(r.classId) + "."; }
        }, function(err){
          nameBusy = false;
          if(detailUid !== uid) return;
          var g2 = document.querySelector("#stuPanel-lists " + box + '[data-seq="savedo-go"]'); if(g2) g2.disabled = false;
          var n2 = $(sid(which, "seqSavedNote"));
          if(n2) n2.textContent = err && err.message === "full" ? "This class already has " + SAVED_MAX + " saved sequences. Delete one first."
            : "Didn’t save — check the network and try again.";
        });
      case "copy-go":
        d = ensureDraft(uid, which); idx = draftIndex(d);
        var from = copyChoice(s, $(sid(which, "seqCopy")).value, which);
        if(!from) return;
        // As with a saved sequence: one that would bring nothing changes nothing.
        if(!addsAny(d, idx, from.steps)){
          repaintLists(F('[data-seq="copy-go"]'), which); allTaken(which, from.label + "’s", from.steps); return;
        }
        var msg2 = replaceText(d, idx, from.label + "’s " + SECTION_NAME[which]);
        if(msg2 && !window.confirm(msg2)) return;
        draftReplaceLater(d, idx, from.steps);
        break;
      case "discard":
        dropDraft();
        break;
      case "save": return saveSeq();
      case "stop": return stopSeq(which);
      default: return;
    }
    repaintLists(focus, which);
  }
  /* An order chosen to start from brought nothing: it has none of this
     section's kind, or every list of that kind in it is already there. */
  function allTaken(which, label, steps){
    var flash = $(sid(which, "seqFlash"));
    var none = !(steps || []).some(function(st){ return stepKind(st.ids) === KINDS[which]; });
    if(flash){
      flash.className = "saveNote err";
      flash.textContent = none
        ? "Nothing added: " + (label ? "“" + label + "”" : "it") + (which ? " has no other lists." : " has no Red Words lists.")
        : "Nothing added: every list in it is already in this sequence.";
    }
  }

  /* One delegated handler for the whole tab, bound once to #tBody (whose
     contents are replaced on every render but which itself is not). */
  function bindSeq(){
    var root = $("tBody");
    if(!root || root._eiSeqBound) return;
    root._eiSeqBound = true;
    root.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-seq]") : null;
      if(!b || b.disabled || !root.contains(b)) return;
      seqAct(b.dataset.seq, b);
    });
    // The name box: Enter saves and Escape cancels, as in the Saved sequences view.
    root.addEventListener("keydown", function(e){
      if(!e.target || !e.target.classList || !e.target.classList.contains("seqNameBox")) return;
      if(e.key === "Enter"){ e.preventDefault(); seqAct("savedo-go", e.target); }
      else if(e.key === "Escape"){ e.preventDefault(); seqAct("savedo-cancel", e.target); }
    });
    root.addEventListener("change", function(e){
      var t = e.target;
      if(!t || !t.matches) return;
      var which = whichOf(t), ui = seqUIs[which];
      if(t.matches(".seqAddSel")){
        var d = ensureDraft(detailUid, which);
        ui.addKey = t.value; ui.addIds = defaultAddIds(d, t.value);
        repaintLists("#" + sid(which, "seqAddList"), which);
      } else if(t.matches("[data-addway]")){
        var box = t.closest("[data-which]") || document;
        ui.addIds = Array.prototype.filter.call(box.querySelectorAll("[data-addway]"), function(cb){ return cb.checked; })
          .map(function(cb){ return cb.dataset.addway; });
        var go = $(sid(which, "seqAddGo")); if(go) go.disabled = !ui.addIds.length;
        var hint = $(sid(which, "seqAddHint")); if(hint) hint.hidden = !!ui.addIds.length;
      }
    });
  }

  // ---- the page ----
  var STU_TABS = [["lists", "Word lists"], ["data", "All practice data"], ["notes", "Notes and class"]];

  function stuListHtml(s){
    var list = classStudents().slice();
    if(!list.some(function(x){ return x.uid === s.uid; })) list.unshift(s);
    return '<nav class="stuList" aria-label="Students">' + list.map(function(x){
      return '<button type="button" class="stuPick' + (x.pending ? " pending" : "") + '" data-stu="' + esc(x.uid) + '"' +
        ' tabindex="' + (x.uid === s.uid ? 0 : -1) + '"' +
        (x.uid === s.uid ? ' aria-current="true"' : "") + ">" + esc(stuName(x)) + "</button>";
    }).join("") + "</nav>";
  }

  function setStuTab(k, focus){
    detailTab = k;
    STU_TABS.forEach(function(t){
      var tab = $("stab-" + t[0]), panel = $("stuPanel-" + t[0]), on = t[0] === k;
      if(tab){ tab.setAttribute("aria-selected", on); tab.tabIndex = on ? 0 : -1; }
      if(panel) panel.hidden = !on;
    });
    if(focus && $("stab-" + k)) $("stab-" + k).focus();
  }

  function renderDetail(){
    var s = studentByUid(detailUid);
    if(!s){ detailUid = null; dropDraft(); return renderRoster(); }
    var opened = lastDetailUid !== detailUid;
    var fromList = !!(opened && document.activeElement && document.activeElement.closest && document.activeElement.closest(".stuList"));
    if(opened){
      lastDetailUid = detailUid; detailTab = "lists"; resetSeqUI();
      for(var dk=0;dk<2;dk++) if(drafts[dk] && drafts[dk].uid !== detailUid) drafts[dk] = null;
    }
    var sum = Adaptive.summarize(s.stats);

    // Per-list breakdown, then the worst words across every list. The
    // words carry their list name because "coin" can be solid to read and
    // shaky to spell, and telling those apart is the point of keying stats
    // by list in the first place.
    var perList = WordLists.all.map(function(l){
      var st = Adaptive.statsForList(s.stats, l.id);
      var ls = Adaptive.summarize(st);
      if(!ls.attempts) return "";
      var total = WordLists.wordsOf(l.id).length;
      return "<tr><td>" + esc(l.icon + " " + l.title) + "</td>" +
        '<td class="num">' + ls.attempts + "</td>" +
        '<td class="num">' + accCell(ls.accuracy) + "</td>" +
        '<td class="num">' + ls.mastered + " / " + total +
          (ls.slow ? ' <span class="muted tiny">(' + ls.slow + " slow)</span>" : "") + "</td>" +
        '<td class="num">' + (ls.struggling ? '<span class="pill bad">' + ls.struggling + "</span>" : '<span class="muted">0</span>') + "</td></tr>";
    }).filter(Boolean).join("");

    /* The chips carry what the mic heard, where Say It logged any. A word
       that keeps coming back as "bread" is a reading error worth teaching;
       one that comes back as three spellings of itself is the recogniser
       failing, and the fix for that is a line in ACCEPT, not a lesson. */
    var worst = Adaptive.rank(s.stats).slice(0, 30).map(function(r){
      var parsed = Adaptive.parseKey(r.word);
      var l = WordLists.byId(parsed.listId);
      var pct = Math.round(r.acc * 100);
      var cls = pct >= 80 ? "" : pct >= 60 ? "warn" : "bad";
      var h = (s.heard || {})[r.word];
      return '<div class="wordchip ' + cls + '">' + esc(parsed.word) +
        "<small>" + r.stat.r + "/" + r.stat.n + " · " + esc(l ? l.title : parsed.listId) + "</small>" +
        (h && h.length ? '<small class="heardline">heard: ' + esc(h.slice(-3).join(", ")) + "</small>" : "") +
        "</div>";
    }).join("");

    var fluency = fluencyRows(s).map(function(r){
      return "<tr><td>" + esc(r.list.icon + " " + r.list.listTitle) + "</td>" +
        '<td class="sparkcell">' + sparkline(r.runs) + "</td>" +
        '<td class="num"><b>' + r.sum.latest + "</b></td>" +
        '<td class="num">' + r.sum.best + "</td>" +
        '<td class="num">' + r.sum.runs + "</td></tr>";
    }).join("");

    /* A sentence, not a chart. Four numbers in a row is what this
       actually is, and a bar chart of four numbers is decoration. */
    var errorMix = Adaptive.errorKinds.map(function(k){
      var n = sum.kinds[k] || 0;
      return n ? "<b>" + n + "</b> " + esc(kindText(k)) : "";
    }).filter(Boolean).join(" · ");

    var rosterRow = rosterFor(s);

    var myCls = studentClass(s.uid);
    var clsList = placeableClasses();
    if(myCls && clsList.indexOf(myCls) === -1) clsList = [myCls].concat(clsList);

    var dataPanel =
      '<div class="panel"><h2>This student’s numbers</h2>' +
        '<div class="statRow">' +
          '<div class="stat"><div class="k">Answers</div><div class="v">' + sum.attempts + "</div></div>" +
          '<div class="stat"><div class="k">Accuracy</div><div class="v">' + (sum.accuracy == null ? "—" : Math.round(sum.accuracy*100) + "%") + "</div></div>" +
          '<div class="stat"><div class="k">Words solid</div><div class="v">' + sum.mastered + "</div></div>" +
          '<div class="stat"><div class="k">Words shaky</div><div class="v">' + sum.struggling + "</div></div>" +
          /* Right, and slow. Never shown to the student — see isSlow() —
             because "you are slow" makes the next word slower, not
             faster. It is exactly the number a teacher wants. */
          '<div class="stat"><div class="k">Slow but right</div><div class="v">' + sum.slowRight + "</div></div>" +
          '<div class="stat"><div class="k">Last active</div><div class="v" style="font-size:17px">' + esc(ago(sum.lastSeen || s.lastSeen)) + "</div></div>" +
        "</div></div>" +

      (errorMix ? '<div class="panel"><h2>What goes wrong</h2>' +
        '<p class="note">Counted on Say It only — it is the only mode that hears what the student actually said. ' +
        "One count per word given up on, not per fumble.</p>" +
        "<p>" + errorMix + "</p></div>" : "") +

      '<div class="panel"><h2>Hardest words</h2>' +
        '<p class="note">Worst first — right answers out of attempts, counting only first-try answers. ' +
        "These are the words the site is already showing them most often.</p>" +
        (worst ? '<div class="wordchips">' + worst + "</div>" : '<div class="empty">No practice recorded yet.</div>') +
      "</div>" +

      (fluency ? '<div class="panel"><h2>Reading rate</h2>' +
        '<p class="note">Correct words per minute, one point per timed read, oldest on the left. ' +
        "Accuracy stops moving long before this does — a student can be right about every word on a list " +
        "and still be reading it one word at a time. " +
        "This is <b>word-list rate</b>, not passage reading: it says nothing about phrasing, or about how " +
        "a student handles connected text. Check passage reading separately.</p>" +
        '<div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>List</th><th>Progress</th><th class="num">Latest</th><th class="num">Best</th><th class="num">Reads</th>' +
        "</tr></thead><tbody>" + fluency + "</tbody></table></div></div>" : "") +

      (perList ? '<div class="panel"><h2>By list</h2><div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>List</th><th class="num">Answers</th><th class="num">Accuracy</th><th class="num">Solid</th><th class="num">Shaky</th>' +
        "</tr></thead><tbody>" + perList + "</tbody></table></div></div>" : "");

    var notesPanel =
      /* Notes are keyed by uid, and a pending student's uid is the
         made-up roster:<email> — a note written now would be dropped the
         moment they sign in and got a real one. So don't offer the box. */
      (s.pending
        ? '<div class="panel"><h2>Notes</h2><p class="note">Notes open once they have signed in.</p></div>'
        : notePanelHtml(s.uid)) +

      /* The test student has no class to move between, nothing to archive
         and no roster row: it lives in the class it was made in until it is
         removed, and removing it is its own button, above. */
      (s.test ? "" : '<div class="panel"><h2>Class</h2>' +
        '<p class="note">' + (myCls ? "Taught by " + esc(classes[myCls].teachers.map(teacherName).join(", ")) + ". " : "") +
        "Moving them takes their games, note and practice with them; teachers who aren’t on the new class stop seeing them.</p>" +
        '<div class="rowActions"><label class="muted tiny" for="tClass">Class</label>' +
        '<select class="sel" id="tClass">' + classOptions(myCls, clsList, myCls ? "" : "— no class —") + "</select>" +
        '<span class="saveNote" id="tClassMoveNote"></span></div>' +
      "</div>") +

      (rosterRow ? '<div class="panel"><h2>Roster row</h2>' +
        '<p class="note">Imported ' + esc(rosterRow.importedAt ? ago(rosterRow.importedAt) : "at some point") +
        " · ID <b>" + esc(rosterRow.id || "—") + "</b> · signs in as <b>" + esc(s.email) + "</b>" +
        (s.pending ? " · <b>hasn’t signed in yet</b>" : "") + ". " +
        "A re-import updates this row and never deletes it; removing one is this button, and only this button.</p>" +
        '<div class="rowActions"><button class="btn ghost sm" id="tRosterOut">Remove from roster</button>' +
        '<span class="saveNote" id="tRosterNote"></span></div>' +
      "</div>" : "") +

      (s.test ? "" : '<div class="panel"><h2>Archive</h2><div class="rowActions">' +
        (!myCls ? '<span class="muted tiny">Put them in a class to be able to archive them.</span>' :
         isArchived(s, archivedMap())
          ? '<span class="pill warn">Archived</span> <button class="btn ghost sm" id="tArchive">Unarchive</button>' +
            '<span class="muted tiny">Hidden from every view until you unarchive them.</span>'
          : '<button class="btn ghost sm" id="tArchive">Archive</button>' +
            '<span class="muted tiny">Hides them from every view. Nothing is deleted; Manage → Archived brings them back.</span>') +
        '<span class="saveNote" id="tArchiveNote"></span>' +
      "</div></div>");

    $("tBody").innerHTML =
      '<button class="backlink" id="tBack">← All students</button>' +
      '<div class="stuLayout">' + stuListHtml(s) +
        '<div class="stuMain">' +
          '<div class="stuHead" id="stuHead" tabindex="-1">' + whoHtml(s) +
            '<p class="stuLine muted" id="stuLine">' + esc(stuLine(s)) + "</p>" +
            '<button type="button" class="btn ghost sm" id="tStuView">Student view</button></div>' +
          (s.test ? testStripHtml() : "") +
          '<div class="mTabs stuTabs" role="tablist" aria-label="' + esc(stuName(s)) + '">' + STU_TABS.map(function(t){
            var on = t[0] === detailTab;
            return '<button type="button" role="tab" id="stab-' + t[0] + '" data-stab="' + t[0] + '" aria-selected="' + on +
              '" aria-controls="stuPanel-' + t[0] + '" tabindex="' + (on ? "0" : "-1") + '">' + esc(t[1]) + "</button>";
          }).join("") + "</div>" +
          '<div id="stuPanel-lists" role="tabpanel" aria-labelledby="stab-lists"' + (detailTab === "lists" ? "" : " hidden") + ">" + seqPanelHtml(s) + "</div>" +
          '<div id="stuPanel-data" role="tabpanel" aria-labelledby="stab-data"' + (detailTab === "data" ? "" : " hidden") + ">" + dataPanel + "</div>" +
          '<div id="stuPanel-notes" role="tabpanel" aria-labelledby="stab-notes"' + (detailTab === "notes" ? "" : " hidden") + ">" + notesPanel + "</div>" +
        "</div></div>";

    bindSeq();
    $("tBack").addEventListener("click", function(){
      if(!leaveDraftOk("Go back to the list")) return;
      focusRow = detailUid;
      detailUid = null; render();
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-stu]"), function(b){
      b.addEventListener("click", function(){
        if(b.dataset.stu === s.uid) return;
        if(!leaveDraftOk("Switch to another student")) return;
        detailUid = b.dataset.stu; render();
      });
    });
    var tabs = document.querySelector("#tBody .stuTabs");
    tabs.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-stab]") : null;
      if(b) setStuTab(b.dataset.stab, true);
    });
    tabs.addEventListener("keydown", function(e){
      var keys = STU_TABS.map(function(t){ return t[0]; }), i = keys.indexOf(detailTab), j = null;
      if(e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % keys.length;
      else if(e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + keys.length) % keys.length;
      else if(e.key === "Home") j = 0;
      else if(e.key === "End") j = keys.length - 1;
      if(j === null) return;
      e.preventDefault();
      setStuTab(keys[j], true);
    });
    $("tStuView").addEventListener("click", function(){
      window.open(previewHref(s.uid), "_blank", "noopener");
    });
    /* The student list is one tab stop (the open student) so reaching the
       tabs does not mean tabbing past a whole class; the arrow keys move
       along it and Enter or Space opens the one focused. */
    var picks = Array.prototype.slice.call(document.querySelectorAll("#tBody .stuPick"));
    picks.forEach(function(b){
      b.addEventListener("keydown", function(e){
        var i = picks.indexOf(b), j = null;
        if(e.key === "ArrowDown") j = Math.min(picks.length - 1, i + 1);
        else if(e.key === "ArrowUp") j = Math.max(0, i - 1);
        else if(e.key === "Home") j = 0;
        else if(e.key === "End") j = picks.length - 1;
        if(j === null) return;
        e.preventDefault();
        picks.forEach(function(x){ x.tabIndex = -1; });
        picks[j].tabIndex = 0; picks[j].focus();
      });
    });
    // A student just opened: keep a keyboard user where they were (in the
    // list) or put them at the top of the student rather than on nothing.
    if(opened){
      var land = fromList ? document.querySelector('#tBody .stuPick[aria-current="true"]') : $("stuHead");
      if(land && land.focus) land.focus();
    }
    if($("tArchive")) $("tArchive").addEventListener("click", function(){
      var on = !isArchived(s, archivedMap());
      if(on && !leaveDraftOk("Archive this student")) return;
      var note = $("tArchiveNote");
      note.className = "saveNote"; note.textContent = "Saving…";
      setArchived(s, on).then(function(){
        // Archived: back to the list it has just left. Unarchived: stay.
        if(on) detailUid = null;
        render();
      }, function(){
        note.className = "saveNote err"; note.textContent = "Didn't save — check the network and try again.";
      });
    });
    if($("tClass")) $("tClass").addEventListener("change", function(){
      var sel = this, to = sel.value, from = myCls || "";
      if(!to || to === from) return;
      if(!window.confirm("Move " + (s.name || s.email) + " to " + className(to) + "?")){
        sel.value = from;
        return;
      }
      if(!admin && !teachesClass(to) && !leaveDraftOk("Move them out of your classes")){ sel.value = from; return; }
      var note = $("tClassMoveNote");
      note.className = "saveNote"; note.textContent = "Moving…";
      moveStudents([s], to).then(function(){
        // If the new class isn't one of mine, they leave this page.
        if(!admin && !teachesClass(to)) return loadAll().then(function(){ detailUid = null; render(); });
        render();
      }, function(){
        sel.value = from;
        note.className = "saveNote err"; note.textContent = "Didn't move — check the network and try again.";
      });
    });
    if($("tRosterOut")) $("tRosterOut").addEventListener("click", function(){
      var em = s.email.toLowerCase();
      if(!window.confirm("Remove " + (s.name || em) + " from the roster?\n\n" +
        (s.pending ? "They haven’t signed in, so this takes them off the dashboard entirely."
                   : "Their practice record stays; only the imported row goes."))) return;
      if(!leaveDraftOk("Remove them from the roster")) return;
      var note = $("tRosterNote");
      note.className = "saveNote"; note.textContent = "Removing…";
      db.collection("roster").doc(em).delete().then(function(){
        delete roster[em];
        detailUid = null;
        return loadAll();
      }).then(function(){ render(); }).catch(function(){
        note.className = "saveNote err"; note.textContent = "Didn't remove — check the network and try again.";
      });
    });
    if($("tSaveA")) $("tSaveA").addEventListener("click", function(){ saveStudentAssignment(s.uid); });
    if(!s.pending) $("tNoteSave").addEventListener("click", function(){ saveNote(s.uid, $("tNote").value); });
    wireTestPanel();
    bindPickers();
  }

  function checkedLists(){ return scopeSelection("student"); }

  /* ---------------- the teacher's notes ----------------
     One short paragraph per student, for the things the numbers on this
     page can't say: "reads well, freezes when timed", "sounds it out
     under his breath and gets there", "was out three weeks in March".

     It lives in its own collection because it is the one thing here a
     student may not read about themselves — see firestore.rules. A note
     a student can read is a note written for the student, and that is a
     different document with a different use. */
  var NOTE_MAX = 1000;

  function noteOf(uid){
    var n = notes[uid];
    return (n && typeof n.text === "string") ? n.text : "";
  }
  // First line only, clipped — what the Students table shows when
  // there's no room for the whole thing.
  function noteSummary(uid, max){
    var t = noteOf(uid).replace(/\s+/g, " ").trim();
    if(!t) return "";
    max = max || 70;
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  function saveNote(uid, text){
    var note = $("tNoteNote");
    var before = notes[uid] ? JSON.parse(JSON.stringify(notes[uid])) : null;
    text = String(text || "").slice(0, NOTE_MAX);
    var body = withStamp({ text: text, updatedAt: Date.now() }, uid);
    notes[uid] = body;
    if(note){ note.className = "saveNote"; note.textContent = "Saving…"; }
    db.collection("notes").doc(uid).set(body, { merge:true })
      .then(function(){
        if(note){ note.className = "saveNote ok"; note.textContent = text ? "Saved." : "Cleared."; }
      })
      .catch(function(){
        if(before) notes[uid] = before; else delete notes[uid];
        if(note){ note.className = "saveNote err"; note.textContent = "Didn't save — check the network and try again."; }
      });
  }

  function notePanelHtml(uid){
    var n = notes[uid] || {};
    return '<div class="panel"><h2>Notes</h2>' +
      '<p class="note">For the things the numbers don\'t say. <b>Students can\'t read this.</b> ' +
      "Every teacher on this class can, and so can the site admin.</p>" +
      '<textarea class="txt noteBox" id="tNote" rows="4" maxlength="' + NOTE_MAX +
        '" placeholder="e.g. Reads well, freezes when timed. Sounds words out under his breath — let him.">' +
        esc(noteOf(uid)) + "</textarea>" +
      '<div class="rowActions">' +
        '<button class="btn sm" id="tNoteSave">Save note</button>' +
        '<span class="saveNote" id="tNoteNote">' +
          (n.updatedAt ? "Last edited " + esc(ago(n.updatedAt)) : "") + "</span>" +
      "</div></div>";
  }

  /* Writes are optimistic — the local copy updates first so the UI never
     stalls on school Wi-Fi — and roll back on failure, because a silent
     failure here means a teacher believes a student was assigned
     something they weren't. Every write carries the class stamp. */
  function saveStudentAssignment(uid){
    var note = $("tANote");
    var lists = checkedLists();

    /* A student who hasn't signed in yet is edited the same way and
       written somewhere else — their roster row, which store.js reads on
       the first sign-in. */
    if(isPending(uid)){
      var em = emailOfPending(uid);
      var wasRow = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
      var rowBody = withStamp({ lists: lists, updatedAt: Date.now() }, uid);
      roster[em] = roster[em] || rosterRowOf(em, {});
      roster[em].lists = lists;
      note.className = "saveNote"; note.textContent = "Saving…";
      db.collection("roster").doc(em).set(rowBody, { merge:true })
        .then(function(){
          note.className = "saveNote ok"; note.textContent = "Saved.";
          render();
        })
        .catch(function(){
          if(wasRow) roster[em] = wasRow; else delete roster[em];
          note.className = "saveNote err";
          note.textContent = rosterReadable
            ? "Didn't save — check the network and try again."
            : "Didn't save — the roster rules aren't published yet (Firebase console → Firestore → Rules).";
        });
      return;
    }

    var before = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
    var body = withStamp({ lists: lists, updatedAt: Date.now() }, uid);
    var a = assignments[uid] || (assignments[uid] = {});
    for(var k in body) a[k] = body[k];

    note.className = "saveNote"; note.textContent = "Saving…";
    db.collection("assignments").doc(uid).set(body, { merge:true })
      .then(function(){
        note.className = "saveNote ok"; note.textContent = "Saved.";
        render();
      })
      .catch(function(){
        if(before) assignments[uid] = before; else delete assignments[uid];
        note.className = "saveNote err"; note.textContent = "Didn't save — check the network and try again.";
      });
  }

  /* ════════════════════════════════════════════════════════════════
     classes

     A class ("P3 Intensive") is a named group with one or more teachers;
     every student is in exactly one. This view is where they are made,
     renamed, shared and emptied: import a roster into one, create one,
     add or remove a co-teacher (from the approved teachers — the admin
     decides who is a teacher on the site), delete one once nobody is in
     it, and move students between the classes you teach. A class decides
     who can see a student; it never decides what the student sees.
     ════════════════════════════════════════════════════════════════ */

  // Everyone in class `id`, archived included — a class with only
  // archived students in it is not empty.
  function membersOf(id){
    return everyone.filter(function(s){ return classIdOf(s) === id; });
  }

  /* Pure: the writes that put these students in class `id`. Four
     documents per signed-in student — roster row (the record), their own
     doc (the admin or a teacher on both classes may change exactly its
     class fields), assignment and note — the last two written even when
     missing, so a moved student always has documents whose stamp the
     rules check. A pending student has no uid yet: their roster row is
     everything. */
  function moveBody(list, id){
    var st = stampFor(id), out = [];
    list.forEach(function(s){
      var email = low(s.email);
      if(email){
        var row = { classId: st.classId, teachers: st.teachers };
        // A signed-in student with no roster row gets one, named, so the
        // move is recorded where class membership is read from.
        if(!roster[email] && s.name) row.name = s.name;
        out.push({ col: "roster", id: email, data: row });
      }
      if(s.pending) return;
      ["students", "assignments", "notes"].forEach(function(col){
        out.push({ col: col, id: s.uid, data: { classId: st.classId, teachers: st.teachers } });
      });
    });
    return out;
  }

  // Writes, then mirrors the move locally.
  function moveStudents(list, id){
    return commitWrites(moveBody(list, id)).then(function(){
      var st = stampFor(id);
      list.forEach(function(s){
        var email = low(s.email);
        if(email){
          if(!roster[email]) roster[email] = rosterRowOf(email, { name: s.name });
          roster[email].classId = st.classId;
          roster[email].teachers = st.teachers.slice();
        }
        s.classId = st.classId;
        if(!s.pending){
          var a = assignments[s.uid] || (assignments[s.uid] = {});
          a.classId = st.classId; a.teachers = st.teachers.slice();
          var n = notes[s.uid] || (notes[s.uid] = {});
          n.classId = st.classId; n.teachers = st.teachers.slice();
        }
      });
      applyArchive(everyone);
    });
  }

  /* Pure: rewrite the teachers copy on every document of class `id`'s
     members, after the class's own teachers have changed. */
  function restampBody(id){
    var st = stampFor(id), out = [];
    membersOf(id).forEach(function(s){
      var email = low(s.email);
      var data = { classId: st.classId, teachers: st.teachers };
      if(email && roster[email]) out.push({ col: "roster", id: email, data: data });
      if(s.pending) return;
      out.push({ col: "students", id: s.uid, data: data });
      if(assignments[s.uid]) out.push({ col: "assignments", id: s.uid, data: data });
      if(notes[s.uid]) out.push({ col: "notes", id: s.uid, data: data });
    });
    // The test student is in no member list, but its assignment carries the same copy.
    if(testStudent && classIdOf(testStudent) === id){
      out.push({ col: "assignments", id: testStudent.uid, data: { classId: st.classId, teachers: st.teachers } });
      if(notes[testStudent.uid]) out.push({ col: "notes", id: testStudent.uid, data: { classId: st.classId, teachers: st.teachers } });
    }
    return out;
  }

  /* A class's co-teachers: the class doc first, then every member doc.
     If the second half is cut off, maintain() finishes it on the next
     load. Never to zero — the rules refuse that too. */
  function setClassTeachers(id, list){
    var c = classes[id];
    if(!c || !list.length) return Promise.reject(new Error("a class needs a teacher"));
    var before = c.teachers.slice();
    return db.collection("classes").doc(id).set({ teachers: list }, { merge:true }).then(function(){
      c.teachers = list.slice();
      return commitWrites(restampBody(id));
    }, function(err){ c.teachers = before; throw err; });
  }

  function createClass(name){
    name = String(name || "").trim();
    var id = newClassId();
    var data = { name: name, teachers: [me], archived: {}, createdAt: Date.now(), createdBy: me };
    return db.collection("classes").doc(id).set(data).then(function(){
      classes[id] = classRowOf(id, data);
      return id;
    });
  }

  function renderGroups(){
    var ids = allClasses();
    var approved = teacherDocs.map(function(t){ return t.email; });
    if(adminEmail() && approved.indexOf(adminEmail()) === -1) approved.unshift(adminEmail());

    var cards = ids.map(function(id){
      var c = classes[id], n = membersOf(id).length, mineToo = admin || teachesClass(id);
      // The test student is in no count, but the class it lives in is not empty to delete.
      var holdsTest = !!(testStudent && classIdOf(testStudent) === id);
      var chips = c.teachers.map(function(t){
        return '<span class="pill">' + esc(teacherName(t)) +
          (mineToo && c.teachers.length > 1
            ? ' <button type="button" class="pkMini" data-unco="' + esc(id) + "|" + esc(t) + '" title="Remove ' + esc(teacherName(t)) + ' from this class">×</button>'
            : "") + "</span>";
      }).join(" ");
      var addable = approved.filter(function(e){ return c.teachers.indexOf(e) === -1; });
      return '<div class="clsCard">' +
        '<div class="clsHead"><b>' + esc(c.name || "Untitled class") + "</b>" +
          '<span class="muted tiny">' + n + (n === 1 ? " student" : " students") +
            (holdsTest ? " · your test student" : "") + "</span></div>" +
        '<div class="clsTeachers">' + chips + "</div>" +
        (mineToo ? '<div class="rowActions">' +
          (addable.length ? '<select class="sel" data-co-pick="' + esc(id) + '" aria-label="Add a co-teacher to ' + esc(c.name) + '">' +
            '<option value="">Add a co-teacher…</option>' + addable.map(function(e){
              return '<option value="' + esc(e) + '">' + esc(teacherName(e)) + "</option>";
            }).join("") + "</select>" : "") +
          '<button type="button" class="btn ghost sm" data-rename="' + esc(id) + '">Rename</button>' +
          (n || holdsTest ? "" : '<button type="button" class="btn ghost sm" data-delclass="' + esc(id) + '">Delete</button>') +
        "</div>" : "") +
      "</div>";
    }).join("");

    var moveRows = students.map(function(s){
      var mineCls = classIdOf(s);
      var opts = placeableClasses();
      if(mineCls && opts.indexOf(mineCls) === -1) opts = [mineCls].concat(opts);
      return "<tr><td>" + whoHtml(s) + "</td>" +
        '<td><select class="sel" data-class-for="' + esc(s.uid) + '" aria-label="Class for ' + esc(s.name || s.email) + '">' +
          classOptions(mineCls, opts, mineCls ? "" : "— no class —") + "</select></td>" +
        '<td class="listsCell">' + listsCellHtml(effectiveLists(s.uid).ids) + "</td></tr>";
    }).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Import a roster</h2>' +
        '<p class="note">Drop or paste whatever your student information system exports, and choose the class. ' +
        "Every student shows up before they ever sign in. Re-importing updates rows and never deletes one.</p>" +
        '<div class="rowActions"><button class="btn sm" id="tImport">📋 Import roster</button>' +
        '<span class="muted tiny">' + (Object.keys(roster).length
          ? Object.keys(roster).length + " on the roster now"
          : "nothing imported yet") + "</span></div>" +
      "</div>" +

      '<div class="panel"><h2>' + (admin ? "Classes" : "Your classes") + "</h2>" +
        '<p class="note">A class is a group of students and the teachers who share them — "P3 Intensive". ' +
        "Everyone on a class sees its students, and any of them can add or remove a co-teacher. " +
        "Who is a teacher on the site is up to the admin. A class decides who sees a student, never what the student sees.</p>" +
        (cards ? '<div class="clsGrid">' + cards + "</div>" : '<div class="empty">No classes yet.</div>') +
        '<div class="rowActions" style="margin-top:14px"><input class="txt" id="tAddClass" placeholder="New class, e.g. P3 Intensive" aria-label="New class name" style="width:240px"> ' +
        '<button class="btn sm" id="tAddClassBtn">Create class</button>' +
        '<span class="saveNote" id="tClassNote"></span></div>' +
      "</div>" +

      (students.length ? '<div class="panel"><h2>Who’s in which class</h2>' +
        '<p class="note">Changes save as soon as you pick. Their games, note and practice go with them.</p>' +
        '<div class="tableScroll"><table class="t"><thead><tr><th>Student</th><th>Class</th><th>Games</th></tr></thead>' +
        "<tbody>" + moveRows + "</tbody></table></div></div>" : "");

    function say(t, err){
      var n = $("tClassNote");
      if(n){ n.className = "saveNote" + (err ? " err" : ""); n.textContent = t; }
    }
    function fail(){ say("Didn't save — check the network and try again.", true); }

    $("tImport").addEventListener("click", openImport);
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-class-for]"), function(sel){
      sel.addEventListener("change", function(){
        var s = studentByUid(sel.dataset.classFor);
        if(!s || !sel.value) return;
        sel.disabled = true;
        moveStudents([s], sel.value).then(function(){ render(); }, function(){ sel.disabled = false; fail(); });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-co-pick]"), function(sel){
      sel.addEventListener("change", function(){
        var id = sel.dataset.coPick, who = sel.value;
        if(!who) return;
        say("Saving…");
        setClassTeachers(id, classes[id].teachers.concat([who])).then(function(){ render(); }, fail);
      });
    });
    $("tBody").querySelector(".panel + .panel").addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-unco],[data-rename],[data-delclass]") : null;
      if(!b) return;
      if(b.hasAttribute("data-unco")){
        var parts = b.getAttribute("data-unco").split("|"), id = parts[0], who = parts[1];
        var left = classes[id].teachers.filter(function(t){ return t !== who; });
        if(!left.length) return;
        if(!window.confirm("Remove " + teacherName(who) + " from " + className(id) + "?" +
          (who === me ? "\n\nYou will stop seeing this class and its students." : ""))) return;
        say("Saving…");
        /* Off the class that holds my test student, I could no longer write
           it (the rules want me on the doc or the class), so it goes first. */
        (who === me && testStudent && classIdOf(testStudent) === id ? dropTestStudent() : Promise.resolve())
        .then(function(){ return setClassTeachers(id, left); }).then(function(){
          return who === me && !admin ? loadAll() : null;
        }).then(function(){ render(); }, fail);
      } else if(b.hasAttribute("data-rename")){
        var rid = b.getAttribute("data-rename");
        var name = window.prompt("New name for " + className(rid) + ":", classes[rid].name);
        if(name == null || !name.trim()) return;
        db.collection("classes").doc(rid).set({ name: name.trim() }, { merge:true }).then(function(){
          classes[rid].name = name.trim(); render();
        }, fail);
      } else {
        var did = b.getAttribute("data-delclass");
        if(membersOf(did).length || (testStudent && classIdOf(testStudent) === did)) return;
        var nSv = Object.keys(classes[did].sequences || {}).length;
        if(!window.confirm("Delete the empty class " + className(did) + "?" +
          (nSv ? "\n\nIts " + nSv + " saved " + (nSv === 1 ? "sequence goes" : "sequences go") + " with it." : ""))) return;
        db.collection("classes").doc(did).delete().then(function(){
          delete classes[did]; render();
        }, fail);
      }
    });
    var addBtn = $("tAddClassBtn");
    if(addBtn) addBtn.addEventListener("click", addClass);
    var addBox = $("tAddClass");
    if(addBox) addBox.addEventListener("keydown", function(e){ if(e.key === "Enter") addClass(); });
  }

  /* Quick add: type an ID (or a few) instead of importing a file. It is
     the import with a one-line source — the same parseRoster checks, the
     same importBody writes — so a typed ID and an imported one end up as
     exactly the same roster row. The one difference: an ID already on the
     roster is skipped, not updated, because a typed ID carries no name
     and a set-merge would blank the name the import put there. */
  var quickNote = { text: "", err: false };

  function quickAddHtml(){
    var ids = placeableClasses();
    return '<div class="rowActions" style="margin-bottom:16px">' +
      '<input class="txt" id="tQuickId" inputmode="numeric" autocomplete="off" ' +
        'placeholder="Add by student ID, e.g. 102345" aria-label="Student ID numbers to add"> ' +
      '<select class="sel" id="tQuickClass" aria-label="Class for the students being added">' +
        (ids.length ? classOptions(ids[0], ids) : '<option value="">a new class (“My class”)</option>') +
      "</select> " +
      '<button class="btn sm" id="tQuickBtn">Add</button>' +
      '<span class="saveNote' + (quickNote.err ? " err" : "") + '" id="tQuickNote">' +
        esc(quickNote.text || "One ID or several, separated by spaces or commas. Each signs in as ID@seq.org.") +
      "</span></div>";
  }

  function wireQuickAdd(){
    $("tQuickBtn").addEventListener("click", quickAdd);
    $("tQuickId").addEventListener("keydown", function(e){ if(e.key === "Enter") quickAdd(); });
    quickNote = { text: "", err: false };
  }

  function quickAdd(){
    var box = $("tQuickId"), note = $("tQuickNote"), btn = $("tQuickBtn");
    var choice = $("tQuickClass").value || "+new";
    var text = (box.value || "").split(/[\s,;]+/).filter(Boolean).join("\n");
    function say(t, err){ note.className = "saveNote" + (err ? " err" : ""); note.textContent = t; }
    if(!text){ say("Type an ID number first.", true); return; }

    var p = GameCore.parseRoster(text);
    var skipped = [];
    var rows = p.rows.filter(function(r){
      if(roster[r.email]){ skipped.push(r.id); return false; }
      return true;
    });
    var bad = p.errors.map(function(e){ return e.message; });
    if(!rows.length){
      say(bad.length ? bad.join(" · ") : "Already on the roster: " + skipped.join(", "), true);
      return;
    }

    btn.disabled = true;
    say("Adding…");
    writeImport(rows, choice, "My class").then(function(taken){
      var added = rows.length - taken.length;
      var msg = (added ? "Added " + added + (added === 1 ? " student" : " students") : "Nobody added") +
        (skipped.length ? " · already on the roster: " + skipped.join(", ") : "") +
        (bad.length ? " · left out: " + bad.join("; ") : "") +
        (taken.length ? " · " + skippedText(taken) : ". Open a student to choose their lists.");
      return loadAll().then(function(){
        quickNote = { text: msg, err: !!taken.length };
        render();   // draws the note once, then wireQuickAdd clears it
      });
    }).catch(function(){
      btn.disabled = false;
      say("Nothing added — check the network and try again.", true);
    });
  }

  function addClass(){
    var v = ($("tAddClass").value || "").trim();
    var note = $("tClassNote");
    if(!v){ note.className = "saveNote err"; note.textContent = "Type a name first."; return; }
    var clash = placeableClasses().filter(function(id){ return low(className(id)) === low(v); })[0];
    if(clash){ note.className = "saveNote"; note.textContent = "You already have a class called that."; return; }
    note.className = "saveNote"; note.textContent = "Saving…";
    createClass(v).then(function(){ render(); }, function(){
      note.className = "saveNote err"; note.textContent = "Didn't save.";
    });
  }

  /* ════════════════════════════════════════════════════════════════
     who is shown, and the class page

     The Students view is one calm row per student: where they are in
     their sequence and how far through the list they are on, with at most
     one line saying what, if anything, needs a teacher. It replaced a
     grid of every student's games and a panel of
     suggestions: a sequence moves a student on by itself, so the question
     a teacher has is no longer "who is ready for List 4?" but "who is
     stuck, and who has nothing?" — and the answer to both is a row.

     Everything here is a pure function of what is already in memory
     (the students, their assignments, the roster) except the one write:
     "Give a sequence to N selected" — one batch, every student's body
     built by giveBody.
     ════════════════════════════════════════════════════════════════ */

  /* The class-wide filter (the top bar's): "" for all, a class id, or
     NO_CLASS. Its key is new: a remembered PERIOD name would never match
     a class id, and would only fall back to All. */
  var filterState = { cls: null };   // null until read from localStorage
  var FILTER_KEY = "ei.class.filter";
  function storedClass(){
    if(filterState.cls === null){
      try{ filterState.cls = window.localStorage.getItem(FILTER_KEY) || ""; }
      catch(e){ filterState.cls = ""; }
    }
    return filterState.cls;
  }
  /* The filter in force. Remembered in localStorage, so it can outlive
     the class it names — a class deleted, or emptied by a move — and a
     filter that matches nobody falls back to All, rather than drawing an
     empty page under a button that says otherwise. */
  function classFilter(){ return effectiveFilter(storedClass(), students); }
  function setClassFilter(c){
    filterState.cls = c;
    try{ window.localStorage.setItem(FILTER_KEY, c); }catch(e){}
  }

  var NO_CLASS = " none";     // a filter value no real class id can collide with

  /* A student's class, if it is one this page knows; otherwise null —
     which is the "No class" bucket. */
  function studentClass(uid){
    var id = classIdOf(studentByUid(uid));
    return id && classes[id] ? id : null;
  }

  // Pure: is this student inside class filter `f`?
  function matchesFilter(s, f){
    if(!f) return true;
    var c = studentClass(s.uid);
    return f === NO_CLASS ? c === null : c === f;
  }
  // Pure: `f`, or All when `f` matches nobody in `list`.
  function effectiveFilter(f, list){
    if(!f) return "";
    for(var i=0;i<list.length;i++) if(matchesFilter(list[i], f)) return f;
    return "";
  }
  // The students inside the filter — the Students table, its cards and
  // Trouble spots.
  function classStudents(){
    var f = classFilter();
    return students.filter(function(s){ return matchesFilter(s, f); });
  }

  /* When a student last moved on to a new list, by their own mark, or 0.
     The mark has to be this plan's (saving a sequence again starts it
     afresh) and has to be a move forward from where the teacher set them:
     "Move on now" changes `at` and leaves no mark. With two sequences, the
     more recent move of the two (each judged by its own mark). */
  function lastMove(s){
    var best = 0;
    plansFor(s.uid).forEach(function(p, k){
      var m = markOf(s, k);
      if(p && m && m.of === p.setAt && m.at > p.at && m.when > best) best = m.when;
    });
    return best;
  }

  /* Pure: the four summary cards. Every count is of students.
     "This week" is a word attempted in the last seven days — the stats'
     own clock, not lastSeen, which store.js stamps on every sign-in
     whether or not anything was played. "Moved to a new list" is the
     student's own mark (lastMove). */
  var WEEK_MS = 7 * 86400000;
  function summaryCounts(list, now){
    var out = { students: list.length, week: 0, moved: 0, none: 0 };
    list.forEach(function(st){
      var sum = Adaptive.summarize(st.stats || {});
      if(sum.lastSeen && now - sum.lastSeen < WEEK_MS) out.week++;
      var mv = lastMove(st);
      if(mv && now - mv < WEEK_MS) out.moved++;
      if(!effectiveLists(st.uid).ids.length) out.none++;
    });
    return out;
  }
  function sumCard(k, v, sub, tone){
    return '<div class="sumCard' + (tone ? " " + tone : "") + '"><div class="k">' + esc(k) + "</div>" +
      '<div class="v">' + v + "</div>" + (sub ? '<div class="s">' + esc(sub) + "</div>" : "") + "</div>";
  }

  /* ---------------- archive ----------------
     Hidden from every view, deleted from nothing. Kept on the CLASS doc
     (classes/{id}.archived), so co-teachers share it. The key is the
     student's id on this page: their uid, or roster:<email> before they
     have signed in — and both are checked, so a student archived while
     pending stays archived once they sign in. */
  function isArchived(st, map){
    map = map || {};
    if(!st) return false;
    if(map[st.uid] === true) return true;
    var em = String(st.email || "").toLowerCase();
    return !!(em && map[PENDING_PREFIX + em] === true);
  }
  // Every class's archive in one map: the keys are per student, so they
  // can't collide.
  function archivedMap(){
    var out = {};
    for(var id in classes){
      var a = classes[id].archived || {};
      for(var k in a) if(Object.prototype.hasOwnProperty.call(a, k) && a[k] === true) out[k] = true;
    }
    return out;
  }
  // Pure: the class split in two.
  function splitArchived(list, map){
    var out = { active: [], archived: [] };
    list.forEach(function(st){ (isArchived(st, map) ? out.archived : out.active).push(st); });
    return out;
  }
  function applyArchive(full){
    everyone = full;
    students = splitArchived(full, archivedMap()).active;
  }
  /* Unarchiving writes false rather than deleting the key: a set-merge
     can't delete without FieldValue, and false means the same thing. */
  function setArchived(st, on){
    var id = classIdOf(st), c = classes[id];
    if(!c) return Promise.reject(new Error("not in a class"));
    var patch = {};
    patch[st.uid] = !!on;
    var em = String(st.email || "").toLowerCase();
    if(!on && em) patch[PENDING_PREFIX + em] = false;
    var before = JSON.parse(JSON.stringify(c.archived || {}));
    c.archived = c.archived || {};
    for(var k in patch) c.archived[k] = patch[k];
    applyArchive(everyone);
    return db.collection("classes").doc(id).set({ archived: patch }, { merge:true }).catch(function(err){
      c.archived = before;
      applyArchive(everyone);
      throw err;
    });
  }

  /* How far through one list a student is. Solid AND at pace: a word a
     student gets right after three seconds of decoding is not one they
     can move on from. `share` is Adaptive.listShare, the same arithmetic
     a sequence's bar is measured with. */
  function listProgress(stats, listId){
    var sum = Adaptive.summarize(Adaptive.statsForList(stats, listId));
    var total = WordLists.wordsOf(listId).length;
    var fluent = Math.max(0, sum.mastered - sum.slow);
    return {
      mastered: sum.mastered,
      slow: sum.slow,
      fluent: fluent,
      total: total,
      // No total means an id that isn't in the registry any more; treat
      // that as "no evidence" rather than as finished.
      share: Adaptive.listShare(stats, listId, listTotal)
    };
  }

  function listTotal(listId){ return WordLists.wordsOf(listId).length; }

  /* ---------------- the flag line ----------------
     At most one sentence per student, under their name, or none.
     Adaptive.nextSteps decides WHAT to say; this assembles what it reads.
     A student in a sequence is judged on the list they are on now, not on
     the ones they have finished — and a student with two sequences on the
     list they are on in each (the first rule that fires, on either, wins);
     they have "finished every list" only when both are finished. A
     student who hasn't signed in has no
     practice to reason about: "hasn't practiced" about somebody who has
     never been here is the table saying the same thing twice. */
  function nextStepInfo(s){
    var ps = present(positionsOf(s.uid));
    var ids = ps.length ? unionIds(ps.map(function(p){ return p.current; })) : effectiveLists(s.uid).ids;
    var lists = ids.map(function(id){
      var l = WordLists.byId(id);
      // A retired list the student still holds is not part of the plan: an
      // untouched one would stop "everything is solid" from ever firing.
      if(!l || l.retired) return null;
      var st = Adaptive.statsForList(s.stats, id);
      var sum = Adaptive.summarize(st);
      var cardsId = WordLists.idFor(l.family, l.listNum, "cards");
      return {
        id: id,
        title: l.listTitle,
        mode: l.mode,
        family: l.family,
        attempts: sum.attempts,
        share: listProgress(s.stats, id).share,
        accuracy: sum.accuracy,
        hasSay: !!WordLists.idFor(l.family, l.listNum, "say"),
        hasMatch: !!WordLists.idFor(l.family, l.listNum, "match"),
        sayId: WordLists.idFor(l.family, l.listNum, "say"),
        matchId: WordLists.idFor(l.family, l.listNum, "match"),
        cardsId: cardsId,
        cardsShare: cardsId ? listProgress(s.stats, cardsId).share : null
      };
    }).filter(Boolean);
    var info = {
      lists: lists,
      lastRound: Adaptive.summarize(s.stats).lastSeen || s.lastSeen || 0,
      now: Date.now()
    };
    if(ps.length) info.plan = { finished: ps.every(function(p){ return p.state.finished; }), movedAt: lastMove(s) };
    return info;
  }
  function flagFor(s){
    if(s.pending) return null;
    return Adaptive.nextSteps(nextStepInfo(s));
  }

  /* ---------------- one row ----------------
     What the Now on / Progress / Place cells say, as data. A student in a
     sequence: the list they are on, a bar toward finishing it with a tick
     at their percent, the count in whole words (the way of playing furthest
     from finished, named when there is more than one), and "List 3 of 6".
     A student with two sequences: { kind: "two", seqs: [those, those] }, one
     per sequence, stacked in the one row, Red Words first, each with its
     `label` ("Red Words", "Other lists"). Without a sequence: today's
     sentence, and "no order". */
  function seqFacts(s, pos){
    var n = pos.plan.steps.length;
    if(pos.state.finished) return { kind: "done", title: "Finished all " + n };
    var step = pos.plan.steps[pos.state.index], far = null;
    step.ids.forEach(function(id){
      var w = wayLine(s.stats, id, pos.plan.bar), left = w.need - w.solid;
      if(!far || left > far.left) far = { w: w, id: id, left: left };
    });
    return {
      kind: "seq", title: stepTitle(step), w: far.w,
      count: far.w.solid + " of " + far.w.total + (step.ids.length > 1 ? " · " + modeTitleOf(far.id) : ""),
      place: "List " + (pos.state.index + 1) + " of " + n + (pos.state.hold ? " · held" : "")
    };
  }
  function rowFacts(s){
    var ps = positionsOf(s.uid);
    if(ps[0] && ps[1]){
      return { kind: "two", seqs: ps.map(function(p, k){
        var f = seqFacts(s, p);
        f.label = SECTION_NAME[k];
        return f;
      }) };
    }
    if(ps[0] || ps[1]) return seqFacts(s, ps[0] || ps[1]);
    var ids = effectiveLists(s.uid).ids;
    if(ids.length) return { kind: "plain", text: WordLists.describeAssignment(ids) };
    return { kind: "none" };
  }

  function avatarHtml(s){
    return safePhoto(s.photo)
      ? '<img src="' + esc(s.photo) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="init">' + esc((s.name || s.email || "?")[0].toUpperCase()) + "</span>";
  }

  var picked = {};            // uid → true: the rows ticked on the Students view
  var focusRow = null;        // the student whose row gets focus when the Students view is drawn next
  function studentRowHtml(s){
    var cid = studentClass(s.uid), flag = flagFor(s), f = rowFacts(s), n = stuName(s);
    var hasNote = !s.pending && noteSummary(s.uid);
    var who = '<div class="who">' + avatarHtml(s) + '<div style="min-width:0"><div class="nm">' + esc(n) +
      (hasNote ? ' <span class="noteDot" title="' + esc(noteOf(s.uid)) + '">✎</span>' : "") +
      ' <span class="muted tiny stCls">' + (cid ? esc(className(cid)) : "no class") + "</span></div>" +
      (flag ? '<div class="stFlag" data-rule="' + esc(flag.rule) + '">' + esc(flag.text) + "</div>" : "") +
      "</div></div>";
    var tick = '<td class="stTick"><input type="checkbox" data-pick="' + esc(s.uid) + '" aria-label="Select ' + esc(n) + '"' +
      (picked[s.uid] ? " checked" : "") + "></td>";
    var open = ' tabindex="0" data-uid="' + esc(s.uid) + '"';
    // A student on the roster who hasn't signed in yet is a real row with
    // nothing in it. Greyed rather than hidden: on day one the useful
    // thing this table can tell a teacher is who is MISSING.
    if(s.pending){
      return '<tr class="clickable pending"' + open + ">" + tick + "<td>" + who + "</td>" +
        '<td class="muted tiny" colspan="3">on the roster — hasn’t signed in yet</td></tr>';
    }
    var nowOn, prog, place;
    if(f.kind === "two"){
      // One part per sequence, stacked: the same three things, twice.
      var parts = f.seqs.map(function(x){
        // The label sits over the list's name; the other two columns keep a blank line in its place, so the parts line up.
        var lab = '<span class="stWhich">' + esc(x.label) + "</span>", pad = '<span class="stWhich" aria-hidden="true">&nbsp;</span>';
        if(x.kind === "done") return { now: lab + '<span class="pill good">' + esc(x.title) + "</span>", prog: pad + '<span class="muted">—</span>', place: pad + '<span class="muted">—</span>' };
        return { now: lab + "<b>" + esc(x.title) + "</b>",
                 prog: pad + '<div class="stProg">' + seqMeter(x.w) + '<span class="stCount">' + esc(x.count) + "</span></div>",
                 place: pad + esc(x.place) };
      });
      var col = function(key){ return parts.map(function(p){ return '<div class="stPart">' + p[key] + "</div>"; }).join(""); };
      nowOn = col("now"); prog = col("prog"); place = col("place");
    } else if(f.kind === "seq"){
      nowOn = "<b>" + esc(f.title) + "</b>";
      prog = '<div class="stProg">' + seqMeter(f.w) + '<span class="stCount">' + esc(f.count) + "</span></div>";
      place = esc(f.place);
    } else if(f.kind === "done"){
      nowOn = '<span class="pill good">' + esc(f.title) + "</span>";
      prog = place = '<span class="muted">—</span>';
    } else if(f.kind === "plain"){
      nowOn = esc(f.text);
      prog = '<span class="muted">—</span>';
      place = '<span class="pill">no order</span>';
    } else {
      nowOn = '<span class="pill warn">No lists yet</span>';
      prog = place = '<span class="muted">—</span>';
    }
    return '<tr class="clickable"' + open + ">" + tick + "<td>" + who + "</td>" +
      '<td class="stNow">' + nowOn + "</td><td>" + prog + '</td><td class="stPlace">' + place + "</td></tr>";
  }

  /* ---------------- the Students view ---------------- */
  function renderRoster(){
    if(!students.length){
      $("tBody").innerHTML = '<div class="panel"><h2>Get started</h2>' +
        '<ol class="steps">' +
          "<li><b>Import your roster</b> under Classes. Your students show up here before they ever sign in.</li>" +
          "<li><b>Give each student their lists</b> from their page, in order. A student sees only what you give them.</li>" +
          "<li><b>Students sign in</b> with their school account — their ID number @seq.org.</li>" +
        "</ol>" +
        '<div class="rowActions"><button class="btn sm" id="tGoGroups">Import a roster →</button></div>' +
        '<p class="note" style="margin:16px 0 6px">Or add students one at a time:</p>' + quickAddHtml() + "</div>" +
        testPanelHtml();
      $("tGoGroups").addEventListener("click", function(){ switchView("groups"); });
      wireQuickAdd();
      wireTestPanel();
      return;
    }
    var shown = classStudents();
    var backTo = focusRow; focusRow = null;
    // A tick on a student who is no longer shown (the filter moved) is forgotten.
    var shownUid = {}; shown.forEach(function(s){ shownUid[s.uid] = true; });
    Object.keys(picked).forEach(function(u){ if(!shownUid[u]) delete picked[u]; });
    var nPick = shown.filter(function(s){ return picked[s.uid]; }).length;
    var waiting = shown.filter(function(s){ return s.pending; }).length;
    var bare = shown.filter(function(s){ return !effectiveLists(s.uid).ids.length; });
    var cards = summaryCounts(shown, Date.now());

    $("tBody").innerHTML =
      '<div class="sumCards">' +
        sumCard("Students", cards.students, classFilter() ? "in this class" : (admin ? "on the site" : "in your classes")) +
        sumCard("Practiced this week", cards.week, "a round in the last 7 days") +
        sumCard("Moved to a new list this week", cards.moved, "by finishing one") +
        sumCard("No lists yet", cards.none, "home page is empty", cards.none ? "warn" : "") +
      "</div>" +
      (bare.length ? '<div class="panel callout"><p><b>' + bare.length +
        (bare.length === 1 ? " student has" : " students have") + " no lists yet.</b> " +
        "They see an empty home page until you give them some.</p>" +
        '<button class="btn sm" id="stSelBare">Select them</button></div>' : "") +

      '<div class="panel"><h2>Students</h2>' +
      (waiting ? '<p class="note"><b>' + waiting + (waiting === 1 ? " student on the roster hasn’t" : " students on the roster haven’t") +
        ' signed in yet</b> — greyed out below. You can give them lists now; ' +
        "they'll be waiting the first time they sign in.</p>" : "") +
      '<p class="note">Click a student for their lists, their numbers and their note. ' +
      "Tick several to give them a sequence together.</p>" +
      '<div class="rowActions stActions">' +
        '<button class="btn sm" id="stGive"' + (nPick ? "" : " disabled") + ">Give a sequence to " + nPick + " selected…</button>" +
        '<button class="btn ghost sm" id="stClear"' + (nPick ? "" : " hidden") + ">Clear selection</button>" +
        '<span class="saveNote ok" id="stNote" role="status" aria-live="polite" tabindex="-1"></span>' +
      "</div>" +
      '<div class="tableScroll"><table class="t stTable"><thead><tr>' +
      '<th class="stTick"><input type="checkbox" id="stSelAll" aria-label="Select everyone shown"' +
        (shown.length && nPick === shown.length ? " checked" : "") + "></th>" +
      "<th>Student</th><th>Now on</th><th>Progress</th><th>Place</th>" +
      "</tr></thead><tbody>" + shown.map(studentRowHtml).join("") + "</tbody></table></div>" +
      /* Under the rows, not above them: adding a student by ID and the two
         downloads are things a teacher does now and then, and the table is
         what the page is for. */
      '<div class="stFoot">' +
        '<p class="note" style="margin:22px 0 6px">Add a student by ID number:</p>' + quickAddHtml() +
        '<div class="rowActions" style="margin-top:14px">' +
          '<button class="btn ghost sm" id="tExportRoster">⬇ Roster CSV</button>' +
          '<button class="btn ghost sm" id="tExportWords">⬇ Every word CSV</button>' +
          '<span class="muted tiny">One row per student, and one row per word they\'ve attempted. ' +
          "Opens in Excel, Sheets or Numbers.</span>" +
        "</div>" +
      "</div></div>" +
      testPanelHtml();

    function open(tr){ detailUid = tr.dataset.uid; render(); }
    Array.prototype.forEach.call(document.querySelectorAll("#tBody tr.clickable"), function(tr){
      tr.addEventListener("click", function(e){
        // A tick is not a way in.
        if(e.target.closest && e.target.closest("input,label,button")) return;
        open(tr);
      });
      // A row is a way in, so it has to be one from the keyboard too.
      tr.addEventListener("keydown", function(e){
        if(e.target !== tr || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        open(tr);
      });
    });
    // Ticking updates the button and the heading tick in place: redrawing
    // the table would take focus off the box being pressed.
    function syncPicks(){
      var n = shown.filter(function(s){ return picked[s.uid]; }).length;
      var give = $("stGive"), clear = $("stClear"), all = $("stSelAll");
      give.disabled = !n;
      give.textContent = "Give a sequence to " + n + " selected…";
      clear.hidden = !n;
      all.checked = !!shown.length && n === shown.length;
      all.indeterminate = n > 0 && n < shown.length;
      Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-pick]"), function(cb){ cb.checked = !!picked[cb.dataset.pick]; });
    }
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-pick]"), function(cb){
      cb.addEventListener("change", function(){
        if(cb.checked) picked[cb.dataset.pick] = true; else delete picked[cb.dataset.pick];
        syncPicks();
      });
    });
    $("stSelAll").addEventListener("change", function(){
      var on = this.checked;
      shown.forEach(function(s){ if(on) picked[s.uid] = true; else delete picked[s.uid]; });
      syncPicks();
    });
    // (The button is disabled once nothing is ticked, and a disabled button
    // cannot take focus, so focus goes to the heading tick instead.)
    $("stClear").addEventListener("click", function(){ picked = {}; syncPicks(); $("stSelAll").focus(); });
    if($("stSelBare")) $("stSelBare").addEventListener("click", function(){
      bare.forEach(function(s){ picked[s.uid] = true; });
      syncPicks();
      $("stGive").focus();
    });
    $("stGive").addEventListener("click", function(){ openGive(shown.filter(function(s){ return picked[s.uid]; })); });
    syncPicks();
    wireQuickAdd();
    wireTestPanel();
    $("tExportRoster").addEventListener("click", function(){ download(exportName("roster"), rosterCsv()); });
    $("tExportWords").addEventListener("click", function(){ download(exportName("words"), wordsCsv()); });
    // Back from a student's page: put focus on the row they came from, not on nothing.
    if(backTo){
      var row = document.querySelector('#tBody tr.clickable[data-uid="' + cssq(backTo) + '"]');
      if(row) row.focus();
    }
  }

  /* ---------------- giving a sequence to several students ----------------
     Tick rows (the heading tick takes everyone shown), choose a ready-made
     sequence or another student's, choose the percent, and it lands on
     every one of them in ONE batch: either the whole class is moved or
     none of it is, and a failure puts every local copy back as it was.

     Each student's plan starts at 0 with no hold, so each lands on the first
     list they have not already finished (planState, from their own stats);
     `lists` is that list's ids. A student already solid on the first two
     lands on the third; one who has never practiced lands on the first. */
  /* The order goes where it belongs: its red lists become the student's
     Red Words sequence, the rest their Other lists sequence, each REPLACING
     what they had of that kind; a kind the order does not hold is written
     back exactly as stored, so its mark keeps counting. A saved order that
     holds both kinds is split the same way. Games given with no order are
     replaced. */
  function givePlan(s, steps, bar, now){
    var plan = { steps: steps.map(function(st){ return { ids: WordLists.withSay(st.ids) }; }), bar: bar, at: 0, hold: false, setAt: now };
    var st = Adaptive.planState(plan, s.stats, listTotal, null);
    var at = Math.max(0, Math.min(st ? st.index : 0, steps.length - 1));
    return { plan: plan, lists: plan.steps[at].ids.slice() };
  }
  // An order's steps of one kind ("red" or "other").
  function stepsOfKind(steps, kind){
    return steps.filter(function(st){ return stepKind(st.ids) === kind; });
  }
  function giveBody(s, steps, bar, now){
    return seqBody(s.uid, KINDS.map(function(kind, k){
      var mine = stepsOfKind(steps, kind);
      return mine.length ? givePlan(s, mine, bar, now) : storedEntry(s.uid, k);
    }), now);
  }
  /* What the dialog warns about, in counts of students: who already has a
     Red Words sequence that this replaces (only when the order holds red
     lists), who has an Other lists sequence that this replaces (only when it
     holds other lists), who has games in no order (always replaced), and who
     has a sequence of a kind the order does not hold (kept). */
  function giveCounts(list, steps){
    var hasRed = stepsOfKind(steps, "red").length > 0, hasOther = stepsOfKind(steps, "other").length > 0;
    var out = { red: 0, other: 0, games: 0, keptRed: 0, keptOther: 0 };
    list.forEach(function(s){
      var ps = plansFor(s.uid);
      if(!ps[0] && !ps[1]){ if(effectiveLists(s.uid).ids.length > 0) out.games++; return; }
      if(ps[0]){ if(hasRed) out.red++; else out.keptRed++; }
      if(ps[1]){ if(hasOther) out.other++; else out.keptOther++; }
    });
    return out;
  }
  // How many of these students already have games or a sequence.
  function replacedCount(list){
    return list.filter(function(s){ return present(plansFor(s.uid)).length > 0 || effectiveLists(s.uid).ids.length > 0; }).length;
  }
  /* ---------------- saved sequences ----------------
     A sequence a teacher keeps for a class, to use again: { name, steps,
     bar } under classes/{id}.sequences.<key>. Using one COPIES it — a
     student is never linked to it, so renaming or deleting it later
     changes nobody. */
  function newSeqKey(){ return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function savedBody(name, steps, bar, now){
    return { name: String(name).trim().slice(0, SAVED_NAME_MAX), steps: steps.map(function(st){ return { ids: WordLists.withSay(st.ids) }; }), bar: bar, createdAt: now };
  }
  // Every saved sequence in every class this teacher sees (all classes, for the admin).
  function savedSequences(){
    var out = [];
    allClasses().forEach(function(cid){
      var seqs = classes[cid].sequences || {};
      Object.keys(seqs).sort(function(a, b){
        return seqs[a].name.localeCompare(seqs[b].name, undefined, { numeric: true, sensitivity: "base" });
      }).forEach(function(k){
        out.push({ id: cid + "/" + k, classId: cid, key: k, className: className(cid),
                   name: seqs[k].name, steps: cloneSteps(seqs[k].steps), bar: seqs[k].bar, createdAt: seqs[k].createdAt });
      });
    });
    return out;
  }
  // "10 lists: Red Words · List 1, … Red Words · List 10 — Say it · Cards, finished at 90%"
  function sequencePreview(steps, bar){
    var titles = steps.map(stepTitle);
    var ways = {}; steps.forEach(function(st){ ways[stepWays(st)] = true; });
    var wl = Object.keys(ways);
    return titles.length + (titles.length === 1 ? " list: " : " lists: ") +
      (titles.length > 4 ? titles.slice(0, 3).join(", ") + " … " + titles[titles.length - 1] : titles.join(", ")) +
      (wl.length === 1 ? " — " + wl[0] : "") + (bar != null ? ", finished at " + Math.round(bar * 100) + "%" : "") + ".";
  }
  /* What a teacher can start from: the ready-made ones, then what has been
     saved in each class, then (for the several-students dialog) each
     student's Red Words and Other lists. In a student's editor `kind` names
     the section: only its ready-made one is offered ("Red Words, Lists 1 to
     10" in Red Words, "Sounding it out" in Other lists); saved orders are all
     offered, and only their steps of that kind are used. */
  function sequenceSources(withStudents, kind){
    var out = READY_MADE.filter(function(r){ return !kind || r.kind === kind; }).map(function(r){
      return { key: "rm:" + r.key, label: r.title, steps: readyMadeSteps(r.key), bar: Adaptive.defaultBar, group: "Ready-made" };
    });
    savedSequences().forEach(function(x){
      out.push({ key: "sv:" + x.id, label: x.name, steps: x.steps, bar: x.bar, group: "Saved in " + x.className, saved: true });
    });
    if(withStudents){
      students.forEach(function(x){
        plansFor(x.uid).forEach(function(p, k){
          if(!p) return;
          out.push({ key: (k ? "st2:" : "st:") + x.uid, label: stuName(x) + "’s " + SECTION_NAME[k],
                     steps: cloneSteps(p.steps), bar: p.bar, group: "Copy a student’s" });
        });
      });
    }
    return out;
  }
  function giveSources(){ return sequenceSources(true); }
  // <optgroup>s of <option>s for a list of sources.
  function sourceOptionsHtml(sources){
    var groups = {}, order = [];
    sources.forEach(function(x){ if(!groups[x.group]){ groups[x.group] = []; order.push(x.group); } groups[x.group].push(x); });
    return order.map(function(g){
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function(x){
        return '<option value="' + esc(x.key) + '">' + esc(x.label) + "</option>";
      }).join("") + "</optgroup>";
    }).join("");
  }

  // Writes: a merge onto the class document. Optimistic, put back on failure.
  function classSeqWrite(cid, patch){
    return db.collection("classes").doc(cid).set({ sequences: patch }, { merge: true });
  }
  function saveSequenceFor(uid, name, which){
    var cid = studentClass(uid), d = draftFor(uid, which), nm = String(name || "").trim();
    if(!cid) return Promise.reject(new Error("no class"));
    if(!d || !d.steps.length) return Promise.reject(new Error("no steps"));
    if(!nm) return Promise.reject(new Error("no name"));
    var c = classes[cid]; c.sequences = c.sequences || {};
    if(Object.keys(c.sequences).length >= SAVED_MAX) return Promise.reject(new Error("full"));
    var key = newSeqKey(), body = savedBody(nm, d.steps, d.bar, Date.now()), patch = {};
    patch[key] = body;
    c.sequences[key] = cleanSaved(patch)[key];
    return classSeqWrite(cid, patch).then(function(){ return { classId: cid, key: key }; }, function(err){
      delete c.sequences[key]; throw err;
    });
  }
  function renameSaved(cid, key, name){
    var c = classes[cid], nm = String(name || "").trim().slice(0, SAVED_NAME_MAX);
    if(!c || !c.sequences || !c.sequences[key] || !nm) return Promise.reject(new Error("nothing to rename"));
    var before = c.sequences[key].name, e = c.sequences[key], patch = {};
    c.sequences[key].name = nm;
    /* The whole entry, not just its name: if a co-teacher deleted it since
       this page loaded, a merge of {name} alone would leave a stub with no
       steps — invisible, undeletable, and uncounted. Written whole, it simply
       comes back as what the teacher was looking at. */
    patch[key] = { name: nm, steps: cloneSteps(e.steps), bar: e.bar, createdAt: e.createdAt };
    return classSeqWrite(cid, patch).then(null, function(err){ c.sequences[key].name = before; throw err; });
  }
  function deleteSaved(cid, key){
    var c = classes[cid];
    if(!c || !c.sequences || !c.sequences[key]) return Promise.reject(new Error("nothing to delete"));
    var before = c.sequences[key], patch = {};
    delete c.sequences[key];
    patch[key] = firebase.firestore.FieldValue.delete();
    return classSeqWrite(cid, patch).then(null, function(err){ c.sequences[key] = before; throw err; });
  }

  /* ---------------- the Saved sequences view ---------------- */
  var svEditing = null;     // "classId/key" while one is being renamed
  function renderSequences(){
    var list = savedSequences(), byClass = {}, order = [];
    list.forEach(function(x){ if(!byClass[x.classId]){ byClass[x.classId] = []; order.push(x.classId); } byClass[x.classId].push(x); });
    var cards = order.map(function(cid){
      return '<h3 class="svClass">' + esc(className(cid)) + "</h3>" + byClass[cid].map(function(x){
        var editing = svEditing === x.id;
        return '<div class="svCard" data-sv="' + esc(x.id) + '">' +
          (editing
            ? '<div class="svRename"><label class="muted tiny" for="svName">Name</label>' +
              '<input class="txt" id="svName" maxlength="' + SAVED_NAME_MAX + '" value="' + esc(x.name) + '">' +
              '<button type="button" class="btn sm" data-svsave="' + esc(x.id) + '">Save</button>' +
              '<button type="button" class="btn ghost sm" data-svcancel="1">Cancel</button></div>'
            : '<div class="svHead"><b class="svName">' + esc(x.name) + '</b><span class="pill">' + esc(x.className) + "</span></div>") +
          '<p class="svSteps">' + esc(sequencePreview(x.steps, x.bar)) + "</p>" +
          (editing ? "" :
            '<div class="rowActions"><button type="button" class="btn ghost sm" data-svren="' + esc(x.id) + '" aria-label="Rename ' + esc(x.name) + '">Rename</button>' +
            '<button type="button" class="btn ghost sm" data-svdel="' + esc(x.id) + '" aria-label="Delete ' + esc(x.name) + '">Delete</button></div>') +
          "</div>";
      }).join("");
    }).join("");
    $("tBody").innerHTML = '<div class="panel"><h2>Saved sequences</h2>' +
      '<p class="note">A sequence you keep for a class, to use again. Every teacher on the class sees it. ' +
      "Using one copies it onto a student: students are not linked to it, so renaming or deleting it later changes nobody.</p>" +
      '<p class="saveNote ok" id="svNote" role="status" aria-live="polite" tabindex="-1"></p>' +
      (cards || '<div class="empty">No saved sequences yet. On a student’s page, press <b>Save this sequence</b> to keep one for the whole class.</div>') +
      "</div>";
    function note(text, err){
      var n = $("svNote"); if(!n) return;
      n.className = "saveNote " + (err ? "err" : "ok"); n.textContent = text;
    }
    function find(id){ return list.filter(function(x){ return x.id === id; })[0]; }
    function failed(){ note("Didn’t save — check the network and try again.", true); }
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-svren]"), function(b){
      b.addEventListener("click", function(){ svEditing = b.getAttribute("data-svren"); renderSequences(); var i = $("svName"); if(i){ i.focus(); i.select(); } });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-svcancel]"), function(b){
      b.addEventListener("click", function(){ var id = svEditing; svEditing = null; renderSequences(); var r = id && document.querySelector('[data-svren="' + cssq(id) + '"]'); if(r) r.focus(); });
    });
    function saveEdit(id){
      var x = find(id), nm = ($("svName") || {}).value;
      if(!x) return;
      if(!String(nm || "").trim()){ note("Give it a name.", true); return; }
      renameSaved(x.classId, x.key, nm).then(function(){
        svEditing = null; renderSequences();
        var r = document.querySelector('[data-svren="' + cssq(id) + '"]'); if(r) r.focus();
        note("Renamed.");
      }, failed);
    }
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-svsave]"), function(b){
      b.addEventListener("click", function(){ saveEdit(b.getAttribute("data-svsave")); });
    });
    var inp = $("svName");
    if(inp) inp.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ e.preventDefault(); saveEdit(svEditing); }
      else if(e.key === "Escape"){ e.preventDefault(); document.querySelector("[data-svcancel]").click(); }
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-svdel]"), function(b){
      b.addEventListener("click", function(){
        var x = find(b.getAttribute("data-svdel"));
        if(!x) return;
        if(!window.confirm("Delete “" + x.name + "” from " + x.className + "?\n\nStudents who were given it keep their lists: deleting changes no student.")) return;
        deleteSaved(x.classId, x.key).then(function(){
          renderSequences();
          note("Deleted “" + x.name + "”.");
          var n = $("svNote"); if(n) n.focus();
        }, failed);
      });
    });
  }

  var giveWrap = null;
  var GIVE_MAX = 400;   // commitWrites' chunk: past it a batch is no longer ONE batch
  /* Close the dialog. `restore` puts focus back on the page behind it (for
     Escape, a click outside, Cancel); a redraw closes it without, since the
     page is being rebuilt anyway. */
  function closeGive(restore){
    var had = !!giveWrap;
    if(giveWrap && giveWrap.parentNode) giveWrap.parentNode.removeChild(giveWrap);
    giveWrap = null;
    if(had && restore){
      var b = $("stGive"), t = (b && !b.disabled) ? b : $("stSelAll");
      if(t && t.focus) t.focus();
    }
  }
  function openGive(list){
    if(!list.length) return;
    closeGive();
    var sources = giveSources(), cur = sources[0], bar = cur.bar;
    giveWrap = document.createElement("div");
    giveWrap.className = "abModal";
    giveWrap.innerHTML =
      '<div class="abModalBox" role="dialog" aria-modal="true" aria-labelledby="giveTitle">' +
        '<h2 id="giveTitle">Give a sequence to ' + list.length + (list.length === 1 ? " student" : " students") + "</h2>" +
        '<p class="note">Red Words lists go into each student’s Red Words sequence. Other lists go into their Other lists sequence. ' +
        "Each student starts on the first list they haven’t already finished. Nothing changes until you press Give it.</p>" +
        '<div class="giveRow"><label class="muted tiny" for="giveSrc">Which sequence</label>' +
        '<select class="sel" id="giveSrc"></select></div>' +
        '<div class="seqBar">A list is finished when ' +
          '<button type="button" class="btn ghost sm seqIcon" id="giveLess" aria-label="Lower the percent">−</button>' +
          '<b class="seqPct" id="givePct"></b>' +
          '<button type="button" class="btn ghost sm seqIcon" id="giveMore" aria-label="Raise the percent">+</button>' +
          " of its words are solid.</div>" +
        '<p class="muted" id="givePreview"></p>' +
        '<p class="giveReplace" id="giveReplace" hidden></p>' +
        '<div class="rowActions stickyActions"><button class="btn sm" id="giveGo">Give it</button>' +
          '<button class="btn ghost sm" id="giveCancel">Cancel</button>' +
          '<span class="saveNote' + (list.length > GIVE_MAX ? " err" : "") + '" id="giveNote" role="status">' +
            (list.length > GIVE_MAX ? "That is more than one batch can hold. Choose " + GIVE_MAX + " students or fewer." : "") + "</span></div>" +
      "</div>";
    document.body.appendChild(giveWrap);

    var sel = $("giveSrc");
    sel.innerHTML = sourceOptionsHtml(sources);
    var counts = null;
    function paint(){
      counts = giveCounts(list, cur.steps);
      $("givePct").textContent = Math.round(bar * 100) + "%";
      $("giveLess").disabled = bar <= 0.5; $("giveMore").disabled = bar >= 1;
      $("givePreview").textContent = sequencePreview(cur.steps);
      var warn = giveWarning(counts, list.length), w = $("giveReplace");
      w.textContent = warn; w.hidden = !warn;
      $("giveGo").disabled = !cur.steps.length || list.length > GIVE_MAX;
    }
    sel.addEventListener("change", function(){
      cur = sources.filter(function(x){ return x.key === sel.value; })[0] || cur;
      bar = cur.bar; paint();
    });
    $("giveLess").addEventListener("click", function(){ bar = Math.max(0.5, Math.round(bar * 100 - 5) / 100); paint(); $("giveLess").disabled ? $("giveMore").focus() : $("giveLess").focus(); });
    $("giveMore").addEventListener("click", function(){ bar = Math.min(1, Math.round(bar * 100 + 5) / 100); paint(); $("giveMore").disabled ? $("giveLess").focus() : $("giveMore").focus(); });
    $("giveCancel").addEventListener("click", function(){ closeGive(true); });
    giveWrap.addEventListener("mousedown", function(e){ if(e.target === giveWrap) closeGive(true); });
    // aria-modal means focus stays in the dialog: Tab wraps at either end.
    giveWrap.addEventListener("keydown", function(e){
      if(e.key !== "Tab") return;
      var f = Array.prototype.filter.call(giveWrap.querySelectorAll("button, select, input"), function(el){ return !el.disabled && el.offsetParent !== null; });
      if(!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    });
    $("giveGo").addEventListener("click", function(){
      var msg = giveConfirm(cur.label, counts, list.length);
      if(msg && !window.confirm(msg)) return;
      var note = $("giveNote");
      note.className = "saveNote"; note.textContent = "Saving…";
      $("giveGo").disabled = true;
      giveSequence(list.map(function(s){ return s.uid; }), cur.steps, bar).then(function(r){
        var n = r ? r.given : list.length;
        picked = {};
        closeGive();
        render();
        var flash = $("stNote");
        if(flash){
          flash.textContent = "Gave a sequence to " + n + (n === 1 ? " student." : " students.");
          flash.focus();     // the message, so it is read out and focus is not lost with the dialog
        }
      }, function(){
        $("giveGo").disabled = false;
        note.className = "saveNote err";
        note.textContent = "Nothing saved — check the network and try again.";
      });
    });
    paint();
    sel.focus();
  }
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ closeGive(true); closePreviewPop(); }
  });

  /* One batch for every student: local state moves first (the page redraws
     without waiting on school Wi-Fi) and `undo` puts every copy back if the
     batch fails, so nobody is left half-moved. */
  function giveSequence(uids, steps, bar){
    // Past one batch it would no longer be all-or-nothing, so refuse.
    if(uids.length > GIVE_MAX) return Promise.reject(new Error("too many"));
    var now = Date.now(), items = [];
    uids.forEach(function(uid){
      var data = giveBody(studentByUid(uid), steps, bar, now);
      if(data) items.push({ uid: uid, data: data });
    });
    var done = { given: items.length };
    if(!items.length) return Promise.resolve(done);
    return commitBodies(items).then(function(){ return done; });
  }
  /* The dialog's warning, or "": what this replaces and what it leaves, in
     counts of students, one short sentence each. */
  function giveWarning(c, n){
    var of = function(k, has, have){ return k + " of these " + n + (n === 1 ? " student " : " students ") + (k === 1 ? has : have); };
    var out = [];
    if(c.red) out.push(of(c.red, "already has", "already have") + " a Red Words sequence. This replaces " + (c.red === 1 ? "it." : "them."));
    if(c.other) out.push(of(c.other, "already has", "already have") + " an Other lists sequence. This replaces " + (c.other === 1 ? "it." : "them."));
    if(c.games) out.push(of(c.games, "has", "have") + " games in no order. This replaces them.");
    // The kind it does not hold: kept as it is.
    [["Red Words lists", "Red Words", c.keptRed], ["other lists", "Other lists", c.keptOther]].forEach(function(w){
      if(w[2]) out.push("It has no " + w[0] + ": " + w[2] + " of them " + (w[2] === 1 ? "keeps their " : "keep their ") + w[1] + " sequence as it is.");
    });
    return out.join(" ");
  }
  // The confirm before Give it, or "" when nothing they have is replaced.
  function giveConfirm(label, c, n){
    if(!c.red && !c.other && !c.games) return "";
    return "Give " + label + " to " + n + (n === 1 ? " student" : " students") + "?\n\n" + giveWarning(c, n);
  }

  /* diagnose()'s seven kinds, in the words a teacher would write in a
     plan. Not the student's words — the student sees "Check the vowel"
     mid-game; this is the row of a table somebody reads on a Sunday. */
  var KIND_TEXT = {
    blend:     "blend read wrong",
    sound:     "target sound missed",
    vowel:     "wrong vowel",
    consonant: "wrong consonant",
    missing:   "dropped a sound",
    extra:     "added a sound",
    other:     "read too fast to tell"
  };
  function kindText(k){ return KIND_TEXT[k] || k; }

  /* ---------------- trouble spots ---------------- */

  /* The transcript the most students produced for one word, or null.
     Ties break alphabetically so the table doesn't reshuffle itself
     between renders on the same data. */
  function modeHeard(counts){
    var best = null, bestN = 0;
    for(var k in counts){
      if(!Object.prototype.hasOwnProperty.call(counts, k)) continue;
      if(counts[k] > bestN || (counts[k] === bestN && best !== null && k < best)){ best = k; bestN = counts[k]; }
    }
    return best === null ? null : { text: best, n: bestN };
  }
  var MIN_SAMPLE = 3;   // a word nobody has really attempted isn't a trouble spot

  /* One row per PATTERN rather than per word. Thirty words all going
     wrong on the same vowel team is one problem with one lesson behind
     it, and a list of thirty words is the shape that hides that. Pure
     over a set of students, so tests.html can pin the counting. */
  function patternRows(pool){
    var byPattern = {};
    pool.forEach(function(s){
      var shakyHere = {};
      for(var key in s.stats){
        if(!Object.prototype.hasOwnProperty.call(s.stats, key)) continue;
        var st = s.stats[key];
        if(!st.n) continue;
        var parsed = Adaptive.parseKey(key);
        var pat = WordLists.patternOf(parsed.listId);
        if(!pat) continue;
        var row = byPattern[pat] || (byPattern[pat] = { pattern: pat, words: 0, attempts: 0, right: 0, shaky: 0, students: {}, kinds: {} });
        row.words++; row.attempts += st.n; row.right += st.r;
        row.students[s.uid] = true;
        // A student counts once per pattern however many of its words
        // they are struggling with — the question is how many PEOPLE.
        if(st.w > 0 && st.r / st.n < 0.7 && !shakyHere[pat]){ shakyHere[pat] = true; row.shaky++; }
        for(var kk in st.k){
          if(!Object.prototype.hasOwnProperty.call(st.k, kk)) continue;
          row.kinds[kk] = (row.kinds[kk] || 0) + st.k[kk];
        }
      }
    });
    return Object.keys(byPattern).map(function(p){
      var r = byPattern[p];
      return {
        pattern: r.pattern,
        words: r.words,
        attempts: r.attempts,
        accuracy: r.attempts ? r.right / r.attempts : null,
        shaky: r.shaky,
        students: Object.keys(r.students).length,
        top: Adaptive.topKind(r.kinds)
      };
    }).sort(function(a, b){
      if(a.shaky !== b.shaky) return b.shaky - a.shaky;
      return (a.accuracy || 0) - (b.accuracy || 0);
    });
  }

  function renderTrouble(){
    var pool = classStudents();

    // Aggregate the same stat keys across the class: attempts, first-try
    // rights, and how many DIFFERENT students are getting it wrong — the
    // last one is what separates "one student is stuck" from "reteach
    // this to the room".
    var agg = {};
    pool.forEach(function(s){
      for(var key in s.stats){
        if(!Object.prototype.hasOwnProperty.call(s.stats, key)) continue;
        var st = s.stats[key];
        if(!st.n) continue;
        var a = agg[key] || (agg[key] = { n:0, r:0, students:0, missers:0, heard:{} });
        a.n += st.n; a.r += st.r; a.students += 1;
        if(st.w > 0 && st.r / st.n < 0.7) a.missers += 1;
        // One vote per student per transcript, not one per utterance: the
        // question is "what does the ROOM say", and a single student who
        // repeats themselves five times isn't the room.
        var h = (s.heard || {})[key] || [];
        for(var i=0;i<h.length;i++) a.heard[h[i]] = (a.heard[h[i]] || 0) + 1;
      }
    });


    var rows = Object.keys(agg).map(function(key){
      var a = agg[key], parsed = Adaptive.parseKey(key);
      return { key:key, word:parsed.word, listId:parsed.listId, acc:a.r/a.n, n:a.n, students:a.students, missers:a.missers, heard:modeHeard(a.heard) };
    }).filter(function(r){
      // Enough attempts to mean anything, and at least one student
      // actually struggling — a word the class has nailed is not a
      // trouble spot, however many times it's been practiced.
      return r.n >= MIN_SAMPLE && r.missers > 0;
    });

    rows.sort(function(x, y){
      if(x.missers !== y.missers) return y.missers - x.missers;
      if(x.acc !== y.acc) return x.acc - y.acc;
      return y.n - x.n;
    });

    var chips = rows.slice(0, 60).map(function(r){
      var l = WordLists.byId(r.listId);
      var pct = Math.round(r.acc * 100);
      var cls = pct >= 80 ? "" : pct >= 60 ? "warn" : "bad";
      return '<div class="wordchip ' + cls + '">' + esc(r.word) +
        "<small>" + pct + "% · " + r.missers + " of " + r.students + " struggling · " + esc(l ? l.title : r.listId) + "</small>" +
        (r.heard ? '<small class="heardline">most often heard as: ' + esc(r.heard.text) + "</small>" : "") +
        "</div>";
    }).join("");

    var patterns = patternRows(pool).map(function(r){
      return "<tr><td><b>" + esc(r.pattern) + '</b> <span class="muted tiny">' + r.words + " words</span></td>" +
        '<td class="num">' + r.students + "</td>" +
        '<td class="num">' + (r.shaky ? '<span class="pill bad">' + r.shaky + "</span>" : '<span class="muted">0</span>') + "</td>" +
        '<td class="num">' + accCell(r.accuracy) + "</td>" +
        "<td>" + (r.top ? esc(kindText(r.top.kind)) + ' <span class="muted tiny">(' + r.top.n + ")</span>"
                        : '<span class="muted">—</span>') + "</td></tr>";
    }).join("");


    $("tBody").innerHTML =
      '<div class="panel"><h2>Trouble spots</h2>' +
        '<p class="note">Words the class is getting wrong, hardest first — sorted by how many students are struggling with each, ' +
        "not by raw accuracy, so one student's bad day doesn't top the list. " +
        "Words with fewer than " + MIN_SAMPLE + " attempts across the group are left out. " +
        "Where Say It logged what the mic heard, the most common mishearing is under the word.</p>" +
        (chips ? '<div class="wordchips">' + chips + "</div>"
               : '<div class="empty">Nothing to show yet — students need a few rounds of practice first.</div>') +
      "</div>" +

      (patterns ? '<div class="panel"><h2>By pattern</h2>' +
        '<p class="note">The same practice, grouped by what each list is teaching. Thirty words going wrong on ' +
        "one vowel team is one problem with one lesson behind it, and a list of thirty words is the shape that " +
        'hides that. “Shaky” counts <b>students</b>, not words. The commonest error comes from Say It, which is ' +
        "the only mode that hears what was actually said.</p>" +
        '<div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>Pattern</th><th class="num">Students</th><th class="num">Shaky</th>' +
        '<th class="num">Accuracy</th><th>Most common error</th>' +
        "</tr></thead><tbody>" + patterns + "</tbody></table></div></div>" : "");

  }

  /* ════════════════════════════════════════════════════════════════
     manage

     One page, one section at a time behind a row of tabs: Archived,
     Backup, and — for the admin only, and absent entirely for anyone
     else — Teachers. A real tablist: arrows, Home and End move between
     tabs, and the open one is remembered in localStorage.
     ════════════════════════════════════════════════════════════════ */
  var MANAGE_KEY = "ei.manage.section";
  var MANAGE_TITLE = { archived: "Archived", backup: "Backup", teachers: "Teachers" };
  // Pure: which sections this account gets, in order.
  function manageSections(isAdmin){
    return ["archived", "backup"].concat(isAdmin ? ["teachers"] : []);
  }
  function currentSection(){
    var list = manageSections(admin);
    if(manageSection === null){
      try{ manageSection = window.localStorage.getItem(MANAGE_KEY) || ""; }catch(e){ manageSection = ""; }
    }
    if(list.indexOf(manageSection) === -1) manageSection = list[0];
    return manageSection;
  }
  function setSection(k){
    manageSection = k;
    try{ window.localStorage.setItem(MANAGE_KEY, k); }catch(e){}
  }

  function renderManage(){
    var list = manageSections(admin), cur = currentSection();
    $("tBody").innerHTML =
      '<div class="mTabs" role="tablist" aria-label="Manage">' + list.map(function(k){
        var on = k === cur;
        return '<button type="button" role="tab" id="mtab-' + k + '" data-section="' + k + '"' +
          ' aria-selected="' + on + '" aria-controls="mPanel" tabindex="' + (on ? "0" : "-1") + '">' +
          esc(MANAGE_TITLE[k]) + "</button>";
      }).join("") + "</div>" +
      '<div id="mPanel" role="tabpanel" aria-labelledby="mtab-' + cur + '"></div>';

    var tabs = $("tBody").querySelector(".mTabs");
    tabs.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-section]") : null;
      if(!b || b.dataset.section === cur) return;
      setSection(b.dataset.section);
      renderManage();
      var t = $("mtab-" + b.dataset.section);
      if(t) t.focus();
    });
    tabs.addEventListener("keydown", function(e){
      var i = list.indexOf(cur), j = null;
      if(e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % list.length;
      else if(e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + list.length) % list.length;
      else if(e.key === "Home") j = 0;
      else if(e.key === "End") j = list.length - 1;
      if(j === null) return;
      e.preventDefault();
      setSection(list[j]);
      renderManage();
      var t = $("mtab-" + list[j]);
      if(t) t.focus();
    });

    var panel = $("mPanel");
    if(cur === "archived") return renderArchivedSection(panel);
    if(cur === "backup") return renderBackupSection(panel);
    if(cur === "teachers") return renderTeachers(panel);
  }

  function renderArchivedSection(into){
    var gone = splitArchived(everyone, archivedMap()).archived;
    var rows = gone.map(function(st){
      var per = studentClass(st.uid);
      return "<tr><td>" + whoHtml(st) + "</td>" +
        "<td>" + (per ? '<span class="pill">' + esc(className(per)) + "</span>" : '<span class="muted tiny">\u2014</span>') + "</td>" +
        '<td><button class="btn ghost sm" data-unarchive="' + esc(st.uid) + '">Unarchive</button> ' +
        '<button class="btn ghost sm" data-open="' + esc(st.uid) + '">Open</button></td></tr>';
    }).join("");
    into.innerHTML = '<div class="panel"><h2>Archived</h2>' +
      '<p class="note">Archived students are hidden from every view — the table, the cards, Trouble spots. ' +
      "Nothing about them is deleted, and they keep practicing whatever they were given. " +
      "Archiving is shared by everyone who teaches the class. Archive a student from their own page.</p>" +
      (rows ? '<div class="tableScroll"><table class="t"><thead><tr><th>Student</th><th>Class</th><th></th></tr></thead>' +
              "<tbody>" + rows + "</tbody></table></div>"
            : '<div class="empty">Nobody is archived.</div>') +
      '<span class="saveNote" id="mArchNote"></span></div>';
    into.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-unarchive],[data-open]") : null;
      if(!b) return;
      var st = studentByUid(b.getAttribute("data-unarchive") || b.getAttribute("data-open"));
      if(!st) return;
      if(b.hasAttribute("data-open")){ view = "roster"; detailUid = st.uid; render(); return; }
      b.disabled = true;
      setArchived(st, false).then(function(){ render(); }, function(){
        b.disabled = false;
        var n = $("mArchNote");
        if(n){ n.className = "saveNote err"; n.textContent = "Didn't save \u2014 check the network and try again."; }
      });
    });
  }

  /* ---------------- backup ----------------
     One JSON file of everything this account can read, straight from the
     database rather than from the page (which has sanitized and folded
     it): the roster rows, assignments, notes, students' docs and class
     docs of every class this teacher is on, and the list of teachers;
     for the admin, every collection. For keeping, not for
     restoring — there is no import, deliberately: a restore is a
     decision, made in the console, by a person. */
  function backupName(now){
    return "english-intensive-backup-" + isoDay(now) + ".json";
  }
  // Pure: the file's contents from plain maps of documents.
  function backupJson(data, now){
    return JSON.stringify({
      app: "english-intensive",
      exportedAt: new Date(now).toISOString(),
      exportedBy: me,
      scope: admin ? "everything (admin)" : "this teacher's classes",
      collections: data
    }, null, 2);
  }
  function fetchBackup(){
    function docs(q){
      return q.get().then(function(snap){
        var out = {};
        snap.forEach(function(d){ out[d.id] = d.data(); });
        return out;
      });
    }
    function one(ref){
      return ref.get().then(function(d){ var o = {}; if(d.exists) o[d.id] = d.data(); return o; });
    }
    var cols = ["students", "assignments", "notes", "roster"];
    var jobs = cols.map(function(c){ return docs(mine(c)); });
    jobs.push(docs(mine("classes")));
    jobs.push(docs(db.collection("teachers")).catch(function(){ return {}; }));
    if(admin) jobs.push(one(db.collection("config").doc("class")).catch(function(){ return {}; }));
    return Promise.all(jobs).then(function(r){
      var out = {};
      cols.forEach(function(c, i){ out[c] = r[i]; });
      out.classes = r[4];
      out.teachers = r[5];
      if(admin) out.config = r[6];
      return out;
    });
  }
  function renderBackupSection(into){
    into.innerHTML = '<div class="panel"><h2>Backup</h2>' +
      '<p class="note">One file of everything ' + (admin ? "in the database — every class" : "about your classes") +
      ": the roster, every student\u2019s practice record, their games, the notes and the classes. " +
      "Keep it somewhere safe. It is for keeping; the site has no way to load one back.</p>" +
      '<div class="rowActions"><button class="btn sm" id="mBackup">\u2b07 Download backup</button>' +
      '<span class="saveNote" id="mBackupNote"></span></div></div>';
    $("mBackup").addEventListener("click", function(){
      var btn = this, note = $("mBackupNote");
      btn.disabled = true;
      note.className = "saveNote"; note.textContent = "Reading everything\u2026";
      fetchBackup().then(function(data){
        var now = Date.now();
        var ok = download(backupName(now), backupJson(data, now), "json");
        note.className = "saveNote" + (ok ? " ok" : " err");
        note.textContent = ok ? "Downloaded." : "Your browser didn't take the file.";
      }, function(){
        note.className = "saveNote err"; note.textContent = "Couldn't read the database \u2014 check the network and try again.";
      }).then(function(){ btn.disabled = false; });
    });
  }

  /* ════════════════════════════════════════════════════════════════
     teachers (admin only)

     Who is a teacher on the SITE, and which classes each one is on.
     Adding a teacher is one teachers/{email} document; it lets them sign
     in to the dashboard, where they see nothing until they create a class
     or someone puts them on one. Removing one deletes that document —
     which alone ends their access — and takes them off every class. It is
     refused while they are the only teacher on a class: add someone else
     to it, or move its students, first.
     ════════════════════════════════════════════════════════════════ */

  // Pure: the classes `email` teaches.
  function teacherClasses(email){
    email = low(email);
    return allClasses().filter(function(id){ return classes[id].teachers.indexOf(email) !== -1; });
  }
  // Pure: of those, the ones they teach alone — what blocks removing them.
  function soleClasses(email){
    return teacherClasses(email).filter(function(id){ return classes[id].teachers.length === 1; });
  }

  function renderTeachers(into){
    if(!admin) return;
    var adminAddr = adminEmail() || me;
    var list = [adminAddr];
    teacherDocs.forEach(function(t){ if(list.indexOf(t.email) === -1) list.push(t.email); });
    var listed = {};
    teacherDocs.forEach(function(t){ listed[t.email] = true; });

    var rows = list.map(function(e){
      var t = teacherDocs.filter(function(x){ return x.email === e; })[0];
      var isAdminRow = e === adminAddr;
      var cls = teacherClasses(e);
      var n = 0;
      cls.forEach(function(id){ n += membersOf(id).length; });
      return "<tr><td><b>" + esc(t && t.name ? t.name : e) + "</b>" +
          '<div class="muted tiny">' + esc(e) + (isAdminRow ? " · admin" : "") + "</div></td>" +
        "<td>" + (cls.length ? cls.map(function(id){ return '<span class="pill">' + esc(className(id)) + "</span>"; }).join(" ")
                             : '<span class="muted tiny">no classes</span>') + "</td>" +
        '<td class="num">' + n + "</td>" +
        "<td>" + (isAdminRow || !listed[e] ? "" :
          '<button class="btn ghost sm" data-unteach="' + esc(e) + '">Remove</button>') + "</td></tr>";
    }).join("");

    into.innerHTML =
      '<div class="panel"><h2>Teachers</h2>' +
        '<p class="note">Who can use this dashboard. A teacher sees the students in the classes they are on, ' +
        "and any teacher on a class can add these teachers to it. You see every class.</p>" +
        '<div class="tableScroll"><table class="t"><thead><tr><th>Teacher</th><th>Classes</th><th class="num">Students</th><th></th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table></div>" +
        '<span class="saveNote" id="tTeachListNote"></span>' +
      "</div>" +

      '<div class="panel"><h2>Add a teacher</h2>' +
        '<p class="note">Their school Google account. They can open the dashboard the next time they sign in. ' +
        "They start with no classes: they create one, import a roster into it, or get added to one.</p>" +
        '<div class="rowActions">' +
          '<input class="txt" id="tTeachEmail" placeholder="name@seq.org" aria-label="Teacher email" autocomplete="off" style="width:220px">' +
          '<input class="txt" id="tTeachName" placeholder="Name, e.g. Ms. Rivera" aria-label="Teacher name" autocomplete="off" style="width:220px">' +
          '<button class="btn sm" id="tTeachAdd">Add teacher</button>' +
          '<span class="saveNote" id="tTeachNote"></span>' +
        "</div>" +
      "</div>";

    $("tTeachAdd").addEventListener("click", addTeacher);
    $("tTeachName").addEventListener("keydown", function(e){ if(e.key === "Enter") addTeacher(); });
    Array.prototype.forEach.call(into.querySelectorAll("[data-unteach]"), function(b){
      b.addEventListener("click", function(){ removeTeacher(b.getAttribute("data-unteach")); });
    });
  }

  var TEACHER_EMAIL_RE = /^[^@\s]+@seq\.org$/i;
  function addTeacher(){
    var email = ($("tTeachEmail").value || "").trim().toLowerCase();
    var name = ($("tTeachName").value || "").trim();
    var note = $("tTeachNote");
    if(!TEACHER_EMAIL_RE.test(email)){ note.className = "saveNote err"; note.textContent = "Use their @seq.org address."; return; }
    if(email === (adminEmail() || me) || teacherDocs.some(function(t){ return t.email === email; })){
      note.className = "saveNote"; note.textContent = "Already a teacher."; return;
    }
    var doc = { email: email, name: name, addedAt: Date.now(), addedBy: me };
    note.className = "saveNote"; note.textContent = "Adding…";
    db.collection("teachers").doc(email).set(doc).then(function(){
      teacherDocs.push(doc);
      render();
      var n2 = $("tTeachNote");
      if(n2){ n2.className = "saveNote ok"; n2.textContent = "Added " + (name || email) + "."; }
    }, function(){
      note.className = "saveNote err"; note.textContent = "Didn't add — check the network and try again.";
    });
  }

  function removeTeacher(email){
    var note = $("tTeachListNote");
    var alone = soleClasses(email);
    if(alone.length){
      note.className = "saveNote err";
      note.textContent = teacherName(email) + " is the only teacher on " +
        alone.map(className).join(", ") + ". Add another teacher to " + (alone.length === 1 ? "it" : "them") +
        ", or move the students, first.";
      return;
    }
    var cls = teacherClasses(email);
    if(!window.confirm("Remove " + teacherName(email) + " as a teacher?\n\n" +
      "They lose the dashboard" + (cls.length ? " and come off " + cls.length + (cls.length === 1 ? " class" : " classes") : "") +
      ". No student, class or practice is deleted.")) return;
    note.className = "saveNote"; note.textContent = "Removing…";
    // The teachers/ doc first: deleting it is what actually ends their
    // access (isTeacher() in the rules). Then off each class.
    db.collection("teachers").doc(email).delete().then(function(){
      teacherDocs = teacherDocs.filter(function(t){ return t.email !== email; });
      return cls.reduce(function(chain, id){
        return chain.then(function(){
          return setClassTeachers(id, classes[id].teachers.filter(function(t){ return t !== email; }));
        });
      }, Promise.resolve());
    }).then(function(){ render(); }, function(){
      note.className = "saveNote err"; note.textContent = "Didn't finish — check the network and try again.";
    });
  }

  /* ── the testing seam ─────────────────────────────────────────────
     The class page's rules — what a student has, which list they are on,
     what a row says, the shape of the writes a sequence makes — are pure
     functions of a class's state, and they are the parts that would
     quietly ruin a roster if they were wrong. So they're reachable from
     tests.html, the same way each engine exposes its pure helpers.
     `feed` is the only way in: it stands in for loadAll(), which is the
     one thing here that needs Firestore. */
  window.EITeacher = {
    _internals: {
      modeHeard: modeHeard,
      importBody: importBody,
      classifyProbe: classifyProbe,
      importPlan: importPlan,
      skippedText: skippedText,
      migrationBody: migrationBody,
      healBody: healBody,
      moveBody: moveBody,
      restampBody: restampBody,
      classIdOf: classIdOf,
      teacherClasses: teacherClasses,
      soleClasses: soleClasses,
      importTargets: importTargets,
      nameMatchesPeriod: nameMatchesPeriod,
      DELETE: DELETE,
      effectiveFilter: effectiveFilter,
      matchesFilter: matchesFilter,
      classStudents: classStudents,
      classFilter: classFilter,
      filterSegments: filterSegments,
      summaryCounts: summaryCounts,
      isArchived: isArchived,
      splitArchived: splitArchived,
      manageSections: manageSections,
      backupName: backupName,
      backupJson: backupJson,
      previewHref: previewHref,
      renderRoster: renderRoster,
      renderGroups: renderGroups,
      renderManage: renderManage,
      nextStepInfo: nextStepInfo,
      rosterStatus: rosterStatus,
      rosterRowOf: rosterRowOf,
      studentByUid: studentByUid,
      buildTestStudent: buildTestStudent, resetBody: resetBody, testPanelHtml: testPanelHtml,
      testStripHtml: testStripHtml, wireTestPanel: wireTestPanel, addTestStudent: addTestStudent,
      resetTestStudent: resetTestStudent, removeTestStudent: removeTestStudent, dropTestStudent: dropTestStudent,
      getTestStudent: function(){ return testStudent; },
      isPending: isPending,
      studentUids: function(){ return students.map(function(s){ return s.uid; }); },
      patternRows: patternRows,
      kindText: kindText,
      feed: function(st){
        st = st || {};
        students = st.students || [];
        assignments = st.assignments || {};
        classes = {};
        var cl = st.classes || {};
        for(var cid in cl) classes[cid] = classRowOf(cid, cl[cid]);
        notes = st.notes || {};
        roster = st.roster || {};
        rosterReadable = st.rosterReadable !== false;
        me = String(st.me || "t@seq.org").toLowerCase();
        meUid = st.meUid || "";
        meEmail = st.meEmail || "";
        testStudent = st.testStudent || null;
        admin = !!st.admin;
        teacherDocs = st.teachers || [];
        probe = st.probe || {};
        // Same fold the real load does, so a test sees the class the way
        // the dashboard does: signed-in students and roster rows together.
        if(st.roster) addPendingStudents();
        applyArchive(students);
        picked = {};
        filterState.cls = st.filter || "";      // set directly: no localStorage in tests
      },
      effectiveLists: effectiveLists,
      noteOf: noteOf,
      studentClass: studentClass,
      csvCell: csvCell,
      csvRows: csvRows,
      sparkline: sparkline,
      rosterCsv: rosterCsv,
      wordsCsv: wordsCsv,
      exportName: exportName,
      noteSummary: noteSummary,
      NOTE_MAX: NOTE_MAX,
      listProgress: listProgress,
      NO_CLASS: NO_CLASS,
      pickerHtml: pickerHtml,
      scopeSelection: scopeSelection,
      bindPickers: bindPickers,
      // the class page
      lastMove: lastMove, flagFor: flagFor, rowFacts: rowFacts, studentRowHtml: studentRowHtml,
      giveBody: giveBody, giveSequence: giveSequence, replacedCount: replacedCount, giveSources: giveSources,
      giveCounts: giveCounts, giveWarning: giveWarning, giveConfirm: giveConfirm,
      openGive: openGive, closeGive: closeGive, commitBodies: commitBodies,
      cleanSaved: cleanSaved, savedSequences: savedSequences, sequenceSources: sequenceSources,
      sequencePreview: sequencePreview, savedBody: savedBody, saveSequenceFor: saveSequenceFor,
      renameSaved: renameSaved, deleteSaved: deleteSaved, renderSequences: renderSequences,
      SAVED_MAX: SAVED_MAX,
      getPicked: function(){ return picked; },
      // sequences
      planFor: planFor, plansFor: plansFor, positionOf: positionOf, positionsOf: positionsOf,
      draftFromSaved: draftFromSaved, emptyDraft: emptyDraft, saveBody: saveBody, holdsText: holdsText,
      copyChoices: copyChoices, ensureDraft: ensureDraft, draftFor: draftFor,
      seqBody: seqBody, SECTION_NAME: SECTION_NAME,
      draftIndex: draftIndex, draftMove: draftMove, draftRemove: draftRemove, draftWays: draftWays,
      draftAdd: draftAdd, draftBar: draftBar, draftMoveOn: draftMoveOn, draftGoBack: draftGoBack,
      draftReplaceLater: draftReplaceLater, addsAny: addsAny, stepsFromIds: stepsFromIds, readyMadeSteps: readyMadeSteps,
      defaultAddIds: defaultAddIds, waysEditorHtml: waysEditorHtml, SAY_WHY: SAY_WHY,
      READY_MADE: READY_MADE, planBody: planBody, stopBody: stopBody, wayLine: wayLine, stuLine: stuLine,
      stepTitle: stepTitle, stepWays: stepWays, openText: openText, givePlan: givePlan, seqPanelHtml: seqPanelHtml, seqDirty: seqDirty,
      leaveDraftOk: leaveDraftOk,
      renderDetail: renderDetail, seqAct: seqAct, commitStudentBody: commitStudentBody,
      switchView: switchView, render: render,
      getDraft: function(){ return drafts[0]; },
      getDraft2: function(){ return drafts[1]; },
      reset: function(){ drafts = [null, null]; seqSaving = false; resetSeqUI(); detailTab = "lists"; lastDetailUid = null; detailUid = null; view = "roster"; picked = {}; closeGive(); svEditing = null; nameBusy = false; },
      open: function(uid){ view = "roster"; detailUid = uid; },
      setDb: function(d){ db = d; }
    }
  };

})();
