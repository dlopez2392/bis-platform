import { instream } from "./clamd.mjs";

/**
 * WHERE an error came from decides whether it may count against the file (plan review C1; final
 * check R2, orchestrator ruling): "clamd": clamd read this stream and answered ERROR about it.
 * "missing": storage said THIS object does not exist (404, or Supabase storage's 400 carrying
 * statusCode "404" / error "not_found"); the app re-checks existence with its own service-role client
 * before it counts. Everything else is "transport" and never counts: any other 4xx (400, 401, 403,
 * 429), any 5xx, a redirect, a network failure, ANY timeout (fetch or clamd, so slow storage or a
 * signature reload can never walk files to "unscannable"), the size limit, clamd unreachable or silent.
 * Plan review C2: with AlertExceedsMax and the AlertEncrypted* options on (Dockerfile), content clamd
 * could not fully read is reported as a Heuristics.Limits.Exceeded.* or Heuristics.Encrypted.* FOUND:
 * that is neither clean nor a virus, it is "unscannable".
 */
const LIMIT_OR_ENCRYPTED = /^Heuristics\.(Limits\.Exceeded|Encrypted)/;

export function parseReply(reply) {
  const r = reply.trim();
  if (r === "stream: OK") return { verdict: "clean" };
  const found = /^stream: (.+) FOUND$/.exec(r);
  if (found) {
    const name = found[1].slice(0, 200);
    return LIMIT_OR_ENCRYPTED.test(name) ? { verdict: "unscannable", signature: name } : { verdict: "infected", signature: name };
  }
  // Only a reply ending in " ERROR" is clamd's own word about THIS stream (clamd(8): every error line
  // clamd emits ends that way). Anything else unexpected or truncated (a connection-level garble, a
  // short read) is not clamd speaking about the file, so it is never blamed on it: "transport".
  if (r.endsWith(" ERROR")) return { verdict: "error", stage: "clamd", reason: r.slice(0, 120) };
  return { verdict: "error", stage: "transport", reason: r.slice(0, 120) };
}

/** Storage's own "this object does not exist": a 404, or a 400 whose JSON body says 404 / not_found. */
async function saysMissing(res) {
  if (res.status === 404) return true;
  if (res.status !== 400) return false;
  try {
    const body = JSON.parse((await res.text()).slice(0, 2000));
    return String(body?.statusCode) === "404" || body?.error === "not_found";
  } catch {
    return false;
  }
}

/** Fetches ONE signed object and streams it to clamd. Never throws; never logs the URL. */
export async function scanUrl(url, { clamd, maxBytes, timeoutMs, fetchImpl = fetch }) {
  const signal = AbortSignal.timeout(timeoutMs);
  const error = (stage, reason) => ({ verdict: "error", stage, reason });
  let res;
  try {
    res = await fetchImpl(url, { redirect: "error", signal });
  } catch {
    return error("transport", "fetch failed");
  }
  if (!res.ok || !res.body) {
    const stage = (await saysMissing(res)) ? "missing" : "transport";
    res.body?.cancel().catch(() => {}); // an unread body on a refusal still holds the connection open
    return error(stage, `fetch answered ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.body.cancel().catch(() => {}); // refused before a byte is streamed: never left dangling
    return error("transport", "too large");
  }
  let reply;
  try {
    reply = await instream(clamd, res.body, { maxBytes, signal });
  } catch (e) {
    return error("transport", String(e?.message ?? e).slice(0, 120));
  }
  if (reply.trim() === "") return error("transport", "clamd closed without a reply");
  return parseReply(reply);
}
