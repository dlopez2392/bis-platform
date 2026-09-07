import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * The boundary 0025 draws, pinned in both directions and at the level that
 * can actually see it. Unit tests that mock the db are blind to grants (four
 * shipped defects in this repo); these run real SQL inside a transaction
 * that is rolled back.
 */
describe("0025 automations privileges", () => {
  it("grants authenticated SELECT and nothing else; anon gets nothing", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'automations'
            and grantee in ('authenticated', 'anon')
          order by grantee, privilege_type`,
      );
      expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
    });
  });

  it("never grants a client UPDATE on bookings.review_requested_at (or any bookings column)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'bookings' and privilege_type = 'UPDATE'`,
      );
      expect(rows).toEqual([]);
    });
  });
});

async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_AUTO_A','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_AUTO_B','Bravo',true) returning id", [agency.id]);
  await c.query(
    "insert into automations (account_id, recipe_key) values ($1,'review_request'),($2,'review_request')",
    [a.id, b.id]);
  return { a: a.id as string, b: b.id as string };
}

describe("0025 automations RLS", () => {
  it("a client reads only its own row", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_AUTO_A" });
      const { rows } = await c.query("select account_id from automations");
      expect(rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  // One refused statement per transaction: a refusal ABORTS the transaction,
  // and every statement after it reports 25P02 ("current transaction is
  // aborted") instead of its own reason — which would hide a missing grant.
  it("a client cannot UPDATE, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_AUTO_A" });
      // 42501, not an RLS violation and not a constraint: the grant is
      // checked before either. A misspelled column would be 42703.
      await expect(
        c.query("update automations set enabled = true where account_id = $1", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot INSERT, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_AUTO_A" });
      await expect(
        c.query("insert into automations (account_id, recipe_key) values ($1, 'review_request')", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency reads every row", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from automations where account_id in ($1,$2) order by account_id", [a, b]);
      expect(rows.map((r: any) => r.account_id).sort()).toEqual([a, b].sort());
    }));
});

/**
 * 0026, at the level that can see it. Watched failing BEFORE the migration:
 * the column list comes back empty and the catalogue insert is refused with
 * 23514 (check_violation) — the proof neither test passes by accident.
 */
describe("0026 automations B", () => {
  it("bookings carries the seven B columns: two clocks, two dedupe stamps, three attempt markers", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings'
            and column_name in ('completed_at', 'no_show_at', 'no_show_nudged_at', 'sms_reminder_sent_at',
                                'review_request_sms_failed_at', 'no_show_nudge_sms_failed_at', 'sms_reminder_failed_at')`,
      );
      // Sorted in JS on both sides: Postgres collation orders underscores
      // differently from JS, and the order is not the claim.
      expect(rows.map((r) => r.column_name).sort()).toEqual([
        "completed_at", "no_show_at", "no_show_nudge_sms_failed_at", "no_show_nudged_at",
        "review_request_sms_failed_at", "sms_reminder_failed_at", "sms_reminder_sent_at",
      ].sort());
    });
  });

  it("the recipe catalogue accepts the two B keys", async () => {
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await c.query(
        "insert into automations (account_id, recipe_key) values ($1, 'no_show_nudge'), ($1, 'sms_reminder')", [a]);
      const { rows } = await c.query("select recipe_key from automations where account_id = $1", [a]);
      expect(rows.map((r: any) => r.recipe_key).sort()).toEqual(["no_show_nudge", "review_request", "sms_reminder"]);
    });
  });

  it("the recipe catalogue still refuses an unknown key with check_violation (23514)", async () => {
    // Its own transaction: one refused statement per withRollback (the 25P02 lesson).
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await expect(
        c.query("insert into automations (account_id, recipe_key) values ($1, 'rule_builder')", [a]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
