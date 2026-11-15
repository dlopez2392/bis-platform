import { readGoogleConnectionSealed, type SupabaseClient } from "@bis/db";
import { googleTokenKeys, openGoogleToken, type GoogleTokenKey } from "./token-seal";

/**
 * The Google Calendar client (S-22 slice 1, PR 2; plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md,
 * D1, D5, D7, D8, D15 and Google facts V2-V9). Server code only: it reads the client secret and the ONE accessor of
 * the sealed refresh token (D6).
 *
 * `fetch` is always INJECTED: nothing here reaches Google unless a route or an action hands it the real one, and no
 * test or script ever does (docs/runbooks/google-calendar.md). Every answer is parsed and validated; anything short
 * of the whole expected shape is "malformed", never half a grant. Google's error bodies are reduced to their
 * `error` code (or the HTTP status): a description can quote what was sent. Nothing here logs.
 */
export const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
/** An OAuth error code as RFC 6749 shapes it; anything else is not echoed. */
const ERROR_CODE = /^[a-z_]{1,40}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

export type GoogleCalendarConfig = {
  clientId: string; clientSecret: string; redirectUri: string;
  keys: { current: GoogleTokenKey; previous: GoogleTokenKey | null };
};
export type GoogleDeps = { fetch: typeof fetch; now?: number; signal?: AbortSignal };
export type GoogleFailure = { ok: false; error: string };

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * The feature's configuration, or null: DORMANT (D15). Null unless the client id, the secret, a sound token key and
 * a redirect URI Google could accept (https, or http on localhost; V8) are all set. Null means no card, the routes
 * answer 404 and nothing calls Google.
 */
export function googleCalendarConfig(env: Env = process.env): GoogleCalendarConfig | null {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  if (!redirectAcceptable(redirectUri)) {
    console.error("GOOGLE_CALENDAR_REDIRECT_URI is not an https URL (or http on localhost); Google Calendar stays off until it is fixed");
    return null;
  }
  const { current, previous } = googleTokenKeys(env);
  if (!current) return null;
  return { clientId, clientSecret, redirectUri, keys: { current, previous } };
}

function redirectAcceptable(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol === "https:") return true;
  // localhost only: Next reports a 127.0.0.1 request's origin as localhost, so connect's origin check never matches it.
  return u.protocol === "http:" && u.hostname === "localhost";
}

/** Where the consent screen is (D1: openid, email, calendar.freebusy; D7: offline, consent, PKCE S256). */
export function googleAuthUrl(cfg: GoogleCalendarConfig, p: { state: string; codeChallenge: string }): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code",
    scope: `openid email ${FREEBUSY_SCOPE}`, access_type: "offline", prompt: "consent",
    state: p.state, code_challenge: p.codeChallenge, code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${q.toString()}`;
}

/** Did the user leave the calendar box ticked (V7)? Scopes are space-separated; an exact match only. */
export function grantsFreeBusy(scope: string): boolean {
  return scope.split(/\s+/).includes(FREEBUSY_SCOPE);
}

type Json = Record<string, unknown>;

async function call(deps: GoogleDeps, url: string, init: RequestInit): Promise<{ ok: true; body: Json } | GoogleFailure> {
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, signal: deps.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    return { ok: false, error: e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network" };
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  const obj = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Json) : null;
  if (!res.ok) {
    const code = obj && typeof obj.error === "string" && ERROR_CODE.test(obj.error) ? obj.error : `http_${res.status}`;
    return { ok: false, error: code };
  }
  return obj ? { ok: true, body: obj } : { ok: false, error: "malformed" };
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
});
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** The id_token's email, when it was issued by Google for THIS client. The token came straight from Google's token
 *  endpoint over TLS, so its claims are read without checking the signature (OpenID Connect Core 3.1.3.7). */
function idTokenEmail(idToken: unknown, clientId: string): string | null {
  if (!nonEmpty(idToken)) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  let claims: Json;
  try { claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Json; } catch { return null; }
  if (!claims || typeof claims !== "object" || !ISSUERS.has(String(claims.iss)) || claims.aud !== clientId) return null;
  return nonEmpty(claims.email) ? claims.email.trim() || null : null;
}

export type GoogleGrant = {
  refreshToken: string; accessToken: string; accessExpiresAt: Date; scope: string; email: string; refreshExpiresAt: Date | null;
};

/** The authorization code for a grant (V7). Requires a refresh token, an expiry, the granted scope and the email. */
export async function exchangeGoogleCode(
  cfg: GoogleCalendarConfig, p: { code: string; codeVerifier: string }, deps: GoogleDeps,
): Promise<{ ok: true; grant: GoogleGrant } | GoogleFailure> {
  const r = await call(deps, TOKEN_URL, form({
    grant_type: "authorization_code", code: p.code, code_verifier: p.codeVerifier,
    client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri,
  }));
  if (!r.ok) return r;
  const b = r.body;
  const email = idTokenEmail(b.id_token, cfg.clientId);
  if (!nonEmpty(b.access_token) || !nonEmpty(b.refresh_token) || !positive(b.expires_in) || !nonEmpty(b.scope) || !email) {
    return { ok: false, error: "malformed" };
  }
  const now = deps.now ?? Date.now();
  return { ok: true, grant: {
    refreshToken: b.refresh_token, accessToken: b.access_token, accessExpiresAt: new Date(now + b.expires_in * 1000),
    scope: b.scope, email,
    refreshExpiresAt: positive(b.refresh_token_expires_in) ? new Date(now + b.refresh_token_expires_in * 1000) : null,
  } };
}

/** A fresh access token. "invalid_grant" means the connection needs reconnecting (D12). */
export async function refreshGoogleAccessToken(
  cfg: GoogleCalendarConfig, refreshToken: string, deps: GoogleDeps,
): Promise<{ ok: true; accessToken: string; accessExpiresAt: Date } | GoogleFailure> {
  const r = await call(deps, TOKEN_URL, form({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret,
  }));
  if (!r.ok) return r;
  if (!nonEmpty(r.body.access_token) || !positive(r.body.expires_in)) return { ok: false, error: "malformed" };
  return { ok: true, accessToken: r.body.access_token, accessExpiresAt: new Date((deps.now ?? Date.now()) + r.body.expires_in * 1000) };
}

export type BusyRange = { start: Date; end: Date };

/** The primary calendar's busy ranges over the window (D2, V2, V3: [start, end)). An `errors[]` entry, an unparseable
 *  instant or a reversed range makes the WHOLE answer malformed (D10). */
export async function queryGoogleFreeBusy(
  accessToken: string, window: { timeMin: Date; timeMax: Date }, deps: GoogleDeps,
): Promise<{ ok: true; busy: BusyRange[] } | GoogleFailure> {
  const r = await call(deps, FREEBUSY_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: window.timeMin.toISOString(), timeMax: window.timeMax.toISOString(), items: [{ id: "primary" }] }),
  });
  if (!r.ok) return r;
  const cal = (r.body.calendars as Json | undefined)?.primary as Json | undefined;
  if (!cal || typeof cal !== "object" || (Array.isArray(cal.errors) && cal.errors.length > 0) || !Array.isArray(cal.busy)) {
    return { ok: false, error: "malformed" };
  }
  const busy: BusyRange[] = [];
  for (const b of cal.busy as unknown[]) {
    const o = b as Json | null;
    const start = new Date(typeof o?.start === "string" ? o.start : NaN);
    const end = new Date(typeof o?.end === "string" ? o.end : NaN);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return { ok: false, error: "malformed" };
    busy.push({ start, end });
  }
  return { ok: true, busy };
}

/** Revoke a token at Google (V9); revoking the refresh token ends the whole grant. */
export async function revokeGoogleToken(token: string, deps: GoogleDeps): Promise<{ ok: true } | GoogleFailure> {
  const r = await call(deps, REVOKE_URL, form({ token }));
  return r.ok ? { ok: true } : r;
}

/**
 * The account's connection as a disconnect or a reconnect needs it: the row it read (id, version), the Google account,
 * and the refresh token in the clear, or token null when no key given opens it. Null when there is no connection.
 * The ONLY caller of readGoogleConnectionSealed (D6). Any key in the environment will do: disconnect must work even
 * while the rest of the feature is dormant.
 */
export type AccountConnection = { id: string; version: number; googleEmail: string; token: string | null };
export async function readAccountConnection(
  db: SupabaseClient, accountId: string, keys: readonly (GoogleTokenKey | null)[] = Object.values(googleTokenKeys()),
): Promise<AccountConnection | null> {
  const row = await readGoogleConnectionSealed(db, accountId);
  if (!row) return null;
  const token = openGoogleToken(row.refresh_token_sealed, row.key_version, { accountId: row.account_id, id: row.id, version: row.version }, keys);
  return { id: row.id, version: row.version, googleEmail: row.google_email, token };
}
