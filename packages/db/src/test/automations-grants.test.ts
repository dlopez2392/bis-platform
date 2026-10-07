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

/**
 * 0027, at the level that can see it. Watched failing BEFORE the migration:
 * the column read comes back empty and the catalogue insert is refused with
 * 23514 — the proof neither passes by accident.
 *
 * form_submissions is server-written (0053): the service role writes it (the
 * public form, intake, the concierge, and the instant-reply stamp), and
 * `authenticated` holds SELECT and nothing else, under ONE SELECT-only
 * policy. These tests pin THAT standing, so a later grant or a new policy
 * shows up here, not in production. Mutation: change the expected grant list
 * and watch it fail.
 */
describe("0027 instant reply", () => {
  it("form_submissions carries the stamp column", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'form_submissions'
            and column_name = 'instant_reply_sent_at'`,
      );
      expect(rows).toEqual([{ column_name: "instant_reply_sent_at", data_type: "timestamp with time zone" }]);
    });
  });

  it("the recipe catalogue accepts instant_reply", async () => {
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await c.query("insert into automations (account_id, recipe_key) values ($1, 'instant_reply')", [a]);
      const { rows } = await c.query(
        "select recipe_key from automations where account_id = $1 order by recipe_key", [a]);
      expect(rows.map((r: any) => r.recipe_key)).toEqual(["instant_reply", "review_request"]);
    });
  });

  it("the client role's standing on form_submissions: SELECT only, one SELECT policy", async () => {
    await withRollback(async (c) => {
      const { rows: grants } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'form_submissions' and grantee = 'authenticated'
          order by privilege_type`,
      );
      expect(grants.map((g) => g.privilege_type)).toEqual(["SELECT"]);
      const { rows: rls } = await c.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = 'public.form_submissions'::regclass");
      expect(rls).toEqual([{ relrowsecurity: true }]);
      const { rows: policies } = await c.query<{ policyname: string; cmd: string }>(
        "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'form_submissions'");
      expect(policies).toEqual([{ policyname: "form_submissions_member_read", cmd: "SELECT" }]);
    });
  });

  // The instant-reply stamp is the service role's to write (0053). The client
  // role's UPDATE is refused at the GRANT, before RLS is consulted, even on
  // its own account's row: 42501 AND the privilege message, because an RLS
  // refusal is 42501 too. One refused statement per transaction (above); the
  // other tables and the agency case are in server-only-writes-grants.test.ts.
  it("a client cannot stamp even its own account's submission", async () => {
    await withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      const { subA } = await seedOneSubmissionEach(c, a, b);
      await actAs(c, { org_id: "org_AUTO_A" });
      await expect(
        c.query("update form_submissions set instant_reply_sent_at = now() where id = $1", [subA]),
      ).rejects.toMatchObject({
        code: "42501",
        message: expect.stringMatching(/permission denied for table form_submissions/),
      });
    });
  });
});

async function seedOneSubmissionEach(c: any, a: string, b: string) {
  const { rows: [fa] } = await c.query(
    "insert into forms (account_id, public_id, name) values ($1, 'pub_AUTO_A', 'Quote') returning id", [a]);
  const { rows: [fb] } = await c.query(
    "insert into forms (account_id, public_id, name) values ($1, 'pub_AUTO_B', 'Quote') returning id", [b]);
  const { rows: [sa] } = await c.query(
    "insert into form_submissions (account_id, form_id) values ($1, $2) returning id", [a, fa.id]);
  const { rows: [sb] } = await c.query(
    "insert into form_submissions (account_id, form_id) values ($1, $2) returning id", [b, fb.id]);
  return { subA: sa.id as string, subB: sb.id as string };
}
