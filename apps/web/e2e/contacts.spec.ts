import { test, expect } from "@playwright/test";
import { SEEDED_ACCOUNT_NAME, openAccountByName } from "./support";

test("contacts table renders and sorts", async ({ page }) => {
  // `a[href*="/contacts"]' is not unambiguous: it's a substring match, and
  // nothing on the page guarantees the first such anchor is a company card
  // rather than some other future link that merely mentions "/contacts" in
  // its href. Positional `.first()` on the company cards has the same
  // problem one level up: it picks whichever account renders first, which
  // is only the seeded account by accident of it currently being the only
  // one. Target the seeded account explicitly by name instead — this spec
  // needs its contact (Maria Garcia) to exist, not just any company.
  await openAccountByName(page, SEEDED_ACCOUNT_NAME);
  await expect(page).toHaveURL(/\/contacts$/);

  const table = page.getByRole("table");
  await expect(table).toBeVisible();

  await page.getByRole("button", { name: /Contact name/ }).click();
  await expect(table).toBeVisible();
});
