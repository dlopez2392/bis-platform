import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { FREEBUSY_SCOPE } from "./calendar-client";
import { googleTokenKey, openGoogleToken, sealGoogleToken } from "./token-seal";

/**
 * S-22 slice 1, PR 2 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D3, D7, D8, D15): the
 * connect and callback routes. Every case drives the REAL handlers end to end: connect mints the state and the
 * nonce cookie, the callback is handed exactly what Google would send back. Google is a fake `fetch`; the global
 * one throws.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 9).toString("base64url");
const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: "client-123.apps.googleusercontent.com",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret_value_abc",
  GOOGLE_CALENDAR_TOKEN_KEY: KEY,
  GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/api/google-calendar/callback",
};
const ORIGIN = "http://localhost:3000";
const REFRESH = "1//0gREFRESH-token-value_abcdefghij";
const ACCESS = "ya29.ACCESS-token-value_abcdefghij";
const CODE = "4/0AcodeFROMgoogle_abcdefghij";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ID_TOKEN = `${b64({ alg: "RS256" })}.${b64({ iss: "https://accounts.google.com", aud: ENV.GOOGLE_CALENDAR_CLIENT_ID, email: "owner@example.com" })}.sig`;
const SCOPES = `openid ${FREEBUSY_SCOPE} https://www.googleapis.com/auth/userinfo.email`;
const SECRETS = [REFRESH, ACCESS, CODE, ID_TOKEN, ENV.GOOGLE_CALENDAR_CLIENT_SECRET];

type Role = "owner" | "staff" | "technician" | null;
const access = vi.hoisted(() => ({
  state: { userId: "user_A", isAgency: false, role: "owner" as Role, canManage: true },
  /** The one account this caller may enter; any other is a redirect (requireAccountAccess's own behaviour). */
  account: "11111111-1111-4111-8111-111111111111",
  calls: [] as string[],
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async (accountId: string) => {
    access.calls.push(accountId);
    if (accountId !== access.account) throw Object.assign(new Error("NEXT_REDIRECT"), { url: `/dashboard/accounts/${access.account}/dashboard` });
    return { ...access.state };
  },
  accountHome: (id: string, role: Role) => `/dashboard/accounts/${id}/${role === "technician" ? "tasks" : "dashboard"}`,
}));
const db = vi.hoisted(() => ({
  readPersonId: vi.fn(),
  upsertGoogleConnection: vi.fn(),
  emit: vi.fn(),
  emitAgencyEvent: vi.fn(),
  readGoogleConnectionSealed: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ fake: "service" }),
  readGoogleConnectionSealed: (...a: unknown[]) => db.readGoogleConnectionSealed(...a),
  readPersonId: (...a: unknown[]) => db.readPersonId(...a),
  upsertGoogleConnection: (...a: unknown[]) => db.upsertGoogleConnection(...a),
  emit: (...a: unknown[]) => db.emit(...a),
  emitAgencyEvent: (...a: unknown[]) => db.emitAgencyEvent(...a),
}));
/** The billing pause (M7a): a client's switch ON is refused while paused; billingVerdictFor fails open itself. */
const billing = vi.hoisted(() => ({ paused: false, calls: [] as string[] }));
vi.mock("@/lib/billing/standing-read", () => ({
  billingVerdictFor: async (accountId: string) => { billing.calls.push(accountId); return { paused: billing.paused }; },
}));

const { handleGoogleConnect, handleGoogleCallback, GOOGLE_NONCE_COOKIE } = await import("./oauth-routes");

type Call = { url: string; body: string };
let google: { calls: Call[]; token: { status: number; body: unknown }; revoke: { status: number } };
/** What happened, in order, across the database and Google: "upsert", "revoke:<token>". */
let order: string[];
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  google.calls.push({ url: u, body: String(init?.body ?? "") });
  if (u.endsWith("/revoke")) order.push(`revoke:${new URLSearchParams(String(init?.body)).get("token")}`);
  if (u === "https://oauth2.googleapis.com/token") return Response.json(google.token.body, { status: google.token.status });
  if (u === "https://oauth2.googleapis.com/revoke") return new Response("{}", { status: google.revoke.status });
  throw new Error(`unexpected Google URL ${u}`);
}) as typeof fetch;
let logs: string[];
const NOW = Date.parse("2026-11-15T12:00:00Z");
const deps = (over: Partial<{ now: number; env: Record<string, string | undefined> }> = {}) => ({ fetch: fakeFetch, env: ENV, now: NOW, ...over });

beforeEach(() => {
  access.state = { userId: "user_A", isAgency: false, role: "owner", canManage: true };
  access.account = A;
  access.calls = [];
  google = { calls: [], token: { status: 200, body: { access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: SCOPES, token_type: "Bearer", id_token: ID_TOKEN } }, revoke: { status: 200 } };
  billing.paused = false;
  billing.calls = [];
  order = [];
  db.readGoogleConnectionSealed.mockReset().mockResolvedValue(null);
  db.readPersonId.mockReset().mockResolvedValue("person_A");
  db.upsertGoogleConnection.mockReset().mockImplementation(async (_db: unknown, w: { seal: (r: object) => unknown }) => {
    order.push("upsert");
    const ref = { accountId: A, id: "33333333-3333-4333-8333-333333333333", version: 1 };
    db.upsertGoogleConnection.mock.lastCall!.push({ ref, sealed: await w.seal(ref) });
    return { id: ref.id, version: 1, previousReconnectTaskId: null };
  });
  db.emit.mockReset().mockResolvedValue(undefined);
  db.emitAgencyEvent.mockReset().mockResolvedValue(undefined);
  logs = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
vi.stubGlobal("fetch", () => { throw new Error("a test reached the real network"); });

const connectReq = (accountId: string = A, origin = ORIGIN) => new NextRequest(`${origin}/api/google-calendar/connect?account=${accountId}`);
/** Connect as the current caller; returns what Google would be handed (state, challenge) and the nonce cookie. */
async function connect(accountId: string = A, over = {}) {
  const res = await handleGoogleConnect(connectReq(accountId), deps(over));
  const loc = new URL(res.headers.get("location")!);
  return { res, state: loc.searchParams.get("state")!, challenge: loc.searchParams.get("code_challenge")!, nonce: res.cookies.get(GOOGLE_NONCE_COOKIE)?.value };
}
const callbackReq = (q: Record<string, string>, nonce?: string) => new NextRequest(
  `${ORIGIN}/api/google-calendar/callback?${new URLSearchParams(q)}`,
  { headers: nonce === undefined ? {} : { cookie: `${GOOGLE_NONCE_COOKIE}=${nonce}` } },
);
const locationOf = (res: Response) => res.headers.get("location");
const refusedNothingWritten = () => {
  expect(google.calls.filter((c) => c.url.endsWith("/token"))).toEqual([]);
  expect(db.upsertGoogleConnection).not.toHaveBeenCalled();
};

describe("connect (D7, D8)", () => {
  it("an Owner is sent to Google's consent screen with a sealed state and an HttpOnly, SameSite=Lax nonce cookie on the callback path", async () => {
    const { res, state, challenge, nonce } = await connect();
    expect(res.status).toBe(307);
    expect(locationOf(res)).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    expect(state).toMatch(/^s1\.[A-Za-z0-9_-]+$/);
    expect(state).not.toContain(A.replace(/-/g, "").slice(0, 12));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/google-calendar\/callback/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(access.calls).toEqual([A]);
  });

  it.each(["staff", "technician"] as const)("%s is refused at connect: sent to their home, no Google, no cookie (D3)", async (role) => {
    access.state = { userId: "user_A", isAgency: false, role, canManage: false };
    const res = await handleGoogleConnect(connectReq(), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/${role === "technician" ? "tasks" : "dashboard"}`);
    expect(res.cookies.get(GOOGLE_NONCE_COOKIE)).toBeUndefined();
  });

  it("the agency may connect on an Owner's behalf (D3, Q2); no person is recorded on the row, and which BIS person did it is BIS's own record (F-032's rule)", async () => {
    access.state = { userId: "user_agency", isAgency: true, role: null, canManage: true };
    db.readPersonId.mockResolvedValue(null); // the agency is never a member
    const { res, state, nonce } = await connect();
    expect(locationOf(res)).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=connected");
    expect(db.upsertGoogleConnection.mock.calls[0]![1]).toMatchObject({ connectedBy: null });
    expect(db.emit).not.toHaveBeenCalled();
    expect(db.emitAgencyEvent).toHaveBeenCalledWith({ fake: "service" }, "google_calendar.connected", "user_agency", { account_id: A, version: 1 });
  });

  it("a page on another origin than the redirect URI's gets no Google redirect: the cookie would land on the wrong host (D8)", async () => {
    const res = await handleGoogleConnect(connectReq(A, "https://bis-platform-git-branch.vercel.app"), deps());
    expect(locationOf(res)).toBe(`https://bis-platform-git-branch.vercel.app/dashboard/accounts/${A}/calendar?google=failed`);
    expect(res.cookies.get(GOOGLE_NONCE_COOKIE)).toBeUndefined();
  });

  it("an account id that is not a uuid is a 404, asking nobody", async () => {
    expect((await handleGoogleConnect(connectReq("not-a-uuid"), deps())).status).toBe(404);
    expect(access.calls).toEqual([]);
  });
});

describe("callback (D7)", () => {
  it("the happy path: exchanges the code with the PKCE verifier, seals the refresh token for the row, writes, clears the cookie, lands on the calendar page", async () => {
    const { state, challenge, nonce } = await connect();
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=connected`);
    const sent = new URLSearchParams(google.calls.find((c) => c.url.endsWith("/token"))!.body);
    expect(sent.get("code")).toBe(CODE);
    expect(createHash("sha256").update(sent.get("code_verifier")!).digest("base64url")).toBe(challenge);
    expect(db.upsertGoogleConnection).toHaveBeenCalledTimes(1);
    const [client, w, seen] = db.upsertGoogleConnection.mock.calls[0]! as [unknown, Record<string, unknown>, { ref: { accountId: string; id: string; version: number }; sealed: { sealed: string; keyVersion: number } }];
    expect(client).toEqual({ fake: "service" });
    expect(w).toMatchObject({ accountId: A, googleEmail: "owner@example.com", scope: SCOPES, connectedBy: "person_A", refreshExpiresAt: null });
    expect(openGoogleToken(seen.sealed.sealed, seen.sealed.keyVersion, seen.ref, [googleTokenKey(KEY)])).toBe(REFRESH);
    expect(db.readPersonId).toHaveBeenCalledWith({ fake: "service" }, A, "user_A");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${GOOGLE_NONCE_COOKIE}=;.*Max-Age=0`, "i"));
    expect(db.emit).toHaveBeenCalledWith({ fake: "service" }, A, "google_calendar.connected", "user_A", { by: "user_A", version: 1 }, "user");
  });

  it("a state minted for user A is refused for user B: no exchange, nothing written", async () => {
    const { state, nonce } = await connect();
    access.state = { userId: "user_B", isAgency: false, role: "owner", canManage: true };
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=failed`);
    refusedNothingWritten();
  });

  it("a state minted for account A is checked against A: a caller who may enter only B is redirected away and nothing is written", async () => {
    const { state, nonce } = await connect();
    access.account = B;
    await expect(handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps())).rejects.toThrow("NEXT_REDIRECT");
    expect(access.calls.at(-1)).toBe(A);
    refusedNothingWritten();
  });

  it("an expired state (over 10 minutes) is refused", async () => {
    const { state, nonce } = await connect();
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps({ now: NOW + 10 * 60_000 + 1 }));
    expect(locationOf(res)).toBe(`${ORIGIN}/`);
    refusedNothingWritten();
    expect(access.calls).toEqual([A]); // connect's only
  });

  it("a state that is still fresh at 9 minutes is accepted (the expiry is not 'always refuse')", async () => {
    const { state, nonce } = await connect();
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps({ now: NOW + 9 * 60_000 }));
    expect(locationOf(res)).toContain("google=connected");
  });

  it.each([["a different nonce", "x".repeat(43)], ["no nonce cookie", undefined]])("%s is refused, and the nonce cookie is cleared", async (_n, cookie) => {
    const { state } = await connect();
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, cookie), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/`);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${GOOGLE_NONCE_COOKIE}=;.*Path=/api/google-calendar/callback.*Max-Age=0`, "i"));
    refusedNothingWritten();
  });

  it("a tampered state does not open", async () => {
    const { state, nonce } = await connect();
    const flipped = state.slice(0, -2) + (state.endsWith("A") ? "BB" : "AA");
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state: flipped, scope: SCOPES }, nonce), deps()))).toBe(`${ORIGIN}/`);
    refusedNothingWritten();
  });

  it.each(["staff", "technician"] as const)("%s is refused at the callback even with a valid state (D3)", async (role) => {
    const { state, nonce } = await connect();
    access.state = { userId: "user_A", isAgency: false, role, canManage: false };
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/${role === "technician" ? "tasks" : "dashboard"}`);
    refusedNothingWritten();
  });

  it("a grant whose scope lacks calendar.freebusy writes nothing, revokes the grant it was handed, and says Google did not share", async () => {
    google.token.body = { access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: "openid https://www.googleapis.com/auth/userinfo.email", id_token: ID_TOKEN };
    const { state, nonce } = await connect();
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state }, nonce), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=denied`);
    expect(db.upsertGoogleConnection).not.toHaveBeenCalled();
    expect(new URLSearchParams(google.calls.find((c) => c.url.endsWith("/revoke"))!.body).get("token")).toBe(REFRESH);
  });

  it("Google's error=access_denied (the user pressed Cancel) is 'denied', with no exchange", async () => {
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ error: "access_denied", state }, nonce), deps()))).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=denied`);
    refusedNothingWritten();
  });

  it("a failed exchange is 'failed', nothing written", async () => {
    google.token = { status: 400, body: { error: "invalid_grant", error_description: `code ${CODE}` } };
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=failed`);
    expect(db.upsertGoogleConnection).not.toHaveBeenCalled();
  });

  it("a failed write revokes the new grant (no orphan at Google) and is 'failed'", async () => {
    db.upsertGoogleConnection.mockReset().mockRejectedValue(new Error("db down"));
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=failed");
    expect(google.calls.some((c) => c.url.endsWith("/revoke"))).toBe(true);
  });
});

describe("the nonce cookie over https (D7)", () => {
  const HTTPS = "https://app.example.test";
  const env = { ...ENV, GOOGLE_CALENDAR_REDIRECT_URI: `${HTTPS}/api/google-calendar/callback` };

  it("is Secure when the redirect URI is https, set and cleared alike", async () => {
    const res = await handleGoogleConnect(connectReq(A, HTTPS), deps({ env }));
    expect(locationOf(res)).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(res.headers.get("set-cookie")).toMatch(/;\s*Secure/i);
    const refused = await handleGoogleCallback(new NextRequest(`${HTTPS}/api/google-calendar/callback?code=x&state=s1.nope`), deps({ env }));
    expect(refused.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(refused.headers.get("set-cookie")).toMatch(/;\s*Secure/i);
  });

  it("is not Secure on http://localhost (a browser would drop it there)", async () => {
    expect((await connect()).res.headers.get("set-cookie")).not.toMatch(/;\s*Secure/i);
  });
});

describe("a billing-paused account: switching Google ON is refused for a client, as every client write is (M7a)", () => {
  it("a paused client is refused at connect: back to the calendar page with ?google=paused, no Google, no cookie", async () => {
    billing.paused = true;
    const res = await handleGoogleConnect(connectReq(), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=paused`);
    expect(res.cookies.get(GOOGLE_NONCE_COOKIE)).toBeUndefined();
    expect(billing.calls).toEqual([A]);
  });

  it("a client paused between connect and callback is refused BEFORE the exchange: no token is ever issued, nothing written, nonce cleared", async () => {
    const { state, nonce } = await connect();
    billing.paused = true;
    const res = await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps());
    expect(locationOf(res)).toBe(`${ORIGIN}/dashboard/accounts/${A}/calendar?google=paused`);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(google.calls).toEqual([]);
    expect(db.upsertGoogleConnection).not.toHaveBeenCalled();
  });

  it("the agency is never refused by a pause, at connect or at the callback", async () => {
    access.state = { userId: "user_agency", isAgency: true, role: null, canManage: true };
    db.readPersonId.mockResolvedValue(null);
    billing.paused = true;
    const { res, state, nonce } = await connect();
    expect(locationOf(res)).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=connected");
  });
});

describe("a reconnect does not leave the replaced grant behind at Google", () => {
  const OLD = "1//0gOLD-refresh-token_zyxwvutsrq";
  const ROW = { accountId: A, id: "33333333-3333-4333-8333-333333333333", version: 1 };
  const oldRow = (googleEmail: string) => {
    const s = sealGoogleToken(OLD, ROW, googleTokenKey(KEY)!);
    return { id: ROW.id, account_id: A, version: 1, status: "connected", refresh_token_sealed: s.sealed, key_version: s.keyVersion, google_email: googleEmail };
  };

  it("another Google account was connected: its refresh token is revoked AFTER the new one is written", async () => {
    db.readGoogleConnectionSealed.mockResolvedValue(oldRow("someone-else@example.com"));
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=connected");
    expect(order).toEqual(["upsert", `revoke:${OLD}`]);
  });

  it("the SAME Google account (A13): the old token is not revoked, since revoking it could end the new grant too", async () => {
    db.readGoogleConnectionSealed.mockResolvedValue(oldRow("Owner@Example.com"));
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=connected");
    expect(order).toEqual(["upsert"]);
  });

  it("a failed write keeps the old connection and its token: only the NEW grant is revoked", async () => {
    db.readGoogleConnectionSealed.mockResolvedValue(oldRow("someone-else@example.com"));
    db.upsertGoogleConnection.mockReset().mockRejectedValue(new Error("db down"));
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=failed");
    expect(order).toEqual([`revoke:${REFRESH}`]);
  });

  it("a failed revoke of the old token is logged by account and error code only; the connect stands", async () => {
    db.readGoogleConnectionSealed.mockResolvedValue(oldRow("someone-else@example.com"));
    google.revoke = { status: 400 };
    const { state, nonce } = await connect();
    expect(locationOf(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()))).toContain("google=connected");
    const line = logs.find((l) => l.includes("replaced"));
    expect(line).toContain(A);
    expect(logs.join("\n")).not.toContain(OLD);
  });
});

describe("dormant (D15)", () => {
  it.each(["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_TOKEN_KEY", "GOOGLE_CALENDAR_REDIRECT_URI"])("%s unset: both routes are 404 and ask nobody", async (name) => {
    const env = { ...ENV, [name]: undefined };
    expect((await handleGoogleConnect(connectReq(), deps({ env }))).status).toBe(404);
    expect((await handleGoogleCallback(callbackReq({ code: CODE, state: "s1.x" }, "n"), deps({ env }))).status).toBe(404);
    expect(access.calls).toEqual([]);
    expect(google.calls).toEqual([]);
  });
});

describe("no token leaves in a response, a redirect or a log line", () => {
  it("across success, a missing scope, a failed exchange and a failed write", async () => {
    const seen: string[] = [];
    const record = (res: Response) => seen.push(String(res.status), ...[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`));
    const run = async () => {
      const { res, state, nonce } = await connect();
      record(res);
      record(await handleGoogleCallback(callbackReq({ code: CODE, state, scope: SCOPES }, nonce), deps()));
    };
    await run();
    google.token.body = { ...(google.token.body as object), scope: "openid" };
    await run();
    google.token = { status: 400, body: { error: "invalid_grant", error_description: `refresh ${REFRESH} access ${ACCESS} code ${CODE}` } };
    await run();
    google.token = { status: 200, body: { access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: SCOPES, id_token: ID_TOKEN } };
    google.revoke = { status: 400 };
    db.upsertGoogleConnection.mockReset().mockRejectedValue(new Error(`insert failed for ${REFRESH}`));
    await run();
    expect(logs.length).toBeGreaterThan(0);
    const all = [...seen, ...logs].join("\n");
    for (const secret of SECRETS) expect(all).not.toContain(secret);
  });
});
