import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getAutomation: vi.fn(), hasRecentOutboundSms: vi.fn(), countInstantRepliesSince: vi.fn(),
  stampInstantReplySent: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  readQuietSettings: vi.fn(), readAccountTimezone: vi.fn(), recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));
// The factories, mocked exactly as harness.test.ts mocks them: this module
// reaches the SMS provider only through harness.ts's lazySmsProvider
// (imports.test.ts forbids anything else), so the factory is where the
// provider under test comes from.
const smsFactory = vi.hoisted(() => ({ getSmsProvider: vi.fn() }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => smsFactory.getSmsProvider() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }),
}));

import {
  AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS, INSTANT_REPLY_THREAD_HOLD_MS, INSTANT_REPLY_ALLOWED_PATTERNS,
} from "./caps";
import { sendInstantReply, releaseInstantReply, parseInstantReplyPayload, type InstantReplyInput } from "./instant-reply";
import type { AutomationLogRow } from "@bis/db";

const NOW = new Date("2026-09-10T15:00:00Z");
const smsSend = vi.fn();

function input(overrides: Partial<InstantReplyInput> = {}): InstantReplyInput {
  return {
    db: {} as never, now: NOW, accountId: "acct_1", submissionId: "sub_1", contactId: "ct_1",
    conversationId: "convo_1", phoneE164: "+19565550101", locale: "en", consentWithheld: false,
    ...overrides,
  };
}
const EN = "Hi, this is Rio Roofing. We got your message.";
const ES = "Hola, somos Rio Roofing. Recibimos tu mensaje.";
const ROW = {
  id: "au_ir", account_id: "acct_1", recipe_key: "instant_reply", enabled: true,
  body: EN, config: { bodyEs: ES },
  created_at: "2026-09-07T00:00:00Z", updated_at: "2026-09-07T00:00:00Z",
};
const errors = () => vi.mocked(console.error).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.getAutomation.mockResolvedValue(ROW);
  dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
  dbMocks.countInstantRepliesSince.mockResolvedValue(0);
  dbMocks.stampInstantReplySent.mockResolvedValue(undefined);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  smsFactory.getSmsProvider.mockReset()
    .mockReturnValue({ isFake: true, send: (...a: unknown[]) => smsSend(...a) });
  dbMocks.readQuietSettings.mockResolvedValue({ enabled: false, start: "21:00", end: "08:00" });
  dbMocks.readAccountTimezone.mockResolvedValue("America/Chicago");
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);   // Task 3: the held path reads the existing row before re-holding
  // Re-spying an already-spied method keeps the same spy and its call list;
  // cleared here so a line logged by an earlier test cannot fail a later one.
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("sendInstantReply — the free checks come before any read", () => {
  it("no parsed phone → noPhone, and nothing is read", async () => {
    // Mutation: read the automation before the phone check.
    expect(await sendInstantReply(input({ phoneE164: null }))).toEqual({ kind: "skipped", reason: "noPhone" });
    expect(dbMocks.getAutomation).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it("a withheld consent box → consentWithheld, nothing read, nothing logged", async () => {
    expect(await sendInstantReply(input({ consentWithheld: true }))).toEqual({ kind: "skipped", reason: "consentWithheld" });
    expect(dbMocks.getAutomation).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });
});

describe("sendInstantReply — the destination allowlist (danlo, 2026-09-07: +1 and +52 only, as real shapes)", () => {
  it("pins the allowlist: ten digits after +1; ten after +52, or the legacy mobile 1 and ten; nothing else", () => {
    expect(INSTANT_REPLY_ALLOWED_PATTERNS.map(String)).toEqual(["/^\\+1\\d{10}$/", "/^\\+521?\\d{10}$/"]);
  });

  it("a number outside the allowlist, or a NANP-impossible +1, → outsideRegion before any read, logged without the number", async () => {
    // Mutation: a bare prefix match — "+12345678" (what toE164 makes of a
    // typed "12345678", which the form's own validation accepts) then reaches
    // the provider on every junk submission, unbilled but unbounded by the
    // hold (failed rows excluded) and the cap (only successes stamped).
    // "+5258181234567": eleven digits after +52 whose eleventh is not the
    // legacy mobile 1 — the shape the comment on the constant promises to refuse.
    const outside = ["+447700900123", "+5511987654321", "+9725012345678", "+12345678", "+1956555010", "+521234", "+5258181234567"];
    for (const to of outside) {
      dbMocks.getAutomation.mockClear();
      expect(await sendInstantReply(input({ phoneE164: to })), to).toEqual({ kind: "skipped", reason: "outsideRegion", detail: to });
      expect(dbMocks.getAutomation).not.toHaveBeenCalled();
    }
    expect(smsSend).not.toHaveBeenCalled();
    const lines = errors().filter((l) => l.includes("outside the allowed regions"));
    expect(lines).toHaveLength(outside.length);
    for (const l of lines) expect(l).not.toMatch(/\+\d{4,}/);   // the prefix, never the number
  });

  it("a US number, a Mexican number, and a Mexican number typed with the legacy mobile 1 all proceed to the send", async () => {
    for (const to of ["+19565550101", "+528181234567", "+5218181234567"]) {
      expect(await sendInstantReply(input({ phoneE164: to })), to).toEqual({ kind: "sent", unstamped: false });
    }
    expect(smsSend).toHaveBeenCalledTimes(3);
    expect(smsSend.mock.calls[1]![0]).toMatchObject({ to: "+528181234567" });
  });
});

describe("sendInstantReply — the recipe row", () => {
  it("no row, an OFF row, an unparseable config, or a blank body for the locale → disabled; the gate is never consulted", async () => {
    // Mutation: send when the config parser returns null.
    for (const row of [null, { ...ROW, enabled: false }, { ...ROW, config: {} }, { ...ROW, body: "   " }]) {
      dbMocks.getAutomation.mockResolvedValue(row);
      const outcome = await sendInstantReply(input());
      expect(outcome.kind, JSON.stringify(row)).toBe("skipped");
      expect((outcome as { reason: string }).reason, JSON.stringify(row)).toBe("disabled");
    }
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);   // disabled is normal; it would log once per submission otherwise
  });

  it("reads exactly this account's instant_reply row, once", async () => {
    await sendInstantReply(input());
    expect(dbMocks.getAutomation).toHaveBeenCalledTimes(1);
    expect(dbMocks.getAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "instant_reply");
  });
});

describe("sendInstantReply — the gates", () => {
  it("an account that cannot text → smsGate with the gate's reason, logged; the thread is never read", async () => {
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "smsGate", detail: "a2p_not_approved" });
    expect(dbMocks.hasRecentOutboundSms).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("cannot text (a2p_not_approved)");
  });

  it("a non-failed outbound text in the thread inside the hold → recentText, silent; the hold is measured from `now`", async () => {
    // Mutation: pass `now` instead of now − hold, or read a different thread.
    dbMocks.hasRecentOutboundSms.mockResolvedValue(true);
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "recentText" });
    expect(dbMocks.hasRecentOutboundSms).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "convo_1", new Date(NOW.getTime() - INSTANT_REPLY_THREAD_HOLD_MS));
    expect(dbMocks.countInstantRepliesSince).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors()).toEqual([]);
  });

  it("the daily cap: the 25th stamp inside 24h blocks the 26th text, logged; 24 lets it through", async () => {
    // Mutation: `>` instead of `>=`.
    dbMocks.countInstantRepliesSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "dailyCap" });
    expect(dbMocks.countInstantRepliesSince).toHaveBeenCalledWith(
      expect.anything(), "acct_1", new Date(NOW.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
    expect(smsSend).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("daily cap");

    dbMocks.countInstantRepliesSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    expect((await sendInstantReply(input())).kind).toBe("sent");
  });
});

describe("sendInstantReply — the send", () => {
  it("English: provider → conversation → message row → send → STAMP → mark sent, the saved body VERBATIM", async () => {
    // Mutation: stamp before the send, or compose a lead around the body.
    expect(await sendInstantReply(input())).toEqual({ kind: "sent", unstamped: false });
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    // VERBATIM still means verbatim — nothing is composed AROUND the saved
    // body. The one addition is the opt-out disclosure sendAutomationSms
    // appends to every programme text, stored and sent as the same string.
    const enSent = `${EN} Reply STOP to opt out.`;
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: enSent }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: enSent });
    expect(dbMocks.stampInstantReplySent).toHaveBeenCalledWith(expect.anything(), "sub_1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(order(smsFactory.getSmsProvider)).toBeLessThan(order(dbMocks.createMessage));
    expect(order(dbMocks.createMessage)).toBeLessThan(order(smsSend));
    expect(order(smsSend)).toBeLessThan(order(dbMocks.stampInstantReplySent));
    expect(order(dbMocks.stampInstantReplySent)).toBeLessThan(order(dbMocks.updateMessageStatus));
    expect(errors()).toEqual([]);
  });

  it("Spanish: the locale picks config.bodyEs, trimmed, and nothing else changes", async () => {
    // Mutation: send `row.body` for every locale.
    dbMocks.getAutomation.mockResolvedValue({ ...ROW, config: { bodyEs: `  ${ES}  ` } });
    expect(await sendInstantReply(input({ locale: "es" }))).toEqual({ kind: "sent", unstamped: false });
    // The locale picks the body AND the disclosure's language — this is the
    // one pass that has a locale to offer, and a Spanish reply signed off
    // with "Reply STOP to opt out." would undo the point of having a bodyEs.
    expect(smsSend).toHaveBeenCalledWith({
      to: "+19565550101", from: "+19565550000", body: `${ES} Responde STOP para cancelar.`,
    });
  });

  it("a provider failure: the row is marked failed, NOTHING is stamped, the outcome is `failed` with the message, and it does not throw", async () => {
    smsSend.mockRejectedValue(new Error("carrier 503"));
    expect(await sendInstantReply(input())).toEqual({ kind: "failed", error: "carrier 503" });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier 503" }, "automation", "system");
    expect(dbMocks.stampInstantReplySent).not.toHaveBeenCalled();
    expect(errors().join("\n")).toContain("carrier 503");
  });

  it("a throwing factory (TELNYX_API_KEY unset) is a `failed` outcome with NOTHING written to the inbox", async () => {
    smsFactory.getSmsProvider.mockImplementation(() => { throw new Error("TELNYX_API_KEY unset"); });
    expect(await sendInstantReply(input())).toEqual({ kind: "failed", error: "TELNYX_API_KEY unset" });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a stamp that fails AFTER a successful send: sent + unstamped, logged, the row still marked sent", async () => {
    // Mutation: rethrow the stamp error.
    dbMocks.stampInstantReplySent.mockRejectedValue(new Error("pgrst 503"));
    expect(await sendInstantReply(input())).toEqual({ kind: "sent", unstamped: true });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(errors().join("\n")).toContain("not stamped");
  });
});

describe("instant reply — quiet hours", () => {
  const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT
  const ON = { enabled: true, start: "21:00", end: "08:00" };
  const END = "2026-09-22T13:00:00.000Z";

  it("a form submitted at 23:00: held, not texted, not stamped; the held row carries what a release needs (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.readQuietSettings.mockResolvedValue(ON);
    expect(await sendInstantReply(input({ now: NIGHT, locale: "es", consentWithheld: false }))).toEqual({ kind: "held" });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampInstantReplySent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "instant_reply", channel: "sms", subjectKey: "submission:sub_1", contactId: "ct_1",
      payload: { contactId: "ct_1", conversationId: "convo_1", phoneE164: "+19565550101", locale: "es", consentWithheld: false },
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    });
  });

  it("the window is read for the SUBMISSION's account, in that account's zone, not the sender's default (mutation: hardcode either → FAILS)", async () => {
    // Same instant NIGHT holds under Chicago (23:00, inside 21:00–08:00): here
    // it must NOT hold, because Tokyo reads it as 13:00 the next day — well
    // outside the window. A test that also sends "sent" under Chicago could
    // not tell a real zone read from a hardcoded one; this one can.
    dbMocks.readQuietSettings.mockResolvedValue(ON);
    dbMocks.readAccountTimezone.mockResolvedValue("Asia/Tokyo");   // NIGHT (23:00 Chicago) is 13:00 JST Sept 22
    expect((await sendInstantReply(input({ now: NIGHT }))).kind).toBe("sent");
    expect(dbMocks.readQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.readAccountTimezone).toHaveBeenCalledWith(expect.anything(), "acct_1");
  });

  it("nothing is read for a submission the free checks refuse, and nothing is logged for an account without the recipe (mutation: log `disabled` → FAILS)", async () => {
    dbMocks.getAutomation.mockResolvedValue({ ...ROW, enabled: false });
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "disabled" });
    expect(dbMocks.readQuietSettings).not.toHaveBeenCalled();
    expect(dbMocks.readAccountTimezone).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("with the recipe ON, the gate / the 24h hold / the daily cap each write a skipped row a client can read", async () => {
    senderMock.resolveSmsSender.mockResolvedValueOnce({ ok: false, reason: "a2p_not_approved" });
    await sendInstantReply(input());
    dbMocks.hasRecentOutboundSms.mockResolvedValueOnce(true);
    await sendInstantReply(input({ submissionId: "sub_2" }));
    dbMocks.countInstantRepliesSince.mockResolvedValueOnce(AUTOMATION_DAILY_CAP);
    await sendInstantReply(input({ submissionId: "sub_3" }));
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].status, c[1].reason])).toEqual([
      ["submission:sub_1", "skipped", "Texting isn't set up for this company yet"],
      ["submission:sub_2", "skipped", "A text already went to this person today"],
      ["submission:sub_3", "skipped", "Daily limit reached"],
    ]);
  });
});

describe("releaseInstantReply — from the held row's payload", () => {
  const heldRow = (payload: Record<string, unknown>): AutomationLogRow => ({
    id: "log_i", account_id: "acct_1", source: "instant_reply", channel: "sms", contact_id: "ct_1",
    subject_key: "submission:sub_1", status: "held", reason: "x", held_until: "2026-09-22T13:00:00.000Z", payload, occurred_at: "2026-09-22T04:00:00.000Z",
  });
  const PAYLOAD = { contactId: "ct_1", conversationId: "convo_1", phoneE164: "+19565550101", locale: "en", consentWithheld: false };
  const ctx = { db: {} as never, now: new Date("2026-09-22T13:00:00Z"), origin: "", email: { isFake: true, send: async () => ({ providerMessageId: "e" }) }, sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }), quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }) };

  it("re-runs every check and sends: the text goes, the submission is stamped, the row flips to sent (mutation: skip the stamp on release → FAILS)", async () => {
    expect(await releaseInstantReply(ctx, heldRow(PAYLOAD))).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect((smsSend.mock.calls[0]![0] as { body: string }).body).toContain(EN);
    expect(dbMocks.stampInstantReplySent).toHaveBeenCalledWith(expect.anything(), "sub_1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent", subjectKey: "submission:sub_1" }));
  });

  it("a payload that cannot be parsed is skipped as 'No longer due', never texted", async () => {
    expect(await releaseInstantReply(ctx, heldRow({ phoneE164: 5 }))).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "No longer due" }));
  });

  it("a skip at release (the recipe was turned off meanwhile) writes a reason only the release path can produce (mutation: delete the releaser's logSkipped branch → FAILS)", async () => {
    // Not `recentText`: the inline path writes that identical string on its
    // OWN skip, so a test built on it stays green even with the releaser's
    // logSkipped branch deleted. `recipeOff` is unreachable from the inline
    // send (it returns before `logSubject` exists), so this string can only
    // have come from releaseInstantReply's own skip-logging.
    dbMocks.getAutomation.mockResolvedValue({ ...ROW, enabled: false });
    expect(await releaseInstantReply(ctx, heldRow(PAYLOAD))).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });

  it("a row keyed for something other than a submission is skipped as 'No longer due', never texted", async () => {
    const row: AutomationLogRow = { ...heldRow(PAYLOAD), subject_key: "booking:x" };
    expect(await releaseInstantReply(ctx, row)).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "No longer due" }));
  });

  it("parseInstantReplyPayload accepts exactly the shape the hold wrote", () => {
    expect(parseInstantReplyPayload(PAYLOAD)).toEqual(PAYLOAD);
    expect(parseInstantReplyPayload({ ...PAYLOAD, locale: "fr" })).toBeNull();
    expect(parseInstantReplyPayload({ ...PAYLOAD, consentWithheld: "no" })).toBeNull();
    expect(parseInstantReplyPayload(null)).toBeNull();
  });
});
