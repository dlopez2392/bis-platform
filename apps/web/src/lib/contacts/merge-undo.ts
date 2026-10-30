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
 * `names.otherName` is always the record the undo gives its OWN record back — the merge's `other`, or
 * the timeline row's own `otherFirstName`/`otherLastName` — never a second read. `names.keptName` is
 * the OTHER side: the record that absorbed the merge and keeps absorbing whatever arrives after it
 * (`undoneKept`/`undoneKeptOne`) or that was itself merged again since, blocking this Undo
 * (`undoLater`) — second fix round finding: both of those used to carry `otherName`, naming the wrong
 * record.
 */

const FIELD_KEY: Readonly<Record<string, MessageKey>> = {
  first_name: "contacts.merge.field.firstName", last_name: "contacts.merge.field.lastName",
  email: "contacts.merge.field.email", phone: "contacts.merge.field.phone",
  assigned_to: "contacts.merge.field.assignedTo", language: "contacts.merge.field.language",
  // Second fix round, carry-in 8: the rest of 0106's app.merge_fields_of groups (read-only) that
  // `keptEdits` can name by its group's own representative field. "custom" here is the WHOLE custom
  // jsonb column as one group (0106's c_groups), never a single key — that is the dotted
  // "custom.<key>" case just below, which keeps its own "<label>" field wording.
  last_language_signal: "contacts.merge.field.languageHint",
  custom: "contacts.merge.field.customFields",
  archived_at: "contacts.merge.field.archived",
  marketing_email_opted_out_at: "contacts.merge.field.emailOptOut",
};

/** The field noun both the compare screen's radios and the Undo toast's "Kept what was changed…"
 *  line read off — one function, not two copies. `customFieldNames` (fix round, carry-in 10: the
 *  compare screen's own custom field DEFINITIONS, field_key -> name) lets a `custom.<key>` conflict
 *  show the field's real label; with none given (every other caller, including the Undo toast, which
 *  never sees a dotted custom key in practice — 0106's own "custom" group is the WHOLE column), the
 *  raw key is still the fallback it always was. Any OTHER unmapped group name (fix round, carry-in 8)
 *  reads a generic word, never its raw snake_case key. */
export function fieldLabel(field: string, locale: Locale, customFieldNames?: Readonly<Record<string, string>>): string {
  if (field.startsWith("custom.")) {
    const key = field.slice("custom.".length);
    return t(m, "contacts.merge.field.custom", locale, { label: customFieldNames?.[key] ?? key });
  }
  const key = FIELD_KEY[field];
  return key ? t(m, key, locale) : t(m, "contacts.merge.field.other", locale);
}

export type UndoMergeResult =
  | { ok: true; keptNew: number; keptEdits: string[] }
  | { ok: false; errorKey: MessageKey };
export type UndoMergeAction = (mergeId: number) => Promise<UndoMergeResult>;

/** The two records' display names `runUndoMerge` needs: `otherName` for `contacts.merge.undone`
 *  (that record is "back as its own record"), `keptName` for `undoneKept`/`undoneKeptOne`/`undoLater`
 *  (that record keeps what arrived since, or was itself merged again since). */
export type UndoMergeNames = { otherName: string; keptName: string };

/**
 * Fails closed: a rejected `undoAction` toasts `contacts.merge.undoFailed` and this still RESOLVES
 * (never an unhandled rejection) — finding #3. Every refusal travels through `t()` with a `{name}` —
 * `names.keptName` for `undoLater` (the record merged again since is the KEPT one), `names.otherName`
 * for the other two keys, which carry no `{name}` placeholder at all: an unused param is silently
 * ignored by `interpolate` (lib/i18n/t.ts), so passing either is never wrong, and `undoLater`'s own
 * `{name}` is never left raw on screen (finding #2).
 */
export async function runUndoMerge(
  undoAction: UndoMergeAction, mergeId: number, names: UndoMergeNames, locale: Locale, onDone: () => void,
): Promise<void> {
  let r: UndoMergeResult;
  try {
    r = await undoAction(mergeId);
  } catch {
    toast.error(t(m, "contacts.merge.undoFailed", locale, { name: names.otherName }));
    return;
  }
  if (!r.ok) {
    const name = r.errorKey === "contacts.merge.undoLater" ? names.keptName : names.otherName;
    toast.error(t(m, r.errorKey, locale, { name }));
    return;
  }
  const lines: string[] = [];
  if (r.keptNew > 0) {
    lines.push(r.keptNew === 1
      ? t(m, "contacts.merge.undoneKeptOne", locale, { name: names.keptName })
      : t(m, "contacts.merge.undoneKept", locale, { count: r.keptNew, name: names.keptName }));
  }
  if (r.keptEdits.length > 0) {
    const list = new Intl.ListFormat(locale === "es" ? "es-US" : "en-US", { type: "conjunction" })
      .format(r.keptEdits.map((f) => fieldLabel(f, locale)));
    lines.push(t(m, "contacts.merge.undoneEdits", locale, { list }));
  }
  toast.success(t(m, "contacts.merge.undone", locale, { name: names.otherName }), lines.length > 0 ? { description: lines.join(" ") } : undefined);
  onDone();
}
