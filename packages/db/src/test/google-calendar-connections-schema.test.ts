import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { withRollback, actAsMember } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * S-22 slice 1, PR 1: public.google_calendar_connections (migration google_calendar_connections). Plan
 * docs/superpowers/plans/2026-11-15-google-busy-blocks-slots.md sections 1 (D5, D6, D12) and 2. A server-only
 * table on 0104's pattern: RLS on with no policy, every client privilege revoked, service_role alone holds it.
 *
 * Every case runs in withRollback as the table owner, except the ones that say otherwise: the member control
 * (actAsMember, authenticated) and the service_role cases (`set local role service_role`, the server's own grants).
 *
 * RED BEFORE APPLY (the replica's `pre`): every database case (42P01 on the table, or a missing row in the catalog
 * reads), and the teardown case (no "google_calendar_connections" entry yet). GREEN AFTER APPLY: all of them.
 *
 * schema-grants-guard.test.ts already fails if anon or authenticated gains a WRITE on this table; it does not
 * look at SELECT, column grants or service_role, which is what the first block pins.
 */
const TABLE = "public.google_calendar_connections";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
/** Every column but the two that name the row (id, account_id): a row never moves to another account. */
const UPDATABLE = [
  "connected_at", "connected_by", "google_email", "key_version", "last_checked_at", "needs_reconnect_since",
  "reconnect_task_id", "refresh_expires_at", "refresh_token_sealed", "scope", "status", "version",
];
const RUN = randomBytes(4).toString("hex");
/** The shape lib/google/token-seal.ts writes: "g1." + base64url. */
const sealed = () => `g1.${randomBytes(48).toString("base64url")}`;

type Seed = { a: string; b: string; user: string; task: string };

async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('GC schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [ag!.id, `org_gc_${tag}_${RUN}`, `GC ${tag}`])).rows[0]!.id;
  const a = await acct("a");
  const b = await acct("b");
  const { rows: [u] } = await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`user_gc_${RUN}`]);
  const { rows: [t] } = await c.query<{ id: string }>(
    "insert into tasks (account_id, title) values ($1, 'Reconnect your Google Calendar') returning id", [a]);
  return { a, b, user: u!.id, task: t!.id };
}

/** Insert one connection for `account`; `over` replaces any column. Returns its id. */
async function connect(c: Client, account: string, over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = {
    id: randomUUID(), account_id: account, google_email: "owner@example.com",
    scope: "openid email https://www.googleapis.com/auth/calendar.freebusy", status: "connected",
    refresh_token_sealed: sealed(), key_version: 1, ...over,
  };
  const cols = Object.keys(row);
  await c.query(`insert into ${TABLE} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row));
  return row.id as string;
}

/** One statement under a savepoint: the error it raised, or null if it ran. Keeps the transaction usable. */
async function refusedWith(c: Client, run: () => Promise<unknown>): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await run();
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

describe("google_calendar_connections: grants and RLS", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a grant to PUBLIC as every role's own
  // and sees PG17's MAINTAIN (0051's note).
  it("the whole table privilege matrix is service_role's DELETE, INSERT, SELECT and nothing else (probe: grant select on the table to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "service_role", p: "DELETE" },
        { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" },
      ]);
    }));

  it("service_role may UPDATE exactly every column but id and account_id (probe: grant update on the table to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select a.attname as n from pg_attribute a
          where a.attrelid = '${TABLE}'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('service_role', '${TABLE}', a.attname, 'UPDATE') order by 1`);
      expect(rows.map((r) => r.n)).toEqual(UPDATABLE);
    }));

  it("no column-level privilege for anon, authenticated or PUBLIC (probe: grant select (google_email) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(rows).toEqual([]);
    }));

  it("row level security is on with NO policy (probe: disable row level security -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("(control) the account's own signed-in Owner selecting from it is refused 42501, not shown zero rows", () =>
    withRollback(async (c) => {
      const { a } = await seed(c);
      await connect(c, a);
      const { rows: [acc] } = await c.query<{ clerk_org_id: string }>("select clerk_org_id from accounts where id = $1", [a]);
      await actAsMember(c, a, acc!.clerk_org_id, "owner");
      await expect(c.query(`select google_email from ${TABLE}`)).rejects.toMatchObject({ code: "42501" });
    }));

  it("service_role reads, inserts, updates and deletes on its own grants", () =>
    withRollback(async (c) => {
      const { a } = await seed(c);
      await c.query("set local role service_role");
      const id = await connect(c, a);
      await c.query(`update ${TABLE} set version = version + 1, status = 'needs_reconnect', needs_reconnect_since = now() where id = $1`, [id]);
      const { rows } = await c.query(`select version, status from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ version: 2, status: "needs_reconnect" }]);
      await c.query(`delete from ${TABLE} where id = $1`, [id]);
      expect((await c.query(`select id from ${TABLE} where id = $1`, [id])).rows).toEqual([]);
    }));

  it("service_role cannot move a row to another account (UPDATE of account_id is refused 42501)", () =>
    withRollback(async (c) => {
      const { a, b } = await seed(c);
      const id = await connect(c, a);
      await c.query("set local role service_role");
      await expect(c.query(`update ${TABLE} set account_id = $1 where id = $2`, [b, id])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("google_calendar_connections: the table's shape", () => {
  it("the columns are exactly the plan's section 2, in order, with their types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name as n, data_type as t, is_nullable as nl, column_default as d
           from information_schema.columns where table_schema = 'public' and table_name = 'google_calendar_connections'
          order by ordinal_position`);
      expect(rows).toEqual([
        { n: "id", t: "uuid", nl: "NO", d: null },
        { n: "account_id", t: "uuid", nl: "NO", d: null },
        { n: "version", t: "integer", nl: "NO", d: "1" },
        { n: "google_email", t: "text", nl: "NO", d: null },
        { n: "scope", t: "text", nl: "NO", d: null },
        { n: "status", t: "text", nl: "NO", d: null },
        { n: "refresh_token_sealed", t: "text", nl: "NO", d: null },
        { n: "key_version", t: "smallint", nl: "NO", d: null },
        { n: "refresh_expires_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "connected_by", t: "uuid", nl: "YES", d: null },
        { n: "connected_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "last_checked_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "needs_reconnect_since", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "reconnect_task_id", t: "uuid", nl: "YES", d: null },
      ]);
    }));

  it("the indexes, foreign keys and checks are exactly these", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'google_calendar_connections' order by indexname");
      expect(Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]))).toEqual({
        google_calendar_connections_account_id_key:
          "CREATE UNIQUE INDEX google_calendar_connections_account_id_key ON public.google_calendar_connections USING btree (account_id)",
        google_calendar_connections_pkey:
          "CREATE UNIQUE INDEX google_calendar_connections_pkey ON public.google_calendar_connections USING btree (id)",
      });
      // contype 'n' excluded: PG18 (the replica) stores NOT NULL as constraint rows, PG17 (the projects) does not.
      const { rows: cons } = await c.query<{ conname: string; d: string }>(
        `select conname, pg_get_constraintdef(oid) as d from pg_constraint
          where conrelid = '${TABLE}'::regclass and contype in ('f', 'c') order by conname`);
      expect(Object.fromEntries(cons.map((r) => [r.conname, r.d]))).toEqual({
        google_calendar_connections_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        google_calendar_connections_connected_by_fkey: "FOREIGN KEY (connected_by) REFERENCES users(id) ON DELETE SET NULL",
        google_calendar_connections_google_email_check: "CHECK ((btrim(google_email) <> ''::text))",
        google_calendar_connections_key_version_check: "CHECK ((key_version >= 1))",
        google_calendar_connections_reconnect_pair_check:
          "CHECK (((status = 'needs_reconnect'::text) = (needs_reconnect_since IS NOT NULL)))",
        google_calendar_connections_reconnect_task_id_fkey: "FOREIGN KEY (reconnect_task_id) REFERENCES tasks(id) ON DELETE SET NULL",
        google_calendar_connections_refresh_token_sealed_check:
          "CHECK (((char_length(refresh_token_sealed) <= 4096) AND (refresh_token_sealed ~ '^g[0-9]+[.][A-Za-z0-9_-]+$'::text)))",
        google_calendar_connections_scope_check: "CHECK ((btrim(scope) <> ''::text))",
        google_calendar_connections_status_check:
          "CHECK ((status = ANY (ARRAY['connected'::text, 'needs_reconnect'::text])))",
        google_calendar_connections_version_check: "CHECK ((version >= 1))",
      });
    }));
});

describe("google_calendar_connections: what the checks refuse", () => {
  it("one connection per account: a second row for the same account -> 23505 google_calendar_connections_account_id_key; another account's is accepted", () =>
    withRollback(async (c) => {
      const { a, b } = await seed(c);
      await connect(c, a);
      expect(await refusedWith(c, () => connect(c, a))).toMatchObject({ code: "23505", constraint: "google_calendar_connections_account_id_key" });
      expect(await refusedWith(c, () => connect(c, b))).toBeNull();
    }));

  const refusals: { name: string; over: Record<string, unknown>; constraint: string }[] = [
    { name: "needs_reconnect with no needs_reconnect_since", over: { status: "needs_reconnect" }, constraint: "google_calendar_connections_reconnect_pair_check" },
    { name: "connected WITH a needs_reconnect_since", over: { needs_reconnect_since: new Date() }, constraint: "google_calendar_connections_reconnect_pair_check" },
    { name: "a status outside the two", over: { status: "revoked" }, constraint: "google_calendar_connections_status_check" },
    { name: "a plaintext Google refresh token (it holds slashes)", over: { refresh_token_sealed: "1//0gAbCdEf-ghIJ" }, constraint: "google_calendar_connections_refresh_token_sealed_check" },
    { name: "a sealed value with no format version", over: { refresh_token_sealed: randomBytes(48).toString("base64url") }, constraint: "google_calendar_connections_refresh_token_sealed_check" },
    { name: "a sealed value over 4096 characters", over: { refresh_token_sealed: `g1.${"A".repeat(4094)}` }, constraint: "google_calendar_connections_refresh_token_sealed_check" },
    { name: "a blank google_email", over: { google_email: "  " }, constraint: "google_calendar_connections_google_email_check" },
    { name: "a blank scope", over: { scope: " " }, constraint: "google_calendar_connections_scope_check" },
    { name: "version 0", over: { version: 0 }, constraint: "google_calendar_connections_version_check" },
    { name: "key_version 0", over: { key_version: 0 }, constraint: "google_calendar_connections_key_version_check" },
  ];
  it.each(refusals)("$name -> 23514 $constraint", ({ over, constraint }) =>
    withRollback(async (c) => {
      const { a } = await seed(c);
      expect(await refusedWith(c, () => connect(c, a, over))).toMatchObject({ code: "23514", constraint });
      expect(await refusedWith(c, () => connect(c, a))).toBeNull();
    }));

  it("needs_reconnect WITH its since, and a sealed value of 4096 characters, are accepted", () =>
    withRollback(async (c) => {
      const { a, b } = await seed(c);
      expect(await refusedWith(c, () => connect(c, a, { status: "needs_reconnect", needs_reconnect_since: new Date() }))).toBeNull();
      expect(await refusedWith(c, () => connect(c, b, { refresh_token_sealed: `g1.${"A".repeat(4093)}` }))).toBeNull();
    }));
});

describe("google_calendar_connections: what deleting a parent does", () => {
  it("deleting the account deletes its connection, and only its own (probe: FK without cascade -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const { a, b } = await seed(c);
      const ida = await connect(c, a);
      const idb = await connect(c, b);
      await c.query("delete from accounts where id = $1", [b]);
      const { rows } = await c.query<{ id: string }>(`select id from ${TABLE} where id = any($1::uuid[])`, [[ida, idb]]);
      expect(rows).toEqual([{ id: ida }]);
    }));

  it("deleting the person who connected keeps the connection and nulls connected_by", () =>
    withRollback(async (c) => {
      const { a, user } = await seed(c);
      const id = await connect(c, a, { connected_by: user });
      await c.query("delete from users where id = $1", [user]);
      const { rows } = await c.query(`select connected_by from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ connected_by: null }]);
    }));

  it("deleting the reconnect To-do keeps the connection and nulls reconnect_task_id", () =>
    withRollback(async (c) => {
      const { a, task } = await seed(c);
      const id = await connect(c, a, { status: "needs_reconnect", needs_reconnect_since: new Date(), reconnect_task_id: task });
      await c.query("delete from tasks where id = $1", [task]);
      const { rows } = await c.query(`select reconnect_task_id, status from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ reconnect_task_id: null, status: "needs_reconnect" }]);
    }));
});

describe("google_calendar_connections: teardown", () => {
  it("is on ACCOUNT_OWNED_TABLES, before tasks, and the first two stay the AI tables (probe: remove it -> FAILS)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.indexOf("google_calendar_connections")).toBeGreaterThanOrEqual(0);
    expect(listed.indexOf("google_calendar_connections")).toBeLessThan(listed.indexOf("tasks"));
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});
