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
// `emailProviderThrowsRef` lets one test simulate `getEmailProvider()`
// throwing — the real function does exactly that in production when
// RESEND_API_KEY/EMAIL_FROM is missing or rotated (see `preflight.ts`).
// `vi.hoisted` for the same reason `accountErrorRef` below needs it: `vi.mock`
// factories are hoisted above all other module-level code.
const { emailProviderThrowsRef } = vi.hoisted(() => ({
  emailProviderThrowsRef: { current: false },
}));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => {
    if (emailProviderThrowsRef.current) {
      throw new Error("RESEND_API_KEY is not set");
    }
    return { send: (...a: unknown[]) => sendMock(...a) };
  },
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
const { MockSlotTakenError, accountErrorRef } = vi.hoisted(() => ({
  MockSlotTakenError: class MockSlotTakenError extends Error {
    constructor(message = "slot already booked") {
      super(message);
      this.name = "SlotTakenError";
    }
  },
  // Mutable, set by a single I3 test to simulate `accounts.select(...)`
  // returning `{ data: null, error: {...} }` — reset to null in `beforeEach`
  // so that one test's failure injection can never bleed into another.
  accountErrorRef: { current: null as { message: string } | null },
}));

vi.mock("@bis/db", () => ({
  SlotTakenError: MockSlotTakenError,
  serviceDb: () => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (accountErrorRef.current) return { data: null, error: accountErrorRef.current };
            const wanted = cols.split(",").map((c) => c.trim());
            return {
              data: Object.fromEntries(
                Object.entries(accountRow).filter(([key]) => wanted.includes(key)),
              ),
              error: null,
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
  accountErrorRef.current = null;
  emailProviderThrowsRef.current = false;
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
  it("re-checks availability, THEN creates contact, then booking (carrying that contact's id), then conversation, then message, then unread, then sends — in that order (mutation: swap createBooking before createContact, or hoist createContact back above the recheck → FAILS)", async () => {
    const order: string[] = [];
    // `listBookedRangesMock` is what `computeAllSlots` (the I2 recheck) calls
    // — tracking it here is the only way to prove the recheck runs BEFORE
    // `createContact` now, not just that `createContact` runs before
    // `createBooking`.
    listBookedRangesMock.mockImplementation(async () => {
      order.push("recheck");
      return [];
    });
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
    incrementUnreadCountMock.mockImplementation(async () => {
      order.push("unread");
    });
    sendMock.mockImplementation(async () => {
      order.push("send");
      return undefined;
    });

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result.ok).toBe(true);
    // recheck -> contact -> booking -> conversation -> message -> unread -> alert send -> confirmation send
    expect(order).toEqual(
      ["recheck", "contact", "booking", "conversation", "message", "unread", "send", "send"],
    );
    expect(createBookingMock.mock.calls[0]![2]).toMatchObject({ contactId: "contact_1" });
  });

  it("passes the public/system actor pair to createContact, createBooking and ensureConversation alike", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData());

    expect(createContactMock.mock.calls[0]![3]).toBe("public");
    expect(createContactMock.mock.calls[0]![4]).toBe("system");
    expect(createBookingMock.mock.calls[0]![3]).toBe("public");
    expect(createBookingMock.mock.calls[0]![4]).toBe("system");
    expect(ensureConversationMock.mock.calls[0]![3]).toBe("public");
    expect(ensureConversationMock.mock.calls[0]![4]).toBe("system");
  });

  it("createBooking receives a server-derived endsAt, the validated booker timezone, and an ipHash", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData());

    const payload = createBookingMock.mock.calls[0]![2];
    // slot_duration_minutes is 30 on calendarRow() — endsAt must be derived
    // from the server's own config, never trusted from the request.
    expect(payload.endsAt.getTime()).toBe(slot.startsAt.getTime() + 30 * 60_000);
    expect(payload.bookerTimezone).toBe("America/New_York"); // validFormData's own zone, a real IANA name
    expect(typeof payload.ipHash).toBe("string");
    expect(payload.ipHash.length).toBeGreaterThan(0);
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

describe("submitBookingAction — I1: the two previously-unpinned guards", () => {
  it("slotStartsAt off the computed grid (a real slot + 17min): slotTaken, no contact, no booking (mutation: skip the availability recheck → FAILS)", async () => {
    const offGrid = new Date(slot.startsAt.getTime() + 17 * 60_000).toISOString();

    const result = await submitBookingAction(PUBLIC_ID, validFormData({ slotStartsAt: offGrid }));

    expect(result).toEqual({ ok: false, error: m["booking.public.slotTaken"], slotTaken: true });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
  });

  it("calendar disabled by submit time: generic error, no contact created (mutation: drop the enabled check → FAILS)", async () => {
    getCalendarByPublicIdMock.mockResolvedValue(calendarRow({ enabled: false }));

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result).toEqual({ ok: false, error: m["booking.public.genericError"] });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
  });
});

describe("submitBookingAction — C2: bookerTimezone is validated (safeZone)", () => {
  it("a bogus bookerTimezone still succeeds; the booking persists the ACCOUNT zone; both sends still fire (mutation: drop safeZone and trust the raw crafted zone → FAILS, throws after the insert)", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ bookerTimezone: "Nope/Nowhere" }));

    expect(result.ok).toBe(true);
    expect(createBookingMock.mock.calls[0]![2]).toMatchObject({ bookerTimezone: accountRow.timezone });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("an oversized bookerTimezone (>64 chars) also falls back to the account zone", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ bookerTimezone: "X".repeat(65) }));

    expect(result.ok).toBe(true);
    expect(createBookingMock.mock.calls[0]![2]).toMatchObject({ bookerTimezone: accountRow.timezone });
  });
});

describe("submitBookingAction — C3: an expired render token is a real failure, not a fake success", () => {
  it("expired token: ok:false with the expiry message, zero writes, zero sends (mutation: fold `expired` back into the fake-success branch → FAILS)", async () => {
    // MAX_TOKEN_AGE_MS is 30 minutes; 31 minutes is comfortably past it.
    const expiredToken = signRenderToken(Date.now() - 31 * 60_000, PUBLIC_ID);

    const result = await submitBookingAction(PUBLIC_ID, validFormData({ [RENDER_TOKEN_FIELD]: expiredToken }));

    expect(result).toEqual({ ok: false, error: m["booking.public.tokenExpired"] });
    expect(createContactMock).not.toHaveBeenCalled();
    expect(createBookingMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a malformed token (not expired, just invalid) keeps the shared fake success", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ [RENDER_TOKEN_FIELD]: "not-a-token" }));

    expect(result).toEqual({ ok: true, cancelUrl: "" });
    expect(createContactMock).not.toHaveBeenCalled();
  });
});

describe("submitBookingAction — I3: loadAccount does not swallow its query error", () => {
  it("an account-read failure returns a generic error and creates no contact (mutation: discard `error` and fall back to UTC → FAILS, silently proceeds)", async () => {
    accountErrorRef.current = { message: "boom" };

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    expect(result).toEqual({ ok: false, error: m["booking.public.genericError"] });
    expect(createContactMock).not.toHaveBeenCalled();
  });
});

describe("submitBookingAction — I4: public fields are bounded", () => {
  it("a 20k-char note is persisted capped at 2000 chars (mutation: drop the note slice → FAILS)", async () => {
    const hugeNote = "x".repeat(20_000);

    await submitBookingAction(PUBLIC_ID, validFormData({ note: hugeNote }));

    const persistedNote = createBookingMock.mock.calls[0]![2].note as string;
    expect(persistedNote.length).toBe(2000);
  });

  it("a newline-carrying name never reaches the alert email's subject line (mutation: drop the subject control-char strip → FAILS)", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData({ firstName: "Maria\nBcc: evil@example.com" }));

    const alertCall = sendMock.mock.calls[0]![0];
    expect(alertCall.subject).not.toMatch(/[\r\n]/);
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

describe("submitBookingAction — a post-insert email failure never reaches the outer catch (merge-hold)", () => {
  it("getEmailProvider() throwing still returns ok:true with the real cancelUrl, keeps every write made before it, and sends nothing (mutation: remove the structural try/catch around the email block → FAILS, the booking becomes a reported failure)", async () => {
    emailProviderThrowsRef.current = true;

    const result = await submitBookingAction(PUBLIC_ID, validFormData());

    // No `host` header in this suite's default `headers()` mock, so
    // `originFrom` returns null and `cancelUrl` is the already-handled empty
    // string — still `ok:true`, never the outer catch's generic error.
    expect(result).toEqual({ ok: true, cancelUrl: "" });
    expect(createContactMock).toHaveBeenCalled();
    expect(createBookingMock).toHaveBeenCalled();
    expect(ensureConversationMock).toHaveBeenCalled();
    expect(createMessageMock).toHaveBeenCalled();
    expect(incrementUnreadCountMock).toHaveBeenCalled();
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
