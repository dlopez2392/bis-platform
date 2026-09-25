import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserContext } from "@playwright/test";

/**
 * WHY THE SAVED SIGN-IN STATE CARRIES NO SESSION TOKEN.
 *
 * Every spec runs in a fresh browser context built from a file auth.setup.ts
 * wrote once, at the start of the run (e2e/.auth/state.json, and
 * client-state.json for the client identity). Clerk's `__session` cookie in
 * that file is a JWT that lives 60 seconds, so its age at a spec's first
 * request is simply "how long the run has been going" — and what Clerk's
 * middleware does with it depends on that age (@clerk/backend 3.13.1,
 * authenticateRequestWithTokenInCookie / handleSessionTokenError):
 *
 *   - younger than 60 s: accepted.
 *   - past expiry by MORE than the 5 s clock-skew leeway: a document GET is
 *     answered with a handshake redirect to Clerk, which comes back with a
 *     fresh token. Most of the suite runs this way, green.
 *   - past expiry by LESS than 5 s: the GET is accepted as-is, with no
 *     handshake, holding a token with at most 5 s left. A server action (a
 *     POST) is not eligible for a handshake or a refresh, so if the spec
 *     clicks before Clerk's browser SDK has loaded and replaced the cookie,
 *     the POST is signed out: 307 to /sign-in, reason
 *     `session-token-expired-refresh-non-eligible-non-get`.
 *
 * That third window is CI run 36155970934, attempt 1: call-proposals.spec.ts
 * opened its page on a token 4.7 s past expiry (minted 64.7 s earlier, during
 * the agency setup). 0.43 s later the page's OWN server action — the shell
 * posts one on every account-route load, before anyone clicks anything — was
 * signed out at 5.1 s past; the Accept click's POST followed at 0.62 s, 5.3 s
 * past, signed out too, so the task was never created. Any spec whose first
 * page load lands in that 5-second window is exposed, clicking or not; which
 * one does depends only on how long the specs before it took, which is why
 * it presents as a flake.
 *
 * The fix is to never hand a spec an old token at all. The saved state keeps
 * everything else Clerk wrote — `__client_uat` (the client IS signed in) and
 * the development-instance `__clerk_db_jwt` — and drops only `__session`.
 * The middleware's answer to "client signed in, no session token" is the
 * same handshake (reason `client-uat-but-no-session-token`), so every spec's
 * first page load mints a token that is seconds old, whatever time it is.
 *
 * It masks nothing: the handshake asks Clerk, and a session Clerk no longer
 * holds comes back signed out, so the spec lands on /sign-in exactly as it
 * would have before.
 */

/** A Clerk session-token cookie: `__session`, or the instance-suffixed `__session_<suffix>`. */
export const SESSION_TOKEN_COOKIE = /^__session(?:_[A-Za-z0-9_-]+)?$/;
/** Clerk's "this browser's client is signed in as of <epoch>" cookie, plain or suffixed. */
const CLIENT_UAT_COOKIE = /^__client_uat(?:_[A-Za-z0-9_-]+)?$/;

type Cookie = { name: string; value: string };

/**
 * The saved state minus its session-token cookies. Throws — naming what is
 * missing, never a value — unless the state being saved is genuinely signed
 * in, because the handshake this relies on needs both halves:
 *
 *   - a session token was present: otherwise the setup never finished
 *     signing in, or Clerk renamed the cookie and this filter would quietly
 *     strip nothing (and fix nothing);
 *   - a non-zero `__client_uat` is present: without it, a missing token is
 *     "signed out", not "refresh me" (the middleware's
 *     `!hasActiveClient && !hasSessionToken` branch), so stripping the token
 *     would sign every spec out.
 */
export function withoutSessionTokens<S extends { cookies: Cookie[] }>(state: S): S {
  const tokens = state.cookies.filter((c) => SESSION_TOKEN_COOKIE.test(c.name));
  if (tokens.length === 0) {
    throw new Error(
      "e2e setup: the signed-in state has no Clerk __session cookie to drop. Either sign-in did " +
      "not complete, or Clerk renamed the cookie and fixtures/session-state.ts needs updating.",
    );
  }
  // Parsed the way @clerk/backend parses it (`Number.parseInt(v) || 0`), so
  // "signed in" here means exactly what `hasActiveClient` will mean there.
  const signedInClient = state.cookies.some(
    (c) => CLIENT_UAT_COOKIE.test(c.name) && (Number.parseInt(c.value) || 0) > 0,
  );
  if (!signedInClient) {
    throw new Error(
      "e2e setup: the signed-in state has no non-zero Clerk __client_uat cookie. Without it the " +
      "middleware reads a missing session token as signed out rather than refreshing it.",
    );
  }
  return { ...state, cookies: state.cookies.filter((c) => !SESSION_TOKEN_COOKIE.test(c.name)) };
}

/**
 * Writes a signed-in context's state for the chromium specs to start from —
 * the one way auth.setup.ts saves one. Use this, never
 * `context.storageState({ path })`, which would save the short-lived token
 * this file exists to leave out.
 */
export async function saveSignedInState(context: BrowserContext, path: string): Promise<void> {
  const state = withoutSessionTokens(await context.storageState());
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
