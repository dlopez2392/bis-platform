import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReactivation, AutomationLogRow, QuietSettings } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReactivations: vi.fn(), getDueReactivationById: vi.fn(),
  stampReactivationSent: vi.fn(), countReactivationsSince: vi.fn(),
  conversationQuietSince: vi.fn(),
  recordAutomationLog: vi.fn(),
  // holdOrSend reads this BEFORE re-writing a held row. A factory mock that
  // omits it throws at the moment the export is read — part C's recorded trap.
  getAutomationLogEntry: vi.fn(),
}));
// importOriginal keeps the PURE exports real — `reactivationCutoff` above
// all. It is deliberately NOT in `dbMocks`: stubbed, it would resolve
// `undefined` and the pass would throw on `.toISOString()`, and the cases
// below that assert the cutoff by value would have nothing to compare.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { reactivationCutoff } from "@bis/db";
import { AUTOMATION_DAILY_CAP, REACTIVATION_DAILY_CAP } from "../caps";
import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { m } from "@/lib/messages";
import type { PassContext } from "../context";
import { reactivationPass, releaseReactivation } from "./reactivation";

const TICK = new Date("2027-09-24T14:00:00.000Z");      // 09:00 CDT, inside the band
const OUTSIDE_BAND = new Date("2027-09-24T20:00:00.000Z"); // 15:00 CDT, the same day

/** Distinctive and complete: every field the pass reads gets a value a
 *  passing test could not fake by coincidence. NO accountName and NO PHONE —
 *  the type has neither, and the absent phone IS the email-only mechanism.
 *  `lastMessageAt` sits BEFORE the tick (a stamp in the future would still be
 *  the same local day, so the fixture would be green on a row that cannot
 *  occur) and comfortably before this row's own twelve-month cutoff. */
function row(over: Partial<DueReactivation> = {}): DueReactivation {
  return {
    contactId: "ct_1", accountId: "acct_1",
    lastMessageAt: "2026-05-02T15:30:00.000Z",
    // TWELVE, not the platform default of nine: case 8 asserts the exact
    // cutoff this row's own months produce, and a fixture on the default
    // could be satisfied by a pass that ignored `quietMonths` and used it.
    quietMonths: 12,
    contactEmail: "maria@example.com", contactName: "Maria",
    brandName: "Rio Roofing",
    // The two replyToEmails are DIFFERENT and neither is null, copying
    // `review-request.test.ts:39` and `:42` exactly (and its assertions at
    // `:93-94`): the pass must use the row's own top-level `replyToEmail`
    // and never `branding.replyToEmail`, and a fixture that nulls both
    // cannot tell the two apart.
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
                brandCorners: null, brandType: null, brandMode: null,
                replyToEmail: "wrong-should-not-be-used@rioroofing.com" },
    accountTimezone: "America/Chicago",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    mailingAddress: "123 Main St\nMcAllen, TX 78501",
    body: "",
    ...over,
  };
}

function heldRow(over: Partial<AutomationLogRow> = {}): AutomationLogRow {
  return {
    id: "log_rx", account_id: "acct_1", source: "reactivation", channel: "email",
    contact_id: "ct_1", subject_key: "contact:ct_1", status: "held",
    reason: "Held until 12:00 PM — quiet hours", held_until: TICK.toISOString(),
    payload: {}, occurred_at: TICK.toISOString(),
    ...over,
  };
}

const emailSend = vi.fn();
const smsSend = vi.fn();
/** The LAZY getter itself is the spy, not just the provider's send: this
 *  recipe must never so much as ASK for an SMS provider. */
const smsFactory = vi.fn(() => ({ isFake: true as const, send: (...a: unknown[]) => smsSend(...a) }));
const QUIET_OFF: QuietSettings = { enabled: false, start: "21:00", end: "08:00" };
function ctx(now: Date = TICK, quiet: QuietSettings = QUIET_OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: smsFactory as unknown as PassContext["sms"],
    quiet: async () => quiet,
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0,
  skippedCap: 0, skippedHeardBack: 0, waitingForMorning: 0, unresolvableTimezone: 0,
  skippedNoMailingAddress: 0, skippedNoReplyTo: 0,
};
const skippedReasons = () => dbMocks.recordAutomationLog.mock.calls
  .filter((c) => c[1].status === "skipped").map((c) => c[1].reason as string);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReactivations.mockResolvedValue([]);
  dbMocks.stampReactivationSent.mockResolvedValue(undefined);
  dbMocks.countReactivationsSince.mockResolvedValue(0);
  // LOAD-BEARING DEFAULT: a pass that awaits an unstubbed mock gets
  // `undefined`, which is falsy, so every row would skip as `heardBack` and
  // case 1 would red for the wrong reason.
  dbMocks.conversationQuietSince.mockResolvedValue(true);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  smsFactory.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the reactivation check-in is EMAIL ONLY", () => {
  it("sends one email, stamps the contact, writes a sent row — and never reaches for an SMS provider", async () => {
    // Mutation: send this recipe by SMS (reach `ctx.sms()`) → the two SMS
    // assertions red. There is no per-contact SMS consent in this schema and
    // the due-row carries no phone number at all; that absence is the
    // mechanism, not an oversight.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("maria@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");
    expect(sent.subject).toBe("A note from Rio Roofing");
    expect(sent.body).toContain("It's been a while since we were out at your place.");
    expect(sent.html).not.toContain("href=");
    // The footer (decision A): why, how to stop it, and the ROW's own postal
    // address, in both parts. Mutation: stop passing `row.mailingAddress` to
    // `reactivationEmail` → the template throws on `undefined` and this reds.
    expect(sent.body).toContain("If you'd rather not hear from us, reply and let us know.");
    expect(sent.body).toContain("123 Main St\nMcAllen, TX 78501");
    expect(sent.html).toContain("123 Main St<br>McAllen, TX 78501");
    expect(smsFactory).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).toHaveBeenCalledWith(expect.anything(), "ct_1");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "reactivation", channel: "email", subjectKey: "contact:ct_1", contactId: "ct_1", status: "sent",
    }));
  });

  it("outside the morning band nothing goes and NOTHING is logged", async () => {
    // Mutation: drop the `shouldSendReactivationNow` call from the pass →
    // this reds, and a check-in lands at 3pm.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    expect(await reactivationPass.run(ctx(OUTSIDE_BAND))).toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("an email that SENT but could not be stamped is counted UNSTAMPED and still counted sent — and for THIS recipe that is a repeat, not a duplicate", async () => {
    // `stampWithRetry` spends its whole budget (three attempts) and gives up
    // WITHOUT throwing, so the send is real: the customer has the email and
    // `contacts.reactivation_sent_at` is still null.
    //
    // WHY IT IS WORSE HERE THAN ANYWHERE ELSE (stamp-retry.ts's own header:
    // "one failed stamp is no longer 'a duplicate'. It is up to five more
    // reminders... to the same customer, fifteen minutes apart"). This
    // recipe's morning band is THREE HOURS — twelve ticks — and
    // `listDueReactivations` orders `last_message_at` ASCENDING
    // (automations.ts:1238), so the same person sits at the head of the queue
    // every one of them. REACTIVATION_DAILY_CAP cannot bound it either:
    // `countReactivationsSince` counts the very column that failed to write,
    // so it reads 0 again next tick. An unstamped send therefore breaks
    // "once per contact, EVER" — the restraint this whole recipe exists to
    // keep — and counting it `sent` AND `unstamped` is what makes that
    // visible in the cron's body rather than a silent repeat.
    //
    // Mutation: delete the `if (!stamp.stamped)` block → `unstamped` stays 0
    // and this reds BY NAME.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    dbMocks.stampReactivationSent.mockRejectedValue(new Error("PostgREST 503"));
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReactivationSent).toHaveBeenCalledTimes(STAMP_RETRY_DELAYS_MS.length + 1);
    // The log row still says `sent`, because it was: the log is what went
    // out, not whether the bookkeeping afterwards landed.
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "reactivation", subjectKey: "contact:ct_1", status: "sent",
    }));
  });

  it("an unresolvable account zone HOLDS the row and says so, rather than guessing an hour", async () => {
    // Mutation: delete the `resolveAccountZone(...) === null` guard → the
    // gate's own fail-closed then counts it `waitingForMorning` and this reds.
    dbMocks.listDueReactivations.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["The company's time zone isn't set"]);
  });
});

describe("the reactivation check-in's own daily cap", () => {
  it("sends exactly FIVE and skips the sixth, by name and by number", async () => {
    // SIX eligible contacts, so "five send and the sixth is skippedCap"
    // cannot be satisfied by AUTOMATION_TICK_CAP (10). Mutation: use
    // AUTOMATION_DAILY_CAP instead of REACTIVATION_DAILY_CAP → all six send
    // and this reds.
    expect(REACTIVATION_DAILY_CAP).toBeLessThan(AUTOMATION_DAILY_CAP);
    dbMocks.listDueReactivations.mockResolvedValue(
      [1, 2, 3, 4, 5, 6].map((n) => row({ contactId: `ct_${n}` })));
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 5, skippedCap: 1 });
    expect(emailSend).toHaveBeenCalledTimes(5);
    expect(dbMocks.stampReactivationSent).toHaveBeenCalledTimes(5);
    expect(skippedReasons()).toEqual(["Daily limit reached"]);
  });

  it("counts what already went out today, read back off the stamp column", async () => {
    // Mutation: drop the `countReactivationsSince` read and start the tally
    // at 0 → this reds, and an account gets five more every tick.
    dbMocks.countReactivationsSince.mockResolvedValue(REACTIVATION_DAILY_CAP);
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, skippedCap: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["Daily limit reached"]);
  });
});

describe("the reactivation check-in and quiet hours", () => {
  // 21:00 → 12:00 puts the whole morning band inside the window, which a
  // window ending at 08:00 cannot do: the band OPENS at 08:00, so a
  // band-gated recipe never meets the default window at all.
  const UNTIL_NOON: QuietSettings = { enabled: true, start: "21:00", end: "12:00" };
  const NOON = new Date("2027-09-24T17:00:00.000Z");   // 12:00 CDT the same day

  it("inside the window it HOLDS: no send, no stamp, one held row ending at noon", async () => {
    // Mutation: bypass holdOrSend and call ctx.email.send directly → this reds.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    expect(await reactivationPass.run(ctx(TICK, UNTIL_NOON))).toEqual({ ...EMPTY, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "reactivation", channel: "email", subjectKey: "contact:ct_1", status: "held",
      heldUntil: NOON.toISOString(),
    }));
  });

  it("released at noon it skips the band and sends through the same path, stamp included", async () => {
    // Mutation: apply the morning-band gate on a release → this reds, and
    // every row held overnight would wait a whole extra day.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: row() });
    expect(await releaseReactivation(ctx(NOON, UNTIL_NOON), heldRow())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReactivationSent).toHaveBeenCalledWith(expect.anything(), "ct_1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ status: "sent" }));
  });
});

describe("releasing a held reactivation", () => {
  it("a held row whose account does not match the subject NEVER sends", async () => {
    // Mutation: delete the `found.due.accountId !== row.account_id` line → reds.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: row() });   // due.accountId is "acct_1"
    expect(await releaseReactivation(ctx(), { ...heldRow(), account_id: "acct_2" })).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accountId: "acct_2", status: "skipped", reason: "No longer due",
    }));
  });

  it("a contact already stamped (or gone) says 'No longer due' — the other arm of the same ternary", async () => {
    dbMocks.getDueReactivationById.mockResolvedValue({ due: null, why: "gone" });
    expect(await releaseReactivation(ctx(), heldRow())).toBe("skipped");
    expect(skippedReasons()).toEqual(["No longer due"]);
    // Mutation: swap the ternary's arms → this case AND the `off` case red.
  });

  it("A RELEASE NEVER LEAVES A ROW UNTOUCHED: the recipe is off, so exactly ONE row says so", async () => {
    // `{ due: null, why: "off" }` is also what a config that no longer parses
    // answers, after Task 7's parse guard in `getDueReactivationById`.
    // Mutation: `return "skipped"` on the `!found.due` path without the
    // logSkipped → this reds, and the held row keeps its past `held_until`
    // for ever.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseReactivation(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(skippedReasons()).toEqual(["This automation was turned off"]);
  });

  it("THE QUIET RE-CHECK ON RELEASE: somebody who wrote in during the hold is never told 'it's been a while'", async () => {
    // A hold can last hours. Mutation: remove the `conversationQuietSince`
    // call from `releaseReactivation` → this reds, and a customer who wrote
    // in last night is told "it's been a while since we were out at your
    // place". Written `skipped` rather than left untouched: an untouched
    // released row keeps its past `held_until` and parks the head of the
    // queue.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: row() });
    dbMocks.conversationQuietSince.mockResolvedValue(false);
    expect(await releaseReactivation(ctx(), heldRow())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(skippedReasons()).toEqual(["They've been in touch since"]);
  });
});

describe("THE EXACT QUIET RE-CHECK on a normal tick — the due-list's bulk read is only a pre-filter", () => {
  it("a contact who wrote in since their own cutoff is skipped, silently, with THIS account's months", async () => {
    // Mutation: delete the per-row `conversationQuietSince` call from
    // `processReactivations` → the first half reds, and an account set to
    // eighteen months on a platform where somebody else is set to six never
    // has its own cutoff enforced.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    dbMocks.conversationQuietSince.mockResolvedValue(false);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, skippedHeardBack: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    // Silent on a normal tick: the row was never due, it is examined again
    // next tick, and there is nothing here a client would want to read.
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    // THIS row's own twelve months, not the widest across the platform.
    const ownCutoff = reactivationCutoff(TICK, 12).toISOString();
    expect(ownCutoff).not.toBe(reactivationCutoff(TICK, 9).toISOString());   // the fixture has teeth
    expect(dbMocks.conversationQuietSince).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "ct_1", ownCutoff);
  });

  it("…and the IDENTICAL fixture sends the moment the same re-check answers quiet", async () => {
    // The negative above is the row this filter is the ONLY thing excluding:
    // one field of the harness changes between the two halves, nothing else.
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    dbMocks.conversationQuietSince.mockResolvedValue(true);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });
});

describe("the operator's own words", () => {
  it("sends the stored body when there is one, and the default when it is blank", async () => {
    dbMocks.listDueReactivations.mockResolvedValue([row({ body: "  Roof still holding up?  " })]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    // The text part is the body, then the footer after a blank line — so the
    // operator's words are its first paragraph, not the whole of it.
    expect((emailSend.mock.calls[0]![0] as Record<string, string>).body?.split("\n\n")[0]).toBe("Roof still holding up?");
    emailSend.mockClear();
    dbMocks.listDueReactivations.mockResolvedValue([row({ body: "   " })]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect((emailSend.mock.calls[0]![0] as Record<string, string>).body?.split("\n\n")[0])
      .toBe(m["automations.reactivation.defaultBody"].replace("{name}", "Rio Roofing"));
  });

  it("composes the footer line from the ROW's brand name — and the no-name line for a blank brand, never 'a customer of .'", async () => {
    // The template prints the line it is given (review minor M6); composing
    // it is the pass's job, with `reactivationFooterReason(row.brandName)`,
    // exactly as it composes the subject. The text part is body, footer
    // line, address — so the line is the second paragraph. Mutation: pass
    // `reactivationFooterReason("")` → the first half reds BY NAME.
    const footerOf = () => (emailSend.mock.calls[0]![0] as Record<string, string>).body!.split("\n\n")[1];
    dbMocks.listDueReactivations.mockResolvedValue([row()]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(footerOf()).toBe(m["automations.reactivation.footerReason"].replace("{name}", "Rio Roofing"));

    emailSend.mockClear();
    dbMocks.listDueReactivations.mockResolvedValue([row({ brandName: "" })]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(footerOf()).toBe(m["automations.reactivation.footerReasonNoName"]);
  });
});

/**
 * DECISION A (danlo, 2026-09-22): the check-in is commercial email, which
 * under CAN-SPAM (the orchestrator's reading, not a lawyer's) needs the
 * sender's postal address and a working opt-out — here, a reply that reaches
 * the BUSINESS. The save refuses to turn the recipe on without either, but
 * either can be cleared on the Branding page afterwards, so the pass checks
 * again before every send, on a normal tick AND on a release (the releaser
 * runs the same loop). Logged with a client-readable reason, never sent,
 * never stamped — the contact stays due for the day the field is filled in.
 */
describe("the check-in never goes without a postal address and a reply-to", () => {
  const ADDRESS_REASON = "The company's mailing address isn't set";
  const REPLY_TO_REASON = "The company has no reply-to address";

  it("a blank mailing address (after .trim()) skips the row on a normal tick: logged, not sent, not stamped", async () => {
    // Mutation: delete the mailing-address check from `processReactivations`
    // → this reds BY NAME.
    for (const blank of [null, "", " \n\t "]) {
      dbMocks.recordAutomationLog.mockClear(); emailSend.mockClear();
      dbMocks.listDueReactivations.mockResolvedValue([row({ mailingAddress: blank })]);
      expect(await reactivationPass.run(ctx()), JSON.stringify(blank)).toEqual({ ...EMPTY, skippedNoMailingAddress: 1 });
      expect(emailSend).not.toHaveBeenCalled();
      expect(skippedReasons()).toEqual([ADDRESS_REASON]);
    }
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
  });

  it("a blank reply-to (after .trim()) skips the row on a normal tick: logged, not sent, not stamped", async () => {
    // Mutation: delete the reply-to check from `processReactivations` → this
    // reds BY NAME, and the "reply and let us know" opt-out lands in the
    // agency's mailbox instead of the business's.
    for (const blank of [null, "", "   "]) {
      dbMocks.recordAutomationLog.mockClear(); emailSend.mockClear();
      dbMocks.listDueReactivations.mockResolvedValue([row({ replyToEmail: blank })]);
      expect(await reactivationPass.run(ctx()), JSON.stringify(blank)).toEqual({ ...EMPTY, skippedNoReplyTo: 1 });
      expect(emailSend).not.toHaveBeenCalled();
      expect(skippedReasons()).toEqual([REPLY_TO_REASON]);
    }
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
  });

  it("released from a hold, a row whose address was cleared DURING the hold is skipped, not sent — and leaves the queue", async () => {
    // The release path goes through the same loop (`releaseReactivation` →
    // `processReactivations`), so the same check bites. Mutation: delete the
    // mailing-address check → this reds BY NAME.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: row({ mailingAddress: "  " }) });
    expect(await releaseReactivation(ctx(), heldRow())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "contact:ct_1", status: "skipped", reason: ADDRESS_REASON,
    }));
  });

  it("released from a hold, a row whose reply-to was cleared DURING the hold is skipped, not sent — and leaves the queue", async () => {
    // Mutation: delete the reply-to check → this reds BY NAME.
    dbMocks.getDueReactivationById.mockResolvedValue({ due: row({ replyToEmail: null }) });
    expect(await releaseReactivation(ctx(), heldRow())).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReactivationSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "contact:ct_1", status: "skipped", reason: REPLY_TO_REASON,
    }));
  });

  it("an account that cannot send spends NONE of the tick's ten attempts — another account's customer still goes", async () => {
    // The due-list is oldest-conversation-first ACROSS accounts, and a row
    // skipped here stays due for ever (it is never stamped). Checked AFTER
    // the caps, eleven such rows at the head of the list would burn
    // AUTOMATION_TICK_CAP every tick and starve every other account
    // indefinitely. Mutation: move the two checks below the caps → this
    // reds BY NAME.
    const stuck = Array.from({ length: 11 }, (_, n) =>
      row({ contactId: `ct_stuck_${n}`, accountId: "acct_stuck", mailingAddress: null }));
    dbMocks.listDueReactivations.mockResolvedValue([...stuck, row({ contactId: "ct_ok", accountId: "acct_ok" })]);
    expect(await reactivationPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedNoMailingAddress: 11 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReactivationSent).toHaveBeenCalledWith(expect.anything(), "ct_ok");
  });
});
