import { serviceDb, type SupabaseClient } from "@bis/db";

/**
 * Consent is keyed by ADDRESS, and a STOP can arrive with no contact_id
 * (spec §7.3). Under 0068 a Technician's own token sees only ledger rows
 * whose contact_id is theirs, so a display read on the request client could
 * show "can text" for a number the gate refuses (the gates read through the
 * service client already: conversations/actions.ts passes `writer`).
 *
 * Use ONLY after the contact was read through the caller's own client
 * (getContact on dbForRequest): that read is the authorisation; this client
 * then reads the ledger for that contact's own address. Same answer for
 * Owner and Staff, so every role uses it.
 */
export function ledgerDb(): SupabaseClient {
  return serviceDb();
}
