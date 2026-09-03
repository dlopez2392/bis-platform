"use server";

import {
  serviceDb, cancelBookingByToken, getContact,
  ensureConversation, createMessage, incrementUnreadCount, type BookingRow,
  type Branding,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { emailBrand } from "@/lib/email/templates/shell";
import { formatWhen } from "@/lib/booking/time";
import { normalizeLocale } from "@/lib/forms/public-strings";
import { bookingStrings } from "@/lib/booking/public-strings";

export type CancelResult = { ok: true } | { ok: false; error: string };

// Same pair, same reasoning, as the sibling submit action: nothing this
// module writes may be audit-logged as actor_type='user' — a public,
// unauthenticated capability link is never a signed-in user acting.
const ACTOR_ID = "public";
const ACTOR_TYPE = "system";

const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, "
  + "cancel_token, booker_timezone, reminder_sent_at";

/**
 * Read-only lookup by token — a plain SELECT, no `.update()` anywhere in this
 * function. This is the accessor that lets `page.tsx` distinguish "never
 * existed" from "already cancelled" from "booked" from "already happened" on
 * a GET, without touching a row: `cancelBookingByToken` (Task 2) collapses
 * the first two into a single `null`, which is exactly right for ITS job
 * (idempotent cancel) and exactly wrong for a page that needs to render four
 * different states.
 *
 * Deliberately NOT added to `packages/db` — this task makes no DDL/package
 * changes. It is a strong candidate to move there once a second caller needs
 * it (booking-grants/read-model work is the obvious next one), noted for the
 * final review rather than done speculatively here.
 */
export async function lookupBookingByToken(
  db: ReturnType<typeof serviceDb>, token: string,
): Promise<BookingRow | null> {
  const { data, error } = await db.from("bookings")
    .select(BOOKING_COLS).eq("cancel_token", token).maybeSingle();
  if (error) throw new Error(`lookupBookingByToken failed: ${error.message}`);
  return (data as unknown as BookingRow | null) ?? null;
}

/** Same subject-injection guard `b/[publicId]/actions.ts` keeps — duplicated
 *  rather than imported because it is two lines and private there; promoting
 *  it would be a bigger change than this task's scope for no real gain. */
function stripSubjectControlChars(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ");
}

type AccountRow = {
  name: string | null; timezone: string | null;
  brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
  brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
  brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
};

/** Only the columns this action's notify email and when-strings need — a
 *  narrower projection than the sibling's `loadAccount` (no from/reply-to:
 *  this send, like the sibling's alert loop, never carries a `fromAddress`). */
async function loadAccount(
  db: ReturnType<typeof serviceDb>, accountId: string,
): Promise<AccountRow | null> {
  const { data, error } = await db.from("accounts")
    .select("name, timezone, brand_name, brand_logo_path, brand_color, brand_neutral, "
      + "brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`loadAccount(${accountId}) failed: ${error.message}`);
  return data as AccountRow | null;
}

/**
 * CRITICAL: notify recipients must be resolved from `row.calendar_id` — the
 * calendar the booking ACTUALLY belongs to — never from the URL's
 * `publicId`. `publicId` is a caller-supplied path segment; anyone holding a
 * legitimate cancel link can edit it to name a different company's public
 * calendar id while the token in that same URL still resolves to (and
 * cancels) their OWN booking. Resolving recipients via
 * `getCalendarByPublicId(db, publicId)` would then notify a STRANGER's staff
 * with this contact's name, time and note, while the real company never
 * hears the booking was cancelled at all — cross-tenant PII disclosure.
 * `calendar_id` is intrinsic to the row `cancelBookingByToken` already
 * returned above; nothing in the request URL can steer it.
 *
 * Narrower than `getCalendarByPublicId`'s full `CalendarRow` on purpose —
 * `notify_emails` is the only thing this needs, so that's the one column
 * requested, not a public-path accessor repurposed for an internal lookup.
 */
async function loadCalendarNotifyEmails(
  db: ReturnType<typeof serviceDb>, calendarId: string,
): Promise<string[]> {
  const { data, error } = await db.from("calendars")
    .select("notify_emails").eq("id", calendarId).maybeSingle();
  if (error) throw new Error(`loadCalendarNotifyEmails(${calendarId}) failed: ${error.message}`);
  return (data as { notify_emails?: string[] } | null)?.notify_emails ?? [];
}

/**
 * The cancel-by-link submit path, and the ONLY place in this route tree that
 * mutates — `page.tsx`'s GET is a pure read (see `lookupBookingByToken`
 * above). A mail scanner that prefetches every link in an inbox to check for
 * malware would otherwise cancel a booking nobody asked to cancel; splitting
 * the mutation into a POST-only form action is the whole reason this page
 * exists instead of a cancel-on-GET redirect.
 */
export async function confirmCancelAction(
  publicId: string, token: string, locale: string = "en",
): Promise<CancelResult> {
  // Bound by `page.tsx` from the resolved `?locale=`; a server action is a
  // public endpoint, so an unknown value is English, never an exception.
  const s = bookingStrings(normalizeLocale(locale, "en"));
  try {
    const db = serviceDb();

    // Re-verified here, not trusted from whatever `page.tsx` last rendered —
    // a second tab, a double-click, or a race with another cancel attempt can
    // all land between that read and this submit. `cancelBookingByToken`
    // returns `null` for BOTH an unknown token and an already-cancelled one
    // (deliberate — see its own doc comment); either way there is nothing
    // left to cancel, so this branch is the idempotent success, not an error.
    const row = await cancelBookingByToken(db, token, ACTOR_TYPE);
    if (!row) return { ok: true };

    // Best-effort from here: the cancellation already committed above (the
    // booking is real and free either way). A failure in the thread append
    // or the notify email must never turn an already-cancelled booking into
    // a reported failure — the same invariant the sibling submit action's
    // post-insert block documents.
    try {
      const account = await loadAccount(db, row.account_id);
      const timezone = account?.timezone ?? "UTC";
      const whenCompanyZone = formatWhen(new Date(row.starts_at), timezone);

      const contact = await getContact(db, row.account_id, row.contact_id);
      const contactName = contact
        ? ([contact.first_name, contact.last_name].filter(Boolean).join(" ").trim()
          || contact.email || "Someone")
        : "Someone";

      const convo = await ensureConversation(db, row.account_id, row.contact_id, ACTOR_ID, ACTOR_TYPE);
      await createMessage(db, row.account_id, {
        conversationId: convo.id, channel: "form", direction: "inbound",
        subject: "Booking cancelled", body: `Cancelled their ${whenCompanyZone} booking`,
      }, ACTOR_ID, ACTOR_TYPE);
      await incrementUnreadCount(db, row.account_id, convo.id);

      // `loadCalendarNotifyEmails` selects only `notify_emails` — no
      // `enabled` column at all, deliberately: a disabled calendar stops NEW
      // bookings (`submitBookingAction` gates on `enabled`); it must never
      // stop cancelling a booking that already exists. Cancelling closes
      // something out, it doesn't open anything new, so there is nothing
      // left here to gate on.
      const notifyEmails = await loadCalendarNotifyEmails(db, row.calendar_id);
      if (notifyEmails.length > 0) {
        const brand = emailBrand({
          brandName: account?.brand_name ?? null, brandLogoPath: account?.brand_logo_path ?? null,
          brandColor: account?.brand_color ?? null, brandNeutral: account?.brand_neutral ?? null,
          brandCorners: account?.brand_corners ?? null, brandType: account?.brand_type ?? null,
          brandMode: account?.brand_mode ?? null, replyToEmail: null,
        }, account?.name ?? "BIS");

        const subject = `Booking cancelled: ${stripSubjectControlChars(whenCompanyZone)}`
          + ` — ${stripSubjectControlChars(contactName)}`;
        const body = [
          `${contactName} cancelled their booking.`, "",
          `When: ${whenCompanyZone}`,
          ...(row.note ? [`Note: ${row.note}`] : []),
        ].join("\n");

        const provider = getEmailProvider();
        const failures: string[] = [];
        for (const to of notifyEmails) {
          try {
            // No fromAddress — same deliverability reasoning as the booking
            // alert (`b/[publicId]/actions.ts`): this goes to the client's
            // OWN staff, and a client-domain-to-client-domain send through a
            // third-party sender reads as spoofing to corporate filters.
            await provider.send({ to, fromName: brand.name, subject, body });
          } catch (e) {
            failures.push(`${to} (${e instanceof Error ? e.message : String(e)})`);
          }
        }
        if (failures.length > 0) {
          console.error(`booking ${row.id} cancel notify failed for ${failures.join(", ")}`);
        }
      }
    } catch (e) {
      console.error(`booking ${row.id} cancel thread/notify failed: ${String(e)}`);
    }

    return { ok: true };
  } catch (e) {
    console.error(`confirmCancelAction ${publicId} failed: ${String(e)}`);
    return { ok: false, error: s.cancelGenericError };
  }
}
