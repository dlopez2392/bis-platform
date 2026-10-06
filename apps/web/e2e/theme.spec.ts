import { test, expect } from "./fixtures/test";

const THEME_COOKIE = "bis-theme";

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

  await toggle.click();
  await expect(html).toHaveClass(/\blight\b/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  // Put it back so the stored preference doesn't leak into other specs.
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
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
