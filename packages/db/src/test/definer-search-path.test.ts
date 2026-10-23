import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsOwner } from "./db";

/**
 * 0096_definer_search_path.sql: every function in public and app that sets a search_path ends it with pg_temp.
 *
 * WHY. `set search_path = ''` still searches the session's pg_temp FIRST for relation and type names. A session
 * holding service_role created a pg_temp.text domain whose CHECK called a pg_temp function, and a SECURITY DEFINER
 * function then ran that function as its owner (postgres). Listing pg_temp LAST closes it.
 *
 * Scope is every function that SETS a search_path, not only the definers: an invoker function called from inside a
 * definer runs as the definer's owner too, and its own `search_path = ''` puts pg_temp first again. The third probe
 * below is that path (save_voice_knowledge -> app.voice_business_hours_valid), and it stays red if 0096 hardens the
 * definers alone.
 *
 * RULE FOR EVERY LATER MIGRATION (also in 0096's header): a new function in public or app that sets a search_path
 * writes `set search_path = pg_catalog, pg_temp`, never `set search_path = ''`. A create or replace replaces the
 * whole SET clause, so copying an old definition with '' undoes 0096 for that function, and the cases below fail.
 * A new SECURITY DEFINER function is also added by name to EXPECTED_DEFINERS.
 *
 * RED BEFORE APPLY: every case except the armed controls inside the probes. GREEN AFTER APPLY: all of them.
 */

/** The 22 SECURITY DEFINER functions in public and app at 0096, with their whole proconfig after it. */
const PG_CATALOG_PG_TEMP = ["search_path=pg_catalog, pg_temp"];
const EXPECTED_DEFINERS: Record<string, string[]> = {
  "app.account_role(uuid)": PG_CATALOG_PG_TEMP,
  "app.company_name_derived()": PG_CATALOG_PG_TEMP,
  "app.current_account_id()": ["search_path=public, pg_temp"],
  "app.current_user_id()": PG_CATALOG_PG_TEMP,
  "app.is_account_owner(uuid)": PG_CATALOG_PG_TEMP,
  "app.is_technician(uuid)": PG_CATALOG_PG_TEMP,
  "app.my_client_group_ids()": PG_CATALOG_PG_TEMP,
  "app.my_contact_ids()": PG_CATALOG_PG_TEMP,
  "app.my_place_ids()": PG_CATALOG_PG_TEMP,
  "app.sees_all_customers(uuid)": PG_CATALOG_PG_TEMP,
  "app.sync_company_name()": PG_CATALOG_PG_TEMP,
  "public.ai_gate_check(uuid,text,text)": PG_CATALOG_PG_TEMP,
  "public.ai_ledger_record(uuid,text,text,integer,integer,bigint,text,integer,text,text)": PG_CATALOG_PG_TEMP,
  "public.claim_document_share_download(uuid,uuid,text,integer,integer,integer)": PG_CATALOG_PG_TEMP,
  "public.claim_record_summary(uuid,uuid,text,text,boolean)": PG_CATALOG_PG_TEMP,
  "public.document_requirements(uuid,uuid,date)": PG_CATALOG_PG_TEMP,
  "public.document_space_used(uuid)": PG_CATALOG_PG_TEMP,
  // 0096 changes only the search_path key: the 2s lock_timeout from 0095 stays, in its place.
  "public.ensure_knowledge_snapshot(uuid,jsonb)": ["search_path=pg_catalog, pg_temp", "lock_timeout=2s"],
  "public.mark_document_version_ready(uuid,uuid,uuid,bigint,text)": PG_CATALOG_PG_TEMP,
  "public.record_event(uuid,text,jsonb)": PG_CATALOG_PG_TEMP,
  "public.reserve_document_version(uuid,uuid,bigint,text,text,text)": PG_CATALOG_PG_TEMP,
  "public.save_voice_knowledge(uuid,text,jsonb,jsonb,integer)": PG_CATALOG_PG_TEMP,
};

/** A signature built from the catalog, so it reads the same whatever the session's search_path is. */
const SIG = `n.nspname || '.' || p.proname || '(' || coalesce((select string_agg(pg_catalog.format_type(t.oid, null), ',' order by t.i)
               from unnest(p.proargtypes) with ordinality as t(oid, i)), '') || ')'`;

type Fn = { sig: string; proconfig: string[] | null };
const searchPathOf = (cfg: string[] | null) => cfg?.find((c) => c.startsWith("search_path="))?.slice("search_path=".length);
const endsWithPgTemp = (path: string | undefined) => path !== undefined && path.split(",").map((s) => s.trim()).at(-1) === "pg_temp";

describe("0096: every SECURITY DEFINER function lists pg_temp last", () => {
  it("the definers in public and app are exactly these 22, each with exactly this proconfig (a new definer fails here until it is listed)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<Fn>(
        `select ${SIG} as sig, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.prosecdef and n.nspname in ('public', 'app')`);
      expect(rows).toHaveLength(22);
      expect(Object.fromEntries(rows.map((r) => [r.sig, r.proconfig]))).toEqual(EXPECTED_DEFINERS);
    }));

  it("every definer in public and app has a search_path whose LAST entry is pg_temp (mutation: drop one from 0096's loop -> FAILS naming it)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<Fn>(
        `select ${SIG} as sig, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where p.prosecdef and n.nspname in ('public', 'app')`);
      expect(rows.length).toBeGreaterThanOrEqual(22); // not vacuous
      const offenders = rows.filter((r) => !endsWithPgTemp(searchPathOf(r.proconfig))).map((r) => `${r.sig}: ${String(r.proconfig)}`);
      expect(offenders).toEqual([]);
    }));

  it("every OTHER function in public and app that sets a search_path also ends it with pg_temp (55 invokers at 0096; a floor, not a pin)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<Fn>(
        `select ${SIG} as sig, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where not p.prosecdef and n.nspname in ('public', 'app')
            and exists (select 1 from unnest(p.proconfig) as x(c) where x.c like 'search_path=%')`);
      expect(rows.length).toBeGreaterThanOrEqual(55); // not vacuous
      const offenders = rows.filter((r) => !endsWithPgTemp(searchPathOf(r.proconfig))).map((r) => `${r.sig}: ${String(r.proconfig)}`);
      expect(offenders).toEqual([]);
    }));
});

/**
 * The shadow, reproduced. As service_role (the finding's role): a pg_temp function that raises naming
 * current_user, and a pg_temp.text domain whose CHECK calls it. Each probe first proves the trap is armed: in the
 * caller's own session `'x'::text` resolves to the domain and raises "ran as service_role". Then the definer call
 * must answer normally; before 0096 it raises "ran as postgres" instead. Savepoints keep the transaction usable
 * after the armed control's refusal.
 *
 * Caveat: PL/pgSQL caches a function's compiled types per backend. withRollback opens a fresh connection, so on a
 * direct connection (the replica, CI's local stack) the definer compiles inside the probe. Behind a pooler that reuses
 * a backend which had already compiled it, the pre-apply red could read green; the post-apply green cannot be faked
 * that way.
 */
async function armShadow(c: Client) {
  await c.query("set local role service_role");
  await c.query(`create function pg_temp.bis_shadow(v pg_catalog.text) returns pg_catalog.bool language plpgsql
                   as $f$ begin raise exception 'BIS-SHADOW ran as %', current_user; end $f$`);
  await c.query("create domain pg_temp.text as pg_catalog.text check (pg_temp.bis_shadow(value))");
  await c.query("savepoint armed");
  await expect(c.query("select 'x'::text")).rejects.toThrow("BIS-SHADOW ran as service_role");
  await c.query("rollback to savepoint armed");
}

async function seedProfile(c: Client): Promise<string> {
  await actAsOwner(c);
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Shadow') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'Shadow probe') returning id",
    [agency!.id, `org_shadow_${Math.random().toString(36).slice(2, 10)}`]);
  await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  return account!.id;
}

describe("0096: a pg_temp shadow no longer runs inside a definer", () => {
  it("reserve_document_version (0077, the finding): its `v_path text` no longer resolves to pg_temp.text", () =>
    withRollback(async (c) => {
      await armShadow(c);
      const { rows: [r] } = await c.query<{ r: unknown }>(
        "select public.reserve_document_version(gen_random_uuid(), gen_random_uuid(), 10, 'application/pdf', 'a.pdf', 'user_shadow') as r");
      expect(r!.r).toEqual({ status: "not_found" });
    }));

  it("save_voice_knowledge (0095, the finding), a facts-only save: the definer's own body", () =>
    withRollback(async (c) => {
      const acct = await seedProfile(c);
      await armShadow(c);
      const { rows: [r] } = await c.query<{ r: unknown }>(
        "select public.save_voice_knowledge($1, 'user_shadow', $2::jsonb, $3::jsonb, 0) as r",
        [acct, JSON.stringify({ facts: "x" }), JSON.stringify({ v: 1 })]);
      expect(r!.r).toEqual({ status: "ok", version: 1 });
    }));

  it("save_voice_knowledge with business hours: the INVOKER app.voice_business_hours_valid it calls runs as postgres too (mutation: 0096 on definers only -> FAILS)", () =>
    withRollback(async (c) => {
      const acct = await seedProfile(c);
      await armShadow(c);
      const { rows: [r] } = await c.query<{ r: unknown }>(
        "select public.save_voice_knowledge($1, 'user_shadow', $2::jsonb, $3::jsonb, 0) as r",
        [acct, JSON.stringify({ business_hours: { mon: [["09:00", "17:00"]] } }), JSON.stringify({ v: 1 })]);
      expect(r!.r).toEqual({ status: "ok", version: 1 });
    }));
});
