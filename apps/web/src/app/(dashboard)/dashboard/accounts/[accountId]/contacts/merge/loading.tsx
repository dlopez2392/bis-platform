"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * F-006 part 1 (plan Task 10): the compare screen's skeleton (DESIGN.md rule 7: no spinners) — two
 * columns on a desk, so nothing jumps when the real preview lands. Same idiom as tasks/loading.tsx: a
 * route's loading file reads no language of its own, so it takes the account layout's LocaleProvider.
 */
export default function Loading() {
  const locale = useLocale();
  return (
    <div className="p-6" lang={locale}>
      <Skeleton className="mb-6 h-10 w-48 rounded-lg" />
      <div aria-busy="true" aria-label={t(m, "contacts.merge.title", locale)} className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} data-merge-column className="space-y-3 rounded-xl border border-border p-4">
            <Skeleton className="h-5 w-32 rounded" />
            {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-4 w-full rounded" />)}
          </div>
        ))}
      </div>
    </div>
  );
}
