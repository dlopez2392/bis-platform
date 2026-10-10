import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8",
);

describe("dashboard KPI row resolves through the locale helper", () => {
  it("resolves locale through requestLocale with the account/isOperator shape, calls formatCurrency with a locale argument, and routes the KPI labels through t() (mutation: call formatCurrency(currentPipelineValue) with no second arg → FAILS)", () => {
    expect(src).toMatch(/requestLocale\(\{ account, isOperator: isAgency \}/);
    expect(src).toMatch(/formatCurrency\(currentPipelineValue, locale\)/);
    expect(src).toMatch(/t\(m, "dashboard\.kpi\.last7Days", locale\)/);
  });
});

// Decision D (orchestrator, 2026-10-10): `lang` on the converted KPI row
// only — the caption and the two tile grids — never on the page wrapper,
// whose other cards (work row, charts, activity) are still English.
describe("the KPI row carries lang={locale}; the rest of the page does not (decision D)", () => {
  it("the caption and both tile grids carry lang={locale} (mutation: drop it from any one → FAILS)", () => {
    expect(src).toContain('<p lang={locale} className={LABEL_ROLE}>{p(t(m, "dashboard.kpi.last7Days", locale))}</p>');
    expect(src).toContain('<div lang={locale} className={cn("grid gap-4 sm:grid-cols-2", hasAfterHours');
    expect(src).toContain('<div lang={locale} className="grid gap-4 sm:grid-cols-3">');
    expect(src.match(/lang=\{locale\}/g)?.length).toBe(3);
  });

  // I7: the tiles' worded delta (the screen-reader sentence beside ▲/▼) is
  // catalogue copy too, so every tile in the converted row gets the locale.
  it("every StatTile on the page is handed locale={locale} (mutation: drop it from any tile → FAILS)", () => {
    const tiles = src.split("<StatTile").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("/>")));
    expect(tiles.length).toBe(7);
    for (const tile of tiles) expect(tile).toContain("locale={locale}");
  });
});
