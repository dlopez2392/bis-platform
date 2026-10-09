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
export const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

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
    .is("form_submissions.spam_reason", null)
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
 * visible — a draft or an archived form answers with the same HTTP STATUS
 * (404) as a public_id that never existed.
 *
 * Status parity is not the same claim as "looks the same" (**owner decision,
 * F-102 review round**): a draft/archived form's not-found page MAY carry the
 * account's own name, logo and colour, while a public_id that never existed
 * never does. That is a deliberate, sanctioned distinction, not a leak —
 * `newPublicId()` mints ~60 bits of random id, so the only way anyone holds
 * one at all is having gotten the link FROM the business (an owner sharing a
 * draft form's link too early, say), and a stranger guessing a live account's
 * id by brute force is not a realistic threat this status code is defending
 * against. What must still never leak is the FINER distinction a status-404
 * response cannot reveal anyway: draft vs archived vs disabled are all one
 *"not available" to the visitor, branded or not.
 */
export async function getPublishedFormByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<FormRow | null> {
  const { data, error } = await db.from("forms").select(FORM_COLS)
    .eq("public_id", publicId).eq("status", "published").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormRow | null) ?? null;
}

/**
 * Public path, ANY status — a draft and an archived form both come back,
 * only a public_id that never existed returns null. `/f`'s own root layout
 * (moved to `[publicId]/layout.tsx` for F-102) needs this: deciding the
 * document's own `lang` and whether to show the account's brand on a
 * not-found page both have to happen for a draft too, above the page's own
 * "is this published" check — `getPublishedFormByPublicId` is the one
 * accessor allowed to fold "draft" into "doesn't exist", and narrowing a
 * second caller onto it would un-404 every draft on the live page the
 * moment they shared a query. The status check moves to the caller
 * (`page.tsx`'s own `notFound()` guard) instead — see that function's own
 * comment for why a draft/archived form's not-found MAY still be branded.
 */
export async function getFormByPublicId(
  db: SupabaseClient, publicId: string,
): Promise<FormRow | null> {
  const { data, error } = await db.from("forms").select(FORM_COLS)
    .eq("public_id", publicId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FormRow | null) ?? null;
}

/** The predicate `getPublishedFormByPublicId`'s SQL filter used to make for
 *  the caller — now spelled out so `/f`'s layout and page can share the
 *  SAME row (one query, via React `cache()`) and apply it independently:
 *  the layout needs it for lang/branding, the page for `notFound()`. */
export function isFormLive(form: Pick<FormRow, "status">): boolean {
  return form.status === "published";
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

// `key` identifies which consent field this is: a form can have more than one
// (e.g. "contact me" and "share with partners"), each enforced independently
// by `validate` and each recorded independently here — never collapsed to
// just the first, since that would mean the pipeline compels an agreement
// (the second checkbox) it cannot later prove was ever given.
export type SubmissionConsent = { key: string; given: boolean; text: string; at: string };

export type SubmissionInput = {
  answers: { key: string; label: string; value: string }[];
  attribution?: Record<string, string>;
  consent?: SubmissionConsent[] | null;
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
  consent: SubmissionConsent[] | null;
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

const SUBMISSION_CREATIONS_PAGE_SIZE = 1000;

/**
 * Raw `created_at` instants for REAL (non-spam) submissions in
 * `[fromIso, toIso)` — the form half of "leads captured". `spam_reason is
 * null` is the same predicate `listForms` uses for its own counts, kept in
 * the data layer beside it rather than re-expressed in the web app, so
 * "what counts as a real submission" has ONE definition. A honeypot hit is
 * not a lead and must never inflate a number a client is shown.
 *
 * This is the ONLY read of `form_submissions` the weekly report's "leads
 * captured" and the dashboard's CRM-only hero (F-076) both go through —
 * there used to be a second, count-only function here
 * (`countRealSubmissionsBetween`) that the report called instead; it was
 * removed once nothing but this row-returning read fed either caller, so
 * the predicate above has exactly one place it can drift from. Paged on
 * `id` (the table's primary key, 0006_forms.sql), stopping only on a
 * genuinely EMPTY page, the same shape `sumOpenOpportunities`
 * (opportunities.ts) uses: a row-returning read — unlike the removed
 * function's `count: "exact", head: true` — truncates at PostgREST's row
 * cap (max_rows) unless paged.
 */
export async function listSubmissionCreationsBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
  pageSize: number = SUBMISSION_CREATIONS_PAGE_SIZE,
): Promise<string[]> {
  const result: string[] = [];
  let lastId: string | undefined;
  for (;;) {
    let query = db.from("form_submissions")
      .select("id, created_at")
      .eq("account_id", accountId)
      .is("spam_reason", null)
      .gte("created_at", fromIso).lt("created_at", toIso)
      .order("id", { ascending: true });
    if (lastId !== undefined) query = query.gt("id", lastId);
    const { data, error } = await query.limit(pageSize);
    if (error) throw new Error(`listSubmissionCreationsBetween failed: ${error.message}`);
    const rows = (data ?? []) as { id: string; created_at: string }[];
    if (rows.length === 0) return result;
    for (const row of rows) result.push(row.created_at);
    lastId = rows[rows.length - 1]!.id;
  }
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
 * True when no rate_limited marker has been recorded for this (form, ip)
 * since `sinceIso`. Pass the same window start used for countRecentSubmissions
 * so a marker written for one burst suppresses further markers for the rest
 * of that window, while a later window still gets its own.
 *
 * This is a check-then-act race, not a hard cap: concurrent requests can all
 * run this SELECT before any of their markers commit, so more than one
 * marker can land in the same window. That is accepted, not fixed, because
 * rate-limit *enforcement* lives in countRecentSubmissions, which counts
 * every row regardless of spam_reason — a bot cannot escape throttling by
 * winning this race, it can only inflate the blocked-count and, bounded by
 * concurrency-per-window rather than by request count, table growth.
 */
export async function shouldRecordRateLimit(
  db: SupabaseClient, formId: string, ipHash: string, sinceIso: string,
): Promise<boolean> {
  const { data, error } = await db.from("form_submissions").select("id")
    .eq("form_id", formId).eq("ip_hash", ipHash).eq("spam_reason", "rate_limited")
    .gte("created_at", sinceIso).limit(1);
  if (error) throw new Error(`shouldRecordRateLimit failed: ${error.message}`);
  return !data || data.length === 0;
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

/**
 * `listForms` returns no `notify_emails`, so the checklist's "forms still
 * have no notification address" warning needs its own count rather than a
 * derived one.
 *
 * Scoped to `status = 'published'` (D-026): a draft cannot yet receive a
 * submission and an archived form no longer can, so neither has a lead to
 * lose — counting them left an operator unable to ever clear the checklist
 * item for a form deliberately left unpublished or already retired.
 */
export async function countFormsMissingNotify(
  db: SupabaseClient, accountId: string,
): Promise<number> {
  const { count, error } = await db.from("forms")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("status", "published").eq("notify_emails", "{}");
  if (error) throw new Error(`countFormsMissingNotify failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Owner context (forms tracker batch 4): the Forms page needs to warn an
 * operator who is about to take a PUBLISHED form off that status when a
 * website assistant (`voice_profiles.concierge_form_id`) files its leads
 * into it. D-048 already stops a LIVE chat from answering once its
 * destination is unpublished (`getVoiceProfileByPublicId`,
 * packages/db/src/concierge.ts) — this is the half that was missing:
 * nothing told the operator making that change what they were about to
 * break. Returns the assistant's `persona_name`, so the warning can name it
 * rather than say "an assistant".
 *
 * Reads `voice_profiles` rather than `forms`, and lives beside the forms
 * query that needs it rather than in concierge.ts (that file's own queries
 * are about the PUBLIC chat runtime, not the dashboard). Scoped to this
 * account on purpose: `concierge_form_id` carries no FK-level guarantee it
 * names a form in the SAME account as the profile before migration 0045
 * (concierge.ts's own comment on `DESTINATION_EMBED`), so the account_id
 * filter is what keeps a stale or cross-tenant pointer from ever naming an
 * assistant that is not actually this account's own.
 */
export async function findConciergeDestinationName(
  db: SupabaseClient, accountId: string, formId: string,
): Promise<string | null> {
  const { data, error } = await db.from("voice_profiles")
    .select("persona_name")
    .eq("account_id", accountId).eq("concierge_form_id", formId)
    .maybeSingle();
  if (error) throw new Error(`findConciergeDestinationName failed: ${error.message}`);
  return (data as { persona_name: string } | null)?.persona_name ?? null;
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
