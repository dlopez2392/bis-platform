import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEvent, readConsentState } from "../consent";

/** 0054 through PostgREST, on the CI project only (withTestAccount + serviceDb). */
describe("0054 consent.ts against the live table (CI only: withTestAccount + serviceDb)", () => {
  it("appendConsentEvent writes through the service role and readConsentState reads the newest deciding row; the account's teardown removes both (mutation: drop the `resubscribed` branch of consentStateOf's early return → the final check reads 'held' instead of 'allowed', FAILS)", async () => {
    let accountId = "";
    await withTestAccount(async (_tdb, id) => {
      accountId = id;
      const db = serviceDb();
      await appendConsentEvent(db, { accountId: id, channel: "sms", address: "+19565550177", action: "revoked", method: "carrier_block", occurredAt: "2026-09-01T10:00:00Z" });
      await appendConsentEvent(db, { accountId: id, channel: "sms", address: "+19565550177", action: "granted", method: "inbound_text", occurredAt: "2026-09-02T10:00:00Z" });
      expect(await readConsentState(db, id, "sms", "+19565550177")).toMatchObject({ state: "stopped", method: "carrier_block" });
      await appendConsentEvent(db, { accountId: id, channel: "sms", address: "+19565550177", action: "resubscribed", method: "start_keyword", occurredAt: "2026-09-03T10:00:00Z" });
      expect(await readConsentState(db, id, "sms", "+19565550177")).toEqual({ state: "allowed" });
    });
    const { data, error } = await serviceDb().from("consent_events").select("id").eq("account_id", accountId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  /**
   * Review I2b: the previous version of this test wrote only TWO deciding
   * rows (a `revoked` and a `resubscribed`), well under the 20-row window
   * `readConsentState` reads — so BOTH rows come back regardless of which
   * end the query is sorted from, and the reducer, which sorts client-side
   * anyway, decided correctly either way. Reversing the read to ascending
   * would NOT have flipped this test's answer; its old title's claim was
   * false (unit-level proof of exactly this, since this test cannot run
   * outside CI: consent.test.ts's "guards consent-ledger-live.test.ts's
   * premise..." test). This version writes 20 older `revoked` rows plus one
   * newest `resubscribed` — 21 deciding rows, one more than the window — so
   * only a genuinely newest-first read keeps the deciding `resubscribed`
   * row; an ascending read would return the OLDEST 20 instead, all
   * `revoked`, and answer 'stopped'.
   */
  it("the 20-row window truncates from whichever end the read is sorted from: 20 older revoked rows plus one newest resubscribed reads allowed only because the read is newest-first (mutation: order ascending in readConsentState → the newest row rolls off the 20-row window, reads 'stopped', FAILS)", async () => {
    await withTestAccount(async (_tdb, id) => {
      const db = serviceDb();
      for (let i = 0; i < 20; i++) {
        await appendConsentEvent(db, {
          accountId: id, channel: "sms", address: "+19565550188", action: "revoked",
          method: "carrier_block", occurredAt: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        });
      }
      await appendConsentEvent(db, {
        accountId: id, channel: "sms", address: "+19565550188", action: "resubscribed",
        method: "start_keyword", occurredAt: "2026-09-01T10:00:00Z",
      });
      expect(await readConsentState(db, id, "sms", "+19565550188")).toEqual({ state: "allowed" });
    });
  });
});
