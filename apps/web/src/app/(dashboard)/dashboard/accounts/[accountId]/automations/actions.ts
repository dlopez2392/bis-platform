"use server";

/**
 * Agency-only writes to `automations` (0025). The table grants
 * `authenticated` SELECT and nothing else, so `serviceDb()` is the ONLY
 * thing standing behind this write — which is why the `isAgency` check
 * below is not optional. Same guard shape as voice/actions.ts, returned
 * (Result-typed) rather than thrown.
 */

import { revalidatePath } from "next/cache";
import {
  serviceDb, upsertAutomation, getAutomation, parseReviewRequestConfig, parseNoShowNudgeConfig, parseReferralAskConfig,
  parseReactivationConfig, parseQuoteFollowupConfig, parseInstantReplyConfig,
  QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS,
  getMailingAddress, getBranding, brandDisplayName, nextSpanishBox,
  type ReviewRequestChannel, type RecipeKey,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { missingForMarketingEmail } from "@/lib/automations/reactivation-gate";
import { defaultReviewRequestBody } from "@/lib/automations/review-request-copy";
import { defaultNoShowNudgeBody } from "@/lib/automations/no-show-nudge-copy";
import { defaultSmsReminderBody } from "@/lib/automations/sms-reminder-copy";
import { defaultReferralAskBody } from "@/lib/automations/referral-ask-copy";
import { defaultReactivationBody } from "@/lib/automations/reactivation-copy";
import { defaultQuoteFollowupBody } from "@/lib/automations/quote-followup-copy";

export type ActionResult = { ok: true } | { ok: false; error: string };

const CHANNELS: readonly ReviewRequestChannel[] = ["email", "sms"];

/**
 * S-09 PR 2: read the Spanish box's three fields and work out what to store (nextSpanishBox).
 * Validates the Spanish exactly as the English (length). Reads the stored row for "unchanged"
 * and the basis. Shared by the four actions in this file (Task 15) and Task 16's. `defaultEs`:
 * the recipe's own written Spanish default rendered for THIS account's brand, "" for
 * appointment_confirm (plan deviation 4, its English has no default either).
 */
async function spanishBoxPatch(
  accountId: string, recipe: RecipeKey, formData: FormData, body: string, defaultEs: string,
): Promise<{ ok: true; bodyEs: string | null; bodyEsBasis: string | null } | { ok: false; error: string }> {
  const submitted = String(formData.get("body_es") ?? "");
  if (submitted.trim().length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };
  const row = await getAutomation(serviceDb(), accountId, recipe);
  const next = nextSpanishBox({
    submitted, useOurs: formData.get("body_es_use_ours") === "1", stillMatches: formData.get("body_es_still_matches") === "on",
    defaultEs, body, stored: { bodyEs: row?.body_es ?? null, basis: row?.body_es_basis ?? null },
  });
  return { ok: true, bodyEs: next.bodyEs, bodyEsBasis: next.basis };
}

export async function saveReviewRequestAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const rawChannel = String(formData.get("channel") ?? "email");
  const channel = (CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as ReviewRequestChannel) : null;
  if (!channel) return { ok: false, error: m["automations.review.saveFailed"] };
  const reviewUrl = String(formData.get("review_url") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  // Trimmed on write so "" keeps meaning "use the default at send time"
  // even after a stray space — the pass trims before defaulting, and the
  // settings preview must see the same value the pass will.
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  // Validated on WRITE with the same parser the pass applies on READ. A junk
  // link is refused even while the recipe is off (a javascript: URL must never
  // be stored), and turning the recipe on requires a link.
  const parsed = parseReviewRequestConfig({ channel, reviewUrl });
  if (reviewUrl && !parsed) return { ok: false, error: m["automations.review.urlInvalid"] };
  if (enabled && !parsed) return { ok: false, error: m["automations.review.urlRequired"] };

  let brandName: string;
  try {
    brandName = brandDisplayName(await getBranding(serviceDb(), accountId));
  } catch (e) {
    console.error(`saveReviewRequestAction: branding read failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.review.saveFailed"] };
  }
  const es = await spanishBoxPatch(accountId, "review_request", formData, body, defaultReviewRequestBody(brandName, "es"));
  if (!es.ok) return es;

  // Store the NORMALISED config (`parsed.href`), not the raw string: the pass
  // parses on read and sends the href, so storing the raw form value would
  // let the page preview one string and the send carry another (a bare
  // origin gains a slash, a space becomes %20). `parsed` is null here only
  // when the link is empty and the recipe is off.
  try {
    await upsertAutomation(serviceDb(), accountId, "review_request",
      { enabled, body, config: parsed ?? { channel, reviewUrl }, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveReviewRequestAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.review.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveNoShowNudgeAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  // The pass's own parser, on write: an unknown channel is refused, never
  // defaulted — a default here would let the page show one channel while
  // the row stores another.
  const config = parseNoShowNudgeConfig({ channel: String(formData.get("channel") ?? "email") });
  if (!config) return { ok: false, error: m["automations.noShow.saveFailed"] };
  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  let brandName: string;
  try {
    brandName = brandDisplayName(await getBranding(serviceDb(), accountId));
  } catch (e) {
    console.error(`saveNoShowNudgeAction: branding read failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.noShow.saveFailed"] };
  }
  const es = await spanishBoxPatch(accountId, "no_show_nudge", formData, body, defaultNoShowNudgeBody(brandName, "es"));
  if (!es.ok) return es;

  try {
    await upsertAutomation(serviceDb(), accountId, "no_show_nudge",
      { enabled, body, config, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveNoShowNudgeAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.noShow.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveReferralAskAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  // The pass's own parser, on write: an unknown channel is refused, never
  // defaulted — a default here would let the page show one channel while the
  // row stores another. There is deliberately no url field to validate: this
  // recipe asks for a name, not a rating.
  const config = parseReferralAskConfig({ channel: String(formData.get("channel") ?? "email") });
  if (!config) return { ok: false, error: m["automations.referral.saveFailed"] };
  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  let brandName: string;
  try {
    brandName = brandDisplayName(await getBranding(serviceDb(), accountId));
  } catch (e) {
    console.error(`saveReferralAskAction: branding read failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.referral.saveFailed"] };
  }
  const es = await spanishBoxPatch(accountId, "referral_ask", formData, body, defaultReferralAskBody(brandName, "es"));
  if (!es.ok) return es;

  // NOT ON BY EMAIL WITHOUT AN ADDRESS AND A REPLY-TO (B21, danlo,
  // 2026-09-23) — the check-in's rule, for the same reason: the referral
  // email is marketing, prints the postal address, and its opt-out is a
  // reply that must reach the business. The same function the pass skips on
  // and the same messages as the check-in's save. EMAIL ONLY — a text
  // carries no footer and its opt-out is the carrier's STOP list — and only
  // when turning it ON, so a recipe can always be switched off. A failed
  // read is a failed save, never "not set".
  if (enabled && config.channel === "email") {
    try {
      const db = serviceDb();
      const [mailingAddress, branding] = await Promise.all([
        getMailingAddress(db, accountId), getBranding(db, accountId),
      ]);
      const missing = missingForMarketingEmail(mailingAddress, branding.replyToEmail);
      if (missing.mailingAddress) return { ok: false, error: m["automations.reactivation.needsMailingAddress"] };
      if (missing.replyTo) return { ok: false, error: m["automations.reactivation.needsReplyTo"] };
    } catch (e) {
      console.error(`saveReferralAskAction: address/reply-to read failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: m["automations.referral.saveFailed"] };
    }
  }

  try {
    await upsertAutomation(serviceDb(), accountId, "referral_ask",
      { enabled, body, config, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveReferralAskAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.referral.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}


export async function saveReactivationAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  // The pass's own parser, on write. A months value outside the range is
  // REFUSED, never clamped: silently turning a typo'd 99 into 18 would show
  // the operator one number and send on another. The number input's own
  // `max` makes this unreachable from a normal keyboard, which is why the
  // refusal is proved here and never in Playwright. There is deliberately no
  // channel to validate: this recipe is email only.
  const config = parseReactivationConfig({ months: Number(formData.get("months")) });
  if (!config) return { ok: false, error: m["automations.reactivation.monthsInvalid"] };
  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  let brandName: string;
  try {
    brandName = brandDisplayName(await getBranding(serviceDb(), accountId));
  } catch (e) {
    console.error(`saveReactivationAction: branding read failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.reactivation.saveFailed"] };
  }
  const es = await spanishBoxPatch(accountId, "reactivation", formData, body, defaultReactivationBody(brandName, "es"));
  if (!es.ok) return es;

  // NOT ON WITHOUT AN ADDRESS AND A REPLY-TO (decision A, danlo, 2026-09-22).
  // The check-in is commercial email, which under CAN-SPAM (the
  // orchestrator's reading, not a lawyer's) carries the sender's postal
  // address and a working opt-out — here "reply and let us know", which only
  // works if a reply reaches the business rather than the agency's
  // `EMAIL_FROM` mailbox. Judged by the same function the pass skips on, so
  // the save and the send cannot disagree about "blank". Only when turning it
  // ON: saving with the recipe off must never need either, or an account
  // whose address was cleared could not even be switched off. A failed read
  // is a failed save, never "not set".
  if (enabled) {
    try {
      const db = serviceDb();
      const [mailingAddress, branding] = await Promise.all([
        getMailingAddress(db, accountId), getBranding(db, accountId),
      ]);
      const missing = missingForMarketingEmail(mailingAddress, branding.replyToEmail);
      if (missing.mailingAddress) return { ok: false, error: m["automations.reactivation.needsMailingAddress"] };
      if (missing.replyTo) return { ok: false, error: m["automations.reactivation.needsReplyTo"] };
    } catch (e) {
      console.error(`saveReactivationAction: address/reply-to read failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: m["automations.reactivation.saveFailed"] };
    }
  }

  try {
    await upsertAutomation(serviceDb(), accountId, "reactivation",
      { enabled, body, config, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveReactivationAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.reactivation.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveQuoteFollowupAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const stageId = String(formData.get("stage_id") ?? "").trim();
  const quietDays = Number(formData.get("quiet_days"));
  const enabled = formData.get("enabled") === "on";

  // ONE parse with the pass's own parser, then the specific messages, most
  // specific first — the review-request action's shape (actions.ts above).
  // A days value outside the range is REFUSED, never clamped: silently
  // turning a typo'd 99 into 30 would show the operator one number and send
  // on another. The number input's own `max` makes that unreachable from a
  // normal keyboard, which is why the refusal is proved in actions.test.ts
  // and never in Playwright.
  const config = parseQuoteFollowupConfig({ stageId, quietDays, channel: String(formData.get("channel") ?? "email") });
  if (!config) {
    // An empty stage is named whether or not the recipe is being turned on
    // (decision C, danlo, 2026-09-22): the parser refuses it either way, so
    // an operator saving with the switch off must still be told what is
    // missing rather than handed the generic `saveFailed` below.
    if (stageId === "") return { ok: false, error: m["automations.quoteFollowup.stageRequired"] };
    if (!Number.isInteger(quietDays)
      || quietDays < QUOTE_FOLLOWUP_MIN_QUIET_DAYS || quietDays > QUOTE_FOLLOWUP_MAX_QUIET_DAYS) {
      return { ok: false, error: m["automations.quoteFollowup.quietDaysInvalid"] };
    }
    return { ok: false, error: m["automations.quoteFollowup.saveFailed"] };
  }
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  let brandName: string;
  try {
    brandName = brandDisplayName(await getBranding(serviceDb(), accountId));
  } catch (e) {
    console.error(`saveQuoteFollowupAction: branding read failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.quoteFollowup.saveFailed"] };
  }
  const es = await spanishBoxPatch(accountId, "quote_followup", formData, body, defaultQuoteFollowupBody(brandName, "es"));
  if (!es.ok) return es;

  try {
    // The PARSED config, never the raw form values: the stored jsonb is then
    // exactly what the pass will read back.
    await upsertAutomation(serviceDb(), accountId, "quote_followup",
      { enabled, body, config, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveQuoteFollowupAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.quoteFollowup.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveSmsReminderAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  const es = await spanishBoxPatch(accountId, "sms_reminder", formData, body, defaultSmsReminderBody("es"));
  if (!es.ok) return es;

  try {
    // Nothing to configure: the channel is the recipe, the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "sms_reminder",
      { enabled, body, config: {}, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveSmsReminderAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.smsReminder.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveAppointmentConfirmAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  // Plan deviation 4: this recipe's "our Spanish default" is the empty
  // string — its English has no default either (a blank closing line sends
  // the question alone).
  const es = await spanishBoxPatch(accountId, "appointment_confirm", formData, body, "");
  if (!es.ok) return es;

  try {
    // Nothing to configure: the channel IS the recipe (a "Reply YES" email
    // points at a no-reply address), and the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "appointment_confirm",
      { enabled, body, config: {}, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId);
  } catch (e) {
    console.error(`saveAppointmentConfirmAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.appointmentConfirm.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveInstantReplyAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  // Trimmed on write: the send path trims before sending, and the preview
  // must show the string that sends. English rides in `body`, the column
  // every recipe treats as "the text that sends"; Spanish in config.bodyEs.
  const bodyEn = String(formData.get("body_en") ?? "").trim();
  const bodyEs = String(formData.get("body_es") ?? "").trim();
  if (bodyEn.length > AUTOMATION_BODY_MAX_LENGTH || bodyEs.length > AUTOMATION_BODY_MAX_LENGTH) {
    return { ok: false, error: m["automations.bodyTooLong"] };
  }
  // No empty-means-default for this recipe: the send path sends the saved
  // text VERBATIM, so enabling with a blank text would text a blank.
  if (enabled && (!bodyEn || !bodyEs)) return { ok: false, error: m["automations.instantReply.bodiesRequired"] };

  // The send path's own parser, on write — the review request's discipline.
  // With `bodyEs` already a string the null branch cannot fire today; it
  // stays so a stricter parser (a length rule, a forbidden character) is
  // enforced on write the moment it is added on read, with no second edit.
  const config = parseInstantReplyConfig({ bodyEs });
  if (!config) return { ok: false, error: m["automations.instantReply.saveFailed"] };

  try {
    await upsertAutomation(serviceDb(), accountId, "instant_reply", { enabled, body: bodyEn, config }, userId);
  } catch (e) {
    console.error(`saveInstantReplyAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.instantReply.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
