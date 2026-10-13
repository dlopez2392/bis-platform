import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Who we call first in a household or business (S-03 part 2, migration 0075; spec §5). As the table
 * owner inside a rolled-back transaction unless a case switches role. A refused statement runs in a
 * savepoint so the next one reports its own code. Seeds are local to this file on purpose.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function refused(c: Client, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint probe");
  try { await run(); return null; } catch (e) { return e; } finally { await c.query("rollback to savepoint probe"); }
}
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Call First Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const contact = (c: Client, acct: string, first: string) =>
  one(c, "insert into contacts (account_id, first_name) values ($1,$2) returning id", [acct, first]);
const group = (c: Client, acct: string, kind: string, name: string) =>
  one(c, "insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name]);
const member = (c: Client, acct: string, g: string, ct: string, extra: { primary?: boolean; callFirst?: boolean } = {}) =>
  one(c, `insert into client_group_members (account_id, client_group_id, contact_id, is_primary, is_primary_contact)
          values ($1,$2,$3,$4,$5) returning id`, [acct, g, ct, extra.primary ?? false, extra.callFirst ?? false]);
const holders = async (c: Client, g: string) =>
  (await c.query<{ id: string }>("select id from client_group_members where client_group_id = $1 and is_primary_contact order by id", [g]))
    .rows.map((r) => r.id);
const setPrimary = async (c: Client, acct: string, g: string, m: string | null) =>
  (await c.query<{ r: { status: string; previous?: string | null } }>(
    "select public.set_group_primary_contact($1, $2, $3) as r", [acct, g, m])).rows[0]!.r;

async function household(c: Client) {
  const acct = await seedAccount(c, `org_cf_${RUN}`);
  const home = await group(c, acct, "household", "Garcia");
  const ana = await contact(c, acct, "Ana");
  const luis = await contact(c, acct, "Luis");
  const maria = await contact(c, acct, "Maria");
  return {
    acct, home, ana, luis, maria,
    mAna: await member(c, acct, home, ana, { primary: true }),
    mLuis: await member(c, acct, home, luis, { primary: true }),
    mMaria: await member(c, acct, home, maria, { primary: true }),
  };
}

describe("0075: at most one call-first member per group (spec §5)", () => {
  it("a second call-first member in one group is refused 23505 (mutation: drop index client_group_members_one_primary_contact -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mAna]);
      expect(await refused(c, () => c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mLuis])))
        .toMatchObject({ code: "23505", constraint: "client_group_members_one_primary_contact" });
    }));
  it("two groups each keep their own call-first member, and one person may hold it in both (mutation: key the index on contact_id -> 23505, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const mAnaBiz = await member(c, s.acct, biz, s.ana);
      await c.query("update client_group_members set is_primary_contact = true where id = any($1)", [[s.mAna, mAnaBiz]]);
      expect(await holders(c, s.home)).toEqual([s.mAna]);
      expect(await holders(c, biz)).toEqual([mAnaBiz]);
    }));
  it("a new membership starts with none: no backfill (ruling R1; mutation: give the column default true -> the member added through add_contact_to_group holds it, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      // household() names the column (false); 0069's own write path does not, so this one rides the default.
      const pablo = await contact(c, s.acct, "Pablo");
      const { rows: [r] } = await c.query<{ r: { status: string; member_id: string } }>(
        "select public.add_contact_to_group($1, $2, $3) as r", [s.acct, pablo, s.home]);
      expect(r!.r.status).toBe("ok");
      expect(await holders(c, s.home)).toEqual([]);
    }));
});

describe("0075: set_group_primary_contact (spec §5)", () => {
  it("sets, swaps in one call naming the previous holder, and clears with null (mutation: drop the clearing update -> the swap raises 23505, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      expect(await setPrimary(c, s.acct, s.home, s.mAna)).toEqual({ status: "ok", previous: null });
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: s.mAna });
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
      expect(await setPrimary(c, s.acct, s.home, null)).toEqual({ status: "ok", previous: s.mLuis });
      expect(await holders(c, s.home)).toEqual([]);
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: null });
      expect(await setPrimary(c, s.acct, s.home, s.mLuis)).toEqual({ status: "ok", previous: s.mLuis }); // same again: unchanged
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
    }));
  it("a member of ANOTHER group is not_found and nothing moves (mutation: drop `client_group_id = p_group_id` from the member check -> the crossed member is set, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const mAnaBiz = await member(c, s.acct, biz, s.ana);
      expect(await setPrimary(c, s.acct, s.home, mAnaBiz)).toEqual({ status: "not_found" });
      expect(await holders(c, s.home)).toEqual([]);
      expect(await holders(c, biz)).toEqual([]);
    }));
  it("another account's group, or this group under another account id, is not_found (mutation: drop `account_id = p_account_id` from the group lock -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const other = await seedAccount(c, `org_cf_other_${RUN}`);
      expect(await setPrimary(c, other, s.home, s.mAna)).toEqual({ status: "not_found" });
      expect(await setPrimary(c, other, s.home, null)).toEqual({ status: "not_found" });
      expect(await holders(c, s.home)).toEqual([]);
    }));
  it("choosing never touches anyone's Business name: the sync trigger does not fire on the flag (mutation: add is_primary_contact to client_group_members_sync_company_name's update-of list -> the stored value is recomputed, FAILS)", () =>
    withRollback(async (c) => {
      // A value the sync did not set (0072's trigger lifted for one statement, as the table owner):
      // only a sync run would replace it, so it survives exactly when the trigger does not fire.
      await c.query("lock table public.contacts in share row exclusive mode");
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const m = await member(c, s.acct, biz, s.ana);
      await c.query("alter table public.contacts disable trigger contacts_company_name_derived");
      await c.query("update contacts set company_name = 'Acme (as typed)' where id = $1", [s.ana]);
      await c.query("alter table public.contacts enable trigger contacts_company_name_derived");
      expect(await setPrimary(c, s.acct, biz, m)).toEqual({ status: "ok", previous: null });
      const { rows: [row] } = await c.query<{ company_name: string }>("select company_name from contacts where id = $1", [s.ana]);
      expect(row!.company_name).toBe("Acme (as typed)");
    }));
});

describe("0075: the flag across remove, restore, the Business-name Undo and a deleted contact (spec §5's table)", () => {
  const removeOf = async (c: Client, acct: string, m: string) =>
    (await c.query<{ r: { status: string; removed: Record<string, unknown> } }>(
      "select public.remove_group_membership($1, $2) as r", [acct, m])).rows[0]!.r;
  const restore = async (c: Client, acct: string, snap: unknown) =>
    (await c.query<{ r: string }>("select public.restore_group_membership($1, $2::jsonb) as r", [acct, JSON.stringify(snap)])).rows[0]!.r;

  it("removing the holder leaves the group with none; no one is promoted (mutation: remove_group_membership hands the flag to the oldest remaining member -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      expect(r.status).toBe("ok");
      expect(r.removed.is_primary_contact).toBe(true); // to_jsonb carries the new column: the payload's source
      expect(await holders(c, s.home)).toEqual([]);
    }));
  it("restoring the holder puts the flag back (mutation: leave restore_member as 0069 wrote it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      expect(await restore(c, s.acct, r.removed)).toBe("ok");
      expect(await holders(c, s.home)).toEqual([s.mAna]);
    }));
  it("restoring while another member now holds it restores the membership WITHOUT the flag (mutation: restore the flag unconditionally -> 23505, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      const r = await removeOf(c, s.acct, s.mAna);
      await setPrimary(c, s.acct, s.home, s.mLuis);
      expect(await restore(c, s.acct, r.removed)).toBe("ok");
      expect(await holders(c, s.home)).toEqual([s.mLuis]);
      const { rowCount } = await c.query("select 1 from client_group_members where id = $1", [s.mAna]);
      expect(rowCount).toBe(1);
    }));
  it("the Business-name Undo never restores the flag, whatever its snapshot says (plan deviation 1; mutation: pass p_removed through unchanged in undo_set_business -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const biz = await group(c, s.acct, "business", "Acme Roofing");
      const m = await member(c, s.acct, biz, s.ana);
      const snap = (await c.query<{ s: Record<string, unknown> }>("select to_jsonb(m) as s from client_group_members m where id = $1", [m])).rows[0]!.s;
      await c.query("delete from client_group_members where id = $1", [m]);
      const forged = { ...snap, is_primary_contact: true };
      const { rows: [u] } = await c.query<{ r: string }>(
        "select public.undo_set_business($1, $2, null, $3::jsonb) as r", [s.acct, s.ana, JSON.stringify(forged)]);
      expect(u!.r).toBe("ok");
      expect(await holders(c, biz)).toEqual([]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m])).rowCount).toBe(1);
    }));
  it("deleting the holder's contact leaves the group with none, and no error (mutation: make client_group_members_contact_fkey on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await setPrimary(c, s.acct, s.home, s.mAna);
      expect((await c.query("delete from contacts where id = $1", [s.ana])).rowCount).toBe(1);
      expect(await holders(c, s.home)).toEqual([]);
    }));
});

describe("0075: grants (spec §5; client-groups-schema.test.ts:157-208's shapes)", () => {
  it("the client role can neither update the flag nor insert a row carrying it (mutation: grant update (is_primary_contact) to authenticated -> the update runs, FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await actAs(c, { app_role: "agency_admin", sub: `user_cf_agency_${RUN}` });
      expect((await c.query("select is_primary_contact from client_group_members where id = $1", [s.mAna])).rows)
        .toEqual([{ is_primary_contact: false }]); // positive control: it can READ the flag
      expect(await refused(c, () => c.query("update client_group_members set is_primary_contact = true where id = $1", [s.mAna])))
        .toMatchObject({ code: "42501", message: "permission denied for table client_group_members" });
      expect(await refused(c, () => c.query(
        "insert into client_group_members (account_id, client_group_id, contact_id, is_primary_contact) values ($1,$2,$3,true)",
        [s.acct, s.home, s.ana])))
        .toMatchObject({ code: "42501", message: "permission denied for table client_group_members" });
    }));
  it("the new and the two replaced functions are executable by service_role only (mutation: drop 0075's revoke loop -> the 0043 default privilege grants anon and authenticated, FAILS)", () =>
    withRollback(async (c) => {
      for (const f of ["public.set_group_primary_contact(uuid,uuid,uuid)", "app.restore_member(uuid,jsonb)", "public.undo_set_business(uuid,uuid,uuid,jsonb)"]) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ svc: true, auth: false, anon: false });
      }
    }));
});
