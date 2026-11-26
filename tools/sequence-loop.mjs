#!/usr/bin/env node
/* sequence-loop.mjs — closed loop: what the dashboard says about a student's sequences, and what the student sees.

     node tools/sequence-loop.mjs [options]

   THE QUESTION. When a teacher gives, changes and removes sequences on the dashboard, and students practise, do the
   teacher's dashboard and the student's own home page AGREE about which list the student is on, which lists they can
   play and which are finished — for one sequence and for two at once — and is that the answer the written rules
   (README "Sequences", "A student's page", "The class page", "Saved sequences") give?

   WHEN TO RUN IT. After any change to teacher.js (the sequence editor, Save, Stop, Give a sequence, the Students
   rows), to store.js (resolve, settle, the marks, plan()), to adaptive.js (planState, planPosition, sanitizePlans,
   listSolid, stepNeed, isMastered), or to practice.js (the home page: renderHome, planNotice, the finished fold).
   About 70-90 s for the default 56 cases on two cores. Needs Node 22 and a Chrome (CHROME=…, else chromium,
   google-chrome or chrome on the PATH); no dependencies, no network, no server of your own — it serves the site
   itself on a free localhost port.

   FLAGS (each --name=value; an unknown flag is exit 2)
     --cases=N          how many cases (default 56); family round robin, each case its own seed
     --seed=S           base seed (default 1); the same seed gives the same stdout byte for byte
     --case=I           run only case I (with --verbose: its whole timeline — every action, read and compare)
     --family=a,b       only these families (names: --list); the round robin is over these
     --root=DIR         serve the site from another folder (a fixed copy, or one with a planted fault); the harness
                        pages always come from this tool's own folder
     --fake-fault=NAME  break the FAKE on purpose (names: --list): the self-test and the run must go red
     --json=FILE        every case's result and its failures, as JSON
     --jobs=N           Chromes at once (default: the number of cores, at most 4)
     --verbose          the timeline of each case run
     --list             the families and the fake faults
   Exit 0 = every check held (KNOWN lines excepted); 1 = a check failed, or the fake failed its self-test; 2 = bad
   arguments or the tool crashed; 3 = watchdog (no case finished for 120 real seconds). stdout is deterministic; the
   run time goes to stderr. The last stdout line is the summary: cases, checks held, failures by check id.

   THE SHAPE, and why. teacher.js renders with innerHTML and delegated listeners, and practice.js builds the home
   page with createElement, so both need a real DOM; they also need one shared database, so both pages must run in
   one browser. This file is the outside: a tiny HTTP server over the site (and over --root), and headless Chrome,
   one per batch of cases, on tools/sequence-loop.html. Everything else happens in that page
   (tools/sequence-loop.js): it holds the ONE fake Firestore and Auth, opens the REAL teacher.html, the REAL
   index.html for each student, and index.html?preview=… for the Student view, each in a same-origin iframe, drives
   the teacher's own buttons and the students' EIStore.record, keeps the answer key, runs the checks, and posts each
   case's result back here. The pages are served exactly as they are on disk except that the two gstatic <script>
   tags (firebase-app-compat, firebase-auth-compat) become one <script src="/tools/sequence-loop-fake.js">, which
   hands the page the harness's fake `firebase`; each page keeps its own Content-Security-Policy (teacher.html's
   forbids inline script, and nothing here needs it). Pages are fetched by their real URLs (/index.html?preview=…),
   so location.search, reload() and the CSPs behave as on the live site. Chrome runs with --virtual-time-budget, so
   store.js's 1.2 s debounce and every wait cost no real time.

   WHAT IS REAL. firebase-config.js, auth.js, adaptive.js, word-lists.js, store.js, practice.js and the inline script
   of index.html on the student's side; firebase-config.js, auth.js, adaptive.js, game-core.js, word-lists.js and
   teacher.js on the teacher's, with teacher.html's own markup. The teacher acts only through the dashboard's own
   controls (see tools/sequence-loop.js, "the teacher's hands"), and every write goes through teacher.js's own write
   path (commitBodies → commitWrites → batch.commit). The student acts through EIStore.record on their own home page
   and the page's own pagehide flush.

   WHAT IS FAKE (self-tested at the start of every batch: T1-T10) — see the header of tools/sequence-loop.js.

   THE CHECKS (S1-S9) and THE FAMILIES — see the header of tools/sequence-loop.js; `--list` names them.

   KNOWN (printed as "~ known", not failed) — see KNOWN in tools/sequence-loop.js.
*/

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Kept in step with FAMILIES and FAKE_FAULTS in tools/sequence-loop.js (the self-test checks the names agree).
const FAMILIES = ["one-sequence", "two-sequences", "teacher-steps-in", "re-plan", "bulk", "roster-first", "stop"];
const FAKE_FAULTS = {
  merge: "set(…, {merge:true}) replaces top-level maps instead of merging them (a save of one word wipes the rest)",
  delete: "FieldValue.delete() is ignored: the field stays (a stopped sequence is never removed)",
  where: "where('teachers', 'array-contains', me) matches nothing (the dashboard sees no student)",
};
const HARNESS_FILES = new Set(["sequence-loop.html", "sequence-loop.js", "sequence-loop-fake.js"]);
const BATCH = 4;                       // cases per Chrome
const WATCHDOG_MS = 120000;
const VT_PER_CASE_MS = 3 * 3600 * 1000;   // virtual time each case may use; far more than any case needs

/* ── arguments ─────────────────────────────────────────────────────── */
function usage(msg) {
  process.stderr.write(`sequence-loop: ${msg}\nflags: --cases=N --seed=S --case=I --family=a,b --root=DIR ` +
    `--fake-fault=NAME --json=FILE --jobs=N --verbose --list\n`);
  process.exit(2);
}
function parseArgs(argv) {
  const o = { cases: 56, seed: 1, case: null, family: null, root: path.resolve(HERE, ".."), fakeFault: null,
              json: null, verbose: false, list: false, rootGiven: false, jobs: Math.max(1, Math.min(4, os.cpus().length)) };
  const int = (k, v) => { if (!/^\d+$/.test(v || "")) usage(`--${k} needs a whole number`); return +v; };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) usage(`not a flag: ${a}`);
    const [, k, v] = m;
    if (k === "cases") o.cases = int(k, v);
    else if (k === "seed") o.seed = int(k, v);
    else if (k === "case") o.case = int(k, v);
    else if (k === "jobs") { o.jobs = int(k, v); if (!o.jobs) usage("--jobs needs at least 1"); }
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

/* ── randomness: the same per-case seeds as save-loop ────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const caseSeed = (base, i) => (Math.floor(mulberry32(base * 1000003 + i * 7919 + 17)() * 4294967296) >>> 0);

/* ── the server: the site from ROOT, the harness from HERE ──────────── */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg",
  ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".txt": "text/plain" };
const GSTATIC = /<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-(app|auth)-compat\.js"><\/script>/g;

/* A page of the site exactly as on disk, but with the two Firebase SDK tags replaced by the fake. Anything else
   (a third gstatic tag, a page without them) is served unchanged and the harness's T10 says so. */
function rewritePage(html) {
  let n = 0;
  const out = html.replace(GSTATIC, (m, which) => { n++; return which === "app" ? '<script src="/tools/sequence-loop-fake.js"></script>' : ""; });
  return n === 2 ? out : html;
}

function serve(o, onReport) {
  const root = o.root;
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (req.method === "POST" && u.pathname === "/__seq/report") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (c) => { body += c; });
        req.on("end", () => { try { onReport(JSON.parse(body)); } catch (e) { onReport({ bad: String(e) }); } res.writeHead(204); res.end(); });
        return;
      }
      let p;
      try { p = decodeURIComponent(u.pathname); } catch (e) { res.writeHead(400); return res.end(); }
      let file;
      const base = path.basename(p);
      if (p.startsWith("/tools/") && HARNESS_FILES.has(base) && path.dirname(p) === "/tools") file = path.join(HERE, base);
      else {
        file = path.join(root, path.normalize(p === "/" ? "/index.html" : p));
        if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end(); }
        const ext = path.extname(file);
        if (ext === ".html" && path.dirname(file) === root) data = Buffer.from(rewritePage(data.toString("utf8")));
        res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "max-age=3600" });
        res.end(data);
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of ["chromium", "google-chrome", "chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"]) {
    const r = spawnSync("sh", ["-c", `command -v "${c}" || ([ -x "${c}" ] && echo "${c}")`], { encoding: "utf8" });
    if (r.stdout && r.stdout.trim()) return r.stdout.trim().split("\n")[0];
  }
  return null;
}

/* ── one Chrome per batch ────────────────────────────────────────────── */
function runBatch(chrome, port, batch, o, tmpRoot) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "b"));
    const q = new URLSearchParams({
      batch: String(batch.id), seed: String(o.seed),
      cases: batch.jobs.map((j) => `${j.i}:${j.fam}:${j.seed}`).join(","),
      fault: o.fakeFault || "", verbose: o.verbose ? "1" : "",
    });
    const url = `http://localhost:${port}/tools/sequence-loop.html?${q}`;
    const budget = VT_PER_CASE_MS * (batch.jobs.length + 1);
    const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-background-networking", "--mute-audio", `--user-data-dir=${dir}`,
      "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1",
      "--window-size=1366,900", `--virtual-time-budget=${budget}`, "--dump-dom", url];
    const ch = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ch.stderr.on("data", (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    ch.on("error", (e) => resolve({ code: -1, err: String(e) }));
    ch.on("exit", (code) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} resolve({ code, err }); });
    batch.proc = ch;
  });
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
  if (!fs.existsSync(path.join(o.root, "teacher.html")) || !fs.existsSync(path.join(o.root, "index.html"))) usage(`no site in ${o.root}`);
  const chrome = findChrome();
  if (!chrome) { process.stderr.write("sequence-loop: no Chrome found (set CHROME=…)\n"); return 2; }
  const fams = o.family || FAMILIES;
  const extra = (o.family ? ` --family=${o.family.join(",")}` : "") + (o.rootGiven ? ` --root=${o.root}` : "") +
    (o.fakeFault ? ` --fake-fault=${o.fakeFault}` : "");
  const jobs = (o.case !== null ? [o.case] : [...Array(o.cases).keys()]).map((i) =>
    ({ i, fam: fams[i % fams.length], seed: caseSeed(o.seed, i), replay: `--seed=${o.seed} --case=${i}${extra}` }));
  const batches = [];
  for (let k = 0; k < jobs.length; k += BATCH) batches.push({ id: batches.length, jobs: jobs.slice(k, k + BATCH) });

  const results = new Map(), selfTests = [];
  let lastDone = Date.now(), fatal = null;
  const srv = await serve(o, (r) => {
    if (r.bad) { fatal = fatal || `a report that does not parse: ${r.bad}`; return; }
    if (r.kind === "selftest") selfTests.push(r);
    else if (r.kind === "case") { results.set(r.case, r); lastDone = Date.now(); }
  });
  const port = srv.address().port;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "seqloop-"));
  const watchdog = setInterval(() => {
    if (Date.now() - lastDone > WATCHDOG_MS) {
      process.stderr.write(`sequence-loop: watchdog: no case finished for ${WATCHDOG_MS / 1000} s\n`);
      for (const b of batches) if (b.proc) try { b.proc.kill("SIGKILL"); } catch (e) {}
      process.exit(3);
    }
  }, 2000);
  watchdog.unref();

  const queue = batches.slice(), exits = [];
  async function worker() {
    for (;;) {
      const b = queue.shift();
      if (!b) return;
      const r = await runBatch(chrome, port, b, o, tmpRoot);
      exits.push({ b, r });
    }
  }
  await Promise.all([...Array(Math.min(o.jobs, batches.length)).keys()].map(worker));
  clearInterval(watchdog);
  srv.close();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}

  // The self-test: every batch runs it; they must all say the same, so the first one speaks for them.
  const st = selfTests.sort((a, b) => a.batch - b.batch)[0];
  const stBad = st ? st.tests.filter((x) => !x.ok) : [{ id: "T0", what: "the harness page ran its self-test", ok: false }];
  for (const x of stBad) console.log(`FAIL self-test ${x.id} ${x.what}${x.got ? ` — ${x.got}` : ""}${o.fakeFault ? ` (fake fault: ${o.fakeFault})` : ""}`);
  const nT = st ? st.tests.length : 0;
  console.log(`sequence-loop: self-test of the fake ${nT - (st ? stBad.length : 0)}/${nT}${o.fakeFault ? ` · fake fault ON: ${o.fakeFault}` : ""}${o.rootGiven ? ` · root ${o.root}` : ""}`);
  if (selfTests.some((s) => JSON.stringify(s.tests) !== JSON.stringify(st.tests))) console.log("FAIL self-test: the batches' self-tests disagree");

  const byFam = {}, byCheck = {}, out = [];
  let held = 0, known = 0, crashed = 0;
  for (const j of jobs) {
    let r = results.get(j.i);
    if (!r) {
      const ex = exits.find((e) => e.b.jobs.includes(j));
      const tail = ex ? (ex.r.err || "").split("\n").filter((l) => /Uncaught|ERROR|Error/.test(l)).slice(-2).join(" | ") : "";
      r = { case: j.i, family: j.fam, seed: j.seed, held: 0, known: [], lines: [], steps: 0,
            failures: [{ check: "crash", step: `case ${j.i}`, expected: "the case runs to the end", got: `no result from Chrome (exit ${ex ? ex.r.code : "?"})${tail ? ": " + tail.slice(0, 300) : ""}` }] };
      crashed++;
    }
    if (o.verbose) for (const l of r.lines || []) console.log(l);
    const fb = (byFam[j.fam] ||= { pass: 0, n: 0 }); fb.n++; if (!r.failures.length) fb.pass++;
    held += r.held; known += r.known.length;
    const seen = {};
    for (const f of r.failures) {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
      if (seen[f.check]) continue;
      seen[f.check] = 1;
      const more = r.failures.filter((x) => x.check === f.check).length - 1;
      console.log(`✗ ${f.check} · seed ${o.seed} · case ${j.i} (${j.fam}, case seed ${j.seed}) · step: ${f.step} · expected ${f.expected} · got ${f.got}` +
        `${more ? ` (+${more} more ${f.check} in this case)` : ""} · replay: node tools/sequence-loop.mjs ${j.replay} --verbose`);
    }
    const kseen = {};
    for (const k of r.known) {
      if (kseen[k.id]) continue;
      kseen[k.id] = 1;
      const more = r.known.filter((x) => x.id === k.id).length - 1;
      console.log(`~ known ${k.id} (${k.title}) · case ${j.i} (${j.fam}) · step: ${k.step} · expected ${k.expected} · got ${k.got}` +
        `${more ? ` (+${more} more)` : ""} · replay: node tools/sequence-loop.mjs ${j.replay} --verbose`);
    }
    out.push(r);
  }
  const tot = (k) => out.reduce((a, r) => a + (r[k] || 0), 0);
  console.log(`  by family: ${Object.entries(byFam).map(([f, v]) => `${f} ${v.pass}/${v.n}`).join(" · ")}`);
  console.log(`  ${tot("steps")} steps · ${tot("teacherActions")} teacher actions · ${tot("answers")} answers · ${tot("homeLoads")} home pages · ${tot("previews")} previews · ${known} known lines`);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ seed: o.seed, root: o.root, fakeFault: o.fakeFault, selfTest: st || null,
    results: out.map((r) => ({ ...r, lines: undefined })) }, null, 1));
  const failed = out.filter((r) => r.failures.length).length;
  const fl = Object.keys(byCheck).sort().map((k) => `${k} ${byCheck[k]}`).join(" · ") || "none";
  console.log(`sequence-loop: ${out.length} cases (seed ${o.seed}) · ${out.length - failed} pass · ${held} checks held · self-test ${nT - (st ? stBad.length : 0)}/${nT} · failures: ${fl}`);
  process.stderr.write(`sequence-loop: ${((Date.now() - started) / 1000).toFixed(1)} s${fatal ? ` (${fatal})` : ""}\n`);
  if (fatal) return 2;
  return failed || stBad.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { process.stderr.write(`sequence-loop: crashed: ${e && e.stack || e}\n`); process.exit(2); });
