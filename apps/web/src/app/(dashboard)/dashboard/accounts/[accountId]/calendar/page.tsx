import { headers } from "next/headers";
import { serviceDb, getOrCreateCalendar, listUpcomingBookings } from "@bis/db";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { CalendarSettings } from "./calendar-settings";
import { BookingsList } from "./bookings-list";
import { EmbedSnippet } from "./embed-snippet";
import { updateCalendarSettingsAction, setBookingStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow.
  const { from } = await searchParams;
  // Both audiences — calendar is the client's own business data, the same
  // class of surface `requireAccountAccess` already gates contacts with.
  const { userId, isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  // Lazy row: this is the first thing on the account that touches the
  // calendar, and `getOrCreateCalendar` INSERTs the row on a cold account.
  // `booking-grants.test.ts` pins exactly which columns `authenticated` may
  // UPDATE on `calendars` and grants it NO insert-relevant identity-column
  // access at all, so `dbForRequest()` cannot carry this call for either
  // audience — serviceDb() ONLY here, for that reason. Every other read and
  // write on this page goes through `db` above, RLS-enforced, per the
  // in-account-surface rule (RLS stays the backstop against a missed
  // account scope).
  const calendar = await getOrCreateCalendar(serviceDb(), accountId, userId);

  const [account, bookings, h] = await Promise.all([
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`calendar: account lookup failed: ${error.message}`);
        if (!data) throw new Error("calendar: account not found");
        return data as { timezone: string };
      }),
    listUpcomingBookings(db, accountId, new Date().toISOString()),
    headers(),
  ]);

  // Read from the request, not an env var — same reasoning as the sibling
  // forms embed snippet: the origin has to match whatever host the operator
  // is actually on (localhost, a preview deploy, production).
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  const boundUpdateSettings = updateCalendarSettingsAction.bind(null, accountId);
  const boundSetStatus = setBookingStatusAction.bind(null, accountId);

  return (
    <>
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={m["calendar.title"]} />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <CalendarSettings isAgency={isAgency} calendar={calendar} action={boundUpdateSettings} />
          <BookingsList
            accountId={accountId}
            timezone={account.timezone}
            bookings={bookings}
            statusAction={boundSetStatus}
          />
        </div>
        <EmbedSnippet origin={origin} publicId={calendar.public_id} enabled={calendar.enabled} />
      </div>
    </>
  );
}
