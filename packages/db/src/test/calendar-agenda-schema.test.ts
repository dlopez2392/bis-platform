import { describe, it, expect } from "vitest";
import { Client, type DatabaseError } from "pg";
import "dotenv/config";
import { withRollback } from "./db";

/**
 * 0107 (F-046 part 1, spec sections 3 and 7): staff-made jobs (author_kind = 'person') may overlap; a
 * customer-made live row (the public page, the customer's move, Sofia) may overlap nothing live, staff
 * jobs included; every live-booking write waits on its calendar row; undo_staff_move takes a staff move
 * back in one transaction.
 *
 * RED BEFORE 0107, legitimately: the catalogue, the two "staff may overlap" cases, the new columns' rules,
 * undo_staff_move and the customer-first race (0016's constraint refuses every overlap; the columns, the
 * trigger and the function do not exist). GREEN BEFORE 0107 TOO, and said so: the cases that pin what
 * customers KEEP (refused over a staff job, by insert and by un-cancel; back-to-back legal; a cancelled or
 * another calendar's job blocks nothing; the staff-first race), because 0016 already refused all of them.
 * Their red is each case's named mutation of 0107, run after apply (Step 4b). The undo_ai_booking_act lock
 * race is red before 0107 only because its shared seed (moveSeed) writes hold_until for the staff pair, so it
 * says nothing pre-apply; its one real red is dropping 0107's added lock, which turns it into 40P01 (mutation 9).
 * The race cases COMMIT, so they run only against a database on this machine
 * (access-log-concurrency.test.ts's onThisMachine).
 *
 * ONE REFUSED STATEMENT PER SAVEPOINT (`attempt`): a refusal otherwise aborts the transaction (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const T0 = Date.UTC(2031, 5, 2, 15);                              // 15:00 UTC, a Monday far ahead
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
let tok = 0;

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
const one = async (c: Client, sql: string, args: unknown[] = []) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

type Seed = { agency: string; acct: string; acctB: string; cal: string; calB: string; ana: string; beto: string; anaB: string; place: string; placeB: string };
async function seed(c: Client, tag = "s"): Promise<Seed> {
  const agency = await one(c, "insert into public.agencies (name) values ('T0107') returning id");
  const acct = await one(c, "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'T0107 A') returning id", [agency, `org_test_0107a_${tag}_${RUN}`]);
  const acctB = await one(c, "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'T0107 B') returning id", [agency, `org_test_0107b_${tag}_${RUN}`]);
  const cal = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [acct, `t0107a${tag}${RUN}`]);
  const calB = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [acctB, `t0107b${tag}${RUN}`]);
  const ana = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Ana') returning id", [acct]);
  const beto = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Beto') returning id", [acct]);
  const anaB = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Ana B') returning id", [acctB]);
  const place = await one(c, "insert into public.places (account_id, contact_id, address) values ($1, $2, '1 Main St') returning id", [acct, ana]);
  const placeB = await one(c, "insert into public.places (account_id, contact_id, address) values ($1, $2, '2 Elm St') returning id", [acctB, anaB]);
  return { agency, acct, acctB, cal, calB, ana, beto, anaB, place, placeB };
}

type Row = { kind?: "person" | "customer" | "ai"; status?: string; acct?: string; cal?: string; contact?: string;
  from?: number; to?: number; place?: string; meeting?: string; hold?: string; settled?: string; notice?: string;
  sent?: string; rescheduledFrom?: string; updatedAt?: string };
/** Inserts a booking naming ONLY the columns given, so the cases that use no 0107 column run (and fail by
 *  assertion) before 0107 too. Default: A's calendar, Ana, 15:00-16:00, booked, person-made. */
function booking(c: Client, s: Seed, r: Row = {}) {
  tok += 1;
  const cols: Record<string, unknown> = {
    account_id: r.acct ?? s.acct, calendar_id: r.cal ?? s.cal, contact_id: r.contact ?? s.ana,
    starts_at: at(r.from ?? 0), ends_at: at(r.to ?? 1), status: r.status ?? "booked",
    cancel_token: `tok_0107_${RUN}_${tok}`, author_kind: r.kind ?? "person",
    author_id: (r.kind ?? "person") === "person" ? "user_0107" : null,
    place_id: r.place, meeting_type: r.meeting, hold_until: r.hold, hold_settled_at: r.settled,
    notice_wanted: r.notice, notice_sent_at: r.sent, rescheduled_from_id: r.rescheduledFrom, updated_at: r.updatedAt,
  };
  const names = Object.keys(cols).filter((k) => cols[k] !== undefined);
  return attempt(c, `insert into public.bookings (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    names.map((k) => cols[k])).then((res) => res.rows[0]!.id as string);
}
const refusal = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const d = e as DatabaseError; return { code: d.code, constraint: d.constraint ?? null, message: d.message }; }
  return null;
};
const statusOf = async (c: Client, id: string) =>
  (await c.query<{ status: string; updated_at: Date }>("select status, updated_at from public.bookings where id = $1", [id])).rows[0];

describe("0107: the catalogue", () => {
  it("adds the six columns, nullable, with no default", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings'
            and column_name in ('place_id','meeting_type','hold_until','hold_settled_at','notice_wanted','notice_sent_at')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "hold_settled_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "hold_until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "meeting_type", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "notice_sent_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "notice_wanted", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "place_id", data_type: "uuid", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("bookings_no_overlap keeps its name and binds live customer-made rows only (mutation: re-add it without the author_kind term -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_no_overlap'");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.def).toContain("EXCLUDE USING gist");
      expect(rows[0]!.def).toContain("status = 'booked'");
      expect(rows[0]!.def).toContain("author_kind <> 'person'");
    }));

  it("the guard fires before insert and before an update of status, starts_at, ends_at, calendar_id or author_kind (mutation: before insert only -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.bookings'::regclass and tgname = 'bookings_slot_guard'");
      expect(rows.map((r) => r.def)).toEqual([
        "CREATE TRIGGER bookings_slot_guard BEFORE INSERT OR UPDATE OF status, starts_at, ends_at, calendar_id, author_kind ON public.bookings FOR EACH ROW EXECUTE FUNCTION app.bookings_slot_guard()",
      ]);
    }));

  it("app.bookings_slot_guard is a definer with pg_temp last; undo_staff_move an invoker only service_role may run (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where (n.nspname, p.proname) in (('app', 'bookings_slot_guard'), ('public', 'undo_staff_move'))
          order by p.proname`);
      expect(rows).toEqual([
        { proname: "bookings_slot_guard", prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], auth: false, anon: false, svc: true },
        { proname: "undo_staff_move", prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"], auth: false, anon: false, svc: true },
      ]);
    }));

  it("the three indexes exist with their predicates (mutation: drop bookings_staff_live -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and tablename = 'bookings' and indexname in ('bookings_place','bookings_hold_due','bookings_staff_live') order by 1");
      expect(rows.map((r) => r.indexname)).toEqual(["bookings_hold_due", "bookings_place", "bookings_staff_live"]);
    }));
});

describe("0107: who may overlap (R1, R2, R11)", () => {
  it("two overlapping staff-made rows both save, side by side (R1; mutation: drop `and author_kind <> 'person'` from the constraint -> 23P01, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      expect(await refusal(booking(c, s, { from: 0.5, to: 1.5, contact: s.beto }))).toBeNull();
    }));

  it("a customer-made row over a live staff job is refused 23P01 naming bookings_no_overlap (R2; mutations: drop the trigger's exists -> saves, FAILS; errcode P0001 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      const r = await refusal(booking(c, s, { kind: "customer", from: 0.5, to: 1.5, contact: s.beto }));
      expect(r?.code).toBe("23P01");
      expect(r?.message).toContain("bookings_no_overlap");
    }));

  it("Sofia's row (ai) is customer-made too and is refused over a staff job (mutation: the trigger tests author_kind = 'customer' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      expect((await refusal(booking(c, s, { kind: "ai", from: 0.25, to: 0.75 })))?.code).toBe("23P01");
    }));

  it("two overlapping customer-made rows: still the constraint's own 23P01 (mutation: predicate author_kind = 'person' -> saves, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { kind: "customer", from: 0, to: 1 });
      const r = await refusal(booking(c, s, { kind: "customer", from: 0.5, to: 1.5, contact: s.beto }));
      expect(r).toMatchObject({ code: "23P01", constraint: "bookings_no_overlap" });
    }));

  it("a customer row starting exactly at a staff job's end, or ending exactly at its start, saves ([) bounds; mutation: tstzrange(..., '[]') in the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 1, to: 2 });
      expect(await refusal(booking(c, s, { kind: "customer", from: 2, to: 3 }))).toBeNull();
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1, contact: s.beto }))).toBeNull();
    }));

  it("a cancelled staff job blocks nothing (mutation: drop b.status = 'booked' from the exists -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1, status: "cancelled" });
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1 }))).toBeNull();
    }));

  it("a staff job on account B's calendar does not block account A (mutation: drop b.calendar_id = new.calendar_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { acct: s.acctB, cal: s.calB, contact: s.anaB, from: 0, to: 1 });
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1 }))).toBeNull();
    }));

  it("a cancelled customer row flipped back to booked over a staff job is refused (the UPDATE path; mutation: before insert only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const old = await booking(c, s, { kind: "customer", status: "cancelled", from: 0, to: 1 });
      await booking(c, s, { from: 0, to: 1, contact: s.beto });
      const r = await refusal(attempt(c, "update public.bookings set status = 'booked' where id = $1", [old]));
      expect(r?.code).toBe("23P01");
      expect((await statusOf(c, old))!.status).toBe("cancelled");
    }));

  it("a staff job flipped back to booked over a customer row saves (R1; mutation: the constraint without its author_kind term -> 23P01, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const job = await booking(c, s, { status: "cancelled", from: 0, to: 1 });
      await booking(c, s, { kind: "customer", from: 0, to: 1, contact: s.beto });
      expect(await refusal(attempt(c, "update public.bookings set status = 'booked' where id = $1", [job]))).toBeNull();
    }));
});

describe("0107: the new columns' rules", () => {
  it("a place of another account is refused 23503 by bookings_place_fkey (mutation: a single-column FK onto places(id) -> saves, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, { place: s.placeB }))).toMatchObject({ code: "23503", constraint: "bookings_place_fkey" });
      expect(await refusal(booking(c, s, { place: s.place, contact: s.beto, from: 3, to: 4 }))).toBeNull();
    }));

  it("a place a job names cannot be deleted (NO ACTION; mutation: on delete set null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { place: s.place });
      expect(await refusal(attempt(c, "delete from public.places where id = $1", [s.place])))
        .toMatchObject({ code: "23503", constraint: "bookings_place_fkey" });
    }));

  it.each([
    ["bookings_meeting_type_check", { meeting: "zoom" }],
    ["bookings_hold_staff_only", { kind: "customer" as const, hold: at(-1) }],
    ["bookings_hold_settled_pair", { settled: at(-1) }],
    ["bookings_notice_wanted_check", { notice: "confirmation" }],
    ["bookings_notice_wanted_check", { hold: at(-1), notice: "reminder" }],
    ["bookings_notice_sent_after", { hold: at(-1), notice: "confirmation", sent: at(-1) }],
  ])("%s refuses %j (mutation: drop that constraint -> FAILS)", (name, row) =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, row))).toMatchObject({ code: "23514", constraint: name });
    }));

  it("a fully settled staff job with every column saves (the positive control for the table above)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, {
        place: s.place, meeting: "video", hold: at(-1), settled: at(-1), notice: "moved", sent: at(-1),
      }))).toBeNull();
    }));
});

describe("0107: undo_staff_move (spec 3.3)", () => {
  const V = new Date(T0 - 60_000).toISOString();
  const NOW = new Date(T0 - 30_000).toISOString();
  const undo = async (c: Client, acct: string, neu: string, old: string, version = V) => {
    await c.query("set local role service_role");
    try {
      return (await attempt(c, "select public.undo_staff_move($1, $2, $3, $4, $5) as r", [acct, neu, old, version, NOW])).rows[0]!.r as string;
    } finally {
      await c.query("reset role");
    }
  };
  /** A staff move as moveBooking leaves it: the old row cancelled at V, the new person row naming it, its hold open. */
  async function moved(c: Client, s: Seed, o: { oldKind?: "person" | "customer"; settled?: boolean } = {}) {
    const old = await booking(c, s, { kind: o.oldKind ?? "person", status: "cancelled", updatedAt: V, from: 0, to: 1 });
    const neu = await booking(c, s, { from: 5, to: 6, rescheduledFrom: old, hold: at(-0.01), settled: o.settled ? at(-0.005) : undefined });
    return { old, neu };
  }

  it("undone: the new row is GONE and the old one booked again at p_now (mutation: cancel the new row instead of deleting it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("undone");
      expect((await c.query("select 1 from public.bookings where id = $1", [m.neu])).rowCount).toBe(0);
      expect(await statusOf(c, m.old)).toEqual({ status: "booked", updated_at: new Date(NOW) });
    }));

  it("too_late: the new row's hold has settled (its email went or is going); nothing changes (mutation: drop hold_settled_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s, { settled: true });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("too_late");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
      expect((await statusOf(c, m.old))!.status).toBe("cancelled");
    }));

  it("time_taken: a customer booking cannot come back over a staff job that took its time, and the new row stays (mutation: move the restore outside the inner block -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s, { oldKind: "customer" });
      await booking(c, s, { from: 0, to: 1, contact: s.beto });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("time_taken");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
      expect((await statusOf(c, m.old))!.status).toBe("cancelled");
    }));

  it("changed: the old row no longer carries the move's version (mutation: drop updated_at = p_cancelled_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, m.neu, m.old, new Date(T0 - 59_000).toISOString())).toBe("changed");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("changed: a row names the new one in rescheduled_from_id (mutation: drop the not-exists -> the delete lands, the FK's SET NULL silently unlinks that row, and it answers undone, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      // The new row stays BOOKED here on purpose: a real second move would cancel it, and then the status
      // term alone would refuse the delete, so the not-exists guard could not be seen to matter.
      await booking(c, s, { from: 8, to: 9, rescheduledFrom: m.neu });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("changed");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("gone: an unknown new id, and another account's id, touch nothing (mutation: drop b.account_id = p_account_id from the delete -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, "00000000-0000-0000-0000-000000000000", m.old)).toBe("gone");
      expect(await undo(c, s.acctB, m.neu, m.old)).toBe("gone");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("a client-role call is refused 42501 (by the bookings table privilege as much as the function's; the EXECUTE grant itself is pinned by the catalogue case above, not here)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      await c.query("set local role authenticated");
      expect((await refusal(attempt(c, "select public.undo_staff_move($1, $2, $3, $4, $5)", [s.acct, m.neu, m.old, V, NOW])))?.code).toBe("42501");
      await c.query("reset role");
    }));
});

/* ---------- the races: two committed connections, this machine only ---------- */

function onThisMachine(raw: string | undefined): boolean {
  if (!raw || raw.includes("?")) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
const connect = async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, connectionTimeoutMillis: 10_000 });
  await c.connect();
  return c;
};
async function waitsOnLock(admin: Client, pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const { rowCount } = await admin.query("select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid]);
    if (rowCount) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
async function raceSeed(admin: Client, tag: string): Promise<Seed> {
  await admin.query("begin");
  const s = await seed(admin, tag);
  await admin.query("commit");
  return s;
}
async function raceTeardown(admin: Client, s: Seed | null) {
  if (!s) return;
  await admin.query("delete from public.bookings where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.places where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.calendars where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.contacts where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.accounts where id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.agencies where id = $1", [s.agency]);
}
const ins = (kind: "person" | "customer", s: Seed, n: number) =>
  `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind, author_id)
   values ('${s.acct}', '${s.cal}', '${s.ana}', '${at(0)}', '${at(1)}', 'tok_0107_race_${RUN}_${n}', '${kind}', ${kind === "person" ? "'user_0107'" : "null"})`;

describe("0107: the calendar lock (spec 7), this machine only", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("staff first: a customer insert WAITS on the uncommitted staff job, then is refused 23P01 (mutation: drop `for no key update` -> it does not wait and saves, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let s: Seed | null = null;
    try {
      s = await raceSeed(admin, "r1");
      const { rows: [p] } = await c2.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c1.query("begin");
      await c1.query(ins("person", s, 1));
      const second = c2.query(ins("customer", s, 2)).then(() => "saved", (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p!.pid)).toBe(true);
      await c1.query("commit");
      expect(await second).toBe("23P01");
    } finally {
      await c1.query("rollback").catch(() => {});
      await raceTeardown(admin, s);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });

  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("customer first: the staff insert waits, then saves beside it (R1; mutation: the constraint without its author_kind term -> the constraint waits, then refuses 23P01, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let s: Seed | null = null;
    try {
      s = await raceSeed(admin, "r2");
      const { rows: [p] } = await c2.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c1.query("begin");
      await c1.query(ins("customer", s, 3));
      const second = c2.query(ins("person", s, 4)).then(() => "saved", (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p!.pid)).toBe(true);
      await c1.query("commit");
      expect(await second).toBe("saved");
    } finally {
      await c1.query("rollback").catch(() => {});
      await raceTeardown(admin, s);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });
});

/* ---------- the undo functions take the calendar lock FIRST (plan review item 1), this machine only ----------
 * Both undos delete one booking and then restore another. The restore fires bookings_slot_guard, which locks the
 * calendar row; taken only there, a customer insert that took the lock first and then waits on the uncommitted
 * delete (its exclusion check) deadlocks with the undo. Reproduced before the fix on the planner's replica:
 * `deadlock detected … while locking tuple (0,1) in relation "calendars"` from undo_ai_booking_act. */
async function moveSeed(admin: Client, tag: string) {
  await admin.query("begin");
  const s = await seed(admin, tag);
  const q1 = async (sql: string, args: unknown[]) => (await admin.query<{ id: string }>(sql, args)).rows[0]!.id;
  const phone = await q1("insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [s.acct, `+1956${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`]);
  const call = await q1("insert into public.calls (account_id, phone_number_id, contact_id) values ($1, $2, $3) returning id", [s.acct, phone, s.ana]);
  const ins = (cols: string, vals: unknown[]) =>
    q1(`insert into public.bookings (account_id, calendar_id, contact_id, ${cols}) values ($1, $2, $3, ${vals.map((_, i) => `$${i + 4}`).join(", ")}) returning id`,
      [s.acct, s.cal, s.ana, ...vals]);
  // A staff move as moveBooking leaves it, and Sofia's reschedule as 0091's act names it.
  const staffOld = await ins("starts_at, ends_at, cancel_token, author_kind, status, updated_at", [at(0), at(1), `so_${tag}_${RUN}`, "customer", "cancelled", "2031-01-01T00:00:00.123456Z"]);
  const staffNew = await ins("starts_at, ends_at, cancel_token, author_kind, author_id, rescheduled_from_id, hold_until", [at(24), at(25), `sn_${tag}_${RUN}`, "person", "user_0107", staffOld, at(-1)]);
  const aiOld = await ins("starts_at, ends_at, cancel_token, author_kind, status, updated_at", [at(48), at(49), `ao_${tag}_${RUN}`, "ai", "cancelled", "2031-01-01T00:00:00.123Z"]);
  const aiNew = await ins("starts_at, ends_at, cancel_token, author_kind, rescheduled_from_id", [at(72), at(73), `an_${tag}_${RUN}`, "ai", aiOld]);
  const act = await q1(`insert into public.ai_acts (account_id, actor, call_id, contact_id, kind, target, before, after)
                        values ($1, 'voice', $2, $3, 'booking_rescheduled', $4, $5, '{}') returning id`,
    [s.acct, call, s.ana, JSON.stringify({ bookingId: aiNew, fromBookingId: aiOld }), JSON.stringify({ version: "2031-01-01T00:00:00.123Z" })]);
  await admin.query("commit");
  return { s, staffOld, staffNew, aiOld, aiNew, act };
}
async function moveTeardown(admin: Client, s: Seed | null) {
  if (!s) return;
  await admin.query("delete from public.ai_acts where account_id = $1", [s.acct]);
  await admin.query("delete from public.calls where account_id = $1", [s.acct]);
  await admin.query("delete from public.phone_numbers where account_id = $1", [s.acct]);
  await raceTeardown(admin, s);
}

describe("0107: both undos lock the calendar before they delete (plan review item 1), this machine only", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("undo_ai_booking_act: a customer insert overlapping the booking being taken back neither deadlocks nor is lost (mutation: drop 0107's added `perform … for no key update` -> 40P01 deadlock detected, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect(); const c3 = await connect();
    let m: Awaited<ReturnType<typeof moveSeed>> | null = null;
    try {
      m = await moveSeed(admin, "d1");
      const { rows: [p1] } = await c1.query<{ pid: number }>("select pg_backend_pid() as pid");
      // c3 holds the OLD row, so the undo stops between its delete and its restore.
      await c3.query("begin");
      await c3.query("select id from public.bookings where id = $1 for update", [m.aiOld]);
      await c1.query("set role service_role");
      const undo = c1.query<{ r: string }>("select public.undo_ai_booking_act($1, $2, 'race', now()) as r", [m.s.acct, m.act])
        .then((r) => r.rows[0]!.r, (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p1!.pid)).toBe(true);
      // A customer books over the NEW booking's time while the undo is parked.
      const insert = c2.query(
        `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind)
         values ($1, $2, $3, $4, $5, $6, 'customer')`, [m.s.acct, m.s.cal, m.s.ana, at(72.5), at(73.5), `cx_d1_${RUN}`])
        .then(() => "saved", (e: DatabaseError) => e.code);
      await new Promise((r) => setTimeout(r, 500));
      await c3.query("commit");
      expect(await undo).toBe("undone");
      expect(await insert).toBe("saved");
    } finally {
      await c3.query("rollback").catch(() => {});
      await moveTeardown(admin, m?.s ?? null);
      await Promise.all([admin.end(), c1.end(), c2.end(), c3.end()]);
    }
  });

  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("undo_staff_move: while another write holds the calendar row, the undo waits BEFORE deleting, so the new row is not yet locked (mutation: drop its first `perform … for no key update` -> the row is locked, 55P03, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let m: Awaited<ReturnType<typeof moveSeed>> | null = null;
    try {
      m = await moveSeed(admin, "d2");
      const { rows: [p1] } = await c1.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c2.query("begin");
      await c2.query(`insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind)
                      values ($1, $2, $3, $4, $5, $6, 'customer')`, [m.s.acct, m.s.cal, m.s.ana, at(200), at(201), `cx_d2_${RUN}`]);
      await c1.query("set role service_role");
      const undo = c1.query<{ r: string }>("select public.undo_staff_move($1, $2, $3, $4, now()) as r",
        [m.s.acct, m.staffNew, m.staffOld, "2031-01-01T00:00:00.123456Z"]).then((r) => r.rows[0]!.r, (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p1!.pid)).toBe(true);
      await admin.query("begin");
      const probe = await admin.query("select id from public.bookings where id = $1 for update nowait", [m.staffNew])
        .then(() => "not locked", (e: DatabaseError) => e.code);
      await admin.query("rollback");
      expect(probe).toBe("not locked");
      await c2.query("commit");
      expect(await undo).toBe("undone");
    } finally {
      await c2.query("rollback").catch(() => {});
      await moveTeardown(admin, m?.s ?? null);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });
});
