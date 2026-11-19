// The read-only MCP server's route (docs/superpowers/plans/2026-11-19-mcp-server.md §3.1-§3.3, §3.5, tests §5).
// Real Request objects go through the route's own POST, the real MCP transport, the real tool runner and the owner
// line's real read-client factory. Mocked at module boundaries only: Clerk (who the token is), @bis/db (the service
// client, the switch, the access-log function), the memberships read and the four staff reads (their own suites and
// the live test cover what they return).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "@/lib/mcp/mcp-tool-schemas.fixture.json";
import { m } from "@/lib/messages";

type Membership = { accountId: string; userId: string; role: "owner" | "staff" | "technician"; businessName: string; number: string | null };
type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const accounts = new Map<string, Row>();
  const users = new Map<string, Row>();
  const tables: Record<string, Map<string, Row>> = { accounts, users };
  const SERVICE = {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => ({ data: tables[table]?.get(val) ?? null, error: null }),
        }),
      }),
    }),
  };
  return {
    accounts, users, SERVICE,
    authenticate: vi.fn(),
    memberships: vi.fn(),
    switchOn: new Map<string, boolean>(),
    readSwitch: vi.fn(),
    note: vi.fn(),
    reads: {
      callsAndMessages: vi.fn(), appointments: vi.fn(), needsAttention: vi.fn(), lookupCustomer: vi.fn(),
    },
  };
});

vi.mock("@clerk/nextjs/server", () => ({ clerkClient: async () => ({ authenticateRequest: h.authenticate }) }));
vi.mock("@bis/db", () => ({
  serviceDb: () => h.SERVICE,
  userDb: () => { throw new Error("the token path is not in use"); },
  readAiAppsSwitch: (...a: unknown[]) => h.readSwitch(...a),
  noteAiAppRead: (...a: unknown[]) => h.note(...a),
}));
vi.mock("@/lib/owner-line/memberships", () => ({ listMyMemberships: (...a: unknown[]) => h.memberships(...a) }));
vi.mock("@/lib/tools/staff/read", () => h.reads);

import { POST, GET, DELETE } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const ME = "user_me";
const RESOURCE = "https://app.bis-rgv.com/api/mcp";
const PRM = 'Bearer resource_metadata="https://app.bis-rgv.com/.well-known/oauth-protected-resource/api/mcp"';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const TOKEN = jwt({ sub: ME });

/** What Clerk's authenticateRequest answers for a valid OAuth access token of `userId`. */
const oauthState = (token: string, userId = ME) => ({
  isAuthenticated: true, token, tokenType: "oauth_token",
  toAuth: () => ({ isAuthenticated: true, tokenType: "oauth_token", userId, clientId: "client_1", scopes: ["profile", "email"] }),
});
const signedOutState = () => ({
  isAuthenticated: false, token: null, tokenType: "oauth_token",
  toAuth: () => ({ isAuthenticated: false, tokenType: "oauth_token", userId: null, clientId: null, scopes: null }),
});

const member = (accountId: string, role: Membership["role"] = "owner", businessName = `Biz ${accountId.slice(0, 1)}`): Membership =>
  ({ accountId, userId: `u_${accountId.slice(0, 1)}`, role, businessName, number: null });

function setMemberships(...ms: Membership[]) {
  h.memberships.mockResolvedValue(ms);
  for (const x of ms) {
    if (!h.switchOn.has(x.accountId)) h.switchOn.set(x.accountId, true);
    h.accounts.set(x.accountId, { timezone: "America/Chicago", language: null, clerk_org_id: `org_${x.accountId.slice(0, 1)}` });
  }
}

let n = 0;
function post(body: unknown, opts: { token?: string | null; headers?: Record<string, string> } = {}): Promise<Response> {
  const token = opts.token === undefined ? TOKEN : opts.token;
  return POST(new Request(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...opts.headers,
    },
    body: JSON.stringify(body),
  }));
}
const rpc = (method: string, params: Record<string, unknown>) => ({ jsonrpc: "2.0", id: ++n, method, params });

/** One tools/call through the route; answers the tool's own JSON and the exact text it travelled as. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<{ out: Record<string, unknown>; text: string }> {
  const res = await post(rpc("tools/call", { name, arguments: args }));
  expect(res.status).toBe(200);
  const body = await res.json() as { result: { content: { type: string; text: string }[] } };
  expect(body.result.content).toHaveLength(1);
  expect(body.result.content[0]!.type).toBe("text");
  const text = body.result.content[0]!.text;
  return { out: JSON.parse(text) as Record<string, unknown>, text };
}

const nothingRead = () => {
  for (const f of Object.values(h.reads)) expect(f).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
  h.accounts.clear(); h.users.clear(); h.switchOn.clear();
  h.authenticate.mockReset().mockImplementation(async (req: Request) =>
    oauthState((req.headers.get("authorization") ?? "").replace(/^Bearer /, "")));
  h.memberships.mockReset().mockResolvedValue([]);
  h.readSwitch.mockReset().mockImplementation(async (_db: unknown, accountId: string) =>
    ({ enabledAt: h.switchOn.get(accountId) ? "2026-11-19T12:00:00Z" : null, changedAt: null, changedBy: null }));
  h.note.mockReset().mockResolvedValue({ ok: true, visitId: "visit_1" });
  h.users.set(ME, { name: "Ana Owner", language: null });
  h.reads.callsAndMessages.mockReset().mockImplementation(async (c: { accountId: string }) => ({ ok: true, read: "calls", accountId: c.accountId }));
  h.reads.appointments.mockReset().mockImplementation(async (c: { accountId: string }) => ({ ok: true, read: "appointments", accountId: c.accountId }));
  h.reads.needsAttention.mockReset().mockImplementation(async (c: { accountId: string }) => ({ ok: true, read: "todo", accountId: c.accountId }));
  h.reads.lookupCustomer.mockReset().mockImplementation(async (c: { accountId: string }) => ({ ok: true, read: "lookup", accountId: c.accountId }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sign-in: a request without a valid OAuth access token is 401, pointing at the metadata (plan §3.1)", () => {
  it("no Authorization header -> 401 with resource_metadata, and Clerk is not even asked (mutation: drop the header check -> FAILS)", async () => {
    const res = await post(rpc("tools/list", {}), { token: null });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(PRM);
    expect(h.authenticate).not.toHaveBeenCalled();
  });

  it("a bearer Clerk does not accept -> 401, nothing read (mutation: accept any bearer -> FAILS)", async () => {
    h.authenticate.mockResolvedValue(signedOutState());
    setMemberships(member(A));
    const res = await post(rpc("tools/call", { name: "needs_attention", arguments: {} }), { token: "garbage" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(PRM);
    expect(h.memberships).not.toHaveBeenCalled();
    nothingRead();
  });

  it("asks Clerk for an OAuth access token only (mutation: acceptsToken \"any\" or \"session_token\" -> FAILS)", async () => {
    await post(rpc("tools/list", {}));
    expect(h.authenticate).toHaveBeenCalledTimes(1);
    expect(h.authenticate.mock.calls[0]![1]).toEqual({ acceptsToken: "oauth_token" });
  });

  it("a Clerk SESSION token is refused even when Clerk says it is signed in (mutation: skip verifyClerkToken -> FAILS)", async () => {
    h.authenticate.mockResolvedValue({ isAuthenticated: true, token: TOKEN, tokenType: "session_token",
      toAuth: () => ({ isAuthenticated: true, tokenType: "session_token", userId: ME, sessionId: "sess_1" }) });
    const res = await post(rpc("tools/list", {}));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(PRM);
  });

  it("Bearer a.b.c, which makes Clerk throw, is 401, never 500 (mutation: let Clerk's throw escape -> FAILS)", async () => {
    h.authenticate.mockRejectedValue(new SyntaxError("Unexpected end of data"));
    const res = await post(rpc("tools/list", {}), { token: "a.b.c" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(PRM);
  });

  it("a refused token is logged by the error's class only, never the token or Clerk's message (mutation: log String(e) or the Authorization header -> FAILS)", async () => {
    const secret = jwt({ sub: ME, note: "tok-secret-bytes" });
    h.authenticate.mockRejectedValue(new SyntaxError("Unexpected end of data near tok-secret-bytes"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post(rpc("tools/list", {}), { token: secret })).status).toBe(401);
    const logged = err.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain("Unexpected end of data");
    expect(logged).not.toContain("tok-secret-bytes");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("Bearer");
  });

  it("a token Clerk verified with no user id is refused (mutation: accept any bearer -> FAILS)", async () => {
    h.authenticate.mockResolvedValue({ ...oauthState(TOKEN), toAuth: () => ({ isAuthenticated: true, tokenType: "oauth_token",
      userId: null, clientId: "client_1", scopes: ["profile"] }) });
    expect((await post(rpc("tools/list", {}))).status).toBe(401);
  });

  it("GET and DELETE are 405 with Allow: POST, a stateless server has no stream and no session (mutation: drop the Allow header -> FAILS)", async () => {
    for (const res of [GET(), DELETE()]) {
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});

describe("the token's audience, read from the token Clerk verified (plan §3.2 step 1)", () => {
  const list = (token: string) => post(rpc("tools/list", {}), { token });

  it("in production an access token with NO aud is refused (mutation: drop the production presence check -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await list(jwt({ sub: ME }))).status).toBe(401);
  });

  it("in production an aud equal to this endpoint is accepted, as a string or a one-entry list (mutation: read aud as a string only -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await list(jwt({ sub: ME, aud: RESOURCE }))).status).toBe(200);
    expect((await list(jwt({ sub: ME, aud: [RESOURCE] }))).status).toBe(200);
  });

  it("anywhere, an aud naming something else is refused, alone or beside this endpoint (mutation: drop the mismatch check -> FAILS)", async () => {
    for (const env of ["production", "preview", ""]) {
      vi.stubEnv("VERCEL_ENV", env);
      expect((await list(jwt({ sub: ME, aud: "https://other.example/api" }))).status, env).toBe(401);
      expect((await list(jwt({ sub: ME, aud: [RESOURCE, "https://other.example/api"] }))).status, env).toBe(401);
    }
  });

  it("a LIVE Clerk secret key requires aud too, whatever VERCEL_ENV says (mutation: drop the sk_live_ signal -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_live_fixture");
    expect((await list(jwt({ sub: ME }))).status).toBe(401);
    expect((await list(jwt({ sub: ME, aud: RESOURCE }))).status).toBe(200);
  });

  it("VERCEL_ENV production alone, with a development Clerk key, still requires aud (mutation: drop the VERCEL_ENV signal -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
    expect((await list(jwt({ sub: ME }))).status).toBe(401);
  });

  it("outside production a token with no aud is accepted, the development instance issues none, spike §7.4 (mutation: require aud everywhere -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await list(jwt({ sub: ME }))).status).toBe(200);
  });

  it("the token presented must be the very token Clerk verified, whose claims are the ones judged (mutation: drop that identity check -> FAILS)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    h.authenticate.mockResolvedValue(oauthState(jwt({ sub: ME, aud: RESOURCE })));
    expect((await list(jwt({ sub: ME, aud: "https://other.example/api" }))).status).toBe(401);
  });
});

describe("a JSON-RPC batch is refused (MCP 2025-06-18 dropped batching; plan §3.5)", () => {
  it("a POST whose body is a JSON array is 400 with a JSON-RPC error, before Clerk or the database is asked (mutation: let the SDK take the batch -> FAILS)", async () => {
    setMemberships(member(A));
    const batch = [rpc("tools/call", { name: "needs_attention", arguments: {} }), rpc("tools/call", { name: "needs_attention", arguments: {} })];
    const res = await post(batch);
    expect(res.status).toBe(400);
    const body = await res.json() as { jsonrpc: string; error: { code: number; message: string }; id: null };
    expect(body).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
    expect(h.authenticate).not.toHaveBeenCalled();
    expect(h.memberships).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
  });

  it("a single message is still served, its body intact after the check (mutation: consume the body in the check -> FAILS)", async () => {
    const res = await post(rpc("tools/list", {}));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: { tools: unknown[] } }).result.tools).toHaveLength(fixture.length);
  });
});

describe("tools/list (plan §3.3)", () => {
  it("is exactly the fixture: the four staff tools plus business, and my_businesses (mutation: change a word in a staff spec -> FAILS)", async () => {
    const res = await post(rpc("tools/list", {}));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { tools: unknown[] } };
    expect(body.result.tools.map((x) => JSON.stringify(x))).toEqual(fixture);
    expect(h.memberships).not.toHaveBeenCalled();
  });

  it("initialize answers with tools as the one capability, and reads nothing (mutation: declare another capability -> FAILS)", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { capabilities: Record<string, unknown> } };
    expect(Object.keys(body.result.capabilities)).toEqual(["tools"]);
    expect(h.memberships).not.toHaveBeenCalled();
  });
});

describe("a write-shaped or unknown tool (plan §5)", () => {
  it("book_appointment called directly is refused with nothing read and nothing logged (mutation: widen the offered catalogue to any name -> FAILS)", async () => {
    setMemberships(member(A));
    const { out } = await call("book_appointment", { when: "tomorrow" });
    expect(out).toEqual({ ok: false, error: "unknown_tool" });
    expect(h.memberships).not.toHaveBeenCalled();
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
  });
});

describe("which business: only the person's own, re-read on every request (plan §3.2 steps 2-3)", () => {
  it("is keyed on the token's user, through the service client (mutation: key the read on anything but the token's user -> FAILS)", async () => {
    setMemberships(member(A));
    await call("needs_attention");
    expect(h.memberships).toHaveBeenCalledWith(h.SERVICE, ME);
  });

  it("exactly one allowed business and no argument -> that business is read (mutation: always answer choose_business without an argument -> FAILS)", async () => {
    setMemberships(member(A));
    const { out } = await call("needs_attention");
    expect(out).toEqual({ ok: true, read: "todo", accountId: A });
  });

  it("a business of null or \"\" is read as left out, as some clients send an optional argument (mutation: only undefined counts as left out -> FAILS)", async () => {
    setMemberships(member(A));
    expect((await call("needs_attention", { business: null })).out).toEqual({ ok: true, read: "todo", accountId: A });
    expect((await call("needs_attention", { business: "" })).out).toEqual({ ok: true, read: "todo", accountId: A });
  });

  it("an Owner of A only who names B's id gets choose_business listing A only, byte-identical to naming an id that does not exist (mutation: skip the membership filter -> FAILS)", async () => {
    setMemberships(member(A));
    h.accounts.set(B, { timezone: "America/Chicago", language: null, clerk_org_id: "org_B" });
    h.switchOn.set(B, true);
    const named = await call("needs_attention", { business: B });
    const ghost = await call("needs_attention", { business: "99999999-9999-4999-8999-999999999999" });
    const typo = await call("needs_attention", { business: 42 });
    expect(named.out).toEqual({ ok: false, error: "choose_business", message: m["mcp.chooseBusiness"],
      businesses: [{ id: A, name: "Biz 1" }] });
    expect(ghost.text).toBe(named.text);
    expect(typo.text).toBe(named.text);
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
  });

  it("with two businesses, naming one they may not ask about is byte-identical to leaving it out, plan §3.2 step 3 (mutation: skip the membership filter -> FAILS)", async () => {
    setMemberships(member(A), member(C, "staff", "Biz 3"));
    const omitted = await call("appointments", { range: "today" });
    const other = await call("appointments", { range: "today", business: B });
    expect(omitted.out).toEqual({ ok: false, error: "choose_business", message: m["mcp.chooseBusiness"],
      businesses: [{ id: A, name: "Biz 1" }, { id: C, name: "Biz 3" }] });
    expect(other.text).toBe(omitted.text);
    nothingRead();
  });

  it("with two businesses, naming one of them reads that one, and the read never sees the business argument (mutation: pass business through to the read -> FAILS)", async () => {
    setMemberships(member(A), member(C, "staff"));
    const { out } = await call("appointments", { range: "today", business: C });
    expect(out).toEqual({ ok: true, read: "appointments", accountId: C });
    expect(h.reads.appointments.mock.calls[0]![1]).toEqual({ range: "today" });
  });

  it("a Technician of A gets no_business (mutation: drop the OWNER_LINE_ROLES filter -> FAILS)", async () => {
    setMemberships(member(A, "technician"));
    const { out } = await call("needs_attention");
    expect(out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
  });

  it("an agency person, who has no account membership, gets no_business (mutation: answer an empty list with anything but no_business -> FAILS)", async () => {
    setMemberships();
    expect((await call("lookup_customer", { term: "Ana" })).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    nothingRead();
  });

  it("A's switch off -> no_business (mutation: skip the switch filter -> FAILS)", async () => {
    setMemberships(member(A));
    h.switchOn.set(A, false);
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    expect(h.readSwitch).toHaveBeenCalledWith(h.SERVICE, A);
    nothingRead();
  });

  it("switching A off between two calls stops the second (mutation: read the switch once per process -> FAILS)", async () => {
    setMemberships(member(A));
    expect((await call("needs_attention")).out).toEqual({ ok: true, read: "todo", accountId: A });
    h.switchOn.set(A, false);
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    expect(h.reads.needsAttention).toHaveBeenCalledTimes(1);
  });

  it("losing the membership between two calls stops the second (mutation: cache the memberships -> FAILS)", async () => {
    setMemberships(member(A));
    await call("needs_attention");
    h.memberships.mockResolvedValue([]);
    expect((await call("needs_attention")).out.error).toBe("no_business");
    expect(h.memberships).toHaveBeenCalledTimes(2);
  });

  it("answers in the person's own language: no_business in Spanish for a Spanish speaker (mutation: refusals always in English -> FAILS)", async () => {
    h.users.set(ME, { name: "Ana", language: "es" });
    setMemberships();
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness.es"] });
  });
});

describe("the access log: one item of the tool's kind, written BEFORE the read (plan §3.4; F-118 owner ruling 4)", () => {
  it.each([
    ["calls_and_messages", { range: "today" }, "ai_app_calls_and_messages", "callsAndMessages"],
    ["appointments", { range: "tomorrow" }, "ai_app_appointments", "appointments"],
    ["needs_attention", {}, "ai_app_needs_attention", "needsAttention"],
    ["lookup_customer", { term: "Ruiz" }, "ai_app_lookup_customer", "lookupCustomer"],
  ] as const)("%s logs exactly one %s item, then reads (mutation: log after the read -> FAILS)", async (tool, args, kind, read) => {
    setMemberships(member(A));
    await call(tool, args);
    expect(h.note).toHaveBeenCalledTimes(1);
    const [db, p] = h.note.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(db).toBe(h.SERVICE);
    expect(p).toEqual({ accountId: A, actorClerkUserId: ME, actorName: "Ana Owner", kind, requestId: expect.stringMatching(UUID) });
    expect(h.reads[read]).toHaveBeenCalledTimes(1);
    expect(h.note.mock.invocationCallOrder[0]!).toBeLessThan(h.reads[read].mock.invocationCallOrder[0]!);
  });

  it("every call carries a fresh request id (mutation: one id per process -> FAILS)", async () => {
    setMemberships(member(A));
    await call("needs_attention");
    await call("needs_attention");
    const ids = h.note.mock.calls.map((c) => (c[1] as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
  });

  it("a failed log write fails the call: couldnt_read and nothing read (mutation: swallow the log error -> FAILS)", async () => {
    setMemberships(member(A));
    h.note.mockRejectedValue(new Error("noteAiAppRead failed: Maria López"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("lookup_customer", { term: "Maria" })).out).toEqual({ ok: false, error: "couldnt_read" });
    nothingRead();
    expect(err.mock.calls.flat().join(" ")).not.toContain("Maria");
  });

  it("the database's not_allowed (switched off between the list and the write) answers no_business, nothing read (mutation: read when the write is refused -> FAILS)", async () => {
    setMemberships(member(A));
    h.note.mockResolvedValue({ ok: false, reason: "not_allowed" });
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    nothingRead();
  });

  it("the database's rate_limited (the 61st call in 10 minutes, plan §3.5) is refused with a retry hint, nothing read (mutation: answer rate_limited as no_business -> FAILS)", async () => {
    setMemberships(member(A));
    h.note.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect((await call("calls_and_messages", { range: "today" })).out).toEqual({ ok: false, error: "rate_limited", message: m["mcp.rateLimited"] });
    nothingRead();
  });
});

describe("the read itself (plan §3.3)", () => {
  it("runs on the owner line's factory client with the account's zone and the person's language (mutation: the business's language first -> FAILS)", async () => {
    setMemberships(member(A));
    h.accounts.set(A, { timezone: "America/Denver", language: "en", clerk_org_id: "org_A" });
    h.users.set(ME, { name: "Ana", language: "es" });
    await call("calls_and_messages", { range: "today" });
    const [c, a] = h.reads.callsAndMessages.mock.calls[0]! as [Record<string, unknown>, unknown];
    expect(c).toMatchObject({ db: h.SERVICE, accountId: A, timezone: "America/Denver", locale: "es" });
    expect(c.now).toBeInstanceOf(Date);
    expect(a).toEqual({ range: "today" });
  });

  it("with no language of their own, the person gets the business's, then English (mutation: skip the business's language -> FAILS)", async () => {
    setMemberships(member(A));
    h.users.set(ME, { name: "Ana", language: null });
    h.accounts.set(A, { timezone: "America/Chicago", language: "es", clerk_org_id: "org_A" });
    await call("needs_attention");
    expect(h.reads.needsAttention.mock.calls[0]![0]).toMatchObject({ locale: "es" });
    h.accounts.set(A, { timezone: "America/Chicago", language: null, clerk_org_id: "org_A" });
    await call("needs_attention");
    expect(h.reads.needsAttention.mock.calls[1]![0]).toMatchObject({ locale: "en" });
  });

  it("the result is the read's own JSON as one text block (mutation: wrap or reshape the result -> FAILS)", async () => {
    setMemberships(member(A));
    h.reads.lookupCustomer.mockResolvedValue({ ok: true, count: 0, matches: [] });
    expect((await call("lookup_customer", { term: "Nobody" })).text).toBe('{"ok":true,"count":0,"matches":[]}');
  });

  it("a switch read that throws is couldnt_read, nothing noted and nothing read (mutation: treat a failed switch read as on -> FAILS)", async () => {
    setMemberships(member(A));
    h.readSwitch.mockRejectedValue(new Error("readAiAppsSwitch failed: boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "couldnt_read" });
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
    expect(err.mock.calls.flat().join(" ")).not.toContain("boom");
  });

  it("a membership read that throws is couldnt_read, never no_business, nothing noted and nothing read (mutation: treat a failed membership read as none -> FAILS)", async () => {
    h.memberships.mockRejectedValue(new Error("listMyMemberships failed: boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("my_businesses")).out).toEqual({ ok: false, error: "couldnt_read" });
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "couldnt_read" });
    expect(h.note).not.toHaveBeenCalled();
    nothingRead();
  });

  it("a read that throws is couldnt_read, logged by class only, never its message (mutation: log the thrown error itself -> FAILS)", async () => {
    setMemberships(member(A));
    h.reads.appointments.mockRejectedValue(new TypeError("Maria López at +19565550177"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("appointments", { range: "today" })).out).toEqual({ ok: false, error: "couldnt_read" });
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("Maria");
    expect(logged).not.toContain("+1956");
  });

  it("an account whose timezone cannot be resolved is couldnt_read, never a read in some other zone (mutation: fall back to a default zone -> FAILS)", async () => {
    setMemberships(member(A));
    h.accounts.set(A, { timezone: "Not/AZone", language: null, clerk_org_id: "org_A" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("needs_attention")).out).toEqual({ ok: false, error: "couldnt_read" });
    nothingRead();
  });
});

describe("my_businesses", () => {
  it("lists name and id of each allowed business only, logging one ai_app_my_businesses item per business under one request id (mutation: list before filtering roles -> FAILS)", async () => {
    setMemberships(member(A), member(B, "technician"), member(C, "staff", "Biz 3"));
    const { out } = await call("my_businesses");
    expect(out).toEqual({ ok: true, businesses: [{ id: A, name: "Biz 1" }, { id: C, name: "Biz 3" }] });
    expect(h.note.mock.calls.map((c) => (c[1] as { accountId: string; kind: string }).accountId)).toEqual([A, C]);
    const ps = h.note.mock.calls.map((c) => c[1] as { kind: string; requestId: string });
    expect(ps.every((p) => p.kind === "ai_app_my_businesses")).toBe(true);
    expect(new Set(ps.map((p) => p.requestId)).size).toBe(1);
    nothingRead();
  });

  it("drops a business the database refuses, and is no_business when none is left (mutation: list a business whose write was refused -> FAILS)", async () => {
    setMemberships(member(A), member(C, "staff", "Biz 3"));
    h.note.mockImplementation(async (_db: unknown, p: { accountId: string }) =>
      (p.accountId === A ? { ok: false, reason: "not_allowed" } : { ok: true, visitId: "v" }));
    expect((await call("my_businesses")).out).toEqual({ ok: true, businesses: [{ id: C, name: "Biz 3" }] });
    h.note.mockResolvedValue({ ok: false, reason: "not_allowed" });
    expect((await call("my_businesses")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
  });

  it("is rate_limited when the database says so, and no_business with no allowed business (mutation: skip a rate-limited business instead of refusing -> FAILS)", async () => {
    setMemberships(member(A));
    h.note.mockResolvedValue({ ok: false, reason: "rate_limited" });
    expect((await call("my_businesses")).out).toEqual({ ok: false, error: "rate_limited", message: m["mcp.rateLimited"] });
    setMemberships(member(A, "technician"));
    h.note.mockClear();
    expect((await call("my_businesses")).out).toEqual({ ok: false, error: "no_business", message: m["mcp.noBusiness"] });
    expect(h.note).not.toHaveBeenCalled();
  });
});
