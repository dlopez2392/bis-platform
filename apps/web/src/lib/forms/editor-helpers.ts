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
 * the editor has no control for `theme.mode` or `theme.radius` even though
 * both are live: the public page toggles a dark class on `theme.mode ===
 * "dark"`, and the form sets `--radius` from `theme.radius`. Building the
 * patch from a literal object here would silently and permanently erase
 * those keys for any form that carries them the first time an operator opens
 * the editor and clicks Save. Do not "simplify" this back to a literal
 * object — that reintroduces the clobber.
 *
 * `accent` and `transparentBackground` are exactly what the editor manages,
 * so they are always taken from `edits`, including the ability to clear
 * `accent` (an `undefined` value is dropped by `JSON.stringify`, clearing it
 * in storage).
 */
export function mergeFormTheme(
  stored: FormTheme | undefined,
  edits: { accent: string | undefined; transparentBackground: boolean },
): FormTheme {
  return {
    ...(stored ?? {}),
    accent: edits.accent,
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
