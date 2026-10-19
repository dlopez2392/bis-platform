import { Fragment } from "react";
import { cn } from "@/lib/utils";
// AiAuthorMark's chip, worded by the view so it reads in either language.
import { AI_MARK_CLASS } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calls/ai-author-mark";
import type { SuggestionView } from "@/lib/proposals/view";
import { SuggestionActions, type SuggestionActionProps } from "./suggestion-actions";

/**
 * One AI suggestion (item 8b-1, spec 4.5): the one card the call page and the To do tray both show.
 * It renders a `SuggestionView` (built on the server by `lib/proposals/view.ts`) and nothing else, so it
 * reads no registry and no database and the styleguide can render it from plain data. Each card is its
 * own view with one primary (P12); no card wraps the stack (the section is a heading over cards).
 */

/** The house glass card on tokens (DESIGN.md: 12px card radius, surface-1, the card shadow, no blur). */
export const SUGGESTION_CARD =
  "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-1)] shadow-[var(--shadow-card)] p-5 flex flex-col gap-2.5";
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
      <p className="text-sm leading-6 text-foreground">
        {view.parts.map((p, i) => (p.lang
          ? <span key={i} lang={p.lang}>{p.text}</span>
          : <Fragment key={i}>{p.text}</Fragment>))}
      </p>
      {view.detail ? <p className="text-xs text-muted-foreground">{view.detail}</p> : null}
      {/* NEVER CLAMPED (the measured reason in today's proposals.tsx stands): the whole caller turn, so a
          late "...but not on Tuesday" is seen before anyone accepts. */}
      <p className="text-sm leading-6 text-muted-foreground">
        {view.labels.because}{" "}
        <q lang={view.evidenceLang} className="text-foreground">{view.evidence}</q>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span data-ai-mark className={AI_MARK_CLASS}>{view.personaMark}</span>
        <p className="inline-flex items-center gap-1.5 text-xs text-foreground">
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
