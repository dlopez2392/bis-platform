import { describe, it, expect } from "vitest";
import "dotenv/config";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  createAccount, listAccounts, renameAccount,
  setA2pRegistration, getA2pRegistration,
} from "../accounts";

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

  it("createAccount seeds brand_name from the name it is given — no account is ever nameless to a customer", async () => {
    // Mutation: drop `brand_name: input.name` from the insert.
    await withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("name, brand_name").eq("id", accountId).single();
      expect(data).toEqual({ name: "Fixture Co", brand_name: "Fixture Co" });
    });
  });
});

/**
 * Account-level writes that only `serviceDb()` can make. Both of them —
 * `renameAccount` and `setA2pRegistration` — touch columns `authenticated`
 * holds no UPDATE grant on since migration 0013, which re-granted the seven
 * branding columns and nothing else. Both are therefore agency-gated at the
 * call site, and both are shaped the same way: `.select("id")`, throw on
 * error, throw on ZERO ROWS.
 */
describe("serviceDb-only account writes", () => {
  /**
   * ONE fixture cycle for both writers, deliberately. `withTestAccount` is a
   * create plus twenty-two deletes, this suite runs ~20 files in parallel
   * against a single shared Supabase project, and its slowest file already
   * sits near the 20s per-test timeout. A second cycle bought for tidiness is
   * contention spent to prove nothing new.
   */
  it("renames the account, and round-trips A2P registration state", async () => {
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

      // P1a: A2P registration round-trip. A fresh account knows nothing, and
      // `not_started` is that truth rather than a guess.
      expect((await getA2pRegistration(db, accountId))!.status).toBe("not_started");

      await setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: "CAMP456", status: "pending",
      }, "user_test");
      const pending = (await getA2pRegistration(db, accountId))!;
      expect(pending.brandId).toBe("BRAND123");
      expect(pending.campaignId).toBe("CAMP456");
      expect(pending.status).toBe("pending");

      const { data: a2pEv } = await db.from("events").select("type, payload")
        .eq("account_id", accountId).eq("type", "account.a2p_updated");
      expect(a2pEv).toHaveLength(1);
      // The identifiers ride the event, not just the status — `accounts` has
      // no updated_at history, so this row is the only answer to "approved on
      // WHICH campaign".
      expect(a2pEv![0]).toMatchObject({
        payload: { status: "pending", brandId: "BRAND123", campaignId: "CAMP456" },
      });

      // `approved` is the one status the platform treats as permission, so it
      // cannot be recorded without the identifiers it claims to have: an
      // approval with no campaign id has nothing to send on, yet would tick a
      // checklist item that reads "Register A2P 10DLC brand and campaign".
      await expect(setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: null, status: "approved",
      }, "user_test")).rejects.toThrow(/brand id and a campaign id/);
      // …and it did not half-write on the way out.
      expect((await getA2pRegistration(db, accountId))!.status).toBe("pending");

      // The same patch is fine while the carriers still have it — you cannot
      // have ids you have not been issued yet.
      await setA2pRegistration(db, accountId, {
        brandId: null, campaignId: null, status: "pending",
      }, "user_test");

      // updatedAt is stamped by the writer, and read back — a status with no
      // date cannot distinguish "filed on Tuesday" from "nobody has touched
      // this since March".
      const stamped = (await getA2pRegistration(db, accountId))!;
      expect(stamped.updatedAt).toBeTruthy();
      expect(Number.isNaN(Date.parse(stamped.updatedAt!))).toBe(false);
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
  it("renameAccount throws rather than reporting success for an account that does not exist", async () => {
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

  /** Same claim, same reason, for the A2P writer. */
  it("setA2pRegistration throws rather than reporting success for an account that does not exist", async () => {
    const db = serviceDb();
    const ghost = "00000000-0000-0000-0000-000000000000";
    // Deliberately NOT `approved` with null ids: that now fails the approval
    // completeness guard BEFORE the query runs, so the test would pass without
    // ever reaching the zero-row check it exists for.
    await expect(setA2pRegistration(
      db, ghost, { brandId: null, campaignId: null, status: "pending" }, "user_test",
    )).rejects.toThrow(/no account/);

    const { data } = await db.from("events").select("id")
      .eq("account_id", ghost).eq("type", "account.a2p_updated");
    expect(data ?? []).toHaveLength(0);
  });
});
