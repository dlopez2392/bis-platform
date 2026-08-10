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
  const cookieMode = cookie === "light" || cookie === "dark" ? cookie : undefined;

  // `follow` is special-cased ahead of the generic cookie branch below. For
  // every other brandMode the cookie is the user's own deliberate choice and
  // rightly overrides everything, INCLUDING providerDefault -- that is the
  // whole point of a stored choice. But for `follow` the only way a cookie
  // gets written at all is ThemeCookieSync recording whatever the OS said
  // (see cookieModeToPersist), and that is not a choice to freeze -- it is a
  // snapshot. Handing that cookie's value to providerDefault would pull
  // next-themes out of "system" mode the first time the sync effect ran, and
  // since the user never clicked anything, localStorage stays empty and a
  // later OS change is never picked up again -- the tenant's device-follow
  // setting works exactly once per browser. providerDefault must therefore
  // stay "system" here regardless of the cookie, so next-themes keeps
  // tracking the OS forever. The cookie's only remaining job for a `follow`
  // tenant is telling the SERVER which token set to paint for this one
  // request (serverMode), which is exactly what the client already resolved
  // last time and has no other way to reach a server component.
  if (brandMode === "follow") {
    return { serverMode: cookieMode ?? "light", providerDefault: "system" };
  }
  if (cookieMode) {
    return { serverMode: cookieMode, providerDefault: cookieMode };
  }
  if (brandMode === "light" || brandMode === "dark") {
    return { serverMode: brandMode, providerDefault: brandMode };
  }
  return { serverMode: "light", providerDefault: "light" };
}

/**
 * Reads a single cookie's value out of a raw `document.cookie` string, or
 * undefined if it is not present. Pure and exported so both
 * ThemeCookieSync's read-before-write comparisons below can be tested
 * without a real browser -- `document.cookie` itself cannot be constructed
 * in a unit test, but the string it produces can.
 */
export function readCookieValue(cookieString: string, name: string): string | undefined {
  for (const part of cookieString.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * The one-time migration for a user who chose a mode before this branch
 * shipped a cookie at all. Before ThemeCookieSync existed, the toggle only
 * ever called `setTheme` -- no cookie -- and `enableSystem` was off, so
 * every existing dark-mode user today has `localStorage.theme = "dark"` and
 * no `bis-theme` cookie. After deploy the server sees no cookie and paints
 * light, while next-themes reads localStorage on mount and puts `.dark` on
 * `<html>` -- on a themed tenant that is dark classes over light tokens,
 * permanently, because `cookieModeToPersist` only ever fires for
 * `theme === "system"` and this user's `theme` is the literal `"dark"`, not
 * `"system"`. It also bites anyone whose cookie expires or is cleared while
 * localStorage survives.
 *
 * Pure and separate from the effect that calls it, for the same reason as
 * `cookieModeToPersist`: the last defect in this component shipped precisely
 * because its logic lived in a hook body instead of somewhere testable. This
 * takes exactly what the effect can read -- the cookie (already parsed with
 * `readCookieValue`) and localStorage's raw string -- and returns the value
 * to migrate, or null to do nothing. The guard lives here, not in the
 * caller: passing a defined cookie always yields null, so the migration can
 * never re-fire once it (or any later explicit choice) has written one.
 */
export function cookieModeToMigrate(
  existingCookie: string | undefined,
  storedTheme: string | null,
): "light" | "dark" | null {
  if (existingCookie !== undefined) return null;
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : null;
}
