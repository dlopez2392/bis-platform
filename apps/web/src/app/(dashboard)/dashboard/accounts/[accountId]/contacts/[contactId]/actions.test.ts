import { describe, it, expect, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => ({ userId: "user_1" })) }));

/** `addTaskAction`'s own describe block (D-006) needs a real `accounts` read
 *  (for the account's `timezone`) that the pre-existing `completeTaskAction`
 *  tests above never touch — so this fake branches on the table name rather
 *  than widening every other test's `{}` stub. */
const accountTimezone = vi.hoisted(() => ({ value: "America/Chicago" as string | null }));
/** Review correction: `dueAtInAccountZone`'s accounts read used to drop its
 *  `.error` on the floor and fall through to `renderZone(undefined)` — the
 *  AGENCY's zone, guessed, for a read that genuinely FAILED rather than one
 *  that genuinely found no timezone. Toggled per-test, like
 *  `accountTimezone` above. */
const accountReadError = vi.hoisted(() => ({ value: null as { message: string } | null }));
vi.mock("@/lib/db", () => ({
  dbForRequest: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "accounts") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => (
          accountReadError.value
            ? { data: null, error: accountReadError.value }
            : { data: { timezone: accountTimezone.value }, error: null }
        ) }) }) };
      }
      return {};
    },
  })),
}));
const completeTask = vi.hoisted(() => vi.fn());
const addTask = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})));
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

  // Review: D-006 only read right in a zone WEST of UTC — the only kind
  // this platform's accounts happen to be in today, but not the only kind
  // `renderZone` can return. Berlin is EAST of UTC: midnight there is
  // already the PREVIOUS day in UTC, the opposite direction from Chicago's
  // own bug. `formatDateInZone`, the SAME function both this and the To do
  // screen render with, must read back the picked day regardless.
  it("round-trips to the same calendar day in a zone EAST of UTC too (mutation: store UTC midnight instead → FAILS)", async () => {
    accountTimezone.value = "Europe/Berlin";
    accountReadError.value = null;
    addTask.mockClear();
    await addTaskAction("a1", taskForm("2026-10-08"));
    const payload = addTask.mock.calls[0]![2] as { dueAt?: string };
    // Berlin is CEST (UTC+2) in October: midnight there is 22:00 UTC the
    // PREVIOUS day — the OLD UTC-midnight fallback ("2026-10-08T00:00:00Z")
    // would read back as Oct 7 here, not Oct 8.
    expect(payload.dueAt).toBe("2026-10-07T22:00:00.000Z");
    const { formatDateInZone } = await import("@/lib/format");
    expect(formatDateInZone(payload.dueAt!, "Europe/Berlin")).toBe("Oct 8, 2026");
  });

  // Review: most zones shift their clocks at 2 a.m. local, where midnight
  // is always on the near side of the jump — true for every US zone, which
  // is why the original comment generalised it to "midnight is never in a
  // DST gap". Cuba shifts AT midnight: 00:00 through the jump's length do
  // not exist as wall-clock times on this date at all.
  it("falls to the first valid instant of the day when midnight itself is inside a DST gap (Havana, 2027-03-14) (mutation: fall back to UTC midnight instead → FAILS)", async () => {
    accountTimezone.value = "America/Havana";
    accountReadError.value = null;
    addTask.mockClear();
    await addTaskAction("a1", taskForm("2027-03-14"));
    const payload = addTask.mock.calls[0]![2] as { dueAt?: string };
    const { formatDateInZone } = await import("@/lib/format");
    expect(formatDateInZone(payload.dueAt!, "America/Havana")).toBe("Mar 14, 2027");
  });

  it("surfaces a failed account timezone read instead of silently guessing the agency's zone (mutation: drop the error check → FAILS)", async () => {
    accountTimezone.value = "America/Chicago";
    accountReadError.value = { message: "connection reset" };
    addTask.mockClear();
    await expect(addTaskAction("a1", taskForm("2026-10-08")))
      .rejects.toThrow(/connection reset/);
    accountReadError.value = null;
  });
});
