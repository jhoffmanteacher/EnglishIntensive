#!/usr/bin/env node
/* listen-loop.mjs — closed loop: how often does the site mark a right read wrong, or a wrong read right? (2026-11-25)

     node tools/listen-loop.mjs [options]

   THE QUESTION. For each listening mode and list: how often does the site mark a correct read wrong (a FALSE REJECT) and
   a wrong read right (a FALSE ACCEPT) — and does a change to a listening rule make either number better or worse?

   WHEN TO RUN IT. After any change to how a game LISTENS: blend-game.js's onresult, isMatch / isMatchCore and the quiet-
   read rule; listen.js; card-game.js's judgeHeard; fluency-game.js's heardResult / consume; blend-it-game.js's onresult;
   game-core.js's normalize, phonemes, phoneticDistance, ACCEPT, isNonAnswer, stripNoise, soundsLike, spokenMatch,
   resultGate; word-lists.js's homophones, soundalikes, phonetic / join switches. A listening rule changes only with a
   before / after from this loop (--json, then --against), on takes when there are any. About 30-60 s; needs Node 22 and
   a Chrome binary (CHROME=..., default google-chrome), no other dependency, no network.

   TWO SOURCES OF EVENT STREAMS.
     TAKES     the teacher's own reads, recorded on mic-takes.html: real Chrome recogniser output, every event with its
               time. Files given with --takes=FILE[,FILE], else every *.json in tools/mic-takes/. Each item is replayed
               with its original timing; its answer key is the script it was read from (right / wrong / noise).
               THESE ARE MEASUREMENTS — of one adult voice in one room on one machine, but measurements.
     VIRTUAL   a virtual reader and a RECOGNISER MODEL (below), for when there are no takes yet and for coverage. Every
               behaviour of the model is copied from a README passage or a boot-check case, cited beside it. THE MODEL IS
               A STAND-IN: its numbers show what the engines' LOGIC does under the model's stated assumptions. Only
               numbers from takes are measurements. The output says so above and below every virtual table.

   WHAT IS REAL. word-lists.js, game-core.js, listen.js and the four engines that listen — blend-game.js (Say It),
   card-game.js + listen.js (the cards' Listen), fluency-game.js (One minute), blend-it-game.js (Blend It) — unmodified,
   in headless Chrome, one fresh iframe per case (tools/listen-case.html; one engine per document, the boot-check
   rule), started with the cfg practice.js builds (the list's config, words, allWords) and driven through their own
   buttons. A verdict is read off what the ENGINE DID, never by calling a matcher: Say It and Blend It — the word card
   turning correct or wrong, and the "say it one more time, a little louder" line (asked again); the cards — which
   rating button the flip pulses; One minute — the per-word result it reports when a final lands.
   WHAT IS FAKE (tools/listen-fake.js; self-tested at the start of every run, checks F1-F10): the clock (virtual; the
   earliest timer fires, then every promise settles), SpeechRecognition (replays the streams: one session per start(),
   results keep their slots for the session, finals frozen, at most maxAlternatives alternatives, interims dropped when
   interimResults is false, a non-continuous session ends after its first final, an event with no live session is
   DROPPED), speechSynthesis / Audio / AudioContext / getUserMedia (silent stand-ins with durations), Math.random
   (seeded). Voice is off, Shuffle off, Listen on, as a student would leave them.
   Say It plays ROUNDS of up to four items of one list, so one session spans words and a late final can land on the
   next word (README "A late result stays with its own word"); an item nobody got right is Skipped 2.5 s after its last
   event (the student gives up). The other modes play one item per case.

   THE ANSWER KEY is the script: `right` (the word read as written), `wrong` (a specific misreading, made by rule from
   the list's data — tools/wrong-readings.js, shared with the recorder), `noise` (nothing, a cough, "um", "I don't
   know"). Verdicts: accept, reject, again (asked again, no try lost), none (nothing happened).
     right  accept = right; reject = FALSE REJECT; again / none = not counted as either (shown).
     wrong  reject = caught; accept = FALSE ACCEPT; again / none = shown.
     noise  none / again = right; accept = FALSE ACCEPT; reject = "charged" (a try lost to noise; shown, not FR).
   Each error is printed with the target, what was said, the stream's key lines, what the engine did and a replay
   command. For TAKES, every false reject also says whether the target was in a lower-ranked alternative or in an
   interim — the evidence for or against Say It's "top guess only" rule and its scoring on interims.

   CANDIDATE RULES (--rule=NAME, `--list` prints them with what each trades). The engine's own source with a few lines
   rewritten IN MEMORY in the case frame — no site file is edited; each rewrite must match exactly once, or the case
   stops with "the line to rewrite was found N times". They change Say It only. `same` rewrites one line into itself
   and must reproduce the base run exactly (the proof that the rewriting path is neutral).

   FLAGS (each --name=value; an unknown or repeated flag, or a bad value, is exit 2 before anything runs)
     --seed=S           the virtual reader's seed (default 1); same seed + same takes = same stdout byte for byte
     --cases=N          only the first N cases (of the full, unfiltered order)
     --case=ID          only case ID (with --verbose: every stream event, every delivery, every engine action)
     --mode=a,b         say, cards, fluency, blendit
     --family=a,b       blends-start, blends-end, nonsense, oi-oy, multi, red
     --list=ID[,ID]     list ids (any mode's id of the list; matched by family and list number)
     --source=all       all (default), virtual or takes
     --takes=FILE[,F]   takes files (default: tools/mic-takes/*.json)
     --rule=NAME        a candidate rule (names: `--list`)
     --root=DIR         load the site from another folder (a fix, or a scratch copy with a planted fault); the reader,
                        the model and the fake always come from this checkout
     --fake-fault=NAME  break the FAKE on purpose (names: `--list`); the self-test and the run must go red
     --json=FILE        every item's verdict (for --against)
     --against=FILE     an earlier --json of the same command: rank every verdict that moved, by the answer key
     --measure          write this run's virtual counts as the new pinned baseline (tools/listen-loop-pinned.json);
                        only on the default command (no filter, rule, fault or --root). Re-pin ON PURPOSE, with the
                        before/after in the commit message.
     --verbose          the whole timeline of each case run
     --list             modes, families, lists, rules, fake faults
   PORT=8051 (default) is the port of the tool's own static server; CHROME the browser binary.

   EXIT 0 = the run completed and every pinned expectation held (with --against: nothing moved); 1 = a pinned count
   moved, the fake failed its self-test, or (--against) a verdict moved; 2 = bad arguments, not the same command
   (--against), or a crash; 3 = watchdog (no batch of cases finished for 120 real seconds). stdout is deterministic;
   the run time goes to stderr.

   THE PIN. tools/listen-loop-pinned.json holds the default virtual run's per-mode, per-family counts. A change to a
   listening rule that moves any of them turns this red (and CI with it) until it is re-pinned with --measure, on
   purpose. Takes are not pinned: they are the measurement a change is judged by, with --against.
*/

import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PIN_FILE = path.join(HERE, "listen-loop-pinned.json");
const TAKES_DIR = path.join(HERE, "mic-takes");
const MODEL_VERSION = "vr-1";
const MODES = ["say", "cards", "fluency", "blendit"];
const FAMILIES = ["blends-start", "blends-end", "nonsense", "oi-oy", "multi", "red"];
const FAKE_FAULTS = {
  "drop-finals": "the fake never delivers a final result (interims only)",
  "no-trunc": "the fake ignores maxAlternatives and hands every engine the whole n-best list",
  "renumber": "the fake reports resultIndex 0 on every event"
};
const ROUND = 4;          // Say It: items per round
const BATCH = 40;         // cases per call into the page

/* ════════════════════════ candidate rules ════════════════════════
   Each is blend-game.js with a few lines rewritten in memory (the case frame fetches the file, applies these, runs it
   inline). Only Say It changes; every other mode is untouched by every rule. */
const R_MATCH = "          if(isMatch(alt.transcript, target)){";
const RULES = {
  same: {
    trades: "nothing: one line rewritten into itself. Must give the base run's verdicts exactly (the harness proof).",
    edits: { "blend-game.js": [["          var alt = res[0];", "          var alt = res[0];"]] }
  },
  "final-only": {
    trades: "Say It scores only on a FINAL result, never an interim. An interim that passes through the target on the " +
            "way to a different final can no longer be marked right (fewer false accepts); a right read waits for the " +
            "final, and one whose final comes back as something else is now a miss (more false rejects), as is one " +
            "whose final arrives after the next word is up (the late-final gate then drops it).",
    edits: { "blend-game.js": [[R_MATCH, "          if(res.isFinal && isMatch(alt.transcript, target)){"]] }
  },
  "stable-interim": {
    trades: "an interim match counts only if the NEXT result event still matches (or the final confirms it). Cuts " +
            "false accepts from a single passing interim; costs a little speed, and a right read whose final differs " +
            "and that had only one matching interim becomes a miss.",
    edits: { "blend-game.js": [
      ["var quietReads = 0, quietIdx = -1;", "var quietReads = 0, quietIdx = -1, __si = -1;"],
      ["        var target = queue[idx], lastFinal = null, unsure = false;",
       "        var target = queue[idx], lastFinal = null, unsure = false;\n        var __prev = __si; __si = -1;"],
      [R_MATCH, "          if(isMatch(alt.transcript, target) && (res.isFinal || __prev === r || (__si = r, false))){"]
    ] }
  },
  nbest: {
    trades: "asks Chrome for 5 alternatives and counts a match in ANY of them — the opposite of today's top-guess-only " +
            "rule. Expected to cut false rejects (the right word was second) and raise false accepts (Chrome's language " +
            "model puts a common word in the list whether or not it was said: \"mill\" said, \"milk\" second).",
    edits: { "blend-game.js": [
      ["rec.continuous = true;", "rec.continuous = true;\n      rec.maxAlternatives = 5;"],
      ["          var alt = res[0];",
       "          var alt = res[0];\n          for(var __a = 1; __a < res.length; __a++){ if(!isMatch(alt.transcript, target) && isMatch(res[__a].transcript, target)) alt = res[__a]; }"]
    ] }
  },
  "conf-low": {
    trades: "the quiet-read threshold moved from 0.35 to 0.2: fewer right reads asked again; a filled-in guess at " +
            "0.2-0.35 is now taken as right.",
    edits: { "blend-game.js": [["alt.confidence < 0.35", "alt.confidence < 0.2"]] }
  },
  "conf-high": {
    trades: "the quiet-read threshold moved from 0.35 to 0.5: more right reads asked again (slower, never a lost try); " +
            "a filled-in guess up to 0.5 needs saying twice.",
    edits: { "blend-game.js": [["alt.confidence < 0.35", "alt.confidence < 0.5"]] }
  },
  "no-quiet-rule": {
    trades: "no confidence rule at all: the right word at any confidence is right at once. Fastest; any filled-in " +
            "guess of the target counts.",
    edits: { "blend-game.js": [["if(alt.confidence > 0 && alt.confidence < 0.35){", "if(false){"]] }
  }
};

/* ════════════════════════ arguments ════════════════════════ */
function fail2(msg){ process.stderr.write("listen-loop: " + msg + "\n"); process.exit(2); }
const KNOWN = ["seed", "cases", "case", "mode", "family", "list", "source", "takes", "rule", "root", "fake-fault", "json",
               "against", "measure", "verbose"];
const opt = {};
let listFlag = false;
for(const a of process.argv.slice(2)){
  if(a === "--list" || a === "list"){ listFlag = true; continue; }
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if(!m) fail2("not an option: " + a + " (every option is one --name=value argument)");
  if(!KNOWN.includes(m[1])) fail2("unknown option --" + m[1]);
  if(m[1] in opt) fail2("--" + m[1] + " given twice");
  if((m[1] === "measure" || m[1] === "verbose") && m[2] !== undefined) fail2("--" + m[1] + " takes no value");
  if(m[1] !== "measure" && m[1] !== "verbose" && (m[2] === undefined || m[2] === "")) fail2("--" + m[1] + " needs a value");
  opt[m[1]] = m[2] === undefined ? true : m[2];
}
function intOpt(k, d){
  if(!(k in opt)) return d;
  if(!/^\d+$/.test(opt[k])) fail2("--" + k + " must be a whole number");
  return parseInt(opt[k], 10);
}
const SEED = intOpt("seed", 1);
const CASES = intOpt("cases", 0);
const ONLY_CASE = intOpt("case", 0);
const csv = (k) => (k in opt ? String(opt[k]).split(",").filter(Boolean) : null);
const F_MODE = csv("mode"), F_FAMILY = csv("family"), F_LIST = csv("list");
for(const m of F_MODE || []) if(!MODES.includes(m)) fail2("no mode " + m + " (modes: " + MODES.join(", ") + ")");
for(const f of F_FAMILY || []) if(!FAMILIES.includes(f)) fail2("no family " + f + " (families: " + FAMILIES.join(", ") + ")");
const SOURCE = opt.source || "all";
if(!["all", "virtual", "takes"].includes(SOURCE)) fail2("--source is all, virtual or takes");
const RULE = opt.rule || null;
if(RULE && !RULES[RULE]) fail2("no rule " + RULE + " (rules: " + Object.keys(RULES).join(", ") + ")");
const FAULT = opt["fake-fault"] || null;
if(FAULT && !FAKE_FAULTS[FAULT]) fail2("no fake fault " + FAULT + " (faults: " + Object.keys(FAKE_FAULTS).join(", ") + ")");
const ROOT = opt.root ? path.resolve(opt.root) : REPO;
if(!fs.existsSync(path.join(ROOT, "blend-game.js"))) fail2("--root " + ROOT + " has no blend-game.js");
const VERBOSE = !!opt.verbose;
const PORT = parseInt(process.env.PORT || "8051", 10);
const CHROME = process.env.CHROME || "google-chrome";
const FILTERED = !!(F_MODE || F_FAMILY || F_LIST || CASES || ONLY_CASE);
// The pin is checked on the default command, and also with --root (a fix or a planted fault must face the pin) and
// with --fake-fault (a broken fake must turn it red too). A rule is judged with --against, not by the pin.
const PIN_CMD = !FILTERED && !RULE && SOURCE !== "takes";
if(opt.measure && !(PIN_CMD && !FAULT && !opt.root)) fail2("--measure only on the default command (no filter, rule, fault, --root or --source=takes)");
if(opt.against && opt.json && path.resolve(opt.against) === path.resolve(opt.json)) fail2("--against and --json name the same file");
let AGAINST = null;
if(opt.against){
  try{ AGAINST = JSON.parse(fs.readFileSync(opt.against, "utf8")); }catch(e){ fail2("--against: cannot read " + opt.against + ": " + e.message); }
  if(!AGAINST || AGAINST.tool !== "listen-loop" || !Array.isArray(AGAINST.items)) fail2("--against: " + opt.against + " is not a --json of this tool");
}

/* ════════════════════════ the site's data, for the reader ════════════════════════
   The reader and its model load word-lists.js, game-core.js and wrong-readings.js from THIS checkout, never from
   --root: a planted fault in the site under test must move the verdicts, not the reads. */
function loadData(){
  const doc = { readyState: "complete", documentElement: { classList: { add(){}, remove(){}, toggle(){} } },
    addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; },
    createElement(){ return { style: {} }; }, head: { appendChild(){} } };
  const win = { document: doc, addEventListener(){}, navigator: {}, location: { hostname: "x", search: "" },
    localStorage: { getItem(){ return null; }, setItem(){} } };
  win.window = win;
  const ctx = vm.createContext(win);
  for(const f of ["word-lists.js", "game-core.js", "tools/wrong-readings.js"]){
    vm.runInContext(fs.readFileSync(path.join(REPO, f), "utf8"), ctx, { filename: f });
  }
  return { L: ctx.WordLists, G: ctx.GameCore, W: ctx.WrongReadings, FAM: ctx.LIST_FAMILIES };
}
const D = loadData();

// Every (family, list number) -> { mode: listId } for the modes that listen, retired modes left out.
const LISTEN_MODES = { say: "say", cards: "cards", fluency: "fluency", blendit: "blendit" };
function idsByList(){
  const out = {};
  for(const l of D.L.all){
    if(l.retired || !LISTEN_MODES[l.mode]) continue;
    const k = l.family + "#" + l.listNum;
    (out[k] = out[k] || { family: l.family, listNum: l.listNum, ids: {} }).ids[l.mode] = l.id;
  }
  return out;
}
const LISTS = idsByList();
function listKeyOf(id){ const l = D.L.byId(id); return l ? l.family + "#" + l.listNum : null; }

if(listFlag){
  console.log("modes:     " + MODES.join(", "));
  console.log("families:  " + FAMILIES.join(", "));
  console.log("lists (family#n: the ids of the modes that listen):");
  for(const k of Object.keys(LISTS)) console.log("  " + k.padEnd(16) + Object.entries(LISTS[k].ids).map(([m, id]) => m + "=" + id).join("  "));
  console.log("rules (--rule=):");
  for(const [k, r] of Object.entries(RULES)) console.log("  " + k.padEnd(15) + r.trades);
  console.log("fake faults (--fake-fault=):");
  for(const [k, v] of Object.entries(FAKE_FAULTS)) console.log("  " + k.padEnd(15) + v);
  process.exit(0);
}

/* ════════════════════════ seeded randomness ════════════════════════ */
function hash(str){ let h = 2166136261 >>> 0; for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function rng(seedStr){
  let s = hash(seedStr) || 1;
  const f = () => { s = (s + 0x6D2B79F5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = (a, b) => a + Math.floor(f() * (b - a + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

/* ════════════════════════ the recogniser model (VIRTUAL source only) ════════════════════════
   A stand-in for Chrome's recogniser. Every behaviour cites where the README or tools/boot-check.html says Chrome does
   it; every number is an ASSUMPTION until takes exist (the takes then show the real rates). */
const MODEL = {
  onsetMs: [500, 1400],     // reading latency after the word appears. Assumption.
  interimGapMs: [250, 400], // between interims. Assumption.
  finalAfterMs: [350, 800], // last interim -> final. Assumption.
  finalConf: [0.70, 0.96],  // a clean final. Assumption.
  interimConf: 0,           // ASSUMPTION: interims carry confidence 0 (the quiet rule's "confidence > 0" guard implies it).
  // README "Listening: two things every mic mode shares" — "Chrome then sends its final version of the same speech,
  // sometimes after the next word is up" (boot-check say-late).
  lateFinal: { p: 0.15, afterMs: [1300, 2000] },
  // README "Following a reader" — "an interim is a guess Chrome keeps revising: 'cost' becomes 'cast' a beat later"
  // (boot-check fluency-revision).
  revision: 0.25,
  // A wrong read whose interim passes through the target on the way to a different final — README "Following a
  // reader" (revision, as above) plus "How the listening works": Say It "scores on an interim guess so a right
  // answer lands quickly". The interim-revision behaviour pointed the other way.
  passThrough: 0.15,
  // README "How the listening works" — "the right word heard faintly ... a quiet read is where the recogniser fills
  // in a likely word" (boot-check say-quiet).
  quiet: { p: 0.08, conf: [0.12, 0.34] },
  // README "Say It for the red words" — Homophones ("to" / "two") and Sound-alikes ("know" comes back "no").
  homophone: 0.35,
  // README "Contractions" — "'they'd' said aloud is 'they would', and the recogniser writes down whichever it likes".
  contraction: 0.4,
  // README "The closed loop" (join) — "Chrome returns upset as 'up set' and hubcap as 'hub cap' when it likes"
  // (boot-check say-join). Only two-part words whose parts are both real words.
  split: 0.25,
  // README "How the listening works" — nonsense: "it returns the nearest real word — 'verb'".
  nonsenseNearest: 0.7,
  // README "ACCEPT is the other exception" — "tent comes back as 'tenth'" (boot-check say-accept).
  accept: 0.2,
  // README ACCEPT paragraph — "the student said the word correctly and the microphone wrote something else"; and
  // "If a student's correct answers keep getting marked wrong...". A right read heard as a neighbouring real word.
  mishear: 0.04,
  // A wrong read that is not a real word comes back as the nearest real word (the nonsense passage, above).
  wrongNearest: 0.6,
  // A red word's vowel read short sounds different but is spelled the same: the recogniser snaps to the real word
  // (the nonsense passage again: it returns the nearest real word).
  redSnap: 0.5,
  // blend-game.js onresult comment — "a lower-ranked alternative frequently contains the target word even when it
  // wasn't actually said (e.g. 'mill' said, but 'milk' shows up further down the list)".
  nbestTarget: 0.35,
  // README "isNonAnswer" paragraph — "a cough rendered as 'uh'".
  coughHeard: 0.5,
  // The reader. Assumption: mostly right, as a practising student is.
  kinds: { right: 0.55, wrong: 0.35, noise: 0.10 }
};
// The contraction expansions Chrome writes (README "Contractions"; the same pairs game-core.js folds back).
const EXPANDS = { "they'd": "they would", "you'd": "you would", "we're": "we are", "they're": "they are",
  "you're": "you are", "aren't": "are not", "weren't": "were not", "haven't": "have not", "they'll": "they will",
  "they've": "they have" };
// Real words a recogniser can return: every real-word list, plus common short words (the nearest-real-word pool).
const COMMON = ("bad bag ban bat bed beg bet big bin bit bob bog bop bud bug bun bus but cab can cap cat cob cod cog " +
  "cop cot cub cud cup cut dab dad dam den dig dim din dip dog dot dub dug fab fad fan fat fed fib fig fin fit fix fob " +
  "fog fox fun fur gab gag gal gap gas get gig gin god got gum gun gut had hag ham has hat hem hen hid him hip his hit " +
  "hog hop hot hub hug hum hut jab jam jet jig job jog jot jug jut keg kid kin kit lab lad lag lap led leg let lid lip " +
  "lit lob log lot lug mad man map mat men met mid mix mob mom mop mud mug mum nab nag nap net nib nit nod not nut pad " +
  "pal pan pat peg pen pep pet pig pin pit pod pop pot pub pug pun pup rag ram ran rap rat red rib rid rig rim rip rob " +
  "rod rot rub rug rum run rut sad sag sap sat set sin sip sit sob sod sub sum sun tab tag tan tap ten tin tip top tot " +
  "tub tug van vat vet wag wax web wed wet wig win wit yak yam yap yes yet zap zip verb herb curb love sock rock lock " +
  "luck duck neck deck pick sick tick lick kick back pack sack tack rack beck peck hook book look cook took club clap " +
  "crap slab slap clip grip trap tram drip drop flop stop step stem spin skin snap scab scan crib crop crib flag flat " +
  "glum plug plus slum slim slip slit spit spot slot trot trim brim grim prim swim gram pram cram clam glad brag drag " +
  "snag stag swag fled sled bled bred shed slid lift gift sift rift loft soft golf gulf hunk honk bunk junk sunk pond " +
  "fond bond vest nest best rest test west tent rent bent dent sent kelp help yelp held melt belt felt pelt dusk tusk " +
  "husk risk disk desk mask task lump bump dump hump jump damp camp lamp ramp sand band hand land pant rant want sank " +
  "bank tank rank gasp clasp raft daft wisp lisp mink link pink sink wink kilt silt silk milk mill hilt tilt cost lost " +
  "most post host coin con cone join john moist must noise nose soil sole boy bay toy joy coy").split(" ");
const REAL = new Set(COMMON);
for(const l of D.L.all) if(l.family !== "nonsense") for(const w of D.L.wordsOf(l.id)) REAL.add(D.G.normalize(w));
const REAL_LIST = [...REAL].filter(Boolean).sort();
const SOUNDS = new Map();
function snd(w){ if(!SOUNDS.has(w)) SOUNDS.set(w, D.G.expandPhonemes(D.G.phonemes(w))); return SOUNDS.get(w); }
const NEAR = new Map();
// Real words within one sound of w (not w), nearest first, ties alphabetical. Single words only.
function nearReal(w){
  w = D.G.normalize(w);
  if(!w || w.includes(" ")) return [];
  if(NEAR.has(w)) return NEAR.get(w);
  const mine = snd(w);
  const out = REAL_LIST.filter((x) => x !== w && !x.includes(" ") && Math.abs(x.length - w.length) <= 2)
    .map((x) => ({ x, d: D.G.phoneticDistance(snd(x), mine) })).filter((o) => o.d <= 1)
    .sort((a, b) => a.d - b.d || (a.x < b.x ? -1 : a.x > b.x ? 1 : 0)).map((o) => o.x);
  NEAR.set(w, out);
  return out;
}
const range = (r, a) => r.int(a[0], a[1]);
const conf = (r, a) => Math.round((a[0] + r() * (a[1] - a[0])) * 100) / 100;

// A two-part word whose parts are both real words ("up·set", "hub·cap") — the kind the README says Chrome splits.
function splitsInto(entry){
  const parts = String(entry || "").split("·");
  return parts.length === 2 && REAL.has(parts[0]) && REAL.has(parts[1]) ? parts.join(" ") : null;
}

// What the recogniser writes for one read: { text, alts, quiet, why }.
function hearIt(r, item, cfg){
  const target = D.G.normalize(item.target), why = [];
  let text;
  if(item.kind === "noise"){
    const n = D.W.NOISE.find((x) => x.key === item.noise);
    text = n.key === "cough" ? (r.chance(MODEL.coughHeard) ? "uh" : "") : n.heard;
    if(text) why.push("noise:" + n.key);
  } else if(item.kind === "right"){
    text = target;
    const homs = [];
    if(cfg.homophones){ for(const g of cfg.homophones) if(g.map((x) => D.G.normalize(x)).includes(target)) for(const x of g) if(D.G.normalize(x) !== target) homs.push(D.G.normalize(x)); }
    if(cfg.soundalikes && cfg.soundalikes[target]) for(const x of cfg.soundalikes[target]) homs.push(x);
    const acc = D.G.ACCEPT[target] || [];
    if(item.family === "nonsense"){
      const nr = nearReal(target);
      if(nr.length && r.chance(MODEL.nonsenseNearest)){ text = r.pick(nr.slice(0, 4)); why.push("nearest-real-word"); }
    } else if(homs.length && r.chance(MODEL.homophone)){ text = r.pick(homs); why.push("homophone-spelling"); }
    else if(EXPANDS[target] && r.chance(MODEL.contraction)){ text = EXPANDS[target]; why.push("contraction-expanded"); }
    else if(item.family === "multi" && splitsInto(item.entry) && r.chance(MODEL.split)){
      text = splitsInto(item.entry); why.push("compound-split");
    } else if(acc.length && r.chance(MODEL.accept)){ text = r.pick(acc); why.push("accept-table-mishearing"); }
    else if(r.chance(MODEL.mishear)){
      const nr = nearReal(target).filter((x) => !homs.includes(x));
      if(nr.length){ text = nr[0]; why.push("misheard-as-neighbour"); }
    }
  } else {
    const o = item.wrongOpt;
    if(o.heard === ""){
      if(r.chance(MODEL.redSnap)){ text = target; why.push("snapped-to-the-real-word"); }
      else { const nr = nearReal(target); text = nr.length ? nr[0] : target; why.push(nr.length ? "nearest-real-word" : "snapped-to-the-real-word"); }
    } else {
      text = D.G.normalize(o.heard);
      if(!text.includes(" ") && !REAL.has(text) && r.chance(MODEL.wrongNearest)){
        const nr = nearReal(text);
        if(nr.length){ text = r.pick(nr.slice(0, 3)); why.push("nearest-real-word"); }
      }
    }
  }
  // The n-best list: the top guess, then real neighbours; on a wrong read the target sometimes sneaks in.
  const alts = [text];
  if(text){
    const nb = nearReal(text).filter((x) => x !== text);
    for(const x of nb){ if(alts.length >= 5) break; alts.push(x); }
    const real = REAL.has(target) || item.family === "nonsense";
    if(item.kind !== "noise" && text !== target && real && r.chance(MODEL.nbestTarget)){
      const at = Math.min(alts.length, r.int(1, 2));
      if(!alts.includes(target)) alts.splice(at, 0, target);
      alts.length = Math.min(alts.length, 5);
      why.push("target-in-nbest");
    }
  }
  const quiet = item.kind === "right" && text === target && r.chance(MODEL.quiet.p);
  if(quiet) why.push("quiet-read");
  return { text, alts, quiet, why };
}

// The event stream for one read, timed from the word appearing.
function streamFor(r, item, cfg){
  const h = hearIt(r, item, cfg);
  item.heardModel = h.text; item.why = h.why;
  if(!h.text) return [];
  const ev = [], toks = h.text.split(" ");
  let t = range(r, MODEL.onsetMs);
  const res = (txt, fin, c, alts) => ({ isFinal: fin, alts: (alts || [txt]).map((a, i) => ({ transcript: a, confidence: i === 0 ? c : Math.round(c * (0.6 - i * 0.1) * 100) / 100 })) });
  const push = (txt, fin, c, alts) => { ev.push({ t, type: "result", resultIndex: 0, results: [res(txt, fin, c, alts)] }); };
  const target = D.G.normalize(item.target);
  if(toks.length > 1){
    for(let k = 1; k < toks.length; k++){ push(toks.slice(0, k).join(" "), false, MODEL.interimConf); t += range(r, MODEL.interimGapMs); }
  } else {
    if(item.kind === "wrong" && h.text !== target && r.chance(MODEL.passThrough)){
      push(target, false, MODEL.interimConf); t += range(r, MODEL.interimGapMs); item.why.push("interim-passes-target");
    } else if(r.chance(MODEL.revision)){
      const nr = nearReal(h.text).filter((x) => x !== target);
      if(nr.length){ push(r.pick(nr.slice(0, 3)), false, MODEL.interimConf); t += range(r, MODEL.interimGapMs); item.why.push("interim-revised"); }
    }
  }
  push(h.text, false, MODEL.interimConf);
  const late = r.chance(MODEL.lateFinal.p);
  t += late ? range(r, MODEL.lateFinal.afterMs) : range(r, MODEL.finalAfterMs);
  if(late) item.why.push("late-final");
  push(h.text, true, h.quiet ? conf(r, MODEL.quiet.conf) : conf(r, MODEL.finalConf), h.alts);
  return ev;
}

/* ════════════════════════ directed reads ════════════════════════
   Fixed reads every run includes, whatever the seed: the cases the README and tools/boot-check.html name, so a change
   to the rule each one pins moves a verdict even when the seeded reader never happened to make that read. Each is
   replayed into every listening mode its list has. Streams: `i` = interims before the final, `late` = the final comes
   1500 ms after the last interim, `conf` = the final's confidence, `only` = a final with no interim at all. */
const DIRECTED = [
  // README "isNonAnswer": "'what' is deliberately excluded, since a student reading put as what has misread it".
  { name: "put-as-what", list: "red-1-say", target: "put", kind: "wrong", said: "what", heard: "what" },
  // boot-check say-red-island; README (join): closing up would forgive "is land" for island.
  { name: "island-as-is-land", list: "red-9-say", target: "island", kind: "wrong", said: "is land", heard: "is land", i: ["is"] },
  // boot-check say-red-alike: a sound-alike on no list, with a filler in front.
  { name: "know-heard-um-no", list: "red-10-say", target: "know", kind: "right", heard: "um no", i: ["um"] },
  // README "Contractions": they'd said aloud is "they would".
  { name: "theyd-expanded", list: "red-3-say", target: "they'd", kind: "right", heard: "they would", i: ["they"] },
  // README "Homophones": no listener separates to from two.
  { name: "to-heard-two", list: "red-1-say", target: "to", kind: "right", heard: "two" },
  // README "Which part went wrong" / the red words note: "sayed" is the sounded-out misreading of said.
  { name: "said-as-sayed", list: "red-1-say", target: "said", kind: "wrong", said: "sayed", heard: "sayed" },
  // boot-check say-accept: ACCEPT forgives "tenth" for tent.
  { name: "tent-heard-tenth", list: "final-blends", target: "tent", kind: "right", heard: "tenth" },
  // boot-check say-accept-not: "gas" for gasp is the dropped sound the list exists to catch.
  { name: "gasp-as-gas", list: "final-blends", target: "gasp", kind: "wrong", said: "gas", heard: "gas" },
  // boot-check say-join: Chrome writes upset as "up set".
  { name: "upset-split", list: "multisyllable", target: "upset", kind: "right", heard: "up set", i: ["up"] },
  // boot-check say-nonsense-twin: "sig" never passes for sug.
  { name: "sug-as-sig", list: "nonsense", target: "sug", kind: "wrong", said: "sig", heard: "sig" },
  // boot-check say-nonsense: "I give up" is not a reading of rup.
  { name: "rup-i-give-up", list: "nonsense", target: "rup", kind: "noise", said: "I give up", heard: "i give up", i: ["i", "i give"] },
  // boot-check say-quiet: the right word at low confidence, a final with no interim before it.
  { name: "crab-quiet", list: "initial-blends", target: "crab", kind: "right", heard: "crab", conf: 0.2, only: true },
  // boot-check say-noise: a filler is not an answer.
  { name: "grab-um", list: "initial-blends", target: "grab", kind: "noise", said: "um", heard: "um" },
  // README "Following a reader" (interims are revised) + Say It scores on an interim: an interim that passes through
  // the target on the way to the misreading's final.
  { name: "crab-as-crap-via-crab", list: "initial-blends", target: "crab", kind: "wrong", said: "crap", heard: "crap", i: ["crab"] },
  // boot-check say-late: an interim match, then the final of the same speech after the next word is up. A Say It
  // round of two: clam read right (late final), then grin read right.
  { name: "clam-late-final", list: "initial-blends", target: "clam", kind: "right", heard: "clam", late: true, next: { target: "grin", kind: "right", heard: "grin" } }
];
function directedStream(d){
  const ev = [];
  let t = 700;
  const R = (txt, fin, c) => ({ isFinal: fin, alts: [{ transcript: txt, confidence: c }] });
  if(!d.only){
    for(const x of d.i || []){ ev.push({ t, type: "result", resultIndex: 0, results: [R(x, false, 0)] }); t += 300; }
    ev.push({ t, type: "result", resultIndex: 0, results: [R(d.heard, false, 0)] });
    t += d.late ? 1500 : 500;
  }
  ev.push({ t, type: "result", resultIndex: 0, results: [R(d.heard, true, d.conf || 0.9)] });
  return ev;
}
function directedCases(){
  const out = [];
  for(const d of DIRECTED){
    const k = listKeyOf(d.list);
    for(const mode of MODES){
      const id = LISTS[k].ids[mode];
      if(!id) continue;
      const mk = (x) => ({ target: x.target, entry: entryOf(id, x.target), family: LISTS[k].family, kind: x.kind,
        said: x.said || x.target, events: directedStream(x), directed: d.name, why: ["directed:" + d.name] });
      const items = [mk(d)];
      if(d.next) items.push(mk(d.next));
      // Only Say It plays rounds; elsewhere each item is its own case.
      if(mode === "say") out.push({ source: "virtual", mode, listId: id, family: LISTS[k].family, items });
      else for(const it of items) out.push({ source: "virtual", mode, listId: id, family: LISTS[k].family, items: [it] });
    }
  }
  return out;
}

/* ════════════════════════ the cases ════════════════════════ */
function entryOf(listId, w){ return D.W.entryOf(listId, w); }
function cfgOf(listId){ const l = D.L.byId(listId); return l ? l.config : {}; }

function virtualCases(){
  const out = [];
  for(const mode of MODES){
    for(const k of Object.keys(LISTS)){
      const L = LISTS[k], id = L.ids[mode];
      if(!id) continue;
      const words = D.L.wordsOf(id), items = [];
      for(const w of words){
        const r = rng(`${SEED}|${mode}|${id}|${w}`);
        const x = r();
        const item = { target: w, entry: entryOf(id, w), family: L.family };
        const wrongs = D.W.options(LISTS[k].ids.say || id, w);
        if(x < MODEL.kinds.right || (x < MODEL.kinds.right + MODEL.kinds.wrong && !wrongs.length)) item.kind = "right";
        else if(x < MODEL.kinds.right + MODEL.kinds.wrong){
          item.kind = "wrong"; item.wrongOpt = r.pick(wrongs); item.said = item.wrongOpt.say;
          // README "How the listening works": on the nonsense list "what it still forgives is a wrong short vowel"
          // — a by-design acceptance, counted apart from the false accepts nobody meant.
          if(L.family === "nonsense" && item.wrongOpt.kind === "vowel") item.design = true;
        }
        else { item.kind = "noise"; item.noise = r.pick(D.W.NOISE).key; item.said = D.W.NOISE.find((n) => n.key === item.noise).say || "(nothing)"; }
        if(item.kind === "right") item.said = w;
        item.events = streamFor(r, item, cfgOf(id));
        items.push(item);
      }
      const per = mode === "say" ? ROUND : 1;
      for(let i = 0; i < items.length; i += per){
        out.push({ source: "virtual", mode, listId: id, family: L.family, items: items.slice(i, i + per) });
      }
    }
  }
  return out;
}

function takeFiles(){
  if(opt.takes) return opt.takes.split(",").filter(Boolean).map((f) => path.resolve(f));
  if(!fs.existsSync(TAKES_DIR)) return [];
  return fs.readdirSync(TAKES_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(TAKES_DIR, f));
}
function takeCases(){
  const out = [], notes = [];
  for(const file of takeFiles()){
    let T;
    try{ T = JSON.parse(fs.readFileSync(file, "utf8")); }catch(e){ fail2("takes: cannot read " + file + ": " + e.message); }
    if(!T || T.schema !== "ei-mic-takes/1" || !Array.isArray(T.items)) fail2("takes: " + file + " is not an ei-mic-takes/1 file");
    const name = path.basename(file);
    const k = listKeyOf(T.listId);
    if(!k || !LISTS[k]) { notes.push(name + ": list " + T.listId + " is not a list any listening mode plays; skipped"); continue; }
    const items = [];
    T.items.forEach((it, n) => {
      if(!["right", "wrong", "noise"].includes(it.script)) return;
      const events = (it.events || []).filter((e) => e.type === "result" || e.type === "error").map((e) => ({
        // A take's item can hold more than one recogniser session (Chrome ends one after a silence and the recorder
        // opens the next, as Say It does): each session's results are numbered from 0, so each is its own stream.
        t: Math.max(0, Math.round(e.t)), type: e.type, error: e.error, resultIndex: e.resultIndex | 0, stream: e.session | 0,
        results: (e.results || []).map((r) => ({ isFinal: !!r.isFinal, alts: (r.alts || []).map((a) => ({ transcript: String(a.transcript || ""), confidence: Number(a.confidence) || 0 })) }))
      }));
      items.push({ target: it.target, entry: entryOf(LISTS[k].ids.say || T.listId, it.target), family: LISTS[k].family,
        kind: it.script, said: it.asked && it.asked.say !== undefined ? it.asked.say : it.target, events,
        take: { file: name, n, variant: T.variant || "site" } });
    });
    for(const mode of MODES){
      const id = LISTS[k].ids[mode];
      if(!id) continue;
      const per = mode === "say" ? ROUND : 1;
      for(let i = 0; i < items.length; i += per){
        out.push({ source: "take", mode, listId: id, family: LISTS[k].family, variant: T.variant || "site",
          items: items.slice(i, i + per).map((x) => ({ ...x, entry: entryOf(id, x.target) })) });
      }
    }
  }
  return { cases: out, notes };
}

/* ════════════════════════ the browser ════════════════════════ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".woff": "font/woff" };
function serve(){
  const srv = http.createServer((q, s) => {
    let u;
    try{ u = decodeURIComponent(String(q.url).split("?")[0]); }catch(e){ s.writeHead(400); s.end(); return; }
    // The tool's own pages come from this checkout; the site from --root.
    const base = u.startsWith("/tools/listen-") ? REPO : ROOT;
    const f = path.join(base, path.normalize(u).replace(/^(\.\.[/\\])+/, ""));
    if(!f.startsWith(base)){ s.writeHead(403); s.end(); return; }
    fs.readFile(f, (e, d) => {
      if(e){ s.writeHead(404); s.end(); return; }
      s.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream", "cache-control": "max-age=3600" });
      s.end(d);
    });
  });
  return new Promise((res, rej) => { srv.on("error", rej); srv.listen(PORT, "127.0.0.1", () => res(srv)); });
}

async function browser(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ei-listen-loop-"));
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--remote-debugging-port=0", "--user-data-dir=" + dir, "about:blank"], { stdio: ["ignore", "ignore", "ignore"] });
  proc.on("error", (e) => { process.stderr.write("listen-loop: cannot start Chrome (" + CHROME + "): " + e.message + "\n"); process.exit(2); });
  let port = null;
  for(let i = 0; i < 200 && !port; i++){
    try{ port = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]; }catch(e){}
    if(!port) await new Promise((r) => setTimeout(r, 100));
  }
  if(!port) throw new Error("Chrome did not open its debugging port");
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("could not reach Chrome's page")); });
  let id = 0;
  const pend = new Map(), exceptions = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if(d.id && pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); }
    else if(d.method === "Runtime.exceptionThrown") exceptions.push(JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if(r.error) throw new Error(r.error.message);
    if(r.result.exceptionDetails) throw new Error("in the page: " + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
    return r.result.result.value;
  };
  await send("Runtime.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/tools/listen-loop.html` });
  for(let i = 0; i < 100; i++){
    let ok = false;
    try{ ok = await evaluate("!!window.__host"); }catch(e){}
    if(ok) break;
    await new Promise((r) => setTimeout(r, 100));
    if(i === 99) throw new Error("tools/listen-loop.html did not load");
  }
  const close = () => { try{ ws.close(); }catch(e){} try{ proc.kill("SIGKILL"); }catch(e){} try{ fs.rmSync(dir, { recursive: true, force: true }); }catch(e){} };
  return { evaluate, close, exceptions };
}

/* ════════════════════════ scoring ════════════════════════ */
const RANK = {
  right: { accept: 2, again: 1, none: 1, reject: 0 },
  wrong: { reject: 2, again: 1, none: 1, accept: 0 },
  noise: { none: 2, again: 2, reject: 1, accept: 0 }
};
function errorOf(kind, v){
  if(kind === "right" && v === "reject") return "FR";
  if((kind === "wrong" || kind === "noise") && v === "accept") return "FA";
  if(kind === "noise" && v === "reject") return "charged";
  return null;
}
const norm = (s) => D.G.normalize(s);
function inStream(item){
  // For a take's false reject: was the target in a lower-ranked alternative, or in an interim?
  const t = norm(item.target), has = (s) => { const n = norm(s); return n === t || n.split(" ").includes(t); };
  let lower = false, interim = false;
  for(const e of item.events) for(const r of e.results || []){
    (r.alts || []).forEach((a, i) => { if(i > 0 && has(a.transcript)) lower = true; });
    if(!r.isFinal && r.alts && r.alts[0] && has(r.alts[0].transcript)) interim = true;
  }
  return { lower, interim };
}
function keyLines(item){
  return item.events.map((e) => {
    if(e.type === "error") return `${e.t} error:${e.error}`;
    const r = e.results[e.results.length - 1] || { alts: [] };
    const a = r.alts[0] || { transcript: "", confidence: 0 };
    const more = r.alts.length > 1 ? " [" + r.alts.slice(1).map((x) => JSON.stringify(x.transcript)).join(" ") + "]" : "";
    return `${e.t} ${r.isFinal ? "F" : "i"} ${JSON.stringify(a.transcript)}${r.isFinal ? " " + a.confidence.toFixed(2) : ""}${more}`;
  }).join(" · ") || "(no events)";
}
function replayCmd(c){
  const parts = ["node tools/listen-loop.mjs"];
  if(c.source === "virtual") parts.push("--seed=" + SEED);
  if(opt.takes) parts.push("--takes=" + opt.takes);
  if(RULE) parts.push("--rule=" + RULE);
  if(opt.root) parts.push("--root=" + opt.root);
  if(FAULT) parts.push("--fake-fault=" + FAULT);
  parts.push("--case=" + c.id, "--verbose");
  return parts.join(" ");
}

function tally(rows){
  const t = {};
  for(const x of rows){
    const k = x.mode + "/" + x.family;
    const c = t[k] = t[k] || { right: { n: 0, accept: 0, reject: 0, again: 0, none: 0 }, wrong: { n: 0, accept: 0, reject: 0, again: 0, none: 0 }, noise: { n: 0, accept: 0, reject: 0, again: 0, none: 0 } };
    c[x.kind].n++; c[x.kind][x.verdict]++;
    if(x.item.design && x.verdict === "accept") c.design = (c.design || 0) + 1;
  }
  return t;
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + "%" : "-");
function printTable(rows, title){
  const t = tally(rows);
  console.log(title);
  console.log("  " + "mode/family".padEnd(22) + "false rejects".padEnd(24) + "false accepts".padEnd(34) + "right read: again/none".padEnd(25) + "wrong read: caught".padEnd(20) + "noise: charged");
  const keys = Object.keys(t).sort((a, b) => MODES.indexOf(a.split("/")[0]) - MODES.indexOf(b.split("/")[0]) || FAMILIES.indexOf(a.split("/")[1]) - FAMILIES.indexOf(b.split("/")[1]));
  const tot = { fr: 0, rn: 0, fa: 0, an: 0, design: 0 };
  for(const k of keys){
    const c = t[k];
    const fr = c.right.reject, rn = c.right.n, fa = c.wrong.accept + c.noise.accept, an = c.wrong.n + c.noise.n;
    tot.fr += fr; tot.rn += rn; tot.fa += fa; tot.an += an; tot.design += c.design || 0;
    console.log("  " + k.padEnd(22) + `${fr} of ${rn} (${pct(fr, rn)})`.padEnd(24) + `${fa} of ${an} (${pct(fa, an)})${c.design ? " " + c.design + " by design" : ""}`.padEnd(34) +
      `${c.right.again} / ${c.right.none}`.padEnd(25) + `${c.wrong.reject} of ${c.wrong.n}`.padEnd(20) + `${c.noise.reject} of ${c.noise.n}`);
  }
  console.log("  " + "all".padEnd(22) + `${tot.fr} of ${tot.rn} (${pct(tot.fr, tot.rn)})`.padEnd(24) + `${tot.fa} of ${tot.an} (${pct(tot.fa, tot.an)})${tot.design ? " " + tot.design + " by design" : ""}`);
  if(tot.design) console.log("  (by design: a nonsense word read with a wrong short vowel — README \"How the listening works\": what it still forgives)");
  return t;
}

/* ════════════════════════ main ════════════════════════ */
async function main(){
  const started = Date.now();
  // Every case, in one fixed order (virtual first, then takes); ids are positions in THIS list, so a filter never
  // renumbers a case and a replay command stays true.
  let all = [];
  const takeNotes = [];
  if(SOURCE !== "takes") all = all.concat(virtualCases(), directedCases());
  if(SOURCE !== "virtual"){ const tc = takeCases(); all = all.concat(tc.cases); takeNotes.push(...tc.notes); }
  all.forEach((c, i) => { c.id = i + 1; c.seed = hash(SEED + "|case|" + c.id); });
  let run = all;
  if(F_MODE) run = run.filter((c) => F_MODE.includes(c.mode));
  if(F_FAMILY) run = run.filter((c) => F_FAMILY.includes(c.family));
  if(F_LIST){ const keys = F_LIST.map((id) => { const k = listKeyOf(id); if(!k) fail2("no list " + id); return k; }); run = run.filter((c) => keys.includes(listKeyOf(c.listId))); }
  if(CASES) run = run.filter((c) => c.id <= CASES);
  if(ONLY_CASE){ run = run.filter((c) => c.id === ONLY_CASE); if(!run.length) fail2("no case " + ONLY_CASE + " (there are " + all.length + ")"); }

  console.log(`listen-loop: site from ${ROOT === REPO ? "this checkout" : ROOT}; reader model ${MODEL_VERSION}, seed ${SEED}` +
    (RULE ? `; RULE ${RULE}` : "") + (FAULT ? `; FAKE FAULT ${FAULT}` : ""));
  const nv = run.filter((c) => c.source === "virtual").length, nt = run.filter((c) => c.source === "take").length;
  const takeFilesUsed = SOURCE === "virtual" ? [] : takeFiles().map((f) => path.basename(f));
  console.log(`cases: ${run.length} (${nv} virtual, ${nt} from takes: ${takeFilesUsed.length ? takeFilesUsed.join(", ") : "none"})`);
  for(const n of takeNotes) console.log("  takes: " + n);

  const srv = await serve().catch((e) => fail2("cannot serve on port " + PORT + ": " + e.message));
  const B = await browser();
  let lastDone = Date.now(), where = "the self-test";
  const dog = setInterval(() => {
    if(Date.now() - lastDone > 120000){ process.stderr.write(`listen-loop: watchdog: nothing finished for 120 s (in ${where})\n`); B.close(); process.exit(3); }
  }, 2000);
  dog.unref();

  let red = false;
  const fails = await B.evaluate(`__host.selfTest(${JSON.stringify(FAULT || "")})`);
  if(fails.length){
    red = true;
    console.log("FAKE SELF-TEST FAILED — nothing below can be trusted:");
    for(const f of fails) console.log("  x " + f);
  } else console.log("fake self-test: F1-F10 held");

  const rule = RULE ? { name: RULE, edits: RULES[RULE].edits } : null;
  const results = new Map();
  for(let i = 0; i < run.length; i += BATCH){
    const batch = run.slice(i, i + BATCH).map((c) => ({ id: c.id, mode: c.mode, listId: c.listId, seed: c.seed,
      items: c.items.map((it, k) => ({ key: "i" + k, target: it.target, entry: it.entry, events: it.events })) }));
    where = `cases ${batch[0].id}-${batch[batch.length - 1].id}`;
    const out = await B.evaluate(`__host.run(${JSON.stringify(batch)}, ${JSON.stringify({ fault: FAULT, rule })})`);
    for(const r of out) results.set(r.id, r);
    lastDone = Date.now();
    process.stderr.write(`\rlisten-loop: ${Math.min(i + BATCH, run.length)}/${run.length} cases`);
  }
  process.stderr.write("\n");
  clearInterval(dog);
  B.close();
  srv.close();

  // Rows: one per item.
  const rows = [], crashed = [];
  for(const c of run){
    const r = results.get(c.id);
    if(!r || r.error || (r.errors && r.errors.length)) crashed.push({ c, r });
    c.items.forEach((it, k) => {
      const got = r && r.items && r.items[k];
      const verdict = got ? got.verdict : "none";
      rows.push({ id: c.id, k, source: c.source, mode: c.mode, family: c.family, listId: c.listId, target: it.target,
        kind: it.kind, said: it.said, verdict, heard: got && got.actions.length ? got.actions[0].heard : "",
        take: it.take || null, variant: c.variant || null, item: it, c, got });
    });
  }

  if(VERBOSE){
    for(const c of run){
      const r = results.get(c.id) || {};
      console.log(`\n=== case ${c.id}  ${c.source}  ${c.mode}  ${c.listId}`);
      c.items.forEach((it, k) => {
        console.log(`  item ${k}: ${it.target}  ${it.kind}${it.kind !== "right" ? " (said " + JSON.stringify(it.said) + ")" : ""}` +
          (it.why && it.why.length ? "  model: " + it.why.join(", ") : "") + (it.take ? `  take ${it.take.file} #${it.take.n}` : ""));
        for(const e of it.events){
          if(e.type === "error"){ console.log(`      +${e.t}ms error ${e.error}`); continue; }
          e.results.forEach((rr, j) => { if(j >= e.resultIndex) console.log(`      +${e.t}ms slot ${j} ${rr.isFinal ? "FINAL  " : "interim"} ` + rr.alts.map((a) => JSON.stringify(a.transcript) + " " + a.confidence).join(" | ")); });
        }
        const got = r.items && r.items[k];
        console.log(`      engine: ${got ? got.verdict : "?"}` + (got && got.actions.length ? "  (" + got.actions.map((a) => `${a.v}@${a.t}${a.heard ? " " + JSON.stringify(a.heard) : ""}`).join(", ") + ")" : ""));
      });
      console.log("  timeline:");
      for(const x of r.trace || []){
        if(x.act) console.log(`    ${String(x.t).padStart(6)}  ${x.i !== undefined ? "item " + x.i + " " : ""}${x.act}${x.s ? " session " + x.s : ""}${x.heard ? " heard " + JSON.stringify(x.heard) : ""}`);
        else console.log(`    ${String(x.t).padStart(6)}  item ${x.i} event ${x.n}${x.dropped ? " DROPPED (no live session)" : ""}${x.error ? " error " + x.error : ""}${x.nothing ? " (nothing new)" : ""}${x.s ? " -> session " + x.s : ""}`);
      }
      for(const x of r.sr || []) console.log(`    sr ${x.t} session ${x.s} ${x.what}${x.cfg ? " " + JSON.stringify(x.cfg) : ""}`);
      if(r.error) console.log("  ERROR " + r.error);
      for(const e of r.errors || []) console.log("  page error: " + e);
    }
    console.log("");
  }

  const vrows = rows.filter((x) => x.source === "virtual"), trows = rows.filter((x) => x.source === "take");
  let tv = null;
  if(vrows.length){
    console.log("");
    tv = printTable(vrows, "VIRTUAL READER — the engines' LOGIC under the recogniser model's assumptions. NOT a measurement.");
  }
  if(trows.length){
    console.log("");
    const variants = [...new Set(trows.map((x) => x.variant))].sort();
    for(const v of variants) printTable(trows.filter((x) => x.variant === v), `TAKES (variant ${v}) — real recogniser output, replayed through the real engines. Measurements.`);
    const frs = trows.filter((x) => errorOf(x.kind, x.verdict) === "FR");
    if(frs.length){
      let lower = 0, interim = 0;
      for(const x of frs){ const s = inStream(x.item); if(s.lower) lower++; if(s.interim) interim++; }
      console.log(`  takes, false rejects: target in a lower-ranked alternative ${lower} of ${frs.length}; target in an interim ${interim} of ${frs.length}`);
    }
  }

  // Each error, one line each, with its replay command.
  const errs = rows.filter((x) => errorOf(x.kind, x.verdict));
  if(errs.length){
    console.log("");
    console.log(`ERRORS (${errs.length}): kind (FA* = by design), source, mode, list, target, said -> what the engine did | the stream | replay`);
    for(const x of errs){
      const e = errorOf(x.kind, x.verdict);
      let extra = "";
      if(x.source === "take" && e === "FR"){ const s = inStream(x.item); extra = ` | target in a lower alternative: ${s.lower ? "yes" : "no"}, in an interim: ${s.interim ? "yes" : "no"}`; }
      const model = x.item.why && x.item.why.length ? ` | model: ${x.item.why.join(",")}` : "";
      console.log(`  ${(x.item.design && e === "FA" ? "FA*" : e).padEnd(7)} ${x.source === "take" ? "take " + x.take.file + "#" + x.take.n : "virtual"}  ${x.mode} ${x.listId} ${JSON.stringify(x.target)} said ${JSON.stringify(x.said)} -> ${x.verdict}${x.heard ? " (" + JSON.stringify(x.heard) + ")" : ""} | ${keyLines(x.item)}${model}${extra} | ${replayCmd(x.c)}`);
    }
  }

  if(crashed.length){
    red = true;
    console.log("");
    console.log(`CASES THAT DID NOT RUN CLEANLY (${crashed.length}):`);
    for(const { c, r } of crashed.slice(0, 20)) console.log(`  case ${c.id} ${c.mode} ${c.listId}: ${(r && (r.error || (r.errors || []).join(" / "))) || "no result"} | ${replayCmd(c)}`);
  }
  if(B.exceptions.length){ red = true; console.log("uncaught in the host page: " + B.exceptions.slice(0, 3).join(" / ")); }

  // --json
  const json = { tool: "listen-loop", model: MODEL_VERSION, seed: SEED, rule: RULE, fault: FAULT, source: SOURCE,
    takes: takeFilesUsed, filters: { mode: F_MODE, family: F_FAMILY, list: F_LIST, cases: CASES || null, case: ONLY_CASE || null },
    items: rows.map((x) => ({ case: x.id, k: x.k, source: x.source, take: x.take, mode: x.mode, list: x.listId, family: x.family,
      target: x.target, kind: x.kind, said: x.said, verdict: x.verdict })) };
  if(opt.json) fs.writeFileSync(opt.json, JSON.stringify(json, null, 1) + "\n");

  // --against
  let code = 0;
  if(AGAINST){
    const sameCmd = AGAINST.model === json.model && AGAINST.seed === json.seed &&
      JSON.stringify(AGAINST.takes) === JSON.stringify(json.takes) && JSON.stringify(AGAINST.filters) === JSON.stringify(json.filters) &&
      AGAINST.items.length === json.items.length;
    if(!sameCmd){ console.log(""); console.log("--against: NOT THE SAME COMMAND (seed, model, takes, filters or item count differ); nothing compared"); return 2; }
    const before = new Map(AGAINST.items.map((x) => [x.case + "/" + x.k, x]));
    let moved = 0, worse = 0, better = 0, side = 0; const lines = [];
    for(const x of json.items){
      const b = before.get(x.case + "/" + x.k);
      if(!b || b.target !== x.target || b.kind !== x.kind || b.mode !== x.mode){ console.log("--against: NOT THE SAME ITEMS at case " + x.case + "; nothing compared"); return 2; }
      if(b.verdict === x.verdict) continue;
      moved++;
      const d = RANK[x.kind][x.verdict] - RANK[x.kind][b.verdict];
      const tag = d < 0 ? "WORSE" : d > 0 ? "better" : "sideways";
      if(d < 0) worse++; else if(d > 0) better++; else side++;
      lines.push(`  ${tag.padEnd(8)} case ${x.case} ${x.mode} ${x.list} ${JSON.stringify(x.target)} ${x.kind}${x.kind !== "right" ? " (said " + JSON.stringify(x.said) + ")" : ""}: ${b.verdict} -> ${x.verdict}`);
    }
    console.log("");
    lines.sort((a, b) => (a.trim().startsWith("WORSE") ? 0 : 1) - (b.trim().startsWith("WORSE") ? 0 : 1));
    for(const l of lines) console.log(l);
    const byMode = {};
    for(const x of json.items){ const b = before.get(x.case + "/" + x.k); if(b.verdict !== x.verdict){ const k = x.source + " " + x.mode; byMode[k] = (byMode[k] || 0) + 1; } }
    console.log(`against ${path.basename(opt.against)}: ${moved} of ${json.items.length} verdicts moved — ${worse} worse by the answer key, ${better} better, ${side} sideways` +
      (Object.keys(byMode).length ? " (" + Object.entries(byMode).map(([k, v]) => k + ": " + v).join(", ") + ")" : ""));
    if(json.source !== "takes" && json.items.some((x) => x.source === "virtual")) console.log("  (virtual items: the engines' logic under the model's assumptions, not a measurement)");
    code = moved ? 1 : 0;
  }

  // The pin.
  console.log("");
  if(red){
    console.log("RED: the fake failed its self-test, or a case did not run cleanly");
    code = Math.max(code, 1);
  }
  if(tv){
    const pinned = fs.existsSync(PIN_FILE) ? JSON.parse(fs.readFileSync(PIN_FILE, "utf8")) : null;
    const now = {};
    for(const [k, c] of Object.entries(tv)) now[k] = { right: [c.right.n, c.right.accept, c.right.reject, c.right.again, c.right.none],
      wrong: [c.wrong.n, c.wrong.accept, c.wrong.reject, c.wrong.again, c.wrong.none], noise: [c.noise.n, c.noise.accept, c.noise.reject, c.noise.again, c.noise.none] };
    if(opt.measure){
      fs.writeFileSync(PIN_FILE, JSON.stringify({ model: MODEL_VERSION, seed: SEED, columns: "[n, accept, reject, again, none]", counts: now }, null, 1) + "\n");
      console.log("pinned: wrote " + path.relative(REPO, PIN_FILE) + " from this run");
    } else if(PIN_CMD && !AGAINST){
      if(!pinned){ console.log("pin: no " + path.relative(REPO, PIN_FILE) + " (run with --measure)"); code = Math.max(code, 1); }
      else if(pinned.model !== MODEL_VERSION || pinned.seed !== SEED){ console.log("pin: the pinned file is for model " + pinned.model + " seed " + pinned.seed + "; re-pin with --measure"); code = Math.max(code, 1); }
      else {
        const moved = [];
        for(const k of new Set([...Object.keys(pinned.counts), ...Object.keys(now)])){
          for(const kind of ["right", "wrong", "noise"]){
            const a = JSON.stringify((pinned.counts[k] || {})[kind] || null), b = JSON.stringify((now[k] || {})[kind] || null);
            if(a !== b) moved.push(`  ${k} ${kind}: pinned ${a} now ${b}   ([n, accept, reject, again, none])`);
          }
        }
        if(moved.length){
          code = Math.max(code, 1);
          console.log("PINNED EXPECTATION MOVED — a listening verdict changed. If that is the point of the change, show the");
          console.log("before/after (--json, then --against) and re-pin with --measure; if not, it is a regression:");
          for(const m of moved) console.log(m);
        } else console.log("pin: every pinned count held (" + Object.keys(now).length + " mode/family cells)");
      }
    } else console.log("pin: not checked (" + (AGAINST ? "--against" : "not the default command") + ")");
  }
  if(vrows.length) console.log("virtual numbers are the engines' LOGIC under the model's assumptions; only takes are measurements");
  const fr = rows.filter((x) => errorOf(x.kind, x.verdict) === "FR").length, fa = rows.filter((x) => errorOf(x.kind, x.verdict) === "FA").length;
  console.log(`summary: ${rows.length} items in ${run.length} cases; false rejects ${fr} of ${rows.filter((x) => x.kind === "right").length}; ` +
    `false accepts ${fa} of ${rows.filter((x) => x.kind !== "right").length}; ${code === 0 ? "ok" : "RED"}`);
  process.stderr.write(`listen-loop: ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return code;
}

main().then((code) => process.exit(code), (e) => { process.stderr.write(`listen-loop: crashed: ${e && e.stack || e}\n`); process.exit(2); });
