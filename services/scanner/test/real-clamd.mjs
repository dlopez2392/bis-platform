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
 * I1 (final whole-branch review, coordinator fix round): owner-only encryption (RC4-128, AES-128, AES-256
 * R6 — no password needed to OPEN the file, only to edit or print it) must scan CLEAN, never
 * Heuristics.Encrypted.*; a file that needs a password to open must still answer unscannable with a
 * Heuristics.Encrypted.* signature, so the password path is proven alongside the owner-lock exception.
 * The four fixtures are built by the CI `scanner` job with qpdf itself, from a qpdf-built base (not
 * `cleanPdf` — qpdf refuses it as a damaged file) (ENCRYPTED_FIXTURES_DIR names the directory it wrote
 * them to); this file skips the block when the env var is unset, so a local run with no qpdf/Docker
 * still exercises everything else. Every fixture's verdict is printed, clean or not, so the CI log
 * carries all four results even when one fails.
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

// I1: the four qpdf-built fixtures, if the CI job built them (ENCRYPTED_FIXTURES_DIR). Each is read from
// disk (never generated here — qpdf is not a dependency of this repo) and added to the same storage stub
// the rest of this file already serves. File names match their real cipher.
const FIXTURES_DIR = process.env.ENCRYPTED_FIXTURES_DIR;
const ENCRYPTED_CASES = FIXTURES_DIR ? [
  { file: "owner-aes128.pdf", desc: "owner-only AES-128", expect: "clean" },
  { file: "owner-aes256.pdf", desc: "owner-only AES-256 (R6)", expect: "clean" },
  { file: "owner-rc4-128.pdf", desc: "owner-only RC4-128", expect: "clean" },
  { file: "user-password-aes256.pdf", desc: "a real user password, AES-256", expect: "unscannable" },
] : null;
if (ENCRYPTED_CASES) {
  for (const c of ENCRYPTED_CASES) {
    const p = join(FIXTURES_DIR, c.file);
    assert.ok(existsSync(p), `I1: ${p} was not built by the CI job's qpdf step`);
    FILES[c.file] = readFileSync(p);
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
if (ENCRYPTED_CASES) {
  const i1Results = [];
  for (const c of ENCRYPTED_CASES) {
    const r = await scan(c.file);
    i1Results.push({ file: c.file, desc: c.desc, verdict: r.verdict, signature: r.signature ?? null });
    if (c.expect === "clean") {
      assert.deepEqual(r, { verdict: "clean" }, `I1: ${c.desc} (${c.file}) must scan clean, not Heuristics.Encrypted.*: ${JSON.stringify(r)}`);
    } else {
      assert.equal(r.verdict, "unscannable", `I1: ${c.desc} (${c.file}) must answer unscannable: ${JSON.stringify(r)}`);
      assert.match(r.signature ?? "", /^Heuristics\.Encrypted\./, `I1: ${c.desc} (${c.file})'s cause must name Heuristics.Encrypted.*, proving the password path still works: ${JSON.stringify(r)}`);
    }
  }
  console.log(JSON.stringify({ i1: i1Results }));
}
const before = hits;
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt", "http://127.0.0.2:8098") }))).status, 403);
assert.equal((await call("POST", "/scan", JSON.stringify({ url: url("eicar.txt") }), null)).status, 401);
assert.equal(hits, before, "a refused request fetched nothing");
console.log(JSON.stringify({ ok: true, health, eicar: raw.signature }));
storage.close();
