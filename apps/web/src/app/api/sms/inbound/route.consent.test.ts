import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";

/**
 * The inbound route's consent step with GENUINELY SIGNED fixtures (spec §8):
 * a real Ed25519 key pair made for this file, its public half as
 * TELNYX_PUBLIC_KEY, every request signed over `${timestamp}|${body}` exactly
 * as Telnyx signs. The database is mocked; the consent step (inbound.ts) is
 * the real one; the reply sender is a spy, and `after` hands its work to the
 * test so a reply that was never scheduled cannot pass as sent.
 */
const db = vi.hoisted(() => ({
  serviceDb: vi.fn(), getPhoneNumberByE164: vi.fn(), getAlertPhone: vi.fn(), findMessageByProviderId: vi.fn(),
  createContact: vi.fn(), ensureConversation: vi.fn(), createMessage: vi.fn(), incrementUnreadCount: vi.fn(),
  applyConfirmationReply: vi.fn(), updateMessageStatusByProviderId: vi.fn(),
  appendConsentEventGuarded: vi.fn(), ensureConsentTask: vi.fn(), nextBookedStart: vi.fn(),
  readAccountTimezone: vi.fn(), getContact: vi.fn(), completeTasksForConsentEvents: vi.fn(), readConsentHistory: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const sendReply = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/replies", () => ({ sendConsentReply: sendReply }));
const deferred = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (work: () => Promise<void>) => { deferred.push(work); } };
});

import { POST } from "./route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const RAW_PUBLIC_KEY = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
const OUR_NUMBER = "+19565550000";
const CUSTOMER = "+19562921696";

function signed(payload: object, key = privateKey): Request {
  const raw = JSON.stringify({ data: { event_type: "message.received", payload } });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = sign(null, Buffer.from(`${ts}|${raw}`, "utf8"), key).toString("base64");
  return new Request("https://x.test/api/sms/inbound", {
    method: "POST", headers: { "telnyx-timestamp": ts, "telnyx-signature-ed25519": sig }, body: raw,
  });
}
let seq = 0;
const text = (body: string, over: Record<string, unknown> = {}) => signed({
  id: `msg_${++seq}`, to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: body,
  messaging_profile_id: "prof_1", ...over,
});
const writes = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].action, c[1].method, c[2]]);

beforeEach(() => {
  for (const fn of [...Object.values(db), sendReply]) fn.mockReset();
  deferred.length = 0;
  process.env.TELNYX_PUBLIC_KEY = RAW_PUBLIC_KEY;
  db.serviceDb.mockReturnValue({});
  db.getPhoneNumberByE164.mockResolvedValue({ id: "pn_1", account_id: "acct_1", e164: OUR_NUMBER, telnyx_id: null, status: "live" });
  db.getAlertPhone.mockResolvedValue(null);
  db.findMessageByProviderId.mockResolvedValue(null);
  db.createContact.mockResolvedValue({ id: "ct_1", existing: true, flagged: false });
  db.ensureConversation.mockResolvedValue({ id: "conv_1", created: false });
  db.createMessage.mockResolvedValue({ id: "in_1" });
  db.applyConfirmationReply.mockResolvedValue(null);
  db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
    e.action === "granted" ? { outcome: "refused", prior: null } : { outcome: "appended", id: `ev_${e.action}`, prior: null });
  db.ensureConsentTask.mockResolvedValue({ id: "task_1", created: true });
  db.nextBookedStart.mockResolvedValue(null);
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  db.getContact.mockResolvedValue({ id: "ct_1", first_name: "Ana", last_name: null });
  db.completeTasksForConsentEvents.mockResolvedValue([]);
  db.readConsentHistory.mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function runDeferred(): Promise<void> {
  for (const work of deferred.splice(0)) await work();
}

describe("signed fixtures", () => {
  it("a body signed with another key is refused 401 and nothing is written (the positive control that signatures are real; mutation: accept any signature → FAILS)", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const res = await POST(signed({ id: "x", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "STOP" }, other));
    expect(res.status).toBe(401);
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("STOP: one confirmation, never two, none missing (spec §8)", () => {
  it("Telnyx answered (autoresponse_type STOP): the stop is recorded, sourced to the message, and no BIS reply is scheduled (mutation: schedule anyway → FAILS)", async () => {
    const res = await POST(text("STOP", { autoresponse_type: "STOP" }));
    expect(res.status).toBe(200);
    expect(writes()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(db.appendConsentEventGuarded.mock.calls.find((c) => c[1].action === "revoked")![1])
      .toMatchObject({ sourceRef: `msg_${seq}`, contactId: "ct_1", evidence: { autoresponse_type: "STOP", messaging_profile_id: "prof_1" } });
    expect(deferred).toHaveLength(0);
  });

  it("Telnyx did not answer: exactly one reply is scheduled after the response, answering the new stop (mutation: send inline → sendReply runs before POST returns, FAILS)", async () => {
    const res = await POST(text("Parar"));
    expect(res.status).toBe(200);
    expect(sendReply).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    await runDeferred();
    expect(sendReply).toHaveBeenCalledWith({}, {
      accountId: "acct_1", to: CUSTOMER, contactId: "ct_1", conversationId: "conv_1",
      reply: { kind: "consent.stop_confirmation", language: "es", answersEventId: "ev_revoked" },
    });
  });

  it("Telnyx's retry of the same STOP files nothing twice and schedules nothing (plan G1; mutation: the retry returns before the consent step again → the 503's retry never writes, see the next case)", async () => {
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_first" } : { outcome: "refused", prior: null });
    const res = await POST(text("STOP"));
    expect(res.status).toBe(200);
    expect(db.createMessage).not.toHaveBeenCalled();
    expect(db.incrementUnreadCount).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });

  it("a ledger write that fails answers 503; Telnyx's retry, finding the text filed, writes the stop and replies once (spec §5, S1; mutation: return before the consent step on a retry → the retry writes nothing, FAILS)", async () => {
    db.appendConsentEventGuarded.mockImplementationOnce(async () => ({ outcome: "refused", prior: null }))   // the grant
      .mockImplementationOnce(async () => { throw new Error("append_consent_event failed: timeout"); });
    const payload = { id: "msg_retry", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "STOP" };
    const first = await POST(signed(payload));
    expect(first.status).toBe(503);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    const second = await POST(signed(payload));
    expect(second.status).toBe(200);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(writes().filter(([a]) => a === "revoked")).toHaveLength(2);
    expect(deferred).toHaveLength(1);
  });

  it("a CANCEL whose To-do fails answers 503 having ALREADY scheduled its one confirmation; Telnyx's retry makes the To-do and schedules none — never zero replies, never two (review R2-I1a; mutation: owe the reply after the To-do → the first attempt schedules nothing, FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    db.ensureConsentTask.mockRejectedValueOnce(new Error("tasks insert failed"));
    const payload = { id: "msg_cancel", to: [{ phone_number: OUR_NUMBER }], from: { phone_number: CUSTOMER }, text: "Cancel." };
    expect((await POST(signed(payload))).status).toBe(503);
    expect(deferred).toHaveLength(1);
    db.findMessageByProviderId.mockResolvedValue({ id: "in_1" });
    db.appendConsentEventGuarded.mockImplementation(async (_d: unknown, e: { action: string }) =>
      e.action === "revoked" ? { outcome: "duplicate", id: "ev_revoked" } : { outcome: "refused", prior: null });
    expect((await POST(signed(payload))).status).toBe(200);
    expect(deferred).toHaveLength(1);
    expect(db.ensureConsentTask).toHaveBeenCalledTimes(2);
  });

  it("an autoresponse_type BIS does not know means Telnyx replied: the stop is recorded, nothing is scheduled, and the value is logged (review R2-I2; mutation: read OTHER as absent → a reply is scheduled, FAILS)", async () => {
    await POST(text("Baja", { autoresponse_type: "OPT_OUT" }));
    expect(writes()).toContainEqual(["revoked", "keyword", "unless_customer_stopped"]);
    expect(deferred).toHaveLength(0);
    expect(vi.mocked(console.error).mock.calls.some((c) => c.map(String).join(" ").includes("OPT_OUT"))).toBe(true);
  });

  it("an address the customer already stopped gets 200 and nothing scheduled (mutation: reply on refused → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValue({ outcome: "refused", prior: null });
    expect((await POST(text("STOP"))).status).toBe(200);
    expect(deferred).toHaveLength(0);
  });

  it("CANCEL with a booking coming up adds the To-do (mutation: drop the CANCEL branch → FAILS)", async () => {
    db.nextBookedStart.mockResolvedValue("2026-10-09T15:00:00Z");
    await POST(text("Cancel"));
    expect(db.ensureConsentTask).toHaveBeenCalledWith({}, "acct_1", expect.objectContaining({ consentEventId: "ev_revoked" }), "sms-inbound", "system");
  });
});

describe("START and HELP", () => {
  it("START that Telnyx answered is recorded, and BIS sends nothing (mutation: schedule anyway → FAILS)", async () => {
    await POST(text("START", { autoresponse_type: "START" }));
    expect(writes()).toContainEqual(["resubscribed", "start_keyword", "if_stopped_or_held"]);
    expect(deferred).toHaveLength(0);
  });

  it("AYUDA gets BIS's Spanish help after the response; HELP that Telnyx answered gets nothing (mutation: help replies when Telnyx answered → FAILS)", async () => {
    await POST(text("Ayuda"));
    await runDeferred();
    expect(sendReply.mock.calls[0]![1].reply).toEqual({ kind: "consent.help", language: "es" });
    sendReply.mockClear();
    await POST(text("HELP", { autoresponse_type: "HELP" }));
    expect(deferred).toHaveLength(0);
  });
});

describe("YES/NO, the phrase list, the grant", () => {
  it("YES/NO runs for a text that is nothing else, and never for a keyword (spec §4.2 step 5; mutation: run it for every text → FAILS)", async () => {
    await POST(text("YES"));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
    await POST(text("STOP"));
    await POST(text("please stop texting me"));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
  });

  it("a text Telnyx answered but BIS does not recognise (telnyx_only) still reaches YES/NO: step 5's 'otherwise' (review R2-m4; mutation: YES/NO only for kind none → FAILS)", async () => {
    await POST(text("yes", { autoresponse_type: "OTHER" }));
    expect(db.applyConfirmationReply).toHaveBeenCalledTimes(1);
  });

  it("a sentence holds texts and makes the To-do; nothing is scheduled (choice 20; mutation: reply to a hold → FAILS)", async () => {
    await POST(text("please stop texting me"));
    expect(writes()).toContainEqual(["held", "free_text", "if_allowed"]);
    expect(db.ensureConsentTask).toHaveBeenCalledTimes(1);
    expect(deferred).toHaveLength(0);
  });

  it("a plain text is filed and gets exactly the first-text grant; a failed grant still answers 200 (decision 8, plan G2; mutation: 503 on a grant failure → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    const res = await POST(text("see you Tuesday"));
    expect(res.status).toBe(200);
    expect(writes()).toEqual([["granted", "inbound_text", "if_empty"]]);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
  });
});

describe("the alert phone (review R2-I5, plan G10)", () => {
  beforeEach(() => { db.getAlertPhone.mockResolvedValue(CUSTOMER); });

  it("its STOP and START are recorded BEFORE the drop, with no contact and no filing, and its own reply is still scheduled to itself (mutation: drop before recording, or make owe a no-op → FAILS)", async () => {
    await POST(text("STOP"));
    await POST(text("START"));
    expect(writes()).toEqual([["revoked", "keyword", "unless_customer_stopped"], ["resubscribed", "start_keyword", "if_stopped_or_held"]]);
    expect(db.appendConsentEventGuarded.mock.calls.every((c) => c[1].contactId === null)).toBe(true);
    expect(db.createContact).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
    // Neither keyword carried autoresponse_type, so BIS owes both replies —
    // and the alert phone gets its own reply the same way a customer does,
    // just with no contact or conversation to file it under (mutation:
    // replace the owe callback with a no-op → deferred stays 0 → FAILS).
    expect(deferred).toHaveLength(2);
    await runDeferred();
    expect(sendReply).toHaveBeenCalledTimes(2);
    for (const call of sendReply.mock.calls) {
      expect(call[1].contactId).toBeNull();
      expect(call[1].conversationId).toBeNull();
    }
  });

  it("a phrase or a HELP from the alert phone writes and schedules nothing at all — only STOP and START are its own to record (mutation: record its phrases too, or let its HELP through → FAILS)", async () => {
    await POST(text("please stop texting me"));
    await POST(text("HELP"));
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });
});

describe("what answers 503 (plan G2)", () => {
  it("a STOP whose contact cannot be made answers 503; the same failure on a plain text answers 200, as before (mutation: 503 for every failure → the plain case FAILS)", async () => {
    db.createContact.mockRejectedValue(new Error("createContact failed"));
    expect((await POST(text("STOP"))).status).toBe(503);
    expect((await POST(text("see you Tuesday"))).status).toBe(200);
  });

  it("a STOP when serviceDb() itself throws answers 503, never the 200 a plain text still gets (mutation: classify inside the try → the throw happens first and answers 200, FAILS)", async () => {
    db.serviceDb.mockImplementation(() => { throw new Error("Supabase service env vars missing"); });
    expect((await POST(text("STOP"))).status).toBe(503);
    expect((await POST(text("hi"))).status).toBe(200);
  });
});
