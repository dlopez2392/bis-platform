import { m } from "@/lib/messages";
import type { ToastLike } from "@/lib/ui/guarded-run";
import type { ActionResult } from "./actions";

/**
 * The Calendar page's Cancel button, minus React (D-036). DESIGN.md rule 6:
 * a reversible action runs at once with Undo on its toast; the same shape as
 * `lib/branding/remove-logo.ts`'s `runRemoveLogo`.
 *
 * Reversible because this cancel tells nobody: no customer email, no staff
 * alert. The toast says so, since an operator who assumes the customer heard
 * leaves them driving to a cancelled appointment. When a customer notice is
 * added here (F-048's rider), it must go out only once the Undo has closed,
 * or the Undo stops being one.
 *
 * Answers whether the cancel happened; the Undo's own outcome arrives as a
 * second toast, after the server has done (or refused) the work.
 */
export async function runCancelWithUndo(
  cancel: () => Promise<ActionResult>,
  undo: () => Promise<ActionResult>,
  toast: ToastLike,
): Promise<boolean> {
  let r: ActionResult;
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
  toast.success(m["calendar.bookings.cancelledToast"], {
    action: {
      label: m["common.undo"],
      onClick: () => {
        void (async () => {
          let u: ActionResult;
          try {
            u = await undo();
          } catch {
            toast.error(m["common.actionCrashed"]);
            return;
          }
          if (u.ok) toast.success(m["calendar.bookings.restored"]);
          else toast.error(u.error);
        })();
      },
    },
  });
  return true;
}
