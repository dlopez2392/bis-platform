import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The signed-not-encrypted token both public "one press" links share (the daily brief's way off, the after-the-job
 * check-in). One place for the three things that must never drift apart between kinds: the key derivation, the MAC,
 * and the order of checks.
 *
 *   1.<base64url(JSON)>.<base64url(HMAC-SHA256 over "1.<body>")>
 *
 * The key is HKDF-SHA256 of the deployment's CONSENT_TOKEN_SECRET with the kind's own `domain` as the HKDF salt and
 * "mac-v1" as the info (the consent token's own shape, whose domain is "bis-consent-token"), so a token of one kind
 * can never open as another: the signatures do not verify under the other key. Each kind's test pins that both ways.
 *
 * The MAC is checked FIRST, in constant time, and only a token that proves itself has its body parsed. The body's
 * alphabet is checked before anything else: Buffer.from(…, "base64url") silently drops a trailing '!', '=', spaces
 * and newlines and accepts '+' and '/', so junk after a valid signature would otherwise open. Never log a token.
 * The caller shapes the parsed body (uuid fields, language, time): this file knows nothing of any kind's payload.
 */
const VERSION = "1";
/** Far longer than any real token (~190 characters); a bound on work. */
const MAX_TOKEN_LENGTH = 2048;
const BODY_CHARS = /^[A-Za-z0-9_-]+$/;
/** HMAC-SHA256 is 32 bytes: exactly 43 base64url characters, unpadded. */
const SIG_CHARS = /^[A-Za-z0-9_-]{43}$/;

const macKey = (secret: string, domain: string) => Buffer.from(hkdfSync("sha256", secret, domain, "mac-v1", 32));
const macOf = (key: Buffer, body: string) => createHmac("sha256", key).update(`${VERSION}.${body}`).digest();

/** Seals `payload` for the kind named by `domain`. Throws on an empty secret. */
export function sealSigned(domain: string, payload: unknown, secret: string): string {
  if (!secret) throw new Error("sealSigned: no secret");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${VERSION}.${body}.${macOf(macKey(secret, domain), body).toString("base64url")}`;
}

/**
 * The parsed body of a token whose MAC verifies under any of `secrets` for this `domain`, else null. The caller
 * must still check the SHAPE of what comes back: a validly signed body is only proof that we signed it.
 */
export function openSigned(domain: string, token: unknown, secrets: readonly (string | null | undefined)[]): unknown {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!BODY_CHARS.test(body) || !SIG_CHARS.test(sig)) return null;
  const got = Buffer.from(sig, "base64url");
  for (const secret of secrets) {
    if (!secret) continue;
    const want = macOf(macKey(secret, domain), body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) continue;
    try {
      return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}
