import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgencyReportTarget, AccountForWeeklyRollup } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  getAgencyReportTarget: vi.fn(), stampAgencyReportSent: vi.fn(), listAccountsForWeeklyRollup: vi.fn(),
}));
// importOriginal keeps every other @bis/db export (and the types) real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const metricsMock = vi.hoisted(() => ({ weeklyMetrics: vi.fn() }));
vi.mock("@/lib/reports/weekly-metrics", () => ({ weeklyMetrics: (...a: unknown[]) => metricsMock.weeklyMetrics(...a) }));

import { lastWeekMonday, weekWindow } from "@/lib/reports/weekly-window";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";
import type { PassContext } from "../context";
import { weeklyAgencyReportPass } from "./weekly-agency-report";

const AGENCY_ZONE = "America/Chicago";
const TICK = new Date("2026-03-02T15:00:00Z");   // Chicago 09:00 Monday — inside the 08:00-11:00 band
const ORIGIN = "https://app.example.com";
const MONDAY = lastWeekMonday(TICK, AGENCY_ZONE); // the week the roll-up is FOR: "2026-02-23"

const WEEK: WeeklyNumbers = { calls: 5, leads: 2, bookings: 1, visitors: null };

/** Distinctive, complete fixture. NO accountName — the type does not have one. */
function target(overrides: Partial<AgencyReportTarget> = {}): AgencyReportTarget {
  return {
    agencyId: "ag_1", reportEmail: "owner@agency.example.com",
    timezone: AGENCY_ZONE, lastSentWeek: null,
    ...overrides,
  };
}

function acct(overrides: Partial<AccountForWeeklyRollup> = {}): AccountForWeeklyRollup {
  return {
    accountId: "acct_1",
    createdAt: "2020-01-01T00:00:00.000Z",   // long before any window this suite builds — prior is always valid
    accountTimezone: AGENCY_ZONE,
    brandName: "Rio Roofing",
    hasSite: false,
    hasRecipients: true,
    ...overrides,
  };
}

const emailSend = vi.fn();
function ctx(now: Date = TICK): PassContext {
  return {
    db: {} as never, now, origin: ORIGIN,
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: () => Promise.reject(new Error("not used by this pass")) }),
    quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
  };
}

const EMPTY = {
  sent: 0, failed: 0, skippedNoRecipient: 0, skippedNotMonday: 0,
  skippedAlreadySent: 0, unresolvableTimezone: 0, unstamped: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.getAgencyReportTarget.mockResolvedValue(null);
  dbMocks.stampAgencyReportSent.mockResolvedValue(undefined);
  dbMocks.listAccountsForWeeklyRollup.mockResolvedValue([]);
  metricsMock.weeklyMetrics.mockReset().mockResolvedValue(WEEK);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("weeklyAgencyReportPass", () => {
  it("counts skippedNoRecipient when the agency report_email is unset", async () => {
    dbMocks.getAgencyReportTarget.mockResolvedValue(target({ reportEmail: null }));
    expect(await weeklyAgencyReportPass.run(ctx())).toEqual({ ...EMPTY, skippedNoRecipient: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.listAccountsForWeeklyRollup).not.toHaveBeenCalled();
  });

  /**
   * THE RULE this task exists to get right: every account's window is built
   * from ITS OWN `accountTimezone`, never the agency's — even though the
   * agency's own zone (Chicago here) is what gated the send in the first
   * place. Account B sits a full DST-unrelated 19 hours away in Auckland, so
   * a window built from the agency's zone instead would not merely be a few
   * hours off — it would name the wrong `fromIso` entirely, which is what
   * the mutation check below turns into a failure.
   */
  it("computes each account's week in that account's own zone", async () => {
    const ACCT_B_ZONE = "Pacific/Auckland";
    dbMocks.getAgencyReportTarget.mockResolvedValue(target());
    dbMocks.listAccountsForWeeklyRollup.mockResolvedValue([
      acct({ accountId: "acct_a", accountTimezone: AGENCY_ZONE, brandName: "Rio Roofing" }),
      acct({ accountId: "acct_b", accountTimezone: ACCT_B_ZONE, brandName: "Valley Air" }),
    ]);

    const windowA = weekWindow(lastWeekMonday(TICK, AGENCY_ZONE), AGENCY_ZONE);
    const windowB = weekWindow(lastWeekMonday(TICK, ACCT_B_ZONE), ACCT_B_ZONE);
    // Guard the fixture: two zones that cannot be told apart would let a bug
    // that used the agency's zone for everyone pass by accident.
    expect(windowA.fromIso).not.toBe(windowB.fromIso);

    expect(await weeklyAgencyReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(metricsMock.weeklyMetrics).toHaveBeenCalledWith(expect.anything(), "acct_a", windowA, false);
    expect(metricsMock.weeklyMetrics).toHaveBeenCalledWith(expect.anything(), "acct_b", windowB, false);
  });

  it("skips when already stamped for this week", async () => {
    dbMocks.getAgencyReportTarget.mockResolvedValue(target({ lastSentWeek: MONDAY }));
    expect(await weeklyAgencyReportPass.run(ctx())).toEqual({ ...EMPTY, skippedAlreadySent: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.listAccountsForWeeklyRollup).not.toHaveBeenCalled();
  });
});
