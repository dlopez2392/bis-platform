// apps/web/src/lib/work/agency-buckets.ts
//
// The agency-wide screen's own bucketing (Work Queue Task 6,
// /dashboard/work). A deliberately separate file from `buckets.ts` rather
// than an edit to it: `bucketWork` and its zone-degrade behaviour are
// Task 2's already-reviewed, already-tested code, and this needs no change
// to either — only a caller that runs it once PER ACCOUNT and merges the
// results.
import type { AgencyWorkRow } from "@bis/db";
import { bucketWork, type Bucket } from "./buckets";

export type AgencyBucketedWork = { overdue: AgencyWorkRow[]; today: AgencyWorkRow[]; waiting: AgencyWorkRow[] };

const BUCKETS: Bucket[] = ["overdue", "today", "waiting"];

/**
 * Buckets every account's rows in THAT account's own zone, never one zone
 * borrowed across every row — the task-6 brief's binding constraint, restated
 * from `bucketWork`'s own doc comment: a shared/server/UTC zone here would
 * reintroduce the previous-day defect this repo has already shipped once,
 * now multiplied across every account on one screen instead of one.
 *
 * Groups `rows` by `accountId` first, then calls the SAME `bucketWork` the
 * per-account "To do" screen uses, once per account, with that account's own
 * `timezone` (carried on every row by `listAgencyWork`, not looked up a
 * second time). Two things that follow from doing it this way rather than
 * bucketing the whole flat list against one zone:
 *
 * - A bad zone on one account degrades only that account's own rows to
 *   Waiting (bucketWork's per-batch degrade, scoped here to a batch of one
 *   account's rows) — it can never pull another, validly-zoned account's
 *   overdue work down with it.
 * - Each account's own three buckets are already correctly ordered
 *   (overdue/today by due date, waiting oldest-first) BEFORE they are
 *   concatenated into the combined bucket below, so no second sort is
 *   layered on top that could disagree with `bucketWork`'s own ordering.
 *
 * Rows are concatenated in FIRST-SEEN account order (a `Map`'s iteration
 * order is insertion order), so one account's rows land adjacent to each
 * other inside a bucket rather than interleaved with another account's —
 * the plain reading of "render grouped, with the brand name on every row"
 * (task-6-brief.md): a reader scanning Overdue sees one company's rows,
 * then the next, each still carrying its own `brandName` since the rows
 * are pooled across every account on this one screen.
 */
export function bucketAgencyWork(rows: AgencyWorkRow[], now: Date): AgencyBucketedWork {
  const out: AgencyBucketedWork = { overdue: [], today: [], waiting: [] };
  const byAccount = new Map<string, AgencyWorkRow[]>();
  for (const r of rows) {
    const existing = byAccount.get(r.accountId);
    if (existing) existing.push(r);
    else byAccount.set(r.accountId, [r]);
  }
  for (const acctRows of byAccount.values()) {
    // Every row in `acctRows` came from the same account (grouped above), so
    // its own `timezone` is the same on all of them — read off the first.
    const zone = acctRows[0]!.timezone;
    const bucketed = bucketWork(acctRows, now, zone);
    for (const bucket of BUCKETS) {
      // `bucketWork` is typed over the base `WorkRow`, but every row that
      // went in was an `AgencyWorkRow` and comes back as the SAME object
      // (bucketWork only filters and sorts, never copies) — so `brandName`
      // and `timezone` are still there at runtime; this only tells the
      // compiler what's already true.
      out[bucket].push(...(bucketed[bucket] as AgencyWorkRow[]));
    }
  }
  return out;
}
