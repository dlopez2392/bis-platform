import { RecordCardRetry } from "@/components/record/record-card";
import type { FactsView } from "@/lib/record/record-facts";

/** The summary card's body (spec §9.2): the checked facts first. No generated prose in part 1 (D1).
 *  `onRetry`: the list's drawer re-reads its own route (S-03 part 3 §9.1); absent, the page refreshes. */
export function SummaryBody({ view, retryLabel, onRetry }: { view: FactsView; retryLabel: string; onRetry?: () => void }) {
  return (
    <div className="space-y-2">
      <p data-record-facts className="text-sm text-card-foreground tabular-nums [overflow-wrap:anywhere]">{view.line.join(" · ")}</p>
      {view.missing ? (
        <div data-record-facts-missing className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{view.missing}</span>
          <RecordCardRetry label={retryLabel} onRetry={onRetry} />
        </div>
      ) : null}
    </div>
  );
}
