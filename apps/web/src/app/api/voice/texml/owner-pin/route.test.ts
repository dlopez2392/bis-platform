// apps/web/src/app/api/voice/texml/owner-pin/route.test.ts
// F-032 plan Task 9: the PIN and call-in code step, as a DECISION. `../route`, `../telnyx-request`, `@bis/db` and the
// lockout module are mocked, so each case says which of today's documents the caller gets. The real chain
// (signature, re-run, screened_calls row, owner pass) is ./today-path.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  form: { ok: true, form: new URLSearchParams(), authenticated: true } as
    | { ok: true; form: URLSearchParams; authenticated: boolean } | { ok: false; response: Response },
  today: vi.fn(), bridge: vi.fn(), again: vi.fn(), failsafe: vi.fn(),
  phone: vi.fn(), look: vi.fn(), verify: vi.fn(), pin: vi.fn(), lockout: vi.fn(),
  after: vi.fn(),
}));
const xml = (s: string) => new NextResponse(s, { status: 200 });
vi.mock("../telnyx-request", () => ({ readTelnyxForm: vi.fn(async () => h.form), logFormFields: vi.fn() }));
vi.mock("../route", () => ({
  actionOrigin: () => "https://x.example",
  answer: (...a: unknown[]) => h.today(...a),
  ownerLineBridge: (...a: unknown[]) => h.bridge(...a),
  ownerLineGatherAgain: (...a: unknown[]) => h.again(...a),
  bridgeAfterFailure: (...a: unknown[]) => h.failsafe(...a),
  xmlResponse: (s: string) => xml(s),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), OWNER_LINE_MAX_CALLS_PER_DAY: 10,
  getPhoneNumberByE164: h.phone, ownerLineAnswerLookup: h.look,
  attemptOwnerLineVerify: h.verify, attemptOwnerLinePin: h.pin,
}));
vi.mock("@/lib/owner-line/lockout", () => ({ sendOwnerLineLockoutEmails: h.lockout }));
// after() becomes a recorder this file runs itself (route.test.ts's pattern), so a case can look at the moment
// between the response and the deferred work.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => h.after(cb) };
});
/** Runs every callback after() has recorded so far, as production does once the response is sent. */
async function flushAfter(): Promise<void> {
  const calls = [...h.after.mock.calls];
  h.after.mockClear();
  for (const [cb] of calls) await (cb as () => unknown)();
}

import { GET, POST } from "./route";
import { hashPin, hashVerifyCode } from "@/lib/owner-line/secrets";

const TO = "+19565550999";
const CELL = "+19565550142";
const PIN = "482913";
const TODAY_ARGS = [TO, CELL, "https://x.example", true, { skipScreen: true, skipOwnerLine: true }];
const post = (fields: Record<string, string>) => {
  const authenticated = h.form.ok ? h.form.authenticated : true;
  h.form = { ok: true, form: new URLSearchParams({ To: TO, From: CELL, ...fields }), authenticated };
  return POST(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }));
};
let HASH = "";
const PIN_HIT = () => ({ status: "pin", enrollmentId: "e1", userId: "u1", role: "staff", name: "Dan", language: "en",
  accountLanguage: null, pinParams: HASH.slice(0, 36) });
const CODE_HIT = () => ({ ...PIN_HIT(), status: "verify", pinParams: null });

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
/** Every line logged or errored in this test. */
const logged = () => [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join("\n");

beforeEach(async () => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations; these two are re-armed per case because some cases make them throw.
  h.after.mockReset();
  h.lockout.mockReset().mockResolvedValue(undefined);
  h.form = { ok: true, form: new URLSearchParams(), authenticated: true };
  process.env.OWNER_LINE_PIN_PEPPER = "p".repeat(40);
  HASH ||= await hashPin(PIN);
  // A fresh response per call: a body can be read once, and some cases post twice.
  h.today.mockImplementation(async () => xml("TODAY"));
  h.bridge.mockImplementation(() => xml("BRIDGE"));
  h.again.mockImplementation(async () => xml("AGAIN"));
  h.failsafe.mockImplementation(() => xml("FAILSAFE"));
  h.phone.mockResolvedValue({ id: "pn", account_id: "a1", status: "live" });
  h.look.mockResolvedValue(PIN_HIT());
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("owner-pin (F-032 §4.2): signed requests only", () => {
  it("GET is 405 whatever the environment", async () => {
    expect((await GET()).status).toBe(405);
  });

  it("an UNSIGNED request checks nothing and gets today's path, unsigned (mutation: drop the authenticated guard -> FAILS)", async () => {
    h.form = { ok: true, form: new URLSearchParams(), authenticated: false };
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    expect(h.today).toHaveBeenCalledWith(TO, CELL, "https://x.example", false, { skipScreen: true, skipOwnerLine: true });
    expect(h.phone).not.toHaveBeenCalled();
    expect(h.look).not.toHaveBeenCalled();
    expect(h.pin).not.toHaveBeenCalled();
    expect(h.bridge).not.toHaveBeenCalled();
  });

  it("a request whose signature the reader refused is answered with the reader's refusal and nothing else (mutation: decide on a refused read -> FAILS)", async () => {
    h.form = { ok: false, response: new NextResponse(null, { status: 403 }) };
    const res = await POST(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }));
    expect(res.status).toBe(403);
    for (const f of [h.today, h.phone, h.look, h.pin, h.verify, h.bridge, h.failsafe]) expect(f).not.toHaveBeenCalled();
  });
});

describe("owner-pin: the PIN", () => {
  it("the right PIN bridges with the owner pass for THIS person and role, and the digits never reach a log", async () => {
    h.pin.mockResolvedValue({ status: "ok" });
    expect(await (await post({ Digits: PIN })).text()).toBe("BRIDGE");
    expect(h.pin).toHaveBeenCalledWith({}, "e1", HASH);
    expect(h.bridge).toHaveBeenCalledWith(TO, CELL, "https://x.example", { accountId: "a1", userId: "u1", role: "staff" });
    expect(logged()).toContain("texml owner-pin: PIN ok, accountId a1");
    for (const secret of [PIN, HASH, HASH.slice(14, 36), CELL, CELL.slice(2)]) expect(logged()).not.toContain(secret);
  });

  it("the right PIN followed by the finish key is the same PIN", async () => {
    h.pin.mockResolvedValue({ status: "ok" });
    expect(await (await post({ Digits: `${PIN}#` })).text()).toBe("BRIDGE");
    expect(h.pin).toHaveBeenCalledWith({}, "e1", HASH);
  });

  it.each([[""], ["#"], ["##"]])("Digits %j (pound, or a timeout) is today's path and does NOT count as a wrong PIN (mutation: drop the empty check -> FAILS)", async (d) => {
    expect(await (await post({ Digits: d })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
    expect(h.today).toHaveBeenCalledWith(...TODAY_ARGS);
  });

  it("no Digits field at all (a timeout that posts) is today's path and not an attempt", async () => {
    h.form = { ok: true, form: new URLSearchParams({ To: TO, From: CELL }), authenticated: true };
    expect(await (await POST(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }))).text()).toBe("TODAY");
    expect(h.today).toHaveBeenCalledWith(...TODAY_ARGS);
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("no pepper: today's path, and NO attempt is counted against the person (O-3; mutation: drop the pepper check -> the outer catch bridges instead, FAILS)", async () => {
    delete process.env.OWNER_LINE_PIN_PEPPER;
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    expect(h.today).toHaveBeenCalledWith(...TODAY_ARGS);
    expect(h.pin).not.toHaveBeenCalled();
    expect(logged()).toContain("texml owner-pin: OWNER_LINE_PIN_PEPPER is not set — today's path, nothing checked, accountId a1");
  });

  it("a wrong PIN below three asks again (the re-ask re-reads today's verdicts); a short entry counts as wrong", async () => {
    h.pin.mockResolvedValue({ status: "wrong" });
    expect(await (await post({ Digits: "1234#" })).text()).toBe("AGAIN");
    expect(h.pin).toHaveBeenCalledWith({}, "e1", "invalid");
    expect(h.again).toHaveBeenCalledWith(TO, CELL, "https://x.example", { kind: "pin", locale: "en", accountId: "a1", name: "Dan" });
    expect(logged()).not.toContain("1234");
  });

  it("the third wrong PIN emails both people and the call continues as a customer's (mutation: hang up instead -> FAILS)", async () => {
    h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
    const res = await (await post({ Digits: "111112" })).text();
    expect(res).toBe("TODAY");
    expect(res).not.toContain("Hangup");
    expect(h.today).toHaveBeenCalledWith(...TODAY_ARGS);
    await flushAfter();
    expect(h.lockout).toHaveBeenCalledWith({
      accountId: "a1", userId: "u1", lockedUntil: "2026-11-09T20:44:00.000Z", at: expect.any(Date), accountLanguage: null,
    });
  });

  it("the response is produced WITHOUT loading the lockout module; it loads inside after(), once the caller is answered (Task 9 decision: the 613 KB chunk off Telnyx's deadline; mutation: import it before the response -> FAILS)", async () => {
    // A fresh registry with a factory that COUNTS its own evaluation: the lockout module is evaluated the first time
    // anything imports it, so a count still 0 once the caller is answered proves the 613 KB chunk never loaded
    // before the response. (A hoisted vi.mock factory's result is cached across resetModules, so it cannot count;
    // vi.doMock after resetModules registers one that runs again, lockout.test.ts's m-7 pattern.)
    let loads = 0;
    vi.resetModules();
    vi.doMock("@/lib/owner-line/lockout", () => { loads += 1; return { sendOwnerLineLockoutEmails: h.lockout }; });
    try {
      const { POST: freshPost } = await import("./route");
      h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
      h.form = { ok: true, form: new URLSearchParams({ To: TO, From: CELL, Digits: "111112" }), authenticated: true };
      const res = await freshPost(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }));
      expect(await res.text()).toBe("TODAY");
      expect(loads).toBe(0);                                 // answered, and the module was never evaluated
      expect(h.lockout).not.toHaveBeenCalled();
      expect(h.after).toHaveBeenCalledTimes(1);
      await flushAfter();
      expect(loads).toBe(1);                                 // loaded inside after(), exactly once
      expect(h.lockout).toHaveBeenCalledTimes(1);
    } finally {
      // Back to this file's own default mock (never doUnmock: that would drop it, and later cases would load the
      // real module), in a fresh registry.
      vi.doMock("@/lib/owner-line/lockout", () => ({ sendOwnerLineLockoutEmails: h.lockout }));
      vi.resetModules();
    }
  });

  it("the email states the moment the PIN was wrong a third time, captured BEFORE after(), not when the deferred send runs (mutation: read new Date() inside the after() callback -> FAILS)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T20:14:00.000Z"));
    h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
    expect(await (await post({ Digits: "111112" })).text()).toBe("TODAY");
    vi.setSystemTime(new Date("2026-11-09T20:20:00.000Z"));   // the deferred work runs six minutes later
    await flushAfter();
    expect(h.lockout.mock.calls[0]![0].at).toEqual(new Date("2026-11-09T20:14:00.000Z"));
  });

  it("after() throwing (outside a request scope) never costs the caller today's path, and is logged by class and account only (mutation: drop the try/catch around after() -> the outer catch's last-resort bridge, FAILS)", async () => {
    h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
    h.after.mockImplementation(() => { throw new Error(`no request scope for ${CELL}`); });
    expect(await (await post({ Digits: "111112" })).text()).toBe("TODAY");
    expect(h.failsafe).not.toHaveBeenCalled();
    expect(h.lockout).not.toHaveBeenCalled();
    expect(logged()).toContain("texml owner-pin: lockout emails could not be scheduled (Error), accountId a1");
    expect(logged()).not.toContain(CELL.slice(2));
  });

  it("a send that fails inside after() is caught there and logged by class and account only (mutation: drop the callback's try/catch -> the deferred work rejects, FAILS)", async () => {
    h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
    h.lockout.mockRejectedValue(new Error(`send failed for ${CELL}`));
    expect(await (await post({ Digits: "111112" })).text()).toBe("TODAY");
    await expect(flushAfter()).resolves.toBeUndefined();
    expect(logged()).toContain("texml owner-pin: lockout emails failed (Error), accountId a1");
    expect(logged()).not.toContain(CELL.slice(2));
  });

  it.each([["locked"], ["none"]])("an attempt that answers %s (a race with another call, or the enrollment just went) is today's path", async (status) => {
    h.pin.mockResolvedValue(status === "locked" ? { status, lockedUntil: "2026-11-09T20:44:00.000Z" } : { status });
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    expect(h.bridge).not.toHaveBeenCalled();
    expect(h.after).not.toHaveBeenCalled();
  });
});

describe("owner-pin: the call-in code", () => {
  it("the sha256 of the digits is what is checked, never the digits; verified says goodbye", async () => {
    h.look.mockResolvedValue(CODE_HIT());
    h.verify.mockResolvedValue("verified");
    const res = await (await post({ Digits: "123456" })).text();
    expect(res).toContain("This phone is verified");
    expect(h.verify).toHaveBeenCalledWith({}, "a1", CELL, hashVerifyCode("123456"));
    expect(hashVerifyCode("123456")).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
    for (const secret of ["123456", hashVerifyCode("123456"), CELL.slice(2)]) expect(logged()).not.toContain(secret);
  });

  it("a wrong code asks again for the code", async () => {
    h.look.mockResolvedValue(CODE_HIT());
    h.verify.mockResolvedValue("wrong");
    expect(await (await post({ Digits: "123456" })).text()).toBe("AGAIN");
    expect(h.again).toHaveBeenCalledWith(TO, CELL, "https://x.example", { kind: "verify", locale: "en", accountId: "a1", name: "Dan" });
  });

  it.each([["spent"], ["none"]])("a call-in code that is %s goes to today's path, never a hang-up (plan I-3; spec §2.1, §3.2; mutation: answer spent with <Hangup/> -> FAILS)", async (r) => {
    h.look.mockResolvedValue(CODE_HIT());
    h.verify.mockResolvedValue(r);
    const res = await (await post({ Digits: "123456" })).text();
    expect(res).toBe("TODAY");
    expect(h.today).toHaveBeenCalledWith(...TODAY_ARGS);
  });

  it.each([[""], ["#"], ["12#"]])("Digits %j on a code ask is today's path and spends no attempt", async (d) => {
    h.look.mockResolvedValue(CODE_HIT());
    expect(await (await post({ Digits: d })).text()).toBe("TODAY");
    expect(h.verify).not.toHaveBeenCalled();
  });
});

describe("owner-pin: who may key at all", () => {
  it.each([["pin"], ["verify"]])("a Technician's %s step is today's path: no attempt, no code check (O-1 = F2; the SQL attempt functions check no role; mutation: drop the OWNER_LINE_ROLES check -> FAILS)", async (status) => {
    h.look.mockResolvedValue({ ...PIN_HIT(), status, role: "technician", pinParams: status === "pin" ? HASH.slice(0, 36) : null });
    h.pin.mockResolvedValue({ status: "ok" });
    h.verify.mockResolvedValue("verified");
    expect(await (await post({ Digits: status === "pin" ? PIN : "123456" })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.bridge).not.toHaveBeenCalled();
  });

  it.each([["none"], ["off"], ["locked"], ["over_limit"]])("a lookup that answers %s is today's path", async (status) => {
    h.look.mockResolvedValue(status === "over_limit" ? { ...PIN_HIT(), status } : { status });
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("an unknown or not-live called number is today's path, and the lookup never runs", async () => {
    h.phone.mockResolvedValue({ id: "pn", account_id: "a1", status: "released" });
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    h.phone.mockResolvedValue(null);
    expect(await (await post({ Digits: PIN })).text()).toBe("TODAY");
    expect(h.look).not.toHaveBeenCalled();
  });

  it("no caller number is today's path", async () => {
    h.form = { ok: true, form: new URLSearchParams({ To: TO, Digits: PIN }), authenticated: true };
    expect(await (await POST(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }))).text()).toBe("TODAY");
    expect(h.look).not.toHaveBeenCalled();
  });
});

describe("owner-pin: failures", () => {
  it("anything that throws is the last-resort bridge, never a 500, logged by error class only (mutation: log String(e) -> FAILS)", async () => {
    h.look.mockRejectedValue(new Error(`db down for ${CELL} pin_params ${HASH.slice(0, 36)}`));
    expect(await (await post({ Digits: PIN })).text()).toBe("FAILSAFE");
    expect(h.failsafe).toHaveBeenCalledWith(TO, CELL, "https://x.example", true);
    expect(logged()).toContain(`texml owner-pin failed (Error) — bridging for ${TO}`);
    for (const secret of [CELL.slice(2), HASH.slice(14, 36), PIN]) expect(logged()).not.toContain(secret);
  });
});
