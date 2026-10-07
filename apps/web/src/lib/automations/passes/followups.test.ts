import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueFollowup, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(), getDueFollowupById: vi.fn(), recordAutomationLog: vi.fn(),
  getAutomationLogEntry: vi.fn(), readConsentState: vi.fn(), readAccountTimezone: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const emailFactory = vi.hoisted(() => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), ...emailFactory }));

import type { PassContext } from "../context";
import { followupsPass, releaseFollowup } from "./followups";
import { EmailNotSent, emailSenderFor } from "@/lib/consent/email-gate";

// 09:00 CDT on Sept 22 — inside the 08:00–11:00 band, the day after a meeting that ended Sept 21.
const MORNING = new Date("2026-09-22T14:00:00Z");
// 03:00 CDT on Sept 22 — NOT in the band, and inside the default quiet window.
const SMALL_HOURS = new Date("2026-09-22T08:00:00Z");
const NOON = new Date("2026-09-22T17:00:00Z");

function row(overrides: Partial<DueFollowup> = {}): DueFollowup {
  return {
    bookingId: "bk_f1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-21T19:00:00.000Z", endsAt: "2026-09-21T20:00:00.000Z",   // ended 15:00 CDT Sept 21
    contactEmail: "maria@example.com", contactName: "Maria Garcia", accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, replyToEmail: null, followupBody: "How did it go?",
    ...overrides,
  };
}
const heldRow = (): AutomationLogRow => ({
  id: "log_f", account_id: "acct_1", source: "followups", channel: "email", contact_id: "ct_1",
  subject_key: "booking:bk_f1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: MORNING.toISOString(),
});
const emailSend = vi.fn();
function ctx(now: Date): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: async () => { throw new Error("follow-ups never text"); },
  };
}
const EMPTY = { sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 0, skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0 };
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueFollowups.mockResolvedValue([]);
  dbMocks.stampFollowupSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  // Task 3: the held path reads the existing row before re-holding.
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("follow-ups: the band decides WHEN IT IS DUE, the window decides WHEN IT GOES", () => {
  it("in the band: sent and stamped, one sent row", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
    expect(logCalls()).toEqual([expect.objectContaining({ source: "followups", channel: "email", status: "sent", contactId: "ct_1" })]);
  });

  it("outside the band the gate still waits — no row, no send, whatever the window says (mutation: skip the gate on the normal tick → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(SMALL_HOURS))).toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(logCalls()).toEqual([]);
  });

  it("release at noon: the band is CLOSED, and the release sends anyway because the band was satisfied at hold time (mutation: apply the gate on release → FAILS)", async () => {
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row() });
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });

  it("release at noon with the meeting PAST the 37h cap: skipped, and exactly one 'No longer due' row (mutation: put the gate back inside `if (!opts.released)` → this reds with 'sent')", async () => {
    // The band is skipped on a release; NOTHING ELSE IS. This booking ended
    // 45h before the release instant, so the cap — which lives nowhere else on
    // this path — is the only rule refusing, and it must still refuse.
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row({
      startsAt: "2026-09-20T19:00:00.000Z", endsAt: "2026-09-20T20:00:00.000Z",   // 45h before NOON
    }) });
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    // ONE row, replacing the held one on the same (account, source, subject):
    // a released row left untouched keeps its past `held_until` and parks the
    // head of the queue for ever.
    expect(logCalls()).toEqual([expect.objectContaining({
      subjectKey: "booking:bk_f1", status: "skipped", reason: "No longer due",
    })]);
  });

  it("no email: a skipped row with the plain reason, counted as before", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ contactEmail: null })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, skippedNoEmail: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "No email address on file" })]);
  });

  it("an unresolvable account zone: a skipped row that says so", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "The company's time zone isn't set" })]);
  });

  it("release: gone / calendar follow-ups switched off", async () => {
    dbMocks.getDueFollowupById.mockResolvedValueOnce({ due: null, why: "gone" }).mockResolvedValueOnce({ due: null, why: "off" });
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(logCalls().map((w) => w.reason)).toEqual(["No longer due", "This automation was turned off"]);
  });

  it("release: a held row's account is not trusted across tenants — a mismatch never sends (mutation: delete the check → FAILS)", async () => {
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row() });   // due.accountId is "acct_1"
    const crossTenant: AutomationLogRow = { ...heldRow(), account_id: "acct_2" };
    expect(await releaseFollowup(ctx(NOON), crossTenant)).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ accountId: "acct_2", status: "skipped", reason: "No longer due" })]);
  });
});

describe("consent PR-3: the email goes through the gate", () => {
  it("the email goes through the gate as automation.followup, for this account and contact, at the tick's instant (mutation: kind \"automation.reminder\" → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    await followupsPass.run(ctx(MORNING));
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acct_1", kind: "automation.followup", contactId: "ct_1", origin: "https://app.example.com",
      now: MORNING, accountZone: "America/Chicago",
    }));
  });

  it("an unsubscribed customer: the gate refuses, the row is skipped with the reason the client reads, nothing is stamped, and the tick's cap place is given back (decision 7, G13; mutation: count it sent → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason: "stopped" }));
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, blocked: 1 });
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
  });
});

describe("the REAL email gate, end to end, for a stopped customer (item 3, follow-up)", () => {
  const providerSend = vi.fn();

  function realCtx(now: Date): PassContext {
    return {
      db: {} as never, now, origin: "https://app.example.com",
      email: emailSenderFor({} as never),
      sms: async () => { throw new Error("follow-ups never text"); },
    };
  }

  beforeEach(() => {
    providerSend.mockReset().mockResolvedValue({ providerMessageId: "re_1" });
    emailFactory.getEmailProvider.mockReset().mockReturnValue({ isFake: true, send: providerSend });
    dbMocks.readConsentState.mockReset().mockResolvedValue({ state: "stopped", since: "2026-09-01T00:00:00Z", method: "unsubscribe_link", eventId: "e1" });
    dbMocks.readAccountTimezone.mockReset().mockResolvedValue("America/Chicago");
  });

  it("the provider's send is NEVER called, and the booking is NOT stamped sent, for a customer the ledger says is stopped (mutation: treat kind 'automation.followup' as customer_initiated so the gate skips the ledger read → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    const result = await followupsPass.run(realCtx(MORNING));
    expect(providerSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(result).toEqual({ ...EMPTY, blocked: 1 });
  });
});
