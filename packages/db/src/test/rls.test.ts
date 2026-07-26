import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";

async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1,'org_A','Alpha') returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1,'org_B','Bravo') returning id", [agency.id]);
  await c.query(
    "insert into events (account_id, type, actor_type, payload) values ($1,'account.created','system','{}'),($2,'account.created','system','{}')",
    [a.id, b.id]);
  return { a: a.id as string, b: b.id as string };
}

describe("RLS tenant isolation", () => {
  it("account member sees only their own account", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select clerk_org_id from accounts");
      expect(rows.map((r: any) => r.clerk_org_id)).toEqual(["org_A"]);
    }));

  it("account member sees only their own events; cannot insert into other tenant", () =>
    withRollback(async (c) => {
      const { b } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select account_id from events");
      expect(new Set(rows.map((r: any) => r.account_id)).size).toBe(1);
      await expect(
        c.query("insert into events (account_id, type, actor_type) values ($1,'x','user')", [b])
      ).rejects.toThrow(/row-level security/);
    }));

  it("forged/absent claims see nothing and cannot write", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_NOPE" });
      const { rows } = await c.query("select * from accounts");
      expect(rows).toHaveLength(0);
      await expect(
        c.query("insert into accounts (agency_id, clerk_org_id, name) values (gen_random_uuid(),'x','x')")
      ).rejects.toThrow();
    }));

  it("agency_admin sees all accounts and all events", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select clerk_org_id from accounts order by clerk_org_id");
      // real accounts may exist in the dev DB; agency must see the seeded ones among them
      expect(rows.map((r: any) => r.clerk_org_id)).toEqual(expect.arrayContaining(["org_A", "org_B"]));
    }));

  it("events are append-only even for agency", () =>
    withRollback(async (c) => {
      const ids = await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("update events set type='hacked'")).rejects.toThrow();
      await expect(c.query("delete from events")).rejects.toThrow();
      void ids; void actAsOwner;
    }));

  it("CRM tables are tenant-isolated (contacts as representative)", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await c.query(
        "insert into contacts (account_id, first_name) values ($1,'Alice'),($2,'Bob')", [a, b]);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select first_name from contacts");
      expect(rows.map((r: any) => r.first_name)).toEqual(["Alice"]);
      await expect(
        c.query("insert into contacts (account_id, first_name) values ($1,'Mallory')", [b])
      ).rejects.toThrow(/row-level security/);
    }));

  it("agency sees CRM rows across accounts", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await c.query(
        "insert into contacts (account_id, first_name) values ($1,'Alice'),($2,'Bob')", [a, b]);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query(
        "select first_name from contacts where account_id in ($1,$2)", [a, b]);
      expect(rows.map((r: any) => r.first_name).sort()).toEqual(["Alice", "Bob"]);
    }));
});
