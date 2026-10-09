import type { FormField, FormRow, FormStatus, FormTheme, CustomFieldDef } from "@bis/db";
import { m } from "@/lib/messages";

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
 * The words shown for one field kind in the editor — the sidebar's own
 * category tag AND the SEEDED default value of a new field's
 * customer-facing `label` when `addField` first adds it (form-editor.tsx).
 * Two different readers of the same string, extracted here (not a DOM
 * renderer, same reasoning `shouldWarnOnUnpublish`/`statusAfterUndo` were
 * pulled out for) so the locale behaviour is directly testable.
 *
 * `locale`, when given, is the FORM's own `locale_default` — never an
 * "operator locale" (review round 1 correction of a stale comment at
 * messages.ts: there is no such thing here; the dashboard's own chrome
 * carries no live i18n and always reads English, which is exactly why the
 * two call sites that render the editor's sidebar tag omit this argument
 * and get English regardless of the form's locale — only the ONE call
 * site that SEEDS a new field's customer-facing label passes it). A kind
 * with no `.es` twin (every core kind but `core.referral_source` today)
 * falls back to English even for a Spanish-locale form, same as before
 * this rider.
 */
export function kindLabel(
  kind: string, customFields: CustomFieldDef[], locale?: FormRow["locale_default"],
): string {
  const key = `forms.kind.${kind}` as keyof typeof m;
  if (m[key]) {
    if (locale === "es") {
      const esKey = `forms.kind.${kind}.es` as keyof typeof m;
      if (m[esKey]) return m[esKey] as string;
    }
    return m[key] as string;
  }
  const fieldKey = kind.slice("custom.".length);
  return customFields.find((f) => f.field_key === fieldKey)?.name ?? fieldKey;
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

/**
 * The fields a brand-new form starts with (F-047 phase 1 defect fix,
 * docs/crm-features.md §2.3: "the seeded Name field"). The old seed carried
 * one name field — kind `core.first_name`, labeled plainly "Name" — and
 * nowhere for a last name to go. A visitor reads "Name" and types a full
 * name; it all lands in `first_name`, and `fileLead` in
 * `lib/concierge/lead.ts` (the web chat's own lead-filing path) does the
 * same thing deliberately WHEN a form has no `core.last_name` field: it
 * stuffs the whole name in rather than silently dropping half of it. That
 * fallback is correct for a form that truly has no surname field; the bug
 * was the default form never having one. Seeding both, labeled truthfully,
 * is the same shape the demo form already uses
 * (packages/db/src/demo/seed.ts:810-811) and makes `fileLead`'s split-by-
 * kind path (`hasSurnameField`) actually split going forward.
 */
export function defaultFormFields(): FormField[] {
  return [
    { key: "first_name", kind: "core.first_name", label: "First name", required: true },
    { key: "last_name", kind: "core.last_name", label: "Last name", required: false },
    { key: "email", kind: "core.email", label: "Email", required: true },
    { key: "message", kind: "message", label: "How can we help?", required: false },
  ];
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

/**
 * Owner context (forms tracker batch 4): true when the operator is about to
 * take a form OFF "published" while a website assistant files its leads
 * into it (`findConciergeDestinationName`, packages/db/src/forms.ts).
 * D-048 already stops the live chat from answering once that happens
 * (`getVoiceProfileByPublicId`, packages/db/src/concierge.ts) — this is the
 * half that was missing: nothing told the operator making the change what
 * they were about to break.
 *
 * `currentStatus` is the form's last SAVED status (there is nothing to warn
 * about leaving if it was never live), `nextStatus` is the pending Select
 * value, and `conciergeAssistantName` is null when no assistant is wired to
 * this form at all. Pure and DB-free on purpose: the editor's own Select
 * state is the only thing that changes turn to turn, and a decision this
 * small does not need the fetch that found the assistant's name re-run on
 * every keystroke.
 */
export function shouldWarnOnUnpublish(
  currentStatus: FormStatus, nextStatus: FormStatus, conciergeAssistantName: string | null,
): boolean {
  return conciergeAssistantName != null
    && currentStatus === "published" && nextStatus !== "published";
}

/**
 * The state transition after clicking Undo on the unpublish-warning toast
 * (fix round 1 review item 1): the Status Select was uncontrolled
 * (`defaultValue={form.status}` — Radix reads it exactly once), so a
 * successful republish left the visible control, and the `status` state
 * `shouldWarnOnUnpublish` reads, still showing the status that was just
 * undone — the warning reappeared on an already-published form, and the
 * next Save unpublished it again. `ok: false` leaves `currentStatus`
 * untouched: nothing changed on the row, so nothing should change on
 * screen either.
 */
export function statusAfterUndo(
  result: { ok: true } | { ok: false; error: string },
  currentStatus: FormStatus,
): FormStatus {
  return result.ok ? "published" : currentStatus;
}
