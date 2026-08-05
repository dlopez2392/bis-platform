import { auth } from "@clerk/nextjs/server";
import { userDb, type SupabaseClient } from "@bis/db";

/**
 * The Supabase client for anything a signed-in human can reach.
 *
 * RLS applies. Do NOT reach for serviceDb() on the in-account surface — the
 * database backstop is what turns a missed account scope into zero rows
 * instead of another tenant's data.
 */
export async function dbForRequest(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new Error("dbForRequest: no Clerk token on this request");
  return userDb(token);
}
