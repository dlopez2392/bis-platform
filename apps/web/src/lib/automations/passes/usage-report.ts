import {
  listBilledUsageAccounts, listReportableUsage, markUsageReported, countExpiredUsage, staleUsageAccountIds,
} from "@bis/db";
import { billingGatewayFromEnv, meterEventFailureKind } from "@/lib/billing/stripe-gateway";
import { METERS } from "@/lib/billing/stripe-catalog";
import { USAGE_REPORT_BUDGET_MS, USAGE_REPORT_TICK_CAP, METER_EVENT_WORST_CASE_MS } from "../caps";
import type { Pass } from "../context";

/**
 * The Stripe idempotency key for one usage row's meter event. It covers
 * every parameter the request sends: event name, value and timestamp are
 * functions of the row, which never changes after it is recorded
 * (recordUsage never updates), and the customer is the only thing that can
 * differ between two sends of the same row.
 */
export function usageIdempotencyKey(rowId: string, customerId: string): string {
  return `bis-usage-${rowId}-${customerId}`;
}

/**
 * Client billing: usage rows → Stripe Billing Meter events (spec section 3
 * flow 3, section 4 "usage reporting failure"). Not a recipe; it sends
 * nothing to a customer. LAST in the registry: every SMS-sending pass runs
 * before it, so a text sent this tick is reported this tick.
 *
 * Per tick, every read bounded (never one per account):
 *   1. The billed accounts (a Stripe customer AND subscription). None → done;
 *      production is in that state until the first client subscribes.
 *   2. Bookkeeping, whether or not Stripe is reachable: stale accounts
 *      (usage unreported for over a day) and expired rows (too old for
 *      Stripe to accept), one read per 50 billed accounts each, logged. The
 *      agency banner reads the same `staleUsageAccountIds`.
 *   3. No usable Stripe key → `skippedNoStripe`, logged, done. Not an error.
 *   4. The OLDEST unreported rows across every billed account, one meter
 *      event each, identifier = row id; reported_at stamped only after
 *      Stripe accepted. A refusal that is the row's (A13) is `failed`, and
 *      that ACCOUNT's other rows wait for the next tick; if the read was
 *      full, the pass reads again without the refused accounts, so their
 *      rows never fill the cap ahead of everyone else's. Any other failure
 *      stops the tick (the next row would fail the same way).
 *
 * A stamp that fails after Stripe accepted is `unstamped`: the next tick
 * resends the same row under the same identifier AND the same key, and
 * Stripe's idempotent replay keeps one event (A10). Identifier dedupe
 * across keys (A11) is NOT relied on. "reported" means Stripe RECEIVED the
 * event: it validates asynchronously (A12), and PR-4's nightly
 * reconciliation is the backstop.
 *
 * Every @bis/db export is dereferenced inside run(), never at module scope
 * (the cron route test's bare mock throws on a dereference).
 */
export const usageReportPass: Pass = {
  key: "usageReport",
  async run(ctx) {
    const c = {
      reported: 0, unstamped: 0, alreadyStamped: 0, failed: 0, expired: 0, staleAccounts: 0,
      skippedNoStripe: 0, stoppedOnCap: 0, stoppedOnError: 0, stoppedOnBudget: 0,
    };
    const accounts = await listBilledUsageAccounts(ctx.db);
    if (accounts.length === 0) return c;

    const stale = await staleUsageAccountIds(ctx.db, accounts, ctx.now);
    c.staleAccounts = stale.length;
    if (stale.length > 0) {
      console.error(`usage report: usage unreported for over 24 hours on ${stale.length} billed account(s): ${stale.join(", ")}`);
    }
    c.expired = await countExpiredUsage(ctx.db, accounts, ctx.now);
    if (c.expired > 0) {
      console.error(
        `usage report: ${c.expired} unreported usage row(s) of billed accounts are older than Stripe accepts (34 days); they will never be billed`,
      );
    }

    const built = billingGatewayFromEnv();
    if (!built.ok) {
      c.skippedNoStripe = accounts.length;
      console.error(`usage report: Stripe is not usable here (${built.reason}); ${accounts.length} billed account(s) not reported this tick`);
      return c;
    }
    const gateway = built.gateway;
    const customerOf = new Map(accounts.map((a) => [a.accountId, a.stripeCustomerId]));

    // The last moment a send may START: the installed stripe SDK's transport
    // can run a send about METER_EVENT_WORST_CASE_MS past its start (a
    // socket-idle timeout retried once on a reset connection, per
    // stripe-gateway.ts's comments), so stopping this early keeps one
    // started by then inside the budget.
    const lastStartMs = USAGE_REPORT_BUDGET_MS - METER_EVENT_WORST_CASE_MS;
    const startedAt = Date.now();
    const refused = new Set<string>();
    let attempts = 0;
    let stop = false;
    while (!stop && attempts < USAGE_REPORT_TICK_CAP) {
      const want = USAGE_REPORT_TICK_CAP - attempts;
      const rows = await listReportableUsage(ctx.db, accounts.filter((a) => !refused.has(a.accountId)), ctx.now, want);
      let refusedHere = false;
      for (const row of rows) {
        if (refused.has(row.accountId)) continue;
        if (Date.now() - startedAt >= lastStartMs) {
          c.stoppedOnBudget = 1;
          console.error(`usage report: budget spent after ${attempts} send(s); the rest go next tick`);
          stop = true;
          break;
        }
        attempts++;
        const customerId = customerOf.get(row.accountId)!;
        try {
          await gateway.reportMeterEvent({
            eventName: METERS[row.meter].eventName, customerId,
            value: row.quantity, identifier: row.id,
            timestampSeconds: Math.floor(Date.parse(row.occurredAt) / 1000),
          }, usageIdempotencyKey(row.id, customerId));
        } catch (e) {
          c.failed++;
          if (meterEventFailureKind(e) === "row") {
            refused.add(row.accountId);
            refusedHere = true;
            console.error(
              `usage report: Stripe refused usage row ${row.id}; account ${row.accountId}'s other rows wait for the next tick: ${String(e)}`,
            );
            continue;
          }
          c.stoppedOnError = 1;
          console.error(`usage report: stopped for this tick after a Stripe failure on usage row ${row.id}: ${String(e)}`);
          stop = true;
          break;
        }
        try {
          if (await markUsageReported(ctx.db, row.id, ctx.now)) {
            c.reported++;
          } else {
            c.alreadyStamped++;
            console.error(`usage report: usage row ${row.id} was already marked reported (a concurrent tick); not counted here`);
          }
        } catch (e) {
          c.unstamped++;
          console.error(
            `usage report: Stripe has usage row ${row.id} but it was not marked reported; the next tick resends it under the same identifier and key: ${String(e)}`,
          );
        }
      }
      // A short read means nothing else is waiting; a full read with no
      // refusal spent the cap. Only a full read that a refusal left short of
      // the cap is read again, without the refused accounts.
      //
      // That re-read can return a row this tick already SENT whose stamp
      // then threw (`unstamped`): it is still unreported, so it is sent
      // again. Stripe replays it (same identifier, same key, every
      // parameter a function of an immutable row), so nothing is billed
      // twice, but the counters see it twice: one more attempt, and a
      // second `unstamped` or a `reported`. A stamp that resolves false is
      // `alreadyStamped`, never `reported`.
      if (stop || rows.length < want || !refusedHere) break;
    }
    if (!stop && attempts >= USAGE_REPORT_TICK_CAP) c.stoppedOnCap = 1;
    return c;
  },
};
