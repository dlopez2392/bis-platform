import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import { serviceDb } from "../service";

describe("call_proposals grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.call_proposals')::text as oid`,
      );
      // Schema-qualified or not depending on the connection's search_path,
      // which this suite does not control (precedent:
      // alert-phone-verification-grants.test.ts:174-176).
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe("call_proposals");
    }));

  it("anon holds NO privileges at all (mutation: drop the `revoke all ... from anon` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_name = 'call_proposals' and grantee = 'anon'`,
      );
      expect(rows).toEqual([]);
    }));

  it("authenticated may select but NOT insert or delete (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
           where table_name = 'call_proposals' and grantee = 'authenticated'`,
      );
      const privs = rows.map((r) => r.privilege_type);
      expect(privs).toContain("SELECT");
      expect(privs).not.toContain("INSERT");
      expect(privs).not.toContain("DELETE");
    }));

  it("authenticated's UPDATE is column-scoped to the decision columns (mutation: grant update on the whole table -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
           where table_name = 'call_proposals'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'`,
      );
      const cols = rows.map((r) => r.column_name).sort();
      expect(cols).toEqual(["decided_at", "decided_by", "status"]);
    }));

  // ONE REFUSED STATEMENT PER withRollback. After a rejection the
  // transaction is aborted (25P02) and every later statement fails with the
  // abort, not the property under test — so this gets its own block.
  it("a client cannot INSERT a proposal (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
             values (gen_random_uuid(), gen_random_uuid(), 'task', '{}'::jsonb, 'x')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  // Shape: alert-phone-verification-grants.test.ts:311-328. `account_id`
  // is `on delete cascade` (0040), so call_proposals stays OFF
  // ACCOUNT_OWNED_TABLES (account-teardown.ts's exclusion doc-block).
  it("is carried off by the account's own deletion, so it needs no line in the teardown list", async () => {
    let accountId = "";
    await withTestAccount(async (db, id) => {
      accountId = id;
      const { data: phoneNumber, error: phoneErr } = await db
        .from("phone_numbers")
        .insert({ account_id: id, e164: testPhoneNumber() })
        .select("id")
        .single();
      expect(phoneErr, `phone insert failed: ${phoneErr?.message}`).toBeNull();

      const { data: call, error: callErr } = await db
        .from("calls")
        .insert({ account_id: id, phone_number_id: phoneNumber!.id })
        .select("id")
        .single();
      expect(callErr, `call insert failed: ${callErr?.message}`).toBeNull();

      const { error: proposalErr } = await db.from("call_proposals").insert({
        account_id: id,
        call_id: call!.id,
        kind: "task",
        payload: {},
        evidence: "the caller asked to be called back tomorrow",
      });
      expect(proposalErr, `proposal insert failed: ${proposalErr?.message}`).toBeNull();
    });
    // withTestAccount's finally has now run deleteAccountCascade, which does
    // NOT name call_proposals. `calls` IS on that list and is deleted long
    // before `accounts` itself, so it is call_proposals.call_id's `on delete
    // cascade` (not account_id's) that actually removes this row during a
    // real teardown — verified live: with ONLY call_id's FK flipped to
    // `restrict`, deleting the `calls` row throws "update or delete on table
    // \"calls\" violates foreign key constraint
    // \"call_proposals_call_id_fkey\""; with only account_id's FK flipped,
    // teardown completes without error, because by the time `accounts` is
    // deleted the row is already gone via the call_id cascade. Either way,
    // this assertion is what actually proves the row is gone.
    const { data, error } = await serviceDb()
      .from("call_proposals")
      .select("id")
      .eq("account_id", accountId);
    expect(error, `leftover check failed: ${error?.message}`).toBeNull();
    expect(data).toEqual([]);
  });
});
