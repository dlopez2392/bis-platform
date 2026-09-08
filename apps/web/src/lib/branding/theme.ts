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
import { deriveAccent2 } from "./oklch";

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
  border: string; input: string; ring: string;
  sidebar: string; sidebarForeground: string;
  sidebarAccent: string; sidebarBorder: string;
  /** Second accent (spec §3.3): pinned for BIS, derived from the lifted primary for a brand. */
  accent2: string;
  radius: string;
  fontSans: string;
};

const RADIUS: Record<CornerName, string> = {
  sharp: "0.125rem", soft: "0.625rem", round: "1rem",
};

/** A closed set, so this never carries user text into a CSS value. */
export const FONT: Record<TypeName, string> = {
  geist: "var(--font-geist-sans)",
  inter: "var(--font-inter)",
  serif: "var(--font-source-serif)",
};

/**
 * What globals.css uses today, per mode. Every fallback lands here.
 *
 * Since Phase 1's semantic cut-over, every value here comes from
 * `apps/web/src/styles/tokens.css`, not from a literal in globals.css:
 * `primary`/`ring` are tokens.css's `--accent` per mode (`#6D28D9` light,
 * `#8B7CF7` dark) and, since the Northern Lights refresh retired the
 * sidebar-literal island, `sidebarAccent` mirrors tokens.css's
 * `--sidebar-tint` (`#8B7CF7`, identical in both modes — the sidebar does
 * not invert). `accent2` mirrors tokens.css's `--accent-2` (`#0891B2` light,
 * `#4FD8E6` dark): spec §3.3 pins the BIS second accent as a constant rather
 * than deriving it, so an unthemed account and a themed one agree. It carries
 * no text and is not part of the contrast sweep — it paints glows, the far
 * rail stop and the second chart series. `primary`, `ring` and
 * `sidebarAccent` all passed the sweep below untouched; no lift was needed
 * this round.
 *
 * dark.ring is kept equal to dark.primary (and light.ring to light.primary)
 * for the same reason the old literal-lift history recorded: before
 * tokenization, primary and ring were the same brand violet by construction,
 * and letting one drift from the other here would silently diverge them.
 * ring carries no text label, so its floor is 3:1 (already cleared) — this
 * is consistency, not a contrast repair. theme.test.ts reads globals.css's
 * and tokens.css's `:root` and `.dark` blocks directly and asserts every one
 * of these constants still resolves to the token it mirrors.
 */
export const BIS = {
  light: { primary: "#6d28d9", ring: "#6d28d9", sidebarAccent: "#8b7cf7", accent2: "#0891b2" },
  dark:  { primary: "#8b7cf7", ring: "#8b7cf7", sidebarAccent: "#8b7cf7", accent2: "#4fd8e6" },
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
 * card and the background are not interchangeable; see `liftAgainstBoth`.
 * Lifting for visibility without the label check is what separately let a
 * 4.46:1 label through — the same failure globals.css's dark primary had.
 *
 * `visibility` is a parameter because the two callers owe different floors
 * for the same two-part problem. `primary` needs 4.5:1 because it doubles as
 * link text. The public form's CTA is a button fill and nothing else, so it
 * owes 1.4.11's 3:1 — but its LABEL still owes 4.5:1, and that half is not
 * negotiable by the element's role. The public form reached this code by
 * failing exactly that: `#8b5cf6` sits in the luminance band where 3:1 on
 * white passes untouched and then neither white (4.459:1) nor #111111 clears
 * 4.5:1 on the result. That is a live AA defect on today's form, which never
 * lifted for the label at all.
 */
export function liftForLabel(
  hex: string, card: string, background: string, visibility: number,
): string | null {
  const visible = liftAgainstBoth(hex, card, background, visibility);
  if (!visible) return null;
  if (Math.max(contrastRatio(visible, "#ffffff"), contrastRatio(visible, "#111111")) >= 4.5) {
    return visible;
  }
  // Push far enough for one of the two labels to work, then re-check that the
  // result still clears BOTH surfaces. Darkening is tried first because a
  // white label is the one these mid-tone brands can usually reach.
  for (const label of ["#ffffff", "#111111"] as const) {
    const moved = ensureContrast(visible, label, 4.5);
    if (moved
        && contrastRatio(moved, card) >= visibility
        && contrastRatio(moved, background) >= visibility) {
      return moved;
    }
  }
  return null;
}

/**
 * Lifts `hex` until it clears `target` against BOTH `a` and `b`.
 *
 * Which surface binds is never assumed, because it flips between modes: in
 * light mode `background` is darker than `card`, so clearing white does not
 * clear the page; in dark mode `card` is lighter than `background`, so
 * `card` binds instead. Both surfaces sit on the same side of the brand
 * colour though (darkening in light mode improves both at once; lightening
 * in dark mode does too), so re-lifting against whichever of the two is
 * currently the harder one converges in a couple of steps — bounded
 * generously at 10 so a future ramp change can't spin this.
 *
 * `target` is a parameter rather than the 4.5 it was written with, because
 * `liftForLabel` now serves the public form's CTA at the 3:1 non-text floor
 * as well as `primary` at 4.5:1. One walk with a threshold argument, rather
 * than a second copy that can drift from this one. Not exported: callers
 * outside this file want `liftForLabel`, which is this walk PLUS the label
 * check — and the form arrived here by being given only the first half.
 */
function liftAgainstBoth(
  hex: string, a: string, b: string, target: number,
): string | null {
  let out = hex;
  for (let i = 0; i < 10; i++) {
    const aRatio = contrastRatio(out, a);
    const bRatio = contrastRatio(out, b);
    if (aRatio >= target && bRatio >= target) return out;
    const harder = aRatio <= bRatio ? a : b;
    const moved = ensureContrast(out, harder, target);
    if (!moved) return null;
    out = moved;
  }
  return contrastRatio(out, a) >= target && contrastRatio(out, b) >= target ? out : null;
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
  // ring and sidebarAccent still carry no label; they stay non-text UI at
  // 3:1, each lifted separately against the surface it actually lands on.
  const primary = (brand && liftForLabel(brand, steps.card, steps.bg, 4.5)) ?? bis.primary;
  const sidebarAccent = (brand && ensureContrast(brand, ramp.sidebar, 3)) ?? bis.sidebarAccent;

  // The ring appears on both the page background and on cards, so clearing
  // one is not enough: lift against the background, then lift the result
  // again if the card is the harder of the two.
  let ring = (brand && ensureContrast(brand, steps.bg, 3)) ?? bis.ring;
  if (contrastRatio(ring, steps.card) < 3) {
    ring = ensureContrast(ring, steps.card, 3) ?? bis.ring;
  }

  // Derived from the LIFTED primary, not the raw brand: the primary is what
  // --accent will be on <body>, so the pair is analogous to what renders.
  const accent2 = brand ? deriveAccent2(primary) : bis.accent2;

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
    border: steps.border,
    input: steps.border,
    ring,
    sidebar: ramp.sidebar,
    sidebarForeground: SIDEBAR_FOREGROUND,
    sidebarAccent,
    sidebarBorder: ramp.sidebarBorder,
    accent2,
    radius: RADIUS[inputs.corners ?? "soft"],
    fontSans: FONT[inputs.type ?? "geist"],
  };
}
