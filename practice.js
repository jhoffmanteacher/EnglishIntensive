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

  /* ── which list does this page play? ──────────────────────────────
     A page that serves exactly one list names it outright:
     play("final-blends"). The two shared pages — cards-game.html and
     match-game.html, which serve every family's cards and Match It modes
     — call play() with no id, and the list comes from the query string:
     the home page links to "cards-game.html?list=red-3-cards".
     Landing on a shared page with no (or a stale) ?list= is not an error:
     the page shows a chooser of the lists this student has for that mode,
     so a bookmarked or hand-typed URL still lands somewhere useful. The
     same chooser catches a list the student wasn't given: the teacher
     decides what each student plays, so an address copied off a
     neighbour's screen shows their own lists instead. */
  function queryList(){
    var m = /[?&]list=([^&#]+)/.exec(location.search || "");
    try{ return m ? decodeURIComponent(m[1]) : null; }catch(e){ return null; }
  }
  /* GitHub Pages serves /cards-game as well as /cards-game.html, and the
     registry only ever spells the second. A name with no extension gets
     ".html" so both forms match the same lists. */
  function pageName(){
    var p = location.pathname || "";
    var name = p.slice(p.lastIndexOf("/") + 1) || "index.html";
    return name.indexOf(".") === -1 ? name + ".html" : name;
  }
  // Every registry entry served by the page we're on.
  function listsForThisPage(){
    var here = pageName();
    return WordLists.all.filter(function(l){ return l.page === here; });
  }

  /* A progress read that failed leaves myLists() empty, which would read
     as "your teacher hasn't given you anything" when the truth is the
     network. Say the true thing. The teacher and the dev bypass see every
     list regardless, so they are never held up by it. */
  var LOAD_FAIL_TITLE = "Couldn't load your games";
  var LOAD_FAIL_BODY = "Check the Wi-Fi and reload.";
  function loadBlocked(){
    return EIStore.failed() && !EIStore.seesEverything();
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
      // The developer's detail goes to the console; the student gets plain words.
      if(window.console) console.warn("Unknown game: no word list called “" + (listId || "") + "”. Check the id in this page's script tag, or the ?list= in the address.");
      EIAuth.fail("We can't find that game", "Go to the home page and pick a game from your list. If it keeps happening, tell your teacher.");
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
      if(loadBlocked()){
        EIAuth.fail(LOAD_FAIL_TITLE, LOAD_FAIL_BODY);
        return;
      }
      /* A retired list is not in the teacher's preview, but the teacher
         opening one off a student's page (or an old link) should land on
         the game, not on a chooser that doesn't list it. */
      if(EIStore.myLists().indexOf(list.id) === -1 && !(list.retired && EIStore.seesEverything())){
        chooser(here.length ? here : [list]);
        return;
      }
      var engine = engineFor(list);
      if(!engine){
        EIAuth.fail("Game engine missing", "This page didn't load " + (ENGINE_FILES[list.engine] || "its engine") + ".");
        return;
      }
      var cfg = { listId: list.id };
      for(var k in list.config){ if(Object.prototype.hasOwnProperty.call(list.config, k)) cfg[k] = list.config[k]; }
      /* Every engine but one gets a weighted DRAW of the list. The
         fluency engine gets the whole thing: its one-minute deck cycles,
         and a fast reader who ran out of words would be scored on the
         length of the draw rather than on their reading. */
      if(list.engine === "fluency"){
        cfg.words = list.words.slice();
        var fl = EIStore.fluencyFor(list.id);
        if(fl){ cfg.best = fl.best; cfg.last = fl.latest; }
        cfg.onFluency = function(run){ EIStore.recordFluency(list.id, run); };
      } else {
        cfg.words = drawRound(list);
      }
      cfg.mastered = masteredOf(list);
      /* The whole list, beside the round. Say it's by-sound judging (the
         nonsense words) must not pass a reading that is closer to
         ANOTHER word on the list — and "the list" is all 40, not the 18
         in this draw. */
      cfg.allWords = list.words.slice();

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
      console.error(e);
      EIAuth.fail("Something went wrong", "The page couldn't start. Reload and try again.");
    });
  }

  /* ── the list chooser ─────────────────────────────────────────────
     Shown on a family page that wasn't told which list to play, and in
     place of any list this student wasn't given. Only their own lists
     are offered: the teacher decides what each student plays. With none
     for this game, it says so plainly and points at the page's Home
     button, so a wrong address never dead-ends a student mid-class. */
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
    ".eiChooser a.opt small em{color:var(--accent);font-style:normal;font-weight:700}"
  ].join("\n");

  function chooser(lists){
    EIAuth.ready().then(function(){ return EIStore.ready(); }).then(function(){
      if(loadBlocked()){
        EIAuth.fail(LOAD_FAIL_TITLE, LOAD_FAIL_BODY);
        return;
      }
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
          (assigned.length
            ? '<p class="sub">Which list do you want to practice?</p>' +
              '<div class="pick">' + assigned.map(opt).join("") + "</div>"
            : '<p class="sub">This game is not on your list. Your teacher picks your games. ' +
              'Tap Home to see yours.</p>') +
        "</div>";
      EIAuth.unlock();
    }).catch(function(e){
      console.error(e);
      EIAuth.fail("Something went wrong", "The page couldn't start. Reload and try again.");
    });
  }

  function esc(s){
    return String(s == null ? "" : s)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  /* The line over a teacher's preview of one student's home page (the
     dashboard's Student view). Short and plain: it sits where a student's
     own page would be, so it is written the way that page is. */
  function previewText(pv){
    if(pv.failed) return "We couldn't load this student's games.";
    return "Previewing " + (pv.name || "this student") + "'s games — nothing you play here is saved to them.";
  }

  /* The shelves of tiles for a set of list ids, appended to `container`;
     returns how many lists were drawn. Used for a student's current list
     and, again, for the finished fold. */
  function appendSections(container, mine){
    var shown = 0;
    WordLists.sectionsOf().forEach(function(sec){
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
      container.appendChild(wrap);
    });
    return shown;
  }

  /* The one line above a sequence student's tiles, or "". Three things it
     can say, and these are the only new words a student sees: that they
     have finished everything, or — the first time the page loads after
     they moved to a new list — which one. "The first time" is a note kept
     in localStorage (per student, per sequence: a teacher saving a new
     sequence starts it afresh, and the first ever load announces nothing).
     A teacher previewing a student reads nothing and writes nothing. */
  function planNotice(pl, pv){
    if(pv) return pl.finished ? "You finished all your lists. Ask your teacher what comes next." : "";
    var key = "ei.plan.seen:" + pl.uid, prev = null, text = "";
    try{ prev = JSON.parse(localStorage.getItem(key)); }catch(e){}
    if(pl.finished){
      text = "You finished all your lists. Ask your teacher what comes next.";
    } else if(prev && prev.setAt === pl.setAt && prev.index < pl.index){
      var first = WordLists.byId(pl.current[0]);
      if(first) text = "New list: " + first.listTitle + ".";
    }
    try{ localStorage.setItem(key, JSON.stringify({ setAt: pl.setAt, index: pl.index })); }catch(e){}
    return text;
  }

  /* ── the home page ────────────────────────────────────────────────
     Tiles for the lists this student is assigned, grouped into the two
     shelves sectionsOf() names — words you sound out, and words you
     can't — each tile carrying a row per mode with its own progress. A
     student with nothing assigned gets one line saying so, not the whole
     library (see EIStore.effectiveLists). */
  function renderHome(mountId){
    var mount = document.getElementById(mountId);
    if(!mount) return;
    EIAuth.ready().then(function(){ return EIStore.ready(); }).then(function(){
      if(loadBlocked()){
        mount.innerHTML = "";
        var bad = document.createElement("div");
        bad.className = "empty";
        bad.textContent = LOAD_FAIL_TITLE + ". " + LOAD_FAIL_BODY;
        mount.appendChild(bad);
        EIAuth.unlock();
        return;
      }
      var mine = EIStore.myLists();
      mount.innerHTML = "";
      var shown = 0;
      /* The teacher's own home page shows every game, so they can try one
         before assigning it. Said out loud, or it reads as what the class
         sees. */
      var pv = EIStore.preview && EIStore.preview();
      /* Playing as the test student, the page is a student's page, and the
         line that says "you see every game" would be false. The strip at the
         top (testBar) says what is going on instead. */
      var testing = EIStore.asTest && EIStore.asTest();
      if(pv || (EIAuth.isTeacher() && !testing)){
        var tv = document.createElement("p");
        tv.className = "teacherView";
        tv.textContent = pv ? previewText(pv)
          : "Teacher view: you see every game. Each student sees only what you assign them on the dashboard.";
        mount.appendChild(tv);
      }

      /* A student with a sequence sees the list they are on, in its
         section; the lists they have finished sit in one closed fold under
         it, still playable; lists they have not reached are not there at
         all — no locks, no "coming soon". A student with no sequence sees
         their set exactly as before. */
      var pl = EIStore.plan && EIStore.plan();
      if(pl){
        var note = planNotice(pl, pv);
        if(note){
          var pn = document.createElement("p");
          pn.className = "planLine";
          pn.textContent = note;
          mount.appendChild(pn);
        }
        shown = appendSections(mount, pl.current);
        if(pl.finishedIds.length){
          var fold = document.createElement("details");
          fold.className = "finishedFold";
          var sum = document.createElement("summary");
          sum.textContent = "Lists you finished (" + pl.finishedCount + ")";
          fold.appendChild(sum);
          appendSections(fold, pl.finishedIds);
          mount.appendChild(fold);
        }
      } else {
        shown = appendSections(mount, mine);
        if(!shown){
          var empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "No games for you yet. Your teacher will add them soon.";
          mount.appendChild(empty);
        }
      }
      EIAuth.unlock();
    }).catch(function(e){
      // Without this a throw leaves the page on its loading state for good.
      console.error(e);
      EIAuth.unlock();
      mount.innerHTML = "";
      var bad = document.createElement("div");
      bad.className = "empty";
      bad.textContent = "Something went wrong. Reload and try again.";
      mount.appendChild(bad);
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

  /* ── the test student ─────────────────────────────────────────────
     A teacher playing as their test student (store.js, ?as=test) is on
     what looks exactly like a student's page, and it is worth one small
     reminder that it isn't one: what they play is saved, to the test
     student, and there is a way back. A thin strip pinned across the top, with
     the body padded down by its height so the page lays out under it, and the
     games' fixed Home link and account chip moved down by the same amount
     (the game pages' <body> is a centred flex row: a strip in the flow became
     a box beside the game, and a floating pill sat on top of Start and
     Shuffle). Added to every page that loads
     this file (home and every game), and only while the mode is on.
     Teacher-facing, so it is not written for a struggling reader. */
  var TESTBAR_ID = "ei-testbar";
  var TESTBAR_CSS = [
    "#ei-testbar{position:fixed;top:0;left:0;right:0;z-index:60;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px 14px;",
    "padding:6px 12px;font-size:13px;line-height:1.3;background:var(--panel);color:var(--ink);",
    "border-bottom:2px solid var(--accent)}",
    "#ei-testbar button{font:inherit;font-weight:700;cursor:pointer;border-radius:999px;padding:4px 12px;",
    "border:0;background:var(--accent);color:#111827;white-space:nowrap}",
    "#ei-testbar button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}",
    // The games' fixed Home link and account chip sit at top:14px; move them under the strip.
    "body.ei-testing .home,body.ei-testing .ei-chip{top:calc(14px + var(--ei-strip-h,0px))}"
  ].join("");
  function testBar(){
    if(!(window.EIStore && EIStore.asTest && EIStore.asTest())) return;
    if(document.getElementById(TESTBAR_ID)) return;
    var st = document.createElement("style");
    st.textContent = TESTBAR_CSS;
    document.head.appendChild(st);
    var bar = document.createElement("div");
    bar.id = TESTBAR_ID;
    bar.setAttribute("role", "status");
    var txt = document.createElement("span");
    txt.textContent = "Playing as your test student. What you play here is saved to them.";
    var back = document.createElement("button");
    back.type = "button";
    back.textContent = "Back to teacher view";
    back.addEventListener("click", function(){
      EIStore.leaveTest();
      // The round that ends here is the one most likely to be lost: let it land first.
      Promise.resolve(EIStore.flush()).then(function(){ location.href = "index.html"; },
                                            function(){ location.href = "index.html"; });
    });
    bar.appendChild(txt);
    bar.appendChild(back);
    document.body.insertBefore(bar, document.body.firstChild);
    // site.css is border-box, so padding comes out of a `height:100%` body
    // rather than adding to it: the page fits under the strip, no new scroll.
    function pad(){
      var h = bar.offsetHeight + "px";
      document.body.style.paddingTop = h;
      document.documentElement.style.setProperty("--ei-strip-h", h);
    }
    document.body.classList.add("ei-testing");
    pad();
    window.addEventListener("resize", pad);
  }
  EIAuth.ready().then(function(){ return EIStore.ready(); }).then(testBar);

  return { play: play, renderHome: renderHome, drawRound: drawRound, SESSION_SIZE: SESSION_SIZE,
           _internals: { queryList: queryList, pageName: pageName, previewText: previewText,
                         planNotice: planNotice, appendSections: appendSections, testBar: testBar } };
})();
