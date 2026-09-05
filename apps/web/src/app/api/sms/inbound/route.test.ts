import { describe, it, expect, vi, beforeEach } from "vitest";

const verify = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  updateMessageStatusByProviderId: vi.fn(),
  findMessageByProviderId: vi.fn(),
  ensureConversation: vi.fn(),
  createMessage: vi.fn(),
  createContact: vi.fn(),
  getPhoneNumberByE164: vi.fn(),
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
});
