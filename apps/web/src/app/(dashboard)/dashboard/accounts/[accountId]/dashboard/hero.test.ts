import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const tiles = page.match(/<StatTile\b[\s\S]*?\/>/g) ?? [];

describe("Dashboard hero (spec §5): calls answered this week, and only it", () => {
  it("renders several tiles (positive control)", () => {
    expect(tiles.length).toBeGreaterThanOrEqual(6);
  });
  it("exactly one tile carries hero, and it is the calls-answered tile", () => {
    const heroes = tiles.filter((t) => /\bhero\b/.test(t));
    expect(heroes.length).toBe(1);
    expect(heroes[0]).toContain('m["dashboard.kpi.callsAnswered"]');
  });
});
