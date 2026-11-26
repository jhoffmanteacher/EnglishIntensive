/* Who gets in. School, outside and look-alike addresses go to the sign-in
   button and, separately, straight to the database rules; both must give
   the right answer. */
import { ADMIN, person, assert, same, sleep, until } from "./harness.mjs";
import { ANA, BEN, TEACHER, seedTeachers, seedClass, openDashboard, noRefusals } from "./flows.mjs";

const OUTSIDERS = [
  person("kid@gmail.com", "Personal Account"),
  person("101001@seq.org.attacker.com", "Suffix Lookalike"),
  person("101001@notseq.org", "Prefix Lookalike"),
  person("101001@student.seq.org", "Subdomain"),
  person("101001@seqxorg.com", "Dot Lookalike"),
];

const mine = (a) => [`students/${a.uid}`, `assignments/${a.uid}`, `roster/${a.email}`];

export const loops = [
  {
    name: "a refused write is seen by the loops",
    async run(t) {
      await seedTeachers(t.backend, TEACHER);
      const [ana] = await seedClass(t.backend, "p3", [TEACHER], [ANA], ["red-1-cards"]);
      const c = await t.computer("student");
      await c.signIn(ANA);
      await c.unlocked();
      noRefusals(c);
      await c.eval(`EIAuth.db().then(function(db){ return db.collection("assignments").doc("${ana.uid}").set({ lists: [] }); }).then(null, function(){})`);
      await until(() => c.log.some((l) => l.indexOf("emu-write-failed: set assignments/") !== -1), "the refusal to be noticed");
    },
  },
  {
    name: "sign-in: a school account gets in",
    async run(t) {
      const c = await t.computer("student");
      await c.signIn(ANA);
      await c.unlocked();
      const doc = await until(async () => Object.values(await t.backend.storedAll("students")).find((d) => d.email === ANA.email),
        "the student's own record to be written");
      same(doc.name, ANA.name, "the name on the record");
    },
  },
  {
    name: "sign-in: outside and look-alike accounts are turned away",
    async run(t) {
      for (const who of OUTSIDERS) {
        const c = await t.computer(who.email);
        await c.signIn(who);
        await c.wait(`(function(){ var e = document.querySelector("#ei-wall-error"); return !!e && !e.hidden && e.textContent.indexOf("@seq.org school account") !== -1; })()`,
          "the message asking for the school account");
        await c.wait(`firebase.auth().currentUser === null`, "the account to be signed out again");
        assert(await c.eval(`document.documentElement.classList.contains("ei-locked")`), `${who.email}: the sign-in wall came down`);
        await c.reload();
        await c.wait(`!!document.querySelector("#ei-wall-signin") && !document.querySelector("#ei-wall-signin").hidden`, "the sign-in screen after a reload");
        assert(await c.eval(`document.documentElement.classList.contains("ei-locked")`), `${who.email}: a reload let them in`);
      }
      same(Object.keys(await t.backend.storedAll("students")), [], "records written by outsiders");
    },
  },
  {
    name: "sign-in: an unverified school address saves and sees nothing",
    async run(t) {
      const who = person("103003@seq.org", "Unverified", { email_verified: false });
      const c = await t.computer("unverified");
      await c.signIn(who);
      await c.wait(`!!(firebase.auth().currentUser && firebase.auth().currentUser.email === ${JSON.stringify(who.email)}) && EIStore.failed()`,
        "the account signed in and its record refused", 30000);
      await sleep(2000);
      same(Object.keys(await t.backend.storedAll("students")), [], "records written");
      same(await c.eval(`document.querySelectorAll("#sections a[href*='list=']").length`), 0, "games offered");
    },
  },
  {
    name: "sign-in: the database rules agree, whatever the page does",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER);
      const [ana, ben] = await seedClass(b, "p3", [TEACHER], [ANA, BEN], ["red-1-cards"]);
      for (const a of [ana, ben]) {
        await b.seed(`students/${a.uid}`, { email: a.email, name: a.name, classId: "p3", teachers: [TEACHER.email] });
        await b.seed(`notes/${a.uid}`, { text: "private", classId: "p3", teachers: [TEACHER.email] });
      }
      for (const p of mine(ana)) assert(await b.canRead(ana, p), `Ana cannot read her own ${p}`);
      for (const p of mine(ben)) assert(!(await b.canRead(ana, p)), `Ana can read another student's ${p}`);
      assert(!(await b.canRead(ana, `notes/${ana.uid}`)), "Ana can read the private note about her");
      assert(!(await b.canRead(null, `students/${ana.uid}`)), "someone signed out can read a student's record");
      for (const col of ["students", "assignments", "notes", "roster", "classes"]) {
        assert(!(await b.canList(ana, col)), `a student can list all ${col}`);
        assert(!(await b.canList(ana, col, TEACHER.email)), `a student can list their teacher's ${col}`);
      }
      assert(await b.canWrite(ana, `students/${ana.uid}`, { lastSeen: 2 }), "a student cannot save their own record");
      for (const [p, data] of [[`students/${ben.uid}`, { lastSeen: 2 }], [`teachers/${ana.email}`, { email: ana.email }], ["classes/p3", { name: "x" }],
        [`roster/${ana.email}`, { name: "x" }], [`assignments/${ana.uid}`, { lists: [] }], [`notes/${ana.uid}`, { text: "x" }]]) {
        assert(!(await b.canWrite(ana, p, data)), `a student can write ${p}`);
      }

      for (const who of [...OUTSIDERS, person("104004@seq.org", "Unverified", { email_verified: false })]) {
        const x = await b.account(who);
        /* Seeded under the outsider's own ids, so a refusal is about WHO they are, not about an empty path. */
        await b.seed(`students/${x.uid}`, { email: x.email });
        await b.seed(`assignments/${x.uid}`, { lists: ["red-1-cards"], classId: "p3", teachers: [TEACHER.email] });
        await b.seed(`roster/${x.email}`, { name: x.name, classId: "p3", teachers: [TEACHER.email] });
        for (const p of mine(x)) assert(!(await b.canRead(x, p)), `${x.email} can read ${p}`);
        for (const p of mine(ana)) assert(!(await b.canRead(x, p)), `${x.email} can read Ana's ${p}`);
        assert(!(await b.canWrite(x, `students/${x.uid}`, { email: x.email, lastSeen: 1 })), `${x.email} can write a record`);
      }
      const fakeAdmin = await b.account(person(ADMIN, "Unverified Admin", { email_verified: false }));
      assert(!(await b.canList(fakeAdmin, "students")), "an unverified admin address can list every student");
    },
  },
  {
    name: "sign-in: a student who opens the dashboard sees no one",
    async run(t) {
      await seedTeachers(t.backend, TEACHER);
      await seedClass(t.backend, "p3", [TEACHER], [ANA, BEN], ["red-1-cards"]);
      const c = await t.computer("student");
      await c.signIn(ANA, "/teacher.html");
      await c.wait(`!!(firebase.auth().currentUser && firebase.auth().currentUser.email === ${JSON.stringify(ANA.email)})
        && !document.documentElement.classList.contains("ei-locked")`, "the dashboard to answer the student", 30000);
      await sleep(2000);
      const page = await c.eval(`document.body.textContent`);
      assert(page.indexOf(BEN.name) === -1 && page.indexOf(BEN.email) === -1, "a classmate shows on the dashboard a student opened");
      same(await c.eval(`document.querySelectorAll("#tBody tr[data-uid]").length`), 0, "student rows");
      /* And the teacher, with the same data, does see them (so the check above could have failed). */
      const tc = await t.computer("teacher");
      await openDashboard(tc, TEACHER);
      await tc.wait(`document.body.textContent.indexOf(${JSON.stringify(BEN.name)}) !== -1`, "the teacher to see the class");
    },
  },
];
