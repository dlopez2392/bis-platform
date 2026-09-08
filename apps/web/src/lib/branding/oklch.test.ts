import { describe, expect, it } from "vitest";
import { deriveAccent2, hexToOklch, oklchToHex } from "./oklch";

const wrap = (h: number) => ((h % 360) + 360) % 360;
const hueDelta = (a: number, b: number) => { const d = Math.abs(wrap(a) - wrap(b)); return Math.min(d, 360 - d); };

describe("oklch", () => {
  it.each(["#8b7cf7", "#6d28d9", "#f97316", "#14b8a6", "#dc2626", "#808080", "#000000", "#ffffff"])(
    "round-trips %s within one 8-bit step per channel", (hex) => {
      const back = oklchToHex(hexToOklch(hex));
      for (let i = 1; i < 7; i += 2) {
        expect(Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(hex.slice(i, i + 2), 16))).toBeLessThanOrEqual(1);
      }
    });

  it("puts white at L≈1 and black at L≈0 with ~zero chroma", () => {
    expect(hexToOklch("#ffffff").l).toBeCloseTo(1, 2);
    expect(hexToOklch("#000000").l).toBeCloseTo(0, 2);
    expect(hexToOklch("#808080").c).toBeLessThan(0.01);
  });

  it("clamps out-of-gamut results into #rrggbb", () => {
    expect(oklchToHex({ l: 0.95, c: 0.4, h: 30 })).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("deriveAccent2 — L +0.18 (clamp .85), C ×0.9, H −30° (spec §3.3)", () => {
  // The RULE is asserted, not the spec's family names: −30° from violet is
  // blue (~255°), not cyan — recorded in the plan's findings.
  it.each([
    ["violet", "#8b7cf7"], ["orange", "#f97316"], ["teal", "#14b8a6"], ["red", "#dc2626"],
  ])("%s: hue rotates −30° (±6°), chroma shrinks, lightness rises", (_name, hex) => {
    const src = hexToOklch(hex);
    const out = hexToOklch(deriveAccent2(hex));
    expect(hueDelta(out.h, src.h - 30)).toBeLessThanOrEqual(6);
    expect(out.c).toBeLessThan(src.c);
    expect(out.l).toBeGreaterThan(src.l);
    expect(out.l).toBeLessThanOrEqual(0.86);
  });

  it("gray → a slightly lighter gray (chroma stays ~0)", () => {
    const out = hexToOklch(deriveAccent2("#808080"));
    expect(out.c).toBeLessThan(0.01);
    expect(out.l).toBeCloseTo(hexToOklch("#808080").l + 0.18, 1);
  });

  it("clamps lightness at .85 for an already-light input", () => {
    expect(hexToOklch(deriveAccent2("#e9d5ff")).l).toBeLessThanOrEqual(0.86);
  });

  it("returns lower-case #rrggbb", () => {
    expect(deriveAccent2("#8B7CF7")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
