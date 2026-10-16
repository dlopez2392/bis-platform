"use client";

import { useId } from "react";
import type { RequirableCategory } from "@bis/db/document-rules";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { checklistView, type RequirementView, type RequirementsLoad } from "@/lib/documents/requirements-load";

/**
 * The account's required documents on a customer's Documents card (S-07 2c, spec 5.4), a flat section
 * under the card's top row (document-requests-list.tsx's look: no box, row rules). Each gap is a dot AND
 * its words (rule 3: Missing and Checking on --warn, Expired on --crit), with ghost buttons only (the
 * card's Upload stays its one primary, rule 8): Missing and Expired offer "Ask the customer" and
 * "Upload"; a Checking row offers only "Not needed" (M5: its file is already there). While the upload
 * panel is open, no row offers Upload or Ask (I6: the panel's Upload is the one primary, and a row's
 * Upload would replace the staged batch). A skipped item stays listed, muted, with "Needed again" (D11),
 * and only someone who sees the whole account gets Not needed or Needed again (D1). The count is NOT
 * here: it is the card's top row (D9, RequirementsMeter below). Its read is its own: loading is a
 * skeleton line, a failure its own sentence with Retry, and nothing required draws nothing at all.
 */
const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const control = cn("min-h-11 md:min-h-8", focusRing);
const rowLine = "border-t border-[var(--row-line)] first:border-t-0";
const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em]";

type Props = {
  locale: Locale; load: RequirementsLoad; canSkip: boolean; canAsk: boolean; panelOpen: boolean;
  onAsk: (c: RequirableCategory) => void; onUpload: (c: RequirableCategory) => void;
  onSkip: (c: RequirableCategory) => void; onUnskip: (c: RequirableCategory) => void; onRetry: () => void;
};

export function DocumentChecklist(p: Props) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  if (p.load.kind === "loading") {
    return (
      <div data-document-checklist data-state="loading" aria-hidden="true">
        <Skeleton className="h-4 w-1/3 rounded-[var(--radius-ctl)]" />
      </div>
    );
  }
  if (p.load.kind === "error") {
    return (
      <div data-document-checklist data-state="error" role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <p className="text-muted-foreground">{tt("documents.checklist.loadFailed")}</p>
        <Button type="button" size="sm" variant="ghost" className={control} onClick={p.onRetry}>{tt("documents.retry")}</Button>
      </div>
    );
  }
  const v = checklistView(p.load.data);
  if (v.kind === "off") return null;
  return (
    // Complete with nothing skipped has no rows: the top row's "Complete" says it all (empty:hidden).
    <section data-document-checklist data-state="on" aria-label={tt("documents.checklist.label")} className="empty:hidden">
      {v.gaps.length + v.skipped.length > 0 ? (
        <ul>
          {v.gaps.map((item) => <GapRow key={item.category} item={item} {...p} />)}
          {v.skipped.map((item) => <SkippedRow key={item.category} item={item} {...p} />)}
        </ul>
      ) : null}
    </section>
  );
}

const categoryWord = (c: RequirableCategory, locale: Locale) => t(m, `documents.category.${c}` as MessageKey, locale);

/** Its buttons are described by its own words, so a screen reader hears "Upload, Missing: ID", never three bare "Upload"s. */
function GapRow({ item, ...p }: Props & { item: RequirementView }) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  const wordsId = useId();
  const c = item.category;
  const offersFile = (item.state === "missing" || item.state === "expired") && !p.panelOpen;
  return (
    <li data-checklist-item={c} data-checklist-state={item.state} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5", rowLine)}>
      <span id={wordsId} className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-sm text-card-foreground">
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", item.state === "expired" ? "bg-[var(--crit)]" : "bg-[var(--warn)]")} />
        {tt(`documents.checklist.${item.state}` as MessageKey, { category: categoryWord(c, p.locale) })}
      </span>
      <span className="flex flex-wrap gap-1">
        {offersFile && p.canAsk ? (
          <Button type="button" size="sm" variant="ghost" data-checklist-action="ask" data-checklist-category={c}
            aria-describedby={wordsId} className={control} onClick={() => p.onAsk(c)}>{tt("documents.request.open")}</Button>
        ) : null}
        {offersFile ? (
          <Button type="button" size="sm" variant="ghost" data-checklist-action="upload" data-checklist-category={c}
            aria-describedby={wordsId} className={control} onClick={() => p.onUpload(c)}>{tt("documents.upload")}</Button>
        ) : null}
        {p.canSkip ? (
          <Button type="button" size="sm" variant="ghost" data-checklist-action="skip" data-checklist-category={c}
            aria-describedby={wordsId} className={control} onClick={() => p.onSkip(c)}>{tt("documents.checklist.skip")}</Button>
        ) : null}
      </span>
    </li>
  );
}

function SkippedRow({ item, ...p }: Props & { item: RequirementView }) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, p.locale, params);
  const wordsId = useId();
  const c = item.category;
  return (
    <li data-checklist-item={c} data-checklist-state="skipped" className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5", rowLine)}>
      <span id={wordsId} className="min-w-0 flex-1 text-sm text-muted-foreground">
        {tt("documents.checklist.notNeeded", { category: categoryWord(c, p.locale) })}
      </span>
      {p.canSkip ? (
        <Button type="button" size="sm" variant="ghost" data-checklist-action="unskip" data-checklist-category={c}
          aria-describedby={wordsId} className={control} onClick={() => p.onUnskip(c)}>{tt("documents.checklist.unskip")}</Button>
      ) : null}
    </li>
  );
}

/**
 * "Required 2 of 3" for the Documents card's top row, beside "N files" (D9; rule 1: the denominator is
 * the count's context): the label in the Label role, the numbers tabular. Complete is a --good dot and
 * the word (rule 3). Nothing while the list is off, loading or failed (the section says those).
 */
export function RequirementsMeter({ locale, load }: { locale: Locale; load: RequirementsLoad }) {
  if (load.kind !== "ready") return null;
  const v = checklistView(load.data);
  if (v.kind === "off") return null;
  return (
    <span data-requirements-meter className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
      {v.complete ? (
        <>
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--good)]" />
          {t(m, "documents.checklist.complete", locale)}
        </>
      ) : (
        <>
          <span className={LABEL}>{t(m, "documents.checklist.label", locale)}</span>
          <span>{t(m, "documents.checklist.meter", locale, { met: v.met, required: v.required })}</span>
        </>
      )}
    </span>
  );
}
