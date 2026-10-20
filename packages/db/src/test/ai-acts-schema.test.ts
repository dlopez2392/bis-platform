import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRollback, actAs } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import { bookingWasMoved, setBookingStatus, undoOperatorCancel } from "../booking";
import { userDb } from "../user-client";
import { serviceDb } from "../service";

/**
 * 0091 (item 8c, plan Task 1; spec 4.1): one row per act Sofia or the web chat takes live, server-written,
 * read like proposals (members or the agency; a Technician only for a customer they can read). What was
 * acted on never changes; only the undo columns move. Three functions hold each still-safe check and its
 * write in ONE transaction: the booking undo, the contact-created check, and the contact-created delete.
 *
 * RED BEFORE 0091, legitimately, every case except the teardown-order case (which reads account-teardown.ts,
 * edited in the same commit): the table, the functions and the unique key do not exist yet.
 *
 * 0092 (final review I-1) widens what ai_contact_held_by counts as hers by finishCall's own `voice` log row for
 * her call. RED BEFORE 0092, legitimately: the lead-call and skipped-voice cases (the row blocks). Green before
 * 0092 too, and said so: the another-call and held-textback cases (the voice row already blocks them, so before
 * 0092 they pass for the wrong reason; after it they are the mutation guards for the new clause), the grants pin
 * (a non-regression pin: create or replace must keep it) and the FK-pair guard (no FK changes).
 *
 * ONE REFUSED STATEMENT PER withRollback, or a savepoint around it (`attempt`): a refusal otherwise aborts the
 * transaction (25P02). Every function call runs as service_role (`svc`), as the app calls them, unless a case
 * says it runs as the client role.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_aia_${RUN}`;
const ORG_B = `org_aiab_${RUN}`;
const SUB = { owner: `u_aia_owner_${RUN}`, staff: `u_aia_staff_${RUN}`, tech: `u_aia_tech_${RUN}`, tech2: `u_aia_tech2_${RUN}`, ownerB: `u_aia_ownerb_${RUN}` } as const;
type Who = keyof typeof SUB | "agency";
const claims = (p: Who) =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_aia_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

const HOUR = 3_600_000;
// The instant every undo is judged at. Bookings are placed relative to it, never to the database's now().
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000 + 123);
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();
const BY = `user_aia_undoer_${RUN}`;

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
function ins(c: Client, table: string, r: Record<string, unknown>) {
  const cols = Object.keys(r).filter((k) => r[k] !== undefined);
  const vals = cols.map((k) => { const v = r[k]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
  return attempt(c, `insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
}
/** Runs `fn` as service_role (the app's server client), then returns to the owner. */
async function svc<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("reset role");
  }
}
const undoBooking = (c: Client, acct: string, act: string) =>
  svc(c, async () => (await attempt(c, "select public.undo_ai_booking_act($1, $2, $3, $4) as r", [acct, act, BY, NOW.toISOString()])).rows[0]!.r as string);
const heldBy = (c: Client, acct: string, act: string) =>
  svc(c, async () => (await attempt(c, "select public.ai_contact_held_by($1, $2) as r", [acct, act])).rows[0]!.r as string[]);
const undoContact = (c: Client, acct: string, act: string) =>
  svc(c, async () => (await attempt(c, "select public.undo_ai_contact_created($1, $2) as r", [acct, act])).rows[0]!.r as string);

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'AIA Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one(c, "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'AIA B',true) returning id", [agency!.id, ORG_B]);
  const u: Record<string, string> = {};
  for (const k of Object.keys(SUB) as (keyof typeof SUB)[]) u[k] = await one(c, "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (account: string, who: string | null, name: string) =>
    one(c, "insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [account, name, who]);
  const mine = await ct(acct, u.tech!, "Mine");
  const theirs = await ct(acct, u.tech2!, "Theirs");
  const other = await ct(acctB, null, "Other");
  const phone = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, testPhoneNumber()]);
  const phoneB = await one(c, "insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acctB, testPhoneNumber()]);
  const call = (account: string, ph: string, contact: string | null) =>
    one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [account, ph, contact]);
  const calls = { mine: await call(acct, phone, mine), theirs: await call(acct, phone, theirs), other: await call(acctB, phoneB, other) };
  const calendar = await one(c, "insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `cal_aia_${RUN}`]);
  const form = await one(c, "insert into forms (account_id, public_id, name) values ($1,$2,'Chat') returning id", [acct, `pub_aia_${RUN}`]);
  const formB = await one(c, "insert into forms (account_id, public_id, name) values ($1,$2,'Chat') returning id", [acctB, `pub_aiab_${RUN}`]);
  const chat = await one(c, "insert into concierge_conversations (account_id, form_id, ip_hash) values ($1,$2,'iph') returning id", [acct, form]);
  const chatB = await one(c, "insert into concierge_conversations (account_id, form_id, ip_hash) values ($1,$2,'iph') returning id", [acctB, formB]);
  return { acct, acctB, u, mine, theirs, other, phone, calls, calendar, form, chat, chatB };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

/** One valid act on A's Mine from A's Mine call; `over` replaces or adds columns, `undefined` drops one. */
const actRow = (s: Seeded, over: Record<string, unknown> = {}) => ({
  account_id: s.acct, actor: "voice", call_id: s.calls.mine, contact_id: s.mine, kind: "contact_created", target: {}, ...over,
});
const insAct = async (c: Client, r: Record<string, unknown>) => (await ins(c, "ai_acts", r)).rows[0]!.id as string;

let tok = 0;
/** A booking on A's calendar, an hour long, starting `hours` from NOW. */
async function booking(c: Client, s: Seeded, hours: number, o: { status?: string; updatedAt?: string; from?: string; contact?: string } = {}) {
  tok += 1;
  return one(c,
    `insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, status, cancel_token, author_kind, updated_at, rescheduled_from_id)
       values ($1,$2,$3,$4,$5,$6,$7,'ai',$8,$9) returning id`,
    [s.acct, s.calendar, o.contact ?? s.mine, at(hours), at(hours + 1), o.status ?? "booked", `tok_aia_${RUN}_${tok}`,
     o.updatedAt ?? NOW.toISOString(), o.from ?? null]);
}
const bookingRow = async (c: Client, id: string) =>
  (await c.query<{ status: string; updated_at: Date }>("select status, updated_at from bookings where id = $1", [id])).rows[0];
const actUndo = async (c: Client, id: string) =>
  (await c.query<{ undone_at: Date | null; undone_by: string | null }>("select undone_at, undone_by from ai_acts where id = $1", [id])).rows[0];

describe("0091: the table, its grants and who writes (plan Task 1 cases 1-2)", () => {
  it("anon holds nothing; authenticated holds exactly SELECT; service_role holds the table's full set (mutation: grant insert on public.ai_acts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'ai_acts' and grantee <> 'postgres'
           order by grantee, privilege_type`);
      expect(rows).toEqual([
        { grantee: "authenticated", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "DELETE" },
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "REFERENCES" },
        { grantee: "service_role", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "TRIGGER" },
        { grantee: "service_role", privilege_type: "TRUNCATE" },
        { grantee: "service_role", privilege_type: "UPDATE" },
      ]);
    }));

  it("authenticated INSERT is refused by privilege, even for its own account (mutation: grant insert on public.ai_acts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("owner"));
      await expect(ins(c, "ai_acts", actRow(s)))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table ai_acts\b/) });
    }));

  it("authenticated UPDATE is refused by privilege, the undo columns included (mutation: grant update (undone_at, undone_by) on public.ai_acts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await insAct(c, actRow(s));
      await actAs(c, claims("owner"));
      await expect(attempt(c, "update ai_acts set undone_at = now(), undone_by = 'u' where id = $1", [id]))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table ai_acts\b/) });
    }));

  it("authenticated DELETE is refused by privilege (mutation: grant delete on public.ai_acts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await insAct(c, actRow(s));
      await actAs(c, claims("owner"));
      await expect(attempt(c, "delete from ai_acts where id = $1", [id]))
        .rejects.toMatchObject({ code: "42501", message: expect.stringMatching(/permission denied for table ai_acts\b/) });
    }));

  it("service_role inserts, reads, updates the undo columns and deletes", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await svc(c, async () => {
        const id = await insAct(c, actRow(s));
        expect((await c.query("select 1 from ai_acts where id = $1", [id])).rowCount).toBe(1);
        expect((await c.query("update ai_acts set undone_at = now(), undone_by = 'u', undo_notified = true where id = $1", [id])).rowCount).toBe(1);
        expect((await c.query("delete from ai_acts where id = $1", [id])).rowCount).toBe(1);
      });
    }));
});

describe("0091: who reads (plan Task 1 case 1; spec 4.1 RLS)", () => {
  it("Owner and Staff read A's acts, the Technician only Mine's, the agency all, B's Owner only B's own (mutation: drop ai_acts_technician_scope -> tech reads two -> FAILS; member_read using (true) -> B's owner reads A's -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const r = {
        mine: await insAct(c, actRow(s)),
        theirs: await insAct(c, actRow(s, { call_id: s.calls.theirs, contact_id: s.theirs })),
        other: await insAct(c, actRow(s, { account_id: s.acctB, call_id: s.calls.other, contact_id: s.other })),
      };
      const all = [r.mine, r.theirs, r.other];
      const readAs = async (p: Who) => {
        await actAs(c, claims(p));
        const { rows } = await c.query<{ id: string }>("select id from ai_acts where id = any($1::uuid[]) order by id", [all]);
        await c.query("reset role");
        return rows.map((x) => x.id);
      };
      const sorted = (xs: string[]) => [...xs].sort();
      expect(await readAs("owner"), "owner").toEqual(sorted([r.mine, r.theirs]));
      expect(await readAs("staff"), "staff").toEqual(sorted([r.mine, r.theirs]));
      expect(await readAs("tech"), "tech").toEqual([r.mine]);
      expect(await readAs("agency"), "agency").toEqual(sorted(all));
      expect(await readAs("ownerB"), "ownerB").toEqual([r.other]);
    }));

  it("anon is refused outright (mutation: grant select on public.ai_acts to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await insAct(c, actRow(s));
      await c.query("set local role anon");
      await expect(attempt(c, "select id from ai_acts")).rejects.toMatchObject({ code: "42501" });
    }));

  it("the two policies are exactly member_read (permissive SELECT) and technician_scope (restrictive SELECT), for authenticated (mutation: make either FOR ALL or to public -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select policyname, permissive, cmd, roles::text as roles from pg_policies
          where schemaname = 'public' and tablename = 'ai_acts' order by policyname`);
      expect(rows).toEqual([
        { policyname: "ai_acts_member_read", permissive: "PERMISSIVE", cmd: "SELECT", roles: "{authenticated}" },
        { policyname: "ai_acts_technician_scope", permissive: "RESTRICTIVE", cmd: "SELECT", roles: "{authenticated}" },
      ]);
      const { rows: [rls] } = await c.query<{ on: boolean }>("select relrowsecurity as on from pg_class where oid = 'public.ai_acts'::regclass");
      expect(rls!.on).toBe(true);
    }));

  it("the timeline index is (account_id, contact_id, created_at desc, id desc) (mutation: drop it -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>("select indexdef as d from pg_indexes where schemaname = 'public' and indexname = 'ai_acts_contact_timeline'");
      expect(rows.map((r) => r.d)).toEqual([
        "CREATE INDEX ai_acts_contact_timeline ON public.ai_acts USING btree (account_id, contact_id, created_at DESC, id DESC)",
      ]);
    }));
});

describe("0091: what was acted on never changes, from the service role too (plan Task 1 case 3)", () => {
  const FIXED: { col: string; set: string; arg?: "theirs" | "theirCall" | "acctB" | "chat" }[] = [
    { col: "id", set: "id = gen_random_uuid()" },
    { col: "account_id", set: "account_id = $2", arg: "acctB" },
    { col: "actor", set: "actor = 'webchat'" },
    { col: "call_id", set: "call_id = $2", arg: "theirCall" },
    { col: "chat_id", set: "chat_id = $2", arg: "chat" },
    { col: "contact_id", set: "contact_id = $2", arg: "theirs" },
    { col: "kind", set: "kind = 'booking_created'" },
    { col: "target", set: `target = '{"field":"email"}'::jsonb` },
    { col: "before", set: `before = '{"value":null}'::jsonb` },
    { col: "after", set: `after = '{"value":"x"}'::jsonb` },
    { col: "created_at", set: "created_at = created_at - interval '1 day'" },
  ];
  it("the list is every column but the three undo columns (guards the cases below from a forgotten column)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        "select attname as n from pg_attribute where attrelid = 'public.ai_acts'::regclass and attnum > 0 and not attisdropped order by 1");
      expect(rows.map((r) => r.n).sort()).toEqual([...FIXED.map((f) => f.col), "undo_notified", "undone_at", "undone_by"].sort());
    }));
  it.each(FIXED)("refuses a change to $col (mutation: drop the $col comparison from the trigger -> this case FAILS)", ({ set, arg }) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await insAct(c, actRow(s));
      const value = arg === "theirs" ? s.theirs : arg === "theirCall" ? s.calls.theirs : arg === "acctB" ? s.acctB : arg === "chat" ? s.chat : null;
      await svc(c, () => expect(attempt(c, `update ai_acts set ${set} where id = $1`, value === null ? [id] : [id, value]))
        .rejects.toMatchObject({ code: "P0001", message: expect.stringMatching(/ai_acts_act_is_fixed/) }));
    }));
  it("the undo columns move freely", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await insAct(c, actRow(s));
      await svc(c, async () => {
        expect((await c.query("update ai_acts set undone_at = now(), undone_by = 'u' where id = $1", [id])).rowCount).toBe(1);
        expect((await c.query("update ai_acts set undo_notified = true where id = $1", [id])).rowCount).toBe(1);
        expect((await c.query("update ai_acts set undone_at = null, undone_by = null, undo_notified = false where id = $1", [id])).rowCount).toBe(1);
      });
    }));
});

describe("0091: the CHECKs (plan Task 1 case 4)", () => {
  const AT = "2026-10-20T12:00:00Z";
  const CHECKS: [string, string, (s: Seeded) => Record<string, unknown>][] = [
    ["undone_at without undone_by", "ai_acts_undone_pair", () => ({ undone_at: AT })],
    ["undone_by without undone_at", "ai_acts_undone_pair", () => ({ undone_by: "u" })],
    ["undo_notified while not undone", "ai_acts_notified_when_undone", () => ({ undo_notified: true })],
    ["voice with a chat and no call", "ai_acts_source", (s) => ({ call_id: null, chat_id: s.chat })],
    ["voice with no call at all", "ai_acts_source", () => ({ call_id: null })],
    ["webchat with a call and no chat", "ai_acts_source", () => ({ actor: "webchat" })],
    ["webchat with both", "ai_acts_source", (s) => ({ actor: "webchat", chat_id: s.chat })],
    ["actor phone", "ai_acts_actor_check", () => ({ actor: "phone" })],
    ["kind note", "ai_acts_kind_check", () => ({ kind: "note" })],
  ];
  it.each(CHECKS)("refuses %s, by %s (mutation: drop that constraint -> the insert lands -> FAILS)", (_t, name, over) =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, "ai_acts", actRow(s, over(s))))
        .rejects.toMatchObject({ code: "23514", message: expect.stringMatching(new RegExp(`"${name}"`)) });
    }));
  it("refuses a null target and a null contact (23502)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, "ai_acts", actRow(s, { target: null }))).rejects.toMatchObject({ code: "23502", message: expect.stringMatching(/"target"/) });
      await expect(ins(c, "ai_acts", actRow(s, { contact_id: null }))).rejects.toMatchObject({ code: "23502", message: expect.stringMatching(/"contact_id"/) });
    }));
  it("a web-chat act with its chat and no call lands; a notified undone act lands", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await insAct(c, actRow(s, { actor: "webchat", call_id: null, chat_id: s.chat }))).toMatch(/^[0-9a-f-]{36}$/);
      expect(await insAct(c, actRow(s, { undone_at: AT, undone_by: "u", undo_notified: true }))).toMatch(/^[0-9a-f-]{36}$/);
    }));
  it("the kind and actor lists are exactly the plan's (mutation: add 'note' to the kind CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const values = async (name: string) => {
        const { rows } = await c.query<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.ai_acts'::regclass and conname = $1", [name]);
        expect(rows, name).toHaveLength(1);
        return [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort();
      };
      expect(await values("ai_acts_kind_check")).toEqual(
        ["booking_cancelled", "booking_created", "booking_rescheduled", "contact_created", "contact_field_filled"]);
      expect(await values("ai_acts_actor_check")).toEqual(["voice", "webchat"]);
    }));
});

describe("0091: the composite FKs and the cascades (plan Task 1 case 5)", () => {
  it("refuses a call from another account (mutation: FK on call_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, "ai_acts", actRow(s, { call_id: s.calls.other })))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"ai_acts_call_fkey"/) });
    }));
  it("refuses a contact from another account (mutation: FK on contact_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, "ai_acts", actRow(s, { contact_id: s.other })))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"ai_acts_contact_fkey"/) });
    }));
  it("refuses a web chat from another account (mutation: FK on chat_id alone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(ins(c, "ai_acts", actRow(s, { actor: "webchat", call_id: null, chat_id: s.chatB })))
        .rejects.toMatchObject({ code: "23503", message: expect.stringMatching(/"ai_acts_chat_fkey"/) });
    }));
  it("deleting the contact, the call or the web chat deletes its acts, and nothing else (mutation: on delete no action on any -> the delete raises 23503 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      // Each act is reached by exactly one of the three deletes: Theirs's act came from Mine's call, Mine's act
      // from Theirs's call, so deleting a contact never takes its act through the call, nor the reverse.
      const byContact = await insAct(c, actRow(s, { call_id: s.calls.mine, contact_id: s.theirs }));
      const byCall = await insAct(c, actRow(s, { call_id: s.calls.theirs, contact_id: s.mine }));
      const byChat = await insAct(c, actRow(s, { actor: "webchat", call_id: null, chat_id: s.chat }));
      const left = async (id: string) => (await c.query("select 1 from ai_acts where id = $1", [id])).rowCount;
      expect([await left(byContact), await left(byCall), await left(byChat)], "all exist first").toEqual([1, 1, 1]);
      await c.query("delete from contacts where id = $1", [s.theirs]);
      expect([await left(byContact), await left(byCall)], "the contact's act goes; another contact's act from that contact's call stays").toEqual([0, 1]);
      await c.query("delete from calls where id = $1", [s.calls.theirs]);
      expect(await left(byCall), "the call's act").toBe(0);
      expect(await left(byChat), "the chat's act stays while its chat does").toBe(1);
      await c.query("delete from concierge_conversations where id = $1", [s.chat]);
      expect(await left(byChat), "the chat's act").toBe(0);
    }));
  it("concierge_conversations carries the unique (account_id, id) key the chat FK needs (mutation: drop it -> the file fails to apply)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.concierge_conversations'::regclass and conname = 'concierge_conversations_account_id_id_key'");
      expect(rows.map((r) => r.d)).toEqual(["UNIQUE (account_id, id)"]);
    }));
  it("account teardown lists ai_acts before calls, concierge_conversations and contacts (mutation: move it after calls -> FAILS)", () => {
    const at2 = (t: string) => (ACCOUNT_OWNED_TABLES as readonly string[]).indexOf(t);
    expect(at2("ai_acts")).toBeGreaterThanOrEqual(0);
    expect(at2("ai_acts")).toBeLessThan(at2("calls"));
    expect(at2("ai_acts")).toBeLessThan(at2("concierge_conversations"));
    expect(at2("ai_acts")).toBeLessThan(at2("contacts"));
  });
});

describe("0091: undo_ai_booking_act, booking_created (plan Task 1 case 6)", () => {
  const created = (s: Seeded, bookingId: string) =>
    actRow(s, { kind: "booking_created", target: { bookingId }, after: { startsAt: "x", endsAt: "y" } });

  it("a future booked booking is cancelled at p_now and the act is stamped with p_by; a second call answers already_undone (mutation: skip the stamp -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24);
      const act = await insAct(c, created(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("undone");
      expect(await bookingRow(c, b)).toEqual({ status: "cancelled", updated_at: NOW });
      expect(await actUndo(c, act)).toEqual({ undone_at: NOW, undone_by: BY });
      expect(await undoBooking(c, s.acct, act)).toBe("already_undone");
    }));
  it("an already-cancelled booking answers already_cancelled and nothing is stamped", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24, { status: "cancelled" });
      const act = await insAct(c, created(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("already_cancelled");
      expect(await actUndo(c, act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("a started booking answers already_happened and stays booked (mutation: drop starts_at > p_now -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, -0.5);
      const act = await insAct(c, created(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("already_happened");
      expect((await bookingRow(c, b))!.status).toBe("booked");
      expect(await actUndo(c, act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("another account's id with A's act answers gone and touches nothing, while B holds an act of its own (mutation: drop account_id from the act lock -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24);
      const act = await insAct(c, created(s, b));
      await insAct(c, actRow(s, { account_id: s.acctB, call_id: s.calls.other, contact_id: s.other }));
      expect(await undoBooking(c, s.acctB, act)).toBe("gone");
      expect((await bookingRow(c, b))!.status).toBe("booked");
    }));
  it("a booking that no longer exists answers gone", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24);
      const act = await insAct(c, created(s, b));
      await c.query("delete from bookings where id = $1", [b]);
      expect(await undoBooking(c, s.acct, act)).toBe("gone");
    }));
  it("a contact act is refused 22023 (mutation: drop the kind check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const act = await insAct(c, actRow(s));
      await expect(undoBooking(c, s.acct, act)).rejects.toMatchObject({ code: "22023" });
    }));
});

describe("0091: undo_ai_booking_act, booking_cancelled (plan Task 1 case 7)", () => {
  // A1: the version is written exactly as setBookingStatus writes it, a JS ISO string with milliseconds.
  const V = new Date(NOW.getTime() - 60_000).toISOString();
  const cancelled = (s: Seeded, bookingId: string) =>
    actRow(s, { kind: "booking_cancelled", target: { bookingId }, before: { startsAt: "x", endsAt: "y" }, after: { version: V } });

  it("A1: a JS ISO version reads back equal as timestamptz, and the matching version books it again (mutation: compare as text -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24, { status: "cancelled", updatedAt: V });
      const { rows: [eq] } = await c.query<{ same: boolean }>("select updated_at = $2::timestamptz as same from bookings where id = $1", [b, V]);
      expect(eq!.same).toBe(true);
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("undone");
      expect(await bookingRow(c, b)).toEqual({ status: "booked", updated_at: NOW });
      expect(await actUndo(c, act)).toEqual({ undone_at: NOW, undone_by: BY });
    }));
  it("a later updated_at answers changed and writes nothing (mutation: drop updated_at = version -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const later = new Date(new Date(V).getTime() + 1).toISOString();
      const b = await booking(c, s, 24, { status: "cancelled", updatedAt: later });
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("changed");
      expect((await bookingRow(c, b))!.status).toBe("cancelled");
      expect(await actUndo(c, act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("another booked booking overlapping the slot answers time_taken, and nothing is written (mutation: drop the exclusion handler -> 23P01 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24, { status: "cancelled", updatedAt: V });
      await booking(c, s, 24.5, { contact: s.theirs });
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("time_taken");
      expect(await bookingRow(c, b)).toEqual({ status: "cancelled", updated_at: new Date(V) });
      expect(await actUndo(c, act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("a replacement (rescheduled_from_id) answers changed (mutation: drop the not-exists -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24, { status: "cancelled", updatedAt: V });
      await booking(c, s, 48, { from: b });
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("changed");
      expect((await bookingRow(c, b))!.status).toBe("cancelled");
    }));
  it("a start that has passed answers time_passed (mutation: drop starts_at > p_now -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, -2, { status: "cancelled", updatedAt: V });
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("time_passed");
      expect((await bookingRow(c, b))!.status).toBe("cancelled");
    }));
  it("a booking booked again since answers rebooked", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const b = await booking(c, s, 24, { status: "booked", updatedAt: V });
      const act = await insAct(c, cancelled(s, b));
      expect(await undoBooking(c, s.acct, act)).toBe("rebooked");
    }));
});

describe("0091: undo_ai_booking_act, booking_rescheduled (plan Task 1 case 8)", () => {
  const V = new Date(NOW.getTime() - 60_000).toISOString();
  async function pair(c: Client, s: Seeded, o: { oldVersion?: string; newStatus?: string } = {}) {
    const old = await booking(c, s, 24, { status: "cancelled", updatedAt: o.oldVersion ?? V });
    const neu = await booking(c, s, 48, { status: o.newStatus ?? "booked", from: old });
    const act = await insAct(c, actRow(s, {
      kind: "booking_rescheduled", target: { bookingId: neu, fromBookingId: old },
      before: { startsAt: at(24), endsAt: at(25), version: V }, after: { startsAt: at(48), endsAt: at(49) },
    }));
    return { old, neu, act };
  }
  const exists = async (c: Client, id: string) => (await c.query("select 1 from bookings where id = $1", [id])).rowCount;

  it("both untouched: the old booking is booked again, the new row is GONE, the act is stamped, and nothing points at the old one (mutation: cancel the new row instead of deleting it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await pair(c, s);
      expect(await undoBooking(c, s.acct, p.act)).toBe("undone");
      expect(await bookingRow(c, p.old)).toEqual({ status: "booked", updated_at: NOW });
      expect(await exists(c, p.neu), "the new booking").toBe(0);
      expect((await c.query("select 1 from bookings where rescheduled_from_id = $1", [p.old])).rowCount, "a row naming the old one").toBe(0);
      expect(await actUndo(c, p.act)).toEqual({ undone_at: NOW, undone_by: BY });
    }));
  it("the old slot taken by a third booking answers old_time_taken, and the NEW booking is still booked (mutation: move the old restore outside the inner block -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await pair(c, s);
      await booking(c, s, 24.5, { contact: s.theirs });
      expect(await undoBooking(c, s.acct, p.act)).toBe("old_time_taken");
      expect((await bookingRow(c, p.neu))!.status, "the new booking").toBe("booked");
      expect((await bookingRow(c, p.old))!.status, "the old booking").toBe("cancelled");
      expect(await actUndo(c, p.act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("the new booking cancelled meanwhile answers changed (ZA001), and the old one stays cancelled", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await pair(c, s, { newStatus: "cancelled" });
      expect(await undoBooking(c, s.acct, p.act)).toBe("changed");
      expect(await exists(c, p.neu)).toBe(1);
      expect((await bookingRow(c, p.old))!.status).toBe("cancelled");
    }));
  it("the old booking's version moved answers changed (ZA002), and the new booking is NOT deleted (rolled back) (mutation: drop the ZA002 raise -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await pair(c, s, { oldVersion: new Date(new Date(V).getTime() + 1).toISOString() });
      expect(await undoBooking(c, s.acct, p.act)).toBe("changed");
      expect(await exists(c, p.neu), "the new booking").toBe(1);
      expect((await bookingRow(c, p.neu))!.status).toBe("booked");
      expect(await actUndo(c, p.act)).toEqual({ undone_at: null, undone_by: null });
    }));
  it("a newer reschedule of the new booking answers changed and deletes nothing", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await pair(c, s);
      await c.query("update bookings set status = 'cancelled' where id = $1", [p.neu]);
      await booking(c, s, 72, { from: p.neu });
      await c.query("update bookings set status = 'booked' where id = $1", [p.neu]);
      expect(await undoBooking(c, s.acct, p.act)).toBe("changed");
      expect(await exists(c, p.neu)).toBe(1);
    }));

  it("through the replica's PostgREST: after the undo, bookingWasMoved(old) is false, the rescheduling call's booking_id is null, and a person's cancel of the old booking can be undone by undoOperatorCancel, not refused as rescheduled (I-4) (mutation: cancel the new row instead of deleting it -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
        if (r.error || r.data === null) throw new Error(`${what}: ${r.error?.message ?? "no row"}`);
        return r.data;
      };
      const contact = must(await db.from("contacts").insert({ account_id: accountId, first_name: "Ana" }).select("id").single(), "contact") as { id: string };
      const calendar = must(await db.from("calendars").insert({ account_id: accountId, public_id: `cal_aia_pg_${RUN}` }).select("id").single(), "calendar") as { id: string };
      const phone = must(await db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single(), "phone") as { id: string };
      const now = new Date();
      const iso = (h: number) => new Date(now.getTime() + h * HOUR).toISOString();
      const version = new Date(now.getTime() - 60_000).toISOString();
      const row = (h: number, extra: Record<string, unknown>) => ({
        account_id: accountId, calendar_id: calendar.id, contact_id: contact.id, starts_at: iso(h), ends_at: iso(h + 1),
        cancel_token: `tok_aia_pg_${RUN}_${h}`, author_kind: "ai", ...extra,
      });
      const old = must(await db.from("bookings").insert(row(30, { status: "cancelled", updated_at: version })).select("id").single(), "old") as { id: string };
      const neu = must(await db.from("bookings").insert(row(54, { status: "booked", rescheduled_from_id: old.id })).select("id").single(), "new") as { id: string };
      const call = must(await db.from("calls").insert({ account_id: accountId, phone_number_id: phone.id, contact_id: contact.id, booking_id: neu.id }).select("id").single(), "call") as { id: string };
      const act = must(await db.from("ai_acts").insert({
        account_id: accountId, actor: "voice", call_id: call.id, contact_id: contact.id, kind: "booking_rescheduled",
        target: { bookingId: neu.id, fromBookingId: old.id }, before: { startsAt: iso(30), endsAt: iso(31), version },
        after: { startsAt: iso(54), endsAt: iso(55) },
      }).select("id").single(), "act") as { id: string };

      const r = await db.rpc("undo_ai_booking_act", { p_account_id: accountId, p_act_id: act.id, p_by: BY, p_now: now.toISOString() });
      expect(r.error).toBeNull();
      expect(r.data).toBe("undone");
      expect(await bookingWasMoved(db, accountId, old.id)).toBe(false);
      const k = must(await db.from("calls").select("booking_id").eq("id", call.id).single(), "call read") as { booking_id: string | null };
      expect(k.booking_id).toBeNull();

      const { updatedAt } = await setBookingStatus(db, accountId, old.id, "cancelled", BY, "user");
      await expect(undoOperatorCancel(db, accountId, old.id, BY, updatedAt)).resolves.toBeUndefined();
      const o = must(await db.from("bookings").select("status").eq("id", old.id).single(), "old read") as { status: string };
      expect(o.status).toBe("booked");
    }));
});

/** Sofia's clean contact Z in A: her call K, her ai summary in Z's thread, her untouched callback To-do, her sent
 *  text-back, her pending suggestion, her own field act, a duplicate flag, a generated summary, and non-user events. */
async function seedClean(c: Client, s: Seeded) {
  const z = await one(c, "insert into contacts (account_id, first_name) values ($1,'Zoe') returning id", [s.acct]);
  const o = await one(c, "insert into contacts (account_id, first_name) values ($1,'Omar') returning id", [s.acct]);
  const k = await one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [s.acct, s.phone, z]);
  const k2 = await one(c, "insert into calls (account_id, phone_number_id) values ($1,$2) returning id", [s.acct, s.phone]);
  const v = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [s.acct, z]);
  await c.query("update calls set conversation_id = $2 where id = $1", [k, v]);
  const m = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'voice','inbound','Call summary','ai') returning id", [s.acct, v]);
  const task = await one(c, "insert into tasks (account_id, contact_id, title, call_id) values ($1,$2,'Call Zoe back',$3) returning id", [s.acct, z, k]);
  const log = await one(c,
    "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'textback','sms',$2,$3,'sent') returning id",
    [s.acct, z, `call:${k}`]);
  const proposal = await one(c,
    "insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at) values ($1,'call',$2,$3,'task','{}','she asked', now() + interval '30 days') returning id",
    [s.acct, k, z]);
  const [a, b] = [z, o].sort();
  await c.query("insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'test')", [s.acct, a, b]);
  await c.query("insert into record_summaries (account_id, contact_id, language) values ($1,$2,'en')", [s.acct, z]);
  const ev = (type: string, actorType: string, payload: Record<string, string>) =>
    c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,$2,$3,'voice',$4)", [s.acct, type, actorType, JSON.stringify(payload)]);
  await ev("contact.created", "ai", { contactId: z });
  await ev("task.created", "ai", { taskId: task, contactId: z });
  await ev("contact.updated", "system", { contactId: z });
  const act = await insAct(c, actRow(s, { call_id: k, contact_id: z }));
  await insAct(c, actRow(s, { call_id: k, contact_id: z, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "z@example.com" } }));
  return { z, o, k, k2, v, m, task, log, proposal, act };
}
type Clean = Awaited<ReturnType<typeof seedClean>>;

let blockerSeq = 0;
/** One row that is NOT Sofia's, per table in the plan's "otherwise" column, plus the edits backstop. */
const BLOCKERS: [string, string, (c: Client, s: Seeded, z: Clean) => Promise<unknown>][] = [
  ["another call", "calls", (c, s, z) => c.query("insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3)", [s.acct, s.phone, z.z])],
  ["a person's To-do", "tasks", (c, s, z) => c.query("insert into tasks (account_id, contact_id, title) values ($1,$2,'Quote')", [s.acct, z.z])],
  ["the customer's text", "messages", (c, s, z) => c.query("insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'sms','inbound','hola','customer')", [s.acct, z.v])],
  ["an inbound email", "inbound_emails", (c, s, z) => c.query(
    "insert into inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, received_at) values ($1,$2,$3,'z@example.com','r@example.com','filed',now())",
    [s.acct, z.v, `pe_aia_${RUN}_${++blockerSeq}`])],
  ["a form submission", "form_submissions", (c, s, z) => c.query("insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3)", [s.acct, s.form, z.z])],
  ["a reminder's log row", "automation_log", (c, s, z) => c.query(
    "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'sms_reminder','sms',$2,$3,'sent')", [s.acct, z.z, `booking:aia-${RUN}`])],
  ["an act from another call", "ai_acts", (c, s, z) => insAct(c, actRow(s, { call_id: z.k2, contact_id: z.z, kind: "contact_field_filled", target: { field: "phone" }, before: { value: null }, after: { value: "+1" } }))],
  ["a suggestion from another call", "proposals", (c, s, z) => c.query(
    "insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at) values ($1,'call',$2,$3,'task','{}','x', now() + interval '30 days')", [s.acct, z.k2, z.z])],
  ["a booking", "bookings", (c, s, z) => booking(c, s, 100, { contact: z.z, status: "cancelled" })],
  ["a deal", "opportunities", async (c, s, z) => {
    const p = await one(c, "insert into pipelines (account_id, name) values ($1,'Sales') returning id", [s.acct]);
    const st = await one(c, "insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [s.acct, p]);
    await c.query("insert into opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1,$2,$3,$4,'Roof')", [s.acct, z.z, p, st]);
  }],
  ["a note", "notes", (c, s, z) => c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'Prefers mornings')", [s.acct, z.z])],
  ["a tag", "contact_tags", async (c, s, z) => {
    const t = await one(c, "insert into tags (account_id, name) values ($1,$2) returning id", [s.acct, `vip-${RUN}`]);
    await c.query("insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [z.z, t, s.acct]);
  }],
  ["a document", "documents", (c, s, z) => c.query(
    "insert into documents (account_id, contact_id, title, category, source, created_by) values ($1,$2,'Seguro','insurance','upload','user_seed')", [s.acct, z.z])],
  ["a document request", "document_requests", (c, s, z) => c.query(
    `insert into document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at)
       values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', md5($4) || md5($4 || 'b'), 'link', 'user_x', now() + interval '7 days')`,
    [s.acct, z.z, JSON.stringify([{ key: "insurance", category: "insurance", note: null }]), `${RUN}-${++blockerSeq}`])],
  ["a skipped requirement", "document_requirement_skips", (c, s, z) => c.query(
    "insert into document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1,$2,'insurance','user_x')", [s.acct, z.z])],
  ["a place", "places", (c, s, z) => c.query("insert into places (account_id, contact_id, address) values ($1,$2,'1 Main St')", [s.acct, z.z])],
  ["a relationship from her", "contact_relationships", (c, s, z) => c.query(
    "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'sibling')", [s.acct, z.z, z.o])],
  ["a relationship to her", "contact_relationships", (c, s, z) => c.query(
    "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'sibling')", [s.acct, z.o, z.z])],
  ["a household", "client_group_members", async (c, s, z) => {
    const g = await one(c, "insert into client_groups (account_id, kind, name) values ($1,'household','Lopez') returning id", [s.acct]);
    await c.query("insert into client_group_members (account_id, client_group_id, contact_id) values ($1,$2,$3)", [s.acct, g, z.z]);
  }],
  ["a consent row", "consent_events", (c, s, z) => c.query(
    "insert into consent_events (account_id, channel, address, action, method, contact_id) values ($1,'sms','+19565550142','revoked','keyword',$2)", [s.acct, z.z])],
  ["a person's edit (contact.updated by a user)", "edits", (c, s, z) => c.query(
    "insert into events (account_id, type, actor_type, actor_id, payload) values ($1,'contact.updated','user','user_x',$2)", [s.acct, JSON.stringify({ contactId: z.z })])],
];

describe("0091: ai_contact_held_by, table by table (plan Task 1 case 9)", () => {
  it("her own call, summary, untouched callback To-do, sent text-back, pending suggestion, own acts, duplicate flag and summary answer {} (mutation: drop the ai-message clause -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      expect(await heldBy(c, s.acct, z.act)).toEqual([]);
    }));

  it("every table in the list has exactly one blocker case below, and the list is every FK into contacts but the two that never block (guards the cases from a forgotten table)", () => {
    const named = new Set(BLOCKERS.map((b) => b[1]));
    named.delete("edits");
    // conversations' blockers are what its rows hold: a message or an inbound email (the conversation itself is
    // deleted with her contact).
    named.delete("messages");
    named.delete("inbound_emails");
    named.add("conversations");
    expect([...named, "contact_duplicate_flags", "record_summaries"].sort()).toEqual([...FK_TABLES].sort());
  });

  it.each(BLOCKERS)("%s answers exactly {%s} (mutation: drop that table's clause -> FAILS)", (_t, name, add) =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await add(c, s, z);
      expect(await heldBy(c, s.acct, z.act)).toEqual([name]);
    }));

  it("I-2: her callback To-do once completed, once assigned, or named by a person's task.reopened answers {tasks} (mutation: drop completed_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await c.query("savepoint i2");
      await c.query("update tasks set completed_at = now() where id = $1", [z.task]);
      expect(await heldBy(c, s.acct, z.act), "completed").toEqual(["tasks"]);
      await c.query("rollback to savepoint i2");
      await c.query("update tasks set assigned_to = $2 where id = $1", [z.task, s.u.staff]);
      expect(await heldBy(c, s.acct, z.act), "assigned").toEqual(["tasks"]);
      await c.query("rollback to savepoint i2");
      await c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,'task.reopened','user','user_x',$2)", [s.acct, JSON.stringify({ taskId: z.task })]);
      expect(await heldBy(c, s.acct, z.act), "reopened by a person").toEqual(["tasks"]);
      await c.query("rollback to savepoint i2");
      await c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,'task.reopened','system','x',$2)", [s.acct, JSON.stringify({ taskId: z.task })]);
      expect(await heldBy(c, s.acct, z.act), "reopened by the system").toEqual([]);
    }));

  it("I-2: her suggestion once accepted answers {proposals}, while expired answers {} (mutation: status in ('pending','expired','accepted') -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await c.query("savepoint i2");
      await c.query("update proposals set status = 'accepted', decided_at = now(), decided_by = 'user_x', applied_payload = payload where id = $1", [z.proposal]);
      expect(await heldBy(c, s.acct, z.act), "accepted").toEqual(["proposals"]);
      await c.query("rollback to savepoint i2");
      await c.query("update proposals set status = 'expired', decided_at = now(), decided_by = 'system', expired_reason = 'aged' where id = $1", [z.proposal]);
      expect(await heldBy(c, s.acct, z.act), "expired").toEqual([]);
    }));

  it("I-3: her text-back held for the morning answers {automation_log} (mutation: add 'held' to the status list -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await c.query("update automation_log set status = 'held', held_until = now() + interval '8 hours' where id = $1", [z.log]);
      expect(await heldBy(c, s.acct, z.act)).toEqual(["automation_log"]);
    }));

  it("a web-chat act: its own submission and its messageId message answer {}; a second submission answers {form_submissions}; any call answers {calls} (mutation: drop the messageId clause -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const w = await one(c, "insert into contacts (account_id, first_name) values ($1,'Wen') returning id", [s.acct]);
      const sub = await one(c, "insert into form_submissions (account_id, form_id, contact_id, author_kind) values ($1,$2,$3,'ai') returning id", [s.acct, s.form, w]);
      const v = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [s.acct, w]);
      const m = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'form','inbound','New lead','customer') returning id", [s.acct, v]);
      const chatRow = { actor: "webchat", call_id: null, chat_id: s.chat, contact_id: w };
      const act = await insAct(c, actRow(s, { ...chatRow, target: { messageId: m, submissionId: sub } }));
      await insAct(c, actRow(s, { ...chatRow, kind: "contact_field_filled", target: { field: "email" }, before: { value: null }, after: { value: "w@example.com" } }));
      await c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,'contact.created','system','form',$2)", [s.acct, JSON.stringify({ contactId: w })]);
      expect(await heldBy(c, s.acct, act), "clean").toEqual([]);
      await c.query("savepoint w");
      await c.query("insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3)", [s.acct, s.form, w]);
      expect(await heldBy(c, s.acct, act), "a second submission").toEqual(["form_submissions"]);
      await c.query("rollback to savepoint w");
      await c.query("insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3)", [s.acct, s.phone, w]);
      expect(await heldBy(c, s.acct, act), "a call").toEqual(["calls"]);
    }));

  it("the check reads every account: a crossed note (another account's row on her contact, which the delete would cascade) answers {notes} (mutation: scope the notes clause by account_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'crossed')", [s.acctB, z.z]);
      expect(await heldBy(c, s.acct, z.act)).toEqual(["notes"]);
    }));

  it("several blockers are all named, in the list's order", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'n')", [s.acct, z.z]);
      await booking(c, s, 120, { contact: z.z });
      await c.query("insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3)", [s.acct, s.phone, z.z]);
      expect(await heldBy(c, s.acct, z.act)).toEqual(["calls", "bookings", "notes"]);
    }));

  it("another account's id with A's act raises 22023, and so does a booking act (mutation: drop account_id from the act read -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await insAct(c, actRow(s, { account_id: s.acctB, call_id: s.calls.other, contact_id: s.other }));
      await expect(heldBy(c, s.acctB, z.act)).rejects.toMatchObject({ code: "22023" });
      const b = await booking(c, s, 130);
      const bAct = await insAct(c, actRow(s, { kind: "booking_created", target: { bookingId: b }, after: { startsAt: "x", endsAt: "y" } }));
      await expect(heldBy(c, s.acct, bAct)).rejects.toMatchObject({ code: "22023" });
    }));

  it("I-1: as the client role (an Owner's claims, as PostgREST sets them), the clean contact answers {} and a note answers {notes}, with no 42501 (mutation: read concierge_conversations in the function -> 42501 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await actAs(c, claims("owner"));
      const asClient = async () => (await attempt(c, "select public.ai_contact_held_by($1, $2) as r", [s.acct, z.act])).rows[0]!.r as string[];
      expect(await asClient(), "clean").toEqual([]);
      await c.query("reset role");
      await c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'n')", [s.acct, z.z]);
      await actAs(c, claims("owner"));
      expect(await asClient(), "with a note").toEqual(["notes"]);
    }));

  // The same two answers through the replica's real PostgREST with a signed Owner token. It needs the replica's
  // JWT secret, which only a local run has (CI's stack never exposes its own): without it the case is SKIPPED, and
  // a skip is not a pass. The always-run case above holds the same property at the SQL level.
  const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
  it.skipIf(!SECRET)("I-1 through PostgREST: an Owner's signed token gets {} for the clean contact and {notes} with a note, never 42501 (mutation: read concierge_conversations in the function -> FAILS)", async () => {
    const sub = `u_aia_pg_owner_${RUN}`;
    const svcDb = serviceDb();
    const userRow = await svcDb.from("users").insert({ clerk_user_id: sub, email: `${sub}@example.com` }).select("id").single();
    if (userRow.error) throw new Error(userRow.error.message);
    try {
      await withTestAccount(async (db, accountId) => {
        const must = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) => {
          const r = await q;
          if (r.error) throw new Error(`${what}: ${r.error.message}`);
          return r.data as { id: string };
        };
        const { data: acct, error } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId).select("clerk_org_id").single();
        if (error) throw new Error(error.message);
        await must(db.from("memberships").insert({ user_id: (userRow.data as { id: string }).id, scope: "account", account_id: accountId, role: "owner" }).select("id").single(), "membership");
        const z = await must(db.from("contacts").insert({ account_id: accountId, first_name: "Zoe" }).select("id").single(), "contact");
        const ph = await must(db.from("phone_numbers").insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single(), "phone");
        const k = await must(db.from("calls").insert({ account_id: accountId, phone_number_id: ph.id, contact_id: z.id }).select("id").single(), "call");
        const v = await must(db.from("conversations").insert({ account_id: accountId, contact_id: z.id }).select("id").single(), "conversation");
        await must(db.from("messages").insert({ account_id: accountId, conversation_id: v.id, channel: "voice", direction: "inbound", body: "Call summary", author_kind: "ai" }).select("id").single(), "message");
        await must(db.from("tasks").insert({ account_id: accountId, contact_id: z.id, title: "Call back", call_id: k.id }).select("id").single(), "task");
        const act = await must(db.from("ai_acts").insert({ account_id: accountId, actor: "voice", call_id: k.id, contact_id: z.id, kind: "contact_created", target: {} }).select("id").single(), "act");
        const token = signJwt({ role: "authenticated", org_id: (acct as { clerk_org_id: string }).clerk_org_id, sub, exp: Math.floor(Date.now() / 1000) + 600 }, SECRET!);
        const user: SupabaseClient = userDb(token);
        const clean = await user.rpc("ai_contact_held_by", { p_account_id: accountId, p_act_id: act.id });
        expect(clean.error).toBeNull();
        expect(clean.data).toEqual([]);
        await must(db.from("notes").insert({ account_id: accountId, contact_id: z.id, body: "n" }).select("id").single(), "note");
        const noted = await user.rpc("ai_contact_held_by", { p_account_id: accountId, p_act_id: act.id });
        expect(noted.error).toBeNull();
        expect(noted.data).toEqual(["notes"]);
      });
    } finally {
      const { error } = await svcDb.from("users").delete().eq("clerk_user_id", sub);
      if (error) throw new Error(`users cleanup failed: ${error.message}`);
    }
  });

  // Pairs, not distinct tables (0092 review): a second FK on a table already listed (a third contact column on
  // contact_relationships, say) is a new way to hold a contact that the function's clause for that table may not
  // read, and a distinct-table compare could never see it.
  it("the guard: the foreign keys into contacts are exactly the typed list of 22 (table, constraint) pairs, two each on contact_duplicate_flags and contact_relationships (mutation: a second FK into contacts on notes -> FAILS naming it)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ t: string; n: string }>(
        "select conrelid::regclass::text as t, conname as n from pg_constraint where confrelid = 'public.contacts'::regclass and contype = 'f'");
      expect(rows.map((r) => `${r.t.replace(/^public\./, "")} ${r.n}`).sort()).toEqual([...FK_PAIRS].sort());
      expect(FK_PAIRS).toHaveLength(22);
      expect([...new Set(FK_PAIRS.map((p) => p.split(" ")[0]))].sort()).toEqual([...FK_TABLES].sort());
    }));
});

/** Every foreign key into public.contacts after 0091, as "table constraint" (pg_constraint, re-read on the replica). */
const FK_PAIRS = [
  "ai_acts ai_acts_contact_fkey", "automation_log automation_log_contact_id_fkey", "bookings bookings_contact_id_fkey",
  "calls calls_contact_id_fkey", "client_group_members client_group_members_contact_fkey",
  "consent_events consent_events_contact_fkey",
  "contact_duplicate_flags contact_duplicate_flags_contact_a_fkey", "contact_duplicate_flags contact_duplicate_flags_contact_b_fkey",
  "contact_relationships contact_relationships_contact_fkey", "contact_relationships contact_relationships_related_fkey",
  "contact_tags contact_tags_contact_id_fkey", "conversations conversations_contact_id_fkey",
  "document_requests document_requests_contact_fkey", "document_requirement_skips document_requirement_skips_contact_fkey",
  "documents documents_contact_fkey", "form_submissions form_submissions_contact_id_fkey", "notes notes_contact_id_fkey",
  "opportunities opportunities_contact_id_fkey", "places places_contact_fkey", "proposals proposals_contact_fkey",
  "record_summaries record_summaries_contact_fkey", "tasks tasks_contact_id_fkey",
] as const;
/** The 20 distinct tables those keys sit on. */
const FK_TABLES = [
  "ai_acts", "automation_log", "bookings", "calls", "client_group_members", "consent_events", "contact_duplicate_flags",
  "contact_relationships", "contact_tags", "conversations", "document_requests", "document_requirement_skips", "documents",
  "form_submissions", "notes", "opportunities", "places", "proposals", "record_summaries", "tasks",
] as const;

/** Exactly what a lead call leaves on the contact Sofia made from it (finish-call.ts): the call, linked to her
 *  thread; her AI call summary in that thread; her open, unassigned callback To-do; the missed-call text-back,
 *  sent; finishCall's own `voice` log row for the call (source voice, channel ai, subject call:<id>, the contact,
 *  :694-704); her pending suggestion; the ai contact.created and task.created events; and her contact_created act. */
async function seedLeadCall(c: Client, s: Seeded) {
  const z = await one(c, "insert into contacts (account_id, first_name, author_kind) values ($1,'Caller','ai') returning id", [s.acct]);
  const k = await one(c, "insert into calls (account_id, phone_number_id, contact_id) values ($1,$2,$3) returning id", [s.acct, s.phone, z]);
  const v = await one(c, "insert into conversations (account_id, contact_id) values ($1,$2) returning id", [s.acct, z]);
  await c.query("update calls set conversation_id = $2 where id = $1", [k, v]);
  const m = await one(c, "insert into messages (account_id, conversation_id, channel, direction, body, author_kind) values ($1,$2,'voice','inbound','Call summary','ai') returning id", [s.acct, v]);
  const task = await one(c, "insert into tasks (account_id, contact_id, title, call_id) values ($1,$2,'Call back',$3) returning id", [s.acct, z, k]);
  const textback = await one(c,
    "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'textback','sms',$2,$3,'sent') returning id",
    [s.acct, z, `call:${k}`]);
  const voiceLog = await one(c,
    "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'voice','ai',$2,$3,'sent') returning id",
    [s.acct, z, `call:${k}`]);
  const proposal = await one(c,
    "insert into proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at) values ($1,'call',$2,$3,'task','{}','she asked', now() + interval '30 days') returning id",
    [s.acct, k, z]);
  const ev = (type: string, payload: Record<string, string>) =>
    c.query("insert into events (account_id, type, actor_type, actor_id, payload) values ($1,$2,'ai','voice',$3)", [s.acct, type, JSON.stringify(payload)]);
  await ev("contact.created", { contactId: z });
  await ev("task.created", { taskId: task, contactId: z });
  const act = await insAct(c, actRow(s, { call_id: k, contact_id: z }));
  return { z, k, v, m, task, textback, voiceLog, proposal, act };
}

describe("0092: finishCall's own voice log row for her call is hers (final review I-1)", () => {
  it("a real lead call answers {} and undo deletes the contact; the call and both log rows stay, unlinked (mutation: drop 0092's voice clause -> {automation_log} / has_activity -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedLeadCall(c, s);
      expect(await heldBy(c, s.acct, z.act), "held_by").toEqual([]);
      expect(await undoContact(c, s.acct, z.act), "undo").toBe("deleted");
      expect((await c.query("select 1 from contacts where id = $1", [z.z])).rowCount, "the contact").toBe(0);
      const { rows: [k] } = await c.query("select contact_id, conversation_id from calls where id = $1", [z.k]);
      expect(k, "the call stays, unlinked").toEqual({ contact_id: null, conversation_id: null });
      const { rows: logs } = await c.query("select id, contact_id from automation_log where id = any($1::uuid[]) order by source",
        [[z.textback, z.voiceLog]]);
      expect(logs, "both log rows stay, unlinked").toEqual([{ id: z.textback, contact_id: null }, { id: z.voiceLog, contact_id: null }]);
    }));

  it("a hang-up's skipped voice row for her call is hers too (any status) (mutation: voice clause limited to status sent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedLeadCall(c, s);
      await c.query("update automation_log set status = 'skipped', reason = 'The caller hung up' where id = $1", [z.voiceLog]);
      expect(await heldBy(c, s.acct, z.act)).toEqual([]);
    }));

  it("a voice log row for ANOTHER call on the same contact answers {automation_log} (mutation: match source = 'voice' without the call's subject key -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedLeadCall(c, s);
      const k2 = await one(c, "insert into calls (account_id, phone_number_id) values ($1,$2) returning id", [s.acct, s.phone]);
      await c.query("insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'voice','ai',$2,$3,'sent')",
        [s.acct, z.z, `call:${k2}`]);
      expect(await heldBy(c, s.acct, z.act), "held_by").toEqual(["automation_log"]);
      expect(await undoContact(c, s.acct, z.act), "undo").toBe("has_activity");
    }));

  it("a textback-source row under her call's voice-shaped key is still judged by the textback rule: held answers {automation_log} (mutation: voice clause without source = 'voice' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedLeadCall(c, s);
      await c.query("update automation_log set status = 'held', held_until = now() + interval '8 hours' where id = $1", [z.textback]);
      expect(await heldBy(c, s.acct, z.act)).toEqual(["automation_log"]);
    }));

  // A non-regression pin, green before 0092 too: create or replace keeps the oid, so the grants, the owner and the
  // settings must come through unchanged. The owner's own entry is read by role, not by name (the CLI stack's
  // migration role may differ from the replica's).
  it("ai_contact_held_by keeps its grants, settings and invoker rights through 0092: execute for exactly the owner, authenticated and service_role, none grantable (mutation: 0092 as drop + create without the grants -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ who: string; priv: string; g: boolean }>(
        `select case when a.grantee = p.proowner then 'owner' when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as who,
                a.privilege_type as priv, a.is_grantable as g
           from pg_proc p cross join lateral aclexplode(p.proacl) a
          where p.oid = 'public.ai_contact_held_by(uuid, uuid)'::regprocedure order by 1, 2`);
      expect(rows.map((r) => `${r.who} ${r.priv} ${r.g}`)).toEqual(["authenticated EXECUTE false", "owner EXECUTE false", "service_role EXECUTE false"]);
      const { rows: [f] } = await c.query(
        "select prosecdef, proconfig, provolatile, prorettype::regtype::text as ret from pg_proc where oid = 'public.ai_contact_held_by(uuid, uuid)'::regprocedure");
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'], provolatile: "s", ret: "text[]" });
    }));
});

describe("0091: undo_ai_contact_created (plan Task 1 case 10)", () => {
  it("the clean contact is deleted with her thread, her To-do, her suggestion and her acts; the call stays, unlinked; Omar stays (mutation: delete the contact before the messages -> 23503 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      expect(await undoContact(c, s.acct, z.act)).toBe("deleted");
      const n = async (sql: string, id: string) => (await c.query(sql, [id])).rowCount;
      expect({
        contact: await n("select 1 from contacts where id = $1", z.z),
        conversation: await n("select 1 from conversations where id = $1", z.v),
        message: await n("select 1 from messages where id = $1", z.m),
        task: await n("select 1 from tasks where id = $1", z.task),
        proposal: await n("select 1 from proposals where id = $1", z.proposal),
        acts: await n("select 1 from ai_acts where contact_id = $1", z.z),
        summary: await n("select 1 from record_summaries where contact_id = $1", z.z),
        flags: await n("select 1 from contact_duplicate_flags where contact_a = $1 or contact_b = $1", z.z),
        omar: await n("select 1 from contacts where id = $1", z.o),
      }).toEqual({ contact: 0, conversation: 0, message: 0, task: 0, proposal: 0, acts: 0, summary: 0, flags: 0, omar: 1 });
      const { rows: [k] } = await c.query("select contact_id, conversation_id from calls where id = $1", [z.k]);
      expect(k).toEqual({ contact_id: null, conversation_id: null });
      const { rows: [l] } = await c.query("select contact_id from automation_log where id = $1", [z.log]);
      expect(l).toEqual({ contact_id: null });
    }));
  it("with a note: has_activity, and nothing is deleted (mutation: skip statement 2's check -> the note is gone -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      const note = await one(c, "insert into notes (account_id, contact_id, body) values ($1,$2,'n') returning id", [s.acct, z.z]);
      expect(await undoContact(c, s.acct, z.act)).toBe("has_activity");
      expect((await c.query("select 1 from notes where id = $1", [note])).rowCount, "the note").toBe(1);
      expect((await c.query("select 1 from contacts where id = $1", [z.z])).rowCount, "the contact").toBe(1);
      expect((await c.query("select 1 from messages where id = $1", [z.m])).rowCount, "her message").toBe(1);
    }));
  it("with a booking, even a cancelled one: has_booking, and nothing is deleted (owner Q4) (mutation: answer has_activity for every non-empty set -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      await booking(c, s, 140, { contact: z.z, status: "cancelled" });
      await c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'n')", [s.acct, z.z]);
      expect(await undoContact(c, s.acct, z.act)).toBe("has_booking");
      expect((await c.query("select 1 from contacts where id = $1", [z.z])).rowCount).toBe(1);
    }));
  it("a second call answers gone; another account's id answers gone; a booking act raises 22023", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const z = await seedClean(c, s);
      expect(await undoContact(c, s.acctB, z.act), "B's id").toBe("gone");
      expect((await c.query("select 1 from contacts where id = $1", [z.z])).rowCount, "untouched by B's call").toBe(1);
      expect(await undoContact(c, s.acct, z.act)).toBe("deleted");
      expect(await undoContact(c, s.acct, z.act), "second call").toBe("gone");
      const b = await booking(c, s, 150);
      const bAct = await insAct(c, actRow(s, { kind: "booking_created", target: { bookingId: b }, after: { startsAt: "x", endsAt: "y" } }));
      await expect(undoContact(c, s.acct, bAct)).rejects.toMatchObject({ code: "22023" });
    }));
});

describe("0091: function grants and settings (plan Task 1 case 11)", () => {
  it("the two undo functions are service_role only; ai_contact_held_by is also the client role's; anon runs none (mutation: grant execute on undo_ai_contact_created to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ f: string; r: string; x: boolean }>(
        `select f, r, has_function_privilege(r, f, 'EXECUTE') as x
           from unnest(array['public.undo_ai_booking_act(uuid, uuid, text, timestamptz)', 'public.ai_contact_held_by(uuid, uuid)',
                             'public.undo_ai_contact_created(uuid, uuid)']) f
          cross join unnest(array['anon', 'authenticated', 'service_role']) r order by f, r`);
      expect(rows.map((x) => `${x.f.replace(/^public\.|\(.*$/g, "")} ${x.r} ${x.x}`)).toEqual([
        "ai_contact_held_by anon false", "ai_contact_held_by authenticated true", "ai_contact_held_by service_role true",
        "undo_ai_booking_act anon false", "undo_ai_booking_act authenticated false", "undo_ai_booking_act service_role true",
        "undo_ai_contact_created anon false", "undo_ai_contact_created authenticated false", "undo_ai_contact_created service_role true",
      ]);
    }));
  it("all three are security invoker with search_path '' ; held_by is stable, the undos volatile (mutation: security definer on any -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select proname, prosecdef, proconfig, provolatile from pg_proc
          where pronamespace = 'public'::regnamespace and proname in ('undo_ai_booking_act', 'ai_contact_held_by', 'undo_ai_contact_created')
          order by proname`);
      expect(rows).toEqual([
        { proname: "ai_contact_held_by", prosecdef: false, proconfig: ['search_path=""'], provolatile: "s" },
        { proname: "undo_ai_booking_act", prosecdef: false, proconfig: ['search_path=""'], provolatile: "v" },
        { proname: "undo_ai_contact_created", prosecdef: false, proconfig: ['search_path=""'], provolatile: "v" },
      ]);
    }));
  it("PUBLIC holds execute on none of them (mutation: drop public from a revoke -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ proname: string; pub: boolean }>(
        `select proname, coalesce(bool_or(a.grantee = 0), false) as pub
           from pg_proc p left join lateral aclexplode(p.proacl) a on true
          where pronamespace = 'public'::regnamespace and proname in ('undo_ai_booking_act', 'ai_contact_held_by', 'undo_ai_contact_created')
          group by proname order by proname`);
      expect(rows).toEqual([
        { proname: "ai_contact_held_by", pub: false }, { proname: "undo_ai_booking_act", pub: false }, { proname: "undo_ai_contact_created", pub: false },
      ]);
    }));
});

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const b64 = (b: Buffer) => b.toString("base64url");
  const head = b64(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64(Buffer.from(JSON.stringify(payload)));
  return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}
