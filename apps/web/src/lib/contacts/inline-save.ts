import { m } from "@/lib/messages";
import type { EditableField } from "./field-input";
import { commitInlineUndo, type PhoneInlineUndo, type InlinePhoneUndoWrite } from "./inline-phone-undo";

type WriteResult = { ok: true } | { ok: false; error: string };

/**
 * The inline Undo decision, in one place and testable without a DOM: whether
 * Undo is offered for this save at all, and the ONE write it runs. Returns
 * that write as a thunk (nothing runs until Undo is pressed), or `null` for
 * no Undo button.
 *
 * - Phone: offered exactly when the save handed back the server's own
 *   payload (`phoneUndo`), never because the prior text validates (round 3,
 *   CRITICAL: `commitInlineUndo` would have nothing to route to).
 * - A field with its own server-built undo (`undoWith`, the Business name,
 *   S-02 §6 row 3): offered exactly when the save returned `ownUndo`, and it
 *   runs `undoWith(ownUndo)` alone. Re-saving the prior text instead would
 *   relink the existing group but lose its role, pays flag and age. An
 *   unchanged name returns no payload, so there is nothing to undo.
 * - Every other field: re-save the prior text, offered only when that text
 *   passes the field's own rule (`priorValid`).
 */
export function planInlineUndo(a: {
  field: EditableField | undefined;
  prior: string;
  priorValid: boolean;
  phoneUndo: PhoneInlineUndo | undefined;
  ownUndo: unknown;
  save: (value: string) => Promise<WriteResult>;
  undoPhone: InlinePhoneUndoWrite | undefined;
  undoWith: ((payload: unknown) => Promise<WriteResult>) | undefined;
}): (() => Promise<WriteResult>) | null {
  const { field, prior, priorValid, phoneUndo, ownUndo, save, undoPhone, undoWith } = a;
  if (field === "phone") {
    return phoneUndo === undefined ? null : () => commitInlineUndo(field, prior, phoneUndo, save, undoPhone);
  }
  if (undoWith) {
    return ownUndo === undefined ? null : () => undoWith(ownUndo);
  }
  return priorValid ? () => commitInlineUndo(field, prior, undefined, save, undoPhone) : null;
}

/**
 * What a successful inline save shows (I3): the value the server STORED when
 * it says (`shown`, the Business name's canonical spelling), else the typed
 * text; and the toast. A save that changed nothing (`undoPayload` absent)
 * because the business is already on the list under another spelling says
 * so in words, rather than "saved" over a value it did not write.
 */
export function inlineSavedView(
  typed: string, label: string, result: { shown?: string; undoPayload?: unknown },
): { shown: string; kind: "saved" | "already"; message: string } {
  const shown = result.shown ?? typed;
  if (result.shown !== undefined && result.undoPayload === undefined && shown !== "" && shown !== typed) {
    return { shown, kind: "already", message: m["contact.business.alreadyAs"].replace("{name}", shown) };
  }
  return { shown, kind: "saved", message: m["inline.saved"].replace("{label}", label) };
}
