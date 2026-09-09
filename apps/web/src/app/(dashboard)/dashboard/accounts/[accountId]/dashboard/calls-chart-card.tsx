// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/calls-chart-card.tsx
//
// Task 6: the 14-day calls chart + recent-calls mini table. A server
// component — every hover effect below is CSS-only (`group`/`group-hover`),
// so there is nothing here to hydrate. Data arrives entirely as props from
// the page (`page.tsx`'s own `Promise.all`); this file issues no queries of
// its own beyond the pure `dayBuckets`/`recentCalls` it is handed.
//
// Construction reference: `…/website/daily-chart.tsx`, which is the repo's
// chart language, and docs/design/northern-lights.html behind it. This file
// was a SECOND, completely separate chart implementation that predated that
// language and got none of it — a 120px plot of flat `bg-primary` blocks on a
// `--line` baseline, weekends on `--surface-3`, no gridlines, no busiest-day
// mark, an opaque `bg-popover` tooltip with a grey `shadow-sm`, and an "axis"
// that was three stray words spread by `justify-between`. Every one of those
// is the same defect the other chart already fixed; see `Bars` below.
//
// The tooltip's TEXT is rendered as an ordinary child node rather than the
// mockup's `data-v` + CSS `content:attr()` indirection — React already holds
// the formatted string, so stashing it in a data attribute only to have
// `::after` read it back would be a round-trip for no benefit, and risks a
// Tailwind arbitrary-value escaping mistake nothing here could catch without
// a live browser. Each bar column carries the same fact as an `aria-label`
// on a focusable `role="img"`, which is what covers assistive tech AND the
// sighted keyboard user the hover-only tooltip used to leave with nothing.
import Link from "next/link";
import { PhoneIncoming } from "lucide-react";
import type { CallListRow } from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { longDayLabel, shortDayLabel } from "@/lib/dashboard/day-label";
import { callerLabel, formatDuration } from "../calls/format";
import { OutcomePill } from "../calls/outcome-pill";

/** Percent of the tallest bar, floored so a genuine zero-call day sitting
 *  next to a 13-call one is still a visible mark — the same reason the
 *  mockup floors its own bars, and the same floor `daily-chart.tsx` uses.
 *  Percentages, not px: the plot has a definite height (`h-[168px]`), so the
 *  px arithmetic that used to compensate for a `pt-1.5` this container no
 *  longer has is gone with it. */
const MIN_BAR_PERCENT = 2;

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
    <div className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
      <div className="flex items-baseline gap-2">
        <h5 className="text-[13.5px] font-semibold text-card-foreground">{m["dashboard.calls.title"]}</h5>
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
        <Bars dayBuckets={dayBuckets} />
      )}

      {/* Keyed on `recentCalls` itself, independent of the 14-day `isEmpty`
          gate above: `recentCalls` is deliberately the 3 most recent calls
          EVER (see this prop's own doc comment on the component signature),
          so a quiet 14-day window must not hide real older history — the
          chart area still shows its empty state, but the table renders
          below it whenever there is anything in it to show. */}
      {recentCalls.length > 0 ? (
        <RecentCallsTable calls={recentCalls} accountId={accountId} timezone={timezone} />
      ) : null}
    </div>
  );
}

/** "Aug 18 · 5 calls" / "August 18, 5 calls" — shared count→copy resolution
 *  so the visible tooltip and the column's accessible name can never disagree
 *  about which noun ("call" vs "calls") a given count takes. */
function callsUnit(count: number): string {
  return count === 1 ? m["dashboard.calls.unit.call"] : m["dashboard.calls.unit.calls"];
}

/**
 * The chart language, shared with `…/website/daily-chart.tsx`: a 168px plot
 * on a `--axis` rule, 7px gaps, the accent-gradient bar with a 4px top and a
 * 2px foot, weekends on `--bar-wk` (`--surface-3` is 29% too bright for
 * this), the busiest day in `bar-hot` — one of the three sanctioned
 * `--accent-2` moments, and it was missing from the first screen the owner
 * opens — two dashed gridlines, a `glass-overlay` tooltip, and a mono label
 * under EVERY day, thinned by parity rather than down to three stray words.
 *
 * Still a server component: every hover effect is CSS-only (`group/bar`), so
 * there is nothing here to hydrate. The reference chart is a client component
 * only because its bars are `<button>`s that drive React state.
 */
function Bars({ dayBuckets }: { dayBuckets: { dayKey: string; count: number; isWeekend: boolean }[] }) {
  const max = Math.max(1, ...dayBuckets.map((b) => b.count));
  // The BUSIEST day, resolved once. Ties keep the earliest, which is the same
  // rule `dayBuckets`' own ascending order already implies.
  const peak = dayBuckets.reduce((best, b, i) => (b.count > dayBuckets[best]!.count ? i : best), 0);

  return (
    <>
    <div className="relative mt-3 flex h-[168px] items-end gap-[7px] border-b border-[var(--axis)] px-[2px]">
      {[33, 66].map((pct) => (
        <div
          key={pct}
          aria-hidden
          data-slot="chart-grid"
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
          style={{ bottom: `${pct}%` }}
        />
      ))}
      {dayBuckets.map((bucket, i) => {
        const heightPercent = Math.max(MIN_BAR_PERCENT, (bucket.count / max) * 100);
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
          // The COLUMN is the hover target and the group, so a 2%-tall zero
          // day is still reachable; the tooltip lives inside the bar so it
          // anchors above the bar's own top rather than the plot's.
          //
          // FOCUSABLE, and this is the half wave 1 deferred. The tooltip used
          // to be hover-only, so a SIGHTED keyboard user got nothing at all —
          // the `sr-only` twin served screen readers and nobody else. The
          // column takes the tab stop rather than the bar (a 2%-tall bar is
          // an unhittable focus target), and `role="img"` + `aria-label`
          // replaces that twin: with a name and that role its children are
          // presentational, so keeping both would have announced the day
          // twice. The reference chart reaches the same place with a
          // `<button>` because its bars drive React state; these do not, so
          // this file stays a server component with no hydration cost.
          <div
            key={bucket.dayKey}
            tabIndex={0}
            role="img"
            aria-label={srText}
            className="group/bar relative flex h-full flex-1 flex-col justify-end rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div
              data-slot="chart-bar"
              className={cn(
                "relative rounded-t-[4px] rounded-b-[2px]",
                bucket.isWeekend ? "bg-[var(--bar-wk)]" : "bar-accent",
                i === peak && "bar-hot",
              )}
              style={{ height: `${heightPercent}%` }}
            >
              {/* The hover/focus tooltip — every mark carries one (DESIGN.md's
                  chart section). `aria-hidden`: the column's own `aria-label`
                  is the accessible copy of this fact, not this element.
                  `glass-overlay` carries both the fill and `--shadow-overlay`,
                  so there is no `bg-popover` and no grey `shadow-sm` here. */}
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 rounded-[7px] border border-[var(--tip-line)] glass-overlay px-2 py-[5px] font-mono text-[10.5px] whitespace-nowrap opacity-0 transition-opacity group-hover/bar:opacity-100 group-focus-visible/bar:opacity-100 motion-reduce:transition-none"
              >
                {tooltip}
              </div>
            </div>
          </div>
        );
      })}
    </div>
    {/* Every day is labelled, each in its own equal column so the labels line
        up under their bars; narrow viewports thin by PARITY — the odd labels'
        text hides while their column stays — so the axis never collapses to
        three stray words, which is what stood here before. */}
    <div className="flex pt-1.5" aria-hidden data-slot="chart-axis">
      {dayBuckets.map((bucket, i) => (
        <span
          key={bucket.dayKey}
          className="min-w-0 flex-1 text-center font-mono text-[10px] text-muted-foreground"
        >
          <span className={i % 2 === 1 ? "hidden xl:inline" : ""}>{shortDayLabel(bucket.dayKey)}</span>
        </span>
      ))}
    </div>
    {/* "Weekends muted" is a LEGEND, not a tick — it never belonged in the
        axis row. Same shape as the reference chart's own legend. */}
    <div
      data-slot="chart-legend"
      className="mt-2 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase"
    >
      <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--bar-wk)]" />
      {m["dashboard.calls.axis.weekendsMuted"]}
    </div>
    </>
  );
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
                {/* Shared with the Calls list: `callerLabel`'s own doc
                    comment explains why it is NOT `contactDisplayName` — a
                    linked contact can carry no name at all (a call can
                    create one from nothing but a spoken email address), and
                    `contactDisplayName`'s "(no name)" fallback would win
                    over a perfectly good phone number. One chain, reused
                    here rather than a second copy that could drift from it
                    (a review caught exactly that drift in an earlier draft
                    of this file). */}
                <Link href={href} className="block py-2.5 pr-2 pl-0 font-medium text-foreground hover:underline">
                  {callerLabel(call)}
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
