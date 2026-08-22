import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const cancelBookingByTokenMock = vi.fn();
const getCalendarByPublicIdMock = vi.fn();
const getContactMock = vi.fn();
const ensureConversationMock = vi.fn();
const createMessageMock = vi.fn();
const incrementUnreadCountMock = vi.fn();
const bookingsUpdateMock = vi.fn();

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

const ACCOUNT_ID = "acct_1";

/**
 * The row behind this action's own `loadAccount` read. Distinctive and
 * complete, same reasoning as the sibling submit action's `accountRow`: the
 * mock below PROJECTS to the columns actually requested (`select: (cols) =>
 * ...` filtering, not a fixed row), so a value only reaches an assertion if
 * the code's own `.select(...)` list asked for that column. A mock that
 * ignored its argument would make a dropped column invisible to every test.
 */
const accountRow = {
  name: "Acme", timezone: "America/Chicago",
  brand_name: "Rio Roofing", brand_logo_path: null,
  brand_color: null, brand_neutral: null, brand_corners: null,
  brand_type: null, brand_mode: null,
};

// Mutable, set per-test, read by the `serviceDb().from("bookings")` mock —
// only `lookupBookingByToken`'s own tests touch this; `confirmCancelAction`
// never queries the `bookings` table directly (it goes through the mocked
// `cancelBookingByToken` accessor instead).
const bookingLookupResultRef: {
  current: { data: unknown; error: { message: string } | null };
} = { current: { data: null, error: null } };
const accountErrorRef: { current: { message: string } | null } = { current: null };

// The CRITICAL fix's own mock: `notify_emails` keyed by `calendars.id`
// (`row.calendar_id`), completely independent of `getCalendarByPublicIdMock`
// below — that separation IS the test. If `confirmCancelAction` regressed to
// resolving recipients via `getCalendarByPublicId(db, publicId)` instead of
// this table, the cross-tenant test would see `getCalendarByPublicIdMock`'s
// planted (wrong) address instead of this one.
const calendarNotifyRowsRef: { current: Record<string, { notify_emails: string[] }> } = {
  current: { cal_1: { notify_emails: ["owner@acme.com"] } },
};
const calendarLookupErrorRef: { current: { message: string } | null } = { current: null };

vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return {
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
        };
      }
      if (table === "bookings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => bookingLookupResultRef.current,
            }),
          }),
          // Present so the I1 test below can prove `lookupBookingByToken`
          // never calls it — a real `.update()` chain would look like this,
          // but the function under test has no code path that reaches it.
          update: (...a: unknown[]) => {
            bookingsUpdateMock(...a);
            return { eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) };
          },
        };
      }
      if (table === "calendars") {
        // `loadCalendarNotifyEmails`'s own table — keyed by `.eq("id", ...)`,
        // i.e. `row.calendar_id`. Column-projected like the "accounts" branch
        // above, so a query that asked for more than `notify_emails` would be
        // visible to a test rather than silently satisfied.
        return {
          select: (cols: string) => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (calendarLookupErrorRef.current) {
                  return { data: null, error: calendarLookupErrorRef.current };
                }
                const row = calendarNotifyRowsRef.current[id];
                if (!row) return { data: null, error: null };
                const wanted = cols.split(",").map((c) => c.trim());
                return {
                  data: Object.fromEntries(Object.entries(row).filter(([key]) => wanted.includes(key))),
                  error: null,
                };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table "${table}" in test mock`);
    },
  }),
  cancelBookingByToken: (...a: unknown[]) => cancelBookingByTokenMock(...a),
  getCalendarByPublicId: (...a: unknown[]) => getCalendarByPublicIdMock(...a),
  getContact: (...a: unknown[]) => getContactMock(...a),
  ensureConversation: (...a: unknown[]) => ensureConversationMock(...a),
  createMessage: (...a: unknown[]) => createMessageMock(...a),
  incrementUnreadCount: (...a: unknown[]) => incrementUnreadCountMock(...a),
}));

import { confirmCancelAction, lookupBookingByToken } from "./actions";
import { serviceDb } from "@bis/db";
import { m } from "@/lib/messages";

const PUBLIC_ID = "cal_test1234";
const TOKEN = "tok_abc123";

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking_1", account_id: ACCOUNT_ID, calendar_id: "cal_1", contact_id: "contact_1",
    starts_at: "2026-09-01T14:00:00.000Z", ends_at: "2026-09-01T14:30:00.000Z",
    status: "booked", note: null, cancel_token: TOKEN, booker_timezone: "America/New_York",
    reminder_sent_at: null,
    ...overrides,
  };
}

function calendarRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cal_1", account_id: ACCOUNT_ID, public_id: PUBLIC_ID, enabled: true,
    slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 14,
    open_hours: {}, notify_emails: ["owner@acme.com"],
    ...overrides,
  };
}

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
});

beforeEach(() => {
  cancelBookingByTokenMock.mockReset().mockResolvedValue(bookingRow());
  getCalendarByPublicIdMock.mockReset().mockResolvedValue(calendarRow());
  getContactMock.mockReset().mockResolvedValue({
    id: "contact_1", first_name: "Maria", last_name: "Lopez", email: "maria@example.com",
  });
  ensureConversationMock.mockReset().mockResolvedValue({ id: "convo_1", created: true });
  createMessageMock.mockReset().mockResolvedValue({ id: "msg_1" });
  incrementUnreadCountMock.mockReset();
  sendMock.mockReset().mockResolvedValue(undefined);
  bookingsUpdateMock.mockReset();
  bookingLookupResultRef.current = { data: null, error: null };
  accountErrorRef.current = null;
  calendarNotifyRowsRef.current = { cal_1: { notify_emails: ["owner@acme.com"] } };
  calendarLookupErrorRef.current = null;
});

describe("lookupBookingByToken — the page-level, read-only lookup", () => {
  it("an unknown token returns null (this is what makes page.tsx call notFound())", async () => {
    bookingLookupResultRef.current = { data: null, error: null };

    const result = await lookupBookingByToken(serviceDb(), TOKEN);

    expect(result).toBeNull();
  });

  it("a known token, in ANY status, returns the row — unlike `cancelBookingByToken`, this never filters by status", async () => {
    bookingLookupResultRef.current = { data: bookingRow({ status: "cancelled" }), error: null };

    const result = await lookupBookingByToken(serviceDb(), TOKEN);

    expect(result).toMatchObject({ status: "cancelled" });
  });

  it("performs NO update — a pure SELECT (mutation: swap the mock's `select` chain for `update` → this assertion FAILS)", async () => {
    bookingLookupResultRef.current = { data: bookingRow(), error: null };

    await lookupBookingByToken(serviceDb(), TOKEN);

    expect(bookingsUpdateMock).not.toHaveBeenCalled();
  });

  it("throws on a query error rather than silently returning null", async () => {
    bookingLookupResultRef.current = { data: null, error: { message: "boom" } };

    await expect(lookupBookingByToken(serviceDb(), TOKEN)).rejects.toThrow(/boom/);
  });
});

describe("GET never mutates — structural: confirmCancelAction is the only caller of cancelBookingByToken in this route", () => {
  it("page.tsx never imports or calls cancelBookingByToken; actions.ts does", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const pageSrc = readFileSync(`${dir}page.tsx`, "utf8");
    const actionsSrc = readFileSync(`${dir}actions.ts`, "utf8");

    expect(pageSrc).not.toMatch(/cancelBookingByToken/);
    expect(actionsSrc).toMatch(/cancelBookingByToken/);
  });
});

describe("confirmCancelAction — happy path", () => {
  it("calls cancelBookingByToken with the token and the system actor type", async () => {
    await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(cancelBookingByTokenMock).toHaveBeenCalledTimes(1);
    expect(cancelBookingByTokenMock.mock.calls[0]![1]).toBe(TOKEN);
    expect(cancelBookingByTokenMock.mock.calls[0]![2]).toBe("system");
  });

  it("appends a thread message and fires the unread count (mutation: drop either call → FAILS)", async () => {
    await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(ensureConversationMock).toHaveBeenCalledWith(
      expect.anything(), ACCOUNT_ID, "contact_1", "public", "system",
    );
    expect(createMessageMock).toHaveBeenCalledWith(
      expect.anything(), ACCOUNT_ID,
      expect.objectContaining({ channel: "form", direction: "inbound" }),
      "public", "system",
    );
    const body = createMessageMock.mock.calls[0]![2].body as string;
    expect(body).toMatch(/^Cancelled their /);
    expect(body).toContain("booking");
    expect(incrementUnreadCountMock).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, "convo_1");
  });

  it("sends the company notify to every notify_emails recipient and returns ok:true", async () => {
    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.to).toBe("owner@acme.com");
    expect(call.fromAddress).toBeUndefined();
    expect(call.subject).toContain("Booking cancelled");
    expect(call.subject).toContain("Maria Lopez");
    expect(call.body).toContain("Maria Lopez");
  });

  it("a booking with a note carries it into the notify body", async () => {
    cancelBookingByTokenMock.mockResolvedValue(bookingRow({ note: "Reschedule me later" }));

    await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(sendMock.mock.calls[0]![0].body).toContain("Reschedule me later");
  });
});

describe("confirmCancelAction — double-confirm is idempotent, not an error", () => {
  it("cancelBookingByToken returning null (already cancelled) still returns ok:true, with NO thread append and NO notify", async () => {
    cancelBookingByTokenMock.mockResolvedValue(null);

    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(ensureConversationMock).not.toHaveBeenCalled();
    expect(createMessageMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("confirmCancelAction — a notify-send failure never turns a committed cancel into a reported failure", () => {
  it("sendMock rejecting still returns ok:true, with the thread append already made (mutation: remove the best-effort try/catch around thread/notify → FAILS, the error escapes to the outer catch)", async () => {
    sendMock.mockRejectedValueOnce(new Error("Resend down"));

    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(cancelBookingByTokenMock).toHaveBeenCalled();
    expect(createMessageMock).toHaveBeenCalled();
  });
});

describe("confirmCancelAction — IMPORTANT: a failed cancel is no longer silent", () => {
  it("an error thrown before the cancel commits (outer catch) returns ok:false with the exact genericError message CancelForm renders", async () => {
    cancelBookingByTokenMock.mockRejectedValue(new Error("db down"));

    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: false, error: m["booking.cancel.genericError"] });
  });
});

describe("confirmCancelAction — CRITICAL: notify recipients come from row.calendar_id, never the URL's publicId", () => {
  it("a booking whose calendar_id belongs to account A still notifies A's own notify_emails, even when the action is invoked with a DIFFERENT company's publicId in the URL (mutation: revert to publicId-derived lookup → FAILS)", async () => {
    // The booking's real calendar (cal_1) belongs to Company A and its
    // notify_emails is the default `owner@acme.com` set in beforeEach. The
    // URL segment, meanwhile, claims to be some OTHER company's public
    // calendar id — exactly what an attacker swaps in on a copied cancel
    // link. `getCalendarByPublicIdMock` is wired to resolve THAT calendar
    // with a distinct, deliberately different address: if the fix regressed
    // to `getCalendarByPublicId(db, publicId)`, this is the value the send
    // would carry instead.
    getCalendarByPublicIdMock.mockResolvedValue(
      calendarRow({ id: "cal_evil", public_id: "evil-companyb-public-id", notify_emails: ["staffB@company-b.com"] }),
    );

    const result = await confirmCancelAction("evil-companyb-public-id", TOKEN);

    expect(result).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]![0].to).toBe("owner@acme.com");
    expect(sendMock.mock.calls[0]![0].to).not.toBe("staffB@company-b.com");
  });

  it("never calls getCalendarByPublicId at all — recipients are resolved by row.calendar_id alone", async () => {
    await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(getCalendarByPublicIdMock).not.toHaveBeenCalled();
  });
});

describe("confirmCancelAction — a calendar-row lookup problem never turns a committed cancel into a reported failure", () => {
  it("loadCalendarNotifyEmails's own query erroring still returns ok:true, with the thread append already made (same best-effort shape as the notify-send failure above)", async () => {
    calendarLookupErrorRef.current = { message: "db blip" };

    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(cancelBookingByTokenMock).toHaveBeenCalled();
    expect(createMessageMock).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a calendar row that no longer exists (deleted) still leaves the cancel itself intact — only the notify is skipped", async () => {
    calendarNotifyRowsRef.current = {};

    const result = await confirmCancelAction(PUBLIC_ID, TOKEN);

    expect(result).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
