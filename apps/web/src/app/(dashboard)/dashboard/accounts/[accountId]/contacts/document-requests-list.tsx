"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/lib/i18n/locale";
import { t, plural } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { expiresInDays, type DocumentRequestsLoad, type OpenRequestView } from "@/lib/document-requests/requests-load";

/**
 * The open requests (spec 4.2), a flat section under the card's file list: a mono label, then one row per
 * request with each item as a dot AND a word (rule 3: Received on --good, Waiting on --warn), the days
 * left, and ghost Copy link and Revoke (the card's Upload stays its one primary, rule 8). The rows open
 * nothing, so they have no hover target of their own; their buttons carry the focus ring. Its read is its
 * own: loading is a skeleton row, a failure is its own sentence with Retry, and neither touches the files
 * (spec 6). Nothing open draws nothing.
 */
const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const control = cn("min-h-11 md:min-h-8", focusRing);
const rowLine = "border-t border-[var(--row-line)] first:border-t-0";
const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

function expiresText(r: OpenRequestView, now: string, locale: Locale): string {
  const days = expiresInDays(r.expiresAt, now);
  return days === 0
    ? t(m, "documents.requests.expiresToday", locale)
    : plural(m, "documents.requests.expires", days, locale, { count: days });
}

export function DocumentRequestsList({ locale, load, onRetry, onCopy, onRevoke }: {
  locale: Locale; load: DocumentRequestsLoad; onRetry: () => void; onCopy: (id: string) => void; onRevoke: (id: string) => void;
}) {
  const tt = (key: MessageKey, params?: Record<string, string | number>) => t(m, key, locale, params);
  const labelId = useId();
  if (load.kind === "loading") {
    return (
      <div data-document-requests data-document-requests-skeleton aria-hidden="true" className="space-y-1.5 pt-1">
        <Skeleton className="h-3 w-16 rounded-[var(--radius-ctl)]" />
        <Skeleton className="h-4 w-2/3 rounded-[var(--radius-ctl)]" />
        <Skeleton className="h-3 w-1/3 rounded-[var(--radius-ctl)]" />
      </div>
    );
  }
  if (load.kind === "error") {
    return (
      <div data-document-requests role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <p className="text-muted-foreground">{tt("documents.requests.loadFailed")}</p>
        <Button type="button" size="sm" variant="ghost" className={control} onClick={onRetry}>{tt("documents.retry")}</Button>
      </div>
    );
  }
  const { requests, now } = load.data;
  if (requests.length === 0) return null;
  return (
    <section data-document-requests aria-labelledby={labelId} className="pt-1">
      <h3 id={labelId} className={LABEL}>{tt("documents.requests.label")}</h3>
      <ul>
        {requests.map((r) => (
          <li key={r.id} data-document-request={r.id} className={cn("flex flex-wrap items-start gap-x-2 gap-y-1 py-2", rowLine)}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-card-foreground">
                {r.items.map((i) => (
                  <li key={i.key} data-request-item={i.key} className="inline-flex min-w-0 items-center gap-1.5">
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", i.answered ? "bg-[var(--good)]" : "bg-[var(--warn)]")} />
                    {i.category === "other" && i.note
                      ? <span lang="">{i.note}</span>
                      : <span>{tt(`documents.category.${i.category}` as MessageKey)}</span>}
                    <span aria-hidden="true">·</span>
                    <span className="text-muted-foreground">{tt(i.answered ? "documents.requests.received" : "documents.requests.waiting")}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground tabular-nums">{expiresText(r, now, locale)}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="ghost" data-request-copy className={control} onClick={() => onCopy(r.id)}>
                {tt("documents.requests.copy")}
              </Button>
              <Button type="button" size="sm" variant="ghost" data-request-revoke className={control} onClick={() => onRevoke(r.id)}>
                {tt("documents.requests.revoke")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
