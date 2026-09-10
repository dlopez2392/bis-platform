export const EDITABLE_FIELDS = [
  "first_name", "last_name", "email", "phone", "company_name",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Maps the snake_case column to updateContact's ContactInput key. */
export const FIELD_TO_INPUT_KEY: Record<EditableField, "firstName" | "lastName" | "email" | "phone" | "companyName"> = {
  first_name: "firstName", last_name: "lastName", email: "email",
  phone: "phone", company_name: "companyName",
};

/** Exported so CSV import validates an email exactly as inline editing does —
 *  two rules would mean a value the grid accepts and the importer rejects. */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[+()\-. \d]+$/;

export function normalizeFieldInput(
  field: EditableField, raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" }; // clearing is allowed — columns are nullable
  if (field === "email" && !EMAIL_SHAPE.test(value))
    return { ok: false, error: "That doesn't look like an email address." };
  if (field === "phone") {
    const digits = value.replace(/\D/g, "");
    if (!PHONE_CHARS.test(value) || digits.length < 7)
      return { ok: false, error: "That doesn't look like a phone number." };
  }
  return { ok: true, value };
}
