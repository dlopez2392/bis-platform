// apps/web/src/app/(dashboard)/dashboard/work/page.tsx
//
// The agency-wide work queue (Work Queue Task 6, spec §4.2). Top level,
// beside Companies and Blueprints — the first screen in the app whose whole
// purpose is to span every account. `requireAgency()` is the literal first
// line, before any read: the query below reads every account's open tasks,
// unanswered conversations and un-closed-out bookings in one pass, and that
// read must never even be ISSUED on a client's behalf, boundary test first
// (apps/web/e2e/work-queue.spec.ts, Task 6 Step 1).
import { countLinesTurningCallersAway, listAgencyWork, listPendingProposalsForAgency, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { LineDownBanner } from "@/components/line-down-banner";
import { requireAgency } from "@/lib/auth";
import { bucketAgencyWork } from "@/lib/work/agency-buckets";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { AgencyWorkList } from "./agency-work-list";
import type { ResolvedStage } from "../accounts/[accountId]/calls/[callId]/proposals";

export const dynamic = "force-dynamic";

export default async function AgencyWorkPage() {
  await requireAgency();

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
  // The proposals read runs CONCURRENTLY with the other two, not chained
  // after — same reasoning as the lines-down banner's own comment above.
  // Task 10's own binding constraint: a proposal is a QUESTION about work,
  // never work itself, so its rows travel in their OWN array all the way to
  // `AgencyWorkList` and are NEVER concatenated into `rows` below — doing so
  // would hand `bucketAgencyWork` a proposal-derived row indistinguishable
  // from a real task. Swallowed the same best-effort way: a `call_proposals`
  // hiccup must never cost the agency their real work list, so this degrades
  // to no suggestions section rather than a broken page.
  const [rows, linesDown, proposals] = await Promise.all([
    listAgencyWork(db),
    countLinesTurningCallersAway(db, since).catch((e: unknown) => {
      console.error(`work queue: lines-down read failed, rendering no banner: ${String(e)}`);
      return 0;
    }),
    listPendingProposalsForAgency(db).catch((e: unknown) => {
      console.error(`work queue: proposals read failed, rendering no suggestions: ${String(e)}`);
      return [];
    }),
  ]);

  // Each account's rows are bucketed in THAT account's own zone, never one
  // zone borrowed across every row — see agency-buckets.ts's own doc
  // comment. `proposals` never reaches this call — see the comment above.
  const buckets = bucketAgencyWork(rows, now);

  // ONE batch read for every contact referenced across every account's rows
  // AND every pending proposal — never one read per row and never one per
  // account. Not account-scoped (unlike the per-account screen's own
  // contacts lookup): the ids here come from `listAgencyWork`'s and
  // `listPendingProposalsForAgency`'s own already-cross-tenant reads via
  // `serviceDb`, not from user input, so there is nothing for an account
  // filter to guard against — a contact id can only ever resolve to the row
  // that produced it.
  const contactIds = [...new Set(
    [...buckets.overdue, ...buckets.today, ...buckets.waiting]
      .map((r) => r.contactId)
      .concat(proposals.map((p) => p.contactId))
      .filter((id): id is string => id !== null),
  )];
  const contactNames: Record<string, string> = {};
  if (contactIds.length > 0) {
    const { data: contacts, error } = await db
      .from("contacts")
      .select("id, first_name, last_name")
      .in("id", contactIds);
    if (error) throw new Error(`work: contacts lookup failed: ${error.message}`);
    for (const c of contacts ?? []) {
      contactNames[c.id] = contactDisplayName(c);
    }
  }

  // Fix-wave (task-10-brief.md, Important 1) — an opportunity_stage
  // proposal's payload carries only fromStageId/toStageId uuids; describing
  // it honestly means resolving those to real names. `pipeline_stages.id`
  // is a globally unique uuid PRIMARY KEY, so this is ONE batched
  // `.in("id", stageIds)` read across every account with a pending
  // opportunity_stage proposal — the identical shape to the contacts lookup
  // two lines above, with the identical reasoning (the ids came from an
  // already-cross-tenant service-role read, `listPendingProposalsForAgency`),
  // never a per-account join and never N queries. Best-effort, same shape
  // as the lines-down and proposals reads above: a `pipeline_stages` hiccup
  // must never cost the agency the rest of its queue, and degrades to no
  // resolved names at all — `AgencyWorkList`'s own `proposalSummary` then
  // renders an honest summary that names no stage, for exactly the rows
  // this read could not resolve, rather than dropping them.
  const stageIds = [...new Set(
    proposals.flatMap((p) => (p.kind === "opportunity_stage" ? [p.payload.fromStageId, p.payload.toStageId] : [])),
  )];
  const stageNames: Record<string, ResolvedStage> = {};
  if (stageIds.length > 0) {
    try {
      const { data, error } = await db.from("pipeline_stages")
        .select("id, name, position")
        .in("id", stageIds);
      if (error) throw new Error(`pipeline stage lookup failed: ${error.message}`);
      for (const stageRow of (data ?? []) as { id: string; name: string; position: number }[]) {
        stageNames[stageRow.id] = { name: stageRow.name, position: stageRow.position };
      }
    } catch (e) {
      console.error(
        `work queue: pipeline stage lookup failed, opportunity_stage proposals render without stage names: ${String(e)}`,
      );
    }
  }

  return (
    <>
      <PageHeader title={m["work.agency.title"]} subtitle={m["work.agency.subtitle"]} />
      <div className="space-y-4 p-6">
        <LineDownBanner count={linesDown} />
        <AgencyWorkList
          buckets={buckets}
          contactNames={contactNames}
          proposals={proposals}
          stageNames={stageNames}
        />
      </div>
    </>
  );
}
