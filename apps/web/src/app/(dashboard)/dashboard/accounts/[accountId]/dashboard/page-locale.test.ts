import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8",
);

describe("dashboard KPI row resolves through the locale helper", () => {
  it("resolves locale through requestLocale with the account/isOperator shape, calls formatCurrency with a locale argument, and routes the KPI labels through t() (mutation: call formatCurrency(currentPipelineValue) with no second arg → FAILS)", () => {
    expect(src).toMatch(/requestLocale\(\{ account, isOperator: isAgency, userLanguage: prefs\.language \}/);
    expect(src).toMatch(/formatCurrency\(currentPipelineValue, locale\)/);
    expect(src).toMatch(/t\(m, "dashboard\.kpi\.last7Days", locale\)/);
  });
});

// Decision D (orchestrator, 2026-10-10): `lang` on each converted part of
// the page, never on the page wrapper as a whole — the parts still owned by
// other lanes (work row, pipeline's own `pipeline.add` link, and the
// agency-only checklist review link) stay English. S-10 T2 extends the
// converted set by one: the greeting header's own wrapper (page.tsx's own
// `<div lang={locale}><PageHeader .../></div>`, counted separately below).
describe("the KPI row carries lang={locale}; the rest of the page does not (decision D)", () => {
  it("the caption and both tile grids carry lang={locale} (mutation: drop it from any one → FAILS)", () => {
    expect(src).toContain('<p lang={locale} className={LABEL_ROLE}>{p(t(m, "dashboard.kpi.last7Days", locale))}</p>');
    expect(src).toContain('<div lang={locale} className={cn("grid gap-4 sm:grid-cols-2", hasAfterHours');
    expect(src).toContain('<div lang={locale} className="grid gap-4 sm:grid-cols-3">');
    // 3 on the KPI row (this block) + 1 on the greeting header's wrapper
    // (S-10 T2, tested separately below) = 4 literal occurrences total.
    expect(src.match(/lang=\{locale\}/g)?.length).toBe(4);
  });

  // I7: the tiles' worded delta (the screen-reader sentence beside ▲/▼) is
  // catalogue copy too, so every tile in the converted row gets the locale.
  it("every StatTile on the page is handed locale={locale} (mutation: drop it from any tile → FAILS)", () => {
    const tiles = src.split("<StatTile").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
    expect(tiles.length).toBe(7);
    for (const tile of tiles) expect(tile).toContain("locale={locale}");
  });
});

// S-10 T2 (spec §3.1 row 2): the greeting header, the calls chart card and
// the activity card were still read through `m[...]` directly, or (the
// calls/activity cards) took no locale prop at all.
describe("the greeting header and the calls/activity cards resolve through the locale (S-10 T2)", () => {
  it("the greeting and voice sub-line route through t()/formatLocalLongDate with the resolved locale, not a raw m[...] read (mutation: read dashboard.sub.voice as m[...] again → FAILS)", () => {
    expect(src).toMatch(/t\(m, `dashboard\.greeting\.\$\{periodKey\}(NoName)?` as const, locale, \{ ?name: ?greetingName ?\}\)/);
    expect(src).toMatch(/t\(m, "dashboard\.sub\.voice", locale, \{ ?name:/);
    expect(src).toMatch(/formatLocalLongDate\(now, timezone, locale\)/);
    expect(src).not.toMatch(/m\[`dashboard\.greeting/);
    expect(src).not.toContain('m["dashboard.sub.voice"]');
  });

  it("the PageHeader (greeting title + date/voice subtitle) is wrapped in lang={locale} (mutation: drop the wrapper → FAILS)", () => {
    expect(src).toMatch(/<div lang=\{locale\}>\s*<PageHeader/);
  });

  it("CallsChartCard and ActivityCard are both handed locale={locale} and pseudo={pseudo} (mutation: drop either from one card → FAILS)", () => {
    const calls = src.slice(src.indexOf("<CallsChartCard"), src.indexOf("<ActivityCard"));
    const activity = src.slice(src.indexOf("<ActivityCard"));
    for (const chunk of [calls, activity]) {
      expect(chunk).toContain("locale={locale}");
      expect(chunk).toContain("pseudo={pseudo}");
    }
  });
});
