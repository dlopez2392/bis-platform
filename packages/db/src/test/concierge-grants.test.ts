import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Signatures verified against ./db before writing this file (both match the
 * brief exactly): `withRollback(fn: (c: Client) => Promise<void>)` takes ONE
 * argument and hands the raw `pg` client to `fn`; `actAs(c, claims)` mutates
 * that connection's session in place (`set local role authenticated`) and
 * returns nothing. No deviation needed here.
 */

const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_CC_${label}_${RUN}`;

async function seedAccount(c: Client, org: string): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture CC',true) returning id",
    [agency.id, org],
  );
  return account.id as string;
}

describe("concierge_conversations grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.concierge_conversations')::text as oid`,
      );
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("concierge_conversations");
    }));

  it("grants exactly {postgres, service_role} and nothing to anon or authenticated", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string }>(
        `select distinct grantee from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'concierge_conversations'`,
      );
      const grantees = rows.map((r) => r.grantee).sort();
      expect(grantees).toEqual(["postgres", "service_role"]);
    }));

  it("has RLS on with zero policies (deny-all for anything but service_role)", () =>
    withRollback(async (c) => {
      const { rows: [rls] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = 'public.concierge_conversations'::regclass`,
      );
      expect(rls!.relrowsecurity).toBe(true);
      const { rows: policies } = await c.query(
        `select 1 from pg_policies where schemaname='public' and tablename='concierge_conversations'`,
      );
      expect(policies).toHaveLength(0);
    }));

  // ⚠️ `actAs(c, { app_role: "agency_admin" })`, NEVER `actAsOwner` — that
  // one does `reset role`, making the connection the TABLE OWNER, which
  // bypasses grants entirely and passes for a reason unrelated to the
  // property under test. screened-calls-grants.test.ts makes the same point
  // in its own comment.
  //
  // And the assertion is on 42501 specifically, not "an error": 42P01
  // (relation does not exist) and a schema-cache miss both look identical to
  // a passing deny, which is how a grants test goes green against a table
  // that was never created.
  for (const role of ["authenticated", "agency_admin"] as const) {
    it(`a ${role} session cannot select (privilege error 42501, not merely an error)`, () =>
      withRollback(async (c) => {
        const org = orgId(role);
        await seedAccount(c, org);
        await actAs(c, role === "agency_admin"
          ? { org_id: org, app_role: "agency_admin" }
          : { org_id: org });
        await expect(
          c.query("select id from public.concierge_conversations limit 1"),
        ).rejects.toMatchObject({ code: "42501" });
      }));

    it(`a ${role} session cannot insert (privilege error 42501)`, () =>
      withRollback(async (c) => {
        const org = orgId(`${role}_ins`);
        const accountId = await seedAccount(c, org);
        await actAs(c, role === "agency_admin"
          ? { org_id: org, app_role: "agency_admin" }
          : { org_id: org });
        await expect(
          c.query(
            `insert into public.concierge_conversations (account_id, form_id, ip_hash)
             values ($1, gen_random_uuid(), 'x')`,
            [accountId],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      }));
  }

  // SECOND REVIEW, IMPORTANT 2: this used to check ONLY `concierge_claim_turn`.
  // `concierge_append_turns` and `concierge_enable` shipped in 0044/0045 --
  // one of them writes `voice_profiles` -- with no grants assertion anywhere.
  // That matters because DROP FUNCTION + CREATE resets a function's ACL to
  // this project's defaults, which grant EXECUTE to `anon` and
  // `authenticated` BY NAME -- this feature already shipped exactly that
  // defect once (0043_concierge_function_grants.sql exists because
  // `revoke ... from public` does not revoke a named-role grant).
  //
  // A single loop, not `it.each`, and the routine names are collected into
  // `results` as the loop runs rather than asserted one at a time -- so an
  // EMPTY or MISTYPED list (a typo'd name, or the same name twice) cannot
  // pass vacuously: `Object.keys(results)` is asserted against the exact
  // three-name set BEFORE any grantee is checked, which fails on its own if
  // the loop never reached all three, and a mistyped/nonexistent routine
  // name still fails the grantee check below (querying a name nothing owns
  // returns zero rows, not `["postgres","service_role"]`).
  it("concierge_claim_turn, concierge_append_turns, and concierge_enable are each locked to postgres/service_role only", () =>
    withRollback(async (c) => {
      const routineNames = ["concierge_claim_turn", "concierge_append_turns", "concierge_enable"];
      const results: Record<string, string[]> = {};
      for (const name of routineNames) {
        const { rows } = await c.query<{ grantee: string }>(
          `select distinct grantee from information_schema.role_routine_grants
            where routine_schema = 'public' and routine_name = $1`,
          [name],
        );
        results[name] = rows.map((r) => r.grantee).sort();
      }
      expect(Object.keys(results).sort()).toEqual(
        ["concierge_append_turns", "concierge_claim_turn", "concierge_enable"],
      );
      expect(results).toEqual({
        concierge_claim_turn: ["postgres", "service_role"],
        concierge_append_turns: ["postgres", "service_role"],
        concierge_enable: ["postgres", "service_role"],
      });
    }));

  it("the three voice_profiles columns exist with the intended nullability", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns
          where table_schema='public' and table_name='voice_profiles'
            and column_name in ('public_id','concierge_enabled','concierge_form_id')
          order by column_name`,
      );
      expect(rows).toEqual([
        { column_name: "concierge_enabled", is_nullable: "NO" },
        { column_name: "concierge_form_id", is_nullable: "YES" },
        { column_name: "public_id", is_nullable: "YES" },
      ]);
    }));
});
