import http from "node:http";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sign } from "../src/hmac.mjs";
import { eicar, eicarDocx, cleanPdf, storedZip, xlsxExpanding } from "./eicar.mjs";

/**
 * The worker against the REAL clamd (spec 7): EICAR is infected; the EICAR DOCX the Preview check
 * uploads is infected (A6); a clean 25 MiB PDF is clean; a 25 MiB file whose LAST member is EICAR is
 * infected, which proves clamd read the whole stream under the configured limits rather than skipping
 * past one (A3, plan review C2); an XLSX-shaped file of about 1 MB that unpacks to 300 MB of XML is
 * CLEAN, its scan time printed (A15) and the machine's peak memory read by the CI step after this one
 * (A1; re-review N1: no limit may delete an ordinary export); /health's self-test passes (N2a); the
 * signature date reads (A7); a refused request fetches nothing.
 * I1 (final whole-branch review): owner-only encryption (RC4/AES-128, AES-256 R6 — no password needed to
 * OPEN the file, only to edit or print it) must scan CLEAN, never Heuristics.Encrypted.*; a file that
 * needs a password to open must still answer unscannable with a Heuristics.Encrypted.* signature, so the
 * password path is proven alongside the owner-lock exception. The three fixtures are built by the CI
 * `scanner` job with qpdf (ENCRYPTED_FIXTURES_DIR names the directory it wrote them to); this file skips
 * the block when the env var is unset, so a local run with no qpdf/Docker still exercises everything
 * else.
 * Serves its files itself, as storage would, on 127.0.0.1:8098; the scanner must allow that origin
 * (SCANNER_CLIENTS=<secret>@http://127.0.0.1:8098).
 */
const SCANNER = process.env.SCANNER_URL ?? "http://127.0.0.1:8080";
const SECRET = process.env.SCANNER_SECRET;
if (!SECRET) throw new Error("SCANNER_SECRET is required");
const MiB = 1024 * 1024;
const tail = storedZip([
  ["[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
  ["word/filler.bin", Buffer.alloc(24 * MiB, 0x20)],
  ["eicar.com", Buffer.from(eicar())],
]);
const FILES = { "eicar.txt": Buffer.from(eicar()), "eicar.docx": eicarDocx(), "clean.pdf": cleanPdf(2048), "big.pdf": cleanPdf(25 * MiB), "tail.docx": tail, "export.xlsx": xlsxExpanding(300 * MiB) };
assert.ok(tail.length <= 25 * MiB, `tail.docx is ${tail.length} bytes, over the 25 MiB the bucket allows`);

// I1: the three qpdf-built fixtures, if the CI job built them (ENCRYPTED_FIXTURES_DIR). Each is read
// from disk (never generated here — qpdf is not a dependency of this repo) and added to the same
// storage stub the rest of this file already serves.
const FIXTURES_DIR = process.env.ENCRYPTED_FIXTURES_DIR;
const ENCRYPTED_NAMES = ["owner-aes128.pdf", "owner-aes256.pdf", "user-password.pdf"];
const ENCRYPTED = FIXTURES_DIR ? ENCRYPTED_NAMES : null;
if (ENCRYPTED) {
  for (const name of ENCRYPTED) {
    const p = join(FIXTURES_DIR, name);
    assert.ok(existsSync(p), `I1: ${p} was not built by the CI job's qpdf step`);
    FILES[name] = readFileSync(p);
  }
}
let hits = 0;
const storage = http.createServer((req, res) => {
  hits++;
  const f = FILES[new URL(req.url, "http://x").pathname.split("/").pop()];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-length": String(f.length) }).end(f);
});
await new Promise((r) => storage.listen(8098, "127.0.0.1", r));

const call = (method, path, body = "", secret = SECRET) => {
  const ts = Math.floor(Date.now() / 1000);
  return fetch(`${SCANNER}${path}`, { method, body: method === "POST" ? body : undefined,
    headers: { "x-bis-scan-timestamp": String(ts), "x-bis-scan-signature": secret ? sign(secret, ts, method, path, body) : "0".repeat(64) } });
};
const url = (name, origin = "http://127.0.0.1:8098") => `${origin}/storage/v1/object/sign/documents/ci/${name}?token=t`;
const scan = async (name) => (await call("POST", "/scan", JSON.stringify({ url: url(name) }))).json();

let health = null;
// Wait for BOTH clamd (PING) and the self-test (the signature DB loaded enough to answer INSTREAM):
// clamd can answer PING before freshclam's first load finishes, so stopping on clamd alone flakes CI.
for (const deadline = Date.now() + 300_000; Date.now() < deadline; await new Promise((r) => setTimeout(r, 5000))) {
  try { const r = await call("GET", "/health"); if (r.ok) { health = await r.json(); if (health.clamd && health.selfTest) break; } } catch { /* not up yet */ }
}
assert.equal(health?.clamd, true, "clamd never answered PING (assumptions A5, A13, A14)");
assert.ok(Date.now() - Date.parse(health.signaturesAt) < 7 * 86_400_000, `signatures dated ${health.signaturesAt} (A7)`);
assert.equal(health.selfTest, true, "the INSTREAM self-test on a clean buffer (re-review N2a)");
const raw = await scan("eicar.txt");
assert.equal(raw.verdict, "infected");
assert.match(raw.signature, /eicar/i);
assert.equal((await scan("eicar.docx")).verdict, "infected", "EICAR inside a stored DOCX member (A6)");
assert.deepEqual(await scan("clean.pdf"), { verdict: "clean" });
assert.deepEqual(await scan("big.pdf"), { verdict: "clean" }, "a clean 25 MiB stream (A3)");
const tailVerdict = await scan("tail.docx");
assert.equal(tailVerdict.verdict, "infected", `EICAR at the tail of a 25 MiB file (A3): ${JSON.stringify(tailVerdict)}`);
const started = Date.now();
const expanding = await scan("export.xlsx");
const expandMs = Date.now() - started;
console.log(JSON.stringify({ a15: { xlsxUnpacked: "300 MiB", scanMs: expandMs } }));
assert.deepEqual(expanding, { verdict: "clean" }, `a 300 MiB-unpacking XLSX must be clean, not limited or timed out (re-review N1, A15): ${JSON.stringify(expanding)} after ${expandMs} ms`);
// The bound that matters is the worker's own 25 s scan timeout (scan-client.ts's SCAN_TIMEOUT_MS is
// that plus 5 s of network headroom); the pass's start window is 15 s (45 s DOCUMENT_SCAN_BUDGET_MS
// minus that 30 s SCAN_TIMEOUT_MS), not 20 s (M4, final whole-branch review).
assert.ok(expandMs < 20_000, `the 300 MiB-unpacking XLSX took ${expandMs} ms: over the worker's 25 s scan timeout, with headroom (A15)`);
if (ENCRYPTED) {
  const owner128 = await scan("owner-aes128.pdf");
  assert.deepEqual(owner128, { verdict: "clean" }, `I1: an owner-only RC4/AES-128 PDF (no password to OPEN it) must scan clean, not Heuristics.Encrypted.*: ${JSON.stringify(owner128)}`);
  const owner256 = await scan("owner-aes256.pdf");
  assert.deepEqual(owner256, { verdict: "clean" }, `I1: an owner-only AES-256 (R6) PDF (no password to OPEN it) must scan clean, not Heuristics.Encrypted.*: ${JSON.stringify(owner256)}`);
  const userPw = await scan("user-password.pdf");
  assert.equal(userPw.verdict, "unscannable", `I1: a PDF that needs a password to OPEN it must answer unscannable: ${JSON.stringify(userPw)}`);
  assert.match(userPw.signature ?? "", /^Heuristics\.Encrypted\./, `I1: the user-password PDF's cause must name Heuristics.Encrypted.*, proving the password path still works: ${JSON.stringify(userPw)}`);
}
const before = hits;
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt", "http://127.0.0.2:8098") }))).status, 403);
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt") }), null)).status, 401);
assert.equal(hits, before, "a refused request fetched nothing");
console.log(JSON.stringify({ ok: true, health, eicar: raw.signature }));
storage.close();
