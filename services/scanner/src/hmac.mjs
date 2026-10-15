import { createHmac, timingSafeEqual } from "node:crypto";

/** Spec 3.1: a request older or newer than this is refused before anything is fetched. */
export const MAX_SKEW_SECONDS = 60;

/** The canonical string is `${timestamp}.${METHOD}.${path}.${body}`; apps/web/src/lib/documents/scan-client.ts signs the same. */
export function sign(secret, timestamp, method, path, body) {
  return createHmac("sha256", secret).update(`${timestamp}.${method}.${path}.${body}`).digest("hex");
}

/** The client whose secret signed this request within the skew, or null. Constant-time per candidate. */
export function verify(clients, headers, method, path, body, nowSeconds) {
  const ts = Number(headers["x-bis-scan-timestamp"]);
  const got = String(headers["x-bis-scan-signature"] ?? "");
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return null;
  if (!/^[0-9a-f]{64}$/.test(got)) return null;
  const given = Buffer.from(got, "hex");
  for (const client of clients) {
    if (timingSafeEqual(Buffer.from(sign(client.secret, ts, method, path, body), "hex"), given)) return client;
  }
  return null;
}
