"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  createForm, getForm, updateForm, republishFormIfUnchanged,
  type FormField, type FormStatus,
} from "@bis/db";
import { m } from "@/lib/messages";
import { isValidFormFieldList, mergeFormTheme, defaultFormFields } from "@/lib/forms/editor-helpers";
// The public form's own validator, reused deliberately rather than a second
// regex — same reasoning settings/actions.ts records for setFromEmailAction.
import { isValidEmail } from "@/lib/forms/guards";

export async function createFormAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("name required");

  const { id } = await createForm(await dbForRequest(), accountId, {
    name,
    // A form with no fields cannot be published, so seed the fields every
    // lead form needs rather than opening an empty editor. See
    // `defaultFormFields`'s own comment for why first/last name are two
    // fields, not one labeled "Name" (F-047 phase 1 defect fix).
    fields: defaultFormFields(),
  }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/forms`);
  redirect(`/dashboard/accounts/${accountId}/forms/${id}`);
}

/**
 * D-024: a mistyped notify address or redirect URL used to fail the save by
 * THROWING, which `form-editor.tsx`'s catch block reduced to one generic
 * "Could not save the form." toast — and which a production Next.js deploy
 * reduces to an opaque digest before the operator's browser ever sees the
 * real reason at all (same production-redaction fact `action-feedback.ts`'s
 * own doc comment and `setFromEmailAction`/`setReportEmailsAction` in
 * settings/actions.ts are already built around). Every validation branch
 * below now RETURNS `{ ok: false, error }` instead, so the specific,
 * landscaper-copy reason reaches the toast verbatim. A `formId` missing from
 * the hidden input, and `updateForm` finding no row to update, stay thrown:
 * neither is something a mistyped address or URL could cause, and both read
 * as the genuine "this page may be stale, reload" case the crashed path
 * exists for.
 */
export async function saveFormAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  const formId = String(formData.get("formId") ?? "");
  if (!formId) throw new Error("formId required");

  // The editor posts the field list as JSON: it is an ordered array of objects,
  // which flat form fields cannot express without inventing an encoding.
  // Validated for shape, not just parseability: a tampered hidden input could
  // otherwise post e.g. `[{}]`, which parses fine and passes the "at least
  // one field before publishing" gate below, producing a published form with
  // a broken field.
  let fields: FormField[];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("fields") ?? "[]"));
    if (!isValidFormFieldList(parsed)) throw new Error("invalid field shape");
    fields = parsed;
  } catch {
    return { ok: false, error: m["forms.invalidFields"] };
  }

  const status = String(formData.get("status") ?? "draft") as FormStatus;
  if (status === "published" && fields.length === 0) {
    return { ok: false, error: m["forms.noFields"] };
  }

  const notifyEmails = String(formData.get("notifyEmails") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);

  // The parked minor closed here (recorded during the booking milestone as
  // "close BOTH later" alongside the settings report_emails field beside
  // it): this field has gone straight to storage, unvalidated, since it was
  // built — an operator's typo silently became a lead alert nobody would
  // ever get. Same reject-the-whole-save-on-the-first-bad-address shape as
  // the redirect URL check below, rather than dropping the bad address and
  // saving the rest, which would look identical to "saved" while quietly
  // losing a recipient.
  for (const email of notifyEmails) {
    if (!isValidEmail(email)) {
      return { ok: false, error: m["forms.invalidNotifyEmail"].replace("{value}", email) };
    }
  }

  // A javascript: (or other non-http) redirect URL was a real security hole
  // closed at two other layers this milestone (the public form page and
  // embed.js both refuse to navigate to a non-http(s) URL). This write path
  // is the remaining place such a value could be stored at all, so it is
  // rejected here too rather than trusted because "it's just an input type".
  // The type="url" attribute on the editor's <Input> is a client-side hint
  // only and enforces nothing server-side.
  const redirectUrl = String(formData.get("redirectUrl") ?? "").trim();
  if (redirectUrl) {
    let scheme: string | null = null;
    try {
      scheme = new URL(redirectUrl).protocol;
    } catch {
      scheme = null;
    }
    if (scheme !== "http:" && scheme !== "https:") {
      return { ok: false, error: m["forms.invalidRedirectUrl"] };
    }
  }

  const db = await dbForRequest();

  // `updateForm` writes `theme` as a full JSONB column replace, not a merge,
  // and this editor has no control for `theme.mode` or `theme.radius` even
  // though both are live (the public page toggles a dark class on
  // `theme.mode === "dark"`, and the form sets `--radius` from
  // `theme.radius`). Fetching the current row and merging keeps whatever
  // this editor doesn't manage untouched, instead of silently and
  // permanently erasing it the first time an operator opens the editor and
  // clicks Save. Do not "simplify" this back to a literal object — that
  // reintroduces the clobber. (`updateForm` itself keeps its replace
  // semantics, since other callers pass a complete object on purpose.)
  const current = await getForm(db, accountId, formId);
  if (!current) throw new Error("updateForm failed: form not found in account");
  const theme = mergeFormTheme(current.theme, {
    transparentBackground: formData.get("transparent") === "on",
  });

  await updateForm(db, accountId, formId, {
    name: String(formData.get("name") ?? "").trim(),
    status,
    fields,
    theme,
    success_mode: formData.get("successMode") === "redirect" ? "redirect" : "message",
    success_message: String(formData.get("successMessage") ?? "").trim() || null,
    redirect_url: redirectUrl || null,
    notify_emails: notifyEmails,
    locale_default: formData.get("locale") === "es" ? "es" : "en",
  }, userId);

  revalidatePath(`/dashboard/accounts/${accountId}/forms`);
  revalidatePath(`/dashboard/accounts/${accountId}/forms/${formId}`);
  return { ok: true };
}

/**
 * The Undo half of the Forms page's unpublish warning (owner context, forms
 * tracker batch 4; see `shouldWarnOnUnpublish`'s own doc comment). Revised
 * in fix round 1 (review item 2): the first version wrote `status:
 * "published"` through `updateForm` unconditionally, which bypassed "a
 * form needs at least one field before it can be published", could publish
 * a form that had never been published before, and let a STALE Undo toast
 * (clicked after the form's status changed again through some other save)
 * silently resurrect status the operator no longer intends.
 *
 * `expectedPriorStatus` is the status the unpublishing save actually wrote
 * — the toast passes it straight through from the save it was offered on,
 * never re-derived here. Every safety check now lives in
 * `republishFormIfUnchanged` (packages/db/src/forms.ts); this layer's only
 * job is the account-access guard and translating its three-way outcome
 * into the `{ ok, error }` shape the toast renders. A failure is reported,
 * never thrown — this runs from a toast's own action handler, with no form
 * around it to catch anything.
 */
export async function republishFormAction(
  accountId: string, formId: string, expectedPriorStatus: FormStatus,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  let outcome: "republished" | "stale" | "needs_fields";
  try {
    outcome = await republishFormIfUnchanged(db, accountId, formId, expectedPriorStatus, userId);
  } catch {
    return { ok: false, error: m["forms.republishFailed"] };
  }
  if (outcome === "needs_fields") return { ok: false, error: m["forms.noFields"] };
  if (outcome === "stale") return { ok: false, error: m["forms.undoStale"] };
  revalidatePath(`/dashboard/accounts/${accountId}/forms`);
  revalidatePath(`/dashboard/accounts/${accountId}/forms/${formId}`);
  return { ok: true };
}
