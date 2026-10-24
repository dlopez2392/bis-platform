import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Task 7 (staff and roles): CalendarSettings and BookingsList are "use
// client" components (useState/useTransition), unreachable under
// renderToStaticMarkup — stubbed the same way contacts/page.test.ts stubs
// ContactsTable/AddContactDialog. Spies, not bare `() => null`: this file's
// whole claim is WHETHER the page calls CalendarSettings at all for a
// Staff caller, which only a spy can answer.
const calendarSettingsMock = vi.fn((_props: unknown) => null);
vi.mock("./calendar-settings", () => ({ CalendarSettings: (props: unknown) => calendarSettingsMock(props) }));
const bookingsListMock = vi.fn((_props: unknown) => null);
vi.mock("./bookings-list", () => ({ BookingsList: (props: unknown) => bookingsListMock(props) }));
// S-47d Task 12: "use client" (hooks) like CalendarSettings/BookingsList above — unreachable under
// renderToStaticMarkup, so a spy stub the same way.
const closedDaysCardMock = vi.fn((_props: unknown) => null);
vi.mock("./closed-days-card", () => ({ ClosedDaysCard: (props: unknown) => closedDaysCardMock(props) }));
vi.mock("./embed-snippet", () => ({ EmbedSnippet: () => null }));
vi.mock("./actions", () => ({
  updateCalendarSettingsAction: vi.fn(),
  setBookingStatusAction: vi.fn(),
  cancelNoticeOptionAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  undoCancelBookingAction: vi.fn(),
  keepAppointmentAction: vi.fn(),
}));
vi.mock("./closed-days-actions", () => ({
  addClosedDayAction: vi.fn(),
  removeClosedDayAction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }),
}));
// S-47d Task 12: the Closed days card's own locale read (`dashboard/page.test.ts`'s own precedent) —
// this page now resolves `requestLocale`, which needs the person's own prefs.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));

// `canManage` is the only field this suite drives; the rest match what
// requireAccountAccess actually returns (lib/auth.ts) so a signature drift
// there would show up as a type error on this mock, not a silent pass.
const authState = vi.hoisted(() => ({ canManage: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({
    userId: "user_1", isAgency: true, role: null, canManage: authState.canManage,
  }),
}));

const CALENDAR = {
  id: "cal_1", account_id: "a1", public_id: "pub_1", enabled: true,
  slot_duration_minutes: 30, buffer_minutes: 0, min_notice_hours: 1, max_advance_days: 30,
  open_hours: {}, notify_emails: [], meeting_type: "in_person" as const,
  followup_enabled: false, followup_body: "",
};
const dbMocks = vi.hoisted(() => ({
  getOrCreateCalendar: vi.fn(),
  listCalendarBookings: vi.fn(),
  serviceDb: vi.fn(() => ({})),
  // S-47d Task 12: the Closed days card's own two new reads (the brief's "override the two new
  // reads" — `getVoiceProfile` is left to the real `importOriginal` implementation: it throws
  // against the fake `dbForRequest` below (only "accounts" is stubbed), and the page's own
  // try/catch around the empty-state persona read is exactly what is under test there).
  listClosedDaysFrom: vi.fn(),
  listClosureAppointments: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrCreateCalendar: (...a: unknown[]) => dbMocks.getOrCreateCalendar(...a),
  listCalendarBookings: (...a: unknown[]) => dbMocks.listCalendarBookings(...a),
  serviceDb: () => dbMocks.serviceDb(),
  listClosedDaysFrom: (...a: unknown[]) => dbMocks.listClosedDaysFrom(...a),
  listClosureAppointments: (...a: unknown[]) => dbMocks.listClosureAppointments(...a),
}));

const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
      return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
    },
  }),
}));

const { default: CalendarPage } = await import("./page");

async function render(searchParams: { from?: string; closedDay?: string; locale?: string } = {}) {
  return renderToStaticMarkup(
    await CalendarPage({
      params: Promise.resolve({ accountId: "a1" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

describe("CalendarPage — settings are Owner-only (staff and roles)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointments.mockReset().mockResolvedValue([]);
    calendarSettingsMock.mockClear();
    bookingsListMock.mockClear();
    closedDaysCardMock.mockClear();
  });

  it("canManage: true (Owner/agency) renders both the settings form and the bookings list", async () => {
    authState.canManage = true;
    await render();
    expect(calendarSettingsMock).toHaveBeenCalledTimes(1);
    expect(bookingsListMock).toHaveBeenCalledTimes(1);
  });

  it("canManage: false (Staff) renders the bookings list and no settings form (mutation: render CalendarSettings unconditionally → FAILS)", async () => {
    authState.canManage = false;
    await render();
    expect(calendarSettingsMock).not.toHaveBeenCalled();
    expect(bookingsListMock).toHaveBeenCalledTimes(1);
  });
});

// S-47d Task 12 (spec 5.6.3): the page's own two new reads feed the Closed days card's props.
describe("CalendarPage — the Closed days card's props (S-47d Task 12)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointments.mockReset().mockResolvedValue([]);
    calendarSettingsMock.mockClear();
    bookingsListMock.mockClear();
    closedDaysCardMock.mockClear();
    authState.canManage = true;
  });

  it("is rendered for Owner/agency AND for Staff — it is never skipped the way CalendarSettings is (mutation: gate it on canManage in page.tsx → the Staff case FAILS)", async () => {
    await render();
    expect(closedDaysCardMock).toHaveBeenCalledTimes(1);
    authState.canManage = false;
    closedDaysCardMock.mockClear();
    await render();
    expect(closedDaysCardMock).toHaveBeenCalledTimes(1);
  });

  it("maps listClosedDaysFrom + per-range listClosureAppointments into the card's ranges prop (mutation: drop the per-range read → appointments stays [] → FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([
      { id: "cd_1", account_id: "a1", starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation", created_by: "owner", created_at: "2026-12-01T00:00:00.000Z" },
    ]);
    dbMocks.listClosureAppointments.mockResolvedValue([
      { id: "bk_1", contact_id: "c_1", starts_at: "2026-12-29T15:00:00.000Z", ends_at: "2026-12-29T15:30:00.000Z", closure_kept_at: null, first_name: "Ana", last_name: "Reyes" },
    ]);
    await render();
    const props = closedDaysCardMock.mock.calls[0]![0] as { ranges: unknown };
    expect(props.ranges).toEqual([
      {
        id: "cd_1", startsOn: "2026-12-28", endsOn: "2027-01-01", reason: "vacation",
        appointments: [{ id: "bk_1", contactId: "c_1", contactName: "Ana Reyes", startsAt: "2026-12-29T15:00:00.000Z", kept: false }],
      },
    ]);
  });

  it("a kept appointment maps kept: true (mutation: ignore closure_kept_at → FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([
      { id: "cd_1", account_id: "a1", starts_on: "2026-12-10", ends_on: "2026-12-10", reason: null, created_by: "owner", created_at: "2026-12-01T00:00:00.000Z" },
    ]);
    dbMocks.listClosureAppointments.mockResolvedValue([
      { id: "bk_1", contact_id: "c_1", starts_at: "2026-12-10T15:00:00.000Z", ends_at: "2026-12-10T15:30:00.000Z", closure_kept_at: "2026-12-05T00:00:00.000Z", first_name: "Ana", last_name: "Reyes" },
    ]);
    await render();
    const props = closedDaysCardMock.mock.calls[0]![0] as { ranges: { appointments: { kept: boolean }[] }[] };
    expect(props.ranges[0]!.appointments[0]!.kept).toBe(true);
  });

  it("a failed closed-days read passes ranges: null, the card's own error signal (mutation: swallow the error into [] → FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
    } finally {
      spy.mockRestore();
    }
    const props = closedDaysCardMock.mock.calls[0]![0] as { ranges: unknown };
    expect(props.ranges).toBeNull();
  });

  it("?closedDay= passes through as initialOpenClosedDay (mutation: drop the prop → FAILS)", async () => {
    await render({ closedDay: "2026-12-28" });
    const props = closedDaysCardMock.mock.calls[0]![0] as { initialOpenClosedDay: unknown };
    expect(props.initialOpenClosedDay).toBe("2026-12-28");
  });

  it("with no ?closedDay=, initialOpenClosedDay is null, not undefined (mutation: pass undefined → FAILS)", async () => {
    await render();
    const props = closedDaysCardMock.mock.calls[0]![0] as { initialOpenClosedDay: unknown };
    expect(props.initialOpenClosedDay).toBeNull();
  });
});
