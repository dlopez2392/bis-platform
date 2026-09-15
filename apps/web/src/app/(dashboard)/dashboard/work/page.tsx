// apps/web/src/app/(dashboard)/dashboard/work/page.tsx
//
// The agency-wide work queue (Work Queue Task 6, spec §4.2). Top level,
// beside Companies and Blueprints — the first screen in the app whose whole
// purpose is to span every account. `requireAgency()` is the literal first
// line, before any read: the query below reads every account's open tasks,
// unanswered conversations and un-closed-out bookings in one pass, and that
// read must never even be ISSUED on a client's behalf, boundary test first
// (apps/web/e2e/work-queue.spec.ts, Task 6 Step 1).
import { listAgencyWork, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgency } from "@/lib/auth";
import { bucketAgencyWork } from "@/lib/work/agency-buckets";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { AgencyWorkList } from "./agency-work-list";

export const dynamic = "force-dynamic";

export default async function AgencyWorkPage() {
  await requireAgency();

  const db = serviceDb();
  // Every account's rows in one pass, each already carrying its OWN
  // brand_name and timezone (packages/db/src/work-queue.ts) — no per-account
  // account lookup here, unlike the per-account screen, because the zone and
  // the display name both travel with the row already.
  const rows = await listAgencyWork(db);

  // Each account's rows are bucketed in THAT account's own zone, never one
  // zone borrowed across every row — see agency-buckets.ts's own doc
  // comment. `new Date()` here is the one clock reference for the whole
  // read, same as the per-account screen's page.tsx.
  const buckets = bucketAgencyWork(rows, new Date());

  // ONE batch read for every contact referenced across every account's rows
  // — never one read per row and never one per account. Not account-scoped
  // (unlike the per-account screen's own contacts lookup): the ids here come
  // from `listAgencyWork`'s own already-cross-tenant read via `serviceDb`,
  // not from user input, so there is nothing for an account filter to guard
  // against — a contact id can only ever resolve to the row that produced it.
  const contactIds = [...new Set(
    [...buckets.overdue, ...buckets.today, ...buckets.waiting]
      .map((r) => r.contactId)
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

  return (
    <>
      <PageHeader title={m["work.agency.title"]} subtitle={m["work.agency.subtitle"]} />
      <div className="p-6">
        <AgencyWorkList buckets={buckets} contactNames={contactNames} />
      </div>
    </>
  );
}
