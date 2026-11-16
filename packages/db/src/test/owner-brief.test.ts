import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRollback, actAs, actAsMember } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { addAccountMember, type AccountRole } from "../team";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  DAILY_BRIEF_ROLES, subscribeToBrief, unsubscribeFromBrief, listMySubscriptions, listDueBriefSubscriptions,
  claimBriefDay, releaseBriefDay, stampBriefOutcome,
} from "../owner-brief";

/**
 * The daily owner brief, PR 1: public.owner_brief_subscriptions (migration owner_brief_subscriptions) and its
 * accessors. Plan docs/superpowers/plans/2026-11-15-daily-owner-brief.md, D1 (who receives), D2 (storage) and D4
 * (claim, release, stamp).
 *
 * Three kinds of case, each with its own red:
 *   - SCHEMA AND GRANTS (withRollback, raw pg as the table owner unless a case switches role). RED BEFORE APPLY:
 *     every one (42P01 on the table, or a missing catalog row). GREEN AFTER APPLY.
 *   - THE ACCESSORS, LIVE (withTestAccount, serviceDb through PostgREST). RED BEFORE: the module does not exist, and
 *     after it does, the table does not (PGRST205). GREEN AFTER APPLY.
 *   - THE PAGER (a PostgREST-shaped fake, no database). RED BEFORE: the module does not exist.
 * The teardown case is pure: red until the table is on ACCOUNT_OWNED_TABLES.
 */
const TABLE = "public.owner_brief_subscriptions";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
/** The three per-day columns D4 writes. Never the row's identity (id, user_id, account_id) or when it was enabled. */
const UPDATABLE = ["last_handled_day", "last_outcome", "last_sent_day"];
const RUN = randomBytes(4).toString("hex");

// ---------------------------------------------------------------------------------------------------------------
// Schema and grants (withRollback)
// ---------------------------------------------------------------------------------------------------------------

type Seed = { a: string; b: string; orgA: string; owner: string; staff: string; tech: string; outsider: string };

/** Two accounts (client access on), an Owner, a Staff and a Technician on A, and a person on no team. */
async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OB schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string; clerk_org_id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id, clerk_org_id",
    [ag!.id, `org_ob_${tag}_${RUN}`, `OB ${tag}`])).rows[0]!;
  const a = await acct("a");
  const b = await acct("b");
  const user = async (tag: string) => (await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`user_ob_${tag}_${RUN}`])).rows[0]!.id;
  const owner = await user("owner");
  const staff = await user("staff");
  const tech = await user("tech");
  const outsider = await user("outsider");
  for (const [u, role] of [[owner, "owner"], [staff, "staff"], [tech, "technician"]] as const) {
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u, a.id, role]);
  }
  // The Owner is on B too, so one person holds two subscriptions.
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner')", [owner, b.id]);
  return { a: a.id, b: b.id, orgA: a.clerk_org_id, owner, staff, tech, outsider };
}

async function subscribe(c: Client, accountId: string, userId: string, over: Record<string, unknown> = {}): Promise<string> {
  const row: Record<string, unknown> = { account_id: accountId, user_id: userId, ...over };
  const cols = Object.keys(row);
  const { rows: [r] } = await c.query<{ id: string }>(
    `insert into ${TABLE} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    Object.values(row));
  return r!.id;
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

describe("owner_brief_subscriptions: grants and RLS", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a grant to PUBLIC as every role's own
  // and sees PG17's MAINTAIN (0051's note).
  it("the whole table privilege matrix is service_role's DELETE, INSERT, SELECT and nothing else (probe: drop authenticated from the revoke -> FAILS)", () =>
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

  it("service_role may UPDATE exactly the three per-day columns (probe: grant update on the table to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select a.attname as n from pg_attribute a
          where a.attrelid = '${TABLE}'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('service_role', '${TABLE}', a.attname, 'UPDATE') order by 1`);
      expect(rows.map((r) => r.n)).toEqual(UPDATABLE);
    }));

  it("no column-level privilege for anon, authenticated or PUBLIC", () =>
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

  it.each(["the account's own signed-in Owner", "anon"])(
    "%s can neither read nor write it: every statement is refused 42501, not shown zero rows", (who) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await subscribe(c, s.a, s.owner);
      if (who === "anon") {
        await actAs(c, {});
        await c.query("set local role anon");
      } else {
        // actAsMember seeds its own users row and membership as the owner, then switches to authenticated.
        await actAsMember(c, s.a, s.orgA, "owner");
      }
      const refused = async (sql: string, params: unknown[] = []) =>
        ((await refusedWith(c, () => c.query(sql, params))) as { code?: string } | null)?.code ?? "ran";
      expect({
        select: await refused(`select id from ${TABLE}`),
        insert: await refused(`insert into ${TABLE} (account_id, user_id) values ($1, $2)`, [s.a, s.staff]),
        update: await refused(`update ${TABLE} set last_handled_day = '2027-01-01' where id = $1`, [id]),
        delete: await refused(`delete from ${TABLE} where id = $1`, [id]),
      }).toEqual({ select: "42501", insert: "42501", update: "42501", delete: "42501" });
    }));

  it("service_role reads, inserts, updates the per-day columns and deletes on its own grants", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      const id = await subscribe(c, s.a, s.owner);
      await c.query(`update ${TABLE} set last_handled_day = '2027-03-14', last_sent_day = '2027-03-14', last_outcome = 'sent' where id = $1`, [id]);
      const { rows } = await c.query(`select to_char(last_sent_day, 'YYYY-MM-DD') as d, last_outcome from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ d: "2027-03-14", last_outcome: "sent" }]);
      await c.query(`delete from ${TABLE} where id = $1`, [id]);
      expect((await c.query(`select id from ${TABLE} where id = $1`, [id])).rows).toEqual([]);
    }));

  it.each(["account_id", "user_id", "enabled_at", "created_at"])(
    "service_role cannot UPDATE %s (42501): a subscription never moves to another person or business",
    (col) => withRollback(async (c) => {
      const s = await seed(c);
      const id = await subscribe(c, s.a, s.owner);
      const value = col === "account_id" ? s.b : col === "user_id" ? s.staff : new Date();
      await c.query("set local role service_role");
      await expect(c.query(`update ${TABLE} set ${col} = $1 where id = $2`, [value, id])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("owner_brief_subscriptions: the table's shape", () => {
  it("the columns are exactly the plan's D2, in order, with their types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name as n, data_type as t, is_nullable as nl, column_default as d
           from information_schema.columns where table_schema = 'public' and table_name = 'owner_brief_subscriptions'
          order by ordinal_position`);
      expect(rows).toEqual([
        { n: "id", t: "uuid", nl: "NO", d: "gen_random_uuid()" },
        { n: "user_id", t: "uuid", nl: "NO", d: null },
        { n: "account_id", t: "uuid", nl: "NO", d: null },
        { n: "enabled_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "last_handled_day", t: "date", nl: "YES", d: null },
        { n: "last_sent_day", t: "date", nl: "YES", d: null },
        { n: "last_outcome", t: "text", nl: "YES", d: null },
        { n: "created_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
      ]);
    }));

  it("the indexes, foreign keys and checks are exactly these", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'owner_brief_subscriptions' order by indexname");
      expect(Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]))).toEqual({
        owner_brief_subscriptions_one_per_member:
          "CREATE UNIQUE INDEX owner_brief_subscriptions_one_per_member ON public.owner_brief_subscriptions USING btree (account_id, user_id)",
        owner_brief_subscriptions_pkey:
          "CREATE UNIQUE INDEX owner_brief_subscriptions_pkey ON public.owner_brief_subscriptions USING btree (id)",
      });
      // contype 'n' excluded: PG18 (the replica) stores NOT NULL as constraint rows, PG17 (the projects) does not.
      const { rows: cons } = await c.query<{ conname: string; d: string }>(
        `select conname, pg_get_constraintdef(oid) as d from pg_constraint
          where conrelid = '${TABLE}'::regclass and contype in ('f', 'c') order by conname`);
      expect(Object.fromEntries(cons.map((r) => [r.conname, r.d]))).toEqual({
        owner_brief_subscriptions_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        owner_brief_subscriptions_user_id_fkey: "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE",
        owner_brief_subscriptions_member_fkey:
          "FOREIGN KEY (account_id, user_id) REFERENCES memberships(account_id, user_id) ON DELETE CASCADE",
        owner_brief_subscriptions_last_outcome_check:
          "CHECK ((last_outcome = ANY (ARRAY['sent'::text, 'quiet'::text])))",
        owner_brief_subscriptions_sent_day_check:
          "CHECK (((last_sent_day IS NULL) OR ((last_handled_day IS NOT NULL) AND (last_sent_day <= last_handled_day))))",
      });
    }));
});

describe("owner_brief_subscriptions: what the constraints refuse", () => {
  it("one subscription per person per business: a second row for the same pair -> 23505 owner_brief_subscriptions_one_per_member; the same person on another business is accepted (probe: drop the unique -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await subscribe(c, s.a, s.owner);
      expect(await refusedWith(c, () => subscribe(c, s.a, s.owner)))
        .toMatchObject({ code: "23505", constraint: "owner_brief_subscriptions_one_per_member" });
      expect(await refusedWith(c, () => subscribe(c, s.b, s.owner))).toBeNull();
    }));

  it("a person on no team of that business cannot subscribe to it -> 23503 owner_brief_subscriptions_member_fkey", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, () => subscribe(c, s.a, s.outsider)))
        .toMatchObject({ code: "23503", constraint: "owner_brief_subscriptions_member_fkey" });
      // The Staff member of A is not on B.
      expect(await refusedWith(c, () => subscribe(c, s.b, s.staff)))
        .toMatchObject({ code: "23503", constraint: "owner_brief_subscriptions_member_fkey" });
    }));

  const refusals: { name: string; over: Record<string, unknown>; constraint: string }[] = [
    { name: "an outcome outside sent and quiet", over: { last_handled_day: "2027-03-14", last_outcome: "skipped" }, constraint: "owner_brief_subscriptions_last_outcome_check" },
    { name: "a sent day with no handled day", over: { last_sent_day: "2027-03-14" }, constraint: "owner_brief_subscriptions_sent_day_check" },
    { name: "a sent day after the handled day", over: { last_handled_day: "2027-03-13", last_sent_day: "2027-03-14" }, constraint: "owner_brief_subscriptions_sent_day_check" },
  ];
  it.each(refusals)("$name -> 23514 $constraint", ({ over, constraint }) =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, () => subscribe(c, s.a, s.owner, over))).toMatchObject({ code: "23514", constraint });
      expect(await refusedWith(c, () => subscribe(c, s.a, s.owner))).toBeNull();
    }));

  it("a sent day equal to or before the handled day, and a quiet outcome, are accepted", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, () => subscribe(c, s.a, s.owner, { last_handled_day: "2027-03-14", last_sent_day: "2027-03-14", last_outcome: "sent" }))).toBeNull();
      expect(await refusedWith(c, () => subscribe(c, s.a, s.staff, { last_handled_day: "2027-03-15", last_sent_day: "2027-03-14", last_outcome: "quiet" }))).toBeNull();
    }));
});

describe("owner_brief_subscriptions: what deleting a parent does", () => {
  it("deleting the account deletes its subscriptions, and only its own (probe: FK without cascade -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const onA = await subscribe(c, s.a, s.owner);
      const onB = await subscribe(c, s.b, s.owner);
      await c.query("delete from accounts where id = $1", [s.a]);
      const { rows } = await c.query<{ id: string }>(`select id from ${TABLE} where id = any($1::uuid[])`, [[onA, onB]]);
      expect(rows).toEqual([{ id: onB }]);
    }));

  it("deleting the person deletes every subscription of theirs, and nobody else's", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const mine = [await subscribe(c, s.a, s.owner), await subscribe(c, s.b, s.owner)];
      const theirs = await subscribe(c, s.a, s.staff);
      await c.query("delete from users where id = $1", [s.owner]);
      const { rows } = await c.query<{ id: string }>(`select id from ${TABLE} where id = any($1::uuid[])`, [[...mine, theirs]]);
      expect(rows).toEqual([{ id: theirs }]);
    }));

  it("removing the person from ONE team deletes that business's subscription and keeps their other one", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const onA = await subscribe(c, s.a, s.owner);
      const onB = await subscribe(c, s.b, s.owner);
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.owner]);
      const { rows } = await c.query<{ id: string }>(`select id from ${TABLE} where id = any($1::uuid[])`, [[onA, onB]]);
      expect(rows).toEqual([{ id: onB }]);
    }));

  it("a role change keeps the subscription (the send-time role filter decides, D1)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await subscribe(c, s.a, s.staff);
      await c.query("update memberships set role = 'technician' where account_id = $1 and user_id = $2", [s.a, s.staff]);
      expect((await c.query(`select id from ${TABLE} where id = $1`, [id])).rows).toEqual([{ id }]);
    }));
});

describe("owner_brief_subscriptions: teardown", () => {
  it("is on ACCOUNT_OWNED_TABLES, and the first two stay the AI tables (probe: remove it -> FAILS)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed).toContain("owner_brief_subscriptions");
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The accessors, live (withTestAccount + serviceDb through PostgREST)
// ---------------------------------------------------------------------------------------------------------------

/** A users row for this run, and (unless role is null) a membership on the account. */
async function person(
  db: SupabaseClient, accountId: string, tag: string, role: AccountRole | null, language: "en" | "es" | null = null,
): Promise<string> {
  const clerk = `user_ob_${tag}_${RUN}`;
  const { data, error } = await db.from("users")
    .insert({ clerk_user_id: clerk, email: `${clerk}@example.com`, language }).select("id").single();
  if (error) throw error;
  const id = data!.id as string;
  if (role) await addAccountMember(db, { accountId, userId: id, role });
  return id;
}

/** withTestAccount with client access ON (the default is off, 0008), then this run's users rows. Users go last: the
 *  account's teardown takes the memberships and subscriptions, and a users delete then has nothing left to cascade. */
async function withBriefAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>): Promise<void> {
  try {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId);
      if (error) throw error;
      await fn(db, accountId);
    });
  } finally {
    const { error } = await serviceDb().from("users").delete().like("clerk_user_id", `user_ob_%_${RUN}`);
    if (error) throw new Error(`owner-brief.test cleanup failed on users: ${error.message}`);
  }
}

async function setAccount(db: SupabaseClient, accountId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("accounts").update(patch).eq("id", accountId);
  if (error) throw error;
}

/** Due rows for THIS account only: the read spans every account in the project, other runs' included. */
const dueOn = async (db: SupabaseClient, accountId: string) =>
  (await listDueBriefSubscriptions(db)).filter((r) => r.accountId === accountId);

async function rowOf(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("owner_brief_subscriptions")
    .select("last_handled_day, last_sent_day, last_outcome").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

describe("DAILY_BRIEF_ROLES", () => {
  it("is Owner and Staff, never a Technician (D1, owner answer Q1; probe: add 'technician' -> FAILS)", () => {
    expect([...DAILY_BRIEF_ROLES]).toEqual(["owner", "staff"]);
  });
});

describe("subscribeToBrief / unsubscribeFromBrief / listMySubscriptions", () => {
  it("subscribing twice keeps ONE row (the same id), and listMySubscriptions shows it", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "sub", "owner");
      const first = await subscribeToBrief(db, { userId: owner, accountId });
      const again = await subscribeToBrief(db, { userId: owner, accountId });
      expect(again.id).toBe(first.id);
      expect(first).toMatchObject({ userId: owner, accountId, lastHandledDay: null, lastSentDay: null, lastOutcome: null });
      expect((await listMySubscriptions(db, owner)).map((s) => s.id)).toEqual([first.id]);
    }));

  it("a person on no team of the business cannot subscribe (the write throws)", () =>
    withBriefAccount(async (db, accountId) => {
      const outsider = await person(db, accountId, "outsider", null);
      await expect(subscribeToBrief(db, { userId: outsider, accountId })).rejects.toThrow(/subscribeToBrief failed/);
      expect(await listMySubscriptions(db, outsider)).toEqual([]);
    }));

  it("unsubscribing by person and business deletes the row; a second unsubscribe answers false", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "unsub", "owner");
      await subscribeToBrief(db, { userId: owner, accountId });
      expect(await unsubscribeFromBrief(db, { userId: owner, accountId })).toBe(true);
      expect(await unsubscribeFromBrief(db, { userId: owner, accountId })).toBe(false);
      expect(await listMySubscriptions(db, owner)).toEqual([]);
    }));

  it("unsubscribing by id deletes only that row", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "unsubid", "owner");
      const staff = await person(db, accountId, "keep", "staff");
      const mine = await subscribeToBrief(db, { userId: owner, accountId });
      const theirs = await subscribeToBrief(db, { userId: staff, accountId });
      expect(await unsubscribeFromBrief(db, { id: mine.id })).toBe(true);
      expect(await unsubscribeFromBrief(db, { id: mine.id })).toBe(false);
      expect((await listMySubscriptions(db, staff)).map((s) => s.id)).toEqual([theirs.id]);
    }));
});

describe("claimBriefDay / releaseBriefDay / stampBriefOutcome (D4)", () => {
  it("eight concurrent claims of the same day: exactly one wins (probe: make the claim unconditional -> FAILS)", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "race", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      const wins = await Promise.all(Array.from({ length: 8 }, () => claimBriefDay(db, id, "2027-03-14")));
      expect(wins.filter(Boolean)).toHaveLength(1);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: "2027-03-14", last_sent_day: null, last_outcome: null });
    }));

  it("a later day can be claimed; the same or an earlier day cannot", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "days", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(true);
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(false);
      expect(await claimBriefDay(db, id, "2027-03-13")).toBe(false);
      expect(await claimBriefDay(db, id, "2027-03-15")).toBe(true);
      expect((await rowOf(db, id))?.last_handled_day).toBe("2027-03-15");
    }));

  it("a claim on a deleted subscription answers false", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "gone", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      await unsubscribeFromBrief(db, { id });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(false);
    }));

  it("release restores the day before the claim (null on a first claim, the earlier day after one), and the next tick can claim again", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "release", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(true);
      expect(await releaseBriefDay(db, { id, day: "2027-03-14", previous: null })).toBe(true);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: null, last_sent_day: null, last_outcome: null });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(true);
      expect(await stampBriefOutcome(db, { id, day: "2027-03-14", outcome: "quiet" })).toBe(true);

      expect(await claimBriefDay(db, id, "2027-03-15")).toBe(true);
      expect(await releaseBriefDay(db, { id, day: "2027-03-15", previous: "2027-03-14" })).toBe(true);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: "2027-03-14", last_sent_day: null, last_outcome: "quiet" });
      expect(await claimBriefDay(db, id, "2027-03-15")).toBe(true);
    }));

  it("release answers false and changes nothing when the day is not the one held", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "notheld", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await claimBriefDay(db, id, "2027-03-15")).toBe(true);
      expect(await releaseBriefDay(db, { id, day: "2027-03-14", previous: null })).toBe(false);
      expect((await rowOf(db, id))?.last_handled_day).toBe("2027-03-15");
    }));

  it("a day already stamped SENT is never released, so a mis-ordered release cannot send it twice (probe: drop the sent-day guard -> FAILS)", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "sentkeep", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(true);
      expect(await stampBriefOutcome(db, { id, day: "2027-03-14", outcome: "sent" })).toBe(true);
      expect(await releaseBriefDay(db, { id, day: "2027-03-14", previous: null })).toBe(false);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: "2027-03-14", last_sent_day: "2027-03-14", last_outcome: "sent" });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(false);
    }));

  it("stamp 'sent' records the sent day and the outcome; stamp 'quiet' records the outcome and keeps the last sent day", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "stamp", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await claimBriefDay(db, id, "2027-03-14")).toBe(true);
      expect(await stampBriefOutcome(db, { id, day: "2027-03-14", outcome: "sent" })).toBe(true);
      expect(await claimBriefDay(db, id, "2027-03-15")).toBe(true);
      expect(await stampBriefOutcome(db, { id, day: "2027-03-15", outcome: "quiet" })).toBe(true);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: "2027-03-15", last_sent_day: "2027-03-14", last_outcome: "quiet" });
      const [mine] = await listMySubscriptions(db, owner);
      expect(mine).toMatchObject({ lastHandledDay: "2027-03-15", lastSentDay: "2027-03-14", lastOutcome: "quiet" });
    }));

  it("stamp answers false and writes nothing when the day was not claimed (probe: drop the claim condition from the stamp -> FAILS)", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "unclaimed", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect(await stampBriefOutcome(db, { id, day: "2027-03-14", outcome: "quiet" })).toBe(false);
      expect(await rowOf(db, id)).toEqual({ last_handled_day: null, last_sent_day: null, last_outcome: null });
    }));

  it.each([["2027-3-14"], ["2027-03-14,id.neq.x"], ["2027-02-30"], [""]])(
    "a day that is not a real YYYY-MM-DD (%j) is refused before any write", async (day) => {
      // No database reached: the guard throws first, so any id will do.
      const db = serviceDb();
      await expect(claimBriefDay(db, "00000000-0000-0000-0000-000000000000", day)).rejects.toThrow(/not a calendar day/);
    });
});

describe("listDueBriefSubscriptions (D1)", () => {
  it("lists the Owner's and the Staff member's subscriptions with everything the pass needs, and never the Technician's (probe: drop the role filter -> FAILS)", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "downer", "owner", "es");
      const staff = await person(db, accountId, "dstaff", "staff");
      const tech = await person(db, accountId, "dtech", "technician");
      const o = await subscribeToBrief(db, { userId: owner, accountId });
      const s = await subscribeToBrief(db, { userId: staff, accountId });
      await subscribeToBrief(db, { userId: tech, accountId });
      await setAccount(db, accountId, { timezone: "America/Denver", brand_name: "Rio Roofing", language: "es" });

      const due = await dueOn(db, accountId);
      expect(due.map((r) => r.subscriptionId).sort()).toEqual([o.id, s.id].sort());
      const mine = due.find((r) => r.subscriptionId === o.id)!;
      expect(mine).toEqual({
        subscriptionId: o.id, userId: owner, accountId, role: "owner",
        email: `user_ob_downer_${RUN}@example.com`, personLanguage: "es", accountLanguage: "es",
        accountTimezone: "America/Denver", brandName: "Rio Roofing",
        branding: expect.objectContaining({ brandName: "Rio Roofing" }), replyToEmail: null,
        enabledAt: expect.any(String), lastHandledDay: null, lastSentDay: null, lastOutcome: null,
      });
      expect(due.find((r) => r.subscriptionId === s.id)).toMatchObject({ role: "staff", personLanguage: null });
    }));

  it("a Staff member demoted to Technician drops off the list at once; promoted back, they return", () =>
    withBriefAccount(async (db, accountId) => {
      const staff = await person(db, accountId, "demote", "staff");
      const { id } = await subscribeToBrief(db, { userId: staff, accountId });
      const role = async (r: AccountRole) => {
        const { error } = await db.from("memberships").update({ role: r }).eq("account_id", accountId).eq("user_id", staff);
        if (error) throw error;
      };
      await role("technician");
      expect(await dueOn(db, accountId)).toEqual([]);
      await role("staff");
      expect((await dueOn(db, accountId)).map((r) => r.subscriptionId)).toEqual([id]);
    }));

  it.each([
    ["an outbound-suppressed account (probe: drop the suppressed filter -> FAILS)", { outbound_suppressed: true }],
    ["an archived account", { status: "archived" }],
    ["an account with client access off", { client_access_enabled: false }],
  ])("lists nothing for %s", (_name, patch) =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "gated", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      expect((await dueOn(db, accountId)).map((r) => r.subscriptionId)).toEqual([id]);
      await setAccount(db, accountId, patch);
      expect(await dueOn(db, accountId)).toEqual([]);
    }));

  it("a paused account still lists (only archived stops it, as listMyMemberships reads it)", () =>
    withBriefAccount(async (db, accountId) => {
      const owner = await person(db, accountId, "paused", "owner");
      const { id } = await subscribeToBrief(db, { userId: owner, accountId });
      await setAccount(db, accountId, { status: "paused" });
      expect((await dueOn(db, accountId)).map((r) => r.subscriptionId)).toEqual([id]);
    }));
});

// ---------------------------------------------------------------------------------------------------------------
// The pager (a PostgREST-shaped fake; no database)
// ---------------------------------------------------------------------------------------------------------------

type Answer = { data: unknown; error: unknown };
function fakeDb(answers: Answer[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  let next = 0;
  const answer = () => Promise.resolve(answers[next++] ?? { data: [], error: null });
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const k of ["select", "in", "eq", "neq", "order", "range"]) {
    chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  }
  (chain as { then?: unknown }).then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => answer().then(res, rej);
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

const dueRow = (id: string) => ({
  id, user_id: `u-${id}`, account_id: `a-${id}`, enabled_at: "2027-01-01T00:00:00Z", created_at: "2027-01-01T00:00:00Z",
  last_handled_day: null, last_sent_day: null, last_outcome: null,
  users: { email: `${id}@example.com`, language: null },
  memberships: { role: "owner" },
  accounts: {
    status: "active", client_access_enabled: true, timezone: "America/Chicago", brand_name: id, brand_logo_path: null,
    brand_color: null, brand_neutral: null, brand_corners: null, brand_type: null, brand_mode: null, reply_to_email: null,
    from_email: null, outbound_suppressed: false, mailing_address: null, language: null,
  },
});

describe("listDueBriefSubscriptions: the pager (PostgREST's silent max_rows)", () => {
  it("keeps paging past short pages until an EMPTY one, advancing by the rows actually returned (probe: stop on a short page -> FAILS)", async () => {
    const f = fakeDb([
      { data: [dueRow("a"), dueRow("b")], error: null },
      { data: [dueRow("c")], error: null },
      { data: [], error: null },
    ]);
    const rows = await listDueBriefSubscriptions(f.db);
    expect(rows.map((r) => r.subscriptionId)).toEqual(["a", "b", "c"]);
    const ranges = f.calls.filter((c) => c[0] === "range").map((c) => [c[1], c[2]]);
    expect(ranges).toEqual([[0, 999], [2, 1001], [3, 1002]]);
  });

  it("is ONE statement per page, from owner_brief_subscriptions, in a total order (created_at, then id)", async () => {
    const f = fakeDb([{ data: [], error: null }]);
    await listDueBriefSubscriptions(f.db);
    expect(f.calls.filter((c) => c[0] === "from")).toEqual([["from", "owner_brief_subscriptions"]]);
    expect(f.calls).toContainEqual(["order", "created_at", { ascending: true }]);
    expect(f.calls).toContainEqual(["order", "id", { ascending: true }]);
  });

  it("a page error throws, naming the read", async () => {
    const f = fakeDb([{ data: null, error: { message: "boom" } }]);
    await expect(listDueBriefSubscriptions(f.db)).rejects.toThrow(/listDueBriefSubscriptions failed: boom/);
  });
});
