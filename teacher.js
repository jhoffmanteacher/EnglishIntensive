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

   ── Whose students ────────────────────────────────────────────────────
   Every teacher sees only their own students: every list query below
   carries where('teacher','==',me), because firestore.rules only allows
   a list it can prove from the query. The admin's queries don't, and
   the admin alone has Manage → Teachers and the "move" controls. Every
   document this page writes carries `teacher` — the student's owner,
   which for anyone but the admin is always the signed-in teacher.

   ── The layout ────────────────────────────────────────────────────────
   A console: a grouped sidebar on the left, a slim top bar (title, the
   class-wide period filter, Refresh, Student view), and one view at a
   time underneath. The sidebar's groups:
     Students   Students — the roster, four summary cards, and each
                student's page: worst words, list by list, their games.
                Trouble spots — the same words aggregated across the
                class: what to teach tomorrow.
     Assign     Assign board — every student's games as one grid, one
                batched Save at the bottom.
     Set up     Periods — importing the roster, and who is in which
                period. Periods only group students on this page; they
                never decide what anybody sees.
                Manage — Archived, Backup, and (admin only) Teachers, one
                section at a time behind a row of tabs.

   The period filter in the top bar is the class's, not a view's: the
   Students table, the board and Trouble spots all follow it, it is
   remembered in localStorage, and one that matches nobody (a period that
   has since emptied) falls back to All rather than showing a blank page.

   An ARCHIVED student is hidden from every view and deleted from
   nothing: classes/{me}.archived holds their key. `students` is the
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
   Every place a set of lists is chosen for one student — their own page,
   the board's bulk dialog — uses one component, pickerHtml(). It is one
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
   What gets saved is a flat array of list ids — the picker and the board
   are presentation only; store.js and the rules never see the grid.

   ── Why assignments live in their own collection ──────────────────────
   The teacher has READ on students/{uid} and no write, deliberately: the
   dashboard never needs to modify a student's work, and withholding write
   means a compromised teacher session can't erase the class. Everything
   the teacher DOES set — period, assigned lists — is therefore in
   assignments/{uid}, which the student can only read.
   ════════════════════════════════════════════════════════════════════ */

(function(){
  "use strict";

  var db = null;
  var students = [];          // [{uid, name, email, photo, words, totals, recent, lastSeen}]
  var assignments = {};       // uid → { period, lists }
  var notes = {};             // uid → { text, updatedAt } — teacher-only
  var roster = {};            // email → { name, id, period, lists, importedAt }
  var rosterReadable = false; // false until the roster rules are published
  var classCfg = { periods:[] };   // classes/{me}: this teacher's named periods
  var me = "";                // the signed-in address, lowercased
  var admin = false;          // EIAuth.isAdmin(), read once at boot
  var teacherDocs = [];       // admin only: teachers/{email} docs, [{email, name, addedAt, addedBy}]
  var migrated = false;       // the admin's one-time migration has run this visit
  var view = "roster";
  var everyone = [];          // `students` plus the archived — see applyArchive
  var manageSection = null;   // Manage's open section; null until read from localStorage
  var detailUid = null;

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

  /* Every address known to be a teacher: the admin, the signed-in
     teacher, and (for the admin, who can read them) every teachers/ doc.
     Teachers play the games too (store.js writes students/{their uid}),
     so without this filter they show up in the admin's loadAll as
     students with "no games yet". */
  function knownTeachers(){
    var out = {};
    adminEmails().forEach(function(e){ out[e] = true; });
    if(me) out[me] = true;
    teacherDocs.forEach(function(t){ if(t.email) out[String(t.email).toLowerCase()] = true; });
    return out;
  }

  /* Who a student belongs to. The roster row is the record of that — it
     is what an import writes and what store.js copies — so it wins over
     the student's own doc; with neither, they're the signed-in
     teacher's, which is the only answer a write from this page could
     use anyway. Lowercased throughout, because it is compared with a
     lowercased token in firestore.rules. */
  function ownerOf(s){
    var r = rosterFor(s);
    var t = (r && r.teacher) || (s && s.teacher) || me;
    return String(t || "").toLowerCase();
  }
  function ownerOfUid(uid){ return ownerOf(studentByUid(uid)); }

  // A teacher's display name, for the admin's views.
  function teacherName(email){
    email = String(email || "").toLowerCase();
    for(var i=0;i<teacherDocs.length;i++){
      if(teacherDocs[i].email === email) return teacherDocs[i].name || email;
    }
    return email;
  }

  function classRef(){ return db.collection("classes").doc(me); }

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
    return admin ? db.collection(col) : db.collection(col).where("teacher", "==", me);
  }

  function loadAll(){
    return EIAuth.db().then(function(d){
      db = d;
      if(!db) throw new Error("no db");
      return Promise.all([
        mine("students").get(),
        mine("assignments").get(),
        // Missing until this teacher names a period; refused only if the
        // rules in the console predate classes/. Neither is fatal.
        db.collection("classes").doc(me).get().catch(function(){ return null; }),
        // Teacher-only, by firestore.rules. A student reading this
        // collection gets nothing, which is the point of it existing
        // separately from assignments/{uid} — see the rules file.
        mine("notes").get(),
        /* Its own catch. Every other collection failing means the
           dashboard is broken; this one failing means the roster rules
           have not been published yet, which is a state the site is
           designed to survive — see firestore.rules. */
        mine("roster").get().catch(function(){ return null; }),
        admin ? db.collection("teachers").get().catch(function(){ return null; }) : null,
        // The old shared periods doc, read only to migrate it.
        admin ? db.collection("config").doc("class").get().catch(function(){ return null; }) : null
      ]);
    }).then(function(snaps){
      teacherDocs = [];
      if(snaps[5]) snaps[5].forEach(function(doc){
        var t = doc.data() || {};
        teacherDocs.push({ email: String(doc.id).toLowerCase(), name: t.name || "", addedAt: t.addedAt || 0, addedBy: t.addedBy || "" });
      });
      teacherDocs.sort(function(a, b){ return (a.name || a.email).toLowerCase() < (b.name || b.email).toLowerCase() ? -1 : 1; });
      // Everything the migration needs, as plain data — see migrationBody.
      var raw = { students: [], assignments: {}, notes: {}, roster: {},
                  classesExists: !!(snaps[2] && snaps[2].exists),
                  configPeriods: (snaps[6] && snaps[6].exists && Array.isArray((snaps[6].data() || {}).periods))
                    ? snaps[6].data().periods : [] };
      students = [];
      var teachers = knownTeachers();
      snaps[0].forEach(function(doc){
        var d = doc.data() || {};
        raw.students.push({ id: doc.id, email: d.email || "", teacher: d.teacher || "" });
        if(d.email && teachers[String(d.email).toLowerCase()]) return;
        students.push({
          uid: doc.id,
          name: d.name || "",
          email: d.email || "",
          photo: d.photo || "",
          teacher: d.teacher ? String(d.teacher).toLowerCase() : "",
          stats: Adaptive.sanitizeStats(d.words),
          heard: Adaptive.sanitizeHeard(d.heard),
          fluency: Adaptive.sanitizeFluency(d.fluency),
          totals: d.totals || { n:0, r:0 },
          recent: Array.isArray(d.recent) ? d.recent : [],
          lastSeen: d.lastSeen || 0
        });
      });
      assignments = {};
      snaps[1].forEach(function(doc){
        assignments[doc.id] = doc.data() || {};
        raw.assignments[doc.id] = assignments[doc.id].teacher || "";
      });
      notes = {};
      snaps[3].forEach(function(doc){
        notes[doc.id] = doc.data() || {};
        raw.notes[doc.id] = notes[doc.id].teacher || "";
      });
      roster = {};
      rosterReadable = !!snaps[4];
      if(snaps[4]) snaps[4].forEach(function(doc){
        roster[String(doc.id).toLowerCase()] = rosterRowOf(doc.id, doc.data() || {});
        raw.roster[String(doc.id).toLowerCase()] = (doc.data() || {}).teacher || "";
      });
      var c = (snaps[2] && snaps[2].exists) ? (snaps[2].data() || {}) : {};
      classCfg = { periods: Array.isArray(c.periods) ? c.periods : [],
                   archived: (c.archived && typeof c.archived === "object") ? c.archived : {} };
      addPendingStudents();
      // Sort by display name, falling back to the email local part — an
      // account with no display name shouldn't sink to the bottom.
      students.sort(function(a,b){
        var an = (a.name || a.email).toLowerCase(), bn = (b.name || b.email).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
      applyArchive(students);
      return raw;
    }).then(migrate);
  }

  /* ---------------- the admin's migration ----------------
     Before there were several teachers nothing carried a `teacher`
     field, and one shared config/class held the periods. The first time
     the admin opens the dashboard after the change, every document
     without an owner is given one, and the old periods are copied into
     the admin's own classes/ doc. It runs on every admin load and does
     nothing once there is nothing to do, so it needs no flag in the
     database and is safe to interrupt.

     It also puts back in step anything that has drifted: a student's
     own doc follows their roster row (that is what store.js does on
     their next sign-in anyway), and their assignment and note follow
     their own doc. Pure — data in, a list of writes out — so tests.html
     can pin it without a Firestore. */
  function migrationBody(raw, adminAddr, teachers){
    adminAddr = String(adminAddr || "").toLowerCase();
    teachers = teachers || {};
    var out = [];
    var low = function(x){ return String(x || "").toLowerCase(); };
    var rosterOwner = {};
    Object.keys(raw.roster || {}).forEach(function(email){
      var t = low(raw.roster[email]);
      if(!t){ t = adminAddr; out.push({ col: "roster", id: email, data: { teacher: t } }); }
      rosterOwner[email] = t;
    });
    var studentOwner = {};
    (raw.students || []).forEach(function(st){
      var email = low(st.email);
      // A teacher's own practice record is nobody's student.
      if(email && teachers[email]) return;
      var want = rosterOwner[email] || low(st.teacher) || adminAddr;
      if(low(st.teacher) !== want) out.push({ col: "students", id: st.id, data: { teacher: want } });
      studentOwner[st.id] = want;
    });
    ["assignments", "notes"].forEach(function(col){
      var map = raw[col] || {};
      Object.keys(map).forEach(function(id){
        var want = studentOwner[id] || low(map[id]) || adminAddr;
        if(low(map[id]) !== want) out.push({ col: col, id: id, data: { teacher: want } });
      });
    });
    if(!raw.classesExists && (raw.configPeriods || []).length){
      out.push({ col: "classes", id: adminAddr, data: { periods: raw.configPeriods.slice() } });
    }
    return out;
  }

  /* Firestore caps a batch at 500 writes; 400 leaves headroom. Every
     write here is a set-merge, so a chunk that lands twice is harmless. */
  function commitWrites(writes){
    var chunks = [], i;
    for(i=0;i<writes.length;i+=400) chunks.push(writes.slice(i, i+400));
    return chunks.reduce(function(chain, chunk){
      return chain.then(function(){
        var batch = db.batch();
        chunk.forEach(function(w){
          batch.set(db.collection(w.col).doc(w.id), w.data, { merge:true });
        });
        return batch.commit();
      });
    }, Promise.resolve());
  }

  function migrate(raw){
    if(!admin || migrated) return;
    migrated = true;
    var writes = migrationBody(raw, me, knownTeachers());
    if(!writes.length) return;
    // A failed migration is not a failed dashboard: the admin still sees
    // everything, and the next load tries again.
    return commitWrites(writes).then(function(){ return loadAll(); }, function(e){
      if(window.console) console.warn("Migration didn't finish; it will retry next load.", e);
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
     page, the Assign board, both exports — then shows the class as it
     actually is, with the ones who haven't arrived greyed out, and none
     of them had to learn about a second kind of student. What they do
     have to know is that a pending student's assignment is written to
     their roster row instead of to assignments/{uid}; there is no uid to
     write one against yet. */
  // One stored roster document as the dashboard holds it.
  function rosterRowOf(id, d){
    d = d || {};
    return {
      email: String(id).toLowerCase(),
      name: d.name || "",
      id: d.id || "",
      period: d.period == null ? "" : String(d.period),
      lists: Array.isArray(d.lists) ? d.lists : null,
      importedAt: d.importedAt || 0,
      teacher: d.teacher ? String(d.teacher).toLowerCase() : ""
    };
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
     One teacher per student, and an import never takes a student from
     another teacher. Before anything is written, every address that
     isn't already on this teacher's roster is looked up on its own.
     firestore.rules answers a teacher's get of somebody else's row with
     permission-denied — that refusal IS the answer — and the admin, who
     can read every row, is told whose it is.

       new     no row anywhere: write it, owned by me
       free    a row with no owner, from before there were several
               teachers: claim it
       mine    already mine
       other   someone else's: skip it, and say so

     Cached per address for the visit, so typing into the paste box
     doesn't re-ask the database on every keystroke. */
  var probe = {};   // email → "new" | "free" | "mine" | "other"

  // Pure: what one lookup says. `res` is {denied:true} or a snapshot-ish
  // {exists, teacher}.
  function classifyProbe(res, who){
    who = String(who || "").toLowerCase();
    if(!res || res.denied) return "other";
    if(!res.exists) return "new";
    var t = String(res.teacher || "").toLowerCase();
    if(!t) return "free";
    return t === who ? "mine" : "other";
  }

  function probeEmails(emails){
    var todo = emails.filter(function(e){
      return e && !roster[e] && !Object.prototype.hasOwnProperty.call(probe, e);
    });
    return Promise.all(todo.map(function(email){
      return db.collection("roster").doc(email).get().then(function(snap){
        probe[email] = classifyProbe({ exists: snap.exists, teacher: snap.exists && (snap.data() || {}).teacher }, me);
      }, function(err){
        // Only a refusal means "someone else's". A network failure is not
        // an answer; leave it unknown and let the write report it.
        if(err && err.code === "permission-denied") probe[email] = "other";
      });
    }));
  }

  /* Somebody else's student: a row on this page that names another
     teacher (only the admin can see those), or a lookup that said so. */
  function ownedElsewhere(email){
    var r = roster[email];
    if(r) return !!(r.teacher && r.teacher !== me);
    return probe[email] === "other";
  }

  /* Pure: which rows an import may write, and which it must skip. A row
     already on this teacher's roster is theirs by definition; anything
     else goes by the lookup. */
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
      " already in another teacher\u2019s class (" + names.slice(0, 5).join(", ") +
      (names.length > 5 ? " and " + (names.length - 5) + " more" : "") +
      ") \u2014 ask the admin to move them.";
  }

  // new · update · already signed in · another teacher's. The third one
  // matters: it is the row that will NOT get an assignment written for
  // it, because that student already has one. The fourth is not written.
  function rosterStatus(row){
    var signedIn = everyone.filter(function(s){
      return !s.pending && s.email && s.email.toLowerCase() === row.email;
    })[0];
    if(ownedElsewhere(row.email)) return { key: "other", text: "in another teacher\u2019s class \u2014 skipped" };
    if(signedIn) return { key: "signed-in", text: "already signed in", uid: signedIn.uid };
    if(roster[row.email]) return { key: "update", text: "update" };
    if(probe[row.email] === "other") return { key: "other", text: "in another teacher\u2019s class \u2014 skipped" };
    if(probe[row.email] === "free") return { key: "update", text: "update" };
    if(!Object.prototype.hasOwnProperty.call(probe, row.email) && db) return { key: "checking", text: "checking\u2026" };
    return { key: "new", text: "new" };
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
    var body = p.rows.map(function(r){
      var st = rosterStatus(r);
      return "<tr><td>" + esc(r.name || "—") + "</td>" +
        '<td class="muted tiny">' + esc(r.email) + "</td>" +
        "<td>" + (r.period ? '<span class="pill">' + esc(r.period) + "</span>" : '<span class="muted tiny">—</span>') + "</td>" +
        '<td><span class="pill ' + (st.key === "new" ? "good" : st.key === "update" ? "warn" : st.key === "other" ? "bad" : "") + '">' + esc(st.text) + "</span></td></tr>";
    }).join("");
    var skipped = importPlan(p.rows).skip;
    var taking = p.rows.length - skipped.length;

    box.innerHTML =
      "<p class=\"note\"><b>" + taking + (taking === 1 ? " student" : " students") + "</b> ready" +
      (p.errors.length ? ", <b>" + p.errors.length + "</b> " + (p.errors.length === 1 ? "row" : "rows") + " left out" : "") +
      (p.hadHeader ? "" : " · no header row found, so the columns were guessed from their shape") +
      ".</p>" +
      (p.errors.length ? '<div class="empty"><b>Left out:</b><br>' + p.errors.map(function(e){
        return "line " + e.line + (e.name ? " (" + esc(e.name) + ")" : "") + " — " + esc(e.message);
      }).join("<br>") + "</div>" : "") +
      '<div class="tableScroll" style="max-height:46vh"><table class="t"><thead><tr>' +
      "<th>Name</th><th>Signs in as</th><th>Period</th><th>Status</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>" +
      (skipped.length ? '<p class="note" style="margin-top:12px">' + esc(skippedText(skipped)) + "</p>" : "");
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
        "It needs an <b>ID number</b> column and a <b>name</b>; a <b>period</b> is used if it's there. " +
        "Students sign in as <b>&lt;ID number&gt;@seq.org</b>, which is how a row and an account find each other. " +
        "You choose their games afterwards, on the Assign board.</p>" +
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

  /* What an import actually writes. Three things, one batch (or as few
     batches as 400-a-piece allows):

       roster/{email}   one set-merge per row
       config/class     any period the file mentioned that the class
                        didn't have
       assignments/{uid} ONLY where a student has already signed in, has
                        a roster row, and has NO assignment document yet

     That last one is the only place the roster ever writes into
     assignments, and it only ever fills a blank. A teacher who moved a
     student to another period in March must not have that undone by a
     re-import in April, so an existing assignment is never touched.

     And nothing is ever deleted. A student left out of an export by
     mistake keeps their row; removing one is an explicit click on their
     page. */
  /* No assignment, or one that says nothing: a move between teachers
     leaves a document carrying only `teacher`, and that must not stop an
     import filling in the period. */
  function blankAssignment(a){
    return !a || (a.period == null && !Array.isArray(a.lists));
  }

  function importBody(rows, now){
    var out = { roster: {}, periods: [], assignments: {} };
    var known = {};
    allPeriods().forEach(function(p){ known[p] = true; });
    rows.forEach(function(r){
      // Only rows importPlan let through get here — new, unowned, or
      // already the importer's — so the importer is the owner.
      var owner = me;
      var doc = { name: r.name, id: r.id, period: r.period, importedAt: now, teacher: owner };
      out.roster[r.email] = doc;
      if(r.period && !known[r.period]){ known[r.period] = true; out.periods.push(r.period); }

      var signedIn = everyone.filter(function(s){
        return !s.pending && s.email && s.email.toLowerCase() === r.email;
      })[0];
      if(signedIn && blankAssignment(assignments[signedIn.uid])){
        var a = { period: r.period || null, updatedAt: now, teacher: owner };
        out.assignments[signedIn.uid] = a;
      }
    });
    return out;
  }

  // An import body as a flat list of writes, for commitWrites.
  function importWrites(body){
    var writes = Object.keys(body.roster).map(function(email){
      return { col: "roster", id: email, data: body.roster[email] };
    }).concat(Object.keys(body.assignments).map(function(uid){
      return { col: "assignments", id: uid, data: body.assignments[uid] };
    }));
    if(body.periods.length){
      writes.push({ col: "classes", id: me, data: { periods: allPeriods().concat(body.periods) } });
    }
    return writes;
  }

  /* Look every address up, leave out the ones that are somebody else's,
     write the rest. If the write is still refused — a row another
     teacher claimed between the lookup and the click — forget what was
     looked up, look again, and try once more, so one such row can't sink
     the whole class. Resolves to the rows it skipped. */
  function writeImport(rows, retried){
    return probeEmails(rows.map(function(r){ return r.email; })).then(function(){
      var plan = importPlan(rows);
      if(!plan.take.length) return plan.skip;
      return commitWrites(importWrites(importBody(plan.take, Date.now()))).then(function(){
        return plan.skip;
      });
    }).catch(function(err){
      if(retried || !(err && err.code === "permission-denied")) throw err;
      rows.forEach(function(r){ if(!roster[r.email]) delete probe[r.email]; });
      return writeImport(rows, true);
    });
  }

  function commitImport(){
    var p = importParsed;
    if(!p || !p.rows.length) return;
    var note = document.getElementById("riNote");
    note.className = "saveNote";
    note.textContent = "Importing…";

    writeImport(p.rows).then(function(skip){
      closeImport();
      return loadAll().then(function(){ return skip; });
    }).then(function(skip){
      view = "roster";
      detailUid = null;
      quickNote = { text: skippedText(skip), err: !!skip.length };
      renderSub();
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

  // Every period that exists: the ones the teacher named plus any a
  // student is already tagged with, so a period can never go missing from
  // the UI just because it was set before it was named.
  function allPeriods(){
    var set = {};
    classCfg.periods.forEach(function(p){ if(p) set[p] = true; });
    for(var uid in assignments){
      var p = assignments[uid] && assignments[uid].period;
      if(p) set[p] = true;
    }
    // And every period a student on this page is actually in. The admin
    // sees other teachers' students, whose periods live in those
    // teachers' classes/ docs; without this a pending student in a period
    // the admin never named would fall off the board altogether.
    students.forEach(function(s){
      var sp = periodOf(assignments[s.uid], rosterFor(s));
      if(sp) set[sp] = true;
    });
    return Object.keys(set).sort(function(a,b){
      var na = parseFloat(a), nb = parseFloat(b);
      if(!isNaN(na) && !isNaN(nb)) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /* What this student sees: the same rule store.js applies for the
     student, pinned against it by tests.html. Their own assignment, then
     the lists on their roster row (set here before they had signed in),
     then nothing. `from` is for the export. */
  function effectiveLists(uid){
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

  /* The modes, once each, with their icons — the key for the board's
     cells, which are icons and nothing else. */
  function legendHtml(){
    var modes = Object.keys(WordLists.MODES).map(function(k){ return WordLists.MODES[k]; });
    return '<div class="abLegend">' + modes.map(function(m){
      return '<span class="abKey"><span class="abKeyIcon">' + esc(m.icon) + "</span>" + esc(m.title) +
        (m.needs ? ' <span class="muted tiny">(' + esc(m.needs) + ")</span>" : "") + "</span>";
    }).join("") + "</div>";
  }

  /* ---------------- the picker ----------------
     One section per family, because that is now the only kind of entry
     there is. A family with several lists (the red words) gets the grid
     it always had — a row per list, a column per mode, with row and
     column toggles, so "lists 1-4 as flash cards" is four clicks rather
     than eight. A family with ONE list has nothing to put in the rows,
     so it collapses to a line of mode checkboxes: "Blend Words:
     🎤 Say it · 🃏 Cards · 🎯 Match It".

     scopeId  "student" | "bulk" — stamped on every input so
              scopeSelection() can read one picker on a page carrying
              several
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
  function pickerHtml(scopeId, selected, alsoShow){
    var on = function(id){ return (selected || []).indexOf(id) !== -1; };
    // Retired ids to draw a box for even though this scope doesn't hold
    // them: the bulk dialog uses it so "Take these away" has something to tick.
    var extra = Array.isArray(alsoShow) ? alsoShow : [];
    var shown = function(id){ return on(id) || extra.indexOf(id) !== -1; };
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
         scope that doesn't hold it (every bulk picker starts empty) gets
         no box for it at all. */
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
     #tBody because the bulk picker lives in a modal outside it; the scope
     stamp is what keeps two pickers on one screen apart. */
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
    var av = safePhoto(s.photo)
      ? '<img src="' + esc(s.photo) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="init">' + esc((s.name || s.email || "?")[0].toUpperCase()) + "</span>";
    // A note is worth nothing if you have to open a student to find out
    // it exists, so the roster carries the first line of it under the
    // name and the whole thing on hover.
    var n = noteSummary(s.uid);
    return '<div class="who">' + av + "<div style=\"min-width:0\">" +
      '<div class="nm">' + esc(s.name || s.email || s.uid) +
        (n ? ' <span class="noteDot" title="' + esc(noteOf(s.uid)) + '">✎</span>' : "") + "</div>" +
      '<div class="em">' + esc(s.email) + "</div>" +
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
      ? n + (n === 1 ? " student has" : " students have") + " signed in · " + allPeriods().length + " period" + (allPeriods().length === 1 ? "" : "s") +
        (admin ? " · every teacher\u2019s class" : "")
      : "No students have signed in yet.";
  }

  /* ---------------- the console's chrome ----------------
     The sidebar, the top bar and the period filter. Painted on every
     render, so nothing in it can disagree with the view underneath. */
  var VIEW_TITLE = {
    roster: "Students", trouble: "Trouble spots", assign: "Assign board",
    groups: "Periods", manage: "Manage"
  };
  // The views the period filter means something on.
  var FILTERED = { roster: true, trouble: true, assign: true };

  /* Pure: the segmented filter's buttons. All, then each period someone
     (not archived) is in, then "Unassigned (n)" — only while n > 0. */
  function filterSegments(list){
    var counts = {}, loose = 0;
    list.forEach(function(st){
      var p = studentPeriod(st.uid);
      if(p === null) loose++;
      else counts[p] = (counts[p] || 0) + 1;
    });
    var out = [{ value: "", label: "All" }];
    allPeriods().forEach(function(p){
      if(counts[p]) out.push({ value: p, label: p, title: "Period " + p + " \u00b7 " + counts[p] });
    });
    if(loose) out.push({ value: NO_PERIOD, label: "Unassigned (" + loose + ")" });
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
    var cur = boardPeriod();
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
      setBoardPeriod(b.getAttribute("data-filter"));
      closePop();
      render();
    });
    $("tRefresh").addEventListener("click", refresh);
    $("tPreview").addEventListener("click", togglePreviewPop);
  }

  /* Refresh: the same loadAll() the page booted with, then the current
     view drawn again — no page reload, so the open student, the filter
     and the Manage section all hold. Unsaved board edits would be thrown
     away, so it asks first, exactly as leaving the board does. */
  function refresh(){
    if(view === "assign"){
      var n = dirtyScopes().length;
      if(n && !window.confirm(n + (n === 1 ? " change hasn't" : " changes haven't") +
                              " been saved yet. Refresh and lose them?")) return;
    }
    var btn = $("tRefresh");
    if(btn){ btn.disabled = true; btn.textContent = "Refreshing\u2026"; }
    loadAll().then(function(){
      board.draft = {};
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
      var pick = detailUid && studentByUid(detailUid) ? detailUid : students[0].uid;
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
  function switchView(v, keepDraft){
    // The Assign board holds its edits in memory until Save, so walking
    // away from it silently would throw them out.
    if(view === "assign" && v !== "assign" && !keepDraft){
      var n = dirtyScopes().length;
      if(n && !window.confirm(n + (n === 1 ? " change hasn't" : " changes haven't") +
                              " been saved yet. Leave the board and lose them?")) return;
      board.draft = {};
    }
    view = v;
    detailUid = null;
    render();
    window.scrollTo(0, 0);
  }

  function render(){
    closePop();
    closeBulk();
    closePreviewPop();
    renderChrome();
    if(view === "roster") return detailUid ? renderDetail() : renderRoster();
    if(view === "assign") return renderAssign();
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
      "Name","Email","Period","Lists",
      "Answers","Accuracy %","Words solid","Words shaky","Slow but right","Top error","Last active","Signed in","Note"
    ].concat(flCols.reduce(function(acc, l){
      return acc.concat([l.listTitle + " latest", l.listTitle + " best"]);
    }, []))];
    students.forEach(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      rows.push([
        s.name, s.email,
        periodOf(assignments[s.uid], rosterFor(s)),
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
    var rows = [["Name","Email","Period","List","Pattern","Mode","Word","Attempts","Correct","Accuracy %","Solid","Slow","Top error","Last practised"]];
    students.forEach(function(s){
      var period = studentPeriod(s.uid) || "";
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
  function renderRoster(){
    if(!students.length){
      $("tBody").innerHTML = '<div class="panel"><h2>Get started</h2>' +
        '<ol class="steps">' +
          "<li><b>Import your roster</b> under Periods. Your students show up here before they ever sign in.</li>" +
          "<li><b>Give each student their games</b> on the Assign board. A student sees only what you give them.</li>" +
          "<li><b>Students sign in</b> with their school account — their ID number @seq.org.</li>" +
        "</ol>" +
        '<div class="rowActions"><button class="btn sm" id="tGoGroups">Import a roster →</button></div>' +
        '<p class="note" style="margin:16px 0 6px">Or add students one at a time:</p>' + quickAddHtml() + "</div>";
      $("tGoGroups").addEventListener("click", function(){ switchView("groups"); });
      wireQuickAdd();
      return;
    }
    var shown = classStudents();
    var waiting = shown.filter(function(s){ return s.pending; }).length;
    var bare = shown.filter(function(s){ return !effectiveLists(s.uid).ids.length; });
    var cards = summaryCounts(shown, Date.now());
    var rows = shown.map(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      var a = assignments[s.uid] || {};
      var r = rosterFor(s);
      var period = periodOf(a, r);
      /* A student on the roster who hasn't signed in yet is a real row
         with nothing in it. Greyed rather than hidden: on day one the
         useful thing this table can tell a teacher is who is MISSING. */
      if(s.pending){
        return '<tr class="clickable pending" data-uid="' + esc(s.uid) + '">' +
          "<td>" + whoHtml(s) + "</td>" +
          "<td>" + (period ? '<span class="pill">Period ' + esc(period) + "</span>" : '<span class="muted tiny">not set</span>') + "</td>" +
          '<td class="listsCell">' + listsCellHtml(eff.ids) + "</td>" +
          '<td class="muted tiny" colspan="4">on the roster — hasn\u2019t signed in yet</td>' +
          '<td class="muted tiny">—</td></tr>';
      }
      return "<tr class=\"clickable\" data-uid=\"" + esc(s.uid) + "\">" +
        "<td>" + whoHtml(s) + "</td>" +
        '<td>' + (period ? '<span class="pill">Period ' + esc(period) + "</span>" : '<span class="muted tiny">not set</span>') + "</td>" +
        '<td class="listsCell">' + listsCellHtml(eff.ids) + "</td>" +
        '<td class="num">' + sum.attempts + "</td>" +
        '<td class="num">' + accCell(sum.accuracy) + "</td>" +
        '<td class="num"><span class="pill good">' + sum.mastered + "</span></td>" +
        '<td class="num">' + (sum.struggling ? '<span class="pill bad">' + sum.struggling + "</span>" : '<span class="muted">0</span>') + "</td>" +
        '<td class="muted tiny">' + esc(ago(sum.lastSeen || s.lastSeen)) + "</td>" +
        "</tr>";
    }).join("");

    var steps = nextStepRows();
    var stepsHtml = steps.map(function(r){
      return '<li class="nsRow"><span class="nsWho">' + esc(r.name) +
        (r.period ? ' <span class="muted tiny">P' + esc(r.period) + "</span>" : "") + "</span>" +
        '<span class="nsText">' + esc(r.step.text) + "</span>" +
        (r.step.addId ? '<button class="pkMini" data-nsadd="' + esc(r.uid) + '|' + esc(r.step.addId) +
          '">Add ' + esc((WordLists.modeOf((WordLists.byId(r.step.addId) || {}).mode) || {}).title || "it") + "</button>" : "") +
        "</li>";
    }).join("");

    $("tBody").innerHTML =
      /* Four counts, all of them students, all of them inside the period
         filter. "Shaky" is the same per-student number as the table's
         Shaky column (Adaptive.summarize), counted as people who have any. */
      '<div class="sumCards">' +
        sumCard("Students", cards.students, boardPeriod() ? "in this filter" : "in your class") +
        sumCard("Practiced this week", cards.week, "a round in the last 7 days") +
        sumCard("No games yet", cards.none, "home page is empty", cards.none ? "warn" : "") +
        sumCard("Have shaky words", cards.shaky, "right under 60% on a word", cards.shaky ? "bad" : "") +
      "</div>" +
      (bare.length ? '<div class="panel callout"><p><b>' + bare.length +
        (bare.length === 1 ? " student has" : " students have") + " no games yet.</b> " +
        "They see an empty home page until you give them some.</p>" +
        '<button class="btn sm" id="tGoAssign">Assign games →</button></div>' : "") +
      '<div class="panel"><h2>What should change</h2>' +
        '<p class="note">At most one suggestion per student, worked out from their practice. ' +
        "Most days most of the class isn't listed.</p>" +
        (stepsHtml ? '<ul class="nsList">' + stepsHtml + "</ul>"
                   : '<div class="empty">Nothing to change right now.</div>') +
      "</div>" +

      '<div class="panel"><h2>Students</h2>' +
      (waiting ? '<p class="note"><b>' + waiting + (waiting === 1 ? " student on the roster hasn\u2019t" : " students on the roster haven\u2019t") +
        ' signed in yet</b> — greyed out below. You can give them games now; ' +
        "they'll be waiting the first time they sign in.</p>" : "") +
      '<p class="note">Click a student to see their hardest words and change their games. ' +
      '<b>Solid</b> means the student reads the word right at least 9 times in 10, with enough recent first-try right answers that the site now shows it only rarely. ' +
      '<b>Shaky</b> means right less than 60&nbsp;% of the time.</p>' +
      quickAddHtml() +
      '<div class="rowActions" style="margin-bottom:16px">' +
        '<button class="btn ghost sm" id="tExportRoster">⬇ Roster CSV</button>' +
        '<button class="btn ghost sm" id="tExportWords">⬇ Every word CSV</button>' +
        '<span class="muted tiny">One row per student, and one row per word they\'ve attempted. ' +
        "Opens in Excel, Sheets or Numbers.</span>" +
      "</div>" +
      '<div class="tableScroll"><table class="t"><thead><tr>' +
      "<th>Student</th><th>Period</th><th>Lists</th>" +
      '<th class="num">Answers</th><th class="num">Accuracy</th><th class="num">Solid</th><th class="num">Shaky</th><th>Last active</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></div>";

    Array.prototype.forEach.call(document.querySelectorAll("#tBody tr.clickable"), function(tr){
      tr.addEventListener("click", function(){ detailUid = tr.dataset.uid; render(); });
    });
    if($("tGoAssign")) $("tGoAssign").addEventListener("click", function(){ switchView("assign"); });
    /* The same one-click apply the Ready to move up strip uses: it feeds
       the board's draft rather than writing, so a teacher can look at
       what it did before committing to it. */
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-nsadd]"), function(b){
      b.addEventListener("click", function(){
        var parts = b.getAttribute("data-nsadd").split("|");
        var set = liveStudent(parts[0]).slice();
        if(set.indexOf(parts[1]) === -1) set.push(parts[1]);
        setScope("s:" + parts[0], set);
        switchView("assign", true);
      });
    });
    wireQuickAdd();
    $("tExportRoster").addEventListener("click", function(){ download(exportName("roster"), rosterCsv()); });
    $("tExportWords").addEventListener("click", function(){ download(exportName("words"), wordsCsv()); });
  }

  /* ---------------- what should change ----------------
     The panel at the top of the Students tab. Adaptive.nextSteps decides
     WHAT to say for one student; everything here is about assembling the
     summary it reads and keeping the panel short enough to be read.

     One line per student and never two, and only for students who have
     one — a panel that lists the whole class is the roster table again
     with worse formatting. */
  function nextStepInfo(s){
    var eff = effectiveLists(s.uid);
    var lists = eff.ids.map(function(id){
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
    return {
      lists: lists,
      lastRound: Adaptive.summarize(s.stats).lastSeen || s.lastSeen || 0,
      now: Date.now()
    };
  }

  function nextStepRows(){
    var out = [];
    students.forEach(function(s){
      // A student who hasn't signed in has no practice to reason about,
      // and "hasn't practised" about somebody who has never been here is
      // not a next step, it is the roster table saying the same thing.
      if(s.pending) return;
      if(!matchesFilter(s, boardPeriod())) return;
      var r = rosterFor(s);
      var period = periodOf(assignments[s.uid], r);
      var step = Adaptive.nextSteps(nextStepInfo(s));
      if(step) out.push({ uid: s.uid, name: s.name || s.email || s.uid, period: period, step: step });
    });
    return out;
  }

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

  // Archived ones too: their page still opens, from Manage → Archived.
  function studentByUid(uid){
    for(var i=0;i<everyone.length;i++) if(everyone[i].uid === uid) return everyone[i];
    return null;
  }

  function renderDetail(){
    var s = studentByUid(detailUid);
    if(!s){ detailUid = null; return renderRoster(); }
    var sum = Adaptive.summarize(s.stats);
    var a = assignments[s.uid] || {};
    var eff = effectiveLists(s.uid);

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

    var picker = pickerHtml("student", eff.ids);

    // The period they are actually in, not just the assigned one, so the
    // box agrees with every other place this student's period is shown.
    var shownPeriod = studentPeriod(s.uid);
    var periodOpts = ['<option value="">— not set —</option>'].concat(allPeriods().map(function(p){
      return '<option value="' + esc(p) + '"' + (shownPeriod === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
    })).join("");

    $("tBody").innerHTML =
      '<button class="backlink" id="tBack">← All students</button>' +
      '<div class="panel">' + whoHtml(s) +
        '<div class="statRow" style="margin-top:18px">' +
          '<div class="stat"><div class="k">Answers</div><div class="v">' + sum.attempts + "</div></div>" +
          '<div class="stat"><div class="k">Accuracy</div><div class="v">' + (sum.accuracy == null ? "—" : Math.round(sum.accuracy*100) + "%") + "</div></div>" +
          '<div class="stat"><div class="k">Words solid</div><div class="v">' + sum.mastered + "</div></div>" +
          '<div class="stat"><div class="k">Words shaky</div><div class="v">' + sum.struggling + "</div></div>" +
          /* Right, and slow. Never shown to the student — see isSlow() —
             because "you are slow" makes the next word slower, not
             faster. It is exactly the number a teacher wants. */
          '<div class="stat"><div class="k">Slow but right</div><div class="v">' + sum.slowRight + "</div></div>" +
          '<div class="stat"><div class="k">Last active</div><div class="v" style="font-size:17px">' + esc(ago(sum.lastSeen || s.lastSeen)) + "</div></div>" +
        "</div>" +
        '<div class="rowActions">' +
          (isArchived(s, classCfg.archived)
            ? '<span class="pill warn">Archived</span> <button class="btn ghost sm" id="tArchive">Unarchive</button>' +
              '<span class="muted tiny">Hidden from every view until you unarchive them.</span>'
            : '<button class="btn ghost sm" id="tArchive">Archive</button>' +
              '<span class="muted tiny">Hides them from every view. Nothing is deleted; Manage \u2192 Archived brings them back.</span>') +
          '<span class="saveNote" id="tArchiveNote"></span>' +
        "</div>" +
      "</div>" +

      '<div class="panel"><h2>Games</h2>' +
        '<p class="note">This student sees exactly what is ticked here, and nothing else. ' +
        "Each list can be played several ways — tick each way they should get it.</p>" +
        '<div class="rowActions" style="margin-bottom:16px">' +
          '<label class="muted tiny" for="tPeriod">Period</label>' +
          '<select class="sel" id="tPeriod">' + periodOpts + "</select>" +
          '<input class="txt" id="tNewPeriod" placeholder="or type a new one" style="width:170px">' +
        "</div>" +
        picker +
        '<div class="rowActions stickyActions">' +
          '<button class="btn sm" id="tSaveA">Save games and period</button>' +
          '<span class="saveNote" id="tANote"></span>' +
        "</div>" +
      "</div>" +

      (errorMix ? '<div class="panel"><h2>What goes wrong</h2>' +
        '<p class="note">Counted on Say It only — it is the only mode that hears what the student actually said. ' +
        "One count per word given up on, not per fumble.</p>" +
        "<p>" + errorMix + "</p></div>" : "") +

      (admin ? '<div class="panel"><h2>Teacher</h2>' +
        '<p class="note">Whose class this student is in. Moving them takes their games, period, note and practice ' +
        "with them; the teacher they leave stops seeing them.</p>" +
        '<div class="rowActions"><label class="muted tiny" for="tOwner">Teacher</label>' +
        '<select class="sel" id="tOwner">' + teacherOptions(ownerOf(s)) + "</select>" +
        '<span class="saveNote" id="tOwnerNote"></span></div>' +
      "</div>" : "") +

      (rosterRow ? '<div class="panel"><h2>Roster row</h2>' +
        '<p class="note">Imported ' + esc(rosterRow.importedAt ? ago(rosterRow.importedAt) : "at some point") +
        " · ID <b>" + esc(rosterRow.id || "—") + "</b> · signs in as <b>" + esc(s.email) + "</b>" +
        (s.pending ? " · <b>hasn\u2019t signed in yet</b>" : "") + ". " +
        "A re-import updates this row and never deletes it; removing one is this button, and only this button.</p>" +
        '<div class="rowActions"><button class="btn ghost sm" id="tRosterOut">Remove from roster</button>' +
        '<span class="saveNote" id="tRosterNote"></span></div>' +
      "</div>" : "") +

      /* Notes are keyed by uid, and a pending student's uid is the
         made-up roster:<email> — a note written now would be dropped the
         moment they sign in and got a real one. So don't offer the box. */
      (s.pending
        ? '<div class="panel"><h2>Notes</h2><p class="note">Notes open once they have signed in.</p></div>'
        : notePanelHtml(s.uid)) +

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

    $("tBack").addEventListener("click", function(){ detailUid = null; render(); });
    $("tArchive").addEventListener("click", function(){
      var on = !isArchived(s, classCfg.archived);
      var note = $("tArchiveNote");
      note.className = "saveNote"; note.textContent = "Saving\u2026";
      setArchived(s, on).then(function(){
        // Archived: back to the list it has just left. Unarchived: stay.
        if(on) detailUid = null;
        render();
      }, function(){
        note.className = "saveNote err"; note.textContent = "Didn't save \u2014 check the network and try again.";
      });
    });
    if($("tOwner")) $("tOwner").addEventListener("change", function(){
      var sel = this, to = sel.value, from = ownerOf(s);
      if(to === from) return;
      if(!window.confirm("Move " + (s.name || s.email) + " to " + teacherName(to) + "?")){
        sel.value = from;
        return;
      }
      var note = $("tOwnerNote");
      note.className = "saveNote"; note.textContent = "Moving…";
      moveStudents([s], to).then(function(){
        note.className = "saveNote ok"; note.textContent = "Moved.";
      }, function(){
        sel.value = from;
        note.className = "saveNote err"; note.textContent = "Didn't move — check the network and try again.";
      });
    });
    if($("tRosterOut")) $("tRosterOut").addEventListener("click", function(){
      var em = s.email.toLowerCase();
      if(!window.confirm("Remove " + (s.name || em) + " from the roster?\n\n" +
        (s.pending ? "They haven\u2019t signed in, so this takes them off the dashboard entirely."
                   : "Their practice record stays; only the imported row goes."))) return;
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
    $("tSaveA").addEventListener("click", function(){ saveStudentAssignment(s.uid); });
    if(!s.pending) $("tNoteSave").addEventListener("click", function(){ saveNote(s.uid, $("tNote").value); });
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
  // First line only, clipped — what the board and the roster show when
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
    var body = { text: text, updatedAt: Date.now(), teacher: ownerOfUid(uid) };
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
      '<p class="note">For the things the numbers don\'t say. <b>Only you can read this</b> — ' +
      "it's the one thing on this page the student can't see about themselves, which is what makes it " +
      "worth writing honestly.</p>" +
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
     something they weren't. */
  function saveStudentAssignment(uid){
    var note = $("tANote");
    var period = ($("tNewPeriod").value || "").trim() || $("tPeriod").value || null;
    var lists = checkedLists();

    /* A student who hasn't signed in yet is edited the same way and
       written somewhere else — their roster row, which store.js reads on
       the first sign-in. */
    if(isPending(uid)){
      var em = emailOfPending(uid);
      var wasRow = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
      var rowBody = { period: period || "", lists: lists, updatedAt: Date.now(), teacher: ownerOfUid(uid) };
      roster[em] = roster[em] || { email: em };
      roster[em].period = rowBody.period;
      roster[em].lists = lists;
      if(period && classCfg.periods.indexOf(period) === -1) classCfg.periods.push(period);
      note.className = "saveNote"; note.textContent = "Saving…";
      db.collection("roster").doc(em).set(rowBody, { merge:true })
        .then(function(){ return classRef().set({ periods: classCfg.periods }, { merge:true }); })
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
    var body = { period: period, lists: lists, updatedAt: Date.now(), teacher: ownerOfUid(uid) };
    assignments[uid] = body;
    if(period && classCfg.periods.indexOf(period) === -1) classCfg.periods.push(period);

    note.className = "saveNote"; note.textContent = "Saving…";
    db.collection("assignments").doc(uid).set(body, { merge:true })
      .then(function(){
        // Keep the named-period list in step, so a period invented in this
        // box shows up under Periods straight away.
        return classRef().set({ periods: classCfg.periods }, { merge:true });
      })
      .then(function(){
        note.className = "saveNote ok"; note.textContent = "Saved.";
        render();
      })
      .catch(function(){
        if(before) assignments[uid] = before; else delete assignments[uid];
        note.className = "saveNote err"; note.textContent = "Didn't save — check the network and try again.";
      });
  }

  /* ---------------- periods ----------------
     Importing the roster, naming periods, and who is in which. A period
     is a label that groups students on this dashboard; it never decides
     what a student sees. */
  function renderGroups(){
    var periods = allPeriods();
    function countIn(p){
      return students.filter(function(s){ return studentPeriod(s.uid) === p; }).length;
    }

    var periodPills = periods.map(function(p){
      var n = countIn(p);
      return '<span class="pill">Period ' + esc(p) + ' <span class="muted">· ' + n + "</span></span>";
    }).join(" ");

    // rosterRows, not roster: naming it `roster` shadowed the module-level
    // map, and the "N on the roster now" line below counted the characters
    // of this HTML string.
    var rosterRows = students.map(function(s){
      var mine = studentPeriod(s.uid);
      var opts = ['<option value="">—</option>'].concat(periods.map(function(p){
        return '<option value="' + esc(p) + '"' + (mine === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
      })).join("");
      return "<tr><td>" + whoHtml(s) + "</td>" +
        '<td><select class="sel" data-period-for="' + esc(s.uid) + '" aria-label="Period for ' + esc(s.name || s.email) + '">' + opts + "</select></td>" +
        '<td class="listsCell">' + listsCellHtml(effectiveLists(s.uid).ids) + "</td></tr>";
    }).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Import a roster</h2>' +
        '<p class="note">Drop or paste whatever your student information system exports. ' +
        "Every student shows up here with their period before they ever sign in. " +
        "Re-importing updates rows and never deletes one.</p>" +
        '<div class="rowActions"><button class="btn sm" id="tImport">📋 Import roster</button>' +
        '<span class="muted tiny">' + (Object.keys(roster).length
          ? Object.keys(roster).length + " on the roster now"
          : "nothing imported yet") + "</span></div>" +
      "</div>" +

      '<div class="panel"><h2>Periods</h2>' +
        '<p class="note">Periods are labels — “3”, “5”, “Support” — for grouping and filtering students here. ' +
        "They don't change what anyone sees.</p>" +
        (periodPills ? '<p class="periodPills">' + periodPills + "</p>" : "") +
        '<div class="rowActions"><input class="txt" id="tAddPeriod" placeholder="New period, e.g. 3" aria-label="New period name"> ' +
        '<button class="btn sm" id="tAddPeriodBtn">Add period</button>' +
        '<span class="saveNote" id="tAddNote"></span></div>' +
      "</div>" +

      (students.length ? '<div class="panel"><h2>Who’s in which period</h2>' +
        '<p class="note">Changes save as soon as you pick.</p>' +
        '<div class="tableScroll"><table class="t"><thead><tr><th>Student</th><th>Period</th><th>Games</th></tr></thead>' +
        "<tbody>" + rosterRows + "</tbody></table></div></div>" : "");

    $("tImport").addEventListener("click", openImport);
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-period-for]"), function(sel){
      sel.addEventListener("change", function(){ setStudentPeriod(sel.dataset.periodFor, sel.value || null); });
    });
    var addBtn = $("tAddPeriodBtn");
    if(addBtn) addBtn.addEventListener("click", addPeriod);
    var addBox = $("tAddPeriod");
    if(addBox) addBox.addEventListener("keydown", function(e){ if(e.key === "Enter") addPeriod(); });
  }

  function setStudentPeriod(uid, period){
    /* Same split as saveStudentAssignment: a student who hasn't signed in
       has no uid to write an assignment against. Writing one anyway
       created assignments/roster:<email>, which looked applied on the
       dashboard and did nothing at sign-in — the real uid's document was
       somewhere else — while the orphan kept feeding allPeriods(). */
    if(isPending(uid)){
      var em = emailOfPending(uid);
      var wasRow = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
      roster[em] = roster[em] || { email: em };
      roster[em].period = period || "";
      db.collection("roster").doc(em).set({ period: period || "", updatedAt: Date.now(), teacher: ownerOfUid(uid) }, { merge:true })
        .catch(function(){
          if(wasRow) roster[em] = wasRow; else delete roster[em];
          render();
        });
      return;
    }

    var before = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
    var body = assignments[uid] || {};
    // "" rather than null for "not set": see periodOf.
    body.period = period || "";
    body.updatedAt = Date.now();
    assignments[uid] = body;
    body.teacher = ownerOfUid(uid);
    db.collection("assignments").doc(uid).set({ period: body.period, updatedAt: body.updatedAt, teacher: body.teacher }, { merge:true })
      .catch(function(){
        if(before) assignments[uid] = before; else delete assignments[uid];
        render();
      });
  }

  /* Quick add: type an ID (or a few) instead of importing a file. It is
     the import with a one-line source — the same parseRoster checks, the
     same importBody writes — so a typed ID and an imported one end up as
     exactly the same roster row. The one difference: an ID already on the
     roster is skipped, not updated, because a typed ID carries no name
     and a set-merge would blank the name the import put there. */
  var quickNote = { text: "", err: false };

  function quickAddHtml(){
    return '<div class="rowActions" style="margin-bottom:16px">' +
      '<input class="txt" id="tQuickId" inputmode="numeric" autocomplete="off" ' +
        'placeholder="Add by student ID, e.g. 102345" aria-label="Student ID numbers to add"> ' +
      '<select class="sel" id="tQuickPeriod" aria-label="Period for the students being added">' +
        '<option value="">No period</option>' + allPeriods().map(function(p){
          return '<option value="' + esc(p) + '">Period ' + esc(p) + "</option>";
        }).join("") + "</select> " +
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
    var period = $("tQuickPeriod").value || "";
    var text = (box.value || "").split(/[\s,;]+/).filter(Boolean).map(function(id){
      return period ? id + "," + period : id;
    }).join("\n");
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
    writeImport(rows).then(function(taken){
      var added = rows.length - taken.length;
      var msg = (added ? "Added " + added + (added === 1 ? " student" : " students") : "Nobody added") +
        (skipped.length ? " · already on the roster: " + skipped.join(", ") : "") +
        (bad.length ? " · left out: " + bad.join("; ") : "") +
        (taken.length ? " · " + skippedText(taken) : ". Choose their games on the Assign board.");
      return loadAll().then(function(){
        quickNote = { text: msg, err: !!taken.length };
        render();   // draws the note once, then wireQuickAdd clears it
      });
    }).catch(function(){
      btn.disabled = false;
      say("Nothing added — check the network and try again.", true);
    });
  }

  function addPeriod(){
    var v = ($("tAddPeriod").value || "").trim();
    var note = $("tAddNote");
    if(!v){ note.className = "saveNote err"; note.textContent = "Type a name first."; return; }
    if(classCfg.periods.indexOf(v) !== -1){ note.className = "saveNote"; note.textContent = "Already there."; return; }
    classCfg.periods.push(v);
    note.className = "saveNote"; note.textContent = "Saving…";
    classRef().set({ periods: classCfg.periods }, { merge:true })
      .then(function(){ render(); })
      .catch(function(){
        classCfg.periods = classCfg.periods.filter(function(x){ return x !== v; });
        note.className = "saveNote err"; note.textContent = "Didn't save.";
      });
  }

  /* ════════════════════════════════════════════════════════════════
     the Assign board

     The picker on a student's page answers "what should THIS student
     get?", which is the wrong shape for the ten minutes at the start of a
     unit when a teacher is moving a whole class onto List 4. That is what
     this is: one grid, students down the side and lists across the top,
     every student's games visible at once and editable in place.

     · A row is exactly what that student sees. There is nothing above it
       to inherit from, so there is nothing to explain about where a cell
       came from.
     · Many at once: tick names, or a whole period at its header, then
       "Change games" adds, takes away or replaces lists for all of them.
     · Nothing is written until Save. Every edit lands in `draft`, the
       bar at the bottom counts what's pending, and Save commits the lot
       in ONE db.batch(). A teacher reassigning six students should not
       be able to get halfway.
     ════════════════════════════════════════════════════════════════ */

  var board = {
    draft: {},        // "s:<uid>" → ids array
    sel: {},          // uid → true, for the bulk dialog
    collapsed: {},    // family key → true
    period: null,     // filter; null until read from localStorage
    q: ""             // name search
  };

  /* The class-wide period filter (the top bar's), stored on `board` for
     history's sake — it began as the board's own. The old key is still
     read once, so nobody's remembered period is lost in the move. */
  var FILTER_KEY = "ei.class.period";
  var OLD_FILTER_KEY = "ei.assign.period";
  function storedPeriod(){
    if(board.period === null){
      try{ board.period = window.localStorage.getItem(FILTER_KEY) ||
                          window.localStorage.getItem(OLD_FILTER_KEY) || ""; }
      catch(e){ board.period = ""; }
    }
    return board.period;
  }
  /* The filter in force. Remembered in localStorage, so it can outlive
     the period it names — a new roster, a period emptied by a move —
     and a filter that matches nobody falls back to All, rather than
     drawing an empty page under a button that says otherwise. */
  function boardPeriod(){ return effectiveFilter(storedPeriod(), students); }
  function setBoardPeriod(p){
    board.period = p;
    try{ window.localStorage.setItem(FILTER_KEY, p); }catch(e){}
  }

  function hasDraft(scope){ return Object.prototype.hasOwnProperty.call(board.draft, scope); }
  function sameIds(a, b){
    if(!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    var x = a.slice().sort(), y = b.slice().sort();
    for(var i=0;i<x.length;i++) if(x[i] !== y[i]) return false;
    return true;
  }

  /* ── live values ──────────────────────────────────────────────────
     What a student has as stored, and what they will have once Save is
     pressed. Scopes are "s:<uid>" — the board's draft keys — so a cell
     can name its row without a lookup. */
  function storedStudent(uid){ return effectiveLists(uid).ids; }
  function liveStudent(uid){
    var k = "s:" + uid;
    return hasDraft(k) ? board.draft[k] : storedStudent(uid);
  }
  function scopeView(scope){ return liveStudent(scope.slice(2)); }

  function setScope(scope, ids){ board.draft[scope] = ids; }

  function scopeDirty(scope){
    if(!hasDraft(scope)) return false;
    return !sameIds(board.draft[scope], storedStudent(scope.slice(2)));
  }
  function dirtyScopes(){ return Object.keys(board.draft).filter(scopeDirty); }

  // "3 games" / "nothing yet" — the line under each name on the board.
  function countLabel(uid){
    var n = liveStudent(uid).length;
    return n ? n + (n === 1 ? " game" : " games") : "nothing yet";
  }

  /* ── who's on the board ─────────────────────────────────────────── */
  var NO_PERIOD = " none";     // a filter value no real period can collide with

  /* A student's period, read the way every other reader here reads it:
     the assignment's if there is one, otherwise the roster row's. A
     student imported into period 3 who signs in later has no assignment
     at all, and reading only assignments put them in "No period yet" on
     the board while the Students tab said Period 3. */
  function studentPeriod(uid){
    var p = periodOf(assignments[uid], rosterFor(studentByUid(uid)));
    return p === "" ? null : p;
  }
  /* A string on the assignment, even "", is the teacher's word and wins;
     only a missing or null one defers to the roster. That is what lets
     "— not set —" stick for a roster-imported student: clearing writes ""
     rather than null, because null would just fall back to the roster
     period again on the next load. */
  function periodOf(a, r){
    if(a && typeof a.period === "string") return a.period;
    return (r && r.period) || "";
  }
  function matchesQuery(s){
    var q = board.q.trim().toLowerCase();
    if(!q) return true;
    return (s.name || "").toLowerCase().indexOf(q) !== -1 ||
           (s.email || "").toLowerCase().indexOf(q) !== -1;
  }
  // Every student a column toggle would reach: the period filter and the
  // name box both narrow it, which is the whole safety story for "all".
  function visibleStudents(){
    var f = boardPeriod();
    return students.filter(function(s){ return matchesQuery(s) && matchesFilter(s, f); });
  }

  // Pure: is this student inside period filter `f`?
  function matchesFilter(s, f){
    if(!f) return true;
    var p = studentPeriod(s.uid);
    return f === NO_PERIOD ? p === null : p === f;
  }
  // Pure: `f`, or All when `f` matches nobody in `list`.
  function effectiveFilter(f, list){
    if(!f) return "";
    for(var i=0;i<list.length;i++) if(matchesFilter(list[i], f)) return f;
    return "";
  }
  // The class inside the filter — the Students table, its cards, the
  // suggestions and Trouble spots. The board adds its name search on top.
  function classStudents(){
    var f = boardPeriod();
    return students.filter(function(s){ return matchesFilter(s, f); });
  }

  /* Pure: the four summary cards. Every count is of students.
     "This week" is a word attempted in the last seven days — the stats'
     own clock, not lastSeen, which store.js stamps on every sign-in
     whether or not anything was played. */
  var WEEK_MS = 7 * 86400000;
  function summaryCounts(list, now){
    var out = { students: list.length, week: 0, none: 0, shaky: 0 };
    list.forEach(function(st){
      var sum = Adaptive.summarize(st.stats || {});
      if(sum.lastSeen && now - sum.lastSeen < WEEK_MS) out.week++;
      if(!effectiveLists(st.uid).ids.length) out.none++;
      if(sum.struggling > 0) out.shaky++;
    });
    return out;
  }
  function sumCard(k, v, sub, tone){
    return '<div class="sumCard' + (tone ? " " + tone : "") + '"><div class="k">' + esc(k) + "</div>" +
      '<div class="v">' + v + "</div>" + (sub ? '<div class="s">' + esc(sub) + "</div>" : "") + "</div>";
  }

  /* ---------------- archive ----------------
     Hidden from every view, deleted from nothing. The key is the
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
  // Pure: the class split in two.
  function splitArchived(list, map){
    var out = { active: [], archived: [] };
    list.forEach(function(st){ (isArchived(st, map) ? out.archived : out.active).push(st); });
    return out;
  }
  function applyArchive(full){
    everyone = full;
    students = splitArchived(full, classCfg.archived).active;
  }
  /* Unarchiving writes false rather than deleting the key: a set-merge
     can't delete without FieldValue, and false means the same thing. */
  function setArchived(st, on){
    var patch = {};
    patch[st.uid] = !!on;
    var em = String(st.email || "").toLowerCase();
    if(!on && em) patch[PENDING_PREFIX + em] = false;
    var before = JSON.parse(JSON.stringify(classCfg.archived || {}));
    classCfg.archived = classCfg.archived || {};
    for(var k in patch) classCfg.archived[k] = patch[k];
    applyArchive(everyone);
    return classRef().set({ archived: patch }, { merge:true }).catch(function(err){
      classCfg.archived = before;
      applyArchive(everyone);
      throw err;
    });
  }
  // The columns actually drawn: one per list, unless its family is folded
  // up, in which case the family gets one summary column instead.
  function boardColumns(){
    var cols = [];
    WordLists.families().forEach(function(fam){
      if(board.collapsed[fam.key]){
        cols.push({ fam: fam, summary: true });
        return;
      }
      WordLists.listNumsOf(fam.key).forEach(function(n){
        cols.push({ fam: fam, n: n });
      });
    });
    return cols;
  }

  /* ── one cell ─────────────────────────────────────────────────────
     What a scope has for one list. Read twice, from the same answer: as
     icons for the eye, and as words for a screen reader, which would
     otherwise be handed "🃏🎯" or a bare em dash and have to guess. */
  function cellModes(scope, col){
    var set = scopeView(scope);
    return WordLists.modesOf(col.fam.key).filter(function(m){
      var id = WordLists.idFor(col.fam.key, col.n, m.key);
      return id && set.indexOf(id) !== -1;
    });
  }
  function cellText(scope, col){
    // A collapsed family borrows describeFamily, so a folded column still
    // says something true rather than going blank.
    if(col.summary) return WordLists.describeFamily(col.fam.key, scopeView(scope)) || "—";
    var icons = cellModes(scope, col).map(function(m){ return m.icon; }).join("");
    return icons || "—";
  }
  function cellSpoken(scope, col){
    if(col.summary) return WordLists.describeFamily(col.fam.key, scopeView(scope)) || "nothing";
    var names = cellModes(scope, col).map(function(m){ return m.title; });
    return names.length ? names.join(", ") : "nothing";
  }
  // "Red Words List 3" / "Starting Blends" / "Red Words, all 10 lists"
  function colLabel(col){
    if(col.summary) return col.fam.title + ", all " + WordLists.listNumsOf(col.fam.key).length + " lists";
    return col.fam.title + (col.fam.lists.length > 1 ? " List " + col.n : "");
  }

  /* Rewrite every cell, pill and counter from the live state. Cheaper
     and far less disruptive than re-rendering the table: the popover
     stays open, the scroll position holds, and a board of 40 students by
     15 lists is 600 short string writes. */
  function paintCells(){
    var cols = boardColumns();
    // The two halves of a cell's label that don't change as it's edited,
    // resolved once rather than per cell: the row's name (read out of the
    // row it was rendered into) and the column's.
    var rowName = {};
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid tr[data-row]"), function(tr){
      var el = tr.querySelector(".abLabel");
      rowName[tr.dataset.row] = el ? el.textContent.trim() : tr.dataset.row;
    });
    var colName = cols.map(colLabel);

    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-cell]"), function(td){
      var parts = td.dataset.cell.split("|");
      var scope = parts[0];
      var i = Number(parts[1]);
      var col = cols[i];
      if(!col) return;
      var txt = cellText(scope, col);
      var spoken = cellSpoken(scope, col);
      td.textContent = txt;
      td.classList.toggle("empty", txt === "—");
      td.title = colName[i] + ": " + spoken;
      // "Ana, Red Words List 2: Cards, Match It" — an em dash and two
      // emoji are not something to hand a screen reader.
      td.setAttribute("aria-label", (rowName[scope] || scope) + ", " + colName[i] + ": " + spoken);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-count]"), function(el){
      var uid = el.dataset.count;
      el.textContent = countLabel(uid);
      el.classList.toggle("none", !liveStudent(uid).length);
    });
        paintSaveBar();
  }
  function paintSaveBar(){
    var n = dirtyScopes().length;
    var bar = $("abBar");
    if(!bar) return;
    bar.hidden = n === 0;
    var c = $("abCount");
    if(c) c.textContent = n + (n === 1 ? " change" : " changes");
  }

  /* ── the popover ──────────────────────────────────────────────────
     A cell holds up to four modes, which is one checkbox too many to
     cycle through by clicking. So a click opens this: the modes for that
     one list, ticked live. It lives on <body> rather than inside the
     cell so that repainting the grid can't tear it out from under a
     half-finished click. */
  var pop = null;
  function closePop(){
    if(pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }
  function openPop(td, scope, col){
    closePop();
    var fam = col.fam;
    // Offered modes, plus a retired one only where this scope holds it.
    var modes = modesToShow(fam.key, function(m){
      return scopeView(scope).indexOf(WordLists.idFor(fam.key, col.n, m.key)) !== -1;
    });
    var label = fam.title + (fam.lists.length > 1 ? " · List " + col.n : "");

    pop = document.createElement("div");
    pop.className = "abPop";
    pop.innerHTML =
      '<div class="abPopHead">' + esc(label) + "</div>" +
      '<div class="abPopBody">' + modes.map(function(m){
        var id = WordLists.idFor(fam.key, col.n, m.key);
        if(!id) return "";
        var on = scopeView(scope).indexOf(id) !== -1;
        var ret = WordLists.isRetired(id);
        return '<label class="check' + (ret ? " retiredBox" : "") + '"' + (ret ? ' title="' + RETIRED_TIP + '"' : hintAttr(fam.key, m.key)) +
          '><input type="checkbox" data-mode-id="' + esc(id) + '"' + (on ? " checked" : "") +
          "><span>" + esc(m.icon + " " + m.title) + (ret ? '<span class="sub2">Retired</span>' : "") + "</span></label>";
      }).join("") + "</div>" +
      '<div class="abPopFoot">' +
        '<button type="button" class="pkMini" data-pop="all">all</button>' +
        '<button type="button" class="pkMini" data-pop="none">none</button>' +
        '<button type="button" class="btn ghost sm" data-pop="done">Done</button>' +
      "</div>";
    document.body.appendChild(pop);

    // Anchored to the cell, then nudged back inside the viewport — the
    // right-hand columns of a wide board are otherwise off-screen.
    var r = td.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if(top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = left + "px";
    pop.style.top = top + "px";

    function apply(ids){
      setScope(scope, ids);
      paintCells();
    }
    pop.addEventListener("change", function(e){
      var cb = e.target;
      if(!cb || !cb.dataset || !cb.dataset.modeId) return;
      var ids = scopeView(scope).slice();
      var i = ids.indexOf(cb.dataset.modeId);
      if(cb.checked){ if(i === -1) ids.push(cb.dataset.modeId); }
      else if(i !== -1) ids.splice(i, 1);
      apply(ids);
    });
    pop.addEventListener("click", function(e){
      var b = e.target.closest ? e.target.closest("[data-pop]") : null;
      if(!b) return;
      if(b.dataset.pop === "done") return closePop();
      var wanted = b.dataset.pop === "all";
      var ids = scopeView(scope).slice();
      // "all" adds what is on offer; "none" clears the retired ones too.
      var touch = WordLists.idsOfList(fam.key, col.n);
      if(!wanted) touch = touch.concat(retiredIdsOf(fam.key, col.n));
      touch.forEach(function(id){
        var i = ids.indexOf(id);
        if(wanted){ if(i === -1) ids.push(id); }
        else if(i !== -1) ids.splice(i, 1);
      });
      Array.prototype.forEach.call(pop.querySelectorAll("input[data-mode-id]"), function(cb){
        if(!wanted) cb.checked = false;
        else if(!WordLists.isRetired(cb.dataset.modeId)) cb.checked = true;
      });
      apply(ids);
    });
    var first = pop.querySelector("input");
    if(first) first.focus();
  }

  /* ── column toggles ───────────────────────────────────────────────
     "all" on a column sets every mode of that list for every VISIBLE
     student — not every student in the school. The period filter and the
     search box are what bound it, and that is the only thing standing
     between a mis-click and a class's worth of undone assignment. */
  // The retired ids of one family (listNum null) or one list of it.
  function retiredIdsOf(familyKey, listNum){
    return WordLists.all.filter(function(l){
      return l.retired && l.family === familyKey && (listNum == null || l.listNum === listNum);
    }).map(function(l){ return l.id; });
  }
  function columnToggle(col){
    var ids = col.summary ? WordLists.idsOfFamily(col.fam.key) : WordLists.idsOfList(col.fam.key, col.n);
    // Ticking never adds a retired id; unticking clears one, or the cell
    // would still show an icon after "untick every student".
    var gone = ids.concat(retiredIdsOf(col.fam.key, col.summary ? null : col.n));
    var rows = visibleStudents();
    if(!rows.length) return;
    var allOn = rows.every(function(s){
      var set = liveStudent(s.uid);
      return ids.every(function(id){ return set.indexOf(id) !== -1; });
    });
    rows.forEach(function(s){
      var set = liveStudent(s.uid).slice();
      ids.forEach(function(id){
        var i = set.indexOf(id);
        if(!allOn && i === -1) set.push(id);
      });
      if(allOn) gone.forEach(function(id){
        var i = set.indexOf(id);
        if(i !== -1) set.splice(i, 1);
      });
      setScope("s:" + s.uid, set);
    });
    paintCells();
  }

  /* ── ready to move up ─────────────────────────────────────────────
     A student who has finished Red List 3 should be on List 4, and the
     only thing standing between those two facts is somebody noticing.
     For a class moving together that's fine; for the three students who
     are ahead it is exactly the kind of thing that doesn't get done, and
     they spend a fortnight re-practising words they already know.

     So the board works it out and says so. It does NOT act on it: a
     suggestion goes into the same draft every other edit does and waits
     for the same Save. That is deliberate on two counts. Auto-advancing
     would move a student on the strength of a scoring heuristic with
     nobody who has met them in the loop — and "solid" here means solid on
     a screen, which is not always solid on paper. And the arithmetic runs
     on the TEACHER's page, which is where the decision belongs;
     firestore.rules is what actually holds that line (a student can read
     assignments/{uid} and never write it), but there is no reason to ship
     the policy to their browser either.

     The suggestion is additive. It does not take the finished list away:
     each list is its own tile with its own adaptive deck, so keeping List
     3 alongside List 4 costs a student nothing and keeps the old words in
     rotation. Dropping one is a judgement call, and it stays the
     teacher's. */

  // The share of a list's words that have to be solid before the next one
  // is worth putting on. Not 100%: one stubborn word — a name, a word
  // whose recording is poor — should not be able to hold a student on a
  // list for a term. Four in five, and the fifth keeps coming round.
  // Aliased, not redefined: adaptive.js owns the number beside the
  // function that measures against it.
  var SOLID_ENOUGH = Adaptive.solidEnough;

  /* How far through one list a student is. `share` comes from
     Adaptive.listShare, so the bar a suggestion is measured against and
     the numbers printed beside it are the same arithmetic.

     Solid AND at pace: a word a student gets right after three seconds
     of decoding is not one they can move on from, and suggesting the
     next list on the strength of thirty of them is how somebody ends up
     two lists ahead of their reading. */
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

  /* Pure. Given one student's stats and the lists they actually have,
     which families are they ready to move up in? Only families with more
     than one list can advance — there is nowhere for "Blend Words" to go
     — and each mode advances on its own, because a student can be solid
     on List 3 as flash cards and still be finding it in Match It. */
  function readyToAdvance(stats, ids){
    var have = {};
    (ids || []).forEach(function(id){ have[id] = true; });
    var out = [];
    WordLists.families().forEach(function(fam){
      if(fam.lists.length < 2) return;
      WordLists.modesOf(fam.key).forEach(function(m){
        // The furthest list they have in this mode. Anything below it is
        // already assigned, so advancing from there would suggest a list
        // they have; anything above it doesn't exist yet.
        var mine = WordLists.listNumsOf(fam.key).filter(function(n){
          var id = WordLists.idFor(fam.key, n, m.key);
          return id && have[id];
        });
        if(!mine.length) return;
        var from = mine[mine.length - 1];
        var fromId = WordLists.idFor(fam.key, from, m.key);
        var toId = WordLists.idFor(fam.key, from + 1, m.key);
        // A suggestion only ever adds something on offer.
        if(!toId || have[toId] || WordLists.isRetired(toId)) return;
        var p = listProgress(stats, fromId);
        if(p.share < SOLID_ENOUGH) return;
        out.push({
          family: fam.key, famTitle: fam.title,
          mode: m.key, modeIcon: m.icon, modeTitle: m.title,
          from: from, to: from + 1, fromId: fromId, toId: toId,
          // `fluent` is the number the bar was measured against; the
          // strip prints THAT, so the evidence it shows is the evidence
          // that fired it. `mastered` still includes the slow words.
          mastered: p.mastered, slow: p.slow, fluent: p.fluent, total: p.total
        });
      });
    });
    return out;
  }

  /* Every suggestion on the board right now, for the students the filter
     leaves visible — the same bound the column toggles work inside. */
  function boardSuggestions(){
    var out = [];
    visibleStudents().forEach(function(s){
      readyToAdvance(s.stats, liveStudent(s.uid)).forEach(function(sug){
        sug.uid = s.uid;
        sug.name = s.name || s.email || s.uid;
        out.push(sug);
      });
    });
    return out;
  }

  function applySuggestion(sug){
    var set = liveStudent(sug.uid).slice();
    if(set.indexOf(sug.toId) === -1) set.push(sug.toId);
    setScope("s:" + sug.uid, set);
  }

  /* The parenthetical after "finished List 2". The count is the FLUENT
     one — solid and at pace — because that is what the four-in-five bar
     was measured against; printing `mastered` here would show a number
     the bar never saw, and a teacher would rightly ask why 20 of 20
     needed a nudge. Slow-but-right words are named beside it as "more",
     so nobody reads them as part of the 18. Where nothing is slow the
     two counts are the same and the line reads as it always has. */
  function evidenceText(g){
    return g.fluent + " of " + g.total + " solid" +
      (g.slow ? ", " + g.slow + " more slow" : "");
  }

  function suggestionsHtml(sugs){
    if(!sugs.length) return "";
    var rows = sugs.map(function(g, i){
      return '<li class="abSug">' +
        '<span class="abSugWho">' + esc(g.name) + "</span>" +
        '<span class="abSugWhat">' + esc(g.famTitle + " " + g.modeIcon) +
          " · finished <b>List " + g.from + "</b> " +
          '<span class="muted tiny">(' + evidenceText(g) + ")</span></span>" +
        '<span class="abSugTo">add <b>List ' + g.to + "</b></span>" +
        '<button type="button" class="btn ghost sm" data-sug="' + i + '">Add it</button>' +
        "</li>";
    }).join("");
    // Suggestions and students are different counts — one student solid
    // on both the cards and the Match It of a list makes two rows — and
    // the sentence is about the students.
    var who = {}, n = 0;
    sugs.forEach(function(g){ if(!who[g.uid]){ who[g.uid] = true; n++; } });
    return '<div class="panel abReady"><h2>Ready to move up</h2>' +
      '<p class="note">' + n + (n === 1 ? " student has" : " students have") +
      " finished a list. “Add it” puts the next one on the board below — it isn't saved until you press Save, " +
      "and the finished list stays so those words keep coming round.</p>" +
      '<ul class="abSugs">' + rows + "</ul>" +
      (sugs.length > 1 ? '<div class="rowActions"><button class="btn sm" id="abSugAll">Add all ' + sugs.length + "</button></div>" : "") +
      "</div>";
  }

  /* ── the board ──────────────────────────────────────────────────── */
  function renderAssign(){
    if(!students.length){
      $("tBody").innerHTML = '<div class="panel"><h2>Nobody yet</h2>' +
        '<p class="note">A student appears here the first time they sign in. Until then there is nothing to assign to.</p></div>';
      return;
    }

    var periods = allPeriods();
    // The period filter is the top bar's, and falls back to All on its
    // own (boardPeriod) when it would match nobody.
    var cols = boardColumns();
    var vis = visibleStudents();
    var visUid = {}; vis.forEach(function(s){ visUid[s.uid] = true; });

    // ---- header: a family row above a list row ----
    var famHead = "", listHead = "";
    WordLists.families().forEach(function(fam){
      var mine = [];
      cols.forEach(function(c, i){ if(c.fam.key === fam.key) mine.push(i); });
      if(!mine.length) return;
      var folded = !!board.collapsed[fam.key];
      // The label is stuck to the left edge of its own span of columns, so
      // scrolling into the middle of the red words still says "Red Words"
      // rather than leaving the header blank.
      famHead += '<th colspan="' + mine.length + '" class="abFam">' +
        '<span class="abFamIn">' +
          '<button type="button" class="abFold" data-fold="' + esc(fam.key) + '" title="' +
            (folded ? "Show every list in this group" : "Collapse this group into one column") + '">' +
            (folded ? "▸" : "▾") + "</button>" +
          esc(fam.icon + " " + fam.title) +
        "</span></th>";
      mine.forEach(function(i){
        var c = cols[i];
        var anyId = c.summary ? WordLists.idsOfFamily(fam.key)[0] : WordLists.idsOfList(fam.key, c.n)[0];
        var preview = anyId ? WordLists.wordsOf(anyId).slice(0, 4).join(", ") + "…" : "";
        // A family with one list has already been named in the row above,
        // so its column says nothing but its words; a family with ten has
        // to number them.
        var name = c.summary ? WordLists.listNumsOf(fam.key).length + " lists"
                 : fam.lists.length > 1 ? "List " + c.n
                 : "";
        listHead += '<th class="abCol">' +
          (name ? '<span class="abColName">' + esc(name) + "</span>" : "") +
          (c.summary ? "" : '<span class="abColWords">' + esc(preview) + "</span>") +
          '<button type="button" class="pkMini" data-col="' + i + '" title="Tick or untick ' +
            (c.summary ? "every list in this group" : "this list") + ' for every student shown">all</button>' +
          "</th>";
      });
    });

    // ---- rows ----
    function cellsFor(scope){
      return cols.map(function(c, i){
        return '<td class="abCell" data-cell="' + esc(scope) + "|" + i + '" tabindex="0"></td>';
      }).join("");
    }
    function studentRow(s){
      var scope = "s:" + s.uid;
      var n = noteOf(s.uid);
      var name = esc(s.name || s.email || s.uid) +
        (n ? ' <span class="noteDot" title="' + esc(n) + '">✎</span>' : "");
      return '<tr class="abStudent' + (s.pending ? " pending" : "") + '" data-row="' + esc(scope) + '">' +
        '<th class="abName"><div class="abNameIn">' +
          '<label class="abPick"><input type="checkbox" data-pick="' + esc(s.uid) + '"' +
            (board.sel[s.uid] ? " checked" : "") + '><span class="abLabel">' + name + "</span></label>" +
          '<div class="abMeta"><span class="abGames" data-count="' + esc(s.uid) + '"></span>' +
            (s.pending ? ' · <span class="muted">not signed in yet</span>' : "") + "</div>" +
        "</div></th>" + cellsFor(scope) + "</tr>";
    }
    /* A period's heading row. Its checkbox ticks every student shown
       under it, which is how "give period 3 List 4" becomes two clicks
       and a choice rather than thirty. */
    function groupRow(key, label, kids){
      var allOn = kids.length && kids.every(function(s){ return board.sel[s.uid]; });
      return '<tr class="abGroup"><th class="abName"><div class="abNameIn">' +
          '<label class="abPick"><input type="checkbox" data-pickgroup="' + esc(key) + '"' + (allOn ? " checked" : "") +
            ' aria-label="Select everyone in ' + esc(label) + '"><span class="abLabel">' + esc(label) + "</span></label>" +
          '<div class="abMeta">' + kids.length + (kids.length === 1 ? " student" : " students") + "</div>" +
        '</div></th><td colspan="' + cols.length + '"></td></tr>';
    }
    var groups = [];   // [{ key, kids }] — what each heading's checkbox reaches

    var rows = "";
    periods.filter(function(p){
      return boardPeriod() === "" || boardPeriod() === p;
    }).forEach(function(p){
      var kids = vis.filter(function(s){ return studentPeriod(s.uid) === p; });
      if(!kids.length) return;
      groups.push({ key: p, kids: kids });
      rows += groupRow(p, "Period " + p, kids) + kids.map(studentRow).join("");
    });

    var loose = vis.filter(function(s){ return studentPeriod(s.uid) === null; });
    if(loose.length && (boardPeriod() === "" || boardPeriod() === NO_PERIOD)){
      groups.push({ key: NO_PERIOD, kids: loose });
      rows += groupRow(NO_PERIOD, "No period yet", loose) + loose.map(studentRow).join("");
    }
    if(!rows){
      rows = '<tr><td colspan="' + (cols.length + 1) + '" class="muted" style="padding:18px">Nobody matches that.</td></tr>';
    }

    var nSel = Object.keys(board.sel).filter(function(u){ return board.sel[u] && visUid[u]; }).length;
    var bare = vis.filter(function(s){ return !liveStudent(s.uid).length; }).length;
    var sugs = boardSuggestions();

    $("tBody").innerHTML =
      suggestionsHtml(sugs) +
      '<div class="panel abPanel"><h2>Assign games</h2>' +
        '<p class="note">Each student sees only what is in their row. ' +
        "<b>Click a cell</b> to choose how they play that list. " +
        "To change many students at once, <b>tick their names</b> — or a whole period — and press <b>Change games</b>. " +
        "The period buttons at the top choose who is shown. " +
        "Nothing is saved until you press <b>Save</b>.</p>" +
        legendHtml() +

        '<div class="abTools">' +
          '<input class="txt" id="abQ" placeholder="Find a student" aria-label="Find a student" value="' + esc(board.q) + '" style="width:190px">' +
          '<label class="check abAll"><input type="checkbox" id="abSelAll"' + (vis.length && nSel === vis.length ? " checked" : "") + ">" +
            "<span>Select all " + vis.length + " shown</span></label>" +
          '<button class="btn sm" id="abBulk"' + (nSel ? "" : " disabled") + ">Change games for " + nSel + " selected…</button>" +
          (nSel ? '<button class="btn ghost sm" id="abSelNone">Clear selection</button>' : "") +
        "</div>" +
        (bare ? '<p class="abWarn">' + bare + (bare === 1 ? " student" : " students") +
          " shown " + (bare === 1 ? "has" : "have") + " no games yet — their home page is empty.</p>" : "") +

        '<div class="abScroll"><table class="abGrid" id="abGrid">' +
          '<thead><tr><th class="abName abCorner" rowspan="2">Student</th>' + famHead + "</tr>" +
          "<tr>" + listHead + "</tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table></div>" +
      "</div>" +

      '<div class="abBar" id="abBar" hidden>' +
        '<span class="abCount" id="abCount"></span>' +
        '<span class="saveNote" id="abNote"></span>' +
        '<button class="btn ghost sm" id="abDiscard">Discard</button>' +
        '<button class="btn sm" id="abSave">Save</button>' +
      "</div>";

    paintCells();
    bindAssign(cols, groups);
    bindSuggestions(sugs);
  }

  function bindSuggestions(sugs){
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-sug]"), function(b){
      b.addEventListener("click", function(){
        applySuggestion(sugs[Number(b.dataset.sug)]);
        // A full re-render, not a repaint: the suggestion this came from
        // has just stopped being true and its row has to go.
        renderAssign();
      });
    });
    var all = $("abSugAll");
    if(all) all.addEventListener("click", function(){
      sugs.forEach(applySuggestion);
      renderAssign();
    });
  }

  function bindAssign(cols, groups){
    var grid = $("abGrid");

    grid.addEventListener("click", function(e){
      var t = e.target;
      var fold = t.closest ? t.closest("[data-fold]") : null;
      if(fold){
        var k = fold.dataset.fold;
        board.collapsed[k] = !board.collapsed[k];
        closePop();
        return renderAssign();
      }
      var colBtn = t.closest ? t.closest("[data-col]") : null;
      if(colBtn) return columnToggle(cols[Number(colBtn.dataset.col)]);
      // A row's or a period's own checkbox, or the name beside it.
      if(t.closest && t.closest(".abPick")) return;
      var cell = t.closest ? t.closest("[data-cell]") : null;
      if(!cell) return;
      var parts = cell.dataset.cell.split("|");
      var col = cols[Number(parts[1])];
      // A folded family has no single list to tick, so a click opens it
      // back up rather than guessing which of its ten was meant.
      if(col.summary){
        board.collapsed[col.fam.key] = false;
        return renderAssign();
      }
      openPop(cell, parts[0], col);
    });

    /* Keyboard: Enter and Space open a cell's modes, the arrows walk the
       grid, Home and End jump to the ends of a row. Fifteen columns is
       further than anybody wants to press Tab, and a teacher setting up a
       period should not have to reach for the mouse between every cell. */
    var STEP = {
      ArrowLeft:  [0, -1], ArrowRight: [0, 1],
      ArrowUp:    [-1, 0], ArrowDown:  [1, 0]
    };
    grid.addEventListener("keydown", function(e){
      var cell = e.target.closest ? e.target.closest("[data-cell]") : null;
      if(!cell) return;
      if(e.key === "Enter" || e.key === " "){
        e.preventDefault();
        cell.click();
        return;
      }
      // Rows that actually hold cells: a period's heading is a row too,
      // and arrowing down should skip straight over it.
      var rows = Array.prototype.filter.call(grid.querySelectorAll("tbody tr"), function(tr){
        return !!tr.querySelector("[data-cell]");
      });
      var here = rows.indexOf(cell.parentNode);
      var cells = Array.prototype.slice.call(cell.parentNode.querySelectorAll("[data-cell]"));
      var col = cells.indexOf(cell);
      var target = null;

      if(e.key === "Home") target = cells[0];
      else if(e.key === "End") target = cells[cells.length - 1];
      else if(STEP[e.key]){
        var d = STEP[e.key];
        if(d[0]){
          var row = rows[here + d[0]];
          if(row){
            var into = row.querySelectorAll("[data-cell]");
            target = into[Math.min(col, into.length - 1)];
          }
        } else {
          target = cells[col + d[1]];
        }
      }
      if(!target) return;
      e.preventDefault();
      closePop();
      target.focus();
      // "nearest" so a keypress nudges the grid rather than jumping it,
      // and so the page itself doesn't scroll out from under the board.
      if(target.scrollIntoView) target.scrollIntoView({ block:"nearest", inline:"nearest" });
    });

    grid.addEventListener("change", function(e){
      var cb = e.target;
      if(!cb.dataset) return;
      if(cb.dataset.pick !== undefined){
        board.sel[cb.dataset.pick] = cb.checked;
        return renderAssign();
      }
      if(cb.dataset.pickgroup !== undefined){
        var g = groups.filter(function(x){ return x.key === cb.dataset.pickgroup; })[0];
        if(g) g.kids.forEach(function(s){ board.sel[s.uid] = cb.checked; });
        return renderAssign();
      }
    });


    // Re-rendering on every keystroke would throw focus out of the box,
    // so the board is filtered once the teacher stops typing.
    var qTimer = null;
    $("abQ").addEventListener("input", function(){
      clearTimeout(qTimer);
      var v = this.value;
      qTimer = setTimeout(function(){
        board.q = v;
        closePop();
        renderAssign();
        var box = $("abQ");
        if(box){ box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      }, 300);
    });

    $("abSelAll").addEventListener("change", function(){
      var on = this.checked;
      visibleStudents().forEach(function(s){ board.sel[s.uid] = on; });
      renderAssign();
    });
    // The popover is position:fixed against the cell it was opened on, so
    // scrolling the grid out from under it would leave it floating over
    // somebody else's row.
    document.querySelector(".abScroll").addEventListener("scroll", closePop, { passive:true });
    $("abBulk").addEventListener("click", openBulk);
    if($("abSelNone")) $("abSelNone").addEventListener("click", function(){
      board.sel = {};
      renderAssign();
    });
    $("abDiscard").addEventListener("click", function(){
      board.draft = {};
      closePop();
      renderAssign();
    });
    $("abSave").addEventListener("click", saveBoard);
  }

  /* Bound once, on <body>, rather than per render: the popover and the
     modal both outlive any single repaint of the grid. */
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ closePop(); closeBulk(); closePreviewPop(); }
  });
  document.addEventListener("click", function(e){
    if(!pop || pop.contains(e.target)) return;
    if(e.target.closest && e.target.closest("[data-cell]")) return;
    closePop();
  }, true);

  /* ── changing many at once ─────────────────────────────────────────
     Tick students, press the button, tick some lists, and say what to do
     with them: add them to what each student already has, take them
     away, or replace each student's games outright. "Add" is the common
     case — moving a period onto List 4 shouldn't wipe the oi/oy cards
     half of them are still on — so it comes first and starts from an
     empty picker rather than from somebody's existing set. */
  function bulkApply(current, ids, how){
    var out = (current || []).slice();
    // Adding or replacing never hands out a retired id a student doesn't
    // already have; taking it away is the one thing a bulk change does with one.
    if(how !== "remove") ids = ids.filter(function(id){ return !WordLists.isRetired(id) || out.indexOf(id) !== -1; });
    if(how === "replace") return ids.slice();
    ids.forEach(function(id){
      var i = out.indexOf(id);
      if(how === "add"){ if(i === -1) out.push(id); }
      else if(how === "remove"){ if(i !== -1) out.splice(i, 1); }
    });
    return out;
  }

  // The retired ids any of these students still hold, so the bulk dialog can
  // draw a box for each and "Take these away" can clear them.
  function heldRetired(uids){
    var seen = {};
    uids.forEach(function(u){
      liveStudent(u).forEach(function(id){ if(WordLists.isRetired(id)) seen[id] = true; });
    });
    return Object.keys(seen);
  }
  var bulkWrap = null;
  function closeBulk(){
    if(bulkWrap && bulkWrap.parentNode) bulkWrap.parentNode.removeChild(bulkWrap);
    bulkWrap = null;
  }
  function openBulk(){
    var uids = visibleStudents().map(function(s){ return s.uid; }).filter(function(u){ return board.sel[u]; });
    if(!uids.length) return;
    closeBulk();
    var names = uids.map(function(u){
      var s = studentByUid(u);
      return s ? (s.name || s.email) : u;
    });
    var who = uids.length + (uids.length === 1 ? " student" : " students");

    bulkWrap = document.createElement("div");
    bulkWrap.className = "abModal";
    bulkWrap.innerHTML =
      '<div class="abModalBox" role="dialog" aria-modal="true" aria-labelledby="abBulkTitle">' +
        '<h2 id="abBulkTitle">Change games for ' + who + "</h2>" +
        '<p class="note">' + esc(names.slice(0, 6).join(", ")) + (names.length > 6 ? " and " + (names.length - 6) + " more" : "") +
        ". Tick the games, then choose what to do with them.</p>" +
        pickerHtml("bulk", [], heldRetired(uids)) +
        '<div class="rowActions stickyActions">' +
          '<button class="btn sm" data-bulk="add">Add to what they have</button>' +
          '<button class="btn ghost sm" data-bulk="remove">Take these away</button>' +
          '<button class="btn ghost sm" data-bulk="replace">Replace all their games</button>' +
          '<button class="btn ghost sm" id="abCancel">Cancel</button>' +
          '<span class="saveNote err" id="abBulkNote"></span>' +
        "</div>" +
        '<p class="note tiny">This changes the board. Nothing is saved until you press Save.</p>' +
      "</div>";
    document.body.appendChild(bulkWrap);
    bindPickers(bulkWrap);
    bulkWrap.addEventListener("click", function(e){
      if(e.target === bulkWrap) return closeBulk();
      var b = e.target.closest ? e.target.closest("[data-bulk]") : null;
      if(!b) return;
      var ids = scopeSelection("bulk");
      if(!ids.length){
        document.getElementById("abBulkNote").textContent = "Tick at least one game first.";
        return;
      }
      uids.forEach(function(u){ setScope("s:" + u, bulkApply(liveStudent(u), ids, b.dataset.bulk)); });
      closeBulk();
      renderAssign();
    });
    document.getElementById("abCancel").addEventListener("click", closeBulk);
  }

  /* ── saving ───────────────────────────────────────────────────────
     One batch. A teacher moving six students onto List 4 should not be
     able to end up with three of them moved: either the whole board
     lands or none of it does, and a failure puts every local copy back
     exactly as it was, with the draft intact so they can retry without
     re-ticking anything. */
  /* What the pending edits amount to on the wire, as data rather than as
     calls: one `assignments/{uid}` merge per changed student, or — for a
     student who hasn't signed in yet and so has no uid — one merge onto
     their roster row, which store.js reads on the first sign-in. Pure, and
     separate from saveBoard, because the shape of these writes is the part
     that has to be right: a stray field in the student body would
     overwrite their period. `now` is a parameter so a test can pin it. */
  function saveBody(scopes, now){
    var out = { students: {}, roster: {} };
    scopes.forEach(function(scope){
      var uid = scope.slice(2), val = board.draft[scope];
      // `teacher` rides along because firestore.rules requires every
      // write to name the owner; it is the owner already on the doc.
      if(isPending(uid)) out.roster[emailOfPending(uid)] = { lists: val, updatedAt: now, teacher: ownerOfUid(uid) };
      // These fields and no others: the period lives in the same
      // document and must survive the write.
      else out.students[uid] = { lists: val, updatedAt: now, teacher: ownerOfUid(uid) };
    });
    return out;
  }

  function saveBoard(){
    var scopes = dirtyScopes();
    if(!scopes.length) return;
    var note = $("abNote");
    var undo = { students: {}, roster: {} };
    var body = saveBody(scopes, Date.now());
    var batch = db.batch();

    // Local state moves first, so the board redraws without waiting on
    // school Wi-Fi; `undo` is what puts it all back if the batch fails.
    Object.keys(body.students).forEach(function(uid){
      undo.students[uid] = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
      var a = assignments[uid] || (assignments[uid] = {});
      a.lists = body.students[uid].lists;
      a.updatedAt = body.students[uid].updatedAt;
      a.teacher = body.students[uid].teacher;
      batch.set(db.collection("assignments").doc(uid), body.students[uid], { merge:true });
    });
    Object.keys(body.roster).forEach(function(em){
      undo.roster[em] = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
      if(!roster[em]) roster[em] = { email: em };
      roster[em].lists = body.roster[em].lists;
      batch.set(db.collection("roster").doc(em), body.roster[em], { merge:true });
    });

    if(note){ note.className = "saveNote"; note.textContent = "Saving…"; }
    batch.commit().then(function(){
      board.draft = {};
      closePop();
      renderAssign();
      // renderAssign rebuilt the bar, so the "Saved." goes on the new one
      // and holds it open long enough to be read.
      var bar = $("abBar"), n2 = $("abNote");
      if(n2){ n2.className = "saveNote ok"; n2.textContent = "Saved."; }
      if(bar) bar.hidden = false;
      setTimeout(paintSaveBar, 2500);
    }).catch(function(){
      for(var u in undo.students){
        if(undo.students[u]) assignments[u] = undo.students[u]; else delete assignments[u];
      }
      for(var e in undo.roster){
        if(undo.roster[e]) roster[e] = undo.roster[e]; else delete roster[e];
      }
      if(note){ note.className = "saveNote err"; note.textContent = "Nothing saved — check the network and try again."; }
    });
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
    var gone = splitArchived(everyone, classCfg.archived).archived;
    var rows = gone.map(function(st){
      var per = studentPeriod(st.uid);
      return "<tr><td>" + whoHtml(st) + "</td>" +
        "<td>" + (per ? '<span class="pill">Period ' + esc(per) + "</span>" : '<span class="muted tiny">\u2014</span>') + "</td>" +
        '<td><button class="btn ghost sm" data-unarchive="' + esc(st.uid) + '">Unarchive</button> ' +
        '<button class="btn ghost sm" data-open="' + esc(st.uid) + '">Open</button></td></tr>';
    }).join("");
    into.innerHTML = '<div class="panel"><h2>Archived</h2>' +
      '<p class="note">Archived students are hidden from every view — the table, the board, the cards, Trouble spots. ' +
      "Nothing about them is deleted, and they keep practicing whatever they were given. " +
      "Archive a student from their own page.</p>" +
      (rows ? '<div class="tableScroll"><table class="t"><thead><tr><th>Student</th><th>Period</th><th></th></tr></thead>' +
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
     it): a teacher's roster rows, assignments, notes, students' docs and
     classes doc; for the admin, every collection. For keeping, not for
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
      scope: admin ? "everything (admin)" : "this teacher's class",
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
    jobs.push(admin ? docs(db.collection("classes")) : one(classRef()));
    if(admin){
      jobs.push(docs(db.collection("teachers")));
      jobs.push(one(db.collection("config").doc("class")).catch(function(){ return {}; }));
    }
    return Promise.all(jobs).then(function(r){
      var out = {};
      cols.forEach(function(c, i){ out[c] = r[i]; });
      out.classes = r[4];
      if(admin){ out.teachers = r[5]; out.config = r[6]; }
      return out;
    });
  }
  function renderBackupSection(into){
    into.innerHTML = '<div class="panel"><h2>Backup</h2>' +
      '<p class="note">One file of everything ' + (admin ? "in the database — every teacher\u2019s class" : "about your class") +
      ": the roster, every student\u2019s practice record, their games, your notes and your periods. " +
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

     Who else can use this dashboard, how many students each has, and
     moving students between them. Adding a teacher is one
     teachers/{email} document; it grants them their own students and
     nobody else's (firestore.rules). Removing one deletes only that
     document: their students stay owned by that address, and show up
     here under it, until the admin moves them.
     ════════════════════════════════════════════════════════════════ */

  // Every teacher address the admin might move a student to: the admin,
  // each teachers/ doc, and any owner still on a student (a removed
  // teacher's class has to be reachable to be moved out of).
  function teacherChoices(){
    var seen = {}, out = [];
    function add(e){ e = String(e || "").toLowerCase(); if(e && !seen[e]){ seen[e] = true; out.push(e); } }
    add(adminEmail() || me);
    teacherDocs.forEach(function(t){ add(t.email); });
    everyone.forEach(function(st){ add(ownerOf(st)); });
    return out;
  }
  function teacherOptions(selected){
    var listed = {};
    teacherDocs.forEach(function(t){ listed[t.email] = true; });
    return teacherChoices().map(function(e){
      var gone = e !== (adminEmail() || me) && !listed[e];
      return '<option value="' + esc(e) + '"' + (e === selected ? " selected" : "") + ">" +
        esc(teacherName(e) + (gone ? " (removed)" : "")) + "</option>";
    }).join("");
  }

  // Pure: students per owner, archived or not, signed in or not.
  function teacherCounts(){
    var out = {};
    everyone.forEach(function(st){ var o = ownerOf(st); out[o] = (out[o] || 0) + 1; });
    return out;
  }

  /* Pure: the writes that move these students to `to`. Four documents
     per student, all set-merges of the one field, so the batch can't
     touch anything else:
       roster/{email}     the record of ownership — what store.js copies
                          and what stops another teacher's import
       students/{uid}     so the new teacher's list query finds them
                          (the admin may change exactly this field)
       assignments/{uid}  and notes/{uid} — written even when missing,
                          so a student who has ever been moved always has
                          documents whose owner the rules check
     A pending student has no uid yet: their roster row is everything. */
  function moveBody(list, to){
    to = String(to || "").toLowerCase();
    var out = [];
    list.forEach(function(st){
      var email = String(st.email || "").toLowerCase();
      if(email){
        var row = { teacher: to };
        // A signed-in student with no roster row gets one, named, so the
        // move is recorded where ownership is read from.
        if(!roster[email] && st.name) row.name = st.name;
        out.push({ col: "roster", id: email, data: row });
      }
      if(st.pending) return;
      out.push({ col: "students", id: st.uid, data: { teacher: to } });
      out.push({ col: "assignments", id: st.uid, data: { teacher: to } });
      out.push({ col: "notes", id: st.uid, data: { teacher: to } });
    });
    return out;
  }

  /* Writes, then mirrors the move locally rather than reloading — the
     admin sees everyone either way, so nothing appears or disappears. */
  function moveStudents(list, to){
    to = String(to || "").toLowerCase();
    return commitWrites(moveBody(list, to)).then(function(){
      list.forEach(function(st){
        var email = String(st.email || "").toLowerCase();
        if(email){
          if(!roster[email]) roster[email] = rosterRowOf(email, { name: st.name });
          roster[email].teacher = to;
        }
        st.teacher = to;
        if(!st.pending){
          (assignments[st.uid] = assignments[st.uid] || {}).teacher = to;
          (notes[st.uid] = notes[st.uid] || {}).teacher = to;
        }
      });
    });
  }

  function renderTeachers(into){
    if(!admin) return;
    var counts = teacherCounts();
    var listed = {};
    teacherDocs.forEach(function(t){ listed[t.email] = true; });
    var adminAddr = adminEmail() || me;

    var rows = teacherChoices().map(function(e){
      var t = teacherDocs.filter(function(x){ return x.email === e; })[0];
      var isAdminRow = e === adminAddr;
      var gone = !isAdminRow && !t;
      return "<tr><td><b>" + esc(t && t.name ? t.name : e) + "</b>" +
          '<div class="muted tiny">' + esc(e) + (isAdminRow ? " · admin" : "") + (gone ? " · removed" : "") + "</div></td>" +
        '<td class="num">' + (counts[e] || 0) + "</td>" +
        "<td>" + (isAdminRow || gone ? "" :
          '<button class="btn ghost sm" data-unteach="' + esc(e) + '">Remove</button>') + "</td></tr>";
    }).join("");

    var periods = allPeriods();
    into.innerHTML =
      '<div class="panel"><h2>Teachers</h2>' +
        '<p class="note">Each teacher sees only their own students. You see everyone. ' +
        "A student belongs to whoever imported them; an import never takes a student from another teacher, " +
        "so moving one is done here, or on the student's own page.</p>" +
        '<div class="tableScroll"><table class="t"><thead><tr><th>Teacher</th><th class="num">Students</th><th></th></tr></thead>' +
        "<tbody>" + rows + "</tbody></table></div>" +
      "</div>" +

      '<div class="panel"><h2>Add a teacher</h2>' +
        '<p class="note">Their school Google account. They can open the dashboard the next time they sign in, ' +
        "and start with an empty class until they import a roster.</p>" +
        '<div class="rowActions">' +
          '<input class="txt" id="tTeachEmail" placeholder="name@seq.org" aria-label="Teacher email" autocomplete="off" style="width:220px">' +
          '<input class="txt" id="tTeachName" placeholder="Name, e.g. Ms. Talesnick" aria-label="Teacher name" autocomplete="off" style="width:220px">' +
          '<button class="btn sm" id="tTeachAdd">Add teacher</button>' +
          '<span class="saveNote" id="tTeachNote"></span>' +
        "</div>" +
      "</div>" +

      '<div class="panel"><h2>Move a whole period</h2>' +
        '<p class="note">Everyone in one period, to another teacher. Their games, notes and practice go with them.</p>' +
        '<div class="rowActions">' +
          '<label class="muted tiny" for="tMovePeriod">Everyone in</label>' +
          '<select class="sel" id="tMovePeriod">' + periods.map(function(p){
            return '<option value="' + esc(p) + '">Period ' + esc(p) + "</option>";
          }).join("") + '<option value="' + NO_PERIOD + '">No period yet</option></select>' +
          '<label class="muted tiny" for="tMoveFrom">now with</label>' +
          '<select class="sel" id="tMoveFrom"><option value="">any teacher</option>' + teacherOptions("") + "</select>" +
          '<label class="muted tiny" for="tMoveTo">to</label>' +
          '<select class="sel" id="tMoveTo">' + teacherOptions("") + "</select>" +
          '<button class="btn sm" id="tMoveGo">Move</button>' +
          '<span class="saveNote" id="tMoveNote"></span>' +
        "</div>" +
      "</div>";

    $("tTeachAdd").addEventListener("click", addTeacher);
    $("tTeachName").addEventListener("keydown", function(e){ if(e.key === "Enter") addTeacher(); });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-unteach]"), function(b){
      b.addEventListener("click", function(){ removeTeacher(b.getAttribute("data-unteach")); });
    });
    $("tMoveGo").addEventListener("click", movePeriod);
  }

  // Who a bulk move reaches. Pure over the class: period, then (if
  // chosen) the teacher they're with now.
  function periodMovers(period, from){
    // Archived students move with their period: hidden is not left behind.
    return everyone.filter(function(st){
      var p = studentPeriod(st.uid);
      if(period === NO_PERIOD ? p !== null : p !== period) return false;
      return !from || ownerOf(st) === from;
    });
  }

  function movePeriod(){
    var period = $("tMovePeriod").value, from = $("tMoveFrom").value, to = $("tMoveTo").value;
    var note = $("tMoveNote");
    var who = periodMovers(period, from).filter(function(st){ return ownerOf(st) !== to; });
    if(!who.length){ note.className = "saveNote err"; note.textContent = "Nobody to move."; return; }
    var label = period === NO_PERIOD ? "with no period" : "in period " + period;
    if(!window.confirm("Move " + who.length + (who.length === 1 ? " student " : " students ") + label +
                       " to " + teacherName(to) + "?")) return;
    note.className = "saveNote"; note.textContent = "Moving…";
    moveStudents(who, to).then(function(){
      render();
      var n2 = $("tMoveNote");
      if(n2){ n2.className = "saveNote ok"; n2.textContent = "Moved " + who.length + "."; }
    }, function(){
      note.className = "saveNote err"; note.textContent = "Didn't move — check the network and try again.";
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
    var n = teacherCounts()[email] || 0;
    if(!window.confirm("Remove " + teacherName(email) + " as a teacher?\n\n" +
      "They lose the dashboard. Nothing is deleted: " +
      (n ? "their " + n + (n === 1 ? " student stays" : " students stay") + " theirs until you move them." : "they have no students."))) return;
    db.collection("teachers").doc(email).delete().then(function(){
      teacherDocs = teacherDocs.filter(function(t){ return t.email !== email; });
      render();
    }, function(){
      window.alert("Didn't remove — check the network and try again.");
    });
  }

  /* ── the testing seam ─────────────────────────────────────────────
     The board's rules — what a student sees, what an "all" toggle or a
     bulk change reaches, the shape of the writes — are pure
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
      moveBody: moveBody,
      ownerOf: ownerOf,
      teacherCounts: teacherCounts,
      periodMovers: periodMovers,
      effectiveFilter: effectiveFilter,
      matchesFilter: matchesFilter,
      classStudents: classStudents,
      boardPeriod: boardPeriod,
      filterSegments: filterSegments,
      summaryCounts: summaryCounts,
      isArchived: isArchived,
      splitArchived: splitArchived,
      manageSections: manageSections,
      backupName: backupName,
      backupJson: backupJson,
      previewHref: previewHref,
      renderRoster: renderRoster,
      blankAssignment: blankAssignment,
      nextStepInfo: nextStepInfo,
      nextStepRows: nextStepRows,
      rosterStatus: rosterStatus,
      rosterRowOf: rosterRowOf,
      studentByUid: studentByUid,
      isPending: isPending,
      studentUids: function(){ return students.map(function(s){ return s.uid; }); },
      patternRows: patternRows,
      kindText: kindText,
      feed: function(st){
        st = st || {};
        students = st.students || [];
        assignments = st.assignments || {};
        classCfg = { periods: (st.classCfg && st.classCfg.periods) || [],
                     archived: (st.classCfg && st.classCfg.archived) || {} };
        notes = st.notes || {};
        roster = st.roster || {};
        rosterReadable = st.rosterReadable !== false;
        me = String(st.me || "t@seq.org").toLowerCase();
        admin = !!st.admin;
        teacherDocs = st.teachers || [];
        probe = st.probe || {};
        // Same fold the real load does, so a test sees the class the way
        // the dashboard does: signed-in students and roster rows together.
        if(st.roster) addPendingStudents();
        applyArchive(students);
        board.draft = {}; board.sel = {}; board.collapsed = {};
        board.period = st.period || "";      // set directly: no localStorage in tests
        board.q = st.q || "";
      },
      board: board,
      effectiveLists: effectiveLists,
      liveStudent: liveStudent,
      scopeView: scopeView,
      scopeDirty: scopeDirty,
      dirtyScopes: dirtyScopes,
      setScope: setScope,
      bulkApply: bulkApply,
      countLabel: countLabel,
      visibleStudents: visibleStudents,
      boardColumns: boardColumns,
      cellText: cellText,
      cellSpoken: cellSpoken,
      colLabel: colLabel,
      columnToggle: columnToggle,
      readyToAdvance: readyToAdvance,
      evidenceText: evidenceText,
      noteOf: noteOf,
      studentPeriod: studentPeriod,
      csvCell: csvCell,
      csvRows: csvRows,
      sparkline: sparkline,
      rosterCsv: rosterCsv,
      wordsCsv: wordsCsv,
      exportName: exportName,
      noteSummary: noteSummary,
      NOTE_MAX: NOTE_MAX,
      listProgress: listProgress,
      boardSuggestions: boardSuggestions,
      SOLID_ENOUGH: SOLID_ENOUGH,
      saveBody: saveBody,
      NO_PERIOD: NO_PERIOD,
      // Not pure, and here for one reason: 200 lines of string-built
      // markup deserve a test that they parse into the table they claim
      // to. tests.html gives it a #tBody to draw into.
      renderAssign: renderAssign,
      paintCells: paintCells,
      pickerHtml: pickerHtml,
      scopeSelection: scopeSelection,
      bindPickers: bindPickers
    }
  };

})();
