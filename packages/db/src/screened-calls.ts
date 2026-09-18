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
  db: SupabaseClient, opts: { limit?: number; before?: string; class?: ScreenedClass } = {},
): Promise<ScreenedCallRow[]> {
  let q = db.from("screened_calls").select(SCREENED_COLS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);
  // Filters by CLASS, never by a single reason: the banner and this list's
  // own header both think in the three classes (misconfigured / screened /
  // unattributed), and `reasonsForClass` is the one place that expands a
  // class into the reasons it covers.
  if (opts.class) q = q.in("reason", reasonsForClass(opts.class));
  const { data, error } = await q;
  if (error) throw new Error(`listScreenedCalls failed: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/**
 * The REAL total for the list header — not the number of rows on screen.
 *
 * `opts.class`, when given, is the SAME filter `listScreenedCalls` applies —
 * so a filtered list's header can state the total that matches what is
 * actually on screen, rather than the all-time unfiltered total the banner's
 * own (differently-scoped) count must never be confused with.
 *
 * `opts.accountId` is OPTIONAL and exists for test isolation, not for either
 * page: `/dashboard/screened` is deliberately agency-wide and never passes
 * it. Without a scope, this is a GLOBAL count — a concurrent write anywhere
 * in the shared project moves it out from under a test asserting an exact
 * `after - before` delta, which is exactly what happened running this
 * suite's own class-filter test two-at-once.
 */
export async function countScreenedCalls(
  db: SupabaseClient, opts: { class?: ScreenedClass; accountId?: string } = {},
): Promise<number> {
  let q = db.from("screened_calls").select("id", { count: "exact", head: true });
  if (opts.class) q = q.in("reason", reasonsForClass(opts.class));
  if (opts.accountId) q = q.eq("account_id", opts.accountId);
  const { count, error } = await q;
  if (error) throw new Error(`countScreenedCalls failed: ${error.message}`);
  return count ?? 0;
}

/** The three reasons that mean a line is turning callers away. */
const MISCONFIGURED: ScreenedReason[] = ["not-live", "no-profile", "profile-disabled"];

/**
 * The reasons belonging to one class — DERIVED from `screenedClass`, never a
 * second hardcoded list that could drift from it. `misconfigured` reuses
 * `MISCONFIGURED` directly (the exact three reasons
 * `countMisconfiguredScreenedCalls` and the work-queue banner already filter
 * to); the other two classes fall out of `SCREENED_REASONS` run through the
 * same `screenedClass` switch that classifies a single reason, so a class's
 * reason set can never disagree with what `screenedClass` says about any one
 * of its members.
 */
function reasonsForClass(cls: ScreenedClass): ScreenedReason[] {
  if (cls === "misconfigured") return MISCONFIGURED;
  return SCREENED_REASONS.filter((r) => screenedClass(r) === cls);
}

/**
 * The REAL misconfigured total for the list header's breakdown — across
 * EVERY page, never `rows.filter(...).length` on the 50 rows a caller
 * happens to be looking at.
 *
 * Reuses `MISCONFIGURED` (the same three reasons `countLinesTurningCallersAway`
 * already filters to) rather than a second reason list: one place decides
 * which reasons are ours to fix, and this and the work-queue banner both
 * read it. Unlike that banner, this counts ROWS, not distinct numbers — the
 * list header is a receipt of how many refusals landed, not a queue of
 * lines to go fix — and it carries no time window and no `.limit()`: a
 * head-count query has no page to be limited to.
 *
 * `accountId` is OPTIONAL, for test isolation only — the list header this
 * feeds is agency-wide by design and never passes it. See
 * `countScreenedCalls`'s own doc comment for why an unscoped exact-delta
 * assertion is unsafe under concurrent load without it.
 */
export async function countMisconfiguredScreenedCalls(
  db: SupabaseClient, accountId?: string,
): Promise<number> {
  let q = db.from("screened_calls")
    .select("id", { count: "exact", head: true })
    .in("reason", MISCONFIGURED);
  if (accountId) q = q.eq("account_id", accountId);
  const { count, error } = await q;
  if (error) throw new Error(`countMisconfiguredScreenedCalls failed: ${error.message}`);
  return count ?? 0;
}

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
 * `count(distinct)`. If that ever stops being true, this becomes an RPC. A
 * defensive `.limit(5000)` bounds the read regardless: this runs as
 * `service_role`, whose `rolconfig` carries no `statement_timeout` at all,
 * and PostgREST's `db-max-rows` is unset, so without it the read is
 * genuinely unbounded today.
 *
 * `accountId` is OPTIONAL, for test isolation only — the work-queue banner
 * this feeds is agency-wide by design and never passes it. See
 * `countScreenedCalls`'s own doc comment for why an unscoped exact-delta
 * assertion is unsafe under concurrent load without it.
 */
export async function countLinesTurningCallersAway(
  db: SupabaseClient, sinceIso: string, accountId?: string,
): Promise<number> {
  let q = db.from("screened_calls")
    .select("called_e164")
    .in("reason", MISCONFIGURED)
    .gte("created_at", sinceIso)
    .limit(5000);
  if (accountId) q = q.eq("account_id", accountId);
  const { data, error } = await q;
  if (error) throw new Error(`countLinesTurningCallersAway failed: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { called_e164: string }).called_e164)).size;
}
