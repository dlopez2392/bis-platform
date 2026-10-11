import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Groups Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string, company: string | null = null, createdAt = "2026-01-01T00:00:00Z") =>
  (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, company_name, created_at) values ($1,$2,$3,$4) returning id",
    [acct, first, company, createdAt])).rows[0]!.id;
const call = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ r: unknown }>(`select ${sql} as r`, args)).rows[0]!.r;
const members = async (c: Client, ct: string) =>
  (await c.query<{ name: string; is_primary: boolean; role: string | null; is_billing: boolean }>(
    `select g.name, m.is_primary, m.role, m.is_billing from client_group_members m join client_groups g on g.id = m.client_group_id
      where m.contact_id = $1 order by m.created_at, m.id`, [ct])).rows;
const companyOf = async (c: Client, ct: string) =>
  (await c.query<{ company_name: string | null }>("select company_name from contacts where id = $1", [ct])).rows[0]!.company_name;

describe("create_group_with_member and add_contact_to_group", () => {
  it("a business that already exists is linked, not duplicated; the first membership is main", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const luis = await contact(c, a, "Luis");
    const first = await call(c, "public.create_group_with_member($1,$2,'business',$3,'Dueña')", [a, ana, " Acme Roofing "]) as Record<string, unknown>;
    expect(first).toMatchObject({ status: "ok", existed: false, name: "Acme Roofing" });
    const second = await call(c, "public.create_group_with_member($1,$2,'business',$3)", [a, luis, "acme roofing"]) as Record<string, unknown>;
    expect(second).toMatchObject({ status: "ok", existed: true, group_id: first.group_id, name: "Acme Roofing" });
    expect(await members(c, ana)).toEqual([{ name: "Acme Roofing", is_primary: true, role: "Dueña", is_billing: false }]);
  }));
  it("refuses a contact or group from another account", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_a_${RUN}`);
    const b = await seedAccount(c, `org_f_b_${RUN}`);
    const theirs = await contact(c, b, "Bea");
    expect(await call(c, "public.create_group_with_member($1,$2,'household','Garcia')", [a, theirs])).toEqual({ status: "not_found" });
    const g = (await call(c, "public.create_group_with_member($1,$2,'household','Reyes')", [b, theirs]) as { group_id: string }).group_id;
    const mine = await contact(c, a, "Ana");
    expect(await call(c, "public.add_contact_to_group($1,$2,$3)", [a, mine, g])).toEqual({ status: "not_found" });
  }));
});

describe("set_contacts_business, undo, main, remove, restore", () => {
  it("replace keeps main, blank removes and promotes, same key is unchanged (mutation: link the new business with p_primary false -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_f_${RUN}`);
      const ana = await contact(c, a, "Ana");
      await call(c, "public.create_group_with_member($1,$2,'household','Garcia')", [a, ana]); // main
      const r1 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Acme Roofing"]]) as Array<Record<string, unknown>>;
      expect(r1[0]).toMatchObject({ status: "ok", removed: null });
      expect(await companyOf(c, ana)).toBe("Acme Roofing");
      // Two statements: a non-deferrable unique index is checked row by row, so one UPDATE that moves
      // the main flag between two rows can trip client_group_members_one_primary mid-statement.
      await c.query("update client_group_members set is_primary = false where contact_id = $1", [ana]);
      await c.query(
        "update client_group_members set is_primary = true where contact_id = $1 and client_group_id = (select id from client_groups where account_id = $2 and name = 'Acme Roofing')",
        [ana, a]);
      const r2 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<Record<string, unknown>>;
      expect(r2[0]).toMatchObject({ status: "ok" });
      expect((r2[0]!.removed as { is_primary: boolean }).is_primary).toBe(true);
      expect(await members(c, ana)).toEqual([
        { name: "Garcia", is_primary: false, role: null, is_billing: false },
        { name: "Beta Pools", is_primary: true, role: null, is_billing: false },
      ]);
      const r3 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["BETA POOLS "]]) as Array<Record<string, unknown>>;
      expect(r3[0]).toMatchObject({ status: "unchanged", removed: null, added: null });
      const r4 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["   "]]) as Array<Record<string, unknown>>;
      expect(r4[0]).toMatchObject({ status: "ok", added: null });
      expect(await members(c, ana)).toEqual([{ name: "Garcia", is_primary: true, role: null, is_billing: false }]);
      expect(await companyOf(c, ana)).toBeNull();
    }));
  it("too long, another account's contact and mismatched arrays", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_a_${RUN}`);
    const b = await seedAccount(c, `org_f_b_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const bea = await contact(c, b, "Bea");
    const r = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana, bea], ["x".repeat(121), "Acme"]]) as Array<Record<string, unknown>>;
    expect(r.map((x) => x.status)).toEqual(["too_long", "not_found"]);
    await expect(call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], []])).rejects.toMatchObject({ code: "22023" });
  }));
  it("undo puts back exactly the membership the edit replaced", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    await call(c, "public.create_group_with_member($1,$2,'business','Acme Roofing','Dueña')", [a, ana]);
    await c.query("update client_group_members set is_billing = true where contact_id = $1", [ana]);
    const [r] = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<{ added: string; removed: unknown }>;
    expect(await call(c, "public.undo_set_business($1,$2,$3,$4)", [a, ana, r!.added, JSON.stringify(r!.removed)])).toBe("ok");
    expect(await members(c, ana)).toEqual([{ name: "Acme Roofing", is_primary: true, role: "Dueña", is_billing: true }]);
    expect(await companyOf(c, ana)).toBe("Acme Roofing");
  }));
  it("a business the contact already belonged to is kept, and never handed back as added", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    await call(c, "public.create_group_with_member($1,$2,'business','Acme Roofing')", [a, ana]);
    await call(c, "public.create_group_with_member($1,$2,'business','Beta Pools')", [a, ana]);
    const [r] = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<{ added: string | null }>;
    expect(r!.added).toBeNull();
    expect(await members(c, ana)).toEqual([{ name: "Beta Pools", is_primary: true, role: null, is_billing: false }]);
  }));
  it("make main returns the previous main; remove promotes the oldest; restore is exact", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const g1 = await call(c, "public.create_group_with_member($1,$2,'household','Garcia','Madre')", [a, ana]) as { member_id: string };
    const g2 = await call(c, "public.create_group_with_member($1,$2,'household','Reyes')", [a, ana]) as { member_id: string };
    expect(await call(c, "public.set_primary_group_membership($1,$2)", [a, g2.member_id])).toEqual({ status: "ok", previous: g1.member_id });
    const removed = await call(c, "public.remove_group_membership($1,$2)", [a, g2.member_id]) as { removed: unknown };
    expect(await members(c, ana)).toEqual([{ name: "Garcia", is_primary: true, role: "Madre", is_billing: false }]);
    expect(await call(c, "public.restore_group_membership($1,$2)", [a, JSON.stringify(removed.removed)])).toBe("ok");
    expect(await members(c, ana)).toEqual([
      { name: "Garcia", is_primary: false, role: "Madre", is_billing: false },
      { name: "Reyes", is_primary: true, role: null, is_billing: false },
    ]);
    const { rows: [same] } = await c.query("select count(*)::int as n from client_group_members where id = $1", [g2.member_id]);
    expect(same).toEqual({ n: 1 });
  }));
});

describe("reconcile_business_groups (spec §5.4)", () => {
  it("one group per key, named by the oldest; blanks make nothing; two accounts make two; a second run returns zeros (mutation: order the distinct-on by c.created_at desc -> the naming case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_r_a_${RUN}`);
      const b = await seedAccount(c, `org_r_b_${RUN}`);
      const late = await contact(c, a, "Late", " acme roofing ", "2026-03-01T00:00:00Z");
      const old = await contact(c, a, "Old", "Acme Roofing", "2026-01-01T00:00:00Z");
      const tab = await contact(c, a, "Tab", "ACME ROOFING\t", "2026-02-01T00:00:00Z");
      const blanks = [await contact(c, a, "N", null), await contact(c, a, "E", ""), await contact(c, a, "S", "   "), await contact(c, a, "B", "\u00a0")];
      const other = await contact(c, b, "Bea", "Acme Roofing");
      // Scoped per account: a NULL scope would sweep every row the shared test database holds.
      const first = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      await call(c, "public.reconcile_business_groups($1)", [b]);
      const { rows: groups } = await c.query<{ account_id: string; name: string }>(
        "select account_id, name from client_groups where account_id = any($1::uuid[]) order by account_id", [[a, b]]);
      expect(groups.filter((g) => g.account_id === a)).toEqual([{ account_id: a, name: "Acme Roofing" }]);
      expect(groups.filter((g) => g.account_id === b)).toHaveLength(1);
      for (const ct of [late, old, tab]) expect(await companyOf(c, ct)).toBe("Acme Roofing");
      for (const ct of blanks) expect(await members(c, ct)).toEqual([]);
      expect(await companyOf(c, blanks[2]!)).toBe("   "); // left as it is
      expect(await members(c, other)).toHaveLength(1);
      expect(first).toMatchObject({ groups_created: 1, members_added: 3, respelled: 0 });
      const second = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      expect(second).toEqual({
        groups_created: 0, members_added: 0, members_replaced: 0, members_removed: 0, skipped_too_long: 0, respelled: 0 });
    }));
  it("repairs what an old build wrote directly: relinks a changed name, unlinks a cleared one, restores a respelling", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_r_${RUN}`);
      const ana = await contact(c, a, "Ana", "Acme Roofing");
      const luis = await contact(c, a, "Luis", "Acme Roofing");
      const eva = await contact(c, a, "Eva", "Acme Roofing");
      await call(c, "public.reconcile_business_groups($1)", [a]);
      await c.query("update contacts set company_name = 'Beta Pools' where id = $1", [ana]);
      await c.query("update contacts set company_name = null where id = $1", [luis]);
      await c.query("update contacts set company_name = 'ACME roofing' where id = $1", [eva]);
      const r = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      expect(r).toMatchObject({ members_replaced: 1, members_removed: 1, respelled: 1 });
      expect(await members(c, ana)).toEqual([{ name: "Beta Pools", is_primary: true, role: null, is_billing: false }]);
      expect(await members(c, luis)).toEqual([]);
      expect(await companyOf(c, eva)).toBe("Acme Roofing");
    }));
  it("skips a name too long to be a group and leaves its column alone", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_r_${RUN}`);
    const long = "L".repeat(130);
    const ct = await contact(c, a, "Lo", long);
    const r = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
    expect(r.skipped_too_long).toBe(1);
    expect(await companyOf(c, ct)).toBe(long);
  }));
});
