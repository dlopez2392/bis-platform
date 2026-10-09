import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountDueWeeklyReport } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listAccountsDueWeeklyReport: vi.fn(), stampWeeklyReportSent: vi.fn(), getVoiceProfile: vi.fn(),
  recordAutomationLog: vi.fn(),
}));
// importOriginal keeps every other @bis/db export (and the types) real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const metricsMock = vi.hoisted(() => ({ weeklyMetrics: vi.fn() }));
vi.mock("@/lib/reports/weekly-metrics", () => ({ weeklyMetrics: (...a: unknown[]) => metricsMock.weeklyMetrics(...a) }));

import { lastWeekMonday } from "@/lib/reports/weekly-window";
import type { WeeklyNumbers } from "@/lib/reports/weekly-metrics";
import { fakeSmsGate } from "@/lib/consent/fake-gate";
import type { PassContext } from "../context";
import { WEEKLY_REPORT_TICK_CAP, WEEKLY_REPORT_BUDGET_MS } from "../caps";
import { weeklyClientReportPass } from "./weekly-report";

const ZONE = "America/New_York";
const TICK = new Date("2026-03-02T15:00:00Z");        // NY 10:00 Monday — inside the 08:00-11:00 band
const NOT_MONDAY = new Date("2026-03-03T15:00:00Z");  // NY 10:00 Tuesday — same zone, wrong day
const ORIGIN = "https://app.example.com";
const MONDAY = lastWeekMonday(TICK, ZONE);             // the week the report is FOR: "2026-02-23"

const WEEK: WeeklyNumbers = { calls: 5, leads: 2, bookings: 1, visitors: null };

/** Distinctive, complete fixture. NO accountName — the type does not have one. */
function row(overrides: Partial<AccountDueWeeklyReport> = {}): AccountDueWeeklyReport {
  return {
    accountId: "acct_1",
    createdAt: "2020-01-01T00:00:00.000Z",   // long before any window this suite builds — prior is always valid
    reportEmails: ["owner@rioroofing.com"],
    accountTimezone: ZONE,
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    replyToEmail: "owner-reply@rioroofing.com",
    lastSentWeek: null,
    hasSite: false,
    ...overrides,
  };
}

const emailSend = vi.fn();
const smsSend = vi.fn();
function ctx(now: Date = TICK): PassContext {
  return {
    db: {} as never, now, origin: ORIGIN,
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: fakeSmsGate({ send: (m) => smsSend(m) }),
  };
}

const EMPTY = {
  sent: 0, failed: 0, skippedNotMonday: 0, skippedAlreadySent: 0,
  skippedCap: 0, skippedBudget: 0, unresolvableTimezone: 0, unstamped: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([]);
  dbMocks.stampWeeklyReportSent.mockResolvedValue(undefined);
  dbMocks.getVoiceProfile.mockResolvedValue(null);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  metricsMock.weeklyMetrics.mockReset().mockResolvedValue(WEEK);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("weeklyClientReportPass", () => {
  it("sends one message per recipient, never one with a joined to-field", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([
      row({ reportEmails: ["owner@rioroofing.com", "manager@rioroofing.com"] }),
    ]);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 2 });
    expect(emailSend).toHaveBeenCalledTimes(2);
    const tos = emailSend.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(tos).toEqual(["owner@rioroofing.com", "manager@rioroofing.com"]);
    for (const to of tos) expect(to).not.toContain(",");
    // Same report, sent twice — not two different messages.
    const subjects = emailSend.mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjects[0]).toBe(subjects[1]);
  });

  it("a failing recipient does not stop the others, and both are counted", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([
      row({ reportEmails: ["bad@rioroofing.com", "good@rioroofing.com"] }),
    ]);
    emailSend.mockRejectedValueOnce(new Error("bounced")).mockResolvedValueOnce({ providerMessageId: "e2" });
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, failed: 1 });
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect((emailSend.mock.calls[1]![0] as { to: string }).to).toBe("good@rioroofing.com");
  });

  it("stamps when at least one recipient succeeded", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([
      row({ reportEmails: ["bad@rioroofing.com", "good@rioroofing.com"] }),
    ]);
    emailSend.mockRejectedValueOnce(new Error("bounced")).mockResolvedValueOnce({ providerMessageId: "e2" });
    // Partial failure still stamps — not stamping would re-send to the address that already received it.
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, failed: 1 });
    expect(dbMocks.stampWeeklyReportSent).toHaveBeenCalledWith(expect.anything(), "acct_1", MONDAY);
  });

  it("does not stamp when every recipient failed", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([
      row({ reportEmails: ["bad1@rioroofing.com", "bad2@rioroofing.com"] }),
    ]);
    emailSend.mockRejectedValue(new Error("bounced"));
    // All-fail must NOT stamp, so it retries inside the same morning band.
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, failed: 2 });
    expect(dbMocks.stampWeeklyReportSent).not.toHaveBeenCalled();
  });

  it("writes ONE sent row keyed by the week once at least one recipient got it, and none when every send failed (mutation: log before the loop → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ reportEmails: ["a@x.com", "b@x.com"] })]);
    metricsMock.weeklyMetrics.mockResolvedValue(WEEK);
    await weeklyClientReportPass.run(ctx());
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "weekly_report", channel: "email", contactId: null, subjectKey: `week:${MONDAY}`, status: "sent",
    });
    dbMocks.recordAutomationLog.mockClear();
    emailSend.mockRejectedValue(new Error("bounce"));
    await weeklyClientReportPass.run(ctx());
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("skips an account already stamped for this week", async () => {
    // Phase 1 — fresh account: sends and stamps for the week that just ended.
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row()]);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampWeeklyReportSent).toHaveBeenCalledWith(expect.anything(), "acct_1", MONDAY);

    // Phase 2 — same morning, already stamped for that week: skipped, not re-sent.
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ lastSentWeek: MONDAY })]);
    emailSend.mockClear();
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, skippedAlreadySent: 1 });
    expect(emailSend).not.toHaveBeenCalled();

    // Phase 3 — a fresh account, but the tick itself is outside the Monday
    // band: refused before the already-sent check is ever reached, under
    // its own name.
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row()]);
    expect(await weeklyClientReportPass.run(ctx(NOT_MONDAY))).toEqual({ ...EMPTY, skippedNotMonday: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("fails closed on an unresolvable timezone", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1, sent: 0 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampWeeklyReportSent).not.toHaveBeenCalled();
  });

  it("the send carries kind \"operator.weekly_report\" with the account's own id (consent PR-3; mutation: a customer kind → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row()]);
    await weeklyClientReportPass.run(ctx());
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acct_1", kind: "operator.weekly_report",
    }));
  });

  // D-063 (wiring, review follow-up): weeklyReportEmail.ts's own suite proves
  // the TEMPLATE honours `receptionistName`; nothing proved this PASS actually
  // reads `profile.persona_name` and threads it through — deleting
  // `receptionistName: profile?.persona_name` from this file left every test
  // above green, because none of them exercise a quiet week (the only body
  // that ever names the receptionist). A quiet week is required here on
  // purpose: `WEEK`'s non-zero fixture never reaches `quietBody` at all.
  it("a quiet week's reassurance names THIS account's own configured persona, not a hard-coded 'Sofía' (mutation: delete receptionistName from the reassurance object → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row()]);
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: true, textback_enabled: false, persona_name: "Max" });
    metricsMock.weeklyMetrics.mockResolvedValue({ calls: 0, leads: 0, bookings: 0, visitors: null });

    await weeklyClientReportPass.run(ctx());

    const sent = emailSend.mock.calls[0]![0] as { body: string };
    expect(sent.body).toContain("Max is still answering");
    expect(sent.body).not.toContain("Sofía");
  });

  // D-067: the old shared recipe cap (AUTOMATION_TICK_CAP, 10) × the Monday
  // band's twelve ticks reached at most 120 accounts sharing one time zone
  // before that week's report for the rest was gone for good. This pass
  // now carries its OWN, much larger cap — still a cap, so a bug in the
  // due-list is still bounded to one tick's damage, just not a ceiling a
  // real agency's client base can grow into.
  it(`caps attempts at WEEKLY_REPORT_TICK_CAP (${WEEKLY_REPORT_TICK_CAP}) a tick, leaving the rest for the next one (mutation: raise or drop the cap check → FAILS)`, async () => {
    const rows = Array.from({ length: WEEKLY_REPORT_TICK_CAP + 1 }, (_, i) => row({ accountId: `acct_${i}` }));
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue(rows);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: WEEKLY_REPORT_TICK_CAP, skippedCap: 1 });
    expect(emailSend).toHaveBeenCalledTimes(WEEKLY_REPORT_TICK_CAP);
  });

  // The second bound: a WALL-CLOCK budget, so a tick that is somehow slow
  // (not count-bound) still leaves the registry's later passes — the
  // agency roll-up, the usage report, ops-watch — their share of the
  // route's 300 s maxDuration.
  it("stops starting new accounts once its own budget is spent, leaving the rest for the next tick (mutation: drop the budget check → both sent, FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ accountId: "a1" }), row({ accountId: "a2" })]);
    // Date.now() calls the pass makes: `startedAt`, then one check before
    // each eligible account. a1's check reads no time passed; a2's reads
    // exactly the budget, so a2 waits for the next tick.
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(WEEKLY_REPORT_BUDGET_MS);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedBudget: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("pins the cap and the budget (mutation: change either → FAILS)", () => {
    expect(WEEKLY_REPORT_TICK_CAP).toBe(150);
    expect(WEEKLY_REPORT_BUDGET_MS).toBe(60_000);
  });

  it("no voice profile at all still sends a quiet week, with no receptionist claim (reassurance.receptionist must be false, not a falsy persona_name read)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row()]);
    dbMocks.getVoiceProfile.mockResolvedValue(null);
    metricsMock.weeklyMetrics.mockResolvedValue({ calls: 0, leads: 0, bookings: 0, visitors: null });

    await weeklyClientReportPass.run(ctx());

    const sent = emailSend.mock.calls[0]![0] as { body: string };
    expect(sent.body).not.toMatch(/still answering/i);
  });
});
