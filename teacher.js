/* ════════════════════════════════════════════════════════════════════
   teacher.js — the dashboard. One account only (TEACHER_EMAIL).

   Adapted from the guitar-class site's teacher.js, and it inherits that
   file's central caveat, worth repeating because it is the thing people
   get wrong about client-side dashboards:

     THE GATE ON THIS PAGE IS COSMETIC. Everything here runs in the
     student's own browser and can be reached from DevTools. What
     actually stops a student reading the class's work is
     firestore.rules — the database simply refuses to answer. This file
     shows a friendly "wrong account" panel so the real teacher knows
     they're signed in as the wrong Google account; it is not security.

   ── The three things it does ──────────────────────────────────────────
   Students   roster with accuracy and activity → per-student detail:
              their worst words, list by list, and their assignment.
   Periods    which lists each period gets, and which period each student
              is in. A student's own assignment overrides their period's,
              which overrides the class default — see
              EIStore.effectiveLists, which is the one place that
              precedence is written down.
   Trouble    the same words, aggregated across the class: what to teach
              tomorrow, rather than who to talk to.

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
          "The dashboard belongs to <b>" + esc(typeof TEACHER_EMAIL !== "undefined" ? TEACHER_EMAIL : "the teacher account") + "</b>.</p>" +
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
    $("tBody").innerHTML = '<div class="panel"><h2>Couldn\'t load the class</h2>' +
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
    if(view === "roster") return detailUid ? renderDetail() : renderRoster();
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
        "<td>" + eff.ids.length + ' <span class="muted tiny">(' + esc(eff.from) + ")</span></td>" +
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

    var listChecks = WordLists.all.map(function(l){
      var on = eff.ids.indexOf(l.id) !== -1;
      return '<label class="check"><input type="checkbox" data-list="' + esc(l.id) + '"' + (on ? " checked" : "") + ">" +
        "<span>" + esc(l.icon + " " + l.title) +
        '<span class="sub2">' + WordLists.wordsOf(l.id).length + " words</span></span></label>";
    }).join("");

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
        '<p class="note">Ticking boxes here sets this student\'s OWN list, which overrides their period. ' +
        'Currently coming from: <b>' + esc(eff.from) + "</b>. " +
        '“Use my period’s lists” hands them back to the group.</p>' +
        '<div class="rowActions" style="margin-bottom:16px">' +
          '<label class="muted tiny" for="tPeriod">Period</label>' +
          '<select class="sel" id="tPeriod">' + periodOpts + "</select>" +
          '<input class="txt" id="tNewPeriod" placeholder="or type a new one" style="width:170px">' +
        "</div>" +
        '<div class="listGrid" id="tLists">' + listChecks + "</div>" +
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
  }

  function checkedLists(){
    var ids = [];
    Array.prototype.forEach.call(document.querySelectorAll("#tLists input[type=checkbox]"), function(cb){
      if(cb.checked) ids.push(cb.dataset.list);
    });
    return ids;
  }

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

    function listBoxes(scopeId, selected, allOn){
      return WordLists.all.map(function(l){
        var on = selected ? selected.indexOf(l.id) !== -1 : allOn;
        return '<label class="check"><input type="checkbox" data-scope="' + esc(scopeId) + '" data-list="' + esc(l.id) + '"' +
          (on ? " checked" : "") + "><span>" + esc(l.icon + " " + l.title) +
          '<span class="sub2">' + WordLists.wordsOf(l.id).length + " words</span></span></label>";
      }).join("");
    }

    var periodPanels = periods.map(function(p){
      var sel = Array.isArray(classCfg.periodLists[p]) ? classCfg.periodLists[p] : null;
      var count = students.filter(function(s){ return (assignments[s.uid] || {}).period === p; }).length;
      return '<div class="panel"><h2>Period ' + esc(p) + "</h2>" +
        '<p class="note">' + count + " student" + (count === 1 ? "" : "s") + " · " +
        (sel ? "its own list set" : "following the class default") + "</p>" +
        '<div class="listGrid">' + listBoxes("p:" + p, sel, Array.isArray(classCfg.defaultLists) ? false : true) + "</div>" +
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
        '<td class="muted tiny">' + (Array.isArray(a.lists) ? "own list set (" + a.lists.length + ")" : "follows period") + "</td></tr>";
    }).join("");

    $("tBody").innerHTML =
      '<div class="panel"><h2>Class default</h2>' +
        '<p class="note">What a student gets when neither they nor their period has a list set. ' +
        "Leave everything ticked and the whole site is open to everyone.</p>" +
        '<div class="listGrid">' + listBoxes("default", classCfg.defaultLists, true) + "</div>" +
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
  }

  function scopeSelection(scopeId){
    var ids = [];
    Array.prototype.forEach.call(document.querySelectorAll('#tBody input[data-scope="' + scopeId.replace(/"/g,'') + '"]'), function(cb){
      if(cb.checked) ids.push(cb.dataset.list);
    });
    return ids;
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

})();
