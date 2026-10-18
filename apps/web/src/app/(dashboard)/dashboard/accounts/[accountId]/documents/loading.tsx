"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/** Rule 7: shaped like the page (a header block, then the list's rows: an icon, a title and a line of
 *  facts, the Documents card's own skeleton row), so nothing jumps when the real list lands. No spinner.
 *  The busy region is named for the page in the reader's language (the account layout's LocaleProvider):
 *  the i18n ratchet starts a new file at zero un-catalogued copy, so an English-only "Loading" is out. */
export default function Loading() {
  const locale = useLocale();
  return (
    <div className="p-6" aria-busy="true" aria-label={t(m, "documents.page.title", locale)} lang={locale}>
      <Skeleton className="mb-6 h-[76px] rounded-[var(--radius-card)]" />
      <div data-documents-page-skeleton className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-3 border-t border-[var(--row-line)] px-4 py-3 first:border-t-0">
            <Skeleton className="size-4 shrink-0 rounded-[var(--radius-ctl)]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={i === 2 ? "h-4 w-1/2 rounded-[var(--radius-ctl)]" : "h-4 w-2/3 rounded-[var(--radius-ctl)]"} />
              <Skeleton className="h-3 w-5/6 rounded-[var(--radius-ctl)]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
