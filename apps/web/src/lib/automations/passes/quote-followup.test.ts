import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueQuoteFollowup, AutomationLogRow, QuietSettings } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueQuoteFollowups: vi.fn(), getDueQuoteFollowupById: vi.fn(),
  stampQuoteFollowupSent: vi.fn(), stampQuoteFollowupSmsFailed: vi.fn(), countQuoteFollowupsSince: vi.fn(),
  latestInboundByContact: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  recordAutomationLog: vi.fn(),
  // holdOrSend reads this BEFORE re-writing a held row. A factory mock that
  // omits it throws at the moment the export is read - part C's recorded trap.
  getAutomationLogEntry: vi.fn(),
}));
// importOriginal keeps QUOTE_FOLLOWUP_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { AUTOMATION_DAILY_CAP } from "../caps";
import { defaultQuoteFollowupBody } from "../quote-followup-copy";
import type { PassContext } from "../context";
import { quoteFollowupPass, releaseQuoteFollowup } from "./quote-followup";

const TICK = new Date("2027-10-20T14:00:00.000Z");      // 09:00 CDT, inside the band
const STAGE = "6f1b2c3d-4e5a-4b7c-8d9e-0a1b2c3d4e5f";
const STAGE_CHANGED = "2027-10-15T14:00:00.000Z";        // five days before the tick

/** Distinctive and complete: every field the pass reads gets a value a
 *  passing test could not fake by coincidence. NO accountName - the type has
 *  no such field, and no deal name either. */
function row(over: Partial<DueQuoteFollowup> = {}): DueQuoteFollowup {
  return {
    opportunityId: "opp_q1", accountId: "acct_1",
    stageId: STAGE, configStageId: STAGE,
    stageChangedAt: STAGE_CHANGED, quietDays: 3,
    smsFailedAt: null,
    contactId: "ct_q1", contactEmail: "maria@example.com", contactPhone: "(956) 555-0112",
    brandName: "Rio Roofing",
    // The two replyToEmails are DIFFERENT and neither is null, copying
    // `review-request.test.ts:39`/`:42`: the pass must use the row's own
    // top-level `replyToEmail` and never `branding.replyToEmail`, and a
    // fixture that nulls both cannot tell the two apart. Mutation: read
    // `row.branding.replyToEmail` in sendEmail -> the email case's `replyTo`
    // assertion reds with the decoy address.
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
                brandCorners: null, brandType: null, brandMode: null,
                replyToEmail: "wrong-should-not-be-used@rioroofing.com" },
    accountTimezone: "America/Chicago",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { stageId: STAGE, quietDays: 3, channel: "sms" },
    ...over,
  };
}

function heldRow(over: Partial<AutomationLogRow> = {}): AutomationLogRow {
  return {
    id: "log_qf", account_id: "acct_1", source: "quote_followup", channel: "sms",
    contact_id: "ct_q1", subject_key: "opportunity:opp_q1", status: "held",
    reason: "Held until 12:00 PM - quiet hours", held_until: TICK.toISOString(),
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
  waitingForMorning: 0, unresolvableTimezone: 0,
};
const skippedReasons = () => dbMocks.recordAutomationLog.mock.calls
  .filter((c) => c[1].status === "skipped").map((c) => c[1].reason as string);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueQuoteFollowups.mockResolvedValue([]);
  dbMocks.stampQuoteFollowupSent.mockResolvedValue(undefined);
  dbMocks.stampQuoteFollowupSmsFailed.mockResolvedValue(undefined);
  dbMocks.countQuoteFollowupsSince.mockResolvedValue(0);
  dbMocks.latestInboundByContact.mockResolvedValue(new Map());
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

describe("the quote follow-up sends by the CONFIGURED channel", () => {
  it("texts, stamps THE OPPORTUNITY, and writes one sent row keyed opportunity:<id>", async () => {
    // Mutation: write `booking:` instead of `opportunity:` in the subject key
    // -> this reds, and the row would collide with a booking-subject recipe's
    // line for an entirely different thing.
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row()]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const body = "Hi, it's Rio Roofing. Just checking you got the quote we sent. "
      + "Happy to answer anything or adjust it. Any questions? Reply STOP to opt out.";
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550112", from: "+19565550000", body });
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body }, "automation", "system");
    expect(dbMocks.stampQuoteFollowupSent).toHaveBeenCalledWith(expect.anything(), "opp_q1");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "quote_followup", channel: "sms", subjectKey: "opportunity:opp_q1", status: "sent",
    }));
  });

  it("emails the default body EXACTLY - no deal name, no price, nothing appended", async () => {
    // Exact equality, not a substring: it is the only assertion that can
    // catch a price or the deal's own internal name being pasted in beside
    // the copy. Mutation: read `row.branding.replyToEmail` instead of
    // `row.replyToEmail` in sendEmail -> the replyTo line reds with the decoy.
    dbMocks.listDueQuoteFollowups.mockResolvedValue([
      row({ config: { stageId: STAGE, quietDays: 3, channel: "email" } }),
    ]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("maria@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");
    expect(sent.subject).toBe("About your quote from Rio Roofing");
    expect(sent.body).toBe(defaultQuoteFollowupBody("Rio Roofing"));
    expect(sent.html).not.toContain("href=");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();   // email writes no messages row
    expect(dbMocks.stampQuoteFollowupSent).toHaveBeenCalledWith(expect.anything(), "opp_q1");
  });

  it("an invalid stored config sends nothing and writes NO log row", async () => {
    // The channel is unknown before the config parses, so there is no subject
    // to write against. Mutation: DELETE the `config === null` guard -> the
    // loop dereferences `null.channel` building the subject, the run rejects,
    // and this reds. (NOT "build the subject before parsing": that changes
    // neither the counter nor the absence of a log row, so it cannot red.)
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row({ config: null })]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("an SMS gate refusal skips and LOGS, and never becomes an email", async () => {
    // Mutation: fall back to email on the gate's refusal branch -> reds.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row()]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["Texting isn't set up for this company yet"]);
  });

  it("no deliverable address on the configured channel skips under its own name", async () => {
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row({ contactPhone: null })]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(skippedReasons()).toEqual(["No phone number we can text"]);
    dbMocks.recordAutomationLog.mockClear();
    dbMocks.listDueQuoteFollowups.mockResolvedValue([
      row({ contactEmail: null, config: { stageId: STAGE, quietDays: 3, channel: "email" } }),
    ]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(skippedReasons()).toEqual(["No email address on file"]);
  });

  it("an unresolvable account zone HOLDS the row with a reason rather than guessing an hour", async () => {
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["The company's time zone isn't set"]);
  });
});

describe("the quote follow-up's morning band, caps and cooldown", () => {
  it("outside the morning band nothing goes and NOTHING is logged - the row is due again tomorrow", async () => {
    // 18:00Z is 13:00 CDT, two hours past the band's close. Mutation: drop the
    // `shouldSendQuoteFollowupNow` call from the pass -> this reds and a quote
    // follow-up goes out at one in the afternoon.
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row()]);
    expect(await quoteFollowupPass.run(ctx(new Date("2027-10-20T18:00:00.000Z"))))
      .toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("the SMS cooldown is SILENT on a normal tick and a real skip on a release", async () => {
    // Mutation: drop the `if (opts.released)` guard so the normal tick logs
    // too -> the first half reds; delete the whole branch -> the second reds.
    // The parked-row rule: a released row left untouched keeps its past
    // `held_until` and starves every newer hold behind it.
    const cooling = row({ smsFailedAt: new Date(TICK.getTime() - 2 * 60 * 60 * 1000).toISOString() });
    dbMocks.listDueQuoteFollowups.mockResolvedValue([cooling]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();

    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: cooling });
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "opportunity:opp_q1", status: "skipped", reason: "Waiting before trying this text again",
    }));
  });

  it("the account's own daily limit is reached: skippedCap BY NAME, with a row that says so", async () => {
    dbMocks.countQuoteFollowupsSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row()]);
    expect(await quoteFollowupPass.run(ctx())).toEqual({ ...EMPTY, skippedCap: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["Daily limit reached"]);
  });
});

describe("the quote follow-up and quiet hours", () => {
  // 21:00 -> 12:00 puts the whole morning band inside the window, which a
  // window ending at 08:00 cannot do: the band OPENS at 08:00, so a
  // band-gated recipe never meets the default window at all.
  const UNTIL_NOON: QuietSettings = { enabled: true, start: "21:00", end: "12:00" };
  const NOON = new Date("2027-10-20T17:00:00.000Z");   // 12:00 CDT the same day

  it("inside the window it HOLDS: no send, no stamp, one held row ending at noon", async () => {
    // Mutation: bypass holdOrSend and send directly -> this reds.
    dbMocks.listDueQuoteFollowups.mockResolvedValue([row()]);
    expect(await quoteFollowupPass.run(ctx(TICK, UNTIL_NOON))).toEqual({ ...EMPTY, held: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "quote_followup", channel: "sms", subjectKey: "opportunity:opp_q1", status: "held",
      heldUntil: NOON.toISOString(),
    }));
  });

  it("released at noon it skips the band and sends through the same path, stamp included", async () => {
    // Mutation: apply the morning-band gate on a release -> this reds, and
    // every row held overnight would wait a whole extra day.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row() });
    expect(await releaseQuoteFollowup(ctx(NOON, UNTIL_NOON), heldRow())).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampQuoteFollowupSent).toHaveBeenCalledWith(expect.anything(), "opp_q1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ status: "sent" }));
  });
});

describe("releasing a held quote follow-up", () => {
  it("a held row whose account does not match the subject NEVER sends", async () => {
    // Mutation: delete the `found.due.accountId !== row.account_id` line -> reds.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row() });   // due.accountId is "acct_1"
    expect(await releaseQuoteFollowup(ctx(), { ...heldRow(), account_id: "acct_2" })).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accountId: "acct_2", status: "skipped", reason: "No longer due",
    }));
  });

  it("A RELEASE NEVER LEAVES A ROW UNTOUCHED: the recipe is off, so exactly ONE row says so", async () => {
    // `{ due: null, why: "off" }` is also what a config that no longer parses
    // answers (`getDueQuoteFollowupById`'s parse guard).
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(skippedReasons()).toEqual(["This automation was turned off"]);
  });

  it("a released row whose opportunity is GONE says so - the other arm of the same ternary", async () => {
    // Mutation: swap the ternary's arms -> this case AND the `off` case red.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: null, why: "gone" });
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(skippedReasons()).toEqual(["No longer due"]);
  });

  it("THE STAGE VANISHED during the hold: the row leaves the queue with a reason, and nothing is sent", async () => {
    // A normal tick CANNOT produce this - the due-list filters on `stage_id`,
    // so a vanished stage yields no row at all and there is no subject to
    // write against. The releaser is the only place the reason is reachable.
    // Mutation: delete the `stageId !== configStageId` branch from the
    // releaser -> this reds and the follow-up goes out about a stage the
    // operator no longer watches.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({
      due: row({ stageId: "11111111-2222-4333-8444-555555555555" }),
    });
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["The stage this automation watches is gone"]);
  });

  it("THE QUIET RE-CHECK: a customer who replied during the hold is not chased at 8 AM", async () => {
    // Mutation: remove the `latestInboundByContact` call from the releaser ->
    // this reds, and a customer who answered the quote during the hold gets
    // chased about it the next morning.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row() });
    dbMocks.latestInboundByContact.mockResolvedValue(new Map([["ct_q1", "2027-10-17T02:11:00.000Z"]]));
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampQuoteFollowupSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["They've been in touch since"]);
  });

  it("and an inbound from BEFORE the stage change is not a reply to this quote: it still sends", async () => {
    // The negative that cannot be satisfied by an earlier guard - every other
    // field is the sending fixture's, and only the instant moves. Mutation:
    // compare with `>=`/drop the comparison and return skipped on any entry
    // -> this reds.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row() });
    dbMocks.latestInboundByContact.mockResolvedValue(new Map([["ct_q1", "2027-10-14T02:11:00.000Z"]]));
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampQuoteFollowupSent).toHaveBeenCalledWith(expect.anything(), "opp_q1");
  });

  it("the release asks for the inbound scan SCOPED to this one contact, from the stage change", async () => {
    // `latestInboundByContact` reads `conversations` with no account_id scope
    // of its own (its comment says so): on the tick path the ids come from an
    // already-narrowed candidate set, and here the single contact id is that
    // narrowing. Mutation: pass `[]` or a wider list -> this reds.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row() });
    await releaseQuoteFollowup(ctx(), heldRow());
    expect(dbMocks.latestInboundByContact).toHaveBeenCalledWith(
      expect.anything(), ["ct_q1"], STAGE_CHANGED);
  });

  it("characterises the silent branch the data layer's parse guard makes unreachable", async () => {
    // A due row whose `config` is null CANNOT come out of
    // `getDueQuoteFollowupById` - it answers `why: "off"` for a config that
    // will not parse, which is the case above. Forced here, the pass takes its
    // silent `config === null` branch and writes NOTHING, which is right on a
    // normal tick and would park a released row for ever. This case stays
    // green; it is what goes green-for-the-wrong-reason if anyone removes
    // that guard, and the guard's own RED lives in the db suite.
    dbMocks.getDueQuoteFollowupById.mockResolvedValue({ due: row({ config: null }) });
    expect(await releaseQuoteFollowup(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });
});
