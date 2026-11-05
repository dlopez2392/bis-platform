"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History } from "lucide-react";
import { canPutBack, canRestore, type ChangeGroup } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { Button } from "@/components/ui/button";
import type { ChangeRowView } from "@/lib/record/change-rows";
import type { HistoryActionResult } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/history-actions";
import { TimelineItem, type TimelineItemProps } from "./timeline-item";

/**
 * F-115 part 1 (S-04), plan Task 5: the change row — "who changed what", with "Put back" per field
 * and "Restore" on a removal, for 30 days. The disclosure is a native `<details>/<summary>`
 * (keyboard-reachable for free; feed-card.tsx's own precedent for the kit), its own summary text
 * swapping Show/Hide (plan: `history.showSteps`/`history.hideSteps`) via `onToggle`, never CSS alone.
 */

/** `putBackAction`/`restoreAction` (`contacts/history-actions.ts`), `.bind(null, accountId, locale)`-ed
 *  by the page: both already take `changeId: number | string`, so a changeId built from a `ChangeRow`'s
 *  own `number` id (never a string the browser could have typed) always matches. */
export type ChangeAction = (changeId: number) => Promise<HistoryActionResult>;

/**
 * Put back one field (rule 6: runs at once, an Undo toast on success). Undo is itself a Put back of
 * the NEW row this write just created (`undo.changeId`) — the SAME action, called again — which is
 * why a stale Undo (the value changed again since) answers exactly like a stale Put back:
 * `history.putBack.changed`, never a crash. Exported for a DOM-free test (`archive-controls.tsx`'s
 * own `archiveOne` precedent: a plain async function, testable without rendering anything).
 */
export async function putBackOne(
  putBack: ChangeAction, changeId: number, fieldLabel: string, ctx: { locale: Locale; onDone: () => void },
): Promise<void> {
  const { locale } = ctx;
  let r: HistoryActionResult;
  try {
    r = await putBack(changeId);
  } catch {
    toast.error(t(m, "history.notFound", locale));
    return;
  }
  if (!r.ok) { toast.error(r.message); return; }
  ctx.onDone();
  const message = t(m, "history.putBack.done", locale, { field: fieldLabel });
  if (r.undo.changeId === null) { toast.success(message); return; }
  const undoId = r.undo.changeId;
  toast.success(message, {
    action: { label: t(m, "history.undo", locale), onClick: () => void putBackOne(putBack, undoId, fieldLabel, ctx) },
  });
}

/**
 * Restore a removed unit, member, tag, relationship or place (rule 6: runs at once). A plain "done"
 * toast, with NO Undo action: `record-restore.ts` has no "undo a restore" path (the brief's own
 * instruction — stopped here, not invented; see the report's "What I stopped on").
 */
export async function restoreOne(
  restore: ChangeAction, changeId: number, name: string | null, ctx: { locale: Locale; onDone: () => void },
): Promise<void> {
  const { locale } = ctx;
  let r: HistoryActionResult;
  try {
    r = await restore(changeId);
  } catch {
    toast.error(t(m, "history.notFound", locale));
    return;
  }
  if (!r.ok) { toast.error(r.message); return; }
  ctx.onDone();
  toast.success(t(m, "history.restore.done", locale, { name: name ?? "" }));
}

export type ChangeItemProps = {
  head: Pick<TimelineItemProps, "kind" | "mark" | "subject" | "verb" | "status" | "detail" | "time" | "dateTime">;
  group: ChangeGroup;
  view: ChangeRowView;
  locale: Locale;
  /** Owner/Staff/agency (`seesWholeAccount`); false for a Technician, who sees neither button (plan
   *  Task 5 Actions) — `history-actions.ts`'s own role refusal is the SERVER's fence; this is the
   *  SCREEN's, so a Technician is never shown a control that would only answer "not allowed". */
  canWrite: boolean;
  /** The server page's own clock (epoch ms, never `Date.now()` here — repo rule 7). */
  nowMs: number;
  putBack: ChangeAction;
  restore: ChangeAction;
};

/** One row per change group (spec §3's "Row grammar"): the author mark and verb on the flat
 *  `TimelineItem` every row sits on, an optional Was/Now disclosure (an update only), and a Restore
 *  ghost button in the row's own action slot while a removal is still within its 30-day window. */
export function ChangeItem({ head, group, view, locale, canWrite, nowMs, putBack, restore }: ChangeItemProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const now = new Date(nowMs);
  const deleteRow = group.rows.find((r) => r.op === "delete");
  const showRestore = canWrite && deleteRow !== undefined && canRestore(deleteRow, now);
  const onDone = () => router.refresh();
  const CTL = "min-h-11 md:min-h-8";
  return (
    <TimelineItem {...head} icon={History} action={showRestore ? (
      <Button type="button" variant="ghost" size="sm" className={CTL} data-change-restore=""
        onClick={() => void restoreOne(restore, deleteRow!.id, view.removalName, { locale, onDone })}>
        {t(m, "history.restore", locale)}
      </Button>
    ) : null}>
      {view.fields.length > 0 ? (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-change-detail=""
          className="rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
          <summary className={`flex ${CTL} cursor-pointer select-none items-center font-medium text-sm text-card-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}>
            {t(m, open ? "history.hideSteps" : "history.showSteps", locale)}
          </summary>
          <dl className="mt-2 space-y-3">
            {view.fields.map((f, i) => (
              <div key={`${f.field}-${i}`} data-change-field={f.field} className="space-y-1">
                <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                <dd className="flex flex-col gap-x-3 gap-y-0.5 text-sm sm:flex-row sm:items-center">
                  <span className="text-card-foreground"><span className="text-muted-foreground">{t(m, "history.was", locale)}</span> {f.was}</span>
                  <span className="text-card-foreground"><span className="text-muted-foreground">{t(m, "history.now", locale)}</span> {f.now}</span>
                  {canWrite && canPutBack(f.row) ? (
                    <Button type="button" variant="ghost" size="xs" className={CTL} data-change-put-back=""
                      onClick={() => void putBackOne(putBack, f.row.id, f.label, { locale, onDone })}>
                      {t(m, "history.putBack", locale)}
                    </Button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </TimelineItem>
  );
}
