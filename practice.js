/* ════════════════════════════════════════════════════════════════════
   practice.js — the glue between a game page and everything else.

   A game page is now one line:

       EIPractice.play("initial-blends");

   which means: wait for sign-in, load this student's record, pick the
   words they most need out of that list, hand them to the right engine,
   and report every answer back.

   ── Why a page can't just play the whole list any more ────────────────
   Before sign-in, every round was the entire word list in a shuffled
   order — 28 to 40 words, the same 28 to 40 every time. That is the one
   thing an adaptive deck can't do: if every word is guaranteed to appear,
   there is no room left to show a struggling word more often than a solid
   one. So a round is now a SESSION_SIZE-word sample, drawn with the
   weights adaptive.js explains. Over a few rounds a student still sees
   the whole list — they just see the hard parts of it two or three times
   as often, which is the entire point.
   ════════════════════════════════════════════════════════════════════ */

window.EIPractice = (function(){
  "use strict";

  // Words per round. Long enough to be a real practice set, short enough
  // that a student finishes one inside a station rotation — and short
  // enough, relative to a 30-40 word list, for the weighting to bite.
  var SESSION_SIZE = 18;

  var ENGINES = { blend: "BlendGame", spell: "SpellGame", card: "CardGame", match: "MatchGame",
                  fluency: "FluencyGame", blendit: "BlendItGame" };
  var ENGINE_FILES = { blend: "blend-game.js", spell: "spell-game.js", card: "card-game.js",
                       match: "match-game.js", fluency: "fluency-game.js", blendit: "blend-it-game.js" };
  function engineFor(list){ return window[ENGINES[list.engine]] || null; }

  /* Pick this round's words, then map them back to the list's original
     entries — the multisyllable list writes its words dotted
     ("fan·tas·tic") and the engine needs that form to scaffold its reveal,
     while everything on the storage side only ever sees the plain word. */
  function drawRound(list){
    var plainWords = WordLists.wordsOf(list.id);
    var stats = EIStore.statsFor(list.id);
    var size = Math.min(list.sessionSize || SESSION_SIZE, plainWords.length);
    var picked = Adaptive.pickSession(plainWords, stats, size, Date.now());
    var entries = WordLists.entryMap(list.id);
    return picked.map(function(w){ return entries[w] || w; });
  }

  /* Every word on the list the scheduler counts as solid. The flash cards
     use it for the speed round — a deck of words the student already owns,
     which is useless as practice and exactly right as a fluency drill. An
     engine that doesn't care simply ignores it. */
  function masteredOf(list){
    var stats = EIStore.statsFor(list.id);
    return WordLists.wordsOf(list.id).filter(function(w){
      return Adaptive.isMastered(stats[w]);
    });
  }

  /* A one-line note under the game title when a student opens a list that
     isn't currently assigned to them. Deliberately not a lock: a student
     who found their way to extra practice should not be stopped, and a
     hard block would turn every mis-assignment into a support request in
     the middle of class. */
  function assignmentNote(list){
    var mine = EIStore.myLists();
    if(mine.indexOf(list.id) !== -1) return "";
    return '<span class="ei-extra">Extra practice — this one isn\'t on your list right now.</span>';
  }

  /* ── which list does this page play? ──────────────────────────────
     A page that serves exactly one list names it outright:
     play("final-blends"). The two shared pages — cards-game.html and
     match-game.html, which serve every family's cards and Match It modes
     — call play() with no id, and the list comes from the query string:
     the home page links to "cards-game.html?list=red-3-cards".
     Landing on a shared page with no (or a stale) ?list= is not an error:
     the page shows a chooser of the lists this student has for that mode,
     so a bookmarked or hand-typed URL still lands somewhere useful. */
  function queryList(){
    var m = /[?&]list=([^&#]+)/.exec(location.search || "");
    try{ return m ? decodeURIComponent(m[1]) : null; }catch(e){ return null; }
  }
  function pageName(){
    var p = location.pathname || "";
    return p.slice(p.lastIndexOf("/") + 1) || "index.html";
  }
  // Every registry entry served by the page we're on.
  function listsForThisPage(){
    var here = pageName();
    return WordLists.all.filter(function(l){ return l.page === here; });
  }

  function play(listId){
    if(!listId) listId = queryList();
    var list = listId ? WordLists.byId(listId) : null;
    var here = listsForThisPage();

    if(!list){
      // A family page with nothing (valid) in the query string: choose.
      if(here.length > 1){ return chooser(here); }
      if(here.length === 1){ list = here[0]; }
    }
    if(!list){
      EIAuth.fail("Unknown game", "No word list called “" + (listId || "") + "”. Check the id in this page's script tag, or the ?list= in the address.");
      return;
    }
    if(list.page !== pageName() && here.length){
      // The query string names a list that belongs to a different page —
      // most likely a copy-paste. Send them to the right one.
      location.replace(WordLists.hrefOf(list.id));
      return;
    }
    EIAuth.ready().then(function(){
      return EIStore.ready();
    }).then(function(){
      var engine = engineFor(list);
      if(!engine){
        EIAuth.fail("Game engine missing", "This page didn't load " + (ENGINE_FILES[list.engine] || "its engine") + ".");
        return;
      }
      var cfg = {};
      for(var k in list.config){ if(Object.prototype.hasOwnProperty.call(list.config, k)) cfg[k] = list.config[k]; }
      /* Every engine but one gets a weighted DRAW of the list. The
         fluency engine gets the whole thing: its one-minute deck cycles,
         and a fast reader who ran out of words would be scored on the
         length of the draw rather than on their reading. A passage isn't
         a draw at all — it is one text, and it arrives as cfg.text. */
      if(list.engine === "fluency"){
        cfg.words = list.words.slice();
        if(list.text) cfg.text = list.text;
        if(list.targets) cfg.targets = list.targets;
        var fl = EIStore.fluencyFor(list.id);
        if(fl){ cfg.best = fl.best; cfg.last = fl.latest; }
        cfg.onFluency = function(run){ EIStore.recordFluency(list.id, run); };
      } else {
        cfg.words = drawRound(list);
      }
      cfg.mastered = masteredOf(list);
      var note = assignmentNote(list);
      if(note) cfg.intro = (cfg.intro || engineIntro(list)) + "<br>" + note;

      /* The 4th argument is an options bag: the flash cards put a time in
         it, Say It puts the kind of error in it, and the engines that
         have neither call onResult with three arguments and never know. */
      cfg.onResult = function(word, firstTryCorrect, tries, opts){
        EIStore.record(list.id, word, firstTryCorrect, opts && opts.ms, opts && opts.kind);
      };
      cfg.onHeard = function(word, text){
        EIStore.recordHeard(list.id, word, text);
      };
      cfg.onFinish = function(sum){
        EIStore.finishRound(list.id, sum.right, sum.total);
      };
      cfg.nextRound = function(){ return drawRound(list); };

      EIAuth.unlock();
      engine.start(cfg);
    }).catch(function(e){
      EIAuth.fail("Something went wrong", "The page couldn't start. Reload and try again.");
    });
  }

  // The engines' own default intros, repeated here only so the
  // not-assigned note can be appended to one without blanking it.
  function engineIntro(list){
    if(list.engine === "fluency") return "Read out loud. The computer follows along and times you.";
    if(list.engine === "blendit") return "Hear the sounds one at a time, then say the word.";
    if(list.engine === "spell") return "The computer says a word — you spell it.<br>Two tries each. Build a streak: every 5 in a row is bonus points!";
    if(list.engine === "card")  return "Read the word out loud, then flip the card to check yourself.<br>Build a streak: every 5 in a row is bonus points!";
    if(list.engine === "match") return "The computer says a word — click the one that matches.<br>Every 5 right in a row is bonus points!";
    return "Read the word out loud. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!";
  }

  /* ── the list chooser ─────────────────────────────────────────────
     Shown on a family page that wasn't told which list to play. Lists
     this student is assigned come first; the rest are still reachable
     under "More" — the same no-lock rule as the extra-practice note
     above, so a wrong URL never dead-ends a student mid-class. */
  var CHOOSER_STYLE = "ei-chooser-style";
  var CHOOSER_CSS = [
    ".eiChooser{max-width:720px;margin:40px auto;padding:0 20px}",
    ".eiChooser h1{font-size:clamp(26px,4vw,38px);margin:0 0 6px}",
    ".eiChooser .sub{color:var(--muted);margin:0 0 22px;font-size:16px}",
    ".eiChooser h2{font-size:16px;color:var(--muted);margin:26px 0 10px;text-transform:uppercase;letter-spacing:.06em}",
    ".eiChooser .pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}",
    ".eiChooser a.opt{display:block;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px;color:inherit;text-decoration:none;transition:border-color .15s,transform .15s}",
    ".eiChooser a.opt:hover{border-color:var(--accent);transform:translateY(-2px)}",
    ".eiChooser a.opt b{display:block;font-size:19px;margin-bottom:6px}",
    ".eiChooser a.opt small{color:var(--muted);font-size:13px}",
    ".eiChooser a.opt small em{color:var(--accent);font-style:normal;font-weight:700}",
    ".eiChooser .home{display:inline-block;margin-top:26px;color:var(--muted)}"
  ].join("\n");

  function chooser(lists){
    EIAuth.ready().then(function(){ return EIStore.ready(); }).then(function(){
      if(!document.getElementById(CHOOSER_STYLE)){
        var st = document.createElement("style"); st.id = CHOOSER_STYLE; st.textContent = CHOOSER_CSS;
        document.head.appendChild(st);
      }
      var mine = EIStore.myLists();
      // Every list on this page is the same MODE — that's what a shared
      // page is — but they come from several families now, so the label
      // on each option has to name its family. "List 3" alone was enough
      // when the page only ever served the red words; it isn't now.
      var mode = WordLists.modeOf(lists[0].mode) || { icon:"", title:"" };
      var order = {};
      WordLists.families().forEach(function(f, i){ order[f.key] = i; });
      var sorted = lists.slice().sort(function(a, b){
        if(a.family !== b.family) return (order[a.family] || 0) - (order[b.family] || 0);
        return (a.listNum || 0) - (b.listNum || 0);
      });
      var assigned = sorted.filter(function(l){ return mine.indexOf(l.id) !== -1; });
      var others   = sorted.filter(function(l){ return mine.indexOf(l.id) === -1; });

      function opt(l){
        var sum = Adaptive.summarize(EIStore.statsFor(l.id));
        var total = WordLists.wordsOf(l.id).length;
        var note = sum.attempts
          ? "<em>" + sum.mastered + "</em> of " + total + " solid" + (sum.struggling ? " · " + sum.struggling + " shaky" : "")
          : "Not started yet";
        return '<a class="opt" href="' + WordLists.hrefOf(l.id) + '"><b>' + esc(l.listTitle) + "</b><small>" + note + "</small></a>";
      }
      var mount = document.getElementById("app") || document.body;
      mount.className = "";
      mount.innerHTML =
        '<div class="eiChooser">' +
          "<h1>" + esc(mode.icon + " " + mode.title) + "</h1>" +
          '<p class="sub">Which list do you want to practice?</p>' +
          (assigned.length
            ? "<h2>Your lists</h2>" + '<div class="pick">' + assigned.map(opt).join("") + "</div>"
            : '<p class="sub">Nothing on your list for this game yet — pick any to practice.</p>') +
          (others.length
            ? "<h2>" + (assigned.length ? "More" : "All lists") + "</h2>" + '<div class="pick">' + others.map(opt).join("") + "</div>"
            : "") +
        "</div>";
      EIAuth.unlock();
    }).catch(function(){
      EIAuth.fail("Something went wrong", "The page couldn't start. Reload and try again.");
    });
  }

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* ── the home page ────────────────────────────────────────────────
     Tiles for the lists this student is assigned, grouped into the two
     shelves sectionsOf() names — words you sound out, and words you
     can't — each tile carrying a row per mode with its own progress. A
     student with no assignment at all gets everything (see
     EIStore.effectiveLists) rather than an empty page. */
  function renderHome(mountId){
    var mount = document.getElementById(mountId);
    if(!mount) return;
    EIAuth.ready().then(function(){ return EIStore.ready(); }).then(function(){
      var mine = EIStore.myLists();
      var sections = WordLists.sectionsOf();
      mount.innerHTML = "";
      var shown = 0;

      sections.forEach(function(sec){
        var lists = WordLists.all.filter(function(l){
          return l.section === sec.key && mine.indexOf(l.id) !== -1;
        });
        if(!lists.length) return;
        shown += lists.length;

        var wrap = document.createElement("div");
        wrap.className = "section";
        var h2 = document.createElement("h2"); h2.textContent = sec.title; wrap.appendChild(h2);
        var note = document.createElement("p"); note.className = "sectionNote"; note.textContent = sec.note; wrap.appendChild(note);
        var grid = document.createElement("div"); grid.className = "grid";

        // One tile per LIST, with a Play row per mode the student has
        // for it — so a student assigned both modes of three red lists
        // sees three tiles, not six, and "Blend Words" is one tile with
        // three ways in rather than three tiles of the same words.
        var byList = {}, order = [];
        lists.forEach(function(l){
          var k = l.family + ":" + l.listNum;
          if(!byList[k]){ byList[k] = []; order.push(k); }
          byList[k].push(l);
        });
        order.forEach(function(k){ grid.appendChild(familyTile(byList[k])); });
        wrap.appendChild(grid);
        mount.appendChild(wrap);
      });

      if(!shown){
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "Nothing assigned to you yet — check with your teacher.";
        mount.appendChild(empty);
      }
      EIAuth.unlock();
    });
  }

  /* One list — "Red Words · List 3", or just "Blend Words" for a family
     that only has the one — with a row per mode the student has for it.
     Each row is its own link, so the tile is a <div> rather than an <a>.

     There used to be a second, simpler tile for lists that had only one
     way to play them. Every list has several now, so that tile had
     nothing left to render and went away with the distinction. */
  function familyTile(entries){
    var first = entries[0];
    var fam = WordLists.familyOf(first.family) || { icon:"", title:"", lists:[], description:"" };
    var d = document.createElement("div");
    d.className = "tile tileFamily";

    var icon = document.createElement("div");
    icon.className = "icon"; icon.textContent = fam.icon || first.icon;
    var title = document.createElement("h2");
    title.textContent = first.listTitle;
    var p = document.createElement("p");
    // Ten red-word tiles all captioned "words that break the rules" tell
    // a student nothing about which is which, so a family with several
    // lists shows its words instead. A family with one list has no such
    // problem and gets the sentence that says what the list is FOR.
    p.textContent = fam.lists.length > 1
      ? WordLists.wordsOf(first.id).slice(0, 6).join(", ") + "…"
      : fam.description;
    d.appendChild(icon); d.appendChild(title); d.appendChild(p);

    // Rows in the family's declared mode order, not assignment order, so
    // the same list looks the same however it was ticked.
    WordLists.modesOf(fam.key).forEach(function(m){
      var l = entries.filter(function(e){ return e.mode === m.key; })[0];
      if(!l) return;
      var row = document.createElement("a");
      row.className = "gameRow";
      row.href = WordLists.hrefOf(l.id);
      var sum = Adaptive.summarize(EIStore.statsFor(l.id));
      var total = WordLists.wordsOf(l.id).length;
      var prog = sum.attempts
        ? "<b>" + sum.mastered + "</b> of " + total + " solid" + (sum.struggling ? " · " + sum.struggling + " shaky" : "")
        : "Not started yet";
      row.innerHTML =
        '<span class="gIcon">' + esc(m.icon) + "</span>" +
        '<span class="gMeta"><span class="gTitle">' + esc(m.title) +
          (m.needs ? '<span class="gNeeds">' + esc(m.needs) + "</span>" : "") + "</span>" +
        '<span class="gProg">' + prog + "</span></span>" +
        '<span class="play">Play ▸</span>';
      d.appendChild(row);
    });
    return d;
  }

  return { play: play, renderHome: renderHome, drawRound: drawRound, SESSION_SIZE: SESSION_SIZE,
           _internals: { queryList: queryList, pageName: pageName } };
})();
