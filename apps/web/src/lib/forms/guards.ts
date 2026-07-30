import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/** Hidden input a human never sees and a naive bot fills. */
export const HONEYPOT_FIELD = "bis_hp";
/** Signed render timestamp. Named opaquely so it does not advertise itself. */
export const RENDER_TOKEN_FIELD = "bis_rt";

/** A form filled faster than this was not filled by a person. */
export const MIN_FILL_MS = 2000;
export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 600_000;
export const DUPLICATE_WINDOW_MS = 60_000;

export const ATTRIBUTION_KEYS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "page", "ref",
] as const;

/**
 * Signing key for the render token.
 *
 * Derived from SUPABASE_SERVICE_ROLE_KEY rather than read from a new env var,
 * so shipping this does not add another value that must be set in Vercel before
 * any form works — the same reasoning that kept Turnstile out of M1c. The
 * derivation means the raw credential is never used as the HMAC key, and the
 * result is identical on every lambda, which a per-instance random key would
 * not be (sign on one instance, verify on another, always fail).
 */
function tokenKey(): Buffer {
  const explicit = process.env.FORM_TOKEN_SECRET;
  if (explicit) return createHash("sha256").update(`bis-form-token:${explicit}`).digest();
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) throw new Error("FORM_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY is required");
  return createHash("sha256").update(`bis-form-token:${service}`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", tokenKey()).update(payload).digest("base64url");
}

/** `<issuedAtMs>.<nonce>.<hmac>` — planted in the page, returned on submit. */
export function signRenderToken(nowMs: number, nonce: string = randomUUID()): string {
  const payload = `${nowMs}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export type RenderTokenResult =
  | { ok: true; elapsedMs: number }
  | { ok: false; reason: "malformed" | "bad_signature" };

export function verifyRenderToken(token: string, nowMs: number): RenderTokenResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [issuedAt, nonce, signature] = parts as [string, string, string];

  const expected = sign(`${issuedAt}.${nonce}`);
  const got = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return { ok: false, reason: "bad_signature" };
  }

  const ms = Number(issuedAt);
  if (!Number.isFinite(ms)) return { ok: false, reason: "malformed" };
  return { ok: true, elapsedMs: nowMs - ms };
}

/** Rate limiting needs equality only, so the raw address is never stored. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`bis-form-ip:${ip}`).digest("hex").slice(0, 32);
}

export function hashAnswers(answers: { key: string; value: string }[]): string {
  const normalized = answers
    .map((a) => `${a.key}=${a.value.trim().toLowerCase()}`)
    .sort()
    .join("&");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function parseAttribution(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 500);
  }
  return out;
}

// Deliberately excludes " ' , and whitespace. Beyond being invalid in an
// address, those are exactly the characters that break out of a PostgREST
// filter, and this value reaches the contact dedupe lookup from a public form.
const EMAIL_RE = /^[^\s@,"'<>]+@[^\s@,"'<>]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[0-9][0-9()\-.\s]{5,19}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_RE.test(trimmed)) return false;
  return trimmed.replace(/\D/g, "").length >= 7;
}
