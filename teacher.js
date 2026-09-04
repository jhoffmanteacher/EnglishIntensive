/* ════════════════════════════════════════════════════════════════════
   teacher.js — the dashboard. Teacher accounts only (TEACHER_EMAILS).

   Adapted from the guitar-class site's teacher.js, and it inherits that
   file's central caveat, worth repeating because it is the thing people
   get wrong about client-side dashboards:

     THE GATE ON THIS PAGE IS COSMETIC. Everything here runs in the
     student's own browser and can be reached from DevTools. What
     actually stops a student reading the class's work is
     firestore.rules — the database simply refuses to answer. This file
     shows a friendly "wrong account" panel so the real teacher knows
     they're signed in as the wrong Google account; it is not security.

   ── The four things it does ───────────────────────────────────────────
   Students   roster with accuracy and activity → per-student detail:
              their worst words, list by list, and their assignment.
   Assign     every assignment in the class as one grid: students down
              the side, lists across the top, inherited-versus-own
              visible in the cell, and one batched Save at the bottom.
              The picker below is for one student; this is for the class.
   Periods    which lists each period gets, and which period each student
              is in. A student's own assignment overrides their period's,
              which overrides the class default — see
              EIStore.effectiveLists, which is the one place that
              precedence is written down.
   Trouble    the same words, aggregated across the class: what to teach
              tomorrow, rather than who to talk to.

   ── The picker ────────────────────────────────────────────────────────
   Every place a set of lists is chosen one scope at a time — a student's
   own, a period's, the class default, the board's bulk dialog — uses one
   component, pickerHtml(). It is one section per family, because that is
   the only kind of entry the registry has:
     one list      a line of mode checkboxes — "Blend Words: 🎤 Say it ·
                   🃏 Cards · 🎯 Match It".
     many lists    a grid: one row per list with a few of its words as a
                   reminder, one column per mode, with row and column
                   "all" toggles, because "lists 1–4 as flash cards"
                   should be four clicks, not eight.
   A live summary under the picker (WordLists.describeAssignment) says
   in words what the ticks add up to, and the roster shows that same
   line, so what a student HAS and what you're SETTING read the same way.
   What gets saved is still a flat array of list ids — the picker and the
   board are presentation only; store.js, the rules and the precedence
   never see the grid.

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
  var roster = {};            // email → { name, id, period, start, lists, importedAt }
  var rosterReadable = false; // false until the roster rules are published
  var classCfg = { periodLists:{}, defaultLists:null, periods:[], sequences:{}, sequenceOn:{} };
  var view = "roster";
  var detailUid = null;

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  /* The teacher addresses, for the "not this account" message only. Reads
     the same config auth.js does, and tolerates either shape. */
  function teacherList(){
    var v = (typeof TEACHER_EMAILS !== "undefined") ? TEACHER_EMAILS
          : (typeof TEACHER_EMAIL  !== "undefined") ? TEACHER_EMAIL
          : null;
    if(v == null) return "the teacher account";
    if(typeof v === "string") return v;
    return v.join(" or ");
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
          '<p class="note">You\'re signed in as <b>' + esc(user.email) + "</b>. " +
          "The dashboard belongs to <b>" + esc(teacherList()) + "</b>.</p>" +
          '<button class="btn ghost" id="tSwitch">Sign out and switch account</button>' +
        "</div>";
      $("tSwitch").addEventListener("click", EIAuth.signOut);
      return;
    }
    return loadAll().then(function(){
      EIAuth.unlock();
      $("tTabs").hidden = false;
      bindTabs();
      renderSub();
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

  function loadAll(){
    return EIAuth.db().then(function(d){
      db = d;
      if(!db) throw new Error("no db");
      return Promise.all([
        db.collection("students").get(),
        db.collection("assignments").get(),
        db.collection("config").doc("class").get(),
        // Teacher-only, by firestore.rules. A student reading this
        // collection gets nothing, which is the point of it existing
        // separately from assignments/{uid} — see the rules file.
        db.collection("notes").get(),
        /* Its own catch, and the only read here that has one. Every other
           collection failing means the dashboard is broken; this one
           failing means the roster rules have not been published yet,
           which is a state the site is designed to survive — see
           firestore.rules and the box at the top of TODO.md. */
        db.collection("roster").get().catch(function(){ return null; })
      ]);
    }).then(function(snaps){
      students = [];
      snaps[0].forEach(function(doc){
        var d = doc.data() || {};
        students.push({
          uid: doc.id,
          name: d.name || "",
          email: d.email || "",
          photo: d.photo || "",
          stats: Adaptive.sanitizeStats(d.words),
          heard: Adaptive.sanitizeHeard(d.heard),
          fluency: Adaptive.sanitizeFluency(d.fluency),
          totals: d.totals || { n:0, r:0 },
          recent: Array.isArray(d.recent) ? d.recent : [],
          lastSeen: d.lastSeen || 0
        });
      });
      assignments = {};
      snaps[1].forEach(function(doc){ assignments[doc.id] = doc.data() || {}; });
      notes = {};
      snaps[3].forEach(function(doc){ notes[doc.id] = doc.data() || {}; });
      roster = {};
      rosterReadable = !!snaps[4];
      if(snaps[4]) snaps[4].forEach(function(doc){
        var d = doc.data() || {};
        roster[String(doc.id).toLowerCase()] = {
          email: String(doc.id).toLowerCase(),
          name: d.name || "",
          id: d.id || "",
          period: d.period == null ? "" : String(d.period),
          start: d.start || "",
          lists: Array.isArray(d.lists) ? d.lists : null,
          importedAt: d.importedAt || 0
        };
      });
      var c = snaps[2].exists ? (snaps[2].data() || {}) : {};
      classCfg = {
        periodLists: c.periodLists || {},
        defaultLists: Array.isArray(c.defaultLists) ? c.defaultLists : null,
        periods: Array.isArray(c.periods) ? c.periods : [],
        // A period's ordered course, and the switch that turns one off.
        // Absent means the period has no course and keeps its flat list,
        // which is every period until somebody builds one.
        sequences: c.sequences || {},
        sequenceOn: c.sequenceOn || {}
      };
      addPendingStudents();
      // Sort by display name, falling back to the email local part — an
      // account with no display name shouldn't sink to the bottom.
      students.sort(function(a,b){
        var an = (a.name || a.email).toLowerCase(), bn = (b.name || b.email).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
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

  // new · update · already signed in. The third one matters most: it is
  // the row that will NOT get an assignment written for it, because that
  // student already has one.
  function rosterStatus(row){
    var signedIn = students.filter(function(s){
      return !s.pending && s.email && s.email.toLowerCase() === row.email;
    })[0];
    if(signedIn) return { key: "signed-in", text: "already signed in", uid: signedIn.uid };
    if(roster[row.email]) return { key: "update", text: "update" };
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
    var warnings = p.rows.filter(function(r){ return r.warning; });
    var body = p.rows.map(function(r){
      var st = rosterStatus(r);
      return "<tr><td>" + esc(r.name || "—") + "</td>" +
        '<td class="muted tiny">' + esc(r.email) + "</td>" +
        "<td>" + (r.period ? '<span class="pill">' + esc(r.period) + "</span>" : '<span class="muted tiny">—</span>') + "</td>" +
        "<td>" + (r.start ? esc(WordLists.byId(r.start) ? WordLists.byId(r.start).listTitle : r.start)
                          : '<span class="muted tiny">the beginning</span>') + "</td>" +
        '<td><span class="pill ' + (st.key === "new" ? "good" : st.key === "update" ? "warn" : "") + '">' + esc(st.text) + "</span></td></tr>";
    }).join("");

    box.innerHTML =
      "<p class=\"note\"><b>" + p.rows.length + (p.rows.length === 1 ? " student" : " students") + "</b> ready" +
      (p.errors.length ? ", <b>" + p.errors.length + "</b> " + (p.errors.length === 1 ? "row" : "rows") + " left out" : "") +
      (p.hadHeader ? "" : " · no header row found, so the columns were guessed from their shape") +
      ".</p>" +
      (p.errors.length ? '<div class="empty"><b>Left out:</b><br>' + p.errors.map(function(e){
        return "line " + e.line + (e.name ? " (" + esc(e.name) + ")" : "") + " — " + esc(e.message);
      }).join("<br>") + "</div>" : "") +
      (warnings.length ? '<div class="empty">' + warnings.map(function(r){
        return esc(r.name || r.email) + " — " + esc(r.warning);
      }).join("<br>") + "</div>" : "") +
      '<div class="tableScroll" style="max-height:46vh"><table class="t"><thead><tr>' +
      "<th>Name</th><th>Signs in as</th><th>Period</th><th>Starts on</th><th>Status</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>";
    document.getElementById("riGo").disabled = !p.rows.length;
    document.getElementById("riGo").textContent = "Import " + p.rows.length +
      (p.rows.length === 1 ? " student" : " students");
  }

  function readImport(text){
    importParsed = GameCore.parseRoster(text, function(s){ return WordLists.resolveListRef(s); });
    renderImportPreview();
  }

  function openImport(){
    closeImport();
    importWrap = document.createElement("div");
    importWrap.className = "abModal";
    importWrap.innerHTML =
      '<div class="abModalBox riBox" role="dialog" aria-modal="true">' +
        "<h2>Import a roster</h2>" +
        '<p class="note">Whatever your student information system exports — comma, tab or semicolon separated. ' +
        "It needs an <b>ID number</b> column and a <b>name</b>; a <b>period</b> and a <b>starting list</b> are " +
        "used if they're there. Students sign in as <b>&lt;ID number&gt;@seq.org</b>, which is how a row and an " +
        "account find each other.</p>" +
        (rosterReadable ? "" : '<div class="empty" style="border-color:rgba(255,107,107,.45)"><b>The roster rules ' +
          "aren't published yet.</b> This import will fail until somebody pastes <code>firestore.rules</code> into " +
          "Firebase console → Firestore → Rules → Publish. See the top of TODO.md.</div>") +
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
  function importBody(rows, now){
    var out = { roster: {}, periods: [], assignments: {} };
    var known = {};
    allPeriods().forEach(function(p){ known[p] = true; });
    rows.forEach(function(r){
      var doc = { name: r.name, id: r.id, period: r.period, importedAt: now };
      if(r.start) doc.startAt = r.start;
      out.roster[r.email] = doc;
      if(r.period && !known[r.period]){ known[r.period] = true; out.periods.push(r.period); }

      var signedIn = students.filter(function(s){
        return !s.pending && s.email && s.email.toLowerCase() === r.email;
      })[0];
      if(signedIn && !assignments[signedIn.uid]){
        var a = { period: r.period || null, updatedAt: now };
        out.assignments[signedIn.uid] = a;
      }
    });
    return out;
  }

  function commitImport(){
    var p = importParsed;
    if(!p || !p.rows.length) return;
    var note = document.getElementById("riNote");
    var now = Date.now();
    var body = importBody(p.rows, now);
    note.className = "saveNote";
    note.textContent = "Importing…";

    // Firestore caps a batch at 500 writes; 400 leaves room for the
    // config document and the assignment fill-ins riding along.
    var writes = Object.keys(body.roster).map(function(email){
      return { ref: db.collection("roster").doc(email), data: body.roster[email] };
    }).concat(Object.keys(body.assignments).map(function(uid){
      return { ref: db.collection("assignments").doc(uid), data: body.assignments[uid] };
    }));
    if(body.periods.length){
      writes.push({ ref: db.collection("config").doc("class"),
                    data: { periods: allPeriods().concat(body.periods) } });
    }

    var chunks = [], i;
    for(i=0;i<writes.length;i+=400) chunks.push(writes.slice(i, i+400));

    chunks.reduce(function(chain, chunk){
      return chain.then(function(){
        var batch = db.batch();
        chunk.forEach(function(w){ batch.set(w.ref, w.data, { merge:true }); });
        return batch.commit();
      });
    }, Promise.resolve()).then(function(){
      closeImport();
      return loadAll();
    }).then(function(){
      view = "roster";
      detailUid = null;
      renderSub();
      render();
    }).catch(function(){
      if(note){
        note.className = "saveNote err";
        note.textContent = rosterReadable
          ? "Nothing imported — check the network and try again."
          : "Nothing imported — the roster rules aren't published yet (see TODO.md).";
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
    return Object.keys(set).sort(function(a,b){
      var na = parseFloat(a), nb = parseFloat(b);
      if(!isNaN(na) && !isNaN(nb)) return na - nb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  // Same precedence as EIStore.effectiveLists, restated here because the
  // dashboard runs without store.js loaded. If you change one, change
  // both — tests.html pins the student-side copy.
  /* The same walk store.js does for the student, with the roster rung in
     the same place: own assignment → roster row → period → class default
     → everything. Kept in step with EIStore.effectiveLists by tests.html,
     which pins both. */
  function effectiveLists(uid){
    var a = assignments[uid];
    if(a && Array.isArray(a.lists)) return { ids: a.lists, from: "student" };
    var s = studentByUid(uid);
    var r = rosterFor(s);
    if(r && Array.isArray(r.lists)) return { ids: r.lists, from: "roster" };
    // The course, where the period runs one. Same rung, same order and
    // the same function as store.js — see sequenceStateFor.
    var seq = sequenceStateFor(s);
    if(seq) return { ids: seq.ids, from: "sequence · step " + (seq.stepIndex + 1) + " of " + seq.steps, seq: seq };
    var p = (a && a.period) || (r && r.period) || null;
    if(p != null && p !== "" && Array.isArray(classCfg.periodLists[p])) return { ids: classCfg.periodLists[p], from: "period " + p };
    if(Array.isArray(classCfg.defaultLists)) return { ids: classCfg.defaultLists, from: "class default" };
    return { ids: WordLists.ids, from: "everything (nothing set)" };
  }

  /* ---------------- the picker ----------------
     One section per family, because that is now the only kind of entry
     there is. A family with several lists (the red words) gets the grid
     it always had — a row per list, a column per mode, with row and
     column toggles, so "lists 1-4 as flash cards" is four clicks rather
     than eight. A family with ONE list has nothing to put in the rows,
     so it collapses to a line of mode checkboxes: "Blend Words:
     🎤 Say it · 🃏 Cards · 🎯 Match It".

     scopeId  "student" | "default" | "p:<period>" | "bulk" — stamped on
              every input so scopeSelection() can read one picker on a
              page carrying several
     selected the ids currently on (array), or null with allOn deciding
     allOn    what "nothing set" means here: true for the class default
              (open site), false for a period following a default */
  function pickerHtml(scopeId, selected, allOn){
    var on = function(id){ return selected ? selected.indexOf(id) !== -1 : !!allOn; };
    var sc = esc(scopeId);

    function box(id){
      return '<input type="checkbox" data-scope="' + sc + '" data-list="' + esc(id) + '"' + (on(id) ? " checked" : "") + ">";
    }
    function famTools(fam){
      return '<span class="pkTools">' +
        '<button type="button" class="pkMini" data-pk-fam="' + sc + "|" + esc(fam.key) + '|all">all</button>' +
        '<button type="button" class="pkMini" data-pk-fam="' + sc + "|" + esc(fam.key) + '|none">none</button></span>';
    }

    var fams = WordLists.families().map(function(fam){
      var modes = WordLists.modesOf(fam.key);
      var body;

      if(fam.lists.length > 1){
        var head = modes.map(function(m){
          return "<th>" + esc(m.icon + " " + m.title) +
            '<button type="button" class="pkMini" data-pk-col="' + sc + "|" + esc(fam.key) + "|" + esc(m.key) +
            '" title="Tick or untick every list for ' + esc(m.title) + '">all</button></th>';
        }).join("");
        var rows = WordLists.listNumsOf(fam.key).map(function(n){
          var cells = modes.map(function(m){
            var id = WordLists.idFor(fam.key, n, m.key);
            return "<td>" + (id ? box(id) : "") + "</td>";
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
          return '<label class="check">' + box(id) + "<span>" + esc(m.icon + " " + m.title) +
            '<span class="sub2">' + WordLists.wordsOf(id).length + " words" +
            (m.needs ? " · " + esc(m.needs) : "") + "</span></span></label>";
        }).join("") + "</div>";
      }

      return '<div class="pkSection"><div class="pkHead"><h3>' + esc(fam.icon + " " + fam.title) + "</h3>" +
        '<span class="muted tiny">' + esc(fam.note) + "</span>" + famTools(fam) + "</div>" + body + "</div>";
    }).join("");

    return '<div class="picker" data-picker="' + sc + '">' + fams +
      '<div class="pkSummary">This gives them: <b data-pk-summary="' + sc + '"></b></div>' +
    "</div>";
  }

  /* The ids ticked in one picker. Queries the whole document rather than
     #tBody because the bulk picker lives in a modal outside it; the scope
     stamp is what keeps two pickers on one screen apart. */
  function scopeSelection(scopeId){
    var ids = [];
    Array.prototype.forEach.call(document.querySelectorAll('input[data-scope="' + scopeId.replace(/"/g,'') + '"]'), function(cb){
      if(cb.checked) ids.push(cb.dataset.list);
    });
    return ids;
  }
  function pickerInputs(scopeId, filter){
    return Array.prototype.filter.call(document.querySelectorAll('input[data-scope="' + scopeId.replace(/"/g,'') + '"]'), function(cb){
      var l = WordLists.byId(cb.dataset.list);
      return l && (!filter || filter(l));
    });
  }
  function refreshSummary(scopeId){
    var el = document.querySelector('[data-pk-summary="' + scopeId.replace(/"/g,'') + '"]');
    if(el) el.textContent = WordLists.describeAssignment(scopeSelection(scopeId));
  }
  // Tick every input in a group, or untick them all if they're already all on.
  function toggleGroup(inputs){
    var allOn = inputs.length && inputs.every(function(cb){ return cb.checked; });
    inputs.forEach(function(cb){ cb.checked = !allOn; });
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
          .forEach(function(cb){ cb.checked = parts[2] === "all"; });
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

  function whoHtml(s){
    var av = s.photo
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
    var n = students.length;
    $("tSub").textContent = n
      ? n + (n === 1 ? " student has" : " students have") + " signed in · " + allPeriods().length + " period" + (allPeriods().length === 1 ? "" : "s")
      : "No students have signed in yet.";
  }

  function bindTabs(){
    Array.prototype.forEach.call(document.querySelectorAll("#tTabs .tab"), function(b){
      b.addEventListener("click", function(){
        // The Assign board holds its edits in memory until Save, so
        // walking away from it silently would throw them out.
        if(view === "assign" && b.dataset.view !== "assign"){
          var n = dirtyScopes().length;
          if(n && !window.confirm(n + (n === 1 ? " change hasn't" : " changes haven't") +
                                  " been saved yet. Leave the board and lose them?")) return;
          board.draft = {};
        }
        view = b.dataset.view;
        detailUid = null;
        Array.prototype.forEach.call(document.querySelectorAll("#tTabs .tab"), function(x){
          x.classList.toggle("on", x === b);
        });
        render();
      });
    });
  }

  function render(){
    closePop();
    closeBulk();
    if(view === "roster") return detailUid ? renderDetail() : renderRoster();
    if(view === "assign") return renderAssign();
    if(view === "groups") return renderGroups();
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
      "Name","Email","Period","Lists","Lists from",
      "Answers","Accuracy %","Words solid","Words shaky","Slow but right","Top error","Last active","Signed in","Note"
    ].concat(flCols.reduce(function(acc, l){
      return acc.concat([l.listTitle + " latest", l.listTitle + " best"]);
    }, []))];
    students.forEach(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      rows.push([
        s.name, s.email,
        (assignments[s.uid] || {}).period || (rosterFor(s) && rosterFor(s).period) || "",
        WordLists.describeAssignment(eff.ids), eff.from,
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
      var period = (assignments[s.uid] || {}).period || "";
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
  function download(name, text){
    try{
      // U+FEFF: without a byte-order mark Excel reads the file as the
      // system's legacy encoding, and every accented name in the class
      // comes out mangled. Every other reader ignores it.
      var blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
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
      $("tBody").innerHTML = '<div class="panel"><h2>Nobody yet</h2>' +
        '<p class="note">A student appears here the first time they sign in and play a round — or ' +
        "the moment you import a roster, which is the quicker way round. " +
        '<b>Periods &amp; Lists → 📋 Import roster</b>.</p></div>';
      return;
    }
    var waiting = students.filter(function(s){ return s.pending; }).length;
    var rows = students.map(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      var a = assignments[s.uid] || {};
      var r = rosterFor(s);
      var period = a.period || (r && r.period) || "";
      /* A student on the roster who hasn't signed in yet is a real row
         with nothing in it. Greyed rather than hidden: on day one the
         useful thing this table can tell a teacher is who is MISSING. */
      if(s.pending){
        return '<tr class="clickable pending" data-uid="' + esc(s.uid) + '">' +
          "<td>" + whoHtml(s) + "</td>" +
          "<td>" + (period ? '<span class="pill">Period ' + esc(period) + "</span>" : '<span class="muted tiny">not set</span>') + "</td>" +
          '<td class="listsCell">' + esc(WordLists.describeAssignment(eff.ids)) + ' <span class="muted tiny">(' + esc(eff.from) + ")</span></td>" +
          '<td class="muted tiny" colspan="4">on the roster — hasn\u2019t signed in yet</td>' +
          '<td class="muted tiny">—</td></tr>';
      }
      return "<tr class=\"clickable\" data-uid=\"" + esc(s.uid) + "\">" +
        "<td>" + whoHtml(s) + "</td>" +
        '<td>' + (period ? '<span class="pill">Period ' + esc(period) + "</span>" : '<span class="muted tiny">not set</span>') + "</td>" +
        '<td class="listsCell">' + esc(WordLists.describeAssignment(eff.ids)) + ' <span class="muted tiny">(' + esc(eff.from) + ")</span></td>" +
        '<td class="num">' + sum.attempts + "</td>" +
        '<td class="num">' + accCell(sum.accuracy) + "</td>" +
        '<td class="num"><span class="pill good">' + sum.mastered + "</span></td>" +
        '<td class="num">' + (sum.struggling ? '<span class="pill bad">' + sum.struggling + "</span>" : '<span class="muted">0</span>') + "</td>" +
        '<td class="muted tiny">' + esc(ago(sum.lastSeen || s.lastSeen)) + "</td>" +
        "</tr>";
    }).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Students</h2>' +
      (waiting ? '<p class="note"><b>' + waiting + (waiting === 1 ? " student on the roster hasn\u2019t" : " students on the roster haven\u2019t") +
        ' signed in yet</b> — greyed out below. They already have their period and their lists; ' +
        "the site picks those up the first time they sign in.</p>" : "") +
      '<p class="note">Click a student for their worst words and their list assignment. ' +
      '“Solid” is a word answered right, first try, enough times in a row to have earned a long rest; ' +
      '“shaky” is one under 60&nbsp;% accuracy.</p>' +
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
    $("tExportRoster").addEventListener("click", function(){ download(exportName("roster"), rosterCsv()); });
    $("tExportWords").addEventListener("click", function(){ download(exportName("words"), wordsCsv()); });
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

  function studentByUid(uid){
    for(var i=0;i<students.length;i++) if(students[i].uid === uid) return students[i];
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

    var picker = pickerHtml("student", eff.ids, true);

    var periodOpts = ['<option value="">— not set —</option>'].concat(allPeriods().map(function(p){
      return '<option value="' + esc(p) + '"' + (a.period === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
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
      "</div>" +

      '<div class="panel"><h2>Assignment</h2>' +
        '<p class="note">What this student sees on their home page. Every list can be played several ways — tick each way they should get it. ' +
        'Saving here sets this student\'s OWN set, which overrides their period. ' +
        'Currently coming from: <b>' + esc(eff.from) + "</b>. " +
        '“Use my period’s lists” hands them back to the group.</p>' +
        '<div class="rowActions" style="margin-bottom:16px">' +
          '<label class="muted tiny" for="tPeriod">Period</label>' +
          '<select class="sel" id="tPeriod">' + periodOpts + "</select>" +
          '<input class="txt" id="tNewPeriod" placeholder="or type a new one" style="width:170px">' +
        "</div>" +
        picker +
        '<div class="rowActions">' +
          '<button class="btn sm" id="tSaveA">Save assignment</button>' +
          '<button class="btn ghost sm" id="tClearA">Use my period’s lists</button>' +
          '<span class="saveNote" id="tANote"></span>' +
        "</div>" +
      "</div>" +

      (errorMix ? '<div class="panel"><h2>What goes wrong</h2>' +
        '<p class="note">Counted on Say It only — it is the only mode that hears what the student actually said. ' +
        "One count per word given up on, not per fumble.</p>" +
        "<p>" + errorMix + "</p></div>" : "") +

      (rosterRow ? '<div class="panel"><h2>Roster row</h2>' +
        '<p class="note">Imported ' + esc(rosterRow.importedAt ? ago(rosterRow.importedAt) : "at some point") +
        " · ID <b>" + esc(rosterRow.id || "—") + "</b> · signs in as <b>" + esc(s.email) + "</b>" +
        (s.pending ? " · <b>hasn\u2019t signed in yet</b>" : "") + ". " +
        "A re-import updates this row and never deletes it; removing one is this button, and only this button.</p>" +
        '<div class="rowActions"><button class="btn ghost sm" id="tRosterOut">Remove from roster</button>' +
        '<span class="saveNote" id="tRosterNote"></span></div>' +
      "</div>" : "") +

      notePanelHtml(s.uid) +

      '<div class="panel"><h2>Hardest words</h2>' +
        '<p class="note">Worst first — right answers out of attempts, counting only first-try answers. ' +
        "These are the words the site is already showing them most often.</p>" +
        (worst ? '<div class="wordchips">' + worst + "</div>" : '<div class="empty">No practice recorded yet.</div>') +
      "</div>" +

      (fluency ? '<div class="panel"><h2>Reading rate</h2>' +
        '<p class="note">Correct words per minute, one point per timed read, oldest on the left. ' +
        "Accuracy stops moving long before this does — a student can be right about every word on a list " +
        "and still be reading it one word at a time.</p>" +
        '<div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>List</th><th>Progress</th><th class="num">Latest</th><th class="num">Best</th><th class="num">Reads</th>' +
        "</tr></thead><tbody>" + fluency + "</tbody></table></div></div>" : "") +

      (perList ? '<div class="panel"><h2>By list</h2><div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>List</th><th class="num">Answers</th><th class="num">Accuracy</th><th class="num">Solid</th><th class="num">Shaky</th>' +
        "</tr></thead><tbody>" + perList + "</tbody></table></div></div>" : "");

    $("tBack").addEventListener("click", function(){ detailUid = null; render(); });
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
    $("tClearA").addEventListener("click", function(){ saveStudentAssignment(s.uid, true); });
    $("tNoteSave").addEventListener("click", function(){ saveNote(s.uid, $("tNote").value); });
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
    var body = { text: text, updatedAt: Date.now() };
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
  function saveStudentAssignment(uid, clearLists){
    var note = $("tANote");
    var period = ($("tNewPeriod").value || "").trim() || $("tPeriod").value || null;
    var lists = clearLists ? null : checkedLists();

    /* A student who hasn't signed in yet is edited the same way and
       written somewhere else — their roster row, which store.js reads on
       the first sign-in. */
    if(isPending(uid)){
      var em = emailOfPending(uid);
      var wasRow = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
      var rowBody = { period: period || "", lists: lists, updatedAt: Date.now() };
      roster[em] = roster[em] || { email: em };
      roster[em].period = rowBody.period;
      roster[em].lists = lists;
      if(period && classCfg.periods.indexOf(period) === -1) classCfg.periods.push(period);
      note.className = "saveNote"; note.textContent = "Saving…";
      db.collection("roster").doc(em).set(rowBody, { merge:true })
        .then(function(){ return db.collection("config").doc("class").set({ periods: classCfg.periods }, { merge:true }); })
        .then(function(){
          note.className = "saveNote ok"; note.textContent = "Saved.";
          render();
        })
        .catch(function(){
          if(wasRow) roster[em] = wasRow; else delete roster[em];
          note.className = "saveNote err";
          note.textContent = rosterReadable
            ? "Didn't save — check the network and try again."
            : "Didn't save — the roster rules aren't published yet (see TODO.md).";
        });
      return;
    }

    var before = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
    var body = { period: period, lists: lists, updatedAt: Date.now() };
    assignments[uid] = body;
    if(period && classCfg.periods.indexOf(period) === -1) classCfg.periods.push(period);
    note.className = "saveNote"; note.textContent = "Saving…";
    db.collection("assignments").doc(uid).set(body, { merge:true })
      .then(function(){
        // Keep the named-period list in step, so a period invented in this
        // box shows up in the Periods tab straight away.
        return db.collection("config").doc("class").set({ periods: classCfg.periods }, { merge:true });
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

  /* ---------------- the sequence editor ----------------
     A period's course, as an ordered list of steps. Edits are held in
     `seqDraft` until Save, the same way the Assign board holds its cells,
     because a course is thirty-odd decisions and saving each one as it is
     made would mean a half-built course reaching students mid-lesson.

     Steps are drag-to-reorder AND have ↑/↓ buttons. The drag is what
     everybody reaches for; the buttons are what works on a Chromebook
     trackpad, with a keyboard, and for anybody who has ever tried to drag
     a row past the bottom of a scrolling panel. */
  var seqDraft = {};      // period → steps, only while being edited

  function seqSteps(p){
    if(Object.prototype.hasOwnProperty.call(seqDraft, p)) return seqDraft[p];
    return sequenceStored(p) || [];
  }
  function seqDirty(p){ return Object.prototype.hasOwnProperty.call(seqDraft, p); }

  function stepLabel(ids){
    return (ids || []).map(function(id){
      var l = WordLists.byId(id);
      if(!l) return id;
      var m = WordLists.modeOf(l.mode);
      return '<span class="seqChip">' + esc(l.short || l.listTitle) + " " + esc(m ? m.icon : "") + "</span>";
    }).join("");
  }

  function sequenceEditorHtml(p){
    var steps = seqSteps(p);
    var on = sequenceIsOn(p);
    var rows = steps.map(function(ids, i){
      return '<li class="seqStep" draggable="true" data-seq="' + esc(p) + '" data-step="' + i + '">' +
        '<span class="seqNum">' + (i + 1) + "</span>" +
        '<span class="seqIds">' + (ids.length ? stepLabel(ids) : '<span class="muted tiny">empty</span>') + "</span>" +
        '<span class="seqTools">' +
          '<button class="pkMini" data-seqmove="up" title="Move up">↑</button>' +
          '<button class="pkMini" data-seqmove="down" title="Move down">↓</button>' +
          '<button class="pkMini" data-seqmove="drop" title="Remove this step">✕</button>' +
        "</span></li>";
    }).join("");

    return '<div class="seqBox" data-seqbox="' + esc(p) + '">' +
      '<div class="pkHead"><h3>Sequence</h3>' +
        '<span class="muted tiny">' + (steps.length ? steps.length + " steps" : "none yet") + "</span>" +
        '<span class="pkTools">' +
          '<button class="pkMini" data-seqon="' + esc(p) + '">' + (on ? "On" : "Off") + "</button>" +
          '<button class="pkMini" data-seqdefault="' + esc(p) + '">Reset to default</button>' +
          '<button class="pkMini" data-seqadd="' + esc(p) + '">Add a step…</button>' +
        "</span></div>" +
      '<p class="note" style="margin:0 0 10px">An ordered course. A student sees every step up to and ' +
      "including the one they are on, and the site opens the next one when the current one is " +
      Math.round(SOLID_ENOUGH * 100) + "&nbsp;% solid — nothing is written and nobody has to notice. " +
      "While a sequence is on it replaces this period's flat list.</p>" +
      (steps.length ? '<ol class="seqList">' + rows + "</ol>"
                    : '<div class="empty">No sequence yet. <b>Reset to default</b> builds the standard course.</div>') +
      '<div class="rowActions">' +
        '<button class="btn sm" data-seqsave="' + esc(p) + '"' + (seqDirty(p) ? "" : " disabled") + ">Save sequence</button>" +
        '<span class="saveNote" data-seqnote="' + esc(p) + '"></span>' +
      "</div></div>";
  }

  function redrawSequence(p){
    var box = document.querySelector('[data-seqbox="' + p.replace(/"/g, '\\"') + '"]');
    if(!box) return;
    var holder = document.createElement("div");
    holder.innerHTML = sequenceEditorHtml(p);
    box.parentNode.replaceChild(holder.firstChild, box);
    bindSequenceEditors();
  }

  function bindSequenceEditors(){
    Array.prototype.forEach.call(document.querySelectorAll("[data-seqbox]"), function(box){
      var p = box.getAttribute("data-seqbox");
      if(box.dataset.bound) return;
      box.dataset.bound = "1";

      box.addEventListener("click", function(ev){
        var t2 = ev.target;
        if(!t2 || !t2.getAttribute) return;

        if(t2.getAttribute("data-seqdefault") !== null){
          seqDraft[p] = WordLists.defaultSequence();
          return redrawSequence(p);
        }
        if(t2.getAttribute("data-seqon") !== null){
          // The switch saves on its own: it is one bit, and holding it in
          // a draft alongside the steps would mean "Off" not taking
          // effect until somebody pressed Save on something else.
          saveSequenceOn(p, !sequenceIsOn(p));
          return;
        }
        if(t2.getAttribute("data-seqadd") !== null){
          return openStepPicker(p);
        }
        if(t2.getAttribute("data-seqsave") !== null){
          return saveSequence(p);
        }
        var move = t2.getAttribute("data-seqmove");
        if(move){
          var li = t2;
          while(li && !li.getAttribute("data-step")) li = li.parentNode;
          if(!li) return;
          var i = parseInt(li.getAttribute("data-step"), 10);
          var steps = seqSteps(p).slice();
          if(move === "up" && i > 0){ var a = steps[i-1]; steps[i-1] = steps[i]; steps[i] = a; }
          else if(move === "down" && i < steps.length - 1){ var b = steps[i+1]; steps[i+1] = steps[i]; steps[i] = b; }
          else if(move === "drop"){ steps.splice(i, 1); }
          else return;
          seqDraft[p] = steps;
          redrawSequence(p);
        }
      });

      // Drag to reorder. dataTransfer carries the index; the drop target
      // works out where it landed.
      var dragFrom = -1;
      box.addEventListener("dragstart", function(ev){
        var li = ev.target;
        if(!li || !li.getAttribute || li.getAttribute("data-step") === null) return;
        dragFrom = parseInt(li.getAttribute("data-step"), 10);
        li.classList.add("dragging");
        try{ ev.dataTransfer.setData("text/plain", String(dragFrom)); ev.dataTransfer.effectAllowed = "move"; }catch(e){}
      });
      box.addEventListener("dragend", function(ev){
        if(ev.target && ev.target.classList) ev.target.classList.remove("dragging");
      });
      box.addEventListener("dragover", function(ev){ ev.preventDefault(); });
      box.addEventListener("drop", function(ev){
        ev.preventDefault();
        var li = ev.target;
        while(li && li.getAttribute && li.getAttribute("data-step") === null) li = li.parentNode;
        if(!li || !li.getAttribute) return;
        var to = parseInt(li.getAttribute("data-step"), 10);
        var from = dragFrom;
        try{ from = parseInt(ev.dataTransfer.getData("text/plain"), 10); }catch(e){}
        if(!isFinite(from) || !isFinite(to) || from === to) return;
        var steps = seqSteps(p).slice();
        var moved = steps.splice(from, 1)[0];
        steps.splice(to, 0, moved);
        seqDraft[p] = steps;
        redrawSequence(p);
      });
    });
  }

  // One step, built with the same picker every other assignment uses.
  function openStepPicker(p){
    closeBulk();
    bulkWrap = document.createElement("div");
    bulkWrap.className = "abModal";
    bulkWrap.innerHTML =
      '<div class="abModalBox" role="dialog" aria-modal="true">' +
        "<h2>Add a step to period " + esc(p) + "</h2>" +
        '<p class="note">Everything ticked here unlocks together, and stays unlocked. ' +
        "The step goes on the end; drag it where it belongs.</p>" +
        pickerHtml("bulk", [], false) +
        '<div class="rowActions">' +
          '<button class="btn sm" id="abApply">Add the step</button>' +
          '<button class="btn ghost sm" id="abCancel">Cancel</button>' +
        "</div></div>";
    document.body.appendChild(bulkWrap);
    bindPickers(bulkWrap);
    bulkWrap.addEventListener("click", function(e){ if(e.target === bulkWrap) closeBulk(); });
    document.getElementById("abCancel").addEventListener("click", closeBulk);
    document.getElementById("abApply").addEventListener("click", function(){
      var ids = scopeSelection("bulk");
      if(ids.length){
        seqDraft[p] = seqSteps(p).slice().concat([ids]);
      }
      closeBulk();
      redrawSequence(p);
    });
  }

  function seqNote(p, cls, text){
    var el = document.querySelector('[data-seqnote="' + p.replace(/"/g, '\\"') + '"]');
    if(!el) return;
    el.className = "saveNote" + (cls ? " " + cls : "");
    el.textContent = text;
  }

  function saveSequence(p){
    var steps = seqSteps(p).filter(function(s){ return s && s.length; });
    var before = classCfg.sequences[p];
    classCfg.sequences[p] = steps;
    var patch = {}; patch[p] = steps;
    seqNote(p, "", "Saving…");
    db.collection("config").doc("class").set({ sequences: patch }, { merge:true })
      .then(function(){
        delete seqDraft[p];
        redrawSequence(p);
        seqNote(p, "ok", "Saved.");
      })
      .catch(function(){
        classCfg.sequences[p] = before;
        seqNote(p, "err", "Didn't save — check the network and try again.");
      });
  }

  function saveSequenceOn(p, on){
    var before = classCfg.sequenceOn[p];
    classCfg.sequenceOn[p] = on;
    var patch = {}; patch[p] = on;
    seqNote(p, "", "Saving…");
    db.collection("config").doc("class").set({ sequenceOn: patch }, { merge:true })
      .then(function(){ render(); })
      .catch(function(){
        classCfg.sequenceOn[p] = before;
        seqNote(p, "err", "Didn't save — check the network and try again.");
      });
  }

  /* ---------------- periods & lists ---------------- */
  function renderGroups(){
    var periods = allPeriods();

    var periodPanels = periods.map(function(p){
      var sel = Array.isArray(classCfg.periodLists[p]) ? classCfg.periodLists[p] : null;
      var count = students.filter(function(s){
        var r = rosterFor(s);
        return ((assignments[s.uid] || {}).period || (r && r.period)) === p;
      }).length;
      var live = !!sequenceOf(p);
      return '<div class="panel"><h2>Period ' + esc(p) + "</h2>" +
        '<p class="note">' + count + " student" + (count === 1 ? "" : "s") + " · " +
        (live ? "running a <b>sequence</b> — the flat list below is ignored while it is on"
              : sel ? "its own list set" : "following the class default") + "</p>" +
        pickerHtml("p:" + p, sel, Array.isArray(classCfg.defaultLists) ? false : true) +
        '<div class="rowActions">' +
          '<button class="btn sm" data-save="p:' + esc(p) + '">Save period ' + esc(p) + "</button>" +
          '<button class="btn ghost sm" data-clear="p:' + esc(p) + '">Use class default</button>' +
          '<span class="saveNote" data-note="p:' + esc(p) + '"></span>' +
        "</div>" +
        sequenceEditorHtml(p) +
        "</div>";
    }).join("");

    var roster = students.map(function(s){
      var a = assignments[s.uid] || {};
      var opts = ['<option value="">—</option>'].concat(periods.map(function(p){
        return '<option value="' + esc(p) + '"' + (a.period === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
      })).join("");
      return "<tr><td>" + whoHtml(s) + "</td>" +
        '<td><select class="sel" data-period-for="' + esc(s.uid) + '">' + opts + "</select></td>" +
        '<td class="muted tiny">' + (Array.isArray(a.lists) ? "own set: " + esc(WordLists.describeAssignment(a.lists)) : "follows period") + "</td></tr>";
    }).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Class default</h2>' +
        '<p class="note">What a student gets when neither they nor their period has a list set. ' +
        "Leave everything ticked and the whole site is open to everyone.</p>" +
        pickerHtml("default", classCfg.defaultLists, true) +
        '<div class="rowActions"><button class="btn sm" data-save="default">Save default</button>' +
        '<span class="saveNote" data-note="default"></span></div>' +
      "</div>" +

      '<div class="panel"><h2>Import a roster</h2>' +
        '<p class="note">Drop or paste whatever your student information system exports. ' +
        "Students get their period, and their lists, before they ever sign in — so the first day of term " +
        "isn't a teacher typing thirty names in. Re-importing updates rows and never deletes one.</p>" +
        '<div class="rowActions"><button class="btn sm" id="tImport">📋 Import roster</button>' +
        '<span class="muted tiny">' + (Object.keys(roster).length
          ? Object.keys(roster).length + " on the roster now"
          : "nothing imported yet") + "</span></div>" +
      "</div>" +

      '<div class="panel"><h2>Add a period</h2>' +
        '<p class="note">Periods are just labels — “3”, “5”, “Support”. Add one here, then put students in it below.</p>' +
        '<div class="rowActions"><input class="txt" id="tAddPeriod" placeholder="e.g. 3"> ' +
        '<button class="btn sm" id="tAddPeriodBtn">Add</button>' +
        '<span class="saveNote" id="tAddNote"></span></div>' +
      "</div>" +

      periodPanels +

      (students.length ? '<div class="panel"><h2>Who’s in which period</h2>' +
        '<p class="note">Changes save as soon as you pick.</p>' +
        '<div class="tableScroll"><table class="t"><thead><tr><th>Student</th><th>Period</th><th>Lists</th></tr></thead>' +
        "<tbody>" + roster + "</tbody></table></div></div>" : "");

    $("tImport").addEventListener("click", openImport);
    bindSequenceEditors();

    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-save]"), function(b){
      b.addEventListener("click", function(){ saveScope(b.dataset.save, false); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-clear]"), function(b){
      b.addEventListener("click", function(){ saveScope(b.dataset.clear, true); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#tBody [data-period-for]"), function(sel){
      sel.addEventListener("change", function(){ setStudentPeriod(sel.dataset.periodFor, sel.value || null); });
    });
    var addBtn = $("tAddPeriodBtn");
    if(addBtn) addBtn.addEventListener("click", addPeriod);
    bindPickers();
  }

  /* `null` rather than a deleted field is how "inherit" is stored — see
     EIStore.effectiveLists, which walks down the chain on anything that
     isn't an array. It keeps every write a plain merge, with no
     FieldValue.delete() sentinels to get wrong. */
  function saveScope(scopeId, clear){
    var note = document.querySelector('#tBody [data-note="' + scopeId.replace(/"/g,'') + '"]');
    var lists = clear ? null : scopeSelection(scopeId);
    var body, undo;
    if(scopeId === "default"){
      undo = classCfg.defaultLists;
      classCfg.defaultLists = lists;
      body = { defaultLists: lists };
    } else {
      var p = scopeId.slice(2);
      undo = classCfg.periodLists[p];
      classCfg.periodLists[p] = lists;
      var pl = {}; pl[p] = lists;
      body = { periodLists: pl };
    }
    if(note){ note.className = "saveNote"; note.textContent = "Saving…"; }
    db.collection("config").doc("class").set(body, { merge:true })
      .then(function(){ if(note){ note.className = "saveNote ok"; note.textContent = "Saved."; } render(); })
      .catch(function(){
        if(scopeId === "default") classCfg.defaultLists = undo;
        else classCfg.periodLists[scopeId.slice(2)] = undo;
        if(note){ note.className = "saveNote err"; note.textContent = "Didn't save."; }
      });
  }

  function setStudentPeriod(uid, period){
    var before = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
    var body = assignments[uid] || {};
    body.period = period;
    body.updatedAt = Date.now();
    assignments[uid] = body;
    db.collection("assignments").doc(uid).set({ period: period, updatedAt: body.updatedAt }, { merge:true })
      .catch(function(){
        if(before) assignments[uid] = before; else delete assignments[uid];
        render();
      });
  }

  function addPeriod(){
    var v = ($("tAddPeriod").value || "").trim();
    var note = $("tAddNote");
    if(!v){ note.className = "saveNote err"; note.textContent = "Type a name first."; return; }
    if(classCfg.periods.indexOf(v) !== -1){ note.className = "saveNote"; note.textContent = "Already there."; return; }
    classCfg.periods.push(v);
    note.className = "saveNote"; note.textContent = "Saving…";
    db.collection("config").doc("class").set({ periods: classCfg.periods }, { merge:true })
      .then(function(){ render(); })
      .catch(function(){
        classCfg.periods = classCfg.periods.filter(function(x){ return x !== v; });
        note.className = "saveNote err"; note.textContent = "Didn't save.";
      });
  }

  /* ════════════════════════════════════════════════════════════════
     the Assign board

     The picker answers "what should THIS student get?" one scope at a
     time, which is the right shape for a conversation about one student
     and the wrong shape for the ten minutes at the start of a unit when
     a teacher is moving a whole class onto List 4. That is what this is:
     one grid, students down the side and lists across the top, every
     assignment in the class visible at once and editable in place.

     Three things make it work rather than just look busy:

     · Inheritance is visible. A student who follows their period is
       drawn dashed and grey; a student with their own set is gold. You
       can see at a glance who has been pulled out of the group, which is
       the question a differentiated roster actually raises.
     · Editing is copy-on-write, and says so. Touching a cell on an
       inheriting student copies their effective set onto them as their
       own — the same thing the picker has always done on Save — and the
       row grows a ↺ to hand them back to the group.
     · Nothing is written until Save. Every edit lands in `draft`, the
       bar at the bottom counts what's pending, and Save commits the lot
       in ONE db.batch(). A teacher reassigning six students should not
       be able to get halfway.
     ════════════════════════════════════════════════════════════════ */

  var board = {
    draft: {},        // scope → ids array, or null meaning "follow the parent"
    sel: {},          // uid → true, for the bulk picker
    collapsed: {},    // family key → true
    period: null,     // filter; null until read from localStorage
    q: ""             // name search
  };

  var FILTER_KEY = "ei.assign.period";
  function boardPeriod(){
    if(board.period === null){
      try{ board.period = window.localStorage.getItem(FILTER_KEY) || ""; }
      catch(e){ board.period = ""; }
    }
    return board.period;
  }
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
     The same precedence effectiveLists walks, but reading through the
     unsaved draft: edit a period and the students following it must
     redraw immediately, or the board would be lying about what Save is
     going to do. "own" is the distinction the colours draw — an array
     of its own, versus null and inheriting. */
  /* The class default has the same two states every other scope has: a
     set of its own, or nothing — and "nothing" is not an empty list, it
     is the open site. Keeping those apart matters twice over. On a fresh
     install nothing is set, and a row drawn as though it had been
     configured would be a lie about the one setting the whole precedence
     chain rests on. And releasing it has to mean "open the site again",
     not "park everybody": an empty array is a real answer here, and a
     very different one. */
  function liveOwnDefault(){
    if(hasDraft("default")) return board.draft["default"];
    return Array.isArray(classCfg.defaultLists) ? classCfg.defaultLists : null;
  }
  function liveDefault(){
    var own = liveOwnDefault();
    return own === null ? WordLists.ids : own;
  }
  function liveOwnPeriod(p){
    var k = "p:" + p;
    if(hasDraft(k)) return board.draft[k];
    return Array.isArray(classCfg.periodLists[p]) ? classCfg.periodLists[p] : null;
  }
  function livePeriod(p){
    var own = liveOwnPeriod(p);
    return own === null ? liveDefault() : own;
  }
  function liveOwnStudent(uid){
    var k = "s:" + uid;
    if(hasDraft(k)) return board.draft[k];
    var a = assignments[uid];
    if(a && Array.isArray(a.lists)) return a.lists;
    /* A student who hasn't signed in has their own set on their roster
       row instead of in an assignment — same rung, same board cell,
       different document. See saveBody. */
    var r = rosterFor(studentByUid(uid));
    return (r && Array.isArray(r.lists)) ? r.lists : null;
  }
  /* What this student actually has right now, board drafts included.
     The same walk store.js runs — own → roster → sequence → period →
     default — so a cell on this board says what the student's home page
     will say. */
  function liveStudent(uid){
    var own = liveOwnStudent(uid);
    if(own !== null) return own;
    var s = studentByUid(uid);
    var seq = sequenceStateFor(s);
    if(seq) return seq.ids;
    var r = rosterFor(s);
    var p = (assignments[uid] || {}).period || (r && r.period) || null;
    return (p != null && p !== "") ? livePeriod(p) : liveDefault();
  }

  function scopeView(scope){
    if(scope === "default") return liveDefault();
    if(scope.slice(0,2) === "p:") return livePeriod(scope.slice(2));
    return liveStudent(scope.slice(2));
  }
  function scopeIsOwn(scope){
    if(scope === "default") return liveOwnDefault() !== null;
    if(scope.slice(0,2) === "p:") return liveOwnPeriod(scope.slice(2)) !== null;
    return liveOwnStudent(scope.slice(2)) !== null;
  }
  function scopeStored(scope){
    if(scope === "default") return Array.isArray(classCfg.defaultLists) ? classCfg.defaultLists : null;
    if(scope.slice(0,2) === "p:"){
      var v = classCfg.periodLists[scope.slice(2)];
      return Array.isArray(v) ? v : null;
    }
    var a = assignments[scope.slice(2)];
    return (a && Array.isArray(a.lists)) ? a.lists : null;
  }

  // Copy-on-write: the set you start editing is the set they already
  // had, whether they owned it or inherited it.
  function setScope(scope, ids){ board.draft[scope] = ids; }
  function releaseScope(scope){ board.draft[scope] = null; }

  function scopeDirty(scope){
    if(!hasDraft(scope)) return false;
    var d = board.draft[scope], stored = scopeStored(scope);
    if(d === null || stored === null) return d !== stored;
    return !sameIds(d, stored);
  }
  function dirtyScopes(){ return Object.keys(board.draft).filter(scopeDirty); }

  /* ── who's on the board ─────────────────────────────────────────── */
  var NO_PERIOD = " none";     // a filter value no real period can collide with

  function studentPeriod(uid){
    var p = (assignments[uid] || {}).period;
    return p == null || p === "" ? null : p;
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
    return students.filter(function(s){
      if(!matchesQuery(s)) return false;
      var p = studentPeriod(s.uid);
      if(f === "") return true;
      if(f === NO_PERIOD) return p === null;
      return p === f;
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
      td.textContent = txt;
      td.classList.toggle("empty", txt === "—");
      var own = scopeIsOwn(scope);
      /* A cell the course decided rather than a person. Dashed like an
         inherited one, because it IS inherited — from the sequence — and
         carrying the step it came from, so a teacher looking at a row can
         see how far along it is without opening anything. */
      var seq = scope.slice(0,2) === "s:" && !own ? sequenceStateFor(studentByUid(scope.slice(2))) : null;
      td.classList.toggle("own", own);
      td.classList.toggle("inherit", !own);
      td.classList.toggle("seq", !!seq);
      if(seq && !own && txt !== "—"){
        td.innerHTML = esc(txt) + '<span class="seqStepNum">step ' + (seq.stepIndex + 1) + "</span>";
      }
      // "Ana, Red Words List 2: Cards, Match It (inherited)" — an em dash
      // and two emoji are not something to hand a screen reader.
      td.setAttribute("aria-label",
        (rowName[scope] || scope) + ", " + colName[i] + ": " + cellSpoken(scope, col) +
        (seq ? " (from the sequence, step " + (seq.stepIndex + 1) + " of " + seq.steps + ")"
             : own ? "" : " (inherited)"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-ownpill]"), function(el){
      el.hidden = !scopeIsOwn(el.dataset.ownpill);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-from]"), function(el){
      el.textContent = fromLabel(el.dataset.from);
    });
    paintSaveBar();
  }
  // Where a scope's lists come from when it has none of its own.
  function inheritLabel(scope){
    if(scope === "default") return "every list, open to everyone";
    if(scope.slice(0,2) === "p:") return "the class default";
    var p = studentPeriod(scope.slice(2));
    return p ? "period " + p : "the class default";
  }
  function releaseTitle(scope){
    return scope === "default"
      ? "Clear the class default — back to every list, open to everyone"
      : "Hand this back to " + inheritLabel(scope);
  }
  // The line under a row's name, which has to say something different for
  // the one scope that has nothing above it to fall back to.
  function fromLabel(scope){
    if(scope === "default"){
      return scopeIsOwn(scope)
        ? "what everyone gets unless something below overrides it"
        : "nothing set — everyone gets every list";
    }
    return scopeIsOwn(scope) ? "own set" : "follows " + inheritLabel(scope);
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
    var modes = WordLists.modesOf(fam.key);
    var label = fam.title + (fam.lists.length > 1 ? " · List " + col.n : "");

    pop = document.createElement("div");
    pop.className = "abPop";
    pop.innerHTML =
      '<div class="abPopHead">' + esc(label) + "</div>" +
      '<div class="abPopBody">' + modes.map(function(m){
        var id = WordLists.idFor(fam.key, col.n, m.key);
        if(!id) return "";
        var on = scopeView(scope).indexOf(id) !== -1;
        return '<label class="check"><input type="checkbox" data-mode-id="' + esc(id) + '"' + (on ? " checked" : "") +
          "><span>" + esc(m.icon + " " + m.title) + "</span></label>";
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
      WordLists.idsOfList(fam.key, col.n).forEach(function(id){
        var i = ids.indexOf(id);
        if(wanted){ if(i === -1) ids.push(id); }
        else if(i !== -1) ids.splice(i, 1);
      });
      Array.prototype.forEach.call(pop.querySelectorAll("input[data-mode-id]"), function(cb){ cb.checked = wanted; });
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
  function columnToggle(col){
    var ids = col.summary ? WordLists.idsOfFamily(col.fam.key) : WordLists.idsOfList(col.fam.key, col.n);
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
        if(allOn){ if(i !== -1) set.splice(i, 1); }
        else if(i === -1) set.push(id);
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
  // Aliased, not redefined: the student's own browser decides when a
  // list is finished using the same number, and two copies of it is two
  // answers to "has this student moved on".
  var SOLID_ENOUGH = Adaptive.solidEnough;

  /* How far through one list a student is. `share` comes from
     Adaptive.listShare — the same function Adaptive.unlocked uses to
     decide whether a sequence step is finished — so the suggestion this
     dashboard makes and the advance the student's own browser performs
     can never disagree about what "done" means. tests.html runs both
     over the same stats to keep it that way.

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

  /* ---------------- sequences ----------------
     A period may run an ordered course instead of a flat list. Where it
     does, the site advances the student itself — Adaptive.unlocked
     computes their position from their own stats, here and in their own
     browser, from the same function. Nothing is written to move anybody
     on, which is why students can't self-advance: they never write
     assignments/{uid} at all. */
  function sequenceOf(period){
    var steps = classCfg.sequences && classCfg.sequences[period];
    if(!Array.isArray(steps) || !steps.length) return null;
    var on = classCfg.sequenceOn || {};
    if(Object.prototype.hasOwnProperty.call(on, period) && on[period] === false) return null;
    return steps;
  }

  // Whether a period has a course at all, on or off — for the editor,
  // which has to show a switched-off sequence in order to switch it on.
  function sequenceStored(period){
    var steps = classCfg.sequences && classCfg.sequences[period];
    return Array.isArray(steps) && steps.length ? steps : null;
  }
  function sequenceIsOn(period){
    var on = classCfg.sequenceOn || {};
    if(Object.prototype.hasOwnProperty.call(on, period)) return on[period] !== false;
    return !!sequenceStored(period);
  }

  // Where one student is in their period's course, or null.
  function sequenceStateFor(s){
    if(!s) return null;
    var r = rosterFor(s);
    var period = (assignments[s.uid] && assignments[s.uid].period) || (r && r.period) || null;
    var steps = sequenceOf(period);
    if(!steps) return null;
    var startAt = 0;
    if(r && r.start){
      var at = WordLists.stepOf(steps, r.start);
      if(at >= 0) startAt = at;
    }
    var res = Adaptive.unlocked(steps, s.stats || {}, startAt, listTotal);
    res.period = period;
    res.steps = steps.length;
    return res;
  }

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
        if(!toId || have[toId]) return;
        var p = listProgress(stats, fromId);
        if(p.share < SOLID_ENOUGH) return;
        out.push({
          family: fam.key, famTitle: fam.title,
          mode: m.key, modeIcon: m.icon, modeTitle: m.title,
          from: from, to: from + 1, fromId: fromId, toId: toId,
          mastered: p.mastered, total: p.total
        });
      });
    });
    return out;
  }

  /* Every suggestion on the board right now, for the students the filter
     leaves visible — the same bound the column toggles work inside.

     A student whose period runs a sequence is left out: the site has
     already moved them on, and a strip suggesting what has just happened
     by itself is a strip nobody reads twice. */
  function boardSuggestions(){
    var out = [];
    visibleStudents().forEach(function(s){
      if(sequenceStateFor(s)) return;   // the site already moves them on
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

  function suggestionsHtml(sugs){
    if(!sugs.length) return "";
    var rows = sugs.map(function(g, i){
      return '<li class="abSug">' +
        '<span class="abSugWho">' + esc(g.name) + "</span>" +
        '<span class="abSugWhat">' + esc(g.famTitle + " " + g.modeIcon) +
          " · finished <b>List " + g.from + "</b> " +
          '<span class="muted tiny">(' + g.mastered + " of " + g.total + " solid)</span></span>" +
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
      " finished a list and have nothing after it. Adding one puts it in the board below with everything else — " +
      "it isn't written until you Save, and it leaves the finished list on them so those words keep coming round.</p>" +
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
    // The filter is remembered in localStorage, so it can outlive the
    // period it names — a new roster, a renamed section. Left alone it
    // would show an empty board under a select box reading "All periods".
    if(boardPeriod() !== "" && boardPeriod() !== NO_PERIOD && periods.indexOf(boardPeriod()) === -1){
      setBoardPeriod("");
    }
    var cols = boardColumns();
    var vis = visibleStudents();
    var visUid = {}; vis.forEach(function(s){ visUid[s.uid] = true; });

    var filterOpts = ['<option value="">All periods</option>']
      .concat(periods.map(function(p){
        return '<option value="' + esc(p) + '"' + (boardPeriod() === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
      }))
      .concat(['<option value="' + NO_PERIOD + '"' + (boardPeriod() === NO_PERIOD ? " selected" : "") + ">No period yet</option>"])
      .join("");

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
            (folded ? "Show every list in this family" : "Fold this family into one column") + '">' +
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
            (c.summary ? "every list in this family" : "this list") + ' for every student shown">all</button>' +
          "</th>";
      });
    });

    // ---- rows ----
    function cellsFor(scope){
      return cols.map(function(c, i){
        return '<td class="abCell" data-cell="' + esc(scope) + "|" + i + '" tabindex="0"></td>';
      }).join("");
    }
    function scopeRow(scope, cls, label, meta, canRelease){
      return '<tr class="' + cls + '" data-row="' + esc(scope) + '">' +
        '<th class="abName"><div class="abNameIn">' +
          '<div class="abLabel">' + label + "</div>" +
          (meta ? '<div class="abMeta">' + meta + "</div>" : "") +
          (canRelease
            ? '<button type="button" class="abPill" data-release="' + esc(scope) + '" data-ownpill="' + esc(scope) +
              '" title="' + esc(releaseTitle(scope)) + '" hidden>own ↺</button>'
            : "") +
        "</div></th>" + cellsFor(scope) + "</tr>";
    }
    function studentRow(s){
      var scope = "s:" + s.uid;
      var n = noteOf(s.uid);
      var name = esc(s.name || s.email || s.uid) +
        (n ? ' <span class="noteDot" title="' + esc(n) + '">✎</span>' : "");
      var label = '<label class="abPick"><input type="checkbox" data-pick="' + esc(s.uid) + '"' +
        (board.sel[s.uid] ? " checked" : "") + "><span>" + name + "</span></label>";
      return scopeRow(scope, "abStudent", label, '<span class="abFrom" data-from="' + esc(scope) + '"></span>', true);
    }

    var rows = scopeRow("default", "abDefault", "Class default",
      '<span class="abFrom" data-from="default"></span>', true);

    periods.filter(function(p){
      return boardPeriod() === "" || boardPeriod() === p;
    }).forEach(function(p){
      var kids = vis.filter(function(s){ return studentPeriod(s.uid) === p; });
      // An empty period is worth a row only if it has a set of its own to
      // show; otherwise it's a label with nothing under it.
      if(!kids.length && !Array.isArray(classCfg.periodLists[p]) && boardPeriod() === "") return;
      rows += scopeRow("p:" + p, "abPeriod", "Period " + esc(p),
        kids.length + (kids.length === 1 ? " student" : " students"), true);
      rows += kids.map(studentRow).join("");
    });

    var loose = vis.filter(function(s){ return studentPeriod(s.uid) === null; });
    if(loose.length && (boardPeriod() === "" || boardPeriod() === NO_PERIOD)){
      rows += '<tr class="abGroup"><th class="abName"><div class="abNameIn">' +
        '<div class="abLabel">No period yet</div>' +
        '<div class="abMeta">following the class default</div></div></th>' +
        '<td colspan="' + cols.length + '"></td></tr>';
      rows += loose.map(studentRow).join("");
    }

    var nSel = Object.keys(board.sel).filter(function(u){ return board.sel[u] && visUid[u]; }).length;
    var sugs = boardSuggestions();

    $("tBody").innerHTML =
      suggestionsHtml(sugs) +
      '<div class="panel abPanel"><h2>Assign</h2>' +
        '<p class="note">Every assignment in the class at once. A <b>dashed grey</b> cell is inherited — the student is following ' +
        'their period, or the period is following the class default. A <b>gold</b> cell is a set of their own. ' +
        'Change any cell on someone who is inheriting and they get their own copy of what they already had, ' +
        'which is exactly what saving the picker on their page has always done; the <b>own ↺</b> button hands them back. ' +
        "Nothing is written until you press Save.</p>" +

        '<div class="abTools">' +
          '<select class="sel" id="abPeriod">' + filterOpts + "</select>" +
          '<input class="txt" id="abQ" placeholder="Find a student" value="' + esc(board.q) + '" style="width:190px">' +
          '<button class="btn ghost sm" id="abBulk"' + (nSel ? "" : " disabled") + ">Set lists for " + nSel + " selected…</button>" +
          '<label class="check abAll"><input type="checkbox" id="abSelAll">' +
            "<span>Select all " + vis.length + " shown</span></label>" +
        "</div>" +

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
    bindAssign(cols);
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

  function bindAssign(cols){
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
      var rel = t.closest ? t.closest("[data-release]") : null;
      if(rel){
        releaseScope(rel.dataset.release);
        closePop();
        return paintCells();
      }
      if(t.dataset && t.dataset.pick !== undefined) return;   // the row's own checkbox
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
      // Rows that actually hold cells: the "No period yet" heading is a
      // row too, and arrowing down should skip straight over it.
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
      if(!cb.dataset || cb.dataset.pick === undefined) return;
      board.sel[cb.dataset.pick] = cb.checked;
      renderAssign();
    });

    $("abPeriod").addEventListener("change", function(){ setBoardPeriod(this.value); closePop(); renderAssign(); });

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
    if(e.key === "Escape"){ closePop(); closeBulk(); }
  });
  document.addEventListener("click", function(e){
    if(!pop || pop.contains(e.target)) return;
    if(e.target.closest && e.target.closest("[data-cell]")) return;
    closePop();
  }, true);

  /* ── the bulk picker ──────────────────────────────────────────────
     Tick a few students, press the button, and set all of them at once
     with the same picker every other scope uses. Seeded from the first
     selected student's effective set, because "these four should have
     what she has" is the request this exists to answer. */
  var bulkWrap = null;
  function closeBulk(){
    if(bulkWrap && bulkWrap.parentNode) bulkWrap.parentNode.removeChild(bulkWrap);
    bulkWrap = null;
  }
  function openBulk(){
    var uids = visibleStudents().map(function(s){ return s.uid; }).filter(function(u){ return board.sel[u]; });
    if(!uids.length) return;
    closeBulk();
    var seed = liveStudent(uids[0]);
    var names = uids.map(function(u){
      var s = studentByUid(u);
      return s ? (s.name || s.email) : u;
    });

    bulkWrap = document.createElement("div");
    bulkWrap.className = "abModal";
    bulkWrap.innerHTML =
      '<div class="abModalBox" role="dialog" aria-modal="true">' +
        "<h2>Set lists for " + uids.length + (uids.length === 1 ? " student" : " students") + "</h2>" +
        '<p class="note">' + esc(names.slice(0, 6).join(", ")) + (names.length > 6 ? " and " + (names.length - 6) + " more" : "") +
        ". Starting from what <b>" + esc(names[0]) + "</b> has now. Applying makes this each of their own set; " +
        "it still isn't written until you Save the board.</p>" +
        pickerHtml("bulk", seed, true) +
        '<div class="rowActions">' +
          '<button class="btn sm" id="abApply">Apply to ' + uids.length + "</button>" +
          '<button class="btn ghost sm" id="abCancel">Cancel</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(bulkWrap);
    bindPickers(bulkWrap);
    bulkWrap.addEventListener("click", function(e){
      if(e.target === bulkWrap) closeBulk();
    });
    document.getElementById("abCancel").addEventListener("click", closeBulk);
    document.getElementById("abApply").addEventListener("click", function(){
      var ids = scopeSelection("bulk");
      uids.forEach(function(u){ setScope("s:" + u, ids.slice()); });
      closeBulk();
      paintCells();
    });
  }

  /* ── saving ───────────────────────────────────────────────────────
     One batch. A teacher moving six students onto List 4 should not be
     able to end up with three of them moved: either the whole board
     lands or none of it does, and a failure puts every local copy back
     exactly as it was, with the draft intact so they can retry without
     re-ticking anything. */
  /* What the pending edits amount to on the wire, as data rather than as
     calls: one `assignments/{uid}` merge per changed student, and at most
     ONE `config/class` merge however many periods and the default were
     touched. Pure, and separate from saveBoard, because the shape of
     these two writes is the part that has to be right — a stray field in
     the student body would overwrite a period, and a second config write
     would defeat the batch. `now` is a parameter so a test can pin it. */
  function saveBody(scopes, now){
    var out = { students: {}, roster: {}, config: null };
    var periodPatch = {}, touchedCfg = false;
    scopes.forEach(function(scope){
      var val = board.draft[scope];
      if(scope === "default"){
        out.config = out.config || {};
        out.config.defaultLists = val;
        touchedCfg = true;
      } else if(scope.slice(0,2) === "p:"){
        periodPatch[scope.slice(2)] = val;
        touchedCfg = true;
      } else if(isPending(scope.slice(2))){
        // No uid yet, so the lists ride on the roster row until there is
        // one. Same two fields, different collection.
        out.roster[emailOfPending(scope.slice(2))] = { lists: val, updatedAt: now };
      } else {
        // These two fields and no others: the student's period lives in
        // the same document and must survive the write.
        out.students[scope.slice(2)] = { lists: val, updatedAt: now };
      }
    });
    if(touchedCfg){
      out.config = out.config || {};
      if(Object.keys(periodPatch).length) out.config.periodLists = periodPatch;
    }
    return out;
  }

  function saveBoard(){
    var scopes = dirtyScopes();
    if(!scopes.length) return;
    var note = $("abNote");
    var undo = { def: classCfg.defaultLists, periods: {}, students: {}, roster: {} };
    var body = saveBody(scopes, Date.now());
    var batch = db.batch();

    // Local state moves first, so the board redraws without waiting on
    // school Wi-Fi; `undo` is what puts it all back if the batch fails.
    scopes.forEach(function(scope){
      var val = board.draft[scope];
      if(scope === "default"){
        classCfg.defaultLists = val;
      } else if(scope.slice(0,2) === "p:"){
        var p = scope.slice(2);
        undo.periods[p] = classCfg.periodLists[p];
        classCfg.periodLists[p] = val;
      } else {
        var uid = scope.slice(2);
        /* A student who hasn't signed in has no uid to write an
           assignment against, so their lists go on their roster row and
           store.js reads them from there on the first sign-in. Same
           board, same cell, different document. */
        if(isPending(uid)){
          var em = emailOfPending(uid);
          undo.roster[em] = roster[em] ? JSON.parse(JSON.stringify(roster[em])) : null;
          if(!roster[em]) roster[em] = { email: em };
          roster[em].lists = val;
        } else {
          undo.students[uid] = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
          var a = assignments[uid] || (assignments[uid] = {});
          a.lists = val;
          a.updatedAt = body.students[uid].updatedAt;
        }
      }
    });
    Object.keys(body.students).forEach(function(uid){
      batch.set(db.collection("assignments").doc(uid), body.students[uid], { merge:true });
    });
    Object.keys(body.roster).forEach(function(email){
      batch.set(db.collection("roster").doc(email), body.roster[email], { merge:true });
    });
    if(body.config) batch.set(db.collection("config").doc("class"), body.config, { merge:true });

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
      classCfg.defaultLists = undo.def;
      for(var p in undo.periods) classCfg.periodLists[p] = undo.periods[p];
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
  var troublePeriod = "";

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
    var periods = allPeriods();
    var pool = students.filter(function(s){
      return !troublePeriod || (assignments[s.uid] || {}).period === troublePeriod;
    });

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

    var opts = ['<option value="">All periods</option>'].concat(periods.map(function(p){
      return '<option value="' + esc(p) + '"' + (troublePeriod === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
    })).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Trouble spots</h2>' +
        '<p class="note">Words the class is getting wrong, hardest first — sorted by how many students are struggling with each, ' +
        "not by raw accuracy, so one student's bad day doesn't top the list. " +
        "Words with fewer than " + MIN_SAMPLE + " attempts across the group are left out. " +
        "Where Say It logged what the mic heard, the most common mishearing is under the word.</p>" +
        '<div class="rowActions" style="margin-bottom:18px"><select class="sel" id="tTroublePeriod">' + opts + "</select></div>" +
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

    $("tTroublePeriod").addEventListener("change", function(){
      troublePeriod = this.value;
      render();
    });
  }

  /* ── the testing seam ─────────────────────────────────────────────
     The board's rules — the precedence walk, copy-on-write, what an
     "all" toggle reaches, the shape of the two writes — are pure
     functions of a class's state, and they are the parts that would
     quietly ruin a roster if they were wrong. So they're reachable from
     tests.html, the same way each engine exposes its pure helpers.
     `feed` is the only way in: it stands in for loadAll(), which is the
     one thing here that needs Firestore. */
  window.EITeacher = {
    _internals: {
      modeHeard: modeHeard,
      importBody: importBody,
      sequenceOf: sequenceOf,
      sequenceIsOn: sequenceIsOn,
      sequenceStateFor: sequenceStateFor,
      rosterStatus: rosterStatus,
      isPending: isPending,
      studentUids: function(){ return students.map(function(s){ return s.uid; }); },
      patternRows: patternRows,
      kindText: kindText,
      feed: function(st){
        st = st || {};
        students = st.students || [];
        assignments = st.assignments || {};
        classCfg = {
          periodLists: (st.classCfg && st.classCfg.periodLists) || {},
          defaultLists: (st.classCfg && Array.isArray(st.classCfg.defaultLists)) ? st.classCfg.defaultLists : null,
          periods: (st.classCfg && st.classCfg.periods) || [],
          sequences: (st.classCfg && st.classCfg.sequences) || {},
          sequenceOn: (st.classCfg && st.classCfg.sequenceOn) || {}
        };
        notes = st.notes || {};
        roster = st.roster || {};
        rosterReadable = st.rosterReadable !== false;
        // Same fold the real load does, so a test sees the class the way
        // the dashboard does: signed-in students and roster rows together.
        if(st.roster) addPendingStudents();
        board.draft = {}; board.sel = {}; board.collapsed = {};
        board.period = st.period || "";      // set directly: no localStorage in tests
        board.q = st.q || "";
      },
      board: board,
      effectiveLists: effectiveLists,
      liveDefault: liveDefault,
      liveOwnDefault: liveOwnDefault,
      fromLabel: fromLabel,
      livePeriod: livePeriod,
      liveStudent: liveStudent,
      scopeView: scopeView,
      scopeIsOwn: scopeIsOwn,
      scopeDirty: scopeDirty,
      dirtyScopes: dirtyScopes,
      setScope: setScope,
      releaseScope: releaseScope,
      visibleStudents: visibleStudents,
      boardColumns: boardColumns,
      cellText: cellText,
      cellSpoken: cellSpoken,
      colLabel: colLabel,
      columnToggle: columnToggle,
      readyToAdvance: readyToAdvance,
      noteOf: noteOf,
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
      bindPickers: bindPickers
    }
  };

})();
