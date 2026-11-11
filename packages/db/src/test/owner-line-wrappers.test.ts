import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setOwnerLineSwitch } from "../owner-line";

/**
 * F-032 Task 2 review m-3: setOwnerLineSwitch's state comes from the conditional UPDATE's OWN returned row when it
 * changed something (one round trip, and no window in which another write could show through), from a re-read only on
 * a no-op, and it throws when the account does not exist. Pure: a scripted builder, no database. The live counting
 * file proves the same calls reach PostgREST.
 */
type Row = { owner_line_enabled_at: string | null; owner_line_changed_at: string | null; owner_line_changed_by_kind: string | null };

function fakeSwitchDb(updated: Row[], read: Row | null) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      calls.push(`from ${table}`);
      const upd: Record<string, unknown> = {
        eq: (c: string, v: unknown) => { calls.push(`update.eq ${c}=${String(v)}`); return upd; },
        is: (c: string) => { calls.push(`update.is ${c} null`); return upd; },
        not: (c: string) => { calls.push(`update.not ${c} null`); return upd; },
        select: async (cols: string) => { calls.push(`update.select ${cols}`); return { data: updated, error: null }; },
      };
      const rd: Record<string, unknown> = {
        eq: () => rd,
        maybeSingle: async () => { calls.push("read"); return { data: read, error: null }; },
      };
      return { update: () => upd, select: () => rd };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

const ON: Row = { owner_line_enabled_at: "2026-11-09T20:00:00.000Z", owner_line_changed_at: "2026-11-09T20:00:00.000Z", owner_line_changed_by_kind: "owner" };
const OTHER: Row = { owner_line_enabled_at: null, owner_line_changed_at: "2026-11-09T21:00:00.000Z", owner_line_changed_by_kind: "agency" };

describe("setOwnerLineSwitch's answer (F-032 Task 2 review m-3)", () => {
  it("a real change answers from the UPDATE's own row, in one round trip (mutation: re-read after a change -> FAILS)", async () => {
    const { db, calls } = fakeSwitchDb([ON], OTHER);
    expect(await setOwnerLineSwitch(db, "acct_1", true, "owner")).toEqual({
      changed: true, state: { enabledAt: ON.owner_line_enabled_at, changedAt: ON.owner_line_changed_at, changedByKind: "owner" },
    });
    expect(calls).toEqual(["from accounts", "update.eq id=acct_1", "update.is owner_line_enabled_at null",
      "update.select owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by_kind"]);
  });

  it("a no-op answers changed: false from ONE re-read of the row as it stands", async () => {
    const { db, calls } = fakeSwitchDb([], OTHER);
    expect(await setOwnerLineSwitch(db, "acct_1", false, "owner")).toEqual({
      changed: false, state: { enabledAt: null, changedAt: OTHER.owner_line_changed_at, changedByKind: "agency" },
    });
    expect(calls.filter((c) => c === "read")).toHaveLength(1);
  });

  it("an account that does not exist throws, never an all-null 'off' (mutation: answer the re-read's nulls -> FAILS)", async () => {
    const { db } = fakeSwitchDb([], null);
    await expect(setOwnerLineSwitch(db, "acct_gone", false, "agency")).rejects.toThrow("setOwnerLineSwitch: no such account acct_gone");
  });
});
