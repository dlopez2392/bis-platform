import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0095_structured_facts.sql (S-47c): voice_profiles.business_hours, voice_services, voice_knowledge_snapshots,
 * the knowledge_version stamps with their composite keys, app.voice_business_hours_valid, and the two RPCs.
 * RED BEFORE APPLY: every case names an object that does not exist yet (except the teardown-list case, green on
 * pre by design).
 *
 * Every refusal names its constraint AND is shaped so that constraint is the only one that can refuse it: a shape
 * refusal carries a valid name, kind and lengths and changes exactly one amount or unit of a VALID row; a one-line
 * refusal carries a valid shape. Postgres tests CHECKs in alphabetical order of their names, so where two could
 * refuse one row (an unknown kind fails both price_kind and price_shape) the case names the first.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const P = (o: unknown) => JSON.stringify(o);
/** Line breaks built from code points, so this file holds no backslash escape (memory "Lane pipeline", 2026-10-22). */
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

type Seed = { accountId: string; orgId: string; phoneId: string; formId: string };
async function seed(c: Client, label: string, opts: { profile?: boolean } = {}): Promise<Seed> {
  await actAsOwner(c);
  const orgId = `org_facts_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Facts') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Structured facts', true) returning id`, [agency!.id, orgId]);
  if (opts.profile !== false) await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  const { rows: [phone] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [account!.id, testPhoneNumber()]);
  const { rows: [form] } = await c.query<{ id: string }>(
    "insert into public.forms (account_id, public_id, name) values ($1, $2, 'Chat') returning id",
    [account!.id, `pub_facts_${label}_${RUN}`]);
  return { accountId: account!.id, orgId, phoneId: phone!.id, formId: form!.id };
}

type Row = {
  position?: number; name_en?: string; name_es?: string | null; description_en?: string | null; description_es?: string | null;
  price_kind: string; amount_cents: number | null; amount_max_cents: number | null; unit_en: string | null; unit_es: string | null;
};
/** One VALID row per kind; every refusal below changes exactly one field of one of these. */
const VALID: Record<string, Row> = {
  fixed: { price_kind: "fixed", amount_cents: 2500, amount_max_cents: null, unit_en: null, unit_es: null },
  from: { price_kind: "from", amount_cents: 15000, amount_max_cents: null, unit_en: null, unit_es: null },
  range: { price_kind: "range", amount_cents: 12000, amount_max_cents: 25050, unit_en: null, unit_es: null },
  per_unit: { price_kind: "per_unit", amount_cents: 3500, amount_max_cents: null, unit_en: "guest", unit_es: "invitado" },
  free: { price_kind: "free", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
  after_visit: { price_kind: "after_visit", amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null },
};
function insertService(c: Client, accountId: string, r: Row) {
  return c.query(
    `insert into public.voice_services (account_id, position, name_en, name_es, description_en, description_es,
       price_kind, amount_cents, amount_max_cents, unit_en, unit_es)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [accountId, r.position ?? 1, r.name_en ?? "Haircut", r.name_es ?? null, r.description_en ?? null,
     r.description_es ?? null, r.price_kind, r.amount_cents, r.amount_max_cents, r.unit_en, r.unit_es]);
}
const SHAPE = { code: "23514", constraint: "voice_services_price_shape_check" };

/** Each clause of voice_services_price_shape_check, refused on its own (C16 is the per_unit/no unit_es row). */
const REFUSE: Array<[string, Row]> = [
  ["fixed without its amount", { ...VALID.fixed!, amount_cents: null }],
  ["fixed with a maximum", { ...VALID.fixed!, amount_max_cents: 3000 }],
  ["fixed with an English unit", { ...VALID.fixed!, unit_en: "hour" }],
  ["from with a Spanish unit", { ...VALID.from!, unit_es: "hora" }],
  ["from with a maximum", { ...VALID.from!, amount_max_cents: 20000 }],
  ["range without its maximum", { ...VALID.range!, amount_max_cents: null }],
  ["range with the maximum equal to the amount", { ...VALID.range!, amount_max_cents: 12000 }],
  ["range with the maximum below the amount", { ...VALID.range!, amount_max_cents: 11999 }],
  ["range with an English unit", { ...VALID.range!, unit_en: "hour" }],
  ["per_unit without its amount", { ...VALID.per_unit!, amount_cents: null }],
  ["per_unit without the English unit", { ...VALID.per_unit!, unit_en: null }],
  ["per_unit without the Spanish unit (C16)", { ...VALID.per_unit!, unit_es: null }],
  ["per_unit with a maximum", { ...VALID.per_unit!, amount_max_cents: 5000 }],
  ["free with an amount", { ...VALID.free!, amount_cents: 100 }],
  ["free with a maximum", { ...VALID.free!, amount_max_cents: 100 }],
  ["after_visit with a Spanish unit", { ...VALID.after_visit!, unit_es: "hora" }],
  ["after_visit with an amount", { ...VALID.after_visit!, amount_cents: 100 }],
];

describe("0095 voice_profiles.business_hours", () => {
  it("is jsonb, nullable, no default; a profile made without it reads null (mutation: default '{}' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'business_hours'`);
      expect(rows).toEqual([{ data_type: "jsonb", is_nullable: "YES", column_default: null }]);
      const { accountId } = await seed(c, "bh_null");
      expect((await c.query("select business_hours from public.voice_profiles where account_id = $1", [accountId])).rows)
        .toEqual([{ business_hours: null }]);
    }));
  it("takes an object and null; refuses an array by voice_profiles_business_hours_check (mutation: drop the CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "bh_check");
      await c.query("update public.voice_profiles set business_hours = $2::jsonb where account_id = $1", [accountId, P({ mon: [["08:00", "17:00"]] })]);
      await c.query("update public.voice_profiles set business_hours = null where account_id = $1", [accountId]);
      await expect(c.query("update public.voice_profiles set business_hours = '[]'::jsonb where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_profiles_business_hours_check" });
    }));
});

describe("0095 voice_services: the price shape (spec section 4; C2, C16)", () => {
  it("the refusal list has one row per clause (guards the loop from vacuity)", () => {
    expect(REFUSE.length).toBe(17);
    expect(Object.keys(VALID)).toEqual(["fixed", "from", "range", "per_unit", "free", "after_visit"]);
  });
  it.each(Object.entries(VALID))("accepts a valid %s row", (_k, row) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, `ok_${_k}`);
      await insertService(c, accountId, row);
      expect((await c.query("select count(*)::int as n from public.voice_services where account_id = $1", [accountId])).rows)
        .toEqual([{ n: 1 }]);
    }));
  it.each(REFUSE)("refuses %s by voice_services_price_shape_check (mutation: drop the CHECK -> FAILS)", (_n, row) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "shape");
      await expect(insertService(c, accountId, row)).rejects.toMatchObject(SHAPE);
    }));
  it("an unknown kind is refused by voice_services_price_kind_check (the first by name; mutation: drop it -> FAILS on the shape name instead)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "kind");
      await expect(insertService(c, accountId, { ...VALID.fixed!, price_kind: "hourly" }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_price_kind_check" });
    }));
});

describe("0095 voice_services: one line per text column, lengths, positions", () => {
  const COLS = ["name_en", "name_es", "description_en", "description_es", "unit_en", "unit_es"] as const;
  it.each(COLS)("a line feed in %s is refused by voice_services_<column>_one_line (mutation: drop that CHECK -> FAILS)", (col) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, `nl_${col}`);
      const base: Row = col.startsWith("unit") ? { ...VALID.per_unit! } : { ...VALID.fixed! };
      const row: Row = { ...base, [col]: col.startsWith("unit") ? `per${LF}hour` : `Hair${LF}cut` };
      await expect(insertService(c, accountId, row)).rejects.toMatchObject({ code: "23514", constraint: `voice_services_${col}_one_line` });
    }));
  it("a carriage return is refused too (mutation: check chr(10) only -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "cr");
      await expect(insertService(c, accountId, { ...VALID.fixed!, name_en: `Hair${CR}cut` }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_name_en_one_line" });
    }));
  it.each([
    ["name_en blank", { name_en: "   " }, "voice_services_name_en_check"],
    ["name_en 81 characters", { name_en: "a".repeat(81) }, "voice_services_name_en_check"],
    ["name_es empty", { name_es: "" }, "voice_services_name_es_check"],
    ["description_en 301 characters", { description_en: "d".repeat(301) }, "voice_services_description_en_check"],
    ["description_es blank", { description_es: " " }, "voice_services_description_es_check"],
  ] as const)("refuses %s by its named CHECK", (_n, over, constraint) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "len");
      await expect(insertService(c, accountId, { ...VALID.fixed!, ...over })).rejects.toMatchObject({ code: "23514", constraint });
    }));
  it("refuses a 31-character unit by voice_services_unit_es_check, and accepts 30 (mutation: between 1 and 31 -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "unit");
      await insertService(c, accountId, { ...VALID.per_unit!, unit_es: "u".repeat(30) });
      await expect(insertService(c, accountId, { ...VALID.per_unit!, position: 2, unit_es: "u".repeat(31) }))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_services_unit_es_check" });
    }));
  it("positions 1 and 50 are accepted; 0 is refused by voice_services_position_check (51 and a repeat have their own cases below)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "pos");
      await insertService(c, accountId, { ...VALID.fixed!, position: 1 });
      await insertService(c, accountId, { ...VALID.fixed!, position: 50 });
      await expect(insertService(c, accountId, { ...VALID.fixed!, position: 0 })).rejects.toMatchObject({ code: "23514", constraint: "voice_services_position_check" });
    }));
  it("position 51 is refused (mutation: between 1 and 51 -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "pos51");
      await expect(insertService(c, accountId, { ...VALID.fixed!, position: 51 })).rejects.toMatchObject({ code: "23514", constraint: "voice_services_position_check" });
    }));
  it("one account cannot hold two rows at one position (mutation: drop the unique key -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "dup");
      await insertService(c, accountId, { ...VALID.fixed!, position: 3 });
      await expect(insertService(c, accountId, { ...VALID.free!, position: 3 }))
        .rejects.toMatchObject({ code: "23505", constraint: "voice_services_account_position_key" });
    }));
});

describe("0095 voice_knowledge_snapshots: numbered, never edited", () => {
  const snap = (c: Client, accountId: string, version: number, payload = "{}", by = "user_x") =>
    c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, $2, $3::jsonb, $4)",
      [accountId, version, payload, by]);
  it.each([
    ["version 0", 0, "{}", "user_x", "voice_knowledge_snapshots_version_check"],
    ["an array payload", 1, "[]", "user_x", "voice_knowledge_snapshots_payload_check"],
    ["a blank author", 1, "{}", "  ", "voice_knowledge_snapshots_created_by_check"],
  ] as const)("refuses %s by its named CHECK", (_n, v, payload, by, constraint) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "snapchk");
      await expect(snap(c, accountId, v, payload, by)).rejects.toMatchObject({ code: "23514", constraint });
    }));
  it("one version per account (mutation: drop the unique key -> FAILS); another account may hold the same number", () =>
    withRollback(async (c) => {
      const a = await seed(c, "snapdupA"); const b = await seed(c, "snapdupB");
      await snap(c, a.accountId, 1); await snap(c, b.accountId, 1);
      await expect(snap(c, a.accountId, 1)).rejects.toMatchObject({ code: "23505", constraint: "voice_knowledge_snapshots_account_version_key" });
    }));
  it("an UPDATE raises 55000 even for the table owner (mutation: drop the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "never");
      await snap(c, accountId, 1, P({ facts: "a" }));
      await expect(c.query("update public.voice_knowledge_snapshots set payload = '{}'::jsonb where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "55000" });
    }));
  it("the account row delete carries snapshots and services away, once its restrict-keyed rows are gone (deleteAccountCascade order; SD4; mutation: snapshots account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "gone");
      await snap(c, s.accountId, 1);
      await insertService(c, s.accountId, VALID.fixed!);
      const { rows: [call] } = await c.query<{ id: string }>(
        "insert into public.calls (account_id, phone_number_id, knowledge_version) values ($1, $2, 1) returning id", [s.accountId, s.phoneId]);
      await c.query("delete from public.calls where id = $1", [call!.id]);
      await c.query("delete from public.forms where account_id = $1", [s.accountId]);
      await c.query("delete from public.voice_profiles where account_id = $1", [s.accountId]);
      await c.query("delete from public.phone_numbers where account_id = $1", [s.accountId]);
      await c.query("delete from public.accounts where id = $1", [s.accountId]);
      const { rows } = await c.query(`select (select count(*)::int from public.voice_knowledge_snapshots where account_id = $1) as snaps,
        (select count(*)::int from public.voice_services where account_id = $1) as services`, [s.accountId]);
      expect(rows).toEqual([{ snaps: 0, services: 0 }]);
    }));
  it("neither new table is on ACCOUNT_OWNED_TABLES: service_role cannot DELETE them, so a listed delete would fail every teardown (SD4)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("voice_services")).toBe(false);
    expect(listed.includes("voice_knowledge_snapshots")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the list is the real one, not an empty import
  });
});

/** The two stamped tables, as a literal list whose iteration is itself asserted. */
const STAMPED = ["calls", "concierge_conversations"] as const;
it("the stamped-table loop covers exactly calls and concierge_conversations", () => {
  expect([...STAMPED]).toEqual(["calls", "concierge_conversations"]);
});
for (const T of STAMPED) {
  describe(`0095 ${T}.knowledge_version`, () => {
    const insertRow = (c: Client, s: Seed, v: number | null) => T === "calls"
      ? c.query("insert into public.calls (account_id, phone_number_id, knowledge_version) values ($1, $2, $3) returning id", [s.accountId, s.phoneId, v])
      : c.query("insert into public.concierge_conversations (account_id, form_id, ip_hash, knowledge_version) values ($1, $2, 'iph', $3) returning id", [s.accountId, s.formId, v]);
    it("is integer, nullable, no default; NULL is admitted with no snapshot at all (MATCH SIMPLE)", () =>
      withRollback(async (c) => {
        const { rows } = await c.query(`select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = 'knowledge_version'`, [T]);
        expect(rows).toEqual([{ data_type: "integer", is_nullable: "YES", column_default: null }]);
        const s = await seed(c, `${T}_null`);
        await insertRow(c, s, null);
      }));
    it(`a version this account holds is admitted; a missing one is refused by ${T}_knowledge_version_fkey (mutation: drop the key -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_fk`);
        await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [s.accountId]);
        await insertRow(c, s, 1);
        await expect(insertRow(c, s, 2)).rejects.toMatchObject({ code: "23503", constraint: `${T}_knowledge_version_fkey` });
      }));
    it("ANOTHER account's version 1 does not satisfy the key (the composite key; mutation: key on knowledge_version alone to a unique version column -> FAILS)", () =>
      withRollback(async (c) => {
        const a = await seed(c, `${T}_xa`); const b = await seed(c, `${T}_xb`);
        await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [b.accountId]);
        await expect(insertRow(c, a, 1)).rejects.toMatchObject({ code: "23503", constraint: `${T}_knowledge_version_fkey` });
      }));
    it(`version 0 is refused by ${T}_knowledge_version_check`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_zero`);
        await expect(insertRow(c, s, 0)).rejects.toMatchObject({ code: "23514", constraint: `${T}_knowledge_version_check` });
      }));
  });
}

describe("0095 every new constraint, as defined", () => {
  it("pg_get_constraintdef for each (pinned after reading the replica's own output)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where contype <> 'n'
            and (conrelid in ('public.voice_services'::regclass, 'public.voice_knowledge_snapshots'::regclass)
                 or conname in ('voice_profiles_business_hours_check', 'calls_knowledge_version_check', 'calls_knowledge_version_fkey',
                                'concierge_conversations_knowledge_version_check', 'concierge_conversations_knowledge_version_fkey'))
          order by conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        // Every def exactly as the PG18 post replica printed it (2026-10-23), each read against the migration
        // (the primary, unique and foreign keys included). contype 'n' is excluded on purpose: the
        // PG18 replica lists NOT NULL as named constraints and CI's stack is PostgreSQL 17
        // (packages/db/supabase/config.toml:42, major_version = 17), which does not, so a pinned map that held them
        // would pass locally and fail in verify.
        calls_knowledge_version_check: `CHECK ((knowledge_version > 0))`,
        calls_knowledge_version_fkey: `FOREIGN KEY (account_id, knowledge_version) REFERENCES voice_knowledge_snapshots(account_id, version)`,
        concierge_conversations_knowledge_version_check: `CHECK ((knowledge_version > 0))`,
        concierge_conversations_knowledge_version_fkey: `FOREIGN KEY (account_id, knowledge_version) REFERENCES voice_knowledge_snapshots(account_id, version)`,
        voice_knowledge_snapshots_account_id_fkey: `FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE`,
        voice_knowledge_snapshots_account_version_key: `UNIQUE (account_id, version)`,
        voice_knowledge_snapshots_created_by_check: `CHECK ((length(btrim(created_by)) > 0))`,
        voice_knowledge_snapshots_payload_check: `CHECK ((jsonb_typeof(payload) = 'object'::text))`,
        voice_knowledge_snapshots_pkey: `PRIMARY KEY (id)`,
        voice_knowledge_snapshots_version_check: `CHECK ((version > 0))`,
        voice_profiles_business_hours_check: `CHECK (((business_hours IS NULL) OR (jsonb_typeof(business_hours) = 'object'::text)))`,
        voice_services_account_id_fkey: `FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE`,
        voice_services_account_position_key: `UNIQUE (account_id, "position")`,
        voice_services_amount_cents_check: `CHECK (((amount_cents IS NULL) OR ((amount_cents >= 1) AND (amount_cents <= 100000000))))`,
        voice_services_description_en_check: `CHECK (((description_en IS NULL) OR ((length(btrim(description_en)) >= 1) AND (length(btrim(description_en)) <= 300))))`,
        voice_services_description_en_one_line: `CHECK (((strpos(description_en, chr(10)) = 0) AND (strpos(description_en, chr(13)) = 0)))`,
        voice_services_description_es_check: `CHECK (((description_es IS NULL) OR ((length(btrim(description_es)) >= 1) AND (length(btrim(description_es)) <= 300))))`,
        voice_services_description_es_one_line: `CHECK (((strpos(description_es, chr(10)) = 0) AND (strpos(description_es, chr(13)) = 0)))`,
        voice_services_name_en_check: `CHECK (((length(btrim(name_en)) >= 1) AND (length(btrim(name_en)) <= 80)))`,
        voice_services_name_en_one_line: `CHECK (((strpos(name_en, chr(10)) = 0) AND (strpos(name_en, chr(13)) = 0)))`,
        voice_services_name_es_check: `CHECK (((name_es IS NULL) OR ((length(btrim(name_es)) >= 1) AND (length(btrim(name_es)) <= 80))))`,
        voice_services_name_es_one_line: `CHECK (((strpos(name_es, chr(10)) = 0) AND (strpos(name_es, chr(13)) = 0)))`,
        voice_services_pkey: `PRIMARY KEY (id)`,
        voice_services_position_check: `CHECK ((("position" >= 1) AND ("position" <= 50)))`,
        voice_services_price_kind_check: `CHECK ((price_kind = ANY (ARRAY['fixed'::text, 'from'::text, 'range'::text, 'per_unit'::text, 'free'::text, 'after_visit'::text])))`,
        voice_services_price_shape_check: `CHECK ((((price_kind = ANY (ARRAY['fixed'::text, 'from'::text])) AND (amount_cents IS NOT NULL) AND (amount_max_cents IS NULL) AND (unit_en IS NULL) AND (unit_es IS NULL)) OR ((price_kind = 'range'::text) AND (amount_cents IS NOT NULL) AND (amount_max_cents IS NOT NULL) AND (amount_max_cents > amount_cents) AND (unit_en IS NULL) AND (unit_es IS NULL)) OR ((price_kind = 'per_unit'::text) AND (amount_cents IS NOT NULL) AND (amount_max_cents IS NULL) AND (unit_en IS NOT NULL) AND (unit_es IS NOT NULL)) OR ((price_kind = ANY (ARRAY['free'::text, 'after_visit'::text])) AND (amount_cents IS NULL) AND (amount_max_cents IS NULL) AND (unit_en IS NULL) AND (unit_es IS NULL))))`,
        voice_services_unit_en_check: `CHECK (((unit_en IS NULL) OR ((length(btrim(unit_en)) >= 1) AND (length(btrim(unit_en)) <= 30))))`,
        voice_services_unit_en_one_line: `CHECK (((strpos(unit_en, chr(10)) = 0) AND (strpos(unit_en, chr(13)) = 0)))`,
        voice_services_unit_es_check: `CHECK (((unit_es IS NULL) OR ((length(btrim(unit_es)) >= 1) AND (length(btrim(unit_es)) <= 30))))`,
        voice_services_unit_es_one_line: `CHECK (((strpos(unit_es, chr(10)) = 0) AND (strpos(unit_es, chr(13)) = 0)))`,
      });
    }));
});

describe("0095 grants: the client role reads, nobody writes but the two functions", () => {
  it("table privileges on both new tables (mutations: grant insert to service_role -> FAILS; grant update to authenticated -> FAILS; grant maintain to service_role -> FAILS)", () =>
    withRollback(async (c) => {
      // MAINTAIN exists from PostgreSQL 17 (CI's stack and the PG18 replica both have it; review 2026-10-23).
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k
           from (values ('public.voice_services'), ('public.voice_knowledge_snapshots')) tt(t)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) pp(p)
          where has_table_privilege(r, t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "authenticated public.voice_knowledge_snapshots SELECT", "authenticated public.voice_services SELECT",
        "service_role public.voice_knowledge_snapshots SELECT", "service_role public.voice_services SELECT",
      ]);
    }));
  it("function privileges: only service_role executes the two RPCs; nobody but the owner the validator (mutation: grant execute on save_voice_knowledge to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || f as k
           from (values ('public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer)'),
                        ('public.ensure_knowledge_snapshot(uuid, jsonb)'),
                        ('app.voice_business_hours_valid(jsonb)')) ff(f)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          where has_function_privilege(r, f, 'EXECUTE') order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "service_role public.ensure_knowledge_snapshot(uuid, jsonb)",
        "service_role public.save_voice_knowledge(uuid, text, jsonb, jsonb, integer)",
      ]);
    }));
  it("business_hours: authenticated may SELECT it and not UPDATE it (column privileges; C17)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select has_column_privilege('authenticated', 'public.voice_profiles', 'business_hours', 'SELECT') as sel,
                has_column_privilege('authenticated', 'public.voice_profiles', 'business_hours', 'UPDATE') as upd,
                has_column_privilege('anon', 'public.voice_profiles', 'business_hours', 'SELECT') as anon_sel`);
      expect(r).toEqual({ sel: true, upd: false, anon_sel: false });
    }));
  it("service_role cannot write either table directly (insert, update, delete, truncate: 42501)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "srv");
      await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [accountId]);
      await c.query("set local role service_role");
      for (const sql of [
        "insert into public.voice_services (account_id, position, name_en, price_kind) values ($1, 1, 'A', 'free')",
        "insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 2, '{}', 'system')",
        "update public.voice_knowledge_snapshots set created_by = 'x' where account_id = $1",
        "delete from public.voice_knowledge_snapshots where account_id = $1",
        "delete from public.voice_services where account_id = $1",
      ]) {
        await c.query("savepoint s");
        await expect(c.query(sql, [accountId]), sql).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint s");
      }
      await expect(c.query("truncate public.voice_knowledge_snapshots")).rejects.toMatchObject({ code: "42501" });
    }));
  it("the agency's own token can neither write a row nor run either RPC (it writes through serviceDb)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "agency");
      await actAs(c, { org_id: orgId, app_role: "agency_admin", sub: "user_facts_agency" });
      await c.query("savepoint s");
      await expect(c.query("insert into public.voice_services (account_id, position, name_en, price_kind) values ($1, 1, 'A', 'free')", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.ensure_knowledge_snapshot($1, '{}'::jsonb)", [accountId])).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0095 RLS: Owners read, Staff and Technicians do not, other accounts do not", () => {
  async function seeded(c: Client, label: string) {
    const s = await seed(c, label);
    await insertService(c, s.accountId, VALID.fixed!);
    await c.query("insert into public.voice_knowledge_snapshots (account_id, version, payload, created_by) values ($1, 1, '{}', 'system')", [s.accountId]);
    return s;
  }
  const counts = async (c: Client, accountId: string) => (await c.query(
    `select (select count(*)::int from public.voice_services where account_id = $1) as services,
            (select count(*)::int from public.voice_knowledge_snapshots where account_id = $1) as snaps`, [accountId])).rows[0];
  it("an Owner of the account reads both (mutation: drop the member-read policy -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "owner");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      expect(await counts(c, s.accountId)).toEqual({ services: 1, snaps: 1 });
    }));
  it.each(["staff", "technician"] as const)("a %s member reads neither (mutation: drop the owners-only policy -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seeded(c, `role_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      expect(await counts(c, s.accountId)).toEqual({ services: 0, snaps: 0 });
    }));
  // The two policies TOGETHER keep another account out: the restrictive Owners-only policy carries its own
  // `account_id = current_account_id()` clause (0066's shape; SD22), so loosening either one alone leaves this case
  // green. The policy pin below is what catches a loosened member-read policy (plan review, 2026-10-23).
  it("an Owner of ANOTHER account reads neither (the member-read and Owners-only policies together)", () =>
    withRollback(async (c) => {
      const a = await seeded(c, "xa"); const b = await seed(c, "xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await counts(c, a.accountId)).toEqual({ services: 0, snaps: 0 });
    }));
  it("the four policies, as defined (mutations: member-read using (true) -> FAILS; drop the account_id clause from owners_only -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ polname: string; polpermissive: boolean; q: string }>(
        `select polname, polpermissive, pg_get_expr(polqual, polrelid) as q from pg_policy
          where polrelid in ('public.voice_services'::regclass, 'public.voice_knowledge_snapshots'::regclass) order by 1`);
      // Read off the plan writer's PG18 replica with this file's SQL applied (2026-10-23). If CI's PostgreSQL 17
      // deparses one differently, the implementer pastes CI's text after reading that it says the same thing.
      const OWNERS_ONLY = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND ( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner)))`;
      const MEMBER_READ = "(app.is_agency() OR (account_id = app.current_account_id()))";
      expect(rows).toEqual([
        { polname: "voice_knowledge_snapshots_member_read", polpermissive: true, q: MEMBER_READ },
        { polname: "voice_knowledge_snapshots_owners_only", polpermissive: false, q: OWNERS_ONLY },
        { polname: "voice_services_member_read", polpermissive: true, q: MEMBER_READ },
        { polname: "voice_services_owners_only", polpermissive: false, q: OWNERS_ONLY },
      ]);
    }));
  it("the agency reads both", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "ag");
      await actAs(c, { app_role: "agency_admin", sub: "user_facts_ag" });
      expect(await counts(c, s.accountId)).toEqual({ services: 1, snaps: 1 });
    }));
  it("anon has no grant at all (42501)", () =>
    withRollback(async (c) => {
      await seed(c, "anon");
      await c.query("set local role anon");
      await expect(c.query("select 1 from public.voice_services limit 1")).rejects.toMatchObject({ code: "42501" });
    }));
  it("every member reads business_hours, Staff included (C17; it is a voice_profiles column)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "bh_staff");
      await c.query("update public.voice_profiles set business_hours = $2::jsonb where account_id = $1", [s.accountId, P({ mon: [["08:00", "17:00"]] })]);
      await actAsMember(c, s.accountId, s.orgId, "staff");
      expect((await c.query("select business_hours from public.voice_profiles where account_id = $1", [s.accountId])).rows)
        .toEqual([{ business_hours: { mon: [["08:00", "17:00"]] } }]);
    }));
});

describe("0095 app.voice_business_hours_valid", () => {
  const ok = async (c: Client, h: unknown) =>
    (await c.query<{ v: boolean }>("select app.voice_business_hours_valid($1::jsonb) as v", [P(h)])).rows[0]!.v;
  it.each([
    ["one day", { mon: [["08:00", "17:00"]] }],
    ["a lunch gap", { tue: [["08:00", "12:00"], ["13:00", "18:00"]] }],
    ["touching spans", { wed: [["08:00", "12:00"], ["12:00", "18:00"]] }],
    ["an end at 24:00 and a start at 00:00", { fri: [["18:00", "24:00"]], sat: [["00:00", "02:00"]] }],
  ] as const)("accepts %s", (_n, h) => withRollback(async (c) => { expect(await ok(c, h)).toBe(true); }));
  it.each([
    ["an array", []],
    ["an empty object (no open day; SD17)", {}],
    ["an unknown day key", { monday: [["08:00", "17:00"]] }],
    ["an empty day", { mon: [] }],
    ["a span that is not a pair", { mon: [["08:00"]] }],
    ["a time without its leading zero", { mon: [["8:00", "17:00"]] }],
    // Also refused by the end-after-start check, and no fixture can isolate the start-hour bound: a span that starts
    // at 24:xx can never end after it. Mutating that bound alone leaves this case green (Task 1 implementer, x12f).
    ["24:00 as a start", { mon: [["24:00", "24:00"]] }],
    ["minute 60", { mon: [["08:60", "17:00"]] }],
    ["an end before its start", { mon: [["17:00", "08:00"]] }],
    ["an end equal to its start", { mon: [["08:00", "08:00"]] }],
    ["overlapping spans", { mon: [["08:00", "13:00"], ["12:00", "18:00"]] }],
    ["spans out of order", { mon: [["13:00", "18:00"], ["08:00", "12:00"]] }],
    ["a number for a time", { mon: [[800, 1700]] }],
    // Added by the Task 1 implementer (2026-10-23): the four checks below were each droppable with the whole file
    // green. The regexes carry no end anchor (byte rules), so a length check pins each end: "08:00x" passes the
    // regex and only the length check refuses it. A JSON null time is what the string-type checks guard: without
    // them every comparison on the NULL is NULL, no IF fires, and the function returns true (the plpgsql NULL
    // lesson). "a number for a time" above is refused by the length check ("800"), so it cannot catch that.
    ["a start with a trailing character", { mon: [["08:00x", "17:00"]] }],
    ["an end with a trailing character", { mon: [["08:00", "17:00x"]] }],
    ["a JSON null for a start", { mon: [[null, "17:00"]] }],
    ["a JSON null for an end", { mon: [["08:00", null]] }],
  ] as const)("refuses %s (mutation: drop the matching check in the function -> that case FAILS)", (_n, h) =>
    withRollback(async (c) => { expect(await ok(c, h)).toBe(false); }));
});

describe("0095 save_voice_knowledge (spec 4.1)", () => {
  const H = { mon: [["08:00", "12:00"], ["13:00", "18:00"]] };
  const call = async (c: Client, accountId: string, parts: unknown, payload: unknown, base: number, actor = "user_saver") => {
    await c.query("set local role service_role");
    const { rows: [r] } = await c.query<{ r: Record<string, unknown> }>(
      "select public.save_voice_knowledge($1, $2, $3::jsonb, $4::jsonb, $5) as r", [accountId, actor, P(parts), P(payload), base]);
    await actAsOwner(c);
    return r!.r;
  };
  const state = async (c: Client, accountId: string) => (await c.query(
    `select vp.facts, vp.services, vp.business_hours,
            (select count(*)::int from public.voice_knowledge_snapshots s where s.account_id = vp.account_id) as snaps,
            (select count(*)::int from public.events e where e.account_id = vp.account_id and e.type = 'voice_profile.updated') as events,
            (select coalesce(json_agg(v.name_en order by v.position), '[]'::json) from public.voice_services v where v.account_id = vp.account_id) as names
       from public.voice_profiles vp where vp.account_id = $1`, [accountId])).rows[0];
  const svc = (name_en: string) => ({ name_en, name_es: null, description_en: null, description_es: null, ...VALID.free! });
  /**
   * The state every "nothing is written" case starts from: facts, hours AND a one-row list, saved through the RPC
   * as snapshot 1 (review 2026-10-23: with no list seeded, a refused save that deleted the whole list outside the
   * rollback block left every such case green).
   */
  const seedKnowledge = async (c: Client, accountId: string) => {
    expect(await call(c, accountId, { facts: "Old", business_hours: H, services: [svc("Keep")] }, { v: 1 }, 0))
      .toEqual({ status: "ok", version: 1 });
    const s = await state(c, accountId);
    expect(s).toMatchObject({ facts: "Old", business_hours: H, names: ["Keep"], snaps: 1, events: 1 });
    return s;
  };

  it("ok: writes the named parts, one event naming them, and snapshot 1 with the payload as sent, by the actor", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_ok");
      expect(await call(c, accountId, { facts: "Open late.", business_hours: H }, { v: 1 }, 0)).toEqual({ status: "ok", version: 1 });
      expect(await state(c, accountId)).toEqual({ facts: "Open late.", services: "", business_hours: H, snaps: 1, events: 1, names: [] });
      const { rows } = await c.query(`select s.version, s.payload, s.created_by, e.actor_type, e.actor_id, e.payload as ev
        from public.voice_knowledge_snapshots s join public.events e on e.account_id = s.account_id
       where s.account_id = $1 and e.type = 'voice_profile.updated'`, [accountId]);
      expect(rows).toEqual([{ version: 1, payload: { v: 1 }, created_by: "user_saver", actor_type: "user", actor_id: "user_saver",
        ev: { fields: ["facts", "business_hours"] } }]);
    }));
  it("the event names every part sent, in the fixed order (mutation: drop the services_text branch -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_fields");
      await call(c, accountId, { services: [], business_hours: null, services_text: "Roofs", facts: "F" }, { v: 1 }, 0);
      const { rows } = await c.query("select payload from public.events where account_id = $1 and type = 'voice_profile.updated'", [accountId]);
      expect(rows).toEqual([{ payload: { fields: ["facts", "services", "business_hours", "voice_services"] } }]);
    }));
  it("an equal payload records no new version and answers the latest (mutation: always append -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_eq");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      expect(await call(c, accountId, { facts: "A" }, { v: 1 }, 1)).toEqual({ status: "ok", version: 1 });
      expect((await state(c, accountId))!.snaps).toBe(1);
    }));
  it("a different payload records version n+1", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_next");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      expect(await call(c, accountId, { facts: "B" }, { v: 2 }, 1)).toEqual({ status: "ok", version: 2 });
    }));
  it("stale: a base that is no longer the latest writes nothing at all (mutation: drop the stale check -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_stale");
      await call(c, accountId, { facts: "A" }, { v: 1 }, 0);
      const before = await state(c, accountId);
      expect(await call(c, accountId, { facts: "B" }, { v: 2 }, 0)).toEqual({ status: "stale" });
      expect(await state(c, accountId)).toEqual(before);
    }));
  it("latest means the HIGHEST version: after saves 1 and 2, base 1 is stale, and base 2 appends 3 even for a payload equal to an older one (review mutation o08: read the latest ascending -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_latest");
      expect(await call(c, accountId, { facts: "A" }, { v: "A" }, 0)).toEqual({ status: "ok", version: 1 });
      expect(await call(c, accountId, { facts: "B" }, { v: "B" }, 1)).toEqual({ status: "ok", version: 2 });
      expect(await call(c, accountId, { facts: "A" }, { v: "A" }, 1)).toEqual({ status: "stale" });
      expect(await call(c, accountId, { facts: "A" }, { v: "A" }, 2)).toEqual({ status: "ok", version: 3 });
      const { rows } = await c.query("select version, payload from public.voice_knowledge_snapshots where account_id = $1 order by version", [accountId]);
      expect(rows).toEqual([{ version: 1, payload: { v: "A" } }, { version: 2, payload: { v: "B" } }, { version: 3, payload: { v: "A" } }]);
    }));
  it("stale with no snapshot at all: a base other than 0 writes nothing (review mutation o09: compare without coalesce -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_stale_none");
      const before = await state(c, accountId);
      expect(before).toMatchObject({ snaps: 0, events: 0 });
      expect(await call(c, accountId, { facts: "B" }, { v: 2 }, 5)).toEqual({ status: "stale" });
      expect(await state(c, accountId)).toEqual(before);
    }));
  it("no_profile: an account with no voice profile, and an account that does not exist", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_noprof", { profile: false });
      expect(await call(c, accountId, { facts: "A" }, { v: 1 }, 0)).toEqual({ status: "no_profile" });
      expect(await call(c, "00000000-0000-0000-0000-000000000000", { facts: "A" }, { v: 1 }, 0)).toEqual({ status: "no_profile" });
    }));
  it("the services are replaced in order, positions 1..n (mutation: insert without the delete -> FAILS on the unique key)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_svc");
      await call(c, accountId, { services: [svc("A"), svc("B")] }, { v: 1 }, 0);
      await call(c, accountId, { services: [svc("C"), svc("A"), svc("D")] }, { v: 2 }, 1);
      expect((await state(c, accountId))!.names).toEqual(["C", "A", "D"]);
      const { rows } = await c.query("select position from public.voice_services where account_id = $1 order by position", [accountId]);
      expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    }));
  it.each([
    ["a per_unit row without its Spanish unit (C16)", { services: [{ name_en: "Catering", ...VALID.per_unit!, unit_es: null }] }],
    ["51 services", { services: Array.from({ length: 51 }, (_v, i) => ({ name_en: `S${i}`, ...VALID.free! })) }],
    ["an amount that is not a whole number of cents", { services: [{ name_en: "A", ...VALID.fixed!, amount_cents: "12.5" }] }],
    ["a service with no English name", { services: [{ ...VALID.free! }] }],
    ["malformed hours", { business_hours: { mon: [["17:00", "08:00"]] } }],
    ["hours as an array", { business_hours: [] }],
    ["facts as a number", { facts: 7 }],
    ["services as an object", { services: {} }],
    ["an unknown part", { facts: "A", notes: "x" }],
    ["no part at all", {}],
  ] as const)("invalid: %s, and nothing is written, the stored list included (mutations: drop the exception block -> the four row cases FAIL, the RPC raises; delete the list outside the block (review o10) -> the four row cases FAIL; drop the earlier check that refuses one of the other six -> that case FAILS)", (_n, parts) =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_inv");
      const before = await seedKnowledge(c, accountId);
      expect(await call(c, accountId, parts, { v: 9 }, 1)).toEqual({ status: "invalid" });
      expect(await state(c, accountId)).toEqual(before);
    }));
  it("a bad list sent WITH a facts change leaves the facts, the hours and the stored list unchanged (A4: the block rolls back what it already wrote; mutations: run the profile update before the block -> FAILS; delete the list outside the block (review o10) -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_atomic");
      await seedKnowledge(c, accountId);
      expect(await call(c, accountId, { facts: "New", services: [{ name_en: "X", ...VALID.per_unit!, unit_es: null }] }, { v: 2 }, 1))
        .toEqual({ status: "invalid" });
      expect(await state(c, accountId)).toMatchObject({ facts: "Old", business_hours: H, names: ["Keep"], snaps: 1, events: 1 });
    }));
  it("clears the hours with JSON null", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_clear");
      await call(c, accountId, { business_hours: H }, { v: 1 }, 0);
      await call(c, accountId, { business_hours: null }, { v: 2 }, 1);
      expect((await state(c, accountId))!.business_hours).toBeNull();
    }));
  it("a null argument or a blank actor raises 22004 (SD21)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "save_null");
      await c.query("set local role service_role");
      await c.query("savepoint s");
      await expect(c.query("select public.save_voice_knowledge($1, '  ', '{}'::jsonb, '{}'::jsonb, 0)", [accountId]))
        .rejects.toMatchObject({ code: "22004" });
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.save_voice_knowledge($1, 'u', null, '{}'::jsonb, 0)", [accountId]))
        .rejects.toMatchObject({ code: "22004" });
    }));
});

describe("0095 ensure_knowledge_snapshot (spec 4.1, 5.6)", () => {
  const ensure = async (c: Client, accountId: string, payload: unknown) => {
    await c.query("set local role service_role");
    const { rows: [r] } = await c.query<{ v: number }>("select public.ensure_knowledge_snapshot($1, $2::jsonb) as v", [accountId, P(payload)]);
    await actAsOwner(c);
    return r!.v;
  };
  it("appends version 1 as system, answers it again for an equal payload, and appends 2 for a different one (mutation: drop BOTH equality checks -> FAILS; the fast-path check alone is mutation 20)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "ens");
      expect(await ensure(c, accountId, { a: 1 })).toBe(1);
      expect(await ensure(c, accountId, { a: 1 })).toBe(1);
      expect(await ensure(c, accountId, { a: 2 })).toBe(2);
      const { rows } = await c.query("select version, created_by from public.voice_knowledge_snapshots where account_id = $1 order by version", [accountId]);
      expect(rows).toEqual([{ version: 1, created_by: "system" }, { version: 2, created_by: "system" }]);
    }));
  it("latest means the HIGHEST version: 1, 2, 3, again 3, then a payload equal to version 1 appends 4 (review mutation o13: read the latest ascending -> FAILS, 23505 on the third)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "ens_latest");
      const got: number[] = [];
      for (const p of [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 3 }, { a: 1 }]) got.push(await ensure(c, accountId, p));
      expect(got).toEqual([1, 2, 3, 3, 4]);
      const { rows } = await c.query("select version, payload from public.voice_knowledge_snapshots where account_id = $1 order by version", [accountId]);
      expect(rows).toEqual([{ version: 1, payload: { a: 1 } }, { version: 2, payload: { a: 2 } }, { version: 3, payload: { a: 3 } }, { version: 4, payload: { a: 1 } }]);
    }));
  it("an account that does not exist raises P0002", () =>
    withRollback(async (c) => {
      await c.query("set local role service_role");
      await expect(c.query("select public.ensure_knowledge_snapshot('00000000-0000-0000-0000-000000000000', '{}'::jsonb)"))
        .rejects.toMatchObject({ code: "P0002" });
    }));
});

describe("0095 comments name their writer", () => {
  it("every column of the two new tables, both tables, and the three added columns carry a comment (mutation: delete one -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select cl.relname || '.' || a.attname as k from pg_attribute a
           join pg_class cl on cl.oid = a.attrelid join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
            and (cl.relname in ('voice_services', 'voice_knowledge_snapshots')
                 or (cl.relname = 'voice_profiles' and a.attname = 'business_hours')
                 or (cl.relname in ('calls', 'concierge_conversations') and a.attname = 'knowledge_version'))
            and coalesce(col_description(cl.oid, a.attnum), '') = ''
          order by 1`);
      expect(rows).toEqual([]);
      const { rows: t } = await c.query(`select obj_description('public.voice_services'::regclass, 'pg_class') is not null as s,
        obj_description('public.voice_knowledge_snapshots'::regclass, 'pg_class') is not null as k`);
      expect(t).toEqual([{ s: true, k: true }]);
    }));
  it("the stamps name their writers", () =>
    withRollback(async (c) => {
      const d = async (t: string) => (await c.query<{ d: string }>(
        "select col_description($1::regclass, (select attnum from pg_attribute where attrelid = $1::regclass and attname = 'knowledge_version')) as d", [t])).rows[0]!.d;
      expect(await d("public.calls")).toContain("startCallRow");
      expect(await d("public.concierge_conversations")).toContain("createConciergeConversation");
    }));
});
