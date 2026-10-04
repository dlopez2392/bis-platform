// The model-down fallback's credential (operational-floor spec §3).
//
// WHY A TICKET AT ALL. The handoff route finds a call by the token on its
// `calls` row — and that row is written by Sofía's own webhook
// (`/api/voice/incoming`, `startCallRow`) when OpenAI tells us a call arrived.
// When OpenAI is unreachable that webhook never runs, so there is no row, and
// the handoff route cannot tell which account the call belonged to. That is
// exactly the call the fallback exists for.
//
// So the TeXML route, which already resolved the account and cleared every
// guard before it dialled Sofía, writes that fact into the `<Dial action=…>`
// URL: which account, which number was dialled, who called, and when —
// signed, and bound to this call's own handoff token. The handoff route
// trusts nothing else in the request. (The caller rides the ticket so the
// fallback's forwarded-call record, 0059, can count it against that caller's
// daily cap without trusting the callback body's From.)
//
// WHAT IT PROTECTS. The action URL lands in Telnyx's and Vercel's request
// logs. A holder of a logged URL could POST it with `DialCallStatus=failed`
// and read back TeXML naming the account's transfer number: the same
// disclosure, and the same ten-minute window, the handoff token already
// carries (`handoff/route.ts`, MAX_TOKEN_AGE_MS). They cannot place a call;
// only Telnyx executes what this returns. Without a signature, anyone could
// name ANY account and read its private line — that is what this prevents.
//
// THE KEY. Derived from SUPABASE_SERVICE_ROLE_KEY with a prefix of its own,
// the way `forms/guards.ts` derives its render-token key: no new value to set
// in Vercel, the raw credential is never the HMAC key, and every lambda
// derives the same key. No key → no ticket, and the fallback is simply off.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Same window as the handoff token: the leg fails within seconds, and the
 *  ceiling clears a carrier retry. */
export const FALLBACK_TICKET_MAX_AGE_MS = 10 * 60_000;

function key(env: NodeJS.ProcessEnv): Buffer | null {
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!service) return null;
  return createHash("sha256").update(`bis-voice-fallback:${service}`).digest();
}

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGITS = /^[0-9]{8,15}$/;

function mac(k: Buffer, handoffToken: string, payload: string): string {
  return createHmac("sha256", k).update(`${handoffToken}|${payload}`).digest("base64url");
}

/**
 * `<issuedAtMs>.<accountId>.<calledDigits>.<callerDigits>.<hmac>` — numbers
 * without their `+`, so the value needs no escaping in a query string; the
 * caller segment is EMPTY for a withheld caller ID. Returns null when there
 * is no key or the inputs are not what the route resolved them to be (a UUID
 * and E.164 numbers), so a caller never ships a ticket the verifier would
 * refuse. A malformed caller is dropped to empty rather than refusing the
 * ticket: the caller only feeds a cap count, never who is rung.
 *
 * Four-part tickets (before 0059) read as malformed: one in flight across
 * that deploy gets the old hang-up, for at most the ticket's ten minutes.
 */
export function signFallbackTicket(
  handoffToken: string, accountId: string, calledE164: string, nowMs: number,
  env: NodeJS.ProcessEnv = process.env, callerE164: string | null = null,
): string | null {
  const k = key(env);
  const digits = calledE164.startsWith("+") ? calledE164.slice(1) : "";
  if (!k || !handoffToken || !ACCOUNT_ID.test(accountId) || !DIGITS.test(digits)) return null;
  const callerRaw = callerE164?.startsWith("+") ? callerE164.slice(1) : "";
  const caller = DIGITS.test(callerRaw) ? callerRaw : "";
  const payload = `${Math.trunc(nowMs)}.${accountId}.${digits}.${caller}`;
  return `${payload}.${mac(k, handoffToken, payload)}`;
}

export type FallbackTicket =
  | { ok: true; accountId: string; calledE164: string; callerE164: string | null }
  | { ok: false; reason: "absent" | "no-key" | "malformed" | "bad-signature" | "expired" };

export function verifyFallbackTicket(
  ticket: string | null | undefined, handoffToken: string, nowMs: number,
  env: NodeJS.ProcessEnv = process.env, maxAgeMs: number = FALLBACK_TICKET_MAX_AGE_MS,
): FallbackTicket {
  if (!ticket) return { ok: false, reason: "absent" };
  const k = key(env);
  if (!k) return { ok: false, reason: "no-key" };
  const parts = ticket.split(".");
  if (parts.length !== 5) return { ok: false, reason: "malformed" };
  const [issuedRaw, accountId, digits, caller, given] = parts as [string, string, string, string, string];
  const issued = Number(issuedRaw);
  if (!/^[0-9]{1,16}$/.test(issuedRaw) || !Number.isFinite(issued)
    || !ACCOUNT_ID.test(accountId) || !DIGITS.test(digits) || (caller !== "" && !DIGITS.test(caller))) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(mac(k, handoffToken, `${issuedRaw}.${accountId}.${digits}.${caller}`));
  const actual = Buffer.from(given);
  // Length first: timingSafeEqual throws on a mismatch rather than returning
  // false, which would be a 500 instead of a refusal.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  // Both directions: a ticket from the future is a clock problem or a forgery.
  if (Math.abs(nowMs - issued) > maxAgeMs) return { ok: false, reason: "expired" };
  return { ok: true, accountId, calledE164: `+${digits}`, callerE164: caller ? `+${caller}` : null };
}
