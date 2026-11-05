"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History } from "lucide-react";
import { canPutBack, canRestore, type ChangeGroup } from "@bis/db";
import { Button } from "@/components/ui/button";
import type { ChangeRowView } from "@/lib/record/change-rows";
import type { Tr } from "@/lib/record/copy";
import type { HistoryActionResult } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/history-actions";
import { TimelineItem, type TimelineItemProps } from "./timeline-item";

/**
 * F-115 part 1 (S-04), plan Task 5: the change row — "who changed what", with "Put back" per field
 * and "Restore" on a removal, for 30 days. The disclosure is a native `<details>/<summary>`
 * (keyboard-reachable for free; feed-card.tsx's own precedent for the kit), its own summary text
 * swapping Show/Hide (plan: `history.showSteps`/`history.hideSteps`) via `onToggle`, never CSS alone.
 *
 * F-115 PR E fix (review I9): every string here goes through the page's own `tr: Tr` (never a bare
 * `t(m, key, locale)`), so the pseudo-locale's +35% padding and bracket-wrapping — turned on by
 * `makeTr(locale, pseudo)` — covers Put back, Restore, Was/Now, the disclosure's own Show/Hide and
 * the download link, exactly as it already covers everything else on the page. `putBackOne`/
 * `restoreOne` take `tr` for the SAME reason: their toasts fire from a button this file draws.
 */

/** `putBackAction`/`restoreAction` (`contacts/history-actions.ts`), `.bind(null, accountId, locale)`-ed
 *  by the page: both already take `changeId: number | string`, so a changeId built from a `ChangeRow`'s
 *  own `number` id (never a string the browser could have typed) always matches. */
export type ChangeAction = (changeId: number) => Promise<HistoryActionResult>;

/** Sonner's own default is 4s — long enough to READ, not to also find and click Undo. The other
 *  Undo-bearing toasts in this app already settled on 10s (`holding-move-handlers.ts`'s own
 *  `UNDO_WINDOW_MS`, `suggestion-handlers.ts`'s own `SUGGESTION_TOAST_MS`); matched here as a LOCAL
 *  constant rather than importing either, since neither is a shared cross-domain export and this
 *  feature's own reason for 10s is this comment, not theirs (review m14). */
const UNDO_TOAST_MS = 10_000;

/**
 * Put back one field (rule 6: runs at once, an Undo toast on success). Undo is itself a Put back of
 * the NEW row this write just created (`undo.changeId`) — the SAME action, called again, which is why
 * a stale Undo (the value changed again since) answers exactly like a stale Put back:
 * `history.putBack.changed`, never a crash. `ctx.isUndo` is set ONLY on that recursive call, so its
 * own done toast reads the neutral "Undone." (review m3) rather than re-asserting
 * "{field} is back to what it was.", which is true of the ORIGINAL put-back, not of undoing it — undo
 * puts the field back to what it was BEFORE that put-back ran, a different claim. A network failure
 * (never a stale-value refusal, which already has its own wording) reads its own generic, honest line
 * (review m10): never `history.notFound`, which claims the SPECIFIC row cannot be found. Exported for
 * a DOM-free test (`archive-controls.tsx`'s own `archiveOne` precedent: a plain async function).
 */
export async function putBackOne(
  putBack: ChangeAction, changeId: number, fieldLabel: string, ctx: { tr: Tr; onDone: () => void; isUndo?: boolean },
): Promise<void> {
  const { tr } = ctx;
  let r: HistoryActionResult;
  try {
    r = await putBack(changeId);
  } catch {
    toast.error(tr.text("history.putBack.failed"));
    return;
  }
  if (!r.ok) { toast.error(r.message); return; }
  ctx.onDone();
  if (ctx.isUndo) { toast.success(tr.text("history.undo.done")); return; }
  const message = tr.text("history.putBack.done", { field: fieldLabel });
  if (r.undo.changeId === null) { toast.success(message); return; }
  const undoId = r.undo.changeId;
  // Review m3: a one-shot guard on the toast's OWN action — sonner's button is not React state this
  // file controls, so a double click cannot be stopped by `disabled`; this stops it firing twice.
  let fired = false;
  toast.success(message, {
    duration: UNDO_TOAST_MS,
    action: {
      label: tr.text("history.undo"),
      onClick: () => {
        if (fired) return;
        fired = true;
        void putBackOne(putBack, undoId, fieldLabel, { ...ctx, isUndo: true });
      },
    },
  });
}

/**
 * F-115 PR E fix (review I8/m4): which field LINE, if any, gets a "Put back" button, and which
 * `ChangeRow.id` it sends. Pure and exported on purpose — a test can assert the exact id each
 * position sends without rendering or simulating a click (the bug I8 named: binding every button to
 * `group.rows[0]!.id` instead of that OWN line's `f.row.id` passed every test that only ever had ONE
 * field line, where the two values are identical by coincidence). Review m4: when the SAME field name
 * repeats across a folded group's steps (phone changed twice), only the NEWEST occurrence answers
 * "changed" against the record's current live value — an earlier occurrence's own `after` is already
 * stale (the later write moved it), so its compare-and-swap would only ever answer "it changed since",
 * never actually put anything back. `view.fields` is oldest-to-newest (`group.rows`'s own order), so
 * the newest occurrence of a field name is simply its LAST index.
 */
export function putBackTargets(fields: ReadonlyArray<ChangeRowView["fields"][number]>): ReadonlyArray<number | null> {
  const lastIndexOfField = new Map<string, number>();
  fields.forEach((f, i) => lastIndexOfField.set(f.field, i));
  return fields.map((f, i) => (lastIndexOfField.get(f.field) === i && canPutBack(f.row) ? f.row.id : null));
}

/** Pure, exported so a test can prove the swap WITHOUT simulating a click on the native `<details>`
 *  (there is no DOM renderer in apps/web to do that with — the mutation this guards, "always read
 *  history.showSteps", needs the `open: true` case actually exercised, not just the closed default). */
export function stepsSummaryLabel(open: boolean, tr: Tr): string {
  return tr.text(open ? "history.hideSteps" : "history.showSteps");
}

/**
 * Restore a removed unit, member, tag, relationship or place (rule 6: runs at once). A plain "done"
 * toast, with NO Undo action: `record-restore.ts` has no "undo a restore" path (the brief's own
 * instruction — stopped here, not invented; see the report's "What I stopped on"). A network failure
 * reads `history.restore.failed`'s own existing generic wording (review m10), never `history.notFound`.
 */
export async function restoreOne(
  restore: ChangeAction, changeId: number, name: string | null, ctx: { tr: Tr; onDone: () => void },
): Promise<void> {
  const { tr } = ctx;
  let r: HistoryActionResult;
  try {
    r = await restore(changeId);
  } catch {
    toast.error(tr.text("history.restore.failed"));
    return;
  }
  if (!r.ok) { toast.error(r.message); return; }
  ctx.onDone();
  toast.success(tr.text("history.restore.done", { name: name ?? "" }));
}

export type ChangeItemProps = {
  head: Pick<TimelineItemProps, "kind" | "mark" | "subject" | "verb" | "status" | "detail" | "time" | "dateTime">;
  group: ChangeGroup;
  view: ChangeRowView;
  tr: Tr;
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
 *  ghost button in the row's own action slot while a removal is still within its 30-day window.
 *  Review m3: each button disables itself while ITS OWN call is in flight (`pending`), so a double
 *  click cannot fire a second call that lands on an already-moved value and reports "changed since"
 *  right under a toast that just said the first one worked. */
export function ChangeItem({ head, group, view, tr, canWrite, nowMs, putBack, restore }: ChangeItemProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | "restore" | null>(null);
  const now = new Date(nowMs);
  const deleteRow = group.rows.find((r) => r.op === "delete");
  const showRestore = canWrite && deleteRow !== undefined && canRestore(deleteRow, now);
  const onDone = () => router.refresh();
  const CTL = "min-h-11 md:min-h-8";
  const putBackIds = putBackTargets(view.fields);

  const runRestore = async () => {
    setPending("restore");
    try { await restoreOne(restore, deleteRow!.id, view.removalName, { tr, onDone }); } finally { setPending(null); }
  };
  const runPutBack = async (id: number, fieldLabel: string) => {
    setPending(id);
    try { await putBackOne(putBack, id, fieldLabel, { tr, onDone }); } finally { setPending(null); }
  };

  return (
    <TimelineItem {...head} icon={History} action={showRestore ? (
      <Button type="button" variant="ghost" size="sm" className={CTL} data-change-restore="" disabled={pending === "restore"}
        onClick={() => void runRestore()}>
        {tr.text("history.restore")}
      </Button>
    ) : null}>
      {view.fields.length > 0 ? (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-change-detail=""
          className="rounded-[var(--radius-ctl)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
          <summary className={`flex ${CTL} cursor-pointer select-none items-center font-medium text-sm text-card-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}>
            {stepsSummaryLabel(open, tr)}
          </summary>
          <dl className="mt-2 space-y-3">
            {view.fields.map((f, i) => {
              const putBackId = putBackIds[i] ?? null;
              return (
                <div key={`${f.field}-${i}`} data-change-field={f.field} className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
                  <dd className="flex flex-col gap-x-3 gap-y-0.5 text-sm sm:flex-row sm:items-center">
                    <span className="text-card-foreground"><span className="text-muted-foreground">{tr.text("history.was")}</span> {f.was}</span>
                    <span className="text-card-foreground"><span className="text-muted-foreground">{tr.text("history.now")}</span> {f.now}</span>
                    {canWrite && putBackId !== null ? (
                      <Button type="button" variant="ghost" size="xs" className={CTL} data-change-put-back="" data-change-put-back-id={putBackId}
                        disabled={pending === putBackId} onClick={() => void runPutBack(putBackId, f.label)}>
                        {tr.text("history.putBack")}
                      </Button>
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </details>
      ) : null}
    </TimelineItem>
  );
}
