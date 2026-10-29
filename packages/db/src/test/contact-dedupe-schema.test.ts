import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { nameKey, phoneNational, phoneFamily, reasonStrength, DUPLICATE_REASON_STRENGTH } from "../dedupe-keys";

/**
 * 0106 part A: the comparison keys and their parity, the flag trigger, the backfill's shapes, the list functions,
 * dismissal, the flag table's narrowed grants, the tombstone columns and their guard, contact_merges' grants and
 * policy, and the two replaced functions (blockers, held-by: ai-acts-schema.test.ts). Replica only (withRollback).
 *
 * RED BEFORE APPLY: every case but one, because each names a column, a function or a table 0106 creates, or
 * asserts a pair only the trigger files. Every "never pairs" case carries a positive control in the same seed (a
 * pair that IS filed, or a key that IS stored), so it cannot pass on a database with no trigger at all.
 * GREEN BEFORE APPLY, legitimately: "an Owner's four-column insert still works through RLS" (a non-regression pin
 * for correction 2: the TypeScript writers' insert must survive the narrowing, and it works today).
 *
 * Every "found by key" case uses two contacts that share NOTHING but the key under test (different phones, no
 * emails, names that differ unless the name is the key), so no other key can satisfy the assertion.
 * One refused statement per transaction, or a savepoint around it (`refusal`).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };

/** contact-archive-schema.test.ts:21-29's shape. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_dedupe_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Dedupe') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Dedupe test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
/** contact-archive-schema.test.ts:76-80. */
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
async function pairs(c: Client, accountId: string) {
  await actAsOwner(c);
  const { rows } = await c.query<{ a: string; b: string; reason: string }>(
    "select contact_a as a, contact_b as b, reason from public.contact_duplicate_flags where account_id = $1 order by 1, 2", [accountId]);
  return rows;
}
/** Postgres orders uuids as their lowercase hex strings (record.ts:368-369), so a JS sort gives contact_a. */
const pair = (x: string, y: string, reason: string) => { const [a, b] = [x, y].sort(); return { a: a!, b: b!, reason }; };
const byAB = (rows: { a: string; b: string; reason: string }[]) =>
  [...rows].sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
async function tombstone(c: Client, accountId: string, id: string, into: string) {
  await actAsOwner(c);
  await c.query("update public.contacts set merged_into = $3, merged_at = now() where account_id = $1 and id = $2", [accountId, id, into]);
}
/** A member of `a` with `role`; answers the token's sub and the users row id (for assigned_to). Leaves the session as the owner. */
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
async function flagOf(c: Client, accountId: string, x: string, y: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "select id from public.contact_duplicate_flags where account_id = $1 and contact_a = least($2::uuid, $3::uuid) and contact_b = greatest($2::uuid, $3::uuid)",
    [accountId, x, y]);
  return r!.id;
}
/** A merge-log row with every NOT NULL column, written as the owner (no client writes this table). */
async function mergeRow(c: Client, accountId: string, keep: string, other: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    `insert into public.contact_merges (account_id, keep_id, other_id, merged_by, undo_until, keep_before, keep_after, choices, moved, moved_counts, removed)
     values ($1, $2, $3, 'user_seed', now() + interval '30 days', '{}', '{}', '{}', '{}', '{}', '{}') returning id::text as id`,
    [accountId, keep, other]);
  return r!.id;
}

type Row = { id: string; contact_a: string; contact_b: string; reason: string; strength: number; created_at: string };
/** created_at as text, so the cursor round-trips with its microseconds (a JS Date keeps milliseconds). */
async function page(c: Client, accountId: string, limit: number, after?: Row): Promise<Row[]> {
  const { rows } = await c.query<Row>(
    `select id, contact_a, contact_b, reason, strength, created_at::text as created_at
       from public.duplicate_pairs_page($1, $2, $3, $4::timestamptz, $5)`,
    [accountId, limit, after?.strength ?? null, after?.created_at ?? null, after?.id ?? null]);
  return rows;
}
async function count(c: Client, accountId: string): Promise<number> {
  const { rows: [r] } = await c.query<{ n: number }>("select public.duplicate_pairs_count($1) as n", [accountId]);
  return r!.n;
}
async function dismiss(c: Client, accountId: string, flagId: string, actor: string | null = null) {
  const { rows: [r] } = await c.query<{ r: { status: string } }>("select public.dismiss_duplicate_pair($1, $2, $3) as r", [accountId, flagId, actor]);
  return r!.r.status;
}
async function undismiss(c: Client, accountId: string, flagId: string) {
  const { rows: [r] } = await c.query<{ r: { status: string } }>("select public.undismiss_duplicate_pair($1, $2) as r", [accountId, flagId]);
  return r!.r.status;
}
const DISMISS = "select public.dismiss_duplicate_pair($1, $2) as r";

describe("0106: the keys match their TypeScript twins", () => {
  const NAMES: [string | null, string | null][] = [
    ["María", "García López"], ["MARIA", "GARCIA"], ["maría", "garcía-lópez"], ["José", "Muñoz"], ["JOSÉ", "MUÑOZ"],
    ["Juan Carlos", "García"], ["Ana", "de la Garza Treviño"], ["Luis", "San Miguel"], ["Rosa", "Santa Cruz"],
    ["Pedro", "García y López"], ["Pedro", "Delgado"], ["Inés", "Peña"], ["Zoë", "Brontë"], ["Mary", "O'Brien"],
    ["Ana", "Ruiz\u00A0Díaz"], ["Ana\t", "Ruiz"], ["  Ana  ", "  Ruiz  "], ["Ana", ""], ["Ana", null], [null, "Ruiz"],
    ["Caller", "Prueba"], ["Unknown", "Caller"], ["Desconocido", "Pérez"], ["N/A", "Pérez"], ["Cliente", "López"],
    ["Ana", "de la"], ["Ana", "Ståhl"], ["İsmail", "Şahin"], ["李", "王"], ["Ana", "García\u3000López"],
  ];
  it.each(NAMES)("name_key = nameKey() for %j %j (mutation: drop chr(209) from the SQL map only -> the Muñoz rows FAIL)", (first, last) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "nk");
      const id = await person(c, a.accountId, { first, last });
      const { rows: [r] } = await c.query("select name_key from public.contacts where id = $1", [id]);
      expect(r.name_key).toBe(nameKey(first, last));
    }));

  const PHONES = ["+19562921696", "(956) 292-1696", "9562921696", "19562921696", "+528999221234", "+52 1 899 922 1234",
    "+5218999221234", "044 899 922 1234", "045 899 922 1234", "01 899 922 1234", "+44 20 7946 0958", "+5289992212345",
    "call after 5", "0123456789", ""];
  it.each(PHONES)("phone_national and phone_family = their twins for %j (mutation: drop the 521 branch in SQL only -> FAILS)", (phone) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "pn");
      const id = await person(c, a.accountId, { first: "Key", phone: phone || null });
      const { rows: [r] } = await c.query("select phone_national, app.phone_family(phone) as fam from public.contacts where id = $1", [id]);
      expect(r).toEqual({ phone_national: phoneNational(phone || null), fam: phoneFamily(phone || null) });
    }));

  it("the generated strength equals reasonStrength for every reason (mutation: same_name 2 in SQL -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "st");
      for (const reason of [...Object.keys(DUPLICATE_REASON_STRENGTH), "merged_by_hand", "anything"]) {
        const x = await person(c, a.accountId, { first: `S ${reason}` });
        const y = await person(c, a.accountId, { first: `T ${reason}` });
        const [lo, hi] = [x, y].sort();
        const { rows: [r] } = await c.query(
          "insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1, $2, $3, $4) returning strength",
          [a.accountId, lo, hi, reason]);
        expect(r.strength, reason).toBe(reasonStrength(reason));
      }
    }));

  it("a signed-in Owner's insert and edit succeed and store both keys (correction 3; mutation: revoke execute on app.contact_name_key from authenticated -> 42501, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "own");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query(
        "insert into public.contacts (account_id, first_name, last_name, phone) values ($1, 'María', 'García', '+528999221234') returning id, name_key, phone_national",
        [a.accountId]);
      expect([r.name_key, r.phone_national]).toEqual(["maria|garcia", "8999221234"]);
      const { rows: [u] } = await c.query("update public.contacts set last_name = 'López' where id = $1 returning name_key", [r.id]);
      expect(u.name_key).toBe("maria|lopez");
    }));
});

describe("0106: the database files every pair (app.contacts_flag_pairs)", () => {
  it("same name, two surnames: María García López and Maria Garcia pair as same_name (mutation: key on the whole folded last name -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t1");
      const x = await person(c, a.accountId, { first: "María", last: "García López", phone: "+19565550101" });
      const y = await person(c, a.accountId, { first: "Maria", last: "Garcia", phone: "+19565550102" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_name")]);
    }));

  it("one first name is not another: Juan Carlos García and Juan García never pair, though each has a key (mutation: key on the first word of the first name -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t2");
      const x = await person(c, a.accountId, { first: "Juan Carlos", last: "García", phone: "+19565550103" });
      const y = await person(c, a.accountId, { first: "Juan", last: "García", phone: "+19565550104" });
      const { rows } = await c.query("select name_key from public.contacts where id = any($1::uuid[]) order by name_key", [[x, y]]);
      expect(rows.map((r) => r.name_key)).toEqual(["juan carlos|garcia", "juan|garcia"]);
      expect(await pairs(c, a.accountId)).toEqual([]);
    }));

  it("placeholders never pair, each with a last name and its own phone; a real name beside them does (mutation: delete the placeholder array -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t3");
      await person(c, a.accountId, { first: "Caller", last: "Prueba", phone: "+19565550105" });
      await person(c, a.accountId, { first: "Caller", last: "Prueba", phone: "+19565550106" });
      await person(c, a.accountId, { first: "Unknown", last: "Caller", phone: "+19565550107" });
      await person(c, a.accountId, { first: "Unknown", last: "Caller", phone: "+19565550108" });
      // The control: the same shape with a real first name is filed.
      const x = await person(c, a.accountId, { first: "Carla", last: "Prueba", phone: "+19565550125" });
      const y = await person(c, a.accountId, { first: "Carla", last: "Prueba", phone: "+19565550126" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_name")]);
    }));

  it("no last name, no key: two Anas with no last name and two phones never pair, and a blank last name is no key either (mutation: coalesce(n.surname, '') in the key with its empty test dropped -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t4");
      const x = await person(c, a.accountId, { first: "Ana", last: null, phone: "+19565550109" });
      const y = await person(c, a.accountId, { first: "Ana", last: "", phone: "+19565550110" });
      const { rows } = await c.query("select name_key from public.contacts where id = any($1::uuid[])", [[x, y]]);
      expect(rows).toEqual([{ name_key: null }, { name_key: null }]);
      expect(await pairs(c, a.accountId)).toEqual([]);
    }));

  it("legacy +52 1 is the same phone as today's +52 (mutation: drop the 521 branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t5");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+5218999221234" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+528999221234" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_phone")]);
    }));

  it("a +1 and a +52 of one ten digits pair as same_digits, not same_phone (mutation: write same_phone whatever the family -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t6");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+18999221234" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+528999221234" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_digits")]);
    }));

  it("email: ANA@x.mx and ana+tag@x.mx pair as same_email (mutation: drop the email insert -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t7");
      const x = await person(c, a.accountId, { first: "Uno", email: "ANA@x.mx" });
      const y = await person(c, a.accountId, { first: "Dos", email: "ana+tag@x.mx" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_email")]);
    }));

  it("the strongest reason stands: a pair sharing phone, email and name is one same_phone row (mutation: run the name insert first -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t8");
      const x = await person(c, a.accountId, { first: "Ana", last: "Ruiz", phone: "+19565550120", email: "ana@r.mx" });
      const y = await person(c, a.accountId, { first: "Ana", last: "Ruiz", phone: "+19565550120", email: "ana@r.mx" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_phone")]);
    }));

  it("an edit files a pair: an Owner gives Dos Uno's phone (mutation: trigger after insert only -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t9");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550111" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550112" });
      expect(await pairs(c, a.accountId)).toEqual([]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set phone = '+19565550111' where id = $1", [y]);
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_phone")]);
    }));

  it("a Technician's insert queues a pair with a contact outside their assignment (mutation: the trigger function SECURITY INVOKER -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t10");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550113" });
      const tech = await member(c, a, "technician");
      await signIn(c, a, tech.sub);
      const { rows: [r] } = await c.query<{ id: string }>(
        "insert into public.contacts (account_id, first_name, phone, assigned_to) values ($1, 'Dos', '+19565550113', $2) returning id",
        [a.accountId, tech.userId]);
      expect(await pairs(c, a.accountId)).toEqual([pair(x, r!.id, "same_phone")]);
    }));

  it("a dismissal sticks: editing both phones away and back leaves the one row, still dismissed (mutation: on conflict do update set dismissed_at = null -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t11");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550114" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550114" });
      await c.query("update public.contact_duplicate_flags set dismissed_at = now(), dismissed_by = 'u' where account_id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set phone = case when id = $1 then '+19565550197' else '+19565550198' end where id = any($2::uuid[])", [x, [x, y]]);
      await c.query("update public.contacts set phone = '+19565550114' where id = any($1::uuid[])", [[x, y]]);
      await actAsOwner(c);
      const { rows } = await c.query(
        "select contact_a, contact_b, reason, dismissed_by, dismissed_at is not null as dismissed from public.contact_duplicate_flags where account_id = $1",
        [a.accountId]);
      const [lo, hi] = [x, y].sort();
      expect(rows).toEqual([{ contact_a: lo, contact_b: hi, reason: "same_phone", dismissed_by: "u", dismissed: true }]);
    }));

  it("a holding record never pairs; a person beside it on the same number does (mutation: drop `not c.holds_shared_number` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t12");
      await actAsOwner(c);
      // 0098's shape (contacts_holding_shape): Caller, the exact E.164, no last name, no email.
      await c.query("insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', '+19565550115', true, 'person')", [a.accountId]);
      const x = await person(c, a.accountId, { first: "Ana", phone: "+19565550115" });
      const y = await person(c, a.accountId, { first: "Bea", phone: "+19565550115" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_phone")]);
    }));

  it("a tombstone never pairs; a live record on the same number does (mutation: drop `c.merged_into is null` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t13");
      const uno = await person(c, a.accountId, { first: "Uno", phone: "+19565550116" });
      const kept = await person(c, a.accountId, { first: "Kept", phone: "+19565550196" });
      await tombstone(c, a.accountId, uno, kept);
      const dos = await person(c, a.accountId, { first: "Dos", phone: "+19565550116" });
      const tres = await person(c, a.accountId, { first: "Tres", phone: "+19565550116" });
      expect(await pairs(c, a.accountId)).toEqual([pair(dos, tres, "same_phone")]);
    }));

  it("at most 20 per write: the 23rd contact on one number gets exactly 20 rows (mutation: drop `limit 20` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t14");
      for (let i = 0; i < 22; i++) await person(c, a.accountId, { first: `P${i}`, phone: "+19565550130" });
      const last = await person(c, a.accountId, { first: "P22", phone: "+19565550130" });
      const { rows: [r] } = await c.query<{ n: number }>(
        "select count(*)::int as n from public.contact_duplicate_flags where account_id = $1 and (contact_a = $2 or contact_b = $2)", [a.accountId, last]);
      expect(r!.n).toBe(20);
    }));

  it("second account: B's Ana on the same number is never A's pair; A's own second Ana is (mutation: drop `c.account_id = new.account_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "t15a");
      const b = await seedAccount(c, "t15b");
      await person(c, b.accountId, { first: "Ana", phone: "+19565550117" });
      const x = await person(c, a.accountId, { first: "Ana", phone: "+19565550117" });
      const y = await person(c, a.accountId, { first: "Eva", phone: "+19565550117" });
      expect(await pairs(c, a.accountId)).toEqual([pair(x, y, "same_phone")]);
    }));
});

describe("0106: the list functions and dismissal", () => {
  it("household members on one phone are hidden; the same household's email pair is shown (mutation: (a) drop the household filter; (b) apply it to every reason -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l1");
      const h1 = await person(c, a.accountId, { first: "H1", phone: "+19565550140" });
      const h2 = await person(c, a.accountId, { first: "H2", phone: "+19565550140" });
      const h3 = await person(c, a.accountId, { first: "H3", email: "casa@x.mx" });
      const h4 = await person(c, a.accountId, { first: "H4", email: "casa@x.mx" });
      await actAsOwner(c);
      // 0069's columns (ai-acts-schema.test.ts:676-678's insert).
      const { rows: [g] } = await c.query<{ id: string }>("insert into public.client_groups (account_id, kind, name) values ($1, 'household', 'Casa') returning id", [a.accountId]);
      for (const m of [h1, h2, h3, h4]) {
        await c.query("insert into public.client_group_members (account_id, client_group_id, contact_id) values ($1, $2, $3)", [a.accountId, g!.id, m]);
      }
      expect(byAB(await pairs(c, a.accountId))).toEqual(byAB([pair(h1, h2, "same_phone"), pair(h3, h4, "same_email")]));
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const rows = await page(c, a.accountId, 50);
      expect(rows.map((r) => ({ a: r.contact_a, b: r.contact_b, reason: r.reason }))).toEqual([pair(h3, h4, "same_email")]);
      expect(await count(c, a.accountId)).toBe(1);
    }));

  it("a relationship hides a pair (mutation: drop the relationship filter -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l2");
      const r1 = await person(c, a.accountId, { first: "R1", phone: "+19565550141" });
      const r2 = await person(c, a.accountId, { first: "R2", phone: "+19565550141" });
      const owner = await member(c, a, "owner");
      await signIn(c, a, owner.sub);
      expect(await count(c, a.accountId)).toBe(1);
      await actAsOwner(c);
      await c.query("insert into public.contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1, $2, $3, 'sibling')", [a.accountId, r2, r1]);
      await signIn(c, a, owner.sub);
      expect(await page(c, a.accountId, 50)).toEqual([]);
      expect(await count(c, a.accountId)).toBe(0);
    }));

  it("a tombstone side or a holding side hides a pair; a live pair beside them shows (mutation: drop either filter -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l3");
      const t1 = await person(c, a.accountId, { first: "T1", phone: "+19565550142" });
      const t2 = await person(c, a.accountId, { first: "T2", phone: "+19565550143" });
      const p = await person(c, a.accountId, { first: "P", phone: "+19565550145" });
      const l1 = await person(c, a.accountId, { first: "L1", phone: "+19565550146" });
      const l2 = await person(c, a.accountId, { first: "L2", phone: "+19565550147" });
      await actAsOwner(c);
      const { rows: [h] } = await c.query<{ id: string }>(
        "insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind) values ($1, 'Caller', '+19565550144', true, 'person') returning id", [a.accountId]);
      const flag = (x: string, y: string) => { const [lo, hi] = [x, y].sort(); return c.query(
        "insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1, $2, $3, 'same_phone')", [a.accountId, lo, hi]); };
      await flag(t1, t2);
      await flag(h!.id, p);
      await flag(l1, l2);
      await tombstone(c, a.accountId, t2, t1);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await page(c, a.accountId, 50)).map((r) => ({ a: r.contact_a, b: r.contact_b, reason: r.reason }))).toEqual([pair(l1, l2, "same_phone")]);
    }));

  it("rows and total agree across a page boundary on a created_at tie, each pair once, in (strength, created_at desc, id desc) (mutation: drop `f.id < p_after_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l4");
      for (const [i, ph] of ["+19565550150", "+19565550151", "+19565550152"].entries()) {
        await person(c, a.accountId, { first: `A${i}`, phone: ph });
        await person(c, a.accountId, { first: `B${i}`, phone: ph });
      }
      await actAsOwner(c);
      // Two of the three on one instant: only the id can order them, and only the id can resume between them.
      await c.query(
        `update public.contact_duplicate_flags set created_at = '2026-10-01T00:00:00Z'
          where id in (select id from public.contact_duplicate_flags where account_id = $1 order by id limit 2)`, [a.accountId]);
      const { rows: want } = await c.query<{ id: string }>(
        "select id from public.contact_duplicate_flags where account_id = $1 order by strength, created_at desc, id desc", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const first = await page(c, a.accountId, 2);
      const second = await page(c, a.accountId, 2, first[1]);
      expect([...first, ...second].map((r) => r.id)).toEqual(want.map((r) => r.id));
      expect(want).toHaveLength(3);
      expect(await count(c, a.accountId)).toBe(3);
    }));

  it("phone before name: an older same_phone pair leads a newer same_name pair (mutation: order by created_at desc, id desc alone -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l5");
      const q1 = await person(c, a.accountId, { first: "Q1", phone: "+19565550162" });
      const q2 = await person(c, a.accountId, { first: "Q2", phone: "+19565550162" });
      const n1 = await person(c, a.accountId, { first: "Nora", last: "Vela", phone: "+19565550160" });
      const n2 = await person(c, a.accountId, { first: "Nora", last: "Vela", phone: "+19565550161" });
      await actAsOwner(c);
      await c.query("update public.contact_duplicate_flags set created_at = '2026-10-01T00:00:00Z' where reason = 'same_phone' and account_id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await page(c, a.accountId, 50)).map((r) => ({ a: r.contact_a, b: r.contact_b, reason: r.reason })))
        .toEqual([pair(q1, q2, "same_phone"), pair(n1, n2, "same_name")]);
    }));

  it("duplicate_pairs_of answers exactly the pairs naming the contact, strongest first (mutation: drop the p_contact_id term -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l6");
      const x = await person(c, a.accountId, { first: "Xavi", last: "Paz", phone: "+19565550170", email: "x@x.mx" });
      const byPhone = await person(c, a.accountId, { first: "A1", phone: "+19565550170" });
      const byEmail = await person(c, a.accountId, { first: "B1", email: "x@x.mx" });
      const byName = await person(c, a.accountId, { first: "Xavi", last: "Paz", phone: "+19565550171" });
      await person(c, a.accountId, { first: "E1", phone: "+19565550172" });
      await person(c, a.accountId, { first: "F1", phone: "+19565550172" });
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows } = await c.query<{ contact_a: string; contact_b: string; reason: string }>(
        "select contact_a, contact_b, reason from public.duplicate_pairs_of($1, $2)", [a.accountId, x]);
      expect(rows.map((r) => ({ a: r.contact_a, b: r.contact_b, reason: r.reason })))
        .toEqual([pair(x, byPhone, "same_phone"), pair(x, byEmail, "same_email"), pair(x, byName, "same_name")]);
      expect(await count(c, a.accountId)).toBe(4);
    }));

  it("a Technician reads nothing, even a pair of two customers assigned to them (mutation: drop contact_duplicate_flags_technician_none -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l7");
      const tech = await member(c, a, "technician");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550173" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550173" });
      await c.query("update public.contacts set assigned_to = $2 where id = any($1::uuid[])", [[x, y], tech.userId]);
      await signIn(c, a, tech.sub);
      // The control: the Technician sees both customers, so only the flag policy can hide the pair.
      const { rows: seen } = await c.query("select id from public.contacts where id = any($1::uuid[])", [[x, y]]);
      expect(seen).toHaveLength(2);
      expect(await page(c, a.accountId, 50)).toEqual([]);
      expect(await count(c, a.accountId)).toBe(0);
      await actAsOwner(c);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await count(c, a.accountId)).toBe(1);
    }));

  it("second account: B's pair is never in A's list, even for a caller who can read every account (mutation: drop `f.account_id = p_account_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l8a");
      const b = await seedAccount(c, "l8b");
      await person(c, b.accountId, { first: "Uno", phone: "+19565550174" });
      await person(c, b.accountId, { first: "Dos", phone: "+19565550174" });
      await asService(c);
      expect(await count(c, b.accountId)).toBe(1);
      expect(await page(c, a.accountId, 50)).toEqual([]);
      expect(await count(c, a.accountId)).toBe(0);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await count(c, a.accountId)).toBe(0);
    }));

  it("dismiss and undismiss: dismissed leaves the list with the caller's sub, restored brings it back, a second dismiss of a dismissed pair is not_found (mutation: dismiss stamps nothing -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "l9");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550175" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550175" });
      const f = await flagOf(c, a.accountId, x, y);
      const owner = await member(c, a, "owner");
      await signIn(c, a, owner.sub);
      expect(await dismiss(c, a.accountId, f)).toBe("dismissed");
      expect(await count(c, a.accountId)).toBe(0);
      expect(await dismiss(c, a.accountId, f)).toBe("not_found");
      await actAsOwner(c);
      expect((await c.query("select dismissed_by from public.contact_duplicate_flags where id = $1", [f])).rows).toEqual([{ dismissed_by: owner.sub }]);
      await signIn(c, a, owner.sub);
      expect(await undismiss(c, a.accountId, f)).toBe("restored");
      expect((await page(c, a.accountId, 50)).map((r) => r.id)).toEqual([f]);
      expect(await undismiss(c, a.accountId, f)).toBe("not_found");
    }));

  // who (app.may_merge), one case per refusal, so each mutation below turns ITS case red by name.
  /** Account A with one open pair; answers the account and the flag id. */
  async function whoSeed(c: Client, label: string): Promise<{ a: Acct; f: string }> {
    const a = await seedAccount(c, label);
    const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550176" });
    const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550176" });
    return { a, f: await flagOf(c, a.accountId, x, y) };
  }
  async function stillOpen(c: Client, f: string) {
    await actAsOwner(c);
    return (await c.query("select dismissed_at is null as open from public.contact_duplicate_flags where id = $1", [f])).rows[0];
  }

  it("who: Staff may dismiss (the control for the refusals below)", () =>
    withRollback(async (c) => {
      const { a, f } = await whoSeed(c, "w0");
      const staff = await member(c, a, "staff");
      await signIn(c, a, staff.sub);
      expect(await dismiss(c, a.accountId, f)).toBe("dismissed");
    }));

  it("who: a Technician is refused 42501 (mutation: drop the sees_all_customers term from app.may_merge -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, f } = await whoSeed(c, "w1");
      const tech = await member(c, a, "technician");
      await signIn(c, a, tech.sub);
      expect((await refusal(c, DISMISS, [a.accountId, f]))?.code).toBe("42501");
      expect(await stillOpen(c, f)).toEqual({ open: true });
    }));

  it("who: an Owner of an account with client access off is refused 42501 (mutation: drop BOTH coalesces in app.may_merge -> FAILS; either alone still refuses)", () =>
    withRollback(async (c) => {
      const { a, f } = await whoSeed(c, "w2");
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      const owner = await member(c, a, "owner");
      await signIn(c, a, owner.sub);
      expect((await refusal(c, DISMISS, [a.accountId, f]))?.code).toBe("42501");
      expect(await stillOpen(c, f)).toEqual({ open: true });
    }));

  it("who: an Owner of account B passing A's flag under A is refused 42501 (second account)", () =>
    withRollback(async (c) => {
      const { a, f } = await whoSeed(c, "w3a");
      const b = await seedAccount(c, "w3b");
      const ownerB = await member(c, b, "owner");
      await signIn(c, b, ownerB.sub);
      expect((await refusal(c, DISMISS, [a.accountId, f]))?.code).toBe("42501");
      expect(await stillOpen(c, f)).toEqual({ open: true });
    }));

  it("who: an Owner of A whose token names org B is refused 42501, though app.sees_all_customers(A) is true for them (review m4; mutation: drop `coalesce(p_account_id = app.current_account_id(), false) and` -> FAILS)", () =>
    withRollback(async (c) => {
      const { a, f } = await whoSeed(c, "w4a");
      const b = await seedAccount(c, "w4b");
      // One person, an Owner of A AND of B, signed in to B: only the account term can refuse.
      const both = await member(c, a, "owner");
      await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, 'owner')", [both.userId, b.accountId]);
      await signIn(c, b, both.sub);
      expect((await c.query<{ s: boolean }>("select app.sees_all_customers($1) as s", [a.accountId])).rows[0]!.s, "the control").toBe(true);
      expect((await refusal(c, DISMISS, [a.accountId, f]))?.code).toBe("42501");
      expect(await stillOpen(c, f)).toEqual({ open: true });
    }));

  it("service role: dismissed with p_actor as dismissed_by (mutation: drop the service term -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "w2");
      const x = await person(c, a.accountId, { first: "Uno", phone: "+19565550178" });
      const y = await person(c, a.accountId, { first: "Dos", phone: "+19565550178" });
      const f = await flagOf(c, a.accountId, x, y);
      await asService(c);
      expect(await dismiss(c, a.accountId, f, "svc")).toBe("dismissed");
      await actAsOwner(c);
      expect((await c.query("select dismissed_by from public.contact_duplicate_flags where id = $1", [f])).rows).toEqual([{ dismissed_by: "svc" }]);
    }));
});

describe("0106: grants", () => {
  it("authenticated may insert the flag table's four columns and nothing else, and may not update or delete it (correction 2; mutation: grant update (dismissed_at) -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'INSERT') as t_ins,
                has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'UPDATE') as t_upd,
                has_table_privilege('authenticated', 'public.contact_duplicate_flags', 'DELETE') as t_del,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'reason', 'INSERT') as c_reason,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'dismissed_at', 'INSERT') as c_dismissed,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'merge_id', 'INSERT') as c_merge,
                has_column_privilege('authenticated', 'public.contact_duplicate_flags', 'dismissed_at', 'UPDATE') as u_dismissed`);
      expect(p).toEqual({ t_ins: false, t_upd: false, t_del: false, c_reason: true, c_dismissed: false, c_merge: false, u_dismissed: false });
    }));

  it("an Owner's four-column insert still works through RLS (the writers of correction 2; mutation: drop the insert policy -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ins");
      const x = await person(c, a.accountId, { first: "X" });
      const y = await person(c, a.accountId, { first: "Y" });
      const [lo, hi] = [x, y].sort();
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("insert into public.contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1, $2, $3, 'email_phone_conflict')", [a.accountId, lo, hi]);
      expect((await pairs(c, a.accountId))).toEqual([{ a: lo, b: hi, reason: "email_phone_conflict" }]);
    }));

  it("authenticated holds no write on contact_merges and no write on merged_into (privilege reads; mutation: grant insert on contact_merges -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_merges', 'INSERT') as i,
                has_table_privilege('authenticated', 'public.contact_merges', 'UPDATE') as u,
                has_table_privilege('authenticated', 'public.contact_merges', 'DELETE') as d,
                has_column_privilege('authenticated', 'public.contacts', 'merged_into', 'UPDATE') as m`);
      expect(p).toEqual({ i: false, u: false, d: false, m: false });
    }));

  it("authenticated reads exactly the ten timeline columns of contact_merges, never a snapshot or the reply token (review m8c; mutation: grant select on public.contact_merges to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ col: string }>(
        `select a.attname as col from pg_attribute a
          where a.attrelid = 'public.contact_merges'::regclass and a.attnum > 0 and not a.attisdropped
            and has_column_privilege('authenticated', 'public.contact_merges', a.attnum, 'SELECT')
          order by 1`);
      expect(rows.map((r) => r.col)).toEqual(["account_id", "id", "keep_id", "merged_at", "merged_by", "moved_counts",
        "other_id", "undo_until", "undone_at", "undone_by"]);
    }));
});

describe("0106: a tombstone is server code's alone, and the merge log", () => {
  it("a signed-in update of a tombstone is refused 42501, though the Owner sees the row (mutation: delete the `old.merged_into is not null` raise -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g1");
      const k = await person(c, a.accountId, { first: "Kept" });
      const o = await person(c, a.accountId, { first: "Other" });
      await tombstone(c, a.accountId, o, k);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await c.query("select id from public.contacts where id = $1", [o])).rows).toEqual([{ id: o }]);
      expect((await refusal(c, "update public.contacts set first_name = 'Edited' where id = $1", [o]))?.code).toBe("42501");
    }));

  it("a signed-in insert cannot be born a tombstone: table-level INSERT covers every column, so the guard stores both null (mutation: drop the guard's insert branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g2");
      const k = await person(c, a.accountId, { first: "Kept" });
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows } = await c.query(
        "insert into public.contacts (account_id, first_name, merged_into, merged_at) values ($1, 'Born', $2, now()) returning merged_into, merged_at",
        [a.accountId, k]);
      expect(rows).toEqual([{ merged_into: null, merged_at: null }]);
    }));

  it("a signed-in delete of a tombstone is refused 42501, while the same Owner deletes a live record (mutation: delete the raise -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g3");
      const k = await person(c, a.accountId, { first: "Kept" });
      const o = await person(c, a.accountId, { first: "Other" });
      const free = await person(c, a.accountId, { first: "Free" });
      await tombstone(c, a.accountId, o, k);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await c.query("delete from public.contacts where id = $1", [free])).rowCount, "the control").toBe(1);
      expect((await refusal(c, "delete from public.contacts where id = $1", [o]))?.code).toBe("42501");
    }));

  it("server code is not limited: service_role updates a tombstone (mutation: refuse service_role too -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g4");
      const k = await person(c, a.accountId, { first: "Kept" });
      const o = await person(c, a.accountId, { first: "Other" });
      await tombstone(c, a.accountId, o, k);
      await asService(c);
      expect((await c.query("update public.contacts set first_name = 'Edited' where id = $1", [o])).rowCount).toBe(1);
    }));

  it("contact_merges read: A's Owner reads A's rows not B's; a Technician reads the merge of a kept record assigned to them and not another (mutations: policy using (true); policy in the house shape -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g5a");
      const b = await seedAccount(c, "g5b");
      const tech = await member(c, a, "technician");
      const k1 = await person(c, a.accountId, { first: "K1" });
      const o1 = await person(c, a.accountId, { first: "O1" });
      const k2 = await person(c, a.accountId, { first: "K2" });
      const o2 = await person(c, a.accountId, { first: "O2" });
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [k1, tech.userId]);
      const m1 = await mergeRow(c, a.accountId, k1, o1);
      const m2 = await mergeRow(c, a.accountId, k2, o2);
      const kb = await person(c, b.accountId, { first: "KB" });
      const ob = await person(c, b.accountId, { first: "OB" });
      await mergeRow(c, b.accountId, kb, ob);
      // id only: the client holds SELECT on ten columns, and select * would refuse 42501 for the wrong reason.
      const ids = async () => (await c.query<{ id: string }>("select id::text as id from public.contact_merges order by id")).rows.map((r) => r.id);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect(await ids()).toEqual([m1, m2]);
      await signIn(c, a, tech.sub);
      expect(await ids()).toEqual([m1]);
    }));

  it("blockers name merges: a merge not undone holds both sides; once undone, neither (mutations: drop the clause; drop `undone_at is null` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g6");
      const k = await person(c, a.accountId, { first: "Kept" });
      const o = await person(c, a.accountId, { first: "Other" });
      await tombstone(c, a.accountId, o, k);
      const m = await mergeRow(c, a.accountId, k, o);
      await asService(c);
      const { rows } = await c.query("select contact_id, reasons from public.contact_delete_blockers($1, $2::uuid[]) order by contact_id", [a.accountId, [k, o]]);
      expect(rows).toEqual([k, o].sort().map((id) => ({ contact_id: id, reasons: ["merges"] })));
      await c.query("update public.contact_merges set undone_at = now(), undone_by = 'user_seed' where id = $1", [m]);
      expect((await c.query("select contact_id from public.contact_delete_blockers($1, $2::uuid[])", [a.accountId, [k, o]])).rows).toEqual([]);
    }));

  it("the 30-day window is pinned: a 7-day undo_until fails contact_merges_window (mutation: drop the check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "g7");
      const k = await person(c, a.accountId, { first: "Kept" });
      const o = await person(c, a.accountId, { first: "Other" });
      const err = await refusal(c,
        `insert into public.contact_merges (account_id, keep_id, other_id, merged_by, undo_until, keep_before, keep_after, choices, moved, moved_counts, removed)
         values ($1, $2, $3, 'user_seed', now() + interval '7 days', '{}', '{}', '{}', '{}', '{}', '{}')`, [a.accountId, k, o]);
      expect(err?.code).toBe("23514");
      expect(err?.message).toContain("contact_merges_window");
    }));
});
