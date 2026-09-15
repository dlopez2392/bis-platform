// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx
//
// The account's "To do" screen (Work Queue Task 3) — READ-ONLY. Task 4 wires
// the Not now / Done / booking-outcome buttons; this page only reads and
// buckets `listAccountWork`'s three sources and renders them.
import { listAccountWork } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { bucketWork } from "@/lib/work/buckets";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import { WorkList } from "./work-list";

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
  await requireAccountAccess(accountId);
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

  // The RAW account timezone, unclamped by any UTC/server fallback —
  // bucketWork's own doc comment: a silent fallback here would reintroduce
  // the previous-day defect this repo has already shipped once. An invalid
  // zone degrades to "every row waits", which is still visible, just not
  // dated.
  const buckets = bucketWork(rows, new Date(), account.timezone);

  // ONE batch read for every contact these rows reference — never one read
  // per row. Scoped by account_id so a row's contactId can never resolve a
  // different account's person.
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
        <WorkList buckets={buckets} accountId={accountId} contactNames={contactNames} />
      </div>
    </>
  );
}
