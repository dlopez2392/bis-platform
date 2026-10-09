import { m } from "@/lib/messages";
import type { ActionResult, CancelBookingResult } from "./actions";
import { UNDO_WINDOW_MS } from "./undo-window";

/**
 * The toast this needs: sonner's `toast` satisfies it. `duration` and
 * `dismiss` are what let the Undo live exactly the window the customer
 * notice waits out (F-048).
 */
export type CancelToast = {
  success: (
    message: string,
    opts?: { action: { label: string; onClick: () => void }; duration: number },
  ) => unknown;
  error: (message: string) => unknown;
  dismiss: (id?: string | number) => unknown;
};

/**
 * The Calendar page's Cancel button, minus React (D-036). DESIGN.md rule 6:
 * a reversible action runs at once with Undo on its toast; the same shape as
 * `lib/branding/remove-logo.ts`'s `runRemoveLogo`.
 *
 * F-048: the cancel may carry a customer notice, which the server sends only
 * once the Undo window has closed (`cancel-notice.ts`). So the toast:
 *   - says which it is: "we'll email the customer when this closes" when the
 *     notice is scheduled, "we haven't told the customer" when it is not, so
 *     an operator never assumes either wrongly;
 *   - lives exactly UNDO_WINDOW_MS, and is closed then even if the pointer
 *     is resting on it (sonner pauses a hovered toast), so Undo is never on
 *     screen after the notice could have gone;
 *   - hands the cancel's own version to the Undo, which is what lets the
 *     server refuse an Undo that arrives after the notice claimed the cancel.
 *
 * Answers whether the cancel happened; the Undo's own outcome arrives as a
 * second toast, after the server has done (or refused) the work.
 */
export async function runCancelWithUndo(
  cancel: () => Promise<CancelBookingResult>,
  undo: (version: string) => Promise<ActionResult>,
  toast: CancelToast,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): Promise<boolean> {
  let r: CancelBookingResult;
  try {
    r = await cancel();
  } catch {
    toast.error(m["common.actionCrashed"]);
    return false;
  }
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  const { version } = r;
  const id = toast.success(
    r.noticeScheduled ? m["calendar.bookings.cancelledToastNotice"] : m["calendar.bookings.cancelledToast"],
    {
      action: {
        label: m["common.undo"],
        onClick: () => {
          void (async () => {
            let u: ActionResult;
            try {
              u = await undo(version);
            } catch {
              toast.error(m["common.actionCrashed"]);
              return;
            }
            if (u.ok) toast.success(m["calendar.bookings.restored"]);
            else toast.error(u.error);
          })();
        },
      },
      duration: UNDO_WINDOW_MS,
    },
  );
  schedule(() => { toast.dismiss(id as string | number); }, UNDO_WINDOW_MS);
  return true;
}
