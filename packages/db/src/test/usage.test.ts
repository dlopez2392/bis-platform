import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { insertPlan, type PlanWrite } from "../billing";
import {
  recordUsage, listBilledUsageAccounts, listReportableUsage, markUsageReported,
  countExpiredUsage, listAccountsWithStaleUsage,
} from "../usage";

/**
 * usage.ts, live through serviceDb(). Accounts come from withTestAccount
 * (their usage_events and account_billing rows cascade with them). A billed
 * account needs a plan (account_billing.plan_id is NOT NULL); plans are
 * AGENCY-scoped, so each is stamped with this run and deleted after the
 * accounts, whose billing rows `restrict` the delete.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const PLAN: PlanWrite = {
  terms: {
    name: "placeholder", monthlyPriceCents: 4900,
    features: { voice_receptionist: true, web_concierge: true },
    allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
    overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  },
  stripeProductId: "prod_t_usage",
  stripePriceIds: { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" },
};

async function withPlan(fn: (planId: string) => Promise<void>): Promise<void> {
  const id = randomUUID();
  const r = await insertPlan(serviceDb(), { id, ...PLAN, terms: { ...PLAN.terms, name: `Usage ${RUN} ${id.slice(0, 8)}` } });
  if (!r.ok) throw new Error(`usage.test plan fixture refused: ${r.reason}`);
  let bodyOk = false;
  try {
    await fn(id);
    bodyOk = true;
  } finally {
    // Thrown only when the body passed: a throw from finally would REPLACE
    // the primary failure (billing.test.ts's withPlans rule).
    const { error } = await serviceDb().from("plans").delete().eq("id", id);
    if (error) {
      const msg = `usage.test cleanup failed on plans: ${error.message}`;
      if (bodyOk) throw new Error(msg);
      console.error(msg);
    }
  }
}

/** A billed account: a Stripe customer AND a subscription. */
async function bill(accountId: string, planId: string, startedAtMs: number): Promise<string> {
  const customer = `cus_t_${randomUUID()}`;
  const { error } = await serviceDb().from("account_billing").insert({
    account_id: accountId, plan_id: planId, stripe_customer_id: customer,
    stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active",
    created_at: iso(startedAtMs),
  });
  if (error) throw new Error(`usage.test billing fixture refused: ${error.message}`);
  return customer;
}

/** A ledger row written straight to the table, so created_at and reported_at can be set. */
async function usageRow(
  accountId: string, at: { occurredAt: number; createdAt?: number; reportedAt?: number },
): Promise<string> {
  const { data, error } = await serviceDb().from("usage_events").insert({
    account_id: accountId, meter: "sms", quantity: 1,
    occurred_at: iso(at.occurredAt), source_ref: `message:${randomUUID()}`,
    ...(at.createdAt === undefined ? {} : { created_at: iso(at.createdAt) }),
    ...(at.reportedAt === undefined ? {} : { reported_at: iso(at.reportedAt) }),
  }).select("id").single();
  if (error || !data) throw new Error(`usage.test usage fixture refused: ${error?.message ?? "no row"}`);
  return (data as { id: string }).id;
}

describe("usage.ts, live", () => {
  it("recordUsage stores the fact exactly as given and says 'recorded' (mutation: write occurred_at from the clock instead of input.occurredAt → FAILS)", () =>
    withTestAccount(async (db, acct) => {
      const sourceRef = `call:${randomUUID()}`;
      const occurredAt = new Date(Date.now() - 3 * DAY);
      expect(await recordUsage(db, { accountId: acct, meter: "voice_minutes", quantity: 4, occurredAt, sourceRef })).toBe("recorded");
      const { data, error } = await db.from("usage_events")
        .select("account_id, meter, quantity, occurred_at, reported_at").eq("source_ref", sourceRef);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      const row = data![0] as { account_id: string; meter: string; quantity: number; occurred_at: string; reported_at: string | null };
      expect({ ...row, occurred_at: Date.parse(row.occurred_at) }).toEqual({
        account_id: acct, meter: "voice_minutes", quantity: 4, occurred_at: occurredAt.getTime(), reported_at: null,
      });
    }));

  it("recordUsage a second time for the same source is 'duplicate' and changes nothing: one row, the first quantity (mutation: drop ignoreDuplicates → the upsert UPDATES quantity to 9, FAILS)", () =>
    withTestAccount(async (db, acct) => {
      const input = { accountId: acct, meter: "sms" as const, quantity: 2, occurredAt: new Date(), sourceRef: `message:${randomUUID()}` };
      expect(await recordUsage(db, input)).toBe("recorded");
      expect(await recordUsage(db, { ...input, quantity: 9 })).toBe("duplicate");
      const { data, error } = await db.from("usage_events").select("quantity").eq("source_ref", input.sourceRef);
      expect(error).toBeNull();
      expect(data).toEqual([{ quantity: 2 }]);
    }));

  it("listBilledUsageAccounts returns accounts with a Stripe customer AND subscription, with the billing start; complimentary, link-only and customer-less rows are left out (mutation: drop the subscription filter → FAILS; drop the customer filter → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, billed) => withTestAccount((_d1, comp) => withTestAccount((_d2, linkOnly) =>
      withTestAccount(async (_d3, subOnly) => {
        const started = Date.now() - 5 * DAY;
        const customer = await bill(billed, planId, started);
        expect((await db.from("account_billing").insert({ account_id: comp, plan_id: planId, complimentary: true })).error).toBeNull();
        expect((await db.from("account_billing").insert({
          account_id: linkOnly, plan_id: planId, stripe_customer_id: `cus_t_${randomUUID()}`,
        })).error).toBeNull();
        expect((await db.from("account_billing").insert({
          account_id: subOnly, plan_id: planId, stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active",
        })).error).toBeNull();
        const ours = (await listBilledUsageAccounts(db)).filter((a) => [billed, comp, linkOnly, subOnly].includes(a.accountId));
        expect(ours.map((a) => ({ ...a, billingStartedAt: Date.parse(a.billingStartedAt) }))).toEqual([
          { accountId: billed, stripeCustomerId: customer, billingStartedAt: started },
        ]);
      }))))));

  it("listReportableUsage: the unreported rows of the accounts given, each from ITS OWN floor (billing start, or now − 34 days), oldest first ACROSS them, at most `limit`; PostgREST's own microsecond timestamps survive the quoted filter (mutation: drop .is('reported_at', null) → FAILS; one shared floor for both accounts → the pre-billing row appears, FAILS; order descending → FAILS). The quoting itself is defence-in-depth, not something this read can prove red: supabase-js percent-encodes '+' before PostgREST ever sees it, so an unquoted timestamp parses identically here — see usage.ts's usageRangeFilter doc.", () =>
    withPlan((planId) => withTestAccount((db, a) => withTestAccount((_d1, b) => withTestAccount(async (_d2, unbilled) => {
      const now = Date.now();
      await bill(a, planId, now - 5 * DAY);
      await bill(b, planId, now - 60 * DAY);
      await usageRow(a, { occurredAt: now - 6 * DAY });                     // before A's billing start
      const a1 = await usageRow(a, { occurredAt: now - 3 * HOUR });
      await usageRow(a, { occurredAt: now - 1 * HOUR, reportedAt: now });   // already reported
      await usageRow(b, { occurredAt: now - 40 * DAY });                    // older than the window
      const b1 = await usageRow(b, { occurredAt: now - 6 * DAY });           // A's floor would exclude it
      const a2 = await usageRow(a, { occurredAt: now - 2 * HOUR });
      await usageRow(unbilled, { occurredAt: now - 2.5 * HOUR });            // not an account given
      const ours = (await listBilledUsageAccounts(db)).filter((x) => [a, b].includes(x.accountId));
      expect(ours).toHaveLength(2);
      const rows = await listReportableUsage(db, ours, new Date(now), 10);
      expect(rows.map((r) => r.id)).toEqual([b1, a1, a2]);
      expect(rows[1]).toMatchObject({ accountId: a, meter: "sms", quantity: 1, reportedAt: null });
      expect((await listReportableUsage(db, ours, new Date(now), 1)).map((r) => r.id)).toEqual([b1]);
    })))));

  it("listReportableUsage excludes a row dated more than 5 minutes in the future — Stripe accepts a meter event up to 5 minutes ahead of its own clock and silently drops one further out, so a too-future row must stay unreported rather than be sent and stamped (mutation: drop the upper bound on the filter → the far-future row is returned too, FAILS)", () =>
    withPlan((planId) => withTestAccount(async (db, a) => {
      const now = Date.now();
      await bill(a, planId, now - 5 * DAY);
      const past = await usageRow(a, { occurredAt: now - 3 * HOUR });
      const inGrace = await usageRow(a, { occurredAt: now + 3 * 60 * 1000 });   // 3 min ahead: within grace
      await usageRow(a, { occurredAt: now + 10 * 60 * 1000 });                  // 10 min ahead: excluded
      const account = (await listBilledUsageAccounts(db)).find((x) => x.accountId === a)!;
      const rows = await listReportableUsage(db, [account], new Date(now), 10);
      expect(rows.map((r) => r.id)).toEqual([past, inGrace]);
    })));

  it("markUsageReported stamps reported_at and updated_at once, then reports false (mutation: drop .is('reported_at', null) → the second call returns true, FAILS)", () =>
    withTestAccount(async (db, a) => {
      const id = await usageRow(a, { occurredAt: Date.now() - HOUR });
      const at = new Date(Date.now() - 1000);
      expect(await markUsageReported(db, id, at)).toBe(true);
      expect(await markUsageReported(db, id, new Date())).toBe(false);
      const { data, error } = await db.from("usage_events").select("reported_at, updated_at").eq("id", id).single();
      expect(error).toBeNull();
      const row = data as { reported_at: string; updated_at: string };
      expect(Date.parse(row.reported_at)).toBe(at.getTime());
      expect(Date.parse(row.updated_at)).toBe(at.getTime());
    }));

  it("countExpiredUsage counts only unreported rows between an account's billing start and now − 34 days, and only for accounts billed before that floor (mutation: drop the billing-start bound → the pre-billing row counts, FAILS; drop the window's upper bound → the in-window row counts, FAILS; drop the reported filter → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, old) => withTestAccount(async (_d, recent) => {
      const now = Date.now();
      await bill(old, planId, now - 60 * DAY);
      await bill(recent, planId, now - 5 * DAY);
      await usageRow(old, { occurredAt: now - 40 * DAY });                    // expired: counted
      await usageRow(old, { occurredAt: now - 70 * DAY });                    // before billing: never billable
      await usageRow(old, { occurredAt: now - 2 * DAY });                     // inside the window
      await usageRow(old, { occurredAt: now - 40 * DAY, reportedAt: now });   // reported in time
      await usageRow(recent, { occurredAt: now - 40 * DAY });                 // before ITS billing start
      const ours = (await listBilledUsageAccounts(db)).filter((x) => [old, recent].includes(x.accountId));
      expect(ours).toHaveLength(2);
      expect(await countExpiredUsage(db, ours, new Date(now))).toBe(1);
    }))));

  it("listAccountsWithStaleUsage names a billed account whose reportable row has waited over a day since it was RECORDED; not one whose old row predates billing, nor one whose old event was recorded an hour ago (mutation: drop the billing-start floor → FAILS; test occurred_at instead of created_at → FAILS)", () =>
    withPlan((planId) => withTestAccount((db, stale) => withTestAccount((_d1, preBilling) => withTestAccount(async (_d2, lateRecorded) => {
      const now = Date.now();
      await bill(stale, planId, now - 10 * DAY);
      await usageRow(stale, { occurredAt: now - 25 * HOUR, createdAt: now - 25 * HOUR });
      await bill(preBilling, planId, now - HOUR);
      await usageRow(preBilling, { occurredAt: now - 25 * HOUR, createdAt: now - 25 * HOUR });
      await bill(lateRecorded, planId, now - 10 * DAY);
      await usageRow(lateRecorded, { occurredAt: now - 30 * HOUR, createdAt: now - HOUR });
      const ids = await listAccountsWithStaleUsage(db, new Date());
      expect(ids).toContain(stale);
      expect(ids).not.toContain(preBilling);
      expect(ids).not.toContain(lateRecorded);
    })))));
});
