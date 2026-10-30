import { toast } from "sonner";
import { t } from "@/lib/i18n/t";
import { m, type MessageKey } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-006 part 1 (plan Tasks 10-11, fix round): the ONE place a merge's own Undo runs — the compare
 * screen's toast action (`contacts/merge/merge-screen.tsx`) and the timeline row's own "Undo merge"
 * button (`contacts/[contactId]/merge-undo.tsx`) both call this, instead of each carrying its own
 * copy of the toast-building logic (the fix round's own finding: the two copies had drifted — one
 * named the wrong record, neither supplied the `{name}` `contacts.merge.undoLater` needs).
 *
 * `otherName` is always the record the undo gives its OWN record back — the merge's `other`, or the
 * timeline row's own `otherFirstName`/`otherLastName` — never a second read, and never the KEPT
 * record's name: that is the bug this file fixes (finding #1).
 */

const FIELD_KEY: Readonly<Record<string, MessageKey>> = {
  first_name: "contacts.merge.field.firstName", last_name: "contacts.merge.field.lastName",
  email: "contacts.merge.field.email", phone: "contacts.merge.field.phone",
  assigned_to: "contacts.merge.field.assignedTo", language: "contacts.merge.field.language",
};

/** The field noun both the compare screen's radios and the Undo toast's "Kept what was changed…"
 *  line read off — one function, not two copies. */
export function fieldLabel(field: string, locale: Locale): string {
  if (field.startsWith("custom.")) return t(m, "contacts.merge.field.custom", locale, { label: field.slice("custom.".length) });
  return t(m, FIELD_KEY[field] ?? "contacts.merge.field.custom", locale, { label: field });
}

export type UndoMergeResult =
  | { ok: true; keptNew: number; keptEdits: string[] }
  | { ok: false; errorKey: MessageKey };
export type UndoMergeAction = (mergeId: number) => Promise<UndoMergeResult>;

/**
 * Fails closed: a rejected `undoAction` toasts `contacts.merge.undoFailed` and this still RESOLVES
 * (never an unhandled rejection) — finding #3. Every refusal travels through `t()` WITH
 * `{ name: otherName }` even the two keys that carry no `{name}` placeholder
 * (`contacts.merge.undoExpired`, `contacts.merge.undoFailed`): an unused param is silently ignored by
 * `interpolate` (lib/i18n/t.ts), so passing it is never wrong, and `undoLater`'s own `{name}` — the
 * only one of the three that has it — is never left raw on screen (finding #2).
 */
export async function runUndoMerge(
  undoAction: UndoMergeAction, mergeId: number, otherName: string, locale: Locale, onDone: () => void,
): Promise<void> {
  let r: UndoMergeResult;
  try {
    r = await undoAction(mergeId);
  } catch {
    toast.error(t(m, "contacts.merge.undoFailed", locale, { name: otherName }));
    return;
  }
  if (!r.ok) { toast.error(t(m, r.errorKey, locale, { name: otherName })); return; }
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
