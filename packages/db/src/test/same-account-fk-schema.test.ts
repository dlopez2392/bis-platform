import { describe, it, expect } from "vitest";
import type { Client, DatabaseError } from "pg";
import { withRollback } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact } from "../contacts";
import { getOrCreateCalendar } from "../booking";
import { ensureDefaultPipeline } from "../crm-config";

/**
 * Migration 0050: a booking's contact and calendar, and a deal's contact, are
 * the row's OWN account's, enforced by the schema.
 *
 * What the file proves:
 *   - the catalogue: `contacts` and `calendars` each carry UNIQUE
 *     (account_id, id); `bookings (account_id, contact_id)`,
 *     `bookings (account_id, calendar_id)` and
 *     `opportunities (account_id, contact_id)` are composite FKs onto them,
 *     with 0017's / 0003's delete actions unchanged; and each of the three
 *     columns is covered by EXACTLY ONE foreign key, so no single-column FK
 *     survives beside its composite;
 *   - PostgREST still resolves every embed the app uses on these tables as
 *     ONE relationship. A leftover single-column FK next to a composite one
 *     is two relationships between the same tables, and every
 *     `contacts(...)` / `calendars!inner(...)` embed then errors PGRST201 in
 *     production. The probe's ability to see that is shown by a control on
 *     a pair that really has two FKs (`contact_duplicate_flags`, 0033);
 *   - behaviour: a booking on account A carrying B's contact, or B's
 *     calendar, and a deal on A carrying B's contact, are each refused with
 *     23503 naming the composite constraint, while the same insert with A's
 *     own rows succeeds; and re-homing a contact to another account while a
 *     booking or deal of its old account points at it is refused too — the
 *     other door into a crossed row.
 *
 * RED BEFORE APPLY: every catalogue assertion (the keys and composite FKs do
 * not exist yet; the three single-column FKs do) and every refusal (the
 * crossed insert and the re-home both succeed today) is red until 0050 is
 * applied. GREEN BEFORE APPLY, legitimately: the own-account controls and the
 * PostgREST probes (one FK per pair is today's state too).
 *
 * The inserts run in `withRollback` on accounts `withTestAccount` made real:
 * a crossed row that the database still accepts (before apply) is rolled
 * back with its transaction and never commits, so it can never hold an FK
 * into account B when B's teardown runs. One refused statement per
 * transaction (after it the transaction is aborted, 25P02), so each case
 * gets its own.
 */

type FkRow = { conname: string; cols: string[]; ref: string; refcols: string[]; ondelete: string; onupdate: string; deferrable: boolean };

async function fksCovering(c: Client, table: string, column: string): Promise<FkRow[]> {
  const { rows } = await c.query<FkRow>(
    `select con.conname,
            array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
            con.confrelid::regclass::text as ref,
            array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as refcols,
            con.confdeltype::text as ondelete, con.confupdtype::text as onupdate, con.condeferrable as deferrable
       from pg_constraint con
      where con.contype = 'f' and con.conrelid = $1::regclass
        and exists (select 1 from unnest(con.conkey) k(n)
                      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n
                     where a.attname = $2)
      order by con.conname`,
    [`public.${table}`, column]);
  return rows;
}

// confdeltype / confupdtype: 'r' RESTRICT, 'a' NO ACTION.
const EXPECTED: Record<string, FkRow> = {
  "bookings.contact_id": {
    conname: "bookings_contact_id_fkey", cols: ["account_id", "contact_id"],
    ref: "contacts", refcols: ["account_id", "id"], ondelete: "r", onupdate: "a", deferrable: false,
  },
  "bookings.calendar_id": {
    conname: "bookings_calendar_id_fkey", cols: ["account_id", "calendar_id"],
    ref: "calendars", refcols: ["account_id", "id"], ondelete: "r", onupdate: "a", deferrable: false,
  },
  "opportunities.contact_id": {
    conname: "opportunities_contact_id_fkey", cols: ["account_id", "contact_id"],
    ref: "contacts", refcols: ["account_id", "id"], ondelete: "a", onupdate: "a", deferrable: false,
  },
};

describe("0050 catalogue", () => {
  it.each(Object.keys(EXPECTED))("%s is covered by exactly one FK: the composite onto (account_id, id)", async (key) => {
    const [table, column] = key.split(".") as [string, string];
    await withRollback(async (c) => {
      // toEqual on the whole list: a surviving single-column FK beside the
      // composite is a second element, and reds here by name.
      expect(await fksCovering(c, table, column)).toEqual([EXPECTED[key]]);
    });
  });

  it("contacts and calendars each carry UNIQUE (account_id, id), the composite FKs' target", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ tbl: string; conname: string; def: string }>(
        `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
           from pg_constraint
          where contype = 'u' and conrelid in ('public.contacts'::regclass, 'public.calendars'::regclass)
          order by 1, 2`);
      // The whole unique-key surface of both tables, so the two older
      // calendar keys (0016) are pinned as unmoved alongside the new ones.
      expect(rows).toEqual([
        { tbl: "calendars", conname: "calendars_account_id_id_key", def: "UNIQUE (account_id, id)" },
        { tbl: "calendars", conname: "calendars_one_per_account", def: "UNIQUE (account_id)" },
        { tbl: "calendars", conname: "calendars_public_id_key", def: "UNIQUE (public_id)" },
        { tbl: "contacts", conname: "contacts_account_id_id_key", def: "UNIQUE (account_id, id)" },
      ]);
    });
  });
});

describe("0050 PostgREST sees one relationship per embed", () => {
  // No rows are needed: PostgREST resolves an embed's relationship when it
  // parses the request, before any row is read. The filter on a random id
  // keeps the reads empty.
  const nobody = "00000000-0000-0000-0000-000000000000";

  it("the probe can see an ambiguous embed (control: contact_duplicate_flags has TWO FKs to contacts, 0033)", async () => {
    const { error } = await serviceDb().from("contact_duplicate_flags")
      .select("id, contacts(id)").eq("account_id", nobody).limit(1);
    expect(error?.code).toBe("PGRST201");
  });

  it.each([
    ["bookings", "id, contacts(account_id), calendars(account_id)"],
    ["bookings", "id, contacts!inner(account_id), calendars!inner(account_id)"],
    ["opportunities", "id, contacts(account_id)"],
    ["opportunities", "id, contacts!inner(account_id)"],
  ])("%s: `%s` resolves", async (table, select) => {
    const { error } = await serviceDb().from(table).select(select).eq("account_id", nobody).limit(1);
    expect(error).toBeNull();
  });
});

type Fixture = {
  accountA: string; accountB: string;
  contactA: string; contactB: string; calA: string; calB: string;
  pipelineA: string; stageA: string;
};

/** Two real accounts, each with a contact and a calendar; A with a pipeline. */
async function withTwoAccounts(fn: (f: Fixture) => Promise<void>) {
  await withTestAccount(async (db, accountA) => {
    await withTestAccount(async (_db, accountB) => {
      const { id: contactA } = await createContact(db, accountA, { firstName: "Own" }, "user_test");
      const { id: contactB } = await createContact(db, accountB, { firstName: "Theirs" }, "user_test");
      const calA = (await getOrCreateCalendar(db, accountA, "user_test")).id;
      const calB = (await getOrCreateCalendar(db, accountB, "user_test")).id;
      const { pipelineId: pipelineA } = await ensureDefaultPipeline(db, accountA);
      const { data: stage, error } = await db.from("pipeline_stages")
        .select("id").eq("account_id", accountA).eq("pipeline_id", pipelineA).limit(1).single();
      if (error || !stage) throw new Error(`stage fixture failed: ${error?.message}`);
      await fn({ accountA, accountB, contactA, contactB, calA, calB, pipelineA, stageA: (stage as { id: string }).id });
    });
  });
}

let slot = 0;
const insertBooking = (c: Client, account: string, calendar: string, contact: string) => {
  // Distinct far-future hours so bookings_no_overlap never answers first.
  slot += 1;
  const starts = new Date(Date.UTC(2031, 0, 1, 0) + slot * 3_600_000);
  return c.query(
    `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token)
     values ($1, $2, $3, $4, $5, $6)`,
    [account, calendar, contact, starts.toISOString(), new Date(starts.getTime() + 1_800_000).toISOString(),
      `test_0050_${Math.random().toString(36).slice(2)}`]);
};
const insertDeal = (c: Client, f: Fixture, contact: string) => c.query(
  `insert into public.opportunities (account_id, contact_id, pipeline_id, stage_id, name)
   values ($1, $2, $3, $4, 'Reroof')`,
  [f.accountA, contact, f.pipelineA, f.stageA]);

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

describe("0050 behaviour: a crossed row cannot be written", () => {
  it("a booking on A with B's contact is refused (23503); with A's own contact it is written", async () => {
    await withTwoAccounts(async (f) => {
      await withRollback(async (c) => {
        // The control first, in the same transaction: a refusal of EVERY
        // booking would also "pass" the line after it.
        expect(await refusal(() => insertBooking(c, f.accountA, f.calA, f.contactA)), "own contact").toBeNull();
        expect(await refusal(() => insertBooking(c, f.accountA, f.calA, f.contactB)))
          .toEqual({ code: "23503", constraint: "bookings_contact_id_fkey" });
      });
    });
  });

  it("a booking on A on B's calendar is refused (23503); on A's own calendar it is written", async () => {
    await withTwoAccounts(async (f) => {
      await withRollback(async (c) => {
        expect(await refusal(() => insertBooking(c, f.accountA, f.calA, f.contactA)), "own calendar").toBeNull();
        expect(await refusal(() => insertBooking(c, f.accountA, f.calB, f.contactA)))
          .toEqual({ code: "23503", constraint: "bookings_calendar_id_fkey" });
      });
    });
  });

  it("a deal on A with B's contact is refused (23503); with A's own contact it is written", async () => {
    await withTwoAccounts(async (f) => {
      await withRollback(async (c) => {
        expect(await refusal(() => insertDeal(c, f, f.contactA)), "own contact").toBeNull();
        expect(await refusal(() => insertDeal(c, f, f.contactB)))
          .toEqual({ code: "23503", constraint: "opportunities_contact_id_fkey" });
      });
    });
  });

  it.each(["booking", "deal"] as const)(
    "re-homing a contact to another account under its %s is refused (23503); with nothing pointing at it, it moves",
    async (kind) => {
      await withTwoAccounts(async (f) => {
        await withRollback(async (c) => {
          const { rows } = await c.query<{ id: string }>(
            `insert into public.contacts (account_id, first_name) values ($1, 'Spare') returning id`, [f.accountA]);
          const spare = rows[0]!.id;
          const rehome = (id: string) => c.query(
            `update public.contacts set account_id = $1 where id = $2`, [f.accountB, id]);
          // The control: a contact nothing points at can move (the database
          // does not forbid re-homing as such, only re-homing out from under
          // a row of the old account).
          expect(await refusal(() => rehome(spare)), "a contact nothing points at").toBeNull();
          await (kind === "booking" ? insertBooking(c, f.accountA, f.calA, f.contactA) : insertDeal(c, f, f.contactA));
          expect(await refusal(() => rehome(f.contactA))).toEqual({
            code: "23503",
            constraint: kind === "booking" ? "bookings_contact_id_fkey" : "opportunities_contact_id_fkey",
          });
        });
      });
    });
});
