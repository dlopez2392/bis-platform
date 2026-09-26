import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";

// Per-process suffix: clerk_org_id is unique on the ONE project every CI run
// shares (call-proposals-grants.test.ts:6-20).
const RUN = Math.random().toString(36).slice(2, 10);
const org = (label: string) => `org_RE_${label}_${RUN}`;
const sub = (label: string) => `user_RE_${label}_${RUN}`;

async function seedAccount(c: Client, label: string, clientAccess = true): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture RE',$3) returning id",
    [agency.id, org(label), clientAccess]);
  return a.id as string;
}

/** Runs one statement inside a savepoint; returns the error, or null if it succeeded. */
async function refused(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e as { code?: string; message: string };
  }
  await c.query("release savepoint probe");
  return null;
}

describe("0053 record_event: the shape", () => {
  it("takes exactly (uuid, text, jsonb), is SECURITY DEFINER with an empty search_path (mutation: add a p_actor_id parameter -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as secdef, p.proconfig as cfg
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'record_event'`);
      expect(rows).toEqual([{
        args: "p_account_id uuid, p_type text, p_payload jsonb", secdef: true, cfg: ["search_path=\"\""],
      }]);
    }));

  it("only authenticated may execute it among the API roles (mutation: drop the revoke from anon -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r as role, has_function_privilege(r, 'public.record_event(uuid, text, jsonb)', 'EXECUTE') as x
           from unnest(array['anon','authenticated','service_role']) r order by r`);
      expect(rows).toEqual([
        { role: "anon", x: false }, { role: "authenticated", x: true }, { role: "service_role", x: false },
      ]);
      const { rows: grantees } = await c.query(
        `select distinct grantee from information_schema.role_routine_grants
          where routine_schema = 'public' and routine_name = 'record_event' order by grantee`);
      expect(grantees.map((g: { grantee: string }) => g.grantee)).toEqual(["authenticated", "postgres"]);
    }));
});

describe("0053 record_event: who acted comes from the JWT", () => {
  it("a member appends to its own account, stamped user + the token's sub, at transaction time (mutation: stamp 'system' -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "OWN");
      await actAs(c, { org_id: org("OWN"), sub: sub("OWN") });
      await c.query("select public.record_event($1, 'contact.created', '{\"k\":1}'::jsonb)", [a]);
      await actAsOwner(c);
      const { rows } = await c.query(
        "select type, actor_type, actor_id, payload, created_at = now() as at_now from events where account_id = $1", [a]);
      expect(rows).toEqual([{ type: "contact.created", actor_type: "user", actor_id: sub("OWN"), payload: { k: 1 }, at_now: true }]);
    }));

  it("the agency appends to any account, still stamped with its own sub", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "AGY");
      await actAs(c, { app_role: "agency_admin", sub: sub("AGY") });
      await c.query("select public.record_event($1, 'account.renamed', '{}'::jsonb)", [a]);
      await actAsOwner(c);
      const { rows } = await c.query("select actor_type, actor_id from events where account_id = $1", [a]);
      expect(rows).toEqual([{ actor_type: "user", actor_id: sub("AGY") }]);
    }));

  // The claims below carry NO app_role, exactly as a client user's Clerk token
  // does not (the session-token template in docs/runbooks/clerk-setup.md,
  // Part A, renders it from public_metadata, which only agency users have).
  // That makes app.is_agency() NULL rather than false, which is the case the
  // function's coalesce exists for (mutation: drop the coalesce -> the next
  // two tests FAIL; proved on a local replica).
  const notMember = { code: "42501", message: expect.stringMatching(/record_event: not a member of this account/) };
  const noUser = { code: "42501", message: expect.stringMatching(/record_event: no user on this request/) };

  it("refuses another account's id, and writes nothing there (mutation: drop the tenancy check, or its coalesce -> FAILS)", () =>
    withRollback(async (c) => {
      await seedAccount(c, "MINE");
      const other = await seedAccount(c, "THEIRS");
      await actAs(c, { org_id: org("MINE"), sub: sub("MINE") });
      expect(await refused(c, "select public.record_event($1, 'x.y', '{}'::jsonb)", [other]))
        .toMatchObject(notMember);
      await actAsOwner(c);
      const { rows } = await c.query("select count(*)::int as n from events where account_id = $1", [other]);
      expect(rows[0].n).toBe(0);
    }));

  it("refuses a member whose company's client access is off (current_account_id resolves nothing)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "OFF", false);
      await actAs(c, { org_id: org("OFF"), sub: sub("OFF") });
      expect(await refused(c, "select public.record_event($1, 'x.y', '{}'::jsonb)", [a])).toMatchObject(notMember);
    }));

  it("refuses a token with no sub, and one with a blank sub (mutation: drop the sub check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "NOSUB");
      await actAs(c, { org_id: org("NOSUB") });
      expect(await refused(c, "select public.record_event($1, 'x.y', '{}'::jsonb)", [a])).toMatchObject(noUser);
      await actAs(c, { org_id: org("NOSUB"), sub: "" });
      expect(await refused(c, "select public.record_event($1, 'x.y', '{}'::jsonb)", [a])).toMatchObject(noUser);
    }));

  it("type must be 1 to 100 characters: '' and 101 refused 22023, 100 accepted (mutation: drop the length check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "LEN");
      await actAs(c, { org_id: org("LEN"), sub: sub("LEN") });
      expect(await refused(c, "select public.record_event($1, '', '{}'::jsonb)", [a])).toMatchObject({ code: "22023" });
      expect(await refused(c, "select public.record_event($1, $2, '{}'::jsonb)", [a, "t".repeat(101)])).toMatchObject({ code: "22023" });
      expect(await refused(c, "select public.record_event($1, $2, '{}'::jsonb)", [a, "t".repeat(100)])).toBeNull();
    }));

  it("the table itself refuses the member's direct INSERT, by privilege (mutation: grant insert back -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "DIRECT");
      await actAs(c, { org_id: org("DIRECT"), sub: sub("DIRECT") });
      expect(await refused(c,
        "insert into events (account_id, type, actor_type, actor_id) values ($1,'x.y','user',$2)", [a, sub("DIRECT")]))
        .toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table events/) });
    }));
});
