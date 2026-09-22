import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const verify = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  updateMessageStatusByProviderId: vi.fn(),
  findMessageByProviderId: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  createContact: vi.fn(),
  incrementUnreadCount: vi.fn(),
  getPhoneNumberByE164: vi.fn(),
  getAlertPhone: vi.fn(),
  applyConfirmationReply: vi.fn(),
  serviceDb: vi.fn(),
}));
vi.mock("@/lib/voice/telnyx-signature", () => ({ verifyTelnyxSignature: verify }));
vi.mock("@bis/db", () => dbMocks);

import { POST } from "./route";

function post(body: object) {
  return new Request("https://x.test/api/sms/inbound", {
    method: "POST",
    headers: { "telnyx-timestamp": "1", "telnyx-signature-ed25519": "sig" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockReturnValue(true);
  process.env.TELNYX_PUBLIC_KEY = "test-key";
  dbMocks.serviceDb.mockReturnValue({});
  // Default: no prior delivery on record. Individual tests override this to
  // simulate a replay.
  dbMocks.findMessageByProviderId.mockResolvedValue(null);
  // Off by default, same as a real account (0035_alert_phone.sql: the field
  // IS the switch) — the loop-guard test below overrides it.
  dbMocks.getAlertPhone.mockResolvedValue(null);
});

describe("POST /api/sms/inbound", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    verify.mockReturnValue(false);
    const res = await POST(post({ data: { event_type: "message.received" } }));
    expect(res.status).toBe(401);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("returns 200 and writes NOTHING for a number this platform does not own", async () => {
    // A webhook that 500s gets retried forever, and an unowned number is not
    // an error condition this platform can fix. It is LOGGED, because the
    // case that matters is a number we DO own whose row is missing — in
    // which case a real customer's text is being discarded and no screen
    // would say so.
    dbMocks.getPhoneNumberByE164.mockResolvedValue(null);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 200 and writes NOTHING for a released number (stale account_id on the row)", async () => {
    // setPhoneNumberStatus is a plain UPDATE, never a delete: a released or
    // reassigned number's row persists with the OLD account_id. Without this
    // guard a stranger's text to that number would be attributed to the
    // former tenant's conversation list instead of being treated as unowned
    // — the same precedent voice/incoming already applies at its own
    // tenant-resolution step.
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_former_tenant", e164: "+15550000000",
      telnyx_id: null, status: "released",
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("acks 200 even when serviceDb() throws synchronously (missing env vars)", async () => {
    // serviceDb() throws synchronously when NEXT_PUBLIC_SUPABASE_URL /
    // SUPABASE_SERVICE_ROLE_KEY are missing. It MUST be called inside the
    // route's try, or this exception escapes past the "never-500" guarantee
    // the adjacent comment claims and Next returns a 500 that Telnyx retries
    // forever.
    dbMocks.serviceDb.mockImplementation(() => {
      throw new Error("Supabase service env vars missing");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("records an inbound text from a known number", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_1",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.findMessageByProviderId).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_evt_1");
    expect(dbMocks.createContact).toHaveBeenCalledWith(
      expect.anything(), "acct_1", { phone: "+15551112222" }, expect.any(String), expect.any(String),
    );
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "contact_1", expect.any(String), expect.any(String),
    );
    expect(dbMocks.createMessage).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({
        conversationId: "conv_1", channel: "sms", direction: "inbound", body: "hi there",
        providerMessageId: "msg_evt_1",
      }),
      expect.any(String), expect.any(String),
    );
    // The finding this covers: without this call an inbound text left both
    // the conversation-list badge and the sidebar unread meter at zero.
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "conv_1",
    );
  });

  // Finding 1 (alert-send-report follow-up review): a transient getAlertPhone
  // read failure used to escape handleInbound into the route's outer catch,
  // which logs and still returns 200 — so Telnyx is told "handled" and never
  // retries, and the text is gone. The loop guard is a nicety; the customer's
  // message is not. A read error must be contained to "no alert phone" so
  // the rest of the write still happens.
  it("still records the inbound text when getAlertPhone's read rejects (mutation: let the throw escape → FAILS)", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.getAlertPhone.mockRejectedValue(new Error("db blip"));
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_blip",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage).toHaveBeenCalledWith(
      expect.anything(), "acct_1",
      expect.objectContaining({ conversationId: "conv_1", channel: "sms", direction: "inbound", body: "hi there" }),
      expect.any(String), expect.any(String),
    );
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("skips a retried message.received (same payload.id) — writes exactly one message", async () => {
    // Telnyx retries webhooks at-least-once. createContact dedupes by phone
    // and ensureConversation by account+contact, but createMessage itself
    // inserts unconditionally — this dedupe check is what stops a retried
    // delivery from putting a duplicate line in the customer's thread.
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
    dbMocks.findMessageByProviderId
      .mockResolvedValueOnce(null) // first delivery: nothing recorded yet
      .mockResolvedValueOnce({ id: "msg_1" }); // Telnyx's retry: already recorded

    const body = {
      data: { event_type: "message.received", payload: {
        id: "msg_evt_1",
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    };

    const first = await POST(post(body));
    const second = await POST(post(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    // The idempotent-skip branch returns before the increment call — a
    // replayed delivery must not double-count the same text as two unreads.
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);
  });

  it("routes a delivery receipt to updateMessageStatusByProviderId", async () => {
    // The message id lives at data.payload.id, NOT data.id — data.id is the
    // webhook EVENT's own id (confirmed against Telnyx's current messaging
    // webhook docs; see route.ts's file header). provider_message_id is set
    // from the send API's data.id (lib/sms/telnyx.ts), which is the SAME
    // value as this webhook's data.payload.id, not its data.id.
    const res = await POST(post({
      data: { event_type: "message.finalized", payload: { id: "prov_1", to: [{ status: "delivered" }] } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.updateMessageStatusByProviderId).toHaveBeenCalledWith(
      expect.anything(), "prov_1", "delivered",
    );
  });

  // THE loop guard (danlo, 2026-09-15): 0035_alert_phone.sql deliberately
  // leaves this to the send path rather than the schema. Nothing stops
  // `accounts.alert_phone` from equalling this account's own `phone_numbers`
  // row, and a text FROM that number would otherwise create a contact and a
  // conversation for the business's own owner — quietly corrupting the CRM
  // with a record of the operator as their own lead.
  it("recognizes and drops an inbound text FROM the account's own alert_phone — no contact, no conversation (mutation: drop the loop guard → FAILS)", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.getAlertPhone.mockResolvedValue("+15551112222"); // == the inbound `from`
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_alert", to: [{ phone_number: "+15550000000" }],
        from: { phone_number: "+15551112222" }, text: "thanks!" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).not.toHaveBeenCalled();
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.incrementUnreadCount).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves every other inbound number untouched — the guard checks equality, not merely presence of an alert_phone", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    // An alert_phone IS set, but it is NOT the number this text came from.
    dbMocks.getAlertPhone.mockResolvedValue("+15559990000");
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        id: "msg_evt_ok", to: [{ phone_number: "+15550000000" }],
        from: { phone_number: "+15551112222" }, text: "hi" } },
    }));

    expect(res.status).toBe(200);
    expect(dbMocks.createContact).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Part B, Task 4: the one place in this platform where an inbound text means
// something other than "a person wrote in". `appointment_confirm` asks a
// customer to reply YES or NO, and `applyConfirmationReply` records what they
// said on the booking. This route is a RECORDER: no reply-back, no status
// change, no new event.
// ---------------------------------------------------------------------------
const OUR_NUMBER = "+15550000000";
const THEIR_NUMBER = "+19565550107";

/** The four mocks a message has to pass to reach the end of handleInbound,
 *  set exactly as `records an inbound text from a known number` sets them.
 *  Local to this describe: the file's own beforeEach deliberately leaves
 *  getPhoneNumberByE164 unset so the "unowned number" cases can use the
 *  default. */
function anOwnedNumberAndAKnownContact() {
  dbMocks.getPhoneNumberByE164.mockResolvedValue({
    id: "pn_1", account_id: "acct_1", e164: OUR_NUMBER, telnyx_id: null, status: "live",
  });
  dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: true });
  dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  // The file's top-level beforeEach runs `vi.clearAllMocks()`, which clears
  // CALLS and not IMPLEMENTATIONS. Without this line a case appended after
  // "a failure recording the answer is CONTAINED" inherits its REJECTING
  // applyConfirmationReply, the route swallows the rejection by design, and
  // the new case passes green while silently exercising the failure path.
  // The same shape cost part C's appointment-confirm suite ~0.9s per test
  // before it was noticed.
  dbMocks.applyConfirmationReply.mockResolvedValue(null);
}

const inbound = (text: string, from = THEIR_NUMBER) => post({
  data: {
    event_type: "message.received",
    payload: {
      id: `evt_${text.slice(0, 6)}`,
      to: [{ phone_number: OUR_NUMBER }], from: { phone_number: from }, text,
    },
  },
});

describe("an inbound text that is a one-word answer", () => {
  beforeEach(anOwnedNumberAndAKnownContact);

  it("records the answer AFTER the message is filed, and sends nothing", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    await POST(inbound("YES"));
    // Order matters: the customer's message is filed first, always.
    expect(dbMocks.createMessage).toHaveBeenCalled();
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "contact_1", "YES", expect.any(Date));
    // Mutation: move the call ABOVE createMessage -> the order assertion below reds.
    const filedAt = dbMocks.createMessage.mock.invocationCallOrder[0]!;
    const answeredAt = dbMocks.applyConfirmationReply.mock.invocationCallOrder[0]!;
    expect(answeredAt).toBeGreaterThan(filedAt);
  });

  it("NEVER sends anything back — the route is a recorder", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    const res = await POST(inbound("yes"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage.mock.calls[0]![2].direction).toBe("inbound");
    // THE ROUTE HAS NO SEND PATH AT ALL, which is exactly why there is no
    // `smsSend` spy in this file to assert against — so the assertion is on
    // the source, not on a mock that does not exist. `Object.keys(await
    // import(...))` would not be an assertion; this is.
    //
    // It asserts the IMPORT SURFACE, not a list of function names. The first
    // form of this case deny-listed four
    // (getSmsProvider / sendSmsAction / sendAutomationSms / sendInstantReply)
    // and six of the seven real senders in this tree walked past it —
    // MEASURED, not argued: a real `sendAlertSms` import plus a real call in
    // handleInbound left this file 15/15 green. "Text the operator that the
    // customer confirmed" is exactly the feature someone adds here next, and
    // sendAlertSms is the one-call helper they would reach for.
    //
    // Every sender that lives in a LIBRARY lives under `@/lib/sms`,
    // `@/lib/automations` or `@/lib/email`, so those three roots cannot rot
    // when an eighth send function is named. `sendSmsAction` keeps its name
    // because it is the one sender that is not in a library at all: it is a
    // server action in the conversations route group
    // (conversations/actions.ts:112), and dropping it would have been a
    // strict loss against the four-name form.
    //
    // `@/lib/email` is in here because spec decision 6 is "no send of ANY
    // kind", not "no text back". Its recorded reasoning — a second outbound
    // costs a message, risks a loop against the carrier's own STOP handling,
    // and makes this webhook a sender rather than a recorder — is about the
    // outbound existing at all, and an emailed "your customer confirmed"
    // alert is the same failure over a different transport. Also MEASURED: a
    // real `getEmailProvider().send({...})` in handleInbound left this file
    // 15/15 green while the guard named only the two SMS roots. The one
    // import this could ever obstruct is `originFrom` from
    // `@/lib/email/origin`, which an inbound SMS recorder has no use for; if
    // some later task genuinely needs it, a deliberate carve-out with a
    // comment beats a gap nobody noticed, which is what the four-name
    // deny-list turned out to be.
    //
    // Three `toContain`s rather than one alternating regex on purpose: the
    // failure names WHICH root was crossed, and an escaped-slash regex
    // literal is the exact shape that gets mangled when an assertion is
    // copied between files.
    // Mutation: import any sender into this route -> red.
    const routeSource = readFileSync(
      new URL("./route.ts", import.meta.url), "utf8");
    expect(routeSource).not.toContain('from "@/lib/sms');
    expect(routeSource).not.toContain('from "@/lib/automations');
    expect(routeSource).not.toContain('from "@/lib/email');
    expect(routeSource).not.toContain("sendSmsAction");
  });

  it("a failure recording the answer is CONTAINED — the customer's message is filed and the outer catch never sees it", async () => {
    // The containment is the whole point of this leg, and the ONLY thing
    // that proves it is WHICH log line came out. Dropping the try/catch
    // lets the rejection reach the route's outer catch, which logs and STILL
    // returns `{ ok: true }` — by which time createMessage and
    // incrementUnreadCount have each run once. So `res.status === 200` and
    // both call counts of 1 stay TRUE under the mutation: an earlier draft
    // of this case asserted exactly those three and could not fail.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.applyConfirmationReply.mockRejectedValue(new Error("db blip"));
    const res = await POST(inbound("no"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);

    const logged = spy.mock.calls.map((args) => args.join(" ")).join("\n");
    // Mutation: drop the try/catch around applyConfirmationReply -> this pair
    // flips, and only this pair. The contained line disappears and the outer
    // catch's appears.
    expect(logged).toContain("could not record a confirmation reply");
    expect(logged).not.toContain("unexpected failure handling webhook");
    spy.mockRestore();
  });

  it("an ordinary message still goes through untouched", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue(null);
    await POST(inbound("can you come Tuesday instead?"));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // it decides; the route does not pre-filter
  });

  it("a text from the account's own alert phone never reaches the matcher", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559999");
    await POST(inbound("yes", "+19565559999"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    // Mutation: delete the guard's early return (route.ts:130-133) -> red.
    //
    // NOT "move the new block above the alert-phone guard", which is what the
    // plan prescribed and nobody can apply: the block reads `contact.id`, and
    // `contact` is const-declared 27 lines BELOW the guard (route.ts:157), so
    // that move is a TDZ/compile error rather than a test failure. A mutation
    // that cannot be applied proves nothing about the case it names.
  });
});
