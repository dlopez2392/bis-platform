// apps/web/src/lib/voice/tools/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const computeAllSlotsMock = vi.fn();
vi.mock("@/lib/booking/availability", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, computeAllSlots: (...a: unknown[]) => computeAllSlotsMock(...a) };
});
const dbMocks = vi.hoisted(() => ({
  findUpcomingBookingForPhone: vi.fn(),
  createContact: vi.fn(), createBooking: vi.fn(),
  setBookingStatus: vi.fn(), getBookingById: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, ...dbMocks, SlotTakenError: (real as any).SlotTakenError };
});
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: vi.fn() }) }));

import { runTool, type ToolContext } from "./registry";
import { emptyCallState } from "../call-state";

const ctx: ToolContext = {
  db: {} as any, accountId: "a1", accountName: "Rio Roofing",
  timezone: "America/Chicago",
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true,
    slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
    max_advance_days: 30, open_hours: {}, notify_emails: [] } as any,
  profile: { booking_enabled: true } as any,
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  fromEmail: null, callerNumber: "+19562921696", origin: "https://x.example",
  now: () => new Date("2027-06-01T12:00:00Z"),
};

beforeEach(() => { Object.values(dbMocks).forEach((m) => m.mockReset()); computeAllSlotsMock.mockReset(); });

describe("check_availability", () => {
  it("returns ISO starts for the requested day only, in the account zone", async () => {
    computeAllSlotsMock.mockResolvedValue([
      { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") }, // Jun 1 in Chicago
      { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }, // Jun 2
    ]);
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "2027-06-01" });
    expect(result).toEqual({ slots: ["2027-06-01T14:00:00.000Z"] });
  });
  it("rejects a malformed date without calling the engine", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "tomorrow" });
    expect(result).toMatchObject({ ok: false });
    expect(computeAllSlotsMock).not.toHaveBeenCalled();
  });
});

describe("find_my_booking", () => {
  it("uses caller ID when no phone arg, E.164-normalizes an explicit one", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue({ bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    const r1 = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenCalledWith({}, "a1", "+19562921696", expect.any(String));
    expect(r1.result).toEqual({ found: true, bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    await runTool(emptyCallState(), ctx, "find_my_booking", { phone: "(956) 555-0100" });
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenLastCalledWith({}, "a1", "+19565550100", expect.any(String));
  });
  it("no caller ID and no arg → found:false, no query", async () => {
    const r = await runTool(emptyCallState(), { ...ctx, callerNumber: null }, "find_my_booking", {});
    expect(r.result).toEqual({ found: false });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
  });
});

describe("capture_lead / take_message / log_transcript mutate state only", () => {
  it("capture_lead requires fullName and need", async () => {
    const miss = await runTool(emptyCallState(), ctx, "capture_lead", { fields: { fullName: "Ana" } });
    expect(miss.result).toMatchObject({ ok: false, missing: ["need"] });
    expect(miss.state.leads).toHaveLength(0);
    const ok = await runTool(emptyCallState(), ctx, "capture_lead",
      { fields: { fullName: "Ana", need: "roof quote" } });
    expect(ok.result).toMatchObject({ ok: true });
    expect(ok.state.leads[0]!.fields.need).toBe("roof quote");
  });
  it("take_message defaults callbackNumber to caller ID", async () => {
    const { state, result } = await runTool(emptyCallState(), ctx, "take_message", { body: "call me back" });
    expect(result).toMatchObject({ ok: true });
    expect(state.messages[0]).toMatchObject({ body: "call me back", callbackNumber: "+19562921696" });
  });
  it("log_transcript appends and coerces role", async () => {
    const { state } = await runTool(emptyCallState(), ctx, "log_transcript", { role: "assistant", text: "hi" });
    expect(state.transcript[0]).toMatchObject({ role: "assistant", text: "hi" });
    const { state: s2 } = await runTool(state, ctx, "log_transcript", { role: "weird", text: "x" });
    expect(s2.transcript[1]!.role).toBe("caller");
  });
  it("unknown tool name throws (caller converts to an error result)", async () => {
    await expect(runTool(emptyCallState(), ctx, "nope" as any, {})).rejects.toThrow(/Unknown tool/);
  });
});
