import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// --- openai: fully mocked here (the un-mocked signing test lives in its own
// file, webhook-signing.test.ts, so it never fights this mock). ------------
const unwrapMock = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    webhooks = { unwrap: (...a: unknown[]) => unwrapMock(...a) };
  },
}));

// --- ws: never actually opened in this suite (after() below is a recorder,
// never invoked), but mocked anyway so nothing here can reach a real socket. -
vi.mock("ws", () => ({
  default: class MockWebSocket {
    on() { return this; }
    send() {}
    close() {}
  },
}));

// --- next/server: real NextResponse (matches the texml route precedent),
// `after` replaced with a pass-through recorder — calling the real one
// outside a request scope throws, and none of these tests need the
// call-scoped lifecycle it schedules to actually run. ----------------------
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

// --- @bis/db ----------------------------------------------------------------
const getPhoneNumberByE164Mock = vi.hoisted(() => vi.fn());
const getVoiceProfileMock = vi.hoisted(() => vi.fn());
const countCallsSinceMock = vi.hoisted(() => vi.fn());
const countCallsByCallerSinceMock = vi.hoisted(() => vi.fn());
const startCallRowMock = vi.hoisted(() => vi.fn());
const getOrCreateCalendarMock = vi.hoisted(() => vi.fn());
const deleteCallRowMock = vi.hoisted(() => vi.fn());
// Records the route's own inline `accounts` select so a test can assert the
// query actually hit `accounts` filtered by the resolved account id, not
// just that SOME `.select().eq().single()` chain was called — a mock that
// ignored its own arguments would pass under a query aimed at any table.
const dbQuerySpy = vi.hoisted(() => ({ fromCalls: [] as string[], eqCalls: [] as [string, unknown][] }));

/** The account row behind the route's own inline `accounts` select. Every
 *  column below is distinctive so an assertion on it only passes if the
 *  code's own `.select(...)` list actually requested that column — the same
 *  projection trick `b/[publicId]/actions.test.ts` uses for its `accountRow`. */
const accountRow = {
  // The agency's INTERNAL label, deliberately different from `brand_name` and
  // deliberately carrying the "— trial" suffix such labels carry: the prompt
  // test below can only pass if the route never reads this column. The route
  // no longer even selects it, so the projection filter drops it.
  name: "Rio Roofing — trial", timezone: "America/Chicago",
  brand_name: "Rio Roofing Co", brand_logo_path: "logos/rio.png", brand_color: "#1a2b3c",
  brand_neutral: "warm" as const, brand_corners: "soft" as const, brand_type: "inter" as const,
  brand_mode: "light" as const, reply_to_email: "owner-reply@rio.example", from_email: "hello@rio.example",
};

vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      dbQuerySpy.fromCalls.push(table);
      return {
        select: (cols: string) => ({
          eq: (col: string, val: unknown) => {
            dbQuerySpy.eqCalls.push([col, val]);
            return {
              single: async () => {
                const wanted = cols.split(",").map((c) => c.trim());
                return {
                  data: Object.fromEntries(Object.entries(accountRow).filter(([key]) => wanted.includes(key))),
                  error: null,
                };
              },
            };
          },
        }),
      };
    },
  }),
  getPhoneNumberByE164: (...a: unknown[]) => getPhoneNumberByE164Mock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  countCallsSince: (...a: unknown[]) => countCallsSinceMock(...a),
  countCallsByCallerSince: (...a: unknown[]) => countCallsByCallerSinceMock(...a),
  startCallRow: (...a: unknown[]) => startCallRowMock(...a),
  getOrCreateCalendar: (...a: unknown[]) => getOrCreateCalendarMock(...a),
  deleteCallRow: (...a: unknown[]) => deleteCallRowMock(...a),
}));

import { POST } from "./route";

const PHONE_ROW = { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "live" as const };
const PROFILE_ROW = {
  id: "vp1", account_id: "acct1", persona_name: "Sofía",
  greeting_en: "Hi, thanks for calling Rio Roofing.", greeting_es: "Hola, gracias por llamar.",
  facts: "-", services: "-", languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
};
const CALENDAR_ROW = {
  id: "cal1", account_id: "acct1", public_id: "cal_pub1", enabled: true,
  slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 14,
  open_hours: {}, notify_emails: ["staff@rio.example"],
};

function callIncomingEvent(opts: { callId?: string; callerNumber?: string | null; calledNumber?: string | null } = {}) {
  const callId = opts.callId ?? "call_abc123";
  const callerNumber = opts.callerNumber === undefined ? "+19562921696" : opts.callerNumber;
  const calledNumber = opts.calledNumber === undefined ? "+19565550999" : opts.calledNumber;
  const sip_headers: { name: string; value: string }[] = [];
  if (callerNumber) sip_headers.push({ name: "From", value: `sip:${callerNumber}@sip.example.com` });
  if (calledNumber) sip_headers.push({ name: "X-BIS-Called", value: calledNumber });
  return {
    id: "evt_1", created_at: Math.floor(Date.now() / 1000),
    type: "realtime.call.incoming", data: { call_id: callId, sip_headers },
  };
}

function nonCallEvent() {
  return { id: "evt_2", created_at: Math.floor(Date.now() / 1000), type: "response.completed", data: { id: "resp_1" } };
}

function req(): NextRequest {
  return new Request("https://x.example/api/voice/incoming", {
    method: "POST",
    headers: { "webhook-id": "id", "webhook-timestamp": "1", "webhook-signature": "v1,irrelevant" },
    body: "raw-body-not-inspected-because-unwrap-is-mocked",
  }) as unknown as NextRequest;
}

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  process.env.OPENAI_WEBHOOK_SECRET = "whsec_test";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.PHONE_MAX_CALLS_PER_NUMBER_PER_DAY;
  delete process.env.PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY;

  unwrapMock.mockReset();
  afterMock.mockReset();
  getPhoneNumberByE164Mock.mockReset().mockResolvedValue(PHONE_ROW);
  getVoiceProfileMock.mockReset().mockResolvedValue(PROFILE_ROW);
  countCallsSinceMock.mockReset().mockResolvedValue(1);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(1);
  startCallRowMock.mockReset().mockResolvedValue({ id: "call-row-1" });
  getOrCreateCalendarMock.mockReset().mockResolvedValue(CALENDAR_ROW);
  deleteCallRowMock.mockReset().mockResolvedValue(undefined);
  dbQuerySpy.fromCalls.length = 0;
  dbQuerySpy.eqCalls.length = 0;

  fetchMock.mockReset().mockResolvedValue({ ok: true, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/voice/incoming — step 1: server config", () => {
  it("missing OPENAI_WEBHOOK_SECRET → 500, zero queries, unwrap never called", async () => {
    delete process.env.OPENAI_WEBHOOK_SECRET;
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server not configured" });
    expect(unwrapMock).not.toHaveBeenCalled();
    expect(getPhoneNumberByE164Mock).not.toHaveBeenCalled();
  });

  it("missing OPENAI_API_KEY → 500, zero queries, unwrap never called", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(req());
    expect(res.status).toBe(500);
    expect(unwrapMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/voice/incoming — step 2: signature verification", () => {
  it("a signature the SDK rejects → 400 invalid signature", async () => {
    unwrapMock.mockRejectedValue(new Error("bad signature"));
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid signature" });
  });
});

describe("POST /api/voice/incoming — step 3: non-call events", () => {
  it("a correctly-signed non-call event → 200 ok:true, no db calls", async () => {
    unwrapMock.mockResolvedValue(nonCallEvent());
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(getPhoneNumberByE164Mock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/voice/incoming — step 5: unroutable", () => {
  it("no called number on the SIP headers → 200 declined:unroutable, no db calls", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent({ calledNumber: null }));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, declined: "unroutable" });
    expect(getPhoneNumberByE164Mock).not.toHaveBeenCalled();
  });
});

describe("POST /api/voice/incoming — step 6: number resolution", () => {
  it("no matching phone number row → 200 declined:unknown-number", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getPhoneNumberByE164Mock.mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, declined: "unknown-number" });
    expect(getVoiceProfileMock).not.toHaveBeenCalled();
  });

  it("a released (not testing/live) number → 200 declined:unknown-number", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getPhoneNumberByE164Mock.mockResolvedValue({ ...PHONE_ROW, status: "released" });
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "unknown-number" });
  });
});

describe("POST /api/voice/incoming — step 7: voice profile", () => {
  it("no voice profile row → 200 declined:disabled", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getVoiceProfileMock.mockResolvedValue(null);
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "disabled" });
    expect(countCallsSinceMock).not.toHaveBeenCalled();
  });

  it("profile.enabled === false → 200 declined:disabled", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, enabled: false });
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "disabled" });
  });

  it("status testing + profile.enabled === false → still reaches accept (testing answers regardless of the toggle)", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getPhoneNumberByE164Mock.mockResolvedValue({ ...PHONE_ROW, status: "testing" });
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, enabled: false });
    const res = await POST(req());
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(afterMock).toHaveBeenCalledOnce();
  });

  it("status live + profile.enabled === false → still declined:disabled (live keeps requiring the toggle)", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    getPhoneNumberByE164Mock.mockResolvedValue({ ...PHONE_ROW, status: "live" });
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, enabled: false });
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/voice/incoming — step 8: call caps", () => {
  it("5 prior calls for this number today (default cap 5) → declined per-number", async () => {
    // Counts are PRIOR-call counts (call-limits.ts's `decideLimit` doc
    // comment): the caps read happens before `startCallRow` ever writes a
    // row for THIS call, so 5 priors is the 6th call of the day, which is
    // the one that should be declined — 6 here would have been off by one.
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallsByCallerSinceMock.mockResolvedValue(5);
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "per-number" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("counts THROWING fails open — the call proceeds through to accept", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallsSinceMock.mockRejectedValue(new Error("db down"));
    countCallsByCallerSinceMock.mockRejectedValue(new Error("db down"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(afterMock).toHaveBeenCalledOnce();
  });
});

describe("POST /api/voice/incoming — happy path", () => {
  it("accepts with a FLAT session body, schedules the lifecycle via after(), and acks 200", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent({ callId: "call_xyz" }));
    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/realtime/calls/call_xyz/accept");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-test");

    const body = JSON.parse(init.body);
    expect(body.session).toBeUndefined(); // FLAT — nesting under `session` is a silent 4xx
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    expect(typeof body.instructions).toBe("string");

    expect(afterMock).toHaveBeenCalledOnce();
    expect(typeof afterMock.mock.calls[0]![0]).toBe("function");
  });

  it("URL-encodes the call id in the accept endpoint", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent({ callId: "call/with special?chars" }));
    await POST(req());
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(encodeURIComponent("call/with special?chars"));
  });

  // Important #4 ②: wiring shapes — asserted here rather than re-deriving
  // them from mock internals, so a future refactor that silently drops an
  // argument (e.g. forgetting the "voice"/"ai" actor pair on the calendar
  // lookup) fails a test instead of only showing up as a wrong-actor row in
  // production. `expect.anything()` stands in for the `db` positional arg —
  // asserting its literal shape would just be re-testing this file's own
  // `serviceDb()` mock, not the route's behavior.
  it("startCallRow and getOrCreateCalendar are called with the documented shapes", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(startCallRowMock).toHaveBeenCalledWith(
      expect.anything(), "acct1", { phoneNumberId: "pn1", callerE164: "+19562921696" },
    );
    expect(getOrCreateCalendarMock).toHaveBeenCalledWith(expect.anything(), "acct1", "voice", "ai");
  });
});

// Minor: the route's own inline `accounts` select (there is no `@bis/db`
// accessor for it — see the file header's ACCOUNT_COLS comment) is trivial
// to assert nothing about if the mock ignores its own call arguments. This
// tightens the mock (see the `dbQuerySpy` definition above) so the test can
// require the query to have actually hit `accounts` filtered by `id`.
describe("POST /api/voice/incoming — accounts query", () => {
  it("selects from accounts filtered by the resolved account id", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(dbQuerySpy.fromCalls).toContain("accounts");
    expect(dbQuerySpy.eqCalls).toContainEqual(["id", "acct1"]);
  });

  /**
   * Sofía said the agency's private note about the client out loud, on every
   * call: `businessName` and the fallback greeting both read `accounts.name`
   * ("Rio Roofing — trial"), the same column M4d took off the email From
   * line. The prompt names the business half a dozen times (system-prompt.ts),
   * so this was the loudest surface the label ever reached.
   *
   * Mutation: `businessName: accountRow.name` in the route (or re-add `name`
   * to ACCOUNT_COLS and read it) — the scan below finds "trial".
   */
  it("builds the prompt from the BRAND name, never the agency's internal accounts.name label", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    const [, init] = fetchMock.mock.calls[0]!;
    const sent = String(init.body);
    expect(sent).toContain(accountRow.brand_name);
    // The whole accept body, not just `instructions`: the label must not have
    // reached any field. Lower-cased because the prompt upper-cases the name
    // in one line ("WHAT YOU KNOW ABOUT …").
    expect(sent.toLowerCase()).not.toContain("trial");
  });
});

describe("POST /api/voice/incoming — step 11: accept failure", () => {
  it("accept fetch resolving non-ok → still 200, no lifecycle scheduled", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("accept fetch throwing outright → still 200, no lifecycle scheduled", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(afterMock).not.toHaveBeenCalled();
  });

  // Important #2: an unaccepted call must not litter the dashboard or count
  // against the tenant's daily caps — both `countCallsSince` (this route)
  // and the dashboard's own call list have no other filter for "was this
  // ever actually answered".
  it("accept failure with a call row already open → deletes that row", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1", "call-row-1");
  });

  it("accept failure with NO call row (startCallRow itself had failed) → cleanup skipped, not called with null", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    startCallRowMock.mockRejectedValue(new Error("db down"));
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(deleteCallRowMock).not.toHaveBeenCalled();
  });

  it("cleanup delete itself throwing → still 200 ack, never surfaces as a 5xx", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    deleteCallRowMock.mockRejectedValue(new Error("row already gone"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
