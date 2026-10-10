import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * F-048 (rider): the customer moves their own booking from the link in their
 * email. What this pins, in the order the action runs:
 *
 *  - the token is refused UNREAD when it is not a token, and is never logged;
 *  - everything (the calendar, the account, the notify list, every link) is
 *    the ROW's, never anything the request names;
 *  - a booking that is not live, already over, or on a switched-off calendar
 *    is refused before any write;
 *  - the picked time goes through the REAL move engine (`movableSlot`; only
 *    the database read under it is a mock, and it answers the way Postgres
 *    does, leaving out the booking being moved);
 *  - the move is `moveBooking`, attributed to the public link;
 *  - then, best-effort and never able to undo the answer: a line in the
 *    contact's thread, the business told (`operator.move_notice`), and the
 *    customer told (`booking.moved`, in their language, with the NEW links).
 */

vi.mock("next/headers", () => ({ headers: vi.fn() }));

const sendMock = vi.fn();
const { providerThrows } = vi.hoisted(() => ({ providerThrows: { current: false } }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => {
    if (providerThrows.current) throw new Error("RESEND_API_KEY is not set");
    return { send: (...a: unknown[]) => sendMock(...a) };
  },
}));
vi.mock("@/lib/consent/email-gate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/consent/email-gate")>();
  return { ...real, sendEmailOrThrow: vi.fn(real.sendEmailOrThrow) };
});
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
const gated = () => vi.mocked(sendEmailOrThrow).mock.calls.map((c) => c[0]);

const getMeetingProviderMock = vi.fn();
vi.mock("@/lib/meetings/provider", () => ({ getMeetingProvider: (...a: unknown[]) => getMeetingProviderMock(...a) }));

const m = vi.hoisted(() => ({
  listBookedRanges: vi.fn(), moveBooking: vi.fn(), getContact: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(),
  readMoveContext: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@bis/db")>();
  return {
    ...real,
    serviceDb: () => ({}),
    isAccountOutboundSuppressed: async () => false,
    readEmailSuppression: async () => null,
    listBookedRanges: m.listBookedRanges,
    moveBooking: m.moveBooking,
    getContact: m.getContact,
    ensureConversation: m.ensureConversation,
    createMessage: m.createMessage,
    incrementUnreadCount: m.incrementUnreadCount,
  };
});
vi.mock("./data", async (importOriginal) => {
  const real = await importOriginal<typeof import("./data")>();
  return { ...real, readMoveContext: m.readMoveContext };
});

import { headers } from "next/headers";
import { SlotTakenError, BookingNotMovableError, newCancelToken } from "@bis/db";
import { bookingStrings } from "@/lib/booking/public-strings";
import { formatWhen } from "@/lib/booking/time";
import { confirmMoveAction, getMoveSlotsAction } from "./actions";

const TOKEN = newCancelToken();
const NEW_TOKEN = newCancelToken();
const ACCOUNT_ID = "acct_1";
// Tue 2027-06-01, account zone UTC. The booking being moved: 10:00-11:00.
const NOW = new Date("2027-06-01T00:00:00Z");
const OWN = { starts_at: "2027-06-01T10:00:00.000Z", ends_at: "2027-06-01T11:00:00.000Z" };

const calendar = () => ({
  id: "cal_1", account_id: ACCOUNT_ID, public_id: "pubrow12345", enabled: true,
  slot_duration_minutes: 60, buffer_minutes: 15, min_notice_hours: 0, max_advance_days: 2,
  open_hours: { tue: [["09:00", "12:00"]] }, notify_emails: ["owner@acme.com"],
  meeting_type: "in_person" as const, followup_enabled: false, followup_body: "",
});
const context = (row: Record<string, unknown> = {}, cal: Record<string, unknown> = {}) => ({
  row: {
    id: "bk_old", account_id: ACCOUNT_ID, calendar_id: "cal_1", contact_id: "contact_1",
    status: "booked", booker_timezone: "America/Chicago", cancel_token: TOKEN, ...OWN, ...row,
  },
  calendar: { ...calendar(), ...cal },
  account: {
    timezone: "UTC", from_email: "hello@acme.com", reply_to_email: "owner-reply@acme.com",
    brand_name: "Rio Roofing", brand_logo_path: null, brand_color: null, brand_neutral: null,
    brand_corners: null, brand_type: null, brand_mode: null,
  },
});

const ELEVEN = "2027-06-01T11:00:00.000Z";
const en = bookingStrings("en");
const es = bookingStrings("es");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "app.example", "x-forwarded-proto": "https" }) as never);
  vi.mocked(sendEmailOrThrow).mockClear();
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  providerThrows.current = false;
  getMeetingProviderMock.mockReset().mockReturnValue(null);
  // Postgres's answer: every live booking on the calendar, minus the one the
  // caller asked to leave out.
  m.listBookedRanges.mockReset().mockImplementation(async (_db, _cal, _from, _to, exclude?: string) =>
    [{ id: "bk_old", ...OWN }].filter((r) => r.id !== exclude).map(({ starts_at, ends_at }) => ({ starts_at, ends_at })));
  m.moveBooking.mockReset().mockResolvedValue({ id: "bk_new", cancelToken: NEW_TOKEN });
  m.getContact.mockReset().mockResolvedValue({ id: "contact_1", first_name: "Jane", last_name: "Doe", email: "jane@example.com" });
  m.ensureConversation.mockReset().mockResolvedValue({ id: "convo_1" });
  m.createMessage.mockReset().mockResolvedValue({ id: "msg_1" });
  m.incrementUnreadCount.mockReset().mockResolvedValue(undefined);
  m.readMoveContext.mockReset().mockResolvedValue(context());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("confirmMoveAction — refusals, before any write", () => {
  it("a malformed token is refused UNREAD (mutation: drop the token check → the booking is read, FAILS)", async () => {
    for (const bad of ["", "short", `${TOKEN}x`, TOKEN.toUpperCase(), "../../etc/passwd"]) {
      expect(await confirmMoveAction(bad, "en", ELEVEN)).toEqual({ ok: false, error: en.moveGenericError });
    }
    expect(m.readMoveContext).not.toHaveBeenCalled();
    expect(m.moveBooking).not.toHaveBeenCalled();
  });

  it("an unknown token, a booking no longer live, one already over, and a switched-off calendar move nothing", async () => {
    m.readMoveContext.mockResolvedValueOnce(null);
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.moveGenericError });

    m.readMoveContext.mockResolvedValueOnce(context({ status: "cancelled" }));
    expect(await confirmMoveAction(TOKEN, "es", ELEVEN)).toEqual({ ok: false, error: es.moveAlreadyChanged, gone: true });

    // Still `booked`, but it started an hour ago (mutation: judge by status alone → it moves, FAILS).
    m.readMoveContext.mockResolvedValueOnce(context({ starts_at: "2027-05-31T23:00:00.000Z", ends_at: "2027-06-01T00:30:00.000Z" }));
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.cancelPastTitle, gone: true });

    m.readMoveContext.mockResolvedValueOnce(context({}, { enabled: false }));
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.moveOffline });

    expect(m.moveBooking).not.toHaveBeenCalled();
    expect(gated()).toEqual([]);
  });

  it("a time the move engine refuses is slotTaken and moves nothing: the own range, an off-grid start, garbage", async () => {
    for (const bad of ["2027-06-01T10:00:00.000Z", "2027-06-01T11:15:00.000Z", "not a date"]) {
      const r = await confirmMoveAction(TOKEN, "en", bad);
      expect(r.ok).toBe(false);
    }
    expect(await confirmMoveAction(TOKEN, "en", "2027-06-01T10:00:00.000Z"))
      .toEqual({ ok: false, error: en.slotTaken, slotTaken: true });
    expect(m.moveBooking).not.toHaveBeenCalled();
  });

  it("never logs the token, even when the read fails (mutation: log the token → FAILS)", async () => {
    const spies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    m.readMoveContext.mockRejectedValueOnce(new Error("db down"));
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.moveGenericError });
    m.moveBooking.mockRejectedValueOnce(new Error("insert failed"));
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.moveGenericError });
    const logged = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(TOKEN);
  });
});

describe("confirmMoveAction — the move", () => {
  it("moves to the neighbour the booking's own buffer used to hide, as the public link, on the row's booking (mutation: keep the own booking busy → 11:00 is refused, FAILS)", async () => {
    const r = await confirmMoveAction(TOKEN, "en", ELEVEN);
    expect(r).toMatchObject({ ok: true, startsAt: ELEVEN });
    expect(m.moveBooking).toHaveBeenCalledTimes(1);
    const [, accountId, bookingId, to, actorId, actorType] = m.moveBooking.mock.calls[0]!;
    expect([accountId, bookingId, actorId, actorType]).toEqual([ACCOUNT_ID, "bk_old", "public", "system"]);
    expect(to).toMatchObject({ startsAt: new Date(ELEVEN), endsAt: new Date("2027-06-01T12:00:00.000Z") });
  });

  it("answers the NEW booking's links, built on the row's own calendar, in the customer's language", async () => {
    const r = await confirmMoveAction(TOKEN, "es", ELEVEN);
    expect(r).toEqual({
      ok: true, startsAt: ELEVEN, emailSent: true,
      manageUrl: `https://app.example/b/pubrow12345/cancel/${NEW_TOKEN}?locale=es`,
      calendarUrl: `https://app.example/b/pubrow12345/ics/${NEW_TOKEN}?locale=es`,
    });
  });

  it("a slot taken in the race is slotTaken, a booking changed in the race is `gone`, and neither tells anyone", async () => {
    m.moveBooking.mockRejectedValueOnce(new SlotTakenError());
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.slotTaken, slotTaken: true });
    m.moveBooking.mockRejectedValueOnce(new BookingNotMovableError());
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toEqual({ ok: false, error: en.moveAlreadyChanged, gone: true });
    expect(gated()).toEqual([]);
    expect(m.createMessage).not.toHaveBeenCalled();
  });

  it("a video calendar gets a NEW room for the new time; a provider that throws never costs the move", async () => {
    m.readMoveContext.mockResolvedValue(context({}, { meeting_type: "video" }));
    const createMeetingRoom = vi.fn().mockResolvedValue({ url: "https://meet.example/new-room" });
    getMeetingProviderMock.mockReturnValue({ createMeetingRoom });
    await confirmMoveAction(TOKEN, "en", ELEVEN);
    expect(createMeetingRoom).toHaveBeenCalledWith({ bookingId: "pubrow12345", endsAt: new Date("2027-06-01T12:00:00.000Z") });
    expect(m.moveBooking.mock.calls[0]![3]).toMatchObject({ meetingUrl: "https://meet.example/new-room" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    createMeetingRoom.mockRejectedValueOnce(new Error("daily down"));
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toMatchObject({ ok: true });
    expect(m.moveBooking.mock.calls[1]![3].meetingUrl).toBeUndefined();
  });
});

describe("confirmMoveAction — who is told", () => {
  it("the business: operator.move_notice to each notify address, with both times, and a line in the contact's thread (mutation: skip the alert → FAILS)", async () => {
    await confirmMoveAction(TOKEN, "es", ELEVEN);
    const staff = gated().filter((g) => g.kind === "operator.move_notice");
    expect(staff.map((g) => [g.to, g.accountId, g.fromAddress])).toEqual([["owner@acme.com", ACCOUNT_ID, undefined]]);
    // English, the business's zone (UTC here): the dashboard is English.
    const was = formatWhen(new Date(OWN.starts_at), "UTC");
    const now = formatWhen(new Date(ELEVEN), "UTC");
    expect(was).toContain("10:00");
    expect(staff[0]!.subject).toBe(`Booking moved: ${was} to ${now} — Jane Doe`);
    const [, accountId, msg, actorId, actorType] = m.createMessage.mock.calls[0]!;
    expect([accountId, actorId, actorType]).toEqual([ACCOUNT_ID, "public", "system"]);
    expect(msg).toMatchObject({
      conversationId: "convo_1", channel: "form", direction: "inbound", subject: "Booking moved",
      body: `Moved their booking from ${was} to ${now}`,
    });
    expect(m.incrementUnreadCount).toHaveBeenCalledWith({}, ACCOUNT_ID, "convo_1");
  });

  it("the customer: booking.moved, customer-initiated, in their language, from the business's address, with the NEW links (mutation: send the old token's links → FAILS)", async () => {
    await confirmMoveAction(TOKEN, "es", ELEVEN);
    const mine = gated().filter((g) => g.kind === "booking.moved");
    expect(mine).toHaveLength(1);
    const g = mine[0]!;
    expect([g.to, g.accountId, g.contactId, g.language, g.fromAddress, g.replyTo, g.origin])
      .toEqual(["jane@example.com", ACCOUNT_ID, "contact_1", "es", "hello@acme.com", "owner-reply@acme.com", "https://app.example"]);
    expect(g.subject).toBe("Tu cita fue reprogramada");
    expect(g.body).toContain(`https://app.example/b/pubrow12345/cancel/${NEW_TOKEN}?locale=es`);
    expect(g.body).toContain(`https://app.example/b/pubrow12345/move/${NEW_TOKEN}?locale=es`);
    expect(g.body).toContain(`https://app.example/b/pubrow12345/ics/${NEW_TOKEN}?locale=es`);
    expect(g.body).not.toContain(TOKEN);
    // The new time in the customer's own zone (stored at booking time), in Spanish.
    expect(g.body).toContain(formatWhen(new Date(ELEVEN), "America/Chicago", "es"));
    expect(formatWhen(new Date(ELEVEN), "America/Chicago", "es")).toMatch(/6:00\sa\.\s?m\./);
  });

  it("a send that fails never fails the move: ok, with emailSent false", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    providerThrows.current = true;
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toMatchObject({ ok: true, emailSent: false });
  });

  it("a contact with no email: the business is still told, the customer email is not attempted", async () => {
    m.getContact.mockResolvedValue({ id: "contact_1", first_name: "Jane", last_name: null, email: "  " });
    expect(await confirmMoveAction(TOKEN, "en", ELEVEN)).toMatchObject({ ok: true, emailSent: false });
    expect(gated().map((g) => g.kind)).toEqual(["operator.move_notice"]);
  });
});

describe("getMoveSlotsAction — the picker", () => {
  it("offers the day without the booking being moved, minus its own range (mutation: drop the exclusion → [] , FAILS)", async () => {
    expect(await getMoveSlotsAction(TOKEN, "en", "2027-06-01"))
      .toEqual({ slots: ["2027-06-01T09:00:00.000Z", ELEVEN] });
  });

  it("refuses a malformed token unread, a malformed day, and a booking that is not live", async () => {
    expect(await getMoveSlotsAction("nope", "en", "2027-06-01")).toEqual({ error: en.genericError });
    expect(m.readMoveContext).not.toHaveBeenCalled();
    expect(await getMoveSlotsAction(TOKEN, "es", "June 1")).toEqual({ error: es.genericError });
    m.readMoveContext.mockResolvedValueOnce(context({ status: "completed" }));
    expect(await getMoveSlotsAction(TOKEN, "en", "2027-06-01")).toEqual({ error: en.genericError });
  });
});

/**
 * The bilingual rule for owner-facing copy (the plan's §4.1 item 4, the
 * `todo.consent.*` precedent): the thread line is written in English today,
 * and its Spanish twin is written out beside it, waiting for an operator
 * locale.
 */
describe("the thread line's words (owner-facing, both languages written out)", () => {
  it("every calendar.move key has an en and an es twin, they differ, and both keep the placeholders (mutation: drop an .es twin → FAILS)", async () => {
    const { m: catalogue } = await import("@/lib/messages");
    const keys = Object.keys(catalogue).filter((k) => k.startsWith("calendar.move."));
    const stems = [...new Set(keys.map((k) => k.replace(/\.(en|es)$/, "")))];
    expect(stems.sort()).toEqual(["calendar.move.thread.body", "calendar.move.thread.subject"]);
    for (const stem of stems) {
      const en = (catalogue as Record<string, string>)[`${stem}.en`];
      const es = (catalogue as Record<string, string>)[`${stem}.es`];
      expect(en, `${stem}.en`).toBeTruthy();
      expect(es, `${stem}.es`).toBeTruthy();
      expect(es).not.toBe(en);
      for (const ph of en!.match(/\{\w+\}/g) ?? []) expect(es, `${stem}.es keeps ${ph}`).toContain(ph);
    }
  });
});
