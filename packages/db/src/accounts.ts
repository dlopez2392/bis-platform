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

export async function setClientAccess(
  db: SupabaseClient, accountId: string, enabled: boolean, actorId: string,
): Promise<void> {
  const { error } = await db.from("accounts")
    .update({ client_access_enabled: enabled }).eq("id", accountId);
  if (error) throw new Error(`setClientAccess failed: ${error.message}`);
  await emit(db, accountId, enabled ? "account.client_access_enabled" : "account.client_access_disabled", actorId, {});
}

export async function getAccountByOrgId(
  db: SupabaseClient, clerkOrgId: string,
): Promise<{ id: string; name: string; client_access_enabled: boolean; timezone: string } | null> {
  const { data, error } = await db.from("accounts")
    .select("id, name, client_access_enabled, timezone").eq("clerk_org_id", clerkOrgId).maybeSingle();
  if (error) throw new Error(`getAccountByOrgId failed: ${error.message}`);
  return data ?? null;
}
