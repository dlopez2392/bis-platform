import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import {
  startAgencyVisit, agencyVisitLive, noteAgencyOpen, newestAgencyVisitStart,
} from "../access-log";

/**
 * 0105 through the real PostgREST: the service-role wrappers end to end, and the teardown. CI only
 * (withTestAccount); the database cases are access-log-schema.test.ts (withRollback) and the argument
 * mapping is access-log-wrappers.test.ts (a fake client).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const actor = { clerkUserId: `user_agency_live_${RUN}`, sessionId: `sess_live_${RUN}` };

describe("0105 live: the service-role wrappers through PostgREST", () => {
  it("start twice answers one visit, which is live; a note on it is ok; a note for another account finds no visit; the newest start reads back", async () => {
    await withTestAccount(async (db, accountId) => {
      const first = await startAgencyVisit(db, accountId, { ...actor, name: "Dan Lopez" }, "support");
      expect(typeof first).toBe("string");
      expect(await startAgencyVisit(db, accountId, { ...actor, name: "Dan Lopez" }, "billing")).toBe(first);
      expect(await agencyVisitLive(db, accountId, actor)).toBe(first);
      expect(await noteAgencyOpen(db, accountId, actor, { kind: "contact", recordId: randomUUID() })).toBe("ok");
      expect(await noteAgencyOpen(db, randomUUID(), actor, { kind: "contact", recordId: randomUUID() })).toBe("no_visit");
      expect(typeof (await newestAgencyVisitStart(db, accountId, actor))).toBe("string");
      // A missing account is null, not a throw (23503).
      expect(await startAgencyVisit(db, randomUUID(), { ...actor, name: null }, "fix")).toBeNull();
    });
  });

  it("is carried off by the account's own deletion, so it needs no line in the teardown list", async () => {
    let accountId = "";
    await withTestAccount(async (db, id) => {
      accountId = id;
      await startAgencyVisit(db, id, { ...actor, name: null }, "setup");
      expect(await noteAgencyOpen(db, id, actor, { kind: "customer_list_export", itemCount: 3 })).toBe("ok");
    });
    // withTestAccount's finally has run deleteAccountCascade, which does NOT name either table (service_role
    // holds no DELETE on them). Under `on delete restrict` it would have thrown "cleanup failed on accounts".
    const visits = await serviceDb().from("agency_visits").select("id").eq("account_id", accountId);
    expect(visits.error, `leftover check failed: ${visits.error?.message}`).toBeNull();
    expect(visits.data).toEqual([]);
    const items = await serviceDb().from("agency_visit_items").select("id").eq("account_id", accountId);
    expect(items.error, `leftover check failed: ${items.error?.message}`).toBeNull();
    expect(items.data).toEqual([]);
  });
});
