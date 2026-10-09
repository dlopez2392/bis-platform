import { headers } from "next/headers";
import { serviceDb, getOrCreateCalendar, listCalendarBookings } from "@bis/db";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { CalendarSettings } from "./calendar-settings";
import { BookingsList } from "./bookings-list";
import { EmbedSnippet } from "./embed-snippet";
import {
  updateCalendarSettingsAction, setBookingStatusAction, cancelNoticeOptionAction, cancelBookingAction,
  undoCancelBookingAction,
} from "./actions";

export const dynamic = "force-dynamic";
// F-048: Cancel's customer notice waits out the Undo window inside the
// cancel's own invocation (`after()` in `cancelBookingAction`), and server
// actions run in this page's function. Fluid compute's default (300 s) would
// already cover it; this keeps the ceiling EXPLICIT, so turning Fluid off
// (a much lower default) cannot quietly cut the notice off, and 60 s outlasts
// the 15 s wait with room for the reads and the send while still bounding a
// runaway render. `cancel-notice.test.ts` pins the margin.
export const maxDuration = 60;

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

  // ONE instant for the list and for the rows' "has it started?" (D-030), so
  // a row the list carries as started always offers its outcome buttons.
  const nowIso = new Date().toISOString();
  const [account, bookings, h] = await Promise.all([
    db.from("accounts").select("timezone").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`calendar: account lookup failed: ${error.message}`);
        if (!data) throw new Error("calendar: account not found");
        return data as { timezone: string };
      }),
    listCalendarBookings(db, accountId, nowIso),
    headers(),
  ]);

  // Read from the request, not an env var — same reasoning as the sibling
  // forms embed snippet: the origin has to match whatever host the operator
  // is actually on (localhost, a preview deploy, production).
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  const boundUpdateSettings = updateCalendarSettingsAction.bind(null, accountId);
  const boundSetStatus = setBookingStatusAction.bind(null, accountId);
  const boundNoticeOption = cancelNoticeOptionAction.bind(null, accountId);
  const boundCancel = cancelBookingAction.bind(null, accountId);
  const boundUndoCancel = undoCancelBookingAction.bind(null, accountId);

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
            nowIso={nowIso}
            statusAction={boundSetStatus}
            noticeOptionAction={boundNoticeOption}
            cancelAction={boundCancel}
            undoCancelAction={boundUndoCancel}
          />
        </div>
        <EmbedSnippet origin={origin} publicId={calendar.public_id} enabled={calendar.enabled} />
      </div>
    </>
  );
}
