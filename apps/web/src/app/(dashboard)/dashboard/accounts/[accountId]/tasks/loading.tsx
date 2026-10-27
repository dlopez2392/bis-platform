"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionSectionSkeleton } from "@/components/proposals/suggestion-section";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { makeTr } from "@/lib/record/copy";

/** Shaped like the real layout (DESIGN.md rule 7: no spinners) — a header
 *  bar plus a bucket heading and a few row-height blocks, so nothing jumps
 *  when the real queue lands. Same idiom as website/loading.tsx. The
 *  Suggestions section's own skeleton (item 8b-1) sits under the bucket's,
 *  in the same busy region. A route's loading file gets no params and no
 *  searchParams, so it reads no language of its own: it takes the account
 *  layout's LocaleProvider through useLocale(), as documents/loading.tsx does,
 *  and names the busy region for the page ("To do" / "Pendientes") in it
 *  (F-085 follow-ups). Only the page's `?locale=` QA override, which the
 *  layout does not read, can differ from the page that lands. */
export default function Loading() {
  const locale = useLocale();
  return (
    <div className="p-6" lang={locale}>
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="space-y-6" aria-busy="true" aria-label={t(m, "work.title", locale)}>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16 rounded" />
          <div className="space-y-0 overflow-hidden rounded-xl border border-border">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] rounded-none" />)}
          </div>
        </div>
        {/* Grouped, as the loaded tray is (item 8b-2): a group heading's bar over the cards. */}
        <SuggestionSectionSkeleton tr={makeTr(locale)} grouped />
      </div>
    </div>
  );
}
