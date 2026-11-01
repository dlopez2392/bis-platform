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
import { NO_CLOSURES } from "../closures";
import { WEEKLY_REPORT_TICK_CAP, WEEKLY_REPORT_BUDGET_MS, WEEKLY_REPORT_MAX_RECIPIENTS } from "../caps";
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
    language: null,
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
    closures: NO_CLOSURES,
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

  // S-10 T8 (spec §3.3): the account's own `language`, read off the SAME due
  // row this pass already has — never a second accounts read, never the
  // recipient address's (none of `report_emails` is a `users` row).
  it("sends a Spanish account's report in Spanish — subject and body — (mutation: drop the `language` field from the row → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ language: "es" })]);
    await weeklyClientReportPass.run(ctx());
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; html: string };
    expect(sent.subject).toBe("La semana pasada: 5 llamadas, 2 nuevos clientes potenciales");
    expect(sent.body).toContain("llamadas atendidas");
    expect(sent.html).toContain("llamadas atendidas");
  });

  it("no language on the account (null) sends the report in English (mutation: default the pass's locale to es → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ language: null })]);
    await weeklyClientReportPass.run(ctx());
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string };
    expect(sent.subject).toBe("Last week: 5 calls, 2 new leads");
    expect(sent.body).toContain("calls answered");
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

  // F-196 (Task 7 review, I1): under fan-out this pass runs in its own 90 s
  // function, and an account's recipients are sent one after another, so the
  // budget check alone let an account with two recipients start at 59.9 s and
  // run to ~106 s: killed between recipient 1 and the stamp, and recipient 1
  // mailed again next tick. An account now starts only if ALL its sends, at
  // their worst (2 x 10 s attempts + a 3 s rate-limit wait each), plus the
  // compute-and-stamp margin, end inside the route's 90 s. Never checked per
  // recipient: an account half-sent and left unstamped re-sends to everyone
  // already sent.
  it("starts an account only if all its recipients' sends, at their worst, end inside the pass route: at 50 s one recipient starts, two wait for the next tick (mutation: check only the budget → both sent, FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([
      row({ accountId: "two", reportEmails: ["a@rio.com", "b@rio.com"] }),
      row({ accountId: "one", reportEmails: ["c@rio.com"] }),
    ]);
    // startedAt, then one read per eligible account: 50 s in for both.
    // two: 50 + 2 x 23 + 10 = 106 > 90, waits; one: 50 + 23 + 10 = 83, starts.
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValueOnce(50_000).mockReturnValueOnce(50_000);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedBudget: 1 });
    expect(emailSend.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(["c@rio.com"]);
  });

  it("an account at the recipient cap starts from a standing start, so it is never stuck behind the fit check", async () => {
    const full = Array.from({ length: WEEKLY_REPORT_MAX_RECIPIENTS }, (_, i) => `r${i}@rio.com`);
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ reportEmails: full })]);
    vi.spyOn(Date, "now").mockReturnValue(0);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({ ...EMPTY, sent: WEEKLY_REPORT_MAX_RECIPIENTS });
  });

  it("a list saved before the cap existed still sends, to the first WEEKLY_REPORT_MAX_RECIPIENTS, and counts the rest (mutation: send to every stored address → FAILS)", async () => {
    const stored = Array.from({ length: WEEKLY_REPORT_MAX_RECIPIENTS + 2 }, (_, i) => `r${i}@rio.com`);
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ reportEmails: stored })]);
    expect(await weeklyClientReportPass.run(ctx())).toEqual({
      ...EMPTY, sent: WEEKLY_REPORT_MAX_RECIPIENTS, recipientsOverCap: 2,
    });
    expect(emailSend.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(stored.slice(0, WEEKLY_REPORT_MAX_RECIPIENTS));
    expect(dbMocks.stampWeeklyReportSent).toHaveBeenCalledTimes(1);
  });

  it("pins the cap and the budget (mutation: change either → FAILS)", () => {
    expect(WEEKLY_REPORT_MAX_RECIPIENTS).toBe(3);
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
