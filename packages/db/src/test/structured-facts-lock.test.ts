import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { TEST_ORG_ID_PREFIX } from "../org-id";

/**
 * 0095 (spec 4.1): every knowledge WRITE locks the account row FOR NO KEY UPDATE before it reads the latest
 * version, so two writes on one account queue and version numbers never collide. Proven directly:
 *  - while session A holds an open ensure that APPENDS, session B's own FOR NO KEY UPDATE on that row times out
 *    (55P03), and B can still insert a call that references the account (A5: FOR KEY SHARE does not conflict);
 *  - while A holds the row, B's save_voice_knowledge times out too (its lock comes before its stale check, so a
 *    deliberately stale base proves it: without the lock B would answer stale at once);
 *  - two concurrent ensures of one NEW payload make exactly one row: B waits, re-reads, finds A's payload, answers it;
 *  - the call-start fast path: an ensure whose payload equals the latest snapshot takes NO lock, so it answers while
 *    another session holds the row (plan review 2026-10-23, item 6);
 *  - a held row fails open: an ensure that must append gives up after its own lock_timeout of 2s (55P03), which the
 *    routes treat as unstamped. B's statement_timeout of 5s makes a missing lock_timeout fail as 57014, not hang.
 */
const URL = process.env.SUPABASE_DB_URL;
const RUN = Math.random().toString(36).slice(2, 10);
const conn = () => new Client({ connectionString: URL, connectionTimeoutMillis: 10_000 });
const ENSURE = "select public.ensure_knowledge_snapshot($1, $2::jsonb) as v";

async function seedAccount(c: Client, label: string): Promise<{ acct: string; phone: string }> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Facts lock') returning id",
    [agency!.id, `${TEST_ORG_ID_PREFIX}factslock_${label}_${RUN}`])).rows[0]!.id;
  await c.query("insert into voice_profiles (account_id) values ($1)", [acct]);
  const phone = (await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164) values ($1, $2) returning id",
    [acct, `+1557${String(1_000_000 + Math.floor(Math.random() * 8_999_999))}`])).rows[0]!.id;
  return { acct, phone };
}
async function cleanup(c: Client, acct: string | null) {
  if (!acct) return;
  await c.query("delete from calls where account_id = $1", [acct]);
  await c.query("delete from voice_profiles where account_id = $1", [acct]);
  await c.query("delete from phone_numbers where account_id = $1", [acct]);
  await c.query("delete from accounts where id = $1", [acct]);
}

describe("0095: knowledge writes serialise on the account row", () => {
  it("an open appending ensure holds the account row lock; a call insert on that account does not wait (mutation 14: drop `for no key update` from ensure -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const s = await seedAccount(seedC, "lock"); acct = s.acct;
      await a.query("begin");
      expect((await a.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ a: 1 })])).rows[0]!.v).toBe(1);
      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      await b.query("insert into calls (account_id, phone_number_id) values ($1, $2)", [acct, s.phone]); // A5
      await expect(b.query("select 1 from accounts where id = $1 for no key update", [acct])).rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {}); await b.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  it("two concurrent ensures of one new payload make exactly one row (mutation: drop the re-read equality after the lock -> B answers 2, FAILS; the fast-path drop is mutation 20)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      acct = (await seedAccount(seedC, "pair")).acct;
      await a.query("begin");
      expect((await a.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ p: 1 })])).rows[0]!.v).toBe(1);
      const bDone = b.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ p: 1 })]); // waits on A
      await new Promise((r) => setTimeout(r, 200));
      await a.query("commit");
      expect((await bDone).rows[0]!.v).toBe(1);
      expect((await seedC.query("select count(*)::int as n from voice_knowledge_snapshots where account_id = $1", [acct])).rows).toEqual([{ n: 1 }]);
    } finally {
      await a.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  it("save_voice_knowledge waits on the account row: with A's appending ensure open, B's save times out (mutation 19: drop `for no key update` from save_voice_knowledge -> B answers stale, FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      acct = (await seedAccount(seedC, "save")).acct;
      await a.query("begin");
      expect((await a.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ s: 1 })])).rows[0]!.v).toBe(1);
      await b.query("begin");
      await b.query("set local lock_timeout = '300ms'");
      // base 99 is deliberately stale: the lock comes before the stale check, so only a missing lock answers.
      await expect(b.query("select public.save_voice_knowledge($1, 'user_lock', $2::jsonb, $3::jsonb, 99) as r",
        [acct, JSON.stringify({ facts: "x" }), JSON.stringify({ v: 1 })])).rejects.toMatchObject({ code: "55P03" });
      await b.query("rollback");
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {}); await b.query("rollback").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  it("an equal payload answers without the lock: B's ensure returns the latest while A holds the row (mutation 20: lock before the first read -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      acct = (await seedAccount(seedC, "fast")).acct;
      expect((await seedC.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ f: 1 })])).rows[0]!.v).toBe(1); // committed
      await a.query("begin");
      await a.query("select 1 from accounts where id = $1 for no key update", [acct]);
      await b.query("set statement_timeout = '1s'");
      expect((await b.query<{ v: number }>(ENSURE, [acct, JSON.stringify({ f: 1 })])).rows[0]!.v).toBe(1);
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("reset statement_timeout").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  it("a held row fails open: an ensure that must append gives up after its own 2s lock_timeout with 55P03 (mutation 21: drop the function's lock_timeout -> 57014, FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      acct = (await seedAccount(seedC, "held")).acct;
      await a.query("begin");
      await a.query("select 1 from accounts where id = $1 for no key update", [acct]);
      await b.query("set statement_timeout = '5s'");
      await expect(b.query(ENSURE, [acct, JSON.stringify({ h: 1 })])).rejects.toMatchObject({ code: "55P03" });
      await a.query("rollback");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("reset statement_timeout").catch(() => {});
      await cleanup(seedC, acct);
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
