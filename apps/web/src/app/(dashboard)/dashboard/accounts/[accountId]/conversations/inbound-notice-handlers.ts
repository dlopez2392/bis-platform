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
 * Runs `undoReplyStopAction`. `onDone(expired)` is called only on a real
 * answer from the server — never on a throw, and never on a plain (non-
 * expired) failure, which is toasted instead. `expired` is read off the
 * TYPED field `ReplyActionResult.expired` the server sets, never derived by
 * matching `result.error`'s (translatable) text — the owner's 7-day-window
 * ruling: staff can Undo an automatic emailed stop only within 7 days of the
 * stop; past that only the customer's own reply-free re-subscribe can.
 *
 * S-10 T9a: `result.error` is shown VERBATIM, never re-mapped here. Before
 * this task `inbound-actions.ts` always built its own fallback strings and
 * called `emailContextFor`/`undoInboundStop`/`stopEmails` with the literal
 * "en", so a non-English reader's toast had to be re-localized client-side —
 * and only one sentence (`contact.email.changed`) had its own matching rule;
 * every OTHER server error (a dead ledger read, `contact.email.noEmail`,
 * `contact.email.failed`...) collapsed into the generic "that didn't save"
 * line, discarding whatever more specific thing the server actually said.
 * Now every path in `inbound-actions.ts` is handed THIS reader's own
 * `locale` and builds its strings with `t(m, key, locale)` there, so
 * `result.error` already IS the reader's language by the time it lands
 * here — re-localizing it again would require matching it against the
 * catalogue's ENGLISH default, which the server no longer ever returns to a
 * non-English reader.
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
  toast.error(result.error);
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
  // See runUndoReplyStop's doc comment: already localized by inbound-actions.ts.
  toast.error(result.error);
}
