#!/usr/bin/env node
/* save-loop.mjs — closed loop: practice saved on shared Chromebooks (2026-11-25).

     node tools/save-loop.mjs [options]

   THE QUESTION. After students practise on shared Chromebooks — answers, finished rounds, tabs hidden and closed,
   the network dropping and stalling, Sign out and the next student signing in — does each student's students/{uid}
   document hold what that student did, does nobody see or receive anyone else's work, and does Sign out always
   finish?

   WHEN TO RUN IT. After any change to store.js (record, finishRound, scheduleSave, flush, payload, load, the local
   mirror, settle and the high-water mark), to auth.js sign-in or sign-out (signIn, signOut, onAuthStateChanged), to
   anything else that writes students/{uid}, and whenever a new per-student localStorage or sessionStorage key
   appears. About 1 s for the default 160 cases. Node 22 only: no browser, no network, no dependencies.

   FLAGS (each --name=value; an unknown flag is exit 2)
     --cases=N          how many cases (default 160); family round robin, each case its own seed
     --seed=S           base seed (default 1); the same seed gives the same stdout byte for byte
     --case=I           run only case I (with --verbose: its whole timeline, every write, the stored doc, every compare)
     --family=a,b       only these families (names: --list); the round robin is over these
     --root=DIR         load the five site scripts from another folder (a fixed copy, or one with a planted fault)
     --fake-fault=NAME  break the FAKE on purpose (names: --list): the self-test and the run must go red
     --json=FILE        every case's result, the stored docs and the failures
     --verbose          the timeline of each case run
     --list             the families and the fake faults
   Exit 0 = every check held (KNOWN lines excepted); 1 = a check failed, or the fake failed its self-test; 2 = bad
   arguments or the tool crashed; 3 = watchdog (no case finished for 120 real seconds). stdout is deterministic;
   the run time goes to stderr. The last stdout line is the summary: cases, checks held, failures by check id.

   WHAT IS REAL. The site's own scripts, unmodified, in this order, each page one Node vm context:
   firebase-config.js, auth.js, adaptive.js, word-lists.js, store.js (top-level `const`s in firebase-config.js are
   seen by the later scripts, as in the browser). Sign-in is auth.js's own wall button (#ei-wall-btn → signIn →
   signInWithPopup) and its onAuthStateChanged callback; store.js loads itself off EIAuth.ready(). Sign out is the
   click handler auth.js put on #ei-chip-out. The student acts through EIStore.record(listId, word, correct) with a
   real word from WordLists.wordsOf(listId) for a list in EIStore.myLists(), and EIStore.finishRound. Hiding a tab
   fires the page's own `visibilitychange` (visibilityState "hidden") and `pagehide` listeners; closing fires both,
   lets the microtasks run, then kills the page. The debounce, the chained flush, the retry, rule 1, settle() and
   the high-water mark all run as written, on the virtual clock.

   WHAT IS FAKE (self-tested at the start of every run: T1-T8).
   - The clock: virtual. setTimeout/clearTimeout/setInterval, Date.now() and new Date() inside the pages run on it.
     After each timer the tool drains microtasks (one real setImmediate), so promise chains advance in a fixed order.
   - The DOM: stub elements that take any property. getElementById/querySelector('#id') find elements by id; an
     innerHTML that names ids makes fresh elements for them (so a re-rendered chip has a fresh Sign out button, as
     in a browser). <script> appended to <head> (auth.js's Firestore SDK) calls its onload 20 ms later.
   - location: hostname jhoffmanteacher.github.io (the localhost dev bypass stays off); reload() marks the page, and
     the tool then fires its hide events, kills it and boots a fresh page in the same tab 300 ms later.
   - A device (a Chromebook): ONE localStorage shared by every tab and every student (the leak channel), one
     sessionStorage per tab that survives a reload, ONE Firebase Auth user shared by its tabs, one network.
   - firebase.auth(): onAuthStateChanged fires 30 ms after it is registered, and on every page of the device when
     the user changes (1 ms on the page that changed it, 20-300 ms on the others); signInWithPopup resolves 1.5 s
     later with the chosen student; signOut() resolves locally, network or not.
   - firebase.firestore(): one fake SERVER per case. set(body, {merge:true}) deep-merges maps, replaces arrays and
     scalars (an empty map replaces); the body is copied when set() is called. The network, per device:
       ok       a round trip is 40-400 ms; one page's requests land in the order they were issued;
       offline  a write stays PENDING (its promise does not settle) until the network is back, then is sent; a get
                rejects with {code:"unavailable"};
       stalled  reads and writes both stay pending until the network is back.
     A pending write of a page that is closed first is LOST, and so is one whose user is no longer the device's
     user when the network returns (the SDK's write queue is per user). A write already on the wire lands even if
     its tab closes. Rules, minimal: a write to students/{uid} lands only if the device's signed-in uid is uid at
     the moment it lands (else {code:"permission-denied"}); a student may read only their own students/ and
     assignments/ docs and roster/{their lowercased email}; teachers/{their email} reads as not-exists.
   - The server is seeded per case with assignments/{uid} for each student: plain `lists`, a `plan` sequence of
     red-word lists, or `plan` + `plan2`. Students are made up (uid-…, 1002xx@seq.org).

   THE FAMILIES (round robin): plain, offline, close-fast, signout-ok, signout-stalled, failed-load, two-tabs,
   sequence — see FAMILY below; each says what it plays.

   THE CHECKS. The answer key is the tool's own ledger of every answer (student, key, right first try, page, time)
   and of every tab event, network change and page load; it never asks store.js what was saved.
     C1 saved. An answer is OWED when it was recorded on a page whose load succeeded and afterwards EITHER the page
        stayed open 3 s of virtual time with the network ok, OR the tab was hidden, closed, reloaded or signed out
        while the network was ok. For every key with owed answers students/{uid}.words[key] exists; when every answer
        to the key is owed its n and r equal the count of answers and of first-try-right answers, otherwise they lie
        between the owed counts and all the counts. (two-tabs: words only.)
     C2 no leak. Every key in students/{X}.words was answered by X, and the doc's email is X's. Every page, when its
        load finishes and at the end, holds in EIStore.allStats() only keys of its own student's doc or answers.
     C3 sign out finishes. Within 10 s of virtual time after Sign out is clicked, location.reload() was called and
        the device's auth user was null when it was — in every network state.
     C4 rule 1. A page whose first read failed issues no write at all.
     C5 the high-water mark. For a student with a plan, the stored seq.at (and seq2.at) for the same `of` never goes
        down, and a page that loads with a mark stored is at or past it in that plan and still offers every list of
        every step before it (EIStore.myLists()).
     C6 totals (single-tab cases). When every answer of a student is owed, stored totals.n and totals.r equal them.

   KNOWN (printed as "~ known", not failed).
     K1 two-tabs: totals are last-writer-wins. Each tab sends its own running totals whole, so the stored totals are
        whichever tab wrote last. Words are not affected (each tab sends only the words it changed).

   EXPECTED AT 4d4b834. Two families fail: signout-stalled fails C3 (auth.js signOut() waits on EIStore.flush() with
   no time limit, and a write made offline never settles), and close-fast fails C1 and C6 (store.js debounces saves
   1200 ms and nothing flushes on pagehide or visibilitychange). Both are being fixed on branch wo-signout.

   NOT MODELLED. A second tab of the signed-out student left open while the next student signs in; the Firestore
   memory cache (a get() offline never answers from it); a stalled get() that fails after a while (here it waits
   for the network, like the real one); clock skew; the browser's 'online'/'offline' events (the site has no
   listener); the teacher's pages, preview and the test student; recordHeard and recordFluency.
*/

import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAMILIES = ["plain", "offline", "close-fast", "signout-ok", "signout-stalled", "failed-load", "two-tabs", "sequence"];
const FAKE_FAULTS = {
  merge: "set(…, {merge:true}) replaces top-level maps instead of merging them (a save of one word wipes the rest)",
  clock: "the pages get the real clock (real setTimeout and Date), so the debounce never fires inside a case",
};
const SITE_FILES = ["firebase-config.js", "auth.js", "adaptive.js", "word-lists.js", "store.js"];
const EPOCH = Date.UTC(2026, 10, 2, 16, 0, 0);   // a Monday, 8 a.m. in California
const OWED_OPEN_MS = 3000, SIGNOUT_LIMIT_MS = 10000;

/* ── arguments ─────────────────────────────────────────────────────── */
function usage(msg) {
  process.stderr.write(`save-loop: ${msg}\nflags: --cases=N --seed=S --case=I --family=a,b --root=DIR ` +
    `--fake-fault=NAME --json=FILE --verbose --list\n`);
  process.exit(2);
}
function parseArgs(argv) {
  const o = { cases: 160, seed: 1, case: null, family: null, root: path.resolve(HERE, ".."), fakeFault: null,
              json: null, verbose: false, list: false, rootGiven: false };
  const int = (k, v) => { if (!/^\d+$/.test(v || "")) usage(`--${k} needs a whole number`); return +v; };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) usage(`not a flag: ${a}`);
    const [, k, v] = m;
    if (k === "cases") o.cases = int(k, v);
    else if (k === "seed") o.seed = int(k, v);
    else if (k === "case") o.case = int(k, v);
    else if (k === "family") {
      o.family = String(v || "").split(",").filter(Boolean);
      for (const f of o.family) if (!FAMILIES.includes(f)) usage(`no family "${f}" (see --list)`);
      if (!o.family.length) usage("--family needs names");
    } else if (k === "root") { if (!v) usage("--root needs a folder"); o.root = path.resolve(v); o.rootGiven = true; }
    else if (k === "fake-fault") { if (!FAKE_FAULTS[v]) usage(`no fake fault "${v}" (see --list)`); o.fakeFault = v; }
    else if (k === "json") { if (!v) usage("--json needs a file"); o.json = v; }
    else if (k === "verbose" && v === undefined) o.verbose = true;
    else if (k === "list" && v === undefined) o.list = true;
    else usage(`unknown flag --${k}`);
  }
  return o;
}

/* ── randomness: mulberry32, one stream per case ─────────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function Rng(seed) {
  const f = mulberry32(seed);
  return { f, int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)), pick: (a) => a[Math.floor(f() * a.length)],
           chance: (p) => f() < p };
}
const caseSeed = (base, i) => (Math.floor(mulberry32(base * 1000003 + i * 7919 + 17)() * 4294967296) >>> 0);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const tick = () => new Promise((r) => setImmediate(r));
const secs = (ms) => (ms / 1000).toFixed(3) + "s";

/* ── the virtual clock and its event queue ──────────────────────────── */
class World {
  constructor(fault, rng) { this.now = EPOCH; this.q = []; this.n = 0; this.fault = fault; this.rng = rng; this.lines = []; }
  at(t, fn, page = null) {
    const ev = { t, n: this.n++, fn, page, dead: false };
    let lo = 0, hi = this.q.length;
    while (lo < hi) { const m = (lo + hi) >> 1, x = this.q[m]; if (x.t < t || (x.t === t && x.n < ev.n)) lo = m + 1; else hi = m; }
    this.q.splice(lo, 0, ev);
    return ev;
  }
  log(s) { this.lines.push(`[${secs(this.now - EPOCH).padStart(9)}] ${s}`); }
  async step(limit) {
    await tick();                       // what the last call started runs before the clock moves on
    const ev = this.q[0];
    if (!ev || ev.t > limit) return false;
    this.q.shift();
    if (ev.dead || (ev.page && ev.page.dead)) return true;
    this.now = Math.max(this.now, ev.t);
    try { ev.fn(); } catch (e) { this.log(`! error in ${ev.page ? ev.page.name : "the fake"}: ${e && e.message}`); if (ev.page) ev.page.errors.push(String(e && e.message)); }
    await tick();
    return true;
  }
  async advance(ms) { const target = this.now + ms; while (await this.step(target)); this.now = Math.max(this.now, target); }
  async until(cond, maxMs) {
    const limit = this.now + maxMs;
    for (;;) {
      if (cond()) return true;
      if (this.now >= limit) return false;
      if (!(await this.step(limit))) this.now = limit;
    }
  }
}

/* ── the fake Firestore server ───────────────────────────────────────── */
class Server {
  constructor(fault) { this.docs = new Map(); this.fault = fault; }
  read(p) { return clone(this.docs.get(p)); }
  apply(p, body, merge) {
    if (!merge || !this.docs.has(p)) { this.docs.set(p, clone(body)); return; }
    const fault = this.fault;
    (function into(t, s, top) {
      for (const k of Object.keys(s)) {
        const v = s[k];
        if (isMap(v) && Object.keys(v).length && isMap(t[k]) && !(fault === "merge" && top)) into(t[k], v, false);
        else t[k] = clone(v);
      }
    })(this.docs.get(p), body, true);
  }
}
function readAllowed(p, u) {
  if (!u) return false;
  const [c, id] = p.split("/");
  if (c === "students" || c === "assignments") return id === u.uid;
  if (c === "roster" || c === "teachers") return id === String(u.email).toLowerCase();
  return false;
}

class Storage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(String(k)); }
  clear() { this.m.clear(); }
  key(i) { return [...this.m.keys()][i] ?? null; }
  get length() { return this.m.size; }
}

/* ── a device: one Chromebook ───────────────────────────────────────── */
class Device {
  constructor(w, server, name) {
    Object.assign(this, { w, server, name, local: new Storage(), user: null, listeners: [], net: "ok",
                          netLog: [{ t: w.now, s: "ok" }], tabs: [], nextStudent: null });
  }
  newTab() { const t = { device: this, name: `${this.name}/T${this.tabs.length + 1}`, session: new Storage(), page: null, n: 0 }; this.tabs.push(t); return t; }
  setUser(u, origin) {
    this.user = u;
    this.w.log(`${this.name} auth user → ${u ? u.email : "null"}`);
    for (const l of this.listeners) {
      if (l.page.dead) continue;
      const d = l.page === origin ? 1 : this.w.rng.int(20, 300);
      this.w.at(this.w.now + d, () => l.fn(u ? { ...u } : null), l.page);
    }
  }
  setNet(s) {
    if (s === this.net) return;
    this.net = s; this.netLog.push({ t: this.w.now, s });
    this.w.log(`${this.name} network → ${s}`);
    if (s === "ok") for (const t of this.tabs) if (t.page && !t.page.dead) t.page.resume();
  }
  netAt(t) { let s = "ok"; for (const e of this.netLog) if (e.t <= t) s = e.s; return s; }
  // Is there a stretch of OWED_OPEN_MS, inside [from, to], with the network ok throughout?
  okWindow(from, to) {
    for (let i = 0; i < this.netLog.length; i++) {
      if (this.netLog[i].s !== "ok") continue;
      const a = Math.max(from, this.netLog[i].t), b = Math.min(to, i + 1 < this.netLog.length ? this.netLog[i + 1].t : Infinity);
      if (b - a >= OWED_OPEN_MS) return true;
    }
    return false;
  }
}

/* ── the stub DOM ───────────────────────────────────────────────────── */
function makeDom(page) {
  const byId = new Map();
  class El {
    constructor(tag) { Object.assign(this, { tagName: String(tag).toUpperCase(), _id: "", _html: "", hidden: false, handlers: {}, children: [],
      textContent: "", className: "", style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }); }
    get id() { return this._id; }
    set id(v) { this._id = String(v); byId.set(this._id, this); }
    get innerHTML() { return this._html; }
    set innerHTML(v) { this._html = String(v); for (const m of this._html.matchAll(/\sid="([^"]+)"/g)) new El("x").id = m[1]; }
    addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }
    removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); }
    appendChild(c) { this.children.push(c); if (c && c.tagName === "SCRIPT") page.scriptAdded(c); return c; }
    remove() {}
    setAttribute(k, v) { this[k] = String(v); }
    getAttribute(k) { return this[k] ?? null; }
    querySelector(sel) { return sel[0] === "#" ? byId.get(sel.slice(1)) || null : new El("div"); }
    querySelectorAll() { return []; }
  }
  const handlers = {};
  const doc = {
    readyState: "complete", visibilityState: "visible", hidden: false,
    head: new El("head"), body: new El("body"), documentElement: new El("html"),
    createElement: (t) => new El(t), getElementById: (id) => byId.get(String(id)) || null,
    querySelector: (s) => (s[0] === "#" ? byId.get(s.slice(1)) || null : null), querySelectorAll: () => [],
    addEventListener: (t, f) => (handlers[t] ||= []).push(f), removeEventListener() {}, handlers,
  };
  return { doc, byId };
}

/* ── a page: one load of the site in one tab ────────────────────────── */
let SCRIPTS = null;
function loadScripts(root) {
  return SITE_FILES.map((f) => {
    const file = path.join(root, f);
    if (!fs.existsSync(file)) throw new Error(`no ${f} in ${root}`);
    return new vm.Script(fs.readFileSync(file, "utf8"), { filename: file });
  });
}

class Page {
  constructor(c, tab, bare = false) {
    const w = c.w, dev = tab.device;
    Object.assign(this, { c, w, tab, dev, name: `${tab.name}/p${++tab.n}`, dead: false, openAt: w.now, endAt: null,
      events: [], writes: [], pending: [], lastLand: 0, errors: [], ready: null, student: null, timers: new Map(), tid: 0,
      reloadAt: null, userAtReload: undefined, db: null });
    tab.page = this;
    const { doc, byId } = makeDom(this);
    this.doc = doc; this.byId = byId; this.winHandlers = {};
    const page = this;
    const realClock = w.fault === "clock";
    const g = {
      console: { log() {}, info() {}, warn: (...a) => w.log(`${page.name} console.warn ${a.map(String).join(" ")}`),
                 error: (...a) => w.log(`${page.name} console.error ${a.map(String).join(" ")}`) },
      setTimeout: realClock
        ? (fn, ms) => { const h = setTimeout(() => { if (!page.dead) try { fn(); } catch (e) {} }, ms); h.unref(); return h; }
        : (fn, ms, ...a) => { if (typeof fn !== "function") return 0; const id = ++page.tid;
            page.timers.set(id, w.at(w.now + Math.max(0, +ms || 0), () => { page.timers.delete(id); fn(...a); }, page)); return id; },
      clearTimeout: realClock ? (h) => clearTimeout(h) : (id) => { const ev = page.timers.get(id); if (ev) ev.dead = true; page.timers.delete(id); },
      setInterval: () => 0, clearInterval() {},
      localStorage: dev.local, sessionStorage: tab.session, document: doc, navigator: { onLine: true, userAgent: "save-loop" },
      location: { hostname: "jhoffmanteacher.github.io", search: "", hash: "", pathname: "/EnglishIntensive/index.html",
                  href: "https://jhoffmanteacher.github.io/EnglishIntensive/index.html", reload: () => page.siteReload() },
      firebase: this.firebaseFor(),
      __vnow: () => w.now,
    };
    this.ctx = vm.createContext(g);
    this.ctx.window = this.ctx; this.ctx.self = this.ctx;
    this.ctx.addEventListener = (t, f) => (page.winHandlers[t] ||= []).push(f);
    this.ctx.removeEventListener = () => {};
    if (!realClock) vm.runInContext(`(function(){ var RD = Date, now = __vnow;
      function D(){ if (!new.target) return new RD(now()).toString();
        return arguments.length ? new (Function.prototype.bind.apply(RD, [null].concat([].slice.call(arguments))))() : new RD(now()); }
      D.now = function(){ return now(); }; D.UTC = RD.UTC; D.parse = RD.parse; D.prototype = RD.prototype;
      globalThis.Date = D; })();`, this.ctx);
    if (bare) return;
    for (const s of SCRIPTS) {
      try { s.runInContext(this.ctx); }
      catch (e) { this.errors.push(`${path.basename(s.filename || "")}: ${e.message}`); c.fail("C0", `load ${this.name}`, "every site script runs", `threw: ${e.message}`); }
    }
    w.log(`${this.name} opened`);
    try {
      this.ctx.EIStore.ready().then((r) => { if (!page.dead) { page.ready = r; c.onReady(page); } });
    } catch (e) { c.fail("C0", `load ${this.name}`, "EIStore", `missing: ${e.message}`); }
  }

  firebaseFor() {
    const page = this, w = this.w, dev = this.dev;
    function GoogleAuthProvider() { this.setCustomParameters = () => {}; }
    const authObj = {
      get currentUser() { return dev.user; },
      onAuthStateChanged(fn) {
        const l = { page, fn }; dev.listeners.push(l);
        w.at(w.now + 30, () => fn(dev.user ? { ...dev.user } : null), page);
        return () => { dev.listeners = dev.listeners.filter((x) => x !== l); };
      },
      signInWithPopup() {
        return new Promise((res) => w.at(w.now + 1500, () => { const u = dev.nextStudent; dev.setUser(u, page); res({ user: { ...u } }); }, page));
      },
      signOut() { dev.setUser(null, page); return Promise.resolve(); },
    };
    const auth = () => authObj;
    auth.GoogleAuthProvider = GoogleAuthProvider;
    return { initializeApp() {}, auth, firestore: undefined };
  }
  scriptAdded(s) {
    this.w.at(this.w.now + 20, () => { this.ctx.firebase.firestore = () => this.firestore(); if (typeof s.onload === "function") s.onload(); }, this);
  }
  firestore() {
    if (this.db) return this.db;
    const ref = (c, id) => ({ id, get: () => this.op({ kind: "get", path: `${c}/${id}` }),
      set: (body, opts) => this.op({ kind: "set", path: `${c}/${id}`, body: clone(body), merge: !!(opts && opts.merge) }) });
    return (this.db = { collection: (c) => ({ doc: (id) => ref(c, String(id)) }) });
  }
  op(op) {
    const w = this.w;
    Object.assign(op, { page: this, uid: this.dev.user ? this.dev.user.uid : null, at: w.now, state: "queued" });
    return new Promise((res, rej) => {
      op.res = res; op.rej = rej;
      if (op.kind === "set") { this.writes.push(op); this.c.writes.push(op); w.log(`${this.name} write ${op.path} issued (${this.dev.net}) ${JSON.stringify(Object.keys(op.body))}`); }
      if (this.dev.net === "ok") this.send(op);
      else if (this.dev.net === "offline" && op.kind === "get") w.at(w.now + 5, () => { w.log(`${this.name} read ${op.path} → unavailable`); rej({ code: "unavailable", message: "client is offline" }); }, this);
      else this.pending.push(op);
    });
  }
  send(op) {
    const w = this.w; op.state = "wire";
    const t = Math.max(w.now + w.rng.int(40, 400), this.lastLand + 1);
    this.lastLand = t;
    w.at(t, () => this.land(op));          // no page: lands even if the tab has closed
  }
  land(op) {
    const w = this.w, u = this.dev.user, alive = !this.dead;
    if (op.kind === "get") {
      if (!alive) return;
      if (!readAllowed(op.path, u)) { w.log(`${this.name} read ${op.path} → permission-denied`); return op.rej({ code: "permission-denied" }); }
      const d = op.path.startsWith("teachers/") ? undefined : this.c.server.read(op.path);
      return op.res({ exists: d !== undefined, id: op.path.split("/")[1], data: () => clone(d) });
    }
    if (!(u && op.path === `students/${u.uid}`)) {
      op.state = "denied"; w.log(`${this.name} write ${op.path} DENIED (device user ${u ? u.uid : "null"})`);
      if (alive) op.rej({ code: "permission-denied" });
      return;
    }
    this.c.server.apply(op.path, op.body, op.merge);
    op.state = "landed"; op.landedAt = w.now;
    w.log(`${this.name} write ${op.path} landed${alive ? "" : " (tab already closed)"}`);
    this.c.afterLand(op);
    if (alive) op.res();
  }
  resume() {
    const ops = this.pending; this.pending = [];
    for (const op of ops) {
      if (op.kind === "set" && op.uid !== (this.dev.user && this.dev.user.uid)) { op.state = "lost-user"; this.w.log(`${this.name} write ${op.path} LOST (its user signed out)`); }
      else this.send(op);
    }
  }
  fire(target, type) {
    const hs = target === "window" ? this.winHandlers[type] : this.doc.handlers[type];
    for (const f of hs || []) { try { f.call(this.ctx, { type, persisted: false }); } catch (e) { this.errors.push(e.message); } }
  }
  hideEvents() {
    this.doc.visibilityState = "hidden"; this.doc.hidden = true;
    this.fire("document", "visibilitychange"); this.fire("window", "pagehide");
  }
  kill() {
    this.dead = true; this.endAt = this.w.now;
    for (const op of this.pending) if (op.kind === "set") { op.state = "lost-closed"; this.w.log(`${this.name} write ${op.path} LOST with the tab`); }
    this.pending = [];
    this.dev.listeners = this.dev.listeners.filter((l) => l.page !== this);
    this.w.log(`${this.name} closed`);
  }
  siteReload() {
    if (this.reloadAt !== null) return;
    this.reloadAt = this.w.now; this.userAtReload = this.dev.user;
    this.w.log(`${this.name} location.reload() (device user ${this.dev.user ? this.dev.user.uid : "null"})`);
    this.w.at(this.w.now, () => { if (this.tab.page === this && !this.dead) this.c.unload(this, null); });
  }
}

/* ── one case ───────────────────────────────────────────────────────── */
class Case {
  constructor(i, fam, seed, opts) {
    Object.assign(this, { i, fam, seed, opts, rng: Rng(seed), failures: [], known: [], held: 0, answers: [], writes: [],
      pages: [], students: [], devices: [], seqHist: {} });
    this.w = new World(opts.fakeFault, this.rng);
    this.server = new Server(opts.fakeFault);
  }
  fail(check, step, expected, stored) { this.failures.push({ check, step, expected, stored }); this.w.log(`✗ ${check} ${step}: expected ${expected}, stored ${stored}`); }
  ok(check, what) { this.held++; this.w.log(`✓ ${check} ${what}`); }
  device() { const d = new Device(this.w, this.server, `D${this.devices.length + 1}`); this.devices.push(d); return d; }

  /* A made-up student and their assignment on the server. kind: lists | plan | plan2 */
  student(kind) {
    const r = this.rng, k = this.students.length;
    const num = 100200 + k * 17 + r.int(0, 15);
    const uid = "uid-" + Math.floor(r.f() * 2 ** 32).toString(16).padStart(8, "0");
    kind ||= r.chance(0.5) ? "lists" : r.chance(0.7) ? "plan" : "plan2";
    const S = { uid, email: `${num}@seq.org`, displayName: `Test Student ${num}`, photoURL: null, kind };
    const reds = []; while (reds.length < 5) { const n = r.int(1, 10); if (!reds.includes(n)) reds.push(n); }
    const a = { classId: "c-test", teachers: ["teacher@seq.org"] };
    if (kind === "lists") {
      const pool = ["initial-blends", "final-blends", "nonsense", "oi-oy-1-cards", "multi-1-match", `red-${reds[0]}-say`, `red-${reds[1]}-cards`];
      a.lists = []; while (a.lists.length < 3) { const id = r.pick(pool); if (!a.lists.includes(id)) a.lists.push(id); }
    } else {
      a.lists = [];
      a.plan = { steps: [{ ids: [`red-${reds[0]}-say`] }, { ids: [`red-${reds[1]}-say`, `red-${reds[1]}-cards`] }, { ids: [`red-${reds[2]}-cards`] }],
                 bar: 0.9, at: 0, hold: false, setAt: EPOCH - 86400000 * r.int(1, 9) };
      if (kind === "plan2") a.plan2 = { steps: [{ ids: [`red-${reds[3]}-match`] }, { ids: [`red-${reds[4]}-match`] }], bar: 0.9, at: 0, hold: false, setAt: EPOCH - 86400000 * r.int(10, 19) };
    }
    S.assignment = a;
    this.server.docs.set(`assignments/${uid}`, clone(a));
    this.students.push(S);
    return S;
  }

  /* ── what a student does ── */
  boot(tab) { const p = new Page(this, tab); this.pages.push(p); return p; }
  async waitReady(p, ms = 30000) { await this.w.until(() => p.ready || p.dead, ms); return p.ready; }
  async signIn(tab, S) {
    const p = tab.page && !tab.page.dead ? tab.page : this.boot(tab);
    await this.w.until(() => p.ready || (p.byId.get("ei-wall-signin") && !p.byId.get("ei-wall-signin").hidden), 15000);
    if (!p.ready) {
      tab.device.nextStudent = S;
      this.w.log(`${p.name} ${S.email} clicks "Sign in with Google"`);
      const btn = p.byId.get("ei-wall-btn");
      for (const f of (btn && btn.handlers.click) || []) f.call(p.ctx, { type: "click" });
      await tick();
    }
    await this.waitReady(p);
    return p;
  }
  myLists(p) { try { return Array.from(p.ctx.EIStore.myLists()); } catch (e) { return []; } }
  async answer(p, o = {}) {
    if (p.dead || !p.ready) return false;
    const lists = (o.lists || this.myLists(p)).filter((id) => p.ctx.WordLists.exists(id));
    if (!lists.length) return false;
    const id = this.rng.pick(lists), all = Array.from(p.ctx.WordLists.wordsOf(id));
    const words = o.parity === undefined ? all : all.filter((_, k) => k % 2 === o.parity);
    const word = o.word !== undefined ? o.word : this.rng.pick(words);
    const correct = o.correct !== undefined ? o.correct : this.rng.chance(0.7);
    const key = p.ctx.Adaptive.keyFor(id, p.ctx.WordLists.plain(word));
    p.ctx.EIStore.record(id, word, correct);
    this.answers.push({ uid: p.student, key, correct, t: this.w.now, page: p });
    this.w.log(`${p.name} answer ${key} ${correct ? "right" : "wrong"}`);
    await tick();
    return true;
  }
  async practise(p, n, o = {}) {
    let right = 0, total = 0, list = null;
    for (let k = 0; k < n; k++) {
      if (!(await this.answer(p, o))) return;
      total++; right += this.answers[this.answers.length - 1].correct ? 1 : 0;
      list = this.answers[this.answers.length - 1].key.split("|")[0];
      if (total >= 6 && this.rng.chance(0.15)) { this.w.log(`${p.name} finishes a round`); p.ctx.EIStore.finishRound(list, right, total); right = total = 0; await tick(); }
      await this.w.advance(o.gap ? this.rng.int(o.gap[0], o.gap[1]) : this.rng.int(300, 2200));
    }
  }
  hide(p) { p.events.push({ t: this.w.now, kind: "hide" }); this.w.log(`${p.name} hidden`); p.hideEvents(); }
  show(p) { p.doc.visibilityState = "visible"; p.doc.hidden = false; this.w.log(`${p.name} shown`); p.fire("document", "visibilitychange"); }
  async close(p) { p.events.push({ t: this.w.now, kind: "close" }); this.unload(p, "close"); await tick(); }
  // hide events, the microtasks they start, then the page dies; a reload boots the next page 300 ms later
  unload(p, kind) {
    p.hideEvents();
    const w = this.w;
    tick().then(() => { if (p.dead) return; p.kill(); if (kind !== "close") w.at(w.now + 300, () => { if (!p.tab.page || p.tab.page === p) this.boot(p.tab); }); });
  }
  async reload(p) {
    p.events.push({ t: this.w.now, kind: "reload" }); this.w.log(`${p.name} the student reloads the tab`);
    this.unload(p, "reload");
    await this.w.until(() => p.tab.page !== p, 5000);
    const q = p.tab.page; await this.waitReady(q); return q;
  }
  signOut(p) {
    const t0 = this.w.now; p.events.push({ t: t0, kind: "signout" });
    this.w.log(`${p.name} clicks Sign out (network ${p.dev.net})`);
    const btn = p.byId.get("ei-chip-out");
    for (const f of (btn && btn.handlers.click) || []) f.call(p.ctx, { type: "click" });
    this.w.at(t0 + SIGNOUT_LIMIT_MS, () => {
      const step = `Sign out clicked on ${p.name} at ${secs(t0 - EPOCH)}, network ${p.dev.netAt(t0)}`;
      if (p.reloadAt === null) this.fail("C3", step, "location.reload() within 10 s, auth user null", `no reload after 10 s; device user ${p.dev.user ? p.dev.user.email : "null"}`);
      else if (p.userAtReload) this.fail("C3", step, "auth user null at the reload", `reload at +${secs(p.reloadAt - t0)} with ${p.userAtReload.email} still signed in`);
      else this.ok("C3", `${step}: reload at +${secs(p.reloadAt - t0)}, user null`);
    });
  }

  /* ── what the checks look at as the case runs ── */
  onReady(p) {
    try { p.student = p.ctx.EIAuth.uid(); } catch (e) { p.student = null; }
    this.w.log(`${p.name} ready ${JSON.stringify(p.ready)} as ${p.student}`);
    this.checkStats(p, "load");
    this.checkMark(p);
  }
  checkStats(p, when) {
    const keys = Object.keys(p.ctx.EIStore.allStats() || {});
    const doc = this.server.read(`students/${p.student}`) || {};
    const own = new Set([...Object.keys(doc.words || {}), ...this.answers.filter((a) => a.uid === p.student).map((a) => a.key)]);
    const stray = keys.filter((k) => !own.has(k));
    if (stray.length) this.fail("C2", `${p.name} EIStore.allStats() at ${when} (student ${p.student})`, "only that student's keys", `${stray.length} other keys, e.g. ${stray[0]}`);
    else this.ok("C2", `${p.name} allStats at ${when}: ${keys.length} keys, all its own`);
  }
  checkMark(p) {
    const S = this.students.find((s) => s.uid === p.student);
    if (!S || !p.ready.ok || S.kind === "lists") return;
    const doc = this.server.read(`students/${S.uid}`) || {};
    let info = null; try { info = p.ctx.EIStore.plan(); } catch (e) {}
    const plans = [S.assignment.plan, S.assignment.plan2];
    ["seq", "seq2"].forEach((f, k) => {
      const plan = plans[k], mark = doc[f];
      if (!plan || !mark || mark.of !== plan.setAt) return;
      const step = `${p.name} loaded with ${f}.at=${mark.at}`;
      const idx = info && info.sequences[k] ? info.sequences[k].index : -1;
      const need = plan.steps.slice(0, mark.at).flatMap((s) => s.ids).filter((id) => p.ctx.WordLists.exists(id));
      const lists = this.myLists(p), missing = need.filter((id) => !lists.includes(id));
      if (idx < mark.at) this.fail("C5", step, `position ≥ ${mark.at}`, `position ${idx}`);
      else if (missing.length) this.fail("C5", step, `myLists() holds ${need.join(",")}`, `missing ${missing.join(",")}`);
      else this.ok("C5", `${step}: at ${idx}, ${need.length} earlier lists offered`);
    });
  }
  afterLand(op) {
    const doc = this.server.read(op.path), h = (this.seqHist[op.path] ||= { seq: null, seq2: null });
    for (const f of ["seq", "seq2"]) {
      const m = doc[f]; if (!m) continue;
      const prev = h[f];
      if (prev && prev.of === m.of && m.at < prev.at) this.fail("C5", `${op.page.name} write landed on ${op.path}`, `${f}.at ≥ ${prev.at}`, `${f}.at = ${m.at}`);
      else if (!prev || prev.at !== m.at || prev.of !== m.of) this.ok("C5", `${op.path} ${f} → at ${m.at}`);
      h[f] = { at: m.at, of: m.of };
    }
  }

  /* ── the checks at the end of a case ── */
  owed(a) {
    const p = a.page, dev = p.dev, end = p.endAt ?? this.w.now;
    if (!(p.ready && p.ready.ok)) return false;
    if (dev.okWindow(a.t, end)) return true;
    return p.events.some((e) => e.t >= a.t && dev.netAt(e.t) === "ok");
  }
  finish() {
    for (const p of this.pages) if (!p.dead) { p.endAt = this.w.now; if (p.ready && p.student) this.checkStats(p, "the end"); }
    const replayStep = (a) => `answer ${a.key} on ${a.page.name} at ${secs(a.t - EPOCH)}`;
    for (const S of this.students) {
      const doc = this.server.read(`students/${S.uid}`) || {}, words = doc.words || {};
      const mine = this.answers.filter((a) => a.uid === S.uid);
      if (this.opts.verbose) this.w.log(`stored students/${S.uid}: ${JSON.stringify(doc)}`);
      const byKey = new Map();
      for (const a of mine) { if (!byKey.has(a.key)) byKey.set(a.key, []); byKey.get(a.key).push({ ...a, owed: this.owed(a) }); }
      let allOwed = true;
      for (const [key, as] of byKey) {
        const owed = as.filter((a) => a.owed), st = words[key];
        if (owed.length < as.length) allOwed = false;
        if (!owed.length) continue;
        const n = as.length, r = as.filter((a) => a.correct).length, on = owed.length, or = owed.filter((a) => a.correct).length;
        const last = owed[owed.length - 1];
        const got = st ? `n=${st.n} r=${st.r}` : "no entry";
        if (owed.length === as.length) {
          if (st && st.n === n && st.r === r) this.ok("C1", `${S.uid} ${key} n=${n} r=${r}`);
          else this.fail("C1", replayStep(last) + this.after(last), `n=${n} r=${r}`, got);
        } else if (st && st.n >= on && st.n <= n && st.r >= or && st.r <= r) this.ok("C1", `${S.uid} ${key} n=${st.n} in ${on}..${n}`);
        else this.fail("C1", replayStep(last) + this.after(last), `n in ${on}..${n}, r in ${or}..${r}`, got);
      }
      // C2: nothing in this doc that this student did not answer, and the doc is theirs
      const answered = new Set(mine.map((a) => a.key)), stray = Object.keys(words).filter((k) => !answered.has(k));
      if (stray.length) this.fail("C2", `students/${S.uid} at the end`, "only keys this student answered", `${stray.length} others, e.g. ${stray[0]}`);
      else if (doc.email && doc.email !== S.email) this.fail("C2", `students/${S.uid} at the end`, `email ${S.email}`, `email ${doc.email}`);
      else this.ok("C2", `students/${S.uid}: ${Object.keys(words).length} keys, all its own`);
      // C6
      if (mine.length && allOwed) {
        const n = mine.length, r = mine.filter((a) => a.correct).length, t = doc.totals || {};
        const step = `totals of ${S.uid} after ${n} owed answers`;
        if (t.n === n && t.r === r) this.ok("C6", `${S.uid} totals n=${n} r=${r}`);
        else if (this.fam === "two-tabs") this.known.push({ id: "K1", step, expected: `n=${n} r=${r}`, stored: `n=${t.n} r=${t.r}` });
        else this.fail("C6", step, `n=${n} r=${r}`, `n=${t.n} r=${t.r}`);
      }
    }
    // C4: a page whose first read failed wrote nothing
    for (const p of this.pages) if (p.ready && p.ready.failed) {
      if (p.writes.length) this.fail("C4", `${p.name} load failed`, "no write", `${p.writes.length} writes, first at ${secs(p.writes[0].at - EPOCH)}`);
      else this.ok("C4", `${p.name} load failed and wrote nothing`);
    }
    for (const p of this.pages) for (const e of p.errors) this.w.log(`! ${p.name}: ${e}`);
  }
  after(a) {
    const p = a.page, e = p.events.find((x) => x.t >= a.t);
    if (e) return `, then ${e.kind} at ${secs(e.t - EPOCH)} (network ${p.dev.netAt(e.t)})`;
    return p.dead ? `, tab closed at ${secs(p.endAt - EPOCH)}` : ", tab still open at the end";
  }
}

/* ── the scenario families ─────────────────────────────────────────── */
const FAMILY = {
  // One student, network ok: practise, maybe hide and come back, settle, maybe close.
  async plain(c) {
    const r = c.rng, S = c.student(), p = await c.signIn(c.device().newTab(), S);
    await c.practise(p, r.int(5, 25));
    if (r.chance(0.4)) { c.hide(p); await c.w.advance(r.int(1000, 8000)); c.show(p); await c.practise(p, r.int(1, 6)); }
    await c.w.advance(4000);
    if (r.chance(0.5)) await c.close(p);
  },
  // The network drops (or stalls) mid-practice and comes back before the tab closes.
  async offline(c) {
    const r = c.rng, S = c.student(), d = c.device(), p = await c.signIn(d.newTab(), S);
    await c.practise(p, r.int(3, 10));
    d.setNet(r.chance(0.5) ? "offline" : "stalled");
    await c.practise(p, r.int(2, 8));
    if (r.chance(0.3)) c.hide(p);
    await c.w.advance(r.int(0, 5000));
    d.setNet("ok");
    await c.practise(p, r.int(0, 4));
    await c.w.advance(4000);
    await c.close(p);
  },
  // The tab is hidden and closed within 1 s of the last answer, network ok.
  async "close-fast"(c) {
    const r = c.rng, S = c.student(), p = await c.signIn(c.device().newTab(), S);
    await c.practise(p, r.int(3, 12));
    await c.answer(p);
    await c.w.advance(r.int(50, 700));
    if (r.chance(0.5)) { c.hide(p); await c.w.advance(r.int(0, 200)); }
    await c.close(p);
  },
  // A practises and signs out; B signs in on the same tab and practises.
  async "signout-ok"(c) {
    const r = c.rng, A = c.student(), B = c.student(), d = c.device();
    const p = await c.signIn(d.newTab(), A);
    await c.practise(p, r.int(3, 12), { gap: [200, 1500] });
    c.signOut(p);
    await c.w.until(() => p.tab.page !== p, 15000);
    const q = await c.signIn(p.tab, B);
    await c.practise(q, r.int(3, 10));
    await c.w.advance(r.int(4000, 12000));
  },
  // A's network is offline or stalled when A clicks Sign out; it comes back 10-25 s later; then B.
  async "signout-stalled"(c) {
    const r = c.rng, A = c.student(), B = c.student(), d = c.device();
    const p = await c.signIn(d.newTab(), A);
    await c.practise(p, r.int(3, 10));
    await c.w.advance(r.int(0, 4000));
    d.setNet(r.chance(0.5) ? "offline" : "stalled");
    await c.practise(p, r.int(1, 3), { gap: [100, 800] });
    c.signOut(p);
    await c.w.advance(SIGNOUT_LIMIT_MS + r.int(0, 15000));
    d.setNet("ok");
    await c.w.until(() => p.tab.page !== p, 60000);
    if (p.tab.page === p) return;
    const q = await c.signIn(p.tab, B);
    await c.practise(q, r.int(2, 8));
    await c.w.advance(4000);
  },
  // Page 1 saves; the network drops; the reloaded page's first read fails (rule 1); back online; a good reload.
  async "failed-load"(c) {
    const r = c.rng, S = c.student(), d = c.device(), p1 = await c.signIn(d.newTab(), S);
    await c.practise(p1, r.int(3, 8));
    await c.w.advance(4000);
    d.setNet("offline");
    await c.w.advance(r.int(200, 2000));
    const p2 = await c.reload(p1);
    await c.practise(p2, r.int(2, 6));
    await c.w.advance(r.int(0, 3000));
    d.setNet("ok");
    await c.practise(p2, r.int(0, 3));
    await c.w.advance(4000);
    const p3 = await c.reload(p2);
    await c.practise(p3, r.int(2, 6));
    await c.w.advance(4000);
  },
  // One student, two tabs on one device, different words in each.
  async "two-tabs"(c) {
    const r = c.rng, S = c.student(), d = c.device();
    const p1 = await c.signIn(d.newTab(), S);
    await c.practise(p1, r.int(1, 4), { parity: 0 });
    const p2 = await c.signIn(d.newTab(), S);
    for (let k = r.int(6, 20); k > 0; k--) {
      const two = r.chance(0.5);
      await c.answer(two ? p2 : p1, { parity: two ? 1 : 0 });
      await c.w.advance(r.int(200, 2000));
    }
    await c.w.advance(4000);
    if (r.chance(0.5)) await c.close(r.chance(0.5) ? p1 : p2);
    await c.w.advance(1000);
  },
  // A plan: finish its first list (5 right in a row on every word), reload, replay that list with misses, reload.
  async sequence(c) {
    const r = c.rng, S = c.student(r.chance(0.5) ? "plan" : "plan2"), d = c.device();
    let p = await c.signIn(d.newTab(), S);
    const first = [S.assignment.plan.steps[0].ids[0]];
    if (S.assignment.plan2 && r.chance(0.5)) first.push(S.assignment.plan2.steps[0].ids[0]);
    for (const id of first) {
      const words = Array.from(p.ctx.WordLists.wordsOf(id));
      for (let pass = 0; pass < 5; pass++) for (const word of words) {
        await c.answer(p, { lists: [id], word, correct: true });
        await c.w.advance(r.int(150, 600));
      }
    }
    await c.w.advance(4000);
    p = await c.reload(p);
    await c.practise(p, r.int(2, 6));
    const replay = Array.from(p.ctx.WordLists.wordsOf(first[0]));
    for (let k = r.int(4, 10); k > 0; k--) { await c.answer(p, { lists: [first[0]], word: r.pick(replay), correct: false }); await c.w.advance(r.int(200, 1200)); }
    await c.w.advance(4000);
    p = await c.reload(p);
    await c.practise(p, r.int(1, 4));
    await c.w.advance(4000);
  },
};

/* ── the self-test of the fake (T1-T8) ──────────────────────────────── */
async function selfTest(fault) {
  const out = [];
  const t = (id, what, ok) => out.push({ id, what, ok: !!ok });
  const c = new Case(0, "self-test", 1, { fakeFault: fault, verbose: false });
  const w = c.w, s = c.server, d = c.device(), tab = d.newTab(), p = new Page(c, tab, true);
  s.apply("x/a", { words: { k1: { n: 1, r: 1 } }, totals: { n: 1 }, recent: [1, 2] }, true);
  s.apply("x/a", { words: { k2: { n: 1, r: 0 }, k1: { n: 2 } }, recent: [3] }, true);
  const a = s.read("x/a");
  t("T1", "merge keeps other words and other fields of a word", a.words.k2 && a.words.k1 && a.words.k1.r === 1 && a.words.k1.n === 2 && a.totals.n === 1);
  t("T2", "arrays and scalars are replaced whole", JSON.stringify(a.recent) === "[3]");
  let fired = null; const t0 = w.now;
  p.ctx.setTimeout(() => { fired = vm.runInContext("Date.now()", p.ctx); }, 1000);
  await w.advance(1500);
  t("T3", "page timers and Date run on the virtual clock", fired === t0 + 1000 && vm.runInContext("new Date().getTime()", p.ctx) === w.now);
  d.user = { uid: "u1", email: "1@seq.org" };
  const db = p.firestore(); let wr = "pending", gr = null;
  d.setNet("offline");
  db.collection("students").doc("u1").set({ z: 1 }, { merge: true }).then(() => (wr = "ok"), () => (wr = "rejected"));
  db.collection("students").doc("u1").get().catch((e) => (gr = e.code));
  await w.advance(5000);
  t("T4", "offline: a write stays pending, a get rejects unavailable", wr === "pending" && gr === "unavailable" && !s.docs.has("students/u1"));
  d.setNet("ok"); await w.advance(1000);
  t("T5", "the pending write lands when the network is back", wr === "ok" && s.read("students/u1").z === 1);
  let den = null; db.collection("students").doc("u2").set({ z: 1 }, { merge: true }).catch((e) => (den = e.code)); await w.advance(1000);
  t("T6", "a write to another student's doc is permission-denied", den === "permission-denied" && !s.docs.has("students/u2"));
  d.setNet("offline"); db.collection("students").doc("u1").set({ q: 1 }, { merge: true }); p.kill(); d.setNet("ok"); await w.advance(1000);
  const tab2 = d.newTab(), p2 = new Page(c, tab2, true), db2 = p2.firestore();
  db2.collection("students").doc("u1").set({ y: 1 }, { merge: true }); await tick(); p2.kill(); await w.advance(1000);
  t("T7", "a pending write dies with its tab; one on the wire lands", s.read("students/u1").q === undefined && s.read("students/u1").y === 1);
  const p3 = new Page(c, d.newTab(), true); p3.ctx.localStorage.setItem("k", "v"); p3.ctx.sessionStorage.setItem("s", "1");
  const p4 = new Page(c, tab2, true); let so = false;
  d.setNet("offline"); p3.ctx.firebase.auth().signOut().then(() => (so = true)); await w.advance(10);
  t("T8", "localStorage is the device's, sessionStorage the tab's; signOut works offline",
    p4.ctx.localStorage.getItem("k") === "v" && p4.ctx.sessionStorage.getItem("s") === null && so && d.user === null);
  return out;
}

/* ── the run ────────────────────────────────────────────────────────── */
async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.list) {
    console.log("families: " + FAMILIES.join(", "));
    for (const [k, v] of Object.entries(FAKE_FAULTS)) console.log(`fake fault ${k}: ${v}`);
    return 0;
  }
  const started = Date.now();
  SCRIPTS = loadScripts(o.root);
  process.on("unhandledRejection", () => {});
  const fams = o.family || FAMILIES;
  let lastDone = Date.now(), where = "the self-test";
  setInterval(() => { if (Date.now() - lastDone > 120000) { process.stderr.write(`save-loop: watchdog: no case finished for 120 s (in ${where})\n`); process.exit(3); } }, 2000).unref();

  const st = await selfTest(o.fakeFault);
  const stBad = st.filter((x) => !x.ok);
  for (const x of stBad) console.log(`FAIL self-test ${x.id} ${x.what}${o.fakeFault ? ` (fake fault: ${o.fakeFault})` : ""}`);
  console.log(`save-loop: self-test of the fake ${st.length - stBad.length}/${st.length}${o.fakeFault ? ` · fake fault ON: ${o.fakeFault}` : ""}${o.rootGiven ? ` · root ${o.root}` : ""}`);

  const idx = o.case !== null ? [o.case] : [...Array(o.cases).keys()];
  const results = [], byFam = {}, byCheck = {};
  let held = 0, known = 0;
  const extra = (o.family ? ` --family=${o.family.join(",")}` : "") + (o.rootGiven ? ` --root=${o.root}` : "") + (o.fakeFault ? ` --fake-fault=${o.fakeFault}` : "");
  for (const i of idx) {
    const fam = fams[i % fams.length], seed = caseSeed(o.seed, i);
    where = `case ${i} (${fam})`;
    const c = new Case(i, fam, seed, o);
    c.w.log(`case ${i} · ${fam} · case seed ${seed}`);
    try { await FAMILY[fam](c); await c.w.advance(1000); c.finish(); }
    catch (e) { c.fail("crash", `case ${i}`, "the case runs", String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
    lastDone = Date.now();
    if (o.verbose) for (const l of c.w.lines) console.log(l);
    const fb = (byFam[fam] ||= { pass: 0, n: 0 }); fb.n++; if (!c.failures.length) fb.pass++;
    held += c.held; known += c.known.length;
    const seen = {};
    for (const f of c.failures) {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
      if (seen[f.check]++) continue;
      seen[f.check] = 1;
      const more = c.failures.filter((x) => x.check === f.check).length - 1;
      console.log(`✗ ${f.check} · seed ${o.seed} · case ${i} (${fam}, case seed ${seed}) · step: ${f.step} · expected ${f.expected} · stored ${f.stored}` +
        `${more ? ` (+${more} more ${f.check} in this case)` : ""} · replay: node tools/save-loop.mjs --seed=${o.seed} --case=${i}${extra} --verbose`);
    }
    for (const k of c.known) console.log(`~ known ${k.id} (two-tabs totals are last-writer-wins) · case ${i} · ${k.step} · answered ${k.expected} · stored ${k.stored}`);
    results.push({ case: i, family: fam, seed, pass: !c.failures.length, held: c.held, failures: c.failures, known: c.known,
      answers: c.answers.length, writes: c.writes.length, landed: c.writes.filter((x) => x.state === "landed").length,
      docs: Object.fromEntries(c.students.map((s) => [s.uid, c.server.read(`students/${s.uid}`) || null])) });
  }
  const tot = (k) => results.reduce((a, r) => a + r[k], 0);
  console.log(`  by family: ${Object.entries(byFam).map(([f, v]) => `${f} ${v.pass}/${v.n}`).join(" · ")}`);
  console.log(`  ${tot("answers")} answers · ${tot("writes")} writes issued, ${tot("landed")} landed · ${known} known (K1) lines`);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ seed: o.seed, root: o.root, fakeFault: o.fakeFault, selfTest: st, results }, null, 1));
  const failed = results.filter((r) => !r.pass).length;
  const fl = Object.keys(byCheck).sort().map((k) => `${k} ${byCheck[k]}`).join(" · ") || "none";
  console.log(`save-loop: ${results.length} cases (seed ${o.seed}) · ${results.length - failed} pass · ${held} checks held · self-test ${st.length - stBad.length}/${st.length} · failures: ${fl}`);
  process.stderr.write(`save-loop: ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
  return failed || stBad.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { process.stderr.write(`save-loop: crashed: ${e && e.stack || e}\n`); process.exit(2); });
