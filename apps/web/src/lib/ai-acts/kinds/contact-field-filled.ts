import type { ContactFieldName } from "@bis/db/proposal-rules";
import type { MessageKey } from "@/lib/messages";
import type { ActKindDef } from "./types";

export const FIELD_COLUMN: Readonly<Record<ContactFieldName, "first_name" | "last_name" | "email" | "phone">> = {
  firstName: "first_name", lastName: "last_name", email: "email", phone: "phone",
};
export const FIELD_LABEL: Readonly<Record<ContactFieldName, MessageKey>> = {
  firstName: "aiActs.field.firstName", lastName: "aiActs.field.lastName", email: "aiActs.field.email", phone: "aiActs.field.phone",
};

/** Whether the column still holds EXACTLY the stored value the act names. `restoreContactFieldIf` compares
 *  with `.eq(column, expected)`, byte for byte, so the display must too (review M-3): a case- or
 *  space-insensitive reading would offer an Undo the server then refuses as changed. */
export function holdsExactly(current: unknown, value: string): boolean {
  return typeof current === "string" && current === value;
}

/**
 * Sofía filled a blank field with what the caller said (decision 19 as amended 2026-10-19, D1). Undo puts
 * the old value back at once while the field still holds exactly hers (`restoreContactFieldIf`'s
 * compare-and-swap; `after.value` is the stored form the fill wrote, `fillContactBlanksReport`'s `written`).
 */
export const contactFieldFilledKind: ActKindDef<"contact_field_filled"> = {
  kind: "contact_field_filled",
  control: "field",
  describe(act, { tr }) {
    return { verb: tr.text("aiActs.verb.fieldFilled", { field: tr.text(FIELD_LABEL[act.target.field]), value: act.after.value }), detail: null };
  },
  stillSafe(act, facts) {
    const current = facts.contact ? facts.contact[FIELD_COLUMN[act.target.field]] : undefined;
    if (holdsExactly(current, act.after.value)) return { ok: true };
    return { ok: false, reason: facts.editors[act.id] ? "changedBy" : "changed" };
  },
};
