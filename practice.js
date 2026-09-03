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

  function engineFor(list){
    return list.engine === "spell" ? window.SpellGame : window.BlendGame;
  }

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

  function play(listId){
    var list = WordLists.byId(listId);
    if(!list){
      EIAuth.fail("Unknown game", "No word list called “" + listId + "”. Check the id in this page's script tag.");
      return;
    }
    EIAuth.ready().then(function(){
      return EIStore.ready();
    }).then(function(){
      var engine = engineFor(list);
      if(!engine){
        EIAuth.fail("Game engine missing", "This page didn't load " + (list.engine === "spell" ? "spell-game.js" : "blend-game.js") + ".");
        return;
      }
      var cfg = {};
      for(var k in list.config){ if(Object.prototype.hasOwnProperty.call(list.config, k)) cfg[k] = list.config[k]; }
      cfg.words = drawRound(list);
      var note = assignmentNote(list);
      if(note) cfg.intro = (cfg.intro || engineIntro(list)) + "<br>" + note;

      cfg.onResult = function(word, firstTryCorrect){
        EIStore.record(list.id, word, firstTryCorrect);
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
    return list.engine === "spell"
      ? "The computer says a word — you spell it.<br>Two tries each. Build a streak: every 5 in a row is bonus points!"
      : "Read the word out loud. The computer listens and tells you if you said it right.<br>Build a streak — every 5 in a row is bonus points!";
  }

  /* ── the home page ────────────────────────────────────────────────
     Tiles for the lists this student is assigned, grouped into the
     speaking/typing sections, each carrying its own progress line. A
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

        lists.forEach(function(l){ grid.appendChild(tile(l)); });
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

  function tile(list){
    var a = document.createElement("a");
    a.className = "tile";
    a.href = list.page;

    var icon = document.createElement("div");
    icon.className = "icon"; icon.textContent = list.icon;

    var title = document.createElement("h2");
    title.textContent = list.title;

    var p = document.createElement("p");
    p.textContent = list.description;

    a.appendChild(icon); a.appendChild(title); a.appendChild(p);

    // Progress line: how much of the list is solid, and what's still
    // shaky. Phrased as words mastered rather than a percentage score —
    // this is a practice deck, not a grade.
    var sum = Adaptive.summarize(EIStore.statsFor(list.id));
    var total = WordLists.wordsOf(list.id).length;
    var prog = document.createElement("div");
    prog.className = "tileProg";
    if(sum.attempts){
      var pct = Math.round(sum.mastered / total * 100);
      prog.innerHTML =
        '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="progNote">' + sum.mastered + " of " + total + " words solid" +
        (sum.struggling ? " · <b>" + sum.struggling + "</b> still shaky" : "") + "</div>";
    } else {
      prog.innerHTML = '<div class="progNote">Not started yet</div>';
    }
    a.appendChild(prog);

    var play = document.createElement("span");
    play.className = "play"; play.textContent = "Play ▸";
    a.appendChild(play);
    return a;
  }

  return { play: play, renderHome: renderHome, drawRound: drawRound, SESSION_SIZE: SESSION_SIZE };
})();
