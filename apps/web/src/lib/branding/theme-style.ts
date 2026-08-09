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

/** globals.css's own light values, used when a token fails validation. */
const SAFE = {
  color: "#f8f8fb",
  radius: "0.625rem",
  fontSans: "var(--font-geist-sans)",
} as const;

const FONT_ALLOWLIST = new Set([
  "var(--font-geist-sans)", "var(--font-inter)", "var(--font-source-serif)",
]);

const c = (v: string) => parseHexColor(v) ?? SAFE.color;

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
    "--accent": c(theme.accent),
    "--accent-foreground": c(theme.accentForeground),
    "--border": c(theme.border),
    "--input": c(theme.input),
    "--ring": c(theme.ring),
    "--sidebar": c(theme.sidebar),
    "--sidebar-foreground": c(theme.sidebarForeground),
    "--sidebar-accent": c(theme.sidebarAccent),
    "--sidebar-border": c(theme.sidebarBorder),
    // Not re-emitting --radius-sm/md/lg: globals.css derives them with calc()
    // over var(--radius), and custom properties are substituted per element,
    // so overriding the base is enough.
    "--radius": resolveCssLength(theme.radius, SAFE.radius),
    // An allowlist rather than a pattern. This value is a var() reference,
    // which resolveCssLength correctly refuses, and it never contains user
    // text -- deriveTheme builds it from a closed set.
    "--font-sans": FONT_ALLOWLIST.has(theme.fontSans) ? theme.fontSans : SAFE.fontSans,
  } as CSSProperties;
}
