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

export type SubmissionConsent = { given: boolean; text: string; at: string };

export type SubmissionInput = {
  answers: { key: string; label: string; value: string }[];
  attribution?: Record<string, string>;
  consent?: SubmissionConsent | null;
  locale?: string;
  ipHash?: string;
  userAgent?: string;
  answersHash?: string;
};

export type SubmissionRow = {
  id: string;
  form_id: string;
  contact_id: string | null;
  answers: { key: string; label: string; value: string }[];
  attribution: Record<string, string>;
  consent: SubmissionConsent | null;
  locale: string | null;
  spam_reason: "honeypot" | "too_fast" | "rate_limited" | null;
  processing_error: string | null;
  created_at: string;
};

const SUBMISSION_COLS =
  "id, form_id, contact_id, answers, attribution, consent, locale, spam_reason, " +
  "processing_error, created_at";

function submissionRow(accountId: string, formId: string, input: SubmissionInput) {
  return {
    account_id: accountId,
    form_id: formId,
    answers: input.answers,
    attribution: input.attribution ?? {},
    consent: input.consent ?? null,
    locale: input.locale ?? null,
    ip_hash: input.ipHash ?? null,
    user_agent: input.userAgent ?? null,
    answers_hash: input.answersHash ?? null,
  };
}

/**
 * The first write of the pipeline and the only one that must not fail. Once
 * this row exists the lead cannot be lost, which is why it is deliberately
 * eventless: `form.submitted` is emitted later by `emitFormSubmitted`, once
 * the contact exists to name in it.
 */
export async function createSubmission(
  db: SupabaseClient, accountId: string, formId: string, input: SubmissionInput,
): Promise<{ id: string }> {
  const { data, error } = await db.from("form_submissions")
    .insert(submissionRow(accountId, formId, input)).select("id").single();
  if (error || !data) throw new Error(`createSubmission failed: ${error?.message}`);
  return { id: data.id };
}

/**
 * A blocked attempt, recorded rather than discarded so the operator can see
 * "37 blocked this week" instead of silence. Writes nothing else: no contact,
 * no message, no event, no notification.
 */
export async function recordRejectedSubmission(
  db: SupabaseClient, accountId: string, formId: string,
  input: SubmissionInput & { spamReason: "honeypot" | "too_fast" | "rate_limited" },
): Promise<{ id: string }> {
  const { data, error } = await db.from("form_submissions")
    .insert({ ...submissionRow(accountId, formId, input), spam_reason: input.spamReason })
    .select("id").single();
  if (error || !data) throw new Error(`recordRejectedSubmission failed: ${error?.message}`);
  return { id: data.id };
}

/**
 * Rate-limit counter. DB-backed, not in-process: on Vercel an in-process
 * counter is per-lambda, so it would reset unpredictably under concurrency and
 * enforce nothing. Counts accepted AND rejected rows, so a bot cannot reset its
 * own budget by tripping the honeypot.
 *
 * Takes no accountId: the caller has the form, not a tenant context.
 */
export async function countRecentSubmissions(
  db: SupabaseClient, formId: string, ipHash: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("form_submissions")
    .select("id", { count: "exact", head: true })
    .eq("form_id", formId).eq("ip_hash", ipHash).gte("created_at", sinceIso);
  if (error) throw new Error(`countRecentSubmissions failed: ${error.message}`);
  return count ?? 0;
}

/**
 * True when the newest row for this (form, ip) is not already a rate_limited
 * marker. Without this, every request in a burst would insert another marker,
 * each one raising the window count, and the table would grow without bound
 * for as long as the bot kept going. One marker per burst is enough to make
 * the throttling visible.
 */
export async function shouldRecordRateLimit(
  db: SupabaseClient, formId: string, ipHash: string,
): Promise<boolean> {
  const { data, error } = await db.from("form_submissions").select("spam_reason")
    .eq("form_id", formId).eq("ip_hash", ipHash)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error(`shouldRecordRateLimit failed: ${error.message}`);
  if (!data || data.length === 0) return true;
  return data[0]!.spam_reason !== "rate_limited";
}

export async function findRecentDuplicate(
  db: SupabaseClient, formId: string, ipHash: string, answersHash: string, sinceIso: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("form_submissions").select("id")
    .eq("form_id", formId).eq("ip_hash", ipHash).eq("answers_hash", answersHash)
    .gte("created_at", sinceIso).limit(1);
  if (error) throw new Error(`findRecentDuplicate failed: ${error.message}`);
  return data && data.length > 0 ? { id: data[0]!.id } : null;
}

export async function linkSubmissionContact(
  db: SupabaseClient, accountId: string, submissionId: string, contactId: string,
): Promise<void> {
  const { error } = await db.from("form_submissions").update({ contact_id: contactId })
    .eq("account_id", accountId).eq("id", submissionId);
  if (error) throw new Error(`linkSubmissionContact failed: ${error.message}`);
}

/**
 * Records that enrichment failed after the lead was safely stored. Deliberately
 * swallows its own error: it is the last line of the failure path, and throwing
 * here would replace a recorded partial failure with an unrecorded one.
 */
export async function setSubmissionProcessingError(
  db: SupabaseClient, accountId: string, submissionId: string, message: string,
): Promise<void> {
  const { error } = await db.from("form_submissions")
    .update({ processing_error: message.slice(0, 500) })
    .eq("account_id", accountId).eq("id", submissionId);
  if (error) console.error(`setSubmissionProcessingError failed: ${error.message}`);
}

export async function emitFormSubmitted(
  db: SupabaseClient, accountId: string,
  payload: { formId: string; submissionId: string; contactId: string | null },
): Promise<void> {
  await emit(db, accountId, "form.submitted", "form", payload, "system");
}

export async function listSubmissions(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<SubmissionRow[]> {
  const { data, error } = await db.from("form_submissions").select(SUBMISSION_COLS)
    .eq("account_id", accountId).eq("form_id", formId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as SubmissionRow[];
}

export async function listContactSubmissions(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<(SubmissionRow & { formName: string })[]> {
  const { data, error } = await db.from("form_submissions")
    .select(`${SUBMISSION_COLS}, forms(name)`)
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((r) => ({
    ...(r as SubmissionRow), formName: r.forms?.name ?? "",
  }));
}
