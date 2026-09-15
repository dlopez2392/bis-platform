import { describe, it, expect, vi, beforeEach } from "vitest";

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
