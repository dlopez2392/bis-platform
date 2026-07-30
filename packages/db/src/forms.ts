import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

export type FormFieldKind =
  | "core.first_name" | "core.last_name" | "core.email" | "core.phone" | "core.company_name"
  | `custom.${string}` | "message" | "consent";

export type FormField = {
  key: string;
  kind: FormFieldKind;
  label: string;
  placeholder?: string;
  required: boolean;
};

export type FormTheme = {
  accent?: string;
  radius?: string;
  mode?: "light" | "dark" | "auto";
  transparentBackground?: boolean;
};

export type FormStatus = "draft" | "published" | "archived";

export type FormRow = {
  id: string;
  account_id: string;
  public_id: string;
  name: string;
  status: FormStatus;
  fields: FormField[];
  theme: FormTheme;
  success_mode: "message" | "redirect";
  success_message: string | null;
  redirect_url: string | null;
  notify_emails: string[];
  locale_default: "en" | "es";
  created_at: string;
  updated_at: string;
};

export type FormSummary = Pick<FormRow, "id" | "public_id" | "name" | "status" | "created_at">
  & { submissionCount: number };

const FORM_COLS =
  "id, account_id, public_id, name, status, fields, theme, success_mode, success_message, " +
  "redirect_url, notify_emails, locale_default, created_at, updated_at";

// Crockford-ish: no l, o, 0 or 1, so a token read off a screen or a phone call
// cannot be mistyped into a different form. 32 symbols divides 256 exactly, so
// the modulo below is unbiased.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newPublicId(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function createForm(
  db: SupabaseClient, accountId: string,
  input: { name: string; fields?: FormField[]; localeDefault?: "en" | "es" },
  actorId: string,
): Promise<{ id: string; publicId: string }> {
  const publicId = newPublicId();
  const { data, error } = await db.from("forms")
    .insert({
      account_id: accountId,
      public_id: publicId,
      name: input.name,
      fields: input.fields ?? [],
      locale_default: input.localeDefault ?? "en",
    })
    .select("id").single();
  if (error || !data) throw new Error(`createForm failed: ${error?.message}`);
  await emit(db, accountId, "form.created", actorId, { formId: data.id, publicId });
  return { id: data.id, publicId };
}

export async function listForms(
  db: SupabaseClient, accountId: string,
): Promise<FormSummary[]> {
  const { data, error } = await db.from("forms")
    .select("id, public_id, name, status, created_at, form_submissions(count)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, public_id: r.public_id, name: r.name, status: r.status,
    created_at: r.created_at,
    submissionCount: r.form_submissions?.[0]?.count ?? 0,
  }));
}

export async function getForm(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<FormRow | null> {
  const { data, error } = await db.from("forms").select(FORM_COLS)
    .eq("account_id", accountId).eq("id", formId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormRow | null) ?? null;
}

/**
 * Public path. Deliberately takes no accountId: the request that reaches it is
 * unauthenticated and has no tenant context, so the account is read back off
 * the row and must never be taken from the caller. Only published forms are
 * visible — a draft is a 404, indistinguishable from a token that never
 * existed.
 */
export async function getPublishedFormByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<FormRow | null> {
  const { data, error } = await db.from("forms").select(FORM_COLS)
    .eq("public_id", publicId).eq("status", "published").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormRow | null) ?? null;
}

export async function updateForm(
  db: SupabaseClient, accountId: string, formId: string,
  patch: Partial<Pick<FormRow, "name" | "status" | "success_mode" | "success_message"
    | "redirect_url" | "notify_emails" | "locale_default">> & { fields?: FormField[]; theme?: FormTheme },
  actorId: string,
): Promise<void> {
  const { data, error } = await db.from("forms")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", formId)
    .select("id");
  if (error) throw new Error(`updateForm failed: ${error.message}`);
  // PostgREST reports a no-match update as success with zero rows. Without
  // this the caller cannot tell "saved" from "that form is not yours".
  if (!data || data.length === 0) throw new Error("updateForm failed: form not found in account");
  await emit(db, accountId, "form.updated", actorId,
    { formId, fields: Object.keys(patch) });
}
