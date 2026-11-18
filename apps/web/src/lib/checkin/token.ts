import { consentTokenSecrets, isUuid } from "@/lib/consent/token";
import { openSigned, sealSigned } from "@/lib/signed-token";
import { isProductionEnv } from "@/lib/email/environment";

/**
 * The after-the-job check-in's link (F-072, plan D1). Signed, not encrypted: it holds two ids, a language and a
 * time, no address, so there is nothing to hide.
 *
 *   1.<base64url(JSON {v:1, a:<account id>, b:<booking id>, l:"en"|"es", i:<issued ms>})>.<base64url(HMAC-SHA256)>
 *
 * It names a JOB, and nothing else: the customer is never taken from it (the page and the actions re-read the
 * booking by (account, booking) and take the contact from that row), and the review link is never carried in it
 * (it is read from the account at render time). The language is inside the signature so the email, the page and
 * the review button are one language end to end and nobody can swap it.
 *
 * The key comes from the existing CONSENT_TOKEN_SECRET through HKDF with its OWN domain label (signed-token.ts), so
 * a consent or brief token never opens here and this never opens there. `i` is evidence for the 30-day rule, not an
 * expiry the MAC enforces: an old link must still open, to show the review button.
 */
export type CheckinTokenPayload = {
  v: 1;
  a: string;
  b: string;
  l: "en" | "es";
  /** Issued at, ms since the epoch. */
  i: number;
};

/** The HKDF salt of this kind. Never share it with another token's. */
const DOMAIN = "bis-checkin-token";
/** Date's own range, so `new Date(i)` can never throw downstream. */
const MAX_TIME = 8.64e15;

const shapeOf = (x: unknown): CheckinTokenPayload | null => {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || !isUuid(o.a) || !isUuid(o.b) || (o.l !== "en" && o.l !== "es")) return null;
  if (typeof o.i !== "number" || !Number.isFinite(o.i) || Math.abs(o.i) > MAX_TIME) return null;
  return { v: 1, a: o.a, b: o.b, l: o.l, i: o.i };
};

export function sealCheckinToken(p: CheckinTokenPayload, secret: string): string {
  if (!secret) throw new Error("sealCheckinToken: no secret");
  // The sealer holds itself to the opener's shape: it must not mint what it would refuse.
  const shaped = shapeOf(p);
  if (!shaped) throw new Error("sealCheckinToken: the payload is not a check-in (ids must be uuids, language en or es)");
  return sealSigned(DOMAIN, shaped, secret);
}

export function openCheckinToken(token: unknown, secrets: readonly (string | null | undefined)[]): CheckinTokenPayload | null {
  return shapeOf(openSigned(DOMAIN, token, secrets));
}

export type CheckinTokenRead =
  | { ok: true; payload: CheckinTokenPayload }
  | { ok: false; why: "bad_token" | "not_configured" };

/** The shortest secret production seals with: the email gate's own floor for the consent link, and the brief's. */
const MIN_SECRET_LENGTH = 32;

const cleanOrigin = (origin: string | null | undefined): string | null => {
  const o = origin?.trim().replace(/\/+$/, "");
  return o && /^https?:\/\/[^/\s]+$/.test(o) ? o : null;
};

/**
 * The link the check-in email carries: `<origin>/r/<token>`, sealed with the deployment's CURRENT secret. Null when
 * no link that works can be made: no secret, no usable origin (the cron's own `vercel.app` origin is discarded by
 * Gmail, so the pass also refuses an empty one), an id that is not a uuid, or, in production, a secret under 32
 * characters. The caller (the review-request pass) sends nothing rather than mail a dead or weakly signed link,
 * as `briefOffLinks` does for the brief (brief/token.ts).
 */
export function checkinLink(a: {
  accountId: string; bookingId: string; language: "en" | "es"; now: Date;
  origin: string | null | undefined; env?: NodeJS.ProcessEnv;
}): string | null {
  const env = a.env ?? process.env;
  const secret = consentTokenSecrets(env).current;
  const origin = cleanOrigin(a.origin);
  if (!secret || !origin || !isUuid(a.accountId) || !isUuid(a.bookingId)) return null;
  if (isProductionEnv(env) && secret.length < MIN_SECRET_LENGTH) return null;
  return `${origin}/r/${sealCheckinToken({ v: 1, a: a.accountId, b: a.bookingId, l: a.language, i: a.now.getTime() }, secret)}`;
}

/** Opens a token with the deployment's secrets. `not_configured` when none is set, so the page can answer
 *  "temporarily unavailable" before it touches the database; `bad_token` for anything that does not open. */
export function readCheckinToken(token: unknown, env: NodeJS.ProcessEnv = process.env): CheckinTokenRead {
  const secrets = consentTokenSecrets(env);
  if (!secrets.current && !secrets.previous) return { ok: false, why: "not_configured" };
  const payload = openCheckinToken(token, [secrets.current, secrets.previous]);
  return payload ? { ok: true, payload } : { ok: false, why: "bad_token" };
}
