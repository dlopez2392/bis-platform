"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { textsContextFor } from "@/lib/consent/texts-context";
import {
  stopTexts, undoStopTexts, resumeTexts, confirmStop, notAStop, undoHoldDecision,
  type TextsActionResult, type TextsContext,
} from "@/lib/consent/staff-actions";
import type { Locale } from "@/lib/i18n/locale";

/** The Texts row's actions (consent chain PR-2, spec §4.2 "Staff controls"). Each re-reads the contact under RLS.
 *  S-10 leftovers (#317 follow-up, item 7): `locale` threads through to textsContextFor, the one place
 *  every error line below is built (staff-actions.ts reads `ctx.locale`) — default "en" so a caller that
 *  predates this param is unchanged. */
async function run(
  accountId: string, contactId: string, act: (ctx: TextsContext) => Promise<TextsActionResult>, locale: Locale = "en",
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await textsContextFor(accountId, contactId, userId, locale);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) {
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/tasks`);
  }
  return result;
}

export async function stopTextsAction(accountId: string, contactId: string, expectNewest: string | null, locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => stopTexts(ctx, expectNewest), locale);
}
export async function undoStopTextsAction(accountId: string, contactId: string, eventId: string, locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoStopTexts(ctx, eventId), locale);
}
export async function resumeTextsAction(accountId: string, contactId: string, expectEventId: string, note: string, locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => resumeTexts(ctx, expectEventId, note), locale);
}
export async function confirmStopAction(accountId: string, contactId: string, holdEventId: string, locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => confirmStop(ctx, holdEventId), locale);
}
export async function notAStopAction(accountId: string, contactId: string, holdEventId: string, locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => notAStop(ctx, holdEventId), locale);
}
export async function undoHoldDecisionAction(accountId: string, contactId: string, eventId: string, reopenTaskIds: string[], locale: Locale = "en"): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoHoldDecision(ctx, eventId, reopenTaskIds), locale);
}
