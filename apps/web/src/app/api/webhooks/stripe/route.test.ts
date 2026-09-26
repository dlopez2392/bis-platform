import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";

const processMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/webhook", () => ({ processStripeEvent: (...a: unknown[]) => processMock(...a) }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

const route = await import("./route");
const { POST } = route;

const SECRET = "whsec_route_fixture";
/** Deliberately NOT what JSON.stringify would print: odd spacing and key
 *  order. Only a verifier that reads the raw text accepts it. */
const RAW = '{ "type":"invoice.paid",  "id":"evt_r1","object":"event","livemode":false,\n "data":{"object":{"id":"in_1","object":"invoice","parent":{"subscription_details":{"subscription":"sub_r1"}}}} }';
const signed = (body: string, secret = SECRET) =>
  new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": Stripe.webhooks.generateTestHeaderString({ payload: body, secret }) },
    body,
  });

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_route";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://odnobiodsftffphuuosz.supabase.co";
  delete process.env.VERCEL_ENV;
  processMock.mockReset().mockResolvedValue({ status: "processed", accountId: "acct" });
});
afterEach(() => { process.env = { ...saved }; });

describe("POST /api/webhooks/stripe", () => {
  it("answers 503 with no signing secret configured, reading nothing, not even the body (so Stripe keeps retrying until it is set) (mutation: default the secret to '' and verify anyway → 400, FAILS; read the body before checking the secret → FAILS)", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = signed(RAW);
    expect((await POST(req)).status).toBe(503);
    expect(req.bodyUsed).toBe(false);
    expect(processMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("answers 400 to a bad signature and never processes it: the security boundary (mutation: process before verifying → FAILS)", async () => {
    expect((await POST(signed(RAW, "whsec_forged"))).status).toBe(400);
    expect(processMock).not.toHaveBeenCalled();
  });

  it("verifies the RAW body, byte for byte: an oddly spaced, oddly ordered payload Stripe signed is accepted and reduced to its subscription (mutation: verify JSON.stringify(await request.json()) instead → the signature no longer matches, 400, FAILS)", async () => {
    const res = await POST(signed(RAW));
    expect(res.status).toBe(200);
    expect(processMock).toHaveBeenCalledWith(
      expect.objectContaining({ live: false, db: { tag: "service" } }),
      { id: "evt_r1", type: "invoice.paid", livemode: false, subscriptionId: "sub_r1" },
    );
  });

  it("answers 500 when processing throws, so Stripe retries; 400 on a wrong-mode event; 200 on a duplicate (mutation: swallow the throw with a 200 → the event is lost, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    processMock.mockRejectedValueOnce(new Error("db down"));
    expect((await POST(signed(RAW))).status).toBe(500);
    processMock.mockResolvedValueOnce({ status: "mode_mismatch" });
    expect((await POST(signed(RAW))).status).toBe(400);
    processMock.mockResolvedValueOnce({ status: "duplicate" });
    expect((await POST(signed(RAW))).status).toBe(200);
    log.mockRestore();
  });

  it("answers 503 when the Stripe key is refused here (a test key on production's data), without processing (mutation: skip the verdict → a test key re-reads against production's database, FAILS)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://tlbkbmlrfafquucsmsmm.supabase.co";
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(signed(RAW))).status).toBe(503);
    expect(processMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("runs on Node (the SDK's crypto) with a bounded duration, and is never cached (mutation: drop the runtime export → FAILS)", () => {
    expect(route.runtime).toBe("nodejs");
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(30);
  });
});
