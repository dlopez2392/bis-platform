import {
  ALERTING_VERDICTS, METER_KEYS, PAST_DUE_STATUSES, healPermissions, latestReconciliations, listPauseCandidates,
  listReconcilableAccounts, markUsageReported, mirrorSubscription, readUsageBands, reconcileNightStart, reconciledSince,
  saveReconciliation, type AccountBilling, type MeterKey, type UsageBands,
} from "@bis/db";
import { USAGE_REPORT_BUDGET_MS, METER_EVENT_WORST_CASE_MS } from "@/lib/automations/caps";
import type { PassContext } from "@/lib/automations/context";
import { billingEnforced } from "./enforce";
import { METERS } from "./stripe-catalog";
import { meterEventFailureKind, usageIdempotencyKey, type BillingGateway } from "./stripe-gateway";
import { RECONCILE_SETTLE_MS, closedPeriodWindow, reconcileMeter, reconcileWindow, type ReconcileWindow } from "./reconcile";

export type NightlyCounters = {
  remirrored: number; reconciled: number; mismatched: number; heldStamped: number; heldSent: number;
  reconcileFailed: number; reconcileSkippedBudget: number;
};

/** The budget left cannot cover the next call's worst case: stop the step
 *  (not an error); the next tick resumes where this one stopped. */
class BudgetSpent extends Error {}

/** The most Stripe reads one re-mirror may make here (review item 6): the
 *  normal case. A need(REMIRROR_READS) before it keeps its worst case inside
 *  the budget; mirrorSubscription alone could make 1 + MIRROR_ATTEMPTS. */
export const REMIRROR_READS = 2;

/**
 * The nightly billing step (spec section 4; M7a PR-4 plan G6, G14, G15, G4).
 * Runs INSIDE usageReportPass, after its sends and bookkeeping, ONLY with
 * BILLING_ENFORCE on (I8: off, it returns at once and touches nothing), on
 * that pass's OWN clock and budget, so the budget sum cron-coupling.test.ts
 * pins is unchanged. Every Stripe call is bounded (one attempt, the meter
 * event timeout; I2) and starts only while its worst case still fits:
 * REMIRROR_READS (2) worst cases before a re-mirror, whose reads are capped
 * at that here, and one before the meter list, each meter total and each
 * held send.
 * The unit of work is one (account, meter, period) not checked since this
 * window's 08:00 UTC start (reconcileNightStart, the same function the
 * agency's alert keys a night by; I4), so the next tick resumes and each
 * pair is checked once per window.
 *
 *   1. Re-mirror every past_due, unpaid or paused subscription not re-read
 *      this window (G6), so the pause pass decides on a fresh Stripe status.
 *      Known limit (plan G6 note, NOT solved here): the re-read is by the
 *      STORED subscription id. A client who re-subscribes on a NEW
 *      subscription whose webhook delivery is lost cannot be found this way:
 *      the stored, canceled one still reads canceled, so the row stays
 *      paused until Stripe retries that delivery or the agency lifts it.
 *   2. Per live subscription and meter: the just-closed period once,
 *      report-only (I9; its invoice is final, assumption S8), then the
 *      current period: BIS's bands against Stripe's total (assumption S1);
 *      held rows stamped or sent; the verdict saved; an alerting one logged.
 *   3. accounts.permissions rewritten from the plan for each account done (G4).
 */
export async function runBillingNightly(
  ctx: PassContext, gateway: BillingGateway, clock: { startedAt: number; nowMs: () => number },
): Promise<NightlyCounters> {
  const c: NightlyCounters = {
    remirrored: 0, reconciled: 0, mismatched: 0, heldStamped: 0, heldSent: 0, reconcileFailed: 0, reconcileSkippedBudget: 0,
  };
  if (!billingEnforced()) return c;
  const runStart = reconcileNightStart(ctx.now);
  const left = () => USAGE_REPORT_BUDGET_MS - (clock.nowMs() - clock.startedAt);
  const need = (worstCases: number) => {
    if (left() <= worstCases * METER_EVENT_WORST_CASE_MS) {
      c.reconcileSkippedBudget++;
      console.error(`billing nightly: budget spent; the rest goes next tick`);
      throw new BudgetSpent();
    }
  };
  try {
    // 1. Freshness for the pause (G6).
    for (const row of await listPauseCandidates(ctx.db)) {
      const status = row.subscriptionStatus;
      const unpaid = row.billingPausedAt !== null || (status !== null && PAST_DUE_STATUSES.includes(status));
      if (!unpaid || !row.stripeSubscriptionId) continue;
      if (row.stripeCheckedAt && Date.parse(row.stripeCheckedAt) >= runStart.getTime()) continue;
      // A mirror reads Stripe once, then once per attempt (1 + MIRROR_ATTEMPTS
      // = 4 reads at worst, more than this budget holds). Here it may read
      // only TWICE, the normal case: a third read means it lost a race with
      // a concurrent write (nothing was written), so it throws, is counted,
      // and the row is re-read next tick (review item 6).
      need(REMIRROR_READS);
      const subId = row.stripeSubscriptionId;
      let reads = 0;
      const read = () => {
        if (++reads > REMIRROR_READS) {
          throw new Error(`the billing row kept changing; re-read next tick (more than ${REMIRROR_READS} Stripe reads)`);
        }
        return gateway.retrieveSubscription(subId, { bounded: true });
      };
      try {
        const out = await mirrorSubscription(ctx.db, read, () => ctx.now);
        if (out.kind === "refused") {
          // A refusal writes nothing, so stripe_checked_at stays old and the
          // row is re-read every tick of this window (review item 5; bound
          // stated, not fixed): at most REMIRROR_READS bounded reads per row
          // per tick, inside this pass's budget, and logged each time (the
          // alert channel, G17). Writing stripe_checked_at on a refusal would
          // let a pause rest on a status Stripe never confirmed for this row
          // (G6), and no column records a refusal without a migration.
          console.error(`billing nightly: re-mirror of ${subId} (account ${row.accountId}) refused: ${out.reason}`);
        } else {
          c.remirrored++;
        }
      } catch (e) {
        c.reconcileFailed++;
        console.error(`billing nightly: re-mirror failed for account ${row.accountId}: ${String(e)}`);
      }
    }

    // 2 + 3. Reconcile.
    const accounts = await listReconcilableAccounts(ctx.db);
    if (accounts.length === 0) return c;
    const done = await reconciledSince(ctx.db, runStart.toISOString());
    const latest = await latestReconciliations(ctx.db, accounts.map((a) => a.accountId), ctx.now);
    // What is due, per account, BEFORE any Stripe call (review item 7):
    // nothing due → not even the meter list is asked for.
    //  - the current period: unless checked since this window's start (I4);
    //  - the just-closed period: whenever closedPeriodWindow returns one. It
    //    is NOT looked up in `done` (review item 1): its key is the old
    //    period's window_start, which the same 08:00 window may already hold
    //    from a check BEFORE the rollover, and skipping it then would never
    //    compare the period to its end. Its own once-guard is
    //    closedPeriodWindow's: the saved row reaches the current start.
    const due: { row: AccountBilling; pairs: { meter: MeterKey; window: ReconcileWindow; closing: boolean }[] }[] = [];
    for (const row of accounts) {
      if (!row.stripeCustomerId) continue;
      const pairs: { meter: MeterKey; window: ReconcileWindow; closing: boolean }[] = [];
      for (const meter of METER_KEYS) {
        const closed = closedPeriodWindow(latest.get(`${row.accountId}:${meter}`) ?? null, row);
        if (closed) pairs.push({ meter, window: closed, closing: true });
        const current = reconcileWindow(row, ctx.now);
        if (current && !done.has(`${row.accountId}:${meter}:${current.start.getTime()}`)) {
          pairs.push({ meter, window: current, closing: false });
        }
      }
      if (pairs.length > 0) due.push({ row, pairs });
    }
    if (due.length === 0) return c;
    need(1);
    let meterIds: Map<string, string>;
    try {
      meterIds = new Map((await gateway.listActiveMeters({ bounded: true })).map((m) => [m.eventName, m.id]));
    } catch (e) {
      c.reconcileFailed++;
      console.error(`billing nightly: Stripe's meters could not be listed; nothing reconciled this tick: ${String(e)}`);
      return c;
    }
    for (const { row, pairs } of due) {
      let touched = false;
      // A meter whose closing comparison failed this tick (anything but the
      // budget): its current pair waits too. Saving the current period's row
      // would make it the newest, closedPeriodWindow would return null on the
      // next tick, and the closed period would never be compared to its end
      // (plan G14, closed-period retry rule). Pairs are pushed closed-first.
      const closingFailed = new Set<MeterKey>();
      for (const { meter, window, closing } of pairs) {
        if (!closing && closingFailed.has(meter)) continue;
        const meterId = meterIds.get(METERS[meter].eventName);
        if (!meterId) {
          console.error(`billing nightly: no active Stripe meter for ${meter}`);
          continue;
        }
        try {
          await reconcileOne(ctx, gateway, c, need, row, meter, meterId, window, closing);
          touched = true;
        } catch (e) {
          if (e instanceof BudgetSpent) throw e;
          c.reconcileFailed++;
          if (closing) closingFailed.add(meter);
          console.error(
            `billing nightly: ${meter} for account ${row.accountId}${closing ? " (closed period; its current period waits for the next tick)" : ""} not reconciled: ${String(e)}`,
          );
        }
      }
      if (touched) {
        try {
          await healPermissions(ctx.db, row.accountId);
        } catch (e) {
          console.error(`billing nightly: permissions not healed for account ${row.accountId}: ${String(e)}`);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetSpent)) throw e;
  }
  return c;
}

async function reconcileOne(
  ctx: PassContext, gateway: BillingGateway, c: NightlyCounters, need: (worstCases: number) => void,
  row: AccountBilling, meter: MeterKey, meterId: string, window: ReconcileWindow, closing: boolean,
): Promise<void> {
  const customerId = row.stripeCustomerId!;
  const bands: UsageBands = await readUsageBands(ctx.db, {
    accountId: row.accountId, meter, startIso: window.start.toISOString(), endIso: window.end.toISOString(),
    now: ctx.now, settleMs: RECONCILE_SETTLE_MS,
  });
  need(1);
  const stripeTotal = await gateway.meterTotal({
    meterId, customerId, startSeconds: window.start.getTime() / 1000, endSeconds: window.end.getTime() / 1000,
  });
  const verdict = reconcileMeter(
    { settled: bands.settled, inFlight: bands.inFlight, heldQuantities: bands.heldRows.map((h) => h.quantity) }, stripeTotal,
  );
  // A closed period is report-only (I9, assumption S8): its invoice is final,
  // so its held rows are neither sent nor stamped; a person decides (runbook).
  if (!closing && verdict === "held_at_stripe") {
    for (const h of bands.heldRows) if (await markUsageReported(ctx.db, h.id, ctx.now)) c.heldStamped++;
  } else if (!closing && verdict === "held_missing") {
    // The reporter's identifier and key: past 20 h and absent from Stripe's
    // total, a replay of an earlier acceptance is the only way this can
    // succeed without a new event, and a "duplicate" refusal means Stripe has
    // it after all (A11); both end stamped once. Assumption S7 (identifier
    // uniqueness for at least 24 h) is why the reporter holds at 20 h.
    for (const h of bands.heldRows) {
      need(1);
      let atStripe = false;
      try {
        await gateway.reportMeterEvent({
          eventName: METERS[meter].eventName, customerId, value: h.quantity,
          identifier: h.id, timestampSeconds: Math.floor(Date.parse(h.occurredAt) / 1000),
        }, usageIdempotencyKey(h.id, customerId));
      } catch (e) {
        if (meterEventFailureKind(e, h.id) !== "duplicate") {
          c.reconcileFailed++;
          console.error(`billing nightly: held usage row ${h.id} (account ${row.accountId}) not sent: ${String(e)}`);
          continue;
        }
        atStripe = true;
      }
      if (await markUsageReported(ctx.db, h.id, ctx.now)) {
        if (atStripe) c.heldStamped++;
        else c.heldSent++;
      }
    }
  }
  await saveReconciliation(ctx.db, {
    accountId: row.accountId, meter, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString(),
    bisSettled: bands.settled, bisInFlight: bands.inFlight, bisHeld: bands.held, stripeTotal,
    verdict, checkedAt: ctx.now.toISOString(),
  });
  c.reconciled++;
  if (ALERTING_VERDICTS.includes(verdict)) {
    c.mismatched++;
    console.error(
      `billing nightly: ${meter} for account ${row.accountId}${closing ? " (closed period)" : ""} is ${verdict}: ` +
        `Stripe ${stripeTotal}, BIS settled ${bands.settled}, in flight ${bands.inFlight}, held ${bands.held} ` +
        `(window ${window.start.toISOString()} to ${window.end.toISOString()})`,
    );
  }
}
