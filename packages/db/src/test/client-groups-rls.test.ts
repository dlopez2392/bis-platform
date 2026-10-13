import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * G8: a Technician sees a group only through a customer assigned to them,
 * and only THAT member. Owner, Staff and the agency see everything their
 * tenant policy allows; a login with no membership and another account see
 * nothing.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_grls_${RUN}`;
const ORG_B = `org_grls_b_${RUN}`;
const SUB = { owner: `u_g_owner_${RUN}`, staff: `u_g_staff_${RUN}`, tech: `u_g_tech_${RUN}`, tech2: `u_g_tech2_${RUN}`, none: `u_g_none_${RUN}`, ownerB: `u_g_ownerb_${RUN}` } as const;
type Person = keyof typeof SUB;
const claims = (p: Person | "agency") =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_g_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'G Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'G B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string, a = acct) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [a, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (kind: string, name: string, a = acct) => one("insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [a, kind, name]);
  const shared = await g("household", "Garcia");
  const onlyTheirs = await g("business", "Beta Pools");
  const m = (grp: string, contact: string, primary: boolean, a = acct) =>
    one("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,$4) returning id", [a, grp, contact, primary]);
  const mineInShared = await m(shared, mine, true);
  const theirsInShared = await m(shared, theirs, true);
  const theirsInBeta = await m(onlyTheirs, theirs, false);
  const bContact = await ct(null, "B person", acctB);
  const bGroup = await g("household", "Other Co household", acctB);
  await m(bGroup, bContact, true, acctB);
  return { acct, shared, onlyTheirs, mineInShared, theirsInShared, theirsInBeta, bGroup };
}
const ids = async (c: Client, table: string, acct: string) =>
  (await c.query<{ id: string }>(`select id from ${table} where account_id = $1 order by id`, [acct])).rows.map((r) => r.id);

describe("G8: the Technician sees a group only through their own customer (mutation: drop client_group_members_technician_scope -> FAILS)", () => {
  it("sees the shared household and THEIR membership only, never the co-member or a group with none of theirs", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared]);
      expect(await ids(c, "client_group_members", s.acct)).toEqual([s.mineInShared]);
    }));
});

describe("Owner, Staff and the agency see the whole account", () => {
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: every group and membership`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared, s.onlyTheirs].sort());
      expect(await ids(c, "client_group_members", s.acct)).toEqual([s.mineInShared, s.theirsInShared, s.theirsInBeta].sort());
    }));
  }
});

describe("tenant isolation and the NULL guard", () => {
  it("another account's Owner and a login with no membership see none of it", () => withRollback(async (c) => {
    const s = await seed(c);
    for (const p of ["ownerB", "none"] as const) {
      await c.query("reset role");
      await actAs(c, claims(p));
      expect(await ids(c, "client_groups", s.acct), p).toEqual([]);
      expect(await ids(c, "client_group_members", s.acct), p).toEqual([]);
    }
  }));
});

describe("S-03 part 2: the group page's reads under the Technician's RLS (spec §4.2, §11.1; plan deviation 10)", () => {
  const groupRows = async (c: Client, acct: string, g: string) =>
    (await c.query<{ id: string; is_primary_contact: boolean }>(
      `select id, is_primary_contact from client_group_members where account_id = $1 and client_group_id = $2 order by created_at, id`,
      [acct, g])).rows;
  const count = async (c: Client, acct: string, g: string) =>
    (await c.query<{ n: number }>("select count(*)::int as n from client_group_members where account_id = $1 and client_group_id = $2", [acct, g])).rows[0]!.n;

  it("a Technician with one member of the household reads the group, ONE member row and a count of 1, and every place of the group (mutation: drop client_group_members_technician_scope -> 2 rows, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // places_findable (0071) needs an address, a landmark or directions.
      const place = (await c.query<{ id: string }>(
        "insert into places (account_id, client_group_id, label, address) values ($1,$2,'The house','12 Palm St') returning id", [s.acct, s.shared])).rows[0]!.id;
      await actAs(c, claims("tech"));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared]);
      expect((await groupRows(c, s.acct, s.shared)).map((r) => r.id)).toEqual([s.mineInShared]);
      expect(await count(c, s.acct, s.shared)).toBe(1);
      expect((await c.query("select id from places where account_id = $1 and client_group_id = $2", [s.acct, s.shared])).rows)
        .toEqual([{ id: place }]);
      // A group with none of theirs reads as nothing at all: the page's readGroup is null, a 404.
      expect((await c.query("select 1 from client_groups where id = $1", [s.onlyTheirs])).rowCount).toBe(0);
    }));
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: both members of the household and a count of 2 (mutation: drop the sees_all_customers branch of client_group_members_technician_scope -> FAILS)`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect((await groupRows(c, s.acct, s.shared)).map((r) => r.id).sort()).toEqual([s.mineInShared, s.theirsInShared].sort());
      expect(await count(c, s.acct, s.shared)).toBe(2);
    }));
  }
  it("the flag is exactly as visible as its row: the Technician reads it on their customer's row and nowhere else (mutation: drop the restrictive member policy -> they read the other's holder row, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mineInShared]);
      await actAs(c, claims("tech"));
      expect(await groupRows(c, s.acct, s.shared)).toEqual([{ id: s.mineInShared, is_primary_contact: true }]);
      await c.query("reset role");
      await c.query("update client_group_members set is_primary_contact = false where id = $1", [s.mineInShared]);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.theirsInShared]);
      await actAs(c, claims("tech"));
      expect((await groupRows(c, s.acct, s.shared)).filter((r) => r.is_primary_contact)).toEqual([]);
      await c.query("reset role");
      await actAs(c, claims("owner"));
      expect((await groupRows(c, s.acct, s.shared)).filter((r) => r.is_primary_contact).map((r) => r.id)).toEqual([s.theirsInShared]);
    }));
});
