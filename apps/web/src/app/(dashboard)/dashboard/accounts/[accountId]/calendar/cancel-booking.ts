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

export type CancelOptions = {
  /** The toast when no notice goes, for a cancel made at once
   *  (`cancelStep`'s words). Defaults to "we haven't told the customer". */
  noNoticeMessage?: string;
  schedule?: (fn: () => void, ms: number) => unknown;
};

/**
 * The Calendar page's Cancel button, minus React (D-036). DESIGN.md rule 6:
 * a reversible action runs at once with Undo on its toast; the same shape as
 * `lib/branding/remove-logo.ts`'s `runRemoveLogo`.
 *
 * F-048: the cancel may carry a customer notice, which the server sends only
 * once the Undo window has closed (`cancel-notice.ts`). So the toast:
 *   - says which it is: "we'll email the customer when this closes" when the
 *     notice is scheduled, "their address can't receive our emails" when it
 *     bounced, otherwise "we haven't told the customer", so an operator never
 *     assumes either wrongly;
 *   - lives exactly UNDO_WINDOW_MS, and is closed then even if the pointer
 *     is resting on it (sonner pauses a hovered toast), so Undo is never on
 *     screen after the notice could have gone;
 *   - hands the cancel's own version, and the notice's queued thread row, to
 *     the Undo: the version lets the server refuse an Undo that arrives
 *     after the notice claimed the cancel, the row lets a winning Undo remove
 *     the email that will now never be sent.
 *
 * Answers whether the cancel happened; the Undo's own outcome arrives as a
 * second toast, after the server has done (or refused) the work.
 */
export async function runCancelWithUndo(
  cancel: () => Promise<CancelBookingResult>,
  undo: (version: string, noticeMessageId?: string) => Promise<ActionResult>,
  toast: CancelToast,
  opts: CancelOptions = {},
): Promise<boolean> {
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
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
  const noticeMessageId = r.notice === "scheduled" ? r.noticeMessageId : undefined;
  const message = r.notice === "scheduled" ? m["calendar.bookings.cancelledToastNotice"]
    : r.notice === "address_blocked" ? m["calendar.bookings.cancelledToastAddressBlocked"]
    : opts.noNoticeMessage ?? m["calendar.bookings.cancelledToast"];
  const id = toast.success(message, {
    action: {
      label: m["common.undo"],
      onClick: () => {
        void (async () => {
          let u: ActionResult;
          try {
            u = await undo(version, noticeMessageId);
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
  });
  schedule(() => { toast.dismiss(id as string | number); }, UNDO_WINDOW_MS);
  return true;
}
