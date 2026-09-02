import Link from "next/link";
import { ListChecks } from "lucide-react";
import {
  listChecklistState, countFormsMissingNotify, countContacts,
  getVoiceProfile, getCalendarForAccount, listCalls,
  listCallStartsBetween, listBookingCreationsBetween, listOpportunityValuesCreatedBetween,
} from "@bis/db";
import { StatTile } from "@/components/stat-tile";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { mergeChecklist } from "@/lib/checklist-catalogue";
import { getTenantBranding } from "@/lib/branding/tenant-theme-reader";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { greetingPeriod, formatLocalLongDate } from "@/lib/dashboard/greeting";
import { localDayWindow, bucketByLocalDay, bucketValueByLocalDay, deltaVsPrior, countAfterHours } from "@/lib/dashboard/metrics";
import { ChecklistPanel } from "../checklist/checklist-panel";
import { setChecklistItemAction, addChecklistItemAction } from "../checklist/actions";
import { CallsChartCard } from "./calls-chart-card";

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
  const { timezone } = account;

  // One 14-day window covers every KPI's spark AND both halves of its
  // "current 7 vs prior 7" delta — the last 7 dayKeys are the current
  // period, the first 7 are the prior period, adjacent with no gap and no
  // overlap (localDayWindow's own dayKeys are contiguous local calendar
  // days). `window7.fromIso` is the exact boundary between the two halves;
  // splitting each fetched series on that boundary with a plain ISO-string
  // comparison is safe because both instants came from the SAME sanctioned
  // `localDayWindow` call (same `now`/`timezone`) — no zone math is being
  // re-derived by that comparison, only two already-zone-correct instants
  // being ordered.
  const window7 = localDayWindow(now, timezone, 7);
  const window14 = localDayWindow(now, timezone, 14);

  const [
    checklistRows, formsMissingNotify, contactsCount, opps,
    voiceProfile, calendar, callsIso, bookingsIso, oppPairs, recentCalls,
  ] = await Promise.all([
    listChecklistState(db, accountId),
    countFormsMissingNotify(db, accountId),
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
  ]);

  if (opps.error) {
    throw new Error(`account dashboard: opportunities query failed: ${opps.error.message}`);
  }

  const open = opps.data ?? [];
  const openOppsValue = String(open.length);
  const pipelineValueDisplay = formatCurrency(open.reduce((sum, o) => sum + Number(o.monetary_value), 0));

  const checklistEntries = mergeChecklist(checklistRows);
  const checklistRemaining = checklistEntries.filter((e) => !e.done).length;

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
  const greetingText = m[greetingKey].replace("{name}", greetingName);
  const dateText = formatLocalLongDate(now, timezone);
  const showVoiceSub = voiceProfile?.enabled === true;

  // Calls answered — split the one 14-day fetch on window7's boundary
  // rather than issuing a second query. Bucketed once and reused by both the
  // KPI tile's spark (Task 5) and the calls chart card's bars (Task 6) —
  // same values either way, just avoiding a second identical
  // `bucketByLocalDay` pass over the same `callsIso`/`window14.dayKeys`.
  const currentCallsIso = callsIso.filter((iso) => iso >= window7.fromIso);
  const priorCallsIso = callsIso.filter((iso) => iso < window7.fromIso);
  const callsDayBuckets = bucketByLocalDay(callsIso, timezone, window14.dayKeys);
  const callsSpark = callsDayBuckets.map((b) => b.count);
  const callsDelta = deltaVsPrior(currentCallsIso.length, priorCallsIso.length);

  // Appointments booked — same split/spark shape as calls.
  const currentBookingsIso = bookingsIso.filter((iso) => iso >= window7.fromIso);
  const priorBookingsIso = bookingsIso.filter((iso) => iso < window7.fromIso);
  const bookingsSpark = bucketByLocalDay(bookingsIso, timezone, window14.dayKeys).map((b) => b.count);
  const bookingsDelta = deltaVsPrior(currentBookingsIso.length, priorBookingsIso.length);

  // After-hours captured — DATA HONESTY (brief): hidden entirely, not
  // rendered as a zero, when there is no calendar or no configured hours to
  // judge a call against. countAfterHours itself would happily return an
  // honest-but-meaningless "every call is after-hours" for either case; that
  // honesty is the wrong answer to show on screen, so the gate lives here.
  const hasAfterHours = calendar !== null && Object.keys(calendar.open_hours).length > 0;
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
  const currentOppPairs = oppPairs.filter((p) => p.createdAt >= window7.fromIso);
  const priorOppPairs = oppPairs.filter((p) => p.createdAt < window7.fromIso);
  const pipelineSpark = bucketValueByLocalDay(oppPairs, timezone, window14.dayKeys).map((b) => b.value);
  const currentPipelineValue = currentOppPairs.reduce((sum, p) => sum + p.monetaryValue, 0);
  const priorPipelineValue = priorOppPairs.reduce((sum, p) => sum + p.monetaryValue, 0);
  const pipelineDelta = deltaVsPrior(currentPipelineValue, priorPipelineValue);

  return (
    <>
      <div className="border-b border-border bg-card px-6 py-5">
        <h1 className="font-display text-xl font-[650] tracking-[-0.01em] text-card-foreground">
          {greetingText}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {dateText}
          {showVoiceSub ? ` · ${m["dashboard.sub.voice"]}` : ""}
        </p>
      </div>
      <div className="space-y-6 p-6">
        {isAgency ? (
          checklistRemaining > 0 ? (
            <div className="max-w-2xl">
              <ChecklistPanel
                entries={checklistEntries}
                formsMissingNotify={formsMissingNotify}
                setAction={setChecklistItemAction.bind(null, accountId)}
                addAction={addChecklistItemAction.bind(null, accountId)}
                titleHref={`/dashboard/accounts/${accountId}/checklist`}
              />
            </div>
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

        <div className={cn("grid gap-4 sm:grid-cols-2", hasAfterHours ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          <StatTile
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

        {/* Task 7 fills the second column with an activity feed; until then
            the chart card is this row's only child. */}
        <div className="grid gap-4 xl:grid-cols-2">
          <CallsChartCard
            accountId={accountId}
            timezone={timezone}
            dayBuckets={callsDayBuckets}
            recentCalls={recentCalls}
            isAgency={isAgency}
            voiceEnabled={showVoiceSub}
          />
        </div>
      </div>
    </>
  );
}
