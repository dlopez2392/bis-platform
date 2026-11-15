import { describe, it, expect, vi, afterEach } from "vitest";
import {
  FREEBUSY_SCOPE, googleCalendarConfig, grantsFreeBusy, exchangeGoogleCode, refreshGoogleAccessToken,
  queryGoogleFreeBusy, revokeGoogleToken, googleAuthUrl, type GoogleCalendarConfig,
} from "./calendar-client";
import { googleTokenKey } from "./token-seal";

/**
 * S-22 slice 1, PR 2 (plan docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md, D1, D5, D7, D8, D15,
 * V2-V9): the Google client. `fetch` is ALWAYS injected; a test never reaches Google (the global fetch throws).
 */
const KEY = Buffer.alloc(32, 7).toString("base64url");
const ENV = {
  GOOGLE_CALENDAR_CLIENT_ID: "client-123.apps.googleusercontent.com",
  GOOGLE_CALENDAR_CLIENT_SECRET: "secret_value_abc",
  GOOGLE_CALENDAR_TOKEN_KEY: KEY,
  GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/api/google-calendar/callback",
};
const CFG: GoogleCalendarConfig = googleCalendarConfig(ENV)!;
const REFRESH = "1//0gREFRESH-token-value_abcdefghij";
const ACCESS = "ya29.ACCESS-token-value_abcdefghij";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (claims: object) => `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
const ID_OK = idToken({ iss: "https://accounts.google.com", aud: ENV.GOOGLE_CALENDAR_CLIENT_ID, email: "owner@example.com" });
const SCOPES = `openid ${FREEBUSY_SCOPE} https://www.googleapis.com/auth/userinfo.email`;

type Call = { url: string; init: RequestInit };
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const form = (c: Call) => new URLSearchParams(String(c.init.body));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
vi.stubGlobal("fetch", () => { throw new Error("a test reached the real network"); });

describe("googleCalendarConfig: dormant unless every value is set and sound (D15)", () => {
  it("all four set: a config naming the client, the redirect URI and the key", () => {
    expect(CFG).toMatchObject({ clientId: ENV.GOOGLE_CALENDAR_CLIENT_ID, redirectUri: ENV.GOOGLE_CALENDAR_REDIRECT_URI });
    expect(CFG.keys.current?.id).toBe(googleTokenKey(KEY)!.id);
  });

  it.each(["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_TOKEN_KEY", "GOOGLE_CALENDAR_REDIRECT_URI"])(
    "%s unset or blank: null, so the routes 404 and nothing calls Google", (name) => {
      expect(googleCalendarConfig({ ...ENV, [name]: undefined })).toBeNull();
      expect(googleCalendarConfig({ ...ENV, [name]: "  " })).toBeNull();
    });

  it("a refused key (under 32 bytes) is dormant too", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(googleCalendarConfig({ ...ENV, GOOGLE_CALENDAR_TOKEN_KEY: Buffer.alloc(16, 1).toString("base64url") })).toBeNull();
  });

  it("the redirect URI must be https, or http on localhost (V8); anything else is dormant, with a line naming the variable", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(googleCalendarConfig({ ...ENV, GOOGLE_CALENDAR_REDIRECT_URI: "http://app.bis-rgv.com/api/google-calendar/callback" })).toBeNull();
    expect(googleCalendarConfig({ ...ENV, GOOGLE_CALENDAR_REDIRECT_URI: "not a url" })).toBeNull();
    expect(googleCalendarConfig({ ...ENV, GOOGLE_CALENDAR_REDIRECT_URI: "https://app.bis-rgv.com/api/google-calendar/callback" })).not.toBeNull();
    expect(err.mock.calls.flat().join(" ")).toContain("GOOGLE_CALENDAR_REDIRECT_URI");
  });
});

describe("googleAuthUrl (D1, D7)", () => {
  it("asks for exactly openid, email and calendar.freebusy, offline, with consent, PKCE S256 and the state", () => {
    const u = new URL(googleAuthUrl(CFG, { state: "s1.STATE", codeChallenge: "CHALLENGE" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: CFG.clientId, redirect_uri: CFG.redirectUri, response_type: "code",
      scope: `openid email ${FREEBUSY_SCOPE}`, access_type: "offline", prompt: "consent",
      state: "s1.STATE", code_challenge: "CHALLENGE", code_challenge_method: "S256",
    });
  });
});

describe("grantsFreeBusy (V7: the user may untick the calendar box)", () => {
  it("true only when the granted scope list holds calendar.freebusy exactly", () => {
    expect(grantsFreeBusy(SCOPES)).toBe(true);
    expect(grantsFreeBusy("openid https://www.googleapis.com/auth/userinfo.email")).toBe(false);
    expect(grantsFreeBusy(`${FREEBUSY_SCOPE}.extra openid`)).toBe(false);
    expect(grantsFreeBusy("")).toBe(false);
  });
});

describe("exchangeGoogleCode (V7)", () => {
  const OK = { access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: SCOPES, token_type: "Bearer", id_token: ID_OK };

  it("posts the code, the client, the redirect URI and the PKCE verifier as a form; returns the grant", async () => {
    const f = fakeFetch(200, OK);
    const now = Date.parse("2026-11-15T12:00:00Z");
    const r = await exchangeGoogleCode(CFG, { code: "CODE", codeVerifier: "VERIFIER" }, { fetch: f.fn, now });
    expect(f.calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(Object.fromEntries(form(f.calls[0]!))).toEqual({
      grant_type: "authorization_code", code: "CODE", code_verifier: "VERIFIER",
      client_id: CFG.clientId, client_secret: CFG.clientSecret, redirect_uri: CFG.redirectUri,
    });
    expect(r).toEqual({ ok: true, grant: {
      refreshToken: REFRESH, accessToken: ACCESS, accessExpiresAt: new Date(now + 3599_000),
      scope: SCOPES, email: "owner@example.com", refreshExpiresAt: null,
    } });
  });

  it("refresh_token_expires_in (time-based access) becomes refreshExpiresAt", async () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    const r = await exchangeGoogleCode(CFG, { code: "C", codeVerifier: "V" }, { fetch: fakeFetch(200, { ...OK, refresh_token_expires_in: 604799 }).fn, now });
    expect(r.ok && r.grant.refreshExpiresAt).toEqual(new Date(now + 604799_000));
  });

  it.each([
    ["no refresh_token", { ...OK, refresh_token: undefined }],
    ["no access_token", { ...OK, access_token: "" }],
    ["expires_in missing", { ...OK, expires_in: undefined }],
    ["expires_in not positive", { ...OK, expires_in: 0 }],
    ["expires_in a string", { ...OK, expires_in: "3599" }],
    ["no scope", { ...OK, scope: undefined }],
    ["no id_token", { ...OK, id_token: undefined }],
    ["id_token for another client", { ...OK, id_token: idToken({ iss: "https://accounts.google.com", aud: "other", email: "a@b.c" }) }],
    ["id_token from another issuer", { ...OK, id_token: idToken({ iss: "https://evil.example", aud: ENV.GOOGLE_CALENDAR_CLIENT_ID, email: "a@b.c" }) }],
    ["id_token without email", { ...OK, id_token: idToken({ iss: "accounts.google.com", aud: ENV.GOOGLE_CALENDAR_CLIENT_ID }) }],
    ["id_token not a JWT", { ...OK, id_token: "garbage" }],
    ["not an object", [1, 2]],
  ])("%s: refused as malformed, never half a grant", async (_n, body) => {
    expect(await exchangeGoogleCode(CFG, { code: "C", codeVerifier: "V" }, { fetch: fakeFetch(200, body).fn })).toEqual({ ok: false, error: "malformed" });
  });

  it("Google's error body is reduced to its error code; the description never travels", async () => {
    const r = await exchangeGoogleCode(CFG, { code: "C", codeVerifier: "V" }, {
      fetch: fakeFetch(400, { error: "invalid_grant", error_description: `Bad code ${REFRESH}` }).fn,
    });
    expect(r).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("a non-JSON 500 and a thrown fetch are 'http_500' and 'network'", async () => {
    expect(await exchangeGoogleCode(CFG, { code: "C", codeVerifier: "V" }, { fetch: fakeFetch(500, "<html>").fn })).toEqual({ ok: false, error: "http_500" });
    const boom = (async () => { throw new Error(`socket ${REFRESH}`); }) as unknown as typeof fetch;
    expect(await exchangeGoogleCode(CFG, { code: "C", codeVerifier: "V" }, { fetch: boom })).toEqual({ ok: false, error: "network" });
  });
});

describe("refreshGoogleAccessToken (A12: expires_in read every time)", () => {
  it("posts grant_type=refresh_token; returns the access token and its expiry", async () => {
    const f = fakeFetch(200, { access_token: ACCESS, expires_in: 1800, scope: SCOPES, token_type: "Bearer" });
    const r = await refreshGoogleAccessToken(CFG, REFRESH, { fetch: f.fn, now: 1000 });
    expect(Object.fromEntries(form(f.calls[0]!))).toEqual({
      grant_type: "refresh_token", refresh_token: REFRESH, client_id: CFG.clientId, client_secret: CFG.clientSecret,
    });
    expect(r).toEqual({ ok: true, accessToken: ACCESS, accessExpiresAt: new Date(1000 + 1800_000) });
  });

  it("invalid_grant is named, so the caller can mark the connection (D12)", async () => {
    expect(await refreshGoogleAccessToken(CFG, REFRESH, { fetch: fakeFetch(400, { error: "invalid_grant" }).fn })).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("an answer with no expires_in is malformed", async () => {
    expect(await refreshGoogleAccessToken(CFG, REFRESH, { fetch: fakeFetch(200, { access_token: ACCESS }).fn })).toEqual({ ok: false, error: "malformed" });
  });
});

describe("queryGoogleFreeBusy (D2, D10, V2, V3)", () => {
  const WIN = { timeMin: new Date("2026-11-15T00:00:00Z"), timeMax: new Date("2026-11-18T00:00:00Z") };

  it("asks for the primary calendar over the window with the bearer token; returns parsed [start, end) ranges", async () => {
    const f = fakeFetch(200, { calendars: { primary: { busy: [{ start: "2026-11-16T10:00:00Z", end: "2026-11-16T11:00:00Z" }] } } });
    const r = await queryGoogleFreeBusy(ACCESS, WIN, { fetch: f.fn });
    expect(f.calls[0]!.url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(new Headers(f.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${ACCESS}`);
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      timeMin: "2026-11-15T00:00:00.000Z", timeMax: "2026-11-18T00:00:00.000Z", items: [{ id: "primary" }],
    });
    expect(r).toEqual({ ok: true, busy: [{ start: new Date("2026-11-16T10:00:00Z"), end: new Date("2026-11-16T11:00:00Z") }] });
  });

  it.each([
    ["an errors[] entry", { calendars: { primary: { errors: [{ domain: "global", reason: "internalError" }], busy: [] } } }],
    ["an unparseable instant", { calendars: { primary: { busy: [{ start: "tomorrow", end: "2026-11-16T11:00:00Z" }] } } }],
    ["an end before its start", { calendars: { primary: { busy: [{ start: "2026-11-16T11:00:00Z", end: "2026-11-16T10:00:00Z" }] } } }],
    ["no primary calendar", { calendars: {} }],
    ["busy not a list", { calendars: { primary: { busy: "none" } } }],
  ])("%s: the whole answer is malformed, never an Invalid Date in the engine", async (_n, body) => {
    expect(await queryGoogleFreeBusy(ACCESS, WIN, { fetch: fakeFetch(200, body).fn })).toEqual({ ok: false, error: "malformed" });
  });

  it("401 and 429 keep their status as the code", async () => {
    expect(await queryGoogleFreeBusy(ACCESS, WIN, { fetch: fakeFetch(401, { error: { code: 401 } }).fn })).toEqual({ ok: false, error: "http_401" });
    expect(await queryGoogleFreeBusy(ACCESS, WIN, { fetch: fakeFetch(429, "slow down").fn })).toEqual({ ok: false, error: "http_429" });
  });
});

describe("revokeGoogleToken (V9)", () => {
  it("posts token= to the revoke endpoint; 200 is ok", async () => {
    const f = fakeFetch(200, {});
    expect(await revokeGoogleToken(REFRESH, { fetch: f.fn })).toEqual({ ok: true });
    expect(f.calls[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(Object.fromEntries(form(f.calls[0]!))).toEqual({ token: REFRESH });
  });

  it("a refusal or a network failure is not ok, with the error code only", async () => {
    expect(await revokeGoogleToken(REFRESH, { fetch: fakeFetch(400, { error: "invalid_token", error_description: REFRESH }).fn })).toEqual({ ok: false, error: "invalid_token" });
    const boom = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await revokeGoogleToken(REFRESH, { fetch: boom })).toEqual({ ok: false, error: "network" });
  });
});
