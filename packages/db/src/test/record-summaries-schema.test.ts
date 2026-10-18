import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback, actAs } from "./db";
import { TEST_ORG_ID_PREFIX } from "../org-id";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0087 (item 8a-2, spec 4.5; plan deviations 4-7): the record summary's cache. One row per customer per
 * language, same-account FK with cascade; read exactly when the reader can read the customer (Technicians:
 * assigned only); the client role writes nothing and cannot claim; the claim hands out one 30 s lease, says
 * fresh for an unchanged digest, and allows one forced claim a minute.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_rsm_${RUN}`;
const ORG_B = `org_rsmb_${RUN}`;
const SUB = { owner: `u_rsm_owner_${RUN}`, staff: `u_rsm_staff_${RUN}`, tech: `u_rsm_tech_${RUN}`, tech2: `u_rsm_tech2_${RUN}`, ownerB: `u_rsm_ownerb_${RUN}` } as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_rsm_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };
const D1 = "a".repeat(64);
const D2 = "b".repeat(64);
const CLAIM = "public.claim_record_summary(uuid, uuid, text, text, boolean)";

async function attempt<T extends object = Record<string, unknown>>(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query<T>(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
const claim = async (c: Client, acct: string, contact: string, digest = D1, force = false, language = "en") =>
  (await c.query<{ r: Record<string, unknown> }>(`select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, $3, $4, $5) as r`, [acct, contact, language, digest, force])).rows[0]!.r;
const write = (c: Client, acct: string, contact: string, language = "en", digest = D1) =>
  c.query(`insert into record_summaries (account_id, contact_id, language, body, input_digest, model, generated_at)
           values ($1, $2, $3, 'Booked for Tuesday.', $4, 'gpt-4o-mini', now())
           on conflict (account_id, contact_id, language) do update set body = excluded.body, input_digest = excluded.input_digest,
             model = excluded.model, generated_at = excluded.generated_at`, [acct, contact, language, digest]);

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RSM Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'RSM B',true) returning id", [agency!.id, ORG_B]);
  const u: Record<string, string> = {};
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (account: string, who: string | null, name: string) =>
    one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [account, name, who]);
  const mine = await ct(acct, u.tech!, "Mine");
  const theirs = await ct(acct, u.tech2!, "Theirs");
  const other = await ct(acctB, null, "Other");
  await write(c, acct, mine); await write(c, acct, theirs); await write(c, acctB, other);
  return { acct, acctB, mine, theirs, other };
}
async function readAs(c: Client, p: Who): Promise<string[]> {
  await actAs(c, claims(p));
  const { rows } = await c.query<{ contact_id: string }>("select contact_id from record_summaries order by contact_id");
  await c.query("reset role");
  return rows.map((r) => r.contact_id);
}

describe("0087: the table (spec 4.5)", () => {
  it("has exactly these columns (mutation: add a `prompt text` column -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select column_name as n from information_schema.columns where table_schema = 'public' and table_name = 'record_summaries' order by ordinal_position");
      expect(rows.map((r) => r.n)).toEqual(["id", "account_id", "contact_id", "language", "body", "input_digest", "model", "generated_at", "generating_until", "lease_id", "last_forced_at", "created_at"]);
    }));

  it("refuses a third language, an over-long body, a malformed digest and a half-written row (mutations: drop any one check -> its insert succeeds -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ins = (language: string, body: string | null, digest: string | null, model: string | null, at: string | null) =>
        attempt(c, "insert into record_summaries (account_id, contact_id, language, body, input_digest, model, generated_at) values ($1,$2,$3,$4,$5,$6,$7::timestamptz)",
          [s.acct, s.mine, language, body, digest, model, at]);
      await c.query("delete from record_summaries where contact_id = $1", [s.mine]);
      await expect(ins("fr", null, null, null, null)).rejects.toMatchObject({ code: "23514", constraint: "record_summaries_language_check" });
      await expect(ins("en", "x".repeat(2001), D1, "m", "2026-10-18T00:00:00Z")).rejects.toMatchObject({ code: "23514", constraint: "record_summaries_body_check" });
      await expect(ins("en", "ok", "A".repeat(64), "m", "2026-10-18T00:00:00Z")).rejects.toMatchObject({ code: "23514", constraint: "record_summaries_digest_check" });
      await expect(ins("en", "ok", null, "m", "2026-10-18T00:00:00Z")).rejects.toMatchObject({ code: "23514", constraint: "record_summaries_written_coherent" });
      await expect(attempt(c, "insert into record_summaries (account_id, contact_id, language, lease_id) values ($1,$2,'en',gen_random_uuid())", [s.acct, s.mine]))
        .rejects.toMatchObject({ code: "23514", constraint: "record_summaries_lease_coherent" });
      await ins("en", "x".repeat(2000), D1, "gpt-4o-mini", "2026-10-18T00:00:00Z");
      await expect(ins("en", null, null, null, null)).rejects.toMatchObject({ code: "23505", constraint: "record_summaries_one_per_language" });
      await ins("es", null, null, null, null);
    }));

  it("refuses another account's customer, and goes with its customer (spec 8.3; mutations: point the FK at contacts(id) alone -> the cross-account insert succeeds -> FAILS; drop on delete cascade -> the delete is refused -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "insert into record_summaries (account_id, contact_id, language) values ($1,$2,'es')", [s.acct, s.other]))
        .rejects.toMatchObject({ code: "23503", constraint: "record_summaries_contact_fkey" });
      await c.query("delete from contacts where id = $1", [s.theirs]);
      expect((await c.query("select 1 from record_summaries where contact_id = $1", [s.theirs])).rowCount).toBe(0);
    }));

  it("comes off with its account's other rows, before contacts (mutation: put it after contacts or drop it -> FAILS)", () => {
    const at = (t: string) => (ACCOUNT_OWNED_TABLES as readonly string[]).indexOf(t);
    expect(at("record_summaries")).toBeGreaterThan(-1);
    expect(at("record_summaries")).toBeLessThan(at("contacts"));
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});

describe("0087: who reads (spec 4.5, 8.3; G10)", () => {
  it("Owner and Staff read every row in their account, a Technician only assigned customers', the agency every row, another account's Owner none of ours (mutation: drop record_summaries_through_contact -> the Technician reads Theirs -> FAILS)", () =>
    withRollback(async (c) => {
      // The through-contact policy carries the ACCOUNT fence as well as the Technician's: it admits a row only
      // when its customer is readable, contacts' own RLS admits only the reader's account, and the composite FK
      // pins the row's account to its customer's. So widening member_read alone cannot let ownerB read ours,
      // and no mutation of member_read is named here (plan fix I2). member_read stays as defence in depth.
      const s = await seed(c);
      const sorted = (xs: string[]) => [...xs].sort();
      expect(await readAs(c, "owner")).toEqual(sorted([s.mine, s.theirs]));
      expect(await readAs(c, "staff")).toEqual(sorted([s.mine, s.theirs]));
      expect(await readAs(c, "tech")).toEqual([s.mine]);
      expect(await readAs(c, "tech2")).toEqual([s.theirs]);
      expect(await readAs(c, "ownerB")).toEqual([s.other]);
      expect(await readAs(c, "agency")).toEqual(sorted([s.mine, s.theirs, s.other]));
    }));

  it("a client token writes nothing and cannot claim; service_role holds all four (mutations: grant insert to authenticated -> FAILS; grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const has = async (r: string, p: string) =>
        (await c.query<{ h: boolean }>("select has_table_privilege($1, 'public.record_summaries', $2) as h", [r, p])).rows[0]!.h;
      for (const r of ["anon", "authenticated"]) for (const p of ["INSERT", "UPDATE", "DELETE"]) expect([r, p, await has(r, p)]).toEqual([r, p, false]);
      expect([await has("authenticated", "SELECT"), await has("anon", "SELECT")]).toEqual([true, false]);
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await has("service_role", p)).toBe(true);
      const ex = async (r: string) => (await c.query<{ h: boolean }>("select has_function_privilege($1, $2, 'execute') as h", [r, CLAIM])).rows[0]!.h;
      expect([await ex("anon"), await ex("authenticated"), await ex("service_role")]).toEqual([false, false, true]);
      const { rows: [f] } = await c.query<{ d: boolean; cfg: string[] }>("select prosecdef as d, proconfig as cfg from pg_proc where proname = 'claim_record_summary'");
      expect(f).toEqual({ d: true, cfg: ['search_path=""'] });
    }));
});

describe("0087: the claim (spec 4.5, 4.6; plan deviation 5)", () => {
  it("a missing row is created and won; a live lease is busy; a lapsed lease is won again (mutations: skip the live-lease test -> the second claim wins -> FAILS; compare generating_until < now() the wrong way -> the lapsed claim is busy -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const first = await claim(c, s.acct, s.mine, D2, false, "es");
      expect(first).toMatchObject({ status: "won" });
      expect(String(first.lease_id)).toMatch(/^[0-9a-f-]{36}$/);
      expect(await claim(c, s.acct, s.mine, D2, false, "es")).toEqual({ status: "busy" });
      await c.query("update record_summaries set generating_until = now() - interval '1 second' where contact_id = $1 and language = 'es'", [s.mine]);
      expect(await claim(c, s.acct, s.mine, D2, false, "es")).toMatchObject({ status: "won" });
    }));

  it("an unchanged digest is fresh; a changed one is won (mutation: drop the input_digest comparison -> the changed digest answers fresh -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acct, s.mine, D1)).toEqual({ status: "fresh" });
      expect(await claim(c, s.acct, s.mine, D2)).toMatchObject({ status: "won" });
    }));

  it("a forced claim wins over a fresh row once a minute (spec 4.6; mutations: drop the last_forced_at test -> the second force wins -> FAILS; never stamp last_forced_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.acct, s.mine, D1, true)).toMatchObject({ status: "won" });
      await c.query("update record_summaries set generating_until = null, lease_id = null where contact_id = $1", [s.mine]);
      expect(await claim(c, s.acct, s.mine, D1, true)).toEqual({ status: "too_soon" });
      await c.query("update record_summaries set last_forced_at = now() - interval '61 seconds' where contact_id = $1", [s.mine]);
      expect(await claim(c, s.acct, s.mine, D1, true)).toMatchObject({ status: "won" });
    }));

  it("a forced claim on a CHANGED digest wins even inside the cool-down, and does not restart it (plan fix I6; mutations: drop `and v_same` from the too_soon test -> too_soon -> FAILS; stamp last_forced_at on every forced win -> the stamp moves -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update record_summaries set last_forced_at = now() - interval '10 seconds' where contact_id = $1", [s.mine]);
      const { rows: [before] } = await c.query<{ t: string }>("select last_forced_at::text as t from record_summaries where contact_id = $1", [s.mine]);
      expect(await claim(c, s.acct, s.mine, D2, true)).toMatchObject({ status: "won" });
      const { rows: [after] } = await c.query<{ t: string }>("select last_forced_at::text as t from record_summaries where contact_id = $1", [s.mine]);
      expect(after!.t).toBe(before!.t);
    }));

  it("refuses nulls, a third language, a malformed digest and another account's customer (mutations: drop any guard -> FAILS; drop `p_digest is null` -> a null digest wins a lease -> FAILS; drop `p_force is null` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, null, 'en', $2, false)`, [s.acct, D1])).rejects.toMatchObject({ code: "22004" });
      // Review fix round: the two nulls the value guards do not catch on their own (a null digest passes
      // `char_length(...) <> 64 or ... ~ ...` as null, a null force falls through to the fresh/won branches).
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, 'es', null, false)`, [s.acct, s.mine])).rejects.toMatchObject({ code: "22004" });
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, 'es', $3, null)`, [s.acct, s.mine, D1])).rejects.toMatchObject({ code: "22004" });
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, 'fr', $3, false)`, [s.acct, s.mine, D1])).rejects.toMatchObject({ code: "22023" });
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, 'en', 'xyz', false)`, [s.acct, s.mine])).rejects.toMatchObject({ code: "22023" });
      await expect(attempt(c, `select ${CLAIM.replace(/\(.*\)$/, "")}($1, $2, 'es', $3, false)`, [s.acct, s.other, D1])).rejects.toMatchObject({ code: "23503" });
    }));
});

describe("0087: one lease under two sessions (spec 8.3; I4)", () => {
  // An OUTCOME test, as document-shares-schema.test.ts's. A first takes the row's lock with a plain
  // `select … for update` and does NOT claim yet; B's claim is then seen waiting; only then does A claim
  // (inside the same transaction) and commit. With `for update` in the function, B waits at its own
  // `select … for update`, then reads A's lease and answers busy. Without it, B's plain select reads the
  // row as it was (no lease), B waits at its UPDATE instead, re-checks `s.id = v.id` after A commits, and
  // answers won. (Plan fix I1, review 2026-10-18: the earlier shape, where A claimed BEFORE B started,
  // passed with `for update` dropped, because B already queued behind A's INSERT … ON CONFLICT, which
  // serialises that setup by itself. This shape takes the insert out of the race: the row already exists.)
  const conn = () => new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
  async function waitUntilBlocked(watch: Client, pid: number): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const { rows } = await watch.query<{ w: string | null }>("select wait_event_type as w from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.w === "Lock") return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`session ${pid} never waited on a lock`);
  }
  it("a claim that waited for another answers busy (mutation: drop `for update` -> B answers won -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = await one(seedC, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'RSM Lock') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}rsmlock_${RUN}`]);
      const contact = await one(seedC, "insert into contacts (account_id, first_name) values ($1,'Lock') returning id", [acct]);
      await write(seedC, acct, contact, "en", D1);
      const { rows: [pb] } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");
      await a.query("begin");
      await a.query("select 1 from record_summaries where account_id = $1 and contact_id = $2 and language = 'en' for update", [acct, contact]);
      const waiting = claim(b, acct, contact, D2); // no lock_timeout: B waits as long as A holds the row
      await waitUntilBlocked(seedC, pb!.pid);
      expect(await claim(a, acct, contact, D2)).toMatchObject({ status: "won" });
      await a.query("commit");
      expect(await waiting).toEqual({ status: "busy" });
    } finally {
      await a.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from contacts where account_id = $1", [acct]); // record_summaries cascade
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });

  // Review fix round (Minor, taken before apply): the customer goes between the claim's insert and its
  // locked select. A holds the row's lock; B's `insert ... do nothing` meets the live committed row (no
  // wait, no FK check) and then waits at `select ... for update`; A deletes the customer (the row goes by
  // cascade) and commits; B's locked select finds nothing. Without the `if not found` guard B answers
  // won with a lease on no row. The FK's own 23503 never names the function, so it cannot pass this.
  it("a claim whose customer vanished while it waited is refused, not won (mutation: drop `if not found` -> B answers won -> FAILS)", async () => {
    const seedC = conn(); const a = conn(); const b = conn();
    await Promise.all([seedC.connect(), a.connect(), b.connect()]);
    let acct: string | null = null;
    try {
      const { rows: [agency] } = await seedC.query<{ id: string }>("select id from agencies limit 1");
      acct = await one(seedC, "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'RSM Gone') returning id", [agency!.id, `${TEST_ORG_ID_PREFIX}rsmgone_${RUN}`]);
      const contact = await one(seedC, "insert into contacts (account_id, first_name) values ($1,'Gone') returning id", [acct]);
      await write(seedC, acct, contact, "en", D1);
      const { rows: [pb] } = await b.query<{ pid: number }>("select pg_backend_pid() as pid");
      await a.query("begin");
      await a.query("select 1 from record_summaries where account_id = $1 and contact_id = $2 and language = 'en' for update", [acct, contact]);
      const waiting = claim(b, acct, contact, D2).then((r) => ({ ok: r }), (e: unknown) => ({ err: e }));
      await waitUntilBlocked(seedC, pb!.pid);
      await a.query("delete from contacts where id = $1", [contact]);
      await a.query("commit");
      const got = await waiting;
      expect(got).toMatchObject({ err: { code: "23503", message: expect.stringContaining("claim_record_summary") } });
      expect((await seedC.query("select 1 from record_summaries where contact_id = $1", [contact])).rowCount).toBe(0);
    } finally {
      await a.query("rollback").catch(() => {});
      if (acct) {
        await seedC.query("delete from contacts where account_id = $1", [acct]);
        await seedC.query("delete from accounts where id = $1", [acct]);
      }
      await Promise.all([seedC.end(), a.end(), b.end()]);
    }
  });
});
