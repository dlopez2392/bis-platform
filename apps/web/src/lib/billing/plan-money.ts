/**
 * S-10 T9b: split out of plan-form.ts, whose `parsePlanForm` reads
 * `plans.*` keys (agency-only by prefix, never translated) — but
 * `formatCents` is also read by billing-view.ts and plan-rows.ts, both
 * genuinely client-reachable (the Owner's own Billing page), which made
 * the import-graph closure call the WHOLE plan-form.ts file (and its
 * agency-only `m[...]` reads) client-reachable too. `formatCents` itself
 * reads no catalogue key at all, so moving it needs no exemption.
 */
export function assertCents(cents: number): void {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new RangeError(`cents must be a non-negative integer, got ${cents}`);
  }
}

/** The value a reader sees: 104900 → "$1,049.00". */
export function formatCents(cents: number): string {
  assertCents(cents);
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}
