import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccountBrandInfo } from "./booking";
import { brandDisplayName, type Branding } from "./branding";

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
