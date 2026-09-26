import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AccountBilling, BillingLink, Plan } from "@bis/db";

const db = vi.hoisted(() => ({
  getAccountBilling: vi.fn(),
  getBillingLink: vi.fn(),
  saveBillingLink: vi.fn(),
  markBillingLinkExpired: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

const { sendBillingLink, loggableError } = await import("./billing-link");
const { FakeGateway } = await import("./fake-gateway");
const { idempotencyKey } = await import("./stripe-gateway");

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const PLAN: Plan = {
  id: "22222222-2222-4222-8222-222222222222", agencyId: "ag", name: "Growth", monthlyPriceCents: 14900, currency: "usd",
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 }, overageCents: { voice_minutes: 10, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1", stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00",
};
const NOW = new Date("2026-10-15T15:00:00.000Z");
const INPUT = { accountId: ACCOUNT, plan: PLAN, email: "owner@example.com", businessName: "Rio Roofing", zone: "America/Chicago" };
const stored = (over: Partial<AccountBilling>): AccountBilling => ({
  accountId: ACCOUNT, planId: PLAN.id, complimentary: false, stripeCustomerId: "cus_stored", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null, billingPausedAt: null,
  billingStartedAt: "2026-09-01T00:00:00+00:00", createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const prevLink = (sessionId: string): BillingLink => ({
  accountId: ACCOUNT, planId: PLAN.id, stripeCustomerId: "cus_linked", checkoutSessionId: sessionId,
  checkoutUrl: `https://checkout.stripe.test/c/pay/${sessionId}`, sentTo: "owner@example.com",
  expiresAt: "2026-10-16T00:00:00+00:00", sentAt: "2026-10-15T00:00:00+00:00", updatedAt: "2026-10-15T00:00:00+00:00",
});

let gateway: InstanceType<typeof FakeGateway>;
let sent: Array<{ to: string; subject: string; body: string; html?: string; replyTo?: string; fromName: string }>;
let emailError: Error | null = null;
const deps = (over: { newRequestId?: () => string; replyTo?: string } = {}) => ({
  db: {} as never, gateway, now: NOW, origin: "https://app.example", replyTo: "help@bis.example",
  email: { isFake: true, send: async (i: (typeof sent)[number]) => { if (emailError) throw emailError; sent.push(i); return { providerMessageId: "e1" }; } },
  ...over,
});

/** The billed row's customer, as Stripe holds it (the fake refuses an
 *  update to a customer it does not know, as Stripe does). */
const seedStoredCustomer = (email = "old-owner@example.com") =>
  gateway.customers.push({ id: "cus_stored", accountId: ACCOUNT, name: "Rio Roofing", email });

beforeEach(() => {
  gateway = new FakeGateway();
  sent = [];
  emailError = null;
  db.getAccountBilling.mockReset().mockResolvedValue(null);
  db.getBillingLink.mockReset().mockResolvedValue(null);
  db.saveBillingLink.mockReset().mockResolvedValue(true);
  db.markBillingLinkExpired.mockReset().mockResolvedValue(undefined);
});

// A test that fails before its own mockRestore() must not hand its console
// spy (and the calls on it) to the next test: each red stays its own.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendBillingLink", () => {
  it("first link: makes the customer and a subscription Checkout on the plan's four prices returning to /billing-done, each keyed on EVERY parameter it sends plus this Send's own request id, saves it as the first link, and emails it from BIS in BIS's own header, never the business's (DECISION 1) (mutation: key the customer by account alone → a corrected email replays the old customer, FAILS; drop the request id from either key → FAILS; brand the header with the business name → FAILS)", async () => {
    const r = await sendBillingLink(deps({ newRequestId: () => "req-1" }), INPUT);
    expect(r.ok).toBe(true);
    const customer = { accountId: ACCOUNT, name: "Rio Roofing", email: "owner@example.com" };
    expect(gateway.calls[0]).toEqual({
      op: "createCustomer", key: idempotencyKey("bis-customer", ACCOUNT, { customer, requestId: "req-1" }), input: customer,
    });
    const session = [...gateway.checkoutSessions.values()][0]!;
    expect(session.input).toEqual({
      accountId: ACCOUNT, planId: PLAN.id, customerId: gateway.customers[0]!.id, priceIds: PLAN.stripePriceIds,
      successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
    });
    expect(gateway.calls.find((c) => c.op === "createCheckoutSession")!.key)
      .toBe(idempotencyKey("bis-checkout", ACCOUNT, { checkout: session.input, requestId: "req-1" }));
    expect(db.saveBillingLink).toHaveBeenCalledWith({}, {
      accountId: ACCOUNT, planId: PLAN.id, stripeCustomerId: gateway.customers[0]!.id, checkoutSessionId: session.id,
      checkoutUrl: session.url, sentTo: "owner@example.com", expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    }, null, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.com", fromName: "BIS", replyTo: "help@bis.example" });
    expect(sent[0]!.body).toContain(session.url);
    expect(sent[0]!.html).toContain(">BIS</td>");
    expect(sent[0]!.html).not.toContain(">Rio Roofing</td>");
  });

  it("reuses the account's customer and never makes another: the billed row's customer WINS over a pending link that names a different one (G3's invariant; the mirror would refuse the other as customer_changed) (mutation: always create → a second Stripe customer per resend, FAILS; prefer the link's customer → FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    gateway.checkoutSessions.get(old.id)!.status = "expired";
    seedStoredCustomer();
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    db.getBillingLink.mockResolvedValue(prevLink(old.id));
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    expect(gateway.calls.filter((c) => c.op === "createCustomer")).toEqual([]);
    expect([...gateway.checkoutSessions.values()].at(-1)!.input.customerId).toBe("cus_stored");
  });

  it("a resend to a CORRECTED address on an unbilled account makes a new customer on the new address and saves the link on it: the link's customer keeps the old address, and Stripe's receipts and payment emails follow the customer (review finding 1) (mutation: reuse the link's customer whatever the address → receipts go to the old address for good, FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    db.getBillingLink.mockResolvedValue({ ...prevLink(old.id), sentTo: "typo@exmaple.com" });
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    expect(gateway.customers.map((c) => c.email)).toEqual(["owner@example.com"]);
    const fresh = gateway.customers[0]!.id;
    expect([...gateway.checkoutSessions.values()].at(-1)!.input.customerId).toBe(fresh);
    expect((db.saveBillingLink.mock.calls[0]![1] as { stripeCustomerId: string }).stripeCustomerId).toBe(fresh);
    expect(gateway.checkoutSessions.get(old.id)!.status).toBe("expired");
  });

  it("a resend to the SAME address, however it is capitalised or padded, reuses the link's customer: no second customer (mutation: compare the addresses exactly → a needless customer per resend, FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    db.getBillingLink.mockResolvedValue({ ...prevLink(old.id), sentTo: " Owner@Example.COM " });
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    expect(gateway.calls.filter((c) => c.op === "createCustomer")).toEqual([]);
    expect([...gateway.checkoutSessions.values()].at(-1)!.input.customerId).toBe("cus_linked");
  });

  it("a billed account (paid, then canceled) keeps its ONE customer (G3), and that customer's email moves to the new recipient before the session is made, under a key over the customer, the address and this Send (review finding 1) (mutation: skip the email update → a new owner's receipts go to the old one, FAILS; update after creating the session → FAILS)", async () => {
    seedStoredCustomer("old-owner@example.com");
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    expect((await sendBillingLink(deps({ newRequestId: () => "req-1" }), INPUT)).ok).toBe(true);
    expect(gateway.calls.map((c) => c.op)).toEqual(["updateCustomerEmail", "createCheckoutSession"]);
    expect(gateway.calls[0]).toEqual({
      op: "updateCustomerEmail", input: { customerId: "cus_stored", email: "owner@example.com" },
      key: idempotencyKey("bis-customer-email", ACCOUNT, { customerId: "cus_stored", email: "owner@example.com", requestId: "req-1" }),
    });
    expect(gateway.customers).toEqual([{ id: "cus_stored", accountId: ACCOUNT, name: "Rio Roofing", email: "owner@example.com" }]);
    expect([...gateway.checkoutSessions.values()].at(-1)!.input.customerId).toBe("cus_stored");
  });

  it("a billed account whose customer email update FAILS stops there: 'stripe_failed', no session made, nothing saved, nothing sent (re-review finding 1) (mutation: swallow the update's failure → a link goes out while receipts still go to the old owner, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    seedStoredCustomer("old-owner@example.com");
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    gateway.failOn = {
      op: "updateCustomerEmail",
      error: Object.assign(new Error("An unknown error occurred"), { type: "StripeAPIError", statusCode: 500 }),
    };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    expect(gateway.calls.filter((c) => c.op === "createCheckoutSession")).toEqual([]);
    expect(db.saveBillingLink).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(gateway.customers[0]!.email).toBe("old-owner@example.com");
    expect(log).toHaveBeenCalledTimes(1);
  });

  /** Two Sends at once on a billed account, to two addresses: each moves the
   *  customer's email before either saves, and the save lets one win. The
   *  database mocks behave like the conditional insert: first save wins. */
  const raceTwoSends = async () => {
    seedStoredCustomer("old-owner@example.com");
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    let savedLink: BillingLink | null = null;
    db.getBillingLink.mockImplementation(async () => savedLink);
    db.saveBillingLink.mockImplementation(async (_db: unknown, l: Omit<BillingLink, "sentAt" | "updatedAt">) => {
      if (savedLink) return false;
      savedLink = { ...l, sentAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
      return true;
    });
    const results = await Promise.all([
      sendBillingLink(deps(), { ...INPUT, email: "first@example.com" }),
      sendBillingLink(deps(), { ...INPUT, email: "second@example.com" }),
    ]);
    return { results, winner: savedLink as BillingLink | null };
  };

  it("two Sends at once to two addresses on a billed account: the loser puts the customer's email back to the WINNER's saved address, under its own key, so receipts go where the live link went (re-review finding 2) (mutation: skip the restore → the customer ends on the loser's address, FAILS)", async () => {
    const { results, winner } = await raceTwoSends();
    expect(results.map((r) => (r.ok ? "ok" : r.reason)).sort()).toEqual(["ok", "stale"]);
    expect(sent.map((m) => m.to)).toEqual([winner!.sentTo]);
    expect(gateway.customers[0]!.email).toBe(winner!.sentTo);
    const updates = gateway.calls.filter((c) => c.op === "updateCustomerEmail");
    expect(updates).toHaveLength(3);
    expect(updates[2]!.input).toEqual({ customerId: "cus_stored", email: winner!.sentTo });
    expect(new Set(updates.map((c) => c.key)).size).toBe(3);
  });

  it("a loser that stalls while a LATER Send wins restores the address of the link that is live NOW, re-read right before the write, not the winner it saw first (final re-review) (mutation: restore from the stale snapshot → the customer ends on a@ while the live link names d@, FAILS)", async () => {
    seedStoredCustomer("old-owner@example.com");
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    // The conditional save, as the database does it: insert only when there
    // is no row; update only while the row still names the expected session.
    let savedLink: BillingLink | null = null;
    db.getBillingLink.mockImplementation(async () => savedLink);
    db.saveBillingLink.mockImplementation(async (_db: unknown, l: Omit<BillingLink, "sentAt" | "updatedAt">, expected: string | null) => {
      if (expected === null ? savedLink !== null : savedLink?.checkoutSessionId !== expected) return false;
      savedLink = { ...l, sentAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
      return true;
    });
    // The loser's own expire (the first expire of the test) waits for a gate.
    const realExpire = gateway.expireCheckoutSession.bind(gateway);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const atGate = new Promise<void>((r) => { reached = r; });
    let gated = false;
    vi.spyOn(gateway, "expireCheckoutSession").mockImplementation(async (id: string) => {
      if (!gated) { gated = true; reached(); await gate; }
      return realExpire(id);
    });

    const a = sendBillingLink(deps(), { ...INPUT, email: "a@example.com" });
    const b = sendBillingLink(deps(), { ...INPUT, email: "b@example.com" });
    expect((await a).ok).toBe(true);
    await atGate;
    const d = await sendBillingLink(deps(), { ...INPUT, email: "d@example.com" });
    expect(d.ok).toBe(true);
    release();
    expect(await b).toEqual({ ok: false, reason: "stale" });

    expect(savedLink!.sentTo).toBe("d@example.com");
    expect(gateway.customers[0]!.email).toBe("d@example.com");
    expect(sent.map((m) => m.to)).toEqual(["a@example.com", "d@example.com"]);
  });

  it("a restore that fails is logged, never thrown: the winner's link is valid, so the loser still answers 'stale' (re-review finding 2) (mutation: let the restore's failure throw → the loser's action crashes, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.failOn = {
      op: "updateCustomerEmail", after: 2,
      error: Object.assign(new Error("An unknown error occurred"), { type: "StripeAPIError", statusCode: 500 }),
    };
    const { results } = await raceTwoSends();
    expect(results.map((r) => (r.ok ? "ok" : r.reason)).sort()).toEqual(["ok", "stale"]);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/could not put the customer's email back.*StripeAPIError/);
  });

  it("a blank reply-to is no header at all, through the house helper (mutation: pass it on truthiness → a header of spaces, FAILS)", async () => {
    expect((await sendBillingLink(deps({ replyTo: "   " }), INPUT)).ok).toBe(true);
    expect(sent[0]).not.toHaveProperty("replyTo");
  });

  it("refuses an account whose subscription is not ended, before ANY Stripe call (mutation: drop the guard → a second subscription can be bought, FAILS)", async () => {
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "past_due" }));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "already_subscribed" });
    expect(gateway.calls).toEqual([]);
  });

  it("a previous OPEN link is marked expired in the database FIRST, then expired at Stripe, and only then is a new session made; the save is conditional on that previous session (G2) (mutation: expire after creating the new one → two open sessions, FAILS; save unconditionally → FAILS)", async () => {
    const old = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds,
      successUrl: "https://x", cancelUrl: "https://y",
    }, "old-key");
    db.getBillingLink.mockResolvedValue(prevLink(old.id));
    gateway.calls.length = 0;
    const order: string[] = [];
    db.markBillingLinkExpired.mockImplementation(async () => { order.push("db:markExpired"); });
    const realExpire = gateway.expireCheckoutSession.bind(gateway);
    vi.spyOn(gateway, "expireCheckoutSession").mockImplementation(async (id: string) => {
      order.push("stripe:expire");
      return realExpire(id);
    });
    await sendBillingLink(deps(), INPUT);
    expect(gateway.calls.map((c) => c.op)).toEqual(["getCheckoutSessionStatus", "expireCheckoutSession", "createCheckoutSession"]);
    expect(db.markBillingLinkExpired).toHaveBeenCalledWith({}, ACCOUNT, old.id, NOW);
    expect(order).toEqual(["db:markExpired", "stripe:expire"]);
    expect(await gateway.getCheckoutSessionStatus(old.id)).toBe("expired");
    expect(db.saveBillingLink.mock.calls[0]![2]).toBe(old.id);
  });

  it("a deliberate resend of the SAME plan to the SAME address makes a NEW, OPEN session: each Send is its own request, so Stripe cannot replay the one it just expired (mutation: drop the per-Send request id from the checkout key → the expired session is replayed and emailed, FAILS)", async () => {
    await sendBillingLink(deps(), INPUT);
    const [first] = [...gateway.checkoutSessions.values()];
    // The first send's saved link is now the stored one, exactly as written.
    db.getBillingLink.mockResolvedValue({
      ...(db.saveBillingLink.mock.calls[0]![1] as object), sentAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    });
    const again = await sendBillingLink(deps(), INPUT);
    const sessions = [...gateway.checkoutSessions.values()];
    expect(sessions.map((s) => s.status)).toEqual(["expired", "open"]);
    expect(sessions[1]!.id).not.toBe(first!.id);
    expect(again).toEqual({ ok: true, url: sessions[1]!.url });
  });

  it("paid, then canceled, then the SAME plan re-sent to the SAME address inside Stripe's 24 h key window makes a NEW, OPEN session, never a replay of the paid one (review correction 1: a replayed paid session would be saved after its own subscription started, never consumed, and block Send for good) (mutation: key the session on its params and the previous link only, the plan's first shape → Stripe replays the completed session, FAILS)", async () => {
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    const [paid] = [...gateway.checkoutSessions.values()];
    paid!.status = "complete";
    // The webhook mirrored the subscription onto the stored customer and
    // consumed the link; later the subscription was canceled.
    db.getBillingLink.mockResolvedValue(null);
    db.getAccountBilling.mockResolvedValue(stored({
      stripeCustomerId: paid!.input.customerId, stripeSubscriptionId: "sub_paid", subscriptionStatus: "canceled",
    }));
    const again = await sendBillingLink(deps(), INPUT);
    const sessions = [...gateway.checkoutSessions.values()];
    expect(sessions.map((s) => s.status)).toEqual(["complete", "open"]);
    expect(again).toEqual({ ok: true, url: sessions[1]!.url });
    expect(gateway.customers).toHaveLength(1);
  });

  it("a Stripe server error on one Send never sticks to the next: every Send asks Stripe under fresh keys, so a failure Stripe saved under the first press's key (it replays a 500 for 24 h; assumption) is never asked for again (review correction 2) (mutation: drop the per-Send request id from the keys → the retry reuses the failed keys, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.failOn = {
      op: "createCheckoutSession",
      error: Object.assign(new Error("An unknown error occurred"), { type: "StripeAPIError", statusCode: 500 }),
    };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    gateway.failOn = null;
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    const keysOf = (op: string) => gateway.calls.filter((c) => c.op === op).map((c) => c.key);
    expect(keysOf("createCheckoutSession")).toHaveLength(2);
    expect(new Set(keysOf("createCheckoutSession")).size).toBe(2);
    expect(new Set(keysOf("createCustomer")).size).toBe(2);

    // The same with the customer REUSED (the billed one): nothing else in
    // the checkout's params changes between the two Sends.
    gateway = new FakeGateway();
    seedStoredCustomer();
    db.getAccountBilling.mockResolvedValue(stored({ subscriptionStatus: "canceled" }));
    gateway.failOn = {
      op: "createCheckoutSession",
      error: Object.assign(new Error("An unknown error occurred"), { type: "StripeAPIError", statusCode: 500 }),
    };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    gateway.failOn = null;
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(true);
    expect(keysOf("createCheckoutSession")).toHaveLength(2);
    expect(new Set(keysOf("createCheckoutSession")).size).toBe(2);
    log.mockRestore();
  });

  it("a previous link the client already COMPLETED stops the resend: the webhook is on its way (mutation: expire it anyway → the client paid a dead link and gets a second one, FAILS)", async () => {
    const done = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "done-key");
    gateway.checkoutSessions.get(done.id)!.status = "complete";
    db.getBillingLink.mockResolvedValue(prevLink(done.id));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "checkout_finished" });
    expect(gateway.checkoutSessions.size).toBe(1);
  });

  it("a lost save race: another tab's link won, so this one's session is expired and 'stale' returned; but a session the stored link ALREADY names is the live link, so it is never expired and no second email goes (mutation: never expire the loser → two open sessions, FAILS; expire without comparing to the stored link → the live link dies, FAILS)", async () => {
    db.saveBillingLink.mockResolvedValue(false);
    db.getBillingLink.mockResolvedValueOnce(null).mockResolvedValueOnce(prevLink("cs_other_tab"));
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stale" });
    expect([...gateway.checkoutSessions.values()][0]!.status).toBe("expired");
    expect(sent).toEqual([]);

    gateway = new FakeGateway();
    const mine = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_x", priceIds: PLAN.stripePriceIds,
      successUrl: "https://app.example/billing-done?result=success", cancelUrl: "https://app.example/billing-done?result=cancelled",
    }, "probe");
    db.getBillingLink.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(prevLink(mine.id));
    const replay = vi.spyOn(gateway, "createCheckoutSession").mockResolvedValue(mine);
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: true, url: mine.url });
    expect(sent).toEqual([]);
    expect(await gateway.getCheckoutSessionStatus(mine.id)).toBe("open");
    replay.mockRestore();
  });

  it("an email failure keeps the saved link and hands its URL back for Copy link (G18) (mutation: throw → the agency sees a crash and no link, FAILS)", async () => {
    emailError = new Error("smtp down");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await sendBillingLink(deps(), INPUT);
    expect(r).toEqual({ ok: false, reason: "email_failed", url: [...gateway.checkoutSessions.values()][0]!.url });
    expect(db.saveBillingLink).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("a Stripe refusal is 'stripe_failed' with nothing saved; a DATABASE failure among the Stripe steps (marking the old link expired, the one database write inside them) is not disguised as Stripe's, and leaves the old session open (mutation: catch every error as stripe_failed → FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.failOn = { op: "createCheckoutSession", error: Object.assign(new Error("card_declined"), { type: "StripeCardError" }) };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    expect(db.saveBillingLink).not.toHaveBeenCalled();
    gateway.failOn = null;
    // A failure BEFORE the Stripe steps (the reads) would be rethrown by any
    // catch, so it could not tell the two catches apart; this one is inside.
    const open = await gateway.createCheckoutSession({
      accountId: ACCOUNT, planId: PLAN.id, customerId: "cus_linked", priceIds: PLAN.stripePriceIds, successUrl: "https://x", cancelUrl: "https://y",
    }, "open-key");
    db.getBillingLink.mockResolvedValue(prevLink(open.id));
    db.markBillingLinkExpired.mockRejectedValue(new Error("markBillingLinkExpired failed: timeout"));
    await expect(sendBillingLink(deps(), INPUT)).rejects.toThrow(/markBillingLinkExpired failed/);
    expect(await gateway.getCheckoutSessionStatus(open.id)).toBe("open");
    log.mockRestore();
  });

  it("never logs the recipient's address: a Stripe or mail error that quotes it is logged as its class, code and a redacted message (review correction 4) (mutation: log the error's message whole → the address reaches the logs, FAILS)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    gateway.failOn = {
      op: "createCustomer",
      error: Object.assign(new Error("Invalid email address: owner@example.com"), {
        type: "StripeInvalidRequestError", code: "email_invalid", statusCode: 400,
      }),
    };
    expect(await sendBillingLink(deps(), INPUT)).toEqual({ ok: false, reason: "stripe_failed" });
    gateway.failOn = null;
    emailError = new Error("550 5.1.1 <Owner@Example.com>: recipient address rejected");
    expect((await sendBillingLink(deps(), INPUT)).ok).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    const logged = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toMatch(/owner@example\.com/i);
    expect(logged).toContain("StripeInvalidRequestError");
    expect(logged).toContain("email_invalid");
    expect(logged).toContain("recipient address rejected");
    expect(logged.match(/\[email\]/g)).toHaveLength(2);
    log.mockRestore();
  });

  it("loggableError cuts the message at 300 characters, AFTER redacting, so an address astride the cut never leaves a piece behind (mutation: drop the cut → FAILS; cut before redacting → 'owne' is logged, FAILS)", () => {
    const line = loggableError(Object.assign(new Error(`${"x".repeat(295)} owner@example.com and more`), { type: "StripeAPIError" }));
    expect(line.startsWith("StripeAPIError: ")).toBe(true);
    const message = line.slice("StripeAPIError: ".length);
    expect(message).toHaveLength(300);
    expect(message).toBe(`${"x".repeat(295)} [ema`);
  });

  it("loggableError redacts plus-addressed, dotted and hyphenated addresses whole (mutation: narrow the pattern to [\\w.-]+@ → 'owner+' is logged, FAILS)", () => {
    const line = loggableError(new Error("No such customer email: owner+billing@rio-roofing.example, cc first.last@x.co"));
    expect(line).toBe("Error: No such customer email: [email], cc [email]");
  });
});
