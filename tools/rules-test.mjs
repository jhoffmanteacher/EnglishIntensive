/* ════════════════════════════════════════════════════════════════════
   tools/rules-test.mjs — firestore.rules against the Firestore emulator.

   tests.html can't touch the rules: they run on Google's servers, and
   they are the only thing that actually decides who reads what. This
   runs the real file in the local emulator and checks the claims the
   multi-teacher model rests on — one teacher can't read another's
   students, a list query with where('teacher','==',me) is allowed, a
   student can set their own `teacher` only to what their roster row
   says, the admin can move a student, nobody else can add a teacher.

   Not part of the site and not needed to run it. Two dependencies, kept
   OUT of the repo (there is no package.json here on purpose):

     # once, anywhere — e.g. a scratch folder
     npm i firebase-tools @firebase/rules-unit-testing firebase
     # then, from the repo root (needs Java 11+ for the emulator)
     RULES_TEST_DEPS=/path/to/that/folder \
       /path/to/that/folder/node_modules/.bin/firebase emulators:exec \
       --only firestore --project demo-ei "node tools/rules-test.mjs"

   Prints one line per case and "N/N rules cases passing".
   ════════════════════════════════════════════════════════════════════ */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const deps = process.env.RULES_TEST_DEPS
  ? path.join(path.resolve(process.env.RULES_TEST_DEPS), "package.json")
  : import.meta.url;
const require = createRequire(deps);
const {
  initializeTestEnvironment, assertSucceeds, assertFails
} = require("@firebase/rules-unit-testing");

const ADMIN = "jhoffman@seq.org";
const A = "teacher.a@seq.org";
const B = "teacher.b@seq.org";

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const env = await initializeTestEnvironment({
  projectId: "demo-ei",
  firestore: {
    rules: readFileSync(path.join(here, "..", "firestore.rules"), "utf8"),
    host, port: Number(port)
  }
});

function as(uid, email){
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}
const admin = as("admin-uid", ADMIN);
const tA = as("a-uid", A);
const tB = as("b-uid", B);
const stranger = as("x-uid", "nobody@seq.org");
const s1 = as("s1", "101@seq.org");   // A's student
const s2 = as("s2", "202@seq.org");   // B's student
const s3 = as("s3", "303@seq.org");   // imported by A, hasn't copied it yet

let pass = 0, total = 0;
async function check(desc, p){
  total++;
  try{ await p; pass++; console.log("PASS " + desc); }
  catch(e){ console.log("FAIL " + desc + " — " + (e && e.message || e).split("\n")[0]); }
}
const ok = (desc, fn) => check(desc, assertSucceeds(fn()));
const no = (desc, fn) => check(desc, assertFails(fn()));

// ── fixture, written with rules off ───────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await db.doc("teachers/" + A).set({ email: A, name: "A" });
  await db.doc("teachers/" + B).set({ email: B, name: "B" });
  await db.doc("students/s1").set({ email: "101@seq.org", teacher: A, words: {} });
  await db.doc("students/s2").set({ email: "202@seq.org", teacher: B, words: {} });
  await db.doc("students/s3").set({ email: "303@seq.org", words: {} });
  await db.doc("roster/101@seq.org").set({ name: "One", teacher: A });
  await db.doc("roster/202@seq.org").set({ name: "Two", teacher: B });
  await db.doc("roster/303@seq.org").set({ name: "Three", teacher: A });
  await db.doc("roster/404@seq.org").set({ name: "Legacy" });          // no owner
  await db.doc("assignments/s1").set({ lists: ["x"], teacher: A });
  await db.doc("assignments/s2").set({ lists: ["y"], teacher: B });
  await db.doc("notes/s1").set({ text: "a", teacher: A });
  await db.doc("notes/s2").set({ text: "b", teacher: B });
  // Arrived in A's class from the admin's: their own doc says A, their
  // old assignment and note still say the admin.
  await db.doc("students/s7").set({ email: "707@seq.org", teacher: A });
  await db.doc("assignments/s7").set({ lists: [], teacher: ADMIN });
  await db.doc("notes/s7").set({ text: "", teacher: ADMIN });
  await db.doc("classes/" + A).set({ periods: ["1"] });
  await db.doc("config/class").set({ periods: ["3"] });
  for(let i = 0; i < 30; i++){
    await db.doc("students/bulk" + i).set({ email: "9" + i + "@seq.org", teacher: A });
  }
});

// ── teachers/ ─────────────────────────────────────────────────────────
await ok("a teacher reads their own teachers/ doc", () => tA.doc("teachers/" + A).get());
await no("…but not another teacher's", () => tA.doc("teachers/" + B).get());
await no("a teacher can't list teachers", () => tA.collection("teachers").get());
await no("a teacher can't add a teacher", () => tA.doc("teachers/c@seq.org").set({ email: "c@seq.org" }));
await no("a student can't add themselves as a teacher", () => s1.doc("teachers/101@seq.org").set({ email: "101@seq.org" }));
await ok("the admin lists teachers", () => admin.collection("teachers").get());
await ok("the admin adds a teacher", () => admin.doc("teachers/c@seq.org").set({ email: "c@seq.org", name: "C" }));
await ok("the admin removes one", () => admin.doc("teachers/c@seq.org").delete());

// ── students/ ─────────────────────────────────────────────────────────
await ok("teacher A reads A's student", () => tA.doc("students/s1").get());
await no("teacher A can't read B's student", () => tA.doc("students/s2").get());
await no("…or an unowned one", () => tA.doc("students/s3").get());
await ok("A's list query with where teacher==A succeeds", () => tA.collection("students").where("teacher", "==", A).get());
await no("A's unfiltered list query is refused", () => tA.collection("students").get());
await no("A can't list B's with where teacher==B", () => tA.collection("students").where("teacher", "==", B).get());
await no("someone who isn't a teacher can't list", () => stranger.collection("students").where("teacher", "==", "nobody@seq.org").get());
await ok("the admin lists everyone", () => admin.collection("students").get());
await no("a teacher still has no write on a student's doc", () => tA.doc("students/s1").set({ words: {} }, { merge: true }));

await ok("a student saves their own doc without touching teacher", () => s1.doc("students/s1").set({ words: { "a|b": 1 } }, { merge: true }));
await no("a student can't move themselves to another teacher", () => s1.doc("students/s1").set({ teacher: B }, { merge: true }));
await ok("a student copies their roster row's teacher", () => s3.doc("students/s3").set({ teacher: A }, { merge: true }));
await no("…and only that one", () => s3.doc("students/s3").set({ teacher: B }, { merge: true }));
await ok("a brand-new student creates their doc with no teacher", () => as("s5", "505@seq.org").doc("students/s5").set({ email: "505@seq.org" }));
await ok("a new student created with their roster row's teacher", () => as("s6", "101@seq.org").doc("students/s6").set({ teacher: A }));
await no("a student can't read another student's doc", () => s1.doc("students/s2").get());

await ok("the admin moves a student (teacher field only)", () => admin.doc("students/s2").update({ teacher: A }));
await no("…but may not change anything else on it", () => admin.doc("students/s2").update({ words: { "x|y": 1 } }));
await ok("…and moves them back", () => admin.doc("students/s2").update({ teacher: B }));

// ── roster/ ───────────────────────────────────────────────────────────
await ok("A reads A's roster row", () => tA.doc("roster/101@seq.org").get());
await no("A can't read B's roster row (that's how the import knows)", () => tA.doc("roster/202@seq.org").get());
await ok("A may read a row that doesn't exist", () => tA.doc("roster/999@seq.org").get());
await ok("A may read an unowned legacy row", () => tA.doc("roster/404@seq.org").get());
await ok("A's roster list query with where teacher==A", () => tA.collection("roster").where("teacher", "==", A).get());
await no("A's unfiltered roster query is refused", () => tA.collection("roster").get());
await ok("A creates a row owned by A", () => tA.doc("roster/777@seq.org").set({ name: "New", teacher: A }));
await no("A can't create a row owned by B", () => tA.doc("roster/778@seq.org").set({ name: "New", teacher: B }));
await no("A can't create a row with no owner", () => tA.doc("roster/779@seq.org").set({ name: "New" }));
await no("A can't overwrite B's row", () => tA.doc("roster/202@seq.org").set({ name: "Mine now", teacher: A }));
await ok("A claims the unowned legacy row", () => tA.doc("roster/404@seq.org").set({ teacher: A }, { merge: true }));
await no("A can't delete B's row", () => tA.doc("roster/202@seq.org").delete());
await ok("A deletes A's own row", () => tA.doc("roster/777@seq.org").delete());
await ok("a student reads their own roster row", () => s1.doc("roster/101@seq.org").get());
await no("…and nobody else's", () => s1.doc("roster/202@seq.org").get());
await no("…and can't write it", () => s1.doc("roster/101@seq.org").set({ teacher: B }, { merge: true }));
await ok("the admin rewrites any row (a move)", () => admin.doc("roster/202@seq.org").set({ teacher: B }, { merge: true }));

// ── assignments/ and notes/ ───────────────────────────────────────────
for(const col of ["assignments", "notes"]){
  await ok("A reads A's " + col, () => tA.doc(col + "/s1").get());
  await no("A can't read B's " + col, () => tA.doc(col + "/s2").get());
  await ok("A's " + col + " list query with where teacher==A", () => tA.collection(col).where("teacher", "==", A).get());
  await no("A's unfiltered " + col + " query is refused", () => tA.collection(col).get());
  await ok("A writes A's student's " + col, () => tA.doc(col + "/s1").set({ teacher: A, updatedAt: 1 }, { merge: true }));
  await no("A can't write B's student's " + col + " even claiming them", () => tA.doc(col + "/s2").set({ teacher: A, x: 1 }, { merge: true }));
  await no("A can't write " + col + " without naming themselves", () => tA.doc(col + "/s1").set({ teacher: B }, { merge: true }));
  await no("A can't create " + col + " stamped with B", () => tA.doc(col + "/fresh").set({ teacher: B }));
  await ok("A takes over a stale " + col + " doc once the student's own doc names A", () =>
    tA.doc(col + "/s7").set({ teacher: A, z: 1 }, { merge: true }));
  await ok("the admin writes any " + col, () => admin.doc(col + "/s2").set({ teacher: B, y: 1 }, { merge: true }));
}
await ok("a student reads their own assignment", () => s1.doc("assignments/s1").get());
await no("a student can't read their own note", () => s1.doc("notes/s1").get());
await no("a student can't write their assignment", () => s1.doc("assignments/s1").set({ lists: ["z"] }, { merge: true }));

/* The Assign board saves a whole class in ONE batch, and each assignment
   write costs a get() of that student's doc. Firestore caps those calls
   per request; this is the case that proves a period of thirty saves. */
function thirty(){
  const batch = tA.batch();
  for(let i = 0; i < 30; i++) batch.set(tA.doc("assignments/bulk" + i), { teacher: A, lists: ["x" + Date.now()] }, { merge: true });
  return batch.commit();
}
await ok("A creates thirty assignments in one batch", thirty);
await ok("…and updates the same thirty in one batch", thirty);
await ok("A imports forty roster rows in one batch", () => {
  const batch = tA.batch();
  for(let i = 0; i < 40; i++) batch.set(tA.doc("roster/8" + i + "@seq.org"), { teacher: A, name: "R" + i }, { merge: true });
  return batch.commit();
});

// ── classes/ and config/class ─────────────────────────────────────────
await ok("A reads and writes their own classes doc", () => tA.doc("classes/" + A).set({ periods: ["1", "2"] }, { merge: true }));
await no("A can't read B's classes doc", () => tA.doc("classes/" + B).get());
await ok("the admin reads the old config/class", () => admin.doc("config/class").get());
await no("…which nobody writes any more", () => admin.doc("config/class").set({ periods: [] }));
await no("a teacher can't read config/class", () => tA.doc("config/class").get());

console.log(pass + "/" + total + " rules cases passing");
await env.cleanup();
process.exit(pass === total ? 0 : 1);
