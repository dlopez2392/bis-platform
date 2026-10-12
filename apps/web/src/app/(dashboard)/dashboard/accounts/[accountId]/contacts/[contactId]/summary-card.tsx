import { RecordCardRetry } from "@/components/record/record-card";
import type { FactsView } from "@/lib/record/record-facts";

/** The summary card's body (spec §9.2): the checked facts first. No generated prose in part 1 (D1). */
export function SummaryBody({ view, retryLabel }: { view: FactsView; retryLabel: string }) {
  return (
    <div className="space-y-2">
      <p data-record-facts className="text-sm text-card-foreground tabular-nums [overflow-wrap:anywhere]">{view.line.join(" · ")}</p>
      {view.missing ? (
        <div data-record-facts-missing className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{view.missing}</span>
          <RecordCardRetry label={retryLabel} />
        </div>
      ) : null}
    </div>
  );
}
