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

// The closed sets, as values rather than types: the Settings action needs
// something it can call `.includes()` on to validate a form field, and the
// database enforces the same four sets with check constraints. This exists so
// a typo in the form returns a readable message instead of a Postgres error.
//
// Each type is DERIVED from its array rather than written beside it. They were
// two hand-kept lists for one commit, which is one commit longer than a
// duplicated literal set survives before drifting — and a name present in the
// array but missing from the type would pass the action's validation and then
// be refused by the database, which is the one failure mode this validation
// exists to prevent. NEUTRAL_NAMES lives in neutral-ramps.ts beside the
// ladders its members index.
export { NEUTRAL_NAMES } from "./neutral-ramps";
export const CORNER_NAMES = ["sharp", "soft", "round"] as const;
export type CornerName = (typeof CORNER_NAMES)[number];
export const TYPE_NAMES = ["geist", "inter", "serif"] as const;
export type TypeName = (typeof TYPE_NAMES)[number];
export const MODE_NAMES = ["light", "dark", "follow"] as const;
export type ModeName = (typeof MODE_NAMES)[number];

/**
 * The one decision behind every field on the Settings branding form: blank
 * clears the input (`null`, so `setBranding` leaves-or-clears it correctly —
 * see the `undefined` vs `null` distinction in `@bis/db`'s `setBranding`),
 * a member of the closed set passes through unchanged, and anything else is
 * rejected (`false`) so the caller can return `m["branding.badTheme"]`
 * instead of letting a typo reach the database's check constraint.
 *
 * Pulled out of the action itself (which can only touch `FormData`, not a
 * bare string, and is a `"use server"` module that may export only async
 * functions) so the actual branching logic is a plain function this file's
 * own test suite can exercise directly.
 */
export function parseAllowlisted<T extends readonly string[]>(
  raw: string, allowed: T,
): T[number] | null | false {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return (allowed as readonly string[]).includes(trimmed) ? (trimmed as T[number]) : false;
}

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
 * dark.primary has been lifted from globals.css's original literal #8b5cf6
 * TWICE, for two different failures.
 *
 * First: #8b5cf6 paired with white at only 4.234:1, and with #111111 at
 * 4.459:1 — under readableTextOn's own 4.5:1 floor no matter which text
 * colour it picks. The very first sweep caught this (27 failures, all
 * `mode=dark, color=null`). #8452f5 is the same hue and saturation lifted by
 * ensureContrast("#8b5cf6", "#ffffff", 4.5), so white text clears 4.5:1
 * (4.660:1).
 *
 * Second: once the sweep started asserting `primary` ITSELF — not just its
 * label — at 4.5:1 against every ramp's card AND page background (a
 * stronger bar than the 3:1 a plain button fill used to need; see
 * `liftForLabel`), #8452f5 fell short there: only 3.71–4.10:1 against the
 * three dark ramps' six card/background surfaces. #996ff7 is #8452f5's hue
 * and saturation lifted against whichever of those six was hardest at each
 * step, until all six clear 4.5:1 (4.919–5.429:1 measured). White no longer
 * clears on it (3.517:1) — its label is now #111111 (5.369:1), matching
 * both `readableTextOn(primary)` at derivation time and globals.css's own
 * hardcoded `--primary-foreground` for `.dark`.
 *
 * dark.ring tracks dark.primary through both lifts, for the same reason each
 * time: before the first lift, primary and ring were both #8b5cf6 — equal by
 * construction. Lifting only primary would leave them silently divergent, so
 * ring moved to match each time. This is consistency, not a contrast repair:
 * ring carries no text label, so 3:1 (which #8b5cf6 already cleared) was
 * never the problem, either time. theme.test.ts reads globals.css's `.dark`
 * block directly and asserts both tokens still equal these two constants.
 */
export const BIS = {
  light: { primary: "#7c3aed", ring: "#7c3aed", sidebarAccent: "#8b5cf6" },
  dark:  { primary: "#996ff7", ring: "#996ff7", sidebarAccent: "#a78bfa" },
} as const;

/**
 * A brand colour used as `primary` has three jobs, not one: be visible
 * against the card it sits on, be visible against the page background it
 * ALSO sits on directly (`text-primary` is 12px link text and the `link`
 * Button/Badge variants in 10 files — not only a button fill), and still
 * carry a legible label when it is a button's fill. 4.5:1 as text subsumes
 * the 3:1 a plain button background would need, so there is one threshold,
 * not two.
 *
 * Lifting for visibility against the card alone is what let a 2.84:1 button
 * through on the page background (`#cc986c` on the light `cool` ramp) — the
 * card and the background are not interchangeable; see
 * `liftUntilReadableOnBoth`. Lifting for visibility without the label check
 * is what separately let a 4.46:1 label through — the same failure
 * globals.css's dark primary had.
 */
function liftForLabel(hex: string, card: string, background: string): string | null {
  const visible = liftUntilReadableOnBoth(hex, card, background);
  if (!visible) return null;
  if (Math.max(contrastRatio(visible, "#ffffff"), contrastRatio(visible, "#111111")) >= 4.5) {
    return visible;
  }
  // Push far enough for one of the two labels to work, then re-check that the
  // result still clears BOTH surfaces. Darkening is tried first because a
  // white label is the one these mid-tone brands can usually reach.
  for (const label of ["#ffffff", "#111111"] as const) {
    const moved = ensureContrast(visible, label, 4.5);
    if (moved && contrastRatio(moved, card) >= 4.5 && contrastRatio(moved, background) >= 4.5) {
      return moved;
    }
  }
  return null;
}

/**
 * Lifts `hex` until it clears 4.5:1 against BOTH `card` and `background`.
 *
 * Which surface binds is never assumed, because it flips between modes: in
 * light mode `background` is darker than `card`, so clearing white does not
 * clear the page; in dark mode `card` is lighter than `background`, so
 * `card` binds instead. Both surfaces sit on the same side of the brand
 * colour though (darkening in light mode improves both at once; lightening
 * in dark mode does too), so re-lifting against whichever of the two is
 * currently the harder one converges in a couple of steps — bounded
 * generously at 10 so a future ramp change can't spin this.
 */
function liftUntilReadableOnBoth(hex: string, card: string, background: string): string | null {
  let out = hex;
  for (let i = 0; i < 10; i++) {
    const cardRatio = contrastRatio(out, card);
    const bgRatio = contrastRatio(out, background);
    if (cardRatio >= 4.5 && bgRatio >= 4.5) return out;
    const harder = cardRatio <= bgRatio ? card : background;
    const moved = ensureContrast(out, harder, 4.5);
    if (!moved) return null;
    out = moved;
  }
  return contrastRatio(out, card) >= 4.5 && contrastRatio(out, background) >= 4.5 ? out : null;
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

  // primary is the only token the brand still drives. It doubles as text
  // (text-primary links, the `link` Button/Badge variants) on two different
  // surfaces (card and page background), so it is lifted once against both
  // by liftForLabel — 4.5:1 as text subsumes the 3:1 a plain button fill
  // would need.
  //
  // accent is NOT brand-driven: it is the hover/focus surface for
  // outline/ghost buttons, dropdown-menu items, command-palette items and
  // badges — not an accent stripe — so filling it with the brand at full
  // strength made every menu row loud. It takes the ramp's own subtle/fg
  // pair instead, the same relationship secondary/secondaryForeground
  // already has, which is what this token means everywhere else in shadcn.
  //
  // ring and sidebarAccent still carry no label; they stay non-text UI at
  // 3:1, each lifted separately against the surface it actually lands on.
  const primary = (brand && liftForLabel(brand, steps.card, steps.bg)) ?? bis.primary;
  const accent = steps.subtle;
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
    // Not readableTextOn: accent is now always the ramp's own subtle step
    // (never brand-driven, see above), and its foreground is the ramp's own
    // fg — the exact pairing secondaryForeground/secondary already uses.
    accentForeground: steps.fg,
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
