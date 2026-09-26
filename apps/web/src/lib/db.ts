import { auth } from "@clerk/nextjs/server";
import { userDb, type SupabaseClient } from "@bis/db";

/**
 * The Supabase client for anything a signed-in human can reach.
 *
 * RLS applies. Do NOT reach for serviceDb() on the in-account surface — the
 * database backstop is what turns a missed account scope into zero rows
 * instead of another tenant's data.
 *
 * The one exception: tables 0053 made server-written (events, conversations,
 * messages, form_submissions, bookings, call_proposals decisions). A server
 * action READS through this client (that is its authorisation) and WRITES
 * those rows with serviceDb() for the account requireAccountAccess returned.
 * Events are the exception to the exception: emit() on this client goes
 * through record_event, which stamps the actor from the token.
 */
export async function dbForRequest(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new Error("dbForRequest: no Clerk token on this request");
  return userDb(token);
}
