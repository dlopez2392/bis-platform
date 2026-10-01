import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * 0057 ops_heartbeats + record_heartbeat: service_role only (spec
 * docs/superpowers/specs/2026-10-01-operational-floor-design.md section 1 and
 * section 5 "Grants"). withRollback only; nothing here commits.
 *
 * RED BEFORE APPLY: every test here. has_table_privilege / has_function_privilege
 * on an object that does not exist raise (42P01 / 42883), and each refusal case
 * expects 42501 with the GRANT's message, not 42P01.
 *
 * schema-grants-guard.test.ts already fails if anon or authenticated gains any
 * WRITE on this table; it does not look at SELECT, column grants, EXECUTE or
 * service_role, which is what this file pins.
 */
const TABLE = "public.ops_heartbeats";
const FN = "public.record_heartbeat(text, boolean, text)";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;

describe("0057 ops_heartbeats: grants", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a
  // grant to PUBLIC as every role's own and sees PG17's MAINTAIN (0051's note).
  it("the whole table privilege matrix: service_role holds SELECT, INSERT, UPDATE and nothing else; anon, authenticated and PUBLIC hold nothing (mutation: grant select on it to authenticated → FAILS; drop service_role from the revoke → service_role keeps DELETE/TRUNCATE/MAINTAIN, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" },
        { r: "service_role", p: "UPDATE" },
      ]);
    }));

  it("no column-level grant either: anon and authenticated hold no column privilege of any kind (mutation: grant select (key) on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(rows).toEqual([]);
    }));

  it("row level security is on with NO policy at all (mutation: drop `enable row level security` → FAILS; add any policy → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(
        `select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("record_heartbeat: EXECUTE is service_role's alone — not anon, not authenticated, not PUBLIC (mutation: drop `revoke all … from public, anon, authenticated` → authenticated keeps EXECUTE by name, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; x: boolean }>(
        `select r, has_function_privilege(r, '${FN}', 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by r`);
      expect(rows).toEqual([
        { r: "anon", x: false }, { r: "authenticated", x: false },
        { r: "public", x: false }, { r: "service_role", x: true },
      ]);
    }));

  it("record_heartbeat runs as its CALLER with an empty search_path (0055's shape; mutation: security definer → prosecdef true, FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] | null }>(
        `select prosecdef, proconfig from pg_proc where oid = '${FN}'::regprocedure`);
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
    }));
});

// ONE refused statement per withRollback: after the first, the transaction is
// aborted (25P02) and would hide the reason of any later one. Code AND
// message: an RLS refusal is ALSO 42501, so the message proves it is the
// GRANT that refuses.
describe("0057 ops_heartbeats: refused, as each role would meet it", () => {
  it("the agency's own session cannot read it: 42501 permission denied for table (mutation: grant select on it to authenticated → FAILS, zero rows instead)", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin", sub: "user_ops_test" });
      await expect(c.query("select key from public.ops_heartbeats"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table ops_heartbeats" });
    }));

  it("a client session cannot call record_heartbeat: 42501 permission denied for function (mutation: grant execute to authenticated → FAILS on the message: the invoker's insert is then refused by the TABLE grant, 'permission denied for table ops_heartbeats')", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_ops_test_client", sub: "user_ops_test" });
      await expect(c.query("select public.record_heartbeat('cron.tick', true, null)"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function record_heartbeat" });
    }));

  it("anon cannot read it: 42501 permission denied for table (mutation: drop anon from the revoke → FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role anon");
      await expect(c.query("select key from public.ops_heartbeats"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table ops_heartbeats" });
    }));

  it("anon cannot call record_heartbeat: 42501 permission denied for function", () =>
    withRollback(async (c) => {
      await c.query("set local role anon");
      await expect(c.query("select public.record_heartbeat('cron.tick', true, null)"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for function record_heartbeat" });
    }));

  it("service_role cannot DELETE a heartbeat — a retired key is the owner's to remove (mutation: grant delete to service_role → the delete succeeds, FAILS)", () =>
    withRollback(async (c) => {
      await c.query("set local role service_role");
      await expect(c.query("delete from public.ops_heartbeats where key = 'cron.tick'"))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table ops_heartbeats" });
    }));
});
