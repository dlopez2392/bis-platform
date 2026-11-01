import { StatTile } from "@/components/stat-tile";
import { formatDateUTC, tag } from "@/lib/format";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import { PLACE_DIMENSION } from "@/lib/vercel/web-analytics";
import type { WebsiteView } from "@/lib/website/view-model";
import { DailyChart } from "./daily-chart";
import { BreakdownPanel } from "./breakdown-panel";
import { DeviceStrip } from "./device-strip";

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const pct = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The locked layout (docs/design/website-section.html): the sentence panel,
 * four tiles, the daily chart, three panels. `formatDateUTC` for day keys —
 * a `YYYY-MM-DD` is a calendar date, and `new Date(key)` would render the
 * previous day in the Americas (the recorded bug class).
 */
export function WebsiteSection({
  view, locale = "en", pseudo = false,
}: {
  view: WebsiteView;
  /** S-10 T2: the reader's own locale — every existing call site omits this
   *  and keeps rendering English, same as `StatTile`'s own default. */
  locale?: Locale;
  pseudo?: boolean;
}) {
  const tr = makeTr(locale, pseudo);
  const fmt = (n: number) => n.toLocaleString(tag(locale));
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
    <div lang={locale} className="space-y-3 p-6">
      {/* The mockup's .card.sentence carries its own .lbl row (period on the
          left, the update stamp pushed right) INSIDE the card, then the
          sentence, then a 13.5px supporting line. */}
      <section className="rounded-xl border border-border bg-card glass px-[22px] py-[18px]" aria-label={tr.text("website.summaryLabel")}>
        <div className="mb-2 flex items-center justify-between gap-2.5">
          <p className={LABEL}>{tr.text(`website.periodLabel.${view.period}` as const)}</p>
          {view.stale && view.lastSyncedDay ? (
            <p className="text-xs text-muted-foreground" role="status">{tr.text("website.stale", { date: formatDateUTC(view.lastSyncedDay, locale) })}</p>
          ) : (
            <p className="font-mono text-[10px] font-medium tracking-[0.06em] text-muted-foreground">{view.lastSyncedDay ? tr.text("website.updatedOn", { date: formatDateUTC(view.lastSyncedDay, locale) }) : tr.text("website.updated")}</p>
          )}
        </div>
        {/* 24px (mockup --sentence-size): gradient text is legal only at display size (spec §3.4).
            `view.sentence` is itself already built in `locale` (view-model.ts's
            `buildWebsiteView` thread it through to `websiteSentence`) — it is
            generated prose, not a catalogue read, so there is nothing to
            convert here beyond rendering the segments it hands back. */}
        <p className="mb-1.5 max-w-[62ch] font-display text-[24px] font-[600] leading-[1.15] tracking-[-0.02em] text-card-foreground">
          {view.sentence.map((s, i) => s.strong
            ? <strong key={i} className="em-text font-[600]">{s.text}</strong>
            : <span key={i}>{s.text}</span>)}
        </p>
        {busiest ? (
          <p className="text-[13.5px] text-muted-foreground">
            {tr.text("website.summary.detail", {
              visitors: fmt(view.totals.visitors), pageviews: fmt(view.totals.pageviews), day: formatDateUTC(busiest.day, locale),
            })}
          </p>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile hero label={tr.text("website.tile.visitors")} value={fmt(view.totals.visitors)} delta={view.visitorsDelta} spark={view.days.map((d) => d.visitors)} locale={locale} />
        <StatTile label={tr.text("website.tile.pageviews")} value={fmt(view.totals.pageviews)} delta={view.pageviewsDelta} spark={view.days.map((d) => d.pageviews)} locale={locale} />
        <StatTile
          label={tr.text("website.tile.fromGoogle")} value={pct(view.fromGoogle.share)}
          delta={{ direction: googlePts > 0 ? "up" : googlePts < 0 ? "down" : "flat", label: `${Math.abs(googlePts)} pts` }}
          period={tr.text(`website.periodLabel.${view.period}` as const)}
          locale={locale}
        />
        <StatTile
          label={tr.text("website.tile.topPage")}
          value={view.topPage?.name ?? "—"}
          period={view.topPage
            ? tr.text("website.tile.topPageDetail", { visitors: fmt(view.topPage.visitors), share: pct(view.topPage.share) })
            : tr.text("website.tile.noTopPage")}
          locale={locale}
        />
      </div>

      <section className="rounded-xl border border-border bg-card glass px-5 pt-4 pb-3.5" aria-label={tr.text("website.chart.title")}>
        <p className="text-[13.5px] font-semibold text-card-foreground">{tr.text("website.chart.title")}</p>
        <DailyChart
          days={view.days}
          primaryLabel={tr.text("website.tile.visitors")}
          secondSeries={{ label: tr.text("website.chart.series.pageviewsThird"), values: view.days.map((d) => Math.round(d.pageviews / 3)) }}
          locale={locale}
          pseudo={pseudo}
        />
        {showPlaces ? <DeviceStrip devices={view.devices} locale={locale} /> : null}
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownPanel title={tr.text("website.panel.pages")} rows={view.pages} locale={locale} />
        <BreakdownPanel title={tr.text("website.panel.sources")} rows={view.sources} locale={locale} />
        {showPlaces
          ? <BreakdownPanel title={tr.text("website.panel.places")} rows={view.places} asShare locale={locale} />
          : <BreakdownPanel title={tr.text("website.panel.devices")} rows={view.devices} asShare locale={locale} />}
      </div>
    </div>
  );
}
