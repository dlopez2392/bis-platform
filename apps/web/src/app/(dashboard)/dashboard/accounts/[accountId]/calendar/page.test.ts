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
vi.mock("./embed-snippet", () => ({ EmbedSnippet: () => null }));
vi.mock("./actions", () => ({
  updateCalendarSettingsAction: vi.fn(),
  setBookingStatusAction: vi.fn(),
  cancelNoticeOptionAction: vi.fn(),
  cancelBookingAction: vi.fn(),
  undoCancelBookingAction: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }),
}));

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
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrCreateCalendar: (...a: unknown[]) => dbMocks.getOrCreateCalendar(...a),
  listCalendarBookings: (...a: unknown[]) => dbMocks.listCalendarBookings(...a),
  serviceDb: () => dbMocks.serviceDb(),
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

async function render() {
  return renderToStaticMarkup(
    await CalendarPage({
      params: Promise.resolve({ accountId: "a1" }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe("CalendarPage — settings are Owner-only (staff and roles)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    calendarSettingsMock.mockClear();
    bookingsListMock.mockClear();
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
