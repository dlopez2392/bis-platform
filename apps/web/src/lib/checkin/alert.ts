import { getBranding, type JobCheckin, type SupabaseClient } from "@bis/db";
import { sendEmailOrThrow, type EmailRequest } from "@/lib/consent/email-gate";
import { emailBrand } from "@/lib/email/templates/shell";
import { checkinAlertEmail } from "@/lib/email/templates/checkin-alert";
import { configuredOrigin } from "@/lib/email/origin";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { resolveLocale } from "@/lib/i18n/locale";
import { loggableError } from "@/lib/loggable-error";

/**
 * The owner's "not great" alert (F-072; owner decision 2026-11-17): the booking calendar's own alert list
 * (`calendars.notify_emails`, the addresses that already get its new-booking mail) is emailed when a customer says the
 * job was not great. THE ONE SEND SITE of `operator.checkin_alert` (scans.test.ts pins that), shared by the answer
 * page and the 15-minute sweep, which each call it ONLY when `ensureCheckinTask` reported it CREATED the To-do: the
 * To-do's unique index is what makes "once" true, so a replay, a second tap or a sweep that finds the To-do already
 * there never gets here. The To-do is the record; this is the nudge.
 *
 * It NEVER throws and is bounded: it runs after the To-do exists and after the answer is recorded, inside a public
 * page's response, and nothing that goes wrong with an inbox may undo either or keep a customer waiting. A failure
 * is logged and counted in the result, and there is no retry (a second attempt could be a second email; the
 * idempotency key is the belt, never a reason to loop). Every read is by the CHECK-IN's own account.
 *
 * Operator mail follows the account's language and brand (never `accounts.name`), goes from the platform address
 * with no `fromAddress` (a client-domain-to-client-domain send is the shape corporate filters call spoofing, as the
 * booking and lead alerts reason), and shows no customer address or phone: the record behind the button has both.
 */
export const CHECKIN_ALERT_BUDGET_MS = 5000;

export type CheckinAlertOutcome = {
  sent: number;
  failed: number;
  /** Why nothing was attempted, or the attempt was abandoned. Absent when at least one address was tried. */
  skipped?: "no_recipients" | "unreadable" | "timed_out";
};

export type CheckinAlertDeps = {
  /** The gate. The page path leaves it out (the gate on the service client); the cron passes `ctx.email.send`. */
  send?: (req: EmailRequest) => Promise<unknown>;
  now?: Date;
};

/** The job's day, in the account's zone and language: weekday, month, day. Null when the zone is unusable or the
 *  instant is not a date: the sentence then names no day rather than a wrong one. */
function jobDay(startsAt: unknown, timezone: string | null, locale: "en" | "es"): string | null {
  const zone = resolveAccountZone(timezone);
  const at = typeof startsAt === "string" ? new Date(startsAt) : null;
  if (!zone || !at || Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" }).format(at);
}

async function recipientsOf(db: SupabaseClient, checkin: JobCheckin): Promise<{ emails: string[]; startsAt: unknown }> {
  const booking = await db.from("bookings").select("calendar_id, starts_at")
    .eq("account_id", checkin.accountId).eq("id", checkin.bookingId).maybeSingle();
  if (booking.error) throw new Error(`booking read failed: ${booking.error.message}`);
  const b = booking.data as { calendar_id: string | null; starts_at: unknown } | null;
  if (!b?.calendar_id) return { emails: [], startsAt: b?.starts_at ?? null };
  const cal = await db.from("calendars").select("notify_emails")
    .eq("account_id", checkin.accountId).eq("id", b.calendar_id).maybeSingle();
  if (cal.error) throw new Error(`calendar read failed: ${cal.error.message}`);
  const raw = (cal.data as { notify_emails: string[] | null } | null)?.notify_emails ?? [];
  const seen = new Set<string>();
  const emails = raw.map((e) => e.trim()).filter((e) => {
    const key = e.toLowerCase();
    if (!e || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { emails, startsAt: b.starts_at };
}

async function alertNow(db: SupabaseClient, checkin: JobCheckin, deps: CheckinAlertDeps): Promise<CheckinAlertOutcome> {
  const send = deps.send ?? ((req: EmailRequest) => sendEmailOrThrow(req, { db }));
  let prepared;
  try {
    const { emails, startsAt } = await recipientsOf(db, checkin);
    if (emails.length === 0) {
      console.error(`check-in alert: account ${checkin.accountId}, check-in ${checkin.id}: the booking's calendar has no addresses to alert (the To-do exists)`);
      return { sent: 0, failed: 0, skipped: "no_recipients" };
    }
    const [contact, account, branding] = await Promise.all([
      db.from("contacts").select("first_name, last_name").eq("account_id", checkin.accountId).eq("id", checkin.contactId).maybeSingle(),
      db.from("accounts").select("language, timezone").eq("id", checkin.accountId).maybeSingle(),
      getBranding(db, checkin.accountId),
    ]);
    if (contact.error) throw new Error(`contact read failed: ${contact.error.message}`);
    if (account.error) throw new Error(`account read failed: ${account.error.message}`);
    const c = contact.data as { first_name: string | null; last_name: string | null } | null;
    const a = account.data as { language: string | null; timezone: string | null } | null;
    const locale = resolveLocale(undefined, a?.language === "es" ? "es" : null);
    const origin = configuredOrigin();
    const brand = emailBrand(branding);
    const { subject, html, text } = checkinAlertEmail({
      brand,
      customerName: [c?.first_name, c?.last_name].map((s) => s?.trim()).filter(Boolean).join(" ") || null,
      day: jobDay(startsAt, a?.timezone ?? null, locale),
      contactUrl: origin ? `${origin}/dashboard/accounts/${checkin.accountId}/contacts/${checkin.contactId}` : null,
      locale,
    });
    prepared = { emails, brand, subject, html, text, locale };
  } catch (e) {
    console.error(`check-in alert: account ${checkin.accountId}, check-in ${checkin.id}: not prepared, nothing sent: ${loggableError(e)}`);
    return { sent: 0, failed: 1, skipped: "unreadable" };
  }

  const out: CheckinAlertOutcome = { sent: 0, failed: 0 };
  for (const to of prepared.emails) {
    try {
      await send({
        accountId: checkin.accountId, kind: "operator.checkin_alert", to, fromName: prepared.brand.name,
        subject: prepared.subject, body: prepared.text, html: prepared.html, language: prepared.locale,
        ...(deps.now ? { now: deps.now } : {}),
        // One key per check-in AND address: the provider deduplicates a repeat of the same request, and one shared key
        // across different recipients would read as a conflicting repeat.
        idempotencyKey: `checkin-alert/${checkin.id}/${to.toLowerCase()}`,
      });
      out.sent++;
    } catch (e) {
      out.failed++;
      console.error(`check-in alert: account ${checkin.accountId}, check-in ${checkin.id}: the send to ${to} failed: ${loggableError(e)}`);
    }
  }
  return out;
}

/** Emails the booking calendar's alert list that this check-in's customer said the job was not great. Never throws;
 *  gives up after CHECKIN_ALERT_BUDGET_MS (the caller is a public page or a cron tick that must go on). */
export async function alertOwnerOfNotGreat(db: SupabaseClient, checkin: JobCheckin, deps: CheckinAlertDeps = {}): Promise<CheckinAlertOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<CheckinAlertOutcome>((resolve) => {
    timer = setTimeout(() => {
      console.error(`check-in alert: account ${checkin.accountId}, check-in ${checkin.id}: gave up after ${CHECKIN_ALERT_BUDGET_MS} ms (the To-do exists)`);
      resolve({ sent: 0, failed: 1, skipped: "timed_out" });
    }, CHECKIN_ALERT_BUDGET_MS);
  });
  try {
    return await Promise.race([alertNow(db, checkin, deps).catch((e): CheckinAlertOutcome => {
      console.error(`check-in alert: account ${checkin.accountId}, check-in ${checkin.id}: ${loggableError(e)}`);
      return { sent: 0, failed: 1, skipped: "unreadable" };
    }), budget]);
  } finally {
    clearTimeout(timer);
  }
}
