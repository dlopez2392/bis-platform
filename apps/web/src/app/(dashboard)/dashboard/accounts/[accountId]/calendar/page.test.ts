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
const authState = vi.hoisted(() => ({ canManage: true, isAgency: true, role: null as "owner" | "staff" | "technician" | null }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({
    userId: "user_1", isAgency: authState.isAgency, role: authState.role, canManage: authState.canManage,
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
  // S-47d Task 12: the Closed days card's own two new reads.
  listClosedDaysFrom: vi.fn(),
  listClosureAppointments: vi.fn(),
  // Fix round: the persona read is mocked now (D3: no profile, a profile, a failed read each decide the
  // empty sentence), and the held-message counts per listed booking (C8).
  getVoiceProfile: vi.fn(),
  countHeldByBooking: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrCreateCalendar: (...a: unknown[]) => dbMocks.getOrCreateCalendar(...a),
  listCalendarBookings: (...a: unknown[]) => dbMocks.listCalendarBookings(...a),
  serviceDb: () => dbMocks.serviceDb(),
  listClosedDaysFrom: (...a: unknown[]) => dbMocks.listClosedDaysFrom(...a),
  listClosureAppointments: (...a: unknown[]) => dbMocks.listClosureAppointments(...a),
  getVoiceProfile: (...a: unknown[]) => dbMocks.getVoiceProfile(...a),
  countHeldByBooking: (...a: unknown[]) => dbMocks.countHeldByBooking(...a),
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
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    calendarSettingsMock.mockClear();
    bookingsListMock.mockClear();
    closedDaysCardMock.mockClear();
  });

  it("canManage: true (Owner/agency) renders both the settings form and the bookings list", async () => {
    authState.canManage = true;
    authState.isAgency = true;
    authState.role = null;
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
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    calendarSettingsMock.mockClear();
    bookingsListMock.mockClear();
    closedDaysCardMock.mockClear();
    authState.canManage = true;
    authState.isAgency = true;
    authState.role = null;
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
        appointments: [{ id: "bk_1", contactId: "c_1", contactName: "Ana Reyes", startsAt: "2026-12-29T15:00:00.000Z", kept: false, held: 0 }],
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

// S-47d fix round (final review): what the page now hands the card beyond Task 12's props.
describe("CalendarPage — the Closed days card's fix-round props", () => {
  const RANGE = { id: "cd_1", account_id: "a1", starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation", created_by: "owner", created_at: "2026-12-01T00:00:00.000Z" };
  const APPT = (id: string) => ({ id, contact_id: "c_1", starts_at: "2026-12-29T15:00:00.000Z", ends_at: "2026-12-29T15:30:00.000Z", closure_kept_at: null, first_name: "Ana", last_name: "Reyes" });
  const props = () => closedDaysCardMock.mock.calls[0]![0] as Record<string, unknown>;

  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointments.mockReset().mockResolvedValue([]);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    closedDaysCardMock.mockClear();
    authState.canManage = true;
    authState.isAgency = true;
    authState.role = null;
  });

  it("D3 (SD19): an account with NO voice profile passes persona null, never a typed \"Sofía\" (mutation: default to \"Sofía\" -> FAILS)", async () => {
    await render();
    expect(props().persona).toBeNull();
  });

  it("D3: a profile's own persona passes through, trimmed", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ persona_name: "  Max  " });
    await render();
    expect(props().persona).toBe("Max");
  });

  it("D3: a blank persona, or a failed read, names no one either", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ persona_name: "   " });
    await render();
    expect(props().persona).toBeNull();
    closedDaysCardMock.mockClear();
    dbMocks.getVoiceProfile.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render();
    } finally {
      spy.mockRestore();
    }
    expect(props().persona).toBeNull();
  });

  it("C8: the held-message counts are read ONCE for every listed booking, on the page's db, scoped to the account, and mapped onto each row (mutation: drop the read -> held stays 0 -> FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE, { ...RANGE, id: "cd_2", starts_on: "2027-01-10", ends_on: "2027-01-10" }]);
    dbMocks.listClosureAppointments.mockResolvedValueOnce([APPT("bk_1"), APPT("bk_2")]).mockResolvedValueOnce([APPT("bk_3")]);
    dbMocks.countHeldByBooking.mockResolvedValue(new Map([["bk_2", 3]]));
    await render();
    expect(dbMocks.countHeldByBooking).toHaveBeenCalledTimes(1);
    const [dbArg, accountArg, ids] = dbMocks.countHeldByBooking.mock.calls[0]! as [{ from: unknown }, string, string[]];
    expect(typeof dbArg.from).toBe("function"); // the page's own dbForRequest(), never serviceDb()
    expect(accountArg).toBe("a1");
    expect(ids).toEqual(["bk_1", "bk_2", "bk_3"]);
    const ranges = props().ranges as { appointments: { id: string; held: number }[] }[];
    expect(ranges[0]!.appointments.map((a) => [a.id, a.held])).toEqual([["bk_1", 0], ["bk_2", 3]]);
    expect(ranges[1]!.appointments.map((a) => [a.id, a.held])).toEqual([["bk_3", 0]]);
  });

  it("C8: no listed bookings, no held read", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE]);
    await render();
    expect(dbMocks.countHeldByBooking).not.toHaveBeenCalled();
  });

  it("C5: canAct is seesWholeAccount — true for the agency, an Owner and Staff, false for a Technician (mutation: pass canManage -> the Staff case FAILS)", async () => {
    await render();
    expect(props().canAct).toBe(true);
    for (const [role, expected] of [["owner", true], ["staff", true], ["technician", false]] as const) {
      closedDaysCardMock.mockClear();
      authState.isAgency = false;
      authState.role = role;
      authState.canManage = role === "owner";
      await render();
      expect(props().canAct, role).toBe(expected);
    }
  });

  it("C4: the account's zone reaches the card", async () => {
    await render();
    expect(props().timezone).toBe("America/Chicago");
  });

  it("D6: the pseudo-locale reaches the card only through the QA override (?locale=pseudo with BIS_I18N_QA)", async () => {
    await render({ locale: "pseudo" });
    expect(props().pseudo).toBe(false);
    closedDaysCardMock.mockClear();
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      await render({ locale: "pseudo" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(props().pseudo).toBe(true);
  });
});
