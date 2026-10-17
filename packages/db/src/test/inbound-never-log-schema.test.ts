import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * 0083 (S-06 part 2, spec "Data model"; plan G7, G17): the account's Never record list. Server-written
 * (0053); members of the account read it, the agency every account's, a Technician none, another
 * account none. Its own seed, in 0082's schema test's shape.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_nl_${RUN}`;
const ORG_B = `org_nlb_${RUN}`;
const SUB = { owner: `u_nl_owner_${RUN}`, staff: `u_nl_staff_${RUN}`, tech: `u_nl_tech_${RUN}`, ownerB: `u_nl_ownerb_${RUN}` } as const;

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? "?"; } };
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const entry = (c: Client, acct: string, pattern: string, kind: string) =>
  attempt(c, "insert into inbound_never_log (account_id, pattern, kind, added_by) values ($1,$2,$3,'u_x') returning id", [acct, pattern, kind]);

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'NL Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'NL B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<keyof typeof SUB, string>;
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role)
     values ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$6,'owner'),
             ($1,'account',$6,'owner')`,
    [u.owner, u.staff, u.tech, u.ownerB, acct, acctB]);
  // s.owner also holds an owner membership on acctB (dual-membership), so the only thing stopping
  // them from seeing acctB's row while acting under ORG's session is member_read's
  // account_id = app.current_account_id() clause, not the restrictive policy (which passes for
  // either account by account_role alone, with no notion of "current" session account).
  const addr = (await entry(c, acct, "billing@supplier.com", "address")).rows[0]!.id as string;
  const dom = (await entry(c, acct, "supplier.com", "domain")).rows[0]!.id as string;
  const other = (await entry(c, acctB, "vendor.com", "domain")).rows[0]!.id as string;
  return { agencyId: agency!.id, acct, acctB, addr, dom, other };
}

describe("0083: inbound_never_log's shape", () => {
  it("takes a lowercase address or a lowercase dotted domain, consistent with its kind, at most 254 characters (mutation: drop inbound_never_log_pattern_check → 'Supplier.com' is ok, FAILS; drop the kind half of it → an address stored as a domain is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(entry(c, s.acct, "Supplier.com", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "supplier", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a@supplier.com", "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a@@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a b@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "a+tag@supplier.com", "address"))).toBe("23514");
      expect(await code(entry(c, s.acct, "x.com", "other"))).toBe("23514");
      expect(await code(entry(c, s.acct, `${"a".repeat(250)}.com`, "domain"))).toBe("23514");
      expect(await code(entry(c, s.acct, "ana.lopez@mail.example.co", "address"))).toBe("ok");
      expect(await code(entry(c, s.acct, "mail.example.co", "domain"))).toBe("ok");
    });
  });

  it("one pattern once per account, the same pattern on another account is fine; the unique index leads with account_id (G17; mutation: drop the unique constraint → the second insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      expect(await code(entry(c, s.acct, "billing@supplier.com", "address"))).toBe("23505");
      expect(await code(entry(c, s.acctB, "billing@supplier.com", "address"))).toBe("ok");
      const { rows: [ix] } = await c.query<{ def: string }>("select pg_get_indexdef(indexrelid) as def from pg_index where indexrelid = 'public.inbound_never_log_account_pattern_key'::regclass");
      expect(ix!.def).toContain("(account_id, pattern)");
    });
  });

  it("goes with its account (mutation: account_id without on delete cascade → the delete fails 23503, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const bare = await one(c, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'NL bare') returning id", [s.agencyId, `org_nlc_${RUN}`]);
      await entry(c, bare, "gone.com", "domain");
      await c.query("delete from accounts where id = $1", [bare]);
      expect((await c.query("select count(*)::int as n from inbound_never_log where account_id = $1", [bare])).rows[0]).toEqual({ n: 0 });
    });
  });
});

describe("0083: who reads inbound_never_log", () => {
  it("the account's Owner and staff read its rows, the agency every account's, a Technician none, another account's Owner none, and a dual-member's OWN account rows stay scoped to their current session's account (G7; mutation: drop inbound_never_log_no_technician → the tech sees two, FAILS; member_read using (true) → the dual-member owner, acting under ORG, also sees acctB's row, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      const seen = async (claims: { org_id?: string; app_role?: string; sub: string }) => {
        await actAs(c, claims);
        const ids = (await c.query<{ id: string }>("select id from inbound_never_log where id = any($1::uuid[]) order by id", [[s.addr, s.dom, s.other]])).rows.map((r) => r.id);
        await c.query("reset role");
        return ids;
      };
      expect(await seen({ org_id: ORG, sub: SUB.owner })).toEqual([s.addr, s.dom].sort());
      expect(await seen({ org_id: ORG, sub: SUB.staff })).toEqual([s.addr, s.dom].sort());
      expect(await seen({ org_id: ORG, sub: SUB.tech })).toEqual([]);
      expect(await seen({ org_id: ORG_B, sub: SUB.ownerB })).toEqual([s.other]);
      expect(await seen({ app_role: "agency_admin", sub: `u_nl_agency_${RUN}` })).toEqual([s.addr, s.dom, s.other].sort());
    });
  });

  it("no client role writes; authenticated has SELECT only, anon nothing (0053; mutation: grant insert to authenticated → the owner's insert is ok, FAILS)", async () => {
    await withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: SUB.owner });
      expect(await code(attempt(c, "insert into inbound_never_log (account_id, pattern, kind, added_by) values ($1,'x.com','domain','u')", [s.acct]))).toBe("42501");
      expect(await code(attempt(c, "update inbound_never_log set pattern = 'y.com' where id = $1", [s.dom]))).toBe("42501");
      expect(await code(attempt(c, "delete from inbound_never_log where id = $1", [s.dom]))).toBe("42501");
      await c.query("reset role");
      const { rows: [g] } = await c.query(
        `select has_table_privilege('authenticated','public.inbound_never_log','SELECT') as a_sel,
                has_table_privilege('authenticated','public.inbound_never_log','INSERT') as a_ins,
                has_table_privilege('authenticated','public.inbound_never_log','UPDATE') as a_upd,
                has_table_privilege('authenticated','public.inbound_never_log','DELETE') as a_del,
                has_table_privilege('anon','public.inbound_never_log','SELECT') as n_sel,
                (select relrowsecurity from pg_class where oid = 'public.inbound_never_log'::regclass) as rls`);
      expect(g).toEqual({ a_sel: true, a_ins: false, a_upd: false, a_del: false, n_sel: false, rls: true });
    });
  });
});
