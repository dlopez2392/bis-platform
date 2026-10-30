"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { m, type MessageKey } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { undoMergeAction, type UndoMergeActionResult } from "../merge-actions";

/**
 * F-006 part 1 (plan Task 11, spec §6.4): the merge row's own "Undo merge", while `undo_until` is
 * still in the future (owner ruling D7, 30 days). The merge's toast (T10's merge-screen.tsx) carries
 * its own Undo too, calling the same `undoMergeAction`; this file is the timeline row's copy, kept
 * here (not T10's) because it reads the ROW's own `otherFirstName`/`otherLastName` (`TimelineMerge`),
 * never a second read, for the toast's "{name}" — never the kept record's own name, which the row is
 * already on.
 */

const FIELD_KEY: Readonly<Record<string, MessageKey>> = {
  first_name: "contacts.merge.field.firstName", last_name: "contacts.merge.field.lastName",
  email: "contacts.merge.field.email", phone: "contacts.merge.field.phone",
  assigned_to: "contacts.merge.field.assignedTo", language: "contacts.merge.field.language",
};
/** T10's merge-screen.tsx own `fieldLabel`, restated here (not exported there, and that file is not
 *  mine to import from this one's worktree-shared-ownership boundary). */
function fieldLabel(field: string, locale: Locale): string {
  if (field.startsWith("custom.")) return t(m, "contacts.merge.field.custom", locale, { label: field.slice("custom.".length) });
  return t(m, FIELD_KEY[field] ?? "contacts.merge.field.custom", locale, { label: field });
}

/**
 * Exported so this is testable without a DOM (archive-controls.ts's own exported-handler pattern).
 * `otherName` is the ROW's own other-person name, already known; never a second read. `mergeId` is a
 * NUMBER (mutation: pass the other record's string id instead -> the server call's own argument
 * shape is wrong and the test catches it by name).
 */
export async function undoMergeOne(
  accountId: string, mergeId: number, otherName: string, locale: Locale, onDone: () => void,
): Promise<void> {
  let r: UndoMergeActionResult;
  try {
    r = await undoMergeAction(accountId, mergeId);
  } catch {
    toast.error(t(m, "contacts.merge.undoFailed", locale));
    return;
  }
  if (!r.ok) { toast.error(t(m, r.errorKey, locale)); return; }
  const lines: string[] = [];
  if (r.keptNew > 0) {
    lines.push(r.keptNew === 1
      ? t(m, "contacts.merge.undoneKeptOne", locale, { name: otherName })
      : t(m, "contacts.merge.undoneKept", locale, { count: r.keptNew, name: otherName }));
  }
  if (r.keptEdits.length > 0) {
    const list = new Intl.ListFormat(locale === "es" ? "es-US" : "en-US", { type: "conjunction" })
      .format(r.keptEdits.map((f) => fieldLabel(f, locale)));
    lines.push(t(m, "contacts.merge.undoneEdits", locale, { list }));
  }
  toast.success(t(m, "contacts.merge.undone", locale, { name: otherName }), lines.length > 0 ? { description: lines.join(" ") } : undefined);
  onDone();
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
