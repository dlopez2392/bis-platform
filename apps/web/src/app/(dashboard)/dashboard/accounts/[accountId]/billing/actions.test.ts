import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const guard = vi.hoisted(() => ({ allowed: true, isAgency: false, order: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => { guard.order.push("guard"); if (!guard.allowed) throw new Error("NEXT_REDIRECT"); return { userId: "u", isAgency: guard.isAgency }; },
}));
const hdr = vi.hoisted(() => ({ host: "app.example" as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(hdr.host ? { host: hdr.host } : {}) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url }); } }));
// The signed-in caller's client (RLS), not serviceDb: the row is read the
// way the page reads it, so the database backstop stands behind the guard.
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ tag: "rls" }) }));
const billing = vi.hoisted(() => ({ value: null as unknown, db: null as unknown, fail: null as Error | null }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  serviceDb: () => ({ tag: "service" }),
  getAccountBilling: async (db: unknown) => { guard.order.push("read"); billing.db = db; if (billing.fail) throw billing.fail; return billing.value; },
}));
const gw = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({ ...(await importOriginal<object>()), billingGatewayFromEnv: () => gw.value }));

const { openBillingPortalAction } = await import("./actions");
const { FakeGateway } = await import("@/lib/billing/fake-gateway");
const { m } = await import("@/lib/messages");

let fake: InstanceType<typeof FakeGateway>;
beforeEach(() => {
  guard.allowed = true;
  guard.isAgency = false;
  guard.order = [];
  hdr.host = "app.example";
  billing.fail = null;
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
  vi.restoreAllMocks();
});

/** Every console.error line the action wrote during `run`. */
async function errorLines(run: () => Promise<unknown>): Promise<string> {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await run();
  const lines = log.mock.calls.map((c) => c.join(" ")).join("\n");
  log.mockRestore();
  return lines;
}

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

  it("an unusable Stripe key is a plain sentence AND a log line naming the account and the reason, so a misconfigured key is visible (mutation: return failed without logging → FAILS)", async () => {
    gw.value = { ok: false, reason: "live_key_outside_production" };
    let result: unknown;
    const lines = await errorLines(async () => { result = await openBillingPortalAction(ACCOUNT); });
    expect(result).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    expect(lines).toContain(ACCOUNT);
    expect(lines).toContain("live_key_outside_production");
  });

  it("no origin to return to (no APP_ORIGIN, no Host) is a plain sentence AND a log line naming the account (mutation: return failed without logging → FAILS)", async () => {
    vi.stubEnv("APP_ORIGIN", "");
    hdr.host = null;
    let result: unknown;
    const lines = await errorLines(async () => { result = await openBillingPortalAction(ACCOUNT); });
    expect(result).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    expect(lines).toContain(ACCOUNT);
    expect(lines).toContain("no origin");
    expect(fake.portalSessions).toHaveLength(0);
  });

  it("a failed billing read is the plain sentence and a log line, never a rejected action that swaps the page for the error boundary (mutation: read outside the try → REJECTS, FAILS)", async () => {
    billing.fail = new Error("getAccountBilling failed: timeout");
    let result: unknown;
    const lines = await errorLines(async () => { result = await openBillingPortalAction(ACCOUNT); });
    expect(result).toEqual({ ok: false, error: m["billing.page.portalFailed"] });
    expect(lines).toContain(ACCOUNT);
  });

  it("the agency opening a client's portal leaves one info line naming the account; the client's own click leaves none (mutation: drop the agency log → FAILS; log every click → FAILS)", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await openBillingPortalAction(ACCOUNT).catch(() => {});
    expect(info).not.toHaveBeenCalled();
    guard.isAgency = true;
    const err = await openBillingPortalAction(ACCOUNT).catch((e: unknown) => e) as { url?: string };
    expect(err.url).toBe("https://billing.stripe.test/p/session/cus_1");
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]!.join(" ")).toContain(ACCOUNT);
  });
});
