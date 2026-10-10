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

  it("two Owners demoting each other at once leave exactly one Owner (mutation: drop `for update` on accounts -> both return ok, FAILS)", () =>
    withTwoOwners(async ({ acct, a, b }) => {
      const c1 = await connect(); const c2 = await connect();
      try {
        await c1.query("begin"); await c2.query("begin");
        const r1 = (await c1.query<{ r: string }>("select public.set_account_member_role($1,$2,'staff') as r", [acct, a])).rows[0]!.r;
        const p2 = c2.query<{ r: string }>("select public.set_account_member_role($1,$2,'staff') as r", [acct, b]);
        await new Promise((res) => setTimeout(res, 300)); // c2 is now blocked on the account row
        await c1.query("commit");
        const r2 = (await p2).rows[0]!.r;
        await c2.query("commit");
        expect([r1, r2]).toEqual(["ok", "last_owner"]);
        const { rows } = await c1.query("select 1 from memberships where account_id = $1 and role = 'owner'", [acct]);
        expect(rows).toHaveLength(1);
      } finally { await c1.end(); await c2.end(); }
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
