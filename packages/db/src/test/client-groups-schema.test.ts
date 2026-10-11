import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * Client groups (spec §5.1-§5.3). As the table owner inside a rolled-back
 * transaction: constraints, cascades, grants, policies and the company_name
 * sync. A refused statement under a check or FK raises; we assert the code.
 */
const RUN = Math.random().toString(36).slice(2, 10);

// Local to this file on purpose: importing one test file from another would register its tests twice.
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Groups Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string, company: string | null = null) =>
  (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, company_name) values ($1,$2,$3) returning id", [acct, first, company])).rows[0]!.id;
const group = async (c: Client, acct: string, kind: string, name: string) =>
  (await c.query<{ id: string }>(
    "insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name])).rows[0]!.id;
const member = async (c: Client, acct: string, g: string, ct: string, primary = false) =>
  (await c.query<{ id: string }>(
    "insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,$4) returning id",
    [acct, g, ct, primary])).rows[0]!.id;
const companyOf = async (c: Client, ct: string) =>
  (await c.query<{ company_name: string | null }>("select company_name from contacts where id = $1", [ct])).rows[0]!.company_name;

/**
 * One statement expected to fail, inside a savepoint so the transaction
 * survives for the next one: a refused statement aborts a Postgres
 * transaction, and every later statement would report 25P02 instead of its
 * own code. Returns the error, or null when nothing was refused.
 */
async function refused(c: Client, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await run();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

describe("client_groups and client_group_members: constraints", () => {
  it("refuses a membership pointing at another account's contact (mutation: make the contact FK single-column -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_a_${RUN}`);
      const b = await seedAccount(c, `org_g_b_${RUN}`);
      const g = await group(c, a, "household", "Garcia");
      const theirs = await contact(c, b, "Bea");
      expect(await refused(c, () => member(c, a, g, theirs))).toMatchObject({ code: "23503" });
    }));
  it("refuses the same person twice in one group, and a second main group", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    const ct = await contact(c, a, "Ana");
    const g1 = await group(c, a, "household", "Garcia");
    const g2 = await group(c, a, "household", "Reyes");
    await member(c, a, g1, ct, true);
    expect(await refused(c, () => member(c, a, g1, ct))).toMatchObject({ code: "23505" });
    expect(await refused(c, () => member(c, a, g2, ct, true))).toMatchObject({ code: "23505" });
  }));
  it("refuses a blank or whitespace-only name, an untrimmed name and a third kind", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    for (const bad of ["", "   ", "\t", "\u00a0"]) {
      expect(await refused(c, () => group(c, a, "household", bad)), JSON.stringify(bad)).toMatchObject({ code: "23514" });
    }
    expect(await refused(c, () => group(c, a, "household", " Garcia"))).toMatchObject({ code: "23514" });
    expect(await refused(c, () => group(c, a, "facility", "Sunny Days"))).toMatchObject({ code: "23514" });
  }));
  it("one business per key per account; households may share a name (mutation: drop client_groups_business_key -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      await group(c, a, "business", "Acme Roofing");
      expect(await refused(c, () => group(c, a, "business", "ACME ROOFING"))).toMatchObject({ code: "23505" });
      await group(c, a, "household", "Garcia");
      await group(c, a, "household", "Garcia");
      const b = await seedAccount(c, `org_g_b_${RUN}`);
      await group(c, b, "business", "Acme Roofing");
    }));
  it("name_key lowercases and trims the explicit whitespace class (mutation: drop lower() from app.group_name_key -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        "select app.group_name_key(x) as k from unnest($1::text[]) as x",
        [["Acme Roofing", " acme roofing ", "ACME ROOFING\t", " Acme Roofing\n", "\u00a0Acme Roofing\r\f\v"]]);
      expect(new Set(rows.map((r) => r.k))).toEqual(new Set(["acme roofing"]));
    }));
});

describe("cascades (spec §5.1)", () => {
  it("a deleted contact takes its memberships; a deleted group takes its memberships; a deleted account takes its groups", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      const ct = await contact(c, a, "Ana");
      const g = await group(c, a, "household", "Garcia");
      const m1 = await member(c, a, g, ct, true);
      await c.query("delete from contacts where id = $1", [ct]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m1])).rowCount).toBe(0);
      const ct2 = await contact(c, a, "Luis");
      const m2 = await member(c, a, g, ct2, true);
      await c.query("delete from client_groups where id = $1", [g]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m2])).rowCount).toBe(0);
      const g2 = await group(c, a, "household", "Reyes");
      await c.query("delete from contacts where account_id = $1", [a]);
      await c.query("delete from accounts where id = $1", [a]);
      expect((await c.query("select 1 from client_groups where id = $1", [g2])).rowCount).toBe(0);
    }));
  it("an Owner can still delete a customer who belongs to groups: the cascade runs under the client role (mutation: client_group_members_contact_fkey on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const org = `org_g_del_${RUN}`;
      const a = await seedAccount(c, org);
      const ct = await contact(c, a, "Ana");
      const other = await contact(c, a, "Luis");
      const acme = await group(c, a, "business", "Acme Roofing");
      const mine = await member(c, a, acme, ct, true);
      await member(c, a, acme, other, true);
      await actAsMember(c, a, org, "owner");
      expect((await c.query("delete from contacts where id = $1", [ct])).rowCount).toBe(1);
      await actAsOwner(c);
      expect((await c.query("select 1 from client_group_members where id = $1", [mine])).rowCount).toBe(0);
      expect(await companyOf(c, other)).toBe("Acme Roofing"); // the co-member is untouched
    }));
});

describe("grants and policies (spec §5.2)", () => {
  it("the client role can read but never write either table (mutation: drop the revoke of insert from authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      await group(c, a, "household", "Garcia");
      await actAs(c, { app_role: "agency_admin", sub: `user_g_agency_${RUN}` });
      expect((await c.query("select 1 from client_groups where account_id = $1", [a])).rowCount).toBe(1); // positive control
      // The message, not only the code: with INSERT granted back, RLS (no insert policy) still refuses with
      // 42501 ("new row violates row-level security policy"), so the code alone cannot see the revoke go.
      expect(await refused(c, () => c.query("insert into client_groups (account_id, kind, name) values ($1,'household','X')", [a])))
        .toMatchObject({ code: "42501", message: "permission denied for table client_groups" });
    }));
  it("the client role cannot update a membership either", () => withRollback(async (c) => {
    await actAs(c, { app_role: "agency_admin", sub: `user_g_agency_${RUN}` });
    expect(await refused(c, () => c.query("update client_group_members set is_billing = true")))
      .toMatchObject({ code: "42501", message: "permission denied for table client_group_members" });
  }));
  it("has exactly the four policies (mutation: drop client_groups_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
        where schemaname = 'public' and tablename in ('client_groups','client_group_members')
        order by tablename collate "C", policyname collate "C"`);
    const row = (t: string, p: string, permissive: string) => ({ tablename: t, policyname: p, permissive, cmd: "SELECT", roles: "{authenticated}" });
    expect(rows).toEqual([
      row("client_group_members", "client_group_members_member_read", "PERMISSIVE"),
      row("client_group_members", "client_group_members_technician_scope", "RESTRICTIVE"),
      row("client_groups", "client_groups_member_read", "PERMISSIVE"),
      row("client_groups", "client_groups_technician_scope", "RESTRICTIVE"),
    ]);
  }));
  it("every write function is executable by service_role only (mutation: grant execute on set_contacts_business to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const fns = [
        "public.create_group_with_member(uuid,uuid,text,text,text)", "public.add_contact_to_group(uuid,uuid,uuid,text)",
        "public.set_contacts_business(uuid,uuid[],text[])", "public.undo_set_business(uuid,uuid,uuid,jsonb)",
        "public.set_primary_group_membership(uuid,uuid)", "public.remove_group_membership(uuid,uuid)",
        "public.restore_group_membership(uuid,jsonb)", "public.reconcile_business_groups(uuid)",
        "app.company_name_for(uuid)", "app.lock_contact(uuid,uuid)", "app.promote_primary(uuid)",
        "app.link_member(uuid,uuid,uuid,text,boolean)", "app.find_or_create_business(uuid,text)", "app.restore_member(uuid,jsonb)",
      ];
      for (const f of fns) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ svc: true, auth: false, anon: false });
      }
      const { rows: [mine] } = await c.query(
        "select has_function_privilege('authenticated', 'app.my_client_group_ids()', 'execute') as auth, has_function_privilege('anon', 'app.my_client_group_ids()', 'execute') as anon");
      expect(mine).toEqual({ auth: true, anon: false });
    }));
});

describe("the company_name sync (spec §5.3, A2)", () => {
  it("follows insert, main-then-age order, rename and removal; a household never sets it (mutation: drop trigger client_groups_sync_company_name -> the rename case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      const ct = await contact(c, a, "Ana");
      const home = await group(c, a, "household", "Garcia");
      await member(c, a, home, ct, true);
      expect(await companyOf(c, ct)).toBeNull();
      const acme = await group(c, a, "business", "Acme Roofing");
      const mAcme = await member(c, a, acme, ct);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      const beta = await group(c, a, "business", "Beta Pools");
      const mBeta = await member(c, a, beta, ct);
      expect(await companyOf(c, ct)).toBe("Acme Roofing"); // oldest business wins while neither is main
      await c.query("update client_group_members set is_primary = false where contact_id = $1", [ct]);
      await c.query("update client_group_members set is_primary = true where id = $1", [mBeta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools"); // the main one wins
      await c.query("update client_groups set name = 'Beta Pools & Spas' where id = $1", [beta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools & Spas");
      await c.query("delete from client_group_members where id = $1", [mBeta]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      await c.query("delete from client_group_members where id = $1", [mAcme]);
      expect(await companyOf(c, ct)).toBeNull();
    }));
  it("never touches updated_at", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    const ct = await contact(c, a, "Ana");
    await c.query("update contacts set updated_at = '2026-01-01T00:00:00Z' where id = $1", [ct]);
    await member(c, a, await group(c, a, "business", "Acme"), ct, true);
    const { rows: [r] } = await c.query<{ u: string; n: string | null }>(
      "select updated_at::text as u, company_name as n from contacts where id = $1", [ct]);
    // Positive control first: the sync DID write this row, so an unchanged updated_at means something.
    expect(r!.n).toBe("Acme");
    expect(r!.u).toBe("2026-01-01 00:00:00+00");
  }));
});
