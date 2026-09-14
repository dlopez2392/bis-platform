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
 */
export function bucketWork(rows: WorkRow[], now: Date, zone: string): BucketedWork {
  const todayKey = localDay(now, zone);
  const out: BucketedWork = { overdue: [], today: [], waiting: [] };

  for (const r of rows) {
    if (r.source === "task" && r.dueAt) {
      const dueKey = localDay(new Date(r.dueAt), zone);
      if (dueKey < todayKey) out.overdue.push(r);
      else if (dueKey === todayKey) out.today.push(r);
      else out.waiting.push(r);
      continue;
    }
    out.waiting.push(r);
  }

  const byDue = (a: WorkRow, b: WorkRow) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
  const byAge = (a: WorkRow, b: WorkRow) => a.occurredAt.localeCompare(b.occurredAt);
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.waiting.sort(byAge);
  return out;
}
