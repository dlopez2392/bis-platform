"use client";

import { Merge, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimelineItem } from "@/components/record/timeline-item";
import { DuplicateLine } from "../accounts/[accountId]/contacts/duplicate-line";
import { mergeCountsList } from "@/lib/contacts/merge-copy";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { makeTr, type Tr } from "@/lib/record/copy";
import { formatDateTimeInZone } from "@/lib/format";
import type { DuplicatePair } from "@bis/db";

/**
 * F-006 part 1 (plan Task 11, spec §6.1, §6.4): the record header's (and the drawer's) duplicate
 * line, and the timeline's merge/mergeUndone row with its own "Undo merge" while `undo_until` is
 * still in the future, in English and Spanish. INERT (design M-9's own rule, AiActsDemo's pattern):
 * the row's button here is plain markup with no handler, never the real `UndoMergeButton`, which
 * would reach `merge-actions.ts`'s "use server" action.
 */
const ZONE = "America/Chicago";
const ACCOUNT = "acct_demo";
const SELF = "ct_demo_self";
const AT = "2026-10-20T16:00:00Z";
const LOCALES = [{ key: "en" as const, tr: makeTr("en") }, { key: "es" as const, tr: makeTr("es") }];
const CAPTION = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const RULE = "border-t border-[var(--row-line)] first:border-t-0";

function pairsFor(): DuplicatePair[] {
  return [
    { id: "pr1", a: { id: SELF, firstName: "Ana", lastName: "Reyes" }, b: { id: "c9", firstName: "María", lastName: "García" }, reason: "same_phone", strength: 1, createdAt: AT },
    { id: "pr2", a: { id: SELF, firstName: "Ana", lastName: "Reyes" }, b: { id: "c8", firstName: "José", lastName: "Ruiz" }, reason: "same_name", strength: 9, createdAt: AT },
  ];
}

function mergeRow(key: string, tr: Tr, undone: boolean) {
  const name = "María García";
  const verb = undone
    ? tr.text("timeline.mergeUndone", { name })
    : tr.text("timeline.merged", { name, list: mergeCountsList({ notes: 1, calls: 3 }, tr, tr.locale) });
  const head = {
    kind: undone ? "mergeUndone" : "merge", status: null, detail: null, verb,
    mark: { kind: "person" as const, label: "Dan López" },
    time: formatDateTimeInZone(AT, ZONE, tr.locale), dateTime: AT,
  };
  return (
    <div key={key} data-sg-merge={key} className={RULE}>
      <TimelineItem {...head} icon={undone ? Undo2 : Merge} action={undone ? null : (
        <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8">{t(m, "timeline.undoMerge", tr.locale)}</Button>
      )} />
    </div>
  );
}

export function MergeDemo() {
  return (
    <div className="flex min-w-0 w-full flex-col gap-6">
      {LOCALES.map(({ key, tr }) => (
        <div key={key} data-sg-merge-locale={key} lang={tr.locale}
          className="flex min-w-0 max-w-[480px] flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--line)] p-3">
          <p className={CAPTION}>{key}</p>
          <DuplicateLine accountId={ACCOUNT} contactId={SELF} pairs={pairsFor()} canMerge locale={tr.locale} />
          <div className="flex min-w-0 flex-col">
            {mergeRow("merge", tr, false)}
            {mergeRow("merge-undone", tr, true)}
          </div>
        </div>
      ))}
    </div>
  );
}
