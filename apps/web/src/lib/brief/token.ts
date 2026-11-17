import { consentTokenSecrets, isUuid } from "@/lib/consent/token";
import { openSigned, sealSigned } from "@/lib/signed-token";
import { isProductionEnv } from "@/lib/email/environment";

/**
 * The daily brief's "turn this off" token (plan D7). Signed, not encrypted: it holds one subscription id and no
 * address, so there is nothing to hide.
 *
 *   1.<base64url(JSON {v:1, u:<user id>, a:<account id>, i:<issued ms>})>.<base64url(HMAC-SHA256)>
 *
 * It binds the PERSON and the BUSINESS, never a subscription row: turning the brief off and on again makes a new
 * row with a new id, and a link in an earlier email must still turn the current one off. So the write it opens is
 * "delete this person's subscription on this business", and it can touch nothing else.
 *
 * The key comes from the existing CONSENT_TOKEN_SECRET (no new variable) through HKDF with its OWN label,
 * passed as the HKDF salt ("bis-brief-token", where the consent token's is "bis-consent-token"; the info is
 * "mac-v1" in both), so the two kinds can never open each other:
 * a consent token's signature does not verify here, and a brief-shaped body signed with the consent key is
 * refused (token.test.ts pins both). Never expires: it only ever turns a preference OFF, which is idempotent and
 * the safe direction, and a link in an old email should still work. CONSENT_TOKEN_SECRET_PREVIOUS still opens
 * tokens sealed before a rotation, the consent token's one slot. The MAC is checked FIRST, in constant time, and
 * only a token that proves itself is parsed. Never log a token.
 */
export type BriefTokenPayload = {
  v: 1;
  /** The person (users.id, uuid) and the business (accounts.id, uuid) the brief is for. */
  u: string;
  a: string;
  /** Issued at, ms since the epoch. Evidence only. */
  i: number;
};

/** The HKDF salt of this kind; signed-token.ts holds the one derivation, MAC and order of checks. */
const DOMAIN = "bis-brief-token";
/** Date's own range, so `new Date(i)` can never throw downstream. */
const MAX_TIME = 8.64e15;
/** The shortest secret production seals with: the email gate's own floor for the consent link. */
const MIN_SECRET_LENGTH = 32;

export function sealBriefToken(p: BriefTokenPayload, secret: string): string {
  if (!secret) throw new Error("sealBriefToken: no secret");
  if (!isUuid(p.u) || !isUuid(p.a)) throw new Error("sealBriefToken: the user or account id is not a uuid");
  return sealSigned(DOMAIN, { v: p.v, u: p.u, a: p.a, i: p.i }, secret);
}

function shapeOf(x: unknown): BriefTokenPayload | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !isUuid(o.u) || !isUuid(o.a)) return null;
  if (typeof o.i !== "number" || !Number.isFinite(o.i) || Math.abs(o.i) > MAX_TIME) return null;
  return { v: 1, u: o.u, a: o.a, i: o.i };
}

export function openBriefToken(token: unknown, secrets: readonly (string | null | undefined)[]): BriefTokenPayload | null {
  return shapeOf(openSigned(DOMAIN, token, secrets));
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
 * secret, no usable origin, a user or account id that is not a uuid, or (in production) a secret under 32 characters.
 * The caller (PR 3's pass) sends nothing rather than mail a dead link.
 */
export function briefOffLinks(a: {
  userId: string; accountId: string; now: Date; origin: string | null | undefined; env?: NodeJS.ProcessEnv;
}): { page: string; oneClick: string } | null {
  const env = a.env ?? process.env;
  const secret = consentTokenSecrets(env).current;
  const origin = cleanOrigin(a.origin);
  if (!secret || !origin || !isUuid(a.userId) || !isUuid(a.accountId)) return null;
  if (isProductionEnv(env) && secret.length < MIN_SECRET_LENGTH) return null;
  const token = sealBriefToken({ v: 1, u: a.userId, a: a.accountId, i: a.now.getTime() }, secret);
  return { page: `${origin}/brief/off/${token}`, oneClick: `${origin}/api/brief/off/${token}` };
}
