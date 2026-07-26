import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client. SERVER ONLY — bypasses RLS; tenancy is the caller's responsibility. */
export function serviceDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
