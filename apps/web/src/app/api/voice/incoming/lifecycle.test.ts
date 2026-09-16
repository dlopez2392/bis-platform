// Coverage for `runCallLifecycle` — the call-scoped WS loop inside
// `route.ts`. It has no exported symbol of its own (deliberately: it is
// wired up entirely through `after(() => runCallLifecycle(...))`), so these
// tests drive it exactly the way production does: POST the webhook, capture
// the callback `after()` was given, and invoke that callback ourselves to
// start the lifecycle against a fake, fully-controllable `ws` socket.
//
// route.test.ts owns the request-handling surface (steps 1–13, accept
// success/failure, caps, accounts query). This file owns everything that
// only happens AFTER a successful accept: the WS message race (Critical #1),
// the connect timeout and cap-seconds clamp (Important #5), the greeting
// timer's actual payload (Important #4 ①), and the WS URL's call-id encoding
// (the Minors list).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import type { CallState, MirroredBooking } from "@/lib/voice/call-state";
import type { TranscriptEvent } from "@bis/db";

// --- ws: a minimal hand-rolled emitter standing in for the socket, so tests
// can fire open/message/close/error exactly like the real `ws` package
// would, and assert on `send`/`close`/`terminate` calls. `vi.hoisted`
// because `vi.mock` factories are hoisted above all other module-level code
// (same reasoning as `actions.test.ts`'s `MockSlotTakenError`) — a plain
// `class` declared below the `vi.mock` call would be a TDZ error the moment
// the factory runs. This does NOT use node's own `EventEmitter`: an
// `import { EventEmitter } from "node:events"` binding is itself hoisted
// BELOW `vi.hoisted`'s callback by the same transform, so referencing it in
// here would trip the identical TDZ error one layer down — a plain
// listener-array emitter sidesteps needing any import at all.
const { FakeWebSocket, fakeSockets } = vi.hoisted(() => {
  class MiniEmitter {
    private listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    on(event: string, fn: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(fn);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners[event] ?? []) fn(...args);
      return true;
    }
  }
  class FakeWebSocket extends MiniEmitter {
    url: string;
    opts: unknown;
    send = () => {};
    close = () => {};
    terminate = () => {};
    constructor(url: string, opts: unknown) {
      super();
      this.url = url;
      this.opts = opts;
    }
  }
  return { FakeWebSocket, fakeSockets: { instances: [] as InstanceType<typeof FakeWebSocket>[] } };
});
vi.mock("ws", () => ({
  default: class extends FakeWebSocket {
    constructor(url: string, opts: unknown) {
      super(url, opts);
      fakeSockets.instances.push(this);
    }
  },
}));

// --- openai: fully mocked, same as route.test.ts. --------------------------
const unwrapMock = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class {
    webhooks = { unwrap: (...a: unknown[]) => unwrapMock(...a) };
  },
}));

// --- next/server: `after` becomes a recorder we invoke ourselves. ----------
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

// --- @/lib/voice/finish-call: mocked so the lifecycle's terminal call is a
// spy, and its `state` argument is inspectable — the whole point of the
// Critical #1 race test. -----------------------------------------------
const finishCallMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voice/finish-call", () => ({ finishCall: (...a: unknown[]) => finishCallMock(...a) }));

// --- @/lib/voice/tools/registry: `runTool` mocked so one test can make a
// function-call event's processing arbitrarily slow (a controllable
// deferred promise) without a real tool doing real DB/email work. ----------
const runToolMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voice/tools/registry", () => ({ runTool: (...a: unknown[]) => runToolMock(...a) }));

// --- @/lib/voice/silence-guard: the REAL module, with `isCallerAudioEvent`
// routed through a spy that defaults to the real implementation. Only one
// test changes that default, and it changes it to THROW: the cancel block in
// `handleMessage` reads untrusted socket fields, Tasks 3–6 add more
// predicates that read more of them, and a throw from any of them must be
// caught by that function's own try/catch rather than escaping into the frame
// serialization chain. Nothing else in the file is affected — `readSilentSeconds`
// and `silenceGoodbye` are the genuine exports, spread through. ------------
const isCallerAudioEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/voice/silence-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/voice/silence-guard")>();
  return { ...actual, isCallerAudioEvent: (t: string | undefined) => isCallerAudioEventMock(t) };
});
const { isCallerAudioEvent: realIsCallerAudioEvent } =
  await vi.importActual<typeof import("@/lib/voice/silence-guard")>("@/lib/voice/silence-guard");

// --- @bis/db: minimal — just enough to reach a successful accept. ----------
const getPhoneNumberByE164Mock = vi.hoisted(() => vi.fn());
const getVoiceProfileMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          single: async () => {
            const row = {
              // The agency's internal label, distinct from `brand_name` and
              // carrying the suffix such labels carry: the greeting test below
              // only passes if the route resolves the CUSTOMER-facing name.
              // The route no longer selects this column, so the projection
              // filter drops it.
              name: "Rio Roofing — trial", timezone: "America/Chicago",
              brand_name: "Rio Roofing Co", brand_logo_path: null, brand_color: null,
              brand_neutral: null, brand_corners: null, brand_type: null, brand_mode: null,
              reply_to_email: null, from_email: null,
            };
            const wanted = cols.split(",").map((c) => c.trim());
            return { data: Object.fromEntries(Object.entries(row).filter(([k]) => wanted.includes(k))), error: null };
          },
        }),
      }),
    }),
  }),
  getPhoneNumberByE164: (...a: unknown[]) => getPhoneNumberByE164Mock(...a),
  getVoiceProfile: (...a: unknown[]) => getVoiceProfileMock(...a),
  countCallsSince: vi.fn().mockResolvedValue(0),
  countCallsByCallerSince: vi.fn().mockResolvedValue(0),
  // Guard 2's read. Absent, vitest throws "No `countCallerHistorySince`
  // export is defined on the `@bis/db` mock" on EVERY call in this file — and
  // step 8's fail-open catch swallows it, so all 29 tests below stayed green
  // while exercising a route configuration production can never be in (Guard 2
  // throwing on every single call). A mock factory that omits a function the
  // route under test calls is not a smaller mock, it is a different route.
  // The clean history here is what makes every test in this file a call that
  // Guard 2 lets through, so Guard 1 is the only thing under test.
  countCallerHistorySince: vi.fn().mockResolvedValue({ spamCalls: 0, otherCalls: 0 }),
  startCallRow: vi.fn().mockResolvedValue({ id: "call-row-1" }),
  getOrCreateCalendar: vi.fn().mockResolvedValue({
    id: "cal1", account_id: "acct1", public_id: "cal_pub1", enabled: true,
    slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 14,
    open_hours: {}, notify_emails: ["staff@rio.example"],
  }),
  deleteCallRow: vi.fn(),
}));

import { POST } from "./route";

const PHONE_ROW = { id: "pn1", account_id: "acct1", e164: "+19565550999", telnyx_id: null, status: "live" as const };
const PROFILE_ROW = {
  id: "vp1", account_id: "acct1", persona_name: "Sofía",
  greeting_en: "Hi, thanks for calling Rio Roofing.", greeting_es: "Hola, gracias por llamar.",
  facts: "-", services: "-", languages: "en" as const, booking_enabled: true,
  after_hours: "hours_then_message" as const, enabled: true,
};

function callIncomingEvent(callId = "call_abc123") {
  return {
    id: "evt_1", created_at: Math.floor(Date.now() / 1000), type: "realtime.call.incoming",
    data: {
      call_id: callId,
      sip_headers: [
        { name: "From", value: "sip:+19562921696@sip.example.com" },
        { name: "X-BIS-Called", value: "+19565550999" },
      ],
    },
  };
}

function req(): NextRequest {
  return new Request("https://x.example/api/voice/incoming", {
    method: "POST",
    headers: { "webhook-id": "id", "webhook-timestamp": "1", "webhook-signature": "v1,irrelevant" },
    body: "raw-body-not-inspected-because-unwrap-is-mocked",
  }) as unknown as NextRequest;
}

/** Runs the webhook happy path, then invokes the callback `after()` was
 *  given — exactly what production's background execution does — and
 *  returns both the resulting lifecycle promise (resolves once `finish()`
 *  runs) and the fake socket the route constructed. */
async function startLifecycle(callId = "call_abc123"): Promise<{ lifecycleDone: Promise<void>; ws: InstanceType<typeof FakeWebSocket> }> {
  unwrapMock.mockResolvedValue(callIncomingEvent(callId));
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(afterMock).toHaveBeenCalledOnce();
  const cb = afterMock.mock.calls[0]![0] as () => Promise<void>;
  const lifecycleDone = cb();
  const ws = fakeSockets.instances[fakeSockets.instances.length - 1]!;
  return { lifecycleDone, ws };
}

/** Drains the microtask queue generously rather than hand-counting `await`
 *  hops — `handleMessage` → `processCallEvent` → `runTool` is 3 layers of
 *  async-function unwinding, each of which costs its own microtask tick to
 *  propagate a resolution up, and hand-counting is exactly the kind of
 *  fragile-by-construction thing worth avoiding in a race-condition test. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  process.env.OPENAI_WEBHOOK_SECRET = "whsec_test";
  process.env.OPENAI_API_KEY = "sk-test";
  delete process.env.PHONE_GREETING_DELAY_MS;
  delete process.env.PHONE_MAX_CALL_SECONDS;
  delete process.env.PHONE_CONNECT_TIMEOUT_MS;
  // The silence cutoff's window, same reason as its neighbours above: every
  // test below counts on the 30s default, and a stray env var in the shell
  // that ran vitest would move it silently.
  delete process.env.PHONE_MAX_SILENT_SECONDS;

  unwrapMock.mockReset();
  afterMock.mockReset();
  finishCallMock.mockReset().mockResolvedValue({ stored: true, notified: false, outcome: "abandoned" });
  runToolMock.mockReset();
  isCallerAudioEventMock.mockReset().mockImplementation(realIsCallerAudioEvent);
  getPhoneNumberByE164Mock.mockReset().mockResolvedValue(PHONE_ROW);
  getVoiceProfileMock.mockReset().mockResolvedValue(PROFILE_ROW);
  fetchMock.mockReset().mockResolvedValue({ ok: true, text: async () => "" });
  vi.stubGlobal("fetch", fetchMock);
  fakeSockets.instances.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runCallLifecycle — Critical #1: serialized message handling", () => {
  it("overlapping frames process in arrival order — a slow function-call never clobbers a transcript event that lands mid-flight", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("open");

    let resolveTool!: () => void;
    const toolGate = new Promise<void>((resolve) => { resolveTool = resolve; });
    runToolMock.mockImplementation(async (state: CallState) => {
      await toolGate;
      return { state: { ...state, contactId: "contact-from-tool" }, result: { ok: true } };
    });

    // Frame 1: a function-call event whose tool processing is deliberately
    // gated open — this is the "slow await mid-read-modify-write" window
    // the race lives in.
    ws.emit("message", JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "capture_lead", call_id: "fc1", arguments: "{}",
    }));
    // Frame 2: arrives immediately behind frame 1, and — unlike frame 1 —
    // has nothing to await, so under the OLD unserialized handler it would
    // finish and overwrite `state` LONG before frame 1's tool call resolves.
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "call me back at three",
    }));

    // Let any microtasks that don't depend on the gate settle. Frame 2 must
    // NOT have applied yet — with the fix, it can't even start until frame
    // 1's handler fully resolves.
    await flushMicrotasks();

    resolveTool();
    // Drain the chain fully: frame 1's promise (handleMessage → processCallEvent
    // → runTool) needs several microtask hops to unwind after the gate opens,
    // and only once that settles does frame 2 even get SCHEDULED (chained off
    // frame 1's completion) — flush generously rather than hand-count hops.
    await flushMicrotasks();

    ws.emit("close", 1000, Buffer.from("done"));
    await lifecycleDone;

    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    // Frame 1's effect (the mirrored tool write) survived...
    expect(finalState.contactId).toBe("contact-from-tool");
    // ...AND frame 2's effect (the transcript entry) survived alongside it —
    // this is the assertion that fails under the old last-write-wins handler,
    // because frame 1's `state = result.state` (computed from state as it
    // was BEFORE frame 2 ever landed) would otherwise overwrite frame 2's
    // addition on arrival.
    expect(finalState.transcript.some((t: TranscriptEvent) => t.text === "call me back at three")).toBe(true);
  });
});

describe("runCallLifecycle — cap/error idempotency", () => {
  it("both close and error firing for the same socket still calls finishCall exactly once", async () => {
    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("close", 1000, Buffer.from(""));
    ws.emit("error", new Error("boom"));
    await lifecycleDone;
    expect(finishCallMock).toHaveBeenCalledTimes(1);
  });
});

describe("runCallLifecycle — finish() drains in-flight frames on hangup", () => {
  it("a booking that lands right as the caller hangs up is not lost — finishCall sees the POST-tool state", async () => {
    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("open");

    let resolveTool!: () => void;
    const toolGate = new Promise<void>((resolve) => { resolveTool = resolve; });
    runToolMock.mockImplementation(async (state: CallState) => {
      await toolGate;
      return {
        state: {
          ...state,
          bookings: [
            ...state.bookings,
            {
              id: "bk1", contactName: "Maria", status: "booked",
              startsAt: "2027-05-01T15:00:00Z", endsAt: "2027-05-01T15:30:00Z",
            },
          ],
        },
        result: { ok: true, bookingId: "bk1" },
      };
    });

    // A book_appointment call whose tool resolution is deliberately gated —
    // the ~1s DB write a real booking takes is still in flight when the
    // caller hangs up.
    ws.emit("message", JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "book_appointment", call_id: "fc1", arguments: "{}",
    }));

    // The caller hangs up WHILE the tool is still pending.
    ws.emit("close", 1000, Buffer.from("bye"));

    // The booking lands a moment later — after `close` already fired, but
    // the record must still reflect it, not the stale pre-tool state.
    resolveTool();
    await flushMicrotasks();

    await lifecycleDone;

    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    // The booking mirror is present — `classifyOutcome` would read this as
    // "booked", not "abandoned". This is the assertion that fails without
    // the drain: `finish()` reads `state` immediately on `close`, before the
    // gated tool call ever resolves.
    expect(finalState.bookings.some((b: MirroredBooking) => b.status === "booked")).toBe(true);
  });

  it("bounded: a wedged tool call does not block finish() forever — finishCall fires with the pre-tool state once the 3000ms bound elapses", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("open");

    // A tool that never resolves — a genuinely wedged call.
    runToolMock.mockImplementation(() => new Promise(() => {}));

    ws.emit("message", JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "book_appointment", call_id: "fc1", arguments: "{}",
    }));

    ws.emit("close", 1000, Buffer.from("bye"));

    // The drain is genuinely bounded, not synchronous: finishCall must NOT
    // have fired yet immediately after close while the wedged tool call is
    // still in flight. This is the assertion that fails against the current
    // (undrained) code — there, `finish()` calls `finishCall` synchronously
    // on `close`, with no wait at all.
    expect(finishCallMock).not.toHaveBeenCalled();

    // Still short of the 3000ms bound: still draining.
    await vi.advanceTimersByTimeAsync(2999);
    expect(finishCallMock).not.toHaveBeenCalled();

    // Crossing the bound: the drain gives up and finish proceeds with
    // whatever state existed before the wedged tool call ever started.
    await vi.advanceTimersByTimeAsync(1);
    await lifecycleDone;

    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    expect(finalState.bookings).toEqual([]);
  });
});

describe("runCallLifecycle — Important #4 ①: greeting payload", () => {
  it("default fake timers: the greeting timer sends the exact greeting instruction after open", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const greetingCall = calls.find((c) => String(c[0]).includes("Greet the caller with exactly:"));
    expect(greetingCall).toBeDefined();
    expect(String(greetingCall![0])).toContain("Hi, thanks for calling Rio Roofing.");
  });

  it("languages: es → the greeting timer sends greeting_es", async () => {
    vi.useFakeTimers();
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, languages: "es" });
    const { ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const greetingCall = calls.find((c) => String(c[0]).includes("Greet the caller with exactly:"));
    expect(String(greetingCall![0])).toContain("Hola, gracias por llamar.");
  });

  // The caller HEARS this one, so it names the company the customer knows —
  // `brand_name`, not the agency's internal `accounts.name` label. Mutation:
  // `Thanks for calling ${accountRow.name}` in the route.
  it("both greeting_en and greeting_es blank → falls back to the generic greeting naming the BRAND", async () => {
    vi.useFakeTimers();
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, greeting_en: "  ", greeting_es: "" });
    const { ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900);
    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    const greetingCall = calls.find((c) => String(c[0]).includes("Greet the caller with exactly:"));
    expect(String(greetingCall![0])).toContain("Thanks for calling Rio Roofing Co. How can I help you today?");
    expect(String(greetingCall![0])).not.toContain("trial");
  });
});

describe("runCallLifecycle — Important #5: connect timeout", () => {
  it("no open within the timeout → terminates the socket and calls finishCall once with the empty state", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    const terminateSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.terminate = terminateSpy;
    ws.close = closeSpy;
    // No `ws.emit("open")` — the socket never comes up.
    await vi.advanceTimersByTimeAsync(15000);
    await lifecycleDone;

    expect(terminateSpy).toHaveBeenCalledOnce();
    // Pin the intent: a dead socket is terminated, not ALSO closed —
    // `ws.terminate?.() ?? ws.close()` calls both, since `??` only
    // short-circuits on the left side's own return value being nullish, not
    // on whether the call happened at all.
    expect(closeSpy).not.toHaveBeenCalled();
    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    expect(finalState.transcript).toEqual([]);
    expect(finalState.contactId).toBeNull();
    expect(finalState.bookings).toEqual([]);
  });

  it("open racing in AFTER the connect timeout must not arm greeting/cap timers on a dead socket", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    ws.terminate = vi.fn();
    ws.send = vi.fn();

    // The socket never comes up in time — connect-timeout fires, `finish()`
    // runs and settles the call.
    await vi.advanceTimersByTimeAsync(15000);
    await lifecycleDone;

    // `open` arrives late anyway — a real race between the timeout firing
    // and the SIP leg finally coming up. Without the `settled` guard this
    // would arm the greeting timer on a socket `finish()` already tore down.
    ws.emit("open");
    await vi.advanceTimersByTimeAsync(900); // past the default greeting delay

    const calls = (ws.send as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some((c) => String(c[0]).includes("response.create"))).toBe(false);
  });

  it("PHONE_CONNECT_TIMEOUT_MS is clamped to the 1000-60000 range", async () => {
    vi.useFakeTimers();
    process.env.PHONE_CONNECT_TIMEOUT_MS = "500"; // below the 1000 floor
    const { lifecycleDone, ws } = await startLifecycle();
    ws.terminate = vi.fn();
    // Advancing only to just under the clamped floor (1000ms) must NOT fire.
    await vi.advanceTimersByTimeAsync(999);
    expect(finishCallMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await lifecycleDone;
    expect(finishCallMock).toHaveBeenCalledTimes(1);
  });
});

describe("runCallLifecycle — Important #5: cap-seconds clamp", () => {
  it("PHONE_MAX_CALL_SECONDS above 750 is clamped to 750, not the route's 800s maxDuration", async () => {
    vi.useFakeTimers();
    // Above BOTH the clamp and the route's `maxDuration = 800`, so a missing
    // clamp cannot accidentally still land inside the invocation budget.
    process.env.PHONE_MAX_CALL_SECONDS = "900";
    const { ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    // One sound from the caller, so this is a call that is going SOMEWHERE.
    // The silence guard would otherwise end it at 30s and disarm the very
    // timer under test — on a SILENT call the cost cap is now unreachable by
    // construction (see "the two cost knobs cannot invert"), so a cap test
    // has to be a call where somebody spoke.
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();

    // Just under the clamp: no goodbye yet.
    await vi.advanceTimersByTimeAsync(749_000);
    expect((ws.send as ReturnType<typeof vi.fn>).mock.calls
      .some((c) => String(c[0]).includes("brief goodbye"))).toBe(false);

    // Crossing 750s (not the configured 900s) fires the goodbye. 750 is
    // 800 - 30 - 20, the two budgets derived in route.ts: a 30s post-cap tail
    // (5s close delay + 3s bounded drain + 10s carrier text-back + 12s of
    // finishCall's remaining DB and email round trips) AND a 20s connect leg
    // before the cap timer is armed at all — the cap's clock starts on
    // `open`, not when the webhook arrived, and 770 counted only the tail.
    await vi.advanceTimersByTimeAsync(1_000);
    expect((ws.send as ReturnType<typeof vi.fn>).mock.calls
      .some((c) => String(c[0]).includes("brief goodbye"))).toBe(true);
  });

  it("PHONE_MAX_CALL_SECONDS below 10 is floored to 10, not honoured literally", async () => {
    // The floor is not about the cap itself — a 1s cap is absurd but its own
    // problem. It exists because the SILENCE window is bounded at half this
    // number (see "the window's 5s floor survives the half-cap bound" below),
    // and half of anything under 10 lands under `readSilentSeconds`' own 5s
    // floor. Flooring the cap is what makes that bound incapable of undercutting
    // the clamp it is applied to; the alternative — flooring after the min —
    // would let the window TIE the cap, and a tie fires the cap first.
    vi.useFakeTimers();
    process.env.PHONE_MAX_CALL_SECONDS = "1";
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    ws.send = sendSpy;
    ws.emit("open");
    // One sound from the caller, so the silence guard (armed at half the
    // floored cap) is cancelled and the timer under test is the CAP.
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();

    // Nine seconds in: the configured 1s is long gone. Unfloored, the cap
    // fires at 1s — before the 900ms greeting has finished playing.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(CAP_GOODBYE))).toBe(false);

    // Crossing the floored 10s.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(instructionsSent(sendSpy).some((i) => i.includes(CAP_GOODBYE))).toBe(true);
  });
});

describe("runCallLifecycle — Minor: late frames after settle", () => {
  it("a frame arriving after the call cap closes the socket is ignored — no further processing or sends", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    ws.send = vi.fn();
    ws.emit("open");
    // A call somebody actually spoke on, so the cap named in this test's
    // title is what ends it rather than the silence guard at 30s.
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();

    // Cross the default 240s cap: sends the goodbye, then schedules a close
    // 5s later via `ws.close()` — a no-op on the fake socket, exactly like
    // the real `ws` package until ITS OWN "close" event fires in response.
    await vi.advanceTimersByTimeAsync(240_000);
    await vi.advanceTimersByTimeAsync(5_000);
    ws.emit("close", 1000, Buffer.from("cap"));
    await lifecycleDone;

    (ws.send as ReturnType<typeof vi.fn>).mockClear();
    runToolMock.mockClear();

    // A frame arrives late — after settle. It must not mutate recorded state
    // or attempt a send on a torn-down socket.
    ws.emit("message", JSON.stringify({
      type: "response.function_call_arguments.done",
      name: "take_message", call_id: "late1", arguments: "{}",
    }));
    await flushMicrotasks();

    expect(runToolMock).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
    expect(finishCallMock).toHaveBeenCalledTimes(1);
  });
});

/** Every payload the lifecycle has put on the socket, parsed back out of the
 *  JSON strings `ws.send` was handed — so a test can assert on the SHAPE of
 *  an instruction rather than on a substring of a serialized blob. */
function sentPayloads(send: ReturnType<typeof vi.fn>): unknown[] {
  return send.mock.calls.map((c) => JSON.parse(String(c[0])));
}

/** Just the `response.instructions` strings the lifecycle has asked the model
 *  to say — the surface the CALLER eventually hears, and the only thing that
 *  distinguishes the silence guard's fixed sentence from the cost cap's
 *  open-ended wrap-up. */
function instructionsSent(send: ReturnType<typeof vi.fn>): string[] {
  return sentPayloads(send)
    .map((p) => (p as { response?: { instructions?: unknown } } | null)?.response?.instructions)
    .filter((i): i is string => typeof i === "string");
}

const SILENCE_GOODBYE = "Say exactly this and nothing else";
const CAP_GOODBYE = "Politely wrap up";
const GREETING = "Greet the caller with exactly:";

// Guard 1 of the spam-screening spec. The row it exists to stop: a 247-second
// call whose only two transcript events were four minutes apart and BOTH the
// assistant's. Nobody ever spoke, and it billed the full cost cap.
describe("silence cutoff (Guard 1)", () => {
  it("a call where nobody ever speaks is ended at PHONE_MAX_SILENT_SECONDS, not the cost cap", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    // Everything below happens inside 35s. The cost cap is 240s, so a call
    // still alive at the end of this test is a call the guard did nothing for.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(sentPayloads(sendSpy)).toContainEqual(expect.objectContaining({
      type: "response.create",
      response: expect.objectContaining({
        instructions: expect.stringContaining("Say exactly this and nothing else"),
      }),
    }));

    // Same shape as the cap's: the goodbye plays out before the socket goes.
    expect(closeSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(closeSpy).toHaveBeenCalled();
  });

  it("one sound from the caller cancels the cutoff — the call survives past the window", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    // One VAD onset, five seconds in. That is all a real caller has to do.
    await vi.advanceTimersByTimeAsync(5_000);
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();

    // 60s total — double the window and well past the +5s close that would
    // follow it, but still far short of the 240s cost cap.
    await vi.advanceTimersByTimeAsync(55_000);

    expect(closeSpy).not.toHaveBeenCalled();
    expect(sentPayloads(sendSpy)).not.toContainEqual(expect.objectContaining({
      response: expect.objectContaining({
        instructions: expect.stringContaining("Say exactly this and nothing else"),
      }),
    }));
  });

  it("Sofía's own audio does NOT cancel the cutoff", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    // The greeting coming back as an assistant transcript — the 247-second
    // call's exact shape, assistant turns and nothing else.
    await vi.advanceTimersByTimeAsync(5_000);
    ws.emit("message", JSON.stringify({
      type: "response.output_audio_transcript.done",
      transcript: "Hi, thanks for calling Rio Roofing.",
    }));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(30_000); // 35s total: the window + the close delay
    expect(closeSpy).toHaveBeenCalled();
  });

  it("a cut call still records as spam — Guard 1 changes the BILL, not the record", async () => {
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    ws.send = vi.fn();
    // The real `ws` package answers `close()` with its own "close" event; the
    // fake's default `close` is a no-op. Wiring it through here on purpose:
    // it makes `finishCall`'s argument reachable ONLY by the guard actually
    // closing the socket, so this test is red without the implementation
    // instead of green off a hand-emitted close event.
    ws.close = vi.fn(() => { ws.emit("close", 1000, Buffer.from("silence-guard")); });
    ws.emit("open");

    await vi.advanceTimersByTimeAsync(35_000);
    // Asserted BEFORE awaiting `lifecycleDone`: a call the guard never cut
    // never closes its socket, so that await would hang and the failure would
    // read as a 5s test timeout instead of naming what actually went wrong.
    expect(finishCallMock).toHaveBeenCalledTimes(1);
    await lifecycleDone;

    // `finishCall` is MOCKED in this file, so the real `classifyOutcome`
    // never runs here and the outcome LABEL is not observable — asserting
    // "spam" against a mock would assert nothing. What is observable is the
    // state handed over: no caller transcript event, which is exactly the
    // condition `classifyOutcome` reads to return "spam" (call-state.ts:62).
    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const [stateArg] = finishCallMock.mock.calls[0]!;
    expect(stateArg.transcript.some((t: TranscriptEvent) => t.role === "caller")).toBe(false);
    expect(stateArg.bookings).toEqual([]);
    expect(stateArg.leads).toEqual([]);
    expect(stateArg.messages).toEqual([]);
  });

  it("the cost cap keeps its own open-ended wrap-up instruction", async () => {
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    // A real conversation: the caller makes a sound early, the silence guard
    // is cancelled, and this call runs the full length to the 240s cap.
    await vi.advanceTimersByTimeAsync(1_000);
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(239_000);

    const sent = sentPayloads(sendSpy);
    expect(sent).toContainEqual(expect.objectContaining({
      response: expect.objectContaining({
        instructions: expect.stringContaining("Politely wrap up"),
      }),
    }));
    // ...and the cap did NOT borrow the silence guard's fixed sentence.
    // Sharing one goodbye string between the two timers is the refactor this
    // line exists to stop: there is nothing to wrap up on a silent call, and
    // asking a model to wrap up a conversation that never happened is asking
    // it to invent one (which is what the 247-second call's summary recorded).
    expect(sent).not.toContainEqual(expect.objectContaining({
      response: expect.objectContaining({
        instructions: expect.stringContaining("Say exactly this and nothing else"),
      }),
    }));
  });
});

// The guard's three wirings — the env knob, the language, and the second
// accepted cancel event. Each of these stayed green while the wiring was
// mutated away, which is the only reason they exist as separate tests: the
// pure module already covers the DECISIONS in silence-guard.test.ts, and a
// decision nothing calls is a decision that does not happen.
describe("silence cutoff (Guard 1) — the wirings", () => {
  it("PHONE_MAX_SILENT_SECONDS is what the lifecycle actually arms — 60 means 60, not the module default", async () => {
    // Mutation this exists to catch: `readSilentSeconds()` → `30` at the
    // arming site. Its three sibling knobs (connect timeout, cap clamp,
    // greeting delay) each already have a wiring test in this file.
    vi.useFakeTimers();
    process.env.PHONE_MAX_SILENT_SECONDS = "60";
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    ws.send = sendSpy;
    ws.emit("open");

    // Well past the 30s default, and past the +5s close that would follow it.
    await vi.advanceTimersByTimeAsync(35_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(SILENCE_GOODBYE))).toBe(false);

    // Past the configured 60s.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(SILENCE_GOODBYE))).toBe(true);
  });

  it("languages: es → the silent caller hears the Spanish goodbye, not the English one", async () => {
    // Mutation this exists to catch: `silenceGoodbye(languages)` →
    // `silenceGoodbye("en")`. The greeting has exactly this test above; four
    // of the lifecycle's edit sites plumb `languages` and this is the second
    // of them to be pinned.
    vi.useFakeTimers();
    getVoiceProfileMock.mockResolvedValue({ ...PROFILE_ROW, languages: "es" });
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    ws.send = sendSpy;
    ws.emit("open");

    await vi.advanceTimersByTimeAsync(30_000);
    const goodbye = instructionsSent(sendSpy).find((i) => i.includes(SILENCE_GOODBYE));
    expect(goodbye).toBeDefined();
    expect(goodbye!).toContain("No puedo escuchar");
    expect(goodbye!).not.toContain("can't hear");
  });

  it("the slow backstop cancels too — a transcription completion, not only input_audio_buffer.*", async () => {
    // The spec says "cancel on either". Only the fast signal was ever
    // delivered to the guard by a test, so an inlined `input_audio_buffer.`
    // prefix check at the call site passed everything — and this is the half
    // production may depend on, since nothing guarantees `input_audio_buffer.*`
    // ever arrives on a SIP-attached socket.
    vi.useFakeTimers();
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    await vi.advanceTimersByTimeAsync(5_000);
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hi, are you open on Saturday",
    }));
    await flushMicrotasks();

    // 60s total: double the window and well past the +5s close behind it.
    await vi.advanceTimersByTimeAsync(55_000);

    expect(closeSpy).not.toHaveBeenCalled();
    expect(instructionsSent(sendSpy).some((i) => i.includes(SILENCE_GOODBYE))).toBe(false);
  });
});

// The coupling `cron-coupling.test.ts` exists for, one layer down: two knobs
// that are independent in the environment but ordered in the code, where the
// comment was the only thing holding the order. `PHONE_CONNECT_TIMEOUT_MS`
// carries the same shape in route.ts and says so in its own comment; this
// pair no longer has to.
describe("silence cutoff (Guard 1) — the two cost knobs cannot invert", () => {
  it("PHONE_MAX_CALL_SECONDS=60 under PHONE_MAX_SILENT_SECONDS=120: the guard still fires FIRST and the cap never speaks", async () => {
    vi.useFakeTimers();
    // An operator's perfectly reasonable pair of edits, in the wrong order:
    // the cost cap tightened to a minute, the silence window left long. Both
    // are inside their own documented clamps (cap ≤ 750, silence 5–120).
    process.env.PHONE_MAX_CALL_SECONDS = "60";
    process.env.PHONE_MAX_SILENT_SECONDS = "120";
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    // Deliberately a no-op close, like the real `ws` package until its own
    // "close" event comes back: this test must prove the CAP TIMER itself is
    // disarmed, not merely that a prompt teardown outran it.
    ws.close = closeSpy;
    ws.emit("open");

    // Half the cost cap: the guard's ceiling once it is bounded.
    await vi.advanceTimersByTimeAsync(30_000);
    const at30 = instructionsSent(sendSpy);
    expect(at30.some((i) => i.includes(SILENCE_GOODBYE))).toBe(true);
    expect(at30.some((i) => i.includes(CAP_GOODBYE))).toBe(false);

    // Past the cost cap's own 60s, and past its +5s close as well. The cap's
    // open-ended "wrap up" instruction is the one that produced a fabricated
    // call record on a call where nobody had spoken — a silent call must
    // never reach it, whatever the two knobs are set to.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(CAP_GOODBYE))).toBe(false);
  });

  it("the window's 5s floor survives the half-cap bound — however low the cap is set, the greeting still plays first", async () => {
    // The other end of the same coupling, and the one the bound used to
    // break. `Math.min(readSilentSeconds(), maxSeconds / 2)` applies the half
    // AFTER `readSilentSeconds`' own 5..120 clamp, so nothing floored the
    // result: measured off the route's own log line, a cap of 8 armed a 4s
    // window and a cap of 1 armed 0.5s — the silent caller was told "I can't
    // hear anything, goodbye" 400ms BEFORE the 900ms greeting reached them.
    // Two comments (route.ts and silence-guard.ts) claimed the module's 5s
    // floor made that impossible. The floor now lives on the CAP, so both
    // ends of the min are >= 5 and the claim is true again.
    vi.useFakeTimers();
    process.env.PHONE_MAX_CALL_SECONDS = "1";
    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    ws.send = sendSpy;
    ws.emit("open");

    // Nobody speaks. Just short of the 5s floor: the greeting has gone out at
    // 900ms and the goodbye has not been sent at all.
    await vi.advanceTimersByTimeAsync(4_900);
    const at4900 = instructionsSent(sendSpy);
    expect(at4900.some((i) => i.includes(GREETING))).toBe(true);
    expect(at4900.some((i) => i.includes(SILENCE_GOODBYE))).toBe(false);

    // And when it does fire it fires AFTER the greeting — which is the entire
    // point of a floor on a guard that speaks to the caller.
    await vi.advanceTimersByTimeAsync(200);
    const sent = instructionsSent(sendSpy);
    expect(sent.some((i) => i.includes(SILENCE_GOODBYE))).toBe(true);
    expect(sent.findIndex((i) => i.includes(SILENCE_GOODBYE)))
      .toBeGreaterThan(sent.findIndex((i) => i.includes(GREETING)));
  });
});

describe("silence cutoff (Guard 1) — teardown and late frames", () => {
  it("the caller hanging up disarms the guard — nothing is sent into a torn-down socket", async () => {
    // RED ONLY UNDER A PAIRED MUTATION, and unusually, nothing pins either
    // half alone — the two are deliberately redundant. Dropping `finish()`'s
    // `clearTimeout(silenceTimer)` leaves 42/42 green (the callback's own
    // `if (settled) return` catches it); dropping that `if (settled) return`
    // leaves 42/42 green (the clear catches it); dropping BOTH turns this test
    // red with "expected vi.fn() to not be called at all, but actually been
    // called 1 times". A cleared timer is not observable on its own, so there
    // is no test to write for the first half — this is the only one that can
    // fail, and it needs both edits to do it.
    vi.useFakeTimers();
    const { lifecycleDone, ws } = await startLifecycle();
    const sendSpy = vi.fn();
    ws.send = sendSpy;
    ws.emit("open");

    // A short real call: the caller hangs up at 10s, well inside the 30s
    // window, so the guard is still armed when `finish()` runs.
    await vi.advanceTimersByTimeAsync(10_000);
    ws.emit("close", 1000, Buffer.from("caller hung up"));
    await lifecycleDone;

    sendSpy.mockClear();
    // Past both the window and the close that would follow it.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("after the guard fires, late caller audio neither cancels the pending close nor logs that it did", async () => {
    // The log line is the diagnostic the runbook tells the operator to read
    // off a real call, so it must not claim a cancel that did not happen —
    // and the DECISION it reports is deliberate: once the fixed goodbye is
    // playing the call is ending, and a caller speaking over it does not
    // resurrect the session.
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { ws } = await startLifecycle();
      const sendSpy = vi.fn();
      const closeSpy = vi.fn();
      ws.send = sendSpy;
      ws.close = closeSpy;
      ws.emit("open");

      await vi.advanceTimersByTimeAsync(30_000); // the guard fires
      expect(instructionsSent(sendSpy).some((i) => i.includes(SILENCE_GOODBYE))).toBe(true);
      logSpy.mockClear();

      await vi.advanceTimersByTimeAsync(1_000); // t=31s, inside the 5s playout
      ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
      await flushMicrotasks();

      const claimed = logSpy.mock.calls.some((c) =>
        c.some((a) => String(a).includes("caller audio detected, silence guard cleared")));
      expect(claimed).toBe(false);

      await vi.advanceTimersByTimeAsync(4_000); // t=35s
      expect(closeSpy).toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it("a frame whose `type` is not a string does not wedge the chain — the next frame still lands", async () => {
    // RED ONLY UNDER A PAIRED MUTATION — a single mutation cannot fail it, so
    // do not read it as dead. Both halves have to go: `isCallerAudioEvent`'s
    // `typeof type !== "string"` guard AND the cancel block's position inside
    // a try (verified: with the block moved outside every try in
    // `handleMessage` but the `typeof` guard intact, this stays green; remove
    // the guard as well and it goes red). Each half IS pinned alone, elsewhere:
    //   - the `typeof` guard → `silence-guard.test.ts`, "rejects a truthy
    //     NON-STRING type without throwing — the payload is untrusted JSON".
    //   - the block's position → "a predicate that throws on EVERY frame costs
    //     the guard only" and "a predicate that throws fails OPEN", below.
    //
    // Critical: the cancel block used to be the ONE statement in
    // `handleMessage` outside its try/catch, so a throw there escaped into
    // `chain = chain.then(...)` and left the chain PERMANENTLY rejected.
    // Every later frame of that call is then silently dropped — no
    // transcript, no lead, no booking — while the caller hears a normal
    // conversation, because the audio is OpenAI's SIP bridge and not ours.
    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("open");

    // Valid JSON, `type` present and truthy, but not a string.
    ws.emit("message", JSON.stringify({ type: 42 }));
    // Immediately behind it: the frame carrying the whole call's value.
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "my roof is leaking",
    }));
    await flushMicrotasks();

    ws.emit("close", 1000, Buffer.from("bye"));
    await lifecycleDone;

    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    expect(finalState.transcript.some((t: TranscriptEvent) => t.text === "my roof is leaking")).toBe(true);
  });

  it("a predicate that throws on EVERY frame costs the guard only — the chain survives and the call is still recorded", async () => {
    // The structural half of the same bug, and the half that outlives the
    // `typeof` fix inside `isCallerAudioEvent`: the cancel block reads an
    // untrusted field, and Tasks 3–6 add more predicates that read more of
    // them. Two distinct losses are being ruled out here, and a throwing
    // predicate on every frame is what separates them:
    //
    //  - block OUTSIDE `handleMessage`'s try → `chain` is permanently
    //    rejected and every later frame is dropped.
    //  - block sharing the OUTER try → the chain survives, but each throw
    //    skips that frame's `processCallEvent`, and since the predicate
    //    throws on the next frame too the transcript, leads and bookings are
    //    lost just as completely, only more quietly.
    isCallerAudioEventMock.mockImplementation(() => { throw new TypeError("predicate blew up"); });

    const { lifecycleDone, ws } = await startLifecycle();
    ws.emit("open");

    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "there is water coming through the ceiling",
    }));
    await flushMicrotasks();

    ws.emit("close", 1000, Buffer.from("bye"));
    await lifecycleDone;

    expect(finishCallMock).toHaveBeenCalledTimes(1);
    const finalState = finishCallMock.mock.calls[0]![0];
    expect(finalState.transcript.some(
      (t: TranscriptEvent) => t.text === "there is water coming through the ceiling")).toBe(true);
  });

  it("a predicate that throws fails OPEN — the caller is not cut off, and the call still runs to the cost cap", async () => {
    // The test above proves the throw costs no TRANSCRIPT. This one proves it
    // costs no CALL. A probe drove a throwing predicate to the 30s mark on a
    // caller who had produced a VAD onset and said "hello, I need a roof
    // repair": the guard stayed armed, fired, and closed the socket at 35s on
    // a live prospect.
    //
    // Fail open, everywhere in this feature — losing a prospect costs more
    // than paying for one extra robocall. A bug in a cost OPTIMISATION must
    // never cut off a paying customer, and must never leave the product worse
    // than it was before the optimisation existed. So a throw degrades the
    // call to exactly the pre-Guard-1 behaviour: `capTimer` and nothing else.
    vi.useFakeTimers();
    isCallerAudioEventMock.mockImplementation(() => { throw new TypeError("predicate blew up"); });

    const { ws } = await startLifecycle();
    const sendSpy = vi.fn();
    const closeSpy = vi.fn();
    ws.send = sendSpy;
    ws.close = closeSpy;
    ws.emit("open");

    // A caller who is plainly there: the fast signal, then words.
    await vi.advanceTimersByTimeAsync(2_000);
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    ws.emit("message", JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "hello, I need a roof repair",
    }));
    await flushMicrotasks();

    // t=35s: past the 30s window AND past the 5s playout that would follow it.
    await vi.advanceTimersByTimeAsync(33_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(SILENCE_GOODBYE))).toBe(false);
    expect(closeSpy).not.toHaveBeenCalled();

    // ...and `capTimer` was left ALONE by the catch, so the call still ends
    // where it always did before this guard existed: the 240s cost cap.
    await vi.advanceTimersByTimeAsync(205_000);
    expect(instructionsSent(sendSpy).some((i) => i.includes(CAP_GOODBYE))).toBe(true);
  });
});

describe("runCallLifecycle — Minor: WS URL call-id encoding", () => {
  it("encodeURIComponents the call id into the realtime WS URL", async () => {
    const { ws } = await startLifecycle("call/with special?chars");
    expect(ws.url).toContain(encodeURIComponent("call/with special?chars"));
    expect(ws.url).not.toContain("call/with special?chars");
  });
});
