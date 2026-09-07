"use server";

import { headers } from "next/headers";
import {
  serviceDb, getPublishedFormByPublicId, createSubmission, recordRejectedSubmission,
  countRecentSubmissions, shouldRecordRateLimit, findRecentDuplicate,
  linkSubmissionContact, setSubmissionProcessingError, emitFormSubmitted,
  createContact, updateContact, getContact,
  ensureConversation, createMessage, incrementUnreadCount,
  type FormField, type FormRow,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { originFrom } from "@/lib/email/origin";
import { emailBrand } from "@/lib/email/templates/shell";
import { leadAlertEmail } from "@/lib/email/templates/lead-alert";
import { leadReceiptEmail, leadReceiptSubject } from "@/lib/email/templates/lead-receipt";
import {
  HONEYPOT_FIELD, RENDER_TOKEN_FIELD, MIN_FILL_MS, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  DUPLICATE_WINDOW_MS, verifyRenderToken, hashIp, hashAnswers, parseAttribution,
  isValidEmail, isValidPhone,
} from "@/lib/forms/guards";
import { toE164 } from "@/lib/voice/phone-number";
import { sendInstantReply } from "@/lib/automations/instant-reply";
import { publicStrings, normalizeLocale } from "@/lib/forms/public-strings";
import type { SubmitResult } from "./submit-result";

const CONSENT_KIND = "consent";
const MESSAGE_KIND = "message";

/**
 * Client IP for rate limiting and duplicate detection.
 *
 * TRUST ASSUMPTION, stated explicitly: this only works because the hosting
 * platform (Vercel) *overwrites* `x-vercel-forwarded-for`/`x-forwarded-for`
 * on every request rather than appending to whatever the client sent —
 * `x-vercel-forwarded-for` is Vercel's own platform-set header and is
 * preferred for that reason. If this app is ever placed behind a different
 * proxy that appends to `x-forwarded-for` instead of replacing it, the first
 * hop stops being trustworthy: a client could prepend any address it likes,
 * making rate limiting and duplicate detection both keyed on a value the
 * requester controls — rotatable by a bot, and usable against a real visitor
 * by sending their IP to exhaust their limit. Revisit this the day a non-
 * Vercel proxy enters the path.
 */
function clientIp(h: Headers): string {
  const vercelForwarded = h.get("x-vercel-forwarded-for");
  if (vercelForwarded) return vercelForwarded.split(",")[0]!.trim();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "unknown";
}

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

async function enrich(
  db: ReturnType<typeof serviceDb>, form: FormRow, submissionId: string,
  answers: { key: string; label: string; value: string }[],
  attribution: Record<string, string>,
  /** Absolute origin for links in the alert, or null when the request carried
   *  no host. Threaded from the action because headers() is readable only
   *  there, not in this helper. */
  origin: string | null,
  /** The language the form was submitted in — the receipt's language. */
  locale: "en" | "es",
  /** True when any consent checkbox was left unticked — the instant reply's
   *  "no" (Milestone C, spec §1). */
  consentWithheld: boolean,
): Promise<void> {
  const accountId = form.account_id;
  const byKind = new Map(form.fields.map((f) => [f.kind, answers.find((a) => a.key === f.key)?.value ?? ""]));
  const custom: Record<string, string> = {};
  for (const field of form.fields) {
    if (!field.kind.startsWith("custom.")) continue;
    const value = answers.find((a) => a.key === field.key)?.value ?? "";
    if (value) custom[field.kind.slice("custom.".length)] = value;
  }

  const errors: string[] = [];
  let contactId: string | null = null;
  // Hoisted for the instant reply below: the thread `enrich` opens and the
  // parsed phone the contact row stored. Both stay null when the contact
  // work failed — there is then no thread to put a text in.
  let conversationId: string | null = null;
  let phoneE164: string | null = null;

  // Contact, conversation and event work, grouped: a failure partway through
  // (say, the message insert) stops the rest of this group, but must never
  // block the notification below — a silent CRM row is a regression that
  // costs a real lead, but so is a silent inbox when the CRM write itself is
  // what failed.
  try {
    // Dedupe is deliberately on email OR phone (see `findDuplicate` in
    // packages/db/src/contacts.ts), unverified — this was reviewed and
    // accepted, not missed. Anyone who knows a client's contact email or phone
    // can attach a message or fill blanks on that contact's record through
    // this public path. What makes that acceptable: the writes land on the
    // contact's own timeline with form provenance, visible to the operator,
    // and nothing here is ever read back to the submitter. Do not "fix" this
    // by requiring verification of either field without re-opening that review.
    // Hoisted: `fillBlanks` below applies the identical rule to its own read
    // of `byKind.get("core.phone")` for a returning contact, so both sites
    // stay obviously in lockstep rather than drift into two implementations
    // of the same normalization.
    const rawPhone = byKind.get("core.phone") || "";
    phoneE164 = rawPhone ? toE164(rawPhone) : null;
    const created = await createContact(db, accountId, {
      firstName: byKind.get("core.first_name") || undefined,
      lastName: byKind.get("core.last_name") || undefined,
      email: byKind.get("core.email") || undefined,
      // Voice stores E.164; storing web input as-typed made the same person
      // two contacts and hid web submissions from find_my_booking. Parseable →
      // E.164, unparseable → as typed (never mangled, never rejected here).
      phone: rawPhone ? (phoneE164 ?? rawPhone) : undefined,
      companyName: byKind.get("core.company_name") || undefined,
      source: `form: ${form.name}`,
      custom,
    }, "form", "system");
    contactId = created.id;

    if (created.existing) await fillBlanks(db, accountId, contactId, byKind, custom, attribution);
    else await setAttribution(db, accountId, contactId, attribution, true);

    await linkSubmissionContact(db, accountId, submissionId, contactId);

    // Every lead opens a conversation, not only the ones that wrote something.
    // Gating this on a non-empty message field meant a form without one — or
    // with one left blank — produced a contact row and a notification email and
    // NOTHING in Conversations, the only screen that flags a new lead as
    // unread. That is precisely the "leads in a database rather than in front
    // of a person" failure the unread badge exists to prevent, and it hit the
    // shortest, highest-converting forms hardest. Three-tier fallback for the
    // body: the message field's own answer when there is one; otherwise a
    // readable "Label: value" line per other answered field, so the thread
    // shows what the person actually submitted; and only when NEITHER exists
    // (every field left blank) a fixed line naming the form — `messages.body`
    // is `not null`, and an empty bubble would be worse than a stated one.
    const messageField = form.fields.find((f) => f.kind === MESSAGE_KIND);
    const messageBody = messageField
      ? answers.find((a) => a.key === messageField.key)?.value ?? "" : "";
    const answeredLines = answers.filter((a) => a.value)
      .map((a) => `${a.label}: ${a.value}`).join("\n");
    const threadBody = messageBody || answeredLines || `New submission on "${form.name}".`;

    const convo = await ensureConversation(db, accountId, contactId, "form", "system");
    conversationId = convo.id;
    await createMessage(db, accountId, {
      conversationId: convo.id, channel: "form", direction: "inbound",
      subject: form.name, body: threadBody,
    }, "form", "system");
    await incrementUnreadCount(db, accountId, convo.id);

    await emitFormSubmitted(db, accountId, { formId: form.id, submissionId, contactId });
  } catch (e) {
    errors.push(`enrichment: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Last and independent of everything above. bis-rgv.com emails danlo today,
  // so a silent CRM row would be a regression that costs real leads — but the
  // lead is already durably saved by the time this runs, so a provider
  // failure must never fail the submission, and a failure in the contact/
  // conversation work above must never suppress this. Outside production
  // this is the fake provider and delivers nothing, which is what keeps e2e
  // honest.
  try {
    // byKind is already built above; the customer's address is the value of
    // whichever field this form uses for core.email, or "" if it asks for none.
    await notify(db, form, contactId, answers, byKind.get("core.email") ?? "", origin);
  } catch (e) {
    errors.push(`notify: ${e instanceof Error ? e.message : String(e)}`);
  }

  // The receipt to the person, after the alert to the company and independent
  // of it. Logged, never recorded on the submission: `processing_error` is
  // the operator's "somebody was not told about this lead" signal, and a
  // bounced auto-reply is not that.
  try {
    await receipt(db, form, locale, byKind.get("core.email") ?? "", byKind.get("core.first_name") ?? "");
  } catch (e) {
    console.error(`form ${form.id} submission ${submissionId} receipt failed: ${String(e)}`);
  }

  // The instant reply (Milestone C): a text to the person, from the company's
  // own number, in the language of the page — last, after both emails, and
  // independent of them. The module decides (recipe on, phone parsed, consent
  // not withheld, the A2P gate, the 24h per-thread hold, the daily cap),
  // sends write-then-send so a provider failure is a visible failed text in
  // the inbox, and logs every outcome worth seeing. Like the receipt: never
  // `processing_error` (that means "nobody was told about this lead"), never
  // the submitter's result. Skipped outright when the contact work above
  // failed — no thread, nothing to reply into.
  if (contactId && conversationId) {
    try {
      await sendInstantReply({
        db, now: new Date(), accountId, submissionId, contactId, conversationId,
        phoneE164, locale, consentWithheld,
      });
    } catch (e) {
      console.error(`form ${form.id} submission ${submissionId} instant reply crashed: ${String(e)}`);
    }
  }

  if (errors.length > 0) {
    // Truncated per-component, not after joining: `setSubmissionProcessingError`
    // caps the final string at 500 chars, and the notify error — the one that
    // means nobody was told about the lead, more operationally urgent than a
    // CRM-write failure — is appended last, so a single post-join truncation
    // is exactly what cuts it away.
    await setSubmissionProcessingError(db, accountId, submissionId,
      errors.map((e) => e.slice(0, 240)).join("; "));
  }
}

/**
 * A returning lead who now supplies a phone number gets it added; a mistyped
 * name never clobbers a good record. `updateContact` takes a partial and would
 * happily overwrite, so the existing row has to be read first.
 */
async function fillBlanks(
  db: ReturnType<typeof serviceDb>, accountId: string, contactId: string,
  byKind: Map<string, string>, custom: Record<string, string>,
  attribution: Record<string, string>,
): Promise<void> {
  const current = await getContact(db, accountId, contactId);
  if (!current) return;

  // Same E.164-at-the-boundary rule the create path applies (see its comment
  // in `enrich`) — a blank existing phone getting filled from a later
  // submission must land normalized too, or the same person ends up with
  // differently-formatted numbers depending on which submission filled it.
  const rawPhone = byKind.get("core.phone") ?? "";
  const patch: Record<string, string> = {};
  const pairs: [string, keyof typeof current, string][] = [
    ["firstName", "first_name", byKind.get("core.first_name") ?? ""],
    ["lastName", "last_name", byKind.get("core.last_name") ?? ""],
    ["email", "email", byKind.get("core.email") ?? ""],
    ["phone", "phone", rawPhone ? (toE164(rawPhone) ?? rawPhone) : ""],
    ["companyName", "company_name", byKind.get("core.company_name") ?? ""],
  ];
  for (const [input, column, incoming] of pairs) {
    const held = (current as Record<string, unknown>)[column];
    if (incoming && !held) patch[input] = incoming;
  }

  const mergedCustom = { ...(current.custom as Record<string, unknown> ?? {}) };
  let customChanged = false;
  for (const [key, value] of Object.entries(custom)) {
    if (value && !mergedCustom[key]) { mergedCustom[key] = value; customChanged = true; }
  }

  if (Object.keys(patch).length > 0 || customChanged) {
    await updateContact(db, accountId, contactId,
      { ...patch, ...(customChanged ? { custom: mergedCustom } : {}) }, "form", "system");
  }
  await setAttribution(db, accountId, contactId, attribution, false);
}

/**
 * First touch is written once and never overwritten; every later submission
 * updates last touch. `contacts.attribution` is not exposed by the contacts
 * module, so this writes the column directly.
 *
 * Both the read and the write check their own error and throw: this used to
 * check neither, so a permissions or schema problem here would drop
 * attribution silently — no `processing_error`, no log, and the outer catch
 * in `enrich` never fired because nothing ever threw. Throwing here lets that
 * catch do its job.
 *
 * Exported (not file-private, unlike its neighbours) so `b/[publicId]/
 * actions.ts` can call the SAME helper for a booking's contact rather than
 * re-implementing the first-touch/last-touch merge a second time (I3) — one
 * `contacts.attribution` writer, not two that could drift apart.
 */
export async function setAttribution(
  db: ReturnType<typeof serviceDb>, accountId: string, contactId: string,
  attribution: Record<string, string>, isNew: boolean,
): Promise<void> {
  if (Object.keys(attribution).length === 0) return;
  const { data, error: selectError } = await db.from("contacts").select("attribution")
    .eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (selectError) throw new Error(`setAttribution select failed: ${selectError.message}`);

  const held = (data?.attribution ?? {}) as Record<string, unknown>;
  const next = {
    ...held,
    ...(isNew || !held.first ? { first: attribution } : {}),
    last: attribution,
  };
  const { error: updateError } = await db.from("contacts").update({ attribution: next })
    .eq("account_id", accountId).eq("id", contactId);
  if (updateError) throw new Error(`setAttribution update failed: ${updateError.message}`);
}

/**
 * Last and non-fatal, and independent of the contact/conversation/event work
 * in `enrich`: a failure there must not suppress this, and a failure here
 * must not undo what already succeeded. bis-rgv.com emails danlo today, so a
 * silent CRM row would be a regression that costs real leads — but the lead
 * is already durably saved by the time this runs, so a provider failure must
 * never fail the submission. `contactId` can be null if the contact/
 * conversation work above failed; the email still goes out, just without a
 * dashboard link to click. Outside production this is the fake provider and
 * delivers nothing, which is what keeps e2e honest.
 */
async function notify(
  db: ReturnType<typeof serviceDb>, form: FormRow, contactId: string | null,
  answers: { key: string; label: string; value: string }[],
  /**
   * The address the visitor gave, or "" when this form asks for none.
   *
   * The recipient of this email is the CLIENT, so the reply has to travel the
   * other way — to the customer. Without it, Reply goes to crm@bis-rgv.com: a
   * mailbox the client does not own and the customer never hears from.
   *
   * Attacker-chosen and harmless. The Resend SDK takes this as a JSON field
   * rather than a raw header, so there is nothing to inject, and the worst a
   * submitter can nominate is their own address — which is the point.
   */
  leadEmail: string,
  /** Absolute origin for the contact link, or null when the request carried no
   *  host. Threaded from the action because headers() is only readable there. */
  origin: string | null,
): Promise<void> {
  if (form.notify_emails.length === 0) return;

  // One row, both jobs: the display name and everything the template needs to
  // wear the company's brand. getBranding() here would be a second round trip
  // to a row this query already returns. `name` is NOT selected: that column
  // is the agency's internal label and `emailBrand` has no parameter left to
  // receive it.
  const { data: account } = await db.from("accounts")
    .select("brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", form.account_id).maybeSingle();

  const brand = emailBrand({
    brandName: account?.brand_name ?? null,
    brandLogoPath: account?.brand_logo_path ?? null,
    brandColor: account?.brand_color ?? null,
    brandNeutral: account?.brand_neutral ?? null,
    brandCorners: account?.brand_corners ?? null,
    brandType: account?.brand_type ?? null,
    brandMode: account?.brand_mode ?? null,
    replyToEmail: null,
  });

  const { html, text: body } = leadAlertEmail({
    brand,
    formName: form.name,
    answers: answers.filter((a) => a.value).map((a) => ({ label: a.label, value: a.value })),
    // Absolute or nothing. The bare `/dashboard/...` path this replaces was not
    // a link in any client, and falling back to it would restore the defect.
    contactUrl: origin && contactId
      ? `${origin}/dashboard/accounts/${form.account_id}/contacts/${contactId}`
      : null,
  });

  // Each recipient is independent. Awaiting them in a bare loop meant the first
  // provider failure — one bad address, one rejected domain — threw out of the
  // loop and every later recipient silently heard nothing about the lead.
  // Failures are collected and rethrown together so `enrich` still records them
  // in `processing_error`, but only the addresses that actually failed are lost.
  const provider = getEmailProvider();
  const failures: string[] = [];
  for (const to of form.notify_emails) {
    try {
      await provider.send({
        // brand.name, not account.name: `accounts.name` is the agency's
        // internal label for this company and is not for the client's eyes.
        to, fromName: brand.name,
        subject: `New lead: ${form.name}`, body, html,
        replyTo: normalizeReplyTo(leadEmail),
      });
    } catch (e) {
      failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (failures.length > 0) throw new Error(`send failed for ${failures.join(", ")}`);
}

/**
 * The auto-reply to the person who filled the form in, when the form asked
 * for their address and what they typed is one. Customer-facing outbound,
 * the same shape as the booking confirmation: sent FROM the account's own
 * sending address (unlike the staff-facing alert, which deliberately is
 * not), reply-to the account's reply address, in the language of the page
 * they submitted from.
 *
 * Every published form sends one. bis-rgv.com's own contact form did before
 * it moved onto the platform, and a form that goes silent after "Submit"
 * reads as a form that did not work. A per-form switch is the natural
 * follow-up if a client ever wants theirs quiet.
 */
async function receipt(
  db: ReturnType<typeof serviceDb>, form: FormRow, locale: "en" | "es",
  leadEmail: string, firstName: string,
): Promise<void> {
  if (!leadEmail || !isValidEmail(leadEmail)) return;

  const { data: account } = await db.from("accounts")
    .select("from_email, reply_to_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", form.account_id).maybeSingle();

  const brand = emailBrand({
    brandName: account?.brand_name ?? null,
    brandLogoPath: account?.brand_logo_path ?? null,
    brandColor: account?.brand_color ?? null,
    brandNeutral: account?.brand_neutral ?? null,
    brandCorners: account?.brand_corners ?? null,
    brandType: account?.brand_type ?? null,
    brandMode: account?.brand_mode ?? null,
    replyToEmail: null,
  });

  const replyTo = normalizeReplyTo(account?.reply_to_email);
  const { html, text: body } = leadReceiptEmail({
    brand, locale, firstName: firstName || null, canReply: Boolean(replyTo),
  });

  await getEmailProvider().send({
    to: leadEmail, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
    replyTo, subject: leadReceiptSubject(locale, brand.name), body, html,
  });
}
