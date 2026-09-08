import { describe, expect, it } from "vitest";
import { deriveAccent2, deriveAccentStrong, hexToOklch, oklchToHex } from "./oklch";

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

  // The gamut fit exists to keep L and H exactly rather than let a per-channel
  // clamp move the hue, and it must not pay for that with chroma it does not
  // have to give up. Both halves are pinned: a target sRGB already contains
  // keeps all of its chroma, and one it does not keeps its lightness.
  it("gives up no chroma when the target is already in gamut, and holds L when it is not", () => {
    const teal = hexToOklch("#14b8a6");
    const fitted = hexToOklch(deriveAccent2("#14b8a6"));
    expect(Math.abs(fitted.c - teal.c * 0.9)).toBeLessThanOrEqual(0.003);

    // #8b7cf7 lifted by .18 wants more chroma than blue has up there, so the
    // fit bites — and what it must not do is pay for that in LIGHTNESS, which
    // is what the per-channel clamp did (L .8154 against a .8376 target,
    // 0.022 out; the fit lands 0.001 out). Measured against the target rather
    // than the literal .85: #8b7cf7 sits at L .6576, so +0.18 is .8376 and
    // the .85 clamp never binds for it.
    const src = hexToOklch("#8b7cf7");
    const target = Math.min(0.85, src.l + 0.18);
    const violet = hexToOklch(deriveAccent2("#8b7cf7"));
    expect(Math.abs(violet.l - target)).toBeLessThanOrEqual(0.01);
    expect(violet.c).toBeGreaterThan(0);
    expect(violet.c).toBeLessThan(src.c * 0.9); // the fit really did bite
  });
});

// tokens.css keeps --accent and --accent-strong distinct per mode, and
// --gradient-primary is linear-gradient(180deg, var(--accent),
// var(--accent-strong)) — so aliasing the two renders the primary button
// FLAT. This mirrors the BIS pairs: light #6d28d9 → #5b21b8 (L −0.057,
// C ×0.88), dark #8b7cf7 → #a99eff (L +0.090, C ×0.78), hue held in both.
describe("deriveAccentStrong — darker in light, lighter in dark, hue held", () => {
  const STRONG_CASES: [string, string, "light" | "dark"][] = [
    ["violet", "#8b7cf7", "light"], ["violet", "#8b7cf7", "dark"],
    ["orange", "#f97316", "light"], ["orange", "#f97316", "dark"],
    ["teal", "#14b8a6", "light"], ["teal", "#14b8a6", "dark"],
    ["red", "#dc2626", "light"], ["red", "#dc2626", "dark"],
  ];

  it.each(STRONG_CASES)(
    "%s %s in %s mode: L moves the pinned amount, hue holds, chroma never grows",
    (_name, hex, mode) => {
      const src = hexToOklch(hex);
      const strong = deriveAccentStrong(hex, mode);
      const out = hexToOklch(strong);
      // ±0.015: the gamut fit can cost a little, and an 8-bit round trip more.
      expect(Math.abs(out.l - (src.l + (mode === "light" ? -0.06 : 0.09))))
        .toBeLessThanOrEqual(0.015);
      expect(hueDelta(out.h, src.h)).toBeLessThanOrEqual(2);
      expect(out.c).toBeLessThanOrEqual(src.c);
      expect(strong).toMatch(/^#[0-9a-f]{6}$/);
    });

  it("clamps lightness at 1 for a near-white input in dark mode", () => {
    const out = deriveAccentStrong("#fdfcff", "dark");
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToOklch(out).l).toBeLessThanOrEqual(1);
  });
});
