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
  var classCfg = { periodLists:{}, defaultLists:null, periods:[] };
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
        db.collection("config").doc("class").get()
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
          totals: d.totals || { n:0, r:0 },
          recent: Array.isArray(d.recent) ? d.recent : [],
          lastSeen: d.lastSeen || 0
        });
      });
      assignments = {};
      snaps[1].forEach(function(doc){ assignments[doc.id] = doc.data() || {}; });
      var c = snaps[2].exists ? (snaps[2].data() || {}) : {};
      classCfg = {
        periodLists: c.periodLists || {},
        defaultLists: Array.isArray(c.defaultLists) ? c.defaultLists : null,
        periods: Array.isArray(c.periods) ? c.periods : []
      };
      // Sort by display name, falling back to the email local part — an
      // account with no display name shouldn't sink to the bottom.
      students.sort(function(a,b){
        var an = (a.name || a.email).toLowerCase(), bn = (b.name || b.email).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
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
  function effectiveLists(uid){
    var a = assignments[uid];
    if(a && Array.isArray(a.lists)) return { ids: a.lists, from: "student" };
    var p = a && a.period;
    if(p != null && Array.isArray(classCfg.periodLists[p])) return { ids: classCfg.periodLists[p], from: "period " + p };
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
    return '<div class="who">' + av + "<div style=\"min-width:0\">" +
      '<div class="nm">' + esc(s.name || s.email || s.uid) + "</div>" +
      '<div class="em">' + esc(s.email) + "</div></div></div>";
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

  /* ---------------- students ---------------- */
  function renderRoster(){
    if(!students.length){
      $("tBody").innerHTML = '<div class="panel"><h2>Nobody yet</h2>' +
        '<p class="note">A student appears here the first time they sign in and play a round. ' +
        "Until then there's nothing to assign to.</p></div>";
      return;
    }
    var rows = students.map(function(s){
      var sum = Adaptive.summarize(s.stats);
      var eff = effectiveLists(s.uid);
      var a = assignments[s.uid] || {};
      return "<tr class=\"clickable\" data-uid=\"" + esc(s.uid) + "\">" +
        "<td>" + whoHtml(s) + "</td>" +
        '<td>' + (a.period ? '<span class="pill">Period ' + esc(a.period) + "</span>" : '<span class="muted tiny">not set</span>') + "</td>" +
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
      '<p class="note">Click a student for their worst words and their list assignment. ' +
      '“Solid” is a word answered right, first try, enough times in a row to have earned a long rest; ' +
      '“shaky” is one under 60&nbsp;% accuracy.</p>' +
      '<div class="tableScroll"><table class="t"><thead><tr>' +
      "<th>Student</th><th>Period</th><th>Lists</th>" +
      '<th class="num">Answers</th><th class="num">Accuracy</th><th class="num">Solid</th><th class="num">Shaky</th><th>Last active</th>' +
      "</tr></thead><tbody>" + rows + "</tbody></table></div></div>";

    Array.prototype.forEach.call(document.querySelectorAll("#tBody tr.clickable"), function(tr){
      tr.addEventListener("click", function(){ detailUid = tr.dataset.uid; render(); });
    });
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
        '<td class="num">' + ls.mastered + " / " + total + "</td>" +
        '<td class="num">' + (ls.struggling ? '<span class="pill bad">' + ls.struggling + "</span>" : '<span class="muted">0</span>') + "</td></tr>";
    }).filter(Boolean).join("");

    var worst = Adaptive.rank(s.stats).slice(0, 30).map(function(r){
      var parsed = Adaptive.parseKey(r.word);
      var l = WordLists.byId(parsed.listId);
      var pct = Math.round(r.acc * 100);
      var cls = pct >= 80 ? "" : pct >= 60 ? "warn" : "bad";
      return '<div class="wordchip ' + cls + '">' + esc(parsed.word) +
        "<small>" + r.stat.r + "/" + r.stat.n + " · " + esc(l ? l.title : parsed.listId) + "</small></div>";
    }).join("");

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

      '<div class="panel"><h2>Hardest words</h2>' +
        '<p class="note">Worst first — right answers out of attempts, counting only first-try answers. ' +
        "These are the words the site is already showing them most often.</p>" +
        (worst ? '<div class="wordchips">' + worst + "</div>" : '<div class="empty">No practice recorded yet.</div>') +
      "</div>" +

      (perList ? '<div class="panel"><h2>By list</h2><div class="tableScroll"><table class="t"><thead><tr>' +
        '<th>List</th><th class="num">Answers</th><th class="num">Accuracy</th><th class="num">Solid</th><th class="num">Shaky</th>' +
        "</tr></thead><tbody>" + perList + "</tbody></table></div></div>" : "");

    $("tBack").addEventListener("click", function(){ detailUid = null; render(); });
    $("tSaveA").addEventListener("click", function(){ saveStudentAssignment(s.uid); });
    $("tClearA").addEventListener("click", function(){ saveStudentAssignment(s.uid, true); });
    bindPickers();
  }

  function checkedLists(){ return scopeSelection("student"); }

  /* Writes are optimistic — the local copy updates first so the UI never
     stalls on school Wi-Fi — and roll back on failure, because a silent
     failure here means a teacher believes a student was assigned
     something they weren't. */
  function saveStudentAssignment(uid, clearLists){
    var note = $("tANote");
    var period = ($("tNewPeriod").value || "").trim() || $("tPeriod").value || null;
    var lists = clearLists ? null : checkedLists();
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

  /* ---------------- periods & lists ---------------- */
  function renderGroups(){
    var periods = allPeriods();

    var periodPanels = periods.map(function(p){
      var sel = Array.isArray(classCfg.periodLists[p]) ? classCfg.periodLists[p] : null;
      var count = students.filter(function(s){ return (assignments[s.uid] || {}).period === p; }).length;
      return '<div class="panel"><h2>Period ' + esc(p) + "</h2>" +
        '<p class="note">' + count + " student" + (count === 1 ? "" : "s") + " · " +
        (sel ? "its own list set" : "following the class default") + "</p>" +
        pickerHtml("p:" + p, sel, Array.isArray(classCfg.defaultLists) ? false : true) +
        '<div class="rowActions">' +
          '<button class="btn sm" data-save="p:' + esc(p) + '">Save period ' + esc(p) + "</button>" +
          '<button class="btn ghost sm" data-clear="p:' + esc(p) + '">Use class default</button>' +
          '<span class="saveNote" data-note="p:' + esc(p) + '"></span>' +
        "</div></div>";
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
  function liveDefault(){
    if(hasDraft("default")) return board.draft["default"] || [];
    return Array.isArray(classCfg.defaultLists) ? classCfg.defaultLists : WordLists.ids;
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
    return (a && Array.isArray(a.lists)) ? a.lists : null;
  }
  function liveStudent(uid){
    var own = liveOwnStudent(uid);
    if(own !== null) return own;
    var p = (assignments[uid] || {}).period;
    return p != null ? livePeriod(p) : liveDefault();
  }

  function scopeView(scope){
    if(scope === "default") return liveDefault();
    if(scope.slice(0,2) === "p:") return livePeriod(scope.slice(2));
    return liveStudent(scope.slice(2));
  }
  // The class default is the bottom of the chain: it has nothing to
  // inherit from, so it always counts as its own.
  function scopeIsOwn(scope){
    if(scope === "default") return true;
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
     What a scope has for one list, as the icons of the modes that are
     on. A collapsed family's cell borrows describeFamily instead, so a
     folded column still says something true. */
  function cellText(scope, col){
    var set = scopeView(scope);
    if(col.summary){
      return WordLists.describeFamily(col.fam.key, set) || "—";
    }
    var icons = WordLists.modesOf(col.fam.key).filter(function(m){
      var id = WordLists.idFor(col.fam.key, col.n, m.key);
      return id && set.indexOf(id) !== -1;
    }).map(function(m){ return m.icon; }).join("");
    return icons || "—";
  }

  /* Rewrite every cell, pill and counter from the live state. Cheaper
     and far less disruptive than re-rendering the table: the popover
     stays open, the scroll position holds, and a board of 40 students by
     15 lists is 600 short string writes. */
  function paintCells(){
    var cols = boardColumns();
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-cell]"), function(td){
      var parts = td.dataset.cell.split("|");
      var scope = parts[0];
      var col = cols[Number(parts[1])];
      if(!col) return;
      var txt = cellText(scope, col);
      td.textContent = txt;
      td.classList.toggle("empty", txt === "—");
      td.classList.toggle("own", scopeIsOwn(scope));
      td.classList.toggle("inherit", !scopeIsOwn(scope));
    });
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-ownpill]"), function(el){
      el.hidden = !scopeIsOwn(el.dataset.ownpill);
    });
    Array.prototype.forEach.call(document.querySelectorAll("#abGrid [data-from]"), function(el){
      el.textContent = scopeIsOwn(el.dataset.from) ? "own set" : "follows " + inheritLabel(el.dataset.from);
    });
    paintSaveBar();
  }
  function inheritLabel(scope){
    if(scope.slice(0,2) === "p:") return "class default";
    var p = studentPeriod(scope.slice(2));
    return p ? "period " + p : "class default";
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
              '" title="Hand this back to ' + esc(inheritLabel(scope)) + '" hidden>own ↺</button>'
            : "") +
        "</div></th>" + cellsFor(scope) + "</tr>";
    }
    function studentRow(s){
      var scope = "s:" + s.uid;
      var name = esc(s.name || s.email || s.uid);
      var label = '<label class="abPick"><input type="checkbox" data-pick="' + esc(s.uid) + '"' +
        (board.sel[s.uid] ? " checked" : "") + "><span>" + name + "</span></label>";
      return scopeRow(scope, "abStudent", label, '<span class="abFrom" data-from="' + esc(scope) + '"></span>', true);
    }

    var rows = scopeRow("default", "abDefault", "Class default",
      '<span class="abFrom">what everyone gets unless something below overrides it</span>', false);

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

    $("tBody").innerHTML =
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

    // A cell is focusable, so Enter and Space open its modes — the board
    // is navigable by keyboard even without arrow-key movement.
    grid.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      var cell = e.target.closest ? e.target.closest("[data-cell]") : null;
      if(!cell) return;
      e.preventDefault();
      cell.click();
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
    var out = { students: {}, config: null };
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
    var undo = { def: classCfg.defaultLists, periods: {}, students: {} };
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
        undo.students[uid] = assignments[uid] ? JSON.parse(JSON.stringify(assignments[uid])) : null;
        var a = assignments[uid] || (assignments[uid] = {});
        a.lists = val;
        a.updatedAt = body.students[uid].updatedAt;
      }
    });
    Object.keys(body.students).forEach(function(uid){
      batch.set(db.collection("assignments").doc(uid), body.students[uid], { merge:true });
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
      if(note){ note.className = "saveNote err"; note.textContent = "Nothing saved — check the network and try again."; }
    });
  }

  /* ---------------- trouble spots ---------------- */
  var troublePeriod = "";
  var MIN_SAMPLE = 3;   // a word nobody has really attempted isn't a trouble spot

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
        var a = agg[key] || (agg[key] = { n:0, r:0, students:0, missers:0 });
        a.n += st.n; a.r += st.r; a.students += 1;
        if(st.w > 0 && st.r / st.n < 0.7) a.missers += 1;
      }
    });

    var rows = Object.keys(agg).map(function(key){
      var a = agg[key], parsed = Adaptive.parseKey(key);
      return { key:key, word:parsed.word, listId:parsed.listId, acc:a.r/a.n, n:a.n, students:a.students, missers:a.missers };
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
        "<small>" + pct + "% · " + r.missers + " of " + r.students + " struggling · " + esc(l ? l.title : r.listId) + "</small></div>";
    }).join("");

    var opts = ['<option value="">All periods</option>'].concat(periods.map(function(p){
      return '<option value="' + esc(p) + '"' + (troublePeriod === p ? " selected" : "") + ">Period " + esc(p) + "</option>";
    })).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Trouble spots</h2>' +
        '<p class="note">Words the class is getting wrong, hardest first — sorted by how many students are struggling with each, ' +
        "not by raw accuracy, so one student's bad day doesn't top the list. " +
        "Words with fewer than " + MIN_SAMPLE + " attempts across the group are left out.</p>" +
        '<div class="rowActions" style="margin-bottom:18px"><select class="sel" id="tTroublePeriod">' + opts + "</select></div>" +
        (chips ? '<div class="wordchips">' + chips + "</div>"
               : '<div class="empty">Nothing to show yet — students need a few rounds of practice first.</div>') +
      "</div>";

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
      feed: function(st){
        st = st || {};
        students = st.students || [];
        assignments = st.assignments || {};
        classCfg = {
          periodLists: (st.classCfg && st.classCfg.periodLists) || {},
          defaultLists: (st.classCfg && Array.isArray(st.classCfg.defaultLists)) ? st.classCfg.defaultLists : null,
          periods: (st.classCfg && st.classCfg.periods) || []
        };
        board.draft = {}; board.sel = {}; board.collapsed = {};
        board.period = st.period || "";      // set directly: no localStorage in tests
        board.q = st.q || "";
      },
      board: board,
      effectiveLists: effectiveLists,
      liveDefault: liveDefault,
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
      columnToggle: columnToggle,
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
