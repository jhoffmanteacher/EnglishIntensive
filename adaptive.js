/* ════════════════════════════════════════════════════════════════════
   adaptive.js — which words come up next, and how often.

   Everything here is PURE: no DOM, no storage, no clock of its own (the
   caller passes `now`), no randomness that isn't injected (`rnd`). That
   is what makes it testable — tests.html exercises the whole file — and
   it is why the scheduling rules live here rather than inside the game
   engines, which are full of mic state and timers.

   ── The model ─────────────────────────────────────────────────────────
   One stat record per word, per list:

     { n, r, w, s, box, last }
       n     times the word has come up
       r     times it came back RIGHT ON THE FIRST TRY
       w     times it didn't
       s     current run of first-try-correct answers
       box   Leitner box, 0–5 — how long the word has earned off
       last  epoch ms of the last time it came up

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

  function has(o, k){ return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function clamp(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }
  function num(v, dflt){ return (typeof v === "number" && isFinite(v)) ? v : dflt; }

  function emptyStat(){ return { n:0, r:0, w:0, s:0, box:0, last:0 }; }

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
      last: Math.max(0, Math.floor(num(raw.last, 0)))
    };
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
  function updateStat(stat, correct, now){
    var s = sanitizeStat(stat);
    s.n += 1;
    s.last = Math.max(0, Math.floor(num(now, 0)));
    if(correct){
      s.r += 1;
      s.s += 1;
      s.box = Math.min(MAX_BOX, s.box + 1);
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
    var attempts = 0, right = 0, words = 0, mastered = 0, struggling = 0, last = 0;
    for(var word in stats){
      if(!has(stats, word)) continue;
      var s = sanitizeStat(stats[word]);
      if(!s.n) continue;
      words++; attempts += s.n; right += s.r;
      if(s.last > last) last = s.last;
      if(isMastered(s)) mastered++;
      else if(rawAccuracy(s) < 0.6) struggling++;
    }
    return {
      words: words,
      attempts: attempts,
      right: right,
      accuracy: attempts ? right / attempts : null,
      mastered: mastered,
      struggling: struggling,
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
    updateStat: updateStat,
    accuracy: accuracy,
    rawAccuracy: rawAccuracy,
    isMastered: isMastered,
    dueFactor: dueFactor,
    weight: weight,
    pickSession: pickSession,
    rank: rank,
    summarize: summarize,
    _constants: {
      NEW_WEIGHT: NEW_WEIGHT, MAX_BOX: MAX_BOX, BOX_DAYS: BOX_DAYS,
      REST_FLOOR: REST_FLOOR, MASTERED_DAMP: MASTERED_DAMP,
      MASTERED_ACC: MASTERED_ACC, DAY: DAY
    }
  };
})();
