import { auth } from "@clerk/nextjs/server";
import { userDb, type SupabaseClient } from "@bis/db";

/**
 * The Supabase client for anything a signed-in human can reach.
 *
 * RLS applies. Do NOT reach for serviceDb() on the in-account surface — the
 * database backstop is what turns a missed account scope into zero rows
 * instead of another tenant's data.
 *
 * Tables whose writes 0053 took from the client role (events,
 * conversations, messages, form_submissions, bookings, calendars' identity,
 * call_proposals decisions, the once-ever automation stamps) are written by
 * server code: a server action checks access with
 * requireAccountAccess(accountId), reads through this client where it needs
 * RLS to vouch for a row, and writes with serviceDb() scoped to that same
 * accountId - the shape usage_events and the bookings status write already
 * use. emit() on this client is the one such write that stays here: it goes
 * through record_event, which stamps the actor from the token.
 */
export async function dbForRequest(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new Error("dbForRequest: no Clerk token on this request");
  return userDb(token);
}
