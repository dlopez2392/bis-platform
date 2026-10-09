import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureCallbackTask } from "../voice";

/**
 * Moved verbatim from call-id-fallback.test.ts when that file's subject (the
 * TEMPORARY pre-0064 read fallback) was removed: this case was never about
 * the fallback, it only shared the file's fake-database shape.
 */
afterEach(() => { vi.restoreAllMocks(); });

describe("ensureCallbackTask: the To do is written even if its event is not (M8)", () => {
  it("an emit failure after the insert logs as an EMIT failure and still returns the To do (mutation: let the emit throw → rejects, FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      from: (table: string) => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "task1" }, error: null }) }) }),
        ...(table === "events" ? { insert: async () => ({ error: { message: "events insert refused" } }) } : {}),
      }),
    } as unknown as SupabaseClient;
    await expect(ensureCallbackTask(db, "a1",
      { callId: "call1", contactId: null, title: "Call back at 9565061545: Roof leak", dueAt: "2027-06-01T17:02:00.000Z" },
      "voice", "ai")).resolves.toEqual({ id: "task1", created: true });
    expect(err.mock.calls.some((c) => /task\.created emit failed/.test(String(c[0])) && String(c[0]).includes("task1"))).toBe(true);
  });
});
