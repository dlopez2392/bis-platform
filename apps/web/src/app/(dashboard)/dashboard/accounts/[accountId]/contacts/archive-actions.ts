"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess, requireAccountOwner } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import {
  archiveContacts, restoreContacts, contactDeleteBlockers, listContactUpcomingBookings, serviceDb,
  ContactBatchError, MAX_CONTACT_BATCH, type DeleteBlockReason, type UpcomingBooking,
} from "@bis/db";

/** What Archive and Restore answer. `changedIds` are exactly the contacts this call changed (never one that
 *  was already archived, or already on the list), so the toast's Undo reverses this call and nothing else. */
export type ArchiveActionResult =
  | {
      ok: true; changedIds: string[]; nextAppointment: { contactId: string; startsAt: string } | null; withAppointments: number;
      /** Set when a batch failed after earlier ones changed contacts (ContactBatchError): `changedIds` went, the
       *  rest did not, and the caller says so beside the Undo (Task 10 review I2). Absent on a full answer. */
      partial?: true;
    }
  | { ok: false; errorKey: "contacts.archive.failed" | "contacts.restore.failed" };

/** At most this many ids in one `.in()` (review M1): the size contacts.ts's own batches use. */
const IN_BATCH = 200;

/** A selection from the browser: a non-empty array of UUIDs, at most MAX_CONTACT_BATCH (the bulk bar splits a
 *  bigger one into calls of that size). Anything else is refused before any db call. */
function okIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_CONTACT_BATCH && ids.every((id) => isUuid(id));
}
const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

/** A multi-batch write that failed partway still changed the batches before it (ContactBatchError): those ids
 *  come back with an Undo, rather than a "nothing changed" that would not be true. */
function changedBeforeFailure(e: unknown): string[] {
  return e instanceof ContactBatchError ? e.changedIds : [];
}

/**
 * Archive (owner rulings 2026-10-28): Owners, Staff and the agency; Technicians never (Q3). Refused BY ROLE
 * here, before any db call: a Technician's RLS hides an unassigned contact, so the database would answer 0
 * rows with no error rather than refuse (0103's stamp trigger refuses only the rows it sees). Runs at once;
 * the caller's toast offers Undo with `changedIds`. An upcoming appointment stays and its reminders still go
 * (Q2): the answer says so, for the toast.
 */
export async function archiveContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !okIds(contactIds)) return { ok: false, errorKey: "contacts.archive.failed" };
  let db: Awaited<ReturnType<typeof dbForRequest>>;
  let changedIds: string[];
  try {
    db = await dbForRequest();
    ({ changedIds } = await archiveContacts(db, accountId, contactIds.map((id) => id.toLowerCase())));
  } catch (e) {
    console.error(`contacts archive (account ${accountId}): ${loggableError(e)}`);
    const partial = changedBeforeFailure(e);
    if (partial.length === 0) return { ok: false, errorKey: "contacts.archive.failed" };
    revalidatePath(contactsPath(accountId));
    return { ok: true, changedIds: partial, nextAppointment: null, withAppointments: 0, partial: true };
  }
  let nextAppointment: { contactId: string; startsAt: string } | null = null;
  let withAppointments = 0;
  if (changedIds.length > 0) {
    try {
      const now = new Date().toISOString();
      const upcoming: UpcomingBooking[] = [];
      for (let i = 0; i < changedIds.length; i += IN_BATCH) {
        upcoming.push(...await listContactUpcomingBookings(db, accountId, changedIds.slice(i, i + IN_BATCH), now, MAX_CONTACT_BATCH));
      }
      upcoming.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
      withAppointments = new Set(upcoming.map((b) => b.contact_id)).size;
      const first = upcoming[0];
      if (changedIds.length === 1 && first) nextAppointment = { contactId: first.contact_id, startsAt: first.starts_at };
    } catch (e) {
      // The archive happened; only the toast's appointment line is lost.
      console.error(`contacts archive: upcoming read failed (account ${accountId}): ${loggableError(e)}`);
    }
  }
  revalidatePath(contactsPath(accountId));
  return { ok: true, changedIds, nextAppointment, withAppointments };
}

/** Restore by hand (the Archived view, the record's banner, an Archive's Undo): the same people as Archive, the
 *  same refusal by role, the same answer shape. */
export async function restoreContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !okIds(contactIds)) return { ok: false, errorKey: "contacts.restore.failed" };
  try {
    const { changedIds } = await restoreContacts(await dbForRequest(), accountId, contactIds.map((id) => id.toLowerCase()));
    revalidatePath(contactsPath(accountId));
    return { ok: true, changedIds, nextAppointment: null, withAppointments: 0 };
  } catch (e) {
    console.error(`contacts restore (account ${accountId}): ${loggableError(e)}`);
    const partial = changedBeforeFailure(e);
    if (partial.length === 0) return { ok: false, errorKey: "contacts.restore.failed" };
    revalidatePath(contactsPath(accountId));
    return { ok: true, changedIds: partial, nextAppointment: null, withAppointments: 0, partial: true };
  }
}

/**
 * The delete dialog's "which of these can go" read (spec §5.4), Owner-only like the delete. The ids come
 * from the browser and the blockers read runs on the SERVICE client (0103: contact_delete_blockers is
 * service_role only), so the ids are first read on the REQUEST client, where RLS decides which are this
 * account's contacts, and only those proven ids reach it. A contact absent from `blocked` has nothing in
 * its way. Never an empty answer on a failure: that would read as "nothing blocks".
 *
 * Usable while the account is paused, like the file count beside it (lib/billing/read-only.test.ts lists it):
 * it writes nothing; the delete it prepares is refused then.
 */
export async function contactDeleteBlockersAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; blocked: Record<string, DeleteBlockReason[]> } | { ok: false }> {
  await requireAccountOwner(accountId, { duringPause: "allow" });
  if (!okIds(contactIds)) return { ok: false };
  try {
    const ids = contactIds.map((id) => id.toLowerCase());
    const db = await dbForRequest();
    const proven: string[] = [];
    for (let i = 0; i < ids.length; i += IN_BATCH) {
      const { data, error } = await db.from("contacts").select("id").eq("account_id", accountId).in("id", ids.slice(i, i + IN_BATCH));
      if (error) throw new Error(`contacts proof read failed: ${error.message}`);
      proven.push(...(data ?? []).map((r: { id: string }) => r.id));
    }
    return { ok: true, blocked: Object.fromEntries(await contactDeleteBlockers(serviceDb(), accountId, proven)) };
  } catch (e) {
    console.error(`contacts delete: blockers read failed (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
