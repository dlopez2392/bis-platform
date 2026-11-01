"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/** Skeletons shaped like the real layout (DESIGN.md rule 7: no spinners), so
 *  nothing jumps when the numbers land. Also the body of the "waiting" state.
 *  The busy region is named for the page in the reader's own language
 *  (documents/loading.tsx's own pattern): `website.title`, not a bare
 *  "Loading" the i18n ratchet's JSX scan had no catalogue key for. */
export function WebsiteSkeleton() {
  const locale = useLocale();
  return (
    <div lang={locale} className="space-y-3" aria-busy="true" aria-label={t(m, "website.title", locale)}>
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}
      </div>
      <Skeleton className="h-[220px] rounded-lg" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[228px] rounded-lg" />)}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-4 h-[76px] rounded-lg" />
      <WebsiteSkeleton />
    </div>
  );
}
