import type { Tr } from "@/lib/record/copy";
import type { SuggestionView } from "@/lib/proposals/view";
import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionCard, SUGGESTION_CARD, MONO_LABEL } from "./suggestion-card";
import type { SuggestionActionProps } from "./suggestion-actions";
import { SuggestionRetry } from "./suggestion-retry";

/**
 * The Suggestions section (item 8b-1, spec 4.5): a mono-label heading over separate cards. No card
 * wraps the stack (P12), no hero (rule 11). Loaded, empty (absent), error with Retry (rule 5), and a
 * skeleton shaped like the card for the page's loading file (rule 7; Task 8 wires it).
 */
export type SuggestionSectionData = { ok: true; views: SuggestionView[]; capped: boolean } | { ok: false };

const SECTION = "flex flex-col gap-3";
const SUBHEAD = "text-sm text-muted-foreground";

/** "Showing the newest 200." under a capped stack (plan deviation 19). Exported for the styleguide. */
export function SuggestionCapLine({ tr }: { tr: Tr }) {
  return <p className={SUBHEAD}>{tr.text("suggestions.cap", { n: 200 })}</p>;
}

function Heading({ id, tr }: { id: string; tr: Tr }) {
  return <h2 id={id} className={MONO_LABEL}>{tr.text("suggestions.heading")}</h2>;
}

export function SuggestionSection({
  tr, personaName, data, headingId = "suggestions", ...actions
}: {
  tr: Tr; personaName: string; data: SuggestionSectionData;
  /** The heading's id, which the section is labelled by; the call page keeps its #call-proposals anchor. */
  headingId?: string;
} & SuggestionActionProps) {
  if (data.ok && data.views.length === 0) return null;
  return (
    <section lang={tr.locale} aria-labelledby={headingId} className={SECTION}>
      <Heading id={headingId} tr={tr} />
      {data.ok ? (
        <>
          <p className={SUBHEAD}>{tr.text("suggestions.subhead", { persona: personaName.trim() || "Sofía" })}</p>
          {data.views.map((view) => <SuggestionCard key={view.id} view={view} {...actions} />)}
          {data.capped ? <SuggestionCapLine tr={tr} /> : null}
        </>
      ) : (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 text-sm text-foreground">{tr.text("suggestions.loadFailed")}</p>
          <SuggestionRetry label={tr.text("common.retry")} />
        </div>
      )}
    </section>
  );
}

/** Two cards shaped like the card while the section loads: a label line, the change, the evidence, the buttons. */
export function SuggestionSectionSkeleton({ tr }: { tr: Tr }) {
  const line = "rounded-[var(--radius-ctl)]";
  return (
    <section lang={tr.locale} className={SECTION}>
      <Heading id="suggestions-loading" tr={tr} />
      <p role="status" className={SUBHEAD}>{tr.text("suggestions.loading")}</p>
      {[0, 1].map((i) => (
        <div key={i} data-skeleton className={SUGGESTION_CARD} aria-hidden>
          <Skeleton className={`h-3 w-2/5 ${line}`} />
          <Skeleton className={`h-4 w-4/5 ${line}`} />
          <Skeleton className={`h-4 w-3/5 ${line}`} />
          {/* Wraps: three fixed widths in one row were the card's min-content (330px) at phone width. */}
          <div className="flex flex-wrap gap-2">
            <Skeleton className={`h-8 w-20 ${line}`} />
            <Skeleton className={`h-8 w-28 ${line}`} />
            <Skeleton className={`h-8 w-20 ${line}`} />
          </div>
        </div>
      ))}
    </section>
  );
}
