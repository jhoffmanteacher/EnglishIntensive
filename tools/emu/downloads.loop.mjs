/* The files a teacher keeps. Known class data goes in; the two spreadsheets
   and the backup are downloaded with the real buttons, read back here, and
   compared record by record. Another teacher's student must not be in them. */
import { assert, same, parseCsv } from "./harness.mjs";
import { TEACHER, OTHER, seedTeachers, openDashboard, view } from "./flows.mjs";

const NOTE = 'First line, with a comma.\nSecond "line" – José';
const P3 = { classId: "p3", teachers: [TEACHER.email] };
const P9 = { classId: "p9", teachers: [OTHER.email] };
const stat = (n, r) => ({ n, r, w: n - r, s: 0, box: 1, last: 1795000000000, lat: 0, k: {} });
const STUDENTS = [
  { uid: "u1", email: "101001@seq.org", name: 'Nuñez, José "Joe"', ...P3, words: { "red-1-cards|you": stat(3, 2), "red-1-cards|should": stat(1, 0) }, note: NOTE },
  { uid: "u2", email: "102002@seq.org", name: "Ben Tran", ...P3, words: { "red-2-cards|give": stat(5, 5) }, note: null },
  { uid: "u3", email: "109009@seq.org", name: "Not Yours", ...P9, words: { "red-1-cards|you": stat(9, 9) }, note: "someone else's note" },
];
const MINE = STUDENTS.filter((s) => s.classId === "p3");

async function scene(b) {
  await seedTeachers(b, TEACHER, OTHER);
  await b.seed("classes/p3", { name: "P3", teachers: P3.teachers });
  await b.seed("classes/p9", { name: "P9", teachers: P9.teachers });
  for (const s of STUDENTS) {
    const st = { classId: s.classId, teachers: s.teachers };
    const n = Object.values(s.words).reduce((a, v) => a + v.n, 0), r = Object.values(s.words).reduce((a, v) => a + v.r, 0);
    await b.seed(`students/${s.uid}`, { email: s.email, name: s.name, ...st, words: s.words, totals: { n, r }, recent: [], lastSeen: 1795000000000 });
    await b.seed(`roster/${s.email}`, { name: s.name, id: s.email.split("@")[0], ...st });
    await b.seed(`assignments/${s.uid}`, { lists: [Object.keys(s.words)[0].split("|")[0]], updatedAt: 1, ...st });
    if (s.note) await b.seed(`notes/${s.uid}`, { text: s.note, updatedAt: 1, ...st });
  }
}

export const loops = [
  {
    name: "downloads: both spreadsheets hold every student and every number",
    async run(t) {
      await scene(t.backend);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      await view(dash, "roster");

      const roster = parseCsv((await dash.download("#tExportRoster")).text);
      const head = roster.shift(), col = (n) => { const i = head.indexOf(n); assert(i >= 0, `no "${n}" column`); return i; };
      same(roster.map((r) => r[col("Email")]).sort(), MINE.map((s) => s.email), "the students in the roster spreadsheet");
      for (const s of MINE) {
        const row = roster.find((r) => r[col("Email")] === s.email);
        same(row[col("Name")], s.name, "the name");
        same(row[col("Note")].replace(/\r/g, "").replace(/\s+/g, " "), (s.note || "").replace(/\s+/g, " "), `the note for ${s.email}`);
        same(Number(row[col("Answers")]), Object.values(s.words).reduce((a, v) => a + v.n, 0), `answers for ${s.email}`);
      }

      const words = parseCsv((await dash.download("#tExportWords")).text);
      const wh = words.shift(), w = (n) => { const i = wh.indexOf(n); assert(i >= 0, `no "${n}" column`); return i; };
      const got = words.map((r) => [r[w("Email")], r[w("Word")], Number(r[w("Attempts")]), Number(r[w("Correct")])].join(" ")).sort();
      const want = MINE.flatMap((s) => Object.entries(s.words).map(([k, v]) => [s.email, k.split("|")[1], v.n, v.r].join(" "))).sort();
      same(got, want, "the rows of the every-word spreadsheet");
    },
  },
  {
    name: "downloads: the backup equals the database, and only your classes",
    async run(t) {
      const b = t.backend;
      await scene(b);
      const dash = await t.computer("teacher");
      await openDashboard(dash, TEACHER);
      await view(dash, "manage");
      await dash.click(`#tBody [data-section="backup"]`);
      const file = await dash.download("#mBackup");
      const data = JSON.parse(file.text).collections;
      for (const col of ["students", "assignments", "notes", "roster", "classes"]) {
        const stored = await b.storedAll(col);
        const mine = Object.fromEntries(Object.entries(stored).filter(([, d]) => (d.teachers || []).includes(TEACHER.email)));
        same(data[col], mine, `the ${col} in the backup`);
      }
      assert(file.text.indexOf("Not Yours") === -1 && file.text.indexOf("someone else's note") === -1, "another teacher's student is in the backup");
    },
  },
];
