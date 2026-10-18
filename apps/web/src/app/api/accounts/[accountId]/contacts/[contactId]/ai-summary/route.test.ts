import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The record summary route's wiring (item 8a-2, spec 4.2): the order of the proof, which client each
 * dependency gets, and what the route hands the service. The decisions themselves are
 * ai-summary-service.ts's, pinned in its own test.
 */
const A = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const REQUEST = { tag: "request", from: vi.fn() };
const SERVICE = { tag: "service" };
const fx = {
  access: { userId: "u1", isAgency: false } as { userId: string; isAgency: boolean } | null,
  contact: { id: C, first_name: "Ana", last_name: null, language: null, created_at: "2025-12-02T18:00:00Z", source: null } as Record<string, unknown> | null,
  prefsLanguage: null as "en" | "es" | null,
  accountLanguage: null as "en" | "es" | null,
  something: true,
  order: [] as string[],
};
type AnyArgs<R> = (...a: unknown[]) => Promise<R>;
const serveMock = vi.fn<AnyArgs<{ state: string }>>(async () => ({ state: "none" }));
const buildMock = vi.fn<AnyArgs<{ __inputs: boolean }>>(async () => ({ __inputs: true }));
const getContactMock = vi.fn<AnyArgs<Record<string, unknown> | null>>(async (db) => { fx.order.push(`getContact ${(db as { tag: string }).tag}`); return fx.contact; });
const serviceDbMock = vi.fn(() => { fx.order.push("serviceDb"); return SERVICE; });
const aiGateCheckMock = vi.fn<AnyArgs<object>>(async () => ({}));
const getRecordSummaryMock = vi.fn<AnyArgs<null>>(async () => null);
const claimMock = vi.fn<AnyArgs<{ status: string }>>(async () => ({ status: "busy" }));
const aiCompleteMock = vi.fn<AnyArgs<{ ok: boolean; reason: string }>>(async () => ({ ok: false, reason: "no_key" }));

vi.mock("@/lib/auth", () => ({ apiAccountAccess: async () => fx.access }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: fx.prefsLanguage, theme: null }) }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "America/Chicago", guessed: false, label: "x", source: "account" }) }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bis/db")>()),
  getContact: getContactMock, serviceDb: serviceDbMock, aiGateCheck: aiGateCheckMock, getRecordSummary: getRecordSummaryMock,
  claimRecordSummary: claimMock,
}));
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai/gateway")>()), aiComplete: aiCompleteMock }));
vi.mock("@/lib/record/ai-summary-inputs", () => ({ buildSummaryInputs: buildMock, hasSomethingToSay: () => fx.something }));
vi.mock("@/lib/record/ai-summary-service", () => ({ serveRecordSummary: serveMock }));

const { GET, POST } = await import("./route");
const call = (fn: typeof GET, accountId = A, contactId = C, q = "") =>
  fn(new Request(`http://x/api/accounts/${accountId}/contacts/${contactId}/ai-summary${q}`), { params: Promise.resolve({ accountId, contactId }) });

beforeEach(() => {
  fx.access = { userId: "u1", isAgency: false };
  fx.contact = { id: C, first_name: "Ana", last_name: null, language: null, created_at: "2025-12-02T18:00:00Z", source: null };
  fx.prefsLanguage = null; fx.accountLanguage = null; fx.something = true; fx.order = [];
  vi.clearAllMocks();
  REQUEST.from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/Chicago", language: fx.accountLanguage }, error: null }) }) }) }));
});

describe("the AI summary route (spec 4.2)", () => {
  it("no access, a non-uuid id, or a customer the request client cannot read: 404 and no service client, no generation (mutations: build serviceDb before getContact -> FAILS; drop the isUuid guard -> FAILS)", async () => {
    fx.access = null;
    expect((await call(GET)).status).toBe(404);
    fx.access = { userId: "u1", isAgency: false };
    expect((await call(GET, A, "not-a-uuid")).status).toBe(404);
    fx.access = { userId: "u1", isAgency: true }; // an agency session passes apiAccountAccess for any account string (plan fix M5)
    expect((await call(GET, "not-a-uuid", C)).status).toBe(404);
    fx.access = { userId: "u1", isAgency: false };
    fx.contact = null;
    expect((await call(GET)).status).toBe(404);
    expect(serviceDbMock).not.toHaveBeenCalled();
    expect(serveMock).not.toHaveBeenCalled();
    expect(getContactMock).toHaveBeenCalledTimes(1);
    expect(getContactMock).toHaveBeenCalledWith(REQUEST, A, C);
  });

  it("a customer the request client does not answer for this account is a 404, and the account in the URL is the one asked (plan fix M6: the account fence itself is getContact on the REQUEST client, asserted with toHaveBeenCalledWith(REQUEST, A, C) in the first case; mutation: call getContact with a hard-coded account -> FAILS)", async () => {
    const B = "44444444-4444-4444-8444-444444444444";
    getContactMock.mockImplementationOnce(async () => null);
    expect((await call(GET, B, C)).status).toBe(404);
    expect(getContactMock).toHaveBeenCalledWith(REQUEST, B, C);
    expect(serviceDbMock).not.toHaveBeenCalled();
    expect(serveMock).not.toHaveBeenCalled();
  });

  it("nothing to say: none, and no service client at all (spec 4.3; mutation: build serviceDb before the check -> FAILS)", async () => {
    fx.something = false;
    expect(await (await call(GET)).json()).toEqual({ state: "none" });
    expect(serviceDbMock).not.toHaveBeenCalled();
    expect(serveMock).not.toHaveBeenCalled();
  });

  it("GET is not forced, POST is (spec 4.2; mutation: force: false in POST -> FAILS)", async () => {
    await call(GET);
    expect(serveMock.mock.calls[0]![1]).toMatchObject({ force: false, language: "en" });
    await call(POST);
    expect(serveMock.mock.calls[1]![1]).toMatchObject({ force: true });
  });

  it("the cache language is the reader's: a Spanish reader, a Spanish client account, an operator on that account (G9; mutation: pass the account's language for an operator -> FAILS)", async () => {
    fx.prefsLanguage = "es";
    await call(GET);
    expect(serveMock.mock.calls.at(-1)![1]).toMatchObject({ language: "es" });
    fx.prefsLanguage = null; fx.accountLanguage = "es";
    await call(GET);
    expect(serveMock.mock.calls.at(-1)![1]).toMatchObject({ language: "es" });
    fx.access = { userId: "u1", isAgency: true };
    await call(GET);
    expect(serveMock.mock.calls.at(-1)![1]).toMatchObject({ language: "en" });
  });

  it("the cache is read on the REQUEST client; the gate, the claim and the completion on the SERVICE client, as record_summary (mutations: getRecordSummary(svc, …) -> FAILS; feature 'call_summary' -> FAILS)", async () => {
    await call(GET);
    expect(buildMock).toHaveBeenCalledWith(REQUEST, expect.objectContaining({ accountId: A, contact: fx.contact, zone: "America/Chicago" }));
    const deps = serveMock.mock.calls[0]![0] as { cached(): Promise<unknown>; gate(): Promise<unknown>; claim(d: string, f: boolean): Promise<unknown>; complete(m: unknown[]): Promise<unknown> };
    await deps.cached(); await deps.gate(); await deps.claim("a".repeat(64), false); await deps.complete([]);
    expect(getRecordSummaryMock).toHaveBeenCalledWith(REQUEST, { accountId: A, contactId: C, language: "en" });
    expect(aiGateCheckMock.mock.calls[0]![0]).toBe(SERVICE);
    expect(aiGateCheckMock.mock.calls[0]![1]).toMatchObject({ accountId: A, monthKey: expect.stringMatching(/^\d{4}-\d{2}$/), dayKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(claimMock).toHaveBeenCalledWith(SERVICE, { accountId: A, contactId: C, language: "en", digest: "a".repeat(64), force: false });
    expect(aiCompleteMock.mock.calls[0]![0]).toBe(SERVICE);
    expect(aiCompleteMock.mock.calls[0]![1]).toMatchObject({ accountId: A, feature: "record_summary", model: "gpt-4o-mini", maxTokens: 400, timeoutMs: 10_000, timezone: "America/Chicago", language: "en", ref: `contact ${C}` });
    expect(fx.order.indexOf("getContact request")).toBeGreaterThanOrEqual(0);
    expect(fx.order.indexOf("getContact request")).toBeLessThan(fx.order.indexOf("serviceDb"));
  });

  it("the cap's day and the budget's month are the ACCOUNT's, not UTC's: at 22:30 in Chicago on Oct 31 (03:30 UTC Nov 1) the gate is asked for 2026-10 / 2026-10-31 (orchestrator note 1; mutation: periodKeys(now, \"UTC\") -> FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-01T03:30:00Z"));
      await call(GET);
      const deps = serveMock.mock.calls[0]![0] as { gate(): Promise<unknown> };
      await deps.gate();
      expect(aiGateCheckMock.mock.calls[0]![1]).toMatchObject({ accountId: A, monthKey: "2026-10", dayKey: "2026-10-31" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("an account in a zone that is neither UTC nor the fallback: at 12:00 UTC Oct 31 Auckland is already Nov 1, and both the gate and the completion are asked in Auckland (review M2; mutations: hard-code \"America/Chicago\" in the gate's periodKeys -> FAILS; hard-code it as aiComplete's timezone -> FAILS)", async () => {
    REQUEST.from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "Pacific/Auckland", language: null }, error: null }) }) }) }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T12:00:00Z")); // Chicago: 2026-10-31 07:00; UTC: 2026-10-31; Auckland (NZDT): 2026-11-01 01:00
      await call(GET);
      const deps = serveMock.mock.calls[0]![0] as { gate(): Promise<unknown>; complete(m: unknown[]): Promise<unknown> };
      await deps.gate(); await deps.complete([]);
      expect(aiGateCheckMock.mock.calls[0]![1]).toMatchObject({ accountId: A, monthKey: "2026-11", dayKey: "2026-11-01" });
      expect(aiCompleteMock.mock.calls[0]![1]).toMatchObject({ timezone: "Pacific/Auckland" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("an AGENCY reader whose customer the request client does not return is still a 404: for an agency session getContact is the only fence (review M1; mutation: `if (!contact && !access.isAgency)` -> FAILS)", async () => {
    fx.access = { userId: "u1", isAgency: true };
    fx.contact = null;
    expect((await call(GET)).status).toBe(404);
    expect((await call(POST)).status).toBe(404);
    expect(getContactMock).toHaveBeenCalledWith(REQUEST, A, C);
    expect(serviceDbMock).not.toHaveBeenCalled();
    expect(serveMock).not.toHaveBeenCalled();
  });

  it("with BIS_I18N_QA on, ?locale=es makes the cache language es and ?locale=pseudo leaves it en, never a third language (review M3; mutations: drop the locale param from requestLocale -> FAILS; key the cache on the raw param -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      await call(GET, A, C, "?locale=es");
      expect(serveMock.mock.calls.at(-1)![1]).toMatchObject({ language: "es" });
      let deps = serveMock.mock.calls.at(-1)![0] as { cached(): Promise<unknown> };
      await deps.cached();
      expect(getRecordSummaryMock).toHaveBeenLastCalledWith(REQUEST, { accountId: A, contactId: C, language: "es" });

      await call(GET, A, C, "?locale=pseudo");
      expect(serveMock.mock.calls.at(-1)![1]).toMatchObject({ language: "en" });
      deps = serveMock.mock.calls.at(-1)![0] as { cached(): Promise<unknown> };
      await deps.cached();
      expect(getRecordSummaryMock).toHaveBeenLastCalledWith(REQUEST, { accountId: A, contactId: C, language: "en" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("an unusable stored zone still asks the gate for a real day, the gateway's own fallback zone (orchestrator note 1: safeZone, as aiComplete does; mutation: drop safeZone -> periodKeys throws -> FAILS)", async () => {
    REQUEST.from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "Not/AZone", language: null }, error: null }) }) }) }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-01T03:30:00Z"));
      await call(GET);
      const deps = serveMock.mock.calls[0]![0] as { gate(): Promise<unknown> };
      await deps.gate();
      expect(aiGateCheckMock.mock.calls[0]![1]).toMatchObject({ monthKey: "2026-10", dayKey: "2026-10-31" }); // America/Chicago, billing-view's FALLBACK_ZONE
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed inputs read answers failed with 200, never a 500 (plan deviation 16; mutation: let it throw -> FAILS)", async () => {
    buildMock.mockRejectedValueOnce(new Error("tasks read failed"));
    const res = await call(GET);
    expect([res.status, await res.json()]).toEqual([200, { state: "failed" }]);
    expect(serveMock).not.toHaveBeenCalled();
  });

  it("a failed contact read answers failed with 200, and no service client (plan deviation 16)", async () => {
    getContactMock.mockRejectedValueOnce(new Error("contacts read failed"));
    const res = await call(GET);
    expect([res.status, await res.json()]).toEqual([200, { state: "failed" }]);
    expect(serviceDbMock).not.toHaveBeenCalled();
  });
});
