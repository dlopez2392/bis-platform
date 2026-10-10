import Link from "next/link";
import { ListChecks } from "lucide-react";
import {
  listChecklistState, countContacts,
  getVoiceProfile, getCalendarForAccount, listCalls, listRecentEvents,
  listBookingCreationsBetween, listOpportunityValuesCreatedBetween,
  sumOpenOpportunities,
  getA2pRegistration, listAccountWork, brandDisplayName,
} from "@bis/db";
import {
  listAnsweredCallStartsBetween, listLeadInstantsBetween, listSpamCallStartsBetween,
  listAbandonedCallStartsBetween,
} from "@/lib/reports/weekly-metrics";
import { StatTile, LABEL_ROLE } from "@/components/stat-tile";
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
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";
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
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  // Optional (not `requestLocale`'s own `BIS_I18N_QA` shape, which every
  // real Next.js request still supplies): the existing page.test.ts/
  // hero.test.ts fixtures call this component directly with only `params`,
  // the same way they did before this task, and widening this to required
  // would fail `tsc` against their own untouched call sites rather than
  // against anything this task's own `page-locale.test.ts` pins.
  searchParams?: Promise<{ locale?: string }>;
}) {
  const { accountId } = await params;
  const { locale: localeParam } = (await searchParams) ?? {};
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
    .select("name, timezone, language")
    .eq("id", accountId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`account dashboard: account lookup failed: ${error.message}`);
      if (!data) throw new Error("account dashboard: account not found");
      return data as { name: string; timezone: string; language: Locale | null };
    });
  // This page's render locale — client-role sessions read the account's own
  // `language`; an agency operator's session stays English until the
  // parallel staff-and-roles lane's `users.language` exists (requestLocale's
  // own doc comment, Owner decision 1, 2026-10-10).
  const locale = requestLocale({ account, isOperator: isAgency }, { locale: localeParam });
  // Task 11 (Spanish-runtime lane), QA-only: true only when BIS_I18N_QA="1"
  // (Playwright's webServer env / CI's e2e job — never Vercel) AND
  // `?locale=pseudo` are both present. `p()` WRAPS the already-resolved
  // string from the t()/formatCurrency calls below rather than replacing
  // their call sites, so Task 7's own source-scan pins (page-locale.test.ts,
  // hero.test.ts) keep matching the exact literal calls they pin even with
  // this layered on top.
  const pseudo = requestPseudoMode({ locale: localeParam });
  const p = (resolved: string) => (pseudo ? pseudoLocale(resolved) : resolved);
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
    checklistRows, contactsCount, openOpps,
    voiceProfile, calendar, callsIso, bookingsIso, oppPairs, leadInstantsIso, recentCalls, recentEvents,
    a2p, workRows, spamCallsIso, abandonedCallsIso,
  ] = await Promise.all([
    listChecklistState(db, accountId),
    countContacts(db, accountId),
    // Pages past PostgREST's row cap (max_rows, 1000) internally, so neither
    // the count nor the sum silently undercounts above it — see
    // sumOpenOpportunities' own comment.
    sumOpenOpportunities(db, accountId),
    getVoiceProfile(db, accountId),
    getCalendarForAccount(db, accountId),
    // ANSWERED calls only, the Monday report's own definition and read — not
    // every call row. Until 2026-10-06 this read every row (the since-removed
    // `listCallStartsBetween`), so the hero labelled "Calls answered", its
    // spark, the 14-day chart and the after-hours tile all counted robocalls
    // — on the BIS account, 123 of 139 calls — and the owner's own test calls.
    listAnsweredCallStartsBetween(db, accountId, window14.fromIso, window14.toIso),
    listBookingCreationsBetween(db, accountId, window14.fromIso, window14.toIso),
    listOpportunityValuesCreatedBetween(db, accountId, window14.fromIso, window14.toIso),
    // F-076 (now slice): the CRM-only hero ("Leads captured" — owner
    // decision, the SAME definition the Monday weekly report uses, not
    // "every new contact"). Fetched unconditionally (same Promise.all),
    // same reason the calls/bookings/opportunities reads above are: whether
    // THIS one feeds the hero isn't known until `showVoiceSub` resolves
    // below, and a second sequential round-trip just to learn that would
    // cost latency for nothing.
    listLeadInstantsBetween(db, accountId, window14.fromIso, window14.toIso),
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
    // The calls chart card's "screened, not empty" state (#182 follow-up):
    // whether the window had a nameable call at all beyond the answered
    // ones — see resolveCallsChartState's own doc comment
    // (lib/dashboard/metrics.ts) for why `callsIso.length` (answered only)
    // can't answer that question on its own, and why these two counts (not
    // a single "every row, any outcome" total) are what answer it honestly.
    // Added to this same Promise.all rather than a follow-up sequential
    // read: two more parallel queries in the batch this page already
    // issues, not a second round trip.
    listSpamCallStartsBetween(db, accountId, window14.fromIso, window14.toIso),
    listAbandonedCallStartsBetween(db, accountId, window14.fromIso, window14.toIso),
  ]);

  const openOppsValue = String(openOpps.count);
  const pipelineValueDisplay = p(formatCurrency(openOpps.value, locale));

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
  // client, D-072: that same internal label is agency-private and must
  // NEVER surface here, with no fallback to it at all — `brandDisplayName`
  // (the trimmed, "" when blank, never-accounts.name resolver the tab
  // title and the sidebar identity block now also go through) rather than
  // the raw column, so all three surfaces read the brand name the SAME
  // way. `getTenantBranding` is serviceDb()-backed, but this is NOT a new
  // query on a client's own request: dashboard/layout.tsx already resolves
  // this exact accountId (their own tenant) through the same `cache()` memo
  // earlier in the same request, so this call hits that memo — the page's
  // "never serviceDb for its own reads" rule governs the KPI/metrics data
  // this page owns, not branding, which every /dashboard/* route already
  // resolves once per request regardless of this page.
  const greetingName = isAgency
    ? account.name
    : brandDisplayName(await getTenantBranding(accountId));
  const period = greetingPeriod(now, timezone);
  const periodKey = period === "morning" ? "morning" : period === "afternoon" ? "afternoon" : "evening";
  // A replacer FUNCTION, not a plain replacement string: `String.replace`
  // treats a string second argument as a pattern — `$&`, `$1`, etc. — so a
  // tenant-authored name containing one of those sequences (e.g. "Bob's $&
  // Grill") would have it expanded instead of inserted verbatim. A function
  // return value is never re-interpreted. No name at all (D-072's
  // unreachable-in-practice edge) gets its own written copy, never a
  // dangling ", {name}".
  const greetingText = greetingName
    ? m[`dashboard.greeting.${periodKey}` as const].replace("{name}", () => greetingName)
    : m[`dashboard.greeting.${periodKey}NoName` as const];
  const dateText = formatLocalLongDate(now, timezone);
  const showVoiceSub = voiceProfile?.enabled === true;
  // D-063 follow-up: the account's own configured persona, not a hard-coded
  // "Sofía" — a function replacer for the same reason the greeting's own
  // {name} substitution just above uses one (a persona containing `$&` must
  // not be re-interpreted as a replacement pattern).
  const voiceSubText = showVoiceSub
    ? m["dashboard.sub.voice"].replace("{name}", () => voiceProfile?.persona_name?.trim() || "Sofía")
    : "";

  // Calls answered — split the one 14-day fetch on window7's boundary
  // rather than issuing a second query. `callsDayBuckets` (14 days) feeds
  // ONLY the calls chart card's bars (Task 6); the KPI tile's own spark
  // (D-077) is bucketed SEPARATELY over `window7.dayKeys` so it traces the
  // exact same 7 days `currentCallsIso.length` counts — the chart's 14-day
  // picture and the KPI's 7-day one are two different questions and must
  // not share one bucket pass.
  const currentCallsIso = callsIso.filter((iso) => Date.parse(iso) >= window7FromMs);
  const priorCallsIso = callsIso.filter((iso) => Date.parse(iso) < window7FromMs);
  const callsDayBuckets = bucketByLocalDay(callsIso, timezone, window14.dayKeys);
  const callsSpark = bucketByLocalDay(callsIso, timezone, window7.dayKeys).map((b) => b.count);
  const callsDelta = deltaVsPrior(currentCallsIso.length, priorCallsIso.length);

  // Appointments booked — same split/spark shape as calls, spark over the
  // SAME 7-day window as the number (D-077; was window14).
  const currentBookingsIso = bookingsIso.filter((iso) => Date.parse(iso) >= window7FromMs);
  const priorBookingsIso = bookingsIso.filter((iso) => Date.parse(iso) < window7FromMs);
  const bookingsSpark = bucketByLocalDay(bookingsIso, timezone, window7.dayKeys).map((b) => b.count);
  const bookingsDelta = deltaVsPrior(currentBookingsIso.length, priorBookingsIso.length);

  // Leads captured — F-076 (now slice): the CRM-only hero, same split/spark
  // shape as calls/bookings above. `showVoiceSub` (voice_profiles.enabled —
  // already resolved above for the greeting subtitle, and the same signal
  // calls-chart-card.tsx's own `offerVoiceSetup` reads) decides which of
  // this and the calls metric below leads the KPI row: a CRM-only account
  // has no receptionist taking calls, so "Calls answered" is structurally
  // always 0 there and is never the honest headline (crm-features.md
  // §2.3's defect row). Owner decision: "leads captured" — the SAME
  // DEFINITION of a lead (a real submission or a `LEAD_OUTCOME` call) the
  // Monday weekly report uses, read through the one shared function both
  // call, `listLeadInstantsBetween` (lib/reports/weekly-metrics.ts) — not
  // "every new contact", and not a second, parallel computation that could
  // drift from the report's. The NUMBER shown here can still differ from
  // the email's: this window is a rolling 7 local days ending NOW, while
  // the email's is the calendar week just finished (Monday 00:00 to the
  // next Monday 00:00, the account's own zone) — two different windows
  // over the one shared definition, the same relationship "Calls answered"
  // already has with the report's own "calls answered".
  const currentLeadsIso = leadInstantsIso.filter((iso) => Date.parse(iso) >= window7FromMs);
  const priorLeadsIso = leadInstantsIso.filter((iso) => Date.parse(iso) < window7FromMs);
  // Spark over the SAME 7-day window as the number (D-077; was window14).
  const leadsSpark = bucketByLocalDay(leadInstantsIso, timezone, window7.dayKeys).map((b) => b.count);
  const leadsDelta = deltaVsPrior(currentLeadsIso.length, priorLeadsIso.length);

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
  // Also gated on `showVoiceSub`: after-hours capture is a property of
  // calls Sofía takes, so a CRM-only account (no enabled voice profile)
  // would otherwise show an always-0 tile here too — the same "unmeasured
  // is hidden, not zeroed" reasoning the hero swap above follows.
  const hasAfterHours = showVoiceSub
    && calendar !== null && Object.keys(normalizeOpenHours(calendar.open_hours)).length > 0;
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
  // Spark over the SAME 7-day window as the value below (D-077; was window14).
  const pipelineSpark = bucketValueByLocalDay(oppPairs, timezone, window7.dayKeys).map((b) => b.value);
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
        subtitle={`${dateText}${showVoiceSub ? ` · ${voiceSubText}` : ""}`}
      />
      <div className="space-y-6 p-6">
        {/* Above the KPI tiles (Task 5) — both audiences, unlike the
            checklist row further down: the /tasks nav entry itself is
            ungated, and a row that vanished at zero would read as a broken
            feature (work-row.tsx's own doc comment, spec §4.3), so this
            renders at every count including zero. */}
        {/* Above the KPI tiles, because it qualifies BOTH the row caption
            right below it ("Last 7 days" is seven of WHOSE days) and the
            work row that follows, which `bucketWork` measures against those
            same midnights. */}
        <ZoneNote zone={zone} isAgency={isAgency} />
        <WorkRowCard accountId={accountId} total={workTotal} overdue={workOverdue} />
        {/* D-077, design review follow-up: a suffix on each of the four
            tile's own labels ("Appointments booked · Last 7 days",
            251.6px of Geist Mono at the Label role) wrapped in the ~234px
            xl tile and misaligned the row — the mockup never puts a period
            in a tile label (northern-lights.html:85-95). ONE caption for
            the whole row instead, reusing StatTile's own exported
            `LABEL_ROLE` class string rather than a second hand-copied one —
            tokens only, no new hard-coded value. */}
        <p lang={locale} className={LABEL_ROLE}>{p(t(m, "dashboard.kpi.last7Days", locale))}</p>
        <div lang={locale} className={cn("grid gap-4 sm:grid-cols-2", hasAfterHours ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
          {/* F-076 (now slice): ONE hero tile (DESIGN.md rule 11), whose
              metric follows the plan rather than a fixed metric that reads
              0 forever on a CRM-only account — see the `leadsDelta`
              comment above. */}
          <StatTile
            hero
            label={showVoiceSub ? p(t(m, "dashboard.kpi.callsAnswered", locale)) : p(t(m, "dashboard.kpi.leadsCaptured", locale))}
            value={showVoiceSub ? String(currentCallsIso.length) : String(currentLeadsIso.length)}
            delta={showVoiceSub ? callsDelta : leadsDelta}
            spark={showVoiceSub ? callsSpark : leadsSpark}
            valueTestId={showVoiceSub ? "kpi-calls-answered" : "kpi-leads-captured"}
            locale={locale}
          />
          <StatTile
            label={p(t(m, "dashboard.kpi.appointmentsBooked", locale))}
            value={String(currentBookingsIso.length)}
            delta={bookingsDelta}
            spark={bookingsSpark}
            locale={locale}
          />
          {hasAfterHours ? (
            <StatTile
              label={p(t(m, "dashboard.kpi.afterHoursCaptured", locale))}
              value={String(afterHoursCurrent)}
              delta={afterHoursDelta}
              locale={locale}
            />
          ) : null}
          <StatTile
            label={p(t(m, "dashboard.kpi.pipelineAdded", locale))}
            value={p(formatCurrency(currentPipelineValue, locale))}
            delta={pipelineDelta}
            spark={pipelineSpark}
            locale={locale}
          />
        </div>

        <div lang={locale} className="grid gap-4 sm:grid-cols-3">
          <StatTile label={p(t(m, "account.contacts", locale))} value={String(contactsCount)} period={p(t(m, "common.allTime", locale))} locale={locale} />
          <StatTile label={p(t(m, "account.openOpps", locale))} value={openOppsValue} period={p(t(m, "common.allTime", locale))} locale={locale} />
          <StatTile
            label={p(t(m, "account.pipelineValue", locale))}
            value={pipelineValueDisplay}
            period={p(t(m, "common.allTime", locale))}
            locale={locale}
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
            spamCount={spamCallsIso.length}
            abandonedCount={abandonedCallsIso.length}
            personaName={voiceProfile?.persona_name ?? null}
          />
          {/* Both audiences (see the `listRecentEvents` call above's own
              grants comment) — no isAgency gate, unlike the checklist row
              below. */}
          <ActivityCard
            accountId={accountId} events={recentEvents} now={now}
            personaName={voiceProfile?.persona_name ?? null}
          />
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
