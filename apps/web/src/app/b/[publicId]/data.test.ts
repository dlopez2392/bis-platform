import { describe, it, expect, vi, beforeEach } from "vitest";

// S-47d (task 13): `loadClosureView` reads three @bis/db functions `isCalendarLive`'s own
// tests never touch, so this file needs the bare factory from here on. `getCalendarByPublicId`
// and `getBranding` stay plain `vi.fn()`s -- nothing below calls them.
const { getBusinessStatusRowMock, listClosedDaysFromMock, readHoursChainMock } = vi.hoisted(() => ({
  getBusinessStatusRowMock: vi.fn(),
  listClosedDaysFromMock: vi.fn(),
  readHoursChainMock: vi.fn(),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  getCalendarByPublicId: vi.fn(),
  getBranding: vi.fn(),
  getBusinessStatusRow: getBusinessStatusRowMock,
  listClosedDaysFrom: listClosedDaysFromMock,
  readHoursChain: readHoursChainMock,
}));

import { isCalendarLive, loadClosureView } from "./data";

describe("isCalendarLive", () => {
  it("is live only when enabled", () => {
    expect(isCalendarLive({ enabled: true })).toBe(true);
    // MUTATION: `return true;` unconditionally -- this FAILS.
    expect(isCalendarLive({ enabled: false })).toBe(false);
  });
});

/**
 * S-47d (task 13, spec section 5.3): what the public booking page says when
 * the one switch or a planned closed day puts the business out of hours
 * today, and which days inside the picker's own horizon are closed outright.
 *
 * The zone is America/Chicago (CST, no DST in the dates used below) so every
 * `now`/`until` below is a typed-out literal, never derived through the
 * function under test.
 */
describe("loadClosureView", () => {
  const TZ = "America/Chicago";
  const NO_HOURS = { businessHours: null, calendarHours: null };

  beforeEach(() => {
    getBusinessStatusRowMock.mockReset();
    listClosedDaysFromMock.mockReset();
    readHoursChainMock.mockReset();
    readHoursChainMock.mockResolvedValue(NO_HOURS);
    listClosedDaysFromMock.mockResolvedValue([]);
  });

  it("open, no row at all: no notice", async () => {
    getBusinessStatusRowMock.mockResolvedValue(null);
    const view = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(view.notice).toBeNull();
    expect(view.closedDayKeys).toEqual([]);
  });

  it("closed today (en/es): the literal closedTodayNotice, not built by this function", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "acct1", state: "closed_today", late_minutes: null, until: null,
      set_by: "owner", set_at: "2026-06-01T10:00:00.000Z",
    });
    const en = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(en.notice).toBe("Closed today. Please pick another day.");
    const es = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "es");
    expect(es.notice).toBe("Cerrado hoy. Elige otro día.");
  });

  it("a planned closed day covering today reads the SAME notice as closed_today (en/es)", async () => {
    getBusinessStatusRowMock.mockResolvedValue(null);
    listClosedDaysFromMock.mockResolvedValue([
      { id: "cd1", account_id: "acct1", starts_on: "2026-06-01", ends_on: "2026-06-01", reason: "holiday", created_by: "owner", created_at: "2026-05-01T00:00:00.000Z" },
    ]);
    const en = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(en.notice).toBe("Closed today. Please pick another day.");
    const es = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "es");
    expect(es.notice).toBe("Cerrado hoy. Elige otro día.");
  });

  it("storm with no back-on date (en/es): the literal stormNotice", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "acct1", state: "storm", late_minutes: null, until: null,
      set_by: "owner", set_at: "2026-06-01T10:00:00.000Z",
    });
    const en = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(en.notice).toBe("We're closed for now. Please check back soon.");
    const es = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "es");
    expect(es.notice).toBe("Por ahora estamos cerrados. Vuelve a consultar pronto.");
  });

  // Dec 24 2026 is a Thursday (pinned in the plan's own fixture); `until` is
  // local midnight Dec 24 in America/Chicago (CST, UTC-6 in December), so
  // reopeningFrom's answer IS that same midnight, time known false, and the
  // formatted {date} comes out "Thursday, December 24" / "jueves, 24 de
  // diciembre" -- asserted below as full literal sentences, never built by
  // calling the same Intl formula the production code uses.
  it("storm with a back-on date (en/es): the EXACT pinned sentence, not re-derived", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "acct1", state: "storm", late_minutes: null, until: "2026-12-24T06:00:00.000Z",
      set_by: "owner", set_at: "2026-12-01T00:00:00.000Z",
    });
    const now = new Date("2026-12-10T12:00:00.000Z");
    const en = await loadClosureView("acct1", TZ, now, 30, "en");
    expect(en.notice).toBe("Closed until Thursday, December 24. Please pick a day from then on.");
    const es = await loadClosureView("acct1", TZ, now, 30, "es");
    expect(es.notice).toBe("Cerrado hasta el jueves, 24 de diciembre. Elige un día a partir de esa fecha.");
  });

  // MUTATION: drop the running_late/open distinction (e.g. a `default` that
  // falls through to closedTodayNotice) -- this FAILS, since running_late
  // would then show a notice.
  it("running late: no notice", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "acct1", state: "running_late", late_minutes: 30, until: null,
      set_by: "owner", set_at: "2026-06-01T10:00:00.000Z",
    });
    const view = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(view.notice).toBeNull();
  });

  it("a failed read fails closed: no notice, no closed days, and a log line naming only the account id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getBusinessStatusRowMock.mockRejectedValue(new Error("boom, with a made-up reason an operator should never see logged"));
    const view = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 30, "en");
    expect(view).toEqual({ notice: null, closedDayKeys: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("acct1");
    // Logs carry ids and codes only -- never the thrown reason text.
    expect(String(spy.mock.calls[0]![0])).not.toContain("made-up reason");
    spy.mockRestore();
  });

  // The picker's horizon is [today, today + maxAdvanceDays] inclusive (the
  // whole last calendar day). Four ranges below: fully inside, clipped at the
  // horizon's far edge, entirely past the horizon (excluded), and clipped at
  // the near edge by an ongoing range that started before today.
  it("closedDayKeys is every date key of every range, clipped to the page's own horizon", async () => {
    getBusinessStatusRowMock.mockResolvedValue(null);
    listClosedDaysFromMock.mockResolvedValue([
      { id: "a", account_id: "acct1", starts_on: "2026-06-02", ends_on: "2026-06-03", reason: null, created_by: "o", created_at: "x" },
      { id: "b", account_id: "acct1", starts_on: "2026-06-05", ends_on: "2026-06-10", reason: null, created_by: "o", created_at: "x" },
      { id: "c", account_id: "acct1", starts_on: "2026-06-08", ends_on: "2026-06-09", reason: null, created_by: "o", created_at: "x" },
      { id: "d", account_id: "acct1", starts_on: "2026-05-30", ends_on: "2026-06-02", reason: null, created_by: "o", created_at: "x" },
    ]);
    // today = 2026-06-01, maxAdvanceDays = 5 -> horizon ends 2026-06-06.
    const view = await loadClosureView("acct1", TZ, new Date("2026-06-01T12:00:00.000Z"), 5, "en");
    expect(view.closedDayKeys).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-05", "2026-06-06",
    ]);
  });
});
