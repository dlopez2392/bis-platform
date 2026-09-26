import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

const RUN = Math.random().toString(36).slice(2, 10);
const org = (label: string) => `org_SOW_${label}_${RUN}`;

async function refused(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("rollback to savepoint probe");
    return e as { code?: string; message: string };
  }
  await c.query("release savepoint probe");
  return null;
}
const byPrivilege = (table: string) =>
  ({ code: "42501", message: expect.stringMatching(new RegExp(`permission denied for table ${table}\\b`)) });

type Seed = {
  accountId: string; contactId: string; conversationId: string; messageId: string; formId: string;
  submissionId: string; calendarId: string; bookingId: string; proposalId: string; eventId: string;
  opportunityId: string;
};

/** One real account (client access ON, so RLS would pass) holding one row in every table this file tests. Owner connection. */
async function seed(c: Client, label: string): Promise<Seed> {
  const one = async (sql: string, params: unknown[]) => String((await c.query(sql, params)).rows[0].id);
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const accountId = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture SOW',true) returning id",
    [agency.id, org(label)]);
  const contactId = await one("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [accountId]);
  const conversationId = await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [accountId, contactId]);
  const messageId = await one(
    "insert into messages (account_id, conversation_id, channel, direction, body) values ($1,$2,'sms','outbound','hi') returning id",
    [accountId, conversationId]);
  const formId = await one("insert into forms (account_id, public_id, name) values ($1,$2,'Quote') returning id",
    [accountId, `pub_SOW_${label}_${RUN}`]);
  const submissionId = await one(
    "insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3) returning id", [accountId, formId, contactId]);
  const calendarId = await one("insert into calendars (account_id, public_id) values ($1,$2) returning id",
    [accountId, `cal_SOW_${label}_${RUN}`]);
  const bookingId = await one(
    `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token)
       values ($1,$2,$3, now() + interval '1 day', now() + interval '1 day 1 hour', $4) returning id`,
    [accountId, calendarId, contactId, `tok_SOW_${label}_${RUN}`]);
  const phoneId = await one("insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [accountId, testPhoneNumber()]);
  const callId = await one("insert into calls (account_id, phone_number_id) values ($1,$2) returning id", [accountId, phoneId]);
  const proposalId = await one(
    `insert into call_proposals (account_id, call_id, kind, payload, evidence)
       values ($1,$2,'task','{}'::jsonb,'the caller asked for a callback') returning id`, [accountId, callId]);
  const eventId = await one(
    "insert into events (account_id, type, actor_type, payload) values ($1,'fixture.seeded','system','{}') returning id", [accountId]);
  const pipelineId = await one("insert into pipelines (account_id, name) values ($1,'Sales') returning id", [accountId]);
  const stageId = await one(
    "insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [accountId, pipelineId]);
  const opportunityId = await one(
    "insert into opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1,$2,$3,$4,'Roof') returning id",
    [accountId, contactId, pipelineId, stageId]);
  return { accountId, contactId, conversationId, messageId, formId, submissionId, calendarId, bookingId, proposalId, eventId, opportunityId };
}

const SERVER_ONLY = [
  { table: "events", policy: "events_read" },
  { table: "form_submissions", policy: "form_submissions_member_read" },
  { table: "conversations", policy: "conversations_member_read" },
  { table: "messages", policy: "messages_member_read" },
  { table: "bookings", policy: "bookings_tenant_read" },
  { table: "call_proposals", policy: "call_proposals_member_read" },
] as const;

describe("0053: server-only tables, at the catalogue", () => {
  for (const { table, policy } of SERVER_ONLY) {
    it(`${table}: authenticated holds SELECT and nothing else, table or column level (mutation: re-grant insert -> FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ p: string }>(
          `select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
            where has_table_privilege('authenticated', $1::regclass, p)
           union all
           select 'column ' || p from unnest(array['INSERT','UPDATE','REFERENCES']) p
            where has_any_column_privilege('authenticated', $1::regclass, p)
              and not has_table_privilege('authenticated', $1::regclass, p)`,
          [`public.${table}`]);
        expect(rows.map((r) => r.p)).toEqual(["SELECT"]);
      }));

    it(`${table}: its one policy is ${policy}, SELECT, for authenticated (mutation: keep the FOR ALL policy -> FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = $1`, [table]);
        expect(rows).toEqual([{ policyname: policy, cmd: "SELECT", roles: "{authenticated}" }]);
      }));
  }

  it("contacts and opportunities: UPDATE is exactly the operator columns (mutation: add reactivation_sent_at -> FAILS)", () =>
    withRollback(async (c) => {
      const cols = async (table: string) => (await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public' and table_name = $1 and privilege_type = 'UPDATE'
          order by column_name`, [table])).rows.map((r) => r.column_name);
      expect(await cols("contacts")).toEqual([
        "assigned_to", "attribution", "company_name", "custom", "dnd", "email", "first_name", "last_name",
        "marketing_email_opted_out_at", "phone", "source", "updated_at",
      ]);
      expect(await cols("opportunities")).toEqual([
        "assigned_to", "contact_id", "custom", "monetary_value", "name", "pipeline_id", "stage_changed_at", "stage_id",
        "status", "status_changed_at", "updated_at",
      ]);
    }));

  it("increment_conversation_unread: service_role executes it, anon and authenticated do not (mutation: drop the revoke -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r as role, has_function_privilege(r, 'public.increment_conversation_unread(uuid, uuid)', 'EXECUTE') as x
           from unnest(array['anon','authenticated','service_role']) r order by r`);
      expect(rows).toEqual([
        { role: "anon", x: false }, { role: "authenticated", x: false }, { role: "service_role", x: true },
      ]);
    }));
});

describe("0053: a member of a real account reads, and is refused every write by privilege", () => {
  it("POSITIVE CONTROL (green before AND after): the member sees exactly its own row in each table", () =>
    withRollback(async (c) => {
      const s = await seed(c, "READ");
      await actAs(c, { org_id: org("READ"), sub: "user_SOW_READ" });
      const ids: Record<string, string> = {
        events: s.eventId, form_submissions: s.submissionId, conversations: s.conversationId,
        messages: s.messageId, bookings: s.bookingId, call_proposals: s.proposalId,
      };
      for (const [table, id] of Object.entries(ids)) {
        const { rows } = await c.query(`select id::text as id from ${table} where account_id = $1`, [s.accountId]);
        expect(rows, table).toEqual([{ id }]);
      }
    }));

  // Each case below is one 0053 decides. Refusals that earlier migrations
  // decided are pinned beside those migrations' tests (rls.test.ts,
  // booking-grants.test.ts, call-proposals-grants.test.ts), not repeated here.
  it("INSERT into each is refused by privilege", () =>
    withRollback(async (c) => {
      const s = await seed(c, "INS");
      await actAs(c, { org_id: org("INS"), sub: "user_SOW_INS" });
      expect(await refused(c, "insert into events (account_id, type, actor_type) values ($1,'x.y','user')", [s.accountId]))
        .toMatchObject(byPrivilege("events"));
      expect(await refused(c, "insert into form_submissions (account_id, form_id) values ($1,$2)", [s.accountId, s.formId]))
        .toMatchObject(byPrivilege("form_submissions"));
      expect(await refused(c,
        "insert into messages (account_id, conversation_id, channel, direction, body) values ($1,$2,'sms','inbound','x')",
        [s.accountId, s.conversationId])).toMatchObject(byPrivilege("messages"));
      expect(await refused(c,
        `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token)
           values ($1,$2,$3, now() + interval '2 days', now() + interval '2 days 1 hour', $4)`,
        [s.accountId, s.calendarId, s.contactId, `tok_SOW_INS2_${RUN}`])).toMatchObject(byPrivilege("bookings"));
      // calendars is one per account (calendars_one_per_account); a second
      // insert would be refused by that before 0053 too, which proves nothing.
      // A fresh account with no calendar isolates the grant. Owner FIRST: as a
      // member, RLS on agencies returns no row.
      await actAsOwner(c);
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      const { rows: [bare] } = await c.query(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture SOW',true) returning id",
        [agency.id, org("INS_BARE")]);
      await actAs(c, { org_id: org("INS_BARE"), sub: "user_SOW_INS" });
      expect(await refused(c, "insert into calendars (account_id, public_id) values ($1,$2)", [bare.id, `cal_SOW_INS2_${RUN}`]))
        .toMatchObject(byPrivilege("calendars"));
      // conversations is one per contact: a second contact, inserted by the member (contacts keeps INSERT).
      await actAs(c, { org_id: org("INS"), sub: "user_SOW_INS" });
      const { rows: [c2] } = await c.query("insert into contacts (account_id, first_name) values ($1,'Beto') returning id", [s.accountId]);
      expect(await refused(c, "insert into conversations (account_id, contact_id) values ($1,$2)", [s.accountId, c2.id]))
        .toMatchObject(byPrivilege("conversations"));
    }));

  it("UPDATE is refused by privilege, the once-ever stamps and contact identity included", () =>
    withRollback(async (c) => {
      const s = await seed(c, "UPD");
      await actAs(c, { org_id: org("UPD"), sub: "user_SOW_UPD" });
      const cases: [string, string, unknown[]][] = [
        ["form_submissions", "update form_submissions set instant_reply_sent_at = null where id = $1", [s.submissionId]],
        ["conversations", "update conversations set unread_count = 0 where id = $1", [s.conversationId]],
        ["messages", "update messages set body = 'edited' where id = $1", [s.messageId]],
        ["call_proposals", "update call_proposals set status = 'accepted', decided_at = now(), decided_by = 'user_x' where id = $1", [s.proposalId]],
        ["contacts", "update contacts set reactivation_sent_at = null where id = $1", [s.contactId]],
        ["opportunities", "update opportunities set quote_followup_sent_at = null where id = $1", [s.opportunityId]],
        ["opportunities", "update opportunities set quote_followup_sms_failed_at = null where id = $1", [s.opportunityId]],
        ["contacts", "update contacts set account_id = account_id where id = $1", [s.contactId]],
      ];
      for (const [table, sql, params] of cases) expect(await refused(c, sql, params), sql).toMatchObject(byPrivilege(table));
    }));

  it("DELETE is refused by privilege", () =>
    withRollback(async (c) => {
      const s = await seed(c, "DEL");
      await actAs(c, { org_id: org("DEL"), sub: "user_SOW_DEL" });
      const cases: [string, string][] = [
        ["form_submissions", s.submissionId], ["messages", s.messageId], ["bookings", s.bookingId],
        ["calendars", s.calendarId], ["conversations", s.conversationId],
      ];
      for (const [table, id] of cases)
        expect(await refused(c, `delete from ${table} where id = $1`, [id]), table).toMatchObject(byPrivilege(table));
    }));

  it("the agency is bound by the same grants", () =>
    withRollback(async (c) => {
      const s = await seed(c, "AGY");
      await actAs(c, { app_role: "agency_admin", sub: "user_SOW_AGY" });
      expect(await refused(c, "insert into events (account_id, type, actor_type) values ($1,'x.y','user')", [s.accountId]))
        .toMatchObject(byPrivilege("events"));
      expect(await refused(c, "update call_proposals set status = 'dismissed', decided_at = now(), decided_by = 'u' where id = $1", [s.proposalId]))
        .toMatchObject(byPrivilege("call_proposals"));
    }));
});

describe("0053: what the member can still do (green before AND after; the narrowing is narrow)", () => {
  it("calendar settings, contact and opportunity operator fields still save; contacts still insert", () =>
    withRollback(async (c) => {
      const s = await seed(c, "STILL");
      await actAs(c, { org_id: org("STILL"), sub: "user_SOW_STILL" });
      expect((await c.query("update calendars set enabled = true, updated_at = now() where id = $1", [s.calendarId])).rowCount).toBe(1);
      expect((await c.query("update contacts set first_name = 'Ana Maria', marketing_email_opted_out_at = now(), updated_at = now() where id = $1", [s.contactId])).rowCount).toBe(1);
      expect((await c.query("update opportunities set name = 'Roof repair', status = 'won', status_changed_at = now() where id = $1", [s.opportunityId])).rowCount).toBe(1);
      expect((await c.query("insert into contacts (account_id, first_name) values ($1,'Cris')", [s.accountId])).rowCount).toBe(1);
    }));

  it("deleting a contact still clears its form submission's link, though the member cannot UPDATE form_submissions (referential actions run as the table owner)", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query("select id from agencies limit 1");
      const { rows: [a] } = await c.query(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture SOW',true) returning id",
        [agency.id, org("RI")]);
      const { rows: [ct] } = await c.query("insert into contacts (account_id, first_name) values ($1,'Dora') returning id", [a.id]);
      const { rows: [f] } = await c.query("insert into forms (account_id, public_id, name) values ($1,$2,'Q') returning id", [a.id, `pub_SOW_RI_${RUN}`]);
      const { rows: [fs] } = await c.query(
        "insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3) returning id", [a.id, f.id, ct.id]);
      await actAs(c, { org_id: org("RI"), sub: "user_SOW_RI" });
      expect((await c.query("delete from contacts where id = $1", [ct.id])).rowCount).toBe(1);
      await actAsOwner(c);
      const { rows } = await c.query("select contact_id from form_submissions where id = $1", [fs.id]);
      expect(rows).toEqual([{ contact_id: null }]);
    }));
});

describe("0053: call_proposals_decision_complete", () => {
  it("a decided proposal names its decider and time; a pending one names neither (mutation: drop the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "CHK");
      const { rows: [p] } = await c.query("select call_id from call_proposals where id = $1", [s.proposalId]);
      // kinds other than the seed's pending 'task', so call_proposals_one_pending_unique (0040) never decides a case
      const ins = (status: string, at: string | null, by: string | null, kind: string) => refused(c,
        `insert into call_proposals (account_id, call_id, kind, payload, evidence, status, decided_at, decided_by)
           values ($1,$2,$6,'{}'::jsonb,'evidence',$3,$4,$5)`, [s.accountId, p.call_id, status, at, by, kind]);
      expect(await ins("accepted", null, null, "contact_field")).toMatchObject({ code: "23514" });
      expect(await ins("accepted", "2026-09-26T00:00:00Z", " ", "contact_field")).toMatchObject({ code: "23514" });
      expect(await ins("pending", null, "user_x", "opportunity_stage")).toMatchObject({ code: "23514" });
      expect(await ins("dismissed", "2026-09-26T00:00:00Z", "user_x", "contact_field")).toBeNull();
    }));
});
