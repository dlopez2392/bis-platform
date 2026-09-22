import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueAppointmentConfirm, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueAppointmentConfirms: vi.fn(), getDueAppointmentConfirmById: vi.fn(),
  stampAppointmentConfirmAsked: vi.fn(), stampAppointmentConfirmSmsFailed: vi.fn(),
  ensureConversation: vi.fn(async () => ({ id: "cv_1" })),
  createMessage: vi.fn(async () => ({ id: "msg_1" })),
  updateMessageStatus: vi.fn(),
  recordAutomationLog: vi.fn(),
  // holdOrSend reads this BEFORE re-writing a held row. A factory mock that
  // omits it throws at the moment the export is read — part C's recorded trap.
  getAutomationLogEntry: vi.fn(async () => null),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const gate = vi.fn(async () => ({ ok: true as const, from: "+19565550000" }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => gate(...(a as [])) }));

import type { PassContext } from "../context";
import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { formatWhen } from "@/lib/booking/time";
import { appointmentConfirmPass, releaseAppointmentConfirm } from "./appointment-confirm";

const TICK = new Date("2027-04-12T12:00:00.000Z");
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { enabled: false, start: "21:00", end: "08:00" };
// The ARGUMENT is typed, not just the return: the plan's `vi.fn(async () =>
// …)` gives `mock.calls` an empty tuple, so `calls[0]![0].body` is TS2493
// ("tuple of length 0 has no element at index 0") and `pnpm --filter web
// typecheck` refuses the file. sms-reminder.test.ts:38 solves the same
// problem with a bare `vi.fn()` plus a cast at the read; declaring the
// parameter keeps the read cast-free.
const send = vi.fn(async (_msg: { to: string; from: string; body: string }) => ({ providerMessageId: "sm_1" }));

function ctx(over: Partial<PassContext> = {}): PassContext {
  return {
    db: {} as PassContext["db"], now: TICK, origin: "https://app.example",
    email: { isFake: true, send: vi.fn() } as unknown as PassContext["email"],
    sms: () => ({ isFake: true, send }) as unknown as ReturnType<PassContext["sms"]>,
    quiet: async () => OFF,
    ...over,
  };
}

const STARTS = new Date(TICK.getTime() + 47 * 3600_000).toISOString();   // 04:00 PDT · 06:00 CDT, Apr 14

/** Distinctive, complete fixture. Booker in Los Angeles, account in Chicago
 *  (spec amendment B13, and the `sms-reminder.test.ts:23-35` model): the two
 *  zones render DIFFERENT strings for the same instant, so a pass that used
 *  the wrong one cannot pass by coincidence. The account zone stays
 *  America/Chicago because the quiet-hours case below reads the window's end
 *  off it. */
function row(over: Partial<DueAppointmentConfirm> = {}): DueAppointmentConfirm {
  return {
    bookingId: "bk_1", accountId: "acct_1",
    startsAt: STARTS,
    bookerTimezone: "America/Los_Angeles", contactId: "ct_1", contactPhone: "(956) 555-0107",
    brandName: "Rio Roofing", accountTimezone: "America/Chicago", body: "",
    ...over,
  };
}

function heldRow(over: Partial<AutomationLogRow> = {}): AutomationLogRow {
  return {
    id: "log_1", account_id: "acct_1", source: "appointment_confirm", channel: "sms",
    contact_id: "ct_1", subject_key: "booking:bk_1", status: "held", reason: "",
    held_until: TICK.toISOString(), payload: {}, occurred_at: TICK.toISOString(),
    ...over,
  } as AutomationLogRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  gate.mockResolvedValue({ ok: true, from: "+19565550000" });
  // `clearAllMocks` clears CALLS, not IMPLEMENTATIONS. Without this the
  // unstamped case's rejection survives into every test after it — each then
  // silently pays stampWithRetry's whole ~0.9s budget (the file went from
  // 1.06s to 3.80s when that case was added), and a later case could pass or
  // fail on a fixture set three tests earlier.
  dbMocks.stampAppointmentConfirmAsked.mockReset();
});

describe("the confirmation ask sends", () => {
  it("texts, stamps, and writes ONE sent log row", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0, unresolvableTimezone: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampAppointmentConfirmAsked).toHaveBeenCalledWith(expect.anything(), "bk_1");
    const body = send.mock.calls[0]![0].body as string;
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("either way we'll see it");
    // AMENDMENT B13: `{when}` renders in the BOOKER's zone. A Los Angeles
    // booker of a Texas company reads their own clock — this is the one text
    // whose entire job is getting a customer to confirm a time, and two hours
    // wrong is the whole message wasted. Mutation: `safeZone(row.accountTimezone,
    // "UTC")` in the pass → this reds by name.
    const when = formatWhen(new Date(STARTS), "America/Los_Angeles");
    expect(when).not.toBe(formatWhen(new Date(STARTS), "America/Chicago"));   // guards the fixture
    expect(body).toContain(when);
    // The company's INTERNAL label can never reach a customer: the due-row
    // has no field for it. sentinel.test.ts scans every send argument.
    expect(body).not.toContain("trial");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "appointment_confirm", channel: "sms", subjectKey: "booking:bk_1", status: "sent",
    }));
  });

  it("skips and LOGS when there is no textable phone, and never falls back to email", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row({ contactPhone: null })]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c.skippedNoAddress).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "No phone number we can text",
    }));
  });

  it("a send that throws is counted FAILED, writes the attempt marker and a failed log row, and NEVER stamps", async () => {
    // Send-then-stamp is the load-bearing half: a stamp written before a send
    // that then failed would silence this booking's ask for good, because the
    // due-list filters on `confirm_asked_at is null`. The attempt marker
    // (`confirm_sms_failed_at`) is written instead — visible to the operator,
    // never read back by this pass (caps.ts's exemption).
    // Mutation: move the `stampWithRetry` call ABOVE `sendAutomationSms`
    // inside the holdOrSend callback → this reds BY NAME on the last line.
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    send.mockRejectedValueOnce(new Error("carrier timeout"));
    const c = await appointmentConfirmPass.run(ctx());
    expect(c).toEqual({ sent: 0, failed: 1, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0, unresolvableTimezone: 0 });
    expect(dbMocks.stampAppointmentConfirmSmsFailed).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "appointment_confirm", subjectKey: "booking:bk_1", status: "failed", reason: "Couldn't be delivered",
    }));
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
  });

  it("a text that SENT but could not be stamped is counted UNSTAMPED and still counted sent — the duplicate is the known cost", async () => {
    // `stampWithRetry` spends its whole budget (three attempts) and gives up
    // without throwing, so the send is real: the customer has the text, the
    // row is still unstamped, and it is due again every tick until the
    // 75-minute window closes. Counting it `sent` AND `unstamped` is what
    // makes that visible in the cron's body rather than a silent repeat.
    // Mutation: delete the `if (!stamp.stamped)` block → `unstamped` stays 0
    // and this reds BY NAME.
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    dbMocks.stampAppointmentConfirmAsked.mockRejectedValue(new Error("PostgREST 503"));
    const c = await appointmentConfirmPass.run(ctx());
    expect(c).toEqual({ sent: 1, failed: 0, unstamped: 1, held: 0, skippedNoAddress: 0, skippedSmsGate: 0, unresolvableTimezone: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampAppointmentConfirmAsked).toHaveBeenCalledTimes(STAMP_RETRY_DELAYS_MS.length + 1);
    // The log row still says `sent`, because it was: the log is what went out,
    // not whether the bookkeeping afterwards landed.
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "booking:bk_1", status: "sent",
    }));
  });

  it("falls back to the ACCOUNT's zone when the booker's is missing or junk, never to UTC", async () => {
    // The other half of amendment B13, on the `sms-reminder.test.ts:78-84`
    // model. UTC is named because it is what the mutation reaches for and it
    // renders a THIRD string — 11:00 UTC here, neither the booker's 04:00 nor
    // the account's 06:00 — so a fallback that quietly became UTC would still
    // look like "some time" to a reader of the body.
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([
      row({ bookerTimezone: null }),
      row({ bookingId: "bk_2", bookerTimezone: "Mars/Olympus" }),
    ]);
    await appointmentConfirmPass.run(ctx());
    const account = formatWhen(new Date(STARTS), "America/Chicago");
    expect(account).not.toBe(formatWhen(new Date(STARTS), "UTC"));            // guards the fixture
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) expect(call[0].body).toContain(account);
  });

  it("an unresolvable ACCOUNT zone with no booker zone is SKIPPED with a reason, never counted failed", async () => {
    // AUDIT B's M1. `safeZone` does not validate its FALLBACK
    // (`lib/booking/time.ts:20-30`), so junk in both arguments came back as
    // junk, `formatWhen` threw a RangeError inside the per-row try, and the
    // row was counted `failed` with NO automation_log row at all: nothing on
    // the Activity page said why the texts stopped, and a RELEASED row was
    // left untouched — keeping its past `held_until` and parking the head of
    // the release queue for ever. The three sibling passes open with this
    // guard; this one did not.
    //
    // Mutation: delete the `resolveAccountZone(row.accountTimezone) === null`
    // guard → this reds by name with `failed: 1` and no log row.
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([
      row({ accountTimezone: "Mars/Olympus", bookerTimezone: null }),
    ]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c).toEqual({
      sent: 0, failed: 0, unstamped: 0, held: 0,
      skippedNoAddress: 0, skippedSmsGate: 0, unresolvableTimezone: 1,
    });
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "appointment_confirm", subjectKey: "booking:bk_1",
      status: "skipped", reason: "The company's time zone isn't set",
    }));
  });

  it("skips and LOGS when the account cannot text", async () => {
    gate.mockResolvedValue({ ok: false, reason: "a2p_not_approved" } as never);
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c.skippedSmsGate).toBe(1);
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
  });
});

describe("the confirmation ask and quiet hours", () => {
  it("inside the window it HOLDS: no send, no stamp, one held row with the window's end", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    // 02:00 Chicago on the tick date — inside the default 21:00–08:00 window.
    const night = new Date("2027-04-12T07:00:00.000Z");
    const c = await appointmentConfirmPass.run(ctx({ now: night, quiet: async () => ON }));
    expect(c.held).toBe(1);
    expect(c.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();                          // Mutation: bypass holdOrSend → this reds
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
    const write = dbMocks.recordAutomationLog.mock.calls.at(-1)![1] as { status: string; heldUntil: string };
    expect(write.status).toBe("held");
    expect(new Date(write.heldUntil).toISOString()).toBe("2027-04-12T13:00:00.000Z");  // 08:00 CDT
  });
});

describe("releasing a held confirmation ask", () => {
  it("re-reads the booking and sends", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: row() });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a released row whose account does not match the subject NEVER sends", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: row({ accountId: "acct_other" }) });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    // Mutation: delete the `found.due.accountId !== row.account_id` line → reds.
  });

  it("a released row now INSIDE the reminder's own eligibility is skipped with its own reason, never texted", async () => {
    // 24h14m out: ONE MINUTE inside the 24h15m lead. Not "next hour" — a
    // fixture far past the bound would pass against any lead value. Written
    // as a literal rather than `APPOINTMENT_CONFIRM_MIN_LEAD_MS - 60_000`,
    // so moving the constant moves this case's verdict instead of dragging
    // the fixture along with it.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 + 14 * 60_000).toISOString() }),
    });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "Too close to the appointment to ask",
    }));
    // Mutation: delete the tooCloseToAsk branch from the releaser → reds, and
    // the row would have been texted in the same quarter hour as the email
    // reminder for an appointment it was meant to precede by two days.
  });

  it("a released row still 24h16m out DOES send — the boundary from the other side", async () => {
    // One minute OUTSIDE the lead, the mirror of the case above. Together
    // they pin 24h15m from both sides: move the constant either way and one
    // of the two reds.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 + 16 * 60_000).toISOString() }),
    });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("sent");
  });

  it("a released row whose recipe was switched off says so", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "This automation was turned off",
    }));
  });

  it("a released row whose booking is GONE says that instead — the other arm of the same ternary", async () => {
    // Both arms, or the ternary is half-tested: with only the "off" case
    // above, swapping `found.why === "off" ? REASONS.recipeOff :
    // REASONS.noLongerDue` to its opposite reds one case and leaves this
    // reading correct by accident. The two reasons are different SENTENCES
    // on a client's Activity page, not two spellings of the same thing.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: null, why: "gone" });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "No longer due",
    }));
    // Mutation: swap the ternary's arms → this case AND the one above red.
  });
});
