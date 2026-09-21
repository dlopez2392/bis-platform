import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE SENTINEL. `accounts.name` is the agency's internal label for a company
 * ("Rio Roofing — trial") and it has reached customers three times. Every
 * registered pass is run here and every argument of every send — email and
 * SMS, plus the SMS message row — is scanned for it.
 *
 * No due-row type carries the label any more (the last two lost it with the
 * resolver's second parameter), which the absence pin at the bottom of the
 * first describe keeps true. The scan stays anyway: it is the only check that
 * looks at what actually LEFT the building, whatever a future recipe reads.
 *
 * Mutation: in passes/reminders.ts send `INTERNAL_LABEL` as `fromName`.
 */
const dbMocks = vi.hoisted(() => ({
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(),
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(),
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  stampReviewRequestSmsFailed: vi.fn(),
  listDueNoShowNudges: vi.fn(), stampNoShowNudged: vi.fn(), stampNoShowNudgeSmsFailed: vi.fn(), countNoShowNudgesSince: vi.fn(),
  listDueSmsReminders: vi.fn(), stampSmsReminderSent: vi.fn(), stampSmsReminderFailed: vi.fn(),
  getAutomation: vi.fn(), hasRecentOutboundSms: vi.fn(), countInstantRepliesSince: vi.fn(), stampInstantReplySent: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  listSitesToSync: vi.fn(),
  listAccountsDueWeeklyReport: vi.fn(),
  getAgencyReportTarget: vi.fn(), stampAgencyReportSent: vi.fn(), listAccountsForWeeklyRollup: vi.fn(),
  recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: async () => ({ ok: true, from: "+19565550000" }) }));
// The inline recipe reaches its provider through harness.ts's lazySmsProvider,
// i.e. through this factory; the registered passes get theirs on ctx.
const inlineSmsSend = vi.fn(async () => ({ providerMessageId: "s-inline" }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => ({ isFake: true, send: inlineSmsSend }) }));
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }) }));

import type { DueReminder, DueFollowup } from "@bis/db";
import { runPasses } from "./harness";
import { PASSES } from "./registry";
import type { PassContext } from "./context";
import { sendInstantReply, type InstantReplyInput } from "./instant-reply";

const INTERNAL_LABEL = "Rio Roofing — trial";
const BRAND = "Rio Roofing";
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00, inside the morning band
const branding = {
  brandName: BRAND, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

/** The two cron due-rows, named so the absence pin below can extend them. */
const REMINDER_ROW: DueReminder = {
  bookingId: "bk_rem", accountId: "acct_1", contactId: "ct_1", startsAt: "2026-09-10T14:00:00.000Z", bookerTimezone: null,
  cancelToken: "tok", calendarPublicId: "cal", contactEmail: "a@example.com", contactName: "A",
  accountTimezone: "America/New_York", branding, fromEmail: null, meetingUrl: null,
};
const FOLLOWUP_ROW: DueFollowup = {
  bookingId: "bk_fu", accountId: "acct_1", contactId: "ct_1", startsAt: "2026-09-08T21:00:00.000Z", endsAt: "2026-09-08T22:00:00.000Z",
  contactEmail: "b@example.com", contactName: "B",
  accountTimezone: "America/New_York", branding, fromEmail: null, replyToEmail: null, followupBody: "",
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset().mockResolvedValue(undefined);
  dbMocks.listDueReminders.mockResolvedValue([REMINDER_ROW]);
  dbMocks.listDueFollowups.mockResolvedValue([FOLLOWUP_ROW]);
  const review = {
    accountId: "acct_1", endsAt: "2026-09-08T22:00:00.000Z", followupSentAt: null, completedAt: null, smsFailedAt: null, brandName: BRAND, branding,
    accountTimezone: "America/New_York", fromEmail: null, replyToEmail: null, body: "",
  };
  dbMocks.listDueReviewRequests.mockResolvedValue([
    { ...review, bookingId: "bk_rv_email", contactId: "ct_1", contactEmail: "c@example.com", contactPhone: null,
      config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } },
    { ...review, bookingId: "bk_rv_sms", contactId: "ct_2", contactEmail: null, contactPhone: "9565550101",
      config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  ]);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  const nudge = {
    accountId: "acct_1", endsAt: "2026-09-08T20:00:00.000Z", noShowAt: "2026-09-08T20:30:00.000Z", smsFailedAt: null,
    calendarPublicId: "cal_pub_1", calendarEnabled: true, brandName: BRAND, branding,
    accountTimezone: "America/New_York", fromEmail: null, replyToEmail: null, body: "",
  };
  dbMocks.listDueNoShowNudges.mockResolvedValue([
    { ...nudge, bookingId: "bk_ns_email", contactId: "ct_3", contactEmail: "d@example.com", contactPhone: null, config: { channel: "email" } },
    { ...nudge, bookingId: "bk_ns_sms", contactId: "ct_4", contactEmail: null, contactPhone: "9565550102", config: { channel: "sms" } },
  ]);
  dbMocks.countNoShowNudgesSince.mockResolvedValue(0);
  dbMocks.listDueSmsReminders.mockResolvedValue([{
    bookingId: "bk_sr", accountId: "acct_1", startsAt: "2026-09-09T16:00:00.000Z", bookerTimezone: null,
    smsFailedAt: null, contactId: "ct_5", contactPhone: "9565550103", brandName: BRAND,
    accountTimezone: "America/New_York", body: "",
  }]);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  // The site-traffic pass sends nothing, so it has no row here — but it must
  // RUN under the sentinel, not error out of the harness: a pass that quietly
  // fails is a pass the scan never looked at (the withBookingCancelled lesson).
  dbMocks.listSitesToSync.mockResolvedValue([]);
  // Same treatment for the weekly report: TICK is a Wednesday in every zone
  // (no IANA offset shifts a calendar day back two full days), so it can
  // never be in the Monday band here regardless of account timezone. Empty
  // due-list — it still runs to real counters, not `errored`.
  dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([]);
  // And the agency roll-up: no agency row configured in this fixture, so it
  // takes the visible-skip path (skippedNoRecipient) before it would ever
  // reach the same Wednesday-is-never-Monday gate the client pass above
  // hits — either way it must run to real counters, never `errored`.
  dbMocks.getAgencyReportTarget.mockResolvedValue(null);
  dbMocks.listAccountsForWeeklyRollup.mockResolvedValue([]);
});

describe("the sentinel: the internal label never reaches a customer, through ANY registered pass", () => {
  it("every argument of every email send, SMS send and SMS message row is free of the label", async () => {
    const emailSend = vi.fn(async () => ({ providerMessageId: "e" }));
    const smsSend = vi.fn(async () => ({ providerMessageId: "s" }));
    const ctx: PassContext = {
      db: {} as never, now: TICK, origin: "https://app.example.com",
      email: { isFake: true, send: emailSend }, sms: () => ({ isFake: true, send: smsSend }),
      quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
    };

    const results = await runPasses(PASSES, ctx);

    // Guard the fixture: every pass actually sent, so the scan has teeth.
    expect(results.reminders?.sent).toBe(1);
    expect(results.followups?.sent).toBe(1);
    expect(results.reviewRequests?.sent).toBe(2);
    expect(results.noShowNudges?.sent).toBe(2);
    expect(results.smsReminders?.sent).toBe(1);
    // …and the two passes that send nothing this tick ran to their counters,
    // not to `errored`.
    expect(results.siteTraffic).toEqual(expect.objectContaining({ synced: 0, failed: 0 }));
    expect(results.siteTraffic).not.toHaveProperty("errored");
    expect(results.weeklyClientReport).toEqual(expect.objectContaining({ sent: 0, failed: 0 }));
    expect(results.weeklyClientReport).not.toHaveProperty("errored");
    expect(results.weeklyAgencyReport).toEqual(expect.objectContaining({ sent: 0, failed: 0 }));
    expect(results.weeklyAgencyReport).not.toHaveProperty("errored");

    const everything = [...emailSend.mock.calls, ...smsSend.mock.calls, ...dbMocks.createMessage.mock.calls]
      .map((args) => JSON.stringify(args)).join("\n");
    expect(everything).not.toContain("— trial");
    expect(everything).not.toContain(INTERNAL_LABEL);
    expect(everything).toContain(BRAND);   // and the brand name DID go out, in its place
  });

  it("the registry runs reminders, follow-ups, review requests, no-show nudges, text reminders, site traffic, then the two weekly reports — the first three's order is the collision's contract", () => {
    expect(PASSES.map((p) => p.key)).toEqual(["reminders", "followups", "reviewRequests", "noShowNudges", "smsReminders", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]);
  });

  /**
   * The scan above proves the label did not go out THIS tick. This proves a
   * pass could not send it if it tried: the two migrated row types have no
   * field for it, exactly as the three newer ones never did.
   *
   * Mutation: add `accountName: string` back to `DueReminder` or `DueFollowup`
   * in packages/db/src/booking.ts — the matching directive becomes unused and
   * `tsc` refuses it.
   */
  it("no cron row type carries the agency's label any more", () => {
    // @ts-expect-error — DueReminder has no accountName
    const r: DueReminder = { ...REMINDER_ROW, accountName: INTERNAL_LABEL };
    // @ts-expect-error — DueFollowup has no accountName
    const f: DueFollowup = { ...FOLLOWUP_ROW, accountName: INTERNAL_LABEL };
    void r; void f;
  });
});

const INLINE_INPUT: InstantReplyInput = {
  db: {} as never, now: TICK, accountId: "acct_1", submissionId: "sub_1", contactId: "ct_9",
  conversationId: "convo_1", phoneE164: "+19565550109", locale: "en", consentWithheld: false,
};

describe("the sentinel — the inline recipe (instant reply) has no name to leak", () => {
  it("its input type carries no account name at all — a recipe author cannot leak what they cannot reach", () => {
    // Mutation: add `accountName: string` to InstantReplyInput and this compiles.
    // @ts-expect-error — InstantReplyInput has no accountName
    const bad: InstantReplyInput = { ...INLINE_INPUT, accountName: INTERNAL_LABEL };
    void bad;
  });

  it("every argument of the SMS send and the message row is the SAVED body, free of the label", async () => {
    // Mutation: prefix the body with `accounts.name` inside the module — there is no such value to reach.
    dbMocks.getAutomation.mockResolvedValue({
      id: "au_ir", account_id: "acct_1", recipe_key: "instant_reply", enabled: true,
      body: `Hi, this is ${BRAND}. We got your message.`, config: { bodyEs: `Hola, somos ${BRAND}.` },
      created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
    });
    dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
    dbMocks.countInstantRepliesSince.mockResolvedValue(0);
    dbMocks.stampInstantReplySent.mockResolvedValue(undefined);
    dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_inline" });
    dbMocks.updateMessageStatus.mockResolvedValue(undefined);
    inlineSmsSend.mockClear();
    dbMocks.createMessage.mockClear();

    expect(await sendInstantReply(INLINE_INPUT)).toEqual({ kind: "sent", unstamped: false });

    const everything = [...inlineSmsSend.mock.calls, ...dbMocks.createMessage.mock.calls]
      .map((args) => JSON.stringify(args)).join("\n");
    expect(inlineSmsSend).toHaveBeenCalledTimes(1);   // guards the fixture: it actually sent
    expect(everything).not.toContain("— trial");
    expect(everything).not.toContain(INTERNAL_LABEL);
    expect(everything).toContain(BRAND);
  });
});
