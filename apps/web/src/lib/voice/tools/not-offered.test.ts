// apps/web/src/lib/voice/tools/not-offered.test.ts
// F-023 PR 2 (plan §3.3): a model that calls a tool its session was not given hears EXACTLY the words it heard before
// the belt, and nothing is read or written. The sentences below were copied from registry.ts on belt/core (fdbc7ef2):
// the two mode refusals (registry.ts:319-326) and transfer_to_human's own refusal (registry.ts:979-982). This file was
// green on that code before runTool's entry moved onto the belt's guard, and it stays green after.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Every @bis/db helper a handler could reach first. Any call is a read or a write the refusal should have prevented.
const dbMocks = vi.hoisted(() => ({
  listContactsOnNumber: vi.fn(), findUpcomingBookingForContact: vi.fn(), createContact: vi.fn(), createBooking: vi.fn(),
  setBookingStatus: vi.fn(), getBookingById: vi.fn(), moveBooking: vi.fn(), fillContactBlanksReport: vi.fn(),
  getContact: vi.fn(), insertAiActs: vi.fn(), markHandoffRequested: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), incrementUnreadCount: vi.fn(), recordLanguageSignal: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return { ...real, ...dbMocks };
});

import type { serviceDb, CalendarRow, VoiceProfileRow } from "@bis/db";
import { runTool, type ToolContext, type ToolName } from "./registry";
import { toolSchemas } from "./schemas";
import { emptyCallState } from "../call-state";
import type { BookingMode } from "../booking-mode";

// The fake database: ANY property read on it (db.from, db.rpc, …) is recorded, then fails loudly.
const touched: string[] = [];
const db = new Proxy({}, {
  get: (_t, p) => { touched.push(String(p)); throw new Error(`db.${String(p)} touched`); },
}) as unknown as ReturnType<typeof serviceDb>;

const PROFILE: Record<BookingMode, { booking_enabled: boolean; after_hours: "hours_then_message" | "message_only" }> = {
  full: { booking_enabled: true, after_hours: "hours_then_message" },
  manage: { booking_enabled: true, after_hours: "message_only" },
  none: { booking_enabled: false, after_hours: "hours_then_message" },
};
const MODES = ["full", "manage", "none"] as const;
const MEETING_TYPES = ["in_person", "phone", "video"] as const;

function ctxFor(mode: BookingMode, meetingType: (typeof MEETING_TYPES)[number], handoff: boolean): ToolContext {
  return {
    db, accountId: "a1", timezone: "America/Chicago",
    calendar: { id: "cal1", account_id: "a1", meeting_type: meetingType, slot_duration_minutes: 60 } as unknown as CalendarRow,
    profile: PROFILE[mode] as unknown as VoiceProfileRow,
    branding: { brandName: null, brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, callerNumber: "+19565550196", origin: "https://x.example",
    callRowId: "call-row-1",
    handoffTarget: handoff ? { available: true, to: "+19565550199" } : { available: false, reason: "not-configured" },
    tradeModule: null, now: () => new Date("2027-06-01T12:00:00Z"),
  };
}

// Arguments that would get each handler past its own argument checks, so only the guard can stop it.
const ARGS: Record<ToolName, Record<string, unknown>> = {
  check_availability: { date: "2027-06-02" },
  book_appointment: { startsAt: "2027-06-02T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true },
  reschedule_appointment: { bookingId: "b9", startsAt: "2027-06-02T15:00:00.000Z" },
  cancel_appointment: { bookingId: "b9" },
  find_my_booking: {},
  confirm_identity: { fullName: "Ana Ruiz" },
  capture_lead: { fields: { fullName: "Ana Ruiz", need: "A quote" } },
  take_message: { body: "Please call me back" },
  log_transcript: { role: "caller", text: "hi" },
  transfer_to_human: {},
};
const CATALOGUE = Object.keys(ARGS) as ToolName[];

// Today's words, verbatim.
const NO_NEW_BOOKING = "New appointments can't be booked on this line. Take a message with take_message instead, so the team can call them back to set it up.";
const NO_BOOKING_WITH_HANDOFF = "Appointments can't be looked up or changed on this line. Apologize, then offer to put them through to someone on the team with transfer_to_human so the team can help.";
const NO_BOOKING_NO_HANDOFF = "Appointments can't be looked up or changed on this line. Apologize, then offer to take a message with take_message so the team can help.";
const NO_TRANSFER_TARGET = "There's no one available to transfer to on this line. Apologize, then offer to take a message.";
const MANAGE_TOOLS = ["check_availability", "find_my_booking", "confirm_identity", "reschedule_appointment", "cancel_appointment"] as const;

beforeEach(() => {
  touched.length = 0;
  for (const m of Object.values(dbMocks)) m.mockReset().mockRejectedValue(new Error("db helper called"));
});

async function refused(c: ToolContext, name: ToolName) {
  const pre = emptyCallState();
  const { state, result } = await runTool(pre, c, name, ARGS[name]);
  expect(state, `${name}: state untouched`).toBe(pre);
  for (const [k, m] of Object.entries(dbMocks)) expect(m, `${name}: ${k} not called`).not.toHaveBeenCalled();
  expect(touched, `${name}: the database was not touched`).toEqual([]);
  return result;
}

describe("a tool the session was not given is refused in today's words, with nothing read or written", () => {
  it.each(["in_person", "phone", "video"] as const)("book_appointment under 'Always take a message' (%s calendar)", async (mt) => {
    for (const handoff of [true, false]) {
      expect(await refused(ctxFor("manage", mt, handoff), "book_appointment")).toEqual({ ok: false, error: NO_NEW_BOOKING });
    }
  });

  it.each(["in_person", "phone", "video"] as const)("book_appointment with booking off (%s calendar): the new-booking words, not the lookup words", async (mt) => {
    for (const handoff of [true, false]) {
      expect(await refused(ctxFor("none", mt, handoff), "book_appointment")).toEqual({ ok: false, error: NO_NEW_BOOKING });
    }
  });

  it.each([...MANAGE_TOOLS])("%s with booking off offers a person when the call has one", async (name) => {
    for (const mt of MEETING_TYPES) {
      expect(await refused(ctxFor("none", mt, true), name)).toEqual({ ok: false, error: NO_BOOKING_WITH_HANDOFF });
    }
  });

  it.each([...MANAGE_TOOLS])("%s with booking off offers a message when the call has no one to send them to", async (name) => {
    for (const mt of MEETING_TYPES) {
      expect(await refused(ctxFor("none", mt, false), name)).toEqual({ ok: false, error: NO_BOOKING_NO_HANDOFF });
    }
  });

  it.each([...MODES])("transfer_to_human with no handoff target (%s)", async (mode) => {
    for (const mt of MEETING_TYPES) {
      expect(await refused(ctxFor(mode, mt, false), "transfer_to_human")).toEqual({ ok: false, error: NO_TRANSFER_TARGET });
    }
  });

  it("every name toolSchemas leaves off a session, in every mode × meeting type × handoff, is one of the refusals above", async () => {
    let refusals = 0;
    for (const mode of MODES) {
      for (const mt of MEETING_TYPES) {
        for (const handoff of [true, false]) {
          const offered = new Set<string>(toolSchemas(mode, mt, handoff).map((t) => t.name));
          for (const name of CATALOGUE.filter((n) => !offered.has(n))) {
            const want = name === "book_appointment" ? NO_NEW_BOOKING
              : name === "transfer_to_human" ? NO_TRANSFER_TARGET
              : handoff ? NO_BOOKING_WITH_HANDOFF : NO_BOOKING_NO_HANDOFF;
            expect(await refused(ctxFor(mode, mt, handoff), name), `${mode}|${mt}|${handoff} ${name}`).toEqual({ ok: false, error: want });
            refusals++;
          }
        }
      }
    }
    // book_appointment in manage and none (12) + the five lookup tools in none (30) + transfer with no target (9).
    expect(refusals).toBe(51);
  });
});

describe("a tool the session WAS given is never refused by the guard", () => {
  it("capture_lead, take_message and log_transcript run with booking off and no handoff target (mutation: offered = [] -> FAILS)", async () => {
    const c = ctxFor("none", "in_person", false);
    const pre = emptyCallState();
    const logged = await runTool(pre, c, "log_transcript", ARGS.log_transcript);
    expect(logged.state.transcript).toEqual([expect.objectContaining({ role: "caller", text: "hi" })]);
    expect(logged.state).not.toBe(pre);
  });

  it("transfer_to_human with a target reaches its own case: it writes the intent (mutation: offered = toolSchemas without handoff -> FAILS)", async () => {
    dbMocks.markHandoffRequested.mockReset().mockResolvedValue(undefined);
    const { result } = await runTool(emptyCallState(), ctxFor("none", "phone", true), "transfer_to_human", {});
    expect(result).toEqual({ ok: true });
    expect(dbMocks.markHandoffRequested).toHaveBeenCalledTimes(1);
  });
});
