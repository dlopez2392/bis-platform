// sip_headers is an ARRAY of {name, value} (openai SDK RealtimeCallIncomingWebhookEvent.Data).
// Values carry caller PII — sipHeaderNames exists so logs can prove shape without leaking.
import { e164Of } from "./phone-number";
import { FIELD_NAME, ATTESTATION_FIELD, MAX_ATTESTATION, shownValue } from "./attestation-log";

// The "+" is KEPT (consent chain PR-1 review): without it, F-009 reads an
// international caller ID of ten digits as a national number, e.g. New
// Zealand's +64 21 234 567 as Mexico's +52 642 123 4567.
const NUMBER_RE = /(?:tel:|sip:)(\+?[0-9]{7,15})/i;

type Header = { name?: unknown; value?: unknown };

function headers(eventData: unknown): Header[] {
  if (!eventData || typeof eventData !== "object") return [];
  const h = (eventData as { sip_headers?: unknown }).sip_headers;
  return Array.isArray(h) ? (h as Header[]) : [];
}

function numberFromHeader(list: Header[], name: string): string | null {
  const hit = list.find((h) => h && typeof h === "object" && String(h.name).toLowerCase() === name);
  if (!hit || typeof hit.value !== "string") return null;
  // X-BIS-Called carries a bare E.164 we wrote ourselves; SIP URIs need the regex.
  if (name === "x-bis-called") {
    return e164Of(hit.value);
  }
  const match = hit.value.match(NUMBER_RE);
  if (!match) return null;
  return e164Of(match[1]!);
}

/**
 * A header read VERBATIM — no phone-number coercion. `numberFromHeader` above
 * runs every value it touches through `e164Of`, which is exactly right for a
 * number and destroys anything else: a handoff token is 32 hex characters and
 * `e164Of` would return null for it.
 */
function rawHeader(list: Header[], name: string): string | null {
  const hit = list.find((h) => h && typeof h === "object" && String(h.name).toLowerCase() === name);
  if (!hit || typeof hit.value !== "string") return null;
  return hit.value.trim() || null;
}

export function extractCallerNumber(eventData: unknown): string | null {
  return numberFromHeader(headers(eventData), "from");
}

/** The tenant router's input. Order matters: x-bis-called is written by OUR
 *  TeXML route and is authoritative; To/Diversion are carrier-dependent
 *  fallbacks (the To of the leg reaching OpenAI is usually the OpenAI SIP
 *  URI itself, which contains no phone number and correctly yields null). */
export function extractCalledNumber(eventData: unknown): string | null {
  const list = headers(eventData);
  return numberFromHeader(list, "x-bis-called")
    ?? numberFromHeader(list, "to")
    ?? numberFromHeader(list, "diversion");
}

/**
 * The one-time credential our own TeXML route minted for this call and
 * smuggled onto the SIP URI as `X-BIS-Handoff`, for the same reason
 * `X-BIS-Called` rides there: the SIP leg carries nothing else of ours.
 *
 * Absent on a call that arrived before the TeXML app was updated (or by some
 * other path entirely) — null then, and the call simply has no transfer
 * credential. NEVER logged: unlike the dialed number, this value IS the
 * authorisation the handoff route checks.
 */
export function extractHandoffToken(eventData: unknown): string | null {
  return rawHeader(headers(eventData), "x-bis-handoff");
}

/**
 * The signature our TeXML route put on the SIP URI as `X-BIS-Signature`
 * (`sip-handoff-signature.ts`), read verbatim for the same reason the handoff
 * token is. Null when absent. Never logged.
 */
export function extractSipSignature(eventData: unknown): string | null {
  return rawHeader(headers(eventData), "x-bis-signature");
}

export function sipHeaderNames(eventData: unknown): string[] {
  return headers(eventData)
    .filter((h): h is Header & { name: string } => h && typeof h === "object" && typeof h.name === "string")
    .map((h) => h.name);
}

/**
 * S-47e (spec 5.7, S13): what the SIP leg says about the caller ID's attestation, for ONE log line.
 * OBSERVATION ONLY: nothing is verified, stored or decided on it (A5: whether any of it reaches this leg is
 * what the line exists to find out). The STIR/SHAKEN `Identity` header prints only its `attest` (A, B or C),
 * never the token; a `verstat` parameter inside From or P-Asserted-Identity prints when it is a short word.
 * Bounded like logFormFields: at most MAX_ATTESTATION values; a name that could forge a log line is counted.
 */
export function sipAttestation(eventData: unknown): string {
  const out: string[] = [];
  let unprintable = 0;
  for (const h of headers(eventData)) {
    if (out.length >= MAX_ATTESTATION) break;
    if (!h || typeof h !== "object" || typeof h.name !== "string") continue;
    if (!FIELD_NAME.test(h.name)) { unprintable += 1; continue; }
    const name = h.name.toLowerCase();
    const value = typeof h.value === "string" ? h.value : "";
    if (name === "identity") { out.push(`identity=${identityAttest(value)}`); continue; }
    if (name === "from" || name === "p-asserted-identity") {
      const v = /;\s*verstat=([^;>\s]*)/i.exec(value)?.[1];
      if (v !== undefined) out.push(`${name}.verstat=${/^[A-Za-z-]{1,40}$/.test(v) ? v : "(unprintable)"}`);
      continue;
    }
    if (ATTESTATION_FIELD.test(h.name)) out.push(`${h.name}=${shownValue(value)}`);
  }
  const extra = unprintable > 0 ? ` (+${unprintable} unprintable)` : "";
  return `${out.join(",") || "none"}${extra}`;
}

/** The `attest` claim of a STIR/SHAKEN PASSporT (header.payload.signature), or "(present)". Never throws. */
function identityAttest(token: string): string {
  try {
    const payload = token.split(";")[0]!.trim().split(".")[1];
    if (!payload || payload.length > 4096) return "(present)";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { attest?: unknown };
    return json.attest === "A" || json.attest === "B" || json.attest === "C" ? `attest:${json.attest}` : "(present)";
  } catch {
    return "(present)";
  }
}
