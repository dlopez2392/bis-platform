import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { appendConsentEventGuarded, recordCarrierBlock, readConsentState } from "../consent";

/** 0055 through PostgREST, on the CI project only: the RPC's argument names and its answer shape as supabase-js sees them. */
describe("0055 appendConsentEventGuarded against the live function (CI only)", () => {
  it("appends, reports a retry of the same source as duplicate, refuses by guard, and recordCarrierBlock is idempotent (mutation: misname any p_ argument in consentWriteArgs → PGRST202, FAILS)", async () => {
    await withTestAccount(async (_tdb, id) => {
      const db = serviceDb();
      const e = { accountId: id, channel: "sms" as const, address: "+19565550166", action: "revoked" as const, method: "keyword" as const, sourceRef: "msg_live_1", evidence: { keyword: "STOP" } };
      const first = await appendConsentEventGuarded(db, e, "unless_customer_stopped");
      expect(first.outcome).toBe("appended");
      const again = await appendConsentEventGuarded(db, e, "unless_customer_stopped");
      expect(again).toEqual({ outcome: "duplicate", id: (first as { id: string }).id });
      expect(await recordCarrierBlock(db, { accountId: id, address: "+19565550166", contactId: null, kind: "voice.textback" })).toBe("already_stopped");
      expect(await readConsentState(db, id, "sms", "+19565550166")).toMatchObject({ state: "stopped", method: "keyword" });
      const lift = await appendConsentEventGuarded(db, { ...e, action: "resubscribed", method: "start_keyword", sourceRef: "msg_live_2" }, "if_stopped_or_held");
      expect(lift).toMatchObject({ outcome: "appended", prior: { action: "revoked", method: "keyword", evidence: { keyword: "STOP" } } });
    });
  });
});
