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
  serviceDb, upsertAutomation, parseReviewRequestConfig, parseNoShowNudgeConfig, parseReferralAskConfig,
  parseInstantReplyConfig,
  saveQuietSettings, bumpHeldForAccount, isClock,
  type ReviewRequestChannel,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";

export type ActionResult = { ok: true } | { ok: false; error: string };

const CHANNELS: readonly ReviewRequestChannel[] = ["email", "sms"];

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

  // Store the NORMALISED config (`parsed.href`), not the raw string: the pass
  // parses on read and sends the href, so storing the raw form value would
  // let the page preview one string and the send carry another (a bare
  // origin gains a slash, a space becomes %20). `parsed` is null here only
  // when the link is empty and the recipe is off.
  try {
    await upsertAutomation(serviceDb(), accountId, "review_request",
      { enabled, body, config: parsed ?? { channel, reviewUrl } }, userId);
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

  try {
    await upsertAutomation(serviceDb(), accountId, "no_show_nudge", { enabled, body, config }, userId);
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

  try {
    await upsertAutomation(serviceDb(), accountId, "referral_ask", { enabled, body, config }, userId);
  } catch (e) {
    console.error(`saveReferralAskAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.referral.saveFailed"] };
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

  try {
    // Nothing to configure: the channel is the recipe, the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "sms_reminder", { enabled, body, config: {} }, userId);
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

  try {
    // Nothing to configure: the channel IS the recipe (a "Reply YES" email
    // points at a no-reply address), and the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "appointment_confirm", { enabled, body, config: {} }, userId);
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

/**
 * The quiet-hours window (part C). Same guard, same Result shape as the
 * recipe actions above. After the save, every held row of the account is
 * made due now (`bumpHeldForAccount`), so the release pass re-reads tonight's
 * queue under the NEW window on the next tick — turning quiet hours off at
 * 23:00 releases the texts at 23:15, not at 08:00; lengthening the window
 * re-holds them. The bump is best effort: a save that landed is a success.
 */
export async function saveQuietHoursAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("quiet_enabled") === "on";
  const start = String(formData.get("quiet_start") ?? "").trim();
  const end = String(formData.get("quiet_end") ?? "").trim();
  if (!isClock(start) || !isClock(end)) return { ok: false, error: m["automations.quiet.invalidTime"] };
  // quiet-hours.ts's evaluateWindow treats start === end as DISABLED (no
  // window at all), so an enabled row with equal times would show ON in the
  // UI while never actually going quiet. Refused only while turning it on;
  // a stored OFF row with equal times is a legal (if pointless) rest state.
  if (enabled && start === end) return { ok: false, error: m["automations.quiet.invalidTime"] };

  const db = serviceDb();
  try {
    await saveQuietSettings(db, accountId, { enabled, start, end }, userId);
  } catch (e) {
    console.error(`saveQuietHoursAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.quiet.saveFailed"] };
  }
  try {
    const bumped = await bumpHeldForAccount(db, accountId);
    if (bumped > 0) console.log(`saveQuietHoursAction: ${bumped} held send(s) for account ${accountId} re-queued under the new window`);
  } catch (e) {
    console.error(`saveQuietHoursAction: could not re-queue held sends for account ${accountId}: ${String(e)}`);
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
