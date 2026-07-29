import { test, expect } from "@playwright/test";

// Dark mode shipped with tokens and a provider but no way to reach it.
// These assert the control exists, actually flips the class the tokens key
// off, and survives a reload.
test("theme toggle flips the dark class and persists", async ({ page }) => {
  await page.goto("/dashboard/accounts");

  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible();

  await expect(html).toHaveClass(/\blight\b/);

  await toggle.click();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  // Put it back so the stored preference doesn't leak into other specs.
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);
});

test("sidebar stays dark in light mode", async ({ page }) => {
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
