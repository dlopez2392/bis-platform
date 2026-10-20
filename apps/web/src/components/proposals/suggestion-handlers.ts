import { createElement, type ReactElement } from "react";
import type { toast as sonnerToast } from "sonner";

/**
 * The pure sequencing behind a suggestion card's decisions (item 8b-1, P8; the `cancel-booking.ts`
 * shape): no "use client", no DOM, the toast and the timer injected, so it is unit-tested without
 * jsdom. The server action's result types live here because the client and Task 6's actions share them.
 *
 * Every word it hands sonner is an element carrying the reader's `lang` (design review I3): the toaster
 * sits under <html lang="en">, so a bare Spanish string, "Deshacer" included, is announced in an English
 * voice. `createElement` builds a plain object, so this stays pure and DOM-free.
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
  /** A full document reload (8b-1 follow-up 1, plan A4): the caller passes `window.location.reload`,
   *  never `router.refresh()`, which a tab pinned to an older deployment would fetch from that deployment. */
  reload: () => void;
  labels: { undo: string; crashed: string; reload: string; lang: "en" | "es" };
}): Promise<{ ok: true } | { ok: false; field?: string; error: string }> {
  const { act, undo, toast, schedule, reload, labels } = deps;
  const say = (text: string): ReactElement => createElement("span", { lang: labels.lang }, text);
  // The request never reached a server action that answered (a network failure, or a tab older than the
  // deployment): the words say reload, and the toast offers it. The server's own refusals are not this.
  const unreachable = () => {
    toast.error(say(labels.crashed), { action: { label: say(labels.reload), onClick: () => reload() } });
  };
  let r: SuggestionActionResult;
  try {
    r = await act();
  } catch {
    unreachable();
    return { ok: false, error: labels.crashed };
  }
  if (!r.ok) {
    toast.error(say(r.error));
    return r.field === undefined ? { ok: false, error: r.error } : { ok: false, error: r.error, field: r.field };
  }
  // Once per toast: a double click must not send a second Undo (the first may already have restored it).
  let fired = false;
  const id = toast.success(say(r.toast), {
    action: {
      label: say(labels.undo),
      onClick: () => {
        if (fired) return;
        fired = true;
        void (async () => {
          let u: UndoResult;
          try {
            u = await undo();
          } catch {
            unreachable();
            return;
          }
          if (u.ok) toast.success(say(u.message));
          else toast.error(say(u.error));
        })();
      },
    },
    duration: SUGGESTION_TOAST_MS,
  });
  schedule(() => { toast.dismiss(id); }, SUGGESTION_TOAST_MS);
  return { ok: true };
}
