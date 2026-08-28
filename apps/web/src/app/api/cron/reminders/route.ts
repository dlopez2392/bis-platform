import { timingSafeEqual } from "node:crypto";
import { serviceDb, listDueReminders, stampReminderSent } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { configuredOrigin } from "@/lib/email/origin";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";

export const dynamic = "force-dynamic";

/**
 * The platform's first scheduled job: Vercel hits this once a day
 * (`vercel.json`'s `crons` entry, `0 14 * * *` — the Hobby plan REJECTS any
 * deployment carrying a sub-daily schedule) to mail bookers a reminder for
 * every booking in the day ahead. `listDueReminders` sizes its query window
 * to this cadence; if the schedule ever returns to every-15-minutes, narrow
 * the window there too or every booker gets their reminder a day early.
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

  // Constant-time compare, mirroring guards.ts's verifyRenderToken: a
  // straight `!==` leaks how many leading bytes matched via response timing,
  // and this header is a bearer credential, not a public token. Length is
  // checked first — timingSafeEqual throws on mismatched buffer lengths
  // rather than returning false, and comparing a wrong-length header would
  // otherwise be an unhandled crash instead of a clean 401.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response(null, { status: 401 });
  }

  // No headers()/originFrom here — this is a cron invocation, not a browser
  // request forwarded through Vercel's edge, so there is no forwarded-host
  // chain to trust or distrust. APP_ORIGIN wins when set (the custom domain,
  // matching what a real visitor's Host header carries); req.url's origin is
  // only the FALLBACK — and that fallback IS the deployment's own vercel.app
  // URL, the exact link/sender mismatch Gmail silently discarded mail over
  // (closed 2026-08-27; see origin.ts's doc comment).
  const origin = configuredOrigin() ?? new URL(req.url).origin;

  const db = serviceDb();
  const reminders = await listDueReminders(db, new Date().toISOString());
  const provider = getEmailProvider();

  let sent = 0;
  let failed = 0;
  let unstamped = 0;

  for (const reminder of reminders) {
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. Stamping before a send that then
    // fails would silence that reminder forever — the next cron tick could
    // never pick it back up. A send failure here is counted in `failed` and
    // logged, and the row stays unstamped so `listDueReminders` returns it
    // again next tick.
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

      // A send that already left the building counts as `sent` no matter
      // what happens next — folding the stamp into the outer catch would
      // misreport a stamp failure as a send failure in triage. Its own
      // try/catch here means a stamp failure can't silently look identical
      // to a send failure, and can't roll back the `sent` count either.
      // The cost is real: the row stays unstamped, so `listDueReminders`
      // treats it as still due and this booker gets a duplicate reminder
      // next tick. Duplicate over silence is the chosen direction (a repeat
      // email is recoverable; a reminder that never fires again is not) —
      // logged distinctly so it's visible in triage instead of masquerading
      // as either a normal success or a send failure.
      try {
        await stampReminderSent(db, reminder.bookingId);
      } catch (stampErr) {
        unstamped++;
        console.error(
          `reminder sent but NOT stamped for booking ${reminder.bookingId} — may repeat next tick: ${String(stampErr)}`,
        );
      }

      sent++;
    } catch (e) {
      failed++;
      console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
    }
  }

  return Response.json({ sent, failed, unstamped });
}
