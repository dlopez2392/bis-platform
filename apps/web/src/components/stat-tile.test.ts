// apps/web/src/components/stat-tile.test.ts
//
// The repo has no .tsx component-render test convention yet (no harness),
// so this covers only the extracted pure predicate behind StatTile's
// dev-mode rule-1 throw — hasStatContext itself, not the throw or the
// render. The throw path is screenshot-verified at Task 8 per the brief.
import { describe, expect, it } from "vitest";
import { hasStatContext } from "./stat-tile";

describe("hasStatContext", () => {
  it("is false with none of delta/spark/period", () => {
    expect(hasStatContext({})).toBe(false);
  });

  it("is true with only delta", () => {
    expect(hasStatContext({ delta: { direction: "up", label: "12%" } })).toBe(true);
  });

  it("is true with only a non-empty spark", () => {
    expect(hasStatContext({ spark: [1, 2, 3] })).toBe(true);
  });

  it("is false with an empty spark array — no visible trend line is no context", () => {
    expect(hasStatContext({ spark: [] })).toBe(false);
  });

  it("is true with only a period", () => {
    expect(hasStatContext({ period: "All time" })).toBe(true);
  });

  it("is false with an empty-string period", () => {
    expect(hasStatContext({ period: "" })).toBe(false);
  });

  it("is true with all three present", () => {
    expect(
      hasStatContext({ delta: { direction: "flat", label: "0%" }, spark: [1, 2], period: "All time" }),
    ).toBe(true);
  });
});
