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
    .insert({ agency_id: agency.id, clerk_org_id: input.clerkOrgId, name: input.name, brand_name: input.name, timezone: input.timezone ?? "America/Chicago" })
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

export type A2pStatus = "not_started" | "pending" | "approved" | "rejected";

/** The writable shape. `getA2pRegistration` returns this plus `updatedAt`. */
export type A2pRegistration = {
  brandId: string | null;
  campaignId: string | null;
  status: A2pStatus;
};

export type A2pRegistrationRecord = A2pRegistration & {
  /** When the outcome was last recorded. Surfaced because "with the carriers"
   *  means something very different a day old and a quarter old, and this is
   *  the item whose own help says to expect days to weeks. */
  updatedAt: string | null;
};

/**
 * `approved` is the ONE status the rest of the platform treats as permission —
 * the activation checklist ticks on it and the send path will gate on it — so
 * it is the one status that cannot be recorded without the identifiers it
 * claims to have. An approval with no campaign id is not a lesser record, it
 * is a false one: there is nothing to send on, and the checklist item it ticks
 * is literally "Register A2P 10DLC brand and campaign".
 *
 * Lives here rather than only in the action so that every future caller —
 * Phase 1b's send path included — inherits it.
 */
export function a2pApprovalIsComplete(patch: A2pRegistration): boolean {
  return patch.status !== "approved" || Boolean(patch.brandId && patch.campaignId);
}

/**
 * A2P 10DLC state, recorded rather than performed: registration happens in the
 * Telnyx portal with the carriers, and this is where its outcome lands so the
 * platform can refuse to text on a number that is not cleared.
 *
 * serviceDb ONLY. 0013 revoked UPDATE on accounts from `authenticated` and
 * re-granted seven branding columns alone (0014 later added `reply_to_email`,
 * so the granted set is eight — client-branding-grants.test.ts pins it), so
 * these columns are unwritable by the RLS-scoped client — and unit tests,
 * which mock the database, cannot see that. Callers must be agency-gated.
 *
 * Zero rows is not success, for `renameAccount`'s reason: PostgREST reports no
 * error for an update that matched nothing, so without the check a wrong id
 * returns ok having written nothing.
 */
export async function setA2pRegistration(
  db: SupabaseClient, accountId: string, patch: A2pRegistration, actorId: string,
): Promise<void> {
  if (!a2pApprovalIsComplete(patch)) {
    throw new Error("setA2pRegistration: approved requires a brand id and a campaign id");
  }
  const { data, error } = await db.from("accounts")
    .update({
      a2p_brand_id: patch.brandId,
      a2p_campaign_id: patch.campaignId,
      a2p_status: patch.status,
      a2p_updated_at: new Date().toISOString(),
    })
    .eq("id", accountId).select("id");
  if (error) throw new Error(`setA2pRegistration failed: ${error.message}`);
  if (!data?.length) throw new Error(`setA2pRegistration: no account ${accountId}`);
  // The identifiers ride the event too, not just the status: this is the
  // record that decides whether a client may legally text, and `accounts` has
  // no updated_at history — without them the ledger cannot answer "approved on
  // WHICH campaign".
  await emit(db, accountId, "account.a2p_updated", actorId, {
    status: patch.status, brandId: patch.brandId, campaignId: patch.campaignId,
  });
}

export async function getA2pRegistration(
  db: SupabaseClient, accountId: string,
): Promise<A2pRegistrationRecord | null> {
  const { data, error } = await db.from("accounts")
    .select("a2p_brand_id, a2p_campaign_id, a2p_status, a2p_updated_at")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getA2pRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    brandId: data.a2p_brand_id, campaignId: data.a2p_campaign_id,
    status: data.a2p_status as A2pStatus,
    updatedAt: data.a2p_updated_at,
  };
}

export async function getAccountByOrgId(
  db: SupabaseClient, clerkOrgId: string,
): Promise<{ id: string; name: string; client_access_enabled: boolean; timezone: string } | null> {
  const { data, error } = await db.from("accounts")
    .select("id, name, client_access_enabled, timezone").eq("clerk_org_id", clerkOrgId).maybeSingle();
  if (error) throw new Error(`getAccountByOrgId failed: ${error.message}`);
  return data ?? null;
}

/**
 * Reads `accounts.alert_phone` (0035_alert_phone.sql) — the ONE number
 * bookings and finished calls text when work arrives. NULL means the
 * account gets no alert texts, and that is not a failure: every send site
 * (`b/[publicId]/actions.ts`, `lib/voice/finish-call.ts`) and the inbound
 * loop guard (`api/sms/inbound/route.ts`) treat a null return the same way
 * — as "no work to do," never as an error to surface.
 */
export async function getAlertPhone(
  db: SupabaseClient, accountId: string,
): Promise<string | null> {
  const { data, error } = await db.from("accounts")
    .select("alert_phone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getAlertPhone failed: ${error.message}`);
  return data?.alert_phone ?? null;
}
