import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { AGENCY_FIXTURE_FILE, clearStoredTheme, fixtureClerkUserId, storedTheme } from "./stored-theme";

// Same two paths, same reason, as every spec that talks to Supabase directly
// from the runner process (the saved-theme reads and resets below).
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const THEME_COOKIE = "bis-theme";

// Every test here is about the agency with NO saved theme (users.theme NULL),
// where the cookie and the operator default decide, exactly as before mis
// preferencias. The toggle saves its choice to users.theme (D5), and a saved
// theme outranks the cookie, so without this reset the toggle test below left
// the agency's saved "dark" under the next test's light cookie and that test
// painted dark (CI e2e, 2c0e6fb0). Established before each test, not assumed,
// and undone after the file so no later spec inherits it.
test.beforeEach(async () => {
  await clearStoredTheme(fixtureClerkUserId(AGENCY_FIXTURE_FILE));
});
test.afterAll(async () => {
  try {
    await clearStoredTheme(fixtureClerkUserId(AGENCY_FIXTURE_FILE));
  } catch (e) {
    console.error(`theme.spec cleanup: could not clear the agency identity's saved theme: ${String(e)}`);
  }
});

// Dark mode shipped with tokens and a provider but no way to reach it.
// These assert the control exists, actually flips the class the tokens key
// off, and survives a reload.
//
// The agency (an operator) defaults to DARK with no stored cookie —
// DESIGN.md's Identity section, owner decision 2026-10-06, wired through
// resolveThemeMode's `isOperator`. This test therefore starts from dark,
// toggles to light, reloads to prove the toggle persists, then restores
// dark — dark is the agency's own baseline now, not light.
test("theme toggle flips the dark class and persists", async ({ page }) => {
  await page.goto("/dashboard/accounts");

  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();

  await expect(html).toHaveClass(/\bdark\b/);

  const agency = fixtureClerkUserId(AGENCY_FIXTURE_FILE);

  await toggle.click();
  await expect(html).toHaveClass(/\blight\b/);
  // The toggle saves the person's choice, not only the cookie (mis
  // preferencias D5). Polled to completion so the background save has landed
  // before the next test's reset, which it would otherwise overwrite.
  await expect.poll(() => storedTheme(agency)).toBe("light");

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  // Toggle back; the saved "dark" this leaves is cleared by the next
  // beforeEach and the file's afterAll, since the toggle cannot write NULL.
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect.poll(() => storedTheme(agency)).toBe("dark");
});

// Pins getRequestTheme's isOperator wiring directly: a fresh context with NO
// bis-theme cookie at all must still resolve dark for the agency, the same
// answer resolveThemeMode's and pickRequestThemeMode's own unit tests give
// for `isOperator: true`. Clearing the cookie by name (rather than trusting
// that the saved storageState happens to carry none) is what makes this
// independent of whichever theme a previous spec file left behind.
test("the agency gets dark with no stored theme cookie", async ({ page, context }) => {
  await context.clearCookies({ name: THEME_COOKIE });
  await page.goto("/dashboard/accounts");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});

test("sidebar stays dark in light mode", async ({ page, baseURL }) => {
  // The agency defaults dark now, so light has to be requested explicitly —
  // same idiom signed-out.spec.ts uses to reach dark with no toggle on screen.
  await page.context().addCookies([
    { name: THEME_COOKIE, value: "light", url: baseURL ?? "http://localhost:3000" },
  ]);
  await page.goto("/dashboard/accounts");
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  // The spec requires the sidebar not to invert with the theme.
  const sidebarBg = await page
    .locator("aside")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  const channels = (sidebarBg.match(/\d+/g) ?? []).map(Number);
  expect(channels.length, `could not parse sidebar bg "${sidebarBg}"`).toBeGreaterThanOrEqual(3);
  const [r = 255, g = 255, b = 255] = channels;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  expect(luminance, `sidebar bg ${sidebarBg} should be dark in light mode`).toBeLessThan(0.3);
});
