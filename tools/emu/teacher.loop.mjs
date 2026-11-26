/* Teacher to student, with the dashboard's own buttons against the real
   rules. After each action: what is stored, what the student's own page
   shows, and who else can read it. */
import { assert, same, until, sleep } from "./harness.mjs";
import { TEACHER, CO, OTHER, ANA, BEN, seedTeachers, seedClass, homeLists, playCards, openDashboard, reloadDashboard, view,
  openStudent, tab, createClass, quickAdd, giveGames, noRefusals } from "./flows.mjs";

const stamp = (d) => d && { classId: d.classId, teachers: [...(d.teachers || [])].sort() };
const NOTE = 'Reads well, freezes when timed. "Sounds it out" – José.';

export const loops = [
  {
    name: "teacher to student: add, give games, change, move class, remove",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER, CO);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      const p3 = await createClass(dash, b, "P3");
      same(stamp(await b.stored(`classes/${p3}`)).teachers, [TEACHER.email], "the new class's teachers");

      await quickAdd(dash, b, "101001", p3);
      await openStudent(dash, `roster:${ANA.email}`);
      await giveGames(dash, ["red-1-cards", "red-2-cards"]);
      await until(async () => { same((await b.stored(`roster/${ANA.email}`)).lists?.slice().sort(), ["red-1-cards", "red-2-cards"], "roster lists"); return true; },
        "games saved for a student who has not signed in");

      const kid = await t.computer("student");
      await kid.signIn(ANA);
      await kid.unlocked();
      same(await homeLists(kid), ["red-1-cards", "red-2-cards"], "the student's home page, first sign-in");
      const ana = await b.account(ANA);
      await until(async () => { same(stamp(await b.stored(`students/${ana.uid}`)), { classId: p3, teachers: [TEACHER.email] }, "class stamp"); return true; },
        "the student's record to carry the class");
      const tally = await playCards(kid, "red-1-cards", [true, false]);
      await until(async () => (await b.stored(`students/${ana.uid}`))?.totals?.n === 2, "the practice to be saved");

      await reloadDashboard(dash);
      await openStudent(dash, ana.uid);
      await tab(dash, "data");
      const chips = Object.entries(tally).map(([w, v]) => `${w} ${v.r}/${v.n}`).sort();
      await dash.wait(`document.querySelectorAll("#stuPanel-data .wordchip").length > 0`, "the student's words on the data tab");
      same(await dash.eval(`Array.from(document.querySelectorAll("#stuPanel-data .wordchip")).map(function(el){
        return el.firstChild.textContent + " " + el.querySelector("small").textContent.split(" ")[0]; }).sort()`), chips, "the words and scores on the teacher's data tab");

      await giveGames(dash, ["red-3-cards"]);
      await until(async () => { same((await b.stored(`assignments/${ana.uid}`))?.lists, ["red-3-cards"], "assigned lists"); return true; }, "the change to be saved");
      same(await homeLists(kid), ["red-3-cards"], "the student's home page after the change");

      const p5 = await createClass(dash, b, "P5");
      await dash.set(`#tBody [data-class-for="${ana.uid}"]`, p5);
      for (const path of [`students/${ana.uid}`, `assignments/${ana.uid}`, `roster/${ANA.email}`]) {
        await until(async () => { same(stamp(await b.stored(path)), { classId: p5, teachers: [TEACHER.email] }, path); return true; }, `${path} to move class`);
      }
      same(await homeLists(kid), ["red-3-cards"], "the student's home page after moving class");

      await reloadDashboard(dash);
      await openStudent(dash, ana.uid);
      await tab(dash, "notes");
      await dash.click("#tRosterOut");
      await until(async () => (await b.stored(`roster/${ANA.email}`)) === null, "the roster row to go");
      same(await homeLists(kid), ["red-3-cards"], "the student keeps their games after leaving the roster");
      assert((await b.stored(`students/${ana.uid}`)).totals.n === 2, "the practice record was lost");
      noRefusals(dash);
    },
  },
  {
    name: "teacher to student: a note and a co-teacher, and who can read what",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER, CO, OTHER);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      const p3 = await createClass(dash, b, "P3");
      await quickAdd(dash, b, "101001", p3);
      await quickAdd(dash, b, "102002", p3);

      const kid = await t.computer("student");
      await kid.signIn(ANA);
      await kid.unlocked();
      const ana = await b.account(ANA), ben = await b.account(BEN), co = await b.account(CO), other = await b.account(OTHER);
      await until(() => b.stored(`students/${ana.uid}`), "the student's record");

      await reloadDashboard(dash);
      await openStudent(dash, ana.uid);
      await giveGames(dash, ["red-1-cards"]);
      await tab(dash, "notes");
      await dash.set("#tNote", NOTE);
      await dash.click("#tNoteSave");
      await until(async () => { same((await b.stored(`notes/${ana.uid}`))?.text, NOTE, "the note"); return true; }, "the note to be saved");
      await reloadDashboard(dash);
      await openStudent(dash, ana.uid);
      same(await dash.eval(`document.querySelector("#tNote").value`), NOTE, "the note after a reload");

      const paths = [`students/${ana.uid}`, `assignments/${ana.uid}`, `roster/${ANA.email}`, `notes/${ana.uid}`];
      assert(!(await b.canRead(ana, `notes/${ana.uid}`)), "the student can read the note about them");
      assert(!(await b.canRead(ben, `students/${ana.uid}`)), "a classmate can read the student's record");
      for (const p of paths) {
        assert(!(await b.canRead(co, p)), `a teacher not yet on the class can read ${p}`);
        assert(!(await b.canRead(other, p)), `another teacher can read ${p}`);
      }
      assert(!(await b.canWrite(ana, `assignments/${ana.uid}`, { lists: ["red-10-cards"] })), "a student can change their own games");
      assert(!(await b.canWrite(other, `notes/${ana.uid}`, { text: "x" })), "another teacher can change the note");

      await view(dash, "groups");
      await dash.set(`#tBody [data-co-pick="${p3}"]`, CO.email);
      await until(async () => { for (const p of paths) assert((await b.stored(p)).teachers.includes(CO.email), p); return true; },
        "every record of the student to name the co-teacher");
      for (const p of paths) assert(await b.canRead(co, p), `the co-teacher cannot read ${p}`);
      assert(await b.canList(co, "students", CO.email), "the co-teacher cannot list the class");
      const second = await t.computer("co-teacher");
      await openDashboard(second, CO);
      await openStudent(second, ana.uid);
      same(await second.eval(`document.querySelector("#tNote").value`), NOTE, "the note on the co-teacher's dashboard");
      noRefusals(second);

      await view(dash, "groups");
      await dash.click(`#tBody [data-unco="${p3}|${CO.email}"]`);
      await until(async () => { for (const p of paths) assert(!(await b.stored(p)).teachers.includes(CO.email), p); return true; },
        "the co-teacher to be taken off every record");
      for (const p of paths) assert(!(await b.canRead(co, p)), `a removed co-teacher can still read ${p}`);
      noRefusals(dash);
    },
  },
  {
    name: "teacher to student: archive, unarchive and a sequence for several",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER);
      const [ana, ben] = await seedClass(b, "p3", [TEACHER], [ANA, BEN], []);
      for (const a of [ana, ben]) await b.seed(`students/${a.uid}`, { email: a.email, name: a.name, classId: "p3", teachers: [TEACHER.email] });
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      const row = (a) => `!!document.querySelector('#tBody tr.clickable[data-uid="${a.uid}"]')`;

      await openStudent(dash, ben.uid);
      await tab(dash, "notes");
      await dash.click("#tArchive");
      await until(async () => !!(await b.stored("classes/p3")).archived?.[ben.uid], "the archive to be saved");
      await reloadDashboard(dash);
      await dash.wait(row(ana), "the table");
      assert(!(await dash.eval(row(ben))), "an archived student is still in the table");

      await view(dash, "manage");
      await dash.click(`#tBody [data-section="archived"]`);
      await dash.click(`#tBody [data-unarchive="${ben.uid}"]`);
      await until(async () => !(await b.stored("classes/p3")).archived?.[ben.uid], "the unarchive to be saved");
      await reloadDashboard(dash);
      await dash.wait(row(ben), "the unarchived student to return");

      for (const a of [ana, ben]) await dash.click(`#tBody [data-pick="${a.uid}"]`);
      await dash.click("#stGive");
      /* "Red Words, Lists 1 to 10", written out here from the README rather than read back from the dashboard. */
      const steps = Array.from({ length: 10 }, (_, i) => [`red-${i + 1}-cards`, `red-${i + 1}-say`]);
      await dash.wait(`!!document.querySelector('#giveSrc option[value="rm:red"]')`, "the ready-made Red Words sequence");
      await dash.set("#giveSrc", "rm:red");
      await dash.click("#giveGo");
      for (const a of [ana, ben]) {
        const doc = await until(async () => { const d = await b.stored(`assignments/${a.uid}`); return d && d.plan ? d : null; }, `a sequence for ${a.email}`);
        same(doc.plan.steps.map((s) => s.ids.slice().sort()), steps, "the lists in the sequence, in order");
        same(doc.lists.slice().sort(), steps[0], "the lists of the first step");
        const kid = await t.computer(a.email);
        await kid.signIn({ ...ANA, sub: a.sub, email: a.email, name: a.name });
        await kid.unlocked();
        same(await homeLists(kid), steps[0], `${a.name}'s home page`);
      }
      noRefusals(dash);
    },
  },
  {
    name: "teacher to student: Student view looks without writing",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER);
      const [ana] = await seedClass(b, "p3", [TEACHER], [ANA], ["red-1-cards"]);
      await b.seed(`students/${ana.uid}`, { email: ANA.email, name: ANA.name, classId: "p3", teachers: [TEACHER.email], totals: { n: 0, r: 0 }, lastSeen: 5 });
      const before = await b.stored(`students/${ana.uid}`);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      const me = await b.account(TEACHER);
      await dash.goto(`/index.html?preview=${encodeURIComponent(ana.uid)}`);
      await dash.unlocked();
      await dash.wait(`!!document.querySelector("#sections a[href*='list=red-1-cards']")`, "the student's games in Student view");
      /* Play a game inside Student view: answers are what would be written. */
      await playCards(dash, "red-1-cards", [true, false], {}, `&preview=${encodeURIComponent(ana.uid)}`);
      await sleep(7000);
      same(await b.stored(`students/${ana.uid}`), before, "the student's record after a look");
      same(await b.stored(`students/${me.uid}`), null, "the teacher's own record after a look");
      noRefusals(dash);
    },
  },
  {
    name: "teacher to student: the test student is added and removed",
    async run(t) {
      const b = t.backend;
      await seedTeachers(b, TEACHER);
      await b.seed("classes/p3", { name: "P3", teachers: [TEACHER.email] });
      const me = await b.account(TEACHER);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      await view(dash, "roster");
      await dash.click("#tTestAdd");
      await until(async () => (await b.stored(`assignments/${me.uid}`))?.test === true, "the test student to be saved");
      await dash.wait(`!!document.querySelector("#tTestOpen")`, "the test student's panel");
      await dash.click("#tTestOpen");
      await dash.eval(`localStorage.setItem("cardComeback:${me.uid}:red-1-cards", JSON.stringify({ words: { you: { n: 2, t: 1 } } }))`);
      await dash.click("#tTestRemove");
      await until(async () => (await b.stored(`assignments/${me.uid}`)) === null, "the test student to be removed");
      await dash.wait(`localStorage.getItem("cardComeback:${me.uid}:red-1-cards") === null`, "the test student's missed words to be forgotten");
      noRefusals(dash);
    },
  },
];
