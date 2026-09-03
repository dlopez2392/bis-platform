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

/**
 * Renames an account's INTERNAL label (`accounts.name`) — the agency's own
 * note about this client. SERVER ONLY, agency-gated at the call site: since
 * migration 0013, `authenticated` holds UPDATE on the seven branding columns
 * and nothing else, so this write only ever succeeds through `serviceDb()`.
 *
 * Shaped after `setFromEmail` (./sending-identity.ts), for both of its
 * reasons:
 *
 * `.select("id")` so the update reports WHICH rows it touched. PostgREST
 * returns no error and no rows for an update matching nothing — a deleted
 * account behind a stale tab, or an agency admin on a typed account id that
 * does not exist (`requireAccountAccess` returns early for `agency_admin`
 * without proving the row exists) — and that reads as success all the way out
 * to a "saved" toast over a write that changed nothing. This project has
 * already shipped that exact defect once (the stale-tab silent save).
 *
 * The event, because every other account-level write emits one
 * (`account.created`, `account.client_access_enabled`,
 * `account.branding_updated`, `account.sending_identity_updated`) and
 * `accounts` has no `updated_at` column — without a row in `events` a rename
 * is not merely un-notified, it is unrecoverable history.
 *
 * Empty names are the CALLER's rule to enforce (renameAccountAction rejects
 * them before calling this): "" breaks the client switcher, the dashboard
 * greeting and the accounts list, none of which have a fallback for it.
 */
export async function renameAccount(
  db: SupabaseClient, accountId: string, name: string, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ name }).eq("id", accountId).select("id");
  if (error) throw new Error(`renameAccount failed: ${error.message}`);
  if (!data?.length) throw new Error(`renameAccount: no account ${accountId}`);
  await emit(db, accountId, "account.renamed", actorId, { name });
}

export async function getAccountByOrgId(
  db: SupabaseClient, clerkOrgId: string,
): Promise<{ id: string; name: string; client_access_enabled: boolean; timezone: string } | null> {
  const { data, error } = await db.from("accounts")
    .select("id, name, client_access_enabled, timezone").eq("clerk_org_id", clerkOrgId).maybeSingle();
  if (error) throw new Error(`getAccountByOrgId failed: ${error.message}`);
  return data ?? null;
}
