// S-47d Task 11 (spec §5.6.2): the Keep button's logic, minus React (D-036's own pattern,
// `calendar/cancel-booking.ts`'s `runCancelWithUndo`) — a unit-test seam that does not need a render
// harness, since `renderToStaticMarkup` cannot fire a click.
import type { ActionResult } from "../calendar/actions";

export type KeepToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

/**
 * DESIGN.md rule 6: Keep runs at once and its toast carries Undo, which calls the SAME action with
 * `false` (spec §5.6.2: "Keep … toast business.card.keptToast with Undo calling it with false").
 * `action` is `keepAppointmentAction` bound to this row's accountId/bookingId/locale, with only `kept`
 * left open — the caller never sees the real action's signature, just "kept or not". `onDone` fires
 * after EITHER write settles successfully (the component's own `router.refresh()`), never on a
 * refused or thrown write, so the row only ever re-reads a state the server actually stored.
 */
export async function runKeepWithUndo(
  action: (kept: boolean) => Promise<ActionResult>,
  toast: KeepToast,
  labels: { keptToast: string; undo: string; failed: string },
  onDone: () => void = () => {},
): Promise<boolean> {
  let r: ActionResult;
  try {
    r = await action(true);
  } catch {
    toast.error(labels.failed);
    return false;
  }
  if (!r.ok) {
    toast.error(r.error);
    return false;
  }
  onDone();
  toast.success(labels.keptToast, {
    action: {
      label: labels.undo,
      onClick: () => {
        void action(false).then((u) => {
          if (u.ok) onDone();
          else toast.error(u.error);
        });
      },
    },
  });
  return true;
}
