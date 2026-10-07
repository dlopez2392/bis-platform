"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { emailContextFor } from "@/lib/consent/email-context";
import {
  stopEmails, undoStopEmails, resumeEmails, type EmailActionResult, type EmailContext,
} from "@/lib/consent/email-staff-actions";

/** The Email row's actions (consent chain PR-3). Each re-reads the contact under RLS. */
async function run(
  accountId: string, contactId: string, act: (ctx: EmailContext) => Promise<EmailActionResult>,
): Promise<EmailActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await emailContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  return result;
}

export async function stopEmailsAction(accountId: string, contactId: string, expectNewest: string | null): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => stopEmails(ctx, expectNewest));
}
export async function undoStopEmailsAction(accountId: string, contactId: string, eventId: string): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => undoStopEmails(ctx, eventId));
}
export async function resumeEmailsAction(accountId: string, contactId: string, expectEventId: string, note: string): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => resumeEmails(ctx, expectEventId, note));
}
