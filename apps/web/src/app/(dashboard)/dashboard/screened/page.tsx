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
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import {
  listScreenedCalls, countScreenedCalls, countMisconfiguredScreenedCalls,
  listAccounts, serviceDb, resolveZone,
} from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAgency } from "@/lib/auth";
import { parseTimeCursor } from "@/lib/cursor";
import { renderZone } from "@/lib/zone";
import { m } from "@/lib/messages";
import { ScreenedTable } from "./screened-table";
import { parseScreenedClass } from "./filter";

export const dynamic = "force-dynamic";

/** One page of history. A full page back is the only signal there may be
 *  more, so it is also what decides whether the "Older" link renders. */
const PAGE_SIZE = 50;

export default async function ScreenedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; class?: string }>;
}) {
  await requireAgency();
  const { before, class: classParam } = await searchParams;
  const cursor = parseTimeCursor(before);
  // TOTAL, like `cursor` above: an unknown, empty, or hand-editable-into-
  // garbage `?class=` reads as "no filter" rather than a 500 or a page that
  // renders everything while its own header (below) claims to be scoped —
  // see filter.ts's own doc comment.
  const filterClass = parseScreenedClass(classParam);
  const db = serviceDb();

  const [rows, total, misconfiguredTotal, accounts] = await Promise.all([
    listScreenedCalls(db, { limit: PAGE_SIZE, before: cursor, class: filterClass }),
    // The SAME filter as the list read, so a filtered view's header states
    // the total that matches what is actually on screen — the banner's own
    // count is a DIFFERENT axis (24h distinct numbers vs. this list's
    // all-time rows) and must never be allowed to look like this number.
    countScreenedCalls(db, { class: filterClass }),
    // The REAL cross-page count for the breakdown beside `total` — never
    // `rows.filter(...)`, which only ever sees the 50 rows on this page.
    // Read unconditionally: when `filterClass` is set, `ScreenedTable` does
    // not render this breakdown at all (it would be redundant with, or
    // simply wrong beside, the now-filtered `total`), so a stale value
    // reaching an unused prop cannot mislead anyone.
    countMisconfiguredScreenedCalls(db),
    listAccounts(db),
  ]);

  // This is a CROSS-ACCOUNT list — unlike an in-account screen there is no
  // single zone to name once at the top, so each row prints in ITS OWN
  // account's zone (screened-table.tsx, via the same `formatCallTime` the
  // Calls list uses, short zone name and all). A row with no account
  // (`unknown-number`) has no account zone to claim, so it takes the
  // agency's own — resolved ONCE for the page: `renderZone` is `cache()`d
  // and total (never throws), so this costs one read and never a bare "UTC"
  // literal standing in unexplained.
  const agencyZone = await renderZone(undefined);

  // accountId → the account's own label and a ZONE — resolved through the
  // SAME `resolveZone` every other per-account screen uses
  // (calls/page.tsx, [callId]/page.tsx), never the raw `accounts.timezone`
  // column handed straight to a formatter. That column is free text; a
  // pre-#89 row can hold a value `Intl` cannot format, and unlike an
  // in-account screen this table is CROSS-ACCOUNT — one broken row must not
  // crash the render for every account on the platform, not just the one
  // that is misconfigured. Resolved ONCE per account, here, not per row and
  // not per render of a cell. A row with a null accountId has neither a
  // label nor a zone to claim, and that is a real state (the call was to a
  // number this platform does not own), not a lookup failure.
  const accountsById = new Map(
    accounts.map((a) => [a.id, { name: a.name, zone: resolveZone(a.timezone, agencyZone.zone).zone }]),
  );

  const last = rows[rows.length - 1];
  // The bug this shape classically produces: a full page carries the reader
  // from a FILTERED view into an unfiltered one with no indication, because
  // only `before` made the trip. `URLSearchParams`, not string concatenation
  // (`cursor.ts`'s own standing rule for every hand-built query string here).
  const olderHref = (() => {
    if (rows.length !== PAGE_SIZE || !last) return undefined;
    const params = new URLSearchParams({ before: last.createdAt });
    if (filterClass) params.set("class", filterClass);
    return `/dashboard/screened?${params.toString()}`;
  })();

  return (
    <>
      <PageHeader
        title={m["screened.title"]}
        // Rendered whenever a filter is active, in BOTH the empty and
        // non-empty branches below — the header, not the (possibly absent)
        // table, is what has to say what the list is scoped to, so the
        // banner's differently-scoped number and this page's own total can
        // never be read as the same claim.
        filters={filterClass ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{m[`screened.filter.scope.${filterClass}` as const]}</span>
            <Link href="/dashboard/screened" className="underline underline-offset-2">
              {m["screened.filter.clear"]}
            </Link>
          </p>
        ) : undefined}
      />
      <div className="space-y-6 p-6">
        {rows.length === 0 && filterClass && !cursor ? (
          // A filter that simply matched nothing is a DIFFERENT sentence
          // from a genuine cold start — "nothing has ever been turned away"
          // is false when the filter is the reason the list is empty. The
          // `!cursor` guard matters just as much here as it does two
          // branches below: a paged-in zero (the filtered row count was an
          // exact multiple of PAGE_SIZE) is not "nothing matches" either —
          // rows of this class exist, the reader just paged past them — so
          // that case falls through to `ScreenedTable` instead, same as the
          // unfiltered cold-start guard already does.
          <EmptyState
            icon={ShieldAlert}
            title={m["screened.empty.filtered.title"]}
            body={m["screened.empty.filtered.body"]}
          />
        ) : rows.length === 0 && !cursor ? (
          <EmptyState
            icon={ShieldAlert}
            title={m["screened.empty.title"]}
            body={m["screened.empty.body"]}
          />
        ) : (
          <ScreenedTable
            rows={rows}
            total={total}
            misconfiguredCount={misconfiguredTotal}
            accountsById={accountsById}
            agencyZone={agencyZone.zone}
            olderHref={olderHref}
            filterClass={filterClass}
          />
        )}
      </div>
    </>
  );
}
