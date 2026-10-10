import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { withRollback } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
const connect = async () => { const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 }); await c.connect(); return c; };

/** Committed: an account with two Owners. Cleaned in finally (account delete cascades memberships; users by sub). */
async function withTwoOwners(fn: (ids: { acct: string; a: string; b: string }) => Promise<void>) {
  const c = await connect();
  const subs = [`user_tf_a_${RUN}`, `user_tf_b_${RUN}`];
  let acct = "";
  try {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    acct = (await c.query<{ id: string }>(
      "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'TF Co') returning id", [agency!.id, `org_test_tf_${RUN}`])).rows[0]!.id;
    const ids: string[] = [];
    for (const s of subs) ids.push((await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [s])).rows[0]!.id);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'owner'),($2,'account',$3,'owner')", [ids[0], ids[1], acct]);
    await fn({ acct, a: ids[0]!, b: ids[1]! });
  } finally {
    if (acct) await c.query("delete from accounts where id = $1", [acct]);
    await c.query("delete from users where clerk_user_id = any($1)", [subs]);
    await c.end();
  }
}

describe("last-Owner guard", () => {
  it("refuses demoting or removing the only Owner", () => withRollback(async (c) => {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    const acct = (await c.query<{ id: string }>("insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Solo') returning id", [agency!.id, `org_solo_${RUN}`])).rows[0]!.id;
    const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'s@example.com') returning id", [`user_solo_${RUN}`])).rows[0]!.id;
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'owner')", [u, acct]);
    const one = async (sql: string, p: unknown[]) => (await c.query<{ r: string }>(sql, p)).rows[0]!.r;
    expect(await one("select public.set_account_member_role($1,$2,'staff') as r", [acct, u])).toBe("last_owner");
    expect(await one("select public.remove_account_member($1,$2) as r", [acct, u])).toBe("last_owner");
    expect(await one("select public.set_account_member_role($1, gen_random_uuid(), 'staff') as r", [acct])).toBe("not_found");
  }));

  it("a sole Owner set to owner is a no-op that returns ok (mutation: drop the same-role early return -> last_owner, FAILS)", () => withRollback(async (c) => {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    const acct = (await c.query<{ id: string }>("insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Same') returning id", [agency!.id, `org_same_${RUN}`])).rows[0]!.id;
    const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'o@example.com') returning id", [`user_same_${RUN}`])).rows[0]!.id;
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'owner')", [u, acct]);
    expect((await c.query<{ r: string }>("select public.set_account_member_role($1,$2,'owner') as r", [acct, u])).rows[0]!.r).toBe("ok");
    expect((await c.query("select role from memberships where user_id = $1", [u])).rows).toEqual([{ role: "owner" }]);
  }));

  // Two connections, each in its own transaction. c1 runs first and holds the account row; c2 must
  // block on it, then decide against what c1 committed. Without the lock c2 reads its own snapshot
  // (both Owners still there), both succeed, and none is left.
  const SET_STAFF = "select public.set_account_member_role($1,$2,'staff') as r";
  const REMOVE = "select public.remove_account_member($1,$2) as r";
  async function race(acct: string, first: [string, string], second: [string, string]) {
    const c1 = await connect(); const c2 = await connect();
    try {
      await c1.query("begin"); await c2.query("begin");
      const r1 = (await c1.query<{ r: string }>(first[0], [acct, first[1]])).rows[0]!.r;
      const p2 = c2.query<{ r: string }>(second[0], [acct, second[1]]);
      await new Promise((res) => setTimeout(res, 300)); // c2 is now blocked on the account row
      await c1.query("commit");
      const r2 = (await p2).rows[0]!.r;
      await c2.query("commit");
      const { rows } = await c1.query("select 1 from memberships where account_id = $1 and role = 'owner'", [acct]);
      return { results: [r1, r2], ownersLeft: rows.length };
    } finally { await c1.end(); await c2.end(); }
  }

  it("two Owners demoting each other at once leave exactly one Owner (mutation: drop the row lock in set_account_member_role -> both return ok, FAILS)", () =>
    withTwoOwners(async ({ acct, a, b }) => {
      expect(await race(acct, [SET_STAFF, a], [SET_STAFF, b])).toEqual({ results: ["ok", "last_owner"], ownersLeft: 1 });
    }));

  it("two Owners removing each other at once leave exactly one Owner (mutation: drop the row lock in remove_account_member -> both return ok, FAILS)", () =>
    withTwoOwners(async ({ acct, a, b }) => {
      expect(await race(acct, [REMOVE, a], [REMOVE, b])).toEqual({ results: ["ok", "last_owner"], ownersLeft: 1 });
    }));

  it("an Owner removed while the other is demoted leaves exactly one Owner (mutation: drop the row lock in EITHER function -> both return ok, FAILS)", () =>
    withTwoOwners(async ({ acct, a, b }) => {
      expect(await race(acct, [REMOVE, a], [SET_STAFF, b])).toEqual({ results: ["ok", "last_owner"], ownersLeft: 1 });
    }));

  // Every insert into a child of accounts (contacts, calls, ...) takes FOR KEY SHARE on the account row
  // for its foreign-key check. FOR UPDATE conflicts with that; FOR NO KEY UPDATE does not, and still
  // conflicts with itself, which is what serialises the races above.
  it("a team action is not blocked by an open contact insert in the same account (mutation: lock with FOR UPDATE in either function -> 55P03, FAILS)", () =>
    withTwoOwners(async ({ acct, a }) => {
      const writer = await connect(); const team = await connect();
      try {
        await writer.query("begin");
        await writer.query("insert into contacts (account_id, first_name) values ($1,'Busy')", [acct]);
        await team.query("set lock_timeout = '2s'");
        expect((await team.query<{ r: string }>(SET_STAFF, [acct, a])).rows[0]!.r).toBe("ok");
        expect((await team.query<{ r: string }>(REMOVE, [acct, a])).rows[0]!.r).toBe("ok");
      } finally {
        await writer.query("rollback").catch(() => undefined);
        await writer.end(); await team.end();
      }
    }));

  it("only service_role may execute either function (mutation: grant execute to authenticated -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select r.role, p.fn, has_function_privilege(r.role, p.fn, 'execute') as can
         from (values ('anon'),('authenticated'),('service_role')) r(role),
              (values ('public.set_account_member_role(uuid,uuid,text)'),('public.remove_account_member(uuid,uuid)')) p(fn)
        order by 1, 2`);
    expect(rows.filter((x: { can: boolean }) => x.can).map((x: { role: string }) => x.role)).toEqual(["service_role", "service_role"]);
  }));

  it("deleting the account carries its memberships away (mutation: keep the FK without cascade -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>("insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Gone') returning id", [agency!.id, `org_gone_${RUN}`])).rows[0]!.id;
      const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'g@example.com') returning id", [`user_gone_${RUN}`])).rows[0]!.id;
      await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'staff')", [u, acct]);
      await c.query("delete from accounts where id = $1", [acct]);
      expect((await c.query("select 1 from memberships where user_id = $1", [u])).rowCount).toBe(0);
    }));
});
