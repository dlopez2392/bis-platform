import { StatTile } from "@/components/stat-tile";
import { formatDateUTC } from "@/lib/format";
import { m } from "@/lib/messages";
import { PLACE_DIMENSION } from "@/lib/vercel/web-analytics";
import type { WebsiteView } from "@/lib/website/view-model";
import { DailyChart } from "./daily-chart";
import { BreakdownPanel } from "./breakdown-panel";
import { DeviceStrip } from "./device-strip";

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const pct = (share: number) => `${Math.round(share * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The locked layout (docs/design/website-section.html): the sentence panel,
 * four tiles, the daily chart, three panels. `formatDateUTC` for day keys —
 * a `YYYY-MM-DD` is a calendar date, and `new Date(key)` would render the
 * previous day in the Americas (the recorded bug class).
 */
export function WebsiteSection({ view }: { view: WebsiteView }) {
  const googlePts = Math.round((view.fromGoogle.share - view.fromGoogle.priorShare) * 100);
  // Task 1's finding: the API has no city/region grouping, so the third
  // panel is Devices and the strip under the chart is dropped — devices are
  // shown once, not twice. "Where they were" returns with PLACE_DIMENSION.
  const showPlaces = PLACE_DIMENSION !== "country";
  // The mockup's supporting line under the sentence: totals plus the day that
  // stood out. Skipped entirely when there is no day with any traffic, rather
  // than printing "your busiest day was" over a flat zero.
  const busiest = view.days.reduce<(typeof view.days)[number] | null>(
    (best, d) => (d.visitors > 0 && (!best || d.visitors > best.visitors) ? d : best),
    null,
  );
  return (
    <div className="space-y-3 p-6">
      {/* The mockup's .card.sentence carries its own .lbl row (period on the
          left, the update stamp pushed right) INSIDE the card, then the
          sentence, then a 13.5px supporting line. */}
      <section className="rounded-xl border border-border bg-card glass px-[22px] py-[18px]" aria-label="Summary">
        <div className="mb-2 flex items-center justify-between gap-2.5">
          <p className={LABEL}>{m[`website.periodLabel.${view.period}`]}</p>
          {view.stale && view.lastSyncedDay ? (
            <p className="text-xs text-muted-foreground" role="status">{m["website.stale"].replace("{date}", formatDateUTC(view.lastSyncedDay))}</p>
          ) : (
            <p className="font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground">{view.lastSyncedDay ? m["website.updatedOn"].replace("{date}", formatDateUTC(view.lastSyncedDay)) : m["website.updated"]}</p>
          )}
        </div>
        {/* 24px (mockup --sentence-size): gradient text is legal only at display size (spec §3.4). */}
        <p className="mb-1.5 max-w-[62ch] font-display text-[24px] font-[600] leading-[1.15] tracking-[-0.02em] text-card-foreground">
          {view.sentence.map((s, i) => s.strong
            ? <strong key={i} className="em-text font-[600]">{s.text}</strong>
            : <span key={i}>{s.text}</span>)}
        </p>
        {busiest ? (
          <p className="text-[13.5px] text-muted-foreground">
            {m["website.summary.detail"]
              .replace("{visitors}", fmt(view.totals.visitors))
              .replace("{pageviews}", fmt(view.totals.pageviews))
              .replace("{day}", formatDateUTC(busiest.day))}
          </p>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile hero label={m["website.tile.visitors"]} value={fmt(view.totals.visitors)} delta={view.visitorsDelta} spark={view.days.map((d) => d.visitors)} />
        <StatTile label={m["website.tile.pageviews"]} value={fmt(view.totals.pageviews)} delta={view.pageviewsDelta} spark={view.days.map((d) => d.pageviews)} />
        <StatTile
          label={m["website.tile.fromGoogle"]} value={pct(view.fromGoogle.share)}
          delta={{ direction: googlePts > 0 ? "up" : googlePts < 0 ? "down" : "flat", label: `${Math.abs(googlePts)} pts` }}
          period={m[`website.periodLabel.${view.period}`]}
        />
        <StatTile
          label={m["website.tile.topPage"]}
          value={view.topPage?.name ?? "—"}
          period={view.topPage
            ? m["website.tile.topPageDetail"].replace("{visitors}", fmt(view.topPage.visitors)).replace("{share}", pct(view.topPage.share))
            : m["website.tile.noTopPage"]}
        />
      </div>

      <section className="rounded-xl border border-border bg-card glass px-5 pt-4 pb-3.5" aria-label={m["website.chart.title"]}>
        <p className="text-[13.5px] font-semibold text-card-foreground">{m["website.chart.title"]}</p>
        <DailyChart
          days={view.days}
          secondSeries={{ label: m["website.chart.series.pageviewsThird"], values: view.days.map((d) => Math.round(d.pageviews / 3)) }}
        />
        {showPlaces ? <DeviceStrip devices={view.devices} /> : null}
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownPanel title={m["website.panel.pages"]} rows={view.pages} />
        <BreakdownPanel title={m["website.panel.sources"]} rows={view.sources} />
        {showPlaces
          ? <BreakdownPanel title={m["website.panel.places"]} rows={view.places} asShare />
          : <BreakdownPanel title={m["website.panel.devices"]} rows={view.devices} asShare />}
      </div>
    </div>
  );
}
