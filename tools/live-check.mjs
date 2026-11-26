#!/usr/bin/env node
/* live-check.mjs — closed loop: is the published site the repo?

     node tools/live-check.mjs [--wait=SECONDS] [--url=https://.../]

   Fetches every committed site file from GitHub Pages and compares the bytes
   with this checkout. With --wait it keeps trying while Pages is still
   publishing. Reads public files only; signs in to nothing.
   Exit 0 = every file matches; 1 = some differ or are missing. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => (process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)) || "").slice(n.length + 3) || d;
const BASE = arg("url", "https://jhoffmanteacher.github.io/EnglishIntensive/").replace(/\/?$/, "/");
const WAIT = Number(arg("wait", "0")) * 1000;
/* What a browser is served: pages, scripts, styles and the files they use. */
const SITE = /^([^/]+\.(html|js|css|svg)|(audio|fonts|data)\/.+)$/;

const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter((f) => SITE.test(f));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const want = new Map(files.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))]));

async function check(list) {
  const bad = [];
  const queue = list.slice();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f; (f = queue.shift());) {
      try {
        const res = await fetch(BASE + f.split("/").map(encodeURIComponent).join("/") + `?check=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) bad.push([f, `HTTP ${res.status}`]);
        else if (sha(Buffer.from(await res.arrayBuffer())) !== want.get(f)) bad.push([f, "differs from the repo"]);
      } catch (e) { bad.push([f, e.message]); }
    }
  }));
  return bad.sort((a, b) => a[0].localeCompare(b[0]));
}

const end = Date.now() + WAIT;
let bad = await check(files);
while (bad.length && Date.now() < end) {
  await new Promise((r) => setTimeout(r, 30000));
  bad = await check(bad.map((b) => b[0]));
}
for (const [f, why] of bad.slice(0, 20)) console.log(`FAIL ${f}: ${why}`);
const line = bad.length ? `${bad.length} of ${files.length} files on the site do not match` : `live site matches: ${files.length} files`;
console.log(line);
if (process.env.GITHUB_ACTIONS && bad.length) console.log(`::error title=live site::${line}: ${bad.slice(0, 8).map((b) => b[0]).join(", ")}`);
process.exit(bad.length ? 1 : 0);
