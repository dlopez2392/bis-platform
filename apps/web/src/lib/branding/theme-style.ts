/**
 * The last gate before a tenant's values reach the DOM.
 *
 * React serializes a style object into a style ATTRIBUTE and does not strip
 * `;` (verified against React 19.2.4), so a value here can append arbitrary
 * further CSS declarations to the element. Nothing should be able to arrive
 * hostile — four of the five inputs are closed sets the database enforces and
 * the fifth is hex-validated — but "should not" is not a guarantee, and this
 * function is cheap.
 */
import type { CSSProperties } from "react";
import { parseHexColor } from "./color";
import { resolveCssLength } from "@/lib/forms/safe-theme";
import type { ResolvedTheme } from "./theme";

/**
 * globals.css's own light values, used when a token fails validation.
 * `color` mirrors tokens.css's light `--surface-0` (globals.css's `--background`
 * is now `var(--surface-0)`, not a literal, since Phase 1's semantic
 * cut-over — was `#f8f8fb` pre-cut-over). `radius` mirrors globals.css's own
 * `--radius` literal (`0.75rem`, 12px — was `0.6875rem`; controls converge
 * in P2).
 */
export const SAFE_STYLE_FALLBACKS = {
  color: "#efebf9",
  radius: "0.75rem",
  fontSans: "var(--font-geist-sans)",
} as const;

export const FONT_ALLOWLIST = new Set([
  "var(--font-geist-sans)", "var(--font-inter)", "var(--font-source-serif)",
]);

const c = (v: string) => parseHexColor(v) ?? SAFE_STYLE_FALLBACKS.color;

/**
 * A tint's alpha as the percentage `color-mix()` wants. The number always
 * comes from `ACCENT_ALPHAS` by way of `theme.accentAlphas` — a closed table
 * keyed on mode — so no tenant text can reach a CSS value through this, and
 * reading it off the theme is what keeps the light and dark tints distinct.
 */
const pct = (alpha: number) => Math.round(alpha * 100);

export function themeStyle(theme: ResolvedTheme): CSSProperties {
  return {
    "--background": c(theme.background),
    "--foreground": c(theme.foreground),
    "--card": c(theme.card),
    "--card-foreground": c(theme.cardForeground),
    "--popover": c(theme.popover),
    "--popover-foreground": c(theme.popoverForeground),
    "--primary": c(theme.primary),
    "--primary-foreground": c(theme.primaryForeground),
    "--secondary": c(theme.secondary),
    "--secondary-foreground": c(theme.secondaryForeground),
    "--muted": c(theme.muted),
    "--muted-foreground": c(theme.mutedForeground),
    // Not "--accent-foreground": `--accent` is the brand accent token
    // globals.css/tokens.css own (var(--accent), the violet the whole app
    // paints from), and this function used to re-emit that name with the OLD
    // shadcn hover-surface pair (dead for rendering since globals.css's
    // @theme inline now reads --surface-3/--text-1 directly) — so a themed
    // client account had the brand accent SHADOWED on <body> by whatever the
    // ramp's subtle/fg pair happened to be. The name is claimed again below,
    // but for the tenant's own primary, which is what it was always supposed
    // to mean. `--accent-foreground` has no brand meaning and stays unemitted.
    "--border": c(theme.border),
    "--input": c(theme.input),
    "--ring": c(theme.ring),
    // The whole accent family follows the brand (Northern Lights spec §6):
    // glows, rail, hero gradient, primary button and focus glow all read
    // var(--accent)/var(--accent-2) from tokens.css, so a themed tenant's
    // dashboard never shows BIS violet.
    //
    // `--accent-strong` is DERIVED, not an alias of the primary:
    // `--gradient-primary` is linear-gradient(180deg, var(--accent),
    // var(--accent-strong)), and two identical stops render the tenant's one
    // primary button as a flat fill.
    //
    // The four tints are color-mix() over an already-validated hex, at a
    // percentage from ACCENT_ALPHAS — a closed table keyed on MODE, because
    // tokens.css pins lighter tints on light (.09/.28) than on dark
    // (.14/.35). No tenant text reaches CSS through either half.
    "--accent": c(theme.primary),
    "--accent-strong": c(theme.accentStrong),
    "--accent-dim": `color-mix(in srgb, ${c(theme.primary)} ${pct(theme.accentAlphas.accentDim)}%, transparent)`,
    "--ring-glow": `color-mix(in srgb, ${c(theme.ring)} ${pct(theme.accentAlphas.ringGlow)}%, transparent)`,
    "--accent-2": c(theme.accent2),
    "--accent-2-dim": `color-mix(in srgb, ${c(theme.accent2)} ${pct(theme.accentAlphas.accent2Dim)}%, transparent)`,
    "--ring-glow-2": `color-mix(in srgb, ${c(theme.accent2)} ${pct(theme.accentAlphas.ringGlow2)}%, transparent)`,
    // The far end of the active rail / avatar / meter gradient on the dark chrome.
    "--sidebar-tint-2": c(theme.accent2),
    // The lit ground's three radial glows, which now paint in the TENANT's
    // accent — so their strength has to travel with the theme rather than stay
    // at tokens.css's BIS numbers. Values come from a closed constant table
    // (GLOW_ALPHAS × 1, or × 0.5 once a brand colour is active), never from
    // tenant text, so `c()`'s hex validation has nothing to do here.
    "--glow-1-alpha": String(theme.glowAlphas.glow1),
    "--glow-2-alpha": String(theme.glowAlphas.glow2),
    "--glow-3-alpha": String(theme.glowAlphas.glow3),
    "--sidebar": c(theme.sidebar),
    "--sidebar-foreground": c(theme.sidebarForeground),
    "--sidebar-accent": c(theme.sidebarAccent),
    "--sidebar-border": c(theme.sidebarBorder),
    // Not re-emitting --radius-sm/md/lg: globals.css derives them with calc()
    // over var(--radius), and custom properties are substituted per element,
    // so overriding the base is enough.
    "--radius": resolveCssLength(theme.radius, SAFE_STYLE_FALLBACKS.radius),
    // An allowlist rather than a pattern. This value is a var() reference,
    // which resolveCssLength correctly refuses, and it never contains user
    // text -- deriveTheme builds it from a closed set.
    "--font-sans": FONT_ALLOWLIST.has(theme.fontSans) ? theme.fontSans : SAFE_STYLE_FALLBACKS.fontSans,
  } as CSSProperties;
}
