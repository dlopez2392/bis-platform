// S-47e Task 14 (O2): the corpus stub's identity-ladder tools answer EXACTLY what the live tool
// (registry.ts's runTool) answers, on the same inputs — a parity test, not a second guess at the live tool's
// own behavior. @bis/db mocked spread-real with the registry test's own mock list (registry.test.ts:14-35), so
// runTool's module-scope imports resolve without a real database.
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  listContactsOnNumber: vi.fn(), findUpcomingBookingForContact: vi.fn(),
  createContact: vi.fn(), createBooking: vi.fn(),
  setBookingStatus: vi.fn(), getBookingById: vi.fn(),
  fillContactBlanksReport: vi.fn(), getContact: vi.fn(),
  insertAiActs: vi.fn(),
  markHandoffRequested: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(),
  recordLanguageSignal: vi.fn(),
  readEmailSuppression: vi.fn(async () => null),
  serviceDb: vi.fn(() => ({})),
  isAccountOutboundSuppressed: vi.fn(async () => false),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks, SlotTakenError: real.SlotTakenError };
});

import type { serviceDb, CalendarRow, VoiceProfileRow } from "@bis/db";
import { runTool, type ToolContext, type ToolName } from "../tools/registry";
import { emptyCallState } from "../call-state";
import { newStubSession, stubToolResult, STUB_BOOKING, type CorpusFixture, type CorpusItem } from "./corpus-lib";

const FIXTURE: CorpusFixture = {
  businessName: "Salón Prueba", personaName: "Sofía", languages: "both", timezone: "America/Chicago",
  facts: "- x", services: "x", meetingType: "in_person", slotDurationMinutes: 30, afterHours: "hours_then_message",
  callerNumber: "+19565550142", greetingEn: "x", greetingEs: "x",
  contactsOnNumber: [{ firstName: "Ana", lastName: "Prueba" }, { firstName: "Beto", lastName: "Prueba" }],
};
const ITEM: CorpusItem = {
  file: "01-en-id.md", id: "01", lang: "en", medium: "phone", transfer: false, booking: true, disclosure: false,
  callerId: "shown", afterHours: null, facts: "x", caller: ["x"], must: ["x"], mustNot: ["x"],
};

// Mirrors registry.test.ts's own ANA/BETO rows ("S-47e: whose appointment it is"), on the fixture's number.
const ANA = { id: "ct-ana", first_name: "Ana", last_name: "Prueba", phone: FIXTURE.callerNumber, email_key: null, holds_shared_number: false };
const BETO = { id: "ct-beto", first_name: "Beto", last_name: "Prueba", phone: FIXTURE.callerNumber, email_key: null, holds_shared_number: false };

const ctx: ToolContext = {
  db: {} as unknown as ReturnType<typeof serviceDb>, accountId: "a1", timezone: FIXTURE.timezone,
  calendar: { id: "cal1", account_id: "a1", public_id: "pub1", enabled: true,
    slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
    max_advance_days: 30, open_hours: {}, notify_emails: [], meeting_type: "in_person" } as unknown as CalendarRow,
  profile: { booking_enabled: true } as unknown as VoiceProfileRow,
  branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
  fromEmail: null, callerNumber: FIXTURE.callerNumber, origin: "https://x.example",
  callRowId: null, handoffTarget: { available: false, reason: "not-configured" }, tradeModule: "events",
  now: () => new Date("2027-06-01T12:00:00Z"),
};

beforeEach(() => {
  Object.values(dbMocks).forEach((m) => m.mockReset());
  dbMocks.readEmailSuppression.mockResolvedValue(null);
  dbMocks.serviceDb.mockReturnValue({});
  dbMocks.isAccountOutboundSuppressed.mockResolvedValue(false);
  dbMocks.listContactsOnNumber.mockResolvedValue({ rows: [ANA, BETO], truncated: false });
  dbMocks.findUpcomingBookingForContact.mockResolvedValue(STUB_BOOKING);
  // The live getBookingById's row for the fixed booking, contact_id the one Pair 1 confirms (Beto); irrelevant
  // to Pair 3's result, which never reaches a confirmed contact.
  dbMocks.getBookingById.mockResolvedValue({ id: STUB_BOOKING.bookingId, contact_id: BETO.id, calendar_id: "cal1",
    starts_at: STUB_BOOKING.startsAt, ends_at: STUB_BOOKING.startsAt, status: "booked" });
  dbMocks.getContact.mockResolvedValue({ first_name: "Beto", last_name: "Prueba", email: null, phone: FIXTURE.callerNumber });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg1" });
  dbMocks.incrementUnreadCount.mockResolvedValue(undefined);
  dbMocks.setBookingStatus.mockResolvedValue({ updatedAt: "2027-05-31T09:00:00.000Z" });
});

type Step = { name: ToolName; args: Record<string, unknown> };

/** Threads a fresh stub session and a fresh live CallState through the same steps, requiring the stub's
 *  answer to equal runTool's answer at every step. */
async function runBoth(steps: readonly Step[]): Promise<void> {
  const session = newStubSession(FIXTURE, ITEM, "events");
  let state = emptyCallState();
  for (const step of steps) {
    const stubResult = stubToolResult(step.name, step.args, { medium: "phone", timezone: FIXTURE.timezone, session });
    const real = await runTool(state, ctx, step.name, step.args);
    state = real.state;
    expect(stubResult).toEqual(real.result);
  }
}

describe("the corpus stub's identity-ladder tools match runTool's, exactly (S-47e Task 14, O2)", () => {
  it("find_my_booking (ask name) -> miss -> confirm -> find_my_booking (found) -> cancel_appointment (ok)", async () => {
    const steps: Step[] = [
      { name: "find_my_booking", args: {} },
      { name: "confirm_identity", args: { fullName: "Carla Prueba" } },
      { name: "confirm_identity", args: { fullName: "Beto Prueba" } },
      { name: "find_my_booking", args: {} },
      { name: "cancel_appointment", args: { bookingId: STUB_BOOKING.bookingId } },
    ];
    expect(steps).toHaveLength(5);
    await runBoth(steps);
  });

  it("on a fresh pair, take_message asks for a name on a shared number once, then records it", async () => {
    const steps: Step[] = [
      { name: "take_message", args: { body: "Call me" } },
      { name: "take_message", args: { body: "Call me", nameDeclined: true } },
    ];
    expect(steps).toHaveLength(2);
    await runBoth(steps);
  });

  it("on a third fresh pair, reschedule_appointment before any confirmation is NOT CONFIRMED YET on both sides", async () => {
    const steps: Step[] = [
      { name: "reschedule_appointment", args: { bookingId: STUB_BOOKING.bookingId, startsAt: "2027-06-04T15:00:00.000Z" } },
    ];
    expect(steps).toHaveLength(1);
    await runBoth(steps);
  });
});
