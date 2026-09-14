import type { WorkRow } from "@bis/db";
import { partsInZone } from "@/lib/booking/slots";

export type Bucket = "overdue" | "today" | "waiting";
export type BucketedWork = { overdue: WorkRow[]; today: WorkRow[]; waiting: WorkRow[] };

/** `YYYY-MM-DD` as seen in `zone`. Comparable as a string because the parts
 *  are zero-padded and fixed width.
 *
 *  NOTE the key names: `partsInZone` returns `{ y, m, d, hh, mi, weekday }`
 *  with SHORT keys and numeric values (slots.ts:55) — not `{ year, month,
 *  day }`. Reaching for the long names yields `undefined` and a day key of
 *  "undefined-NaN-NaN" that compares unequal to everything, so every task
 *  silently lands in Waiting. */
function localDay(instant: Date, zone: string): string {
  const { y, m, d } = partsInZone(instant, zone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Three buckets, resolved in the ACCOUNT's zone.
 *
 * Only tasks can be Overdue or Today. A derived row's `occurredAt` records
 * when something happened, which is not a promise that it would be done by
 * then — so derived rows always wait, however old (spec §2). Oldest-first
 * ordering surfaces the stale ones anyway; do not "fix" this by promoting them.
 *
 * `partsInZone` throws `RangeError` for either an invalid IANA zone or an
 * unparseable instant, and nothing upstream validates either one (a bad zone
 * reaches here today via the free-text input at
 * create-account-dialog.tsx:80, passed through unchecked by actions.ts:13).
 * Same idiom as the existing precedent at slots.ts:269-272: catch and
 * degrade, don't propagate. The two failures are handled at different
 * scopes on purpose:
 *  - An invalid `zone` means we cannot resolve the account's day boundary AT
 *    ALL, so no row can be classified Overdue or Today without guessing —
 *    claiming a date we cannot compute is worse than declining to. Every
 *    row goes to Waiting, oldest first. We do NOT fall back to UTC or the
 *    server zone: this feature's entire constraint is account-zone-only
 *    bucketing, and a silent fallback would reintroduce the previous-day
 *    defect this repo has already shipped once.
 *  - An unparseable `dueAt` is a single bad row, not a broken zone — it
 *    alone goes to Waiting so it can't take the rest of the batch down with
 *    it and hide every other task, conversation and booking for the account.
 * Either way the work stays visible; throwing would hide it entirely, which
 * is the one unacceptable outcome.
 */
export function bucketWork(rows: WorkRow[], now: Date, zone: string): BucketedWork {
  const out: BucketedWork = { overdue: [], today: [], waiting: [] };
  const byAge = (a: WorkRow, b: WorkRow) => a.occurredAt.localeCompare(b.occurredAt);

  let todayKey: string;
  try {
    todayKey = localDay(now, zone);
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    out.waiting.push(...rows);
    out.waiting.sort(byAge);
    return out;
  }

  for (const r of rows) {
    if (r.source === "task" && r.dueAt) {
      let dueKey: string;
      try {
        dueKey = localDay(new Date(r.dueAt), zone);
      } catch (err) {
        if (!(err instanceof RangeError)) throw err;
        out.waiting.push(r);
        continue;
      }
      if (dueKey < todayKey) out.overdue.push(r);
      else if (dueKey === todayKey) out.today.push(r);
      else out.waiting.push(r);
      continue;
    }
    out.waiting.push(r);
  }

  const byDue = (a: WorkRow, b: WorkRow) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.waiting.sort(byAge);
  return out;
}
