import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");
const tiles = page.match(/<StatTile\b[\s\S]*?\/>/g) ?? [];

/**
 * The `hero` PROP, not the word "hero" anywhere inside the tag. The pin used
 * to be `/\bhero\b/` over the whole `<StatTile … />`, which a
 * `valueTestId="hero-calls"`, a prose comment, or any future prop whose name
 * merely contains it would all satisfy — so a tile could carry the marker's
 * NAME without the marker and still pass.
 *
 * Comments come out first: "hero" in a comment sits between two spaces, which
 * is prop position by every other measure. Then require prop position — start
 * or whitespace before; whitespace, `/>` or `={` after (never `="`, which
 * would be a string-valued prop of some other name).
 */
const hasHeroProp = (tag: string) =>
  /(?:^|\s)hero(?=\s|\/>|=\{|$)/.test(
    tag.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " "),
  );

describe("Dashboard hero (spec §5): calls answered this week, and only it", () => {
  it("renders several tiles (positive control)", () => {
    expect(tiles.length).toBeGreaterThanOrEqual(6);
  });
  it("exactly one tile carries hero, and it is the calls-answered tile", () => {
    const heroes = tiles.filter(hasHeroProp);
    expect(heroes.length).toBe(1);
    expect(heroes[0]).toContain('m["dashboard.kpi.callsAnswered"]');
  });

  it("the word alone does not satisfy it — only the prop does (negative control)", () => {
    // The old pin was /\bhero\b/ anywhere in the tag, which every one of
    // these first three satisfies. Written first and watched fail twice: the
    // string-valued prop fell to the prop-position rule, and the comment
    // cases needed the strip — a comment's "hero" sits between two spaces,
    // which is prop position by every other measure.
    expect(hasHeroProp('<StatTile valueTestId="hero-calls" />')).toBe(false);
    expect(hasHeroProp("<StatTile /* the hero one */ />")).toBe(false);
    expect(hasHeroProp("<StatTile\n  // the hero tile\n/>")).toBe(false);
    expect(hasHeroProp("<StatTile\n  hero\n/>")).toBe(true);
    expect(hasHeroProp("<StatTile hero={true} />")).toBe(true);
  });
});
