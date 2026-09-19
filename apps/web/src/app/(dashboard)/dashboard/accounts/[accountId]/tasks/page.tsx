// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx
//
// The account's "To do" screen. Task 3 built it read-only; Task 4 wired the
// Not now / Done / booking-outcome buttons (`work-list.tsx` → `actions.ts` →
// `WorkRowActions`). This page itself still only reads and buckets
// `listAccountWork`'s three sources and renders them — the writes live in
// the files below it, not here.
import { listAccountWork, listPendingProposals, type CallProposal } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { renderZone } from "@/lib/zone";
import { ZoneNote } from "@/components/zone-note";
import { dbForRequest } from "@/lib/db";
import { bucketWork } from "@/lib/work/buckets";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { WorkList } from "./work-list";
import type { ResolvedStage } from "../calls/[callId]/proposals";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  // Authorization only — both audiences see this page (nav-groups.ts adds
  // it unconditionally, directly under Dashboard), so the returned role
  // isn't needed for anything this page itself renders.
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  // Only `timezone` — this page never shows the account/brand name (every
  // sibling list in this folder — Contacts, Calls, Forms, Conversations —
  // is titled plainly too; the sidebar already carries account identity).
  const account = await db
    .from("accounts")
    .select("timezone")
    .eq("id", accountId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`tasks: account lookup failed: ${error.message}`);
      if (!data) throw new Error("tasks: account not found");
      return data as { timezone: string };
    });

  const rows = await listAccountWork(db, accountId);

  // The resolved zone (lib/zone.ts), shared with the other four date
  // screens and with the account dashboard's copy of this same bucketing.
  //
  // This used to take the RAW `account.timezone` to avoid a SILENT UTC
  // fallback — right about the clamp it was refusing, wrong about the
  // remedy. Refusing to guess meant an unusable zone degraded to "every row
  // waits" and every row lost its date: the screen stopped answering the one
  // question it exists to answer. danlo, 2026-09-17: "I do not want to omit
  // the dates so let's find a workaround." `resolveZone` is the workaround —
  // it still never guesses silently, it just says so out loud instead of
  // going quiet.
  const zone = await renderZone(account.timezone);
  const buckets = bucketWork(rows, new Date(), zone.zone);

  // The SAME resolved zone the buckets above were computed in — which is the
  // whole point of resolving it once. A row formatted in one zone beside a
  // bucket chip computed in another can contradict itself inside a single
  // row, and that is precisely what the old split (raw zone for buckets,
  // nothing usable for dates) produced.
  const timezone = zone.zone;

  // Fix-wave Important 3 (task-11-brief): this account's own pending
  // proposals — "Both audiences see both surfaces" (the spec's own words):
  // the agency's cross-tenant work queue already rendered these; a client
  // who never opens a specific call never learns a suggestion exists.
  // Best-effort, exactly like the call-detail page's own proposals read: a
  // `call_proposals`/`pipeline_stages` hiccup must never cost this screen
  // its real to-do queue, and degrades to no suggestions section rather than
  // a broken page.
  let proposals: CallProposal[] = [];
  let stageNames: Record<string, ResolvedStage> = {};
  try {
    proposals = await listPendingProposals(db, accountId);
    const stageIds = new Set<string>();
    for (const p of proposals) {
      if (p.kind === "opportunity_stage") {
        stageIds.add(p.payload.fromStageId);
        stageIds.add(p.payload.toStageId);
      }
    }
    if (stageIds.size > 0) {
      const { data, error } = await db.from("pipeline_stages")
        .select("id, name, position")
        .eq("account_id", accountId)
        .in("id", Array.from(stageIds));
      if (error) throw new Error(`pipeline stage lookup failed: ${error.message}`);
      for (const row of (data ?? []) as { id: string; name: string; position: number }[]) {
        stageNames[row.id] = { name: row.name, position: row.position };
      }
    }
  } catch (e) {
    console.error(
      `tasks ${accountId}: proposals read failed, rendering no suggestions: ${String(e)}`,
    );
    proposals = [];
    stageNames = {};
  }

  // ONE batch read for every contact these rows (AND every pending proposal)
  // reference — never one read per row. Scoped by account_id so a contactId
  // can never resolve a different account's person.
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
      .eq("account_id", accountId)
      .in("id", contactIds);
    if (error) throw new Error(`tasks: contacts lookup failed: ${error.message}`);
    for (const c of contacts ?? []) {
      contactNames[c.id] = contactDisplayName(c);
    }
  }

  return (
    <>
      <PageHeader title={m["work.title"]} />
      <div className="p-6">
        <ZoneNote
          zone={zone}
          isAgency={isAgency}
          accountId={accountId}
          className="mb-4"
        />
        <WorkList
          buckets={buckets}
          accountId={accountId}
          contactNames={contactNames}
          timezone={timezone}
          proposals={proposals}
          stageNames={stageNames}
        />
      </div>
    </>
  );
}
