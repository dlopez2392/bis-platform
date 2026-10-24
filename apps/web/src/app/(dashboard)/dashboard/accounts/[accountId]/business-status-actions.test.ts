import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** Spec §7 / plan "The guard": the real guard and the real pure reader run in this test — only the
 *  database layer is mocked, as `calendar/actions.test.ts` does for its own writes. `role`/`isAgency`
 *  are set per test, `tasks/actions.test.ts`'s `authFixture` shape. */
const authFixture = vi.hoisted(() => ({
  access: { userId: "user_1", isAgency: true, role: null, canManage: true } as
    { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean },
}));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => authFixture.access }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ tag: "request" }) }));

const dbMocks = vi.hoisted(() => ({
  serviceDb: vi.fn(() => ({ tag: "service" })),
  readAccountTimezone: vi.fn(),
  readHoursChain: vi.fn(),
  listClosedDaysFrom: vi.fn(),
  getBusinessStatusRow: vi.fn(),
  ensureBusinessStatusRow: vi.fn(),
  updateBusinessStatus: vi.fn(),
  listClosureAppointments: vi.fn(),
  bumpHeldForAccount: vi.fn(),
  deleteOpenClosureTask: vi.fn(),
  emit: vi.fn(),
  // closure-todo.ts's own dependencies (real closure-todo.ts, mocked only at the @bis/db layer, so the
  // dedupe semantics of ensureClosureTask are exercised for real through this stub, not bypassed).
  getAccountLanguage: vi.fn(),
  ensureClosureTask: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

import {
  setBusinessStatusAction, undoBusinessStatusAction, type UndoToken,
} from "./business-status-actions";
import type { BusinessStatusRow, ClosedDayRow, ClosureAppointment } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { untilFor } from "@/lib/business-status/status";
import type { StatusChange } from "@/lib/business-status/status";

const TZ = "America/Chicago";
const ACCOUNT = "acct_1";
const NOW = new Date("2027-06-07T15:00:00.000Z"); // Monday, 10:00 CDT

function row(partial: Partial<BusinessStatusRow>): BusinessStatusRow {
  return {
    account_id: ACCOUNT, state: "open", late_minutes: null, until: null,
    set_by: "user_1", set_at: "2027-06-01T00:00:00.000000+00:00", ...partial,
  };
}
const OPEN_ROW = null; // no row at all reads as open (D3)
const RUNNING_LATE_ROW = row({ state: "running_late", late_minutes: 30, until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z" });
const CLOSED_TODAY_ROW = row({ state: "closed_today", until: "2027-06-08T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z" });
const STORM_DATED_ROW = row({ state: "storm", until: "2027-06-10T05:00:00.000Z", set_at: "2027-06-07T14:00:00.000Z" });
const STORM_OPEN_ROW = row({ state: "storm", until: null, set_at: "2027-06-07T14:00:00.000Z" });
const CLOSED_DAY_TODAY: ClosedDayRow = {
  id: "cd_1", account_id: ACCOUNT, starts_on: "2027-06-07", ends_on: "2027-06-07",
  reason: "holiday", created_by: "user_1", created_at: "2027-06-01T00:00:00.000Z",
};

const CHANGE_OPEN: StatusChange = { state: "open" };
const CHANGE_CLOSED_TODAY: StatusChange = { state: "closed_today" };
const CHANGE_LATE_30: StatusChange = { state: "running_late", lateMinutes: 30 };
const CHANGE_STORM_DATED: StatusChange = { state: "storm", backOn: "2027-06-10" };
const CHANGE_STORM_OPEN: StatusChange = { state: "storm", backOn: null };

function setAccess(partial: Partial<typeof authFixture.access>) {
  authFixture.access = { ...authFixture.access, ...partial };
}

function resolvedUpdate(state: BusinessStatusRow["state"], lateMinutes: BusinessStatusRow["late_minutes"], until: string | null): BusinessStatusRow {
  return row({ state, late_minutes: lateMinutes, until, set_at: NOW.toISOString() });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  authFixture.access = { userId: "user_1", isAgency: true, role: null, canManage: true };
  for (const fn of Object.values(dbMocks)) if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  dbMocks.serviceDb.mockReturnValue({ tag: "service" });
  dbMocks.readAccountTimezone.mockResolvedValue(TZ);
  dbMocks.readHoursChain.mockResolvedValue({ businessHours: null, calendarHours: null });
  dbMocks.listClosedDaysFrom.mockResolvedValue([]);
  dbMocks.getBusinessStatusRow.mockResolvedValue(OPEN_ROW);
  dbMocks.ensureBusinessStatusRow.mockResolvedValue(undefined);
  dbMocks.updateBusinessStatus.mockImplementation(async (_db, _accountId, patch: { state: string; late_minutes: number | null; until: string | null }) =>
    resolvedUpdate(patch.state as BusinessStatusRow["state"], patch.late_minutes as BusinessStatusRow["late_minutes"], patch.until));
  dbMocks.listClosureAppointments.mockResolvedValue([]);
  dbMocks.bumpHeldForAccount.mockResolvedValue(0);
  dbMocks.deleteOpenClosureTask.mockResolvedValue(true);
  dbMocks.emit.mockResolvedValue(undefined);
  dbMocks.getAccountLanguage.mockResolvedValue(null);
  dbMocks.ensureClosureTask.mockResolvedValue({ id: "task_1", created: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("setBusinessStatusAction — Staff refused closing or reopening (spec §7)", () => {
  it.each([
    ["open", OPEN_ROW, CHANGE_CLOSED_TODAY],
    ["open", OPEN_ROW, CHANGE_STORM_DATED],
    ["running_late", RUNNING_LATE_ROW, CHANGE_CLOSED_TODAY],
    ["running_late", RUNNING_LATE_ROW, CHANGE_STORM_DATED],
  ] as const)("from %s, closing or storming is refused with the exact closeOrReopen sentence", async (_name, currentRow, change) => {
    setAccess({ isAgency: false, role: "staff", canManage: false });
    dbMocks.getBusinessStatusRow.mockResolvedValue(currentRow);
    const r = await setBusinessStatusAction(ACCOUNT, change, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.closeOrReopen", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["closed_today", CLOSED_TODAY_ROW],
    ["storm (dated)", STORM_DATED_ROW],
    ["storm (open-ended)", STORM_OPEN_ROW],
  ] as const)("while %s is in force, reopening or running late is refused too", async (_name, currentRow) => {
    setAccess({ isAgency: false, role: "staff", canManage: false });
    dbMocks.getBusinessStatusRow.mockResolvedValue(currentRow);
    for (const change of [CHANGE_OPEN, CHANGE_LATE_30]) {
      const r = await setBusinessStatusAction(ACCOUNT, change, "en");
      expect(r).toEqual({ ok: false, error: t(m, "business.refuse.closeOrReopen", "en") });
    }
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("while a closed day today is in force, reopening is refused too", async () => {
    setAccess({ isAgency: false, role: "staff", canManage: false });
    dbMocks.getBusinessStatusRow.mockResolvedValue(OPEN_ROW);
    dbMocks.listClosedDaysFrom.mockResolvedValue([CLOSED_DAY_TODAY]);
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_OPEN, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.closeOrReopen", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("the Spanish sentence, with locale: \"es\"", async () => {
    setAccess({ isAgency: false, role: "staff", canManage: false });
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "es");
    expect(r).toEqual({ ok: false, error: "Solo un propietario puede cerrar el negocio o volver a abrirlo." });
  });
});

describe("setBusinessStatusAction — a Technician refused with the role sentence", () => {
  it.each([
    [CHANGE_OPEN], [CHANGE_CLOSED_TODAY], [CHANGE_LATE_30], [CHANGE_STORM_DATED], [CHANGE_STORM_OPEN],
  ])("refuses %o", async (change) => {
    setAccess({ isAgency: false, role: "technician", canManage: false });
    const r = await setBusinessStatusAction(ACCOUNT, change, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.role", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("the Spanish sentence", async () => {
    setAccess({ isAgency: false, role: "technician", canManage: false });
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_OPEN, "es");
    expect(r).toEqual({ ok: false, error: "Solo un propietario puede cambiar esto." });
  });
});

describe("setBusinessStatusAction — invalid input fails closed, before any read (step 1)", () => {
  it("an unknown state", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "closed_forever" } as unknown as StatusChange, "en");
    expect(r.ok).toBe(false);
    expect(dbMocks.readAccountTimezone).not.toHaveBeenCalled();
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("running late with a lateMinutes outside {15,30,60,120}", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "running_late", lateMinutes: 45 } as unknown as StatusChange, "en");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("a storm backOn that is not a real calendar date", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "storm", backOn: "2027-02-30" }, "en");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("a storm backOn in the wrong shape", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "storm", backOn: "June 10" } as unknown as StatusChange, "en");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });
});

describe("setBusinessStatusAction — the storm date's range (step 4)", () => {
  it("today is refused: tomorrow is the earliest back-on date", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "storm", backOn: "2027-06-07" }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.storm.dateError", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("93 days out is refused: 92 is the latest", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, { state: "storm", backOn: "2027-09-08" }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.storm.dateError", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("tomorrow and 92 days out are both accepted (boundary)", async () => {
    for (const backOn of ["2027-06-08", "2027-09-07"]) {
      const r = await setBusinessStatusAction(ACCOUNT, { state: "storm", backOn }, "en");
      expect(r.ok).toBe(true);
    }
  });
});

describe("setBusinessStatusAction — the row (step 5)", () => {
  it("creates the row only when none exists yet", async () => {
    dbMocks.getBusinessStatusRow.mockResolvedValue(OPEN_ROW);
    await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(dbMocks.ensureBusinessStatusRow).toHaveBeenCalledWith({ tag: "service" }, ACCOUNT);
  });

  it("does not create a row that already exists", async () => {
    dbMocks.getBusinessStatusRow.mockResolvedValue(RUNNING_LATE_ROW);
    await setBusinessStatusAction(ACCOUNT, CHANGE_OPEN, "en");
    expect(dbMocks.ensureBusinessStatusRow).not.toHaveBeenCalled();
  });
});

describe("setBusinessStatusAction — until is untilFor's own answer, sent in the patch (step 6)", () => {
  it.each([
    ["open", CHANGE_OPEN],
    ["closed_today", CHANGE_CLOSED_TODAY],
    ["running_late 30", CHANGE_LATE_30],
    ["storm dated", CHANGE_STORM_DATED],
    ["storm open-ended", CHANGE_STORM_OPEN],
  ] as const)("%s", async (_name, change) => {
    const r = await setBusinessStatusAction(ACCOUNT, change, "en");
    expect(r.ok).toBe(true);
    const expectedUntil = untilFor(change, null, TZ, NOW);
    const lateMinutes = change.state === "running_late" ? change.lateMinutes : null;
    expect(dbMocks.updateBusinessStatus).toHaveBeenCalledWith({ tag: "request" }, ACCOUNT, {
      state: change.state, late_minutes: lateMinutes, until: expectedUntil === null ? null : expectedUntil.toISOString(),
    });
  });
});

describe("setBusinessStatusAction — failure paths (step 6)", () => {
  it("a compare-and-set / RLS null answers the role sentence", async () => {
    dbMocks.updateBusinessStatus.mockResolvedValue(null);
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.role", "en") });
  });

  it("any throw answers the generic failure, logged with ids only", async () => {
    dbMocks.updateBusinessStatus.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
      expect(r).toEqual({ ok: false, error: t(m, "business.toast.failed", "en") });
      expect(err.mock.calls.some(([line]) => String(line).includes(ACCOUNT))).toBe(true);
    } finally {
      err.mockRestore();
    }
  });
});

describe("setBusinessStatusAction — the bump runs on every success (step 9)", () => {
  it.each([[CHANGE_OPEN], [CHANGE_CLOSED_TODAY], [CHANGE_LATE_30], [CHANGE_STORM_DATED]])("%o", async (change) => {
    const r = await setBusinessStatusAction(ACCOUNT, change, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith({ tag: "service" }, ACCOUNT);
  });

  it("a bump failure is swallowed, never shown", async () => {
    dbMocks.bumpHeldForAccount.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await setBusinessStatusAction(ACCOUNT, CHANGE_OPEN, "en");
      expect(r.ok).toBe(true);
    } finally {
      err.mockRestore();
    }
  });
});

describe("setBusinessStatusAction — the To-do is filed only for a closure, only with an uncovered-no, not-kept appointment", () => {
  const COVERED_APPT: ClosureAppointment = {
    id: "bk_1", contact_id: "c_1", starts_at: "2027-06-07T20:00:00.000Z", ends_at: "2027-06-07T20:30:00.000Z",
    closure_kept_at: null, first_name: "Ana", last_name: "Cruz",
  };

  it("open and running late never file, even with an appointment present", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([COVERED_APPT]);
    for (const change of [CHANGE_OPEN, CHANGE_LATE_30]) {
      const r = await setBusinessStatusAction(ACCOUNT, change, "en");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.todoCount).toBe(0);
    }
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("closed_today with zero appointments files nothing", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([]);
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.todoCount).toBe(0);
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("closed_today with only an already-kept appointment files nothing", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([{ ...COVERED_APPT, closure_kept_at: "2027-06-07T15:30:00.000Z" }]);
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.todoCount).toBe(0);
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("closed_today with one covered, not-kept appointment files exactly one To-do", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([COVERED_APPT]);
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.todoCount).toBe(1);
      expect(r.undo.todoId).toBe("task_1");
    }
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.ensureClosureTask.mock.calls[0]![1]).toBe(ACCOUNT);
    expect(dbMocks.ensureClosureTask.mock.calls[0]![2]).toMatchObject({ kind: "status", on: "2027-06-07" });
  });
});

describe("setBusinessStatusAction — the widened S7 (orchestrator ruling, 2026-10-23)", () => {
  // Nobody booked Monday (the change day); one booking Wednesday 09:00 CDT, within a dated storm's window
  // (Monday through the back-on date) but OUTSIDE closed_today's window (which ends at tonight's midnight).
  const WED_APPT: ClosureAppointment = {
    id: "bk_wed", contact_id: "c_wed", starts_at: "2027-06-09T14:00:00.000Z", ends_at: "2027-06-09T14:30:00.000Z",
    closure_kept_at: null, first_name: "Wanda", last_name: "Mitt",
  };

  beforeEach(() => {
    // listClosureAppointments is a stub DB: it answers only the rows whose starts_at falls in the window
    // the caller actually asked for — the exact substitute a "today-only" bug would be caught by.
    dbMocks.listClosureAppointments.mockImplementation(async (_db: unknown, _accountId: string, fromIso: string, toIso: string) =>
      [WED_APPT].filter((a) => a.starts_at >= fromIso && a.starts_at < toIso));
  });

  it("a storm (backOn 2027-06-10) files exactly ONE To-do for the Wednesday booking", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_STORM_DATED, "en");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.todoCount).toBe(1);
      expect(r.undo.todoId).toBe("task_1");
    }
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.ensureClosureTask.mock.calls[0]![2]).toMatchObject({ kind: "status", on: "2027-06-07" });
  });

  it("closed_today files none: D12 makes its window only the rest of today, which excludes Wednesday", async () => {
    const r = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.todoCount).toBe(0);
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("a second change the same day (storm, then closed_today, then back to storm) files no SECOND To-do: the real dedupe (tasks_closure_once) answers created:false, so the Undo of the third change deletes nothing", async () => {
    // A tiny stateful stub of the real DB's one-per-(account, kind, on) constraint, so the mock's
    // created:false on the repeat is the REAL dedupe behaviour, not asserted by fiat.
    const filed = new Map<string, string>();
    let seq = 0;
    dbMocks.ensureClosureTask.mockImplementation(async (_db: unknown, _accountId: string, input: { kind: string; on: string }) => {
      const key = `${input.kind}:${input.on}`;
      const existing = filed.get(key);
      if (existing) return { id: existing, created: false };
      seq += 1;
      const id = `task_${seq}`;
      filed.set(key, id);
      return { id, created: true };
    });
    // getBusinessStatusRow/updateBusinessStatus form a tiny in-memory row, so each call sees the
    // PREVIOUS call's write, as the real table would.
    let stored: BusinessStatusRow | null = null;
    dbMocks.getBusinessStatusRow.mockImplementation(async () => stored);
    dbMocks.updateBusinessStatus.mockImplementation(async (_db: unknown, _accountId: string, patch: { state: string; late_minutes: number | null; until: string | null }) => {
      stored = resolvedUpdate(patch.state as BusinessStatusRow["state"], patch.late_minutes as BusinessStatusRow["late_minutes"], patch.until);
      return stored;
    });

    const r1 = await setBusinessStatusAction(ACCOUNT, CHANGE_STORM_DATED, "en");
    expect(r1.ok).toBe(true);
    if (r1.ok) { expect(r1.todoCount).toBe(1); expect(r1.undo.todoId).toBe("task_1"); }
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(1);

    const r2 = await setBusinessStatusAction(ACCOUNT, CHANGE_CLOSED_TODAY, "en");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.todoCount).toBe(0);
    // closed_today's window excludes Wednesday, so this leg never even attempts a second insert.
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(1);

    const r3 = await setBusinessStatusAction(ACCOUNT, CHANGE_STORM_DATED, "en");
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.todoCount).toBe(1); // the Wednesday booking is covered again
      expect(r3.undo.todoId).toBeNull(); // created:false on the repeat
    }
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(2);

    // Undo of the third change deletes nothing: its own todoId is null.
    if (r3.ok) {
      await undoBusinessStatusAction(ACCOUNT, r3.undo, "en");
    }
    expect(dbMocks.deleteOpenClosureTask).not.toHaveBeenCalled();
  });
});

describe("setBusinessStatusAction — every @bis/db call carries the route's own accountId", () => {
  it("acct_2, not a hardcoded acct_1", async () => {
    const r = await setBusinessStatusAction("acct_2", CHANGE_CLOSED_TODAY, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.readAccountTimezone.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.readHoursChain.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.listClosedDaysFrom.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.getBusinessStatusRow.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.updateBusinessStatus.mock.calls[0]![1]).toBe("acct_2");
    // CHANGE_CLOSED_TODAY reaches fileIfAffected, which always calls listClosureAppointments
    // regardless of whether any row comes back — this is the call the review found unchecked.
    expect(dbMocks.listClosureAppointments).toHaveBeenCalled();
    expect(dbMocks.listClosureAppointments.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.bumpHeldForAccount.mock.calls[0]![1]).toBe("acct_2");
  });
});

describe("undoBusinessStatusAction", () => {
  function tokenFor(before: UndoToken["before"], expectedSetAt = "2027-06-01T12:00:00.123456+00:00", todoId: string | null = null): UndoToken {
    return { expectedSetAt, before, todoId };
  }

  it("before is open for an expired stored closure (spec §5.2)", async () => {
    const expiredBefore = { state: "closed_today" as const, late_minutes: null, until: "2027-06-07T10:00:00.000Z" }; // already past NOW
    dbMocks.getBusinessStatusRow.mockResolvedValue(OPEN_ROW);
    const r = await undoBusinessStatusAction(ACCOUNT, tokenFor(expiredBefore), "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.updateBusinessStatus).toHaveBeenCalledWith(
      { tag: "request" }, ACCOUNT, { state: "open", late_minutes: null, until: null }, { expectedSetAt: expect.any(String) },
    );
  });

  it("expectedSetAt is passed verbatim (SD14): the microsecond fixture arrives unchanged", async () => {
    const before = { state: "open" as const, late_minutes: null, until: null };
    await undoBusinessStatusAction(ACCOUNT, tokenFor(before, "2027-06-01T12:00:00.123456+00:00"), "en");
    const call = dbMocks.updateBusinessStatus.mock.calls[0]!;
    expect((call[3] as { expectedSetAt: string }).expectedSetAt).toBe("2027-06-01T12:00:00.123456+00:00");
  });

  it("a lost compare-and-set answers changedSince, and deletes the To-do only with the filed id", async () => {
    dbMocks.updateBusinessStatus.mockResolvedValue(null);
    const before = { state: "open" as const, late_minutes: null, until: null };
    const r = await undoBusinessStatusAction(ACCOUNT, tokenFor(before, "2027-06-01T12:00:00.123456+00:00", "task_9"), "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.toast.changedSince", "en") });
    expect(dbMocks.deleteOpenClosureTask).not.toHaveBeenCalled();
  });

  it("a winning undo with a todoId deletes exactly that task", async () => {
    const before = { state: "open" as const, late_minutes: null, until: null };
    await undoBusinessStatusAction(ACCOUNT, tokenFor(before, "2027-06-01T12:00:00.123456+00:00", "task_9"), "en");
    expect(dbMocks.deleteOpenClosureTask).toHaveBeenCalledWith({ tag: "service" }, ACCOUNT, "task_9");
  });

  it("the guard runs on the undo's own change (a Staff undo back into a closure is refused)", async () => {
    setAccess({ isAgency: false, role: "staff", canManage: false });
    dbMocks.getBusinessStatusRow.mockResolvedValue(OPEN_ROW); // currently open
    const before = { state: "closed_today" as const, late_minutes: null, until: "2027-06-08T05:00:00.000Z" };
    const r = await undoBusinessStatusAction(ACCOUNT, tokenFor(before), "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.closeOrReopen", "en") });
    expect(dbMocks.updateBusinessStatus).not.toHaveBeenCalled();
  });

  it("every @bis/db call carries the route's own accountId", async () => {
    const before = { state: "open" as const, late_minutes: null, until: null };
    await undoBusinessStatusAction("acct_2", tokenFor(before, "2027-06-01T12:00:00.123456+00:00", "task_9"), "en");
    expect(dbMocks.getBusinessStatusRow.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.updateBusinessStatus.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.deleteOpenClosureTask.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.bumpHeldForAccount.mock.calls[0]![1]).toBe("acct_2");
  });
});
