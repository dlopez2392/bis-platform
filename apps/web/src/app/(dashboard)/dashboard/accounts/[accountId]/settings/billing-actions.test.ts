import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AccountBilling, BillingLink, Plan, SubscriptionSnapshot } from "@bis/db";
import type { CheckoutInput } from "@/lib/billing/stripe-gateway";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";
const REQ = "44444444-4444-4444-8444-444444444444";

/** reads: every `from()` on the service client; clients: every serviceDb()
 *  made; gateways: every billingGatewayFromEnv() built. None may happen
 *  before requireAgency() has let the caller through. */
const guard = vi.hoisted(() => ({ agency: true, reads: 0, clients: 0, gateways: 0 }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => { if (!guard.agency) throw new Error("NEXT_REDIRECT"); return { userId: "u_agency" }; },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example", "x-forwarded-proto": "https" }) }));

const dbm = vi.hoisted(() => ({
  account: null as { id: string; agency_id: string; timezone: string | null; name: string } | null,
  getPlan: vi.fn(), getAccountBilling: vi.fn(), getBillingLink: vi.fn(), getBranding: vi.fn(),
  markComplimentary: vi.fn(), unmarkComplimentary: vi.fn(), changeComplimentaryPlan: vi.fn(), mirrorSubscription: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getPlan: dbm.getPlan, getAccountBilling: dbm.getAccountBilling, getBillingLink: dbm.getBillingLink, getBranding: dbm.getBranding,
  markComplimentary: dbm.markComplimentary, unmarkComplimentary: dbm.unmarkComplimentary,
  changeComplimentaryPlan: dbm.changeComplimentaryPlan, mirrorSubscription: dbm.mirrorSubscription,
  serviceDb: () => {
    guard.clients += 1;
    return {
      tag: "service",
      from: () => {
        guard.reads += 1;
        // The account row carries the agency's PRIVATE label too, so a
        // mutation that passes accounts.name to the email has something to leak.
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: dbm.account, error: null }) };
        return chain;
      },
    };
  },
}));

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/billing/billing-link", async (importOriginal) => ({
  ...(await importOriginal<object>()), sendBillingLink: (...a: unknown[]) => sendMock(...a),
}));

const gw = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()), billingGatewayFromEnv: () => { guard.gateways += 1; return gw.value; },
}));
vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ isFake: true, send: vi.fn() }) }));

const actions = await import("./billing-actions");
const { FakeGateway } = await import("@/lib/billing/fake-gateway");
const { idempotencyKey } = await import("@/lib/billing/stripe-gateway");
const { m } = await import("@/lib/messages");

const plan = (id: string, over: Partial<Plan> = {}): Plan => ({
  id, agencyId: "ag", name: `Plan ${id.slice(0, 2)}`, monthlyPriceCents: 9900, currency: "usd",
  features: { voice_receptionist: false, web_concierge: true },
  allowances: { voice_minutes: 0, sms: 100, ai_chats: 50 }, overageCents: { voice_minutes: 0, sms: 3, ai_chats: 20 },
  stripeProductId: "prod_x", stripePriceIds: { base: `price_b_${id}`, voice_minutes: `price_v_${id}`, sms: `price_s_${id}`, ai_chats: `price_a_${id}` },
  archivedAt: null, createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
const billing = (over: Partial<AccountBilling> = {}): AccountBilling => ({
  accountId: ACCOUNT, planId: P1, complimentary: false, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1",
  subscriptionStatus: "active", currentPeriodStart: null, currentPeriodEnd: null, pastDueSince: null, billingPausedAt: null,
  billingStartedAt: "2026-09-01T00:00:00+00:00", createdAt: "2026-09-01T00:00:00+00:00", updatedAt: "2026-09-01T00:00:00+00:00", ...over,
});
/** A stored link whose OWN expiry has passed: the card shows no link and
 *  offers Mark complimentary. Send writes exactly this when it marks the
 *  link expired and its Stripe expire then fails (billing-link.ts). */
const deadLink = (sessionId = "cs_old"): BillingLink => ({
  accountId: ACCOUNT, planId: P1, stripeCustomerId: "cus_linked", checkoutSessionId: sessionId,
  checkoutUrl: `https://checkout.stripe.test/c/pay/${sessionId}`, sentTo: "owner@example.com",
  expiresAt: new Date(Date.now() - 60_000).toISOString(), sentAt: "2026-09-20T00:00:00+00:00", updatedAt: "2026-09-20T00:00:00+00:00",
});
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const stripeRefusal = (message: string) =>
  Object.assign(new Error(message), { type: "StripeInvalidRequestError", rawType: "invalid_request_error", statusCode: 400 });

let fake: InstanceType<typeof FakeGateway>;
/** Seeds "Stripe" with a Checkout session the stored link names. */
const seedSession = (id: string, status: "open" | "complete" | "expired") =>
  fake.checkoutSessions.set(id, { id, url: `https://checkout.stripe.test/c/pay/${id}`, expiresAt: 1, status, input: {} as CheckoutInput });

beforeEach(() => {
  guard.agency = true;
  guard.reads = 0;
  guard.clients = 0;
  guard.gateways = 0;
  dbm.account = { id: ACCOUNT, agency_id: "ag", timezone: "America/Chicago", name: "Rio Roofing — trial" };
  for (const f of [dbm.getPlan, dbm.getAccountBilling, dbm.getBillingLink, dbm.getBranding, dbm.markComplimentary,
    dbm.unmarkComplimentary, dbm.changeComplimentaryPlan, dbm.mirrorSubscription, sendMock]) f.mockReset();
  dbm.getPlan.mockImplementation(async (_db: unknown, id: string) => plan(id));
  dbm.getBranding.mockResolvedValue({ brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null });
  dbm.getBillingLink.mockResolvedValue(null);
  fake = new FakeGateway();
  gw.value = { ok: true, gateway: fake, live: false };
  vi.stubEnv("APP_ORIGIN", "https://app.example");
  vi.stubEnv("AGENCY_SUPPORT_EMAIL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the agency's billing actions", () => {
  it("every action runs requireAgency FIRST: a client (or a forged form post) gets no database client, reads nothing, builds no Stripe client and reaches no one (mutation: move requireAgency below any read → FAILS)", async () => {
    guard.agency = false;
    // allSettled, so no rejection is ever unhandled while the others run.
    const settled = await Promise.allSettled([
      actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" })),
      actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 })),
      actions.removeComplimentaryAction(ACCOUNT),
      actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ })),
    ]);
    expect(settled.map((s) => s.status === "rejected" && String((s.reason as Error).message))).toEqual(Array(4).fill("NEXT_REDIRECT"));
    expect({ reads: guard.reads, clients: guard.clients, gateways: guard.gateways }).toEqual({ reads: 0, clients: 0, gateways: 0 });
    const untouched = { getPlan: dbm.getPlan, getAccountBilling: dbm.getAccountBilling, getBillingLink: dbm.getBillingLink,
      getBranding: dbm.getBranding, markComplimentary: dbm.markComplimentary, unmarkComplimentary: dbm.unmarkComplimentary,
      changeComplimentaryPlan: dbm.changeComplimentaryPlan, mirrorSubscription: dbm.mirrorSubscription, sendBillingLink: sendMock };
    expect(Object.entries(untouched).filter(([, f]) => f.mock.calls.length > 0).map(([name]) => name)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("send: a bad plan id or email is refused before Stripe, and a plan of ANOTHER agency or an archived one is refused before sendBillingLink (G10) (mutation: skip the agency check → FAILS)", async () => {
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: "x", email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co, c@d.co" }))).toEqual({ ok: false, error: m["billing.error.email"] });
    dbm.getPlan.mockResolvedValueOnce(plan(P1, { agencyId: "other" }));
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    dbm.getPlan.mockResolvedValueOnce(plan(P1, { archivedAt: "2026-09-02T00:00:00Z" }));
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.plan"] });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("send: hands sendBillingLink the customer-facing brand name, the account's zone and APP_ORIGIN, and maps an email failure to its copy WITH the link (mutation: pass accounts.name → FAILS; drop the url → FAILS)", async () => {
    sendMock.mockResolvedValue({ ok: false, reason: "email_failed", url: "https://checkout.stripe.test/c/pay/cs_1" });
    const r = await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: " owner@example.com " }));
    expect(r).toEqual({ ok: false, error: m["billing.error.emailFailed"], url: "https://checkout.stripe.test/c/pay/cs_1" });
    const [deps, input] = sendMock.mock.calls[0]!;
    expect(deps).toMatchObject({ origin: "https://app.example", gateway: fake });
    expect(input).toEqual({ accountId: ACCOUNT, plan: plan(P1), email: "owner@example.com", businessName: "Rio Roofing", zone: "America/Chicago" });
  });

  it("send: the reply-to is AGENCY_SUPPORT_EMAIL trimmed, and with it unset or blank the same address the Website page's ask-us link falls back to, because the email promises 'reply and we'll send a new one' (G18) (mutation: drop normalizeReplyTo → the untrimmed value, FAILS; drop the fallback → no reply-to, FAILS)", async () => {
    sendMock.mockResolvedValue({ ok: true, url: "https://checkout.stripe.test/c/pay/cs_1" });
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "  billing@bis.example ");
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "owner@example.com" }))).toEqual({ ok: true });
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", "   ");
    await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "owner@example.com" }));
    vi.stubEnv("AGENCY_SUPPORT_EMAIL", undefined);
    await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "owner@example.com" }));
    expect(sendMock.mock.calls.map(([deps]) => (deps as { replyTo?: string }).replyTo))
      .toEqual(["billing@bis.example", "hello@bis-rgv.com", "hello@bis-rgv.com"]);
  });

  it("send: the recipient reaches sendBillingLink TRIMMED (it creates or updates the Stripe customer with the address exactly as passed), and an address that is not one valid address never reaches it (mutation: stop trimming the email → FAILS; drop the address check → FAILS; drop the length cap → FAILS)", async () => {
    sendMock.mockResolvedValue({ ok: true, url: "https://checkout.stripe.test/c/pay/cs_1" });
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: " \tOwner@Example.COM \n" }))).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect((sendMock.mock.calls[0]![1] as { email: string }).email).toBe("Owner@Example.COM");
    sendMock.mockClear();
    const invalid = ["", "   ", "owner", "owner@", "@example.com", "owner@example", "own er@example.com",
      "a@b.co;c@d.co", "a@b.co c@d.co", `${"a".repeat(250)}@b.co`];
    const refused = [];
    for (const email of invalid) refused.push(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email })));
    expect(refused).toEqual(invalid.map(() => ({ ok: false, error: m["billing.error.email"] })));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("send: no usable Stripe key → the no-Stripe copy, and nothing is called (mutation: skip the verdict → FAILS)", async () => {
    gw.value = { ok: false, reason: "missing" };
    expect(await actions.sendBillingLinkAction(ACCOUNT, form({ planId: P1, email: "a@b.co" }))).toEqual({ ok: false, error: m["billing.error.noStripe"] });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("mark complimentary is refused while a live billing link is out, and 'already on a plan' is said in words (G16) (mutation: drop the link check → a paid checkout could later overwrite it, FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue({ ...deadLink(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.stale"] });
    expect(dbm.markComplimentary).not.toHaveBeenCalled();
    dbm.getBillingLink.mockResolvedValue(null);
    dbm.markComplimentary.mockResolvedValue({ ok: false, reason: "already_billed" });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.alreadyBilled"] });
  });

  it("mark complimentary with NO link row needs no Stripe at all: marked without building a Stripe client, so it works with no key (mutation: build the gateway first and refuse without one → FAILS)", async () => {
    gw.value = { ok: false, reason: "missing" };
    dbm.markComplimentary.mockResolvedValue({ ok: true });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: true });
    expect(dbm.markComplimentary).toHaveBeenCalledWith({ tag: "service", from: expect.any(Function) }, expect.objectContaining({ accountId: ACCOUNT, planId: P1 }));
    expect(guard.gateways).toBe(0);
  });

  it("mark complimentary over a link the card shows as dead but whose session Stripe still holds OPEN (Send marked it expired, then its Stripe expire failed): the session is expired AT STRIPE FIRST, and only then is the account marked (correction 2) (mutation: skip the Stripe status check → the emailed session stays payable, FAILS; mark before expiring → FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue(deadLink("cs_old"));
    seedSession("cs_old", "open");
    const statusWhenMarked: string[] = [];
    dbm.markComplimentary.mockImplementation(async () => {
      statusWhenMarked.push(fake.checkoutSessions.get("cs_old")!.status);
      return { ok: true };
    });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: true });
    expect(statusWhenMarked).toEqual(["expired"]);
    expect(fake.calls.map((c) => c.op)).toEqual(["getCheckoutSessionStatus", "expireCheckoutSession"]);
  });

  it("mark complimentary over a dead link whose session Stripe says is COMPLETE (the client paid; the webhook is on its way or was refused) → 'already finished checkout', nothing expired, nothing marked (mutation: treat only open as blocking → a complimentary row over a paying client, FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue(deadLink("cs_paid"));
    seedSession("cs_paid", "complete");
    dbm.markComplimentary.mockResolvedValue({ ok: true });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.checkoutFinished"] });
    expect(dbm.markComplimentary).not.toHaveBeenCalled();
    expect(fake.calls.map((c) => c.op)).toEqual(["getCheckoutSessionStatus"]);
  });

  it("mark complimentary refuses, marking nothing, when Stripe will not confirm the old session is dead: the expire is refused (the client finished checkout between the read and the expire), the status read fails, or there is no usable key (mutation: carry on after a failed expire → FAILS; skip the check when the key is missing → FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue(deadLink("cs_old"));
    seedSession("cs_old", "open");
    dbm.markComplimentary.mockResolvedValue({ ok: true });
    fake.failOn = { op: "expireCheckoutSession", error: stripeRefusal("This Checkout Session is not open") };
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.stripeFailed"] });
    fake.failOn = { op: "getCheckoutSessionStatus", error: stripeRefusal("No such checkout.session: 'cs_old'") };
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.stripeFailed"] });
    fake.failOn = null;
    gw.value = { ok: false, reason: "missing" };
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: false, error: m["billing.error.noStripe"] });
    expect(dbm.markComplimentary).not.toHaveBeenCalled();
    expect(fake.checkoutSessions.get("cs_old")!.status).toBe("open");
  });

  it("mark complimentary over a dead link whose session Stripe already expired proceeds with no Stripe write (mutation: expire unconditionally → Stripe refuses a non-open session, FAILS)", async () => {
    dbm.getBillingLink.mockResolvedValue(deadLink("cs_gone"));
    seedSession("cs_gone", "expired");
    dbm.markComplimentary.mockResolvedValue({ ok: true });
    expect(await actions.markComplimentaryAction(ACCOUNT, form({ planId: P1 }))).toEqual({ ok: true });
    expect(fake.calls.map((c) => c.op)).toEqual(["getCheckoutSessionStatus"]);
  });

  it("change plan, complimentary: a database change only, never a Stripe call (mutation: route complimentary through Stripe → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing({ complimentary: true, stripeSubscriptionId: null, subscriptionStatus: null, stripeCustomerId: null }));
    dbm.changeComplimentaryPlan.mockResolvedValue({ ok: true });
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: true });
    expect(dbm.changeComplimentaryPlan).toHaveBeenCalledWith({ tag: "service", from: expect.any(Function) }, expect.objectContaining({ accountId: ACCOUNT, planId: P2, expectedPlanId: P1 }));
    expect(fake.calls).toEqual([]);
  });

  it("change plan, paid: swaps each item in place under a key over the request id AND the change, then mirrors the subscription RE-READ from Stripe after the change (G15) (mutation: mirror the pre-change snapshot → the old plan is written back, FAILS; mirror before the update → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing());
    const sub: SubscriptionSnapshot = {
      id: "sub_1", customerId: "cus_1", status: "active", accountId: ACCOUNT, planId: P1,
      currentPeriodStart: 1, currentPeriodEnd: 2, startedAt: 1,
      items: (["base", "voice_minutes", "sms", "ai_chats"] as const).map((k) => ({ id: `si_${k}`, priceId: `price_${k}_old`, priceKey: k, planId: P1 })),
    };
    fake.subscriptions.set("sub_1", sub);
    // The mirror is handed a READER (B5). It reads when the MIRROR runs, so
    // what it sees there is what Stripe holds at that moment.
    const readByMirror: Array<string | null> = [];
    dbm.mirrorSubscription.mockImplementation(async (_db: unknown, read: () => Promise<SubscriptionSnapshot>) => {
      readByMirror.push((await read()).planId);
      return { kind: "written", accountId: ACCOUNT, planId: P2, status: "active" };
    });
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: true });
    const change = {
      subscriptionId: "sub_1", planId: P2,
      items: [
        { id: "si_base", price: `price_b_${P2}` }, { id: "si_voice_minutes", price: `price_v_${P2}` },
        { id: "si_sms", price: `price_s_${P2}` }, { id: "si_ai_chats", price: `price_a_${P2}` },
      ],
    };
    expect(fake.subscriptionChanges).toEqual([{ change, key: idempotencyKey("bis-subchange", REQ, change) }]);
    expect(readByMirror).toEqual([P2]);
    expect(dbm.mirrorSubscription).toHaveBeenCalledWith({ tag: "service", from: expect.any(Function) }, expect.any(Function), expect.any(Function));
  });

  it("change plan refuses, before any Stripe call, a paid row whose subscription is `incomplete` (Stripe may refuse item updates before the first payment, G15), ended, or missing (mutation: drop the incomplete check → FAILS; drop the ended check → FAILS)", async () => {
    for (const over of [{ subscriptionStatus: "incomplete" as const }, { subscriptionStatus: "canceled" as const },
      { subscriptionStatus: "incomplete_expired" as const }, { stripeSubscriptionId: null }]) {
      dbm.getAccountBilling.mockResolvedValueOnce(billing(over));
      expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: false, error: m["billing.error.stale"] });
    }
    expect(fake.calls).toEqual([]);
    expect(dbm.mirrorSubscription).not.toHaveBeenCalled();
  });

  it("stop complimentary: ok when a complimentary row was removed, 'something changed' when there was none to remove (a paid row is never touched: unmarkComplimentary filters on complimentary) (mutation: answer ok whatever unmarkComplimentary says → FAILS)", async () => {
    dbm.unmarkComplimentary.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await actions.removeComplimentaryAction(ACCOUNT)).toEqual({ ok: true });
    expect(await actions.removeComplimentaryAction(ACCOUNT)).toEqual({ ok: false, error: m["billing.error.stale"] });
    expect(dbm.unmarkComplimentary.mock.calls).toEqual([
      [{ tag: "service", from: expect.any(Function) }, ACCOUNT], [{ tag: "service", from: expect.any(Function) }, ACCOUNT],
    ]);
  });

  it("change plan refuses a stale screen (the plan it saw is no longer the account's) before any Stripe call (mutation: drop the expectedPlanId check → FAILS)", async () => {
    dbm.getAccountBilling.mockResolvedValue(billing({ planId: P2 }));
    expect(await actions.changePlanAction(ACCOUNT, form({ planId: P2, expectedPlanId: P1, requestId: REQ }))).toEqual({ ok: false, error: m["billing.error.stale"] });
    expect(fake.calls).toEqual([]);
  });
});
