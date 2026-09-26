import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  mirrorSubscription, markComplimentary, unmarkComplimentary, claimWebhookEvent, markWebhookEventProcessed,
  getAccountBilling, saveBillingLink, getBillingLink,
} from "../account-billing";
import { sumUsageSince } from "../usage";

/**
 * The billing writers against the CI project: the rows, the permissions
 * write and the link's consumption as Postgres really stores them. CI only.
 */
const RUN = randomUUID().slice(0, 8);
const FEATURES = { voice_receptionist: true, web_concierge: true };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };
const PRICE_IDS = { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" };

async function withPlan(fn: (planId: string) => Promise<void>): Promise<void> {
  const db = serviceDb();
  const { data: agency } = await db.from("agencies").select("id").limit(1).single();
  const { data, error } = await db.from("plans").insert({
    agency_id: (agency as { id: string }).id, name: `AcctBilling ${RUN} ${randomUUID().slice(0, 6)}`,
    monthly_price_cents: 4900, features: FEATURES, allowances: ZERO, overage_cents: ZERO,
    stripe_product_id: "prod_t_ab", stripe_price_ids: PRICE_IDS,
  }).select("id").single();
  if (error) throw new Error(`plan fixture refused: ${error.message}`);
  const id = (data as { id: string }).id;
  let bodyOk = false;
  try {
    await fn(id);
    bodyOk = true;
  } finally {
    const { error: e } = await db.from("plans").delete().eq("id", id);
    if (e) {
      const msg = `account-billing.test cleanup failed on plans: ${e.message}`;
      if (bodyOk) throw new Error(msg);
      console.error(msg);
    }
  }
}

describe("billing writers, live", () => {
  it("mirrorSubscription stores the subscription, writes the plan's features to accounts.permissions and consumes the link; a replay changes nothing but updated_at, through the compare-and-set on PostgREST's own updated_at text (mutation: skip the permissions write → FAILS; skip the link delete → FAILS; move billing_started_at on replay → FAILS; a version filter that never matches the stored text → the replay THROWS after MIRROR_ATTEMPTS, FAILS)", () =>
    withPlan((planId) => withTestAccount(async (db, accountId) => {
      const customer = `cus_t_${randomUUID()}`;
      expect(await saveBillingLink(db, {
        accountId, planId, stripeCustomerId: customer, checkoutSessionId: `cs_test_${RUN}`,
        checkoutUrl: "https://checkout.stripe.com/c/pay/x", sentTo: "owner@example.com",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }, null, new Date())).toBe(true);
      const snapshot = {
        id: `sub_t_${randomUUID()}`, customerId: customer, status: "active", accountId, planId,
        currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000, startedAt: 1_790_000_000, items: [],
      };
      expect((await mirrorSubscription(db, async () => snapshot, () => new Date())).kind).toBe("written");
      const first = await getAccountBilling(db, accountId);
      expect(first).toMatchObject({
        planId, complimentary: false, stripeCustomerId: customer, stripeSubscriptionId: snapshot.id,
        subscriptionStatus: "active", pastDueSince: null,
      });
      expect(Date.parse(first!.billingStartedAt)).toBe(1_790_000_000_000);
      expect(Date.parse(first!.currentPeriodStart!)).toBe(1_790_000_000_000);
      const { data: acct } = await db.from("accounts").select("permissions").eq("id", accountId).single();
      expect((acct as { permissions: unknown }).permissions).toEqual(FEATURES);
      expect(await getBillingLink(db, accountId)).toBeNull();
      expect((await mirrorSubscription(db, async () => snapshot, () => new Date(Date.now() + 1000))).kind).toBe("written");
      const second = await getAccountBilling(db, accountId);
      expect(second!.billingStartedAt).toBe(first!.billingStartedAt);
      expect(Date.parse(second!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
    })));

  it("markComplimentary stores a complimentary row with the plan's features; a second mark is already_billed; unmark deletes it and resets permissions to {} (mutation: unmark leaves permissions → FAILS; drop the complimentary filter on the delete → FAILS on the paid-row case)", () =>
    withPlan((planId) => withTestAccount(async (db, accountId) => {
      expect(await markComplimentary(db, { accountId, planId, now: new Date() })).toEqual({ ok: true });
      expect(await markComplimentary(db, { accountId, planId, now: new Date() })).toEqual({ ok: false, reason: "already_billed" });
      expect(await getAccountBilling(db, accountId)).toMatchObject({ complimentary: true, stripeSubscriptionId: null });
      expect(await unmarkComplimentary(db, accountId)).toBe(true);
      expect(await getAccountBilling(db, accountId)).toBeNull();
      const { data: acct } = await db.from("accounts").select("permissions").eq("id", accountId).single();
      expect((acct as { permissions: unknown }).permissions).toEqual({});
      expect(await unmarkComplimentary(db, accountId)).toBe(false);
    })));

  it("claimWebhookEvent: new, then retry while unprocessed, then done once stamped (mutation: claim via plain insert → the second claim THROWS 23505, FAILS; treat every stored row as done → the second claim reads 'done', FAILS)", async () => {
    const db = serviceDb();
    const id = `evt_t_${randomUUID()}`;
    try {
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("new");
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("retry");
      await markWebhookEventProcessed(db, id, new Date());
      expect(await claimWebhookEvent(db, id, "invoice.paid")).toBe("done");
    } finally {
      await db.from("stripe_webhook_events").delete().eq("event_id", id);
    }
  });

  it("sumUsageSince counts only this account's rows on or after the instant (mutation: gt instead of gte → the boundary row is lost, FAILS; drop the account filter → the other account's row counts, FAILS)", () =>
    withTestAccount((db, a) => withTestAccount(async (_d, b) => {
      const at = "2026-10-01T00:00:00.000Z";
      const rows = [
        { account_id: a, meter: "sms", quantity: 2, occurred_at: at, source_ref: `message:${randomUUID()}` },
        { account_id: a, meter: "voice_minutes", quantity: 5, occurred_at: "2026-10-03T00:00:00.000Z", source_ref: `call:${randomUUID()}` },
        { account_id: a, meter: "sms", quantity: 9, occurred_at: "2026-09-30T23:59:59.000Z", source_ref: `message:${randomUUID()}` },
        { account_id: b, meter: "sms", quantity: 7, occurred_at: "2026-10-02T00:00:00.000Z", source_ref: `message:${randomUUID()}` },
      ];
      expect((await db.from("usage_events").insert(rows)).error).toBeNull();
      expect(await sumUsageSince(db, a, at)).toEqual({ voice_minutes: 5, sms: 2, ai_chats: 0 });
    })));
});
