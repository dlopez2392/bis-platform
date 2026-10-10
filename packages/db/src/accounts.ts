import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";
import { assertUsableZone } from "./timezone";

export async function createAccount(
  db: SupabaseClient,
  input: {
    clerkOrgId: string; name: string; timezone?: string; actorId: string;
    /**
     * The name customers see (`brand_name`). Add company asks for it as its
     * own field (owner decision 2026-10-09), so the agency's private label
     * (`name`, e.g. "Rio Roofing — trial") never becomes the brand. Absent
     * means `name` — fixtures, the demo and adopting an orphan, where the
     * one name they have IS the public one — so no account is ever born
     * without a brand name.
     */
    brandName?: string;
    /**
     * Born with outbound suppressed, in the INSERT itself. For the demo
     * tenant only: created and then suppressed, it existed contactable for
     * two round trips, and on the shared CI project a test reading the live
     * demo in that gap saw an unsuppressed account. Absent means the column's
     * default (not suppressed), as for every real account.
     */
    outboundSuppressed?: boolean;
  },
): Promise<{ id: string }> {
  // BEFORE the agency read, so an unusable zone costs no round trip and — more
  // to the point — no half-made account. This is the ONLY write path for
  // accounts.timezone in the product, so it is the only place the bad value
  // can enter; see ./timezone for why it throws instead of falling back.
  //
  // An ABSENT zone still takes the default below. Absent means the operator
  // left the field alone; a present-but-broken value means they typed
  // something, and the two deserve different answers.
  const timezone = input.timezone === undefined ? "America/Chicago" : assertUsableZone(input.timezone);

  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`agency row missing: ${agErr?.message}`);

  const { data: account, error } = await db
    .from("accounts")
    .insert({
      agency_id: agency.id, clerk_org_id: input.clerkOrgId, name: input.name,
      brand_name: input.brandName?.trim() || input.name, timezone,
      ...(input.outboundSuppressed ? { outbound_suppressed: true } : {}),
    })
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

/**
 * The Spanish-runtime account-level default (0065_account_language.sql).
 * This is a STRUCTURAL duplicate of the canonical `Locale` type
 * (`apps/web/src/lib/i18n/locale.ts`, Task 2) — `packages/db` must not
 * import from `apps/web`, so the two are kept in sync by a parity test on
 * the app side, not by sharing an import.
 */
export type Locale = "en" | "es";

/**
 * Reads `accounts.language`. NULL means no preference recorded — NOT
 * English — `resolveLocale()` (Task 4, apps/web) is what turns a null
 * return into the product default; this function returns the stored fact
 * only. Owner decision 2026-10-10: this column governs CLIENT-role
 * sessions only, so a caller resolving for an agency operator must not
 * call this at all.
 */
export async function getAccountLanguage(
  db: SupabaseClient, accountId: string,
): Promise<Locale | null> {
  const { data, error } = await db.from("accounts")
    .select("language").eq("id", accountId).single();
  if (error) throw new Error(`getAccountLanguage failed: ${error.message}`);
  return (data?.language as Locale | null) ?? null;
}

/**
 * Sets `accounts.language`. SERVER ONLY — 0065 grants `authenticated` no
 * UPDATE on this column (same shape as `transfer_phone`/`alert_phone`), so
 * the only writer is the agency Settings server action (Task 5), through
 * `serviceDb()`. Shaped after `renameAccount`/`setAlertPhone`: `.select("id")`
 * so PostgREST's "no error, no rows" on a zero-row update cannot read as
 * success for a stale tab or a wrong account id, and an `account.*` event is
 * emitted because `accounts` has no `updated_at` column to fall back on.
 */
export async function setAccountLanguage(
  db: SupabaseClient, accountId: string, language: Locale, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ language }).eq("id", accountId).select("id");
  if (error) throw new Error(`setAccountLanguage failed: ${error.message}`);
  if (!data?.length) throw new Error(`setAccountLanguage: no account ${accountId}`);
  await emit(db, accountId, "account.language_updated", actorId, { language });
}

export type A2pStatus = "not_started" | "pending" | "approved" | "rejected";

/** The writable shape. `getA2pRegistration` returns this plus `updatedAt`. */
export type A2pRegistration = {
  brandId: string | null;
  campaignId: string | null;
  status: A2pStatus;
  /** This business's OWN Telnyx messaging profile (0056, plan Task 7): lowercase uuid. */
  messagingProfileId: string | null;
};

/** A Telnyx messaging profile id as 0056's CHECK accepts it: a lowercase uuid. */
export function isMessagingProfileId(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
}

/** Another account already recorded this profile (0056's unique index). */
export class MessagingProfileTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagingProfileTakenError";
  }
}

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
  return patch.status !== "approved" || Boolean(patch.brandId && patch.campaignId && patch.messagingProfileId);
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
    throw new Error("setA2pRegistration: approved requires a brand id, a campaign id and a messaging profile id");
  }
  const { data, error } = await db.from("accounts")
    .update({
      a2p_brand_id: patch.brandId,
      a2p_campaign_id: patch.campaignId,
      a2p_status: patch.status,
      telnyx_messaging_profile_id: patch.messagingProfileId,
      a2p_updated_at: new Date().toISOString(),
    })
    .eq("id", accountId).select("id");
  if (error?.code === "23505") {
    throw new MessagingProfileTakenError(`setA2pRegistration: messaging profile ${patch.messagingProfileId} is another account's`);
  }
  if (error) throw new Error(`setA2pRegistration failed: ${error.message}`);
  if (!data?.length) throw new Error(`setA2pRegistration: no account ${accountId}`);
  // The identifiers ride the event too, not just the status: this is the
  // record that decides whether a client may legally text, and `accounts` has
  // no updated_at history — without them the ledger cannot answer "approved on
  // WHICH campaign".
  await emit(db, accountId, "account.a2p_updated", actorId, {
    status: patch.status, brandId: patch.brandId, campaignId: patch.campaignId,
    messagingProfileId: patch.messagingProfileId,
  });
}

export async function getA2pRegistration(
  db: SupabaseClient, accountId: string,
): Promise<A2pRegistrationRecord | null> {
  const { data, error } = await db.from("accounts")
    .select("a2p_brand_id, a2p_campaign_id, a2p_status, a2p_updated_at, telnyx_messaging_profile_id")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getA2pRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    brandId: data.a2p_brand_id, campaignId: data.a2p_campaign_id,
    status: data.a2p_status as A2pStatus,
    messagingProfileId: (data as { telnyx_messaging_profile_id: string | null }).telnyx_messaging_profile_id,
    updatedAt: data.a2p_updated_at,
  };
}

export async function getAccountByOrgId(
  db: SupabaseClient, clerkOrgId: string,
): Promise<{ id: string; name: string; client_access_enabled: boolean; timezone: string; language: string | null } | null> {
  // `language` added (Spanish-runtime lane, Task 6 fix round 1): the
  // DASHBOARD layout's own chrome (AppSidebar/Topbar) renders ABOVE
  // [accountId]/layout.tsx in the tree, so the per-account locale it needs
  // has to come from THIS read (via resolveClientAccessState below) rather
  // than a second query — no extra round trip, one more column on the same
  // row.
  const { data, error } = await db.from("accounts")
    .select("id, name, client_access_enabled, timezone, language").eq("clerk_org_id", clerkOrgId).maybeSingle();
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

/**
 * Sets or clears `accounts.alert_phone` (0035_alert_phone.sql). SERVER ONLY,
 * agency-gated at the call site (`setAlertPhoneAction`, behind
 * `requireAgencyOnlyAccountAccess`) — shaped after `setFromEmail`
 * (./sending-identity.ts) for the same reason: 0035 deliberately grants
 * `authenticated` no UPDATE on this column, so a client able to reach it
 * directly could redirect the account's own lead-alert texts to a handset
 * they choose. Nothing in the database stands behind the write below; the
 * agency-only gate at the call site is the only thing that does.
 *
 * `alertPhone` is trusted to already be E.164 or null — the caller
 * (`setAlertPhoneAction`) runs it through `toE164` first and passes `null`
 * straight through for a blank field, never `""`: 0035's CHECK constraint
 * refuses the empty string outright so that NULL stays the only spelling of
 * "off", and a caller that got this wrong would see the write fail loudly
 * rather than the switch going ambiguous.
 *
 * `.select("id")` so the update reports WHICH rows it touched — the same
 * stale-tab / wrong-id guard `setFromEmail` and `renameAccount` use, since
 * PostgREST returns no error and no rows for an update matching nothing,
 * which would otherwise read as a successful save that changed nothing.
 */
export async function setAlertPhone(
  db: SupabaseClient, accountId: string, alertPhone: string | null, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ alert_phone: alertPhone }).eq("id", accountId).select("id");
  if (error) throw new Error(`setAlertPhone failed: ${error.message}`);
  if (!data?.length) throw new Error(`setAlertPhone: no account ${accountId}`);
  await emit(db, accountId, "account.alert_phone_updated", actorId, { alertPhone });
}

/**
 * Reads `accounts.transfer_phone` (0037_call_handoff.sql) — the ONE number a
 * caller who asks for a person is connected to. NULL means this account
 * offers no transfer, and that is not a failure: it is the state every
 * account is in today. Every consumer must treat a null return as "there is
 * no path to a person on this account" and fall back to the message-and-
 * callback the product has always offered, never as an error to surface.
 */
export async function getTransferPhone(
  db: SupabaseClient, accountId: string,
): Promise<string | null> {
  const { data, error } = await db.from("accounts")
    .select("transfer_phone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getTransferPhone failed: ${error.message}`);
  return data?.transfer_phone ?? null;
}

/**
 * Sets or clears `accounts.transfer_phone` (0037_call_handoff.sql). SERVER
 * ONLY, agency-gated at the call site, exactly like `setAlertPhone` above and
 * for a strictly stronger version of its reason: 0037 deliberately grants
 * `authenticated` no UPDATE on this column, and whoever can write it decides
 * who this account's LIVE CALLERS are connected to — on the tenant's own
 * trunk, at the tenant's own per-minute cost. Nothing in the database stands
 * behind the write below; the gate at the call site is the only thing that
 * does.
 *
 * `transferPhone` is trusted to already be E.164 or null — callers run it
 * through `toE164` first and pass `null` straight through for a blank field,
 * never `""`: 0037's CHECK refuses the empty string outright so that NULL
 * stays the only spelling of "off", and a caller that got this wrong sees the
 * write fail loudly rather than the switch going ambiguous.
 *
 * `.select("id")` so the update reports WHICH rows it touched — PostgREST
 * returns no error and no rows for an update matching nothing, which would
 * otherwise read as a successful save that changed nothing.
 */
export async function setTransferPhone(
  db: SupabaseClient, accountId: string, transferPhone: string | null, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ transfer_phone: transferPhone }).eq("id", accountId).select("id");
  if (error) throw new Error(`setTransferPhone failed: ${error.message}`);
  if (!data?.length) throw new Error(`setTransferPhone: no account ${accountId}`);
  await emit(db, accountId, "account.transfer_phone_updated", actorId, { transferPhone });
}
