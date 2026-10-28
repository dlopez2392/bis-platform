import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { withRollback, actAsMember } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0104 (F-048 part 2): public.calendar_feeds and its four functions. Spec
 * docs/superpowers/specs/2026-10-28-calendar-feed-design.md sections 2 and 3;
 * plan docs/superpowers/plans/2026-10-28-calendar-feed.md Task 1. The cases
 * mirror the replica probes P1-P7 and P6b (scratchpad cf-t1/probe-0104.sql).
 *
 * Every case runs in withRollback as the table owner, except the ones that
 * say otherwise: the member control (actAsMember, authenticated) and the
 * service_role case, which proves the functions' only grantee can run them on
 * its OWN grants (they are security invoker, 0102's shape).
 *
 * RED BEFORE APPLY (the replica's `pre`): every database case (42P01 on
 * public.calendar_feeds, 42883 on the functions, or a missing row in the
 * catalog reads), and case 8 (no "calendar_feeds" entry yet). GREEN AFTER
 * APPLY: all of them.
 *
 * schema-grants-guard.test.ts already fails if anon or authenticated gains a
 * WRITE on this table; it does not look at SELECT, column grants, EXECUTE or
 * service_role, which is what the first block pins.
 */
const TABLE = "public.calendar_feeds";
const CLAIM = "public.claim_calendar_feed_fetch(text,integer,integer)";
const REPLACE = "public.replace_calendar_feed(uuid,uuid,uuid,text,text)";
const RESTORE = "public.restore_calendar_feed(uuid,uuid,uuid,timestamp with time zone,uuid,integer)";
const REVOKE = "public.revoke_calendar_feed(uuid,uuid)";
const FUNCTIONS = [CLAIM, REPLACE, RESTORE, REVOKE].sort();
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = randomBytes(4).toString("hex");

/** A token hash: 64 lowercase hex characters, unique per call. */
const hex = () => randomBytes(32).toString("hex");

type Claim = { status: string; feed_id?: string; account_id?: string; user_id?: string; role?: string;
  user_language?: string | null; retry_after_seconds?: number };

type Seed = {
  a: string; b: string;
  owner: string; tech: string; staff: string; bOwner: string;
  ownerFeed: string; techFeed: string; bFeed: string;
  ownerHash: string; techHash: string; bHash: string;
};

/**
 * Two accounts, four people: A's owner (language es), technician and staff (no
 * link of their own), and B's owner. A link each for A's owner, A's technician
 * and B's owner.
 */
async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('CF schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [ag!.id, `org_cf_${tag}_${RUN}`, `CF ${tag}`])).rows[0]!.id;
  const a = await acct("a");
  const b = await acct("b");
  const person = async (tag: string, account: string, role: string, language: string | null = null) => {
    const { rows: [u] } = await c.query<{ id: string }>(
      "insert into users (clerk_user_id, email, language) values ($1, $1 || '@example.com', $2) returning id",
      [`user_cf_${tag}_${RUN}`, language]);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, account, role]);
    return u!.id;
  };
  const owner = await person("owner", a, "owner", "es");
  const tech = await person("tech", a, "technician");
  const staff = await person("staff", a, "staff");
  const bOwner = await person("b", b, "owner");
  const [ownerHash, techHash, bHash] = [hex(), hex(), hex()];
  const [ownerFeed, techFeed, bFeed] = [randomUUID(), randomUUID(), randomUUID()];
  await c.query(
    `insert into calendar_feeds (id, account_id, user_id, token_hash, created_by)
     values ($1, $2, $3, $4, 'user_cf_owner'), ($5, $2, $6, $7, 'user_cf_tech'), ($8, $9, $10, $11, 'user_cf_b')`,
    [ownerFeed, a, owner, ownerHash, techFeed, tech, techHash, bFeed, b, bOwner, bHash]);
  return { a, b, owner, tech, staff, bOwner, ownerFeed, techFeed, bFeed, ownerHash, techHash, bHash };
}

const claim = async (c: Client, hash: string, max = 120, windowSeconds = 3600): Promise<Claim> =>
  (await c.query<{ r: Claim }>("select public.claim_calendar_feed_fetch($1, $2, $3) as r", [hash, max, windowSeconds])).rows[0]!.r;
const replace = async (c: Client, account: string, user: string, newId: string, newHash: string) =>
  (await c.query<{ r: { status: string; previous_id?: string; revoked_at?: string } }>(
    "select public.replace_calendar_feed($1, $2, $3, $4, 'user_cf_owner') as r", [account, user, newId, newHash])).rows[0]!.r;
const restore = async (c: Client, account: string, user: string, feed: string, revokedAt: string, replacement: string | null, maxAge = 30) =>
  (await c.query<{ r: string }>("select public.restore_calendar_feed($1, $2, $3, $4::timestamptz, $5, $6) as r",
    [account, user, feed, revokedAt, replacement, maxAge])).rows[0]!.r;
/** Turn off; also answers whether revoked_at is exactly the transaction's now(). */
const revoke = async (c: Client, account: string, user: string) =>
  (await c.query<{ r: { status: string; feed_id?: string; revoked_at?: string }; at_now: boolean | null }>(
    "select r, (r->>'revoked_at')::timestamptz = now() as at_now from (select public.revoke_calendar_feed($1, $2) as r) x",
    [account, user])).rows[0]!;
const revokedAt = async (c: Client, id: string) =>
  (await c.query<{ t: string | null }>("select revoked_at::text as t from calendar_feeds where id = $1", [id])).rows[0]?.t;

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

describe("0104 calendar_feeds: grants, RLS, function privileges (P1)", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a
  // grant to PUBLIC as every role's own and sees PG17's MAINTAIN (0051's note).
  it("case 1: the whole table privilege matrix is service_role's DELETE, INSERT, SELECT, UPDATE and nothing else (probe: grant select on public.calendar_feeds to authenticated -> FAILS)", () =>
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

  it("case 1: no column-level privilege for anon, authenticated or PUBLIC (probe: grant select (id) on public.calendar_feeds to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(rows).toEqual([]);
    }));

  it("case 1: row level security is on with NO policy (probe: alter table public.calendar_feeds disable row level security -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("case 1: EXECUTE on all four functions is service_role's alone (probe: grant execute on the claim to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; r: string; x: boolean }>(
        `select f, r, has_function_privilege(r, f::regprocedure, 'EXECUTE') as x
           from unnest($1::text[]) f
           cross join unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by f, r`, [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.flatMap((f) => [
        { f, r: "anon", x: false }, { f, r: "authenticated", x: false },
        { f, r: "public", x: false }, { f, r: "service_role", x: true },
      ]));
    }));

  it("case 1: all four run as their CALLER with search_path pg_catalog, pg_temp (0096's rule, 0102's shape; probe: security definer or search_path '' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; prosecdef: boolean; proconfig: string[] | null }>(
        `select f, p.prosecdef, p.proconfig from unnest($1::text[]) f
           join pg_proc p on p.oid = f::regprocedure order by f`, [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.map((f) => ({ f, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] })));
    }));

  it("case 1 (control): a signed-in member selecting from calendar_feeds is refused 42501, not shown zero rows (probe: grant select to authenticated -> no error, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await seed(c);
      const { rows: [acc] } = await c.query<{ clerk_org_id: string }>("select clerk_org_id from accounts where id = $1", [a]);
      await actAsMember(c, a, acc!.clerk_org_id, "owner");
      await expect(c.query("select * from public.calendar_feeds")).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0104 calendar_feeds: the table's shape", () => {
  it("the columns are exactly the plan's interface, in order, with their types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name as n, data_type as t, is_nullable as nl, column_default as d
           from information_schema.columns where table_schema = 'public' and table_name = 'calendar_feeds' order by ordinal_position`);
      expect(rows).toEqual([
        { n: "id", t: "uuid", nl: "NO", d: null },
        { n: "account_id", t: "uuid", nl: "NO", d: null },
        { n: "user_id", t: "uuid", nl: "NO", d: null },
        { n: "token_hash", t: "text", nl: "NO", d: null },
        { n: "created_by", t: "text", nl: "NO", d: null },
        { n: "created_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "revoked_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "last_fetched_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "fetch_window_started_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "fetch_count", t: "integer", nl: "NO", d: "0" },
      ]);
    }));

  it("the indexes and the composite FK are exactly these", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'calendar_feeds' order by indexname");
      expect(Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]))).toEqual({
        calendar_feeds_by_member: "CREATE INDEX calendar_feeds_by_member ON public.calendar_feeds USING btree (account_id, user_id)",
        calendar_feeds_one_live: "CREATE UNIQUE INDEX calendar_feeds_one_live ON public.calendar_feeds USING btree (account_id, user_id) WHERE (revoked_at IS NULL)",
        calendar_feeds_pkey: "CREATE UNIQUE INDEX calendar_feeds_pkey ON public.calendar_feeds USING btree (id)",
        calendar_feeds_token_hash_key: "CREATE UNIQUE INDEX calendar_feeds_token_hash_key ON public.calendar_feeds USING btree (token_hash)",
      });
      const { rows: fks } = await c.query<{ conname: string; d: string }>(
        `select conname, pg_get_constraintdef(oid) as d from pg_constraint where conrelid = '${TABLE}'::regclass and contype = 'f'`);
      expect(fks).toEqual([{ conname: "calendar_feeds_member_fkey",
        d: "FOREIGN KEY (account_id, user_id) REFERENCES memberships(account_id, user_id) ON DELETE CASCADE" }]);
    }));
});

describe("0104 claim_calendar_feed_fetch (P2-P4)", () => {
  it("case 2: a live link answers ok with the role, the person's language and the account the ROW names, and stamps the fetch (probe: drop the update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.ownerHash)).toEqual({ status: "ok", feed_id: s.ownerFeed, account_id: s.a, user_id: s.owner, role: "owner", user_language: "es" });
      expect(await claim(c, s.techHash)).toEqual({ status: "ok", feed_id: s.techFeed, account_id: s.a, user_id: s.tech, role: "technician", user_language: null });
      const { rows: [r] } = await c.query(
        `select last_fetched_at = now() as fetched, fetch_window_started_at = now() as window, fetch_count from calendar_feeds where id = $1`, [s.ownerFeed]);
      expect(r).toEqual({ fetched: true, window: true, fetch_count: 1 });
    }));

  it("case 2 (second account): B's link answers B's own account, never A's", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, s.bHash)).toMatchObject({ status: "ok", account_id: s.b, user_id: s.bOwner, feed_id: s.bFeed });
    }));

  it("case 2 (unknown): a hash nobody holds is not_found and writes nothing", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await claim(c, hex())).toEqual({ status: "not_found" });
      const { rows: [r] } = await c.query<{ n: number }>(
        "select count(*)::int as n from calendar_feeds where account_id in ($1, $2) and last_fetched_at is not null", [s.a, s.b]);
      expect(r!.n).toBe(0);
    }));

  const closed: { name: string; sql: string; status: string }[] = [
    { name: "a turned-off link (probe M1: drop `and revoked_at is null` -> FAILS)", sql: "update calendar_feeds set revoked_at = now() where account_id = $1", status: "not_found" },
    { name: "client access switched off", sql: "update accounts set client_access_enabled = false where id = $1", status: "not_found" },
    { name: "an archived account (probe M4: drop `and a.status <> 'archived'` -> FAILS)", sql: "update accounts set status = 'archived' where id = $1", status: "not_found" },
    { name: "a paused account still serves (a billing pause never refuses a read)", sql: "update accounts set status = 'paused' where id = $1", status: "ok" },
  ];
  it.each(closed)("case 3: $name -> $status", ({ sql, status }) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(sql, [s.a]);
      expect((await claim(c, s.ownerHash)).status).toBe(status);
    }));

  // Final review m7: EVERY refusal is the same bare answer, so nobody can tell an unknown link from a closed one.
  const refusals: { name: string; sql: string | null; hash: "owner" | "unknown" }[] = [
    ...closed.filter((x) => x.status === "not_found").map((x) => ({ name: x.name, sql: x.sql, hash: "owner" as const })),
    { name: "a hash nobody holds", sql: null, hash: "unknown" },
    { name: "a deleted membership (the link goes with it)", sql: "delete from memberships where account_id = $1 and user_id = $2", hash: "owner" },
  ];
  it.each(refusals)("case 3: $name is exactly { status: not_found }, with nothing else in it", ({ sql, hash }) =>
    withRollback(async (c) => {
      const s = await seed(c);
      if (sql) await c.query(sql, sql.includes("$2") ? [s.a, s.owner] : [s.a]);
      expect(await claim(c, hash === "owner" ? s.ownerHash : hex())).toEqual({ status: "not_found" });
    }));

  it("case 4: the 120th fetch in a window is served, the 121st is rate_limited with the whole hour left (probe M3: `>=` -> `>` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update calendar_feeds set fetch_window_started_at = now(), fetch_count = 119 where id = $1", [s.techFeed]);
      expect((await claim(c, s.techHash)).status).toBe("ok");
      expect(await claim(c, s.techHash)).toEqual({ status: "rate_limited", retry_after_seconds: 3600 });
      const { rows: [r] } = await c.query("select fetch_count from calendar_feeds where id = $1", [s.techFeed]);
      expect(r).toEqual({ fetch_count: 120 });
    }));

  it("case 4: retry_after_seconds is what is left of the window", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update calendar_feeds set fetch_window_started_at = now() - interval '30 minutes', fetch_count = 120 where id = $1", [s.techFeed]);
      expect(await claim(c, s.techHash)).toEqual({ status: "rate_limited", retry_after_seconds: 1800 });
    }));

  it("case 4: a window that has run out starts a new one at 1", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update calendar_feeds set fetch_window_started_at = now() - interval '2 hours', fetch_count = 120 where id = $1", [s.techFeed]);
      expect((await claim(c, s.techHash)).status).toBe("ok");
      const { rows: [r] } = await c.query(
        "select fetch_window_started_at = now() as fresh, fetch_count from calendar_feeds where id = $1", [s.techFeed]);
      expect(r).toEqual({ fresh: true, fetch_count: 1 });
    }));

  it("case 4: p_max 0 and p_window_seconds 0 raise 22023, a null argument 22004", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const call = "select public.claim_calendar_feed_fetch($1, $2, $3)";
      expect(await refusedWith(c, call, [s.techHash, 0, 3600])).toMatchObject({ code: "22023" });
      expect(await refusedWith(c, call, [s.techHash, 120, 0])).toMatchObject({ code: "22023" });
      expect(await refusedWith(c, call, [null, 120, 3600])).toMatchObject({ code: "22004" });
      expect(await refusedWith(c, call, [s.techHash, 120, 3600])).toBeNull();
    }));
});

describe("0104 calendar_feeds: one live link per member (P5)", () => {
  it("case 5: a second live link for the same person -> 23505 calendar_feeds_one_live; after a turn-off a new one is accepted", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const add = "insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values (gen_random_uuid(), $1, $2, $3, 'x')";
      expect(await refusedWith(c, add, [s.a, s.owner, hex()])).toMatchObject({ code: "23505", constraint: "calendar_feeds_one_live" });
      await c.query("update calendar_feeds set revoked_at = now() where id = $1", [s.ownerFeed]);
      expect(await refusedWith(c, add, [s.a, s.owner, hex()])).toBeNull();
    }));

  it("case 5: another account's member, or a person with no membership at all, -> 23503 calendar_feeds_member_fkey", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [u] } = await c.query<{ id: string }>(
        "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`user_cf_none_${RUN}`]);
      const add = "insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values (gen_random_uuid(), $1, $2, $3, 'x')";
      expect(await refusedWith(c, add, [s.a, s.bOwner, hex()])).toMatchObject({ code: "23503", constraint: "calendar_feeds_member_fkey" });
      expect(await refusedWith(c, add, [s.a, u!.id, hex()])).toMatchObject({ code: "23503", constraint: "calendar_feeds_member_fkey" });
      expect(await refusedWith(c, add, [s.a, s.staff, hex()])).toBeNull();
    }));

  const shapes: { name: string; hash: () => string; by: string; constraint: string }[] = [
    { name: "an uppercase hash", hash: () => hex().toUpperCase(), by: "x", constraint: "calendar_feeds_token_hash_check" },
    { name: "a 63-character hash", hash: () => hex().slice(1), by: "x", constraint: "calendar_feeds_token_hash_check" },
    { name: "a blank created_by", hash: hex, by: "  ", constraint: "calendar_feeds_created_by_check" },
  ];
  it.each(shapes)("case 5: $name -> 23514 $constraint", ({ hash, by, constraint }) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const add = "insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values (gen_random_uuid(), $1, $2, $3, $4)";
      expect(await refusedWith(c, add, [s.a, s.staff, hash(), by])).toMatchObject({ code: "23514", constraint });
      expect(await refusedWith(c, add, [s.a, s.staff, hex(), "user_cf_staff"])).toBeNull();
    }));
});

describe("0104 replace_calendar_feed and restore_calendar_feed (P6)", () => {
  it("case 6: replace turns the old link off and makes the new one live, in one call", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const next = randomUUID();
      const nextHash = hex();
      const r = await replace(c, s.a, s.owner, next, nextHash);
      expect(r).toMatchObject({ status: "ok", previous_id: s.ownerFeed });
      expect(await claim(c, s.ownerHash)).toEqual({ status: "not_found" });
      expect(await claim(c, nextHash)).toMatchObject({ status: "ok", feed_id: next });
    }));

  it("case 6: Undo inside the window restores the old link and deletes its replacement", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const next = randomUUID();
      const r = await replace(c, s.a, s.owner, next, hex());
      expect(await restore(c, s.a, s.owner, s.ownerFeed, r.revoked_at!, next)).toBe("restored");
      expect(await claim(c, s.ownerHash)).toMatchObject({ status: "ok", feed_id: s.ownerFeed });
      const { rows } = await c.query("select id from calendar_feeds where id = $1", [next]);
      expect(rows).toEqual([]);
    }));

  it("case 6: account B's person cannot restore A's link (forged account)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const next = randomUUID();
      const r = await replace(c, s.a, s.owner, next, hex());
      expect(await restore(c, s.b, s.bOwner, s.ownerFeed, r.revoked_at!, next)).toBe("changed");
      expect(await revokedAt(c, s.ownerFeed)).not.toBeNull();
      expect(await claim(c, s.bHash)).toMatchObject({ status: "ok" });
    }));

  it("case 6: a late Undo (past p_max_age_seconds) changes nothing", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update calendar_feeds set revoked_at = now() - interval '1 minute' where id = $1", [s.ownerFeed]);
      const at = (await revokedAt(c, s.ownerFeed))!;
      expect(await restore(c, s.a, s.owner, s.ownerFeed, at, null)).toBe("changed");
      expect(await revokedAt(c, s.ownerFeed)).toBe(at);
    }));

  it("case 6: an Undo naming another version of revoked_at changes nothing", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await revoke(c, s.a, s.owner);
      const other = new Date(Date.parse(r.r.revoked_at!) - 1000).toISOString();
      expect(await restore(c, s.a, s.owner, s.ownerFeed, other, null)).toBe("changed");
      expect(await revokedAt(c, s.ownerFeed)).not.toBeNull();
    }));

  it("case 6: undoing a turn-off while a newer link is live changes nothing (one live link stays one)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await revoke(c, s.a, s.owner);
      const newer = randomUUID();
      await c.query("insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values ($1, $2, $3, $4, 'x')",
        [newer, s.a, s.owner, hex()]);
      expect(await restore(c, s.a, s.owner, s.ownerFeed, r.r.revoked_at!, null)).toBe("changed");
      expect(await revokedAt(c, s.ownerFeed)).not.toBeNull();
      expect(await revokedAt(c, newer)).toBeNull();
    }));

  it("case 6: replace with nothing live answers none and inserts nothing", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const next = randomUUID();
      expect(await replace(c, s.a, s.staff, next, hex())).toEqual({ status: "none" });
      const { rows } = await c.query("select id from calendar_feeds where id = $1", [next]);
      expect(rows).toEqual([]);
    }));

  it("case 6: restore's window below 1 second raises 22023", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, "select public.restore_calendar_feed($1, $2, $3, now(), null, 0)", [s.a, s.owner, s.ownerFeed]))
        .toMatchObject({ code: "22023" });
    }));
});

describe("0104 revoke_calendar_feed (P6b)", () => {
  it("case 6b: turn-off answers the feed and revoked_at equal to the DATABASE's now() (probe M7: clock_timestamp() -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await revoke(c, s.a, s.owner);
      expect(r.r).toMatchObject({ status: "ok", feed_id: s.ownerFeed });
      expect(r.at_now).toBe(true);
      expect(await claim(c, s.ownerHash)).toEqual({ status: "not_found" });
    }));

  it("case 6b: a SAME-ACCOUNT member with no link cannot restore someone else's link (probe M5: drop `and user_id = p_user_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = await revoke(c, s.a, s.owner);
      expect(await restore(c, s.a, s.staff, s.ownerFeed, r.r.revoked_at!, null)).toBe("changed");
      expect(await revokedAt(c, s.ownerFeed)).not.toBeNull();
      expect(await restore(c, s.a, s.owner, s.ownerFeed, r.r.revoked_at!, null)).toBe("restored");
      expect(await revokedAt(c, s.ownerFeed)).toBeNull();
    }));

  it("case 6b: turn-off with nothing live answers none", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await revoke(c, s.a, s.staff)).r).toEqual({ status: "none" });
    }));
});

describe("0104 calendar_feeds: leaving takes the link (P7)", () => {
  it("case 7: deleting the membership deletes every link it held, turned-off ones too (probe M2: FK without cascade -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("update calendar_feeds set revoked_at = now() where id = $1", [s.techFeed]);
      await c.query("insert into calendar_feeds (id, account_id, user_id, token_hash, created_by) values (gen_random_uuid(), $1, $2, $3, 'x')",
        [s.a, s.tech, hex()]);
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.tech]);
      const { rows } = await c.query("select id from calendar_feeds where user_id = $1", [s.tech]);
      expect(rows).toEqual([]);
      expect(await claim(c, s.ownerHash)).toMatchObject({ status: "ok" });
    }));

  it("case 7: deleting the user deletes their links (users -> memberships -> calendar_feeds)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("delete from users where id = $1", [s.bOwner]);
      const { rows } = await c.query("select id from calendar_feeds where id = $1", [s.bFeed]);
      expect(rows).toEqual([]);
    }));

  it("case 7: deleting the account deletes every link in it, and only those", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("delete from accounts where id = $1", [s.b]);
      const { rows } = await c.query<{ id: string }>("select id from calendar_feeds where id = any($1::uuid[]) order by id",
        [[s.ownerFeed, s.techFeed, s.bFeed]]);
      expect(rows.map((r) => r.id).sort()).toEqual([s.ownerFeed, s.techFeed].sort());
    }));
});

describe("0104: service_role's own grants run all four functions (they are invokers)", () => {
  it("claim, turn off, Undo and replace all run under set local role service_role", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      expect(await claim(c, s.ownerHash)).toMatchObject({ status: "ok", role: "owner" });
      const r = await revoke(c, s.a, s.owner);
      expect(r.r).toMatchObject({ status: "ok", feed_id: s.ownerFeed });
      expect(await restore(c, s.a, s.owner, s.ownerFeed, r.r.revoked_at!, null)).toBe("restored");
      const next = randomUUID();
      const nextHash = hex();
      expect(await replace(c, s.a, s.owner, next, nextHash)).toMatchObject({ status: "ok", previous_id: s.ownerFeed });
      expect(await claim(c, nextHash)).toMatchObject({ status: "ok", feed_id: next });
    }));
});

describe("0104: teardown", () => {
  it("case 8: calendar_feeds is on ACCOUNT_OWNED_TABLES, before bookings, and the first two stay the AI tables (probe: remove \"calendar_feeds\" -> FAILS)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.indexOf("calendar_feeds")).toBeGreaterThanOrEqual(0);
    expect(listed.indexOf("calendar_feeds")).toBeLessThan(listed.indexOf("bookings"));
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});
