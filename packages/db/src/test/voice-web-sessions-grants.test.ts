import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";

/**
 * DEVIATION FROM THE BRIEF, RECORDED HERE (see the task report for the
 * full explanation): the brief's Step 2 draft imports `actAsOwner` and
 * calls `withRollback(async (db, fixture) => …)`, `actAs(db, fixture)` and
 * `actAsOwner(db, fixture)` as if they returned a Supabase-JS-style client
 * (`asClient.from(...).select(...)`) from a two-argument `withRollback`.
 * The real signatures, read from `./db` before writing this file, are:
 *   withRollback(fn: (c: Client) => Promise<void>)                — ONE arg
 *   actAs(c: Client, claims: { org_id?: string; app_role?: string })
 *   actAsOwner(c: Client)                                          — `reset role`
 * There is no `fixture` object and no chained `.from()` client; `actAs`
 * mutates the pg session in place via `set local role authenticated` and
 * returns nothing. This file is written against the real signatures
 * instead, modelled on call-proposals-grants.test.ts (the brief's own
 * named worked example) and screened-calls-grants.test.ts (the file the
 * brief says this table's grant SHAPE matches: service-role only, no
 * `authenticated` grant at all).
 *
 * The brief's second test — "an agency admin cannot either" via
 * `actAsOwner` — is also corrected here, not just re-signed: `actAsOwner`
 * does `reset role`, which makes the pg connection the TABLE OWNER and
 * bypasses grants entirely, so it would read the table happily regardless
 * of what this migration grants — passing for a reason that has nothing to
 * do with the property under test. screened-calls-grants.test.ts:21-27
 * makes exactly this point in its own comment. An agency session is
 * `actAs(c, { app_role: "agency_admin" })` (`app.is_agency()` reads
 * `app_role = 'agency_admin'`, 0001_tenancy.sql), which is what this file
 * uses instead.
 */

/**
 * Per-process suffix for every `clerk_org_id` this file writes.
 * `accounts.clerk_org_id` is `unique` (0001_tenancy.sql:24) on the ONE
 * Supabase project this suite shares with production. Everything here runs
 * inside `withRollback` so nothing PERSISTS, but two concurrent runs would
 * still block each other on the unique index for the lifetime of both open
 * transactions. Shape copied from call-proposals-grants.test.ts's `orgId`.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_WS_${label}_${RUN}`;

/**
 * A throwaway account, inserted with the raw (owner) connection
 * `withRollback` hands every test — call-proposals-grants.test.ts's
 * `seedAccountWithCall`, minus the phone/call rows this table has no FK
 * to.
 */
async function seedAccount(c: Client, org: string): Promise<string> {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [account] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Fixture WS',true) returning id",
    [agency.id, org],
  );
  return account.id as string;
}

describe("voice_web_sessions grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied. Precedent:
  // call-proposals-grants.test.ts:74-83.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.voice_web_sessions')::text as oid`,
      );
      // Schema-qualified or not depending on the connection's search_path.
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("voice_web_sessions");
    }));

  it("a client cannot SELECT — permission denied, before any RLS is consulted (mutation: grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: orgId("SELECT") });
      await expect(
        c.query("select * from public.voice_web_sessions"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot INSERT, even for its own real account (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const org = orgId("INSERT");
      const accountId = await seedAccount(c, org);
      await actAs(c, { org_id: org });
      await expect(
        c.query(
          `insert into public.voice_web_sessions (account_id, ticket_nonce, ip_hash)
             values ($1, $2, $3)`,
          [accountId, `n_${Date.now()}`, "x".repeat(32)],
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot UPDATE (mutation: grant update to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const org = orgId("UPDATE");
      const accountId = await seedAccount(c, org);
      await actAs(c, { org_id: org });
      await expect(
        c.query(
          `update public.voice_web_sessions set ip_hash = $1 where account_id = $2`,
          ["y".repeat(32), accountId],
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot DELETE (mutation: grant delete to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const org = orgId("DELETE");
      const accountId = await seedAccount(c, org);
      await actAs(c, { org_id: org });
      await expect(
        c.query(`delete from public.voice_web_sessions where account_id = $1`, [accountId]),
      ).rejects.toThrow(/permission denied/i);
    }));

  // The brief's second claim, corrected to the real `actAs` shape (see the
  // file-level comment above) rather than `actAsOwner`, which bypasses
  // grants and would prove nothing.
  it("an agency admin cannot read it either — this table is service-role only, not RLS-scoped to agency (mutation: add an is_agency policy plus a select grant to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin" });
      await expect(
        c.query("select * from public.voice_web_sessions"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("has RLS on and NO policy — deny-all is the policy (mutation: add a policy here -> FAILS, because a policy implies a grant exists to serve)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ relrowsecurity: boolean; policies: string }>(
        `select c.relrowsecurity,
                (select count(*) from pg_policy p where p.polrelid = c.oid)::text as policies
           from pg_class c where c.oid = 'public.voice_web_sessions'::regclass`,
      );
      expect(rows[0]!.relrowsecurity).toBe(true);
      expect(rows[0]!.policies).toBe("0");
    }));

  it("service_role holds exactly select/insert/update/delete and no client role is granted anything (mutation: revoke insert from service_role, or grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'voice_web_sessions'
           order by grantee, privilege_type`,
      );
      // The table owner (`postgres`) always carries every privilege and the
      // migration never touches that. The claim worth pinning is about the
      // other two roles: no anon/authenticated grant survived
      // `revoke all ... from anon, authenticated`, and service_role has at
      // least what the migration's own `grant select, insert, update,
      // delete` names.
      const grantees = [...new Set(rows.map((r) => r.grantee))].sort();
      expect(grantees).toEqual(["postgres", "service_role"]);

      const serviceRolePrivileges = rows
        .filter((r) => r.grantee === "service_role")
        .map((r) => r.privilege_type);
      expect(serviceRolePrivileges).toEqual(
        expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
      );
    }));

  // The brief's third claim: proved through `withTestAccount`, whose db
  // handle is the real `serviceDb()` — not the owner connection
  // `withRollback` hands every other test here, which would pass this for
  // the wrong reason (table ownership, not the `service_role` grant).
  // Shape: alert-phone-verification-grants.test.ts's behavioural tests.
  it("service_role can write and read back", async () => {
    await withTestAccount(async (db, accountId) => {
      const nonce = `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const { error: insErr } = await db.from("voice_web_sessions").insert({
        account_id: accountId, ticket_nonce: nonce, ip_hash: "a".repeat(32), origin: "https://x.test",
      });
      expect(insErr, `insert failed: ${insErr?.message}`).toBeNull();
      const { data, error } = await db.from("voice_web_sessions")
        .select("ticket_nonce").eq("ticket_nonce", nonce);
      expect(error, `select failed: ${error?.message}`).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  // The brief's fourth claim, provable purely at the constraint level (no
  // grant or RLS involved — a unique index applies to the table owner too)
  // so this runs as the owner connection, like call-proposals-grants.
  // test.ts's kind/status CHECK tests.
  it("the same ticket nonce cannot be inserted twice — this is the replay guard (mutation: drop voice_web_sessions_nonce_key -> FAILS)", () =>
    withRollback(async (c) => {
      const accountId = await seedAccount(c, orgId("REPLAY"));
      const nonce = `n_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const insertOne = () =>
        c.query(
          `insert into public.voice_web_sessions (account_id, ticket_nonce, ip_hash) values ($1, $2, $3)`,
          [accountId, nonce, "b".repeat(32)],
        );
      await insertOne();
      await expect(insertOne()).rejects.toMatchObject({ code: "23505" });
    }));
});
