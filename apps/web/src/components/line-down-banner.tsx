import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * "2 numbers are turning callers away."
 *
 * DERIVED, NEVER STORED, and that is the design rather than an
 * implementation detail. The count comes from `countLinesTurningCallersAway`
 * (packages/db/src/screened-calls.ts) over a 24-hour window of
 * `screened_calls`; when the number goes live the refusals stop and this
 * disappears on the next render. There is no task to stamp, complete,
 * dismiss or forget — and therefore no state that can go stale and lie,
 * which is the failure mode a stored "line down" task would have.
 *
 * It is also why this is not a new `WorkSource`: a source would ripple into
 * `bucketWork`, the per-account queue and both list components to model
 * something that is not a task.
 *
 * Renders NOTHING at zero. A banner that says "0 numbers are turning callers
 * away" is noise on the good day, which is most days.
 *
 * The count is DISTINCT NUMBERS in a 24-hour window, not a lifetime total —
 * `countLinesTurningCallersAway`'s own doc comment: a dialer hammering one
 * dead line is one problem to fix, not a crisis that scales with the
 * spammer's persistence. The copy says "are turning callers away" (present
 * tense, ongoing) rather than a bare count, so it cannot be misread as
 * "N refused calls ever".
 */
export function LineDownBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  const sentence =
    count === 1
      ? m["work.linesDown.one"]
      : m["work.linesDown.many"].replace("{n}", String(count));

  // `text-foreground` per the repo's standing rule (setup-shell.tsx): a full
  // SENTENCE keeps the foreground colour and lets the ground carry the hue,
  // because a sentence in `--warn` sits at the AA floor.
  //
  // `role="note"` overrides Notice's own `role="alert"` (the spread puts our
  // props last): this is a standing fact present on first paint, not
  // something that just happened — an assertive live region would interrupt
  // a screen-reader user for a sentence that was already there when the page
  // loaded.
  return (
    <Notice tone="warn" role="note" className="text-foreground">
      {sentence}{" "}
      <Link href="/dashboard/screened" className="underline underline-offset-2">
        {m["work.linesDown.action"]}
      </Link>
    </Notice>
  );
}
