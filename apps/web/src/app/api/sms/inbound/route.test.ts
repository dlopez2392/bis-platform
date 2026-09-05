import { describe, it, expect, vi, beforeEach } from "vitest";

const verify = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  updateMessageStatusByProviderId: vi.fn(),
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

  it("records an inbound text from a known number", async () => {
    dbMocks.getPhoneNumberByE164.mockResolvedValue({
      id: "pn_1", account_id: "acct_1", e164: "+15550000000", telnyx_id: null, status: "live",
    });
    dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: false });
    dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: true });
    dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });

    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi there" } },
    }));

    expect(res.status).toBe(200);
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
      }),
      expect.any(String), expect.any(String),
    );
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
