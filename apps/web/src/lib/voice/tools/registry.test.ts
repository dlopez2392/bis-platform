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
  fillContactBlanks: vi.fn(), getContact: vi.fn(),
  markHandoffRequested: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(),
}));
const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks, SlotTakenError: real.SlotTakenError };
});
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }) }));
const meetingProviderMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/meetings/provider", () => ({ getMeetingProvider: (...a: unknown[]) => meetingProviderMock(...a) }));

import type { serviceDb, CalendarRow, VoiceProfileRow } from "@bis/db";
import { runTool, type ToolContext, type ToolName } from "./registry";
import { emptyCallState } from "../call-state";

const ctx: ToolContext = {
  db: {} as unknown as ReturnType<typeof serviceDb>, accountId: "a1",
  timezone: "America/Chicago",
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true,
    slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
    max_advance_days: 30, open_hours: {}, notify_emails: [], meeting_type: "in_person" } as unknown as CalendarRow,
  profile: { booking_enabled: true } as unknown as VoiceProfileRow,
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  fromEmail: null, callerNumber: "+19562921696", origin: "https://x.example",
  callRowId: null, handoffTarget: { available: false, reason: "not-configured" },
  now: () => new Date("2027-06-01T12:00:00Z"),
};

// Named for the brief's own shape: `dbMocks` is reset wholesale in the
// beforeEach below, so this alias stays live across tests.
const markHandoffRequestedMock = dbMocks.markHandoffRequested;

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  computeAllSlotsMock.mockReset();
  meetingProviderMock.mockReset().mockReturnValue(null);
});

describe("check_availability", () => {
  // 2026-08-30 live call: the model rescheduled a booking to the caller's
  // asked-for 4 PM, re-read the result's raw ISO with the wrong UTC offset,
  // concluded it had booked the wrong slot, and "corrected" it an hour
  // forward — announcing a time nobody asked for. Tool results therefore
  // carry every time TWICE: `startsAt` (ISO, for tool calls) and a `local`
  // rendering in the business's zone for the model to SAY, so it never does
  // its own timezone math.
  it("returns slots for the requested day with both the ISO start and a spoken local rendering", async () => {
    computeAllSlotsMock.mockResolvedValue([
      { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") }, // Jun 1 in Chicago
      { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }, // Jun 2
    ]);
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "2027-06-01" });
    const slots = (result as { slots: { startsAt: string; local: string }[] }).slots;
    expect(slots).toHaveLength(1);
    expect(slots[0]!.startsAt).toBe("2027-06-01T14:00:00.000Z");
    expect(slots[0]!.local).toContain("9:00 AM");
    expect(slots[0]!.local).toContain("CDT");
  });
  it("local rendering follows ctx.timezone, never the machine zone", async () => {
    // This dev machine IS Central, so the Chicago assertions above cannot
    // discriminate a system-zone mutant — the recorded timezone-test lesson.
    computeAllSlotsMock.mockResolvedValue([
      { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") },
    ]);
    const nyCtx = { ...ctx, timezone: "America/New_York" };
    const { result } = await runTool(emptyCallState(), nyCtx, "check_availability", { date: "2027-06-01" });
    const slots = (result as { slots: { startsAt: string; local: string }[] }).slots;
    expect(slots[0]!.local).toContain("10:00 AM");
    expect(slots[0]!.local).toContain("EDT");
  });
  it("rejects a malformed date without calling the engine", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "check_availability", { date: "tomorrow" });
    expect(result).toMatchObject({ ok: false });
    expect(computeAllSlotsMock).not.toHaveBeenCalled();
  });
});

// Booking tools are bound to the verified caller: caller ID is the only
// identity, and a number the caller recites never finds, reveals, moves or
// cancels anything.
describe("find_my_booking", () => {
  const HIT = { bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" };
  const TARGET = { available: true as const, to: "+19565550199" };

  it("looks up the caller ID and hands back the spoken local time", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(HIT);
    const r1 = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenCalledWith({}, "a1", "+19562921696", expect.any(String));
    expect(r1.result).toMatchObject({ found: true, bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    // Spoken rendering rides along so the model never converts the ISO itself.
    expect((r1.result as { startsAtLocal: string }).startsAtLocal).toContain("9:00 AM");
  });

  it("a recited number that is not the caller ID is refused with no lookup, nothing revealed, nobody served", async () => {
    // The mock WOULD find a booking — a lookup by the recited number would
    // hand its details straight back.
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(HIT);
    const pre = emptyCallState();
    const { state, result } = await runTool(pre, ctx, "find_my_booking", { phone: "(956) 555-0100" });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: false, verified: false });
    expect(result).not.toHaveProperty("bookingId");
    expect(result).not.toHaveProperty("startsAt");
    expect(result).not.toHaveProperty("startsAtLocal");
    expect(String((result as { error?: string }).error)).toMatch(/number they are calling from/);
    expect(state).toBe(pre);
    expect(state.served).toEqual([]);
  });

  it("a garbled recited number is refused the same way — never quietly swapped for caller ID", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(HIT);
    const pre = emptyCallState();
    const { state, result } = await runTool(pre, ctx, "find_my_booking", { phone: "55 01" });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: false, verified: false });
    expect(result).not.toHaveProperty("bookingId");
    expect(state).toBe(pre);
  });

  it("a recited number that IS the caller ID, in another shape, looks up the caller ID and finds it", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(HIT);
    const { state, result } = await runTool(emptyCallState(), ctx, "find_my_booking", { phone: "(956) 292-1696" });
    expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenCalledWith({}, "a1", "+19562921696", expect.any(String));
    expect(result).toMatchObject({ found: true, bookingId: "b9" });
    expect(state.served).toEqual(["booking_found"]);
  });

  it("no caller ID and no arg → no query, verified:false, and an instruction instead of a bare found:false", async () => {
    const pre = emptyCallState();
    const r = await runTool(pre, { ...ctx, callerNumber: null }, "find_my_booking", {});
    expect(r.result).toMatchObject({ found: false, verified: false, error: expect.any(String) });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
    expect(r.state).toBe(pre);
  });

  it("no caller ID and a recited number → still no query: a withheld call can look nothing up", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(HIT);
    const pre = emptyCallState();
    const { state, result } = await runTool(pre, { ...ctx, callerNumber: null }, "find_my_booking",
      { phone: "(956) 292-1696" });
    expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: false, verified: false });
    expect(result).not.toHaveProperty("bookingId");
    expect(state).toBe(pre);
  });

  it("a refusal offers the transfer only when there is somewhere to transfer to, else a message", async () => {
    const withTarget = await runTool(emptyCallState(),
      { ...ctx, callerNumber: null, handoffTarget: TARGET }, "find_my_booking", {});
    const errWith = String((withTarget.result as { error?: string }).error);
    expect(errWith).toMatch(/transfer_to_human/);
    expect(errWith).not.toMatch(/take_message/);
    const without = await runTool(emptyCallState(), { ...ctx, callerNumber: null }, "find_my_booking", {});
    const errWithout = String((without.result as { error?: string }).error);
    expect(errWithout).toMatch(/take_message/);
    expect(errWithout).not.toMatch(/transfer_to_human/);
  });
  // A caller who rings in only to check their own appointment time changes
  // nothing in the database, so the call classifies `abandoned` -- and was
  // therefore getting an automatic "Sorry we missed you just now" text for a
  // call that went perfectly. This flag is what the text-back gate reads.
  it("a lookup that FOUND the booking marks the caller served", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue({ bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" });
    const { state } = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(state.served).toEqual(["booking_found"]);
  });
  it("a lookup that found NOTHING does not - that caller left empty-handed", async () => {
    dbMocks.findUpcomingBookingForPhone.mockResolvedValue(null);
    const { state } = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(state.served).toEqual([]);
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
    dbMocks.fillContactBlanks.mockResolvedValue([]);
    sendMock.mockReset().mockResolvedValue({ providerMessageId: "x" });
  });

  it("refuses to book when email was neither given nor explicitly declined", async () => {
    // 2026-08-28: THREE real calls booked without the email offer ever being
    // made â€” two differently-structured prompts failed identically. The
    // model reliably obeys tool RESULTS, so the ask is enforced here: no
    // email and no emailDeclined attestation = not booked, instructive error.
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz" });
    expect(result).toMatchObject({ ok: false });
    expect(String((result as { error?: string }).error)).toMatch(/email confirmation/);
    expect(dbMocks.createBooking).not.toHaveBeenCalled();
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("books phone-only once the model attests the caller declined email", async () => {
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    // Same anti-conversion contract as check_availability's `local`.
    expect((result as { startsAtLocal: string }).startsAtLocal).toContain("9:00 AM");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("books an offered slot, mirrors state, remembers the contact", async () => {
    const { state, result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
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
      { startsAt: "2027-06-01T03:00:00.000Z", name: "Ana", emailDeclined: true });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createBooking).not.toHaveBeenCalled();
  });

  it("refuses when there is no phone and no email", async () => {
    const { result } = await runTool(emptyCallState(), { ...ctx, callerNumber: null },
      "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana", emailDeclined: true });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.createContact).not.toHaveBeenCalled();
  });

  it("maps SlotTakenError to a race answer", async () => {
    const { SlotTakenError } = await import("@bis/db");
    dbMocks.createBooking.mockRejectedValue(new SlotTakenError());
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana", emailDeclined: true });
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
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana", emailDeclined: true });
    expect(result).toMatchObject({ ok: false, slotTaken: true });
    expect(state.contactId).toBe("ct1");
  });

  it("dedupe onto an existing contact backfills blanks with the split name + email + phone", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: true });
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "ana@example.com" });
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    expect(dbMocks.fillContactBlanks).toHaveBeenCalledWith({}, "a1", "ct1",
      { firstName: "Ana", lastName: "Ruiz", email: "ana@example.com", phone: "+19562921696" },
      "voice", "ai");
  });

  it("never-break pin: fillContactBlanks rejecting still yields a successful booking", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: true });
    dbMocks.fillContactBlanks.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    errSpy.mockRestore();
    expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
    // Pins the call site itself, not just the outcome â€” without this, deleting
    // the fillContactBlanks call entirely would leave this test green.
    expect(dbMocks.fillContactBlanks).toHaveBeenCalled();
  });

  it("a brand-new contact never calls fillContactBlanks", async () => {
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
    await runTool(emptyCallState(), ctx, "book_appointment",
      { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    expect(dbMocks.fillContactBlanks).not.toHaveBeenCalled();
  });

  describe("video calendars", () => {
    const videoCtx: ToolContext = {
      ...ctx,
      calendar: { ...ctx.calendar, meeting_type: "video" } as unknown as CalendarRow,
    };

    it("refuses emailDeclined:true on a video calendar — an email is required for the link", async () => {
      const { result } = await runTool(emptyCallState(), videoCtx, "book_appointment",
        { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
      expect(result).toMatchObject({ ok: false });
      expect(String((result as { error?: string }).error)).toMatch(/video appointment.*email/i);
      expect(dbMocks.createBooking).not.toHaveBeenCalled();
    });

    it("refuses a video booking whose email fails shape validation, telling the model to re-confirm it", async () => {
      const { result } = await runTool(emptyCallState(), videoCtx, "book_appointment",
        { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "no" });
      expect(result).toMatchObject({ ok: false });
      expect(String((result as { error?: string }).error)).toMatch(/character by character/i);
      expect(dbMocks.createBooking).not.toHaveBeenCalled();
      expect(meetingProviderMock).not.toHaveBeenCalled();
    });

    it("books, mints a room, and puts the url in the confirmation email when a real email is given", async () => {
      meetingProviderMock.mockReturnValue({
        createMeetingRoom: vi.fn().mockResolvedValue({ url: "https://video.example/room1" }),
      });
      const { result } = await runTool(emptyCallState(), videoCtx, "book_appointment",
        { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "ana@example.com" });
      expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
      expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
        expect.objectContaining({ meetingUrl: "https://video.example/room1" }), "voice", "ai");
      expect(sendMock).toHaveBeenCalledOnce();
      expect((sendMock.mock.calls[0]![0] as { html?: string }).html).toContain("https://video.example/room1");
    });

    it("never-fail pin: a throwing provider still books, just without a url", async () => {
      meetingProviderMock.mockReturnValue({
        createMeetingRoom: vi.fn().mockRejectedValue(new Error("daily down")),
      });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = await runTool(emptyCallState(), videoCtx, "book_appointment",
        { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", email: "ana@example.com" });
      // Never logs the url on failure — there isn't one — and never logs one
      // on success either (see registry.ts); only asserted here for the
      // failure path since that's the branch this test exercises.
      const loggedUrl = errSpy.mock.calls.some((c) => String(c[0] ?? "").includes("https://"));
      errSpy.mockRestore();
      expect(loggedUrl).toBe(false);
      expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
      expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
        expect.objectContaining({ meetingUrl: undefined }), "voice", "ai");
    });

    it("regression pin: non-video calendars still book on emailDeclined:true as before", async () => {
      const { result } = await runTool(emptyCallState(), ctx, "book_appointment",
        { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
      expect(result).toMatchObject({ ok: true, bookingId: "bk1" });
      expect(meetingProviderMock).not.toHaveBeenCalled();
    });
  });
});

describe("reschedule / cancel", () => {
  // Every fixture here OWNS the booking it changes: the contact's phone is
  // the caller ID. The ownership rule itself is pinned in "bound to the
  // verified caller" below.
  const OWNER = { id: "ct1", first_name: "Ana", last_name: "Ruiz", email: null, phone: "+19562921696" };
  beforeEach(() => {
    dbMocks.getContact.mockResolvedValue(OWNER);
    dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: false });
    dbMocks.createMessage.mockResolvedValue({ id: "msg1" });
    dbMocks.incrementUnreadCount.mockResolvedValue(undefined);
    sendMock.mockReset().mockResolvedValue({ providerMessageId: "x" });
  });

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
    // The 2026-08-30 double-reschedule: the model re-read the result's raw
    // ISO with the wrong offset and "fixed" a correct booking an hour
    // forward. The result now hands it the spoken time directly.
    expect((result as { startsAtLocal: string }).startsAtLocal).toContain("9:00 AM");
    expect(calls).toEqual(["book", "cancel"]);
    // The AI did this, not a signed-in user.
    expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "old1", "cancelled", "voice", "ai");
    expect(state.bookings.find((b) => b.id === "old1")).toBeUndefined(); // replaced, not duplicated
    expect(state.bookings.find((b) => b.id === "new1")).toMatchObject({ status: "booked" });
    expect(state.served).toEqual(["rescheduled"]);
  });
  it("cancel marks status and mirrors", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "x", status: "booked" });
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "A", startsAt: "x", endsAt: "y", status: "booked" as const }] };
    const { state, result } = await runTool(pre, ctx, "cancel_appointment", { bookingId: "b1" });
    expect(result).toEqual({ ok: true });
    expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice", "ai");
    expect(state.bookings[0]!.status).toBe("cancelled");
    expect(state.served).toEqual(["cancelled"]);
  });
  /**
   * THE case behind the served flag: the booking was made on an earlier call,
   * so `state.bookings` is empty and `withBookingCancelled` maps over nothing.
   * Without the flag this call ends with no booking, no lead and no message --
   * `abandoned` -- and the missed-call text-back apologises by SMS for a call
   * in which we did exactly what the caller rang up for.
   */
  it("cancelling a booking made on a PREVIOUS call still marks the caller served", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "x", status: "booked" });
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    const { state } = await runTool(emptyCallState(), ctx, "cancel_appointment", { bookingId: "b1" });
    expect(state.bookings).toEqual([]);
    expect(state.served).toEqual(["cancelled"]);
  });
  it("cancel of an unknown booking is a clean error", async () => {
    dbMocks.getBookingById.mockResolvedValue(null);
    const { state, result } = await runTool(emptyCallState(), ctx, "cancel_appointment", { bookingId: "ghost" });
    expect(result).toMatchObject({ ok: false });
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
    // Nothing was cancelled, so nobody was served.
    expect(state.served).toEqual([]);
  });

  it("in_person reschedule never touches the meeting provider", async () => {
    computeAllSlotsMock.mockResolvedValue([{ startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") }]);
    dbMocks.getBookingById.mockResolvedValue({ id: "old1", contact_id: "ct1", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.createBooking.mockResolvedValue({ id: "new1", cancelToken: "t" });
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    await runTool(emptyCallState(), ctx, "reschedule_appointment",
      { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
    expect(meetingProviderMock).not.toHaveBeenCalled();
  });

  describe("video reschedule", () => {
    const videoCtx: ToolContext = {
      ...ctx,
      calendar: { ...ctx.calendar, meeting_type: "video" } as unknown as CalendarRow,
    };
    // Deliberately a DIFFERENT slot than the old booking's — the old row's
    // room expires at the OLD endsAt+1h, so a mutant that reused the old
    // row's ends_at (or its url) instead of minting a fresh one would fail
    // the "called with the NEW endsAt" assertion below.
    const oldEndsAt = new Date("2027-06-01T15:00:00Z");
    const newSlot = { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:30:00Z") };

    beforeEach(() => {
      computeAllSlotsMock.mockResolvedValue([newSlot]);
      dbMocks.getBookingById.mockResolvedValue({
        id: "old1", contact_id: "ct1", calendar_id: "cal1",
        starts_at: "2027-06-01T14:00:00Z", ends_at: oldEndsAt.toISOString(),
        status: "booked", meeting_url: "https://video.example/OLD-room",
      });
      dbMocks.createBooking.mockResolvedValue({ id: "new1", cancelToken: "t" });
      dbMocks.setBookingStatus.mockResolvedValue(undefined);
    });

    it("mints a NEW room sized to the NEW slot's endsAt and passes its url into the new booking", async () => {
      const createMeetingRoom = vi.fn().mockResolvedValue({ url: "https://video.example/new-room" });
      meetingProviderMock.mockReturnValue({ createMeetingRoom });

      const { result } = await runTool(emptyCallState(), videoCtx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });

      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(createMeetingRoom).toHaveBeenCalledWith(
        expect.objectContaining({ endsAt: newSlot.endsAt }));
      // Never the old row's ends_at, and never the old row's url copied forward.
      expect(createMeetingRoom).not.toHaveBeenCalledWith(
        expect.objectContaining({ endsAt: oldEndsAt }));
      expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
        expect.objectContaining({ meetingUrl: "https://video.example/new-room" }), "voice", "ai");
    });

    it("never-fail pin: a throwing provider still reschedules, just without a url, and never logs one", async () => {
      const createMeetingRoom = vi.fn().mockRejectedValue(new Error("daily down"));
      meetingProviderMock.mockReturnValue({ createMeetingRoom });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { result } = await runTool(emptyCallState(), videoCtx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });

      const loggedUrl = errSpy.mock.calls.some((c) => String(c[0] ?? "").includes("https://"));
      errSpy.mockRestore();
      expect(loggedUrl).toBe(false);
      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(dbMocks.createBooking).toHaveBeenCalledWith({}, "a1",
        expect.objectContaining({ meetingUrl: undefined }), "voice", "ai");
    });
  });

  // 2026-08-29 (final-review Important): a reschedule minted a new room but
  // sent NOTHING — a same-day video reschedule left the customer holding the
  // OLD confirmation's expired link, with the new one existing nowhere a
  // customer could see it.
  describe("reschedule confirmation email", () => {
    const newSlot = { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") };
    beforeEach(() => {
      computeAllSlotsMock.mockResolvedValue([newSlot]);
      dbMocks.getBookingById.mockResolvedValue({ id: "old1", contact_id: "ct1", calendar_id: "cal1",
        starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
      dbMocks.createBooking.mockResolvedValue({ id: "new1", cancelToken: "newtok99" });
      dbMocks.setBookingStatus.mockResolvedValue(undefined);
      dbMocks.getContact.mockResolvedValue({
        id: "ct1", first_name: "Ana", last_name: "Ruiz", email: "ana@example.com", phone: "+19562921696",
      });
      sendMock.mockReset().mockResolvedValue({ providerMessageId: "x" });
    });

    it("sends the contact ONE email carrying the new time and the NEW booking's cancel link", async () => {
      const { result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(result).not.toHaveProperty("emailFailed");
      expect(sendMock).toHaveBeenCalledTimes(1);
      const sent = sendMock.mock.calls[0]![0] as { to: string; html?: string; body: string };
      expect(sent.to).toBe("ana@example.com");
      // The NEW row's token — the old confirmation's cancel link now points
      // at a cancelled booking, so mailing the old token again is useless.
      expect(sent.html).toContain("https://x.example/b/pub1/cancel/newtok99");
      expect(sent.body).toContain("https://x.example/b/pub1/cancel/newtok99");
    });

    it("a contact with no email on file gets no send and raises no flag", async () => {
      dbMocks.getContact.mockResolvedValue({
        id: "ct1", first_name: "Ana", last_name: "Ruiz", email: null, phone: "+19562921696",
      });
      const { result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(result).not.toHaveProperty("emailFailed");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("a video reschedule's email carries the NEW room url", async () => {
      const videoCtx: ToolContext = {
        ...ctx, calendar: { ...ctx.calendar, meeting_type: "video" } as unknown as CalendarRow,
      };
      meetingProviderMock.mockReturnValue({
        createMeetingRoom: vi.fn().mockResolvedValue({ url: "https://video.example/new-room" }),
      });
      await runTool(emptyCallState(), videoCtx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
      expect(sendMock).toHaveBeenCalledTimes(1);
      const sent = sendMock.mock.calls[0]![0] as { html?: string; body: string };
      expect(sent.html).toContain("https://video.example/new-room");
      expect(sent.body).toContain("https://video.example/new-room");
    });

    it("a throwing send never fails the committed reschedule — soft emailFailed flag, like book_appointment", async () => {
      sendMock.mockRejectedValue(new Error("smtp down"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
      errSpy.mockRestore();
      expect(result).toMatchObject({ ok: true, bookingId: "new1", emailFailed: true });
    });

    // The contact is what proves the booking is this caller's, so it is read
    // BEFORE anything changes — and a read that fails leaves nothing changed
    // (it used to be read after the commit and only soft-flag the email).
    it("a throwing contact lookup REFUSES the reschedule and writes nothing", async () => {
      dbMocks.getContact.mockRejectedValue(new Error("db blip"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, ctx, "reschedule_appointment",
        { bookingId: "old1", startsAt: "2027-06-02T14:00:00.000Z" });
      const logs = errSpy.mock.calls.map((c) => String(c[0] ?? ""));
      errSpy.mockRestore();
      expect(result).toMatchObject({ ok: false, error: expect.any(String) });
      expect(result).not.toHaveProperty("bookingId");
      expect(state).toBe(pre);
      expect(dbMocks.createBooking).not.toHaveBeenCalled();
      expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
      expect(computeAllSlotsMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      // Logged by booking id, never by the caller's number.
      expect(logs.some((l) => l.includes("old1"))).toBe(true);
      expect(logs.some((l) => l.includes("+19562921696") || l.includes("9562921696"))).toBe(false);
    });
  });

  // Booking tools are bound to the verified caller. A booking may be moved or
  // cancelled only when it was made on THIS call, or when its contact's phone
  // is the caller ID. Everything a refusal must not do is asserted against a
  // context where doing it would be observable: a video calendar (so a room
  // would be minted), notify emails set and a contact email on file (so mail
  // would go out).
  describe("bound to the verified caller", () => {
    const newSlot = { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") };
    const NEW_ISO = "2027-06-02T14:00:00.000Z";
    const ROW = { id: "b1", contact_id: "ct2", calendar_id: "cal1",
      starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" };
    const SOMEONE_ELSE = { id: "ct2", first_name: "Bea", last_name: "Lopez",
      email: "bea@example.com", phone: "+19565550100" };
    const watchedCtx: ToolContext = {
      ...ctx,
      calendar: { ...ctx.calendar, meeting_type: "video", notify_emails: ["owner@biz.example"] } as unknown as CalendarRow,
    };
    const withheld: ToolContext = { ...watchedCtx, callerNumber: null };
    let createMeetingRoom: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      computeAllSlotsMock.mockResolvedValue([newSlot]);
      dbMocks.getBookingById.mockResolvedValue(ROW);
      dbMocks.createBooking.mockResolvedValue({ id: "new1", cancelToken: "t" });
      dbMocks.setBookingStatus.mockResolvedValue(undefined);
      createMeetingRoom = vi.fn().mockResolvedValue({ url: "https://video.example/r" });
      meetingProviderMock.mockReturnValue({ createMeetingRoom });
    });

    function expectNothingWritten() {
      expect(dbMocks.createBooking).not.toHaveBeenCalled();
      expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
      expect(computeAllSlotsMock).not.toHaveBeenCalled();
      expect(meetingProviderMock).not.toHaveBeenCalled();
      expect(createMeetingRoom).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
      expect(dbMocks.createMessage).not.toHaveBeenCalled();
      expect(dbMocks.incrementUnreadCount).not.toHaveBeenCalled();
    }

    it("refuses to reschedule a booking under a different number — no slot lookup, room, booking, cancel or mail", async () => {
      dbMocks.getContact.mockResolvedValue(SOMEONE_ELSE);
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, watchedCtx, "reschedule_appointment",
        { bookingId: "b1", startsAt: NEW_ISO });
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/isn't under the number they're calling from/) });
      expect(String((result as { error: string }).error)).toMatch(/do not share/i);
      expect(state).toBe(pre);
      expectNothingWritten();
    });

    it("refuses to cancel a booking under a different number — nothing cancelled, nothing sent", async () => {
      dbMocks.getContact.mockResolvedValue(SOMEONE_ELSE);
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, watchedCtx, "cancel_appointment", { bookingId: "b1" });
      expect(result).toEqual({ ok: false, error: expect.stringMatching(/isn't under the number they're calling from/) });
      expect(state).toBe(pre);
      expect(state.served).toEqual([]);
      expectNothingWritten();
    });

    it("the stored phone is compared as E.164: \"(956) 292-1696\" on file matches caller ID +19562921696 — cancel", async () => {
      dbMocks.getContact.mockResolvedValue({ ...SOMEONE_ELSE, phone: "(956) 292-1696" });
      const { result } = await runTool(emptyCallState(), ctx, "cancel_appointment", { bookingId: "b1" });
      expect(result).toEqual({ ok: true });
      expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice", "ai");
    });

    it("the stored phone is compared as E.164: \"(956) 292-1696\" on file matches caller ID +19562921696 — reschedule", async () => {
      dbMocks.getContact.mockResolvedValue({ ...SOMEONE_ELSE, phone: "(956) 292-1696" });
      const { result } = await runTool(emptyCallState(), ctx, "reschedule_appointment",
        { bookingId: "b1", startsAt: NEW_ISO });
      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(dbMocks.createBooking).toHaveBeenCalled();
      expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice", "ai");
    });

    it("withheld caller ID: a booking NOT made on this call cannot be cancelled", async () => {
      // The contact's phone is the very number that would have matched, had
      // the call shown one: with no caller ID there is nothing to match.
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, withheld, "cancel_appointment", { bookingId: "b1" });
      expect(result).toMatchObject({ ok: false });
      expect(state).toBe(pre);
      expectNothingWritten();
    });

    it("withheld caller ID: a booking NOT made on this call cannot be rescheduled", async () => {
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, withheld, "reschedule_appointment",
        { bookingId: "b1", startsAt: NEW_ISO });
      expect(result).toMatchObject({ ok: false });
      expect(state).toBe(pre);
      expectNothingWritten();
    });

    it("withheld caller ID and a contact with NO phone on file: an absent number never matches an absent number", async () => {
      dbMocks.getContact.mockResolvedValue({ ...SOMEONE_ELSE, phone: null });
      const { result } = await runTool(emptyCallState(), withheld, "cancel_appointment", { bookingId: "b1" });
      expect(result).toMatchObject({ ok: false });
      expectNothingWritten();
    });

    it("withheld caller ID: a booking made on THIS call can still be cancelled", async () => {
      dbMocks.getContact.mockResolvedValue({ ...SOMEONE_ELSE, phone: null });
      const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "Bea", startsAt: ROW.starts_at,
        endsAt: ROW.ends_at, status: "booked" as const }] };
      const { state, result } = await runTool(pre, withheld, "cancel_appointment", { bookingId: "b1" });
      expect(result).toEqual({ ok: true });
      expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "a1", "b1", "cancelled", "voice", "ai");
      expect(state.bookings[0]!.status).toBe("cancelled");
    });

    it("withheld caller ID: \"actually, make that 3 PM\" still works for a booking made on THIS call", async () => {
      dbMocks.getContact.mockResolvedValue({ ...SOMEONE_ELSE, phone: null });
      const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "Bea", startsAt: ROW.starts_at,
        endsAt: ROW.ends_at, status: "booked" as const }] };
      const { state, result } = await runTool(pre, { ...ctx, callerNumber: null }, "reschedule_appointment",
        { bookingId: "b1", startsAt: NEW_ISO });
      expect(result).toMatchObject({ ok: true, bookingId: "new1" });
      expect(state.bookings.map((b) => b.id)).toEqual(["new1"]);
    });

    it("a throwing contact lookup REFUSES the cancel and writes nothing", async () => {
      dbMocks.getContact.mockRejectedValue(new Error("db blip"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pre = emptyCallState();
      const { state, result } = await runTool(pre, watchedCtx, "cancel_appointment", { bookingId: "b1" });
      const logs = errSpy.mock.calls.map((c) => String(c[0] ?? ""));
      errSpy.mockRestore();
      expect(result).toMatchObject({ ok: false, error: expect.any(String) });
      expect(state).toBe(pre);
      expectNothingWritten();
      expect(logs.some((l) => l.includes("b1"))).toBe(true);
      expect(logs.some((l) => l.includes("9562921696"))).toBe(false);
    });

    it("a throwing contact lookup refuses even a booking made on this call — the one read is the gate", async () => {
      dbMocks.getContact.mockRejectedValue(new Error("db blip"));
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pre = { ...emptyCallState(), bookings: [{ id: "b1", contactName: "Bea", startsAt: ROW.starts_at,
        endsAt: ROW.ends_at, status: "booked" as const }] };
      const { state, result } = await runTool(pre, watchedCtx, "cancel_appointment", { bookingId: "b1" });
      errSpy.mockRestore();
      expect(result).toMatchObject({ ok: false });
      expect(state).toBe(pre);
      expectNothingWritten();
    });
  });
});

/**
 * The handoff tool. Its whole job is to make the caller's request DURABLE
 * before the model is told it worked: the socket closes moments later and
 * Telnyx's request to the Dial action URL races `finishCall`, so anything
 * held only in memory can be gone by the time the action route looks.
 */
describe("transfer_to_human", () => {
  const TARGET = { available: true as const, to: "+19562921696" };

  it("transfer_to_human persists the intent BEFORE returning — finishCall is too late", async () => {
    // Telnyx requests the Dial action URL the moment the SIP leg ends, racing
    // finishCall's database writes. If the intent were written by finishCall,
    // the action route would sometimes see no transfer and hang up on a caller
    // who had just been told they were being put through.
    //
    // The gate below is what makes "BEFORE returning" testable: an
    // implementation that CALLS markHandoffRequested without awaiting it would
    // satisfy every assertion at the bottom of this test, so the tool's
    // promise is checked for still being pending while the write is in flight.
    let release!: () => void;
    const writeInFlight = new Promise<void>((resolve) => { release = resolve; });
    markHandoffRequestedMock.mockImplementation(() => writeInFlight);

    const c = { ...ctx, callRowId: "call-row-1", handoffTarget: TARGET };
    const pending = runTool(emptyCallState(), c, "transfer_to_human", {});
    let returned = false;
    void pending.then(() => { returned = true; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(returned).toBe(false);

    release();
    const { state, result } = await pending;
    expect(markHandoffRequestedMock).toHaveBeenCalledWith(expect.anything(), c.accountId, "call-row-1");
    expect(result).toEqual({ ok: true });
    expect(state.served).toContain("transferred");
  });

  it("transfer_to_human refuses when no target is available, and writes nothing", async () => {
    const c = { ...ctx, callRowId: "call-row-1", handoffTarget: { available: false as const, reason: "not-configured" as const } };
    const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(markHandoffRequestedMock).not.toHaveBeenCalled();
    expect(state.served).not.toContain("transferred");
  });

  it("transfer_to_human refuses when there is no call row to mark", async () => {
    // startCallRow fails open (the route's step 10), so callRowId can be null on
    // a real call. Transferring then would be unrecoverable: the action route
    // has nothing to find.
    const c = { ...ctx, callRowId: null, handoffTarget: TARGET };
    const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(markHandoffRequestedMock).not.toHaveBeenCalled();
    expect(state.served).not.toContain("transferred");
  });

  it("a database failure while marking does NOT report success to the model", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    markHandoffRequestedMock.mockRejectedValueOnce(new Error("boom"));
    const c = { ...ctx, callRowId: "call-row-1", handoffTarget: TARGET };
    const { state, result } = await runTool(emptyCallState(), c, "transfer_to_human", {});
    errSpy.mockRestore();
    expect(result).toEqual({ ok: false, error: expect.any(String) });
    expect(state.served).not.toContain("transferred");
  });
});
