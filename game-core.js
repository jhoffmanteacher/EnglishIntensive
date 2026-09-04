/* Shared core for the game engines.
 *
 * There are four engines on this site — blend-game.js (say it), spell-game.js
 * (type it), card-game.js (flip it), match-game.js (find it) — and they
 * deliberately share a look, a scoring system and a set of habits, so a
 * student moving between them sees one game with different questions. That
 * agreement used to be maintained by copying code between the engines and
 * writing "keep this in step" on top of each copy. At two copies that was
 * the right trade against a no-build site. By four it wasn't: the scoring
 * was in four places, the comeback deck in three, the vault-run SVG in three
 * more, and every one of them was a chance for two games to quietly start
 * behaving differently.
 *
 * So the parts that MUST agree live here, once, and the engines load this
 * file first:
 *
 *   <script src="game-core.js"></script>
 *   <script src="blend-game.js"></script>
 *
 * What belongs here is what would be a bug if it differed between games:
 * scoring, the comeback deck, the progress graphic, the stars, the confetti,
 * the voice ranking. What stays in an engine is what SHOULD differ — how it
 * asks its question, how it judges the answer, and what it does with the
 * microphone. blend-game.js speaks and beeps around a live recognizer, so it
 * keeps its own say() and passes its mic-hold in as a callback here rather
 * than pushing microphone bookkeeping into shared code.
 *
 * Still no build step: this is one more plain <script> on a page that
 * already had two.
 */
window.GameCore = (function(){
  "use strict";

  /* ---------------- scoring (pure, testable) ----------------
     10 points × a streak-driven multiplier (×1, ×2 from a streak of 5, ×3
     from 10 up, capped there), plus a +25 milestone on every 5th in a row.
     `streak` INCLUDES the answer being scored, so streak 5 pays
     10×2+25 = 45. */
  function comboMultiplier(streak){
    return Math.min(3, 1 + Math.floor(streak/5));
  }
  function pointsFor(streak){
    return 10 * comboMultiplier(streak) + (streak > 0 && streak % 5 === 0 ? 25 : 0);
  }

  // 0–3 stars: 3 at 90%+, 2 at 70%+, 1 at 50%+. Unearned slots still render
  // as dim outlines, so a 2-star finish visibly has room to grow.
  function starsFor(pct){
    return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0;
  }
  function renderStars(el, pct){
    if(!el) return;
    var lit = starsFor(pct);
    el.innerHTML = "";
    for(var i=0; i<3; i++){
      var st = document.createElement("span");
      st.className = "star" + (i < lit ? " lit" : "");
      st.style.animationDelay = (0.25 + i*0.3) + "s";
      st.textContent = "★";
      el.appendChild(st);
    }
  }

  /* ---------------- word lists (pure, testable) ---------------- */
  function shuffled(a){
    var b = a.slice();
    for(var i=b.length-1;i>0;i--){ var j = Math.floor(Math.random()*(i+1)); var t=b[i]; b[i]=b[j]; b[j]=t; }
    return b;
  }

  // Printed word lists repeat words across lists on purpose (the red-word
  // screener re-tests "you", "friend", "sure" and "enough" at a harder
  // point). Across rounds that's intended; inside one round the same card
  // coming round twice just reads as a bug. First occurrence wins, so a deck
  // keeps its printed order.
  function dedupeWords(list){
    var out = [], seen = {};
    if(!list) return out;
    for(var i=0;i<list.length;i++){
      var w = list[i];
      if(typeof w !== "string" || !w) continue;
      if(has(seen, w)) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }

  /* ---------------- the start screen, read aloud ----------------
     Every game has a "Read directions aloud" button, and every game was
     building the text for it itself: four copies of the same DOM walk,
     which had drifted into four copies of the same two bugs.

     The first was `.sub`.textContent. An intro is deliberately two short
     sentences split by a <br>, and textContent drops the <br> silently —
     so the two sentences came out welded into one run-on with no pause
     exactly where the pause was meant to be. Splitting the innerHTML on
     <br> first, then taking textContent of each half, keeps the break.

     The second was joining the fragments with ". ". Every fragment
     already ends in its own full stop, so the glue doubled it up, and it
     all went to the synthesiser as ONE utterance — which is not how the
     rest of this site speaks anything. An engine speaks these as separate
     utterances queued back to back, which gives a truer pause between
     them than any punctuation would.

     So the walk lives here and returns fragments; each engine keeps its
     own speaking, because that part legitimately differs — the blend game
     has to stand its microphone down first and the others don't. */

  // Collapse whitespace, and say the arrow rather than skipping it.
  function spokenText(el){
    return String(el && el.textContent || "").replace(/\s+/g, " ").replace(/→/g, "leads to").trim();
  }

  /* The start screen as an ordered list of things to say: the intro (one
     fragment per <br>-separated sentence), then the rule box if there is
     one, then any "good to know" note, then the numbered steps. Takes the
     screen's element so it can be tested against a detached one. */
  function directionParts(root){
    var parts = [];
    if(!root) return parts;

    var intro = root.querySelector(".sub");
    if(intro){
      // innerHTML, not textContent: the <br> is the sentence break, and
      // it has to survive into its own utterance.
      intro.innerHTML.split(/<br\s*\/?>/i).forEach(function(html){
        var tmp = document.createElement("div");
        tmp.innerHTML = html;
        var t = spokenText(tmp);
        if(t) parts.push(t);
      });
    }
    /* The rule box and the "Good to know" note, in the order they appear
       on screen. Each starts with its own .tag — "The rule", "Good to
       know" — spoken as its own fragment: it is a heading a sighted
       student reads before the paragraph under it, and a listening
       student should get the same warning that the subject just changed.
       Announcing it from the tag rather than from a hard-coded string is
       the same rule as everything else here — say what is on screen, so
       there is no second copy to drift. */
    [".rule", ".note"].forEach(function(sel){
      var box = root.querySelector(sel);
      if(!box) return;
      var tag = box.querySelector(".tag");
      if(tag){
        var label = spokenText(tag);
        // A heading, so it wants a full stop the paragraph won't supply.
        if(label) parts.push(/[.!?]$/.test(label) ? label : label + ".");
      }
      box.querySelectorAll(":scope > *:not(.tag), :scope > *:not(.tag) li").forEach(function(el){
        // A <ul> and its <li>s would otherwise be read twice over.
        if(el.querySelector("li")) return;
        var t = spokenText(el);
        if(t) parts.push(t);
      });
    });
    root.querySelectorAll(".steps li").forEach(function(li){
      var t = spokenText(li);
      if(t) parts.push(t);
    });
    return parts;
  }

  /* ---------------- phonetic encoding (pure, testable) ----------------
     Everything here compares SOUNDS, not letters, so "krab" can match
     "crab" (same sounds, different spelling) while "bled" still never
     matches "bred" (different sounds, similar spelling). None of this is
     full text-to-speech phoneme conversion (G2P) — it's a small rule-based
     encoder good enough for the 1–2 syllable classroom words used here.

     phonemeSpans(word) walks the string left to right, matching the
     longest applicable rule at each position first: digraphs/trigraphs
     (ch, th, igh, dge…), then vowel teams (ai, ee, oo…) and r-controlled
     vowels (ar, er…), then magic-e (silent final e that lengthens the
     vowel before it), then plain letters. Examples:
       phonemes("crab")  -> ["K","R","AE","B"]
       phonemes("krab")  -> ["K","R","AE","B"]   (same — passes)
       phonemes("plum")  -> ["P","L","UH","M"]
       phonemes("plumb") -> ["P","L","UH","M"]   (silent b after m — same)
       phonemes("sled")  -> ["S","L","EH","D"]
       phonemes("slade") -> ["S","L","EY","D"]   (differ only in the vowel)

     This lived in blend-game.js while Say It was the only thing that
     listened. It is core now because three other things need it: the
     cards page judges a spoken answer without loading the say engine,
     the phoneme clips in audio/ph are keyed by these tokens, and
     diagnose() below has to point at the LETTERS behind a wrong sound —
     which is what the spans are for. A span carries the sound and the
     slice of the word that spells it, so a diagnosis can highlight "ai"
     rather than "the third phoneme". */

  var SHORT_VOWEL = { a:"AE", e:"EH", i:"IH", o:"AO", u:"UH" };
  var LONG_VOWEL  = { a:"EY", e:"IY", i:"AY", o:"OW", u:"UW" };
  var VOWEL_PHONES = { AE:1,EH:1,IH:1,AO:1,UH:1,EY:1,IY:1,AY:1,OW:1,UW:1,AW:1,OY:1,AR:1,OR:1,ER:1 };

  function isVowelPhone(p){ return !!VOWEL_PHONES[p]; }
  function isVowelLetter(ch){ return ch==="a"||ch==="e"||ch==="i"||ch==="o"||ch==="u"; }
  function isConsonantLetter(ch){ return /[a-z]/.test(ch) && !isVowelLetter(ch); }

  // c/g are "soft" before e, i or y (cent, gem); x and everything else is
  // a fixed letter-to-sound mapping.
  function consonantToken(ch, next){
    if(ch === "c") return (next==="e"||next==="i"||next==="y") ? "S" : "K";
    if(ch === "g") return (next==="e"||next==="i"||next==="y") ? "J" : "G";
    if(ch === "x") return "KS";
    return ch.toUpperCase();
  }

  // The word as [{ ph, start, end }] — `start`/`end` index the lowercased,
  // letters-only word, so the spans are contiguous and together cover all
  // of it. A silent letter has no sound of its own, so it is folded into
  // the span before it ("said" is S + ai + D, "slide" is S+L + i + d-e)
  // rather than left as a hole a highlight could fall through.
  function phonemeSpans(word){
    word = String(word||"").toLowerCase().replace(/[^a-z]/g,"");
    var out = [], i = 0, n = word.length;
    function at(s){ return word.substr(i, s.length) === s; }
    function push(ph, len){ out.push({ ph: ph, start: i, end: i + len }); i += len; }
    // Extend the previous sound over letters that make no sound of their own.
    function absorb(len){
      if(out.length) out[out.length-1].end += len;
      i += len;
    }
    while(i < n){
      var c = word.charAt(i);

      // Trigraphs/tetragraphs first, longest match wins.
      if(at("eigh")){ push("EY", 4); continue; }
      if(at("igh")){ push("AY", 3); continue; }
      if(at("tch")){ push("C", 3); continue; }
      if(at("dge")){ push("J", 3); continue; }
      if(at("mb") && i+2===n){ push("M", 2); continue; }   // silent b, end only

      // Digraphs.
      if(at("ch")){ push("C", 2); continue; }
      if(at("sh")){ push("SH", 2); continue; }
      if(at("th")){ push("TH", 2); continue; }
      if(at("ph")){ push("F", 2); continue; }
      if(at("wh")){ push("W", 2); continue; }
      if(at("ck")){ push("K", 2); continue; }
      if(at("ng")){ push("NG", 2); continue; }
      if(at("qu")){ push("KW", 2); continue; }
      if(i===0 && at("wr")){ push("R", 2); continue; }
      if(i===0 && at("kn")){ push("N", 2); continue; }
      if(i===0 && at("gn")){ push("N", 2); continue; }

      // Vowel teams and r-controlled vowels.
      if(at("ai")||at("ay")){ push("EY", 2); continue; }
      if(at("ee")||at("ea")){ push("IY", 2); continue; }
      if(at("oa")||at("ow")){ push("OW", 2); continue; }
      if(at("oo")){ push("UW", 2); continue; }
      if(at("ou")){ push("AW", 2); continue; }
      if(at("oi")||at("oy")){ push("OY", 2); continue; }
      if(at("ar")){ push("AR", 2); continue; }
      if(at("or")){ push("OR", 2); continue; }
      if(at("er")||at("ir")||at("ur")){ push("ER", 2); continue; }

      // Magic e: vowel + single consonant + silent final e lengthens the vowel.
      if(isVowelLetter(c) && (i+2)===(n-1) && word.charAt(i+2)==="e" && isConsonantLetter(word.charAt(i+1))){
        push(LONG_VOWEL[c], 1); continue;
      }
      // A word-final e that wasn't just consumed above is silent.
      if(c==="e" && i===n-1 && n>1){ absorb(1); continue; }

      // Doubled consonants collapse to one sound ("ll" -> L, "ss" -> S…).
      if(isConsonantLetter(c) && word.charAt(i+1)===c){
        push(consonantToken(c, word.charAt(i+2)), 2); continue;
      }

      if(c==="y"){
        push(i===0 ? "Y" : (i===n-1 ? "IY" : "IH"), 1); continue;
      }
      if(isVowelLetter(c)){ push(SHORT_VOWEL[c], 1); continue; }
      push(consonantToken(c, word.charAt(i+1)), 1);
    }
    return out;
  }

  // The sounds alone. Derived from the spans rather than walked separately,
  // so the two can never disagree about how a word is encoded.
  function phonemes(word){
    return phonemeSpans(word).map(function(s){ return s.ph; });
  }

  // Phoneme-level edit distance. Recognisers mangle vowels far more than
  // consonants, so swapping one vowel sound for another costs half as much
  // as any other kind of change. A plain consonant-for-consonant swap costs
  // *more* than a full point (not exactly 1) so it never fits inside
  // Regular's budget of 1 — a wrong consonant almost always means a
  // different word entirely (e.g. "vest" heard as "nest"), not a mishearing,
  // so Regular shouldn't forgive it the same way it forgives vowel drift.
  function subCostOf(a, b){
    if(a === b) return 0;
    return (isVowelPhone(a) && isVowelPhone(b)) ? 0.5 : 1.5;
  }

  function phoneticDistance(a, b){
    var m=a.length, n=b.length, i, j, prev=[], cur=[];
    for(j=0;j<=n;j++) prev[j]=j;
    for(i=1;i<=m;i++){
      cur[0]=i;
      for(j=1;j<=n;j++){
        cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+subCostOf(a[i-1], b[j-1]));
      }
      for(j=0;j<=n;j++) prev[j]=cur[j];
    }
    return prev[n];
  }

  var NUM_WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
                    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen",
                    "eighteen","nineteen","twenty"];

  function normalize(s){
    s = String(s||"");
    // The recogniser sometimes returns a number instead of a short word
    // ("tent" -> "10"); spell 0-20 back out before stripping non-letters,
    // since that stripping would otherwise just delete the digits.
    s = s.replace(/\b\d{1,2}\b/g, function(d){
      var v = parseInt(d,10);
      return NUM_WORDS[v] !== undefined ? NUM_WORDS[v] : d;
    });
    return s.toLowerCase().replace(/[^a-z' ]/g," ").replace(/\s+/g," ").trim();
  }

  // Locate a phoneme subsequence (e.g. ["OY"]) anywhere in a phoneme array —
  // used by "sound" mode, where the target sound isn't pinned to the start
  // or end of the word (the oi/oy diphthong can land anywhere: "coin",
  // "boyish", "annoy"). Returns the index it starts at, or -1.
  function findPhonemeSeq(arr, seq){
    for(var i=0;i+seq.length<=arr.length;i++){
      var ok = true;
      for(var j=0;j<seq.length;j++){ if(arr[i+j]!==seq[j]){ ok=false; break; } }
      if(ok) return i;
    }
    return -1;
  }

  // Known-good transcripts the recogniser returns for specific target words,
  // seeded from mishearings actually observed in class — not a guess at
  // every possible mishearing. Accepted at Regular, never Challenge.
  // Add more here as they turn up; keep it short and commented — and see
  // the teacher dashboard's "most often heard as" column, which is where a
  // mishearing worth adding shows itself.
  var ACCEPT = {
    gasp: ["gas"],     // final consonant dropped
    tent: ["tenth"]    // recogniser adds a trailing "th" sound
  };


  /* ---------------- diagnosis (pure, testable) ----------------
     A red ✗ tells a student they were wrong. It does not tell them WHICH
     part was wrong, and for a reader who is guessing at blends or sliding
     off vowels that is the only part worth knowing. diagnose() takes what
     the recogniser heard and the word that was on screen, lines the two
     up sound by sound, and names the first thing that went wrong — with
     the letters that spell it, so the reveal can light them up.

     It is deliberately one answer, not a list. A wrong reading usually
     has one cause; showing three guesses at once is how a hint becomes
     noise. The order the rules are tried in is the order a teacher would
     look: the blend being practised first, then the target sound, then
     the vowel, then everything else. */

  // The edit script behind phoneticDistance: the same costs and the same
  // total, plus a backtrace saying what happened where. `i` indexes the
  // heard sounds, `j` the target's; an "ins" is a sound the student added
  // and a "del" one they dropped.
  function phoneticAlign(a, b){
    var m = a.length, n = b.length, i, j;
    var d = [];
    for(i=0;i<=m;i++){ d[i] = []; d[i][0] = i; }
    for(j=0;j<=n;j++) d[0][j] = j;
    for(i=1;i<=m;i++){
      for(j=1;j<=n;j++){
        d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + subCostOf(a[i-1], b[j-1]));
      }
    }
    var ops = [];
    i = m; j = n;
    while(i > 0 || j > 0){
      if(i > 0 && j > 0 && d[i][j] === d[i-1][j-1] + subCostOf(a[i-1], b[j-1])){
        ops.push({ op: a[i-1] === b[j-1] ? "match" : "sub", i: i-1, j: j-1 });
        i--; j--;
      } else if(i > 0 && d[i][j] === d[i-1][j] + 1){
        ops.push({ op: "ins", i: i-1, j: j });
        i--;
      } else {
        ops.push({ op: "del", i: i, j: j-1 });
        j--;
      }
    }
    ops.reverse();
    return ops;
  }

  // phonemeSpans indexes the letters-only word; a highlight has to index
  // the word as written, apostrophes and periods included ("they'd").
  function letterOffsets(word){
    var s = String(word == null ? "" : word), out = [], i;
    for(i=0;i<s.length;i++) if(/[a-z]/i.test(s.charAt(i))) out.push(i);
    return out;
  }

  // A [start,end) over the letters-only word, as a [start,end) over the
  // word as written.
  function spanInWord(word, start, end){
    var off = letterOffsets(word);
    if(!off.length) return [0, String(word || "").length];
    if(start < 0) start = 0;
    if(end > off.length) end = off.length;
    if(end <= start) end = start + 1;
    if(end > off.length) return [off[0], off[off.length-1] + 1];
    return [off[start], off[end-1] + 1];
  }

  // ≤ 8 words each, and never a term a ninth grader hasn't been taught.
  // The letters go in the sentence rather than beside it because the
  // whole point is to send the eye back to that piece of the word.
  function diagnosisMessage(kind, letters){
    if(kind === "blend")     return "Look at the blend: " + letters;
    if(kind === "sound")     return "The " + letters + " sound is the key";
    if(kind === "vowel")     return "Check the vowel: " + letters;
    if(kind === "consonant") return "Listen to the " + letters + " sound";
    if(kind === "missing")   return "You dropped a sound: " + letters;
    if(kind === "extra")     return "That's one sound too many";
    return "Read it slowly, left to right";
  }

  /* diagnose(heard, target, opts) -> null when they match, else
       { kind, span:[start,end], heard, message }
     opts is what Say It already knows about the list: { atStart,
     blendLength, soundSeq, highlight }. */
  function diagnose(heard, target, opts){
    opts = opts || {};
    var word = String(target == null ? "" : target);
    var tPh = phonemes(word);
    var text = normalize(heard);
    if(!text) return null;

    // A transcript can be several words ("bread crab"). Judge the one that
    // was the best attempt at the target, not the first thing said.
    var parts = text.split(" "), best = parts[0], bestD = Infinity, k;
    for(k=0;k<parts.length;k++){
      if(!parts[k]) continue;
      var dd = phoneticDistance(phonemes(parts[k]), tPh);
      if(dd < bestD){ bestD = dd; best = parts[k]; }
    }
    var hPh = phonemes(best);
    // Only the word itself is "no diagnosis". Same sounds spelled another
    // way ("krab") still gets one: it is a miss at Challenge, and telling
    // that student to slow down is the only honest thing left to say.
    if(best === normalize(word)) return null;

    function out(kind, span){
      var letters = word.slice(span[0], span[1]);
      return { kind: kind, span: span, heard: text, message: diagnosisMessage(kind, letters) };
    }

    var spans = phonemeSpans(word);
    function spanOf(idx){
      if(!spans.length) return [0, word.length];
      if(idx < 0) idx = 0;
      if(idx >= spans.length) idx = spans.length - 1;
      return spanInWord(word, spans[idx].start, spans[idx].end);
    }

    // 1. The blend being practised. It is the skill on the page, so a
    //    wrong blend is the answer even when something else is wrong too.
    var blendLength = opts.blendLength;
    if(blendLength > 0){
      var atStart = !!opts.atStart;
      var tBlend = phonemes(atStart ? word.slice(0, blendLength) : word.slice(-blendLength));
      var hBlend = phonemes(atStart ? best.slice(0, blendLength) : best.slice(-blendLength));
      if(tBlend.join(" ") !== hBlend.join(" ")){
        var letters = word.replace(/[^a-z]/gi, "").length;
        return out("blend", atStart ? spanInWord(word, 0, blendLength)
                                    : spanInWord(word, letters - blendLength, letters));
      }
    }

    // 2. Sound mode: the one sound the list exists for is simply absent.
    if(opts.soundSeq && findPhonemeSeq(hPh, opts.soundSeq) === -1){
      var hit = opts.highlight ? word.match(opts.highlight) : null;
      var span = hit ? [hit.index, hit.index + hit[0].length] : [0, word.length];
      return out("sound", span);
    }

    // 3-6. The first thing the alignment disagrees about.
    var ops = phoneticAlign(hPh, tPh), o;
    for(k=0;k<ops.length;k++){
      o = ops[k];
      if(o.op === "sub"){
        var vowels = isVowelPhone(hPh[o.i]) && isVowelPhone(tPh[o.j]);
        return out(vowels ? "vowel" : "consonant", spanOf(o.j));
      }
      if(o.op === "del") return out("missing", spanOf(o.j));
      if(o.op === "ins") return out("extra", spanOf(o.j > 0 ? o.j - 1 : 0));
    }

    // 7. Same sounds, different word — nothing to point at.
    return out("other", [0, word.length]);
  }

  /* ---------------- syllable chunks (pure, testable) ----------------
     A word list may write a word with middle dots marking its syllable
     boundaries — "fan·tas·tic". The dots are a teaching aid for the
     display only: the plain word is the ONLY form that reaches phoneme
     matching, TTS, or a stored stat key, so a dotted entry and an
     undotted one are the same word everywhere it counts.

     This used to live in blend-game.js alone, because it was the only
     engine playing the multisyllable list. Now that every list can be
     played as cards or Match It, all three need the same answer to
     "what word is this really?" — so it lives here, with the rest of
     what the engines must agree about. */
  var CHUNK_SEP = "\u00b7";   // middle dot (·)

  /* ---------------- heart letters ----------------
     A second, independent mark an entry may carry: braces around the part
     of a word the phonics rules get WRONG — "s{ai}d", "c{oul}d". Red words
     are taught as if they were unsplittable wholes, and they mostly
     aren't: "said" is s + d with one impossible middle, and the student
     only has to remember the middle. Naming that part is the difference
     between memorising four letters and memorising one chunk.

     Deliberately hand-marked, not derived. phonemes() would flag the vowel
     team in every regular word too, and "the part you can't sound out" is
     a teaching judgement, not a rule the encoder knows.

     Braces and dots combine ("al{th}·ough" is legal) and both are display
     only: the plain word is the ONLY form that reaches matching, TTS or a
     stored stat key, exactly as with the dots alone. */
  var HEART_OPEN = "{", HEART_CLOSE = "}";

  function parseEntry(entry){
    var s = String(entry == null ? "" : entry);
    var hasHeart = s.indexOf(HEART_OPEN) !== -1;
    var hasChunk = s.indexOf(CHUNK_SEP) !== -1;
    if(!hasHeart){
      if(!hasChunk) return { word: s, chunks: null, heart: null };
      return { word: s.split(CHUNK_SEP).join(""), chunks: s.split(CHUNK_SEP), heart: null };
    }
    // One walk, because the two marks index the same string: heart ranges
    // are positions in the PLAIN word, so they have to be counted as the
    // dots and the braces themselves are dropped.
    var word = "", chunks = [], cur = "", heart = [], open = -1, i, ch;
    for(i=0;i<s.length;i++){
      ch = s.charAt(i);
      if(ch === HEART_OPEN){ open = word.length; continue; }
      if(ch === HEART_CLOSE){
        if(open >= 0 && word.length > open) heart.push([open, word.length]);
        open = -1;
        continue;
      }
      if(ch === CHUNK_SEP){ chunks.push(cur); cur = ""; continue; }
      word += ch; cur += ch;
    }
    chunks.push(cur);
    return {
      word: word,
      chunks: chunks.length > 1 ? chunks : null,
      heart: heart.length ? heart : null
    };
  }

  /* `text` is a slice of the plain word starting at `offset`; the heart
     ranges are in whole-word coordinates. Returns escaped markup with the
     overlapping parts wrapped. Shared by the two markup functions below so
     a dotted word and an undotted one mark their hearts the same way. */
  function markHeart(text, offset, heart){
    if(!heart || !heart.length) return escapeHtml(text);
    var out = "", at = 0, i, s, e;
    for(i=0;i<heart.length;i++){
      s = Math.max(0, heart[i][0] - offset);
      e = Math.min(text.length, heart[i][1] - offset);
      if(e <= s || s >= text.length) continue;
      if(s > at) out += escapeHtml(text.slice(at, s));
      out += '<span class="heart">' + escapeHtml(text.slice(s, e)) + "</span>";
      at = e;
    }
    return out + escapeHtml(text.slice(at));
  }

  // The plain word with its heart letters marked, and nothing else.
  function heartMarkup(word, heart){
    return markHeart(String(word == null ? "" : word), 0, heart);
  }

  // The dotted word as markup: alternating syllable colours with the dot
  // between (echoing the "·" the word list itself is written with). Heart
  // letters, where the entry has any, are marked inside the syllables.
  function chunkMarkup(chunks, heart){
    var at = 0;
    return '<span class="chunkword">' + chunks.map(function(c, i){
      var start = at;
      at += c.length;
      return (i > 0 ? '<span class="chunk-sep">' + CHUNK_SEP + '</span>' : '') +
             '<span class="chunk ' + (i % 2 === 0 ? "chunk-a" : "chunk-b") + '">' + markHeart(c, start, heart) + '</span>';
    }).join("") + '</span>';
  }

  /* "s. a. i. d. said" — the word spelled out, then said. One string, so
     it is one utterance: a spelled word read as four separate utterances
     comes out as four separate thoughts. Used on the card's reveal, where
     the letters are the thing that has to be remembered. */
  function spellOut(word){
    var letters = String(word == null ? "" : word).split("").filter(function(ch){ return /[a-z']/i.test(ch); });
    if(!letters.length) return String(word == null ? "" : word);
    return letters.join(". ") + ". " + word;
  }

  // Random sample without replacement. `rnd` is a parameter rather than a
  // direct Math.random() call so tests can feed it a predictable sequence;
  // games never pass it.
  function sampleWords(list, n, rnd){
    var pool = dedupeWords(list);
    var random = typeof rnd === "function" ? rnd : Math.random;
    if(typeof n !== "number" || !isFinite(n) || n < 0) n = 0;
    n = Math.min(Math.floor(n), pool.length);
    // Partial Fisher-Yates: shuffle only the n slots actually being taken.
    for(var i=0;i<n;i++){
      var j = i + Math.floor(random() * (pool.length - i));
      if(j >= pool.length) j = pool.length - 1;   // guards rnd() returning 1
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n);
  }

  function escapeHtml(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  function has(o, k){ return Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------- comeback deck (pure, testable) ----------------
     Missed words don't vanish when the round ends — they're kept per game
     page so the next session can start with the words that are actually
     hard for this student. A word leaves the deck the moment it comes back
     right on the FIRST try, which is the whole pedagogy: the deck holds only
     what isn't mastered yet, so it shrinks as the student improves instead
     of growing into a punishment list.

     Store shape:  { v:1, words: { soft: {n:3, t:1717000000000}, … } }
       n — how many rounds the word has been missed in (drives priority)
       t — when it was last missed (breaks ties toward fresher trouble)

     Everything here is pure — a store goes in, a new store comes out — so
     localStorage only ever appears inside comebackStore() below. */
  var COMEBACK_VERSION = 1;
  var COMEBACK_CAP = 15;    // a warm-up, not a second full round

  // localStorage is shared, hand-editable and outlives any change to this
  // file, so whatever comes back out is treated as untrusted input: anything
  // that isn't an entry with a real positive miss count is dropped. A
  // corrupted deck should cost a student their review list, never the game.
  function sanitizeComeback(raw){
    var out = { v: COMEBACK_VERSION, words: {} };
    if(!raw || typeof raw !== "object" || !raw.words || typeof raw.words !== "object") return out;
    for(var w in raw.words){
      if(!has(raw.words, w) || !w) continue;
      var e = raw.words[w];
      if(!e || typeof e !== "object") continue;
      var n = Math.floor(Number(e.n)), t = Number(e.t);
      if(!isFinite(n) || n < 1) continue;
      out.words[w] = { n: n, t: (isFinite(t) && t > 0) ? t : 0 };
    }
    return out;
  }

  // Fold one round's missed words into the store. `at` is passed in rather
  // than read from Date.now() in here so the tie-breaking is testable. A
  // word repeated in one round's misses still only counts once — n counts
  // rounds gone wrong, not individual wrong tries.
  function comebackMerge(store, words, at){
    var out = sanitizeComeback(store), seen = {};
    if(!words) return out;
    for(var i=0;i<words.length;i++){
      var w = words[i];
      if(typeof w !== "string" || !w || has(seen, w)) continue;
      seen[w] = 1;
      out.words[w] = { n: (has(out.words, w) ? out.words[w].n : 0) + 1, t: at };
    }
    return out;
  }

  // A word earns its way out by coming back right on the first try. Getting
  // it on the second try doesn't count — that's still the stumble the deck
  // exists to catch.
  function comebackMastered(store, word){
    var out = sanitizeComeback(store);
    if(typeof word === "string" && has(out.words, word)) delete out.words[word];
    return out;
  }

  // Most-missed first, so a capped deck keeps the words that keep going
  // wrong rather than an arbitrary slice. Ties go to the most recently
  // missed word, then alphabetically — the last step is arbitrary but makes
  // the deck stable instead of following whatever order the object's keys
  // happen to come back in. The sort decides *which* words make the cap;
  // Shuffle may still reorder them within the round, which is fine.
  function comebackDeck(store, cap){
    var s = sanitizeComeback(store), list = [], w;
    for(w in s.words){ if(has(s.words, w)) list.push(w); }
    list.sort(function(a, b){
      if(s.words[b].n !== s.words[a].n) return s.words[b].n - s.words[a].n;
      if(s.words[b].t !== s.words[a].t) return s.words[b].t - s.words[a].t;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    if(typeof cap !== "number" || !isFinite(cap) || cap < 0) cap = COMEBACK_CAP;
    return list.slice(0, cap);
  }

  // The one place localStorage is touched. Keyed per game page, so each game
  // keeps its own deck and a deck can never be read by a game with a
  // different word list. Storage being unavailable (a locked-down profile,
  // private browsing) costs the review list and nothing else.
  function comebackStore(key){
    return {
      read: function(){
        try{ return sanitizeComeback(JSON.parse(localStorage.getItem(key))); }
        catch(e){ return sanitizeComeback(null); }
      },
      write: function(store){
        try{ localStorage.setItem(key, JSON.stringify(store)); }catch(e){}
      }
    };
  }

  /* ---------------- voice ----------------
     Which voice the site speaks with, picked once and re-picked when Chrome
     finishes loading its list. Every engine reads this; each one keeps its
     own say(), because what has to happen AROUND an utterance differs —
     blend-game.js has to stop a live recognizer first so it doesn't
     transcribe the computer. */
  var voice = null;

  // macOS/iOS ship joke voices (Albert croaks, Zarvox is a robot, Bahh is a
  // sheep) in the same en-US list as the real ones. "First local en-US voice"
  // used to be the fallback, and alphabetically that's Albert — so on Safari
  // a game could sound like a frog. Never pick these, even as a last resort;
  // a word-only fallback beats an unintelligible voice.
  var NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred/;

  function pickVoice(){
    if(!window.speechSynthesis) return;
    var all = window.speechSynthesis.getVoices() || [];
    var en = all.filter(function(v){
      return /^en/i.test(v.lang) && !NOVELTY.test(v.name);
    });
    if(!en.length) return;   // list not loaded yet; voiceschanged will retry
    function find(test){
      for(var i=0;i<en.length;i++){ if(test(en[i])) return en[i]; }
      return null;
    }
    voice =
      find(function(v){ return v.lang === "en-US" && /Google/.test(v.name); }) ||
      find(function(v){ return /Natural|Online/.test(v.name); }) ||
      find(function(v){ return /Samantha|Ava|Allison|Alex/.test(v.name); }) ||
      find(function(v){ return v.lang === "en-US" && v.localService; }) ||
      find(function(v){ return v.lang === "en-US"; }) ||
      en[0];
  }
  pickVoice();
  if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged = pickVoice;

  function currentVoice(){ return voice; }

  /* ---------------- sounds ----------------
     The four feedback blips, identical across the games so right and wrong
     sound the same wherever a student hears them. `onPlay` is called with
     how long the sound will run, in ms, before it plays: blend-game.js uses
     it to hold the microphone open so the game never transcribes its own
     beep. Nothing else needs it. */
  function sounds(opts){
    opts = opts || {};
    var onPlay = typeof opts.onPlay === "function" ? opts.onPlay : null;
    var actx = null;
    function beep(freqs, dur){
      if(onPlay) onPlay(((freqs.length - 1) * dur * 0.7 + dur) * 1000);
      try{
        if(!actx){ var C = window.AudioContext || window.webkitAudioContext; if(!C) return; actx = new C(); }
        if(actx.state === "suspended") actx.resume();
        freqs.forEach(function(f,i){
          var o = actx.createOscillator(), g = actx.createGain();
          o.type = "triangle"; o.frequency.value = f;
          var t = actx.currentTime + i * (dur*0.7);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g); g.connect(actx.destination);
          o.start(t); o.stop(t + dur + 0.02);
        });
      }catch(e){}
    }
    return {
      beep:  beep,
      good:  function(){ beep([660,880,1180],0.16); },
      bad:   function(){ beep([300,200],0.20); },
      win:   function(){ beep([660,880,1180,1560],0.18); },
      combo: function(){ beep([660,990,1320,1760],0.14); },   // milestone fanfare
      click: function(){ beep([440],0.06); }
    };
  }

  /* ---------------- confetti ---------------- */
  var CONFETTI_COLORS = ["#ffc94d","#3ddc97","#ff6b6b","#7dd3fc","#c084fc"];
  function confettiBurst(container, count){
    if(!container) return;
    for(var i=0;i<count;i++){
      var s = document.createElement("span");
      s.className = "confetti-piece";
      s.style.left = Math.random()*100 + "%";
      s.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      s.style.animationDelay = (Math.random()*0.3) + "s";
      s.style.setProperty("--r", Math.floor(Math.random()*360) + "deg");
      container.appendChild(s);
      (function(el){ setTimeout(function(){ el.remove(); }, 1700); })(s);
    }
  }

  /* ---------------- the score pop-up ---------------- */
  function popup(el, txt, color, big){
    if(!el) return;
    el.textContent = txt;
    el.style.color = color;
    el.classList.toggle("big", !!big);
    el.classList.remove("go"); void el.offsetWidth; el.classList.add("go");
  }

  /* ---------------- progress graphic ----------------
     Themed per game instead of a plain fill bar — same word-index percentage
     drives both, just rendered differently. "race" slides a car along a
     track toward a checkered flag; "maze" is a vault run, a runner threading
     a neon laser corridor toward the prize. Every look lives in
     blend-game.css; this only supplies the markup and the arithmetic, so a
     change there reaches all four games for free.

     progress("maze", {goal:"🏆", runner:"✏️"}) — the two emoji are the only
     thing a game may vary, so the spelling game can run a pencil at a trophy
     while the matching game runs a ninja at a diamond. */
  var MAZE_PATH = "M20,85 L150,85 L150,15 L300,15 L300,85 L450,85 L450,15 L580,15";

  function progress(theme, opts){
    opts = opts || {};
    var isMaze = theme === "maze";
    var goal = opts.goal || (isMaze ? "💎" : "🏁");
    var runner = opts.runner || "🥷";
    var mazeLen = null;    // cached path length, measured on first update
    var lastPct = null;    // last % drawn, so the race can drop dust behind it

    function markup(){
      if(isMaze){
        return `
    <div class="track track-maze">
      <svg viewBox="0 0 600 100" preserveAspectRatio="xMidYMid meet" class="maze-svg" aria-hidden="true">
        <path class="maze-wall" d="${MAZE_PATH}"></path>
        <path class="maze-path" d="${MAZE_PATH}"></path>
        <path id="mazeTrail" class="maze-trail" d="${MAZE_PATH}"></path>
        <text class="maze-goal" x="580" y="15">${goal}</text>
        <text id="mazeRunner" class="maze-runner" x="20" y="85">${runner}</text>
      </svg>
    </div>`;
      }
      // A hand-drawn car instead of the 🚗 emoji — emoji "automobile" glyphs
      // face left in every major vendor set, and mirroring one with CSS looks
      // slightly off (reversed shading/details). Drawing it ourselves means
      // it's simply built facing right, with spinning wheels for extra life.
      return `
    <div class="track track-race">
      <div class="track-road"><i class="track-fill" id="uiTrackFill"></i></div>
      <div class="track-goal">${goal}</div>
      <div class="track-runner" id="uiRunner">
        <span class="runner-icon">
          <svg viewBox="0 0 64 34" class="car-svg" aria-hidden="true">
            <ellipse class="car-shadow" cx="34" cy="30" rx="26" ry="3"></ellipse>
            <rect class="speedline" x="-4" y="10" width="9" height="2.5" rx="1.2"></rect>
            <rect class="speedline" x="-8" y="17" width="11" height="2.5" rx="1.2" style="animation-delay:.2s"></rect>
            <rect class="speedline" x="-4" y="24" width="7" height="2.5" rx="1.2" style="animation-delay:.4s"></rect>
            <path class="car-body" d="M6,26 L6,18 Q6,14 10,14 L18,14 L24,5 L38,5 L46,13 L54,13 Q60,13 60,19 L60,26 Z"></path>
            <rect class="car-spoiler" x="3" y="10" width="10" height="3" rx="1"></rect>
            <polygon class="car-glass" points="23,13 27,7 37,7 42,13"></polygon>
            <rect class="car-stripe" x="30" y="5" width="5" height="21"></rect>
            <g class="wheel">
              <circle cx="18" cy="27" r="6"></circle>
              <rect x="17" y="21" width="2" height="4"></rect>
            </g>
            <g class="wheel">
              <circle cx="48" cy="27" r="6"></circle>
              <rect x="47" y="21" width="2" height="4"></rect>
            </g>
          </svg>
        </span>
      </div>
    </div>`;
    }

    // Dust puffs the car drops behind it on every step forward.
    function spawnDust(leftPct){
      var track = document.querySelector(".track-race");
      if(!track) return;
      var d = document.createElement("span");
      d.className = "dust";
      d.textContent = "💨";
      d.style.left = leftPct + "%";
      track.appendChild(d);
      setTimeout(function(){ d.remove(); }, 550);
    }

    function update(pct){
      if(isMaze){
        // mazeTrail shares the maze-path's "d", so its length doubles as the
        // guide path's length — one <path> query covers both.
        var path = document.getElementById("mazeTrail"),
            mover = document.getElementById("mazeRunner");
        if(!path || !mover) return;
        if(mazeLen === null){ mazeLen = path.getTotalLength(); path.style.strokeDasharray = mazeLen; }
        var covered = pct/100 * mazeLen;
        var pt = path.getPointAtLength(covered);
        mover.setAttribute("x", pt.x);
        mover.setAttribute("y", pt.y);
        path.style.strokeDashoffset = mazeLen - covered;
      } else {
        var r = document.getElementById("uiRunner"), fill = document.getElementById("uiTrackFill");
        // The car stops short of the flag until the round is actually over,
        // so it never looks finished while there are words left.
        var shown = Math.min(pct, 94);
        if(lastPct !== null && pct > lastPct) spawnDust(Math.min(lastPct, 94));
        if(r) r.style.left = shown + "%";
        if(fill) fill.style.width = Math.min(pct, 100) + "%";
      }
      lastPct = pct;
    }

    // A little flourish on every 5-streak milestone — the same "boost" class
    // works for both themes, since each one's CSS defines its own keyframes.
    function celebrate(){
      var el;
      if(isMaze) el = document.getElementById("mazeRunner");
      else {
        var wrap = document.getElementById("uiRunner");
        el = wrap && wrap.querySelector(".runner-icon");
      }
      if(!el) return;
      el.classList.remove("boost");
      void el.getBoundingClientRect();   // restart the animation
      el.classList.add("boost");
      setTimeout(function(){ el.classList.remove("boost"); }, 550);
    }

    // Back to the start line, so a replayed round doesn't inherit the last
    // one's dust trail.
    function reset(){ lastPct = null; }

    return { markup: markup, update: update, celebrate: celebrate, reset: reset };
  }

  /* ---------------- style injection ----------------
     An engine's own CSS ships inside it rather than as another stylesheet,
     so a game page stays two <link>s however many engines exist, and so an
     engine can never be loaded without its styles. */
  function injectStyle(id, css){
    if(document.getElementById(id)) return;
    var el = document.createElement("style");
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }

  return {
    comboMultiplier: comboMultiplier,
    pointsFor: pointsFor,
    starsFor: starsFor,
    renderStars: renderStars,

    shuffled: shuffled,
    dedupeWords: dedupeWords,
    sampleWords: sampleWords,
    escapeHtml: escapeHtml,

    chunkSep: CHUNK_SEP,
    parseEntry: parseEntry,
    chunkMarkup: chunkMarkup,
    heartMarkup: heartMarkup,
    spellOut: spellOut,

    phonemeSpans: phonemeSpans,
    phonemes: phonemes,
    isVowelPhone: isVowelPhone,
    phoneticDistance: phoneticDistance,
    normalize: normalize,
    findPhonemeSeq: findPhonemeSeq,
    ACCEPT: ACCEPT,
    phoneticAlign: phoneticAlign,
    diagnose: diagnose,

    spokenText: spokenText,
    directionParts: directionParts,

    comebackCap: COMEBACK_CAP,
    sanitizeComeback: sanitizeComeback,
    comebackMerge: comebackMerge,
    comebackMastered: comebackMastered,
    comebackDeck: comebackDeck,
    comebackStore: comebackStore,

    voice: currentVoice,
    sounds: sounds,
    confettiBurst: confettiBurst,
    popup: popup,
    progress: progress,
    injectStyle: injectStyle
  };
})();
