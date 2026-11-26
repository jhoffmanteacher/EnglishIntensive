/* A student's practice. Cards are rated with the real buttons and counted
   here; the count must come back the same from the stored record, after a
   reload, after signing out and in, and on a second computer. */
import { assert, same, until, sleep } from "./harness.mjs";
import { ANA, BEN, TEACHER, seedTeachers, seedClass, homeLists, playCards, tallyOfStored, tallyOnPage, signOut } from "./flows.mjs";

const LIST = "red-1-cards";

async function scene(t, lists = [LIST]) {
  await seedTeachers(t.backend, TEACHER);
  return seedClass(t.backend, "p3", [TEACHER], [ANA, BEN], lists);
}
/* The page keeps its own copy of the numbers. Throw it away, so what comes back can only have come from the database. */
const forgetCopy = (c, a) => c.eval(`localStorage.removeItem("eiStats:${a.uid}")`);
const storedTally = async (t, a) => tallyOfStored((await t.backend.stored(`students/${a.uid}`))?.words, LIST);
async function waitStored(t, a, want, what) {
  await until(async () => { same(await storedTally(t, a), want, "stored"); return true; }, `${what}: the stored record to match`);
}

export const loops = [
  {
    name: "progress: survives reload, sign-out and a second computer",
    async run(t) {
      const [ana] = await scene(t);
      const one = await t.computer("chromebook 1");
      await one.signIn(ANA);
      await one.unlocked();
      same(await homeLists(one), [LIST], "the games on the home page");

      const tally = await playCards(one, LIST, [true, true, false, true]);
      await waitStored(t, ana, tally, "after playing");
      await forgetCopy(one, ana);
      await one.reload();
      await one.unlocked();
      same(await tallyOnPage(one, LIST), tally, "what the page holds after a reload");

      /* Sign out straight after the last answer: the save has to go first. */
      await playCards(one, LIST, [false, true], tally);
      await signOut(one);
      same(await storedTally(t, ana), tally, "stored, the moment sign-out finished");
      await forgetCopy(one, ana);
      await one.signIn(ANA);
      await one.unlocked();
      await one.goto(`/cards-game.html?list=${LIST}`);
      await one.unlocked();
      same(await tallyOnPage(one, LIST), tally, "after signing back in");

      const two = await t.computer("chromebook 2");
      await two.signIn(ANA);
      await two.unlocked();
      await two.goto(`/cards-game.html?list=${LIST}`);
      await two.unlocked();
      same(await tallyOnPage(two, LIST), tally, "on a second computer");
      await playCards(two, LIST, [true, true, true], tally);
      await waitStored(t, ana, tally, "after playing on the second computer");
      await forgetCopy(one, ana);
      await one.reload();
      await one.unlocked();
      same(await tallyOnPage(one, LIST), tally, "back on the first computer");
      same((await t.backend.stored(`students/${ana.uid}`)).totals.n, Object.values(tally).reduce((a, v) => a + v.n, 0), "the total number of answers");
    },
  },
  {
    name: "progress: the next student on the same computer gets none of it",
    async run(t) {
      const [ana, ben] = await scene(t);
      const c = await t.computer("shared chromebook");
      await c.signIn(ANA);
      await c.unlocked();
      const tally = await playCards(c, LIST, [true, false, true]);
      await waitStored(t, ana, tally, "Ana");
      await signOut(c);

      await c.signIn(BEN);
      await c.unlocked();
      /* Ben's FIRST page: nothing is stored for them yet, so anything here was left behind by Ana. */
      same(await tallyOnPage(c, LIST), {}, "what Ben's page holds");
      const bens = await playCards(c, LIST, [false, true]);
      await waitStored(t, ben, bens, "Ben");
      await sleep(2000);
      same(await storedTally(t, ben), bens, "what is stored for Ben is only their own");
      same(await storedTally(t, ana), tally, "Ana's record, untouched");
    },
  },
  {
    name: "shared computer: one student's missed words are not offered to the next",
    async run(t) {
      await scene(t);
      const c = await t.computer("shared chromebook");
      await c.signIn(ANA);
      await c.unlocked();
      /* A whole round with misses, so the game saves its practice pile. */
      await c.goto(`/cards-game.html?list=${LIST}`);
      await c.unlocked();
      await c.click("#btnStart");
      for (let i = 0; i < 40; i++) {
        const state = await c.wait(`(function(){
          var end = document.getElementById("s-end");
          if(end && end.offsetParent !== null) return "end";
          var f = document.getElementById("btnFlip");
          return f && getComputedStyle(f).display !== "none" && f.offsetParent !== null ? "card" : ""; })()`, "a card or the end screen");
        if (state === "end") break;
        await c.click("#btnFlip");
        await c.wait(`(function(){ var b = document.getElementById("btnMiss"); return getComputedStyle(b).display !== "none"; })()`, "the rating buttons");
        await c.click("#btnMiss");
        await c.wait(`getComputedStyle(document.getElementById("btnMiss")).display === "none" || document.getElementById("s-end").offsetParent !== null`, "the card to go");
      }
      const offered = `(function(){ var b = document.getElementById("btnComeback"); return !!b && getComputedStyle(b).display !== "none" && !b.hidden; })()`;
      await c.goto(`/cards-game.html?list=${LIST}`);
      await c.unlocked();
      await sleep(500);
      assert(await c.eval(offered), "Ana's own missed-word pile is not offered back to her (so this loop cannot see one)");
      await signOut(c);

      await c.signIn(BEN);
      await c.unlocked();
      await c.goto(`/cards-game.html?list=${LIST}`);
      await c.unlocked();
      await sleep(500);
      await c.wait(`!!document.querySelector("#btnStart")`, "Ben's game to start");
      assert(!(await c.eval(offered)), "Ben is offered the words Ana missed");
    },
  },
  {
    name: "shared computer: each game keeps each student's own missed-word pile",
    async run(t) {
      const GAMES = [["cards-game.html", "card", "red-1-cards"], ["match-game.html", "match", "red-1-match"], ["say-game.html", "blend", "red-1-say"]];
      const [ana] = await scene(t, GAMES.map((g) => g[2]));
      const c = await t.computer("shared chromebook");
      const open = async (page, list) => {
        await c.goto(`/${page}?list=${list}`);
        await c.unlocked();
        await c.wait(`!!document.querySelector("#btnStart")`, `${page} to start`);
        await sleep(500);
        return c.eval(`document.querySelector("#btnComeback").style.display !== "none"`);
      };
      await c.signIn(ANA);
      await c.unlocked();
      for (const [, kind, list] of GAMES) {
        await c.eval(`localStorage.setItem("${kind}Comeback:${ana.uid}:${list}", JSON.stringify({ words: { you: { n: 2, t: 1 } } }))`);
      }
      for (const [page, , list] of GAMES) assert(await open(page, list), `${page} does not offer Ana her own pile`);
      await signOut(c);
      await c.signIn(BEN);
      await c.unlocked();
      for (const [page, , list] of GAMES) assert(!(await open(page, list)), `${page} offers Ben Ana's pile`);
    },
  },
];
