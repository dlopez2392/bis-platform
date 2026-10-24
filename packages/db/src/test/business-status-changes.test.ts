// S-47d D13b: the switch's own change log, read back for the closure history (apps/web automations/closures.ts).
// Seeded through `emit`, the writer the switch's actions use (business-status-actions.ts), never a hand-made row.
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import { emit } from "../events";
import { listBusinessStatusChanges } from "../business-status";

async function twoAccounts(fn: (db: SupabaseClient, a: string, b: string) => Promise<void>) {
  await withTestAccount(async (db, a) => {
    await withTestAccount(async (_db, b) => {
      await fn(db, a, b);
    });
  });
}

const STORM = { from: "open", to: "storm", late_minutes: null, until: "2026-10-24T05:00:00.000Z" };
const OPENED = { from: "storm", to: "open", late_minutes: null, until: null };

describe("listBusinessStatusChanges", () => {
  it("this account's business_status.changed events, oldest first, mapped; never a second account's, never another type (mutations: drop .eq(account_id) or .eq(type) -> FAILS)", async () => {
    await twoAccounts(async (db, a, b) => {
      const since = new Date(Date.now() - 60_000).toISOString();
      await emit(db, a, "business_status.changed", "user_test", STORM);
      await emit(db, a, "booking.created", "user_test", { bookingId: "x" });
      await emit(db, b, "business_status.changed", "user_test", { from: "open", to: "closed_today", late_minutes: null, until: null });
      await emit(db, a, "business_status.changed", "user_test", OPENED);

      const changes = await listBusinessStatusChanges(db, a, since);
      expect(changes.map(({ from, to, until }) => ({ from, to, until }))).toEqual([
        { from: "open", to: "storm", until: "2026-10-24T05:00:00.000Z" },
        { from: "storm", to: "open", until: null },
      ]);
      expect(Date.parse(changes[0]!.at)).toBeLessThanOrEqual(Date.parse(changes[1]!.at));
      expect(changes.every((c) => Date.parse(c.at) >= Date.parse(since))).toBe(true);

      const forB = await listBusinessStatusChanges(db, b, since);
      expect(forB.map((c) => c.to)).toEqual(["closed_today"]);
    });
  });

  it("filters on created_at >= since, and over the limit keeps the NEWEST, still oldest first", async () => {
    await withTestAccount(async (db, a) => {
      const since = new Date(Date.now() - 60_000).toISOString();
      await emit(db, a, "business_status.changed", "user_test", { ...STORM, to: "closed_today" });
      await emit(db, a, "business_status.changed", "user_test", STORM);
      await emit(db, a, "business_status.changed", "user_test", OPENED);
      expect((await listBusinessStatusChanges(db, a, since, 2)).map((c) => c.to)).toEqual(["storm", "open"]);
      expect(await listBusinessStatusChanges(db, a, new Date(Date.now() + 60_000).toISOString())).toEqual([]);
    });
  });

  it("a payload it cannot read maps to nulls, never a throw: an unknown state, a non-string until or from", async () => {
    await withTestAccount(async (db, a) => {
      const since = new Date(Date.now() - 60_000).toISOString();
      await emit(db, a, "business_status.changed", "user_test", { from: 7, to: "hurricane", until: 12 });
      const [c] = await listBusinessStatusChanges(db, a, since);
      expect({ from: c!.from, to: c!.to, until: c!.until }).toEqual({ from: null, to: null, until: null });
    });
  });
});
