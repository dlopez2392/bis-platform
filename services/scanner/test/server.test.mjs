import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createScanner } from "../src/server.mjs";
import { sign } from "../src/hmac.mjs";
import { startFakeClamd } from "./fake-clamd.mjs";
import { eicar, cleanPdf } from "./eicar.mjs";

const SECRET = "server-test-secret-0001";
let clamd, storage, elsewhere, scanner, base, origin, elsewhereOrigin;
const logs = [];
const hits = [];
const elsewhereHits = [];
const FILES = {
  "clean.pdf": cleanPdf(2048),
  "bad.pdf": Buffer.concat([Buffer.from("%PDF-1.4\n% "), Buffer.from(eicar()), Buffer.from("\n%%EOF\n")]),
  "err.pdf": Buffer.concat([cleanPdf(100), Buffer.from("FAKE-CLAMD-ERROR")]),
  "locked.pdf": Buffer.concat([cleanPdf(100), Buffer.from("FAKE-CLAMD-ENCRYPTED")]),
  "big-declared.pdf": cleanPdf(5000),
  "big-chunked.pdf": cleanPdf(5000),
};
const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

before(async () => {
  clamd = await startFakeClamd();
  elsewhere = http.createServer((req, res) => { elsewhereHits.push(req.url); res.writeHead(200, { "content-length": "2048" }).end(cleanPdf(2048)); });
  elsewhereOrigin = `http://127.0.0.1:${await listen(elsewhere)}`;
  storage = http.createServer((req, res) => {
    hits.push(req.url);
    const name = new URL(req.url, "http://x").pathname.split("/").pop();
    if (name === "moved.pdf") {
      res.writeHead(302, { location: `${elsewhereOrigin}/storage/v1/object/sign/documents/acct/doc/clean.pdf?token=t` }).end();
      return;
    }
    // Storage's refusals (final check R2): only a real "not found" is "missing"; every other refusal is transport.
    if (name === "forbidden.pdf") { res.writeHead(403, { "content-type": "application/json" }).end('{"statusCode":"403","error":"Unauthorized"}'); return; }
    if (name === "busy.pdf") { res.writeHead(429).end(); return; }
    if (name === "gone400.pdf") { res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"404","error":"not_found","message":"Object not found"}'); return; }
    if (name === "bad400.pdf") { res.writeHead(400, { "content-type": "application/json" }).end('{"statusCode":"400","error":"InvalidJWT"}'); return; }
    if (name === "slow.pdf") { res.writeHead(200); res.write("%PDF-1.4\n"); return; } // never ends
    const f = FILES[name];
    if (!f) { res.writeHead(404).end(); return; }
    if (name === "big-chunked.pdf") {
      // Plan review I1: NO content-length, so only the streaming byte counter can refuse it.
      res.writeHead(200);
      for (let at = 0; at < f.length; at += 1000) res.write(f.subarray(at, at + 1000));
      res.end();
      return;
    }
    res.writeHead(200, { "content-length": String(f.length) }).end(f);
  });
  origin = `http://127.0.0.1:${await listen(storage)}`;
  scanner = createScanner({
    clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: clamd.port }, maxBytes: 4096,
    log: { log: (s) => logs.push(s), error: (s) => logs.push(s) },
  });
  base = `http://127.0.0.1:${await listen(scanner)}`;
});
after(async () => { scanner.close(); storage.closeAllConnections(); storage.close(); elsewhere.close(); await clamd.close(); });

const call = (method, path, body = "", secret = SECRET, ts = Math.floor(Date.now() / 1000)) => fetch(`${base}${path}`, {
  method, body: method === "POST" ? body : undefined,
  headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(secret, ts, method, path, body) },
});
const objectUrl = (name, o = origin) => `${o}/storage/v1/object/sign/documents/acct/doc/${name}?token=secret-token`;
const scan = async (name) => (await call("POST", "/scan", JSON.stringify({ url: objectUrl(name) }))).json();

test("a clean file is clean, the EICAR file is infected with its name (mutations: treat every reply as clean -> FAILS; drop the FOUND parse -> FAILS)", async () => {
  assert.deepEqual(await scan("clean.pdf"), { verdict: "clean" });
  assert.deepEqual(await scan("bad.pdf"), { verdict: "infected", signature: "Eicar-Test-Signature" });
});

test("clamd's own ERROR about this stream is stage clamd; an encrypted document is unscannable, never clean or infected (plan review C1, C2; mutations: stage 'transport' for a clamd reply -> FAILS; drop the Heuristics mapping -> 'infected' -> FAILS)", async () => {
  assert.deepEqual(await scan("err.pdf"), { verdict: "error", stage: "clamd" });
  assert.deepEqual(await scan("locked.pdf"), { verdict: "unscannable", signature: "Heuristics.Encrypted.PDF" });
});

test("storage's own not-found (a 404, or its 400 saying 404 / not_found) is 'missing'; every OTHER refusal (403, 429, any other 400) is transport and never counts (final check R2; mutations: 'missing' for any 4xx -> the 403, 429 and 400 cases FAIL; drop the 400-body check -> gone400 FAILS)", async () => {
  assert.deepEqual(await scan("nothing-here.pdf"), { verdict: "error", stage: "missing" });
  assert.deepEqual(await scan("gone400.pdf"), { verdict: "error", stage: "missing" });
  assert.deepEqual(await scan("forbidden.pdf"), { verdict: "error", stage: "transport" });
  assert.deepEqual(await scan("busy.pdf"), { verdict: "error", stage: "transport" });
  assert.deepEqual(await scan("bad400.pdf"), { verdict: "error", stage: "transport" });
});

test("a timeout is transport, never the file's: slow storage or a busy clamd can never count against a file (final check R2; mutation: stage 'missing' or 'clamd' on abort -> FAILS)", async (t) => {
  const quick = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: clamd.port }, timeoutMs: 300, log: { log() {}, error() {} } });
  t.after(() => quick.close()); // a failing assertion below must not leave this server listening (fix round item 1)
  const port = await listen(quick);
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ url: objectUrl("slow.pdf") });
  const r = await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, "POST", "/scan", body) } });
  assert.deepEqual(await r.json(), { verdict: "error", stage: "transport" });
});

test("a file over the limit is an error that never counts, never clean: refused by its declared length BEFORE anything is streamed to clamd, AND, served chunked with no length, by the streaming counter (plan review I1, fix round item 2; mutation: drop the declared-length check -> clamd sees a connection for big-declared.pdf -> FAILS; mutation: drop the byte counter in clamd.mjs -> the chunked file reads clean -> FAILS)", async () => {
  const before = clamd.connections;
  assert.deepEqual(await scan("big-declared.pdf"), { verdict: "error", stage: "transport" });
  assert.equal(clamd.connections, before, "a file refused by its declared length must never be handed to clamd at all");
  assert.deepEqual(await scan("big-chunked.pdf"), { verdict: "error", stage: "transport" });
});

test("a redirect is refused: a transport error, and the place it pointed to is never asked (plan review I2; mutation: redirect 'follow' -> clean, and a hit elsewhere -> FAILS)", async () => {
  assert.deepEqual(await scan("moved.pdf"), { verdict: "error", stage: "transport" });
  assert.equal(elsewhereHits.length, 0);
});

test("a bad signature is 401 and a foreign URL is 403, and NEITHER fetches anything (mutation: fetch before verifying -> the hit count moves -> FAILS)", async () => {
  const before = hits.length;
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf") }), "wrong-secret-wrong-0001")).status, 401);
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf") }), SECRET, Math.floor(Date.now() / 1000) - 120)).status, 401);
  assert.equal((await call("POST", "/scan", JSON.stringify({ url: objectUrl("clean.pdf", "http://127.0.0.2:9") }))).status, 403);
  assert.equal((await call("POST", "/scan", "{")).status, 400);
  assert.equal(hits.length, before);
});

test("health: clamd reachable with its signature date; with clamd down, health says so and a scan is a TRANSPORT error (mutations: answer clamd:true without a PING -> FAILS; stage 'clamd' when clamd is unreachable -> FAILS)", async (t) => {
  const ok = await (await call("GET", "/health")).json();
  assert.equal(ok.clamd, true);
  assert.equal(ok.selfTest, true);
  assert.ok(Math.abs(Date.now() - Date.parse(ok.signaturesAt)) < 120_000, ok.signaturesAt);
  const down = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: 1 }, log: { log() {}, error() {} } });
  t.after(() => down.close()); // a failing assertion below must not leave this server listening (fix round item 1)
  const port = await listen(down);
  const ts = Math.floor(Date.now() / 1000);
  const signed = (method, path, body) => ({ "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, method, path, body) });
  const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: signed("GET", "/health", "") });
  assert.deepEqual(await r.json(), { clamd: false });
  const body = JSON.stringify({ url: objectUrl("clean.pdf") });
  const s = await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: signed("POST", "/scan", body) });
  assert.deepEqual(await s.json(), { verdict: "error", stage: "transport" });
});

test("a clamd that answers PING but cannot scan FAILS its self-test, and every scan is stage clamd (re-review N2a; mutation: report selfTest:true without the INSTREAM -> FAILS)", async (t) => {
  const sick = await startFakeClamd(0, "127.0.0.1", { broken: true });
  t.after(() => sick.close()); // a failing assertion below must not leave this clamd listening (fix round item 1)
  const s2 = createScanner({ clients: [{ secret: SECRET, origin }], clamd: { host: "127.0.0.1", port: sick.port }, log: { log() {}, error() {} } });
  t.after(() => s2.close());
  const port = await listen(s2);
  const ts = Math.floor(Date.now() / 1000);
  const signed = (method, path, body) => ({ "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": sign(SECRET, ts, method, path, body) });
  const h = await (await fetch(`http://127.0.0.1:${port}/health`, { headers: signed("GET", "/health", "") })).json();
  assert.equal(h.clamd, true);
  assert.equal(h.selfTest, false);
  const body = JSON.stringify({ url: objectUrl("clean.pdf") });
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/scan`, { method: "POST", body, headers: signed("POST", "/scan", body) })).json(), { verdict: "error", stage: "clamd" });
});

test("other routes are 404, a body over 8 KiB is 413, and no log line ever carries the URL's token (mutation: log the url -> FAILS)", async () => {
  assert.equal((await call("GET", "/scan")).status, 404);
  assert.equal((await call("POST", "/scan", "x".repeat(9000))).status, 413);
  assert.ok(logs.length > 0);
  assert.equal(logs.filter((l) => l.includes("secret-token") || l.includes("/storage/")).length, 0);
});
