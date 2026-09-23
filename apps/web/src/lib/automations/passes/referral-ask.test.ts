import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReferralAsk, AutomationLogRow, QuietSettings } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReferralAsks: vi.fn(), getDueReferralAskById: vi.fn(),
  stampReferralAsked: vi.fn(), stampReferralAskSmsFailed: vi.fn(), countReferralAsksSince: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  recordAutomationLog: vi.fn(),
  // holdOrSend reads this BEFORE re-writing a held row. A factory mock that
  // omits it throws at the moment the export is read — part C's recorded trap.
  getAutomationLogEntry: vi.fn(),
}));
// importOriginal keeps REFERRAL_ASK_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { m } from "@/lib/messages";
import { AUTOMATION_DAILY_CAP } from "../caps";
import type { PassContext } from "../context";
import { referralAskPass, releaseReferralAsk } from "./referral-ask";

const TICK = new Date("2027-09-24T14:00:00.000Z");      // 09:00 CDT, inside the band

/** Distinctive and complete: every field the pass reads gets a value a
 *  passing test could not fake by coincidence. NO accountName — the type
 *  has no such field. */
function row(over: Partial<DueReferralAsk> = {}): DueReferralAsk {
  return {
    bookingId: "bk_r1", accountId: "acct_1",
    endsAt: "2027-09-21T20:00:00.000Z", completedAt: "2027-09-21T21:00:00.000Z",
    followupSentAt: "2027-09-22T14:00:00.000Z",
    reviewRequestedAt: "2027-09-23T14:05:00.000Z",     // NOT equal to followupSentAt
    smsFailedAt: null, reviewRequestEnabled: true,
    contactId: "ct_1", contactEmail: "maria@example.com", contactPhone: "(956) 555-0112",
    // NOT opted out: every existing case is about something else. The
    // opt-out cases set it, one channel at a time.
    contactMarketingEmailOptedOut: false,
    brandName: "Rio Roofing",
    // The two replyToEmails are DIFFERENT and neither is null, copying
    // `review-request.test.ts:39` and `:42` exactly (and its assertions at
    // `:93-94`): the pass must use the row's own top-level `replyToEmail`
    // and never `branding.replyToEmail`, and a fixture that nulls both
    // cannot tell the two apart. Mutation: read `row.branding.replyToEmail`
    // in sendEmail → the email case's `replyTo` assertion reds with the
    // decoy address.
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
                brandCorners: null, brandType: null, brandMode: null,
                replyToEmail: "wrong-should-not-be-used@rioroofing.com" },
    accountTimezone: "America/Chicago",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    // A REAL address, never null: an email-channel row without one is
    // skipped (B21), and every existing email case is about something else.
    mailingAddress: "PO Box 12\nMcAllen, TX 78501",
    body: "", config: { channel: "sms" },
    ...over,
  };
}

function heldRow(over: Partial<AutomationLogRow> = {}): AutomationLogRow {
  return {
    id: "log_ra", account_id: "acct_1", source: "referral_ask", channel: "sms",
    contact_id: "ct_1", subject_key: "booking:bk_r1", status: "held",
    reason: "Held until 12:00 PM — quiet hours", held_until: TICK.toISOString(),
    payload: {}, occurred_at: TICK.toISOString(),
    ...over,
  };
}

const emailSend = vi.fn();
const smsSend = vi.fn();
const QUIET_OFF: QuietSettings = { enabled: false, start: "21:00", end: "08:00" };
function ctx(now: Date = TICK, quiet: QuietSettings = QUIET_OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
    quiet: async () => quiet,
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0,
  skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
  waitingForMorning: 0, waitingForReviewRequest: 0, unresolvableTimezone: 0,
  skippedNoMailingAddress: 0, skippedNoReplyTo: 0, skippedOptedOut: 0,
};
const skippedReasons = () => dbMocks.recordAutomationLog.mock.calls
  .filter((c) => c[1].status === "skipped").map((c) => c[1].reason as string);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReferralAsks.mockResolvedValue([]);
  dbMocks.stampReferralAsked.mockResolvedValue(undefined);
  dbMocks.stampReferralAskSmsFailed.mockResolvedValue(undefined);
  dbMocks.countReferralAsksSince.mockResolvedValue(0);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the referral ask sends by the CONFIGURED channel", () => {
  it("texts, stamps, and writes one sent row — with no link anywhere in the body", async () => {
    dbMocks.listDueReferralAsks.mockResolvedValue([row()]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const body = "Thanks again from Rio Roofing. Know anyone who needs the same done? "
      + "Send their name and number and we'll look after them. Reply STOP to opt out.";
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550112", from: "+19565550000", body });
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body }, "automation", "system");
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "referral_ask", channel: "sms", subjectKey: "booking:bk_r1", status: "sent",
    }));
  });

  it("emails with the company's from address and the row's OWN reply-to, and never touches the SMS provider", async () => {
    // Mutation: read `row.branding.replyToEmail` instead of `row.replyToEmail`
    // in sendEmail → the replyTo line reds with the decoy address.
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ config: { channel: "email" } })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("maria@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");
    expect(sent.subject).toBe("One favor, from Rio Roofing");
    expect(sent.body).toContain("Thanks again from Rio Roofing.");
    expect(sent.html).not.toContain("href=");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();   // email writes no messages row
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_r1");
  });

  it("an invalid stored config sends nothing and writes NO log row", async () => {
    // The channel is unknown before the config parses, so there is no subject
    // to write against. Mutation: delete the `config === null` guard → the
    // loop dereferences `null.channel` building the subject, the run rejects,
    // and this reds.
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ config: null })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("an SMS gate refusal skips and LOGS, and never becomes an email", async () => {
    // Mutation: fall back to email on the gate's refusal branch → reds.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueReferralAsks.mockResolvedValue([row()]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "Texting isn't set up for this company yet",
    }));
  });
});

/**
 * B21 (danlo, 2026-09-23): the referral EMAIL is the second marketing email,
 * so it carries the check-in's footer and will not go without the business's
 * postal address and a reply-to (the opt-out is "reply and let us know", so a
 * reply must reach the business, not the agency's `EMAIL_FROM` mailbox) — and
 * it is never emailed to a contact the operator marked "No marketing emails"
 * (0049). EMAIL CHANNEL ONLY: a text carries neither footer nor address, and
 * its opt-out is the carrier's STOP list, so every one of these leaves an
 * SMS-channel row alone.
 *
 * All three are PASS-LEVEL skips, and that is safe here where it was not for
 * the check-in's walk: this due-list is a bounded booking window with no row
 * limit (`listDueReferralAsks`), so an unstamped skipped row cannot crowd a
 * sendable one out of the page. They sit BEFORE the caps for the tick cap's
 * sake (the last case).
 */
describe("the referral EMAIL: the footer, the address and reply-to it needs, and the contact who asked", () => {
  const ADDRESS_REASON = "The company's mailing address isn't set";
  const REPLY_TO_REASON = "The company has no reply-to address";
  const OPTED_OUT_REASON = "They asked not to get these emails";
  const email = (over: Partial<DueReferralAsk> = {}) => row({ config: { channel: "email" }, ...over });
  const sentEmail = () => emailSend.mock.calls[0]![0] as Record<string, string>;

  it("the email carries the footer — the brand's line, then the account's postal address — after the body, in both parts", async () => {
    // Mutation: hand the template `mailingAddress: ""` (or `footerReason: ""`)
    // in sendEmail → this reds BY NAME.
    dbMocks.listDueReferralAsks.mockResolvedValue([email({ body: "Know anyone?" })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(sentEmail().body).toBe(
      `Know anyone?\n\n${m["automations.reactivation.footerReason"].replace("{name}", "Rio Roofing")}`
      + "\n\nPO Box 12\nMcAllen, TX 78501");
    expect(sentEmail().html).toContain("PO Box 12<br>McAllen, TX 78501");
    expect(sentEmail().html).not.toContain("href=");
  });

  it("composes the footer line from the ROW's brand name — and the no-name line for a blank brand", async () => {
    // Mutation: pass `marketingFooterReason("")` → the first half reds BY NAME.
    const footerOf = () => sentEmail().body!.split("\n\n").at(-2);
    dbMocks.listDueReferralAsks.mockResolvedValue([email()]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(footerOf()).toBe(m["automations.reactivation.footerReason"].replace("{name}", "Rio Roofing"));
    emailSend.mockClear();
    dbMocks.listDueReferralAsks.mockResolvedValue([email({ brandName: "" })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(footerOf()).toBe(m["automations.reactivation.footerReasonNoName"]);
  });

  it("a blank mailing address (after .trim()) skips an EMAIL row: logged, not sent, not stamped", async () => {
    // Mutation: delete the mailing-address check → this reds BY NAME.
    for (const blank of [null, "", " \n\t "]) {
      dbMocks.recordAutomationLog.mockClear(); emailSend.mockClear();
      dbMocks.listDueReferralAsks.mockResolvedValue([email({ mailingAddress: blank })]);
      expect(await referralAskPass.run(ctx()), JSON.stringify(blank)).toEqual({ ...EMPTY, skippedNoMailingAddress: 1 });
      expect(emailSend).not.toHaveBeenCalled();
      expect(skippedReasons()).toEqual([ADDRESS_REASON]);
    }
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
  });

  it("a blank reply-to (after .trim()) skips an EMAIL row: logged, not sent, not stamped", async () => {
    // Mutation: delete the reply-to check → this reds BY NAME, and the
    // "reply and let us know" opt-out lands in the agency's mailbox.
    for (const blank of [null, "", "   "]) {
      dbMocks.recordAutomationLog.mockClear(); emailSend.mockClear();
      dbMocks.listDueReferralAsks.mockResolvedValue([email({ replyToEmail: blank })]);
      expect(await referralAskPass.run(ctx()), JSON.stringify(blank)).toEqual({ ...EMPTY, skippedNoReplyTo: 1 });
      expect(emailSend).not.toHaveBeenCalled();
      expect(skippedReasons()).toEqual([REPLY_TO_REASON]);
    }
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
  });

  it("a contact who asked not to get marketing email is skipped on the EMAIL channel: logged, not sent, not stamped", async () => {
    // Mutation: delete the opt-out skip → this reds BY NAME. The reason is
    // one the client reads on the Activity page.
    dbMocks.listDueReferralAsks.mockResolvedValue([email({ contactMarketingEmailOptedOut: true })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, skippedOptedOut: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "referral_ask", channel: "email", subjectKey: "booking:bk_r1", contactId: "ct_1",
      status: "skipped", reason: OPTED_OUT_REASON,
    }));
  });

  it("the SMS channel needs no address, no reply-to, and ignores the EMAIL opt-out — the text still goes", async () => {
    // A text's opt-out is the carrier's STOP list, and it carries no footer.
    // Mutation: run any of the three checks for the SMS channel too → this
    // reds BY NAME.
    dbMocks.listDueReferralAsks.mockResolvedValue([row({
      mailingAddress: null, replyToEmail: null, contactMarketingEmailOptedOut: true,
    })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_r1");
  });

  it("released from a hold, an email row whose contact opted out DURING the hold is skipped — and leaves the queue", async () => {
    // The release goes through the same loop (`releaseReferralAsk` →
    // `processReferralAsks`). Mutation: delete the opt-out skip → this reds
    // BY NAME with "sent".
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: email({ contactMarketingEmailOptedOut: true }) });
    expect(await releaseReferralAsk(ctx(), heldRow({ channel: "email" }))).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual([OPTED_OUT_REASON]);
  });

  it("released from a hold, an email row whose address was cleared DURING the hold is skipped — and leaves the queue", async () => {
    // Mutation: delete the mailing-address check → this reds BY NAME.
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: email({ mailingAddress: "  " }) });
    expect(await releaseReferralAsk(ctx(), heldRow({ channel: "email" }))).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual([ADDRESS_REASON]);
  });

  it("rows that cannot go spend NONE of the tick's ten attempts — another booking's email still goes", async () => {
    // Each skipped row is never stamped and stays due all window. Checked
    // AFTER the caps, eleven of them ahead of a sendable row would burn
    // AUTOMATION_TICK_CAP on every tick of the morning. Mutation: move the
    // address/reply-to checks (or the opt-out skip) below the caps → this
    // reds BY NAME.
    const noAddress = Array.from({ length: 11 }, (_, n) =>
      email({ bookingId: `bk_addr_${n}`, accountId: "acct_stuck", mailingAddress: null }));
    const optedOut = Array.from({ length: 11 }, (_, n) =>
      email({ bookingId: `bk_out_${n}`, contactId: `ct_out_${n}`, contactMarketingEmailOptedOut: true }));
    dbMocks.listDueReferralAsks.mockResolvedValue([...noAddress, ...optedOut, email({ bookingId: "bk_ok" })]);
    expect(await referralAskPass.run(ctx()))
      .toEqual({ ...EMPTY, sent: 1, skippedNoMailingAddress: 11, skippedOptedOut: 11 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_ok");
  });
});

describe("THE LADDER — never two rungs on one morning", () => {
  it("holds while the review request went out THIS morning, and sends when it went out the morning before", async () => {
    // 08:05 CDT today: a different local day from the fixture's 09:05 CDT
    // yesterday, and the only field that moves between the two halves.
    // Mutation: delete the reviewRequestedAt clause from the gate → the first
    // half reds.
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ reviewRequestedAt: "2027-09-24T13:05:00.000Z" })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    // THE NORMAL-TICK HALF of `referral-ask.ts`'s guarded logSkipped: a tick
    // that refuses writes NOTHING, because the row is simply due again
    // tomorrow morning and a log row per morning per booking would fill the
    // Activity page with the automation thinking. (The release half — the
    // same refusal writing exactly one "No longer due" — is pinned in the
    // release describe below.) Mutation: make that write unconditional by
    // dropping its `if (opts.released)` → this case reds.
    expect(skippedReasons()).toEqual([]);
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ reviewRequestedAt: "2027-09-23T14:05:00.000Z" })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("PRECEDENCE: waits, silently, while the review request is still owed — and goes the moment reviews are off", async () => {
    // review_request ON, never sent, anchor 18h old (15:00 CDT yesterday):
    // the review can still go today, so the referral waits its turn. NO log
    // row — a normal tick is silent here, because the row is due again
    // tomorrow morning. Mutation: hard-code `reviewRequestEnabled` false
    // inside the pass → the first half reds.
    const owed = { endsAt: "2027-09-23T20:00:00.000Z", completedAt: null, reviewRequestedAt: null };
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ ...owed, reviewRequestEnabled: true })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, waitingForReviewRequest: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    dbMocks.listDueReferralAsks.mockResolvedValue([row({ ...owed, reviewRequestEnabled: false })]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("the referral ask's caps and cooldown", () => {
  it("the SMS cooldown is SILENT on a normal tick and a real skip on a release", async () => {
    // Mutation: drop the `if (opts.released)` guard so the normal tick logs
    // too → the first half reds; delete the whole branch → the second reds.
    // The parked-row rule: a released row left untouched keeps its past
    // `held_until` and starves every newer hold behind it.
    const cooling = row({ smsFailedAt: new Date(TICK.getTime() - 2 * 60 * 60 * 1000).toISOString() });
    dbMocks.listDueReferralAsks.mockResolvedValue([cooling]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();

    dbMocks.getDueReferralAskById.mockResolvedValue({ due: cooling });
    expect(await releaseReferralAsk(ctx(), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "booking:bk_r1", status: "skipped", reason: "Waiting before trying this text again",
    }));
  });

  it("the account's own daily limit is reached: skippedCap BY NAME, with a row that says so", async () => {
    dbMocks.countReferralAsksSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    dbMocks.listDueReferralAsks.mockResolvedValue([row()]);
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, skippedCap: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["Daily limit reached"]);
  });
});

describe("the referral ask and quiet hours", () => {
  // 21:00 → 12:00 puts the whole morning band inside the window, which a
  // window ending at 08:00 cannot do: the band OPENS at 08:00, so a
  // band-gated recipe never meets the default window at all.
  const UNTIL_NOON: QuietSettings = { enabled: true, start: "21:00", end: "12:00" };
  const NOON = new Date("2027-09-24T17:00:00.000Z");   // 12:00 CDT the same day

  it("inside the window it HOLDS: no send, no stamp, one held row ending at noon", async () => {
    // Mutation: bypass holdOrSend and send directly → this reds.
    dbMocks.listDueReferralAsks.mockResolvedValue([row()]);
    expect(await referralAskPass.run(ctx(TICK, UNTIL_NOON))).toEqual({ ...EMPTY, held: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "referral_ask", channel: "sms", subjectKey: "booking:bk_r1", status: "held",
      heldUntil: NOON.toISOString(),
    }));
  });

  it("released at noon it skips the band and sends through the same path, stamp included", async () => {
    // Mutation: apply the morning-band gate on a release → this reds, and
    // every row held overnight would wait a whole extra day.
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: row() });
    expect(await releaseReferralAsk(ctx(NOON, UNTIL_NOON), heldRow())).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ status: "sent" }));
  });
});

describe("releasing a held referral ask", () => {
  it("a held row whose account does not match the subject NEVER sends", async () => {
    // Mutation: delete the `found.due.accountId !== row.account_id` line → reds.
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: row() });   // due.accountId is "acct_1"
    expect(await releaseReferralAsk(ctx(), { ...heldRow(), account_id: "acct_2" })).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accountId: "acct_2", status: "skipped", reason: "No longer due",
    }));
  });

  it("PRECEDENCE RE-APPLIED: a release that still owes the review writes a real skip, never nothing", async () => {
    // The agency may have switched review requests ON during the hold. The
    // row is written `skipped` rather than left untouched — an untouched
    // released row keeps its past `held_until` and parks the head of the
    // queue for ever. Mutation: `continue`/return without the logSkipped →
    // this reds.
    dbMocks.getDueReferralAskById.mockResolvedValue({
      due: row({ endsAt: "2027-09-23T20:00:00.000Z", completedAt: null, reviewRequestedAt: null,
                 reviewRequestEnabled: true }),
    });
    expect(await releaseReferralAsk(ctx(), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "booking:bk_r1", status: "skipped", reason: "Waiting for the review request to go first",
    }));
  });

  it("THE LADDER ON THE RELEASE PATH: the review went out THIS morning, so the release skips and says so", async () => {
    // AUDIT B's I1. Both rows were held inside the same quiet window — the
    // review request's first, the referral's on a later tick — and both come
    // back on the release tick. The review sends and stamps
    // `review_requested_at = this morning`; the referral's releaser then runs
    // `reviewRequestStillOwed`, which answers "not owed" the moment the stamp
    // is non-null, and hands the row to the pass. `released` must therefore
    // skip the morning BAND and nothing else, or the never-two-rungs-on-one-
    // morning rule is bypassed entirely and the customer gets both texts one
    // minute apart.
    //
    // Mutation: put the gate call back inside `if (!opts.released)` → this
    // reds with "sent".
    dbMocks.getDueReferralAskById.mockResolvedValue({
      due: row({ reviewRequestedAt: "2027-09-24T13:05:00.000Z" }),   // 08:05 CDT, the same local day
    });
    // Released at 12:00 CDT, the end of a 21:00 → 12:00 window: outside the
    // band, which is the whole point of `released`.
    const noon = new Date("2027-09-24T17:00:00.000Z");
    expect(await releaseReferralAsk(
      ctx(noon, { enabled: true, start: "21:00", end: "12:00" }), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    // A REAL row, never left untouched: an untouched released row keeps its
    // past `held_until` and parks the head of the queue for ever.
    expect(skippedReasons()).toEqual(["No longer due"]);
  });

  it("a released row whose booking is GONE says so — the other arm of the same ternary", async () => {
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: null, why: "gone" });
    expect(await releaseReferralAsk(ctx(), heldRow())).toBe("skipped");
    expect(skippedReasons()).toEqual(["No longer due"]);
    // Mutation: swap the ternary's arms → this case AND the `off` case red.
  });

  it("A RELEASE NEVER LEAVES A ROW UNTOUCHED: the recipe is off, so exactly ONE row says so", async () => {
    // `{ due: null, why: "off" }` is also what a config that no longer parses
    // answers, after Task 5's parse guard in `getDueReferralAskById`.
    // Mutation: `return "skipped"` on the `!found.due` path without the
    // logSkipped → this reds, and the held row keeps its past `held_until`
    // for ever.
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseReferralAsk(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(skippedReasons()).toEqual(["This automation was turned off"]);
  });

  it("characterises the silent branch the data layer's parse guard makes unreachable", async () => {
    // A due row whose `config` is null CANNOT come out of
    // `getDueReferralAskById` — it answers `why: "off"` for a config that
    // will not parse, which is the case above. Forced here, the pass takes
    // its silent `config === null` branch and writes NOTHING, which is right
    // on a normal tick and would park a released row for ever. This case
    // stays green; it is the thing that goes green-for-the-wrong-reason if
    // anyone removes that guard, and the guard's own RED lives in the db
    // suite (`by id, a config that no longer parses answers 'off'`).
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: row({ config: null }) });
    expect(await releaseReferralAsk(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });
});
