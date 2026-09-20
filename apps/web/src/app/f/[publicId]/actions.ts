"use server";

import { headers } from "next/headers";
import {
  serviceDb, getPublishedFormByPublicId, createSubmission, recordRejectedSubmission,
  countRecentSubmissions, shouldRecordRateLimit, findRecentDuplicate,
  setSubmissionProcessingError,
  type FormField, type FormRow,
} from "@bis/db";
import { originFrom } from "@/lib/email/origin";
import { enrich } from "@/lib/forms/enrich";
import {
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  DUPLICATE_WINDOW_MS, verifyRenderToken, clientIp, hashIp, hashAnswers, parseAttribution,
  isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import type { SubmitResult } from "./submit-result";

const CONSENT_KIND = "consent";

function collect(fields: FormField[], formData: FormData) {
  return fields
    .filter((f) => f.kind !== CONSENT_KIND)
    .map((f) => ({
      key: f.key,
      label: f.label,
      value: String(formData.get(f.key) ?? "").trim().slice(0, 5000),
    }));
}

function validate(
  fields: FormField[], answers: { key: string; value: string }[], formData: FormData,
  s: ReturnType<typeof publicStrings>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const byKey = new Map(answers.map((a) => [a.key, a.value]));

  for (const field of fields) {
    if (field.kind === CONSENT_KIND) {
      if (field.required && !formData.get(field.key)) errors[field.key] = s.consentRequired;
      continue;
    }
    const value = byKey.get(field.key) ?? "";
    if (field.required && value === "") { errors[field.key] = s.required; continue; }
    if (value === "") continue;
    if (field.kind === "core.email" && !isValidEmail(value)) errors[field.key] = s.invalidEmail;
    if (field.kind === "core.phone" && !isValidPhone(value)) errors[field.key] = s.invalidPhone;
  }
  return errors;
}

function successFor(form: FormRow, locale: "en" | "es"): SubmitResult {
  const s = publicStrings(locale);
  return {
    status: "success",
    message: form.success_message?.trim() || s.success,
    redirectUrl: form.success_mode === "redirect" && form.redirect_url
      ? form.redirect_url : undefined,
  };
}

/**
 * The public submit path. Three properties matter more than anything else here:
 *
 *  1. `accountId` comes off the form row, never from the request. This endpoint
 *     is unauthenticated and uses the service-role client, which bypasses RLS.
 *  2. Bad input is invalid for a bot and a human alike, and — among
 *     well-formed submissions — a blocked bot gets the same response BODY a
 *     genuinely accepted one gets (same status, same shape), so telling it
 *     which guard fired is never free tuning information. That guarantee is
 *     about the body only: the guards below do different amounts of work (a
 *     rate-limit count vs. a full contact/conversation/notify run), so wall
 *     clock timing is NOT guaranteed identical between paths. That gap is a
 *     known, accepted limitation — do not "fix" it by adding artificial
 *     delays, and do not describe the two paths as indistinguishable. One
 *     deliberate exception to the same-body guarantee: an expired render
 *     token returns its own `invalid` result instead of the shared success
 *     body, because that costs a real, distracted visitor their lead for no
 *     security benefit — a bot already reads its own token's age in plaintext
 *     off the token itself, so telling it "expired" is not new information.
 *  3. The submission row is written before any enrichment, and everything after
 *     it is best-effort. A lead is never lost to a notification failure.
 */
export async function submitFormAction(
  publicId: string, _prev: SubmitResult, formData: FormData,
): Promise<SubmitResult> {
  try {
    const db = serviceDb();
    const form = await getPublishedFormByPublicId(db, publicId);
    // Draft, archived and never-existed are all the same answer on purpose.
    if (!form) return { status: "error" };

    const accountId = form.account_id;
    const h = await headers();
    const locale = normalizeLocale(String(formData.get("locale") ?? ""), form.locale_default);
    const s = publicStrings(locale);

    const answers = collect(form.fields, formData);
    const answersHash = hashAnswers(answers);
    const ipHash = hashIp(clientIp(h));
    const consentFields = form.fields.filter((f) => f.kind === CONSENT_KIND);
    const base = {
      answers,
      attribution: parseAttribution(new URLSearchParams(String(formData.get("attribution") ?? ""))),
      // One entry per consent field, not just the first — a form can ask for
      // more than one distinct agreement, and each is enforced by `validate`
      // below, so each must be provable later. The exact copy shown, not just
      // the boolean: proving consent later means knowing what the person
      // agreed to.
      consent: consentFields.length > 0
        ? consentFields.map((f) => ({
            key: f.key,
            given: Boolean(formData.get(f.key)),
            text: f.label,
            at: new Date().toISOString(),
          }))
        : null,
      locale,
      ipHash,
      userAgent: (h.get("user-agent") ?? "").slice(0, 300),
      answersHash,
    };

    // Real errors, for real people — and the one check that must run before
    // every guard below. If a spam guard ran first, a request with (say) the
    // honeypot filled AND a required field left blank would return success
    // while the same request with the honeypot empty returns invalid: a
    // single-request-pair oracle a bot can use to learn which hidden field is
    // the honeypot, one candidate name at a time. Validating first closes
    // that: bad input is invalid whether or not any guard below would also
    // have fired.
    const fieldErrors = validate(form.fields, answers, formData, s);
    if (Object.keys(fieldErrors).length > 0) return { status: "invalid", fieldErrors };

    // --- Guards on well-formed input --------------------------------------
    // Rate limit runs first among the spam guards: it is the only one of them
    // that bounds table growth. If honeypot or too-fast ran first instead, a
    // well-formed request with the honeypot filled would write a rejected row
    // on every single request forever, with nothing capping it — exactly the
    // unbounded growth the rate-limit marker below exists to prevent, just
    // applied to the branch a real bot reaches least often.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    if (await countRecentSubmissions(db, form.id, ipHash, windowStart) >= RATE_LIMIT_MAX) {
      // One marker per burst, so the throttling is visible without the table
      // growing for as long as a bot keeps hammering it.
      // Same window as the count above: a marker already written inside it
      // suppresses another. Concurrent requests racing this check can still write
      // a few per window; enforcement never depended on the marker count.
      if (await shouldRecordRateLimit(db, form.id, ipHash, windowStart)) {
        await recordRejectedSubmission(db, accountId, form.id, { ...base, spamReason: "rate_limited" });
      }
      return successFor(form, locale);
    }

    if (String(formData.get(HONEYPOT_FIELD) ?? "").trim() !== "") {
      await recordRejectedSubmission(db, accountId, form.id, { ...base, spamReason: "honeypot" });
      return successFor(form, locale);
    }

    const token = verifyRenderToken(String(formData.get(RENDER_TOKEN_FIELD) ?? ""), Date.now(), publicId);
    if (!token.ok) {
      // A genuinely expired token is not a spam signal — it is a visitor who
      // left the tab open past MAX_TOKEN_AGE_MS, and recording their real lead
      // as `too_fast` while showing them a success message loses it silently.
      // The one thing that lets them recover is telling them to refresh: this
      // leaks nothing a bot doesn't already know, since `issuedAt` is plaintext
      // in the token it holds.
      if (token.reason === "expired") {
        return { status: "invalid", fieldErrors: {}, formError: s.tokenExpired };
      }
      // `malformed`/`bad_signature` are still folded into the `too_fast`
      // spam_reason below (the CHECK constraint permits only honeypot/
      // too_fast/rate_limited), but the real cause is worth keeping in logs —
      // a forged signature and a fast fill are not the same thing.
      console.warn(`form ${form.id} render token rejected (${token.reason})`);
      await recordRejectedSubmission(db, accountId, form.id, { ...base, spamReason: "too_fast" });
      return successFor(form, locale);
    }
    if (token.elapsedMs < MIN_FILL_MS) {
      await recordRejectedSubmission(db, accountId, form.id, { ...base, spamReason: "too_fast" });
      return successFor(form, locale);
    }

    const duplicateSince = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    if (await findRecentDuplicate(db, form.id, ipHash, answersHash, duplicateSince)) {
      return successFor(form, locale);
    }

    // --- The lead ---------------------------------------------------------
    let submissionId: string;
    try {
      ({ id: submissionId } = await createSubmission(db, accountId, form.id, base));
    } catch (e) {
      // Nothing was written, so this is the one failure the sender must see.
      console.error(`form submit failed before the row existed: ${String(e)}`);
      return { status: "error" };
    }

    // --- Enrichment: best-effort from here on. A failure here must never
    // change what the submitter sees — the lead is already durably saved, and
    // `enrich` itself keeps the notification independent of everything else
    // it does, so this is a last-resort net, not the primary handling. -------
    try {
      await enrich(db, form, submissionId, answers, base.attribution, originFrom(h), locale,
        // Any consent box left unticked — an OPTIONAL one, since `validate`
        // above refuses a required one unticked — means no instant text
        // (Milestone C, spec §1). Derived here, where the record is built.
        (base.consent ?? []).some((c) => !c.given));
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown enrichment failure";
      await setSubmissionProcessingError(db, accountId, submissionId, message);
      console.error(`form ${form.id} submission ${submissionId} enrichment failed: ${message}`);
    }

    return successFor(form, locale);
  } catch (e) {
    // Anything thrown above — the form lookup or a guard's own DB call — is a
    // transient failure, not a spam signal, and nothing was written for it.
    // Without this catch it escapes uncaught: there is no error boundary for
    // this segment other than `app/f/error.tsx`, and a bare throw here would
    // otherwise surface as Next's raw global error page on the client's own
    // embedding site instead of this `{ status: "error" }` branch, which
    // `public-form.tsx` renders as a polite message.
    console.error(`form ${publicId} submission failed before enrichment: ${String(e)}`);
    return { status: "error" };
  }
}
