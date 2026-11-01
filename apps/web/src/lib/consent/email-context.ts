import { getContact, serviceDb } from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";
import { actorName } from "./actor";
import type { EmailContext } from "./email-staff-actions";

/**
 * The context an Email row action runs in, AFTER the caller's own
 * requireAccountAccess: the contact read under the request's RLS client
 * (which proves it is this account's), its address as the ledger keys it,
 * and the service client that writes (0053's server-written shape).
 */
export async function emailContextFor(
  accountId: string, contactId: string, userId: string,
  // S-10 leftovers (#317 follow-up, item 7): default "en" so a caller that predates this
  // param is unchanged.
  locale: Locale = "en",
): Promise<EmailContext | { ok: false; reason: "no_email" | "failed"; error: string }> {
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    const address = emailLedgerAddress(contact?.email ?? null);
    if (!contact || !address) return { ok: false, reason: "no_email", error: t(m, "contact.email.noEmail", locale) };
    return { db, writer: serviceDb(), accountId, contactId, userId, actorName: await actorName(userId), address, now: new Date(), locale };
  } catch (e) {
    console.error(`emailContextFor: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, reason: "failed", error: t(m, "contact.email.failed", locale) };
  }
}
