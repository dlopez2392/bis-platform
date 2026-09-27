import type { EditableField } from "./field-input";

/**
 * What `updateContactFieldAction` hands back after a PHONE save, so the
 * Undo can restore exactly what the server stored — server-authoritative
 * (orchestrator design, review C1/I1 of the first version): `priorPhone`
 * and `priorUnconfirmed` are read from the CONTACT ROW before the write
 * (never the client's summary, which can be stale — the drawer's own
 * `retryNonce` is never bumped by an inline edit — or defaulted to `false`
 * while loading or on a failed fetch); `editedPhone` is the STORED value
 * after the write (E.164, or kept-as-typed), read back rather than assumed
 * to equal the typed text (`normalizeFieldInput` only trims/validates
 * shape; the column can hold something else entirely once `phoneFields`
 * has run on it — a formatted "(956) 292-1696" is stored as "+19562921696").
 */
export type PhoneInlineUndo = {
  priorPhone: string;
  priorUnconfirmed: boolean;
  editedPhone: string;
};

export type InlinePhoneUndoWrite = (
  undo: PhoneInlineUndo,
) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * The inline field's Undo write (`components/inline-field.tsx`). Every field
 * but phone resubmits the prior TEXT through `save` — the field's ordinary
 * write path, exactly what an operator retyping the old value would do.
 *
 * The phone field cannot use that path: a number already carrying a country
 * code is "kept as given" by the normaliser (F-009,
 * `packages/db/src/phone.ts`'s `international()` branch) and is never
 * re-flagged from its text alone, so resubmitting the prior TEXT through the
 * ordinary write can come back CONFIRMED even when it should not. The phone
 * field's undo instead hands back the exact `PhoneInlineUndo` the SAVE
 * itself returned (never a client-captured flag) to the dedicated action,
 * which restores the number AND the flag together as a compare-and-set on
 * the number the edit actually wrote.
 */
export async function commitInlineUndo(
  field: EditableField | undefined,
  priorValue: string,
  phoneUndo: PhoneInlineUndo | undefined,
  save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>,
  undoPhone: InlinePhoneUndoWrite | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (field === "phone" && phoneUndo && undoPhone) {
    return undoPhone(phoneUndo);
  }
  return save(priorValue);
}
