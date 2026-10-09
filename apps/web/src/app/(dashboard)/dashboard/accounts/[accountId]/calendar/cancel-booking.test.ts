import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { runCancelWithUndo } from "./cancel-booking";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";

/**
 * D-036: Cancel on the Calendar page ran at once with no way back (rule 6
 * asks for an Undo on a reversible action). This is the pure sequencing
 * behind the button, minus React, the same split `lib/branding/remove-logo.ts`
 * uses for the Branding card's Remove-logo.
 *
 * F-048: the cancel can now carry a customer notice, sent once the Undo
 * window has closed. The toast says which, lives exactly that window, and
 * hands the cancel's version back to the Undo.
 */
function fakeToast() {
  let undo: (() => void) | null = null;
  return {
    toast: {
      success: vi.fn((_msg: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => {
        undo = opts?.action?.onClick ?? null;
        return "toast_1";
      }),
      error: vi.fn(),
      dismiss: vi.fn(),
    },
    clickUndo: () => undo?.(),
  };
}

/** A schedule that records what it was asked to run, and when. */
function fakeSchedule() {
  const jobs: { fn: () => void; ms: number }[] = [];
  return { schedule: (fn: () => void, ms: number) => { jobs.push({ fn, ms }); }, jobs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const VERSION = "2026-10-09T18:00:00.123Z";
const cancelled = (noticeScheduled = false) => async () => ({ ok: true as const, version: VERSION, noticeScheduled });

describe("runCancelWithUndo — Cancel runs at once and the toast carries Undo (D-036, F-048)", () => {
  it("cancels, then toasts with an Undo action that lives exactly the Undo window (mutation: drop the action → FAILS)", async () => {
    const { toast } = fakeToast();
    const cancel = vi.fn(cancelled());
    const undo = vi.fn(async () => ({ ok: true as const }));
    expect(await runCancelWithUndo(cancel, undo, toast, fakeSchedule().schedule)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      m["calendar.bookings.cancelledToast"],
      { action: { label: m["common.undo"], onClick: expect.any(Function) }, duration: UNDO_WINDOW_MS },
    );
  });

  it("closes its own toast when the window ends, even if the pointer is resting on it, so Undo is never offered after the notice could go (mutation: drop the dismiss → FAILS)", async () => {
    const { toast } = fakeToast();
    const { schedule, jobs } = fakeSchedule();
    await runCancelWithUndo(cancelled(true), async () => ({ ok: true }), toast, schedule);
    expect(jobs.map((j) => j.ms)).toEqual([UNDO_WINDOW_MS]);
    // The server waits longer than the toast lives, so a click in the toast's
    // last instant still reaches the server first (mutation: a zero grace → FAILS).
    expect(NOTICE_GRACE_MS).toBeGreaterThan(0);
    expect(toast.dismiss).not.toHaveBeenCalled();
    jobs[0]!.fn();
    expect(toast.dismiss).toHaveBeenCalledWith("toast_1");
  });

  it("says the customer will be emailed when the notice is scheduled, and that they have NOT been told when it is not (mutation: always the old toast → FAILS)", async () => {
    const a = fakeToast();
    await runCancelWithUndo(cancelled(true), async () => ({ ok: true }), a.toast, fakeSchedule().schedule);
    expect(a.toast.success.mock.calls[0]![0]).toBe(m["calendar.bookings.cancelledToastNotice"]);
    const b = fakeToast();
    await runCancelWithUndo(cancelled(false), async () => ({ ok: true }), b.toast, fakeSchedule().schedule);
    expect(b.toast.success.mock.calls[0]![0]).toBe(m["calendar.bookings.cancelledToast"]);
  });

  it("Undo hands the cancel's own version back and says the appointment is back (mutation: undo without the version → FAILS)", async () => {
    const { toast, clickUndo } = fakeToast();
    const undo = vi.fn<(version: string) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    await runCancelWithUndo(cancelled(true), undo, toast, fakeSchedule().schedule);
    clickUndo();
    await flush();
    expect(undo).toHaveBeenCalledWith(VERSION);
    expect(toast.success).toHaveBeenLastCalledWith(m["calendar.bookings.restored"]);
  });

  it("an Undo the server refuses shows the server's own words", async () => {
    const { toast, clickUndo } = fakeToast();
    await runCancelWithUndo(
      cancelled(true),
      async () => ({ ok: false, error: m["calendar.bookings.restoreCustomerTold"] }),
      toast, fakeSchedule().schedule,
    );
    clickUndo();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["calendar.bookings.restoreCustomerTold"]);
  });

  it("an Undo that throws (a stale tab's server action) still reaches the operator", async () => {
    const { toast, clickUndo } = fakeToast();
    await runCancelWithUndo(cancelled(), async () => { throw new Error("stale"); }, toast, fakeSchedule().schedule);
    clickUndo();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });

  it("a refused cancel shows its error and offers no Undo and schedules nothing", async () => {
    const { toast } = fakeToast();
    const { schedule, jobs } = fakeSchedule();
    const r = await runCancelWithUndo(
      async () => ({ ok: false as const, error: "nope" }), async () => ({ ok: true }), toast, schedule,
    );
    expect(r).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("nope");
    expect(toast.success).not.toHaveBeenCalled();
    expect(jobs).toEqual([]);
  });

  it("a cancel that throws is the generic crash line", async () => {
    const { toast } = fakeToast();
    const r = await runCancelWithUndo(async () => { throw new Error("x"); }, async () => ({ ok: true }), toast, fakeSchedule().schedule);
    expect(r).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });

  /**
   * Without a notice the cancel still tells nobody: an operator who assumes
   * the customer was emailed leaves them driving to a cancelled appointment,
   * so that toast says so; the notice toast says the opposite, and when.
   */
  it("the two toasts say opposite things about the customer, in words", () => {
    expect(m["calendar.bookings.cancelledToast"]).toMatch(/haven't told/i);
    expect(m["calendar.bookings.cancelledToastNotice"]).toMatch(/email the customer/i);
    expect(m["calendar.bookings.cancelledToastNotice"]).toMatch(/undo/i);
  });
});
