import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterKey } from "./billing";

/**
 * The nightly comparison of BIS usage with Stripe's meter totals, per
 * account, meter and billing period (0099's billing_reconciliations, keyed
 * (account_id, meter, window_start)). Service-role writes only (the nightly
 * step); the agency reads (the work queue, the Billing card). M7a PR-4,
 * docs/superpowers/plans/2026-10-26-m7a-pr4-pause-and-reconciliation.md, G14.
 */
export const RECONCILIATION_VERDICTS = [
  "match", "held_at_stripe", "held_missing", "stripe_over", "stripe_under", "ambiguous",
] as const;
export type ReconciliationVerdict = (typeof RECONCILIATION_VERDICTS)[number];
/** The three a person must look at (G13). */
export const ALERTING_VERDICTS: readonly ReconciliationVerdict[] = ["stripe_over", "stripe_under", "ambiguous"];

export type ReconciliationWrite = {
  accountId: string; meter: MeterKey; windowStart: string; windowEnd: string;
  bisSettled: number; bisInFlight: number; bisHeld: number; stripeTotal: number;
  verdict: ReconciliationVerdict; checkedAt: string;
};
export type Reconciliation = ReconciliationWrite;

const COLUMNS = "account_id, meter, window_start, window_end, bis_settled, bis_in_flight, bis_held, stripe_total, verdict, checked_at";

/** bigint and numeric columns may arrive as strings (PostgREST keeps a
 *  numeric's precision that way); each is parsed with Number. */
type Row = {
  account_id: string; meter: MeterKey; window_start: string; window_end: string; bis_settled: number | string;
  bis_in_flight: number | string; bis_held: number | string; stripe_total: number | string;
  verdict: ReconciliationVerdict; checked_at: string;
};

const toReconciliation = (r: Row): Reconciliation => ({
  accountId: r.account_id, meter: r.meter, windowStart: r.window_start, windowEnd: r.window_end,
  bisSettled: Number(r.bis_settled), bisInFlight: Number(r.bis_in_flight), bisHeld: Number(r.bis_held),
  stripeTotal: Number(r.stripe_total), verdict: r.verdict, checkedAt: r.checked_at,
});

/** One period's result, replacing that period's earlier one (a current
 *  period is re-checked each night; a closed one keeps its own row, I9). */
export async function saveReconciliation(db: SupabaseClient, w: ReconciliationWrite): Promise<void> {
  const { error } = await db.from("billing_reconciliations").upsert({
    account_id: w.accountId, meter: w.meter, window_start: w.windowStart, window_end: w.windowEnd,
    bis_settled: w.bisSettled, bis_in_flight: w.bisInFlight, bis_held: w.bisHeld, stripe_total: w.stripeTotal,
    verdict: w.verdict, checked_at: w.checkedAt,
  }, { onConflict: "account_id,meter,window_start" });
  if (error) throw new Error(`saveReconciliation failed: ${error.message}`);
}

/** The newest period's row per meter, for the Billing card. */
export async function listReconciliations(db: SupabaseClient, accountId: string, now: Date): Promise<Reconciliation[]> {
  return [...(await latestReconciliations(db, [accountId], now)).values()];
}

/** Only periods that started this recently are read (two billing periods and
 *  slack): an older row can be neither the current nor the just-closed one. */
export const RECONCILE_LOOKBACK_MS = 70 * 24 * 60 * 60 * 1000;
const ACCOUNTS_PER_READ = 50;
const RECONCILE_PAGE = 1000;

/** Newest window_start per (account, meter); key "<accountId>:<meter>".
 *  Bounded (re-review m6): the lookback, accounts in groups, and pages of
 *  RECONCILE_PAGE until an actually EMPTY page (PR-1's rule). */
export async function latestReconciliations(
  db: SupabaseClient, accountIds: string[], now: Date,
): Promise<Map<string, Reconciliation>> {
  const out = new Map<string, Reconciliation>();
  const since = new Date(now.getTime() - RECONCILE_LOOKBACK_MS).toISOString();
  for (let i = 0; i < accountIds.length; i += ACCOUNTS_PER_READ) {
    const group = accountIds.slice(i, i + ACCOUNTS_PER_READ);
    for (let from = 0; ; ) {
      const { data, error } = await db.from("billing_reconciliations").select(COLUMNS)
        .in("account_id", group).gte("window_start", since)
        .order("account_id", { ascending: true }).order("meter", { ascending: true })
        .order("window_start", { ascending: false }).range(from, from + RECONCILE_PAGE - 1);
      if (error) throw new Error(`latestReconciliations failed: ${error.message}`);
      const rows = (data ?? []) as Row[];
      if (rows.length === 0) break;
      for (const r of rows) {
        const key = `${r.account_id}:${r.meter}`;
        if (!out.has(key)) out.set(key, toReconciliation(r));
      }
      from += rows.length;
    }
  }
  return out;
}

/** "<accountId>:<meter>:<windowStartMs>" for every row checked at or after
 *  `sinceIso` (this window's start, G14): the nightly step skips those.
 *  Paged until empty. */
export async function reconciledSince(db: SupabaseClient, sinceIso: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; ) {
    const { data, error } = await db.from("billing_reconciliations").select("account_id, meter, window_start")
      .gte("checked_at", sinceIso).order("account_id", { ascending: true }).order("meter", { ascending: true })
      .order("window_start", { ascending: true }).range(from, from + RECONCILE_PAGE - 1);
    if (error) throw new Error(`reconciledSince failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; meter: string; window_start: string }[];
    if (rows.length === 0) return out;
    for (const r of rows) out.add(`${r.account_id}:${r.meter}:${Date.parse(r.window_start)}`);
    from += rows.length;
  }
}
