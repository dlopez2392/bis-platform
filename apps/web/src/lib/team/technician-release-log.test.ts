import { describe, it, expect, vi, beforeEach } from "vitest";

const emit = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), emit }));

import type { SupabaseClient } from "@bis/db";
import { recordTechnicianRelease, latestTechnicianRelease, TECHNICIAN_TASKS_RELEASED } from "./technician-release-log";

const USER = "33333333-3333-4333-8333-333333333333";
const T1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Records every builder call; maybeSingle resolves to `answer` (removal-log.test.ts's fake). */
function readDb(answer: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = [];
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) chain[k] = (...a: unknown[]) => { calls.push([k, ...a]); return chain; };
  chain.maybeSingle = async () => answer;
  const db = { from: (t: string) => { calls.push(["from", t]); return chain; } } as unknown as SupabaseClient;
  return { db, calls };
}

beforeEach(() => { emit.mockReset(); emit.mockResolvedValue(undefined); });

describe("recordTechnicianRelease", () => {
  it("emits team.technician_tasks_released as a SYSTEM event carrying the userId and task ids, actor the caller (mutation: actor type user -> FAILS)", async () => {
    const db = {} as SupabaseClient;
    await recordTechnicianRelease(db, "acct", "user_A", USER, [T1, T2]);
    expect(emit).toHaveBeenCalledWith(db, "acct", "team.technician_tasks_released", "user_A",
      { userId: USER, taskIds: [T1, T2] }, "system");
    expect(TECHNICIAN_TASKS_RELEASED).toBe("team.technician_tasks_released");
  });
  it("nothing released is nothing recorded: an empty list never reaches emit (mutation: drop the empty-list guard -> FAILS)", async () => {
    const db = {} as SupabaseClient;
    await recordTechnicianRelease(db, "acct", "user_A", USER, []);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("latestTechnicianRelease", () => {
  const row = { payload: { userId: USER, taskIds: [T1] }, created_at: "2026-10-10T12:00:00Z" };

  it("reads the newest system-written release of THIS person in THIS account (mutations: drop any filter, or order ascending -> FAILS)", async () => {
    const { db, calls } = readDb({ data: row, error: null });
    expect(await latestTechnicianRelease(db, "acct", USER)).toEqual({ userId: USER, taskIds: [T1], releasedAt: "2026-10-10T12:00:00Z" });
    expect(calls).toEqual(expect.arrayContaining([
      ["from", "events"],
      ["eq", "account_id", "acct"],
      ["eq", "type", "team.technician_tasks_released"],
      // record_event (0053) lets any signed-in client append a 'user' event of
      // ANY type to its own account, so a forged release is always 'user'.
      // Only the service role writes 'system'.
      ["eq", "actor_type", "system"],
      ["eq", "payload->>userId", USER],
      ["order", "created_at", { ascending: false }],
      ["limit", 1],
    ]));
  });
  it("the account filter is THIS account, never a stranger's: a different value never appears (mutation: hard-code the account -> FAILS)", async () => {
    const { db, calls } = readDb({ data: row, error: null });
    await latestTechnicianRelease(db, "other-acct", USER);
    expect(calls).toEqual(expect.arrayContaining([["eq", "account_id", "other-acct"]]));
    expect(calls).not.toEqual(expect.arrayContaining([["eq", "account_id", "acct"]]));
  });
  it("the person filter is THIS user, never a stranger's (mutation: drop the userId filter -> FAILS)", async () => {
    const { db, calls } = readDb({ data: row, error: null });
    await latestTechnicianRelease(db, "acct", "44444444-4444-4444-8444-444444444444");
    expect(calls).toEqual(expect.arrayContaining([["eq", "payload->>userId", "44444444-4444-4444-8444-444444444444"]]));
  });
  it("orders newest first, never oldest (mutation: flip to ascending -> FAILS)", async () => {
    const { db, calls } = readDb({ data: row, error: null });
    await latestTechnicianRelease(db, "acct", USER);
    const orderCall = calls.find(([k]) => k === "order");
    expect(orderCall).toEqual(["order", "created_at", { ascending: false }]);
  });
  it("no event is null", async () => {
    const { db } = readDb({ data: null, error: null });
    expect(await latestTechnicianRelease(db, "acct", USER)).toBeNull();
  });
  it("a payload naming someone else is null, never read as this person's (mutation: skip the userId check -> FAILS)", async () => {
    const { db } = readDb({ data: { ...row, payload: { ...row.payload, userId: "someone-else" } }, error: null });
    expect(await latestTechnicianRelease(db, "acct", USER)).toBeNull();
  });
  it("a malformed task-id list is null, never a guessed id (mutation: default taskIds to [] instead of rejecting -> FAILS)", async () => {
    for (const taskIds of [["not-a-uuid"], [7], T1, [T1, 7], null, undefined]) {
      const { db } = readDb({ data: { ...row, payload: { ...row.payload, taskIds } }, error: null });
      expect(await latestTechnicianRelease(db, "acct", USER), JSON.stringify(taskIds)).toBeNull();
    }
  });
  it("a non-object payload is null", async () => {
    const { db } = readDb({ data: { ...row, payload: "x" }, error: null });
    expect(await latestTechnicianRelease(db, "acct", USER)).toBeNull();
  });
  it("a read error throws", async () => {
    const { db } = readDb({ data: null, error: { message: "down" } });
    await expect(latestTechnicianRelease(db, "acct", USER)).rejects.toThrow(/latestTechnicianRelease failed/);
  });
});
