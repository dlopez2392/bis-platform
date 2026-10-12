import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";
import { TEST_ORG_ID_PREFIX } from "../org-id";

const RUN = Math.random().toString(36).slice(2, 10);
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Groups Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string) =>
  (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,$2) returning id", [acct, first])).rows[0]!.id;
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
  // Final review I-B: the snapshot comes back from the browser. A forged one naming a household (one a
  // Technician cannot see) or another account's group must join nothing.
  it("undo refuses a snapshot naming a household or another account's group, and joins nothing (mutation: drop the business-kind check from undo_set_business -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_f_a_${RUN}`);
      const b = await seedAccount(c, `org_f_b_${RUN}`);
      const ana = await contact(c, a, "Ana");
      const luis = await contact(c, a, "Luis");
      const home = await call(c, "public.create_group_with_member($1,$2,'household','Garcia')", [a, luis]) as { group_id: string };
      const bea = await contact(c, b, "Bea");
      const theirs = await call(c, "public.create_group_with_member($1,$2,'business','Acme Roofing')", [b, bea]) as { group_id: string };
      const forged = (groupId: string) => JSON.stringify({
        id: "00000000-0000-4000-8000-00000000f0f0", account_id: a, client_group_id: groupId, contact_id: ana,
        role: null, is_primary: false, is_billing: false, created_at: "2026-01-01T00:00:00Z" });
      expect(await call(c, "public.undo_set_business($1,$2,null,$3)", [a, ana, forged(home.group_id)])).toBe("not_found");
      expect(await call(c, "public.undo_set_business($1,$2,null,$3)", [a, ana, forged(theirs.group_id)])).toBe("not_found");
      expect(await members(c, ana)).toEqual([]);
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

// reconcile_business_groups (spec §5.4) and its tests went with 0072 (S-02 G9), after its last run:
// company_name is read-only now, so there is no direct write left to fold in.

/*
 * Two sessions at once. Each write function serialises on the contact row (app.lock_contact); these
 * prove that what it decides AFTER the lock is read after the lock. The rows must be committed (a
 * second session cannot see another's uncommitted seed), so the account carries the sweep's org prefix
 * and is removed in finally; a killed run's leftover is cleared by the next run's global setup.
 */
const connect = async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  await c.connect();
  return c;
};
let committedN = 0;
async function withCommittedAccount(fn: (c: Client, acct: string) => Promise<void>) {
  const c = await connect();
  let acct = "";
  try {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    acct = (await c.query<{ id: string }>(
      "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Groups Race Co') returning id",
      [agency!.id, `${TEST_ORG_ID_PREFIX}grace_${RUN}_${committedN++}`])).rows[0]!.id;
    await fn(c, acct);
  } finally {
    if (acct) {
      await c.query("delete from contacts where account_id = $1", [acct]); // memberships cascade
      await c.query("delete from accounts where id = $1", [acct]); // groups cascade
    }
    await c.end();
  }
}
const pidOf = async (c: Client) => (await c.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
/**
 * Waits until session `pid` is blocked on a lock, read from pg_stat_activity, rather than sleeping a
 * fixed time and hoping (final review minor 12). Its own connection, one autocommit read per poll:
 * pg_stat_activity is snapshotted for the length of a transaction, so a poll from inside an open one
 * would keep reading the first answer.
 */
async function waitUntilBlocked(pid: number, timeoutMs = 15_000) {
  const watcher = await connect();
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { rows } = await watcher.query<{ blocked: boolean }>(
        "select coalesce((select wait_event_type = 'Lock' from pg_stat_activity where pid = $1), false) as blocked", [pid]);
      if (rows[0]!.blocked) return;
      if (Date.now() > deadline) throw new Error(`session ${pid} never blocked on a lock`);
      await new Promise((res) => setTimeout(res, 25));
    }
  } finally { await watcher.end(); }
}
/** `first` runs and holds its locks in an open transaction; `second` starts and must block on them;
 *  then `first` commits. Returns both results (settled, so a 40P01 is a value, not a throw). */
async function race(first: (c: Client) => Promise<unknown>, second: (c: Client) => Promise<unknown>) {
  const c1 = await connect(); const c2 = await connect();
  try {
    await c1.query("begin"); await c2.query("begin");
    const r1 = await first(c1);
    const c2pid = await pidOf(c2);
    const p2 = second(c2).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
    await waitUntilBlocked(c2pid); // c2 is now blocked on the contact row
    await c1.query("commit");
    const r2 = await p2;
    await c2.query(r2.ok ? "commit" : "rollback");
    return { r1, r2 };
  } finally { await c1.end(); await c2.end(); }
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ r: unknown }>(`select ${sql} as r`, args)).rows[0]!.r;

describe("two sessions at once (I2, minors 3 and 4)", () => {
  it("make main on a membership another session just removed returns not_found and leaves one main (mutation: drop the re-read after the lock in set_primary_group_membership -> FAILS)", () =>
    withCommittedAccount(async (c, acct) => {
      const ana = await contact(c, acct, "Ana");
      await one(c, "public.create_group_with_member($1,$2,'household','Garcia')", [acct, ana]);
      const reyes = await one(c, "public.create_group_with_member($1,$2,'household','Reyes')", [acct, ana]) as { member_id: string };
      const { r1, r2 } = await race(
        (c1) => one(c1, "public.remove_group_membership($1,$2)", [acct, reyes.member_id]),
        (c2) => one(c2, "public.set_primary_group_membership($1,$2)", [acct, reyes.member_id]));
      expect(r1).toMatchObject({ status: "ok" });
      expect(r2).toEqual({ ok: true, v: { status: "not_found" } });
      expect(await members(c, ana)).toEqual([{ name: "Garcia", is_primary: true, role: null, is_billing: false }]);
    }));
  it("remove after another session made it main snapshots it AS main, so Undo restores the main (mutation: take the remove snapshot from the read before the lock -> FAILS)", () =>
    withCommittedAccount(async (c, acct) => {
      const ana = await contact(c, acct, "Ana");
      await one(c, "public.create_group_with_member($1,$2,'household','Garcia')", [acct, ana]);
      const reyes = await one(c, "public.create_group_with_member($1,$2,'household','Reyes')", [acct, ana]) as { member_id: string };
      const { r2 } = await race(
        (c1) => one(c1, "public.set_primary_group_membership($1,$2)", [acct, reyes.member_id]),
        (c2) => one(c2, "public.remove_group_membership($1,$2)", [acct, reyes.member_id]));
      expect(r2.ok).toBe(true);
      const removed = (r2 as { v: { status: string; removed: { is_primary: boolean } } }).v;
      expect(removed.status).toBe("ok");
      expect(removed.removed.is_primary).toBe(true);
      expect(await one(c, "public.restore_group_membership($1,$2)", [acct, JSON.stringify(removed.removed)])).toBe("ok");
      expect(await members(c, ana)).toEqual([
        { name: "Garcia", is_primary: false, role: null, is_billing: false },
        { name: "Reyes", is_primary: true, role: null, is_billing: false },
      ]);
    }));
  it("two batches naming the same contacts in opposite orders both finish, no deadlock (mutation: process p_contact_ids in input order -> one FAILS 40P01)", () =>
    withCommittedAccount(async (c, acct) => {
      const [x, y] = [await contact(c, acct, "X"), await contact(c, acct, "Y")].sort() as [string, string];
      const holder = await connect(); const c1 = await connect(); const c2 = await connect();
      try {
        // holder takes x, so batch 1 ([x, y]) waits on x; batch 2 ([y, x]) then starts. In input order it
        // would lock y and wait on x, and once holder lets go batch 1 would wait on y: a deadlock.
        await holder.query("begin");
        await holder.query("select 1 from contacts where id = $1 for update", [x]);
        const settle = (p: Promise<unknown>) => p.then(() => "done", (e: { code?: string }) => e.code ?? "error");
        const [pid1, pid2] = [await pidOf(c1), await pidOf(c2)];
        const p1 = settle(one(c1, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [acct, [x, y], ["Acme", "Acme"]]));
        await waitUntilBlocked(pid1); // batch 1 waits on x
        const p2 = settle(one(c2, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [acct, [y, x], ["Beta", "Beta"]]));
        await waitUntilBlocked(pid2); // batch 2 waits too: on x in id order (on y behind batch 1 in input order)
        await holder.query("commit");
        expect(await Promise.all([p1, p2])).toEqual(["done", "done"]);
      } finally {
        await holder.query("rollback").catch(() => undefined);
        await holder.end(); await c1.end(); await c2.end();
      }
      // Whichever batch went last wrote both rows: the two were never interleaved.
      const both = [await companyOf(c, x), await companyOf(c, y)];
      expect([["Acme", "Acme"], ["Beta", "Beta"]]).toContainEqual(both);
    }));
});

describe("set_contacts_business result order", () => {
  it("answers in the order it was asked, whatever order it works in (mutation: return results in processing order -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_f_${RUN}`);
      const [lo, hi] = [await contact(c, a, "Lo"), await contact(c, a, "Hi")].sort() as [string, string];
      const r = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [hi, lo], ["Acme", "x".repeat(121)]]) as Array<Record<string, unknown>>;
      expect(r.map((x) => [x.contact_id, x.status])).toEqual([[hi, "ok"], [lo, "too_long"]]);
      expect(await companyOf(c, hi)).toBe("Acme");
    }));
});
