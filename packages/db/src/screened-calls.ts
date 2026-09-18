import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A refusal the product used to forget.
 *
 * Six reasons where `texml/route.ts`'s logs have four. `refuse-unknown`
 * merged a wrong number (nobody's problem) with a number we own that is not
 * live (an outage on a paying client); `refuse-disabled` merged "never set
 * up" with "deliberately turned off". Those collapses are why a dead line
 * could sit unnoticed, so un-collapsing them is the point rather than a
 * tidy-up.
 */
export type ScreenedReason =
  | "unknown-number"
  | "not-live"
  | "no-profile"
  | "profile-disabled"
  | "over-cap"
  | "repeat-spam";

/** Mirrors `screened_calls_reason_check` in 0039. Keep the two in step. */
export const SCREENED_REASONS: readonly ScreenedReason[] = [
  "unknown-number", "not-live", "no-profile",
  "profile-disabled", "over-cap", "repeat-spam",
] as const;

export type ScreenedClass = "misconfigured" | "screened" | "unattributed";

/**
 * What KIND of problem a refusal is — derived, never stored.
 *
 * A stored class column would be a second source of truth, free to disagree
 * with the reason beside it on the same row. This is the only one.
 *
 * `misconfigured` is ours to fix and raises the work-queue banner.
 * `screened` is the system working as designed; it is a receipt, not an
 * alarm. `unattributed` is a call to a number this platform does not own —
 * real, countable, and nobody's outage.
 */
export function screenedClass(reason: ScreenedReason): ScreenedClass {
  switch (reason) {
    case "not-live":
    case "no-profile":
    case "profile-disabled":
      return "misconfigured";
    case "over-cap":
    case "repeat-spam":
      return "screened";
    case "unknown-number":
      return "unattributed";
  }
}

export interface ScreenedCallInput {
  /** Null when the dialled number belongs to no account on this platform. */
  accountId: string | null;
  phoneNumberId: string | null;
  calledE164: string;
  /** Null for a withheld caller ID — a real shape, not an error. */
  callerE164: string | null;
  reason: ScreenedReason;
}

export interface ScreenedCallRow {
  id: string;
  accountId: string | null;
  calledE164: string;
  callerE164: string | null;
  reason: ScreenedReason;
  createdAt: string;
}

/**
 * Writes one refusal.
 *
 * THROWS on failure, deliberately — the caller decides what a failure costs,
 * and the only caller (the TeXML route) runs this inside `after()` where a
 * rejection is logged and the call is already over. Swallowing here would
 * hide a broken table from every future caller instead.
 */
export async function recordScreenedCall(
  db: SupabaseClient, input: ScreenedCallInput,
): Promise<void> {
  const { error } = await db.from("screened_calls").insert({
    account_id: input.accountId,
    phone_number_id: input.phoneNumberId,
    called_e164: input.calledE164,
    caller_e164: input.callerE164,
    reason: input.reason,
  });
  if (error) throw new Error(`recordScreenedCall failed: ${error.message}`);
}

const SCREENED_COLS = "id, account_id, called_e164, caller_e164, reason, created_at";

function toRow(r: Record<string, unknown>): ScreenedCallRow {
  return {
    id: r.id as string,
    accountId: (r.account_id as string | null) ?? null,
    calledE164: r.called_e164 as string,
    callerE164: (r.caller_e164 as string | null) ?? null,
    reason: r.reason as ScreenedReason,
    createdAt: r.created_at as string,
  };
}

/**
 * One page of refusals across EVERY account, newest first.
 *
 * Cursor paging, never offset (DESIGN.md): `before` is a `created_at` and the
 * comparison is strictly `<`, so a row can never appear on two pages.
 */
export async function listScreenedCalls(
  db: SupabaseClient, opts: { limit?: number; before?: string } = {},
): Promise<ScreenedCallRow[]> {
  let q = db.from("screened_calls").select(SCREENED_COLS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);
  const { data, error } = await q;
  if (error) throw new Error(`listScreenedCalls failed: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/** The REAL total for the list header — not the number of rows on screen. */
export async function countScreenedCalls(db: SupabaseClient): Promise<number> {
  const { count, error } = await db.from("screened_calls")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`countScreenedCalls failed: ${error.message}`);
  return count ?? 0;
}

/** The three reasons that mean a line is turning callers away. */
const MISCONFIGURED: ScreenedReason[] = ["not-live", "no-profile", "profile-disabled"];

/**
 * How many DISTINCT numbers refused callers because of our own configuration
 * since `sinceIso`.
 *
 * DISTINCT NUMBERS, not refusals: a dialer hammering one dead line is one
 * problem to fix, and a count of refusals would read as a crisis that scales
 * with the spammer's persistence rather than with anything the agency can do.
 *
 * Reads only the column it counts on, and de-duplicates in JS: the row count
 * in a 24-hour window is small by construction, and PostgREST has no
 * `count(distinct)`. If that ever stops being true, this becomes an RPC.
 */
export async function countLinesTurningCallersAway(
  db: SupabaseClient, sinceIso: string,
): Promise<number> {
  const { data, error } = await db.from("screened_calls")
    .select("called_e164")
    .in("reason", MISCONFIGURED)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`countLinesTurningCallersAway failed: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { called_e164: string }).called_e164)).size;
}
