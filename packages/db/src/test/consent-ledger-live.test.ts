import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEvent, readConsentState } from "../consent";

/** 0054 through PostgREST, on the CI project only (withTestAccount + serviceDb). */
describe("0054 consent.ts against the live table (CI only: withTestAccount + serviceDb)", () => {
  it("appendConsentEvent writes through the service role and readConsentState reads the newest deciding row; the account's teardown removes both (mutation: order ascending in readConsentState → reads 'stopped', FAILS)", async () => {
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
});
