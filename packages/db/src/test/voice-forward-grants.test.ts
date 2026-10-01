import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";
import { withTestAccount } from "./fixtures";
import { getVoiceProfile, setForwardCalls, upsertVoiceProfile } from "../voice";

/**
 * 0058_voice_forward_calls.sql: `voice_profiles.forward_calls`, the
 * per-account "send calls straight to a person" switch (spec
 * 2026-10-01-operational-floor, section 3). Hermetic twin:
 * ../voice-forward.test.ts.
 *
 * RED BEFORE APPLY, legitimately: every test in this file but ONE. The
 * column does not exist, so the information_schema reads return no row,
 * has_column_privilege raises "column does not exist", the owner-side
 * select names a missing column (42703), and getVoiceProfile /
 * setForwardCalls go through PostgREST, which refuses a select or update
 * naming a column it does not know. The two refusal tests cannot pass
 * vacuously: each first proves the caller can SEE the row's forward_calls,
 * itself a 42703 before apply.
 *
 * GREEN BEFORE APPLY, by design: "no column-level write privilege on
 * voice_profiles ...". It pins 0020's posture for the whole table, which
 * 0058 must leave unchanged; it is evidence only in the direction it can
 * fail (a write grant added on any voice_profiles column). Measured on a
 * local replica through 0057: 6 failed, 1 passed (this one).
 *
 * The grants half is the control. authenticated has SELECT on voice_profiles
 * and no write verb at all (0019/0020), and 0058 adds no grant: a client
 * token that could flip this column would move every call off the
 * receptionist onto a handset, through PostgREST, with no agency check and no
 * voice.forward_changed event. That includes the agency's own token, which is
 * why both refusals are pinned.
 */
const RUN = Math.random().toString(36).slice(2, 10);

/** One agency, one client-enabled account and its voice profile, written as
 *  the table owner inside the caller's rolled-back transaction. */
async function seedProfile(c: Client, label: string): Promise<{ accountId: string; orgId: string }> {
  await actAsOwner(c);
  const orgId = `org_fwd_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>(
    "insert into public.agencies (name) values ('Fwd') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Forward', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.voice_profiles (account_id) values ($1)", [account!.id]);
  return { accountId: account!.id, orgId };
}

describe("0058 voice_profiles.forward_calls: the column", () => {
  it("exists as boolean, NOT NULL, default false (mutation: nullable, or default true → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'voice_profiles' and column_name = 'forward_calls'`);
      expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "false" }]);
    }));

  it("carries a comment naming its one writer and its target number", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query<{ d: string | null }>(
        `select col_description('public.voice_profiles'::regclass, a.attnum) as d
           from pg_attribute a
          where a.attrelid = 'public.voice_profiles'::regclass and a.attname = 'forward_calls'`);
      expect(r, "forward_calls is missing").toBeDefined();
      expect(r!.d).toContain("setForwardCalls");
      expect(r!.d).toContain("accounts.transfer_phone");
    }));

  it("a profile created without it reads false, and NULL is refused: 'off' has one spelling (mutation: drop NOT NULL → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seedProfile(c, "default");
      const { rows } = await c.query<{ forward_calls: boolean }>(
        "select forward_calls from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ forward_calls: false }]);
      // ONE refused statement per withRollback: the transaction is aborted after it.
      await expect(c.query("update public.voice_profiles set forward_calls = null where account_id = $1", [accountId]))
        .rejects.toMatchObject({ code: "23502" });
    }));
});

describe("0058 grants: forward_calls is readable by the account and writable only by service_role", () => {
  it("authenticated may SELECT it and may not INSERT or UPDATE it; anon has nothing; service_role may UPDATE (mutation: grant update (forward_calls) to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [r] } = await c.query(
        `select
           has_column_privilege('authenticated', 'public.voice_profiles', 'forward_calls', 'SELECT') as auth_select,
           has_column_privilege('authenticated', 'public.voice_profiles', 'forward_calls', 'UPDATE') as auth_update,
           has_column_privilege('authenticated', 'public.voice_profiles', 'forward_calls', 'INSERT') as auth_insert,
           has_column_privilege('anon', 'public.voice_profiles', 'forward_calls', 'SELECT') as anon_select,
           has_column_privilege('anon', 'public.voice_profiles', 'forward_calls', 'UPDATE') as anon_update,
           has_column_privilege('service_role', 'public.voice_profiles', 'forward_calls', 'SELECT') as service_select,
           has_column_privilege('service_role', 'public.voice_profiles', 'forward_calls', 'UPDATE') as service_update`);
      expect(r).toEqual({
        auth_select: true, auth_update: false, auth_insert: false,
        anon_select: false, anon_update: false,
        service_select: true, service_update: true,
      });
    }));

  it("no column-level write privilege on voice_profiles for authenticated or anon, on any column (0020's posture, unchanged)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select grantee, column_name, privilege_type from information_schema.column_privileges
          where table_schema = 'public' and table_name = 'voice_profiles'
            and grantee in ('authenticated', 'anon', 'PUBLIC')
            and privilege_type in ('INSERT', 'UPDATE')`);
      expect(rows).toEqual([]);
    }));

  it("a CLIENT member of the account can read their forward_calls and is refused writing it (mutation: grant the column → the update succeeds, FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seedProfile(c, "client");
      await actAs(c, { org_id: orgId, sub: "user_fwd_client" });
      // Proves RLS lets this caller see the row, so the refusal below is the
      // missing grant and not a policy that hides everything.
      const { rows } = await c.query("select forward_calls from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ forward_calls: false }]);
      await expect(c.query("update public.voice_profiles set forward_calls = true where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));

  it("the AGENCY's own token is refused too: the agency writes through serviceDb, where setForwardCalls records the event (mutation: grant the column → FAILS)", () =>
    withRollback(async (c) => {
      const { accountId } = await seedProfile(c, "agency");
      await actAs(c, { app_role: "agency_admin", sub: "user_fwd_agency" });
      const { rows } = await c.query("select forward_calls from public.voice_profiles where account_id = $1", [accountId]);
      expect(rows).toEqual([{ forward_calls: false }]);
      await expect(c.query("update public.voice_profiles set forward_calls = true where account_id = $1", [accountId]))
        .rejects.toThrow(/permission denied/);
    }));
});

describe("setForwardCalls, live (service client, real rows)", () => {
  it("round-trips on and off, survives an unrelated settings save, and records one voice.forward_changed per change with the actor", async () => {
    await withTestAccount(async (db, accountId) => {
      const created = await upsertVoiceProfile(db, accountId, {}, "user_test");
      expect(created.forward_calls).toBe(false);

      await setForwardCalls(db, accountId, true, "user_test");
      expect((await getVoiceProfile(db, accountId))!.forward_calls).toBe(true);

      // A general settings save must not reset where the calls go.
      const saved = await upsertVoiceProfile(db, accountId, { greeting_en: "Hi there" }, "user_test");
      expect(saved.forward_calls).toBe(true);

      await setForwardCalls(db, accountId, false, "system", "system");
      expect((await getVoiceProfile(db, accountId))!.forward_calls).toBe(false);

      const { data, error } = await db.from("events").select("type, actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "voice.forward_changed").order("id", { ascending: true });
      expect(error, `events read failed: ${error?.message}`).toBeNull();
      expect(data).toEqual([
        { type: "voice.forward_changed", actor_type: "user", actor_id: "user_test", payload: { forwardCalls: true } },
        { type: "voice.forward_changed", actor_type: "system", actor_id: "system", payload: { forwardCalls: false } },
      ]);
    });
  });

  it("throws for an account with no voice profile, creates none, and records no event", async () => {
    await withTestAccount(async (db, accountId) => {
      await expect(setForwardCalls(db, accountId, true, "user_test"))
        .rejects.toThrow(`setForwardCalls: no voice profile for account ${accountId}`);
      expect(await getVoiceProfile(db, accountId)).toBeNull();
      const { data, error } = await db.from("events").select("id")
        .eq("account_id", accountId).eq("type", "voice.forward_changed");
      expect(error, `events read failed: ${error?.message}`).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
