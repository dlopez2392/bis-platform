import { Suspense } from "react";
import { headers } from "next/headers";
import {
  serviceDb, getOrCreateCalendar, getVoiceProfile,
  listClosedDaysFrom, listClosureAppointmentsForRanges, CLOSURE_APPOINTMENTS_LIMIT, countHeldByBooking,
  readAgendaJob, listPeopleNames, jobWasTold, getContact,
  type AgendaBookingRow, type ClosureAppointment,
} from "@bis/db";
import { recipientLanguage } from "@bis/db/spanish-box";
import { BackToSetup } from "@/components/back-to-setup";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { noteOpened } from "@/lib/access-log/note";
import { isUuid } from "@/lib/assign/action-guards";
import { makeTr } from "@/lib/record/copy";
import { parseAgendaParams } from "@/lib/booking/agenda-window";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { seesWholeAccount } from "@/lib/auth-role";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { dayKey, startOfDay, addDays } from "@/lib/business-status/status";
import { CalendarSettings } from "./calendar-settings";
import { AgendaCard } from "./agenda-card";
import { AgendaSkeleton } from "./agenda-skeleton";
import { agendaHref, buildJobDrawerView } from "./agenda-view";
import { JobDrawer, type JobDrawerView } from "./job-drawer";
import { ClosedDaysCard, type ClosedDaysRangeView } from "./closed-days-card";
import { EmbedSnippet } from "./embed-snippet";
import { FeedCard } from "./feed-card";
import { loadFeedCardView } from "./feed-card-data";
import { makeFeedLinkAction, replaceFeedLinkAction, turnOffFeedLinkAction, undoFeedLinkAction } from "./feed-actions";
import { updateCalendarSettingsAction, keepAppointmentAction } from "./actions";
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
  searchParams: Promise<{ from?: string; closedDay?: string; locale?: string; view?: string; day?: string; job?: string }>;
}) {
  const { accountId } = await params;
  // Set by the setup wizard's links, and by nothing else — the breadcrumb
  // below appears only for someone who arrived mid-flow. `closedDay`: a
  // To-do's `?closedDay={date}` (S-47d spec 5.5.1, 5.6.3) — the Closed days
  // card's own range opens already expanded.
  // F-046 part 1 (spec 5.1, 5.5): `view`, `day` and `job` drive the agenda and its drawer; a `job` that is not
  // a uuid is ignored, never read.
  const { from, closedDay, locale: localeParam, view: viewParam, day: dayParam, job: jobParam } = await searchParams;
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

  // ONE instant for the agenda, the drawer's "has it started?" (D-030) and today's key: nothing below reads
  // the clock again (Global constraint: no `Date.now()` during render).
  const nowIso = new Date().toISOString();
  const [account, h] = await Promise.all([
    db.from("accounts").select("timezone, language").eq("id", accountId).maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(`calendar: account lookup failed: ${error.message}`);
        if (!data) throw new Error("calendar: account not found");
        return data as { timezone: string; language: string | null };
      }),
    headers(),
  ]);

  // Read from the request, not an env var — same reasoning as the sibling
  // forms embed snippet: the origin has to match whatever host the operator
  // is actually on (localhost, a preview deploy, production).
  const proto = h.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${h.get("host") ?? "localhost:3000"}`;

  // F-048 part 2: the person's own calendar link. Never throws (its own error state).
  const feedView = await loadFeedCardView({ accountId, clerkUserId: userId, isAgency, role: access.role, origin });

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
    // Fix round (sonnet review, CHANGES REQUESTED): ONE query, but scoped to the ranges THEMSELVES, not
    // the enclosing span from the earliest start to the latest end — that first cut spent the shared
    // CLOSURE_APPOINTMENTS_LIMIT cap on every ORDINARY booking in the gap between two far-apart ranges
    // (a holiday next week, a vacation next spring), which no closure ever touched. `
    // listClosureAppointmentsForRanges` (packages/db) builds one `.or()` of per-range `and(gte, lt)`
    // predicates — a booking outside every listed range's own window is never fetched at all, so it
    // never spends a slot of the cap. Ranges never overlap (addClosedDayAction refuses an overlap), so
    // each returned appointment's start falls inside exactly one range's own window.
    let appointmentsByRange: ClosureAppointment[][];
    let capped = false;
    if (closedDays.length === 0) {
      appointmentsByRange = [];
    } else {
      const ranges = closedDays.map((r) => ({
        fromIso: startOfDay(r.starts_on, account.timezone).toISOString(),
        toIso: startOfDay(addDays(r.ends_on, 1), account.timezone).toISOString(),
      }));
      const allAppointments = await listClosureAppointmentsForRanges(db, accountId, ranges);
      // The read hit @bis/db's own row cap: there may be MORE affected appointments than this card can
      // show, on ANY of the listed ranges (the shared cap orders by starts_at ascending across all of
      // them, so there is no single range to blame) — the Closed days card's own "more later" caveat,
      // same spirit as the dashboard status card's (business-status-card-view.tsx), worded for a list of
      // ranges rather than one window ending on a known date.
      capped = allAppointments.length === CLOSURE_APPOINTMENTS_LIMIT;
      appointmentsByRange = ranges.map(({ fromIso, toIso }) => {
        const from = Date.parse(fromIso);
        const to = Date.parse(toIso);
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
      id: r.id, startsOn: r.starts_on, endsOn: r.ends_on, reason: r.reason, capped,
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

  // F-046 part 1 (spec 5.5, 8.2; plan correction 7): `?job=` opens one job's drawer. The job is read on the
  // CALLER's client (RLS: a Technician reads only their customers' jobs, R5) and, once it is known to be
  // theirs to see, its customer is noted as opened HERE, in the page, before any markup carries their name,
  // phone or address (the route walk pins the logger to the guard's own answer in this function). A job
  // the caller cannot see draws no drawer and notes nothing.
  const pseudo = requestPseudoMode({ locale: localeParam });
  let job: AgendaBookingRow | null = null;
  let jobRead: "none" | "ok" | "gone" | "failed" = "none";
  if (isUuid(jobParam)) {
    try {
      job = await readAgendaJob(db, accountId, jobParam);
      jobRead = job ? "ok" : "gone";
    } catch (e) {
      console.error(`calendar: job read failed for account ${accountId}: ${String(e)}`);
      jobRead = "failed";
    }
  }
  if (job) await noteOpened(access, accountId, { kind: "contact", recordId: job.contact_id });
  // A job with no `day` opens on its own day (spec 5.5).
  const { view, day } = parseAgendaParams(
    { view: viewParam, day: dayParam ?? (job ? dayKey(new Date(job.starts_at), account.timezone) : undefined) }, today,
  );
  const base = `/dashboard/accounts/${accountId}/calendar`;
  const canWrite = seesWholeAccount(access);
  let drawerView: JobDrawerView | null = null;
  if (job) {
    const row = job;
    const soft = <T,>(what: string, fallback: T) => (e: unknown): T => {
      console.error(`calendar: job drawer ${what} read failed for account ${accountId}: ${String(e)}`);
      return fallback;
    };
    const [names, jobPersona, told, contact] = await Promise.all([
      row.author_kind === "person" && row.author_id
        ? listPeopleNames(db, [row.author_id]).catch(soft<Record<string, string>>("names", {}))
        : Promise.resolve({}),
      row.author_kind === "ai"
        ? getVoiceProfile(db, accountId).then((v) => v?.persona_name?.trim() || null).catch(soft<string | null>("persona", null))
        : Promise.resolve(null),
      // Move's "Email {first} the new time" tick: unticked when we cannot tell (nothing proves they were told).
      jobWasTold(db, accountId, row.id).catch(soft("told", false)),
      getContact(db, accountId, row.contact_id).catch(soft<unknown>("contact", null)),
    ]);
    drawerView = buildJobDrawerView({
      row, now: new Date(nowIso), timezone: account.timezone, locale, pseudo, names, viewerId: userId, persona: jobPersona,
      calendarMeetingType: calendar.meeting_type, canWrite, told, accountId,
      // The Cancel dialog's starting language (Task 17, C18): the customer's, else the account's.
      language: recipientLanguage((contact as { language?: string | null } | null)?.language, account.language),
    });
  }
  const tr = makeTr(locale, pseudo);

  const boundUpdateSettings = updateCalendarSettingsAction.bind(null, accountId);
  const boundAddClosedDay = addClosedDayAction.bind(null, accountId);
  const boundRemoveClosedDay = removeClosedDayAction.bind(null, accountId);
  const boundKeepAppointment = keepAppointmentAction.bind(null, accountId);

  return (
    <>
      {from === "setup" ? <BackToSetup accountId={accountId} /> : null}
      <PageHeader title={t(m, "calendar.title", locale)} />
      <div className="space-y-6 p-6">
        {jobRead === "gone" || jobRead === "failed" ? (
          <p data-job-gone role="status" className="text-sm text-muted-foreground">
            {/* The job's own words: never the agenda's "Couldn't load your schedule" over an agenda that loaded. */}
            {tr.text(jobRead === "gone" ? "calendar.job.gone" : "calendar.job.readFailed")}
          </p>
        ) : null}
        {/* F-046 part 1 (spec 5.1): the agenda first and full width, streaming behind its own skeleton; Add job
            is its one primary, inside the card, never in PageHeader (rule 8, spec 14.1). */}
        <Suspense fallback={<AgendaSkeleton />}>
          <AgendaCard
            db={db} accountId={accountId} view={view} day={day} today={today} nowIso={nowIso}
            timezone={account.timezone} locale={locale} pseudo={pseudo} canAdd={canWrite} viewerId={userId}
            calendar={calendar} job={job ? job.id : null}
          />
        </Suspense>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">
            {canManage ? (
              <CalendarSettings isAgency={isAgency} calendar={calendar} action={boundUpdateSettings} />
            ) : null}
            <ClosedDaysCard
              accountId={accountId}
              locale={locale}
              pseudo={pseudo}
              canManage={canManage}
              canAct={canWrite}
              persona={persona}
              today={today}
              timezone={account.timezone}
              ranges={closedDaysView}
              initialOpenClosedDay={closedDay ?? null}
              addAction={boundAddClosedDay}
              removeAction={boundRemoveClosedDay}
              keepAction={boundKeepAppointment}
            />
          </div>
          <div className="space-y-6">
            <EmbedSnippet origin={origin} publicId={calendar.public_id} enabled={calendar.enabled} />
            <FeedCard
              view={feedView}
              locale={locale}
              pseudo={pseudo}
              make={makeFeedLinkAction.bind(null, accountId)}
              replace={replaceFeedLinkAction.bind(null, accountId)}
              turnOff={turnOffFeedLinkAction.bind(null, accountId)}
              undo={undoFeedLinkAction.bind(null, accountId)}
            />
          </div>
        </div>
      </div>
      {drawerView ? (
        <JobDrawer
          key={drawerView.id} accountId={accountId} view={drawerView} closeHref={agendaHref(base, { view, day })} timezone={account.timezone}
          locale={locale} pseudo={pseudo} calendarMeetingType={calendar.meeting_type} defaultMinutes={calendar.slot_duration_minutes}
        />
      ) : null}
    </>
  );
}
