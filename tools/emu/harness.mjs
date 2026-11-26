/* Shared pieces for the emulator loops (tools/emu-loop.mjs and
   tools/emu/*.loop.mjs). Node 22 and a Chrome; no packages.

   WHAT IS REAL: the site's own pages and scripts, the Firebase SDK they
   load from gstatic, firestore.rules, and the Firebase Auth and Firestore
   EMULATORS (practice copies of Firebase that run on the same machine).
   WHAT IS NOT: Google's sign-in popup (tools/emu/shim.js), the project id
   (demo-ei, which cannot reach a real project), and the microphone.

   Chrome is blocked from every Google API and Firebase host, and a loop
   fails if a page so much as asks for one. */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");
export const PROJECT = "demo-ei";
export const ADMIN = "jhoffman@seq.org";            // firebase-config.js and firestore.rules
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function assert(c, msg) { if (!c) throw new Error(msg); }
export function same(got, want, what) {
  const a = canon(got), b = canon(want);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v) ?? "undefined";
}
/* Waits for fn() to return something truthy; the last error or value is in the message. */
export async function until(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { const v = await fn(); if (v) return v; last = v; } catch (e) { last = e.message; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (last: ${String(JSON.stringify(last)).slice(0, 300)})`);
    await sleep(150);
  }
}

/* ── the emulators, from the outside ─────────────────────────────────── */
function emulatorHost(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run this inside "firebase emulators:exec" (GitHub does)`);
  const [host, port] = v.split(":");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error(`${name} is not on this machine: ${v}`);
  return { host: "127.0.0.1", port: Number(port) };
}
export function emulators() {
  return { fs: emulatorHost("FIRESTORE_EMULATOR_HOST"), auth: emulatorHost("FIREBASE_AUTH_EMULATOR_HOST") };
}

async function api(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

/* Firestore's REST value format, both ways. */
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
function dec(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return decFields(v.mapValue.fields || {});
  return undefined;
}
const decFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));

export class Backend {
  constructor(root) {
    const e = emulators();
    this.root = root;
    this.fsBase = `http://${e.fs.host}:${e.fs.port}`;
    this.authBase = `http://${e.auth.host}:${e.auth.port}`;
    this.docs = `${this.fsBase}/v1/projects/${PROJECT}/databases/(default)/documents`;
  }
  /* An empty database, no accounts, and the repo's rules (the --root copy's, so a planted fault in them counts). */
  async reset() {
    const rules = fs.readFileSync(path.join(this.root, "firestore.rules"), "utf8");
    const a = await api("DELETE", `${this.fsBase}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
    const b = await api("DELETE", `${this.authBase}/emulator/v1/projects/${PROJECT}/accounts`);
    const c = await api("PUT", `${this.fsBase}/emulator/v1/projects/${PROJECT}:securityRules`,
      { rules: { files: [{ name: "firestore.rules", content: rules }] } });
    for (const [n, r] of [["clear the database", a], ["clear the accounts", b], ["load the rules", c]]) {
      if (!r.ok) throw new Error(`could not ${n}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    }
  }
  /* Past the rules ("Bearer owner" is the emulator's admin door): to set a scene, and to read what is really stored. */
  async seed(docPath, data) {
    const r = await api("PATCH", `${this.docs}/${docPath}`, { fields: encFields(data) }, "owner");
    if (!r.ok) throw new Error(`seed ${docPath}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  }
  async stored(docPath) {
    const r = await api("GET", `${this.docs}/${docPath}`, undefined, "owner");
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`read ${docPath}: ${r.status}`);
    return decFields(r.json.fields || {});
  }
  async storedAll(collection) {
    const r = await api("GET", `${this.docs}/${collection}?pageSize=300`, undefined, "owner");
    if (!r.ok) throw new Error(`list ${collection}: ${r.status}`);
    return Object.fromEntries((r.json.documents || []).map((d) => [d.name.split("/").pop(), decFields(d.fields || {})]));
  }
  /* A real emulator token for one account: the same account the browser gets for the same `who`. */
  async account(who) {
    const r = await api("POST", `${this.authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`, {
      postBody: `id_token=${encodeURIComponent(JSON.stringify(who))}&providerId=google.com`,
      requestUri: "http://localhost", returnSecureToken: true,
    });
    if (!r.ok) throw new Error(`sign in ${who.email}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    return { ...who, uid: r.json.localId, token: r.json.idToken };
  }
  /* THROUGH the rules, as that person. Each answers true (allowed) or false (refused); anything else throws. */
  async canRead(acct, docPath) { return this.#allowed(await api("GET", `${this.docs}/${docPath}`, undefined, acct?.token)); }
  async canList(acct, collection, teacherEmail) {
    const q = { structuredQuery: { from: [{ collectionId: collection }] } };
    if (teacherEmail) q.structuredQuery.where = { fieldFilter: { field: { fieldPath: "teachers" }, op: "ARRAY_CONTAINS", value: { stringValue: teacherEmail } } };
    return this.#allowed(await api("POST", `${this.docs}:runQuery`, q, acct?.token));
  }
  async canWrite(acct, docPath, data) {
    const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
    return this.#allowed(await api("PATCH", `${this.docs}/${docPath}?${mask}`, { fields: encFields(data) }, acct?.token));
  }
  #allowed(r) {
    if (r.ok || r.status === 404) return true;      // 404: allowed to ask, nothing there
    if (r.status === 403 || r.status === 401) return false;
    throw new Error(`the emulator answered ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  }
}

/* Who the loops sign in as. `sub` is Google's account number: the same one is the same account on any computer. */
export const person = (email, name, extra = {}) =>
  ({ sub: "sub-" + email.replace(/[^a-z0-9]/gi, "-"), email, email_verified: true, name, ...extra });

/* ── the site, served from ROOT with the SDK pointed at the emulators ── */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg", ".png": "image/png",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf" };
const AUTH_TAG = /(<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-auth-compat\.js"><\/script>)/;

export function serveSite(root) {
  const e = emulators();
  const shim = fs.readFileSync(path.join(HERE, "shim.js"), "utf8")
    .replace("__AUTH__", `http://127.0.0.1:${e.auth.port}`)
    .replace("__FS_HOST__", "127.0.0.1")
    .replace("__FS_PORT__", String(e.fs.port));
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const send = (type, body) => { res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); };
    if (p === "/__emu/shim.js") return send(TYPES[".js"], shim);
    const file = path.join(root, path.normalize(p === "/" ? "/index.html" : p));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      const ext = path.extname(file);
      if (path.dirname(file) === root && ext === ".html") {
        let html = data.toString("utf8");
        if (AUTH_TAG.test(html)) {
          /* The pages' own policy, widened only to let them reach the emulators. */
          const widened = html.replace(/connect-src 'self'/, "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*");
          if (widened === html) { res.writeHead(500); return res.end("emu harness: no connect-src to widen in " + p); }
          html = widened.replace(AUTH_TAG, '$1<script src="/__emu/shim.js"></script>');
        }
        return send(TYPES[ext], html);
      }
      if (file === path.join(root, "firebase-config.js")) {
        return send(TYPES[ext], data.toString("utf8") +
          `\nfirebaseConfig.projectId = "${PROJECT}"; firebaseConfig.apiKey = "demo-key"; firebaseConfig.authDomain = "${PROJECT}.firebaseapp.com";\n`);
      }
      send(TYPES[ext] || "application/octet-stream", data);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () =>
    resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close(); } })));
}

/* ── Chrome, driven over its own debugging protocol ──────────────────── */
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const c of ["google-chrome", "chromium", "chrome"]) {
    const r = spawnSync("sh", ["-c", `command -v "${c}"`], { encoding: "utf8" });
    if (r.stdout && r.stdout.trim()) return r.stdout.trim().split("\n")[0];
  }
  throw new Error("no Chrome found (set CHROME=...)");
}

const BLOCKED = ["*.googleapis.com", "*.firebaseapp.com", "*.firebaseio.com", "apis.google.com", "accounts.google.com"]
  .map((h) => `MAP ${h} ~NOTFOUND`).join(", ");
const FORBIDDEN = /^(https?|wss?):\/\/([^/]*\.)?(googleapis\.com|firebaseio\.com|firebaseapp\.com)(\/|:|$)/;
/* Fonts are the one googleapis.com host a page asks for that holds no data. */
const HARMLESS = /^https:\/\/fonts\.googleapis\.com\//;

export async function launchBrowser() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ei-emu-"));
  const proc = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--mute-audio",
    `--user-data-dir=${dir}`, `--host-resolver-rules=${BLOCKED}`, "--remote-debugging-port=0",
    "--window-size=1366,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let err = "";
    const t = setTimeout(() => reject(new Error("Chrome did not start: " + err.slice(-400))), 30000);
    proc.stderr.on("data", (d) => {
      err += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on("exit", (c) => { clearTimeout(t); reject(new Error(`Chrome exited ${c}: ${err.slice(-400)}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("no DevTools socket")); });

  let nextId = 0;
  const waiting = new Map(), listeners = new Map();   // sessionId -> fn
  const downloads = new Map();                         // guid -> {name, dir, done}
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined) {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      return m.error ? w.reject(new Error(`${w.method}: ${m.error.message}`)) : w.resolve(m.result);
    }
    if (m.method === "Browser.downloadWillBegin") downloads.set(m.params.guid, { name: m.params.suggestedFilename, state: "inProgress" });
    if (m.method === "Browser.downloadProgress" && downloads.has(m.params.guid)) downloads.get(m.params.guid).state = m.params.state;
    if (m.sessionId && listeners.has(m.sessionId)) listeners.get(m.sessionId)(m.method, m.params);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  return {
    send, listeners, downloads,
    close() {
      try { ws.close(); } catch {}
      proc.kill("SIGKILL");
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

/* One computer: its own storage, so its own sign-in. */
export async function computer(browser, base, name) {
  const { browserContextId } = await browser.send("Target.createBrowserContext");
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "ei-dl-"));
  await browser.send("Browser.setDownloadBehavior", { behavior: "allowAndName", browserContextId, downloadPath: downloadDir, eventsEnabled: true });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const log = [], forbidden = [], dialogs = [];
  browser.listeners.set(sessionId, (method, p) => {
    if (method === "Runtime.consoleAPICalled" && (p.type === "error" || p.type === "warning")) {
      log.push(`console.${p.type}: ` + p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
    } else if (method === "Runtime.exceptionThrown") {
      log.push("uncaught: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).slice(0, 300));
    } else if (method === "Log.entryAdded" && p.entry.level === "error") {
      log.push("log: " + p.entry.text.slice(0, 300) + (p.entry.url ? " " + p.entry.url : ""));
    } else if (method === "Network.requestWillBeSent") {
      if (FORBIDDEN.test(p.request.url) && !HARMLESS.test(p.request.url)) forbidden.push(p.request.url);
    } else if (method === "Page.javascriptDialogOpening") {
      dialogs.push(p.message);
      send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");

  const c = {
    name, log, forbidden, dialogs,
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${name}: ${(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 400)}`);
      return r.result.value;
    },
    async goto(url) {
      await send("Page.navigate", { url: base + url });
      await until(() => c.eval(`document.readyState === "complete" && location.href.indexOf(${JSON.stringify(base)}) === 0`), `${name}: ${url} to load`);
    },
    async reload() {
      await c.eval("window.__old = true");
      await send("Page.reload", {});
      await until(() => c.eval(`!window.__old && document.readyState === "complete"`), `${name}: the reload`);
    },
    wait(expr, what, ms) { return until(() => c.eval(expr), `${name}: ${what || expr}`, ms); },
    async click(selector) {
      await c.wait(`!!document.querySelector(${JSON.stringify(selector)})`, `${selector} to appear`);
      await c.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    },
    /* Type into a box, or choose from a list, the way the page's listeners hear it. */
    async set(selector, value) {
      await c.wait(`!!document.querySelector(${JSON.stringify(selector)})`, `${selector} to appear`);
      await c.eval(`(function(){ var el = document.querySelector(${JSON.stringify(selector)});
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    },
    text(selector) { return c.eval(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent || ""`); },
    /* Open the page signed out and press the real Sign in button as `who`. */
    async signIn(who, url = "/index.html") {
      await c.goto(url);
      await c.wait(`(function(){ var s = document.querySelector("#ei-wall-signin"); return !!s && !s.hidden; })()`, "the sign-in button");
      await c.eval(`localStorage.setItem("__emu.who", ${JSON.stringify(JSON.stringify(who))})`);
      await c.click("#ei-wall-btn");
    },
    /* Signed in and the page ready: the wall is down. */
    unlocked() { return c.wait(`!document.documentElement.classList.contains("ei-locked") && !!document.querySelector("#ei-user-chip:not([hidden])")`, "the sign-in wall to come down", 30000); },
    /* The files a click produced, by suggested name. */
    async download(selector) {
      const before = new Set(browser.downloads.keys());
      await c.click(selector);
      const guid = await until(() => [...browser.downloads.keys()].find((k) => !before.has(k) && browser.downloads.get(k).state === "completed"), `${name}: a download from ${selector}`);
      return { name: browser.downloads.get(guid).name, text: fs.readFileSync(path.join(downloadDir, guid), "utf8") };
    },
    async close() {
      browser.listeners.delete(sessionId);
      await browser.send("Target.disposeBrowserContext", { browserContextId });
      try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch {}
    },
  };
  return c;
}

/* RFC 4180, enough for the site's own exports. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
