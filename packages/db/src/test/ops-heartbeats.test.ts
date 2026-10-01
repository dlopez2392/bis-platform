import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withRollback } from "./db";
import { HEARTBEAT_KEYS, isHeartbeatKey, passHeartbeatKey, boundHeartbeatError } from "../ops";

/**
 * 0057 record_heartbeat: the upsert, run as the role that uses it
 * (service_role, its only grantee). withRollback, except the one
 * concurrency test, which needs two committed transactions and deletes its
 * own row (key `test.concurrency.<run>`) in its finally.
 *
 * RED BEFORE APPLY: every test here (the table and the function do not
 * exist: 42P01 / 42883).
 *
 * Inside one transaction now() is constant, so "stamped now" is asserted as
 * `= now()` in SQL, and a value that must NOT move is seeded in the past.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const key = (label: string) => `test.${label}.${RUN}`;

type Row = {
  last_ok_at: string | null; last_error_at: string | null; last_error: string | null;
  consecutive_failures: number; alerted_at: string | null;
  ok_now: boolean | null; error_now: boolean | null; updated_now: boolean;
};

async function beat(c: Client, k: string, ok: boolean | null, error: string | null = null): Promise<void> {
  await c.query("set local role service_role");
  try {
    await c.query("select public.record_heartbeat($1, $2, $3)", [k, ok, error]);
  } finally {
    await c.query("reset role");
  }
}

async function read(c: Client, k: string): Promise<Row | undefined> {
  const { rows: [r] } = await c.query<Row>(
    `select to_char(last_ok_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as last_ok_at,
            to_char(last_error_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as last_error_at,
            last_error, consecutive_failures,
            to_char(alerted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as alerted_at,
            last_ok_at = now() as ok_now, last_error_at = now() as error_now, updated_at = now() as updated_now
       from public.ops_heartbeats where key = $1`, [k]);
  return r;
}

/** A row from an earlier day, written as the owner. */
async function seedPast(c: Client, k: string): Promise<void> {
  await c.query(
    `insert into public.ops_heartbeats (key, last_ok_at, last_error_at, last_error, consecutive_failures, alerted_at, updated_at)
     values ($1, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'boom', 3, '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z')`, [k]);
}

async function refusedWith(c: Client, sql: string, params: unknown[]): Promise<unknown> {
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

describe("0057 ops_heartbeats: the columns", () => {
  it("are exactly the spec's, with their types, nullability and defaults (mutation: consecutive_failures nullable, or drop its default → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'ops_heartbeats' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "key", data_type: "text", is_nullable: "NO", column_default: null },
        { column_name: "last_ok_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "last_error_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "last_error", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "consecutive_failures", data_type: "integer", is_nullable: "NO", column_default: "0" },
        { column_name: "alerted_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));
});

describe("0057 record_heartbeat: the upsert", () => {
  it("a first ok creates the row: last_ok_at and updated_at now, no error, 0 failures, not alerted", () =>
    withRollback(async (c) => {
      const k = key("first_ok");
      await beat(c, k, true);
      expect(await read(c, k)).toEqual({
        last_ok_at: expect.any(String), last_error_at: null, last_error: null, consecutive_failures: 0, alerted_at: null,
        ok_now: true, error_now: null, updated_now: true,
      });
    }));

  it("two errors count 2 and keep the LATEST error's text; last_ok_at stays empty (mutation: `consecutive_failures = 1` on conflict → 1, FAILS; keep h.last_error → 'first', FAILS)", () =>
    withRollback(async (c) => {
      const k = key("two_errors");
      await beat(c, k, false, "first");
      expect((await read(c, k))!.consecutive_failures).toBe(1);
      await beat(c, k, false, "second");
      expect(await read(c, k)).toEqual({
        last_ok_at: null, last_error_at: expect.any(String), last_error: "second", consecutive_failures: 2, alerted_at: null,
        ok_now: null, error_now: true, updated_now: true,
      });
    }));

  it("ok after errors resets failures to 0 and stamps last_ok_at, and KEEPS the last error, its time and alerted_at (the alert pass reads a set alerted_at at 0 failures as a recovery) (mutation: ok keeps h.consecutive_failures → 3, FAILS; ok clears alerted_at → FAILS; ok nulls last_error → FAILS)", () =>
    withRollback(async (c) => {
      const k = key("recover");
      await seedPast(c, k);
      await beat(c, k, true);
      expect(await read(c, k)).toEqual({
        last_ok_at: expect.any(String), last_error_at: "2026-01-02T00:00:00", last_error: "boom",
        consecutive_failures: 0, alerted_at: "2026-01-03T00:00:00",
        ok_now: true, error_now: false, updated_now: true,
      });
    }));

  it("an error over an existing row adds one, and leaves last_ok_at and alerted_at where they were (mutation: error branch writes last_ok_at = null → FAILS)", () =>
    withRollback(async (c) => {
      const k = key("error_over");
      await seedPast(c, k);
      await beat(c, k, false, "again");
      expect(await read(c, k)).toEqual({
        last_ok_at: "2026-01-01T00:00:00", last_error_at: expect.any(String), last_error: "again",
        consecutive_failures: 4, alerted_at: "2026-01-03T00:00:00",
        ok_now: false, error_now: true, updated_now: true,
      });
    }));

  it("the error text is cut to its first 300 CHARACTERS — an astral character at the boundary is kept whole (mutation: drop left(…, 300) → the CHECK refuses the write (23514), FAILS)", () =>
    withRollback(async (c) => {
      const k = key("truncate");
      const long = "x".repeat(299) + "\u{1F600}" + "tail that must not be stored";
      await beat(c, k, false, long);
      const { rows: [r] } = await c.query<{ n: number; last: string; whole: boolean }>(
        `select char_length(last_error) as n, right(last_error, 1) as last, last_error = $2 as whole
           from public.ops_heartbeats where key = $1`, [k, "x".repeat(299) + "\u{1F600}"]);
      expect(r).toEqual({ n: 300, last: "\u{1F600}", whole: true });
    }));

  it("the database's cut and boundHeartbeatError's agree on that same string (TS twin parity: Array.from counts code points as left() does; mutation: String.slice(0, 300) → splits the emoji, FAILS)", () =>
    withRollback(async (c) => {
      const long = "x".repeat(299) + "\u{1F600}" + "tail";
      const { rows: [r] } = await c.query<{ cut: string }>("select left($1::text, 300) as cut", [long]);
      expect(boundHeartbeatError(long)).toBe(r!.cut);
    }));

  it("an error with no text still counts, with last_error empty", () =>
    withRollback(async (c) => {
      const k = key("null_error");
      await beat(c, k, false, null);
      expect(await read(c, k)).toMatchObject({ last_error: null, consecutive_failures: 1, error_now: true });
    }));

  it("a NULL outcome raises 22023 and writes nothing (mutation: drop the p_ok guard → it is counted as a failure, FAILS)", () =>
    withRollback(async (c) => {
      const k = key("null_ok");
      await c.query("set local role service_role");
      const e = await refusedWith(c, "select public.record_heartbeat($1, null, 'x')", [k]);
      await c.query("reset role");
      expect(e).toMatchObject({ code: "22023", message: "record_heartbeat: p_ok must be true or false" });
      expect(await read(c, k)).toBeUndefined();
    }));
});

describe("0057 ops_heartbeats: the CHECKs", () => {
  it("ops_heartbeats_key_check and HEARTBEAT_KEY_PATTERN (ops.ts, its TS twin) agree on every literal, and both take every spec key and a camelCase pass key (mutation: CHECK back to [a-z0-9_.-] → cron.pass.weeklyAgencyReport is refused, FAILS)", () =>
    withRollback(async (c) => {
      const literals = [
        ...Object.values(HEARTBEAT_KEYS),
        passHeartbeatKey("weeklyAgencyReport"), passHeartbeatKey("appointmentConfirms"), passHeartbeatKey("releaseHeld"),
        "CRON.TICK", "a", "a".repeat(80),
        "", "a".repeat(81), "cron.tick\n", "\ncron.tick", "cron tick", "cron/tick", "café", "cron.tick;", "cron:tick",
      ];
      const db: Record<string, boolean> = {};
      const ts: Record<string, boolean> = {};
      for (const k of literals) {
        // `on conflict do nothing`: a real `cron.tick` row already in the
        // project must not read as a refusal (23505). The CHECK is evaluated
        // on the proposed row BEFORE the conflict check, so a bad key still
        // raises 23514.
        const e = await refusedWith(c, "insert into public.ops_heartbeats (key) values ($1) on conflict (key) do nothing", [k]);
        if (e !== null) expect(e).toMatchObject({ code: "23514", constraint: "ops_heartbeats_key_check" });
        db[JSON.stringify(k)] = e === null;
        ts[JSON.stringify(k)] = isHeartbeatKey(k);
      }
      expect(ts).toEqual(db);
      // Not vacuous: both sides accept the spec's keys and refuse the bad ones.
      expect(Object.values(db).filter(Boolean)).toHaveLength(Object.values(HEARTBEAT_KEYS).length + 6);
    }));

  it("last_error holds at most 300 characters even written directly (mutation: drop ops_heartbeats_last_error_check → the insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      expect(await refusedWith(c, "insert into public.ops_heartbeats (key, last_error) values ($1, $2)", [key("long"), "x".repeat(301)]))
        .toMatchObject({ code: "23514", constraint: "ops_heartbeats_last_error_check" });
      await c.query("insert into public.ops_heartbeats (key, last_error) values ($1, $2)", [key("long300"), "x".repeat(300)]);
    }));

  it("consecutive_failures is never negative (mutation: drop ops_heartbeats_consecutive_failures_check → FAILS)", () =>
    withRollback(async (c) => {
      expect(await refusedWith(c, "insert into public.ops_heartbeats (key, consecutive_failures) values ($1, -1)", [key("neg")]))
        .toMatchObject({ code: "23514", constraint: "ops_heartbeats_consecutive_failures_check" });
    }));
});

describe("0057 record_heartbeat: two writers at once", () => {
  it("two errors on one key from two connections at the same moment count 2, not 1: the second waits on the first's row and adds to it (mutation: read consecutive_failures first, then upsert the read value + 1 → the waiter read no row and writes 1, FAILS)", async () => {
    const k = key("concurrency");
    const holder = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    const waiter = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 });
    await holder.connect();
    await waiter.connect();
    let committed = false;
    let second: Promise<unknown> | null = null;
    try {
      const { rows: [w] } = await waiter.query<{ pid: number }>("select pg_backend_pid() as pid");
      await holder.query("begin");
      await holder.query("set local role service_role");
      await holder.query("select public.record_heartbeat($1, false, 'first')", [k]);
      await holder.query("reset role");

      await waiter.query("begin");
      await waiter.query("set local role service_role");
      second = waiter.query("select public.record_heartbeat($1, false, 'second')", [k]).then(() => null, (e: unknown) => e);

      // The waiter must really be blocked on the holder's uncommitted row
      // before the holder commits; otherwise it would simply see the committed
      // row and the test could not tell the two implementations apart.
      let blocked = false;
      for (let i = 0; i < 100 && !blocked; i++) {
        const { rows: [s] } = await holder.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid = $1", [w!.pid]);
        blocked = s?.wait_event_type === "Lock";
        if (!blocked) await new Promise((r) => setTimeout(r, 50));
      }
      expect(blocked, "the second writer never waited on the first's row; the test would prove nothing").toBe(true);

      await holder.query("commit");
      committed = true;
      expect(await second).toBeNull();
      const { rows: [r] } = await waiter.query<{ consecutive_failures: number; last_error: string }>(
        "select consecutive_failures, last_error from public.ops_heartbeats where key = $1", [k]);
      expect(r).toEqual({ consecutive_failures: 2, last_error: "second" });
    } finally {
      // The HOLDER first: while it is open the waiter is blocked on it, and a
      // rollback queued on the waiter's connection would wait forever.
      if (!committed) await holder.query("rollback").catch(() => undefined);
      if (second) await second;
      await waiter.query("rollback").catch(() => undefined);
      try {
        if (committed) {
          // As the owner: service_role holds no DELETE on this table (0057).
          const del = await holder.query("delete from public.ops_heartbeats where key = $1", [k]).then(() => null, (e: unknown) => e);
          if (del) throw new Error(`ops-heartbeats.test cleanup failed on ops_heartbeats (${k}): ${String(del)}`);
        }
      } finally {
        await waiter.end();
        await holder.end();
      }
    }
  });
});
