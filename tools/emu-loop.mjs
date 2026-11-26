#!/usr/bin/env node
/* emu-loop.mjs — closed loops against the Firebase emulators.

     node tools/emu-loop.mjs [--only=text] [--root=DIR] [--list] [--verbose]

   Each loop does something through the site's own pages, then reads the
   result back another way (the stored document, the rules as a different
   person, the downloaded file, a second computer) and compares.

   It runs on GitHub (.github/workflows/emulator.yml), inside
   "firebase emulators:exec --only auth,firestore --project demo-ei".
   Nothing for it is installed on the teacher's Mac, and nothing in it can
   reach the real Firebase project.

   Loops live in tools/emu/*.loop.mjs: each exports
   `loops = [{ name, run(t) }]`. A loop gets an empty database with the
   repo's rules loaded, and t.computer("name") for each computer it needs.

   Exit 0 = every loop held; 1 = a loop failed; 2 = it could not run.
   Never weaken a loop to make it pass: a failing loop is a real gap. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, Backend, serveSite, launchBrowser, computer } from "./emu/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const a = args.find((x) => x === `--${n}` || x.startsWith(`--${n}=`)); return a === undefined ? undefined : a.slice(n.length + 3); };
for (const a of args) if (!/^--(only=.+|root=.+|list|verbose)$/.test(a)) { console.error(`emu-loop: unknown flag ${a}`); process.exit(2); }
const only = flag("only"), root = path.resolve(flag("root") || ROOT), verbose = flag("verbose") !== undefined;
const LIMIT_MS = 180000;   // per loop
const onGitHub = !!process.env.GITHUB_ACTIONS;

const all = [];
for (const f of fs.readdirSync(path.join(HERE, "emu")).filter((f) => f.endsWith(".loop.mjs")).sort()) {
  const m = await import(pathToFileURL(path.join(HERE, "emu", f)).href);
  for (const l of m.loops || []) all.push({ ...l, file: f });
}
if (flag("list") !== undefined) { for (const l of all) console.log(`${l.file}  ${l.name}`); process.exit(0); }
const chosen = all.filter((l) => !only || only.split(",").some((o) => (l.name + " " + l.file).toLowerCase().includes(o.toLowerCase())));
if (!chosen.length) { console.error(`emu-loop: no loop matches "${only}"`); process.exit(2); }

let backend, site, browser;
try {
  backend = new Backend(root);
  await backend.reset();
  site = await serveSite(root);
  browser = await launchBrowser();
} catch (e) {
  console.error("emu-loop: could not start: " + e.message);
  if (onGitHub) console.log(`::error title=emu-loop::could not start: ${e.message.replace(/\n/g, " ")}`);
  process.exit(2);
}

const failed = [];
for (const loop of chosen) {
  const started = Date.now(), computers = [];
  let timer;
  const t = {
    backend, base: site.base,
    async computer(name) { const c = await computer(browser, site.base, name); computers.push(c); return c; },
    note(msg) { if (verbose) console.log("      " + msg); },
  };
  try {
    await backend.reset();
    await Promise.race([
      loop.run(t),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`still running after ${LIMIT_MS / 1000} s`)), LIMIT_MS); }),
    ]);
    const asked = computers.flatMap((c) => c.forbidden);
    if (asked.length) throw new Error("a page asked for a real Google or Firebase address: " + asked[0]);
    console.log(`PASS: ${loop.name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed.push(loop.name);
    const msg = String(e.message || e).replace(/\r?\n/g, " ");
    console.log(`FAIL: ${loop.name}: ${msg}`);
    const tails = computers.flatMap((c) => c.log.slice(-6).map((l) => `${c.name}: ${l}`));
    for (const l of tails) console.log("      | " + l);
    if (onGitHub) console.log(`::error title=${loop.name}::${msg} || ${tails.join(" | ").slice(0, 1500)}`.replace(/%/g, "%25"));
  } finally {
    clearTimeout(timer);
    for (const c of computers) await c.close().catch(() => {});
  }
}
browser.close();
site.close();
const last = failed.length ? `${failed.length} of ${chosen.length} emulator loops FAILED: ${failed.join("; ")}` : `all ${chosen.length} emulator loops held`;
console.log(last);
process.exit(failed.length ? 1 : 0);
