import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Properties and equipment (spec §5, migration 0071). As the table owner inside a rolled-back
 * transaction unless a case switches role with actAs. A failed constraint, a column without a grant
 * or a refused INSERT raises; a refused UPDATE or DELETE affects 0 rows and raises nothing.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_pl_${RUN}`;
const ORG_B = `org_plb_${RUN}`;
const OWNER_SUB = `user_pl_owner_${RUN}`;
const STAFF_SUB = `user_pl_staff_${RUN}`;

/** Runs one statement under a savepoint: a refusal otherwise aborts the whole transaction (25P02). */
async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}
async function insert(c: Client, table: "places" | "equipment", row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const r = await attempt(c,
    `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row));
  return r.rows[0] as Record<string, unknown> & { id: string };
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = (org: string, name: string) => one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name]);
  const acct = await account(ORG, "Places Co");
  const acctB = await account(ORG_B, "Places B Co");
  const user = (sub: string) => one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
  const owner = await user(OWNER_SUB);
  const staff = await user(STAFF_SUB);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'owner'), ($2,'account',$3,'staff')",
    [owner, staff, acct]);
  const contact = (a: string, first: string) => one("insert into contacts (account_id, first_name) values ($1,$2) returning id", [a, first]);
  const group = (a: string, name: string) => one("insert into client_groups (account_id, kind, name) values ($1,'household',$2) returning id", [a, name]);
  return {
    acct, acctB, owner, staff,
    ana: await contact(acct, "Ana"), bea: await contact(acctB, "Bea"),
    home: await group(acct, "Garcia"), homeB: await group(acctB, "Other"),
  };
}
const ADDR = "1204 Nolana Ave";

describe("places: owners and keys (spec §5.1)", () => {
  it("refuses a place owned by another account's contact (mutation: make places_contact_fkey single-column -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "places", { account_id: s.acct, contact_id: s.bea, address: ADDR }))
        .rejects.toMatchObject({ code: "23503", constraint: "places_contact_fkey" });
    }));
  it("refuses a place owned by another account's group", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(insert(c, "places", { account_id: s.acct, client_group_id: s.homeB, address: ADDR }))
      .rejects.toMatchObject({ code: "23503", constraint: "places_group_fkey" });
  }));
  it("needs exactly one owner (mutation: drop places_one_owner -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    for (const owner of [{ contact_id: s.ana, client_group_id: s.home }, {}]) {
      await expect(insert(c, "places", { account_id: s.acct, address: ADDR, ...owner }))
        .rejects.toMatchObject({ code: "23514", constraint: "places_one_owner" });
    }
  }));
  it("needs an address, a landmark or directions, and any one of them is enough (mutation: drop places_findable -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, label: "Casa" }))
        .rejects.toMatchObject({ code: "23514", constraint: "places_findable" });
      expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, landmark: "the blue house past the canal" })).id).toBeTruthy();
      expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, directions: "Past the Valero, second gate" })).id).toBeTruthy();
    }));
  it("stores text trimmed and never blank; a newline inside directions is kept (mutation: drop the regex from app.tidy_text -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const bad of [` ${ADDR}`, `${ADDR} `, "   ", `\u00a0${ADDR}`, `${ADDR}\t`, "x".repeat(301)]) {
        await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: bad }), JSON.stringify(bad))
          .rejects.toMatchObject({ code: "23514", constraint: "places_address_check" });
      }
      const kept = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, directions: "Past the canal\nsecond gate" });
      expect(kept.directions).toBe("Past the canal\nsecond gate");
      const { rows } = await c.query<{ ok: boolean }>(
        "select app.tidy_text(v, 3) as ok from unnest($1::text[]) with ordinality as t(v, n) order by n", [[null, "abc", "abcd", "", " a", "a b"]]);
      expect(rows.map((r) => r.ok)).toEqual([true, true, false, false, false, true]);
    }));
  it("country is US, MX or nothing", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, country: "CA" }))
      .rejects.toMatchObject({ code: "23514", constraint: "places_country_check" });
  }));
});

describe("equipment: the replacement chain (spec §5.1, C3)", () => {
  const unit = (c: Client, acct: string, place: string, extra: Record<string, unknown> = {}) =>
    insert(c, "equipment", { account_id: acct, place_id: place, name: "AC upstairs", ...extra });

  it("a unit belongs to a place of its own account", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    await expect(unit(c, s.acctB, p.id)).rejects.toMatchObject({ code: "23503", constraint: "equipment_place_fkey" });
  }));
  it("a replacement must be at the same place (mutation: make equipment_replaces_fkey single-column on replaces_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p1 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const p2 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      const u1 = await unit(c, s.acct, p1.id);
      await expect(unit(c, s.acct, p2.id, { replaces_id: u1.id, installed_on: "2026-10-01" }))
        .rejects.toMatchObject({ code: "23503", constraint: "equipment_replaces_fkey" });
    }));
  it("no unit is replaced twice (mutation: drop index equipment_one_successor -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    const u1 = await unit(c, s.acct, p.id);
    await unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-01" });
    await expect(unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-02" })).rejects.toMatchObject({ code: "23505" });
  }));
  it("a replacement carries its date, and a warranty never ends before install", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    const u1 = await unit(c, s.acct, p.id);
    await expect(unit(c, s.acct, p.id, { replaces_id: u1.id }))
      .rejects.toMatchObject({ code: "23514", constraint: "equipment_replacement_dated" });
    await expect(unit(c, s.acct, p.id, { installed_on: "2026-10-01", warranty_until: "2026-09-30" }))
      .rejects.toMatchObject({ code: "23514", constraint: "equipment_warranty_order" });
  }));
  it("a unit something replaced cannot be deleted; its replacement can, and then it can (mutation: equipment_replaces_fkey on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const u1 = await unit(c, s.acct, p.id);
      const u2 = await unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-01" });
      await expect(attempt(c, "delete from equipment where id = $1", [u1.id]))
        .rejects.toMatchObject({ code: "23503", constraint: "equipment_replaces_fkey" });
      expect((await attempt(c, "delete from equipment where id = $1", [u2.id])).rowCount).toBe(1);
      expect((await attempt(c, "delete from equipment where id = $1", [u1.id])).rowCount).toBe(1);
    }));
});

describe("cascades (spec §5.1, O3)", () => {
  it("an Owner deleting a customer removes the places only they own and every unit, chain included, though places_delete_empty would refuse that delete directly; a group's place stays (mutation: places_contact_fkey on delete no action -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const mine = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const shared = await insert(c, "places", { account_id: s.acct, client_group_id: s.home, address: "300 S 10th St" });
      const u1 = await insert(c, "equipment", { account_id: s.acct, place_id: mine.id, name: "Old AC" });
      await insert(c, "equipment", { account_id: s.acct, place_id: mine.id, name: "New AC", replaces_id: u1.id, installed_on: "2026-10-01" });
      await insert(c, "equipment", { account_id: s.acct, place_id: shared.id, name: "Water heater" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "delete from contacts where id = $1", [s.ana])).rowCount).toBe(1);
      await c.query("reset role");
      expect((await c.query("select id from places where account_id = $1", [s.acct])).rows).toEqual([{ id: shared.id }]);
      expect((await c.query("select name from equipment where account_id = $1", [s.acct])).rows).toEqual([{ name: "Water heater" }]);
    }));
  it("a group delete takes its places; an account delete takes everything", () => withRollback(async (c) => {
    const s = await seed(c);
    const shared = await insert(c, "places", { account_id: s.acct, client_group_id: s.home, address: ADDR });
    await insert(c, "equipment", { account_id: s.acct, place_id: shared.id, name: "Water heater" });
    await c.query("delete from client_groups where id = $1", [s.home]);
    expect((await c.query("select 1 from places where id = $1", [shared.id])).rowCount).toBe(0);
    // A GROUP's place, so the contact delete below cannot be what removes it (contacts refuse an
    // account delete, so they go first; the place and its unit must survive that and go with the account).
    const { rows: [g2] } = await c.query<{ id: string }>("insert into client_groups (account_id, kind, name) values ($1,'household','Reyes') returning id", [s.acct]);
    const p = await insert(c, "places", { account_id: s.acct, client_group_id: g2!.id, address: ADDR });
    const u = await insert(c, "equipment", { account_id: s.acct, place_id: p.id, name: "Pump" });
    await c.query("delete from contacts where account_id = $1", [s.acct]);
    expect((await c.query("select 1 from places where id = $1", [p.id])).rowCount).toBe(1); // control: still there
    await c.query("delete from memberships where account_id = $1", [s.acct]);
    await c.query("delete from accounts where id = $1", [s.acct]);
    expect((await c.query("select 1 from places where id = $1", [p.id])).rowCount).toBe(0);
    expect((await c.query("select 1 from equipment where id = $1", [u.id])).rowCount).toBe(0);
  }));
});

describe("grants, triggers and policies (spec §5.2, §5.3)", () => {
  it("an Owner's insert stamps created_by with the caller, whatever the client sent (mutation: drop trigger places_stamp_created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, created_by: s.staff });
      expect(p.created_by).toBe(s.owner);
      const u = await insert(c, "equipment", { account_id: s.acct, place_id: p.id, name: "AC", created_by: s.staff });
      expect(u.created_by).toBe(s.owner);
    }));
  it("the service role keeps the created_by it sends", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("set local role service_role");
    expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, created_by: s.staff })).created_by).toBe(s.staff);
  }));
  it("the client role updates only the granted columns (mutation: grant update (place_id) on public.equipment to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p1 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const p2 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      const u = await insert(c, "equipment", { account_id: s.acct, place_id: p1.id, name: "AC" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "update places set landmark = 'past the canal' where id = $1", [p1.id])).rowCount).toBe(1); // positive control
      for (const [sql, args] of [
        ["update equipment set place_id = $1 where id = $2", [p2.id, u.id]],
        ["update equipment set replaces_id = $1 where id = $1", [u.id]],
        ["update places set created_by = null where id = $1", [p1.id]],
        ["update places set account_id = account_id where id = $1", [p1.id]],
      ] as const) {
        await expect(attempt(c, sql, [...args]), sql).rejects.toMatchObject({ code: "42501" });
      }
    }));
  it("deleting a place with units affects no row; an empty place is deleted (mutation: drop policy places_delete_empty -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const full = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const empty = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      await insert(c, "equipment", { account_id: s.acct, place_id: full.id, name: "AC" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "delete from places where id = $1", [full.id])).rowCount).toBe(0);
      expect((await attempt(c, "delete from places where id = $1", [empty.id])).rowCount).toBe(1);
    }));
  it("has exactly these five policies (mutation: drop policy equipment_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
        where schemaname = 'public' and tablename in ('places','equipment')
        order by tablename collate "C", policyname collate "C"`);
    const row = (t: string, p: string, permissive: string, cmd: string) => ({ tablename: t, policyname: p, permissive, cmd, roles: "{authenticated}" });
    expect(rows).toEqual([
      row("equipment", "equipment_member_all", "PERMISSIVE", "ALL"),
      row("equipment", "equipment_technician_scope", "RESTRICTIVE", "ALL"),
      row("places", "places_delete_empty", "RESTRICTIVE", "DELETE"),
      row("places", "places_member_all", "PERMISSIVE", "ALL"),
      row("places", "places_technician_scope", "RESTRICTIVE", "ALL"),
    ]);
  }));
  it("its four functions are executable by authenticated and service_role, never anon (mutation: revoke execute on app.tidy_text from authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      for (const f of ["app.tidy_text(text,integer)", "app.my_place_ids()", "app.stamp_created_by()", "app.places_owner_guard()"]) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ auth: true, svc: true, anon: false });
      }
    }));
});
