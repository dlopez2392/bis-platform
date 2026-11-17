import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCOUNT_BRAND_COLS } from "./booking";
import { brandDisplayName, type Branding } from "./branding";
import type { AccountRole } from "./team";

/**
 * The daily owner brief (migration owner_brief_subscriptions): who opted in, and which account-local day each
 * subscription last handled. Plan docs/superpowers/plans/2026-11-15-daily-owner-brief.md, D1, D2 and D4.
 *
 * Server code only: the migration grants the table to service_role alone, so every caller passes `serviceDb()`.
 * The opt-in is written by a server action keyed on Clerk's own user id (PR 4); the per-day columns by the pass
 * (PR 3). Row present = on; turning it off deletes the row. THROWS on a read or write error.
 */
const TABLE = "owner_brief_subscriptions";

/**
 * Who may receive the brief (D1, owner answer Q1): Owner and Staff, each by their own opt-in. A Technician never:
 * the brief's content is read with the service role scoped by account id, which equals what an Owner or Staff
 * member sees, while a Technician's narrower scope lives only in RLS (0068). Its OWN constant, not an alias of
 * the owner line's OWNER_LINE_ROLES: if that list ever widens, this one must not widen with it.
 */
export const DAILY_BRIEF_ROLES = ["owner", "staff"] as const satisfies readonly AccountRole[];
export type DailyBriefRole = (typeof DAILY_BRIEF_ROLES)[number];

export type BriefOutcome = "sent" | "quiet";

/** One subscription. Days are the ACCOUNT-local calendar day, "YYYY-MM-DD". */
export type BriefSubscription = {
  id: string;
  userId: string;
  accountId: string;
  enabledAt: string;
  /** The account-local day last decided (sent OR quiet), or held by a claim in flight. */
  lastHandledDay: string | null;
  /** The account-local day a brief was last actually sent. */
  lastSentDay: string | null;
  lastOutcome: BriefOutcome | null;
};

const COLS = "id, user_id, account_id, enabled_at, last_handled_day, last_sent_day, last_outcome";
type Row = {
  id: string; user_id: string; account_id: string; enabled_at: string;
  last_handled_day: string | null; last_sent_day: string | null; last_outcome: BriefOutcome | null;
};
const toSubscription = (r: Row): BriefSubscription => ({
  id: r.id, userId: r.user_id, accountId: r.account_id, enabledAt: r.enabled_at,
  lastHandledDay: r.last_handled_day, lastSentDay: r.last_sent_day, lastOutcome: r.last_outcome,
});

/** A real calendar day as "YYYY-MM-DD", or a throw. The day rides a PostgREST `or` filter string, so nothing but
 *  digits and dashes may reach it. */
function assertDay(day: string, fn: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== day) throw new Error(`${fn}: ${JSON.stringify(day)} is not a calendar day`);
}

/**
 * Turn the brief on for this person on this business. Idempotent: a second call returns the existing row,
 * unchanged (its enabled_at and day stamps stand). The table's foreign key to memberships refuses a person who is
 * not on that business's team; the caller checks the ROLE (DAILY_BRIEF_ROLES) before calling.
 */
export async function subscribeToBrief(
  db: SupabaseClient, s: { userId: string; accountId: string },
): Promise<BriefSubscription> {
  const { error } = await db.from(TABLE)
    .upsert({ user_id: s.userId, account_id: s.accountId }, { onConflict: "account_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`subscribeToBrief failed: ${error.message}`);
  const { data, error: readErr } = await db.from(TABLE).select(COLS)
    .eq("account_id", s.accountId).eq("user_id", s.userId).single();
  if (readErr) throw new Error(`subscribeToBrief failed: ${readErr.message}`);
  return toSubscription(data as Row);
}

/** Turn it off: delete the row, by its id (the signed link) or by person and business (Preferences). True when a
 *  row was deleted, false when there was none (already off). */
export async function unsubscribeFromBrief(
  db: SupabaseClient, target: { id: string } | { userId: string; accountId: string },
): Promise<boolean> {
  const q = db.from(TABLE).delete();
  const scoped = "id" in target
    ? q.eq("id", target.id)
    : q.eq("account_id", target.accountId).eq("user_id", target.userId);
  const { data, error } = await scoped.select("id");
  if (error) throw new Error(`unsubscribeFromBrief failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Every subscription of this person (users.id), oldest first. */
export async function listMySubscriptions(db: SupabaseClient, userId: string): Promise<BriefSubscription[]> {
  const { data, error } = await db.from(TABLE).select(COLS).eq("user_id", userId)
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw new Error(`listMySubscriptions failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toSubscription);
}

/**
 * One subscription the pass may send for, carrying everything it needs. `brandName` and never an account name:
 * `accounts.name` is the agency's internal label, so it is not selected and not on this type.
 */
export type DueBriefSubscription = {
  subscriptionId: string;
  userId: string;
  accountId: string;
  role: DailyBriefRole;
  /** users.email: the address the brief goes to. */
  email: string;
  /** users.language, the person's own choice (D5: first), or null. */
  personLanguage: "en" | "es" | null;
  /** accounts.language, the fallback, or null (English at the send site). */
  accountLanguage: "en" | "es" | null;
  accountTimezone: string;
  brandName: string;
  branding: Branding;
  replyToEmail: string | null;
  enabledAt: string;
  lastHandledDay: string | null;
  lastSentDay: string | null;
  lastOutcome: BriefOutcome | null;
};

/** PostgREST caps one response at max_rows (supabase/config.toml), silently; the weekly report's page size. */
const DUE_BRIEF_PAGE = 1000;

type DueRow = Row & {
  created_at: string;
  users: { email: string; language: "en" | "es" | null } | null;
  memberships: { role: DailyBriefRole } | null;
  accounts: {
    timezone: string; brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
    brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"]; brand_type: Branding["brandType"];
    brand_mode: Branding["brandMode"]; reply_to_email: string | null; language: "en" | "es" | null;
  } | null;
};

/**
 * Every subscription that may receive a brief now (D1): its person is still on the business's team with a role in
 * DAILY_BRIEF_ROLES (read through the table's foreign key to memberships, so a role change counts the same day), and
 * the business is not outbound-suppressed, not archived, and has client access on. All filtered SERVER-SIDE in one
 * statement per page; a filtered-out row never crosses the wire. Whether it is 7 AM in the account's zone, and
 * whether today was already handled, are the PASS's questions (D4).
 *
 * Paged past PostgREST's silent max_rows the way listAccountsDueWeeklyReport is (D-067): advance by the rows a page
 * actually returned and stop only on an empty page. Ordered by created_at then id, a total order that a concurrent
 * write to another row cannot reshuffle between pages.
 */
export async function listDueBriefSubscriptions(db: SupabaseClient): Promise<DueBriefSubscription[]> {
  const rows: DueRow[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await db.from(TABLE)
      .select(`${COLS}, created_at, users!inner(email, language), memberships!inner(role), ` +
        `accounts!inner(status, client_access_enabled, ${ACCOUNT_BRAND_COLS})`)
      .in("memberships.role", [...DAILY_BRIEF_ROLES])
      // A suppressed account sends nothing (0032): the brief is a real send to a real inbox every morning.
      .eq("accounts.outbound_suppressed", false)
      .eq("accounts.client_access_enabled", true)
      .neq("accounts.status", "archived")
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(from, from + DUE_BRIEF_PAGE - 1);
    if (error) throw new Error(`listDueBriefSubscriptions failed: ${error.message}`);
    const page = (data ?? []) as unknown as DueRow[];
    rows.push(...page);
    if (page.length === 0) break;
    from += page.length;
  }
  return rows.flatMap((r) => {
    // !inner makes each embed present; the guard only satisfies the type.
    if (!r.users || !r.memberships || !r.accounts) return [];
    const a = r.accounts;
    const branding: Branding = {
      brandName: a.brand_name ?? null, brandLogoPath: a.brand_logo_path ?? null, brandColor: a.brand_color ?? null,
      brandNeutral: a.brand_neutral ?? null, brandCorners: a.brand_corners ?? null, brandType: a.brand_type ?? null,
      brandMode: a.brand_mode ?? null, replyToEmail: a.reply_to_email ?? null,
    };
    return [{
      subscriptionId: r.id, userId: r.user_id, accountId: r.account_id, role: r.memberships.role,
      email: r.users.email, personLanguage: r.users.language ?? null, accountLanguage: a.language ?? null,
      accountTimezone: a.timezone, brandName: brandDisplayName(branding), branding, replyToEmail: a.reply_to_email ?? null,
      enabledAt: r.enabled_at, lastHandledDay: r.last_handled_day, lastSentDay: r.last_sent_day, lastOutcome: r.last_outcome,
    }];
  });
}

/**
 * Claim `day` (account-local "YYYY-MM-DD") for this subscription, BEFORE sending (D4): ONE conditional UPDATE, so of
 * any number of concurrent ticks (a replayed dispatch included) exactly one gets true. False means another run
 * holds or already handled the day, or the subscription is gone: do not send. The caller keeps the row's earlier
 * last_handled_day to hand to releaseBriefDay.
 */
export async function claimBriefDay(db: SupabaseClient, id: string, day: string): Promise<boolean> {
  assertDay(day, "claimBriefDay");
  const { data, error } = await db.from(TABLE).update({ last_handled_day: day })
    .eq("id", id).or(`last_handled_day.is.null,last_handled_day.lt.${day}`).select("id");
  if (error) throw new Error(`claimBriefDay failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/**
 * Give a claim back after a definite send failure, so the next tick inside the band retries: last_handled_day
 * returns to `previous` (null on a first claim). Only while the row still holds exactly `day`, and never for a day
 * already stamped sent, so a release run out of order cannot re-open a day that went out. True when released.
 */
export async function releaseBriefDay(
  db: SupabaseClient, r: { id: string; day: string; previous: string | null },
): Promise<boolean> {
  assertDay(r.day, "releaseBriefDay");
  if (r.previous !== null) {
    assertDay(r.previous, "releaseBriefDay");
    if (r.previous >= r.day) throw new Error(`releaseBriefDay: previous ${r.previous} is not before ${r.day}`);
  }
  const { data, error } = await db.from(TABLE).update({ last_handled_day: r.previous })
    .eq("id", r.id).eq("last_handled_day", r.day).or(`last_sent_day.is.null,last_sent_day.lt.${r.day}`).select("id");
  if (error) throw new Error(`releaseBriefDay failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/**
 * Record how a claimed day ended: 'sent' (also stamps last_sent_day, which Preferences shows as "Last one") or
 * 'quiet' (nothing to say; last_sent_day stands). Only while the row still holds `day`. True when written.
 */
export async function stampBriefOutcome(
  db: SupabaseClient, s: { id: string; day: string; outcome: BriefOutcome },
): Promise<boolean> {
  assertDay(s.day, "stampBriefOutcome");
  const patch = s.outcome === "sent" ? { last_outcome: "sent", last_sent_day: s.day } : { last_outcome: "quiet" };
  const { data, error } = await db.from(TABLE).update(patch).eq("id", s.id).eq("last_handled_day", s.day).select("id");
  if (error) throw new Error(`stampBriefOutcome failed: ${error.message}`);
  return (data ?? []).length === 1;
}
