import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { GoogleTokenKey } from "./token-seal";

/**
 * The OAuth `state` for a Google Calendar connect (S-22 slice 1, PR 2; plan D7). It travels through the browser
 * and Google, so it is SEALED (AES-256-GCM), not merely signed: it carries the PKCE verifier, which the browser
 * must never see. Its key is derived from the token key's own derived key with a different HKDF label, so a
 * state can never open as a sealed refresh token or the other way round.
 *
 *   s1.<base64url(iv | AES-256-GCM(json) | tag)>,  json = { a: account, u: Clerk user, n: nonce, v: verifier, e: expiry }
 *
 * The nonce is also set as an HttpOnly cookie on the callback path, so a state lifted from someone else's
 * redirect does nothing in another browser.
 */
export const STATE_TTL_MS = 10 * 60_000;
const FORMAT = "s1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_STATE_CHARS = 1024;

export type GoogleState = { accountId: string; userId: string; nonce: string; codeVerifier: string; expiresAt: number };

function stateKey(key: GoogleTokenKey): Buffer {
  return Buffer.from(hkdfSync("sha256", key.enc, "bis-google-oauth-state", "state-v1", 32));
}

/** A fresh state for (account, user), its nonce for the cookie and its PKCE challenge for Google. */
export function mintGoogleState(key: GoogleTokenKey, p: { accountId: string; userId: string; now: number }): {
  state: string; nonce: string; codeChallenge: string;
} {
  const nonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const json = JSON.stringify({ a: p.accountId, u: p.userId, n: nonce, v: codeVerifier, e: p.now + STATE_TTL_MS });
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", stateKey(key), iv);
  const raw = Buffer.concat([iv, cipher.update(json, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { state: `${FORMAT}.${raw.toString("base64url")}`, nonce, codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url") };
}

/** The state's contents when one of the keys opens it, else null. Does NOT judge the expiry: the caller does. */
export function openGoogleState(state: unknown, keys: readonly (GoogleTokenKey | null)[]): GoogleState | null {
  if (typeof state !== "string" || state.length > MAX_STATE_CHARS || !state.startsWith(`${FORMAT}.`)) return null;
  const body = state.slice(FORMAT.length + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const raw = Buffer.from(body, "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  for (const key of keys) {
    if (!key) continue;
    try {
      const d = createDecipheriv("aes-256-gcm", stateKey(key), raw.subarray(0, IV_BYTES));
      d.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const o = JSON.parse(Buffer.concat([d.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), d.final()]).toString("utf8")) as Record<string, unknown>;
      if (typeof o.a !== "string" || typeof o.u !== "string" || typeof o.n !== "string" || typeof o.v !== "string" || typeof o.e !== "number") return null;
      return { accountId: o.a, userId: o.u, nonce: o.n, codeVerifier: o.v, expiresAt: o.e };
    } catch {
      // Not this key; the previous one (a rotation inside the 10 minutes) is tried next.
    }
  }
  return null;
}

/** Constant-time string equality for the nonce. */
export function sameNonce(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
