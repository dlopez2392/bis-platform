import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  updateMessageStatus: vi.fn(), recordUsage: vi.fn(), createContact: vi.fn(), fillContactBlanks: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), hasRecentOutboundSms: vi.fn(),
  recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(), getVoiceProfile: vi.fn(), getBranding: vi.fn(),
  // The send gate's reads: the text-back goes through the REAL gate.
  readConsentState: vi.fn(), readPhoneCountryFlag: vi.fn(), readAccountTimezone: vi.fn(),
  // The release's "has this caller been in touch since?" read (danlo, 2026-09-26).
  callerInTouchSince: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMocks = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => senderMocks);
const sms = vi.hoisted(() => ({
  isFake: false as boolean, redirectTo: undefined as string | undefined, send: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  getSmsProvider: () => ({ isFake: sms.isFake, redirectTo: sms.redirectTo, send: (...a: unknown[]) => sms.send(...a) }),
}));

import type { serviceDb, AutomationLogRow } from "@bis/db";
import { segmentsFor } from "@/lib/sms/segments";
import { m } from "@/lib/messages";
import type { PassContext } from "@/lib/automations/context";
import { fakeSmsGate } from "@/lib/consent/fake-gate";
import { prepareTextback, deliverTextback, releaseTextback, type TextbackRequest } from "./textback";

/**
 * The missed-call text-back through the send gate (consent chain PR-1).
 * One module, three callers (finishCall, the handoff-result route, the
 * release pass), so the gate's answers are proven here once.
 */
const DB = { tag: "service-db" } as unknown as ReturnType<typeof serviceDb>;
const NOON = new Date("2026-10-06T17:00:00Z");     // 12:00 CDT, Tue
const TEN_PM = new Date("2026-10-07T03:00:00Z");   // 22:00 CDT, Tue
const EIGHT_AM = "2026-10-07T13:00:00.000Z";       // 08:00 CDT, Wed
const LONG = "Sorry we missed you. ".repeat(9).trim();
const STOP_EN = m["sms.optOut.en"];

const request = (over: Partial<TextbackRequest> = {}): TextbackRequest => ({
  callerNumber: "+19562921696", contactId: "ct_1", language: "en", brandName: "Rio Roofing",
  textbackBody: "", label: "finishCall call1", callId: "call1", now: NOON, ...over,
});
const logWrites = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  senderMocks.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550100", ownedNumbers: ["+19565550100"] });
  dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "m_tb" });
  dbMocks.hasRecentOutboundSms.mockResolvedValue(false);
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  dbMocks.recordUsage.mockResolvedValue("recorded");
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.readConsentState.mockResolvedValue({ state: "allowed" });
  dbMocks.readPhoneCountryFlag.mockResolvedValue(false);
  dbMocks.readAccountTimezone.mockResolvedValue("America/Chicago");
  dbMocks.callerInTouchSince.mockResolvedValue(false);
  sms.isFake = false;
  sms.redirectTo = undefined;
  sms.send.mockReset().mockResolvedValue({ providerMessageId: "sm1" });
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

async function prepared(over: Partial<TextbackRequest> = {}) {
  const outcome = await prepareTextback(DB, "a1", request(over));
  if (!outcome.pending) throw new Error(`expected a pending text-back, got ${outcome.notSent}`);
  return outcome.pending;
}

describe("prepareTextback: the send gate decides before any row", () => {
  it("inside the hours: one message row with the text AS SENT (the gate's STOP line) and a pending send to the caller (mutation: store the body without the footer → FAILS)", async () => {
    const pending = await prepared();
    expect(dbMocks.createMessage).toHaveBeenCalledWith(DB, "a1",
      expect.objectContaining({ conversationId: "cv1", channel: "sms", direction: "outbound", body: expect.stringContaining(STOP_EN) }), "voice", "ai");
    expect(pending.cleared.body).toBe((dbMocks.createMessage.mock.calls[0]![2] as { body: string }).body);
    expect(pending.cleared.to).toBe("+19562921696");
    expect(pending.cleared.kind).toBe("voice.textback");
  });

  it("a call missed at 22:00 is HELD until 08:00 on the automation log — source textback, subject call:<id>, with what a release needs — and nothing else is written (mutation: send at night → FAILS)", async () => {
    const outcome = await prepareTextback(DB, "a1", request({ now: TEN_PM, language: "es" }));
    expect(outcome).toEqual({ contactId: "ct_1", conversationId: "cv1", pending: null, notSent: "held" });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([{
      accountId: "a1", source: "textback", channel: "sms", subjectKey: "call:call1", contactId: "ct_1",
      payload: { callerNumber: "+19562921696", contactId: "ct_1", conversationId: "cv1", language: "es", missedAt: TEN_PM.toISOString() },
      status: "held", heldUntil: EIGHT_AM, reason: "Held until 8:00 AM — quiet hours",
    }]);
  });

  it("a call with no row cannot be held: at 22:00 nothing is written and the console says so (mutation: hold under a made-up key → FAILS)", async () => {
    const outcome = await prepareTextback(DB, "a1", request({ now: TEN_PM, callId: null }));
    expect(outcome.notSent).toBe("unheld");
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toMatch(/cannot be held/);
  });

  it("a number that stopped texts gets nothing: no message row, one skipped row with the reason (mutation: skip the gate → a row is written, FAILS)", async () => {
    dbMocks.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "carrier_block", eventId: "e1" });
    const outcome = await prepareTextback(DB, "a1", request());
    expect(outcome.notSent).toBe("blocked");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      source: "textback", subjectKey: "call:call1", status: "skipped", reason: "They stopped texts from this business",
    })]);
  });

  it("an unreadable ledger is a 15-minute re-hold, never a failed row that drops the text-back (review R2-I4; mutation: log it failed again → FAILS)", async () => {
    dbMocks.readConsentState.mockRejectedValue(new Error("permission denied for table consent_events"));
    const outcome = await prepareTextback(DB, "a1", request());
    expect(outcome).toMatchObject({ contactId: "ct_1", conversationId: "cv1", notSent: "held" });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      source: "textback", subjectKey: "call:call1", status: "held",
      heldUntil: new Date(NOON.getTime() + 15 * 60_000).toISOString(),
      reason: "Waiting a few minutes: couldn't check whether they can get texts",
    })]);
  });

  it("the caller ID is texted even when the contact's STORED number is flagged: the carrier's number says its own country (review R2 minor; mutation: drop numberFromCarrier → blocked, FAILS)", async () => {
    dbMocks.readPhoneCountryFlag.mockResolvedValue(true);
    const outcome = await prepareTextback(DB, "a1", request());
    expect(outcome.pending).not.toBeNull();
    expect(dbMocks.readPhoneCountryFlag).not.toHaveBeenCalled();
  });

  it("a hold write that fails keeps the call's contact and conversation, and says the text-back is lost (review R2 minor; mutation: let the throw escape → rejects, FAILS)", async () => {
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("db down"));
    const outcome = await prepareTextback(DB, "a1", request({ now: TEN_PM }));
    expect(outcome).toEqual({ contactId: "ct_1", conversationId: "cv1", pending: null, notSent: "unheld" });
  });

  it("an account not cleared to text writes NOTHING, not even a contact (mutation: resolve the contact first → FAILS)", async () => {
    senderMocks.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    const resolveContact = vi.fn(async () => "ct_9");
    const outcome = await prepareTextback(DB, "a1", request({ contactId: null, resolveContact }));
    expect(outcome.notSent).toBe("sender_refused");
    expect(resolveContact).not.toHaveBeenCalled();
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
  });
});

describe("deliverTextback — the send, and usage (client billing)", () => {
  it("a delivered text-back records the segments of the text AS SENT, on the same service client, and a sent log row (mutation: bill 1 per text → FAILS)", async () => {
    const pending = await prepared({ textbackBody: LONG });
    expect(segmentsFor(pending.cleared.body).segments).toBe(2);
    expect(await deliverTextback(DB, "a1", pending, "finishCall call1")).toBe("sent");
    expect(dbMocks.recordUsage).toHaveBeenCalledWith(DB, {
      accountId: "a1", meter: "sms", quantity: 2, occurredAt: expect.any(Date), sourceRef: "message:m_tb",
    });
    expect(logWrites()).toEqual([expect.objectContaining({ source: "textback", status: "sent", subjectKey: "call:call1" })]);
  });

  it("a fake provider, or a real one redirected to a developer's phone, records nothing (mutation: bill every send → FAILS)", async () => {
    sms.isFake = true;
    await deliverTextback(DB, "a1", await prepared(), "finishCall call1");
    sms.isFake = false;
    sms.redirectTo = "+19565550199";
    await deliverTextback(DB, "a1", await prepared(), "finishCall call1");
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
  });

  it("a text the carrier refused records nothing, marks the row failed, and logs 'text-back failed' (mutation: record before the send → FAILS)", async () => {
    sms.send.mockRejectedValue(new Error("carrier rejected"));
    expect(await deliverTextback(DB, "a1", await prepared(), "finishCall call1")).toBe("failed");
    expect(dbMocks.recordUsage).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "failed", { error: "carrier rejected" }, "voice", "ai");
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("text-back failed"));
  });

  it("the 'sent' write comes straight after the send, BEFORE the usage write (mutation: record usage first → call order FAILS)", async () => {
    await deliverTextback(DB, "a1", await prepared(), "finishCall call1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "sent", { providerMessageId: "sm1" }, "voice", "ai");
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.recordUsage.mock.invocationCallOrder[0]!);
  });

  it("the usage row lands even when the 'sent' write then fails, and nothing throws (mutation: record after that write outside its finally → FAILS)", async () => {
    const pending = await prepared();
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("db down"));
    await expect(deliverTextback(DB, "a1", pending, "finishCall call1")).resolves.toBe("failed");
    expect(dbMocks.recordUsage).toHaveBeenCalledTimes(1);
  });

  it("an unreadable ledger AT DELIVERY re-holds for 15 minutes: the message row marked failed, never a failed log row that drops it (re-review A; mutation: recordBlocked's failed row again → FAILS)", async () => {
    const pending = await prepared();
    dbMocks.readConsentState.mockRejectedValue(new Error("permission denied for table consent_events"));
    expect(await deliverTextback(DB, "a1", pending, "finishCall call1")).toBe("held");
    expect(sms.send).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "failed", { error: "not sent: ledger_unavailable" }, "voice", "ai");
    expect(logWrites()).toEqual([expect.objectContaining({
      source: "textback", subjectKey: "call:call1", status: "held",
      heldUntil: new Date(NOON.getTime() + 15 * 60_000).toISOString(),
      reason: "Waiting a few minutes: couldn't check whether they can get texts",
    })]);
  });

  it("an unreadable ledger at delivery for a call with no row cannot be held: failed, nothing written (mutation: answer held for a call with no row → FAILS)", async () => {
    const pending = await prepared({ callId: null });
    dbMocks.readConsentState.mockRejectedValue(new Error("fetch failed"));
    expect(await deliverTextback(DB, "a1", pending, "finishCall (no row)")).toBe("failed");
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("a stop that lands between prepare and deliver wins: nothing sent, the row marked failed with the reason (mutation: deliver without the gate's re-check → sent, FAILS)", async () => {
    const pending = await prepared();
    dbMocks.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-06T17:00:01Z", method: "carrier_block", eventId: "e2" });
    expect(await deliverTextback(DB, "a1", pending, "finishCall call1")).toBe("skipped");
    expect(sms.send).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(DB, "a1", "m_tb", "failed", { error: "not sent: stopped" }, "voice", "ai");
  });
});

describe("releaseTextback — the 08:00 send of a call missed overnight", () => {
  const PAYLOAD = { callerNumber: "+19562921696", contactId: "ct_1", conversationId: "cv1", language: "en" };
  const held = (over: Partial<AutomationLogRow> = {}): AutomationLogRow => ({
    id: "log_tb", account_id: "a1", source: "textback", channel: "sms", contact_id: "ct_1",
    subject_key: "call:call1", status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: EIGHT_AM,
    payload: PAYLOAD, occurred_at: TEN_PM.toISOString(), ...over,
  });
  const ctx = (now: Date): PassContext => ({
    db: DB as never, now, origin: "", email: { isFake: true, send: vi.fn() }, sms: fakeSmsGate(),
  });

  beforeEach(() => {
    dbMocks.getVoiceProfile.mockResolvedValue({ textback_enabled: true, textback_body: "" });
    dbMocks.getBranding.mockResolvedValue({ brandName: "Rio Roofing" });
  });

  it("at 08:00 it re-runs prepare and sends through the same path: message row, send, sent row (mutation: release without delivering → FAILS)", async () => {
    expect(await releaseTextback(ctx(new Date(EIGHT_AM)), held())).toBe("sent");
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send.mock.calls[0]![0]).toMatchObject({ to: "+19562921696" });
    expect(logWrites().at(-1)).toMatchObject({ source: "textback", subjectKey: "call:call1", status: "sent" });
  });

  it("the text-back switched off overnight: skipped 'This automation was turned off', never sent (mutation: skip the profile re-read → FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ textback_enabled: false, textback_body: "" });
    expect(await releaseTextback(ctx(new Date(EIGHT_AM)), held())).toBe("skipped");
    expect(sms.send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: "This automation was turned off" })]);
  });

  it("a text that already went to them overnight: skipped with the cooldown's reason, never a second text (mutation: drop the release's cooldown branch → the row stays held forever, FAILS)", async () => {
    dbMocks.hasRecentOutboundSms.mockResolvedValue(true);
    expect(await releaseTextback(ctx(new Date(EIGHT_AM)), held())).toBe("skipped");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: "A text already went to this person today" })]);
  });

  it("a subject or payload it cannot read leaves the queue as 'No longer due' (mutation: re-run with a guessed id → FAILS)", async () => {
    expect(await releaseTextback(ctx(new Date(EIGHT_AM)), held({ subject_key: "booking:x" }))).toBe("skipped");
    expect(await releaseTextback(ctx(new Date(EIGHT_AM)), held({ payload: { callerNumber: 5 } }))).toBe("skipped");
    expect(logWrites().map((w) => w.reason)).toEqual(["No longer due", "No longer due"]);
    expect(sms.send).not.toHaveBeenCalled();
  });
});

/**
 * danlo, 2026-09-26: a text-back held overnight is skipped at release when
 * the caller has called or texted since the missed call, and the default it
 * sends at 08:00 no longer says "just now".
 */
describe("releaseTextback — the caller may have been served since", () => {
  const PAYLOAD = { callerNumber: "+19562921696", contactId: "ct_1", conversationId: "cv1", language: "en", missedAt: TEN_PM.toISOString() };
  const held = (): AutomationLogRow => ({
    id: "log_tb", account_id: "a1", source: "textback", channel: "sms", contact_id: "ct_1",
    subject_key: "call:call1", status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: EIGHT_AM,
    payload: PAYLOAD, occurred_at: TEN_PM.toISOString(),
  });
  const ctx = (): PassContext => ({
    db: DB as never, now: new Date(EIGHT_AM), origin: "", email: { isFake: true, send: vi.fn() }, sms: fakeSmsGate(),
  });
  beforeEach(() => {
    dbMocks.getVoiceProfile.mockResolvedValue({ textback_enabled: true, textback_body: "" });
    dbMocks.getBranding.mockResolvedValue({ brandName: "Rio Roofing" });
  });

  it("a caller who called or texted since the missed call is not texted: skipped \"They've been in touch since\" (mutation: drop the in-touch check → sent, FAILS)", async () => {
    dbMocks.callerInTouchSince.mockResolvedValue(true);
    expect(await releaseTextback(ctx(), held())).toBe("skipped");
    expect(sms.send).not.toHaveBeenCalled();
    expect(dbMocks.callerInTouchSince).toHaveBeenCalledWith(DB, "a1", "+19562921696", "cv1", TEN_PM.toISOString());
    expect(logWrites().at(-1)).toMatchObject({ status: "skipped", reason: "They've been in touch since" });
  });

  it("the default sent at 08:00 does not say \"just now\" (mutation: prepare without held → \"just now\", FAILS)", async () => {
    expect(await releaseTextback(ctx(), held())).toBe("sent");
    const body = String(sms.send.mock.calls[0]![0].body);
    expect(body).toContain("Sorry we missed your call");
    expect(body).not.toContain("just now");
  });

  it("the in-touch read failing re-holds for 15 minutes rather than guessing either way (mutation: treat a read error as not in touch → sent, FAILS)", async () => {
    dbMocks.callerInTouchSince.mockRejectedValue(new Error("fetch failed"));
    expect(await releaseTextback(ctx(), held())).toBe("held");
    expect(sms.send).not.toHaveBeenCalled();
    expect(logWrites().at(-1)).toMatchObject({ status: "held", reason: "Waiting a few minutes: couldn't check whether they can get texts" });
  });
});

/**
 * The re-hold age cap (orchestrator, 2026-09-26): every held text-back ends
 * in a release, and a release more than 24 h after the call is skipped, so
 * an outage never sends "Sorry we missed your call" days later.
 */
describe("releaseTextback — the re-hold age cap", () => {
  const PAYLOAD = { callerNumber: "+19562921696", contactId: "ct_1", conversationId: "cv1", language: "en", missedAt: TEN_PM.toISOString() };
  const held = (payload: Record<string, unknown> = PAYLOAD): AutomationLogRow => ({
    id: "log_tb", account_id: "a1", source: "textback", channel: "sms", contact_id: "ct_1",
    subject_key: "call:call1", status: "held", reason: "Waiting a few minutes: couldn't check whether they can get texts",
    held_until: EIGHT_AM, payload, occurred_at: new Date(TEN_PM.getTime() + 23 * 3600_000).toISOString(),
  });
  const ctx = (now: Date): PassContext => ({
    db: DB as never, now, origin: "", email: { isFake: true, send: vi.fn() }, sms: fakeSmsGate(),
  });
  beforeEach(() => {
    dbMocks.getVoiceProfile.mockResolvedValue({ textback_enabled: true, textback_body: "" });
    dbMocks.getBranding.mockResolvedValue({ brandName: "Rio Roofing" });
  });

  it("released more than 24 h after the call: skipped 'Not sent: too long after the call', nothing sent, nothing read (mutation: drop the cap → sent, FAILS)", async () => {
    expect(await releaseTextback(ctx(new Date(TEN_PM.getTime() + 24 * 3600_000 + 1)), held())).toBe("skipped");
    expect(sms.send).not.toHaveBeenCalled();
    expect(dbMocks.callerInTouchSince).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: "Not sent: too long after the call" })]);
  });

  it("judged from the call's end, never the release's tick: a delivery re-hold keeps missedAt (mutation: payload missedAt = the release's now → FAILS)", async () => {
    // 11:00 CDT the next day, 13 h after the call: the gate cannot read the ledger at delivery.
    const late = new Date(TEN_PM.getTime() + 13 * 3600_000);
    dbMocks.readConsentState.mockResolvedValueOnce({ state: "allowed" }).mockRejectedValueOnce(new Error("fetch failed"));
    expect(await releaseTextback(ctx(late), held())).toBe("held");
    expect(logWrites().at(-1)).toMatchObject({
      status: "held", heldUntil: new Date(late.getTime() + 15 * 60_000).toISOString(),
      payload: expect.objectContaining({ missedAt: TEN_PM.toISOString() }),
    });
  });
});
