import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client authenticated as the CALLING USER. RLS applies.
 *
 * Contrast with serviceDb(), which bypasses RLS entirely. Use this for any
 * surface a client user can reach — the database is the backstop that turns a
 * missed account scope into zero rows instead of another tenant's data.
 */
export function userDb(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase url/anon env vars missing");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
