import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  setForwardCalls, upsertVoiceProfile, PROFILE_COLS,
  type VoiceProfileRow, type VoiceProfilePatch,
} from "./voice";

/**
 * Hermetic: a fake client, no network. What reaches the database (the column,
 * its default, the absent client grant, the recorded event) is pinned live in
 * test/voice-forward-grants.test.ts, against 0058_voice_forward_calls.sql.
 *
 * The fake is a SERVICE client (no user-client mark), which is the only
 * client setForwardCalls is called with: authenticated has no UPDATE on
 * voice_profiles, so emit() takes its direct events insert here.
 */
function fakeDb(result: { data: unknown; error: { message: string } | null }) {
  const select = vi.fn(async () => result);
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const insert = vi.fn(async () => ({ error: null }));
  const from = vi.fn((table: string) => (table === "events" ? { insert } : { update }));
  return { db: { from } as unknown as SupabaseClient, from, update, eq, select, insert };
}

describe("setForwardCalls", () => {
  it("writes forward_calls (and updated_at) on that account's profile only (mutation: drop the account_id filter, or write another column → FAILS)", async () => {
    const f = fakeDb({ data: [{ id: "vp_1" }], error: null });
    await setForwardCalls(f.db, "acct_1", true, "user_1");
    expect(f.from).toHaveBeenNthCalledWith(1, "voice_profiles");
    expect(f.update).toHaveBeenCalledTimes(1);
    const written = (f.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(written).sort()).toEqual(["forward_calls", "updated_at"]);
    expect(written.forward_calls).toBe(true);
    expect(typeof written.updated_at).toBe("string");
    expect(f.eq).toHaveBeenCalledTimes(1);
    expect(f.eq).toHaveBeenCalledWith("account_id", "acct_1");
    // .select() is what makes a zero-row update visible at all (PostgREST
    // reports an UPDATE matching nothing as success with no rows).
    expect(f.select).toHaveBeenCalledWith("id");
  });

  it("emits exactly one voice.forward_changed carrying { forwardCalls } and the actor (mutation: another type name, or payload { on } → FAILS)", async () => {
    const f = fakeDb({ data: [{ id: "vp_1" }], error: null });
    await setForwardCalls(f.db, "acct_1", true, "user_1");
    expect(f.from).toHaveBeenNthCalledWith(2, "events");
    expect(f.insert).toHaveBeenCalledTimes(1);
    expect(f.insert).toHaveBeenCalledWith({
      account_id: "acct_1", type: "voice.forward_changed", actor_type: "user", actor_id: "user_1",
      payload: { forwardCalls: true },
    });
  });

  it("turning it OFF writes false and records false, with a system actor when asked (mutation: hard-code true, or drop actorType → FAILS)", async () => {
    const f = fakeDb({ data: [{ id: "vp_1" }], error: null });
    await setForwardCalls(f.db, "acct_2", false, "system", "system");
    const written = (f.update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(written.forward_calls).toBe(false);
    expect(f.insert).toHaveBeenCalledWith({
      account_id: "acct_2", type: "voice.forward_changed", actor_type: "system", actor_id: "system",
      payload: { forwardCalls: false },
    });
  });

  it.each([
    ["an empty row list", { data: [], error: null }],
    ["a null row list", { data: null, error: null }],
  ])("throws, naming the account, when no profile row matched (%s), and records NO event (mutation: drop the zero-row check → FAILS)", async (_label, result) => {
    const f = fakeDb(result);
    await expect(setForwardCalls(f.db, "acct_none", true, "user_1"))
      .rejects.toThrow("setForwardCalls: no voice profile for account acct_none");
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("throws on a database error and records NO event (mutation: emit before checking the error → FAILS)", async () => {
    const f = fakeDb({ data: null, error: { message: "permission denied for table voice_profiles" } });
    await expect(setForwardCalls(f.db, "acct_1", true, "user_1"))
      .rejects.toThrow("setForwardCalls failed: permission denied for table voice_profiles");
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("refuses a value that is not a boolean before any write: undefined would update nothing but updated_at and still record an event (mutation: drop the typeof check → FAILS)", async () => {
    const f = fakeDb({ data: [{ id: "vp_1" }], error: null });
    for (const bad of [undefined, "true", 1, null]) {
      await expect(setForwardCalls(f.db, "acct_1", bad as unknown as boolean, "user_1"))
        .rejects.toThrow("setForwardCalls: on must be true or false");
    }
    expect(f.from).not.toHaveBeenCalled();
  });
});

describe("upsertVoiceProfile cannot write forward_calls (setForwardCalls is the only writer)", () => {
  it("VoiceProfilePatch omits it at the type level, and upsertVoiceProfile refuses the key at run time before touching the database (mutation: drop the run-time guard → FAILS; drop the Omit → typecheck FAILS on the unused @ts-expect-error)", async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    // @ts-expect-error forward_calls is not part of VoiceProfilePatch (0058: setForwardCalls only)
    const patch: VoiceProfilePatch = { greeting_en: "Hi", forward_calls: true };
    await expect(upsertVoiceProfile(db, "acct_1", patch, "user_1"))
      .rejects.toThrow("upsertVoiceProfile cannot write forward_calls; use setForwardCalls");
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses the key even when its value is false: a 'save all fields' form must not reset the forward either (mutation: guard only on true → FAILS)", async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;
    const patch = { forward_calls: false } as unknown as VoiceProfilePatch;
    await expect(upsertVoiceProfile(db, "acct_1", patch, "user_1"))
      .rejects.toThrow("upsertVoiceProfile cannot write forward_calls; use setForwardCalls");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("the read side carries forward_calls", () => {
  it("PROFILE_COLS selects forward_calls, so getVoiceProfile returns it (mutation: leave it out of PROFILE_COLS → FAILS; live pin: test/voice-schema.test.ts)", () => {
    expect(PROFILE_COLS.split(",").map((c) => c.trim())).toContain("forward_calls");
  });

  it("VoiceProfileRow types it as a plain boolean (compile-time; NOT NULL in 0058)", () => {
    const off: VoiceProfileRow["forward_calls"] = false;
    // @ts-expect-error forward_calls is NOT NULL, so the row type admits no null
    const nul: VoiceProfileRow["forward_calls"] = null;
    expect([off, nul]).toEqual([false, null]);
  });
});
