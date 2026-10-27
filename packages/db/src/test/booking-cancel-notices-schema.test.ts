import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember } from "./db";

/**
 * 0100 booking_cancel_notices: the F-048 customer notice's durable copy, so a
 * notice outlives the process that queued it. SERVER-ONLY: service_role reads
 * and writes it (the Calendar page's cancel action, its after() job, its Undo
 * and the cron sweep, all on the service client); anon and authenticated hold
 * nothing, and RLS is on with no policy (0057 ops_heartbeats' shape).
 * withRollback only; nothing here commits.
 *
 * RED BEFORE APPLY: every case. `'public.booking_cancel_notices'::regclass`
 * raises 42P01 before 0100, and each refusal expects the GRANT's 42501 message.
 *
 * schema-grants-guard.test.ts already fails if anon or authenticated gains any
 * WRITE here; it does not look at SELECT, service_role, the policies or the
 * keys, which is what this file pins.
 */
const TABLE = "public.booking_cancel_notices";
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = Math.random().toString(36).slice(2, 10);
const DENIED = { code: "42501", message: "permission denied for table booking_cancel_notices" };

/** One statement that must fail, inside a savepoint so the transaction lives on. */
async function refused(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e as { code?: string; message: string; constraint?: string };
  }
  await c.query("release savepoint probe");
  return null;
}

type Seed = { accountId: string; bookingId: string; messageId: string; orgId: string };

/** A real account with a cancelled booking and the notice's queued thread row. Owner connection. */
async function seed(c: Client, label: string): Promise<Seed> {
  const one = async (sql: string, params: unknown[]) => String((await c.query(sql, params)).rows[0].id);
  const orgId = `org_BCN_${label}_${RUN}`;
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const accountId = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture BCN',true) returning id",
    [agency.id, orgId]);
  const contactId = await one("insert into contacts (account_id, first_name, email) values ($1,'Ana','ana@example.com') returning id", [accountId]);
  const conversationId = await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [accountId, contactId]);
  const messageId = await one(
    "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'email','outbound','x','person') returning id",
    [accountId, conversationId]);
  const calendarId = await one("insert into calendars (account_id, public_id) values ($1,$2) returning id",
    [accountId, `cal_BCN_${label}_${RUN}`]);
  const bookingId = await one(
    `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, status, author_kind)
       values ($1,$2,$3, now() + interval '1 day', now() + interval '1 day 1 hour', $4, 'cancelled', 'person') returning id`,
    [accountId, calendarId, contactId, `tok_BCN_${label}_${RUN}`]);
  return { accountId, bookingId, messageId, orgId };
}

const INSERT = `insert into booking_cancel_notices (booking_id, account_id, version, message_id, user_id, email, due_at)
  values ($1, $2, now(), $3, 'user_bcn', '{"to":"ana@example.com"}'::jsonb, now() + interval '15 seconds')`;
const insertFor = (s: Seed) => [s.bookingId, s.accountId, s.messageId];

describe("0100 booking_cancel_notices: grants", () => {
  // has_table_privilege, not information_schema: it counts a grant to PUBLIC as
  // every role's own and sees PG17's MAINTAIN (0051's note).
  it("the whole table privilege matrix: service_role holds SELECT, INSERT, UPDATE, DELETE and nothing else; anon, authenticated and PUBLIC hold nothing (mutation: grant select on it to authenticated → FAILS; drop service_role from the revoke → service_role keeps TRUNCATE/MAINTAIN, FAILS)", () =>
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

  it("no column-level grant either: anon, authenticated and PUBLIC hold no column privilege of any kind (mutation: grant select (due_at) on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p) order by r, p`);
      expect(rows).toEqual([]);
    }));

  it("row level security is on with NO policy at all (mutation: drop `enable row level security` → FAILS; add any policy → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(
        `select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));
});

// Code AND message: an RLS refusal is ALSO 42501, so the message proves it is
// the GRANT that refuses. Each statement in its own savepoint.
describe("0100 booking_cancel_notices: refused, as each role would meet it", () => {
  const STATEMENTS: [string, (s: Seed) => [string, unknown[]]][] = [
    ["select", (s) => ["select booking_id from booking_cancel_notices where account_id = $1", [s.accountId]]],
    ["insert", (s) => [INSERT, insertFor(s)]],
    ["update", (s) => ["update booking_cancel_notices set due_at = now() where account_id = $1", [s.accountId]]],
    ["delete", (s) => ["delete from booking_cancel_notices where account_id = $1", [s.accountId]]],
  ];

  for (const [verb, statement] of STATEMENTS) {
    it(`a client Owner of the account cannot ${verb} it: 42501 permission denied for table (mutation: grant ${verb} on it to authenticated → FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `OWN_${verb}`);
        await c.query(INSERT, insertFor(s));
        await actAsMember(c, s.accountId, s.orgId, "owner");
        const [sql, params] = statement(s);
        expect(await refused(c, sql, params)).toMatchObject(DENIED);
      }));

    it(`the agency's own session cannot ${verb} it: 42501 permission denied for table`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `AGY_${verb}`);
        await c.query(INSERT, insertFor(s));
        await actAs(c, { app_role: "agency_admin", sub: `user_bcn_agency_${RUN}` });
        const [sql, params] = statement(s);
        expect(await refused(c, sql, params)).toMatchObject(DENIED);
      }));

    it(`anon cannot ${verb} it: 42501 permission denied for table (mutation: drop anon from the revoke → FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `ANON_${verb}`);
        await c.query(INSERT, insertFor(s));
        await c.query("set local role anon");
        const [sql, params] = statement(s);
        expect(await refused(c, sql, params)).toMatchObject(DENIED);
      }));
  }

  it("positive control: service_role does all four (the writers' own role; mutation: drop delete from its grant → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "SVC");
      await c.query("set local role service_role");
      for (const [, statement] of STATEMENTS) {
        const [sql, params] = statement(s);
        expect(await refused(c, sql, params)).toBeNull();
      }
    }));
});

describe("0100 booking_cancel_notices: shape", () => {
  it("columns, types and nullability are exactly the design's", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'booking_cancel_notices' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "booking_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "version", data_type: "timestamp with time zone", is_nullable: "NO", column_default: null },
        { column_name: "message_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "user_id", data_type: "text", is_nullable: "NO", column_default: null },
        { column_name: "email", data_type: "jsonb", is_nullable: "NO", column_default: null },
        { column_name: "due_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: null },
        { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));

  it("keys: booking_id is the primary key, the booking is the row's OWN account's (composite FK), and all three FKs cascade (mutation: `on delete restrict` on any → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select con.contype::text as type, con.confrelid::regclass::text as ref, con.confdeltype::text as ondelete,
                array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
                        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols
           from pg_constraint con
          where con.conrelid = '${TABLE}'::regclass and con.contype in ('p', 'f')
          order by con.contype, con.confrelid::regclass::text`);
      expect(rows).toEqual([
        { type: "f", ref: "accounts", ondelete: "c", cols: ["account_id"] },
        { type: "f", ref: "bookings", ondelete: "c", cols: ["account_id", "booking_id"] },
        { type: "f", ref: "messages", ondelete: "c", cols: ["message_id"] },
        { type: "p", ref: "-", ondelete: " ", cols: ["booking_id"] },
      ]);
    }));

  it("the sweep's due_at is indexed (mutation: drop the index → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_indexdef(indexrelid) as def from pg_index where indrelid = '${TABLE}'::regclass and not indisprimary`);
      expect(rows.map((r) => r.def)).toEqual([
        "CREATE INDEX booking_cancel_notices_due_at_idx ON public.booking_cancel_notices USING btree (due_at)",
      ]);
    }));

  it("a booking from ANOTHER account is refused by the composite FK (mutation: a plain booking_id FK → the crossed row inserts, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "XA");
      const b = await seed(c, "XB");
      expect(await refused(c, INSERT, [b.bookingId, a.accountId, a.messageId]))
        .toMatchObject({ code: "23503", constraint: "booking_cancel_notices_booking_fkey" });
    }));

  // The account's own cascade is pinned by the catalogue case above only: a row needs its booking (the
  // composite FK), and the booking restricts the account (0017), so the booking's cascade always gets
  // there first, which is how deleteAccountCascade carries these rows away (`bookings` is on its list).
  it("the row leaves with its message (the Undo's discard) and with its booking (mutation: `on delete restrict` on either → that delete is refused, FAILS)", () =>
    withRollback(async (c) => {
      const count = async (s: Seed) => (await c.query("select 1 from booking_cancel_notices where booking_id = $1", [s.bookingId])).rows.length;
      const viaMessage = await seed(c, "CM");
      await c.query(INSERT, insertFor(viaMessage));
      expect(await count(viaMessage)).toBe(1);
      await c.query("delete from messages where id = $1", [viaMessage.messageId]);
      expect(await count(viaMessage)).toBe(0);

      const viaBooking = await seed(c, "CB");
      await c.query(INSERT, insertFor(viaBooking));
      await c.query("delete from bookings where id = $1", [viaBooking.bookingId]);
      expect(await count(viaBooking)).toBe(0);
    }));

  it("one row per booking: a second notice for the same booking is a 23505 on the primary key (the app upserts on it)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "PK");
      await c.query(INSERT, insertFor(s));
      expect(await refused(c, INSERT, insertFor(s))).toMatchObject({ code: "23505", constraint: "booking_cancel_notices_pkey" });
    }));
});
