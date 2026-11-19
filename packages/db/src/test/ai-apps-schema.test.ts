// packages/db/src/test/ai-apps-schema.test.ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { withRollback, actAsMember } from "./db";

/**
 * 20261119152434_ai_apps.sql (focus row 13, PR A; docs/superpowers/plans/2026-11-19-mcp-server.md sections 2 D1, D2,
 * D4, 3.4 and 3.5). Every case runs in withRollback: the table owner seeds, `set local role service_role` stands for
 * the server (note_ai_app_read's only grantee, so each case proves service_role runs it on its OWN grants),
 * actAsMember for a signed-in person. ONE refused statement per case: after the first error the transaction is
 * aborted (25P02), so a second assertion would pass or fail for the wrong reason.
 * RED BEFORE APPLY: every case (42703 on the accounts columns, 42883 on note_ai_app_read, and the constraint and
 * guard cases because the old CHECKs or no trigger answer instead). GREEN AFTER APPLY: all of them.
 * Each case names its probe: the mutation that turns it red.
 */
const RUN = randomBytes(4).toString("hex");
const FN = "public.note_ai_app_read(uuid,text,text,text,uuid)";
const TRIGGER_FNS = ["app.ai_apps_insert_guard()", "app.ai_apps_switch_record_guard()"];
const KINDS = ["ai_app_calls_and_messages", "ai_app_appointments", "ai_app_needs_attention",
  "ai_app_lookup_customer", "ai_app_my_businesses"] as const;
const NOT_ALLOWED = { code: "P0001", message: "note_ai_app_read: not_allowed" };
const RATE_LIMITED = { code: "P0001", message: "note_ai_app_read: rate_limited" };

type Person = { id: string; clerk: string };
type Seed = { a: string; b: string; aOrg: string; owner: Person; staff: Person; tech: Person; bOwner: Person; agencyPerson: Person };

async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('AI apps schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [ag!.id, `org_ai_${tag}_${RUN}`, `AI ${tag}`])).rows[0]!.id;
  const a = await acct("a");
  const b = await acct("b");
  const user = async (tag: string, name: string | null = null): Promise<Person> => {
    const clerk = `user_ai_${tag}_${RUN}`;
    const { rows: [u] } = await c.query<{ id: string }>(
      "insert into users (clerk_user_id, email, name) values ($1, $1 || '@example.com', $2) returning id", [clerk, name]);
    return { id: u!.id, clerk };
  };
  const member = async (tag: string, account: string, role: string, name: string | null = null) => {
    const p = await user(tag, name);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [p.id, account, role]);
    return p;
  };
  const agencyPerson = await user("agency", "BIS Dan");
  await c.query("insert into memberships (user_id, scope, agency_id, role) values ($1, 'agency', $2, 'owner')", [agencyPerson.id, ag!.id]);
  return {
    a, b, aOrg: `org_ai_a_${RUN}`,
    owner: await member("owner", a, "owner", "Dan Lopez"),
    staff: await member("staff", a, "staff"),
    tech: await member("tech", a, "technician"),
    bOwner: await member("bowner", b, "owner"),
    agencyPerson,
  };
}

/**
 * The switch the way setAiAppsSwitch writes it: the switch, a NEW change time and the Owner, in one statement.
 * clock_timestamp(), not now(): now() is fixed for the whole transaction, so a second change inside one withRollback
 * would carry the same time and read as a stale record.
 */
async function switchTo(c: Client, account: string, on: boolean, by: string) {
  await c.query(
    `update accounts set ai_apps_enabled_at = case when $2 then clock_timestamp() end,
            ai_apps_changed_at = clock_timestamp(), ai_apps_changed_by = $3 where id = $1`, [account, on, by]);
}

/** A ready business: switch on by its Owner. */
async function ready(c: Client): Promise<Seed> {
  const s = await seed(c);
  await switchTo(c, s.a, true, s.owner.id);
  return s;
}

const asService = (c: Client) => c.query("set local role service_role");
const note = (c: Client, account: string, actor: string, kind: string = KINDS[0], req: string = randomUUID(), name: string | null = "Dan Lopez") =>
  c.query<{ v: string }>("select public.note_ai_app_read($1, $2, $3, $4, $5) as v", [account, actor, name, kind, req]);

/** n ai_app visits for `actor` at `account`, started `ago` before now, as the table owner (seeding, not the code under test). */
async function pastReads(c: Client, account: string, actor: string, n: number, ago: string, kind: "ai_app" | "owner_line" = "ai_app") {
  await c.query(
    `insert into agency_visits (account_id, actor_kind, actor_clerk_user_id, clerk_session_id, reason, started_at)
     select $1, $3::text, $2, $3::text || ':' || gen_random_uuid(), case when $3 = 'ai_app' then 'ai_app_read' else 'owner_line_call' end,
            now() - $4::interval
       from generate_series(1, $5::int)`, [account, actor, kind, ago, n]);
}
const visitCount = async (c: Client, actor: string) =>
  (await c.query<{ n: number }>("select count(*)::int as n from agency_visits where actor_clerk_user_id = $1 and actor_kind = 'ai_app'", [actor])).rows[0]!.n;

describe("ai_apps: grants and function privileges", () => {
  it("EXECUTE on note_ai_app_read is service_role's alone (probe: grant execute on note_ai_app_read to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, has_function_privilege(r, '${FN}'::regprocedure, 'EXECUTE') as x
           from unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by r`);
      expect(rows).toEqual([
        { r: "anon", x: false }, { r: "authenticated", x: false }, { r: "public", x: false }, { r: "service_role", x: true },
      ]);
    }));

  it("a signed-in Owner calling note_ai_app_read is refused 42501 (probe: grant execute to authenticated -> runs, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      const sub = await actAsMember(c, s.a, s.aOrg, "owner");
      await expect(note(c, s.a, sub)).rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for function note_ai_app_read/) });
    }));

  it("note_ai_app_read and both trigger functions run as their CALLER with search_path pg_catalog, pg_temp, and no role may execute a trigger function (probe: security definer on note_ai_app_read -> FAILS)", () =>
    withRollback(async (c) => {
      const all = [FN, ...TRIGGER_FNS].sort();
      const { rows } = await c.query(
        `select f, p.prosecdef, p.proconfig from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by f`, [all]);
      expect(rows).toEqual(all.map((f) => ({ f, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] })));
      const { rows: x } = await c.query(
        `select f, r from unnest($1::text[]) f cross join unnest(array['anon', 'authenticated', 'public', 'service_role']) r
          where has_function_privilege(r, f::regprocedure, 'EXECUTE')`, [TRIGGER_FNS]);
      expect(x).toEqual([]);
    }));

  it("the three accounts columns exist, nullable, and no client role may UPDATE any of them (probe: grant update (ai_apps_enabled_at) on accounts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts' and column_name like 'ai_apps%' order by column_name`);
      expect(rows).toEqual([
        { column_name: "ai_apps_changed_at", data_type: "timestamp with time zone", is_nullable: "YES" },
        { column_name: "ai_apps_changed_by", data_type: "uuid", is_nullable: "YES" },
        { column_name: "ai_apps_enabled_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      ]);
      const { rows: w } = await c.query(
        `select r, col from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['ai_apps_enabled_at', 'ai_apps_changed_at', 'ai_apps_changed_by']) col
          where has_column_privilege(r, 'public.accounts', col, 'UPDATE')`);
      expect(w).toEqual([]);
    }));

  it("a signed-in Owner turning AI apps on through the client is refused 42501 (probe: grant update (ai_apps_enabled_at, ai_apps_changed_at, ai_apps_changed_by) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.a, s.aOrg, "owner");
      await expect(c.query(
        "update accounts set ai_apps_enabled_at = now(), ai_apps_changed_at = now(), ai_apps_changed_by = $2 where id = $1",
        [s.a, s.owner.id])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("ai_apps: the switch starts off and moves only with its record (D2)", () => {
  const INSERT_GUARD = { code: "23514", message: expect.stringMatching(/AI apps start off/) };
  const RECORD = { code: "23514", message: expect.stringMatching(/must record when and who/) };
  const OWNER_ONLY = { code: "23514", message: expect.stringMatching(/only the business's Owner turns AI apps on or off/) };
  const newAccount = async (c: Client, tag: string, cols: string, vals: string, params: unknown[] = []) => {
    const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('AI guard') returning id");
    return c.query(`insert into accounts (agency_id, clerk_org_id, name${cols}) values ($1, $2, 'AI guard'${vals})`,
      [ag!.id, `org_ai_${tag}_${RUN}`, ...params]);
  };

  // One column per case: a guard that forgets a column is caught only by a row that sets that column alone.
  it("no account is created with the switch on, by any role (probe: drop trigger accounts_ai_apps_insert_guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "g1", ", ai_apps_enabled_at", ", now()")).rejects.toMatchObject(INSERT_GUARD);
    }));

  it("no account is created with only a change time (probe: drop ai_apps_changed_at from the insert guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "g2", ", ai_apps_changed_at", ", now()")).rejects.toMatchObject(INSERT_GUARD);
    }));

  it("no account is created with only a who (probe: drop ai_apps_changed_by from the insert guard -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [u] } = await c.query<{ id: string }>(
        "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [`user_ai_g3_${RUN}`]);
      await expect(newAccount(c, "g3", ", ai_apps_changed_by", ", $3", [u!.id])).rejects.toMatchObject(INSERT_GUARD);
    }));

  it("an account created with it off is fine, and all three columns start empty", () =>
    withRollback(async (c) => {
      await newAccount(c, "g4", "", "");
      const { rows } = await c.query(
        "select ai_apps_enabled_at, ai_apps_changed_at, ai_apps_changed_by from accounts where clerk_org_id = $1", [`org_ai_g4_${RUN}`]);
      expect(rows).toEqual([{ ai_apps_enabled_at: null, ai_apps_changed_at: null, ai_apps_changed_by: null }]);
    }));

  it("turning it on with no record is refused (probe: drop trigger accounts_ai_apps_switch_record -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set ai_apps_enabled_at = now() where id = $1", [s.a])).rejects.toMatchObject(RECORD);
    }));

  it("turning it on with a time but no who is refused (probe: drop the ai_apps_changed_by is null test from the guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set ai_apps_enabled_at = now(), ai_apps_changed_at = now() where id = $1", [s.a]))
        .rejects.toMatchObject(RECORD);
    }));

  it("turning it on over a stale record is refused (probe: drop the 'is not distinct from old' test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, false, s.owner.id);
      await expect(c.query("update accounts set ai_apps_enabled_at = now() where id = $1", [s.a])).rejects.toMatchObject(RECORD);
    }));

  it("a Staff member's id is not an Owner's: refused (D2; probe: drop the role = 'owner' test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(switchTo(c, s.a, true, s.staff.id)).rejects.toMatchObject(OWNER_ONLY);
    }));

  it("another business's Owner is not this business's Owner: refused (probe: drop m.account_id = new.id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(switchTo(c, s.a, true, s.bOwner.id)).rejects.toMatchObject(OWNER_ONLY);
    }));

  it("a BIS person (agency membership only) is refused: the agency never switches it (D2; probe: drop m.scope = 'account' AND m.account_id = new.id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(switchTo(c, s.a, true, s.agencyPerson.id)).rejects.toMatchObject(OWNER_ONLY);
    }));

  it("the Owner turns it on and off; a write that does not move the switch needs no record", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true, s.owner.id);
      await c.query("update accounts set name = 'AI renamed', ai_apps_enabled_at = ai_apps_enabled_at where id = $1", [s.a]);
      await switchTo(c, s.a, false, s.owner.id);
      const { rows } = await c.query("select name, ai_apps_enabled_at, ai_apps_changed_by from accounts where id = $1", [s.a]);
      expect(rows).toEqual([{ name: "AI renamed", ai_apps_enabled_at: null, ai_apps_changed_by: s.owner.id }]);
    }));

  it("an ON switch keeps its time: clearing ai_apps_changed_at while on is refused (probe: drop accounts_ai_apps_on_has_record_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await expect(c.query("update accounts set ai_apps_changed_at = null where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_ai_apps_on_has_record_check" });
    }));

  it("deleting the Owner who switched it keeps the switch on and forgets who (probe: the FK without on delete set null -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await c.query("delete from users where id = $1", [s.owner.id]);
      const { rows } = await c.query("select ai_apps_enabled_at is not null as on, ai_apps_changed_by from accounts where id = $1", [s.a]);
      expect(rows).toEqual([{ on: true, ai_apps_changed_by: null }]);
    }));
});

describe("note_ai_app_read: who may read (D1, D2)", () => {
  it("an Owner's read writes one ai_app visit keyed on the request and one item whose record_id is the request id", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      const req = randomUUID();
      await asService(c);
      const visit = (await note(c, s.a, s.owner.clerk, "ai_app_appointments", req, "  Dan Lopez ")).rows[0]!.v;
      await c.query("reset role");
      const { rows: v } = await c.query(
        "select id, account_id, actor_kind, actor_clerk_user_id, actor_name, clerk_session_id, reason from agency_visits where account_id = $1", [s.a]);
      expect(v).toEqual([{ id: visit, account_id: s.a, actor_kind: "ai_app", actor_clerk_user_id: s.owner.clerk,
        actor_name: "Dan Lopez", clerk_session_id: `ai_app:${req}`, reason: "ai_app_read" }]);
      const { rows: i } = await c.query("select visit_id, kind, record_id, item_count from agency_visit_items where account_id = $1", [s.a]);
      expect(i).toEqual([{ visit_id: visit, kind: "ai_app_appointments", record_id: req, item_count: null }]);
    }));

  it("a Staff member may read", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await note(c, s.a, s.staff.clerk);
      expect(await visitCount(c, s.staff.clerk)).toBe(1);
    }));

  it("every one of the five kinds is accepted (probe: drop 'ai_app_my_businesses' from agency_visit_items_kind_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      for (const k of KINDS) await note(c, s.a, s.owner.clerk, k);
      const { rows } = await c.query("select kind from agency_visit_items where account_id = $1 order by kind", [s.a]);
      expect(rows.map((r) => r.kind)).toEqual([...KINDS].sort());
    }));

  it("a Technician is refused (probe: role in ('owner', 'staff', 'technician') -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, s.a, s.tech.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("another business's Owner is refused (probe: drop m.account_id = p_account_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, s.a, s.bOwner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("an agency-scope member with no membership on the business is refused (probe: match any membership of the person, dropping the account filter -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, s.a, s.agencyPerson.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("a Clerk id with no users row is refused, never a NULL role that lets the read through (the plpgsql NULL guard; probe: drop the coalesce on the role test -> the visit is written, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, s.a, `user_ai_nobody_${RUN}`)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("the switch off is refused (probe: drop the ai_apps_enabled_at is not null test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("the switch turned off after it was on is refused at once (probe: drop the ai_apps_enabled_at is not null test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await switchTo(c, s.a, false, s.owner.id);
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("client access off is refused (probe: drop the client_access_enabled test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await c.query("update accounts set client_access_enabled = false where id = $1", [s.a]);
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("an archived business is refused (probe: drop the status <> 'archived' test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await c.query("update accounts set status = 'archived' where id = $1", [s.a]);
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("a business that does not exist is refused by name (probe: drop BOTH coalesces -> the insert runs and fails 23503 instead, FAILS; dropping the account coalesce alone cannot fail: an existing membership implies an existing account, so v_open is never NULL where v_role is not)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, randomUUID(), s.owner.clerk)).rejects.toMatchObject(NOT_ALLOWED);
    }));

  it("only ai_app_ kinds: an agency kind is refused 22023 (probe: drop the ai_app_ prefix guard -> a 'contact' item is written, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk, "contact")).rejects.toMatchObject({ code: "22023" });
    }));

  it("a null request id is refused 22004 (probe: drop p_request_id from the null test -> 23502 or 23514 instead, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await expect(c.query("select public.note_ai_app_read($1, $2, null, $3, null)", [s.a, s.owner.clerk, KINDS[0]]))
        .rejects.toMatchObject({ code: "22004" });
    }));
});

describe("note_ai_app_read: the limits (section 3.5)", () => {
  it("the 60th read in ten minutes is allowed; the 61st is refused and writes nothing (probe: v_ten >= 61 -> FAILS; v_ten >= 59 -> the 60th refused, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      for (let i = 0; i < 60; i++) await note(c, s.a, s.owner.clerk);
      await c.query("savepoint before_61st");
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(RATE_LIMITED);
      await c.query("rollback to savepoint before_61st");
      expect(await visitCount(c, s.owner.clerk)).toBe(60);
    }));

  it("the ten minutes count across businesses: 30 at A and 30 at B, then A is refused (probe: count only p_account_id's visits -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'staff')", [s.owner.id, s.b]);
      await switchTo(c, s.b, true, s.bOwner.id);
      await asService(c);
      for (let i = 0; i < 30; i++) await note(c, s.a, s.owner.clerk);
      for (let i = 0; i < 30; i++) await note(c, s.b, s.owner.clerk);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(RATE_LIMITED);
    }));

  it("the window is ten minutes: 60 reads eleven minutes ago do not refuse (probe: interval '1 hour' for the short window -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await pastReads(c, s.a, s.owner.clerk, 60, "11 minutes");
      await asService(c);
      await note(c, s.a, s.owner.clerk);
      expect(await visitCount(c, s.owner.clerk)).toBe(61);
    }));

  it("500 reads in the last 24 hours refuse the next (probe: drop the v_day >= 500 test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await pastReads(c, s.a, s.owner.clerk, 500, "1 hour");
      await asService(c);
      await expect(note(c, s.a, s.owner.clerk)).rejects.toMatchObject(RATE_LIMITED);
    }));

  it("499 in the last 24 hours allow one more (probe: v_day >= 499 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await pastReads(c, s.a, s.owner.clerk, 499, "1 hour");
      await asService(c);
      await note(c, s.a, s.owner.clerk);
      expect(await visitCount(c, s.owner.clerk)).toBe(500);
    }));

  it("reads older than 24 hours do not count (probe: drop the 24-hour bound from the count -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await pastReads(c, s.a, s.owner.clerk, 500, "25 hours");
      await asService(c);
      await note(c, s.a, s.owner.clerk);
      expect(await visitCount(c, s.owner.clerk)).toBe(501);
    }));

  it("the same person's owner-line visits do not count toward the AI-app limit (probe: drop v.actor_kind = 'ai_app' from the count -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await pastReads(c, s.a, s.owner.clerk, 60, "1 minute", "owner_line");
      await asService(c);
      await note(c, s.a, s.owner.clerk);
      expect(await visitCount(c, s.owner.clerk)).toBe(1);
    }));
});

describe("ai_apps: the access log's constraints and the Team page", () => {
  it("an ai_app visit must carry the ai_app_read reason (probe: drop agency_visits_ai_app_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into agency_visits (account_id, actor_kind, actor_clerk_user_id, clerk_session_id, reason) values ($1, 'ai_app', 'user_x', 'ai_app:x', 'support')",
        [s.a])).rejects.toMatchObject({ code: "23514", constraint: "agency_visits_ai_app_check" });
    }));

  it("an agency visit cannot carry the ai_app_read reason (probe: drop agency_visits_ai_app_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into agency_visits (account_id, actor_clerk_user_id, clerk_session_id, reason) values ($1, 'user_x', 'sess_x', 'ai_app_read')",
        [s.a])).rejects.toMatchObject({ code: "23514", constraint: "agency_visits_ai_app_check" });
    }));

  it("the BIS access page does not show AI-app reads, to the Owner (probe: re-create access_log_page without actor_kind = 'agency' -> total 1, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await note(c, s.a, s.owner.clerk);
      await c.query("reset role");
      await actAsMember(c, s.a, s.aOrg, "owner");
      const { rows: [p] } = await c.query("select public.access_log_page($1, null, null, 20) as p", [s.a]);
      expect(p.p).toEqual({ total: 0, visits: [] });
    }));

  it("an agency note with an ai_app_ kind is refused 22023, while a contact note on the same live visit is ok (probe: drop the ai_app_ guard from note_agency_open -> 'ok', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await c.query("select public.start_agency_visit($1, 'user_bis_ai', 'Dan', 'sess_ai', 'support')", [s.a]);
      const open = (kind: string) => c.query(
        "select public.note_agency_open($1, 'user_bis_ai', 'sess_ai', $2, gen_random_uuid(), null) as r", [s.a, kind]);
      expect((await open("contact")).rows[0].r).toBe("ok");
      await expect(open("ai_app_lookup_customer")).rejects.toMatchObject({ code: "22023" });
    }));

  it("agency_visit_live never finds an AI-app visit, even by its own session string (0115 header; probe: drop v.actor_kind = 'agency' -> the visit id, FAILS)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      const req = randomUUID();
      await asService(c);
      await note(c, s.a, s.owner.clerk, KINDS[0], req);
      const { rows } = await c.query("select public.agency_visit_live($1, $2, $3) as v", [s.a, s.owner.clerk, `ai_app:${req}`]);
      expect(rows).toEqual([{ v: null }]);
    }));

  it("the Owner reads the business's AI-app visits under the access log's RLS; Staff read none (D4)", () =>
    withRollback(async (c) => {
      const s = await ready(c);
      await asService(c);
      await note(c, s.a, s.staff.clerk);
      await c.query("reset role");
      await actAsMember(c, s.a, s.aOrg, "owner");
      const owner = (await c.query("select actor_name, actor_kind from agency_visits where account_id = $1", [s.a])).rows;
      await c.query("reset role");
      await actAsMember(c, s.a, s.aOrg, "staff");
      const staff = (await c.query("select actor_name from agency_visits where account_id = $1", [s.a])).rows;
      expect([owner, staff]).toEqual([[{ actor_name: "Dan Lopez", actor_kind: "ai_app" }], []]);
    }));
});
