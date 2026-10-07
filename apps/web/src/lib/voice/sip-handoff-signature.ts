// Proof that a call reached OpenAI through our own TeXML answer route.
//
// WHY. OpenAI's webhook signature (checked first in `/api/voice/incoming`)
// proves OpenAI sent the `realtime.call.incoming` event. It says nothing about
// how the call reached OpenAI's SIP endpoint, and the numbers the webhook
// routes on — the dialled number (which picks the tenant) and the caller —
// arrive as SIP headers. The only legitimate path to that endpoint is the
// TeXML route (`/api/voice/texml`), whose own requests are signed by Telnyx.
// So that route signs what it resolved — called number, caller, this call's
// handoff token and the time — into one more header on the `<Sip>` URI, and
// the webhook verifies it before it looks up a tenant or does any other work.
//
// WHY IT RIDES THE SIP URI. The same channel `X-BIS-Called` and
// `X-BIS-Handoff` already use: a `?X-…=` parameter on the `<Sip>` URI rides
// the INVITE and surfaces in the webhook's `sip_headers`. The value is built
// from `[0-9A-Za-z._-]` only, so URI encoding leaves it byte-identical and no
// decode step on either side can change what the MAC covers.
//
// THE KEY. `VOICE_HANDOFF_SECRET`, a dedicated value (never the service-role
// key, the webhook secret or the cron secret), with a prefix of its own so
// the raw credential is never the HMAC key — the shape `fallback-ticket.ts`
// uses. Shorter than 32 characters reads as unset: a weak secret must not
// look like a configured one.
//
// ENFORCEMENT is a separate switch (`VOICE_HANDOFF_ENFORCE`) so the rollout
// can verify on a real call before anything is refused; see the voice runbook.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The SIP header (and `<Sip>` URI parameter) carrying the signature. */
export const SIP_HANDOFF_HEADER = "X-BIS-Signature";

/** The TeXML answer and the INVITE that carries it are seconds apart on a
 *  real call (2s on the 2026-09-17 production log). Two minutes clears a
 *  cold start and the ring with room to spare, and keeps a captured value
 *  from being useful for long. */
export const SIP_HANDOFF_MAX_AGE_MS = 2 * 60_000;

export const SIP_HANDOFF_MIN_SECRET_LENGTH = 32;

function key(env: NodeJS.ProcessEnv): Buffer | null {
  const secret = env.VOICE_HANDOFF_SECRET?.trim();
  if (!secret || secret.length < SIP_HANDOFF_MIN_SECRET_LENGTH) return null;
  return createHash("sha256").update(`bis-voice-sip-handoff:${secret}`).digest();
}

const DIGITS = /^[0-9]{8,15}$/;

function mac(k: Buffer, handoffToken: string, payload: string): string {
  return createHmac("sha256", k).update(`${handoffToken}|${payload}`).digest("base64url");
}

function digitsOf(e164: string | null | undefined): string {
  return e164?.startsWith("+") ? e164.slice(1) : "";
}

/**
 * `<issuedAtMs>.<calledDigits>.<callerDigits>.<hmac>`, the caller segment
 * EMPTY for a withheld caller ID. Null when there is no usable secret, no
 * handoff token, or no E.164 called number — a value the verifier would
 * refuse is never emitted.
 */
export function signSipHandoff(
  handoffToken: string, calledE164: string, callerE164: string | null, nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const k = key(env);
  const called = digitsOf(calledE164);
  if (!k || !handoffToken || !DIGITS.test(called)) return null;
  const callerRaw = digitsOf(callerE164);
  const caller = DIGITS.test(callerRaw) ? callerRaw : "";
  const payload = `${Math.trunc(nowMs)}.${called}.${caller}`;
  return `${payload}.${mac(k, handoffToken, payload)}`;
}

export type SipHandoffCheck =
  | { ok: true; calledE164: string; callerE164: string | null }
  | { ok: false; reason: "absent" | "no-key" | "malformed" | "bad-signature" | "expired" };

export function verifySipHandoff(
  value: string | null | undefined, handoffToken: string | null, nowMs: number,
  env: NodeJS.ProcessEnv = process.env, maxAgeMs: number = SIP_HANDOFF_MAX_AGE_MS,
): SipHandoffCheck {
  // The secret FIRST: with no secret the TeXML route sends no header at all,
  // so "absent" would hide the misconfiguration behind a stranger's reason.
  const k = key(env);
  if (!k) return { ok: false, reason: "no-key" };
  if (!value) return { ok: false, reason: "absent" };
  const parts = value.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [issuedRaw, called, caller, given] = parts as [string, string, string, string];
  const issued = Number(issuedRaw);
  if (!/^[0-9]{1,16}$/.test(issuedRaw) || !Number.isFinite(issued)
    || !DIGITS.test(called) || (caller !== "" && !DIGITS.test(caller))) {
    return { ok: false, reason: "malformed" };
  }
  // A missing token verifies against "" and so fails the MAC: the signer
  // never signs without one.
  const expected = Buffer.from(mac(k, handoffToken ?? "", `${issuedRaw}.${called}.${caller}`));
  const actual = Buffer.from(given);
  // Length first: timingSafeEqual throws on unequal lengths, which would be
  // a 500 instead of a decline.
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "bad-signature" };
  }
  // Both directions: a value from the future is a clock problem or a forgery.
  if (Math.abs(nowMs - issued) > maxAgeMs) return { ok: false, reason: "expired" };
  return { ok: true, calledE164: `+${called}`, callerE164: caller ? `+${caller}` : null };
}

/**
 * Whether the webhook REFUSES a call without a valid signature. Off unless
 * explicitly `1`/`true`, so merging this code changes nothing until the
 * secret is in place and a real call has shown the header arriving. Read
 * independently of the secret on purpose: enforcing with no secret declines
 * every call (fail closed) rather than quietly reverting to unverified.
 */
export function sipHandoffEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.VOICE_HANDOFF_ENFORCE?.trim().toLowerCase();
  return v === "1" || v === "true";
}
