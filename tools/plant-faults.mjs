#!/usr/bin/env node
/* plant-faults.mjs — prove the closed loops have teeth.

     node tools/plant-faults.mjs [--list] [--only=id,id]

   Copies the repo to a scratch folder, plants one mistake at a time (the
   `find` text, which must occur exactly once, becomes `replace`), runs the
   loop that should notice, and puts the file back. The loop must go RED
   (exit 1): CAUGHT. Anything else GOT THROUGH, which means a missing test.
   A `find` that no longer occurs exactly once is STALE: the code moved on,
   so update the table.

   The emulator faults need the emulators (GitHub runs them); --list only
   checks that every `find` still occurs once and runs nothing.
   Exit 1 if anything got through or is stale, or a loop fails unplanted. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emu = (only) => ["tools/emu-loop.mjs", `--only=${only}`];

const FAULTS = [
  { id: "domain-check-off", file: "auth.js", run: emu("turned away"),
    find: 'return String(email || "").toLowerCase().slice(-(DOMAIN.length + 1)) !== "@" + DOMAIN;', replace: "return false;",
    why: "the page lets any Google account past the sign-in screen" },
  { id: "rules-domain-loose", file: "firestore.rules", run: emu("rules agree"),
    find: "request.auth.token.email.matches('^[^@]+@seq[.]org$')", replace: "request.auth.token.email.matches('.*seq.*')",
    why: "the database accepts look-alike addresses" },
  { id: "rules-unverified-ok", file: "firestore.rules", run: emu("rules agree"),
    find: "&& request.auth.token.email_verified == true\n", replace: "\n",
    why: "the database accepts an address nobody has proved is theirs" },
  { id: "rules-student-reads-anyone", file: "firestore.rules", run: emu("rules agree"),
    find: "allow read: if isSchool() && request.auth.uid == userId;", replace: "allow read: if isSchool();",
    why: "a student can read a classmate's practice record" },
  { id: "rules-student-reads-note", file: "firestore.rules", run: emu("rules agree"),
    find: "match /notes/{userId} {", replace: "match /notes/{userId} {\n      allow get: if isSchool() && request.auth.uid == userId;",
    why: "a student can read the private note about them" },
  { id: "sign-out-does-not-save", file: "auth.js", run: emu("survives reload"),
    find: "var flush = (window.EIStore && window.EIStore.flush) ? window.EIStore.flush() : Promise.resolve();", replace: "var flush = Promise.resolve();",
    why: "the last answers before Sign out are lost" },
  { id: "save-overwrites", file: "store.js", run: emu("survives reload"),
    find: 'write = db.collection("students").doc(uid).set(body, { merge:true });', replace: 'write = db.collection("students").doc(uid).set(body);',
    why: "each save wipes the words saved before it" },
  { id: "class-not-copied", file: "store.js", run: emu("add, give games"),
    find: "if(dirtyClass){ p.classId = dirtyClass.classId; p.teachers = dirtyClass.teachers; }", replace: "",
    why: "a signed-in student never joins the teacher's class, so the teacher cannot see them" },
  { id: "note-without-class", file: "teacher.js", run: emu("who can read what"),
    find: "var body = withStamp({ text: text, updatedAt: Date.now() }, uid);", replace: "var body = { text: text, updatedAt: Date.now() };",
    why: "the rules refuse a new note, which only shows as a small line" },
  { id: "shared-missed-pile", file: "game-core.js", run: emu("missed words"),
    find: 'return kind + "Comeback:" + (who ? who + ":" : "") + listId;', replace: 'return kind + "Comeback:" + listId;',
    why: "the next student on a shared computer is offered the last one's missed words" },
  { id: "csv-drops-note", file: "teacher.js", run: emu("spreadsheets"),
    find: 's.pending ? "no" : "yes", noteOf(s.uid)', replace: 's.pending ? "no" : "yes", ""',
    why: "the roster spreadsheet silently leaves out the notes" },
  { id: "backup-drops-notes", file: "teacher.js", run: emu("backup equals"),
    find: "cols.forEach(function(c, i){ out[c] = r[i]; });", replace: 'cols.forEach(function(c, i){ out[c] = c === "notes" ? {} : r[i]; });',
    why: "the backup looks complete and has no notes in it" },
];

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const list = args.includes("--list");
const chosen = FAULTS.filter((f) => !only.length || only.includes(f.id));
const count = (text, find) => text.split(find).length - 1;

if (list) {
  let stale = 0;
  for (const f of chosen) {
    const n = count(fs.readFileSync(path.join(ROOT, f.file), "utf8"), f.find);
    if (n !== 1) stale++;
    console.log(`${n === 1 ? "ok   " : "STALE"} ${f.id}  (${f.file}) ${f.why}`);
  }
  process.exit(stale ? 1 : 0);
}

const copy = fs.mkdtempSync(path.join(os.tmpdir(), "ei-faults-"));
fs.cpSync(ROOT, copy, { recursive: true, filter: (src) => !/^(\.git|\.claude|node_modules)(\/|$)/.test(path.relative(ROOT, src)) });
const run = (cmd) => spawnSync(process.execPath, [...cmd, `--root=${copy}`], { cwd: ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 1 << 26 });

let bad = 0;
/* A loop that is already red on the clean copy proves nothing about a fault. */
const clean = new Map();
for (const f of chosen) {
  const key = f.run.join(" ");
  if (!clean.has(key)) {
    const r = run(f.run);
    clean.set(key, r.status === 0);
    if (r.status !== 0) console.log(`FAIL unplanted: ${key}\n${(r.stdout || "").trim().split("\n").slice(-4).join("\n")}`);
  }
  if (!clean.get(key)) { bad++; console.log(`GOT THROUGH ${f.id}: its loop is red without the fault, so nothing was proved`); continue; }
  const file = path.join(copy, f.file), original = fs.readFileSync(file, "utf8");
  if (count(original, f.find) !== 1) { bad++; console.log(`STALE ${f.id}: the text to replace occurs ${count(original, f.find)} times in ${f.file}`); continue; }
  fs.writeFileSync(file, original.replace(f.find, () => f.replace));
  const r = run(f.run);
  fs.writeFileSync(file, original);
  if (r.status === 1) console.log(`CAUGHT ${f.id}: ${f.why}`);
  else { bad++; console.log(`GOT THROUGH ${f.id} (exit ${r.status}): ${f.why}`); }
}
fs.rmSync(copy, { recursive: true, force: true });
const line = bad ? `${bad} of ${chosen.length} planted mistakes were NOT caught` : `all ${chosen.length} planted mistakes were caught`;
console.log(line);
if (process.env.GITHUB_ACTIONS && bad) console.log(`::error title=planted faults::${line}`);
process.exit(bad ? 1 : 0);
