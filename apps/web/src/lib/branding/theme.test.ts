import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { contrastRatio } from "./color";
import { NEUTRAL_RAMPS, type NeutralName } from "./neutral-ramps";
import { deriveTheme, BIS, type CornerName, type TypeName } from "./theme";

const NEUTRALS: NeutralName[] = ["warm", "cool", "slate"];
const CORNERS: CornerName[] = ["sharp", "soft", "round"];
const TYPES: TypeName[] = ["geist", "inter", "serif"];
const MODES = ["light", "dark"] as const;

// Black and white are the interesting ones: an achromatic input can only move
// along lightness, and white has to DARKEN on a light background while black
// has to lighten. A one-directional walk passes the rest and fails these two.
//
// #8b5cf6 and #068d1a are the dead luminance band (~0.183-0.200 relative
// luminance): each clears 3:1 against a white card on its own, so a
// derivation that only lifted for visibility (the pre-fix `ensureContrast`
// path) would pass them straight through — and then fail on-primary here,
// since neither white (4.46:1 / measured similarly for the green) nor
// #111111 reaches 4.5:1 on either one. #8b5cf6 is the exact hex this bug was
// found through (also globals.css's OLD, since-fixed, hardcoded dark
// --primary — see BIS.dark's comment in theme.ts).
const ADVERSARIAL = [
  null, "#000000", "#ffffff", "#fde047", "#808080", "#1e3a8a", "#6d28d9",
  "#8b5cf6", "#068d1a",
];

describe("deriveTheme", () => {
  it("returns null when nothing is set, so today's rendering is untouched", () => {
    expect(deriveTheme(
      { color: null, neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  // PR #10 shipped brand_color as accents-only. An agency that set just a
  // colour must not find its clients' chrome repainted by a deploy.
  it("returns null for a colour with no other input", () => {
    expect(deriveTheme(
      { color: "#1e3a8a", neutral: null, corners: null, type: null, mode: null }, "light",
    )).toBeNull();
  });

  it("engages as soon as one of the four new inputs is set", () => {
    const t = deriveTheme(
      { color: null, neutral: "warm", corners: null, type: null, mode: null }, "light",
    );
    expect(t?.background).toBe(NEUTRAL_RAMPS.warm.light.bg);
  });

  // The gate above was only ever exercised through `neutral`. Each of the
  // other three flags has to engage the theme on its own too, or a tenant
  // that sets only corners/type/mode would silently see no changes at all.
  it("engages via corners alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: "sharp", type: null, mode: null }, "light",
    );
    expect(t).not.toBeNull();
    expect(t?.radius).toBe("0.125rem");
  });

  it("engages via type alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: null, type: "inter", mode: null }, "light",
    );
    expect(t).not.toBeNull();
    expect(t?.fontSans).toBe("var(--font-inter)");
  });

  it("engages via mode alone", () => {
    const t = deriveTheme(
      { color: null, neutral: null, corners: null, type: null, mode: "dark" }, "light",
    );
    expect(t).not.toBeNull();
    // mode's only job here is to open the gate — neutral/corners/type still
    // fall back to their defaults since none of them was set.
    expect(t?.background).toBe(NEUTRAL_RAMPS.slate.light.bg);
  });

  it("keeps the sidebar dark in light mode", () => {
    const light = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "light",
    );
    const dark = deriveTheme(
      { color: null, neutral: "slate", corners: null, type: null, mode: null }, "dark",
    );
    expect(light?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
    expect(dark?.sidebar).toBe(NEUTRAL_RAMPS.slate.sidebar);
  });

  it("maps corners to concrete lengths", () => {
    const of = (corners: CornerName) => deriveTheme(
      { color: null, neutral: "slate", corners, type: null, mode: null }, "light",
    )?.radius;
    expect(of("sharp")).toBe("0.125rem");
    expect(of("soft")).toBe("0.625rem");
    expect(of("round")).toBe("1rem");
  });

  it("maps type to a font variable from a closed set", () => {
    const of = (type: TypeName) => deriveTheme(
      { color: null, neutral: "slate", corners: null, type, mode: null }, "light",
    )?.fontSans;
    expect(of("geist")).toBe("var(--font-geist-sans)");
    expect(of("inter")).toBe("var(--font-inter)");
    expect(of("serif")).toBe("var(--font-source-serif)");
  });

  it("ignores a colour that is not a real hex", () => {
    const t = deriveTheme(
      { color: "red; position:fixed", neutral: "slate", corners: null, type: null, mode: null },
      "light",
    );
    expect(t?.primary).toBe("#7c3aed"); // the BIS light default, not the input
  });

  // The whole point of the milestone: no combination of stored inputs can
  // produce an illegible screen.
  it("clears every contrast threshold for every combination", () => {
    for (const neutral of NEUTRALS)
      for (const corners of CORNERS)
        for (const type of TYPES)
          for (const mode of MODES)
            for (const color of ADVERSARIAL) {
              const t = deriveTheme({ color, neutral, corners, type, mode: null }, mode)!;
              const where = `${neutral}/${corners}/${type}/${mode}/${color}`;

              // text
              expect(contrastRatio(t.foreground, t.background), `fg on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.cardForeground, t.card), `card fg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.background), `muted on bg ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.mutedForeground, t.card), `muted on card ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.secondaryForeground, t.secondary), `secondary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.primaryForeground, t.primary), `on primary ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.accentForeground, t.accent), `on accent ${where}`).toBeGreaterThanOrEqual(4.5);
              expect(contrastRatio(t.sidebarForeground, t.sidebar), `sidebar text ${where}`).toBeGreaterThanOrEqual(4.5);

              // non-text UI
              expect(contrastRatio(t.primary, t.card), `primary on card ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.ring, t.background), `ring on bg ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.ring, t.card), `ring on card ${where}`).toBeGreaterThanOrEqual(3);
              expect(contrastRatio(t.sidebarAccent, t.sidebar), `sidebar accent ${where}`).toBeGreaterThanOrEqual(3);

              // hierarchy: muted text must stay quieter than primary text
              expect(contrastRatio(t.mutedForeground, t.background), `muted quieter ${where}`)
                .toBeLessThan(contrastRatio(t.foreground, t.background));
            }
  });
});

// BIS.dark.primary and globals.css's `.dark { --primary: ... }` must stay
// equal (same for ring) — theme.ts's own comment says so, but a comment
// enforces nothing. This reads the live CSS file and checks it against the
// constants actually used at derivation time, so the two cannot drift apart
// again without a red test.
describe("globals.css / BIS.dark parity", () => {
  const cssPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/(dashboard)/globals.css",
  );
  const css = readFileSync(cssPath, "utf8");
  const darkBlock = css.match(/\.dark\s*\{([^}]*)\}/)?.[1];

  it("finds the .dark block", () => {
    expect(darkBlock).toBeTruthy();
  });

  it("keeps --primary equal to BIS.dark.primary", () => {
    const value = darkBlock?.match(/--primary:\s*(#[0-9a-fA-F]{6});/)?.[1];
    expect(value?.toLowerCase()).toBe(BIS.dark.primary);
  });

  it("keeps --ring equal to BIS.dark.ring", () => {
    const value = darkBlock?.match(/--ring:\s*(#[0-9a-fA-F]{6});/)?.[1];
    expect(value?.toLowerCase()).toBe(BIS.dark.ring);
  });
});
