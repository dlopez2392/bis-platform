import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  updateMessageStatusByProviderId: (...args: unknown[]) => updateMock(...args),
}));
const verifyMock = vi.fn();
vi.mock("svix", () => ({ Webhook: class { verify(...a: unknown[]) { return verifyMock(...a); } } }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "2", "svix-signature": "v1,x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ updated: true });
  verifyMock.mockReset();
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
});

describe("resend webhook", () => {
  it("rejects an invalid signature and never touches the database", async () => {
    verifyMock.mockImplementation(() => { throw new Error("bad signature"); });
    const res = await POST(req({ type: "email.delivered", data: { email_id: "prov_1" } }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps a delivered event to the delivered status", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "prov_1" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_1", "delivered");
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
    updateMock.mockResolvedValue({ updated: false });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
  });

  it("ignores an event type it does not map", async () => {
    verifyMock.mockReturnValue({ type: "email.something_else", data: { email_id: "prov_3" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
