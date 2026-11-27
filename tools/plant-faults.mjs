#!/usr/bin/env node
/* plant-faults.mjs — prove the closed loops have teeth.

     node tools/plant-faults.mjs [--list] [--only=id,id]

   Copies the repo to a scratch folder, plants one mistake at a time (the
   `find` text, which must occur exactly once, becomes `replace`), runs the
   loop that should notice, and puts the file back. The loop must go RED
   (exit 1): CAUGHT. Anything else GOT THROUGH, which means a missing test.
   A `find` that no longer occurs exactly once is STALE: the code moved on,
   so update the table.

   The emulator faults need the emulators (GitHub runs them); the sequence
   loop's need only a Chrome (--only=played-way-closes,ways-out-of-order runs
   them anywhere). --list only checks that every `find` still occurs once and
   runs nothing.
   Exit 1 if anything got through or is stale, or a loop fails unplanted. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emu = (only) => ["tools/emu-loop.mjs", `--only=${only}`];
/* The sequence loop needs no emulator, only a Chrome (CHROME=…). Six one-sequence cases: that family opens with
   Red Words given, its first way finished, the next one played, then the first slipping below the bar. */
const seq = ["tools/sequence-loop.mjs", "--family=one-sequence", "--cases=6"];

const FAULTS = [
  { id: "domain-check-off", expect: "school account", file: "auth.js", run: emu("turned away"),
    find: 'return String(email || "").toLowerCase().slice(-(DOMAIN.length + 1)) !== "@" + DOMAIN;', replace: "return false;",
    why: "the page lets any Google account past the sign-in screen" },
  { id: "rules-domain-loose", expect: "can read", file: "firestore.rules", run: emu("rules agree"),
    find: "request.auth.token.email.matches('^[^@]+@seq[.]org$')", replace: "request.auth.token.email.matches('.*seq.*')",
    why: "the database accepts look-alike addresses" },
  { id: "rules-unverified-ok", expect: "can read", file: "firestore.rules", run: emu("rules agree"),
    find: "&& request.auth.token.email_verified == true\n", replace: "\n",
    why: "the database accepts an address nobody has proved is theirs" },
  { id: "rules-student-reads-anyone", expect: "can read another student", file: "firestore.rules", run: emu("rules agree"),
    find: "allow read: if isSchool() && request.auth.uid == userId;", replace: "allow read: if isSchool();",
    why: "a student can read a classmate's practice record" },
  { id: "rules-student-reads-note", expect: "private note", file: "firestore.rules", run: emu("rules agree"),
    find: "match /notes/{userId} {", replace: "match /notes/{userId} {\n      allow get: if isSchool() && request.auth.uid == userId;",
    why: "a student can read the private note about them" },
  { id: "sign-out-does-not-save", expect: "sign-out", file: "auth.js", run: emu("survives reload"),
    find: "var flush = (window.EIStore && window.EIStore.flush) ? window.EIStore.flush() : Promise.resolve();", replace: "var flush = Promise.resolve();",
    why: "the last answers before Sign out are lost" },
  { id: "save-overwrites", expect: "stored", file: "store.js", run: emu("survives reload"),
    find: 'write = db.collection("students").doc(uid).set(body, { merge:true });', replace: 'write = db.collection("students").doc(uid).set(body);',
    why: "each save wipes the words saved before it" },
  { id: "class-not-copied", expect: "class", file: "store.js", run: emu("add, give games"),
    find: "if(dirtyClass){ p.classId = dirtyClass.classId; p.teachers = dirtyClass.teachers; }", replace: "",
    why: "a signed-in student never joins the teacher's class, so the teacher cannot see them" },
  { id: "note-without-class", expect: "note to be saved", file: "teacher.js", run: emu("who can read what"),
    find: "var body = withStamp({ text: text, updatedAt: Date.now() }, uid);", replace: "var body = { text: text, updatedAt: Date.now() };",
    why: "the rules refuse a new note, which only shows as a small line" },
  { id: "shared-missed-pile", expect: "Ben is offered", file: "game-core.js", run: emu("missed words"),
    find: 'return kind + "Comeback:" + (who ? who + ":" : "") + listId;', replace: 'return kind + "Comeback:" + listId;',
    why: "the next student on a shared computer is offered the last one's missed words" },
  { id: "match-own-pile-key", expect: "match-game.html", file: "match-game.js", run: emu("each game keeps"),
    find: 'var comebackKey = Core.comebackKey("match", cfg.listId || location.pathname);', replace: 'var comebackKey = "matchComeback:" + (cfg.listId || location.pathname);',
    why: "one game goes back to a pile shared by everyone on the computer" },
  { id: "shared-local-copy", expect: "Ben's page holds", file: "store.js", run: emu("gets none of it"),
    edits: [['localStorage.getItem(LOCAL_KEY + uid)', 'localStorage.getItem(LOCAL_KEY)'], ['localStorage.setItem(LOCAL_KEY + uid,', 'localStorage.setItem(LOCAL_KEY,']],
    why: "the next student on a shared computer starts with the last one's numbers" },
  { id: "student-view-saves", expect: "after a look", file: "store.js", run: emu("looks without writing"),
    edits: [["function record(listId, word, correct, ms, kind){\n    if(!uid || preview) return;", "function record(listId, word, correct, ms, kind){\n    if(!uid) return;"],
      ["function scheduleSave(){\n    if(loadFailed || preview ||", "function scheduleSave(){\n    if(loadFailed ||"],
      ["clearTimeout(saveTimer); saveTimer = null;\n    if(loadFailed || preview ||", "clearTimeout(saveTimer); saveTimer = null;\n    if(loadFailed ||"]],
    why: "playing inside Student view writes to a record" },
  { id: "test-student-keeps-pile", expect: "missed words to be forgotten", file: "teacher.js", run: emu("test student"),
    find: 'k.indexOf("Comeback:" + meUid + ":") !== -1) localStorage.removeItem(k);', replace: 'false) localStorage.removeItem(k);',
    why: "a removed test student still has its missed words" },
  { id: "csv-drops-note", expect: "the note for", file: "teacher.js", run: emu("spreadsheets"),
    find: 's.pending ? "no" : "yes", noteOf(s.uid)', replace: 's.pending ? "no" : "yes", ""',
    why: "the roster spreadsheet silently leaves out the notes" },
  { id: "backup-drops-notes", expect: "notes in the backup", file: "teacher.js", run: emu("backup equals"),
    find: "cols.forEach(function(c, i){ out[c] = r[i]; });", replace: 'cols.forEach(function(c, i){ out[c] = c === "notes" ? {} : r[i]; });',
    why: "the backup looks complete and has no notes in it" },
  { id: "played-way-closes", expect: "a way they played disappeared", file: "adaptive.js", run: seq,
    find: "if(reached || playedAny(stats, id)) out.push(id);", replace: "if(reached) out.push(id);",
    why: "a way of playing the student has already played disappears when a word slips out of the top box" },
  { id: "ways-out-of-order", expect: "teaching order", file: "word-lists.js", run: seq,
    find: "    return inTeachingOrder(out);\n  }", replace: "    return out;\n  }",
    why: "the dashboard writes a step's ways in the order they were ticked, not the order the student should meet them" },
];

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const list = args.includes("--list");
const chosen = FAULTS.filter((f) => !only.length || only.includes(f.id));
const count = (text, find) => text.split(find).length - 1;
/* A fault is one find/replace, or several that only make sense together. */
const editsOf = (f) => f.edits || [[f.find, f.replace]];

if (list) {
  let stale = 0;
  for (const f of chosen) {
    const text = fs.readFileSync(path.join(ROOT, f.file), "utf8");
    const ok = editsOf(f).every(([find]) => count(text, find) === 1);
    if (!ok) stale++;
    console.log(`${ok ? "ok   " : "STALE"} ${f.id}  (${f.file}) ${f.why}`);
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
  if (!editsOf(f).every(([find]) => count(original, find) === 1)) { bad++; console.log(`STALE ${f.id}: a line to replace no longer occurs exactly once in ${f.file}`); continue; }
  fs.writeFileSync(file, editsOf(f).reduce((text, [find, replace]) => text.replace(find, () => replace), original));
  const r = run(f.run);
  fs.writeFileSync(file, original);
  /* Red is not enough: it has to be red for this mistake's reason, or a flake or a broken page would "prove" the loop. */
  // The emulator loops print "FAIL …"; the sequence loop prints "✗ <check> …".
  const fails = (r.stdout || "").split("\n").filter((l) => l.startsWith("FAIL") || l.startsWith("✗ "));
  if (r.status === 1 && fails.some((l) => l.includes(f.expect))) console.log(`CAUGHT ${f.id}: ${f.why}`);
  else { bad++; console.log(`GOT THROUGH ${f.id} (exit ${r.status}${fails.length ? ", red for another reason: " + fails[0].slice(0, 200) : ""}): ${f.why}`); }
}
fs.rmSync(copy, { recursive: true, force: true });
const line = bad ? `${bad} of ${chosen.length} planted mistakes were NOT caught` : `all ${chosen.length} planted mistakes were caught`;
console.log(line);
if (process.env.GITHUB_ACTIONS && bad) console.log(`::error title=planted faults::${line}`);
process.exit(bad ? 1 : 0);
