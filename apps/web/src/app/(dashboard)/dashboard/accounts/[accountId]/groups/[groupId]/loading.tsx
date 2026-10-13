"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordCard } from "@/components/record/record-card";
import { GROUP_RECORD_CARDS, columnRuns } from "@/lib/record/record-cards";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * The group page while its reads run (S-03 part 2, C17; DESIGN.md rule 7: skeletons shaped like the
 * content, no spinner). The same layout and the group's cards, in the registry's phone order, each
 * in its "loading" state; the locale is the account layout's, which wraps this boundary. 2a has no
 * middle column, so no timeline skeleton (2b adds it with the three middle cards).
 */
export default function Loading() {
  const locale = useLocale();
  const header = (
    <header data-record-skeleton-header aria-hidden className="space-y-1.5">
      <Skeleton className="h-4 w-20 rounded-[var(--radius-ctl)]" />
      <Skeleton className="h-[26px] w-48 rounded-[var(--radius-ctl)]" />
      <Skeleton className="h-4 w-24 rounded-[var(--radius-ctl)]" />
      <div className="flex gap-2 pt-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-11 w-24 rounded-[var(--radius-ctl)]" />)}
      </div>
    </header>
  );
  const columns = columnRuns(GROUP_RECORD_CARDS).map(({ column, cards }) => ({
    column,
    content: cards.map((def) => (
      <RecordCard key={def.id} id={def.id} title={t(m, def.titleKey, locale)} collapsibleOnPhone={def.collapsibleOnPhone}
        skeletonRows={def.skeletonRows} state="loading" />
    )),
  }));
  return (
    <div aria-busy="true">
      <RecordLayout lang={locale} skipLabel={t(m, "record.skipToDetails", locale)} header={header} columns={columns} />
    </div>
  );
}
