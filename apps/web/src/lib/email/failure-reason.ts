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
  if (message.status === "failed") return m["conversations.failureReason.failed"];
  return null;
}
