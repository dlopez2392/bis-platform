import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * F-115 Task 6 (spec §2.4; plan Task 6, Step 2): the SQL that `record-restore.ts`'s `putBackChange`
 * and `restoreRemoved` issue over supabase-js, driven directly here since there is no PostgREST layer
 * in front of this replica (plan rule: "drive the replica cases at the exact SQL `putBackChange` and
 * `restoreRemoved` issue"). Each case names which function's statement it reproduces.
 * Replica only (withRollback), on 0001-0112 (pre = 0001-0111, post = pre + 0112; this file always
 * uses `post`, since Task 6 never runs against observe-only contacts alone).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };
type Row = {
  id: number; record_type: string; record_id: string; contact_id: string | null; client_group_id: string | null;
  op: string; field: string | null; before: unknown; after: unknown;
  author_kind: string | null; author_id: string | null; via: string | null; created_at: string;
};
let seq = 0;

/** record-changes-q1-schema.test.ts's own helpers, with this file's org prefix. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_rr_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Record restore') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Record restore test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function one(c: Client, sql: string, params: unknown[]): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(sql, params);
  return r!.id;
}
type ContactSeed = {
  first?: string; custom?: object; optedOutAt?: string | null;
  language?: string | null; languageSource?: string | null; languageSetAt?: string | null;
};
const contact = (c: Client, a: Acct, seed: ContactSeed = {}) => one(c,
  `insert into public.contacts
     (account_id, first_name, phone, custom, marketing_email_opted_out_at, language, language_source, language_set_at, author_kind)
   values ($1, $2, '(956) 555-0196', $3::jsonb, $4, $5, $6, $7, 'person') returning id`,
  [a.accountId, seed.first ?? "Dan", JSON.stringify(seed.custom ?? {}), seed.optedOutAt ?? null,
   seed.language ?? null, seed.languageSource ?? null, seed.languageSetAt ?? null]);
const group = (c: Client, a: Acct, kind: "household" | "business" = "household") => one(c,
  "insert into public.client_groups (account_id, kind, name) values ($1, $2, $3) returning id", [a.accountId, kind, `Garza ${RUN} ${++seq}`]);
const membership = (c: Client, a: Acct, g: string, k: string) => one(c,
  "insert into public.client_group_members (account_id, client_group_id, contact_id) values ($1, $2, $3) returning id", [a.accountId, g, k]);
const place = (c: Client, a: Acct, owner: { contact?: string; group?: string }, archivedAt: string | null = null) => one(c,
  "insert into public.places (account_id, contact_id, client_group_id, label, address, archived_at) values ($1, $2, $3, 'Home', '1 Palm St', $4) returning id",
  [a.accountId, owner.contact ?? null, owner.group ?? null, archivedAt]);
const unit = (c: Client, a: Acct, p: string) => one(c,
  "insert into public.equipment (account_id, place_id, name, make) values ($1, $2, 'AC', 'Carrier') returning id", [a.accountId, p]);
const relationship = (c: Client, a: Acct, from: string, to: string) => one(c,
  "insert into public.contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, 'sibling') returning id",
  [a.accountId, from, to]);
async function tagId(c: Client, a: Acct): Promise<string> {
  return one(c, "insert into public.tags (account_id, name) values ($1, $2) returning id", [a.accountId, `tag-${RUN}-${++seq}`]);
}
async function addTag(c: Client, a: Acct, k: string, t: string): Promise<void> {
  await actAsOwner(c);
  await c.query("insert into public.contact_tags (account_id, contact_id, tag_id) values ($1, $2, $3)", [a.accountId, k, t]);
}

/** The request.headers setting PostgREST hands the database (record-changes-schema.test.ts's own helper). */
async function header(c: Client, author?: object): Promise<void> {
  await c.query("select set_config('request.headers', $1, true)",
    [JSON.stringify(author === undefined ? {} : { "x-bis-author": JSON.stringify(author) })]);
}
async function asServiceWith(c: Client, author?: object): Promise<void> {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
  await header(c, author);
}
/** As the owner, every change row of one record, oldest first. account-scoped (CI concurrency). */
async function rowsOf(c: Client, a: Acct, recordId: string): Promise<Row[]> {
  await actAsOwner(c);
  const { rows } = await c.query<Row>(
    `select id::int as id, record_type, record_id, contact_id, client_group_id, op, field, before, after,
            author_kind, author_id, via, created_at
       from public.record_changes where account_id = $1 and record_id = $2 order by id`, [a.accountId, recordId]);
  return rows;
}
async function latest(c: Client, a: Acct, recordId: string): Promise<Row> {
  const r = await rowsOf(c, a, recordId);
  return r[r.length - 1]!;
}
/** The newest row of one op (restore_group_membership's own `app.promote_primary` can follow an
 *  insert with an `update` on the SAME record_id when the restored member was the contact's only
 *  one, so `latest()` alone is not reliable for THAT type — filter by op explicitly here). */
async function latestOp(c: Client, a: Acct, recordId: string, op: "insert" | "update" | "delete"): Promise<Row> {
  const r = (await rowsOf(c, a, recordId)).filter((x) => x.op === op);
  return r[r.length - 1]!;
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}

describe("putBackChange's SQL: a plain audited column (casUpdatePutBack)", () => {
  it("lands while unchanged, with via restore:<id> and author person (spec test 14)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pb1");
      const k = await contact(c, a, { first: "Dan" });

      // The original edit (Dan -> Daniel), client path: the row putBackChange's own read will find.
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, {});
      await c.query("update public.contacts set first_name = 'Daniel' where id = $1", [k]);
      const original = await latest(c, a, k);
      expect(original.field).toBe("first_name");

      // putBackChange: UPDATE contacts SET first_name = <before> WHERE account_id=.. AND id=.. AND
      // first_name = <after> RETURNING id, withAuthor(..., {person, sub}, `restore:<original.id>`).
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${original.id}` });
      const { rows } = await c.query(
        "update public.contacts set first_name = $1 where account_id = $2 and id = $3 and first_name = $4 returning id",
        [original.before, a.accountId, k, original.after]);
      expect(rows).toHaveLength(1);

      const putBack = await latest(c, a, k);
      expect(putBack.field).toBe("first_name");
      expect(putBack.before).toBe("Daniel");
      expect(putBack.after).toBe("Dan");
      expect(putBack.author_kind).toBe("person");
      expect(putBack.author_id).toBe(sub);
      expect(putBack.via).toBe(`restore:${original.id}`);
    }));

  it("refuses a stale value: zero rows once the live value no longer equals `after` (mutation: drop the CAS guard -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pb2");
      const k = await contact(c, a, { first: "Dan" });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, {});
      await c.query("update public.contacts set first_name = 'Daniel' where id = $1", [k]);
      const original = await latest(c, a, k);
      // Someone else's later edit: the live value no longer matches `original.after`.
      await c.query("update public.contacts set first_name = 'Changed' where id = $1", [k]);

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${original.id}` });
      const guarded = await c.query(
        "update public.contacts set first_name = $1 where account_id = $2 and id = $3 and first_name = $4 returning id",
        [original.before, a.accountId, k, original.after]);
      expect(guarded.rows).toHaveLength(0); // "changed"

      // The mutation: the SAME write with the CAS guard DROPPED succeeds, proving the guard is what refused it above.
      const unguarded = await c.query(
        "update public.contacts set first_name = $1 where account_id = $2 and id = $3 returning id",
        [original.before, a.accountId, k]);
      expect(unguarded.rows).toHaveLength(1);
    }));

  it("a Technician's own client reads nothing for a change row (not_found)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pb3");
      const k = await contact(c, a, { first: "Dan" });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, {});
      await c.query("update public.contacts set first_name = 'Daniel' where id = $1", [k]);
      const original = await latest(c, a, k);

      await actAsMember(c, a.accountId, a.orgId, "technician");
      const { rows } = await c.query("select id from public.record_changes where account_id = $1 and id = $2", [a.accountId, original.id]);
      expect(rows).toHaveLength(0);
      void sub;
    }));
});

describe("putBackChange's SQL: a timestamptz column (casUpdatePutBack's TIMESTAMP_FIELDS branch)", () => {
  it("guards the write with the LIVE read's own text, so a +00 vs -05 rendering of the same instant never falsely refuses", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pbts");
      const g = await group(c, a);
      const p = await place(c, a, { group: g });

      // Archive it under one session time zone (-05): the trigger's own to_jsonb renders `after` with that offset.
      await actAsOwner(c);
      await c.query("set local timezone = 'Etc/GMT+5'");
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("set local timezone = 'Etc/GMT+5'");
      await header(c, {});
      await c.query("update public.places set archived_at = '2026-06-01T12:00:00-05:00' where id = $1", [p]);
      const original = await latest(c, a, p);
      const afterText = original.after as string;
      expect(afterText).toMatch(/-05/);

      // A LATER request, a different session time zone (UTC): the LIVE read renders the SAME instant with "+00".
      await actAs(c, { org_id: a.orgId, sub });
      await c.query("set local timezone = 'UTC'");
      const { rows: [live] } = await c.query<{ archived_at: string }>("select archived_at::text as archived_at from public.places where id = $1", [p]);
      const liveText = live!.archived_at;
      expect(liveText).not.toBe(afterText); // different text,
      expect(Date.parse(liveText)).toBe(Date.parse(afterText)); // the SAME instant (casUpdatePutBack's own comparison).

      // The guarded write echoes the LIVE text back (never `after`'s own rendering) and still lands.
      await header(c, { kind: "person", via: `restore:${original.id}` });
      const { rows } = await c.query(
        "update public.places set archived_at = $1 where account_id = $2 and id = $3 and archived_at = $4 returning id",
        [null, a.accountId, p, liveText]);
      expect(rows).toHaveLength(1);
      const putBack = await latest(c, a, p);
      expect(putBack.field).toBe("archived_at");
      expect(putBack.after).toBe(null);
      expect(putBack.via).toBe(`restore:${original.id}`);
    }));
});

describe("putBackChange's SQL: contact.custom.<key> (put_back_contact_custom)", () => {
  it("lands while unchanged, false once stale", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pbc");
      const k = await contact(c, a, { custom: { referral_source: "a" } });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, {});
      await c.query("update public.contacts set custom = $1::jsonb where id = $2", [JSON.stringify({ referral_source: "b" }), k]);
      const original = await latest(c, a, k);
      expect(original.field).toBe("custom.referral_source");

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${original.id}` });
      const { rows: [ok] } = await c.query<{ put_back_contact_custom: boolean | null }>(
        "select public.put_back_contact_custom($1, $2, 'referral_source', $3::jsonb, $4::jsonb) as put_back_contact_custom",
        [a.accountId, k, JSON.stringify(original.after), JSON.stringify(original.before)]);
      expect(ok!.put_back_contact_custom).toBe(true);
      const putBack = await latest(c, a, k);
      expect(putBack.field).toBe("custom.referral_source");
      expect(putBack.via).toBe(`restore:${original.id}`);

      // Stale: a later edit moves the key again before a second put-back is tried.
      await c.query("update public.contacts set custom = $1::jsonb where id = $2", [JSON.stringify({ referral_source: "c" }), k]);
      const { rows: [stale] } = await c.query<{ put_back_contact_custom: boolean | null }>(
        "select public.put_back_contact_custom($1, $2, 'referral_source', $3::jsonb, $4::jsonb) as put_back_contact_custom",
        [a.accountId, k, JSON.stringify(original.after), JSON.stringify(original.before)]);
      expect(stale!.put_back_contact_custom).toBe(null);
    }));
});

describe("putBackChange's SQL: contact.language (putBackLanguage, 0076's coherence)", () => {
  // language/language_source/language_set_at are NOT in the authenticated column UPDATE grant on
  // contacts (0053:137-140 names first_name, last_name, email, phone, company_name, source,
  // assigned_to, dnd, custom, attribution, updated_at, marketing_email_opted_out_at — language is
  // absent). `setContactLanguage`/`restoreContactLanguage` both run on `serviceDb()` for exactly this
  // reason (apps/web/.../contacts/actions.ts); `putBackLanguage` does the same, with the full header
  // (service path, step 4) rather than the client path.
  it("putting a value back sets language_source 'staff' and a fresh language_set_at, not the historical source", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pbl1");
      const k = await contact(c, a, { language: "es", languageSource: "booking", languageSetAt: "2026-01-01T00:00:00+00:00" });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, {});
      await asServiceWith(c, { kind: "person", id: sub });
      await c.query("update public.contacts set language = 'en' where id = $1", [k]);
      const original = await latest(c, a, k);
      expect(original.field).toBe("language");
      expect(original.before).toBe("es");

      // The live read (putBackLanguage's own guard source) on the caller's own client, then the
      // guarded write on the SERVICE client with the full header. `language_set_at::text`, never the
      // bare column: `pg`'s own Date parser truncates a timestamptz to millisecond precision, which
      // would make the echoed-back guard value disagree with the microsecond-precision value still
      // stored (this file's own dbg1.mjs repro) — a bug of the TEST's driver, not of `putBackLanguage`,
      // which (like every other guard here) only ever handles PostgREST's own string rendering.
      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [cur] } = await c.query<{ language: string; language_source: string; language_set_at: string }>(
        "select language, language_source, language_set_at::text as language_set_at from public.contacts where id = $1", [k]);
      expect(cur!.language).toBe(original.after);
      await asServiceWith(c, { kind: "person", id: sub, via: `restore:${original.id}` });
      const now = new Date().toISOString();
      const { rows } = await c.query(
        `update public.contacts set language = $1, language_source = 'staff', language_set_at = $2
           where account_id = $3 and id = $4 and language = $5 and language_source = $6 and language_set_at = $7
         returning id`,
        [original.before, now, a.accountId, k, cur!.language, cur!.language_source, cur!.language_set_at]);
      expect(rows).toHaveLength(1);
      const { rows: [row] } = await c.query<{ language: string; language_source: string }>(
        "select language, language_source from public.contacts where id = $1", [k]);
      expect(row!.language).toBe("es");
      expect(row!.language_source).toBe("staff"); // NOT 'booking', the historical source history does not even carry.
      const putBack = await latest(c, a, k);
      expect(putBack.via).toBe(`restore:${original.id}`);
      expect(putBack.author_id).toBe(sub);
    }));

  it("putting language back to null clears language_source and language_set_at together (0076's coherence check)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pbl2");
      const k = await contact(c, a, { language: null, languageSource: null, languageSetAt: null });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await asServiceWith(c, { kind: "person", id: sub });
      await c.query("update public.contacts set language = 'es', language_source = 'staff', language_set_at = now() where id = $1", [k]);
      const original = await latest(c, a, k);
      expect(original.field).toBe("language");
      expect(original.before).toBe(null);

      await actAs(c, { org_id: a.orgId, sub });
      const { rows: [cur] } = await c.query<{ language: string; language_source: string; language_set_at: string }>(
        "select language, language_source, language_set_at::text as language_set_at from public.contacts where id = $1", [k]);
      await asServiceWith(c, { kind: "person", id: sub, via: `restore:${original.id}` });
      const { rows } = await c.query(
        `update public.contacts set language = null, language_source = null, language_set_at = null
           where account_id = $1 and id = $2 and language = $3 and language_source = $4 and language_set_at = $5
         returning id`,
        [a.accountId, k, cur!.language, cur!.language_source, cur!.language_set_at]);
      expect(rows).toHaveLength(1);
      const { rows: [row] } = await c.query<{ language: string | null; language_source: string | null; language_set_at: string | null }>(
        "select language, language_source, language_set_at from public.contacts where id = $1", [k]);
      expect(row).toEqual({ language: null, language_source: null, language_set_at: null });
    }));
});

describe("restoreRemoved's SQL: place (restorePlace)", () => {
  it("restores the same id within the window, refuses a gone parent, and refuses a second restore", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rp");
      const k = await contact(c, a);
      const p = await place(c, a, { contact: k });
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person" });
      await c.query("delete from public.places where id = $1", [p]);
      const removed = await latest(c, a, p);
      expect(removed.op).toBe("delete");
      const before = removed.before as { label: string; address: string; landmark: string | null; directions: string | null;
        city: string | null; region: string | null; postal_code: string | null; country: string | null; archived_at: string | null };

      // restorePlace's own insert: named columns, the SAME id, via restore:<removed.id>.
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed.id}` });
      const { rows } = await c.query(
        `insert into public.places (id, account_id, contact_id, client_group_id, label, address, landmark, directions,
                                     city, region, postal_code, country, archived_at)
         values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [p, a.accountId, k, before.label, before.address, before.landmark, before.directions,
         before.city, before.region, before.postal_code, before.country, before.archived_at]);
      expect(rows).toHaveLength(1);
      const restored = await latest(c, a, p);
      expect(restored.op).toBe("insert");
      expect(restored.via).toBe(`restore:${removed.id}`);
      expect(restored.author_kind).toBe("person");

      // already_back: the SAME insert again answers 23505.
      const dup = await refusal(c,
        `insert into public.places (id, account_id, contact_id, client_group_id, label, address) values ($1, $2, $3, null, $4, $5)`,
        [p, a.accountId, k, before.label, before.address]);
      expect(dup?.code).toBe("23505");
    }));

  it("parent_gone: the owning contact is gone by the time restore is tried", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rpg");
      const k = await contact(c, a);
      const p = await place(c, a, { contact: k });
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person" });
      await c.query("delete from public.places where id = $1", [p]);
      const removed = await latest(c, a, p);
      const before = removed.before as { label: string; address: string };

      await actAsOwner(c);
      await c.query("delete from public.contacts where id = $1", [k]); // the parent is gone AFTER the place's own delete row exists

      await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person", via: `restore:${removed.id}` });
      const refused = await refusal(c,
        "insert into public.places (id, account_id, contact_id, client_group_id, label, address) values ($1, $2, $3, null, $4, $5)",
        [p, a.accountId, k, before.label, before.address]);
      expect(refused?.code).toBe("23503");
    }));
});

describe("restoreRemoved's SQL: equipment (restoreEquipment)", () => {
  it("restores the same id, refuses once its place is gone, refuses a second restore", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ru");
      const k = await contact(c, a);
      const p = await place(c, a, { contact: k });
      const u = await unit(c, a, p);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person" });
      await c.query("delete from public.equipment where id = $1", [u]);
      const removed = await latest(c, a, u); // (resets role to owner internally)
      const before = removed.before as { name: string; make: string | null; model: string | null; serial: string | null; replaces_id: string | null };

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed.id}` });
      const { rows } = await c.query(
        "insert into public.equipment (id, account_id, place_id, replaces_id, name, make, model, serial) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id",
        [u, a.accountId, p, before.replaces_id, before.name, before.make, before.model, before.serial]);
      expect(rows).toHaveLength(1);
      const restored = await latest(c, a, u);
      expect(restored.via).toBe(`restore:${removed.id}`);
      expect(restored.author_id).toBe(sub);

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      const dup = await refusal(c,
        "insert into public.equipment (id, account_id, place_id, name) values ($1, $2, $3, $4)",
        [u, a.accountId, p, before.name]);
      expect(dup?.code).toBe("23505");

      // A second unit, removed and then orphaned by its place's own removal.
      const u2 = await unit(c, a, p);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      await c.query("delete from public.equipment where id = $1", [u2]);
      const removed2 = await latest(c, a, u2);
      const before2 = removed2.before as { name: string };
      await actAsOwner(c);
      await c.query("delete from public.equipment where place_id = $1", [p]); // empty the place of every unit
      await c.query("delete from public.places where id = $1", [p]);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed2.id}` });
      const gone = await refusal(c,
        "insert into public.equipment (id, account_id, place_id, name) values ($1, $2, $3, $4)",
        [u2, a.accountId, p, before2.name]);
      expect(gone?.code).toBe("23503");
    }));
});

describe("restoreRemoved's SQL: contact_relationship (restoreRelationship)", () => {
  it("restores the same id, refuses once a side is gone, refuses a second restore", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rr");
      const k1 = await contact(c, a, { first: "Ana" });
      const k2 = await contact(c, a, { first: "Beto" });
      const rel = await relationship(c, a, k1, k2);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person" });
      await c.query("delete from public.contact_relationships where id = $1", [rel]);
      const removed = await latest(c, a, rel);
      const before = removed.before as { contact_id: string; related_contact_id: string; label_key: string };

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed.id}` });
      const { rows } = await c.query(
        "insert into public.contact_relationships (id, account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, $4, $5) returning id",
        [rel, a.accountId, before.contact_id, before.related_contact_id, before.label_key]);
      expect(rows).toHaveLength(1);
      const restored = await latest(c, a, rel);
      expect(restored.via).toBe(`restore:${removed.id}`);
      expect(restored.author_id).toBe(sub);

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      const dup = await refusal(c,
        "insert into public.contact_relationships (id, account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, $4, $5)",
        [rel, a.accountId, before.contact_id, before.related_contact_id, before.label_key]);
      expect(dup?.code).toBe("23505");

      // A third contact, so this second relationship's pair is not already taken by `rel` (restored
      // and alive, same label_key 'sibling'; contact_relationships_pair is one row per unordered pair).
      const k3 = await contact(c, a, { first: "Caro" });
      const rel2 = await relationship(c, a, k1, k3);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      await c.query("delete from public.contact_relationships where id = $1", [rel2]);
      const removed2 = await latest(c, a, rel2);
      const before2 = removed2.before as { contact_id: string; related_contact_id: string; label_key: string };
      await actAsOwner(c);
      await c.query("delete from public.contacts where id = $1", [k3]); // one side gone after the delete row exists
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed2.id}` });
      const gone = await refusal(c,
        "insert into public.contact_relationships (id, account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, $4, $5)",
        [rel2, a.accountId, before2.contact_id, before2.related_contact_id, before2.label_key]);
      expect(gone?.code).toBe("23503");
    }));
});

describe("restoreRemoved's SQL: contact_tag (a plain named-column insert, no existing writer fits)", () => {
  it("restores the same tag/contact pair, refuses a second restore, refuses once the TAG DEFINITION is gone (PR B review)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rt");
      const k = await contact(c, a);
      const t = await tagId(c, a);
      await addTag(c, a, k, t);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await header(c, { kind: "person" });
      await c.query("delete from public.contact_tags where contact_id = $1 and tag_id = $2", [k, t]);
      const removed = await latest(c, a, t); // contact_tag's record_id IS the tag_id (0112's own rule)
      expect(removed.contact_id).toBe(k);

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed.id}` });
      const { rows } = await c.query(
        "insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3) returning tag_id",
        [k, t, a.accountId]);
      expect(rows).toHaveLength(1);
      const restored = await latest(c, a, t);
      expect(restored.op).toBe("insert");
      expect(restored.via).toBe(`restore:${removed.id}`);
      expect(restored.author_id).toBe(sub);

      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      const dup = await refusal(c,
        "insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3)", [k, t, a.accountId]);
      expect(dup?.code).toBe("23505");

      // A second tag, removed, then its DEFINITION deleted from `tags` (cascades the contact_tags row,
      // which the capture's own cascade-skip never checks for `tag_id` — the delete row stays, per the
      // header's own WHAT section and the plan's PR B review note).
      const t2 = await tagId(c, a);
      await addTag(c, a, k, t2);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person" });
      await c.query("delete from public.contact_tags where contact_id = $1 and tag_id = $2", [k, t2]);
      const removed2 = await latest(c, a, t2);
      await actAsOwner(c);
      await c.query("delete from public.tags where id = $1", [t2]);
      await actAs(c, { org_id: a.orgId, sub });
      await header(c, { kind: "person", via: `restore:${removed2.id}` });
      const gone = await refusal(c,
        "insert into public.contact_tags (contact_id, tag_id, account_id) values ($1, $2, $3)", [k, t2, a.accountId]);
      expect(gone?.code).toBe("23503");
    }));
});

describe("restoreRemoved's SQL: client_group_member (restore_group_membership)", () => {
  it("restores the same id; restore_group_membership answers 'not_found' once the group is gone (parent_gone); answers 'ok' again for an existing member (why restoreMembershipRow pre-checks existence)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "rm");
      const k = await contact(c, a);
      const g = await group(c, a);
      const m = await membership(c, a, g, k);
      await actAsOwner(c);
      await asServiceWith(c, { kind: "person", id: "sub_rm_1" });
      await c.query("delete from public.client_group_members where id = $1", [m]);
      const removed = await latest(c, a, m);
      expect(removed.op).toBe("delete");

      // restoreMembership's own rpc call: service_role only, the header names the author AND the via
      // (plan correction 9's load-bearing note 4: this RPC never sees the GUC path a user client
      // definer would take, so the header is the ONLY way it learns either).
      await asServiceWith(c, { kind: "person", id: "sub_rm_1", via: `restore:${removed.id}` });
      const { rows: [r1] } = await c.query<{ restore_group_membership: string }>(
        "select public.restore_group_membership($1, $2::jsonb) as restore_group_membership", [a.accountId, JSON.stringify(removed.before)]);
      expect(r1!.restore_group_membership).toBe("ok");
      const restored = await latestOp(c, a, m, "insert");
      expect(restored.via).toBe(`restore:${removed.id}`);
      expect(restored.author_id).toBe("sub_rm_1");

      // Calling it again while the member is ALREADY present answers 'ok' too, silently (app.restore_member's
      // own early return): no FK violation, no distinct status. This is exactly why restoreMembershipRow
      // pre-checks existence itself before ever calling this rpc, rather than reading the answer apart.
      const { rows: [r2] } = await c.query<{ restore_group_membership: string }>(
        "select public.restore_group_membership($1, $2::jsonb) as restore_group_membership", [a.accountId, JSON.stringify(removed.before)]);
      expect(r2!.restore_group_membership).toBe("ok");

      // parent_gone: a second membership, removed, then its GROUP deleted afterward.
      const g2 = await group(c, a);
      const m2 = await membership(c, a, g2, k);
      await asServiceWith(c, { kind: "person", id: "sub_rm_1" });
      await c.query("delete from public.client_group_members where id = $1", [m2]);
      const removed2 = await latest(c, a, m2);
      await actAsOwner(c);
      await c.query("delete from public.client_groups where id = $1", [g2]);
      await asServiceWith(c, { kind: "person", id: "sub_rm_1", via: `restore:${removed2.id}` });
      const { rows: [r3] } = await c.query<{ restore_group_membership: string }>(
        "select public.restore_group_membership($1, $2::jsonb) as restore_group_membership", [a.accountId, JSON.stringify(removed2.before)]);
      expect(r3!.restore_group_membership).toBe("not_found");
    }));
});
