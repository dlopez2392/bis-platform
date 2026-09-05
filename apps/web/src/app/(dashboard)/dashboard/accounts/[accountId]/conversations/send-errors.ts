/**
 * Distinguishes a send that was rejected *before* any message row was written
 * (missing field, contact not in account, contact has no email) from a send
 * that failed at the provider *after* a row exists. The composers need that
 * distinction so they don't tell the user "it is saved as failed in the thread"
 * when nothing was saved.
 *
 * Lives here rather than in `actions.ts` because a file-level "use server"
 * module may only export async functions — a sync helper there fails the
 * build. Keeping the directive at file scope means a new action cannot ship
 * without it.
 */
export const SEND_REJECTED_PREFIX = "SEND_REJECTED: ";

export function sendRejected(reason: string): never {
  throw new Error(SEND_REJECTED_PREFIX + reason);
}

export function isSendRejected(e: unknown): boolean {
  return e instanceof Error && e.message.startsWith(SEND_REJECTED_PREFIX);
}

/**
 * The literal reason text a rejected action passed to sendRejected, with the
 * internal prefix stripped — null when `e` isn't one of these. Every caller
 * of sendRejected in the SMS path passes an already-curated, plain-language
 * m[] string for each reason a stale tab can still reach past the client's
 * own gates (compose.smsBlockedA2p / compose.smsBlockedNoNumber /
 * compose.noPhoneOnContact) — so it is safe to show verbatim instead of
 * collapsing every rejection to one fixed line that names only one of them.
 */
export function sendRejectedReason(e: unknown): string | null {
  if (!(e instanceof Error) || !e.message.startsWith(SEND_REJECTED_PREFIX)) return null;
  return e.message.slice(SEND_REJECTED_PREFIX.length);
}
