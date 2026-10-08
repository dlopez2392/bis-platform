import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
// Heartbeats are mocked out so the `after()` recorders below keep counting
// only this route's own work; their calls are asserted where they matter
// (lib/ops/stamp.ts).
const stampMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: (...a: unknown[]) => stampMock(...a) }));

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
const countCallerHistorySinceMock = vi.hoisted(() => vi.fn());
const startCallRowMock = vi.hoisted(() => vi.fn());
const getOrCreateCalendarMock = vi.hoisted(() => vi.fn());
const deleteCallRowMock = vi.hoisted(() => vi.fn());
const getTransferPhoneMock = vi.hoisted(() => vi.fn());
const listPhoneNumbersForAccountMock = vi.hoisted(() => vi.fn());
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

// Counts every `serviceDb()` construction, so a refusal can be shown to have
// done no database work at all — not merely to have skipped one lookup.
const serviceDbSpy = vi.hoisted(() => vi.fn());

vi.mock("@bis/db", () => ({
  serviceDb: () => (serviceDbSpy(), {
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
  countCallerHistorySince: (...a: unknown[]) => countCallerHistorySinceMock(...a),
  startCallRow: (...a: unknown[]) => startCallRowMock(...a),
  getOrCreateCalendar: (...a: unknown[]) => getOrCreateCalendarMock(...a),
  deleteCallRow: (...a: unknown[]) => deleteCallRowMock(...a),
  // The handoff target's two reads, resolved at step 12 before the accept.
  // A factory that omits a function the route calls is not a smaller mock,
  // it is a different route (see the same note in lifecycle.test.ts).
  getTransferPhone: (...a: unknown[]) => getTransferPhoneMock(...a),
  listPhoneNumbersForAccount: (...a: unknown[]) => listPhoneNumbersForAccountMock(...a),
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
  stampMock.mockReset();
  process.env.OPENAI_WEBHOOK_SECRET = "whsec_test";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.PHONE_MAX_CALLS_PER_NUMBER_PER_DAY;
  delete process.env.PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY;
  delete process.env.PHONE_SPAM_BLOCK_THRESHOLD;
  delete process.env.PHONE_SPAM_BLOCK_WINDOW_DAYS;
  // The transition default: no secret, not enforced — every pre-existing
  // test below runs the route exactly as it behaved before the signature.
  delete process.env.VOICE_HANDOFF_SECRET;
  delete process.env.VOICE_HANDOFF_ENFORCE;
  serviceDbSpy.mockReset();

  unwrapMock.mockReset();
  afterMock.mockReset();
  getPhoneNumberByE164Mock.mockReset().mockResolvedValue(PHONE_ROW);
  getVoiceProfileMock.mockReset().mockResolvedValue(PROFILE_ROW);
  countCallsSinceMock.mockReset().mockResolvedValue(1);
  countCallsByCallerSinceMock.mockReset().mockResolvedValue(1);
  // A caller with no history in the window — every test outside the
  // reputation block below is unaffected by Guard 2.
  countCallerHistorySinceMock.mockReset().mockResolvedValue({ spamCalls: 0, otherCalls: 0 });
  startCallRowMock.mockReset().mockResolvedValue({ id: "call-row-1" });
  getOrCreateCalendarMock.mockReset().mockResolvedValue(CALENDAR_ROW);
  deleteCallRowMock.mockReset().mockResolvedValue(undefined);
  getTransferPhoneMock.mockReset().mockResolvedValue(null);
  listPhoneNumbersForAccountMock.mockReset().mockResolvedValue([]);
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
    // The most exposed public URL in the set: a refused signature is a
    // stranger, never an outage, so anyone POSTing junk here must not be able
    // to send BIS an alert (mutation: stamp an error before the 400 → FAILS).
    expect(stampMock).not.toHaveBeenCalled();
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
    // A declined call writes NO `calls` row — step 8 returns before step 10.
    // Same reasoning as the reputation block below (see `caller-reputation.ts`,
    // "a refused call writes no `calls` row at all"), and it bites here too: a
    // row written on a refusal counts as a prior call tomorrow, and — because
    // `startCallRow` inserts no outcome and the column defaults to `abandoned`
    // — as a GOOD outcome forever after.
    expect(startCallRowMock).not.toHaveBeenCalled();
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

// Guard 2 at the layer that ENFORCES. The TeXML route speaks the refusal from
// the same `decideReputation` predicate; this one makes it binding, because
// OpenAI's SIP endpoint is reachable by anyone who knows the project id. A
// decline here is SILENT — 200, `acceptCall` never called, nothing billed.
describe("POST /api/voice/incoming — step 8: caller reputation", () => {
  // THE INVARIANT GUARD 2 IS BUILT ON, and the reason this assertion is not a
  // nicety: a refused call must write NO `calls` row at all. If `startCallRow`
  // ever ran before this gate, the refusal itself would clear the block —
  // `0019_voice_core.sql:53` defaults `outcome` to `abandoned`, `startCallRow`
  // inserts no outcome, and `countCallerHistorySince`'s "other" half is
  // `.neq("outcome","spam")`, so that row counts as a good outcome and
  // `decideReputation`'s `otherCalls > 0` clause clears the caller forever.
  // Guard 2 would then fire exactly once per number and never again, silently.
  // A reviewer moved `startCallRow` above the gates and got a fully green
  // suite; this line is what makes that mutation fail.
  it("step 8: a repeat silent caller is declined — never accepted, no lifecycle, NO call row", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, declined: "repeat-spam" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
    expect(startCallRowMock).not.toHaveBeenCalled();
  });

  it("step 8: the same caller WITH a good outcome is accepted — the two gates agree", async () => {
    // The identical history the TeXML test feeds its own gate. If these two
    // ever disagree, the shared predicate has been bypassed on one side. This
    // shape is real: in the live `calls` table one number is at once the top
    // spam caller (4) and the top booker (13).
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 4, otherCalls: 13 });
    const res = await POST(req());
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("step 8: the history read failing fails OPEN — the call is accepted", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallerHistorySinceMock.mockRejectedValue(new Error("boom"));
    const res = await POST(req());
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // WHY STEP 8 DECIDES INSIDE THE `try` AND ACTS AFTER IT. The flags are set
  // where each read lands, so a throw in a LATER read can never discard a
  // decline an EARLIER read already earned. The inviting "improvement" is the
  // `Promise.all` the TeXML route runs over these same three reads — but that
  // route only speaks words, and this one is the binding gate: batch the reads
  // and decide afterwards, and one rejected read fails the whole batch open,
  // silently taking the per-number abuse cap down with it at the authoritative
  // layer. `countCallerHistorySince` runs three counts over 30 days against the
  // cap's one same-day count, so it is the read most likely to time out alone.
  it("step 8: caps exceeded AND the history read throwing → still declined per-number", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallsByCallerSinceMock.mockResolvedValue(5);
    countCallerHistorySinceMock.mockRejectedValue(new Error("history read timed out"));
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "per-number" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(startCallRowMock).not.toHaveBeenCalled();
  });

  // THE MIRROR OF THE TEST ABOVE, AND THE DIRECTION THAT WAS MISSING. The two
  // reads sat in ONE `try`, with both cap counts awaited ahead of the
  // reputation read — so the protection ran one way only. A throw in a cap
  // read aborted the block before `countCallerHistorySince` was ever called,
  // and Guard 2 silently did not run for that call. Fail-open, so the
  // direction was safe, but it is the inverse of what the block's own comment
  // advertises, and it is the more valuable guard: the caps re-allow the same
  // robot tomorrow, a reputation block does not, and `countCallerHistorySince`
  // — three counts over 30 days against the cap's one same-day count — is the
  // read most likely to fail on its own, not least likely.
  //
  // Each read therefore gets its OWN try/catch. Neither can take the other
  // down, in either direction, and both keep the decide-inside / act-after
  // shape so a throw can never discard a decline already earned.
  it("step 8: a cap read throwing must still let Guard 2 block a repeat offender", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    // A DB blip on the caps — both same-day counts, the shape "counts THROWING
    // fails open" above already uses.
    countCallsSinceMock.mockRejectedValue(new Error("cap read timed out"));
    countCallsByCallerSinceMock.mockRejectedValue(new Error("cap read timed out"));
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const res = await POST(req());
    // The caps failed open, as they must. The reputation read still ran, and
    // its verdict still binds.
    expect(await res.json()).toEqual({ ok: true, declined: "repeat-spam" });
    expect(countCallerHistorySinceMock).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
    expect(startCallRowMock).not.toHaveBeenCalled();
  });

  // The account id is an ARGUMENT to the count, not an ambient fact: a read
  // that forgot it would score this caller on every tenant's history at once.
  it("step 8: the history is read for THIS account, THIS caller, over the rolling window", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(countCallerHistorySinceMock).toHaveBeenCalledWith(
      expect.anything(), "acct1", "+19562921696", expect.any(String),
    );
    const since = new Date(countCallerHistorySinceMock.mock.calls[0]![3] as string);
    const daysBack = (Date.now() - since.getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThan(29.9);
    expect(daysBack).toBeLessThan(30.1);
  });

  // BOTH KNOBS, EXERCISED RATHER THAN DELETED — the twin of the pair in
  // `texml/route.test.ts`. `beforeEach` only ever DELETED these two vars, so
  // replacing `readReputationConfig()` with a hardcoded
  // `{ threshold: 3, windowDays: 30 }` left both suites green: the knob was
  // unreachable by any test at either gate, and could have applied at one and
  // not the other. An operator relieving a false-positive block on a real
  // customer would have got no effect and no signal.
  it("step 8: the WINDOW knob reaches this gate — PHONE_SPAM_BLOCK_WINDOW_DAYS=7 reads 7 days back, not 30", async () => {
    process.env.PHONE_SPAM_BLOCK_WINDOW_DAYS = "7";
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    const since = new Date(countCallerHistorySinceMock.mock.calls[0]![3] as string);
    const daysBack = (Date.now() - since.getTime()) / 86_400_000;
    expect(daysBack).toBeGreaterThan(6.9);
    expect(daysBack).toBeLessThan(7.1);
  });

  // Also the threshold's only near-miss at route level: 4 silent calls against
  // a threshold of 5 must be accepted. `decideReputation` is non-strict
  // (`>=`), so an off-by-one here refuses a caller one call early.
  it("step 8: the THRESHOLD knob reaches this gate — PHONE_SPAM_BLOCK_THRESHOLD=5 accepts a caller with 4 silent calls", async () => {
    process.env.PHONE_SPAM_BLOCK_THRESHOLD = "5";
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 4, otherCalls: 0 });
    const res = await POST(req());
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // Withheld caller id: there is no caller to have a reputation, and passing
  // a null through to the count would score every anonymous caller on the
  // account as if they were one number.
  it("step 8: an anonymous caller is never scored — no history read, call accepted", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent({ callerNumber: null }));
    const res = await POST(req());
    const json = await res.json();
    expect(json.declined).toBeUndefined();
    expect(countCallerHistorySinceMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // The blocked verdict must beat the cap to the log line, matching the TeXML
  // route's own ordering — the two gates describe the same call the same way.
  it("step 8: a blocked caller who is ALSO over the cap is declined as repeat-spam", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallsByCallerSinceMock.mockResolvedValue(5);
    countCallerHistorySinceMock.mockResolvedValue({ spamCalls: 3, otherCalls: 0 });
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, declined: "repeat-spam" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The three counting seams above are `vi.mock`ed wholesale, so a `@bis/db`
// export that does not exist would be invisible here AND swallowed by the
// route's fail-open catch in production: Guard 2 would silently never fire.
// This one test resolves the REAL module through the same specifier the route
// imports, bypassing the mock.
describe("POST /api/voice/incoming — the counting seam exists for real", () => {
  it("countCallerHistorySince is genuinely exported by @bis/db and callable with the route's argument shape", async () => {
    const real = await vi.importActual<typeof import("@bis/db")>("@bis/db");
    expect(typeof real.countCallerHistorySince).toBe("function");

    // A chainable Supabase stub: every builder method returns the chain, and
    // awaiting it yields a count response. The three counts are told apart by
    // the query the real function actually builds rather than by call order:
    // OTHER calls `.neq`, ANSWERED calls `.in`, SPAM calls neither. Each gets
    // a distinct count, so a field wired to the wrong query fails here.
    const makeChain = () => {
      const seen: (string | symbol)[] = [];
      const chain: unknown = new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") {
            const count = seen.includes("neq") ? 0 : seen.includes("in") ? 5 : 2;
            return (resolve: (v: unknown) => void) => resolve({ count, error: null });
          }
          return (...args: unknown[]) => { seen.push(prop); void args; return chain; };
        },
      });
      return chain;
    };
    const stubDb = { from: () => makeChain() } as unknown as Parameters<typeof real.countCallerHistorySince>[0];

    await expect(
      real.countCallerHistorySince(stubDb, "acct1", "+19562921696", new Date().toISOString()),
    ).resolves.toEqual({ spamCalls: 2, otherCalls: 0, answeredCalls: 5 });
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

describe("the voice.sip_webhook heartbeat (operational-floor spec §1)", () => {
  it("an accepted call — Sofía answered — is the one ok stamp (mutation: drop it → the fallback's error never clears, FAILS)", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.sip_webhook", { ok: true });
  });

  it("a deliberate decline is not an outage: no stamp at all", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    countCallsByCallerSinceMock.mockResolvedValue(5);
    await POST(req());
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("OpenAI refusing the accept is an error stamp with the error's type only", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    fetchMock.mockRejectedValue(new Error("network down for +19565550111"));
    await POST(req());
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.sip_webhook", { ok: false, error: "OpenAI did not accept the call (Error)" });
  });

  it("missing configuration is Sofía's outage: an error stamp", async () => {
    delete process.env.OPENAI_API_KEY;
    await POST(req());
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.sip_webhook", { ok: false, error: "OPENAI_WEBHOOK_SECRET or OPENAI_API_KEY is not set" });
  });
});

// Did the call come through our TeXML answer route? OpenAI's signature (step
// 2) proves OpenAI sent the event; the numbers this route routes on arrive as
// SIP headers. The TeXML route signs what it resolved
// (lib/voice/sip-handoff-signature.ts) and, once enforcement is on, nothing
// here — no database client, no tenant lookup — runs before that checks out.
describe("POST /api/voice/incoming — the TeXML-route signature", () => {
  const SECRET = "k".repeat(48);
  const TOKEN = "c".repeat(32);
  const SIGNED_CALLED = "+19565550999"; // PHONE_ROW's number
  const SIGNED_CALLER = "+19562921696";

  async function signature(opts: { called?: string; caller?: string | null; token?: string; at?: number; secret?: string } = {}) {
    const { signSipHandoff } = await import("@/lib/voice/sip-handoff-signature");
    return signSipHandoff(
      opts.token ?? TOKEN, opts.called ?? SIGNED_CALLED,
      opts.caller === undefined ? SIGNED_CALLER : opts.caller, opts.at ?? Date.now(),
      { VOICE_HANDOFF_SECRET: opts.secret ?? SECRET } as unknown as NodeJS.ProcessEnv,
    )!;
  }

  /** What arrives from OpenAI: the carrier's From, our three X- headers. */
  function event(h: { from?: string; called?: string; token?: string | null; sig?: string | null }) {
    const sip_headers: { name: string; value: string }[] = [
      { name: "From", value: `sip:${h.from ?? SIGNED_CALLER}@sip.example.com` },
      { name: "X-BIS-Called", value: h.called ?? SIGNED_CALLED },
    ];
    if (h.token !== null) sip_headers.push({ name: "X-BIS-Handoff", value: h.token ?? TOKEN });
    if (h.sig) sip_headers.push({ name: "X-BIS-Signature", value: h.sig });
    return {
      id: "evt_sig", created_at: Math.floor(Date.now() / 1000),
      type: "realtime.call.incoming", data: { call_id: "call_sig", sip_headers },
    };
  }

  /** Nothing past the decline ran: no client, no lookup, no accept, no row. */
  function expectNoWork() {
    expect(serviceDbSpy).not.toHaveBeenCalled();
    expect(getPhoneNumberByE164Mock).not.toHaveBeenCalled();
    expect(getVoiceProfileMock).not.toHaveBeenCalled();
    expect(startCallRowMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  }

  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.VOICE_HANDOFF_SECRET = SECRET;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.VOICE_HANDOFF_SECRET;
    delete process.env.VOICE_HANDOFF_ENFORCE;
    logSpy.mockRestore();
  });

  describe("enforced (VOICE_HANDOFF_ENFORCE=1)", () => {
    beforeEach(() => { process.env.VOICE_HANDOFF_ENFORCE = "1"; });

    it("no signature header → declined before any database work (mutation: verify after the tenant lookup → FAILS)", async () => {
      unwrapMock.mockResolvedValue(event({ sig: null }));
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, declined: "unverified" });
      expectNoWork();
      // A stranger, never an outage: no alert for a call that is not ours.
      expect(stampMock).not.toHaveBeenCalled();
    });

    it("a signature made with another secret → declined, no database work", async () => {
      unwrapMock.mockResolvedValue(event({ sig: await signature({ secret: "z".repeat(48) }) }));
      expect(await (await POST(req())).json()).toEqual({ ok: true, declined: "unverified" });
      expectNoWork();
      expect(stampMock).not.toHaveBeenCalled();
    });

    it("an expired signature → declined, no database work", async () => {
      unwrapMock.mockResolvedValue(event({ sig: await signature({ at: Date.now() - 10 * 60_000 }) }));
      expect(await (await POST(req())).json()).toEqual({ ok: true, declined: "unverified" });
      expectNoWork();
    });

    it("a signature for another call's handoff token → declined, no database work", async () => {
      unwrapMock.mockResolvedValue(event({ token: "d".repeat(32), sig: await signature() }));
      expect(await (await POST(req())).json()).toEqual({ ok: true, declined: "unverified" });
      expectNoWork();
    });

    it("the decline log names the reason and never the header's value", async () => {
      const sig = await signature({ secret: "z".repeat(48) });
      unwrapMock.mockResolvedValue(event({ sig }));
      await POST(req());
      expect(logSpy).toHaveBeenCalledWith("[voice/incoming]", expect.stringContaining("declined: unverified"),
        expect.objectContaining({ reason: "bad-signature" }));
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(sig);
    });

    it("a valid signature is answered, routed on the SIGNED numbers — a different X-BIS-Called or From is ignored (mutation: route on the SIP headers → FAILS)", async () => {
      unwrapMock.mockResolvedValue(event({ called: "+19565550123", from: "+19565550777", sig: await signature() }));
      const res = await POST(req());
      expect(await res.json()).toEqual({ ok: true });
      expect(getPhoneNumberByE164Mock).toHaveBeenCalledExactlyOnceWith(expect.anything(), SIGNED_CALLED);
      expect(countCallsByCallerSinceMock).toHaveBeenCalledWith(expect.anything(), "acct1", SIGNED_CALLER, expect.any(String));
      expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
        expect.objectContaining({ callerE164: SIGNED_CALLER, handoffToken: TOKEN }));
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(afterMock).toHaveBeenCalledOnce();
    });

    it("a withheld caller stays withheld: a From on the SIP leg cannot supply one", async () => {
      unwrapMock.mockResolvedValue(event({ from: "+19565550777", sig: await signature({ caller: null }) }));
      await POST(req());
      expect(countCallsByCallerSinceMock).not.toHaveBeenCalled();
      expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
        expect.objectContaining({ callerE164: null }));
    });

    it("enforced with no secret fails CLOSED, and that is an outage worth an alert — with or without a header (the TeXML route sends none without the secret)", async () => {
      const sig = await signature();
      delete process.env.VOICE_HANDOFF_SECRET;
      for (const h of [{ sig }, { sig: null }]) {
        stampMock.mockReset();
        unwrapMock.mockResolvedValue(event(h));
        expect(await (await POST(req())).json()).toEqual({ ok: true, declined: "unverified" });
        expectNoWork();
        expect(stampMock).toHaveBeenCalledExactlyOnceWith("voice.sip_webhook",
          { ok: false, error: "VOICE_HANDOFF_ENFORCE is on but VOICE_HANDOFF_SECRET is not set" });
      }
    });

    it("a non-call event is still ignored, never declined", async () => {
      unwrapMock.mockResolvedValue(nonCallEvent());
      expect(await (await POST(req())).json()).toEqual({ ok: true });
      expect(serviceDbSpy).not.toHaveBeenCalled();
    });
  });

  describe("not enforced (the rollout's transition)", () => {
    it("no secret: answered exactly as before, with a loud line saying nothing was verified", async () => {
      delete process.env.VOICE_HANDOFF_SECRET;
      unwrapMock.mockResolvedValue(event({ sig: null }));
      expect(await (await POST(req())).json()).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith("[voice/incoming]",
        expect.stringContaining("VOICE_HANDOFF_SECRET is not set"), expect.objectContaining({ callId: "call_sig" }));
    });

    it("an invalid signature is reported, not refused (mutation: enforce by default → FAILS)", async () => {
      unwrapMock.mockResolvedValue(event({ sig: await signature({ secret: "z".repeat(48) }) }));
      expect(await (await POST(req())).json()).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(logSpy).toHaveBeenCalledWith("[voice/incoming]", expect.stringContaining("not enforced"),
        expect.objectContaining({ result: "bad-signature" }));
    });

    it("a valid signature is reported with whether the SIP headers agree, and routing stays on the SIP headers until enforcement", async () => {
      unwrapMock.mockResolvedValue(event({ from: "+19565550777", sig: await signature() }));
      await POST(req());
      expect(logSpy).toHaveBeenCalledWith("[voice/incoming]", expect.stringContaining("not enforced"),
        expect.objectContaining({ result: "ok", calledMatches: true, callerMatches: false }));
      expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
        expect.objectContaining({ callerE164: "+19565550777" }));
    });
  });
});

