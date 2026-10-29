import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { AGENCY_VISIT_HOURS } from "../access-log";

/**
 * 0105_access_log.sql (F-118 part 1). Every database case runs in a rolled-back transaction, so this file
 * runs on the local replica and in CI verify. RED BEFORE APPLY: every database case names an object 0105
 * creates. now() is fixed for the whole transaction, which is what lets the window's edge be tested exactly.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ACTOR = `user_agency_${RUN}`;
const SESSION = `sess_${RUN}`;
type Acct = { accountId: string; orgId: string };
type Who = { actor?: string; session?: string; reason?: string; name?: string | null };

async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_access_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Access log') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Access log test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function refusal(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string } | null> {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
/**
 * As service_role, the only role the three writers are granted to. NOT actAsOwner: that bypasses grants.
 * No `finally`: after a failed statement the transaction is aborted (25P02), and a `reset role` there would
 * replace the real error with "current transaction is aborted". withRollback's rollback restores the role.
 */
async function asService<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await actAsOwner(c);
  await c.query("set local role service_role");
  const out = await fn();
  await c.query("reset role");
  return out;
}
const start = (c: Client, accountId: string, w: Who = {}) => asService(c, async () =>
  (await c.query<{ id: string }>("select public.start_agency_visit($1, $2, $3, $4, $5) as id",
    [accountId, w.actor ?? ACTOR, w.name === undefined ? "Dan Lopez" : w.name, w.session ?? SESSION, w.reason ?? "support"])).rows[0]!.id);
const live = (c: Client, accountId: string, w: Who = {}) => asService(c, async () =>
  (await c.query<{ id: string | null }>("select public.agency_visit_live($1, $2, $3) as id",
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION])).rows[0]!.id);
const note = (c: Client, accountId: string, kind: string, recordId: string | null, count: number | null = null, w: Who = {}) =>
  asService(c, async () => (await c.query<{ r: string }>("select public.note_agency_open($1, $2, $3, $4, $5, $6) as r",
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION, kind, recordId, count])).rows[0]!.r);
/** A visit with a chosen start, written as the table owner: the only way to set started_at. */
async function visitAt(c: Client, accountId: string, ago: string, w: Who = {}): Promise<string> {
  await actAsOwner(c);
  return (await c.query<{ id: string }>(
    `insert into public.agency_visits (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason, started_at)
     values ($1, $2, 'Dan Lopez', $3, $4, now() - $5::interval) returning id`,
    [accountId, w.actor ?? ACTOR, w.session ?? SESSION, w.reason ?? "support", ago])).rows[0]!.id;
}
async function itemAt(c: Client, visitId: string, accountId: string, kind: string, recordId: string | null, ago: string, count: number | null = null) {
  await actAsOwner(c);
  await c.query(
    `insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count, first_opened_at)
     values ($1, $2, $3, $4, $5, now() - $6::interval)`, [visitId, accountId, kind, recordId, count, ago]);
}
const uuid = async (c: Client) => (await c.query<{ u: string }>("select gen_random_uuid()::text as u")).rows[0]!.u;
const itemCount = async (c: Client, accountId: string) => {
  await actAsOwner(c);
  return (await c.query<{ n: number }>("select count(*)::int as n from public.agency_visit_items where account_id = $1", [accountId])).rows[0]!.n;
};

describe("0105: grants make both tables append-only", () => {
  it("table privileges: authenticated SELECT on the items only, service_role SELECT on both, nothing else for any role, MAINTAIN included (mutations: drop service_role from the revoke-all line -> FAILS; `grant select on public.agency_visits to authenticated` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, t, p from unnest(array['anon','authenticated','service_role']) r
           cross join unnest(array['public.agency_visit_items','public.agency_visits']) t
           cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
          where has_table_privilege(r, t, p) order by 1, 2, 3`);
      expect(rows).toEqual([
        { r: "authenticated", t: "public.agency_visit_items", p: "SELECT" },
        { r: "service_role", t: "public.agency_visit_items", p: "SELECT" },
        { r: "service_role", t: "public.agency_visits", p: "SELECT" },
      ]);
    }));

  it("column SELECT: authenticated reads exactly six columns of agency_visits, never the Clerk user or session id (review m3; mutation: add actor_clerk_user_id to the column grant -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select a.attname as col from pg_attribute a
          where a.attrelid = 'public.agency_visits'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') order by 1`);
      expect(rows.map((r: { col: string }) => r.col)).toEqual(["account_id", "actor_kind", "actor_name", "id", "reason", "started_at"]);
      // And it bites: an Owner of the account asking for the actor's Clerk id is refused 42501 (not zero rows).
      const a = await seedAccount(c, "cols");
      await visitAt(c, a.accountId, "1 minute");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "select actor_clerk_user_id from public.agency_visits where account_id = $1", [a.accountId]))?.code).toBe("42501");
      expect((await c.query("select actor_name from public.agency_visits where account_id = $1", [a.accountId])).rowCount).toBe(1);
    }));

  it("column INSERT: service_role on exactly these ten columns, so started_at and first_opened_at stay the database's clock (mutation: add started_at to the grant -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, cl.relname || '.' || a.attname as col
           from unnest(array['anon','authenticated','service_role']) r
           cross join pg_class cl join pg_namespace n on n.oid = cl.relnamespace
           join pg_attribute a on a.attrelid = cl.oid and a.attnum > 0 and not a.attisdropped
          where n.nspname = 'public' and cl.relname in ('agency_visits','agency_visit_items')
            and has_column_privilege(r, cl.oid, a.attnum, 'INSERT') order by 1, 2`);
      expect(rows).toEqual([
        "agency_visit_items.account_id", "agency_visit_items.item_count", "agency_visit_items.kind",
        "agency_visit_items.record_id", "agency_visit_items.visit_id",
        "agency_visits.account_id", "agency_visits.actor_clerk_user_id", "agency_visits.actor_name",
        "agency_visits.clerk_session_id", "agency_visits.reason",
      ].map((col) => ({ r: "service_role", col })));
    }));

  it("column privileges on ANY column: no role may UPDATE or REFERENCES a single column of either table, anon holds no column privilege at all, authenticated only SELECTs (T1 review; mutations: `grant update (started_at) on public.agency_visits to service_role` -> FAILS; `grant update (first_opened_at, record_id) on public.agency_visit_items to service_role` -> FAILS)", () =>
    withRollback(async (c) => {
      // has_table_privilege is false for a COLUMN-level grant, so the table-privileges case above cannot see
      // one; a column UPDATE on started_at or first_opened_at would let service_role backdate the log.
      const { rows } = await c.query(
        `select r, t, p from unnest(array['anon','authenticated','service_role']) r
           cross join unnest(array['public.agency_visit_items','public.agency_visits']) t
           cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
          where has_any_column_privilege(r, t, p) order by 1, 2, 3`);
      expect(rows).toEqual([
        { r: "authenticated", t: "public.agency_visit_items", p: "SELECT" },
        { r: "authenticated", t: "public.agency_visits", p: "SELECT" },
        { r: "service_role", t: "public.agency_visit_items", p: "INSERT" },
        { r: "service_role", t: "public.agency_visit_items", p: "SELECT" },
        { r: "service_role", t: "public.agency_visits", p: "INSERT" },
        { r: "service_role", t: "public.agency_visits", p: "SELECT" },
      ]);
    }));

  it("as service_role: UPDATE and DELETE are refused 42501, and so is an INSERT naming started_at (mutation: grant update (reason) on agency_visits to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ro");
      const v = await start(c, a.accountId);
      await note(c, a.accountId, "contact", await uuid(c));
      await actAsOwner(c);
      await c.query("set local role service_role");
      expect((await refusal(c, "update public.agency_visits set reason = 'billing' where id = $1", [v]))?.code).toBe("42501");
      expect((await refusal(c, "delete from public.agency_visit_items where visit_id = $1", [v]))?.code).toBe("42501");
      expect((await refusal(c,
        `insert into public.agency_visits (account_id, actor_clerk_user_id, clerk_session_id, reason, started_at)
         values ($1, 'x', 'y', 'setup', now() - interval '1 day')`, [a.accountId]))?.code).toBe("42501");
      await c.query("reset role");
    }));
});

describe("0105: row level security", () => {
  it("is on for both tables, with exactly one permissive SELECT policy each, to authenticated (mutation: disable row level security on agency_visit_items -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: rls } = await c.query(
        "select relname, relrowsecurity from pg_class where oid in ('public.agency_visits'::regclass, 'public.agency_visit_items'::regclass) order by 1");
      expect(rls).toEqual([{ relname: "agency_visit_items", relrowsecurity: true }, { relname: "agency_visits", relrowsecurity: true }]);
      const { rows: pol } = await c.query(
        `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
          where schemaname = 'public' and tablename in ('agency_visits','agency_visit_items') order by 1, 2`);
      expect(pol).toEqual([
        { tablename: "agency_visit_items", policyname: "agency_visit_items_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
        { tablename: "agency_visits", policyname: "agency_visits_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
      ]);
    }));

  it("an Owner of A reads A's visits and items; Staff and a Technician of A, and an Owner of B, read none of A's; the agency reads both accounts; A's Owner with client access off reads none (mutations: drop the Owner clause -> the Staff case FAILS; drop the account clause -> the B Owner case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rlsA");
      const b = await seedAccount(c, "rlsB");
      const va = await visitAt(c, a.accountId, "10 minutes");
      await visitAt(c, b.accountId, "10 minutes");
      await itemAt(c, va, a.accountId, "contact", await uuid(c), "5 minutes");
      const seenOfA = async () => (await c.query<{ v: number; i: number }>(
        `select (select count(*)::int from public.agency_visits where account_id = $1) as v,
                (select count(*)::int from public.agency_visit_items where account_id = $1) as i`, [a.accountId])).rows[0];
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 1, i: 1 });
      for (const role of ["staff", "technician"] as const) {
        await actAsOwner(c);
        await actAsMember(c, a.accountId, a.orgId, role);
        expect(await seenOfA(), role).toEqual({ v: 0, i: 0 });
      }
      await actAsOwner(c);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 0, i: 0 });
      // Positive control for the B case: B's Owner does see B's own visit.
      expect((await c.query("select 1 from public.agency_visits where account_id = $1", [b.accountId])).rowCount).toBe(1);
      await actAsOwner(c);
      await actAs(c, { app_role: "agency_admin", sub: ACTOR });
      expect((await c.query("select 1 from public.agency_visits where account_id = any($1::uuid[])", [[a.accountId, b.accountId]])).rowCount).toBe(2);
      await actAsOwner(c);
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await seenOfA()).toEqual({ v: 0, i: 0 });
    }));
});

describe("0105: a visit is live for two hours from its start, for its own person, session and account", () => {
  it("a visit started exactly two hours ago is NOT live; one started two hours less a microsecond ago is (mutations: `>` -> `>=` FAILS; a 3-hour window FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "edge");
      await visitAt(c, a.accountId, "2 hours", { session: "s_edge" });
      const inside = await visitAt(c, a.accountId, "2 hours", { session: "s_in" });
      await actAsOwner(c);
      await c.query("update public.agency_visits set started_at = started_at + interval '1 microsecond' where id = $1", [inside]);
      expect(await live(c, a.accountId, { session: "s_edge" })).toBeNull();
      expect(await live(c, a.accountId, { session: "s_in" })).toBe(inside);
    }));

  it("another session, another account and another person are not live (mutations: drop the session filter, the account filter or the actor filter from agency_visit_live -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "who");
      const b = await seedAccount(c, "whoB");
      const v = await visitAt(c, a.accountId, "1 minute");
      expect(await live(c, a.accountId)).toBe(v);
      expect(await live(c, a.accountId, { session: "sess_other" })).toBeNull();
      expect(await live(c, b.accountId)).toBeNull();
      expect(await live(c, a.accountId, { actor: "user_other" })).toBeNull();
    }));
});

describe("0105: start_agency_visit", () => {
  it("twice in the window answers the SAME visit, keeping the first reason; after the window a NEW one (mutation: always insert -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "start");
      const first = await start(c, a.accountId, { reason: "support" });
      expect(await start(c, a.accountId, { reason: "billing" })).toBe(first);
      await actAsOwner(c);
      expect((await c.query("select reason from public.agency_visits where id = $1", [first])).rows[0]).toEqual({ reason: "support" });
      const old = await visitAt(c, a.accountId, "3 hours", { session: "s_old" });
      const fresh = await start(c, a.accountId, { session: "s_old" });
      expect(fresh).not.toBe(old);
      expect(await live(c, a.accountId, { session: "s_old" })).toBe(fresh);
    }));

  it("a blank name is stored as NULL, and a missing account, a missing argument and an unknown reason are refused (mutations: drop nullif(btrim(...)) -> FAILS; drop the null check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "args");
      const v = await start(c, a.accountId, { name: "   " });
      await actAsOwner(c);
      expect((await c.query("select actor_name from public.agency_visits where id = $1", [v])).rows[0]).toEqual({ actor_name: null });
      await c.query("set local role service_role");
      const call = "select public.start_agency_visit($1, $2, 'Dan', $3, $4)";
      expect((await refusal(c, call, ["00000000-0000-4000-8000-000000000000", ACTOR, "s_x", "setup"]))?.code).toBe("23503");
      expect((await refusal(c, call, [a.accountId, null, "s_x", "setup"]))?.code).toBe("22004");
      expect((await refusal(c, call, [a.accountId, ACTOR, "s_y", "curious"]))?.code).toBe("23514");
      await c.query("reset role");
    }));
});

describe("0105: note_agency_open", () => {
  it("one row per record per visit; two records two rows; every export its own row; a new visit logs the same record again (mutation: drop agency_visit_items_once AND its on-conflict clause -> FAILS with 2 rows)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "once");
      await start(c, a.accountId);
      const x = await uuid(c);
      const y = await uuid(c);
      expect(await note(c, a.accountId, "contact", x)).toBe("ok");
      expect(await note(c, a.accountId, "contact", x)).toBe("ok");
      expect(await itemCount(c, a.accountId)).toBe(1);
      await note(c, a.accountId, "contact", y);
      await note(c, a.accountId, "group", x);   // same id, another kind: its own row
      expect(await itemCount(c, a.accountId)).toBe(3);
      await note(c, a.accountId, "customer_list_export", null, 10);
      await note(c, a.accountId, "customer_list_export", null, 12);
      expect(await itemCount(c, a.accountId)).toBe(5);
      await start(c, a.accountId, { session: "s_two" });
      await note(c, a.accountId, "contact", x, null, { session: "s_two" });
      expect(await itemCount(c, a.accountId)).toBe(6);
    }));

  it("no live visit answers no_visit and writes nothing; a live visit on A never covers a note for B (mutation: look the visit up by actor and session only -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "nov");
      const b = await seedAccount(c, "novB");
      expect(await note(c, a.accountId, "contact", await uuid(c))).toBe("no_visit");
      expect(await itemCount(c, a.accountId)).toBe(0);
      await start(c, a.accountId);
      expect(await note(c, b.accountId, "contact", await uuid(c))).toBe("no_visit");
      expect(await itemCount(c, a.accountId)).toBe(0);
      expect(await itemCount(c, b.accountId)).toBe(0);
    }));

  it("an export with no count, a record kind with no id and an unknown kind are refused 23514 (mutation: drop agency_visit_items_export_count_check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "chk");
      await start(c, a.accountId);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const call = "select public.note_agency_open($1, $2, $3, $4, $5, $6)";
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "customer_list_export", null, null]))?.code).toBe("23514");
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "contact", null, null]))?.code).toBe("23514");
      expect((await refusal(c, call, [a.accountId, ACTOR, SESSION, "peek", "00000000-0000-4000-8000-000000000001", null]))?.code).toBe("23514");
      await c.query("reset role");
    }));
});

describe("0105: who may call what", () => {
  it("EXECUTE: service_role the three writers and the window, authenticated the reader only, anon nothing; every function an invoker ending its search_path in pg_temp (mutation: drop `public` from a revoke line -> FAILS)", () =>
    withRollback(async (c) => {
      const FNS = ["public.start_agency_visit(uuid,text,text,text,text)", "public.agency_visit_live(uuid,text,text)",
        "public.note_agency_open(uuid,text,text,text,uuid,integer)", "public.access_log_page(uuid,timestamptz,uuid,integer)",
        "app.agency_visit_window()"];
      const { rows } = await c.query(
        `select r, f from unnest(array['anon','authenticated','service_role']) r cross join unnest($1::text[]) f
          where has_function_privilege(r, f, 'EXECUTE') order by 1, 2`, [FNS]);
      expect(rows).toEqual([
        { r: "authenticated", f: "public.access_log_page(uuid,timestamptz,uuid,integer)" },
        { r: "service_role", f: "app.agency_visit_window()" },
        { r: "service_role", f: "public.agency_visit_live(uuid,text,text)" },
        { r: "service_role", f: "public.note_agency_open(uuid,text,text,text,uuid,integer)" },
        { r: "service_role", f: "public.start_agency_visit(uuid,text,text,text,text)" },
      ]);
      const { rows: cfg } = await c.query(
        "select p.oid::regprocedure::text as f, p.prosecdef as d, p.proconfig as cfg from pg_proc p where p.oid = any($1::regprocedure[]) order by 1", [FNS]);
      for (const r of cfg) expect(r, r.f).toMatchObject({ d: false, cfg: ["search_path=pg_catalog, pg_temp"] });
      expect(cfg).toHaveLength(FNS.length);
    }));
});

describe("0105: access_log_page", () => {
  it("newest first, limit + 1 rows, the real total, counts with a file counted once across view, download and share, ended_at, items newest first and capped at 100, and the cursor (mutations: count(distinct record_id) -> count(*) FAILS; drop the item limit FAILS; `<` -> `<=` FAILS; `limit p_limit + 1` -> `limit p_limit` FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "page");
      const b = await seedAccount(c, "pageB");
      await visitAt(c, b.accountId, "30 minutes");       // B's, never in A's page
      const oldest = await visitAt(c, a.accountId, "3 hours", { session: "s1" });
      const middle = await visitAt(c, a.accountId, "2 hours", { session: "s2" });
      const newest = await visitAt(c, a.accountId, "1 hour", { session: "s3" });
      const d1 = await uuid(c); const d2 = await uuid(c); const d3 = await uuid(c); const x = await uuid(c);
      await itemAt(c, newest, a.accountId, "document_view", d1, "50 minutes");
      await itemAt(c, newest, a.accountId, "document_download", d1, "49 minutes");
      await itemAt(c, newest, a.accountId, "document_view", d2, "48 minutes");
      await itemAt(c, newest, a.accountId, "document_share", d3, "47 minutes 30 seconds");   // d3 only shared: still a file opened
      await itemAt(c, newest, a.accountId, "contact", x, "47 minutes");
      await itemAt(c, newest, a.accountId, "customer_list_export", null, "46 minutes", 12);
      await actAsOwner(c);
      await c.query(
        `insert into public.agency_visit_items (visit_id, account_id, kind, record_id, first_opened_at)
         select $1, $2, 'contact', gen_random_uuid(), now() - interval '110 minutes' + (g || ' seconds')::interval
           from generate_series(1, 101) g`, [middle, a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const page = async (before: [string, string] | null, limit: number) =>
        (await c.query("select public.access_log_page($1, $2, $3, $4) as p", [a.accountId, before?.[0] ?? null, before?.[1] ?? null, limit])).rows[0].p;
      const p1 = await page(null, 2);
      expect(p1.total).toBe(3);
      expect(p1.visits.map((v: { id: string }) => v.id)).toEqual([newest, middle, oldest]);
      expect(p1.visits[0].counts).toEqual({ contact: 1, group: 0, call: 0, conversation: 0, file: 3, form_answers: 0, customer_list_export: 1 });
      expect(p1.visits[0].items[0]).toMatchObject({ kind: "customer_list_export", record_id: null, item_count: 12 });
      expect(p1.visits[0].ended_at).not.toBeNull();
      expect(p1.visits[1].items).toHaveLength(100);
      expect(p1.visits[1].item_total).toBe(101);
      expect(p1.visits[2].ended_at).toBeNull();
      expect(p1.visits[2].items).toEqual([]);
      const p2 = await page([p1.visits[1].started_at, middle], 2);
      expect(p2.visits.map((v: { id: string }) => v.id)).toEqual([oldest]);
      for (const bad of [0, 51]) expect((await refusal(c, "select public.access_log_page($1, null, null, $2)", [a.accountId, bad]))?.code).toBe("22023");
      await actAsOwner(c);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect(await page(null, 20)).toEqual({ total: 0, visits: [] });
    }));
});

describe("0105: the account's own delete carries the log away", () => {
  it("as service_role, deleting the account removes its visits and items; another account's survive (mutation: agency_visits.account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "gone");
      const b = await seedAccount(c, "stay");
      const va = await visitAt(c, a.accountId, "5 minutes");
      const vb = await visitAt(c, b.accountId, "5 minutes");
      await itemAt(c, va, a.accountId, "contact", await uuid(c), "1 minute");
      await itemAt(c, vb, b.accountId, "contact", await uuid(c), "1 minute");
      await asService(c, () => c.query("delete from public.accounts where id = $1", [a.accountId]));
      await actAsOwner(c);
      const { rows } = await c.query(
        `select (select count(*)::int from public.agency_visits where account_id = $1) as av,
                (select count(*)::int from public.agency_visit_items where account_id = $1) as ai,
                (select count(*)::int from public.agency_visits where account_id = $2) as bv,
                (select count(*)::int from public.agency_visit_items where account_id = $2) as bi`, [a.accountId, b.accountId]);
      expect(rows[0]).toEqual({ av: 0, ai: 0, bv: 1, bi: 1 });
    }));

  it("(pure) neither table is on ACCOUNT_OWNED_TABLES: service_role holds no DELETE, so a listed delete would fail every teardown (mutation: add agency_visits to the list -> FAILS)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("agency_visits")).toBe(false);
    expect(listed.includes("agency_visit_items")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the real list, not an empty import
  });

  it("(pure) AGENCY_VISIT_HOURS is the window 0105 declares (mutation: set the constant to 3 -> FAILS)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/0105_access_log.sql", import.meta.url)), "utf8");
    const body = sql.slice(sql.indexOf("create function app.agency_visit_window"));
    expect(body.match(/select interval '(\d+) hours'/)?.[1]).toBe(String(AGENCY_VISIT_HOURS));
  });
});
