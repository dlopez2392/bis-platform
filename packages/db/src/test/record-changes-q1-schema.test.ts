import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0112_record_changes_q1.sql: the change log reaches the rest of the owner's Q1 set (households and businesses and
 * their members, places, equipment, deals, relationships and tags), merge_contacts and undo_contact_merge name their
 * author, and public.put_back_contact_custom (F-115 part 1; spec sections 2.2 to 2.4; plan Task 3).
 * RED BEFORE APPLY, legitimately: every case that reads an object or a row 0112 creates (the seven tables' triggers
 * and field lists, the merge's and the Undo's via, the put-back function, the bis.* pin's expected list): 24 of 29
 * on the replica (the merge's "(d)" among them: before 0112 it writes only contact rows). FIVE HOLD BEFORE 0112 and are not its red: "the contact list is 0111's", "delete_internal_contacts
 * as an Owner" (with no trigger on a child there is nothing for it to write), "restore_contact_on_sign" (0111 already
 * writes nothing for it), and the merge's "(b)" and "(c)" (before 0112 nothing sets bis.*, so nothing can leak).
 * They guard what 0112 must not break; each fails under its named mutation on 0112.
 * Replica only (withRollback).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };
type Row = {
  id: number; record_type: string; record_id: string; contact_id: string | null; client_group_id: string | null; op: string;
  field: string | null; before: unknown; after: unknown; author_kind: string | null; author_id: string | null; via: string | null;
};
let seq = 0;

/** record-changes-schema.test.ts's helpers, with this file's org prefix. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_rcq_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Record changes Q1') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Record changes Q1 test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function one(c: Client, sql: string, params: unknown[]): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(sql, params);
  return r!.id;
}
/** Seeds, as the table owner (a direct session: automation/'sql', never refused). */
const contact = (c: Client, a: Acct, first = "Dan") => one(c,
  "insert into public.contacts (account_id, first_name, phone, author_kind) values ($1, $2, '(956) 292-1696', 'person') returning id",
  [a.accountId, first]);
const group = (c: Client, a: Acct, kind: "household" | "business" = "household") => one(c,
  "insert into public.client_groups (account_id, kind, name) values ($1, $2, $3) returning id", [a.accountId, kind, `Garza ${RUN} ${++seq}`]);
const membership = (c: Client, a: Acct, g: string, k: string) => one(c,
  "insert into public.client_group_members (account_id, client_group_id, contact_id) values ($1, $2, $3) returning id", [a.accountId, g, k]);
const place = (c: Client, a: Acct, owner: { contact?: string; group?: string }) => one(c,
  "insert into public.places (account_id, contact_id, client_group_id, label, address) values ($1, $2, $3, 'Home', '1 Palm St') returning id",
  [a.accountId, owner.contact ?? null, owner.group ?? null]);
const unit = (c: Client, a: Acct, p: string) => one(c,
  "insert into public.equipment (account_id, place_id, name, make) values ($1, $2, 'AC', 'Carrier') returning id", [a.accountId, p]);
const relationship = (c: Client, a: Acct, from: string, to: string) => one(c,
  "insert into public.contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, 'sibling') returning id",
  [a.accountId, from, to]);
async function tag(c: Client, a: Acct, k: string): Promise<string> {
  const t = await one(c, "insert into public.tags (account_id, name) values ($1, $2) returning id", [a.accountId, `tag-${RUN}-${++seq}`]);
  await c.query("insert into public.contact_tags (account_id, contact_id, tag_id) values ($1, $2, $3)", [a.accountId, k, t]);
  return t;
}
async function deal(c: Client, a: Acct, k: string): Promise<{ id: string; pipeline: string; stage2: string }> {
  const p = await one(c, "insert into public.pipelines (account_id, name) values ($1, 'Sales') returning id", [a.accountId]);
  const s1 = await one(c, "insert into public.pipeline_stages (account_id, pipeline_id, name, position) values ($1, $2, 'New', 0) returning id", [a.accountId, p]);
  const s2 = await one(c, "insert into public.pipeline_stages (account_id, pipeline_id, name, position) values ($1, $2, 'Quoted', 1) returning id", [a.accountId, p]);
  const id = await one(c,
    "insert into public.opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1, $2, $3, $4, 'Roof') returning id",
    [a.accountId, k, p, s1]);
  return { id, pipeline: p, stage2: s2 };
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
/** contact-merge-schema.test.ts:60-64, plus the x-bis-author header PostgREST hands the database. */
async function asServiceWith(c: Client, author?: object): Promise<void> {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
  await c.query("select set_config('request.headers', $1, true)",
    [JSON.stringify(author === undefined ? {} : { "x-bis-author": JSON.stringify(author) })]);
}
async function enforce(c: Client, on: boolean) {
  await actAsOwner(c);
  await c.query("update app.record_changes_settings set enforce = $1", [on]);
}
/**
 * As the owner, the change rows of THIS test's account matching a where clause, oldest first. Every read of the log
 * is scoped to the test's own account: CI runs the suites concurrently on one stack, and under READ COMMITTED another
 * test's committed write lands past this test's `maxId` watermark (2026-11-03, PR #334: case (a) read another
 * account's contact insert by user_docs_test).
 */
async function rows(c: Client, a: Acct, where: string, params: unknown[]): Promise<Row[]> {
  await actAsOwner(c);
  const { rows: r } = await c.query<Row>(
    `select id::int as id, record_type, record_id, contact_id, client_group_id, op, field, before, after, author_kind, author_id, via
       from public.record_changes where account_id = $${params.length + 1} and (${where}) order by id`, [...params, a.accountId]);
  return r;
}
/** This account's rows written after a `maxId` watermark. */
const since = (c: Client, a: Acct, from: number) => rows(c, a, "id > $1", [from]);
const of = (c: Client, a: Acct, recordId: string, op?: string) =>
  rows(c, a, "record_id = $1 and ($2::text is null or op = $2)", [recordId, op ?? null]);
/** A watermark only, over every account: what lies past it is read through `rows`, which scopes it to one account. */
const maxId = async (c: Client) => {
  await actAsOwner(c);
  return (await c.query<{ m: number }>("select coalesce(max(id), 0)::int as m from public.record_changes")).rows[0]!.m;
};
const gucs = async (c: Client) => (await c.query<{ a: string; i: string; v: string }>(
  "select current_setting('bis.author', true) as a, current_setting('bis.author_id', true) as i, current_setting('bis.via', true) as v")).rows[0]!;
/** Only the fields a test compares. */
const brief = (r: Row) => ({ op: r.op, field: r.field, author_kind: r.author_kind, author_id: r.author_id, via: r.via });

/**
 * The AUDITED / EXCLUDED decision for every column of every Q1 table (spec 2.1 item 4). The rule: what a person
 * typed or chose is AUDITED; ids, account_id, timestamps, derived keys and creation provenance are EXCLUDED.
 * A new column fails this pin until it is decided here AND in 0112's app.record_change_fields.
 */
const Q1: Record<string, { table: string; audited: string[]; excluded: Record<string, string> }> = {
  client_group: {
    table: "client_groups",
    audited: ["name", "kind", "billing_address", "custom"],
    excluded: {
      id: "the row key (record_id, and client_group_id on every row)", account_id: "the tenant",
      name_key: "derived (0069, generated)", search_name: "derived (0108, generated)",
      created_at: "set once on insert", updated_at: "a timestamp",
    },
  },
  client_group_member: {
    table: "client_group_members",
    audited: ["role", "is_primary", "is_billing", "is_primary_contact"],
    excluded: {
      id: "the row key", account_id: "the tenant",
      client_group_id: "the parent: on every row as client_group_id",
      contact_id: "the parent: on every row as contact_id; only a merge re-points it (0106's log)",
      created_at: "set once on insert",
    },
  },
  place: {
    table: "places",
    // Who a place belongs to is a person's choice: setPlaceOwner moves it between a person and a group.
    audited: ["label", "address", "landmark", "directions", "city", "region", "postal_code", "country", "archived_at",
      "contact_id", "client_group_id"],
    excluded: {
      id: "the row key", account_id: "the tenant",
      created_by: "creation provenance (0073)", created_at: "set once on insert", updated_at: "a timestamp",
    },
  },
  equipment: {
    table: "equipment",
    audited: ["name", "make", "model", "serial", "notes", "installed_on", "warranty_until", "replaces_id"],
    excluded: {
      id: "the row key", account_id: "the tenant",
      place_id: "the parent: the row's contact and group are read from its place",
      created_by: "creation provenance (0073)", created_at: "set once on insert", updated_at: "a timestamp",
    },
  },
  opportunity: {
    table: "opportunities",
    audited: ["name", "pipeline_id", "stage_id", "status", "monetary_value", "assigned_to", "custom"],
    excluded: {
      id: "the row key", account_id: "the tenant",
      contact_id: "the parent: on every row as contact_id; only a merge re-points it (0106's log)",
      stage_changed_at: "a timestamp stamped with stage_id", status_changed_at: "a timestamp stamped with status",
      quote_followup_sent_at: "automation bookkeeping (the quote follow-up pass)",
      quote_followup_sms_failed_at: "automation bookkeeping (the quote follow-up pass)",
      created_by: "creation provenance (0073)", created_at: "set once on insert", updated_at: "a timestamp",
    },
  },
  contact_relationship: {
    table: "contact_relationships",
    audited: ["related_contact_id", "label_key", "custom_label", "contact_form", "related_form",
      "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency"],
    excluded: {
      id: "the row key", account_id: "the tenant",
      contact_id: "the parent: on every row as contact_id; only a merge re-points it (0106's log)",
      created_at: "set once on insert", updated_at: "a timestamp",
    },
  },
  contact_tag: {
    table: "contact_tags",
    audited: [],
    excluded: {
      contact_id: "the parent: on every row as contact_id", tag_id: "the record: on every row as record_id",
      account_id: "the tenant",
    },
  },
};

describe("0112: what each Q1 table records", () => {
  it.each(Object.keys(Q1))("column pin, %s: every column is AUDITED or EXCLUDED (mutation: add a column to places -> FAILS naming it)", (type) =>
    withRollback(async (c) => {
      const pin = Q1[type]!;
      const { rows: [f] } = await c.query<{ f: string[] | null }>("select app.record_change_fields($1) as f", [type]);
      expect(f!.f, "0112 lists the type").not.toBeNull();
      const audited = f!.f!;
      expect([...audited].sort()).toEqual([...pin.audited].sort());
      const { rows: cols } = await c.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [pin.table]);
      const live = cols.map((r) => r.column_name);
      expect(live.length, pin.table).toBeGreaterThan(0);
      expect(live.filter((n) => !audited.includes(n) && !(n in pin.excluded)), `${pin.table}: undecided columns`).toEqual([]);
      expect(Object.keys(pin.excluded).filter((n) => !live.includes(n)), `${pin.table}: stale EXCLUDED names`).toEqual([]);
      expect(audited.filter((n) => !live.includes(n)), `${pin.table}: stale AUDITED names`).toEqual([]);
      expect(audited.filter((n) => n in pin.excluded), `${pin.table}: in both lists`).toEqual([]);
    }));

  it("the contact list is 0111's, and an unknown type has none (mutation: drop 'custom' from contact in 0112 -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ k: string[]; x: string[] | null }>(
        "select app.record_change_fields('contact') as k, app.record_change_fields('booking') as x");
      expect([...r!.k].sort()).toEqual(["assigned_to", "custom", "dnd", "email", "first_name", "language", "last_name",
        "marketing_email_opted_out_at", "phone", "source"]);
      expect(r!.x).toBeNull();
    }));

  it("every Q1 table has the client and server pair: after insert, update or delete, WHEN on current_user, its record_type first (mutation: drop record_changes_server on places -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: t } = await c.query<{ tbl: string; def: string }>(
        `select c.relname as tbl, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and t.tgname like 'record_changes_%' and c.relnamespace = 'public'::regnamespace order by 1, 2`);
      const want = Object.entries({ contact: "contacts", ...Object.fromEntries(Object.entries(Q1).map(([k, v]) => [k, v.table])) })
        .flatMap(([type, tbl]) => [
          { tbl, def: `CREATE TRIGGER record_changes_client AFTER INSERT OR DELETE OR UPDATE ON public.${tbl} FOR EACH ROW WHEN ((CURRENT_USER = 'authenticated'::name)) EXECUTE FUNCTION app.record_changes_capture('${type}', 'client')` },
          { tbl, def: `CREATE TRIGGER record_changes_server AFTER INSERT OR DELETE OR UPDATE ON public.${tbl} FOR EACH ROW WHEN ((CURRENT_USER <> 'authenticated'::name)) EXECUTE FUNCTION app.record_changes_capture('${type}', 'server')` },
        ])
        .sort((x, y) => x.tbl.localeCompare(y.tbl) || x.def.localeCompare(y.def));
      expect(t).toEqual(want);
    }));
});

describe("0112: a signed-in edit, table by table", () => {
  it("places: one row per changed field on the owner's timeline (a customer's or a household's); a no-op and a timestamp write nothing; an archive and a move to another owner are changes (mutation: leave contact_id out of place's list -> the move FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "place");
      const k = await contact(c, a);
      const g = await group(c, a);
      const pk = await place(c, a, { contact: k });
      const pg = await place(c, a, { group: g });
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("update public.places set label = 'Shop', city = 'McAllen' where id = $1", [pk]);
      await c.query("update public.places set label = 'Shop', updated_at = now() where id = $1", [pk]);
      await c.query("update public.places set archived_at = now() where id = $1", [pk]);
      await c.query("update public.places set landmark = 'Blue gate' where id = $1", [pg]);
      // setPlaceOwner's write: the household's place moves to the customer, so it now shows on the customer's timeline.
      await c.query("update public.places set contact_id = $2, client_group_id = null, updated_at = now() where id = $1", [pg, k]);
      const got = await since(c, a, from);
      expect(got.map((r) => ({ ...brief(r), record_type: r.record_type, record_id: r.record_id, contact_id: r.contact_id, client_group_id: r.client_group_id }))).toEqual([
        { op: "update", field: "label", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pk, contact_id: k, client_group_id: null },
        { op: "update", field: "city", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pk, contact_id: k, client_group_id: null },
        { op: "update", field: "archived_at", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pk, contact_id: k, client_group_id: null },
        { op: "update", field: "landmark", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pg, contact_id: null, client_group_id: g },
        { op: "update", field: "contact_id", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pg, contact_id: k, client_group_id: null },
        { op: "update", field: "client_group_id", author_kind: "person", author_id: sub, via: null, record_type: "place", record_id: pg, contact_id: k, client_group_id: null },
      ]);
      expect(got.slice(4).map((r) => [r.before, r.after])).toEqual([[null, k], [g, null]]);
      expect(got.slice(0, 2).map((r) => [r.before, r.after])).toEqual([["Home", "Shop"], [null, "McAllen"]]);
    }));

  it("equipment: its rows carry its place's contact or group (mutation: drop the equipment lookup -> contact_id null -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "unit");
      const k = await contact(c, a);
      const g = await group(c, a);
      const pk = await place(c, a, { contact: k });
      const pg = await place(c, a, { group: g });
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [u] } = await c.query<{ id: string }>(
        "insert into public.equipment (account_id, place_id, name, make, model) values ($1, $2, 'Water heater', 'Rheem', 'X1') returning id", [a.accountId, pk]);
      await c.query("update public.equipment set model = 'X2', serial = 'S-9' where id = $1", [u!.id]);
      await c.query("insert into public.equipment (account_id, place_id, name) values ($1, $2, 'Pump')", [a.accountId, pg]);
      const got = await since(c, a, from);
      expect(got.map((r) => ({ ...brief(r), record_type: r.record_type, contact_id: r.contact_id, client_group_id: r.client_group_id }))).toEqual([
        { op: "insert", field: null, author_kind: "person", author_id: sub, via: null, record_type: "equipment", contact_id: k, client_group_id: null },
        { op: "update", field: "model", author_kind: "person", author_id: sub, via: null, record_type: "equipment", contact_id: k, client_group_id: null },
        { op: "update", field: "serial", author_kind: "person", author_id: sub, via: null, record_type: "equipment", contact_id: k, client_group_id: null },
        { op: "insert", field: null, author_kind: "person", author_id: sub, via: null, record_type: "equipment", contact_id: null, client_group_id: g },
      ]);
      expect(got[0]!.record_id).toBe(u!.id);
      expect(Object.keys(got[0]!.after as object).sort()).toEqual([...Q1.equipment!.audited].sort());
      expect(got[0]!.after).toMatchObject({ name: "Water heater", make: "Rheem", model: "X1", replaces_id: null });
    }));

  it("deals: stage, value, status and each custom key are changes; the stamps alone are not (mutation: audit stage_changed_at -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "deal");
      const k = await contact(c, a);
      const d = await deal(c, a, k);
      await actAsOwner(c);
      await c.query(`update public.opportunities set custom = '{"roof":"tile"}'::jsonb where id = $1`, [d.id]);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("update public.opportunities set stage_changed_at = now() - interval '1 day' where id = $1", [d.id]);
      await c.query(`update public.opportunities set stage_id = $2, stage_changed_at = now(), monetary_value = 1200, status = 'won',
                       status_changed_at = now(), custom = '{"roof":"metal","sqft":"1800"}'::jsonb where id = $1`, [d.id, d.stage2]);
      const got = await since(c, a, from);
      expect(got.every((r) => r.record_type === "opportunity" && r.record_id === d.id && r.contact_id === k && r.client_group_id === null)).toBe(true);
      expect(got.every((r) => r.author_kind === "person" && r.author_id === sub)).toBe(true);
      expect(got.map((r) => [r.field, r.before, r.after]).sort()).toEqual([
        ["custom.roof", "tile", "metal"], ["custom.sqft", null, "1800"], ["monetary_value", 0, 1200],
        ["stage_id", expect.any(String), d.stage2], ["status", "open", "won"],
      ].sort());
    }));

  it("relationships: the insert snapshot names who they are related to; a side flag is a change (mutation: snapshot to_jsonb(new) -> 'created_at' appears -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rel");
      const k = await contact(c, a);
      const s = await contact(c, a, "Sis");
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [r] } = await c.query<{ id: string }>(
        "insert into public.contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, 'sibling') returning id",
        [a.accountId, k, s]);
      await c.query("update public.contact_relationships set related_can_pick_up = true, updated_at = now() where id = $1", [r!.id]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ ...brief(x), record_id: x.record_id, contact_id: x.contact_id }))).toEqual([
        { op: "insert", field: null, author_kind: "person", author_id: sub, via: null, record_id: r!.id, contact_id: k },
        { op: "update", field: "related_can_pick_up", author_kind: "person", author_id: sub, via: null, record_id: r!.id, contact_id: k },
      ]);
      expect(Object.keys(got[0]!.after as object).sort()).toEqual([...Q1.contact_relationship!.audited].sort());
      expect(got[0]!.after).toMatchObject({ related_contact_id: s, label_key: "sibling", related_can_pick_up: false });
    }));

  it("tags: added and removed, keyed by the tag (mutation: record_id from the row's id -> null -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "tag");
      const k = await contact(c, a);
      const t = await one(c, "insert into public.tags (account_id, name) values ($1, 'VIP') returning id", [a.accountId]);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("insert into public.contact_tags (account_id, contact_id, tag_id) values ($1, $2, $3)", [a.accountId, k, t]);
      await c.query("delete from public.contact_tags where contact_id = $1 and tag_id = $2", [k, t]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ ...brief(x), record_type: x.record_type, record_id: x.record_id, contact_id: x.contact_id, before: x.before, after: x.after }))).toEqual([
        { op: "insert", field: null, author_kind: "person", author_id: sub, via: null, record_type: "contact_tag", record_id: t, contact_id: k, before: null, after: null },
        { op: "delete", field: null, author_kind: "person", author_id: sub, via: null, record_type: "contact_tag", record_id: t, contact_id: k,
          before: { account_id: a.accountId, contact_id: k, tag_id: t }, after: null },
      ]);
    }));

  it("households and members (server-only writes): the group's rows are its own, a member's carry both ids; enforce refuses a service write with no author (mutation: drop the client_group case of the group id -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "group");
      const k = await contact(c, a);
      const from = await maxId(c);
      const staff = { kind: "person", id: "user_rcq_staff" };
      await asServiceWith(c, staff);
      const { rows: [g] } = await c.query<{ id: string }>(
        "insert into public.client_groups (account_id, kind, name) values ($1, 'household', 'Garza home') returning id", [a.accountId]);
      await c.query(`update public.client_groups set name = 'Garza house', custom = '{"gate":"4411"}'::jsonb, updated_at = now() where id = $1`, [g!.id]);
      const { rows: [m] } = await c.query<{ id: string }>(
        "insert into public.client_group_members (account_id, client_group_id, contact_id) values ($1, $2, $3) returning id", [a.accountId, g!.id, k]);
      await c.query("update public.client_group_members set role = 'Owner', is_billing = true where id = $1", [m!.id]);
      await c.query("delete from public.client_group_members where id = $1", [m!.id]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ ...brief(x), record_type: x.record_type, record_id: x.record_id, contact_id: x.contact_id, client_group_id: x.client_group_id }))).toEqual([
        { op: "insert", field: null, author_kind: "person", author_id: staff.id, via: null, record_type: "client_group", record_id: g!.id, contact_id: null, client_group_id: g!.id },
        { op: "update", field: "name", author_kind: "person", author_id: staff.id, via: null, record_type: "client_group", record_id: g!.id, contact_id: null, client_group_id: g!.id },
        { op: "update", field: "custom.gate", author_kind: "person", author_id: staff.id, via: null, record_type: "client_group", record_id: g!.id, contact_id: null, client_group_id: g!.id },
        { op: "insert", field: null, author_kind: "person", author_id: staff.id, via: null, record_type: "client_group_member", record_id: m!.id, contact_id: k, client_group_id: g!.id },
        { op: "update", field: "role", author_kind: "person", author_id: staff.id, via: null, record_type: "client_group_member", record_id: m!.id, contact_id: k, client_group_id: g!.id },
        { op: "update", field: "is_billing", author_kind: "person", author_id: staff.id, via: null, record_type: "client_group_member", record_id: m!.id, contact_id: k, client_group_id: g!.id },
        { op: "delete", field: null, author_kind: "person", author_id: staff.id, via: null, record_type: "client_group_member", record_id: m!.id, contact_id: k, client_group_id: g!.id },
      ]);
      expect(got[6]!.before).toMatchObject({ id: m!.id, role: "Owner", is_billing: true, contact_id: k, client_group_id: g!.id });
      // The app's group writes are service-only (0069): with enforce on, one with no author is refused and rolls back.
      await enforce(c, true);
      await asServiceWith(c);
      expect(await refusal(c, "update public.client_groups set name = 'Unsigned' where id = $1", [g!.id]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
    }));
});

describe("0112: removals", () => {
  it("delete_internal_contacts as an Owner: one values-free delete row (person, the Owner's sub); its tags, membership, relationships on EITHER side, places and their equipment write nothing (mutation: drop the child early return -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "purge");
      const k = await contact(c, a, "Gone");
      const s = await contact(c, a, "Stays");
      const s2 = await contact(c, a, "Also stays");
      const g = await group(c, a);
      await tag(c, a, k);
      await membership(c, a, g, k);
      await relationship(c, a, k, s);
      const back = await relationship(c, a, s2, k);   // the purged contact on the RELATED side: the survivor's row
      const p = await place(c, a, { contact: k });
      const u = await unit(c, a, p);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [d] } = await c.query<{ d: string[] }>("select public.delete_internal_contacts($1, $2) as d", [a.accountId, [k]]);
      expect(d!.d).toEqual([k]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ ...brief(x), record_type: x.record_type, record_id: x.record_id, before: x.before, after: x.after }))).toEqual([
        { op: "delete", field: null, author_kind: "person", author_id: sub, via: null, record_type: "contact", record_id: k, before: null, after: null },
      ]);
      // And nothing of the purged contact's survives on any timeline: the survivor's relationship row, the unit.
      expect(await of(c, a, back, "delete")).toEqual([]);
      expect(await of(c, a, u, "delete")).toEqual([]);
      expect((await rows(c, a, "contact_id = $1", [k])).map((x) => x.op)).toEqual(["delete"]);
    }));

  it("a household's removal is its own row with a before snapshot; its members, places and their equipment write nothing (mutation: drop the child early return -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "gdel");
      const k = await contact(c, a);
      const g = await group(c, a);
      await membership(c, a, g, k);
      const p = await place(c, a, { group: g });
      await unit(c, a, p);
      const from = await maxId(c);
      await asServiceWith(c, { kind: "person", id: "user_rcq_owner" });
      await c.query("delete from public.client_groups where id = $1", [g]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ ...brief(x), record_type: x.record_type, record_id: x.record_id, client_group_id: x.client_group_id }))).toEqual([
        { op: "delete", field: null, author_kind: "person", author_id: "user_rcq_owner", via: null, record_type: "client_group", record_id: g, client_group_id: g },
      ]);
      expect(got[0]!.before).toMatchObject({ id: g, kind: "household" });
    }));

  it("a place's removal is its own row; its equipment writes nothing; a unit removed on its own keeps its snapshot for Restore (mutation: drop the equipment place-gone return -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pdel");
      const k = await contact(c, a);
      const p = await place(c, a, { contact: k });
      const u1 = await unit(c, a, p);
      const p2 = await place(c, a, { contact: k });
      const u2 = await unit(c, a, p2);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("delete from public.equipment where id = $1", [u2]);
      // A member deletes only an EMPTY place (0071's places_delete_empty), so a place that still holds a unit goes
      // through server code: the unit cascades with it.
      await asServiceWith(c, { kind: "person", id: sub });
      await c.query("delete from public.places where id = $1", [p]);
      const got = await since(c, a, from);
      expect(got.map((x) => ({ op: x.op, record_type: x.record_type, record_id: x.record_id, contact_id: x.contact_id, author_id: x.author_id }))).toEqual([
        { op: "delete", record_type: "equipment", record_id: u2, contact_id: k, author_id: sub },
        { op: "delete", record_type: "place", record_id: p, contact_id: k, author_id: sub },
      ]);
      expect(got[0]!.before).toMatchObject({ id: u2, place_id: p2, name: "AC", make: "Carrier" });
      expect(await of(c, a, u1, "delete")).toEqual([]);
    }));

  it("restore_contact_on_sign changes only EXCLUDED columns: no change row, and enforce never refuses it (mutation: audit archived_at for contacts -> 42501 -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "sign");
      const k = await contact(c, a);
      await actAsOwner(c);
      await c.query("update public.contacts set archived_at = now() where id = $1", [k]);
      await enforce(c, true);
      const from = await maxId(c);
      await asServiceWith(c);   // the inbound-sign paths call it on a service client
      const { rows: [r] } = await c.query<{ r: boolean }>("select public.restore_contact_on_sign($1, $2, 'text') as r", [a.accountId, k]);
      expect(r!.r).toBe(true);
      expect(await since(c, a, from)).toEqual([]);
      const { rows: [log] } = await c.query<{ author_kind: string }>(
        "select author_kind from public.contact_archive_log where contact_id = $1 and action = 'restored'", [k]);
      expect(log!.author_kind).toBe("customer");
    }));
});

/** A merge as the app's request client (contact-merge-schema.test.ts's mergeArgs/merge), K keeping O's email. */
async function mergePair(c: Client, a: Acct) {
  const k = await one(c, "insert into public.contacts (account_id, first_name, email, author_kind) values ($1, 'Keep', 'keep@example.com', 'person') returning id", [a.accountId]);
  const o = await one(c, "insert into public.contacts (account_id, first_name, email, author_kind) values ($1, 'Other', 'other@example.com', 'person') returning id", [a.accountId]);
  const g = await group(c, a);
  await membership(c, a, g, k);
  const om = await membership(c, a, g, o);   // both in one group: the other's membership is REMOVED (and Undo puts it back)
  return { k, o, om };
}
async function merge(c: Client, a: Acct, k: string, o: string): Promise<number> {
  await actAsOwner(c);
  const { rows: [s] } = await c.query<{ v: unknown }>("select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [a.accountId, k, o]);
  await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query<{ r: { status: string; mergeId: number } }>(
    "select public.merge_contacts($1, $2, $3, $4::jsonb, $5::jsonb, null) as r",
    [a.accountId, k, o, JSON.stringify({ email: "other" }), JSON.stringify(s!.v)]);
  expect(r!.r.status).toBe("merged");
  await actAsOwner(c);
  return r!.r.mergeId;
}
const UNDO = "select public.undo_contact_merge($1, $2, $3) ->> 'status' as s";

describe("0112: undo_contact_merge names its author", () => {
  it("as an Owner: the reverse rows are the person's (the token's sub, never p_actor) with via merge:<id> (mutation: drop the set_config -> via null -> FAILS; mutation: coalesce(p_actor, sub) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "undo");
      const { k, o, om } = await mergePair(c, a);
      const mergeId = await merge(c, a, k, o);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      const from = await maxId(c);
      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [u] } = await c.query<{ s: string }>(UNDO, [a.accountId, mergeId, "user_forged"]);
      expect(u!.s).toBe("undone");
      const got = await since(c, a, from);
      const email = got.find((x) => x.record_type === "contact" && x.field === "email");
      expect(email && { ...brief(email), before: email.before, after: email.after }).toEqual(
        { op: "update", field: "email", author_kind: "person", author_id: sub, via: `merge:${mergeId}`, before: "other@example.com", after: "keep@example.com" });
      const back = got.find((x) => x.record_type === "client_group_member" && x.record_id === om);
      expect(back && brief(back)).toEqual({ op: "insert", field: null, author_kind: "person", author_id: sub, via: `merge:${mergeId}` });
      // Every row the Undo wrote is the person's, with the merge's via: none left unattributed or unlinked.
      expect(got.filter((x) => !(x.author_kind === "person" && x.author_id === sub && x.via === `merge:${mergeId}`)).map(brief)).toEqual([]);
    }));

  it("on a service client: p_actor is the person, the bis.* setting outranks a missing header, and enforce does not refuse it (mutation: drop the set_config -> 42501 -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "undosvc");
      const { k, o } = await mergePair(c, a);
      const mergeId = await merge(c, a, k, o);
      await enforce(c, true);
      const from = await maxId(c);
      await asServiceWith(c);
      const { rows: [u] } = await c.query<{ s: string }>(UNDO, [a.accountId, mergeId, "user_rcq_svc"]);
      expect(u!.s).toBe("undone");
      const got = await since(c, a, from);
      expect(got.length).toBeGreaterThan(0);
      expect(got.filter((x) => !(x.author_kind === "person" && x.author_id === "user_rcq_svc" && x.via === `merge:${mergeId}`)).map(brief)).toEqual([]);
    }));

  it("test 10b: every answer leaves bis.author, bis.author_id and bis.via unset, so a later service write in the same transaction is not the merge's (mutation: drop any one reset -> that status FAILS by name)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "reset");
      // undone, then already_undone.
      const p1 = await mergePair(c, a);
      const m1 = await merge(c, a, p1.k, p1.o);
      // later_merge: two merges into one record, the older one undone first.
      const x = await mergePair(c, a);
      const mx1 = await merge(c, a, x.k, x.o);
      const x2 = await one(c, "insert into public.contacts (account_id, first_name, author_kind) values ($1, 'Third', 'person') returning id", [a.accountId]);
      await merge(c, a, x.k, x2);
      // expired.
      const e = await mergePair(c, a);
      const me = await merge(c, a, e.k, e.o);
      await actAsOwner(c);
      await c.query("update public.contact_merges set merged_at = now() - interval '31 days', undo_until = now() - interval '1 day' where id = $1", [me]);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      const cases: [number, string][] = [[m1, "undone"], [m1, "already_undone"], [mx1, "later_merge"], [me, "expired"], [999999999, "not_found"]];
      for (const [mergeId, status] of cases) {
        await actAs(c, { org_id: a.orgId, sub });
        const { rows: [u] } = await c.query<{ s: string }>(UNDO, [a.accountId, mergeId, null]);
        expect(u!.s, status).toBe(status);
        expect(await gucs(c), status).toEqual({ a: "", i: "", v: "" });
      }
      // The proof the reset matters: in the same transaction, a service write with no author is refused (enforce).
      await enforce(c, true);
      await asServiceWith(c);
      expect(await refusal(c, "update public.contacts set first_name = 'After' where id = $1", [p1.k]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
    }));
});

/** An Owner's merge of o into k keeping o's email, as the request client sends it: the answer and the Owner's sub. */
const MERGE = "select public.merge_contacts($1, $2, $3, $4::jsonb, $5::jsonb, null) as r";
async function mergeAsOwner(c: Client, a: Acct, k: string, o: string, seen?: object):
    Promise<{ r: { status: string; mergeId?: number }; sub: string }> {
  await actAsOwner(c);
  const s = seen ?? (await c.query<{ v: object }>("select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [a.accountId, k, o])).rows[0]!.v;
  const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
  const { rows: [r] } = await c.query<{ r: { status: string; mergeId?: number } }>(
    MERGE, [a.accountId, k, o, JSON.stringify({ email: "other" }), JSON.stringify(s)]);
  return { r: r!.r, sub };
}
/** No bis.* setting holds a value (never set, or set back to ''). */
const unset = async (c: Client) => {
  const g = await gucs(c);
  return { a: g.a ?? "", i: g.i ?? "", v: g.v ?? "" };
};

describe("0112: merge_contacts names its author (orchestrator ruling: the merge's id reserved before its first write)", () => {
  it("(a) as an Owner: every row the merge writes (fields, places, memberships, tags) is the person's with via merge:<that merge's own id>; a later plain insert does not collide (mutations: drop the set_config -> FAILS; insert the merge row without the reserved id -> via no longer matches -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "mergeA");
      const { k, o, om } = await mergePair(c, a);
      const p = await place(c, a, { contact: o });
      const t = await tag(c, a, o);
      await c.query("insert into public.contact_tags (account_id, contact_id, tag_id) values ($1, $2, $3)", [a.accountId, k, t]);   // both have it
      const from = await maxId(c);
      const { r, sub } = await mergeAsOwner(c, a, k, o);
      expect(r.status).toBe("merged");
      const via = `merge:${r.mergeId}`;
      const got = await since(c, a, from);
      expect([...new Set(got.map((x) => x.record_type))].sort()).toEqual(["client_group_member", "contact", "contact_tag", "place"]);
      expect(got.filter((x) => !(x.author_kind === "person" && x.author_id === sub && x.via === via))
        .map((x) => ({ ...brief(x), record_type: x.record_type }))).toEqual([]);
      expect(got.find((x) => x.record_type === "contact" && x.field === "email"))
        .toMatchObject({ record_id: k, before: "keep@example.com", after: "other@example.com" });
      expect(got.find((x) => x.record_type === "place" && x.record_id === p)).toMatchObject({ field: "contact_id", before: o, after: k });
      expect(got.find((x) => x.record_type === "client_group_member" && x.record_id === om)).toMatchObject({ op: "delete", contact_id: o });
      expect(got.find((x) => x.record_type === "contact_tag" && x.record_id === t)).toMatchObject({ op: "delete", contact_id: o });
      // The via names the merge row the app shows, the one Undo reads.
      await actAsOwner(c);
      const { rows: [m] } = await c.query<{ id: string }>("select id::text as id from public.contact_merges where keep_id = $1 and other_id = $2", [k, o]);
      expect(`merge:${m!.id}`).toBe(via);
      // The identity sequence moved past the reserved id: a plain insert (the column default) lands after it.
      const { rows: [n] } = await c.query<{ id: string }>(
        `insert into public.contact_merges (account_id, keep_id, other_id, merged_by, merged_at, undo_until, keep_before, keep_after,
                                            choices, moved, moved_counts, removed)
         select account_id, other_id, keep_id, merged_by, merged_at, undo_until, keep_before, keep_after, choices, moved, moved_counts, removed
           from public.contact_merges where id = $1 returning id::text as id`, [m!.id]);
      expect(BigInt(n!.id)).toBeGreaterThan(BigInt(m!.id));
    }));

  it("(b) the reset holds: after the merge, a service update with no author in the same transaction is refused under enforce (mutation: drop the reset before the merged return -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "mergeB");
      const { k, o } = await mergePair(c, a);
      const { r } = await mergeAsOwner(c, a, k, o);
      expect(r.status).toBe("merged");
      expect(await unset(c)).toEqual({ a: "", i: "", v: "" });
      await enforce(c, true);
      await asServiceWith(c);
      expect(await refusal(c, "update public.contacts set first_name = 'After' where id = $1", [k]))
        .toEqual({ code: "42501", message: "record_changes: a server write must say who made it" });
    }));

  it("(c) a refused, stale or failed merge leaves no bis.* set (mutation: set the author before the refusals and drop their resets -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "mergeC");
      const { k, o } = await mergePair(c, a);
      const answers: [string, () => Promise<{ r: { status: string } }>][] = [
        ["same", () => mergeAsOwner(c, a, k, k, { keep: "", other: "" })],
        ["not_found", () => mergeAsOwner(c, a, k, "00000000-0000-4000-8000-000000000001", { keep: "", other: "" })],
        ["stale", () => mergeAsOwner(c, a, k, o, { keep: "x", other: "y" })],
      ];
      for (const [status, run] of answers) {
        expect((await run()).r.status, status).toBe(status);
        expect(await unset(c), status).toEqual({ a: "", i: "", v: "" });
      }
      // Failed AFTER the author is set: the merge row's insert raises, and the rollback takes the settings with it.
      await actAsOwner(c);
      await c.query(`create function public.t_rcq_fail() returns trigger language plpgsql as $f$
        begin raise exception 't_rcq_fail' using errcode = 'P0001'; end $f$`);
      await c.query("create trigger t_rcq_fail before insert on public.contact_merges for each row execute function public.t_rcq_fail()");
      const seen = (await c.query<{ v: object }>("select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [a.accountId, k, o])).rows[0]!.v;
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await actAs(c, { org_id: a.orgId, sub });
      expect(await refusal(c, MERGE, [a.accountId, k, o, JSON.stringify({ email: "other" }), JSON.stringify(seen)]))
        .toMatchObject({ code: "P0001", message: "t_rcq_fail" });
      expect(await unset(c)).toEqual({ a: "", i: "", v: "" });
      // already_merged, after a real merge.
      await actAsOwner(c);
      await c.query("drop trigger t_rcq_fail on public.contact_merges");
      expect((await mergeAsOwner(c, a, k, o)).r.status).toBe("merged");
      expect((await mergeAsOwner(c, a, k, o, { keep: "", other: "" })).r.status).toBe("already_merged");
      expect(await unset(c)).toEqual({ a: "", i: "", v: "" });
    }));

  it("(d) as an Owner passing p_actor 'user_forged': every change row the merge writes is the person's with the Owner's own sub, and no row of the account names user_forged (mutation: coalesce(p_actor, v_actor) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "mergeD");
      const { k, o, om } = await mergePair(c, a);
      const p = await place(c, a, { contact: o });
      const t = await tag(c, a, o);
      // Both have it, so the other's is REMOVED (a delete row); a tag only the other has moves and writes nothing.
      await c.query("insert into public.contact_tags (account_id, contact_id, tag_id) values ($1, $2, $3)", [a.accountId, k, t]);
      const from = await maxId(c);
      const seen =(await c.query<{ v: object }>("select public.contact_merge_preview($1, $2, $3) -> 'seen' as v", [a.accountId, k, o])).rows[0]!.v;
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(sub).not.toBe("user_forged");
      // A signed-in caller passes a p_actor of its own choosing: 0106 trusts p_actor on a service-role JWT only.
      const { rows: [r] } = await c.query<{ r: { status: string; mergeId: number } }>(
        "select public.merge_contacts($1, $2, $3, $4::jsonb, $5::jsonb, $6) as r",
        [a.accountId, k, o, JSON.stringify({ email: "other" }), JSON.stringify(seen), "user_forged"]);
      expect(r!.r.status).toBe("merged");
      const got = await since(c, a, from);
      // The merge wrote rows of every kind it touches, so the check below is over real rows, not an empty list.
      expect([...new Set(got.map((x) => x.record_type))].sort()).toEqual(["client_group_member", "contact", "contact_tag", "place"]);
      expect(got.find((x) => x.record_type === "place" && x.record_id === p)).toMatchObject({ author_kind: "person", author_id: sub });
      expect(got.find((x) => x.record_type === "client_group_member" && x.record_id === om)).toMatchObject({ author_kind: "person", author_id: sub });
      expect(got.find((x) => x.record_type === "contact_tag" && x.record_id === t)).toMatchObject({ author_kind: "person", author_id: sub });
      expect(got.filter((x) => !(x.author_kind === "person" && x.author_id === sub))
        .map((x) => ({ ...brief(x), record_type: x.record_type }))).toEqual([]);
      // Nowhere in the account: not in its change log (any row, not only the merge's), its merge rows, or its events.
      // Scoped to the account like every other read here (contact-authors.test.ts writes 'user_forged' too).
      await actAsOwner(c);
      const { rows: [n] } = await c.query<{ rc: number; cm: number; ev: number }>(
        `select (select count(*) from public.record_changes where account_id = $1 and author_id = 'user_forged')::int as rc,
                (select count(*) from public.contact_merges where account_id = $1 and (merged_by = 'user_forged' or undone_by = 'user_forged'))::int as cm,
                (select count(*) from public.events where account_id = $1 and actor_id = 'user_forged')::int as ev`, [a.accountId]);
      expect(n).toEqual({ rc: 0, cm: 0, ev: 0 });
    }));
});

describe("0112: put_back_contact_custom", () => {
  it("an invoker with its search_path pinned, EXECUTE to authenticated only (mutation: grant execute to anon -> FAILS; security definer -> FAILS)", () =>
    withRollback(async (c) => {
      const fn = "public.put_back_contact_custom(uuid,uuid,text,jsonb,jsonb)";
      const { rows: [p] } = await c.query<{ d: boolean; cfg: string[]; ret: string }>(
        "select prosecdef as d, proconfig as cfg, prorettype::regtype::text as ret from pg_proc where oid = $1::regprocedure", [fn]);
      expect(p).toEqual({ d: false, cfg: ["search_path=pg_catalog, pg_temp"], ret: "boolean" });
      const { rows: ex } = await c.query<{ r: string }>(
        "select r from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r, $1, 'EXECUTE') order by 1", [fn]);
      expect(ex.map((r) => r.r)).toEqual(["authenticated"]);
    }));

  it("lands only while the key still holds what the row says; a person mark, and a restore:<n> via (mutation: drop the is-not-distinct-from guard -> the stale case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "putback");
      const b = await seedAccount(c, "putbackB");
      const k = await one(c, `insert into public.contacts (account_id, first_name, custom, author_kind) values ($1, 'C', '{"gate":"9","dog":"Rex"}', 'person') returning id`, [a.accountId]);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      const PUT = "select public.put_back_contact_custom($1, $2, $3, $4::jsonb, $5::jsonb) as r";
      const from = await maxId(c);
      // Stale: the key no longer holds "8", so nothing is written and the answer is null.
      await actAs(c, { org_id: a.orgId, sub });
      expect((await c.query<{ r: boolean | null }>(PUT, [a.accountId, k, "gate", '"8"', '"1234"'])).rows[0]!.r).toBeNull();
      expect(await since(c, a, from)).toEqual([]);
      // Current: put back, with the via a Put back sends.
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("select set_config('request.headers', $1, true)", [JSON.stringify({ "x-bis-author": JSON.stringify({ kind: "person", via: "restore:7" }) })]);
      expect((await c.query<{ r: boolean | null }>(PUT, [a.accountId, k, "gate", '"9"', '"1234"'])).rows[0]!.r).toBe(true);
      // A null value takes the key away (it did not exist before).
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("select set_config('request.headers', '', true)");
      expect((await c.query<{ r: boolean | null }>(PUT, [a.accountId, k, "dog", '"Rex"', null])).rows[0]!.r).toBe(true);
      expect((await since(c, a, from)).map((x) => ({ ...brief(x), before: x.before, after: x.after }))).toEqual([
        { op: "update", field: "custom.gate", author_kind: "person", author_id: sub, via: "restore:7", before: "9", after: "1234" },
        { op: "update", field: "custom.dog", author_kind: "person", author_id: sub, via: null, before: "Rex", after: null },
      ]);
      await actAsOwner(c);
      expect((await c.query<{ custom: object }>("select custom from public.contacts where id = $1", [k])).rows[0]!.custom).toEqual({ gate: "1234" });
      // Another account's member reaches nothing (RLS: it is an invoker).
      const subB = await actAsMember(c, b.accountId, b.orgId, "owner");
      await actAs(c, { org_id: b.orgId, sub: subB });
      expect((await c.query<{ r: boolean | null }>(PUT, [a.accountId, k, "gate", '"1234"', '"0"'])).rows[0]!.r).toBeNull();
    }));
});

/** Every set_config call in a public or app function body, as (function, first argument). */
const EXPECTED_BIS_SETTERS = [
  "public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text) 'bis.author'",
  "public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text) 'bis.author_id'",
  "public.merge_contacts(uuid,uuid,uuid,jsonb,jsonb,text) 'bis.via'",
  "public.undo_contact_merge(uuid,bigint,text) 'bis.author'",
  "public.undo_contact_merge(uuid,bigint,text) 'bis.author_id'",
  "public.undo_contact_merge(uuid,bigint,text) 'bis.via'",
];

describe("0112: who may set bis.*", () => {
  it("every set_config in a public or app function is a listed definer setting a literal bis.* key (mutation: a new function that sets bis.author -> FAILS naming it)", () =>
    withRollback(async (c) => {
      await c.query("set local search_path to pg_catalog");   // so regprocedure names every schema, public included
      const { rows: r } = await c.query<{ x: string; d: boolean; cfg: string[] | null }>(
        `select distinct p.oid::regprocedure::text || ' ' || pg_catalog.btrim(m[1]) as x, p.prosecdef as d, p.proconfig as cfg
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          cross join lateral regexp_matches(p.prosrc, 'set_config[[:space:]]*[(][[:space:]]*([^,]*),', 'g') as m
          where n.nspname in ('public', 'app') order by 1`);
      expect(r.map((x) => x.x)).toEqual(EXPECTED_BIS_SETTERS);
      for (const x of r) expect({ x: x.x, d: x.d, cfg: x.cfg }).toEqual({ x: x.x, d: true, cfg: ["search_path=pg_catalog, pg_temp"] });
    }));
});
