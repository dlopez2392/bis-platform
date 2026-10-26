// apps/web/src/app/(dashboard)/dashboard/work/page.tsx
//
// The agency-wide work queue (Work Queue Task 6, spec §4.2). Top level,
// beside Companies and Blueprints — the first screen in the app whose whole
// purpose is to span every account. `requireAgency()` is the literal first
// line, before any read: the query below reads every account's open tasks,
// unanswered conversations and un-closed-out bookings in one pass, and that
// read must never even be ISSUED on a client's behalf, boundary test first
// (apps/web/e2e/work-queue.spec.ts, Task 6 Step 1).
import {
  countLinesTurningCallersAway, listAccountsWithStaleUsage, listAgencyWork, listBillingAlerts, listPendingProposalsForAgency,
  serviceDb, type BillingAlerts, type Proposal,
} from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { BillingAlertBanner } from "@/components/billing-alert-banner";
import { LineDownBanner } from "@/components/line-down-banner";
import { UsageStaleBanner } from "@/components/usage-stale-banner";
import { billingEnforced } from "@/lib/billing/enforce";
import { requireAgency } from "@/lib/auth";
import { bucketAgencyWork } from "@/lib/work/agency-buckets";
import { contactDisplayName } from "@/lib/format";
import { holdingLabel } from "@/lib/contacts/holding-label";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale } from "@/lib/i18n/request-locale";
import { makeTr } from "@/lib/record/copy";
import { renderZone } from "@/lib/zone";
import { buildSuggestionView } from "@/lib/proposals/view";
import { readAgencySuggestionContext, type AgencySuggestionContext } from "@/lib/proposals/view-reads";
import { groupByAccount, groupSuggestions } from "@/lib/proposals/group";
import { AgencyWorkList, type AgencySuggestionsLoad } from "./agency-work-list";

export const dynamic = "force-dynamic";

export default async function AgencyWorkPage() {
  const { userId } = await requireAgency();

  const db = serviceDb();
  // ONE clock reference for the whole read (same rule as the per-account
  // screen's page.tsx) — `new Date()`, not `Date.now()`: a bare `Date.now()`
  // call inside a render body is an impure-function call the React Compiler
  // lint (`react-hooks/purity`) flags, where `new Date()` is the sanctioned
  // idiom for "now" here. Reused below both to bound the lines-down window
  // and to bucket each account's rows in ITS OWN zone, so the two
  // clock-derived values on this page can never drift from each other
  // mid-request.
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  // Every account's rows in one pass, each already carrying its OWN
  // brand_name and timezone (packages/db/src/work-queue.ts) — no per-account
  // account lookup here, unlike the per-account screen, because the zone and
  // the display name both travel with the row already.
  //
  // The lines-down count runs CONCURRENTLY with it, not chained after — this
  // page already fans out per-account reads and should not gain another
  // round trip in series just to add a banner. Swallowed exactly the way
  // Calls' failed-text-back read is (accounts/[accountId]/calls/page.tsx):
  // the banner is cosmetic, the queue is the page, and a `screened_calls`
  // hiccup must never cost the agency their work list. The `.catch` lives
  // INSIDE the array element (not around the whole `Promise.all`) so a
  // rejection here resolves to 0 rather than failing the concurrent
  // `listAgencyWork` read too.
  // The suggestions read runs CONCURRENTLY with the others, not chained
  // after — same reasoning as the lines-down banner's own comment above.
  // Task 10's own binding constraint: a suggestion is a QUESTION about work,
  // never work itself, so its rows travel in their OWN array all the way to
  // `AgencyWorkList` and are NEVER concatenated into `rows` below — doing so
  // would hand `bucketAgencyWork` a suggestion-derived row indistinguishable
  // from a real task. A failed read must never cost the agency their real
  // work list, and since item 8b-2 it is no longer silent either: the
  // section's own error state with Retry (rule 5), the buckets regardless.
  // The read itself is at most 50 per account (the RPC, migration 0089), so
  // one busy account can no longer crowd every other account off this page.
  // The stale-usage read (client billing) joins the same Promise.all, and is
  // swallowed the same way as the lines-down read: a banner is cosmetic, the
  // queue is the page. `now` is the page's one clock reference.
  const [rows, linesDown, proposalsRead, staleUsage, billingAlerts, prefs] = await Promise.all([
    listAgencyWork(db),
    countLinesTurningCallersAway(db, since).catch((e: unknown) => {
      console.error(`work queue: lines-down read failed, rendering no banner: ${String(e)}`);
      return 0;
    }),
    // The page's one clock (final review M-6): "pending and not yet expired" is judged at the same instant.
    listPendingProposalsForAgency(db, now).then(
      (got) => ({ ok: true as const, rows: got }),
      (e: unknown) => {
        console.error(`work queue: suggestions read failed, rendering the section's error state: ${loggableError(e)}`);
        return { ok: false as const };
      },
    ),
    listAccountsWithStaleUsage(db, now).catch((e: unknown) => {
      console.error(`work queue: stale-usage read failed, rendering no banner: ${String(e)}`);
      return [] as string[];
    }),
    // Task 11 (plan G13): the agency's billing banner (paused, paused 30+
    // days, payment failed, usage mismatch). A banner is cosmetic, the queue
    // is the page — same swallow as every other banner's read above.
    // listBillingAlerts catches its own reconciliation read (design review
    // I3) and still returns the paused/payment lines with
    // reconciliationUnchecked, so only a failure of THAT first read lands here.
    listBillingAlerts(db, now, { enforced: billingEnforced() }).catch((e: unknown): BillingAlerts => {
      console.error(`work queue: billing-alerts read failed, rendering no banner: ${String(e)}`);
      return { alerts: [], reconciliationUnchecked: false };
    }),
    // getPersonPrefs() never rejects: a failed read means defaults (its own doc comment).
    getPersonPrefs(),
  ]);
  const proposals = proposalsRead.ok ? proposalsRead.rows : [];

  // The cards' words (item 8b-2, plan ambiguity 9): an operator reads this page, so English unless the
  // operator has their own language set; no one account's language speaks for a page of every account.
  const locale = requestLocale({ account: null, isOperator: true, userLanguage: prefs.language });
  const tr = makeTr(locale);

  // What every card needs that its row does not carry (spec 5.2): each account's stage names (only the
  // accounts with a stage suggestion), each account's own persona (one read), and the calls behind the
  // rows (one read). A failure is the section's error state, never the page and never a card it cannot
  // name; the persona alone falls back to "Sofía" inside the read.
  let context: AgencySuggestionContext | null = null;
  if (proposalsRead.ok && proposals.length > 0) {
    try {
      context = await readAgencySuggestionContext(db, proposals);
    } catch (e) {
      console.error(`work queue: suggestion context read failed, rendering the section's error state: ${loggableError(e)}`);
    }
  }
  const callsById = context?.callsById ?? new Map<string, { startedAt: string | null; contactId: string | null }>();
  // The caller behind a card is the call's own contact, else the row's (the tray's rule).
  const callerIdOf = (p: Proposal) => (p.callId ? callsById.get(p.callId)?.contactId : null) ?? p.contactId;

  // Each account's rows are bucketed in THAT account's own zone, never one
  // zone borrowed across every row — see agency-buckets.ts's own doc
  // comment. `proposals` never reaches this call — see the comment above.
  const buckets = bucketAgencyWork(rows, now);

  // ONE batch read for every contact referenced across every account's rows,
  // every suggestion's caller and every suggestion's own customer (whom its
  // group is named after) — never one read per row and never one per
  // account. Not account-scoped (unlike the per-account screen's own
  // contacts lookup): the ids here come from `listAgencyWork`'s and
  // `listPendingProposalsForAgency`'s own already-cross-tenant reads via
  // `serviceDb`, not from user input, so there is nothing for an account
  // filter to guard against — a contact id can only ever resolve to the row
  // that produced it.
  const contactIds = [...new Set(
    [...buckets.overdue, ...buckets.today, ...buckets.waiting]
      .map((r) => r.contactId)
      .concat(proposals.map(callerIdOf))
      .concat(proposals.map((p) => p.contactId))
      .filter((id): id is string => id !== null),
  )];
  const contactNames: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data: contacts, error } = await db
      .from("contacts")
      .select("id, first_name, last_name, phone, holds_shared_number")
      .in("id", contactIds);
    if (error) throw new Error(`work: contacts lookup failed: ${error.message}`);
    for (const c of contacts ?? []) {
      // S-47e (P19): a To-do on a shared number's holding record names the number, never "Caller".
      contactNames[c.id] = c.holds_shared_number ? holdingLabel(c.phone, locale) : contactDisplayName(c);
    }
  }

  // Each card is built in ITS OWN account's zone (renderZone: an unusable stored zone costs this page a
  // stated fallback, never the card and never another account's zone), then grouped by account and, inside
  // each account, as the tray groups (customer, then call). Built in their own guard, as the tray's are: a
  // card that cannot be built is the section's error state, never the whole queue.
  let suggestions: AgencySuggestionsLoad;
  if (!proposalsRead.ok || (proposals.length > 0 && context === null)) {
    suggestions = { ok: false };
  } else {
    try {
      const sections = groupByAccount(proposals);
      const zones = new Map(await Promise.all(
        sections.map(async (a) => [a.accountId, (await renderZone(a.timezone)).zone] as const),
      ));
      suggestions = {
        ok: true,
        accounts: sections.map((a) => {
          const zone = zones.get(a.accountId) ?? "UTC";
          const stages = context?.stagesByAccount.get(a.accountId) ?? { stages: {}, pipelineStages: [] };
          const personaName = context?.personaByAccount.get(a.accountId) ?? "Sofía";
          const views = new Map(a.rows.map((p) => {
            const callerId = callerIdOf(p);
            return [p.id, buildSuggestionView(p, {
              tr, zone, now, ...stages,
              callerName: callerId ? (contactNames[callerId] ?? null) : null,
              callStartedAt: p.callId ? (callsById.get(p.callId)?.startedAt ?? null) : null,
              // Pending rows only, so no decider is named.
              personaName, names: {}, viewerId: userId,
            })] as const;
          }));
          return {
            accountId: a.accountId, brandName: a.brandName, personaName, capped: a.accountCapped,
            groups: groupSuggestions(a.rows, views, { tr, zone, contactNames, callsById }),
          };
        }),
      };
    } catch (e) {
      console.error(`work queue: suggestions could not be shown, rendering the section's error state: ${loggableError(e)}`);
      suggestions = { ok: false };
    }
  }

  return (
    <>
      <PageHeader title={m["work.agency.title"]} subtitle={m["work.agency.subtitle"]} />
      <div className="space-y-4 p-6">
        <LineDownBanner count={linesDown} />
        <UsageStaleBanner count={staleUsage.length} />
        <BillingAlertBanner alerts={billingAlerts.alerts} reconciliationUnchecked={billingAlerts.reconciliationUnchecked} />
        <AgencyWorkList
          buckets={buckets}
          contactNames={contactNames}
          suggestions={suggestions}
          tr={tr}
        />
      </div>
    </>
  );
}
