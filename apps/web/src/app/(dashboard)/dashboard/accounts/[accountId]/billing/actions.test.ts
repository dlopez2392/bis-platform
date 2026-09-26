import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const guard = vi.hoisted(() => ({ allowed: true, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: false }; },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example" }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
// The signed-in caller's client (RLS), not serviceDb: the row is read the
// way the page reads it, so the database backstop stands behind the guard.
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ tag: "rls" }) }));
const billing = vi.hoisted(() => ({ value: null as unknown, db: null as unknown }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  getAccountBilling: async (db: unknown) => { guard.order.push("read"); billing.db = db; return billing.value; },
}));
const gw = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), billingGatewayFromEnv: () => gw.value }));

const { openBillingPortalAction } = await import("./actions");
const { FakeGateway } = await import("@/lib/billing/fake-gateway");
const { m } = await import("@/lib/messages");

let fake: InstanceType<typeof FakeGateway>;
beforeEach(() => {
  guard.allowed = true;
  guard.order = [];
  fake = new FakeGateway();
  gw.value = { ok: true, gateway: fake, live: false };
  billing.value = { stripeCustomerId: "cus_1" };
  billing.db = null;
  // stubEnv, not a bare assignment: vitest.config pins APP_ORIGIN blank for
  // the whole suite, and a leaked value inverts other files' origin tests.
  vi.stubEnv("APP_ORIGIN", "https://app.example");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openBillingPortalAction", () => {
  it("guards first: an account that is not the caller's own is redirected before its row is read (mutation: read first → FAILS)", async () => {
    guard.allowed = false;
    await expect(openBillingPortalAction(ACCOUNT)).rejects.toThrow("NEXT_REDIRECT");
    expect(guard.order).toEqual(["guard"]);
  });

  it("redirects to a portal session for the account's OWN customer, read on the caller's RLS client, returning to its own Billing page (mutation: return to /dashboard → the client lands somewhere else, FAILS; read on serviceDb → FAILS)", async () => {
    const err = await openBillingPortalAction(ACCOUNT).catch((e: unknown) => e) as { url?: string };
    expect(err.url).toBe("https://billing.stripe.test/p/session/cus_1");
    expect(fake.portalSessions[0]).toMatchObject({ customerId: "cus_1", returnUrl: `https://app.example/dashboard/accounts/${ACCOUNT}/billing` });
    expect(billing.db).toEqual({ tag: "rls" });
  });

  it("no Stripe customer (complimentary) or a Stripe failure is a plain sentence, never a crash (mutation: redirect anyway → FAILS)", async () => {
    billing.value = { stripeCustomerId: null };
    expect(await openBillingPortalAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    billing.value = { stripeCustomerId: "cus_1" };
    fake.failOn = { op: "listPortalConfigurations" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await openBillingPortalAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    log.mockRestore();
  });

  it("a Stripe failure is logged with the account id but never the customer's email address (mutation: log e.message raw instead of loggableError → FAILS)", async () => {
    fake.failOn = { op: "createPortalSession", error: new Error("No such customer for owner@rio-roofing.example") };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await openBillingPortalAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    const lines = log.mock.calls.map((c) => c.join(" ")).join("\n");
    log.mockRestore();
    expect(lines).toContain(ACCOUNT);
    expect(lines).not.toContain("owner@rio-roofing.example");
  });
});
