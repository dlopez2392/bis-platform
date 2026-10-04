import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { recordForwardedCall, countForwardedCallsSince, FORWARD_KINDS } from "../forwarded-calls";

/**
 * 0059_forwarded_calls.sql: one row per call put through to a person instead
 * of to Sofía, so the daily caps can count it (spec
 * 2026-10-01-operational-floor, section 3's KNOWN LIMIT, closed 2026-10-04).
 *
 * RED BEFORE APPLY, legitimately: every test. The table does not exist, so
 * each read raises 42P01 and each PostgREST call fails.
 *
 * The grants half is 0039's shape and the control: no client role holds
 * anything, so a client gets permission denied rather than zero rows.
 */
describe("0059 forwarded_calls: grants and shape", () => {
  it("a client cannot read the table — permission denied, not zero rows (mutation: grant select to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(c.query("select * from public.forwarded_calls")).rejects.toThrow(/permission denied/i);
    }));

  it("an agency session cannot read it through the user client either (mutation: agency policy plus a select grant → FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("select * from public.forwarded_calls")).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot insert (mutation: grant insert to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(c.query(
        "insert into public.forwarded_calls (account_id, called_e164, kind) values (gen_random_uuid(), '+19565550100', 'account-forward')",
      )).rejects.toThrow(/permission denied/i);
    }));

  it("refuses a kind outside the two, and the TS list matches the CHECK (mutation: drop forwarded_calls_kind_check → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'public.forwarded_calls'::regclass and conname = 'forwarded_calls_kind_check'`);
      for (const kind of FORWARD_KINDS) expect(rows[0]!.def).toContain(`'${kind}'`);
      expect(rows[0]!.def.match(/'[a-z-]+'/g)).toHaveLength(FORWARD_KINDS.length);
    }));

  it("cascades the account and only nulls the number (mutation: swap the FKs' delete actions → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; confdeltype: string }>(
        `select conname, confdeltype from pg_constraint
          where conrelid = 'public.forwarded_calls'::regclass and contype = 'f' order by conname`);
      const by = Object.fromEntries(rows.map((r) => [r.conname, r.confdeltype]));
      expect(by["forwarded_calls_account_id_fkey"]).toBe("c");
      expect(by["forwarded_calls_phone_number_id_fkey"]).toBe("n");
    }));

  it("only the owner and service_role hold anything; service_role keeps select/insert/delete", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'forwarded_calls'`);
      expect([...new Set(rows.map((r) => r.grantee))].sort()).toEqual(["postgres", "service_role"]);
      expect(rows.filter((r) => r.grantee === "service_role").map((r) => r.privilege_type))
        .toEqual(expect.arrayContaining(["SELECT", "INSERT", "DELETE"]));
    }));

  it("service_role holds NO update or truncate: 0057's revoke-then-grant-back shape (mutation: drop service_role from the revoke → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ upd: boolean; trunc: boolean }>(
        `select has_table_privilege('service_role', 'public.forwarded_calls', 'UPDATE') as upd,
                has_table_privilege('service_role', 'public.forwarded_calls', 'TRUNCATE') as trunc`);
      expect(rows[0]).toEqual({ upd: false, trunc: false });
    }));
});

describe("0059 forwarded_calls: record and count, through serviceDb()", () => {
  it("counts the account's rows and one caller's, from the given instant, and nobody else's (mutation: drop the caller filter → FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 60_000).toISOString();
      const row = { accountId, phoneNumberId: null, calledE164: "+19565550999" } as const;
      await recordForwardedCall(db, { ...row, callerE164: "+19565550111", kind: "account-forward" });
      await recordForwardedCall(db, { ...row, callerE164: "+19565550111", kind: "model-down" });
      await recordForwardedCall(db, { ...row, callerE164: "+19565550222", kind: "account-forward" });
      await recordForwardedCall(db, { ...row, callerE164: null, kind: "account-forward" });

      expect(await countForwardedCallsSince(db, accountId, "+19565550111", since)).toEqual({ forAccount: 4, forCaller: 2 });
      expect(await countForwardedCallsSince(db, accountId, null, since)).toEqual({ forAccount: 4, forCaller: 0 });
      const later = new Date(Date.now() + 60_000).toISOString();
      expect(await countForwardedCallsSince(db, accountId, "+19565550111", later)).toEqual({ forAccount: 0, forCaller: 0 });
    }));

  it("the account's own teardown carries its rows away (the cascade account-teardown.ts relies on)", async () => {
    let id = "";
    await withTestAccount(async (db, accountId) => {
      id = accountId;
      await recordForwardedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550999", callerE164: null, kind: "model-down",
      });
    });
    const { count, error } = await serviceDb().from("forwarded_calls")
      .select("id", { count: "exact", head: true }).eq("account_id", id);
    expect(error).toBeNull();
    expect(count).toBe(0);
  });

  it("a kind outside the two throws rather than being swallowed", () =>
    withTestAccount(async (db, accountId) => {
      await expect(recordForwardedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550999", callerE164: null,
        kind: "made-up" as never,
      })).rejects.toThrow(/recordForwardedCall failed/);
    }));
});
