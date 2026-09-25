import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeterKey } from "./billing";

/**
 * The usage ledger (0051's `usage_events`): one row per billable fact, and
 * the reads the cron's usage report and the agency's stale-usage banner make
 * over it. Client billing spec 2026-09-24, section 3 flow 3 and section 4.
 *
 * Writes need serviceDb(): 0051 grants `authenticated` SELECT on
 * usage_events and nothing more, so a client can neither forge nor erase its
 * own bill. Writers set `updated_at` themselves (0051 has no trigger).
 */

/** What each meter counts, as the prefix of `source_ref`. The unique key is
 *  (meter, source_ref), so these prefixes are what make "one call is billed
 *  once as minutes" true. */
export const USAGE_SOURCE_PREFIX: Record<MeterKey, string> = {
  voice_minutes: "call:",
  sms: "message:",
  ai_chats: "conversation:",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the report still sends a row. Stripe takes a meter event up
 * to 35 CALENDAR days old and validates that asynchronously: an older event
 * is accepted, then dropped, with no error this process ever sees (Stripe
 * docs, "Handle meter event errors": `timestamp_too_far_in_past`). One day
 * of margin keeps a row sent near the edge from being stamped reported and
 * never billed. An older row is counted `expired` and never sent.
 */
export const USAGE_REPORT_WINDOW_MS = 34 * DAY_MS;

/** A reportable row still unreported this long after it was RECORDED raises
 *  the agency banner (spec section 4: "unreported for > 24 h"). */
export const USAGE_STALE_AFTER_MS = DAY_MS;

export type UsageInput = {
  accountId: string;
  meter: MeterKey;
  /** Whole units: minutes, segments or conversations. Never a fraction. */
  quantity: number;
  occurredAt: Date;
  /** `<prefix><id>`, the prefix fixed by the meter (USAGE_SOURCE_PREFIX). */
  sourceRef: string;
};

export type UsageRow = {
  id: string;
  accountId: string;
  meter: MeterKey;
  quantity: number;
  /** As PostgREST returns it, microseconds included. */
  occurredAt: string;
  sourceRef: string;
  reportedAt: string | null;
  createdAt: string;
};

/** A billed account as the report and the banner see it. */
export type BilledUsageAccount = {
  accountId: string;
  stripeCustomerId: string;
  /** `account_billing.created_at`, untouched: usage before it is never sent. */
  billingStartedAt: string;
};

type UsageDbRow = {
  id: string; account_id: string; meter: MeterKey; quantity: number; occurred_at: string;
  source_ref: string; reported_at: string | null; created_at: string;
};

const USAGE_COLUMNS = "id, account_id, meter, quantity, occurred_at, source_ref, reported_at, created_at";

function toUsageRow(r: UsageDbRow): UsageRow {
  return {
    id: r.id, accountId: r.account_id, meter: r.meter, quantity: r.quantity, occurredAt: r.occurred_at,
    sourceRef: r.source_ref, reportedAt: r.reported_at, createdAt: r.created_at,
  };
}

function assertUsage(input: UsageInput): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new Error(`recordUsage: quantity must be a positive whole number, got ${input.quantity}`);
  }
  const prefix = USAGE_SOURCE_PREFIX[input.meter];
  if (prefix === undefined) throw new Error(`recordUsage: unknown meter ${JSON.stringify(input.meter)}`);
  const ref = input.sourceRef;
  if (!ref.startsWith(prefix) || ref.length === prefix.length || ref.length > 200) {
    throw new Error(
      `recordUsage: a ${input.meter} source_ref is "${prefix}<id>" and at most 200 characters, got ${JSON.stringify(ref.slice(0, 60))}`,
    );
  }
  if (Number.isNaN(input.occurredAt.getTime())) throw new Error("recordUsage: occurredAt is not a valid date");
}

/**
 * Records one billable fact ONCE: an insert with ON CONFLICT (meter,
 * source_ref) DO NOTHING (`upsert` + `ignoreDuplicates`, crm-config.ts's
 * precedent), so recording the same call, message or conversation again
 * changes nothing and says "duplicate". It never updates a row: a stored
 * quantity is what Stripe was, or will be, sent.
 *
 * Throws on a malformed input (before any query) and on any other database
 * error. Send paths never call this directly: they call apps/web's
 * `recordUsageSafely`, which catches.
 */
export async function recordUsage(db: SupabaseClient, input: UsageInput): Promise<"recorded" | "duplicate"> {
  assertUsage(input);
  const { data, error } = await db.from("usage_events")
    .upsert({
      account_id: input.accountId, meter: input.meter, quantity: input.quantity,
      occurred_at: input.occurredAt.toISOString(), source_ref: input.sourceRef,
    }, { onConflict: "meter,source_ref", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`recordUsage failed: ${error.message}`);
  return (data ?? []).length === 1 ? "recorded" : "duplicate";
}

/**
 * The earliest `occurred_at` the report still sends for an account: its
 * billing start, or the 34-day window's floor when that is later. The
 * billing start is returned UNTOUCHED (PostgREST's microseconds kept); only
 * the floor is built here.
 */
export function reportableFrom(billingStartedAt: string, now: Date): string {
  const windowStartMs = now.getTime() - USAGE_REPORT_WINDOW_MS;
  return Date.parse(billingStartedAt) >= windowStartMs ? billingStartedAt : new Date(windowStartMs).toISOString();
}

const BILLED_PAGE = 1000;

/**
 * Every account whose usage goes to Stripe: an account_billing row with a
 * Stripe customer AND a subscription. A complimentary row never has a
 * subscription (0051's account_billing_complimentary_check), so it is left
 * out by construction. Paged by account id so a PostgREST row cap can never
 * silently drop an account.
 */
export async function listBilledUsageAccounts(db: SupabaseClient): Promise<BilledUsageAccount[]> {
  const out: BilledUsageAccount[] = [];
  for (let from = 0; ; from += BILLED_PAGE) {
    const { data, error } = await db.from("account_billing")
      .select("account_id, stripe_customer_id, created_at")
      .not("stripe_customer_id", "is", null)
      .not("stripe_subscription_id", "is", null)
      .order("account_id", { ascending: true })
      .range(from, from + BILLED_PAGE - 1);
    if (error) throw new Error(`listBilledUsageAccounts failed: ${error.message}`);
    const rows = (data ?? []) as { account_id: string; stripe_customer_id: string; created_at: string }[];
    for (const r of rows) {
      out.push({ accountId: r.account_id, stripeCustomerId: r.stripe_customer_id, billingStartedAt: r.created_at });
    }
    if (rows.length < BILLED_PAGE) return out;
  }
}

/**
 * Accounts per read in the per-account reads below. Each account adds one
 * `and(...)` clause (about 100 characters) to the request URL, so 50 keep a
 * read near 5 KB however many accounts are billed (assumption A18). Today
 * that is ONE read.
 */
export const USAGE_ACCOUNTS_PER_READ = 50;

/** One account's slice of occurred_at: from `fromIso` (inclusive), before
 *  `beforeIso` (exclusive) when given. */
export type UsageRange = { accountId: string; fromIso: string; beforeIso?: string };

/**
 * A PostgREST `or` filter selecting each account's rows in ITS OWN range, so
 * one read serves many accounts whose windows differ (each billing start is
 * its own floor). Timestamps are double-quoted, the documented escape for
 * the `.`, `:` and `+` a timestamp carries inside a logic-tree value
 * (automations.ts's eitherAnchorSince is the precedent, proven live; this
 * file's live test proves it with PostgREST's own `+00:00` microsecond
 * strings). Account ids are uuids and timestamps come from the database or
 * toISOString(): neither can carry the `"`, `,` or `(` that would break out.
 */
export function usageRangeFilter(ranges: readonly UsageRange[]): string {
  return ranges.map((r) => {
    const parts = [`account_id.eq.${r.accountId}`, `occurred_at.gte."${r.fromIso}"`];
    if (r.beforeIso !== undefined) parts.push(`occurred_at.lt."${r.beforeIso}"`);
    return `and(${parts.join(",")})`;
  }).join(",");
}

function inGroups<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Each account's reportable range: from max(billing start, now − 34 days). */
function reportableRanges(accounts: readonly BilledUsageAccount[], now: Date): UsageRange[] {
  return accounts.map((a) => ({ accountId: a.accountId, fromIso: reportableFrom(a.billingStartedAt, now) }));
}

const oldestFirst = (x: UsageRow, y: UsageRow): number =>
  Date.parse(x.occurredAt) - Date.parse(y.occurredAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/**
 * The next rows the report may send, OLDEST FIRST ACROSS the accounts given,
 * at most `limit`: unreported, each account's from its own `reportableFrom`.
 * One read per USAGE_ACCOUNTS_PER_READ accounts, each ordered and limited in
 * SQL, then merged here, so the result is the true oldest `limit` rows.
 *
 * Oldest first across accounts is the fairness rule (G4): no account waits
 * behind another's place in a list, and a backlog drains in the order it
 * grew. The merge compares milliseconds; within one millisecond the order is
 * by id, which no caller relies on.
 */
export async function listReportableUsage(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date, limit: number,
): Promise<UsageRow[]> {
  if (!Number.isSafeInteger(limit) || limit <= 0 || accounts.length === 0) return [];
  const rows: UsageRow[] = [];
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_READ)) {
    const { data, error } = await db.from("usage_events").select(USAGE_COLUMNS)
      .is("reported_at", null)
      .or(usageRangeFilter(reportableRanges(group, now)))
      .order("occurred_at", { ascending: true }).order("id", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`listReportableUsage failed: ${error.message}`);
    rows.push(...((data ?? []) as UsageDbRow[]).map(toUsageRow));
  }
  return rows.sort(oldestFirst).slice(0, limit);
}

/** Stamps a row reported, once. True when this call stamped it; false when
 *  it already was (a concurrent tick got there first). */
export async function markUsageReported(db: SupabaseClient, id: string, at: Date): Promise<boolean> {
  const stamp = at.toISOString();
  const { data, error } = await db.from("usage_events")
    .update({ reported_at: stamp, updated_at: stamp })
    .eq("id", id).is("reported_at", null)
    .select("id");
  if (error) throw new Error(`markUsageReported failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** PostgREST's default page; a read that returns this many rows may have
 *  more behind it. */
const STALE_READ_ROWS = 1000;

/**
 * The billed accounts, among those given, with STALE usage: a reportable
 * row (G3's window) still unreported a day after it was RECORDED
 * (`created_at`, not `occurred_at`: a row recorded late is not late to
 * Stripe until it has waited a day). One definition for the cron's log and
 * the agency banner, in the accounts' own order.
 *
 * One read per USAGE_ACCOUNTS_PER_READ accounts. A read returns ROWS, not
 * accounts, so one account's backlog can fill it: when a read comes back
 * full, the accounts it named are settled and the rest are read again. Each
 * repeat names at least one new account, so it ends; with nothing stale it
 * is exactly one read per group.
 */
export async function staleUsageAccountIds(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<string[]> {
  const createdBefore = new Date(now.getTime() - USAGE_STALE_AFTER_MS).toISOString();
  const stale = new Set<string>();
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_READ)) {
    let pending = group;
    while (pending.length > 0) {
      const { data, error } = await db.from("usage_events").select("account_id")
        .is("reported_at", null).lt("created_at", createdBefore)
        .or(usageRangeFilter(reportableRanges(pending, now)))
        .limit(STALE_READ_ROWS);
      if (error) throw new Error(`staleUsageAccountIds failed: ${error.message}`);
      const rows = (data ?? []) as { account_id: string }[];
      for (const r of rows) stale.add(r.account_id);
      if (rows.length < STALE_READ_ROWS) break;
      pending = pending.filter((a) => !stale.has(a.accountId));
    }
  }
  return accounts.filter((a) => stale.has(a.accountId)).map((a) => a.accountId);
}

/**
 * Unreported rows of billed accounts that fell OUT of the window: from the
 * billing start to now − 34 days. Never sent (Stripe would drop them without
 * an error), counted so the cron can say so. Only accounts billed before
 * that floor can have any; one count per USAGE_ACCOUNTS_PER_READ of them.
 */
export async function countExpiredUsage(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<number> {
  const floorMs = now.getTime() - USAGE_REPORT_WINDOW_MS;
  const floorIso = new Date(floorMs).toISOString();
  const old = accounts.filter((a) => Date.parse(a.billingStartedAt) < floorMs);
  let total = 0;
  for (const group of inGroups(old, USAGE_ACCOUNTS_PER_READ)) {
    const { count, error } = await db.from("usage_events").select("id", { count: "exact", head: true })
      .is("reported_at", null)
      .or(usageRangeFilter(group.map((a) => ({ accountId: a.accountId, fromIso: a.billingStartedAt, beforeIso: floorIso }))));
    if (error) throw new Error(`countExpiredUsage failed: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

/** The billed accounts with stale usage (the banner's count is its length):
 *  the paged billed-account list, then staleUsageAccountIds over it. */
export async function listAccountsWithStaleUsage(db: SupabaseClient, now: Date): Promise<string[]> {
  return staleUsageAccountIds(db, await listBilledUsageAccounts(db), now);
}
