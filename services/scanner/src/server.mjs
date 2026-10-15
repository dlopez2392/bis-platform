import http from "node:http";
import { pathToFileURL } from "node:url";
import { verify } from "./hmac.mjs";
import { parseClients } from "./config.mjs";
import { allowedObjectUrl } from "./allow.mjs";
import { command, instream } from "./clamd.mjs";
import { scanUrl, parseReply } from "./scan.mjs";

/**
 * The document vault's scanner (docs/superpowers/specs/2026-10-15-document-vault-part2-design.md 3.1).
 * Two routes, both HMAC-signed: POST /scan { url } and GET /health. It writes nothing anywhere and
 * holds no database or storage credential; it can only scan a URL a caller hands it, from that
 * caller's own storage origin. A scan answers clean, infected, unscannable (a limit or encryption,
 * plan review C2) or error with its stage (clamd, file or transport, plan review C1 and re-review N3).
 * /health also runs a SELF-TEST (re-review N2a): a tiny fixed clean buffer streamed through INSTREAM
 * must answer OK. A clamd that answers PING but cannot scan (out of memory, a broken signature set)
 * fails it, and the app then spends no attempt on any file.
 */
export const MAX_BODY = 8192;
export const MAX_BYTES = 26214400; // 25 MiB: document-rules.ts's DOCUMENT_MAX_BYTES
export const SCAN_TIMEOUT_MS = 25000;
export const SELF_TEST = Buffer.from("BIS scanner self-test: a fixed, clean buffer.\n");

/** "ClamAV 1.4.3/27791/Wed Oct 15 08:27:02 2026" -> the signature database's date, ISO; null when unreadable. */
export function signaturesAt(version) {
  const date = String(version).split("/")[2];
  if (!date) return null;
  const t = Date.parse(`${date.trim()} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function readBody(req, max) {
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** The wire answer: never the reason text (it can name an internal error), only the verdict, a name, or the stage. */
export function wireVerdict(v) {
  if (v.verdict === "infected" || v.verdict === "unscannable") return { verdict: v.verdict, signature: v.signature };
  if (v.verdict === "error") return { verdict: "error", stage: v.stage };
  return { verdict: "clean" };
}

export function createScanner({ clients, clamd, maxBytes = MAX_BYTES, timeoutMs = SCAN_TIMEOUT_MS, now = () => Math.floor(Date.now() / 1000), fetchImpl = fetch, log = console }) {
  return http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    try {
      const path = new URL(req.url ?? "/", "http://scanner").pathname;
      const route = `${req.method} ${path}`;
      if (route !== "POST /scan" && route !== "GET /health") return send(404);
      const body = await readBody(req, MAX_BODY);
      if (body === null) return send(413);
      const client = verify(clients, req.headers, req.method, path, body, now());
      if (!client) return send(401);
      if (route === "GET /health") {
        try {
          if ((await command(clamd, "PING")) !== "PONG") return send(200, { clamd: false });
          const at = signaturesAt(await command(clamd, "VERSION"));
          let selfTest = false;
          try {
            selfTest = parseReply(await instream(clamd, [SELF_TEST], { maxBytes: 1024, signal: AbortSignal.timeout(5000) })).verdict === "clean";
          } catch { selfTest = false; }
          return send(200, { clamd: true, signaturesAt: at, selfTest });
        } catch {
          return send(200, { clamd: false });
        }
      }
      let url;
      try { url = JSON.parse(body)?.url; } catch { return send(400); }
      if (typeof url !== "string" || !allowedObjectUrl(url, client.origin)) return send(403);
      const started = Date.now();
      const v = await scanUrl(url, { clamd, maxBytes, timeoutMs, fetchImpl });
      log.log(JSON.stringify({ scan: v.verdict, ...(v.stage ? { stage: v.stage } : {}), ms: Date.now() - started, ...(v.reason ? { reason: v.reason } : {}) }));
      return send(200, wireVerdict(v));
    } catch (e) {
      log.error(`scanner: ${String(e?.message ?? e).slice(0, 200)}`);
      return send(500);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clients = parseClients(process.env.SCANNER_CLIENTS);
  const clamd = { host: process.env.CLAMD_HOST ?? "127.0.0.1", port: Number(process.env.CLAMD_PORT ?? 3310) };
  const port = Number(process.env.PORT ?? 8080);
  createScanner({ clients, clamd }).listen(port, "0.0.0.0", () => console.log(`scanner listening on ${port} for ${clients.length} caller(s)`));
}
