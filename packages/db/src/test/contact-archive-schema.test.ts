import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0103_contact_archive.sql: archived_at / archived_by, the stamp and log triggers, contact_archive_log,
 * restore_contact_on_sign, contact_delete_blockers, delete_internal_contacts, and conversations.contact_archived /
 * inbox_visible.
 * RED BEFORE APPLY: every case names an object that does not exist yet. Replica only (withRollback).
 *
 * Every seed below is a minimal insert whose columns were read off the live catalogue (the NOT NULL columns
 * with no default) and, where one exists, off an existing withRollback insert, named at the helper.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };

async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_archive_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Archive') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Archive test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function contact(c: Client, accountId: string, first = "Junk"): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, author_kind) values ($1, $2, 'person') returning id", [accountId, first]);
  return r!.id;
}
async function conversation(c: Client, accountId: string, contactId: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.conversations (account_id, contact_id) values ($1, $2) returning id", [accountId, contactId]);
  return r!.id;
}
/** messages.author_kind is NOT NULL with no default (0073); the shape is booking-cancel-notices-schema.test.ts:50-52's. */
async function message(c: Client, accountId: string, conversationId: string, channel: string, direction: string) {
  await actAsOwner(c);
  await c.query(
    `insert into public.messages (account_id, conversation_id, channel, direction, body, status, author_kind)
     values ($1, $2, $3, $4, 'x', 'delivered', $5)`,
    [accountId, conversationId, channel, direction, direction === "inbound" ? "customer" : "person"]);
}
/** One active number per account (phone_numbers_one_active_per_account); shape from shared-number-holding-schema.test.ts:74-84. */
async function phoneNumber(c: Client, accountId: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [pn] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [accountId, testPhoneNumber()]);
  return pn!.id;
}
async function call(c: Client, accountId: string, phoneNumberId: string, conversationId: string | null, contactId: string | null) {
  await actAsOwner(c);
  await c.query(
    "insert into public.calls (account_id, phone_number_id, conversation_id, contact_id) values ($1, $2, $3, $4)",
    [accountId, phoneNumberId, conversationId, contactId]);
}
/** pipelines, a stage, an opportunity: the NOT NULL columns of each. */
async function deal(c: Client, accountId: string, contactId: string) {
  await actAsOwner(c);
  const { rows: [p] } = await c.query<{ id: string }>(
    "insert into public.pipelines (account_id, name) values ($1, 'Sales') returning id", [accountId]);
  const { rows: [s] } = await c.query<{ id: string }>(
    "insert into public.pipeline_stages (account_id, pipeline_id, name, position) values ($1, $2, 'New', 0) returning id",
    [accountId, p!.id]);
  await c.query(
    "insert into public.opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1, $2, $3, $4, 'Roof')",
    [accountId, contactId, p!.id, s!.id]);
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
const blockers = async (c: Client, accountId: string, ids: string[]) => {
  await actAsOwner(c);
  await c.query("set local role service_role");
  const { rows } = await c.query<{ contact_id: string; reasons: string[] }>(
    "select contact_id, reasons from public.contact_delete_blockers($1, $2::uuid[]) order by contact_id", [accountId, ids]);
  await c.query("reset role");
  return rows;
};
/** delete_internal_contacts as a signed-in Owner of the account: the path the app takes (deleteContacts on the request client). */
const deleteAsOwner = async (c: Client, a: Acct, ids: string[]): Promise<string[]> => {
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query<{ d: string[] }>("select public.delete_internal_contacts($1, $2::uuid[]) as d", [a.accountId, ids]);
  await actAsOwner(c);
  return r!.d;
};
const exists = async (c: Client, ids: string[]) => {
  await actAsOwner(c);
  const { rows } = await c.query<{ id: string }>("select id from public.contacts where id = any($1::uuid[]) order by id", [ids]);
  return rows.map((r) => r.id);
};

describe("0103: archive columns and the stamp trigger", () => {
  it("a signed-in archive stamps archived_by with the caller and archived_at with now, whatever the client sent (mutation: drop `new.archived_at := pg_catalog.now()` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "stamp");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("update public.contacts set archived_at = '2001-01-01' where id = $1", [id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query<{ archived_by: string; recent: boolean }>(
        "select archived_by, archived_at > now() - interval '1 minute' as recent from public.contacts where id = $1", [id]);
      expect(r).toEqual({ archived_by: sub, recent: true });
    }));

  it("a signed-in insert is never born archived and cannot name who archived it (table-level INSERT covers every column; mutation: the stamp trigger on update only -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "insert");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query<{ id: string }>(
        `insert into public.contacts (account_id, first_name, archived_at, archived_by)
         values ($1, 'Born', '2001-01-01', 'user_someone_else') returning id`, [a.accountId]);
      await actAsOwner(c);
      const { rows: [k] } = await c.query("select archived_at, archived_by from public.contacts where id = $1", [r!.id]);
      expect(k).toEqual({ archived_at: null, archived_by: null });
    }));

  it("a signed-in client cannot write archived_by (mutation: grant update (archived_by) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "by");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "update public.contacts set archived_by = 'someone' where id = $1", [id]))?.code).toBe("42501");
    }));

  it("restoring clears archived_by (mutation: drop the restore branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "restore");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.contacts set archived_at = null where id = $1", [id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query("select archived_at, archived_by from public.contacts where id = $1", [id]);
      expect(r).toEqual({ archived_at: null, archived_by: null });
    }));

  it("a Technician's archive is refused 42501, on a customer assigned to them (ruling Q3; mutation: drop the is_technician check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "tech");
      const id = await contact(c, a.accountId);
      // contacts.assigned_to is a users.id uuid (0003_crm_core.sql:12), the value app.current_user_id() answers (0068:65),
      // so RLS's technician scope admits this row and only the stamp trigger can refuse it.
      const sub = await actAsMember(c, a.accountId, a.orgId, "technician");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [id, u!.id]);
      await actAs(c, { org_id: a.orgId, sub });
      expect((await refusal(c, "update public.contacts set archived_at = now() where id = $1", [id]))?.code).toBe("42501");
    }));

  it("archiving an already-archived contact again keeps the first archive: same instant, same person, no second log row (mutation: drop the keep-the-first-archive branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rearchive");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      // The first archive, a day ago, by someone else (written as the table owner, so neither trigger stamps it).
      await c.query("update public.contacts set archived_at = now() - interval '1 day', archived_by = 'user_first' where id = $1", [id]);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await actAsOwner(c);
      const { rows: [k] } = await c.query(
        "select archived_by, archived_at < now() - interval '23 hours' as first from public.contacts where id = $1", [id]);
      expect(k).toEqual({ archived_by: "user_first", first: true });
      expect((await c.query("select 1 from public.contact_archive_log where contact_id = $1", [id])).rowCount).toBe(0);
    }));

  it("a Technician's restore is refused 42501 too, on a customer assigned to them (ruling Q3; mutation: refuse a Technician only when archiving -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "techrestore");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "technician");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("update public.contacts set assigned_to = $2, archived_at = now(), archived_by = 'user_owner' where id = $1", [id, u!.id]);
      await actAs(c, { org_id: a.orgId, sub });
      expect((await refusal(c, "update public.contacts set archived_at = null where id = $1", [id]))?.code).toBe("42501");
    }));

  it("archiving a shared number's holding record is refused 42501 (mutation: drop the holds_shared_number check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "holding");
      await actAsOwner(c);
      const { rows: [h] } = await c.query<{ id: string }>(
        `insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind)
         values ($1, 'Caller', '+19565550142', true, 'ai') returning id`, [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "update public.contacts set archived_at = now() where id = $1", [h!.id]))?.code).toBe("42501");
    }));
});

describe("0103: contact_archive_log", () => {
  it("a signed-in archive and a signed-in restore each write ONE person row (mutation: move `current_user = 'authenticated'` from the trigger's WHEN into the definer body -> nothing is logged, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "log");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.contacts set archived_at = null where id = $1", [id]);
      await actAsOwner(c);
      const { rows } = await c.query("select action, author_kind, author_id, sign from public.contact_archive_log where contact_id = $1 order by id", [id]);
      expect(rows).toEqual([
        { action: "archived", author_kind: "person", author_id: sub, sign: null },
        { action: "restored", author_kind: "person", author_id: sub, sign: null },
      ]);
    }));

  it("authenticated holds no write privilege on the log (mutation: grant insert on contact_archive_log to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      // A privilege read, not an attempted insert (review I1): with RLS on and no insert policy, an insert is
      // refused 42501 whether or not the grant exists, so a refusal cannot tell the two apart.
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_archive_log', 'INSERT') as i,
                has_table_privilege('authenticated', 'public.contact_archive_log', 'UPDATE') as u,
                has_table_privilege('authenticated', 'public.contact_archive_log', 'DELETE') as d`);
      expect(p).toEqual({ i: false, u: false, d: false });
    }));

  it("a member reads only their own account's log rows (second account; mutation: policy `using (true)` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "logA");
      const b = await seedAccount(c, "logB");
      const idB = await contact(c, b.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [idB]);
      // The control: B's own Owner reads the row, so the zero below is the policy and not an empty log.
      expect((await c.query("select 1 from public.contact_archive_log where contact_id = $1", [idB])).rowCount).toBe(1);
      await actAsOwner(c); // actAsMember seeds its users row as the current role, which must be the table owner
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await c.query("select 1 from public.contact_archive_log where contact_id = $1", [idB])).rowCount).toBe(0);
    }));
});

describe("0103: contact_archive_log, what a Technician reads", () => {
  it("a Technician reads the log rows of the customers assigned to them and no others (the policy reads through contacts' RLS; mutation: policy `using (account_id = app.current_account_id())` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "techlog");
      const mine = await contact(c, a.accountId, "Mine");
      const other = await contact(c, a.accountId, "Other");
      const sub = await actAsMember(c, a.accountId, a.orgId, "technician");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [mine, u!.id]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = any($1::uuid[])", [[mine, other]]);
      await actAsOwner(c);
      expect((await c.query("select 1 from public.contact_archive_log where account_id = $1", [a.accountId])).rowCount).toBe(2);
      await actAs(c, { org_id: a.orgId, sub });
      const { rows } = await c.query("select contact_id, action from public.contact_archive_log where account_id = $1", [a.accountId]);
      expect(rows).toEqual([{ contact_id: mine, action: "archived" }]);
    }));
});

describe("0103: restore_contact_on_sign", () => {
  it("restores an archived contact and writes ONE customer row with its sign; an active one answers false and writes nothing (mutation: drop `and archived_at is not null` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "sign");
      const archived = await contact(c, a.accountId, "Back");
      const active = await contact(c, a.accountId, "Here");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [archived]);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const one = await c.query("select public.restore_contact_on_sign($1, $2, 'text') as r", [a.accountId, archived]);
      const two = await c.query("select public.restore_contact_on_sign($1, $2, 'text') as r", [a.accountId, active]);
      await c.query("reset role");
      expect([one.rows[0].r, two.rows[0].r]).toEqual([true, false]);
      // The WHOLE log of both contacts, by id (review I1): a filter on author_kind would hide a person row that a
      // log trigger without its WHEN role test writes for this same restore.
      const { rows } = await c.query(
        "select contact_id, action, author_kind, sign from public.contact_archive_log where account_id = $1 order by id", [a.accountId]);
      expect(rows).toEqual([
        { contact_id: archived, action: "archived", author_kind: "person", sign: null },
        { contact_id: archived, action: "restored", author_kind: "customer", sign: "text" },
      ]);
      const { rows: [k] } = await c.query("select archived_at, archived_by from public.contacts where id = $1", [archived]);
      expect(k).toEqual({ archived_at: null, archived_by: null });
    }));

  it("another account's contact is never restored (second account; mutation: drop `account_id = p_account_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "signA");
      const b = await seedAccount(c, "signB");
      const idB = await contact(c, b.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [idB]);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const { rows: [r] } = await c.query("select public.restore_contact_on_sign($1, $2, 'call') as r", [a.accountId, idB]);
      await c.query("reset role");
      expect(r.r).toBe(false);
      expect((await c.query("select archived_at from public.contacts where id = $1 and archived_at is not null", [idB])).rowCount).toBe(1);
    }));

  it("authenticated cannot execute the two service-role functions (mutation: grant execute on restore_contact_on_sign to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "exec");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      for (const sql of [
        "select public.restore_contact_on_sign($1, $2, 'text')",
        "select * from public.contact_delete_blockers($1, array[$2]::uuid[])",
      ]) expect((await refusal(c, sql, [a.accountId, id]))?.code, sql).toBe("42501");
    }));

  it("anon executes none of the three; authenticated only the Owner-checked delete; service_role all three (mutation: drop `anon` from a revoke -> FAILS)", () =>
    withRollback(async (c) => {
      // The default ACL grants EXECUTE on every new public function to anon by name (ci-project.sql:62-63),
      // so only a revoke naming anon takes it away.
      const { rows } = await c.query(
        `select f, has_function_privilege('anon', f, 'execute') as anon,
                has_function_privilege('authenticated', f, 'execute') as auth,
                has_function_privilege('service_role', f, 'execute') as svc
           from unnest(array['public.restore_contact_on_sign(uuid,uuid,text)', 'public.contact_delete_blockers(uuid,uuid[])',
                             'public.delete_internal_contacts(uuid,uuid[])']) as f order by f`);
      expect(rows).toEqual([
        { f: "public.contact_delete_blockers(uuid,uuid[])", anon: false, auth: false, svc: true },
        { f: "public.delete_internal_contacts(uuid,uuid[])", anon: false, auth: true, svc: true },
        { f: "public.restore_contact_on_sign(uuid,uuid,text)", anon: false, auth: false, svc: true },
      ]);
    }));
});

describe("0103: delete_internal_contacts keeps the database's Owner check (review I9)", () => {
  it("a Staff member's call is refused 42501 and deletes nothing (mutation: drop the Owner check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "staffdel");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, id]))?.code).toBe("42501");
      await actAsOwner(c);
      expect((await c.query("select 1 from public.contacts where id = $1", [id])).rowCount).toBe(1);
    }));

  it("an Owner of the account deletes; an Owner of ANOTHER account is refused, and so is an Owner of both signed in to the other (second account; mutation: drop `p_account_id = app.current_account_id()` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ownA");
      const b = await seedAccount(c, "ownB");
      const idA = await contact(c, a.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, idA]))?.code).toBe("42501");
      // One person who owns BOTH accounts, whose token is in B's org: is_account_owner(A) is true for them, so only
      // the token's account term refuses a delete in A (0066's own policy shape: account_id = current_account_id()).
      await actAsOwner(c);
      const sub = `user_both_${RUN}`;
      const { rows: [u] } = await c.query<{ id: string }>(
        "insert into public.users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
      await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner'), ($1, 'account', $3, 'owner')",
        [u!.id, a.accountId, b.accountId]);
      await actAs(c, { org_id: b.orgId, sub });
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, idA]))?.code).toBe("42501");
      await actAsOwner(c);
      expect(await exists(c, [idA])).toEqual([idA]);
      expect(await deleteAsOwner(c, a, [idA])).toEqual([idA]);
      expect(await exists(c, [idA])).toEqual([]);
    }));

  it("an Owner of an account whose client access is OFF is refused 42501 (re-review Critical; mutation: drop the outer coalesce AND the inner one around `p_account_id = app.current_account_id()` -> FAILS; either one alone refuses)", () =>
    withRollback(async (c) => {
      // current_account_id() is NULL here (0008:13-18) while is_account_owner is still true (0066:63-66): the account
      // term is NULL, and a NULL that reaches `if not (...)` never raises (fails OPEN). Two coalesces stand in its way,
      // the inner one on the account term and the outer one on the whole expression, and each alone suffices.
      const a = await seedAccount(c, "accessoff");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, id]))?.code).toBe("42501");
      await actAsOwner(c);
      expect((await c.query("select 1 from public.contacts where id = $1", [id])).rowCount).toBe(1);
    }));

  it("the app's Owner pre-flight, an EMPTY array: a Staff member is refused 42501, an Owner gets an empty answer (T4 calls it before the purge; mutations: an empty-array early return above the Owner check, or a lower bound of 1 -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "preflight");
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect((await refusal(c, "select public.delete_internal_contacts($1, '{}'::uuid[])", [a.accountId]))?.code).toBe("42501");
      await actAsOwner(c);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query<{ d: string[] }>("select public.delete_internal_contacts($1, '{}'::uuid[]) as d", [a.accountId]);
      expect(r!.d).toEqual([]);
    }));

  const badIds: [string, () => string[] | null][] = [
    ["501 ids (mutation: the cap at 501 -> FAILS)", () => Array.from({ length: 501 }, () => randomUUID())],
    ["no array at all (mutation: drop `p_contact_ids is null or` -> FAILS)", () => null],
  ];
  it.each(badIds)("refuses %s with 22023, before it locks anything", (_label, ids) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "delcap");
      await actAsOwner(c);
      await c.query("set local role service_role");
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      expect((await refusal(c, "select public.delete_internal_contacts($1, $2::uuid[])", [a.accountId, ids()]))?.code).toBe("22023");
      await c.query("reset role");
    }));

  it("server code (a service_role JWT) may call it: the e2e cleanup and the live suites do (mutation: drop the service_role term -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "svcdel");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query("set local role service_role");
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      const { rows: [r] } = await c.query("select public.delete_internal_contacts($1, array[$2]::uuid[]) as d", [a.accountId, id]);
      await c.query("reset role");
      expect(r.d).toEqual([id]);
    }));
});

describe("0103: contact_delete_blockers, one reason at a time", () => {
  it("an outbound text blocks with 'messages' (mutation: delete the 'messages' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bmsg");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await message(c, a.accountId, cv, "sms", "outbound");
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["messages"] }]);
    }));

  it("an inbound email on its conversation blocks with 'inbound_email' (mutation: delete the 'inbound_email' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bmail");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      // The NOT NULL columns of recordInboundEmail's insert (inbound-email.ts:156-163); held, so it has no message.
      await c.query(
        `insert into public.inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, hold_reason, received_at)
         values ($1, $2, $3, 'ana@example.com', 'inbox@example.com', 'held', 'not_on_record', now())`,
        [a.accountId, cv, `re_archive_${RUN}`]);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["inbound_email"] }]);
    }));

  it("a call naming the contact blocks with 'calls' (mutation: delete the 'calls' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bcall");
      const id = await contact(c, a.accountId);
      await call(c, a.accountId, await phoneNumber(c, a.accountId), null, id);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["calls"] }]);
    }));

  it("a call with no contact on the contact's conversation blocks with 'calls' (review M3, 0019:49; mutation: drop the second calls exists, by the contact's conversation -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bcallcv");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await call(c, a.accountId, await phoneNumber(c, a.accountId), cv, null);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["calls"] }]);
    }));

  it("a form submission blocks with 'forms' (mutation: delete the 'forms' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bform");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      // forms.test.ts:312's insert; form_submissions needs account_id and form_id only.
      const { rows: [f] } = await c.query<{ id: string }>(
        "insert into public.forms (account_id, public_id, name) values ($1, $2, 'F') returning id", [a.accountId, `frm_archive_${RUN}`]);
      await c.query("insert into public.form_submissions (account_id, form_id, contact_id) values ($1, $2, $3)", [a.accountId, f!.id, id]);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["forms"] }]);
    }));

  it("a consent event blocks with 'consent' (mutation: delete the 'consent' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bconsent");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      // consent-writes-schema.test.ts:326's shape, with the contact.
      await c.query(
        "insert into public.consent_events (account_id, channel, address, action, method, contact_id) values ($1, 'sms', '+19565550142', 'granted', 'form', $2)",
        [a.accountId, id]);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["consent"] }]);
    }));

  it("a SENT automation blocks with 'automations' and a skipped one does not (mutation: delete the 'automations' exists, or drop `x.status = 'sent'` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bauto");
      const sent = await contact(c, a.accountId, "Sent");
      const skipped = await contact(c, a.accountId, "Skipped");
      await actAsOwner(c);
      // ai-acts-schema.test.ts:607's insert.
      const auto = "insert into public.automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1, 'textback', 'sms', $2, $3, $4)";
      await c.query(auto, [a.accountId, sent, `archive-sent-${RUN}`, "sent"]);
      await c.query(auto, [a.accountId, skipped, `archive-skipped-${RUN}`, "skipped"]);
      expect(await blockers(c, a.accountId, [sent, skipped])).toEqual([{ contact_id: sent, reasons: ["automations"] }]);
    }));

  it("a booking blocks with 'bookings' (mutation: delete the 'bookings' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bbook");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      // booking-cancel-notices-schema.test.ts:53-58's inserts.
      const { rows: [cal] } = await c.query<{ id: string }>(
        "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [a.accountId, `cal_archive_${RUN}`]);
      await c.query(
        `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, status, author_kind)
         values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 1 hour', $4, 'booked', 'person')`,
        [a.accountId, cal!.id, id, `tok_archive_${RUN}`]);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["bookings"] }]);
    }));

  it("a deal blocks with 'deals' (mutation: delete the 'deals' exists -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bdeal");
      const id = await contact(c, a.accountId);
      await deal(c, a.accountId, id);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["deals"] }]);
    }));
});

describe("0103: contact_delete_blockers, the rest", () => {
  it("notes, a To-do, a tag, a place, a note-channel message and an EMPTY conversation block nothing (mutation: treat channel 'note' as a blocker -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bnone");
      const busy = await contact(c, a.accountId, "Busy");
      const empty = await contact(c, a.accountId, "Empty");
      await actAsOwner(c);
      await c.query("insert into public.notes (account_id, contact_id, body) values ($1, $2, 'called twice')", [a.accountId, busy]);
      await c.query("insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'Call back')", [a.accountId, busy]);
      const { rows: [t] } = await c.query<{ id: string }>("insert into public.tags (account_id, name) values ($1, $2) returning id", [a.accountId, `junk-${RUN}`]);
      await c.query("insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3)", [busy, t!.id, a.accountId]);
      // places (0071): one owner and something findable.
      await c.query("insert into public.places (account_id, contact_id, address) values ($1, $2, '1 Main St')", [a.accountId, busy]);
      const cv = await conversation(c, a.accountId, busy);
      await message(c, a.accountId, cv, "note", "outbound");
      // One conversation per contact (0005:24-25), so the empty thread is on a second contact.
      await conversation(c, a.accountId, empty);
      expect(await blockers(c, a.accountId, [busy, empty])).toEqual([]);
    }));

  it("a contact with three reasons is ONE row with all three, and 501 ids are refused 22023 (mutation: return one row per reason -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "bthree");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await message(c, a.accountId, cv, "sms", "outbound");
      await call(c, a.accountId, await phoneNumber(c, a.accountId), null, id);
      await deal(c, a.accountId, id);
      expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["calls", "deals", "messages"] }]);
      // Through refusal(), so the error is caught inside its savepoint and the transaction stays usable (review M7).
      const ids501 = Array.from({ length: 501 }, () => randomUUID());
      await actAsOwner(c);
      await c.query("set local role service_role");
      expect((await refusal(c, "select * from public.contact_delete_blockers($1, $2::uuid[])", [a.accountId, ids501]))?.code).toBe("22023");
      await c.query("reset role");
    }));
});

describe("0103: delete_internal_contacts, what it deletes and what it keeps", () => {
  it("deletes an internal-only contact with its notes, note messages and empty conversations, and returns its id (mutation: skip the note-message delete -> the conversation delete hits messages_conversation_id_fkey, the id is not returned, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "dfree");
      const noted = await contact(c, a.accountId, "Noted");
      const quiet = await contact(c, a.accountId, "Quiet");
      await actAsOwner(c);
      await c.query("insert into public.notes (account_id, contact_id, body) values ($1, $2, 'junk caller')", [a.accountId, noted]);
      await c.query("insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'Ignore')", [a.accountId, noted]);
      const cv = await conversation(c, a.accountId, noted);
      await message(c, a.accountId, cv, "note", "outbound");
      const cvQuiet = await conversation(c, a.accountId, quiet);
      const both = [noted, quiet].sort();
      expect(await deleteAsOwner(c, a, both)).toEqual(both);
      expect(await exists(c, both)).toEqual([]);
      const { rows: [left] } = await c.query(
        `select (select count(*)::int from public.conversations where id = any($1::uuid[])) as convs,
                (select count(*)::int from public.messages where conversation_id = any($1::uuid[])) as msgs,
                (select count(*)::int from public.notes where contact_id = any($2::uuid[])) as notes`, [[cv, cvQuiet], both]);
      expect(left).toEqual({ convs: 0, msgs: 0, notes: 0 });
    }));

  it("keeps a contact that gained a call or a text after the blockers were read, and still deletes the rest of the batch (mutation: drop the in-lock re-check -> the call's contact is deleted, FAILS)", () =>
    withRollback(async (c) => {
      // A late CALL is what only the re-check can keep: calls_contact_id_fkey is ON DELETE SET NULL, so without it
      // the contact goes and the call loses its customer. A late text is also kept, but by messages_conversation_id_fkey
      // (NO ACTION) and the per-contact exception block as well, so it alone could not prove the re-check.
      const a = await seedAccount(c, "dlate");
      const free = await contact(c, a.accountId, "Free");
      const texted = await contact(c, a.accountId, "Texted");
      const called = await contact(c, a.accountId, "Called");
      const all = [free, texted, called];
      expect(await blockers(c, a.accountId, all)).toEqual([]);
      const cv = await conversation(c, a.accountId, texted);
      await message(c, a.accountId, cv, "sms", "outbound");
      await call(c, a.accountId, await phoneNumber(c, a.accountId), null, called);
      expect(await deleteAsOwner(c, a, all)).toEqual([free]);
      expect(await exists(c, all)).toEqual([texted, called].sort());
    }));

  it("a document left behind keeps that one contact and deletes the others (mutation: remove the per-contact exception block -> the whole call errors, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ddoc");
      const doc1 = await contact(c, a.accountId, "Filed");
      const free = await contact(c, a.accountId, "Free");
      await actAsOwner(c);
      // ai-acts-schema.test.ts:653's insert; documents_contact_fkey is NO ACTION.
      await c.query(
        "insert into public.documents (account_id, contact_id, title, category, source, created_by) values ($1, $2, 'Seguro', 'insurance', 'upload', 'user_seed')",
        [a.accountId, doc1]);
      expect(await deleteAsOwner(c, a, [doc1, free])).toEqual([free]);
      expect(await exists(c, [doc1, free])).toEqual([doc1]);
    }));

  it("another account's id passed under account A is neither reported nor deleted (second account; mutation: drop `k.account_id = p_account_id` in delete_internal_contacts -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "dxA");
      const b = await seedAccount(c, "dxB");
      const freeB = await contact(c, b.accountId, "FreeB");
      const textedB = await contact(c, b.accountId, "TextedB");
      const cvB = await conversation(c, b.accountId, textedB);
      await message(c, b.accountId, cvB, "sms", "outbound");
      // The control: under its own account, B's texted contact IS reported.
      expect(await blockers(c, b.accountId, [textedB])).toEqual([{ contact_id: textedB, reasons: ["messages"] }]);
      expect(await blockers(c, a.accountId, [freeB, textedB])).toEqual([]);
      expect(await deleteAsOwner(c, a, [freeB, textedB])).toEqual([]);
      expect(await exists(c, [freeB, textedB])).toEqual([freeB, textedB].sort());
    }));
});

describe("0103: the delete's foreign-key lookups each have an index of their own (production is Postgres 17: no skip scan)", () => {
  it("every single-column foreign key into contacts or conversations has a valid index leading on its column, except three older ones named here (mutation: drop calls_conversation_id -> FAILS naming it)", () =>
    withRollback(async (c) => {
      // A contact delete checks or clears each of these by its column alone (`where col = $1`). On Postgres 17 an
      // index leading on account_id cannot serve that lookup, so it reads the whole table once per deleted row.
      const { rows } = await c.query<{ fk: string }>(
        `select c.conrelid::regclass::text || '.' || a.attname as fk
           from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
          where c.contype = 'f' and c.confrelid in ('public.contacts'::regclass, 'public.conversations'::regclass)
            and pg_catalog.cardinality(c.conkey) = 1
            and not exists (
              select 1 from pg_index i
               where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indisvalid
                 and (i.indpred is null or pg_get_expr(i.indpred, i.indrelid) = '(' || quote_ident(a.attname) || ' IS NOT NULL)'))
          order by 1`);
      // Older than 0103 and outside its brief, reported in its fix round: every contact delete since they were
      // made has read them whole (tasks 0003, contact_duplicate_flags 0033). Small tables today.
      expect(rows.map((r) => r.fk)).toEqual(["contact_duplicate_flags.contact_a", "contact_duplicate_flags.contact_b", "tasks.contact_id"]);
    }));
});

describe("0103: conversations.contact_archived and inbox_visible", () => {
  it("archiving and restoring a contact flips its conversations' contact_archived; inbox_visible stays true while unread > 0 (mutation: drop the sync trigger -> FAILS)", () =>
    withRollback(async (c) => {
      // One conversation per contact (0005_messaging.sql:24-25), so two contacts: one thread with nothing unread
      // (a junk caller's: only our text-back), one with an unread customer text.
      const a = await seedAccount(c, "inbox");
      const quietContact = await contact(c, a.accountId, "Quiet");
      const loudContact = await contact(c, a.accountId, "Loud");
      const quiet = await conversation(c, a.accountId, quietContact);
      const loud = await conversation(c, a.accountId, loudContact);
      await actAsOwner(c);
      await c.query("update public.conversations set unread_count = 2 where id = $1", [loud]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = any($1::uuid[])", [[quietContact, loudContact]]);
      await actAsOwner(c);
      const read = async (id: string) => (await c.query("select contact_archived, inbox_visible from public.conversations where id = $1", [id])).rows[0];
      expect(await read(quiet)).toEqual({ contact_archived: true, inbox_visible: false });
      expect(await read(loud)).toEqual({ contact_archived: true, inbox_visible: true });
      await c.query("set local role service_role");
      await c.query("select public.restore_contact_on_sign($1, $2, 'text')", [a.accountId, quietContact]);
      await c.query("reset role");
      expect(await read(quiet)).toEqual({ contact_archived: false, inbox_visible: true });
    }));

  it("an archived contact's thread comes back to the inbox when a text makes it unread, and leaves again once it is read (the generated column; mutation: inbox_visible as `not contact_archived` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "inbox3");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await actAsOwner(c);
      const read = async () => (await c.query("select contact_archived, inbox_visible from public.conversations where id = $1", [cv])).rows[0];
      expect(await read()).toEqual({ contact_archived: true, inbox_visible: false });
      // The SMS route bumps unread through increment_conversation_unread (server-only-writes-grants.test.ts) as service_role.
      await c.query("set local role service_role");
      await c.query("update public.conversations set unread_count = unread_count + 1 where id = $1", [cv]);
      await c.query("reset role");
      expect(await read()).toEqual({ contact_archived: true, inbox_visible: true });
      await c.query("update public.conversations set unread_count = 0 where id = $1", [cv]);
      expect(await read()).toEqual({ contact_archived: true, inbox_visible: false });
    }));

  it("a conversation created for an archived contact starts archived (mutation: drop the BEFORE INSERT trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "inbox2");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      const cv = await conversation(c, a.accountId, id);
      expect((await c.query("select contact_archived from public.conversations where id = $1", [cv])).rows[0]).toEqual({ contact_archived: true });
    }));

  it("a stale contact_archived heals on the conversation's next update (mutation: trigger only `of contact_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "heal");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await actAsOwner(c);
      // Simulate the race: the contact is archived, the conversation row still says false.
      await c.query("alter table public.conversations disable trigger conversations_contact_archived");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.conversations set contact_archived = false where id = $1", [cv]);
      await c.query("alter table public.conversations enable trigger conversations_contact_archived");
      expect((await c.query("select contact_archived from public.conversations where id = $1", [cv])).rows[0]).toEqual({ contact_archived: false });
      await c.query("update public.conversations set last_message_at = now() where id = $1", [cv]);
      expect((await c.query("select contact_archived from public.conversations where id = $1", [cv])).rows[0]).toEqual({ contact_archived: true });
    }));

  it("authenticated cannot write contact_archived (mutation: grant update (contact_archived) -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        "select has_column_privilege('authenticated', 'public.conversations', 'contact_archived', 'UPDATE') as u");
      expect(p).toEqual({ u: false });
    }));
});
