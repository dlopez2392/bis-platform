import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";
import { contactSearchFilter } from "../contacts";
import { contactSearchPlan } from "../contact-search";
import { sanitizeSearchTerm, searchTermLength } from "../search-term";

/**
 * 0110 (F-092 scale follow-up, parts B and C; docs/superpowers/specs/2026-10-31-search-scale-design.md 4.2, 4.3,
 * 4.5, 4.6 items 5-9, 4.7): btree_gin; contacts_search_trgm rebuilt account-first; app.contact_match_ids, a SECURITY
 * DEFINER matcher; public.contacts_matching, its INVOKER entry point. Replica only (withRollback; the live PostgREST
 * comparison is bis-crm's, contact-search-live.test.ts, spec 4.6).
 *
 * RED BEFORE 0110: every case but two, because each names btree_gin, the account-first index, or one of the two
 * functions. GREEN BEFORE AND AFTER, by design, and not evidence of 0110: "the oracle reads the corpus as expected"
 * (it pins the oracle, which reads only public.contacts) and "the length is the typed one" (pure TypeScript).
 * GREEN AFTER 0110: all of them.
 *
 * Why the matcher is called DIRECTLY (spec 4.6 item 6): through the entry point, RLS on contacts drops any id the
 * matcher should not have returned, so a matcher that answered too much would still look right there. The direct
 * calls are what prove the matcher's own account and Technician gates.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const FN = "app.contact_match_ids(uuid,text,text[],text[],text)";
const ENTRY = "public.contacts_matching(uuid,text,text[],text[],text)";

type Acct = { accountId: string; orgId: string };
type Member = { sub: string; userId: string };

async function seedAccount(c: Client, label: string, enabled = true): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_match_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Match') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Match test', $3) returning id`, [agency!.id, orgId, enabled]);
  return { accountId: account!.id, orgId };
}

/** A users row, plus a membership when `role` is given (as the table owner, before any role switch). */
async function seedUser(c: Client, accountId: string, role: "owner" | "staff" | "technician" | null): Promise<Member> {
  await actAsOwner(c);
  const sub = `user_match_${role ?? "none"}_${Math.random().toString(36).slice(2, 10)}`;
  const { rows: [u] } = await c.query<{ id: string }>(
    "insert into public.users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
  if (role) {
    await c.query("insert into public.memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, accountId, role]);
  }
  return { sub, userId: u!.id };
}

type P = {
  first?: string | null; last?: string | null; email?: string | null; phone?: string | null;
  assignedTo?: string | null; archived?: boolean; mergedInto?: string | null; holding?: boolean;
};
async function person(c: Client, accountId: string, p: P = {}): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    `insert into public.contacts (account_id, first_name, last_name, email, phone, assigned_to, archived_at,
                                  merged_into, merged_at, holds_shared_number, author_kind)
     values ($1, $2, $3, $4, $5, $6, case when $7 then now() end, $8, case when $8::uuid is not null then now() end,
             $9, 'person') returning id`,
    [accountId, p.first ?? null, p.last ?? null, p.email ?? null, p.phone ?? null, p.assignedTo ?? null,
     p.archived ?? false, p.mergedInto ?? null, p.holding ?? false]);
  return r!.id;
}

async function asService(c: Client) {
  await actAsOwner(c);
  await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  await c.query("set local role service_role");
}

/**
 * The corpus: the same people in two accounts (so an answer that ignored the account shows up as the other
 * account's ids), among them three spellings of one Cyrillic name and a phone stored as typed; plus, in A only, an
 * archived, a merged-away and a holding record and a business member. `techIds` are the rows of A assigned to A's
 * Technician.
 */
type Corpus = { a: Acct; b: Acct; owner: Member; tech: Member; techIds: string[]; aAll: string[] };
async function seedCorpus(c: Client): Promise<Corpus> {
  const a = await seedAccount(c, "a");
  const b = await seedAccount(c, "b");
  const owner = await seedUser(c, a.accountId, "owner");
  const tech = await seedUser(c, a.accountId, "technician");
  const techIds: string[] = [];
  const aAll: string[] = [];
  const add = async (acct: Acct, p: P) => {
    const id = await person(c, acct.accountId, p);
    if (acct === a) aAll.push(id);
    if (acct === a && p.assignedTo === tech.userId) techIds.push(id);
    return id;
  };
  for (const acct of [a, b]) {
    const t = acct === a ? tech.userId : null;
    await add(acct, { first: "María", last: "García López", email: "maria.garcia@example.com", phone: "+19565550199", assignedTo: t });
    await add(acct, { first: "MARIA", last: "GARCIA", phone: "+528991234567" });
    await add(acct, { first: "Ana", last: "Ruiz Díaz", email: "ana_ruiz@example.com", assignedTo: t });
    await add(acct, { first: "Mariana", last: "Santana", phone: "+19565551234" });
    await add(acct, { first: "José", last: "Pérez", email: "jose@example.com" });
    await add(acct, { first: "john", last: "doe", email: "john_doe@example.com", phone: "+528991230018" });
    await add(acct, { first: "Mary", last: "O'Brien", email: "mary@example.com" });
    await add(acct, { first: "Íñigo", last: "ÑUÑEZ", assignedTo: t });
    await add(acct, { first: "李", last: "小龙" });
    await add(acct, { first: "Иван", last: "ИВАНОВ", assignedTo: t });
    await add(acct, { first: "Иван", last: "Иванов" });
    await add(acct, { first: "иван", last: "иванов" });
    // A number stored as typed, before phones were normalised: its phone_key holds 9565550177, its phone does not,
    // so only the phone_key arm finds it by digits (an arm moved to phone would not).
    await add(acct, { first: "Pat", last: "Kim", phone: "(956) 555-0177" });
  }
  const kept = aAll[0]!;
  await add(a, { first: "Mario", last: "Garcia", archived: true, assignedTo: tech.userId });
  await add(a, { first: "Maria", last: "Lopez", mergedInto: kept });
  await add(a, { first: "Caller", phone: "+19565550100", holding: true });
  const juan = await add(a, { first: "Juan", last: "Pérez" });
  // public.create_group_with_member is EXECUTE service_role only (0069 section 9); it writes company_name.
  await asService(c);
  await c.query("select public.create_group_with_member($1, $2, 'business', 'Taller Núñez', null)", [a.accountId, juan]);
  await actAsOwner(c);
  return { a, b, owner, tech, techIds, aAll };
}

const OWNER = (k: Corpus) => ({ org_id: k.a.orgId, sub: k.owner.sub });
const TECH = (k: Corpus) => ({ org_id: k.a.orgId, sub: k.tech.sub });
const AGENCY = { org_id: "org_agency", app_role: "agency_admin", sub: `user_agency_${RUN}` };

/**
 * The matcher's arguments for a typed term, by spec 4.4's rule (bis-crm's args builder, T6, is pinned against the
 * same rule by its own unit tests): null exactly when contactSearchFilter is null; the sanitized text; the plan's
 * words; the new phone key and the kept key, the present ones; the national ten or nothing.
 */
type Args = { p_text: string; p_tokens: string[]; p_phone_keys: string[]; p_national: string | null };
function matchArgs(term: string): Args | null {
  if (contactSearchFilter(term) === null) return null;
  const plan = contactSearchPlan(term);
  return {
    p_text: sanitizeSearchTerm(term),
    p_tokens: plan.tokens,
    p_phone_keys: [plan.phone?.key, plan.keptKey].filter((k): k is string => typeof k === "string" && k !== ""),
    p_national: plan.phone?.national ?? null,
  };
}
function argsOf(term: string): Args {
  const a = matchArgs(term);
  if (!a) throw new Error(`"${term}" is not a search the app would send`);
  return a;
}

/**
 * contactSearchFilter's own output, PostgREST filter grammar, written as SQL: the oracle the matcher is held to.
 * Read from the string the app sends today, not restated, so a change to the app's filter changes the oracle.
 * Every value is a bound parameter; a column outside the seven the filter reads throws.
 */
const FILTER_COLUMNS = new Set(["first_name", "last_name", "email", "phone", "search_name", "phone_key", "phone_national"]);
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function oracleWhere(term: string, params: unknown[]): string {
  const f = contactSearchFilter(term);
  if (f === null) throw new Error(`no filter for "${term}"`);
  const clause = (cl: string): string => {
    if (cl.startsWith("and(") && cl.endsWith(")")) return `(${splitTop(cl.slice(4, -1)).map(clause).join(" and ")})`;
    const m = /^([a-z_]+)\.ilike\.(.*)$/s.exec(cl);
    if (!m || !FILTER_COLUMNS.has(m[1]!)) throw new Error(`oracle cannot read clause ${cl}`);
    params.push(m[2]);
    return `c.${m[1]} ilike $${params.length}`;
  };
  return `(${splitTop(f).map(clause).join(" or ")})`;
}

const LIST = "c.account_id = $1 and c.holds_shared_number = false and c.archived_at is null and c.merged_into is null";

async function matcherIds(c: Client, accountId: string | null, a: Args): Promise<string[]> {
  const { rows } = await c.query<{ id: string }>(
    "select app.contact_match_ids($1::uuid, $2::text, $3::text[], $4::text[], $5::text) as id",
    [accountId, a.p_text, a.p_tokens, a.p_phone_keys, a.p_national]);
  return rows.map((r) => r.id).sort();
}
/** The entry point with the list's own filters, as the GET call carries them: rows (ids) and the count. */
async function entryList(c: Client, accountId: string, a: Args): Promise<{ ids: string[]; count: number }> {
  const call = "public.contacts_matching(p_account_id := $1::uuid, p_text := $2::text, p_tokens := $3::text[], p_phone_keys := $4::text[], p_national := $5::text) c";
  const params = [accountId, a.p_text, a.p_tokens, a.p_phone_keys, a.p_national];
  const { rows } = await c.query<{ id: string }>(`select c.id from ${call} where ${LIST}`, params);
  const { rows: [n] } = await c.query<{ n: string }>(`select count(*) as n from ${call} where ${LIST}`, params);
  return { ids: rows.map((r) => r.id).sort(), count: Number(n!.n) };
}
/** Today's read: public.contacts under the caller's RLS with contactSearchFilter's arms, rows and count. */
async function oracleList(c: Client, accountId: string, term: string, list = true): Promise<{ ids: string[]; count: number }> {
  const params: unknown[] = [accountId];
  const where = `${list ? LIST : "c.account_id = $1"} and ${oracleWhere(term, params)}`;
  const { rows } = await c.query<{ id: string }>(`select c.id from public.contacts c where ${where}`, params);
  const { rows: [n] } = await c.query<{ n: string }>(`select count(*) as n from public.contacts c where ${where}`, params);
  return { ids: rows.map((r) => r.id).sort(), count: Number(n!.n) };
}

describe("0110: the catalogue", () => {
  it("btree_gin lives in the extensions schema (mutation: create it in public -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        "select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gin'");
      expect(rows).toEqual([{ nspname: "extensions" }]);
    }));

  // Read through pg_index and pg_opclass, never pg_get_indexdef (contact-search-schema.test.ts's reason: how an
  // opclass prints depends on the session's search_path).
  it("contacts_search_trgm is a GIN that leads with account_id (extensions.uuid_ops), then 0108's seven trigram columns (mutation: rebuild it without account_id -> FAILS)", () =>
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
          where ic.relname = 'contacts_search_trgm' order by k.ord`);
      expect(rows).toEqual([
        { amname: "gin", attname: "account_id", opcname: "uuid_ops", nspname: "extensions" },
        ...["search_name", "first_name", "last_name", "email", "phone", "phone_key", "phone_national"]
          .map((attname) => ({ amname: "gin", attname, opcname: "gin_trgm_ops", nspname: "extensions" })),
      ]);
    }));

  it("the matcher: plpgsql, STABLE, SECURITY DEFINER, search_path pg_catalog, pg_temp, setof uuid, defaults so a GET call may omit what it does not send (mutation: drop the defaults -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select l.lanname, p.provolatile, p.prosecdef, p.proisstrict, p.proretset, p.prorettype::regtype::text as ret,
                p.proconfig, pg_get_function_arguments(p.oid) as args
           from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure($1)`, [FN]);
      expect(rows).toEqual([{
        lanname: "plpgsql", provolatile: "s", prosecdef: true, proisstrict: false, proretset: true, ret: "uuid",
        proconfig: ["search_path=pg_catalog, pg_temp"],
        args: "p_account_id uuid, p_text text, p_tokens text[] DEFAULT '{}'::text[], p_phone_keys text[] DEFAULT '{}'::text[], p_national text DEFAULT NULL::text",
      }]);
    }));

  it("the entry point: sql, STABLE, INVOKER, no SET clause, not strict, setof contacts, the same arguments (a SET clause or the definer flag would stop the inlining; mutation: add set search_path -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select l.lanname, p.provolatile, p.prosecdef, p.proisstrict, p.proretset, p.prorettype::regtype::text as ret,
                p.proconfig, pg_get_function_arguments(p.oid) as args
           from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = to_regprocedure($1)`, [ENTRY]);
      expect(rows).toEqual([{
        lanname: "sql", provolatile: "s", prosecdef: false, proisstrict: false, proretset: true, ret: "contacts",
        proconfig: null,
        args: "p_account_id uuid, p_text text, p_tokens text[] DEFAULT '{}'::text[], p_phone_keys text[] DEFAULT '{}'::text[], p_national text DEFAULT NULL::text",
      }]);
    }));

  it.each([[FN], [ENTRY]])("%s: EXECUTE for authenticated and service_role, none for anon or PUBLIC (mutation: grant execute to anon -> FAILS; drop the revoke from public -> FAILS)", (fn) =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) as public
           from pg_proc p where p.oid = to_regprocedure($1)`, [fn]);
      expect(r).toEqual({ anon: false, auth: true, svc: true, public: false });
    }));
});

describe("0110: the matcher called directly, per caller (spec 4.6 item 6)", () => {
  const GARCIA = () => argsOf("garcia");

  it("an Owner of A gets A's matches, and NOTHING when it names account B (mutation: drop the house check -> B's ids, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      const own = await matcherIds(c, k.a.accountId, GARCIA());
      // María García López (email, folded words), MARIA GARCIA, and the archived Mario Garcia: the matcher returns
      // archived rows; the list's own filter drops them outside.
      expect(own).toEqual((await oracleList(c, k.a.accountId, "garcia", false)).ids);
      expect(own.length).toBe(3);
      expect(await matcherIds(c, k.b.accountId, GARCIA())).toEqual([]);
    }));

  it("an Owner whose call names no account is refused at the first gate, before its input is read: nothing, not 22023 (the outer coalesce; mutation: drop it -> the NULL falls through to the input check, 22023, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      await expect(matcherIds(c, null, { ...GARCIA(), p_text: "%" })).resolves.toEqual([]);
    }));

  it("an Owner of an account whose client access is OFF gets nothing (current_account_id() is NULL)", () =>
    withRollback(async (c) => {
      const off = await seedAccount(c, "off", false);
      const o = await seedUser(c, off.accountId, "owner");
      await person(c, off.accountId, { first: "María", last: "García" });
      await actAs(c, { org_id: off.orgId, sub: o.sub });
      expect(await matcherIds(c, off.accountId, GARCIA())).toEqual([]);
    }));

  it("a Technician gets only the matches assigned to them, archived included (mutation: drop the Technician scope -> every match of A, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, TECH(k));
      const ids = await matcherIds(c, k.a.accountId, GARCIA());
      // Assigned and matching "garcia": María García López and the archived Mario Garcia.
      expect(ids.length).toBe(2);
      expect(ids.every((id) => k.techIds.includes(id))).toBe(true);
      expect(await matcherIds(c, k.b.accountId, GARCIA())).toEqual([]);
    }));

  it("a signed-in person with NO membership gets nothing, even holding assignments a removal left behind (mutation: drop the is_technician check -> their assigned ids, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      const gone = await seedUser(c, k.a.accountId, null);
      await person(c, k.a.accountId, { first: "Gabriel", last: "García", assignedTo: gone.userId });
      await actAs(c, { org_id: k.a.orgId, sub: gone.sub });
      expect(await matcherIds(c, k.a.accountId, GARCIA())).toEqual([]);
    }));

  it("the agency gets the named account's matches, for any account (mutation: key the account on current_account_id() -> nothing, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAsOwner(c);
      const expectA = await oracleList(c, k.a.accountId, "garcia", false);
      const expectB = await oracleList(c, k.b.accountId, "garcia", false);
      await actAs(c, AGENCY);
      expect(await matcherIds(c, k.a.accountId, GARCIA())).toEqual(expectA.ids);
      expect(await matcherIds(c, k.b.accountId, GARCIA())).toEqual(expectB.ids);
      expect(expectA.ids.length).toBe(3);
      expect(expectB.ids.length).toBe(2);
    }));

  it("service_role gets the named account's matches, for any account (mutation: drop the service_role branch -> nothing, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      const expectA = await oracleList(c, k.a.accountId, "garcia", false);
      const expectB = await oracleList(c, k.b.accountId, "garcia", false);
      await asService(c);
      expect(await matcherIds(c, k.a.accountId, GARCIA())).toEqual(expectA.ids);
      expect(await matcherIds(c, k.b.accountId, GARCIA())).toEqual(expectB.ids);
      expect([expectA.ids.length, expectB.ids.length]).toEqual([3, 2]);
    }));

  it("a signed-in session whose CLAIMS say service_role is not service_role: nothing (identity is the session's role, never a claim; mutation: trust app.jwt() ->> 'role' -> B's ids, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, { role: "service_role" } as unknown as { org_id: string });
      expect(await matcherIds(c, k.b.accountId, GARCIA())).toEqual([]);
    }));

  it("anon may not call the matcher (42501)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await c.query("set local role anon");
      await expect(matcherIds(c, k.a.accountId, GARCIA())).rejects.toMatchObject({ code: "42501", message: "permission denied for function contact_match_ids" });
    }));

  it("anon may not call the entry point (42501)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await c.query("set local role anon");
      await expect(entryList(c, k.a.accountId, GARCIA())).rejects.toMatchObject({ code: "42501", message: "permission denied for function contacts_matching" });
    }));
});

/**
 * Spec 4.6 item 7. Every term shape of the F-092 spec's phone table (search-accents-design.md 4.2) and its name
 * cases, plus ma, ana, garcia lopez with accents, zzqx, an underscore, non-Latin names, one and two characters.
 * Excluded here, deliberately: a two-character term in a cased non-Latin script typed in the other case from the
 * stored name, which the owner's ruling changes (next describe).
 */
const TERMS = [
  "garcia", "García", "GARCIA", "maria lopez", "lopez maria", "garcía lópez", "María García López", "ana", "Ana Ruiz",
  "ma", "MA", "ga", "a", "zzqx", "0199", "(956) 555-0199", "956.555.0199", "9565550199", "+1 956 555 0199",
  "899 123 4567", "+52 1 899 123 4567", "044 899 123 4567", "+521 899 12", "+1 956 55", "956", "+52 899 123",
  "_", "john_doe", "john_doe@example.com", "o'brien", "Mary O'Brien", "jose@example.com", "maria5@example.com",
  "Иванов", "иван", "ИВАН", "ива", "李", "小龙", "李 小龙", "ñu", "ÑU", "nuñez", "Íñigo", "taller", "taller núñez",
  "pérez", "juan perez", "  maria   lopez  ", "9565550177", "+1 956 555 0177", "555-0177",
];

describe("0110: the entry point answers exactly what contactSearchFilter answers today (spec 4.6 item 7)", () => {
  const ROLES: [string, (k: Corpus) => Record<string, string>][] = [
    ["an Owner", OWNER], ["a Technician", TECH], ["the agency", () => AGENCY],
  ];
  it.each(ROLES)("%s: for every term, the list's rows and count through contacts_matching equal public.contacts filtered by contactSearchFilter's arms, and the matcher's own ids equal the account's every match (mutations: drop any arm, AND the words as OR, or match the phone keys on phone -> FAILS naming the term)", (_label, claims) =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, claims(k));
      let found = 0;
      for (const term of TERMS) {
        const a = argsOf(term);
        const want = await oracleList(c, k.a.accountId, term);
        const got = await entryList(c, k.a.accountId, a);
        expect({ term, ids: got.ids, count: got.count }).toEqual({ term, ids: want.ids, count: want.count });
        // The matcher alone: every match of the account the caller may see, archived, merged-away and holding
        // records included (the list's own filters decide those, outside).
        const every = await oracleList(c, k.a.accountId, term, false);
        expect({ term, matcher: await matcherIds(c, k.a.accountId, a) }).toEqual({ term, matcher: every.ids });
        found += want.count;
      }
      // Not vacuous: the corpus is found, and each role sees what it should of it.
      expect(found).toBeGreaterThan(_label === "a Technician" ? 8 : 30);
    }));

  it("the oracle reads the corpus as expected (pinned counts for an Owner, so an oracle that matched nothing could not pass the case above)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      const n = async (t: string) => (await oracleList(c, k.a.accountId, t)).count;
      expect({
        garcia: await n("garcia"), "maria lopez": await n("maria lopez"), ana: await n("ana"), ma: await n("ma"),
        "(956) 555-0199": await n("(956) 555-0199"), "+52 1 899 123 4567": await n("+52 1 899 123 4567"),
        _: await n("_"), "иван": await n("иван"), taller: await n("taller"), zzqx: await n("zzqx"),
        "9565550177": await n("9565550177"),
      }).toEqual({
        garcia: 2, "maria lopez": 1, ana: 2, ma: 4, "(956) 555-0199": 1, "+52 1 899 123 4567": 1,
        _: 2, "иван": 3, taller: 1, zzqx: 0, "9565550177": 1,
      });
    }));
});

describe("0110: one- and two-character terms compare byte-wise (owner ruling Q2, 2026-10-31; spec 3.8, 4.5)", () => {
  /** Each row: term, the ids (by stored name) the matcher returns, and what today's ICU filter returns. */
  const CYR: [string, string[], string[]][] = [
    ["ив", ["иван иванов"], ["Иван ИВАНОВ", "Иван Иванов", "иван иванов"]],
    ["Ив", ["Иван ИВАНОВ", "Иван Иванов"], ["Иван ИВАНОВ", "Иван Иванов", "иван иванов"]],
    ["ИВ", ["Иван ИВАНОВ"], ["Иван ИВАНОВ", "Иван Иванов", "иван иванов"]],
    ["ива", ["Иван ИВАНОВ", "Иван Иванов", "иван иванов"], ["Иван ИВАНОВ", "Иван Иванов", "иван иванов"]],
  ];
  it("in a cased non-Latin script, a 2-character term finds only the same case, a 3-character term every case; ASCII and Spanish are unchanged (mutations: drop the collate line -> 'ив' finds three, FAILS; '< 3' as '< 2' -> FAILS; as '<= 3' -> 'ива' finds one, FAILS)", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      const { rows } = await c.query<{ id: string; n: string }>(
        "select id, concat_ws(' ', first_name, last_name) as n from public.contacts where account_id = $1", [k.a.accountId]);
      const nameOf = new Map(rows.map((r) => [r.id, r.n]));
      const names = (ids: string[]) => ids.map((id) => nameOf.get(id)!).sort();
      for (const [term, mine, today] of CYR) {
        expect({ term, matcher: names(await matcherIds(c, k.a.accountId, argsOf(term))) }).toEqual({ term, matcher: [...mine].sort() });
        expect({ term, today: names((await oracleList(c, k.a.accountId, term, false)).ids) }).toEqual({ term, today: [...today].sort() });
      }
      // ASCII still folds case at two characters; Spanish letters are found through the folded words.
      const ma = names(await matcherIds(c, k.a.accountId, argsOf("ma")));
      expect(ma).toHaveLength(6); // four listed, the archived Mario and the merged-away Maria
      expect(names(await matcherIds(c, k.a.accountId, argsOf("MA")))).toEqual(ma);
      // "nu" in the folded words: Íñigo ÑUÑEZ and Juan Pérez of Taller Núñez.
      expect(names(await matcherIds(c, k.a.accountId, argsOf("ÑU")))).toEqual(["Juan Pérez", "Íñigo ÑUÑEZ"].sort());
      expect(names(await matcherIds(c, k.a.accountId, argsOf("ñu")))).toEqual(["Juan Pérez", "Íñigo ÑUÑEZ"].sort());
    }));

  it("the length is the typed one: '_' and 'a_' are short (a lone underscore is sent as two characters), 'ab_' is not", () => {
    expect([searchTermLength("_"), sanitizeSearchTerm("_").length]).toEqual([1, 2]);
    expect([searchTermLength("a_"), sanitizeSearchTerm("a_").length]).toEqual([2, 3]);
    expect(searchTermLength("ab_")).toBe(3);
  });

  it("'и_' (two typed characters, three sent) compares byte-wise like any two-character term (mutation: measure the sent text -> ICU, also finds 'И_ВАН', FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "us");
      const o = await seedUser(c, a.accountId, "owner");
      const lower = await person(c, a.accountId, { first: "и_ван" });
      await person(c, a.accountId, { first: "И_ВАН" });
      await actAs(c, { org_id: a.orgId, sub: o.sub });
      expect(await matcherIds(c, a.accountId, argsOf("и_"))).toEqual([lower]);
    }));
});

describe("0110: inputs the app cannot send are refused, never repaired (22023; spec 4.3 step 3, 4.6 item 8)", () => {
  const OK: Args = { p_text: "garcia", p_tokens: ["garcia"], p_phone_keys: [], p_national: null };
  const CASES: [string, Partial<Args> & { raw?: [unknown, unknown, unknown, unknown] }][] = [
    ["a % in the text", { p_text: "gar%cia" }],
    ["a bare _ in the text (sanitizeSearchTerm always sends it as backslash-underscore)", { p_text: "gar_cia" }],
    ["a backslash not before _", { p_text: "gar" + String.fromCharCode(92) + "cia" }],
    ["a trailing backslash", { p_text: "garcia" + String.fromCharCode(92) }],
    ["an empty text", { p_text: "" }],
    ["a text longer than 160", { p_text: "a".repeat(161) }],
    ["a token a;b", { p_tokens: ["a;b"] }],
    ["an upper-case token", { p_tokens: ["Garcia"] }],
    ["an empty token", { p_tokens: [""] }],
    ["seven tokens", { p_tokens: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["a token longer than 80", { p_tokens: ["a".repeat(81)] }],
    ["three phone keys", { p_phone_keys: ["1234", "5678", "9012"] }],
    ["a phone key with a letter", { p_phone_keys: ["12a4"] }],
    ["a phone key longer than 20", { p_phone_keys: ["1".repeat(21)] }],
    ["a national abc", { p_national: "abc" }],
    ["a national of nine digits", { p_national: "899123456" }],
  ];
  it.each(CASES)("refuses %s (mutation: drop that rule -> resolves, FAILS)", (_label, patch) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "in");
      const o = await seedUser(c, a.accountId, "owner");
      await actAs(c, { org_id: a.orgId, sub: o.sub });
      await expect(matcherIds(c, a.accountId, { ...OK, ...patch })).rejects.toMatchObject({ code: "22023" });
    }));

  it.each([
    ["a NULL text", "select app.contact_match_ids($1::uuid, null::text)"],
    ["a NULL token array", "select app.contact_match_ids($1::uuid, 'garcia', null::text[])"],
    ["a NULL phone key array", "select app.contact_match_ids($1::uuid, 'garcia', '{}', null::text[])"],
    ["a NULL inside the token array", "select app.contact_match_ids($1::uuid, 'garcia', array['garcia', null])"],
    ["a NULL inside the phone key array", "select app.contact_match_ids($1::uuid, 'garcia', '{}', array[null::text])"],
  ])("refuses %s", (_label, sql) =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "nul");
      const o = await seedUser(c, a.accountId, "owner");
      await actAs(c, { org_id: a.orgId, sub: o.sub });
      await expect(c.query(sql, [a.accountId])).rejects.toMatchObject({ code: "22023" });
    }));

  it("accepts the widest the app can send: 160 characters, six words, two keys, a national ten, and every default omitted", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "wide");
      const o = await seedUser(c, a.accountId, "owner");
      const id = await person(c, a.accountId, { first: "Ana" });
      await actAs(c, { org_id: a.orgId, sub: o.sub });
      const esc = String.fromCharCode(92) + "_";
      await expect(matcherIds(c, a.accountId, {
        p_text: esc.repeat(80), p_tokens: ["a", "b", "c", "d", "e", "f"], p_phone_keys: ["1".repeat(20), "5299"], p_national: "8991234567",
      })).resolves.toEqual([]);
      const { rows } = await c.query("select app.contact_match_ids($1::uuid, 'ana') as id", [a.accountId]);
      expect(rows).toEqual([{ id }]);
    }));
});

describe("0110: the GET-shaped call is inlined (spec 4.3, 4.6 item 9)", () => {
  /** The statement shape spec 3.1 recorded for a GET rpc (`fn("p" := $n, ...)`), with and without PostgREST's casts,
   *  and with the absent arguments omitted (defaults). ASSUMPTION, checked live by bis-crm (T6): PostgREST's GET. */
  const LIST_SQL = (call: string) =>
    `with pgrst_source as (select pgrst_call."id", pgrst_call."first_name" from ${call} pgrst_call
       where "account_id" = $1 and "holds_shared_number" = false and "archived_at" is null and "merged_into" is null
       order by "created_at" desc nulls last, "id" desc limit 51 offset 0)
     select pg_catalog.count(_postgrest_t) as page_total, coalesce(json_agg(_postgrest_t), '[]') as body
       from (select * from pgrst_source) _postgrest_t`;
  const SHAPES: [string, string, unknown[]][] = [
    ["every argument, plain parameters", `"public"."contacts_matching"("p_account_id" := $1, "p_text" := $2, "p_tokens" := $3, "p_phone_keys" := $4, "p_national" := $5)`, ["garcia", "{garcia}", "{}", null]],
    ["every argument, cast", `"public"."contacts_matching"("p_account_id" := $1::uuid, "p_text" := $2::text, "p_tokens" := $3::text[], "p_phone_keys" := $4::text[], "p_national" := $5::text)`, ["garcia", "{garcia}", "{}", null]],
    ["absent arguments omitted", `"public"."contacts_matching"("p_account_id" := $1, "p_text" := $2, "p_tokens" := $3)`, ["garcia", "{garcia}"]],
  ];
  it.each(SHAPES)("%s: no Function Scan on contacts_matching; the matcher's call and the caller's RLS sit in the caller's own plan (mutation: give contacts_matching a SET clause -> FAILS)", (_label, call, rest) =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      const { rows } = await c.query(`explain (format text) ${LIST_SQL(call)}`, [k.a.accountId, ...rest]);
      const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(plan).not.toMatch(/Function Scan on contacts_matching/);
      // Inlined: the matcher is a set-returning call joined to `contacts c`, and the scan of `contacts c` carries
      // contacts' policies (their InitPlans) beside the list's own filters.
      expect(plan).toContain("app.contact_match_ids(");
      expect(plan).toMatch(/on contacts c\b[\s\S]*Filter: [^\n]*holds_shared_number[^\n]*InitPlan/);
      const { rows: [r] } = await c.query(LIST_SQL(call), [k.a.accountId, ...rest]);
      expect(Number(r.page_total)).toBe(2);
    }));

  it("the armed control: the POST shape (each argument a sub-select) is NOT inlined, so the assertion above can see a Function Scan", () =>
    withRollback(async (c) => {
      const k = await seedCorpus(c);
      await actAs(c, OWNER(k));
      const call = `"public"."contacts_matching"("p_account_id" := (select $1::uuid), "p_text" := (select $2::text), "p_tokens" := (select $3::text[]))`;
      const { rows } = await c.query(`explain (format text) ${LIST_SQL(call)}`, [k.a.accountId, "garcia", "{garcia}"]);
      expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/Function Scan on contacts_matching/);
    }));
});
