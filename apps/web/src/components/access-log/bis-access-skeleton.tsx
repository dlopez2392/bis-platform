"use client";

import { useLocale } from "@/components/locale-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * F-118 part 1 (spec 6.3, rule 7): three visit-row skeletons (label line, date line, sentence line) —
 * shaped like the content, never a spinner — plus the sr-only loading announcement for anyone reading
 * by screen reader while the section's own data is still in flight.
 */
export function BisAccessSkeleton() {
  const locale = useLocale();
  return (
    <div role="status" className="space-y-4">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} aria-hidden="true" className="space-y-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
      <span className="sr-only">{t(m, "accessLog.loading", locale)}</span>
    </div>
  );
}
