import type { EditableField } from "./field-input";

export type InlinePhoneUndo = (
  editedPhone: string, priorPhone: string, priorUnconfirmed: boolean,
) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * The inline field's Undo write (`components/inline-field.tsx`). Every field
 * but phone resubmits the prior TEXT through `save` — the field's ordinary
 * write path, exactly what an operator retyping the old value would do.
 *
 * The phone field cannot use that path once the field has since been edited
 * to a DIFFERENT number: a number already carrying a country code is "kept
 * as given" by the normaliser (F-009, `packages/db/src/phone.ts`'s
 * `international()` branch) and is never re-flagged from its text alone, so
 * resubmitting a flagged "+1…" number's prior text through the ordinary
 * write always comes back CONFIRMED (its flag cleared to `false`) — Task
 * 2's "an unchanged number keeps its flag" rule does not help here, because
 * the stored number is no longer the prior one; the write proceeds and
 * recomputes the flag from the prior TEXT, which `normalisePhone` never
 * flags once it carries a `+`.
 *
 * The phone field's undo instead calls the dedicated action
 * (`undoInlinePhoneEditAction`) that restores the number AND the flag
 * TOGETHER, as a compare-and-set on the number the edit wrote — never
 * re-deriving either from text.
 */
export async function commitInlineUndo(
  field: EditableField | undefined,
  priorValue: string,
  editedValue: string,
  priorUnconfirmed: boolean,
  save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>,
  undoPhone: InlinePhoneUndo | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (field === "phone" && undoPhone) {
    return undoPhone(editedValue, priorValue, priorUnconfirmed);
  }
  return save(priorValue);
}
