import type { CheckinCounts } from "@bis/db";
import { Skeleton } from "@/components/ui/skeleton";
import { m } from "@/lib/messages";

/**
 * F-072 PR 4 (plan D8): the Review requests card's counts line, last 30 days. Pure views; the read is
 * `checkin-counts-line.tsx`. Four states, each designed (DESIGN rule 5): loading (a skeleton shaped like the
 * line), empty (one sentence of what will appear and what causes it), loaded, and error (words, never a zero: a
 * failed read must not read as "nobody answered"). Agency-only and English-only, like the card it sits in.
 * Never who left a review: "opened" counts presses of the review button, which is all we can know.
 */
export type CheckinCountsState = { kind: "loaded"; counts: CheckinCounts } | { kind: "error" };

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const WRAP = "space-y-1.5 border-t pt-4";

export function CheckinCountsView({ state }: { state: CheckinCountsState }) {
  return (
    <section aria-labelledby="review-checkin-counts-title" data-testid="review-checkin-counts" className={WRAP}>
      <h3 id="review-checkin-counts-title" className={LABEL}>{m["automations.review.counts.title"]}</h3>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: { state: CheckinCountsState }) {
  if (state.kind === "error") {
    return <p role="status" className="text-sm text-muted-foreground">{m["automations.review.counts.error"]}</p>;
  }
  const c = state.counts;
  // Nothing asked and nothing answered: the feature has not run. "Asked but unanswered" is a fact, so it is NOT empty.
  if (c.asked === 0 && c.answered === 0 && c.opened === 0) {
    return <p className="text-sm text-muted-foreground">{m["automations.review.counts.empty"]}</p>;
  }
  return (
    <>
      <p className="text-sm tabular-nums text-card-foreground">
        {m["automations.review.counts.line"]
          .replace("{asked}", String(c.asked)).replace("{answered}", String(c.answered))
          .replace("{great}", String(c.great)).replace("{okay}", String(c.okay))
          .replace("{notGreat}", String(c.notGreat)).replace("{opened}", String(c.opened))}
      </p>
      <p className="text-xs text-muted-foreground">{m["automations.review.counts.note"]}</p>
      <p className="text-xs text-muted-foreground">{m["automations.review.counts.askedNote"]}</p>
    </>
  );
}

/** The Suspense fallback: the title and two skeleton lines, the loaded line's shape. */
export function CheckinCountsSkeleton() {
  return (
    <section aria-labelledby="review-checkin-counts-title" aria-busy="true" data-testid="review-checkin-counts-loading" className={WRAP}>
      <h3 id="review-checkin-counts-title" className={LABEL}>{m["automations.review.counts.title"]}</h3>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </section>
  );
}
