import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Record provenance (spec §5, migrations 0073 and 0074). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused INSERT or a failed CHECK raises; one statement
 * per savepoint. RED BEFORE 0074, legitimately: the NOT NULL case and three of the four task-link
 * cases (the service-role case pins what 0074 must leave alone, so it is green either side).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_rp_${RUN}`;
const OWNER_SUB = `user_rp_owner_${RUN}`;
const STAFF_SUB = `user_rp_staff_${RUN}`;
const TECH_SUB = `user_rp_tech_${RUN}`;

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}
async function insert(c: Client, table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const r = await attempt(c,
    `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row));
  return r.rows[0] as Record<string, unknown> & { id: string };
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Prov Co',true) returning id",
    [agency!.id, ORG]);
  const user = (sub: string, name: string | null) =>
    one("insert into users (clerk_user_id, email, name) values ($1, $1 || '@example.com', $2) returning id", [sub, name]);
  const owner = await user(OWNER_SUB, "Dan López");
  const staff = await user(STAFF_SUB, null);
  const tech = await user(TECH_SUB, "Tec");
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$4,'owner'), ($2,'account',$4,'staff'), ($3,'account',$4,'technician')",
    [owner, staff, tech, acct]);
  const ana = await one("insert into contacts (account_id, first_name, assigned_to) values ($1,'Ana',$2) returning id", [acct, tech]);
  const pipeline = await one("insert into pipelines (account_id, name) values ($1,'Sales') returning id", [acct]);
  const stage = await one("insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [acct, pipeline]);
  const convo = await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, ana]);
  const cal = await one("insert into calendars (account_id, public_id) values ($1, $2) returning id", [acct, `cal_${RUN}`]);
  const form = await one("insert into forms (account_id, public_id, name) values ($1, $2, 'Quote request') returning id", [acct, `frm_${RUN}`]);
  return { acct, ana, pipeline, stage, convo, cal, form };
}

let slot = 0;
const booking = (s: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown> = {}) => {
  slot += 1;
  const start = new Date(Date.UTC(2027, 0, 1, 0, 0) + slot * 7_200_000);
  return { account_id: s.acct, calendar_id: s.cal, contact_id: s.ana, starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + 3_600_000).toISOString(), cancel_token: `tok_${RUN}_${slot}`, ...extra };
};
const message = (s: Awaited<ReturnType<typeof seed>>, direction: "inbound" | "outbound", extra: Record<string, unknown> = {}) =>
  ({ account_id: s.acct, conversation_id: s.convo, channel: "sms", direction, body: "x", ...extra });
const event = (c: Client, acct: string, type: string, actorType: string, actorId: string, payload: Record<string, string>) =>
  c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,$2,$3,$4,$5)",
    [acct, type, actorType, actorId, JSON.stringify(payload)]);
/** Two calls and two consent rows in the account, as the owner: what a To-do's server-set links point at. */
async function links(c: Client, s: Awaited<ReturnType<typeof seed>>) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  // Country code 999 is assigned to no country (testPhoneNumber's rule): never dialable, even rolled back.
  const e164 = `+999${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  const phone = await one("insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [s.acct, e164]);
  const call = () => one("insert into calls (account_id, phone_number_id) values ($1,$2) returning id", [s.acct, phone]);
  const consent = () => one("insert into consent_events (account_id, channel, address, action, method) values ($1,'sms','+19565550142','held','free_text') returning id", [s.acct]);
  return { call1: await call(), call2: await call(), consent1: await consent(), consent2: await consent() };
}

describe("0073: who stamps tasks and deals (spec §5.2)", () => {
  it("a signed-in To-do and deal store the caller's sub, whatever was sent (mutation: drop trigger tasks_stamp_created_by -> FAILS; drop opportunities_stamp_created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "Order shingles", created_by: STAFF_SUB });
      expect(t.created_by).toBe(OWNER_SUB);
      const o = await insert(c, "opportunities", { account_id: s.acct, contact_id: s.ana, pipeline_id: s.pipeline, stage_id: s.stage, name: "Deck build", created_by: STAFF_SUB });
      expect(o.created_by).toBe(OWNER_SUB);
    }));
  it("the service role stores NULL on insert (mutation: keep a service-sent created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      expect((await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x", created_by: STAFF_SUB })).created_by).toBeNull();
    }));
  it("a signed-in UPDATE cannot rewrite a To-do's author; the service role can correct it (mutation: drop trigger tasks_keep_created_by -> FAILS; hold every role -> the service case FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x" });
      const u = await attempt(c, "update tasks set created_by = $1, title = 'y' where id = $2 returning created_by, title", [STAFF_SUB, t.id]);
      expect(u.rows[0]).toEqual({ created_by: OWNER_SUB, title: "y" });
      await c.query("reset role");
      await c.query("set local role service_role");
      const v = await attempt(c, "update tasks set created_by = $1 where id = $2 returning created_by", [STAFF_SUB, t.id]);
      expect(v.rows[0]!.created_by).toBe(STAFF_SUB);
    }));
});

describe("0073: a note's author is the signed-in caller (spec §5.2)", () => {
  it("a forged author_id is replaced by the caller's sub on insert, and an update cannot change it (mutation: drop trigger notes_author_guard -> the forged id persists, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: STAFF_SUB });
      const n = await insert(c, "notes", { account_id: s.acct, contact_id: s.ana, body: "Gate code 4411", author_id: OWNER_SUB });
      expect(n.author_id).toBe(STAFF_SUB);
      const u = await attempt(c, "update notes set author_id = $1, body = 'Gate code 4412' where id = $2 returning author_id, body", [OWNER_SUB, n.id]);
      expect(u.rows[0]).toEqual({ author_id: STAFF_SUB, body: "Gate code 4412" });
    }));
  it("the service role's value is kept (no service path writes notes today; spec §5.2) (mutation: hold every role in app.notes_author_guard -> the service insert stores NULL, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("set local role service_role");
      expect((await insert(c, "notes", { account_id: s.acct, contact_id: s.ana, body: "x", author_id: OWNER_SUB })).author_id).toBe(OWNER_SUB);
    }));
});

describe("0073: the closed set (spec §5.1, C2)", () => {
  it("author_kind outside the five is refused on messages, bookings and submissions (mutation: drop messages_author_kind_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "messages", message(s, "outbound", { author_kind: "robot" })))
        .rejects.toMatchObject({ code: "23514", constraint: "messages_author_kind_check" });
      await expect(insert(c, "bookings", booking(s, { author_kind: "robot" })))
        .rejects.toMatchObject({ code: "23514", constraint: "bookings_author_kind_check" });
      await expect(insert(c, "form_submissions", { account_id: s.acct, form_id: s.form, author_kind: "automation" }))
        .rejects.toMatchObject({ code: "23514", constraint: "form_submissions_author_kind_check" });
    }));
  it("an author_id only goes with a person, and an id with NO kind is refused too (mutation: write the check as `author_id is null or author_kind = 'person'` -> the NULL-kind row passes, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // Since 0074 NOT NULL refuses a NULL kind first (23502). Reopen it, rolled back with the test,
      // so the CHECK's own NULL handling is still what refuses the id-with-no-kind row (0074's rollback
      // path drops the NOT NULL, and the CHECK must still hold then).
      await c.query("alter table public.messages alter column author_kind drop not null");
      await c.query("alter table public.bookings alter column author_kind drop not null");
      for (const kind of ["ai", null]) {
        await expect(insert(c, "messages", message(s, "outbound", { author_kind: kind, author_id: OWNER_SUB })), String(kind))
          .rejects.toMatchObject({ code: "23514", constraint: "messages_author_id_person" });
        await expect(insert(c, "bookings", booking(s, { author_kind: kind, author_id: OWNER_SUB })), String(kind))
          .rejects.toMatchObject({ code: "23514", constraint: "bookings_author_id_person" });
      }
      expect((await insert(c, "messages", message(s, "outbound", { author_kind: "person", author_id: OWNER_SUB }))).author_id).toBe(OWNER_SUB);
    }));
  it("a submission is the customer's unless said otherwise (mutation: drop the default -> NULL, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect((await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form })).author_kind).toBe("customer");
    }));
  it("messages and bookings refuse a row with no author since 0074 (mutation: drop the set not null on bookings -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "messages", message(s, "inbound"))).rejects.toMatchObject({ code: "23502", column: "author_kind" });
      await expect(insert(c, "bookings", booking(s))).rejects.toMatchObject({ code: "23502", column: "author_kind" });
    }));
});

describe("0073: the record's per-customer indexes (spec §5.1)", () => {
  it("bookings, tasks and calls are indexed on (account_id, contact_id) (mutation: drop index calls_account_contact -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        "select indexname, indexdef from pg_indexes where schemaname='public' and indexname = any($1) order by 1",
        [["bookings_account_contact", "calls_account_contact", "tasks_account_contact"]]);
      expect(rows.map((r) => [r.indexname, r.indexdef.replace(/^.* USING btree /, "")])).toEqual([
        ["bookings_account_contact", "(account_id, contact_id)"],
        ["calls_account_contact", "(account_id, contact_id)"],
        ["tasks_account_contact", "(account_id, contact_id)"],
      ]);
    }));
});

describe("0073: the backfill, bucket by bucket (spec §5.3)", () => {
  // The backfill is database-wide, and in CI verify other suites commit rows in parallel. So every
  // assertion here is about THIS test's rows: a bucket count is at least this test's contribution,
  // and the re-run is proven a no-op by each row keeping its tuple version (an UPDATE, even one that
  // writes the same values, always writes a new ctid).
  it("each historical row takes the kind its evidence gives, and a second run touches none of them (mutation: map an outbound system event to customer in app.message_author -> FAILS; drop `m.author_kind is null` -> the second run rewrites the messages, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // The window 0074 closes: rows the build before 1b wrote. Rolled back with the test.
      await c.query("alter table public.messages alter column author_kind drop not null");
      await c.query("alter table public.bookings alter column author_kind drop not null");
      const msg = async (direction: "inbound" | "outbound", actor: [string, string] | null) => {
        const m = await insert(c, "messages", message(s, direction));
        if (actor) await event(c, s.acct, "message.created", actor[0], actor[1], { messageId: m.id });
        return m.id;
      };
      const m = {
        inNone: await msg("inbound", null), inAi: await msg("inbound", ["ai", "voice"]),
        outUser: await msg("outbound", ["user", ` ${OWNER_SUB} `]), outSystem: await msg("outbound", ["system", "automation"]),
        outAi: await msg("outbound", ["ai", "voice"]), outNone: await msg("outbound", null),
      };
      const bk = async (actor: [string, string] | null, ip: string | null) => {
        const b = await insert(c, "bookings", booking(s, { ip_hash: ip }));
        if (actor) await event(c, s.acct, "booking.created", actor[0], actor[1], { bookingId: b.id });
        return b.id;
      };
      const b = {
        system: await bk(["system", "public"], "h1"), ai: await bk(["ai", "voice"], null), user: await bk(["user", OWNER_SUB], null),
        noneIp: await bk(null, "h2"), none: await bk(null, null),
      };
      const task = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x" });
      await event(c, s.acct, "task.created", "user", OWNER_SUB, { taskId: task.id });
      const taskNoEvent = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "y" });
      const deal = await insert(c, "opportunities", { account_id: s.acct, contact_id: s.ana, pipeline_id: s.pipeline, stage_id: s.stage, name: "Deck" });
      await event(c, s.acct, "opportunity.created", "user", OWNER_SUB, { opportunityId: deal.id });
      const chat = await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form });
      const typed = await insert(c, "form_submissions", { account_id: s.acct, form_id: s.form });
      await c.query("insert into concierge_conversations (account_id, form_id, ip_hash, submission_id) values ($1,$2,'h3',$3)", [s.acct, s.form, chat.id]);

      const first = await c.query<{ bucket: string; row_count: string }>("select * from app.backfill_record_provenance()");
      // The NOTICE labels the rollout reads, each carrying at least this test's own row.
      const counts = Object.fromEntries(first.rows.map((r) => [r.bucket, Number(r.row_count)]));
      for (const bucket of [
        "messages inbound customer (no event)", "messages inbound ai", "messages outbound person",
        "messages outbound automation", "messages outbound ai", "messages outbound person (no event)",
        "bookings customer", "bookings ai", "bookings person", "bookings customer (no event)", "bookings ai (no event)",
        "tasks person (from task.created)", "opportunities person (from opportunity.created)", "form_submissions ai (website chat)",
      ]) expect(counts[bucket] ?? 0, bucket).toBeGreaterThanOrEqual(1);

      const kinds = async (table: string, ids: Record<string, string>) => {
        const { rows } = await c.query<{ id: string; author_kind: string; author_id: string | null }>(
          `select id, author_kind, author_id from ${table} where id = any($1)`, [Object.values(ids)]);
        return Object.fromEntries(Object.entries(ids).map(([k, id]) => {
          const r = rows.find((x) => x.id === id)!;
          return [k, [r.author_kind, r.author_id]];
        }));
      };
      expect(await kinds("messages", m)).toEqual({
        inNone: ["customer", null], inAi: ["ai", null], outUser: ["person", OWNER_SUB],
        outSystem: ["automation", null], outAi: ["ai", null], outNone: ["person", null],
      });
      expect(await kinds("bookings", b)).toEqual({
        system: ["customer", null], ai: ["ai", null], user: ["person", OWNER_SUB], noneIp: ["customer", null], none: ["ai", null],
      });
      const one = async (sql: string, id: string) => (await c.query(sql, [id])).rows[0];
      expect(await one("select created_by from tasks where id = $1", task.id)).toEqual({ created_by: OWNER_SUB });
      expect(await one("select created_by from tasks where id = $1", taskNoEvent.id)).toEqual({ created_by: null });
      expect(await one("select created_by from opportunities where id = $1", deal.id)).toEqual({ created_by: OWNER_SUB });
      expect(await one("select author_kind from form_submissions where id = $1", chat.id)).toEqual({ author_kind: "ai" });
      expect(await one("select author_kind from form_submissions where id = $1", typed.id)).toEqual({ author_kind: "customer" });

      const versions = async () => (await c.query<{ t: string; id: string; v: string }>(
        `select 'messages' as t, id::text, ctid::text as v from messages where id = any($1::uuid[])
         union all select 'bookings', id::text, ctid::text from bookings where id = any($2::uuid[])
         union all select 'tasks', id::text, ctid::text from tasks where id = any($3::uuid[])
         union all select 'opportunities', id::text, ctid::text from opportunities where id = any($4::uuid[])
         union all select 'form_submissions', id::text, ctid::text from form_submissions where id = any($5::uuid[])
         order by 1, 2`,
        [Object.values(m), Object.values(b), [task.id, taskNoEvent.id], [deal.id], [chat.id, typed.id]])).rows;
      const before = await versions();
      expect(before).toHaveLength(16);
      await c.query("select * from app.backfill_record_provenance()");
      expect(await versions()).toEqual(before);
    }));
});

describe("0073: the tasks backfill leaves Sofía's and the automation's To-dos alone (0073 section 5)", () => {
  it("a To-do linked to a call or a consent row keeps created_by NULL even with a person's task.created event; a plain one takes the person (mutation: drop `t.call_id is null` from the tasks bucket -> the call-linked To-do takes the person, FAILS; drop `t.consent_event_id is null` -> the consent-linked one does, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const l = await links(c, s);
      const plain = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "plain" });
      const byCall = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "call back", call_id: l.call1 });
      const byConsent = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "hold", consent_event_id: l.consent1 });
      for (const t of [plain, byCall, byConsent]) await event(c, s.acct, "task.created", "user", OWNER_SUB, { taskId: t.id });
      await c.query("select * from app.backfill_record_provenance()");
      const { rows } = await c.query<{ id: string; created_by: string | null }>(
        "select id, created_by from tasks where id = any($1::uuid[])", [[plain.id, byCall.id, byConsent.id]]);
      const by = Object.fromEntries(rows.map((r) => [r.id, r.created_by]));
      expect({ plain: by[plain.id], byCall: by[byCall.id], byConsent: by[byConsent.id] })
        .toEqual({ plain: OWNER_SUB, byCall: null, byConsent: null });
    }));
});

describe("0074: a To-do's call and consent links are the server's to set (final review M1)", () => {
  // The timeline reads a To-do with call_id as Sofía's and one with consent_event_id as the
  // automation's (apps/web/src/lib/record/author-mark.ts). The client role holds table-wide INSERT
  // and UPDATE on tasks, so without these triggers a member could relabel their own To-do.
  it("a signed-in UPDATE cannot set, move or clear a To-do's call or consent link, and the rest of the row still updates (mutation: drop trigger tasks_keep_links -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const l = await links(c, s);
      const own = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "mine" });
      const server = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "call back", call_id: l.call1, consent_event_id: l.consent1 });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const set = await attempt(c, "update tasks set call_id = $1, consent_event_id = $2, title = 'mine, renamed' where id = $3 returning call_id, consent_event_id, title",
        [l.call2, l.consent2, own.id]);
      expect(set.rows[0]).toEqual({ call_id: null, consent_event_id: null, title: "mine, renamed" });
      const moved = await attempt(c, "update tasks set call_id = $1, consent_event_id = $2 where id = $3 returning call_id, consent_event_id",
        [l.call2, l.consent2, server.id]);
      expect(moved.rows[0]).toEqual({ call_id: l.call1, consent_event_id: l.consent1 });
      const cleared = await attempt(c, "update tasks set call_id = null, consent_event_id = null where id = $1 returning call_id, consent_event_id", [server.id]);
      expect(cleared.rows[0]).toEqual({ call_id: l.call1, consent_event_id: l.consent1 });
    }));
  it("a signed-in INSERT stores no call or consent link, whatever was sent (mutation: drop the INSERT branch of app.keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const l = await links(c, s);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x", call_id: l.call1, consent_event_id: l.consent1 });
      expect({ call_id: t.call_id, consent_event_id: t.consent_event_id, title: t.title }).toEqual({ call_id: null, consent_event_id: null, title: "x" });
    }));
  it("the service role still sets both, on insert and on update (mutation: hold every role in app.keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const l = await links(c, s);
      await c.query("set local role service_role");
      const t = await insert(c, "tasks", { account_id: s.acct, contact_id: s.ana, title: "x", call_id: l.call1, consent_event_id: l.consent1 });
      expect({ call_id: t.call_id, consent_event_id: t.consent_event_id }).toEqual({ call_id: l.call1, consent_event_id: l.consent1 });
      const u = await attempt(c, "update tasks set call_id = $1, consent_event_id = $2 where id = $3 returning call_id, consent_event_id", [l.call2, l.consent2, t.id]);
      expect(u.rows[0]).toEqual({ call_id: l.call2, consent_event_id: l.consent2 });
    }));
  it("the guard's function is closed to anon, open to the two roles that fire it (mutation: skip the revoke from anon -> FAILS)", () =>
    withRollback(async (c) => {
      const can = async (role: string) =>
        (await c.query<{ ok: boolean }>("select has_function_privilege($1, 'app.keep_task_links()', 'execute') as ok", [role])).rows[0]!.ok;
      expect({ anon: await can("anon"), authenticated: await can("authenticated"), service_role: await can("service_role") })
        .toEqual({ anon: false, authenticated: true, service_role: true });
    }));
});

describe("0073: grants on the new functions (spec §5.2)", () => {
  it("nobody but the owner runs the backfill or the two CASE helpers; the triggers' functions are closed to anon (mutation: grant execute on app.backfill_record_provenance() to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const can = async (role: string, fn: string) =>
        (await c.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [role, fn])).rows[0]!.ok;
      for (const role of ["anon", "authenticated", "service_role"]) {
        expect(await can(role, "app.backfill_record_provenance()"), role).toBe(false);
        expect(await can(role, "app.message_author(text, text)"), role).toBe(false);
        expect(await can(role, "app.booking_author(text, boolean)"), role).toBe(false);
      }
      expect(await can("anon", "app.keep_created_by()")).toBe(false);
      expect(await can("anon", "app.notes_author_guard()")).toBe(false);
      expect(await can("authenticated", "app.notes_author_guard()")).toBe(true);
    }));
});

describe("names on person marks (spec §4, §6)", () => {
  it("a Technician reads the team's users rows, so a note's author can be named on their page (mutation: drop policy users_member_read -> FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: ORG, sub: TECH_SUB });
      const { rows } = await c.query<{ name: string | null }>("select name from users where clerk_user_id = $1", [OWNER_SUB]);
      expect(rows).toEqual([{ name: "Dan López" }]);
    }));
});
