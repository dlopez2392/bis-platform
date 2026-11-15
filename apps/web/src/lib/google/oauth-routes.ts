import { NextResponse, type NextRequest } from "next/server";
import { serviceDb, readPersonId, upsertGoogleConnection, emit, emitAgencyEvent, completeTask } from "@bis/db";
import { requireAccountAccess, accountHome } from "@/lib/auth";
import { isUuid } from "@/lib/assign/action-guards";
import { billingVerdictFor } from "@/lib/billing/standing-read";
import {
  googleCalendarConfig, googleAuthUrl, exchangeGoogleCode, grantsFreeBusy, revokeGoogleToken,
} from "./calendar-client";
import { mintGoogleState, openGoogleState, sameNonce } from "./oauth-state";
import { openGoogleToken, sealGoogleToken } from "./token-seal";

/**
 * GET /api/google-calendar/connect?account=<id> and GET /api/google-calendar/callback (S-22 slice 1, PR 2; plan D3,
 * D7, D8, D15). The route files are one line each; everything is here, with Google behind an injected `fetch`.
 *
 * WHO. requireAccountAccess (signed in, this account, the agency on a live visit), then `canManage`: the agency or
 * the account's Owner, never Staff or a Technician (D3), at connect AND again at the callback. A refusal is a
 * redirect to the person's own home, never a 403 (lib/auth.ts's reason).
 *
 * THE CALLBACK refuses, before it asks anyone anything, a state that does not open, has expired, or whose nonce is
 * not the browser's cookie; after the access check, a state minted for another user. It writes nothing unless
 * Google granted calendar.freebusy (the user can untick it, V7); a grant it will not keep is revoked at Google.
 *
 * Neither route logs, redirects to or answers with a token, a code or the client secret.
 */
export const GOOGLE_NONCE_COOKIE = "bis_gcal_nonce";
const CALLBACK_PATH = "/api/google-calendar/callback";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;
export type GoogleRouteDeps = { fetch: typeof fetch; env?: Env; now?: number };

const notFound = () => new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
const calendarPath = (accountId: string, outcome: "connected" | "denied" | "failed" | "paused") =>
  `/dashboard/accounts/${accountId}/calendar?google=${outcome}`;

function go(path: string, origin: string, opts: { clearNonce?: boolean } = {}): NextResponse {
  const res = NextResponse.redirect(new URL(path, origin));
  res.headers.set("cache-control", "no-store");
  if (opts.clearNonce) {
    res.cookies.set(GOOGLE_NONCE_COOKIE, "", { path: CALLBACK_PATH, maxAge: 0, httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:") });
  }
  return res;
}

/**
 * Connecting is switching access ON, so a CLIENT on an account paused for billing is refused, as every client write
 * is (lib/billing/read-only.ts; these are GET routes, which that guard never sees). The agency never is. Fails open,
 * as billingVerdictFor does.
 */
async function pausedClient(accountId: string, access: { isAgency: boolean }): Promise<boolean> {
  if (access.isAgency) return false;
  if (!(await billingVerdictFor(accountId)).paused) return false;
  console.log(`google calendar: refused a connect on paused account ${accountId}`);
  return true;
}

/** A thrown value's message with every secret of this request taken out: a database error can quote a value. */
function scrub(e: unknown, secrets: readonly string[]): string {
  let s = e instanceof Error ? e.message : String(e);
  for (const x of secrets) if (x) s = s.split(x).join("[redacted]");
  return s.slice(0, 300);
}

export async function handleGoogleConnect(req: NextRequest, deps: GoogleRouteDeps): Promise<NextResponse> {
  const cfg = googleCalendarConfig(deps.env);
  if (!cfg) return notFound();
  const accountId = req.nextUrl.searchParams.get("account");
  if (!isUuid(accountId)) return notFound();
  const access = await requireAccountAccess(accountId);
  const origin = req.nextUrl.origin;
  if (!access.canManage) return go(accountHome(accountId, access.role), origin);
  if (await pausedClient(accountId, access)) return go(calendarPath(accountId, "paused"), origin);
  // D8: the nonce cookie is host-bound, so it must be set on the host Google sends the person back to.
  const callbackOrigin = new URL(cfg.redirectUri).origin;
  if (origin !== callbackOrigin) return go(calendarPath(accountId, "failed"), origin);

  const { state, nonce, codeChallenge } = mintGoogleState(cfg.keys.current, { accountId, userId: access.userId, now: deps.now ?? Date.now() });
  const res = NextResponse.redirect(googleAuthUrl(cfg, { state, codeChallenge }));
  res.headers.set("cache-control", "no-store");
  res.cookies.set(GOOGLE_NONCE_COOKIE, nonce, {
    path: CALLBACK_PATH, maxAge: 600, httpOnly: true, sameSite: "lax", secure: callbackOrigin.startsWith("https:"),
  });
  return res;
}

export async function handleGoogleCallback(req: NextRequest, deps: GoogleRouteDeps): Promise<NextResponse> {
  const cfg = googleCalendarConfig(deps.env);
  if (!cfg) return notFound();
  const origin = new URL(cfg.redirectUri).origin;
  const q = req.nextUrl.searchParams;

  // Before anyone is asked anything: a state this deployment minted, still fresh, for this browser.
  const st = openGoogleState(q.get("state"), [cfg.keys.current, cfg.keys.previous]);
  const now = deps.now ?? Date.now();
  if (!st || !isUuid(st.accountId) || now > st.expiresAt || !sameNonce(req.cookies.get(GOOGLE_NONCE_COOKIE)?.value, st.nonce)) {
    console.warn("google calendar callback: refused a state that did not open, had expired or did not match this browser");
    return go("/", origin, { clearNonce: true });
  }
  const accountId = st.accountId;
  const access = await requireAccountAccess(accountId);
  if (access.userId !== st.userId) {
    console.warn(`google calendar callback: account ${accountId}: refused a state minted for another user`);
    return go(calendarPath(accountId, "failed"), origin, { clearNonce: true });
  }
  if (!access.canManage) return go(accountHome(accountId, access.role), origin, { clearNonce: true });
  // Before the exchange, so a paused client is never even issued a token.
  if (await pausedClient(accountId, access)) return go(calendarPath(accountId, "paused"), origin, { clearNonce: true });

  // The person pressed Cancel, or Google refused before a code was issued.
  if (q.get("error") || !q.get("code")) {
    const code = q.get("error");
    console.log(`google calendar callback: account ${accountId}: no code (${code && /^[a-z_]{1,40}$/.test(code) ? code : "none"})`);
    return go(calendarPath(accountId, code === "access_denied" ? "denied" : "failed"), origin, { clearNonce: true });
  }

  const ex = await exchangeGoogleCode(cfg, { code: q.get("code")!, codeVerifier: st.codeVerifier }, { fetch: deps.fetch, now });
  if (!ex.ok) {
    console.error(`google calendar callback: account ${accountId}: the code exchange failed (${ex.error})`);
    return go(calendarPath(accountId, "failed"), origin, { clearNonce: true });
  }
  const g = ex.grant;
  if (!grantsFreeBusy(g.scope)) {
    console.log(`google calendar callback: account ${accountId}: calendar.freebusy was not granted; nothing written`);
    await revokeQuietly(g.refreshToken, deps, accountId, "revoking an unkept grant");
    return go(calendarPath(accountId, "denied"), origin, { clearNonce: true });
  }

  const db = serviceDb();
  let written: Awaited<ReturnType<typeof upsertGoogleConnection>>;
  try {
    const connectedBy = await readPersonId(db, accountId, access.userId); // null for the agency (never a member)
    written = await upsertGoogleConnection(db, {
      accountId, googleEmail: g.email, scope: g.scope, refreshExpiresAt: g.refreshExpiresAt, connectedBy,
      seal: (ref) => sealGoogleToken(g.refreshToken, ref, cfg.keys.current),
    });
  } catch (e) {
    console.error(`google calendar callback: account ${accountId}: the write failed: ${scrub(e, [g.refreshToken, g.accessToken])}`);
    await revokeQuietly(g.refreshToken, deps, accountId, "revoking an unkept grant");
    return go(calendarPath(accountId, "failed"), origin, { clearNonce: true });
  }
  // The row the write ACTUALLY overwrote (the upsert's final read, after any retry), so a reconnect that raced in
  // between is the one revoked. Only once the new token is stored, and only a token of ANOTHER Google account
  // (assumption A13: revoking one refresh token may end the whole grant for that Google account and this client,
  // the new token included); a same-account token is left to Google's own expiry (V5, V6).
  const r = written.replaced;
  if (r && r.googleEmail.trim().toLowerCase() !== g.email.trim().toLowerCase()) {
    const old = openGoogleToken(r.sealed, r.keyVersion, { accountId, id: written.id, version: r.version }, [cfg.keys.current, cfg.keys.previous]);
    if (old) await revokeQuietly(old, deps, accountId, "revoking the replaced Google account's grant");
  }
  // PR 4 (D12): the "Reconnect your Google Calendar" To-do this write cleared off the row is done now. Scoped by
  // THIS account (completeTask's own filter), by the system: which BIS person reconnected is not the client's
  // to read on a To-do. A failure is logged; the connect stands.
  if (written.previousReconnectTaskId) {
    try {
      await completeTask(db, accountId, written.previousReconnectTaskId, "google-calendar", "system");
    } catch (e) {
      console.error(`google calendar callback: account ${accountId}: completing the reconnect To-do failed: ${scrub(e, [g.refreshToken, g.accessToken])}`);
    }
  }
  await recordGoogleEvent(db, accountId, "google_calendar.connected", access, { version: written.version });
  return go(calendarPath(accountId, "connected"), origin, { clearNonce: true });
}

/**
 * Who connected or disconnected. A client's Owner: the account's own event. The agency: BIS's own agency-only
 * record (account_id null, emitAgencyEvent), because which BIS person acted is not the client's to see by name
 * (F-032's owner-line rule). A failed record is logged and never undoes the act.
 */
export async function recordGoogleEvent(
  db: ReturnType<typeof serviceDb>, accountId: string, type: "google_calendar.connected" | "google_calendar.disconnected",
  actor: { userId: string; isAgency: boolean }, extra: Record<string, unknown>,
): Promise<void> {
  try {
    if (actor.isAgency) await emitAgencyEvent(db, type, actor.userId, { account_id: accountId, ...extra });
    else await emit(db, accountId, type, actor.userId, { by: actor.userId, ...extra }, "user");
  } catch (e) {
    console.error(`google calendar: account ${accountId}: the ${type} record failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function revokeQuietly(token: string, deps: GoogleRouteDeps, accountId: string, what: string): Promise<void> {
  const r = await revokeGoogleToken(token, { fetch: deps.fetch });
  if (!r.ok) console.error(`google calendar: account ${accountId}: ${what} failed (${r.error})`);
}

/** The route files' defaults: the real fetch, the process env. */
export const liveGoogleDeps = (): GoogleRouteDeps => ({ fetch: globalThis.fetch });
