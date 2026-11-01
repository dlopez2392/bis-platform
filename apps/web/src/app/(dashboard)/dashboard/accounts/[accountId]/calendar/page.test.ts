import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CLOSURE_APPOINTMENTS_LIMIT, type AgendaBookingRow } from "@bis/db";

// Task 7 (staff and roles): CalendarSettings is a "use
// client" component (useState/useTransition), unreachable under
// renderToStaticMarkup — stubbed the same way contacts/page.test.ts stubs
// ContactsTable/AddContactDialog. Spies, not bare `() => null`: this file's
// whole claim is WHETHER the page calls CalendarSettings at all for a
// Staff caller, which only a spy can answer.
// F-046 part 1 (plan Task 12): the stubs that mark their place in the markup draw a `data-stub` element, so
// the page's ORDER is assertable (the agenda before the settings card), not only whether each was called.
const order: string[] = [];
const calendarSettingsMock = vi.fn((_props: unknown) => createElement("div", { "data-stub": "settings" }));
vi.mock("./calendar-settings", () => ({ CalendarSettings: (props: unknown) => calendarSettingsMock(props) }));
// F-046 part 1: the Agenda card (an async server component that reads its own window; its own tests are
// agenda-card.test.ts) and the job drawer (T11's "use client" sheet) are spies here: this file's claims are
// the page's ORDER, the props it hands them and the ?job= read and log that happen in the page itself.
const agendaCardMock = vi.fn((_props: unknown) => createElement("div", { "data-stub": "agenda" }));
vi.mock("./agenda-card", () => ({ AgendaCard: (props: unknown) => agendaCardMock(props) }));
const jobDrawerMock = vi.fn((_props: unknown) => { order.push("drawer"); return createElement("div", { "data-stub": "drawer" }); });
vi.mock("./job-drawer", () => ({ JobDrawer: (props: unknown) => jobDrawerMock(props) }));
const noteOpenedMock = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock("@/lib/access-log/note", () => ({
  noteOpened: async (...a: unknown[]) => { order.push("note"); return noteOpenedMock(...a); },
}));
// S-47d Task 12: "use client" (hooks) like CalendarSettings above — unreachable under
// renderToStaticMarkup, so a spy stub the same way.
const closedDaysCardMock = vi.fn((_props: unknown) => null);
vi.mock("./closed-days-card", () => ({ ClosedDaysCard: (props: unknown) => closedDaysCardMock(props) }));
vi.mock("./embed-snippet", () => ({ EmbedSnippet: () => null }));
// F-048 part 2: the "Bookings on your phone" card ("use client", hooks) and its server read and actions.
const feedCardMock = vi.fn((_props: unknown) => null);
vi.mock("./feed-card", () => ({ FeedCard: (props: unknown) => feedCardMock(props) }));
const feedViewMock = vi.hoisted(() => vi.fn(async (_a: unknown): Promise<unknown> => ({ kind: "none" as const })));
vi.mock("./feed-card-data", () => ({ loadFeedCardView: (a: unknown) => feedViewMock(a) }));
vi.mock("./feed-actions", () => ({
  makeFeedLinkAction: vi.fn(), replaceFeedLinkAction: vi.fn(), turnOffFeedLinkAction: vi.fn(), undoFeedLinkAction: vi.fn(),
}));
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
  // F-046 part 1: the ?job= drawer's reads, in the page itself (plan correction 7).
  readAgendaJob: vi.fn(),
  listPeopleNames: vi.fn(),
  jobWasTold: vi.fn(),
  getContact: vi.fn(),
  serviceDb: vi.fn(() => ({})),
  // S-47d Task 12: the Closed days card's own two new reads.
  listClosedDaysFrom: vi.fn(),
  // Fix round (sonnet review): one query scoped to the ranges themselves, replacing the enclosing-span
  // read that spent the shared cap on ordinary bookings in the gaps between far-apart ranges.
  listClosureAppointmentsForRanges: vi.fn(),
  // Fix round: the persona read is mocked now (D3: no profile, a profile, a failed read each decide the
  // empty sentence), and the held-message counts per listed booking (C8).
  getVoiceProfile: vi.fn(),
  countHeldByBooking: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOrCreateCalendar: (...a: unknown[]) => dbMocks.getOrCreateCalendar(...a),
  listCalendarBookings: (...a: unknown[]) => dbMocks.listCalendarBookings(...a),
  readAgendaJob: (...a: unknown[]) => dbMocks.readAgendaJob(...a),
  listPeopleNames: (...a: unknown[]) => dbMocks.listPeopleNames(...a),
  jobWasTold: (...a: unknown[]) => dbMocks.jobWasTold(...a),
  getContact: (...a: unknown[]) => dbMocks.getContact(...a),
  serviceDb: () => dbMocks.serviceDb(),
  listClosedDaysFrom: (...a: unknown[]) => dbMocks.listClosedDaysFrom(...a),
  listClosureAppointmentsForRanges: (...a: unknown[]) => dbMocks.listClosureAppointmentsForRanges(...a),
  getVoiceProfile: (...a: unknown[]) => dbMocks.getVoiceProfile(...a),
  countHeldByBooking: (...a: unknown[]) => dbMocks.countHeldByBooking(...a),
}));

const accountRead = vi.fn(async (): Promise<{ data: unknown; error: unknown }> =>
  ({ data: { timezone: "America/Chicago" }, error: null }));
// ONE object per run, so a read can be asserted to run on THIS client (the request's, RLS) and never serviceDb().
const REQUEST_DB = vi.hoisted(() => ({ from: (_t: string): unknown => undefined }));
REQUEST_DB.from = (table: string) => {
  if (table !== "accounts") throw new Error(`unexpected read of ${table}`);
  return { select: () => ({ eq: () => ({ maybeSingle: () => accountRead() }) }) };
};
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST_DB }));

const { default: CalendarPage } = await import("./page");
const { m } = await import("@/lib/messages");
const { renderedText } = await import("@/lib/rendered-text");

async function render(searchParams: { from?: string; closedDay?: string; locale?: string; view?: string; day?: string; job?: string } = {}) {
  return renderToStaticMarkup(
    await CalendarPage({
      params: Promise.resolve({ accountId: "a1" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );
}

/** minors-1b item 5's second-account test: the SAME render, a different route accountId. */
async function renderForAccount(accountId: string) {
  return renderToStaticMarkup(
    await CalendarPage({
      params: Promise.resolve({ accountId }),
      searchParams: Promise.resolve({}),
    }),
  );
}

describe("CalendarPage — settings are Owner-only (staff and roles)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointmentsForRanges.mockReset().mockResolvedValue([]);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    calendarSettingsMock.mockClear();
    agendaCardMock.mockClear();
    closedDaysCardMock.mockClear();
  });

  it("canManage: true (Owner/agency) renders both the settings form and the agenda", async () => {
    authState.canManage = true;
    authState.isAgency = true;
    authState.role = null;
    await render();
    expect(calendarSettingsMock).toHaveBeenCalledTimes(1);
    expect(agendaCardMock).toHaveBeenCalledTimes(1);
  });

  it("canManage: false (Staff) renders the agenda and no settings form (mutation: render CalendarSettings unconditionally → FAILS)", async () => {
    authState.canManage = false;
    await render();
    expect(calendarSettingsMock).not.toHaveBeenCalled();
    expect(agendaCardMock).toHaveBeenCalledTimes(1);
  });
});

// S-47d Task 12 (spec 5.6.3): the page's own two new reads feed the Closed days card's props.
describe("CalendarPage — the Closed days card's props (S-47d Task 12)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointmentsForRanges.mockReset().mockResolvedValue([]);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    calendarSettingsMock.mockClear();
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

  it("maps listClosedDaysFrom + the ranges-scoped read into the card.s ranges prop (mutation: drop the read → appointments stays [] → FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([
      { id: "cd_1", account_id: "a1", starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation", created_by: "owner", created_at: "2026-12-01T00:00:00.000Z" },
    ]);
    dbMocks.listClosureAppointmentsForRanges.mockResolvedValue([
      { id: "bk_1", contact_id: "c_1", starts_at: "2026-12-29T15:00:00.000Z", ends_at: "2026-12-29T15:30:00.000Z", closure_kept_at: null, first_name: "Ana", last_name: "Reyes" },
    ]);
    await render();
    const props = closedDaysCardMock.mock.calls[0]![0] as { ranges: unknown };
    expect(props.ranges).toEqual([
      {
        id: "cd_1", startsOn: "2026-12-28", endsOn: "2027-01-01", reason: "vacation", capped: false,
        appointments: [{ id: "bk_1", contactId: "c_1", contactName: "Ana Reyes", startsAt: "2026-12-29T15:00:00.000Z", kept: false, held: 0 }],
      },
    ]);
  });

  it("a kept appointment maps kept: true (mutation: ignore closure_kept_at → FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([
      { id: "cd_1", account_id: "a1", starts_on: "2026-12-10", ends_on: "2026-12-10", reason: null, created_by: "owner", created_at: "2026-12-01T00:00:00.000Z" },
    ]);
    dbMocks.listClosureAppointmentsForRanges.mockResolvedValue([
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
    dbMocks.listClosureAppointmentsForRanges.mockReset().mockResolvedValue([]);
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
    const RANGE2 = { ...RANGE, id: "cd_2", starts_on: "2027-01-10", ends_on: "2027-01-10" };
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE, RANGE2]);
    // minors-1b item 5 fix round (sonnet review): ONE read, scoped to the ranges' OWN windows (never
    // the enclosing span) — bk_3 lands in RANGE2's own window (Jan 10), distinct from bk_1/bk_2's Dec 29
    // (RANGE's own window).
    dbMocks.listClosureAppointmentsForRanges.mockResolvedValue([
      APPT("bk_1"), APPT("bk_2"),
      { ...APPT("bk_3"), starts_at: "2027-01-10T15:00:00.000Z", ends_at: "2027-01-10T15:30:00.000Z" },
    ]);
    dbMocks.countHeldByBooking.mockResolvedValue(new Map([["bk_2", 3]]));
    await render();
    expect(dbMocks.listClosureAppointmentsForRanges).toHaveBeenCalledTimes(1);
    // Each range's OWN window, never one span covering both (fix round: that was the bug).
    expect(dbMocks.listClosureAppointmentsForRanges).toHaveBeenCalledWith(
      expect.anything(), "a1",
      [
        { fromIso: "2026-12-28T06:00:00.000Z", toIso: "2027-01-02T06:00:00.000Z" },
        { fromIso: "2027-01-10T06:00:00.000Z", toIso: "2027-01-11T06:00:00.000Z" },
      ],
    );
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

  // minors-1b item 5's second-account test: the ranges-scoped read is per-ACCOUNT (never a second
  // account's bookings), and no range means no read at all — both proved against a stub that fails the
  // test by throwing if ever called with the wrong account.
  it("the ranges-scoped read, when there are ranges, carries the route's OWN accountId (second-account test; mutation: hardcode \"a1\" -> FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE]);
    dbMocks.listClosureAppointmentsForRanges.mockImplementation(async (_db: unknown, acct: string) => {
      if (acct !== "a2") throw new Error(`expected account "a2", got "${acct}"`);
      return [];
    });
    await renderForAccount("a2");
    expect(dbMocks.listClosureAppointmentsForRanges).toHaveBeenCalledTimes(1);
    expect(dbMocks.listClosureAppointmentsForRanges.mock.calls[0]![1]).toBe("a2");
  });

  it("no closed days at all: listClosureAppointmentsForRanges is never called (mutation: always read -> FAILS)", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([]);
    await render();
    expect(dbMocks.listClosureAppointmentsForRanges).not.toHaveBeenCalled();
  });

  // Fix round (sonnet review, CHANGES REQUESTED): the first cut of the "one query" fix spanned
  // [earliest start, latest end + 1 day) — a booking in the GAP between two far-apart ranges (never
  // touched by either closure) was fetched anyway and spent a slot of the shared row cap. Asserted here
  // as the query SHAPE itself (the coordinator's own "(assert the query shape)" instruction), because a
  // booking in the gap is excluded from the DISPLAY either way (the per-range split downstream filters
  // by each range's own window regardless of what was fetched) — the bug is the WASTED cap slot on the
  // fetch, not a wrong display, so the fetch's own arguments are what must be checked. Two ranges months
  // apart (Dec 28 - Jan 1, and March 1): if page.tsx ever goes back to asking for one range spanning the
  // whole union, the gap month (January-February) would be IN that one range's window, and this
  // assertion — the exact two narrow windows, never one wide one — fails.
  it("a booking in the gap between two ranges is never asked for: the query shape is the two ranges' own windows, never the enclosing span (mutation: go back to the enclosing span -> FAILS)", async () => {
    const RANGE2 = { ...RANGE, id: "cd_2", starts_on: "2027-03-01", ends_on: "2027-03-01" }; // months later
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE, RANGE2]);
    await render();
    expect(dbMocks.listClosureAppointmentsForRanges).toHaveBeenCalledTimes(1);
    const [, , rangesArg] = dbMocks.listClosureAppointmentsForRanges.mock.calls[0]! as [
      unknown, string, { fromIso: string; toIso: string }[],
    ];
    expect(rangesArg).toEqual([
      { fromIso: "2026-12-28T06:00:00.000Z", toIso: "2027-01-02T06:00:00.000Z" },
      { fromIso: "2027-03-01T06:00:00.000Z", toIso: "2027-03-02T06:00:00.000Z" },
    ]);
    // Never a single range whose own span would have covered the January/February gap between them.
    expect(rangesArg).toHaveLength(2);
  });

  // The "more later" caveat: page.tsx computes it from the READ's own total length hitting
  // CLOSURE_APPOINTMENTS_LIMIT, shared across every listed range (the read is one query).
  it("hitting CLOSURE_APPOINTMENTS_LIMIT marks every listed range capped (mutation: compute capped from one range's own count -> FAILS)", async () => {
    const RANGE2 = { ...RANGE, id: "cd_2", starts_on: "2027-01-10", ends_on: "2027-01-10" };
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE, RANGE2]);
    dbMocks.listClosureAppointmentsForRanges.mockResolvedValue(
      Array.from({ length: CLOSURE_APPOINTMENTS_LIMIT }, (_, i) => APPT(`bk_${i}`)),
    );
    await render();
    const ranges = props().ranges as { capped: boolean }[];
    expect(ranges.map((r) => r.capped)).toEqual([true, true]);
  });

  it("under the cap, no range is marked capped", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([RANGE]);
    dbMocks.listClosureAppointmentsForRanges.mockResolvedValue([APPT("bk_1")]);
    await render();
    const ranges = props().ranges as { capped: boolean }[];
    expect(ranges.map((r) => r.capped)).toEqual([false]);
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

describe("CalendarPage — the phone calendar card (F-048 part 2)", () => {
  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointmentsForRanges.mockReset().mockResolvedValue([]);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    feedCardMock.mockClear();
    feedViewMock.mockClear();
    authState.canManage = true;
    authState.isAgency = true;
    authState.role = null;
  });

  it("every role gets it once: Owner, Staff, Technician and the agency (D1; mutation: gate it on canManage → FAILS)", async () => {
    for (const s of [
      { isAgency: false, role: "owner" as const, canManage: true },
      { isAgency: false, role: "staff" as const, canManage: false },
      { isAgency: false, role: "technician" as const, canManage: false },
      { isAgency: true, role: null, canManage: true },
    ]) {
      Object.assign(authState, s);
      feedCardMock.mockClear();
      await render();
      expect(feedCardMock, JSON.stringify(s)).toHaveBeenCalledTimes(1);
    }
  });

  it("second account: the view is read for the ROUTE's account and the caller's own Clerk id (mutation: pass a fixed id → FAILS)", async () => {
    Object.assign(authState, { isAgency: false, role: "technician", canManage: false });
    await render();
    expect(feedViewMock).toHaveBeenLastCalledWith({
      accountId: "a1", clerkUserId: "user_1", isAgency: false, role: "technician", origin: "https://app.example.com",
    });
    await renderForAccount("a2");
    expect(feedViewMock).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "a2", clerkUserId: "user_1" }));
  });

  it("the view it returns is the view the card gets, with the page's locale", async () => {
    const view = { kind: "live", url: "https://x/cal/t.ics", webcal: "webcal://x/cal/t.ics", lastFetchedAt: null, technician: false };
    feedViewMock.mockResolvedValueOnce(view);
    // A client Owner on a Spanish account: the page resolves es, and the card speaks it.
    Object.assign(authState, { isAgency: false, role: "owner", canManage: true });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    await render();
    const props = feedCardMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.view).toBe(view);
    expect(props.locale).toBe("es");
    for (const k of ["make", "replace", "turnOff", "undo"]) expect(typeof props[k], k).toBe("function");
  });
});

// F-046 part 1 (plan Task 12, spec 5.1, 5.5, 8.2): the agenda opens the page; ?job= opens one job's drawer,
// read on the caller's own client and logged as an open of its customer BEFORE the drawer is drawn.
describe("CalendarPage — the agenda and the job drawer (F-046 part 1)", () => {
  const JOB = "11111111-2222-4333-8444-555555555555";
  const JOB_ROW: AgendaBookingRow = {
    id: JOB, contact_id: "c_9", starts_at: "2026-12-02T16:00:00.000Z", ends_at: "2026-12-02T17:00:00.000Z", status: "booked",
    note: "Fix the gate", author_kind: "person", author_id: "user_2", meeting_type: null, meeting_url: null, place_id: null,
    confirm_reply: null, hold_until: null, hold_settled_at: null, notice_wanted: null, notice_sent_at: null,
    rescheduled_from_id: null, created_at: "2026-11-30T12:00:00.000Z",
    contact: { first_name: "Ana", last_name: "Reyes", phone: null, email: null }, place: null, replaced: false,
  };
  const agendaProps = () => agendaCardMock.mock.calls[0]![0] as Record<string, unknown>;
  const drawerProps = () => jobDrawerMock.mock.calls[0]![0] as { view: Record<string, unknown>; closeHref: string };

  beforeEach(() => {
    dbMocks.getOrCreateCalendar.mockReset().mockResolvedValue(CALENDAR);
    dbMocks.listCalendarBookings.mockReset().mockResolvedValue([]);
    dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
    dbMocks.listClosureAppointmentsForRanges.mockReset().mockResolvedValue([]);
    dbMocks.getVoiceProfile.mockReset().mockResolvedValue(null);
    dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
    dbMocks.readAgendaJob.mockReset().mockResolvedValue(JOB_ROW);
    dbMocks.listPeopleNames.mockReset().mockResolvedValue({ user_2: "Dan" });
    dbMocks.jobWasTold.mockReset().mockResolvedValue(false);
    dbMocks.getContact.mockReset().mockResolvedValue({ language: "es" });
    agendaCardMock.mockClear();
    jobDrawerMock.mockClear();
    calendarSettingsMock.mockClear();
    closedDaysCardMock.mockClear();
    feedCardMock.mockClear();
    noteOpenedMock.mockClear();
    order.length = 0;
    Object.assign(authState, { canManage: true, isAgency: true, role: null });
  });

  it("the agenda renders BEFORE the settings card (mutation: the old order -> FAILS)", async () => {
    const html = await render();
    expect(html.indexOf('data-stub="agenda"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-stub="agenda"')).toBeLessThan(html.indexOf('data-stub="settings"'));
  });

  it("the page no longer reads the old list (listCalendarBookings leaves the page)", async () => {
    await render();
    expect(dbMocks.listCalendarBookings).not.toHaveBeenCalled();
  });

  // S-10 T4: the page's own title was a bare m[] read, English on every locale.
  it("the page header's title follows the account's language (mutation: render m[\"calendar.title\"] directly -> FAILS)", async () => {
    Object.assign(authState, { isAgency: false, role: "owner", canManage: true });
    accountRead.mockResolvedValueOnce({ data: { timezone: "America/Chicago", language: "es" }, error: null });
    const html = await render();
    const h1 = /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1];
    expect(h1).toBe(m["calendar.title.es"]);
    expect(h1).not.toBe(m["calendar.title"]);
  });

  it("PageHeader carries no button; Add job lives in the agenda card, whose props carry canAdd (mutation: an action in PageHeader -> FAILS)", async () => {
    const html = await render();
    const head = html.slice(0, html.indexOf('data-stub="agenda"'));
    expect(head).toContain("<h1");
    expect(head).not.toContain("<button");
    expect(head).not.toContain("data-variant");
    expect(agendaProps()).toMatchObject({ canAdd: true, accountId: "a1", viewerId: "user_1", timezone: "America/Chicago" });
    expect(agendaProps().db).toBe(REQUEST_DB); // RLS decides what a Technician sees (R5): never serviceDb()
  });

  it("view and day come from the URL; no day is today in the account's zone; the page's one instant reaches the card", async () => {
    await render({ view: "week", day: "2026-12-09" });
    expect(agendaProps()).toMatchObject({ view: "week", day: "2026-12-09" });
    agendaCardMock.mockClear();
    await render();
    const p = agendaProps();
    expect(p.view).toBe("day");
    expect(p.day).toBe(p.today);
    expect(typeof p.nowIso).toBe("string");
  });

  it("?job=: read on the REQUEST client, noted as an open of its customer BEFORE the drawer, and the drawer gets the view (mutation: serviceDb() -> FAILS)", async () => {
    await render({ job: JOB, day: "2026-12-02" });
    expect(dbMocks.readAgendaJob).toHaveBeenCalledWith(REQUEST_DB, "a1", JOB);
    expect(noteOpenedMock).toHaveBeenCalledTimes(1);
    const [accessArg, accountArg, ref] = noteOpenedMock.mock.calls[0]!;
    expect((accessArg as { userId: string }).userId).toBe("user_1");
    expect(accountArg).toBe("a1");
    expect(ref).toEqual({ kind: "contact", recordId: "c_9" });
    expect(order).toEqual(["note", "drawer"]);
    expect(drawerProps().view).toMatchObject({ id: JOB, customer: { id: "c_9", name: "Ana Reyes", language: "es" }, madeBy: "Added by Dan" });
    expect(drawerProps().closeHref).toBe("/dashboard/accounts/a1/calendar?view=day&day=2026-12-02");
  });

  it("?job= with no day opens the job's OWN day", async () => {
    await render({ job: JOB });
    expect(agendaProps()).toMatchObject({ view: "day", day: "2026-12-02" });
  });

  it("a job the caller cannot see: no drawer, no note, and the gone line (mutation: note before the read's answer -> FAILS)", async () => {
    dbMocks.readAgendaJob.mockResolvedValue(null);
    const html = await render({ job: JOB });
    expect(jobDrawerMock).not.toHaveBeenCalled();
    expect(noteOpenedMock).not.toHaveBeenCalled();
    expect(html).toContain("data-job-gone");
    expect(renderedText(html)).toContain(m["calendar.job.gone"]);
  });

  it("a job param that is not a uuid is ignored: no read", async () => {
    await render({ job: "not-a-uuid" });
    expect(dbMocks.readAgendaJob).not.toHaveBeenCalled();
    expect(jobDrawerMock).not.toHaveBeenCalled();
  });

  it("a failed job read logs, draws no drawer and no note, and every card still renders", async () => {
    dbMocks.readAgendaJob.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const html = await render({ job: JOB });
      expect(jobDrawerMock).not.toHaveBeenCalled();
      expect(noteOpenedMock).not.toHaveBeenCalled();
      expect(html).toContain('data-stub="agenda"');
      expect(closedDaysCardMock).toHaveBeenCalled();
      expect(feedCardMock).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("a failed job read says so in its OWN words, never the agenda's 'Couldn't load your schedule' over a loaded agenda (T11/T12 review; mutation: calendar.agenda.error -> FAILS)", async () => {
    dbMocks.readAgendaJob.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const text = renderedText(await render({ job: JOB }));
      expect(text).toContain(m["calendar.job.readFailed"]);
      expect(text).not.toContain(m["calendar.agenda.error"]);
    } finally { spy.mockRestore(); }
  });

  it("the pseudo-locale reaches the drawer, as it reaches the agenda (design review C1; mutation: drop the prop -> FAILS)", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      await render({ job: JOB, locale: "pseudo" });
    } finally {
      vi.unstubAllEnvs();
    }
    expect((jobDrawerMock.mock.calls[0]![0] as { pseudo?: boolean }).pseudo).toBe(true);
    expect(agendaProps().pseudo).toBe(true);
  });

  it("a Technician: canAdd false, and the drawer's canWrite false with canCloseOut true (owner decision 1)", async () => {
    Object.assign(authState, { isAgency: false, role: "technician", canManage: false });
    await render({ job: JOB });
    expect(agendaProps().canAdd).toBe(false);
    expect(drawerProps().view).toMatchObject({ canWrite: false, canCloseOut: true });
  });

  it("Staff: canAdd and canWrite true (seesWholeAccount)", async () => {
    Object.assign(authState, { isAgency: false, role: "staff", canManage: false });
    await render({ job: JOB });
    expect(agendaProps().canAdd).toBe(true);
    expect(drawerProps().view).toMatchObject({ canWrite: true });
  });

  it("second account: the card and the job read carry the ROUTE's account (mutation: hardcode \"a1\" -> FAILS)", async () => {
    await renderForAccount("a2");
    expect(agendaProps().accountId).toBe("a2");
    renderToStaticMarkup(await CalendarPage({ params: Promise.resolve({ accountId: "a2" }), searchParams: Promise.resolve({ job: JOB }) }));
    expect(dbMocks.readAgendaJob).toHaveBeenLastCalledWith(REQUEST_DB, "a2", JOB);
    expect(noteOpenedMock.mock.calls.at(-1)![1]).toBe("a2");
  });
});
