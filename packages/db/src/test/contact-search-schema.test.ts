import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember, actAsOwner } from "./db";
import { contactSearchName, nameFold } from "../dedupe-keys";

/**
 * 0108 (F-092 part 1, spec 4.3): pg_trgm in the extensions schema; contacts.search_name and client_groups.search_name,
 * stored, generated from app.contact_name_fold; one trigram GIN on each table. Replica only (withRollback).
 * RED BEFORE 0108: every case, because each names the extension, a column, a function or an index 0108 creates.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };

/** contact-dedupe-schema.test.ts:25-33, the org prefix changed. */
async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_search_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Search') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Search test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
/** contact-dedupe-schema.test.ts:42-48. */
type P = { first?: string | null; last?: string | null; phone?: string | null; email?: string | null };
async function person(c: Client, accountId: string, p: P = {}): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, last_name, phone, email, author_kind) values ($1, $2, $3, $4, $5, 'person') returning id",
    [accountId, p.first ?? null, p.last ?? null, p.phone ?? null, p.email ?? null]);
  return r!.id;
}
/** contact-dedupe-schema.test.ts:72-76. */
async function asService(c: Client) {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
}

describe("0108: the catalogue", () => {
  it("pg_trgm lives in the extensions schema (mutation: alter extension pg_trgm set schema public -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'");
      expect(rows).toEqual([{ nspname: "extensions" }]);
    }));

  it("both search_name columns are STORED generated with exactly these expressions (mutation: the contacts expression without company_name -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, is_generated, generation_expression from information_schema.columns
          where table_schema = 'public' and column_name = 'search_name' order by table_name`);
      expect(rows).toEqual([
        { table_name: "client_groups", is_generated: "ALWAYS", generation_expression: "app.contact_name_fold(name)" },
        { table_name: "contacts", is_generated: "ALWAYS", generation_expression: "app.contact_search_name(first_name, last_name, company_name)" },
      ]);
    }));

  it("app.contact_search_name is an immutable invoker with pg_temp last, EXECUTE for authenticated and service_role only (mutation: grant execute to anon -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.provolatile, p.prosecdef, p.proparallel, p.proconfig,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'contact_search_name'`);
      expect(rows).toEqual([{ provolatile: "i", prosecdef: false, proparallel: "s",
        proconfig: ["search_path=pg_catalog, pg_temp"], anon: false, auth: true, svc: true }]);
    }));

  // Read through pg_index and pg_opclass, never pg_get_indexdef: whether the opclass prints as gin_trgm_ops or
  // extensions.gin_trgm_ops depends on the session's search_path, which differs between the replica and Supabase.
  const INDEXES: [string, string[]][] = [
    ["contacts_search_trgm", ["search_name", "first_name", "last_name", "email", "phone", "phone_key", "phone_national"]],
    ["client_groups_search_trgm", ["search_name", "name"]],
  ];
  it.each(INDEXES)("%s is a GIN over %j, every column extensions.gin_trgm_ops (mutation: rebuild contacts_search_trgm without phone_national -> FAILS)", (index, columns) =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select am.amname, a.attname, oc.opcname, ocn.nspname
           from pg_index i
           join pg_class ic on ic.oid = i.indexrelid
           join pg_am am on am.oid = ic.relam
           cross join lateral unnest(i.indkey::int2[], i.indclass::oid[]) with ordinality as k(attnum, opc, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
           join pg_opclass oc on oc.oid = k.opc
           join pg_namespace ocn on ocn.oid = oc.opcnamespace
          where ic.relname = $1 order by k.ord`, [index]);
      expect(rows).toEqual(columns.map((attname) => ({ amname: "gin", attname, opcname: "gin_trgm_ops", nspname: "extensions" })));
    }));

  it.each([["contacts", "contacts_search_trgm"], ["client_groups", "client_groups_search_trgm"]])(
    "the planner serves a contains-search on %s.search_name from %s (mutation: rebuild it as a plain btree on search_name -> FAILS)",
    (table, index) =>
      withRollback(async (c) => {
        await c.query("set local enable_seqscan = off");
        const { rows } = await c.query(`explain (format text) select 1 from public.${table} where search_name ilike '%garcia%'`);
        // An Index Cond, not a Filter: a btree on search_name could be walked in full and filtered, which would
        // name the index without serving the pattern.
        expect(rows.map((r) => r["QUERY PLAN"]).join("\n"))
          .toMatch(new RegExp(`Bitmap Index Scan on ${index}[\\s\\S]*Index Cond: \\(search_name ~~\\* `));
      }));
});

describe("0108: the stored names match their TypeScript twins", () => {
  const SHAPES: [string | null, string | null, string | null][] = [
    ["María", "García López", null], ["MARIA", "GARCIA", null], ["maría", "garcía-lópez", null], ["Inés", "Peña", null],
    ["Mary", "O'Brien", null], ["Jose\u0301", "Pe\u0301rez", null], ["Ana", "Ruiz\u00A0Díaz", null], ["Ana\t", "  Ruiz  ", null],
    ["李", "王", null], ["Nguyễn", "Văn", null], [null, "Ruiz", null], ["", "  ", null], [null, null, null],
    ["Juan", null, "Plomería Pérez"], [null, null, "Taller Núñez"], ["Ana", "Ruiz", "  "], ["Zoë", "Brontë", "O'Neil & Hijos"],
  ];
  it.each(SHAPES)("app.contact_search_name(%j, %j, %j) = contactSearchName() (mutations: join with '|' in SQL -> the multi-part rows FAIL; return '' instead of null -> the empty rows FAIL)", (f, l, co) =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query("select app.contact_search_name($1, $2, $3) as v", [f, l, co]);
      expect(r.v).toBe(contactSearchName(f, l, co));
    }));

  it("a signed-in Owner's insert and edit store search_name (mutation: revoke execute on app.contact_search_name from authenticated -> 42501, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "own");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query(
        "insert into public.contacts (account_id, first_name, last_name) values ($1, 'María', 'García') returning id, search_name", [a.accountId]);
      expect(r.search_name).toBe("maria garcia");
      const { rows: [u] } = await c.query("update public.contacts set last_name = 'García López' where id = $1 returning search_name", [r.id]);
      expect(u.search_name).toBe("maria garcia lopez");
    }));

  it("a business member's search_name carries the business name the sync writes (0069/0072; mutation: the column's expression with null for company_name -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "biz");
      const id = await person(c, a.accountId, { first: "Juan", last: "Pérez" });
      // public.create_group_with_member(uuid, uuid, text, text, text default null) is EXECUTE service_role only
      // (0069 section 9), hence asService.
      await asService(c);
      await c.query("select public.create_group_with_member($1, $2, 'business', 'Taller Núñez', null)", [a.accountId, id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query("select company_name, search_name from public.contacts where id = $1", [id]);
      expect(r).toEqual({ company_name: "Taller Núñez", search_name: contactSearchName("Juan", "Pérez", "Taller Núñez") });
      expect(r.search_name).toBe("juan perez taller nunez");
    }));

  it.each(["Familia García", "Plomería Núñez-Peña", "  FAMILIA  O'BRIEN ", "李家"])(
    "client_groups.search_name = nameFold(%j) (mutation: generate it from app.group_name_key(name) -> every row FAILS: accents, punctuation and runs of spaces stay)", (name) =>
      withRollback(async (c) => {
        const a = await seedAccount(c, "grp");
        const id = await person(c, a.accountId, { first: "Ana" });
        await asService(c);
        await c.query("select public.create_group_with_member($1, $2, 'household', $3, null)", [a.accountId, id, name]);
        await actAsOwner(c);
        const { rows: [r] } = await c.query(
          "select search_name from public.client_groups where account_id = $1 and name = $2", [a.accountId, name.trim()]);
        expect(r.search_name).toBe(nameFold(name));
      }));
});
