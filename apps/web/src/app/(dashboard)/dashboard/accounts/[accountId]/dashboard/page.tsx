import Link from "next/link";
import { ListChecks } from "lucide-react";
import {
  listChecklistState, countContacts,
  getVoiceProfile, getCalendarForAccount, listCalls, listRecentEvents,
  listCallStartsBetween, listBookingCreationsBetween, listOpportunityValuesCreatedBetween,
  getA2pRegistration, listAccountWork,
} from "@bis/db";
import { StatTile } from "@/components/stat-tile";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { getTenantBranding } from "@/lib/branding/tenant-theme-reader";
import { renderZone } from "@/lib/zone";
import { ZoneNote } from "@/components/zone-note";
import { normalizeOpenHours } from "@/lib/booking/slots";
import { bucketWork } from "@/lib/work/buckets";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { greetingPeriod, formatLocalLongDate } from "@/lib/dashboard/greeting";
import { localDayWindow, bucketByLocalDay, bucketValueByLocalDay, deltaVsPrior, countAfterHours } from "@/lib/dashboard/metrics";
import { CallsChartCard } from "./calls-chart-card";
import { ActivityCard } from "./activity-card";
import { ChecklistRow } from "./checklist-row";
import { WorkRowCard } from "./work-row";

// The activity card curates a small set of known event types out of a much
// noisier raw ledger (CRM housekeeping, setup plumbing, …) — see
// activity-card.tsx's own curation-map comment. Fetching well past its
// DISPLAY_LIMIT (8) means a day full of contact edits between two real
// bookings still surfaces both bookings, instead of the feed silently
// emptying because the newest 8 RAW rows all happened to be skipped types.
const RECENT_EVENTS_FETCH_LIMIT = 50;

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  // Authorization already happened in [accountId]/layout.tsx; this call is
  // only to learn the role for rendering — the activation checklist is the
  // agency's onboarding worklist about the client, not client data (spec §6.1).
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  const now = new Date();

  // The account's own name/timezone — the in-account layout doesn't provide
  // either (see [accountId]/layout.tsx, which only confirms the account
  // exists). Awaited on its own, ahead of the Promise.all below, because the
  // KPI row's windows are computed FROM `timezone` and have to be known
  // before the calls/bookings/opportunities reads that use them can be
  // issued — the same two-phase shape calendar/page.tsx uses for its own
  // account lookup, just with a real dependency between the phases here.
  const account = await db
    .from("accounts")
    .select("name, timezone")
    .eq("id", accountId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`account dashboard: account lookup failed: ${error.message}`);
      if (!data) throw new Error("account dashboard: account not found");
      return data as { name: string; timezone: string };
    });
  // ONE zone for this whole page. It used to have TWO, fifty lines apart —
  // a `safeZone(…, "UTC")` clamp here for the KPI windows and the RAW
  // `account.timezone` further down for `bucketWork` — so on an account
  // with a broken zone the KPI periods were computed in UTC while the work
  // counts beside them declined to bucket at all. Two answers to one
  // question, on one screen, at the same moment. `renderZone` is now the
  // only answer, and `ZoneNote` below names it.
  const zone = await renderZone(account.timezone);
  const timezone = zone.zone;

  // One 14-day window covers every KPI's spark AND both halves of its
  // "current 7 vs prior 7" delta — the last 7 dayKeys are the current
  // period, the first 7 are the prior period, adjacent with no gap and no
  // overlap (localDayWindow's own dayKeys are contiguous local calendar
  // days). `window7.fromIso` is the exact boundary between the two halves.
  const window7 = localDayWindow(now, timezone, 7);
  const window14 = localDayWindow(now, timezone, 14);
  // The three splits below compare each fetched ISO string against this
  // boundary. A plain STRING comparison is NOT safe here even though both
  // sides nominally come from the same sanctioned `localDayWindow` call:
  // `window7.fromIso` is `Date.toISOString()`'s own `.000Z`-suffixed form,
  // while the rows this splits (`callsIso`/`bookingsIso`/`oppPairs`) come
  // back from Postgres as `+00:00`-suffixed timestamps — two different
  // lexical formats for the same instant that misorder each other within a
  // millisecond of the boundary. Parsing both sides to the same epoch-ms
  // number once, here, makes every split below a real numeric comparison
  // instead.
  const window7FromMs = Date.parse(window7.fromIso);

  const [
    checklistRows, contactsCount, opps,
    voiceProfile, calendar, callsIso, bookingsIso, oppPairs, recentCalls, recentEvents,
    a2p, workRows,
  ] = await Promise.all([
    listChecklistState(db, accountId),
    countContacts(db, accountId),
    // PostgREST caps rows at max_rows (1000). Above that, this sum and count
    // silently undercount — an accurate figure needs a DB-side aggregate.
    db
      .from("opportunities")
      .select("monetary_value")
      .eq("account_id", accountId)
      .eq("status", "open"),
    getVoiceProfile(db, accountId),
    getCalendarForAccount(db, accountId),
    listCallStartsBetween(db, accountId, window14.fromIso, window14.toIso),
    listBookingCreationsBetween(db, accountId, window14.fromIso, window14.toIso),
    listOpportunityValuesCreatedBetween(db, accountId, window14.fromIso, window14.toIso),
    // The calls chart card's (Task 6) mini table — the 3 most recent calls
    // ever, not scoped to the 14-day window above.
    listCalls(db, accountId, { limit: 3 }),
    // The activity card's (Task 7) raw feed — both audiences: `events`'
    // RLS policy (0001_tenancy.sql, events_read) grants SELECT to the
    // agency AND to `account_id = app.current_account_id()`, the same
    // shape as accounts_member_read/memberships_member_read, and no later
    // migration narrows it (0020 only touched phone_numbers/voice_profiles/
    // calls). dbForRequest() is therefore safe here for a client session
    // too, unlike the calendar-status write path a few files over.
    listRecentEvents(db, accountId, RECENT_EVENTS_FETCH_LIMIT),
    // The A2P item on the checklist below DERIVES from this rather than from a
    // stored tick, so this read must happen at BOTH mergeChecklist call sites
    // or the item silently keeps ticking on one of them. Safe for a client
    // session for the same reason as listRecentEvents above: 0023 left `a2p_*`
    // selectable by `authenticated` (only UPDATE is withheld), and
    // accounts_member_read already scopes the row.
    getA2pRegistration(db, accountId),
    // Task 5's dashboard row — the same three-source read tasks/page.tsx
    // already uses, bucketed below with the same `bucketWork` rather than a
    // second way to compute what's waiting. Both audiences: `listAccountWork`
    // is the exact call tasks/page.tsx makes under `dbForRequest()` for
    // either role, and the /tasks nav entry itself is ungated
    // (nav-groups.ts) — this compact row must not be gated behind `isAgency`
    // either, unlike the checklist row below it.
    listAccountWork(db, accountId),
  ]);

  if (opps.error) {
    throw new Error(`account dashboard: opportunities query failed: ${opps.error.message}`);
  }

  const open = opps.data ?? [];
  const openOppsValue = String(open.length);
  const pipelineValueDisplay = formatCurrency(open.reduce((sum, o) => sum + Number(o.monetary_value), 0));

  const checklistEntries = mergeChecklist(checklistRows, { a2pStatus: a2p?.status });
  const checklistRemaining = checklistEntries.filter((e) => !e.done).length;

  // Bucketed in the SAME resolved zone the KPI windows above use, and the
  // same one `tasks/page.tsx` now buckets in. This previously took the raw
  // `account.timezone` on the reasoning that a silent UTC fallback would
  // reintroduce the previous-day defect — which was correct about the
  // SILENT clamp it was avoiding, and is answered properly now: the fallback
  // is no longer silent. Sharing one zone is what stops "3 overdue" and the
  // KPI period beside it from being measured against different midnights.
  const workBuckets = bucketWork(workRows, now, zone.zone);
  const workTotal = workBuckets.overdue.length + workBuckets.today.length + workBuckets.waiting.length;
  const workOverdue = workBuckets.overdue.length;

  // Greeting header (this page only). Time-of-day and the long date both
  // read the ACCOUNT's timezone, never the viewer's own clock — the same
  // zone-pinned discipline every other date on this page follows.
  //
  // WHO the greeting names: for the agency, `accounts.name` IS the label
  // meant for them (their own internal note on this client, e.g. "Rio
  // Roofing — trial") — unchanged, no branding read on this path. For a
  // client, that same internal label is agency-private and must not
  // surface here — mirrors app-sidebar.tsx's own `clientBrandName ??
  // clientAccountName` precedence exactly, so the greeting can never
  // disagree with the identity block beside it. `getTenantBranding` is
  // serviceDb()-backed, but this is NOT a new query on a client's own
  // request: dashboard/layout.tsx already resolves this exact accountId
  // (their own tenant) through the same `cache()` memo earlier in the same
  // request, so this call hits that memo — the page's "never serviceDb for
  // its own reads" rule governs the KPI/metrics data this page owns, not
  // branding, which every /dashboard/* route already resolves once per
  // request regardless of this page.
  const greetingName = isAgency
    ? account.name
    : (await getTenantBranding(accountId)).brandName ?? account.name;
  const period = greetingPeriod(now, timezone);
  const greetingKey =
    period === "morning"
      ? "dashboard.greeting.morning"
      : period === "afternoon"
        ? "dashboard.greeting.afternoon"
        : "dashboard.greeting.evening";
  // A replacer FUNCTION, not a plain replacement string: `String.replace`
  // treats a string second argument as a pattern — `$&`, `$1`, etc. — so a
  // tenant-authored name containing one of those sequences (e.g. "Bob's $&
  // Grill") would have it expanded instead of inserted verbatim. A function
  // return value is never re-interpreted.
  const greetingText = m[greetingKey].replace("{name}", () => greetingName);
  const dateText = formatLocalLongDate(now, timezone);
  const showVoiceSub = voiceProfile?.enabled === true;

  // Calls answered — split the one 14-day fetch on window7's boundary
  // rather than issuing a second query. Bucketed once and reused by both the
  // KPI tile's spark (Task 5) and the calls chart card's bars (Task 6) —
  // same values either way, just avoiding a second identical
  // `bucketByLocalDay` pass over the same `callsIso`/`window14.dayKeys`.
  const currentCallsIso = callsIso.filter((iso) => Date.parse(iso) >= window7FromMs);
  const priorCallsIso = callsIso.filter((iso) => Date.parse(iso) < window7FromMs);
  const callsDayBuckets = bucketByLocalDay(callsIso, timezone, window14.dayKeys);
  const callsSpark = callsDayBuckets.map((b) => b.count);
  const callsDelta = deltaVsPrior(currentCallsIso.length, priorCallsIso.length);

  // Appointments booked — same split/spark shape as calls.
  const currentBookingsIso = bookingsIso.filter((iso) => Date.parse(iso) >= window7FromMs);
  const priorBookingsIso = bookingsIso.filter((iso) => Date.parse(iso) < window7FromMs);
  const bookingsSpark = bucketByLocalDay(bookingsIso, timezone, window14.dayKeys).map((b) => b.count);
  const bookingsDelta = deltaVsPrior(currentBookingsIso.length, priorBookingsIso.length);

  // After-hours captured — DATA HONESTY (brief): hidden entirely, not
  // rendered as a zero, when there is no calendar or no configured hours to
  // judge a call against. countAfterHours itself would happily return an
  // honest-but-meaningless "every call is after-hours" for either case; that
  // honesty is the wrong answer to show on screen, so the gate lives here.
  // Gated on the NORMALIZED shape (the same `normalizeOpenHours` pass
  // `countAfterHours` itself applies internally), not the raw jsonb keys:
  // `calendar.open_hours` has no DB-level shape guarantee, so a row whose
  // every key maps to an invalid/malformed interval would satisfy the raw
  // `Object.keys(...).length > 0` check while `countAfterHours` normalizes
  // it down to nothing and judges every call after-hours — the exact
  // "every-call-after-hours" reading this gate exists to prevent.
  const hasAfterHours = calendar !== null && Object.keys(normalizeOpenHours(calendar.open_hours)).length > 0;
  const afterHoursCurrent = hasAfterHours
    ? countAfterHours(currentCallsIso, timezone, calendar.open_hours)
    : 0;
  const afterHoursPrior = hasAfterHours
    ? countAfterHours(priorCallsIso, timezone, calendar.open_hours)
    : 0;
  const afterHoursDelta = deltaVsPrior(afterHoursCurrent, afterHoursPrior);

  // Pipeline added — value-at-creation, not value-that-survived (see
  // listOpportunityValuesCreatedBetween's own doc comment): a later win/loss
  // must not change what a past 7-day window already captured.
  const currentOppPairs = oppPairs.filter((p) => Date.parse(p.createdAt) >= window7FromMs);
  const priorOppPairs = oppPairs.filter((p) => Date.parse(p.createdAt) < window7FromMs);
  const pipelineSpark = bucketValueByLocalDay(oppPairs, timezone, window14.dayKeys).map((b) => b.value);
  const currentPipelineValue = currentOppPairs.reduce((sum, p) => sum + p.monetaryValue, 0);
  const priorPipelineValue = priorOppPairs.reduce((sum, p) => sum + p.monetaryValue, 0);
  const pipelineDelta = deltaVsPrior(currentPipelineValue, priorPipelineValue);

  return (
    <>
      {/* The shared head, not a second copy of it: this slab was the
          hand-rolled twin of `PageHeader` and carried the same opaque
          `--surface-1` fill over the aurora's brightest glow. */}
      <PageHeader
        title={greetingText}
        subtitle={`${dateText}${showVoiceSub ? ` · ${m["dashboard.sub.voice"]}` : ""}`}
      />
      <div className="space-y-6 p-6">
        {/* Above the KPI tiles (Task 5) — both audiences, unlike the
            checklist row further down: the /tasks nav entry itself is
            ungated, and a row that vanished at zero would read as a broken
            feature (work-row.tsx's own doc comment, spec §4.3), so this
            renders at every count including zero. */}
        {/* Above the KPI tiles, because it qualifies every period label in
            them: "Last 7 days" is seven of WHOSE days. It also sits above the
            work row that follows, which `bucketWork` measures against those
            same midnights. */}
        <ZoneNote zone={zone} isAgency={isAgency} accountId={accountId} />
        <WorkRowCard accountId={accountId} total={workTotal} overdue={workOverdue} />
        <div className={cn("grid gap-4 sm:grid-cols-2", hasAfterHours ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          <StatTile
            hero
            label={m["dashboard.kpi.callsAnswered"]}
            value={String(currentCallsIso.length)}
            delta={callsDelta}
            spark={callsSpark}
            valueTestId="kpi-calls-answered"
          />
          <StatTile
            label={m["dashboard.kpi.appointmentsBooked"]}
            value={String(currentBookingsIso.length)}
            delta={bookingsDelta}
            spark={bookingsSpark}
          />
          {hasAfterHours ? (
            <StatTile
              label={m["dashboard.kpi.afterHoursCaptured"]}
              value={String(afterHoursCurrent)}
              delta={afterHoursDelta}
            />
          ) : null}
          <StatTile
            label={m["dashboard.kpi.pipelineAdded"]}
            value={formatCurrency(currentPipelineValue)}
            delta={pipelineDelta}
            spark={pipelineSpark}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label={m["account.contacts"]} value={String(contactsCount)} period={m["common.allTime"]} />
          <StatTile label={m["account.openOpps"]} value={openOppsValue} period={m["common.allTime"]} />
          <StatTile
            label={m["account.pipelineValue"]}
            value={pipelineValueDisplay}
            period={m["common.allTime"]}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <CallsChartCard
            accountId={accountId}
            timezone={timezone}
            dayBuckets={callsDayBuckets}
            recentCalls={recentCalls}
            isAgency={isAgency}
            voiceEnabled={showVoiceSub}
          />
          {/* Both audiences (see the `listRecentEvents` call above's own
              grants comment) — no isAgency gate, unlike the checklist row
              below. */}
          <ActivityCard accountId={accountId} events={recentEvents} now={now} />
        </div>

        {/* Below the metrics on purpose (danlo, 2026-09-02): the dashboard
            leads with what the business DID — the checklist is the agency's
            onboarding worklist, not the day's news, so it reads last. A
            compact row (danlo, 2026-09-09), not the full /checklist panel —
            that panel duplicated a whole nav section from the same data;
            see checklist-row.tsx. */}
        {isAgency ? (
          checklistRemaining > 0 ? (
            <ChecklistRow
              accountId={accountId}
              done={checklistEntries.length - checklistRemaining}
              total={checklistEntries.length}
            />
          ) : (
            // A finished checklist should not compete with the rest of the
            // dashboard, but it still has to stay reachable — un-ticking an
            // item, adding a custom step, or just reviewing what was done had
            // no path back in once the panel above stopped rendering.
            <Link
              href={`/dashboard/accounts/${accountId}/checklist`}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ListChecks className="size-3.5" aria-hidden />
              {m["checklist.reviewLink"]}
            </Link>
          )
        ) : null}
      </div>
    </>
  );
}
