import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { Client as Pg } from "pg";
import "dotenv/config";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0106 part B: public.merge_contacts, public.undo_contact_merge, public.contact_merge_preview, app.merge_fields_of and
 * the follow_merge backstop (plan Task 3; spec 4.4, 4.5, 5.2, 5.3, 7.2, 7.3 and the plan-review fixes I1, I2, m3, m6,
 * m8). Replica only: every case is withRollback except the race, which COMMITS and so runs only against a database
 * on this machine (onThisMachine below).
 *
 * RED BEFORE PART B, legitimately: every case, because each calls a part B function or asserts a part B trigger. The
 * catalogue guards (the foreign-key coverage and the follow_merge triggers) fail on part A too: there is no
 * merge_contacts to parse and no trigger to find.
 *
 * Each case seeds a keep K and an other O that share nothing but what the case needs. One refused statement per
 * transaction, or a savepoint around it (`refusal`).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };
type J = Record<string, unknown>;

/** contact-dedupe-schema.test.ts's helpers (T1; files stay disjoint). */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_merge_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Merge') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Merge test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
type P = { first?: string | null; last?: string | null; phone?: string | null; email?: string | null };
async function person(c: Client, accountId: string, p: P = {}): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, last_name, phone, email, author_kind) values ($1, $2, $3, $4, $5, 'person') returning id",
    [accountId, p.first ?? null, p.last ?? null, p.phone ?? null, p.email ?? null]);
  return r!.id;
}
async function tombstone(c: Client, accountId: string, id: string, into: string) {
  await actAsOwner(c);
  await c.query("update public.contacts set merged_into = $3, merged_at = now() where account_id = $1 and id = $2", [accountId, id, into]);
}
async function member(c: Client, a: Acct, role: "owner" | "staff" | "technician") {
  await actAsOwner(c);
  const sub = await actAsMember(c, a.accountId, a.orgId, role);
  await actAsOwner(c);
  const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
  return { sub, userId: u!.id };
}
const signIn = (c: Client, a: Acct, sub: string) => actAs(c, { org_id: a.orgId, sub });
async function asService(c: Client) {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
}
async function flagOf(c: Client, accountId: string, x: string, y: string) {
  await actAsOwner(c);
  const { rows } = await c.query<{ id: string; reason: string; dismissed: boolean; merge_id: string | null }>(
    `select id, reason, dismissed_at is not null as dismissed, merge_id::text as merge_id from public.contact_duplicate_flags
      where account_id = $1 and contact_a = least($2::uuid, $3::uuid) and contact_b = greatest($2::uuid, $3::uuid)`, [accountId, x, y]);
  return rows[0] ?? null;
}

/** As the owner: one row's id, as text. */
async function one(c: Client, sql: string, params: unknown[]): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(sql, params);
  return String(r!.id);
}
async function val<T = unknown>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ v: T }>(sql, params);
  return r!.v;
}
let seq = 0;
const hex24 = () => (RUN + (++seq).toString(16).padStart(8, "0")).replace(/[^0-9a-f]/g, "0").padEnd(24, "0").slice(0, 24);
const phones = new Map<string, string>();
/** One active number per account (phone_numbers_one_active_per_account): one per account, made on first use. */
async function phoneNumber(c: Client, a: Acct): Promise<string> {
  const have = phones.get(a.accountId);
  if (have) return have;
  const e164 = `+999${String(Math.floor(Math.random() * 1e12)).padStart(12, "0")}`;
  const id = await one(c, "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [a.accountId, e164]);
  phones.set(a.accountId, id);
  return id;
}
const thread = (c: Client, a: Acct, contact: string, unread = 0, token: string | null = null) =>
  one(c, "insert into public.conversations (account_id, contact_id, unread_count, reply_token, last_message_at) values ($1, $2, $3, $4, now()) returning id",
    [a.accountId, contact, unread, token]);
/** updated_at far in the past, so a merge or an Undo that touched it would show (review m8a). */
const message = (c: Client, a: Acct, conversation: string, createdAt = "now()") =>
  one(c, `insert into public.messages (account_id, conversation_id, channel, direction, body, status, author_kind, created_at, updated_at)
          values ($1, $2, 'sms', 'inbound', 'hola', 'delivered', 'customer', ${createdAt}, '2026-01-01T00:00:00Z') returning id`, [a.accountId, conversation]);
const inboundEmail = (c: Client, a: Acct, conversation: string) =>
  one(c, `insert into public.inbound_emails (account_id, conversation_id, provider_email_id, from_email, to_email, status, received_at)
          values ($1, $2, $3, 'o@example.com', 'inbox@example.com', 'filed', now()) returning id`, [a.accountId, conversation, `pe_merge_${RUN}_${++seq}`]);
const callRow = async (c: Client, a: Acct, contact: string | null, conversation: string | null = null) =>
  one(c, "insert into public.calls (account_id, phone_number_id, contact_id, conversation_id) values ($1, $2, $3, $4) returning id",
    [a.accountId, await phoneNumber(c, a), contact, conversation]);
async function tag(c: Client, a: Acct, ...contacts: string[]): Promise<string> {
  const t = await one(c, "insert into public.tags (account_id, name) values ($1, $2) returning id", [a.accountId, `tag-${RUN}-${++seq}`]);
  for (const x of contacts) await c.query("insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3)", [x, t, a.accountId]);
  return t;
}
const group = (c: Client, a: Acct, kind: "household" | "business", name: string) =>
  one(c, "insert into public.client_groups (account_id, kind, name) values ($1, $2, $3) returning id", [a.accountId, kind, `${name} ${++seq}`]);
const membership = (c: Client, a: Acct, g: string, contact: string, o: { primary?: boolean; billing?: boolean; primaryContact?: boolean } = {}) =>
  one(c, `insert into public.client_group_members (account_id, client_group_id, contact_id, is_primary, is_billing, is_primary_contact)
          values ($1, $2, $3, $4, $5, $6) returning id`, [a.accountId, g, contact, o.primary ?? false, o.billing ?? false, o.primaryContact ?? false]);
const relationship = (c: Client, a: Acct, from: string, to: string, label = "sibling") =>
  one(c, "insert into public.contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, $4) returning id",
    [a.accountId, from, to, label]);
const skip = (c: Client, a: Acct, contact: string, category = "insurance") =>
  one(c, "insert into public.document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1, $2, $3, 'user_x') returning id",
    [a.accountId, contact, category]);

/** The row each moving table's case seeds on O (minimal inserts from the files the plan names). */
type Seed = (c: Client, a: Acct, o: string) => Promise<string>;
const SEEDS: Record<string, Seed> = {
  automation_log: (c, a, o) => one(c,
    "insert into public.automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1, 'textback', 'sms', $2, $3, 'sent') returning id",
    [a.accountId, o, `call:merge-${RUN}-${++seq}`]),
  bookings: async (c, a, o) => {
    const cal = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [a.accountId, `cal_merge_${RUN}_${++seq}`]);
    return one(c, `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, status, author_kind)
                   values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 1 hour', $4, 'booked', 'person') returning id`,
      [a.accountId, cal, o, `tok_merge_${RUN}_${++seq}`]);
  },
  calls: (c, a, o) => callRow(c, a, o),
  document_requests: (c, a, o) => one(c,
    `insert into public.document_requests (id, account_id, contact_id, items, language, token_hash, channel, created_by, expires_at)
     values (gen_random_uuid(), $1, $2, $3::jsonb, 'en', md5($4) || md5($4 || 'b'), 'link', 'user_x', now() + interval '7 days') returning id`,
    [a.accountId, o, JSON.stringify([{ key: "insurance", category: "insurance", note: null }]), `${RUN}-${++seq}`]),
  documents: (c, a, o) => one(c,
    "insert into public.documents (account_id, contact_id, title, category, source, created_by) values ($1, $2, 'Seguro', 'insurance', 'upload', 'user_seed') returning id",
    [a.accountId, o]),
  form_submissions: async (c, a, o) => {
    const f = await one(c, "insert into public.forms (account_id, public_id, name) values ($1, $2, 'F') returning id", [a.accountId, `frm_merge_${RUN}_${++seq}`]);
    return one(c, "insert into public.form_submissions (account_id, form_id, contact_id) values ($1, $2, $3) returning id", [a.accountId, f, o]);
  },
  notes: (c, a, o) => one(c, "insert into public.notes (account_id, contact_id, body) values ($1, $2, 'called twice') returning id", [a.accountId, o]),
  opportunities: async (c, a, o) => {
    const p = await one(c, "insert into public.pipelines (account_id, name) values ($1, 'Sales') returning id", [a.accountId]);
    const s = await one(c, "insert into public.pipeline_stages (account_id, pipeline_id, name, position) values ($1, $2, 'New', 0) returning id", [a.accountId, p]);
    return one(c, "insert into public.opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1, $2, $3, $4, 'Roof') returning id",
      [a.accountId, o, p, s]);
  },
  places: (c, a, o) => one(c, "insert into public.places (account_id, contact_id, address) values ($1, $2, '1 Main St') returning id", [a.accountId, o]),
  tasks: (c, a, o) => one(c, "insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'Call back') returning id", [a.accountId, o]),
};

/** The fingerprints the compare screen sends back: contact_merge_preview's own `seen` (review m3). As the owner (the
 *  preview is an invoker function and the owner bypasses RLS). Null when the preview refuses. */
async function seenOf(c: Client, a: Acct, keep: string, other: string): Promise<{ keep: string; other: string } | null> {
  return val(c, "select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [a.accountId, keep, other]);
}
const MERGE = "select public.merge_contacts($1, $2, $3, $4::jsonb, $5::jsonb, $6) as r";
const UNDO = "select public.undo_contact_merge($1, $2, $3) as r";
type MergeAnswer = { status: string; mergeId?: number; moved?: Record<string, number> };
type UndoAnswer = { status: string; otherId?: string; keptNew?: number; keptEdits?: string[] };
async function mergeArgs(c: Client, a: Acct, keep: string, other: string, choices: J = {}, seen?: { keep: string; other: string } | null,
                         actor: string | null = null) {
  if (seen === undefined) seen = await seenOf(c, a, keep, other);
  // A refused preview has no `seen`; the merge's own refusal is what the case asserts.
  return [a.accountId, keep, other, JSON.stringify(choices), JSON.stringify(seen ?? { keep: "", other: "" }), actor];
}
/** As an Owner of the account: the app's path (the request client). `seen` defaults to a fresh preview. */
async function merge(c: Client, a: Acct, keep: string, other: string, choices: J = {}, seen?: { keep: string; other: string } | null): Promise<MergeAnswer> {
  const args = await mergeArgs(c, a, keep, other, choices, seen);
  await actAsOwner(c);
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query<{ r: MergeAnswer }>(MERGE, args);
  await actAsOwner(c);
  return r!.r;
}
async function undo(c: Client, a: Acct, mergeId: number): Promise<UndoAnswer> {
  await actAsOwner(c);
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query<{ r: UndoAnswer }>(UNDO, [a.accountId, mergeId, null]);
  await actAsOwner(c);
  return r!.r;
}
async function log(c: Client, mergeId: number) {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ moved: Record<string, unknown>; removed: Record<string, J[]>; moved_counts: J; keep_before: J; keep_after: J;
    choices: J; unread_handed: number; other_reply_token: string | null; merged_by: string; undone_at: string | null; undone_by: string | null }>(
    "select * from public.contact_merges where id = $1", [mergeId]);
  return r!;
}
const contactOf = (c: Client, table: string, id: string) => val<string>(c, `select contact_id as v from public.${table} where id::text = $1`, [id]);
const contactRow = async (c: Client, id: string) => {
  await actAsOwner(c);
  return (await c.query<J>("select * from public.contacts where id = $1", [id])).rows[0]!;
};
const removedIds = (removed: Record<string, J[]>, t: string) => (removed[t] ?? []).map((r) => String(r.id));

/** The two keeps of every case: K and O share nothing (different phones, no email, different names). */
async function pairOf(c: Client, label: string) {
  const a = await seedAccount(c, label);
  const k = await person(c, a.accountId, { first: "Keep", phone: "+19565550401" });
  const o = await person(c, a.accountId, { first: "Other", phone: "+19565550402" });
  return { a, k, o };
}

describe("0106 part B: rows that move (spec 5.3)", () => {
  it.each(Object.entries(SEEDS).map(([t, seed]) => ({ t, seed })))(
    "$t moves to the kept record and is recorded (mutation: drop '$t' from c_moves -> FAILS)", ({ t, seed }) =>
      withRollback(async (c) => {
        const { a, k, o } = await pairOf(c, `mv_${t}`);
        const id = await seed(c, a, o);
        const m = await merge(c, a, k, o);
        expect(m.status).toBe("merged");
        expect(await contactOf(c, t, id)).toBe(k);
        expect((await log(c, m.mergeId!)).moved[t]).toEqual([id]);
      }));
});

describe("0106 part B: rows that conflict (spec 5.3)", () => {
  it("a tag both had: the other's row is removed and recorded, the rest move, K has both (mutation: drop the duplicate delete -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "tag");
      const shared = await tag(c, a, k, o);
      const own = await tag(c, a, o);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      const l = await log(c, m.mergeId!);
      expect(l.removed.contact_tags).toEqual([{ contact_id: o, tag_id: shared, account_id: a.accountId }]);
      expect(l.moved.contact_tags).toEqual([own]);
      expect(await val(c, "select array_agg(tag_id::text order by tag_id) as v from public.contact_tags where contact_id = $1", [k])).toEqual([shared, own].sort());
    }));

  it("a group both are in: the other's membership is removed, K's takes is_billing and is_primary_contact, K's prior flags recorded (mutation: drop the flag OR -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "grp");
      const g = await group(c, a, "business", "Acme");
      const km = await membership(c, a, g, k);
      const om = await membership(c, a, g, o, { billing: true, primaryContact: true });
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      const l = await log(c, m.mergeId!);
      expect(removedIds(l.removed, "client_group_members")).toEqual([om]);
      expect(l.moved.client_group_members_flags).toEqual([{ id: km, is_billing: false, is_primary_contact: false }]);
      expect(await val(c, "select jsonb_build_object('b', is_billing, 'p', is_primary_contact) as v from public.client_group_members where id = $1", [km]))
        .toEqual({ b: true, p: true });
    }));

  it("two primary groups: the other's membership moves without is_primary and is recorded (mutation: drop the unprimary step -> client_group_members_one_primary fails the merge)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "prim");
      await membership(c, a, await group(c, a, "household", "Casa K"), k, { primary: true });
      const om = await membership(c, a, await group(c, a, "household", "Casa O"), o, { primary: true });
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect(await val(c, "select jsonb_build_object('c', contact_id, 'p', is_primary) as v from public.client_group_members where id = $1", [om]))
        .toEqual({ c: k, p: false });
      expect((await log(c, m.mergeId!)).moved.client_group_members_unprimaried).toEqual([om]);
    }));

  it("a relationship between the two is removed, never a self-row (mutation: drop the self-row branch -> contact_relationships_not_self fails the merge)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "rself");
      const r = await relationship(c, a, k, o);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect(removedIds((await log(c, m.mergeId!)).removed, "contact_relationships")).toEqual([r]);
      expect(await val(c, "select count(*)::int as v from public.contact_relationships where account_id = $1", [a.accountId])).toBe(0);
    }));

  it("a relationship that repeats one K has is removed, K's stays (mutation: drop the unique_violation handler -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "rrep");
      const x = await person(c, a.accountId, { first: "Xavi" });
      const kx = await relationship(c, a, k, x);
      const ox = await relationship(c, a, o, x);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect(removedIds((await log(c, m.mergeId!)).removed, "contact_relationships")).toEqual([ox]);
      expect(await val(c, "select array_agg(id::text) as v from public.contact_relationships where account_id = $1", [a.accountId])).toEqual([kx]);
    }));

  it("an active skip of one category both have: the other's is removed (mutation: drop the handler -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "skip");
      const ks = await skip(c, a, k);
      const os = await skip(c, a, o);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect(removedIds((await log(c, m.mergeId!)).removed, "document_requirement_skips")).toEqual([os]);
      expect(await val(c, "select array_agg(id::text) as v from public.document_requirement_skips where account_id = $1", [a.accountId])).toEqual([ks]);
    }));
});

describe("0106 part B: rows that stay (spec 5.3)", () => {
  it("an AI act, a suggestion and a consent row still name the other record (mutation: add 'ai_acts' to c_moves -> ai_acts_act_is_fixed fails the merge)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "stay");
      const call = await callRow(c, a, null);
      const act = await one(c, "insert into public.ai_acts (account_id, actor, call_id, contact_id, kind, target) values ($1, 'voice', $2, $3, 'contact_created', '{}') returning id",
        [a.accountId, call, o]);
      const prop = await one(c, "insert into public.proposals (account_id, source, call_id, contact_id, kind, payload, evidence, expires_at) values ($1, 'call', $2, $3, 'task', '{}', 'x', now() + interval '30 days') returning id",
        [a.accountId, call, o]);
      const consent = await one(c, "insert into public.consent_events (account_id, channel, address, action, method, contact_id) values ($1, 'sms', '+19565550142', 'granted', 'form', $2) returning id",
        [a.accountId, o]);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect([await contactOf(c, "ai_acts", act), await contactOf(c, "proposals", prop), await contactOf(c, "consent_events", consent)]).toEqual([o, o, o]);
    }));
});

describe("0106 part B: threads (correction 8)", () => {
  it("both threads: every message, call and inbound email ends on the kept thread, unread is the sum, the emptied thread is gone, its reply token recorded (mutation: skip the inbound_emails update -> the cascade deletes it, FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "thr");
      const token = hex24();
      const kc = await thread(c, a, k, 1);
      await message(c, a, kc);
      const oc = await thread(c, a, o, 2, token);
      const msg = await message(c, a, oc);
      const call = await callRow(c, a, null, oc);
      const mail = await inboundEmail(c, a, oc);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect([await val(c, "select conversation_id as v from public.messages where id = $1", [msg]),
              await val(c, "select conversation_id as v from public.calls where id = $1", [call]),
              await val(c, "select conversation_id as v from public.inbound_emails where id = $1", [mail])]).toEqual([kc, kc, kc]);
      expect(await val(c, "select unread_count as v from public.conversations where id = $1", [kc])).toBe(3);
      expect(await val(c, "select count(*)::int as v from public.conversations where id = $1", [oc])).toBe(0);
      const l = await log(c, m.mergeId!);
      expect([l.other_reply_token, l.unread_handed]).toEqual([token, 2]);
      expect(l.moved.conversation_created).toBeUndefined();
    }));

  it("K has no thread: one is created and O's rows move to it (mutation: re-point O's thread instead -> conversation_created absent, FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "thr0");
      const oc = await thread(c, a, o, 1);
      const msg = await message(c, a, oc);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      const kc = await val<string>(c, "select id::text as v from public.conversations where contact_id = $1", [k]);
      expect(kc).not.toBe(oc);
      expect((await log(c, m.mergeId!)).moved.conversation_created).toBe(kc);
      expect(await val(c, "select conversation_id::text as v from public.messages where id = $1", [msg])).toBe(kc);
    }));

  it("a revoked reply token is not recorded (mutation: record it regardless -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "thrr");
      await thread(c, a, k);
      const oc = await thread(c, a, o, 0, hex24());
      await c.query("update public.conversations set reply_token_revoked_at = now() where id = $1", [oc]);
      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect((await log(c, m.mergeId!)).other_reply_token).toBeNull();
    }));
});

describe("0106 part B: fields (spec 5.2)", () => {
  it("values come from the rows, not the client: a chosen phone brings its phone_country_unconfirmed (mutation: `case v_s_phone when 'other' then k.phone` -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fphone");
      await c.query("update public.contacts set phone = '+19565550301', phone_country_unconfirmed = false where id = $1", [k]);
      await c.query("update public.contacts set phone = '+19565550302', phone_country_unconfirmed = true where id = $1", [o]);
      expect((await merge(c, a, k, o, { phone: "other" })).status).toBe("merged");
      const r = await contactRow(c, k);
      expect([r.phone, r.phone_country_unconfirmed]).toEqual(["+19565550302", true]);
    }));

  it("a blank is filled from the other with no choice sent (mutation: app.merge_side without its blank branches -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fblank");
      await c.query("update public.contacts set email = 'otra@example.com', last_name = 'Ruiz' where id = $1", [o]);
      expect((await merge(c, a, k, o)).status).toBe("merged");
      const r = await contactRow(c, k);
      expect([r.email, r.last_name, r.first_name]).toEqual(["otra@example.com", "Ruiz", "Keep"]);
    }));

  it.each([[{ nickname: "keep" }], [{ phone: "both" }], [{ "custom.": 1 }]])(
    "an unknown choice name or side is 22023: %j", (choices) =>
      withRollback(async (c) => {
        const { a, k, o } = await pairOf(c, "fbad");
        const args = await mergeArgs(c, a, k, o, choices);
        const ow = await member(c, a, "owner");
        await signIn(c, a, ow.sub);
        expect((await refusal(c, MERGE, args))?.code).toBe("22023");
      }));

  const lang = (c: Client, id: string, language: string, source: string, at: string) =>
    c.query("update public.contacts set language = $2, language_source = $3, language_set_at = $4 where id = $1", [id, language, source, at]);
  it("language: a staff-set language beats a customer's sign (mutation: drop the staff branches -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "flang1");
      await lang(c, k, "es", "call", "2026-10-01T00:00:00Z");
      await lang(c, o, "en", "staff", "2026-10-02T00:00:00Z");
      expect((await merge(c, a, k, o)).status).toBe("merged");
      const r = await contactRow(c, k);
      expect([r.language, r.language_source]).toEqual(["en", "staff"]);
    }));
  it("language: the earlier sign stands (mutation: drop the set_at branch -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "flang2");
      await lang(c, k, "es", "call", "2026-10-02T00:00:00Z");
      await lang(c, o, "en", "booking", "2026-10-01T00:00:00Z");
      expect((await merge(c, a, k, o)).status).toBe("merged");
      const r = await contactRow(c, k);
      expect([r.language, r.language_source]).toEqual(["en", "booking"]);
    }));
  it("language: a choice overrides the rule (mutation: drop the choice branch -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "flang3");
      await lang(c, k, "es", "staff", "2026-10-01T00:00:00Z");
      await lang(c, o, "en", "call", "2026-09-01T00:00:00Z");
      expect((await merge(c, a, k, o, { language: "other" })).status).toBe("merged");
      expect((await contactRow(c, k)).language).toBe("en");
    }));

  it("custom: a key on one side only is kept; a key on both takes choices['custom.k'] (mutation: drop the per-key loop -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fcust");
      await c.query("update public.contacts set custom = $2 where id = $1", [k, JSON.stringify({ gate: "1234", color: "blue" })]);
      await c.query("update public.contacts set custom = $2 where id = $1", [o, JSON.stringify({ dog: "Max", color: "red" })]);
      expect((await merge(c, a, k, o, { "custom.color": "other" })).status).toBe("merged");
      expect((await contactRow(c, k)).custom).toEqual({ gate: "1234", color: "red", dog: "Max" });
    }));

  it("marketing opt-out is the earliest; reactivation_sent_at the latest", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fdates");
      await c.query("update public.contacts set marketing_email_opted_out_at = '2026-05-01T00:00:00Z', reactivation_sent_at = '2026-05-01T00:00:00Z' where id = $1", [k]);
      await c.query("update public.contacts set marketing_email_opted_out_at = '2026-03-01T00:00:00Z', reactivation_sent_at = '2026-07-01T00:00:00Z' where id = $1", [o]);
      expect((await merge(c, a, k, o)).status).toBe("merged");
      expect(await val(c, "select jsonb_build_object('m', marketing_email_opted_out_at = '2026-03-01T00:00:00Z', 'r', reactivation_sent_at = '2026-07-01T00:00:00Z') as v from public.contacts where id = $1", [k]))
        .toEqual({ m: true, r: true });
    }));

  it("archive: K archived, O not: K is restored and contact_archive_log has one restored row by the merging person (mutation: keep K's archive -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "farch");
      await c.query("update public.contacts set archived_at = now(), archived_by = 'user_old' where id = $1", [k]);
      const args = await mergeArgs(c, a, k, o);
      const ow = await member(c, a, "staff");
      await signIn(c, a, ow.sub);
      expect((await c.query<{ r: MergeAnswer }>(MERGE, args)).rows[0]!.r.status).toBe("merged");
      expect((await contactRow(c, k)).archived_at).toBeNull();
      expect((await c.query("select action, author_kind, author_id from public.contact_archive_log where contact_id = $1", [k])).rows)
        .toEqual([{ action: "restored", author_kind: "person", author_id: ow.sub }]);
    }));
  it("archive: both archived, K stays archived", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "farch2");
      await c.query("update public.contacts set archived_at = now(), archived_by = 'user_old' where id in ($1, $2)", [k, o]);
      expect((await merge(c, a, k, o)).status).toBe("merged");
      expect((await contactRow(c, k)).archived_by).toBe("user_old");
    }));

  it("keep_before and keep_after hold exactly app.merge_fields_of's keys", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fkeys");
      const m = await merge(c, a, k, o);
      const l = await log(c, m.mergeId!);
      const keys = await val<J>(c, "select app.merge_fields_of(c) as v from public.contacts c where id = $1", [k]);
      const KEYS = ["first_name", "last_name", "email", "phone", "phone_country_unconfirmed", "assigned_to", "custom", "language", "language_source",
        "language_set_at", "last_language_signal", "last_language_signal_source", "last_language_signal_at", "language_hint_kept_at",
        "marketing_email_opted_out_at", "dnd", "reactivation_sent_at", "archived_at", "archived_by"].sort();
      expect([Object.keys(l.keep_before).sort(), Object.keys(l.keep_after).sort(), Object.keys(keys).sort()]).toEqual([KEYS, KEYS, KEYS]);
    }));

  it("the fingerprint does not depend on the session's time zone (mutation: drop `set timezone = 'UTC'` from app.merge_fields_of -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "ftz");
      await c.query("update public.contacts set archived_at = '2026-10-29T12:00:00Z', archived_by = 'user_old' where id = $1", [o]);
      const md5 = "select md5(app.merge_fields_of(c)::text) as v from public.contacts c where id = $1";
      await c.query("set local timezone = 'America/Chicago'");
      // The control: this session really prints a timestamptz in Chicago time.
      expect(await val(c, "select to_jsonb('2026-10-29T12:00:00Z'::timestamptz) #>> '{}' as v")).toBe("2026-10-29T07:00:00-05:00");
      const chicago = await val(c, md5, [o]);
      const seen = await seenOf(c, a, k, o);
      await c.query("set local timezone = 'UTC'");
      expect(await val(c, md5, [o])).toBe(chicago);
      expect((await merge(c, a, k, o, {}, seen)).status).toBe("merged");
    }));
});

describe("0106 part B: refusals and who", () => {
  it("same: one id twice", () =>
    withRollback(async (c) => {
      const { a, k } = await pairOf(c, "rsame");
      expect((await merge(c, a, k, k)).status).toBe("same");
    }));
  it("not_found: O is in account B, merged under A (second account)", () =>
    withRollback(async (c) => {
      const { a, k } = await pairOf(c, "rnf");
      const b = await seedAccount(c, "rnfb");
      const ob = await person(c, b.accountId, { first: "Bee" });
      expect((await merge(c, a, k, ob)).status).toBe("not_found");
      expect((await contactRow(c, ob)).merged_into).toBeNull();
    }));
  it("holding: O holds a shared number", () =>
    withRollback(async (c) => {
      const { a, k } = await pairOf(c, "rhold");
      const h = await one(c, "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', '+19565550499', true, 'person') returning id", [a.accountId]);
      expect((await merge(c, a, k, h)).status).toBe("holding");
    }));
  it("already_merged: O is already a tombstone (mutation: drop the check -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "ram");
      const z = await person(c, a.accountId, { first: "Zed" });
      const seen = await seenOf(c, a, k, o);
      await tombstone(c, a.accountId, o, z);
      expect((await merge(c, a, k, o, {}, seen)).status).toBe("already_merged");
    }));
  it("stale (1): O's first name changed after the preview (mutation: drop the check -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "rst1");
      const seen = await seenOf(c, a, k, o);
      await c.query("update public.contacts set first_name = 'Otro' where id = $1", [o]);
      expect((await merge(c, a, k, o, {}, seen)).status).toBe("stale");
    }));
  it("stale (2): a write that never stamps updated_at, as assignment.ts:339 does (review m3; mutation: compare updated_at instead of the fingerprint -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "rst2");
      const staff = await member(c, a, "staff");
      const seen = await seenOf(c, a, k, o);
      const before = await val(c, "select updated_at::text as v from public.contacts where id = $1", [o]);
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [o, staff.userId]);
      expect(await val(c, "select updated_at::text as v from public.contacts where id = $1", [o]), "the control: updated_at untouched").toBe(before);
      expect((await merge(c, a, k, o, {}, seen)).status).toBe("stale");
    }));
  it("stale (3): reactivation_sent_at set the way automations.ts:1855 does", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "rst3");
      const seen = await seenOf(c, a, k, o);
      await c.query("update public.contacts set reactivation_sent_at = now() where id = $1", [o]);
      expect((await merge(c, a, k, o, {}, seen)).status).toBe("stale");
    }));

  const who = async (c: Client, label: string) => {
    const { a, k, o } = await pairOf(c, label);
    return { a, k, o, args: await mergeArgs(c, a, k, o) };
  };
  it("a Technician is refused 42501", () =>
    withRollback(async (c) => {
      const { a, args, o } = await who(c, "wt");
      const t = await member(c, a, "technician");
      await signIn(c, a, t.sub);
      expect((await refusal(c, MERGE, args))?.code).toBe("42501");
      expect((await contactRow(c, o)).merged_into).toBeNull();
    }));
  it("an Owner with client access off is refused 42501 (the NULL path, through app.may_merge)", () =>
    withRollback(async (c) => {
      const { a, args } = await who(c, "woff");
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      const ow = await member(c, a, "owner");
      await signIn(c, a, ow.sub);
      expect((await refusal(c, MERGE, args))?.code).toBe("42501");
    }));
  it("an Owner of A whose token names org B is refused 42501 (review m4)", () =>
    withRollback(async (c) => {
      const { a, args } = await who(c, "worg");
      const b = await seedAccount(c, "worgb");
      const both = await member(c, a, "owner");
      await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner')", [both.userId, b.accountId]);
      await signIn(c, b, both.sub);
      expect((await refusal(c, MERGE, args))?.code).toBe("42501");
    }));
  it("Staff merges, and merged_by is their sub", () =>
    withRollback(async (c) => {
      const { a, args } = await who(c, "wstaff");
      const s = await member(c, a, "staff");
      await signIn(c, a, s.sub);
      const r = (await c.query<{ r: MergeAnswer }>(MERGE, args)).rows[0]!.r;
      expect(r.status).toBe("merged");
      expect((await log(c, r.mergeId!)).merged_by).toBe(s.sub);
    }));
  it("the service role merges with p_actor as merged_by; without p_actor it is 22023", () =>
    withRollback(async (c) => {
      const { a, k, o } = await who(c, "wsvc");
      const args = await mergeArgs(c, a, k, o);
      await asService(c);
      expect((await refusal(c, MERGE, args))?.code).toBe("22023");
      const r = (await c.query<{ r: MergeAnswer }>(MERGE, [...args.slice(0, 5), "svc_actor"])).rows[0]!.r;
      expect(r.status).toBe("merged");
      expect((await log(c, r.mergeId!)).merged_by).toBe("svc_actor");
    }));
});

describe("0106 part B: chains and flags", () => {
  it("chain: A into B, then B into C: A points at C and is in the second merge's moved.contacts (mutation: drop the flatten -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seedAccount(c, "chain");
      const [p1, p2, p3] = [await person(c, s.accountId, { first: "Uno" }), await person(c, s.accountId, { first: "Dos" }), await person(c, s.accountId, { first: "Tres" })];
      expect((await merge(c, s, p2, p1)).status).toBe("merged");
      const m2 = await merge(c, s, p3, p2);
      expect((await contactRow(c, p1)).merged_into).toBe(p3);
      expect((await log(c, m2.mergeId!)).moved.contacts).toEqual([p1]);
    }));

  it("the merged pair gets merge_id; with no pair, a merged_by_hand row is written with merge_id (mutation: skip it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seedAccount(c, "fl1");
      const k = await person(c, s.accountId, { first: "Ana", phone: "+19565550411" });
      const o = await person(c, s.accountId, { first: "Beto", phone: "+19565550411" });
      const m1 = await merge(c, s, k, o);
      expect(await flagOf(c, s.accountId, k, o)).toMatchObject({ reason: "same_phone", merge_id: String(m1.mergeId) });
      const { a, k: k2, o: o2 } = await pairOf(c, "fl1b");
      expect(await flagOf(c, a.accountId, k2, o2), "the control: no pair before").toBeNull();
      const m2 = await merge(c, a, k2, o2);
      expect(await flagOf(c, a.accountId, k2, o2)).toMatchObject({ reason: "merged_by_hand", merge_id: String(m2.mergeId) });
    }));

  it("a pair O-X becomes K-X with its reason and dismissal, recorded both ways", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "fl2");
      const x = await person(c, a.accountId, { first: "Xavi", phone: "+19565550402" });
      const ox = await flagOf(c, a.accountId, o, x);
      await c.query("update public.contact_duplicate_flags set dismissed_at = now(), dismissed_by = 'user_d' where id = $1", [ox!.id]);
      const m = await merge(c, a, k, o);
      const kx = await flagOf(c, a.accountId, k, x);
      expect(kx).toMatchObject({ reason: "same_phone", dismissed: true });
      const l = await log(c, m.mergeId!);
      expect(l.moved.contact_duplicate_flags_added).toEqual([kx!.id]);
      expect(removedIds(l.removed, "contact_duplicate_flags")).toEqual([ox!.id]);
    }));

  it("review I1: a dismissed O-X stays dismissed as K-X when K's blank email is filled from O, and Undo puts O-X back (mutation: re-file after the field update -> K-X undismissed and listed, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "i1");
      const k = await person(c, a.accountId, { first: "Kika", phone: "+19565550421" });
      const o = await person(c, a.accountId, { first: "Olga", phone: "+19565550422", email: "maria@x.mx" });
      const x = await person(c, a.accountId, { first: "Xime", phone: "+19565550423", email: "MARIA@x.mx" });
      const ox = await flagOf(c, a.accountId, o, x);
      expect(ox?.reason).toBe("same_email");
      const ow = await member(c, a, "owner");
      await signIn(c, a, ow.sub);
      expect((await c.query("select public.dismiss_duplicate_pair($1, $2) as r", [a.accountId, ox!.id])).rows[0].r.status).toBe("dismissed");
      const m = await merge(c, a, k, o);
      expect((await contactRow(c, k)).email).toBe("maria@x.mx");
      expect(await flagOf(c, a.accountId, k, x)).toMatchObject({ reason: "same_email", dismissed: true });
      expect(await val(c, "select count(*)::int as v from public.duplicate_pairs_page($1, 100) p where (p.contact_a = $2 and p.contact_b = $3) or (p.contact_a = $3 and p.contact_b = $2)",
        [a.accountId, k, x])).toBe(0);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect(await flagOf(c, a.accountId, k, x)).toBeNull();
      expect(await flagOf(c, a.accountId, o, x)).toMatchObject({ id: ox!.id, reason: "same_email", dismissed: true });
    }));

  it("review I1, second shape: a pair the field update files fresh for K is recorded and gone after Undo (mutation: drop the v_flags_before record -> a phantom K-X survives, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "i1b");
      const k = await person(c, a.accountId, { first: "Maria", phone: "+19565550431" });
      const o = await person(c, a.accountId, { first: "Mary", last: "Ruiz", phone: "+19565550432" });
      const x = await person(c, a.accountId, { first: "Maria", last: "Ruiz", phone: "+19565550433" });
      expect(await flagOf(c, a.accountId, o, x), "the control: X never paired with O").toBeNull();
      const m = await merge(c, a, k, o);
      const kx = await flagOf(c, a.accountId, k, x);
      expect(kx?.reason).toBe("same_name");
      expect((await log(c, m.mergeId!)).moved.contact_duplicate_flags_added).toEqual([kx!.id]);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect(await flagOf(c, a.accountId, k, x)).toBeNull();
    }));
});

describe("0106 part B: the preview", () => {
  it("preview equals the move: moved_counts is the preview's counts exactly, a call by contact AND by thread counted once (mutation: count calls twice -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "prev");
      const oc = await thread(c, a, o);
      await message(c, a, oc);
      await message(c, a, oc);
      await callRow(c, a, o, oc);
      for (const t of ["bookings", "documents", "opportunities", "notes", "tasks", "form_submissions"]) await SEEDS[t]!(c, a, o);
      const preview = await val<{ status: string; counts: J; fields: { keep: J; other: J }; seen: { keep: string; other: string } }>(
        c, "select public.contact_merge_preview($1, $2, $3) as v", [a.accountId, k, o]);
      expect(preview.counts).toEqual({ messages: 2, calls: 1, bookings: 1, documents: 1, opportunities: 1, notes: 1, tasks: 1, form_submissions: 1 });
      expect(preview.fields.other.first_name).toBe("Other");
      expect(preview.seen.other).toBe(await val(c, "select md5(app.merge_fields_of(c)::text) as v from public.contacts c where id = $1", [o]));
      const m = await merge(c, a, k, o, {}, preview.seen);
      expect(m.moved).toEqual(preview.counts);
      expect((await log(c, m.mergeId!)).moved_counts).toEqual(preview.counts);
    }));

  it("preview refusals: same, not_found, holding, already_merged", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "prevr");
      const b = await seedAccount(c, "prevrb");
      const ob = await person(c, b.accountId, { first: "Bee" });
      const h = await one(c, "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', '+19565550498', true, 'person') returning id", [a.accountId]);
      const z = await person(c, a.accountId, { first: "Zed" });
      const status = (x: string, y: string) => val(c, "select public.contact_merge_preview($1, $2, $3) ->> 'status' as v", [a.accountId, x, y]);
      expect(await status(k, k)).toBe("same");
      expect(await status(k, ob)).toBe("not_found");
      expect(await status(k, h)).toBe("holding");
      await tombstone(c, a.accountId, o, z);
      expect(await status(k, o)).toBe("already_merged");
    }));
});

/** Every row of the account in the tables a merge touches (events, contact_merges and record_summaries excluded:
 *  history, the log itself, and a cache a merge deletes by design). */
const SNAP_TABLES = ["contacts", "conversations", "messages", "calls", "inbound_emails", "automation_log", "bookings", "document_requests",
  "documents", "form_submissions", "notes", "opportunities", "places", "tasks", "contact_tags", "client_group_members", "client_groups",
  "contact_relationships", "document_requirement_skips", "contact_duplicate_flags", "ai_acts", "proposals", "consent_events", "contact_archive_log", "tags"];
async function snapshot(c: Client, accountId: string): Promise<Record<string, unknown[]>> {
  await actAsOwner(c);
  const out: Record<string, unknown[]> = {};
  for (const t of SNAP_TABLES) {
    out[t] = (await c.query<{ j: unknown[] }>(
      `select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), '[]') as j from public.${t} x where x.account_id = $1`, [accountId])).rows[0]!.j;
  }
  return out;
}

describe("0106 part B: Undo", () => {
  it("everything comes back: the whole fixture after merge then Undo equals the fixture before, row for row (mutation: skip the removed re-inserts -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "full");
      const k = await person(c, a.accountId, { first: "Keep", phone: "+19565550441" });
      const o = await person(c, a.accountId, { first: "Other", last: "Ruiz", phone: "+19565550441", email: `o-${RUN}@x.mx` });
      const x = await person(c, a.accountId, { first: "Xavi", email: `O-${RUN}@x.mx` });
      const y = await person(c, a.accountId, { first: "Yola" });
      const z = await person(c, a.accountId, { first: "Zoe" });
      await c.query("update public.contact_duplicate_flags set dismissed_at = now(), dismissed_by = 'user_d' where id = $1", [(await flagOf(c, a.accountId, o, x))!.id]);
      const token = hex24();
      const kc = await thread(c, a, k, 1);
      await message(c, a, kc);
      const oc = await thread(c, a, o, 2, token);
      const msg = await message(c, a, oc);
      await callRow(c, a, o, oc);
      await inboundEmail(c, a, oc);
      for (const t of Object.keys(SEEDS)) await SEEDS[t]!(c, a, o);
      await tag(c, a, k, o);
      await tag(c, a, o);
      const biz = await group(c, a, "business", "Acme");
      await membership(c, a, biz, k);
      await membership(c, a, biz, o, { billing: true, primaryContact: true });
      await membership(c, a, await group(c, a, "household", "Casa K"), k, { primary: true });
      await membership(c, a, await group(c, a, "household", "Casa O"), o, { primary: true });
      await relationship(c, a, k, o);
      await relationship(c, a, k, x);
      await relationship(c, a, o, x);
      await relationship(c, a, o, y, "parent");
      await relationship(c, a, z, o, "spouse");
      await skip(c, a, k);
      await skip(c, a, o);
      await skip(c, a, o, "id");
      const call = await callRow(c, a, null);
      await c.query("insert into public.ai_acts (account_id, actor, call_id, contact_id, kind, target) values ($1, 'voice', $2, $3, 'contact_created', '{}')", [a.accountId, call, o]);
      await c.query("insert into public.consent_events (account_id, channel, address, action, method, contact_id) values ($1, 'sms', '+19565550441', 'granted', 'form', $2)", [a.accountId, o]);
      const before = await snapshot(c, a.accountId);
      const rows = Object.values(before).reduce((n, r) => n + r.length, 0);
      expect(rows, "the control: a fixture worth diffing").toBeGreaterThanOrEqual(40);

      const m = await merge(c, a, k, o);
      expect(m.status).toBe("merged");
      expect(await snapshot(c, a.accountId), "the control: the merge changed the fixture").not.toEqual(before);
      expect(await val(c, "select updated_at = '2026-01-01T00:00:00Z' as v from public.messages where id = $1", [msg]), "the merge left messages.updated_at alone (m8a)").toBe(true);

      const u = await undo(c, a, m.mergeId!);
      expect(u).toEqual({ status: "undone", otherId: o, keptNew: 0, keptEdits: [] });
      expect(await snapshot(c, a.accountId)).toEqual(before);
      expect(await val(c, "select reply_token as v from public.conversations where id = $1", [oc])).toBe(token);
      const l = await log(c, m.mergeId!);
      expect([l.undone_at !== null, l.undone_by !== null]).toEqual([true, true]);
    }));

  it("ORDER: the tombstone is cleared first, so the follow_merge triggers leave every row moved back on O (mutation: clear it after the row moves -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "uord");
      const note = await SEEDS.notes!(c, a, o);
      const task = await SEEDS.tasks!(c, a, o);
      const r = await relationship(c, a, k, o);
      const m = await merge(c, a, k, o);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect([await contactOf(c, "notes", note), await contactOf(c, "tasks", task)]).toEqual([o, o]);
      expect(await val(c, "select related_contact_id as v from public.contact_relationships where id = $1", [r])).toBe(o);
    }));

  it("an edit after the merge is kept and named; untouched fields return (mutation: restore unconditionally -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "uedit");
      await c.query("update public.contacts set first_name = 'Anita', email = 'anita@example.com' where id = $1", [o]);
      const m = await merge(c, a, k, o, { first_name: "other" });
      expect((await contactRow(c, k)).first_name).toBe("Anita");
      await c.query("update public.contacts set first_name = 'Annie' where id = $1", [k]);
      const u = await undo(c, a, m.mergeId!);
      expect(u.keptEdits).toEqual(["first_name"]);
      const r = await contactRow(c, k);
      expect([r.first_name, r.email]).toEqual(["Annie", null]);
    }));

  it("a text after the merge stays on K and is counted (mutation: move every message on the thread -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "utext");
      const kc = await thread(c, a, k);
      const oc = await thread(c, a, o);
      await message(c, a, oc);
      const m = await merge(c, a, k, o);
      const late = await message(c, a, kc, "now() + interval '1 second'");
      const u = await undo(c, a, m.mergeId!);
      expect(u.keptNew).toBe(1);
      expect(await val(c, "select conversation_id as v from public.messages where id = $1", [late])).toBe(kc);
      expect(await val(c, "select count(*)::int as v from public.messages where conversation_id = $1", [oc])).toBe(1);
    }));

  it("a thread the merge made goes away when nothing new reached it, and stays when a text did", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "umade");
      await message(c, a, await thread(c, a, o));
      const m = await merge(c, a, k, o);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect(await val(c, "select count(*)::int as v from public.conversations where contact_id = $1", [k])).toBe(0);

      const { a: b, k: k2, o: o2 } = await pairOf(c, "umade2");
      await message(c, b, await thread(c, b, o2));
      const m2 = await merge(c, b, k2, o2);
      await message(c, b, await val<string>(c, "select id::text as v from public.conversations where contact_id = $1", [k2]), "now() + interval '1 second'");
      expect((await undo(c, b, m2.mergeId!)).keptNew).toBe(1);
      expect(await val(c, "select count(*)::int as v from public.conversations where contact_id = $1", [k2])).toBe(1);
    }));

  it("expired: past the 30 days (mutation: drop the window check -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "uexp");
      const m = await merge(c, a, k, o);
      await c.query("update public.contact_merges set merged_at = now() - interval '31 days', undo_until = now() - interval '1 day' where id = $1", [m.mergeId]);
      expect((await undo(c, a, m.mergeId!)).status).toBe("expired");
      expect((await contactRow(c, o)).merged_into).toBe(k);
    }));

  it("later_merge: (a) K merged into Z since; (b) another merge into K after this one (mutation: drop the check -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "ulat");
      const z = await person(c, a.accountId, { first: "Zed" });
      const p = await person(c, a.accountId, { first: "Pia" });
      const m = await merge(c, a, k, o);
      const m2 = await merge(c, a, k, p);
      expect((await undo(c, a, m.mergeId!)).status, "(b)").toBe("later_merge");
      await merge(c, a, z, k);
      expect((await undo(c, a, m2.mergeId!)).status, "(a)").toBe("later_merge");
      expect((await contactRow(c, o)).merged_into).toBe(z);
    }));

  it("already_undone; not_found for B's merge id under A (second account)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "uau");
      const m = await merge(c, a, k, o);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect((await undo(c, a, m.mergeId!)).status).toBe("already_undone");
      const { a: b, k: kb, o: ob } = await pairOf(c, "uaub");
      const mb = await merge(c, b, kb, ob);
      expect((await undo(c, a, mb.mergeId!)).status).toBe("not_found");
      expect((await contactRow(c, ob)).merged_into).toBe(kb);
    }));

  const undoWho = async (c: Client, label: string) => {
    const { a, k, o } = await pairOf(c, label);
    const m = await merge(c, a, k, o);
    return { a, o, mergeId: m.mergeId! };
  };
  it("who: a Technician, an Owner with client access off and an Owner of A whose token names org B are refused 42501", () =>
    withRollback(async (c) => {
      const { a, mergeId } = await undoWho(c, "uw1");
      const t = await member(c, a, "technician");
      await signIn(c, a, t.sub);
      expect((await refusal(c, UNDO, [a.accountId, mergeId, null]))?.code, "technician").toBe("42501");
      const b = await seedAccount(c, "uw1b");
      const both = await member(c, a, "owner");
      await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner')", [both.userId, b.accountId]);
      await signIn(c, b, both.sub);
      expect((await refusal(c, UNDO, [a.accountId, mergeId, null]))?.code, "org B").toBe("42501");
      await actAsOwner(c);
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      const ow = await member(c, a, "owner");
      await signIn(c, a, ow.sub);
      expect((await refusal(c, UNDO, [a.accountId, mergeId, null]))?.code, "access off").toBe("42501");
      expect(await val(c, "select undone_at as v from public.contact_merges where id = $1", [mergeId])).toBeNull();
    }));
  it("who: Staff undoes; the service role undoes with p_actor as undone_by, and without one is 22023", () =>
    withRollback(async (c) => {
      const { a, mergeId } = await undoWho(c, "uw2");
      await asService(c);
      expect((await refusal(c, UNDO, [a.accountId, mergeId, null]))?.code).toBe("22023");
      expect((await c.query<{ r: UndoAnswer }>(UNDO, [a.accountId, mergeId, "svc_actor"])).rows[0]!.r.status).toBe("undone");
      expect((await log(c, mergeId)).undone_by).toBe("svc_actor");
      const { a: b, mergeId: m2 } = await undoWho(c, "uw3");
      const s = await member(c, b, "staff");
      await signIn(c, b, s.sub);
      expect((await c.query<{ r: UndoAnswer }>(UNDO, [b.accountId, m2, null])).rows[0]!.r.status).toBe("undone");
      expect((await log(c, m2)).undone_by).toBe(s.sub);
    }));

  it("merged_by_hand is removed by its Undo; a suggested pair comes back (mutation: clear merge_id on both -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "uhand");
      const m = await merge(c, a, k, o);
      expect((await undo(c, a, m.mergeId!)).status).toBe("undone");
      expect(await flagOf(c, a.accountId, k, o)).toBeNull();
      const s = await seedAccount(c, "usugg");
      const k2 = await person(c, s.accountId, { first: "Ana", phone: "+19565550451" });
      const o2 = await person(c, s.accountId, { first: "Bea", phone: "+19565550451" });
      const m2 = await merge(c, s, k2, o2);
      expect((await undo(c, s, m2.mergeId!)).status).toBe("undone");
      expect(await flagOf(c, s.accountId, k2, o2)).toMatchObject({ reason: "same_phone", merge_id: null });
    }));
});

describe("0106 part B: the backstop (app.follow_merge, spec 7.2)", () => {
  it("a task inserted with O's id after the merge lands on K (mutation: drop tasks_follow_merge -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "bt");
      await merge(c, a, k, o);
      expect(await contactOf(c, "tasks", await SEEDS.tasks!(c, a, o))).toBe(k);
    }));
  it("an ai_acts insert naming O lands on K (insert-only trigger)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "bai");
      await merge(c, a, k, o);
      const call = await callRow(c, a, null);
      expect(await contactOf(c, "ai_acts", await one(c,
        "insert into public.ai_acts (account_id, actor, call_id, contact_id, kind, target) values ($1, 'voice', $2, $3, 'contact_created', '{}') returning id", [a.accountId, call, o]))).toBe(k);
    }));
  it("an update of a note's contact_id to O lands on K", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "bnote");
      const y = await person(c, a.accountId, { first: "Yola" });
      const note = await SEEDS.notes!(c, a, y);
      await merge(c, a, k, o);
      await c.query("update public.notes set contact_id = $2 where id = $1", [note, o]);
      expect(await contactOf(c, "notes", note)).toBe(k);
    }));
  it("contact_relationships.related_contact_id = O lands on K (the second function)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "brel");
      const y = await person(c, a.accountId, { first: "Yola" });
      await merge(c, a, k, o);
      const r = await relationship(c, a, y, o);
      expect(await val(c, "select related_contact_id as v from public.contact_relationships where id = $1", [r])).toBe(k);
    }));
  it("a Technician assigned to K (not O) inserting a task assigned to themselves for O lands it on K: the pointer is read as the definer (mutation: app.follow_merge without security definer -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "btech");
      const t = await member(c, a, "technician");
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [k, t.userId]);
      await merge(c, a, k, o);
      await signIn(c, a, t.sub);
      const { rows: [r] } = await c.query<{ contact_id: string }>(
        "insert into public.tasks (account_id, contact_id, title, assigned_to) values ($1, $2, 'Gate code', $3) returning contact_id", [a.accountId, o, t.userId]);
      expect(r!.contact_id).toBe(k);
    }));

  it("a late insert that collides with a row K already has (review m8b): a tag upsert is a no-op on K; an active skip answers 23505", () =>
    withRollback(async (c) => {
      const { a, k, o } = await pairOf(c, "bcoll");
      const t = await tag(c, a, k);
      await skip(c, a, k);
      await merge(c, a, k, o);
      await c.query("insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3) on conflict (contact_id, tag_id) do nothing", [o, t, a.accountId]);
      expect(await val(c, "select array_agg(contact_id::text) as v from public.contact_tags where tag_id = $1", [t])).toEqual([k]);
      expect((await refusal(c, "insert into public.document_requirement_skips (account_id, contact_id, category, skipped_by) values ($1, $2, 'insurance', 'user_x')",
        [a.accountId, o]))?.code).toBe("23505");
    }));

  const C_MOVES = ["automation_log", "bookings", "calls", "document_requests", "documents", "form_submissions", "notes", "opportunities", "places", "tasks"];
  const SPECIAL = ["client_group_members", "contact_duplicate_flags", "contact_relationships", "contact_tags", "conversations", "document_requirement_skips", "record_summaries"];
  const STAYS = ["ai_acts", "consent_events", "contact_archive_log", "proposals"];
  const SELF = ["contact_merges", "contacts"];
  const FK_TABLES = `select distinct rc.relname as t from pg_constraint k join pg_class rc on rc.oid = k.conrelid
                      where k.contype = 'f' and k.confrelid = 'public.contacts'::regclass order by 1`;
  it("every table with a foreign key into contacts is moved, handled, kept or the merge's own, and c_moves is exactly C_MOVES in both functions (review m6; mutation: a new FK table -> FAILS naming it)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ t: string }>(FK_TABLES);
      expect(rows.map((r) => r.t)).toEqual([...C_MOVES, ...SPECIAL, ...STAYS, ...SELF].sort());
      for (const fn of ["public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text)", "public.undo_contact_merge(uuid,bigint,text)"]) {
        const { rows: [p] } = await c.query<{ src: string }>("select prosrc as src from pg_proc where oid = $1::regprocedure", [fn]);
        const code = p!.src.replace(/--.*$/gm, ""); // a comment naming a table cannot satisfy this
        const lit = /c_moves constant text\[\] := array\[([^\]]*)\]/.exec(code)?.[1] ?? "";
        expect(lit.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean), fn).toEqual(C_MOVES);
        if (fn.startsWith("public.merge_contacts")) for (const t of SPECIAL) expect(code, t).toContain(`public.${t}`);
      }
      // The control: a throwaway FK table shows up in the same query, so the equality above can fail.
      await c.query("create table public.zz_fk_probe (account_id uuid, contact_id uuid, foreign key (account_id, contact_id) references public.contacts (account_id, id))");
      expect((await c.query<{ t: string }>(FK_TABLES)).rows.map((r) => r.t)).toContain("zz_fk_probe");
    }));

  const FOLLOW = (withTriggerFilter: boolean) =>
    `select rc.relname || '.' || a.attname as fk
       from pg_constraint k
       join pg_class rc on rc.oid = k.conrelid
       join pg_attribute a on a.attrelid = k.conrelid
        and a.attnum = (select x from unnest(k.conkey) as x where x <> (select attnum from pg_attribute where attrelid = k.conrelid and attname = 'account_id') limit 1)
      where k.contype = 'f' and k.confrelid = 'public.contacts'::regclass
        and rc.relname not in ('contacts', 'contact_merges', 'contact_duplicate_flags', 'contact_archive_log', 'record_summaries')
        ${withTriggerFilter ? `and not exists (
          select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
           where t.tgrelid = k.conrelid and not t.tgisinternal
             and p.proname = case when a.attname = 'related_contact_id' then 'follow_merge_related' else 'follow_merge' end)` : ""}
      order by 1`;
  it("every foreign key into contacts but the five named exclusions has a follow_merge trigger on its table (mutation: drop notes_follow_merge -> FAILS naming notes.contact_id)", () =>
    withRollback(async (c) => {
      expect((await c.query<{ fk: string }>(FOLLOW(true))).rows.map((r) => r.fk)).toEqual([]);
      // Not vacuous: the same query without the trigger filter lists 19 columns.
      expect((await c.query<{ fk: string }>(FOLLOW(false))).rows).toHaveLength(19);
    }));
});

/**
 * The race (plan review I2). Commits, so it runs only against a database on this machine: the local replica, or CI
 * verify's in-runner stack (ci-target-guard.sh pins SUPABASE_DB_URL to 127.0.0.1 or localhost). A URL with any query
 * string is refused (pg-connection-string lets ?host= override the authority; F-118's 0105 concurrency test). Its org
 * id carries the org_test_ prefix, so an account a killed run strands is one the fixture sweep removes.
 */
function onThisMachine(raw: string | undefined): boolean {
  if (!raw || raw.includes("?")) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
describe("0106 part B: the race runs only on this machine", () => {
  it.each([
    ["the local replica", "postgresql://postgres@localhost:55871/post", true],
    ["CI verify's in-runner stack", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", true],
    ["a ?host= that overrides localhost", "postgresql://postgres@localhost:5432/postgres?host=db.example.invalid", false],
    ["a cloud pooler", "postgresql://postgres.abcd:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres", false],
    ["a host that only starts with localhost", "postgresql://postgres@localhost.example.invalid:5432/postgres", false],
    ["no URL", undefined, false],
  ])("%s", (_name, raw, expected) => {
    expect(onThisMachine(raw)).toBe(expected);
  });
});

describe("0106 part B: a write racing a merge", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))(
    "while a merge holds its transaction, a task naming O waits and then lands on K, and a pair filed for K waits too (review I2; mutations: drop `for key share` from app.follow_merge -> the task lands on O, FAILS; the merge locks its contacts `for no key update` -> the task neither waits nor lands on K, FAILS)",
    async () => {
      const url = process.env.SUPABASE_DB_URL!;
      const connect = async () => { const p = new Pg({ connectionString: url, connectionTimeoutMillis: 10_000 }); await p.connect(); return p; };
      const setup = await connect(), merger = await connect(), writer = await connect();
      let agencyId = "", accountId = "", open = false;
      const pending: Promise<unknown>[] = [];
      try {
        agencyId = (await setup.query("insert into public.agencies (name) values ('Race') returning id")).rows[0].id;
        accountId = (await setup.query(
          "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Race') returning id", [agencyId, `org_test_merge_race_${RUN}`])).rows[0].id;
        const k = (await setup.query("insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, 'Keep', '+19565550461', 'person') returning id", [accountId])).rows[0].id;
        const o = (await setup.query("insert into public.contacts (account_id, first_name, author_kind) values ($1, 'Other', 'person') returning id", [accountId])).rows[0].id;
        const seen = (await setup.query("select public.contact_merge_preview($1, $2, $3) -> 'seen' as s", [accountId, k, o])).rows[0].s;
        await merger.query("begin"); open = true;
        await merger.query("set local role service_role");
        await merger.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
        const { rows: [m] } = await merger.query("select public.merge_contacts($1, $2, $3, '{}'::jsonb, $4::jsonb, 'race') as r", [accountId, k, o, JSON.stringify(seen)]);
        expect(m.r.status).toBe("merged");
        let taskSettled = false, pairSettled = false;
        const late = writer.query("insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'late') returning contact_id", [accountId, o])
          .finally(() => { taskSettled = true; });
        // A new contact with K's phone: the flag trigger files K-X, whose foreign-key check needs a KEY SHARE on K.
        const pair = setup.query("insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, 'Xavi', '+19565550461', 'person') returning id", [accountId])
          .finally(() => { pairSettled = true; });
        pending.push(late.catch(() => undefined), pair.catch(() => undefined));
        await new Promise((r) => setTimeout(r, 500));
        expect(taskSettled, "the task insert waits on the merge's row lock").toBe(false);
        expect(pairSettled, "the pair K-X waits on the merge's row lock").toBe(false);
        await merger.query("commit"); open = false;
        expect((await late).rows[0].contact_id).toBe(k);
        const x = (await pair).rows[0].id;
        expect((await setup.query("select reason from public.contact_duplicate_flags where account_id = $1 and contact_a = least($2::uuid, $3::uuid) and contact_b = greatest($2::uuid, $3::uuid)",
          [accountId, k, x])).rows).toEqual([{ reason: "same_phone" }]);
      } finally {
        if (open) await merger.query("rollback");
        await Promise.all(pending);
        if (accountId) {
          for (const t of ACCOUNT_OWNED_TABLES) await setup.query(`delete from public.${t} where account_id = $1`, [accountId]);
          await setup.query("delete from public.accounts where id = $1", [accountId]);
        }
        if (agencyId) await setup.query("delete from public.agencies where id = $1", [agencyId]);
        await Promise.all([setup.end(), merger.end(), writer.end()]);
      }
    });
});

describe("0106 part B: the backstop takes no lock the foreign key did not", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))(
    "while a transaction holds an uncommitted task naming C, an update of C's name does not wait (T3; mutation: app.follow_merge reads the pointer FOR SHARE -> the update waits, FAILS)",
    async () => {
      const url = process.env.SUPABASE_DB_URL!;
      const connect = async () => { const p = new Pg({ connectionString: url, connectionTimeoutMillis: 10_000 }); await p.connect(); return p; };
      const setup = await connect(), holder = await connect(), updater = await connect();
      let agencyId = "", accountId = "", open = false;
      try {
        agencyId = (await setup.query("insert into public.agencies (name) values ('Lock') returning id")).rows[0].id;
        accountId = (await setup.query(
          "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Lock') returning id", [agencyId, `org_test_merge_lock_${RUN}`])).rows[0].id;
        const cid = (await setup.query("insert into public.contacts (account_id, first_name, author_kind) values ($1, 'Cee', 'person') returning id", [accountId])).rows[0].id;
        await holder.query("begin"); open = true;
        await holder.query("insert into public.tasks (account_id, contact_id, title) values ($1, $2, 'held')", [accountId, cid]);
        // The control: the held task really is uncommitted, so the update below meets whatever lock it took.
        expect((await setup.query("select count(*)::int as n from public.tasks where contact_id = $1", [cid])).rows[0].n).toBe(0);
        await updater.query("set lock_timeout = '2s'");
        const t0 = Date.now();
        await updater.query("update public.contacts set first_name = 'Cee Dos' where id = $1", [cid]);
        expect(Date.now() - t0, "the update did not wait on the held task").toBeLessThan(1000);
        await holder.query("rollback"); open = false;
      } finally {
        if (open) await holder.query("rollback");
        if (accountId) {
          for (const t of ACCOUNT_OWNED_TABLES) await setup.query(`delete from public.${t} where account_id = $1`, [accountId]);
          await setup.query("delete from public.accounts where id = $1", [accountId]);
        }
        if (agencyId) await setup.query("delete from public.agencies where id = $1", [agencyId]);
        await Promise.all([setup.end(), holder.end(), updater.end()]);
      }
    });
});
