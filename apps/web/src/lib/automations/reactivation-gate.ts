import { resolveAccountZone, isInMorningBand } from "@/lib/booking/followup-timing";
import { normalizeReplyTo } from "@/lib/email/reply-to";

/**
 * WHEN a reactivation email may go — and that is ALL this gate decides. The
 * quiet period itself is a query predicate (listDueReactivations), not a
 * gate, because "has this person been silent for nine months" is a question
 * the database can answer once for every account rather than one the pass
 * asks per row.
 *
 * FAIL CLOSED on an unresolvable zone: no hour is defensible, and this runs
 * inside a cron tick with no one watching.
 */
export function shouldSendReactivationNow(now: Date, timezone: string): boolean {
  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;
  if (!Number.isFinite(now.getTime())) return false;
  return isInMorningBand(now, zone);
}

/**
 * WHAT a reactivation email cannot go without (decision A, danlo,
 * 2026-09-22) — `true` means MISSING. This is the one recipe that emails
 * someone who did not just interact with the business, and its purpose is
 * winning work back: commercial email, which under CAN-SPAM (the
 * orchestrator's reading, not a lawyer's) needs a working opt-out and the
 * sender's physical postal address. So:
 *   - `mailingAddress`: the footer prints it. Blank after JavaScript's
 *     `.trim()` is missing — the column's CHECK (0048) strips that same set.
 *   - `replyTo`: the opt-out is "reply and let us know", so a reply must
 *     reach the BUSINESS. With no reply-to the header is omitted and, with no
 *     `from_email`, the email leaves from `EMAIL_FROM` — the agency's own
 *     mailbox. Judged by `normalizeReplyTo`, the send path's own rule for
 *     "no address", so the gate and the header can never disagree.
 *
 * Asked by the pass (skip before sending), the save action (refuse to turn
 * the recipe on) and the Automations card (say what is missing), so "blank"
 * is decided here once.
 */
export function missingForReactivation(
  mailingAddress: string | null | undefined, replyToEmail: string | null | undefined,
): { mailingAddress: boolean; replyTo: boolean } {
  return {
    mailingAddress: !mailingAddress?.trim(),
    replyTo: normalizeReplyTo(replyToEmail) === undefined,
  };
}
