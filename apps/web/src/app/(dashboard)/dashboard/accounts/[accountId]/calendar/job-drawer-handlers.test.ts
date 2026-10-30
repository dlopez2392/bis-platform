import { describe, expect, it, vi } from "vitest";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { agendaTime } from "@/lib/booking/agenda-window";
import {
  cancelFromDrawer, closeOut, drawerActions, emailLine, meetingWord, focusJobRow, movePrefill, moveJob, JOB_STATUS_TREATMENTS, type DrawerCancelView,
} from "./job-drawer-handlers";

/**
 * F-046 part 1 (plan Task 11): what the job drawer's buttons DO, minus React. The one rule that matters most:
 * Cancel on an ADD still inside its hold is the add's Undo (D7: a customer who never heard of the job gets no
 * "cancelled" notice); a held MOVE goes straight to the ordinary cancel (plan review item 3), and an add whose
 * Undo answers `fallback` does too.
 */

const ACCOUNT = "acct_1";
const TZ = "America/Chicago";
const view = (over: Partial<DrawerCancelView> = {}): DrawerCancelView => ({
  id: "b_1", holdOpen: false, isMove: false, customer: { first: "Ana" }, ...over,
});
function toast() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("cancelFromDrawer (D7, plan review item 3)", () => {
  it("an ADD inside its hold calls the add's Undo, never the ordinary cancel, and says the customer wasn't told (mutation: always the ordinary cancel -> FAILS)", async () => {
    const undoAdd = vi.fn(async () => ({ ok: true as const }));
    const ordinary = vi.fn(async () => {});
    const tst = toast();
    expect(await cancelFromDrawer({ accountId: ACCOUNT, view: view({ holdOpen: true }), locale: "en", toast: tst, undoAdd, ordinary })).toBe("undone");
    expect(undoAdd).toHaveBeenCalledWith(ACCOUNT, "b_1");
    expect(ordinary).not.toHaveBeenCalled();
    expect(tst.success).toHaveBeenCalledWith(t(m, "calendar.job.undone", "en", { first: "Ana" }));
  });

  it("a held MOVE goes straight to the ordinary cancel and never to the add's Undo (mutation: route it to undoAddJobAction -> the server answers is_move, and this test still asserts the ordinary flow ran without it, FAILS)", async () => {
    const undoAdd = vi.fn(async () => ({ ok: false as const, errorKey: "calendar.bookings.statusUpdateFailed" as const, fallback: true as const }));
    const ordinary = vi.fn(async () => {});
    expect(await cancelFromDrawer({ accountId: ACCOUNT, view: view({ holdOpen: true, isMove: true }), locale: "en", toast: toast(), undoAdd, ordinary })).toBe("ordinary");
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(undoAdd).not.toHaveBeenCalled();
  });

  it("an add's Undo that answers fallback (its hold settled first) runs the ordinary cancel, with no error toast (mutation: toast the refusal and stop -> FAILS)", async () => {
    const tst = toast();
    const ordinary = vi.fn(async () => {});
    const r = await cancelFromDrawer({
      accountId: ACCOUNT, view: view({ holdOpen: true }), locale: "en", toast: tst, ordinary,
      undoAdd: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.undoTooLate" as const, fallback: true as const })),
    });
    expect(r).toBe("ordinary");
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(tst.error).not.toHaveBeenCalled();
  });

  it("an add's Undo refused WITHOUT fallback toasts its sentence and cancels nothing", async () => {
    const tst = toast();
    const ordinary = vi.fn(async () => {});
    const r = await cancelFromDrawer({
      accountId: ACCOUNT, view: view({ holdOpen: true }), locale: "es", toast: tst, ordinary,
      undoAdd: vi.fn(async () => ({ ok: false as const, errorKey: "calendar.job.undoMovedSince" as const })),
    });
    expect(r).toBe("refused");
    expect(ordinary).not.toHaveBeenCalled();
    expect(tst.error).toHaveBeenCalledWith(m["calendar.job.undoMovedSince.es"]);
  });

  it("a job with no open hold runs the ordinary cancel directly", async () => {
    const undoAdd = vi.fn();
    const ordinary = vi.fn(async () => {});
    expect(await cancelFromDrawer({ accountId: ACCOUNT, view: view(), locale: "en", toast: toast(), undoAdd, ordinary })).toBe("ordinary");
    expect(undoAdd).not.toHaveBeenCalled();
  });

  it("an Undo that throws says so and cancels nothing", async () => {
    const tst = toast();
    const ordinary = vi.fn(async () => {});
    const r = await cancelFromDrawer({ accountId: ACCOUNT, view: view({ holdOpen: true }), locale: "en", toast: tst, ordinary, undoAdd: vi.fn(async () => { throw new Error("x"); }) });
    expect(r).toBe("refused");
    expect(tst.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
    expect(ordinary).not.toHaveBeenCalled();
  });
});

describe("closeOut (D-030; Technicians keep it, owner decision 1)", () => {
  it("calls setBookingStatusAction(accountId, bookingId, status) and says the booking was updated in the drawer's language", async () => {
    const tst = toast();
    const setStatus = vi.fn(async () => ({ ok: true as const }));
    expect(await closeOut({ accountId: ACCOUNT, bookingId: "b_1", status: "no_show", setStatus, toast: tst, locale: "es" })).toBe(true);
    expect(setStatus).toHaveBeenCalledWith(ACCOUNT, "b_1", "no_show");
    expect(tst.success).toHaveBeenCalledWith(m["calendar.bookings.statusUpdated.es"]);
  });
  it("a refusal toasts the server's sentence", async () => {
    const tst = toast();
    expect(await closeOut({ accountId: ACCOUNT, bookingId: "b_1", status: "completed", setStatus: vi.fn(async () => ({ ok: false as const, error: "Nope." })), toast: tst, locale: "en" })).toBe(false);
    expect(tst.error).toHaveBeenCalledWith("Nope.");
  });
});

describe("drawerActions: which equal ghost buttons the drawer offers (spec 5.5, 8.1)", () => {
  const base = { status: "booked" as const, canWrite: true, canCloseOut: true, started: false };
  it("a booked job not yet started: Move and Cancel, no outcomes (mutation: drop the started check -> FAILS)", () => {
    expect(drawerActions(base)).toEqual({ move: true, cancel: true, closeOut: false });
  });
  it("once started: the outcomes too", () => {
    expect(drawerActions({ ...base, started: true })).toEqual({ move: true, cancel: true, closeOut: true });
  });
  it("a Technician: outcomes only, never Move or Cancel (mutation: ignore canWrite -> FAILS)", () => {
    expect(drawerActions({ ...base, canWrite: false, started: true })).toEqual({ move: false, cancel: false, closeOut: true });
  });
  it("a cancelled or closed job offers nothing", () => {
    for (const status of ["cancelled", "completed", "no_show"] as const) {
      expect(drawerActions({ ...base, status, started: true })).toEqual({ move: false, cancel: false, closeOut: false });
    }
  });
});

describe("the drawer's words", () => {
  it("emailLine: the confirmation trio, and the moved trio when the email is a move's (mutation: ignore kind -> FAILS)", () => {
    const at = "2026-11-01T14:42:00.000Z";
    expect(emailLine({ state: "sent", kind: "confirmation", at }, TZ, "en")).toBe(t(m, "calendar.job.emailSent", "en", { time: agendaTime(new Date(at), TZ, "en", false) }));
    expect(emailLine({ state: "pending", kind: "confirmation", at: null }, TZ, "en")).toBe(m["calendar.job.emailPending"]);
    expect(emailLine({ state: "failed", kind: "confirmation", at: null }, TZ, "es")).toBe(m["calendar.job.emailFailed.es"]);
    expect(emailLine({ state: "sent", kind: "moved", at }, TZ, "es")).toBe(t(m, "calendar.job.movedEmailSent", "es", { time: agendaTime(new Date(at), TZ, "es", false) }));
    expect(emailLine({ state: "pending", kind: "moved", at: null }, TZ, "en")).toBe(m["calendar.job.movedEmailPending"]);
    expect(emailLine({ state: "failed", kind: "moved", at: null }, TZ, "en")).toBe(m["calendar.job.movedEmailFailed"]);
    expect(emailLine({ state: "none", kind: null, at: null }, TZ, "en")).toBeNull();
  });
  it("meetingWord names the three kinds in both languages", () => {
    expect(meetingWord("in_person", "en")).toBe(m["calendar.job.inPerson"]);
    expect(meetingWord("phone", "es")).toBe(m["calendar.job.byPhone.es"]);
    expect(meetingWord("video", "en")).toBe(m["calendar.job.byVideo"]);
  });
  it("movePrefill: Move opens on the job's own day and start IN THE ACCOUNT'S ZONE, its length, details, and the email tick from `told` (spec 5.4 item 7; mutation: UTC parts -> FAILS)", () => {
    const opened = { startsAt: "2026-11-03T16:05:00.000Z", endsAt: "2026-11-03T17:35:00.000Z", note: "Leak", placeId: "p1", meetingType: null, meetingUrl: null };
    expect(movePrefill({
      customer: { id: "c1", name: "Ana García", first: "Ana" }, what: "Leak", meetingType: "phone", opened, told: true,
    }, TZ)).toEqual({
      date: "2026-11-03", start: "10:05", minutes: 90, customer: { id: "c1", name: "Ana García", first: "Ana" },
      what: "Leak", placeId: "p1", meetingType: "phone", notify: true,
    });
    // Late evening in Chicago is the next day in UTC: the day is the account's.
    const late = { ...opened, startsAt: "2026-11-04T04:30:00.000Z", endsAt: "2026-11-04T05:00:00.000Z" };
    expect(movePrefill({ customer: { id: "c1", name: "A", first: "A" }, what: null, meetingType: "in_person", opened: late, told: false }, TZ))
      .toMatchObject({ date: "2026-11-03", start: "22:30", minutes: 30, what: "", notify: false });
  });
  it("moveJob: the job and what Move opened with, including whether the customer had been told THEN (T10 review I2; mutation: drop told -> FAILS)", () => {
    const opened = { startsAt: "2026-11-03T16:05:00.000Z", endsAt: "2026-11-03T17:35:00.000Z", note: "Leak", placeId: null, meetingType: null, meetingUrl: null };
    expect(moveJob({ id: "b_1", opened, told: false })).toEqual({ id: "b_1", opened: { ...opened, told: false } });
    expect(moveJob({ id: "b_1", opened, told: true }).opened.told).toBe(true);
  });
  it("JOB_STATUS_TREATMENTS: a dot and a word per status, never colour alone, and no --warn or --crit (spec 5.6 reserves them for overlap and closed)", () => {
    for (const s of ["booked", "cancelled", "completed", "no_show"] as const) {
      const tr = JOB_STATUS_TREATMENTS[s];
      expect(tr.dot).toMatch(/^bg-/);
      expect(`${tr.dot} ${tr.chip}`).not.toMatch(/--warn|--crit|destructive/);
    }
  });
  it("focusJobRow gives focus back to the job's own row, #booking-<id>, and stops Radix focusing nothing", () => {
    const row = { focus: vi.fn() };
    const preventDefault = vi.fn();
    const doc = { getElementById: vi.fn((id: string) => (id === "booking-b_1" ? row : null)) };
    focusJobRow({ preventDefault }, "b_1", doc);
    expect(preventDefault).toHaveBeenCalled();
    expect(row.focus).toHaveBeenCalled();
    focusJobRow({ preventDefault }, "b_gone", doc);
    expect(row.focus).toHaveBeenCalledTimes(1);
  });
});
