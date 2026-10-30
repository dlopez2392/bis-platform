"use client";

import { Merge, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimelineItem } from "@/components/record/timeline-item";
import { DuplicateLine } from "../accounts/[accountId]/contacts/duplicate-line";
import { DuplicatesList, type DuplicateRow } from "../accounts/[accountId]/contacts/duplicates-list";
import { MergeScreen, type Conflict } from "../accounts/[accountId]/contacts/merge/merge-screen";
import { mergeCountsList } from "@/lib/contacts/merge-copy";
import { reasonMessageKey } from "@/lib/contacts/duplicates";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { makeTr, type Tr } from "@/lib/record/copy";
import { formatDateTimeInZone, formatDateInZone } from "@/lib/format";
import type { DuplicatePair } from "@bis/db";

/**
 * F-006 part 1 (plan Task 11, spec §6.1, §6.4; fix round, design I1): the record header's (and the
 * drawer's) duplicate line, the timeline's merge/mergeUndone row with its own "Undo merge" while
 * `undo_until` is still in the future, the Possible-duplicates view's own row (`DuplicatesList`, with
 * its dismiss), and the compare screen's conflict layout (`MergeScreen`, a couple of conflicts, an
 * also-keeps line and a moves line) — all in English and Spanish. INERT (design M-9's own rule,
 * AiActsDemo's pattern): the timeline row's button here is plain markup with no handler, never the
 * real `UndoMergeButton`; `DuplicatesList`'s dismiss/undismiss and `MergeScreen`'s merge/undo are
 * no-op async functions that resolve "ok" without reaching any server action.
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

/** The Possible-duplicates view's own rows (duplicates-list.tsx), built the same way the real page
 *  builds them — `compareHref`/`reasonMessageKey`'s own words, never a hand-rolled copy of them. */
function duplicateRowsFor(tr: Tr): DuplicateRow[] {
  const foundOn = t(m, "contacts.duplicates.foundOn", tr.locale, { date: formatDateInZone(AT, ZONE, tr.locale) });
  return [
    {
      id: "flag-1", href: "#", aName: "Ana Reyes", bName: "María García",
      reasonText: t(m, reasonMessageKey("same_phone"), tr.locale), foundOnText: foundOn,
    },
    {
      id: "flag-2", href: "#", aName: "Ana Reyes", bName: "José Ruiz",
      reasonText: t(m, reasonMessageKey("same_name"), tr.locale), foundOnText: foundOn,
    },
  ];
}
const noOpDismiss = async () => ({ ok: true as const });

/** The compare screen's own conflict layout (merge-screen.tsx's `MergeScreen`): a couple of
 *  disagreeing fields, an "Also keeps" line and a "Moves to" line — the same component the real
 *  `/contacts/merge` route renders, with no-op actions (design M-9: inert). */
function conflictsFor(): Conflict[] {
  return [
    { field: "email", keepValue: "ana@example.com", otherValue: "ana.reyes@example.com", preselect: "keep" },
    { field: "phone", keepValue: "+1 956 555 0101", otherValue: "+1 956 555 0199", preselect: "other" },
  ];
}
const noOpMerge = async () => ({ ok: true as const, mergeId: 1, keptId: SELF });
const noOpUndo = async () => ({ ok: true as const, otherId: "c9", keptNew: 0, keptEdits: [] });

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
          <div data-sg-merge-duplicates-list className="min-w-0 rounded-[var(--radius-card)] border border-[var(--line)]">
            <DuplicatesList rows={duplicateRowsFor(tr)} locale={tr.locale} dismissAction={noOpDismiss} undismissAction={noOpDismiss} />
          </div>
          <div data-sg-merge-compare className="min-w-0 rounded-[var(--radius-card)] border border-[var(--line)]">
            <MergeScreen
              accountId={ACCOUNT}
              keep={{ id: SELF, name: "Ana Reyes" }}
              other={{ id: "c9", name: "María García" }}
              conflicts={conflictsFor()}
              alsoKeeps={["assigned_to"]}
              otherReach={{ phone: "+1 956 555 0199" }}
              movesText={mergeCountsList({ messages: 3, calls: 1 }, tr, tr.locale)}
              seen={{ keep: "a".repeat(32), other: "b".repeat(32) }}
              swapHref="#"
              locale={tr.locale}
              mergeAction={noOpMerge}
              undoAction={noOpUndo}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
