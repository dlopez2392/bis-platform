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
