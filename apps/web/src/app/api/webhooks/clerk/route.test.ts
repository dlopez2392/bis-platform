import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";
const reconcile = vi.fn(); const upsertUser = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  reconcileMembership: (...a: unknown[]) => reconcile(...a),
  upsertUserFromClerk: (...a: unknown[]) => upsertUser(...a),
  isAgencyMetadata: (m: { app_role?: string }) => m?.app_role === "agency_admin",
}));
vi.mock("@/lib/team/clerk-team", () => ({ liveClerkTeamPort: () => ({}) }));
import { POST } from "./route";

const SECRET = "whsec_" + Buffer.from("staff-and-roles-test-secret-32b!").toString("base64");
function signed(body: unknown, secret = SECRET) {
  const payload = JSON.stringify(body); const id = "msg_1"; const ts = new Date();
  const sig = new Webhook(secret).sign(id, ts, payload);
  return new Request("http://localhost/api/webhooks/clerk", { method: "POST", body: payload,
    headers: { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": sig } });
}
const membership = (type: string) => ({ type, data: { organization: { id: "org_1" }, public_user_data: { user_id: "user_1" } } });
beforeEach(() => { reconcile.mockReset().mockResolvedValue({ outcome: "created", role: "staff" }); upsertUser.mockReset(); process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET; });

describe("clerk webhook", () => {
  it("a bad signature is 400 and nothing is written (mutation: skip verify -> FAILS)", async () => {
    const res = await POST(signed(membership("organizationMembership.created"), "whsec_" + Buffer.from("another-secret-of-32-bytes-long!").toString("base64")));
    expect(res.status).toBe(400); expect(reconcile).not.toHaveBeenCalled();
  });
  it.each(["organizationMembership.created", "organizationMembership.deleted"])("%s reconciles (user, org) in webhook mode", async (t) => {
    expect((await POST(signed(membership(t)))).status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({}, {}, { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "webhook" });
  });
  it("a replay of the same event is accepted and reconciled again (idempotence lives in reconcile)", async () => {
    await POST(signed(membership("organizationMembership.created"))); await POST(signed(membership("organizationMembership.created")));
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
  it("user.updated upserts email and name; an agency user is skipped (mutation: drop the agency skip -> FAILS)", async () => {
    const user = (meta: object) => ({ type: "user.updated", data: { id: "user_1", first_name: "Pat", last_name: "Lee",
      primary_email_address_id: "e1", email_addresses: [{ id: "e1", email_address: "pat@example.com" }], public_metadata: meta } });
    await POST(signed(user({})));
    expect(upsertUser).toHaveBeenCalledWith({}, { clerkUserId: "user_1", email: "pat@example.com", name: "Pat Lee" });
    upsertUser.mockReset(); await POST(signed(user({ app_role: "agency_admin" })));
    expect(upsertUser).not.toHaveBeenCalled();
  });
  it("an unknown event type is 200 and ignored", async () => {
    expect((await POST(signed({ type: "session.created", data: {} }))).status).toBe(200); expect(reconcile).not.toHaveBeenCalled();
  });
  it("a database failure is 500 so Svix retries (mutation: catch and 200 -> FAILS)", async () => {
    reconcile.mockRejectedValue(new Error("db down"));
    expect((await POST(signed(membership("organizationMembership.created")))).status).toBe(500);
  });
  it("an unset secret is 503 'not configured', writes nothing and is not a silent accept (mutation: 200 or 500 -> FAILS)", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const res = await POST(signed(membership("organizationMembership.created")));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("not configured");
    expect(reconcile).not.toHaveBeenCalled();
  });
});
