import { describe, it, expect, vi, beforeEach } from "vitest";

const emit = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), emit }));

import type { SupabaseClient } from "@bis/db";
import { recordRemoval, latestRemoval, MEMBER_REMOVED } from "./removal-log";

const USER = "33333333-3333-4333-8333-333333333333";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NONE = { contacts: [], tasks: [] };

/** Records every builder call; maybeSingle resolves to `answer`. */
function readDb(answer: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  chain.maybeSingle = async () => answer;
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

beforeEach(() => { emit.mockReset(); emit.mockResolvedValue(undefined); });

describe("recordRemoval", () => {
  it("emits team.member_removed as a SYSTEM event carrying ids, role and language, actor the caller (mutation: actor type user -> FAILS)", async () => {
    const db = {} as SupabaseClient;
    await recordRemoval(db, "acct", "user_A", { userId: USER, clerkUserId: "user_C", role: "staff", language: "es" });
    expect(emit).toHaveBeenCalledWith(db, "acct", "team.member_removed", "user_A",
      { userId: USER, clerkUserId: "user_C", role: "staff", language: "es", released: { contacts: [], tasks: [] } }, "system");
    expect(MEMBER_REMOVED).toBe("team.member_removed");
  });
  // F-085 part 1 (spec §8, A3): the ids the removal released ride in the
  // event, so the undo can give back those still Unassigned.
  it("carries the released ids when the removal released any (mutation: drop released from the payload -> FAILS)", async () => {
    const db = {} as SupabaseClient;
    const released = { contacts: [C1], tasks: [T1] };
    await recordRemoval(db, "acct", "user_A", { userId: USER, clerkUserId: "user_C", role: "technician", language: null, released });
    expect(emit).toHaveBeenCalledWith(db, "acct", "team.member_removed", "user_A",
      { userId: USER, clerkUserId: "user_C", role: "technician", language: null, released }, "system");
  });
});

describe("latestRemoval", () => {
  const row = { payload: { userId: USER, clerkUserId: "user_C", role: "staff", language: null }, created_at: "2026-10-10T12:00:00Z" };

  it("reads the newest system-written removal of THIS person in THIS account (mutations: drop any filter, or order ascending -> FAILS)", async () => {
    const { db, calls } = readDb({ data: row, error: null });
    expect(await latestRemoval(db, "acct", USER)).toEqual({ userId: USER, clerkUserId: "user_C", role: "staff", language: null, released: NONE, removedAt: "2026-10-10T12:00:00Z" });
    expect(calls).toEqual(expect.arrayContaining([
      ["from", "events"],
      ["eq", "account_id", "acct"],
      ["eq", "type", "team.member_removed"],
      // record_event (0053) lets any signed-in client append a 'user' event of
      // ANY type to its own account, so a forged removal is always 'user'.
      // Only the service role writes 'system'.
      ["eq", "actor_type", "system"],
      ["eq", "payload->>userId", USER],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
    ]));
  });
  it("no event is null", async () => {
    const { db } = readDb({ data: null, error: null });
    expect(await latestRemoval(db, "acct", USER)).toBeNull();
  });
  it("a malformed payload is null, never a guessed role (mutation: default the role -> FAILS)", async () => {
    for (const payload of [{ ...row.payload, role: "admin" }, { ...row.payload, clerkUserId: "org_1" }, { ...row.payload, language: "fr" }, { ...row.payload, userId: "someone-else" }, "x"]) {
      const { db } = readDb({ data: { ...row, payload }, error: null });
      expect(await latestRemoval(db, "acct", USER)).toBeNull();
    }
  });
  it("parses released ids, and reads a Technician's removal (mutations: ignore released, or reject technician -> FAILS)", async () => {
    const released = { contacts: [C1], tasks: [T1] };
    const { db } = readDb({ data: { ...row, payload: { ...row.payload, role: "technician", released } }, error: null });
    expect(await latestRemoval(db, "acct", USER)).toMatchObject({ role: "technician", released });
  });
  it("an old record without released reads as nothing released, not null (mutation: return null -> FAILS)", async () => {
    const { db } = readDb({ data: row, error: null });
    expect((await latestRemoval(db, "acct", USER))?.released).toEqual(NONE);
  });
  it("a malformed released is nothing released, never a guessed id (mutation: pass any array through -> FAILS)", async () => {
    for (const released of [{ contacts: ["not-a-uuid"], tasks: [] }, { contacts: [C1], tasks: [7] }, { contacts: C1, tasks: [] }, { contacts: [C1] }, "x", null]) {
      const { db } = readDb({ data: { ...row, payload: { ...row.payload, released } }, error: null });
      expect((await latestRemoval(db, "acct", USER))?.released, JSON.stringify(released)).toEqual(NONE);
    }
  });
  it("a read error throws", async () => {
    const { db } = readDb({ data: null, error: { message: "down" } });
    await expect(latestRemoval(db, "acct", USER)).rejects.toThrow(/latestRemoval failed/);
  });
});
