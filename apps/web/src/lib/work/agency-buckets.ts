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
 * Rows are concatenated in RANKED account order, not first-seen (revised
 * 2026-09-15 — see below), so one account's rows still land adjacent to
 * each other inside a bucket rather than interleaved with another
 * account's — the plain reading of "render grouped, with the brand name on
 * every row" (task-6-brief.md): a reader scanning Overdue sees one
 * company's rows, then the next, each still carrying its own `brandName`
 * since the rows are pooled across every account on this one screen.
 *
 * BLOCK ORDER, within each bucket independently (2026-09-15): the accounts
 * read this feeds from has no ordering of its own, so "first-seen" was heap
 * order — any edit to an account moved its block to the end, and the top of
 * Overdue was not the genuinely most overdue company, only whichever one
 * Postgres happened to return first. Each account's own rows in a bucket are
 * ALREADY correctly sorted by `bucketWork` (earliest due date first for
 * Overdue/Today, oldest occurrence first for Waiting) — so that account's
 * OWN most urgent row is always its first element, and blocks are ranked by
 * comparing those first elements with the SAME comparator `bucketWork` used
 * to sort them, never a second, different notion of "urgent". A tie (equal
 * urgency) breaks on `accountId` ascending — arbitrary, but stable and
 * deterministic, so a re-render never reorders two equally-urgent companies
 * relative to each other.
 */
const byDueAsc = (a: AgencyWorkRow, b: AgencyWorkRow) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
const byAgeAsc = (a: AgencyWorkRow, b: AgencyWorkRow) => a.occurredAt.localeCompare(b.occurredAt);

export function bucketAgencyWork(rows: AgencyWorkRow[], now: Date): AgencyBucketedWork {
  const out: AgencyBucketedWork = { overdue: [], today: [], waiting: [] };
  const byAccount = new Map<string, AgencyWorkRow[]>();
  for (const r of rows) {
    const existing = byAccount.get(r.accountId);
    if (existing) existing.push(r);
    else byAccount.set(r.accountId, [r]);
  }

  // Each account's own three buckets, computed once — `bucketWork` is typed
  // over the base `WorkRow`, but every row that went in was an
  // `AgencyWorkRow` and comes back as the SAME object (bucketWork only
  // filters and sorts, never copies), so `brandName`/`timezone` are still
  // there at runtime; the cast below only tells the compiler what's already
  // true.
  const perAccount = new Map<string, AgencyBucketedWork>();
  for (const [accountId, acctRows] of byAccount) {
    // Every row in `acctRows` came from the same account (grouped above), so
    // its own `timezone` is the same on all of them — read off the first.
    const zone = acctRows[0]!.timezone;
    perAccount.set(accountId, bucketWork(acctRows, now, zone) as AgencyBucketedWork);
  }

  for (const bucket of BUCKETS) {
    const comparator = bucket === "waiting" ? byAgeAsc : byDueAsc;
    const blocks = [...perAccount.entries()]
      .map(([accountId, b]) => ({ accountId, rows: b[bucket] }))
      .filter((block) => block.rows.length > 0);
    blocks.sort((a, b) => comparator(a.rows[0]!, b.rows[0]!) || a.accountId.localeCompare(b.accountId));
    // Never `out[bucket].push(...block.rows)` — a per-account block can hold
    // more rows than V8 allows as call arguments in one spread (empirically
    // somewhere between 100,000 and 131,072 on this Node; see this file's
    // own test). One row at a time has no such limit.
    for (const block of blocks) {
      for (const row of block.rows) out[bucket].push(row);
    }
  }
  return out;
}
