import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0097_one_switch.sql (S-47d): business_status, closed_days, calls.business_status, the closure To-do link on
 * tasks, bookings.closure_kept_at, the two stamp triggers, keep_task_links re-created, grants and RLS.
 * RED BEFORE APPLY: every case names an object that does not exist yet, except the teardown-list case (green
 * on pre by design).
 *
 * Every refusal names its constraint AND is shaped so that constraint is the only one that can refuse it.
 * Postgres tests a table's CHECKs in name order, so a row that would fail two names the first.
 * SD1: a Staff update INTO a closure fails the policy WITH CHECK, which RAISES 42501; an update OUT of a
 * closure fails USING, which matches no row. The two are asserted differently on purpose.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Seed = { accountId: string; orgId: string };
type Role = "owner" | "staff" | "technician";
type Patch = { state: string; late: number | null; until: string | null };

const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function seed(c: Client, label: string): Promise<Seed> {
  await actAsOwner(c);
  const orgId = `org_switch_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Switch') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'One switch', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.business_status (account_id) values ($1)", [account!.id]);
  return { accountId: account!.id, orgId };
}

/** The stored row, put in place as the table owner with the stamp off, so set_at may lie in the past. */
async function store(c: Client, accountId: string, p: Patch & { setAt?: string }) {
  await actAsOwner(c);
  await c.query("alter table public.business_status disable trigger business_status_stamp");
  await c.query(
    `update public.business_status set state = $2, late_minutes = $3, until = $4::timestamptz,
       set_at = coalesce($5::timestamptz, now()) where account_id = $1`,
    [accountId, p.state, p.late, p.until, p.setAt ?? null]);
  await c.query("alter table public.business_status enable trigger business_status_stamp");
}

/** One signed-in UPDATE of the three granted columns; resolves to the row count, or rejects. */
async function updateAs(c: Client, s: Seed, role: Role, p: Patch): Promise<number> {
  await actAsOwner(c);
  await actAsMember(c, s.accountId, s.orgId, role);
  const r = await c.query(
    "update public.business_status set state = $2, late_minutes = $3, until = $4::timestamptz where account_id = $1",
    [s.accountId, p.state, p.late, p.until]);
  return r.rowCount ?? 0;
}

const OPEN: Patch = { state: "open", late: null, until: null };
const late = (m: number): Patch => ({ state: "running_late", late: m, until: at(5) });
const closedToday = (): Patch => ({ state: "closed_today", late: null, until: at(20) });
const stormDated = (): Patch => ({ state: "storm", late: null, until: at(30) });
const STORM_OPEN: Patch = { state: "storm", late: null, until: null };
/** A storm back on tomorrow: inside the Staff 26-hour bound, so only the WITH CHECK state clause can refuse it. */
const stormSoon = (): Patch => ({ state: "storm", late: null, until: at(20) });

describe("0097 shape", () => {
  it("business_status columns, types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'business_status' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "state", data_type: "text", is_nullable: "NO", column_default: "'open'::text" },
        { column_name: "late_minutes", data_type: "integer", is_nullable: "YES", column_default: null },
        { column_name: "until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "set_by", data_type: "text", is_nullable: "NO", column_default: "'system'::text" },
        { column_name: "set_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));
  it("closed_days columns", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'closed_days' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "starts_on", data_type: "date", is_nullable: "NO", column_default: null },
        { column_name: "ends_on", data_type: "date", is_nullable: "NO", column_default: null },
        { column_name: "reason", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "created_by", data_type: "text", is_nullable: "NO", column_default: null },
        { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));
  it("the four added columns are nullable with no default (so the running build's inserts leave them NULL)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select table_name || '.' || column_name as k, data_type, is_nullable, column_default
        from information_schema.columns where table_schema = 'public' and (
          (table_name = 'calls' and column_name = 'business_status') or
          (table_name = 'tasks' and column_name in ('closure_kind', 'closure_on')) or
          (table_name = 'bookings' and column_name = 'closure_kept_at')) order by 1`);
      expect(rows).toEqual([
        { k: "bookings.closure_kept_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { k: "calls.business_status", data_type: "text", is_nullable: "YES", column_default: null },
        { k: "tasks.closure_kind", data_type: "text", is_nullable: "YES", column_default: null },
        { k: "tasks.closure_on", data_type: "date", is_nullable: "YES", column_default: null },
      ]);
    }));
  it("every new constraint, as defined (read off the plan writer's PG18 replica, 2026-10-23; contype 'n' excluded: CI is PG17)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype <> 'n'
           and (conrelid in ('public.business_status'::regclass, 'public.closed_days'::regclass)
                or conname in ('calls_business_status_check', 'tasks_closure_kind_check', 'tasks_closure_coherent'))
         order by conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        business_status_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        business_status_late_minutes_check: "CHECK ((late_minutes = ANY (ARRAY[15, 30, 60, 120])))",
        business_status_pkey: "PRIMARY KEY (account_id)",
        business_status_shape_check: "CHECK ((((state = 'open'::text) AND (late_minutes IS NULL) AND (until IS NULL)) OR ((state = 'closed_today'::text) AND (late_minutes IS NULL) AND (until IS NOT NULL)) OR ((state = 'running_late'::text) AND (late_minutes IS NOT NULL) AND (until IS NOT NULL)) OR ((state = 'storm'::text) AND (late_minutes IS NULL))))",
        business_status_state_check: "CHECK ((state = ANY (ARRAY['open'::text, 'closed_today'::text, 'running_late'::text, 'storm'::text])))",
        business_status_until_check: "CHECK (((until IS NULL) OR ((until > set_at) AND (until <= (set_at + '100 days'::interval)))))",
        calls_business_status_check: "CHECK ((business_status = ANY (ARRAY['open'::text, 'closed_today'::text, 'running_late_15'::text, 'running_late_30'::text, 'running_late_60'::text, 'running_late_120'::text, 'storm'::text, 'closed_day'::text])))",
        closed_days_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        closed_days_pkey: "PRIMARY KEY (id)",
        closed_days_range_check: "CHECK (((ends_on >= starts_on) AND ((ends_on - starts_on) <= 91)))",
        closed_days_reason_check: "CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['holiday'::text, 'vacation'::text, 'other'::text]))))",
        tasks_closure_coherent: "CHECK (((closure_kind IS NULL) = (closure_on IS NULL)))",
        tasks_closure_kind_check: "CHECK ((closure_kind = ANY (ARRAY['status'::text, 'closed_day'::text])))",
      });
    }));
  it("the two indexes, as defined", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select indexname, indexdef from pg_indexes
        where indexname in ('tasks_closure_once', 'closed_days_account_ends') order by 1`);
      expect(rows).toEqual([
        { indexname: "closed_days_account_ends", indexdef: "CREATE INDEX closed_days_account_ends ON public.closed_days USING btree (account_id, ends_on)" },
        { indexname: "tasks_closure_once", indexdef: "CREATE UNIQUE INDEX tasks_closure_once ON public.tasks USING btree (account_id, closure_kind, closure_on) WHERE (closure_kind IS NOT NULL)" },
      ]);
    }));
});

describe("0097 business_status CHECKs, each by name", () => {
  const SHAPE = { code: "23514", constraint: "business_status_shape_check" };
  it.each([
    ["open with a delay", { state: "open", late: 15, until: null }],
    ["open with an end", { state: "open", late: null, until: at(5) }],
    ["closed_today with no end", { state: "closed_today", late: null, until: null }],
    ["closed_today with a delay", { state: "closed_today", late: 30, until: at(5) }],
    ["running_late with no delay", { state: "running_late", late: null, until: at(5) }],
    ["running_late with no end", { state: "running_late", late: 30, until: null }],
    ["storm with a delay", { state: "storm", late: 60, until: null }],
    ["an unknown state (the shape check is first by name)", { state: "closed", late: null, until: null }],
  ] as const)("refuses %s (mutation: drop business_status_shape_check -> FAILS)", (_n, p) =>
    withRollback(async (c) => {
      const s = await seed(c, "shape");
      await expect(store(c, s.accountId, p)).rejects.toMatchObject(SHAPE);
    }));
  it.each([OPEN, late(15), late(30), late(60), late(120), closedToday(), stormDated(), STORM_OPEN])
    ("accepts the valid row %o", (p) =>
      withRollback(async (c) => { const s = await seed(c, "shape_ok"); await store(c, s.accountId, p); }));
  it("refuses a 45-minute delay by business_status_late_minutes_check (mutation: add 45 to the list -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "late45");
      await expect(store(c, s.accountId, late(45))).rejects.toMatchObject({ code: "23514", constraint: "business_status_late_minutes_check" });
    }));
  it("refuses an end at or before set_at, and one more than 100 days after it, by business_status_until_check; 99 days is fine", () =>
    withRollback(async (c) => {
      const s = await seed(c, "until");
      await store(c, s.accountId, { state: "storm", late: null, until: at(24 * 99) });
      await c.query("savepoint p");
      await expect(store(c, s.accountId, { state: "closed_today", late: null, until: at(-0.05) }))
        .rejects.toMatchObject({ code: "23514", constraint: "business_status_until_check" });
      await c.query("rollback to savepoint p");
      await expect(store(c, s.accountId, { state: "storm", late: null, until: at(24 * 101) }))
        .rejects.toMatchObject({ code: "23514", constraint: "business_status_until_check" });
    }));
});

describe("0097 the stamp triggers", () => {
  it("an insert and an update with no token stamp set_by 'system' and set_at now(), whatever was sent (SD2: as the table owner; mutation: drop the set_by line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "stamp");
      await c.query("delete from public.business_status where account_id = $1", [s.accountId]);
      await c.query("insert into public.business_status (account_id, set_by, set_at) values ($1, 'forged', now() - interval '3 days')", [s.accountId]);
      const first = (await c.query("select set_by, set_at = now() as now_ from public.business_status where account_id = $1", [s.accountId])).rows;
      expect(first).toEqual([{ set_by: "system", now_: true }]);
      await c.query("update public.business_status set set_by = 'forged', set_at = now() - interval '9 days' where account_id = $1", [s.accountId]);
      expect((await c.query("select set_by, set_at = now() as now_ from public.business_status where account_id = $1", [s.accountId])).rows)
        .toEqual([{ set_by: "system", now_: true }]);
    }));
  it("a signed-in update stamps the token sub", () =>
    withRollback(async (c) => {
      const s = await seed(c, "stamp_sub");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      const sub = (await c.query<{ s: string }>("select app.jwt() ->> 'sub' as s")).rows[0]!.s;
      const { rows } = await c.query("update public.business_status set state = 'storm' where account_id = $1 returning set_by", [s.accountId]);
      expect(rows).toEqual([{ set_by: sub }]);
    }));
  it("service_role sending created_by on closed_days is overwritten with 'system' (mutation: drop the created_by line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_stamp");
      await c.query("set local role service_role");
      const { rows } = await c.query(
        "insert into public.closed_days (account_id, starts_on, ends_on, created_by) values ($1, current_date + 3, current_date + 3, 'forged') returning created_by",
        [s.accountId]);
      expect(rows).toEqual([{ created_by: "system" }]);
    }));
});

describe("0097 closed_days CHECKs and the window trigger", () => {
  const ins = (c: Client, a: string, from: string, to: string, reason: string | null = null) =>
    c.query(`insert into public.closed_days (account_id, starts_on, ends_on, reason) values ($1, ${from}, ${to}, $2)`, [a, reason]);
  it("a one-day range and a 92-day range are accepted", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_ok");
      await ins(c, s.accountId, "current_date + 1", "current_date + 1", "holiday");
      await ins(c, s.accountId, "current_date + 10", "current_date + 101", "vacation");
    }));
  it.each([
    ["an end before the start", "current_date + 5", "current_date + 4", null, "closed_days_range_check"],
    ["93 days (mutation: <= 92 -> FAILS)", "current_date + 1", "current_date + 93", null, "closed_days_range_check"],
    ["a reason off the list", "current_date + 1", "current_date + 1", "birthday", "closed_days_reason_check"],
  ] as const)("refuses %s by its named CHECK", (_n, from, to, reason, constraint) =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_chk");
      await expect(ins(c, s.accountId, from, to, reason)).rejects.toMatchObject({ code: "23514", constraint });
    }));
  // current_date is the session date (UTC on Supabase): at 7:30 PM in Chicago it is already tomorrow in UTC, so "yesterday" in the
  // account's zone can be current_date - 2 (an Undo re-adding a range that started yesterday locally).
  it("the window: two UTC days ago and today+367 are accepted; three days ago and today+368 raise 23514 (mutation: current_date - 3 in the trigger -> FAILS; current_date - 1 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_win");
      await ins(c, s.accountId, "current_date - 2", "current_date - 2");
      await ins(c, s.accountId, "current_date + 300", "current_date + 367");
      await c.query("savepoint p");
      await expect(ins(c, s.accountId, "current_date - 3", "current_date - 3")).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint p");
      await expect(ins(c, s.accountId, "current_date + 300", "current_date + 368"))
        .rejects.toThrow("closed_days: a closed day must not start in the past or end more than a year ahead");
    }));
});

describe("0097 calls.business_status and the closure To-do link", () => {
  it("every S6 code is accepted and another is refused by calls_business_status_check", () =>
    withRollback(async (c) => {
      const s = await seed(c, "calls");
      const { rows: [ph] } = await c.query<{ id: string }>(
        "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [s.accountId, testPhoneNumber()]);
      const CODES = ["open", "closed_today", "running_late_15", "running_late_30", "running_late_60", "running_late_120", "storm", "closed_day"];
      for (const code of CODES)
        await c.query("insert into public.calls (account_id, phone_number_id, business_status) values ($1, $2, $3)", [s.accountId, ph!.id, code]);
      expect((await c.query("select count(*)::int as n from public.calls where account_id = $1", [s.accountId])).rows).toEqual([{ n: 8 }]);
      await expect(c.query("insert into public.calls (account_id, phone_number_id, business_status) values ($1, $2, 'running_late_45')", [s.accountId, ph!.id]))
        .rejects.toMatchObject({ code: "23514", constraint: "calls_business_status_check" });
    }));
  it("a kind without a date is refused by tasks_closure_coherent; an unknown kind by tasks_closure_kind_check", () =>
    withRollback(async (c) => {
      const s = await seed(c, "todo_chk");
      await c.query("savepoint p");
      await expect(c.query("insert into public.tasks (account_id, title, closure_kind) values ($1, 'x', 'status')", [s.accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_closure_coherent" });
      await c.query("rollback to savepoint p");
      await expect(c.query("insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'expiry', current_date)", [s.accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_closure_kind_check" });
    }));
  it("one closure To-do per account, kind and date (mutation: drop tasks_closure_once -> FAILS); another kind or date is fine", () =>
    withRollback(async (c) => {
      const s = await seed(c, "todo_once");
      const add = (kind: string, on: string) => c.query(
        `insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'Contact', $2, ${on})`, [s.accountId, kind]);
      await add("status", "current_date");
      await add("closed_day", "current_date");
      await add("status", "current_date + 1");
      await expect(add("status", "current_date")).rejects.toMatchObject({ code: "23505", constraint: "tasks_closure_once" });
    }));
  it("keep_task_links: a signed-in insert stores NULL in both columns (mutation: drop new.closure_kind := null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "keep_ins");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      const { rows } = await c.query(
        "insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'status', current_date) returning closure_kind, closure_on",
        [s.accountId]);
      expect(rows).toEqual([{ closure_kind: null, closure_on: null }]);
    }));
  it("keep_task_links: a server insert keeps them, and a signed-in update cannot change or clear them (mutation: drop new.closure_on := old.closure_on -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "keep_upd");
      await c.query("set local role service_role");
      const { rows: [t] } = await c.query<{ id: string }>(
        "insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'closed_day', current_date + 3) returning id", [s.accountId]);
      await actAsOwner(c);
      await actAsMember(c, s.accountId, s.orgId, "owner");
      await c.query("update public.tasks set title = 'y', closure_kind = null, closure_on = null where id = $1", [t!.id]);
      await actAsOwner(c);
      const { rows } = await c.query("select title, closure_kind, closure_on = current_date + 3 as same_day from public.tasks where id = $1", [t!.id]);
      expect(rows).toEqual([{ title: "y", closure_kind: "closed_day", same_day: true }]);
    }));
});

describe("0097 grants", () => {
  it("table privileges on both new tables (mutations: grant insert on business_status to authenticated -> FAILS; grant update on closed_days to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k
           from (values ('public.business_status'), ('public.closed_days')) tt(t)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) pp(p)
          where has_table_privilege(r, t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "authenticated public.business_status SELECT",
        "authenticated public.closed_days DELETE",
        "authenticated public.closed_days SELECT",
        "service_role public.business_status INSERT",
        "service_role public.business_status SELECT",
        "service_role public.closed_days DELETE",
        "service_role public.closed_days INSERT",
        "service_role public.closed_days SELECT",
      ]);
    }));
  it("column privileges: authenticated UPDATEs exactly state, late_minutes, until; INSERTs exactly the four closed_days columns", () =>
    withRollback(async (c) => {
      const cols = async (t: string, p: string) => (await c.query<{ a: string }>(
        `select a.attname as a from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('authenticated', a.attrelid, a.attnum, $2) order by 1`, [t, p])).rows.map((r) => r.a);
      expect(await cols("public.business_status", "UPDATE")).toEqual(["late_minutes", "state", "until"]);
      expect(await cols("public.closed_days", "INSERT")).toEqual(["account_id", "ends_on", "reason", "starts_on"]);
      expect(await cols("public.closed_days", "UPDATE")).toEqual([]);
    }));
  it("a client cannot UPDATE set_by or set_at, INSERT into business_status, or send created_by (SD2; 42501 each)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "client_cols");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      for (const sql of [
        "update public.business_status set set_by = 'x' where account_id = $1",
        "update public.business_status set set_at = now() where account_id = $1",
        "insert into public.business_status (account_id) values ($1)",
        "insert into public.closed_days (account_id, starts_on, ends_on, created_by) values ($1, current_date + 3, current_date + 3, 'x')",
      ]) {
        await c.query("savepoint p");
        // The message too: an RLS refusal is also 42501, so the code alone stays green with a table-wide
        // INSERT granted (mutation 10 -> FAILS here, not only in the privileges pin).
        await expect(c.query(sql, [s.accountId]), sql).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table/) });
        await c.query("rollback to savepoint p");
      }
    }));
});

describe("0097 RLS: who reads", () => {
  const counts = async (c: Client, accountId: string) => (await c.query(
    `select (select count(*)::int from public.business_status where account_id = $1) as status,
            (select count(*)::int from public.closed_days where account_id = $1) as days`, [accountId])).rows[0];
  async function seeded(c: Client, label: string) {
    const s = await seed(c, label);
    await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)", [s.accountId]);
    return s;
  }
  it.each(["owner", "staff", "technician"] as const)("a %s member reads both (D7; mutation: drop the member-read policy -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seeded(c, `read_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      expect(await counts(c, s.accountId)).toEqual({ status: 1, days: 1 });
    }));
  it("an Owner of ANOTHER account reads neither (mutation: member read using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seeded(c, "xa"); const b = await seed(c, "xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await counts(c, a.accountId)).toEqual({ status: 0, days: 0 });
    }));
  it("the agency reads both; anon has no grant (42501)", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "ag");
      await actAs(c, { app_role: "agency_admin", sub: "user_switch_ag" });
      expect(await counts(c, s.accountId)).toEqual({ status: 1, days: 1 });
      await actAsOwner(c);
      await c.query("set local role anon");
      await expect(c.query("select 1 from public.business_status limit 1")).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0097 RLS: the switch (D1, D8; SD1)", () => {
  type Cell = [string, Role, Patch | null, () => Patch, "1" | "0" | "42501"];
  const expired = (): Patch & { setAt: string } => ({ state: "closed_today", late: null, until: at(-1), setAt: at(-48) });
  /** [label, role, stored row (null = the seeded open row), change, expected]. */
  const CELLS: Cell[] = [
    ["Staff: Open -> Running late", "staff", null, () => late(30), "1"],
    ["Staff: Running late -> another delay", "staff", late(30), () => late(60), "1"],
    ["Staff: Running late -> Open", "staff", late(30), () => OPEN, "1"],
    ["Staff: an expired Closed today -> Running late (mutation: drop the expiry carve-out -> FAILS)", "staff", expired(), () => late(15), "1"],
    ["Staff: an expired Closed today -> Open", "staff", expired(), () => OPEN, "1"],
    ["Staff: Open -> Running late ending 25 hours out (the fall-back day's end of today)", "staff", null,
      () => ({ state: "running_late", late: 30, until: at(25) }), "1"],
    ["Staff: Open -> Running late ending 99 days out (mutation: drop the 26-hour bound from the Staff WITH CHECK -> FAILS)", "staff", null,
      () => ({ state: "running_late", late: 30, until: at(24 * 99) }), "42501"],
    ["Staff: Open -> Closed today (mutation: drop the WITH CHECK state clause -> FAILS)", "staff", null, closedToday, "42501"],
    ["Staff: Open -> Storm", "staff", null, () => STORM_OPEN, "42501"],
    ["Staff: Running late -> Closed today", "staff", late(30), closedToday, "42501"],
    ["Staff: Running late -> Storm", "staff", late(30), stormDated, "42501"],
    // The two Storm cells above are refused by the 26-hour bound too (until NULL, or 30 hours out), so they
    // stay green with the state clause gone; these two are inside the bound (mutation 4 -> FAILS).
    ["Staff: Open -> a Storm back on tomorrow (mutation: drop the WITH CHECK state clause -> FAILS)", "staff", null, stormSoon, "42501"],
    ["Staff: Running late -> a Storm back on tomorrow", "staff", late(30), stormSoon, "42501"],
    ["Staff: Closed today in force -> Open (mutation: drop the USING state clause -> FAILS)", "staff", closedToday(), () => OPEN, "0"],
    ["Staff: a dated Storm in force -> Open", "staff", stormDated(), () => OPEN, "0"],
    ["Staff: an open-ended Storm -> Open", "staff", STORM_OPEN, () => OPEN, "0"],
    ["Staff: an open-ended Storm -> Running late", "staff", STORM_OPEN, () => late(30), "0"],
    ["Technician: Open -> Running late", "technician", null, () => late(30), "0"],
    ["Technician: Running late -> Open", "technician", late(30), () => OPEN, "0"],
    ["Owner: Open -> Closed today", "owner", null, closedToday, "1"],
    ["Owner: Open -> Storm", "owner", null, () => STORM_OPEN, "1"],
    ["Owner: Closed today in force -> Open", "owner", closedToday(), () => OPEN, "1"],
    ["Owner: an open-ended Storm -> Open", "owner", STORM_OPEN, () => OPEN, "1"],
  ];
  it("the matrix has 23 cells (guards the loop from vacuity)", () => { expect(CELLS.length).toBe(23); });
  it.each(CELLS)("%s", (_label, role, stored, change, want) =>
    withRollback(async (c) => {
      const s = await seed(c, `cell_${role}`);
      if (stored) await store(c, s.accountId, stored);
      if (want === "42501") await expect(updateAs(c, s, role, change())).rejects.toMatchObject({ code: "42501" });
      else expect(await updateAs(c, s, role, change())).toBe(Number(want));
    }));
  it("the agency token updates any account's row", () =>
    withRollback(async (c) => {
      const s = await seed(c, "ag_upd");
      await actAs(c, { app_role: "agency_admin", sub: "user_switch_ag2" });
      const r = await c.query("update public.business_status set state = 'storm' where account_id = $1", [s.accountId]);
      expect(r.rowCount).toBe(1);
    }));
  // UNQUALIFIED on purpose: a WHERE that reads account_id also applies the member-read policy, which hides
  // A's row before the update policy is asked, so a `where account_id = A` case stays green with the update
  // policy's account clause gone (Task 1 review, P8). With no WHERE only business_status_update decides.
  it("an Owner of ANOTHER account changes no row but its own (mutation P8: drop the account clause from both halves of business_status_update -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "upd_xa"); const b = await seed(c, "upd_xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      const r = await c.query("update public.business_status set state = 'storm'");
      expect(r.rowCount).toBe(1); // B's own row: the update ran
      await actAsOwner(c);
      expect((await c.query("select account_id, state from public.business_status where account_id in ($1, $2) order by state",
        [a.accountId, b.accountId])).rows).toEqual([
        { account_id: a.accountId, state: "open" },
        { account_id: b.accountId, state: "storm" },
      ]);
    }));
});

describe("0097 RLS: closed days are the Owner's (D1, unchanged by D8)", () => {
  const add = (c: Client, accountId: string) => c.query(
    "insert into public.closed_days (account_id, starts_on, ends_on, reason) values ($1, current_date + 3, current_date + 4, 'holiday') returning created_by",
    [accountId]);
  it("an Owner adds one, stamped with the token sub", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_owner");
      const sub = await actAsMember(c, s.accountId, s.orgId, "owner");
      expect((await add(c, s.accountId)).rows).toEqual([{ created_by: sub }]);
    }));
  it.each(["staff", "technician"] as const)("a %s cannot add one (42501; mutation: owner_insert with check (true) -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seed(c, `cd_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      await expect(add(c, s.accountId)).rejects.toMatchObject({ code: "42501" });
    }));
  // A PLAIN insert, no `returning`: with `returning` the READ policy refuses the row whatever the insert policy
  // says, so the case would stay green with the insert policy's account clause gone (plan review, 2026-10-23,
  // proven on the replica: the stripped policy let B's Owner insert into A, rows_in_a = 1).
  it("an Owner of ANOTHER account cannot add one to this account (42501; mutation: drop account_id = current_account_id() from closed_days_owner_insert -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "cd_xa"); const b = await seed(c, "cd_xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      // A refused statement aborts the transaction (25P02 on the next one): the savepoint keeps it usable.
      await c.query("savepoint p");
      await expect(c.query(
        "insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)",
        [a.accountId])).rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint p");
      await actAsOwner(c);
      expect((await c.query("select count(*)::int as n from public.closed_days where account_id = $1", [a.accountId])).rows)
        .toEqual([{ n: 0 }]);
    }));
  it("Staff and Technicians delete nothing; the Owner deletes it (mutation: owner_delete using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_del");
      await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)", [s.accountId]);
      for (const role of ["staff", "technician"] as const) {
        await actAsOwner(c);
        await actAsMember(c, s.accountId, s.orgId, role);
        expect((await c.query("delete from public.closed_days where account_id = $1", [s.accountId])).rowCount, role).toBe(0);
      }
      await actAsOwner(c);
      await actAsMember(c, s.accountId, s.orgId, "owner");
      expect((await c.query("delete from public.closed_days where account_id = $1", [s.accountId])).rowCount).toBe(1);
    }));
  // UNQUALIFIED for the same reason as the business_status case: a WHERE on account_id lets the member-read
  // policy hide A's row before closed_days_owner_delete is asked (Task 1 review, P5b).
  it("an Owner of ANOTHER account deletes only its own (mutation P5b: drop the account clause from closed_days_owner_delete -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "del_xa"); const b = await seed(c, "del_xb");
      for (const id of [a.accountId, b.accountId])
        await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)", [id]);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect((await c.query("delete from public.closed_days")).rowCount).toBe(1); // B's own range: the delete ran
      await actAsOwner(c);
      expect((await c.query(`select (select count(*)::int from public.closed_days where account_id = $1) as a,
        (select count(*)::int from public.closed_days where account_id = $2) as b`, [a.accountId, b.accountId])).rows)
        .toEqual([{ a: 1, b: 0 }]);
    }));
  it("nobody may UPDATE a closed day (no grant: 42501)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_upd");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      await expect(c.query("update public.closed_days set reason = 'other' where account_id = $1", [s.accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));
  it("the five policies, as defined (read off the replica, 2026-10-23; PG17 may deparse differently: paste CI's text only after reading it says the same)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select polname, polcmd, polpermissive, pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as wc
           from pg_policy where polrelid in ('public.business_status'::regclass, 'public.closed_days'::regclass) order by 1`);
      // 0109 wrapped the house policy's helper calls (one call per statement, not per row; policy-initplans-schema.test.ts).
      const MEMBER = "(( SELECT app.is_agency() AS is_agency) OR (account_id = ( SELECT app.current_account_id() AS current_account_id)))";
      const OWNER = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND ( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner)))`;
      const UPD_USING = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND (( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner) OR (( SELECT COALESCE((app.account_role(app.current_account_id()) = 'staff'::text), false) AS "coalesce") AND ((state = ANY (ARRAY['open'::text, 'running_late'::text])) OR ((until IS NOT NULL) AND (until <= now())))))))`;
      const UPD_CHECK = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND (( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner) OR (( SELECT COALESCE((app.account_role(app.current_account_id()) = 'staff'::text), false) AS "coalesce") AND (state = ANY (ARRAY['open'::text, 'running_late'::text])) AND ((state = 'open'::text) OR (until <= (now() + '26:00:00'::interval)))))))`;
      expect(rows).toEqual([
        { polname: "business_status_member_read", polcmd: "r", polpermissive: true, q: MEMBER, wc: null },
        { polname: "business_status_update", polcmd: "w", polpermissive: true, q: UPD_USING, wc: UPD_CHECK },
        { polname: "closed_days_member_read", polcmd: "r", polpermissive: true, q: MEMBER, wc: null },
        { polname: "closed_days_owner_delete", polcmd: "d", polpermissive: true, q: OWNER, wc: null },
        { polname: "closed_days_owner_insert", polcmd: "a", polpermissive: true, q: null, wc: OWNER },
      ]);
    }));
});

describe("0097 functions, comments, teardown", () => {
  it("the three functions are invokers whose whole proconfig is search_path=pg_catalog, pg_temp (0096 rule; mutation: '' on keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.oid::regprocedure::text as f, p.prosecdef, p.proconfig from pg_proc p
          where p.oid in ('app.business_status_stamp()'::regprocedure, 'app.closed_days_stamp()'::regprocedure,
                          'app.keep_task_links()'::regprocedure) order by 1`);
      const CFG = ["search_path=pg_catalog, pg_temp"];
      expect(rows).toEqual([
        { f: "app.business_status_stamp()", prosecdef: false, proconfig: CFG },
        { f: "app.closed_days_stamp()", prosecdef: false, proconfig: CFG },
        { f: "app.keep_task_links()", prosecdef: false, proconfig: CFG },
      ]);
    }));
  it("both tables and every column of both, and the four added columns, carry a comment (mutation: delete one -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select cl.relname || '.' || a.attname as k from pg_attribute a join pg_class cl on cl.oid = a.attrelid
           join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
            and (cl.relname in ('business_status', 'closed_days')
                 or (cl.relname = 'calls' and a.attname = 'business_status')
                 or (cl.relname = 'tasks' and a.attname in ('closure_kind', 'closure_on'))
                 or (cl.relname = 'bookings' and a.attname = 'closure_kept_at'))
            and coalesce(col_description(cl.oid, a.attnum), '') = '' order by 1`);
      expect(rows).toEqual([]);
      const { rows: t } = await c.query(`select obj_description('public.business_status'::regclass, 'pg_class') is not null as b,
        obj_description('public.closed_days'::regclass, 'pg_class') is not null as d`);
      expect(t).toEqual([{ b: true, d: true }]);
    }));
  it("the account row delete carries both tables away (mutation: closed_days account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "gone");
      await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 1, current_date + 1)", [s.accountId]);
      await c.query("delete from public.accounts where id = $1", [s.accountId]);
      expect((await c.query(`select (select count(*)::int from public.business_status where account_id = $1) as b,
        (select count(*)::int from public.closed_days where account_id = $1) as d`, [s.accountId])).rows).toEqual([{ b: 0, d: 0 }]);
    }));
  it("neither table is on ACCOUNT_OWNED_TABLES (service_role holds no DELETE on business_status)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("business_status")).toBe(false);
    expect(listed.includes("closed_days")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the list is the real one, not an empty import
  });
});
