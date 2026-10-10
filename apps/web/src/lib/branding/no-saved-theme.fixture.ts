import type { ModeName } from "./theme";

/**
 * TEST DATA ONLY (imported by theme-mode.test.ts and
 * tenant-theme-reader.test.ts, never by app code).
 *
 * Every answer main's `resolveThemeMode(cookie, brandMode, isOperator)` gave
 * before mis preferencias existed (main 6c31e89d), written out as literals,
 * NOT computed: a table derived from the code under test could not fail.
 * The spec's promise is that a person with no saved theme (users.theme NULL)
 * gets exactly this, so every cell is checked with `userTheme = null`.
 *
 * Cookie "system" stands for any value the cookie should never hold; it must
 * read as no cookie at all. Expected is `serverMode/providerDefault`.
 */
export const NO_SAVED_THEME_TABLE: ReadonlyArray<
  readonly [cookie: string | undefined, brandMode: ModeName | null, isOperator: boolean, expected: string]
> = [
  // No tenant mode: the cookie, else the role default (agency dark, client light).
  [undefined, null, false, "light/light"],
  [undefined, null, true, "dark/dark"],
  ["light", null, false, "light/light"],
  ["light", null, true, "light/light"],
  ["dark", null, false, "dark/dark"],
  ["dark", null, true, "dark/dark"],
  ["system", null, false, "light/light"],
  ["system", null, true, "dark/dark"],
  // Tenant says light: the cookie still wins over it.
  [undefined, "light", false, "light/light"],
  [undefined, "light", true, "light/light"],
  ["light", "light", false, "light/light"],
  ["light", "light", true, "light/light"],
  ["dark", "light", false, "dark/dark"],
  ["dark", "light", true, "dark/dark"],
  ["system", "light", false, "light/light"],
  ["system", "light", true, "light/light"],
  // Tenant says dark: the cookie still wins over it (tenant-theme.spec's cookie-less case is row 1).
  [undefined, "dark", false, "dark/dark"],
  [undefined, "dark", true, "dark/dark"],
  ["light", "dark", false, "light/light"],
  ["light", "dark", true, "light/light"],
  ["dark", "dark", false, "dark/dark"],
  ["dark", "dark", true, "dark/dark"],
  ["system", "dark", false, "dark/dark"],
  ["system", "dark", true, "dark/dark"],
  // Tenant says follow the device: paint the OS snapshot cookie, else light; next-themes tracks the device.
  [undefined, "follow", false, "light/system"],
  [undefined, "follow", true, "light/system"],
  ["light", "follow", false, "light/system"],
  ["light", "follow", true, "light/system"],
  ["dark", "follow", false, "dark/system"],
  ["dark", "follow", true, "dark/system"],
  ["system", "follow", false, "light/system"],
  ["system", "follow", true, "light/system"],
];
