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
  serviceDb, upsertAutomation, parseReviewRequestConfig, type ReviewRequestChannel,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";

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
  const body = String(formData.get("body") ?? "");

  // Validated on WRITE with the same parser the pass applies on READ. A junk
  // link is refused even while the recipe is off (a javascript: URL must never
  // be stored), and turning the recipe on requires a link.
  const parsed = parseReviewRequestConfig({ channel, reviewUrl });
  if (reviewUrl && !parsed) return { ok: false, error: m["automations.review.urlInvalid"] };
  if (enabled && !parsed) return { ok: false, error: m["automations.review.urlRequired"] };

  try {
    await upsertAutomation(serviceDb(), accountId, "review_request",
      { enabled, body, config: { channel, reviewUrl } }, userId);
  } catch (e) {
    console.error(`saveReviewRequestAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.review.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
