// apps/web/src/app/api/voice/texml/owner-pin/today-path.test.ts
// F-032 Task 9, end to end through the REAL answer route: owner-pin's decisions in ./route.test.ts are made against a
// mocked `../route`; here only the database and `after()` are stand-ins, so these cases prove what the caller gets:
//   - a request Telnyx did not sign is refused before anything is read;
//   - every fall-through (pound, a spent code, the third wrong PIN) re-runs today's checks, so an over-cap caller
//     hears today's cap sentence and the screened_calls row is written, exactly as on any refused call;
//   - the right PIN's bridge carries an owner pass bound to THAT dial's handoff token, for this person and role.
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  phone: vi.fn(), profile: vi.fn(), countAccount: vi.fn(), countCaller: vi.fn(), history: vi.fn(), forwarded: vi.fn(),
  screened: vi.fn(), look: vi.fn(), verify: vi.fn(), pin: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), OWNER_LINE_MAX_CALLS_PER_DAY: 10,
  getPhoneNumberByE164: db.phone, getVoiceProfile: db.profile,
  countCallsSince: db.countAccount, countCallsByCallerSince: db.countCaller, countCallerHistorySince: db.history,
  countForwardedCallsSince: db.forwarded, recordScreenedCall: db.screened, recordForwardedCall: async () => undefined,
  getTransferPhone: async () => null, listPhoneNumbersForAccount: async () => [], readBillingStanding: async () => null,
  ownerLineAnswerLookup: db.look, attemptOwnerLineVerify: db.verify, attemptOwnerLinePin: db.pin,
}));
const lockout = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-line/lockout", () => ({ sendOwnerLineLockoutEmails: lockout }));
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: () => {} }));
const afterMock = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => afterMock(cb) };
});

import { POST } from "./route";
import { hashPin } from "@/lib/owner-line/secrets";
import { verifyOwnerPass } from "@/lib/voice/sip-handoff-signature";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TO = "+19565550999";
const CELL = "+19565550142";
const PIN = "482913";
const PROFILE = {
  id: "vp1", account_id: ACCOUNT, persona_name: "Sofía", greeting_en: "Hi", greeting_es: "Hola", facts: "-",
  services: "-", languages: "en" as const, booking_enabled: true, after_hours: "hours_then_message" as const,
  enabled: true, trade_module: null, business_hours: null,
};
const CAP_DOC = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>We're sorry — we can't take more calls today. Please call back tomorrow.</Say><Hangup/></Response>`;
let HASH = "";
const hit = (over: Record<string, unknown> = {}) => ({ status: "pin", enrollmentId: "e1", userId: USER, role: "staff",
  name: "Dan", language: "en", accountLanguage: null, pinParams: HASH.slice(0, 36), ...over });

function signed(fields: Record<string, string>, opts: { badSignature?: boolean } = {}) {
  const raw = new URLSearchParams(fields).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  process.env.TELNYX_PUBLIC_KEY = spki.subarray(spki.length - 32).toString("base64");
  const signedOver = opts.badSignature ? `${raw}&Digits=000000` : raw;
  return POST(new Request("https://x.example/api/voice/texml/owner-pin", {
    method: "POST", body: raw,
    headers: {
      "content-type": "application/x-www-form-urlencoded", "telnyx-timestamp": ts,
      "telnyx-signature-ed25519": cryptoSign(null, Buffer.from(`${ts}|${signedOver}`, "utf8"), privateKey).toString("base64"),
    },
  }));
}
async function flushAfter(): Promise<void> {
  const calls = [...afterMock.mock.calls];
  afterMock.mockClear();
  for (const [cb] of calls) await (cb as () => unknown)();
}
const sipParams = (xml: string) => {
  const uri = /<Sip>([^<]*)<\/Sip>/.exec(xml)![1]!.replaceAll("&amp;", "&");
  return new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
};

let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;
const logged = () => [...logSpy.mock.calls, ...errSpy.mock.calls].flat().map(String).join("\n");

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.VOICE_OPENAI_PROJECT_ID = "proj_test123";
  process.env.VOICE_HANDOFF_SECRET = "h".repeat(48);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k".repeat(64);
  process.env.OWNER_LINE_PIN_PEPPER = "p".repeat(40);
  for (const k of ["VOICE_FORWARD_TO", "VOICE_SCREEN_NUMBERS", "BILLING_ENFORCE", "APP_ORIGIN",
    "VOICE_FALLBACK_DRILL_TO", "VOICE_FALLBACK_DRILL_FROM", "PHONE_MAX_CALLS_PER_NUMBER_PER_DAY"]) delete process.env[k];
  HASH ||= await hashPin(PIN);
  db.phone.mockImplementation(async (_d: unknown, e164: string) =>
    (e164 === TO ? { id: "pn1", account_id: ACCOUNT, e164: TO, telnyx_id: null, status: "live" } : null));
  db.profile.mockResolvedValue(PROFILE);
  db.countAccount.mockResolvedValue(0);
  db.countCaller.mockResolvedValue(0);
  db.history.mockResolvedValue({ spamCalls: 0, otherCalls: 0, answeredCalls: 1 });
  db.forwarded.mockResolvedValue({ forAccount: 0, forCaller: 0 });
  db.screened.mockResolvedValue(undefined);
  db.look.mockResolvedValue(hit());
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TELNYX_PUBLIC_KEY;
});

describe("owner-pin through the real answer route (F-032 Task 9)", () => {
  it("a request whose Telnyx signature does not verify is refused 403 before anything is read (mutation: decide on a refused read -> FAILS)", async () => {
    const res = await signed({ To: TO, From: CELL, Digits: PIN }, { badSignature: true });
    expect(res.status).toBe(403);
    for (const f of [db.phone, db.look, db.pin, db.verify]) expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ["pound", () => {}, { Digits: "#" }],
    ["a spent call-in code", () => { db.look.mockResolvedValue(hit({ status: "verify", pinParams: null })); db.verify.mockResolvedValue("spent"); }, { Digits: "123456" }],
    ["the third wrong PIN", () => { db.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" }); }, { Digits: "111112" }],
  ])("%s, from a caller over today's cap: today's cap sentence, never a bridge, and the screened_calls row is written (I-3: never a hang-up of our own)", async (_what, arrange, fields) => {
    arrange();
    db.countCaller.mockResolvedValue(99);
    const xml = await (await signed({ To: TO, From: CELL, ...fields })).text();
    expect(xml).toBe(CAP_DOC);
    await flushAfter();
    expect(db.screened).toHaveBeenCalledExactlyOnceWith({}, {
      accountId: ACCOUNT, phoneNumberId: "pn1", calledE164: TO, callerE164: CELL, reason: "over-cap",
    });
    // The lockout emails ran in after(), from the module loaded there, with the captured lock instant.
    if (fields.Digits === "111112") {
      expect(lockout).toHaveBeenCalledExactlyOnceWith({ accountId: ACCOUNT, userId: USER,
        lockedUntil: "2026-11-09T20:44:00.000Z", at: expect.any(Date), accountLanguage: null });
    } else {
      expect(lockout).not.toHaveBeenCalled();
    }
  });

  it("the refusal line names the claimed called number but NEVER the claimed caller on owner-pin, whose callers are a business's own team (review m-6; mutation: log the caller here as the other routes do -> FAILS)", async () => {
    await signed({ To: TO, From: CELL, Digits: PIN }, { badSignature: true });
    const lines = logged();
    expect(lines).toContain(`texml owner-pin: rejected request (invalid-signature), claimedTo ${TO}`);
    expect(lines).not.toContain("claimedFrom");
    expect(lines).not.toContain(CELL.slice(2));
  });

  it("the database failing at the PIN attempt, for a caller over today's cap: today's cap sentence and the screened_calls row, never the last-resort bridge (review m-2: fail closed to today's path; mutation: go straight to the last-resort bridge -> FAILS)", async () => {
    db.countCaller.mockResolvedValue(99);
    db.pin.mockRejectedValue(new Error("attemptOwnerLinePin failed: connection reset"));
    const xml = await (await signed({ To: TO, From: CELL, Digits: PIN })).text();
    expect(xml).toBe(CAP_DOC);
    await flushAfter();
    expect(db.screened).toHaveBeenCalledExactlyOnceWith({}, {
      accountId: ACCOUNT, phoneNumberId: "pn1", calledE164: TO, callerE164: CELL, reason: "over-cap",
    });
  });

  it("no usable VOICE_HANDOFF_SECRET: today's path, and the PIN is never checked (review m-3)", async () => {
    delete process.env.VOICE_HANDOFF_SECRET;
    db.pin.mockResolvedValue({ status: "ok" });
    const xml = await (await signed({ To: TO, From: CELL, Digits: PIN })).text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\"");
    expect(db.look).not.toHaveBeenCalled();
    expect(db.pin).not.toHaveBeenCalled();
  });

  it.each([
    ["the agency's forward is on", () => { db.profile.mockResolvedValue({ ...PROFILE, forward_calls: true }); }],
    ["VOICE_FORWARD_TO is set", () => { process.env.VOICE_FORWARD_TO = "+19565550777"; }],
  ])("the right PIN while %s: today's path, never an owner pass (review m-4: today's states re-read before the pass)", async (_state, arrange) => {
    db.pin.mockResolvedValue({ status: "ok" });
    arrange();
    const xml = await (await signed({ To: TO, From: CELL, Digits: PIN })).text();
    expect(xml).not.toContain("X-BIS-Owner-Pass");
    expect(db.pin).toHaveBeenCalledTimes(1);
  });

  it("pound from a caller every guard clears: today's cleared bridge, with no owner pass", async () => {
    const xml = await (await signed({ To: TO, From: CELL, Digits: "#" })).text();
    expect(xml).toContain("&amp;f=");
    expect(sipParams(xml).get("X-BIS-Owner-Pass")).toBeNull();
    expect(db.pin).not.toHaveBeenCalled();
  });

  it("the right PIN: the bridge carries an owner pass for THIS person and role, bound to THIS dial's handoff token, and no log carries the digits or the caller", async () => {
    db.pin.mockResolvedValue({ status: "ok" });
    const xml = await (await signed({ To: TO, From: CELL, Digits: PIN })).text();
    const p = sipParams(xml);
    expect(verifyOwnerPass(p.get("X-BIS-Owner-Pass"), p.get("X-BIS-Handoff"), Date.now())).toMatchObject({
      ok: true, accountId: ACCOUNT, userId: USER, role: "staff", calledE164: TO });
    expect(p.get("X-BIS-Signature")).toBeTruthy();
    for (const secret of [PIN, HASH.slice(14), CELL.slice(2)]) expect(logged()).not.toContain(secret);
  });

  it("a Technician keying the right PIN gets today's bridge with no owner pass, and no attempt is made (O-1 = F2)", async () => {
    db.look.mockResolvedValue(hit({ role: "technician" }));
    db.pin.mockResolvedValue({ status: "ok" });
    const xml = await (await signed({ To: TO, From: CELL, Digits: PIN })).text();
    expect(xml).toContain("<Dial answerOnBridge=\"true\"");
    expect(sipParams(xml).get("X-BIS-Owner-Pass")).toBeNull();
    expect(db.pin).not.toHaveBeenCalled();
  });
});
