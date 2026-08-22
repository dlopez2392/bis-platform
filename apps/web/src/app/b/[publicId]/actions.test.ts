import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const getCalendarByPublicIdMock = vi.fn();
const listBookedRangesMock = vi.fn();
const countRecentBookingsMock = vi.fn();
const createContactMock = vi.fn();
const createBookingMock = vi.fn();
const ensureConversationMock = vi.fn();
const createMessageMock = vi.fn();
const incrementUnreadCountMock = vi.fn();

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

const ACCOUNT_ID = "acct_1";

/**
 * The row behind the action's own `loadAccount` read.
 *
 * `from_email` is deliberately POPULATED and distinctive, same reasoning as
 * `f/[publicId]/actions.test.ts`'s `accountRow`: the mock below PROJECTS to
 * the columns actually asked for (`select: (cols) => ...` filtering), so this
 * value only reaches an assertion if the code's own `.select(...)` list
 * requested `from_email`. A mock that ignored its argument and returned a
 * fixed row would make the confirmation's `fromAddress` pass under every
 * implementation — including one that forgot to select the column at all.
 */
const accountRow = {
  name: "Acme", timezone: "America/Chicago",
  from_email: "hello@acme.com", reply_to_email: "owner-reply@acme.com",
  brand_name: "Rio Roofing", brand_logo_path: null,
  brand_color: null, brand_neutral: null, brand_corners: null,
  brand_type: null, brand_mode: null,
};

/**
 * `SlotTakenError` is defined via `vi.hoisted` (not a plain top-level class)
 * because `vi.mock` factories are hoisted above ALL other module-level code,
 * including class declarations — a plain `class MockSlotTakenError` here
 * would be a "used before initialization" TDZ error the moment the factory
 * below runs. `actions.ts` does `e instanceof SlotTakenError` on the SAME
 * `@bis/db` import, so as long as both sides resolve to this one mocked
 * class, the identity check holds without ever loading the real `@bis/db`
 * package (and whatever env/module surface it would drag in) into this unit
 * test.
 */
const { MockSlotTakenError } = vi.hoisted(() => ({
  MockSlotTakenError: class MockSlotTakenError extends Error {
    constructor(message = "slot already booked") {
      super(message);
      this.name = "SlotTakenError";
    }
  },
}));

vi.mock("@bis/db", () => ({
  SlotTakenError: MockSlotTakenError,
  serviceDb: () => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            const wanted = cols.split(",").map((c) => c.trim());
            return {
              data: Object.fromEntries(
                Object.entries(accountRow).filter(([key]) => wanted.includes(key)),
              ),
            };
          },
        }),
      }),
    }),
  }),
  getCalendarByPublicId: (...a: unknown[]) => getCalendarByPublicIdMock(...a),
  listBookedRanges: (...a: unknown[]) => listBookedRangesMock(...a),
  countRecentBookings: (...a: unknown[]) => countRecentBookingsMock(...a),
  createContact: (...a: unknown[]) => createContactMock(...a),
  createBooking: (...a: unknown[]) => createBookingMock(...a),
  ensureConversation: (...a: unknown[]) => ensureConversationMock(...a),
  createMessage: (...a: unknown[]) => createMessageMock(...a),
  incrementUnreadCount: (...a: unknown[]) => incrementUnreadCountMock(...a),
}));

import { headers } from "next/headers";
import { computeSlots, type SlotConfig } from "@/lib/booking/slots";
import { submitBookingAction, getSlotsAction } from "./actions";
import { SlotTakenError } from "@bis/db";
import {
  signRenderToken, RENDER_TOKEN_FIELD, HONEYPOT_FIELD, RATE_LIMIT_MAX,
} from "@/lib/forms/guards";
import { m } from "@/lib/messages";

const PUBLIC_ID = "cal_test1234";

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal_1", account_id: ACCOUNT_ID, public_id: PUBLIC_ID, enabled: true,
    slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 14,
    open_hours: {
      sun: [["00:00", "24:00"]], mon: [["00:00", "24:00"]], tue: [["00:00", "24:00"]],
      wed: [["00:00", "24:00"]], thu: [["00:00", "24:00"]], fri: [["00:00", "24:00"]],
      sat: [["00:00", "24:00"]],
    },
    notify_emails: ["owner@acme.com"],
    ...overrides,
  };
}

/**
 * A real, engine-computed candidate slot — not a hand-picked timestamp. Both
 * the test's `slotStartsAt` field AND the action's own app-level re-check
 * (`computeAllSlots`, unmocked — this file never mocks `@/lib/booking/slots`)
 * run the identical `computeSlots` against the identical `calendarRow()`
 * config, so the two can never disagree about which instants are free. Index
 * 5, not 0: comfortably inside `minNoticeHours`'s one-hour floor regardless
 * of the few milliseconds between this call and the one inside the action.
 */
function pickSlot() {
  const calendar = calendarRow();
  const config: SlotConfig = {
    timezone: accountRow.timezone,
    slotDurationMinutes: calendar.slot_duration_minutes,
    bufferMinutes: calendar.buffer_minutes,
    minNoticeHours: calendar.min_notice_hours,
    maxAdvanceDays: calendar.max_advance_days,
    openHours: calendar.open_hours as SlotConfig["openHours"],
  };
  const slots = computeSlots(config, [], new Date());
  return slots[5]!;
}

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

let slot: { startsAt: Date; endsAt: Date };

function validFormData(overrides: Record<string, string> = {}) {
  const token = signRenderToken(Date.now() - 5000, PUBLIC_ID); // comfortably past MIN_FILL_MS
  return fd({
    [RENDER_TOKEN_FIELD]: token,
    firstName: "Maria", lastName: "Lopez", email: "maria@example.com", phone: "956-555-0101",
    note: "Please call ahead",
    slotStartsAt: slot.startsAt.toISOString(),
    bookerTimezone: "America/New_York",
    ...overrides,
  });
}

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

beforeEach(() => {
  vi.mocked(headers).mockResolvedValue(new Headers({ "user-agent": "test-agent" }) as never);
  slot = pickSlot();
  getCalendarByPublicIdMock.mockReset().mockResolvedValue(calendarRow());
  listBookedRangesMock.mockReset().mockResolvedValue([]);
  countRecentBookingsMock.mockReset().mockResolvedValue(0);
  createContactMock.mockReset().mockResolvedValue({ id: "contact_1", existing: false });
  createBookingMock.mockReset().mockResolvedValue({ id: "booking_1", cancelToken: "tok_1" });
  ensureConversationMock.mockReset().mockResolvedValue({ id: "convo_1", created: true });
  createMessageMock.mockReset().mockResolvedValue({ id: "msg_1" });
  incrementUnreadCountMock.mockReset();
  sendMock.mockReset().mockResolvedValue(undefined);
});

describe("submitBookingAction — spam gates (each mutation named)", () => {
  it("honeypot filled: fake success, zero writes, zero sends (mutation: skip the honeypot check → FAILS)", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ [HONEYPOT_FIELD]: "gotcha" }));

    expect(result).toEqual({ ok: true, cancelUrl: "" });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
    expect(ensureConversationMock).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("too-fast token: same fake success, zero writes, zero sends (mutation: skip the too-fast check → FAILS)", async () => {
    const freshToken = signRenderToken(Date.now(), PUBLIC_ID); // elapsed ~0ms, under MIN_FILL_MS
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ [RENDER_TOKEN_FIELD]: freshToken }));

    expect(result).toEqual({ ok: true, cancelUrl: "" });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
    expect(ensureConversationMock).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rate limit: error, no writes (mutation: drop the rate-limit check → FAILS)", async () => {
    countRecentBookingsMock.mockResolvedValue(RATE_LIMIT_MAX);

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result.ok).toBe(false);
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
  });

  it("invalid email: field error, no writes (mutation: drop the email check → FAILS)", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ email: "not-an-email" }));

    expect(result).toEqual({ ok: false, error: m["booking.public.invalidEmail"] });
    expect(createContactMock).not.toHaveBeenCalled();
  });
});

describe("submitBookingAction — happy path", () => {
  it("creates contact, then booking (carrying that contact's id), then conversation, then message, then sends — in that order (mutation: swap createBooking before createContact → FAILS on the contact-id the booking mock received)", async () => {
    const order: string[] = [];
    createContactMock.mockImplementation(async () => {
      order.push("contact");
      return { id: "contact_1", existing: false };
    });
    createBookingMock.mockImplementation(async () => {
      order.push("booking");
      return { id: "booking_1", cancelToken: "tok_1" };
    });
    ensureConversationMock.mockImplementation(async () => {
      order.push("conversation");
      return { id: "convo_1", created: true };
    });
    createMessageMock.mockImplementation(async () => {
      order.push("message");
      return { id: "msg_1" };
    });
    sendMock.mockImplementation(async () => {
      order.push("send");
      return undefined;
    });

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result.ok).toBe(true);
    // contact -> booking -> conversation -> message -> alert send -> confirmation send
    expect(order).toEqual(["contact", "booking", "conversation", "message", "send", "send"]);
    expect(createBookingMock.mock.calls[0]![2]).toMatchObject({ contactId: "contact_1" });
  });

  it("passes the public/system actor pair to createBooking", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData());

    expect(createBookingMock.mock.calls[0]![3]).toBe("public");
    expect(createBookingMock.mock.calls[0]![4]).toBe("system");
  });

  it("the conversation message body carries the when-string and the note", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData({ note: "Please call ahead" }));

    expect(createMessageMock).toHaveBeenCalledWith(
      expect.anything(), ACCOUNT_ID,
      expect.objectContaining({ channel: "form", direction: "inbound" }),
      "public", "system",
    );
    const body = createMessageMock.mock.calls[0]![2].body as string;
    expect(body).toMatch(/^Booking: /);
    expect(body).toContain("Please call ahead");
  });
});

describe("submitBookingAction — SlotTakenError", () => {
  it("createBooking throwing SlotTakenError returns slotTaken and does nothing after (mutation: catch-and-continue → FAILS)", async () => {
    createBookingMock.mockReset().mockRejectedValueOnce(new SlotTakenError());

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result).toEqual({ ok: false, error: m["booking.public.slotTaken"], slotTaken: true });
    expect(ensureConversationMock).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("submitBookingAction — the alert and the confirmation are not the same send (mutation: add fromAddress to the alert → FAILS)", () => {
  it("the alert has NO fromAddress; the confirmation carries the account's from_email", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);

    const alertCall = sendMock.mock.calls[0]![0];
    expect(alertCall.to).toBe("owner@acme.com");
    expect(alertCall.fromAddress).toBeUndefined();

    const confirmCall = sendMock.mock.calls[1]![0];
    expect(confirmCall.to).toBe("maria@example.com");
    expect(confirmCall.fromAddress).toBe("hello@acme.com");
    expect(confirmCall.replyTo).toBe("owner-reply@acme.com");
  });

  it("returns a real, absolute cancelUrl on success", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ "user-agent": "test-agent", host: "book.example.com", "x-forwarded-proto": "https" }) as never,
    );

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cancelUrl).toBe(`https://book.example.com/b/${PUBLIC_ID}/cancel/tok_1`);
    }
  });
});

describe("getSlotsAction", () => {
  it("returns ISO slots for a valid day on an enabled calendar", async () => {
    const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: accountRow.timezone })
      .format(slot.startsAt); // en-CA formats as YYYY-MM-DD

    const result = await getSlotsAction(PUBLIC_ID, dayKey);

    expect("slots" in result).toBe(true);
    if ("slots" in result) {
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots).toContain(slot.startsAt.toISOString());
    }
  });

  it("errors for a disabled calendar", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(calendarRow({ enabled: false }));

    const result = await getSlotsAction(PUBLIC_ID, "2026-01-01");

    expect("error" in result).toBe(true);
  });
});
