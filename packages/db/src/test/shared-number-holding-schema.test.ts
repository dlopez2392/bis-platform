import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0098_shared_number_holding.sql (S-47e, owner decision E8): contacts.holds_shared_number, its shape, one
 * holding record per account and number, the server-only trigger and move_holding_thread.
 * RED BEFORE APPLY: every case names an object that does not exist yet.
 *
 * Every refusal is shaped so the rule it names is the ONLY one that can refuse it: a shape probe changes exactly
 * one field of the valid holding row. A refused statement aborts the transaction, so each runs in `refusal()`'s
 * savepoint. These rows are hand-shaped on purpose: this file IS the writer's contract (plan Global constraints).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const PHONE = "+19565550142";
type Acct = { accountId: string; orgId: string };
type Refusal = { code?: string; constraint?: string; message: string } | null;
type Over = { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null };

async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_holding_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Holding') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Shared number', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}

async function holdingRow(c: Client, accountId: string, over: Over = {}) {
  const r = { first_name: "Caller", last_name: null, email: null, phone: PHONE, ...over };
  return c.query<{ id: string }>(
    `insert into public.contacts (account_id, first_name, last_name, email, phone, holds_shared_number, author_kind)
     values ($1, $2, $3, $4, $5, true, 'ai') returning id`,
    [accountId, r.first_name, r.last_name, r.email, r.phone]);
}

async function person(c: Client, accountId: string, first: string, last: string, phone = PHONE): Promise<string> {
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, last_name, phone, author_kind) values ($1, $2, $3, $4, 'ai') returning id",
    [accountId, first, last, phone]);
  return r!.id;
}

/** Runs one statement inside its own savepoint: null when it succeeds, else the error's code, constraint and message. */
async function refusal(c: Client, sql: string, params: unknown[] = []): Promise<Refusal> {
  await c.query("savepoint probe");
  try {
    await c.query(sql, params);
    await c.query("release savepoint probe");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint probe");
    const err = e as { code?: string; constraint?: string; message: string };
    return { code: err.code, constraint: err.constraint, message: err.message };
  }
}

async function conversation(c: Client, accountId: string, contactId: string, unread = 0): Promise<string> {
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.conversations (account_id, contact_id, unread_count) values ($1, $2, $3) returning id",
    [accountId, contactId, unread]);
  return r!.id;
}
async function message(c: Client, accountId: string, conversationId: string, body: string, minutesAgo: number): Promise<string> {
  const { rows: [r] } = await c.query<{ id: string }>(
    `insert into public.messages (account_id, conversation_id, channel, direction, body, author_kind, created_at)
     values ($1, $2, 'sms', 'inbound', $3, 'customer', now() - make_interval(mins => $4)) returning id`,
    [accountId, conversationId, body, minutesAgo]);
  return r!.id;
}
/** One phone number per account (phone_numbers_one_active_per_account), so household() makes it once. */
async function phoneNumber(c: Client, accountId: string): Promise<string> {
  const { rows: [pn] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [accountId, testPhoneNumber()]);
  return pn!.id;
}
async function call(c: Client, accountId: string, phoneNumberId: string, conversationId: string, contactId: string | null): Promise<string> {
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.calls (account_id, phone_number_id, conversation_id, contact_id) values ($1, $2, $3, $4) returning id",
    [accountId, phoneNumberId, conversationId, contactId]);
  return r!.id;
}
type Moved = { status: string; moveId?: number; messageIds?: string[]; callIds?: string[] };
async function move(c: Client, accountId: string, from: string, to: string, undoOf: number | null = null): Promise<Moved> {
  await c.query("set local role service_role");
  const { rows: [r] } = await c.query<{ r: Moved }>(
    "select public.move_holding_thread($1, $2, $3, 'user_staff', $4::bigint) as r", [accountId, from, to, undoOf]);
  await c.query("reset role");
  return r!.r;
}

/** Account A: a holding thread (2 messages, unread 2, one call with no contact), Ana (1 message, unread 1, a call of
 *  her own) and Beto (an empty thread), all on PHONE. Account B: its own holding thread on the same number. */
async function household(c: Client) {
  const a = await seedAccount(c, "a");
  const b = await seedAccount(c, "b");
  const { rows: [h] } = await holdingRow(c, a.accountId);
  const ana = await person(c, a.accountId, "Ana", "Prueba");
  const beto = await person(c, a.accountId, "Beto", "Prueba");
  const { rows: [hb] } = await holdingRow(c, b.accountId);
  const hc = await conversation(c, a.accountId, h!.id, 2);
  const ac = await conversation(c, a.accountId, ana, 1);
  const bc = await conversation(c, a.accountId, beto, 0);
  const hbc = await conversation(c, b.accountId, hb!.id, 0);
  const m1 = await message(c, a.accountId, hc, "missed-call text", 120);
  const m2 = await message(c, a.accountId, hc, "test", 60);
  await message(c, a.accountId, ac, "ana old", 180);
  const pn = await phoneNumber(c, a.accountId);
  const holdingCall = await call(c, a.accountId, pn, hc, null);
  const anaCall = await call(c, a.accountId, pn, ac, ana);
  return { a, b, holding: h!.id, holdingB: hb!.id, ana, beto, hc, ac, bc, hbc, m1, m2, pn, holdingCall, anaCall };
}

describe("0098 shape", () => {
  it("contacts.holds_shared_number is boolean, not null, default false", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'contacts' and column_name = 'holds_shared_number'`);
      expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "false" }]);
    }));

  it("pins the CHECK, the partial unique index and the trigger exactly", () =>
    withRollback(async (c) => {
      const { rows: [k] } = await c.query(
        "select pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conname = 'contacts_holding_shape'");
      expect(k).toEqual({
        def: "CHECK (((NOT holds_shared_number) OR ((NOT (first_name IS DISTINCT FROM 'Caller'::text)) AND (last_name IS NULL) AND (email IS NULL) AND (company_name IS NULL) AND (phone IS NOT NULL) AND ((length(phone) >= 8) AND (length(phone) <= 16)) AND (substr(phone, 1, 1) = '+'::text) AND (substr(phone, 2) !~ '[^0-9]'::text))))",
        convalidated: true,
      });
      const { rows: [i] } = await c.query("select indexdef from pg_indexes where indexname = 'contacts_one_holding_per_number'");
      expect(i!.indexdef).toBe("CREATE UNIQUE INDEX contacts_one_holding_per_number ON public.contacts USING btree (account_id, phone) WHERE holds_shared_number");
      const { rows: [t] } = await c.query("select pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'contacts_holding_server_only'");
      expect(t!.def).toBe("CREATE TRIGGER contacts_holding_server_only BEFORE INSERT OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION app.contacts_holding_server_only()");
    }));

  it("the trigger function is a plain invoker and the move a definer, both with pg_temp last, owned by postgres", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select p.oid::regprocedure::text as sig, p.prosecdef, p.proconfig,
          pg_catalog.pg_get_userbyid(p.proowner) as owner
        from pg_proc p where p.proname in ('contacts_holding_server_only', 'move_holding_thread') order by 1`);
      expect(rows).toEqual([
        { sig: "app.contacts_holding_server_only()", prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"], owner: "postgres" },
        { sig: "move_holding_thread(uuid,uuid,uuid,text,bigint)", prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], owner: "postgres" },
      ]);
    }));

  it("the comments name the one writer", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(`select
          col_description('public.contacts'::regclass, (select attnum from pg_attribute where attrelid = 'public.contacts'::regclass and attname = 'holds_shared_number')) as col,
          obj_description('public.move_holding_thread(uuid,uuid,uuid,text,bigint)'::regprocedure, 'pg_proc') as fn`);
      expect(r!.col).toBe("True for the one holding record of a phone several customers share (0098, S-47e E8): it holds the missed-call texts and texts from that number until staff move them to a person. Set only by ensureHoldingContact as service_role; a signed-in insert stores false, and a signed-in session may change nothing on such a record but who it is assigned to (app.contacts_holding_server_only). Whoever writes it, it carries no name but Caller, no email and no business name (contacts_holding_shape); no booking or lead is filed on it (every writer skips it).");
      expect(r!.fn).toBe("Moves a holding thread (contacts.holds_shared_number) to the conversation of a person, with the calls that pointed at it and its unread count, recording the moved ids and that count on its conversation.moved event; a move that finds nothing to move answers empty and writes no event. Or, given such an event as p_undo_of, moves back only those ids that are still on the person thread, with that unread count up to what the person thread still has unread (none when it moves nothing). service_role only, behind the Owner, Staff or agency check of the app (0098).");
    }));
});

describe("0098 the holding record", () => {
  it("an ordinary contact reads false, and the exact holding shape is admitted", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "shape");
      const ana = await person(c, a.accountId, "Ana", "Prueba");
      const { rows: [h] } = await holdingRow(c, a.accountId);
      const { rows } = await c.query("select id, holds_shared_number from public.contacts where id = any($1) order by holds_shared_number",
        [[ana, h!.id]]);
      expect(rows).toEqual([{ id: ana, holds_shared_number: false }, { id: h!.id, holds_shared_number: true }]);
    }));

  it.each([
    ["a last name", { last_name: "Prueba" }],
    ["an email", { email: "ana@example.com" }],
    ["another first name", { first_name: "Ana" }],
    ["no first name (a CHECK passes on NULL, so the term is null-safe)", { first_name: null }],
    ["no phone", { phone: null }],
    ["a phone typed, not E.164", { phone: "(956) 555-0142" }],
    ["a phone of 7 characters, one short of the shortest E.164 (mutation: length between 7 and 16 -> FAILS)", { phone: "+683456" }],
    ["a phone of 17 characters, + and 16 digits, one past the longest E.164 (mutation: length between 8 and 17 -> FAILS)", { phone: "+1234567890123456" }],
  ] as const)("refuses a holding record with %s (contacts_holding_shape, 23514; mutation: drop the CHECK -> FAILS)", (_label, over) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "refuse");
      await c.query("savepoint probe");
      const err = await holdingRow(c, a.accountId, over as Over).then(() => null, (e: { code?: string; constraint?: string }) => e);
      await c.query("rollback to savepoint probe");
      expect(err).toMatchObject({ code: "23514", constraint: "contacts_holding_shape" });
    }));

  it.each([
    ["8 characters, the shortest (Niue: +683 and four digits; mutation: length between 9 and 16 -> FAILS)", "+6834567"],
    ["16 characters, the longest (+ and 15 digits; mutation: length between 8 and 15 -> FAILS)", "+123456789012345"],
  ] as const)("admits a holding record whose E.164 is %s", (_label, phone) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "edge");
      const { rows: [h] } = await holdingRow(c, a.accountId, { phone });
      const { rows } = await c.query("select phone, holds_shared_number from public.contacts where id = $1", [h!.id]);
      expect(rows).toEqual([{ phone, holds_shared_number: true }]);
    }));

  /**
   * A business name reaches a contact only through its business group: app.sync_company_name writes company_name
   * as its owner, so the trigger below never sees a signed-in session, and contacts_company_name_derived re-derives
   * any company_name an insert or update names (a holding insert naming "Acme Roofing" stores none). The group
   * write is therefore the one shape that can put a business name on a holding record, and only the CHECK refuses
   * it. The same call on Ana is the control: it stores the name, so the refusal is the CHECK and not the call.
   */
  it("a business name cannot reach a holding record: set_contacts_business on it is refused (23514), on a person it stores the name (mutation: drop company_name is null from the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "business");
      const { rows: [h] } = await holdingRow(c, a.accountId);
      const ana = await person(c, a.accountId, "Ana", "Prueba");
      const business = "select public.set_contacts_business($1, array[$2::uuid], array['Acme Roofing'])";
      await c.query("set local role service_role");
      expect(await refusal(c, business, [a.accountId, ana])).toBeNull();
      expect(await refusal(c, business, [a.accountId, h!.id])).toMatchObject({ code: "23514", constraint: "contacts_holding_shape" });
      await c.query("reset role");
      const { rows } = await c.query("select id, company_name from public.contacts where id = any($1) order by first_name", [[h!.id, ana]]);
      expect(rows).toEqual([{ id: ana, company_name: "Acme Roofing" }, { id: h!.id, company_name: null }]);
      const { rows: [m] } = await c.query("select count(*)::int as n from public.client_group_members where contact_id = $1", [h!.id]);
      expect(m!.n).toBe(0);
    }));

  it("one holding record per account and E.164; account B gets its own on the same number (mutation: the index on phone alone -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "one");
      const b = await seedAccount(c, "other");
      await holdingRow(c, a.accountId);
      expect(await refusal(c,
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', $2, true, 'ai')",
        [a.accountId, PHONE])).toMatchObject({ code: "23505", constraint: "contacts_one_holding_per_number" });
      expect(await refusal(c,
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', $2, true, 'ai')",
        [b.accountId, PHONE])).toBeNull();
      // Two people and the holding record share the number: the index binds the holding record only.
      await person(c, a.accountId, "Ana", "Prueba");
      await person(c, a.accountId, "Beto", "Prueba");
      const { rows: [n] } = await c.query("select count(*)::int as n from public.contacts where account_id = $1 and phone = $2", [a.accountId, PHONE]);
      expect(n!.n).toBe(3);
    }));

  it("two numbers of two countries that share a digits key each get their own holding record (plan item 13; mutation: the index on (account_id, phone_key) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "keys");
      // +1 322 123 4567 keys 3221234567; +32 2 123 4567 (Belgium) is ten digits and keys the same.
      await holdingRow(c, a.accountId, { phone: "+13221234567" });
      expect(await refusal(c,
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', '+3221234567', true, 'ai')",
        [a.accountId])).toBeNull();
      const { rows } = await c.query("select phone_key from public.contacts where account_id = $1 order by phone", [a.accountId]);
      expect(rows).toEqual([{ phone_key: "3221234567" }, { phone_key: "3221234567" }]);
    }));
});

describe("0098 only server code sets or edits the mark", () => {
  it("a signed-in Owner's insert with holds_shared_number true stores false (mutation: drop the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "client-insert");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query(
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number) values ($1, 'Caller', $2, true)",
        [a.accountId, PHONE]);
      await actAsOwner(c);
      const { rows } = await c.query("select holds_shared_number from public.contacts where account_id = $1", [a.accountId]);
      expect(rows).toEqual([{ holds_shared_number: false }]);
    }));

  it("a signed-in update that names the mark is refused by the grant (plan P3; mutation: grant update (holds_shared_number) on public.contacts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "client-update");
      const ana = await person(c, a.accountId, "Ana", "Prueba");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await refusal(c, "update public.contacts set holds_shared_number = true where id = $1", [ana]))
        .toMatchObject({ code: "42501" });
      await actAsOwner(c);
      const { rows } = await c.query("select holds_shared_number from public.contacts where id = $1", [ana]);
      expect(rows).toEqual([{ holds_shared_number: false }]);
    }));

  /** Every client-updatable column but assigned_to and updated_at (schema-grants-guard.test.ts:86-89). */
  const EDITS = [
    ["attribution", "attribution = '{\"x\":1}'::jsonb"],
    ["custom", "custom = '{\"x\":1}'::jsonb"],
    ["dnd", "dnd = '{\"sms\":true}'::jsonb"],
    ["email", "email = 'ana@example.com'"],
    ["first_name", "first_name = 'Ana'"],
    ["last_name", "last_name = 'Prueba'"],
    ["marketing_email_opted_out_at", "marketing_email_opted_out_at = now()"],
    ["phone", "phone = '+19565550199'"],
    ["phone_country_unconfirmed", "phone_country_unconfirmed = true"],
    ["source", "source = 'staff note'"],
  ] as const;

  it("the edit cases cover exactly the ten columns the trigger compares (read off its own body)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query<{ src: string }>(
        "select prosrc as src from pg_proc where oid = 'app.contacts_holding_server_only()'::regprocedure");
      const named = [...new Set([...p!.src.matchAll(/\bnew\.(\w+)/g)].map((m) => m[1]!))]
        .filter((col) => col !== "holds_shared_number").sort();
      expect(EDITS).toHaveLength(10);
      expect(named).toEqual(EDITS.map(([col]) => col));
    }));

  it.each(EDITS)("a signed-in Owner cannot change a holding record's %s (plan item 8, R3; mutation: drop the trigger's refusal -> FAILS)", (_col, set) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "client-edit");
      const { rows: [h] } = await holdingRow(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await refusal(c, `update public.contacts set ${set} where id = $1`, [h!.id]))
        .toMatchObject({ code: "42501", message: "A shared number holding record is changed by server code only" });
    }));

  it("a signed-in Owner may still assign the holding record and touch updated_at, and edit an ordinary contact's phone", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "client-assign");
      const { rows: [h] } = await holdingRow(c, a.accountId);
      const ana = await person(c, a.accountId, "Ana", "Prueba");
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ org_id: a.orgId, sub })]);
      await c.query("set local role authenticated");
      expect(await refusal(c, "update public.contacts set assigned_to = $2, updated_at = now() where id = $1", [h!.id, u!.id])).toBeNull();
      expect(await refusal(c, "update public.contacts set phone = '+19565550199' where id = $1", [ana])).toBeNull();
      await actAsOwner(c);
      const { rows } = await c.query("select id, assigned_to, phone from public.contacts where id = any($1) order by phone", [[h!.id, ana]]);
      expect(rows).toEqual([{ id: h!.id, assigned_to: u!.id, phone: PHONE }, { id: ana, assigned_to: null, phone: "+19565550199" }]);
    }));

  it("service_role may set the mark and change the record (the server path ensureHoldingContact takes)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "server");
      await c.query("set local role service_role");
      const { rows: [h] } = await c.query<{ id: string }>(
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', $2, true, 'ai') returning id",
        [a.accountId, PHONE]);
      await c.query("update public.contacts set source = 'voice' where id = $1", [h!.id]);
      await c.query("reset role");
      const { rows } = await c.query("select holds_shared_number, source from public.contacts where account_id = $1", [a.accountId]);
      expect(rows).toEqual([{ holds_shared_number: true, source: "voice" }]);
    }));
});

describe("0098 move_holding_thread", () => {
  it("a whole move takes every message and call of the holding thread to the person, carries the unread count, and records the ids on its event", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      expect(r).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: expect.arrayContaining([s.m1, s.m2]), callIds: [s.holdingCall] });
      expect(r.messageIds!.length).toBe(2);
      const { rows: msgs } = await c.query("select conversation_id from public.messages where id = any($1)", [[s.m1, s.m2]]);
      expect(msgs).toEqual([{ conversation_id: s.bc }, { conversation_id: s.bc }]);
      const { rows: [callRow] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [s.holdingCall]);
      expect(callRow).toEqual({ conversation_id: s.bc, contact_id: s.beto });
      const { rows: convs } = await c.query(
        "select id, unread_count, last_message_at is null as empty from public.conversations where id = any($1) order by unread_count",
        [[s.hc, s.bc]]);
      expect(convs).toEqual([{ id: s.hc, unread_count: 0, empty: true }, { id: s.bc, unread_count: 2, empty: false }]);
      const { rows: events } = await c.query(
        "select id::int as id, actor_type, actor_id, payload from public.events where account_id = $1 and type = 'conversation.moved'", [s.a.accountId]);
      expect(events).toEqual([{ id: r.moveId, actor_type: "system", actor_id: "user_staff", payload: {
        writer: "move_holding_thread", by: "user_staff",
        fromConversationId: s.hc, toConversationId: s.bc, fromContactId: s.holding, toContactId: s.beto, messages: 2,
        undo: false, undoOf: null, unread: 2, messageIds: expect.arrayContaining([s.m1, s.m2]), callIds: [s.holdingCall],
      } }]);
    }));

  it("a second move of the same thread (a concurrent second move, or a stale tab) moves nothing, answers empty and writes no event (mutation: drop the empty answer -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      expect(r.status).toBe("ok");
      expect(await move(c, s.a.accountId, s.hc, s.bc)).toEqual({ status: "empty" });
      const { rows: events } = await c.query(
        "select id::int as id from public.events where account_id = $1 and type = 'conversation.moved'", [s.a.accountId]);
      expect(events).toEqual([{ id: r.moveId }]);
      const { rows: convs } = await c.query("select id, unread_count from public.conversations where id = any($1) order by unread_count", [[s.hc, s.bc]]);
      expect(convs).toEqual([{ id: s.hc, unread_count: 0 }, { id: s.bc, unread_count: 2 }]);
    }));

  it("texts with no call, and a call with no text, are each a move, not empty, and so is each Undo (mutation: empty when EITHER list is empty -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const { rows: [h2] } = await holdingRow(c, s.a.accountId, { phone: "+19565550143" });
      const h2c = await conversation(c, s.a.accountId, h2!.id, 0);
      const text = await message(c, s.a.accountId, h2c, "texts only", 5);
      const t = await move(c, s.a.accountId, h2c, s.ac);
      expect(t).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [text], callIds: [] });
      expect(await move(c, s.a.accountId, s.ac, h2c, t.moveId!))
        .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [text], callIds: [] });
      const { rows: [h3] } = await holdingRow(c, s.a.accountId, { phone: "+19565550144" });
      const h3c = await conversation(c, s.a.accountId, h3!.id, 0);
      const lone = await call(c, s.a.accountId, s.pn, h3c, null);
      const k = await move(c, s.a.accountId, h3c, s.bc);
      expect(k).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [], callIds: [lone] });
      expect(await move(c, s.a.accountId, s.bc, h3c, k.moveId!))
        .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [], callIds: [lone] });
    }));

  it("an Undo naming a system event of another type that carries a move's own payload is invalid (mutation: drop e.type = 'conversation.moved' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await move(c, s.a.accountId, s.hc, s.bc);                          // m1 and m2 are on Beto's thread
      // Written here as the table owner: the function's own actor_type, writer and payload, naming m1 and the two
      // threads reversed, so only the event's type can refuse it.
      const { rows: [other] } = await c.query<{ id: number }>(
        `insert into public.events (account_id, type, actor_type, actor_id, payload)
         values ($1, 'conversation.updated', 'system', 'user_staff', jsonb_build_object('writer', 'move_holding_thread', 'by', 'user_staff',
                 'undo', false, 'fromConversationId', $2::text, 'toConversationId', $3::text,
                 'messageIds', jsonb_build_array($4::text), 'callIds', '[]'::jsonb)) returning id::int as id`,
        [s.a.accountId, s.hc, s.bc, s.m1]);
      expect(await move(c, s.a.accountId, s.bc, s.hc, other!.id)).toEqual({ status: "invalid" });
      const { rows: [row] } = await c.query("select conversation_id from public.messages where id = $1", [s.m1]);
      expect(row).toEqual({ conversation_id: s.bc });
    }));

  it("a call on the holding thread that names another contact is not repointed (mutation: drop the calls contact guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const stray = await call(c, s.a.accountId, s.pn, s.hc, s.ana);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      expect(r.callIds).toEqual([s.holdingCall]);
      const { rows: [row] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [stray]);
      expect(row).toEqual({ conversation_id: s.hc, contact_id: s.ana });
    }));

  it("a message carrying another account's id is never moved (mutation: drop m.account_id = p_account_id from the messages update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const foreign = await message(c, s.b.accountId, s.hc, "foreign", 30);
      await move(c, s.a.accountId, s.hc, s.bc);
      const { rows: [row] } = await c.query("select conversation_id from public.messages where id = $1", [foreign]);
      expect(row).toEqual({ conversation_id: s.hc });
    }));

  it("a conversation of A whose contact is B's holding record is not a holding thread for A (mutation: drop k.account_id = p_account_id from the contacts reads -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const crossed = await conversation(c, s.a.accountId, s.holdingB, 0);
      await message(c, s.a.accountId, crossed, "crossed", 10);
      expect(await move(c, s.a.accountId, crossed, s.bc)).toEqual({ status: "invalid" });
    }));

  it("Undo names the move: exactly what it moved goes back with the unread it carried, a message and a call the person made since stay, the event says undo (mutations: drop the m.id or the k.id filter -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      const later = await message(c, s.a.accountId, s.bc, "later", 1);
      const betosOwn = await call(c, s.a.accountId, s.pn, s.bc, s.beto);
      const u = await move(c, s.a.accountId, s.bc, s.hc, r.moveId!);
      expect(u).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: expect.arrayContaining([s.m1, s.m2]), callIds: [s.holdingCall] });
      const { rows: [counts] } = await c.query(`select
          (select count(*)::int from public.messages where conversation_id = $1) as holding,
          (select count(*)::int from public.messages where conversation_id = $2) as beto,
          (select conversation_id from public.messages where id = $3) as later_in`, [s.hc, s.bc, later]);
      expect(counts).toEqual({ holding: 2, beto: 1, later_in: s.bc });
      const { rows: [callRow] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [s.holdingCall]);
      expect(callRow).toEqual({ conversation_id: s.hc, contact_id: null });
      // R2: a call Beto made on his own thread after the move is not one the move recorded (mutation: drop
      // `and (p_undo_of is null or k.id = any (v_want_calls))` -> it moves to the holding thread, FAILS).
      const { rows: [own] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [betosOwn]);
      expect(own).toEqual({ conversation_id: s.bc, contact_id: s.beto });
      const { rows: convs } = await c.query("select id, unread_count from public.conversations where id = any($1) order by unread_count", [[s.hc, s.bc]]);
      // The Undo hands back the 2 unread the move carried: Beto had none of his own (mutation: an Undo hands back nothing -> FAILS).
      expect(convs).toEqual([{ id: s.bc, unread_count: 0 }, { id: s.hc, unread_count: 2 }]);
      const { rows: [ev] } = await c.query("select payload->'undo' as undo, (payload->>'undoOf')::int as of from public.events where id = $1", [u.moveId]);
      expect(ev).toEqual({ undo: true, of: r.moveId });
    }));

  /** The unread count of each thread, and the `unread` each named event recorded. */
  async function unread(c: Client, ids: string[]): Promise<Record<string, number>> {
    const { rows } = await c.query<{ id: string; unread_count: number }>(
      "select id, unread_count from public.conversations where id = any($1)", [ids]);
    return Object.fromEntries(rows.map((r) => [r.id, r.unread_count]));
  }
  async function handed(c: Client, eventId: number): Promise<number | null> {
    const { rows: [e] } = await c.query<{ n: number | null }>("select (payload->>'unread')::int as n from public.events where id = $1", [eventId]);
    return e!.n;
  }

  it("an Undo hands back the unread the move carried, and the person keeps their own (mutations: an Undo hands back nothing, or the move records no unread -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);                                      // holding unread 2, Ana unread 1 of her own
      const r = await move(c, s.a.accountId, s.hc, s.ac);
      expect(await unread(c, [s.hc, s.ac])).toEqual({ [s.hc]: 0, [s.ac]: 3 });
      const u = await move(c, s.a.accountId, s.ac, s.hc, r.moveId!);
      expect(await unread(c, [s.hc, s.ac])).toEqual({ [s.hc]: 2, [s.ac]: 1 });
      expect([await handed(c, r.moveId!), await handed(c, u.moveId!)]).toEqual([2, 2]);
    }));

  it("an Undo after the person read some hands back no more than they still have unread (mutation: drop the cap -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.ac);               // Ana 1 + 2 = 3
      await c.query("update public.conversations set unread_count = 1 where id = $1", [s.ac]);   // she read two
      const u = await move(c, s.a.accountId, s.ac, s.hc, r.moveId!);
      expect(await unread(c, [s.hc, s.ac])).toEqual({ [s.hc]: 1, [s.ac]: 0 });
      expect(await handed(c, u.moveId!)).toBe(1);
    }));

  it("a second Undo of the same move moves nothing and hands back no unread, even when the person has new unread (mutation: hand back on an Undo that moved nothing -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      await move(c, s.a.accountId, s.bc, s.hc, r.moveId!);               // holding 2, Beto 0
      await c.query("update public.conversations set unread_count = 1 where id = $1", [s.bc]);   // a new text for Beto
      const again = await move(c, s.a.accountId, s.bc, s.hc, r.moveId!);
      expect(again).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [], callIds: [] });
      expect(await unread(c, [s.hc, s.bc])).toEqual({ [s.hc]: 2, [s.bc]: 1 });
      expect(await handed(c, again.moveId!)).toBe(0);
    }));

  it("a forged Undo moves nothing it did not move: another move's event, an Undo's own event, another account's event, a reversed pair (item 11; mutation: skip the event's from/to check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const { rows: [h2] } = await holdingRow(c, s.a.accountId, { phone: "+19565550143" });
      const h2c = await conversation(c, s.a.accountId, h2!.id, 0);
      await message(c, s.a.accountId, h2c, "other number", 5);
      const toAna = await move(c, s.a.accountId, h2c, s.ac);            // a move between OTHER threads
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      const u = await move(c, s.a.accountId, s.bc, s.hc, r.moveId!);
      await move(c, s.a.accountId, s.hc, s.bc);                          // moved again: the threads are full again
      // An event of account B shaped exactly like the function's own, naming A's two threads (written here as the
      // table owner), so only the event's account filter refuses it.
      const { rows: [bEvent] } = await c.query<{ id: number }>(
        `insert into public.events (account_id, type, actor_type, actor_id, payload)
         values ($1, 'conversation.moved', 'system', 'x', jsonb_build_object('writer', 'move_holding_thread', 'by', 'x', 'undo', false, 'fromConversationId', $2::text,
                 'toConversationId', $3::text, 'messageIds', '[]'::jsonb, 'callIds', '[]'::jsonb)) returning id::int as id`,
        [s.b.accountId, s.hc, s.bc]);
      expect(await move(c, s.a.accountId, s.bc, s.hc, toAna.moveId!)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.bc, s.hc, u.moveId!)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.bc, s.hc, bEvent!.id)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.ac, s.hc, r.moveId!)).toEqual({ status: "invalid" });
      const { rows: [n] } = await c.query("select count(*)::int as n from public.messages where conversation_id = $1", [s.bc]);
      expect(n!.n).toBe(2);
    }));

  it.each(["technician", "owner"] as const)("an event a signed-in %s writes through record_event, shaped like a move, can never be undone from (R1; mutation: drop the actor_type and writer checks -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await household(c);
      await move(c, s.a.accountId, s.hc, s.bc);                          // Ana's message and call stay on her thread
      await actAsMember(c, s.a.accountId, s.a.orgId, role);
      await c.query("select public.record_event($1, 'conversation.moved', $2::jsonb)", [s.a.accountId, JSON.stringify({
        writer: "move_holding_thread", by: "x", undo: false, fromConversationId: s.hc, toConversationId: s.ac,
        messageIds: [], callIds: [s.anaCall],
      })]);
      await actAsOwner(c);
      const { rows: [forged] } = await c.query<{ id: number; actor_type: string }>(
        "select id::int as id, actor_type from public.events where account_id = $1 and type = 'conversation.moved' order by id desc limit 1", [s.a.accountId]);
      expect(forged!.actor_type).toBe("user");
      expect(await move(c, s.a.accountId, s.ac, s.hc, forged!.id)).toEqual({ status: "invalid" });
      const { rows: [anaCall] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [s.anaCall]);
      expect(anaCall).toEqual({ conversation_id: s.ac, contact_id: s.ana });
    }));

  it("an Undo cannot itself be undone: an Undo always moves toward the holding thread, so undoing it moves away from it with an event named, which the direction guard refuses (the event carries no undo-flag check, which no call could reach; mutation m20 drops the direction guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      const u = await move(c, s.a.accountId, s.bc, s.hc, r.moveId!);
      expect(await move(c, s.a.accountId, s.hc, s.bc, u.moveId!)).toEqual({ status: "invalid" });
      const { rows: [n] } = await c.query("select count(*)::int as n from public.messages where conversation_id = $1", [s.hc]);
      expect(n!.n).toBe(2);
    }));

  it("invalid: the same thread, two person threads, two holding threads, toward the holding thread with no move named, away from it with one", () =>
    withRollback(async (c) => {
      const s = await household(c);
      const { rows: [h2] } = await holdingRow(c, s.a.accountId, { phone: "+19565550143" });
      const h2c = await conversation(c, s.a.accountId, h2!.id, 0);
      const r = await move(c, s.a.accountId, s.hc, s.bc);
      expect(await move(c, s.a.accountId, s.hc, s.hc)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.ac, s.bc)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.hc, h2c)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.ac, s.hc)).toEqual({ status: "invalid" });
      expect(await move(c, s.a.accountId, s.hc, s.ac, r.moveId!)).toEqual({ status: "invalid" });
      const { rows: [callRow] } = await c.query("select conversation_id, contact_id from public.calls where id = $1", [s.anaCall]);
      expect(callRow).toEqual({ conversation_id: s.ac, contact_id: s.ana });
    }));

  it("not_found for another account's conversation on either side, and for A's conversations asked as B (mutation: drop c.account_id = p_account_id from the two reads -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      expect(await move(c, s.a.accountId, s.hbc, s.bc)).toEqual({ status: "not_found" });
      expect(await move(c, s.a.accountId, s.hc, s.hbc)).toEqual({ status: "not_found" });
      expect(await move(c, s.b.accountId, s.hc, s.bc)).toEqual({ status: "not_found" });
      const { rows: [n] } = await c.query("select count(*)::int as n from public.messages where conversation_id = $1", [s.hc]);
      expect(n!.n).toBe(2);
    }));

  it("only service_role may execute it (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      for (const role of ["anon", "authenticated"] as const) {
        await c.query("savepoint probe");
        await c.query(`set local role ${role}`);
        const err = await c.query("select public.move_holding_thread($1, $2, $3, 'x')", [s.a.accountId, s.hc, s.bc])
          .then(() => null, (e: { code?: string }) => e);
        await c.query("rollback to savepoint probe");
        expect(err, role).toMatchObject({ code: "42501" });
      }
      const { rows } = await c.query(`select has_function_privilege('service_role', 'public.move_holding_thread(uuid,uuid,uuid,text,bigint)', 'execute') as svc,
        has_function_privilege('authenticated', 'public.move_holding_thread(uuid,uuid,uuid,text,bigint)', 'execute') as auth,
        has_function_privilege('anon', 'public.move_holding_thread(uuid,uuid,uuid,text,bigint)', 'execute') as anon`);
      expect(rows).toEqual([{ svc: true, auth: false, anon: false }]);
    }));

  it("a pg_temp shadow does not run inside it (0096's probe, armed first)", () =>
    withRollback(async (c) => {
      const s = await household(c);
      await c.query("set local role service_role");
      await c.query(`create function pg_temp.bis_shadow(v pg_catalog.text) returns pg_catalog.bool language plpgsql
                       as $f$ begin raise exception 'BIS-SHADOW ran as %', current_user; end $f$`);
      await c.query("create domain pg_temp.text as pg_catalog.text check (pg_temp.bis_shadow(value))");
      await c.query("savepoint armed");
      await expect(c.query("select 'x'::text")).rejects.toThrow("BIS-SHADOW ran as service_role");
      await c.query("rollback to savepoint armed");
      const { rows: [r] } = await c.query<{ s: string }>(
        "select (public.move_holding_thread($1, $2, $3, 'user_shadow'))->>'status' as s", [s.a.accountId, s.hc, s.bc]);
      expect(r!.s).toBe("ok");
    }));
});
