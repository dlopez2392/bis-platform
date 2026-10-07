import type { CSSProperties } from "react";

/**
 * Shared by every tree's `not-found.tsx`/`error.tsx` that has no CSS file of
 * its own to declare `var(--token, fallback)` rules in (`/f`'s already does,
 * in `form.css` — this is the same pattern, for the trees that don't have
 * one: `/b` and `/c`).
 *
 * Every colour/radius is a `var()` reference, never a bare literal (F-102
 * review round, fix 5): when an ancestor `[publicId]` layout has wrapped
 * this component in the account's real theme (a known-but-not-live
 * document — see each layout's own comment), these custom properties are
 * already set and this component's text picks up the brand's own colour for
 * free, through ordinary CSS inheritance. When there is no such ancestor
 * (the public id never existed at all — the neutral case), nothing sets
 * these properties and the literal AFTER THE COMMA paints instead.
 *
 * That literal is the one piece this module decides for itself: `?theme=`
 * (`embed.js`'s `data-theme`, the same query the live page's own
 * `publicFormTheme`/`parseHostMode` read) picks dark text on a transparent
 * background instead of dark-on-nothing, which is unreadable on a host page
 * that told the embed it is dark. Before this, every one of these files
 * hard-coded the LIGHT literal regardless of `?theme=` — correct for the
 * common case (a bare link, no host, no theme) and invisible on a dark
 * embed otherwise.
 */
export function deadEndTextStyle(themeParam: string | null): CSSProperties {
  const dark = themeParam === "dark";
  return {
    font: `400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif)`,
    color: `var(--foreground, ${dark ? "#f4f4f5" : "#18181b"})`,
    background: "var(--background, transparent)",
    padding: 16, maxWidth: 480, margin: "0 auto",
  };
}

/** The "Try again" button on an `error.tsx` boundary — same `var()`-first
 *  shape, but the button's own fill/label pair (`--form-accent`/
 *  `--form-accent-foreground`) is already guaranteed to contrast with
 *  ITSELF by `publicFormTheme`'s own contrast sweep, so unlike the page
 *  text above, the literal fallback does not need to vary with `?theme=`. */
export function deadEndButtonStyle(): CSSProperties {
  return {
    font: "inherit", fontWeight: 600, border: "none",
    borderRadius: "var(--radius, 0.5rem)",
    background: "var(--form-accent, #6d28d9)",
    color: "var(--form-accent-foreground, #ffffff)",
    padding: "10px 18px", cursor: "pointer",
  };
}
