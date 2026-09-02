import { describe, it, expect } from "vitest";
import "dotenv/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { listRecentEvents } from "../events";

describe("listRecentEvents", () => {
  it("newest first, capped at limit, cross-tenant rows excluded", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (db2, accountB) => {
        // Direct inserts (not `emit()`) so `created_at` can be pinned exactly,
        // the same reason booking.test.ts/voice.test.ts stamp it after the
        // fact — here it's simpler to set it in the one insert. Dates land in
        // 2027, well after `withTestAccount`'s own `account.created` event
        // (real "now"), so that ambient row sorts as the OLDEST thing in
        // either account's ledger and never competes with this fixture set.
        async function eventAt(
          dbc: SupabaseClient, acct: string, type: string, createdIso: string, payload: object = {},
        ): Promise<string> {
          const { data, error } = await dbc.from("events")
            .insert({ account_id: acct, type, actor_type: "system", actor_id: "test", payload, created_at: createdIso })
            .select("id").single();
          if (error) throw new Error(error.message);
          return String((data as { id: number | string }).id);
        }

        // accountA: 4 events, oldest to newest.
        await eventAt(db, accountA, "note.created", "2027-01-01T00:00:00.000Z");
        const bookingId = await eventAt(db, accountA, "booking.created", "2027-01-02T00:00:00.000Z",
          { bookingId: "b1" });
        const formId = await eventAt(db, accountA, "form.submitted", "2027-01-03T00:00:00.000Z",
          { formId: "f1", submissionId: "s1", contactId: null });
        const callId = await eventAt(db, accountA, "call.recorded", "2027-01-04T00:00:00.000Z",
          { callId: "c1", outcome: "booked" });

        // Other tenant, same window, even NEWER than every accountA row —
        // must never leak into accountA's result despite outranking it on
        // recency alone.
        await eventAt(db2, accountB, "call.recorded", "2027-01-05T00:00:00.000Z", { callId: "c2" });

        const result = await listRecentEvents(db, accountA, 3);
        expect(result.map((e) => e.id)).toEqual([callId, formId, bookingId]); // newest-first, oldest (note.created) cut by the limit

        expect(result[0]).toEqual({
          id: callId,
          type: "call.recorded",
          actorType: "system",
          payload: { callId: "c1", outcome: "booked" },
          createdAt: expect.stringContaining("2027-01-04"),
        });
      });
    });
  });
});
