import type { SupabaseClient } from "@bis/db";
import { segmentsFor } from "./segments";
import { resolveSmsSender, refusesAlertLoop } from "./sender";
import { getSmsProvider } from "./index";

/**
 * Business-side alert texts — the SMS twin of `bookingAlertEmail`/
 * `voiceCallAlertEmail` (lib/email/templates/{booking,voice}.ts), sent
 * ALONGSIDE those emails, never instead of them (danlo, 2026-09-15).
 *
 * Operator-facing, so English only — the alert emails and the conversation
 * thread stay English regardless of the customer's own language (see
 * `b/[publicId]/actions.ts`'s "the operator's alert and thread stay English
 * regardless"); this is the same audience.
 *
 * A text has no subject line and no room for preamble: what happened, who
 * it was, then stop. The customer's PHONE NUMBER never appears in either
 * composer below — that is lead PII riding a handset with no login, and it
 * already lives in the booking/call record behind the dashboard's own auth.
 * A name is judged safe to lead with: it is the "who" the message exists to
 * answer, and it is no more exposed here than on a caller-ID screen.
 */

/** New booking: `<when>` `-` `<name>`. Falls back to naming no one when the
 *  name would push the message past ONE segment — measured with
 *  `segmentsFor`, not assumed, because an accented name (this platform's
 *  common case — see textback-body.ts) can blow the 70-char UCS-2 budget
 *  well under a length that would look safe by character count alone. The
 *  dashboard and the email alert both still carry the name either way. */
export function composeBookingAlertSms(whenCompanyZone: string, contactName: string): string {
  const name = contactName.trim();
  const withName = `New booking: ${whenCompanyZone} - ${name}.`;
  if (segmentsFor(withName).segments <= 1) return withName;
  return `New booking: ${whenCompanyZone}. Check email for details.`;
}

const CALL_ALERT_LEAD: Record<"booked" | "lead" | "message", string> = {
  booked: "New call: booked a meeting.",
  lead: "New call: a lead came in.",
  message: "New call: left a message.",
};

/** One line naming what happened, plain ASCII, always one segment — the
 *  caller's own number is deliberately absent; the full transcript-backed
 *  summary is already in the email alert this fires alongside. */
export function composeCallAlertSms(outcome: "booked" | "lead" | "message"): string {
  return `${CALL_ALERT_LEAD[outcome]} Check your email for details.`;
}

/**
 * The one send path for a business-side alert text. Both call sites
 * (`app/b/[publicId]/actions.ts`, `lib/voice/finish-call.ts`) route through
 * this rather than calling `resolveSmsSender`/`getSmsProvider` themselves,
 * so the gate and the loop guard cannot be forgotten at a second call site.
 *
 * Fire-and-forget, exactly like the sibling email alert loops at both call
 * sites: NEVER throws, a failure is logged and swallowed here so it can
 * never cost the booking/call write it rides beside. No message or
 * conversation row is written for it — `alert_phone` names no contact
 * (0035_alert_phone.sql's decision 3 is the reason there must never be
 * one), so there is no thread for this send to join.
 *
 * `alertPhone: string | null` mirrors `accounts.alert_phone` directly: the
 * field IS the switch, so a null here is "no work to do," not an error.
 */
export async function sendAlertSms(
  db: SupabaseClient, accountId: string, alertPhone: string | null, body: string,
): Promise<void> {
  if (!alertPhone) return;
  try {
    const gate = await resolveSmsSender(db, accountId);
    if (!gate.ok) return;
    if (refusesAlertLoop(accountId, alertPhone, gate.from)) return;
    await getSmsProvider().send({ to: alertPhone, from: gate.from, body });
  } catch (e) {
    console.error(`alert SMS send failed for account ${accountId}: ${String(e)}`);
  }
}
