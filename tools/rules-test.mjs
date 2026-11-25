/* ════════════════════════════════════════════════════════════════════
   tools/rules-test.mjs — firestore.rules against the Firestore emulator.

   tests.html can't touch the rules: they run on Google's servers, and
   they are the only thing that actually decides who reads what. This
   runs the real file in the local emulator and checks the claims the
   class model rests on — a co-teacher reads their class's students, a
   teacher not on the class can't, removing a co-teacher (once the member
   docs are rewritten) cuts them off, a student can only take the class
   their roster row names, nobody but the admin adds a teacher.

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
const C = "teacher.c@seq.org";
const XT = [A, B];        // class X: A and B co-teach
const YT = [C];           // class Y: C alone
const ZT = [A];           // class Z: A alone
const WT = [A, B];        // class W: B will remove themselves

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
const tC = as("c-uid", C);
const stranger = as("x-uid", "nobody@seq.org");
const s1 = as("s1", "101@seq.org");   // in X
const s3 = as("s3", "303@seq.org");   // roster says X, own doc not yet

let pass = 0, total = 0;
async function check(desc, p){
  total++;
  try{ await p; pass++; console.log("PASS " + desc); }
  catch(e){ console.log("FAIL " + desc + " — " + (e && e.message || e).split("\n")[0]); }
}
const ok = (desc, fn) => check(desc, assertSucceeds(fn()));
const no = (desc, fn) => check(desc, assertFails(fn()));
const inX = { classId: "X", teachers: XT };

// ── fixture, written with rules off ───────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for(const t of [A, B, C]) await db.doc("teachers/" + t).set({ email: t, name: t });
  await db.doc("classes/X").set({ name: "P3", teachers: XT, archived: {} });
  await db.doc("classes/Y").set({ name: "P5", teachers: YT, archived: {} });
  await db.doc("classes/Z").set({ name: "P6", teachers: ZT, archived: {} });
  await db.doc("classes/W").set({ name: "P7", teachers: WT, archived: {} });
  await db.doc("students/s1").set({ email: "101@seq.org", words: {}, ...inX });
  await db.doc("students/s2").set({ email: "202@seq.org", words: {}, classId: "Y", teachers: YT });
  await db.doc("students/s3").set({ email: "303@seq.org", words: {} });
  await db.doc("students/s4").set({ email: "404@seq.org", classId: "W", teachers: WT });
  await db.doc("roster/101@seq.org").set({ name: "One", ...inX });
  await db.doc("roster/202@seq.org").set({ name: "Two", classId: "Y", teachers: YT });
  await db.doc("roster/303@seq.org").set({ name: "Three", ...inX });
  await db.doc("roster/404@seq.org").set({ name: "Four", classId: "W", teachers: WT });
  await db.doc("roster/505@seq.org").set({ name: "Legacy", period: "3" });     // no owner
  await db.doc("assignments/s1").set({ lists: ["x"], ...inX });
  await db.doc("assignments/s2").set({ lists: ["y"], classId: "Y", teachers: YT });
  await db.doc("assignments/s4").set({ lists: [], classId: "W", teachers: WT });
  await db.doc("notes/s1").set({ text: "a", ...inX });
  await db.doc("notes/s2").set({ text: "b", classId: "Y", teachers: YT });
  await db.doc("config/class").set({ periods: ["3"] });
  for(let i = 0; i < 30; i++){
    await db.doc("students/bulk" + i).set({ email: "9" + i + "@seq.org", ...inX });
  }
});

// ── teachers/ ─────────────────────────────────────────────────────────
await ok("a teacher lists the site's teachers (the co-teacher picker)", () => tA.collection("teachers").get());
await no("someone who isn't a teacher can't", () => stranger.collection("teachers").get());
await ok("…but may read their own (that's how auth.js asks)", () => stranger.doc("teachers/nobody@seq.org").get());
await no("a teacher can't add a teacher to the site", () => tA.doc("teachers/d@seq.org").set({ email: "d@seq.org" }));
await no("a student can't add themselves", () => s1.doc("teachers/101@seq.org").set({ email: "101@seq.org" }));
await ok("the admin adds a teacher", () => admin.doc("teachers/d@seq.org").set({ email: "d@seq.org" }));
await ok("the admin removes one", () => admin.doc("teachers/d@seq.org").delete());

// ── classes/ ──────────────────────────────────────────────────────────
await ok("A lists the classes A teaches", () => tA.collection("classes").where("teachers", "array-contains", A).get());
await no("A can't list every class", () => tA.collection("classes").get());
await no("C can't read class X", () => tC.doc("classes/X").get());
await ok("A creates a class with A on it", () => tA.doc("classes/new1").set({ name: "New", teachers: [A] }));
await no("A can't create a class without A on it", () => tA.doc("classes/new2").set({ name: "New", teachers: [C] }));
await no("a student can't create a class", () => s1.doc("classes/new3").set({ name: "Mine", teachers: ["101@seq.org"] }));
await ok("A renames X", () => tA.doc("classes/X").update({ name: "P3 Intensive" }));
await no("C can't rename X", () => tC.doc("classes/X").update({ name: "Hijacked" }));

/* Saved sequences live on the class document (classes/{id}.sequences.<key>),
   so every teacher on the class sees and can use them and no rule changed:
   the class rule already lets a teacher on the class write it, as long as
   `teachers` stays a non-empty list. */
let deleteField = null;
try{ ({ deleteField } = require("firebase/firestore")); }catch(e){}
const SEQ = { name: "Red Words, Lists 1 to 10", steps: [{ ids: ["red-1-say", "red-1-cards"] }], bar: 0.9, createdAt: 1795563000000 };
await ok("a teacher on the class saves a sequence on it", () => tA.doc("classes/X").set({ sequences: { k1: SEQ } }, { merge: true }));
await ok("a co-teacher on the class saves one too", () => tB.doc("classes/X").set({ sequences: { k2: { ...SEQ, name: "B's" } } }, { merge: true }));
await ok("…and a co-teacher reads what was saved", () => tB.doc("classes/X").get());
await ok("a teacher renames one (just its name)", () => tA.doc("classes/X").set({ sequences: { k1: { name: "Renamed" } } }, { merge: true }));
if(deleteField) await ok("a teacher deletes one (a field delete under `sequences`)", () => tA.doc("classes/X").set({ sequences: { k2: deleteField() } }, { merge: true }));
else console.log("SKIPPED the field-delete case: firebase/firestore could not be loaded from RULES_TEST_DEPS, so deleting a saved sequence is not covered by this run.");
await no("a teacher not on the class can't save one", () => tC.doc("classes/X").set({ sequences: { k3: SEQ } }, { merge: true }));
await no("…or read the class's", () => tC.doc("classes/X").get());
await no("a student can't save one", () => s1.doc("classes/X").set({ sequences: { k4: SEQ } }, { merge: true }));
await no("a save can't be used to empty the class's teachers", () => tA.doc("classes/X").set({ sequences: { k5: SEQ }, teachers: [] }, { merge: true }));
await ok("the admin saves one on any class", () => admin.doc("classes/Y").set({ sequences: { k6: SEQ } }, { merge: true }));
await no("a class can never have zero teachers", () => tA.doc("classes/Z").update({ teachers: [] }));
await ok("A deletes a class A teaches", () => tA.doc("classes/new1").delete());

// ── students/ ─────────────────────────────────────────────────────────
await ok("co-teacher B reads X's student", () => tB.doc("students/s1").get());
await no("C, not on X, can't", () => tC.doc("students/s1").get());
await ok("B's list query with array-contains B succeeds", () => tB.collection("students").where("teachers", "array-contains", B).get());
await no("B's unfiltered list is refused", () => tB.collection("students").get());
await no("C can't list X's students by naming B", () => tC.collection("students").where("teachers", "array-contains", B).get());
await ok("the admin lists everyone", () => admin.collection("students").get());
await no("a teacher still can't write a student's practice", () => tA.doc("students/s1").set({ words: { "a|b": 1 } }, { merge: true }));

await ok("a student saves their own doc without touching the class", () => s1.doc("students/s1").set({ words: { "a|b": 1 } }, { merge: true }));
await no("a student can't set a class their roster row doesn't name", () => s1.doc("students/s1").set({ classId: "Y", teachers: YT }, { merge: true }));
await no("…or pad the teachers list", () => s1.doc("students/s1").set({ classId: "X", teachers: [A, B, C] }, { merge: true }));
await ok("a student copies their roster row's class", () => s3.doc("students/s3").set({ classId: "X", teachers: XT }, { merge: true }));
await ok("a brand-new student creates their doc with no class", () => as("s5", "606@seq.org").doc("students/s5").set({ email: "606@seq.org" }));

await ok("A moves a student between two classes A teaches (X → Z)", () => tA.doc("students/s1").update({ classId: "Z", teachers: ZT }));
await no("…but not into a class A isn't on", () => tA.doc("students/s1").update({ classId: "Y", teachers: YT }));
await no("C can't move A's student", () => tC.doc("students/s1").update({ classId: "Y", teachers: YT }));
await no("a stamp must match the class's own teachers", () => tA.doc("students/s1").update({ classId: "Z", teachers: [A, C] }));
await no("a teacher may change only the class fields", () => tA.doc("students/s1").update({ classId: "X", teachers: XT, words: {} }));
await ok("A moves them back", () => tA.doc("students/s1").update(inX));
await ok("the admin moves anyone anywhere", () => admin.doc("students/s2").update({ classId: "Y", teachers: YT }));

// ── roster/ ───────────────────────────────────────────────────────────
await ok("B gets a row in X", () => tB.doc("roster/101@seq.org").get());
await no("C can't get a row in X (that's how the import knows)", () => tC.doc("roster/101@seq.org").get());
await ok("C may get a row that doesn't exist", () => tC.doc("roster/999@seq.org").get());
await ok("C may get an unowned legacy row", () => tC.doc("roster/505@seq.org").get());
await ok("B's roster list with array-contains", () => tB.collection("roster").where("teachers", "array-contains", B).get());
await no("an unfiltered roster list is refused", () => tB.collection("roster").get());
await ok("A creates a row in X", () => tA.doc("roster/777@seq.org").set({ name: "New", ...inX }));
await no("A can't create a row in Y", () => tA.doc("roster/778@seq.org").set({ name: "New", classId: "Y", teachers: YT }));
await no("A can't create a row with a made-up teachers list", () => tA.doc("roster/779@seq.org").set({ name: "New", classId: "X", teachers: [A] }));
await no("C can't take X's row into Y", () => tC.doc("roster/101@seq.org").set({ classId: "Y", teachers: YT }, { merge: true }));
await ok("C claims the unowned legacy row", () => tC.doc("roster/505@seq.org").set({ classId: "Y", teachers: YT }, { merge: true }));
await no("C can't delete X's row", () => tC.doc("roster/101@seq.org").delete());
await ok("A deletes a row in X", () => tA.doc("roster/777@seq.org").delete());
await ok("a student reads their own roster row", () => s1.doc("roster/101@seq.org").get());
await no("…nobody else's", () => s1.doc("roster/202@seq.org").get());
await no("…and can't write it", () => s1.doc("roster/101@seq.org").set({ classId: "Y", teachers: YT }, { merge: true }));

// ── assignments/ and notes/ ───────────────────────────────────────────
for(const col of ["assignments", "notes"]){
  await ok("co-teacher B reads " + col + " in X", () => tB.doc(col + "/s1").get());
  await no("C can't read " + col + " in X", () => tC.doc(col + "/s1").get());
  await ok("B lists " + col + " with array-contains", () => tB.collection(col).where("teachers", "array-contains", B).get());
  await no("an unfiltered " + col + " list is refused", () => tB.collection(col).get());
  await ok("B writes " + col + " for X's student", () => tB.doc(col + "/s1").set({ updatedAt: 1, ...inX }, { merge: true }));
  await no("C can't write " + col + " for X's student, even stamping Y", () => tC.doc(col + "/s1").set({ classId: "Y", teachers: YT }, { merge: true }));
  await no("A can't create " + col + " stamped for a class A isn't on", () => tA.doc(col + "/fresh").set({ classId: "Y", teachers: YT }));
  await ok("the admin writes any " + col, () => admin.doc(col + "/s2").set({ y: 1 }, { merge: true }));
}
await ok("a student reads their own assignment", () => s1.doc("assignments/s1").get());
await no("a student can't read their own note", () => s1.doc("notes/s1").get());
await no("a student can't write their assignment", () => s1.doc("assignments/s1").set({ lists: ["z"] }, { merge: true }));

/* ── sequences ──────────────────────────────────────────────────────────
   A teacher writes a `plan` (steps, a bar, where to start) on a student's
   assignment, or on their roster row if they haven't signed in. The
   student's browser works out where they are and records only a high-water
   mark, `seq`, on their OWN document. The student must never be able to
   write the plan: that is the rule that keeps "the site moves a student on
   by itself" from meaning "a student moves themselves on". No rule
   changed for any of this; these cases are what says so. */
const PLAN = { steps: [{ ids: ["red-1-say", "red-1-cards"] }, { ids: ["red-2-say"] }], bar: 0.9, at: 0, hold: false, setAt: 1795563000000 };
await ok("a student writes their own high-water mark (seq)", () =>
  s1.doc("students/s1").set({ seq: { at: 1, of: PLAN.setAt, when: 1795563000001 } }, { merge: true }));
await no("…but not another student's", () =>
  s1.doc("students/s2").set({ seq: { at: 1, of: 1, when: 1 } }, { merge: true }));
await no("a student can't write the plan on their own assignment", () =>
  s1.doc("assignments/s1").set({ plan: PLAN }, { merge: true }));
await no("…or replace the assignment with one that has a plan", () =>
  s1.doc("assignments/s1").set({ plan: PLAN, lists: ["red-1-say"], ...inX }));
await no("…or write a plan on their roster row", () =>
  s1.doc("roster/101@seq.org").set({ plan: PLAN }, { merge: true }));
await ok("a teacher on the class writes a plan and the lists of its current step", () =>
  tA.doc("assignments/s1").set({ plan: PLAN, lists: ["red-1-say", "red-1-cards"], updatedAt: 1, ...inX }, { merge: true }));
await ok("…and may move the student on (at) or hold them (hold)", () =>
  tA.doc("assignments/s1").set({ plan: { ...PLAN, at: 1, hold: true, setAt: PLAN.setAt + 1 }, ...inX }, { merge: true }));
await ok("a co-teacher on the class does the same", () =>
  tB.doc("assignments/s1").set({ plan: PLAN, ...inX }, { merge: true }));
await no("a teacher not on the class can't", () =>
  tC.doc("assignments/s1").set({ plan: PLAN, ...inX }, { merge: true }));
await ok("a teacher writes a plan on a roster row for a student who hasn't signed in", () =>
  tA.doc("roster/101@seq.org").set({ plan: PLAN, ...inX }, { merge: true }));
await ok("the student still reads their own assignment, plan and all", () => s1.doc("assignments/s1").get());

/* The Assign board saves a whole class in ONE batch. Each write's stamp
   is checked with a get() of the same class doc, which Firestore counts
   once; this is the case that proves a class of thirty saves. */
function thirty(){
  const batch = tA.batch();
  for(let i = 0; i < 30; i++) batch.set(tA.doc("assignments/bulk" + i), { lists: ["x" + Date.now()], ...inX }, { merge: true });
  return batch.commit();
}
await ok("A creates thirty assignments in one batch", thirty);
await ok("…and updates the same thirty in one batch", thirty);
await ok("A imports forty roster rows into X in one batch", () => {
  const batch = tA.batch();
  for(let i = 0; i < 40; i++) batch.set(tA.doc("roster/8" + i + "@seq.org"), { name: "R" + i, ...inX }, { merge: true });
  return batch.commit();
});

// ── changing a class's co-teachers ────────────────────────────────────
await ok("A removes B from X", () => tA.doc("classes/X").update({ teachers: [A] }));
await ok("…and rewrites X's members (roster, student, assignment, note) in one batch", () => {
  const batch = tA.batch();
  const st = { classId: "X", teachers: [A] };
  batch.set(tA.doc("roster/101@seq.org"), st, { merge: true });
  batch.set(tA.doc("students/s1"), st, { merge: true });
  batch.set(tA.doc("assignments/s1"), st, { merge: true });
  batch.set(tA.doc("notes/s1"), st, { merge: true });
  return batch.commit();
});
await no("B is cut off from the student", () => tB.doc("students/s1").get());
await no("…their roster row", () => tB.doc("roster/101@seq.org").get());
await no("…their note", () => tB.doc("notes/s1").get());
await no("…and the class", () => tB.doc("classes/X").get());
await ok("a half-finished rewrite can be finished by anyone on the class", () =>
  tA.doc("roster/303@seq.org").set({ classId: "X", teachers: [A] }, { merge: true }));

await ok("B removes themselves from W", () => tB.doc("classes/W").update({ teachers: [A] }));
await ok("…and may still rewrite W's members to the class's new list", () => {
  const batch = tB.batch();
  const st = { classId: "W", teachers: [A] };
  batch.set(tB.doc("roster/404@seq.org"), st, { merge: true });
  batch.set(tB.doc("students/s4"), st, { merge: true });
  batch.set(tB.doc("assignments/s4"), st, { merge: true });
  return batch.commit();
});
await no("…after which B can't read them", () => tB.doc("students/s4").get());

// ── config/class ──────────────────────────────────────────────────────
await ok("the admin reads the old config/class", () => admin.doc("config/class").get());
await no("…which nobody writes any more", () => admin.doc("config/class").set({ periods: [] }));
await no("a teacher can't read config/class", () => tA.doc("config/class").get());

console.log(pass + "/" + total + " rules cases passing");
await env.cleanup();
process.exit(pass === total ? 0 : 1);
