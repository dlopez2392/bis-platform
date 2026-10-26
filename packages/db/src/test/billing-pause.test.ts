import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  getAccountBilling, mirrorSubscription, readBillingStanding, pauseBilling, clearBillingPause, undoLiftBillingPause,
  listPauseCandidates, listBillingAlerts, listReconcilableAccounts, healPermissions,
} from "../account-billing";
import { saveReconciliation, latestReconciliations, reconciledSince, type ReconciliationWrite } from "../billing-reconciliations";

/**
 * M7a PR-4's data layer (Task 2) against a real PostgREST over 0099: the
 * standing read's embed, the compare-and-set pause writers, the mirror's
 * freshness stamp and pause clear, the candidate and alert reads, and the
 * reconciliation store per period. Accounts come from withTestAccount (their
 * account_billing and billing_reconciliations rows cascade with them); the
 * plan is agency-scoped, stamped with this run, and deleted after the
 * accounts, whose billing rows `restrict` the delete.
 *
 * BEFORE 0099 IS APPLIED (measured on a PG18 replica, 2026-10-26): every
 * case but the first is red, on PostgREST's unknown-column error for
 * pause_lifted_at (getAccountBilling's column list) or its unknown-table
 * error for billing_reconciliations. The first, readBillingStanding, reads
 * only 0051's columns and is legitimately green either side of the apply.
 */
const RUN = randomUUID().slice(0, 8);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
/** Distinguishable on purpose: a read that defaulted either flag would show. */
const FEATURES = { voice_receptionist: true, web_concierge: false };
const ZERO = { voice_minutes: 0, sms: 0, ai_chats: 0 };
const PRICE_IDS = { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" };

async function withPlan(fn: (planId: string) => Promise<void>): Promise<void> {
  const db = serviceDb();
  const { data: agency, error: agencyErr } = await db.from("agencies").select("id").limit(1).single();
  if (agencyErr) throw new Error(`agency read failed: ${agencyErr.message}`);
  const { data, error } = await db.from("plans").insert({
    agency_id: (agency as { id: string }).id, name: `Pause ${RUN} ${randomUUID().slice(0, 6)}`,
    monthly_price_cents: 4900, features: FEATURES, allowances: ZERO, overage_cents: ZERO,
    stripe_product_id: "prod_t_pause", stripe_price_ids: PRICE_IDS,
  }).select("id").single();
  if (error) throw new Error(`plan fixture refused: ${error.message}`);
  const id = (data as { id: string }).id;
  let bodyOk = false;
  try {
    await fn(id);
    bodyOk = true;
  } finally {
    // Thrown only when the body passed: a throw from finally would REPLACE
    // the primary failure (billing.test.ts's withPlans rule).
    const { error: e } = await db.from("plans").delete().eq("id", id);
    if (e) {
      const msg = `billing-pause.test cleanup failed on plans: ${e.message}`;
      if (bodyOk) throw new Error(msg);
      console.error(msg);
    }
  }
}

/** `n` throwaway accounts, each torn down by withTestAccount. */
function withAccounts(n: number, fn: (db: SupabaseClient, ids: string[]) => Promise<void>, ids: string[] = []): Promise<void> {
  if (ids.length === n) return fn(serviceDb(), ids);
  return withTestAccount((_db, id) => withAccounts(n, fn, [...ids, id]));
}

/** A billed row written straight to the table, so every column can be set. */
async function bill(db: SupabaseClient, accountId: string, planId: string, over: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db.from("account_billing").insert({
    account_id: accountId, plan_id: planId, stripe_customer_id: `cus_t_${randomUUID()}`,
    stripe_subscription_id: `sub_t_${randomUUID()}`, subscription_status: "active", ...over,
  });
  if (error) throw new Error(`billing fixture refused: ${error.message}`);
}

describe("M7a PR-4 data layer, live (0099)", () => {
  it("readBillingStanding reads the plan's features and the status through the embed for a PAID and a complimentary row, and null with no row (mutation: select plan_id only → FAILS)", () =>
    withPlan((planId) => withAccounts(4, async (db, [paid, paused, comp, none]) => {
      await bill(db, paid!, planId);
      const pausedAt = Date.now() - 2 * DAY;
      await bill(db, paused!, planId, { subscription_status: "past_due", past_due_since: iso(pausedAt - 7 * DAY), billing_paused_at: iso(pausedAt) });
      expect((await db.from("account_billing").insert({ account_id: comp, plan_id: planId, complimentary: true })).error).toBeNull();
      expect(await readBillingStanding(db, paid!)).toEqual({
        complimentary: false, pausedAt: null, subscriptionStatus: "active", features: FEATURES,
      });
      const p = await readBillingStanding(db, paused!);
      expect({ ...p, pausedAt: Date.parse(p!.pausedAt!) }).toEqual({
        complimentary: false, pausedAt, subscriptionStatus: "past_due", features: FEATURES,
      });
      expect(await readBillingStanding(db, comp!)).toEqual({
        complimentary: true, pausedAt: null, subscriptionStatus: null, features: FEATURES,
      });
      expect(await readBillingStanding(db, none!)).toBeNull();
    })));

  it("pauseBilling then clearBillingPause(lift) round-trip through PostgREST and each moves updated_at forward; the Undo restores the pause's own start (mutation: write `now` instead of nextVersion → FAILS when the stored updated_at is in the future)", () =>
    withPlan((planId) => withTestAccount(async (db, acct) => {
      // The stored version is a day AHEAD of this clock (another instance's
      // clock, or an earlier nextVersion bump): only nextVersion moves past it.
      await bill(db, acct, planId, {
        subscription_status: "past_due", past_due_since: iso(Date.now() - 9 * DAY), updated_at: iso(Date.now() + DAY),
      });
      const before = (await getAccountBilling(db, acct))!;
      const pausedNow = new Date();
      expect(await pauseBilling(db, { accountId: acct, expectedUpdatedAt: before.updatedAt, now: pausedNow })).toBe("paused");
      const paused = (await getAccountBilling(db, acct))!;
      expect(Date.parse(paused.billingPausedAt!)).toBe(pausedNow.getTime());
      expect(Date.parse(paused.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      // A second pause over the first is refused by the row itself.
      expect(await pauseBilling(db, { accountId: acct, expectedUpdatedAt: paused.updatedAt, now: new Date() })).toBe("conflict");

      const liftedNow = new Date(pausedNow.getTime() + 1000);
      expect(await clearBillingPause(db, { accountId: acct, expectedUpdatedAt: paused.updatedAt, now: liftedNow, lift: true })).toBe("cleared");
      const lifted = (await getAccountBilling(db, acct))!;
      expect(lifted.billingPausedAt).toBeNull();
      expect(Date.parse(lifted.pauseLiftedAt!)).toBe(liftedNow.getTime());
      expect(Date.parse(lifted.updatedAt)).toBeGreaterThan(Date.parse(paused.updatedAt));

      // The Undo, with the lift as the action holds it (…Z) against PostgREST's +00:00 text.
      expect(await undoLiftBillingPause(db, {
        accountId: acct, liftedAt: liftedNow.toISOString(), pausedAt: paused.billingPausedAt!, now: new Date(),
      })).toBe("repaused");
      const undone = (await getAccountBilling(db, acct))!;
      expect(Date.parse(undone.billingPausedAt!)).toBe(pausedNow.getTime());
      expect(undone.pauseLiftedAt).toBeNull();
      expect(Date.parse(undone.updatedAt)).toBeGreaterThan(Date.parse(lifted.updatedAt));
    })));

  it("a mirror write between the pass's read and its write makes pauseBilling a conflict; the mirror stamps stripe_checked_at, leaves a pause on a past_due re-read and clears it on a paid one (mutation: drop the updated_at filter → FAILS)", () =>
    withPlan((planId) => withTestAccount(async (db, acct) => {
      const customer = `cus_t_${randomUUID()}`;
      const sub = `sub_t_${randomUUID()}`;
      await bill(db, acct, planId, {
        stripe_customer_id: customer, stripe_subscription_id: sub, subscription_status: "past_due",
        past_due_since: iso(Date.now() - 9 * DAY), billing_started_at: iso(1_790_000_000_000),
      });
      const snapshot = (status: string) => ({
        id: sub, customerId: customer, status, accountId: acct, planId,
        currentPeriodStart: 1_790_000_000, currentPeriodEnd: 1_792_592_000, startedAt: 1_790_000_000, items: [],
      });
      const passRead = (await getAccountBilling(db, acct))!;
      expect(passRead.stripeCheckedAt).toBeNull();
      const mirrorAt = new Date();
      expect((await mirrorSubscription(db, async () => snapshot("past_due"), () => mirrorAt)).kind).toBe("written");
      expect(await pauseBilling(db, { accountId: acct, expectedUpdatedAt: passRead.updatedAt, now: new Date() })).toBe("conflict");
      const afterMirror = (await getAccountBilling(db, acct))!;
      expect(afterMirror.billingPausedAt).toBeNull();
      expect(Date.parse(afterMirror.stripeCheckedAt!)).toBe(mirrorAt.getTime());

      // Paused on the fresh version; a past_due re-read keeps the pause, a paid one clears it.
      expect(await pauseBilling(db, { accountId: acct, expectedUpdatedAt: afterMirror.updatedAt, now: new Date() })).toBe("paused");
      expect((await mirrorSubscription(db, async () => snapshot("unpaid"), () => new Date(Date.now() + 1000))).kind).toBe("written");
      expect((await getAccountBilling(db, acct))!.billingPausedAt).not.toBeNull();
      expect((await mirrorSubscription(db, async () => snapshot("active"), () => new Date(Date.now() + 2000))).kind).toBe("written");
      const paid = (await getAccountBilling(db, acct))!;
      expect(paid.billingPausedAt).toBeNull();
      expect(paid.pastDueSince).toBeNull();
    })));

  it("listPauseCandidates returns paused, past_due, unpaid and canceled rows and never a complimentary, subscription-less or healthy one (mutation: drop `.not('stripe_subscription_id', 'is', null)` → FAILS; dropping `.eq('complimentary', false)` cannot fail here, 0051's CHECKs keep a complimentary row unpaused and subscription-less, so the unit test pins that filter)", () =>
    withPlan((planId) => withAccounts(7, async (db, [active, pastDue, unpaid, canceled, pausedActive, noSub, comp]) => {
      await bill(db, active!, planId);
      await bill(db, pastDue!, planId, { subscription_status: "past_due", past_due_since: iso(Date.now() - DAY) });
      await bill(db, unpaid!, planId, { subscription_status: "unpaid", past_due_since: iso(Date.now() - 20 * DAY) });
      await bill(db, canceled!, planId, { subscription_status: "canceled" });
      await bill(db, pausedActive!, planId, { billing_paused_at: iso(Date.now() - DAY) });
      expect((await db.from("account_billing").insert({
        account_id: noSub, plan_id: planId, stripe_customer_id: `cus_t_${randomUUID()}`, billing_paused_at: iso(Date.now() - DAY),
      })).error).toBeNull();
      expect((await db.from("account_billing").insert({ account_id: comp, plan_id: planId, complimentary: true })).error).toBeNull();
      const ours = new Set([active, pastDue, unpaid, canceled, pausedActive, noSub, comp]);
      const got = (await listPauseCandidates(db)).filter((r) => ours.has(r.accountId)).map((r) => r.accountId).sort();
      expect(got).toEqual([pastDue, unpaid, canceled, pausedActive].sort());
    })));

  it("listReconcilableAccounts returns live subscriptions with a customer and never an ended, complimentary or customer-less one (mutation: drop the not-in status filter → FAILS)", () =>
    withPlan((planId) => withAccounts(6, async (db, [active, pastDue, canceled, expired, noCustomer, comp]) => {
      await bill(db, active!, planId);
      await bill(db, pastDue!, planId, { subscription_status: "past_due", past_due_since: iso(Date.now() - DAY) });
      await bill(db, canceled!, planId, { subscription_status: "canceled" });
      await bill(db, expired!, planId, { subscription_status: "incomplete_expired" });
      await bill(db, noCustomer!, planId, { stripe_customer_id: null });
      expect((await db.from("account_billing").insert({ account_id: comp, plan_id: planId, complimentary: true })).error).toBeNull();
      const ours = new Set([active, pastDue, canceled, expired, noCustomer, comp]);
      const got = (await listReconcilableAccounts(db)).filter((r) => ours.has(r.accountId)).map((r) => r.accountId).sort();
      expect(got).toEqual([active, pastDue].sort());
    })));

  it("listBillingAlerts names the account by accounts.name, and finds a closed-period mismatch saved tonight beside a matching current period (mutation: embed brand_name → FAILS)", () =>
    withPlan((planId) => withAccounts(2, async (db, [failing, mismatched]) => {
      // brand_name differs from name, so reading the wrong column shows.
      for (const id of [failing, mismatched]) {
        expect((await db.from("accounts").update({ brand_name: `Brand ${RUN}` }).eq("id", id!)).error).toBeNull();
      }
      const since = iso(Date.now() - 3 * DAY);
      await bill(db, failing!, planId, { subscription_status: "past_due", past_due_since: since });
      await bill(db, mismatched!, planId);
      const now = Date.now();
      const w = (windowStart: number, verdict: ReconciliationWrite["verdict"], checkedAt: number): ReconciliationWrite => ({
        accountId: mismatched!, meter: "sms", windowStart: iso(windowStart), windowEnd: iso(windowStart + 30 * DAY),
        bisSettled: 5, bisInFlight: 0, bisHeld: 0, stripeTotal: verdict === "match" ? 5 : 6, verdict, checkedAt: iso(checkedAt),
      });
      await saveReconciliation(db, w(now - 40 * DAY, "stripe_over", now - 1.5 * HOUR));
      await saveReconciliation(db, w(now - 10 * DAY, "match", now - HOUR));
      const alerts = (await listBillingAlerts(db, new Date(now), { enforced: true }))
        .filter((a) => a.accountId === failing || a.accountId === mismatched);
      expect(alerts.map((a) => ({ ...a, since: Date.parse(a.since) }))).toEqual([
        { accountId: failing, accountName: "Fixture Co", kind: "payment_failed", since: Date.parse(since) },
        { accountId: mismatched, accountName: "Fixture Co", kind: "usage_mismatch", since: now - 1.5 * HOUR },
      ]);
    })));

  it("saveReconciliation keeps two periods of one meter apart and replaces a period's own row; latestReconciliations and reconciledSince read them back (mutation: onConflict without window_start → FAILS: the closed period's row is overwritten)", () =>
    withTestAccount(async (db, acct) => {
      const now = Date.now();
      const closed = now - 40 * DAY;
      const current = now - 10 * DAY;
      const w = (windowStart: number, verdict: ReconciliationWrite["verdict"], checkedAt: number): ReconciliationWrite => ({
        accountId: acct, meter: "sms", windowStart: iso(windowStart), windowEnd: iso(windowStart + 30 * DAY),
        bisSettled: 12, bisInFlight: 1, bisHeld: 2, stripeTotal: 13.5, verdict, checkedAt: iso(checkedAt),
      });
      await saveReconciliation(db, w(closed, "stripe_over", now - 30 * HOUR));
      await saveReconciliation(db, w(current, "stripe_under", now - 3 * HOUR));
      await saveReconciliation(db, w(current, "match", now - HOUR));   // tonight's re-check of the current period
      const { data, error } = await db.from("billing_reconciliations")
        .select("window_start, verdict").eq("account_id", acct).order("window_start", { ascending: true });
      expect(error).toBeNull();
      expect((data as { window_start: string; verdict: string }[]).map((r) => [Date.parse(r.window_start), r.verdict]))
        .toEqual([[closed, "stripe_over"], [current, "match"]]);
      const latest = (await latestReconciliations(db, [acct], new Date(now))).get(`${acct}:sms`);
      expect(latest).toMatchObject({ verdict: "match", bisSettled: 12, bisInFlight: 1, bisHeld: 2, stripeTotal: 13.5 });
      expect(Date.parse(latest!.windowStart)).toBe(current);
      const seen = [...await reconciledSince(db, iso(now - 2 * HOUR))].filter((k) => k.startsWith(`${acct}:`));
      expect(seen).toEqual([`${acct}:sms:${current}`]);
    }));

  it("healPermissions rewrites accounts.permissions from the row's plan, and {} with no row (mutation: write the stored permissions back → FAILS)", () =>
    withPlan((planId) => withAccounts(2, async (db, [billed, unbilled]) => {
      await bill(db, billed!, planId);
      for (const id of [billed, unbilled]) {
        expect((await db.from("accounts").update({ permissions: { voice_receptionist: false, web_concierge: true } }).eq("id", id!)).error).toBeNull();
      }
      await healPermissions(db, billed!);
      await healPermissions(db, unbilled!);
      const { data, error } = await db.from("accounts").select("id, permissions").in("id", [billed!, unbilled!]);
      expect(error).toBeNull();
      const byId = new Map((data as { id: string; permissions: unknown }[]).map((r) => [r.id, r.permissions]));
      expect(byId.get(billed!)).toEqual(FEATURES);
      expect(byId.get(unbilled!)).toEqual({});
    })));
});
