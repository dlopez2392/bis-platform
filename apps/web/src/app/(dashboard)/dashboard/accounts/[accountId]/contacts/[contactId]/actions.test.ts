import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));

/** `addTaskAction`'s own describe block (D-006) needs a real `accounts` read
 *  (for the account's `timezone`) that the pre-existing `completeTaskAction`
 *  tests above never touch — so this fake branches on the table name rather
 *  than widening every other test's `{}` stub. */
const accountTimezone = vi.hoisted(() => ({ value: "America/Chicago" as string | null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: accountTimezone.value }, error: null }) }) }) };
      }
      return {};
    },
  })),
}));
const completeTask = vi.hoisted(() => vi.fn());
const addTask = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), completeTask, addTask }));

import { HoldUndecidedError } from "@bis/db";
import { revalidatePath } from "next/cache";
import { completeTaskAction, addTaskAction } from "./actions";

const form = (taskId: string) => { const f = new FormData(); f.set("contactId", "c1"); f.set("taskId", taskId); return f; };

describe("completeTaskAction — the timeline's 'complete' (review R3-I1)", () => {
  it("a stale page's Done on a hold's undecided To-do is refused without an error page: the page re-renders, and the timeline then shows its hint in place of Done (mutation: let HoldUndecidedError propagate → rejects, FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new HoldUndecidedError());
    await expect(completeTaskAction("a1", form("t1"))).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/a1/contacts/c1");
  });

  it("any other failure still throws, as before (mutation: swallow every error → FAILS)", async () => {
    completeTask.mockRejectedValueOnce(new Error("update failed"));
    await expect(completeTaskAction("a1", form("t2"))).rejects.toThrow("update failed");
  });
});

const taskForm = (dueAt: string) => {
  const f = new FormData();
  f.set("contactId", "c1");
  f.set("title", "Follow up");
  f.set("dueAt", dueAt);
  return f;
};

describe("addTaskAction's due date (D-006 — one day early on To do)", () => {
  it("saves a due date picked on a contact as midnight in the ACCOUNT's own zone, not UTC midnight (mutation: revert to `new Date(dueAt).toISOString()` → FAILS)", async () => {
    accountTimezone.value = "America/Chicago";
    addTask.mockClear();
    await addTaskAction("a1", taskForm("2026-10-08"));
    expect(addTask).toHaveBeenCalledTimes(1);
    const payload = addTask.mock.calls[0]![2] as { dueAt?: string };
    // America/Chicago is UTC-5 (CDT) in October: midnight Oct 8 there is
    // 05:00 UTC, still Oct 8 — `new Date("2026-10-08").toISOString()` instead
    // gives "2026-10-08T00:00:00.000Z", which is 7pm Oct 7 in Chicago: the
    // one-day-early bug `work-list.tsx`'s `formatDateInZone` then displays.
    expect(payload.dueAt).toBe("2026-10-08T05:00:00.000Z");
  });

  it("omits dueAt entirely when no date was picked", async () => {
    accountTimezone.value = "America/Chicago";
    addTask.mockClear();
    const f = new FormData();
    f.set("contactId", "c1");
    f.set("title", "Follow up");
    await addTaskAction("a1", f);
    expect(addTask).toHaveBeenCalledTimes(1);
    const payload = addTask.mock.calls[0]![2] as { dueAt?: string };
    expect(payload.dueAt).toBeUndefined();
  });
});
