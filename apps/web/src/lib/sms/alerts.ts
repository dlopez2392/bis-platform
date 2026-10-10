import type { SupabaseClient } from "@bis/db";
import { ALERT_CODE_TTL_MINUTES } from "@bis/db";
import { segmentsFor } from "./segments";
import { resolveSmsSender, refusesAlertLoop } from "./sender";
import { sendSms } from "@/lib/consent/gate";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { formatWhen } from "@/lib/booking/time";

/**
 * Business-side alert texts — the SMS twin of `bookingAlertEmail`/
 * `voiceCallAlertEmail` (lib/email/templates/{booking,voice}.ts), sent
 * ALONGSIDE those emails, never instead of them (danlo, 2026-09-15).
 *
 * Operator-facing, in the ACCOUNT's language (never the customer's). Owner
 * decision B (2026-10-10): for a Spanish account the booking alert and the
 * call alert are Spanish with every accent dropped (`stripDiacritics`), so
 * they stay GSM-7 and one segment. The verification-code text, the alert
 * emails and the conversation thread stay English.
 *
 * A text has no subject line and no room for preamble: what happened, who
 * it was, then stop. The customer's PHONE NUMBER never appears in either
 * composer below — that is lead PII riding a handset with no login, and it
 * already lives in the booking/call record behind the dashboard's own auth.
 * A name is judged safe to lead with: it is the "who" the message exists to
 * answer, and it is no more exposed here than on a caller-ID screen.
 *
 * `outbound_suppressed` (accounts, D-061) is not read anywhere in this file
 * ON PURPOSE, but not because the flag goes unconsulted — `deliverAlertSms`
 * sends through `sendSms` (lib/consent/gate.ts), and `decideSms` there is
 * the ONE chokepoint every send path reads it through, this one included.
 * A second read here would duplicate, not strengthen, that check.
 */

/** Both composers share ONE phrase for "the rest is in your inbox"
 *  (`sms.alert.emailHint`), so the two never drift into two different
 *  promises of the same thing (a minor the alert-send-report follow-up review
 *  caught: "Check email for details." vs "Check your email for details.").
 *  Short on purpose — every caller of both composers below measures its own
 *  worst case with `segmentsFor` rather than trusting a short phrase to stay
 *  short. */
function emailHint(language: Locale): string {
  return t(m, "sms.alert.emailHint", language);
}

/** Owner decision B: a Spanish staff text drops every accent — NFD splits
 *  "á" into "a" plus a combining mark, and the marks are removed — so
 *  á/í/ó/ú (outside GSM-7) never drop the whole text to UCS-2 at 70
 *  chars/segment. For SMS composition only, never for display: the
 *  accents-guard test exists because display must KEEP accents. */
export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "");
}

/** The when-string a staff alert TEXT carries, in the account's language.
 *  English is exactly `formatWhen(instant, timeZone)` — the booking email,
 *  its subject and the thread keep using that directly. Spanish is built
 *  from es-US's own parts as "sab 17 oct, 3:00 p.m. CDT" (owner decision
 *  B's example): no "de", no comma after the weekday, no trailing period on
 *  an abbreviation ("sept."), any non-ASCII space folded to a plain one,
 *  accents dropped. */
export function formatAlertWhen(instant: Date, timeZone: string, language: Locale): string {
  if (language !== "es") return formatWhen(instant, timeZone);
  const parts = new Intl.DateTimeFormat("es-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const abbr = (type: Intl.DateTimeFormatPartTypes) => value(type).replace(/\.$/, "");
  const when = `${abbr("weekday")} ${value("day")} ${abbr("month")}, ${value("hour")}:${value("minute")} ${value("dayPeriod")} ${value("timeZoneName")}`;
  return stripDiacritics(when).replace(/\s+/g, " ").trim();
}

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
 *  split this one-line text onto a second visual line.
 *
 *  `language`: the reader is the BUSINESS owner/staff this alert goes to,
 *  so it is the account's own resolved language, never the customer's —
 *  the caller passes `resolveLocale(undefined, account.language)` and a
 *  `whenCompanyZone` from `formatAlertWhen` in that same language, never a
 *  booking-page locale. Optional and defaulting to "en" so every 3-arg call
 *  keeps its exact prior output. For Spanish (owner decision B) the whole
 *  text loses its accents, so only a name GSM-7 cannot carry at all (or one
 *  too long for a segment) still reaches the no-name fallback. */
export function composeBookingAlertSms(
  whenCompanyZone: string, contactName: string, hasEmailRecipients: boolean, language: Locale = "en",
): string {
  const name = contactName.replace(/[\r\n\t]+/g, " ").trim();
  // Spanish drops every accent from the WHOLE text, the name included
  // ("José Núñez" → "Jose Nunez"), so an accented name — the common case on
  // a Spanish account — keeps its place instead of forcing the no-name
  // fallback. The dashboard and the email still carry the name as typed.
  // A Spanish text must also stay GSM-7 (owner decision B), so a name GSM-7
  // cannot carry even unaccented (CJK, emoji) takes the fallback there,
  // where English still accepts a one-segment UCS-2 text as it always has.
  const finish = (text: string) => (language === "es" ? stripDiacritics(text) : text);
  const fits = (text: string) => {
    const seg = segmentsFor(text);
    return seg.segments <= 1 && (language !== "es" || seg.encoding === "gsm7");
  };
  const withName = finish(t(m, "sms.alert.booking.newBookingWithName", language, { when: whenCompanyZone, name }));
  if (fits(withName)) return withName;
  const fallback = t(m, "sms.alert.booking.newBooking", language, { when: whenCompanyZone });
  return finish(hasEmailRecipients ? `${fallback}${emailHint(language)}` : fallback);
}

/**
 * Three outcomes, not six. 0037's `transferred` is deliberately absent: a
 * completed transfer fires no staff alert at all
 * (docs/superpowers/specs/2026-09-15-call-handoff-design.md), because the
 * person who took the call live already knows, and because the decision is
 * made at socket close before anyone knows whether the transfer connected.
 * `isMeaningful` (lib/voice/finish-call.ts) is the gate, and its type
 * predicate narrows to exactly this union.
 *
 * The compiler enforces only ONE direction of that agreement: it stops a
 * caller passing an outcome this union does not contain. It does NOT check
 * that `isMeaningful` still means what it says — TypeScript takes a type
 * predicate's BODY on trust, so widening that body to let `transferred`
 * through while leaving its return type at three members type-checks
 * cleanly. Nothing would then stop `CALL_ALERT_LEAD[outcome]` being
 * `undefined` and a text reading "undefined Check email for details."
 * reaching the business's alert phone, so `composeCallAlertSms` below has a
 * RUNTIME floor as well. Widen this union and `isMeaningful` together; the
 * compiler will catch only half of getting it wrong.
 */
const CALL_ALERT_LEAD = {
  booked: "sms.alert.call.booked",
  lead: "sms.alert.call.lead",
  message: "sms.alert.call.message",
} as const satisfies Record<"booked" | "lead" | "message", keyof typeof m>;

/** One line naming what happened, plain ASCII, always one segment — the
 *  caller's own number is deliberately absent; the full transcript-backed
 *  summary is already in the email alert this fires alongside, WHEN one
 *  exists. `hasEmailRecipients` gates the email mention — live data showed
 *  two of four calendars have no notify emails at all, and for those
 *  accounts this text was the only notification they get while pointing at
 *  an email that was never sent (alert-send-report follow-up review, finding
 *  3).
 *
 *  `language` is the ACCOUNT's (owner decision B): finishCall passes the
 *  `accounts.language` route.ts already loaded. The Spanish copy is written
 *  accent-free and stripped again here, so it is GSM-7 by construction. */
export function composeCallAlertSms(
  outcome: "booked" | "lead" | "message", hasEmailRecipients: boolean, language: Locale = "en",
): string {
  // Runtime floor, not belt-and-braces: see CALL_ALERT_LEAD's doc. The type
  // says this lookup cannot miss; a widened type predicate upstream is enough
  // to make it miss anyway, and the cost of missing is a carrier send that
  // literally reads "undefined". Throwing lands in finishCall's staff-alert
  // leg's own try/catch — a logged failure and no text, rather than a text
  // that says nothing.
  const key: (typeof CALL_ALERT_LEAD)[keyof typeof CALL_ALERT_LEAD] | undefined = CALL_ALERT_LEAD[outcome];
  if (!key) throw new Error(`composeCallAlertSms: no alert copy for outcome "${outcome}"`);
  const lead = t(m, key, language);
  const text = hasEmailRecipients ? `${lead}${emailHint(language)}` : lead;
  return language === "es" ? stripDiacritics(text) : text;
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
 * Phase 2: the send, through the SEND GATE (consent chain PR-1, kind
 * `operator.alert_sms`), and the only half with a carrier round trip in it.
 * The gate re-checks the sender, and the ledger too: a business owner who
 * texted STOP to their own business line gets no alerts from it (decision
 * 2). An alert keeps no hours. `pending.from` is the number prepare saw; the
 * gate resolves its own. NEVER throws — a failure is logged and swallowed
 * here so it can never cost the booking/call write it rides beside.
 *
 * Logs the provider message id AND the destination on SUCCESS too, not only
 * on failure (alert-send-report follow-up review, finding 5): no message row
 * exists for this send (0035's decision 3), so the console is its only record.
 */
export async function deliverAlertSms(
  db: SupabaseClient, accountId: string, pending: PendingAlertSms,
): Promise<void> {
  try {
    const result = await sendSms(db, { accountId, kind: "operator.alert_sms", to: pending.to, body: pending.body });
    if (result.kind === "sent") {
      console.error(`alert SMS sent for account ${accountId}: to ${result.to} providerMessageId ${result.providerMessageId}`);
      return;
    }
    const why = result.kind === "blocked" ? `not sent (${result.reason})`
      : result.kind === "failed" ? result.error : "deferred";
    console.error(`alert SMS send failed for account ${accountId}: ${why}`);
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
    await deliverAlertSms(db, accountId, pending);
  } catch (e) {
    console.error(`alert SMS send failed for account ${accountId}: ${String(e)}`);
  }
}
