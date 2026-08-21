import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

/**
 * The address an account's outbound email leaves FROM.
 *
 * Its own type and its own accessor, NOT part of `Branding`. The reply-to
 * milestone left the instruction to extract an email identity the day a
 * per-account From arrived, and the reason is stronger than tidiness:
 * `Branding` is client-writable and this column must never be. Keeping the two
 * write-scopes in separate types makes the mistake unavailable rather than
 * merely discouraged. See spec §4.
 *
 * `reply_to_email` deliberately stays on `Branding` — a client edits that one
 * on their own page, and moving working code for symmetry would be churn.
 */
export type SendingIdentity = {
  /** null means "send as EMAIL_FROM", which is every account until set. */
  fromEmail: string | null;
};

/**
 * Reads one account's sending identity.
 *
 * A row that does not exist reads as unset rather than throwing, matching
 * getBranding: a missing account is the caller's problem to detect, and this
 * read is on paths that must not 500 over it.
 */
export async function getSendingIdentity(
  db: SupabaseClient, accountId: string,
): Promise<SendingIdentity> {
  const { data, error } = await db.from("accounts")
    .select("from_email").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getSendingIdentity failed: ${error.message}`);
  return { fromEmail: data?.from_email ?? null };
}

/**
 * Sets or clears one account's from-address. SERVER ONLY, agency-gated at the
 * call site — there is no column grant that would let a client reach this.
 *
 * `null` clears. Unlike setBranding there is no undefined-means-leave-alone
 * case, because there is exactly one field: a caller with nothing to say
 * simply does not call this.
 */
export async function setFromEmail(
  db: SupabaseClient, accountId: string, fromEmail: string | null, actorId: string,
): Promise<void> {
  // `.select("id")` so the update reports WHICH rows it touched. PostgREST
  // returns no error and no rows for an update matching nothing, which reads
  // as success and would report a save that changed nothing.
  const { data, error } = await db.from("accounts")
    .update({ from_email: fromEmail }).eq("id", accountId).select("id");
  if (error) throw new Error(`setFromEmail failed: ${error.message}`);
  if (!data?.length) throw new Error(`setFromEmail: no account ${accountId}`);
  await emit(db, accountId, "account.sending_identity_updated", actorId, {
    fromEmail,
  });
}
