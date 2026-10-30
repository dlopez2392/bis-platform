"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { runUndoMerge } from "@/lib/contacts/merge-undo";
import { undoMergeAction } from "../merge-actions";

/**
 * F-006 part 1 (plan Task 11, spec §6.4; fix round): the merge row's own "Undo merge", while
 * `undo_until` is still in the future (owner ruling D7, 30 days). The merge's toast
 * (merge/merge-screen.tsx) carries its own Undo too; both call the SAME `runUndoMerge`
 * (lib/contacts/merge-undo.ts) now, so there is one place that names the record, one place that
 * supplies every error key's values, and one place that catches a rejected server action — not two
 * copies that can drift (the fix round's own finding).
 */

/**
 * Exported so this is testable without a DOM (archive-controls.ts's own exported-handler pattern).
 * `otherName` is the ROW's own other-person name, already known; never a second read. `mergeId` is a
 * NUMBER (mutation: pass the other record's string id instead -> the server call's own argument
 * shape is wrong and the test catches it by name).
 */
export async function undoMergeOne(
  accountId: string, mergeId: number, otherName: string, locale: Locale, onDone: () => void,
): Promise<void> {
  await runUndoMerge((id) => undoMergeAction(accountId, id), mergeId, otherName, locale, onDone);
}

/** The row's ghost control (DESIGN.md rule 8: never a second primary). `mergeId` is the STRING the
 *  row carries (`TimelineMerge.mergeId`); `Number(mergeId)` is what actually travels to the server.
 *  Its own router (ActUndo's own pattern): the record page re-reads itself after a success. */
export function UndoMergeButton({
  accountId, mergeId, otherName, locale,
}: { accountId: string; mergeId: string; otherName: string; locale: Locale }) {
  const router = useRouter();
  return (
    <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8" data-merge-undo-id={mergeId}
      onClick={() => void undoMergeOne(accountId, Number(mergeId), otherName, locale, () => router.refresh())}>
      {t(m, "timeline.undoMerge", locale)}
    </Button>
  );
}
