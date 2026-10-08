import { describe, it, expect } from "vitest";
import type { Client, DatabaseError } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Migration 0061: `bookings.rescheduled_from_id`, the link from a booking to
 * the one it replaced (D-035). Sofía's reschedule is cancel-plus-create, so
 * without the link every reschedule read as a NEW booking on the dashboard and
 * in the Monday report.
 *
 * What the file proves:
 *   - the catalogue: the column (uuid, nullable, no default); bookings'
 *     UNIQUE (account_id, id), the composite FK's target; the FK itself, the
 *     ONLY one covering the column, same-account by construction (0050's
 *     pattern) and `on delete set null (rescheduled_from_id)`; the no-self-link
 *     CHECK; the partial index the FK's delete-side lookup uses;
 *   - grants: the column is exactly as writable as the rest of `bookings`
 *     (0053: the client role reads, only the service role writes);
 *   - behaviour, on raw rows inside one rolled-back transaction: a link inside
 *     the account is written; a link to another account's booking is refused
 *     (23503, by name); deleting the original nulls ONLY the link and the
 *     replacement keeps its account; a self-link is refused (23514); and a
 *     signed-in client cannot set the link (42501).
 *
 * Not here, deliberately: "one DELETE removing an original and its
 * replacement together succeeds" (the shape of `deleteAccountCascade`). It
 * stayed green under every FK action tried, restrict and plain set null
 * included, because rows the same statement deletes are invisible to the
 * referential action, so it could not fail. The teardown is exercised for
 * real by booking.test.ts's reschedule-link block, whose `withTestAccount`
 * deletes linked pairs and throws on any error.
 *
 * RED BEFORE APPLY, legitimately: every test. The column, the key, the FK, the
 * CHECK and the index do not exist, so each catalogue read comes back empty,
 * each `has_column_privilege` call raises 42703, and every behaviour test's
 * insert or update names a column that is not there (42703).
 *
 * Runs entirely in `withRollback` (raw pg, owner role, then `actAs` for the
 * client case): nothing commits, so no fixture account is left behind and the
 * `withTestAccount` delete list is not involved. One refused statement per
 * transaction (after it the transaction is aborted, 25P02), so each refusal is
 * the LAST statement of its test.
 */

type FkRow = {
  conname: string; cols: string[]; ref: string; refcols: string[];
  ondelete: string; setnullcols: string[] | null; onupdate: string; deferrable: boolean;
};

async function fksCovering(c: Client, column: string): Promise<FkRow[]> {
  const { rows } = await c.query<FkRow>(
    `select con.conname,
            array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
            con.confrelid::regclass::text as ref,
            array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as refcols,
            con.confdeltype::text as ondelete,
            case when con.confdelsetcols is null then null else
              array(select a.attname::text from unnest(con.confdelsetcols) with ordinality k(n, i)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) end as setnullcols,
            con.confupdtype::text as onupdate, con.condeferrable as deferrable
       from pg_constraint con
      where con.contype = 'f' and con.conrelid = 'public.bookings'::regclass
        and exists (select 1 from unnest(con.conkey) k(n)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n
                     where a.attname = $1)
      order by con.conname`,
    [column]);
  return rows;
}

describe("0061 catalogue", () => {
  it("bookings.rescheduled_from_id is a nullable uuid with no default", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings' and column_name = 'rescheduled_from_id'`);
      expect(rows).toEqual([{ data_type: "uuid", is_nullable: "YES", column_default: null }]);
    });
  });

  it("bookings carries UNIQUE (account_id, id), the composite FK's target", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.bookings'::regclass and contype = 'u' order by conname`);
      // The whole unique-key surface, so 0016's cancel_token key is pinned
      // as unmoved beside the new one.
      expect(rows).toEqual([
        { conname: "bookings_account_id_id_key", def: "UNIQUE (account_id, id)" },
        { conname: "bookings_cancel_token_key", def: "UNIQUE (cancel_token)" },
      ]);
    });
  });

  it("exactly one FK covers the column: same-account composite onto bookings (account_id, id), set null on the link column ONLY", async () => {
    await withRollback(async (c) => {
      // confdeltype 'n' = SET NULL; confupdtype 'a' = NO ACTION. The column
      // list is load-bearing: a plain `on delete set null` on this composite
      // nulls account_id too, which is NOT NULL, so deleting ANY booking that
      // had been rescheduled would fail (proved on a scratch table before
      // this file was written).
      expect(await fksCovering(c, "rescheduled_from_id")).toEqual([{
        conname: "bookings_rescheduled_from_fkey",
        cols: ["account_id", "rescheduled_from_id"],
        ref: "bookings", refcols: ["account_id", "id"],
        ondelete: "n", setnullcols: ["rescheduled_from_id"], onupdate: "a", deferrable: false,
      }]);
    });
  });

  it("a booking cannot name itself as the one it replaced (CHECK)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.bookings'::regclass and conname = 'bookings_rescheduled_from_not_self'`);
      expect(rows).toEqual([{ def: "CHECK ((rescheduled_from_id <> id))" }]);
    });
  });

  it("the FK's delete-side lookup has its partial index", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'bookings' and indexname = 'bookings_rescheduled_from'`);
      expect(rows).toEqual([{
        indexdef: "CREATE INDEX bookings_rescheduled_from ON public.bookings USING btree (rescheduled_from_id) WHERE (rescheduled_from_id IS NOT NULL)",
      }]);
    });
  });
});

describe("0061 grants: the link is as server-owned as the rest of bookings", () => {
  it("authenticated may read it and may neither insert nor update it; anon cannot write it; service_role can do all three", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select r.role,
                has_column_privilege(r.role, 'public.bookings', 'rescheduled_from_id', 'SELECT') as sel,
                has_column_privilege(r.role, 'public.bookings', 'rescheduled_from_id', 'INSERT') as ins,
                has_column_privilege(r.role, 'public.bookings', 'rescheduled_from_id', 'UPDATE') as upd
           from (values ('anon'), ('authenticated'), ('service_role')) r(role) order by r.role`);
      expect(rows).toEqual([
        // anon's SELECT is 0053's schema-wide shape; the only bookings
        // policy is `to authenticated`, so anon reads zero rows.
        { role: "anon", sel: true, ins: false, upd: false },
        { role: "authenticated", sel: true, ins: false, upd: false },
        { role: "service_role", sel: true, ins: true, upd: true },
      ]);
    });
  });
});

/** Two accounts, each with a contact and a calendar, inside the transaction. */
async function seed(c: Client) {
  const one = async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0] as T;
  const run = Math.random().toString(36).slice(2, 10);
  const agency = await one<{ id: string }>("insert into public.agencies (name) values ('T0061') returning id");
  const acct = async (tag: string) => {
    const a = await one<{ id: string }>(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, $2, 'Fixture 0061', true) returning id`, [agency.id, `org_0061_${tag}_${run}`]);
    const contact = await one<{ id: string }>(
      "insert into public.contacts (account_id, first_name) values ($1, 'Rebooker') returning id", [a.id]);
    const cal = await one<{ id: string }>(
      "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [a.id, `t0061${tag}${run}`]);
    return { id: a.id, org: `org_0061_${tag}_${run}`, contact: contact.id, cal: cal.id };
  };
  return { A: await acct("a"), B: await acct("b") };
}

let slot = 0;
async function insertBooking(
  c: Client, a: { id: string; contact: string; cal: string }, rescheduledFrom: string | null = null,
): Promise<string> {
  // Distinct far-future hours so bookings_no_overlap never answers first.
  slot += 1;
  const starts = new Date(Date.UTC(2032, 0, 1, 0) + slot * 3_600_000);
  const { rows } = await c.query<{ id: string }>(
    `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, rescheduled_from_id)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [a.id, a.cal, a.contact, starts.toISOString(), new Date(starts.getTime() + 1_800_000).toISOString(),
      `test_0061_${Math.random().toString(36).slice(2)}`, rescheduledFrom]);
  return rows[0]!.id;
}

/** The statement's refusal, or null when the database accepted it. */
async function refusal(run: () => Promise<unknown>): Promise<{ code?: string; constraint?: string } | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const err = e as DatabaseError;
    return { code: err.code, constraint: err.constraint };
  }
}

describe("0061 behaviour", () => {
  it("a link inside the account is written; a link to another account's booking is refused (23503, by name)", async () => {
    await withRollback(async (c) => {
      const { A, B } = await seed(c);
      const original = await insertBooking(c, A);
      const theirs = await insertBooking(c, B);
      // The control first, in the same transaction: a refusal of EVERY link
      // would also "pass" the line after it.
      expect(await refusal(() => insertBooking(c, A, original)), "own account's booking").toBeNull();
      expect(await refusal(() => insertBooking(c, A, theirs)))
        .toEqual({ code: "23503", constraint: "bookings_rescheduled_from_fkey" });
    });
  });

  it("deleting the original nulls only the link: the replacement keeps its account and its row", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      const original = await insertBooking(c, A);
      const replacement = await insertBooking(c, A, original);
      await c.query("delete from public.bookings where id = $1", [original]);
      const { rows } = await c.query(
        "select account_id, rescheduled_from_id from public.bookings where id = $1", [replacement]);
      expect(rows).toEqual([{ account_id: A.id, rescheduled_from_id: null }]);
    });
  });

  it("a booking naming itself as the one it replaced is refused (23514)", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      const id = await insertBooking(c, A);
      expect(await refusal(() => c.query(
        "update public.bookings set rescheduled_from_id = id where id = $1", [id])))
        .toEqual({ code: "23514", constraint: "bookings_rescheduled_from_not_self" });
    });
  });

  it("a signed-in client of the account cannot set the link (42501)", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      const original = await insertBooking(c, A);
      const replacement = await insertBooking(c, A);
      await actAs(c, { org_id: A.org, sub: "user_0061" });
      // The control: the same client reads both rows (the policy admits it),
      // so the refusal below is the grant, not RLS hiding the row.
      const { rows } = await c.query("select id from public.bookings where id = any($1)", [[original, replacement]]);
      expect(rows).toHaveLength(2);
      expect(await refusal(() => c.query(
        "update public.bookings set rescheduled_from_id = $1 where id = $2", [original, replacement])))
        .toMatchObject({ code: "42501" });
    });
  });
});
