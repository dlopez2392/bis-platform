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

/**
 * Review M5 of fix/batch-oct31: a deal is only ever for someone live. The new-deal picker searches live
 * customers only (the search route's rule: archived_at is null and merged_into is null), but the action takes
 * whatever id the form carries, so the same rule holds here, where the deal is written, with its own words.
 */
describe("createOpportunity: an archived or merged-away contact", () => {
  const input = { contactId: "ct-1", pipelineId: "pipe-1", name: "Roof" };

  it("refuses an archived contact and inserts nothing (mutation: skip the archived check -> FAILS)", async () => {
    const { db, inserted } = stubDb({ data: { id: "ct-1", archived_at: "2026-10-01T00:00:00Z", merged_into: null }, error: null });
    await expect(createOpportunity(db, "acct-1", input, "user_1")).rejects.toThrow("createOpportunity: the contact is archived");
    expect(inserted).toEqual([]);
  });

  it("refuses a merged-away contact and inserts nothing (mutation: skip the merged check -> FAILS)", async () => {
    const { db, inserted } = stubDb({ data: { id: "ct-1", archived_at: null, merged_into: "ct-kept" }, error: null });
    await expect(createOpportunity(db, "acct-1", input, "user_1")).rejects.toThrow("createOpportunity: the contact was merged into another");
    expect(inserted).toEqual([]);
  });

  it("a live contact gets the deal", async () => {
    const { db, inserted } = stubDb({ data: { id: "ct-1", archived_at: null, merged_into: null }, error: null });
    await expect(createOpportunity(db, "acct-1", input, "user_1")).resolves.toEqual({ id: "opp-1" });
    expect(inserted).toContain("opportunities");
  });
});
