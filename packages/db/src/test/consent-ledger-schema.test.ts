import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";

/**
 * 0054 (consent chain PR-1). Everything here runs in a
 * rolled-back transaction (`withRollback`), so it runs on the local PG18
 * replica as well as on the CI project. The live half (consent.ts through
 * PostgREST) is consent-ledger-live.test.ts, CI only.
 *
 * RED BEFORE APPLY: every test in this file (the table, the column and the
 * 'textback' source do not exist yet).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_CONSENT_${label}_${RUN}`;

type Seeded = { a: string; b: string; contactA: string; contactB: string };

async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, orgId(label), `Consent ${label}`])).rows[0]!.id;
  const a = await mk("A");
  const b = await mk("B");
  const contact = async (account: string) => (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, phone) values ($1, 'Ana', '+19565550100') returning id", [account])).rows[0]!.id;
  return { a, b, contactA: await contact(a), contactB: await contact(b) };
}

const INSERT = `insert into consent_events (account_id, channel, address, action, method, contact_id, actor_id, note, evidence)
  values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce($9::jsonb, '{}'::jsonb)) returning id`;
type Row = { account: string; channel?: string; address?: string; action?: string; method?: string;
  contact?: string | null; actor?: string | null; note?: string | null; evidence?: string | null };
const params = (r: Row) => [r.account, r.channel ?? "sms", r.address ?? "+19565550100", r.action ?? "revoked",
  r.method ?? "keyword", r.contact ?? null, r.actor ?? null, r.note ?? null, r.evidence ?? null];

/** One statement expected to fail, inside a savepoint so the transaction survives. */
async function refused(c: Client, sql: string, p: unknown[]): Promise<unknown> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, p);
    return null;
  } catch (e) {
    return e;
  } finally {
    await c.query("rollback to savepoint probe");
  }
}

// The whole grant set on the table, every role but the owner.
const GRANTS = `select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'consent_events' and grantee <> 'postgres'
  order by grantee, privilege_type`;

describe("0054 consent_events: append-only by grants, RLS on, SELECT for the account's users", () => {
  it("the whole grant set is SELECT for authenticated and SELECT, INSERT for service_role, nothing for anon (mutation: drop `revoke ... from service_role` → service_role keeps UPDATE and DELETE, FAILS; grant update to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      expect((await c.query(GRANTS)).rows).toEqual([
        { grantee: "authenticated", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "SELECT" },
      ]);
    }));

  it("no role holds UPDATE, DELETE, TRUNCATE or MAINTAIN, which information_schema cannot see (mutation: grant maintain to service_role → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon','authenticated','service_role']) r
           cross join unnest(array['UPDATE','DELETE','TRUNCATE','MAINTAIN']) p
          where has_table_privilege(r, 'public.consent_events', p)`);
      expect(rows).toEqual([]);
    }));

  it("service_role's UPDATE and DELETE are refused by the grant, 42501 naming the table (mutation: grant update, delete to service_role → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(INSERT, params({ account: s.a }));
      await c.query("set local role service_role");
      const denied = { code: "42501", message: expect.stringMatching(/permission denied for table consent_events/) };
      expect(await refused(c, "update consent_events set note = 'x'", [])).toMatchObject(denied);
      expect(await refused(c, "delete from consent_events", [])).toMatchObject(denied);
    }));

  it("row level security is on, with one SELECT policy for authenticated (mutation: disable row level security → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [rel] } = await c.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid = 'public.consent_events'::regclass");
      expect(rel!.relrowsecurity).toBe(true);
      const { rows } = await c.query(
        "select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'consent_events'");
      expect(rows).toEqual([{ policyname: "consent_events_read", cmd: "SELECT", roles: "{authenticated}" }]);
    }));

  it("a client reads its own account's rows and not another's; a client token has no app_role claim (mutation: using (true) → the B row is visible, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const own = (await c.query<{ id: string }>(INSERT, params({ account: s.a }))).rows[0]!.id;
      await c.query(INSERT, params({ account: s.b }));
      await actAs(c, { org_id: orgId("A"), sub: "user_consent_a" });
      const { rows } = await c.query<{ id: string }>("select id from consent_events where account_id in ($1, $2)", [s.a, s.b]);
      expect(rows.map((r) => r.id)).toEqual([own]);
    }));

  it("the agency reads every account's rows (mutation: drop `app.is_agency() or` from the policy → only none, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const a = (await c.query<{ id: string }>(INSERT, params({ account: s.a }))).rows[0]!.id;
      const b = (await c.query<{ id: string }>(INSERT, params({ account: s.b }))).rows[0]!.id;
      await actAs(c, { app_role: "agency_admin", sub: "user_consent_agency" });
      const { rows } = await c.query<{ id: string }>("select id from consent_events where account_id in ($1, $2) order by id", [s.a, s.b]);
      expect(rows.map((r) => r.id)).toEqual([a, b].sort());
    }));

  it("a client cannot insert, even into its own account (42501 on the grant) (mutation: grant insert to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A"), sub: "user_consent_a" });
      expect(await refused(c, INSERT, params({ account: s.a })))
        .toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table consent_events/) });
    }));
});

describe("0054 consent_events: shape", () => {
  it("an SMS address must be E.164 and an email address lowercased and trimmed (mutation: drop consent_events_address_check → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const bad = { code: "23514", constraint: "consent_events_address_check" };
      expect(await refused(c, INSERT, params({ account: s.a, address: "9565550100" }))).toMatchObject(bad);
      expect(await refused(c, INSERT, params({ account: s.a, address: "+09565550100" }))).toMatchObject(bad);
      expect(await refused(c, INSERT, params({ account: s.a, channel: "email", address: "Ana@Example.com" }))).toMatchObject(bad);
      expect(await refused(c, INSERT, params({ account: s.a, channel: "email", address: " ana@example.com" }))).toMatchObject(bad);
      // m2: the SMS upper bound and the email @ rule, which nothing above exercised.
      expect(await refused(c, INSERT, params({ account: s.a, address: "+9876543210987654" }))).toMatchObject(bad);
      expect(await refused(c, INSERT, params({ account: s.a, channel: "email", address: "notanemail.com" }))).toMatchObject(bad);
      // The near-misses that must pass: the controls.
      await c.query(INSERT, params({ account: s.a, address: "+528999221234" }));
      await c.query(INSERT, params({ account: s.a, channel: "email", address: "ana@example.com" }));
    }));

  it("a staff resubscribe needs a non-blank note; a keyword resubscribe does not (mutation: drop consent_events_note_check → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const staff = { account: s.a, action: "resubscribed", method: "staff", actor: "user_1" };
      expect(await refused(c, INSERT, params(staff))).toMatchObject({ code: "23514", constraint: "consent_events_note_check" });
      expect(await refused(c, INSERT, params({ ...staff, note: "   " }))).toMatchObject({ code: "23514", constraint: "consent_events_note_check" });
      await c.query(INSERT, params({ ...staff, note: "Asked on the phone, 3 Oct" }));
      await c.query(INSERT, params({ account: s.a, action: "resubscribed", method: "start_keyword" }));
    }));

  it("a staff or staff_undo row names its actor (mutation: drop consent_events_actor_check → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refused(c, INSERT, params({ account: s.a, method: "staff" })))
        .toMatchObject({ code: "23514", constraint: "consent_events_actor_check" });
      expect(await refused(c, INSERT, params({ account: s.a, action: "held", method: "staff_undo", actor: " " })))
        .toMatchObject({ code: "23514", constraint: "consent_events_actor_check" });
    }));

  it("the closed lists refuse an unknown action or method, and evidence is an object with an excerpt of at most 160 characters (mutation: drop consent_events_action_check, or consent_events_method_check, or consent_events_evidence_check → any one FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refused(c, INSERT, params({ account: s.a, action: "paused" })))
        .toMatchObject({ code: "23514", constraint: "consent_events_action_check" });
      expect(await refused(c, INSERT, params({ account: s.a, method: "sms_stop" })))
        .toMatchObject({ code: "23514", constraint: "consent_events_method_check" });
      expect(await refused(c, INSERT, params({ account: s.a, evidence: JSON.stringify({ excerpt: "x".repeat(161) }) })))
        .toMatchObject({ code: "23514", constraint: "consent_events_evidence_check" });
      expect(await refused(c, INSERT, params({ account: s.a, evidence: "[]" })))
        .toMatchObject({ code: "23514", constraint: "consent_events_evidence_check" });
      await c.query(INSERT, params({ account: s.a, evidence: JSON.stringify({ excerpt: "x".repeat(160) }) }));
    }));

  it("the contact must be the row's own account's (mutation: a plain FK on contact_id → the crossed insert succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refused(c, INSERT, params({ account: s.a, contact: s.contactB })))
        .toMatchObject({ code: "23503", constraint: "consent_events_contact_fkey" });
      await c.query(INSERT, params({ account: s.a, contact: s.contactA }));
    }));
});

describe("0054 consent_events: deletes, as the roles that make them", () => {
  it("a contact deleted by service_role nulls contact_id and keeps the row, though service_role holds no UPDATE (mutation: on delete cascade → the row is gone, FAILS; on delete set null without (contact_id) → 23502 on account_id, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = (await c.query<{ id: string }>(INSERT, params({ account: s.a, contact: s.contactA }))).rows[0]!.id;
      await c.query("set local role service_role");
      await c.query("delete from contacts where id = $1", [s.contactA]);
      await actAsOwner(c);
      const { rows } = await c.query("select account_id, contact_id from consent_events where id = $1", [id]);
      expect(rows).toEqual([{ account_id: s.a, contact_id: null }]);
    }));

  it("an account deleted by service_role takes its ledger with it, though service_role holds no DELETE (mutation: account_id on delete restrict → the delete FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(INSERT, params({ account: s.b }));
      await c.query("set local role service_role");
      await c.query("delete from contacts where account_id = $1", [s.b]);
      await c.query("delete from accounts where id = $1", [s.b]);
      await actAsOwner(c);
      expect((await c.query("select 1 from consent_events where account_id = $1", [s.b])).rows).toEqual([]);
    }));
});

describe("0054 consent_events: indexes", () => {
  it("the address read and the contact FK's set-null are both indexed (mutation: drop consent_events_contact_idx → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'consent_events' order by indexname");
      expect(rows.map((r) => r.indexname)).toEqual(["consent_events_address_idx", "consent_events_contact_idx", "consent_events_pkey"]);
      expect(rows.find((r) => r.indexname === "consent_events_contact_idx")!.indexdef)
        .toMatch(/\(account_id, contact_id\) WHERE \(contact_id IS NOT NULL\)/);
    }));
});

describe("0054 consent_events: occurred_at must be sane (orchestrator decision)", () => {
  const INSERT_AT = `insert into consent_events (account_id, channel, address, action, method, occurred_at)
    values ($1, 'sms', '+19565550100', 'revoked', 'carrier_block', $2) returning id`;

  it("a future occurred_at (beyond 5 minutes of clock skew) is refused; an 'infinity' occurred_at is refused; a past time is accepted (mutation: drop consent_events_occurred_at_sane → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const bad = { code: "23514", constraint: "consent_events_occurred_at_sane" };
      const wellBeyondSkew = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour ahead
      expect(await refused(c, INSERT_AT, [s.a, wellBeyondSkew])).toMatchObject(bad);
      expect(await refused(c, INSERT_AT, [s.a, "infinity"])).toMatchObject(bad);
      // The control: a plainly past time is accepted (this is what every
      // backfill writes).
      await c.query(INSERT_AT, [s.a, "2026-01-01T10:00:00Z"]);
    }));
});

describe("0054 contacts.phone_country_unconfirmed and the textback source", () => {
  it("the flag is boolean, not null, default false, and client-updatable by name (mutation: drop the grant → the client update is 42501, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [col] } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'contacts' and column_name = 'phone_country_unconfirmed'`);
      expect(col).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
      await actAs(c, { org_id: orgId("A"), sub: "user_consent_a" });
      const r = await c.query("update contacts set phone_country_unconfirmed = true where id = $1", [s.contactA]);
      expect(r.rowCount).toBe(1);
    }));

  it("automation_log accepts source 'textback' and still refuses an unknown one (mutation: leave 0047's list → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query(
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'textback','sms','call:x','sent')", [s.a]);
      expect(await refused(c,
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'text_back','sms','call:y','sent')", [s.a]))
        .toMatchObject({ code: "23514", constraint: "automation_log_source_check" });
    }));
});
