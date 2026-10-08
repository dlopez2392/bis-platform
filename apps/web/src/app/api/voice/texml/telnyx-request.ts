// The signature gate and form read that `/api/voice/texml` and its press-1
// action (`./screen`) share. NOT a route: Next.js only routes `route.ts`, so a
// helper colocated beside one is ordinary (same as `./xml`).
//
// One implementation, two callers, so the two cannot drift: the press-1
// action decides whether a stranger reaches Sofía, and a weaker gate there
// would be a way around the stronger one here.

import { NextResponse } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import { verifyTelnyxSignature } from "@/lib/voice/telnyx-signature";

export type TelnyxForm =
  | { ok: true; form: URLSearchParams; authenticated: boolean }
  | { ok: false; response: NextResponse };

/**
 * Reads the body ONCE, as raw text — the Telnyx signature covers the exact
 * bytes, not a re-serialized form — and, when TELNYX_PUBLIC_KEY is set,
 * refuses (403) anything not signed by Telnyx in the last five minutes.
 *
 * A body-read failure is an empty body, never a 500: with the key set that
 * fails the signature check (403, closed, correct for the auth path); with it
 * unset the caller sees an empty form, which each route treats as its own
 * fail-open case.
 *
 * `authenticated` is true exactly when the key is set: past this point, with a
 * key, the signature has verified.
 *
 * `tag` prefixes every log line, so the main route's lines read exactly as
 * they always have (`texml: rejected request (missing-headers), …`).
 */
export async function readTelnyxForm(req: Request, tag: string): Promise<TelnyxForm> {
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (e) {
    console.error(`${tag}: failed to read request body: ${String(e)}`);
  }
  const form = new URLSearchParams(rawBody);
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (publicKey) {
    const timestamp = req.headers.get("telnyx-timestamp");
    const signatureB64 = req.headers.get("telnyx-signature-ed25519");
    // Attacker-claimed values, logged so a 403 line says who claimed to be
    // calling whom — sanitized through e164Of first, because they are still
    // unauthenticated here and raw interpolation would let a prober forge log
    // lines. Anything that is not a real phone number is logged as "none".
    const safeTo = e164Of(form.get("To") || null) ?? "none";
    const safeFrom = e164Of(form.get("From") || null) ?? "none";
    if (!timestamp || !signatureB64) {
      console.error(`${tag}: rejected request (missing-headers), claimedTo ${safeTo}, claimedFrom ${safeFrom}`);
      return { ok: false, response: new NextResponse(null, { status: 403 }) };
    }
    if (!verifyTelnyxSignature({ rawBody, timestamp, signatureB64, publicKeyB64: publicKey })) {
      console.error(`${tag}: rejected request (invalid-signature), claimedTo ${safeTo}, claimedFrom ${safeFrom}`);
      return { ok: false, response: new NextResponse(null, { status: 403 }) };
    }
  }
  return { ok: true, form, authenticated: Boolean(publicKey) };
}

const FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const ATTESTATION_FIELD = /attest|shaken|stir|verstat/i;
const SAFE_VALUE = /^[A-Za-z0-9 _.:-]{0,64}$/;
const MAX_LISTED = 60;
const MAX_ATTESTATION = 10;

/**
 * OBSERVATION ONLY: one line naming every form field this request carried,
 * so the logs can answer a question nothing else can — does Telnyx send a
 * caller-ID attestation field on our inbound calls, and under what name? Until
 * a real call's log line says so, nothing may be built on one.
 *
 * Names only, never values: the values include phone numbers. The one
 * exception is a field whose NAME looks like an attestation (attest, shaken,
 * stir, verstat), whose value is the whole point — and even that is printed
 * only when it is short and plain, and redacted when it holds a long run of
 * digits. A name that could carry a newline or other log-forging character is
 * counted, not printed.
 *
 * BOUNDED, because with TELNYX_PUBLIC_KEY unset this runs on an unsigned body
 * of any size: one pass over the fields with a Set (linear, not quadratic),
 * at most MAX_LISTED names and MAX_ATTESTATION values printed, and the rest
 * counted. A real TeXML request carries a couple of dozen fields.
 */
export function logFormFields(tag: string, form: URLSearchParams): void {
  const seen = new Set<string>();
  const listed: string[] = [];
  const attestation: string[] = [];
  let unprintable = 0;
  for (const [name, value] of form) {
    if (!FIELD_NAME.test(name)) {
      unprintable++;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    if (listed.length < MAX_LISTED) listed.push(name);
    if (attestation.length < MAX_ATTESTATION && ATTESTATION_FIELD.test(name)) {
      const shown = !SAFE_VALUE.test(value) ? "(unprintable)" : /\d{7,}/.test(value) ? "(redacted)" : value;
      attestation.push(`${name}=${shown}`);
    }
  }
  const more = seen.size > listed.length ? ` …+${seen.size - listed.length} more` : "";
  const extra = unprintable > 0 ? ` (+${unprintable} unprintable)` : "";
  console.log(`${tag} form fields: ${listed.join(",") || "none"}${more}${extra}; attestation: ${attestation.join(",") || "none"}`);
}
