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
const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks, SlotTakenError: real.SlotTakenError };
});
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }) }));

import type { serviceDb, CalendarRow, VoiceProfileRow } from "@bis/db";
import { runTool, type ToolContext, type ToolName } from "./registry";
import { emptyCallState } from "../call-state";

const ctx: ToolContext = {
  db: {} as unknown as ReturnType<typeof serviceDb>, accountId: "a1", accountName: "Rio Roofing",
  timezone: "America/Chicago",
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true,
    slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
    max_advance_days: 30, open_hours: {}, notify_emails: [] } as unknown as CalendarRow,
  profile: { booking_enabled: true } as unknown as VoiceProfileRow,
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
    await expect(runTool(emptyCallState(), ctx, "nope" as unknown as ToolName, {}))
      .rejects.toThrow(/Unknown tool/);
  });
});

describe("book_appointment", () => {
  const slot = { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") };
  beforeEach(() => {
    computeAllSlotsMock.mockResolvedValue([slot]);
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
    dbMocks.createBooking.mockResolvedValue({ id: "bk1", cancelToken: "tok123" });
    sendMock.mockReset().mockResolvedValue({ providerMessageId: "x" });
  });

  it("books an offered slot, mirrors state, remembers the contact", async () => {
    const { state, result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz" });
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ firstName: "Ana", lastName: "Ruiz", phone: "+19562921696", source: "voice" }),
      "voice", "ai");
    expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
      expect.objectContaining({ calendarId: "cal1", contactId: "ct1" }), "voice", "ai");
    expect(state.bookings[0]).toMatchObject({ id: "bk1", status: "booked" });
    expect(state.contactId).toBe("ct1");
  });

  it("refuses a time that was never offered", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T03:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createBooking).not.toHaveBeenCalled();
  });

  it("refuses when there is no phone and no email", async () => {
    const { result } = await runTool(emptyCallState(), { ...ctx, callerNumber: null },
      "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("maps SlotTakenError to a race answer", async () => {
    const { SlotTakenError } = await import("@bis/db");
    dbMocks.createBooking.mockRejectedValue(new SlotTakenError());
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false, slotTaken: true });
  });

  it("happy email path sends confirmation without failing booking", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "ana@example.com" });
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    expect((result as { emailFailed?: boolean }).emailFailed).toBeUndefined();
    expect(sendMock).toHaveBeenCalledOnce();
    expect(sendMock.mock.calls[0]![0]).toMatchObject({
      to: "ana@example.com",
      fromAddress: undefined,
      subject: "You're booked in",
      body: expect.any(String),
    });
    expect((sendMock.mock.calls[0]![0] as { body?: unknown }).body).toBeTruthy();
  });

  it("send failure never fails the booking", async () => {
    sendMock.mockRejectedValue(new Error("resend down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "ana@example.com" });
    errSpy.mockRestore();
    expect(result).toMatchObject({ ok: true, bookingId: "bk1", emailFailed: true });
  });

  it("SlotTakenError carries the contact", async () => {
    const { SlotTakenError } = await import("@bis/db");
    dbMocks.createBooking.mockRejectedValue(new SlotTakenError());
    const { state, result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana" });
    expect(result).toMatchObject({ ok: false, slotTaken: true });
    expect(state.contactId).toBe("ct1");
  });
});

describe("reschedule / cancel", () => {
  it("reschedule books the new slot BEFORE cancelling the old", async () => {
    const calls: string[] = [];
    computeAllSlotsMock.mockResolvedValue([{ startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }]);
    dbMocks.getBookingById.mockResolvedValue({ id: "old1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.createBooking.mockImplementation(async () => { calls.push("book"); return { id: "new1", cancelToken: "t" }; });
    dbMocks.setBookingStatus.mockImplementation(async () => { calls.push("cancel"); });
    const { state, result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
      { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
    expect(result).toMatchObject({ ok: true, bookingId: "new1" });
    expect(calls).toEqual(["book", "cancel"]);
    expect(state.bookings.find((b) => b.id === "old1")).toBeUndefined(); // replaced, not duplicated
    expect(state.bookings.find((b) => b.id === "new1")).toMatchObject({ status: "booked" });
  });
  it("cancel marks status and mirrors", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "x", status: "booked" });
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "A", startsAt: "x", endsAt: "y", status: "booked" as const }] };
    const { state, result } = await runTool(pre, ctx, "cancel_appointment", { bookingId: "b1" });
    expect(result).toEqual({ ok: true });
    expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice");
    expect(state.bookings[0]!.status).toBe("cancelled");
  });
  it("cancel of an unknown booking is a clean error", async () => {
    dbMocks.getBookingById.mockResolvedValue(null);
    const { result } = await runTool(emptyCallState(), ctx, "cancel_appointment", { bookingId: "ghost" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });
});
