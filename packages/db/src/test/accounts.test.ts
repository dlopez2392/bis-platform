import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { createAccount, listAccounts, renameAccount } from "../accounts";

const suffix = () => Math.random().toString(36).slice(2, 10);

describe("accounts service", () => {
  it("createAccount inserts row + emits account.created event", async () => {
    const db = serviceDb();
    const orgId = `org_test_${suffix()}`;
    const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Test Co", actorId: "user_test" });
    try {
      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", id).eq("type", "account.created").single();
      expect(ev).toMatchObject({ type: "account.created", actor_type: "user", actor_id: "user_test" });
      const all = await listAccounts(db);
      expect(all.some(a => a.id === id)).toBe(true);
    } finally {
      await db.from("events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });
});

/**
 * The setup wizard's inline rename (renameAccountAction) is the only caller
 * today, and it reaches this through `serviceDb()` behind an agency-only
 * guard — `authenticated` has held no UPDATE grant on `accounts.name` since
 * migration 0013.
 */
describe("renameAccount", () => {
  it("writes the new name and emits account.renamed with the actor", async () => {
    await withTestAccount(async (db, accountId) => {
      await renameAccount(db, accountId, "Rio Roofing", "user_test");

      const { data: row } = await db.from("accounts")
        .select("name").eq("id", accountId).single();
      expect((row as { name: string } | null)?.name).toBe("Rio Roofing");

      const { data: ev } = await db.from("events").select("type, actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "account.renamed").single();
      expect(ev).toMatchObject({
        type: "account.renamed", actor_type: "user", actor_id: "user_test",
        payload: { name: "Rio Roofing" },
      });
    });
  });

  /**
   * The assertion this helper exists for. PostgREST returns NO error and NO
   * rows for an update matching nothing, which is indistinguishable from
   * success — the raw `.update().eq()` this replaced returned `{ok:true}` and
   * toasted "saved" for a stale tab on a deleted account, or an agency admin
   * on a typed account id (`requireAccountAccess` returns early for
   * `agency_admin` without proving the row exists). Same shape, same reason,
   * as sending-identity.test.ts's own zero-row case.
   *
   * Deliberately NOT wrapped in `withTestAccount`, unlike that precedent: a
   * call that matches nothing writes nothing by definition — which is the
   * claim — so there is no fixture to create and nothing to clean up. This
   * suite runs 20 files in parallel against ONE shared Supabase project and
   * its slowest test sits close to the 20s per-test timeout; a fixture cycle
   * bought purely for symmetry is load spent to prove nothing.
   */
  it("throws rather than reporting success for an account that does not exist", async () => {
    const db = serviceDb();
    const ghost = "00000000-0000-0000-0000-000000000000";
    await expect(
      renameAccount(db, ghost, "Ghost Co", "user_test"),
    ).rejects.toThrow(/no account/);

    // And it emitted NOTHING on the way out — an event for a rename that
    // never happened would be worse than no event at all.
    const { data } = await db.from("events").select("id")
      .eq("account_id", ghost).eq("type", "account.renamed");
    expect(data ?? []).toHaveLength(0);
  });
});
