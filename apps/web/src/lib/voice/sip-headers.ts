// sip_headers is an ARRAY of {name, value} (openai SDK RealtimeCallIncomingWebhookEvent.Data).
// Values carry caller PII — sipHeaderNames exists so logs can prove shape without leaking.
import { e164Of } from "./phone-number";

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
