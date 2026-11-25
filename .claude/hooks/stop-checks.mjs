#!/usr/bin/env node
/* Claude Code Stop hook (2026-11-25): the fast checks, at the end of every turn.

   When Claude finishes a turn and site files have changed since HEAD, this runs
   the checks that need no server and no browser (a few seconds in all):

     - `node --check` on every root-level .js file and every tools/*.mjs
     - `node tools/save-loop.mjs` (last line must contain "failures: none",
       and it must exit 0)

   If one fails, it BLOCKS the stop and hands the failure back, so the fix
   happens in the same turn instead of at commit time. Wired in
   .claude/settings.json. Modelled on the guitar-class repo's stop hook.

   It does NOT run the Chrome checks (tools/run-tests.sh, check-pages.sh,
   boot-check.sh). Those need a server and a browser, and still have to be run
   by hand before a commit (CLAUDE.md, "Before committing"). GitHub runs them
   on every push.

   Quiet when all is well: no output, exit 0. A failure is reported the way
   Claude Code expects: one JSON object on stdout, {"decision":"block",
   "reason":...}, exit 0.

   Built so that it can never trap a session:
   - It does nothing when no site file differs from HEAD (a turn that only
     answered a question costs nothing), and nothing when the changed files
     are exactly those it already checked and found good.
   - It blocks at most MAX_BLOCKS times per turn (prompt_id), and never twice
     for the exact same file contents (if Claude changed nothing, there is
     nothing new to say). Claude Code also caps stop-hook continuations itself.
   - Every internal problem (no git, no node, a timeout) fails OPEN: the stop
     is allowed, with a short note.
   - Off switch: set EI_STOP_CHECKS=0 in the environment.

   Node only (no bash, no jq), so it runs the same on macOS and Windows. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_BLOCKS = 3;
const CHECK_TIMEOUT_MS = 40000;
// Files whose change means "re-run the checks". Notes and docs (*.md) are not
// site files; .claude/ is configuration; audio/ and fonts/ are not text.
const SITE = /\.(js|mjs|css|html|json|rules)$/i;
const SKIP = /^(\.claude\/|audio\/|fonts\/|node_modules\/)/;

const done = (obj) => { if (obj) console.log(JSON.stringify(obj)); process.exit(0); };
const note = (msg) => done({ systemMessage: msg });

if (process.env.EI_STOP_CHECKS === '0') done();

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin payload: fine */ }

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
let root;
try { root = git(input.cwd || process.cwd(), 'rev-parse', '--show-toplevel').trim(); } catch { done(); }   // not a git checkout
if (!existsSync(join(root, 'tools', 'save-loop.mjs'))) done();                                            // not this repo

// Changed site files: modified, added, renamed and untracked (not ignored).
function changedSiteFiles() {
  let out;
  try { out = git(root, 'status', '--porcelain=v1', '-z', '-uall'); } catch { return []; }
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i].slice(0, 2), path = parts[i].slice(3);
    if (status[0] === 'R' || status[0] === 'C') i++;          // the next entry is the old path
    if (SITE.test(path) && !SKIP.test(path)) files.push(path); // a deleted file still counts: others may use it
  }
  return [...new Set(files)].sort();
}
const fingerprint = (files) => {
  const h = createHash('sha1');
  for (const f of files) {
    let c = '';
    try { c = createHash('sha1').update(readFileSync(join(root, f))).digest('hex'); } catch { c = 'gone'; }
    h.update(f + '\0' + c + '\0');
  }
  return h.digest('hex');
};

const files = changedSiteFiles();
if (!files.length) done();

const statePath = join(tmpdir(), `ei-stop-checks-${String(input.session_id || 'nosession').replace(/[^\w-]/g, '')}-${createHash('sha1').update(root).digest('hex').slice(0, 8)}.json`);
let state = {};
try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
const save = (s) => { try { writeFileSync(statePath, JSON.stringify(s)); } catch { /* best effort */ } };

const fp = fingerprint(files);
if (state.fp === fp && state.result === 'pass') done();                                 // already verified this exact state
if (state.fp === fp && state.result === 'fail') note('Stop-hook checks still fail on the same files; not blocking again.');

const failures = [];
const run = (args) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, maxBuffer: 1 << 26 });

// 1. node --check on every root-level .js and every tools/*.mjs.
const targets = [
  ...readdirSync(root).filter((f) => f.endsWith('.js')),
  ...(existsSync(join(root, 'tools')) ? readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => 'tools/' + f) : []),
].sort();
for (const f of targets) {
  const r = run(['--check', f]);
  if (r.error || r.status === null) note(`Stop-hook checks could not run (${r.error ? r.error.code || r.error.message : 'timed out'}); allowing the stop.`);
  if (r.status !== 0) failures.push(`node --check ${f} failed:\n${(r.stderr || r.stdout).trim().split('\n').slice(0, 8).join('\n')}`);
}

// 2. The closed loop: last line must say "failures: none" and the exit must be 0.
{
  const r = run(['tools/save-loop.mjs']);
  if (r.error || r.status === null) note(`Stop-hook checks could not run (${r.error ? r.error.code || r.error.message : 'timed out'}); allowing the stop.`);
  const out = (r.stdout || '').trim().split('\n');
  const last = out[out.length - 1] || '';
  if (r.status !== 0 || !last.includes('failures: none')) {
    failures.push(`node tools/save-loop.mjs failed (exit ${r.status}); the last line must contain "failures: none". Last lines:\n${out.slice(-25).join('\n')}${r.stderr ? '\n' + r.stderr.trim().split('\n').slice(-5).join('\n') : ''}`);
  }
}

// 3. FURTHER NODE-ONLY LOOPS GO HERE: one more block like the one above, one per
//    loop, each only if it needs no server and no browser and finishes in seconds.
//    (A sequence loop, tools/sequence-loop.mjs, is being built elsewhere and
//    will be listed here when it has a Node-only quick mode.)

if (!failures.length) { save({ fp, result: 'pass', blocks: 0, turn: String(input.prompt_id || '') }); done(); }

// The retry budget is per turn (prompt_id): a failure left unfixed in one turn
// must not make the hook give up instantly in every later turn.
const turn = String(input.prompt_id || '');
const blocks = (state.turn === turn ? state.blocks || 0 : 0) + 1;
save({ fp, result: 'fail', blocks, turn });
if (blocks > MAX_BLOCKS) note(`Stop-hook checks still fail after ${MAX_BLOCKS} tries; handing back to you. First failure: ${failures[0].split('\n')[0]}`);

done({
  decision: 'block',
  reason: [
    `The repo's fast checks fail after your edits (${files.slice(0, 8).join(', ')}${files.length > 8 ? ', ...' : ''}).`,
    'Fix the cause; do not loosen a check. (These are the Node-only checks; the Chrome checks are still run by hand before a commit.)',
    `Re-run the failing command above to see it pass (attempt ${blocks} of ${MAX_BLOCKS}).`,
    '',
    ...failures,
  ].join('\n'),
});
