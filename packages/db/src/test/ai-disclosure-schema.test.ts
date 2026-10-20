import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";

/**
 * 0093_ai_disclosure.sql: voice_profiles.disclosure (Off / Trial / On), calls.disclosed (the per-call
 * stamp) and calls.disclosure_setting (which setting decided it, D5). RED BEFORE APPLY: every case names a column that does not exist yet. The grants cases are the
 * control: authenticated has SELECT and no write verb on both tables (0019/0020), and 0093 adds none, so a
 * client Owner can read the setting and never write it (decision 28), and only the server stamps a call.
 */
const RUN = Math.random().toString(36).slice(2, 10);

async function seed(c: Client, label: string): Promise<{ accountId: string; orgId: string; callId: string }> {
  await actAsOwner(c);
  const orgId = `org_disc_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Disc') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Disclosure', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  const { rows: [phone] } = await c.query<{ id: string }>(
    "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [account!.id, testPhoneNumber()]);
  const { rows: [call] } = await c.query<{ id: string }>(
    "insert into public.calls (account_id, phone_number_id) values ($1, $2) returning id", [account!.id, phone!.id]);
  return { accountId: account!.id, orgId, callId: call!.id };
}

describe("0093 voice_profiles.disclosure", () => {
  it("is text, NOT NULL, default 'off' (mutation: default 'on' → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'disclosure'`);
      expect(rows).toEqual([{ data_type: "text", is_nullable: "NO", column_default: "'off'::text" }]);
    }));

  it("a profile created without it reads 'off'", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "default");
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
    }));

  it("takes each of off, trial, on", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "each");
      for (const v of ["trial", "on", "off"]) {
        await c.query("update public.voice_profiles set disclosure = $2 where account_id = $1", [accountId, v]);
        const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
        expect(rows).toEqual([{ disclosure: v }]);
      }
    }));

  it("refuses any fourth value by voice_profiles_disclosure_check (mutation: drop the CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "check");
      await expect(c.query("update public.voice_profiles set disclosure = 'maybe' where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "voice_profiles_disclosure_check" });
    }));

  it("refuses NULL: 'off' has one spelling (mutation: drop NOT NULL → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "null");
      await expect(c.query("update public.voice_profiles set disclosure = null where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23502" });
    }));
});

describe("0093 calls.disclosed", () => {
  it("is boolean, nullable, with no default (mutation: default false → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = 'disclosed'`);
      expect(rows).toEqual([{ data_type: "boolean", is_nullable: "YES", column_default: null }]);
    }));

  it("a call inserted without it reads null, and true and false both store", () =>
    withRollback(async (c) => {
      const { callId } = await seed(c, "stamp");
      const read = async () => (await c.query("select disclosed from public.calls where id = $1", [callId])).rows;
      expect(await read()).toEqual([{ disclosed: null }]);
      await c.query("update public.calls set disclosed = true where id = $1", [callId]);
      expect(await read()).toEqual([{ disclosed: true }]);
      await c.query("update public.calls set disclosed = false where id = $1", [callId]);
      expect(await read()).toEqual([{ disclosed: false }]);
    }));
});

describe("0093 calls.disclosure_setting (D5)", () => {
  it("is text, nullable, with no default (mutation: default 'trial' → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'calls' and column_name = 'disclosure_setting'`);
      expect(rows).toEqual([{ data_type: "text", is_nullable: "YES", column_default: null }]);
    }));

  it("reads null when not sent, and takes trial, on and null again", () =>
    withRollback(async (c) => {
      const { callId } = await seed(c, "setting");
      const read = async () => (await c.query("select disclosure_setting from public.calls where id = $1", [callId])).rows;
      expect(await read()).toEqual([{ disclosure_setting: null }]);
      for (const v of ["trial", "on", null]) {
        await c.query("update public.calls set disclosure_setting = $2 where id = $1", [callId, v]);
        expect(await read()).toEqual([{ disclosure_setting: v }]);
      }
    }));

  it("refuses 'off' and any other word by calls_disclosure_setting_check: an Off call is never stamped (mutation: drop the CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const { callId } = await seed(c, "setting_check");
      await expect(c.query("update public.calls set disclosure_setting = 'off' where id = $1", [callId]))
        .rejects.toMatchObject({ code: "23514", constraint: "calls_disclosure_setting_check" });
    }));
});

describe("0093 grants: readable by the account, written only by the server", () => {
  it("column privileges (mutation: grant update (disclosure) on voice_profiles to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'SELECT') as vp_auth_select,
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'UPDATE') as vp_auth_update,
           has_column_privilege('authenticated', 'public.voice_profiles', 'disclosure', 'INSERT') as vp_auth_insert,
           has_column_privilege('anon', 'public.voice_profiles', 'disclosure', 'SELECT') as vp_anon_select,
           has_column_privilege('service_role', 'public.voice_profiles', 'disclosure', 'UPDATE') as vp_service_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'SELECT') as c_auth_select,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'UPDATE') as c_auth_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosed', 'INSERT') as c_auth_insert,
           has_column_privilege('anon', 'public.calls', 'disclosed', 'SELECT') as c_anon_select,
           has_column_privilege('service_role', 'public.calls', 'disclosed', 'UPDATE') as c_service_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosure_setting', 'SELECT') as s_auth_select,
           has_column_privilege('authenticated', 'public.calls', 'disclosure_setting', 'UPDATE') as s_auth_update,
           has_column_privilege('authenticated', 'public.calls', 'disclosure_setting', 'INSERT') as s_auth_insert,
           has_column_privilege('anon', 'public.calls', 'disclosure_setting', 'SELECT') as s_anon_select,
           has_column_privilege('service_role', 'public.calls', 'disclosure_setting', 'UPDATE') as s_service_update`);
      expect(r).toEqual({
        vp_auth_select: true, vp_auth_update: false, vp_auth_insert: false, vp_anon_select: false, vp_service_update: true,
        c_auth_select: true, c_auth_update: false, c_auth_insert: false, c_anon_select: false, c_service_update: true,
        s_auth_select: true, s_auth_update: false, s_auth_insert: false, s_anon_select: false, s_service_update: true,
      });
    }));

  it("no column-level INSERT/UPDATE grant on either table for authenticated, anon or PUBLIC (A3; 0020's posture)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name, grantee, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name in ('voice_profiles', 'calls')
            and grantee in ('authenticated', 'anon', 'PUBLIC') and privilege_type in ('INSERT', 'UPDATE')`);
      expect(rows).toEqual([]);
    }));

  it("a client member reads their setting and is refused writing it (mutation: grant the column → the update succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "client");
      await actAs(c, { org_id: orgId, sub: "user_disc_client" });
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
      await expect(c.query("update public.voice_profiles set disclosure = 'on' where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("the agency's own token is refused too: the agency writes through serviceDb", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency");
      await actAs(c, { app_role: "agency_admin", sub: "user_disc_agency" });
      const { rows } = await c.query("select disclosure from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ disclosure: "off" }]);
      await expect(c.query("update public.voice_profiles set disclosure = 'on' where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));

  // calls carries the restrictive calls_technician_scope (0068), so a client case acts as a REAL Owner
  // member (actAsMember, db.ts:33-42); with no membership the read would return [] and prove nothing.
  it("a client Owner cannot stamp a call's disclosed (mutation: grant update (disclosed) on public.calls to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId, orgId } = await seed(c, "callstamp");
      await actAsMember(c, accountId, orgId, "owner");
      const { rows } = await c.query("select disclosed from public.calls where id = $1", [callId]);
      expect(rows).toEqual([{ disclosed: null }]);
      await expect(c.query("update public.calls set disclosed = true where id = $1", [callId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("a client Owner cannot stamp a call's disclosure_setting (mutation: grant update (disclosure_setting) on public.calls to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, callId, orgId } = await seed(c, "callsetting");
      await actAsMember(c, accountId, orgId, "owner");
      const { rows } = await c.query("select disclosure_setting from public.calls where id = $1", [callId]);
      expect(rows).toEqual([{ disclosure_setting: null }]);
      await expect(c.query("update public.calls set disclosure_setting = 'trial' where id = $1", [callId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("all three columns carry a comment naming who writes them", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string; d: string | null }>(
        `select c.relname || '.' || a.attname as k, col_description(c.oid, a.attnum) as d
           from pg_attribute a join pg_class c on c.oid = a.attrelid
          where (c.relname = 'voice_profiles' and a.attname = 'disclosure')
             or (c.relname = 'calls' and a.attname in ('disclosed', 'disclosure_setting')) order by 1`);
      expect(rows.map((r) => r.k)).toEqual(["calls.disclosed", "calls.disclosure_setting", "voice_profiles.disclosure"]);
      expect(rows[0]!.d).toContain("incoming call route");
      expect(rows[1]!.d).toContain("incoming call route");
      expect(rows[2]!.d).toContain("saveVoiceProfileAction");
    }));
});
