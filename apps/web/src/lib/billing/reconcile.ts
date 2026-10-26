import type { AccountBilling, Reconciliation, ReconciliationVerdict } from "@bis/db";

/**
 * The nightly comparison's pure parts (M7a PR-4 plan G14, I9). The window a
 * night belongs to is NOT defined here: it is @bis/db's reconcileNightStart
 * (the most recent 08:00 UTC), the one function the agency's alert read keys
 * a night by too, so the two can never disagree (orchestrator ruling).
 */

/** Assumption S1 (unverified as a bound; PR-2 observed ~120 s in test
 *  mode): an event Stripe accepted this long ago is in its meter summary. */
export const RECONCILE_SETTLE_MS = 2 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;
const ceilMinute = (ms: number) => Math.ceil(ms / MINUTE_MS) * MINUTE_MS;
const floorMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

export type ReconcileWindow = { start: Date; end: Date };

/** The current billing period so far, on whole minutes (Stripe's summary
 *  times must be minute-aligned). Start CEILED, end FLOORED: an event in a
 *  partial minute at either edge is outside the window on BOTH sides, since
 *  BIS reads occurred_at in [start, end) and Stripe's event timestamp is
 *  floor(occurred_at in seconds). */
export function reconcileWindow(
  row: Pick<AccountBilling, "currentPeriodStart" | "billingStartedAt">, now: Date,
): ReconcileWindow | null {
  if (!row.currentPeriodStart) return null;
  const start = ceilMinute(Math.max(Date.parse(row.currentPeriodStart), Date.parse(row.billingStartedAt)));
  const end = floorMinute(now.getTime());
  return end > start ? { start: new Date(start), end: new Date(end) } : null;
}

/** I9: the just-closed period, compared once more, up to its end. `latest`
 *  is the newest stored row for this (account, meter). Null when there is
 *  none, when it already is the current period, or when it already reaches
 *  the current period's start (it was compared to its end before). A period
 *  that closed before its first ever row is never compared (plan G14,
 *  remaining gap 4). */
export function closedPeriodWindow(
  latest: Pick<Reconciliation, "windowStart" | "windowEnd"> | null,
  row: Pick<AccountBilling, "currentPeriodStart">,
): ReconcileWindow | null {
  if (!latest || !row.currentPeriodStart) return null;
  const currentStart = ceilMinute(Date.parse(row.currentPeriodStart));
  const start = Date.parse(latest.windowStart);
  if (start >= currentStart) return null;
  if (Date.parse(latest.windowEnd) >= currentStart) return null;
  return { start: new Date(start), end: new Date(currentStart) };
}

/**
 * Plan G14. BIS's settled usage MUST be in Stripe's total; its in-flight
 * usage MAY be; whether its held rows are is what this decides. Exact
 * integers only (assumption S5: a `sum` meter of whole numbers sums to a
 * whole number); a fraction is never rounded into an answer.
 *
 * The held rows are judged ALL or NONE, so every PARTIAL set at Stripe must
 * be ruled out first (review item 2): with held rows q1..qn (sum H, smallest
 * m), a total in [lo, hi] is "none at Stripe" only while it is below
 * lo + m (no single held row fits under it), and a total in [lo + H, hi + H]
 * is "all at Stripe" only while it is above hi + H − m (leaving out any one
 * held row cannot reach it). Anything else is ambiguous: stamping a partial
 * set loses usage, sending one bills it twice.
 */
export function reconcileMeter(
  bands: { settled: number; inFlight: number; heldQuantities: readonly number[] }, stripeTotal: number,
): ReconciliationVerdict {
  if (!Number.isInteger(stripeTotal)) return "ambiguous";
  const lo = bands.settled;
  const hi = bands.settled + bands.inFlight;
  const inRange = (x: number, a: number, b: number) => x >= a && x <= b;
  if (bands.heldQuantities.length === 0) {
    if (inRange(stripeTotal, lo, hi)) return "match";
    return stripeTotal < lo ? "stripe_under" : "stripe_over";
  }
  const held = bands.heldQuantities.reduce((sum, q) => sum + q, 0);
  const smallest = Math.min(...bands.heldQuantities);
  if (inRange(stripeTotal, lo, hi) && stripeTotal < lo + smallest) return "held_missing";
  if (inRange(stripeTotal, lo + held, hi + held) && stripeTotal > hi + held - smallest) return "held_at_stripe";
  if (stripeTotal < lo) return "stripe_under";
  if (stripeTotal > hi + held) return "stripe_over";
  return "ambiguous";
}
