import {
  claimJobHold, stampJobNoticeSent, getContact, getCalendarForAccount, getPlace, loadAccountBrandInfo, recipientLanguage,
  isAccountOutboundSuppressed, readEmailSuppression, serviceDb, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { sendEmailOrThrow, EmailNotSent, type EmailRequest } from "@/lib/consent/email-gate";
import type { SendEmailResult } from "@/lib/email/types";
import { emailBrand } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingConfirmationEmail, bookingConfirmationSubject, bookingRescheduledEmail, bookingRescheduledSubject,
} from "@/lib/email/templates/booking";
import { formatWhen, safeZone } from "@/lib/booking/time";
import { bookingCancelUrl, bookingMoveUrl } from "@/lib/booking/links";
import { calendarFileUrl } from "@/lib/booking/calendar-file";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { loggableError } from "@/lib/loggable-error";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";
import { emitJobHoldEvents } from "./job-hold-events";
import type { NoticeAvailability } from "./cancel-flow";

/**
 * F-046 part 1 (spec 6.5): a staff add or move is held for its Undo window; whoever settles the hold first
 * (this module's after() job, or the jobHolds cron pass) CLAIMS it (claimJobHold, booked rows only). The
 * claim IS the settle: it writes `hold_settled_at` before anything else happens, so a hold settles exactly
 * once whatever follows (a refused or failed send included), and listDueJobHolds never sees it again. Then
 * it writes the hold's events (D8: booking.created, and for a move the old row's cancel) and sends the email
 * the person ticked, through the email gate, in the customer's own language. Claim-then-send: a failed send
 * is logged and the drawer says so; it is NEVER retried, because a retry after an unclear send emails twice
 * (cancel-notice.ts's rule). A gate refusal (a suppressed account, a stopped or bounced address) is quiet:
 * the gate decided nothing should go. Never throws. Logs by booking id, never by address.
 */
export const JOB_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** `lost`: someone else holds the claim (the other settler, or the Undo deleted or moved the row).
 *  `quiet`: settled with no email (none wanted, or the gate refused it). `sent`: the email went.
 *  `failed`: settled, and the email that was wanted did not go. `too_late`: settled with no email, because
 *  the job has started or the hold fell due more than JOB_NOTICE_MAX_AGE_MS ago. */
export type JobHoldOutcome = "lost" | "quiet" | "sent" | "failed" | "too_late";

export type SettleDeps = {
  db: SupabaseClient; origin: string | null; now?: () => Date;
  /** The cron tick's own gate (`ctx.email.send`); absent = sendEmailOrThrow on `db`. The same gate. */
  send?: (req: EmailRequest) => Promise<SendEmailResult>;
};

const trimmed = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export async function settleJobHold(accountId: string, bookingId: string, deps: SettleDeps): Promise<JobHoldOutcome> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const tag = `job hold for booking ${bookingId} (account ${accountId})`;
  try {
    const claim = await claimJobHold(db, accountId, bookingId, now.toISOString());
    if (!claim) return "lost";
    if (claim.status !== "booked") return "quiet";      // defensive: claimJobHold claims booked rows only
    // D8, extended to moves (plan review): the hold's events are written here, once it is settled, never at
    // insert, so an add or a move undone inside its hold leaves none (job-hold-events.ts).
    try {
      await emitJobHoldEvents(db, accountId, claim);
    } catch (e) {
      console.error(`${tag}: the hold's events not recorded: ${loggableError(e)}`);
    }
    if (!claim.notice_wanted) return "quiet";
    if (!(Date.parse(claim.starts_at) > now.getTime())
      || !(Date.parse(claim.hold_until) > now.getTime() - JOB_NOTICE_MAX_AGE_MS)) return "too_late";

    const [contact, calendar, place, info] = await Promise.all([
      getContact(db, accountId, claim.contact_id) as Promise<{ email?: string | null; language?: string | null } | null>,
      getCalendarForAccount(db, accountId),
      claim.place_id ? getPlace(db, accountId, claim.place_id) : Promise.resolve(null),
      loadAccountBrandInfo(db, [accountId], "settleJobHold").then((m) => m.get(accountId)!),
    ]);
    const to = trimmed(contact?.email);
    if (!contact || !to || !calendar) {
      console.error(`${tag}: nothing to send to (no contact email or no calendar)`);
      return "failed";
    }
    const locale = recipientLanguage(contact.language ?? null, info.accountLanguage);
    const brand = emailBrand(info.branding);
    // The booking's own zone first (a staff move of a customer's booking keeps the zone they booked in), the
    // company's under it when it reads differently: the customer's own move email's rule (move/[token]/actions.ts).
    const startsAt = new Date(claim.starts_at);
    const bookerZone = safeZone(claim.booker_timezone ?? undefined, info.accountTimezone);
    const whenBookerZone = formatWhen(startsAt, bookerZone, locale);
    const whenCompanyZone = formatWhen(startsAt, info.accountTimezone, locale);
    // Owner decision 4: the address, on one line. The job's own "what" (its note) is never read here.
    const where = [trimmed(place?.label), trimmed(place?.address)].filter((x): x is string => x !== null).join(" · ");
    const links = {
      cancelUrl: bookingCancelUrl(deps.origin, calendar.public_id, claim.cancel_token, locale),
      calendarUrl: calendarFileUrl(deps.origin, calendar.public_id, claim.cancel_token, locale),
      // The move page answers "offline" on a disabled calendar (move/[token]/data.ts): no link then.
      moveUrl: calendar.enabled ? bookingMoveUrl(deps.origin, calendar.public_id, claim.cancel_token, locale) : "",
    };
    const common = {
      brand, locale, whenBookerZone, whenCompanyZone, meetingUrl: claim.meeting_url ?? undefined, where, ...links,
    };
    const confirmation = claim.notice_wanted === "confirmation";
    const { html, text } = confirmation ? bookingConfirmationEmail(common) : bookingRescheduledEmail(common);
    const send = deps.send ?? ((req: EmailRequest) => sendEmailOrThrow(req, { db }));
    try {
      await send({
        accountId, kind: confirmation ? "staff.booking_confirmation" : "staff.booking_moved",
        contactId: claim.contact_id, language: locale, origin: deps.origin, to,
        fromName: brand.name, fromAddress: info.fromEmail ?? undefined, replyTo: normalizeReplyTo(info.replyToEmail),
        subject: confirmation ? bookingConfirmationSubject(locale) : bookingRescheduledSubject(locale), body: text, html,
      });
    } catch (e) {
      if (e instanceof EmailNotSent && e.result.kind === "blocked") {
        // The gate refused (a suppressed account, a stop, a bounce): settled by the claim above, no email.
        console.error(`${tag}: the ${claim.notice_wanted} email was not sent, the email gate refused it: ${e.result.reason}`);
        return "quiet";
      }
      console.error(`${tag}: the ${claim.notice_wanted} email was not sent: ${loggableError(e)}`);
      return "failed";
    }
    const stamped = await stampWithRetry(() => stampJobNoticeSent(db, accountId, bookingId));
    if (!stamped.stamped) console.error(`${tag}: sent, but notice_sent_at was not stamped: ${loggableError(stamped.lastError)}`);
    return "sent";
  } catch (e) {
    console.error(`${tag} failed: ${loggableError(e)}`);
    return "failed";
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The after() job: waits out the Undo window and its grace, then settles. Never throws. */
export async function settleAfterWindow(accountId: string, bookingId: string, origin: string | null,
  deps: { db?: SupabaseClient; sleep?: (ms: number) => Promise<void>; waitMs?: number } = {}): Promise<JobHoldOutcome> {
  // waitMs: the Undo of a move re-arms its restored row with the time left on that row's own hold (T10).
  await (deps.sleep ?? realSleep)(deps.waitMs ?? UNDO_WINDOW_MS + NOTICE_GRACE_MS);
  return settleJobHold(accountId, bookingId, { db: deps.db ?? serviceDb(), origin });
}

/** Spec 5.4: whether a confirmation can go to this customer at all (cancelNoticeAvailability's checks, by
 *  contact). `readDb` reads the contact as the signed-in user; `writer` reads the two suppression facts as
 *  the email gate does. THROWS on a read error; callers fail open to "none". */
export async function jobNoticeAvailability(readDb: SupabaseClient, writer: SupabaseClient,
  accountId: string, contactId: string): Promise<NoticeAvailability> {
  const contact = await getContact(readDb, accountId, contactId) as { email?: string | null } | null;
  const to = emailLedgerAddress(contact?.email ?? null);
  if (!to) return "no_email";
  if (await isAccountOutboundSuppressed(writer, accountId)) return "suppressed_account";
  if (await readEmailSuppression(writer, accountId, to)) return "address_blocked";
  return "available";
}
