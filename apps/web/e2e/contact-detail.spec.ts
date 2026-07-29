import { test, expect } from "@playwright/test";

const ACCOUNT_NAME = "Test Client One";

// Opening a contact was never covered: the contacts spec asserts the table
// renders and sorts, then stops. A 404 on this route reached the owner.
test("opening a contact from the table renders the detail screen", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  const firstContact = page.getByRole("table").getByRole("link").first();
  await expect(firstContact).toBeVisible();
  // The cell renders an avatar badge before the name, so textContent is
  // e.g. "MGMaria Garcia" — take the trailing name only.
  const cellText = (await firstContact.textContent())?.trim() ?? "";
  const name = cellText.replace(/^[A-Z]{1,2}(?=[A-Z][a-z])/, "");
  expect(name.length).toBeGreaterThan(0);

  await firstContact.click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  // The bug this guards against returned 404, which renders not-found.tsx —
  // a page that still "loads". So assert on content only the real detail
  // screen has, and that the not-found copy is absent.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByText("Page not found")).toHaveCount(0);
});
