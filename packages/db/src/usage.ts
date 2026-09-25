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

/**
 * How far into the FUTURE a row's `occurred_at` may be and still be sent.
 * Stripe accepts a meter event timestamped up to 5 minutes ahead of its own
 * clock and silently drops one further out (same asynchronous-validation
 * shape as USAGE_REPORT_WINDOW_MS's past-side bound, undocumented as a
 * number but observed in Stripe's meter event handling). A row past this
 * bound is left unreported rather than sent and stamped `reported_at`,
 * which would bury it: `reported_at` is this codebase's only record of
 * "Stripe has it", and there is no un-reporting a row once stamped.
 */
export const USAGE_FUTURE_GRACE_MS = 5 * 60 * 1000;

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
 * out by construction. Paged by account id, continuing until an actually
 * EMPTY page: a page shorter than BILLED_PAGE is NOT proof there is no more
 * — if the project's PostgREST `max_rows` setting is below BILLED_PAGE, a
 * request for 1,000 rows can come back with fewer than 1,000 even though
 * more remain, and advancing `from` by the requested page size (rather than
 * the page's actual length) would then skip the rest of that window
 * entirely, silently dropping billed accounts. Advancing by `rows.length`
 * and stopping only on zero rows is correct under any `max_rows` value.
 */
export async function listBilledUsageAccounts(db: SupabaseClient): Promise<BilledUsageAccount[]> {
  const out: BilledUsageAccount[] = [];
  for (let from = 0; ; ) {
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
    if (rows.length === 0) return out;
    from += rows.length;
  }
}

/**
 * Accounts per read for a filter with TWO parts per account (`account_id.eq`
 * and `occurred_at.gte` — staleUsageAccountIds is the only caller: it never
 * sets a `beforeIso`, so its ranges stay two-part). Measured with node
 * (usage.test.ts), at the longest an id and a timestamp can be (a uuid; a
 * microsecond, `+00:00`-suffixed `occurred_at`): 50 such accounts encode to
 * about 6,150 characters, under postgrest-js's own 8,000-character warning
 * and a common 8 KB request-line limit. A filter with a THIRD part per
 * account (a `beforeIso` on every range) needs its OWN smaller
 * USAGE_ACCOUNTS_PER_BOUNDED_READ below — at 50 accounts that shape measures
 * about 9,350 characters, already past the 8,000-character warning. Do not
 * reuse this constant for a caller that sets `beforeIso` on every range
 * (listReportableUsage's own future-grace ceiling is exactly that shape —
 * see USAGE_ACCOUNTS_PER_BOUNDED_READ).
 */
export const USAGE_ACCOUNTS_PER_READ = 50;

/**
 * Accounts per read for a filter that carries BOTH a floor and a ceiling on
 * every range (three `and(...)` parts per account): countExpiredUsage's
 * expired-row window, and listReportableUsage's per-account range now that
 * every range also carries the USAGE_FUTURE_GRACE_MS ceiling. Half of
 * USAGE_ACCOUNTS_PER_READ: measured (usage.test.ts) at 25 accounts, maximum
 * id/timestamp length, the encoded filter is about 4,700 characters,
 * comfortably under the 6,000-character bound that test pins — chunking
 * either of those two reads by USAGE_ACCOUNTS_PER_READ (50) instead measures
 * past 9,000, over postgrest-js's 8,000-character warning.
 */
export const USAGE_ACCOUNTS_PER_BOUNDED_READ = 25;

/** One account's slice of occurred_at: from `fromIso` (inclusive), before
 *  `beforeIso` (exclusive) when given. */
export type UsageRange = { accountId: string; fromIso: string; beforeIso?: string };

/** The shape Postgres accepts as a uuid (automations.ts's
 *  parseQuoteFollowupConfig is the precedent for this exact pattern). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A PostgREST `or` filter selecting each account's rows in ITS OWN range, so
 * one read serves many accounts whose windows differ (each billing start is
 * its own floor). Timestamps are double-quoted: with a real `MeterKey`
 * timestamp (from the database or `toISOString()`) supabase-js already
 * percent-encodes the value before it reaches PostgREST — `+` becomes
 * `%2B`, so PostgREST never sees the bare `.`/`:`/`+` this quoting was
 * written to escape, and unquoted timestamps are proven to parse
 * identically in ./test/usage.test.ts's live read. The quoting stays anyway
 * as defence-in-depth against a future caller passing an unencoded value
 * through some other path, and because it matches automations.ts's
 * eitherAnchorSince precedent for the same column type.
 *
 * Account ids are asserted to be uuids and REFUSED otherwise: `account_id`
 * is not quoted, so an id built from anything but a real uuid — one
 * carrying `,`, `(` or `)` — could otherwise widen the filter to name rows
 * outside the caller's ranges (e.g. `x),account_id.not.is.null,and(...)`).
 * Every caller here sources ids from `accounts.id` (uuid primary key), so
 * this can only fire on a defect upstream — which is exactly when it must
 * throw rather than silently building a wider query.
 */
export function usageRangeFilter(ranges: readonly UsageRange[]): string {
  return ranges.map((r) => {
    if (!UUID_RE.test(r.accountId)) {
      throw new Error(`usageRangeFilter: accountId is not a uuid: ${JSON.stringify(r.accountId)}`);
    }
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
 * at most `limit`: unreported, each account's from its own `reportableFrom`,
 * and none dated more than USAGE_FUTURE_GRACE_MS past `now` (a row further
 * in the future than that stays unreported rather than being sent — Stripe
 * would silently drop it — and stamped reported by markUsageReported, which
 * would bury it for good). One read per USAGE_ACCOUNTS_PER_BOUNDED_READ
 * accounts — every range here carries a `beforeIso` (the future-grace
 * ceiling), so it is the three-part filter shape, not
 * USAGE_ACCOUNTS_PER_READ's two-part one — each ordered and limited in SQL,
 * then merged here, so the result is the true oldest `limit` rows.
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
  const untilIso = new Date(now.getTime() + USAGE_FUTURE_GRACE_MS).toISOString();
  const rows: UsageRow[] = [];
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_BOUNDED_READ)) {
    const ranges = reportableRanges(group, now).map((r) => ({ ...r, beforeIso: untilIso }));
    const { data, error } = await db.from("usage_events").select(USAGE_COLUMNS)
      .is("reported_at", null)
      .or(usageRangeFilter(ranges))
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

/** The most rows ONE stale-probe read may return. The probe only has to learn
 *  WHICH accounts hold a stale row, never how many rows they hold, so a read
 *  is small and the next one names only the accounts not yet found. */
export const STALE_PROBE_ROWS = 50;

/**
 * The billed accounts, among those given, with STALE usage: a reportable
 * row (G3's window) still unreported a day after it was RECORDED
 * (`created_at`, not `occurred_at`: a row recorded late is not late to
 * Stripe until it has waited a day). One definition for the cron's log and
 * the agency banner, in the accounts' own order.
 *
 * BOUNDED BY ACCOUNTS, NEVER BY BACKLOG. Per group of USAGE_ACCOUNTS_PER_READ
 * accounts, one read of at most STALE_PROBE_ROWS rows over the accounts NOT
 * YET FOUND; every account a read names leaves the next read's filter, and
 * the group is done on the first EMPTY read. A non-empty read always names
 * at least one account still in the filter, so a group takes at most (its
 * stale accounts + 1) reads, and one call reads at most
 * STALE_PROBE_ROWS × (stale accounts + groups) rows — however many stale
 * rows pile up while Stripe is down. (It used to page through EVERY stale
 * row, 1,000 at a time: a day-long outage made the tick's bookkeeping grow
 * with the backlog.)
 *
 * Only an EMPTY read ends a group, never a SHORT one: a read shorter than
 * STALE_PROBE_ROWS is not proof nothing else matches (a project whose
 * PostgREST `max_rows` is below it returns short reads while rows remain).
 * Narrowing the filter is what makes that safe: the loop stops only when
 * no account left in the filter has a stale row.
 */
export async function staleUsageAccountIds(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<string[]> {
  const createdBefore = new Date(now.getTime() - USAGE_STALE_AFTER_MS).toISOString();
  const stale = new Set<string>();
  for (const group of inGroups(accounts, USAGE_ACCOUNTS_PER_READ)) {
    let open = group;
    while (open.length > 0) {
      const { data, error } = await db.from("usage_events").select("account_id")
        .is("reported_at", null).lt("created_at", createdBefore)
        .or(usageRangeFilter(reportableRanges(open, now)))
        .order("id", { ascending: true })
        .limit(STALE_PROBE_ROWS);
      if (error) throw new Error(`staleUsageAccountIds failed: ${error.message}`);
      const rows = (data ?? []) as { account_id: string }[];
      const found = new Set(rows.map((r) => r.account_id).filter((id) => open.some((a) => a.accountId === id)));
      // Empty, or (defensively) naming no account still open: nothing left
      // to learn from this group.
      if (found.size === 0) break;
      for (const id of found) stale.add(id);
      open = open.filter((a) => !found.has(a.accountId));
    }
  }
  return accounts.filter((a) => stale.has(a.accountId)).map((a) => a.accountId);
}

/**
 * Unreported rows of billed accounts that fell OUT of the window: from the
 * billing start to now − 34 days. Never sent (Stripe would drop them without
 * an error), counted so the cron can say so. Only accounts billed before
 * that floor can have any; one count per USAGE_ACCOUNTS_PER_BOUNDED_READ of
 * them (this filter carries a `beforeIso` on every range, so it needs the
 * smaller chunk — see that constant).
 */
export async function countExpiredUsage(
  db: SupabaseClient, accounts: readonly BilledUsageAccount[], now: Date,
): Promise<number> {
  const floorMs = now.getTime() - USAGE_REPORT_WINDOW_MS;
  const floorIso = new Date(floorMs).toISOString();
  const old = accounts.filter((a) => Date.parse(a.billingStartedAt) < floorMs);
  let total = 0;
  for (const group of inGroups(old, USAGE_ACCOUNTS_PER_BOUNDED_READ)) {
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
