import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * P3 and O2: a Technician sees, and writes, a place only through a customer assigned to them or
 * that customer's group, and never moves a place between owners. Owner, Staff and the agency see
 * the whole account; another account, a login with no membership and a departed Technician see
 * nothing. Its own seed (as the groups plan needed): a household shared by the Technician's
 * customer and someone else's.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_plr_${RUN}`;
const ORG_B = `org_plrb_${RUN}`;
const SUB = {
  owner: `u_pl_owner_${RUN}`, staff: `u_pl_staff_${RUN}`, tech: `u_pl_tech_${RUN}`,
  tech2: `u_pl_tech2_${RUN}`, none: `u_pl_none_${RUN}`, ownerB: `u_pl_ownerb_${RUN}`,
} as const;
type Person = keyof typeof SUB;
const claims = (p: Person | "agency") =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_pl_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PL Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PL B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (kind: string, name: string) => one("insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name]);
  const garcia = await g("household", "Garcia");
  const beta = await g("business", "Beta Pools");
  const member = (grp: string, contact: string) =>
    c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, grp, contact]);
  await member(garcia, mine);
  await member(garcia, theirs);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id) values ($1,$2,$3)", [acct, beta, theirs]);
  const place = (owner: { contact_id?: string; client_group_id?: string }, address: string) =>
    one(`insert into places (account_id, contact_id, client_group_id, address) values ($1,$2,$3,$4) returning id`,
      [acct, owner.contact_id ?? null, owner.client_group_id ?? null, address]);
  const pMine = await place({ contact_id: mine }, "1 Mine St");
  const pTheirs = await place({ contact_id: theirs }, "2 Theirs St");
  const pShared = await place({ client_group_id: garcia }, "3 Garcia St");
  const pBeta = await place({ client_group_id: beta }, "4 Beta St");
  const unit = (p: string, name: string) => one("insert into equipment (account_id, place_id, name) values ($1,$2,$3) returning id", [acct, p, name]);
  return {
    acct, acctB, u, mine, theirs, garcia, beta, pMine, pTheirs, pShared, pBeta,
    uMine: await unit(pMine, "AC"), uTheirs: await unit(pTheirs, "AC"), uShared: await unit(pShared, "Water heater"), uBeta: await unit(pBeta, "Pump"),
  };
}
const ids = async (c: Client, table: string, acct: string) =>
  (await c.query<{ id: string }>(`select id from ${table} where account_id = $1 order by id`, [acct])).rows.map((r) => r.id);

describe("P3: the Technician reads only through their own customer", () => {
  it("reads their customer's place and their customer's household's place, never another customer's or a group with none of theirs (mutation: drop policy places_technician_scope -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect(await ids(c, "places", s.acct)).toEqual([s.pMine, s.pShared].sort());
    }));
  it("equipment follows its place (mutation: drop policy equipment_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claims("tech"));
    expect(await ids(c, "equipment", s.acct)).toEqual([s.uMine, s.uShared].sort());
  }));
});

describe("O2: the Technician writes on what they can see, and nowhere else", () => {
  it("edits their customer's place and the shared household's, and adds a unit there (mutation: key places_technician_scope on contact_id only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect((await attempt(c, "update places set landmark = 'past the canal' where id = $1", [s.pShared])).rowCount).toBe(1);
      expect((await attempt(c, "update places set landmark = 'blue house' where id = $1", [s.pMine])).rowCount).toBe(1);
      expect((await attempt(c, "insert into equipment (account_id, place_id, name) values ($1,$2,'Thermostat')", [s.acct, s.pShared])).rowCount).toBe(1);
    }));
  it("may remove an empty shared place and put a shared place in Removed properties", () => withRollback(async (c) => {
    const s = await seed(c);
    const { rows: [e] } = await c.query<{ id: string }>(
      "insert into places (account_id, client_group_id, address) values ($1,$2,'9 Empty St') returning id", [s.acct, s.garcia]);
    await actAs(c, claims("tech"));
    expect((await attempt(c, "delete from places where id = $1", [e!.id])).rowCount).toBe(1);
    expect((await attempt(c, "update places set archived_at = now() where id = $1", [s.pShared])).rowCount).toBe(1);
  }));
  it("on another customer's place: an insert raises 42501, an update or a delete touches no row", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claims("tech"));
    await expect(attempt(c, "insert into places (account_id, contact_id, address) values ($1,$2,'5 New St')", [s.acct, s.theirs]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(attempt(c, "insert into equipment (account_id, place_id, name) values ($1,$2,'AC')", [s.acct, s.pTheirs]))
      .rejects.toMatchObject({ code: "42501" });
    expect((await attempt(c, "update places set landmark = 'x' where id = $1", [s.pTheirs])).rowCount).toBe(0);
    expect((await attempt(c, "update equipment set name = 'x' where id = $1", [s.uBeta])).rowCount).toBe(0);
  }));
  it("cannot move a place between a person and a group even inside their reach, while an Owner can (mutation: drop trigger places_owner_guard -> FAILS)", () =>
    withRollback(async (c) => {
      // Mine is a member of Garcia, so the with-check alone would ALLOW this move: only the trigger refuses it.
      const s = await seed(c);
      const move = "update places set contact_id = null, client_group_id = $1 where id = $2";
      await actAs(c, claims("tech"));
      await expect(attempt(c, move, [s.garcia, s.pMine])).rejects.toMatchObject({ code: "42501" });
      await c.query("reset role");
      await actAs(c, claims("owner"));
      expect((await attempt(c, move, [s.garcia, s.pMine])).rowCount).toBe(1);
    }));
});

describe("everyone else", () => {
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: every place and unit of the account`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect(await ids(c, "places", s.acct)).toEqual([s.pMine, s.pTheirs, s.pShared, s.pBeta].sort());
      expect(await ids(c, "equipment", s.acct)).toEqual([s.uMine, s.uTheirs, s.uShared, s.uBeta].sort());
    }));
  }
  it("another account's Owner, a login with no membership and a departed Technician see nothing", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("delete from memberships where user_id = $1", [s.u.tech2]); // departed; Theirs is still assigned to them
    for (const p of ["ownerB", "none", "tech2"] as const) {
      await c.query("reset role");
      await actAs(c, claims(p));
      expect(await ids(c, "places", s.acct), p).toEqual([]);
      expect(await ids(c, "equipment", s.acct), p).toEqual([]);
    }
  }));
});
