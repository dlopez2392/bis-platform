import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A call the platform put through to a person instead of to Sofía (0059).
 *
 * The daily caps count `calls` rows, and a forwarded call never gets one —
 * Sofía's webhook writes that row, and a forwarded call never reaches it. So
 * without this record, a robot calling while the forward is on (or while
 * Sofía is down and the fallback forwards) rang the business's own phone
 * without limit. These rows are the count the caps were missing.
 *
 * `VOICE_FORWARD_TO` is deliberately never recorded: it runs before any
 * lookup, has no account, and bypasses the caps on purpose.
 */
export type ForwardKind = "account-forward" | "model-down";

/** Mirrors `forwarded_calls_kind_check` in 0059. Keep the two in step. */
export const FORWARD_KINDS: readonly ForwardKind[] = ["account-forward", "model-down"] as const;

export interface ForwardedCallInput {
  accountId: string;
  phoneNumberId: string | null;
  calledE164: string;
  /** Null for a withheld caller ID. */
  callerE164: string | null;
  kind: ForwardKind;
}

/**
 * Writes one forwarded call.
 *
 * THROWS on failure, as `recordScreenedCall` does and for its reason: both
 * callers run this inside `after()`, where a rejection is logged and the call
 * is already connected. Swallowing here would hide a broken table.
 */
export async function recordForwardedCall(
  db: SupabaseClient, input: ForwardedCallInput,
): Promise<void> {
  const { error } = await db.from("forwarded_calls").insert({
    account_id: input.accountId,
    phone_number_id: input.phoneNumberId,
    called_e164: input.calledE164,
    caller_e164: input.callerE164,
    kind: input.kind,
  });
  if (error) throw new Error(`recordForwardedCall failed: ${error.message}`);
}

/**
 * Forwarded calls since `sinceIso`, for the account and for one caller on it —
 * the two numbers the TeXML route adds to `countCallsSince` and
 * `countCallsByCallerSince` before `decideLimit` sees them.
 *
 * Head-only counts, like the `calls` counts beside them: no rows travel, so
 * no `.limit()` can truncate a count. A null caller (withheld ID) counts 0 for
 * the caller, as the `calls` side does.
 */
export async function countForwardedCallsSince(
  db: SupabaseClient, accountId: string, callerE164: string | null, sinceIso: string,
): Promise<{ forAccount: number; forCaller: number }> {
  const account = db.from("forwarded_calls").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("created_at", sinceIso);
  const caller = callerE164
    ? db.from("forwarded_calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("caller_e164", callerE164).gte("created_at", sinceIso)
    : null;
  const [a, c] = await Promise.all([account, caller]);
  if (a.error) throw new Error(`countForwardedCallsSince failed: ${a.error.message}`);
  if (c?.error) throw new Error(`countForwardedCallsSince failed: ${c.error.message}`);
  // A HEAD request for a table PostgREST does not know (not applied yet, or
  // applied without `notify pgrst, 'reload schema'`) is a 404 with no body,
  // which postgrest-js reports as NO error and a null count. Read as 0, that
  // would switch the forward cap off without a word, so a missing count is
  // an error here: the caller fails open, and says so in its log.
  if (a.count === null || (c && c.count === null)) {
    throw new Error("countForwardedCallsSince failed: no count returned (is forwarded_calls in PostgREST's schema cache?)");
  }
  return { forAccount: a.count, forCaller: c?.count ?? 0 };
}
