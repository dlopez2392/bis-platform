import type { toast as sonnerToast } from "sonner";

/**
 * The pure sequencing behind a suggestion card's decisions (item 8b-1, P8; the `cancel-booking.ts`
 * shape): no "use client", no DOM, the toast and the timer injected, so it is unit-tested without
 * jsdom. The server action's result types live here because the client and Task 6's actions share them.
 */

/** What Accept, Edit and accept and Discard answer. `field` names the edit form's field an error belongs under. */
export type SuggestionActionResult =
  | { ok: true; status: "accepted" | "edited" | "dismissed"; toast: string }
  | { ok: false; error: string; field?: string };
export type UndoResult = { ok: true; message: string } | { ok: false; error: string };

/** The toast's life (P8). NOT `UNDO_WINDOW_MS`: the server accepts Undo for 2 minutes, the toast offers it for 10 seconds. */
export const SUGGESTION_TOAST_MS = 10_000;

export type DecisionToast = {
  success: typeof sonnerToast.success;
  error: typeof sonnerToast.error;
  dismiss: typeof sonnerToast.dismiss;
};

export async function runDecision(deps: {
  act: () => Promise<SuggestionActionResult>;
  undo: () => Promise<UndoResult>;
  toast: DecisionToast;
  schedule: (fn: () => void, ms: number) => void;
  labels: { undo: string; crashed: string };
}): Promise<{ ok: true } | { ok: false; field?: string; error: string }> {
  const { act, undo, toast, schedule, labels } = deps;
  let r: SuggestionActionResult;
  try {
    r = await act();
  } catch {
    toast.error(labels.crashed);
    return { ok: false, error: labels.crashed };
  }
  if (!r.ok) {
    toast.error(r.error);
    return r.field === undefined ? { ok: false, error: r.error } : { ok: false, error: r.error, field: r.field };
  }
  const id = toast.success(r.toast, {
    action: {
      label: labels.undo,
      onClick: () => {
        void (async () => {
          let u: UndoResult;
          try {
            u = await undo();
          } catch {
            toast.error(labels.crashed);
            return;
          }
          if (u.ok) toast.success(u.message);
          else toast.error(u.error);
        })();
      },
    },
    duration: SUGGESTION_TOAST_MS,
  });
  schedule(() => { toast.dismiss(id); }, SUGGESTION_TOAST_MS);
  return { ok: true };
}
