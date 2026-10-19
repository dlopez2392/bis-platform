import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";
import { TEST_ORG_ID_PREFIX } from "../org-id";

/**
 * 0088's BRIDGE (item 8b-1, spec 4.6 and 8.2; plan Task 1): the copy of today's call_proposals rows, the
 * mirror that copies every old-code write into proposals, and the guard that refuses an old-code
 * decision once the new code has decided. THIS FILE IS DELETED WITH THE BRIDGE IN 8b-2 (0089 drops the
 * copy function, both triggers and call_proposals itself).
 *
 * Seeding with the triggers off (plan reviewer note 4): `alter table ... disable trigger` locks
 * call_proposals against every other writer until the withRollback ends. vitest runs packages/db files in
 * parallel, so another file that writes call_proposals (or deletes calls, which cascades into it) waits
 * for the length of one case. Every case that disables a trigger therefore does only seed, enable, call
 * and assert.
 *
 * Every case asserts an error BY NAME (call_proposals_superseded vs call_proposals_mirror_missed): with
 * the guard weakened the old update often still fails, under the mirror's name (plan reviewer note 1).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const DIGITS = () => Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
const offSql = "alter table public.call_proposals disable trigger call_proposals_mirror, disable trigger call_proposals_guard";
const onSql = "alter table public.call_proposals enable trigger call_proposals_mirror, enable trigger call_proposals_guard";
/** The old code's Accept, exactly as call-proposals.ts:241-244 builds it (plan deviation 12). */
const OLD_ACCEPT = "update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_old' where account_id = $1 and id = $2 and status = 'pending'";
/** The old code's revert of its own Accept. */
const OLD_REVERT = "update call_proposals set status = 'pending', decided_at = null, decided_by = null where id = $1 and status = 'accepted' and decided_by = 'user_old'";
/** The new code's compare-and-swap. */
const NEW_ACCEPT = "update proposals set status = 'accepted', decided_at = now(), decided_by = 'user_new', applied_payload = payload where id = $1 and status = 'pending'";

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
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const cp = async (c: Client, acct: string, call: string, contact: string | null, status = "pending", kind = "task") =>
  one(c,
    `insert into call_proposals (account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by)
     values ($1, $2, $3, $4, '{"title":"Send the quote","dueAt":null}', 'I need a quote', $5,
             case when $5 = 'pending' then null else now() end, case when $5 = 'pending' then null else 'user_old' end)
     returning id`, [acct, call, contact, kind, status]);

/** Accounts A and B, each with a contact, a number and a call. A's call was in Spanish. */
async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const side = async (label: string, language: string) => {
    const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
      [agency!.id, `org_prb${label}_${RUN}`, `PRB ${label}`]);
    const contact = await one(c, "insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
    const phone = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, `+1999${DIGITS()}`]);
    const call = await one(c, "insert into calls (account_id, phone_number_id, contact_id, caller_e164, language) values ($1,$2,$3,'+19565550142',$4) returning id",
      [acct, phone, contact, language]);
    return { acct, contact, call };
  };
  return { a: await side("a", "es"), b: await side("b", "en") };
}
type Row = { id: string; status: string; decided_at: Date | null; decided_by: string | null };
const proposal = async (c: Client, id: string) => (await c.query<{
  status: string; decided_by: string | null; applied_payload: unknown; payload: unknown; expires_at: Date; source: string;
  evidence_lang: string | null; evidence_ref: unknown; created_at: Date; decided_at: Date | null;
}>("select * from proposals where id = $1", [id])).rows[0];
const countIn = async (c: Client, table: string, ids: string[]) =>
  Number((await c.query<{ n: string }>(`select count(*) as n from ${table} where id = any($1::uuid[])`, [ids])).rows[0]!.n);
/** The other committed call_proposals rows a parallel suite may hold while this case runs; the trigger
 *  toggle's lock keeps them still, so the copy's answer is ours plus exactly these. */
async function othersBy(c: Client, mine: string[]) {
  const { rows } = await c.query<{ status: string; n: string }>(
    "select status, count(*) as n from call_proposals where id <> all($1::uuid[]) group by status", [mine]);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}
const plus = (a: Record<string, number>, b: Record<string, number>) => {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
};
const total = (a: Record<string, number>) => Object.values(a).reduce((x, y) => x + y, 0);

/** Seeds the four rows for the copy cases with the triggers off; returns their ids. One is 40 days old. */
async function seedForCopy(c: Client) {
  await c.query(offSql);
  const s = await seed(c);
  const ids = {
    pending: await cp(c, s.a.acct, s.a.call, s.a.contact),
    accepted: await cp(c, s.a.acct, s.a.call, s.a.contact, "accepted"),
    dismissed: await cp(c, s.a.acct, s.a.call, s.a.contact, "dismissed"),
    pending2: await cp(c, s.a.acct, s.a.call, s.a.contact, "pending", "contact_field"),
  };
  await c.query("update call_proposals set created_at = now() - interval '40 days' where id = $1", [ids.dismissed]);
  return { s, ids, all: Object.values(ids) };
}

describe("0088: the copy (spec 4.6; seeded with the mirror and guard off, spec 8.2)", () => {
  it("copies every row by status, with ids, decisions, applied_payload, evidence and a fresh 30-day expiry (mutations: map accepted to pending -> FAILS; expires_at = cp.created_at + 30 days -> the 40-day-old row FAILS)", () =>
    withRollback(async (c) => {
      const { ids, all } = await seedForCopy(c);
      expect(await countIn(c, "proposals", all), "proposals held none of the seeded ids before the copy").toBe(0);
      await c.query(onSql);
      const others = await othersBy(c, all);
      const r = (await c.query<{ r: unknown }>("select app.copy_call_proposals() as r")).rows[0]!.r;
      expect(r).toEqual({ copied: 4, skipped: total(others), by_status: plus(others, { pending: 2, accepted: 1, dismissed: 1 }) });

      const { rows } = await c.query<Row & { same: boolean; applied: boolean; ref: unknown; lang: string; fresh: boolean }>(
        `select p.id, p.status, p.decided_at, p.decided_by,
                (p.status, p.decided_at, p.decided_by) is not distinct from (q.status, q.decided_at, q.decided_by) as same,
                (p.applied_payload is not distinct from case when q.status = 'accepted' then q.payload end) as applied,
                p.evidence_ref as ref, p.evidence_lang as lang,
                abs(extract(epoch from p.expires_at - (greatest(q.created_at, now()) + interval '30 days'))) < 1 as fresh
           from proposals p join call_proposals q on q.id = p.id where p.id = any($1::uuid[]) order by p.id`, [all]);
      expect(rows.map((x) => x.id)).toEqual([...all].sort());
      for (const x of rows) {
        expect(x.same, `${x.id} keeps its status and decision`).toBe(true);
        expect(x.applied, `${x.id} applied_payload`).toBe(true);
        expect(x.ref, `${x.id} evidence_ref`).toEqual({});
        expect(x.lang, `${x.id} evidence_lang`).toBe("es");
        expect(x.fresh, `${x.id} expires 30 days from the copy (P19)`).toBe(true);
      }
      const statusOf = Object.fromEntries(rows.map((x) => [x.id, x.status]));
      expect(statusOf).toEqual({ [ids.pending]: "pending", [ids.accepted]: "accepted", [ids.dismissed]: "dismissed", [ids.pending2]: "pending" });
      expect((await proposal(c, ids.accepted))!.applied_payload).toEqual({ title: "Send the quote", dueAt: null });
    }));

  it("a second call copies nothing new (mutation: drop on conflict (id) do nothing -> the second call raises 23505 -> FAILS)", () =>
    withRollback(async (c) => {
      const { all } = await seedForCopy(c);
      await c.query(onSql);
      const others = await othersBy(c, all);
      await c.query("select app.copy_call_proposals()");
      const r = (await c.query<{ r: unknown }>("select app.copy_call_proposals() as r")).rows[0]!.r;
      expect(r).toEqual({ copied: 0, skipped: 4 + total(others), by_status: plus(others, { pending: 2, accepted: 1, dismissed: 1 }) });
    }));

  // A post-check could never fail here: the composite FK would refuse the insert first. So the pre-check
  // must raise by its own name, before the insert (spec 4.6 step 1, probe :366).
  it("refuses a row whose call belongs to another account, by name (mutation: drop the pre-check -> the insert meets proposals_call_fkey -> FAILS)", () =>
    withRollback(async (c) => {
      await c.query(offSql);
      const s = await seed(c);
      const good = await cp(c, s.a.acct, s.a.call, s.a.contact);
      const bad = await cp(c, s.a.acct, s.b.call, null);
      await c.query(onSql);
      expect(await countIn(c, "proposals", [good, bad]), "nothing mirrored").toBe(0);
      await expect(attempt(c, "select app.copy_call_proposals()"))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^proposals_copy_cross_account: 1 rows$/) });
      expect(await countIn(c, "proposals", [good, bad])).toBe(0);
    }));

  // The post-check (spec 4.6 step 3). A mirrored row the new code then decided in proposals alone leaves
  // the two tables with different statuses for one id; the insert skips it (on conflict), so only the
  // post-check can see it. Triggers on throughout: nothing here is seeded around the mirror.
  it("refuses, by name, when a copied id's status differs from its source (mutation: the post-check's `if` -> `if false` -> the copy returns normally -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      expect((await c.query(NEW_ACCEPT, [id])).rowCount).toBe(1);
      await expect(c.query("select app.copy_call_proposals()"))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^proposals_copy_mismatch: /) });
    }));

  it("refuses a row whose contact belongs to another account, by name (mutation: drop the contact half of the pre-check -> FAILS)", () =>
    withRollback(async (c) => {
      await c.query(offSql);
      const s = await seed(c);
      const bad = await cp(c, s.a.acct, s.a.call, s.b.contact);
      await c.query(onSql);
      expect(await countIn(c, "proposals", [bad]), "nothing mirrored").toBe(0);
      await expect(attempt(c, "select app.copy_call_proposals()"))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^proposals_copy_cross_account: 1 rows$/) });
    }));
});

describe("0088: the mirror (spec 4.6)", () => {
  it("an old-code insert appears in proposals, pending, with the call's language and a 30-day expiry (mutation: drop the insert branch -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      const { rows } = await c.query(
        `select p.source, p.status, p.evidence_lang, p.evidence_ref, p.contact_id, p.decided_at, p.decided_by, p.applied_payload,
                p.created_at = q.created_at as same_created, p.expires_at = q.created_at + interval '30 days' as expires
           from proposals p join call_proposals q on q.id = p.id where p.id = $1`, [id]);
      expect(rows).toEqual([{
        source: "call", status: "pending", evidence_lang: "es", evidence_ref: {}, contact_id: s.a.contact,
        decided_at: null, decided_by: null, applied_payload: null, same_created: true, expires: true,
      }]);
    }));

  it("an old-code Accept succeeds and sets applied_payload, leaving expires_at alone (mutation: the update branch skips applied_payload -> 23514 proposals_applied_when_accepted -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      const before = (await proposal(c, id))!.expires_at;
      expect((await c.query(OLD_ACCEPT, [s.a.acct, id])).rowCount).toBe(1);
      const p = (await proposal(c, id))!;
      expect({ status: p.status, by: p.decided_by, applied: p.applied_payload, expires: p.expires_at.toISOString() })
        .toEqual({ status: "accepted", by: "user_old", applied: { title: "Send the quote", dueAt: null }, expires: before.toISOString() });
    }));

  it("an old-code revert of its own Accept clears applied_payload (mutation: keep p.applied_payload on a revert -> 23514 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      const before = (await proposal(c, id))!.expires_at;
      expect((await c.query(OLD_ACCEPT, [s.a.acct, id])).rowCount).toBe(1);
      expect((await c.query(OLD_REVERT, [id])).rowCount).toBe(1);
      const p = (await proposal(c, id))!;
      expect({ status: p.status, at: p.decided_at, by: p.decided_by, applied: p.applied_payload, expires: p.expires_at.toISOString() })
        .toEqual({ status: "pending", at: null, by: null, applied: null, expires: before.toISOString() });
    }));

  it("a mirror that cannot write blocks the old write (mutation: swallow the mirror's insert error -> the row lands in call_proposals alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c,
        `insert into call_proposals (account_id, call_id, contact_id, kind, payload, evidence)
         values ($1, $2, $3, 'task', '{"title":"Send the quote","dueAt":null}', 'I need a quote')`, [s.a.acct, s.a.call, s.b.contact]))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"proposals_contact_fkey"/) });
      expect((await c.query("select 1 from call_proposals where contact_id = $1", [s.b.contact])).rowCount).toBe(0);
    }));
});

describe("0088: the guard (spec 4.6, C1)", () => {
  it("refuses an old-code Accept once the new code accepted, by name, and nothing moves (mutation: drop the guard trigger -> the mirror raises call_proposals_mirror_missed instead -> FAILS on the name)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      const tasks = async () => Number((await c.query<{ n: string }>("select count(*) as n from tasks where account_id = $1", [s.a.acct])).rows[0]!.n);
      const tasksBefore = await tasks();
      await c.query("set local role service_role");
      expect((await c.query(NEW_ACCEPT, [id])).rowCount).toBe(1);
      await expect(attempt(c, OLD_ACCEPT, [s.a.acct, id]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^call_proposals_superseded: /) });
      expect((await proposal(c, id))!.decided_by).toBe("user_new");
      expect((await c.query("select status from call_proposals where id = $1", [id])).rows).toEqual([{ status: "pending" }]);
      await c.query("reset role");
      expect(await tasks()).toBe(tasksBefore);
    }));

  it("lets an old-code revert of its own Accept through (mutation: raise whenever v_status <> 'pending' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      expect((await c.query(OLD_ACCEPT, [s.a.acct, id])).rowCount).toBe(1);
      expect((await c.query(OLD_REVERT, [id])).rowCount).toBe(1);
    }));

  it("refuses over a missing proposals row, by name (mutation (a): `if v_status <> old.status` -> the mirror raises call_proposals_mirror_missed instead -> FAILS on the name)", () =>
    withRollback(async (c) => {
      await c.query(offSql);
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      await c.query(onSql);
      await expect(attempt(c, OLD_ACCEPT, [s.a.acct, id]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^call_proposals_superseded: /) });
    }));

  it("refuses over a missing proposals row with the mirror off, so the guard alone answers (mutation (a) -> the update lands -> FAILS)", () =>
    withRollback(async (c) => {
      await c.query(offSql);
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      await c.query("alter table public.call_proposals enable trigger call_proposals_guard");
      await expect(attempt(c, OLD_ACCEPT, [s.a.acct, id]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^call_proposals_superseded: /) });
    }));

  it("the mirror's own status condition, with the guard off, refuses by its name and keeps the new decision (mutation: drop `and p.status is not distinct from old.status` -> the old update overwrites decided_by -> FAILS)", () =>
    withRollback(async (c) => {
      await c.query("alter table public.call_proposals disable trigger call_proposals_guard");
      const s = await seed(c);
      const id = await cp(c, s.a.acct, s.a.call, s.a.contact);
      expect((await c.query(NEW_ACCEPT, [id])).rowCount).toBe(1);
      await expect(attempt(c, OLD_ACCEPT, [s.a.acct, id]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/^call_proposals_mirror_missed: /) });
      expect((await proposal(c, id))!.decided_by).toBe("user_new");
    }));
});

describe("0088: the guard's lock, two sessions (spec 4.6, 8.2 R1)", () => {
  // Real commits, not withRollback: two transactions must see each other. Every committed row is deleted
  // in `finally`, and the account's org id carries the fixture prefix, so the sweep takes a killed run's.
  const conn = () => new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  /** Polls until `pid` is waiting on a lock; throws after ~5 s so a run that never blocks fails loudly. */
  async function waitUntilBlocked(watch: Client, pid: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await watch.query<{ w: string | null }>("select wait_event_type as w from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.w === "Lock") return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`session ${pid} never waited on a lock`);
  }
  async function twoSessions(label: string, body: (x: { seedC: Client; a: Client; b: Client; acct: string; id: string }) => Promise<void>) {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = await one(seedC, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'PRB Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}prblock${label}_${RUN}`]);
      const contact = await one(seedC, "insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct]);
      const phone = await one(seedC, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, `+1999${DIGITS()}`]);
      const call = await one(seedC, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [acct, phone, contact]);
      const id = await cp(seedC, acct, call, contact);
      expect(await countIn(seedC, "proposals", [id]), "the mirror made the twin").toBe(1);
      await body({ seedC, a, b, acct, id });
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      if (acct) {
        for (const sql of [
          "delete from call_proposals where account_id = $1", "delete from proposals where account_id = $1", "delete from calls where account_id = $1",
          "delete from phone_numbers where account_id = $1", "delete from contacts where account_id = $1", "delete from accounts where id = $1",
        ]) await seedC.query(sql, [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  }
  const pid = async (x: Client) => (await x.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
  const OLD_ACCEPT_BY_ID = "update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_old' where id = $1 and status = 'pending'";

  it("the new code first: the old update waits on the guard's lock, then is refused by name (mutation: the guard reads without for update -> the mirror raises call_proposals_mirror_missed instead -> FAILS on the name)", () =>
    twoSessions("n", async ({ seedC, a, b, id }) => {
      const pb = await pid(b);
      await a.query("begin");
      await a.query("set local role service_role");
      expect((await a.query(NEW_ACCEPT, [id])).rowCount).toBe(1);
      await b.query("set role service_role");
      const waiting = b.query(OLD_ACCEPT_BY_ID, [id]).then(() => "ok", (e: Error) => String(e.message));
      await waitUntilBlocked(seedC, pb);
      await a.query("commit");
      expect(await waiting).toMatch(/^call_proposals_superseded: /);
      expect((await seedC.query("select decided_by from proposals where id = $1", [id])).rows).toEqual([{ decided_by: "user_new" }]);
      expect((await seedC.query("select status from call_proposals where id = $1", [id])).rows).toEqual([{ status: "pending" }]);
    }));

  it("the old code first: the new compare-and-swap waits, then matches no row and overwrites nothing (probe: drop the CAS's `and status = 'pending'` -> rowCount 1 -> FAILS)", () =>
    twoSessions("o", async ({ seedC, a, b, acct, id }) => {
      const pa = await pid(a);
      await b.query("begin");
      await b.query("set local role service_role");
      expect((await b.query(OLD_ACCEPT, [acct, id])).rowCount).toBe(1);
      await a.query("begin");
      await a.query("set local role service_role");
      const waiting = a.query(NEW_ACCEPT, [id]);
      await waitUntilBlocked(seedC, pa);
      await b.query("commit");
      expect((await waiting).rowCount).toBe(0);
      await a.query("commit");
      expect((await seedC.query("select decided_by from proposals where id = $1", [id])).rows).toEqual([{ decided_by: "user_old" }]);
    }));
});
