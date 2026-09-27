import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Marks a client made by userDb(). Symbol.for, not a module-local symbol or a
 * WeakSet: a bundler that duplicates this module still shares the registry
 * key, so emit() can never mistake a user client for a server one.
 */
const USER_CLIENT = Symbol.for("@bis/db:user-client");

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
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  Object.defineProperty(client, USER_CLIENT, { value: true });
  return client;
}

/** True for a client made by userDb(): its requests run as `authenticated`. */
export function isUserClient(db: SupabaseClient): boolean {
  return (db as unknown as Record<symbol, unknown>)[USER_CLIENT] === true;
}
