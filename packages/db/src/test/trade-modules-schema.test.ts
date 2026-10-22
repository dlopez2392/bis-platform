import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0094_trade_modules.sql (S-47b): voice_profiles.trade_module, and the trade_module / trade_module_version
 * pair on calls and on concierge_conversations. RED BEFORE APPLY: every case names a column or constraint
 * that does not exist yet (except the empty column-privileges case, green on pre by design).
 *
 * Every refusal names its constraint AND is shaped so that constraint is the only one that can refuse it:
 * a bad module carries a valid version, a bad version carries a valid module, a broken pair carries a
 * valid module or a valid version. Drop the constraint and that case, plus the defs case, goes red.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function seed(c: Client, label: string): Promise<{ accountId: string; orgId: string; callId: string; chatId: string }> {
  await actAsOwner(c);
  const orgId = `org_trade_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Trade') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Trade rules', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  const { rows: [phone] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [account!.id, testPhoneNumber()]);
  const { rows: [call] } = await c.query<{ id: string }>(
    "insert into public.calls (account_id, phone_number_id) values ($1, $2) returning id", [account!.id, phone!.id]);
  const { rows: [form] } = await c.query<{ id: string }>(
    "insert into public.forms (account_id, public_id, name) values ($1, $2, 'Chat') returning id",
    [account!.id, `pub_trade_${label}_${RUN}`]);
  const { rows: [chat] } = await c.query<{ id: string }>(
    "insert into public.concierge_conversations (account_id, form_id, ip_hash) values ($1, $2, 'iph') returning id",
    [account!.id, form!.id]);
  return { accountId: account!.id, orgId, callId: call!.id, chatId: chat!.id };
}

describe("0094 voice_profiles.trade_module", () => {
  it("is text, nullable, with no default (mutation: default 'events' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'trade_module'`);
      expect(rows).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    }));

  it("a profile created without it reads null, and it takes insurance_pc, events and null again", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "vp_each");
      const read = async () => (await c.query("select trade_module from public.voice_profiles where account_id = $1", [accountId])).rows;
      expect(await read()).toEqual([{ trade_module: null }]);
      for (const v of ["insurance_pc", "events", null]) {
        await c.query("update public.voice_profiles set trade_module = $2 where account_id = $1", [accountId, v]);
        expect(await read()).toEqual([{ trade_module: v }]);
      }
    }));

  it.each(["insurance", "insurance_pc ", "Events", "none", ""])(
    "refuses the near-miss %j by voice_profiles_trade_module_check (mutation: drop the CHECK -> FAILS)", (bad) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "vp_check");
        await expect(c.query("update public.voice_profiles set trade_module = $2 where account_id = $1", [accountId, bad]))
          .rejects.toMatchObject({ code: "23514", constraint: "voice_profiles_trade_module_check" });
      }));
});

/** The two stamped tables, as a literal list whose iteration is itself asserted below. */
const STAMPED = [
  { table: "calls", idOf: (s: Awaited<ReturnType<typeof seed>>) => s.callId },
  { table: "concierge_conversations", idOf: (s: Awaited<ReturnType<typeof seed>>) => s.chatId },
] as const;

it("the stamped-table loop covers exactly calls and concierge_conversations (guards the loop from vacuity)", () => {
  expect(STAMPED.map((t) => t.table)).toEqual(["calls", "concierge_conversations"]);
});

for (const t of STAMPED) {
  const T = t.table;
  describe(`0094 ${T}.trade_module and ${T}.trade_module_version`, () => {
    it(`shape: text and integer, both nullable, no default (mutation: version default 1 -> FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select column_name, data_type, is_nullable, column_default from information_schema.columns
            where table_schema = 'public' and table_name = $1 and column_name in ('trade_module', 'trade_module_version')
            order by column_name`, [T]);
        expect(rows).toEqual([
          { column_name: "trade_module", data_type: "text", is_nullable: "YES", column_default: null },
          { column_name: "trade_module_version", data_type: "integer", is_nullable: "YES", column_default: null },
        ]);
      }));

    it("a row written without them reads null/null, and it takes (insurance_pc, 1), (events, 3) and (null, null)", () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_ok`);
        const id = t.idOf(s);
        const read = async () => (await c.query(`select trade_module, trade_module_version from public.${T} where id = $1`, [id])).rows;
        expect(await read()).toEqual([{ trade_module: null, trade_module_version: null }]);
        for (const [m, v] of [["insurance_pc", 1], ["events", 3], [null, null]] as const) {
          await c.query(`update public.${T} set trade_module = $2, trade_module_version = $3 where id = $1`, [id, m, v]);
          expect(await read()).toEqual([{ trade_module: m, trade_module_version: v }]);
        }
      }));

    it(`refuses a module outside the set, with a valid version, by ${T}_trade_module_check (mutation: drop it -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_mod`);
        await expect(c.query(`update public.${T} set trade_module = 'events ', trade_module_version = 1 where id = $1`, [t.idOf(s)]))
          .rejects.toMatchObject({ code: "23514", constraint: `${T}_trade_module_check` });
      }));

    it(`refuses version 0, with a valid module, by ${T}_trade_module_version_check (mutations: drop it -> FAILS; '>= 0' -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_ver`);
        await expect(c.query(`update public.${T} set trade_module = 'events', trade_module_version = 0 where id = $1`, [t.idOf(s)]))
          .rejects.toMatchObject({ code: "23514", constraint: `${T}_trade_module_version_check` });
      }));

    it(`refuses a module without a version by ${T}_trade_module_pair_check (mutation: drop it -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_pair`);
        await expect(c.query(`update public.${T} set trade_module = 'events', trade_module_version = null where id = $1`, [t.idOf(s)]))
          .rejects.toMatchObject({ code: "23514", constraint: `${T}_trade_module_pair_check` });
      }));

    // Its own case, its own transaction: a second statement after a refusal would fail for the wrong reason.
    it(`refuses a version without a module by ${T}_trade_module_pair_check (mutation: drop it -> FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c, `${T}_pair2`);
        await expect(c.query(`update public.${T} set trade_module = null, trade_module_version = 1 where id = $1`, [t.idOf(s)]))
          .rejects.toMatchObject({ code: "23514", constraint: `${T}_trade_module_pair_check` });
      }));
  });
}

describe("0094 the seven constraints, as defined", () => {
  it("pg_get_constraintdef for each (pinned after reading the replica's own output)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('voice_profiles_trade_module_check',
            'calls_trade_module_check', 'calls_trade_module_version_check', 'calls_trade_module_pair_check',
            'concierge_conversations_trade_module_check', 'concierge_conversations_trade_module_version_check',
            'concierge_conversations_trade_module_pair_check')
          order by conname`);
      // Read off the post replica (PG18) and checked against the migration: set membership of exactly the
      // two values; a positive version; module and version null together.
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        calls_trade_module_check: "CHECK ((trade_module = ANY (ARRAY['insurance_pc'::text, 'events'::text])))",
        calls_trade_module_pair_check: "CHECK (((trade_module IS NULL) = (trade_module_version IS NULL)))",
        calls_trade_module_version_check: "CHECK ((trade_module_version > 0))",
        concierge_conversations_trade_module_check: "CHECK ((trade_module = ANY (ARRAY['insurance_pc'::text, 'events'::text])))",
        concierge_conversations_trade_module_pair_check: "CHECK (((trade_module IS NULL) = (trade_module_version IS NULL)))",
        concierge_conversations_trade_module_version_check: "CHECK ((trade_module_version > 0))",
        voice_profiles_trade_module_check: "CHECK ((trade_module = ANY (ARRAY['insurance_pc'::text, 'events'::text])))",
      });
    }));
});

describe("0094 grants: readable where the table already is, written only by the server", () => {
  it("column privileges (mutations: grant update (trade_module) on voice_profiles / calls to authenticated -> FAILS; grant select on concierge_conversations to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select
           has_column_privilege('authenticated', 'public.voice_profiles', 'trade_module', 'SELECT') as vp_auth_select,
           has_column_privilege('authenticated', 'public.voice_profiles', 'trade_module', 'UPDATE') as vp_auth_update,
           has_column_privilege('authenticated', 'public.voice_profiles', 'trade_module', 'INSERT') as vp_auth_insert,
           has_column_privilege('anon', 'public.voice_profiles', 'trade_module', 'SELECT') as vp_anon_select,
           has_column_privilege('service_role', 'public.voice_profiles', 'trade_module', 'UPDATE') as vp_service_update,
           has_column_privilege('authenticated', 'public.calls', 'trade_module', 'SELECT') as c_auth_select,
           has_column_privilege('authenticated', 'public.calls', 'trade_module', 'UPDATE') as c_auth_update,
           has_column_privilege('authenticated', 'public.calls', 'trade_module_version', 'UPDATE') as cv_auth_update,
           has_column_privilege('authenticated', 'public.calls', 'trade_module_version', 'INSERT') as cv_auth_insert,
           has_column_privilege('anon', 'public.calls', 'trade_module', 'SELECT') as c_anon_select,
           has_column_privilege('service_role', 'public.calls', 'trade_module_version', 'UPDATE') as cv_service_update,
           has_column_privilege('authenticated', 'public.concierge_conversations', 'trade_module', 'SELECT') as k_auth_select,
           has_column_privilege('authenticated', 'public.concierge_conversations', 'trade_module_version', 'UPDATE') as kv_auth_update,
           has_column_privilege('anon', 'public.concierge_conversations', 'trade_module', 'SELECT') as k_anon_select,
           has_column_privilege('service_role', 'public.concierge_conversations', 'trade_module', 'UPDATE') as k_service_update`);
      expect(r).toEqual({
        vp_auth_select: true, vp_auth_update: false, vp_auth_insert: false, vp_anon_select: false, vp_service_update: true,
        c_auth_select: true, c_auth_update: false, cv_auth_update: false, cv_auth_insert: false, c_anon_select: false,
        cv_service_update: true,
        k_auth_select: false, kv_auth_update: false, k_anon_select: false, k_service_update: true,
      });
    }));

  it("positive control: a column grant made here DOES show in column_privileges (A6; proves the empty-set case's literals)", () =>
    withRollback(async (c) => {
      await actAsOwner(c);
      await c.query("grant update (trade_module_version) on public.calls to authenticated");
      const { rows } = await c.query(
        `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name in ('voice_profiles', 'calls', 'concierge_conversations')
            and column_name in ('trade_module', 'trade_module_version')
            and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE')`);
      expect(rows).toEqual([{ table_name: "calls", column_name: "trade_module_version", grantee: "authenticated", privilege_type: "UPDATE" }]);
    }));

  it("no column-level INSERT/UPDATE grant on the five columns for authenticated, anon or PUBLIC (A3)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name in ('voice_profiles', 'calls', 'concierge_conversations')
            and column_name in ('trade_module', 'trade_module_version')
            and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE')`);
      expect(rows).toEqual([]);
    }));

  it("a client member reads the module and is refused writing it (mutation: grant update (trade_module) on voice_profiles to authenticated -> the update succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "client");
      await actAs(c, { org_id: orgId, sub: "user_trade_client" });
      const { rows } = await c.query("select trade_module from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ trade_module: null }]);
      await expect(c.query("update public.voice_profiles set trade_module = 'events' where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency's own token is refused too: the agency writes through serviceDb", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency");
      await actAs(c, { app_role: "agency_admin", sub: "user_trade_agency" });
      await expect(c.query("update public.voice_profiles set trade_module = 'events' where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  // calls carries the restrictive calls_technician_scope (0068): act as a REAL Owner member (actAsMember,
  // db.ts:33-42), or the read returns [] and proves nothing.
  it("a client Owner reads a call's stamp and cannot write it (mutation: grant update (trade_module) on public.calls to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId, orgId } = await seed(c, "callstamp");
      await actAsMember(c, accountId, orgId, "owner");
      const { rows } = await c.query("select trade_module, trade_module_version from public.calls where id = $1", [callId]);
      expect(rows).toEqual([{ trade_module: null, trade_module_version: null }]);
      // trade_module ALONE: setting the pair would still be refused 42501 by the ungranted
      // trade_module_version under the named mutation, so the case could not fail. Alone, the grant lets it
      // past the privilege check to the pair CHECK (23514), and the message pins the privilege refusal
      // apart from an RLS one (also 42501).
      await expect(c.query("update public.calls set trade_module = 'events' where id = $1", [callId]))
        .rejects.toMatchObject({ code: "42501", message: "permission denied for table calls" });
    }));

  it("the agency token cannot touch a chat's stamp at all (0042: no authenticated grant; mutation: grant select on concierge_conversations to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { orgId } = await seed(c, "chatstamp");
      await actAs(c, { org_id: orgId, app_role: "agency_admin", sub: "user_trade_chat" });
      await expect(c.query("select trade_module from public.concierge_conversations limit 1"))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("all five columns carry a comment naming their writer (mutation: drop one comment -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string; d: string | null }>(
        `select cl.relname || '.' || a.attname as k, col_description(cl.oid, a.attnum) as d
           from pg_attribute a join pg_class cl on cl.oid = a.attrelid
           join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and a.attname in ('trade_module', 'trade_module_version')
            and cl.relname in ('voice_profiles', 'calls', 'concierge_conversations') order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "calls.trade_module", "calls.trade_module_version",
        "concierge_conversations.trade_module", "concierge_conversations.trade_module_version",
        "voice_profiles.trade_module",
      ]);
      expect(rows[0]!.d).toContain("incoming call route");
      expect(rows[1]!.d).toContain("incoming call route");
      expect(rows[2]!.d).toContain("concierge turn route");
      expect(rows[3]!.d).toContain("concierge turn route");
      expect(rows[4]!.d).toContain("saveVoiceProfileAction");
    }));
});
