import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomInt } from "node:crypto";
import { withRollback } from "./db";

/**
 * 0114 (F-077 part 1, plan Task 1; spec section 10, round-2 rulings): the To do queue's two new inline actions.
 *  - calls.transfer_failed_at / transfer_failed_reason ('no_answer' | 'refused'): the handoff routes record the
 *    failure when it happens (calls_transfer_failed_pair, calls_transfer_failed_reason_check), so a call still
 *    being handled never reads as failed; calls_transfer_failed_open indexes the queue's read.
 *  - calls.transfer_followup_at / transfer_followup_by: who marked it handled ("Called back"), and when
 *    (calls_transfer_followup_pair).
 *  - ai_acts.accepted_at / accepted_by: a person marked Sofia's live booking change seen ("Accept"),
 *    held together by ai_acts_accepted_pair.
 * No grant, no policy, no function and no trigger changes. app.ai_acts_act_is_fixed() (0091) forbids eleven NAMED
 * columns and nothing else, so the new columns move without any edit to it.
 *
 * RED BEFORE 0114, legitimately: every case that names a new column, constraint or index (every case here but
 * one). Red against 0114 as first committed (d2b9d402 to 4157d096), legitimately: every calls case and the
 * column-level privilege pin, because the round-2 columns, CHECKs and index are new. GREEN BEFORE 0114 too, and said so: the table-level privilege pin (0020 and 0091
 * already give anon/authenticated no write on either table; it is a non-regression pin for "0114 grants
 * nothing").
 *
 * ONE REFUSED STATEMENT PER withRollback, or a savepoint around it (`attempt`): a refusal otherwise aborts the
 * transaction (25P02). Writes the app makes run as service_role (`svc`), as serviceDb() does.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const HOUR = 3_600_000;
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000 + 123);
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const one = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
/** Runs `fn` as service_role (the app's server client), then returns to the owner. */
async function svc<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("reset role");
  }
}

let seq = 0;
/**
 * One account with one customer, one call from them, and one future booking Sofia made on that call, with its
 * booking_created act: the row the queue's Accept stamps, in the shape ai-acts-schema.test.ts's own seed,
 * booking and actRow helpers build. As the connecting owner, rolled back with the test.
 */
async function seedAct(c: Client) {
  seq += 1;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c,
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'WQA Co',true) returning id",
    [agency!.id, `org_wqa_${RUN}_${seq}`]);
  const contact = await one(c, "insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [acct]);
  const phone = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id",
    [acct, `+999${String(randomInt(0, 1_000_000_000_000)).padStart(12, "0")}`]);
  const call = await one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [acct, phone, contact]);
  const calendar = await one(c, "insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `cal_wqa_${RUN}_${seq}`]);
  const booking = await one(c,
    `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, status, cancel_token, author_kind, updated_at)
       values ($1,$2,$3,$4,$5,'booked',$6,'ai',$7) returning id`,
    [acct, calendar, contact, at(24), at(25), `tok_wqa_${RUN}_${seq}`, NOW.toISOString()]);
  const act = await one(c,
    `insert into ai_acts (account_id, actor, call_id, contact_id, kind, target, after)
       values ($1,'voice',$2,$3,'booking_created',$4::jsonb,$5::jsonb) returning id`,
    [acct, call, contact, JSON.stringify({ bookingId: booking }), JSON.stringify({ startsAt: at(24), endsAt: at(25) })]);
  return { acct, contact, call, booking, act };
}

const WRITES = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"] as const;

const CALL_COLS = [
  { column_name: "transfer_failed_at", data_type: "timestamp with time zone" },
  { column_name: "transfer_failed_reason", data_type: "text" },
  { column_name: "transfer_followup_at", data_type: "timestamp with time zone" },
  { column_name: "transfer_followup_by", data_type: "text" },
];
const T = "2026-11-06T12:00:00Z";

describe("0114: calls records a failed transfer and who called back (round-2 rulings)", () => {
  it("the four columns exist, nullable, with no default (mutation: add a default to any -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = any($1) order by column_name`,
        [CALL_COLS.map((x) => x.column_name)]);
      expect(rows).toEqual(CALL_COLS.map((x) => ({ ...x, is_nullable: "YES", column_default: null })));
    }));

  it("the three CHECKs are exactly these (mutation: add a third reason to the set -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; d: string }>(
        `select conname, pg_get_constraintdef(oid) as d from pg_constraint
          where conrelid = 'public.calls'::regclass
            and conname in ('calls_transfer_failed_pair', 'calls_transfer_failed_reason_check', 'calls_transfer_followup_pair')
          order by conname`);
      expect(rows).toEqual([
        { conname: "calls_transfer_failed_pair", d: "CHECK (((transfer_failed_at IS NULL) = (transfer_failed_reason IS NULL)))" },
        { conname: "calls_transfer_failed_reason_check", d: "CHECK ((transfer_failed_reason = ANY (ARRAY['no_answer'::text, 'refused'::text])))" },
        { conname: "calls_transfer_followup_pair", d: "CHECK (((transfer_followup_at IS NULL) = (transfer_followup_by IS NULL)))" },
      ]);
    }));

  it.each([
    ["transfer_failed_at without a reason", "calls_transfer_failed_pair", `transfer_failed_at = '${T}'`],
    ["a reason without transfer_failed_at", "calls_transfer_failed_pair", "transfer_failed_reason = 'no_answer'"],
    ["a reason outside the set", "calls_transfer_failed_reason_check", `transfer_failed_at = '${T}', transfer_failed_reason = 'busy'`],
    ["transfer_followup_at without who", "calls_transfer_followup_pair", `transfer_followup_at = '${T}'`],
    ["who without transfer_followup_at", "calls_transfer_followup_pair", "transfer_followup_by = 'u1'"],
  ])("refuses %s, by %s (mutation: drop that constraint -> the update lands -> FAILS)", (_t, name, set) =>
    withRollback(async (c) => {
      const s = await seedAct(c);
      await svc(c, () => expect(attempt(c, `update calls set ${set} where id = $1`, [s.call]))
        .rejects.toMatchObject({ code: "23514", constraint: name }));
    }));

  it("the queue's partial index is (account_id, transfer_failed_at) over failed transfers not yet followed up (mutation: drop it, or drop the followup clause -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>(
        "select indexdef as d from pg_indexes where schemaname = 'public' and tablename = 'calls' and indexname = 'calls_transfer_failed_open'");
      expect(rows.map((r) => r.d)).toEqual([
        "CREATE INDEX calls_transfer_failed_open ON public.calls USING btree (account_id, transfer_failed_at) WHERE ((transfer_failed_at IS NOT NULL) AND (transfer_followup_at IS NULL))",
      ]);
    }));

  it("service_role stamps all four (the route's failure, then Called back with who) and clears the follow-up, compare-and-swap on the instant and the person (mutation: revoke update on calls from service_role -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seedAct(c);
      await svc(c, async () => {
        const failed = await attempt(c,
          "update calls set transfer_failed_at = $2, transfer_failed_reason = 'refused' where id = $1 and transfer_failed_at is null", [s.call, T]);
        expect(failed.rowCount).toBe(1);
        const done = await attempt(c,
          "update calls set transfer_followup_at = $2, transfer_followup_by = 'u_caller' where id = $1 and transfer_followup_at is null", [s.call, NOW.toISOString()]);
        expect(done.rowCount).toBe(1);
        const back = await attempt(c,
          "update calls set transfer_followup_at = null, transfer_followup_by = null where id = $1 and transfer_followup_at = $2 and transfer_followup_by = 'u_caller'",
          [s.call, NOW.toISOString()]);
        expect(back.rowCount).toBe(1);
      });
      const { rows: [row] } = await c.query(
        "select transfer_failed_at, transfer_failed_reason, transfer_followup_at, transfer_followup_by from calls where id = $1", [s.call]);
      expect(row).toEqual({ transfer_failed_at: new Date(T), transfer_failed_reason: "refused", transfer_followup_at: null, transfer_followup_by: null });
    }));
});

describe("0114 grants nothing to a client role", () => {
  it("anon and authenticated hold no table-level write on calls or ai_acts (green before 0114 too: a non-regression pin; mutation: grant update on public.calls to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(
        `select r || ' ' || t || ' ' || p as x
           from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('public.calls'), ('public.ai_acts')) tt(t)
          cross join unnest($1::text[]) w(p)
          where has_table_privilege(r, t, p)`, [WRITES]);
      expect(rows).toEqual([]);
    }));

  it("anon and authenticated hold no column-level write on the six new columns (mutation: grant update (accepted_at, accepted_by) on public.ai_acts, or update (transfer_followup_by) on public.calls, to authenticated -> FAILS; has_table_privilege alone does not see a column grant)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ x: string }>(
        `select r || ' ' || t || '.' || col || ' ' || p as x
           from (values ('anon'), ('authenticated')) v(r)
          cross join (values ('public.calls', 'transfer_failed_at'), ('public.calls', 'transfer_failed_reason'),
                             ('public.calls', 'transfer_followup_at'), ('public.calls', 'transfer_followup_by'),
                             ('public.ai_acts', 'accepted_at'), ('public.ai_acts', 'accepted_by')) tc(t, col)
          cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) w(p)
          where has_column_privilege(r, t, col, p)`);
      expect(rows).toEqual([]);
    }));
});

describe("0114: ai_acts.accepted_at / accepted_by", () => {
  it("exist as a nullable timestamptz and a nullable text, neither with a default", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'ai_acts' and column_name in ('accepted_at', 'accepted_by')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "accepted_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "accepted_by", data_type: "text", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("ai_acts_accepted_pair is exactly (accepted_at IS NULL) = (accepted_by IS NULL) (mutation: drop the constraint -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.ai_acts'::regclass and conname = 'ai_acts_accepted_pair'");
      expect(rows.map((r) => r.d)).toEqual(["CHECK (((accepted_at IS NULL) = (accepted_by IS NULL)))"]);
    }));

  it.each([
    ["accepted_at without accepted_by", "accepted_at = now()"],
    ["accepted_by without accepted_at", "accepted_by = 'u1'"],
  ])("refuses %s, by ai_acts_accepted_pair (mutation: drop the constraint -> the lone-column update lands -> FAILS)", (_t, set) =>
    withRollback(async (c) => {
      const s = await seedAct(c);
      await svc(c, () => expect(attempt(c, `update ai_acts set ${set} where id = $1`, [s.act]))
        .rejects.toMatchObject({ code: "23514", constraint: "ai_acts_accepted_pair" }));
    }));

  it("an ACCEPTED act can still be undone from the record: undo_ai_booking_act answers undone, cancels the booking and stamps undone_at beside accepted_at (plan review C1; mutation: add check (not (accepted_at is not null and undone_at is not null)) -> its final write raises 23514 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seedAct(c);
      await svc(c, async () => {
        expect((await attempt(c, "update ai_acts set accepted_at = $2, accepted_by = 'u_accepter' where id = $1", [s.act, NOW.toISOString()])).rowCount).toBe(1);
        const { rows: [r] } = await attempt(c, "select public.undo_ai_booking_act($1, $2, 'u_undoer', $3) as r", [s.acct, s.act, NOW.toISOString()]);
        expect(r!.r).toBe("undone");
      });
      const { rows: [act] } = await c.query(
        "select accepted_at, accepted_by, undone_at, undone_by from ai_acts where id = $1", [s.act]);
      expect(act).toEqual({ accepted_at: NOW, accepted_by: "u_accepter", undone_at: NOW, undone_by: "u_undoer" });
      const { rows: [b] } = await c.query("select status from bookings where id = $1", [s.booking]);
      expect(b).toEqual({ status: "cancelled" });
    }));

  it("app.ai_acts_act_is_fixed still refuses target moving in the SAME statement as an accept, and the refusal is that clause's (the second half swaps in the function minus its target comparison, inside this rolled-back transaction, and the same update lands; mutation: drop `or new.target is distinct from old.target` before the first half -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seedAct(c);
      const combined = `update ai_acts set accepted_at = now(), accepted_by = 'u1', target = '{"bookingId":"00000000-0000-0000-0000-000000000000"}'::jsonb where id = $1`;
      await svc(c, () => expect(attempt(c, combined, [s.act]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/ai_acts_act_is_fixed/) }));
      // Not vacuous: the refusal above is the target clause's. Replace the function with that one comparison
      // dropped (the rest verbatim from 0091, search_path as 0096 left it), rolled back with the test.
      await c.query(`create or replace function app.ai_acts_act_is_fixed() returns trigger
        language plpgsql set search_path = pg_catalog, pg_temp as $f$
        begin
          if new.id is distinct from old.id or new.account_id is distinct from old.account_id
             or new.actor is distinct from old.actor or new.call_id is distinct from old.call_id
             or new.chat_id is distinct from old.chat_id or new.contact_id is distinct from old.contact_id
             or new.kind is distinct from old.kind
             or new.before is distinct from old.before or new.after is distinct from old.after
             or new.created_at is distinct from old.created_at then
            raise exception 'ai_acts_act_is_fixed' using errcode = 'P0001';
          end if;
          return new;
        end $f$`);
      const r = await svc(c, () => c.query(combined, [s.act]));
      expect(r.rowCount).toBe(1);
    }));
});
