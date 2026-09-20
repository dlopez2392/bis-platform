import {
  createSubmission, findRecentDuplicate, setSubmissionProcessingError,
  type FormField, type FormRow, type serviceDb,
} from "@bis/db";
import { enrich } from "@/lib/forms/enrich";
import {
  DUPLICATE_WINDOW_MS, hashAnswers, isValidEmail, isValidPhone, parseAttribution,
} from "@/lib/forms/guards";
import { normalizeLocale } from "@/lib/forms/public-strings";

/**
 * Files a lead into a published form WITHOUT a browser in the loop.
 *
 * This is the shared body of the two machine front doors onto the form
 * pipeline: `api/intake/[publicId]` (a trusted server posting JSON behind a
 * shared secret) and the website assistant's `capture_lead` tool (the model
 * filing what a visitor told it, from `api/assistant/[publicId]/chat`). Both
 * used to be one route; the tool made it two callers, and two callers of a
 * pipeline that writes CRM rows must never drift apart. The browser path
 * (`f/[publicId]/actions.ts`) is deliberately NOT a third caller: its guards
 * (render token age, honeypot, fill-time floor, per-IP rate) only make sense
 * for a form a person fills in, and it already shares `enrich`.
 *
 * WHAT IT CANNOT DO. Grant SMS consent. Consent is a box a person ticks under
 * the exact text they agreed to; neither a server nor a conversation is that.
 * Every consent field on the form is recorded as NOT given, which is what
 * keeps the instant text from going out — the same rule the public form
 * applies to an unticked optional box.
 */
export const INTAKE_MAX_VALUE_CHARS = 5000;
const CONSENT_KIND = "consent";

export type FileLeadInput = {
  form: FormRow;
  /** Raw answers keyed by the form's field keys. Unknown keys are ignored. */
  answers: Record<string, unknown>;
  locale: unknown;
  /** Who filed it, for duplicate scoping (≤ 60 chars, trimmed). */
  source: string;
  /** Raw attribution; only the allow-listed keys survive `parseAttribution`. */
  attribution: Record<string, unknown> | null | undefined;
  /** Absolute origin for links in the alert email, or null. */
  origin: string | null;
  userAgent: string;
  /** Overrides the source-derived duplicate key — the assistant passes the
   *  visitor's hashed IP so one visitor's repeat is caught, not everyone's. */
  ipHash?: string;
};

export type FileLeadResult =
  | { ok: true; submissionId: string; duplicate: boolean }
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string> }
  | { ok: false; error: "not saved" };

export function trimValue(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, INTAKE_MAX_VALUE_CHARS) : "";
}

/** The form's own validation, field by field: `required` and the two kinds
 *  with a shape. Returned as a map so a caller can name the field. */
export function validateAnswers(
  fields: FormField[], answers: { key: string; value: string }[],
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const f of fields) {
    if (f.kind === CONSENT_KIND) continue;
    const value = answers.find((a) => a.key === f.key)?.value ?? "";
    if (f.required && value === "") { fieldErrors[f.key] = "required"; continue; }
    if (value === "") continue;
    if (f.kind === "core.email" && !isValidEmail(value)) fieldErrors[f.key] = "invalid";
    if (f.kind === "core.phone" && !isValidPhone(value)) fieldErrors[f.key] = "invalid";
  }
  return fieldErrors;
}

export async function fileLead(
  db: ReturnType<typeof serviceDb>, input: FileLeadInput,
  /** Duplicate-key hasher, injected so the caller's keyed `hashIp` is used. */
  hashKey: (raw: string) => string,
): Promise<FileLeadResult> {
  const { form } = input;
  const fields: FormField[] = form.fields;
  const locale = normalizeLocale(trimValue(input.locale), form.locale_default);
  const answers = fields
    .filter((f) => f.kind !== CONSENT_KIND)
    .map((f) => ({ key: f.key, label: f.label, value: trimValue(input.answers[f.key]) }));

  const fieldErrors = validateAnswers(fields, answers);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, error: "invalid", fieldErrors };

  const source = input.source.trim().slice(0, 60) || "intake";
  const attribution = parseAttribution(new URLSearchParams(
    input.attribution && typeof input.attribution === "object"
      ? Object.fromEntries(Object.entries(input.attribution).map(([k, v]) => [k, trimValue(v)]))
      : {},
  ));
  const now = new Date().toISOString();
  const consentFields = fields.filter((f) => f.kind === CONSENT_KIND)
    .map((f) => ({ key: f.key, given: false, text: f.label, at: now }));
  const base = {
    answers,
    attribution,
    consent: consentFields.length > 0 ? consentFields : null,
    locale,
    // Not necessarily an IP: a server caller has none, so it is keyed on the
    // source and duplicate suppression scopes to that caller the way it
    // scopes to one visitor's address.
    ipHash: input.ipHash ?? hashKey(`intake:${source}`),
    userAgent: input.userAgent.slice(0, 300),
    answersHash: hashAnswers(answers),
  };

  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
  const duplicate = await findRecentDuplicate(db, form.id, base.ipHash, base.answersHash, since);
  if (duplicate) return { ok: true, submissionId: duplicate.id, duplicate: true };

  let submissionId: string;
  try {
    ({ id: submissionId } = await createSubmission(db, form.account_id, form.id, base));
  } catch (e) {
    // Nothing was written, so this is the one failure the caller must see.
    console.error(`intake ${form.public_id}: submission failed before the row existed: ${String(e)}`);
    return { ok: false, error: "not saved" };
  }

  try {
    await enrich(db, form, submissionId, answers, attribution, input.origin, locale,
      // No consent can be given here (see above), so any consent field on the
      // form means the instant text is withheld.
      consentFields.length > 0);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown enrichment failure";
    await setSubmissionProcessingError(db, form.account_id, submissionId, message);
    console.error(`intake ${form.public_id}: submission ${submissionId} enrichment failed: ${message}`);
  }

  return { ok: true, submissionId, duplicate: false };
}
