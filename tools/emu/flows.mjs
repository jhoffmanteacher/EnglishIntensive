/* The things a person does on the site, shared by the loops. Every action
   goes through the page's own controls. */
import { ADMIN, person, until, sleep, assert } from "./harness.mjs";

export const TEACHER = person("teacher.one@seq.org", "Teacher One");
export const CO = person("teacher.two@seq.org", "Teacher Two");
export const OTHER = person("teacher.other@seq.org", "Teacher Other");
export const ANA = person("101001@seq.org", "Ana Lopez");
export const BEN = person("102002@seq.org", "Ben Tran");

/* Who the admin has added as a teacher. (The admin's own step; set directly.) */
export async function seedTeachers(backend, ...who) {
  for (const t of who) await backend.seed(`teachers/${t.email}`, { email: t.email, name: t.name, addedAt: 1, addedBy: ADMIN });
}

/* A class with these students already imported and given lists: the scene for loops that are not about the dashboard.
   Returns the students with their uid and token. */
export async function seedClass(backend, classId, teachers, students, lists) {
  const emails = teachers.map((t) => t.email);
  await backend.seed(`classes/${classId}`, { name: classId, teachers: emails });
  const out = [];
  for (const s of students) {
    const a = await backend.account(s);
    const stamp = { classId, teachers: emails };
    await backend.seed(`roster/${s.email}`, { name: s.name, id: s.email.split("@")[0], ...stamp });
    await backend.seed(`assignments/${a.uid}`, { lists, updatedAt: 1, ...stamp });
    out.push(a);
  }
  return out;
}

/* ── the student ─────────────────────────────────────────────────────── */

/* Which games the home page offers: the ?list= of every link on it. */
export async function homeLists(c) {
  await c.goto("/index.html");
  await c.unlocked();
  await sleep(300);
  return c.eval(`Array.from(document.querySelectorAll("#sections a[href]")).map(function(a){
    var m = /[?&]list=([^&#]+)/.exec(a.getAttribute("href")); return m ? m[1] : a.getAttribute("href"); }).sort()`);
}

/* Play flash cards with the real buttons. `got` is one true/false per card.
   Returns what was answered, counted here and not by the site: { word: {n, r} }. */
export async function playCards(c, listId, got, tally = {}) {
  await c.goto(`/cards-game.html?list=${listId}`);
  await c.unlocked();
  await c.click("#btnStart");
  const shown = (id) => `(function(){ var b = document.getElementById("${id}"); return !!b && getComputedStyle(b).display !== "none" && b.offsetParent !== null; })()`;
  let last = "";
  for (const right of got) {
    await c.wait(shown("btnFlip") + ` && WordLists.plain(document.getElementById("uiWord").textContent.trim()) !== ${JSON.stringify(last)}`, "the next card");
    const word = await c.eval(`WordLists.plain(document.getElementById("uiWord").textContent.trim())`);
    assert(await c.eval(`WordLists.wordsOf(${JSON.stringify(listId)}).map(WordLists.plain).indexOf(${JSON.stringify(word)}) !== -1`),
      `the card shows "${word}", which is not a word of ${listId}`);
    await c.click("#btnFlip");
    await c.wait(shown(right ? "btnGot" : "btnMiss"), "the rating buttons");
    await c.click(right ? "#btnGot" : "#btnMiss");
    const t = (tally[word] ||= { n: 0, r: 0 });
    t.n += 1;
    if (right) t.r += 1;
    last = word;
  }
  return tally;
}

/* { word: {n, r} } from a map keyed "list|word" (a stored document) … */
export function tallyOfStored(words, listId) {
  const out = {};
  for (const [k, v] of Object.entries(words || {})) {
    const i = k.indexOf("|");
    if (k.slice(0, i) === listId) out[k.slice(i + 1)] = { n: v.n, r: v.r };
  }
  return out;
}
/* … and from what the student's page holds after loading. */
export function tallyOnPage(c, listId) {
  return c.eval(`EIAuth.ready().then(function(){ return EIStore.ready(); }).then(function(){
    var s = EIStore.statsFor(${JSON.stringify(listId)}), out = {};
    Object.keys(s).forEach(function(w){ if(s[w].n) out[w] = { n: s[w].n, r: s[w].r }; });
    return out; })`);
}

export async function signOut(c) {
  await c.eval("window.__old = true");
  await c.click("#ei-chip-out");
  await until(() => c.eval(`!window.__old && !!document.querySelector("#ei-wall-signin") && !document.querySelector("#ei-wall-signin").hidden`),
    `${c.name}: the sign-in screen after signing out`, 30000);
}

/* ── the teacher ─────────────────────────────────────────────────────── */
const NAV_READY = `(function(){ var n = document.getElementById("tNav"); return !!n && !n.hidden && !document.documentElement.classList.contains("ei-locked"); })()`;

export async function openDashboard(c, who) {
  await c.signIn(who, "/teacher.html");
  await c.wait(NAV_READY, "the dashboard", 30000);
}
/* A fresh load: what the dashboard shows now comes from the database, not from what the page remembered. */
export async function reloadDashboard(c) {
  await c.reload();
  await c.wait(NAV_READY, "the dashboard after a reload", 30000);
}
export async function view(c, name) {
  await c.click(`#tNav .tNav[data-view="${name}"]`);
}
export async function openStudent(c, uid) {
  await view(c, "roster");
  await c.click(`#tBody tr.clickable[data-uid="${uid}"]`);
  await c.wait(`!!document.querySelector("#stuHead")`, "the student's page");
}
export const tab = (c, name) => c.click(`#stab-${name}`);

export async function createClass(c, backend, name) {
  await view(c, "groups");
  await c.set("#tAddClass", name);
  await c.click("#tAddClassBtn");
  return until(async () => Object.entries(await backend.storedAll("classes")).find(([, v]) => v.name === name)?.[0], `the class ${name} to be saved`);
}

export async function quickAdd(c, backend, id, classId) {
  await view(c, "roster");
  if (classId) await c.set("#tQuickClass", classId);
  await c.set("#tQuickId", id);
  await c.click("#tQuickBtn");
  await until(() => backend.stored(`roster/${id}@seq.org`), `the roster row for ${id}`);
  await c.wait(`!!document.querySelector('#tBody tr.clickable[data-uid="roster:${id}@seq.org"]')`, "the new row in the table");
}

/* Tick exactly these games on the open student's page and press Save games. */
export async function giveGames(c, lists) {
  await tab(c, "lists");
  await c.wait(`!!document.querySelector("#tBody #tSaveA")`, "the game picker");
  await c.eval(`Array.from(document.querySelectorAll("#tBody #tSaveA")[0] && document.querySelectorAll("#tBody input[data-scope][data-list]"))
    .forEach(function(cb){ var want = ${JSON.stringify(lists)}.indexOf(cb.dataset.list) !== -1;
      if(cb.checked !== want){ cb.checked = want; cb.dispatchEvent(new Event("change", { bubbles: true })); } })`);
  await c.click("#tSaveA");
}

/* No write the dashboard made may have been refused: a refused one often only shows a small line. */
export function noRefusals(c) {
  const bad = c.log.filter((l) => /permission|PERMISSION_DENIED|insufficient/i.test(l));
  assert(!bad.length, `the database refused something on ${c.name}: ${bad[0]}`);
}
