// The refusals the product used to forget.
//
// `requireAgency()` is the literal first line, before any read — every read
// below is cross-tenant through `serviceDb()`, and such a read must never be
// ISSUED on a client's behalf, not merely have its output withheld. The same
// discipline /dashboard/numbers states in its own header.
//
// The table itself is unreadable by `authenticated` at all (0039 revokes the
// grant), so this route is the only way in and the gate above is the whole
// of the access control.
import { ShieldAlert } from "lucide-react";
import { listScreenedCalls, countScreenedCalls, listAccounts, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAgency } from "@/lib/auth";
import { parseTimeCursor } from "@/lib/cursor";
import { renderZone } from "@/lib/zone";
import { m } from "@/lib/messages";
import { ScreenedTable } from "./screened-table";

export const dynamic = "force-dynamic";

/** One page of history. A full page back is the only signal there may be
 *  more, so it is also what decides whether the "Older" link renders. */
const PAGE_SIZE = 50;

export default async function ScreenedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  await requireAgency();
  const { before } = await searchParams;
  const cursor = parseTimeCursor(before);
  const db = serviceDb();

  const [rows, total, accounts] = await Promise.all([
    listScreenedCalls(db, { limit: PAGE_SIZE, before: cursor }),
    countScreenedCalls(db),
    listAccounts(db),
  ]);

  // accountId → the account's own label and zone. A row with a null
  // accountId has neither, and that is a real state (the call was to a
  // number this platform does not own), not a lookup failure.
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // This is a CROSS-ACCOUNT list — unlike an in-account screen there is no
  // single zone to name once at the top, so each row prints in ITS OWN
  // account's zone (screened-table.tsx, via the same `formatCallTime` the
  // Calls list uses, short zone name and all). A row with no account
  // (`unknown-number`) has no account zone to claim, so it takes the
  // agency's own — resolved ONCE for the page: `renderZone` is `cache()`d
  // and total (never throws), so this costs one read and never a bare "UTC"
  // literal standing in unexplained.
  const agencyZone = await renderZone(undefined);

  const last = rows[rows.length - 1];
  const olderHref =
    rows.length === PAGE_SIZE && last
      ? `/dashboard/screened?before=${encodeURIComponent(last.createdAt)}`
      : undefined;

  return (
    <>
      <PageHeader title={m["screened.title"]} />
      <div className="space-y-6 p-6">
        {rows.length === 0 && !cursor ? (
          <EmptyState
            icon={ShieldAlert}
            title={m["screened.empty.title"]}
            body={m["screened.empty.body"]}
          />
        ) : (
          <ScreenedTable
            rows={rows}
            total={total}
            accountsById={accountsById}
            agencyZone={agencyZone.zone}
            olderHref={olderHref}
          />
        )}
      </div>
    </>
  );
}
