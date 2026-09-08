"use client";

import { useState } from "react";
import { m } from "@/lib/messages";
import { formatDateUTC } from "@/lib/format";

type Day = { day: string; visitors: number; pageviews: number; isWeekend: boolean };

/**
 * Thin accent bars with 4px rounded tops, weekend bars muted (`bg-accent`
 * = --surface-3), mono axis labels, a tooltip on hover AND focus (each bar
 * is a button so a keyboard reaches it). Bars are DIVs, not SVG rects, so
 * every colour is a token class — no hard-coded hex anywhere.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const labelAt = (i: number) => i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
  const shortDate = (day: string) => formatDateUTC(day).replace(/,.*$/, "");
  return (
    <div className="relative mt-3">
      {active !== null ? (
        <div role="tooltip" className="pointer-events-none absolute -top-1 z-10 rounded-lg border border-border bg-accent px-2.5 py-1.5 text-xs"
             style={{ left: `${((active + 0.5) / days.length) * 100}%`, transform: "translateX(-50%)" }}>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{formatDateUTC(days[active]!.day)}</span>
          <span className="font-semibold text-card-foreground">
            {m["website.chart.tooltip"].replace("{visitors}", days[active]!.visitors.toLocaleString("en-US")).replace("{pageviews}", days[active]!.pageviews.toLocaleString("en-US"))}
          </span>
        </div>
      ) : null}
      <div className="flex h-[120px] items-end gap-[6px]" onMouseLeave={() => setActive(null)}>
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            aria-label={`${formatDateUTC(d.day)}: ${d.visitors} visitors, ${d.pageviews} pageviews`}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            className={`flex-1 rounded-t-[4px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${d.isWeekend ? "bg-accent" : "bg-primary"} ${active !== null && active !== i ? "opacity-70" : ""}`}
            style={{ height: `${Math.max(2, (d.visitors / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between" aria-hidden>
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            {labelAt(i) ? shortDate(d.day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
