import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

const dbForRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ dbForRequest: dbForRequestMock }));

const dbMocks = vi.hoisted(() => ({
  addTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

const setBookingStatusActionMock = vi.hoisted(() => vi.fn());
vi.mock("../calendar/actions", () => ({ setBookingStatusAction: setBookingStatusActionMock }));

import { revalidatePath } from "next/cache";
import { completeWorkTask, reopenWorkTask, dismissToTask, closeOutBooking } from "./actions";

/** A minimal fake Supabase client satisfying only the one chain
 *  `dismissToTask` reads directly (`accounts.timezone`) — everything else it
 *  touches (`addTask`) is itself mocked above and never inspects the client
 *  it's handed. */
function fakeDb(result: { data: { timezone: string } | null; error: { message: string } | null }) {
  return {
    from: (table: string) => {
      if (table !== "accounts") throw new Error(`fakeDb: unexpected table "${table}"`);
      return { select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) };
    },
  };
}

/** The exact object `dbForRequest()` resolves to for the current test — a
 *  distinct reference each time `beforeEach` runs. Assertions below pin THIS
 *  object as the client argument rather than `expect.anything()`: a mutation
 *  that swapped `dbForRequest()` for `serviceDb()` (as `closeOutBooking`'s
 *  own delegate legitimately does, and as the other three must NOT) would
 *  pass a real Supabase client or throw before `completeTask`/`reopenTask`/
 *  `addTask` is ever called — either way, a loose `expect.anything()` cannot
 *  tell the difference, but pinning the reference (or, for `addTask`, the
 *  exact fake client contents) can. Matches the pattern
 *  `calendar/actions.test.ts` already uses for the same reason.
 */
let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  db = fakeDb({ data: { timezone: "America/Chicago" }, error: null });
  dbForRequestMock.mockResolvedValue(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("completeWorkTask", () => {
  it("completes the task and revalidates the To do route", async () => {
    dbMocks.completeTask.mockResolvedValue(undefined);
    const r = await completeWorkTask("acct_1", "task_1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.completeTask).toHaveBeenCalledWith(
      db, "acct_1", "task_1", "user_1",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("returns an honest error instead of throwing when the write fails", async () => {
    dbMocks.completeTask.mockRejectedValue(new Error("db exploded"));
    const r = await completeWorkTask("acct_1", "task_1");
    expect(r.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("reopenWorkTask", () => {
  it("reopens the task and revalidates", async () => {
    dbMocks.reopenTask.mockResolvedValue(undefined);
    const r = await reopenWorkTask("acct_1", "task_1");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.reopenTask).toHaveBeenCalledWith(
      db, "acct_1", "task_1", "user_1",
    );
  });

  it("returns an honest error instead of throwing when the write fails", async () => {
    dbMocks.reopenTask.mockRejectedValue(new Error("db exploded"));
    const r = await reopenWorkTask("acct_1", "task_1");
    expect(r.ok).toBe(false);
  });
});

describe("dismissToTask", () => {
  it("creates a task due tomorrow 09:00 in the ACCOUNT's own zone, titled with the row's own label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T14:00:00Z"));
    dbMocks.addTask.mockResolvedValue({ id: "task_new" });

    const r = await dismissToTask("acct_1", {
      source: "conversation", contactId: "contact_1", title: "Reply to Maria Garcia",
    });

    expect(r).toEqual({ ok: true, taskId: "task_new", dueAt: "2026-09-15T14:00:00.000Z" });
    expect(dbMocks.addTask).toHaveBeenCalledWith(
      db, "acct_1",
      { contactId: "contact_1", title: "Reply to Maria Garcia", dueAt: "2026-09-15T14:00:00.000Z" },
      "user_1",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("omits the due date rather than guessing when the account's zone is unusable, and says so in the result", async () => {
    const badZoneDb = fakeDb({ data: { timezone: "Not/AZone" }, error: null });
    dbForRequestMock.mockResolvedValue(badZoneDb);
    dbMocks.addTask.mockResolvedValue({ id: "task_new" });

    const r = await dismissToTask("acct_1", { source: "booking", contactId: null, title: "Did this job happen?" });

    expect(r).toEqual({ ok: true, taskId: "task_new", dueAt: null });
    expect(dbMocks.addTask).toHaveBeenCalledWith(
      badZoneDb, "acct_1",
      { contactId: undefined, title: "Did this job happen?", dueAt: undefined },
      "user_1",
    );
  });

  it("fails honestly, without creating anything, when the account lookup itself fails", async () => {
    dbForRequestMock.mockResolvedValue(fakeDb({ data: null, error: { message: "boom" } }));
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "c1", title: "Reply to X" });
    expect(r.ok).toBe(false);
    expect(dbMocks.addTask).not.toHaveBeenCalled();
  });

  it("returns an honest error instead of throwing when the write fails", async () => {
    dbMocks.addTask.mockRejectedValue(new Error("db exploded"));
    const r = await dismissToTask("acct_1", { source: "conversation", contactId: "c1", title: "Reply to X" });
    expect(r.ok).toBe(false);
  });
});

describe("closeOutBooking", () => {
  it("delegates to the calendar screen's own action and ALSO revalidates the To do route", async () => {
    setBookingStatusActionMock.mockResolvedValue({ ok: true });
    const r = await closeOutBooking("acct_1", "booking_1", "completed");
    expect(r).toEqual({ ok: true });
    expect(setBookingStatusActionMock).toHaveBeenCalledWith("acct_1", "booking_1", "completed");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/accounts/acct_1/tasks");
  });

  it("forwards a failure verbatim and does not revalidate", async () => {
    setBookingStatusActionMock.mockResolvedValue({ ok: false, error: "Could not update this booking." });
    const r = await closeOutBooking("acct_1", "booking_1", "no_show");
    expect(r).toEqual({ ok: false, error: "Could not update this booking." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
