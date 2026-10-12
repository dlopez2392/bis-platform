"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import { RecordLayout } from "@/components/record/record-layout";
import { RecordCard } from "@/components/record/record-card";
import { TimelineItemSkeleton } from "@/components/record/timeline-item";
import { columnRuns } from "@/lib/record/record-cards";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

/**
 * The record page while its reads run (final review I1, DESIGN.md rule 7: skeletons shaped like the
 * content, no spinner). The same layout and the same nine cards, in the registry's order, each in
 * its "loading" state; the locale is the account layout's, which wraps this boundary.
 */
export default function Loading() {
  const locale = useLocale();
  const header = (
    <header data-record-skeleton-header aria-hidden className="space-y-1.5">
      <Skeleton className="h-4 w-20 rounded-[var(--radius-ctl)]" />
      <Skeleton className="h-[26px] w-48 rounded-[var(--radius-ctl)]" />
      <div className="flex gap-2 pt-2">
        {[0, 1].map((i) => <Skeleton key={i} className="h-11 w-24 rounded-[var(--radius-ctl)]" />)}
      </div>
    </header>
  );
  const columns = columnRuns().map(({ column, cards }) => ({
    column,
    content: cards.map((def) => (
      <RecordCard key={def.id} id={def.id} title={t(m, def.titleKey, locale)} collapsibleOnPhone={def.collapsibleOnPhone}
        skeletonRows={def.skeletonRows} state="loading"
        // Rule 7: the timeline loads as its own rows (mark chip, line, time), not generic lines.
        skeleton={def.id === "timeline" ? <TimelineItemSkeleton rows={def.skeletonRows} /> : undefined} />
    )),
  }));
  return (
    <div aria-busy="true">
      <RecordLayout lang={locale} skipLabel={t(m, "record.skipToDetails", locale)} header={header} columns={columns} />
    </div>
  );
}
