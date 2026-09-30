import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { emailLedgerAddress } from "@bis/db/email-address";

/**
 * The unsubscribe token (consent chain spec §4.3; decision 6: signed, no
 * token table). It carries the account, the channel and the address the
 * ledger keys on, and — for the record only — the contact and the kind of
 * email it came in. Its body is ENCRYPTED as well as signed (plan G2, (decision Q3)),
 * so no one reading a URL (a request log, a mail scanner, a browser's
 * history, a Referer) can read the customer's address out of it.
 *
 *   1.<base64url(iv | AES-256-GCM(JSON) | tag)>.<base64url(HMAC-SHA256)>
 *
 * Both keys come from CONSENT_TOKEN_SECRET through HKDF, never from any
 * other credential (spec: no fallback to the service-role key, unlike the
 * form render token). CONSENT_TOKEN_SECRET_PREVIOUS still opens tokens
 * sealed before a rotation — ONE slot, so a second rotation drops the first
 * secret and every link sealed with it: never rotate twice within 30 days
 * (CAN-SPAM's minimum). In production the email gate refuses to seal with a
 * secret shorter than 32 characters (plan G8). Tokens never expire: CAN-SPAM wants the way out
 * to work for at least 30 days after the email (plan X4), and a link in an
 * old email should still work years later.
 *
 * The MAC is checked FIRST, in constant time; only a token that proves it is
 * decrypted. Never log a token.
 */
export type ConsentTokenPayload = {
  v: 1;
  /** The account (uuid). */
  a: string;
  c: "email";
  /** The ledger address (emailLedgerAddress). */
  t: string;
  /** Issued at, ms since the epoch. */
  i: number;
  /** The contact the email went to (uuid), evidence only; null when unknown. */
  n: string | null;
  /** The email kind that carried it, evidence only. */
  k?: string;
};

const VERSION = "1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Far longer than any real token (~330 characters); a bound on work. */
const MAX_TOKEN_LENGTH = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The opener's uuid rule, for a sealer that must not mint what it refuses. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
/** Date's own range, so `new Date(i)` can never throw downstream. */
const MAX_TIME = 8.64e15;

function keys(secret: string): { enc: Buffer; mac: Buffer } {
  return {
    enc: Buffer.from(hkdfSync("sha256", secret, "bis-consent-token", "enc-v1", 32)),
    mac: Buffer.from(hkdfSync("sha256", secret, "bis-consent-token", "mac-v1", 32)),
  };
}

const macOf = (macKey: Buffer, body: string) => createHmac("sha256", macKey).update(`${VERSION}.${body}`).digest();

export function sealConsentToken(p: ConsentTokenPayload, secret: string): string {
  if (!secret) throw new Error("sealConsentToken: no secret");
  const { enc, mac } = keys(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", enc, iv);
  const json = JSON.stringify({ v: p.v, a: p.a, c: p.c, t: p.t, i: p.i, n: p.n, ...(p.k ? { k: p.k } : {}) });
  const sealed = Buffer.concat([iv, cipher.update(json, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const body = sealed.toString("base64url");
  return `${VERSION}.${body}.${macOf(mac, body).toString("base64url")}`;
}

function shapeOf(x: unknown): ConsentTokenPayload | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || o.c !== "email") return null;
  if (typeof o.a !== "string" || !UUID.test(o.a)) return null;
  if (typeof o.t !== "string" || emailLedgerAddress(o.t) !== o.t) return null;
  if (typeof o.i !== "number" || !Number.isFinite(o.i) || Math.abs(o.i) > MAX_TIME) return null;
  if (o.n !== undefined && o.n !== null && (typeof o.n !== "string" || !UUID.test(o.n))) return null;
  if (o.k !== undefined && typeof o.k !== "string") return null;
  return { v: 1, a: o.a, c: "email", t: o.t, i: o.i, n: (o.n as string | null | undefined) ?? null, ...(typeof o.k === "string" ? { k: o.k } : {}) };
}

export function openConsentToken(token: unknown, secrets: readonly (string | null | undefined)[]): ConsentTokenPayload | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!body || !sig) return null;
  const got = Buffer.from(sig, "base64url");
  for (const secret of secrets) {
    if (!secret) continue;
    const { enc, mac } = keys(secret);
    const want = macOf(mac, body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) continue;
    try {
      const raw = Buffer.from(body, "base64url");
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = createDecipheriv("aes-256-gcm", enc, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const json = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
      return shapeOf(JSON.parse(json));
    } catch {
      return null;
    }
  }
  return null;
}

export function consentTokenSecrets(env: NodeJS.ProcessEnv = process.env): { current: string | null; previous: string | null } {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return { current: clean(env.CONSENT_TOKEN_SECRET), previous: clean(env.CONSENT_TOKEN_SECRET_PREVIOUS) };
}
