import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOpportunity } from "../opportunities";

/**
 * T17 review M10 (S-47e): createOpportunity's contact read can fail. It still fails CLOSED (no deal is
 * inserted), but with the read's own error, never "contact not in account", which would send whoever reads
 * the log looking for a missing contact. No real database: a stub whose pipeline has one stage and whose
 * contacts read errors.
 */
function stubDb(contactRead: { data: unknown; error: { message: string } | null }) {
  const inserted: string[] = [];
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: [{ id: "st-1", name: "New", position: 0 }], error: null }),
        maybeSingle: async () => contactRead,
        insert: () => { inserted.push(table); return chain; },
        single: async () => ({ data: { id: "opp-1" }, error: null }),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, inserted };
}

describe("createOpportunity: a failed contact read", () => {
  it("throws the read's own error and inserts nothing (mutation: ignore the read's error -> \"contact not in account\", FAILS)", async () => {
    const { db, inserted } = stubDb({ data: null, error: { message: "canceling statement due to statement timeout" } });
    await expect(createOpportunity(db, "acct-1", { contactId: "ct-1", pipelineId: "pipe-1", name: "Roof" }, "user_1"))
      .rejects.toThrow("createOpportunity: contact read failed: canceling statement due to statement timeout");
    expect(inserted).toEqual([]);
  });

  it("a read that finds no such contact still says so", async () => {
    const { db, inserted } = stubDb({ data: null, error: null });
    await expect(createOpportunity(db, "acct-1", { contactId: "ct-1", pipelineId: "pipe-1", name: "Roof" }, "user_1"))
      .rejects.toThrow("contact not in account");
    expect(inserted).toEqual([]);
  });
});
