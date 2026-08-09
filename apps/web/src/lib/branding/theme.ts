/**
 * Turns the five stored inputs into a full token set.
 *
 * Pure and I/O-free, the same contract color.ts holds and for the same
 * reason: a hook body cannot be tested in this repo, so every decision that
 * matters lives in a function that can be. The combinatorial sweep in
 * theme.test.ts is what makes "an unreadable screen is impossible" a fact
 * rather than an intention.
 */
import { contrastRatio, ensureContrast, parseHexColor, readableTextOn } from "./color";
import { NEUTRAL_RAMPS, SIDEBAR_FOREGROUND, type NeutralName } from "./neutral-ramps";

export type { NeutralName };
export type CornerName = "sharp" | "soft" | "round";
export type TypeName = "geist" | "inter" | "serif";
export type ModeName = "light" | "dark" | "follow";

export type ThemeInputs = {
  color: string | null;
  neutral: NeutralName | null;
  corners: CornerName | null;
  type: TypeName | null;
  mode: ModeName | null;
};

export type ResolvedTheme = {
  background: string; foreground: string;
  card: string; cardForeground: string;
  popover: string; popoverForeground: string;
  primary: string; primaryForeground: string;
  secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string;
  accent: string; accentForeground: string;
  border: string; input: string; ring: string;
  sidebar: string; sidebarForeground: string;
  sidebarAccent: string; sidebarBorder: string;
  radius: string;
  fontSans: string;
};

const RADIUS: Record<CornerName, string> = {
  sharp: "0.125rem", soft: "0.625rem", round: "1rem",
};

/** A closed set, so this never carries user text into a CSS value. */
const FONT: Record<TypeName, string> = {
  geist: "var(--font-geist-sans)",
  inter: "var(--font-inter)",
  serif: "var(--font-source-serif)",
};

/**
 * What globals.css uses today, per mode. Every fallback lands here.
 *
 * dark.primary is NOT globals.css's literal #8b5cf6 (its .dark --primary).
 * That hex is only readable at 4.234:1 against white and 4.459:1 against
 * #111111 — under readableTextOn's own 4.5:1 floor no matter which text
 * colour it picks, which the sweep in theme.test.ts caught (27 failures, all
 * `mode=dark, color=null`, isolated to this one constant — verified nothing
 * else in the ramp or derivation was at fault). #8452f5 is the same hue and
 * saturation lifted by ensureContrast("#8b5cf6", "#ffffff", 4.5) — the same
 * mechanism used everywhere else in this module, so white text (matching
 * globals.css's own hardcoded --primary-foreground) clears 4.5:1 (4.660:1).
 *
 * dark.ring is ALSO #8452f5, not globals.css's literal #8b5cf6. Before the
 * primary fix above, primary and ring were both #8b5cf6 — equal by
 * construction. Lifting only primary would have left them silently
 * divergent, so ring was moved to match. This is consistency, not a contrast
 * repair: ring carries no text label, so 3:1 (which #8b5cf6 already clears)
 * was never the problem. theme.test.ts reads globals.css's `.dark` block
 * directly and asserts both tokens still equal these two constants.
 */
export const BIS = {
  light: { primary: "#7c3aed", accent: "#0891b2", ring: "#7c3aed", sidebarAccent: "#8b5cf6" },
  dark:  { primary: "#8452f5", accent: "#22d3ee", ring: "#8452f5", sidebarAccent: "#a78bfa" },
} as const;

/**
 * A brand colour has two jobs on a button: be visible against the card it
 * sits on, and carry a legible label. Lifting for the first alone is what let
 * a 4.46:1 label through — the same failure globals.css's dark primary had.
 */
function liftForLabel(hex: string, surface: string): string | null {
  const visible = ensureContrast(hex, surface, 3);
  if (!visible) return null;
  if (Math.max(contrastRatio(visible, "#ffffff"), contrastRatio(visible, "#111111")) >= 4.5) {
    return visible;
  }
  // Push far enough for one of the two labels to work, then re-check that the
  // result is still visible on the surface. Darkening is tried first because a
  // white label is the one these mid-tone brands can usually reach.
  for (const label of ["#ffffff", "#111111"] as const) {
    const moved = ensureContrast(visible, label, 4.5);
    if (moved && contrastRatio(moved, surface) >= 3) return moved;
  }
  return null;
}

/**
 * Null means "emit nothing" — the shell then renders exactly the tokens
 * globals.css already sets, byte for byte.
 *
 * A colour on its own also returns null: PR #10 shipped brand_color as
 * accents-only through AppSidebar's own prop, and an agency that set only a
 * colour must not discover its clients' chrome repainted by a deploy. The
 * theme engages when the agency picks one of the four newer inputs.
 */
export function deriveTheme(
  inputs: ThemeInputs,
  mode: "light" | "dark",
): ResolvedTheme | null {
  if (!inputs.neutral && !inputs.corners && !inputs.type && !inputs.mode) return null;

  const ramp = NEUTRAL_RAMPS[inputs.neutral ?? "slate"];
  const steps = ramp[mode];
  const bis = BIS[mode];
  const brand = parseHexColor(inputs.color);

  // primary and accent both sit under a button label, so they share one
  // brand-driven colour lifted by liftForLabel — visible on the card AND
  // legible underneath white or near-black text — rather than each being
  // lifted independently against the same surface for no reason. ring and
  // sidebarAccent carry no label; they stay non-text UI at 3:1, each lifted
  // separately against the surface it actually lands on.
  const brandAccent = brand ? liftForLabel(brand, steps.card) : null;
  const primary = brandAccent ?? bis.primary;
  const accent = brandAccent ?? bis.accent;
  const sidebarAccent = (brand && ensureContrast(brand, ramp.sidebar, 3)) ?? bis.sidebarAccent;

  // The ring appears on both the page background and on cards, so clearing
  // one is not enough: lift against the background, then lift the result
  // again if the card is the harder of the two.
  let ring = (brand && ensureContrast(brand, steps.bg, 3)) ?? bis.ring;
  if (contrastRatio(ring, steps.card) < 3) {
    ring = ensureContrast(ring, steps.card, 3) ?? bis.ring;
  }

  return {
    background: steps.bg,
    foreground: steps.fg,
    card: steps.card,
    cardForeground: steps.fg,
    popover: steps.card,
    popoverForeground: steps.fg,
    primary,
    primaryForeground: readableTextOn(primary),
    secondary: steps.subtle,
    secondaryForeground: steps.fg,
    muted: steps.subtle,
    // Deliberately NOT readableTextOn: that snaps to maximum contrast and
    // would erase the hierarchy muted text exists to create. The ramp's own
    // step is quieter than the foreground and still clears 4.5:1, which the
    // sweep asserts both ways.
    mutedForeground: steps.mutedFg,
    accent,
    accentForeground: readableTextOn(accent),
    border: steps.border,
    input: steps.border,
    ring,
    sidebar: ramp.sidebar,
    sidebarForeground: SIDEBAR_FOREGROUND,
    sidebarAccent,
    sidebarBorder: ramp.sidebarBorder,
    radius: RADIUS[inputs.corners ?? "soft"],
    fontSans: FONT[inputs.type ?? "geist"],
  };
}
