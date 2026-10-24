// S-47d Task 11 (plan "The dashboard card", spec §5.6.2). `BusinessStatusCard` is an async Server
// Component; `renderToStaticMarkup` cannot resolve one through a Suspense boundary (proven: a plain
// React async child suspends at its first `await` and is never resumed inside a synchronous render —
// so this file awaits the component directly, as `page.test.ts` already does for the whole page, and
// mocks only the database layer, never the component itself.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClosedDayRow, ClosureAppointment } from "@bis/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/business-status-menu", () => ({
  BusinessStatusMenu: (props: { trigger: React.ReactNode; triggerKind?: string }) =>
    createElement("i", { "data-testid": "bsm", "data-trigger-kind": props.triggerKind ?? "status" }, props.trigger),
}));

const dbFixture = vi.hoisted(() => ({ tag: "request" }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => dbFixture }));

const dbMocks = vi.hoisted(() => ({
  getBusinessStatusRow: vi.fn(),
  listClosedDaysFrom: vi.fn(),
  readHoursChain: vi.fn(),
  listClosureAppointments: vi.fn(),
  countHeldByBooking: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

import { BusinessStatusCard } from "./business-status-card";

const TZ = "America/Chicago";
const ACCOUNT = "acct_1";
// Monday 2027-06-07, 10:00 CDT.
const NOW = new Date("2027-06-07T15:00:00.000Z");

function row(partial: Partial<Parameters<typeof dbMocks.getBusinessStatusRow>[0]> & Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT, state: "open", late_minutes: null, until: null,
    set_by: "user_1", set_at: "2027-06-01T00:00:00.000000+00:00", ...partial,
  };
}
const appt = (over: Partial<ClosureAppointment>): ClosureAppointment => ({
  id: "bk_1", contact_id: "c_1", starts_at: "2027-06-07T20:00:00.000Z", ends_at: "2027-06-07T20:30:00.000Z",
  closure_kept_at: null, first_name: "Ana", last_name: "Cruz", ...over,
});

function mockDefaults() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  dbMocks.getBusinessStatusRow.mockReset().mockResolvedValue(null);
  dbMocks.listClosedDaysFrom.mockReset().mockResolvedValue([]);
  dbMocks.readHoursChain.mockReset().mockResolvedValue({ businessHours: null, calendarHours: null });
  dbMocks.listClosureAppointments.mockReset().mockResolvedValue([]);
  dbMocks.countHeldByBooking.mockReset().mockResolvedValue(new Map());
}

async function render(over: Partial<Parameters<typeof BusinessStatusCard>[0]> = {}) {
  const el = await BusinessStatusCard({
    accountId: ACCOUNT, timezone: TZ, locale: "en", pseudo: false,
    isAgency: true, role: null, personaName: null, ...over,
  });
  return renderToStaticMarkup(el);
}

describe("BusinessStatusCard — each state (spec §5.6.2)", () => {
  it("open with no next closed day: the compact line, no affected list", async () => {
    mockDefaults();
    try {
      const html = await render();
      expect(html).toContain("Open today");
      expect(html).not.toContain("Affected appointments");
    } finally { vi.useRealTimers(); }
  });

  it("open WITH a next closed day within 14 days: the next-closed-day line (S16)", async () => {
    mockDefaults();
    const cd: ClosedDayRow = {
      id: "cd1", account_id: ACCOUNT, starts_on: "2027-06-10", ends_on: "2027-06-10",
      reason: "holiday", created_by: "user_1", created_at: "2027-06-01T00:00:00.000Z",
    };
    dbMocks.listClosedDaysFrom.mockResolvedValue([cd]);
    try {
      const html = await render();
      expect(html).toContain("Next closed day:");
      // Fix round D8: the reason mid-sentence is lowercase, the spec's own "(holiday)".
      expect(html).toContain("Next closed day: Thursday, June 10 (holiday)");
    } finally { vi.useRealTimers(); }
  });

  it("closed_today: dot+word, the end line, Change for an Owner/agency (canChange all)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    try {
      const html = await render();
      expect(html).toContain("Closed today");
      expect(html).toContain("data-testid=\"bsm\"");
      expect(html).toContain("bg-[var(--crit)]");
    } finally { vi.useRealTimers(); }
  });

  it("running_late: state, end line, lateHidden ONLY — no affected list is read at all (mutation: call readAffected for running_late -> listClosureAppointments gets called, which this test would catch)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "running_late", late_minutes: 30, until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:30:00.000Z",
    }));
    try {
      const html = await render();
      expect(html).toContain("Running late");
      expect(html).toContain("Ends at midnight");
      expect(html).toContain("times in the next 30 minutes are hidden");
      expect(html).not.toContain("Affected appointments");
      expect(dbMocks.listClosureAppointments).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("no appointments affected: the sentence, never a blank list", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    try {
      const html = await render();
      expect(html).toContain("No appointments are affected.");
    } finally { vi.useRealTimers(); }
  });

  it("canChange null (Staff during a closure): no Change trigger", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    try {
      const html = await render({ isAgency: false, role: "staff" });
      expect(html).not.toContain("data-testid=\"bsm\"");
    } finally { vi.useRealTimers(); }
  });
});

describe("BusinessStatusCard — every read gets the route's own accountId (second-account case)", () => {
  it("all five reads are called with THIS account, not a hard-coded one", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    dbMocks.countHeldByBooking.mockResolvedValue(new Map([["bk_1", 1]]));
    try {
      await render({ accountId: "acct_two" });
      expect(dbMocks.getBusinessStatusRow.mock.calls[0]![1]).toBe("acct_two");
      expect(dbMocks.listClosedDaysFrom.mock.calls[0]![1]).toBe("acct_two");
      expect(dbMocks.readHoursChain.mock.calls[0]![1]).toBe("acct_two");
      expect(dbMocks.listClosureAppointments.mock.calls[0]![1]).toBe("acct_two");
      expect(dbMocks.countHeldByBooking.mock.calls[0]![1]).toBe("acct_two");
    } finally { vi.useRealTimers(); }
  });
});

describe("BusinessStatusCard — Keep (spec §5.6.2)", () => {
  it("a held row shows '{n} messages waiting', and the Keep button is present", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    dbMocks.countHeldByBooking.mockResolvedValue(new Map([["bk_1", 2]]));
    try {
      const html = await render();
      expect(html).toContain("2 messages waiting");
      expect(html).toContain(">Keep<");
      expect(html).toContain("Ana Cruz");
    } finally { vi.useRealTimers(); }
  });

  it("a kept appointment shows 'Kept' in place of the button (mutation: ignore closure_kept_at -> FAILS)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({ closure_kept_at: "2027-06-07T15:30:00.000Z" })]);
    try {
      const html = await render();
      expect(html).toContain(">Kept<");
      expect(html).not.toContain(">Keep<");
    } finally { vi.useRealTimers(); }
  });

  it("'Cancel on the calendar' links to the booking's own anchor", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    try {
      const html = await render();
      expect(html).toContain(`/dashboard/accounts/${ACCOUNT}/calendar#booking-bk_1`);
    } finally { vi.useRealTimers(); }
  });
});

describe("BusinessStatusCard — S22 (orchestrator ruling, finding 5)", () => {
  it("a three-day dated storm lists the appointments of all three days, each with Keep, and queries up to the storm's own `until` (mutation: the pre-S22 end-of-today window -> this FAILS, since only the Monday appointment would be listed)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "storm", until: "2027-06-10T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    const mon = appt({ id: "bk_mon", starts_at: "2027-06-07T20:00:00.000Z" });
    const tue = appt({ id: "bk_tue", starts_at: "2027-06-08T20:00:00.000Z", first_name: "Bo", last_name: "Lin" });
    const wed = appt({ id: "bk_wed", starts_at: "2027-06-09T20:00:00.000Z", first_name: "Cy", last_name: "Ortiz" });
    dbMocks.listClosureAppointments.mockImplementation(async (_db: unknown, _acct: string, fromIso: string, toIso: string) =>
      [mon, tue, wed].filter((a) => a.starts_at >= fromIso && a.starts_at < toIso));
    try {
      const html = await render();
      expect(html).toContain("Ana Cruz");
      expect(html).toContain("Bo Lin");
      expect(html).toContain("Cy Ortiz");
      expect(html.match(/>Keep</g)?.length).toBe(3);
      expect(dbMocks.listClosureAppointments.mock.calls[0]![3]).toBe("2027-06-10T05:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });

  it("Closed today lists today's only, the window ending at tonight's midnight (D12)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    try {
      await render();
      // Closed today's own window ends at tonight's local midnight (2027-06-08T05:00:00.000Z CDT).
      expect(dbMocks.listClosureAppointments.mock.calls[0]![3]).toBe("2027-06-08T05:00:00.000Z");
    } finally { vi.useRealTimers(); }
  });

  it("an open-ended storm queries exactly 14 days ahead and shows moreLater (mutation: drop the 14-day cap -> the end-date assertion FAILS)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(row({
      state: "storm", until: null, set_at: "2027-06-07T14:00:00.000Z",
    }));
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    try {
      const html = await render();
      expect(dbMocks.listClosureAppointments.mock.calls[0]![3]).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
      expect(html).toContain("More appointments after");
      expect(html).toContain("are on the calendar.");
    } finally { vi.useRealTimers(); }
  });
});

describe("BusinessStatusCard — fix round (C2, C4, C8, D8)", () => {
  const CLOSED = row({ state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z" });
  const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("C8/C4: each row is the shared AffectedAppointmentRow, \"when · name\" in the account's zone (mutation: keep the card's own en-US row -> FAILS)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(CLOSED);
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    try {
      const html = await render();
      expect(html).toContain('data-affected-appointment="bk_1"');
      expect(words(html)).toContain("Jun 7, 3:00 PM · Ana Cruz");
    } finally { vi.useRealTimers(); }
  });

  it("C4: a Spanish card formats the time from the Spanish tables, never en-US", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(CLOSED);
    dbMocks.listClosureAppointments.mockResolvedValue([appt({})]);
    try {
      expect(words(await render({ locale: "es" }))).toContain("7 de jun., 3:00 PM · Ana Cruz");
    } finally { vi.useRealTimers(); }
  });

  it("C8: a nameless contact reads the fallback, not an empty link", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(CLOSED);
    dbMocks.listClosureAppointments.mockResolvedValue([appt({ first_name: null, last_name: null })]);
    try {
      expect(words(await render())).toContain("Jun 7, 3:00 PM · (no name)");
    } finally { vi.useRealTimers(); }
  });

  it("C2: the card's Change button is the menu's \"action\" trigger (its name is the trigger phrase)", async () => {
    mockDefaults();
    dbMocks.getBusinessStatusRow.mockResolvedValue(CLOSED);
    try {
      expect(await render()).toContain('data-trigger-kind="action"');
    } finally { vi.useRealTimers(); }
  });

  it("D8: on a closed day the reason mid-sentence is lowercase, \"Closed today (holiday)\" (mutation: the catalogue's capitalised label -> FAILS)", async () => {
    mockDefaults();
    dbMocks.listClosedDaysFrom.mockResolvedValue([{
      id: "cd1", account_id: ACCOUNT, starts_on: "2027-06-07", ends_on: "2027-06-07",
      reason: "holiday", created_by: "user_1", created_at: "2027-06-01T00:00:00.000Z",
    }]);
    try {
      const html = await render();
      expect(words(html)).toContain("Closed today (holiday)");
      expect(words(await render({ locale: "es" }))).toContain("Cerrado hoy (día festivo)");
    } finally { vi.useRealTimers(); }
  });
});
