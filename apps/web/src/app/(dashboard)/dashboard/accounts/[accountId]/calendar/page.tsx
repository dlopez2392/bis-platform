import { headers } from "next/headers";
import {
  serviceDb, getOrCreateCalendar, listCalendarBookings, getVoiceProfile,
  listClosedDaysFrom, listClosureAppointments, countHeldByBooking, type ClosureAppointment,
} from "@bis/db";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { seesWholeAccount } from "@/lib/auth-role";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { dayKey, startOfDay, addDays } from "@/lib/business-status/status";
import { CalendarSettings } from "./calendar-settings";
import { BookingsList } from "./bookings-list";
import { ClosedDaysCard, type ClosedDaysRangeView } from "./closed-days-card";
import { EmbedSnippet } from "./embed-snippet";
import {
  updateCalendarSettingsAction, setBookingStatusAction, cancelNoticeOptionAction, cancelBookingAction,
  undoCancelBookingAction, keepAppointmentAction,
} from "./actions";
import { addClosedDayAction, removeClosedDayAction } from "./closed-days-actions";

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
  searchParams: Promise<{ from?: string; closedDay?: string; locale?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow. `closedDay`: a
  // To-do's `?closedDay={date}` (S-47d spec 5.5.1, 5.6.3) — the Closed days
  // card's own range opens already expanded.
  const { from, closedDay, locale: localeParam } = await searchParams;
  // Both audiences — calendar is the client's own business data, the same
  // class of surface `requireAccountAccess` already gates contacts with.
  // `canManage` (Task 7, staff and roles): the agency and a client Owner
  // only — Staff still work bookings below, but never sees the settings
  // form at all (not read-only: the brief's own wording).
  const access = await requireAccountAccess(accountId);
  const { userId, isAgency, canManage } = access;
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
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`calendar: account lookup failed: ${error.message}`);
        if (!data) throw new Error("calendar: account not found");
        return data as { timezone: string; language: string | null };
      }),
    listCalendarBookings(db, accountId, nowIso),
    headers(),
  ]);

  // Read from the request, not an env var — same reasoning as the sibling
  // forms embed snippet: the origin has to match whatever host the operator
  // is actually on (localhost, a preview deploy, production).
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  // Named variable, not an inline literal: request-locale-callers.test.ts scans each call's own
  // braces (ai-section.tsx's own comment on why). The explicit `Locale | null` annotation on `language`
  // (ai-section.tsx's own shape) is load-bearing: without it TS widens the ternary's narrowed
  // `"en" | "es"` branch back to `string` when it is only read through `account.language` again.
  const raw = account.language;
  const language: Locale | null = raw === "en" || raw === "es" ? raw : null;
  const accountLanguage = { language };
  const prefs = await getPersonPrefs();
  const locale: Locale = requestLocale(
    { account: accountLanguage, isOperator: isAgency, userLanguage: prefs.language }, { locale: localeParam },
  );

  // S-47d Task 12 (spec 5.6.3): the Closed days card's own reads, on THIS page's db — a failed read is
  // the card's own error state (DESIGN.md rule 5), never the page's; `ranges: null` is that signal
  // (`[]` means genuinely none).
  const today = dayKey(new Date(nowIso), account.timezone);
  let closedDaysView: ClosedDaysRangeView[] | null;
  try {
    const closedDays = await listClosedDaysFrom(db, accountId, today);
    // minors-1b item 5: ONE query over the union of every listed range's own window (up to 100 ranges,
    // listClosedDaysFrom's own cap), not one per range — each range's own slice is then taken from that
    // single result in code. Ranges never overlap (addClosedDayAction refuses an overlap), so an
    // appointment's start falls inside at most one range's own [from, to); a start in the GAP between two
    // non-adjacent ranges matches neither and is correctly dropped. Known tradeoff, not yet surfaced in
    // this card: `listClosureAppointments`'s own CLOSURE_APPOINTMENTS_LIMIT orders by starts_at ascending,
    // so a wide union whose EARLY ranges alone exceed the cap could starve a LATER range's count — the
    // dashboard status card's own "more later" notice (business-status-card.tsx) does not read this card.
    let appointmentsByRange: ClosureAppointment[][];
    if (closedDays.length === 0) {
      appointmentsByRange = [];
    } else {
      const minStart = closedDays.reduce((min, r) => (r.starts_on < min ? r.starts_on : min), closedDays[0]!.starts_on);
      const maxEnd = closedDays.reduce((max, r) => (r.ends_on > max ? r.ends_on : max), closedDays[0]!.ends_on);
      const unionFrom = startOfDay(minStart, account.timezone);
      const unionTo = startOfDay(addDays(maxEnd, 1), account.timezone);
      const allAppointments = await listClosureAppointments(db, accountId, unionFrom.toISOString(), unionTo.toISOString());
      appointmentsByRange = closedDays.map((r) => {
        const from = startOfDay(r.starts_on, account.timezone).getTime();
        const to = startOfDay(addDays(r.ends_on, 1), account.timezone).getTime();
        return allAppointments.filter((a) => {
          const t = new Date(a.starts_at).getTime();
          return t >= from && t < to;
        });
      });
    }
    // Fix round C8: "{n} messages waiting" on every listed row, as the dashboard card shows it — ONE read
    // for every listed booking, on this page's db (RLS-enforced), scoped to the account. Inside this same
    // try: a failed count is the card's own error state, never a row silently reading "none waiting".
    const bookingIds = appointmentsByRange.flat().map((a) => a.id);
    const held = bookingIds.length > 0
      ? await countHeldByBooking(db, accountId, bookingIds)
      : new Map<string, number>();
    closedDaysView = closedDays.map((r, i) => ({
      id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason,
      appointments: appointmentsByRange[i]!.map((a) => ({
        id: a.id, contactId: a.contact_id,
        contactName: `${a.first_name ?? ""} ${a.last_name ?? ""}`.trim(),
        startsAt: a.starts_at, kept: a.closure_kept_at !== null, held: held.get(a.id) ?? 0,
      })),
    }));
  } catch (e) {
    console.error(`calendar: closed days read failed for account ${accountId}: ${String(e)}`);
    closedDaysView = null;
  }

  // Only read for the empty state's "…and {persona} will know" sentence (closedDays.empty). Fix round D3
  // (SD19): never a typed "Sofía" — an account with no voice profile, a blank persona or a failed read all
  // pass `null`, and the card says the sentence that names no one (closedDays.emptyNoPersona).
  let persona: string | null = null;
  if (closedDaysView !== null && closedDaysView.length === 0) {
    try {
      const profile = await getVoiceProfile(db, accountId);
      persona = profile?.persona_name?.trim() || null;
    } catch (e) {
      console.error(`calendar: persona read failed for account ${accountId}: ${String(e)}`);
    }
  }

  const boundUpdateSettings = updateCalendarSettingsAction.bind(null, accountId);
  const boundSetStatus = setBookingStatusAction.bind(null, accountId);
  const boundNoticeOption = cancelNoticeOptionAction.bind(null, accountId);
  const boundCancel = cancelBookingAction.bind(null, accountId);
  const boundUndoCancel = undoCancelBookingAction.bind(null, accountId);
  const boundAddClosedDay = addClosedDayAction.bind(null, accountId);
  const boundRemoveClosedDay = removeClosedDayAction.bind(null, accountId);
  const boundKeepAppointment = keepAppointmentAction.bind(null, accountId);

  return (
    <>
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={m["calendar.title"]} />
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {canManage ? (
            <CalendarSettings isAgency={isAgency} calendar={calendar} action={boundUpdateSettings} />
          ) : null}
          <ClosedDaysCard
            accountId={accountId}
            locale={locale}
            pseudo={requestPseudoMode({ locale: localeParam })}
            canManage={canManage}
            canAct={seesWholeAccount(access)}
            persona={persona}
            today={today}
            timezone={account.timezone}
            ranges={closedDaysView}
            initialOpenClosedDay={closedDay ?? null}
            addAction={boundAddClosedDay}
            removeAction={boundRemoveClosedDay}
            keepAction={boundKeepAppointment}
          />
          <BookingsList
            accountId={accountId}
            timezone={account.timezone}
            bookings={bookings}
            nowIso={nowIso}
            accountLanguage={account.language === "en" || account.language === "es" ? account.language : null}
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
