import type { SupabaseClient } from "@bis/db";
import { ALERT_CODE_TTL_MINUTES } from "@bis/db";
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
 *
 * `outbound_suppressed` (accounts) is deliberately NOT consulted anywhere in
 * this file. That is a decision, not an oversight: the two neighbouring
 * alert legs this module rides beside — the booking/call staff ALERT EMAIL
 * and the missed-call text-BACK — don't consult it either (verified against
 * `app/b/[publicId]/actions.ts` and `lib/voice/finish-call.ts` as of this
 * writing), so this stays consistent with its siblings rather than silently
 * becoming the one alert path that honours a flag none of the others do.
 */

/** Both composers share ONE phrase for "the rest is in your inbox," so the
 *  two never drift into two different promises of the same thing (a minor
 *  the alert-send-report follow-up review caught: "Check email for
 *  details." vs "Check your email for details."). Short on purpose — every
 *  caller of both composers below measures its own worst case with
 *  `segmentsFor` rather than trusting a short phrase to stay short. */
const EMAIL_HINT = " Check email for details.";

/** New booking: `<when>` `-` `<name>`. Falls back to naming no one when the
 *  name would push the message past ONE segment — measured with
 *  `segmentsFor`, not assumed, because an accented name (this platform's
 *  common case — see textback-body.ts) can blow the 70-char UCS-2 budget
 *  well under a length that would look safe by character count alone. The
 *  dashboard and the email alert both still carry the name either way.
 *
 *  `hasEmailRecipients` gates the fallback's email mention — a calendar with
 *  an empty `notify_emails` never got an email in the first place, and the
 *  fallback used to promise one unconditionally (alert-send-report follow-up
 *  review, finding 3).
 *
 *  The name is run through the SAME control-character strip the email
 *  subject gets for the identical value (`stripSubjectControlChars`,
 *  `app/b/[publicId]/actions.ts`) — a raw `\n`/`\r`/`\t` is still a valid
 *  contact name for the booking record itself, but it must not be able to
 *  split this one-line text onto a second visual line. */
export function composeBookingAlertSms(
  whenCompanyZone: string, contactName: string, hasEmailRecipients: boolean,
): string {
  const name = contactName.replace(/[\r\n\t]+/g, " ").trim();
  const withName = `New booking: ${whenCompanyZone} - ${name}.`;
  if (segmentsFor(withName).segments <= 1) return withName;
  const fallback = `New booking: ${whenCompanyZone}.`;
  return hasEmailRecipients ? `${fallback}${EMAIL_HINT}` : fallback;
}

const CALL_ALERT_LEAD: Record<"booked" | "lead" | "message" | "transferred", string> = {
  booked: "New call: booked a meeting.",
  lead: "New call: a lead came in.",
  message: "New call: left a message.",
  // 0037's sixth outcome. Same grammar as its three siblings — each says what
  // the CALLER got — and deliberately not "transferred to you": the transfer
  // number and the alert number are separate columns on `accounts` and may
  // well be separate people, so naming the recipient would be a guess.
  transferred: "New call: reached a person.",
};

/** One line naming what happened, plain ASCII, always one segment — the
 *  caller's own number is deliberately absent; the full transcript-backed
 *  summary is already in the email alert this fires alongside, WHEN one
 *  exists. `hasEmailRecipients` gates the email mention — live data showed
 *  two of four calendars have no notify emails at all, and for those
 *  accounts this text was the only notification they get while pointing at
 *  an email that was never sent (alert-send-report follow-up review, finding
 *  3). */
export function composeCallAlertSms(
  outcome: "booked" | "lead" | "message" | "transferred", hasEmailRecipients: boolean,
): string {
  const lead = CALL_ALERT_LEAD[outcome];
  return hasEmailRecipients ? `${lead}${EMAIL_HINT}` : lead;
}

/**
 * The one-line body for proving possession of a NEW alert number
 * (0036_alert_phone_verifications.sql) — an operator-facing code, not a
 * customer alert, but composed here beside its siblings for the same
 * reason: one place that decides what a text from this account says.
 *
 * Fixed wording plus a six-digit code is well under the 70-char UCS-2
 * budget on its own (unlike the booking/call composers above, nothing here
 * varies with untrusted input the way a contact name does), so this is not
 * measured with `segmentsFor` at every call site — the test for this
 * function does that once, and a code is always exactly six digits
 * (`ALERT_CODE_DIGITS`, `@bis/db`).
 */
export function composeAlertPhoneVerificationSms(code: string): string {
  return `Your BIS verification code is ${code}. It expires in ${ALERT_CODE_TTL_MINUTES} minutes.`;
}

/** What a caller has resolved and is ready to send — everything
 *  `prepareAlertSms` below decides, with nothing left to look up. */
export type PendingAlertSms = { to: string; from: string; body: string };

/**
 * Phase 1 of a send: the gate, the loop guard, and nothing that touches the
 * network. Split out of what used to be `sendAlertSms`'s single body so
 * `lib/voice/finish-call.ts` can run this HALF before `finishCallRow` (cheap
 * DB reads) and the network half after it (alert-send-report follow-up
 * review, finding 4) — mirroring the missed-call text-back's own split
 * around the same row write, for the identical reason: a slow carrier POST
 * ahead of the durable call row is how that row is lost on an invocation
 * that runs out of budget. `app/b/[publicId]/actions.ts` has no such
 * ordering constraint (the booking row is already committed long before its
 * alert-SMS block runs) and keeps using `sendAlertSms` below unchanged.
 *
 * Returns null for every "nothing to send" case — no alertPhone, the gate
 * not open, or the loop guard refusing — so a caller has exactly one thing
 * to check. Never throws-and-swallows here; a DB read failing is left to
 * escape to whichever caller wraps this (both callers already do).
 */
export async function prepareAlertSms(
  db: SupabaseClient, accountId: string, alertPhone: string | null, body: string,
): Promise<PendingAlertSms | null> {
  if (!alertPhone) return null;
  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) return null;
  if (refusesAlertLoop(accountId, alertPhone, gate.ownedNumbers)) return null;
  return { to: alertPhone, from: gate.from, body };
}

/**
 * Phase 2: the actual provider POST, and the only half with a carrier round
 * trip in it. NEVER throws — a failure is logged and swallowed here so it
 * can never cost the booking/call write it rides beside, same contract
 * `sendAlertSms` always had.
 *
 * Logs the provider message id AND the destination on SUCCESS too, not only
 * on failure (alert-send-report follow-up review, finding 5: a failed alert
 * had no symptom anywhere — no message row exists for this send, 0035's own
 * decision 3 is why there must never be one, so the provider's delivery
 * callback had nothing to correlate against and nothing else in this path
 * ever logged a success at all). This is the cheap end of that finding, not
 * the thorough one: a durable, agency-visible send record would need a
 * product decision about where an agency would see it, which is outside a
 * bug-fix pass — recorded as a deferred item, not silently dropped.
 */
export async function deliverAlertSms(accountId: string, pending: PendingAlertSms): Promise<void> {
  try {
    const { providerMessageId } = await getSmsProvider().send(pending);
    console.error(
      `alert SMS sent for account ${accountId}: to ${pending.to} providerMessageId ${providerMessageId}`,
    );
  } catch (e) {
    console.error(`alert SMS send failed for account ${accountId}: ${String(e)}`);
  }
}

/**
 * The convenience path for a business-side alert text that has no ordering
 * constraint against a durable row written elsewhere — `prepareAlertSms`
 * then `deliverAlertSms`, back to back. `app/b/[publicId]/actions.ts` is the
 * one remaining caller; `lib/voice/finish-call.ts` calls the two phases
 * itself, split around `finishCallRow` (see `prepareAlertSms`'s doc).
 *
 * Fire-and-forget, exactly like the sibling email alert loop at the booking
 * call site: NEVER throws. No message or conversation row is written for
 * it — `alert_phone` names no contact (0035_alert_phone.sql's decision 3 is
 * the reason there must never be one), so there is no thread for this send
 * to join.
 *
 * `alertPhone: string | null` mirrors `accounts.alert_phone` directly: the
 * field IS the switch, so a null here is "no work to do," not an error.
 */
export async function sendAlertSms(
  db: SupabaseClient, accountId: string, alertPhone: string | null, body: string,
): Promise<void> {
  try {
    const pending = await prepareAlertSms(db, accountId, alertPhone, body);
    if (!pending) return;
    await deliverAlertSms(accountId, pending);
  } catch (e) {
    console.error(`alert SMS send failed for account ${accountId}: ${String(e)}`);
  }
}
