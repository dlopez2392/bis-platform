import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const suppressMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  updateMessageStatusByProviderId: (...args: unknown[]) => updateMock(...args),
  recordEmailSuppression: (...args: unknown[]) => suppressMock(...args),
}));
const stampMock = vi.fn();
vi.mock("@/lib/ops/stamp", () => ({ stampHeartbeat: (...a: unknown[]) => stampMock(...a) }));
const verifyMock = vi.fn();
vi.mock("svix", () => ({ Webhook: class { verify(...a: unknown[]) { return verifyMock(...a); } } }));

import { POST } from "./route";

const ACCOUNT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const CONTACT = "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "2", "svix-signature": "v1,x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ updated: true, accountId: null, contactId: null });
  suppressMock.mockReset().mockResolvedValue("appended");
  verifyMock.mockReset();
  stampMock.mockReset();
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
});

describe("resend webhook", () => {
  it("rejects an invalid signature and never touches the database", async () => {
    verifyMock.mockImplementation(() => { throw new Error("bad signature"); });
    const res = await POST(req({ type: "email.delivered", data: { email_id: "prov_1" } }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
    // A forgery is a stranger, not an outage (mutation: stamp an error here → FAILS).
    expect(stampMock).not.toHaveBeenCalled();
  });

  it("maps a delivered event to the delivered status", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "prov_1" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_1", "delivered");
    expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.resend_webhook", { ok: true });
  });

  // D-016: a spam complaint stayed a "bounced" message status (0005's CHECK
  // constraint has no "complained" value, and adding one needs a migration
  // this fix does not make — see failure-reason.ts) but is no longer
  // INDISTINGUISHABLE from a plain bounce: it carries the one marker
  // lib/email/failure-reason.ts recognises, in the SAME write as the status.
  it("maps a complaint event to the bounced status, carrying the complaint marker (mutation: drop the error patch → FAILS)", async () => {
    verifyMock.mockReturnValue({ type: "email.complained", data: { email_id: "prov_c" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_c", "bounced", { error: "complained" });
  });

  // A PLAIN bounce must NEVER carry the complaint marker — the two are
  // different things to do about an address (failure-reason.ts's own doc
  // comment). `toHaveBeenCalledWith` checks the EXACT argument list,
  // including count: a widened branch that also matches "email.bounced"
  // (e.g. `event.type === "email.complained" || event.type ===
  // "email.bounced"`) would pass a 4th argument here and fail this
  // assertion, where the pre-existing "maps a delivered event..." test
  // above — which never checks for the ABSENCE of a 4th argument on any
  // event this fix touches — would not have caught it.
  it("maps a plain bounce to the bounced status with NO error patch (mutation: widen the complaint check to include bounced → FAILS)", async () => {
    verifyMock.mockReturnValue({ type: "email.bounced", data: { email_id: "prov_b" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_b", "bounced");
  });

  it("maps a failed event to the failed status", async () => {
    verifyMock.mockReturnValue({ type: "email.failed", data: { email_id: "prov_fail" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_fail", "failed");
  });

  it("is idempotent across a replayed event", async () => {
    verifyMock.mockReturnValue({ type: "email.opened", data: { email_id: "prov_2" } });
    await POST(req({}));
    await POST(req({}));
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith(expect.anything(), "prov_2", "opened");
  });

  it("returns 200 for an unknown provider id so the provider stops retrying", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "nope" } });
    updateMock.mockResolvedValue({ updated: false, accountId: null, contactId: null });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
  });

  it("ignores an event type it does not map", async () => {
    verifyMock.mockReturnValue({ type: "email.something_else", data: { email_id: "prov_3" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });

  describe("email suppression (D-016 item 2): a hard bounce or a complaint stops later mail to that address", () => {
    it("a hard (Permanent) bounce records a suppression, resolved from the event's OWN tags first (mutation: read the message row instead of the tags → FAILS)", async () => {
      updateMock.mockResolvedValue({ updated: true, accountId: "fallback-account", contactId: "fallback-contact" });
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: {
          email_id: "prov_hard", to: ["customer@example.com"],
          tags: { account_id: ACCOUNT, contact_id: CONTACT },
          bounce: { type: "Permanent", subType: "General", message: "mailbox unavailable" },
        },
      });
      const res = await POST(req({}));
      expect(res.status).toBe(200);
      expect(suppressMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        accountId: ACCOUNT, address: "customer@example.com", contactId: CONTACT,
        reason: "hard_bounce", providerMessageId: "prov_hard",
      });
    });

    it("a complaint records a suppression with reason complaint, not hard_bounce (mutation: always write hard_bounce → FAILS)", async () => {
      verifyMock.mockReturnValue({
        type: "email.complained",
        data: { email_id: "prov_c", to: ["customer@example.com"], tags: { account_id: ACCOUNT, contact_id: CONTACT } },
      });
      await POST(req({}));
      expect(suppressMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ reason: "complaint" }));
    });

    it.each(["Transient", "Undetermined", undefined])(
      "a non-permanent bounce (type %j) writes NOTHING to the suppression ledger (mutation: suppress on every bounce → FAILS)", async (type) => {
        verifyMock.mockReturnValue({
          type: "email.bounced",
          data: { email_id: "prov_soft", to: ["customer@example.com"], tags: { account_id: ACCOUNT },
            ...(type !== undefined ? { bounce: { type, subType: "General", message: "x" } } : {}) },
        });
        const res = await POST(req({}));
        expect(res.status).toBe(200);
        expect(suppressMock).not.toHaveBeenCalled();
      });

    it("falls back to the message row's account and contact id when the event carries no tags — an older composer send (mutation: ignore the fallback → FAILS)", async () => {
      updateMock.mockResolvedValue({ updated: true, accountId: ACCOUNT, contactId: CONTACT });
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: { email_id: "prov_hard", to: ["customer@example.com"], bounce: { type: "Permanent", subType: "General", message: "x" } },
      });
      await POST(req({}));
      expect(suppressMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ accountId: ACCOUNT, contactId: CONTACT }));
    });

    it("no account from the tags or the row: logged, 200, never a suppression call — nothing to attribute to (mutation: suppress with a null account → FAILS)", async () => {
      updateMock.mockResolvedValue({ updated: false, accountId: null, contactId: null });
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: { email_id: "prov_unknown", to: ["customer@example.com"], bounce: { type: "Permanent", subType: "General", message: "x" } },
      });
      const res = await POST(req({}));
      expect(res.status).toBe(200);
      expect(suppressMock).not.toHaveBeenCalled();
    });

    it("recordEmailSuppression's no_address outcome is still a 200, not an error (mutation: 500 on no_address → FAILS)", async () => {
      suppressMock.mockResolvedValue("no_address");
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: { email_id: "prov_hard", to: [], tags: { account_id: ACCOUNT }, bounce: { type: "Permanent", subType: "General", message: "x" } },
      });
      const res = await POST(req({}));
      expect(res.status).toBe(200);
    });

    it("a throw from recordEmailSuppression is a 500 (Resend retries) and stamps an error (mutation: swallow the throw → FAILS)", async () => {
      suppressMock.mockRejectedValue(new Error("consent_events down"));
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: { email_id: "prov_hard", to: ["customer@example.com"], tags: { account_id: ACCOUNT }, bounce: { type: "Permanent", subType: "General", message: "x" } },
      });
      await expect(POST(req({}))).rejects.toThrow("consent_events down");
      expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.resend_webhook", expect.objectContaining({ ok: false }));
    });

    it("the address is the payload's OWN recipient (data.to[0]), never looked up elsewhere (mutation: drop the address → FAILS)", async () => {
      verifyMock.mockReturnValue({
        type: "email.bounced",
        data: { email_id: "prov_hard", to: ["first@example.com", "second@example.com"], tags: { account_id: ACCOUNT },
          bounce: { type: "Permanent", subType: "General", message: "x" } },
      });
      await POST(req({}));
      expect(suppressMock).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({ address: "first@example.com" }));
    });

    it("a delivered event never touches the suppression ledger (mutation: call it for every event → FAILS)", async () => {
      verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "prov_1", to: ["a@example.com"], tags: { account_id: ACCOUNT } } });
      await POST(req({}));
      expect(suppressMock).not.toHaveBeenCalled();
    });
  });

  describe("heartbeat (operational-floor spec §1)", () => {
    it("an unset secret is an outage: 500 and an error stamp, before any read", async () => {
      delete process.env.RESEND_WEBHOOK_SECRET;
      const res = await POST(req({}));
      expect(res.status).toBe(500);
      expect(verifyMock).not.toHaveBeenCalled();
      expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.resend_webhook", { ok: false, error: "RESEND_WEBHOOK_SECRET is not set" });
    });

    it("a signed event it does not map is still the route working: an ok stamp", async () => {
      verifyMock.mockReturnValue({ type: "email.something_else", data: { email_id: "prov_3" } });
      await POST(req({}));
      expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.resend_webhook", { ok: true });
    });

    it("a failed status write rethrows (Resend retries) and stamps the error's TYPE only, never its message", async () => {
      verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "prov_1" } });
      updateMock.mockRejectedValue(new TypeError("connect failed for someone@example.com"));
      await expect(POST(req({}))).rejects.toThrow(TypeError);
      expect(stampMock).toHaveBeenCalledExactlyOnceWith("email.resend_webhook", { ok: false, error: "status write failed: TypeError" });
      expect(JSON.stringify(stampMock.mock.calls)).not.toContain("example.com");
    });
  });
});
