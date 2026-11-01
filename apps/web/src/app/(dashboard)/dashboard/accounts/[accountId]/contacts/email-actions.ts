"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { emailContextFor } from "@/lib/consent/email-context";
import {
  stopEmails, undoStopEmails, resumeEmails, type EmailActionResult, type EmailContext,
} from "@/lib/consent/email-staff-actions";
import type { Locale } from "@/lib/i18n/locale";

/** The Email row's actions (consent chain PR-3). Each re-reads the contact under RLS.
 *  S-10 leftovers (#317 follow-up, item 7): `locale` threads through to emailContextFor,
 *  the Texts row's own fix mirrored for email — default "en" so a caller that predates
 *  this param is unchanged. */
async function run(
  accountId: string, contactId: string, act: (ctx: EmailContext) => Promise<EmailActionResult>, locale: Locale = "en",
): Promise<EmailActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await emailContextFor(accountId, contactId, userId, locale);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  return result;
}

export async function stopEmailsAction(accountId: string, contactId: string, expectNewest: string | null, locale: Locale = "en"): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => stopEmails(ctx, expectNewest), locale);
}
export async function undoStopEmailsAction(accountId: string, contactId: string, eventId: string, locale: Locale = "en"): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => undoStopEmails(ctx, eventId), locale);
}
export async function resumeEmailsAction(accountId: string, contactId: string, expectEventId: string, note: string, locale: Locale = "en"): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => resumeEmails(ctx, expectEventId, note), locale);
}
