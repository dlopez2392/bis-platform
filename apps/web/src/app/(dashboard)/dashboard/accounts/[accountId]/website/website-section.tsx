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
  return (
    <div className="space-y-3 p-6">
      <div className="flex items-center justify-between">
        <p className={LABEL}>{m[`website.periodLabel.${view.period}`]}</p>
        {view.stale && view.lastSyncedDay ? (
          <p className="text-xs text-muted-foreground" role="status">{m["website.stale"].replace("{date}", formatDateUTC(view.lastSyncedDay))}</p>
        ) : (
          <p className={LABEL}>{view.lastSyncedDay ? m["website.updatedOn"].replace("{date}", formatDateUTC(view.lastSyncedDay)) : m["website.updated"]}</p>
        )}
      </div>

      <section className="rounded-lg border border-border bg-card p-5" aria-label="Summary">
        <p className="max-w-[62ch] text-[17px] leading-[1.5] text-card-foreground">
          {view.sentence.map((s, i) => s.strong
            ? <strong key={i} className="font-semibold text-primary">{s.text}</strong>
            : <span key={i}>{s.text}</span>)}
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label={m["website.tile.visitors"]} value={fmt(view.totals.visitors)} delta={view.visitorsDelta} spark={view.days.map((d) => d.visitors)} />
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

      <section className="rounded-lg border border-border bg-card p-5" aria-label={m["website.chart.title"]}>
        <p className={LABEL}>{m["website.chart.title"]}</p>
        <DailyChart days={view.days} />
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
