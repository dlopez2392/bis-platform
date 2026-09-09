"use client";

import { useState } from "react";
import { m } from "@/lib/messages";
import { formatDateUTC } from "@/lib/format";

type Day = { day: string; visitors: number; pageviews: number; isWeekend: boolean };
export type SecondSeries = { label: string; values: number[] };

/**
 * Thin accent-gradient bars with 4px rounded tops, weekend bars muted
 * (`bg-accent` = --surface-3), two dashed gridlines, mono axis labels, a
 * tooltip on hover AND focus (each bar is a button so a keyboard reaches it).
 * Bars are DIVs, not SVG rects, so every colour is a token class.
 *
 * ONE optional second series (Northern Lights spec §5): a polyline in
 * --accent-2 on the SAME axis — its y is scaled by the bars' max, never its
 * own — with a mono legend naming both. Never a second axis.
 */
export function DailyChart({ days, secondSeries }: { days: Day[]; secondSeries?: SecondSeries }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const labelAt = (i: number) => i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
  const shortDate = (day: string) => formatDateUTC(day).replace(/,.*$/, "");
  const xAt = (i: number) => ((i + 0.5) / days.length) * 100;
  const yAt = (v: number) => 100 - Math.min(100, Math.max(0, (v / max) * 100));
  const points = secondSeries
    ? days.map((_, i) => `${xAt(i)},${yAt(secondSeries.values[i] ?? 0)}`).join(" ")
    : null;
  const last = days.length - 1;
  return (
    <div className="relative mt-3">
      {active !== null ? (
        <div role="tooltip" className="pointer-events-none absolute -top-1 z-10 rounded-lg border border-border glass-overlay px-2.5 py-1.5 text-xs"
             style={{ left: `${xAt(active)}%`, transform: "translateX(-50%)" }}>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{formatDateUTC(days[active]!.day)}</span>
          <span className="font-semibold text-card-foreground">
            {m["website.chart.tooltip"].replace("{visitors}", days[active]!.visitors.toLocaleString("en-US")).replace("{pageviews}", days[active]!.pageviews.toLocaleString("en-US"))}
          </span>
        </div>
      ) : null}
      <div className="relative flex h-[120px] items-end gap-[6px]" onMouseLeave={() => setActive(null)}>
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
            className={`relative flex-1 rounded-t-[4px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${d.isWeekend ? "bg-accent" : "bar-accent"} ${active === i ? "bar-hot" : ""} ${active !== null && active !== i ? "opacity-70" : ""}`}
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
                  style={{ left: `${xAt(last)}%`, bottom: `${100 - yAt(secondSeries!.values[last] ?? 0)}%` }} />
          </>
        ) : null}
      </div>
      <div className="mt-2 flex justify-between" aria-hidden data-slot="chart-axis">
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            {labelAt(i) ? shortDate(d.day) : ""}
          </span>
        ))}
      </div>
      {secondSeries ? (
        <div data-slot="chart-legend" className="mt-2 flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-[var(--accent)]" />{m["website.tile.visitors"]}</span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full bg-[var(--accent-2)]" />{secondSeries.label}</span>
        </div>
      ) : null}
    </div>
  );
}
