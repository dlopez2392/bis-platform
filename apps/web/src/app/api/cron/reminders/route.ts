import { serviceDb, listDueReminders, stampReminderSent } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/app/b/[publicId]/actions";

export const dynamic = "force-dynamic";

/**
 * The platform's first scheduled job: Vercel hits this every 15 minutes
 * (`vercel.json`'s `crons` entry) to mail bookers a reminder ~24h out.
 *
 * AUTH is two separate failure modes, not one:
 *  - `CRON_SECRET` unset → 503, zero queries. An unguarded cron route must
 *    refuse to exist rather than run open while danlo is mid-setup — this is
 *    the designed failure until he adds the env var in Vercel.
 *  - a request whose `authorization` header doesn't match → 401, zero
 *    queries. Vercel attaches `Bearer ${CRON_SECRET}` automatically once the
 *    env var exists; anything else is not a cron invocation.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  // No headers()/originFrom here — this is a cron invocation, not a browser
  // request forwarded through Vercel's edge, so there is no forwarded-host
  // chain to trust or distrust. req.url's origin IS the deployment's own.
  const origin = new URL(req.url).origin;

  const db = serviceDb();
  const reminders = await listDueReminders(db, new Date().toISOString());
  const provider = getEmailProvider();

  let sent = 0;
  let failed = 0;

  for (const reminder of reminders) {
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. Stamping before a send that then
    // fails would silence that reminder forever — the next cron tick could
    // never pick it back up. A failure here is counted and logged, and the
    // row stays unstamped so `listDueReminders` returns it again next tick.
    try {
      if (!reminder.contactEmail) {
        throw new Error("no contact email on file");
      }

      const brand = emailBrand(reminder.branding, reminder.accountName);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
      const cancelUrl = `${origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

      const { html, text } = bookingReminderEmail({ brand, whenBookerZone, cancelUrl });

      // fromAddress carries the account's sending address: a reminder is
      // customer-facing outbound, same shape as the booking confirmation
      // (`submitBookingAction` in `b/[publicId]/actions.ts`) — not the
      // staff-facing lead alert, which deliberately omits it.
      await provider.send({
        to: reminder.contactEmail,
        fromName: brand.name,
        fromAddress: reminder.fromEmail ?? undefined,
        replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
        subject: "Reminder: your upcoming booking",
        body: text,
        html,
      });

      await stampReminderSent(db, reminder.bookingId);
      sent++;
    } catch (e) {
      failed++;
      console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
    }
  }

  return Response.json({ sent, failed });
}
