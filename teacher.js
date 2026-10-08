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
              their worst words, list by list, and their games.
   Assign     every student's games as one grid: students down the side,
              lists across the top, one batched Save at the bottom.
   Periods    importing the roster, and which period each student is in.
              Periods only group students on this page — they never decide
              what anybody sees.
   Trouble    the same words, aggregated across the class: what to teach
              tomorrow, rather than who to talk to.

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
  var classCfg = { periods:[] };   // config/class: the named periods, nothing else
  var view = "roster";
  var stepsPeriod = "";       // the Students tab's own period filter
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
           firestore.rules. */
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
        roster[String(doc.id).toLowerCase()] = rosterRowOf(doc.id, doc.data() || {});
      });
      var c = snaps[2].exists ? (snaps[2].data() || {}) : {};
      classCfg = { periods: Array.isArray(c.periods) ? c.periods : [] };
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
  // One stored roster document as the dashboard holds it.
  function rosterRowOf(id, d){
    d = d || {};
    return {
      email: String(id).toLowerCase(),
      name: d.name || "",
      id: d.id || "",
      period: d.period == null ? "" : String(d.period),
      lists: Array.isArray(d.lists) ? d.lists : null,
      importedAt: d.importedAt || 0
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
    var body = p.rows.map(function(r){
      var st = rosterStatus(r);
      return "<tr><td>" + esc(r.name || "—") + "</td>" +
        '<td class="muted tiny">' + esc(r.email) + "</td>" +
        "<td>" + (r.period ? '<span class="pill">' + esc(r.period) + "</span>" : '<span class="muted tiny">—</span>') + "</td>" +
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
      '<div class="tableScroll" style="max-height:46vh"><table class="t"><thead><tr>' +
      "<th>Name</th><th>Signs in as</th><th>Period</th><th>Status</th>" +
      "</tr></thead><tbody>" + body + "</tbody></table></div>";
    document.getElementById("riGo").disabled = !p.rows.length;
    document.getElementById("riGo").textContent = "Import " + p.rows.length +
      (p.rows.length === 1 ? " student" : " students");
  }

  function readImport(text){
    importParsed = GameCore.parseRoster(text);
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
        "It needs an <b>ID number</b> column and a <b>name</b>; a <b>period</b> is used if it's there. " +
        "Students sign in as <b>&lt;ID number&gt;@seq.org</b>, which is how a row and an account find each other. " +
        "You choose their games afterwards, on the Assign tab.</p>" +
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
  function importBody(rows, now){
    var out = { roster: {}, periods: [], assignments: {} };
    var known = {};
    allPeriods().forEach(function(p){ known[p] = true; });
    rows.forEach(function(r){
      var doc = { name: r.name, id: r.id, period: r.period, importedAt: now };
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
  function pickerHtml(scopeId, selected){
    var on = function(id){ return (selected || []).indexOf(id) !== -1; };
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
    // Pending students are folded into `students`, but they have not
    // signed in — this line said "30 students have signed in" with an
    // empty class and a freshly imported roster.
    var n = students.filter(function(s){ return !s.pending; }).length;
    $("tSub").textContent = n
      ? n + (n === 1 ? " student has" : " students have") + " signed in · " + allPeriods().length + " period" + (allPeriods().length === 1 ? "" : "s")
      : "No students have signed in yet.";
  }

  function bindTabs(){
    Array.prototype.forEach.call(document.querySelectorAll("#tTabs .tab"), function(b){
      b.addEventListener("click", function(){ switchView(b.dataset.view); });
    });
  }

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
    Array.prototype.forEach.call(document.querySelectorAll("#tTabs .tab"), function(x){
      x.classList.toggle("on", x.dataset.view === v);
    });
    render();
    window.scrollTo(0, 0);
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
        (assignments[s.uid] || {}).period || (rosterFor(s) && rosterFor(s).period) || "",
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
      $("tBody").innerHTML = '<div class="panel"><h2>Get started</h2>' +
        '<ol class="steps">' +
          "<li><b>Import your roster</b> on the Periods tab. Your students show up here before they ever sign in.</li>" +
          "<li><b>Give each student their games</b> on the Assign tab. A student sees only what you give them.</li>" +
          "<li><b>Students sign in</b> with their school account — their ID number @seq.org.</li>" +
        "</ol>" +
        '<div class="rowActions"><button class="btn sm" id="tGoGroups">Import a roster →</button></div></div>';
      $("tGoGroups").addEventListener("click", function(){ switchView("groups"); });
      return;
    }
    var waiting = students.filter(function(s){ return s.pending; }).length;
    var bare = students.filter(function(s){ return !effectiveLists(s.uid).ids.length; });
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
    var stepOpts = ['<option value="">All periods</option>'].concat(allPeriods().map(function(p){
      return '<option value="' + esc(p) + '"' + (stepsPeriod === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
    })).join("");
    var stepsHtml = steps.map(function(r){
      return '<li class="nsRow"><span class="nsWho">' + esc(r.name) +
        (r.period ? ' <span class="muted tiny">P' + esc(r.period) + "</span>" : "") + "</span>" +
        '<span class="nsText">' + esc(r.step.text) + "</span>" +
        (r.step.addId ? '<button class="pkMini" data-nsadd="' + esc(r.uid) + '|' + esc(r.step.addId) +
          '">Add ' + esc((WordLists.modeOf((WordLists.byId(r.step.addId) || {}).mode) || {}).title || "it") + "</button>" : "") +
        "</li>";
    }).join("");

    $("tBody").innerHTML =
      (bare.length ? '<div class="panel callout"><p><b>' + bare.length +
        (bare.length === 1 ? " student has" : " students have") + " no games yet.</b> " +
        "They see an empty home page until you give them some.</p>" +
        '<button class="btn sm" id="tGoAssign">Assign games →</button></div>' : "") +
      '<div class="panel"><h2>What should change</h2>' +
        '<p class="note">At most one suggestion per student, worked out from their practice. ' +
        "Most days most of the class isn't listed.</p>" +
        '<div class="rowActions" style="margin-bottom:14px"><select class="sel" id="tStepsPeriod">' + stepOpts + "</select></div>" +
        (stepsHtml ? '<ul class="nsList">' + stepsHtml + "</ul>"
                   : '<div class="empty">Nothing to change right now.</div>') +
      "</div>" +

      '<div class="panel"><h2>Students</h2>' +
      (waiting ? '<p class="note"><b>' + waiting + (waiting === 1 ? " student on the roster hasn\u2019t" : " students on the roster haven\u2019t") +
        ' signed in yet</b> — greyed out below. You can give them games now; ' +
        "they'll be waiting the first time they sign in.</p>" : "") +
      '<p class="note">Click a student to see their hardest words and change their games. ' +
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
    $("tStepsPeriod").addEventListener("change", function(){ stepsPeriod = this.value; render(); });
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
      if(!l) return null;
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
      var r = rosterFor(s);
      var period = (assignments[s.uid] || {}).period || (r && r.period) || "";
      if(stepsPeriod && period !== stepsPeriod) return;
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
        "a student handles connected text. Those want their own probe.</p>" +
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
            : "Didn't save — the roster rules aren't published yet (Firebase console → Firestore → Rules).";
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
      db.collection("roster").doc(em).set({ period: period || "", updatedAt: Date.now() }, { merge:true })
        .catch(function(){
          if(wasRow) roster[em] = wasRow; else delete roster[em];
          render();
        });
      return;
    }

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
    var a = assignments[uid] || {};
    var r = rosterFor(studentByUid(uid));
    var p = a.period || (r && r.period);
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
        if(!toId || have[toId]) return;
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
        "Nothing is saved until you press <b>Save</b>.</p>" +
        legendHtml() +

        '<div class="abTools">' +
          '<select class="sel" id="abPeriod" aria-label="Show period">' + filterOpts + "</select>" +
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
    if(e.key === "Escape"){ closePop(); closeBulk(); }
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
    if(how === "replace") return ids.slice();
    ids.forEach(function(id){
      var i = out.indexOf(id);
      if(how === "add"){ if(i === -1) out.push(id); }
      else if(how === "remove"){ if(i !== -1) out.splice(i, 1); }
    });
    return out;
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
        pickerHtml("bulk", []) +
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
      if(isPending(uid)) out.roster[emailOfPending(uid)] = { lists: val, updatedAt: now };
      // These two fields and no others: the period lives in the same
      // document and must survive the write.
      else out.students[uid] = { lists: val, updatedAt: now };
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
      return !troublePeriod || studentPeriod(s.uid) === troublePeriod;
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
        classCfg = { periods: (st.classCfg && st.classCfg.periods) || [] };
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
