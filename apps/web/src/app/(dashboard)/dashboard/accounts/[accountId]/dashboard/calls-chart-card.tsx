// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/calls-chart-card.tsx
//
// Task 6: the 14-day calls chart + recent-calls mini table. A server
// component — every hover effect below is CSS-only (`group`/`group-hover`),
// so there is nothing here to hydrate. Data arrives entirely as props from
// the page (`page.tsx`'s own `Promise.all`); this file issues no queries of
// its own beyond the pure `dayBuckets`/`recentCalls` it is handed.
//
// Construction reference: docs/design/bis-design-direction.html's `.bars`/
// `.axis`/`table.mini` rules (~lines 126-151) — CSS bars (a div per day,
// height as a percentage of the window max), a hover tooltip on every mark,
// and a headerless 3-row mini table. Rebuilt with tokens (`bg-primary`/
// `bg-muted`, never a literal color) rather than the mockup's raw `--ac`/
// `--s3` custom properties, and the tooltip's TEXT is rendered as an
// ordinary child node instead of the mockup's `data-v` + CSS
// `content:attr()` indirection — React already holds the formatted string,
// so stashing it in a data attribute only to have `::after` read it back
// would be a round-trip for no benefit, and risks a Tailwind arbitrary-value
// escaping mistake nothing here could catch without a live browser. The
// visible behavior (a token-styled tooltip above the mark, shown on hover)
// is identical either way; the `sr-only` twin per bar covers assistive tech
// exactly as the brief specifies.
import Link from "next/link";
import { PhoneIncoming } from "lucide-react";
import type { CallListRow } from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { contactDisplayName } from "@/lib/format";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { longDayLabel, shortDayLabel } from "@/lib/dashboard/day-label";
import { formatDuration } from "../calls/format";
import { OutcomePill } from "../calls/outcome-pill";

/** Fixed bars-container height, pinned by the brief (not the mockup's own
 *  110px). */
const BARS_HEIGHT_PX = 120;
/** Every bar stays visible — including a genuine zero-call day sitting next
 *  to a 13-call one — the same reason the mockup floors its own bars at
 *  `min-height:6px`. 4px keeps this on the repo's 4px spacing grid (Shape &
 *  motion) rather than lifting the mockup's un-aligned 6px verbatim. */
const MIN_BAR_HEIGHT_PX = 4;

export function CallsChartCard({
  accountId,
  timezone,
  dayBuckets,
  recentCalls,
  isAgency,
  voiceEnabled,
}: {
  accountId: string;
  /** The ACCOUNT's IANA zone — the mini table's local time column reads it,
   *  never the viewer's own clock. */
  timezone: string;
  /** 14 entries, ascending by date, from `bucketByLocalDay` — the LAST entry
   *  is always today by construction (`localDayWindow`'s own doc comment). */
  dayBuckets: { dayKey: string; count: number; isWeekend: boolean }[];
  /** Up to 3 rows, most-recent first — `listCalls(db, accountId, { limit: 3
   *  })`, unfiltered by the 14-day window (a client's 3 most recent calls
   *  ever, not "most recent within the chart"). */
  recentCalls: CallListRow[];
  /** Gates which page the empty state's ghost link can safely send someone
   *  to — see the comment beside `ctaHref` below. */
  isAgency: boolean;
  voiceEnabled: boolean;
}) {
  const base = `/dashboard/accounts/${accountId}`;
  const totalCalls = dayBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const isEmpty = totalCalls === 0;

  // The Voice page is agency-only (`requireAgencyOnlyAccountAccess` —
  // voice/page.tsx's own doc comment: "the nav item is hidden from clients").
  // The brief's own rule ("Voice page when no enabled profile") is written
  // for the agency reading this same card; sending a CLIENT viewer there
  // would land them on an access-denied page for a route they can never
  // manage. Calls is reachable by both audiences (`requireAccountAccess`),
  // so it is the fallback whenever the viewer isn't the agency — whether
  // because there's genuinely nothing to set up (profile enabled, window
  // just quiet) or because this viewer couldn't act on the Voice link even
  // if it were honest.
  const offerVoiceSetup = isAgency && !voiceEnabled;
  const ctaHref = offerVoiceSetup ? `${base}/voice` : `${base}/calls`;
  const ctaLabel = offerVoiceSetup ? m["dashboard.calls.emptySetupVoice"] : m["dashboard.calls.emptyViewCalls"];

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-baseline gap-2">
        <h5 className="text-sm font-semibold text-card-foreground">{m["dashboard.calls.title"]}</h5>
        <span className="ml-auto font-mono text-[10px] font-normal tracking-[0.14em] text-muted-foreground uppercase">
          {m["dashboard.calls.caption"]}
        </span>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={PhoneIncoming}
          title={m["dashboard.calls.empty"]}
          action={
            <Link href={ctaHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              {ctaLabel}
            </Link>
          }
        />
      ) : (
        <>
          <Bars dayBuckets={dayBuckets} />
          <div className="mt-1.5 flex justify-between font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            <span>{shortDayLabel(dayBuckets[0]!.dayKey)}</span>
            <span>{m["dashboard.calls.axis.weekendsMuted"]}</span>
            <span>{m["dashboard.calls.axis.today"]}</span>
          </div>

          {recentCalls.length > 0 ? (
            <RecentCallsTable calls={recentCalls} accountId={accountId} timezone={timezone} />
          ) : null}
        </>
      )}
    </div>
  );
}

/** "Aug 18 · 5 calls" / "August 18, 5 calls" — shared count→copy resolution
 *  so the visible tooltip and its `sr-only` twin can never disagree about
 *  which noun ("call" vs "calls") a given count takes. */
function callsUnit(count: number): string {
  return count === 1 ? m["dashboard.calls.unit.call"] : m["dashboard.calls.unit.calls"];
}

function Bars({ dayBuckets }: { dayBuckets: { dayKey: string; count: number; isWeekend: boolean }[] }) {
  const max = Math.max(1, ...dayBuckets.map((b) => b.count));

  return (
    <div className="mt-3.5 flex h-[120px] items-end gap-1 border-b border-border pt-1.5">
      {dayBuckets.map((bucket) => {
        const heightPx = Math.max(MIN_BAR_HEIGHT_PX, Math.round((bucket.count / max) * BARS_HEIGHT_PX));
        const unit = callsUnit(bucket.count);
        const tooltip = m["dashboard.calls.tooltip"]
          .replace("{date}", shortDayLabel(bucket.dayKey))
          .replace("{count}", String(bucket.count))
          .replace("{unit}", unit);
        const srText = m["dashboard.calls.tooltipSr"]
          .replace("{date}", longDayLabel(bucket.dayKey))
          .replace("{count}", String(bucket.count))
          .replace("{unit}", unit);

        return (
          <div key={bucket.dayKey} className="group/bar relative flex flex-1 flex-col justify-end">
            <div
              className={cn("rounded-t-[4px]", bucket.isWeekend ? "bg-muted" : "bg-primary")}
              style={{ height: `${heightPx}px` }}
            />
            {/* The hover tooltip — every mark carries one (DESIGN.md's chart
                section). `aria-hidden`: the `sr-only` span below is the
                accessible copy of the same fact, not this element. */}
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1 text-[10px] whitespace-nowrap text-popover-foreground opacity-0 shadow-sm transition-opacity group-hover/bar:opacity-100"
            >
              {tooltip}
            </div>
            <span className="sr-only">{srText}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Who rang: the matched contact's display name, else the number they rang
 *  from, else the shared "Unknown caller" fallback (a withheld caller ID
 *  with no matched contact — rare, but a real row shape `calls-table.tsx`
 *  already has to render). Deliberately `contactDisplayName` here, NOT
 *  `callerLabel` (calls/format.ts): the brief calls for "contact display
 *  name or E.164", and `callerLabel`'s own doc comment explains why it
 *  exists instead — its number-over-"(no name)" precedence is right for the
 *  full Calls list, but this mini table is meant to read as a name-first
 *  glance the way the mockup's own "Maria Garcia" example does. */
function whoLabel(call: CallListRow): string {
  if (call.contact) return contactDisplayName(call.contact);
  return call.caller_e164?.trim() || m["calls.unknownCaller"];
}

function RecentCallsTable({
  calls,
  accountId,
  timezone,
}: {
  calls: CallListRow[];
  accountId: string;
  timezone: string;
}) {
  const base = `/dashboard/accounts/${accountId}`;

  return (
    <Table className="mt-4">
      <TableBody>
        {calls.map((call) => {
          const href = `${base}/calls/${call.id}`;
          const meta = `${formatDuration(call.duration_secs)} · ${call.language.toUpperCase()}`;
          // Local time only (no date) — these are the 3 most RECENT calls, the
          // same reading the mockup's own mini table gives ("5:20 PM"), not
          // the full Calls list's multi-year "when" column (formatCallTime).
          // Explicit `timeZone`, the ACCOUNT's own, never the viewer's —
          // same discipline `calls-table.tsx`'s own `formatCallTime` follows.
          const time = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(call.started_at));

          // Rule 4: the whole row is the click target. Each cell carries its
          // own Link to the SAME call-detail href rather than one overlay
          // stretched across the `<tr>` — `calls-table.tsx`'s own comment
          // records why that trick is avoided in this codebase (a `<tr>`
          // that doesn't honor `position: relative` lets the overlay resolve
          // against the table container instead, swallowing every click in
          // it). Only the first is announced to assistive tech; the rest are
          // `aria-hidden`/`tabIndex={-1}` mouse-only sugar, the same "one
          // announced link per row is enough" reasoning `calls-table.tsx`
          // already applies to its own decorative chevron link.
          return (
            <TableRow key={call.id}>
              <TableCell className="p-0">
                <Link href={href} className="block py-2.5 pr-2 pl-0 font-medium text-foreground hover:underline">
                  {whoLabel(call)}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link
                  href={href}
                  aria-hidden
                  tabIndex={-1}
                  className="block px-2 py-2.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {meta}
                </Link>
              </TableCell>
              <TableCell className="p-0">
                <Link href={href} aria-hidden tabIndex={-1} className="block px-2 py-2.5">
                  <OutcomePill outcome={call.outcome} />
                </Link>
              </TableCell>
              <TableCell className="p-0 text-right">
                <Link
                  href={href}
                  aria-hidden
                  tabIndex={-1}
                  className="block py-2.5 pr-0 pl-2 tabular-nums text-muted-foreground"
                >
                  {time}
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
