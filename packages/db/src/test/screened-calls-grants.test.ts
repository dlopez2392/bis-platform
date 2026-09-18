import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * 0039_screened_calls.sql — the proof that only the server touches this table.
 *
 * The design's audience decision ("agency-only") is enforced by GRANTS rather
 * than by a row policy, which is the stronger of the two: with no grant to
 * `authenticated`, a client gets permission denied instead of zero rows, and
 * no future query that forgets a filter can leak anything.
 */
describe("screened_calls grants", () => {
  it("a client cannot read the table at all — permission denied, not zero rows (mutation: grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("an AGENCY user cannot read it through the user client either (mutation: add an is_agency policy plus a select grant to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      // `app.is_agency()` is `app_role = 'agency_admin'` (0001), so this is
      // what an agency session actually looks like. NOT `actAsOwner`, which
      // does `reset role` — the table owner bypasses grants entirely and
      // would read the table happily, passing this test for a reason that has
      // nothing to do with the property being asserted.
      //
      // Deliberate and worth pinning: the agency reads this table through
      // serviceDb() behind requireAgency(), never through the user client. If
      // that ever changes, this is where the decision gets revisited rather
      // than silently widened.
      await actAs(c, { app_role: "agency_admin" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot insert either (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','repeat-spam')",
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("refuses a reason outside the six (mutation: drop screened_calls_reason_check -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','made-up')",
        ),
      ).rejects.toThrow(/screened_calls_reason_check/);
    }));

  it("accepts a row with NO account and NO phone number — the wrong-number case (mutation: make account_id NOT NULL -> FAILS)", () =>
    withRollback(async (c) => {
      // The case `calls` structurally cannot hold, and the reason this table
      // exists in its own right rather than as a view over calls.
      const { rows } = await c.query(
        "insert into public.screened_calls (called_e164, caller_e164, reason) values ('+19565550100','+19565550111','unknown-number') returning id, account_id, phone_number_id",
      );
      expect(rows[0].account_id).toBeNull();
      expect(rows[0].phone_number_id).toBeNull();
    }));

  it("cascades the account but only nulls the number — 'c' vs 'n' by design (mutation: swap the two FKs' delete actions -> FAILS)", () =>
    withRollback(async (c) => {
      // An account that is deleted has no screening history worth keeping
      // (cascade). A NUMBER outlives its assignment — it gets reassigned to
      // another client and the refusal still happened on that line, so
      // nulling the reference is right where cascading would erase real
      // history.
      const { rows } = await c.query<{ conname: string; confdeltype: string }>(
        `select conname, confdeltype from pg_constraint
          where conrelid = 'public.screened_calls'::regclass and contype = 'f'
          order by conname`,
      );
      const by = Object.fromEntries(rows.map((r) => [r.conname, r.confdeltype]));
      expect(by["screened_calls_account_id_fkey"]).toBe("c");
      expect(by["screened_calls_phone_number_id_fkey"]).toBe("n");
    }));

  it("service_role holds select/insert/delete and no client role is granted anything (mutation: revoke insert from service_role, or grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'screened_calls'
          order by grantee, privilege_type`,
      );
      // The table owner (`postgres`) always carries every privilege and the
      // migration never touches that. The claim worth pinning is about the
      // other two roles: no anon/authenticated grant survived
      // `revoke all ... from anon, authenticated`, and service_role has at
      // least what the migration's own `grant select, insert, delete` names.
      const grantees = [...new Set(rows.map((r) => r.grantee))].sort();
      expect(grantees).toEqual(["postgres", "service_role"]);

      const serviceRolePrivileges = rows
        .filter((r) => r.grantee === "service_role")
        .map((r) => r.privilege_type);
      // A superset assertion, not an exact one — the same shape as
      // alert-phone-verification-grants.test.ts:193-206, for the same
      // reason. Measured live against tlbkbmlrfafquucsmsmm before writing
      // this test: this project's default ACL already hands every new
      // table's creator TRIGGER/REFERENCES/TRUNCATE/UPDATE alongside
      // SELECT/INSERT/DELETE, and 0039 never revokes from service_role — it
      // only adds `grant select, insert, delete` on top of that default. So
      // service_role's live privilege set here is actually all seven, and
      // pinning it to exactly three would be pinning Supabase's default ACL
      // rather than this migration's own intent. What the migration DOES
      // decide, and what this line actually catches, is that service_role
      // keeps at least the three privileges the read/write/delete flow
      // needs.
      expect(serviceRolePrivileges).toEqual(
        expect.arrayContaining(["SELECT", "INSERT", "DELETE"]),
      );
    }));
});
