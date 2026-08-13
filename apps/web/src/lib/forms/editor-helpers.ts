import type { FormField, FormTheme } from "@bis/db";

/**
 * The key a newly added field gets, derived from the `kind` the editor is
 * adding. Custom fields are namespaced (`custom_<field_key>`) so a custom
 * contact field can never collide with a core field's key — `core.email` and
 * a custom field with `field_key: "email"` used to both produce the bare key
 * "email", and since both render `<input name="email">`, `FormData` keeps
 * only one value: the custom field's answer was silently and permanently
 * dropped from every submission.
 *
 * Existing forms saved before this fix may still carry an un-namespaced
 * custom key (e.g. `key: "email"` on a `kind: "custom.email"` field) — that
 * is fine and deliberately left alone. The runtime mapping from a submitted
 * answer back to its custom field (`enrich` in `app/f/[publicId]/actions.ts`)
 * keys off `field.kind.slice("custom.".length)`, never off `field.key`, so
 * nothing here needs a data migration.
 */
export function defaultFieldKey(kind: string): string {
  if (kind.startsWith("custom.")) return `custom_${kind.slice("custom.".length)}`;
  return kind.replace("core.", "");
}

/**
 * Builds the `theme` value to persist on save, preserving whatever the editor
 * does not expose (`mode`, `radius`) instead of replacing the whole object.
 *
 * `updateForm` writes `theme` as a full JSONB column replace, not a merge, and
 * the editor has never had a control for `theme.mode` or `theme.radius`.
 * As of M4b neither is READ either — the account's tenant theme carries the
 * form's mode and corners, the same call that retired the per-form accent —
 * so preserving them no longer protects live behaviour. It is kept because
 * they are still stored, still copied across accounts by blueprint capture
 * and apply, and quietly erasing a column's contents on the first Save after
 * a deploy is not a thing a save should do. Do not "simplify" this back to a
 * literal object.
 *
 * `transparentBackground` is what the editor manages, so it is always taken
 * from `edits`. `accent` used to live here too; the account's brand color
 * replaced it (see the 2026-08-08 brand-color spec), so the editor no longer
 * writes it and stored values are left in place, unread.
 */
export function mergeFormTheme(
  stored: FormTheme | undefined,
  edits: { transparentBackground: boolean },
): FormTheme {
  return {
    ...(stored ?? {}),
    transparentBackground: edits.transparentBackground,
  };
}

function isValidFormField(value: unknown): value is FormField {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === "string" && candidate.key.length > 0 &&
    typeof candidate.kind === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.required === "boolean"
  );
}

/**
 * Guards against a tampered hidden input rather than just confirming the
 * posted `fields` JSON parses. A tampered post could otherwise supply e.g.
 * `[{}]`, which parses fine, passes the "at least one field before
 * publishing" gate, and produces a published form with a broken field.
 */
export function isValidFormFieldList(value: unknown): value is FormField[] {
  return Array.isArray(value) && value.every(isValidFormField);
}
