import { describe, it, expect } from "vitest";
import type { Client, DatabaseError } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Migration 0064: the call card (`calls.reason`, `calls.callback_number`,
 * `calls.caller_words`) and the link from a callback To do to the call it
 * came from (`tasks.call_id`).
 *
 * What the file proves:
 *   - the catalogue: the three card columns (text, nullable, no default);
 *     calls' UNIQUE (account_id, id), the composite FK's target; the FK
 *     itself, the ONLY one covering tasks.call_id, same-account by
 *     construction and `on delete set null (call_id)`; the one-To-do-per-call
 *     partial unique index;
 *   - grants: the card is exactly as server-owned as the rest of `calls`
 *     (0020: the client role reads, only the service role writes), and
 *     tasks.call_id is exactly as client-writable as the rest of `tasks`
 *     (0055's consent_event_id precedent);
 *   - behaviour, on raw rows inside one rolled-back transaction: a link to
 *     the account's own call is written, a link to another account's call is
 *     refused (23503, by name); a second To do for the same call is refused
 *     (23505, by name); deleting the call nulls ONLY the link and the To do
 *     keeps its account (account-teardown.ts deletes calls before tasks); a
 *     signed-in client cannot write the card (42501).
 *
 * RED BEFORE APPLY, legitimately: every test. The columns, the key, the FK
 * and the index do not exist, so each catalogue read comes back empty, each
 * `has_column_privilege` call raises 42703, and every behaviour test names a
 * column that is not there (42703).
 *
 * Runs entirely in `withRollback` (raw pg, owner role, then `actAs` for the
 * client case): nothing commits. One refused statement per transaction
 * (after it the transaction is aborted, 25P02), so each refusal is the LAST
 * statement of its test.
 */

type FkRow = {
  conname: string; cols: string[]; ref: string; refcols: string[];
  ondelete: string; setnullcols: string[] | null; onupdate: string; deferrable: boolean;
};

async function fksCovering(c: Client, table: string, column: string): Promise<FkRow[]> {
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
      where con.contype = 'f' and con.conrelid = $1::regclass
        and exists (select 1 from unnest(con.conkey) k(n)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n
                     where a.attname = $2)
      order by con.conname`,
    [table, column]);
  return rows;
}

const CARD_COLUMNS = ["callback_number", "caller_words", "reason"];

describe("0064 catalogue", () => {
  it("calls carries reason, callback_number and caller_words: text, nullable, no default", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = any($1)
          order by column_name`, [CARD_COLUMNS]);
      expect(rows).toEqual(CARD_COLUMNS.map((column_name) => ({
        column_name, data_type: "text", is_nullable: "YES", column_default: null,
      })));
    });
  });

  it("tasks.call_id is a nullable uuid with no default", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks' and column_name = 'call_id'`);
      expect(rows).toEqual([{ data_type: "uuid", is_nullable: "YES", column_default: null }]);
    });
  });

  it("calls carries UNIQUE (account_id, id), the composite FK's target, and no other unique key", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.calls'::regclass and contype = 'u' order by conname`);
      expect(rows).toEqual([{ conname: "calls_account_id_id_key", def: "UNIQUE (account_id, id)" }]);
    });
  });

  it("exactly one FK covers tasks.call_id: same-account composite onto calls (account_id, id), set null on the link column ONLY (mutation: plain `on delete set null` → setnullcols null, FAILS)", async () => {
    await withRollback(async (c) => {
      // confdeltype 'n' = SET NULL; confupdtype 'a' = NO ACTION. The column
      // list is load-bearing: a plain `on delete set null` on this composite
      // nulls account_id too, which is NOT NULL, so deleting a call that had
      // a To do (account-teardown.ts does, calls before tasks) would fail.
      expect(await fksCovering(c, "public.tasks", "call_id")).toEqual([{
        conname: "tasks_call_fkey",
        cols: ["account_id", "call_id"],
        ref: "calls", refcols: ["account_id", "id"],
        ondelete: "n", setnullcols: ["call_id"], onupdate: "a", deferrable: false,
      }]);
    });
  });

  it("one callback To do per call: a partial unique index on tasks (call_id)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'tasks' and indexname = 'tasks_call_once'`);
      expect(rows).toEqual([{
        indexdef: "CREATE UNIQUE INDEX tasks_call_once ON public.tasks USING btree (call_id) WHERE (call_id IS NOT NULL)",
      }]);
    });
  });
});

describe("0064 grants", () => {
  it("the card is as server-owned as the rest of calls: authenticated reads it and writes none of it; anon has nothing; service_role does all three (mutation: grant update (reason) to authenticated → FAILS)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select r.role, col.name as column,
                has_column_privilege(r.role, 'public.calls', col.name, 'SELECT') as sel,
                has_column_privilege(r.role, 'public.calls', col.name, 'INSERT') as ins,
                has_column_privilege(r.role, 'public.calls', col.name, 'UPDATE') as upd
           from (values ('anon'), ('authenticated'), ('service_role')) r(role)
          cross join unnest($1::text[]) col(name)
          order by r.role, col.name`, [CARD_COLUMNS]);
      const expected = (role: string, sel: boolean, write: boolean) =>
        CARD_COLUMNS.map((column) => ({ role, column, sel, ins: write, upd: write }));
      expect(rows).toEqual([
        ...expected("anon", false, false),
        ...expected("authenticated", true, false),
        ...expected("service_role", true, true),
      ]);
    });
  });

  it("tasks.call_id is exactly as client-writable as tasks.title, the column beside it (0055's consent_event_id precedent)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select r.role, col.name as column,
                has_column_privilege(r.role, 'public.tasks', col.name, 'SELECT') as sel,
                has_column_privilege(r.role, 'public.tasks', col.name, 'INSERT') as ins,
                has_column_privilege(r.role, 'public.tasks', col.name, 'UPDATE') as upd
           from (values ('anon'), ('authenticated'), ('service_role')) r(role)
          cross join (values ('call_id'), ('title')) col(name)
          order by r.role, col.name`);
      const byRole = new Map<string, unknown[]>();
      for (const row of rows as { role: string; column: string }[]) {
        byRole.set(row.role, [...(byRole.get(row.role) ?? []), { ...row, column: "_" }]);
      }
      for (const [role, pair] of byRole) expect(pair[0], role).toEqual(pair[1]);
      expect(byRole.size).toBe(3);
    });
  });
});

/** One account with a phone number, a call and a contact, inside the transaction. */
async function seed(c: Client) {
  const one = async <T>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0] as T;
  const run = Math.random().toString(36).slice(2, 10);
  const agency = await one<{ id: string }>("insert into public.agencies (name) values ('T0064') returning id");
  const acct = async (tag: string) => {
    const a = await one<{ id: string }>(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, $2, 'Fixture 0064', true) returning id`, [agency.id, `org_0064_${tag}_${run}`]);
    // Country code 999 is assigned to no country (testPhoneNumber's rule):
    // never a dialable number, even in a rolled-back row.
    const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
    const number = await one<{ id: string }>(
      "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [a.id, `+999${digits}`]);
    const call = await one<{ id: string }>(
      "insert into public.calls (account_id, phone_number_id, caller_e164) values ($1, $2, '+19565550142') returning id",
      [a.id, number.id]);
    return { id: a.id, org: `org_0064_${tag}_${run}`, call: call.id };
  };
  return { A: await acct("a"), B: await acct("b") };
}

async function insertTask(c: Client, account: string, callId: string | null): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    "insert into public.tasks (account_id, title, call_id) values ($1, 'Call back at 956 555 0142: roof leak', $2) returning id",
    [account, callId]);
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

describe("0064 behaviour", () => {
  it("a To do links to its own account's call; a link to another account's call is refused (23503, by name)", async () => {
    await withRollback(async (c) => {
      const { A, B } = await seed(c);
      // The control first, in the same transaction: a refusal of EVERY link
      // would also "pass" the line after it.
      expect(await refusal(() => insertTask(c, A.id, A.call)), "own account's call").toBeNull();
      expect(await refusal(() => insertTask(c, A.id, B.call)))
        .toEqual({ code: "23503", constraint: "tasks_call_fkey" });
    });
  });

  it("a second To do for the same call is refused (23505, by name); a To do with no call is not limited (mutation: drop the index → FAILS)", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      await insertTask(c, A.id, null);
      await insertTask(c, A.id, null);
      await insertTask(c, A.id, A.call);
      expect(await refusal(() => insertTask(c, A.id, A.call)))
        .toEqual({ code: "23505", constraint: "tasks_call_once" });
    });
  });

  it("deleting the call nulls only the link: the To do keeps its row and its account", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      const task = await insertTask(c, A.id, A.call);
      await c.query("delete from public.calls where id = $1", [A.call]);
      const { rows } = await c.query("select account_id, call_id from public.tasks where id = $1", [task]);
      expect(rows).toEqual([{ account_id: A.id, call_id: null }]);
    });
  });

  it("the service role's card write lands; a signed-in client of the account cannot write it (42501)", async () => {
    await withRollback(async (c) => {
      const { A } = await seed(c);
      await c.query(
        "update public.calls set reason = 'Roof leak', callback_number = '956 555 0142', caller_words = 'My roof is leaking' where id = $1",
        [A.call]);
      await actAs(c, { org_id: A.org, sub: "user_0064" });
      // The control: the same client reads the card (the policy admits it),
      // so the refusal below is the grant, not RLS hiding the row.
      const { rows } = await c.query(
        "select reason, callback_number, caller_words from public.calls where id = $1", [A.call]);
      expect(rows).toEqual([{ reason: "Roof leak", callback_number: "956 555 0142", caller_words: "My roof is leaking" }]);
      expect(await refusal(() => c.query("update public.calls set reason = 'edited' where id = $1", [A.call])))
        .toMatchObject({ code: "42501" });
    });
  });
});
