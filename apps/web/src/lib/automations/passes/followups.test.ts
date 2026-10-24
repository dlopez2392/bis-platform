import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueFollowup, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(), getDueFollowupById: vi.fn(), recordAutomationLog: vi.fn(),
  getAutomationLogEntry: vi.fn(), readConsentState: vi.fn(), readAccountTimezone: vi.fn(),
  // D-061: the REAL email gate (below) calls this against `{} as never` —
  // unmocked, it would throw. Allowed by default.
  isAccountOutboundSuppressed: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const emailFactory = vi.hoisted(() => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), ...emailFactory }));

import type { PassContext } from "../context";
import { NO_CLOSURES, type ClosureLoader } from "../closures";
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
    language: "en", followupBodyEs: null, closureKeptAt: null,
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
    closures: NO_CLOSURES,
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

describe("S-09 PR 2: the follow-up in the customer's language", () => {
  it("a Spanish contact with our default gets our Spanish, a Spanish subject, and the gate is told es (mutation: drop `language` from ctx.email.send -> FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ language: "es", followupBody: "", followupBodyEs: null })]);
    await followupsPass.run(ctx(MORNING));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect(sent.subject).toBe("Gracias de parte de Rio Roofing");
    expect(sent.body).toBe("¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo.");
    expect(sent.language).toBe("es");
  });
  it("a Spanish contact whose box was emptied gets the WHOLE email in English (C11; mutation: pass row.language to the template -> FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ language: "es", followupBody: "Thanks for coming by the shop.", followupBodyEs: "" })]);
    await followupsPass.run(ctx(MORNING));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect([sent.subject, sent.body, sent.language]).toEqual(["Thanks from Rio Roofing", "Thanks for coming by the shop.", "en"]);
  });
});

describe("the REAL email gate, end to end, for a stopped customer (item 3, follow-up)", () => {
  const providerSend = vi.fn();

  function realCtx(now: Date): PassContext {
    return {
      db: {} as never, now, origin: "https://app.example.com",
      email: emailSenderFor({} as never),
      sms: async () => { throw new Error("follow-ups never text"); },
      closures: NO_CLOSURES,
    };
  }

  beforeEach(() => {
    providerSend.mockReset().mockResolvedValue({ providerMessageId: "re_1" });
    emailFactory.getEmailProvider.mockReset().mockReturnValue({ isFake: true, send: providerSend });
    dbMocks.readConsentState.mockReset().mockResolvedValue({ state: "stopped", since: "2026-09-01T00:00:00Z", method: "unsubscribe_link", eventId: "e1" });
    dbMocks.readAccountTimezone.mockReset().mockResolvedValue("America/Chicago");
    dbMocks.isAccountOutboundSuppressed.mockReset().mockResolvedValue(false);
  });

  it("the provider's send is NEVER called, and the booking is NOT stamped sent, for a customer the ledger says is stopped (mutation: treat kind 'automation.followup' as customer_initiated so the gate skips the ledger read → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    const result = await followupsPass.run(realCtx(MORNING));
    expect(providerSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(result).toEqual({ ...EMPTY, blocked: 1 });
  });
});

/** S-47d: the loader a tick builds, without a database: an open-ended storm on acct_1 since 2026-09-20T00:00:00.000Z, every other
 *  account open. Never NO_CLOSURES, which reads open for everyone and so could not show a hold. */
const stormOnAcct1 = (): ClosureLoader => async (accountId) => ({
  ok: true,
  input: {
    row: accountId === "acct_1" ? { state: "storm", late_minutes: null, until: null, set_at: "2026-09-20T00:00:00.000Z" } : null,
    closedDays: [], hours: null, timezone: "America/Chicago",
  },
  windows: accountId === "acct_1" ? [{ start: new Date("2026-09-20T00:00:00.000Z"), end: null }] : [],
});

describe("the closure hold (S-47d, spec 5.5.2)", () => {
  it("a covered appointment is held with the closure reason (S-47d), for a day under an open-ended storm: not sent, not stamped", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run({ ...ctx(MORNING), closures: stormOnAcct1() })).toEqual({ ...EMPTY, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({
      source: "followups", subjectKey: "booking:bk_f1", status: "held",
      heldUntil: "2026-09-23T14:00:00.000Z", reason: "Held: closed for a storm",
    })]);
  });

  it("a kept appointment sends", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ closureKeptAt: "2026-09-21T12:00:00.000Z" })]);
    expect(await followupsPass.run({ ...ctx(MORNING), closures: stormOnAcct1() })).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });
});

/** S-47d D13: the loader with these closed days for acct_1, in the account's own zone; no status row. */
const closedDaysOnAcct1 = (days: { starts_on: string; ends_on: string }[], timezone: string): ClosureLoader => async (accountId) => ({
  ok: true,
  input: {
    row: null, closedDays: accountId === "acct_1" ? days.map((r) => ({ ...r, reason: null })) : [],
    hours: null, timezone,
  },
  windows: [],
});
const CLOSED_REASON = "Not sent: the business was closed for this appointment";

describe("owner ruling D13: an appointment the business was closed for gets no follow-up unless kept", () => {
  it("closed day yesterday, follow-up due this morning: skipped with the closed reason, not sent, not stamped (mutation: drop skipIfWasClosed FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    const c = { ...ctx(MORNING), closures: closedDaysOnAcct1([{ starts_on: "2026-09-21", ends_on: "2026-09-21" }], "America/Chicago") };
    expect(await followupsPass.run(c)).toEqual({ ...EMPTY, blocked: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ subjectKey: "booking:bk_f1", status: "skipped", reason: CLOSED_REASON })]);
  });

  it("the same, kept: sent", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ closureKeptAt: "2026-09-21T12:00:00.000Z" })]);
    const c = { ...ctx(MORNING), closures: closedDaysOnAcct1([{ starts_on: "2026-09-21", ends_on: "2026-09-21" }], "America/Chicago") };
    expect(await followupsPass.run(c)).toEqual({ ...EMPTY, sent: 1 });
  });

  it("a follow-up held under a closed day still in force (a vacation through tomorrow) is sent on release once the day is removed, never skipped", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    const vacation = closedDaysOnAcct1([{ starts_on: "2026-09-21", ends_on: "2026-09-23" }], "America/Chicago");
    expect(await followupsPass.run({ ...ctx(MORNING), closures: vacation })).toEqual({ ...EMPTY, held: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({
      status: "held", heldUntil: "2026-09-24T05:00:00.000Z", reason: "Held: the business is closed that day",
    })]);
    // The range is removed (bumpHeldForAccount makes the row due now); the next tick releases it.
    dbMocks.recordAutomationLog.mockClear();
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row() });
    expect(await releaseFollowup({ ...ctx(NOON), closures: closedDaysOnAcct1([], "America/Chicago") }, heldRow())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent" })]);
  });
});

describe("owner ruling D13b: a closure ended early by the switch still counts for the follow-up", () => {
  // A storm set Mon 08:00 CDT and switched to Open at Mon 18:00: the history the loader rebuilds from the
  // switch's change log (closures.ts closureWindows). The stored row is open now.
  const stormEndedByOpen = (): ClosureLoader => async (accountId) => ({
    ok: true,
    input: {
      row: accountId === "acct_1" ? { state: "open", late_minutes: null, until: null, set_at: "2026-09-21T23:00:00.000Z" } : null,
      closedDays: [], hours: null, timezone: "America/Chicago",
    },
    windows: accountId === "acct_1" ? [{ start: new Date("2026-09-21T13:00:00.050Z"), end: new Date("2026-09-21T23:00:00.050Z") }] : [],
  });

  it("storm set Mon 08:00, appointment Mon 14:00, Open at Mon 18:00, follow-up due Tue morning: skipped (mutation: ignore the windows FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run({ ...ctx(MORNING), closures: stormEndedByOpen() })).toEqual({ ...EMPTY, blocked: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: CLOSED_REASON })]);
  });

  it("the same, kept: sent", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ closureKeptAt: "2026-09-21T12:00:00.000Z" })]);
    expect(await followupsPass.run({ ...ctx(MORNING), closures: stormEndedByOpen() })).toEqual({ ...EMPTY, sent: 1 });
  });

  it("the closed day is the appointment's START day: 23:30 on the closed day to 00:30 the next is skipped (review M2; mutation: appointmentAt from endsAt FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({
      startsAt: "2026-09-21T04:30:00.000Z",     // Sun 23:30 CDT, on the closed day
      endsAt: "2026-09-21T05:30:00.000Z",       // Mon 00:30 CDT, the day after
    })]);
    const c = { ...ctx(MORNING), closures: closedDaysOnAcct1([{ starts_on: "2026-09-20", ends_on: "2026-09-20" }], "America/Chicago") };
    expect(await followupsPass.run(c)).toEqual({ ...EMPTY, blocked: 1 });
  });
});
