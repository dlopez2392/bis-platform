import type { SupabaseClient } from "@bis/db";
import { createContact, readPersonId, flagMatchesOf, serviceDb, type AccountRole } from "@bis/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { loggableError } from "@/lib/loggable-error";

/**
 * A customer a person adds by hand (F-085 part 1, spec §8), shared by Add contact and the
 * Relationships dialog's "New person" (relationships spec R4): it belongs to whoever adds it
 * (readPersonId: the agency is never a member, so what it adds stays Unassigned). A caller who
 * does not see the whole account (a Technician, or a role that could not be settled) cannot see
 * a duplicate held by someone else (0068), so for them the flag writer is the service client and
 * the matches they cannot see are flagged on the new row afterwards: a row the caller just
 * created, so the service client only ever touches a proven target. Moved here unchanged from
 * createContactAction.
 */
export type HandAddAccess = { userId: string; isAgency: boolean; role: AccountRole | null };

export async function addContactByHand(
  access: HandAddAccess, db: SupabaseClient, accountId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
): Promise<{ id: string; existing: boolean }> {
  const personId = await readPersonId(db, accountId, access.userId);
  const narrow = !seesWholeAccount(access);
  const result = await createContact(db, accountId, { ...input, assignedTo: personId }, access.userId, "user", narrow ? serviceDb() : db);
  if (!result.existing && narrow) {
    try {
      await flagMatchesOf(serviceDb(), accountId, result.id);
    } catch (e) {
      // The customer is saved; only the duplicate flags are missing.
      console.error(`addContactByHand: hidden-match flags not written (account ${accountId}): ${loggableError(e)}`);
    }
  }
  return { id: result.id, existing: result.existing };
}
