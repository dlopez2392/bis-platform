import { describe, it, expect } from "vitest";
import { withRollback } from "./db";

/**
 * 0031 adds five columns and NO grants, which is the part worth pinning.
 *
 * `public.accounts` is edited per-column by clients — 0013 revoked UPDATE
 * wholesale and 0014 re-granted it one column at a time — so "we added a
 * column to accounts" is exactly the moment someone reaches for a grant out of
 * habit. Neither new column needs one: `report_emails` is written by an
 * agency-only server action through `serviceDb()`, and `weekly_report_week` is
 * written only by the cron's service client. A client that could write the
 * stamp could suppress its own report; a client that could write the
 * recipients could redirect the report to any address through PostgREST.
 *
 * The UPDATE list is asserted EXACTLY, in both directions, so this fails
 * whether 0031 granted something it should not have or a later migration does.
 */
const ACCOUNTS_UPDATE_COLUMNS = [
  "brand_color",
  "brand_corners",
  "brand_logo_path",
  "brand_mode",
  "brand_name",
  "brand_neutral",
  "brand_type",
  "reply_to_email",
].sort();

describe("0031 weekly report columns", () => {
  it("adds the two account columns, with report_emails defaulting to empty", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; data_type: string; column_default: string | null }>(
        `select column_name, data_type, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts'
            and column_name in ('report_emails', 'weekly_report_week')
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(["report_emails", "weekly_report_week"]);

      const reportEmails = rows.find((r) => r.column_name === "report_emails")!;
      expect(reportEmails.data_type).toBe("ARRAY");
      // An empty default, not NULL: "no recipients" must be a value the due
      // query can filter on rather than a null it has to special-case.
      expect(reportEmails.column_default).toContain("{}");
    });
  });

  it("adds the three agency columns, with a zone the roll-up can gate on", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable
           from information_schema.columns
          where table_schema = 'public' and table_name = 'agencies'
            and column_name in ('report_email', 'timezone', 'weekly_report_week')
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name))
        .toEqual(["report_email", "timezone", "weekly_report_week"]);

      // report_email is nullable ON PURPOSE — the pass counts skippedNoRecipient
      // when it is unset, which is how an unconfigured address stays visible.
      expect(rows.find((r) => r.column_name === "report_email")!.is_nullable).toBe("YES");
      expect(rows.find((r) => r.column_name === "timezone")!.is_nullable).toBe("NO");
    });
  });

  it("grants authenticated no UPDATE on either new accounts column", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'accounts' and privilege_type = 'UPDATE'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(ACCOUNTS_UPDATE_COLUMNS);
    });
  });

  /**
   * The agency row is protected DIFFERENTLY from `accounts`, and the new
   * columns inherit that difference, so it is pinned rather than assumed.
   *
   * Two wrong assertions preceded this one, both worth recording. "No
   * privileges at all" failed because `information_schema.column_privileges`
   * EXPANDS a table-level grant across every column — a misreading already
   * recorded in this project. "No UPDATE" then failed too: `agencies` carries a
   * FULL table-level grant set for `authenticated`, UPDATE included.
   *
   * So nothing at the grant layer stops a client writing `report_email` or
   * `weekly_report_week`. What stops them is RLS: the `agencies_agency_all`
   * policy, with row security enabled. That is the actual control, so that is
   * what this asserts — and if anyone ever disables RLS on this table, these
   * new columns become writable by any authenticated user and this test says so.
   */
  it("protects the agency row by RLS, which is what the new columns rely on", async () => {
    await withRollback(async (c) => {
      const { rows: sec } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.agencies'::regclass`,
      );
      expect(sec[0]?.relrowsecurity).toBe(true);

      const { rows: pol } = await c.query<{ policyname: string }>(
        `select policyname from pg_policies
          where schemaname = 'public' and tablename = 'agencies'`,
      );
      expect(pol.map((r) => r.policyname)).toContain("agencies_agency_all");
    });
  });
});
