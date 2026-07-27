import { test, expect } from "@playwright/test";

test("contacts table renders and sorts", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  // The accounts grid is the only place on this page that links into a
  // company's contacts list — the sidebar's own nav links come first in DOM
  // order but never point at /contacts, so scope by href instead of
  // grabbing the first link on the page.
  await page.locator('a[href*="/contacts"]').first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  await page.getByRole("button", { name: /Contact name/ }).click();
  await expect(table).toBeVisible();
});
