/**
 * Which mode the server paints, and what next-themes must agree with.
 *
 * next-themes stores the user's choice in localStorage, which a server
 * component cannot read — so without a cookie the server cannot know which of
 * the two token sets to emit, and every navigation flashes the wrong theme.
 * The cookie exists for that one reason. Sidebar collapse is already
 * cookie-persisted, so this follows the house pattern.
 */
import type { ModeName } from "./theme";

export const THEME_COOKIE = "bis-theme";

/**
 * Whether the browser has learned something about the mode that the server
 * could not have known, and so should be written to the cookie.
 *
 * The cookie carries the USER's own answer, not a copy of the tenant's. There
 * are exactly two ways to have one: the user clicked the toggle (which writes
 * the cookie itself, in the same gesture), or the tenant said "follow the
 * device" and only the browser can say what the device prefers. next-themes
 * reports that second case as a stored `theme` of `"system"`.
 *
 * Echoing anything else back is not merely redundant, it is destructive: the
 * cookie outranks `brand_mode` in resolveThemeMode above, so a tenant default
 * copied into the cookie becomes indistinguishable from a deliberate user
 * choice and pins the tenant's own setting out of effect permanently. That
 * shipped once — the sync wrote on every route, and `/sign-in` has no tenant
 * to ask, so it resolved `light` and a company that chose a dark default would
 * never have seen one.
 *
 * Pure and separate from the effect that calls it, because a hook body cannot
 * be honestly tested in this repo.
 */
export function cookieModeToPersist(
  theme: string | undefined,
  resolvedTheme: string | undefined,
): "light" | "dark" | null {
  if (theme !== "system") return null;
  return resolvedTheme === "light" || resolvedTheme === "dark" ? resolvedTheme : null;
}

export function resolveThemeMode(
  cookie: string | undefined,
  brandMode: ModeName | null,
): { serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system" } {
  if (cookie === "light" || cookie === "dark") {
    return { serverMode: cookie, providerDefault: cookie };
  }
  if (brandMode === "light" || brandMode === "dark") {
    return { serverMode: brandMode, providerDefault: brandMode };
  }
  if (brandMode === "follow") {
    return { serverMode: "light", providerDefault: "system" };
  }
  return { serverMode: "light", providerDefault: "light" };
}
