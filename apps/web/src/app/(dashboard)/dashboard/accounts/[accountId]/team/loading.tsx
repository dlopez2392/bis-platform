"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { TeamSkeleton } from "@/components/team/team-card";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** Shaped like the loaded page (rule 7, no spinners): the header, then the
 *  same TeamSkeleton the page's own Suspense boundary falls back to.
 *
 *  S-10 T9a: `loading.tsx` is a special Next.js file and receives no
 *  `params`/`searchParams` at all — it cannot call `requestLocale` the way
 *  team/page.tsx does. It CAN read the shell's own already-resolved locale
 *  from `LocaleProvider` (dashboard/layout.tsx seeds it from the same
 *  `users.language`/`accounts.language` inputs `requestLocale` reads) with
 *  NO new data read of its own — the same context the sidebar and topbar
 *  already consume while this is showing — so this reads it from there
 *  rather than rendering English to a Spanish reader. */
export default function Loading() {
  const locale = useLocale();
  return (
    <div className="p-6" lang={locale} aria-busy="true" aria-label={t(m, "team.loading", locale)}>
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <TeamSkeleton locale={locale} />
    </div>
  );
}
