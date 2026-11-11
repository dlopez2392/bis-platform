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

function derivedKey(domain: string, env: NodeJS.ProcessEnv): Buffer | null {
  const secret = env.VOICE_HANDOFF_SECRET?.trim();
  if (!secret || secret.length < SIP_HANDOFF_MIN_SECRET_LENGTH) return null;
  return createHash("sha256").update(`${domain}:${secret}`).digest();
}

function key(env: NodeJS.ProcessEnv): Buffer | null {
  return derivedKey("bis-voice-sip-handoff", env);
}

/** True when `VOICE_HANDOFF_SECRET` is usable (set, at least the minimum length). */
export function sipHandoffSecretConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return key(env) !== null;
}

// 8–15 digits: exactly what `e164Of` can produce, and every number either
// side signs or routes on has been through it. `sip-headers.ts`'s regex
// captures from 7, but a 7-digit capture comes back null from `e164Of`
// (pinned in its own test), so no routable call is narrower than this.
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

// ---------------------------------------------------------------------------
// THE OWNER PASS (F-032 §4.3). Minted by /api/voice/texml/owner-pin after a correct PIN and carried on the same
// <Sip> URI as X-BIS-Owner-Pass. It says: this call, on this business's number, is this person, in this role. Bound
// to the call's handoff token (the one identifier both legs see; plan SC-7) and to the role at mint (SC-8: the
// webhook requires the live role to EQUAL it). Its own key domain, so a handoff signature can never pass for one.
// Single use is not this file's job: the owner-line calls row the webhook inserts carries the handoff token, and
// calls_handoff_token_unique (0037) refuses a second redemption.
export const OWNER_PASS_HEADER = "X-BIS-Owner-Pass";
export const OWNER_PASS_MAX_AGE_MS = 60_000;
export type OwnerPassRole = "owner" | "staff" | "technician";
const PASS_ROLES: readonly string[] = ["owner", "staff", "technician"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function ownerKey(env: NodeJS.ProcessEnv): Buffer | null {
  return derivedKey("bis-voice-owner-pass", env);
}

export function signOwnerPass(
  handoffToken: string, p: { accountId: string; userId: string; role: OwnerPassRole; calledE164: string },
  nowMs: number, env: NodeJS.ProcessEnv = process.env,
): string | null {
  const k = ownerKey(env);
  const called = digitsOf(p.calledE164);
  if (!k || !handoffToken || !Number.isFinite(nowMs) || nowMs < 0 || !UUID.test(p.accountId) || !UUID.test(p.userId)
      || !PASS_ROLES.includes(p.role) || !DIGITS.test(called)) return null;
  const payload = `${Math.trunc(nowMs)}.${p.accountId}.${p.userId}.${p.role}.${called}`;
  return `${payload}.${mac(k, handoffToken, payload)}`;
}

export type OwnerPassCheck =
  | { ok: true; accountId: string; userId: string; role: OwnerPassRole; calledE164: string; issuedAtMs: number }
  | { ok: false; reason: "no-key" | "absent" | "malformed" | "bad-signature" | "expired" };

export function verifyOwnerPass(
  value: string | null | undefined, handoffToken: string | null, nowMs: number,
  env: NodeJS.ProcessEnv = process.env, maxAgeMs: number = OWNER_PASS_MAX_AGE_MS,
): OwnerPassCheck {
  const k = ownerKey(env);
  if (!k) return { ok: false, reason: "no-key" };
  if (!value) return { ok: false, reason: "absent" };
  const parts = value.split(".");
  if (parts.length !== 6) return { ok: false, reason: "malformed" };
  const [issuedRaw, accountId, userId, role, called, given] = parts as [string, string, string, string, string, string];
  const issued = Number(issuedRaw);
  if (!/^[0-9]{1,16}$/.test(issuedRaw) || !Number.isFinite(issued) || !UUID.test(accountId) || !UUID.test(userId)
      || !PASS_ROLES.includes(role) || !DIGITS.test(called)) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(mac(k, handoffToken ?? "", `${issuedRaw}.${accountId}.${userId}.${role}.${called}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: "bad-signature" };
  // Both directions (a pass from the future is a clock problem or a forgery), and written so that a NaN clock or
  // window can only fail: every comparison with NaN is false.
  if (!Number.isFinite(nowMs) || !(Math.abs(nowMs - issued) <= maxAgeMs)) return { ok: false, reason: "expired" };
  return { ok: true, accountId, userId, role: role as OwnerPassRole, calledE164: `+${called}`, issuedAtMs: issued };
}
