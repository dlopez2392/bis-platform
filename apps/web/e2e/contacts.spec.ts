import { test, expect } from "@playwright/test";

test("contacts table renders and sorts", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  // `a[href*="/contacts"]' is not unambiguous: it's a substring match, and
  // nothing on the page guarantees the first such anchor is a company card
  // rather than some other future link that merely mentions "/contacts" in
  // its href. Target the company card by its own test id instead.
  await page.locator('[data-testid^="account-"]').first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  await page.getByRole("button", { name: /Contact name/ }).click();
  await expect(table).toBeVisible();
});
