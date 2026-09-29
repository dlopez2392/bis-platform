import { getContact, serviceDb } from "@bis/db";
import { normalisePhone } from "@bis/db/phone";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { actorName } from "./actor";
import type { TextsContext } from "./staff-actions";

/**
 * The context a staff action runs in, AFTER the caller's own
 * `requireAccountAccess`: the contact read under the request's RLS client
 * (which is what proves it is this account's), its number as the ledger
 * keys it, and the service client that writes (0053's server-written shape).
 */
export async function textsContextFor(
  accountId: string, contactId: string, userId: string,
): Promise<TextsContext | { ok: false; reason: "no_number" | "failed"; error: string }> {
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    const number = normalisePhone(contact?.phone ?? null);
    if (!contact || !number) return { ok: false, reason: "no_number", error: m["contact.texts.noNumber"] };
    return {
      db, writer: serviceDb(), accountId, contactId, userId, actorName: await actorName(userId),
      address: number.e164, unconfirmed: contact.phone_country_unconfirmed === true || number.unconfirmed,
      now: new Date(),
    };
  } catch (e) {
    console.error(`textsContextFor: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, reason: "failed", error: m["contact.texts.failed"] };
  }
}
