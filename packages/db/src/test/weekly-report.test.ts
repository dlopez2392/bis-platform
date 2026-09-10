import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listAccountsDueWeeklyReport, stampWeeklyReportSent } from "../weekly-report";

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
