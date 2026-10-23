"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/** Rule 7 (design review): shaped like the knowledge page, line for line — the header block, then one card
 *  with its version title and saved line, then the four sections (Facts, Services text, Business hours,
 *  Services & prices), each a heading and its lines, then the Older/Newer row. No spinner. The busy region is
 *  named in the reader's language (the account layout's LocaleProvider), the documents page's precedent. */
export default function Loading() {
  const locale = useLocale();
  const lines = [[1, 2], [1], [3, 2], [2, 3]] as const;
  return (
    <div className="p-6" aria-busy="true" aria-label={t(m, "voice.knowledge.loading", locale)} lang={locale}>
      <Skeleton className="mb-6 h-[76px] rounded-[var(--radius-card)]" />
      <div data-knowledge-skeleton="" className="max-w-2xl space-y-5 rounded-[var(--radius-card)] border border-[var(--line)] p-6">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28 rounded-[var(--radius-ctl)]" />
          <Skeleton className="h-3 w-64 max-w-full rounded-[var(--radius-ctl)]" />
        </div>
        {lines.map((section, i) => (
          <div key={i} data-knowledge-skeleton-section="" className="space-y-1.5">
            <Skeleton className="h-4 w-32 rounded-[var(--radius-ctl)]" />
            {section.map((width, j) => (
              <Skeleton key={j} className={width === 1 ? "h-3 w-3/4 rounded-[var(--radius-ctl)]" : width === 2 ? "h-3 w-1/2 rounded-[var(--radius-ctl)]" : "h-3 w-5/6 rounded-[var(--radius-ctl)]"} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-4 flex max-w-2xl items-center justify-between">
        <Skeleton className="h-8 w-20 rounded-[var(--radius-ctl)]" />
        <Skeleton className="h-8 w-20 rounded-[var(--radius-ctl)]" />
      </div>
    </div>
  );
}
