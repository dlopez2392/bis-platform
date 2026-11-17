import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus } from "../booking";
import { stampReviewRequested, upsertAutomation, listDueReviewRequests, getDueReviewRequestById } from "../automations";
import {
  recordCheckinAnswer, getCheckinForBooking, markReviewLinkOpened, ensureCheckinTask, checkinCounts,
  listCheckinsMissingTask, notGreatBookingIds, hasNotGreatCheckin, accountsWithCheckin,
} from "../job-checkins";

/**
 * F-072 PR 1: public.job_checkins (migration job_checkins), tasks.review_checkin_id, app.keep_task_links re-emitted,
 * and packages/db/src/job-checkins.ts. Plan docs/superpowers/plans/2026-11-17-review-requests.md, D2, D3 and PR 1.
 *
 * Two kinds of case, each with its own red:
 *   - SCHEMA, GRANTS, RLS AND THE TASK LINK (withRollback, raw pg as the table owner unless a case switches role).
 *     RED BEFORE APPLY: every one (42P01 on the table, 42703 on tasks.review_checkin_id, or a missing catalog row),
 *     except the keep_task_links regression's EIGHT older columns, which hold before and after by design (the case
 *     names the ninth, review_checkin_id, and is red on it alone before apply).
 *   - THE ACCESSORS, LIVE (withTestAccount, serviceDb through PostgREST, so every request is its own transaction and
 *     the concurrency cases are real). RED BEFORE: the module does not exist; after it does, the table does not.
 * The teardown case is pure: red until the table is on ACCOUNT_OWNED_TABLES.
 */
const TABLE = "public.job_checkins";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = randomBytes(4).toString("hex");

// ---------------------------------------------------------------------------------------------------------------
// Seed (withRollback)
// ---------------------------------------------------------------------------------------------------------------

type Seed = {
  a: string; b: string; orgA: string; orgB: string; techSub: string;
  ana: string; ben: string; zoe: string; bAna: string; bBen: string; bZoe: string; calA: string;
};

async function one(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  return (await c.query<{ id: string }>(sql, params)).rows[0]!.id;
}

let seq = 0;
async function booking(c: Client, account: string, calendar: string, contact: string, status = "completed"): Promise<string> {
  const n = ++seq;
  return one(c,
    `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, status, completed_at, author_kind)
     values ($1, $2, $3, now() - make_interval(hours => $5 + 1), now() - make_interval(hours => $5), $4, $6,
             case when $6 = 'completed' then now() end, 'person') returning id`,
    [account, calendar, contact, `tok_jc_${RUN}_${n}`, n, status]);
}

/** Two accounts (client access on); on A an Owner and a Technician assigned to Ana but not Ben; on B an Owner and Zoe.
 *  One completed booking per customer. As the table owner. */
async function seed(c: Client): Promise<Seed> {
  const ag = await one(c, "insert into public.agencies (name) values ('JC schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string; clerk_org_id: string }>(
    "insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id, clerk_org_id",
    [ag, `org_jc_${tag}_${RUN}`, `JC ${tag}`])).rows[0]!;
  const a = await acct("a");
  const b = await acct("b");
  const techSub = `user_jc_tech_${RUN}`;
  const tech = await one(c, "insert into public.users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [techSub]);
  await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'technician')", [tech, a.id]);
  const contact = (account: string, name: string, assigned: string | null = null) => one(c,
    "insert into public.contacts (account_id, first_name, assigned_to) values ($1, $2, $3) returning id", [account, name, assigned]);
  const ana = await contact(a.id, "Ana", tech);
  const ben = await contact(a.id, "Ben");
  const zoe = await contact(b.id, "Zoe");
  const calA = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [a.id, `cal_jc_a_${RUN}`]);
  const calB = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [b.id, `cal_jc_b_${RUN}`]);
  return {
    a: a.id, b: b.id, orgA: a.clerk_org_id, orgB: b.clerk_org_id, techSub, ana, ben, zoe, calA,
    bAna: await booking(c, a.id, calA, ana), bBen: await booking(c, a.id, calA, ben), bZoe: await booking(c, b.id, calB, zoe),
  };
}

const checkin = (c: Client, account: string, bookingId: string, contact: string, answer = "great") => one(c,
  `insert into ${TABLE} (account_id, booking_id, contact_id, answer) values ($1, $2, $3, $4) returning id`,
  [account, bookingId, contact, answer]);

/** One statement under a savepoint: the error it raised, or null if it ran. Keeps the transaction usable. */
async function refusedWith(c: Client, run: () => Promise<unknown>): Promise<{ code?: string; constraint?: string } | null> {
  await c.query("savepoint probe");
  try {
    await run();
    await c.query("release savepoint probe");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e as { code?: string; constraint?: string };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------------------------------

describe("job_checkins: the table's shape (plan D2)", () => {
  it("the columns are exactly these, in order, with their types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name as n, data_type as t, is_nullable as nl, column_default as d
           from information_schema.columns where table_schema = 'public' and table_name = 'job_checkins'
          order by ordinal_position`);
      expect(rows).toEqual([
        { n: "id", t: "uuid", nl: "NO", d: "gen_random_uuid()" },
        { n: "account_id", t: "uuid", nl: "NO", d: null },
        { n: "booking_id", t: "uuid", nl: "NO", d: null },
        { n: "contact_id", t: "uuid", nl: "NO", d: null },
        { n: "answer", t: "text", nl: "NO", d: null },
        { n: "answered_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
        { n: "review_link_opened_at", t: "timestamp with time zone", nl: "YES", d: null },
        { n: "created_at", t: "timestamp with time zone", nl: "NO", d: "now()" },
      ]);
    }));

  it("the constraints are exactly these, the booking key three columns wide with ON UPDATE CASCADE (probe: drop job_checkins_booking_fkey -> FAILS)", () =>
    withRollback(async (c) => {
      // contype 'n' excluded: PG18 (the replica) stores NOT NULL as constraint rows, PG17 (the projects) does not.
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where (conrelid = '${TABLE}'::regclass and contype <> 'n')
             or conname in ('bookings_account_id_id_contact_id_key', 'tasks_review_checkin_fkey')
          order by conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        bookings_account_id_id_contact_id_key: "UNIQUE (account_id, id, contact_id)",
        job_checkins_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        job_checkins_account_id_id_key: "UNIQUE (account_id, id)",
        job_checkins_answer_check: "CHECK ((answer = ANY (ARRAY['great'::text, 'okay'::text, 'not_great'::text])))",
        job_checkins_booking_fkey:
          "FOREIGN KEY (account_id, booking_id, contact_id) REFERENCES bookings(account_id, id, contact_id) ON UPDATE CASCADE ON DELETE CASCADE",
        job_checkins_booking_id_key: "UNIQUE (booking_id)",
        job_checkins_pkey: "PRIMARY KEY (id)",
        tasks_review_checkin_fkey:
          "FOREIGN KEY (account_id, review_checkin_id) REFERENCES job_checkins(account_id, id) ON DELETE CASCADE",
      });
    }));

  it("the indexes are exactly these, and tasks.review_checkin_id is a nullable uuid with its one-per-check-in index", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and (tablename = 'job_checkins' or indexname = 'tasks_review_checkin_once')
          order by indexname`);
      expect(Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]))).toEqual({
        job_checkins_account_contact: "CREATE INDEX job_checkins_account_contact ON public.job_checkins USING btree (account_id, contact_id)",
        job_checkins_account_id_id_key: "CREATE UNIQUE INDEX job_checkins_account_id_id_key ON public.job_checkins USING btree (account_id, id)",
        job_checkins_booking_id_key: "CREATE UNIQUE INDEX job_checkins_booking_id_key ON public.job_checkins USING btree (booking_id)",
        job_checkins_pkey: "CREATE UNIQUE INDEX job_checkins_pkey ON public.job_checkins USING btree (id)",
        tasks_review_checkin_once:
          "CREATE UNIQUE INDEX tasks_review_checkin_once ON public.tasks USING btree (review_checkin_id) WHERE (review_checkin_id IS NOT NULL)",
      });
      const { rows: col } = await c.query(
        `select data_type as t, is_nullable as nl, column_default as d from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks' and column_name = 'review_checkin_id'`);
      expect(col).toEqual([{ t: "uuid", nl: "YES", d: null }]);
    }));
});

// ---------------------------------------------------------------------------------------------------------------
// Grants and RLS
// ---------------------------------------------------------------------------------------------------------------

describe("job_checkins: grants and RLS (plan D2: members read, service_role alone writes)", () => {
  // has_table_privilege, not information_schema.role_table_grants: it counts a grant to PUBLIC as every role's own
  // and sees PG17's MAINTAIN (0051's note).
  it("the whole table privilege matrix is authenticated SELECT and service_role DELETE, INSERT, SELECT (probe: drop authenticated from the revoke -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "authenticated", p: "SELECT" },
        { r: "service_role", p: "DELETE" },
        { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" },
      ]);
    }));

  it("service_role may UPDATE exactly review_link_opened_at, and no client role may write a column", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select a.attname as n from pg_attribute a
          where a.attrelid = '${TABLE}'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('service_role', '${TABLE}', a.attname, 'UPDATE') order by 1`);
      expect(rows.map((r) => r.n)).toEqual(["review_link_opened_at"]);
      const { rows: client } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(client).toEqual([]);
    }));

  it("row level security is on with exactly the member read and the Technician scope, both to authenticated only", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      expect(t!.relrowsecurity).toBe(true);
      const { rows } = await c.query(
        `select policyname, permissive, roles::text[] as roles, cmd, qual, with_check from pg_policies
          where schemaname = 'public' and tablename = 'job_checkins' order by policyname`);
      expect(rows).toEqual([
        { policyname: "job_checkins_member_read", permissive: "PERMISSIVE", roles: ["authenticated"], cmd: "SELECT",
          qual: "(( SELECT app.is_agency() AS is_agency) OR (account_id = ( SELECT app.current_account_id() AS current_account_id)))",
          with_check: null },
        { policyname: "job_checkins_technician_scope", permissive: "RESTRICTIVE", roles: ["authenticated"], cmd: "SELECT",
          qual: "(( SELECT app.sees_all_customers(app.current_account_id()) AS sees_all_customers) OR (contact_id IN ( SELECT app.my_contact_ids() AS my_contact_ids)))",
          with_check: null },
      ]);
    }));

  it.each(["anon", "the account's own signed-in Owner"])(
    "%s cannot write a row: insert, update and delete are refused 42501 (anon cannot read either)", (who) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana);
      if (who === "anon") {
        await actAs(c, {});
        await c.query("set local role anon");
      } else {
        await actAsMember(c, s.a, s.orgA, "owner");
      }
      const code = async (sql: string, params: unknown[] = []) =>
        (await refusedWith(c, () => c.query(sql, params)))?.code ?? "ran";
      expect({
        select: await code(`select id from ${TABLE}`),
        insert: await code(`insert into ${TABLE} (account_id, booking_id, contact_id, answer) values ($1, $2, $3, 'okay')`, [s.a, s.bBen, s.ben]),
        update: await code(`update ${TABLE} set review_link_opened_at = now() where id = $1`, [id]),
        delete: await code(`delete from ${TABLE} where id = $1`, [id]),
      }).toEqual({
        select: who === "anon" ? "42501" : "ran", insert: "42501", update: "42501", delete: "42501",
      });
    }));

  it("an Owner reads only their own account's check-ins, another account's Owner none of them, the agency both (probe: using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ana = await checkin(c, s.a, s.bAna, s.ana);
      const zoe = await checkin(c, s.b, s.bZoe, s.zoe, "not_great");
      const visible = async () => (await c.query<{ id: string }>(
        `select id from ${TABLE} where id = any($1::uuid[]) order by id`, [[ana, zoe]])).rows.map((r) => r.id);
      await actAsMember(c, s.a, s.orgA, "owner");
      const ownerA = await visible();
      await actAsOwner(c);
      await actAsMember(c, s.b, s.orgB, "owner");
      const ownerB = await visible();
      await actAsOwner(c);
      await actAs(c, { app_role: "agency_admin", sub: `user_jc_agency_${RUN}` });
      const agency = await visible();
      expect({ ownerA, ownerB, agency }).toEqual({ ownerA: [ana], ownerB: [zoe], agency: [ana, zoe].sort() });
    }));

  it("a Technician reads the check-in of a customer assigned to them and not of one who is not (probe: drop job_checkins_technician_scope -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ana = await checkin(c, s.a, s.bAna, s.ana);
      await checkin(c, s.a, s.bBen, s.ben);
      await actAs(c, { org_id: s.orgA, sub: s.techSub });
      const { rows } = await c.query<{ id: string }>(`select id from ${TABLE}`);
      expect(rows.map((r) => r.id)).toEqual([ana]);
    }));

  it.each(["answer", "answered_at", "booking_id", "contact_id", "account_id", "created_at"])(
    "service_role cannot UPDATE %s (42501): an answer, once recorded, is never rewritten or moved (probe: grant update on the table -> FAILS)",
    (col) => withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana);
      const value = { answer: "not_great", answered_at: new Date(), booking_id: s.bBen, contact_id: s.ben, account_id: s.b, created_at: new Date() }[col];
      await c.query("set local role service_role");
      await expect(c.query(`update ${TABLE} set ${col} = $1 where id = $2`, [value, id])).rejects.toMatchObject({ code: "42501" });
    }));

  it("service_role inserts, reads, stamps review_link_opened_at and deletes on its own grants", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      const id = await checkin(c, s.a, s.bAna, s.ana, "okay");
      await c.query(`update ${TABLE} set review_link_opened_at = now() where id = $1`, [id]);
      const { rows } = await c.query(`select answer, review_link_opened_at is not null as opened from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ answer: "okay", opened: true }]);
      await c.query(`delete from ${TABLE} where id = $1`, [id]);
      expect((await c.query(`select id from ${TABLE} where id = $1`, [id])).rows).toEqual([]);
    }));
});

// ---------------------------------------------------------------------------------------------------------------
// Integrity: one per booking, same account, follows the booking
// ---------------------------------------------------------------------------------------------------------------

describe("job_checkins: one answer per booking, never across accounts, and it follows its booking", () => {
  it("another account cannot hold a check-in for this account's booking (probe: an FK on booking_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // B's id with A's booking and A's customer, as a forged service write would send it.
      expect(await refusedWith(c, () => checkin(c, s.b, s.bAna, s.ana)))
        .toMatchObject({ code: "23503", constraint: "job_checkins_booking_fkey" });
    }));

  it("a check-in names its booking's own customer, never another customer of the same account (probe: drop contact_id from the booking key -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, () => checkin(c, s.a, s.bAna, s.ben)))
        .toMatchObject({ code: "23503", constraint: "job_checkins_booking_fkey" });
    }));

  it("one check-in per booking: a second insert is 23505, and on conflict do nothing keeps the first answer (probe: drop job_checkins_booking_id_key -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await checkin(c, s.a, s.bAna, s.ana, "not_great");
      expect(await refusedWith(c, () => checkin(c, s.a, s.bAna, s.ana, "great")))
        .toMatchObject({ code: "23505", constraint: "job_checkins_booking_id_key" });
      const { rowCount } = await c.query(
        `insert into ${TABLE} (account_id, booking_id, contact_id, answer) values ($1, $2, $3, 'great') on conflict (booking_id) do nothing`,
        [s.a, s.bAna, s.ana]);
      const { rows } = await c.query(`select answer from ${TABLE} where booking_id = $1`, [s.bAna]);
      expect({ rowCount, rows }).toEqual({ rowCount: 0, rows: [{ answer: "not_great" }] });
    }));

  it("the answer is one of great, okay, not_great (23514)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusedWith(c, () => checkin(c, s.a, s.bAna, s.ana, "bad")))
        .toMatchObject({ code: "23514", constraint: "job_checkins_answer_check" });
    }));

  it("when the booking's customer changes, the check-in's contact follows (ON UPDATE CASCADE; probe: drop it -> the update FAILS 23503)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana);
      await c.query("update public.bookings set contact_id = $1 where id = $2", [s.ben, s.bAna]);
      const { rows } = await c.query(`select contact_id from ${TABLE} where id = $1`, [id]);
      expect(rows).toEqual([{ contact_id: s.ben }]);
    }));

  it("a contact merge carries the check-in to the kept record, and its Undo carries it back (plan PR 1 step 0)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const keep = await one(c,
        "insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, 'Keep', '+19565550411', 'person') returning id", [s.a]);
      const other = await one(c,
        "insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, 'Other', '+19565550412', 'person') returning id", [s.a]);
      const job = await booking(c, s.a, s.calA, other);
      const id = await checkin(c, s.a, job, other, "not_great");
      const seen = (await c.query<{ v: unknown }>("select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [s.a, keep, other])).rows[0]!.v;
      await actAsMember(c, s.a, s.orgA, "owner");
      const { rows: [m] } = await c.query<{ r: { status: string; mergeId: number } }>(
        "select public.merge_contacts($1, $2, $3, '{}'::jsonb, $4::jsonb, null) as r", [s.a, keep, other, JSON.stringify(seen)]);
      await actAsOwner(c);
      expect(m!.r.status).toBe("merged");
      const contactOf = async () => (await c.query<{ contact_id: string }>(`select contact_id from ${TABLE} where id = $1`, [id])).rows[0]!.contact_id;
      const merged = await contactOf();
      await actAsMember(c, s.a, s.orgA, "owner");
      const { rows: [u] } = await c.query<{ r: { status: string } }>("select public.undo_contact_merge($1, $2, null) as r", [s.a, m!.r.mergeId]);
      await actAsOwner(c);
      expect({ merged, undone: u!.r.status, after: await contactOf() }).toEqual({ merged: keep, undone: "undone", after: other });
    }));

  it("deleting the booking deletes its check-in and the check-in's To-do (ON DELETE CASCADE, both keys)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana, "not_great");
      const task = await one(c,
        "insert into public.tasks (account_id, contact_id, title, review_checkin_id) values ($1, $2, 'Call Ana', $3) returning id", [s.a, s.ana, id]);
      await c.query("delete from public.bookings where id = $1", [s.bAna]);
      const { rows } = await c.query<{ n: string }>(
        `select (select count(*) from ${TABLE} where id = $1)::text || '/' || (select count(*) from public.tasks where id = $2)::text as n`, [id, task]);
      expect(rows[0]!.n).toBe("0/0");
    }));
});

// ---------------------------------------------------------------------------------------------------------------
// tasks.review_checkin_id and app.keep_task_links
// ---------------------------------------------------------------------------------------------------------------

/** Every column app.keep_task_links guards, in 0097's order, then the one this migration adds. */
const LINKS = [
  "call_id", "consent_event_id", "document_request_id", "document_request_kind", "document_expiry_id", "document_expiry_on",
  "closure_kind", "closure_on", "review_checkin_id",
] as const;

/** A To-do with EVERY link set, as the server writes them (owner role, so the trigger keeps what it is sent). */
async function fullyLinkedTask(c: Client, s: Seed): Promise<{ task: string; links: Record<(typeof LINKS)[number], string> }> {
  const phone = await one(c, "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [s.a, testPhoneNumber()]);
  const call = await one(c, "insert into public.calls (account_id, phone_number_id, contact_id) values ($1, $2, $3) returning id", [s.a, phone, s.ana]);
  const consent = await one(c,
    "insert into public.consent_events (account_id, channel, address, action, method, contact_id) values ($1, 'sms', '+19565550142', 'revoked', 'keyword', $2) returning id",
    [s.a, s.ana]);
  const request = await one(c,
    `insert into public.document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at)
     values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', md5($4) || md5($4 || 'b'), 'link', 'user_x', now() + interval '7 days') returning id`,
    [s.a, s.ana, JSON.stringify([{ key: "insurance", category: "insurance", note: null }]), `jc-${RUN}`]);
  const doc = await one(c,
    "insert into public.documents (account_id, contact_id, title, category, expires_on, source, created_by) values ($1, $2, 'Seguro', 'insurance', '2027-01-31', 'upload', 'user_seed') returning id",
    [s.a, s.ana]);
  const review = await checkin(c, s.a, s.bAna, s.ana, "not_great");
  const links = {
    call_id: call, consent_event_id: consent, document_request_id: request, document_request_kind: "received",
    document_expiry_id: doc, document_expiry_on: "2027-01-31", closure_kind: "closed_day", closure_on: "2027-02-01",
    review_checkin_id: review,
  };
  const task = await one(c,
    `insert into public.tasks (account_id, contact_id, title, ${LINKS.join(", ")})
     values ($1, $2, 'Linked', ${LINKS.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
    [s.a, s.ana, ...LINKS.map((k) => links[k])]);
  return { task, links };
}

const linksOf = async (c: Client, task: string) => (await c.query<Record<string, string | null>>(
  `select ${LINKS.map((k) => `${k}::text as ${k}`).join(", ")} from public.tasks where id = $1`, [task])).rows[0]!;

describe("tasks.review_checkin_id: one To-do per check-in, same account (plan D3)", () => {
  it("a second To-do for the same check-in is 23505 (probe: drop tasks_review_checkin_once -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana, "not_great");
      const task = () => c.query("insert into public.tasks (account_id, contact_id, title, review_checkin_id) values ($1, $2, 'Call Ana', $3)", [s.a, s.ana, id]);
      await task();
      expect(await refusedWith(c, task)).toMatchObject({ code: "23505", constraint: "tasks_review_checkin_once" });
    }));

  it("another account's To-do cannot link this account's check-in (probe: an FK on review_checkin_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana, "not_great");
      expect(await refusedWith(c, () => c.query(
        "insert into public.tasks (account_id, contact_id, title, review_checkin_id) values ($1, $2, 'Forged', $3)", [s.b, s.zoe, id])))
        .toMatchObject({ code: "23503", constraint: "tasks_review_checkin_fkey" });
    }));
});

describe("app.keep_task_links re-emitted: every link the server sets, a signed-in client can neither set nor change (0074, 0080, 0084, 0097, this file)", () => {
  it("a signed-in insert stores NULL in all nine link columns, whatever it sent (probe: re-emit 0084's body -> FAILS on closure_kind, closure_on and review_checkin_id)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.a, s.orgA, "owner");
      // Values the trigger must discard before any FK or CHECK runs: if one survives, its FK refuses the row and the
      // case fails on that 23503 instead.
      const forged = {
        call_id: s.bAna, consent_event_id: s.bAna, document_request_id: s.bAna, document_request_kind: "received",
        document_expiry_id: s.bAna, document_expiry_on: "2027-01-31", closure_kind: "status", closure_on: "2027-02-01",
        review_checkin_id: s.bAna,
      };
      const { rows: [t] } = await c.query<{ id: string }>(
        `insert into public.tasks (account_id, contact_id, title, ${LINKS.join(", ")})
         values ($1, $2, 'Forged', ${LINKS.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
        [s.a, s.ana, ...LINKS.map((k) => forged[k])]);
      await actAsOwner(c);
      expect(await linksOf(c, t!.id)).toEqual(Object.fromEntries(LINKS.map((k) => [k, null])));
    }));

  it("a signed-in update keeps all nine, whatever it sent, and the rest of the row still updates (probe: drop new.review_checkin_id := old.review_checkin_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { task, links } = await fullyLinkedTask(c, s);
      await actAsMember(c, s.a, s.orgA, "owner");
      await c.query(
        `update public.tasks set title = 'Renamed', ${LINKS.map((k) => `${k} = null`).join(", ")} where id = $1`, [task]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query<{ title: string }>("select title from public.tasks where id = $1", [task]);
      expect({ title: r!.title, ...(await linksOf(c, task)) }).toEqual({ title: "Renamed", ...links });
    }));

  it("the server (service_role) sets and clears review_checkin_id freely", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await checkin(c, s.a, s.bAna, s.ana, "not_great");
      await c.query("set local role service_role");
      const { rows: [t] } = await c.query<{ id: string; review_checkin_id: string }>(
        "insert into public.tasks (account_id, contact_id, title, review_checkin_id) values ($1, $2, 'Call Ana', $3) returning id, review_checkin_id", [s.a, s.ana, id]);
      const { rows: [u] } = await c.query("update public.tasks set review_checkin_id = null where id = $1 returning review_checkin_id", [t!.id]);
      expect([t!.review_checkin_id, u]).toEqual([id, { review_checkin_id: null }]);
    }));
});

// ---------------------------------------------------------------------------------------------------------------
// The accessors, live
// ---------------------------------------------------------------------------------------------------------------

/** A completed job for a new customer of this account, through the app's own writers. */
async function completedJob(db: SupabaseClient, accountId: string, hour: number, email?: string): Promise<{ bookingId: string; contactId: string }> {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(db, accountId, { firstName: `Jc${hour}`, ...(email ? { email } : {}) }, "user_test");
  const at = (m: number) => new Date(Date.UTC(2027, 2, 10, hour, m));
  const b = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at(0), endsAt: at(30) }, "user_test");
  await setBookingStatus(db, accountId, b.id, "completed", "user_test");
  return { bookingId: b.id, contactId };
}

describe("recordCheckinAnswer: first answer wins (plan D1, Q7)", () => {
  it("records the first answer with the booking's own customer, and a second answer records nothing and reports the first", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId, contactId } = await completedJob(db, accountId, 9);
      const first = await recordCheckinAnswer(db, accountId, bookingId, "not_great");
      const second = await recordCheckinAnswer(db, accountId, bookingId, "great");
      expect(first).toMatchObject({ status: "recorded", checkin: { bookingId, contactId, accountId, answer: "not_great", reviewLinkOpenedAt: null } });
      expect(second).toEqual({ status: "already", checkin: first.status === "recorded" ? first.checkin : null });
      expect(await getCheckinForBooking(db, accountId, bookingId)).toEqual(second.status === "already" ? second.checkin : null);
    });
  });

  it("ten concurrent answers make exactly one row and one winner, and every caller is told the winner's answer (probe: insert without on conflict do nothing -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await completedJob(db, accountId, 10);
      const answers = ["great", "okay", "not_great", "great", "okay", "not_great", "great", "okay", "not_great", "great"] as const;
      const results = await Promise.all(answers.map((a) => recordCheckinAnswer(db, accountId, bookingId, a)));
      const winners = results.filter((r) => r.status === "recorded");
      expect(winners).toHaveLength(1);
      const won = winners[0]!.status === "recorded" ? winners[0]!.checkin : null;
      expect(results.map((r) => (r.status === "gone" ? "gone" : r.checkin.answer))).toEqual(answers.map(() => won!.answer));
      const { data, error } = await db.from("job_checkins").select("id").eq("booking_id", bookingId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: won!.id }]);
    });
  });

  it("answers gone, and records nothing, for a booking that is not completed or is another account's", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Booked" }, "user_test");
      const booked = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-11T09:00:00Z"), endsAt: new Date("2027-03-11T09:30:00Z") }, "user_test");
      const { bookingId: done } = await completedJob(db, accountId, 11);
      await withTestAccount(async (_db, otherAccountId) => {
        expect(await recordCheckinAnswer(db, accountId, booked.id, "great")).toEqual({ status: "gone" });
        expect(await recordCheckinAnswer(db, otherAccountId, done, "great")).toEqual({ status: "gone" });
      });
      const { data } = await db.from("job_checkins").select("id").in("booking_id", [booked.id, done]);
      expect(data).toEqual([]);
    });
  });

  it("refuses an answer outside the three before any write", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await completedJob(db, accountId, 12);
      await expect(recordCheckinAnswer(db, accountId, bookingId, "meh" as never)).rejects.toThrow(/answer/);
      expect(await getCheckinForBooking(db, accountId, bookingId)).toBeNull();
    });
  });
});

describe("ensureCheckinTask: exactly one To-do for a not-great answer (plan D3)", () => {
  it("twice, then five at once, make one To-do, created once, linked to the check-in and its customer (probe: drop tasks_review_checkin_once -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId, contactId } = await completedJob(db, accountId, 13);
      const r = await recordCheckinAnswer(db, accountId, bookingId, "not_great");
      if (r.status !== "recorded") throw new Error("seed: not recorded");
      const input = { title: "Call Jc13: they said the job was not great", dueAt: "2027-03-10T15:00:00.000Z" };
      const first = await ensureCheckinTask(db, accountId, r.checkin, input, "checkin");
      const again = await ensureCheckinTask(db, accountId, r.checkin, input, "checkin");
      const burst = await Promise.all(Array.from({ length: 5 }, () => ensureCheckinTask(db, accountId, r.checkin, input, "checkin")));
      expect([first.created, again.created, ...burst.map((b) => b.created)]).toEqual([true, false, false, false, false, false, false]);
      expect(new Set([first.id, again.id, ...burst.map((b) => b.id)])).toEqual(new Set([first.id]));
      const { data } = await db.from("tasks").select("id, contact_id, title, review_checkin_id").eq("account_id", accountId);
      expect(data).toEqual([{ id: first.id, contact_id: contactId, title: input.title, review_checkin_id: r.checkin.id }]);
    });
  });

  it("another account's id with this account's check-in throws and never hands back this account's To-do (probe: drop the 23505 lookup's account filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await completedJob(db, accountId, 15);
      const r = await recordCheckinAnswer(db, accountId, bookingId, "not_great");
      if (r.status !== "recorded") throw new Error("seed: not recorded");
      const input = { title: "Call Jc15: they said the job was not great", dueAt: "2027-03-10T15:00:00.000Z" };
      const mine = await ensureCheckinTask(db, accountId, r.checkin, input, "checkin");
      await withTestAccount(async (_db, otherAccountId) => {
        // tasks_review_checkin_once fires before the composite key's check, so this insert is a 23505, and the
        // "already there" read must be scoped to the CALLER's account or it answers with the To-do above.
        await expect(ensureCheckinTask(db, otherAccountId, r.checkin, input, "checkin")).rejects.toThrow(/already there but unreadable/);
        const { data, error } = await db.from("tasks").select("id, account_id").in("account_id", [accountId, otherAccountId]);
        expect(error).toBeNull();
        expect(data).toEqual([{ id: mine.id, account_id: accountId }]);
      });
    });
  });

  it("refuses a check-in that is not not_great, and writes no To-do", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await completedJob(db, accountId, 14);
      const r = await recordCheckinAnswer(db, accountId, bookingId, "okay");
      if (r.status !== "recorded") throw new Error("seed: not recorded");
      await expect(ensureCheckinTask(db, accountId, r.checkin, { title: "x", dueAt: "2027-03-10T15:00:00.000Z" }, "checkin"))
        .rejects.toThrow(/not_great/);
      const { data } = await db.from("tasks").select("id").eq("account_id", accountId);
      expect(data).toEqual([]);
    });
  });
});

describe("markReviewLinkOpened and checkinCounts (plan D1, D8)", () => {
  it("stamps the first press only, and counts asked, answered, each answer and opened since the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const jobs = await Promise.all([15, 16, 17, 18].map((h) => completedJob(db, accountId, h)));
      for (const j of jobs) await stampReviewRequested(db, j.bookingId);
      await recordCheckinAnswer(db, accountId, jobs[0]!.bookingId, "great");
      await recordCheckinAnswer(db, accountId, jobs[1]!.bookingId, "okay");
      await recordCheckinAnswer(db, accountId, jobs[2]!.bookingId, "not_great");
      const opened = [
        await markReviewLinkOpened(db, accountId, jobs[0]!.bookingId),
        await markReviewLinkOpened(db, accountId, jobs[0]!.bookingId),
        await markReviewLinkOpened(db, accountId, jobs[3]!.bookingId),   // never answered: no row to stamp
      ];
      expect(opened).toEqual([true, false, false]);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect(await checkinCounts(db, accountId, since)).toEqual({ asked: 4, answered: 3, great: 1, okay: 1, notGreat: 1, opened: 1 });
      expect(await checkinCounts(db, accountId, new Date(Date.now() + 60_000).toISOString()))
        .toEqual({ asked: 0, answered: 0, great: 0, okay: 0, notGreat: 0, opened: 0 });
    });
  });
});

/**
 * F-072 PR 3: the reads the send, the sweep and the neighbours' guards use, against the real database. The same
 * logic is proven without one in ../review-checkin-guards.test.ts; these prove the queries are valid PostgREST.
 * NOT RUN where no database is reachable (the PR 3 report says so).
 */
describe("the check-in's PR 3 reads, live", () => {
  const NOW_ISO = "2027-03-10T20:00:00.000Z";

  it("listCheckinsMissingTask returns the not-great answers without a To-do, inside the window, bounded (probe: drop the subtraction -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const jobs = await Promise.all([9, 10, 11].map((h) => completedJob(db, accountId, h)));
      const answers = await Promise.all([
        recordCheckinAnswer(db, accountId, jobs[0]!.bookingId, "not_great"),
        recordCheckinAnswer(db, accountId, jobs[1]!.bookingId, "not_great"),
        recordCheckinAnswer(db, accountId, jobs[2]!.bookingId, "okay"),
      ]);
      const [a, b] = answers.map((r) => (r.status === "recorded" ? r.checkin : null));
      await ensureCheckinTask(db, accountId, a!, { title: "Call", dueAt: NOW_ISO }, "checkin");
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect((await listCheckinsMissingTask(db, since, 50)).map((c) => c.id)).toEqual([b!.id]);
      expect(await listCheckinsMissingTask(db, new Date(Date.now() + 60_000).toISOString(), 50)).toEqual([]);
    });
  });

  it("notGreatBookingIds and hasNotGreatCheckin see not_great ONLY, and only this account's booking", async () => {
    await withTestAccount(async (db, accountId) => {
      const bad = await completedJob(db, accountId, 9);
      const fine = await completedJob(db, accountId, 10);
      await recordCheckinAnswer(db, accountId, bad.bookingId, "not_great");
      await recordCheckinAnswer(db, accountId, fine.bookingId, "okay");
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      expect([...(await notGreatBookingIds(db, since))]).toEqual([bad.bookingId]);
      expect(await hasNotGreatCheckin(db, accountId, bad.bookingId)).toBe(true);
      expect(await hasNotGreatCheckin(db, accountId, fine.bookingId)).toBe(false);
      await withTestAccount(async (_db, otherAccountId) => {
        expect(await hasNotGreatCheckin(db, otherAccountId, bad.bookingId)).toBe(false);
      });
    });
  });

  it("accountsWithCheckin is true only for the boolean true on the review_request recipe", async () => {
    await withTestAccount(async (db, accountId) => {
      const cfg = (checkin: unknown) => ({ channel: "email", reviewUrl: "https://g.page/r/x/review", checkin });
      expect((await accountsWithCheckin(db, [accountId])).has(accountId)).toBe(false);
      await upsertAutomation(db, accountId, "review_request", { enabled: true, body: "", config: cfg("true") }, "user_test");
      expect((await accountsWithCheckin(db, [accountId])).has(accountId)).toBe(false);
      await upsertAutomation(db, accountId, "review_request", { enabled: true, body: "", config: cfg(true) }, "user_test");
      expect((await accountsWithCheckin(db, [accountId])).has(accountId)).toBe(true);
      expect(await accountsWithCheckin(db, [])).toEqual(new Set());
    });
  });

  it("a suppressed account with checkin: true is never due and never released (the outbound-suppressed case for the check-in path)", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review", checkin: true } }, "user_test");
      const { bookingId } = await completedJob(db, accountId, 9, "ana.checkin@example.com");
      expect((await listDueReviewRequests(db, NOW_ISO)).map((r) => r.bookingId)).toContain(bookingId);
      expect((await getDueReviewRequestById(db, bookingId)).due?.config?.checkin).toBe(true);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueReviewRequests(db, NOW_ISO)).map((r) => r.bookingId)).not.toContain(bookingId);
      expect((await getDueReviewRequestById(db, bookingId)).due).toBeNull();
    });
  });
});

describe("teardown", () => {
  it("lists job_checkins before bookings, so every teardown deletes it by name and reports its error (probe: drop it -> FAILS)", () => {
    const at = (t: string) => (ACCOUNT_OWNED_TABLES as readonly string[]).indexOf(t);
    expect(at("job_checkins")).toBeGreaterThanOrEqual(0);
    expect(at("job_checkins")).toBeLessThan(at("bookings"));
  });
});
