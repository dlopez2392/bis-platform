import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";

// client_access_enabled defaults to false (migration 0008), so these
// accounts are marked enabled explicitly -- every existing test here uses
// the org_id claim to model an authenticated in-account client, which since
// 0008 requires the switch to be on for current_account_id() to resolve
// anything. The disabled case gets its own dedicated seeding below.
async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_A','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_B','Bravo',true) returning id", [agency.id]);
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

  // `blueprints` (migration 0007) is the one table in the schema with no
  // account_id column at all: its policy is app.is_agency() alone, not the
  // app.is_agency() or account_id = app.current_account_id() pattern every
  // other table uses. No account-scoped table's test exercises that policy
  // shape, so it gets its own pair here, mirroring the accounts/events
  // pattern above as closely as this table's shape allows.
  it("blueprints are agency-scoped: an account member sees none and cannot insert one", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      const { a } = await seedTwoAccounts(c);
      await c.query(
        "insert into blueprints (agency_id, name, source_account_id) values ($1,'RLS Blueprint Probe',$2)",
        [agency.id, a]);

      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query(
        "select name from blueprints where name = 'RLS Blueprint Probe'");
      expect(rows).toHaveLength(0);
      await expect(
        c.query("insert into blueprints (agency_id, name) values ($1,'Should Never Land')", [agency.id])
      ).rejects.toThrow(/row-level security/);
    }));

  it("agency sees blueprints", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      await c.query(
        "insert into blueprints (agency_id, name) values ($1,'RLS Blueprint Probe 2')", [agency.id]);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query(
        "select name from blueprints where name = 'RLS Blueprint Probe 2'");
      expect(rows).toHaveLength(1);
    }));

  // `checklist_items` (migration 0007) follows the ordinary account-scoped
  // shape (app.is_agency() or account_id = app.current_account_id()), same
  // as contacts above, but nothing else in this file exercised it.
  it("checklist_items are tenant-isolated like other account-scoped tables", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await c.query(
        "insert into checklist_items (account_id, item_key) values ($1,'phone_number'),($2,'phone_number')",
        [a, b]);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select account_id from checklist_items");
      expect(new Set(rows.map((r: any) => r.account_id)).size).toBe(1);
      await expect(
        c.query("insert into checklist_items (account_id, item_key) values ($1,'a2p_registration')", [b])
      ).rejects.toThrow(/row-level security/);
    }));

  it("agency sees checklist_items across accounts", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await c.query(
        "insert into checklist_items (account_id, item_key) values ($1,'phone_number'),($2,'phone_number')",
        [a, b]);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query(
        "select account_id from checklist_items where account_id in ($1,$2)", [a, b]);
      expect(rows.map((r: any) => r.account_id).sort()).toEqual([a, b].sort());
    }));

  it("a client sees its own account only when client access is enabled", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query(
        "insert into public.agencies (name) values ('T') returning id",
      );
      const { rows: [mine] } = await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_mine', 'Mine', true) returning id`, [agency.id],
      );
      const { rows: [theirs] } = await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_theirs', 'Theirs', true) returning id`, [agency.id],
      );
      await c.query(
        `insert into public.contacts (account_id, first_name) values ($1,'A'), ($2,'B')`,
        [mine.id, theirs.id],
      );

      await actAs(c, { org_id: "org_mine" });
      const { rows } = await c.query("select account_id from public.contacts");
      expect(rows).toHaveLength(1);
      expect(rows[0].account_id).toBe(mine.id);
      expect(rows.map((r) => r.account_id)).not.toContain(theirs.id);
    });
  });

  it("a client sees nothing when client access is disabled", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query(
        "insert into public.agencies (name) values ('T') returning id",
      );
      const { rows: [acct] } = await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_off', 'Off', false) returning id`, [agency.id],
      );
      await c.query("insert into public.contacts (account_id, first_name) values ($1,'A')", [acct.id]);

      await actAs(c, { org_id: "org_off" });
      const { rows } = await c.query("select id from public.contacts");
      expect(rows).toHaveLength(0);
    });
  });

  it("the agency still sees every account regardless of the flag", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query(
        "insert into public.agencies (name) values ('T') returning id",
      );
      const { rows: [acct] } = await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_off2', 'Off', false) returning id`, [agency.id],
      );
      await c.query("insert into public.contacts (account_id, first_name) values ($1,'A')", [acct.id]);

      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from public.contacts");
      expect(rows.map((r) => r.account_id)).toContain(acct.id);
    });
  });

  // Gap closed by migration 0009: accounts_member_read (0001_tenancy.sql)
  // matched on the org claim directly rather than through
  // app.current_account_id(), so it never picked up the client_access_enabled
  // gate 0008 added to that function. A disabled client could still select
  // their own accounts row even though every other tenant table correctly
  // returned nothing for them. Both halves matter here: without the enabled
  // case, this test would still pass if the policy were simply broken
  // (denying everyone), which would hide the real bug in a different way.
  it("accounts_member_read: a disabled client gets zero rows from public.accounts", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query(
        "insert into public.agencies (name) values ('T') returning id",
      );
      await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_member_read_off', 'MemberReadOff', false)`, [agency.id],
      );

      await actAs(c, { org_id: "org_member_read_off" });
      const { rows } = await c.query("select * from public.accounts");
      expect(rows).toHaveLength(0);
    });
  });

  it("accounts_member_read: an enabled client gets exactly their own one row from public.accounts", async () => {
    await withRollback(async (c) => {
      await actAsOwner(c);
      const { rows: [agency] } = await c.query(
        "insert into public.agencies (name) values ('T') returning id",
      );
      const { rows: [mine] } = await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_member_read_on', 'MemberReadOn', true) returning id`, [agency.id],
      );
      // A second account in the same agency, disabled -- must never appear
      // for the enabled client, proving the row is scoped by org_id and not
      // just "any account with the flag on".
      await c.query(
        `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
         values ($1, 'org_member_read_other', 'Other', true)`, [agency.id],
      );

      await actAs(c, { org_id: "org_member_read_on" });
      const { rows } = await c.query("select * from public.accounts");
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(mine.id);
      expect(rows[0].clerk_org_id).toBe("org_member_read_on");
    });
  });
});
