import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { consentTokenSecrets, isUuid } from "@/lib/consent/token";
import { isProductionEnv } from "@/lib/email/environment";

/**
 * The daily brief's "turn this off" token (plan D7). Signed, not encrypted: it holds one subscription id and no
 * address, so there is nothing to hide.
 *
 *   1.<base64url(JSON {v:1, s:<subscription id>, i:<issued ms>})>.<base64url(HMAC-SHA256)>
 *
 * The key comes from the existing CONSENT_TOKEN_SECRET (no new variable) through HKDF with its OWN label
 * ("bis-brief-token", where the consent token's is "bis-consent-token"), so the two kinds can never open each other:
 * a consent token's signature does not verify here, and a brief-shaped body signed with the consent key is
 * refused (token.test.ts pins both). Never expires: it only ever turns a preference OFF, which is idempotent and
 * the safe direction, and a link in an old email should still work. CONSENT_TOKEN_SECRET_PREVIOUS still opens
 * tokens sealed before a rotation, the consent token's one slot. The MAC is checked FIRST, in constant time, and
 * only a token that proves itself is parsed. Never log a token.
 */
export type BriefTokenPayload = {
  v: 1;
  /** The subscription (owner_brief_subscriptions.id, uuid). */
  s: string;
  /** Issued at, ms since the epoch. Evidence only. */
  i: number;
};

const VERSION = "1";
/** Far longer than any real token (~110 characters); a bound on work. */
const MAX_TOKEN_LENGTH = 2048;
/** Date's own range, so `new Date(i)` can never throw downstream. */
const MAX_TIME = 8.64e15;
/** The shortest secret production seals with: the email gate's own floor for the consent link. */
const MIN_SECRET_LENGTH = 32;

const macKey = (secret: string) => Buffer.from(hkdfSync("sha256", secret, "bis-brief-token", "mac-v1", 32));
const macOf = (key: Buffer, body: string) => createHmac("sha256", key).update(`${VERSION}.${body}`).digest();

export function sealBriefToken(p: BriefTokenPayload, secret: string): string {
  if (!secret) throw new Error("sealBriefToken: no secret");
  if (!isUuid(p.s)) throw new Error("sealBriefToken: the subscription id is not a uuid");
  const body = Buffer.from(JSON.stringify({ v: p.v, s: p.s, i: p.i }), "utf8").toString("base64url");
  return `${VERSION}.${body}.${macOf(macKey(secret), body).toString("base64url")}`;
}

function shapeOf(x: unknown): BriefTokenPayload | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !isUuid(o.s)) return null;
  if (typeof o.i !== "number" || !Number.isFinite(o.i) || Math.abs(o.i) > MAX_TIME) return null;
  return { v: 1, s: o.s, i: o.i };
}

export function openBriefToken(token: unknown, secrets: readonly (string | null | undefined)[]): BriefTokenPayload | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!body || !sig) return null;
  const got = Buffer.from(sig, "base64url");
  for (const secret of secrets) {
    if (!secret) continue;
    const want = macOf(macKey(secret), body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) continue;
    try {
      return shapeOf(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    } catch {
      return null;
    }
  }
  return null;
}

export type BriefTokenRead =
  | { ok: true; payload: BriefTokenPayload }
  | { ok: false; why: "bad_token" | "not_configured" };

/** Opens a token with the deployment's secrets. `not_configured` when none is set, so a route can answer 503 before
 *  it touches the database; `bad_token` for anything that does not open. */
export function readBriefToken(token: unknown, env: NodeJS.ProcessEnv = process.env): BriefTokenRead {
  const secrets = consentTokenSecrets(env);
  if (!secrets.current && !secrets.previous) return { ok: false, why: "not_configured" };
  const payload = openBriefToken(token, [secrets.current, secrets.previous]);
  return payload ? { ok: true, payload } : { ok: false, why: "bad_token" };
}

const cleanOrigin = (origin: string | null | undefined): string | null => {
  const o = origin?.trim().replace(/\/+$/, "");
  return o && /^https?:\/\/[^/\s]+$/.test(o) ? o : null;
};

/**
 * The two links one brief carries, both on ONE token: the page a person opens (`/brief/off/…`, where a button
 * confirms) and the RFC 8058 one-click target (`/api/brief/off/…`). Null when no link that works can be made: no
 * secret, no usable origin, a subscription id that is not a uuid, or (in production) a secret under 32 characters.
 * The caller (PR 3's pass) sends nothing rather than mail a dead link.
 */
export function briefOffLinks(a: {
  subscriptionId: string; now: Date; origin: string | null | undefined; env?: NodeJS.ProcessEnv;
}): { page: string; oneClick: string } | null {
  const env = a.env ?? process.env;
  const secret = consentTokenSecrets(env).current;
  const origin = cleanOrigin(a.origin);
  if (!secret || !origin || !isUuid(a.subscriptionId)) return null;
  if (isProductionEnv(env) && secret.length < MIN_SECRET_LENGTH) return null;
  const token = sealBriefToken({ v: 1, s: a.subscriptionId, i: a.now.getTime() }, secret);
  return { page: `${origin}/brief/off/${token}`, oneClick: `${origin}/api/brief/off/${token}` };
}
