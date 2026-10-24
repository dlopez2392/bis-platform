import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const access = vi.hoisted(() => ({
  value: { userId: "user_1", isAgency: true, role: null, canManage: true } as
    { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean },
}));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => access.value }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({ tag: "request" }) }));

const dbMocks = vi.hoisted(() => ({
  serviceDb: vi.fn(() => ({ tag: "service" })),
  readAccountTimezone: vi.fn(),
  listClosedDaysFrom: vi.fn(),
  insertClosedDay: vi.fn(),
  deleteClosedDay: vi.fn(),
  listClosureAppointments: vi.fn(),
  bumpHeldForAccount: vi.fn(),
  emit: vi.fn(),
  getAccountLanguage: vi.fn(),
  ensureClosureTask: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

import { addClosedDayAction, removeClosedDayAction } from "./closed-days-actions";
import type { ClosedDayRow, ClosureAppointment } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

const TZ = "America/Chicago";
const ACCOUNT = "acct_1";
const NOW = new Date("2027-06-07T15:00:00.000Z"); // Monday, 10:00 CDT; "today" = 2027-06-07

function closedDayRow(partial: Partial<ClosedDayRow>): ClosedDayRow {
  return {
    id: "cd_1", account_id: ACCOUNT, starts_on: "2027-06-07", ends_on: "2027-06-07",
    reason: null, created_by: "user_1", created_at: "2027-06-01T00:00:00.000Z", ...partial,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  access.value = { userId: "user_1", isAgency: true, role: null, canManage: true };
  for (const fn of Object.values(dbMocks)) if (typeof fn === "function" && "mockReset" in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  dbMocks.serviceDb.mockReturnValue({ tag: "service" });
  dbMocks.readAccountTimezone.mockResolvedValue(TZ);
  dbMocks.listClosedDaysFrom.mockResolvedValue([]);
  dbMocks.insertClosedDay.mockImplementation(async (_db: unknown, accountId: string, input: { starts_on: string; ends_on: string; reason: string | null }) =>
    closedDayRow({ account_id: accountId, starts_on: input.starts_on, ends_on: input.ends_on, reason: input.reason as ClosedDayRow["reason"] }));
  dbMocks.deleteClosedDay.mockResolvedValue(closedDayRow({}));
  dbMocks.listClosureAppointments.mockResolvedValue([]);
  dbMocks.bumpHeldForAccount.mockResolvedValue(0);
  dbMocks.emit.mockResolvedValue(undefined);
  dbMocks.getAccountLanguage.mockResolvedValue(null);
  dbMocks.ensureClosureTask.mockResolvedValue({ id: "task_1", created: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("addClosedDayAction — Staff refused (D1, unchanged by D8)", () => {
  it("refuses before any write", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.role", "en") });
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();
  });

  it("the Spanish sentence", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "es");
    expect(r).toEqual({ ok: false, error: "Solo un propietario puede cambiar los días cerrados." });
  });
});

describe("addClosedDayAction — each validation sentence", () => {
  it("the first day can't be in the past", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-06", to: null, reason: null }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.error.past", "en") });
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();
  });

  it("today itself is accepted (not \"past\")", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-07", to: null, reason: null }, "en");
    expect(r.ok).toBe(true);
  });

  it("the last day must be on or after the first", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-09", reason: null }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.error.endBeforeStart", "en") });
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();
  });

  it("at most 92 days at a time (91 nights, the DB's own bound)", async () => {
    const tooLong = await addClosedDayAction(ACCOUNT, { from: "2027-06-08", to: "2027-09-09", reason: null }, "en"); // 93 nights
    expect(tooLong).toEqual({ ok: false, error: t(m, "closedDays.error.tooLong", "en") });
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();

    const atBound = await addClosedDayAction(ACCOUNT, { from: "2027-06-08", to: "2027-09-07", reason: null }, "en"); // 91 nights
    expect(atBound.ok).toBe(true);
  });

  it("must end within the next 12 months, even for a SHORT range far out", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2028-06-13", to: "2028-06-14", reason: null }, "en"); // 1 night, but > +365 days
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.error.tooFar", "en") });
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();
  });

  it("overlap with an already-listed range, formatted as the card formats a range", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([closedDayRow({ starts_on: "2027-06-12", ends_on: "2027-06-14" })]);
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-13", to: "2027-06-20", reason: null }, "en");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(t(m, "closedDays.error.overlap", "en", { range: "June 12 – 14" }));
    expect(dbMocks.insertClosedDay).not.toHaveBeenCalled();
  });

  it("a non-overlapping range (back to back) is accepted", async () => {
    dbMocks.listClosedDaysFrom.mockResolvedValue([closedDayRow({ starts_on: "2027-06-10", ends_on: "2027-06-12" })]);
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-13", to: "2027-06-15", reason: null }, "en");
    expect(r.ok).toBe(true);
  });
});

describe("addClosedDayAction — restore relaxes the past check to yesterday (the trigger's own slack)", () => {
  it("yesterday is refused without restore", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-06", to: null, reason: null }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.error.past", "en") });
  });

  it("yesterday is accepted with restore: true", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-06", to: null, reason: null, restore: true }, "en");
    expect(r.ok).toBe(true);
  });

  it("two days ago is still refused even with restore: true", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-05", to: null, reason: null, restore: true }, "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.error.past", "en") });
  });
});

describe("addClosedDayAction — the write and its failures", () => {
  it("inserts the four columns and answers the stored id", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: "vacation" }, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.insertClosedDay).toHaveBeenCalledWith(
      { tag: "request" }, ACCOUNT, { starts_on: "2027-06-10", ends_on: "2027-06-12", reason: "vacation" },
    );
    if (r.ok) expect(r.id).toBe("cd_1");
  });

  it("a single day (to: null) stores starts_on === ends_on", async () => {
    await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "en");
    expect(dbMocks.insertClosedDay).toHaveBeenCalledWith(
      { tag: "request" }, ACCOUNT, { starts_on: "2027-06-10", ends_on: "2027-06-10", reason: null },
    );
  });

  it("23514 (the DB's own shape/range check) answers saveFailed", async () => {
    dbMocks.insertClosedDay.mockRejectedValue(Object.assign(new Error("range"), { code: "23514" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "en");
      expect(r).toEqual({ ok: false, error: t(m, "closedDays.saveFailed", "en") });
    } finally {
      err.mockRestore();
    }
  });

  it("42501 (RLS) answers the role sentence", async () => {
    dbMocks.insertClosedDay.mockRejectedValue(Object.assign(new Error("rls"), { code: "42501" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "en");
      expect(r).toEqual({ ok: false, error: t(m, "closedDays.role", "en") });
    } finally {
      err.mockRestore();
    }
  });

  it("the event closed_day.added is emitted with the stored row's own fields", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: "vacation" }, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.emit).toHaveBeenCalledWith(
      { tag: "request" }, ACCOUNT, "closed_day.added", "user_1",
      { id: "cd_1", starts_on: "2027-06-10", ends_on: "2027-06-12", reason: "vacation" }, "user",
    );
  });

  it("the bump runs on every success", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: null, reason: null }, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith({ tag: "service" }, ACCOUNT);
  });
});

describe("addClosedDayAction — the closure To-do (kind: closed_day)", () => {
  const APPT: ClosureAppointment = {
    id: "bk_1", contact_id: "c_1", starts_at: "2027-06-11T15:00:00.000Z", ends_at: "2027-06-11T15:30:00.000Z",
    closure_kept_at: null, first_name: "Ana", last_name: "Cruz",
  };

  it("no appointments in the range: appointments 0, todoFiled false, nothing filed", async () => {
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: null }, "en");
    expect(r).toMatchObject({ ok: true, appointments: 0, todoFiled: false });
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("an already-kept appointment is not counted and files nothing", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([{ ...APPT, closure_kept_at: "2027-06-07T15:30:00.000Z" }]);
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: null }, "en");
    expect(r).toMatchObject({ ok: true, appointments: 0, todoFiled: false });
    expect(dbMocks.ensureClosureTask).not.toHaveBeenCalled();
  });

  it("one not-kept appointment in the range files the To-do, kind closed_day, on the range's start", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([APPT]);
    const r = await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: null }, "en");
    expect(r).toMatchObject({ ok: true, appointments: 1, todoFiled: true });
    expect(dbMocks.ensureClosureTask).toHaveBeenCalledTimes(1);
    expect(dbMocks.ensureClosureTask.mock.calls[0]![2]).toMatchObject({ kind: "closed_day", on: "2027-06-10" });
  });

  it("the appointment window is [starts_on 00:00, ends_on + 1 day 00:00) in the account's zone", async () => {
    dbMocks.listClosureAppointments.mockResolvedValue([]);
    await addClosedDayAction(ACCOUNT, { from: "2027-06-10", to: "2027-06-12", reason: null }, "en");
    const [, , fromIso, toIso] = dbMocks.listClosureAppointments.mock.calls[0]!;
    expect(fromIso).toBe("2027-06-10T05:00:00.000Z"); // 00:00 CDT June 10
    expect(toIso).toBe("2027-06-13T05:00:00.000Z"); // 00:00 CDT June 13 (ends_on + 1 day)
  });
});

describe("addClosedDayAction — every @bis/db call carries the route's own accountId", () => {
  it("acct_2, not a hardcoded acct_1", async () => {
    const r = await addClosedDayAction("acct_2", { from: "2027-06-10", to: null, reason: null }, "en");
    expect(r.ok).toBe(true);
    expect(dbMocks.readAccountTimezone.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.listClosedDaysFrom.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.insertClosedDay.mock.calls[0]![1]).toBe("acct_2");
    // addClosedDayAction always calls listClosureAppointments (not gated on any prior count) — this
    // is the call the review found unchecked.
    expect(dbMocks.listClosureAppointments).toHaveBeenCalled();
    expect(dbMocks.listClosureAppointments.mock.calls[0]![1]).toBe("acct_2");
    expect(dbMocks.bumpHeldForAccount.mock.calls[0]![1]).toBe("acct_2");
  });
});

describe("removeClosedDayAction", () => {
  it("Staff is refused before any write", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "staff", canManage: false };
    const r = await removeClosedDayAction(ACCOUNT, "cd_1", "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.role", "en") });
    expect(dbMocks.deleteClosedDay).not.toHaveBeenCalled();
  });

  it("a removal nothing matched answers saveFailed", async () => {
    dbMocks.deleteClosedDay.mockResolvedValue(null);
    const r = await removeClosedDayAction(ACCOUNT, "cd_missing", "en");
    expect(r).toEqual({ ok: false, error: t(m, "closedDays.saveFailed", "en") });
  });

  it("a winning removal answers the removed range, for the UI's Undo", async () => {
    dbMocks.deleteClosedDay.mockResolvedValue(closedDayRow({ starts_on: "2027-06-10", ends_on: "2027-06-12", reason: "holiday" }));
    const r = await removeClosedDayAction(ACCOUNT, "cd_1", "en");
    expect(r).toEqual({ ok: true, removed: { from: "2027-06-10", to: "2027-06-12", reason: "holiday" } });
  });

  it("emits closed_day.removed with the removed row's own fields", async () => {
    dbMocks.deleteClosedDay.mockResolvedValue(closedDayRow({ starts_on: "2027-06-10", ends_on: "2027-06-12", reason: "holiday" }));
    await removeClosedDayAction(ACCOUNT, "cd_1", "en");
    expect(dbMocks.emit).toHaveBeenCalledWith(
      { tag: "request" }, ACCOUNT, "closed_day.removed", "user_1",
      { id: "cd_1", starts_on: "2027-06-10", ends_on: "2027-06-12", reason: "holiday" }, "user",
    );
  });

  it("the bump runs on a winning removal", async () => {
    await removeClosedDayAction(ACCOUNT, "cd_1", "en");
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith({ tag: "service" }, ACCOUNT);
  });

  it("deletes scoped to the route's own accountId and the given id", async () => {
    await removeClosedDayAction("acct_2", "cd_1", "en");
    expect(dbMocks.deleteClosedDay).toHaveBeenCalledWith({ tag: "request" }, "acct_2", "cd_1");
  });
});
