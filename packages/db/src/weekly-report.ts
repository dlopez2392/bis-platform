import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccountBrandInfo, ACCOUNT_BRAND_COLS } from "./booking";
import { brandDisplayName, type Branding } from "./branding";
import { emit } from "./events";

/**
 * One account the weekly report can be sent for, carrying everything the pass
 * needs so it never has to reach back for a second lookup — the same shape as
 * `DueReviewRequest`, and for the same reason.
 *
 * `brandName` and NEVER an account name: `accounts.name` is the agency's
 * internal label ("Rio Roofing — trial") and it has reached customers three
 * times. A pass cannot leak what it cannot reach, so the label is not on this
 * type at all.
 */
export type AccountDueWeeklyReport = {
  accountId: string;
  /** The no-prior-week rule reads this: a comparison window that starts before
   *  the account existed is not a comparison, and its delta is omitted. */
  createdAt: string;
  reportEmails: string[];
  accountTimezone: string;
  brandName: string;
  branding: Branding;
  replyToEmail: string | null;
  /** `accounts.weekly_report_week` — the Monday last sent FOR, or null. */
  lastSentWeek: string | null;
  /** A linked site exists, so the website line is ALLOWED. When false the line
   *  is omitted entirely: a zero we did not measure must not look like a zero
   *  we did. */
  hasSite: boolean;
};

/**
 * Every account due a weekly report — meaning every account with at least one
 * recipient. Whether it is Monday, and whether this week was already sent, are
 * the PASS's questions, not this one's: those need the account's own zone,
 * which is on the rows this returns.
 *
 * An account with no recipients is filtered out SERVER-SIDE and never crosses
 * the wire. That is what makes "not configured" a non-event rather than a
 * failure the pass has to count.
 */
export async function listAccountsDueWeeklyReport(
  db: SupabaseClient,
): Promise<AccountDueWeeklyReport[]> {
  const { data, error } = await db.from("accounts")
    .select("id, created_at, report_emails, weekly_report_week")
    // PostgREST spells "array is not the empty array" as a `neq` against the
    // literal `{}`. A `.not("report_emails", "is", null)` would NOT do it:
    // the column is `not null default '{}'`, so the empty case is a value.
    .neq("report_emails", "{}");
  if (error) throw new Error(`listAccountsDueWeeklyReport failed: ${error.message}`);

  const rows = (data ?? []) as {
    id: string; created_at: string;
    report_emails: string[]; weekly_report_week: string | null;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const info = await loadAccountBrandInfo(db, ids, "listAccountsDueWeeklyReport");

  // ONE read for every account's site flag, not one per row. `sites` holds at
  // most one row per account today, but this asks the question the report
  // actually has — "is there anything to measure" — rather than assuming that.
  const { data: siteRows, error: siteErr } = await db.from("sites")
    .select("account_id").in("account_id", ids);
  if (siteErr) throw new Error(`listAccountsDueWeeklyReport sites failed: ${siteErr.message}`);
  const withSite = new Set((siteRows ?? []).map((s: { account_id: string }) => s.account_id));

  return rows.map((r) => {
    const brand = info.get(r.id)!;
    return {
      accountId: r.id,
      createdAt: r.created_at,
      reportEmails: r.report_emails,
      accountTimezone: brand.accountTimezone,
      brandName: brandDisplayName(brand.branding),
      branding: brand.branding,
      replyToEmail: brand.replyToEmail,
      lastSentWeek: r.weekly_report_week,
      hasSite: withSite.has(r.id),
    };
  });
}

/**
 * Records the Monday this account's report was sent FOR.
 *
 * Written by the cron's service client only — `accounts` carries no client
 * UPDATE grant on this column, deliberately, because a client able to write it
 * could forge the stamp and suppress its own report.
 */
export async function stampWeeklyReportSent(
  db: SupabaseClient, accountId: string, week: string,
): Promise<void> {
  const { error } = await db.from("accounts")
    .update({ weekly_report_week: week }).eq("id", accountId);
  if (error) throw new Error(`stampWeeklyReportSent failed: ${error.message}`);
}

/**
 * Sets an account's weekly-report recipient list. SERVER ONLY, agency-gated
 * at the call site (`setReportEmailsAction`, behind
 * `requireAgencyOnlyAccountAccess`) — shaped after `setFromEmail`
 * (./sending-identity.ts) for the same reason: migration 0031 deliberately
 * grants `authenticated` no UPDATE on `report_emails`, so a client able to
 * reach this column directly could redirect its own account's report to any
 * address it chooses. Nothing in the database stands behind the write below;
 * the agency-only gate at the call site is the only thing that does.
 *
 * `emails` is trusted to already be trimmed and validated — the caller
 * (`setReportEmailsAction`) does both before calling this. An empty array is
 * a normal, meaningful value, not an edge case: it is how an account ends up
 * with no recipients, and `listAccountsDueWeeklyReport` already treats that
 * as "not a due row" rather than a failure.
 *
 * `.select("id")` so the update reports WHICH rows it touched — the same
 * stale-tab / wrong-id guard `setFromEmail` and `renameAccount` use, since
 * PostgREST returns no error and no rows for an update matching nothing,
 * which would otherwise read as a successful save that changed nothing.
 */
export async function setReportEmails(
  db: SupabaseClient, accountId: string, emails: string[], actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ report_emails: emails }).eq("id", accountId).select("id");
  if (error) throw new Error(`setReportEmails failed: ${error.message}`);
  if (!data?.length) throw new Error(`setReportEmails: no account ${accountId}`);
  await emit(db, accountId, "account.report_emails_updated", actorId, { reportEmails: emails });
}

/**
 * One row per account for the agency's weekly roll-up (spec
 * 2026-09-10-weekly-report-design, "weeklyAgencyReportPass") — every
 * account, unlike `AccountDueWeeklyReport`/`listAccountsDueWeeklyReport`
 * above, which exist to drive a SEND and therefore correctly exclude an
 * account with no recipients entirely. The roll-up's whole point is to make
 * that silence visible to the agency, so `hasRecipients` rides the type
 * instead of the row being dropped.
 *
 * `brandName` and NEVER an account name, for the same reason as
 * `AccountDueWeeklyReport`: `accounts.name` is the agency's internal label
 * and it has reached customers three times. A roll-up row names a real
 * company to a real human reading their own mail, so it carries what
 * `AccountDueWeeklyReport` carries and nothing this type does not have a
 * field for.
 */
export type AccountForWeeklyRollup = {
  accountId: string;
  /** Same fabricated-delta guard as the client email, applied per row: a
   *  comparison window starting before the account existed is not a
   *  comparison. */
  createdAt: string;
  accountTimezone: string;
  brandName: string;
  /** A linked site exists, so the website figure is ALLOWED. When false the
   *  figure is omitted entirely — never a zero it did not measure. */
  hasSite: boolean;
  /** Whether `report_emails` is non-empty. False is not an error here — it
   *  is the exact thing this read exists to surface. */
  hasRecipients: boolean;
};

/**
 * Every account, full stop — the roll-up's own read, deliberately separate
 * from `listAccountsDueWeeklyReport` above: that query filters to accounts
 * WITH a recipient because it exists to drive sends, and an account with
 * none is correctly invisible to it. The roll-up's job is the opposite — a
 * client silently receiving nothing must be visible to the agency — so it
 * cannot reuse a read that was built to hide exactly that case.
 */
export async function listAccountsForWeeklyRollup(
  db: SupabaseClient,
): Promise<AccountForWeeklyRollup[]> {
  // ONE read, brand columns included — deliberately NOT the account list
  // followed by `loadAccountBrandInfo`.
  //
  // That shape had a real race, and the full db suite found it: this function
  // reads EVERY account (unlike the due query, which reads only accounts with
  // recipients), and `loadAccountBrandInfo` does a `.single()` per id that
  // THROWS when a row is missing — correctly, for a due row whose account must
  // exist. Here it is wrong: an account deleted between the list and the
  // lookup killed the entire roll-up. A concurrent suite deleting its fixture
  // account reproduced it; in production a client offboarded mid-tick would do
  // the same. Selecting the brand columns in the same statement removes both
  // the race and one query per account.
  const { data, error } = await db.from("accounts")
    .select(`id, created_at, report_emails, ${ACCOUNT_BRAND_COLS}`);
  if (error) throw new Error(`listAccountsForWeeklyRollup failed: ${error.message}`);

  const rows = (data ?? []) as {
    id: string; created_at: string; report_emails: string[];
    timezone: string; brand_name: string | null; brand_logo_path: string | null;
    brand_color: string | null; brand_neutral: Branding["brandNeutral"];
    brand_corners: Branding["brandCorners"]; brand_type: Branding["brandType"];
    brand_mode: Branding["brandMode"]; reply_to_email: string | null;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const brandingOf = (r: (typeof rows)[number]): Branding => ({
    brandName: r.brand_name ?? null,
    brandLogoPath: r.brand_logo_path ?? null,
    brandColor: r.brand_color ?? null,
    brandNeutral: r.brand_neutral ?? null,
    brandCorners: r.brand_corners ?? null,
    brandType: r.brand_type ?? null,
    brandMode: r.brand_mode ?? null,
    replyToEmail: r.reply_to_email ?? null,
  });

  // Same one-read-for-everyone shape as listAccountsDueWeeklyReport's own
  // site flag above, not one query per account.
  const { data: siteRows, error: siteErr } = await db.from("sites")
    .select("account_id").in("account_id", ids);
  if (siteErr) throw new Error(`listAccountsForWeeklyRollup sites failed: ${siteErr.message}`);
  const withSite = new Set((siteRows ?? []).map((s: { account_id: string }) => s.account_id));

  return rows.map((r) => ({
    accountId: r.id,
    createdAt: r.created_at,
    accountTimezone: r.timezone,
    brandName: brandDisplayName(brandingOf(r)),
    hasSite: withSite.has(r.id),
    hasRecipients: r.report_emails.length > 0,
  }));
}

/**
 * The agency's own row for the roll-up pass — its send address, its gate
 * zone, and the Monday it last sent for.
 *
 * There is exactly ONE `agencies` row in this schema today and no settings
 * screen to edit it through (migration 0031). `reportEmail` is commonly
 * null until danlo's one-off `UPDATE`, and the pass counts that as
 * `skippedNoRecipient` rather than silently sending nothing forever.
 */
export type AgencyReportTarget = {
  agencyId: string;
  reportEmail: string | null;
  timezone: string;
  /** `agencies.weekly_report_week` — the Monday last sent FOR, or null. */
  lastSentWeek: string | null;
};

/**
 * `.maybeSingle()`, not the `.limit(1).single()` every other "the one agency
 * row" lookup in this codebase uses (`createAccount`, `captureBlueprint`):
 * those throw when the row is missing because they cannot proceed without
 * it, but this function's return type promises `| null` — the same
 * "this row might not exist" contract `getVoiceProfile`/`getAccountByOrgId`
 * already use — so the pass can handle absence as its own visible skip
 * rather than the read throwing underneath it.
 */
export async function getAgencyReportTarget(
  db: SupabaseClient,
): Promise<AgencyReportTarget | null> {
  const { data, error } = await db.from("agencies")
    .select("id, report_email, timezone, weekly_report_week")
    .limit(1).maybeSingle();
  if (error) throw new Error(`getAgencyReportTarget failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as {
    id: string; report_email: string | null;
    timezone: string; weekly_report_week: string | null;
  };
  return {
    agencyId: row.id,
    reportEmail: row.report_email,
    timezone: row.timezone,
    lastSentWeek: row.weekly_report_week,
  };
}

/**
 * Records the Monday the agency roll-up was sent FOR — same send-then-stamp
 * contract as `stampWeeklyReportSent` above, just on `agencies.id` instead
 * of an account id.
 */
export async function stampAgencyReportSent(
  db: SupabaseClient, agencyId: string, week: string,
): Promise<void> {
  const { error } = await db.from("agencies")
    .update({ weekly_report_week: week }).eq("id", agencyId);
  if (error) throw new Error(`stampAgencyReportSent failed: ${error.message}`);
}
