"use client";

import { useState } from "react";
import { m } from "@/lib/messages";
import { formatDateUTC } from "@/lib/format";

type Day = { day: string; visitors: number; pageviews: number; isWeekend: boolean };
export type SecondSeries = { label: string; values: number[] };

/**
 * Thin accent-gradient bars, 4px tops and 2px feet, weekend bars muted
 * (`--bar-wk`), an axis rule under the bars, two dashed gridlines, a mono
 * label under every day, a
 * tooltip on hover AND focus (each bar is a button so a keyboard reaches it).
 * Bars are DIVs, not SVG rects, so every colour is a token class.
 *
 * ONE optional second series (Northern Lights spec §5): a polyline in
 * --accent-2 on the SAME axis — its y is scaled by the bars' max, never its
 * own — with a mono legend naming both. Never a second axis.
 */
export function DailyChart({ days, secondSeries }: { days: Day[]; secondSeries?: SecondSeries }) {
  const [active, setActive] = useState<number | null>(null);
  // ONE axis for both series: the scale is the larger of the bars' max and
  // the second series' max. Scaling by the bars alone clipped the line flat
  // at the top whenever pageviews ÷ 3 exceeded visitors (any site averaging
  // more than three pages per visit); scaling the line by its OWN max would
  // be a second axis in disguise. Bars shorten when the line is taller —
  // the tooltip still reports the true numbers.
  const max = Math.max(1, ...days.map((d) => d.visitors), ...(secondSeries?.values ?? []));
  const shortDate = (day: string) => formatDateUTC(day).replace(/,.*$/, "");
  const xAt = (i: number) => ((i + 0.5) / days.length) * 100;
  const yAt = (v: number) => 100 - Math.min(100, Math.max(0, (v / max) * 100));
  const points = secondSeries
    ? days.map((_, i) => `${xAt(i)},${yAt(secondSeries.values[i] ?? 0)}`).join(" ")
    : null;
  // The mockup marks the SECOND SERIES' peak, not its last point
  // (northern-lights.html:268 puts the circle at 607,14 — the maximum).
  const peak = secondSeries
    ? secondSeries.values.reduce((best, v, i) => (v > (secondSeries.values[best] ?? -Infinity) ? i : best), 0)
    : 0;
  return (
    <div className="relative mt-3">
      {active !== null ? (
        <div role="tooltip" className="pointer-events-none absolute -top-1 z-10 rounded-[7px] border border-[var(--tip-line)] glass-overlay px-2 py-[5px] font-mono text-[10.5px]"
             style={{ left: `${xAt(active)}%`, transform: "translateX(-50%)" }}>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{formatDateUTC(days[active]!.day)}</span>
          <span className="text-card-foreground">
            {m["website.chart.tooltip"].replace("{visitors}", days[active]!.visitors.toLocaleString("en-US")).replace("{pageviews}", days[active]!.pageviews.toLocaleString("en-US"))}
          </span>
        </div>
      ) : null}
      <div className="relative flex h-[168px] items-end gap-[7px] border-b border-[var(--axis)] px-[2px]" onMouseLeave={() => setActive(null)}>
        {[33, 66].map((pct) => (
          <div key={pct} aria-hidden data-slot="chart-grid" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${pct}%` }} />
        ))}
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            data-slot="chart-bar"
            aria-label={`${formatDateUTC(d.day)}: ${d.visitors} visitors, ${d.pageviews} pageviews`}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            className={`relative flex-1 rounded-t-[4px] rounded-b-[2px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${d.isWeekend ? "bg-[var(--bar-wk)]" : "bar-accent"} ${active === i ? "bar-hot" : ""} ${active !== null && active !== i ? "opacity-70" : ""}`}
            style={{ height: `${Math.max(2, (d.visitors / max) * 100)}%` }}
          />
        ))}
        {points ? (
          <>
            <svg data-slot="chart-series-2" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <polyline points={points} fill="none" stroke="var(--accent-2)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {/* End dot as a DIV: a circle inside a non-uniformly scaled SVG would squash. r 4 = size-2. */}
            <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-[var(--accent-2)]"
                  style={{ left: `${xAt(peak)}%`, bottom: `${100 - yAt(secondSeries!.values[peak] ?? 0)}%` }} />
          </>
        ) : null}
      </div>
      {/* Every day is labelled (the mockup draws all 14), each in its own equal
          column so the labels line up under their bars. Narrow viewports thin
          by PARITY — the odd labels' text hides while their column stays — so
          the axis never collapses to three stray words. */}
      <div className="flex pt-1.5" aria-hidden data-slot="chart-axis">
        {days.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 text-center font-mono text-[10px] text-muted-foreground">
            <span className={i % 2 === 1 ? "hidden xl:inline" : ""}>{shortDate(d.day)}</span>
          </span>
        ))}
      </div>
      {secondSeries ? (
        <div data-slot="chart-legend" className="mt-2 flex items-center gap-[14px] font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--accent)]" />{m["website.tile.visitors"]}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--accent-2)]" />{secondSeries.label}</span>
        </div>
      ) : null}
    </div>
  );
}
