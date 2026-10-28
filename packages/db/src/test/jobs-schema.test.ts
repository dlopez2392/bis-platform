import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0102 (F-196 part 1): public.jobs, claim_jobs and sweep_jobs. Spec
 * docs/superpowers/specs/2026-10-28-background-job-runner-design.md section 7;
 * plan docs/superpowers/plans/2026-10-28-background-job-runner.md Task 1.
 *
 * withRollback for every case but the claim race, which needs two sessions
 * that both see COMMITTED rows; it deletes its own rows by kind in a finally.
 * Every kind here is `t<RUN>.<tag>`, so no case claims, counts or sweeps
 * another run's rows by accident, and the one global action (the sweep, and
 * the dead-letter half of the claim) is judged on this run's rows only.
 *
 * RED BEFORE APPLY (the replica's `pre`): every database case (42P01 on
 * public.jobs, 42883 on the functions), and the teardown-list case (no
 * "jobs" entry yet). GREEN AFTER APPLY: all of them.
 *
 * schema-grants-guard.test.ts already fails if anon or authenticated gains a
 * WRITE on this table; it does not look at SELECT, column grants, EXECUTE or
 * service_role, which is what the first block pins.
 */
const TABLE = "public.jobs";
const CLAIM = "public.claim_jobs(text[], integer)";
const SWEEP = "public.sweep_jobs(integer)";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const kind = (tag: string) => `t${RUN}.${tag}`;
const LEASE_EXPIRED = "the worker stopped before finishing (lease expired)";

type Cols = "kind" | "account_id" | "idempotency_key" | "payload" | "state" | "run_after" | "attempts"
  | "max_attempts" | "timeout_ms" | "claim_token" | "lease_until" | "last_error" | "finished_at";
/** Raw SQL expressions per column; the defaults make a valid, due, platform `queued` row. Test literals only. */
type Row = Partial<Record<Cols, string>>;
const insertSql = (tag: string, over: Row = {}) => {
  const cols: Row = { kind: `'${kind(tag)}'`, idempotency_key: "'k_' || gen_random_uuid()", max_attempts: "3", timeout_ms: "5000", ...over };
  return `insert into public.jobs (${Object.keys(cols).join(", ")}) values (${Object.values(cols).join(", ")}) returning id`;
};
async function job(c: Client, tag: string, over: Row = {}): Promise<string> {
  return (await c.query<{ id: string }>(insertSql(tag, over))).rows[0]!.id;
}
/** A running row: a lease and a token, as jobs_running_has_lease demands. */
const running = (lease: string, attempts: number, max = 3, token = "gen_random_uuid()"): Row =>
  ({ state: "'running'", lease_until: lease, claim_token: token, attempts: String(attempts), max_attempts: String(max) });

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_JOBS_${label}_${RUN}`, `Jobs ${label}`])).rows[0]!.id;
}

/** One statement under a savepoint: the error it raised, or null if it ran. Keeps the transaction usable. */
async function refusedWith(c: Client, sql: string, params: unknown[] = []): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

/** As service_role, the functions' only grantee: proves its grants are enough, not only the owner's. */
async function asService<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("reset role");
  }
}

type Claimed = { id: string; attempts: number; claim_token: string; lease_ok: boolean; lease_exact: boolean; state: string };
const claimSql = `select id, attempts, claim_token, state, lease_until > now() as lease_ok,
                         lease_until = now() + make_interval(secs => timeout_ms / 1000.0 + 30) as lease_exact
                    from public.claim_jobs($1::text[], $2)`;
const claim = (c: Client, kinds: string[], limit = 50) =>
  asService(c, async () => (await c.query<Claimed>(claimSql, [kinds, limit])).rows);

describe("0102 jobs: grants, RLS, function privileges", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a
  // grant to PUBLIC as every role's own and sees PG17's MAINTAIN (0051's note).
  it("case 1: the whole table privilege matrix is service_role's DELETE, INSERT, SELECT, UPDATE and nothing else (probe: grant select on public.jobs to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "service_role", p: "DELETE" },
        { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" },
        { r: "service_role", p: "UPDATE" },
      ]);
    }));

  it("case 1: no column-level privilege for anon, authenticated or PUBLIC (probe: grant select (kind) on public.jobs to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(rows).toEqual([]);
    }));

  it("case 2: row level security is on with NO policy (probe: alter table public.jobs disable row level security -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("case 3: EXECUTE on claim_jobs and sweep_jobs is service_role's alone (probe: grant execute on function public.claim_jobs(text[], integer) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; r: string; x: boolean }>(
        `select f, r, has_function_privilege(r, f, 'EXECUTE') as x
           from unnest(array['${CLAIM}', '${SWEEP}']) f
           cross join unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by f, r`);
      expect(rows).toEqual([
        { f: CLAIM, r: "anon", x: false }, { f: CLAIM, r: "authenticated", x: false },
        { f: CLAIM, r: "public", x: false }, { f: CLAIM, r: "service_role", x: true },
        { f: SWEEP, r: "anon", x: false }, { f: SWEEP, r: "authenticated", x: false },
        { f: SWEEP, r: "public", x: false }, { f: SWEEP, r: "service_role", x: true },
      ]);
    }));

  it("both functions run as their CALLER with search_path pg_catalog, pg_temp (0096's rule; probe: security definer -> prosecdef true, FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select f, p.prosecdef, p.proconfig from unnest(array['${CLAIM}', '${SWEEP}']) f
           join pg_proc p on p.oid = f::regprocedure order by f`);
      expect(rows).toEqual([
        { f: CLAIM, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] },
        { f: SWEEP, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] },
      ]);
    }));
});

describe("0102 jobs: the table's shape", () => {
  it("the columns are exactly spec section 7's, in order, with their types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name as n, data_type as t, is_nullable as nl, column_default as d
           from information_schema.columns where table_schema = 'public' and table_name = 'jobs' order by ordinal_position`);
      expect(rows).toEqual([
        { n: "id", t: "uuid", nl: "NO", d: "gen_random_uuid()" },
        { n: "kind", t: "text", nl: "NO", d: null },
        { n: "account_id", t: "uuid", nl: "YES", d: null },
        { n: "idempotency_key", t: "text", nl: "NO", d: null },
        { n: "payload", t: "jsonb", nl: "NO", d: "'{}'::jsonb" },
        { n: "state", t: "text", nl: "NO", d: "'queued'::text" },
        { n: "run_after", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "attempts", t: "integer", nl: "NO", d: "0" },
        { n: "max_attempts", t: "integer", nl: "NO", d: null },
        { n: "timeout_ms", t: "integer", nl: "NO", d: null },
        { n: "claim_token", t: "uuid", nl: "YES", d: null },
        { n: "lease_until", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "last_error", t: "text", nl: "YES", d: null },
        { n: "created_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "updated_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "finished_at", t: "timestamp with time zone", nl: "YES", d: null },
      ]);
    }));

  it("the four partial indexes are spec section 7's, verbatim", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'jobs'
            and indexname <> 'jobs_pkey' and indexname <> 'jobs_kind_key' order by indexname`);
      expect(rows.map((r) => r.indexname)).toEqual(["jobs_account_idx", "jobs_due_idx", "jobs_finished_idx", "jobs_lease_idx"]);
      const def = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      expect(def.jobs_due_idx).toBe("CREATE INDEX jobs_due_idx ON public.jobs USING btree (run_after, id) WHERE (state = ANY (ARRAY['queued'::text, 'retrying'::text]))");
      expect(def.jobs_lease_idx).toBe("CREATE INDEX jobs_lease_idx ON public.jobs USING btree (lease_until) WHERE (state = 'running'::text)");
      expect(def.jobs_finished_idx).toBe("CREATE INDEX jobs_finished_idx ON public.jobs USING btree (finished_at) WHERE (state = ANY (ARRAY['succeeded'::text, 'dead'::text]))");
      expect(def.jobs_account_idx).toBe("CREATE INDEX jobs_account_idx ON public.jobs USING btree (account_id) WHERE (account_id IS NOT NULL)");
    }));

  it("case 14: jobs_kind_check's definition carries the literal kind pattern Task 6's twin reads from the file", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.jobs'::regclass and conname = 'jobs_kind_check'");
      expect(r!.d).toContain("'^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$'");
    }));
});

describe("0102 jobs: every CHECK refuses 23514 naming itself", () => {
  // Each case first inserts the SAME row with the one offending column left at
  // a valid value, so a refusal is the constraint's and not a broken base row.
  const cases: { name: string; constraint: string; bad: Row; good: Row }[] = [
    { name: "a payload of 9,000 bytes (probe: drop jobs_payload_size_check -> FAILS)", constraint: "jobs_payload_size_check",
      bad: { payload: "jsonb_build_object('x', repeat('a', 9000))" }, good: { payload: "jsonb_build_object('x', repeat('a', 8000))" } },
    { name: "state 'paused'", constraint: "jobs_state_check", bad: { state: "'paused'" }, good: { state: "'retrying'" } },
    { name: "max_attempts 0", constraint: "jobs_max_attempts_check", bad: { max_attempts: "0" }, good: { max_attempts: "25" } },
    { name: "max_attempts 26", constraint: "jobs_max_attempts_check", bad: { max_attempts: "26" }, good: { max_attempts: "1" } },
    { name: "timeout_ms 61000", constraint: "jobs_timeout_ms_check", bad: { timeout_ms: "61000" }, good: { timeout_ms: "60000" } },
    { name: "timeout_ms 999", constraint: "jobs_timeout_ms_check", bad: { timeout_ms: "999" }, good: { timeout_ms: "1000" } },
    { name: "attempts -1", constraint: "jobs_attempts_check", bad: { attempts: "-1" }, good: { attempts: "0" } },
    { name: "kind 'nodot'", constraint: "jobs_kind_check", bad: { kind: "'nodot'" }, good: { kind: "'has.dot'" } },
    { name: "kind of 61 characters (pattern-valid)", constraint: "jobs_kind_check",
      bad: { kind: `'a.${"b".repeat(59)}'` }, good: { kind: `'a.${"b".repeat(58)}'` } },
    { name: "last_error of 301 characters", constraint: "jobs_last_error_check",
      bad: { last_error: "repeat('e', 301)" }, good: { last_error: "repeat('e', 300)" } },
    { name: "idempotency key ''", constraint: "jobs_idempotency_key_check", bad: { idempotency_key: "''" }, good: { idempotency_key: "'x'" } },
    { name: "idempotency key of 201 characters", constraint: "jobs_idempotency_key_check",
      bad: { idempotency_key: "repeat('k', 201)" }, good: { idempotency_key: "repeat('k', 200)" } },
    { name: "state 'running' with a null lease", constraint: "jobs_running_has_lease",
      bad: { state: "'running'", claim_token: "gen_random_uuid()" },
      good: { state: "'running'", claim_token: "gen_random_uuid()", lease_until: "now() + interval '1 minute'" } },
    { name: "state 'queued' holding a lease", constraint: "jobs_running_has_lease",
      bad: { lease_until: "now()", claim_token: "gen_random_uuid()" }, good: {} },
    { name: "state 'succeeded' with a null finished_at", constraint: "jobs_finished_has_time",
      bad: { state: "'succeeded'" }, good: { state: "'succeeded'", finished_at: "now()" } },
    { name: "state 'queued' with a finished_at", constraint: "jobs_finished_has_time",
      bad: { finished_at: "now()" }, good: {} },
  ];
  it.each(cases)("case 4: $name -> 23514 $constraint", ({ constraint, bad, good }) =>
    withRollback(async (c) => {
      expect(await refusedWith(c, insertSql("chk", good))).toBeNull();
      expect(await refusedWith(c, insertSql("chk", bad))).toMatchObject({ code: "23514", constraint });
    }));
});

describe("0102 jobs: jobs_kind_key is unique nulls not distinct (kind, account_id, idempotency_key)", () => {
  const dup = (acct: string | null, tag = "uq") =>
    insertSql(tag, { idempotency_key: "'same-key'", ...(acct ? { account_id: `'${acct}'` } : {}) });

  it("its definition is exactly that", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.jobs'::regclass and conname = 'jobs_kind_key'");
      expect(r!.d).toBe("UNIQUE NULLS NOT DISTINCT (kind, account_id, idempotency_key)");
    }));

  it("case 5 (second platform insert): a second platform job (null account) with the same kind and key -> 23505 jobs_kind_key (probe: nulls distinct -> accepted, FAILS)", () =>
    withRollback(async (c) => {
      await c.query(dup(null));
      expect(await refusedWith(c, dup(null))).toMatchObject({ code: "23505", constraint: "jobs_kind_key" });
    }));

  it("case 5 (other kind): the same key under another kind is accepted (probe: unique (idempotency_key) -> 23505, FAILS)", () =>
    withRollback(async (c) => {
      await c.query(dup(null, "uq"));
      expect(await refusedWith(c, dup(null, "other"))).toBeNull();
    }));

  it("case 5 (two accounts): the same kind and key under two accounts is accepted for BOTH, and a second for the same account -> 23505 (probe: nulls not distinct (kind, idempotency_key) -> 23505 on the second account, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "ua");
      const b = await account(c, "ub");
      await c.query(dup(null));
      expect(await refusedWith(c, dup(a))).toBeNull();
      await c.query(dup(a));
      expect(await refusedWith(c, dup(b))).toBeNull();
      await c.query(dup(b));
      expect(await refusedWith(c, dup(a))).toMatchObject({ code: "23505", constraint: "jobs_kind_key" });
    }));
});

describe("0102 claim_jobs: the claim", () => {
  it("case 6: two workers at once each claim a DIFFERENT job, and the second does not wait (probe: drop `skip locked`, or the whole `for update skip locked` -> the waiter raises 55P03, FAILS)", async () => {
    const k = kind("race");
    const conn = () => new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const setup = conn();
    const holder = conn();
    const waiter = conn();
    await setup.connect();
    await holder.connect();
    await waiter.connect();
    try {
      // Committed, so both sessions see them. The older one is due first.
      const { rows: seeded } = await setup.query<{ id: string }>(
        `insert into public.jobs (kind, idempotency_key, max_attempts, timeout_ms, run_after)
         values ($1, 'race-1', 3, 5000, now() - interval '2 minutes'), ($1, 'race-2', 3, 5000, now() - interval '1 minute')
         returning id`, [k]);
      expect(seeded).toHaveLength(2);
      await holder.query("begin");
      await holder.query("set local role service_role");
      const { rows: h } = await holder.query<{ id: string }>("select id from public.claim_jobs(array[$1::text], 1)", [k]);
      expect(h).toHaveLength(1);
      expect(h[0]!.id).toBe(seeded[0]!.id);
      await waiter.query("begin");
      await waiter.query("set local role service_role");
      await waiter.query("set local lock_timeout = '300ms'");
      const w = await waiter.query<{ id: string }>("select id from public.claim_jobs(array[$1::text], 1)", [k])
        .then((r) => r.rows, (e: unknown) => e);
      expect(w).toEqual([{ id: seeded[1]!.id }]);
    } finally {
      await waiter.query("rollback").catch(() => undefined);
      await holder.query("rollback").catch(() => undefined);
      await waiter.end();
      await holder.end();
      await setup.query("delete from public.jobs where kind = $1", [k]).catch(() => undefined);
      await setup.end();
    }
  });

  it("a due row is claimed as running: attempts + 1, a fresh token, a lease of exactly timeout_ms + 30 s; p_limit defaults to 1", () =>
    withRollback(async (c) => {
      const k = kind("due");
      const first = await job(c, "due", { run_after: "now() - interval '2 minutes'" });
      await job(c, "due", { run_after: "now() - interval '1 minute'" });
      const rows = await asService(c, async () => (await c.query<Claimed>(
        `select id, attempts, claim_token, state, lease_until > now() as lease_ok,
                lease_until = now() + interval '35 seconds' as lease_exact from public.claim_jobs(array[$1::text])`, [k])).rows);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first, attempts: 1, state: "running", lease_ok: true, lease_exact: true });
      expect(rows[0]!.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    }));

  it("case 7: a running row whose lease ran out is claimed again (same id, attempts 2, a new token, a lease in the future); one under a live lease is not (probe: drop `or (state = 'running' and lease_until < now())` -> FAILS)", () =>
    withRollback(async (c) => {
      const T = "00000000-0000-4000-8000-0000000000aa";
      const expired = await job(c, "lease", running("now() - interval '1 minute'", 1, 3, `'${T}'`));
      await job(c, "lease", running("now() + interval '1 hour'", 1));
      const rows = await claim(c, [kind("lease")]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: expired, attempts: 2, state: "running", lease_ok: true, lease_exact: true });
      expect(rows[0]!.claim_token).not.toBe(T);
    }));

  it("case 8: a run-out lease on the LAST attempt is not returned, and is dead with its reason, its lease and token cleared (probe: drop the dead-letter UPDATE -> it is re-claimed at attempts 4, FAILS)", () =>
    withRollback(async (c) => {
      const id = await job(c, "dl", running("now() - interval '1 minute'", 3, 3));
      expect(await claim(c, [kind("dl")])).toEqual([]);
      const { rows: [r] } = await c.query(
        `select state, finished_at = now() as fin, lease_until, claim_token, last_error, attempts from public.jobs where id = $1`, [id]);
      expect(r).toEqual({ state: "dead", fin: true, lease_until: null, claim_token: null, last_error: LEASE_EXPIRED, attempts: 3 });
    }));

  it("case 9 (future): a queued row with run_after an hour ahead is not claimed, beside a due one that is (probe: drop `and run_after <= now()` -> FAILS)", () =>
    withRollback(async (c) => {
      const due = await job(c, "fut");
      await job(c, "fut", { run_after: "now() + interval '1 hour'" });
      await job(c, "fut", { state: "'retrying'", run_after: "now() + interval '1 hour'" });
      expect((await claim(c, [kind("fut")])).map((r) => r.id)).toEqual([due]);
    }));

  it("case 9 (kind): a due row of a kind outside p_kinds is not claimed (probe: drop `kind = any(p_kinds) and` -> FAILS)", () =>
    withRollback(async (c) => {
      const mine = await job(c, "mine");
      const other = await job(c, "other");
      expect((await claim(c, [kind("mine")])).map((r) => r.id)).toEqual([mine]);
      const { rows: [r] } = await c.query("select state, attempts from public.jobs where id = $1", [other]);
      expect(r).toEqual({ state: "queued", attempts: 0 });
    }));

  it("succeeded and dead rows are never claimed, however old", () =>
    withRollback(async (c) => {
      await job(c, "fin", { state: "'succeeded'", finished_at: "now()", run_after: "now() - interval '1 day'" });
      await job(c, "fin", { state: "'dead'", finished_at: "now()", run_after: "now() - interval '1 day'" });
      const due = await job(c, "fin");
      expect((await claim(c, [kind("fin")])).map((r) => r.id)).toEqual([due]);
    }));

  it("case 10: p_limit 0 and 51 raise 22023; 50 runs (probe: drop the p_limit guard -> FAILS)", () =>
    withRollback(async (c) => {
      const k = kind("lim");
      const call = "select * from public.claim_jobs(array[$1::text], $2)";
      const r0 = await asService(c, () => refusedWith(c, call, [k, 0]));
      const r51 = await asService(c, () => refusedWith(c, call, [k, 51]));
      const r50 = await asService(c, () => refusedWith(c, call, [k, 50]));
      expect([r0, r51, r50]).toMatchObject([{ code: "22023" }, { code: "22023" }, null]);
    }));
});

describe("0102 sweep_jobs: retention", () => {
  const old = (state: "succeeded" | "dead", days: number): Row =>
    ({ state: `'${state}'`, finished_at: `now() - interval '${days} days'` });

  it("case 11: deletes succeeded 8 days old and dead 31 days old; keeps succeeded 6 days, dead 10 and 29 days, queued, retrying and running (probes: drop `state = 'succeeded' and`, or '30 days' -> '7 days' -> the 10-day dead row is swept, FAILS)", () =>
    withRollback(async (c) => {
      const k = kind("sw");
      const gone = [await job(c, "sw", old("succeeded", 8)), await job(c, "sw", old("dead", 31))];
      const kept = [
        await job(c, "sw", old("succeeded", 6)), await job(c, "sw", old("dead", 10)), await job(c, "sw", old("dead", 29)),
        await job(c, "sw"), await job(c, "sw", { state: "'retrying'" }),
        await job(c, "sw", running("now() - interval '40 days'", 1)),
      ];
      // Another run's sweepable rows also go (the sweep is global, by design); count them so the total is exact.
      const { rows: [f] } = await c.query<{ n: number }>(
        `select count(*)::int as n from public.jobs where kind <> $1
            and ((state = 'succeeded' and finished_at < now() - interval '7 days')
              or (state = 'dead' and finished_at < now() - interval '30 days'))`, [k]);
      const n = await asService(c, async () => (await c.query<{ n: number }>("select public.sweep_jobs(10) as n")).rows[0]!.n);
      expect(n).toBe(2 + f!.n);
      const { rows } = await c.query<{ id: string }>("select id from public.jobs where kind = $1", [k]);
      expect(rows.map((r) => r.id).sort()).toEqual([...kept].sort());
      expect(gone.every((id) => !rows.some((r) => r.id === id))).toBe(true);
    }));

  it("case 11 (limit): with three sweepable rows, sweep_jobs(2) returns 2 and deletes the two oldest (probe: drop `limit p_limit` -> 3, FAILS)", () =>
    withRollback(async (c) => {
      const k = kind("swl");
      // Older than anything another run could hold, so these three are the sweep's oldest.
      const at = (y: number): Row => ({ state: "'succeeded'", finished_at: `'${y}-01-01T00:00:00Z'` });
      await job(c, "swl", at(2001));
      await job(c, "swl", at(2000));
      const newest = await job(c, "swl", at(2002));
      const n = await asService(c, async () => (await c.query<{ n: number }>("select public.sweep_jobs(2) as n")).rows[0]!.n);
      expect(n).toBe(2);
      const { rows } = await c.query<{ id: string }>("select id from public.jobs where kind = $1", [k]);
      expect(rows.map((r) => r.id)).toEqual([newest]);
    }));

  it("sweep_jobs p_limit 0 and 5001 raise 22023; 5000 runs", () =>
    withRollback(async (c) => {
      const call = "select public.sweep_jobs($1)";
      const r0 = await asService(c, () => refusedWith(c, call, [0]));
      const rBig = await asService(c, () => refusedWith(c, call, [5001]));
      const rMax = await asService(c, () => refusedWith(c, call, [5000]));
      expect([r0, rBig, rMax]).toMatchObject([{ code: "22023" }, { code: "22023" }, null]);
    }));
});

describe("0102 jobs: account scope", () => {
  it("case 12: deleting an account deletes its job; a platform job stays (probe: the FK without `on delete cascade` -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const a = await account(c, "del");
      const mine = await job(c, "acct", { account_id: `'${a}'` });
      const platform = await job(c, "acct");
      await c.query("delete from accounts where id = $1", [a]);
      const { rows } = await c.query<{ id: string }>("select id from public.jobs where id = any($1::uuid[])", [[mine, platform]]);
      expect(rows).toEqual([{ id: platform }]);
    }));

  it("case 13: jobs is on ACCOUNT_OWNED_TABLES, and the first two stay the AI tables (probe: remove \"jobs\" -> FAILS)", () => {
    expect((ACCOUNT_OWNED_TABLES as readonly string[]).indexOf("jobs")).toBeGreaterThanOrEqual(0);
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});
