import { describe, it, expect, vi } from "vitest";
import { m } from "@/lib/messages";
import { runCancelWithUndo } from "./cancel-booking";

/**
 * D-036: Cancel on the Calendar page ran at once with no way back (rule 6
 * asks for an Undo on a reversible action). This is the pure sequencing
 * behind the button, minus React, the same split `lib/branding/remove-logo.ts`
 * uses for the Branding card's Remove-logo.
 */
function fakeToast() {
  let undo: (() => void) | null = null;
  return {
    toast: {
      success: vi.fn((_msg: string, opts?: { action: { label: string; onClick: () => void } }) => {
        undo = opts?.action.onClick ?? null;
      }),
      error: vi.fn(),
    },
    clickUndo: () => undo?.(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runCancelWithUndo — Cancel runs at once and the toast carries Undo (D-036)", () => {
  it("cancels, then toasts with an Undo action (mutation: drop the action → FAILS)", async () => {
    const { toast } = fakeToast();
    const cancel = vi.fn(async () => ({ ok: true as const }));
    const undo = vi.fn(async () => ({ ok: true as const }));
    expect(await runCancelWithUndo(cancel, undo, toast)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      m["calendar.bookings.cancelledToast"],
      { action: { label: m["common.undo"], onClick: expect.any(Function) } },
    );
  });

  it("Undo calls the un-cancel and says the appointment is back", async () => {
    const { toast, clickUndo } = fakeToast();
    const undo = vi.fn(async () => ({ ok: true as const }));
    await runCancelWithUndo(async () => ({ ok: true }), undo, toast);
    clickUndo();
    await flush();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenLastCalledWith(m["calendar.bookings.restored"]);
  });

  it("an Undo the server refuses shows the server's own words", async () => {
    const { toast, clickUndo } = fakeToast();
    await runCancelWithUndo(
      async () => ({ ok: true }),
      async () => ({ ok: false, error: m["calendar.bookings.restoreSlotTaken"] }),
      toast,
    );
    clickUndo();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["calendar.bookings.restoreSlotTaken"]);
  });

  it("an Undo that throws (a stale tab's server action) still reaches the operator", async () => {
    const { toast, clickUndo } = fakeToast();
    await runCancelWithUndo(async () => ({ ok: true }), async () => { throw new Error("stale"); }, toast);
    clickUndo();
    await flush();
    expect(toast.error).toHaveBeenCalledWith(m["common.actionCrashed"]);
  });

  it("a refused cancel shows its error and offers no Undo", async () => {
    const { toast } = fakeToast();
    const r = await runCancelWithUndo(
      async () => ({ ok: false, error: "nope" }), async () => ({ ok: true }), toast,
    );
    expect(r).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("nope");
    expect(toast.success).not.toHaveBeenCalled();
  });

  /**
   * The cancel tells nobody: `setBookingStatusAction` writes the row and one
   * event, and no sender reads that event. An operator who assumes the
   * customer was emailed leaves them driving to a cancelled appointment, so
   * the toast says so.
   */
  it("the toast tells the operator the customer has NOT been told", () => {
    expect(m["calendar.bookings.cancelledToast"]).toMatch(/haven't told/i);
  });
});
