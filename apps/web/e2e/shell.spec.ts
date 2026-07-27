import { test, expect } from "@playwright/test";

test("sidebar collapse persists across reload", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  // Leave the sidebar expanded again so later specs (and reruns) start from
  // a known state instead of inheriting this test's cookie.
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});

test("account switcher navigates into a company", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("button", { name: "Switch company" }).click();
  const first = page.getByRole("option").first();
  await first.click();
  await expect(page).toHaveURL(/\/dashboard\/accounts\/[^/]+\/contacts/);
});
