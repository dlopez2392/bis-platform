import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { getSendingIdentity, setFromEmail } from "../sending-identity";

/**
 * Kept out of `Branding` on purpose. `Branding` is a CLIENT-WRITABLE type and
 * this column must never be client-writable (spec §4, §5), so mixing the two
 * write-scopes in one type is the thing being avoided.
 */
describe("sending identity", () => {
  it("reads null for an account that has never set one", async () => {
    await withTestAccount(async (db, accountId) => {
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBeNull();
    });
  });

  it("writes an address, reads it back, and emits the event", async () => {
    await withTestAccount(async (db, accountId) => {
      await setFromEmail(db, accountId, "leads@acme.com", "user_test");
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBe("leads@acme.com");

      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "account.sending_identity_updated").single();
      expect(ev).toMatchObject({
        type: "account.sending_identity_updated", actor_type: "user", actor_id: "user_test",
      });
    });
  });

  it("clears with null", async () => {
    await withTestAccount(async (db, accountId) => {
      await setFromEmail(db, accountId, "leads@acme.com", "user_test");
      await setFromEmail(db, accountId, null, "user_test");
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBeNull();
    });
  });

  /**
   * The assertion that matters most. PostgREST returns NO error and NO rows
   * for an update matching nothing, which is indistinguishable from success —
   * two milestones on this project have already lost work to exactly that.
   */
  it("throws rather than reporting success for an account that does not exist", async () => {
    await withTestAccount(async (db) => {
      await expect(
        setFromEmail(db, "00000000-0000-0000-0000-000000000000", "x@y.com", "user_test"),
      ).rejects.toThrow(/no account/);
    });
  });
});
