import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEventGuarded, readConsentState, readEmailSuppression, recordEmailSuppression } from "../consent";

/**
 * 0062 (D-016) through PostgREST: withTestAccount + serviceDb, so CI (or the
 * local replica behind a local PostgREST). What the unit tests cannot prove:
 * that PostgREST reads readEmailSuppression's `.or()` filter as intended, and
 * that the webhook's write lands through the real function. The rows leave
 * with the account (0054's on delete cascade), so no cleanup-list change.
 *
 * RED BEFORE APPLY: the write raises 23514 on consent_events_method_check.
 */
const ADDR = "dan@example.com";

describe("0062 consent.ts's suppression read and write against the live table (withTestAccount + serviceDb)", () => {
  it("a recorded bounce is read back through the filter even under 21 newer unsubscribes; a retry is a duplicate; the customer's resubscribe lifts it; a complaint suppresses again; the teardown removes every row (mutation: drop the .or() filter → the 20-row window holds only one_click rows and reads null, FAILS)", async () => {
    let accountId = "";
    await withTestAccount(async (_tdb, id) => {
      accountId = id;
      const db = serviceDb();
      expect(await readEmailSuppression(db, id, ADDR)).toBeNull();

      // The provider's spelling of the recipient (tab-padded, mixed case) keys to the ledger's address.
      expect(await recordEmailSuppression(db, { accountId: id, address: "\t Dan@Example.com ", contactId: null, reason: "hard_bounce", providerMessageId: "live-msg-1" }))
        .toBe("appended");
      expect(await recordEmailSuppression(db, { accountId: id, address: ADDR, contactId: null, reason: "hard_bounce", providerMessageId: "live-msg-1" }))
        .toBe("duplicate");

      // 21 newer stops of another kind (written unguarded, so each lands): the consent state's
      // 20-row window no longer holds the bounce, but the suppression read still finds it.
      for (let i = 0; i < 21; i++) {
        const r = await appendConsentEventGuarded(db, { accountId: id, channel: "email", address: ADDR, action: "revoked", method: "one_click" }, "none");
        expect(r.outcome).toBe("appended");
      }
      expect(await readConsentState(db, id, "email", ADDR)).toMatchObject({ state: "stopped", method: "one_click" });
      expect(await readEmailSuppression(db, id, ADDR)).toMatchObject({ method: "email_bounce" });

      const lift = await appendConsentEventGuarded(db, { accountId: id, channel: "email", address: ADDR, action: "resubscribed", method: "unsubscribe_page" }, "if_stopped_or_held");
      expect(lift.outcome).toBe("appended");
      expect(await readEmailSuppression(db, id, ADDR)).toBeNull();
      expect(await readConsentState(db, id, "email", ADDR)).toEqual({ state: "allowed" });

      expect(await recordEmailSuppression(db, { accountId: id, address: ADDR, contactId: null, reason: "complaint", providerMessageId: "live-msg-2" }))
        .toBe("appended");
      expect(await readEmailSuppression(db, id, ADDR)).toMatchObject({ method: "email_complaint" });
      expect(await readConsentState(db, id, "email", ADDR)).toMatchObject({ state: "stopped", method: "email_complaint" });
    });
    const { data, error } = await serviceDb().from("consent_events").select("id").eq("account_id", accountId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
