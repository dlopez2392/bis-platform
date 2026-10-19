import Link from "next/link";
import { cn } from "@/lib/utils";
import { AI_MARK_CLASS } from "@/components/ai-mark";
import type { Tr } from "@/lib/record/copy";
import type { SuggestionView } from "@/lib/proposals/view";
import { MONO_LABEL, STATUS_DOT } from "./suggestion-card";
import { SuggestionActions, type SuggestionActionProps } from "./suggestion-actions";
import { SuggestionParts } from "./suggestion-parts";
import { SuggestionRetry } from "./suggestion-retry";
import { focusFallback } from "./focus-fallback";

/**
 * The flat presentation of a suggestion (item 8b-2, spec 4.5 and 5.3): the same `SuggestionView` the card
 * renders, as a row inside a record card. Flat: --row-line rules between rows, never a glass card inside
 * the glass card (DESIGN.md, the record page and its drawer). It shows the change, the evidence, the
 * persona's mark and the status as dot and word (rule 3), and only ghost Accept and Discard: a flat row
 * has no primary at all (rule 8 as amended 2026-10-19); editing happens in the tray.
 */
export function SuggestionRow({ view, ...actions }: { view: SuggestionView } & SuggestionActionProps) {
  return (
    <li lang={view.lang} data-suggestion={view.id} data-status={view.status}
      className="flex min-w-0 flex-col gap-1.5 border-t border-[var(--row-line)] py-2.5 first:border-t-0">
      <p className="text-sm leading-6 break-words text-card-foreground"><SuggestionParts parts={view.parts} /></p>
      {view.detail ? <p className="text-xs text-muted-foreground">{view.detail}</p> : null}
      {/* Never clamped, as on the card: the whole caller turn is read before anyone accepts. */}
      <p className="text-xs leading-5 break-words text-muted-foreground">
        {view.labels.because}{" "}
        <q lang={view.evidenceLang} className="text-foreground">{view.evidence}</q>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span data-ai-mark className={AI_MARK_CLASS}>{view.personaMark}</span>
        <p data-status-line tabIndex={-1}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-ctl)] text-xs text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)]">
          <span data-status-dot className={cn("size-[7px] shrink-0 rounded-full", STATUS_DOT[view.status])} aria-hidden />
          <span data-status-word>{view.statusWord}</span>
        </p>
      </div>
      {view.reasonLine ? <p className="text-xs text-muted-foreground">{view.reasonLine}</p> : null}
      {view.decidedLine ? <p className="text-xs text-muted-foreground">{view.decidedLine}</p> : null}
      {view.canAct ? <SuggestionActions id={view.id} edit={view.edit} labels={view.labels} variant="row" {...actions} /> : null}
    </li>
  );
}

export type WaitingData = { ok: true; views: SuggestionView[] } | { ok: false };

/**
 * What's next's "Waiting for you" (item 8b-2, spec 5.3): above the card's own rows, a mono label, this
 * customer's pending suggestions as flat rows (at most five, the read's limit), then "Edit or see all in
 * To do". Its own boundary inside the card: empty is nothing at all (the card's own empty state stands),
 * an error is one line with Retry, and What's next's rows render whatever this section does. It is the
 * list the focus rule reads, so a decided row's leaving hands focus to the next row's Accept.
 */
export function WaitingSuggestions({ tr, data, seeAllHref, headingId = "waiting-suggestions", ...actions }: {
  tr: Tr; data: WaitingData; seeAllHref: string;
  /** Two copies on one page (the styleguide's locale columns) each need their own id (design review minor 4). */
  headingId?: string;
} & SuggestionActionProps) {
  if (data.ok && data.views.length === 0) return null;
  const id = headingId;
  return (
    // The last row leaves with the section: focus falls back to What's next's own heading, then the
    // page's, never <body> (design review I3).
    <section lang={tr.locale} aria-labelledby={id} data-waiting-suggestions data-suggestion-list
      data-focus-fallback={focusFallback('[data-record-card="next-up"] h2', "h1")}
      className="flex min-w-0 flex-col gap-1 border-b border-[var(--row-line)] pb-2">
      <h3 id={id} className={MONO_LABEL}>{tr.text("suggestions.waiting.heading")}</h3>
      {data.ok ? (
        <>
          <ul className="flex flex-col">
            {data.views.map((view) => <SuggestionRow key={view.id} view={view} {...actions} />)}
          </ul>
          <Link href={seeAllHref}
            className="inline-flex min-h-11 items-center self-start rounded-[var(--radius-ctl)] text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-[var(--ring-glow)] md:min-h-8">
            {tr.text("suggestions.waiting.seeAll")}
          </Link>
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
