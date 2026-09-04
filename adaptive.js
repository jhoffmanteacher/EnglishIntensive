/* ════════════════════════════════════════════════════════════════════
   adaptive.js — which words come up next, and how often.

   Everything here is PURE: no DOM, no storage, no clock of its own (the
   caller passes `now`), no randomness that isn't injected (`rnd`). That
   is what makes it testable — tests.html exercises the whole file — and
   it is why the scheduling rules live here rather than inside the game
   engines, which are full of mic state and timers.

   ── The model ─────────────────────────────────────────────────────────
   One stat record per word, per list:

     { n, r, w, s, box, last, lat }
       n     times the word has come up
       r     times it came back RIGHT ON THE FIRST TRY
       w     times it didn't
       s     current run of first-try-correct answers
       box   Leitner box, 0–5 — how long the word has earned off
       last  epoch ms of the last time it came up
       lat   running average of how long a CORRECT answer took, in ms;
             0 where nothing has timed it (most modes can't)

   Only first-try answers count as right. Getting a word after being told
   it isn't knowing it, and the whole point of the deck is to be honest
   about what the student can actually do cold. (This matches the rule the
   comeback deck already used: a word leaves it "the moment it's read
   correctly on the first try".)

   ── How often a word comes up ─────────────────────────────────────────
   Two independent pulls, multiplied:

     missWeight  how badly it's going — accuracy 0 → 6.0, 50 % → 3.5,
                 100 % → 1.0. A word missed most of the time is roughly
                 six times as likely to be picked as one that's solid.
     dueFactor   whether it's had its rest. Each box earns a longer break
                 (same day, 1 day, 2, 4, 8, 16). Inside the break the word
                 is damped rather than banned — it can still appear, just
                 far less often — because a hard ban makes short sessions
                 repeat the same handful of words and makes a long gap
                 dump everything at once.

   A word the student has never seen sits at a flat NEW_WEIGHT, between
   "solid" and "shaky" — new material keeps flowing without crowding out
   the words that are actually failing.

   ── Speed ─────────────────────────────────────────────────────────────
   A word decoded in three seconds is not a sight word. Where a mode can
   time an answer (the flash cards can; the mic and typing modes can't),
   a word averaging over SLOW_MS is pulled back into rotation harder than
   its accuracy alone would ask for. It does NOT stop counting as
   mastered: the student's own "12 of 20 solid" must not drop the day a
   stopwatch appears. Slow-but-right is the teacher's report, not the
   student's score.
   ════════════════════════════════════════════════════════════════════ */

window.Adaptive = (function(){
  "use strict";

  var DAY = 86400000;

  var NEW_WEIGHT   = 3.0;   // never-practiced word
  var MIN_WEIGHT   = 0.05;  // nothing is ever truly unpickable
  var MAX_BOX      = 5;
  // Days of rest each box earns. Box 0 is "same session is fine".
  var BOX_DAYS     = [0, 1, 2, 4, 8, 16];
  // How far a not-yet-due word is damped, at its floor (just practiced).
  var REST_FLOOR   = 0.22;
  // A word that has graduated (top box, high accuracy) gets damped again
  // on top of that — it has earned the right to stop taking up slots.
  var MASTERED_DAMP = 0.35;
  var MASTERED_ACC  = 0.9;
  /* How long a word may take before it stops counting as read and starts
     counting as worked out. 2.5 s is generous for a one-syllable word on a
     flash card and still well short of what sounding out takes. A slow
     word is pulled back into rotation harder than its accuracy alone
     would ask for — being right about a word you had to decode is not the
     same as knowing it. */
  /* The seven things diagnose() can blame, and the only keys the stat's
     error tally will hold. A closed set on purpose: this is written from
     a game engine into a document the teacher reads, and an open map
     would let one bad build put anything in front of a class. */
  var ERROR_KINDS = ["blend","sound","vowel","consonant","missing","extra","other"];
  var MAX_KIND = 999;

  /* How much of a list has to be solid before it counts as done — for
     the "ready to move up" suggestion, and now for a sequence that acts
     on it without being asked. Not 100 %: a list is finished when a
     student can read it, and there is always one word that isn't the
     point. It lives here rather than in teacher.js because the dashboard
     and the student's own browser both have to agree about it, and they
     are two different files. */
  var SOLID_ENOUGH = 0.8;

  var SLOW_MS     = 2500;
  var SLOW_BOOST  = 1.5;
  var LAT_ALPHA   = 0.4;    // weight of the newest time in the running average
  var MAX_LAT_MS  = 60000;  // anything longer is a student who walked away

  function has(o, k){ return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }
  function num(v, dflt){ return (typeof v === "number" && isFinite(v)) ? v : dflt; }

  function emptyStat(){ return { n:0, r:0, w:0, s:0, box:0, last:0, lat:0, k:{} }; }

  /* localStorage and Firestore are both hand-editable and outlive any
     change to this file, so nothing read back is trusted: a record is
     rebuilt field by field, out-of-range values are pulled back into
     range, and anything unrecognisable becomes a fresh stat. */
  function sanitizeStat(raw){
    if(!raw || typeof raw !== "object") return emptyStat();
    var n = Math.max(0, Math.floor(num(raw.n, 0)));
    var r = clamp(Math.floor(num(raw.r, 0)), 0, n);
    var w = clamp(Math.floor(num(raw.w, 0)), 0, n);
    return {
      n: n, r: r, w: w,
      s: Math.max(0, Math.floor(num(raw.s, 0))),
      box: clamp(Math.floor(num(raw.box, 0)), 0, MAX_BOX),
      last: Math.max(0, Math.floor(num(raw.last, 0))),
      // Time to answer, in ms — 0 means "never timed", which is every
      // stat written before the flash cards started measuring and every
      // stat from a mode that can't measure.
      lat: clamp(Math.floor(num(raw.lat, 0)), 0, MAX_LAT_MS),
      // What kind of wrong, counted. Only Say It can say, and only on the
      // reveal; everything else leaves this empty.
      k: sanitizeKinds(raw.k)
    };
  }

  function sanitizeKinds(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    for(var i=0;i<ERROR_KINDS.length;i++){
      var k = ERROR_KINDS[i];
      var v = clamp(Math.floor(num(raw[k], 0)), 0, MAX_KIND);
      if(v > 0) out[k] = v;
    }
    return out;
  }

  function sanitizeStats(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    for(var k in raw){
      if(!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if(typeof k !== "string" || !k) continue;
      out[k] = sanitizeStat(raw[k]);
    }
    return out;
  }

  /* One answer. `correct` means right on the FIRST try.

     A miss drops the word one box rather than resetting it to 0. Resetting
     is the textbook Leitner move and it is too harsh here: a student who
     fumbles one word in the middle of a good run then sees it every single
     session for a week, which is how a practice deck turns into a
     punishment. One box back means it comes around soon, not constantly. */
  function updateStat(stat, correct, now, ms, kind){
    var s = sanitizeStat(stat);
    s.n += 1;
    /* One vote per miss for what kind of wrong it was. Only Say It knows
       — it is the only mode that hears what the student actually said —
       and only on the reveal, so this counts words given up on rather
       than words fumbled once. A kind that isn't one of the seven is
       simply not counted. */
    if(!correct && kind && ERROR_KINDS.indexOf(kind) !== -1){
      s.k[kind] = Math.min(MAX_KIND, (s.k[kind] || 0) + 1);
    }
    s.last = Math.max(0, Math.floor(num(now, 0)));
    if(correct){
      s.r += 1;
      s.s += 1;
      s.box = Math.min(MAX_BOX, s.box + 1);
      /* Only correct answers are timed. A wrong answer's clock is
         measuring how long the student stared at a word they didn't
         know, which is a different thing and would drag the average
         toward "slow" for words they simply haven't learned yet.
         A running average, not the last reading: one interruption
         shouldn't reclassify a word. */
      var t = num(ms, 0);
      if(t > 0){
        t = clamp(Math.round(t), 0, MAX_LAT_MS);
        s.lat = s.lat ? Math.round((1 - LAT_ALPHA) * s.lat + LAT_ALPHA * t) : t;
      }
    } else {
      s.w += 1;
      s.s = 0;
      s.box = Math.max(0, s.box - 1);
    }
    return s;
  }

  /* Laplace-smoothed accuracy: (r+1)/(n+2). Two purposes — it keeps a
     brand-new word off 0 % or 100 % after a single answer (one lucky
     guess is not mastery, one slip is not a crisis), and it means the
     first few answers move the estimate a lot while later ones move it
     little, which is the behaviour you want from a practice deck. */
  function accuracy(stat){
    var s = sanitizeStat(stat);
    return (s.r + 1) / (s.n + 2);
  }

  // The raw, unsmoothed number — this is what a teacher should see, since
  // "8 of 10" is a fact and the smoothed version is a modelling choice.
  function rawAccuracy(stat){
    var s = sanitizeStat(stat);
    return s.n ? s.r / s.n : null;
  }

  function isMastered(stat){
    var s = sanitizeStat(stat);
    return s.box >= MAX_BOX && rawAccuracy(s) !== null && rawAccuracy(s) >= MASTERED_ACC;
  }

  /* Right, but not yet a sight word. Deliberately NOT part of
     isMastered(): the student's own tile says "12 of 20 solid", and a
     speed measurement arriving should never make that number go down —
     nothing about their reading changed the day the cards learned to use
     a stopwatch. Speed is the scheduler's business and the teacher's. */
  function isSlow(stat){
    var s = sanitizeStat(stat);
    return s.lat > SLOW_MS;
  }

  function dueFactor(stat, now){
    var s = sanitizeStat(stat);
    if(!s.last) return 1;
    var restDays = BOX_DAYS[clamp(s.box, 0, MAX_BOX)];
    if(restDays <= 0) return 1;
    var ageDays = Math.max(0, (num(now, 0) - s.last)) / DAY;
    if(ageDays >= restDays) return 1;
    // Ramp from REST_FLOOR straight after practice up to 1 when due.
    return REST_FLOOR + (1 - REST_FLOOR) * (ageDays / restDays);
  }

  function weight(stat, now){
    if(!stat || !stat.n) return NEW_WEIGHT;
    var s = sanitizeStat(stat);
    var missWeight = 1 + 5 * (1 - accuracy(s));
    var wgt = missWeight * dueFactor(s, now);
    if(isMastered(s)) wgt *= MASTERED_DAMP;
    // A word decoded in three seconds is not a sight word, however
    // reliably it comes back right. It keeps coming round.
    if(isSlow(s)) wgt *= SLOW_BOOST;
    return Math.max(MIN_WEIGHT, wgt);
  }

  /* Weighted sample without replacement.

     Without replacement matters: a session that can serve the same word
     twice feels broken, and the reveal-on-second-miss would show the
     answer before the repeat. So each pick removes its word from the pool
     and the remaining weights are re-normalised.

     `rnd` is injected so tests can pin the sequence; it defaults to
     Math.random. `words` is the pool (plain strings — dotted syllable
     entries are the caller's business, see keyFor). */
  function pickSession(words, stats, size, now, rnd){
    var pool = (words || []).slice();
    var random = rnd || Math.random;
    var want = Math.min(Math.max(0, Math.floor(num(size, 0))), pool.length);
    var weights = pool.map(function(word){ return weight(stats && stats[word], now); });
    var out = [];
    for(var picked = 0; picked < want; picked++){
      var total = 0, i;
      for(i = 0; i < weights.length; i++) total += weights[i];
      if(total <= 0) break;
      var target = random() * total, acc = 0, chosen = weights.length - 1;
      for(i = 0; i < weights.length; i++){
        acc += weights[i];
        if(target < acc){ chosen = i; break; }
      }
      out.push(pool[chosen]);
      pool.splice(chosen, 1);
      weights.splice(chosen, 1);
    }
    return out;
  }

  /* Worst-first ordering, for the teacher's per-student view and for the
     "practice my missed words" run. Sorted by accuracy ascending, then by
     miss count descending, then alphabetically so the order is stable
     rather than dependent on object key order. Words never practiced are
     excluded — "unknown" is not "struggling". */
  function rank(stats){
    var rows = [];
    for(var word in stats){
      if(!has(stats, word)) continue;
      var s = sanitizeStat(stats[word]);
      if(!s.n) continue;
      rows.push({ word: word, stat: s, acc: rawAccuracy(s), misses: s.w });
    }
    rows.sort(function(a, b){
      if(a.acc !== b.acc) return a.acc - b.acc;
      if(a.misses !== b.misses) return b.misses - a.misses;
      return a.word < b.word ? -1 : a.word > b.word ? 1 : 0;
    });
    return rows;
  }

  /* One student's headline numbers, for the roster row and the end-screen
     summary. `attempts`/`right` are lifetime totals across every word. */
  function summarize(stats){
    var attempts = 0, right = 0, words = 0, mastered = 0, struggling = 0, slow = 0, last = 0;
    var kinds = {}, slowRight = 0;
    for(var word in stats){
      if(!has(stats, word)) continue;
      var s = sanitizeStat(stats[word]);
      if(!s.n) continue;
      words++; attempts += s.n; right += s.r;
      if(s.last > last) last = s.last;
      // Right, but not at pace — counted over every word, not just the
      // mastered ones, because "slow but right" is the phrase a teacher
      // uses about a word the student always gets and never gets quickly.
      if(isSlow(s) && s.r > 0) slowRight++;
      for(var kk in s.k){
        if(!has(s.k, kk)) continue;
        kinds[kk] = (kinds[kk] || 0) + s.k[kk];
      }
      if(isMastered(s)){
        mastered++;
        // Counted INSIDE mastered, not beside it: the useful question is
        // "how many of the words they own can they read at pace", so the
        // dashboard prints "12 solid (4 slow)" and the ready-to-move-up
        // rule uses mastered − slow. A word that is slow and not yet
        // mastered is already counted as shaky.
        if(isSlow(s)) slow++;
      }
      else if(rawAccuracy(s) < 0.6) struggling++;
    }
    return {
      words: words,
      attempts: attempts,
      right: right,
      accuracy: attempts ? right / attempts : null,
      mastered: mastered,
      struggling: struggling,
      // Solid words that are still slow. Never printed on a student page
      // — see isSlow(). The dashboard reads it; the tile does not.
      slow: slow,
      // Every word that comes back right and comes back slowly.
      slowRight: slowRight,
      // What kind of wrong, summed across every word.
      kinds: kinds,
      lastSeen: last
    };
  }

  /* Stats are keyed "<listId>|<word>" in one flat map on the student's
     document. Flat rather than nested because Firestore merge-writes and
     the sanitizer both stay simple, and "|" can't appear in a word.
     The list id is part of the key on purpose: "coin" in the reading game
     and "coin" in the spelling game are different skills, and a student
     can be fluent at one while failing the other. */
  function keyFor(listId, word){ return String(listId) + "|" + String(word); }
  function parseKey(key){
    var i = String(key).indexOf("|");
    if(i === -1) return { listId: null, word: String(key) };
    return { listId: key.slice(0, i), word: key.slice(i + 1) };
  }
  /* ── what the mic heard ────────────────────────────────────────────
     Not a stat — a short tail of the transcripts the recogniser returned
     for a word the student missed, keyed the same way stats are. It lives
     here beside sanitizeStats because this file owns the shape of
     students/{uid}, and both the student's store and the teacher's
     dashboard have to agree about it.

     Why keep it at all: a word that comes back as "bread" every time is a
     reading error, and a word that comes back as "crab, crabbe, crabb" is
     the recogniser failing, and only the transcripts tell those apart.
     Five is enough to see a pattern and short enough that a hundred words
     of it is still a few kilobytes. */
  var HEARD_CAP = 5;
  var HEARD_MAX_LEN = 40;

  // Whatever the recogniser said, reduced to something safe to store and
  // print: lowercase, letters/digits/apostrophe/space, and short.
  function cleanHeard(s){
    if(typeof s !== "string") return "";   // "[object Object]" is not a transcript
    return s.toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim().slice(0, HEARD_MAX_LEN).trim();
  }

  // Newest last, no repeats, capped. A student who says "bread" four
  // times running should leave one entry, not fill the tail with it.
  function pushHeard(list, text, cap){
    var t = cleanHeard(text);
    var out = (Array.isArray(list) ? list : []).map(cleanHeard).filter(Boolean);
    if(!t) return out.slice(-(cap || HEARD_CAP));
    out = out.filter(function(x){ return x !== t; });
    out.push(t);
    return out.slice(-(cap || HEARD_CAP));
  }

  function sanitizeHeard(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    for(var k in raw){
      if(!has(raw, k) || typeof k !== "string" || !k) continue;
      var v = Array.isArray(raw[k]) ? raw[k] : [];
      var clean = [], i;
      for(i=0;i<v.length;i++){
        var t = cleanHeard(v[i]);
        if(t && clean.indexOf(t) === -1) clean.push(t);
      }
      if(clean.length) out[k] = clean.slice(-HEARD_CAP);
    }
    return out;
  }

  /* ── fluency runs ──────────────────────────────────────────────────
     One entry per finished timed read, oldest first, per list. Not a
     stat: a rate belongs to a whole run, not to a word, and nothing in
     the scheduler reads it. It is here for the same reason the heard map
     is — this file owns the shape of students/{uid}, and the student's
     store and the teacher's dashboard have to agree about it.

     Thirty is a term's worth of weekly reads and a few kilobytes. The
     tail is what makes a sparkline; a single latest number would say
     nothing about whether anything is changing. */
  var FLUENCY_CAP = 30;
  var MAX_CWPM = 400;      // nobody reads faster; anything higher is a bug

  function sanitizeRun(raw){
    if(!raw || typeof raw !== "object") return null;
    // A run with no rate on it is not a run — it is a half-written
    // document, and averaging it in would drag a sparkline to the floor.
    var raw_cwpm = num(raw.cwpm, NaN);
    if(!isFinite(raw_cwpm)) return null;
    var cwpm = clamp(Math.floor(raw_cwpm), 0, MAX_CWPM);
    return {
      at: Math.max(0, Math.floor(num(raw.at, 0))),
      cwpm: cwpm,
      errors: Math.max(0, Math.floor(num(raw.errors, 0))),
      n: Math.max(0, Math.floor(num(raw.n, 0)))
    };
  }

  function sanitizeFluency(raw){
    var out = {};
    if(!raw || typeof raw !== "object") return out;
    for(var k in raw){
      if(!has(raw, k) || typeof k !== "string" || !k) continue;
      var list = Array.isArray(raw[k]) ? raw[k] : [];
      var clean = [], i, r;
      for(i=0;i<list.length;i++){
        r = sanitizeRun(list[i]);
        if(r) clean.push(r);
      }
      if(clean.length) out[k] = clean.slice(-FLUENCY_CAP);
    }
    return out;
  }

  function pushRun(list, run, cap){
    var r = sanitizeRun(run);
    var out = (Array.isArray(list) ? list : []).map(sanitizeRun).filter(Boolean);
    if(r) out.push(r);
    return out.slice(-(cap || FLUENCY_CAP));
  }

  // Latest and best of a list's runs — the two numbers a sparkline needs
  // a caption for.
  function fluencySummary(runs){
    var list = (Array.isArray(runs) ? runs : []).map(sanitizeRun).filter(Boolean);
    if(!list.length) return null;
    var best = 0, i;
    for(i=0;i<list.length;i++) if(list[i].cwpm > best) best = list[i].cwpm;
    return { latest: list[list.length-1].cwpm, best: best, runs: list.length, last: list[list.length-1] };
  }

  /* ── sequences ─────────────────────────────────────────────────────
     Where a student is in an ordered course of lists, computed from their
     own stats. Pure, and that is the whole trick: a student's position is
     a FUNCTION of their practice rather than a fact somebody has to write
     down, so the student's browser and the teacher's dashboard work it
     out separately and always agree, and nothing has to write to
     assignments/{uid} to move anybody on. (Which matters: that
     collection is teacher-only on purpose, and a student who could
     advance themselves could assign themselves anything.)

     A `sequence` is an ordered array of STEPS, each an array of list ids
     that unlock together. What comes back is ADDITIVE — every step up to
     and including the first unfinished one — because a finished list
     stays in rotation. The scheduler already damps a mastered word into
     near-invisibility; taking the list away as well is how a student
     loses a word they had.

     `totalOf(listId)` is injected because this file knows nothing about
     the word library. Without it nothing is ever done and only the first
     step unlocks, which is the safe way to be wrong. */
  function listShare(stats, listId, totalOf){
    var total = typeof totalOf === "function" ? (totalOf(listId) || 0) : 0;
    if(!total) return 0;
    var prefix = listId + "|", solid = 0;
    for(var k in stats){
      if(!has(stats, k) || k.indexOf(prefix) !== 0) continue;
      var s = sanitizeStat(stats[k]);
      // Solid AND at pace, where anything timed it. A word that was
      // never timed has lat 0 and is simply solid, which is every mode
      // but the flash cards.
      if(isMastered(s) && !isSlow(s)) solid++;
    }
    return solid / total;
  }

  function unlocked(sequence, stats, startAt, totalOf){
    var steps = Array.isArray(sequence) ? sequence : [];
    var from = clamp(Math.floor(num(startAt, 0)), 0, Math.max(0, steps.length - 1));
    var ids = [], i, j, step, stepDone;
    for(i=0;i<=from && i<steps.length;i++){
      // Everything up to the starting step is unlocked outright: a
      // student placed at step four by the screener has not "finished"
      // steps one to three, and must not have to.
      for(j=0;j<(steps[i] || []).length;j++) if(ids.indexOf(steps[i][j]) === -1) ids.push(steps[i][j]);
    }
    var index = from;
    for(i=from;i<steps.length;i++){
      step = steps[i] || [];
      for(j=0;j<step.length;j++) if(ids.indexOf(step[j]) === -1) ids.push(step[j]);
      stepDone = step.length > 0 && step.every(function(id){
        return listShare(stats, id, totalOf) >= SOLID_ENOUGH;
      });
      index = i;
      // `stepIds` is what the CURRENT step opened, which is what a
      // "new list" message has to name — the whole unlocked set would
      // announce everything the student has ever been given.
      if(!stepDone) return { ids: ids, stepIndex: i, stepIds: step.slice(), done: false };
    }
    return { ids: ids, stepIndex: index, stepIds: (steps[index] || []).slice(), done: steps.length > 0 };
  }

  /* ── what should change ────────────────────────────────────────────
     One line per student, or none. A dashboard that shows everything
     shows nothing: a teacher with thirty students and four numbers each
     has a hundred and twenty numbers and no next action, which is the
     state this site was in. So: at most one sentence per student, the
     first rule that fires wins, and the rules are ordered by how much
     the answer costs to get wrong.

     Pure, and takes a summary rather than reaching for anything —
     teacher.js assembles it out of what it has already loaded.

       nextSteps({
         lists: [{ id, title, mode, family, attempts, share, accuracy,
                   hasSay, hasMatch, sayId, cardsId, cardsShare }],
         lastRound,        // epoch ms of their last finished round
         sequenceOn,       // is their period running a course
         now
       })
       -> { rule, text, listId, addId } | null

     `addId` is the list the one-click apply would add, where there is
     one; a line about turning a sequence on or about a student who has
     stopped practising has nothing to add and says so by leaving it out. */
  var STUCK_ATTEMPTS = 30;
  var STUCK_SHARE    = 0.4;
  var MATCH_ACC      = 0.5;
  var CARDS_READY    = 0.6;
  var COASTING       = 0.9;
  var QUIET_DAYS     = 7;      // school days, not calendar days

  // Monday to Friday between two moments. A student who last practised
  // on a Friday has not "gone quiet" by Monday, and a rule that counted
  // calendar days would say they had every single weekend.
  function schoolDaysBetween(from, to){
    var a = Math.floor(num(from, 0)), b = Math.floor(num(to, 0));
    if(!a || b <= a) return 0;
    var days = Math.floor((b - a) / DAY);
    if(days <= 0) return 0;
    var count = 0, d = new Date(a), i;
    for(i=0;i<days && i<400;i++){
      d = new Date(d.getTime() + DAY);
      var wd = d.getDay();
      if(wd !== 0 && wd !== 6) count++;
    }
    return count;
  }

  function nextSteps(info){
    info = info || {};
    var lists = info.lists || [];
    var now = num(info.now, 0);

    /* 1. Stuck on cards. Thirty attempts and under 40 % solid is a
          student who is being shown a word, saying "not yet", and being
          shown it again — for as long as anyone leaves them there. The
          answer is almost never more cards. */
    for(var i=0;i<lists.length;i++){
      var l = lists[i];
      if(l.mode !== "cards") continue;
      if(l.attempts < STUCK_ATTEMPTS || l.share >= STUCK_SHARE) continue;
      if(l.hasSay && l.sayId){
        return { rule: "stuck", listId: l.id, addId: l.sayId,
          text: "Stuck on " + l.title + " — " + Math.round(l.share * 100) +
                "% solid after " + l.attempts + " answers. Try Say It on the same words." };
      }
      if(l.hasMatch && l.matchId){
        return { rule: "stuck", listId: l.id, addId: l.matchId,
          text: "Stuck on " + l.title + " — " + Math.round(l.share * 100) +
                "% solid after " + l.attempts + " answers. Match It first might be kinder." };
      }
      return { rule: "stuck", listId: l.id,
        text: "Stuck on " + l.title + " — " + Math.round(l.share * 100) +
              "% solid after " + l.attempts + " answers." };
    }

    /* 2. Match It before the cards are solid. Picking a word out of six
          look-alikes is harder than reading it, not easier, so a student
          failing at it on words they can't yet read has been given the
          two in the wrong order. */
    for(i=0;i<lists.length;i++){
      var m = lists[i];
      if(m.mode !== "match" || m.accuracy == null) continue;
      if(m.accuracy >= MATCH_ACC) continue;
      if(m.cardsShare == null || m.cardsShare >= CARDS_READY) continue;
      return { rule: "order", listId: m.id, addId: m.cardsId || null,
        text: m.title + ": " + Math.round(m.accuracy * 100) + "% on Match It, but the cards are only " +
              Math.round(m.cardsShare * 100) + "% solid. Cards first." };
    }

    /* 3. Coasting. Everything they have is finished, and nothing is
          arriving, because nobody has turned the course on. */
    if(lists.length && !info.sequenceOn){
      var allSolid = lists.every(function(x){ return x.share >= COASTING; });
      if(allSolid){
        return { rule: "coasting",
          text: "Everything on their list is " + Math.round(COASTING * 100) +
                "%+ solid. Turn their period's sequence on, or add the next list." };
      }
    }

    /* 4. Quiet. Last, because it is the one a teacher can already see —
          but it outranks nothing and gets said when there is nothing
          better to say. */
    if(info.lastRound && schoolDaysBetween(info.lastRound, now) > QUIET_DAYS){
      return { rule: "quiet",
        text: "Hasn't practised in " + schoolDaysBetween(info.lastRound, now) + " school days." };
    }
    return null;
  }

  /* The commonest kind of error in a tally, or null. Ties break by the
     order in ERROR_KINDS — which is diagnose()'s own order of
     specificity, so a tie goes to the more specific diagnosis. */
  function topKind(kinds){
    var best = null, bestN = 0;
    ERROR_KINDS.forEach(function(k){
      var v = (kinds && kinds[k]) || 0;
      if(v > bestN){ best = k; bestN = v; }
    });
    return best ? { kind: best, n: bestN } : null;
  }

  // The subset of a stat map belonging to one list, re-keyed by bare word
  // — which is the shape pickSession and rank want.
  function statsForList(stats, listId){
    var out = {}, prefix = listId + "|";
    for(var k in stats){
      if(!has(stats, k) || k.indexOf(prefix) !== 0) continue;
      out[k.slice(prefix.length)] = sanitizeStat(stats[k]);
    }
    return out;
  }

  return {
    keyFor: keyFor,
    parseKey: parseKey,
    statsForList: statsForList,
    emptyStat: emptyStat,
    sanitizeStat: sanitizeStat,
    sanitizeStats: sanitizeStats,
    heardCap: HEARD_CAP,
    cleanHeard: cleanHeard,
    pushHeard: pushHeard,
    sanitizeHeard: sanitizeHeard,
    fluencyCap: FLUENCY_CAP,
    sanitizeFluency: sanitizeFluency,
    pushRun: pushRun,
    fluencySummary: fluencySummary,
    updateStat: updateStat,
    accuracy: accuracy,
    rawAccuracy: rawAccuracy,
    isMastered: isMastered,
    isSlow: isSlow,
    solidEnough: SOLID_ENOUGH,
    listShare: listShare,
    unlocked: unlocked,
    nextSteps: nextSteps,
    schoolDaysBetween: schoolDaysBetween,
    errorKinds: ERROR_KINDS.slice(),
    sanitizeKinds: sanitizeKinds,
    topKind: topKind,
    dueFactor: dueFactor,
    weight: weight,
    pickSession: pickSession,
    rank: rank,
    summarize: summarize,
    _constants: {
      NEW_WEIGHT: NEW_WEIGHT, MAX_BOX: MAX_BOX, BOX_DAYS: BOX_DAYS,
      REST_FLOOR: REST_FLOOR, MASTERED_DAMP: MASTERED_DAMP,
      MASTERED_ACC: MASTERED_ACC, DAY: DAY,
      SLOW_MS: SLOW_MS, SLOW_BOOST: SLOW_BOOST, LAT_ALPHA: LAT_ALPHA, MAX_LAT_MS: MAX_LAT_MS,
      SOLID_ENOUGH: SOLID_ENOUGH,
      STUCK_ATTEMPTS: STUCK_ATTEMPTS, STUCK_SHARE: STUCK_SHARE,
      MATCH_ACC: MATCH_ACC, CARDS_READY: CARDS_READY,
      COASTING: COASTING, QUIET_DAYS: QUIET_DAYS
    }
  };
})();
