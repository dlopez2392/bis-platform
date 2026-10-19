import { cn } from "@/lib/utils";
// AiAuthorMark's chip, worded by the view so it reads in either language.
import { AI_MARK_CLASS } from "@/components/ai-mark";
import type { SuggestionView } from "@/lib/proposals/view";
import { SuggestionActions, type SuggestionActionProps } from "./suggestion-actions";
import { SuggestionParts } from "./suggestion-parts";

/**
 * One AI suggestion (item 8b-1, spec 4.5): the one card the call page and the To do tray both show.
 * It renders a `SuggestionView` (built on the server by `lib/proposals/view.ts`) and nothing else, so it
 * reads no registry and no database and the styleguide can render it from plain data. Each card is its
 * own view with one primary (P12); no card wraps the stack (the section is a heading over cards).
 */

/** The house card's recipe (ui/card.tsx, design review I1): `bg-card` BEFORE `glass`, so a themed tenant's
 *  opaque --card wins the fill like its neighbours' and the utility adds only the sheen, the highlight and
 *  --shadow-card (no blur: DESIGN.md, cards never blur). The card radius and this card's own padding.
 *  `min-w-0` lets it shrink to its track at phone width. */
export const SUGGESTION_CARD =
  "flex min-w-0 flex-col gap-2.5 rounded-[var(--radius-card)] border border-border bg-card p-5 text-card-foreground glass";
/** DESIGN.md's Label role. */
export const MONO_LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
/** The status dot per state: the old proposals block's own treatments (rule 3: always beside its word). */
const DOT: Record<SuggestionView["status"], string> = {
  pending: "bg-primary",
  accepted: "bg-success",
  edited: "bg-success",
  dismissed: "bg-muted-foreground/60",
  expired: "bg-muted-foreground/60",
};

export function SuggestionCard({ view, ...actions }: { view: SuggestionView } & SuggestionActionProps) {
  return (
    <article lang={view.lang} data-suggestion={view.id} data-status={view.status} className={SUGGESTION_CARD}>
      <p className={MONO_LABEL}>{view.sourceLabel}</p>
      <p className="text-sm leading-6 text-foreground"><SuggestionParts parts={view.parts} /></p>
      {view.detail ? <p className="text-xs text-muted-foreground">{view.detail}</p> : null}
      {/* NEVER CLAMPED (measured when the old call-page block, since removed, clamped it): the whole caller
          turn, so a late "...but not on Tuesday" is seen before anyone accepts. */}
      <p className="text-sm leading-6 text-muted-foreground">
        {view.labels.because}{" "}
        <q lang={view.evidenceLang} className="text-foreground">{view.evidence}</q>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span data-ai-mark className={AI_MARK_CLASS}>{view.personaMark}</span>
        {/* Focus lands here once this card's decision is shown (design review minor 5), never on <body>. */}
        <p data-status-line tabIndex={-1}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]">
          <span data-status-dot className={cn("size-[7px] shrink-0 rounded-full", DOT[view.status])} aria-hidden />
          <span data-status-word>{view.statusWord}</span>
        </p>
      </div>
      {view.reasonLine ? <p className="text-xs text-muted-foreground">{view.reasonLine}</p> : null}
      {view.decidedLine ? <p className="text-xs text-muted-foreground">{view.decidedLine}</p> : null}
      {view.canAct ? <SuggestionActions id={view.id} edit={view.edit} labels={view.labels} {...actions} /> : null}
    </article>
  );
}
