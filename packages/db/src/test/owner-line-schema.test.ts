// packages/db/src/test/owner-line-schema.test.ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes, randomInt } from "node:crypto";
import { withRollback, actAsMember } from "./db";

/**
 * 0115 (F-032 owner line). Spec docs/superpowers/specs/2026-11-09-owner-line-design.md sections 3.4, 4 and 6;
 * plan docs/superpowers/plans/2026-11-09-owner-line.md Task 1 (SC-3, SC-4, SC-5, SC-13; owner rulings Q-A, Q-F).
 * Every case runs in withRollback: the table owner seeds, `set local role service_role` stands for the server (the
 * functions' only grantee, so each case proves service_role runs them on its OWN grants), actAsMember for a signed-in
 * person. RED BEFORE APPLY: every case (42P01 on the table, 42883 on the functions, 42703 on the new columns).
 * GREEN AFTER APPLY: all of them. Run on the PG18 replica pre/post (memory bis-local-db-replica); CI verify is the
 * authoritative green.
 */
const TABLE = "public.owner_line_enrollments";
const FUNCTIONS = [
  "app.owner_line_day_start(text,timestamp with time zone)",
  "public.note_owner_line_call(uuid,uuid,text,text,text[])",
  "public.owner_line_answer_lookup(uuid,text,integer)",
  "public.owner_line_attempt_pin(uuid,text,integer)",
  "public.owner_line_attempt_verify(uuid,text,text)",
  "public.owner_line_session_check(uuid,uuid,text,integer)",
  "public.owner_line_start_verification(uuid,uuid,text,text,integer)",
].sort();
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = randomBytes(4).toString("hex");
const hex64 = () => randomBytes(32).toString("hex");
/** A pin_hash of the shape 0115's CHECK accepts: "scrypt:17:8:1:" + 22 + ":" + 43 = 80 characters. */
const pinHash = (salt = "A".repeat(22), key = "B".repeat(43)) => `scrypt:17:8:1:${salt}:${key}`;
/** phone_numbers.e164 is unique across every account (0019), so each case dials its own business number. */
const businessNumber = () => `+1956${randomInt(1_000_000, 9_999_999)}`;

type Seed = { a: string; b: string; aOrg: string; owner: string; staff: string; tech: string; bOwner: string };

async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [ag!.id, `org_ol_${tag}_${RUN}`, `OL ${tag}`])).rows[0]!.id;
  const a = await acct("a");
  const b = await acct("b");
  const person = async (tag: string, account: string, role: string, name: string | null = null) => {
    const { rows: [u] } = await c.query<{ id: string }>(
      "insert into users (clerk_user_id, email, name) values ($1, $1 || '@example.com', $2) returning id",
      [`user_ol_${tag}_${RUN}`, name]);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, account, role]);
    return u!.id;
  };
  return {
    a, b, aOrg: `org_ol_a_${RUN}`,
    owner: await person("owner", a, "owner", "Dan Lopez"),
    staff: await person("staff", a, "staff"),
    tech: await person("tech", a, "technician"),
    bOwner: await person("b", b, "owner"),
  };
}

/** A verified enrollment with a PIN, switch on. Inserted as the table owner (seeding, not the code under test). */
async function enrolled(c: Client, account: string, user: string, e164: string) {
  await c.query("update accounts set owner_line_enabled_at = now() where id = $1", [account]);
  const { rows: [e] } = await c.query<{ id: string }>(
    `insert into owner_line_enrollments (account_id, user_id, e164, verified_at, pin_hash, pin_set_at)
     values ($1, $2, $3, now(), $4, now()) returning id`, [account, user, e164, pinHash()]);
  return e!.id;
}

async function liveNumber(c: Client, account: string): Promise<string> {
  const { rows: [pn] } = await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164, status) values ($1, $2, 'live') returning id", [account, businessNumber()]);
  return pn!.id;
}

const asService = (c: Client) => c.query("set local role service_role");

describe("0115 owner_line_enrollments: grants, RLS, function privileges", () => {
  it("the whole table privilege matrix is service_role's DELETE, INSERT, SELECT, UPDATE and nothing else (probe: grant select on public.owner_line_enrollments to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "service_role", p: "DELETE" }, { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" }, { r: "service_role", p: "UPDATE" },
      ]);
    }));

  it("no column privilege for anon, authenticated or PUBLIC, so pin_hash is never readable through PostgREST (probe: grant select (pin_hash) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p)`);
      expect(rows).toEqual([]);
    }));

  it("row level security is on with NO policy (probe: disable row level security -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("a signed-in Owner selecting the table is refused 42501, not shown zero rows (probe: grant select to authenticated -> no error, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await actAsMember(c, s.a, s.aOrg, "owner");
      await expect(c.query("select pin_hash from public.owner_line_enrollments")).rejects.toMatchObject({ code: "42501" });
    }));

  it("EXECUTE on all seven functions is service_role's alone (probe: grant execute on owner_line_attempt_pin to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select f, r, has_function_privilege(r, f::regprocedure, 'EXECUTE') as x
           from unnest($1::text[]) f cross join unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by f, r`,
        [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.flatMap((f) => [
        { f, r: "anon", x: false }, { f, r: "authenticated", x: false },
        { f, r: "public", x: false }, { f, r: "service_role", x: true },
      ]));
    }));

  it("all seven run as their CALLER with search_path pg_catalog, pg_temp: the PIN-check pin (SC-3; probe: security definer on owner_line_attempt_pin, or search_path '' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select f, p.prosecdef, p.proconfig from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by f`, [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.map((f) => ({ f, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] })));
    }));

  it("calls.owner_line_user_id and accounts.owner_line_enabled_at exist, nullable, with no client write (probe: grant update (owner_line_enabled_at) on accounts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name, is_nullable, data_type from information_schema.columns
          where table_schema = 'public' and column_name in ('owner_line_user_id', 'owner_line_enabled_at') order by table_name`);
      expect(rows).toEqual([
        { table_name: "accounts", column_name: "owner_line_enabled_at", is_nullable: "YES", data_type: "timestamp with time zone" },
        { table_name: "calls", column_name: "owner_line_user_id", is_nullable: "YES", data_type: "uuid" },
      ]);
      const { rows: w } = await c.query(
        `select has_column_privilege('authenticated', 'public.accounts', 'owner_line_enabled_at', 'UPDATE') as acct,
                has_column_privilege('authenticated', 'public.calls', 'owner_line_user_id', 'UPDATE') as calls`);
      expect(w).toEqual([{ acct: false, calls: false }]);
    }));
});

describe("0115: one cell is one person per business", () => {
  it("a second person cannot claim the same cell on the same business; another business can (probe: drop owner_line_enrollments_one_cell -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.a, s.owner, hex64()])).rows[0].r).toBe("ok");
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.a, s.staff, hex64()])).rows[0].r).toBe("taken");
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.b, s.bOwner, hex64()])).rows[0].r).toBe("ok");
    }));

  // ONE refused statement per withRollback: after the first error the transaction is aborted and every later
  // statement fails 25P02, which would make a second assertion pass or fail for the wrong reason.
  it("a PIN cannot be stored on an unverified cell (probe: drop owner_line_enrollments_pin_needs_cell_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into owner_line_enrollments (account_id, user_id, e164, pin_hash, pin_set_at) values ($1, $2, '+19565550101', $3, now())",
        [s.a, s.owner, pinHash()])).rejects.toMatchObject({ code: "23514", constraint: "owner_line_enrollments_pin_needs_cell_check" });
    }));

  it("a PIN stored in the clear is refused by the hash's shape (probe: drop owner_line_enrollments_pin_hash_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into owner_line_enrollments (account_id, user_id, e164, verified_at, pin_hash, pin_set_at) values ($1, $2, '+19565550101', now(), '123456', now())",
        [s.a, s.owner])).rejects.toMatchObject({ code: "23514", constraint: "owner_line_enrollments_pin_hash_check" });
    }));

  it("removing the person from the team deletes their enrollment (probe: drop the cascade -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.owner]);
      const { rows } = await c.query("select 1 from owner_line_enrollments where user_id = $1", [s.owner]);
      expect(rows).toEqual([]);
    }));
});

describe("0115: the call-in code", () => {
  it("the right code verifies; a wrong one counts; the third wrong spends it (probe: verify_attempts + 1 >= 4 -> the third answer is 'wrong', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const right = hex64();
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      const attempt = async (h: string) => (await c.query("select public.owner_line_attempt_verify($1, '+19565550101', $2) as r", [s.a, h])).rows[0].r;
      expect(await attempt(hex64())).toBe("wrong");
      expect(await attempt(hex64())).toBe("wrong");
      expect(await attempt(hex64())).toBe("spent");
      expect(await attempt(right)).toBe("none");
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      expect(await attempt(right)).toBe("verified");
    }));

  it("an expired code is spent, never verified (probe: drop the verify_expires_at > now() test -> 'verified', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const right = hex64();
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.owner]);
      await asService(c);
      expect((await c.query("select public.owner_line_attempt_verify($1, '+19565550101', $2) as r", [s.a, right])).rows[0].r).toBe("spent");
    }));

  it("the answer route is told 'verify' while a code is pending, with the switch still off (Q-D), and 'none' once it has expired unused (probe: drop the e.verify_expires_at > now() test from the lookup -> the expired case answers 'verify', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const look = async () => (await c.query(
        "select public.owner_line_answer_lookup($1, '+19565550101', 10) as r", [s.a])).rows[0].r;
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, hex64()]);
      expect(await look()).toMatchObject({ status: "verify", user_id: s.owner, role: "owner", name: "Dan Lopez" });
      await c.query("reset role");
      // Nobody called within the ten minutes: the code is still stored (only an attempt clears it), but it is dead.
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.owner]);
      await asService(c);
      expect(await look()).toEqual({ status: "none" });
    }));

  it("changing the cell clears the verification and the PIN (probe: keep pin_hash on a new e164 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550199', $3, 10)", [s.a, s.owner, hex64()]);
      const { rows } = await c.query("select e164, verified_at, pin_hash from owner_line_enrollments where user_id = $1", [s.owner]);
      expect(rows).toEqual([{ e164: "+19565550199", verified_at: null, pin_hash: null }]);
    }));
});

describe("0115: the PIN and the lock", () => {
  it("a correct PIN is ok and resets the counter (probe: compare pin_hash <> p_candidate -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      expect((await c.query("select public.owner_line_attempt_pin($1, 'nope', 30) as r", [id])).rows[0].r).toMatchObject({ status: "wrong", failed_attempts: 1 });
      expect((await c.query("select public.owner_line_attempt_pin($1, $2, 30) as r", [id, pinHash()])).rows[0].r).toEqual({ status: "ok" });
      await c.query("reset role");
      expect((await c.query("select failed_attempts from owner_line_enrollments where id = $1", [id])).rows[0].failed_attempts).toBe(0);
    }));

  it("the third wrong PIN locks for 30 minutes; the lock refuses even the right PIN; the counter is per enrollment, so a new call does not reset it (probe: >= 4 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      const pin = async (cand: string) => (await c.query("select public.owner_line_attempt_pin($1, $2, 30) as r", [id, cand])).rows[0].r;
      expect((await pin("x")).status).toBe("wrong");
      expect((await pin("y")).status).toBe("wrong");   // "a redial": nothing about the call is an argument
      const third = await pin("z");
      expect(third.status).toBe("locked_now");
      const minutes = (new Date(third.locked_until).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30.1);
      expect((await pin(pinHash())).status).toBe("locked");
    }));

  it("the answer lookup: pin for a verified, unlocked, switched-on person; off; locked; over_limit at the 10th prior owner-line call; none for a stranger (probe: count >= p_max + 1 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      const look = async (caller: string) => (await c.query(
        "select public.owner_line_answer_lookup($1, $2, 10) as r", [s.a, caller])).rows[0].r;
      await asService(c);
      expect(await look("+19565550199")).toEqual({ status: "none" });
      const hit = await look("+19565550101");
      expect(hit).toMatchObject({ status: "pin", enrollment_id: id, user_id: s.owner, role: "owner", name: "Dan Lopez", pin_params: pinHash().slice(0, 36) });
      await c.query("reset role");
      const pn = await liveNumber(c, s.a);
      for (let i = 0; i < 10; i++) {
        await c.query("insert into calls (account_id, phone_number_id, caller_e164, owner_line_user_id) values ($1, $2, '+19565550101', $3)", [s.a, pn, s.owner]);
      }
      await asService(c);
      expect((await look("+19565550101")).status).toBe("over_limit");
      await c.query("reset role");
      await c.query("update owner_line_enrollments set locked_until = now() + interval '5 minutes' where id = $1", [id]);
      await asService(c);
      expect(await look("+19565550101")).toEqual({ status: "locked" });
      await c.query("reset role");
      await c.query("update accounts set owner_line_enabled_at = null where id = $1", [s.a]);
      await asService(c);
      expect(await look("+19565550101")).toEqual({ status: "off" });
    }));

  it("the session check refuses a removed person and a changed role, and answers the person's facts when all holds (probe: drop the role comparison -> the downgrade case FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, "+19565550102");
      const check = async (role: string) => (await c.query(
        "select public.owner_line_session_check($1, $2, $3, null) as r", [s.a, s.staff, role])).rows[0].r;
      await asService(c);
      expect(await check("staff")).toMatchObject({ ok: true, clerk_org_id: s.aOrg });
      expect(await check("owner")).toEqual({ ok: false, reason: "role_changed" });
      await c.query("reset role");
      await c.query("update memberships set role = 'technician' where account_id = $1 and user_id = $2", [s.a, s.staff]);
      await asService(c);
      expect(await check("staff")).toEqual({ ok: false, reason: "role_changed" });
      await c.query("reset role");
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.staff]);
      await asService(c);
      expect(await check("technician")).toEqual({ ok: false, reason: "not_a_member" });
    }));
});

describe("0115: the account's local day (owner ruling Q-F)", () => {
  // app.owner_line_day_start(zone, instant): the first instant whose local date is the instant's local date.
  const dayStart = async (c: Client, zone: string, at: string) =>
    (await c.query<{ d: Date }>("select app.owner_line_day_start($1, $2::timestamptz) as d", [zone, at])).rows[0]!.d.toISOString();

  it("an ordinary day, a spring-forward day (23 h) and a fall-back day (25 h) in America/Chicago (probe: return date_trunc('day', p_at) -> FAILS)", () =>
    withRollback(async (c) => {
      expect(await dayStart(c, "America/Chicago", "2026-11-09T15:00:00Z")).toBe("2026-11-09T06:00:00.000Z");
      expect(await dayStart(c, "America/Chicago", "2026-03-08T20:00:00Z")).toBe("2026-03-08T06:00:00.000Z");  // CST until 2 AM
      expect(await dayStart(c, "America/Chicago", "2026-03-09T04:59:00Z")).toBe("2026-03-08T06:00:00.000Z");  // 23:59 CDT
      expect(await dayStart(c, "America/Chicago", "2026-11-01T20:00:00Z")).toBe("2026-11-01T05:00:00.000Z");  // CDT until 2 AM
      expect(await dayStart(c, "America/Chicago", "2026-11-02T05:59:00Z")).toBe("2026-11-01T05:00:00.000Z");  // 23:59 CST
    }));

  it("a zone whose clocks jump AT midnight (America/Santiago, 2026-09-06 00:00 -> 01:00): the day starts at the first instant that exists (probe: drop the existence correction -> FAILS)", () =>
    withRollback(async (c) => {
      // Confirmed with node's ICU (77.1, tz 2025b): 2026-09-06T03:59Z is Sept 5 23:59 and 04:00Z is Sept 6 01:00 in Santiago.
      expect(await dayStart(c, "America/Santiago", "2026-09-06T15:00:00Z")).toBe("2026-09-06T04:00:00.000Z");
    }));

  // PostgreSQL resolves an AMBIGUOUS local time to the LATER instant: ('2026-11-01'::timestamp at time zone
  // 'America/Havana') is 05:00Z, the second midnight. The day began an hour earlier, at the first one (04:00Z, read
  // with node's ICU: 03:59Z is Oct 31 23:59 GMT-4, 04:00Z is Nov 1 00:00 GMT-4, 05:00Z is Nov 1 00:00 GMT-5). Only the
  // step-back loop finds it; the Santiago case above cannot fail without the loops, because PostgreSQL already reads
  // a midnight that does not exist as the instant the clocks jump.
  it("a zone whose clocks fall back to midnight (America/Havana, 2026-11-01 01:00 -> 00:00): the day starts at the FIRST midnight (probe: drop the step-back loop -> 05:00Z, FAILS)", () =>
    withRollback(async (c) => {
      expect(await dayStart(c, "America/Havana", "2026-11-01T15:00:00Z")).toBe("2026-11-01T04:00:00.000Z");
      expect(await dayStart(c, "America/Havana", "2026-11-01T04:30:00Z")).toBe("2026-11-01T04:00:00.000Z");
    }));

  it("the daily limit counts this account-local day only: ten calls YESTERDAY local do not refuse today (probe: count from utc midnight -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await c.query("update accounts set timezone = 'America/Chicago' where id = $1", [s.a]);
      const pn = await liveNumber(c, s.a);
      // One minute before this account's local midnight: yesterday, local, whatever the UTC date says.
      for (let i = 0; i < 10; i++) {
        await c.query(`insert into calls (account_id, phone_number_id, caller_e164, owner_line_user_id, started_at)
                       values ($1, $2, '+19565550101', $3, app.owner_line_day_start('America/Chicago', now()) - interval '1 minute')`,
          [s.a, pn, s.owner]);
      }
      await asService(c);
      expect((await c.query("select public.owner_line_answer_lookup($1, '+19565550101', 10) as r", [s.a])).rows[0].r.status).toBe("pin");
    }));
});

describe("0115: the switch's guard and its record (owner rulings Q-A, spec 3.3)", () => {
  it("no account can be CREATED with the switch on, by any role (probe: drop trigger accounts_owner_line_insert_guard -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL guard') returning id");
      await expect(c.query(
        "insert into accounts (agency_id, clerk_org_id, name, owner_line_enabled_at) values ($1, $2, 'OL guard', now())",
        [ag!.id, `org_ol_guard_${RUN}`])).rejects.toMatchObject({ code: "23514" });
    }));

  it("no account can be created carrying a record of a change that never happened (probe: test only owner_line_enabled_at in the guard -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL guard') returning id");
      await expect(c.query(
        `insert into accounts (agency_id, clerk_org_id, name, owner_line_changed_at, owner_line_changed_by, owner_line_changed_by_agency)
         values ($1, $2, 'OL guard', now(), 'user_forged', false)`,
        [ag!.id, `org_ol_guard3_${RUN}`])).rejects.toMatchObject({ code: "23514" });
    }));

  it("an account created with it off is fine, and the record columns start empty", () =>
    withRollback(async (c) => {
      const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL guard') returning id");
      const { rows: [a] } = await c.query(
        "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, 'OL guard') returning owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by, owner_line_changed_by_agency",
        [ag!.id, `org_ol_guard2_${RUN}`]);
      expect(a).toEqual({ owner_line_enabled_at: null, owner_line_changed_at: null, owner_line_changed_by: null, owner_line_changed_by_agency: null });
    }));

  it("the record travels with the switch: a change names who and whether it was the agency (probe: drop accounts_owner_line_change_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set owner_line_changed_at = now() where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_owner_line_change_check" });
    }));
});

describe("0115: the access log learns owner_line_call", () => {
  it("note_owner_line_call writes one owner_line visit and one item per tool; the BIS access page does not show it (probe: drop actor_kind = 'agency' from access_log_page -> total 1, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const pn = await liveNumber(c, s.a);
      const { rows: [call] } = await c.query<{ id: string }>(
        "insert into calls (account_id, phone_number_id, owner_line_user_id) values ($1, $2, $3) returning id", [s.a, pn, s.owner]);
      await asService(c);
      await c.query("select public.note_owner_line_call($1, $2, 'user_x', 'Dan Lopez', array['owner_line_appointments', 'owner_line_calls_and_messages', 'owner_line_appointments'])",
        [s.a, call!.id]);
      await c.query("reset role");
      const { rows: v } = await c.query("select actor_kind, reason, clerk_session_id from agency_visits where account_id = $1", [s.a]);
      expect(v).toEqual([{ actor_kind: "owner_line", reason: "owner_line_call", clerk_session_id: `call:${call!.id}` }]);
      const { rows: i } = await c.query("select kind from agency_visit_items where account_id = $1 order by kind", [s.a]);
      expect(i).toEqual([{ kind: "owner_line_appointments" }, { kind: "owner_line_calls_and_messages" }]);
      await actAsMember(c, s.a, s.aOrg, "owner");
      const { rows: [p] } = await c.query("select public.access_log_page($1, null, null, 20) as p", [s.a]);
      expect(p.p).toEqual({ total: 0, visits: [] });
    }));

  it("note_owner_line_call refuses an agency kind (probe: drop the owner_line_ prefix guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await expect(c.query("select public.note_owner_line_call($1, gen_random_uuid(), 'user_x', null, array['contact'])", [s.a]))
        .rejects.toMatchObject({ code: "22023" });
    }));
});
