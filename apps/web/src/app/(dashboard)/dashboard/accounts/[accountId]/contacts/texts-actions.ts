"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { textsContextFor } from "@/lib/consent/texts-context";
import {
  stopTexts, undoStopTexts, resumeTexts, confirmStop, notAStop, undoHoldDecision,
  type TextsActionResult, type TextsContext,
} from "@/lib/consent/staff-actions";

/** The Texts row's actions (consent chain PR-2, spec §4.2 "Staff controls"). Each re-reads the contact under RLS. */
async function run(
  accountId: string, contactId: string, act: (ctx: TextsContext) => Promise<TextsActionResult>,
): Promise<TextsActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await textsContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) {
    revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
    revalidatePath(`/dashboard/accounts/${accountId}/tasks`);
  }
  return result;
}

export async function stopTextsAction(accountId: string, contactId: string, expectNewest: string | null): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => stopTexts(ctx, expectNewest));
}
export async function undoStopTextsAction(accountId: string, contactId: string, eventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoStopTexts(ctx, eventId));
}
export async function resumeTextsAction(accountId: string, contactId: string, expectEventId: string, note: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => resumeTexts(ctx, expectEventId, note));
}
export async function confirmStopAction(accountId: string, contactId: string, holdEventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => confirmStop(ctx, holdEventId));
}
export async function notAStopAction(accountId: string, contactId: string, holdEventId: string): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => notAStop(ctx, holdEventId));
}
export async function undoHoldDecisionAction(accountId: string, contactId: string, eventId: string, reopenTaskIds: string[]): Promise<TextsActionResult> {
  return run(accountId, contactId, (ctx) => undoHoldDecision(ctx, eventId, reopenTaskIds));
}
