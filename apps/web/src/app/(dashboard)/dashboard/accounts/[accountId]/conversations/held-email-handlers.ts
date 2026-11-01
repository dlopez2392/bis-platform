import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { HeldActionResult, HeldUndo, HeldUndoResult } from "./inbound-actions";

/**
 * Every call `held-email-list.tsx` makes into the server (File, Choose a
 * record, Not a customer, and their shared Undo) goes through here —
 * `inbound-notice-handlers.ts`'s own pattern (Task 11) — so a THROWN action
 * (a stale deployment, an expired session) still toasts `common.
 * actionCrashed` rather than leaving the row looking like it did nothing.
 */
export type HeldToast = {
  success: (message: string, opts?: { action: { label: string; onClick: () => void } }) => unknown;
  error: (message: string) => unknown;
};

/**
 * `successMessage` is already localized and interpolated by the caller (it
 * carries the chosen name for File, nothing for Not a customer) — this
 * module only decides which toast fires and whether the item comes back.
 * The row is removed from the list OPTIMISTICALLY by the caller before this
 * runs; `onRestore` is this module's only way to put it back, and runs on
 * both a thrown action and a `failed` answer, never on `changed` (the row
 * really did move, just not where this click expected — reloading is the
 * only way back, not restoring a stale local copy of it).
 */
export async function runHeldAction(
  run: () => Promise<HeldActionResult>,
  toast: HeldToast,
  locale: Locale,
  successMessage: string,
  onRestore: () => void,
  runUndo: (undo: HeldUndo) => Promise<void>,
): Promise<void> {
  let result: HeldActionResult;
  try {
    result = await run();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    onRestore();
    return;
  }
  if (result.ok) {
    toast.success(successMessage, {
      action: { label: t(m, "common.undo", locale), onClick: () => { void runUndo(result.undo); } },
    });
    return;
  }
  if (result.error === "changed") {
    toast.error(t(m, "conversations.held.changed", locale));
    return;
  }
  toast.error(t(m, "conversations.held.failed", locale));
  onRestore();
}

/** The Undo toast's own action (`unfileInboundEmail`/held-again) and the
 *  thrown case for IT, same shape as above but with no row to restore —
 *  the row is already gone from this list either way; `onUndone` only
 *  refreshes the page so the row reappears from the server's own truth.
 *  Fix round 1: a successful Undo can still carry `stopNotReversed` — the
 *  email came back to Needs a look, but the customer's own emailed stop
 *  (which Undo also tries to reverse) could not be, because it had already
 *  expired or changed since. Coordinator round 1 (2026-10-16): its VALUE
 *  (one of a few server strings, already localized by inbound-actions.ts's
 *  own `locale` since the review fix round that retired `localizedError`)
 *  is still never matched or shown — `conversations.held.undoneStopped`
 *  covers every reason the same way, reported as a SECOND, separate info
 *  toast, because the main one still has to say the Undo itself worked —
 *  it did. */
export async function runUndoHeldEmail(
  run: () => Promise<HeldUndoResult>,
  toast: HeldToast,
  locale: Locale,
  onUndone: () => void,
): Promise<void> {
  let result: HeldUndoResult;
  try {
    result = await run();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    return;
  }
  if (result.ok) {
    toast.success(t(m, "conversations.held.undone", locale));
    if (result.stopNotReversed) toast.error(t(m, "conversations.held.undoneStopped", locale));
    onUndone();
    return;
  }
  toast.error(t(m, "conversations.held.failed", locale));
}
