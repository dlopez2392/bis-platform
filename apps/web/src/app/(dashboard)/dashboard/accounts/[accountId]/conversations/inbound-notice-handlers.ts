import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import type { ReplyActionResult } from "./inbound-actions";

/**
 * Every call the thread's inbound-email notice makes into the server goes
 * through here — Task 10's `replies-row-handlers.ts` pattern — so a THROWN
 * action (a stale deployment, an expired session; `lib/forms/action-
 * feedback.ts`'s own documented incident) still toasts, rather than leaving
 * the bubble's Undo/Stop-emails button looking like it did nothing.
 */
export type NoticeToast = { success: (message: string) => unknown; error: (message: string) => unknown };

/**
 * The server's own `error` is English (`inbound-actions.ts`'s doc comment:
 * the toast is drawn here, which re-localises). Only `contact.email.changed`'s
 * English text gets its own localized key; every other server error reads as
 * the generic "that didn't save" in the reader's language — the server's
 * other strings were never meant to reach a screen untranslated.
 */
function localizedError(error: string, locale: Locale): string {
  return error === m["contact.email.changed"]
    ? t(m, "contact.email.changed", locale)
    : t(m, "conversations.held.failed", locale);
}

/**
 * Runs `undoReplyStopAction`. `onDone(expired)` is called only on a real
 * answer from the server — never on a throw, and never on a plain (non-
 * expired) failure, which is toasted instead. `expired` is read off the
 * TYPED field `ReplyActionResult.expired` the server sets, never derived by
 * matching `result.error`'s (translatable) text — the owner's 7-day-window
 * ruling: staff can Undo an automatic emailed stop only within 7 days of the
 * stop; past that only the customer's own reply-free re-subscribe can.
 */
export async function runUndoReplyStop(
  run: () => Promise<ReplyActionResult>,
  toast: NoticeToast,
  locale: Locale,
  onDone: (expired: boolean) => void,
): Promise<void> {
  let result: ReplyActionResult;
  try {
    result = await run();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    return;
  }
  if (result.ok) {
    toast.success(t(m, "conversations.reply.stopUndone", locale));
    onDone(false);
    return;
  }
  if (result.expired) {
    onDone(true);
    return;
  }
  toast.error(localizedError(result.error, locale));
}

/** Runs `stopEmailsFromReplyAction`. `onDone` fires only once the server answers `{ ok: true }`. */
export async function runStopEmailsFromReply(
  run: () => Promise<ReplyActionResult>,
  toast: NoticeToast,
  locale: Locale,
  onDone: () => void,
): Promise<void> {
  let result: ReplyActionResult;
  try {
    result = await run();
  } catch {
    toast.error(t(m, "common.actionCrashed", locale));
    return;
  }
  if (result.ok) {
    toast.success(t(m, "conversations.reply.stopDone", locale));
    onDone();
    return;
  }
  toast.error(localizedError(result.error, locale));
}
