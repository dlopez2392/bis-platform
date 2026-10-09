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
const getContactMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ id: "c1", custom: {} })));
const listCustomFieldsMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []));
const updateContactMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ flagged: false })));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), completeTask, addTask,
  getContact: getContactMock, listCustomFields: listCustomFieldsMock, updateContact: updateContactMock,
}));

import { HoldUndecidedError } from "@bis/db";
import { revalidatePath } from "next/cache";
import { completeTaskAction, addTaskAction, updateContactAction } from "./actions";

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

/**
 * Review round 1, CRITICAL C1: `updateContact`'s own `toRow` (packages/db/
 * src/contacts.ts) REPLACES the whole `custom` jsonb column rather than
 * merging it — a deliberate choice for the inline-field and form-submission
 * callers, which already read-then-merge themselves (enrich.ts's
 * `fillBlanks`). This action never did: it built `custom` from the
 * account's OWN field definitions alone and handed that straight to
 * `updateContact`, so saving the custom-fields card silently deleted any
 * key no definition covers — `custom.referred_by` (F-157's source
 * question) included, since no account defines a "referred_by" field.
 *
 * Fixed by reading the contact first and merging: a key with no matching
 * definition rides through untouched; a defined key is written (or
 * deleted, for an intentional clear) exactly as before.
 */
describe("updateContactAction — the custom-fields card merges, never replaces (review round 1, C1)", () => {
  function f(fields: Record<string, string>) {
    const fd = new FormData();
    fd.set("contactId", "c1");
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }
  const GATE_CODE_DEF = { id: "d1", field_key: "gate_code", name: "Gate code", data_type: "text" as const, options: [] };

  it("a save with one definition (gate_code) keeps an existing key no definition covers (referred_by) — the reviewer's exact probe (mutation: build custom from defs alone, no merge → FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "c1", custom: { referred_by: "Jane Smith" } });
    listCustomFieldsMock.mockResolvedValue([GATE_CODE_DEF]);
    updateContactMock.mockClear();
    await updateContactAction("a1", f({ cf_gate_code: "1234" }));
    expect(updateContactMock).toHaveBeenCalledTimes(1);
    const input = updateContactMock.mock.calls[0]![3] as { custom?: Record<string, unknown> };
    expect(input.custom).toEqual({ referred_by: "Jane Smith", gate_code: "1234" });
  });

  it("clearing a defined field still removes exactly that key, merge notwithstanding (mutation: stop deleting on blank → the old value survives, FAILS)", async () => {
    getContactMock.mockResolvedValue({ id: "c1", custom: { referred_by: "Jane Smith", gate_code: "1234" } });
    listCustomFieldsMock.mockResolvedValue([GATE_CODE_DEF]);
    updateContactMock.mockClear();
    await updateContactAction("a1", f({ cf_gate_code: "" }));
    const input = updateContactMock.mock.calls[0]![3] as { custom?: Record<string, unknown> };
    expect(input.custom).toEqual({ referred_by: "Jane Smith" });
  });

  it("a contact with no unrelated custom keys at all still saves the defined ones (no crash on an empty/missing existing custom)", async () => {
    getContactMock.mockResolvedValue({ id: "c1", custom: null });
    listCustomFieldsMock.mockResolvedValue([GATE_CODE_DEF]);
    updateContactMock.mockClear();
    await updateContactAction("a1", f({ cf_gate_code: "9999" }));
    const input = updateContactMock.mock.calls[0]![3] as { custom?: Record<string, unknown> };
    expect(input.custom).toEqual({ gate_code: "9999" });
  });
});
