import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

export async function createAccount(
  db: SupabaseClient,
  input: { clerkOrgId: string; name: string; timezone?: string; actorId: string },
): Promise<{ id: string }> {
  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`agency row missing: ${agErr?.message}`);

  const { data: account, error } = await db
    .from("accounts")
    .insert({ agency_id: agency.id, clerk_org_id: input.clerkOrgId, name: input.name, timezone: input.timezone ?? "America/Chicago" })
    .select("id")
    .single();
  if (error || !account) throw new Error(`createAccount failed: ${error?.message}`);

  await emit(db, account.id, "account.created", input.actorId, { name: input.name });
  return { id: account.id };
}

export async function listAccounts(db: SupabaseClient) {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, clerk_org_id, status, timezone, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
