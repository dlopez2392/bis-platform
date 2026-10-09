import { m } from "@/lib/messages";

/**
 * The ONE marker the Resend webhook (`api/webhooks/resend/route.ts`, D-016)
 * writes into `messages.error` for a spam complaint — never a reused value,
 * never the provider's own text. `messages.error` otherwise holds raw,
 * uncontrolled text from every other failure path (a provider's own error
 * message, this app's own `EmailNotSent` reasons, a Telnyx failure), and
 * `messageFailureReason` below must never let any of that reach a screen
 * verbatim.
 */
export const COMPLAINT_ERROR_MARKER = "complained";

/**
 * D-016 review item 4: the exact message `EmailNotSent` (`lib/consent/
 * email-gate.ts`) gives a `{ kind: "blocked", reason: "suppressed" }`
 * result — `email not sent: ${result.reason}`. NOT imported from there:
 * lib/consent already depends on lib/email (scan 1, scans.test.ts), and
 * this file must not invert that into a cycle, so the literal is pinned
 * here instead, with this comment as the cross-reference. A staff-typed
 * send the gate blocks this way throws EmailNotSent, and the catch sites
 * that write `messages.error` (conversations/actions.ts) write its
 * message VERBATIM — the same shape as every other raw-text failure this
 * module exists to never echo, which is why this is matched exactly, not
 * as a substring (same discipline as COMPLAINT_ERROR_MARKER above).
 */
const SUPPRESSED_BLOCK_MESSAGE = "email not sent: suppressed";

/**
 * D-061 review follow-up: the gate's `suppressed_account` reason
 * (`EmailNotSent`'s `email not sent: suppressed_account`), for any row a
 * staff-typed send wrote before the action-level pre-check above existed —
 * `conversations/actions.ts` now refuses before writing one at all, but a
 * row already in the database still has to render something a business
 * owner can read, not this raw string.
 */
const SUPPRESSED_ACCOUNT_BLOCK_MESSAGE = "email not sent: suppressed_account";

/**
 * D-017. The thread (`message-thread.tsx`) and the contact timeline
 * (`activity-timeline.tsx`) stored a failure reason on every outbound
 * message that bounced or failed and showed NEITHER of them — an operator
 * could see a message say "Bounced" and nothing about why.
 *
 * Returns null for anything that is not a terminal failure (every other
 * status already has an honest label of its own via MESSAGE_STATUS_LABEL).
 * For a terminal one, this recognises ONLY `COMPLAINT_ERROR_MARKER` as a
 * SPECIFIC reason; every other `error` value — including a raw provider
 * string, which is most of what this column actually holds — falls back to
 * one generic, status-keyed line. The alternative (rendering `error`
 * itself) would print provider jargon or a raw code straight onto a screen
 * a business owner reads at 7 AM, the exact thing DESIGN.md's voice rule
 * forbids.
 */
export function messageFailureReason(
  message: { status: string; error: string | null },
): string | null {
  if (message.status === "bounced") {
    return message.error === COMPLAINT_ERROR_MARKER
      ? m["conversations.failureReason.complained"]
      : m["conversations.failureReason.bounced"];
  }
  if (message.status === "failed") {
    if (message.error === SUPPRESSED_BLOCK_MESSAGE) return m["conversations.failureReason.suppressed"];
    if (message.error === SUPPRESSED_ACCOUNT_BLOCK_MESSAGE) return m["automations.reason.accountSuppressed"];
    return m["conversations.failureReason.failed"];
  }
  return null;
}
