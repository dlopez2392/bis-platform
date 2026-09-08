import type { TrafficDay, TrafficBreakdownRow } from "@bis/db";
import type { StatTileDelta } from "@/components/stat-tile";
import { deltaVsPrior } from "@/lib/dashboard/metrics";
import { dayKeyInZone } from "@/lib/booking/availability";
import { channelOf } from "./channel";
import { websiteSentence, type SentenceSegment } from "./sentence";

export type Period = 7 | 14 | 30;
export type Ranked = { name: string; visitors: number; share: number };
export type WebsiteView = {
  period: Period; fromDay: string; toDay: string;
  days: { day: string; visitors: number; pageviews: number; isWeekend: boolean }[];
  totals: { visitors: number; pageviews: number };
  prior: { visitors: number; pageviews: number };
  visitorsDelta: StatTileDelta; pageviewsDelta: StatTileDelta;
  fromGoogle: { share: number; priorShare: number };
  topPage: Ranked | null;
  pages: Ranked[]; sources: Ranked[]; places: Ranked[]; devices: Ranked[];
  sentence: SentenceSegment[];
  lastSyncedDay: string | null; stale: boolean;
};

export const STALE_AFTER_DAYS = 2;
const PANEL_ROWS = 5;

export function parsePeriod(raw: string | undefined): Period {
  return raw === "7" ? 7 : raw === "30" ? 30 : 14;
}

function shift(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isWeekend(dayKey: string): boolean {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return wd === 0 || wd === 6;
}
function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number); const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000);
}

/** Both windows end at LOCAL yesterday — the last complete day the pass can
 *  have stored — and the prior window is the same length immediately before. */
export function windowDayKeys(now: Date, timezone: string, period: Period): { current: string[]; prior: string[] } {
  const yesterday = shift(dayKeyInZone(now, timezone), -1);
  const current = Array.from({ length: period }, (_, i) => shift(yesterday, -(period - 1 - i)));
  const prior = Array.from({ length: period }, (_, i) => shift(current[0]!, -(period - i)));
  return { current, prior };
}

export function pageTitle(path: string): string {
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return "Home";
  const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function rank(rows: TrafficBreakdownRow[], name: (value: string) => string, total: number): Ranked[] {
  const sum = new Map<string, number>();
  for (const r of rows) sum.set(name(r.value), (sum.get(name(r.value)) ?? 0) + r.visitors);
  return [...sum.entries()]
    .map(([n, visitors]) => ({ name: n, visitors, share: total > 0 ? visitors / total : 0 }))
    .sort((a, b) => b.visitors - a.visitors);
}

export function buildWebsiteView(input: {
  now: Date; timezone: string; period: Period;
  daily: TrafficDay[]; breakdown: TrafficBreakdownRow[]; lastSyncedDay: string | null;
}): WebsiteView {
  const { current, prior } = windowDayKeys(input.now, input.timezone, input.period);
  const byDay = new Map(input.daily.map((d) => [d.day, d]));
  const days = current.map((day) => {
    const d = byDay.get(day);
    return { day, visitors: d?.visitors ?? 0, pageviews: d?.pageviews ?? 0, isWeekend: isWeekend(day) };
  });
  const sumOver = (keys: string[]) => keys.reduce((acc, k) => {
    const d = byDay.get(k); return { visitors: acc.visitors + (d?.visitors ?? 0), pageviews: acc.pageviews + (d?.pageviews ?? 0) };
  }, { visitors: 0, pageviews: 0 });
  const totals = sumOver(current);
  const priorTotals = sumOver(prior);

  const inCurrent = new Set(current); const inPrior = new Set(prior);
  const cur = input.breakdown.filter((r) => inCurrent.has(r.day));
  const pri = input.breakdown.filter((r) => inPrior.has(r.day));
  const dim = (rows: TrafficBreakdownRow[], d: TrafficBreakdownRow["dimension"]) => rows.filter((r) => r.dimension === d);

  const pages = rank(dim(cur, "page"), pageTitle, totals.visitors);
  const sources = rank(dim(cur, "source"), channelOf, totals.visitors);
  const places = rank(dim(cur, "place"), (v) => v, totals.visitors);
  const devices = rank(dim(cur, "device"), (v) => v, totals.visitors);
  const priorSources = rank(dim(pri, "source"), channelOf, priorTotals.visitors);
  const google = (list: Ranked[]) => list.find((s) => s.name === "Google")?.share ?? 0;

  const topPage = pages[0] ?? null;
  const sentence = websiteSentence({
    period: input.period, visitors: totals.visitors, priorVisitors: priorTotals.visitors,
    topSource: sources[0] ?? null, runnerUpSourceShare: sources[1]?.share ?? 0,
    topPage, runnerUpPageShare: pages[1]?.share ?? 0,
    topDevice: devices[0] ?? null,
  });

  const today = dayKeyInZone(input.now, input.timezone);
  const stale = input.lastSyncedDay === null || daysBetween(input.lastSyncedDay, today) > STALE_AFTER_DAYS;

  return {
    period: input.period, fromDay: current[0]!, toDay: current[current.length - 1]!, days,
    totals, prior: priorTotals,
    visitorsDelta: deltaVsPrior(totals.visitors, priorTotals.visitors),
    pageviewsDelta: deltaVsPrior(totals.pageviews, priorTotals.pageviews),
    fromGoogle: { share: google(sources), priorShare: google(priorSources) },
    topPage, pages: pages.slice(0, PANEL_ROWS), sources: sources.slice(0, PANEL_ROWS),
    places: places.slice(0, PANEL_ROWS), devices: devices.slice(0, PANEL_ROWS),
    sentence, lastSyncedDay: input.lastSyncedDay, stale,
  };
}
