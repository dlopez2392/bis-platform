import "dotenv/config";
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  listAccountsDueWeeklyReport, stampWeeklyReportSent,
  listAccountsForWeeklyRollup, getAgencyReportTarget, stampAgencyReportSent,
} from "../weekly-report";

/**
 * The due query's whole job is to hand the pass rows it can act on without a
 * second lookup, and to leave out the accounts that are not due at all.
 *
 * `brandName` is set explicitly rather than relied upon: `brandDisplayName`
 * returns "" for an account with no brand name, so asserting truthiness on a
 * bare fixture would fail for a reason that has nothing to do with this query.
 */
describe("listAccountsDueWeeklyReport", () => {
  it("does not return an account with no recipients — it is not due at all", async () => {
    await withTestAccount(async (db, accountId) => {
      const rows = await listAccountsDueWeeklyReport(db);
      expect(rows.some((r) => r.accountId === accountId)).toBe(false);
    });
  });

  it("returns an account with recipients, carrying its zone, brand name and site flag", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("accounts")
        .update({ report_emails: ["owner@example.com", "book@example.com"], brand_name: "Rio Roofing" })
        .eq("id", accountId);
      if (error) throw new Error(error.message);

      const row = (await listAccountsDueWeeklyReport(db)).find((r) => r.accountId === accountId);
      expect(row).toBeDefined();
      expect(row!.reportEmails).toEqual(["owner@example.com", "book@example.com"]);
      expect(row!.accountTimezone).toBeTruthy();
      // NEVER accounts.name — the internal label ("Fixture Co" here).
      expect(row!.brandName).toBe("Rio Roofing");
      expect(row!.lastSentWeek).toBeNull();
      // No site linked, so the report must omit the website line rather than
      // render a zero that reads as "your website is dead".
      expect(row!.hasSite).toBe(false);
      expect(row!.createdAt).toBeTruthy();
    });
  });

  it("stamps the week, and the next read reports it", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("accounts")
        .update({ report_emails: ["a@b.co"], brand_name: "Valley Air" }).eq("id", accountId);
      if (error) throw new Error(error.message);

      await stampWeeklyReportSent(db, accountId, "2026-03-02");

      const row = (await listAccountsDueWeeklyReport(db)).find((r) => r.accountId === accountId);
      expect(row!.lastSentWeek).toBe("2026-03-02");
    });
  });
});

/**
 * The roll-up's own read, deliberately separate from `listAccountsDueWeeklyReport`
 * above: that query filters to accounts WITH a recipient because it exists to
 * drive sends, and correctly hides an account with none. The roll-up's job is
 * the opposite of that — a client silently receiving nothing must be visible
 * to the agency — so it cannot reuse a read that was built to hide exactly
 * that case.
 */
describe("listAccountsForWeeklyRollup", () => {
  it("the roll-up read includes an account with no recipients", async () => {
    await withTestAccount(async (db, accountId) => {
      const row = (await listAccountsForWeeklyRollup(db)).find((r) => r.accountId === accountId);
      expect(row).toBeDefined();
      expect(row!.hasRecipients).toBe(false);
    });
  });
});

/**
 * `agencies` carries exactly ONE row and it is shared with production (spec
 * 2026-09-10-weekly-report-design, "agencies.report_email is nullable and
 * has no editing screen"). There is no `withTestAccount`-style fixture for a
 * second, throwaway agency, and there cannot be one through this read path:
 * `getAgencyReportTarget`/`stampAgencyReportSent` take a `SupabaseClient`
 * (PostgREST), while `withRollback` (rls.test.ts) opens a SEPARATE raw `pg`
 * connection whose uncommitted transaction is invisible to a PostgREST
 * request on a different connection — the two cannot be combined here.
 *
 * So this test reads the real row FIRST and restores it in `finally`
 * regardless of outcome, exactly the "pre-flight read, then write, then
 * put it back" shape `withTestAccount`'s own teardown uses for an account.
 */
describe("getAgencyReportTarget / stampAgencyReportSent", () => {
  it("getAgencyReportTarget returns the agency row with its zone and stamp", async () => {
    const db = serviceDb();
    const { data: before, error: beforeErr } = await db.from("agencies")
      .select("id, report_email, timezone, weekly_report_week").limit(1).single();
    if (beforeErr || !before) throw new Error(`pre-flight agency read failed: ${beforeErr?.message}`);

    try {
      // `report_email` is deliberately NOT written, even though the finally
      // below would restore it. A killed run — this project has had them, and
      // they are why stray fixture accounts recur — would leave a fake address
      // on the one real agency row, and the pass only counts
      // `skippedNoRecipient` for NULL. A leftover address is not a loud
      // failure: it is the roll-up silently going nowhere every Monday, which
      // is the exact failure this whole design was built to avoid. The
      // column's mapping is asserted as a pass-through of whatever is really
      // there, which proves the same thing about the read.
      const { error } = await db.from("agencies")
        .update({ timezone: "America/Denver", weekly_report_week: "2026-02-16" })
        .eq("id", before.id);
      if (error) throw new Error(error.message);

      expect(await getAgencyReportTarget(db)).toEqual({
        agencyId: before.id,
        reportEmail: before.report_email,
        timezone: "America/Denver",
        lastSentWeek: "2026-02-16",
      });

      // stampAgencyReportSent is the "stamp" half of this test's own name —
      // exercised here, rather than as a second test, the same way the
      // sibling suite above folds its stamp check into one flow.
      await stampAgencyReportSent(db, before.id, "2026-02-23");
      expect((await getAgencyReportTarget(db))?.lastSentWeek).toBe("2026-02-23");
    } finally {
      const { error: restoreErr } = await db.from("agencies")
        .update({
          report_email: before.report_email,
          timezone: before.timezone,
          weekly_report_week: before.weekly_report_week,
        })
        .eq("id", before.id);
      if (restoreErr) throw new Error(`agency row restore failed: ${restoreErr.message}`);
    }
  });
});
